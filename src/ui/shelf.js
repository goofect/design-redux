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
  // Under the shelf, a line kept for the name of the bar under the pointer or the ring; empty, it keeps its room, so nothing moves.
  const named = el(node, 'span', 'dr-shelf-name dr-text dr-clip');
  named.setAttribute('aria-hidden', 'true');
  opts.notes.forEach((note, i) => {
    const bar = el(bars, 'span', 'dr-bar');
    bar.dataset.name = note.name || note.label;
    // The one inline style the plugin sets: a geometry property, the bar's height in units.
    bar.style.setProperty('--dr-size', String(note.size));
    bar.setAttribute('role', 'listitem');
    bar.setAttribute('tabindex', note.current || (i === 0 && !opts.notes.some((n) => n.current)) ? '0' : '-1');
    bar.setAttribute('aria-label', note.label);
    bar.dataset.path = note.path;
    flag(bar, 'aria-current', note.current, 'page');
    flag(bar, 'aria-selected', note.selected);
  });
  // Where the row runs out: "+12", how many are not drawn (fitShelf sets it).
  if (opts.notes.length) el(bars, 'span', 'dr-shelf-more dr-small').setAttribute('aria-hidden', 'true');
  const act = (e) => {
    const bar = e.target.closest ? e.target.closest('.dr-bar') : null;
    if (bar && opts.onNote) opts.onNote(bar.dataset.path, e);
  };
  const say = (e) => {
    const bar = e.target.closest ? e.target.closest('.dr-bar') : null;
    named.textContent = bar ? bar.dataset.name : '';
  };
  bars.addEventListener('pointerover', say);
  bars.addEventListener('pointerleave', () => { named.textContent = ''; });
  bars.addEventListener('focusin', say);
  bars.addEventListener('focusout', () => { named.textContent = ''; });
  bars.addEventListener('click', act);
  bars.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(e); }
  });
  return node;
}

/**
 * Fits a shelf's bars to one row of `width` pixels: as many as fit stand, a
 * unit each; past that, the last three units say "+12" and the rest are not
 * drawn. The open note's bar always stands, in place of the last that would.
 */
export function fitShelf(node, width) {
  const bars = Array.from(node.querySelectorAll('.dr-bar'));
  const more = node.querySelector('.dr-shelf-more');
  const room = Math.floor(width / 8);
  const fits = !room || bars.length <= room;
  const shown = fits ? bars.length : Math.max(1, room - 3);
  const open = bars.findIndex((b) => b.hasAttribute('aria-current'));
  bars.forEach((bar, i) => { bar.hidden = !fits && i >= shown && i !== open; });
  if (!fits && open >= shown) bars[shown - 1].hidden = true;
  const hidden = bars.filter((b) => b.hidden).length;
  if (more) more.textContent = hidden ? `+${hidden}` : '';
  return hidden;
}
