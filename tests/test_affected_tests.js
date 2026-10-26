// tools/affected-tests.mjs: from changed files to the suites they need, each
// with its reason. Never nothing without saying why; the unknown, the build
// and a deleted module take every suite.
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'tools', 'affected-tests.mjs'), ...args], { encoding: 'utf8', cwd: root });

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}\n${err.stack}`);
    process.exit(1);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const { affected } = await import(path.join(root, 'tools', 'affected-tests.mjs'));
  const pick = (...files) => [...affected(files).suites.keys()];
  const total = require('fs').readdirSync(__dirname).filter((f) => /^test_.*\.js$/.test(f)).length;

  await test('a feature module: the suites naming it, and lifecycle and layers', () => {
    const s = pick('src/note/180-panel.js');
    assert(['mobile', 'lifecycle', 'layers'].every((x) => s.includes(x)) && s.length < total / 2, s.join(' '));
  });

  await test('a class written in parts reaches the suites naming its last part', () => {
    const s = pick('src/library/122-browse-editing.js');
    assert(s.includes('album') && s.length < total, s.join(' '));
  });

  await test('a core module reaches far', () => {
    assert(pick('src/core/073-notes.js').length >= total / 2, 'core takes most suites');
  });

  await test('every src module leads somewhere', () => {
    const fs = require('fs');
    fs.readdirSync(path.join(root, 'src'))
      .filter((d) => fs.statSync(path.join(root, 'src', d)).isDirectory())
      .forEach((d) =>
        fs.readdirSync(path.join(root, 'src', d)).forEach((f) => {
          const s = pick(`src/${d}/${f}`);
          assert(s.some((x) => !['lifecycle', 'layers'].includes(x)), `src/${d}/${f} gives only ${s.join(' ')}`);
        })
      );
  });

  await test('a style part: the styles lint and the suites of the code making its classes', () => {
    const s = pick('styles/34-bulk-edits.css');
    assert(s.includes('styles') && s.includes('bulk') && s.length < total, s.join(' '));
  });

  await test('suites, tools and helpers', () => {
    assert(pick('tests/test_tree.js').join() === 'tree', 'a suite is itself');
    const tools = pick('tools/css-owners.mjs');
    assert(tools.includes('css_owners') && tools.includes('context_pack'), tools.join(' '));
    assert(pick('tests/snapshots/lifecycle.json').includes('lifecycle'), 'a snapshot, its readers');
  });

  await test('the build, the unknown and a deleted module: every suite', () => {
    ['build.mjs', 'package.json', 'tests/map.js', 'src/library/999-gone.js', 'something/else.txt'].forEach((f) => assert(pick(f).length === total, `${f}: ${pick(f).length}`));
  });

  await test('notes alone: no suite, and it says why', () => {
    const run = cli('--changed', 'README.md', 'docs/architecture.md');
    assert(run.status === 0 && /no simulation suite for 2 changed files: README\.md \(notes/.test(run.stdout), run.stdout);
  });

  await test('the command line prints the suites, their reasons and the command', () => {
    const run = cli('--changed', 'src/note/180-panel.js', '--explain');
    assert(run.status === 0, run.stderr);
    assert(/ {2}mobile: names what 180-panel declares/.test(run.stdout), run.stdout);
    assert(/^node tests\/run\.js .*test_mobile\.js/m.test(run.stdout), 'the command to run them');
    assert(cli('--base', 'HEAD').status === 0, '--base works');
  });

  console.log(`\n${passed} passed`);
})();
