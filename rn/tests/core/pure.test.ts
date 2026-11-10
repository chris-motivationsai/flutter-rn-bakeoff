import fs from 'node:fs';
import path from 'node:path';
import { encode } from 'fast-png';
import { FetchHttp } from '../../src/adapters/fetchHttp';
import { pngToGray } from '../../src/adapters/pngToGray';
import { parsePgm, toGray } from '../../src/core/image';
import { base64ToBytes, hexToBytes, roundTo } from '../../src/core/numbers';
import { checkValue, displayFor } from '../../src/core/observations';
import { findEntry, levelFor, parsePack, valueField, type StripEntry } from '../../src/core/pack';
import { isoFromFields, toIsoSeconds } from '../../src/core/time';
import { loadPack } from '../helpers/harness';
import { KIT, TestServer } from '../helpers/server';

describe('pack', () => {
  test('both kit packs load, and differ only by their data', () => {
    const polly = loadPack('polly');
    const premom = loadPack('premom');
    expect([polly.appName, premom.appName]).toEqual(['Polly', 'Premom']);
    expect(polly.catalog.map((entry) => entry.type)).toEqual(['bbt', 'lh', 'flow']);
    expect(premom.catalog.map((entry) => entry.type)).toEqual(['bbt', 'lh', 'flow', 'mucus']);
    expect(polly.products).toEqual([]);
    expect(premom.products).toEqual([{ productId: 'premium_monthly', entitlement: 'premium' }]);
  });

  test('a malformed pack is refused', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(KIT, 'packs', 'premom.json'), 'utf8'));
    expect(() => parsePack({ ...raw, catalog: [{ type: 'bbt', kind: 'number', sources: ['manual'] }] })).toThrow();
    expect(() => parsePack({ ...raw, catalog: [{ type: 'x', kind: 'enum', values: ['a'], sources: ['telepathy'] }] })).toThrow();
    expect(() => parsePack({ ...raw, packId: undefined })).toThrow();
  });

  test('levelFor picks the highest minRatio at or below the ratio', () => {
    const lh = findEntry(loadPack('premom'), 'lh') as StripEntry;
    expect([0, 0.499, 0.5, 0.501, 0.999, 1, 4.2].map((ratio) => levelFor(lh, ratio))).toEqual(['low', 'low', 'high', 'high', 'high', 'peak', 'peak']);
    const polly = findEntry(loadPack('polly'), 'lh') as StripEntry;
    expect([0, 0.799, 0.8, 3].map((ratio) => levelFor(polly, ratio))).toEqual(['negative', 'negative', 'positive', 'positive']);
    expect(levelFor({ ...lh, levels: [{ level: 'only', minRatio: 0.2 }] }, 0.1)).toBeNull();
  });

  test('value field names come from the entry kind', () => {
    const premom = loadPack('premom');
    expect(premom.catalog.map((entry) => valueField(entry))).toEqual(['celsius', 'ratio', 'code', 'code']);
  });
});

describe('display rules', () => {
  const premom = loadPack('premom');
  const polly = loadPack('polly');
  test('numeric: null never shows the ratio; an entitlement gate shows it only while active', () => {
    expect(displayFor(polly, 'lh', { ratio: 0.9 }, ['premium'])).toEqual({ level: 'positive', ratio: null, locked: false });
    expect(displayFor(premom, 'lh', { ratio: 0.689 }, [])).toEqual({ level: 'high', ratio: null, locked: true });
    expect(displayFor(premom, 'lh', { ratio: 0.689 }, ['something_else'])).toEqual({ level: 'high', ratio: null, locked: true });
    expect(displayFor(premom, 'lh', { ratio: 0.689 }, ['premium'])).toEqual({ level: 'high', ratio: 0.689, locked: false });
  });
  test('other types display their stored value object', () => {
    expect(displayFor(premom, 'bbt', { celsius: 36.5 }, [])).toEqual({ celsius: 36.5 });
    expect(displayFor(premom, 'flow', { code: 'light' }, [])).toEqual({ code: 'light' });
  });
});

describe('value checks', () => {
  const premom = loadPack('premom');
  test('strip ratios are rounded to 3 decimals, temperatures to 2', () => {
    expect(checkValue(findEntry(premom, 'lh')!, { ratio: 0.68949 })).toEqual({ ok: true, value: { ratio: 0.689 } });
    expect(checkValue(findEntry(premom, 'bbt')!, { celsius: 36.666 })).toEqual({ ok: true, value: { celsius: 36.67 } });
    expect(roundTo(0.23427169528878525, 3)).toBe(0.234);
    expect(roundTo(36.5555, 2)).toBe(36.56);
  });
});

describe('time', () => {
  test('canonical timestamps have second precision and no milliseconds', () => {
    expect(toIsoSeconds(new Date('2026-11-03T06:45:00.789Z'))).toBe('2026-11-03T06:45:00Z');
    expect(toIsoSeconds(new Date(Date.UTC(2026, 0, 5, 7, 8, 9)))).toBe('2026-01-05T07:08:09Z');
  });
  test('isoFromFields pads fields and refuses impossible dates', () => {
    expect(isoFromFields(2026, 1, 2, 3, 4, 5)).toBe('2026-01-02T03:04:05Z');
    expect(isoFromFields(2026, 2, 30, 0, 0, 0)).toBeNull();
    expect(isoFromFields(2026, 0, 1, 0, 0, 0)).toBeNull();
    expect(isoFromFields(2026, 1, 1, 24, 0, 0)).toBeNull();
  });
});

