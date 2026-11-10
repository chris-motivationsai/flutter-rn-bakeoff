// Scenario runner (SPEC section 8): ./run-scenario.sh <scenario.json> <serverUrl> <out.json> <workDir>
// Drives the same AppCore the screens use, with the device faked. It never reads the scenario's `expect`.
import fs from 'node:fs';
import path from 'node:path';
import { FetchHttp } from '../adapters/fetchHttp';
import { FakeCamera, FakeClock, FakeStore, FakeThermometer, nodeIds, type BleScript } from '../adapters/fake/fakes';
import { openNodeSqlite } from '../adapters/fake/nodeSqlite';
import { loadNodeStripEngine } from '../adapters/fake/nodeStripEngine';
import { AppCore } from '../core/app';
import { parsePgm } from '../core/image';
import { parsePack } from '../core/pack';
import type { Http, StoreEvent, StoreTransaction } from '../core/ports';
import { OK, type Result, type Snapshot, type Target } from '../core/types';

type Step = { do: string; at: string } & Record<string, unknown>;
export type RunOutput = { steps: Result[]; snapshots: Record<string, Snapshot & { storeFinished: string[] }> };

export type RunOptions = {
  /** Only `pack`, `steps` are used. */
  scenario: { pack: string; steps: Step[] };
  /** Folder that fixture paths in steps are relative to. */
  scenarioDir: string;
  serverUrl: string;
  workDir: string;
  projectRoot: string;
  /** Lets tests observe traffic; defaults to plain fetch. */
  wrapHttp?: (http: Http) => Http;
};

const TOKEN = 'test-token';

export async function runScenario(options: RunOptions): Promise<RunOutput> {
  const { scenario, scenarioDir, serverUrl, workDir, projectRoot } = options;
  const packFile = path.join(projectRoot, '..', 'kit', 'packs', `${scenario.pack}.json`);
  const pack = parsePack(JSON.parse(fs.readFileSync(packFile, 'utf8')));

  // The fakes play the part of the device and outlive app restarts, like a real phone's hardware and store.
  const clock = new FakeClock();
  const camera = new FakeCamera();
  const thermometer = new FakeThermometer();
  const store = new FakeStore();
  const stripEngine = loadNodeStripEngine(projectRoot);
  const plainHttp = new FetchHttp(serverUrl, TOKEN);
  const http = options.wrapHttp ? options.wrapHttp(plainHttp) : plainHttp;
  const dbFile = path.join(workDir, 'app.db');
  const open = () => new AppCore({ pack, db: openNodeSqlite(dbFile), http, clock, ids: nodeIds, stripEngine, camera, thermometer, store });

  let app = open();
  const out: RunOutput = { steps: [], snapshots: {} };
  const fixture = (relative: unknown) => path.resolve(scenarioDir, String(relative));

  for (const step of scenario.steps) {
    clock.at = step.at;
    let result: Result = OK;
    switch (step.do) {
      case 'log_manual':
        result = await app.logManual(String(step.type), step.value);
        break;
      case 'scan_strip':
        camera.next = parsePgm(new Uint8Array(fs.readFileSync(fixture(step.image))));
        result = await app.scanStrip(String(step.type));
        break;
      case 'thermometer_session':
        thermometer.script = JSON.parse(fs.readFileSync(fixture(step.script), 'utf8')) as BleScript;
        result = await app.readThermometer(String(step.type));
        break;
      case 'edit':
        result = await app.edit(step.target as Target, step.value);
        break;
      case 'delete':
        result = await app.delete(step.target as Target);
        break;
      case 'sync':
        result = await app.sync();
        break;
      case 'purchase':
        store.purchaseScript = step.store as StoreEvent[];
        result = await app.purchase(String(step.productId));
        break;
      case 'restore':
        store.restoreScript = step.store as StoreTransaction[];
        result = await app.restore();
        break;
      case 'restart':
        app.close();
        app = open();
        break;
      case 'server_control':
        // Forwarded verbatim; the runner does not interpret it.
        await fetch(`${serverUrl}/__control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(step.body) });
        break;
      case 'snapshot':
        out.snapshots[String(step.name)] = { ...app.snapshot(), storeFinished: [...store.finished].sort() };
        break;
      default:
        throw new Error(`unknown step: ${step.do}`);
    }
    out.steps.push(result);
  }
  app.close();
  return out;
}

async function main(): Promise<void> {
  const [scenarioFile, serverUrl, outFile, workDir] = process.argv.slice(2);
  if (!scenarioFile || !serverUrl || !outFile || !workDir) {
    console.error('usage: run-scenario.sh <scenario.json> <serverUrl> <out.json> <workDir>');
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
  const scenario = { pack: raw.pack as string, steps: raw.steps as Step[] }; // `expect` is deliberately not taken
  fs.mkdirSync(workDir, { recursive: true });
  const output = await runScenario({
    scenario,
    scenarioDir: path.dirname(path.resolve(scenarioFile)),
    serverUrl: serverUrl.replace(/\/$/, ''),
    workDir,
    projectRoot: path.resolve(__dirname, '..', '..'),
  });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 1));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
