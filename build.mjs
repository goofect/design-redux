// Bundles the modules in src/ into main.js, the one file Obsidian loads.
//
// Each module, src/<area>/NNN-name.js, imports what it uses and exports what
// it declares; src/main.js imports them all and exports the plugin. esbuild
// joins them into one script, leaving obsidian and @codemirror/* to
// Obsidian, as now. Before writing main.js the build refuses:
//   - a file out of place, or in no area;
//   - a name declared at the top of two modules (the bundle would rename one,
//     and the tests reach the plugin's names by their own);
//   - a name used from another module without importing it, an import of
//     something that module doesn't declare, a module that needs a name as
//     it loads from one that runs after it, or a use across the layers that
//     isn't on the known list (tests/map.js --verify);
//   - a module nothing imports (src/main.js imports only the plugin; the
//     rest are reached through it);
//   - a main.js that fails as it loads.
// Then it joins the stylesheet's parts, styles/NN-name.css, in their order,
// into styles.css, the one Obsidian loads.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(root, 'src');
const AREAS = ['core', 'ui', 'library', 'note', 'tools', 'plugin'];
const fail = (message) => {
  console.error(`build: ${message}`);
  process.exit(1);
};

const modules = [];
fs.readdirSync(dir).forEach((entry) => {
  if (entry === 'main.js') return;
  if (!fs.statSync(path.join(dir, entry)).isDirectory()) fail(`src/${entry}: a module goes in its area's folder, src/<area>/NNN-name.js`);
  if (!AREAS.includes(entry)) fail(`src/${entry}/ isn't an area: ${AREAS.join(', ')}`);
  fs.readdirSync(path.join(dir, entry)).forEach((file) => modules.push(`${entry}/${file}`));
});
const strays = modules.filter((m) => !/^[a-z]+\/\d{3}-[a-z0-9-]+\.js$/.test(m));
if (strays.length) fail(`modules are named src/<area>/NNN-name.js: ${strays.join(', ')}`);

// Top-level names, each declared once across all the modules.
const declared = new Map();
modules.forEach((file) => {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!text.endsWith('\n')) fail(`${file} must end with a line break`);
  text.split('\n').forEach((line, i) => {
    const m = /^(?:export\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!m) return;
    const at = `${file}:${i + 1}`;
    if (declared.has(m[1])) fail(`${m[1]} is declared twice: ${declared.get(m[1])} and ${at}`);
    declared.set(m[1], at);
  });
});

try {
  execFileSync(process.execPath, [path.join(root, 'tests', 'map.js'), '--verify'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
} catch (err) {
  fail(`\n${String(err.stdout || err.message).trim()}`);
}

let code;
try {
  const result = await esbuild.build({
    entryPoints: [path.join(dir, 'main.js')],
    bundle: true,
    format: 'cjs',
    target: 'esnext',
    external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
    // Everything the modules declare stays, used or not: the tests reach it.
    treeShaking: false,
    charset: 'utf8',
    legalComments: 'none',
    // module.exports is the plugin class itself, as in 1.x, rather than { default }.
    footer: { js: 'module.exports = module.exports.default;' },
    logLevel: 'silent',
    write: false,
  });
  code = result.outputFiles[0].text;
} catch (err) {
  fail(`esbuild: ${(err.errors || []).map((e) => `${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ''}`).join('\n') || err.message}`);
}

// Loaded as Obsidian would, with what Obsidian provides stood in for: a
// name a cycle leaves undefined fails here rather than in the app.
const stand = () =>
  new Proxy(function () {}, {
    get: (target, key) => (key === 'prototype' ? {} : key === Symbol.toPrimitive ? () => '' : stand()),
    apply: () => stand(),
    construct: () => stand(),
  });
try {
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, require: () => stand(), console, window: stand(), document: stand(), navigator: stand(), setTimeout, clearTimeout };
  new vm.Script(code, { filename: 'main.js' }).runInNewContext(sandbox);
  if (typeof sandbox.module.exports !== 'function') fail('main.js loads, but exports no plugin');
} catch (err) {
  fail(`main.js wouldn't load: ${err.message}\n${(err.stack || '').split('\n').slice(0, 3).join('\n')}`);
}

const out = path.join(root, 'main.js');
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== code) fs.writeFileSync(out, code);
console.log(`build: main.js from ${modules.length} modules, ${code.split('\n').length - 1} lines`);

// The stylesheet: its parts joined as they are, in order, so the cascade is the one they were written in.
const styleDir = path.join(root, 'styles');
const parts = fs.readdirSync(styleDir).filter((f) => f.endsWith('.css')).sort();
const misnamed = parts.filter((f) => !/^\d{2}-[a-z0-9-]+\.css$/.test(f));
if (misnamed.length) fail(`styles/ holds a part not named NN-name.css: ${misnamed.join(', ')}`);
const css = parts.map((f) => fs.readFileSync(path.join(styleDir, f), 'utf8')).join('');
const cssOut = path.join(root, 'styles.css');
if (!fs.existsSync(cssOut) || fs.readFileSync(cssOut, 'utf8') !== css) fs.writeFileSync(cssOut, css);
console.log(`build: styles.css from ${parts.length} parts, ${css.split('\n').length - 1} lines`);
