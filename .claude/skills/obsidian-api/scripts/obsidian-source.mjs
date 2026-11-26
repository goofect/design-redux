#!/usr/bin/env node
// Reads Obsidian's own scripts (app.js, worker.js, lib/…) out of the app's
// .asar, to see how Obsidian really does something the API doesn't say:
// which pattern makes a list, what a decoration sets, which user events a
// filter skips.
//
//   node obsidian-source.mjs --find "input.renumber"        each place a text occurs, with what is around it
//   node obsidian-source.mjs --find "/formatting-list-\w+/" a /regex/ instead of text
//   node obsidian-source.mjs --regexes "[.)]"               every regex literal that contains the text
//   node obsidian-source.mjs --files                        the scripts in the .asar and their sizes
//
// Options: --in app.js,worker.js (default: both)  --around 160 (characters of context)
//          --max 20 (matches per file)  --asar <path>
// The .asar is found as obsidian-css.mjs finds it: --asar; $OBSIDIAN_ASAR;
// ~/Library/Application Support/obsidian or ~/.config/obsidian (newest);
// .obsidian-cache/. Another version: download obsidian-<v>.asar.gz from
// github.com/obsidianmd/obsidian-releases/releases, gunzip it, pass --asar.
// The code is minified: names change between versions, strings and regexes
// don't, so search by those. Plain Node, no packages.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1] === undefined || args[i + 1].startsWith('--') ? '' : args[i + 1];
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
  return [
    ...walk(path.join(os.homedir(), 'Library/Application Support/obsidian')),
    ...walk(path.join(os.homedir(), '.config/obsidian')),
    ...walk(path.resolve('.obsidian-cache')),
  ].sort(newer)[0] || null;
}

function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);
  const json = Buffer.alloc(head.readUInt32LE(12));
  fs.readSync(fd, json, 0, json.length, 16);
  const root = JSON.parse(json.toString('utf8'));
  const list = (node = root, at = '') => Object.entries(node.files || {}).flatMap(([name, n]) =>
    n.files ? list(n, `${at}${name}/`) : [{ path: `${at}${name}`, size: n.size }]);
  const read = (want) => {
    let node = root;
    for (const part of want.split('/')) if (!(node = node.files && node.files[part])) throw new Error(`${want} is not in ${file}`);
    const out = Buffer.alloc(node.size);
    fs.readSync(fd, out, 0, node.size, 8 + headerSize + Number(node.offset));
    return out.toString('utf8');
  };
  return { list, read };
}

// The regex literal around position i, found by walking out to its slashes.
function regexAt(src, i) {
  let start = i;
  for (; start > 0 && start > i - 400; start--) {
    if (src[start] !== '/' || src[start - 1] === '\\') continue;
    if (/[=(,:;!&|?[{}\s]/.test(src[start - 1] || ' ')) break;
  }
  if (src[start] !== '/') return null;
  let inClass = false;
  for (let j = start + 1; j < src.length && j < start + 600; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      if (j < i) return null;
      const flags = src.slice(j + 1).match(/^[dgimsuvy]*/)[0];
      return src.slice(start, j + 1 + flags.length);
    }
    else if (c === '\n') return null;
  }
  return null;
}

const asar = findAsar();
if (!asar) { console.error('No Obsidian .asar found. Pass --asar <path>, or set OBSIDIAN_ASAR.'); process.exit(1); }
const pack = openAsar(asar);
console.error(`from ${asar}`);

if (opt('--files') !== null) {
  for (const f of pack.list().filter((f) => /\.(js|mjs)$/.test(f.path)).sort((a, b) => b.size - a.size))
    console.log(`${String(Math.round(f.size / 1024)).padStart(6)} KB  ${f.path}`);
  process.exit(0);
}

const files = (opt('--in') || 'app.js,worker.js').split(',');
const around = Number(opt('--around', '160'));
const max = Number(opt('--max', '20'));
const find = opt('--find');
const regexes = opt('--regexes');
if (!find && !regexes) {
  console.log('Use --find <text or /regex/>, --regexes <text>, or --files.');
  process.exit(0);
}

for (const file of files) {
  const src = pack.read(file);
  const out = [];
  if (find) {
    const re = /^\/.+\/[a-z]*$/.test(find)
      ? new RegExp(find.slice(1, find.lastIndexOf('/')), `${find.slice(find.lastIndexOf('/') + 1).replace('g', '')}g`)
      : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    for (const m of src.matchAll(re)) {
      out.push(`  @${m.index}  …${src.slice(Math.max(0, m.index - around), m.index + m[0].length + around).replace(/\s+/g, ' ')}…`);
      if (out.length >= max) break;
    }
  } else {
    const seen = new Set();
    for (let i = src.indexOf(regexes); i !== -1 && seen.size < max; i = src.indexOf(regexes, i + 1)) {
      const lit = regexAt(src, i);
      if (lit && !seen.has(lit)) { seen.add(lit); out.push(`  @${i}  ${lit}`); }
    }
  }
  console.log(`${file}: ${out.length}${out.length >= max ? '+' : ''}`);
  out.forEach((l) => console.log(l));
}
