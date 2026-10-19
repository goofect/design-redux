/* ------------------------------------------------------------------ */
/* Tree: the layout block                                              */
/*                                                                    */
/* What the layout can't work out for itself sits in the map's layout  */
/* block, by node id: how far a node was moved by hand from its spot   */
/* (its branch comes along), and a branch that grows its own way. A    */
/* node named there gets its ^id, so the name holds when the file's     */
/* read again. Each change here is a patch like any other.            */
/* ------------------------------------------------------------------ */

import { nodeById, walk } from './400-tree-model.js';
import { MAP_LAYOUTS } from './403-tree-layouts.js';
import { applyPatch } from './404-tree-ops.js';

const copyBlock = (model) => JSON.parse(JSON.stringify(model.layout || { v: 1 }));

/** The block with nothing left in a part dropped, or null if nothing's left at all. */
function tidyBlock(block) {
  ['nudge', 'branch', 'legend', 'views'].forEach((k) => {
    if (block[k] && !Object.keys(block[k]).length) delete block[k];
  });
  return Object.keys(block).some((k) => k !== 'v') ? block : null;
}

/** A change to the block, with the nodes it names given their ids: a patch, or null if nothing changed. */
function changeBlock(model, ids, change, selection) {
  const block = copyBlock(model);
  change(block);
  const next = tidyBlock(block);
  if (JSON.stringify(next) === JSON.stringify(model.layout || null)) return null;
  const ops = [];
  ids.forEach((id) => {
    const n = nodeById(model, id);
    if (n && !n.anchor && n !== model.root) ops.push({ type: 'anchor', id, on: true });
  });
  ops.push({ type: 'layout', layout: next });
  return applyPatch(model, ops, selection || []);
}

/** How far a node was moved by hand: [dx, dy], or null. */
export function nodeNudge(model, id) {
  const d = model.layout && model.layout.nudge && model.layout.nudge[id];
  return Array.isArray(d) && d.length === 2 && d.every((v) => typeof v === 'number') ? d : null;
}

/** A branch's own layout, or null. */
export function branchLayoutOf(model, id) {
  const mode = model.layout && model.layout.branch && model.layout.branch[id];
  return MAP_LAYOUTS.some((b) => b[0] === mode) ? mode : null;
}

/** A node moved by hand to this far from its spot; 0, 0 puts it back. */
export function setNudge(model, id, dx, dy) {
  if (!nodeById(model, id)) return null;
  const d = [Math.round(dx), Math.round(dy)];
  const off = !d[0] && !d[1];
  return changeBlock(
    model,
    off ? [] : [id],
    (block) => {
      block.nudge = block.nudge || {};
      if (off) delete block.nudge[id];
      else block.nudge[id] = d;
    },
    [id]
  );
}

/** Nodes back where the layout puts them: those of a branch, or every one. */
export function clearNudges(model, branchId) {
  const ids = new Set();
  if (branchId) {
    const n = nodeById(model, branchId);
    if (!n) return null;
    walk({ root: n, free: [] }, (x) => ids.add(x.id));
  }
  return changeBlock(model, [], (block) => {
    if (!block.nudge) return;
    Object.keys(block.nudge).forEach((id) => {
      if (!branchId || ids.has(id)) delete block.nudge[id];
    });
  }, branchId ? [branchId] : []);
}

/** A node's children back in line, as the layout puts them: their own nudges let go, what's below them left be. */
export function lineUpChildren(model, id) {
  const n = nodeById(model, id);
  if (!n || !n.children.length) return null;
  const kids = new Set(n.children.map((c) => c.id));
  return changeBlock(model, [], (block) => {
    if (block.nudge) Object.keys(block.nudge).forEach((k) => kids.has(k) && delete block.nudge[k]);
  }, [id]);
}

/**
 * A branch laid out its own way — or, for the root, the whole map. No
 * mode, for a branch, has it grow as the branch above it does.
 */
export function setBranchLayout(model, id, mode) {
  const n = nodeById(model, id);
  if (!n) return null;
  const valid = MAP_LAYOUTS.some((b) => b[0] === mode) ? mode : null;
  if (n === model.root) {
    if ((model.mode || null) === valid) return null;
    return applyPatch(model, [{ type: 'mode', mode: valid }], [id]);
  }
  return changeBlock(
    model,
    valid ? [id] : [],
    (block) => {
      block.branch = block.branch || {};
      if (valid) block.branch[id] = valid;
      else delete block.branch[id];
    },
    [id]
  );
}

