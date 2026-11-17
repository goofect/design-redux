/* The approved file browser's shared list of folders and files. */
import { TFolder } from 'obsidian';
import { asButton, clear, el, flag, glyph } from '../core/dom.js';
import { sayso } from '../ui/state.js';

/** A human-readable file type without assuming every file is a note. */
export function browserType(entry) {
  if (entry instanceof TFolder) return 'Folder';
  if (entry.extension === 'md') return 'Markdown';
  return entry.extension ? entry.extension.toUpperCase() : 'File';
}

/** Draws the contents of one folder, using the vault index shared by both views. */
export function drawFileList(screen, host, folder, query = '') {
  const { plugin } = screen;
  screen.stops.splice(0).forEach((stop) => stop());
  clear(host);
  const wanted = query.trim().toLowerCase();
  const folders = wanted ? [plugin.app.vault.getRoot()].concat(plugin.index.folders()) : [folder];
  const entries = wanted
    ? plugin.index.folders().concat(folders.flatMap((f) => plugin.index.files(f))).filter((entry) => entry.name.toLowerCase().includes(wanted))
    : plugin.index.subfolders(folder).concat(plugin.index.files(folder));
  if (!entries.length) return void sayso(host, { label: wanted ? 'No matching files or folders' : 'Nothing in this folder yet', button: wanted ? null : { text: 'New note', run: () => plugin.files.newNote(folder) } });
  const list = el(host, 'div', 'dr-file-list');
  if (screen.opts.wide) {
    const labels = el(list, 'div', 'dr-file-list-heading');
    el(labels, 'span', '', 'Name');
    el(labels, 'span', '', 'Type');
  }
  entries.forEach((entry) => {
    const isFolder = entry instanceof TFolder;
    const node = el(list, 'div', 'dr-file-row');
    node.dataset.path = entry.path;
    asButton(node, entry.name, (event) => {
      const picked = plugin.selection.path === entry.path;
      screen.pick(entry);
      if (event.detail === 0 || picked) {
        if (isFolder) screen.go(entry);
        else screen.openNote(entry, event);
      }
    });
    flag(node, 'aria-selected', plugin.selection.is(entry));
    const name = el(node, 'span', 'dr-file-name');
    glyph(name, isFolder ? 'folder' : 'note');
    el(name, 'span', 'dr-clip', entry.name);
    if (wanted) el(name, 'span', 'dr-file-result-path dr-clip', entry.path);
    if (screen.opts.wide) el(node, 'span', 'dr-file-type dr-clip', browserType(entry));
  });
  screen.roving(list, '.dr-file-row', () => 1);
}
