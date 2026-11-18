/* ------------------------------------------------------------------ */
/* The sidebar: the vault as a tree of its folders, and nothing else   */
/*                                                                     */
/* "Vault" at the top, its folders under it. A folder that holds more  */
/* folders ends in a slash, "Politics/", as a path does. The tree      */
/* follows what is open: the open folder's subfolders and the folders */
/* above it are shown, nothing else is unfolded, and there is nothing  */
/* to open or close. Pinned first; the open folder filled grey.        */
/* ------------------------------------------------------------------ */

import { asButton, el, flag } from '../core/dom.js';
import { rows } from '../ui/row.js';
import { pinnedFirst, shownFolders } from './contents.js';

/** Draws the tree into `host`: the vault, the path down to the open folder, and the open folder's own subfolders. */
export function drawTree(screen, host) {
  const plugin = screen.plugin;
  const root = screen.app.vault.getRoot();
  const open = plugin.openFolder || null;
  const unfolded = new Set(['/']);
  for (let f = open; f && f.path !== '/'; f = f.parent) unfolded.add(f.path);
  const list = rows(host, { outline: true });
  list.classList.add('dr-tree');
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Folders');
  const branch = (folder, depth) => {
    const top = folder.path === '/';
    const kids = pinnedFirst(plugin, folder, shownFolders(plugin, folder));
    const isOpen = unfolded.has(folder.path);
    const node = el(list, 'div', 'dr-row dr-tree-row');
    asButton(node, null, () => (plugin.showFolder ? plugin.showFolder(top ? null : folder) : null));
    node.setAttribute('role', 'treeitem');
    node.setAttribute('aria-level', String(depth + 1));
    node.dataset.path = folder.path;
    node.style.setProperty('--dr-depth', String(depth));
    const name = el(node, 'span', 'dr-row-name dr-text dr-clip', top ? 'Vault' : folder.name);
    if (kids.length && !top) {
      el(name, 'span', 'dr-muted', '/');
      node.setAttribute('aria-expanded', String(isOpen));
    }
    const current = !top && !!open && open.path === folder.path;
    flag(node, 'aria-current', current, 'location');
    flag(node, 'aria-selected', !current && !top && plugin.selection.is(folder));
    if (isOpen) kids.forEach((k) => branch(k, depth + 1));
  };
  branch(root, 0);
  screen.roving(list, '.dr-tree-row', () => 1);
  return list;
}
