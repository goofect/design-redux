/* The reduced workspace: folders at rest, a return path from every note. */
import { MarkdownView } from 'obsidian';
import { el } from '../core/dom.js';

export function reducedWorkspace(library) {
  const ws = library.app.workspace;
  const returns = new Map();
  let queued = false;
  let opening = false;
  const draw = () => {
    queued = false;
    if (!library.on) return;
    const type = ws.activeLeaf?.getViewState().type;
    ws.detachLeavesOfType('file-explorer');
    const views = new Set(ws.getLeavesOfType('markdown').map((leaf) => leaf.view).filter((view) => view instanceof MarkdownView && view.file));
    returns.forEach((entry, view) => {
      if (!views.has(view)) { entry.host.remove(); returns.delete(view); }
    });
    views.forEach((view) => {
      let entry = returns.get(view);
      if (!entry) {
        const host = el(view.contentEl.ownerDocument, 'nav', 'dr dr-workspace-return');
        host.setAttribute('aria-label', 'Note navigation');
        const back = el(host, 'button', 'dr-return-button');
        back.type = 'button';
        back.addEventListener('click', () => library.browse(view.file.parent));
        const name = el(host, 'span', 'dr-clip');
        view.contentEl.prepend(host);
        entry = { host, back, name };
        returns.set(view, entry);
      }
      const folder = view.file.parent;
      const name = folder && folder.path !== '/' ? folder.name : 'Vault';
      entry.back.textContent = `← ${name}`;
      entry.back.setAttribute('aria-label', `Back to ${name}`);
      entry.name.textContent = view.file.basename;
    });
    if (!opening && (!type || type === 'empty' || type === 'file-explorer')) {
      opening = true;
      library.browse(library.plugin.openFolder, true).catch((err) => console.error('Design Redux: could not open the workspace', err)).finally(() => { opening = false; });
    }
  };
  const schedule = () => {
    if (!queued) { queued = true; queueMicrotask(draw); }
  };
  ['layout-change', 'active-leaf-change', 'file-open', 'design-redux:renamed'].forEach((event) => library.listen(ws, event, schedule));
  library.add(() => { returns.forEach(({ host }) => host.remove()); returns.clear(); });
  schedule();
}
