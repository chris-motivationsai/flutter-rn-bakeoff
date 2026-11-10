// A whole app on fakes: real core, real SQLite file, real C++ engine, real HTTP to the kit server.
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FetchHttp } from '../../src/adapters/fetchHttp';
import { FakeCamera, FakeClock, FakeStore, FakeThermometer, nodeIds, type BleScript } from '../../src/adapters/fake/fakes';
import { openNodeSqlite } from '../../src/adapters/fake/nodeSqlite';
import { loadNodeStripEngine } from '../../src/adapters/fake/nodeStripEngine';
import { AppCore } from '../../src/core/app';
import { parsePack, type Pack } from '../../src/core/pack';
import type { GrayImage, Http, HttpRequest, HttpResponse } from '../../src/core/ports';
import type { Result } from '../../src/core/types';
import { KIT, PROJECT_ROOT, nodeRequest } from './server';

/** Http over node:http, for the React Native test environment (where global fetch is Expo's native one). */
export class NodeHttp implements Http {
  constructor(private readonly baseUrl: string) {}
  async send(request: HttpRequest): Promise<HttpResponse> {
    try {
      const response = await nodeRequest(this.baseUrl + request.path, request.method, request.body, { authorization: 'Bearer test-token' });
      return { kind: 'response', ...response };
    } catch {
      return { kind: 'unreachable' };
    }
  }
}

export const loadPack = (id: 'polly' | 'premom'): Pack => parsePack(JSON.parse(fs.readFileSync(path.join(KIT, 'packs', `${id}.json`), 'utf8')));

/** Records every request the app makes and what came back. */
export class RecordingHttp implements Http {
  readonly calls: { request: HttpRequest; response: HttpResponse }[] = [];
  /** Return a response to answer instead of the server (the request never leaves), or null to pass through. */
  intercept: ((request: HttpRequest) => HttpResponse | null) | null = null;
  constructor(private readonly inner: Http) {}
  async send(request: HttpRequest): Promise<HttpResponse> {
    const response = this.intercept?.(request) ?? (await this.inner.send(request));
    this.calls.push({ request, response });
    return response;
  }
  to(pathPrefix: string) {
    return this.calls.filter((call) => call.request.path.startsWith(pathPrefix));
  }
  clear(): void {
    this.calls.length = 0;
  }
}

export type Harness = ReturnType<typeof createHarness>;

export function createHarness(serverUrl: string, packId: 'polly' | 'premom' = 'premom', packOverride?: Pack, transport?: Http) {
  const pack = packOverride ?? loadPack(packId);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-core-test-'));
  const clock = new FakeClock('2026-11-03T08:00:00Z');
  const camera = new FakeCamera();
  const thermometer = new FakeThermometer();
  const store = new FakeStore();
  const http = new RecordingHttp(transport ?? new FetchHttp(serverUrl, 'test-token', 5000));
  const stripEngine = loadNodeStripEngine(PROJECT_ROOT);
  const open = () => new AppCore({ pack, db: openNodeSqlite(path.join(dir, 'app.db')), http, clock, ids: nodeIds, stripEngine, camera, thermometer, store });

  const h = {
    pack, clock, camera, thermometer, store, http, dir,
    app: open(),
    /** Disposes the app and opens a new one on the same storage. */
    restart() {
      h.app.close();
      h.app = open();
    },
    at(time: string) {
      clock.at = time;
      return h;
    },
    /** Logs a manual observation at the given time. */
    async log(time: string, type: string, value: unknown): Promise<Result> {
      clock.at = time;
      return h.app.logManual(type, value);
    },
    async scan(time: string, image: GrayImage, type = 'lh'): Promise<Result> {
      clock.at = time;
      camera.next = image;
      return h.app.scanStrip(type);
    },
    async thermo(time: string, script: BleScript, type = 'bbt'): Promise<Result> {
      clock.at = time;
      thermometer.script = script;
      return h.app.readThermometer(type);
    },
    dispose() {
      h.app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}

// ---- strip images ----

/**
 * Draws a synthetic strip: light background with a control line (at 67% of the width) and a test line
 * (at 42%). `control` and `test` are how much darker than the background each line is.
 */
export function stripImage(control: number, test: number, background = 200, width = 200, height = 20): GrayImage {
  const gray = new Uint8Array(width * height).fill(background);
  const paint = (center: number, depth: number) => {
    for (let x = center - 4; x <= center + 4; x++) for (let y = 0; y < height; y++) gray[y * width + x] = background - depth;
  };
  paint(Math.round(width * 0.67), control);
  paint(Math.round(width * 0.42), test);
  return { width, height, gray };
}

export const flatImage = (level: number, width = 200, height = 20): GrayImage => ({ width, height, gray: new Uint8Array(width * height).fill(level) });

// ---- thermometer frames ----

/** Builds a Temperature Measurement frame as hex. */
export function frame(options: { mantissa: number; exponent: number; fahrenheit?: boolean; time?: [number, number, number, number, number, number]; type?: number }): string {
  const flags = (options.fahrenheit ? 1 : 0) | (options.time ? 2 : 0) | (options.type !== undefined ? 4 : 0);
  const m = options.mantissa & 0xffffff;
  const bytes = [flags, m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff, options.exponent & 0xff];
  if (options.time) {
    const [year, month, day, hour, minute, second] = options.time;
    bytes.push(year & 0xff, year >> 8, month, day, hour, minute, second);
  }
  if (options.type !== undefined) bytes.push(options.type);
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function session(finalHex: string | null, name = 'Thermo-X', intermediates: string[] = [frame({ mantissa: 3600, exponent: -2 })]): BleScript {
  return {
    device: { name, service: '1809' },
    events: [
      { event: 'connect' },
      ...intermediates.map((hex) => ({ event: 'notify' as const, char: '2A1E', hex })),
      ...(finalHex === null ? [] : [{ event: 'notify' as const, char: '2A1C', hex: finalHex }]),
      { event: 'disconnect' },
    ],
  };
}

// ---- receipts (same test-only format as kit/server/receipt.ts) ----

export function receipt(payload: { txId: string; userId: string; productId?: string; entitlement?: string; expiresAt: string }): string {
  const full = { productId: 'premium_monthly', entitlement: 'premium', ...payload };
  const part = Buffer.from(JSON.stringify(full)).toString('base64url');
  return `${part}.${createHmac('sha256', 'bakeoff-store-secret').update(part).digest('hex')}`;
}
