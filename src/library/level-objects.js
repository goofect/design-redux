/* ------------------------------------------------------------------ */
/* Objects: a folder's folders and notes as glyphs in a grid           */
/* ------------------------------------------------------------------ */

import { TFolder } from 'obsidian';
import { counted } from '../core/text.js';
import { cell, grid } from '../ui/cell.js';
import { sectionTitle } from '../ui/row.js';
import { sayso } from '../ui/state.js';
import { folderCover, folderGlyphs, noteCover } from './faces.js';
import { pins, listedNotes } from './order.js';

/** The folders of `folder` that are shown: empty ones left out when that is the setting. */
export function shownFolders(plugin, folder) {
  const all = plugin.index.subfolders(folder);
  return plugin.settings.hideEmptyFolders ? all.filter((f) => plugin.index.count(f) > 0 || plugin.index.subfolders(f).length > 0 || plugin.selection.is(f)) : all;
}

function cells(screen, host, entries, faces) {
  const plugin = screen.plugin;
  const open = screen.openFile();
  const g = grid(host, { wide: screen.opts.wide, labelled: !!plugin.settings.alwaysShowLabels });
  entries.forEach((entry) => {
    const isFolder = entry instanceof TFolder;
    const n = isFolder ? plugin.index.count(entry) : null;
    cell(g, {
      glyph: isFolder ? faces[entry.path] : 'note',
      cover: isFolder ? folderCover(plugin, entry) : noteCover(plugin, entry),
      name: isFolder ? entry.name : entry.basename,
      count: n,
      counted: isFolder ? counted(n, 'note') : null,
      path: entry.path,
      tone: isFolder && plugin.toneOf ? plugin.toneOf(entry) : null,
      selected: plugin.selection.is(entry),
      current: isFolder ? !!plugin.openFolder && plugin.openFolder.path === entry.path : open === entry ? 'page' : false,
      pick: () => screen.pick(entry),
      open: (e) => (isFolder ? screen.go(entry) : screen.openNote(entry, e)),
    });
  });
  screen.roving(g, '.dr-cell', () => {
    const cols = typeof getComputedStyle === 'function' ? getComputedStyle(g).gridTemplateColumns : '';
    return cols && cols !== 'none' ? cols.split(' ').length : 3;
  });
  return g;
}

export function drawObjects(screen, host, folder) {
  const plugin = screen.plugin;
  const folders = shownFolders(plugin, folder);
  const notes = listedNotes(plugin, folder);
  const pinned = folder.path === '/' ? pins(plugin) : [];
  if (pinned.length) {
    sectionTitle(host, { title: 'Pinned' });
    const loose = pinned.filter((p) => p instanceof TFolder);
    cells(screen, host, pinned, folderGlyphs(plugin, loose));
    sectionTitle(host, { title: 'Folders' });
  }
  if (!folders.length && !notes.length) {
    return void sayso(host, { label: folder.path === '/' ? 'Nothing in the vault yet' : 'Nothing in this folder yet', button: { text: 'New note', run: () => plugin.files.newNote(folder) } });
  }
  cells(screen, host, folders.concat(notes), folderGlyphs(plugin, folders));
}
