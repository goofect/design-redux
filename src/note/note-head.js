/* A minimal page-control row for Markdown views. */
import { MarkdownView, TFile } from 'obsidian';

// Only paged notes receive a small control row; plain notes remain untouched.
export function noteHead(view) {
  const host = view.contentEl;
  let head = Array.from(host.children).find((c) => c.classList.contains('dr-note-head'));
  if (!head) {
    head = host.ownerDocument.createElement('div');
    head.className = 'dr dr-note-head';
    const pages = host.ownerDocument.createElement('div');
    pages.className = 'dr-note-pages';
    head.appendChild(pages);
    const navigation = host.querySelector(':scope > .dr-workspace-return');
    host.insertBefore(head, navigation ? navigation.nextSibling : host.firstChild);
  }
  return head;
}

export function tidyNoteHead(view) {
  const head = Array.from(view.contentEl.children).find((c) => c.classList.contains('dr-note-head'));
  if (head && !head.querySelector('.dr-note-pages').firstChild) head.remove();
}

export function noteViews(app) {
  return app.workspace.getLeavesOfType('markdown').map((leaf) => leaf.view).filter((view) => view instanceof MarkdownView && view.file instanceof TFile);
}
