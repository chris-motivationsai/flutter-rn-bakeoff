// Host side of the on-device test. Usage: node device-test/host.ts <kitServerPort> <outFile> [engine-only | S01 S02 ...]
// Serves the job (fixtures + public scenarios, files inlined) to the app on the emulator, receives its
// results, and compares: engine results with kit/engine/build/strip_cli, scenario outputs and the kit
// server's state with each scenario's `expect` (same checks as kit/judge/judge.ts, whose diff() is copied
// here because judge.ts cannot be imported without running it).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [kitPort, outFile, mode, ...moreIds] = process.argv.slice(2);
const only = mode && mode !== 'engine-only' ? [mode, ...moreIds] : [];
const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'kit');
const kitUrl = `http://127.0.0.1:${kitPort}`;
const stripDir = join(kit, 'scenarios', 'fixtures', 'strips');
const fixtureNames = readdirSync(stripDir).filter((f) => f.endsWith('.pgm')).sort();
// DEVICE_TEST_SCENARIOS: another folder of scenario files (fixture paths still resolve inside the kit).
const scenarioDir = process.env.DEVICE_TEST_SCENARIOS ?? join(kit, 'scenarios');
const scenarioIds = mode === 'engine-only' ? [] : readdirSync(scenarioDir).filter((f) => /^S\d+\.json$/.test(f) && (!only.length || only.includes(f.replace('.json', '')))).sort();
const scenarios = new Map<string, any>(scenarioIds.map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(scenarioDir, f), 'utf8'))]));

