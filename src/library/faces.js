/* ------------------------------------------------------------------ */
/* Faces: a folder's or a note's cover image, where the person set one */
/*                                                                     */
/* An image set for the folder, or named by its folder note's (or a    */
/* note's) cover property. Where there is none, a folder is its name.  */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { linkTarget } from '../core/notes.js';

/** An image file's address for an <img>, or null. */
function resource(plugin, path, from) {
  if (!path) return null;
  const vault = plugin.app.vault;
  const file = vault.getFileByPath(path) || plugin.app.metadataCache.getFirstLinkpathDest(path, from || '');
  return file instanceof TFile && typeof vault.getResourcePath === 'function' ? vault.getResourcePath(file) : file instanceof TFile ? file.path : null;
}

/** A folder's own cover image, if the person set one: by its path, or by its folder note's cover property. */
export function folderCover(plugin, folder) {
  const set = (plugin.settings.folderCovers || {})[folder.path];
  if (set) return resource(plugin, set);
  const note = plugin.files.folderNote(folder);
  return note ? noteCover(plugin, note) : null;
}

/** A note's cover image, from its cover property. */
export function noteCover(plugin, file) {
  const value = plugin.notes.get(file, plugin.settings.coverProperty || 'cover');
  if (!value) return null;
  const first = Array.isArray(value) ? value[0] : value;
  return resource(plugin, linkTarget(first) || String(first), file.path);
}
