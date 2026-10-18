/* ------------------------------------------------------------------ */
/* Tree: the order a map is presented in                               */
/*                                                                    */
/* Depth first from the root — or from one node, its branch — in the   */
/* list's order; a folded branch is one step; free nodes after, each   */
/* with what hangs from it. Each step knows the nodes above it.        */
/* ------------------------------------------------------------------ */

import { nodeById } from './400-tree-model.js';

/** The steps of a presentation: [{ id, ancestors }]. */
export function mapPresentation(model, fromId) {
  const out = [];
  const go = (n, ancestors) => {
    out.push({ id: n.id, ancestors });
    if (!n.attrs.fold) n.children.forEach((c) => go(c, ancestors.concat(n.id)));
  };
  if (fromId) {
    const n = nodeById(model, fromId);
    if (n) go(n, []);
    return out;
  }
  if (model.root) go(model.root, []);
  (model.free || []).forEach((n) => go(n, []));
  return out;
}
