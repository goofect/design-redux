/* ------------------------------------------------------------------ */
/* Dropping a note or a folder onto a folder moves it there            */
/*                                                                     */
/* Anything in the library that stands for a file can be dragged onto  */
/* anything that stands for a folder. The move is Obsidian's own, so   */
/* links follow, and it says so with an Undo.                          */
/* ------------------------------------------------------------------ */

import { TFolder } from 'obsidian';

const TYPE = 'text/x-design-redux-path';

/** Turns dragging on for one drawn body. Returns nothing: the body is thrown away on the next draw. */
export function enableDrop(screen, body) {
  const plugin = screen.plugin;
  const entryOf = (target) => {
    const node = target && target.closest ? target.closest('[data-path]') : null;
    return node ? [node, plugin.app.vault.getAbstractFileByPath(node.dataset.path)] : [null, null];
  };
  body.addEventListener('mousedown', (e) => {
    const [node] = entryOf(e.target);
    if (node) node.setAttribute('draggable', 'true');
  });
  // A drag is Obsidian's own as well, as from its file explorer: dropped into a note it is a link (in the vault's
  // own way of writing one), onto a pane it opens there, into another app it is the note's link as text.
  body.addEventListener('dragstart', (e) => {
    const [, entry] = entryOf(e.target);
    if (!entry || !e.dataTransfer) return;
    const drag = plugin.app.dragManager;
    const own = drag && typeof drag.onDragStart === 'function' && (entry instanceof TFolder ? drag.dragFolder : drag.dragFile);
    if (typeof own === 'function') drag.onDragStart(e, own.call(drag, e, entry));
    else if (!(entry instanceof TFolder)) e.dataTransfer.setData('text/plain', plugin.app.fileManager.generateMarkdownLink(entry, ''));
    e.dataTransfer.setData(TYPE, entry.path);
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  let over = null;
  const mark = (node) => {
    if (over && over !== node) over.removeAttribute('data-drop');
    over = node;
    if (node) node.setAttribute('data-drop', 'true');
  };
  body.addEventListener('dragover', (e) => {
    const [node, entry] = entryOf(e.target);
    const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
    if (!(entry instanceof TFolder) || !types.includes(TYPE)) return void mark(null);
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    mark(node);
  });
  body.addEventListener('dragleave', (e) => { if (e.target === over) mark(null); });
  body.addEventListener('drop', async (e) => {
    const [, folder] = entryOf(e.target);
    mark(null);
    const path = e.dataTransfer ? e.dataTransfer.getData(TYPE) : '';
    const moved = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
    if (!(folder instanceof TFolder) || !moved || moved === folder) return;
    e.preventDefault();
    await plugin.files.move(moved, folder.path, { announce: true });
  });
}
