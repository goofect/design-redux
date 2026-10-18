/* ------------------------------------------------------------------ */
/* Tree: looking a map over                                            */
/*                                                                    */
/* What may be wrong with a map: a node on it twice, one with nothing  */
/* in it, a link to a note that's gone, a free node joined to nothing, */
/* relations leading round in a circle, or one that leads nowhere.     */
/* Pure: `noteExists(target)` says whether a link's note is there.     */
/* ------------------------------------------------------------------ */

import { walk } from './400-tree-model.js';
import { noteLinkOf } from './408-tree-notes.js';

const checkTitle = (n) => String(n.text || '').split('\n')[0].trim().toLowerCase();

/** What may be wrong with a map: [{ id, problem }], a node at most once for each kind of problem. */
export function mapProblems(model, noteExists) {
  const out = [];
  const titles = new Map();
  walk(model, (n) => {
    if (n.virtual) return;
    const t = checkTitle(n);
    if (!t) out.push({ id: n.id, problem: 'Has nothing in it' });
    else titles.set(t, (titles.get(t) || []).concat(n.id));
    const link = noteLinkOf(n.text);
    if (link && noteExists && !noteExists(link.target)) out.push({ id: n.id, problem: 'Its note is gone' });
  });
  titles.forEach((ids) => {
    if (ids.length > 1) ids.forEach((id) => out.push({ id, problem: `On the map ${ids.length} times` }));
  });
  const ids = new Set();
  walk(model, (n) => ids.add(n.id));
  const rels = (model.relations || []).filter((r) => ids.has(r.from) && ids.has(r.to));
  (model.relations || []).forEach((r) => {
    if (!ids.has(r.from) || !ids.has(r.to)) out.push({ id: ids.has(r.from) ? r.from : r.to, problem: 'A relation of it leads nowhere' });
  });
  (model.free || []).forEach((n) => {
    if (!n.children.length && !rels.some((r) => r.from === n.id || r.to === n.id)) out.push({ id: n.id, problem: 'Not joined to anything' });
  });
  // Relations that come back round to where they began.
  const next = new Map();
  rels.forEach((r) => next.set(r.from, (next.get(r.from) || []).concat(r.to)));
  const state = new Map();
  const inCircle = new Set();
  const visit = (id, path) => {
    state.set(id, 1);
    path.push(id);
    (next.get(id) || []).forEach((to) => {
      if (state.get(to) === 1) path.slice(path.indexOf(to)).forEach((x) => inCircle.add(x));
      else if (!state.has(to)) visit(to, path);
    });
    path.pop();
    state.set(id, 2);
  };
  next.forEach((v, id) => !state.has(id) && visit(id, []));
  inCircle.forEach((id) => out.push({ id, problem: 'Its relations lead round in a circle' }));
  return out;
}
