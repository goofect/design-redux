/* ------------------------------------------------------------------ */
/* Order: how a folder's notes and folders are sorted, and pins        */
/*                                                                     */
/* A folder's notes come by name, by date, or in the person's own      */
/* order (kept by the folder's path as a list of file names; a note    */
/* not on the list goes after those that are). The order chosen in a   */
/* folder is remembered for it.                                        */
/* ------------------------------------------------------------------ */

import { byName } from '../core/text.js';
import { featuredNotes } from './featured.js';

export const SORTS = { name: 'Name', modified: 'Last edited', created: 'Date made', own: 'Your order' };

/** The order a folder's notes are shown in: its own if one was chosen there, else the default. */
export function sortOf(plugin, folder) {
  const s = plugin.settings;
  const own = folder ? (s.albumSorts || {})[folder.path] : null;
  const chosen = own && typeof own === 'object' ? own.by : own;
  return chosen in SORTS ? chosen : s.defaultSort in SORTS ? s.defaultSort : 'name';
}

/** Chooses the order for a folder. */
export async function setSort(plugin, folder, by) {
  const s = plugin.settings;
  if (folder) (s.albumSorts || (s.albumSorts = {}))[folder.path] = by;
  else s.defaultSort = by;
  await plugin.saveSettings();
}

/** A folder's notes in the order it shows them. */
export function sortedNotes(plugin, folder) {
  const notes = plugin.index.notes(folder).slice();
  const by = sortOf(plugin, folder);
  if (by === 'modified') return notes.sort((a, b) => b.stat.mtime - a.stat.mtime || byName(a.basename, b.basename));
  if (by === 'created') return notes.sort((a, b) => b.stat.ctime - a.stat.ctime || byName(a.basename, b.basename));
  if (by === 'own') {
    const saved = (plugin.settings.albumOrders || {})[folder ? folder.path : '/'];
    const names = saved && Array.isArray(saved.names) ? saved.names : [];
    const place = (f) => { const i = names.indexOf(f.name); return i < 0 ? names.length : i; };
    return notes.sort((a, b) => place(a) - place(b) || byName(a.basename, b.basename));
  }
  return notes;
}

/** The pinned files and folders that still exist, in the person's order. */
export function pins(plugin) {
  const list = Array.isArray(plugin.settings.pinOrder) ? plugin.settings.pinOrder : [];
  return list.map((p) => plugin.app.vault.getAbstractFileByPath(p)).filter(Boolean);
}

export const isPinned = (plugin, entry) => (plugin.settings.pinOrder || []).includes(entry.path);

/** Pins or unpins a file or folder: a pin puts it first in its own folder, nowhere else. */
export async function togglePin(plugin, entry) {
  const list = (plugin.settings.pinOrder || []).slice();
  const at = list.indexOf(entry.path);
  if (at < 0) list.push(entry.path);
  else list.splice(at, 1);
  plugin.settings.pinOrder = list;
  await plugin.saveSettings();
  return at < 0;
}

/** The notes before and after a note in its folder, in the folder's order: [previous, next]. */
export function neighbours(plugin, file) {
  const list = file.parent ? sortedNotes(plugin, file.parent) : [];
  const at = list.indexOf(file);
  return at < 0 ? [null, null] : [list[at - 1] || null, list[at + 1] || null];
}

/** What a folder lists: only the notes directly in it, those it starts with first, then the rest in its order. */
export function listedNotes(plugin, folder) {
  const own = sortedNotes(plugin, folder);
  const first = featuredNotes(plugin, folder).filter((f) => own.includes(f));
  return first.concat(own.filter((f) => !first.includes(f)));
}
