/* ------------------------------------------------------------------ */
/* Lettered and roman numeral lists                                    */
/*                                                                     */
/* Markdown numbers lists 1., 2., 3. and nothing else, so a list       */
/* written a., b., c. or i., ii., iii. is plain paragraphs to          */
/* Obsidian. This makes it a list in the three places one shows:       */
/* drawn as one in reading view, styled as one in the editor, and      */
/* continued with the next letter or numeral when Enter is pressed.    */
/* The note's text is never changed — what you wrote is what's shown,  */
/* and any other markdown app reads the same file.                     */
/*                                                                     */
/* Some letters are numerals too — i, v, x, l, c, d, m — so what one   */
/* is depends on the item before it: "i" after "h" is the ninth        */
/* letter, and on its own it's the numeral one. Every item is read     */
/* against the one above it for that reason.                           */
/*                                                                     */
/* Here, how a marker is read; the editor's part is 271, reading       */
/* view's 272, and the feature that puts them on 273.                  */
/* ------------------------------------------------------------------ */

export const ROMAN_DIGITS = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

export const ROMAN_VALUES = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** Which kinds are recognised; the feature sets these from settings. */
export const LIST_KINDS = { roman: true, alpha: true };

/*
 * "a." "a)" or "(a)" — letters in one case, at the start of a line
 * after any indentation, then at least one space. The same shapes legal
 * and academic writing number with.
 */
export const LIST_ITEM = /^([ \t]*)(?:\(([a-z]+|[A-Z]+)\)|([a-z]+|[A-Z]+)([.)]))([ \t]+)/;

