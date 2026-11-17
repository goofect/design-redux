/* ------------------------------------------------------------------ */
/* The map: one model, a tree of nodes                                 */
/*                                                                     */
/* Every map the plugin draws is this: nodes with children, some       */
/* folded. A folder's map is its folders and notes; a note's map is    */
/* the notes that name it as their parent, and theirs. The layout      */
/* (where each node stands) is worked out from the tree alone, in one  */
/* pass, so a map of hundreds of nodes is placed at once and nothing   */
/* overlaps: a node is a box of fixed size, a level is a column.       */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { linkTarget, valuesOf } from '../core/notes.js';

/** In units of the stylesheet's 8px: a node's box, the room between levels and between neighbours. */
export const MAP = { nodeW: 22, nodeH: 4, gapX: 6, gapY: 1 };

let serial = 0;
/** A node: { id, label, path, kind: 'folder' | 'note', children, folded, tone }. */
export function mapNode(label, path, kind, children = []) {
  return { id: `n${++serial}`, label, path, kind, children, folded: false, tone: null };
}

/** A folder as a map: its folders, then its notes, all the way down. Below `open` levels, branches start folded. */
export function folderMap(plugin, folder, open = 2) {
  const build = (f, depth) => {
    const node = mapNode(f.path === '/' ? plugin.app.vault.getName ? plugin.app.vault.getName() : 'Vault' : f.name, f.path, 'folder',
      plugin.index.subfolders(f).map((sub) => build(sub, depth + 1)).concat(plugin.index.notes(f).map((n) => mapNode(n.basename, n.path, 'note'))));
    node.folded = depth >= open && node.children.length > 0;
    node.tone = plugin.toneOf ? plugin.toneOf(f) : null;
    return node;
  };
  return build(folder, 0);
}

/** A note as a map: under it the notes that name it in `key` (their parent), and under each of those, theirs. */
export function noteMap(plugin, file, key = 'parent') {
  const children = new Map();
  plugin.index.markdown().forEach((note) => {
    valuesOf(plugin.notes.get(note, key)).forEach((v) => {
      const parent = plugin.app.metadataCache.getFirstLinkpathDest(linkTarget(v) || v, note.path);
      if (parent instanceof TFile) children.set(parent.path, (children.get(parent.path) || []).concat(note));
    });
  });
  const seen = new Set();
  const build = (note) => {
    seen.add(note.path);
    return mapNode(note.basename, note.path, 'note', (children.get(note.path) || []).filter((c) => !seen.has(c.path)).map(build));
  };
  return build(file);
}

/** Every node that shows: a folded node's children are left out. */
export function shownNodes(root) {
  const out = [];
  const walk = (node, parent, depth) => {
    out.push({ node, parent, depth });
    if (!node.folded) node.children.forEach((c) => walk(c, node, depth + 1));
  };
  walk(root, null, 0);
  return out;
}

/**
 * Where each shown node stands, in units: Map(id → { x, y, node, parent,
 * depth }), and the size of the whole: { w, h }. A level is a column; a
 * leaf takes the next row; a parent stands level with the middle of its
 * children.
 */
export function layoutMap(root) {
  const at = new Map();
  let row = 0;
  let deepest = 0;
  const place = (node, parent, depth) => {
    deepest = Math.max(deepest, depth);
    const kids = node.folded ? [] : node.children;
    let y;
    if (!kids.length) y = row++ * (MAP.nodeH + MAP.gapY);
    else {
      const ys = kids.map((k) => place(k, node, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    at.set(node.id, { x: depth * (MAP.nodeW + MAP.gapX), y, node, parent, depth });
    return y;
  };
  place(root, null, 0);
  return { at, w: (deepest + 1) * (MAP.nodeW + MAP.gapX) - MAP.gapX, h: Math.max(1, row) * (MAP.nodeH + MAP.gapY) - MAP.gapY };
}

/** Folds or unfolds every node that has children; the root stays open. */
export function foldAll(root, folded) {
  const walk = (node, top) => {
    if (node.children.length && !top) node.folded = folded;
    node.children.forEach((c) => walk(c, false));
  };
  walk(root, true);
}
