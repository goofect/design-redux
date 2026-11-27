// The indentation guides as a person sees them, checked against what an outline means, whoever draws them
// (the plugin or Obsidian): run inside Obsidian on the note in front. The items a line belongs to are worked
// out from its indentation alone, apart from the plugin's own layout code, so a mistake in that code can't
// hide itself. What is checked, on every line drawn:
//   1. a line in a list has one guide for each item it is under, and no other;
//   2. every guide stands the same distance from its item's marker (the plugin's and Obsidian's alike);
//   3. a blank line of only its indent has the guides a line of words with that indent would have (so they follow
//      Enter and Tab); an empty line, and a line under no item, has none;
//   4. the outline shows: a line under an item starts to the right of that item's marker (an outline collapsed
//      to one edge keeps its guides beside its markers, and only this catches it).
// Returns { offset, violations: [{ line, text, why, ... }] }.
export function auditGuides({ app }) {
  const view = app.workspace.activeEditor.editor.cm;
  const doc = view.state.doc;
  const ITEM = /^[ \t]*(?:\d+(?:\.\d+)*[.)]|[ivxlcdm]+[.)]|[A-Za-z][.)]|[-*+])[ \t]/i;
  const lead = (t) => /^[ \t]*/.exec(t)[0];
  const depth = (t) => { let d = 0; for (const c of lead(t)) d += c === '\t' ? 4 : 1; return Math.floor(d / 4); };
  const text = (i) => doc.line(i + 1).text;
  const blank = (i) => !text(i).trim();
  const item = (i) => ITEM.test(text(i));
  const ancestors = (i) => {
    const out = [];
    let cur = depth(text(i));
    for (let j = i - 1; j >= 0 && cur > 0; j--) {
      if (blank(j)) continue;
      const d = depth(text(j));
      if (d < cur) {
        if (!item(j)) {
          if (!d) break; // under prose at the margin: no list here
          continue; // the words of an item: what is under them is under that item
        }
        out.unshift(j);
        cur = d;
      }
    }
    return out;
  };
  // The element a line is drawn in: its .cm-line, or the block the plugin draws it as.
  const lineEl = (i) => {
    const { node, offset } = view.domAtPos(doc.line(i + 1).from);
    if (node === view.contentDOM) return node.childNodes[offset] || null;
    return (node.nodeType === 1 ? node : node.parentElement).closest('.cm-line, .dr-as-text-line, .dr-as-text-block') || null;
  };
  // Where a line's marker is drawn, as a person sees it: its first visible character (not a guide, an indent or unseen words).
  const markerX = (j) => {
    const el = lineEl(j);
    if (!el) return NaN;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('.dr-unseen, .dr-indent, .cm-widgetBuffer') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const k = n.data.search(/\S/);
      if (k < 0) continue;
      const r = document.createRange();
      r.setStart(n, k);
      r.setEnd(n, k + 1);
      const box = r.getBoundingClientRect();
      if (box.width || box.height) return box.left;
    }
    return NaN;
  };
  const guides = (el) => {
    const xs = Array.from(el.querySelectorAll('.dr-indent-guide')).filter((g) => parseFloat(getComputedStyle(g).borderInlineEndWidth) > 0).map((g) => g.getBoundingClientRect().right);
    Array.from(el.querySelectorAll('.cm-indent')).forEach((s) => {
      const before = getComputedStyle(s, '::before');
      const bw = parseFloat(before.borderInlineEndWidth);
      if (before.content === 'none' || !(bw > 0) || before.display === 'none' || before.borderInlineEndColor === 'rgba(0, 0, 0, 0)') return;
      xs.push(s.getBoundingClientRect().left + parseFloat(before.marginInlineStart || 0) + parseFloat(before.width || 0) + bw);
    });
    return xs.sort((a, b) => a - b);
  };
  const seen = [];
  for (let i = 0; i < doc.lines; i++) {
    const el = lineEl(i);
    if (!el) continue;
    seen.push({ i, el, under: blank(i) && !lead(text(i)).length ? [] : ancestors(i), xs: guides(el) });
  }
  // The distance a guide stands from its item's marker: the one most guides keep.
  const tally = new Map();
  seen.forEach(({ under, xs }) => { if (under.length === xs.length) xs.forEach((x, k) => { const d = Math.round(x - markerX(under[k])); tally.set(d, (tally.get(d) || 0) + 1); }); });
  const offset = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const violations = [];
  const say = (i, why, extra = {}) => violations.push({ line: i + 1, text: text(i).replace(/\t/g, '→'), why, ...extra });
  seen.forEach(({ i, under, xs }) => {
    if (blank(i) && !under.length) { if (xs.length) say(i, 'a guide crosses an empty line', { guides: xs.length }); return; }
    if (under.length && !blank(i)) {
      const own = markerX(i);
      const parent = markerX(under[under.length - 1]);
      if (!(own > parent + 4)) say(i, `starts at ${Math.round(own - parent)}px from the marker of the item it is under, not to its right`, { item: under[under.length - 1] + 1 });
    }
    if (xs.length !== under.length) return void say(i, `${xs.length} guides for ${under.length} items it is under`, { at: xs.map((x) => Math.round(x)), markers: under.map((j) => Math.round(markerX(j))) });
    xs.forEach((x, k) => {
      const d = x - markerX(under[k]);
      if (offset !== null && Math.abs(d - offset) > 1.5) say(i, `guide ${k + 1} stands ${Math.round(d)}px from its item's marker, not ${offset}px`, { item: under[k] + 1 });
    });
  });
  return { offset, violations };
}

