#!/usr/bin/env node
// Looks things up in Obsidian's API types (node_modules/obsidian/obsidian.d.ts),
// so an answer comes from the installed version, not from memory.
//
//   node obsidian-api.mjs processFrontMatter     every declaration with that name
//   node obsidian-api.mjs --class Workspace      a class's members, with versions
//   node obsidian-api.mjs --since 1.13           what was added from 1.13 on
//   node obsidian-api.mjs --deprecated           everything deprecated, and why
//   add --full to print a declaration's whole doc comment
//
// --dts <path> reads another obsidian.d.ts. Plain Node, no packages.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const dts = opt('--dts') || path.resolve('node_modules/obsidian/obsidian.d.ts');
if (!fs.existsSync(dts)) {
  console.error(`No ${dts}. Run npm install in the plugin's folder, or pass --dts <path>.`);
  process.exit(1);
}
const lines = fs.readFileSync(dts, 'utf8').split('\n');
const pkg = path.join(path.dirname(dts), 'package.json');
if (fs.existsSync(pkg)) console.error(`obsidian ${JSON.parse(fs.readFileSync(pkg, 'utf8')).version}`);

// One entry per declaration: { owner, name, sig, since, deprecated, doc }.
const entries = [];
let owner = '';
let doc = [];
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const t = raw.trim();
  if (t.startsWith('/**')) {
    doc = [];
    let j = i;
    for (; j < lines.length; j++) {
      doc.push(lines[j].trim().replace(/^\/\*\*\s?|^\*\/|^\*\s?|\s*\*\/$/g, ''));
      if (lines[j].includes('*/')) break;
    }
    i = j;
    continue;
  }
  if (!t || t.startsWith('//')) continue;
  const top = raw.match(/^export (?:declare )?(?:abstract )?(class|interface|function|type|const|enum) (\w+)/);
  if (top) {
    if (top[1] === 'class' || top[1] === 'interface') owner = top[2];
  } else if (raw === '}') {
    owner = '';
    doc = [];
    continue;
  }
  const member = !top && owner && raw.match(/^ {4}(?:static |readonly |protected |abstract |get |set )*([\w$]+)[?]?\s*[(:<]/);
  const name = top ? top[2] : member ? member[1] : null;
  if (!name) { doc = []; continue; }
  const text = doc.join('\n');
  entries.push({
    owner: top ? '' : owner,
    name,
    sig: t.replace(/\s*\{$/, '').slice(0, 160),
    since: (text.match(/@since ([\d.]+)/) || [])[1] || '',
    deprecated: /@deprecated/.test(text) ? (text.split('@deprecated')[1] || '').split('\n@')[0].trim().replace(/\s+/g, ' ') || 'yes' : '',
    doc: text.split('\n@')[0].trim(),
  });
  doc = [];
}

const ver = (v) => v.split('.').map(Number);
const atLeast = (a, b) => {
  const x = ver(a), y = ver(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
};
const show = (e) => {
  const where = e.owner ? `${e.owner}.` : '';
  const tags = [e.since && `since ${e.since}`, e.deprecated && `DEPRECATED: ${e.deprecated}`].filter(Boolean).join(' · ');
  console.log(`${where}${e.name}${tags ? `   (${tags})` : ''}\n  ${e.sig}`);
  if (flag('--full') && e.doc) console.log(e.doc.split('\n').map((l) => `  | ${l}`).join('\n'));
  else if (e.doc) console.log(`  ${(e.doc.split(/\n\n|\.\s/)[0] + '.').replace(/\.\.$/, '.').replace(/\s+/g, ' ').slice(0, 160)}`);
};

if (opt('--since')) {
  const v = opt('--since');
  const hits = entries.filter((e) => e.since && atLeast(e.since, v));
  hits.sort((a, b) => (atLeast(a.since, b.since) && a.since !== b.since ? 1 : -1));
  for (const e of hits) console.log(`${e.since.padEnd(7)} ${e.owner ? e.owner + '.' : ''}${e.name}`);
  console.error(`${hits.length} declarations since ${v}`);
} else if (flag('--deprecated')) {
  for (const e of entries.filter((x) => x.deprecated)) console.log(`${e.owner ? e.owner + '.' : ''}${e.name}: ${e.deprecated.slice(0, 140)}`);
} else if (opt('--class')) {
  const c = opt('--class');
  const hits = entries.filter((e) => e.owner === c || (!e.owner && e.name === c));
  hits.forEach(show);
  if (!hits.length) console.error(`No class or interface ${c}.`);
} else if (args[0] && !args[0].startsWith('--')) {
  const q = args[0];
  const exact = entries.filter((e) => e.name === q);
  const hits = exact.length ? exact : entries.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));
  hits.slice(0, 30).forEach(show);
  if (hits.length > 30) console.error(`${hits.length - 30} more; narrow the name.`);
  if (!hits.length) console.error(`Nothing named like ${q}: it is not public API (an internal needs a typeof check).`);
} else {
  console.log('Use: <name> | --class <Class> | --since <version> | --deprecated   [--full] [--dts <path>]');
}
