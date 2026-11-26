/* ------------------------------------------------------------------ */
/* List markers: letters, roman numerals and outline numbers          */
/*                                                                     */
/* What a marker is, which comes next, and the items around a line,    */
/* for the lists feature and its part in the editor.                   */
/* ------------------------------------------------------------------ */

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

/** 1 → i, 4 → iv, 14 → xiv. */
export function toRoman(n) {
  let out = '';
  ROMAN.forEach(([value, mark]) => { while (n >= value) { out += mark; n -= value; } });
  return out;
}

/** i → 1, xiv → 14; 0 for what is not a numeral as it would be written. */
export function fromRoman(text) {
  const s = String(text).toLowerCase();
  let n = 0;
  let at = 0;
  ROMAN.forEach(([value, mark]) => { while (s.startsWith(mark, at)) { n += value; at += mark.length; } });
  return at === s.length && n > 0 && toRoman(n) === s ? n : 0;
}

/** 1 → a, 26 → z, 27 → aa. */
export function toLetters(n) {
  let out = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(97 + ((n - 1) % 26)) + out;
  return out;
}

export function fromLetters(text) {
  return /^[a-z]+$/.test(text) ? Array.from(text).reduce((n, c) => n * 26 + (c.charCodeAt(0) - 96), 0) : 0;
}

// An item: a letter or numeral and its stop ("a.", "iv)"), or an outline number ("1.1.", "2.3.1"), its stop if it has one.
export const LIST_ITEM = /^([ \t]*)([a-z]+(?=[.)])|\d+(?:\.\d+)+)([.)]?)([ \t]+)(.*)$/i;
// Any item one of these can sit beside or under: a dash, a number, an outline number, a letter or numeral.
const ANY_ITEM = /^([ \t]*)([-*+]|\d+(?:\.\d+)+[.)]?|\d+[.)]|[a-z]+[.)])[ \t]/i;
const OUTLINE = /^\d+(?:\.\d+)+$/;

/**
 * Whether outline number `marker` comes straight after `before` (an outline
 * number or a plain one): 1 → 1.1, 1.1 → 1.2, 1.1.2 → 1.2.
 */
export function followsInOutline(before, marker) {
  const b = String(before).split('.').map(Number);
  const m = String(marker).split('.').map(Number);
  if (b.some(Number.isNaN) || m.some(Number.isNaN) || m.length > b.length + 1) return false;
  if (m.length === b.length + 1) return b.every((x, i) => x === m[i]) && m[m.length - 1] === 1;
  return m.slice(0, -1).every((x, i) => x === b[i]) && m[m.length - 1] === b[m.length - 1] + 1;
}

/** How deep a line's indent is, a tab as four spaces. */
export const depth = (ws) => ws.replace(/\t/g, '    ').length;

/**
 * The items around line `at` for an item `deep` in: `sibling`, the marker of
 * the nearest item above at that depth; `parent`, of the nearest shallower one.
 */
export function around(editor, at, deep) {
  for (let i = at - 1; i >= 0; i--) {
    const line = editor.getLine(i);
    if (!line.trim()) continue;
    const m = ANY_ITEM.exec(line);
    const d = depth(/^[ \t]*/.exec(line)[0]);
    // An indented line of words is more of an item above it (its summary, its paragraph): read on past it. Words at the margin end the list.
    if (!m && d > 0 && d <= deep) continue;
    if (d < deep) return { sibling: null, parent: m ? m[2].replace(/[.)]$/, '') : null };
    if (d === deep) {
      if (!m) return { sibling: null, parent: null };
      return { sibling: m[2].replace(/[.)]$/, ''), parent: null, siblingAt: i };
    }
  }
  return { sibling: null, parent: null };
}

/**
 * How a marker is read. Some letters are numerals too (i, v, x…), so what
 * one is depends on the item before it: "i" after "h" is the ninth letter.
 * `before` is the marker of the item above, if there is one.
 */
export function readMarker(marker, before) {
  if (/^\d+$/.test(marker)) return { kind: 'number', n: Number(marker), upper: false };
  if (OUTLINE.test(marker)) {
    const parts = marker.split('.').map(Number);
    return { kind: 'outline', n: parts[parts.length - 1], parts, upper: false };
  }
  if (/^[-*+]$/.test(marker)) return { kind: 'bullet', n: 0, upper: false };
  const m = marker.toLowerCase();
  const roman = fromRoman(m);
  if (before) {
    const b = readMarker(before);
    if (b.kind === 'letter' && fromLetters(m) === b.n + 1) return { kind: 'letter', n: fromLetters(m), upper: marker !== m };
    if (b.kind === 'roman' && roman === b.n + 1) return { kind: 'roman', n: roman, upper: marker !== m };
  }
  if (roman && (m.length > 1 || m === 'i')) return { kind: 'roman', n: roman, upper: marker !== m };
  return { kind: 'letter', n: fromLetters(m), upper: marker !== m };
}

/** The marker that follows one. */
export function nextMarker(marker, before) {
  const r = readMarker(marker, before);
  if (r.kind === 'number') return String(r.n + 1);
  if (r.kind === 'outline') return r.parts.slice(0, -1).concat(r.n + 1).join('.');
  if (r.kind === 'bullet') return marker;
  const next = r.kind === 'roman' ? toRoman(r.n + 1) : toLetters(r.n + 1);
  return r.upper ? next.toUpperCase() : next;
}

