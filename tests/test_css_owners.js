// tools/css-owners.mjs: every rule of styles/ with where it's written, its
// specificity and conditions, which class it styles and which it only sits
// inside; queries by selector and component; and the reports. Read-only, and
// the same answer twice.
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'tools', 'css-owners.mjs'), ...args], { encoding: 'utf8', cwd: root, maxBuffer: 64 * 1024 * 1024 });
const lineOf = (file, n) => fs.readFileSync(path.join(root, file), 'utf8').split('\n')[n - 1];

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
  const owners = await import(path.join(root, 'tools', 'css-owners.mjs'));

  await test('specificity: ids, classes and types, :is/:not by their heaviest, :where by nothing', () => {
    const cases = { '.a': [0, 1, 0], '#x .a:hover': [1, 2, 0], 'body.is-mobile .dr-x::before': [0, 2, 2], ':where(.a) .b': [0, 1, 0], ':is(.a, #b) p': [1, 0, 1], ':not(.a.b)': [0, 2, 0], 'a[href]': [0, 1, 1] };
    Object.entries(cases).forEach(([sel, want]) => assert(owners.specificity(sel).join() === want.join(), `${sel}: ${owners.specificity(sel)} not ${want}`));
  });

  await test('every dr- class the stylesheet names is in the index, at the line it is written', () => {
    const styles = owners.loadStyles();
    const indexed = new Set(styles.rules.flatMap((r) => r.selectors.flatMap((s) => s.text.match(/\.dr-[\w-]+/g) || [])));
    const written = new Set();
    styles.parts.forEach((p) => (fs.readFileSync(path.join(root, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(/\.dr-[\w-]+/g) || []).forEach((c) => written.add(c)));
    const missing = [...written].filter((c) => !indexed.has(c));
    assert(!missing.length, `not indexed: ${missing.join(', ')}`);
    styles.rules.slice(0, 400).forEach((r) => r.declarations.forEach((d) => assert(lineOf(r.file, d.line).includes(d.property), `${r.file}:${d.line} is not where ${d.property} is`)));
  });

  await test('.dr-lib-row: the rules that style it, those that only hold it, and who wins', () => {
    const out = run('--selector', '.dr-lib-row', '--explain');
    assert(out.status === 0, out.stderr);
    const [styling, context] = out.stdout.split('as context for something inside it:');
    assert(/styles\/26-library-sidebar\.css:\d+ +\(0,1,0\) +\.dr-lib-row\n/.test(styling), 'the bare rule, with its specificity');
    assert(/\.dr-lib-row:hover +\[@media \(any-hover: hover\)\]/.test(styling), 'conditions shown');
    assert(/\.dr-lib-row \.dr-progress-ring/.test(context) && !/progress-ring/.test(styling), 'a descendant rule is context, not styling');
    assert(/ {2}always:\n(?: {4}.*\n)*? {4}display: flex — styles\/26-library-sidebar\.css:\d+/.test(out.stdout), 'the bare element is a flex row from the sidebar part');
    assert(/in body\.is-mobile:\n(?: {4}.*\n)*? {4}min-height: 44px \(over var\(--dr-row-height\)\)/.test(out.stdout), 'a context variant says what it overrides');
    (styling.match(/styles\/[\w-]+\.css:\d+/g) || []).forEach((w) => {
      const [f, n] = w.split(':');
      assert(lineOf(f, Number(n)).includes('dr-lib-row'), `${w} does not name the class`);
    });
  });

  await test('.dr-props-popup and .dr-bulk-bar: their parts and the code that makes them', () => {
    const popup = run('--selector', '.dr-props-popup');
    assert(/styles\/08-properties-panel\.css:\d+ +\(0,1,0\) +\.dr-props-popup\n/.test(popup.stdout), popup.stdout.slice(0, 300));
    const bar = run('--component', 'bulk-bar');
    assert(bar.status === 0 && /\.dr-bulk-bar\n {2}dressed in: styles\/54-the-brief-and-note-page\.css:/.test(bar.stdout) && /made by: 122-browse-editing/.test(bar.stdout), bar.stdout);
    const method = run('--component', 'renderBulkBar');
    assert(/renderBulkBar at src\/library\/122-browse-editing\.js:\d+-\d+/.test(method.stdout) && /\.dr-bulk-count/.test(method.stdout), method.stdout);
    const view = run('--component', 'LibraryView');
    assert(/src\/library\/100-library\.js \(which declares LibraryView\)/.test(view.stdout) && /\.dr-lib-row\n/.test(view.stdout), 'a class gives its piece');
  });

  await test('unknown selectors and components fail and point near', () => {
    const sel = run('--selector', '.dr-bulk-tray');
    assert(sel.status === 1 && /near: .*dr-bulk-bar/.test(sel.stderr), sel.stderr);
    const comp = run('--component', 'selection-tray');
    assert(comp.status === 1 && /no component "selection-tray"/.test(comp.stderr), comp.stderr);
    assert(run('--report', 'nonsense').status === 1, 'an unknown report fails');
  });

  await test('the reports', () => {
    const counts = {};
    ['repeated-overrides', 'brittle', 'effects', 'tokens', 'hardcoded'].forEach((r) => {
      const out = run('--report', r);
      assert(out.status === 0, `${r}: ${out.stderr}`);
      counts[r] = Number((out.stdout.split('\n')[0].match(/(\d+)/) || [])[1]);
      assert(counts[r] >= 0, `${r} leads with a count`);
    });
    const brittle = run('--report', 'brittle', '--all').stdout;
    assert(/\.metadata-container/.test(brittle) && !/\n\S+ +body\.is-mobile\n/.test(brittle), 'Obsidian chrome, not body states');
    assert(/backdrop-filter/.test(run('--report', 'effects').stdout), 'blur is a cost');
    assert(/--dr-space-1 /.test(run('--report', 'tokens', '--all').stdout), 'tokens listed');
    assert(!/var\(--dr-label-width, 84px\)/.test(run('--report', 'hardcoded', '--all').stdout), 'var() fallbacks are the token’s');
    if (spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'styles/'], { cwd: root }).status === 0) assert(/: 0$/m.test(run('--report', 'hardcoded', '--since', 'HEAD').stdout.split('\n')[0]), 'nothing added since HEAD');
  });

  await test('read-only and the same twice', () => {
    const before = execFileSync('git', ['status', '--porcelain', '--', 'styles/', 'styles.css'], { cwd: root }).toString();
    const a = run('--json');
    const b = run('--json');
    assert(a.status === 0 && a.stdout === b.stdout, 'two runs differ');
    const map = JSON.parse(a.stdout);
    assert(map.parts.length === fs.readdirSync(path.join(root, 'styles')).filter((f) => f.endsWith('.css')).length && map.rules.length > 1000, `${map.parts.length} parts, ${map.rules.length} rules`);
    assert(execFileSync('git', ['status', '--porcelain', '--', 'styles/', 'styles.css'], { cwd: root }).toString() === before, 'styles changed');
  });

  console.log(`\n${passed} passed`);
})();
