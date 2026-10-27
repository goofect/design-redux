// The layers docs/architecture.md draws: no new use across them, and none
// listed in tests/snapshots/layers.json that's since gone — the list only
// shrinks. `node tests/map.js --check` says which; `--check --update`
// rewrites the list after a deliberate change.
const path = require('path');
const { spawnSync } = require('child_process');

// And Obsidian's canvas reached into only through the adapter, the modules
// that still do it themselves only ever fewer (--internals); and what other
// code relies on, as contracts/contracts.json says (--contracts).
let passed = 0;
['--check', '--internals', '--contracts'].forEach((mode) => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'map.js'), mode], { encoding: 'utf8' });
  if (run.status !== 0) {
    console.error(run.stdout + run.stderr);
    process.exit(1);
  }
  console.log(`  ok  ${run.stdout.trim()}`);
  passed++;
});
console.log(`\n${passed} passed`);
