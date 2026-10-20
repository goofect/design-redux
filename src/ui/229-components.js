/* ------------------------------------------------------------------ */
/* Components: nine shared pieces                                      */
/*                                                                     */
/* The Apple look's pieces, each one helper here and one block in      */
/* styles.css, so a button on the strip, in the panel and in the       */
/* browse view is the same button: icon button, text button, segmented */
/* control, row, tile, chip, menu, sheet, and (in CSS) toggle and      */
/* field. Every one is reachable by keyboard and named for a reader.   */
/* ------------------------------------------------------------------ */

import { Menu, setIcon } from 'obsidian';
import { showMenuAt } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';

/** Whether the Apple look is on: what a screen draws differently under it, beyond its styles. */
export function isAppleLook() {
  return typeof document !== 'undefined' && !!document.body && document.body.classList.contains('dr-look-apple');
}

/** A toolbar button: a symbol alone, its name the tooltip. */
export function drIconButton(parent, icon, label, run) {
  const el = parent.createDiv({ cls: 'dr-icon-button clickable-icon' });
  asButton(el, label);
  setIcon(el, icon);
  if (run) onActivate(el, run);
  return el;
}

/** A text button: filled in the accent for the one main action, plain accent text otherwise. */
export function drTextButton(parent, label, run, opts = {}) {
  const el = parent.createDiv({ cls: 'dr-text-button' });
  if (opts.primary) el.addClass('is-primary');
  asButton(el, label);
  if (opts.icon) setIcon(el.createSpan({ cls: 'dr-text-button-icon' }), opts.icon);
  el.createSpan({ text: label });
  if (run) onActivate(el, run);
  return el;
}

/**
 * A segmented control: one track, the chosen segment raised. `items` are
 * { id, label, icon? }; `onChange(id)` runs when another is chosen, by
 * click or by the arrow keys.
 */
export function drSegmented(parent, items, value, onChange) {
  const el = parent.createDiv({ cls: 'dr-segmented' });
  el.setAttribute('role', 'tablist');
  const segments = items.map((item) => {
    const seg = el.createDiv({ cls: 'dr-segment' });
    seg.dataset.id = item.id;
    seg.setAttribute('role', 'tab');
    asButton(seg, item.label);
    if (item.icon) setIcon(seg.createSpan(), item.icon);
    seg.createSpan({ text: item.label });
    return seg;
  });
  const choose = (id, fire) => {
    segments.forEach((seg) => {
      const on = seg.dataset.id === id;
      seg.toggleClass('is-active', on);
      seg.setAttribute('aria-selected', String(on));
      seg.setAttribute('tabindex', on ? '0' : '-1');
    });
    if (fire && onChange) onChange(id);
  };
  segments.forEach((seg) => onActivate(seg, () => choose(seg.dataset.id, true)));
  el.addEventListener('keydown', (evt) => {
    if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
    evt.preventDefault();
    const at = segments.findIndex((s) => s.hasClass('is-active'));
    const next = segments[Math.max(0, Math.min(segments.length - 1, at + (evt.key === 'ArrowRight' ? 1 : -1)))];
    choose(next.dataset.id, true);
    next.focus();
  });
  choose(value, false);
  return el;
}

/** A list row: an optional cover, a title and one muted line, a value or chevron at the end. */
export function drRow(parent, opts) {
  const el = parent.createDiv({ cls: 'dr-list-row' });
  if (opts.cover) opts.cover(el.createDiv({ cls: 'dr-list-row-cover' }));
  const text = el.createDiv({ cls: 'dr-list-row-text' });
  text.createDiv({ cls: 'dr-list-row-title', text: opts.title });
  if (opts.line) text.createDiv({ cls: 'dr-list-row-line', text: opts.line });
  if (opts.end) el.createDiv({ cls: 'dr-list-row-end', text: opts.end });
  else if (opts.run) setIcon(el.createDiv({ cls: 'dr-list-row-end' }), 'chevron-right');
  if (opts.run) {
    asButton(el, opts.title);
    onActivate(el, opts.run);
  }
  return el;
}

