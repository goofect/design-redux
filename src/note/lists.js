/* ------------------------------------------------------------------ */
/* Numbered lists                                                      */
/*                                                                     */
/* A note's numbered lists are Obsidian's own (1. items, nested by     */
/* indent), and its `numbering` property says how they read, an        */
/* outline (1.1.) or a style a level (1 a i). Obsidian does everything */
/* a list does; the plugin only draws each item's label, in the editor */
/* and in reading view (numbering.js). Four commands set it, making    */
/* the selected lines one of Obsidian's lists first.                   */
/*                                                                     */
/* Markers an older note has written as text, a., i., 1.1., which are  */
/* paragraphs to Obsidian, are still drawn as lists, so the note reads */
/* as it did; the commands make them Obsidian's lists.                 */
/* ------------------------------------------------------------------ */

import { editorInfoField, editorLivePreviewField } from 'obsidian';
import { Feature } from '../core/feature.js';
import { listLines, numberLines } from './lists-editor.js';
import { rebuildList } from './lists-reading.js';
import { measurer } from './list-markers.js';
import { NUMBERING, numberingText, numberRendered, parseNumbering, toRealList } from './numbering.js';

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
    this.useEditor(listLines(measure), numberLines(numberingOf, live, measure));
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
  }

  /**
   * Numbers the note's lists one way: the selected lines, if any, made one
   * of Obsidian's numbered lists first, then the note's `numbering` set.
   */
  async numberAs(ctx, text) {
    const { editor, view, file } = ctx;
    const from = editor.getCursor('from').line;
    const to = editor.getCursor('to').line;
    if (from !== to || editor.getCursor('from').ch !== editor.getCursor('to').ch) {
      const lines = [];
      for (let i = from; i <= to; i++) lines.push(editor.getLine(i));
      const config = (k) => (typeof this.app.vault.getConfig === 'function' ? this.app.vault.getConfig(k) : undefined);
      const unit = config('useTab') === false ? ' '.repeat(config('tabSize') || 4) : '\t';
      editor.replaceRange(toRealList(lines, unit).join('\n'), { line: from, ch: 0 }, { line: to, ch: editor.getLine(to).length });
      // Saved before the property is written, so the note is not written twice at once.
      if (view && typeof view.save === 'function') await view.save();
    }
    if (file) await this.plugin.notes.write(file, (fm) => (fm[NUMBERING] = text));
  }

  /** Reading view: each paragraph or numbered item whose lines end in lettered, roman or outline items has them made a list. */
  render(root, ctx) {
    const info = ctx && typeof ctx.getSectionInfo === 'function' ? ctx.getSectionInfo(root) : null;
    const source = info ? info.text.split('\n').slice(info.lineStart, info.lineEnd + 1) : null;
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
      number('make-lettered-list', 'Number this note’s lists a., i. (and make the selected lines a list)', 'a i'),
      number('make-roman-numeral-list', 'Number this note’s lists i., a. (and make the selected lines a list)', 'i a'),
      number('make-outline-list', 'Number this note’s lists as an outline, 1.1. (and make the selected lines a list)', '1.1'),
      number('number-lists-mixed', 'Number this note’s lists 1., a., i. (and make the selected lines a list)', '1 a i'),
    ];
  }
}
