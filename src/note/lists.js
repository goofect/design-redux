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
// Any item a lettered one can sit beside or under: a dash, a number, a letter or numeral.
const ANY_ITEM = /^([ \t]*)([-*+]|\d+[.)]|[a-z]+[.)])[ \t]/i;

/** How deep a line's indent is, a tab as four spaces. */
const depth = (ws) => ws.replace(/\t/g, '    ').length;

/**
 * The items around line `at` for an item `deep` in: `sibling`, the marker of
 * the nearest item above at that depth; `parent`, of the nearest shallower one.
 */
export function around(editor, at, deep) {
  for (let i = at - 1; i >= 0; i--) {
    const line = editor.getLine(i);
    if (!line.trim()) continue;
    const m = ANY_ITEM.exec(line);
    const d = depth(/^[ \t]*/.exec(line)[0]);
    if (d < deep) return { sibling: null, parent: m ? m[2].replace(/[.)]$/, '') : null };
    if (d === deep) {
      if (!m) return { sibling: null, parent: null };
      return { sibling: m[2].replace(/[.)]$/, ''), parent: null, siblingAt: i };
    }
  }
  return { sibling: null, parent: null };
}

/**
 * How a marker is read. Some letters are numerals too (i, v, x…), so what
 * one is depends on the item before it: "i" after "h" is the ninth letter.
 * `before` is the marker of the item above, if there is one.
 */
export function readMarker(marker, before) {
  if (/^\d+$/.test(marker)) return { kind: 'number', n: Number(marker), upper: false };
  if (/^[-*+]$/.test(marker)) return { kind: 'bullet', n: 0, upper: false };
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
  if (r.kind === 'number') return String(r.n + 1);
  if (r.kind === 'bullet') return marker;
  const next = r.kind === 'roman' ? toRoman(r.n + 1) : toLetters(r.n + 1);
  return r.upper ? next.toUpperCase() : next;
}

/** The first marker of a list under an item: a, then i, then a again; under "I" a capital "A". */
export function firstUnder(parent, before) {
  const r = parent ? readMarker(parent, before) : { kind: 'number' };
  if (r.kind === 'letter') return 'i';
  return r.kind === 'roman' && r.upper ? 'A' : 'a';
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
    this.listenDom(activeDocument, 'keydown', keys, true);
    this.listen(this.app.workspace, 'window-open', (win) => {
      const doc = win && (win.doc || (win.win && win.win.document));
      if (doc) this.listenDom(doc, 'keydown', keys, true);
    });
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
    // "Mr. Smith" is no item: a marker is one letter, a numeral, or the letters after the item above (z, aa).
    const sibling = near.sibling && /^[a-z]+$/i.test(near.sibling) ? fromLetters(near.sibling.toLowerCase()) : 0;
    if (m[2].length > 1 && !fromRoman(m[2]) && !(sibling && fromLetters(m[2].toLowerCase()) === sibling + 1)) return null;
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
      { id: 'make-lettered-list', name: 'Make a lettered list', on: 'editor', menu: false, when: () => this.settings.letterLists !== false, run: (ctx) => this.convert(ctx.editor, 'letter') },
      { id: 'make-roman-numeral-list', name: 'Make a roman numeral list', on: 'editor', menu: false, when: () => this.settings.romanLists !== false, run: (ctx) => this.convert(ctx.editor, 'roman') },
    ];
  }
}
MarkedLists.title = 'Lettered and roman lists';
MarkedLists.section = 'Notes';
MarkedLists.about = 'Lists marked a, b, c or i, ii, iii, carried on as you write.';