/** The whole map laid out one way: its own layouts for branches let go. */
export function setMapLayout(model, mode) {
  const valid = MAP_LAYOUTS.some((b) => b[0] === mode) ? mode : null;
  const block = copyBlock(model);
  delete block.branch;
  const next = tidyBlock(block);
  const ops = [];
  if ((model.mode || null) !== valid) ops.push({ type: 'mode', mode: valid });
  if (JSON.stringify(next) !== JSON.stringify(model.layout || null)) ops.push({ type: 'layout', layout: next });
  return ops.length ? applyPatch(model, ops, model.root ? [model.root.id] : []) : null;
}

/** What a colour means on this map, as its legend names it, or null. */
export function legendName(model, key) {
  const name = model.layout && model.layout.legend && model.layout.legend[key];
  return typeof name === 'string' && name ? name : null;
}

/** A colour named in the map's legend; no name takes it out. */
export function setLegendName(model, key, name) {
  const value = String(name || '').trim();
  return changeBlock(model, [], (block) => {
    block.legend = block.legend || {};
    if (value) block.legend[key] = value;
    else delete block.legend[key];
  });
}

/** The map's saved views: name -> { id, zoom }. */
export function savedViews(model) {
  const views = (model.layout && model.layout.views) || {};
  const out = {};
  Object.keys(views).forEach((name) => {
    const v = views[name];
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number') out[name] = { id: v[0], zoom: v[1] };
  });
  return out;
}

/** A view kept by name — a node to look at and how near — or, with no node, let go. */
export function setSavedView(model, name, id, zoom) {
  const key = String(name || '').trim();
  if (!key) return null;
  return changeBlock(model, id ? [id] : [], (block) => {
    block.views = block.views || {};
    if (id) block.views[key] = [id, Math.round(zoom * 100) / 100];
    else delete block.views[key];
  });
}

/* The ways a map can be shown besides as a map: kept in the layout block's view. */
export const MAP_VIEWS = ['outline', 'kanban', 'kanban-tag', 'timeline', 'table'];

/** How the map is shown, as kept: one of MAP_VIEWS, or null for the map itself. */
export function mapViewOf(model) {
  const v = model.layout && model.layout.view;
  return MAP_VIEWS.includes(v) ? v : null;
}

/** The map shown another way, or as itself (null). */
export function setMapView(model, view) {
  return changeBlock(model, [], (block) => {
    if (MAP_VIEWS.includes(view)) block.view = view;
    else delete block.view;
  });
}

/* A node's shapes: its own, or its map's theme's for its level. */
export const NODE_SHAPES = ['box', 'pill', 'underline', 'plain'];

/* A map's themes: a shape for the root, the root's children, and the rest. */
export const MAP_THEMES = {
  cards: { name: 'Cards', R: 'box', 1: 'box', 0: 'box' },
  soft: { name: 'Soft', R: 'pill', 1: 'pill', 0: 'pill' },
  lines: { name: 'Lines', R: 'box', 1: 'underline', 0: 'underline' },
  quiet: { name: 'Quiet', R: 'pill', 1: 'underline', 0: 'plain' },
};

/** A map's own theme, or null. */
export function mapThemeOf(model) {
  const t = model.layout && model.layout.theme;
  return Object.prototype.hasOwnProperty.call(MAP_THEMES, t) ? t : null;
}

/** The map given a theme of its own, or none (null). */
export function setMapTheme(model, theme) {
  return changeBlock(model, [], (block) => {
    if (Object.prototype.hasOwnProperty.call(MAP_THEMES, theme)) block.theme = theme;
    else delete block.theme;
  });
}

/** The shape a node takes: its own, else its theme's for its level. */
export function nodeShape(model, n, theme) {
  const own = n.attrs && n.attrs.shape;
  if (NODE_SHAPES.includes(own)) return own;
  const t = MAP_THEMES[theme] || MAP_THEMES.cards;
  return n === model.root ? t.R : n.parent === model.root ? t[1] : t[0];
}

/** The collection a map follows, as kept: { path, leftOut: [paths] }, or null. */
export function albumEntry(model) {
  const a = model.layout && model.layout.album;
  return a && typeof a.path === 'string' ? { path: a.path, leftOut: Array.isArray(a.leftOut) ? a.leftOut.slice() : [] } : null;
}

/** The ops that keep a map's collection entry as given — or, given null, none. */
export function albumEntryOps(model, entry) {
  const block = copyBlock(model);
  if (entry) block.album = entry.leftOut && entry.leftOut.length ? { path: entry.path, leftOut: entry.leftOut } : { path: entry.path };
  else delete block.album;
  const next = tidyBlock(block);
  return JSON.stringify(next) === JSON.stringify(model.layout || null) ? [] : [{ type: 'layout', layout: next }];
}
