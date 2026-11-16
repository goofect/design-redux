// Reads the names of the CSS variables Obsidian declares, from the app the
// real-Obsidian tests download (.obsidian-cache/obsidian-app/obsidian-*.asar),
// into tests/snapshots/obsidian-vars.json. The variable map
// (styles/01-obsidian-map.css) may set only names on that list: run this
// after Obsidian updates, then the tokens suite says which names are gone.
//
//   node tools/obsidian-vars.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.obsidian-cache', 'obsidian-app');
const archives = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^obsidian-[\d.]+\.asar$/.test(f)) : [];
if (!archives.length) {
  console.error(`obsidian-vars: no app in ${path.relative(root, dir)}: run the real-Obsidian tests once to download it`);
  process.exit(1);
}
const version = (f) => f.match(/[\d.]+(?=\.asar)/)[0].split('.').map(Number);
archives.sort((a, b) => { const [x, y] = [version(a), version(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
const archive = archives[archives.length - 1];

/** One file out of an asar archive: a sized JSON header that lists each file's offset, then the files end to end. */
function fromAsar(file, name) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const json = Buffer.alloc(head.readUInt32LE(12));
  fs.readSync(fd, json, 0, json.length, 16);
  const entry = JSON.parse(json.toString('utf8')).files[name];
  const data = Buffer.alloc(entry.size);
  fs.readSync(fd, data, 0, entry.size, 8 + head.readUInt32LE(4) + Number(entry.offset));
  fs.closeSync(fd);
  return data.toString('utf8');
}

const css = fromAsar(path.join(dir, archive), 'app.css');
const vars = Array.from(new Set(Array.from(css.matchAll(/[{;\s](--[a-zA-Z0-9-]+)\s*:/g)).map((m) => m[1]))).sort();
const out = path.join(root, 'tests', 'snapshots', 'obsidian-vars.json');
fs.writeFileSync(out, `${JSON.stringify({ obsidian: version(archive).join('.'), note: "Variable names declared in Obsidian's app.css; the variable map may only set names on this list. Refresh: node tools/obsidian-vars.mjs", vars })}\n`);
console.log(`obsidian-vars: ${vars.length} names from Obsidian ${version(archive).join('.')}`);
