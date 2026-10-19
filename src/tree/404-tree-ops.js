/* ------------------------------------------------------------------ */
/* Tree: changes, each with its undo                                   */
/*                                                                    */
/* Every change to a map is a few operations by id — insert, remove,   */
/* move, set text, set an attribute, show an id, add or drop a relation */
/* — and applying one gives back the operation that undoes it. A       */
/* change is a Patch: { ops, inverse, selection }, ids only, never the  */
/* objects themselves, so it can be applied again to a map read afresh. */
/* ------------------------------------------------------------------ */

import { newId, newNode, nodeById } from './400-tree-model.js';
import { splitItemText } from './401-tree-outline.js';

/** A node and what's below it as plain data, ids kept. */
export function snapshotNode(n) {
  return { id: n.id, text: n.text, attrs: JSON.parse(JSON.stringify(n.attrs || {})), anchor: !!n.anchor, children: n.children.map(snapshotNode) };
}

/** Plain data back into nodes. */
export function nodeFromSnapshot(s, parent) {
  const n = newNode(s.text, JSON.parse(JSON.stringify(s.attrs || {})), s.id);
  n.anchor = !!s.anchor;
  n.parent = parent;
  n.children = (s.children || []).map((c) => nodeFromSnapshot(c, n));
  return n;
}

/** The list a node is in: its parent's children, or the free nodes. */
function listOf(model, parentId) {
  if (parentId === null || parentId === undefined) return model.free;
  const p = nodeById(model, parentId);
  if (!p) throw new Error(`No node ${parentId}`);
  return p.children;
}

function placeOf(model, n) {
  const list = n.parent ? n.parent.children : model.free;
  return { parentId: n.parent ? n.parent.id : null, index: list.indexOf(n) };
}

/** One operation applied; what undoes it comes back. Throws where it can't be applied. */
export function applyOp(model, op) {
  switch (op.type) {
    case 'insert': {
      const list = listOf(model, op.parentId);
      if (nodeById(model, op.node.id)) throw new Error(`Node ${op.node.id} is there already`);
      const parent = op.parentId === null || op.parentId === undefined ? null : nodeById(model, op.parentId);
      list.splice(Math.max(0, Math.min(op.index, list.length)), 0, nodeFromSnapshot(op.node, parent));
      return { type: 'remove', id: op.node.id };
    }
    case 'remove': {
      const n = nodeById(model, op.id);
      if (!n || n === model.root) throw new Error(`Can't remove ${op.id}`);
      const at = placeOf(model, n);
      const snap = snapshotNode(n);
      (n.parent ? n.parent.children : model.free).splice(at.index, 1);
      n.parent = null;
      return { type: 'insert', parentId: at.parentId, index: at.index, node: snap };
    }
    case 'move': {
      const n = nodeById(model, op.id);
      if (!n || n === model.root) throw new Error(`Can't move ${op.id}`);
      const target = op.parentId === null || op.parentId === undefined ? null : nodeById(model, op.parentId);
      for (let p = target; p; p = p.parent) if (p === n) throw new Error(`Can't move ${op.id} into itself`);
      const at = placeOf(model, n);
      (n.parent ? n.parent.children : model.free).splice(at.index, 1);
      const list = target ? target.children : model.free;
      list.splice(Math.max(0, Math.min(op.index, list.length)), 0, n);
      n.parent = target;
      return { type: 'move', id: op.id, parentId: at.parentId, index: at.index };
    }
    case 'text': {
      const n = nodeById(model, op.id);
      if (!n) throw new Error(`No node ${op.id}`);
      const was = n.text;
      n.text = op.text;
      return { type: 'text', id: op.id, text: was };
    }
    case 'attr': {
      const n = nodeById(model, op.id);
      if (!n) throw new Error(`No node ${op.id}`);
      const was = n.attrs[op.key];
      if (op.value === undefined) delete n.attrs[op.key];
      else n.attrs[op.key] = op.value;
      return { type: 'attr', id: op.id, key: op.key, value: was };
    }
    case 'anchor': {
      const n = nodeById(model, op.id);
      if (!n) throw new Error(`No node ${op.id}`);
      const was = !!n.anchor;
      n.anchor = !!op.on;
      return { type: 'anchor', id: op.id, on: was };
    }
    case 'relation-add': {
      const index = Math.max(0, Math.min(op.index === undefined ? model.relations.length : op.index, model.relations.length));
      model.relations.splice(index, 0, JSON.parse(JSON.stringify(op.relation)));
      return { type: 'relation-remove', index };
    }
    case 'relation-remove': {
      const r = model.relations[op.index];
      if (!r) throw new Error(`No relation ${op.index}`);
      model.relations.splice(op.index, 1);
      return { type: 'relation-add', index: op.index, relation: r };
    }
    case 'mode': {
      const was = model.mode || null;
      model.mode = op.mode || null;
      return { type: 'mode', mode: was };
    }
    case 'layout': {
      const was = model.layout ? JSON.parse(JSON.stringify(model.layout)) : null;
      model.layout = op.layout ? JSON.parse(JSON.stringify(op.layout)) : null;
      return { type: 'layout', layout: was };
    }
    default:
      throw new Error(`Unknown change ${op.type}`);
  }
}

