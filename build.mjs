// Builds main.js and styles.css, the two files Obsidian loads.
//
// main.js: esbuild bundles src/main.js. The glyphs under assets/icons/actions come in
// as the module `dr:icons`. Before bundling, the source is held to its shape:
// a module sits in an area, is no longer than 400 lines, imports only from its
// own area and those below, exports no name another module exports, and is
// reached from src/main.js.
// styles.css: the parts of styles/, joined in name order: the order is the cascade.
// tests/_source.js: every module's exports as one object, for the suites.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const LAYERS = [['core'], ['ui'], ['library', 'note', 'maps', 'tools', 'backup'], ['plugin']];
const AREAS = LAYERS.flat();
const LIMIT = 400;
const fail = (message) => {
  console.error(`build: ${message}`);
  process.exit(1);
};

const modules = [];
fs.readdirSync(src).forEach((entry) => {
  if (entry === 'main.js' || entry.startsWith('.')) return;
  if (!AREAS.includes(entry)) fail(`src/${entry} isn't an area: ${AREAS.join(', ')}`);
  fs.readdirSync(path.join(src, entry)).filter((f) => !f.startsWith('.')).forEach((file) => {
    if (!/^[a-z][a-z0-9-]*\.js$/.test(file)) fail(`src/${entry}/${file}: a module is named name.js, lower case`);
    modules.push(`${entry}/${file}`);
  });
});

const layerOf = (area) => LAYERS.findIndex((l) => l.includes(area));
const exported = new Map();
modules.forEach((file) => {
  const text = fs.readFileSync(path.join(src, file), 'utf8');
  const lines = text.split('\n');
  if (lines.length - 1 > LIMIT) fail(`src/${file} is ${lines.length - 1} lines: no module is over ${LIMIT}`);
  const area = file.split('/')[0];
  lines.forEach((line, i) => {
    const from = /^\s*(?:import|export)\b[^'"]*from\s+['"](\.[^'"]+)['"]/.exec(line) || /^\s*import\s+['"](\.[^'"]+)['"]/.exec(line);
    if (from) {
      const target = path.relative(src, path.resolve(path.join(src, area), from[1])).split(path.sep);
      const other = target[0];
      if (target.length < 2 || !AREAS.includes(other)) fail(`src/${file}:${i + 1} imports ${from[1]}, which is in no area`);
      if (other !== area && layerOf(other) >= layerOf(area)) fail(`src/${file}:${i + 1} imports from ${other}: ${area} may import only from its own area and those below (${LAYERS.slice(0, layerOf(area)).flat().join(', ') || 'none'})`);
    }
    const name = /^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!name) return;
    if (exported.has(name[1])) fail(`${name[1]} is exported twice: src/${exported.get(name[1])} and src/${file}`);
    exported.set(name[1], file);
  });
});

/** The glyph files as a module: each name's paths, already wrapped for Obsidian's addIcon (a box of 100). */
const icons = {
  name: 'dr-icons',
  setup(build) {
    build.onResolve({ filter: /^dr:icons$/ }, () => ({ path: 'icons', namespace: 'dr' }));
    build.onLoad({ filter: /.*/, namespace: 'dr' }, () => {
      const out = {};
      // The plugin's few glyphs: the controls' own. There are no object glyphs.
      ['actions'].forEach((kind) => {
        const dir = path.join(root, 'assets', 'icons', kind);
        fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort().forEach((f) => {
          const paths = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
          out[f.slice(0, -4)] = `<g transform="scale(${(100 / 24).toFixed(6)})" fill="currentColor" stroke="none">${paths}</g>`;
        });
      });
      return { contents: `export const ICONS = ${JSON.stringify(out)};`, loader: 'js' };
    });
  },
};

const common = {
  bundle: true,
  format: 'cjs',
  target: 'es2021',
  platform: 'browser',
  // http: the page on this machine a sign-in comes back to (desktop only, from Obsidian's own Node).
  external: ['obsidian', 'electron', 'http', '@codemirror/*', '@lezer/*'],
  // The backup's sign-in apps, from the environment (CI's secrets for a release): an empty id leaves that service out.
  define: Object.fromEntries(['DR_GOOGLE_CLIENT_ID', 'DR_GOOGLE_CLIENT_SECRET', 'DR_ONEDRIVE_CLIENT_ID'].map((k) => [k, JSON.stringify(process.env[k] || '')])),
  plugins: [icons],
  write: false,
  metafile: true,
  logLevel: 'silent',
  legalComments: 'none',
};

let result;
try {
  // `--dev`: a sourcemap inside main.js whose sources are the files under src/, so a debugger attached to Obsidian stops in them.
  const dev = process.argv.includes('--dev') ? { sourcemap: 'inline', outfile: path.join(root, 'main.js'), sourceRoot: `${pathToFileURL(root).href}/` } : {};
  result = await esbuild.build({ ...common, ...dev, entryPoints: [path.join(src, 'main.js')] });
} catch (err) {
  fail(`${(err.errors || []).map((e) => `${e.location ? `${e.location.file}:${e.location.line} ` : ''}${e.text}`).join('\n') || err.message}`);
}
const reached = new Set(Object.keys(result.metafile.inputs).map((f) => path.relative(src, path.resolve(root, f))));
const lost = modules.filter((m) => !reached.has(m));
// A module nothing reaches is refused; `--loose` only tells it, for work in hand.
if (lost.length) {
  const message = `nothing imports ${lost.map((m) => `src/${m}`).join(', ')}: a module is reached from src/main.js or it goes`;
  if (!process.argv.includes('--loose')) fail(message);
  console.log(`build: (loose) ${message}`);
}

const write = (file, text) => {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
};
const code = (result.outputFiles.find((f) => f.path.endsWith('.js')) || result.outputFiles[0]).text;
write(path.join(root, 'main.js'), code);
console.log(`build: main.js from ${modules.length} modules, ${code.split('\n').length - 1} lines`);

// For the suites: everything every module exports, by name.
const all = await esbuild.build({
  ...common,
  stdin: { contents: `${modules.map((m) => `export * from './${m}';`).join('\n')}\nexport { default } from './main.js';`, resolveDir: src, sourcefile: 'all.js' },
});
write(path.join(root, 'tests', '_source.js'), all.outputFiles[0].text);

const styleDir = path.join(root, 'styles');
const parts = fs.readdirSync(styleDir).filter((f) => f.endsWith('.css')).sort();
const misnamed = parts.filter((f) => !/^\d{2}-[a-z0-9-]+\.css$/.test(f));
if (misnamed.length) fail(`styles/ holds a part not named NN-name.css: ${misnamed.join(', ')}`);
const css = parts.map((f) => fs.readFileSync(path.join(styleDir, f), 'utf8')).join('\n');
write(path.join(root, 'styles.css'), css);
console.log(`build: styles.css from ${parts.length} parts, ${css.split('\n').length - 1} lines`);
