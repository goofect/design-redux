/* ------------------------------------------------------------------ */
/* Tree: what a filter lights                                          */
/*                                                                    */
/* Words, a tag, a status, a colour, how deep: the nodes that meet     */
/* every one set are lit, with the way down to them; the rest are      */
/* dimmed by the view, never changed. And the way down to a node, for  */
/* a branch shown alone. Pure.                                         */
/* ------------------------------------------------------------------ */

import { nodeById, walk } from './400-tree-model.js';
import { nodeTags } from './416-tree-views.js';

/** Whether a filter sets anything: { text, tag, status, colour, depth }. */
export function filtering(f) {
  return !!f && !!(String(f.text || '').trim() || f.tag || f.status || f.colour || f.depth);
}

/** Whether a node at a depth meets every part of a filter that's set. 'none' for a status or colour asks for none. */
export function meetsFilter(n, depth, f) {
  const text = String(f.text || '').trim().toLowerCase();
  if (text && !String(n.text || '').toLowerCase().includes(text)) return false;
  if (f.tag && !nodeTags(n).includes(f.tag)) return false;
  const status = typeof n.attrs.status === 'string' ? n.attrs.status : '';
  if (f.status && (f.status === 'none' ? status : status !== f.status)) return false;
  const colour = n.attrs.color !== undefined && n.attrs.color !== '' ? String(n.attrs.color) : '';
  if (f.colour && (f.colour === 'none' ? colour : colour !== f.colour)) return false;
  if (f.depth && depth > f.depth) return false;
  return true;
}

/** What a filter lights: the nodes meeting it and those above them; null when it sets nothing. */
export function filterSet(model, f) {
  if (!filtering(f)) return null;
  const lit = new Set();
  const go = (n, depth, above) => {
    if (meetsFilter(n, depth, f)) {
      lit.add(n.id);
      above.forEach((id) => lit.add(id));
    }
    n.children.forEach((c) => go(c, depth + 1, above.concat(n.id)));
  };
  if (model.root) go(model.root, 0, []);
  (model.free || []).forEach((n) => go(n, 0, []));
  return lit;
}

/** Every tag a map's nodes have, in the order first met. */
export function mapTags(model) {
  const out = [];
  walk(model, (n) => nodeTags(n).forEach((t) => !out.includes(t) && out.push(t)));
  return out;
}

/** The way down to a node: the nodes above it, from the root, then it. */
export function pathTo(model, id) {
  const out = [];
  for (let n = nodeById(model, id); n; n = n.parent) out.unshift(n);
  return out;
}
