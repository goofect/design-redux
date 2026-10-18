/* ------------------------------------------------------------------ */
/* Tree: a map of part of the vault                                    */
/*                                                                    */
/* A folder or a tag as a map: what stands for it at the root, its      */
/* notes as links under it, its folders (or narrower tags) as branches, */
/* and the links between the notes mapped as relations — one for a pair */
/* of notes, however many ways they link. Pure: given what to map.      */
/* ------------------------------------------------------------------ */

import { newId, treeModel } from './400-tree-model.js';

/* A map never passes this many nodes, or relations: it was likely the wrong folder. */
export const VAULT_MAP_LIMIT = 200;
export const VAULT_MAP_LINKS = 300;

/** How many nodes some items make. */
export function vaultItemCount(items) {
  return items.reduce((n, it) => n + 1 + vaultItemCount(it.children || []), 0);
}

/**
 * The map: `title` at the root, `items` as [{ text, path?, children }] —
 * a note has its path — and `links` as [from, to] paths, each pair of
 * notes mapped related once, read from the first linking to the second.
 */
export function vaultMapModel(title, items, links) {
  const model = treeModel(title);
  const byPath = new Map();
  const make = (it, parent) => {
    const n = { id: newId(), text: it.text, attrs: {}, anchor: false, children: [], parent };
    if (it.path) byPath.set(it.path, n);
    n.children = (it.children || []).map((c) => make(c, n));
    return n;
  };
  model.root.children = items.map((it) => make(it, model.root));
  const seen = new Set();
  (links || []).forEach(([from, to]) => {
    const a = byPath.get(from);
    const b = byPath.get(to);
    if (!a || !b || a === b || model.relations.length >= VAULT_MAP_LINKS) return;
    const pair = [from, to].sort().join('\n');
    if (seen.has(pair)) return;
    seen.add(pair);
    a.anchor = true;
    b.anchor = true;
    model.relations.push({ from: a.id, to: b.id, label: '', attrs: {} });
  });
  return model;
}
