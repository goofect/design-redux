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
  body.addEventListener('dragstart', (e) => {
    const [, entry] = entryOf(e.target);
    if (!entry || !e.dataTransfer) return;
    e.dataTransfer.setData(TYPE, entry.path);
    e.dataTransfer.effectAllowed = 'move';
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
