/* ------------------------------------------------------------------ */
/* Footnotes in place                                                  */
/*                                                                     */
/* A citation shouldn't mean leaving the sentence. Add footnote asks   */
/* for it in a small sheet: the number goes in where the cursor was,   */
/* the citation to the end of the note, and writing carries on. A view */
/* lists the open note's footnotes; a command puts them in order.      */
/* Cite a source picks a note and writes its citation from its         */
/* properties (author, title, year) with a link to it, and where in    */
/* it; a citation the note already has is cited again by its number.  */
/* ------------------------------------------------------------------ */

import { ItemView, MarkdownView, Notice } from 'obsidian';
import { clear } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { noteProps, propOf, valuesOf } from '../core/notes.js';
import { choose } from '../ui/choose.js';
import { headRow } from '../ui/head.js';
import { row, rows } from '../ui/row.js';
import { ask } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';
import { addFootnote, findFootnotes, tidyFootnotes } from './footnote-text.js';
import { valueShown } from './ledger.js';

export const FOOTNOTES_VIEW = 'design-redux-footnotes';

/** Replaces an editor's text and puts the cursor back as near where it was as the new text allows. */
function setText(editor, text, cursor) {
  const scroll = typeof editor.getScrollInfo === 'function' ? editor.getScrollInfo() : null;
  editor.setValue(text);
  if (cursor && typeof editor.setCursor === 'function') editor.setCursor(cursor);
  if (scroll && typeof editor.scrollTo === 'function') editor.scrollTo(scroll.left, scroll.top);
}

/** What a source is cited by, from its properties: { author, title, year }; the title is the note's name when it has none. */
export function sourceOf(app, file) {
  const props = noteProps(app, file);
  // A date may come read as one: its day as written, not as the clock here has it.
  const plain = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
  const first = (...keys) => {
    const v = keys.map((k) => propOf(props, k)).find((x) => valuesOf(x).length);
    return valuesOf(Array.isArray(v) ? v.map(plain) : plain(v)).map(valueShown);
  };
  const authors = first('author', 'authors', 'creator', 'by');
  const year = /\b\d{4}\b/.exec(first('year', 'date', 'published', 'issued')[0] || '');
  return { author: authors.length > 2 ? `${authors[0]} et al.` : authors.join(' and '), title: first('title')[0] || file.basename, year: year ? year[0] : '' };
}

/** A source's citation, as a footnote has it: its author, a link to it by its title, its year, then where in it. */
export function citationOf(app, file, from, where) {
  const { author, title, year } = sourceOf(app, file);
  const link = app.fileManager.generateMarkdownLink(file, from ? from.path : '', undefined, title === file.basename ? undefined : title);
  return [author, link, year, where].filter(Boolean).join(', ');
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
    const citation = await ask(this.app, { title: 'Add footnote', label: 'The citation', placeholder: 'Hume, Enquiry, §10', action: 'Add' });
    return citation ? this.put(ctx.editor, citation) : null;
  }

  /** Asks for a source, a note, and where in it, and cites it at the cursor. Notes with an author are offered first. */
  async cite(ctx) {
    const notes = this.plugin.index.markdown().filter((f) => f !== ctx.file).map((file) => ({ file, ...sourceOf(this.app, file) }));
    const label = (s) => [s.author, s.title, s.year].filter(Boolean).join(', ');
    const source = await choose(this.app, notes.filter((s) => s.author).concat(notes.filter((s) => !s.author)), { placeholder: 'Cite…', name: label });
    if (!source) return null;
    const where = await ask(this.app, { title: 'Cite', text: label(source), label: 'Where in it', placeholder: 'p. 34, or nothing', action: 'Cite', optional: true });
    return where === null ? null : this.put(ctx.editor, citationOf(this.app, source.file, ctx.file, where));
  }

  /** Puts a footnote at the cursor: the number of one the note already has with that citation, else a new one. */
  put(editor, citation) {
    const cursor = editor.getCursor();
    const offset = editor.posToOffset(cursor);
    const text = editor.getValue();
    const inOrder = this.settings.footnoteOrder !== false;
    const same = findFootnotes(text).defs.find((d) => d.text === citation.replace(/\s*\r?\n\s*/g, ' ').trim());
    if (same) {
      // The number again; in order, it is the one the footnotes come to once renumbered.
      let again = `${text.slice(0, offset)}[^${same.id}]${text.slice(offset)}`;
      let id = same.id;
      if (inOrder) {
        again = tidyFootnotes(again);
        id = (findFootnotes(again).refs[findFootnotes(text.slice(0, offset)).refs.length] || same).id;
      }
      setText(editor, again, { line: cursor.line, ch: cursor.ch + `[^${id}]`.length });
      return id;
    }
    const out = addFootnote(text, offset, citation, inOrder);
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
      { id: 'cite-source', name: 'Cite a source', on: 'editor', menu: false, run: (ctx) => this.cite(ctx) },
      { id: 'show-footnotes', name: 'Show footnotes', run: () => this.show() },
      { id: 'tidy-footnotes', name: 'Put footnotes in order', on: 'editor', menu: false, run: (ctx) => this.tidy(ctx) },
    ];
  }
}
Footnotes.title = 'Footnotes';
Footnotes.section = 'Notes';
Footnotes.about = 'Add a citation without leaving the sentence, or cite a note as a source; keep the numbers in order.';
