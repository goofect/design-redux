#!/usr/bin/env node
/*
 * Where things are, worked out from src/ each time, so it never goes stale.
 *
 *   node tests/map.js              a line per piece: heading, features (setting), suites that test it
 *   node tests/map.js canvas fold  only the pieces whose line has every word
 *   node tests/map.js --who NAME   where NAME is declared, and which pieces and tests use it
 *
 * The pieces share one scope, so --who is how to find a name's callers.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const read = (f) => fs.readFileSync(f, 'utf8');
const pieces = fs.readdirSync(src).filter((f) => f.endsWith('.js')).sort().map((f) => ({ name: f.replace(/\.js$/, ''), text: read(path.join(src, f)) }));
const tests = fs.readdirSync(__dirname).filter((f) => /^test_.*\.js$/.test(f)).map((f) => ({ name: f.replace(/^test_|\.js$/g, ''), text: read(path.join(__dirname, f)) }));
const e2eDir = path.join(__dirname, 'obsidian');
const e2e = fs.existsSync(e2eDir) ? fs.readdirSync(e2eDir).filter((f) => f.endsWith('.mjs')).map((f) => read(path.join(e2eDir, f))).join('\n') : '';
const escape = (s) => s.replace(/[$]/g, '\\$');
const word = (name) => new RegExp(`(^|[^\\w$])${escape(name)}(?![\\w$])`, 'g');

pieces.forEach((p) => {
  const heading = p.text.split('\n').slice(0, 4).map((l) => l.match(/^\/\* (\w.*?)\s*\*\/$/)).find((m) => m);
  p.heading = heading ? heading[1] : '';
  p.names = [];
  p.text.split('\n').forEach((line, i) => {
    const m = line.match(/^(?:async\s+)?(?:class|function\*?|const|let|var)\s+([\w$]+)/);
    if (m) p.names.push({ name: m[1], line: i + 1, kind: line.startsWith('class') ? 'class' : 'other' });
  });
  p.features = p.names
    .filter((n) => n.kind === 'class')
    .map((n) => {
      const key = p.text.match(new RegExp(`^${escape(n.name)}\\.settingKey = '([\\w]+)'`, 'm'));
      return key ? `${n.name} (${key[1]})` : n.name;
    });
  // Suites that name one of its classes or longer-named functions.
  const telling = p.names.filter((n) => n.kind === 'class' || n.name.length >= 6).map((n) => n.name);
  p.suites = tests.filter((t) => telling.some((n) => word(n).test(t.text))).map((t) => t.name);
  if (p.names.some((n) => n.kind === 'class' && word(n.name).test(e2e))) p.suites.push('obsidian');
});

const args = process.argv.slice(2);
if (args[0] === '--who') {
  const name = args[1];
  if (!name) {
    console.log('usage: node tests/map.js --who NAME');
    process.exit(1);
  }
  const home = pieces.find((p) => p.names.some((n) => n.name === name));
  if (home) console.log(`${name}: declared in ${home.name}:${home.names.find((n) => n.name === name).line}`);
  else console.log(`${name}: not declared at the top of any piece`);
  const count = (text) => (text.match(word(name)) || []).length;
  const users = pieces.filter((p) => p !== home).map((p) => [p.name, count(p.text)]).filter(([, n]) => n);
  console.log(users.length ? `used in ${users.map(([p, n]) => `${p} (${n})`).join(', ')}` : 'used nowhere else');
  const inTests = tests.map((t) => [t.name, count(t.text)]).filter(([, n]) => n);
  if (count(e2e)) inTests.push(['obsidian', count(e2e)]);
  if (inTests.length) console.log(`tests: ${inTests.map(([t, n]) => `${t} (${n})`).join(', ')}`);
  process.exit(0);
}

const words = args.map((a) => a.toLowerCase());
pieces.forEach((p) => {
  const line = [p.name, p.heading, p.features.join(', '), p.suites.length ? `tests: ${p.suites.join(' ')}` : ''].filter(Boolean).join(' — ');
  if (words.every((w) => line.toLowerCase().includes(w))) console.log(line);
});