describe('bytes', () => {
  test('hex and base64 decode to the same bytes', () => {
    expect(Array.from(hexToBytes('00540e00fe'))).toEqual([0, 0x54, 0x0e, 0, 0xfe]);
    for (const length of [0, 1, 2, 3, 4, 5, 13]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 250) & 0xff);
      expect(Array.from(base64ToBytes(Buffer.from(bytes).toString('base64')))).toEqual(Array.from(bytes));
    }
    expect(Array.from(base64ToBytes('AFQOAP4='))).toEqual([0, 0x54, 0x0e, 0, 0xfe]);
  });
});

describe('images', () => {
  test('parsePgm reads size and pixels, with comments and any header whitespace', () => {
    const pixels = [1, 2, 3, 4, 5, 6];
    const file = Buffer.concat([Buffer.from('P5\n# a comment\n3 2\n255\n'), Buffer.from(pixels)]);
    expect(parsePgm(new Uint8Array(file))).toEqual({ width: 3, height: 2, gray: Uint8Array.from(pixels) });
    // pixel bytes that look like whitespace must not be skipped
    const tricky = Buffer.concat([Buffer.from('P5 2 1 255\n'), Buffer.from([0x0a, 0x20])]);
    expect(Array.from(parsePgm(new Uint8Array(tricky)).gray)).toEqual([0x0a, 0x20]);
  });

  test('parsePgm refuses other formats and truncated files', () => {
    expect(() => parsePgm(new Uint8Array(Buffer.from('P2\n1 1\n255\n0')))).toThrow();
    expect(() => parsePgm(new Uint8Array(Buffer.from('P5\n4 4\n255\nabc')))).toThrow();
    expect(() => parsePgm(new Uint8Array(Buffer.from('P5\n1 1\n65535\nab')))).toThrow();
  });

  test('toGray keeps gray pixels and weights RGB as luma', () => {
    expect(Array.from(toGray(Uint8Array.from([10, 200]), 2, 1, 1).gray)).toEqual([10, 200]);
    expect(Array.from(toGray(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 90, 90, 90, 255]), 4, 1, 4).gray)).toEqual([76, 150, 29, 90]);
    expect(() => toGray(new Uint8Array(3), 2, 2, 1)).toThrow();
  });

  test('a PNG round trip of a strip gives the engine the same picture', () => {
    const gray = Uint8Array.from({ length: 50 * 10 }, (_, i) => (i * 7) % 256);
    const rgba = new Uint8Array(gray.length * 4);
    gray.forEach((value, i) => rgba.set([value, value, value, 255], i * 4));
    const png = encode({ width: 50, height: 10, data: rgba, channels: 4, depth: 8 });
    const image = pngToGray(png);
    expect([image.width, image.height]).toEqual([50, 10]);
    expect(Array.from(image.gray)).toEqual(Array.from(gray));
    const rgb = encode({ width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 0, 0, 255]), channels: 3, depth: 8 });
    expect(Array.from(pngToGray(rgb).gray)).toEqual([76, 29]);
  });
});

describe('FetchHttp against the kit server', () => {
  const server = new TestServer();
  beforeAll(async () => { await server.start(); await server.reset(); });
  afterAll(() => server.stop());

  test('sends the bearer token and JSON, returns status and body', async () => {
    const http = new FetchHttp(server.url, 'test-token');
    expect(await http.send({ method: 'GET', path: '/v1/sync/pull?since=0' })).toEqual({ kind: 'response', status: 200, json: { changes: [], cursor: 0 } });
    expect(await new FetchHttp(server.url, 'wrong').send({ method: 'GET', path: '/v1/sync/pull?since=0' })).toMatchObject({ kind: 'response', status: 401 });
    expect(await http.send({ method: 'POST', path: '/v1/events', body: { name: 'observation_logged', props: { type: 'bbt', source: 'manual', pack: 'p' } } })).toMatchObject({ status: 202 });
  });

  test('a dropped connection is "unreachable"; a 503 is a response', async () => {
    const http = new FetchHttp(server.url, 'test-token');
    await server.control({ mode: 'down' });
    expect(await http.send({ method: 'GET', path: '/v1/sync/pull?since=0' })).toEqual({ kind: 'unreachable' });
    await server.control({ mode: 'http503' });
    expect(await http.send({ method: 'GET', path: '/v1/sync/pull?since=0' })).toMatchObject({ kind: 'response', status: 503 });
    await server.control({ mode: 'ok' });
  });

  test('a request that takes longer than the timeout is "unreachable"', async () => {
    const hanging: typeof fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await new FetchHttp('http://x', 't', 20, hanging).send({ method: 'GET', path: '/' })).toEqual({ kind: 'unreachable' });
  });
});
