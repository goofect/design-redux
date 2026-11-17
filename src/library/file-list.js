/* The approved file browser's shared list of folders and files. */
import { setIcon, TFolder } from 'obsidian';
import { asButton, clear, el, flag, glyph } from '../core/dom.js';
import { sayso } from '../ui/state.js';

/** A human-readable file type without assuming every file is a note. */
export function browserType(entry) {
  if (entry instanceof TFolder) return 'Folder';
  if (entry.extension === 'md') return 'Markdown';
  return entry.extension ? entry.extension.toUpperCase() : 'File';
}

/** Obsidian's outline icons match the approved file-browser design. */
export function browserIcon(parent, name) {
  const icon = el(parent, 'span', 'dr-file-icon');
  setIcon(icon, name);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
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
  const drawEntry = (entry, depth = 0) => {
    const isFolder = entry instanceof TFolder;
    const node = el(list, 'div', 'dr-file-row');
    node.dataset.path = entry.path;
    node.style.setProperty('--dr-depth', String(depth));
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
    if (!screen.opts.wide && isFolder && !wanted) {
      const open = !!screen.expanded.get(entry.path);
      node.setAttribute('aria-expanded', String(open));
      const toggle = el(name, 'span', 'dr-file-disclosure');
      toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${entry.name}`);
      toggle.setAttribute('aria-hidden', 'true');
      glyph(toggle, open ? 'down' : 'next');
      toggle.addEventListener('click', (event) => { event.stopPropagation(); screen.toggle(entry.path, !open); });
      node.addEventListener('keydown', (event) => {
        if ((event.key === 'ArrowRight' && !open) || (event.key === 'ArrowLeft' && open)) {
          event.preventDefault();
          screen.toggle(entry.path, !open);
        }
      });
    }
    browserIcon(name, isFolder ? 'folder' : entry.extension === 'md' ? 'file-text' : 'file');
    el(name, 'span', 'dr-clip', entry.name);
    if (wanted) el(name, 'span', 'dr-file-result-path dr-clip', entry.path);
    if (screen.opts.wide) el(node, 'span', 'dr-file-type dr-clip', browserType(entry));
    if (!screen.opts.wide && isFolder && !wanted && screen.expanded.get(entry.path)) {
      plugin.index.subfolders(entry).concat(plugin.index.files(entry)).forEach((child) => drawEntry(child, depth + 1));
    }
  };
  if (!screen.opts.wide && folder.path !== '/' && !wanted) {
    screen.expanded.set(folder.path, true);
    drawEntry(folder);
  } else entries.forEach((entry) => drawEntry(entry));
  screen.roving(list, '.dr-file-row', () => 1);
}
