/* ------------------------------------------------------------------ */
/* Tabs: a note's pages, as words                                      */
/*                                                                     */
/* A tab list of words, grey, the open one ink. The arrow keys move    */
/* the choice, as they do in the native control this stands for. Many  */
/* scroll a whole tab at a time, an ellipsis at the edge.              */
/* ------------------------------------------------------------------ */

import { el, flag, onActivate } from '../core/dom.js';

/**
 * { label, options: [{ id, text, label, disabled }], value, onChange }.
 * Returns the element; `element.drSet(id)` shows another choice without telling `onChange`.
 */
export function segments(parent, opts) {
  const group = el(parent, 'div', 'dr-segments dr-tabs');
  group.setAttribute('role', 'tablist');
  if (opts.label) group.setAttribute('aria-label', opts.label);
  const state = 'aria-selected';
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
    if (focus) {
      reveal(group, node);
      node.focus();
    }
    if (changed && opts.onChange) opts.onChange(id);
  };
  opts.options.forEach((option) => {
    const node = el(group, 'div', 'dr-segment dr-text');
    node.setAttribute('role', 'tab');
    if (option.label || option.glyph) node.setAttribute('aria-label', option.label || option.text);
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
  keepWhole(group, items.get(opts.value));
  return group;
}

/** Scrolls a row of tabs, and only it, so one tab is whole in view. */
function reveal(group, node) {
  node.removeAttribute('data-cut');
  const [start, end] = [node.offsetLeft - group.offsetLeft, node.offsetLeft - group.offsetLeft + node.offsetWidth];
  const edge = group.hasAttribute('data-more-before') || group.hasAttribute('data-more-after') ? 4 * 8 : 0;
  if (start - edge < group.scrollLeft) group.scrollLeft = Math.max(0, start - edge);
  else if (end + edge > group.scrollLeft + group.clientWidth) group.scrollLeft = end + edge - group.clientWidth;
}

/**
 * Tabs that don't all fit scroll sideways, a whole tab at a time. A tab the
 * edge would cut is not drawn (`data-cut`), and an ellipsis stands at that
 * edge (`data-more-before`, `data-more-after`), so no word is ever cut in half.
 */
function keepWhole(group, open) {
  const win = group.ownerDocument.defaultView;
  if (!win || typeof win.ResizeObserver !== 'function') return;
  const fit = () => {
    if (!group.isConnected) return void watch.disconnect();
    const more = group.scrollWidth > group.clientWidth + 1;
    const before = more && group.scrollLeft > 1;
    const after = more && group.scrollLeft + group.clientWidth < group.scrollWidth - 1;
    flag(group, 'data-more-before', before);
    flag(group, 'data-more-after', after);
    const box = group.getBoundingClientRect();
    const mark = 4 * 8; // the ellipsis's room: four units
    const [left, right] = [box.left + (before ? mark : 0), box.right - (after ? mark : 0)];
    Array.from(group.children).forEach((tab) => {
      const r = tab.getBoundingClientRect();
      flag(tab, 'data-cut', more && (r.left < left - 0.5 || r.right > right + 0.5));
    });
  };
  const watch = new win.ResizeObserver(fit);
  watch.observe(group);
  group.addEventListener('scroll', fit, { passive: true });
  if (open) win.requestAnimationFrame(() => { reveal(group, open); fit(); });
}
