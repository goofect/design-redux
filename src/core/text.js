/* ------------------------------------------------------------------ */
/* Text: counting, ordering and naming                                 */
/* ------------------------------------------------------------------ */

/** Minutes to read so many words, at 250 a minute; never less than one. */
export const readingMinutes = (words) => Math.max(1, Math.round(words / 250));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Names in the order a person expects: "Week 2" before "Week 10". */
export const byName = (a, b) => collator.compare(a, b);

/** A count with its word: "1 note", "24 notes". */
export const counted = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/** A list written in a setting ("type, domain, status") as its trimmed parts. */
export const listOf = (text) => String(text || '').split(',').map((s) => s.trim()).filter(Boolean);


/** For a list of notes, each one's folder by name, only where the list mixes folders: where they all share one, it says nothing. */
export function foldersIfMixed(files) {
  const of = (f) => (f && f.parent && f.parent.path !== '/' ? f.parent.name : '');
  const mixed = new Set(files.map(of)).size > 1;
  return files.map((f) => (mixed ? of(f) : ''));
}
