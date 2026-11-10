// Prints the result file written by device-test/host.ts as Markdown. Exits 1 unless the engine matched the
// host CLI on every fixture and every scenario passed. Usage: node device-test/summary.ts <result.json> [engine-only]
import { existsSync, readFileSync } from 'node:fs';

const [file, mode] = process.argv.slice(2);
if (!file || !existsSync(file)) { console.log(`no result file: ${file}`); process.exit(1); }
const report = JSON.parse(readFileSync(file, 'utf8'));
let ok = true;

const engine = report.engine;
if (!engine) { console.log('Engine: no results.'); ok = false; } else {
  console.log(`Engine (${engine.deviceVersion}): ${engine.fixtures} fixtures, status equal on ${engine.statusEqual}, ratio bit-identical on ${engine.bitIdentical}, max abs difference ${engine.maxAbsDiff}.`);
  if (engine.fixtures === 0 || engine.statusEqual !== engine.fixtures || engine.bitIdentical !== engine.fixtures) ok = false;
  for (const row of engine.rows.filter((r: any) => !r.bitIdentical).slice(0, 10)) console.log(`- ${row.name}: device ${JSON.stringify(row.device)}, host ${JSON.stringify(row.host)}`);
}

if (mode !== 'engine-only') {
  const passed = report.scenarios.filter((s: any) => s.pass).length;
  console.log(`\nScenarios: ${passed} of ${report.scenarios.length} passed.${report.finished ? '' : ' The run did not finish.'}${report.finished?.error ? ` Device error: ${report.finished.error}` : ''}\n`);
  console.log('| Scenario | Pack | Checks passed | Push requests | Result |');
  console.log('|---|---|---|---|---|');
  for (const s of report.scenarios) console.log(`| ${s.id} ${s.title} | ${s.pack} | ${s.checks - Math.min(s.fails.length, s.checks)}/${s.checks} | ${s.pushRequests} | ${s.pass ? 'pass' : 'FAIL'} |`);
  for (const s of report.scenarios.filter((x: any) => !x.pass)) for (const f of s.fails) console.log(`- ${s.id}: ${f}`);
  if (!report.finished || report.finished.error || report.scenarios.length === 0 || passed !== report.scenarios.length) ok = false;
}
process.exit(ok ? 0 : 1);
