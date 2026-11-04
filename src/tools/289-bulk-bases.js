/* ------------------------------------------------------------------ */
/* Bulk edits: bases and settings                                     */
/*                                                                    */
/* A property renamed in a base — its filters, formulas, columns, sort*/
/* and grouping — and in this plugin's own settings.                  */
/* ------------------------------------------------------------------ */

import { parseYaml, stringifyYaml } from 'obsidian';
import { renameTagText } from '../core/047-helpers-text.js';
import { sameValue } from '../core/073-notes.js';
import { escapeRegExp, uniqueList } from './288-bulk-values.js';

/* -- bases ------------------------------------------------------------ */

/*
 * A base names a note's property three ways — "status", "note.status"
 * and note["status"] — in its filters and formulas, which are
 * expressions, and in its columns, sort and grouping, which name one
 * property each. Renaming follows all of them. The words a base uses
 * for itself are never a property's bare name.
 */
export const BASE_WORDS = [
  'file', 'note', 'formula', 'this', 'value', 'values', 'index',
  'true', 'false', 'null', 'undefined', 'and', 'or', 'not',
];

export const isIdentifier = (s) => /^[A-Za-z_$][\w$]*$/.test(s);

/**
 * An expression with a property renamed, or a tag renamed inside the
 * text it tests for (hasTag, tags.contains). String literals are
 * skipped whole, so a word inside quotes is never taken for a name.
 * `what` is { property: [from, to] } or { tag: [from, to] }.
 */
export function renameInExpression(expr, what) {
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
export function renamePropertyId(id, from, to) {
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
export function renameInBase(base, what) {
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
export function renameInBaseText(text, what) {
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
export const BASE_BLOCK = /^([ \t]*)(`{3,}|~{3,})[ \t]*base[ \t]*$/;

/** A note's text with the rename applied in its base blocks, or null if none changed. */
export function renameInBaseBlocks(text, what) {
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
export function renameInNameList(list, from, to) {
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
export function renamePropertyInSettings(settings, from, to) {
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
    ['coverProperty', 'Cover property'],
    ['categoryProperty', 'Search categories'],
    ['graphRouteProperty', 'Parent property'],
  ].forEach(([key, label]) => {
    if (typeof settings[key] === 'string' && settings[key].trim().toLowerCase() === low) {
      keep(label, () => settings[key], (v) => (settings[key] = v))(to);
    }
  });

  [
    ['albumColumns', 'Collection columns'],
    ['tableColumns', 'Notes table columns'],
    ['stripDetail', 'Detail line'],
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

  // Schemas name the property in each folder's entries; value options keep it as their key.
  const schemas = settings.propertySchemas || {};
  const renamedSchemas = {};
  Object.keys(schemas).forEach((path) => {
    renamedSchemas[path] = (schemas[path] || []).map((e) => (e && String(e.key).toLowerCase() === low ? Object.assign({}, e, { key: to }) : e));
  });
  if (!sameValue(renamedSchemas, schemas)) keep('Property schemas', () => settings.propertySchemas, (v) => (settings.propertySchemas = v))(renamedSchemas);
  // Rules name it in what they look for and what they set.
  const rules = Array.isArray(settings.propertyRules) ? settings.propertyRules : [];
  const named = (k) => String(k || '').toLowerCase() === low;
  const renamedRules = rules.map((r) =>
    !r ? r : Object.assign({}, r, {
      when: r.when && named(r.when.key) ? Object.assign({}, r.when, { key: to }) : r.when,
      set: Array.isArray(r.set) ? r.set.map((s) => (s && named(s.key) ? Object.assign({}, s, { key: to }) : s)) : r.set,
    })
  );
  if (!sameValue(renamedRules, rules)) keep('Property rules', () => settings.propertyRules, (v) => (settings.propertyRules = v))(renamedRules);
  const options = settings.propertyOptions || {};
  const optionKey = Object.keys(options).find((k) => k.toLowerCase() === low);
  if (optionKey !== undefined && optionKey !== to) {
    const renamedOptions = {};
    Object.keys(options).forEach((k) => {
      if (k === optionKey) renamedOptions[to] = Object.assign({}, options[to] || {}, options[k]);
      else if (k !== to) renamedOptions[k] = options[k];
    });
    keep('Value colours and icons', () => settings.propertyOptions, (v) => (settings.propertyOptions = v))(renamedOptions);
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

