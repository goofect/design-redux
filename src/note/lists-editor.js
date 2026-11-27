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
/* are left be. And a note's numbering (numbering.js): the numbered    */
/* items of Obsidian's own lists drawn with their labels in live       */
/* preview, the number Obsidian keeps showing where the cursor is.     */
/* ------------------------------------------------------------------ */

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { depth } from './list-markers.js';
import { labelOf, ORDERED, pathAt } from './numbering.js';
import { OutlineLayout, placeCss } from './outline-layout.js';

// The marker as Obsidian marks a number of its own lists: grey, set in by the live preview's inset.
const PREFIX = Decoration.mark({ class: 'dr-list-prefix cm-formatting-list cm-formatting-list-ol' });

/**
 * Whether a line's text is in code, maths, a comment or frontmatter, by
 * the names of Obsidian's syntax nodes, read where the text starts: a line
 * indented into a code block (hmd-indented-code) has no node over its indent.
 */
// Obsidian's tokens for code, maths, comments and frontmatter. A node's name is its tokens joined by "_", and since 1.15.0 a
// closing token gains a "formatting-…-end" segment, so a name is read a segment at a time, never matched whole.
const SKIPPED = new Set(['hmd-codeblock', 'hmd-indented-code', 'inline-code', 'formatting-code', 'hmd-frontmatter', 'math', 'formatting-math', 'comment', 'formatting-comment']);

function ignored(state, line, indent) {
  for (const pos of [line.from, line.from + indent]) {
    for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
      if (node.name.split('_').some((segment) => SKIPPED.has(segment))) return true;
    }
  }
  return false;
}

/**
 * The item lines between `from` and `to`, decorated to hang by their
 * prefix: `width(text)` measures text in the editor's font, `tab` is how
 * many spaces a tab is.
 */
/** A line's indent, drawn as wide as the layout says, with Obsidian's indentation guide under each item it is in. */
export class Indent extends WidgetType {
  constructor(width, guides) {
    super();
    this.width = width;
    this.guides = guides;
    this.key = [width].concat(guides).join('|');
  }

  eq(other) {
    return other.key === this.key;
  }

  toDOM(view) {
    const doc = view.dom.ownerDocument;
    const span = doc.createElement('span');
    span.className = 'dr-indent';
    span.style.setProperty('--dr-x', this.width);
    this.guides.forEach((at) => {
      const guide = span.appendChild(doc.createElement('span'));
      guide.className = 'dr-indent-guide';
      guide.style.setProperty('--dr-at', at);
    });
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * The lines between `from` and `to` of lists written as text. An item's
 * line hangs by its marker, as Obsidian hangs its own; and every line of
 * such a list (its items, the words under them, Obsidian's own items among
 * them) starts under the words of the item it belongs to (outline-layout.js),
 * its indent drawn that wide, with a guide under each item it is in where
 * `guides` says Obsidian draws them. `width(text)` measures in the editor's
 * font; `tab` is how many spaces a tab is.
 */
export function itemLines(state, from, to, width, tab = 4, guides = true) {
  const out = new RangeSetBuilder();
  const doc = state.doc;
  const lines = { getLine: (i) => (i >= 0 && i < doc.lines ? doc.line(i + 1).text : '') };
  const layout = new OutlineLayout(lines.getLine, doc.lines, width);
  for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
    const line = doc.line(n);
    const ws = /^[ \t]*/.exec(line.text)[0];
    if (!line.text.trim()) {
      // A blank line inside a list laid out here: the guides of the items around it go on through it, where those
      // items start. Its spaces, if any, are the plugin's indent then, as wide as the words typed on it would stand
      // (so the caret waits there, not at the margin), and Obsidian's guides at its own tab stops don't show.
      const marks = guides ? layout.blankAncestors(n - 1).map((a) => placeCss(layout.start(a))) : [];
      if (marks.length) {
        const indent = new Indent(ws.length ? placeCss(layout.blankStart(n - 1)) : '0px', marks);
        if (ws.length) out.add(line.from, line.from + ws.length, Decoration.replace({ widget: indent }));
        else out.add(line.from, line.from, Decoration.widget({ widget: indent, side: 1 }));
      }
      continue;
    }
    if (ignored(state, line, ws.length)) continue;
    const k = layout.kind(n - 1);
    if (layout.ours(n - 1)) {
      const start = layout.start(n - 1);
      const words = placeCss(layout.words(n - 1));
      const mark = k.kind === 'typed' ? width(k.head) : 0;
      const style = `--dr-mark: ${mark}px; padding-inline-start: ${words}; text-indent: calc(-1 * ${words})`;
      const cls = k.kind === 'typed' ? `dr-marked-item HyperMD-list-line HyperMD-list-line-${Math.ceil(depth(ws) / tab) + 1}` : 'dr-outline-line';
      out.add(line.from, line.from, Decoration.line({ class: cls, attributes: { style } }));
      const marks = guides ? layout.ancestors(n - 1).map((a) => placeCss(layout.start(a))) : [];
      if (ws.length) out.add(line.from, line.from + ws.length, Decoration.replace({ widget: new Indent(placeCss(start), marks) }));
      if (k.kind === 'typed') out.add(line.from + ws.length, line.from + ws.length + k.head.length, PREFIX);
      continue;
    }
    if (k.kind !== 'typed') continue;
    // At the margin, or among nothing laid out: indent levels, a tab or a tab's width of spaces, each Obsidian's --list-indent wide.
    const levels = Math.ceil(depth(ws) / tab);
    const mark = width(k.head);
    const hang = `calc(${levels} * var(--list-indent, ${width(' '.repeat(tab))}px) + var(--list-padding-inline-start, 0px) + ${mark}px)`;
    const style = `--dr-mark: ${mark}px; --dr-hang: ${hang}; padding-inline-start: var(--dr-hang); text-indent: calc(-1 * var(--dr-hang))`;
    // Obsidian's list line, a level a step in: its spacing, and its fold arrow placed as on its own numbered items.
    out.add(line.from, line.from, Decoration.line({ class: `dr-marked-item HyperMD-list-line HyperMD-list-line-${levels + 1}`, attributes: { style } }));
    out.add(line.from + ws.length, line.from + ws.length + k.head.length, PREFIX);
  }
  return out.finish();
}

/** The editor extension: item lines hung in what is on screen, redrawn when the text or the view moves. */
export function listLines(measure, guides = () => true) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.draw(view);
      }

      update(u) {
        if (u.docChanged || u.viewportChanged || u.geometryChanged) this.draw(u.view);
      }

      draw(view) {
        this.decorations = itemLines(view.state, view.viewport.from, view.viewport.to, measure(view), view.state.tabSize || 4, guides());
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/** A numbered item's label, drawn in the place of the number Obsidian keeps. */
class Label extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }

  eq(other) {
    return other.text === this.text;
  }

  toDOM(view) {
    const span = view.dom.ownerDocument.createElement('span');
    // Obsidian's own marker classes: its grey and its inset, as on the number it stands for.
    span.className = 'dr-number cm-formatting cm-formatting-list cm-formatting-list-ol';
    span.textContent = this.text;
    return span;
  }
}

