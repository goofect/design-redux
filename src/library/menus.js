/* ------------------------------------------------------------------ */
/* The library's menus: what can be done to a folder, and to a note    */
/*                                                                     */
/* Obsidian's own menu, filled from one list a kind. Every feature's   */
/* actions on a folder or a note join it, and for a note so do other   */
/* plugins' entries (Obsidian's file-menu). Kin are fused into one     */
/* entry that opens them: New, Open as, Properties, Sort by.           */
/* ------------------------------------------------------------------ */

import { Menu, TFolder } from 'obsidian';
import { addActionItems, submenu } from '../core/actions.js';
import { counted } from '../core/text.js';
import { chooseFolder } from '../ui/choose.js';
import { ask, confirm } from '../ui/sheet.js';
import { editFilter } from './filters.js';
import { SORTS, isPinned, setSort, sortOf, togglePin } from './order.js';

const entry = (menu, title, run, section = 'action', more) =>
  menu.addItem((item) => {
    item.setTitle(title).setSection(section).onClick(run);
    if (more) more(item);
  });

/** Entries fused into one that opens them: [short title, whole title, run]. Where Obsidian gives no such entry, each stands alone, under its whole title. */
function fuse(menu, title, section, entries) {
  let sub = null;
  menu.addItem((item) => {
    item.setTitle(title).setSection(section);
    sub = submenu(item);
    if (!sub) item.setTitle(entries[0][1]).onClick(entries[0][2]);
  });
  (sub ? entries : entries.slice(1)).forEach(([short, whole, run]) => entry(sub || menu, sub ? short : whole, run, section));
}

/** Asks for a new name and renames. */
export async function renameEntry(plugin, target) {
  const isFolder = target instanceof TFolder;
  const name = await ask(plugin.app, {
    title: `Rename ${isFolder ? 'folder' : 'note'}`,
    value: isFolder ? target.name : target.basename,
    action: 'Rename',
    check: (v) => (/[\\/:]/.test(v) ? 'A name can’t hold a slash or a colon.' : null),
  });
  return name ? plugin.files.rename(target, name) : false;
}

/** Asks where to, and moves there with an Undo. */
export async function moveEntry(plugin, target) {
  const to = await chooseFolder(plugin, { except: (f) => f === target.parent || f === target || f.path.startsWith(`${target.path}/`) });
  return to ? plugin.files.move(target, to.path, { announce: true }) : false;
}

/** Asks, then sends to the bin. */
export async function deleteEntry(plugin, target) {
  const isFolder = target instanceof TFolder;
  const n = isFolder ? plugin.index.count(target) : 0;
  const yes = await confirm(plugin.app, {
    title: `Delete ${isFolder ? target.name : target.basename}`,
    text: isFolder ? `The folder and its ${counted(n, 'note')} go to the bin.` : 'The note goes to the bin.',
    action: isFolder ? 'Delete folder' : 'Delete note',
  });
  return yes ? plugin.files.trash(target) : false;
}

/** The menu of a folder. `screen` is the library screen it was asked from, if any. The vault's top has only what applies to it: new, and its order. */
export function folderMenu(plugin, folder, screen) {
  const menu = new Menu();
  const top = folder.path === '/';
  if (screen && !top) entry(menu, 'Open', () => screen.go(folder), 'open');
  const newFolder = async () => {
    const name = await ask(plugin.app, { title: 'New folder', placeholder: 'Untitled', action: 'Make folder' });
    if (name) plugin.files.newFolder(folder, name);
  };
  fuse(menu, 'New', 'new', [['Note', 'New note', () => plugin.files.newNote(folder)], ['Folder', 'New folder', newFolder]]);
  if (!top) entry(menu, isPinned(plugin, folder) ? 'Unpin' : 'Pin', () => togglePin(plugin, folder));
  if (screen) entry(menu, 'Filter…', () => editFilter(plugin, screen), 'view');
  menu.addItem((item) => {
    item.setTitle('Sort by').setSection('action');
    const sub = submenu(item);
    if (!sub) return void item.onClick(() => setSort(plugin, folder, 'name'));
    Object.keys(SORTS).forEach((by) => sub.addItem((s) => s.setTitle(SORTS[by]).setChecked(sortOf(plugin, folder) === by).onClick(() => setSort(plugin, folder, by))));
  });
  if (top) return menu;
  addActionItems(menu, plugin.actions(), 'folder', { folder });
  entry(menu, 'Rename…', () => renameEntry(plugin, folder), 'danger');
  entry(menu, 'Move to…', () => moveEntry(plugin, folder), 'danger');
  entry(menu, 'Delete folder', () => deleteEntry(plugin, folder), 'danger', (item) => typeof item.setWarning === 'function' && item.setWarning(true));
  return menu;
}

/** The menu of a note. */
export function noteMenu(plugin, file) {
  const menu = new Menu();
  const open = (leaf) => plugin.app.workspace.getLeaf(leaf).openFile(file);
  entry(menu, 'Open', () => open(false), 'open');
  entry(menu, 'Open in a new tab', () => open('tab'), 'open');
  entry(menu, isPinned(plugin, file) ? 'Unpin' : 'Pin', () => togglePin(plugin, file));
  addActionItems(menu, plugin.actions(), 'note', { file });
  entry(menu, 'Rename…', () => renameEntry(plugin, file), 'danger');
  entry(menu, 'Move to…', () => moveEntry(plugin, file), 'danger');
  entry(menu, 'Delete note', () => deleteEntry(plugin, file), 'danger', (item) => typeof item.setWarning === 'function' && item.setWarning(true));
  plugin.app.workspace.trigger('file-menu', menu, file, 'design-redux-library');
  return menu;
}

/** Shows a menu where it was asked for: at the pointer, or by the element the keyboard is on. */
export function showMenu(menu, event) {
  if (event && typeof event.clientX === 'number' && (event.clientX || event.clientY)) return menu.showAtMouseEvent(event);
  const el = event && event.target && event.target.getBoundingClientRect ? event.target.getBoundingClientRect() : { left: 0, bottom: 0 };
  return menu.showAtPosition({ x: el.left, y: el.bottom });
}
