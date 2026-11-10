// The real Bluetooth adapter, with react-native-ble-plx's BleManager replaced by a scripted one.
// Everything above the library (scan filter, UUID handling, base64 decoding, event order, teardown) is real.
import { BlePlxThermometer, shortUuid } from '../../src/adapters/real/blePlxThermometer';
import { AppCore } from '../../src/core/app';
import type { ThermometerEvent } from '../../src/core/ports';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeCamera, FakeClock, FakeStore, nodeIds } from '../../src/adapters/fake/fakes';
import { openNodeSqlite } from '../../src/adapters/fake/nodeSqlite';
import { loadNodeStripEngine } from '../../src/adapters/fake/nodeStripEngine';
import { frame, loadPack } from '../helpers/harness';
import { PROJECT_ROOT } from '../helpers/server';

type Listener = (error: unknown, value: unknown) => void;
const mockBle = {
  scanUuids: null as string[] | null,
  monitors: new Map<string, Listener>(),
  onDisconnect: null as Listener | null,
  cancelled: [] as string[],
  removed: 0,
  device: { id: 'dev-1', name: 'EasyHome-EBT-300', localName: null as string | null },
};

jest.mock('react-native-ble-plx', () => {
  const actual = jest.requireActual('react-native-ble-plx');
  class BleManager {
    onStateChange(listener: (state: string) => void) {
      listener('PoweredOn');
      return { remove: () => undefined };
    }
    async startDeviceScan(uuids: string[], _options: unknown, listener: Listener) {
      mockBle.scanUuids = uuids;
      setTimeout(() => listener(null, mockBle.device), 0);
    }
    async stopDeviceScan() {}
    async connectToDevice(id: string) {
      const device = { ...mockBle.device, id, discoverAllServicesAndCharacteristics: async () => device };
      return device;
    }
    monitorCharacteristicForDevice(_id: string, _service: string, characteristic: string, listener: Listener) {
      mockBle.monitors.set(characteristic, listener);
      return { remove: () => void mockBle.removed++ };
    }
    onDeviceDisconnected(_id: string, listener: Listener) {
      mockBle.onDisconnect = listener;
      return { remove: () => void mockBle.removed++ };
    }
    async cancelDeviceConnection(id: string) {
      mockBle.cancelled.push(id);
    }
  }
  return { ...actual, BleManager };
});

const FINAL = '00002a1c-0000-1000-8000-00805f9b34fb';
const INTERMEDIATE = '00002a1e-0000-1000-8000-00805f9b34fb';
const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');
const notify = (uuid: string, hex: string) => mockBle.monitors.get(uuid)!(null, { uuid, value: b64(hex) });
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  if (!condition()) throw new Error('condition not reached');
};

beforeEach(() => {
  mockBle.scanUuids = null;
  mockBle.monitors.clear();
  mockBle.onDisconnect = null;
  mockBle.cancelled = [];
  mockBle.removed = 0;
});

test('shortUuid turns library UUIDs into 16-bit ids', () => {
  expect(shortUuid(FINAL)).toBe('2A1C');
  expect(shortUuid('2a1e')).toBe('2A1E');
});

test('scans for the Health Thermometer service, forwards notifications as bytes, stops when told to', async () => {
  const events: ThermometerEvent[] = [];
  const done = new BlePlxThermometer().runSession((event) => {
    events.push(event);
    return !(event.event === 'notify' && event.char === '2A1C');
  });
  await until(() => mockBle.monitors.size === 2);
  expect(mockBle.scanUuids).toEqual(['00001809-0000-1000-8000-00805f9b34fb']);
  notify(INTERMEDIATE, '00fa0d00fe');
  notify(FINAL, '00540e00fe');
  notify(FINAL, '00ffff7f00'); // after "stop": must not be delivered
  await done;
  expect(events).toEqual([
    { event: 'connect', deviceName: 'EasyHome-EBT-300' },
    { event: 'notify', char: '2A1E', bytes: Uint8Array.from([0x00, 0xfa, 0x0d, 0x00, 0xfe]) },
    { event: 'notify', char: '2A1C', bytes: Uint8Array.from([0x00, 0x54, 0x0e, 0x00, 0xfe]) },
  ]);
  expect(mockBle.cancelled).toEqual(['dev-1']);
  expect(mockBle.removed).toBe(3); // both monitors and the disconnect subscription
});

test('a device that disconnects first ends the session with a disconnect event', async () => {
  const events: ThermometerEvent[] = [];
  const done = new BlePlxThermometer().runSession((event) => {
    events.push(event);
    return true;
  });
  await until(() => mockBle.monitors.size === 2);
  notify(INTERMEDIATE, '00fa0d00fe');
  mockBle.onDisconnect!(null, mockBle.device);
  await done;
  expect(events.map((event) => event.event)).toEqual(['connect', 'notify', 'disconnect']);
});

test('end to end: the core logs a reading delivered through the real adapter', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-ble-'));
  const clock = new FakeClock('2026-11-03T06:30:00Z');
  const app = new AppCore({
    pack: loadPack('premom'),
    db: openNodeSqlite(path.join(dir, 'app.db')),
    http: { send: async () => ({ kind: 'unreachable' }) },
    clock,
    ids: nodeIds,
    stripEngine: loadNodeStripEngine(PROJECT_ROOT),
    camera: new FakeCamera(),
    store: new FakeStore(),
    thermometer: new BlePlxThermometer(),
  });
  const result = app.readThermometer('bbt');
  await until(() => mockBle.monitors.size === 2);
  notify(INTERMEDIATE, frame({ mantissa: 3600, exponent: -2 }));
  notify(FINAL, frame({ mantissa: 978, exponent: -1, fahrenheit: true }));
  expect(await result).toEqual({ ok: true });
  expect(app.snapshot().observations).toEqual([
    { type: 'bbt', observedAt: '2026-11-03T06:30:00Z', source: 'thermometer', sync: 'pending', display: { celsius: 36.56 } },
  ]);
  app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
