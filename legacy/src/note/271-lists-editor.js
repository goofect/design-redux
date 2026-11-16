/* ------------------------------------------------------------------ */
/* Lettered and roman numeral lists: in the editor                     */
/*                                                                     */
/* Styled as a list, and continued with the next letter or numeral     */
/* when Enter is pressed; how a marker is read is 270-lists's.         */
/* ------------------------------------------------------------------ */

import { syntaxTree } from '@codemirror/language';
import { Prec, RangeSetBuilder } from '@codemirror/state';
import { Decoration, keymap, ViewPlugin } from '@codemirror/view';
import { leadingSpace, LIST_FENCE, LIST_HINT, listItemAbove, listLimit, listMarker, parseListItem, sameListStyle } from './270-lists.js';

/* -- the editor -------------------------------------------------------- */

/**
 * Code, maths, comments and frontmatter are left alone. Obsidian's
 * syntax tree names its nodes after the tokens they hold, so the names
 * say which of these a position is in.
 */
export function listIgnored(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/code|frontmatter|math|comment/i.test(node.name)) return true;
  }
  return false;
}

export function listItemAt(state, lineNo, known) {
  if (known && known.has(lineNo)) return known.get(lineNo);
  const line = state.doc.line(lineNo);
  let item = null;
  if (LIST_HINT.test(line.text) && !listIgnored(state, line.from)) {
    item = parseListItem(line.text, () =>
      listItemAbove(state.doc, lineNo, leadingSpace(line.text), known)
    );
  }
  if (known) known.set(lineNo, item);
  return item;
}

/**
 * The items after an insertion move up one, so the list still counts
 * in order. Each is read against the item written before it, not the
 * new numbering, so "i" after "h" stays a letter as it moves. Nested
 * lines are passed over, text straight after an item is part of it,
 * and the list ends at anything else — a different kind of marker,
 * less indentation, or two blank lines.
 */
export function renumberListAfter(state, lineNo, like, expected, changes) {
  const doc = state.doc;
  let next = expected;
  let blank = 0;
  let written = like;
  for (let n = lineNo + 1; n <= doc.lines && n <= lineNo + 2000; n++) {
    const line = doc.line(n);
    if (!line.text.trim()) {
      blank++;
      if (blank > 1) return;
      continue;
    }
    // A code or maths block ends the list: what's inside isn't items,
    // however much it looks like them.
    if (LIST_FENCE.test(line.text) || listIgnored(state, line.from)) return;
    const indent = leadingSpace(line.text);
    if (indent.length > like.indent.length) {
      blank = 0;
      continue;
    }
    const item = parseListItem(line.text, written);
    if (!item || item.indent !== like.indent || !sameListStyle(item, like)) {
      // Text straight after an item continues it; after a gap, it's not the list.
      if (item || blank || indent.length < like.indent.length) return;
      continue;
    }
    blank = 0;
    written = item;
    if (next > listLimit(like.kind)) return;
    if (item.value !== next) {
      const from = line.from + item.indent.length;
      changes.push({ from, to: from + item.marker.length, insert: listMarker(next, like) });
    }
    next++;
  }
}

/**
 * Enter on an item starts the next one, as it does for numbers: "b. "
 * after "a. …", "iv. " after "iii. …", in the same case and punctuation,
 * at the same indent. Whatever was after the cursor goes with it. Enter
 * on an item with nothing in it ends the list instead. Anything else is
 * left to Obsidian, including Vim's normal mode and text being composed.
 */
export function listEnter(view) {
  const state = view.state;
  if (view.composing) return false;
  const vim = view.cm && view.cm.state && view.cm.state.vim;
  if (vim && !vim.insertMode) return false;

  const sel = state.selection.main;
  if (state.selection.ranges.length !== 1 || !sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const item = listItemAt(state, line.number);
  if (!item || sel.head < line.from + item.prefix) return false;

  if (!line.text.slice(item.prefix).trim()) {
    const from = line.from + item.indent.length;
    view.dispatch({
      changes: { from, to: line.to },
      selection: { anchor: from },
      userEvent: 'delete',
    });
    return true;
  }

  const value = item.value + 1;
  if (value > listLimit(item.kind)) return false;
  const after = state.doc.sliceString(sel.head, line.to);
  const skip = after.length - after.replace(/^[ \t]+/, '').length;
  const insert = `\n${item.indent}${listMarker(value, item)} `;
  const changes = [{ from: sel.head, to: sel.head + skip, insert }];
  renumberListAfter(state, line.number, item, value + 1, changes);

  view.dispatch({
    changes,
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

/**
 * Text widths in the editor's own font, for the hanging indent. A
 * canvas measures without touching the page; where there's none, an
 * estimate from the font size.
 */
export function listMeasurer(view) {
  const style = window.getComputedStyle(view.contentDOM);
  const font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily]
    .filter(Boolean)
    .join(' ');
  const size = parseFloat(style.fontSize) || 16;
  let ctx = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = font;
  } catch (err) {
    ctx = null;
  }
  const cache = new Map();
  const tab = ' '.repeat(view.state.tabSize || 4);
  return (text) => {
    const plain = text.replace(/\t/g, tab);
    if (!cache.has(plain)) {
      const width = ctx ? ctx.measureText(plain).width : plain.length * size * 0.5;
      cache.set(plain, Math.round(width * 10) / 10);
    }
    return cache.get(plain);
  };
}

export const LIST_MARK = Decoration.mark({ class: 'dr-list-marker' });

/**
 * Each item line is given the marker's colour and a hanging indent, so
 * a long item wraps under its text rather than under its letter —
 * both as Obsidian does for its own numbered lists.
 */
export function listDecorations(view, measure) {
  const builder = new RangeSetBuilder();
  const state = view.state;
  const known = new Map();
  let done = 0;
  view.visibleRanges.forEach(({ from, to }) => {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      // A fold inside a line splits it across two ranges; it's drawn once.
      if (line.number <= done) continue;
      done = line.number;
      const item = listItemAt(state, line.number, known);
      if (!item) continue;
      const width = measure(line.text.slice(0, item.prefix));
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: 'dr-marked-line',
          attributes: { style: `--dr-list-hang: ${width}px` },
        })
      );
      const start = line.from + item.indent.length;
      builder.add(start, start + item.marker.length, LIST_MARK);
    }
  });
  return builder.finish();
}

export function listEditorExtensions() {
  const decorations = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.measure = listMeasurer(view);
        this.decorations = listDecorations(view, this.measure);
      }

      update(u) {
        if (u.geometryChanged) this.measure = listMeasurer(u.view);
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.geometryChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          this.decorations = listDecorations(u.view, this.measure);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
  // Ahead of Obsidian's own list handling, which would otherwise take
  // Enter and start a plain line.
  return [Prec.highest(keymap.of([{ key: 'Enter', run: listEnter }])), decorations];
}
