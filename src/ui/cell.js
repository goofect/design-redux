/* ------------------------------------------------------------------ */
/* The grid and its cells (docs/design-language.md, "Grid")            */
/*                                                                     */
/* A cell is a folder's name set large, or the cover image the person  */
/* set for it, and nothing else: no glyph, no count. A press opens it. */
/* The name is always the cell's aria-label, so its tooltip too.       */
/* ------------------------------------------------------------------ */

import { asButton, el, flag } from '../core/dom.js';

/** The grid. { label }. */
export function grid(parent, opts = {}) {
  const node = el(parent, 'div', 'dr-grid');
  node.setAttribute('role', 'list');
  if (opts.label) node.setAttribute('aria-label', opts.label);
  return node;
}

/** A cell. { name, cover (an image's address), selected, current, disabled, open, path }. */
export function cell(gridEl, opts) {
  const node = el(gridEl, 'div', 'dr-cell');
  asButton(node, opts.name, opts.open);
  node.setAttribute('role', 'listitem');
  if (opts.path != null) node.dataset.path = opts.path;
  const name = () => el(node, 'span', 'dr-display dr-clip', opts.name);
  if (opts.cover) {
    const img = el(node, 'img', 'dr-cell-cover');
    img.alt = '';
    img.src = opts.cover;
    // A cover that can't be found gives way to the name.
    img.addEventListener('error', () => {
      img.remove();
      name();
    });
  } else name();
  flag(node, 'aria-selected', opts.selected);
  flag(node, 'aria-current', opts.current, opts.current === true ? 'true' : opts.current);
  flag(node, 'aria-disabled', opts.disabled);
  return node;
}