/** The opening or closing line of a fenced code block or a maths block. */
export const LIST_FENCE = /^[ \t]*(```|~~~|\$\$)/;

/** A cheap test, run before anything that costs more. */
export const LIST_HINT = /^[ \t]*(?:\([a-zA-Z]{1,15}\)|[a-zA-Z]{1,15}[.)])[ \t]/;

export function toRoman(n) {
  let out = '';
  let rest = n;
  ROMAN_DIGITS.forEach(([value, digits]) => {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  });
  return out;
}

/**
 * A numeral's value, or 0 for anything not written the standard way —
 * "iiii", "vx" and "Iv" aren't numerals, and letting them through would
 * turn ordinary words at the start of a line into list items.
 */
export function fromRoman(numeral) {
  if (!numeral || numeral.length > 15) return 0;
  const lower = numeral.toLowerCase();
  if (numeral !== lower && numeral !== numeral.toUpperCase()) return 0;
  let total = 0;
  for (let i = 0; i < lower.length; i++) {
    const here = ROMAN_VALUES[lower[i]];
    const next = ROMAN_VALUES[lower[i + 1]] || 0;
    if (!here) return 0;
    total += here < next ? -here : here;
  }
  if (total < 1 || total > 3999) return 0;
  return toRoman(total) === lower ? total : 0;
}

/** a–z, then aa, ab… as a spreadsheet's columns run. */
export function toAlpha(n) {
  let out = '';
  let rest = n;
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

export function fromAlpha(letters) {
  if (!letters || letters.length > 3) return 0;
  const lower = letters.toLowerCase();
  if (letters !== lower && letters !== letters.toUpperCase()) return 0;
  let total = 0;
  for (const ch of lower) {
    const code = ch.charCodeAt(0) - 96;
    if (code < 1 || code > 26) return 0;
    total = total * 26 + code;
  }
  return total;
}

/**
 * A line as a list item — { indent, kind, value, upper, style, marker,
 * prefix, content } — or null. `prev` is the item before it at the same
 * indent, as an item, null, or a function returning one; it's only
 * asked for when the line can't be read on its own.
 *
 * On its own, a line is an item only where lists start: at "a", or at
 * a numeral under 40 — so "i." is the numeral one. Anything else has to
 * follow the item before it, in the same style: "b" after "a", "i"
 * after "h", "xl" after "xxxix". That keeps words and names out — "etc."
 * "vs." "mix." "p. 12" and "J. Smith" don't follow anything — and a
 * single letter followed by another initial, "I. M. Pei" or
 * "A. B. Smith", is a name wherever it is.
 */
export function parseListItem(text, prev) {
  const m = LIST_ITEM.exec(text);
  if (!m) return null;
  const token = m[2] || m[3];
  const content = text.slice(m[0].length);
  if (token.length === 1 && /^[A-Z]\.(\s|$)/.test(content)) return null;

  const roman = LIST_KINDS.roman ? fromRoman(token) : 0;
  const alpha = LIST_KINDS.alpha ? fromAlpha(token) : 0;
  if (!roman && !alpha) return null;

  const upper = token !== token.toLowerCase();
  const style = m[2] ? 'wrap' : m[4] === ')' ? 'paren' : 'dot';
  const make = (kind, value) => ({
    indent: m[1],
    kind: kind,
    value: value,
    upper: upper,
    style: style,
    marker: m[2] ? `(${token})` : token + m[4],
    prefix: m[0].length,
    content: content,
  });

  if (alpha === 1) return make('alpha', 1);
  if (roman && roman < 40 && token.length > 1) return make('roman', roman);

  const before = typeof prev === 'function' ? prev() : prev;
  if (before && before.upper === upper && before.style === style) {
    if (before.kind === 'alpha' && alpha === before.value + 1) return make('alpha', alpha);
    if (before.kind === 'roman' && roman === before.value + 1) return make('roman', roman);
  }
  if (roman && roman < 40) return make('roman', roman);
  return null;
}

/** The marker for a value, written the way `like` was. */
export function listMarker(value, like) {
  let token = like.kind === 'alpha' ? toAlpha(value) : toRoman(value);
  if (like.upper) token = token.toUpperCase();
  if (like.style === 'wrap') return `(${token})`;
  return token + (like.style === 'paren' ? ')' : '.');
}

/** Whether two items belong to one list: same kind, case and punctuation. */
export function sameListStyle(a, b) {
  return a.kind === b.kind && a.upper === b.upper && a.style === b.style;
}

/** The largest value a kind can be continued to. */
export function listLimit(kind) {
  return kind === 'alpha' ? 18278 : 3999;
}

export function leadingSpace(text) {
  return /^[ \t]*/.exec(text)[0];
}

/**
 * The item before a line, at its indent. The list is walked up to where
 * it starts and read back down, since what a letter is depends on what
 * came before it. Blank lines and deeper lines are passed over, and so
 * is text straight after an item, which continues it; the walk stops at
 * two blank lines, less indentation, or a paragraph that isn't part of
 * the list. `known` holds lines already read, by number.
 *
 * `doc` needs only line(n).text, numbered from 1 — an editor's document,
 * or a note's source seen from reading view.
 */
export function listItemAbove(doc, lineNo, indent, known) {
  const run = [];
  let base = null;
  let blank = 0;
  let loose = false;
  for (let n = lineNo - 1; n >= 1 && n >= lineNo - 2000; n--) {
    const text = doc.line(n).text;
    if (!text.trim()) {
      // Plain text with a gap below and nothing above: a paragraph.
      if (loose) break;
      blank++;
      if (blank > 1) break;
      continue;
    }
    if (LIST_FENCE.test(text)) break;
    const own = leadingSpace(text);
    if (own.length > indent.length) {
      blank = 0;
      continue;
    }
    if (own === indent && LIST_ITEM.test(text)) {
      blank = 0;
      loose = false;
      const hit = known && known.has(n) ? known.get(n) : undefined;
      if (hit) {
        base = hit;
        break;
      }
      // Read already, and not an item: nothing to learn from it.
      if (hit === null) continue;
      run.push(text);
      continue;
    }
    if (own.length < indent.length) break;
    loose = true;
    blank = 0;
  }
  // A line shaped like an item that isn't one ("etc. and so on" under
  // an item) continues the item above rather than ending the list.
  let prev = base;
  for (let k = run.length - 1; k >= 0; k--) prev = parseListItem(run[k], prev) || prev;
  return prev;
}