function diff(exp: any, act: any, path = ''): string | null {
  if (typeof exp === 'number' && typeof act === 'number') return Math.abs(exp - act) < 1e-9 ? null : `${path}: expected ${exp}, got ${act}`;
  if (exp === null || typeof exp !== 'object') return exp === act ? null : `${path}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`;
  if (act === null || typeof act !== 'object') return `${path}: expected ${JSON.stringify(exp).slice(0, 80)}, got ${JSON.stringify(act)}`;
  if (Array.isArray(exp)) {
    if (!Array.isArray(act)) return `${path}: expected an array`;
    if (exp.length !== act.length) return `${path}: expected ${exp.length} items, got ${act.length}`;
    for (let i = 0; i < exp.length; i++) { const d = diff(exp[i], act[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  const keys = new Set([...Object.keys(exp), ...Object.keys(act).filter((k) => act[k] !== undefined)]);
  for (const k of keys) { const d = diff(exp[k] === undefined ? undefined : exp[k], act[k], `${path}.${k}`); if (d) return d; }
  return null;
}
const key = (o: any) => `${o.type}|${o.observedAt}`;

function job() {
  return {
    serverUrl: `http://10.0.2.2:${kitPort}`,
    fixtures: fixtureNames.map((name) => ({ name, base64: readFileSync(join(stripDir, name)).toString('base64') })),
    scenarios: [...scenarios].map(([id, sc]) => ({
      id,
      packJson: JSON.parse(readFileSync(join(kit, 'packs', `${sc.pack}.json`), 'utf8')),
      steps: sc.steps.map((step: any) => ({
        ...step,
        ...(step.image ? { imageBase64: readFileSync(join(kit, 'scenarios', step.image)).toString('base64') } : {}),
        ...(step.script ? { scriptJson: JSON.parse(readFileSync(join(kit, 'scenarios', step.script), 'utf8')) } : {}),
      })),
    })),
  };
}

const report: any = { engine: null, scenarios: [], finished: null };

function judgeEngine(body: any) {
  const rows = body.results.map((r: any) => {
    const [status, ratio] = execFileSync(join(kit, 'engine', 'build', 'strip_cli'), [join(stripDir, r.name)], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
    return { name: r.name, device: { status: r.status, ratio: r.ratio, error: r.error }, host: { status, ratio },
      statusEqual: r.status === status, bitIdentical: r.status === status && Object.is(r.ratio, ratio), absDiff: typeof r.ratio === 'number' ? Math.abs(r.ratio - ratio) : null, ms: r.ms };
  });
  report.engine = {
    deviceVersion: body.version, fixtures: rows.length,
    statusEqual: rows.filter((r: any) => r.statusEqual).length,
    bitIdentical: rows.filter((r: any) => r.bitIdentical).length,
    maxAbsDiff: Math.max(0, ...rows.map((r: any) => r.absDiff ?? Infinity)),
    rows,
  };
  console.log(`ENGINE version=${body.version} fixtures=${rows.length} statusEqual=${report.engine.statusEqual} bitIdentical=${report.engine.bitIdentical} maxAbsDiff=${report.engine.maxAbsDiff}`);
}

async function judgeScenario(body: any) {
  const sc = scenarios.get(body.id);
  const res = body.output ?? null;
  const fails: string[] = []; let checks = 0;
  const check = (d: string | null) => { checks++; if (d) fails.push(d); };
  if (!res) fails.push(`device runner failed: ${body.error}`);
  const E = sc.expect;
  for (let i = 0; i < E.steps.length; i++) check(res ? diff(E.steps[i], res.steps?.[i], `step[${i}] ${sc.steps[i].do}`) : 'no result');
  for (const name of Object.keys(E.snapshots)) check(res ? diff(E.snapshots[name], res.snapshots?.[name], `snapshot.${name}`) : 'no result');
  const state: any = await (await fetch(`${kitUrl}/__control/state`)).json();
  const live = state.observations.filter((o: any) => !o.deleted).map((o: any) => ({ type: o.type, observedAt: o.observedAt, value: o.value, source: o.source, ...(o.reader && Object.keys(o.reader).length ? { reader: o.reader } : {}) })).sort((a: any, b: any) => key(a).localeCompare(key(b)));
  const deleted = state.observations.filter((o: any) => o.deleted).map((o: any) => ({ type: o.type, observedAt: o.observedAt })).sort((a: any, b: any) => key(a).localeCompare(key(b)));
  check(diff(E.server.observations, live, 'server.observations'));
  check(diff(E.server.deleted, deleted, 'server.deleted'));
  check(diff(E.server.events, state.events, 'server.analyticsEvents'));
  check(state.violations.length ? `analytics gate violated ${state.violations.length}x` : null);
  check(state.oversize ? `sent ${state.oversize} oversize push request(s)` : null);
  check(state.rejected.length ? `server rejected ${state.rejected.length} mutation(s): ${[...new Set(state.rejected)].join(', ')}` : null);
  const pass = fails.length === 0;
  report.scenarios.push({ id: body.id, title: sc.title, pack: sc.pack, pass, checks, fails, pushRequests: state.pushRequests });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${body.id} ${sc.title} (${checks - Math.min(fails.length, checks)}/${checks} checks, ${state.pushRequests} push requests)`);
  for (const f of fails.slice(0, 4)) console.log(`     - ${f}`);
}

const server = createServer(async (req, res) => {
  let data = '';
  for await (const chunk of req) data += chunk;
  const body = data ? JSON.parse(data) : {};
  const send = (value: unknown) => { const s = JSON.stringify(value); res.writeHead(200, { 'content-type': 'application/json' }); res.end(s); };
  try {
    if (req.url === '/job') return send(job());
    if (req.url === '/engine') { judgeEngine(body); return send({ ok: true }); }
    if (req.url === '/scenario-start') {
      await fetch(`${kitUrl}/__control`, { method: 'POST', body: JSON.stringify({ reset: { user: scenarios.get(body.id).user } }) });
      return send({ ok: true });
    }
    if (req.url === '/scenario-done') { await judgeScenario(body); return send({ ok: true }); }
    if (req.url === '/finished') {
      report.finished = body;
      writeFileSync(outFile, JSON.stringify(report, null, 1));
      const passed = report.scenarios.filter((s: any) => s.pass).length;
      console.log(`FINISHED ${passed}/${report.scenarios.length} scenarios passed${body.error ? ` (device error: ${body.error})` : ''}`);
      send({ ok: true });
      setTimeout(() => process.exit(0), 200);
      return;
    }
    res.writeHead(404); res.end();
  } catch (error) {
    console.log('host error', error);
    res.writeHead(500); res.end(String(error));
  }
});
server.listen(8799, '127.0.0.1', () => console.log('HOST LISTENING 8799'));
