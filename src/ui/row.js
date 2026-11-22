/* ------------------------------------------------------------------ */
/* Rows: a note in a list, a folder's line in the outline, a property, */
/* a section's title                                                   */
/* ------------------------------------------------------------------ */

import { asButton, el, flag } from '../core/dom.js';
import { iconButton } from './button.js';

/** A list of rows, ruled. `outline` leaves the rules out. */
export function rows(parent, opts = {}) {
  const node = el(parent, 'div', opts.outline ? 'dr-outline' : 'dr-rows');
  node.setAttribute('role', 'list');
  return node;
}

/**
 * A row (never numbered). { name, end (words, grey), selected, current (true, or
 * 'page', 'location'), disabled, missing, error, child, run, path }.
 */
export function row(list, opts) {
  const node = el(list, 'div', `dr-row${opts.child ? ' is-child' : ''}${opts.missing ? ' is-missing' : ''}${opts.error ? ' is-error' : ''}`);
  asButton(node, null, opts.run);
  node.setAttribute('role', 'listitem');
  if (opts.path != null) node.dataset.path = opts.path;
  el(node, 'span', 'dr-row-name dr-text dr-clip', opts.name);
  if (opts.end != null && opts.end !== '') el(node, 'span', 'dr-row-end dr-muted', opts.end);
  flag(node, 'aria-selected', opts.selected);
  flag(node, 'aria-current', opts.current, opts.current === true ? 'true' : opts.current);
  flag(node, 'aria-disabled', opts.disabled);
  return node;
}

/** A property's row. { name, value, selected, invalid (the reason), disabled, run }. An empty value shows a dash. */
export function propRow(parent, opts) {
  const none = opts.value == null || opts.value === '';
  const node = el(parent, 'div', `dr-prop${none ? ' is-empty' : ''}`);
  if (opts.run) asButton(node, null, opts.run);
  el(node, 'span', 'dr-prop-name dr-muted dr-clip', opts.name);
  el(node, 'span', 'dr-prop-value dr-text dr-clip', none ? '—' : String(opts.value));
  if (opts.invalid) {
    // Wrong: the value red, and the words saying why after it.
    node.setAttribute('aria-invalid', 'true');
    node.setAttribute('aria-label', `${opts.name}: ${opts.invalid}`);
    el(node, 'span', 'dr-prop-why', opts.invalid);
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
  const label = el(node, 'span', 'dr-section-name dr-muted', opts.title);
  if (opts.fold) {
    asButton(label, null, opts.fold.run);
    label.setAttribute('aria-expanded', String(!!opts.fold.open));
  }
  (opts.buttons || []).forEach((b) => iconButton(node, b));
  return node;
}
