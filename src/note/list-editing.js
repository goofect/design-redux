/* ------------------------------------------------------------------ */
/* Lists written as text: moving an item                               */
/*                                                                     */
/* Typing in a list written as text (3.1.1., a., iv.) is Obsidian's,   */
/* as in any text: no key of the plugin's, nothing counted on behind   */
/* the person's back. Two commands, run only when asked, move an item  */
/* up or down past its neighbour with what is under it, the markers    */
/* staying where they were and the list counting on.                   */
/* ------------------------------------------------------------------ */

import { around, depth, entryOf, isMarker, LIST_ITEM, readMarker, renumber } from './list-markers.js';

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

  /** Writes line edits in one change, one Undo; then the cursor. `edits` are [{ line, from, to, text }] in the text as it was. */
  write(editor, edits, cursor) {
    const seen = new Set();
    const changes = edits.filter((c) => !seen.has(`${c.line}:${c.from}`) && seen.add(`${c.line}:${c.from}`));
    editor.transaction({ changes: changes.map((c) => ({ from: { line: c.line, ch: c.from }, to: { line: c.line, ch: c.to }, text: c.text })) });
    editor.setCursor(cursor);
  }

  /** Writes lines worked out in full: only those that differ, in one change; then the cursor. */
  writeLines(editor, before, after, cursor) {
    const edits = after.map((text, i) => (text === before[i] ? null : { line: i, from: 0, to: before[i].length, text })).filter(Boolean);
    if (edits.length) this.write(editor, edits, cursor);
    return edits.length > 0;
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
