/* ------------------------------------------------------------------ */
/* List markers: letters and roman numerals read and counted           */
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

export const LIST_ITEM = /^([ \t]*)([a-z]+)([.)])([ \t]+)(.*)$/i;
// Any item a lettered one can sit beside or under: a dash, a number, a letter or numeral.
const ANY_ITEM = /^([ \t]*)([-*+]|\d+[.)]|[a-z]+[.)])[ \t]/i;

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
  if (r.kind === 'bullet') return marker;
  const next = r.kind === 'roman' ? toRoman(r.n + 1) : toLetters(r.n + 1);
  return r.upper ? next.toUpperCase() : next;
}

/** The first marker of a list under an item: a, then i, then a again; under "I" a capital "A". */
export function firstUnder(parent, before) {
  const r = parent ? readMarker(parent, before) : { kind: 'number' };
  if (r.kind === 'letter') return 'i';
  return r.kind === 'roman' && r.upper ? 'A' : 'a';
}

/** Lines made a list of a kind: any marker they had (a dash, a number, a letter) gives way to the new one. */
export function makeList(lines, kind) {
  let n = 0;
  return lines.map((line) => {
    if (!line.trim()) return line;
    const m = /^([ \t]*)(?:[-*+]|\d+[.)]|[a-z]+[.)])?[ \t]*(.*)$/i.exec(line);
    n++;
    return `${m[1]}${kind === 'roman' ? toRoman(n) : toLetters(n)}. ${m[2]}`;
  });
}

/**
 * Whether a word before a full stop is a marker: one letter, a numeral, or
 * the letters after the item above (z, aa). "Mr. Smith" is no item.
 */
export function isMarker(marker, sibling) {
  if (marker.length === 1 || fromRoman(marker)) return true;
  const before = sibling && /^[a-z]+$/i.test(sibling) ? fromLetters(sibling.toLowerCase()) : 0;
  return !!before && fromLetters(marker.toLowerCase()) === before + 1;
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
