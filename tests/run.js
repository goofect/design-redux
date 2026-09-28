// Runs every suite in this folder, one after another, and fails if any does.
// These are simulations: Obsidian is stood in for, CodeMirror and the DOM are real.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const only = process.argv.slice(2);
const suites = fs
  .readdirSync(__dirname)
  .filter((f) => /^test_.*\.js$/.test(f))
  .filter((f) => !only.length || only.some((o) => f.includes(o)))
  .sort();

let failed = 0;
for (const suite of suites) {
  const run = spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
  const lines = (run.stdout + run.stderr).trim().split('\n');
  const ok = run.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${suite.padEnd(20)} ${lines[lines.length - 1]}`);
  if (!ok) console.log(lines.filter((l) => !/^\s+ok\s/.test(l)).slice(0, 30).join('\n'));
}
console.log(`\n${suites.length - failed} of ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