/**
 * The numbered items of Obsidian's lists between `from` and `to`, each
 * drawn with its label in the place of its marker (the number, its stop
 * and the space after), unless the selection is in the marker, when it
 * shows as typed, as live preview shows other marks. Where the label is
 * wider than the number, the line hangs by it, after Obsidian's own hang.
 */
export function numberedLines(state, from, to, numbering, width, tab = 4) {
  const out = new RangeSetBuilder();
  const doc = state.doc;
  const getLine = (i) => doc.line(i + 1).text;
  const reveal = (a, b) => state.selection.ranges.some((r) => r.from <= b && r.to >= a);
  for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
    const line = doc.line(n);
    const m = ORDERED.exec(line.text);
    if (!m || ignored(state, line, m[1].length)) continue;
    const label = labelOf(numbering, pathAt(getLine, n - 1), m[3]);
    const typed = `${m[2]}${m[3]}`;
    if (label === typed) continue;
    const space = /^[ \t]*/.exec(line.text.slice(m[0].length))[0];
    const start = line.from + m[1].length;
    const end = start + typed.length + space.length;
    const shown = reveal(start, end) ? typed : label;
    const hang = `calc(${Math.ceil(depth(m[1]) / tab)} * var(--list-indent, ${width(' '.repeat(tab))}px) + var(--list-padding-inline-start, 0px) + ${width(`${shown} `)}px)`;
    out.add(line.from, line.from, Decoration.line({ attributes: { style: `padding-inline-start: ${hang}; text-indent: calc(-1 * ${hang})` } }));
    if (shown === label) out.add(start, end, Decoration.replace({ widget: new Label(`${label}${space || ' '}`) }));
  }
  return out.finish();
}

/**
 * The editor extension: `numberingOf(state)` says how the note's lists
 * read (null: as Obsidian numbers them); in live preview only, as source
 * mode shows the text as it is.
 */
export function numberLines(numberingOf, live, measure) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.draw(view);
      }

      update(u) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.geometryChanged) this.draw(u.view);
      }

      draw(view) {
        const numbering = live(view.state) ? numberingOf(view.state) : null;
        this.decorations = numbering ? numberedLines(view.state, view.viewport.from, view.viewport.to, numbering, measure(view), view.state.tabSize || 4) : Decoration.none;
      }
    },
    { decorations: (v) => v.decorations }
  );
}
