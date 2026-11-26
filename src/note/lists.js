/* ------------------------------------------------------------------ */
/* Numbered lists, two ways                                            */
/*                                                                     */
/* The way that keeps in step with Obsidian: a note's numbered lists   */
/* are Obsidian's own (1. items, nested by indent), and its `numbering` */
/* property says how they read, an outline (1.1.) or a style a level   */
/* (1 a i). Obsidian does everything a list does; the plugin only      */
/* draws each item's label, in the editor and in reading view          */
/* (numbering.js). Four commands set it, making the selected lines a   */
/* list first.                                                         */
/*                                                                     */
/* And markers written as text, a., i., 1.1., which are paragraphs to  */
/* Obsidian: Enter carries them on, Tab and Shift-Tab nest them, the   */
/* items after count on in the same Undo; they are drawn as Obsidian's */
/* own numbered lists are, and what Markdown takes for code under them */
/* as the text it is (outline-text.js). The note's text is as written. */
/* ------------------------------------------------------------------ */

import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { Feature } from '../core/feature.js';
import { listLines, numberLines } from './lists-editor.js';
import { rebuildList } from './lists-reading.js';
import { around, depth, firstUnder, isMarker, LIST_ITEM, measurer, nextMarker, readMarker, renumber } from './list-markers.js';
import { codeAsTextField, codeAsTextReading } from './outline-text.js';
import { NUMBERING, numberingText, numberRendered, outlineToReal, parseNumbering, toRealList } from './numbering.js';

export class MarkedLists extends Feature {
  register() {
    this.fonts = new Map(); // a measurer by font
    this.registerEditor();
    this.plugin.registerMarkdownPostProcessor((el, ctx) => this.on && this.render(el, ctx));
  }

  /** A measurer in a font, made once. */
  measure(doc, font, size) {
    if (!this.fonts.has(font)) this.fonts.set(font, measurer(doc, font, size));
    return this.fonts.get(font);
  }

  enable() {
    const measure = (view) => {
      const style = view.contentDOM.ownerDocument.defaultView.getComputedStyle(view.contentDOM);
      const size = parseFloat(style.fontSize) || 16;
      return this.measure(view.contentDOM.ownerDocument, [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].filter(Boolean).join(' '), size);
    };
    const live = (state) => !editorLivePreviewField || state.field(editorLivePreviewField, false) !== false;
    const numberingOf = (state) => {
      const info = editorInfoField ? state.field(editorInfoField, false) : null;
      return this.numberingOf(info && info.file);
    };
    const pathOf = (state) => {
      const info = editorInfoField ? state.field(editorInfoField, false) : null;
      return (info && info.file && info.file.path) || '';
    };
    this.useEditor(listLines(measure), numberLines(numberingOf, live, measure), codeAsTextField(this.app, pathOf, live));
    // A note's numbering changed: its editors and reading views drawn again.
    this.known = new Map();
    this.listen(this.app.metadataCache, 'changed', (file) => {
      const now = JSON.stringify(this.numberingOf(file));
      if ((this.known.has(file.path) ? this.known.get(file.path) : 'null') === now) return;
      this.known.set(file.path, now);
      if (typeof this.app.workspace.updateOptions === 'function') this.app.workspace.updateOptions();
      this.redrawReading();
    });
    this.redrawReading();
    this.add(() => this.redrawReading()); // the feature is off by now: the lists go back to the paragraphs they were
    // Enter at the end of an item carries the list on; Tab and Shift-Tab nest it, as in Obsidian's own lists.
    const keys = (e) => {
      if (e.isComposing || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key !== 'Tab' && (e.key !== 'Enter' || e.shiftKey)) return;
      const view = this.app.workspace.activeEditor || null;
      const editor = view && view.editor;
      if (!editor || !e.target.closest || !e.target.closest('.cm-content')) return;
      const done = e.key === 'Enter' ? this.carryOn(editor) : e.shiftKey ? this.outdent(editor) : this.indent(editor);
      if (done) e.preventDefault();
    };
    this.eachWindow((doc) => this.listenDom(doc, 'keydown', keys, true));
  }

