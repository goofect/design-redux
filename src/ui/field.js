/* ------------------------------------------------------------------ */
/* Fields and chips                                                    */
/* (docs/design-language.md, "Field", "Chip")                          */
/* ------------------------------------------------------------------ */

import { asButton, el, flag, glyph } from '../core/dom.js';

/**
 * A field: its name over a square box, in the small voice; no name where the
 * placeholder says the same (the input is then named by it). { label, value,
 * placeholder, glyph, note, invalid (the reason), disabled, busy,
 * onInput(value), onEnter(value) }.
 * Returns the field; `field.drInput` is its input, `field.drSay(note, invalid)` changes what it says under.
 */
export function field(parent, opts) {
  const node = el(parent, 'label', 'dr-field');
  if (opts.label) el(node, 'span', 'dr-small', opts.label);
  const box = el(node, 'div', 'dr-field-box');
  if (opts.glyph) glyph(box, opts.glyph);
  const input = el(box, 'input', 'dr-input');
  input.type = 'text';
  input.defaultValue = opts.value || '';
  if (!opts.label && opts.placeholder) input.setAttribute('aria-label', opts.placeholder);
  input.value = opts.value || '';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.disabled = !!opts.disabled;
  flag(node, 'aria-disabled', opts.disabled);
  let note = null;
  let mark = null;
  node.drInput = input;
  node.drSay = (text, invalid, busy) => {
    flag(node, 'aria-invalid', invalid);
    flag(node, 'aria-busy', busy);
    if (mark) mark.remove();
    mark = invalid ? glyph(box, 'alert') : null;
    if (note) note.remove();
    note = text ? el(node, 'span', 'dr-field-note dr-text', text) : null;
  };
  node.drSay(opts.invalid || opts.note, !!opts.invalid, opts.busy);
  if (opts.onInput) input.addEventListener('input', () => opts.onInput(input.value));
  if (opts.onEnter) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); opts.onEnter(input.value); }
  });
  return node;
}

/**
 * A chip: plain words, no box. { name, value, checked (given: a filter
 * that can be on), disabled, invalid, run }.
 */
export function chip(parent, opts) {
  const node = el(parent, 'span', 'dr-chip');
  if (opts.name) el(node, 'span', 'dr-small', opts.name);
  el(node, 'span', 'dr-text', opts.value);
  if (opts.checked !== undefined) {
    node.setAttribute('role', 'checkbox');
    node.setAttribute('aria-checked', String(!!opts.checked));
    asButton(node, null, opts.run);
  } else if (opts.run) asButton(node, null, opts.run);
  flag(node, 'aria-disabled', opts.disabled);
  flag(node, 'aria-invalid', opts.invalid);
  return node;
}
