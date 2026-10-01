/* ------------------------------------------------------------------ */
/* Bulk edits                                                          */
/*                                                                     */
/* Properties added to every note in a set of folders at once, and a   */
/* property or tag renamed wherever it's used: in notes' properties    */
/* and text, in bases, and in this plugin's own settings. Each change  */
/* is recorded file by file as it's made, so the last one can be       */
/* undone for as long as those files haven't been edited since.        */
/* ------------------------------------------------------------------ */

/* Property types whose value is a list. */
const LIST_TYPES = ['multitext', 'tags', 'aliases'];

/* The properties Obsidian reads tags from. */
const TAG_KEYS = ['tags', 'tag'];

/* Returned by mergeValues when two values can't become one. */
const CONFLICT = Object.freeze({ conflict: true });

/** Whether a frontmatter value holds nothing. */
function isBlank(value) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A list with repeats taken out, text compared ignoring case and a leading #. */
function uniqueList(items) {
  const seen = new Set();
  return items.filter((v) => {
    const k =
      typeof v === 'string' ? v.trim().replace(/^#/, '').toLowerCase() : JSON.stringify(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A key of the note's that is `name`, whatever case either is written in. */
function keyLike(fm, name) {
  const want = String(name).toLowerCase();
  return Object.keys(fm).find((k) => k !== 'position' && k.toLowerCase() === want);
}

/** A property's type as Obsidian has it: assigned, or else inferred. */
function propertyType(app, key) {
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
function assignedType(app, key) {
  try {
    const info = app.metadataTypeManager.getTypeInfo(key);
    const t = info && info.expected && info.expected.type;
    return t && TYPE_ICONS[t] ? t : null;
  } catch (err) {
    return null;
  }
}

/**
 * What a typed value becomes in the note: a list split at commas, a
 * number, a checkbox's true or false, or text. Nothing typed is an
 * empty property, as Obsidian's own Add property leaves one.
 */
function parseTypedValue(type, raw) {
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
  return text;
}

/**
 * Add properties to one note's frontmatter. One the note already has
 * keeps its value unless `replace` — except a list, which takes the
 * new items as well. Names match whatever case the note wrote them in.
 * Returns whether anything changed.
 */
function addPropertiesTo(fm, props, replace) {
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
function mergeValues(values) {
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
function renamePropertyIn(fm, from, to) {
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
function mergePropertiesIn(fm, froms, to, mode) {
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

/** Whether a tag is `from` or nested beneath it, ignoring case and #. */
function tagUnder(tag, from) {
  const t = String(tag).trim().replace(/^#/, '').toLowerCase();
  const f = String(from).replace(/^#/, '').toLowerCase();
  return !!f && (t === f || t.startsWith(f + '/'));
}

/** A tag renamed, keeping its # if it had one and what's nested beneath as written. */
function renameTagText(tag, from, to) {
  const text = String(tag).trim();
  if (!tagUnder(text, from)) return tag;
  const hash = text.startsWith('#') ? '#' : '';
  const bare = text.replace(/^#/, '');
  return hash + to + bare.slice(String(from).replace(/^#/, '').length);
}

/** A tags property's value with one tag renamed, as a list or as the text it was. */
function renameTagsValue(value, from, to) {
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
function renameTagIn(fm, from, to) {
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
function fmHasTag(fm, from) {
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
function renameTagsAt(text, spots, from, to) {
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
function tagSpots(cache, from) {
  return ((cache && cache.tags) || [])
    .filter((t) => t && t.position && tagUnder(t.tag, from))
    .map((t) => ({ tag: t.tag, start: t.position.start.offset, end: t.position.end.offset }));
}

/** Why a tag name can't be used, or '' if it can. */
function tagNameProblem(name) {
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
function propertyNameProblem(name) {
  const t = String(name || '').trim();
  if (!t) return 'Type the new name.';
  if (/[\r\n]/.test(t)) return "A property's name is one line.";
  if (t.toLowerCase() === 'position') return '"position" is kept for Obsidian\'s own use.';
  return '';
}

/* -- values, removal and types ------------------------------------------ */

/** A value as the text it's compared by. */
function valueKey(v) {
  return v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v);
}

/**
 * One value of a property renamed in a note: on its own, or as an item
 * of a list, where it joins any the list already had. A number stays a
 * number, and true or false a checkbox's value, where the new one can.
 */
function renameValueIn(fm, key, from, to) {
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
function removePropertiesFrom(fm, keys) {
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
function parseDateText(text) {
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
function convertValue(value, type) {
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
function propertiesIn(app, files) {
  const counts = new Map();
  files.forEach((file) => {
    const cache = app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
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

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* -- bases ------------------------------------------------------------ */

/*
 * A base names a note's property three ways — "status", "note.status"
 * and note["status"] — in its filters and formulas, which are
 * expressions, and in its columns, sort and grouping, which name one
 * property each. Renaming follows all of them. The words a base uses
 * for itself are never a property's bare name.
 */
const BASE_WORDS = [
  'file', 'note', 'formula', 'this', 'value', 'values', 'index',
  'true', 'false', 'null', 'undefined', 'and', 'or', 'not',
];

const isIdentifier = (s) => /^[A-Za-z_$][\w$]*$/.test(s);

/**
 * An expression with a property renamed, or a tag renamed inside the
 * text it tests for (hasTag, tags.contains). String literals are
 * skipped whole, so a word inside quotes is never taken for a name.
 * `what` is { property: [from, to] } or { tag: [from, to] }.
 */
function renameInExpression(expr, what) {
  if (typeof expr !== 'string') return expr;
  const prop = what.property;
  const tag = what.tag;
  const val = what.value;
  const lowFrom = prop ? prop[0].toLowerCase() : '';
  // A value is renamed where it's compared with its property — status ==
  // "draft", note["status"] != 'draft', status.contains("draft") — and
  // left alone anywhere else it happens to appear.
  const valKey = val ? escapeRegExp(val[0]) : '';
  const valBefore = val
    ? [
        new RegExp(`(?:^|[^\\w$.])(?:(?:note|this)\\s*\\.\\s*)?${valKey}\\s*(?:==|!=)\\s*$`, 'i'),
        new RegExp(`(?:note|this)\\s*\\[\\s*["']${valKey}["']\\s*\\]\\s*(?:==|!=)\\s*$`, 'i'),
        new RegExp(`(?:^|[^\\w$.])(?:(?:note|this)\\s*\\.\\s*)?${valKey}\\s*\\.\\s*contains(?:Any|All)?\\s*\\([^()]*$`, 'i'),
      ]
    : [];
  const valAfter = val
    ? new RegExp(`^\\s*(?:==|!=)\\s*(?:(?:note|this)\\s*\\.\\s*)?${valKey}(?![\\w$])`, 'i')
    : null;
  let out = '';
  let i = 0;
  const n = expr.length;
  const partOf = (c) => /[\w$]/.test(c || '');

  while (i < n) {
    const c = expr[i];

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && expr[j] !== c) j += expr[j] === '\\' ? 2 : 1;
      const body = expr.slice(i + 1, Math.min(j, n));
      const close = j < n ? c : '';
      let next = body;
      if (prop && /\b(note|this)\s*\[\s*$/.test(out) && body.toLowerCase() === lowFrom) {
        next = prop[1].replace(new RegExp(c, 'g'), '\\' + c);
      } else if (
        tag &&
        (/\b(hasTag|taggedWith)\s*\([^()]*$/.test(out) ||
          /\btags\s*\.\s*contains(?:Any|All)?\s*\([^()]*$/.test(out))
      ) {
        next = renameTagText(body, tag[0], tag[1]);
      } else if (
        val &&
        body === val[1] &&
        (valBefore.some((re) => re.test(out)) || valAfter.test(expr.slice(j + 1)))
      ) {
        next = val[2].replace(new RegExp(c, 'g'), '\\' + c);
      }
      out += c + next + close;
      i = j + 1;
      continue;
    }

    if (prop && /[A-Za-z_$]/.test(c) && !partOf(expr[i - 1])) {
      let j = i;
      while (j < n && partOf(expr[j])) j++;
      const word = expr.slice(i, j);
      if (word.toLowerCase() === lowFrom) {
        const dotted = /(^|[^\w$.])(note|this)\s*\.\s*$/.exec(out);
        const member = /\.\s*$/.test(out);
        const call = /^\s*\(/.test(expr.slice(j));
        const to = prop[1];
        if (dotted && !call) {
          // note.from → note.to, or note["to"] when it isn't a plain word.
          if (!isIdentifier(to)) out = out.replace(/\s*\.\s*$/, '') + `[${JSON.stringify(to)}]`;
          else out += to;
          i = j;
          continue;
        }
        if (!member && !call && BASE_WORDS.indexOf(lowFrom) === -1) {
          out += isIdentifier(to) ? to : `note[${JSON.stringify(to)}]`;
          i = j;
          continue;
        }
      }
      out += word;
      i = j;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/** One property named on its own — a column, a sort, a grouping — renamed. */
function renamePropertyId(id, from, to) {
  if (typeof id !== 'string') return id;
  const low = from.toLowerCase();
  const dotted = /^note\.(.+)$/.exec(id);
  if (dotted) return dotted[1].toLowerCase() === low ? `note.${to}` : id;
  if (/^(file|formula|this)\./.test(id)) return id;
  return id.toLowerCase() === low ? to : id;
}

/**
 * A base's settings, parsed from its YAML, with a property or a tag
 * renamed throughout. Returns a new object; the one given is untouched.
 */
function renameInBase(base, what) {
  if (!base || typeof base !== 'object') return base;
  const out = JSON.parse(JSON.stringify(base));
  const expr = (e) => renameInExpression(e, what);
  const id = (v) => (what.property ? renamePropertyId(v, what.property[0], what.property[1]) : v);

  const filters = (node) => {
    if (typeof node === 'string') return expr(node);
    if (Array.isArray(node)) return node.map(filters);
    if (node && typeof node === 'object') {
      const next = {};
      Object.keys(node).forEach((k) => (next[k] = filters(node[k])));
      return next;
    }
    return node;
  };
  const renameKeys = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const next = {};
    Object.keys(obj).forEach((k) => {
      const key = id(k);
      if (!(key in next)) next[key] = obj[k];
    });
    return next;
  };
  const byProperty = (entry) => {
    if (typeof entry === 'string') return id(entry);
    if (entry && typeof entry === 'object' && typeof entry.property === 'string') {
      return Object.assign({}, entry, { property: id(entry.property) });
    }
    return entry;
  };

  if (out.filters !== undefined) out.filters = filters(out.filters);
  if (out.formulas && typeof out.formulas === 'object') {
    Object.keys(out.formulas).forEach((k) => (out.formulas[k] = expr(out.formulas[k])));
  }
  if (out.properties) out.properties = renameKeys(out.properties);

  (Array.isArray(out.views) ? out.views : []).forEach((view) => {
    if (!view || typeof view !== 'object') return;
    if (view.filters !== undefined) view.filters = filters(view.filters);
    if (Array.isArray(view.order)) view.order = view.order.map(id);
    if (Array.isArray(view.sort)) view.sort = view.sort.map(byProperty);
    if (view.groupBy !== undefined) view.groupBy = byProperty(view.groupBy);
    if (view.summaries) view.summaries = renameKeys(view.summaries);
    // Anything else naming a property outright: a card's image, a map's place.
    Object.keys(view).forEach((k) => {
      if (['name', 'type', 'filters', 'order', 'sort', 'groupBy', 'summaries'].indexOf(k) !== -1) return;
      if (typeof view[k] === 'string' && /^note\./.test(view[k])) view[k] = id(view[k]);
    });
  });
  return out;
}

/**
 * A base's YAML with the rename applied, or null if nothing in it
 * changed — so a base that doesn't mention the name is never rewritten.
 */
function renameInBaseText(text, what) {
  let parsed;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const next = renameInBase(parsed, what);
  if (sameValue(next, parsed)) return null;
  return stringifyYaml(next);
}

/* A base written into a note as a code block. */
const BASE_BLOCK = /^([ \t]*)(`{3,}|~{3,})[ \t]*base[ \t]*$/;

/** A note's text with the rename applied in its base blocks, or null if none changed. */
function renameInBaseBlocks(text, what) {
  const lines = text.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const open = BASE_BLOCK.exec(lines[i]);
    if (!open) continue;
    const indent = open[1];
    const fence = open[2];
    let end = i + 1;
    while (end < lines.length && !new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`).test(lines[end])) end++;
    if (end >= lines.length) break;
    const body = lines
      .slice(i + 1, end)
      .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
      .join('\n');
    const next = renameInBaseText(body, what);
    if (next !== null) {
      const replaced = next.replace(/\n+$/, '').split('\n').map((l) => (l ? indent + l : l));
      lines.splice(i + 1, end - i - 1, ...replaced);
      end = i + 1 + replaced.length;
      changed = true;
    }
    i = end;
  }
  return changed ? lines.join('\n') : null;
}

/* -- settings --------------------------------------------------------- */

/** A comma-separated list of names with one renamed, or null if it isn't in it. */
function renameInNameList(list, from, to) {
  if (typeof list !== 'string' || !list.trim()) return null;
  const low = from.toLowerCase();
  const parts = list.split(',').map((s) => s.trim());
  if (!parts.some((p) => p.toLowerCase() === low)) return null;
  return uniqueList(parts.map((p) => (p.toLowerCase() === low ? to : p)).filter(Boolean)).join(', ');
}

/**
 * This plugin's settings with a property renamed wherever they name
 * one. Returns the labels of what changed, and a way to put each back
 * if it hasn't been changed again since.
 */
function renamePropertyInSettings(settings, from, to) {
  const low = from.toLowerCase();
  const changed = [];
  const undo = [];
  const keep = (label, get, set) => {
    const before = JSON.stringify(get());
    return (next) => {
      set(next);
      const after = JSON.stringify(get());
      if (after === before) return;
      changed.push(label);
      undo.push(() => {
        if (JSON.stringify(get()) === after) set(JSON.parse(before));
      });
    };
  };

  [
    ['coverProperty', 'Cover image property'],
    ['categoryProperty', 'Search categories'],
    ['graphRouteProperty', 'Graph links decided by'],
  ].forEach(([key, label]) => {
    if (typeof settings[key] === 'string' && settings[key].trim().toLowerCase() === low) {
      keep(label, () => settings[key], (v) => (settings[key] = v))(to);
    }
  });

  [
    ['albumColumns', 'Album columns'],
    ['tableColumns', 'Notes table columns'],
  ].forEach(([key, label]) => {
    const next = renameInNameList(settings[key], from, to);
    if (next !== null) keep(label, () => settings[key], (v) => (settings[key] = v))(next);
  });

  const sections = Array.isArray(settings.librarySections) ? settings.librarySections : [];
  const renamedSections = sections.map((section) =>
    Object.assign({}, section, {
      items: (section.items || []).map((item) =>
        item && item.kind === 'property' && String(item.key).toLowerCase() === low
          ? Object.assign({}, item, { key: to.toLowerCase() })
          : item
      ),
    })
  );
  if (!sameValue(renamedSections, sections)) {
    keep('Library', () => settings.librarySections, (v) => (settings.librarySections = v))(renamedSections);
  }

  // Graph conditions are put back one by one: an open graph re-saves
  // its own entry as soon as it follows the rename, so the entry as a
  // whole won't read as this left it by the time of an undo.
  const graphs = settings.graphFilters || {};
  const moved = [];
  Object.keys(graphs).forEach((type) => {
    const saved = graphs[type];
    if (!saved || !Array.isArray(saved.rules)) return;
    saved.rules.forEach((rule, index) => {
      if (!rule || String(rule.key || '').toLowerCase() !== low) return;
      moved.push({ type, index, key: rule.key });
      saved.rules[index] = Object.assign({}, rule, { key: to });
    });
  });
  if (moved.length) {
    changed.push('Graph property filters');
    undo.push(() =>
      moved.forEach(({ type, index, key }) => {
        const rules = settings.graphFilters && settings.graphFilters[type] && settings.graphFilters[type].rules;
        if (rules && rules[index] && rules[index].key === to) {
          rules[index] = Object.assign({}, rules[index], { key });
        }
      })
    );
  }

  return { changed, undo: () => undo.forEach((f) => f()) };
}

/* -- the service -------------------------------------------------------- */

/**
 * Plans and makes bulk changes, and keeps the last one for undoing.
 *
 * Every file is read before and after its change, and undo puts back
 * the earlier text only where the file still reads as this left it: a
 * note edited since keeps that edit, and is reported instead.
 */
class BulkEdits {
  constructor(plugin) {
    this.plugin = plugin;
    this.last = null;
    this.busy = false;
    this.baseCache = null;
  }

  get app() {
    return this.plugin.app;
  }

  /* -- what a change covers ------------------------------------------ */

  /**
   * The notes a set of folders and notes covers. scope: 'deep' (in them
   * and their subfolders), 'direct' (in them only) or 'folder-notes'.
   */
  notesFor(targets, scope) {
    const out = [];
    const add = (f) => {
      if (f instanceof TFile && f.extension === 'md' && out.indexOf(f) === -1) out.push(f);
    };
    (targets || []).forEach((target) => {
      if (target instanceof TFile) return add(target);
      if (!(target instanceof TFolder)) return;
      if (scope === 'folder-notes') {
        const note = this.plugin.folderNote(target);
        if (note) add(note);
        return;
      }
      const walk = (folder) =>
        (folder.children || []).forEach((child) => {
          if (child instanceof TFolder) {
            if (scope === 'deep') walk(child);
          } else add(child);
        });
      walk(target);
    });
    return out.sort((a, b) => byName(a.path, b.path));
  }

  /**
   * How each property's name is written across the notes: for each, by
   * its name in small letters, every spelling and how many notes use it.
   */
  propertySpellings() {
    const all = new Map();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      Object.keys(this.frontmatterOf(file)).forEach((key) => {
        const low = key.toLowerCase();
        if (!all.has(low)) all.set(low, new Map());
        const counts = all.get(low);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return all;
  }

  frontmatterOf(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = Object.assign({}, (cache && cache.frontmatter) || {});
    delete fm.position;
    return fm;
  }

  /**
   * Which of the notes an addition would change, going by the cache —
   * and, for each property, how many notes already hold a value of their
   * own for it, which is what keeping or replacing decides.
   */
  planAdd(files, props, replace) {
    const changing = [];
    const held = {};
    files.forEach((file) => {
      const fm = this.frontmatterOf(file);
      props.forEach(({ key, value }) => {
        const have = keyLike(fm, key);
        if (have === undefined) return;
        const current = fm[have];
        // Nothing there yet, the same already, or lists, which merge.
        if (isBlank(current) || sameValue(current, value)) return;
        if (Array.isArray(current) || Array.isArray(value)) return;
        held[key] = (held[key] || 0) + 1;
      });
      if (addPropertiesTo(JSON.parse(JSON.stringify(fm)), props, replace)) changing.push(file);
    });
    return { files, changing, held };
  }

  /** How many notes carry a property, and which. */
  notesWithProperty(name) {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => keyLike(this.frontmatterOf(file), name) !== undefined);
  }

  /**
   * A property rename worked out from the cache: the notes it renames
   * in, the ones where two properties become one, the ones left as they
   * are because their values differ, and the settings that name it.
   */
  planPropertyRename(from, to) {
    const renamed = [];
    const merged = [];
    const conflicts = [];
    this.notesWithProperty(from).forEach((file) => {
      const result = renamePropertyIn(JSON.parse(JSON.stringify(this.frontmatterOf(file))), from, to);
      if (result === 'renamed') renamed.push(file);
      else if (result === 'merged') merged.push(file);
      else if (result === 'conflict') conflicts.push(file);
    });
    const settings = renamePropertyInSettings(JSON.parse(JSON.stringify(this.plugin.settings)), from, to).changed;
    return { renamed, merged, conflicts, settings, total: renamed.length + merged.length };
  }

  /**
   * A merge worked out from the cache: the notes it changes, those
   * where the values differ (put together in a list, or left as they
   * are), and the settings that name any of them.
   */
  planPropertyMerge(froms, to, mode) {
    const changed = [];
    const combined = [];
    const conflicts = [];
    const seen = new Set();
    froms.forEach((name) =>
      this.notesWithProperty(name).forEach((file) => {
        if (seen.has(file)) return;
        seen.add(file);
        const result = mergePropertiesIn(JSON.parse(JSON.stringify(this.frontmatterOf(file))), froms, to, mode);
        if (result === 'conflict') conflicts.push(file);
        else if (result === 'combined') {
          combined.push(file);
          changed.push(file);
        } else if (result !== 'absent' && result !== 'same') changed.push(file);
      })
    );
    const copy = JSON.parse(JSON.stringify(this.plugin.settings));
    const settings = [];
    froms.forEach((name) => {
      if (name.toLowerCase() === to.toLowerCase()) return;
      renamePropertyInSettings(copy, name, to).changed.forEach((label) => {
        if (settings.indexOf(label) === -1) settings.push(label);
      });
    });
    return { changed, combined, conflicts, settings, total: changed.length };
  }

  /** Notes with a tag or one beneath it, where it is, and nested tags met on the way. */
  planTagRename(from, to) {
    from = String(from).replace(/^#/, '');
    to = String(to || '').replace(/^#/, '');
    const files = [];
    let inText = 0;
    let inProps = 0;
    let already = 0;
    const nested = new Set();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const spots = tagSpots(cache, from);
      const fm = cache && cache.frontmatter;
      const inFm = fmHasTag(fm, from);
      noteTags(cache).forEach((t) => {
        if (tagUnder(t, from) && t !== from.toLowerCase()) nested.add(t);
      });
      if (spots.length || inFm) {
        files.push(file);
        if (spots.length) inText++;
        if (inFm) inProps++;
      }
      // Notes already carrying the new name, which the rename merges into.
      if (to && to.toLowerCase() !== from.toLowerCase() && noteTags(cache).some((t) => t === to.toLowerCase())) {
        already++;
      }
    });
    return { files, inText, inProps, already, nested: Array.from(nested).sort(byName) };
  }

  /**
   * Files a base lives in: .base files, and notes with a base block.
   * Read once per dialog; `fresh` reads again.
   */
  async baseSources(fresh) {
    if (this.baseCache && !fresh) return this.baseCache;
    const vault = this.app.vault;
    const out = [];
    for (const file of vault.getFiles()) {
      if (file.extension === 'base') {
        out.push({ file, kind: 'base', text: await vault.cachedRead(file) });
      } else if (file.extension === 'md') {
        const text = await vault.cachedRead(file);
        if (/^[ \t]*(`{3,}|~{3,})[ \t]*base[ \t]*$/m.test(text)) out.push({ file, kind: 'blocks', text });
      }
    }
    this.baseCache = out;
    return out;
  }

  /** The bases a rename would change. */
  async basesFor(what) {
    const sources = await this.baseSources();
    return sources
      .filter((s) =>
        s.kind === 'base' ? renameInBaseText(s.text, what) !== null : renameInBaseBlocks(s.text, what) !== null
      )
      .map((s) => s.file);
  }

  /** Notes where a property holds a value, and those where a list of it already holds the new one. */
  planValueRename(key, from, to) {
    const files = [];
    let merged = 0;
    this.notesWithProperty(key).forEach((file) => {
      const fm = JSON.parse(JSON.stringify(this.frontmatterOf(file)));
      const have = keyLike(fm, key);
      const hadTo = Array.isArray(fm[have]) && fm[have].some((x) => valueKey(x) === to);
      if (renameValueIn(fm, key, from, to)) {
        files.push(file);
        if (hadTo) merged++;
      }
    });
    return { files, merged };
  }

  /** The notes a removal would change. */
  planRemove(files, keys) {
    return files.filter((file) =>
      removePropertiesFrom(JSON.parse(JSON.stringify(this.frontmatterOf(file))), keys)
    );
  }

  /**
   * A type change worked out from the cache: the notes whose values are
   * converted, those whose values can't be and are left, and how many
   * are already right.
   */
  planTypeChange(key, type) {
    const convert = [];
    const stuck = [];
    let fine = 0;
    this.notesWithProperty(key).forEach((file) => {
      const fm = this.frontmatterOf(file);
      const value = fm[keyLike(fm, key)];
      const result = convertValue(value, type);
      if (!result.ok) stuck.push(file);
      else if (sameValue(result.value, value)) fine++;
      else convert.push(file);
    });
    return { convert, stuck, fine };
  }

  /** Notes without a property, or with it empty. */
  missing(files, key) {
    return files.filter((file) => {
      const fm = this.frontmatterOf(file);
      const have = keyLike(fm, key);
      return have === undefined || isBlank(fm[have]);
    });
  }

  /** Rename one value of a property in every note and base that uses it. */
  async renameValue(key, from, to) {
    const app = this.app;
    const what = { value: [key, from, to] };
    const record = await this.run(`Renaming “${from}”`, async (touch, step, rec) => {
      const { files } = this.planValueRename(key, from, to);
      let done = 0;
      for (const file of files) {
        await touch(file, () => app.fileManager.processFrontMatter(file, (fm) => renameValueIn(fm, key, from, to)));
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);
    });
    if (!record) return null;
    this.followRename({ value: [key, from, to] });
    record.undoFollow = () => this.followRename({ value: [key, to, from] });
    return record;
  }

  /** Take properties out of the notes. */
  async removeProperties(files, keys) {
    const fm = this.app.fileManager;
    const changing = this.planRemove(files, keys);
    const label = `Removing ${keys.length === 1 ? `“${keys[0]}”` : `${keys.length} properties`}`;
    return this.run(label, async (touch, step) => {
      let done = 0;
      for (const file of changing) {
        await touch(file, () => fm.processFrontMatter(file, (data) => removePropertiesFrom(data, keys)));
        step(++done, changing.length);
      }
    });
  }

  /**
   * Give a property a type everywhere, converting the values that can
   * be converted and leaving — and naming — any that can't.
   */
  async changeType(key, type) {
    const app = this.app;
    const before = assignedType(app, key);
    // What it was taken to be, if nothing was assigned, to go back to.
    const seen = propertyType(app, key);
    const record = await this.run(`Changing “${key}”`, async (touch, step, rec) => {
      const plan = this.planTypeChange(key, type);
      rec.stuck = plan.stuck;
      let done = 0;
      for (const file of plan.convert) {
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (fm) => {
            const have = keyLike(fm, key);
            if (have === undefined) return;
            const result = convertValue(fm[have], type);
            if (result.ok) fm[have] = result.value;
          })
        );
        step(++done, plan.convert.length);
      }
      try {
        app.metadataTypeManager.setType(key, type);
        rec.undoSettings = () => {
          try {
            if (before) app.metadataTypeManager.setType(key, before);
            else if (typeof app.metadataTypeManager.unsetType === 'function') app.metadataTypeManager.unsetType(key);
            else app.metadataTypeManager.setType(key, seen);
          } catch (err) {
            /* the values are back either way */
          }
        };
      } catch (err) {
        /* the values are converted; Obsidian infers the type from them */
      }
    });
    return record;
  }

  /** Fill a property in the notes that lack it. */
  async fill(files, key, value, type) {
    const fm = this.app.fileManager;
    const record = await this.run(`Filling “${key}”`, async (touch, step) => {
      let done = 0;
      for (const file of files) {
        await touch(file, () =>
          fm.processFrontMatter(file, (data) => {
            const have = keyLike(data, key);
            if (have !== undefined && !isBlank(data[have])) return;
            data[have === undefined ? key : have] = value;
          })
        );
        step(++done, files.length);
      }
    });
    if (record && type && type !== 'text' && !assignedType(this.app, key)) {
      try {
        this.app.metadataTypeManager.setType(key, type);
      } catch (err) {
        /* inferred from the values */
      }
    }
    return record;
  }

  /* -- making changes ----------------------------------------------- */

  /**
   * Run a change, recording each file's text before and after. A
   * notice counts the notes as they go, since a large vault takes a
   * moment. Returns the record, which becomes the one Undo reverses.
   */
  async run(label, work) {
    if (this.busy) {
      new Notice('Another change is still being made.');
      return null;
    }
    this.busy = true;
    this.baseCache = null;
    const record = { label, files: [], failed: [], undoSettings: null };
    const progress = new Notice(`${label}…`, 0);
    const vault = this.app.vault;
    const touch = async (file, edit) => {
      try {
        const before = await vault.read(file);
        await edit(file);
        const after = await vault.read(file);
        if (after !== before) record.files.push({ file, before, after });
        return after !== before;
      } catch (err) {
        console.error(`Design Redux: could not change ${file.path}`, err);
        record.failed.push(file);
        return false;
      }
    };
    const step = (done, total) => {
      if (typeof progress.setMessage === 'function' && total > 20 && done % 10 === 0) {
        progress.setMessage(`${label}… ${done} of ${total}`);
      }
    };
    try {
      await work(touch, step, record);
    } finally {
      this.busy = false;
      if (typeof progress.hide === 'function') progress.hide();
    }
    if (record.files.length || record.undoSettings) this.last = record;
    return record;
  }

  /**
   * Add properties to the notes. Only a note the cache says will change
   * is written, since writing properties back can re-save a note's
   * frontmatter even when nothing in it is different.
   */
  async addProperties(files, props, replace) {
    const fm = this.app.fileManager;
    files = this.planAdd(files, props, replace).changing;
    const types = props.filter((p) => p.type && !assignedType(this.app, p.key));
    const label = `Adding ${props.length === 1 ? `“${props[0].key}”` : `${props.length} properties`}`;
    const record = await this.run(label, async (touch, step) => {
      let done = 0;
      for (const file of files) {
        await touch(file, () => fm.processFrontMatter(file, (data) => addPropertiesTo(data, props, replace)));
        step(++done, files.length);
      }
    });
    if (!record) return null;
    // A new property gets the type it was given here, so Obsidian shows
    // a list as a list from the first note on.
    types.forEach((p) => {
      try {
        if (p.type !== 'text' && typeof this.app.metadataTypeManager.setType === 'function') {
          this.app.metadataTypeManager.setType(p.key, p.type);
        }
      } catch (err) {
        /* the values still read as what they are */
      }
    });
    return record;
  }

  /**
   * Rename a property in every note that has it, in bases, and in this
   * plugin's settings. Notes where the two names hold different values
   * are left as they are and reported.
   */
  async renameProperty(from, to) {
    const app = this.app;
    const what = { property: [from, to] };
    const type = assignedType(app, from);
    const record = await this.run(`Renaming “${from}”`, async (touch, step, rec) => {
      const plan = this.planPropertyRename(from, to);
      const files = plan.renamed.concat(plan.merged);
      rec.conflicts = plan.conflicts.slice();
      let done = 0;
      for (const file of files) {
        let result = 'absent';
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (data) => {
            result = renamePropertyIn(data, from, to);
          })
        );
        if (result === 'conflict' && rec.conflicts.indexOf(file) === -1) rec.conflicts.push(file);
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);

      const settings = renamePropertyInSettings(this.plugin.settings, from, to);
      rec.settings = settings.changed;
      if (settings.changed.length) {
        rec.undoSettings = () => {
          settings.undo();
          this.afterSettings(to, from);
        };
        await this.plugin.saveData(this.plugin.settings);
        this.afterSettings(from, to);
      }
    });
    if (!record) return null;
    if (type && from.toLowerCase() !== to.toLowerCase() && !assignedType(app, to)) {
      try {
        app.metadataTypeManager.setType(to, type);
      } catch (err) {
        /* Obsidian infers it again from the values */
      }
    }
    this.followRename({ property: [from, to] });
    record.undoFollow = () => this.followRename({ property: [to, from] });
    return record;
  }

  /**
   * Several properties made one, in every note that has any of them, in
   * bases and in this plugin's settings. Where a note's values differ,
   * `mode` 'list' puts them together; otherwise it's left and reported.
   */
  async mergeProperties(froms, to, mode) {
    const app = this.app;
    const others = froms.filter((name) => name.toLowerCase() !== to.toLowerCase());
    const type = assignedType(app, to) || froms.map((name) => assignedType(app, name)).find(Boolean) || null;
    const label = `Merging ${nameList(froms)} into “${to}”`;
    const record = await this.run(label, async (touch, step, rec) => {
      const plan = this.planPropertyMerge(froms, to, mode);
      rec.conflicts = plan.conflicts.slice();
      rec.combined = plan.combined.slice();
      let done = 0;
      for (const file of plan.changed) {
        let result = 'absent';
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (data) => {
            result = mergePropertiesIn(data, froms, to, mode);
          })
        );
        if (result === 'conflict' && rec.conflicts.indexOf(file) === -1) rec.conflicts.push(file);
        step(++done, plan.changed.length);
      }
      rec.bases = [];
      for (const name of others) {
        (await this.rewriteBases({ property: [name, to] }, touch)).forEach((file) => {
          if (rec.bases.indexOf(file) === -1) rec.bases.push(file);
        });
      }

      const undo = [];
      rec.settings = [];
      others.forEach((name) => {
        const settings = renamePropertyInSettings(this.plugin.settings, name, to);
        if (!settings.changed.length) return;
        settings.changed.forEach((l) => rec.settings.indexOf(l) === -1 && rec.settings.push(l));
        undo.unshift(() => {
          settings.undo();
          this.afterSettings(to, name);
        });
      });
      if (undo.length) {
        rec.undoSettings = () => undo.forEach((fn) => fn());
        await this.plugin.saveData(this.plugin.settings);
        others.forEach((name) => this.afterSettings(name, to));
      }
    });
    if (!record) return null;
    // Values put together in lists make it a list property.
    const listType = record.combined && record.combined.length && (!type || type === 'text') ? 'multitext' : null;
    const want = listType || type;
    if (want && want !== assignedType(app, to)) {
      try {
        app.metadataTypeManager.setType(to, want);
      } catch (err) {
        /* Obsidian infers it again from the values */
      }
    }
    others.forEach((name) => this.followRename({ property: [name, to] }));
    record.undoFollow = () => others.forEach((name) => this.followRename({ property: [to, name] }));
    return record;
  }

  /** Rename a tag, and the tags nested beneath it, in notes' properties and text and in bases. */
  async renameTag(from, to) {
    const app = this.app;
    const what = { tag: [from, to] };
    const record = await this.run(`Renaming #${from}`, async (touch, step, rec) => {
      const { files } = this.planTagRename(from, to);
      rec.stale = [];
      let done = 0;
      for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        const spots = tagSpots(cache, from);
        const inFm = fmHasTag(cache && cache.frontmatter, from);
        await touch(file, async () => {
          // The text first, at the places the cache found; the
          // properties after, since rewriting them moves those places.
          if (spots.length) {
            let stale = false;
            await app.vault.process(file, (text) => {
              const next = renameTagsAt(text, spots, from, to);
              if (next === null) {
                stale = true;
                return text;
              }
              return next;
            });
            if (stale) rec.stale.push(file);
          }
          if (inFm) await app.fileManager.processFrontMatter(file, (data) => renameTagIn(data, from, to));
        });
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);
    });
    if (!record) return null;
    this.followRename({ tag: [from, to] });
    record.undoFollow = () => this.followRename({ tag: [to, from] });
    return record;
  }

  /** Apply a rename to every base that mentions it. Returns the files changed. */
  async rewriteBases(what, touch) {
    const changed = [];
    const vault = this.app.vault;
    const rename = (source, text) =>
      source.kind === 'base' ? renameInBaseText(text, what) : renameInBaseBlocks(text, what);
    for (const source of await this.baseSources(true)) {
      if (rename(source, source.text) === null) continue;
      const did = await touch(source.file, () =>
        vault.process(source.file, (text) => {
          const next = rename(source, text);
          return next === null ? text : next;
        })
      );
      if (did) changed.push(source.file);
    }
    this.baseCache = null;
    return changed;
  }

  /** Graphs and the sidebar follow a change to the settings that name a property. */
  afterSettings(from, to) {
    const graph = this.plugin.feature(GraphPropertyFilter);
    if (graph && typeof graph.renameProperty === 'function') graph.renameProperty(from, to);
    const library = this.plugin.feature(Library);
    if (library && typeof library.refreshViews === 'function') library.refreshViews();
  }

  /** Open screens that were showing the old name show the new one. */
  followRename(what) {
    liveViews(this.app, BROWSE_VIEW, BrowseView).forEach((view) => {
      if (what.property) {
        const [from, to] = what.property;
        if (view.property && view.property.toLowerCase() === from.toLowerCase()) {
          view.property = to.toLowerCase();
        }
        if (view.filterProp && String(view.filterProp.key).toLowerCase() === from.toLowerCase()) {
          view.filterProp = Object.assign({}, view.filterProp, { key: to });
        }
      }
      if (what.tag) {
        const [from, to] = what.tag;
        if (view.filterTag && tagUnder(view.filterTag, from)) {
          view.filterTag = renameTagText(view.filterTag, from, to).toLowerCase();
        }
      }
      if (what.value) {
        const [key, from, to] = what.value;
        const sameKey = (k) => String(k || '').toLowerCase() === key.toLowerCase();
        if (sameKey(view.property) && view.value === from) view.value = to;
        if (view.filterProp && sameKey(view.filterProp.key) && view.filterProp.value === from) {
          view.filterProp = Object.assign({}, view.filterProp, { value: to });
        }
      }
    });
    // Once Obsidian has read the changed files back.
    window.setTimeout(() => this.plugin.refreshBrowse(), 400);
  }

  /** Put back what the last change altered, where it hasn't been edited since. */
  async undo() {
    const record = this.last;
    if (!record) {
      new Notice('There is no bulk change to undo.');
      return null;
    }
    if (this.busy) {
      new Notice('Another change is still being made.');
      return null;
    }
    this.last = null;
    this.busy = true;
    let restored = 0;
    const kept = [];
    try {
      for (const { file, before, after } of record.files.slice().reverse()) {
        let ok = false;
        try {
          await this.app.vault.process(file, (text) => {
            if (text !== after) return text;
            ok = true;
            return before;
          });
        } catch (err) {
          ok = false;
        }
        if (ok) restored++;
        else kept.push(file);
      }
      if (record.undoSettings) {
        record.undoSettings();
        await this.plugin.saveData(this.plugin.settings);
      }
    } finally {
      this.busy = false;
    }
    if (record.undoFollow) record.undoFollow();
    this.baseCache = null;
    window.setTimeout(() => this.plugin.refreshBrowse(), 400);
    const notes = (n) => (n === 1 ? '1 file' : `${n} files`);
    new Notice(
      kept.length
        ? `Undone in ${notes(restored)}. ${notes(kept.length)} changed since, so left as they are: ${kept
            .slice(0, 3)
            .map((f) => f.basename)
            .join(', ')}${kept.length > 3 ? '…' : ''}`
        : `Undone in ${notes(restored)}.`,
      kept.length ? 10000 : 4000
    );
    return { restored, kept };
  }
}

/* -- dialogs ---------------------------------------------------------- */

const bulkCount = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/** Names in a sentence: "status", "status and domain", "status, domain and 2 more". */
function nameList(names, quote = true, most = 3) {
  const q = names.map((n) => (quote ? `“${n}”` : n));
  if (q.length <= 1) return q.join('');
  if (q.length <= most) return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
  return `${q.slice(0, most - 1).join(', ')} and ${q.length - most + 1} more`;
}

/** What a finished change did, with Undo while it's still the last one. */
function bulkNotice(bulk, message, record) {
  const frag = document.createDocumentFragment();
  const box = document.createElement('div');
  box.className = 'dr-bulk-notice';
  frag.appendChild(box);
  box.createDiv({ text: message });
  let notice = null;
  if (record && bulk.last === record) {
    const undo = box.createEl('button', { cls: 'dr-bulk-undo', text: 'Undo' });
    undo.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (notice && typeof notice.hide === 'function') notice.hide();
      bulk.undo();
    });
  }
  notice = new Notice(frag, record && bulk.last === record ? 12000 : 6000);
  return notice;
}

/** The ends of a result message: notes left alone, and notes that failed. */
function bulkTail(record) {
  const parts = [];
  if (record.conflicts && record.conflicts.length) {
    parts.push(
      `${bulkCount(record.conflicts.length, 'note')} kept both, as the values differ: ${nameList(
        record.conflicts.map((f) => f.basename), false
      )}.`
    );
  }
  if (record.stale && record.stale.length) {
    parts.push(`${bulkCount(record.stale.length, 'note')} changed while this ran and ${record.stale.length === 1 ? 'was' : 'were'} left: try again.`);
  }
  if (record.failed && record.failed.length) {
    parts.push(`${bulkCount(record.failed.length, 'file')} couldn't be changed; the console says why.`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

/** Notes changed by a record, leaving out the bases it changed too. */
function notesChanged(record) {
  const bases = record.bases || [];
  return record.files.filter((f) => bases.indexOf(f.file) === -1).length;
}