  /** The marked item the cursor is on, if its kind is turned on and nothing spans lines. */
  item(editor) {
    const from = editor.getCursor('from');
    const at = editor.getCursor('to');
    if (from.line !== at.line) return null;
    const line = editor.getLine(at.line);
    const m = LIST_ITEM.exec(line);
    if (!m) return null;
    const near = around(editor, at.line, depth(m[1]));
    if (!isMarker(m[2], near.sibling, m[3], near.parent)) return null;
    return { at, line, m, near, kind: readMarker(m[2], near.sibling).kind };
  }

  /**
   * Writes the item's line edits and the list counted on after them in one
   * change, one Undo, as Obsidian does for its own lists; then the cursor.
   * `edits` are [{ line, from, to, text }] in the text as it was.
   */
  write(editor, edits, cursor) {
    const seen = new Set();
    const changes = edits.filter((c) => !seen.has(`${c.line}:${c.from}`) && seen.add(`${c.line}:${c.from}`));
    editor.transaction({ changes: changes.map((c) => ({ from: { line: c.line, ch: c.from }, to: { line: c.line, ch: c.to }, text: c.text })) });
    editor.setCursor(cursor);
  }

  /** Puts `marker` and `indent` in place of the item's, keeping the cursor on the same word; the list after it, and the one it left, count on. */
  remark(editor, it, indent, marker) {
    const { at, m, line } = it;
    // A plain number is Markdown's own list only with its stop: "1.1" stepping out to "2" is written "2.".
    const stop = m[3] || (/^\d+$/.test(marker) ? '.' : '');
    const head = `${indent}${marker}${stop}${m[4]}`;
    const old = m[1].length + m[2].length + m[3].length + m[4].length;
    const lineOf = (i) => (i === at.line ? head + line.slice(old) : editor.getLine(i));
    const count = editor.lineCount();
    // The items it was among count on from the one above it there, where it moved in or out.
    const left = indent !== m[1] && it.near.siblingAt !== undefined ? renumber(lineOf, count, it.near.siblingAt) : [];
    this.write(editor, [{ line: at.line, from: 0, to: old, text: head }].concat(renumber(lineOf, count, at.line), left),
      { line: at.line, ch: Math.max(head.length, at.ch + head.length - old) });
  }

  /** At the end of a list item: starts the next (or, on an empty item, steps out or ends the list). Returns whether it did. */
  carryOn(editor) {
    const it = this.item(editor);
    if (!it || it.at.ch < it.line.length) return false;
    const { at, line, m, near } = it;
    // A lone "a." is a sentence's start more often than a list: carried on only once the list has two items, or the item has words.
    if (!m[5].trim()) {
      if (m[1]) return this.outdent(editor);
      // An outline written flat steps out by its number: 1.2. to 2., 1.1.2. to 1.2.
      if (it.kind === 'outline') {
        const parts = m[2].split('.');
        this.remark(editor, it, '', nextMarker(parts.slice(0, -1).join('.')));
        return true;
      }
      if (!near.sibling) return false;
      editor.replaceRange('', { line: at.line, ch: 0 }, { line: at.line, ch: line.length });
      return true;
    }
    const head = `${m[1]}${nextMarker(m[2], near.sibling)}${m[3]}${m[4]}`;
    // The items after it count on from the new one: read as if it were in, written in the text as it is.
    const lineOf = (i) => (i <= at.line ? editor.getLine(i) : i === at.line + 1 ? head : editor.getLine(i - 1));
    const after = renumber(lineOf, editor.lineCount() + 1, at.line + 1).map((c) => Object.assign(c, { line: c.line - 1 }));
    this.write(editor, [{ line: at.line, from: line.length, to: line.length, text: `\n${head}` }].concat(after), { line: at.line + 1, ch: head.length });
    return true;
  }

  /** One indent in: the item carries on the list at that depth, or starts one under the item above. */
  indent(editor) {
    const it = this.item(editor);
    if (!it || !it.near.sibling) return false;
    const vault = this.app.vault;
    const config = (k) => (vault && typeof vault.getConfig === 'function' ? vault.getConfig(k) : undefined);
    const unit = config('useTab') === false ? ' '.repeat(config('tabSize') || 4) : '\t';
    const indent = it.m[1] + unit;
    const above = around(editor, it.near.siblingAt, depth(it.m[1])).sibling;
    this.remark(editor, it, indent, this.nextAt(editor, it.at.line, indent) || firstUnder(it.near.sibling, above));
    return true;
  }

