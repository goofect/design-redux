/* ------------------------------------------------------------------ */
/* Lists written as text: typing in them                               */
/*                                                                     */
/* What Obsidian's own lists do as one types, for the markers it takes */
/* for no list (3.1.1., a., iv.): Enter carries the list on, or splits */
/* an item where the cursor is; Backspace just after a marker takes it */
/* away; Tab and Shift-Tab move an item a level in or out as typed (no */
/* marker of their own); an item moves up or down with what is under  */
/* it; and after any change that adds or takes away lines, the numbers */
/* after it count on, in the same Undo. Every step returns whether it  */
/* did anything, so on any other line Obsidian's own keys run.         */
/* ------------------------------------------------------------------ */

import { EditorState } from '@codemirror/state';
import { around, depth, entryOf, isMarker, LIST_ITEM, listStarts, nextMarker, readMarker, renumber } from './list-markers.js';

const lead = (line) => depth(/^[ \t]*/.exec(line)[0]);

/** Lines as an editor holds them, to work a change out in before it is written: the part of Obsidian's Editor the steps use. */
class Lines {
  constructor(lines, cursor) {
    this.lines = lines.slice();
    this.from = cursor;
    this.to = cursor;
  }

  getLine(n) {
    return this.lines[n] === undefined ? '' : this.lines[n];
  }

  lineCount() {
    return this.lines.length;
  }

  getCursor(which) {
    return which === 'from' ? this.from : this.to;
  }

  setCursor(pos) {
    this.from = pos;
    this.to = pos;
  }

  offset(pos) {
    return this.lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.ch;
  }

  transaction({ changes }) {
    let text = this.lines.join('\n');
    changes.map((c) => ({ from: this.offset(c.from), to: this.offset(c.to || c.from), text: c.text }))
      .sort((a, b) => b.from - a.from)
      .forEach((c) => (text = text.slice(0, c.from) + c.text + text.slice(c.to)));
    this.lines = text.split('\n');
  }

  replaceRange(text, from, to = from) {
    this.transaction({ changes: [{ from, to, text }] });
  }
}

const linesOf = (editor) => Array.from({ length: editor.lineCount() }, (_, i) => editor.getLine(i));

export class ListEditing {
  /** `unit()` is one indent as the vault writes it: a tab, or its width in spaces. */
  constructor(unit) {
    this.unit = unit;
    this.writing = false;
  }

  /** The marked item the cursor is on, if nothing spans lines. */
  item(editor) {
    const from = editor.getCursor('from');
    const at = editor.getCursor('to');
    if (from.line !== at.line) return null;
    const line = editor.getLine(at.line);
    const m = LIST_ITEM.exec(line);
    if (!m) return null;
    const near = around(editor, at.line, depth(m[1]));
    if (!isMarker(m[2], near.sibling, m[3], near.parent)) return null;
    const head = m[1].length + m[2].length + m[3].length + m[4].length;
    return { at, line, m, near, head, kind: readMarker(m[2], near.sibling).kind };
  }

  /**
   * Writes the line edits and the list counted on after them in one change,
   * one Undo, as Obsidian does for its own lists; then the cursor. `edits`
   * are [{ line, from, to, text }] in the text as it was.
   */
  write(editor, edits, cursor) {
    const seen = new Set();
    const changes = edits.filter((c) => !seen.has(`${c.line}:${c.from}`) && seen.add(`${c.line}:${c.from}`));
    this.writing = true;
    try {
      editor.transaction({ changes: changes.map((c) => ({ from: { line: c.line, ch: c.from }, to: { line: c.line, ch: c.to }, text: c.text })) });
    } finally {
      this.writing = false;
    }
    editor.setCursor(cursor);
  }

  /** Writes lines worked out in full: only those that differ, in one change; then the cursor. */
  writeLines(editor, before, after, cursor) {
    const edits = after.map((text, i) => (text === before[i] ? null : { line: i, from: 0, to: before[i].length, text })).filter(Boolean);
    if (edits.length) this.write(editor, edits, cursor);
    return edits.length > 0;
  }

