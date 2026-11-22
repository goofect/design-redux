/* ------------------------------------------------------------------ */
/* Lettered and roman numeral lists                                    */
/*                                                                     */
/* Markdown numbers lists 1., 2., 3. and nothing else, so a list       */
/* written a., b., c. or i., ii., iii. is plain paragraphs to          */
/* Obsidian. Two commands turn the selected lines into one or the      */
/* other; Enter at the end of an item carries on with the next letter  */
/* or numeral, Tab and Shift-Tab nest it; in the editor a long item    */
/* hangs under its words, and reading view makes the items a list. The */
/* note's text is what was written.                                    */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';
import { listLines } from './lists-editor.js';
import { rebuildList } from './lists-reading.js';
import { around, depth, firstUnder, isMarker, LIST_ITEM, makeList, measurer, nextMarker, readMarker } from './list-markers.js';

export class MarkedLists extends Feature {
  register() {
    this.extensions = [];
    this.fonts = new Map(); // a measurer by font
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => this.on && this.render(el, ctx));
  }

  /** A measurer in a font, made once. */
  measure(doc, font, size) {
    if (!this.fonts.has(font)) this.fonts.set(font, measurer(doc, font, size));
    return this.fonts.get(font);
  }

  get wanted() {
    return this.settings.letterLists !== false || this.settings.romanLists !== false;
  }

  enable() {
    const ws = this.app.workspace;
    this.extensions.push(listLines((view) => {
      const style = view.contentDOM.ownerDocument.defaultView.getComputedStyle(view.contentDOM);
      const size = parseFloat(style.fontSize) || 16;
      return this.measure(view.contentDOM.ownerDocument, [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].filter(Boolean).join(' '), size);
    }));
    if (typeof ws.updateOptions === 'function') ws.updateOptions();
    this.redrawReading();
    this.add(() => {
      this.extensions.length = 0;
      if (typeof ws.updateOptions === 'function') ws.updateOptions();
      this.redrawReading(); // the feature is off by now: the lists go back to the paragraphs they were
    });
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
    if (!isMarker(m[2], near.sibling)) return null;
    const kind = readMarker(m[2], near.sibling).kind;
    if ((kind === 'roman' && this.settings.romanLists === false) || (kind === 'letter' && this.settings.letterLists === false)) return null;
    return { at, line, m, near };
  }

  /** Puts `marker` and `indent` in place of the item's, keeping the cursor on the same word. */
  remark(editor, it, indent, marker) {
    const { at, m } = it;
    const head = `${indent}${marker}${m[3]}${m[4]}`;
    const old = m[1].length + m[2].length + m[3].length + m[4].length;
    editor.replaceRange(head, { line: at.line, ch: 0 }, { line: at.line, ch: old });
    editor.setCursor({ line: at.line, ch: Math.max(head.length, at.ch + head.length - old) });
  }

  /** At the end of a list item: starts the next (or, on an empty item, steps out or ends the list). Returns whether it did. */
  carryOn(editor) {
    const it = this.item(editor);
    if (!it || it.at.ch < it.line.length) return false;
    const { at, line, m, near } = it;
    // A lone "a." is a sentence's start more often than a list: carried on only once the list has two items, or the item has words.
    if (!m[5].trim()) {
      if (m[1]) return this.outdent(editor);
      if (!near.sibling) return false;
      editor.replaceRange('', { line: at.line, ch: 0 }, { line: at.line, ch: line.length });
      return true;
    }
    const next = `\n${m[1]}${nextMarker(m[2], near.sibling)}${m[3]}${m[4]}`;
    editor.replaceRange(next, at);
    editor.setCursor({ line: at.line + 1, ch: next.length - 1 });
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

  convert(editor, kind) {
    const from = editor.getCursor('from').line;
    const to = editor.getCursor('to').line;
    const lines = [];
    for (let i = from; i <= to; i++) lines.push(editor.getLine(i));
    editor.replaceRange(makeList(lines, kind).join('\n'), { line: from, ch: 0 }, { line: to, ch: editor.getLine(to).length });
  }

  /** Reading view: each paragraph or numbered item whose lines end in lettered or roman items has them made a list. */
  render(root, ctx) {
    const info = ctx && typeof ctx.getSectionInfo === 'function' ? ctx.getSectionInfo(root) : null;
    const source = info ? info.text.split('\n').slice(info.lineStart, info.lineEnd + 1) : null;
    Array.from(root.querySelectorAll('p, li')).concat(/^(P|LI)$/.test(root.tagName) ? [root] : []).forEach((block) => rebuildList(block, source));
  }

  /** Reading views drawn again, so a list is made, or undone, in what is already open. */
  redrawReading() {
    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const preview = leaf.view && leaf.view.previewMode;
      if (preview && typeof preview.rerender === 'function') preview.rerender(true);
    });
  }

  actions() {
    return [
      { id: 'make-lettered-list', name: 'Make a lettered list', on: 'editor', menu: false, when: () => this.settings.letterLists !== false, run: (ctx) => this.convert(ctx.editor, 'letter') },
      { id: 'make-roman-numeral-list', name: 'Make a roman numeral list', on: 'editor', menu: false, when: () => this.settings.romanLists !== false, run: (ctx) => this.convert(ctx.editor, 'roman') },
    ];
  }
}
