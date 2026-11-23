#!/usr/bin/env node
// Reads Obsidian's own app.css out of the app's .asar, so a style can be
// checked against what Obsidian really sets instead of guessed.
//
//   node obsidian-css.mjs --vars [filter]       every CSS variable and its value
//   node obsidian-css.mjs --selector ".cm-line" every rule whose selector has it
//   node obsidian-css.mjs --uses "--file-line-width"   every rule that reads it
//   node obsidian-css.mjs --dump [out.css]      write app.css out whole (no file: to stdout)
//
// The .asar is found in (first hit wins): --asar <path>; $OBSIDIAN_ASAR;
// ~/Library/Application Support/obsidian/obsidian-*.asar (newest);
// .obsidian-cache/ under the current folder (the e2e tests' copy).
// Plain Node, no packages.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] === undefined || args[i + 1].startsWith('--') ? '' : args[i + 1];
};

function walk(dir, hits = [], depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return hits;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, hits, depth + 1);
    else if (/^obsidian-[\d.]+\.asar$/.test(e.name)) hits.push(p);
  }
  return hits;
}
const version = (p) => (path.basename(p).match(/[\d.]+(?=\.asar)/) || ['0'])[0].split('.').map(Number);
const newer = (a, b) => {
  const x = version(a), y = version(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  return 0;
};

function findAsar() {
  const given = opt('--asar') || process.env.OBSIDIAN_ASAR;
  if (given) return given;
  const hits = [
    ...walk(path.join(os.homedir(), 'Library/Application Support/obsidian')),
    ...walk(path.join(os.homedir(), '.config/obsidian')),
    ...walk(path.resolve('.obsidian-cache')),
  ].sort(newer);
  return hits[0] || null;
}

function readAsarFile(file, want) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);
  const jsonSize = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonSize);
  fs.readSync(fd, json, 0, jsonSize, 16);
  let node = JSON.parse(json.toString('utf8'));
  for (const part of want.split('/')) {
    node = node.files && node.files[part];
    if (!node) throw new Error(`${want} is not in ${file}`);
  }
  const out = Buffer.alloc(node.size);
  fs.readSync(fd, out, 0, node.size, 8 + headerSize + Number(node.offset));
  fs.closeSync(fd);
  return out.toString('utf8');
}

// Splits CSS into rules: [{ at, selector, body }], with @media and the like
// kept as the `at` of the rules inside them. Good enough for app.css.
function rules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let i = 0, start = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const head = css.slice(start, i).trim();
      if (head.startsWith('@')) { stack.push(head); start = i + 1; }
      else {
        let depth = 1, j = i + 1;
        while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
        out.push({ at: stack.join(' '), selector: head, body: css.slice(i + 1, j - 1).trim() });
        i = j; start = j; continue;
      }
    } else if (c === '}') { stack.pop(); start = i + 1; }
    i++;
  }
  return out;
}

const asar = findAsar();
if (!asar) {
  console.error('No Obsidian .asar found. Pass --asar <path>, or set OBSIDIAN_ASAR.');
  process.exit(1);
}
const css = readAsarFile(asar, 'app.css');
console.error(`app.css from ${asar} (${Math.round(css.length / 1024)} KB)`);

if (opt('--dump') !== null) {
  // No file named: to stdout, so nothing lands in the folder the script was run from.
  if (opt('--dump')) fs.writeFileSync(opt('--dump'), css);
  else process.stdout.write(css);
} else if (opt('--vars') !== null) {
  const filter = opt('--vars');
  const seen = new Map();
  for (const r of rules(css)) {
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      if (filter && !m[1].includes(filter)) continue;
      const where = `${r.at ? r.at + ' ' : ''}${r.selector}`.replace(/\s+/g, ' ');
      const list = seen.get(m[1]) || [];
      list.push(`${m[2].trim()}   [${where.slice(0, 60)}]`);
      seen.set(m[1], list);
    }
  }
  for (const [name, values] of [...seen].sort()) console.log(`${name}: ${values.join('\n' + ' '.repeat(name.length + 2))}`);
  console.error(`${seen.size} variables`);
} else if (opt('--selector') !== null || opt('--uses') !== null) {
  const sel = opt('--selector');
  const use = opt('--uses');
  let n = 0;
  for (const r of rules(css)) {
    if (sel && !r.selector.includes(sel)) continue;
    if (use && !r.body.includes(use)) continue;
    n++;
    console.log(`${r.at ? r.at + '\n  ' : ''}${r.selector.replace(/\s+/g, ' ')} {\n  ${r.body.replace(/;\s*/g, ';\n  ').trim()}\n}`);
  }
  console.error(`${n} rules`);
} else {
  console.log('Use --vars [filter], --selector <text>, --uses <--variable>, or --dump [file] (stdout when no file).');
}
