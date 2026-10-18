/* ------------------------------------------------------------------ */
/* Mind map: opening a flagged note as a map                           */
/*                                                                    */
/* A note whose properties say mindmap: true opens in the mind-map     */
/* view instead of as text, the way Excalidraw opens its drawings; a   */
/* .mindmap file opens there by its extension and needs none of this.  */
/* "Open as text" puts a note back, and the tab remembers that for the */
/* note, so the next opening doesn't undo it. The memory is the tab's, */
/* for the session, never a setting.                                  */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { MINDMAP_VIEW } from './421-mindmap-view.js';

/* Tabs asked to show a note as text: tab -> paths. */
const asText = new WeakMap();

/** Whether a note's properties make it a mind map. */
export function isMindMapNote(app, file) {
  if (!(file instanceof TFile) || file.extension !== 'md') return false;
  const cache = app.metadataCache.getFileCache(file);
  const flag = cache && cache.frontmatter ? cache.frontmatter.mindmap : undefined;
  return flag === true || flag === 'true';
}

export function keptAsText(leaf, path) {
  const set = asText.get(leaf);
  return !!set && set.has(path);
}

export function keepAsText(leaf, path, on) {
  let set = asText.get(leaf);
  if (!set) {
    set = new Set();
    asText.set(leaf, set);
  }
  if (on) set.add(path);
  else set.delete(path);
}

/** A tab's view swapped for another of the same file, keeping whether it's the tab in use. */
export async function showFileAs(app, leaf, type, file, state) {
  if (!leaf || typeof leaf.setViewState !== 'function' || !file) return false;
  const active = app.workspace.activeLeaf === leaf;
  await leaf.setViewState({ type, state: Object.assign({ file: file.path }, state || {}), active });
  return true;
}

/** Each tab showing a flagged note as text — and not asked to — shown as a map. */
export function takeOverLeaves(app) {
  const out = [];
  app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
    const view = leaf.isDeferred ? null : leaf.view;
    const file = view && view.file;
    if (!file || !isMindMapNote(app, file) || keptAsText(leaf, file.path)) return;
    out.push(showFileAs(app, leaf, MINDMAP_VIEW, file));
  });
  return Promise.all(out);
}
