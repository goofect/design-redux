// The specimen's first part: the four colours as measured, the one face at its two sizes, the unit, and the few glyphs.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { root, actions, glyph, esc, section } from './kit.mjs';

const require = createRequire(import.meta.url);
const { measure, schemeTokens, tokensFile } = require(`${root}/tests/contrast.js`);

const tokensCss = fs.readFileSync(tokensFile, 'utf8');
const light = schemeTokens(tokensCss, 'light');
const dark = schemeTokens(tokensCss, 'dark');

const swatch = (name, use, on = 'ink') => `<div class="spec-swatch"><div class="spec-chip" style="background:var(--dr-${name});color:var(--dr-${on})">Aa 13</div><div>${name}</div><div class="dr-muted">${light[name]} · ${dark[name]}</div><div class="dr-muted">${esc(use)}</div></div>`;

export function palette() {
  const swatches = [
    swatch('bg', 'The ground, and the words on what is inverted.'), swatch('ink', 'Words, lines, the inverted fill.', 'bg'),
    swatch('muted', 'The one grey: secondary words only.', 'bg'), swatch('error', 'An error, always with its words.', 'bg'),
  ].join('');
  const { block, pairs } = measure();
  const sizes = `<div class="spec-voices">
    <div><div class="dr-display">Logic</div><div class="dr-muted">The display size, 48px on a 48px line: the one name that matters on a screen.</div></div>
    <div><div>Natural deduction: the conditional</div><div class="dr-muted">Everything else, 13px on a 16px line; 24px when it runs on. One face, Helvetica as it comes, no tracking, no capitals for effect.</div></div>
  </div>`;
  const units = [[1, 'the unit'], [2, 'the gutter · a glyph · a line'], [4, 'a row · a control'], [6, 'a head · the display line']]
    .map(([n, use]) => `<div class="spec-unit"><div class="spec-unit-box" style="width:${n * 8}px;height:${n * 8}px"></div><div>${n} · ${n * 8}px</div><div class="dr-muted">${use}</div></div>`).join('');
  return section('palette', 'Colour, type, unit', `Black, white, one grey, and red for an error, each scheme's values measured: ${pairs} pairs, none under 4.5. Light value · dark value under each. One face at two sizes, and the 8px unit.`,
    `<div class="spec-swatches">${swatches}</div><pre class="spec-measured dr-text">${esc(block.split('\n').slice(1, -1).map((l) => l.slice(3)).join('\n'))}</pre>${sizes}<div class="spec-units">${units}</div>`);
}

const cell = (name) => `<div class="spec-glyph">${glyph(name, 48)}<div class="spec-glyph-small">${glyph(name, 24)}${glyph(name, 16)}</div><div class="dr-muted">${name}</div></div>`;

export function glyphs() {
  const names = Object.keys(actions);
  return section('glyphs', `Glyphs · ${names.length}`, 'The few a control needs, where a glyph is plainer than a word: search, back, close, more, add, and the map’s tools. Everything else is a word. Built from the bar: three units wide, on a 24-unit canvas ruled every 1.5; each at 48, 24 and 16px.',
    `<div class="spec-glyphs">${names.map(cell).join('')}</div>`);
}
