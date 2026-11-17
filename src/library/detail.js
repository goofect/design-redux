/* ------------------------------------------------------------------ */
/* A folder picked: its glyph large, its name and counts, what can be  */
/* done, then its notes                                                */
/* (docs/DESIGN.md, "A folder picked"). Drawn in the panel beside the  */
/* library and as the browse view's preview.                           */
/* ------------------------------------------------------------------ */

import { counted, readingMinutes } from '../core/text.js';
import { el, glyph } from '../core/dom.js';
import { iconButton, textButton } from '../ui/button.js';
import { row, rows } from '../ui/row.js';
import { rove } from '../ui/keys.js';
import { folderCover, folderGlyph } from './faces.js';
import { folderMenu, showMenu } from './menus.js';
import { isPinned, listedNotes, sortOf, togglePin } from './order.js';

/**
 * `hooks`: { open(folder): show it in the page, note(file, event): open a note }.
 * Returns the element.
 */
export function drawDetail(plugin, host, folder, hooks = {}) {
  const node = el(host, 'div', 'dr-detail-view');
  const top = el(node, 'div', 'dr-detail');
  const cover = folderCover(plugin, folder);
  if (cover) {
    const img = el(top, 'img', 'dr-detail-cover');
    img.alt = '';
    img.src = cover;
  } else glyph(top, folderGlyph(plugin, folder));
  el(top, 'span', 'dr-detail-name dr-text dr-clip', folder.name);
  const counts = el(top, 'span', 'dr-detail-counts dr-small');
  const notes = listedNotes(plugin, folder);
  const subs = plugin.index.subfolders(folder);
  el(counts, 'span', '', counted(plugin.index.count(folder), 'note'));
  if (subs.length) el(counts, 'span', '', counted(subs.length, 'folder'));
  const about = plugin.describe ? plugin.describe(folder) : null;
  if (about) el(top, 'p', 'dr-detail-about dr-text is-running', about);
  // Here words earn their place: what can be done with a folder said in words, and the rest under More.
  const actions = el(top, 'div', 'dr-detail-actions');
  if (hooks.open) textButton(actions, { text: 'Open', run: () => hooks.open(folder) });
  textButton(actions, { text: 'New note', run: () => plugin.files.newNote(folder) });
  const pin = textButton(actions, { text: isPinned(plugin, folder) ? 'Unpin' : 'Pin', run: async () => { pin.firstChild.textContent = (await togglePin(plugin, folder)) ? 'Unpin' : 'Pin'; } });
  iconButton(actions, { glyph: 'more', label: 'More', run: (e) => showMenu(folderMenu(plugin, folder, null), e) });
  const open = plugin.app.workspace.getActiveFile();
  const list = rows(node);
  const own = sortOf(plugin, folder) === 'own';
  notes.forEach((note, i) => row(list, { number: own ? i + 1 : null, name: note.basename, end: `${readingMinutes(plugin.index.words(note))} min`, path: note.path, current: note === open ? 'page' : false, run: (e) => hooks.note && hooks.note(note, e) }));
  if (notes.length) rove(list, '.dr-row', { jump: true });
  return node;
}
