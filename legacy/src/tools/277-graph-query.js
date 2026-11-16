/* ------------------------------------------------------------------ */
/* The graph in three dimensions: its search, as Obsidian's           */
/*                                                                    */
/* The 3D graph's filter takes what Obsidian's search takes, so a     */
/* query brought over from the graph (or written as for search) finds */
/* the same notes: words, all of which must match, in a note's name   */
/* or its text; "a phrase"; -leaving out; OR; (groups); /a regex/;   */
/* and file:, path:, tag: (with its nested tags), content:, line:,    */
/* block:, section:, task: and [property] or [property:value]. Case   */
/* is not minded, as Obsidian's search doesn't by default. An        */
/* operator before a group applies to what's in it: path:(a b).      */
/* ------------------------------------------------------------------ */

/** Where a note's text is looked in: these all look in it (the finer ones, as a whole). */
const QUERY_TEXT_OPS = new Set(['content', 'line', 'block', 'section', 'task', 'task-todo', 'task-done']);
const QUERY_OPS = new Set(['file', 'path', 'tag'].concat([...QUERY_TEXT_OPS]));

function queryRegex(body) {
  try {
    return new RegExp(body, 'i');
  } catch (err) {
    return null;
  }
}

/** The query in tokens: open, close, not, or, and terms { op, value | regex | key }. */
function lexQuery(s, outerOp) {
  const out = [];
  let i = 0;
  const term = (op, value, regex) => out.push({ type: 'term', op: op || outerOp || '', value, regex: regex || null });
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      out.push({ type: 'open' });
      i++;
      continue;
    }
    if (c === ')') {
      out.push({ type: 'close' });
      i++;
      continue;
    }
    if (c === '-' && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      out.push({ type: 'not' });
      i++;
      continue;
    }
    if (c === '[') {
      const end = s.indexOf(']', i);
      const body = s.slice(i + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 1;
      const cut = body.indexOf(':');
      const key = (cut < 0 ? body : body.slice(0, cut)).trim().toLowerCase();
      let value = cut < 0 ? null : body.slice(cut + 1).trim();
      if (value && value.length > 1 && value[0] === '"' && value[value.length - 1] === '"') value = value.slice(1, -1);
      out.push({ type: 'term', op: 'property', key, value: value === null ? null : value.toLowerCase(), regex: null });
      continue;
    }
    const named = /^([a-z-]+):/i.exec(s.slice(i));
    let op = '';
    if (named && QUERY_OPS.has(named[1].toLowerCase())) {
      op = named[1].toLowerCase();
      i += named[0].length;
    }
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      term(op, s.slice(i + 1, end < 0 ? s.length : end).toLowerCase());
      i = end < 0 ? s.length : end + 1;
    } else if (s[i] === '/') {
      let end = i + 1;
      while (end < s.length && !(s[end] === '/' && s[end - 1] !== '\\')) end++;
      const body = s.slice(i + 1, end);
      const regex = queryRegex(body);
      if (regex) term(op, '', regex);
      else term(op, body.toLowerCase());
      i = end + 1;
    } else if (op && s[i] === '(') {
      // An operator before a group: each thing in it, under that operator.
      let depth = 0;
      let end = i;
      for (; end < s.length; end++) {
        if (s[end] === '(') depth++;
        else if (s[end] === ')' && --depth === 0) break;
      }
      out.push({ type: 'open' });
      lexQuery(s.slice(i + 1, end), op).forEach((t) => out.push(t));
      out.push({ type: 'close' });
      i = end + 1;
    } else {
      let end = i;
      while (end < s.length && !/[\s()]/.test(s[end])) end++;
      const word = s.slice(i, end);
      i = end;
      if (!word) continue;
      if (word === 'OR' && !op) out.push({ type: 'or' });
      else term(op, word.toLowerCase());
    }
  }
  return out;
}

