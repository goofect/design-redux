/* ------------------------------------------------------------------ */
/* Property schemas                                                    */
/*                                                                    */
/* A folder can say what its notes' properties should be: which are    */
/* required, of what type, from which values, with what default. A    */
/* note takes the schemas of every folder up from it, the nearest      */
/* deciding where two name the same property; '/' holds the vault's.  */
/* Checked, a note gives                                               */
/* its issues, each with a reason and, where one is plain, a fix.      */
/* Pure.                                                               */
/* ------------------------------------------------------------------ */

import { fmGet } from './045-helpers-properties.js';

/* The types a schema can ask for, as Obsidian names them. */
export const SCHEMA_TYPES = ['text', 'multitext', 'number', 'checkbox', 'date', 'datetime', 'tags', 'aliases'];

const LISTS = ['multitext', 'tags', 'aliases'];

/** A schema entry as kept: { key, type?, required?, values?, default? }, or null for one that names no property. */
export function tidyEntry(e) {
  if (!e || typeof e.key !== 'string' || !e.key.trim()) return null;
  const out = { key: e.key.trim() };
  if (SCHEMA_TYPES.includes(e.type)) out.type = e.type;
  if (e.required) out.required = true;
  const values = Array.isArray(e.values) ? Array.from(new Set(e.values.map((v) => String(v).trim()).filter(Boolean))) : [];
  if (values.length) out.values = values;
  if (e.default !== undefined && e.default !== null && e.default !== '') out.default = e.default;
  return out;
}

/**
 * The schema a note is held to: the entries of every folder up from it
 * that has one, by name whatever its case, the nearest folder's winning.
 * `schemas` is { folderPath: [entries] }; '/' is the whole vault.
 */
export function schemaFor(schemas, file) {
  if (!schemas || !file) return [];
  const chain = [];
  for (let f = file.parent; f; f = f.parent) {
    const own = schemas[f.path || '/'];
    if (own) chain.unshift(own);
    if (!f.path || f.path === '/' || (typeof f.isRoot === 'function' && f.isRoot())) break;
  }
  const merged = new Map();
  chain.forEach((entries) =>
    (Array.isArray(entries) ? entries : []).forEach((e) => {
      const t = tidyEntry(e);
      if (t) merged.set(t.key.toLowerCase(), t);
    })
  );
  return Array.from(merged.values());
}

/** Whether a value says nothing: missing, null, blank, or an empty list. */
export function emptyValue(v) {
  return v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
}

