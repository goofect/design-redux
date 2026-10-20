/*
 * The stylesheet's own lint: no duration that isn't a motion token, and no
 * colour value that isn't already on the list in tests/snapshots/styles.json.
 * Colour belongs to the theme; the few fixed values the plugin keeps (Apple's
 * fills and thumbs, cover art) are recorded, and a new one has to be added
 * deliberately: node tests/test_styles.js --update.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const snapFile = path.join(__dirname, 'snapshots', 'styles.json');

const colours = new Set();
(css.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g) || []).forEach((c) => colours.add(c.replace(/\s+/g, ' ').toLowerCase()));
const found = Array.from(colours).sort();

const durations = [];
css.split('\n').forEach((line, i) => {
  if (/^\s*--dr-dur-[a-z]+\s*:/.test(line)) return;
  const m = line.match(/(?:^|[\s(,:])(\d*\.?\d+m?s)\b/);
  if (m && /(transition|animation)/.test(line)) durations.push(`${i + 1}: ${line.trim()}`);
});

if (process.argv.includes('--update')) {
  fs.writeFileSync(snapFile, JSON.stringify({ colours: found }, null, 2) + '\n');
  console.log(`styles: ${found.length} colour values recorded`);
  process.exit(0);
}

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

t('every duration is a motion token', () => {
  assert.deepStrictEqual(durations, [], 'durations not on a token: ' + durations.join(' | '));
});

t('no colour value that isn’t on the list', () => {
  const known = fs.existsSync(snapFile) ? JSON.parse(fs.readFileSync(snapFile, 'utf8')).colours : [];
  const added = found.filter((c) => known.indexOf(c) === -1);
  assert.deepStrictEqual(added, [], 'new colour values (colour is the theme’s; record a deliberate one with --update): ' + added.join(', '));
});

t('with reduced motion, every rule that sets the durations sets them to nothing', () => {
  // The rules that give --dr-dur-slow a time, outside a reduced-motion block, each need a zero inside one.
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const reduced = [];
  const blocks = css.split('@media (prefers-reduced-motion: reduce)');
  blocks.slice(1).forEach((b) => {
    let depth = 0;
    let end = 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === '{') depth++;
      else if (b[i] === '}' && --depth === 0) { end = i; break; }
    }
    reduced.push(b.slice(0, end));
  });
  const inside = reduced.join('\n');
  while ((m = re.exec(css))) {
    const sel = m[1].trim().split('\n').pop().trim();
    if (/--dr-dur-slow:\s*[1-9]/.test(m[2])) rules.push(sel);
  }
  const zeroed = new Set();
  while ((m = re.exec(inside))) {
    if (/--dr-dur-slow:\s*0/.test(m[2])) zeroed.add(m[1].trim().split('\n').pop().trim());
  }
  const open = rules.filter((sel) => !zeroed.has(sel) && !(sel === ':root' && zeroed.has('body')));
  assert.deepStrictEqual(open, [], 'durations reduced motion leaves running: ' + open.join(', '));
});

console.log(`\n${passed} passed`);
