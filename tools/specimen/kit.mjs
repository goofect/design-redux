// The specimen's tools: the glyph files as inline SVG, the stylesheet with its
// states held still, and small helpers for writing markup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const first = (...dirs) => dirs.map((d) => path.join(root, d)).find((d) => fs.existsSync(d));
export const stylesDir = first('styles/00-tokens.css', 'next/styles/00-tokens.css').replace(/00-tokens\.css$/, '');
export const builderFile = first('src/core/glyphs.js', 'next/src/core/glyphs.js');
const iconsDir = path.join(root, 'assets', 'icons');

/** Every glyph of one set, by name: the paths inside its file. */
function readSet(kind) {
  const out = {};
  fs.readdirSync(path.join(iconsDir, kind)).filter((f) => f.endsWith('.svg')).sort().forEach((f) => {
    out[f.slice(0, -4)] = fs.readFileSync(path.join(iconsDir, kind, f), 'utf8').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  });
  return out;
}
export const actions = readSet('actions');
export const objects = readSet('objects');
export const commands = JSON.parse(fs.readFileSync(path.join(iconsDir, 'actions.json'), 'utf8'));

/** A glyph as the plugin draws it. `px` sets its size where the place it stands in doesn't. */
export function glyph(name, px) {
  const body = actions[name] || objects[name];
  if (!body) throw new Error(`no glyph named ${name}`);
  return `<svg class="dr-glyph" viewBox="0 0 24 24" aria-hidden="true"${px ? ` style="--dr-glyph:${px}px"` : ''}>${body}</svg>`;
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** Attributes from an object; a false or missing value leaves the attribute out. */
export const attrs = (o = {}) => Object.entries(o).filter(([, v]) => v !== false && v != null).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
/** An icon button. */
export const iconButton = (name, label, a = {}) => `<div class="dr-icon-button ${a.class || ''}" role="button" tabindex="0" aria-label="${esc(label)}"${attrs({ ...a, class: false })}>${glyph(name)}</div>`;

/** The parts of the stylesheet, joined in order as the build joins them. */
export function stylesheet() {
  return fs.readdirSync(stylesDir).filter((f) => /^\d{2}-[a-z0-9-]+\.css$/.test(f)).sort().map((f) => fs.readFileSync(path.join(stylesDir, f), 'utf8')).join('\n');
}

/** A stylesheet's top-level statements: [{ head, body, text }]. */
function statements(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (!depth) open = i; depth++; }
    else if (css[i] === '}') {
      depth--;
      if (!depth) { out.push({ head: css.slice(start, open).trim(), body: css.slice(open + 1, i), text: css.slice(start, i + 1) }); start = i + 1; }
    }
  }
  return out;
}

const FORCED = [[':focus-visible', '.spec-focus'], [':focus-within', '.spec-focus'], [':active', '.spec-active']];
/** A rule again, for elements that carry a class in place of a pointer or a key press. */
function held(rule, pairs) {
  return pairs.map(([pseudo, cls]) => {
    const picked = rule.head.split(',').map((s) => s.trim()).filter((s) => s.includes(pseudo));
    return picked.length ? `${picked.map((s) => s.split(pseudo).join(cls)).join(',')}{${rule.body}}` : '';
  }).join('');
}

/**
 * The stylesheet with every state that needs a pointer or a key press given a
 * twin that a class holds still: .spec-hover for :hover, .spec-focus for the
 * ring, .spec-active for pressed. Each twin follows the rule it copies, so the
 * cascade is the one the plugin ships.
 */
export function withHeldStates(css) {
  return statements(css.replace(/\/\*[\s\S]*?\*\//g, '')).map((rule) => {
    if (/^@media[^{]*any-hover:\s*hover/.test(rule.head)) return rule.text + statements(rule.body).map((inner) => held(inner, [[':hover', '.spec-hover']])).join('');
    if (rule.head.startsWith('@')) return rule.text;
    return rule.text + held(rule, FORCED);
  }).join('\n');
}

/** A captioned example: what state it shows, and the thing itself. */
export const shown = (caption, html, cls = '') => `<figure class="spec-shown ${cls}"><div class="spec-thing">${html}</div><figcaption class="dr-label dr-muted">${esc(caption)}</figcaption></figure>`;
/** A component: its name, a line on what it is for, and its states in a row. */
export const component = (name, note, items) => `<div class="spec-component"><div class="spec-component-head"><span class="dr-label">${esc(name)}</span><span class="dr-text dr-muted">${esc(note)}</span></div><div class="spec-states">${items.join('')}</div></div>`;
/** A section of the page; `id` names its screenshot. */
export const section = (id, title, note, html) => `<section class="spec-section" id="${id}" data-shot="${id}"><header class="spec-section-head"><h2 class="dr-label">${esc(title)}</h2><p class="dr-text dr-muted">${esc(note)}</p></header>${html}</section>`;