/** Operations applied in order, as one change: the patch, with what undoes it — or, if one can't be applied, nothing changed and an error. */
export function applyPatch(model, ops, selection) {
  const inverse = [];
  try {
    ops.forEach((op) => inverse.unshift(applyOp(model, op)));
  } catch (err) {
    inverse.forEach((op) => applyOp(model, op));
    throw err;
  }
  return { ops, inverse, selection: selection || [] };
}

/** A patch undone: its inverse applied; the patch that redoes it comes back. */
export function undoPatch(model, patch, selection) {
  const redo = applyPatch(model, patch.inverse, selection);
  return { ops: patch.inverse, inverse: redo.inverse, selection: selection || [] };
}

/* -- the changes a map is edited with --------------------------------- */

const fresh = (text, attrs) => ({ id: newId(), text: text || '', attrs: attrs || {}, anchor: false, children: [] });

/** A new node under one, at the end or at `index`. */
export function addChild(model, parentId, text, index) {
  const parent = nodeById(model, parentId);
  const node = fresh(text);
  const ops = [];
  // A folded branch opens to show what's added to it.
  if (parent && parent.attrs.fold) ops.push({ type: 'attr', id: parentId, key: 'fold', value: undefined });
  ops.push({ type: 'insert', parentId, index: index === undefined ? (parent ? parent.children.length : 0) : index, node });
  return applyPatch(model, ops, [node.id]);
}

/** A new node beside one, after it — or before. Beside the root: under it. */
export function addSibling(model, id, text, before) {
  const n = nodeById(model, id);
  if (!n || n === model.root || (!n.parent && !model.free.includes(n))) return addChild(model, model.root.id, text);
  const at = placeOf(model, n);
  const node = fresh(text);
  return applyPatch(model, [{ type: 'insert', parentId: at.parentId, index: at.index + (before ? 0 : 1), node }], [node.id]);
}

/** A new node between one and its parent: the node now hangs from it. */
export function addParent(model, id, text) {
  const n = nodeById(model, id);
  if (!n || n === model.root) return null;
  const at = placeOf(model, n);
  const node = fresh(text);
  return applyPatch(model, [{ type: 'insert', parentId: at.parentId, index: at.index, node }, { type: 'move', id, parentId: node.id, index: 0 }], [node.id]);
}

