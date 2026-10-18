/* ------------------------------------------------------------------ */
/* Tree: comparing maps                                                */
/*                                                                    */
/* A map against how it was, or against another: the nodes new, gone, */
/* reworded and moved to hang from something else — a node matched by  */
/* its id, or else by its title — and how many relations came and went.*/
/* And two branches of one map: what's only in each, and in both.      */
/* ------------------------------------------------------------------ */

import { walk } from './400-tree-model.js';

const compareTitle = (n) => String((n && n.text) || '').split('\n')[0].trim();
const compareKey = (n) => compareTitle(n).toLowerCase();

function compareNodes(model) {
  const out = [];
  walk(model, (n) => out.push(n));
  return out;
}

/**
 * How a map differs from how it was: { added, removed, reworded, moved,
 * relations: { added, removed } }. Nodes are { id, label }; a reworded one
 * also has `was`, its old title; a moved one `was`, where it hung.
 */
export function compareMaps(now, then) {
  const nowNodes = compareNodes(now);
  const thenNodes = compareNodes(then);
  const thenById = new Map(thenNodes.map((n) => [n.id, n]));
  const nowIds = new Set(nowNodes.map((n) => n.id));
  // Matched by id, or else — a node made again, say — by its title, once.
  const match = new Map();
  const taken = new Set();
  nowNodes.forEach((n) => {
    if (thenById.has(n.id)) {
      match.set(n.id, thenById.get(n.id));
      taken.add(n.id);
    }
  });
  nowNodes.forEach((n) => {
    if (match.has(n.id)) return;
    const twin = thenNodes.find((t) => !taken.has(t.id) && !nowIds.has(t.id) && compareKey(t) && compareKey(t) === compareKey(n));
    if (twin) {
      match.set(n.id, twin);
      taken.add(twin.id);
    }
  });
  const label = (n) => compareTitle(n) || 'Untitled';
  const added = nowNodes.filter((n) => !match.has(n.id)).map((n) => ({ id: n.id, label: label(n) }));
  const removed = thenNodes.filter((t) => !taken.has(t.id)).map((t) => ({ id: t.id, label: label(t) }));
  const reworded = [];
  const moved = [];
  // Where a node hung, as matched: the id its parent had then, in the map now.
  const nowIdOf = new Map();
  match.forEach((t, id) => nowIdOf.set(t.id, id));
  nowNodes.forEach((n) => {
    const t = match.get(n.id);
    if (!t) return;
    if (compareTitle(n) !== compareTitle(t)) reworded.push({ id: n.id, label: label(n), was: label(t) });
    const parentNow = n.parent ? n.parent.id : null;
    const parentThen = t.parent ? nowIdOf.get(t.parent.id) || `then:${t.parent.id}` : null;
    if (parentNow !== parentThen) moved.push({ id: n.id, label: label(n), was: t.parent ? `hung from “${label(t.parent)}”` : 'stood alone' });
  });
  const relKey = (r, ids) => `${ids(r.from)}→${ids(r.to)}|${r.label || ''}`;
  const nowRel = new Set((now.relations || []).map((r) => relKey(r, (x) => x)));
  const thenRel = new Set((then.relations || []).map((r) => relKey(r, (x) => nowIdOf.get(x) || `then:${x}`)));
  const relations = { added: Array.from(nowRel).filter((k) => !thenRel.has(k)).length, removed: Array.from(thenRel).filter((k) => !nowRel.has(k)).length };
  return { added, removed, reworded, moved, relations };
}

/** Two branches of a map, by title: { onlyA, onlyB, both } — nodes of each, `both` as they are in the first. */
export function compareMapBranches(model, aId, bId) {
  const below = (id) => {
    const out = [];
    walk(model, (n) => {
      if (n.id !== id) return;
      const go = (x) => x.children.forEach((c) => (out.push(c), go(c)));
      go(n);
    });
    return out;
  };
  const a = below(aId);
  const b = below(bId);
  const bKeys = new Set(b.map(compareKey));
  const aKeys = new Set(a.map(compareKey));
  const brief = (n) => ({ id: n.id, label: compareTitle(n) || 'Untitled' });
  return { onlyA: a.filter((n) => !bKeys.has(compareKey(n))).map(brief), onlyB: b.filter((n) => !aKeys.has(compareKey(n))).map(brief), both: a.filter((n) => bKeys.has(compareKey(n))).map(brief) };
}
