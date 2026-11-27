/* ------------------------------------------------------------------ */
/* Rows: a note in a list, a folder's line in the outline, a property, */
/* a section's title                                                   */
/*                                                                     */
/* Drawn as what they are: a list is a ul of li, the properties a dl   */
/* (each row's name a dt, its value a dd, a date a time), a section's  */
/* title a heading.                                                    */
/* ------------------------------------------------------------------ */

import { asButton, el, flag } from '../core/dom.js';
import { iconButton } from './button.js';

/** A list of rows, parted by space. `outline`: the tree's list. */
export function rows(parent, opts = {}) {
  const node = el(parent, 'ul', opts.outline ? 'dr-outline' : 'dr-rows');
  node.setAttribute('role', 'list'); // kept: a list drawn as a grid is no list to some screen readers without it
  return node;
}

/** The properties' list: each row a name and its value, as a description list. */
export function termList(parent) {
  return el(parent, 'dl', 'dr-rows dr-terms');
}

/**
 * A row (never numbered). { name, end (words, grey), selected, current (true, or
 * 'page', 'location'), disabled, error (its end red: what is wrong), run, path }.
 */
export function row(list, opts) {
  const node = el(list, 'li', 'dr-row');
  asButton(node, null, opts.run);
  node.setAttribute('role', 'listitem');
  if (opts.path != null) node.dataset.path = opts.path;
  el(node, 'span', 'dr-row-name dr-text dr-clip', opts.name);
  if (opts.end != null && opts.end !== '') el(node, 'span', 'dr-row-end dr-muted', opts.end);
  flag(node, 'aria-selected', opts.selected);
  flag(node, 'aria-current', opts.current, opts.current === true ? 'true' : opts.current);
  flag(node, 'aria-disabled', opts.disabled);
  flag(node, 'aria-invalid', opts.error);
  return node;
}

/**
 * A property's row, in a termList. { name, value, datetime (a date's machine form, for a
 * time element), selected, invalid (the reason), disabled, run }. An empty value shows a dash.
 */
export function propRow(parent, opts) {
  const none = opts.value == null || opts.value === '';
  const node = el(parent, 'div', 'dr-prop');
  if (opts.run) asButton(node, null, opts.run);
  el(node, 'dt', 'dr-prop-name dr-muted dr-clip', opts.name);
  const value = el(node, 'dd', `dr-prop-value dr-text dr-clip${none ? ' dr-muted' : ''}`, opts.datetime && !none ? null : none ? '—' : String(opts.value));
  if (opts.datetime && !none) el(value, 'time', null, String(opts.value)).setAttribute('datetime', opts.datetime);
  if (opts.invalid) {
    // Wrong: the value red, and the words saying why after it.
    node.setAttribute('aria-invalid', 'true');
    node.setAttribute('aria-label', `${opts.name}: ${opts.invalid}`);
    el(node, 'dd', 'dr-prop-why', opts.invalid);
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
  const node = el(parent, 'h3', 'dr-section');
  const label = el(node, 'span', 'dr-section-name dr-muted', opts.title);
  if (opts.fold) {
    asButton(label, null, opts.fold.run);
    label.setAttribute('aria-expanded', String(!!opts.fold.open));
  }
  (opts.buttons || []).forEach((b) => iconButton(node, b));
  return node;
}
