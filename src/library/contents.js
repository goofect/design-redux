/* ------------------------------------------------------------------ */
/* What a place in the library holds, drawn the one way it is drawn    */
/*                                                                     */
/* The vault's top: its folders' names as rows (pinned ones first),    */
/* its loose notes after them; at the window's width, its folders as a */
/* grid of names set large, or the cover images the person set. A      */
/* folder's page: its name large, then its folders and notes as rows.  */
/* No levels, no glyphs, no counts, no numbers.                        */
/* ------------------------------------------------------------------ */

import { TFolder } from 'obsidian';
import { el } from '../core/dom.js';
import { cell, grid } from '../ui/cell.js';
import { row, rows, sectionTitle } from '../ui/row.js';
import { sayso } from '../ui/state.js';
import { folderCover } from './faces.js';
import { listedNotes, pins } from './order.js';

/** The folders of `folder` that are shown: empty ones left out when that is the setting. */
export function shownFolders(plugin, folder) {
  const all = plugin.index.subfolders(folder);
  return plugin.settings.hideEmptyFolders ? all.filter((f) => plugin.index.count(f) > 0 || plugin.index.subfolders(f).length > 0 || plugin.selection.is(f)) : all;
}

/** Is this folder or note open (in the page, or as the folder shown) or picked? Either way it is inverted. */
function marks(screen, entry) {
  const plugin = screen.plugin;
  const open = entry instanceof TFolder ? !!plugin.openFolder && plugin.openFolder.path === entry.path : screen.openFile() === entry;
  return { current: open ? (entry instanceof TFolder ? 'true' : 'page') : false, selected: !open && plugin.selection.is(entry) };
}

/** Rows for some folders and notes: a folder pressed is gone into, a note opened. */
function entryRows(screen, host, entries) {
  const list = rows(host);
  entries.forEach((entry) => {
    const isFolder = entry instanceof TFolder;
    row(list, Object.assign({ name: isFolder ? entry.name : entry.basename, path: entry.path, run: (e) => (isFolder ? screen.go(entry) : screen.openNote(entry, e)) }, marks(screen, entry)));
  });
  screen.roving(list, '.dr-row', () => 1);
  return list;
}

/** What a folder holds, as rows: its folders, then its notes. At the vault's top, pinned ones first, under their own word. */
export function contentRows(screen, host, folder) {
  const plugin = screen.plugin;
  const folders = shownFolders(plugin, folder);
  const notes = listedNotes(plugin, folder);
  const pinned = folder.path === '/' ? pins(plugin) : [];
  if (!folders.length && !notes.length && !pinned.length) {
    return void sayso(host, { label: folder.path === '/' ? 'Nothing in the vault yet.' : 'Nothing in this folder yet.', button: { text: 'New note', run: () => plugin.files.newNote(folder) } });
  }
  if (pinned.length) {
    sectionTitle(host, { title: 'Pinned' });
    entryRows(screen, host, pinned);
    sectionTitle(host, { title: 'Folders' });
  }
  return entryRows(screen, host, folders.concat(notes));
}

/** A folder's page: its name at the display size, left, then what it holds. */
export function drawFolderPage(screen, host, folder) {
  el(host, 'div', 'dr-display dr-folder-name', folder.name);
  return contentRows(screen, host, folder);
}

/** At the window's width: a folder's folders as a grid, each its name set large, or the cover image the person set; nothing else in a cell. */
export function drawGrid(screen, host, folder) {
  const plugin = screen.plugin;
  const folders = shownFolders(plugin, folder);
  if (!folders.length) return contentRows(screen, host, folder);
  const g = grid(host, { label: 'Folders' });
  folders.forEach((f) => cell(g, Object.assign({ name: f.name, cover: folderCover(plugin, f), path: f.path, open: () => screen.go(f) }, marks(screen, f))));
  screen.roving(g, '.dr-cell', () => {
    const cols = typeof getComputedStyle === 'function' ? getComputedStyle(g).gridTemplateColumns : '';
    return cols && cols !== 'none' ? cols.split(' ').length : 1;
  });
  return g;
}
