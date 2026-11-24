/* ------------------------------------------------------------------ */
/* The notes a folder starts with                                      */
/*                                                                     */
/* A folder can name the notes to start with, which come first in its  */
/* list: its folder note's `featured` property, or what the plugin     */
/* kept for the folder's path before (settings.albums). Read only:     */
/* nothing is written into a note.                                     */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { linkTarget, noteProps, propOf, valuesOf } from '../core/notes.js';

/** The notes a folder names to start with, that still exist, once each. */
export function featuredNotes(plugin, folder) {
  if (!folder || folder.path === '/') return [];
  const { app } = plugin;
  const kept = (plugin.settings.albums || {})[folder.path];
  const note = kept ? null : plugin.files.folderNote(folder);
  const fromNote = (v) => {
    const file = app.metadataCache.getFirstLinkpathDest(linkTarget(v) || v, note.path);
    return file ? file.path : v;
  };
  const paths = kept ? (Array.isArray(kept.featured) ? kept.featured : []) : note ? valuesOf(propOf(noteProps(app, note), 'featured')).map(fromNote) : [];
  const files = paths.map((p) => app.vault.getAbstractFileByPath(p) || app.vault.getAbstractFileByPath(`${p}.md`));
  return files.filter((f, i) => f instanceof TFile && files.indexOf(f) === i);
}
