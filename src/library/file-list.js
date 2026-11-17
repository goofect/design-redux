/* Library: folders. A folder: notes. */
import { TFolder } from 'obsidian';
import { asButton, clear, el, glyph } from '../core/dom.js';

export function drawFileList(screen, host, folder) {
  const { plugin } = screen;
  screen.stops.splice(0).forEach((stop) => stop());
  clear(host);
  const root = plugin.app.vault.getRoot();
  const list = el(host, 'div', 'dr-file-list');
  const items = el(list, 'div', 'dr-file-items');
  items.setAttribute('role', screen.opts.wide ? 'listbox' : 'tree');
  const listName = el(list, 'span', 'dr-unseen', screen.opts.wide ? `Notes in ${folder.path === '/' ? 'vault' : folder.name}` : 'Folders');
  plugin.browserLabelId = (plugin.browserLabelId || 0) + 1;
  listName.id = `dr-file-label-${plugin.browserLabelId}`;
  items.setAttribute('aria-labelledby', listName.id);
  const add = (entry, depth = 0) => {
    const isFolder = entry instanceof TFolder;
    const node = el(items, 'div', 'dr-file-row');
    node.dataset.path = entry.path;
    node.setAttribute('role', screen.opts.wide ? 'option' : 'treeitem');
    if (!screen.opts.wide) node.setAttribute('aria-level', String(depth + 1));
    node.style.setProperty('--dr-depth', String(depth));
    asButton(node, isFolder ? entry.name : entry.basename, (event) => {
      screen.pick(entry);
      if (isFolder) screen.go(entry.path === '/' ? null : entry);
      else screen.openNote(entry, event);
    });
    // Obsidian turns aria-label into a visual tooltip. Name the row through
    // its visible text instead, preserving its full accessible name.
    node.removeAttribute('aria-label');
    node.setAttribute('aria-selected', String(isFolder ? folder.path === entry.path : plugin.selection.is(entry)));
    const name = el(node, 'span', 'dr-file-name');
    plugin.browserLabelId = (plugin.browserLabelId || 0) + 1;
    name.id = `dr-file-label-${plugin.browserLabelId}`;
    node.setAttribute('aria-labelledby', name.id);
    if (isFolder && !screen.opts.wide) {
      const open = entry.path === '/' || !!screen.expanded.get(entry.path);
      node.setAttribute('aria-expanded', String(open));
      const toggle = el(name, 'span', 'dr-file-disclosure');
      toggle.setAttribute('aria-hidden', 'true');
      glyph(toggle, open ? 'down' : 'next');
      if (entry.path !== '/') {
        toggle.addEventListener('click', (e) => { e.stopPropagation(); screen.toggle(entry.path, !open); });
        node.addEventListener('keydown', (e) => {
          if ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open)) { e.preventDefault(); screen.toggle(entry.path, !open); }
        });
      }
      el(name, 'span', 'dr-clip', entry.path === '/' ? 'Vault' : entry.name);
      if (open) plugin.index.subfolders(entry).forEach((child) => add(child, depth + 1));
    } else el(name, 'span', 'dr-clip', isFolder ? entry.name : entry.basename);
  };
  if (screen.opts.wide) {
    const notes = plugin.index.files(folder).filter((f) => f.extension.toLowerCase() === 'md');
    if (notes.length) notes.forEach((note) => add(note));
    else el(host, 'p', 'dr-file-empty', 'No notes in this folder.');
  } else add(root);
  screen.roving(items, '.dr-file-row', () => 1);
}
