/* ------------------------------------------------------------------ */
/* Text: counting, ordering and naming                                 */
/* ------------------------------------------------------------------ */

/** A note's body without its frontmatter. */
export function bodyOf(text) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text || '');
  return fm ? text.slice(fm[0].length) : text || '';
}

/** How many words a note's text holds. */
export function countWords(text) {
  const words = bodyOf(text).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

/** Minutes to read so many words, at 250 a minute; never less than one. */
export const readingMinutes = (words) => Math.max(1, Math.round(words / 250));

/** A note's length as a bar's height in units: 1 up to 300 words, then one more each time the length doubles, to 5. */
export function barSize(words) {
  if (!(words > 300)) return 1;
  return Math.max(1, Math.min(5, Math.ceil(Math.log2(words / 150))));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Names in the order a person expects: "Week 2" before "Week 10". */
export const byName = (a, b) => collator.compare(a, b);

/** A count with its word: "1 note", "24 notes". */
export const counted = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/** A list written in a setting ("type, domain, status") as its trimmed parts. */
export const listOf = (text) => String(text || '').split(',').map((s) => s.trim()).filter(Boolean);

/** A two-digit number for a row: 01, 02, … 100. */
export const rowNumber = (n) => String(n).padStart(2, '0');