/** A node and its branch taken out; the one beside it, or its parent, selected. */
export function removeNode(model, id) {
  const n = nodeById(model, id);
  if (!n || n === model.root) return null;
  const list = n.parent ? n.parent.children : model.free;
  const i = list.indexOf(n);
  const next = list[i + 1] || list[i - 1] || n.parent;
  // Relations to anything in the branch go with it.
  const gone = new Set();
  const mark = (x) => {
    gone.add(x.id);
    x.children.forEach(mark);
  };
  mark(n);
  const ops = [];
  model.relations
    .map((r, k) => [r, k])
    .filter(([r]) => gone.has(r.from) || gone.has(r.to))
    .reverse()
    .forEach(([, k]) => ops.push({ type: 'relation-remove', index: k }));
  ops.push({ type: 'remove', id });
  return applyPatch(model, ops, next ? [next.id] : []);
}

/** A node moved under another, at an index — not into its own branch. */
export function moveNode(model, id, parentId, index) {
  const n = nodeById(model, id);
  const target = parentId === null ? null : nodeById(model, parentId);
  if (!n || n === model.root) return null;
  for (let p = target; p; p = p.parent) if (p === n) return null;
  const list = target ? target.children : model.free;
  let at = index === undefined ? list.length : index;
  // Moving down within the same list: the index as it will be once it's out.
  if (n.parent === target && list.indexOf(n) < at) at -= 1;
  const ops = [];
  if (target && target.attrs.fold) ops.push({ type: 'attr', id: target.id, key: 'fold', value: undefined });
  ops.push({ type: 'move', id, parentId: target ? target.id : null, index: at });
  return applyPatch(model, ops, [id]);
}

/** A node under the one before it, at its end. */
export function indentNode(model, id) {
  const n = nodeById(model, id);
  if (!n || !n.parent) return null;
  const list = n.parent.children;
  const i = list.indexOf(n);
  if (i < 1) return null;
  return moveNode(model, id, list[i - 1].id, list[i - 1].children.length);
}

/** A node out to sit after its parent. */
export function outdentNode(model, id) {
  const n = nodeById(model, id);
  if (!n || !n.parent || !n.parent.parent) return null;
  const p = n.parent;
  return moveNode(model, id, p.parent.id, p.parent.children.indexOf(p) + 1);
}

/** A node a step up or down among its siblings. */
export function reorderNode(model, id, by) {
  const n = nodeById(model, id);
  if (!n || n === model.root) return null;
  const list = n.parent ? n.parent.children : model.free;
  const i = list.indexOf(n);
  const to = i + by;
  if (to < 0 || to >= list.length) return null;
  return applyPatch(model, [{ type: 'move', id, parentId: n.parent ? n.parent.id : null, index: to }], [id]);
}

export function setText(model, id, text) {
  const n = nodeById(model, id);
  if (!n || n.text === text) return null;
  return applyPatch(model, [{ type: 'text', id, text }], [id]);
}

export function setAttr(model, id, key, value) {
  const n = nodeById(model, id);
  if (!n || n.attrs[key] === value) return null;
  return applyPatch(model, [{ type: 'attr', id, key, value }], [id]);
}

/** A copy of a node's branch beside it, with new ids. */
export function duplicateBranch(model, id) {
  const n = nodeById(model, id);
  if (!n || n === model.root) return null;
  const copy = (s) => ({ id: newId(), text: s.text, attrs: JSON.parse(JSON.stringify(s.attrs)), anchor: false, children: s.children.map(copy) });
  const snap = copy(snapshotNode(n));
  const at = placeOf(model, n);
  return applyPatch(model, [{ type: 'insert', parentId: at.parentId, index: at.index + 1, node: snap }], [snap.id]);
}

/** One node's text split at a point: the rest a new node after it. */
export function splitNode(model, id, at) {
  const n = nodeById(model, id);
  if (!n || at <= 0 || at >= n.text.length) return null;
  const node = fresh(n.text.slice(at).replace(/^\s+/, ''));
  const place = n === model.root ? null : placeOf(model, n);
  const ops = [{ type: 'text', id, text: n.text.slice(0, at).replace(/\s+$/, '') }];
  ops.push(place ? { type: 'insert', parentId: place.parentId, index: place.index + 1, node } : { type: 'insert', parentId: id, index: 0, node });
  return applyPatch(model, ops, [node.id]);
}

