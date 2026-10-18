/* ------------------------------------------------------------------ */
/* Tree: converting between canvases and mind maps                    */
/*                                                                    */
/* A canvas read as a map, by the canvas's own tree code: its arrows    */
/* make the tree, siblings in the order they lie; what the plugin kept */
/* on its cards and arrows goes where a map keeps it (CANVAS_KEYS). A  */
/* canvas of several trees gets a root of its own; cards joined to     */
/* nothing are free nodes. And a map written back out as a canvas, its */
/* nodes where the map lays them. Pure: data in, data out — the canvas */
/* converted is only ever read.                                        */
/* ------------------------------------------------------------------ */

import { arrowLinks, isGroupRecord, modelFromData, newNode, treeModel } from './400-tree-model.js';
import { BRANCH_LAYOUTS, siblingOrder } from './403-tree-layouts.js';

/* What each key the plugin keeps on a canvas becomes in a mind map. */
export const CANVAS_KEYS = {
  drNudge: 'a nudge in the layout block',
  drLayout: 'the map’s layout, on its first card; a branch’s own layout, on any other',
  drFold: 'the node folded',
  drTuck: 'a node in a folded branch: nothing of its own',
  drMaster: 'the node’s master attribute',
  drPinned: 'the node pinned where it lay',
  drRole: 'the node’s part in an argument',
  drFrames: 'a group framing a branch: the group attribute on its first node',
  drRelated: 'a relation, out of the tree',
  drRelation: 'a relation’s kind, or its words',
  drArrow: 'a relation’s line, shape and head',
};

const kept = (rec, key) => (rec && rec[key] !== undefined ? rec[key] : undefined);

/**
 * A canvas's data as a mind map: { model, report } — the report lists
 * what had no place in a map. `title` names a root made for several
 * trees; `linkFor(path, subpath)` writes a note's card as a link.
 */
export function mapFromCanvas(data, opts = {}) {
  const raw = data && typeof data === 'object' ? data : {};
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const byRaw = new Map(rawNodes.map((n) => [n.id, n]));
  const cards = modelFromData({ nodes: rawNodes, edges: rawEdges });
  const links = arrowLinks(cards);
  const report = [];
  const linkFor = opts.linkFor || ((path, sub) => `[[${String(path).replace(/\.md$/, '')}${sub || ''}]]`);
  const textOf = (rec) => {
    if (rec.type === 'file') return linkFor(rec.file || '', rec.subpath || '');
    if (rec.type === 'link') return rec.url ? `[${rec.url}](${rec.url})` : '';
    return String(rec.text || '');
  };
  const plain = cards.nodes.filter((r) => !isGroupRecord(r));
  const hasParent = (r) => (links.parents.get(r.id) || []).some((p) => cards.byId.has(p));
  const hasKids = (r) => (links.children.get(r.id) || []).length > 0;
  const byPlace = (a, b) => a.y - b.y || a.x - b.x;
  let roots = plain.filter((r) => !hasParent(r) && hasKids(r)).sort(byPlace);
  const loose = plain.filter((r) => !hasParent(r) && !hasKids(r)).sort(byPlace);
  // A canvas that's all loops: its first card stands for the root.
  if (!roots.length && plain.length && !loose.length) roots = [plain.slice().sort(byPlace)[0]];
  const model = treeModel('');
  const layout = { v: 1 };
  const used = new Set();
  const cross = [];
  const origin = roots[0] || loose[0] || { x: 0, y: 0 };
  const make = (rec, parent) => {
    used.add(rec.id);
    const r = byRaw.get(rec.id) || {};
    const n = { id: rec.id, text: textOf(rec), attrs: {}, anchor: false, children: [], parent };
    if (r.color) n.attrs.color = String(r.color);
    if (rec.fold || kept(r, 'drFold')) n.attrs.fold = 1;
    if (rec.master) n.attrs.master = 1;
    if (typeof kept(r, 'drRole') === 'string') n.attrs.role = r.drRole;
    if (rec.pinned) n.attrs.pin = [Math.round(rec.x - origin.x), Math.round(rec.y - origin.y)];
    const nudge = kept(r, 'drNudge');
    if (parent && nudge && typeof nudge.dx === 'number' && typeof nudge.dy === 'number' && (nudge.dx || nudge.dy)) {
      layout.nudge = layout.nudge || {};
      layout.nudge[rec.id] = [Math.round(nudge.dx), Math.round(nudge.dy)];
      n.anchor = true;
    }
    const mode = kept(r, 'drLayout');
    if (BRANCH_LAYOUTS.some((b) => b[0] === mode)) {
      if (!parent || parent.virtual) model.mode = model.mode || mode;
      else {
        layout.branch = layout.branch || {};
        layout.branch[rec.id] = mode;
        n.anchor = true;
      }
    }
    return n;
  };
  // Breadth first, as the canvas's tree reads it: a card hangs from the first card to reach it; any other is a cross-link.
  const grow = (top, rootId, kids) => {
    const queue = [top];
    while (queue.length) {
      const n = queue.shift();
      (kids.get(n.id) || []).forEach((c) => {
        if (used.has(c.id)) {
          if (c.id !== n.id) cross.push([n.id, c.id]);
          return;
        }
        const child = make(c, n);
        n.children.push(child);
        queue.push(child);
      });
    }
  };
  // Each card's children by its arrows, folded ones too, in the order they lie.
  const kids = {
    get: (id) =>
      siblingOrder(
        cards.byId.get(id),
        (links.children.get(id) || []).map((c) => cards.byId.get(c)).filter((c) => c && !isGroupRecord(c))
      ),
  };
  const trees = roots.map((rec) => ({ rec, kids }));
  if (trees.length === 1) {
    model.root = make(trees[0].rec, null);
    grow(model.root, trees[0].rec.id, trees[0].kids);
  } else {
    model.root = Object.assign(newNode(opts.title || ''), { virtual: true });
    trees.forEach(({ rec, kids }) => {
      if (used.has(rec.id)) return;
      const top = make(rec, model.root);
      model.root.children.push(top);
      grow(top, rec.id, kids);
    });
  }
  loose.forEach((rec) => model.free.push(make(rec, null)));
  // Anything a loop kept out of every tree: free, so nothing's lost.
  plain.filter((r) => !used.has(r.id)).forEach((rec) => model.free.push(make(rec, null)));
  const nodeOf = new Map();
  const index = (n) => {
    nodeOf.set(n.id, n);
    n.children.forEach(index);
  };
  index(model.root);
  model.free.forEach(index);
  // A group framing a branch: its name on the branch's first node; any other group has no place.
  cards.nodes.filter(isGroupRecord).forEach((g) => {
    const frame = kept(byRaw.get(g.id), 'drFrames');
    const n = frame && nodeOf.get(frame.id);
    if (n) n.attrs.group = String(g.label || 'Group');
    else report.push(`The group “${g.label || 'Untitled'}”`);
  });
  // Arrows out of the tree, and second parents, as relations.
  const anchor = (id) => {
    const n = nodeOf.get(id);
    if (n && n !== model.root) n.anchor = true;
  };
  rawEdges.forEach((e) => {
    const a = nodeOf.get(e.fromNode);
    const b = nodeOf.get(e.toNode);
    if (!a || !b || a === b) return;
    const info = kept(e, 'drRelation');
    if (!kept(e, 'drRelated')) {
      if (info) report.push(`The kind on the arrow from “${a.text.split('\n')[0]}” in the tree`);
      return;
    }
    const style = kept(e, 'drArrow') || {};
    const attrs = {};
    let from = a.id;
    let to = b.id;
    if (info && typeof info === 'object' && info.predicate) attrs.predicate = String(info.predicate);
    else if (info) attrs.kind = String(typeof info === 'string' ? info : info.kind);
    if (info && typeof info === 'object' && info.subject === b.id && info.object === a.id) {
      from = b.id;
      to = a.id;
    }
    if (style.line) attrs.style = style.line;
    if (style.shape && style.shape !== 'curve') attrs.shape = style.shape;
    if (style.head && style.head !== 'arrow') attrs.head = style.head;
    if (e.color) attrs.color = String(e.color);
    anchor(from);
    anchor(to);
    model.relations.push({ from, to, label: String(e.label || ''), attrs });
  });
  cross.forEach(([from, to]) => {
    if (model.relations.some((r) => r.from === from && r.to === to)) return;
    anchor(from);
    anchor(to);
    model.relations.push({ from, to, label: '', attrs: { style: 'dashed' } });
  });
  model.layout = Object.keys(layout).length > 1 ? layout : null;
  return { model, report };
}

