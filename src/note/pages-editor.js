/* ------------------------------------------------------------------ */
/* Pages, in the editor: one page shown, the rest folded away          */
/*                                                                     */
/* A CodeMirror extension. The page open is a piece of the editor's    */
/* own state; every line outside it (and every marker line) is         */
/* replaced by nothing. The text is not changed: what is hidden is     */
/* still in the note.                                                  */
/* ------------------------------------------------------------------ */

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { parsePages } from './page-text.js';

/** Says which page an editor shows; null shows the whole note. */
export const showPage = StateEffect.define();

/** The line ranges to fold away so only `name` shows: [[from, to]] in lines, each end exclusive. */
export function hiddenLines(text, name) {
  const pages = parsePages(text);
  const open = pages.find((p) => p.name === name) || pages[0];
  if (!open) return [];
  const out = [];
  pages.forEach((page) => {
    if (page === open) out.push([page.line, page.line + 1]);
    else out.push([Math.min(page.from, page.line), page.to]);
  });
  // Lines that touch are one fold.
  return out.sort((a, b) => a[0] - b[0]).reduce((merged, r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r.slice());
    return merged;
  }, []);
}

function build(state, name) {
  if (name == null) return Decoration.none;
  const doc = state.doc;
  const ranges = hiddenLines(doc.toString(), name).map(([from, to]) => {
    const a = doc.line(from + 1).from;
    const b = to >= doc.lines ? doc.length : doc.line(to + 1).from;
    return Decoration.replace({ block: true }).range(a, b);
  }).filter((r) => r.to > r.from);
  return Decoration.set(ranges, true);
}

/** The extension: the page open, and the folds that follow from it. */
export const pagesField = StateField.define({
  create: () => ({ name: null, deco: Decoration.none }),
  update(value, tr) {
    let name = value.name;
    tr.effects.forEach((e) => { if (e.is(showPage)) name = e.value; });
    if (name === value.name && !tr.docChanged) return value;
    return { name, deco: build(tr.state, name) };
  },
  provide: (field) => EditorView.decorations.from(field, (v) => v.deco),
});
