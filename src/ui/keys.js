/* ------------------------------------------------------------------ */
/* Keys: one Tab stop a list, the arrows inside it, a letter to jump   */
/*                                                                     */
/* A grid, a list or a shelf is one stop on the Tab key; the arrow     */
/* keys, Home and End move within it, and typing the start of a name   */
/* goes to it. So every level of the library is worked from the keys.  */
/* ------------------------------------------------------------------ */

/**
 * Makes the items of `container` that match `selector` one roving group.
 * `columns()` gives how many are in a row (1 for a list). `jump` turns on
 * going to a name by typing it. Returns how to stop.
 */
export function rove(container, selector, opts = {}) {
  let typed = '';
  let typedAt = 0;
  const items = () => Array.from(container.querySelectorAll(selector)).filter((n) => n.getAttribute('aria-disabled') !== 'true');
  const go = (list, node) => {
    if (!node) return;
    list.forEach((n) => n.setAttribute('tabindex', n === node ? '0' : '-1'));
    node.focus();
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const list = items();
    const at = list.indexOf(e.target.closest ? e.target.closest(selector) : null);
    if (at < 0) return;
    const cols = Math.max(1, (opts.columns && opts.columns()) || 1);
    const moves = { ArrowRight: cols > 1 || opts.sideways ? 1 : 0, ArrowLeft: cols > 1 || opts.sideways ? -1 : 0, ArrowDown: cols, ArrowUp: -cols };
    if (e.key in moves && moves[e.key]) {
      const to = at + moves[e.key];
      if (to >= 0 && to < list.length) { e.preventDefault(); go(list, list[to]); }
    } else if (e.key === 'Home') { e.preventDefault(); go(list, list[0]); }
    else if (e.key === 'End') { e.preventDefault(); go(list, list[list.length - 1]); }
    else if (opts.jump && e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed = now - typedAt > 800 ? e.key : typed + e.key;
      typedAt = now;
      const want = typed.toLowerCase();
      const name = (n) => (n.getAttribute('aria-label') || n.textContent || '').trim().toLowerCase();
      const found = list.slice(at + (typed.length === 1 ? 1 : 0)).concat(list).find((n) => name(n).startsWith(want));
      if (found) { e.preventDefault(); go(list, found); }
    }
  };
  container.addEventListener('keydown', onKey);
  // One of them takes Tab: the current one if there is one, else the first.
  const list = items();
  const start = list.find((n) => n.hasAttribute('aria-current')) || list.find((n) => n.getAttribute('aria-selected') === 'true') || list[0];
  list.forEach((n) => n.setAttribute('tabindex', n === start ? '0' : '-1'));
  return () => container.removeEventListener('keydown', onKey);
}
