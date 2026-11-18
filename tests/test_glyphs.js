/*
 * The plugin's own icons (docs/design-language.md, "Icons").
 *
 * The set is the few glyphs the controls need: search, back, close, more,
 * add, and the map's tools (docs/direction-reset.md: about ten). Every SVG
 * is held to the icon grammar by tests/glyph-lint.js: the one allowed form,
 * points on the grid's rules, 45° or level or upright, one step of margin,
 * centred, nothing finer than the bar. There are no object glyphs and no
 * glyph builder: a folder is its name, or its cover image.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { lintGlyph } = require('./glyph-lint.js');

const root = path.join(__dirname, '..');
const icons = path.join(root, 'assets', 'icons');

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

const names = fs.readdirSync(path.join(icons, 'actions')).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();

check('assets/icons holds the one small set, nothing else', () => {
  assert.deepStrictEqual(fs.readdirSync(icons).filter((f) => !f.startsWith('.')), ['actions']);
});

check('the set is the controls\' few: at most twelve, and these', () => {
  assert.ok(names.length <= 12, `${names.length} glyphs`);
  assert.deepStrictEqual(names, ['back', 'close', 'fit', 'fold', 'library', 'minus', 'more', 'plus', 'search', 'unfold']);
});

check('every glyph keeps the icon grammar', () => {
  const wrong = [];
  names.forEach((name) => {
    const { problems } = lintGlyph(fs.readFileSync(path.join(icons, 'actions', `${name}.svg`), 'utf8'));
    if (problems.length) wrong.push(`${name}: ${Array.from(new Set(problems)).slice(0, 3).join('; ')}`);
  });
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

check('names: lower case with hyphens', () => {
  assert.deepStrictEqual(names.filter((n) => !/^[a-z]+(-[a-z]+)*$/.test(n)), []);
});

if (!process.exitCode) console.log(`glyphs: ${names.length} glyphs keep the grammar (${checks} checks)`);
