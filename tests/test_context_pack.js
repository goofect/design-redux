// tools/context-pack.mjs: a task's context in one bounded packet, built from
// tests/map.js --json. The same sections in the same order every time, the
// same packet twice, cut to the budget with the cuts reported, and an unknown
// feature or file refused with names that come close.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pack = (...args) => spawnSync(process.execPath, [path.join(root, 'tools', 'context-pack.mjs'), ...args], { encoding: 'utf8', cwd: root });
const SECTIONS = ['Objective and ownership', 'Invariants', 'Tests', 'Relevant definitions', 'Caller/callee map', 'CSS map', 'Missing evidence', 'Budget report'];

let passed = 0;
function test(name, fn) {
  try {
    fn();
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
const estimate = (out) => Number((out.match(/this packet about (\d+)/) || [])[1]);

test('map.js --json lists every module, with what it declares and uses', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'map.js'), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert(run.status === 0, run.stderr);
  const { pieces, areas } = JSON.parse(run.stdout);
  const modules = fs.readdirSync(path.join(root, 'src')).filter((d) => fs.statSync(path.join(root, 'src', d)).isDirectory()).flatMap((d) => fs.readdirSync(path.join(root, 'src', d)).filter((f) => f.endsWith('.js')));
  assert(pieces.length === modules.length, `${pieces.length} pieces for ${modules.length} modules`);
  const panel = pieces.find((p) => p.name === '180-panel');
  assert(panel && panel.declared.PropertiesPanel && panel.file === 'src/note/180-panel.js', 'PropertiesPanel is declared in 180-panel');
  assert(Object.values(panel.uses).some((u) => u.from === '178-inspectables'), 'uses name where they come from');
  assert(areas.some((a) => a.name === 'core' && a.level === 0), 'areas come with their layer');
});

test('a packet has every section, in order, and is the same twice', () => {
  const a = pack('--feature', 'PropertiesPanel');
  const b = pack('--feature', 'PropertiesPanel');
  assert(a.status === 0, a.stderr);
  assert(a.stdout === b.stdout, 'two runs differ');
  const titles = a.stdout.match(/^## .+$/gm).map((l) => l.slice(3));
  assert(JSON.stringify(titles) === JSON.stringify(SECTIONS), `sections: ${titles.join(' | ')}`);
  assert(/pieces: 180-panel\b/.test(a.stdout), 'an exact class name picks its piece');
  assert(/plugin\.coordinator/.test(a.stdout) && /tests\/test_mobile\.js/.test(a.stdout), 'invariants and suites are named');
  assert(!/test_context_pack/.test(a.stdout), 'this suite is not offered as a test of the piece');
});

test('json gives the same sections', () => {
  const run = pack('--files', 'src/library/122-browse-editing.js', '--format', 'json');
  assert(run.status === 0, run.stderr);
  const data = JSON.parse(run.stdout);
  assert(JSON.stringify(data.pieces) === '["122-browse-editing"]', `pieces: ${data.pieces}`);
  assert(JSON.stringify(data.sections.map((s) => s.title)) === JSON.stringify(SECTIONS), 'sections');
});

test('a tight budget cuts the long sections and says so', () => {
  const roomy = pack('--files', '122', '--budget', '20000');
  assert(/nothing left out/.test(roomy.stdout), 'nothing cut under a roomy budget');
  const tight = pack('--files', '122', '--budget', '900');
  assert(tight.status === 0, tight.stderr);
  assert(estimate(tight.stdout) <= 900, `about ${estimate(tight.stdout)} tokens for a budget of 900`);
  assert(/lines left out/.test(tight.stdout), 'the cut is reported');
  assert(/## Invariants\n- /.test(tight.stdout) && /## Tests\n- /.test(tight.stdout), 'invariants and tests are never cut');
  const tiny = pack('--files', '122', '--budget', '50');
  assert(/over budget even so/.test(tiny.stdout), 'a budget too small to meet is reported');
});

test('no whole file goes into a packet', () => {
  const run = pack('--files', '122');
  const source = fs.readFileSync(path.join(root, 'src', 'library', '122-browse-editing.js'), 'utf8');
  assert(run.stdout.length < source.length / 3, `${run.stdout.length} characters for a ${source.length}-character file`);
});

test('an unknown feature or file fails with names that come close', () => {
  const feature = pack('--feature', 'inspektor');
  assert(feature.status === 1 && !feature.stdout, 'refused, nothing printed');
  assert(/near: .*178-inspectables/.test(feature.stderr), feature.stderr);
  const file = pack('--files', 'src/library/122-browse-editin.js');
  assert(file.status === 1 && /near: 122-browse-editing/.test(file.stderr), file.stderr);
  assert(pack().status === 0 && /--budget/.test(pack().stdout), 'no arguments: the help');
});

console.log(`\n${passed} passed`);
