// Golden regression test: replays the kit's 27 public scenarios through the runner's own entry point and
// compares with the expected results that ship in the kit. (The runner itself never sees `expect`: this
// test strips it before calling runScenario.) Skip with SKIP_PUBLIC_SCENARIOS=1 to run only the hand-written tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScenario } from '../../src/runner/main';
import { KIT, PROJECT_ROOT, TestServer } from '../helpers/server';

const dir = path.join(KIT, 'scenarios');
const files = fs.readdirSync(dir).filter((name) => /^S\d+\.json$/.test(name)).sort();
const server = new TestServer();
beforeAll(() => server.start());
afterAll(() => server.stop());

const suite = process.env.SKIP_PUBLIC_SCENARIOS ? describe.skip : describe;
suite('public kit scenarios', () => {
  test.each(files)('%s', async (name) => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const { expect: expected, ...rest } = raw;
    await server.reset(raw.user);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-golden-'));
    try {
      const out = await runScenario({ scenario: rest, scenarioDir: dir, serverUrl: server.url, workDir, projectRoot: PROJECT_ROOT });
      expect(out.steps).toEqual(expected.steps);
      expect(out.snapshots).toEqual(expected.snapshots);
      const state = await server.state();
      const key = (o: { type: string; observedAt: string }) => `${o.type}|${o.observedAt}`;
      const live = state.observations.filter((o) => !o.deleted)
        .map((o) => ({ type: o.type, observedAt: o.observedAt, value: o.value, source: o.source, ...(o.reader && Object.keys(o.reader).length ? { reader: o.reader } : {}) }))
        .sort((a, b) => key(a).localeCompare(key(b)));
      const deleted = state.observations.filter((o) => o.deleted).map((o) => ({ type: o.type, observedAt: o.observedAt })).sort((a, b) => key(a).localeCompare(key(b)));
      expect(live).toEqual(expected.server.observations);
      expect(deleted).toEqual(expected.server.deleted);
      expect(state.events).toBe(expected.server.events);
      expect([state.violations, state.oversize, state.rejected]).toEqual([[], 0, []]);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