/** A tile: a square cover, the title and one muted line below. */
export function drTile(parent, opts) {
  const el = parent.createDiv({ cls: 'dr-tile' });
  const art = el.createDiv({ cls: 'dr-tile-art' });
  if (opts.cover) opts.cover(art);
  el.createDiv({ cls: 'dr-tile-title', text: opts.title });
  if (opts.line) el.createDiv({ cls: 'dr-tile-line', text: opts.line });
  if (opts.run) {
    asButton(el, opts.title);
    onActivate(el, opts.run);
  }
  return el;
}

/** A chip: a tag or token in a muted capsule. */
export function drChip(parent, text, opts = {}) {
  const el = parent.createSpan({ cls: 'dr-chip', text });
  if (opts.label) el.setAttribute('aria-label', opts.label);
  return el;
}

/** How many entries a menu shows before the rest go under More. */
export const MENU_TOP = 7;

/**
 * A context menu: `entries` are { title, icon, run, warning? }. Every one
 * has an icon; past seven the rest go under one More submenu where the
 * version allows; destructive entries come last, in red.
 */
export function drMenu(evt, entries) {
  const menu = new Menu();
  const plain = entries.filter((e) => !e.warning);
  const danger = entries.filter((e) => e.warning);
  const add = (target, e) =>
    target.addItem((item) => {
      item.setTitle(e.title).setIcon(e.icon || 'dot').onClick(() => e.run());
      if (e.warning && typeof item.setWarning === 'function') item.setWarning(true);
      if (typeof item.setSection === 'function') item.setSection(e.warning ? 'danger' : 'action');
    });
  const top = plain.slice(0, MENU_TOP);
  const rest = plain.slice(MENU_TOP);
  top.forEach((e) => add(menu, e));
  if (rest.length) {
    let nested = null;
    menu.addItem((item) => {
      item.setTitle('More').setIcon('more-horizontal');
      if (typeof item.setSection === 'function') item.setSection('action');
      nested = typeof item.setSubmenu === 'function' ? item.setSubmenu() : null;
    });
    rest.forEach((e) => add(nested || menu, e));
  }
  danger.forEach((e) => add(menu, e));
  showMenuAt(menu, evt);
  return menu;
}

/** A sheet's opening: from where it was pressed, in the slow duration. */
export function drSheetIn(el, anchor) {
  if (anchor && typeof anchor.getBoundingClientRect === 'function' && typeof el.getBoundingClientRect === 'function') {
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width && r.height) {
      const x = Math.round(((a.left + a.width / 2 - r.left) / r.width) * 100);
      const y = Math.round(((a.top + a.height / 2 - r.top) / r.height) * 100);
      el.style.setProperty('--dr-origin', `${Math.max(0, Math.min(100, x))}% ${Math.max(0, Math.min(100, y))}%`);
    }
  }
  el.removeClass('dr-sheet-open');
  // Restarted, so it opens each time it's shown.
  void el.offsetWidth;
  el.addClass('dr-sheet-open');
}

/**
 * A sheet or popover shown: it opens from where it was pressed, and goes
 * on a press outside it or on Escape, giving focus back to what opened it.
 */
export function drOpenSheet(el, anchor, onClose) {
  drSheetIn(el, anchor);
  const doc = el.ownerDocument;
  const close = () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onDown, true);
    if (onClose) onClose();
    if (anchor && typeof anchor.focus === 'function') anchor.focus();
  };
  const onKey = (evt) => {
    if (evt.key === 'Escape') {
      evt.stopPropagation();
      close();
    }
  };
  const onDown = (evt) => {
    if (!el.contains(evt.target) && !(anchor && anchor.contains && anchor.contains(evt.target))) close();
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onDown, true);
  return close;
}
