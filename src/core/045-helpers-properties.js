/* ------------------------------------------------------------------ */

/* Properties: reading them, a note at a time or across the vault      */
/* ------------------------------------------------------------------ */

/** A value without its wikilink brackets, alias or heading. */
export function plainValue(value) {
  return String(value)
    .replace(/^!?\[\[/, '')
    .replace(/\]\]$/, '')
    .split('|')[0]
    .split('#')[0]
    .trim();
}

/**
 * A property's value by name, whatever case the note wrote it in —
 * Obsidian treats "Author" and "author" as one property, and lists it
 * lower-cased.
 */
export function fmGet(fm, key) {
  if (!fm || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(fm, key)) return fm[key];
  const want = String(key).toLowerCase();
  const name = Object.keys(fm).find((k) => k.toLowerCase() === want);
  return name === undefined ? undefined : fm[name];
}

/**
 * How many notes carry each property, as Obsidian counts them: kept with
 * each property's info before Obsidian 1.14, asked for on their own
 * since. A function of a property's key and its info.
 */
export function propertyCounter(app) {
  const m = app && app.metadataTypeManager;
  let occ = null;
  try {
    if (m && typeof m.getPropertyOccurrences === 'function') occ = m.getPropertyOccurrences();
  } catch (err) {
    occ = null;
  }
  return (key, info) => {
    const own = info && (info.count || info.occurrences);
    if (own) return own;
    const lower = String(key || '').toLowerCase();
    return occ && typeof occ[lower] === 'number' ? occ[lower] : 0;
  };
}

/** A property's values as a list of strings, whether written as one or many. */
export function valueList(raw) {
  return (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => String(v).trim());
}

/**
 * Notes set out under the note a property names as their parent —
 * among these notes, in their order: each parent followed by the notes
 * under it, a step in, at any depth. A note whose parent isn't among
 * them, or that would hang from itself, stays at the top.
 * [{ file, depth, children }], `children` the number directly under it.
 */
export function nestByProperty(app, files, key) {
  const here = new Set(files);
  const parentOf = new Map();
  if (key) {
    files.forEach((file) => {
      const cache = app.metadataCache.getFileCache(file);
      const raw = cache ? fmGet(cache.frontmatter, key) : undefined;
      const found = valueList(raw)
        .map((v) => app.metadataCache.getFirstLinkpathDest(plainValue(v), file.path))
        .find((t) => t && t !== file && here.has(t));
      if (found) parentOf.set(file, found);
    });
  }
  // A ring of parents has no top: its notes stay at the top.
  parentOf.forEach((p, file) => {
    const seen = new Set([file]);
    for (let at = p; at; at = parentOf.get(at)) {
      if (seen.has(at)) {
        parentOf.delete(file);
        break;
      }
      seen.add(at);
    }
  });
  const under = new Map();
  files.forEach((f) => {
    const p = parentOf.get(f);
    if (!p) return;
    if (!under.has(p)) under.set(p, []);
    under.get(p).push(f);
  });
  const out = [];
  const add = (file, depth) => {
    const kids = under.get(file) || [];
    out.push({ file, depth, children: kids.length });
    kids.forEach((k) => add(k, depth + 1));
  };
  files.filter((f) => !parentOf.has(f)).forEach((f) => add(f, 0));
  return out;
}

