/* ------------------------------------------------------------------ */
/* Sorting and filtering                                               */
/*                                                                     */
/* The orders files and folders come in, the date ranges and labels a  */
/* filter shows, and counting what a folder holds.                     */
/* ------------------------------------------------------------------ */

/* Screens with an order of their own, offered first on their filter button. */

import { TFolder } from 'obsidian';

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
 * Names in the order a person would put them: numbers by value, so
 * "Week 2" comes before "Week 10", and case and accents not deciding.
 */
export function byName(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Files in one of the shared orders. */
export function sortByOrder(files, sort) {
  const by = {
    name: (a, b) => byName(a.basename, b.basename),
    'name-desc': (a, b) => byName(b.basename, a.basename),
    modified: (a, b) => b.stat.mtime - a.stat.mtime,
    created: (a, b) => b.stat.ctime - a.stat.ctime,
  }[sort] || ((a, b) => byName(a.basename, b.basename));
  return files.slice().sort(by);
}
