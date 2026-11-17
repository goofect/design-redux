/*
 * The plugin's own icons and the glyph builder (docs/design-language.md, "Icons").
 *
 * Every SVG under assets/icons is held to the icon grammar by tests/glyph-lint.js:
 * the one allowed form, points on the grid's rules, 45° or level or upright,
 * one step of margin, centred, nothing finer than the bar. Then the set as a
 * whole: enough of each kind, one name each, a glyph for every command. Then
 * the builder (next/src/core/glyphs.js): the same glyph for the same path on
 * any run, spread evenly, siblings told apart, and a choice kept through a rename.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const esbuild = require('esbuild');
const { lintGlyph } = require('./glyph-lint.js');

const root = path.join(__dirname, '..');
const icons = path.join(root, 'assets', 'icons');
const builderFile = path.join(root, 'src', 'core', 'glyphs.js');

/** An ES module of the new tree, loaded here as the bundle will carry it. */
function load(file) {
  const { code } = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { format: 'cjs', loader: 'js' });
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  return mod.exports;
}

let checks = 0;
const check = (name, fn) => {
  try {
    fn();
    checks++;
  } catch (err) {
    console.log(`not ok  ${name}\n${String(err.message).split('\n').slice(0, 12).join('\n')}`);
    process.exitCode = 1;
  }
};

// ---- The files ----

