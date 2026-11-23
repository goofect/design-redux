/* ------------------------------------------------------------------ */
/* Footnotes in place                                                  */
/*                                                                     */
/* A citation shouldn't mean leaving the sentence. Add footnote asks   */
/* for it in a small sheet: the number goes in where the cursor was,   */
/* the citation to the end of the note, and writing carries on. Cite a */
/* source does the same with a note as the source, its citation made   */
/* from its properties (cite.js). A citation the note already has is   */
/* cited again by its number. Go to footnote picks one of the note's   */
/* in the palette, as it reads, and goes to its number; Notes citing   */
/* this picks a note whose footnotes link to the one open, and goes to */
/* the citation there. A command puts the footnotes in order. Nothing  */
/* is drawn beside the note.                                           */
/* ------------------------------------------------------------------ */

import { MarkdownView, Notice } from 'obsidian';
import { Feature } from '../core/feature.js';
import { changesBetween } from '../core/text.js';
import { choose } from '../ui/choose.js';
import { ask } from '../ui/sheet.js';
import { citationOf, citingIds, sourceOf, sourcesIn } from './cite.js';
import { addFootnote, citationWords, findFootnotes, tidyFootnotes } from './footnote-text.js';

/** Makes an editor's text the one given, changing only what differs (so a folded section stays folded), in one Undo; then puts the cursor where it is told. */
function setText(editor, text, cursor) {
  const changes = changesBetween(editor.getValue(), text).map((c) => ({ from: editor.offsetToPos(c.from), to: editor.offsetToPos(c.to), text: c.text }));
  if (changes.length) editor.transaction({ changes });
  if (cursor) editor.setCursor(cursor);
}

/** Puts the cursor at a place in an editor, in view, and the keys back in the text. */
function goTo(editor, pos) {
  editor.setCursor(pos);
  if (typeof editor.scrollIntoView === 'function') editor.scrollIntoView({ from: pos, to: pos }, true);
  if (typeof editor.focus === 'function') editor.focus();
}

export class Footnotes extends Feature {
  async add_(ctx) {
    const citation = await ask(this.app, { title: 'Add footnote', label: 'The citation', placeholder: 'Hume, Enquiry, §10', action: 'Add' });
    return citation ? this.put(ctx.editor, citation) : null;
  }

  /**
   * Asks for a source, a note, and where in it, and cites it at the cursor:
   * in full the first time the note cites it, short once it has been cited
   * before this place. Offered first: the sources the note cites already,
   * then those with an author.
   */
  async cite(ctx) {
    const text = ctx.editor.getValue();
    const here = sourcesIn(this.app, text, ctx.file);
    const notes = this.plugin.index.markdown().filter((f) => f !== ctx.file).map((file) => ({ file, ...sourceOf(this.app, file) }));
    const rank = (s) => (here.has(s.file) ? 0 : s.author ? 1 : 2);
    const label = (s) => [s.author, s.title, s.year].filter(Boolean).join(', ');
    const source = await choose(this.app, notes.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s), { placeholder: 'Cite…', name: label });
    if (!source) return null;
    const where = await ask(this.app, { title: 'Cite', text: label(source), label: 'Where in it', placeholder: 'p. 34, or nothing', action: 'Cite', optional: true });
    if (where === null) return null;
    const ids = citingIds(this.app, text, ctx.file, source.file);
    const before = findFootnotes(text.slice(0, ctx.editor.posToOffset(ctx.editor.getCursor()))).refs.some((r) => ids.has(r.id));
    return this.put(ctx.editor, citationOf(this.app, source.file, ctx.file, where, before));
  }

  /** Puts a footnote at the cursor: the number of one the note already has with that citation, else a new one. */
  put(editor, citation) {
    const cursor = editor.getCursor();
    const offset = editor.posToOffset(cursor);
    const text = editor.getValue();
    const same = findFootnotes(text).defs.find((d) => d.text === citation.replace(/\s*\r?\n\s*/g, ' ').trim());
    if (same) {
      // The number again; in order, it is the one the footnotes come to once renumbered.
      const again = tidyFootnotes(`${text.slice(0, offset)}[^${same.id}]${text.slice(offset)}`);
      const id = (findFootnotes(again).refs[findFootnotes(text.slice(0, offset)).refs.length] || same).id;
      setText(editor, again, { line: cursor.line, ch: cursor.ch + `[^${id}]`.length });
      return id;
    }
    const out = addFootnote(text, offset, citation);
    setText(editor, out.text, { line: cursor.line, ch: cursor.ch + `[^${out.id}]`.length });
    return out.id;
  }

  tidy(ctx) {
    const before = ctx.editor.getValue();
    const after = tidyFootnotes(before);
    if (after === before) return void new Notice('The footnotes are already in order.');
    setText(ctx.editor, after, ctx.editor.getCursor());
    new Notice('Footnotes put in order.');
  }

  /** The note's footnotes in the palette, each its number and its words; one taken, the cursor goes to its number (or, used nowhere, to it). */
  async goToFootnote(ctx) {
    const { refs, defs } = findFootnotes(ctx.editor.getValue());
    if (!defs.length) return void new Notice('This note has no footnotes.');
    const items = defs.map((d) => ({ d, ref: refs.find((r) => r.id === d.id) }));
    const picked = await choose(this.app, items, { placeholder: 'Go to footnote…', name: ({ d, ref }) => `${d.id}  ${citationWords(d.text) || '(empty)'}${ref ? '' : '  (used nowhere)'}` });
    if (!picked) return null;
    goTo(ctx.editor, picked.ref ? { line: picked.ref.line, ch: picked.ref.at } : { line: picked.d.line, ch: 0 });
    return picked.d.id;
  }

  /** The notes whose footnotes cite this one, in the palette; one taken opens at its first citation of it. */
  async citingThis(ctx) {
    const source = ctx.file;
    const found = [];
    for (const note of this.plugin.index.incoming(source)) {
      const text = await this.app.vault.cachedRead(note);
      const ids = citingIds(this.app, text, note, source);
      const ref = findFootnotes(text).refs.find((r) => ids.has(r.id));
      if (ref) found.push({ note, ref });
    }
    if (!found.length) return void new Notice('No note cites this one.');
    const picked = await choose(this.app, found, { placeholder: 'Notes citing this…', name: ({ note }) => note.path.replace(/\.md$/, '') });
    if (!picked) return null;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(picked.note, { state: { mode: 'source' } });
    const view = leaf.view instanceof MarkdownView ? leaf.view : null;
    if (view && view.editor) goTo(view.editor, { line: picked.ref.line, ch: picked.ref.at });
    return picked.note;
  }

  actions() {
    return [
      { id: 'add-footnote', name: 'Add footnote', on: 'editor', menu: false, run: (ctx) => this.add_(ctx) },
      { id: 'cite-source', name: 'Cite a source', on: 'editor', menu: false, run: (ctx) => this.cite(ctx) },
      { id: 'show-footnotes', name: 'Go to footnote', on: 'editor', menu: false, run: (ctx) => this.goToFootnote(ctx) },
      { id: 'notes-citing-this', name: 'Notes citing this', on: 'note', menu: false, run: (ctx) => this.citingThis(ctx) },
      { id: 'tidy-footnotes', name: 'Put footnotes in order', on: 'editor', menu: false, run: (ctx) => this.tidy(ctx) },
    ];
  }
}
Footnotes.title = 'Footnotes';
Footnotes.section = 'Notes';
Footnotes.about = 'Add a citation without leaving the sentence, or cite a note as a source; go to one; keep the numbers in order.';