  /** Puts `marker` and `indent` in place of the item's, keeping the cursor on the same word; the list after it, and the one it left, count on. */
  remark(editor, it, indent, marker) {
    const { at, m, line } = it;
    // A plain number is Markdown's own list only with its stop: "1.1" stepping out to "2" is written "2.".
    const stop = m[3] || (/^\d+$/.test(marker) ? '.' : '');
    const head = `${indent}${marker}${stop}${m[4]}`;
    const lineOf = (i) => (i === at.line ? head + line.slice(it.head) : editor.getLine(i));
    const count = editor.lineCount();
    // The items it was among count on from the one above it there, where it moved in or out.
    const left = indent !== m[1] && it.near.siblingAt !== undefined ? renumber(lineOf, count, it.near.siblingAt) : [];
    this.write(editor, [{ line: at.line, from: 0, to: it.head, text: head }].concat(renumber(lineOf, count, at.line), left),
      { line: at.line, ch: Math.max(head.length, at.ch + head.length - it.head) });
  }

  /**
   * Enter in an item: at its end, starts the next; within its words, splits
   * it there, the words after the cursor the next item's; on an empty item,
   * steps out or ends the list. Returns whether it did.
   */
  carryOn(editor) {
    const it = this.item(editor);
    if (!it || it.at.ch < it.head) return false;
    const { at, line, m, near } = it;
    // A lone "a." is a sentence's start more often than a list: carried on only once the list has two items, or the item has words.
    if (!m[5].trim() && at.ch === line.length) {
      if (m[1]) return this.stepOut(editor);
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
    const rest = line.slice(at.ch).replace(/^[ \t]+/, '');
    // The items after it count on from the new one: read as if it were in, written in the text as it is.
    const lineOf = (i) => (i < at.line ? editor.getLine(i) : i === at.line ? line.slice(0, at.ch) : i === at.line + 1 ? head + rest : editor.getLine(i - 1));
    const after = renumber(lineOf, editor.lineCount() + 1, at.line + 1).map((c) => Object.assign(c, { line: c.line - 1 }));
    this.write(editor, [{ line: at.line, from: at.ch, to: line.length, text: `\n${head}${rest}` }].concat(after), { line: at.line + 1, ch: head.length });
    return true;
  }

  /** Backspace just after an item's marker: takes the marker away (the item becomes more of the one above), and the list counts on without it. */
  unmark(editor) {
    const from = editor.getCursor('from');
    const it = this.item(editor);
    if (!it || from.ch !== it.at.ch || it.at.ch !== it.head) return false;
    const { at, line, m, near } = it;
    const text = m[1] + line.slice(it.head);
    const lineOf = (i) => (i === at.line ? text : editor.getLine(i));
    const count = editor.lineCount();
    let edits = [{ line: at.line, from: 0, to: line.length, text }];
    if (near.siblingAt !== undefined) {
      edits = edits.concat(renumber(lineOf, count, near.siblingAt));
    } else {
      // It was the first: the next item beside it takes its marker, and the rest count on from there.
      const d = depth(m[1]);
      for (let i = at.line + 1; i < count; i++) {
        const next = lineOf(i);
        if (!next.trim() || lead(next) > d) continue;
        const e = lead(next) === d && entryOf(next);
        if (e && e.kind !== 'number') {
          const taken = (k) => (k === i ? next.slice(0, e.at) + m[2] + next.slice(e.end) : lineOf(k));
          edits = edits.concat({ line: i, from: e.at, to: e.end, text: m[2] }, renumber(taken, count, i));
        }
        break;
      }
    }
    this.write(editor, edits, { line: at.line, ch: m[1].length });
    return true;
  }

  /**
   * Tab on an item: one indent in, the item as typed (no marker of its own,
   * nothing counted on). Several lines selected, or a line that is no item,
   * are left to Obsidian.
   */
  indent(editor) {
    const it = this.item(editor);
    if (!it) return false;
    const unit = this.unit();
    this.write(editor, [{ line: it.at.line, from: 0, to: 0, text: unit }], { line: it.at.line, ch: it.at.ch + unit.length });
    return true;
  }

  /** Shift-Tab on an item: one indent out, the item as typed. At the margin, or on anything else, Obsidian's. */
  outdent(editor) {
    const it = this.item(editor);
    const cut = it && /^(\t| {1,4})/.exec(it.m[1]);
    if (!cut) return false;
    this.write(editor, [{ line: it.at.line, from: 0, to: cut[0].length, text: '' }], { line: it.at.line, ch: Math.max(0, it.at.ch - cut[0].length) });
    return true;
  }

  /** Enter on an empty item that is indented: one level out, carrying on the list it steps back into. */
  stepOut(editor) {
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
   * Moves the item the cursor is on past the one before it (`by` -1) or
   * after it (1), each with what is under it; the markers stay where they
   * were and the list counts on. Returns whether it did.
   */
  move(editor, by) {
    const it = this.item(editor);
    if (!it) return false;
    const lines = linesOf(editor);
    const d = depth(it.m[1]);
    // What belongs to an item: deeper lines, its own words at its indent, and blank lines with more of it after them.
    const words = (i) => d > 0 && lead(lines[i]) === d && !LIST_ITEM.test(lines[i]) && !entryOf(lines[i]);
    const blockOf = (start) => {
      let end = start;
      for (let i = start + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (lead(lines[i]) < d || (lead(lines[i]) === d && !words(i))) break;
        end = i;
      }
      return [start, end];
    };
    const sibling = (i) => i >= 0 && i < lines.length && lead(lines[i]) === d && LIST_ITEM.test(lines[i]);
    const own = blockOf(it.at.line);
    let other = null;
    if (by < 0) {
      for (let i = own[0] - 1; i >= 0; i--) {
        if (!lines[i].trim() || lead(lines[i]) > d || words(i)) continue;
        if (sibling(i)) other = blockOf(i);
        break;
      }
    } else {
      let i = own[1] + 1;
      while (i < lines.length && !lines[i].trim()) i++;
      if (sibling(i)) other = blockOf(i);
    }
    if (!other) return false;
    const [a, b] = by < 0 ? [other, own] : [own, other];
    const marker = (i) => LIST_ITEM.exec(lines[i])[2];
    const firstMarker = marker(a[0]);
    const moved = lines.slice(0, a[0]).concat(lines.slice(b[0], b[1] + 1), lines.slice(a[1] + 1, b[0]), lines.slice(a[0], a[1] + 1), lines.slice(b[1] + 1));
    // The first of the two keeps the place's marker, and the rest count on from it.
    const m = LIST_ITEM.exec(moved[a[0]]);
    moved[a[0]] = `${m[1]}${firstMarker}${m[3]}${m[4]}${m[5]}`;
    const work = new Lines(moved, it.at);
    renumber((i) => work.getLine(i), work.lineCount(), a[0]).sort((x, y) => y.line - x.line || y.from - x.from)
      .forEach((c) => (work.lines[c.line] = work.lines[c.line].slice(0, c.from) + c.text + work.lines[c.line].slice(c.to)));
    const at = by < 0 ? a[0] : a[0] + (b[1] - a[1]);
    return this.writeLines(editor, lines, work.lines, { line: at, ch: it.at.ch });
  }
}

/**
 * The lists counted on after any change that adds or takes away lines
 * (a line deleted, pasted, moved), as Obsidian counts its own on: in the
 * same change, so one Undo takes it all back. Lines of Obsidian's own
 * lists are left to Obsidian. `ours()` says the plugin itself is writing
 * (its steps count on already); typing within a line is left as typed.
 */
export function countOn(ours) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || ours() || tr.startState.doc.lines === tr.newDoc.lines) return tr;
    if (tr.isUserEvent('input.type') || tr.isUserEvent('input.renumber') || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr;
    const doc = tr.newDoc;
    const lineOf = (i) => (i >= 0 && i < doc.lines ? doc.line(i + 1).text : '');
    const edits = [];
    const done = new Set();
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      [fromB, toB].forEach((pos) => {
        const n = doc.lineAt(Math.min(pos, doc.length)).number - 1;
        // From the change's line, and the line after it (a deleted item's list goes on below).
        [n, n + 1].forEach((k) => listStarts(lineOf, doc.lines, Math.min(k, doc.lines - 1)).forEach((start) => {
          if (done.has(start)) return;
          done.add(start);
          renumber(lineOf, doc.lines, start).forEach((c) => {
            const e = entryOf(lineOf(c.line));
            if (e && e.kind !== 'number') edits.push(c);
          });
        }));
      });
    }, true);
    if (!edits.length) return tr;
    const seen = new Set();
    const changes = edits.filter((c) => !seen.has(`${c.line}:${c.from}`) && seen.add(`${c.line}:${c.from}`))
      .map((c) => ({ from: doc.line(c.line + 1).from + c.from, to: doc.line(c.line + 1).from + c.to, insert: c.text }));
    return [tr, { changes, sequential: true }];
  });
}
