// The layers docs/architecture.md draws: no new use across them, and none
// listed in tests/snapshots/layers.json that's since gone — the list only
// shrinks. `node tests/map.js --check` says which; `--check --update`
// rewrites the list after a deliberate change.
const path = require('path');
const { spawnSync } = require('child_process');

const run = spawnSync(process.execPath, [path.join(__dirname, 'map.js'), '--check'], { encoding: 'utf8' });
if (run.status !== 0) {
  console.error(run.stdout + run.stderr);
  process.exit(1);
}
console.log(`  ok  ${run.stdout.trim()}`);
console.log('\n1 passed');
