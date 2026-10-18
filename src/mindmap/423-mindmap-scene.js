/* ------------------------------------------------------------------ */
/* Mind map: the scene                                                 */
/*                                                                    */
/* The map's tree as boxes on a plane: each shown node sized from its  */
/* text, laid out by the tree's own layouts from the root at 0,0 — the */
/* list's order is the siblings' order — free nodes in a row beneath.  */
/* And the maths of looking at it: what's on screen, where a point is.  */
/* No DOM here but what a size is measured with.                      */
/* ------------------------------------------------------------------ */

import { plainMarkdownLine } from '../core/047-helpers-text.js';
import { arrowLinks, modelFromData, sideAxes } from '../tree/400-tree-model.js';
import { BRANCH_LAYOUTS, composedLayout } from '../tree/403-tree-layouts.js';
import { branchLayoutOf, nodeNudge } from '../tree/406-tree-layout-block.js';

/* A node's box: as wide as its words want, up to a limit. */
export const NODE_MIN_WIDTH = 72;
export const NODE_MAX_WIDTH = 280;
export const NODE_LINE = 20;
export const NODE_PAD = { x: 12, y: 8 };
export const CHAR_WIDTH = 7.4;
/* Room round what's on screen that's drawn too, so a pan doesn't show an edge. */
export const DRAW_MARGIN = 200;

/** A node's text as one plain line, for its box and its size. */
export function nodeLabel(node) {
  const first = String((node && node.text) || '').split('\n')[0];
  return plainMarkdownLine(first) || (node && node.virtual ? 'Untitled' : '');
}

/** A node's text in two: its first line, the title, and the lines after it, its details. */
export function nodeParts(node) {
  const lines = String((node && node.text) || '').split('\n');
  const title = lines[0] || (node && node.virtual ? 'Untitled' : '');
  return { title, details: lines.slice(1).join('\n').trim() };
}

/* Details are set smaller than the title. */
export const DETAIL_LINE = 18;
export const DETAIL_CHAR = 6.6;

/** A box for a node's text, estimated from its length until it's been measured: { width, height }. */
export function estimateSize(text) {
  const [title, ...rest] = String(text || '').split('\n');
  const inner = NODE_MAX_WIDTH - NODE_PAD.x * 2;
  const chars = plainMarkdownLine(title).length || String(title || '').length;
  let wide = Math.min(inner, Math.max(NODE_MIN_WIDTH - NODE_PAD.x * 2, Math.ceil(chars * CHAR_WIDTH)));
  let height = Math.max(1, Math.ceil((chars * CHAR_WIDTH) / inner)) * NODE_LINE;
  rest.filter((l) => l.trim()).forEach((line) => {
    const w = line.trim().length * DETAIL_CHAR;
    wide = Math.min(inner, Math.max(wide, Math.ceil(w)));
    height += Math.max(1, Math.ceil(w / inner)) * DETAIL_LINE;
  });
  return { width: Math.round(wide + NODE_PAD.x * 2), height: height + NODE_PAD.y * 2 };
}

/* The six colours a node can take by number, as the canvas has them. */
export const NODE_COLOURS = { 1: 'Red', 2: 'Orange', 3: 'Yellow', 4: 'Green', 5: 'Cyan', 6: 'Purple' };

/** A node's own colour as a key: '1'–'6', a #hex, or null. */
export function colourKey(n) {
  const c = n && n.attrs ? n.attrs.color : undefined;
  if (c === undefined || c === null || c === '') return null;
  const s = String(c).trim();
  return /^[1-6]$/.test(s) || /^#[0-9a-f]{3,8}$/i.test(s) ? s.toLowerCase() : null;
}

/**
 * A tint, 1–6, for each node with no colour of its own: by the branch
 * from the root it's in ('branch'), or how many steps out it is
 * ('depth'). The root has none.
 */
