/* ------------------------------------------------------------------ */
/* Property history                                                    */
/*                                                                    */
/* What a write through the notes service changed in a note's         */
/* properties — each key, before and after — kept by the note's path, */
/* the last so many a note, so one value can be looked back on and    */
/* put back. Pure.                                                     */
/* ------------------------------------------------------------------ */

/* Values compared by what they hold. */
function same(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b) && (a === undefined) === (b === undefined);
}

/** What changed between two sets of properties: { key: [before, after] }, a key gone or new with undefined on its other side. */
export function diffProps(before, after) {
  const out = {};
  new Set(Object.keys(before || {}).concat(Object.keys(after || {}))).forEach((k) => {
    if (k === 'position') return;
    const a = (before || {})[k];
    const b = (after || {})[k];
    if (!same(a, b)) out[k] = [a === undefined ? null : a, b === undefined ? null : b, a === undefined ? 'added' : b === undefined ? 'removed' : 'changed'];
  });
  return out;
}

/** The history with one more entry for a note — { at, changes } — the oldest let go past `limit`. Nothing changed, nothing kept. */
export function withEntry(history, path, entry, limit) {
  if (!entry || !Object.keys(entry.changes || {}).length || !(limit > 0)) return history || {};
  const next = Object.assign({}, history || {});
  const list = (next[path] || []).concat([entry]);
  next[path] = list.slice(Math.max(0, list.length - limit));
  return next;
}

/** A note's history, newest first: [{ at, key, before, after, how }], a line for each key changed. */
export function historyOf(history, path) {
  const out = [];
  ((history || {})[path] || [])
    .slice()
    .reverse()
    .forEach((entry) =>
      Object.keys(entry.changes || {}).forEach((key) => {
        const [before, after, how] = entry.changes[key];
        out.push({ at: entry.at, key, before, after, how: how || 'changed' });
      })
    );
  return out;
}
