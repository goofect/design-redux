// The specimen's first half: the palette as measured, the voices, the unit, and every glyph.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { root, actions, objects, commands, glyph, esc, section } from './kit.mjs';

const require = createRequire(import.meta.url);
const { measure, schemeTokens, tokensFile } = require(`${root}/tests/contrast.js`);

const tokensCss = fs.readFileSync(tokensFile, 'utf8');
const light = schemeTokens(tokensCss, 'light');
const dark = schemeTokens(tokensCss, 'dark');

const swatch = (name, use, on = 'ink') => `<div class="spec-swatch"><div class="spec-chip" style="background:var(--dr-${name});color:var(--dr-${on})"><span class="dr-label">Aa 12</span></div><div class="dr-small">${name}</div><div class="dr-small dr-muted">${light[name]} · ${dark[name]}</div><div class="dr-text dr-muted">${esc(use)}</div></div>`;

export function palette() {
  const neutrals = [
    swatch('bg', 'Bone: every surface.'), swatch('surface', 'Ash: under the pointer, and pressed. Words on it are ink.'),
    swatch('ink', 'Text, glyphs, hairlines, the ring.', 'bg'), swatch('muted', 'Secondary words, on the ground only.', 'bg'),
    swatch('clay', 'The fill behind what is selected or open. Never text.', 'on-clay'),
    `<div class="spec-swatch"><div class="spec-chip" style="background:var(--dr-clay);color:var(--dr-on-clay);grid-auto-flow:column;gap:8px;justify-content:center"><span class="dr-mark"></span><span class="dr-label">Aa 12</span></div><div class="dr-small">on-clay</div><div class="dr-small dr-muted">${light['on-clay']} · ${dark['on-clay']}</div><div class="dr-text dr-muted">Words, glyphs and marks on clay: dark in both schemes.</div></div>`,
  ].join('');
  const tones = ['rust', 'ochre', 'moss', 'slate', 'plum'].map((t) => `<div class="spec-tone"><div class="spec-chip" style="background:var(--dr-${t});color:var(--dr-bg)"><span class="dr-label">${t}</span></div><div class="spec-chip" style="background:var(--dr-${t}-soft)"></div><div class="dr-text" style="color:var(--dr-${t})">Words in ${t}, and <span style="border-bottom:1px solid var(--dr-${t})">a line of it</span>.</div><div class="dr-label dr-muted">${light[t]} · ${dark[t]}</div></div>`).join('');
  const { block, pairs } = measure();
  const voices = `<div class="spec-voices">
    <div><div class="dr-label">Properties</div><div class="dr-text dr-muted">The label voice. ${light['label-size'] || '11px'} on a 16px line, capitals, tracked 0.08em, medium. A section's title and a property's name, nothing else.</div></div>
    <div><div class="dr-small">24 notes · 9 min</div><div class="dr-text dr-muted">The small voice. The same size, sentence case, no tracking. What trails or counts, a field's name, a caption.</div></div>
    <div><div class="dr-text">Natural deduction: the conditional</div><div class="dr-text dr-muted">The reading voice. 13px on a 16px line in a row; sentence case, no tracking. Anything that is read.</div></div>
    <div><div class="dr-text is-running">Running text keeps the size and takes a 24px line, so a paragraph in a sheet stays on the unit and stays easy on the eye.</div><div class="dr-text dr-muted">The reading voice, running on.</div></div>
    <div><div class="dr-title">Move 12 notes to Archive</div><div class="dr-text dr-muted">The one larger size a region may use, for its title. 20px on a 24px line, regular.</div></div>
  </div>`;
  const units = [[1, 'unit · the mark'], [2, 'gutter · a glyph · a line'], [3, 'the slot · a loose line · a chip'], [4, 'a row · a control'], [6, 'an object · a head row · the strip'], [8, 'an object, wide'], [12, 'an object, large']]
    .map(([n, use]) => `<div class="spec-unit"><div class="spec-unit-box" style="width:${n * 8}px;height:${n * 8}px"></div><div class="dr-small">${n} · ${n * 8}px</div><div class="dr-small dr-muted">${use}</div></div>`).join('');
  return section('palette', 'Palette, voices, unit', `Six neutrals and five earth tones, each scheme's values measured: ${pairs} pairs, none under its floor. Light value · dark value under each.`,
    `<div class="spec-swatches">${neutrals}</div><div class="spec-tones">${tones}</div><pre class="spec-measured dr-text">${esc(block.split('\n').slice(1, -1).map((l) => l.slice(3)).join('\n'))}</pre>${voices}<div class="spec-units">${units}</div>`);
}

const cell = (name) => `<div class="spec-glyph">${glyph(name, 48)}<div class="spec-glyph-small">${glyph(name, 24)}${glyph(name, 16)}</div><div class="dr-small dr-muted">${name}</div></div>`;

export function glyphs(families) {
  const acts = Object.keys(actions);
  const fams = Object.entries(families).map(([family, names]) => `<div class="spec-family"><div class="dr-label">${family}</div><div class="spec-glyphs is-family">${names.map(cell).join('')}</div></div>`).join('');
  return section('glyphs-actions', `Action glyphs · ${acts.length}`, 'What a control shows. Built from the bar: three units wide, on a 24-unit canvas ruled every 1.5. Each at 48, 24 and 16px.', `<div class="spec-glyphs">${acts.map(cell).join('')}</div>`)
    + section('glyphs-objects', `Object glyphs · ${Object.keys(objects).length}`, 'What a folder is. One closed shape each, in six families of look-alikes; folders that share a parent are drawn from different families.', fams);
}

export function commandList() {
  const rows = Object.entries(commands).map(([id, name]) => `<div class="spec-command">${glyph(name)}<span class="dr-text">${id}</span></div>`).join('');
  return section('commands', `Commands · ${Object.keys(commands).length}`, 'Every command id in the inventory and the glyph it takes.', `<div class="spec-commands">${rows}</div>`);
}
