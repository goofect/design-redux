/* ------------------------------------------------------------------ */
/* Lettered and roman lists: in the editor                             */
/*                                                                     */
/* An item's line hangs, as Obsidian's own list lines do: a long item  */
/* wraps under its words, not under its marker. Obsidian already hangs */
/* an indented line by its indent, each level a span --list-indent     */
/* wide, with a style on the line; the item's style comes after it and */
/* adds the marker, held in a span as wide as the hang reckons, so the */
/* words start just where the wrap does. Code, maths and frontmatter   */
/* are left be.                                                        */
/* ------------------------------------------------------------------ */

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { around, depth, isMarker, LIST_ITEM } from './list-markers.js';

const PREFIX = Decoration.mark({ class: 'dr-list-prefix' });

/** Whether a position is in code, maths, a comment or frontmatter, by the names of Obsidian's syntax nodes. */
function ignored(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/code|frontmatter|math|comment/i.test(node.name)) return true;
  }
  return false;
}

/**
 * The item lines between `from` and `to`, decorated to hang by their
 * prefix: `width(text)` measures text in the editor's font, `tab` is how
 * many spaces a tab is.
 */
export function itemLines(state, from, to, width, tab = 4) {
  const out = new RangeSetBuilder();
  const doc = state.doc;
  const lines = { getLine: (i) => (i >= 0 && i < doc.lines ? doc.line(i + 1).text : '') };
  for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
    const line = doc.line(n);
    const m = LIST_ITEM.exec(line.text);
    if (!m || ignored(state, line.from)) continue;
    const sibling = m[2].length > 1 && !isMarker(m[2]) ? around(lines, n - 1, depth(m[1])).sibling : null;
    if (!isMarker(m[2], sibling)) continue;
    // Indent levels: a tab, or a tab's width of spaces; each is Obsidian's --list-indent wide, or a tab where that is not set.
    const levels = Math.ceil(depth(m[1]) / tab);
    const mark = width(`${m[2]}${m[3]}${m[4]}`);
    const hang = `calc(${levels} * var(--list-indent, ${width(' '.repeat(tab))}px) + ${mark}px)`;
    const style = `--dr-mark: ${mark}px; --dr-hang: ${hang}; padding-inline-start: var(--dr-hang); text-indent: calc(-1 * var(--dr-hang))`;
    out.add(line.from, line.from, Decoration.line({ class: 'dr-marked-item', attributes: { style } }));
    out.add(line.from + m[1].length, line.from + m[1].length + m[2].length + m[3].length + m[4].length, PREFIX);
  }
  return out.finish();
}

/** The editor extension: item lines hung in what is on screen, redrawn when the text or the view moves. */
export function listLines(measure) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.draw(view);
      }

      update(u) {
        if (u.docChanged || u.viewportChanged || u.geometryChanged) this.draw(u.view);
      }

      draw(view) {
        this.decorations = itemLines(view.state, view.viewport.from, view.viewport.to, measure(view), view.state.tabSize || 4);
      }
    },
    { decorations: (v) => v.decorations }
  );
}
