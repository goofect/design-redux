/* ------------------------------------------------------------------ */
/* The sidebar: the vault as a tree of its folders, and nothing else   */
/*                                                                     */
/* The pane's head is "Vault"; under it its folders. One holding more  */
/* ends in a slash, "Politics/", as a path does. The tree follows     */
/* what is open: the open folder's subfolders and the folders         */
/* above it are shown, nothing else is unfolded, and there is nothing  */
/* to open or close. Pinned first; grey, the open folder ink.          */
/* ------------------------------------------------------------------ */

import { asButton, el, flag, nameRegion } from '../core/dom.js';
import { rows } from '../ui/row.js';
import { pinnedFirst, shownFolders } from './contents.js';

/** Draws the tree into `host`: the vault's folders, the path down to the open folder, and the open folder's own subfolders. The vault itself is the pane's head. */
export function drawTree(screen, host) {
  const plugin = screen.plugin;
  const root = screen.app.vault.getRoot();
  const open = plugin.selection.folder;
  const unfolded = new Set();
  for (let f = open; f && f.path !== '/'; f = f.parent) unfolded.add(f.path);
  const list = rows(host, { outline: true });
  list.classList.add('dr-tree');
  list.setAttribute('role', 'tree');
  nameRegion(list, 'Folders', host);
  const branch = (folder, depth) => {
    const kids = pinnedFirst(plugin, folder, shownFolders(plugin, folder));
    const isOpen = unfolded.has(folder.path);
    const node = el(list, 'li', 'dr-row dr-tree-row');
    asButton(node, null, () => plugin.showFolder(folder));
    node.setAttribute('role', 'treeitem');
    node.setAttribute('aria-level', String(depth + 1));
    node.dataset.path = folder.path;
    node.style.setProperty('--dr-depth', String(depth));
    const name = el(node, 'span', 'dr-row-name dr-text dr-clip', folder.name);
    if (kids.length) {
      el(name, 'span', 'dr-muted', '/').setAttribute('aria-hidden', 'true'); // aria-expanded says it holds more
      node.setAttribute('aria-expanded', String(isOpen));
    }
    const current = !!open && open.path === folder.path;
    flag(node, 'aria-current', current, 'location');
    flag(node, 'aria-selected', !current && plugin.selection.is(folder));
    if (isOpen) kids.forEach((k) => branch(k, depth + 1));
  };
  pinnedFirst(plugin, root, shownFolders(plugin, root)).forEach((f) => branch(f, 0));
  screen.roving(list, '.dr-tree-row', () => 1);
  return list;
}
