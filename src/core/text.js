/* ------------------------------------------------------------------ */
/* Text: counting, ordering and naming                                 */
/* ------------------------------------------------------------------ */

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

/** A change, as small as it can be: what is the same at either end of the old text and the new is left standing. */
function trimmed(from, was, now) {
  let p = 0;
  while (p < was.length && p < now.length && was[p] === now[p]) p++;
  let q = 0;
  while (q < was.length - p && q < now.length - p && was[was.length - 1 - q] === now[now.length - 1 - q]) q++;
  return { from: from + p, to: from + was.length - q, text: now.slice(p, now.length - q) };
}

/**
 * What changes from one text to another, as changes to the first: [{ from,
 * to, text }], offsets into it, in order. Worked out line by line, and in a
 * line only the characters that differ, so an editor given these keeps
 * what stands round them: a folded section stays folded, its line ends
 * untouched. A change too wide to work out line by line is one change.
 */
export function changesBetween(was, now) {
  const split = (t) => t.match(/[^\n]*\n|[^\n]+$/g) || [];
  const a = split(was);
  const b = split(now);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (!n && !m) return [];
  const at = [0];
  a.forEach((line) => at.push(at[at.length - 1] + line.length));
  if (n * m > 1e6) return [trimmed(at[head], a.slice(head, head + n).join(''), b.slice(head, head + m).join(''))];
  // The longest run of lines the two share, by table; the lines between its runs are the changes.
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[head + i] === b[head + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  let open = null;
  const close = () => {
    if (!open) return;
    const [i0, j0] = open;
    open = null;
    // As many lines for as many: each line on its own; else the run as one.
    if (i - i0 === j - j0) for (let k = 0; k < i - i0; k++) out.push(trimmed(at[head + i0 + k], a[head + i0 + k], b[head + j0 + k]));
    else out.push(trimmed(at[head + i0], a.slice(head + i0, head + i).join(''), b.slice(head + j0, head + j).join('')));
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[head + i] === b[head + j]) {
      close();
      i++;
      j++;
    } else {
      open = open || [i, j];
      if (j < m && (i === n || t[i * w + j + 1] >= t[(i + 1) * w + j])) j++;
      else i++;
    }
  }
  close();
  return out;
}
