/* ------------------------------------------------------------------ */
/* A shelf: a folder as a row of bars, one a note                      */
/* (docs/design-language.md, "Shelf")                                  */
/* ------------------------------------------------------------------ */

import { asButton, el, flag } from '../core/dom.js';

/**
 * { name, count, current (the folder is open in the page), onHead,
 * notes: [{ size (1 to 5), label, current, selected, path }], onNote(path, event) }.
 * The bars are plain elements with one listener on the shelf, so a folder of
 * hundreds of notes costs hundreds of small nodes and nothing more.
 */
export function shelf(parent, opts) {
  const node = el(parent, 'div', 'dr-shelf');
  const head = el(node, 'div', 'dr-shelf-head');
  asButton(head, `${opts.name}, ${opts.count}`, opts.onHead);
  flag(head, 'aria-current', opts.current);
  el(head, 'span', 'dr-text dr-clip', opts.name);
  el(head, 'span', 'dr-shelf-count dr-small', String(opts.count));
  const bars = el(node, 'div', 'dr-shelf-bars');
  bars.setAttribute('role', 'list');
  opts.notes.forEach((note, i) => {
    const bar = el(bars, 'span', 'dr-bar');
    // The one inline style the plugin sets: a geometry property, the bar's height in units.
    bar.style.setProperty('--dr-size', String(note.size));
    bar.setAttribute('role', 'listitem');
    bar.setAttribute('tabindex', note.current || (i === 0 && !opts.notes.some((n) => n.current)) ? '0' : '-1');
    bar.setAttribute('aria-label', note.label);
    bar.dataset.path = note.path;
    flag(bar, 'aria-current', note.current, 'page');
    flag(bar, 'aria-selected', note.selected);
  });
  const act = (e) => {
    const bar = e.target.closest ? e.target.closest('.dr-bar') : null;
    if (bar && opts.onNote) opts.onNote(bar.dataset.path, e);
  };
  bars.addEventListener('click', act);
  bars.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(e); }
  });
  return node;
}
