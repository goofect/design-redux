/* ------------------------------------------------------------------ */
/* A note, out of the vault: copied as formatted text                  */
/*                                                                     */
/* The clipboard's rich text, offered as a command and in the note's   */
/* menus, nothing on the screen: pasted into mail or a document, the   */
/* note keeps its headings, lists and emphasis.                        */
/* ------------------------------------------------------------------ */

import { Component, MarkdownRenderer, Notice } from 'obsidian';
import { copyText } from '../core/dom.js';
import { Feature } from '../core/feature.js';

/** A note's text without its properties. */
export function noteBody(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
}

/** A note drawn as Obsidian draws it, in an element of its own; its links to other notes are left as their words, which mean nothing outside the vault. */
export async function renderNote(app, file) {
  const doc = activeDocument;
  const host = doc.createElement('div');
  const component = new Component();
  component.load();
  try {
    await MarkdownRenderer.render(app, noteBody(await app.vault.cachedRead(file)), host, file.path, component);
  } finally {
    component.unload();
  }
  host.querySelectorAll('a.internal-link').forEach((a) => a.replaceWith(doc.createTextNode(a.textContent)));
  host.querySelectorAll('.frontmatter, .frontmatter-container, .metadata-container, button, input').forEach((n) => n.remove());
  return host;
}

export class NoteOut extends Feature {
  /** Puts the note on the clipboard twice over: as formatted text, and as its Markdown for where formatting can't go. */
  async copyFormatted(file) {
    const markdown = noteBody(await this.app.vault.cachedRead(file));
    const host = await renderNote(this.app, file);
    const clip = typeof navigator !== 'undefined' && navigator.clipboard;
    if (!clip || typeof clip.write !== 'function' || typeof ClipboardItem !== 'function') return copyText(markdown, 'Copied as Markdown: this system takes no formatted text.');
    try {
      await clip.write([new ClipboardItem({
        'text/html': new Blob([new XMLSerializer().serializeToString(host)], { type: 'text/html' }),
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      })]);
      new Notice(`${file.basename} copied as formatted text.`);
      return true;
    } catch (err) {
      return copyText(markdown, 'Copied as Markdown: the clipboard took no formatted text.');
    }
  }

  actions() {
    return [
      { id: 'copy-note-formatted', name: 'Copy note as formatted text', on: 'note', section: 'action', run: (ctx) => this.copyFormatted(ctx.file) },
    ];
  }
}