  /** One indent out: the item carries on the list it steps back into. */
  outdent(editor) {
    const it = this.item(editor);
    if (!it || !it.m[1]) return false;
    const indent = it.m[1].replace(/(\t| {1,4})$/, '');
    const next = this.nextAt(editor, it.at.line, indent);
    this.remark(editor, it, indent, next && !/^[-*+]$/.test(next) ? next : it.m[2]);
    return true;
  }

  /** The marker after the nearest item above line `at` with this indent, read by the one before it. */
  nextAt(editor, at, indent) {
    const near = around(editor, at, depth(indent));
    if (!near.sibling) return null;
    return nextMarker(near.sibling, around(editor, near.siblingAt, depth(indent)).sibling);
  }

  /**
   * Numbers the note's lists one way, then sets the note's `numbering`.
   * The selected lines are made one of Obsidian's lists first; for an
   * outline, only the outline numbers written as text among them (2.1.)
   * are, and with nothing selected, those in the whole note, so a note
   * written that way becomes Obsidian's lists without its other lines
   * moving. One change, one Undo.
   */
  async numberAs(ctx, text) {
    const { editor, view, file } = ctx;
    const picked = editor.getCursor('from').line !== editor.getCursor('to').line || editor.getCursor('from').ch !== editor.getCursor('to').ch;
    const outline = parseNumbering(text).outline;
    if (picked || outline) {
      const from = picked ? editor.getCursor('from').line : 0;
      const to = picked ? editor.getCursor('to').line : editor.lineCount() - 1;
      const lines = [];
      for (let i = from; i <= to; i++) lines.push(editor.getLine(i));
      const config = (k) => (typeof this.app.vault.getConfig === 'function' ? this.app.vault.getConfig(k) : undefined);
      const unit = config('useTab') === false ? ' '.repeat(config('tabSize') || 4) : '\t';
      const written = outline ? outlineToReal(lines, unit) : lines;
      const made = outline && (written.some((l, i) => l !== lines[i]) || !picked) ? written : toRealList(lines, unit);
      const changes = made.map((l, i) => (l === lines[i] ? null : { from: { line: from + i, ch: 0 }, to: { line: from + i, ch: lines[i].length }, text: l })).filter(Boolean);
      if (changes.length) {
        editor.transaction({ changes });
        // Saved before the property is written, so the note is not written twice at once.
        if (view && typeof view.save === 'function') await view.save();
      }
    }
    if (file) await this.plugin.notes.write(file, (fm) => (fm[NUMBERING] = text));
  }

  /** Reading view: each paragraph or numbered item whose lines end in lettered, roman or outline items has them made a list. */
  render(root, ctx) {
    const info = ctx && typeof ctx.getSectionInfo === 'function' ? ctx.getSectionInfo(root) : null;
    const source = info ? info.text.split('\n').slice(info.lineStart, info.lineEnd + 1) : null;
    codeAsTextReading(this.app, root, ctx);
    Array.from(root.querySelectorAll('p, li')).concat(/^(P|LI)$/.test(root.tagName) ? [root] : []).forEach((block) => rebuildList(block, source));
    const numbering = ctx && ctx.sourcePath ? this.numberingOf(this.app.vault.getFileByPath(ctx.sourcePath)) : null;
    if (numbering) numberRendered(root, numbering);
  }

  /** How a note's numbered lists read, by its `numbering` property; null as Obsidian numbers them. */
  numberingOf(file) {
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    return parseNumbering(cache && cache.frontmatter ? cache.frontmatter[NUMBERING] : null);
  }

  /** Reading views drawn again, so a list is made, or undone, in what is already open. */
  redrawReading() {
    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const preview = leaf.view && leaf.view.previewMode;
      if (preview && typeof preview.rerender === 'function') preview.rerender(true);
    });
  }

  actions() {
    const number = (id, name, styles) => ({ id, name, on: 'editor', menu: false, run: (ctx) => this.numberAs(ctx, numberingText(parseNumbering(styles))) });
    return [
      number('make-outline-list', 'Number this note’s lists as an outline, 1.1. (and make the selected lines a list)', '1.1'),
      number('number-lists-mixed', 'Number this note’s lists 1., a., i. (and make the selected lines a list)', '1 a i'),
      number('make-lettered-list', 'Number this note’s lists a., i. (and make the selected lines a list)', 'a i'),
      number('make-roman-numeral-list', 'Number this note’s lists i., a. (and make the selected lines a list)', 'i a'),
    ];
  }
}
