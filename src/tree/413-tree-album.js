/* ------------------------------------------------------------------ */
/* Tree: a collection by its notes' parents                            */
/*                                                                    */
/* A collection's notes as a tree by the parent property they use —    */
/* the graph's routes read the same one, the same way — with the other */
/* parents as cross-links and loops broken. Pure: given the notes and  */
/* what each names as its parent.                                      */
/* ------------------------------------------------------------------ */

import { newId } from './400-tree-model.js';

/**
 * An album's notes as a tree by their parent property: what each hangs
 * from (the root for none), the other parents as cross-links, cycles
 * broken at the first repeat, parents naming no note, and notes outside
 * the album named as parents. notes: [path], in the album's order;
 * parentsOf(path) → { found: [path], missing: [name] }; root: a path or ''.
 */
export function albumParentTree(notes, parentsOf, root) {
  const inAlbum = new Set(notes);
  const parent = new Map();
  const cross = [];
  const cycles = [];
  const missing = [];
  const outside = [];
  const keepOutside = (p) => {
    if (!inAlbum.has(p) && p !== root && outside.indexOf(p) === -1) outside.push(p);
  };
  notes.forEach((n) => {
    const got = parentsOf(n) || { found: [], missing: [] };
    const found = (got.found || []).filter((p) => p !== n);
    if (!found.length) {
      parent.set(n, root);
      if (got.missing && got.missing.length) missing.push({ note: n, name: got.missing[0] });
      return;
    }
    const first = found[0];
    found.slice(1).forEach((p) => {
      keepOutside(p);
      cross.push([p, n]);
    });
    if (!inAlbum.has(first) && first !== root) {
      keepOutside(first);
      parent.set(n, first);
      return;
    }
    // Would hanging it here close a loop? Then that arrow's a cross-link, and it hangs from the root.
    let up = first;
    const passed = new Set();
    let loops = false;
    while (up && up !== root && !passed.has(up)) {
      if (up === n) {
        loops = true;
        break;
      }
      passed.add(up);
      up = parent.get(up);
    }
    if (loops) {
      cycles.push([n, first]);
      cross.push([first, n]);
      parent.set(n, root);
    } else {
      parent.set(n, first);
    }
  });
  outside.forEach((o) => parent.set(o, root));
  return { parent, cross, cycles, missing, outside };
}

/**
 * What a map must do to follow its collection's notes, as ops: a node
 * for a note new to it, under its parent's node; a node moved where its
 * note's parent says — counting from the nearest node above it that's a
 * note, so nodes of your own between stay; a node whose note has gone
 * taken off, what hangs from it kept; a cross-link for each other
 * parent. A note whose node was taken off by hand since the map last
 * looked is left out, not put back. `pathOf(node)` names a node's note;
 * `linkOf(path)` writes a link to one; `shown` the notes the map showed;
 * `leftOut` those left out. { ops, leftOut, newIds }.
 */
export function albumSyncOps(model, tree, pathOf, linkOf, shown, leftOut) {
  const ops = [];
  const byPath = new Map();
  const nodes = [];
  const walkAll = (n, depth) => {
    nodes.push({ n, depth });
    n.children.forEach((c) => walkAll(c, depth + 1));
  };
  model.root.children.forEach((c) => walkAll(c, 1));
  nodes.forEach(({ n }) => {
    const p = pathOf(n);
    if (p && !byPath.has(p)) byPath.set(p, n);
  });
  const out = new Set(leftOut || []);
  // Taken off by hand since the map last looked: left out from now on.
  (shown ? Array.from(shown) : []).forEach((p) => {
    if (!byPath.has(p) && tree.parent.has(p)) out.add(p);
  });
  // A node back on the map by hand is no longer left out.
  byPath.forEach((n, p) => out.delete(p));
  // Notes gone from the collection: their nodes off, deepest first, what hangs from each moved up in its place.
  const parentOf = new Map();
  nodes.forEach(({ n }) => parentOf.set(n.id, n.parent));
  nodes
    .filter(({ n }) => {
      const p = pathOf(n);
      return p && byPath.get(p) === n && !tree.parent.has(p);
    })
    .sort((a, b) => b.depth - a.depth)
    .forEach(({ n }) => {
      const up = parentOf.get(n.id) || model.root;
      const at = up.children.indexOf(n);
      n.children.slice().forEach((c, k) => {
        ops.push({ type: 'move', id: c.id, parentId: up.id, index: at + 1 + k });
        parentOf.set(c.id, up);
      });
      ops.push({ type: 'remove', id: n.id });
      byPath.delete(pathOf(n));
    });
  // New notes, parents before children.
  const depthOf = (p) => {
    let d = 0;
    for (let up = tree.parent.get(p), seen = 0; up && seen < 1000; up = tree.parent.get(up), seen++) d++;
    return d;
  };
  const newIds = new Map();
  const idFor = (p) => (byPath.has(p) ? byPath.get(p).id : newIds.get(p) || null);
  Array.from(tree.parent.keys())
    .filter((p) => !byPath.has(p) && !out.has(p))
    .sort((a, b) => depthOf(a) - depthOf(b))
    .forEach((p) => {
      const up = tree.parent.get(p);
      const parentId = (up && idFor(up)) || model.root.id;
      const node = { id: newId(), text: linkOf(p), attrs: {}, anchor: false, children: [] };
      newIds.set(p, node.id);
      ops.push({ type: 'insert', parentId, index: 1e9, node });
    });
  // Nodes whose note's parent changed: moved under the parent's node.
  byPath.forEach((n, p) => {
    if (!tree.parent.has(p)) return;
    const up = tree.parent.get(p);
    const want = (up && idFor(up)) || model.root.id;
    let actual = parentOf.get(n.id) || model.root;
    while (actual !== model.root && !pathOf(actual)) actual = parentOf.get(actual.id) || model.root;
    if (actual.id === want) return;
    // Not into its own branch.
    const wanted = nodes.find((x) => x.n.id === want);
    for (let q = wanted ? wanted.n : null; q; q = q.parent) if (q === n) return;
    ops.push({ type: 'move', id: n.id, parentId: want, index: 1e9 });
  });
  // The other parents, as relations.
  (tree.cross || []).forEach(([a, b]) => {
    const from = idFor(a);
    const to = idFor(b);
    if (!from || !to || (model.relations || []).some((r) => r.from === from && r.to === to)) return;
    [a, b].forEach((p) => {
      const n = byPath.get(p);
      const made = ops.find((o) => o.type === 'insert' && o.node.id === newIds.get(p));
      if (made) made.node.anchor = true;
      else if (n && !n.anchor && !ops.some((o) => o.type === 'anchor' && o.id === n.id)) ops.push({ type: 'anchor', id: n.id, on: true });
    });
    ops.push({ type: 'relation-add', relation: { from, to, label: '', attrs: { style: 'dashed' } } });
  });
  return { ops, leftOut: Array.from(out), newIds };
}
