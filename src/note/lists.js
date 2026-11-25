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
import { addActionItems } from '../core/actions.js';
import { Feature } from '../core/feature.js';
import { listLines, numberLines } from './lists-editor.js';
import { rebuildList } from './lists-reading.js';
import { measurer } from './list-markers.js';
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
    // The note's text menu: Number lists, the four ways under it, where Obsidian's own editing entries are.
    this.listen(this.app.workspace, 'editor-menu', (menu, editor, info) => {
      if (info && info.file) addActionItems(menu, this.actions(), 'editor', { editor, view: info, file: info.file });
    });
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
    const number = (id, name, menu, styles) => ({ id, name, menu, group: 'Number lists', section: 'action', on: 'editor', run: (ctx) => this.numberAs(ctx, numberingText(parseNumbering(styles))) });
    return [
      number('make-outline-list', 'Number this note’s lists as an outline, 1.1. (and make the selected lines a list)', 'As an outline (1., 1.1., 1.1.1.)', '1.1'),
      number('number-lists-mixed', 'Number this note’s lists 1., a., i. (and make the selected lines a list)', '1., a., i.', '1 a i'),
      number('make-lettered-list', 'Number this note’s lists a., i. (and make the selected lines a list)', 'a., i.', 'a i'),
      number('make-roman-numeral-list', 'Number this note’s lists i., a. (and make the selected lines a list)', 'i., a.', 'i a'),
    ];
  }
}