/**
 * A map as a canvas's data: each node a card where `boxes` (id -> box)
 * puts it, a note's link a note's card, the tree as arrows, relations
 * as arrows out of the tree saying what they said. `fileFor(text)`
 * gives a note's path for a node that's just a link to one, or null.
 */
export function canvasFromMap(model, boxes, fileFor) {
  const nodes = [];
  const edges = [];
  const card = (n) => {
    const b = boxes.get(n.id);
    if (!b) return;
    const file = fileFor ? fileFor(n.text) : null;
    const out = Object.assign({ id: n.id, x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }, file ? { type: 'file', file } : { type: 'text', text: n.text || '' });
    if (n.attrs.color !== undefined && n.attrs.color !== '') out.color = String(n.attrs.color);
    if (n.attrs.role) out.drRole = n.attrs.role;
    if (n === model.root && model.mode) out.drLayout = model.mode;
    nodes.push(out);
  };
  const side = (a, b) => {
    const dx = b.x + b.width / 2 - (a.x + a.width / 2);
    const dy = b.y + b.height / 2 - (a.y + a.height / 2);
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? ['right', 'left'] : ['left', 'right']) : dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
  };
  const walk = (n) => {
    if (!n.virtual) card(n);
    n.children.forEach((c) => {
      if (!n.virtual && boxes.has(n.id) && boxes.has(c.id)) {
        const [fromSide, toSide] = side(boxes.get(n.id), boxes.get(c.id));
        edges.push({ id: `e-${n.id}-${c.id}`, fromNode: n.id, fromSide, toNode: c.id, toSide });
      }
      walk(c);
    });
  };
  walk(model.root);
  (model.free || []).forEach(walk);
  (model.relations || []).forEach((r, k) => {
    const a = boxes.get(r.from);
    const b = boxes.get(r.to);
    if (!a || !b) return;
    const [fromSide, toSide] = side(a, b);
    const e = { id: `r-${k}-${r.from}-${r.to}`, fromNode: r.from, fromSide, toNode: r.to, toSide, drRelated: true };
    if (r.label) e.label = r.label;
    const at = r.attrs || {};
    if (at.predicate) e.drRelation = { predicate: at.predicate, subject: r.from, object: r.to };
    else if (at.kind) e.drRelation = { kind: at.kind, subject: r.from, object: r.to };
    const style = {};
    if (at.style) style.line = at.style;
    if (at.shape) style.shape = at.shape;
    if (at.head) style.head = at.head;
    if (Object.keys(style).length) e.drArrow = style;
    if (at.color) e.color = String(at.color);
    edges.push(e);
  });
  return { nodes, edges };
}
