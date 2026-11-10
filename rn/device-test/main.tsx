// On-device test entry (Android emulator, iOS simulator). Selected by EXPO_PUBLIC_DEVICE_TEST=1 in index.ts.
// EXPO_PUBLIC_DEVICE_TEST_HOST is where device-test/host.ts listens, as seen from the device (default: Android emulator).
// It runs, inside the real app process (Hermes + the real native modules):
//   1. the native C++ strip engine on every fixture the host sends, and
//   2. the kit's public scenarios through the same AppCore the screens use, with the real expo-sqlite
//      adapter, the real fetch adapter and the native strip engine. Camera, thermometer, store and clock
//      are the same fakes the headless runner uses (src/adapters/fake/fakes.ts).
// Results are posted to device-test/host.ts on the Mac, which does all comparing.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { FakeCamera, FakeClock, FakeStore, FakeThermometer, type BleScript } from '../src/adapters/fake/fakes';
import { FetchHttp } from '../src/adapters/fetchHttp';
import { openExpoSqlite } from '../src/adapters/real/expoSqlite';
import { nativeStripEngine } from '../src/adapters/real/nativeStripEngine';
import { cryptoIds } from '../src/adapters/real/system';
import { AppCore } from '../src/core/app';
import { parsePgm } from '../src/core/image';
import { parsePack } from '../src/core/pack';
import type { StoreEvent, StoreTransaction } from '../src/core/ports';
import { OK, type Result, type Target } from '../src/core/types';

const HOST = process.env.EXPO_PUBLIC_DEVICE_TEST_HOST ?? 'http://10.0.2.2:8799';

type Step = { do: string; at: string } & Record<string, unknown>;
type Job = {
  serverUrl: string;
  fixtures: { name: string; base64: string }[];
  scenarios: { id: string; packJson: unknown; steps: Step[] }[];
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, acc = 0, pos = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[pos++] = (acc >> bits) & 0xff; }
  }
  return out;
}

async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(HOST + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

function runEngine(job: Job) {
  const results = job.fixtures.map((fixture) => {
    try {
      const image = parsePgm(fromBase64(fixture.base64));
      const t0 = Date.now();
      const { status, ratio } = nativeStripEngine.read(image.gray, image.width, image.height);
      return { name: fixture.name, status, ratio, ms: Date.now() - t0 };
    } catch (error) {
      return { name: fixture.name, error: String(error) };
    }
  });
  return { version: nativeStripEngine.version(), results };
}

// The same loop as src/runner/main.ts, with fixtures inlined by the host instead of read from disk.
async function runScenario(scenario: Job['scenarios'][number], serverUrl: string, tag: string) {
  const pack = parsePack(scenario.packJson);
  const clock = new FakeClock();
  const camera = new FakeCamera();
  const thermometer = new FakeThermometer();
  const store = new FakeStore();
  const http = new FetchHttp(serverUrl, 'test-token');
  const dbName = `device-test-${scenario.id}-${tag}.db`;
  const open = () => new AppCore({ pack, db: openExpoSqlite(dbName), http, clock, ids: cryptoIds, stripEngine: nativeStripEngine, camera, thermometer, store });
  let app = open();
  const out: { steps: Result[]; snapshots: Record<string, unknown> } = { steps: [], snapshots: {} };
  for (const step of scenario.steps) {
    clock.at = step.at;
    let result: Result = OK;
    switch (step.do) {
      case 'log_manual': result = await app.logManual(String(step.type), step.value); break;
      case 'scan_strip':
        camera.next = parsePgm(fromBase64(String(step.imageBase64)));
        result = await app.scanStrip(String(step.type));
        break;
      case 'thermometer_session':
        thermometer.script = step.scriptJson as BleScript;
        result = await app.readThermometer(String(step.type));
        break;
      case 'edit': result = await app.edit(step.target as Target, step.value); break;
      case 'delete': result = await app.delete(step.target as Target); break;
      case 'sync': result = await app.sync(); break;
      case 'purchase':
        store.purchaseScript = step.store as StoreEvent[];
        result = await app.purchase(String(step.productId));
        break;
      case 'restore':
        store.restoreScript = step.store as StoreTransaction[];
        result = await app.restore();
        break;
      case 'restart': app.close(); app = open(); break;
      case 'server_control':
        await fetch(`${serverUrl}/__control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(step.body) });
        break;
      case 'snapshot':
        out.snapshots[String(step.name)] = { ...app.snapshot(), storeFinished: [...store.finished].sort() };
        break;
      default: throw new Error(`unknown step: ${step.do}`);
    }
    out.steps.push(result);
  }
  app.close();
  return out;
}

async function runAll(report: (line: string) => void): Promise<void> {
  const job: Job = await (await fetch(`${HOST}/job`)).json();
  report(`job: ${job.fixtures.length} fixtures, ${job.scenarios.length} scenarios`);
  await post('/engine', runEngine(job));
  report('engine results posted');
  const tag = String(Date.now());
  for (const scenario of job.scenarios) {
    await post('/scenario-start', { id: scenario.id });
    let body: unknown;
    try {
      body = { id: scenario.id, output: await runScenario(scenario, job.serverUrl, tag) };
    } catch (error) {
      body = { id: scenario.id, error: String(error) };
    }
    await post('/scenario-done', body);
    report(`${scenario.id} done`);
  }
  await post('/finished', {});
  report('finished');
}

export default function DeviceTest() {
  const [lines, setLines] = useState<string[]>(['device test starting']);
  useEffect(() => {
    const report = (line: string) => { console.log(`[device-test] ${line}`); setLines((prev) => [...prev, line]); };
    runAll(report).catch((error) => {
      report(`FAILED: ${String(error)}`);
      post('/finished', { error: String(error) }).catch(() => undefined);
    });
  }, []);
  return (
    <View style={{ flex: 1, padding: 40 }}>
      {lines.slice(-25).map((line, index) => <Text key={index}>{line}</Text>)}
    </View>
  );
}
