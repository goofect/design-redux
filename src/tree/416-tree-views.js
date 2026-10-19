/* ------------------------------------------------------------------ */
/* Tree: a map seen another way                                        */
/*                                                                    */
/* The same tree as an outline's rows, a board's columns — by status  */
/* or by tag — a timeline of what's due, or a table of its nodes and   */
/* their attributes. Each is read from the model as it is; a change    */
/* made in one is an ordinary change to the tree. Pure.                */
/* ------------------------------------------------------------------ */

import { nodeById, walk } from './400-tree-model.js';
import { applyPatch } from './404-tree-ops.js';
import { isDayKey, statusesOf, taskOf } from './415-tree-tasks.js';

/** The rows of an outline: [{ node, depth }], depth first; a folded node's branch left out; free nodes after. */
export function outlineRows(model) {
  const rows = [];
  const go = (n, depth) => {
    if (!n.virtual) rows.push({ node: n, depth });
    if (!n.attrs.fold) n.children.forEach((c) => go(c, n.virtual ? depth : depth + 1));
  };
  if (model.root) go(model.root, 0);
  (model.free || []).forEach((n) => go(n, 0));
  return rows;
}

/* A tag in a node's first line: #word, after a space or at the start. */
const TAG = /(^|\s)#([^\s#.,;:!?()[\]{}"']+)/g;

/** The tags in a node's first line, without their #. */
export function nodeTags(node) {
  const line = String((node && node.text) || '').split('\n')[0];
  const out = [];
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(line))) if (!out.includes(m[2])) out.push(m[2]);
  return out;
}

/**
 * A board's columns: [{ key, label, cards }]. By status, a card for each
 * task or node with a status, a column for each status — `statuses`
 * first, then the map's own — and one for tasks with none. By tag, a
 * card for each node with a tag, in a column for each of its tags.
 */
export function kanbanColumns(model, by, statuses) {
  const cols = new Map();
  const col = (key, label) => cols.get(key) || cols.set(key, { key, label, cards: [] }).get(key);
  if (by === 'tag') {
    walk(model, (n) => nodeTags(n).forEach((tag) => col(tag, `#${tag}`).cards.push(n)));
    return Array.from(cols.values());
  }
  const none = { key: null, label: 'No status', cards: [] };
  (statuses || []).concat(statusesOf(model)).forEach((s) => col(s, s));
  walk(model, (n) => {
    const s = typeof n.attrs.status === 'string' && n.attrs.status ? n.attrs.status : null;
    if (s) col(s, s).cards.push(n);
    else if (taskOf(n)) none.cards.push(n);
  });
  return (none.cards.length ? [none] : []).concat(Array.from(cols.values()));
}

/**
 * A card moved from one column to another: by status, its status set
 * (none for the No status column); by tag, the one tag changed for the
 * other in its text. Nothing else about the node changes.
 */
export function moveCard(model, id, by, from, to) {
  const n = nodeById(model, id);
  if (!n || from === to) return null;
  if (by !== 'tag') {
    const value = to === null || to === undefined ? undefined : to;
    return n.attrs.status === value ? null : applyPatch(model, [{ type: 'attr', id, key: 'status', value }], [id]);
  }
  const [first, ...rest] = String(n.text || '').split('\n');
  let line = first;
  if (from) line = line.replace(new RegExp(`(^|\\s)#${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|[\\s#.,;:!?()[\\]{}"'])`), to ? `$1#${to}` : '$1').replace(/\s{2,}/g, ' ').trim();
  else if (to) line = `${line} #${to}`;
  const text = [line].concat(rest).join('\n');
  return text === n.text ? null : applyPatch(model, [{ type: 'text', id, text }], [id]);
}

/** What's due, by day: [{ due, items }] in date order, each day's nodes in the map's order. */
export function timelineDays(model) {
  const days = new Map();
  walk(model, (n) => {
    const due = n.attrs && n.attrs.due;
    if (!isDayKey(due)) return;
    if (!days.has(due)) days.set(due, []);
    days.get(due).push(n);
  });
  return Array.from(days.keys())
    .sort()
    .map((due) => ({ due, items: days.get(due) }));
}

/* Attributes that say how a node is drawn or kept, not what it is: no column of their own. */
const DRAWN_ATTRS = ['fold', 'pin', 'master', 'group', 'style', 'color'];

/** A table's columns: the node, done, status, due, then any other attribute some node has. */
export function tableColumns(model) {
  const extra = [];
  walk(model, (n) =>
    Object.keys(n.attrs || {}).forEach((k) => {
      if (!['status', 'due'].includes(k) && !DRAWN_ATTRS.includes(k) && !extra.includes(k)) extra.push(k);
    })
  );
  return ['text', 'done', 'status', 'due'].concat(extra.sort());
}
