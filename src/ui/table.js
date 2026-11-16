/* ------------------------------------------------------------------ */
/* The table: a folder's notes at the window's width                   */
/* (docs/design-language.md, "Table")                                  */
/* ------------------------------------------------------------------ */

import { el, flag, glyph, onActivate } from '../core/dom.js';
import { rowNumber } from '../core/text.js';
import { sayso } from './state.js';

/**
 * { columns: [{ id, name, number }], rows: [{ number, cells: { id: text },
 * selected, current, disabled, invalid: [column ids], path }], numbered (the
 * number column, only where the order means something), sort: { id, down },
 * onSort(id), onRow(row, event), flush, empty: { label } }.
 */
export function table(parent, opts) {
  const node = el(parent, 'table', `dr-table${opts.flush ? ' is-flush' : ''}`);
  const head = el(el(node, 'thead'), 'tr');
  if (opts.numbered) {
    const first = el(head, 'th', 'is-slot');
    first.setAttribute('scope', 'col');
    el(first, 'span', 'dr-unseen', 'Number');
  }
  opts.columns.forEach((col) => {
    const th = el(head, 'th', col.number ? 'is-number' : '');
    th.setAttribute('scope', 'col');
    th.setAttribute('tabindex', '0');
    const inner = el(th, 'span', 'dr-th');
    el(inner, 'span', '', col.name);
    if (opts.sort && opts.sort.id === col.id) {
      th.setAttribute('aria-sort', opts.sort.down ? 'descending' : 'ascending');
      glyph(inner, opts.sort.down ? 'down' : 'up');
    }
    if (opts.onSort) onActivate(th, () => opts.onSort(col.id));
  });
  const body = el(node, 'tbody');
  if (!opts.rows.length) {
    const td = el(el(body, 'tr'), 'td');
    td.setAttribute('colspan', String(opts.columns.length + (opts.numbered ? 1 : 0)));
    sayso(td, { glyph: 'empty', label: (opts.empty && opts.empty.label) || 'Nothing here' });
    return node;
  }
  opts.rows.forEach((r) => {
    const tr = el(body, 'tr');
    tr.setAttribute('tabindex', '0');
    if (r.path != null) tr.dataset.path = r.path;
    if (opts.numbered) el(tr, 'td', 'is-slot', r.number != null ? rowNumber(r.number) : '');
    opts.columns.forEach((col) => {
      const value = r.cells[col.id];
      const td = el(tr, 'td', col.number ? 'is-number' : '');
      el(td, 'span', 'dr-cell-text', value == null ? '' : String(value));
      flag(td, 'aria-invalid', (r.invalid || []).includes(col.id));
    });
    flag(tr, 'aria-selected', r.selected);
    flag(tr, 'aria-current', r.current, 'page');
    flag(tr, 'aria-disabled', r.disabled);
    if (opts.onRow) onActivate(tr, (e) => opts.onRow(r, e));
  });
  return node;
}
