/* Screens with an order of their own, offered first on their filter button. */

import { setIcon, TFolder } from 'obsidian';

export const OWN_ORDER = {
  recents: 'Most recently opened',
  added: 'Most recently added',
  pinned: 'Order pinned',
};

/* How the Notes table sorts for each shared order. */
export const TABLE_SORTS = {
  name: { key: 'title', dir: 'asc' },
  'name-desc': { key: 'title', dir: 'desc' },
  modified: { key: 'modified', dir: 'desc' },
  created: { key: 'created', dir: 'desc' },
};

/* The orders every screen shares — one, saved in settings. */
export const SORTS = [
  ['name', 'Alphabetical (A–Z)'],
  ['name-desc', 'Alphabetical (Z–A)'],
  ['modified', 'Recently modified'],
  ['created', 'Recently created'],
];

/* -- filters ---------------------------------------------------------- */

/** A note's tags, lower case and without the #, from its text and its properties. */
export function noteTags(cache) {
  if (!cache) return [];
  const out = new Set();
  (cache.tags || []).forEach((t) => {
    const tag = String(t.tag || '').replace(/^#/, '').trim().toLowerCase();
    if (tag) out.add(tag);
  });
  const fm = cache.frontmatter || {};
  ['tags', 'tag'].forEach((key) => {
    const raw = fm[key];
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
    list.forEach((t) => {
      const tag = String(t).replace(/^#/, '').trim().toLowerCase();
      if (tag) out.add(tag);
    });
  });
  return Array.from(out);
}

/** Every tag in the vault with how many notes carry it, most used first. */
export function vaultTags(app) {
  const counts = new Map();
  app.vault.getMarkdownFiles().forEach((file) => {
    noteTags(app.metadataCache.getFileCache(file)).forEach((tag) =>
      counts.set(tag, (counts.get(tag) || 0) + 1)
    );
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

export const DATE_RANGES = {
  day: 'today',
  week: 'in the past week',
  month: 'in the past month',
  year: 'in the past year',
};

/** The earliest time a date filter lets through. */
export function dateFloor(range, now = Date.now()) {
  if (range === 'day') {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  const days = { week: 7, month: 30, year: 365 }[range] || 0;
  return now - days * 86400000;
}

/** How a property filter reads: "status is draft", "has domain". */
export function propertyFilterLabel(f) {
  if (f.due) return f.negate ? `${f.key} not due yet` : `${f.key} due soon or overdue`;
  if (f.value === null || f.value === undefined) return f.negate ? `No ${f.key}` : `Has ${f.key}`;
  return `${f.key} ${f.negate ? 'is not' : 'is'} ${f.value}`;
}

/** How a date filter reads: "Modified in the past week". */
export function dateFilterLabel(f) {
  return `${f.field === 'created' ? 'Created' : 'Modified'} ${DATE_RANGES[f.range] || ''}`.trim();
}

/**
 * Recent searches as a list of what was looked for, not of keystrokes:
 * a term that only led to the newer one beside it ("liber", then
 * "liberal") gives way to where it ended up. Newest first, so each
 * entry is checked against the one before it. This also repairs lists
 * saved while every keystroke was being recorded.
 */
export function collapseSearches(list) {
  const out = [];
  (list || []).forEach((term) => {
    const newer = out[out.length - 1];
    if (
      newer &&
      newer.length > term.length &&
      newer.toLowerCase().startsWith(term.toLowerCase())
    ) {
      return;
    }
    out.push(term);
  });
  return out;
}

/**
 * Arrow-key movement within a list.
 *
 * Every row here is focusable, but without this each one is its own tab
 * stop and nothing moves between them — which is not how a list behaves
 * anywhere else. One handler on the container walks its rows, so the
 * rows themselves stay unaware of it.
 */
/**
 * Scroll whatever holds an element while a drag is held near its top or
 * bottom edge — faster the nearer — so a long list can be dragged
 * through. `moved` is told the pointer's height after each step, since
 * what's under it has changed.
 */
export function edgeScroll(el, moved) {
  let box = null;
  for (let at = el; at && at.ownerDocument && at !== at.ownerDocument.body; at = at.parentElement) {
    const view = at.ownerDocument.defaultView;
    const style = view ? view.getComputedStyle(at) : null;
    if (style && /(auto|scroll)/.test(style.overflowY) && at.scrollHeight > at.clientHeight) {
      box = at;
      break;
    }
  }
  let frame = 0;
  let speed = 0;
  let lastY = 0;
  const step = () => {
    frame = 0;
    if (!speed || !box) return;
    const before = box.scrollTop;
    box.scrollTop += speed;
    if (box.scrollTop !== before && moved) moved(lastY);
    frame = window.requestAnimationFrame(step);
  };
  return {
    at(y) {
      lastY = y;
      if (!box) return;
      const r = box.getBoundingClientRect();
      const zone = Math.min(64, r.height / 4);
      const depth = y < r.top + zone ? y - (r.top + zone) : y > r.bottom - zone ? y - (r.bottom - zone) : 0;
      speed = Math.max(-40, Math.min(40, Math.round((depth / zone) * 16)));
      if (speed && !frame) frame = window.requestAnimationFrame(step);
    },
    stop() {
      speed = 0;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

/* Typing a name jumps to it, and Space previews the note in focus —
   switched on and off by the List keys feature. */
export const listKeys = { on: false, preview: null };

/* Where a row says what it's called: the start of a name to jump to. */
export const ROW_NAMES = '.dr-track-name, .dr-card-title, .dr-lib-label, .dr-td-text, .dr-recent-title, .dr-pick-title, .dr-plist-name';

export function rowName(row) {
  const label = row.querySelector(ROW_NAMES);
  return ((label && label.textContent) || row.getAttribute('aria-label') || row.textContent || '').trim().toLowerCase();
}

/**
 * A name cut short — one line ending in an ellipsis, or a title clamped to
 * two — shows in full under the pointer: its row or card is given the name
 * as a tooltip when pointed at, only while it doesn't fit.
 */
export function fullNameOnHover(view, container) {
  view.registerDomEvent(container, 'pointerover', (evt) => {
    const host = evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('[tabindex]') : null;
    const label = host && container.contains(host) ? host.querySelector(ROW_NAMES) : null;
    if (!label) return;
    const cut = label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1;
    if (cut && !host.hasAttribute('title')) {
      host.setAttribute('title', label.textContent.trim());
      host.dataset.drFullName = '';
    } else if (!cut && 'drFullName' in host.dataset) {
      host.removeAttribute('title');
      delete host.dataset.drFullName;
    }
  });
}

/**
 * Keys typed in quick succession spell the start of a name: the first row
 * from the one in focus on whose name starts that way gets focus. Typing
 * one letter again moves on to the next row starting with it.
 */
export function typeToJump(container, selector, evt) {
  // "/" is the page's way to Find.
  if (evt.key.length !== 1 || evt.key === '/' || evt.altKey || evt.metaKey || evt.ctrlKey) return false;
  const state = container.drTyped || (container.drTyped = { text: '', at: 0 });
  const now = Date.now();
  if (now - state.at > 800) state.text = '';
  state.at = now;
  if (evt.key === ' ' && !state.text) return false;
  const typed = (state.text + evt.key).toLowerCase();
  state.text = typed;
  const rows = Array.from(container.querySelectorAll(selector));
  if (!rows.length) return false;
  const active = container.ownerDocument.activeElement;
  const at = active && typeof active.closest === 'function' ? rows.indexOf(active.closest(selector)) : -1;
  const repeat = typed.length > 1 && typed.split('').every((c) => c === typed[0]);
  const want = repeat ? typed[0] : typed;
  const from = repeat || typed.length === 1 ? at + 1 : Math.max(at, 0);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[(from + i) % rows.length];
    if (rowName(row).startsWith(want)) {
      row.focus();
      if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
  }
  return true;
}

export function roveFocus(container, selector) {
  // Before the row's own keys: Space previews rather than opens, and a
  // letter typed goes to the list, not the row.
  container.addEventListener(
    'keydown',
    (evt) => {
      if (!listKeys.on) return;
      const target = evt.target;
      if (target && typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const typing = container.drTyped && container.drTyped.text && Date.now() - container.drTyped.at <= 800;
      if (evt.key === ' ' && !typing && !evt.altKey && !evt.metaKey && !evt.ctrlKey && listKeys.preview) {
        const row = target && typeof target.closest === 'function' ? target.closest(selector) : null;
        const path = row && row.dataset.path;
        if (path && listKeys.preview(row, path, evt)) {
          evt.preventDefault();
          evt.stopPropagation();
        }
        return;
      }
      if (typeToJump(container, selector, evt)) {
        evt.preventDefault();
        evt.stopPropagation();
      }
    },
    true
  );
  container.addEventListener('keydown', (evt) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (keys.indexOf(evt.key) === -1) return;
    if (evt.altKey || evt.metaKey || evt.ctrlKey) return;
    const target = evt.target;
    if (target && typeof target.closest === 'function' && target.closest('input, textarea, select')) return;

    const rows = Array.from(container.querySelectorAll(selector));
    if (!rows.length) return;

    // Tiles laid out in a grid move by the row as well as the item: as
    // many across as sit on the first line. A list has one across, and
    // leaves left and right to whatever else uses them.
    const across = gridColumns(rows);
    if ((evt.key === 'ArrowLeft' || evt.key === 'ArrowRight') && across < 2) return;

    // The container's own document: a popout window is another one.
    const active = container.ownerDocument.activeElement;
    const at = active && typeof active.closest === 'function' ? rows.indexOf(active.closest(selector)) : -1;
    const step = across > 1 ? across : 1;
    let next = at;
    if (evt.key === 'ArrowRight') next = at < 0 ? 0 : Math.min(at + 1, rows.length - 1);
    else if (evt.key === 'ArrowLeft') next = at < 0 ? 0 : Math.max(at - 1, 0);
    else if (evt.key === 'ArrowDown') next = at < 0 ? 0 : at + step < rows.length ? at + step : at;
    else if (evt.key === 'ArrowUp') next = at < 0 ? rows.length - 1 : at - step >= 0 ? at - step : at;
    else if (evt.key === 'Home') next = 0;
    else next = rows.length - 1;

    if (next === at) return;
    evt.preventDefault();
    rows[next].focus();
    if (typeof rows[next].scrollIntoView === 'function') rows[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

/** How many of these sit side by side on the first line. */
export function gridColumns(items) {
  if (items.length < 2) return 1;
  const top = items[0].offsetTop;
  let n = 0;
  while (n < items.length && items[n].offsetTop === top) n++;
  // Nothing laid out (a hidden page) reads as all on one line; that's a list.
  return n === items.length && !items[0].offsetWidth ? 1 : n;
}

/**
 * Click, plus the keys a button answers to. Everything clickable in the
 * browse view is a div rather than a <button>, so this gives each one
 * the keyboard behaviour a real button would have. The handler gets the
 * event, so modifier keys still work (ctrl-click for a new tab).
 */
export function onActivate(el, handler, space = true) {
  el.addEventListener('click', handler);
  el.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter' && !(space && evt.key === ' ')) return;
    evt.preventDefault();
    handler(evt);
  });
}

/** An element that acts as a button: reached with Tab, and named for screen readers when given a label. */
export function asButton(el, label) {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  if (label !== undefined) el.setAttribute('aria-label', label);
  return el;
}

/** When, in the spirit of a track length: a glance, not a date. */
export function relativeDay(time) {
  const day = 86400000;
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= midnight) return 'Today';
  if (time >= midnight - day) return 'Yesterday';
  const days = Math.floor((midnight - time) / day) + 1;
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  return new Date(time).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The icon for a file, by what kind of thing it is. */
export function iconForFile(file) {
  if (file.extension === 'base') return 'layout-list';
  if (file.extension === 'canvas') return 'layout-dashboard';
  if (file.extension === 'md' || file.extension === 'pdf') return 'file-text';
  return 'file';
}

/** Every file beneath a folder, however deep. */
export function countFilesIn(folder) {
  let n = 0;
  const walk = (f) =>
    (f.children || []).forEach((c) => {
      if (c instanceof TFolder) walk(c);
      else n++;
    });
  walk(folder);
  return n;
}

/**
 * A header button. Built as a div to match Obsidian's own chrome, so it
 * needs the role, tab stop and key handling a <button> would give for
 * free, plus aria-expanded since each one opens a panel or menu.
 */
export function makeTrigger(cls, label, icon, onActivate) {
  const el = createDiv({ cls: `clickable-icon ${cls}` });
  asButton(el, label);
  el.setAttribute('aria-expanded', 'false');
  el.setAttribute('data-tooltip-position', 'bottom');
  setIcon(el, icon);

  el.addEventListener('click', (evt) => {
    evt.stopPropagation();
    onActivate(el);
  });
  el.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter' && evt.key !== ' ') return;
    evt.preventDefault();
    evt.stopPropagation();
    onActivate(el);
  });

  return el;
}

