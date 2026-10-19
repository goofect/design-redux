/* ------------------------------------------------------------------ */
/* Bulk edits: what a change does to a value                          */
/*                                                                    */
/* A property or tag renamed, merged, retyped or removed in one note's*/
/* properties — the pure steps, each given what it changes and giving */
/* back what changed — and the property types a value can take.       */
/* ------------------------------------------------------------------ */

import { TAG_KEYS, TYPE_ICONS } from '../core/020-constants.js';
import { byName } from '../core/030-helpers-art.js';
import { parseDateInput } from '../core/045-helpers-properties.js';
import { bulkCount, renameTagText, tagUnder } from '../core/047-helpers-text.js';
import { noteProps, sameValue } from '../core/073-notes.js';

export const LIST_TYPES = ['multitext', 'tags', 'aliases'];

/* Returned by mergeValues when two values can't become one. */
export const CONFLICT = Object.freeze({ conflict: true });

/** Whether a frontmatter value holds nothing. */
export function isBlank(value) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A list with repeats taken out, text compared ignoring case and a leading #. */
export function uniqueList(items) {
  const seen = new Set();
  return items.filter((v) => {
    const k =
      typeof v === 'string' ? v.trim().replace(/^#/, '').toLowerCase() : JSON.stringify(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A key of the note's that is `name`, whatever case either is written in. */
export function keyLike(fm, name) {
  const want = String(name).toLowerCase();
  return Object.keys(fm).find((k) => k !== 'position' && k.toLowerCase() === want);
}

/** A property's type as Obsidian has it: assigned, or else inferred. */
export function propertyType(app, key) {
  try {
    const info = app.metadataTypeManager.getTypeInfo(key);
    const t =
      (info && info.expected && info.expected.type) ||
      (info && info.inferred && info.inferred.type);
    if (t && TYPE_ICONS[t]) return t;
  } catch (err) {
    /* fall through */
  }
  const name = String(key || '').toLowerCase();
  return name === 'tags' ? 'tags' : name === 'aliases' ? 'aliases' : 'text';
}

/** Whether a property has a type assigned, not just one inferred from its values. */
export function assignedType(app, key) {
  try {
    const info = app.metadataTypeManager.getTypeInfo(key);
    const t = info && info.expected && info.expected.type;
    return t && TYPE_ICONS[t] ? t : null;
  } catch (err) {
    return null;
  }
}

/**
 * The name and type Obsidian keeps a property's type under, or null for
 * none — kept in types.json, by name as first written. It lists the
 * property by that name, whatever the notes now say.
 */
export function assignedEntry(app, key) {
  const m = app && app.metadataTypeManager;
  const low = String(key).toLowerCase();
  // Newer Obsidian keeps them as assignedWidgets, older as types.
  for (const store of [m && m.assignedWidgets, m && m.types]) {
    if (store && typeof store === 'object' && Object.prototype.hasOwnProperty.call(store, low)) {
      const entry = store[low];
      if (entry && typeof entry.name === 'string') return { name: entry.name, type: entry.widget || entry.type || null };
    }
  }
  return null;
}

/**
 * A property's type kept under `to` as now spelled, where Obsidian has it
 * in other capitals: changing a property's capitals changes the name it's
 * listed by. Returns the spelling it had, or null for no change.
 */
export async function respellAssignedType(app, to) {
  const m = app && app.metadataTypeManager;
  const entry = assignedEntry(app, to);
  if (!entry || entry.name === to || !entry.type || typeof m.unsetType !== 'function' || typeof m.setType !== 'function') return null;
  try {
    await m.unsetType(to);
    await m.setType(to, entry.type);
    if (typeof m.rebuildProperties === 'function') m.rebuildProperties();
    return entry.name;
  } catch (err) {
    return null;
  }
}

/** Whether Obsidian keeps a property's type under other capitals than `name`. */
export function assignedEntryDiffers(app, name) {
  const entry = assignedEntry(app, name);
  return !!entry && entry.name !== name;
}

/** What a rename did, said plainly: the notes it changed, or just the capitals it's listed by. */
export function renamedText(from, to, done, record) {
  if (!done && record && record.respelled) return `“${to}” is written that way now`;
  if (from === to) return `Wrote “${to}” the same way in ${bulkCount(done, 'note')}`;
  return `Renamed “${from}” to “${to}” in ${bulkCount(done, 'note')}`;
}

/**
 * What a typed value becomes in the note: a list split at commas, a
 * number, a checkbox's true or false, or text. Nothing typed is an
 * empty property, as Obsidian's own Add property leaves one.
 */
export function parseTypedValue(type, raw) {
  if (type === 'checkbox') return raw === true || raw === 'true';
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!text) return null;
  if (LIST_TYPES.indexOf(type) !== -1) {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    return uniqueList(type === 'tags' ? parts.map((p) => p.replace(/^#/, '')) : parts);
  }
  if (type === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  // A date typed as tomorrow, +2w or friday is written as the date.
  if ((type === 'date' || type === 'datetime') && !/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const day = parseDateInput(text);
    if (day) return type === 'datetime' ? `${day}T00:00` : day;
  }
  return text;
}

/**
 * Add properties to one note's frontmatter. One the note already has
 * keeps its value unless `replace` — except a list, which takes the
 * new items as well. Names match whatever case the note wrote them in.
 * Returns whether anything changed.
 */
export function addPropertiesTo(fm, props, replace) {
  let changed = false;
  props.forEach(({ key, value }) => {
    const have = keyLike(fm, key);
    if (have === undefined) {
      fm[key] = value;
      changed = true;
      return;
    }
    const current = fm[have];
    if (isBlank(current) && isBlank(value)) return;
    let next = current;
    if (replace || isBlank(current)) {
      next = value;
    } else if (Array.isArray(value) && !isBlank(value)) {
      // A list written as text — "tags: a, b" — is still a list.
      const list = Array.isArray(current)
        ? current
        : typeof current === 'string'
          ? current.split(TAG_KEYS.indexOf(have.toLowerCase()) !== -1 ? /[,\s]+/ : /,/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [current];
      next = uniqueList(list.concat(value));
    } else if (Array.isArray(current) && !isBlank(value)) {
      next = uniqueList(current.concat([value]));
    }
    if (!sameValue(next, current)) {
      fm[have] = next;
      changed = true;
    }
  });
  return changed;
}

/**
 * Several values of what's becoming one property, as one value: the
 * one they share, or a list holding them all when the first is a list.
 * Anything else can't be decided here, and is CONFLICT.
 */
export function mergeValues(values) {
  const full = values.filter((v) => !isBlank(v));
  if (!full.length) {
    const kept = values.find((v) => v !== undefined);
    return kept === undefined ? null : kept;
  }
  if (full.every((v) => sameValue(v, full[0]))) return full[0];
  if (Array.isArray(full[0])) return uniqueList([].concat(...full));
  return CONFLICT;
}

/**
 * Rename a property in one note's frontmatter, keeping its place. If
 * the note already has the new name, the two become one where their
 * values allow it; otherwise the note is left as it was.
 *
 * Returns 'absent', 'same', 'renamed', 'merged' or 'conflict'.
 */
export function renamePropertyIn(fm, from, to) {
  const low = (s) => String(s).toLowerCase();
  const keys = Object.keys(fm).filter((k) => k !== 'position');
  const olds = keys.filter((k) => low(k) === low(from));
  if (!olds.length) return 'absent';
  // A change of case is the same property, so there's nothing to merge.
  const targets = low(from) === low(to) ? [] : keys.filter((k) => low(k) === low(to));
  if (olds.length === 1 && !targets.length && olds[0] === to) return 'same';

  const involved = targets.concat(olds);
  const merged = mergeValues(involved.map((k) => fm[k]));
  if (merged === CONFLICT) return 'conflict';

  const first = keys.find((k) => involved.indexOf(k) !== -1);
  const entries = keys.map((k) => [k, fm[k]]);
  keys.forEach((k) => delete fm[k]);
  entries.forEach(([k, v]) => {
    if (k === first) fm[to] = merged;
    else if (involved.indexOf(k) === -1) fm[k] = v;
  });
  return involved.length > 1 ? 'merged' : 'renamed';
}

/**
 * Several properties made one in a note's frontmatter, under `to`, at
 * the place the first of them had. Their values become one as a rename
 * would make them; where they differ, `mode` 'list' puts them together
 * in a list, and otherwise the note is left as it was.
 *
 * Returns 'absent', 'same', 'renamed', 'merged', 'combined' or 'conflict'.
 */
export function mergePropertiesIn(fm, froms, to, mode) {
  const low = (s) => String(s).toLowerCase();
  const names = new Set(froms.map(low));
  const keys = Object.keys(fm).filter((k) => k !== 'position');
  if (!keys.some((k) => names.has(low(k)) && low(k) !== low(to))) {
    // Only the name kept is here, perhaps in other capitals.
    const olds = keys.filter((k) => names.has(low(k)));
    if (!olds.length) return 'absent';
    return olds.length === 1 && olds[0] === to ? 'same' : renamePropertyIn(fm, olds[0], to);
  }
  const involved = keys.filter((k) => names.has(low(k)) || low(k) === low(to));
  // The kept property's value leads, then the rest in the order chosen.
  const rank = (k) => (low(k) === low(to) ? -1 : froms.map(low).indexOf(low(k)));
  const values = involved.slice().sort((a, b) => rank(a) - rank(b)).map((k) => fm[k]);
  let merged = mergeValues(values);
  let how = involved.length > 1 ? 'merged' : 'renamed';
  if (merged === CONFLICT) {
    if (mode !== 'list') return 'conflict';
    merged = uniqueList([].concat(...values.filter((v) => !isBlank(v))));
    how = 'combined';
  }
  const first = keys.find((k) => involved.indexOf(k) !== -1);
  const entries = keys.map((k) => [k, fm[k]]);
  keys.forEach((k) => delete fm[k]);
  entries.forEach(([k, v]) => {
    if (k === first) fm[to] = merged;
    else if (involved.indexOf(k) === -1) fm[k] = v;
  });
  return how;
}

/** A tags property's value with one tag renamed, as a list or as the text it was. */
export function renameTagsValue(value, from, to) {
  if (Array.isArray(value)) {
    const out = value.map((v) =>
      typeof v === 'string' && tagUnder(v, from) ? renameTagText(v, from, to) : v
    );
    return uniqueList(out);
  }
  if (typeof value === 'string') {
    return value.replace(/(^|[\s,])(#?[^\s,]+)/g, (m, lead, tag) =>
      lead + renameTagText(tag, from, to)
    );
  }
  return value;
}

/** Rename a tag in a note's tags properties. Returns whether anything changed. */
export function renameTagIn(fm, from, to) {
  let changed = false;
  Object.keys(fm).forEach((k) => {
    if (TAG_KEYS.indexOf(k.toLowerCase()) === -1) return;
    const next = renameTagsValue(fm[k], from, to);
    if (!sameValue(next, fm[k])) {
      fm[k] = next;
      changed = true;
    }
  });
  return changed;
}

/** Whether a note's tags properties carry a tag, or one beneath it. */
export function fmHasTag(fm, from) {
  if (!fm) return false;
  return Object.keys(fm).some((k) => {
    if (TAG_KEYS.indexOf(k.toLowerCase()) === -1) return false;
    const raw = fm[k];
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
    return list.some((t) => typeof t === 'string' && tagUnder(t, from));
  });
}

/**
 * Rename tags in a note's text at the places Obsidian found them, which
 * already leaves out code, links and headings. Each place is checked
 * against the text first; if one doesn't match, the cache is behind
 * the file, and null says so rather than guessing.
 */
export function renameTagsAt(text, spots, from, to) {
  let out = text;
  const sorted = spots.slice().sort((a, b) => b.start - a.start);
  for (const s of sorted) {
    const found = out.slice(s.start, s.end);
    if (found.toLowerCase() !== String(s.tag).toLowerCase()) return null;
    out = out.slice(0, s.start) + renameTagText(found, from, to) + out.slice(s.end);
  }
  return out;
}

/** A note's tags in its text that are `from` or beneath it, with where they are. */
export function tagSpots(cache, from) {
  return ((cache && cache.tags) || [])
    .filter((t) => t && t.position && tagUnder(t.tag, from))
    .map((t) => ({ tag: t.tag, start: t.position.start.offset, end: t.position.end.offset }));
}

/** Why a tag name can't be used, or '' if it can. */
export function tagNameProblem(name) {
  const t = String(name || '').trim().replace(/^#/, '');
  if (!t) return 'Type the new name.';
  if (/\s/.test(t)) return "A tag can't contain spaces.";
  if (/[#.,;:!?'"()[\]{}@$%^&*+=<>|\\~`]/.test(t)) {
    return 'A tag can only use letters, numbers, - , _ and / .';
  }
  if (/^\/|\/$|\/\//.test(t)) return 'Each part of a nested tag needs a name.';
  if (/^[0-9/]+$/.test(t)) return 'A tag needs at least one letter.';
  return '';
}

/** Why a property name can't be used, or '' if it can. */
export function propertyNameProblem(name) {
  const t = String(name || '').trim();
  if (!t) return 'Type the new name.';
  if (/[\r\n]/.test(t)) return "A property's name is one line.";
  if (t.toLowerCase() === 'position') return '"position" is kept for Obsidian\'s own use.';
  return '';
}

/* -- values, removal and types ------------------------------------------ */

/** A value as the text it's compared by. */
export function valueKey(v) {
  return v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v);
}

/**
 * One value of a property renamed in a note: on its own, or as an item
 * of a list, where it joins any the list already had. A number stays a
 * number, and true or false a checkbox's value, where the new one can.
 */
export function renameValueIn(fm, key, from, to) {
  const have = keyLike(fm, key);
  if (have === undefined) return false;
  const typed = (orig) => {
    if (typeof orig === 'number' && to.trim() !== '' && Number.isFinite(Number(to))) return Number(to);
    if (typeof orig === 'boolean' && /^(true|false)$/i.test(to)) return /^true$/i.test(to);
    return to;
  };
  // A link counts by what it points to, as the Properties screen shows
  // it; renamed, it points to the new name and keeps its heading and alias.
  const link = /^(!?\[\[)([^\]|#]+)(.*\]\])$/;
  const hit = (x) => {
    const text = valueKey(x);
    if (text === from) return true;
    const m = link.exec(text);
    return !!m && m[2].trim() === from;
  };
  const renamed = (x) => {
    const m = link.exec(valueKey(x));
    return m && valueKey(x) !== from ? `${m[1]}${to}${m[3]}` : typed(x);
  };
  const value = fm[have];
  if (Array.isArray(value)) {
    if (!value.some(hit)) return false;
    fm[have] = uniqueList(value.map((x) => (hit(x) ? renamed(x) : x)));
    return true;
  }
  if (!hit(value)) return false;
  fm[have] = renamed(value);
  return true;
}

/** Properties taken out of a note, whatever case it wrote them in. */
export function removePropertiesFrom(fm, keys) {
  const drop = new Set(keys.map((k) => String(k).toLowerCase()));
  let changed = false;
  Object.keys(fm).forEach((k) => {
    if (k !== 'position' && drop.has(k.toLowerCase())) {
      delete fm[k];
      changed = true;
    }
  });
  return changed;
}

/** A date written any ordinary way, as YYYY-MM-DD and YYYY-MM-DDTHH:mm; null if it isn't one. */
export function parseDateText(text) {
  const s = String(text || '').trim();
  if (!s || !/\d/.test(s)) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  const pad = (n) => String(n).padStart(2, '0');
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return { date, datetime: `${date}T${iso[4] || '00'}:${iso[5] || '00'}` };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { date, datetime: `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * A value converted to a type: { ok, value }, or { ok: false } where it
 * can't be without losing what it says. Nothing stays nothing.
 */
export function convertValue(value, type) {
  if (isBlank(value)) return { ok: true, value };
  const list = Array.isArray(value);
  const text = list ? value.map(valueKey).join(', ') : valueKey(value);
  const single = list ? (value.length === 1 ? valueKey(value[0]) : null) : text;
  switch (type) {
    case 'multitext':
    case 'aliases':
      return { ok: true, value: list ? value : text.split(',').map((x) => x.trim()).filter(Boolean) };
    case 'tags': {
      // A tag has no spaces, so text is split at them as Obsidian reads it.
      const items = (list ? value.map(valueKey) : [text]).reduce((acc, x) => acc.concat(x.split(/[,\s]+/)), []);
      return { ok: true, value: uniqueList(items.map((x) => x.trim().replace(/^#/, '')).filter(Boolean)) };
    }
    case 'text':
      return { ok: true, value: text };
    case 'number': {
      if (typeof value === 'number') return { ok: true, value };
      const n = single === null ? NaN : Number(String(single).trim().replace(/,/g, ''));
      return single !== null && String(single).trim() !== '' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return { ok: true, value };
      const t = String(single === null ? '' : single).trim();
      if (/^(true|yes|y|1|on|done|x)$/i.test(t)) return { ok: true, value: true };
      if (/^(false|no|n|0|off)$/i.test(t)) return { ok: true, value: false };
      return { ok: false };
    }
    case 'date':
    case 'datetime': {
      const d = single === null ? null : parseDateText(single);
      return d ? { ok: true, value: type === 'date' ? d.date : d.datetime } : { ok: false };
    }
    default:
      return { ok: true, value };
  }
}

/** Every property the notes carry, with how many carry it, most first. */
export function propertiesIn(app, files) {
  const counts = new Map();
  files.forEach((file) => {
    const fm = noteProps(app, file);
    Object.keys(fm).forEach((k) => {
      if (k === 'position') return;
      const low = k.toLowerCase();
      const entry = counts.get(low) || { name: k, count: 0 };
      entry.count++;
      counts.set(low, entry);
    });
  });
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || byName(a.name, b.name));
}

export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
