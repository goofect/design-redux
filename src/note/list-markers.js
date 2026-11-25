/* ------------------------------------------------------------------ */
/* List markers written as text: letters, numerals, outline numbers   */
/*                                                                     */
/* What a marker is, and the items around a line, so an older note's   */
/* markers written as text are drawn as lists; and the counting of     */
/* letters and numerals a note's numbering labels with.                */
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
    if (d < deep) return { sibling: null, parent: m ? m[2].replace(/[.)]$/, '') : null };
    if (d === deep) {
      if (!m) return { sibling: null, parent: null };
      return { sibling: m[2].replace(/[.)]$/, ''), parent: null, siblingAt: i };
    }
  }
  return { sibling: null, parent: null };
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
