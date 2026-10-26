/* ------------------------------------------------------------------ */

/* Selection                                                          */
/*                                                                    */
/* What's picked — a note, an album, a card on a canvas — apart from  */
/* what's open, so it can be looked at without being opened. One for */
/* the whole plugin, on `plugin.selection`.                           */
/* ------------------------------------------------------------------ */

import { INSPECTOR_VIEW } from './020-constants.js';

export class Selection {
  constructor(plugin) {
    this.plugin = plugin;
    this.item = null;
    this.listeners = new Set();
  }

  /** Told of every change, with the new item; returns a function to stop. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** { file } | { folder } | { card } | null. */
  get() {
    return this.item;
  }

  set(item) {
    const next = item && (item.file || item.folder || item.card) ? item : null;
    const now = this.item;
    if (now === next || (now && next && now.file === next.file && now.folder === next.folder && now.card === next.card)) return;
    this.item = next;
    this.listeners.forEach((fn) => {
      try {
        fn(next);
      } catch (err) {
        console.error('Design Redux: a selection listener failed', err);
      }
    });
  }

  clear() {
    this.set(null);
  }

  /** Whether `target` — a file or a folder — is what's picked. */
  holds(target) {
    const item = this.item;
    return !!item && !!target && (item.file === target || item.folder === target);
  }

  /** A deleted note or album is no longer picked. Renamed, it still is: the same file. */
  followDelete(file) {
    if (this.holds(file)) this.clear();
  }
}

/**
 * Whether the inspector — the note panel docked in the right sidebar —
 * is in sight: open, its tab the one shown, the sidebar not folded.
 */
export function inspectorShowing(app) {
  const ws = app && app.workspace;
  if (!ws || typeof ws.getLeavesOfType !== 'function') return false;
  const leaf = ws.getLeavesOfType(INSPECTOR_VIEW)[0];
  const el = leaf && leaf.view ? leaf.view.containerEl : null;
  if (!el || !el.isConnected) return false;
  const split = ws.rightSplit;
  if (split && split.collapsed && typeof leaf.getRoot === 'function' && leaf.getRoot() === split) return false;
  return typeof el.isShown !== 'function' || el.isShown();
}

/** The inspector in the right sidebar, opened there if it isn't, and shown. */
export async function openInspector(app) {
  const ws = app.workspace;
  let leaf = ws.getLeavesOfType(INSPECTOR_VIEW)[0];
  if (!leaf) {
    leaf = ws.getRightLeaf(false);
    if (!leaf) return null;
    await leaf.setViewState({ type: INSPECTOR_VIEW, active: false });
  }
  ws.revealLeaf(leaf);
  return leaf;
}

/** The inspector's tab closed: the note panel floats again. */
export function closeInspector(app) {
  app.workspace.getLeavesOfType(INSPECTOR_VIEW).forEach((leaf) => leaf.detach());
}
