/* ------------------------------------------------------------------ */
/* Rows: a note in a list, a folder's line in the outline, a property, */
/* a section's title                                                   */
/* (docs/design-language.md, "Row", "Outline row", "Panel row")        */
/* ------------------------------------------------------------------ */

import { asButton, el, flag, glyph } from '../core/dom.js';
import { rowNumber } from '../core/text.js';
import { iconButton } from './button.js';

/** A list of rows, ruled. `outline` leaves the rules out. */
export function rows(parent, opts = {}) {
  const node = el(parent, 'div', opts.outline ? 'dr-outline' : 'dr-rows');
  node.setAttribute('role', 'list');
  return node;
}

/**
 * A row. { number, slot (other words for the slot, as a footnote's id), name,
 * end (words), endGlyph, selected, current (true, or 'page', 'location'),
 * disabled, missing, error, child, run, path }. Only a numbered row has the
 * slot: numbers stand only where the order means something.
 */
export function row(list, opts) {
  const numbered = opts.number != null || opts.slot != null;
  const node = el(list, 'div', `dr-row${numbered ? ' is-numbered' : ''}${opts.child ? ' is-child' : ''}${opts.missing ? ' is-missing' : ''}${opts.error ? ' is-error' : ''}`);
  asButton(node, null, opts.run);
  node.setAttribute('role', 'listitem');
  if (opts.path != null) node.dataset.path = opts.path;
  if (numbered) el(el(node, 'span', 'dr-slot dr-small'), 'span', '', opts.number != null ? rowNumber(opts.number) : String(opts.slot));
  el(node, 'span', 'dr-row-name dr-text dr-clip', opts.name);
  if (opts.end != null || opts.endGlyph) {
    const end = el(node, 'span', 'dr-row-end dr-small');
    if (opts.endGlyph) glyph(end, opts.endGlyph);
    if (opts.end != null) el(end, 'span', '', opts.end);
  }
  flag(node, 'aria-selected', opts.selected);
  flag(node, 'aria-current', opts.current, opts.current === true ? 'true' : opts.current);
  flag(node, 'aria-disabled', opts.disabled);
  return node;
}

/** A folder's line in the outline. { name, count, open, toggle, path }. */
export function outlineFolder(list, opts) {
  const node = el(list, 'div', 'dr-outline-folder');
  asButton(node, null, opts.toggle);
  node.setAttribute('aria-expanded', String(!!opts.open));
  if (opts.path != null) node.dataset.path = opts.path;
  glyph(el(node, 'span', 'dr-slot'), opts.open ? 'down' : 'next');
  el(node, 'span', 'dr-text dr-clip', opts.name);
  if (opts.count != null) el(node, 'span', 'dr-row-end dr-small', String(opts.count));
  return node;
}

/** A property's row. { name, value, selected, invalid (the reason), disabled, run }. An empty value shows a dash. */
export function propRow(parent, opts) {
  const none = opts.value == null || opts.value === '';
  const node = el(parent, 'div', `dr-prop${none ? ' is-empty' : ''}`);
  if (opts.run) asButton(node, null, opts.run);
  el(node, 'span', 'dr-label dr-clip', opts.name);
  el(node, 'span', 'dr-prop-value dr-text dr-clip', none ? '—' : String(opts.value));
  if (opts.invalid) {
    node.setAttribute('aria-invalid', 'true');
    node.setAttribute('aria-label', `${opts.name}: ${opts.invalid}`);
    glyph(node, 'alert');
  }
  flag(node, 'aria-selected', opts.selected);
  flag(node, 'aria-disabled', opts.disabled);
  return node;
}

/**
 * A section's title over its rows. { title, buttons: [what iconButton takes],
 * fold: { open, run } }. A title that folds its group is pressed itself: no
 * arrow and no button, its state in aria-expanded.
 */
export function sectionTitle(parent, opts) {
  const node = el(parent, 'div', 'dr-section');
  const label = el(node, 'span', 'dr-label', opts.title);
  if (opts.fold) {
    asButton(label, null, opts.fold.run);
    label.setAttribute('aria-expanded', String(!!opts.fold.open));
  }
  (opts.buttons || []).forEach((b) => iconButton(node, b));
  return node;
}