// Notes shaped like the author's: lettered sections over Obsidian's own numbers, items written as text (2.1., i.)
// under them, words under items, blank lines empty and of only the indent, a rule and a heading among them.
const OUTLINE = [
  '### 3. Taxonomy',
  'A. regime',
  '1. [[Federalism]]',
  '\ti. **Summary**',
  '\t*Federalism* is a',
  '',
  '2. [[Division of powers]]',
  '\ti. **Summary**',
  '\tThe *division of powers* is how the power of the state is divided.',
  '',
  '\t2.1. [[Enumerated powers]]',
  '\t\ti. **Summary**',
  '\t\t*Enumerated powers* are named in the constitution.',
  '',
  '\t2.2. [[Concurrent powers]]',
  '\t\ti. **Summary**',
  '\t\t*Concurrent powers* are shared.',
  '\t\t',
  '\t\tii. **Internal function**',
  '\t\t',
  '\t\t',
  '\t\tiii. **Upstream dependency**',
  '',
  '',
  '\t\tiv. **Downstream target**',
  '\t\te',
  '',
  '\t2.3. [[Residual powers]]',
  '\t\ti. **Summary**',
  '\t\t*Residual powers* are outside the enumerated powers.',
  '',
  '3. [[Constitutional supremacy]]',
  '\ti. **Summary**',
  '\t*Constitutional supremacy* is the principle of the highest legal authority.',
  '',
  '---',
  '',
  'B. government',
  '1. [[Federal government]]',
  '\ti. **Summary**',
  '',
].join('\n');

// Deeper, with Obsidian's own bullets among the items written as text, and a line long enough to wrap.
const DEEP = [
  '1. [[Responsible government]]',
  '\t1.1. [[Parliamentary accountability]]',
  '\t\ti. **Summary**',
  '\t\tParliamentary accountability is the principle that the executive answers to the legislature for its decisions, its spending and its conduct, and keeps office only while it holds the confidence of the house.',
  '\t\t- a bullet of Obsidian\'s own',
  '\t\t- another',
  '',
  '\t\t1.1.1. [[Question period]]',
  '\t\t\ti. **Summary**',
  '\t\t\t',
  '\t\t\tii. **Function**',
  '\t\t\tWords under it.',
  '',
  '\t1.2. [[Confidence]]',
  '\t\ti. **Summary**',
  '',
].join('\n');

export const GUIDE_NOTES = {
  'deep': DEEP,
  'tabs': OUTLINE,
  'spaces': OUTLINE.replace(/^\t+/gm, (t) => '    '.repeat(t.length)),
};