const sets = {};
['actions', 'objects'].forEach((kind) => {
  sets[kind] = fs.readdirSync(path.join(icons, kind)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
});
const stray = fs.readdirSync(icons).filter((f) => !['actions', 'objects', 'actions.json'].includes(f) && !f.startsWith('.'));

check('assets/icons holds the two sets and the command list, nothing else', () => assert.deepStrictEqual(stray, []));

check('every glyph keeps the icon grammar', () => {
  const wrong = [];
  Object.keys(sets).forEach((kind) => sets[kind].forEach((name) => {
    const { problems } = lintGlyph(fs.readFileSync(path.join(icons, kind, `${name}.svg`), 'utf8'));
    if (problems.length) wrong.push(`${kind}/${name}: ${Array.from(new Set(problems)).slice(0, 3).join('; ')}`);
  }));
  assert.deepStrictEqual(wrong, []);
});

check('the lint itself refuses what the grammar refuses', () => {
  const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${body}</svg>\n`;
  const refused = {
    'a stroke': svg('<path stroke="currentColor" d="M3 3L21 3L21 21L3 21Z"/>'),
    'another element': svg('<rect x="3" y="3" width="18" height="18"/>'),
    'a point off the rules': svg('<path d="M3 3L21 3L21 20L3 20Z"/>'),
    'a slope that is not 45°': svg('<path d="M3 21L12 3L21 21Z"/>'),
    'a hairline': svg('<path d="M3 3L21 3L21 4.5L3 4.5Z"/><path d="M3 9L21 9L21 21L3 21Z"/>'),
    'a pinched gap': svg('<path d="M3 3L21 3L21 10.5L3 10.5Z"/><path d="M3 12L21 12L21 21L3 21Z"/>'),
    'the margin drawn into': svg('<path d="M0 3L21 3L21 21L0 21Z"/>'),
    'off centre': svg('<path d="M3 3L12 3L12 12L3 12Z"/>'),
    'a curve that is not a circle': svg('<path d="M3 12A9 6 0 1 0 21 12A9 6 0 1 0 3 12Z"/>'),
  };
  Object.keys(refused).forEach((what) => assert.ok(lintGlyph(refused[what]).problems.length, `the lint let through ${what}`));
  assert.deepStrictEqual(lintGlyph(svg('<path d="M3 3L21 3L21 21L3 21Z"/>')).problems, []);
});

check('names: lower case with hyphens, and one glyph a name across both sets', () => {
  const all = sets.actions.concat(sets.objects);
  assert.deepStrictEqual(all.filter((n) => !/^[a-z]+(-[a-z]+)*$/.test(n)), []);
  assert.deepStrictEqual(all.filter((n, i) => all.indexOf(n) !== i), []);
});

check('at least 60 action glyphs and 40 object glyphs', () => {
  assert.ok(sets.actions.length >= 60, `${sets.actions.length} action glyphs`);
  assert.ok(sets.objects.length >= 40, `${sets.objects.length} object glyphs`);
});

check('every command has a glyph, and the list names only commands and glyphs there are', () => {
  const uses = JSON.parse(fs.readFileSync(path.join(icons, 'actions.json'), 'utf8'));
  const { commands } = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshots', 'lifecycle.json'), 'utf8'));
  assert.deepStrictEqual(commands.filter((id) => !uses[id]), [], 'commands without a glyph');
  assert.deepStrictEqual(Object.keys(uses).filter((id) => !sets.actions.includes(uses[id])), [], 'commands naming a glyph that is not drawn');
});

// ---- The builder ----

const { GLYPHS, GLYPH_FAMILIES, glyphFor, glyphsAmong, glyphFamily, hashText, isGlyph } = load(builderFile);

check("the builder's set is the object glyphs drawn, in equal families", () => {
  assert.deepStrictEqual(GLYPHS.slice().sort(), sets.objects);
  const sizes = Object.values(GLYPH_FAMILIES).map((f) => f.length);
  assert.ok(sizes.every((n) => n === sizes[0]), `families of ${sizes}`);
  assert.ok(GLYPHS.every((g) => isGlyph(g) && GLYPH_FAMILIES[glyphFamily(g)].includes(g)));
});

check('the same path gives the same glyph: on any run, on any machine', () => {
  // Written down once: if one of these moves, every unpicked folder in every vault changes its face.
  const fixed = { Inbox: 'flag', 'Projects/Thesis': 'saltire', 'Reading/Political theory': 'fish', 'Logic/Week 03': 'heart', 'Été/Café': 'mountain' };
  Object.keys(fixed).forEach((p) => assert.strictEqual(glyphFor(p), fixed[p], p));
  assert.strictEqual(hashText('Inbox'), 1588962792);
  // One name, composed or decomposed (as a Mac's disk gives it), is one folder.
  assert.strictEqual(glyphFor('Été/Café'.normalize('NFD')), glyphFor('Été/Café'.normalize('NFC')));
  // What's in the folder is no part of it: only the path is asked for.
  assert.strictEqual(glyphFor.length, 1);
});

/** Sample paths like a real vault's: a few hundred names, nested, many differing by a digit. */
function samplePaths(n) {
  const words = ['Inbox', 'Journal', 'Reading', 'Projects', 'Lectures', 'Essays', 'Seminar', 'Logic', 'Field notes', 'Archive', 'People', 'Recipes', 'Travel', 'Drafts', 'Sources', 'Methods', 'Thesis', 'Week', 'Chapter', 'Notes'];
  const out = [];
  for (let i = 0; out.length < n; i++) {
    const a = words[i % words.length];
    const b = words[(i * 7 + 3) % words.length];
    out.push(i % 3 === 0 ? `${a} ${i}` : i % 3 === 1 ? `${a}/${b} ${String(i).padStart(2, '0')}` : `${a}/${b}/${2000 + (i % 40)} ${i}`);
  }
  return out;
}

check('1,000 paths spread across the set without clustering', () => {
  const counts = new Map(GLYPHS.map((g) => [g, 0]));
  samplePaths(1000).forEach((p) => counts.set(glyphFor(p), counts.get(glyphFor(p)) + 1));
  const expected = 1000 / GLYPHS.length;
  const chi = Array.from(counts.values()).reduce((sum, n) => sum + ((n - expected) ** 2) / expected, 0);
  // 47 degrees of freedom: an even spread stays under 82.7 999 times in 1,000.
  assert.ok(chi < 82.7, `chi-squared ${chi.toFixed(1)}`);
  assert.ok(Math.min(...counts.values()) >= 6 && Math.max(...counts.values()) <= 42, `from ${Math.min(...counts.values())} to ${Math.max(...counts.values())} uses of a glyph`);
  const families = Object.values(GLYPH_FAMILIES).map((f) => f.reduce((n, g) => n + counts.get(g), 0));
  assert.ok(Math.min(...families) > 125 && Math.max(...families) < 210, `families ${families}`);
});

check('names one letter apart do not share a glyph more than chance allows', () => {
  let same = 0;
  for (let i = 0; i < 400; i++) if (glyphFor(`Notes/Week ${i}`) === glyphFor(`Notes/Week ${i + 1}`)) same++;
  assert.ok(same <= 20, `${same} of 400 neighbours alike`); // chance: about 8
});

check('siblings are told apart: no two alike while the set lasts, families kept even', () => {
  const load = (given) => Object.values(GLYPH_FAMILIES).map((f) => f.filter((g) => Object.values(given).includes(g)).length);
  [3, 6, 9, 12, 24, 48].forEach((n) => {
    ['Week ', 'Chapter 0', '19', 'x'].forEach((stem) => {
      const paths = Array.from({ length: n }, (_, i) => `Course/${stem}${i + 1}`);
      const given = glyphsAmong(paths);
      assert.strictEqual(new Set(Object.values(given)).size, n, `${n} siblings named ${stem}…: a glyph used twice`);
      const perFamily = load(given);
      assert.ok(Math.max(...perFamily) - Math.min(...perFamily) <= 1, `${n} siblings named ${stem}…: families ${perFamily}`);
    });
  });
  // Up to six siblings are six different builds.
  assert.strictEqual(new Set(Object.values(glyphsAmong(['a', 'b', 'c', 'd', 'e', 'f'])).map(glyphFamily)).size, 6);
  // Past the set, repeats are as few as can be.
  const many = Object.values(glyphsAmong(Array.from({ length: 60 }, (_, i) => `Big/${i}`)));
  const uses = GLYPHS.map((g) => many.filter((m) => m === g).length);
  assert.deepStrictEqual([Math.min(...uses), Math.max(...uses)], [1, 2]);
});

check('the order the siblings are given in changes nothing', () => {
  const paths = samplePaths(30).map((p) => `Shelf/${p.replace(/\//g, ' ')}`);
  assert.deepStrictEqual(glyphsAmong(paths.slice().reverse()), glyphsAmong(paths));
  assert.deepStrictEqual(glyphsAmong(paths.concat(paths)), glyphsAmong(paths));
});

check('a choice is kept, and a folder made later changes no face already there', () => {
  const first = ['Lib/Essays', 'Lib/Journal', 'Lib/Logic', 'Lib/Reading'];
  const settled = glyphsAmong(first, { 'Lib/Logic': 'cat', 'Lib/Old': 'not-a-glyph' });
  assert.strictEqual(settled['Lib/Logic'], 'cat');
  assert.strictEqual(new Set(Object.values(settled)).size, 4);
  for (let i = 0; i < 40; i++) {
    const later = glyphsAmong(first.concat(`Lib/New ${i}`), settled);
    first.forEach((p) => assert.strictEqual(later[p], settled[p], `${p} changed when Lib/New ${i} was made`));
    assert.ok(!Object.values(settled).includes(later[`Lib/New ${i}`]), 'the newcomer took a glyph a sibling has');
  }
  // A picked glyph may repeat a sibling's: the person's choice stands.
  assert.strictEqual(glyphsAmong(['a', 'b'], { a: 'cat', b: 'cat' }).b, 'cat');
});

if (!process.exitCode) console.log(`glyphs: ${sets.actions.length} action and ${sets.objects.length} object glyphs keep the grammar; the builder holds (${checks} checks)`);
