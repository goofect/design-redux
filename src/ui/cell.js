/* ------------------------------------------------------------------ */
/* Objects: the grid and its cells                                     */
/* (docs/design-language.md, "Object cell")                            */
/*                                                                     */
/* A click picks; a second click, or Enter, opens. The name and count  */
/* are always the cell's aria-label, so they are its tooltip too.      */
/* ------------------------------------------------------------------ */

import { asButton, el, flag, glyph } from '../core/dom.js';

/** The grid. { wide, labelled, label }. */
export function grid(parent, opts = {}) {
  const node = el(parent, 'div', `dr-grid${opts.wide ? ' is-wide' : ''}${opts.labelled ? ' is-labelled' : ''}`);
  node.setAttribute('role', 'list');
  if (opts.label) node.setAttribute('aria-label', opts.label);
  return node;
}

/**
 * A cell. { glyph, cover (an image's address), name, count, counted (the
 * count in words, for the label), selected, current, disabled, flag (what is
 * wrong, in words), pick, open, path }.
 */
export function cell(gridEl, opts) {
  const node = el(gridEl, 'div', 'dr-cell');
  const said = [opts.name, opts.counted, opts.flag].filter(Boolean).join(', ');
  asButton(node, said);
  node.setAttribute('role', 'listitem');
  if (opts.path != null) node.dataset.path = opts.path;
  if (opts.cover) {
    const img = el(node, 'img', 'dr-cell-cover');
    img.alt = '';
    img.src = opts.cover;
    // A cover that can't be found gives way to the glyph, and says so.
    img.addEventListener('error', () => {
      img.remove();
      node.insertBefore(glyph(node, opts.glyph), node.firstChild);
      if (!node.querySelector('.dr-cell-flag')) glyph(el(node, 'span', 'dr-cell-flag'), 'alert');
    });
  } else glyph(node, opts.glyph);
  const label = el(node, 'span', 'dr-cell-label dr-label');
  el(label, 'span', 'dr-cell-name dr-clip', opts.name);
  if (opts.count != null) el(label, 'span', 'dr-cell-count', String(opts.count));
  if (opts.flag) glyph(el(node, 'span', 'dr-cell-flag'), 'alert');
  flag(node, 'aria-selected', opts.selected);
  flag(node, 'aria-current', opts.current);
  flag(node, 'aria-disabled', opts.disabled);
  const off = () => node.getAttribute('aria-disabled') === 'true';
  node.addEventListener('click', (e) => {
    if (off()) return;
    if (node.getAttribute('aria-selected') === 'true' && opts.open) opts.open(e);
    else if (opts.pick) opts.pick(e);
    else if (opts.open) opts.open(e);
  });
  node.addEventListener('keydown', (e) => {
    if (e.target !== node || off()) return;
    if (e.key === 'Enter' && opts.open) { e.preventDefault(); opts.open(e); }
    else if ((e.key === ' ' || e.key === 'Enter') && opts.pick) { e.preventDefault(); opts.pick(e); }
  });
  return node;
}
