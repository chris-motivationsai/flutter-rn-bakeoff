import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadNodeStripEngine } from '../../src/adapters/fake/nodeStripEngine';
import { parsePgm } from '../../src/core/image';
import { createHarness, flatImage, loadPack, receipt, stripImage } from '../helpers/harness';
import { KIT, PROJECT_ROOT } from '../helpers/server';
import { OK, USER, err, appSuite } from '../helpers/suite';

const ctx = appSuite('premom');
const T = '2026-11-03T14:00:00Z';
const engine = loadNodeStripEngine(PROJECT_ROOT);

describe('C++ engine binding', () => {
  test('reports the engine version', () => {
    expect(engine.version()).toBe('bakeoff-1.0.0');
  });

  test('agrees with the kit CLI on every strip fixture', () => {
    // Build the kit's own CLI from the kit sources (no bridge, no addon) as the independent reference.
    const cli = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'strip-cli-')), 'strip_cli');
    const engineDir = path.join(KIT, 'engine');
    execFileSync('clang++', ['-std=c++17', '-O2', path.join(engineDir, 'strip_engine.cpp'), path.join(engineDir, 'strip_cli.cpp'), '-o', cli]);
    const dir = path.join(KIT, 'scenarios', 'fixtures', 'strips');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.pgm'));
    expect(files.length).toBeGreaterThan(50);
    for (const name of files) {
      const file = path.join(dir, name);
      const [status, ratio] = execFileSync(cli, [file], { encoding: 'utf8' }).trim().split(' ').map(Number);
      const image = parsePgm(new Uint8Array(fs.readFileSync(file)));
      const read = engine.read(image.gray, image.width, image.height);
      expect([name, read.status]).toEqual([name, status]);
      if (status === 0) expect(read.ratio).toBeCloseTo(ratio, 12);
    }
  });

  test('a synthetic strip reads as test depth / control depth', () => {
    const image = stripImage(100, 25);
    expect(engine.read(image.gray, image.width, image.height)).toEqual({ status: 0, ratio: 0.25 });
  });

  test('refuses a buffer whose length does not match the size instead of reading past it', () => {
    expect(engine.read(new Uint8Array(10), 200, 20).status).toBe(4);
  });
});

describe('scan strip', () => {
  test('creates an lh observation: ratio to 3 decimals, engine version as reader', async () => {
    const { h, server } = ctx;
    expect(await h.scan(T, stripImage(90, 30))).toEqual(OK); // 1/3
    expect(await h.scan('2026-11-04T14:00:00Z', stripImage(90, 60))).toEqual(OK); // 2/3
    await h.app.sync();
    expect(await server.live()).toMatchObject([
      { type: 'lh', observedAt: T, source: 'strip_reader', value: { ratio: 0.333 }, reader: { engineVersion: 'bakeoff-1.0.0' } },
      { type: 'lh', observedAt: '2026-11-04T14:00:00Z', value: { ratio: 0.667 } },
    ]);
    expect((await server.live())[0].reader).toEqual({ engineVersion: 'bakeoff-1.0.0' });
    expect((await server.state()).rejected).toEqual([]);
    expect(h.http.to('/v1/events')[0].request.body).toEqual({ name: 'observation_logged', props: { type: 'lh', source: 'strip_reader', pack: 'premom' } });
  });

  test.each([
    ['no control line', stripImage(5, 60), 'strip_no_control_line'],
    ['too dark', flatImage(20), 'strip_too_dark'],
    ['too bright', flatImage(250), 'strip_too_bright'],
  ])('a failed read (%s) is an error and creates nothing', async (_name, image, code) => {
    const { h, server } = ctx;
    expect(await h.scan(T, image)).toEqual(err(code));
    const snapshot = h.app.snapshot();
    expect(snapshot.observations).toEqual([]);
    expect(snapshot.pendingMutations).toBe(0);
    expect((await server.state()).events).toBe(0);
  });

  test('type and source are checked against the pack before the camera is used', async () => {
    const { h } = ctx;
    expect(await h.scan(T, stripImage(100, 50), 'ketones')).toEqual(err('unknown_type'));
    expect(h.camera.next).not.toBeNull(); // never captured
    expect(await h.scan(T, stripImage(100, 50), 'mucus')).toEqual(err('source_not_allowed'));
    expect(h.app.snapshot().observations).toEqual([]);
  });
});

