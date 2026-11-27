/* ------------------------------------------------------------------ */
/* A note, out of the vault: copied as formatted text, read aloud      */
/*                                                                     */
/* Two of the browser's own abilities, offered as commands and in the */
/* note's menus, nothing on the screen: the clipboard's rich text      */
/* (pasted into mail or a document, the note keeps its headings, lists */
/* and emphasis) and the system's voice (one paragraph at a time).     */
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

/** The blocks of a drawn note a voice reads, one each: headings, paragraphs, list items, quotes, cells. */
export function spokenParts(host) {
  const blocks = Array.from(host.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th'))
    .filter((n) => !n.querySelector('p, li'))
    .map((n) => n.textContent.replace(/\s+/g, ' ').trim());
  const parts = blocks.filter(Boolean);
  return parts.length ? parts : [host.textContent.replace(/\s+/g, ' ').trim()].filter(Boolean);
}

const speech = () => (typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null);

export class NoteOut extends Feature {
  enable() {
    this.add(() => this.stopReading());
  }

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

  /** Reads the note aloud in the system's voice, a block at a time (a long single utterance stops partway). */
  async readAloud(file) {
    const voice = speech();
    if (!voice) { new Notice('This system has no voice to read with.'); return 0; }
    this.stopReading();
    const parts = spokenParts(await renderNote(this.app, file));
    if (!parts.length) { new Notice(`${file.basename} has nothing to read.`); return 0; }
    const lang = activeDocument.documentElement.lang || undefined;
    this.reading = file.path;
    parts.forEach((text, i) => {
      const said = new window.SpeechSynthesisUtterance(text);
      if (lang) said.lang = lang;
      if (i === parts.length - 1) said.onend = () => { if (this.reading === file.path) this.reading = null; };
      voice.speak(said);
    });
    return parts.length;
  }

  stopReading() {
    const voice = speech();
    this.reading = null;
    if (voice && (voice.speaking || voice.pending)) voice.cancel();
  }

  get speaking() {
    const voice = speech();
    return !!this.reading && !!voice && (voice.speaking || voice.pending);
  }

  actions() {
    return [
      { id: 'copy-note-formatted', name: 'Copy note as formatted text', on: 'note', section: 'action', run: (ctx) => this.copyFormatted(ctx.file) },
      { id: 'read-note-aloud', name: 'Read note aloud', on: 'note', section: 'action', when: () => !!speech(), run: (ctx) => this.readAloud(ctx.file) },
      { id: 'stop-reading', name: 'Stop reading aloud', menu: false, when: () => this.speaking, run: () => this.stopReading() },
    ];
  }
}
