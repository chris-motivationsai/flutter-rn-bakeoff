// Neutral judge. Usage: node kit/judge/judge.ts <stackDir> <scenarioDir> [--out file.json] [S01 S02 ...]
// For each scenario: resets the server, runs <stackDir>/run-scenario.sh <scenario.json> <serverUrl> <out.json> <workDir>,
// then compares the app's reported step results and snapshots, and the server's final state, with the expected values.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [stackDir, scenarioDir, ...only] = args;
if (!stackDir || !scenarioDir) { console.error('usage: judge.ts <stackDir> <scenarioDir> [--out file] [ids]'); process.exit(2); }
const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  const keys = new Set([...Object.keys(exp), ...Object.keys(act).filter(k => act[k] !== undefined)]);
  for (const k of keys) { const d = diff(exp[k] === undefined ? undefined : exp[k], act[k], `${path}.${k}`); if (d) return d; }
  return null;
}
const key = (o: any) => `${o.type}|${o.observedAt}`;

const srv = spawn('node', [join(kit, 'server/server.ts')], { stdio: ['ignore', 'pipe', 'inherit'] });
const port: number = await new Promise(ok => srv.stdout.on('data', d => { const m = /LISTENING (\d+)/.exec(String(d)); if (m) ok(Number(m[1])); }));
const url = `http://127.0.0.1:${port}`;
const ids = readdirSync(scenarioDir).filter(f => /^S\d+\.json$/.test(f)).map(f => f.replace('.json', '')).filter(id => !only.length || only.includes(id)).sort();
const report: any[] = [];
for (const id of ids) {
  const file = resolve(scenarioDir, `${id}.json`);
  const sc = JSON.parse(readFileSync(file, 'utf8'));
  await fetch(`${url}/__control`, { method: 'POST', body: JSON.stringify({ reset: { user: sc.user } }) });
  const work = mkdtempSync(join(tmpdir(), `bakeoff-${id}-`));
  const out = join(work, 'out.json');
  const appDir = join(work, 'app'); spawnSync('mkdir', ['-p', appDir]);
  const t0 = Date.now();
  const run = spawnSync(join(resolve(stackDir), 'run-scenario.sh'), [file, url, out, appDir], { timeout: 300000, encoding: 'utf8', cwd: resolve(stackDir) });
  const ms = Date.now() - t0;
  const fails: string[] = []; let checks = 0;
  const check = (d: string | null) => { checks++; if (d) fails.push(d); };
  let res: any = null;
  if (run.status !== 0 || !existsSync(out)) fails.push(`runner failed (exit ${run.status}${run.signal ? ', ' + run.signal : ''}): ${(run.stderr || run.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`);
  else { try { res = JSON.parse(readFileSync(out, 'utf8')); } catch { fails.push('out.json is not valid JSON'); } }
  const E = sc.expect;
  for (let i = 0; i < E.steps.length; i++) check(res ? diff(E.steps[i], res.steps?.[i], `step[${i}] ${sc.steps[i].do}`) : 'no result');
  for (const name of Object.keys(E.snapshots)) check(res ? diff(E.snapshots[name], res.snapshots?.[name], `snapshot.${name}`) : 'no result');
  const state: any = await (await fetch(`${url}/__control/state`)).json();
  const live = state.observations.filter((o: any) => !o.deleted).map((o: any) => ({ type: o.type, observedAt: o.observedAt, value: o.value, source: o.source, ...(o.reader && Object.keys(o.reader).length ? { reader: o.reader } : {}) })).sort((a: any, b: any) => key(a).localeCompare(key(b)));
  const deleted = state.observations.filter((o: any) => o.deleted).map((o: any) => ({ type: o.type, observedAt: o.observedAt })).sort((a: any, b: any) => key(a).localeCompare(key(b)));
  check(diff(E.server.observations, live, 'server.observations'));
  check(diff(E.server.deleted, deleted, 'server.deleted'));
  check(diff(E.server.events, state.events, 'server.analyticsEvents'));
  check(state.violations.length ? `analytics gate violated ${state.violations.length}x, e.g. ${state.violations[0]}` : null);
  check(state.oversize ? `sent ${state.oversize} push request(s) with more than 20 mutations` : null);
  check(state.rejected.length ? `server rejected ${state.rejected.length} mutation(s): ${[...new Set(state.rejected)].join(', ')}` : null);
  const pass = fails.length === 0;
  report.push({ id, title: sc.title, pass, checks, failed: fails.length, ms, fails: fails.slice(0, 8) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${sc.title} (${checks - Math.min(fails.length, checks)}/${checks} checks, ${ms} ms)`);
  for (const f of fails.slice(0, 4)) console.log(`     - ${f}`);
}
srv.kill();
const passed = report.filter(r => r.pass).length;
console.log(`\n${passed}/${report.length} scenarios passed`);
if (outFile) writeFileSync(outFile, JSON.stringify({ stackDir, scenarioDir, passed, total: report.length, scenarios: report }, null, 1));
process.exit(passed === report.length ? 0 : 1);