describe('strip display', () => {
  const displays = (h: { app: { snapshot(): { observations: { display: unknown }[] } } }) => h.app.snapshot().observations.map((o) => o.display);

  test('Premom without premium: the level from the pack, number locked', async () => {
    const { h } = ctx;
    await h.scan('2026-11-01T14:00:00Z', stripImage(100, 20)); // 0.2
    await h.scan('2026-11-02T14:00:00Z', stripImage(100, 50)); // exactly 0.5: the boundary belongs to "high"
    await h.scan('2026-11-03T14:00:00Z', stripImage(100, 99)); // 0.99
    await h.scan('2026-11-04T14:00:00Z', stripImage(100, 100)); // exactly 1.0: "peak"
    await h.scan('2026-11-05T14:00:00Z', stripImage(50, 100)); // 2.0
    expect(displays(h)).toEqual([
      { level: 'low', ratio: null, locked: true },
      { level: 'high', ratio: null, locked: true },
      { level: 'high', ratio: null, locked: true },
      { level: 'peak', ratio: null, locked: true },
      { level: 'peak', ratio: null, locked: true },
    ]);
  });

  test('Polly: its own level names, never a number, never locked', async () => {
    const polly = createHarness(ctx.server.url, 'polly');
    try {
      await polly.scan('2026-11-01T14:00:00Z', stripImage(100, 79));
      await polly.scan('2026-11-02T14:00:00Z', stripImage(100, 80));
      await polly.scan('2026-11-03T14:00:00Z', stripImage(100, 0));
      expect(displays(polly)).toEqual([
        { level: 'negative', ratio: null, locked: false },
        { level: 'positive', ratio: null, locked: false },
        { level: 'negative', ratio: null, locked: false },
      ]);
    } finally {
      polly.dispose();
    }
  });

  test('with the entitlement the number shows; the level is computed, not stored', async () => {
    const { h, server } = ctx;
    await h.scan(T, stripImage(90, 60));
    h.store.purchaseScript = [{ event: 'purchased', txId: 'tx-1', receipt: receipt({ txId: 'tx-1', userId: USER, expiresAt: '2026-12-03T14:00:00Z' }) }];
    expect(await h.at('2026-11-03T14:01:00Z').app.purchase('premium_monthly')).toEqual(OK);
    expect(displays(h)).toEqual([{ level: 'high', ratio: 0.667, locked: false }]);
    await h.app.sync();
    expect((await server.live())[0].value).toEqual({ ratio: 0.667 }); // no level on the wire
  });

  test('a pack decides the levels: unsorted levels still pick the highest minRatio at or below the ratio', async () => {
    const pack = loadPack('premom');
    const lh = pack.catalog.find((entry) => entry.type === 'lh')!;
    if (lh.kind !== 'strip') throw new Error('expected a strip entry');
    lh.levels = [{ level: 'surge', minRatio: 0.7 }, { level: 'none', minRatio: 0 }, { level: 'rising', minRatio: 0.3 }];
    const custom = createHarness(ctx.server.url, 'premom', pack);
    try {
      await custom.scan('2026-11-01T14:00:00Z', stripImage(100, 10));
      await custom.scan('2026-11-02T14:00:00Z', stripImage(100, 30));
      await custom.scan('2026-11-03T14:00:00Z', stripImage(100, 69));
      await custom.scan('2026-11-04T14:00:00Z', stripImage(100, 70));
      expect(custom.app.snapshot().observations.map((o) => (o.display as { level: string }).level)).toEqual(['none', 'rising', 'rising', 'surge']);
    } finally {
      custom.dispose();
    }
  });
});