export function nodeTints(model, by) {
  const out = new Map();
  if (!model.root || (by !== 'branch' && by !== 'depth')) return out;
  model.root.children.forEach((top, i) => {
    const go = (n, depth) => {
      if (!colourKey(n)) out.set(n.id, String(by === 'depth' ? ((depth - 1) % 6) + 1 : (i % 6) + 1));
      n.children.forEach((c) => go(c, depth + 1));
    };
    go(top, 1);
  });
  return out;
}

/** Where a node is pinned: [x, y], or null. */
export function pinOf(n) {
  const p = n && n.attrs ? n.attrs.pin : null;
  return Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && isFinite(v)) ? p : null;
}

/**
 * The nodes shown under one: its children — or, folded, only the master
 * nodes below it, which stay out of folds with what hangs from them.
 */
export function visibleChildren(n) {
  if (!(n.attrs && n.attrs.fold)) return n.children;
  const out = [];
  const find = (x) => x.children.forEach((c) => (c.attrs && c.attrs.master ? out.push(c) : find(c)));
  find(n);
  return out;
}

/** The nodes shown: the root's tree, but not what's folded away — each with the shown node it hangs from. */
export function shownNodes(model) {
  const out = [];
  const go = (n, depth, parent) => {
    out.push({ node: n, depth, parent });
    visibleChildren(n).forEach((c) => go(c, depth + 1, n));
  };
  if (model.root) go(model.root, 0, null);
  return out;
}

/**
 * Where everything goes: Map id -> { x, y, width, height, depth, way },
 * and the whole's bounds. `sizeOf(node)` gives a box's size; `mode` the
 * map's layout, one of the tree's. A branch with a layout of its own in
 * the layout block grows its own way, and `way` is the layout that
 * placed each box, for its edge. A node moved by hand takes its branch.
 */
