/*
 * The stylesheet's own lint: no rule for a class the code no longer makes,
 * no duration that isn't a motion token, and no
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

t('every class the stylesheet dresses is one the code makes: no rules left for what’s gone', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const src = path.join(__dirname, '..', 'src');
  const code = fs.readdirSync(src).filter((d) => fs.statSync(path.join(src, d)).isDirectory())
    .map((d) => fs.readdirSync(path.join(src, d)).map((f) => fs.readFileSync(path.join(src, d, f), 'utf8')).join('\n')).join('\n');
  // Style Settings' toggles, named in the @settings block, are put on by that plugin.
  const toggles = new Set((raw.match(/^\s*id: (dr-[a-z0-9-]+)\s*$/gm) || []).map((l) => l.trim().slice(4)));
  // Made from a name at run time: dr-mode-<id> by the workspace modes.
  const made = ['dr-mode-'];
  const classes = [...new Set((css.match(/\.dr-[a-z0-9-]+/g) || []).map((c) => c.slice(1)))];
  const unmade = classes.filter((c) => !toggles.has(c) && !made.some((p) => c.startsWith(p)) && code.indexOf(c) === -1);
  assert.deepStrictEqual(unmade, [], 'classes no code makes — take their rules out: ' + unmade.join(', '));
});

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

t('every :hover is inside @media (any-hover: hover): a touch screen would keep it stuck on', () => {
  const dir = path.join(__dirname, '..', 'styles');
  const bad = [];
  fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort().forEach((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const stack = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '{') {
        const prelude = text.slice(start, i).trim();
        const line = text.slice(0, start + text.slice(start, i).search(/\S/)).split('\n').length;
        if (/:hover/.test(prelude) && !prelude.startsWith('@') && !stack.some((p) => /^@media\b[^{]*\(\s*any-hover\s*:\s*hover\s*\)/.test(p)))
          bad.push(`styles/${f}:${line}`);
        stack.push(prelude);
        start = i + 1;
      } else if (c === '}') { stack.pop(); start = i + 1; } else if (c === ';') start = i + 1;
    }
  });
  assert.deepStrictEqual(bad, [], 'hover styles only inside @media (any-hover: hover) (AGENTS.md): ' + bad.join(', '));
});

t('a control that drops its focus outline gets a ring: a fill alone reads as the pointer’s', () => {
  const ringed = new Set();
  const bare = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const rules = [];
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map((s) => s.trim().split('\n').pop().trim()).filter((s) => /:focus-visible/.test(s) && !s.startsWith('@'));
    if (sels.length) rules.push({ sels, body: m[2] });
  }
  rules.forEach((r) => { if (/box-shadow:\s*(?!none)|outline:\s*\d/.test(r.body)) r.sels.forEach((s) => ringed.add(s)); });
  const has = (sel) => [...ringed].some((r) => r === sel || r.startsWith(sel + ' ') || r.endsWith(' ' + sel));
  rules.forEach((r) => {
    if (/outline:\s*none/.test(r.body) && !/box-shadow:\s*(?!none)/.test(r.body)) r.sels.forEach((s) => { if (!has(s)) bare.push(s); });
  });
  assert.deepStrictEqual(bare, [], 'focus shown by a fill or nothing — add it to the ring list in 06-shared.css: ' + bare.join(', '));
});

t('no scroll bar is taken away: a row that scrolls shows one, or fades at the edge it goes past', () => {
  const hidden = (css.match(/[^{}]+\{[^{}]*scrollbar-width:\s*none[^{}]*\}/g) || []).map((r) => r.split('{')[0].trim().split('\n').pop().trim());
  assert.deepStrictEqual(hidden, ['.dr-pages-capsule'], 'scroll bars hidden: ' + hidden.join(', '));
  assert.ok(/\.dr-pages-capsule\s*\{[^{}]*animation-timeline:\s*scroll\(/.test(css), 'the page control’s edges fade where it scrolls');
});

t('with more contrast, every rule that sets a line or a focus ring sets it again', () => {
  // A look that gives --dr-separator or --dr-focus-ring a value of its own would otherwise outrank the firmer one.
  const start = css.indexOf('@media (prefers-contrast: more)');
  assert.ok(start !== -1, 'no @media (prefers-contrast: more) block');
  let depth = 0;
  let end = start;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) { end = i; break; }
  }
  const inside = css.slice(start, end);
  const outside = css.slice(0, start) + css.slice(end);
  const setters = (text, token) => {
    const out = new Set();
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(text))) {
      if (new RegExp(token + '\\s*:').test(m[2])) m[1].split(',').forEach((s) => out.add(s.trim().split('\n').pop().trim()));
    }
    return out;
  };
  ['--dr-line', '--dr-separator', '--dr-focus-ring', '--dr-material'].forEach((token) => {
    const firm = setters(inside, token);
    const open = [...setters(outside, token)].filter((sel) => !sel.startsWith('@') && !firm.has(sel));
    assert.deepStrictEqual(open, [], `${token} set where more contrast doesn't set it again: ` + open.join(', '));
  });
  assert.ok(/@media \(forced-colors: active\)[\s\S]*:focus-visible[\s\S]*outline:\s*2px solid Highlight/.test(css), 'forced colours need an outline for keyboard focus: shadows are dropped there');
});

console.log(`\n${passed} passed`);
