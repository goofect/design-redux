/* ------------------------------------------------------------------ */
/* Lettered, roman and outline lists: in the editor                    */
/*                                                                     */
/* An item's line is drawn as Obsidian draws a line of its own         */
/* numbered lists: its list-line classes (spacing, a tab a level wide, */
/* the fold arrow's place) and its marker's (grey, the live preview's  */
/* inset). A long item wraps under its words: Obsidian already hangs   */
/* an indented line by its indent, each level a span --list-indent     */
/* wide, with a style on the line; the item's style comes after it and */
/* adds the inset and the marker, held in a span as wide as the hang   */
/* reckons (its figures as the font has them, as measured), so the     */
/* words start just where the wrap does. Code, maths and frontmatter   */
/* are left be.                                                        */
/* ------------------------------------------------------------------ */

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { around, depth, isMarker, LIST_ITEM } from './list-markers.js';

// The marker as Obsidian marks a number of its own lists: grey, set in by the live preview's inset.
const PREFIX = Decoration.mark({ class: 'dr-list-prefix cm-formatting-list cm-formatting-list-ol' });

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
    const near = isMarker(m[2], null, m[3]) ? {} : around(lines, n - 1, depth(m[1]));
    if (!isMarker(m[2], near.sibling, m[3], near.parent)) continue;
    // Indent levels: a tab, or a tab's width of spaces; each is Obsidian's --list-indent wide, or a tab where that is not set.
    const levels = Math.ceil(depth(m[1]) / tab);
    const mark = width(`${m[2]}${m[3]}${m[4]}`);
    const hang = `calc(${levels} * var(--list-indent, ${width(' '.repeat(tab))}px) + var(--list-padding-inline-start, 0px) + ${mark}px)`;
    const style = `--dr-mark: ${mark}px; --dr-hang: ${hang}; padding-inline-start: var(--dr-hang); text-indent: calc(-1 * var(--dr-hang))`;
    // Obsidian's list line, a level a step in: its spacing, and its fold arrow placed as on its own numbered items.
    out.add(line.from, line.from, Decoration.line({ class: `dr-marked-item HyperMD-list-line HyperMD-list-line-${levels + 1}`, attributes: { style } }));
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
