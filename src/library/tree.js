/* ------------------------------------------------------------------ */
/* The sidebar: the vault as a tree of its folders, and nothing else   */
/*                                                                     */
/* "Vault" at the top, its folders under it, each a chevron and a      */
/* name. The chevron opens or closes a folder's branch; the name shows */
/* the folder in the page. Notes are not in the tree: a folder's page  */
/* lists them. Pinned folders first. The open folder is filled grey.   */
/* ------------------------------------------------------------------ */

import { asButton, el, flag, glyph } from '../core/dom.js';
import { rows } from '../ui/row.js';
import { pinnedFirst, shownFolders } from './contents.js';

/** Draws the tree into `host`. `screen.expanded` holds the paths whose branches are open. */
export function drawTree(screen, host) {
  const plugin = screen.plugin;
  const root = screen.app.vault.getRoot();
  const open = plugin.openFolder || null;
  for (let f = open && open.parent; f && f.path !== '/'; f = f.parent) screen.expanded.add(f.path);
  const list = rows(host, { outline: true });
  list.classList.add('dr-tree');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Folders');
  const toggle = (path) => {
    if (screen.expanded.has(path)) screen.expanded.delete(path);
    else screen.expanded.add(path);
    screen.draw();
  };
  const branch = (folder, depth) => {
    const top = folder.path === '/';
    const kids = pinnedFirst(plugin, folder, shownFolders(plugin, folder));
    const isOpen = screen.expanded.has(folder.path);
    const node = el(list, 'div', 'dr-row dr-tree-row');
    asButton(node, null, () => (plugin.showFolder ? plugin.showFolder(top ? null : folder) : null));
    node.setAttribute('role', 'treeitem');
    node.setAttribute('aria-level', String(depth + 1));
    node.dataset.path = folder.path;
    node.style.setProperty('--dr-depth', String(depth));
    const twist = el(node, 'span', 'dr-twist');
    if (kids.length) {
      glyph(twist, 'chevron');
      node.setAttribute('aria-expanded', String(isOpen));
      twist.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(folder.path);
      });
    }
    el(node, 'span', 'dr-row-name dr-text dr-clip', top ? 'Vault' : folder.name);
    const current = !top && !!open && open.path === folder.path;
    flag(node, 'aria-current', current, 'location');
    flag(node, 'aria-selected', !current && !top && plugin.selection.is(folder));
    if (isOpen) kids.forEach((k) => branch(k, depth + 1));
  };
  branch(root, 0);
  // Right opens a branch, Left closes it (or goes to the parent's row).
  list.addEventListener('keydown', (e) => {
    const node = e.target.closest ? e.target.closest('.dr-tree-row') : null;
    if (!node || e.metaKey || e.ctrlKey || e.altKey) return;
    const state = node.getAttribute('aria-expanded');
    if (e.key === 'ArrowRight' && state === 'false') {
      e.preventDefault();
      toggle(node.dataset.path);
    } else if (e.key === 'ArrowLeft' && state === 'true') {
      e.preventDefault();
      toggle(node.dataset.path);
    }
  });
  screen.roving(list, '.dr-tree-row', () => 1);
  return list;
}
