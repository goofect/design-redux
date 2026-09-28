// Joins the pieces in src/ into main.js, the one file Obsidian loads.
//
// The pieces are one script cut at its section headings, not modules:
// they're joined in name order and share one scope, so a piece can use
// anything declared in an earlier one — and, inside a function, in a later
// one. A new piece gets a number between its neighbours'.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(root, 'src');
const fail = (message) => {
  console.error(`build: ${message}`);
  process.exit(1);
};

const pieces = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.js'))
  .sort();
const strays = pieces.filter((f) => !/^\d{3}-[a-z0-9-]+\.js$/.test(f));
if (strays.length) fail(`src/ files are named NNN-name.js, to set their order: ${strays.join(', ')}`);

// Top-level names, each declared once across all the pieces.
const declared = new Map();
const texts = pieces.map((file) => {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!text.endsWith('\n')) fail(`${file} must end with a line break`);
  text.split('\n').forEach((line, i) => {
    const m = /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!m) return;
    const at = `${file}:${i + 1}`;
    if (declared.has(m[1])) fail(`${m[1]} is declared twice: ${declared.get(m[1])} and ${at}`);
    declared.set(m[1], at);
  });
  return text;
});

const code = texts.join('');
try {
  new vm.Script(code, { filename: 'main.js' });
} catch (err) {
  fail(`main.js wouldn't load: ${err.message}\n${(err.stack || '').split('\n').slice(0, 3).join('\n')}`);
}

const out = path.join(root, 'main.js');
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== code) fs.writeFileSync(out, code);
console.log(`build: main.js from ${pieces.length} pieces, ${code.split('\n').length - 1} lines`);