/** Property names in the vault, most used first. */
export function knownPropertyNames(app) {
  try {
    const m = app.metadataTypeManager;
    const all =
      (m && typeof m.getAllProperties === 'function' && m.getAllProperties()) ||
      (m && m.properties) ||
      {};
    const count = propertyCounter(app);
    return Object.keys(all)
      .map((k) => ({
        name: (all[k] && all[k].name) || k,
        count: count(k, all[k]),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((e) => e.name);
  } catch (err) {
    return [];
  }
}

/** Every value a property takes across the vault, most used first. */
export function propertyValues(app, key) {
  const want = String(key || '').toLowerCase();
  if (!want) return [];
  const counts = new Map();
  app.vault.getMarkdownFiles().forEach((file) => {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache && cache.frontmatter;
    if (!fm) return;
    const name = Object.keys(fm).find((k) => k.toLowerCase() === want);
    if (!name) return;
    const raw = fm[name];
    (Array.isArray(raw) ? raw : [raw]).forEach((v) => {
      if (v === null || v === undefined || v === '') return;
      const text = plainValue(v);
      if (text) counts.set(text, (counts.get(text) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map((e) => e[0])
    .slice(0, 200);
}

/** A property's name as the vault writes it — its own case — or the key with a capital. */
export function propertyLabel(app, key) {
  try {
    const info = app.metadataTypeManager.getAllProperties()[key];
    if (info && info.name) return info.name;
  } catch (err) {
    /* fall through */
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The notes a parent property names, as link paths to resolve: from
 * [[Note]], [[Note|alias]], [[folder/Note#heading]], a path or plain
 * text, one value or a list. What the graph's routes and an album's map
 * both read, so they read it the same way.
 */
export function parentLinkpaths(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : [raw]).forEach((value) => {
    if (value === null || value === undefined || typeof value === 'object') return;
    const m = /^\s*!?\[\[([^\]|#]+)/.exec(String(value));
    const linkpath = (m ? m[1] : String(value)).trim();
    if (linkpath && out.indexOf(linkpath) === -1) out.push(linkpath);
  });
  return out;
}

/** A date as Obsidian keeps one: YYYY-MM-DD, in local time. */
export function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * A date as typed — today, tomorrow, yesterday, +3d, +2w, -1m, +1y, in
 * 5 days, friday or next fri, or a date already — as YYYY-MM-DD; null
 * for anything else. `today` (a Date or its time) for the day it counts
 * from.
 */
export function parseDateInput(text, today) {
  const s = String(text === null || text === undefined ? '' : text).trim().toLowerCase();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const base = today === undefined ? new Date() : new Date(today);
  base.setHours(12, 0, 0, 0);
  const shifted = (n, unit) => {
    const d = new Date(base);
    if (unit === 'w') d.setDate(d.getDate() + 7 * n);
    else if (unit === 'm') d.setMonth(d.getMonth() + n);
    else if (unit === 'y') d.setFullYear(d.getFullYear() + n);
    else d.setDate(d.getDate() + n);
    return isoDay(d);
  };
  if (s === 'today' || s === 'now') return shifted(0);
  if (s === 'tomorrow') return shifted(1);
  if (s === 'yesterday') return shifted(-1);
  let m = /^([+-])\s*(\d+)\s*([dwmy])?[a-z]*$/.exec(s) || /^in\s+()(\d+)\s*([dwmy])[a-z]*$/.exec(s);
  if (m) return shifted(Number(m[2]) * (m[1] === '-' ? -1 : 1), m[3] || 'd');
  m = /^(?:next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(s);
  if (m) {
    const ahead = (WEEKDAYS.indexOf(m[1]) - base.getDay() + 7) % 7 || 7;
    return shifted(ahead);
  }
  return null;
}

/* How many days ahead a date counts as soon. */
export const DUE_SOON = 3;

/** Where a date stands against today: overdue, today, soon (within DUE_SOON days) or later; null for what isn't a date. */
export function dateDueState(value, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value === null || value === undefined ? '' : value).trim());
  if (!m) return null;
  const base = today === undefined ? new Date() : new Date(today);
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  const days = Math.round((day - now) / 86400000);
  return days < 0 ? 'overdue' : days === 0 ? 'today' : days <= DUE_SOON ? 'soon' : 'later';
}

/** The properties whose dates are due dates, as settings name them. */
export function dueKeys(settings) {
  return String((settings && settings.propertyDueKeys) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * What an album's notes come to, from their properties: how many, how
 * many are done by `isDone(fm)`, and the earliest and latest of a date
 * property — the fixed set, no formulas. { count, done, earliest, latest }.
 */
export function rollupOf(fms, isDone, dateKey) {
  const out = { count: 0, done: 0, earliest: null, latest: null };
  (fms || []).forEach((fm) => {
    out.count++;
    if (isDone && isDone(fm || {})) out.done++;
    if (!dateKey) return;
    const raw = fmGet(fm || {}, dateKey);
    (Array.isArray(raw) ? raw : [raw]).forEach((v) => {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v === null || v === undefined ? '' : v));
      if (!m) return;
      if (!out.earliest || m[1] < out.earliest) out.earliest = m[1];
      if (!out.latest || m[1] > out.latest) out.latest = m[1];
    });
  });
  return out;
}