/** A value as compared with an allowed one: its words in lower case, spaces closed up, a link's brackets and trailing marks off. */
export function plainOf(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    .replace(/[.,;:!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** A date written another way as YYYY-MM-DD, or null. */
export function dateOf(v) {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (DATE.test(s)) return s;
  if (DATETIME.test(s)) return s.slice(0, 10);
  // Day first, as most of the world writes it: 3/4/2025, 03.04.2025.
  let m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  const t = Date.parse(s);
  if (s && /[a-z]/i.test(s) && !isNaN(t)) return dateOf(new Date(t));
  return null;
}

/** A value made the type asked for, or undefined where that can't be done plainly. */
export function asType(type, v) {
  if (emptyValue(v)) return undefined;
  if (LISTS.includes(type)) return Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.length === 1 ? asType(type, v[0]) : undefined;
  if (type === 'number') {
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'checkbox') {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return ['true', 'yes', 'y', '1', 'done', 'x'].includes(s) ? true : ['false', 'no', 'n', '0', ''].includes(s) ? false : undefined;
  }
  if (type === 'date') return dateOf(v) || undefined;
  if (type === 'datetime') {
    const s = String(v).trim();
    if (DATETIME.test(s)) return s;
    const d = dateOf(v);
    return d ? `${d}T00:00` : undefined;
  }
  return typeof v === 'string' ? v : String(v);
}

/** Whether a value is already of the type asked for. */
export function ofType(type, v) {
  if (emptyValue(v) || !type || type === 'text') return !Array.isArray(v) || !v.length;
  if (LISTS.includes(type)) return Array.isArray(v);
  if (type === 'number') return typeof v === 'number';
  if (type === 'checkbox') return typeof v === 'boolean';
  if (type === 'date') return typeof v === 'string' && DATE.test(v);
  if (type === 'datetime') return typeof v === 'string' && DATETIME.test(v);
  return true;
}

/**
 * What's wrong with a note's properties, held to a schema: [{ key, kind,
 * reason, fix }]. `kind` is missing, empty, type or value; `fix`, where
 * there's a plain one, is { value } to write — the default for one
 * missing, the type's own form, the allowed value's own spelling.
 */
export function checkNote(schema, fm) {
  const issues = [];
  (schema || []).forEach((e) => {
    const have = fmGet(fm || {}, e.key);
    const fallback = e.default !== undefined ? { value: JSON.parse(JSON.stringify(e.default)) } : null;
    if (have === undefined) {
      if (e.required) issues.push({ key: e.key, kind: 'missing', reason: `“${e.key}” is required here.`, fix: fallback });
      return;
    }
    if (emptyValue(have)) {
      if (e.required) issues.push({ key: e.key, kind: 'empty', reason: `“${e.key}” is required here, and empty.`, fix: fallback });
      return;
    }
    let value = have;
    if (e.type && !ofType(e.type, have)) {
      const made = asType(e.type, have);
      issues.push({ key: e.key, kind: 'type', reason: `“${e.key}” should be ${schemaTypeName(e.type)}.`, fix: made === undefined ? null : { value: made } });
      if (made === undefined) return;
      value = made;
    }
    if (e.values && e.values.length) {
      const allowed = new Map(e.values.map((a) => [plainOf(a), a]));
      const items = Array.isArray(value) ? value : [value];
      const wrong = items.filter((x) => !e.values.includes(String(x)));
      if (!wrong.length) return;
      const fixed = items.map((x) => (e.values.includes(String(x)) ? x : allowed.get(plainOf(x))));
      const fixable = fixed.every((x) => x !== undefined);
      const already = issues.find((i) => i.key === e.key && i.kind === 'type');
      const reason = wrong.length === 1 ? `“${wrong[0]}” isn’t one of ${quotedList(e.values)}.` : `${quotedList(wrong.map(String))} aren’t among ${quotedList(e.values)}.`;
      const fix = fixable ? { value: Array.isArray(value) ? Array.from(new Set(fixed)) : fixed[0] } : null;
      if (already) {
        // One issue a property: the type put right and the spelling with it, or neither.
        already.reason += ' ' + reason;
        already.fix = fix;
        already.kind = 'value';
      } else issues.push({ key: e.key, kind: 'value', reason, fix });
    }
  });
  return issues;
}

/** The change a fix makes to a note's frontmatter, or null: writes the value under the name the note has it by. */
export function fixFor(issue) {
  if (!issue || !issue.fix) return null;
  return (fm) => {
    const want = issue.key.toLowerCase();
    const name = Object.keys(fm).find((k) => k.toLowerCase() === want) || issue.key;
    fm[name] = JSON.parse(JSON.stringify(issue.fix.value));
  };
}

function schemaTypeName(type) {
  return { text: 'text', multitext: 'a list', number: 'a number', checkbox: 'a checkbox', date: 'a date', datetime: 'a date and time', tags: 'a list of tags', aliases: 'a list of aliases' }[type] || type;
}

function quotedList(items) {
  const q = items.slice(0, 6).map((s) => `“${s}”`);
  if (items.length > 6) q.push(`${items.length - 6} more`);
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}`;
}

/**
 * Folder defaults as schema entries — defaults only, nothing required —
 * for a vault upgraded from them; entries already in a schema kept.
 */
export function schemasFromDefaults(defaults, schemas) {
  const out = Object.assign({}, schemas || {});
  Object.keys(defaults || {}).forEach((path) => {
    const have = (out[path] || []).slice();
    const names = new Set(have.map((e) => String(e.key).toLowerCase()));
    (defaults[path] || []).forEach((p) => {
      if (!p || !p.key || names.has(p.key.toLowerCase())) return;
      const e = tidyEntry({ key: p.key, type: p.type, default: p.value });
      if (e) have.push(e);
    });
    if (have.length) out[path] = have;
  });
  return out;
}

/**
 * A folder's schema with its defaults as the folder defaults now say —
 * set, changed, taken off — so the two keep step. An entry left saying
 * nothing but its name goes.
 */
export function schemaWithDefaults(schemas, path, defaults) {
  const out = Object.assign({}, schemas || {});
  const byKey = new Map((defaults || []).filter((p) => p && p.key).map((p) => [p.key.toLowerCase(), p]));
  const entries = (out[path] || []).map((e) => {
    const next = Object.assign({}, e);
    const d = byKey.get(String(e.key).toLowerCase());
    byKey.delete(String(e.key).toLowerCase());
    if (d && !emptyValue(d.value)) next.default = d.value;
    else delete next.default;
    if (d && d.type && !next.type) next.type = d.type;
    return next;
  });
  byKey.forEach((p) => entries.push({ key: p.key, type: p.type, default: p.value }));
  const kept = entries.map(tidyEntry).filter((e) => e && Object.keys(e).length > 1);
  if (kept.length) out[path] = kept;
  else delete out[path];
  return out;
}
