/* ------------------------------------------------------------------ */
/* Faces: what a folder or a note is shown as                          */
/*                                                                     */
/* A folder is its glyph: the one stored for its path, or the one the  */
/* builder gives it among its siblings, which is then stored, so a     */
/* folder made later never changes another's face. A cover of the      */
/* person's own (an image set for the folder, or named by a note's     */
/* cover property) takes the glyph's place. A note is the sheet.       */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { glyphsAmong, isGlyph } from '../core/glyphs.js';
import { linkTarget } from '../core/notes.js';

/**
 * The glyphs of the folders that share a parent, by path. Any the builder
 * had to choose are stored, and saved a moment later without redrawing.
 */
export function folderGlyphs(plugin, folders) {
  const stored = plugin.settings.folderGlyphs || (plugin.settings.folderGlyphs = {});
  const given = glyphsAmong(folders.map((f) => f.path), stored);
  let fresh = false;
  folders.forEach((f) => {
    if (isGlyph(stored[f.path])) return;
    stored[f.path] = given[f.path];
    fresh = true;
  });
  if (fresh) keepSoon(plugin);
  return given;
}

/** One folder's glyph. */
export function folderGlyph(plugin, folder) {
  const stored = (plugin.settings.folderGlyphs || {})[folder.path];
  if (isGlyph(stored)) return stored;
  const siblings = folder.parent ? plugin.index.subfolders(folder.parent) : [folder];
  return folderGlyphs(plugin, siblings.includes(folder) ? siblings : siblings.concat(folder))[folder.path];
}

/** Sets the glyph the person picked for a folder; `null` hands the choice back to the builder. */
export async function pickGlyph(plugin, folder, name) {
  const stored = plugin.settings.folderGlyphs || (plugin.settings.folderGlyphs = {});
  if (name && isGlyph(name)) stored[folder.path] = name;
  else delete stored[folder.path];
  await plugin.saveSettings();
}

function keepSoon(plugin) {
  if (plugin.keepingGlyphs) return;
  plugin.keepingGlyphs = true;
  Promise.resolve().then(() => {
    plugin.keepingGlyphs = false;
    if (!plugin.unloading) plugin.saveData(plugin.settings);
  });
}

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