/**
 * Whether a word before a full stop is a marker: one letter, a numeral, or
 * the letters after the item above (z, aa). "Mr. Smith" is no item. An
 * outline number is one with its stop ("1.1."); without one ("1.1") only
 * where it follows the item beside it or, with none, the one it is under,
 * so "3.5 million" is no item.
 */
export function isMarker(marker, sibling, stop = '.', parent = null) {
  if (OUTLINE.test(marker)) return !!stop || (sibling ? followsInOutline(sibling, marker) : !!parent && followsInOutline(parent, marker));
  if (marker.length === 1 || fromRoman(marker)) return true;
  const before = sibling && /^[a-z]+$/i.test(sibling) ? fromLetters(sibling.toLowerCase()) : 0;
  return !!before && fromLetters(marker.toLowerCase()) === before + 1;
}

// An item as renumbering reads it: a plain number, an outline number or a letter or numeral, and its stop.
const ENTRY = /^([ \t]*)(\d+(?:\.\d+)*|[a-z]+)([.)]?)[ \t]/i;

/**
 * Whether a blank line at `i` is inside a list: what comes after it, past
 * blank lines, is indented (more of an item, or an item under one), as in
 * a list whose items are parted by blank lines.
 */
function blankWithin(lineOf, count, i) {
  for (let k = i + 1; k < count; k++) {
    const line = lineOf(k);
    if (line.trim()) return /^[ \t]/.test(line);
  }
  return false;
}

export function entryOf(line) {
  const m = ENTRY.exec(line);
  if (!m) return null;
  const [, indent, marker, stop] = m;
  const kind = /^\d+$/.test(marker) ? 'number' : OUTLINE.test(marker) ? 'outline' : 'letter';
  if (!stop && kind !== 'outline') return null;
  return { indent, marker, stop, kind, at: indent.length, end: indent.length + marker.length };
}

/** An outline counted on from line `at`: each item one after the item before it at its level, its number under its parent's. */
function renumberOutline(lineOf, count, at, first) {
  const changes = [];
  let cur = first.marker.split('.').map(Number);
  let written = first.marker;
  for (let i = at + 1; i < count; i++) {
    const line = lineOf(i);
    if (!line.trim()) {
      if (blankWithin(lineOf, count, i)) continue;
      break;
    }
    const e = entryOf(line);
    // A line with no number is more of the item above where it is indented (words, a lettered list under it), the list's end where it isn't.
    if (!e || e.kind === 'letter') {
      if (/^[ \t]/.test(line)) continue;
      break;
    }
    if (e.kind === 'outline' && !e.stop && !followsInOutline(written, e.marker)) break;
    written = e.marker;
    const parts = e.marker.split('.').map(Number);
    const k = parts.length;
    const next = k <= cur.length ? cur.slice(0, k - 1).concat(cur[k - 1] + 1) : k === cur.length + 1 ? cur.concat(1) : parts;
    const text = next.join('.');
    if (text !== e.marker) changes.push({ line: i, from: e.at, to: e.end, text });
    cur = next;
  }
  return changes;
}

/** Letters or numerals counted on from line `at`, among the items at its indent; those deeper are left as they are. */
function renumberLetters(lineOf, count, at, first) {
  const changes = [];
  const d = depth(first.indent);
  let prev = first.marker;
  let before = around({ getLine: lineOf }, at, d).sibling;
  let written = first.marker;
  for (let i = at + 1; i < count; i++) {
    const line = lineOf(i);
    if (!line.trim()) {
      if (blankWithin(lineOf, count, i)) continue;
      break;
    }
    const deep = depth(/^[ \t]*/.exec(line)[0]);
    if (deep > d) continue;
    if (deep < d) break;
    const e = entryOf(line);
    if (!e || e.kind !== 'letter' || !isMarker(e.marker, written)) break;
    written = e.marker;
    const next = nextMarker(prev, before);
    if (next !== e.marker) changes.push({ line: i, from: e.at, to: e.end, text: next });
    before = prev;
    prev = next;
  }
  return changes;
}

/**
 * The markers after line `at` written again so its list counts on from it,
 * as Obsidian numbers its own lists again when an item comes in or moves:
 * [{ line, from, to, text }]. `lineOf(i)` gives a line, `count` how many.
 */
export function renumber(lineOf, count, at) {
  const first = entryOf(lineOf(at));
  if (!first) return [];
  return first.kind === 'letter' ? renumberLetters(lineOf, count, at, first) : renumberOutline(lineOf, count, at, first);
}

/**
 * Widths of text in a font, for a hanging indent: a canvas measures
 * without touching the page; where there is none, an estimate.
 */
export function measurer(doc, font, size) {
  let ctx = null;
  try {
    ctx = doc.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = font;
  } catch (err) {
    ctx = null;
  }
  const known = new Map();
  return (text) => {
    if (!known.has(text)) known.set(text, Math.round((ctx ? ctx.measureText(text).width : text.length * size * 0.5) * 10) / 10);
    return known.get(text);
  };
}
