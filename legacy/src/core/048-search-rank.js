/* ------------------------------------------------------------------ */
/* Search: how well a note matches                                     */
/*                                                                     */
/* A query's words against a note's title, aliases, properties and     */
/* album: a score, so the note named for what you typed comes first,   */
/* and a few words on why it matched. Pure: given the note's parts,    */
/* not the vault.                                                      */
/* ------------------------------------------------------------------ */

/** A query's words, lower case. */
export function searchWords(q) {
  return String(q || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

const hasAll = (text, words) => words.every((w) => text.indexOf(w) !== -1);

/** Whether the letters of `q` come in order in `text`, close together: a misspelt or shortened title. */
export function nearly(text, q) {
  if (q.length < 3 || q.indexOf(' ') !== -1) return false;
  let at = -1;
  let first = -1;
  for (let i = 0; i < q.length; i++) {
    at = text.indexOf(q[i], at + 1);
    if (at === -1) return false;
    if (first === -1) first = at;
  }
  return at - first < q.length * 2;
}

const flat = (v) => (Array.isArray(v) ? v.map(flat).join(', ') : v === null || v === undefined ? '' : String(v));

/**
 * How well a note matches: { score, why }, or null for no match.
 * parts: { title, props: { key: value }, album } — album the folder's path.
 */
export function rankNote(parts, query) {
  const q = String(query || '').trim().toLowerCase();
  const words = searchWords(q);
  if (!words.length) return null;
  const title = String(parts.title || '').toLowerCase();
  const album = parts.album || '';

  if (title === q) return { score: 100, why: 'Exact title match' };
  const where = album ? ` · ${album}` : '';
  if (title.startsWith(q)) return { score: 85, why: `Title match${where}` };
  if (title.indexOf(q) !== -1) return { score: 75, why: `Title match${where}` };
  if (hasAll(title, words)) return { score: 70, why: `Title match${where}` };

  const props = parts.props || {};
  const keys = Object.keys(props).filter((k) => k !== 'position');
  const alias = keys.find((k) => k.toLowerCase() === 'aliases' || k.toLowerCase() === 'alias');
  if (alias) {
    const list = Array.isArray(props[alias]) ? props[alias] : [props[alias]];
    const hit = list.find((a) => hasAll(flat(a).toLowerCase(), words));
    if (hit) return { score: 72, why: `Alias: ${flat(hit)}` };
  }

  if (nearly(title, q)) return { score: 55, why: `Close to the title${where}` };

  // One property holding every word says more than the words spread across several.
  for (const k of keys) {
    if (k === alias) continue;
    const text = flat(props[k]);
    if (text && hasAll(text.toLowerCase(), words)) {
      const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      return { score: text.toLowerCase() === q ? 60 : 50, why: `Property: ${k} = ${short}` };
    }
  }

  if (album && hasAll(album.toLowerCase(), words)) return { score: 40, why: `In ${album}` };

  const everything = [title, album.toLowerCase()].concat(keys.map((k) => flat(props[k]).toLowerCase())).join(' ');
  if (hasAll(everything, words)) return { score: 30, why: 'Title and properties' };
  return null;
}

/** A note's text without its properties block. */
export function noteBody(text) {
  const t = String(text || '');
  if (!t.startsWith('---')) return t;
  const end = t.indexOf('\n---', 3);
  return end === -1 ? t : t.slice(end + 4);
}

/**
 * Whether a note's text holds every word of the query, and the passage
 * around the first place it does: the whole query where it's there as
 * typed, else its first word. Null for no match.
 */
export function textExcerpt(text, query, width = 110) {
  const words = searchWords(query);
  if (!words.length) return null;
  const flat = noteBody(text).replace(/\s+/g, ' ').trim();
  const low = flat.toLowerCase();
  if (!words.every((w) => low.indexOf(w) !== -1)) return null;
  const q = String(query).trim().toLowerCase();
  let at = low.indexOf(q);
  let len = q.length;
  if (at === -1) {
    at = low.indexOf(words[0]);
    len = words[0].length;
  }
  const side = Math.max(0, Math.floor((width - len) / 2));
  let from = Math.max(0, at - side);
  let to = Math.min(flat.length, at + len + side);
  // Whole words at the edges.
  if (from > 0) {
    const space = flat.indexOf(' ', from);
    if (space !== -1 && space < at) from = space + 1;
  }
  if (to < flat.length) {
    const space = flat.lastIndexOf(' ', to);
    if (space > at + len) to = space;
  }
  return `${from > 0 ? '…' : ''}${flat.slice(from, to)}${to < flat.length ? '…' : ''}`;
}
