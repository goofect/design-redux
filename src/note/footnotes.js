/* ------------------------------------------------------------------ */
/* Footnotes in place                                                  */
/*                                                                     */
/* A citation shouldn't mean leaving the sentence. Add footnote asks   */
/* for it in a small sheet: the number goes in where the cursor was,   */
/* the citation to the end of the note, and writing carries on. A view */
/* lists the open note's footnotes; a command puts them in order.      */
/* ------------------------------------------------------------------ */

import { ItemView, MarkdownView, Notice } from 'obsidian';
import { clear } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { headRow } from '../ui/head.js';
import { row, rows } from '../ui/row.js';
import { ask } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';
import { addFootnote, findFootnotes, tidyFootnotes } from './footnote-text.js';

export const FOOTNOTES_VIEW = 'design-redux-footnotes';

/** Replaces an editor's text and puts the cursor back as near where it was as the new text allows. */
function setText(editor, text, cursor) {
  const scroll = typeof editor.getScrollInfo === 'function' ? editor.getScrollInfo() : null;
  editor.setValue(text);
  if (cursor && typeof editor.setCursor === 'function') editor.setCursor(cursor);
  if (scroll && typeof editor.scrollTo === 'function') editor.scrollTo(scroll.left, scroll.top);
}

export class FootnotesView extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
  }

  getViewType() { return FOOTNOTES_VIEW; }
  getDisplayText() { return 'Footnotes'; }
  getIcon() { return 'superscript'; }
  async onOpen() { this.contentEl.classList.add('dr', 'dr-panel'); await this.draw(); }

  async draw() {
    const host = clear(this.contentEl);
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return void sayso(host, { label: 'No note open' });
    const { refs, defs } = findFootnotes(await this.app.vault.cachedRead(file));
    headRow(host, { label: 'Footnotes' });
    if (!defs.length) return void sayso(host, { label: 'No footnotes', text: 'Add footnote puts one at the cursor.' });
    const list = rows(host);
    defs.forEach((d) => {
      const ref = refs.find((r) => r.id === d.id);
      row(list, { slot: d.id, name: d.text || '(empty)', error: !ref, end: ref ? null : 'unused', run: () => ref && this.feature.jump(file, ref) });
    });
  }
}

export class Footnotes extends Feature {
  register() {
    this.plugin.registerView(FOOTNOTES_VIEW, (leaf) => new FootnotesView(leaf, this));
  }

  enable() {
    const ws = this.app.workspace;
    const draw = () => ws.getLeavesOfType(FOOTNOTES_VIEW).forEach((l) => l.view && l.view.draw && l.view.draw());
    ['file-open', 'design-redux:modified'].forEach((name) => this.listen(ws, name, draw));
    this.add(() => !this.plugin.unloading && ws.detachLeavesOfType(FOOTNOTES_VIEW));
  }

  async add_(ctx) {
    const { editor } = ctx;
    const citation = await ask(this.app, { title: 'Add footnote', label: 'The citation', placeholder: 'Hume, Enquiry, §10', action: 'Add' });
    if (!citation) return null;
    const cursor = editor.getCursor();
    const offset = editor.posToOffset(cursor);
    const out = addFootnote(editor.getValue(), offset, citation, this.settings.footnoteOrder !== false);
    setText(editor, out.text, { line: cursor.line, ch: cursor.ch + `[^${out.id}]`.length });
    if (this.settings.footnotesAside) this.show();
    return out.id;
  }

  tidy(ctx) {
    const before = ctx.editor.getValue();
    const after = tidyFootnotes(before);
    if (after === before) return void new Notice('The footnotes are already in order.');
    setText(ctx.editor, after, ctx.editor.getCursor());
    new Notice('Footnotes put in order.');
  }

  async show() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(FOOTNOTES_VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: FOOTNOTES_VIEW, active: true });
    }
    ws.revealLeaf(leaf);
    return leaf;
  }

  /** Puts the cursor on a footnote's number in the note. */
  jump(file, ref) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file !== file || !view.editor) return;
    view.editor.setCursor({ line: ref.line, ch: ref.at });
    if (typeof view.editor.focus === 'function') view.editor.focus();
  }

  actions() {
    return [
      { id: 'add-footnote', name: 'Add footnote', on: 'editor', menu: false, run: (ctx) => this.add_(ctx) },
      { id: 'show-footnotes', name: 'Show footnotes', run: () => this.show() },
      { id: 'tidy-footnotes', name: 'Put footnotes in order', on: 'editor', menu: false, run: (ctx) => this.tidy(ctx) },
    ];
  }
}
Footnotes.title = 'Footnotes';
Footnotes.section = 'Notes';
Footnotes.about = 'Add a citation without leaving the sentence; keep the numbers in order.';