/** A query as a tree — and / or / not over terms — or null when there's nothing to it. */
export function parseQuery(text) {
  const tokens = lexQuery(String(text || ''));
  if (!tokens.some((t) => t.type === 'term')) return null;
  let k = 0;
  const peek = () => tokens[k];
  const all = (parts) => (parts.length === 1 ? parts[0] : { type: 'and', parts });
  function unary() {
    const t = peek();
    if (!t) return { type: 'and', parts: [] };
    k++;
    if (t.type === 'not') return { type: 'not', part: unary() };
    if (t.type === 'open') {
      const inner = or();
      if (peek() && peek().type === 'close') k++;
      return inner;
    }
    if (t.type === 'term') return t;
    return { type: 'and', parts: [] };
  }
  function and() {
    const parts = [];
    while (peek() && peek().type !== 'or' && peek().type !== 'close') parts.push(unary());
    return all(parts);
  }
  function or() {
    const parts = [and()];
    while (peek() && peek().type === 'or') {
      k++;
      parts.push(and());
    }
    return parts.length === 1 ? parts[0] : { type: 'or', parts };
  }
  const parts = [];
  while (k < tokens.length) {
    parts.push(or());
    if (peek() && peek().type === 'close') k++;
  }
  return all(parts);
}

function queryUses(tree, test) {
  if (!tree) return false;
  if (tree.type === 'term') return test(tree);
  if (tree.type === 'not') return queryUses(tree.part, test);
  return tree.parts.some((p) => queryUses(p, test));
}

/** Whether the query looks in notes' text (a word alone does, as Obsidian's does). */
export function queryNeedsText(tree) {
  return queryUses(tree, (t) => t.op === '' || QUERY_TEXT_OPS.has(t.op));
}

/** Whether it looks at properties. */
export function queryNeedsProps(tree) {
  return queryUses(tree, (t) => t.op === 'property');
}

function propValues(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.reduce((out, x) => out.concat(propValues(x)), []);
  if (typeof v === 'object') return Object.keys(v).reduce((out, k) => out.concat(propValues(v[k])), []);
  return [String(v)];
}

/**
 * Whether something drawn matches the query: { name, path, tags: ['#a'],
 * text (null when not read), props (a note's properties, or null) }.
 */
export function matchQuery(tree, item) {
  if (!tree) return true;
  if (tree.type === 'and') return tree.parts.every((p) => matchQuery(p, item));
  if (tree.type === 'or') return tree.parts.some((p) => matchQuery(p, item));
  if (tree.type === 'not') return !matchQuery(tree.part, item);
  const t = tree;
  const has = (hay) => (hay === null || hay === undefined ? false : t.regex ? t.regex.test(hay) : String(hay).toLowerCase().includes(t.value));
  if (t.op === '') return has(item.name) || has(item.text);
  if (t.op === 'file') return has(item.name);
  if (t.op === 'path') return has(item.path);
  if (QUERY_TEXT_OPS.has(t.op)) return has(item.text);
  if (t.op === 'tag') {
    const tags = item.tags || [];
    if (t.regex) return tags.some((tag) => t.regex.test(tag));
    const want = t.value.charAt(0) === '#' ? t.value : `#${t.value}`;
    return tags.some((tag) => tag === want || tag.startsWith(`${want}/`));
  }
  if (t.op === 'property') {
    const props = item.props || {};
    const key = Object.keys(props).find((k) => k.toLowerCase() === t.key);
    if (key === undefined) return false;
    if (t.value === null) return true;
    return propValues(props[key]).some((v) => v.toLowerCase().includes(t.value));
  }
  return false;
}

/**
 * What's being typed where the caret is, as the search box's suggestions
 * need it: 'options' (nothing yet, or just after a space: the operators),
 * a value for path:, file: or tag:, or a property's name after [ — with
 * where that value starts and what of it there is so far — or null.
 */
export function queryTokenAt(before) {
  if (!before || /\s$/.test(before)) return { kind: 'options', start: before ? before.length : 0, partial: '' };
  const op = /(?:^|[\s(-])(path|file|tag):("?)([^"]*)$/i.exec(before);
  if (op && (op[2] || !/\s/.test(op[3]))) return { kind: op[1].toLowerCase(), start: before.length - op[2].length - op[3].length, partial: op[3] };
  const prop = /\[([^\]:]*)$/.exec(before);
  if (prop) return { kind: 'property', start: before.length - prop[1].length, partial: prop[1] };
  return null;
}

/** A value as the search reads it: in quotes when it has a space in it. */
export function queryValue(value) {
  return /[\s()]/.test(value) ? `"${value}"` : value;
}
