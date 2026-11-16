/* ------------------------------------------------------------------ */
/* Lettered and roman numeral lists                                    */
/*                                                                     */
/* Markdown numbers lists 1., 2., 3. and nothing else, so a list       */
/* written a., b., c. or i., ii., iii. is plain paragraphs to          */
/* Obsidian. Two commands turn the selected lines into one or the      */
/* other; Enter at the end of an item carries on with the next letter  */
/* or numeral; in reading view such a paragraph is marked so it is     */
/* set as a list. The note's text is what was written.                 */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

/** 1 → i, 4 → iv, 14 → xiv. */
export function toRoman(n) {
  let out = '';
  ROMAN.forEach(([value, mark]) => { while (n >= value) { out += mark; n -= value; } });
  return out;
}

/** i → 1, xiv → 14; 0 for what is not a numeral as it would be written. */
export function fromRoman(text) {
  const s = String(text).toLowerCase();
  let n = 0;
  let at = 0;
  ROMAN.forEach(([value, mark]) => { while (s.startsWith(mark, at)) { n += value; at += mark.length; } });
  return at === s.length && n > 0 && toRoman(n) === s ? n : 0;
}

/** 1 → a, 26 → z, 27 → aa. */
export function toLetters(n) {
  let out = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(97 + ((n - 1) % 26)) + out;
  return out;
}

export function fromLetters(text) {
  return /^[a-z]+$/.test(text) ? Array.from(text).reduce((n, c) => n * 26 + (c.charCodeAt(0) - 96), 0) : 0;
}

export const LIST_ITEM = /^([ \t]*)([a-z]+)([.)])([ \t]+)(.*)$/i;

/**
 * How a marker is read. Some letters are numerals too (i, v, x…), so what
 * one is depends on the item before it: "i" after "h" is the ninth letter.
 * `before` is the marker of the item above, if there is one.
 */
export function readMarker(marker, before) {
  const m = marker.toLowerCase();
  const roman = fromRoman(m);
  if (before) {
    const b = readMarker(before);
    if (b.kind === 'letter' && fromLetters(m) === b.n + 1) return { kind: 'letter', n: fromLetters(m), upper: marker !== m };
    if (b.kind === 'roman' && roman === b.n + 1) return { kind: 'roman', n: roman, upper: marker !== m };
  }
  if (roman && (m.length > 1 || m === 'i')) return { kind: 'roman', n: roman, upper: marker !== m };
  return { kind: 'letter', n: fromLetters(m), upper: marker !== m };
}

/** The marker that follows one. */
export function nextMarker(marker, before) {
  const r = readMarker(marker, before);
  const next = r.kind === 'roman' ? toRoman(r.n + 1) : toLetters(r.n + 1);
  return r.upper ? next.toUpperCase() : next;
}

/** Lines made a list of a kind: any marker they had (a dash, a number, a letter) gives way to the new one. */
export function makeList(lines, kind) {
  let n = 0;
  return lines.map((line) => {
    if (!line.trim()) return line;
    const m = /^([ \t]*)(?:[-*+]|\d+[.)]|[a-z]+[.)])?[ \t]*(.*)$/i.exec(line);
    n++;
    return `${m[1]}${kind === 'roman' ? toRoman(n) : toLetters(n)}. ${m[2]}`;
  });
}

export class MarkedLists extends Feature {
  register() {
    this.plugin.registerMarkdownPostProcessor((el) => this.on && this.render(el));
  }

  get wanted() {
    return this.settings.letterLists !== false || this.settings.romanLists !== false;
  }

  enable() {
    // Enter at the end of an item carries the list on.
    this.listenDom(activeDocument, 'keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      const view = this.app.workspace.activeEditor || null;
      const editor = view && view.editor;
      if (!editor || !e.target.closest || !e.target.closest('.cm-content')) return;
      if (this.carryOn(editor)) e.preventDefault();
    }, true);
  }

  /** At the end of a list item: starts the next (or, on an empty item, ends the list). Returns whether it did. */
  carryOn(editor) {
    const at = editor.getCursor();
    const line = editor.getLine(at.line);
    const m = LIST_ITEM.exec(line);
    if (!m || at.ch < line.length) return false;
    const above = at.line > 0 ? LIST_ITEM.exec(editor.getLine(at.line - 1)) : null;
    const kind = readMarker(m[2], above ? above[2] : null).kind;
    if ((kind === 'roman' && this.settings.romanLists === false) || (kind === 'letter' && this.settings.letterLists === false)) return false;
    // A lone "a." is a sentence's start more often than a list: carried on only once the list has two items, or the item has words.
    if (!m[5].trim()) {
      if (!above) return false;
      editor.replaceRange('', { line: at.line, ch: 0 }, { line: at.line, ch: line.length });
      return true;
    }
    const next = `\n${m[1]}${nextMarker(m[2], above ? above[2] : null)}${m[3]}${m[4]}`;
    editor.replaceRange(next, at);
    editor.setCursor({ line: at.line + 1, ch: next.length - 1 });
    return true;
  }

  convert(editor, kind) {
    const from = editor.getCursor('from').line;
    const to = editor.getCursor('to').line;
    const lines = [];
    for (let i = from; i <= to; i++) lines.push(editor.getLine(i));
    editor.replaceRange(makeList(lines, kind).join('\n'), { line: from, ch: 0 }, { line: to, ch: editor.getLine(to).length });
  }

  /** Reading view: a paragraph whose every line is an item is marked as a list of its kind. */
  render(root) {
    Array.from(root.querySelectorAll('p')).concat(root.tagName === 'P' ? [root] : []).forEach((p) => {
      const lines = p.textContent.split('\n').filter((l) => l.trim());
      if (lines.length < 2 || !lines.every((l) => LIST_ITEM.test(l))) return;
      const kind = readMarker(LIST_ITEM.exec(lines[1])[2], LIST_ITEM.exec(lines[0])[2]).kind;
      p.classList.add('dr-marked-list', kind === 'roman' ? 'is-roman' : 'is-lettered');
    });
  }

  actions() {
    return [
      { id: 'make-lettered-list', name: 'Make a lettered list', glyph: 'list-lettered', on: 'editor', menu: false, when: () => this.settings.letterLists !== false, run: (ctx) => this.convert(ctx.editor, 'letter') },
      { id: 'make-roman-numeral-list', name: 'Make a roman numeral list', glyph: 'list-roman', on: 'editor', menu: false, when: () => this.settings.romanLists !== false, run: (ctx) => this.convert(ctx.editor, 'roman') },
    ];
  }

  settingsRows() {
    return [
      { key: 'letterLists', name: 'Lettered lists', desc: 'a., b., c.', type: 'toggle' },
      { key: 'romanLists', name: 'Roman numeral lists', desc: 'i., ii., iii.', type: 'toggle' },
    ];
  }
}
MarkedLists.title = 'Lettered and roman lists';
MarkedLists.glyph = 'list-lettered';
MarkedLists.section = 'Notes';
MarkedLists.about = 'Lists marked a, b, c or i, ii, iii, carried on as you write.';
