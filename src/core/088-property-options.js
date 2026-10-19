/* ------------------------------------------------------------------ */
/* Property value options                                              */
/*                                                                    */
/* A property's values can each take a colour and an icon, kept by    */
/* property and value — "status: Done" green with a check — and shown  */
/* wherever the value is: the panel's chips, album rows, filters. And  */
/* the values that are one value written differently — "Done", "done " */
/* and "done." — found, to be merged into the one most used. Pure.     */
/* ------------------------------------------------------------------ */

import { plainOf } from './086-property-schema.js';

/* The colours a value can take, as Obsidian names them. */
export const OPTION_COLOURS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];

/** A value's colour and icon: { color, icon }, or null. `options` is { key: { value: { color, icon } } }, both matched whatever their case. */
export function optionFor(options, key, value) {
  if (!options || key === undefined || key === null || value === undefined || value === null) return null;
  const want = String(key).toLowerCase();
  const name = Object.keys(options).find((k) => k.toLowerCase() === want);
  const byValue = name === undefined ? null : options[name];
  if (!byValue) return null;
  if (Object.prototype.hasOwnProperty.call(byValue, String(value))) return byValue[String(value)] || null;
  const plain = plainOf(value);
  const match = Object.keys(byValue).find((v) => plainOf(v) === plain);
  return match === undefined ? null : byValue[match] || null;
}

/** The options with one value's colour and icon set — or, with neither, taken off. */
export function withOption(options, key, value, option) {
  const next = Object.assign({}, options || {});
  const want = String(key).toLowerCase();
  const name = Object.keys(next).find((k) => k.toLowerCase() === want) || key;
  const byValue = Object.assign({}, next[name] || {});
  const color = option && OPTION_COLOURS.includes(option.color) ? option.color : undefined;
  const icon = option && typeof option.icon === 'string' && option.icon.trim() ? option.icon.trim() : undefined;
  if (color || icon) byValue[String(value)] = Object.assign({}, color ? { color } : {}, icon ? { icon } : {});
  else delete byValue[String(value)];
  if (Object.keys(byValue).length) next[name] = byValue;
  else delete next[name];
  return next;
}

/** How many single-letter changes turn one word into another, up to `most` (more than that is most + 1). */
export function editDistance(a, b, most) {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, row[j]);
    }
    if (low > most) return most + 1;
    prev = row;
  }
  return prev[b.length];
}

/* The most values compared with one another for small typos. */
const TYPO_LIMIT = 2000;

/**
 * The values that look like one value written differently: the same
 * once case, spaces, brackets and trailing marks are set aside, or a
 * letter or two apart in a longer word — not numbers, nor dates.
 * `counts` is [[value, notes]]. [{ keep, values: [{ value, count }] }],
 * `keep` the one most used, the largest groups first.
 */
export function nearDuplicates(counts) {
  const list = (counts || []).map(([value, count]) => ({ value: String(value), count: Number(count) || 0, plain: plainOf(value) })).filter((v) => v.value.trim());
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const byPlain = new Map();
  list.forEach((v, i) => {
    if (byPlain.has(v.plain)) join(byPlain.get(v.plain), i);
    else byPlain.set(v.plain, i);
  });
  // Typos: only among words, each plain spelling once.
  // Shortest first, each compared only with those up to two letters longer, and only where their letters nearly match.
  const words = Array.from(byPlain.entries())
    .filter(([p]) => p.length >= 4 && /[a-z]/.test(p) && !/^\d/.test(p))
    .slice(0, TYPO_LIMIT)
    .map(([p, i]) => ({ p, i, digits: (p.match(/\d+/g) || []).join(), letters: letterCounts(p) }))
    .sort((x, y) => x.p.length - y.p.length);
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    for (let j = i + 1; j < words.length && words[j].p.length - a.p.length <= 2; j++) {
      const b = words[j];
      const most = a.p.length >= 8 ? 2 : 1;
      if (b.p.length - a.p.length > most || a.digits !== b.digits || lettersApart(a.letters, b.letters) > most * 2) continue;
      if (editDistance(a.p, b.p, most) <= most) join(a.i, b.i);
    }
  }
  const groups = new Map();
  list.forEach((v, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(v);
  });
  return Array.from(groups.values())
    .filter((g) => g.length > 1)
    .map((g) => {
      const values = g.slice().sort((x, y) => y.count - x.count || x.value.localeCompare(y.value)).map(({ value, count }) => ({ value, count }));
      return { keep: values[0].value, values };
    })
    .sort((x, y) => y.values.length - x.values.length || x.keep.localeCompare(y.keep));
}

/* How often each letter comes in a word: a–z, digits, and the rest together. */
function letterCounts(w) {
  const counts = new Array(37).fill(0);
  for (let k = 0; k < w.length; k++) {
    const c = w.charCodeAt(k);
    counts[c >= 97 && c <= 122 ? c - 97 : c >= 48 && c <= 57 ? c - 22 : 36]++;
  }
  return counts;
}

/* How many letters two words don't share: each change of a letter costs two at most. */
function lettersApart(a, b) {
  let n = 0;
  for (let k = 0; k < 37; k++) n += Math.abs(a[k] - b[k]);
  return n;
}
