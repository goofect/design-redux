/* ------------------------------------------------------------------ */
/* Segments: one choice of a few, in one frame                         */
/* (docs/design-language.md, "Zoom control", "Tabs")                   */
/*                                                                     */
/* The zoom control is glyph segments (a radio group); a note's pages  */
/* are word segments (tabs). The arrow keys move the choice, as they   */
/* do in the native controls these stand for.                          */
/* ------------------------------------------------------------------ */

import { el, flag, glyph, onActivate } from '../core/dom.js';

/**
 * { label, options: [{ id, glyph, text, label, disabled }], value, onChange, tabs }.
 * Returns the element; `element.drSet(id)` shows another choice without telling `onChange`.
 */
export function segments(parent, opts) {
  const tabs = !!opts.tabs;
  const group = el(parent, 'div', `dr-segments${tabs ? ' dr-tabs' : ''}`);
  group.setAttribute('role', tabs ? 'tablist' : 'radiogroup');
  if (opts.label) group.setAttribute('aria-label', opts.label);
  const state = tabs ? 'aria-selected' : 'aria-checked';
  const items = new Map();
  const show = (id) => {
    items.forEach((node, key) => {
      node.setAttribute(state, String(key === id));
      node.setAttribute('tabindex', key === id ? '0' : '-1');
    });
    group.dataset.value = id;
  };
  const choose = (id, focus) => {
    const node = items.get(id);
    if (!node || node.getAttribute('aria-disabled') === 'true') return;
    const changed = group.dataset.value !== id;
    show(id);
    if (focus) node.focus();
    if (changed && opts.onChange) opts.onChange(id);
  };
  opts.options.forEach((option) => {
    const node = el(group, 'div', `dr-segment${tabs ? ' dr-label' : ''}`);
    node.setAttribute('role', tabs ? 'tab' : 'radio');
    if (option.label || option.glyph) node.setAttribute('aria-label', option.label || option.text);
    if (option.glyph) glyph(node, option.glyph);
    if (option.text) el(node, 'span', '', option.text);
    flag(node, 'aria-disabled', option.disabled);
    onActivate(node, () => choose(option.id));
    items.set(option.id, node);
  });
  group.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const ids = opts.options.filter((o) => !o.disabled).map((o) => o.id);
    const at = ids.indexOf(group.dataset.value);
    choose(ids[(at + step + ids.length) % ids.length], true);
  });
  show(opts.value);
  group.drSet = show;
  return group;
}