export function layoutScene(model, sizeOf, mode) {
  const way = BRANCH_LAYOUTS.some((b) => b[0] === mode) ? mode : 'right';
  const shown = shownNodes(model);
  const boxes = new Map();
  if (!shown.length) return { boxes, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  // Laid out as the canvas's cards are, set out first in the list's order so the layout keeps it.
  const axes = sideAxes(way === 'left' || way === 'top' ? way : way === 'bottom' ? 'bottom' : 'right');
  const nodes = [];
  const edges = [];
  let order = 0;
  shown.forEach(({ node, depth, parent }) => {
    const size = sizeOf(node);
    const rec = { id: node.id, type: 'text', x: 0, y: 0, width: size.width, height: size.height };
    if (depth > 0) {
      rec[axes.depth] = (axes.forward ? 1 : -1) * depth * 1000;
      rec[axes.across] = order++ * 1000;
      edges.push({ id: `e-${node.id}`, fromNode: parent.id, toNode: node.id });
    }
    nodes.push(rec);
  });
  const cards = modelFromData({ nodes, edges });
  const places = composedLayout(cards, cards.byId.get(model.root.id), way, arrowLinks(cards), (rec) => branchLayoutOf(model, rec.id));
  const wayOf = new Map();
  (places.branches || []).forEach((b) => b.ids.forEach((id) => wayOf.set(id, b.mode)));
  // Hand nudges, from the layout block, on top: each node's and those above it. A pinned node is where it's pinned.
  const off = new Map();
  shown.forEach(({ node, parent }) => {
    const above = parent ? off.get(parent.id) || [0, 0] : [0, 0];
    const pin = node === model.root ? null : pinOf(node);
    if (pin) {
      const spot = places.get(node.id) || { x: 0, y: 0 };
      off.set(node.id, [pin[0] - spot.x, pin[1] - spot.y]);
      return;
    }
    const own = node === model.root ? null : nodeNudge(model, node.id);
    off.set(node.id, own ? [above[0] + own[0], above[1] + own[1]] : above);
  });
  const depthOf = new Map(shown.map((s) => [s.node.id, s.depth]));
  cards.nodes.forEach((r) => {
    const at = r.id === model.root.id ? { x: 0, y: 0 } : places.get(r.id) || { x: r.x, y: r.y };
    const d = off.get(r.id) || [0, 0];
    boxes.set(r.id, { x: at.x + d[0], y: at.y + d[1], width: r.width, height: r.height, depth: depthOf.get(r.id) || 0, way: wayOf.get(r.id) || way });
  });
  let bounds = boundsOfBoxes(boxes.values());
  // Free nodes: in a row under the tree.
  let x = bounds.minX;
  const y = bounds.maxY + 80;
  (model.free || []).forEach((n) => {
    const size = sizeOf(n);
    const pin = pinOf(n);
    const d = nodeNudge(model, n.id) || [0, 0];
    boxes.set(n.id, pin ? { x: pin[0], y: pin[1], width: size.width, height: size.height, depth: 0, free: true, way } : { x: x + d[0], y: y + d[1], width: size.width, height: size.height, depth: 0, free: true, way });
    x += size.width + 30;
  });
  bounds = boundsOfBoxes(boxes.values());
  return { boxes, bounds };
}

/** The box round some boxes. */
export function boundsOfBoxes(boxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

/** What a view of a given size shows, at a pan and zoom: a box on the plane. */
export function viewBox(camera, width, height, margin = 0) {
  const w = width / camera.zoom;
  const h = height / camera.zoom;
  return { minX: camera.x - w / 2 - margin, minY: camera.y - h / 2 - margin, maxX: camera.x + w / 2 + margin, maxY: camera.y + h / 2 + margin };
}

/** Whether a box meets another. */
export function meets(b, view) {
  return b.x < view.maxX && b.x + b.width > view.minX && b.y < view.maxY && b.y + b.height > view.minY;
}

/** The camera that shows a box whole, at no more than full size. */
export function fitCamera(bounds, width, height, pad = 60) {
  const w = Math.max(1, bounds.maxX - bounds.minX + pad * 2);
  const h = Math.max(1, bounds.maxY - bounds.minY + pad * 2);
  const zoom = Math.min(1, width / w, height / h);
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom: Math.max(0.1, zoom) };
}

/** A point on screen, relative to the view's corner, as a point on the plane. */
export function screenToPlane(camera, width, height, sx, sy) {
  return { x: camera.x + (sx - width / 2) / camera.zoom, y: camera.y + (sy - height / 2) / camera.zoom };
}

/** The way an edge leaves its parent's box and enters its child's, as an SVG path; `shape` straight or with square corners if asked. */
export function edgePath(from, to, mode, shape) {
  if (shape === 'straight' || shape === 'elbow') {
    const right = to.x + to.width / 2 >= from.x + from.width / 2;
    const x1 = right ? from.x + from.width : from.x;
    const y1 = from.y + from.height / 2;
    const x2 = right ? to.x : to.x + to.width;
    const y2 = to.y + to.height / 2;
    if (shape === 'straight') return `M ${x1} ${y1} L ${x2} ${y2}`;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`;
  }
  const vertical = mode === 'bottom' || mode === 'top' || mode === 'outline';
  if (mode === 'outline') {
    const x = from.x + 16;
    const y1 = from.y + from.height;
    const y2 = to.y + to.height / 2;
    return `M ${x} ${y1} L ${x} ${y2} L ${to.x} ${y2}`;
  }
  if (vertical) {
    const down = to.y > from.y;
    const x1 = from.x + from.width / 2;
    const y1 = down ? from.y + from.height : from.y;
    const x2 = to.x + to.width / 2;
    const y2 = down ? to.y : to.y + to.height;
    const my = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
  }
  const right = to.x + to.width / 2 >= from.x + from.width / 2;
  const x1 = right ? from.x + from.width : from.x;
  const y1 = from.y + from.height / 2;
  const x2 = right ? to.x : to.x + to.width;
  const y2 = to.y + to.height / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}
