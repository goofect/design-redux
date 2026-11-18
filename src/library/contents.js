/* ------------------------------------------------------------------ */
/* What a place in the library holds, drawn the one way it is drawn    */
/*                                                                     */
/* A folder's page (the vault's own is empty): the path to it as      */
/* boxed words, then its notes as ruled rows, pinned ones first. Its   */
/* folders are in the sidebar's tree. One view of a                    */
/* collection: no grid, no covers, no glyphs, counts or numbers.       */
/* ------------------------------------------------------------------ */

import { asButton, el } from '../core/dom.js';
import { row, rows } from '../ui/row.js';
import { sayso } from '../ui/state.js';
import { listedNotes, pins } from './order.js';

/** The folders of `folder` that are shown: empty ones left out when that is the setting. */
export function shownFolders(plugin, folder) {
  const all = plugin.index.subfolders(folder);
  return plugin.settings.hideEmptyFolders ? all.filter((f) => plugin.index.count(f) > 0 || plugin.index.subfolders(f).length > 0 || plugin.selection.is(f)) : all;
}

/** A note's rows, ruled: one pressed opens; the one open is marked, and so is the one picked. */
function noteRows(screen, host, notes) {
  const list = rows(host);
  notes.forEach((note) => {
    const open = screen.openFile() === note;
    row(list, { name: note.basename, path: note.path, run: (e) => screen.openNote(note, e), current: open ? 'page' : false, selected: !open && screen.plugin.selection.is(note) });
  });
  screen.roving(list, '.dr-row', () => 1);
  return list;
}

/** A folder's own pinned entries first, in the person's order. A list holds only a folder's own, so a pin counts in its folder alone. */
export function pinnedFirst(plugin, folder, list) {
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
  if (!notes.length) return void sayso(host, { label: 'No notes in this folder.', button: { text: 'New note', run: () => screen.plugin.files.newNote(folder) } });
  return noteRows(screen, host, notes);
}
