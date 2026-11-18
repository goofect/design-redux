/* ------------------------------------------------------------------ */
/* What a place in the library holds, drawn the one way it is drawn    */
/*                                                                     */
/* A folder's page, the vault's top among them: the path to it as     */
/* boxed words, then its notes as ruled rows, pinned ones first at the */
/* top. Its folders are in the sidebar's tree. One view of a           */
/* collection: no grid, no covers, no glyphs, counts or numbers.       */
/* ------------------------------------------------------------------ */

import { TFolder } from 'obsidian';
import { asButton, el } from '../core/dom.js';
import { row, rows } from '../ui/row.js';
import { sayso } from '../ui/state.js';
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

/** Pinned ones first, in the person's order, at the vault's top; elsewhere the list as it is. */
export function pinnedFirst(plugin, folder, list) {
  if (folder.path !== '/') return list;
  const pinned = pins(plugin).map((e) => e.path);
  const at = (e) => pinned.indexOf(e.path);
  return list.filter((e) => at(e) >= 0).sort((x, y) => at(x) - at(y)).concat(list.filter((e) => at(e) < 0));
}

/**
 * Names a region for a screen reader without an aria-label: Obsidian draws a
 * tooltip for every aria-label under the pointer. The name is unseen text the
 * region points at instead.
 */
let named = 0;
export function nameRegion(node, text) {
  const label = el(node, 'span', 'dr-unseen', text);
  label.id = `dr-region-name-${++named}`;
  node.setAttribute('aria-labelledby', label.id);
  return node;
}

/** The path to a folder as boxed words, "Vault / Politics": each goes there; the last is where you are. */
export function crumbs(screen, host, folder) {
  const nav = el(host, 'nav', 'dr-crumbs');
  nameRegion(nav, 'Path');
  const chain = [];
  for (let f = folder; f && f.path !== '/'; f = f.parent) chain.unshift(f);
  [null].concat(chain).forEach((f, i) => {
    if (i) el(nav, 'span', 'dr-muted', '/');
    const crumb = asButton(el(nav, 'span', 'dr-crumb', f ? f.name : 'Vault'), null, () => screen.go(f));
    if (i === chain.length) crumb.setAttribute('aria-current', 'location');
  });
  return nav;
}

/** A folder's page: the path to it, then its notes as ruled rows. */
export function drawFolderPage(screen, host, folder) {
  crumbs(screen, host, folder);
  const notes = pinnedFirst(screen.plugin, folder, listedNotes(screen.plugin, folder));
  if (!notes.length) return void sayso(host, { label: folder.path === '/' ? 'No notes at the top of the vault.' : 'No notes in this folder.', button: { text: 'New note', run: () => screen.plugin.files.newNote(folder) } });
  return entryRows(screen, host, notes);
}
