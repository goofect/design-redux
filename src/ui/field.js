/* ------------------------------------------------------------------ */
/* Fields and chips                                                    */
/* ------------------------------------------------------------------ */

import { asButton, el, flag, glyph } from '../core/dom.js';

/** A bare text input, the plugin's: { cls (of what holds it, made when given), label (for a screen reader), placeholder, value }. */
export function textInput(parent, opts = {}) {
  const input = el(opts.cls ? el(parent, 'span', opts.cls) : parent, 'input', 'dr-input');
  input.type = 'text';
  if (opts.value != null) input.value = String(opts.value);
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.label) input.setAttribute('aria-label', opts.label);
  return input;
}

/**
 * A field: its name over its input, a line under it; no name where the
 * placeholder says the same (the input is then named by it). { label, value,
 * placeholder, glyph, note, invalid (the reason), disabled, busy,
 * onInput(value), onEnter(value) }.
 * Returns the field; `field.drInput` is its input, `field.drSay(note, invalid)` changes what it says under.
 */
export function field(parent, opts) {
  const node = el(parent, 'label', 'dr-field');
  if (opts.label) el(node, 'span', 'dr-muted', opts.label);
  const box = el(node, 'div', 'dr-field-box');
  if (opts.glyph) glyph(box, opts.glyph);
  const input = textInput(box, { label: opts.label ? null : opts.placeholder, placeholder: opts.placeholder });
  input.defaultValue = opts.value || '';
  input.value = opts.value || '';
  input.disabled = !!opts.disabled;
  flag(node, 'aria-disabled', opts.disabled);
  let note = null;
  node.drInput = input;
  node.drSay = (text, invalid, busy) => {
    flag(node, 'aria-invalid', invalid);
    flag(node, 'aria-busy', busy);
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
  if (opts.name) el(node, 'span', 'dr-muted', opts.name);
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