/** A node folded into the one before it: its text joined on, its children after the other's. */
export function mergeIntoPrevious(model, id) {
  const n = nodeById(model, id);
  if (!n || !n.parent) return null;
  const list = n.parent.children;
  const i = list.indexOf(n);
  if (i < 1) return null;
  const prev = list[i - 1];
  const ops = [{ type: 'text', id: prev.id, text: `${prev.text} ${n.text}`.trim() }];
  n.children.forEach((c, k) => ops.push({ type: 'move', id: c.id, parentId: prev.id, index: prev.children.length + k }));
  ops.push({ type: 'remove', id });
  return applyPatch(model, ops, [prev.id]);
}

/**
 * Lines pasted as nodes: a list keeps its nesting; plain lines become
 * siblings. Under a node, at its end. [{ text, children }] parsed first.
 */
export function pasteLines(model, parentId, text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return null;
  const MARKED = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
  const inList = lines.some((l) => MARKED.test(l));
  const roots = [];
  const stack = [];
  lines.forEach((line) => {
    const marked = MARKED.exec(line);
    const m = marked || /^([ \t]*)()(.*)$/.exec(line);
    const width = m[1].replace(/\t/g, '    ').length;
    const top = stack[stack.length - 1];
    // In a list, a line without a mark set in under an item goes on with its text, as Markdown has it.
    if (!marked && inList && top && width > top.width) {
      top.node.text += `\n${m[3].trim()}`;
      return;
    }
    // Its words, attributes and escapes read as the map writes them; an id it had is left, the node's new.
    const parts = splitItemText(m[3].trim());
    const node = fresh(parts.text, parts.attrs);
    while (stack.length && stack[stack.length - 1].width >= width) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ width, node });
  });
  const parent = nodeById(model, parentId);
  const start = parent ? parent.children.length : 0;
  const ops = [];
  if (parent && parent.attrs.fold) ops.push({ type: 'attr', id: parentId, key: 'fold', value: undefined });
  roots.forEach((r, k) => ops.push({ type: 'insert', parentId, index: start + k, node: r }));
  return applyPatch(model, ops, [roots[roots.length - 1].id]);
}

/**
 * The map made as another is — its tree under the same root, its free
 * nodes, relations, layout block and layout — in one patch: one step of
 * Undo. Ids `then` shares with the map are kept.
 */
export function replaceMap(model, then) {
  const ops = [];
  for (let k = model.relations.length - 1; k >= 0; k--) ops.push({ type: 'relation-remove', index: k });
  model.root.children.slice().reverse().forEach((c) => ops.push({ type: 'remove', id: c.id }));
  (model.free || []).slice().reverse().forEach((n) => ops.push({ type: 'remove', id: n.id }));
  const top = then.root;
  if (top.text !== model.root.text) ops.push({ type: 'text', id: model.root.id, text: top.text });
  Object.keys(Object.assign({}, model.root.attrs, top.attrs)).forEach((key) => {
    if (JSON.stringify(model.root.attrs[key]) !== JSON.stringify(top.attrs[key])) ops.push({ type: 'attr', id: model.root.id, key, value: top.attrs[key] });
  });
  top.children.forEach((c, i) => ops.push({ type: 'insert', parentId: model.root.id, index: i, node: snapshotNode(c) }));
  (then.free || []).forEach((n, i) => ops.push({ type: 'insert', parentId: null, index: i, node: snapshotNode(n) }));
  const rootOf = (id) => (id === top.id ? model.root.id : id);
  (then.relations || []).forEach((r) => ops.push({ type: 'relation-add', relation: Object.assign({}, r, { from: rootOf(r.from), to: rootOf(r.to) }) }));
  ops.push({ type: 'layout', layout: then.layout || null });
  if ((then.mode || null) !== (model.mode || null)) ops.push({ type: 'mode', mode: then.mode || null });
  return applyPatch(model, ops, []);
}
