/* ------------------------------------------------------------------ */
/* The indent guides of the note in front, checked as a person sees    */
/* them                                                                */
/*                                                                     */
/* An outline's meaning is read from its indentation alone (apart from */
/* the code that lays outlines out, so a mistake there can't hide      */
/* itself), and every guide and indent drawn is checked against it,    */
/* the plugin's and Obsidian's alike:                                  */
/*   1. a line in a list has one guide for each item it is under;      */
/*   2. every guide stands the same distance from its item's marker;   */
/*   3. a blank line of only its indent has the guides of that indent, */
/*      an empty line none;                                            */
/*   4. a line under an item starts to the right of its marker.        */
/* A command runs it on the person's own note, in their theme and      */
/* settings, and gives a report to copy; the real-app tests run the    */
/* same code on notes of every shape.                                  */
/* ------------------------------------------------------------------ */

import { MarkdownView, Notice } from 'obsidian';
import { copyText } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { row, rows } from '../ui/row.js';
import { Sheet } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';

const ITEM = /^[ \t ]*(?:\d+(?:\.\d+)*[.)]|[ivxlcdm]+[.)]|[A-Za-z][.)]|[-*+])[ \t]/i;
const lead = (t) => /^[ \t ]*/.exec(t)[0];
// An indent by its width in columns (a tab to the next stop of four), so an indent of 2 or 3 spaces, or mixed, is read as it shows.
const depth = (t) => { let d = 0; for (const c of lead(t)) d += c === '\t' ? 4 - (d % 4) : 1; return d; };

/** `view` is CodeMirror's EditorView of the note. Returns { offset, lines, violations: [{ line, text, why }] }. */
export function auditGuides(view) {
  const doc = view.state.doc;
  const text = (i) => doc.line(i + 1).text;
  const blank = (i) => !text(i).trim();
  const ancestors = (i) => {
    const out = [];
    let cur = depth(text(i));
    for (let j = i - 1; j >= 0 && cur > 0; j--) {
      if (blank(j)) continue;
      const d = depth(text(j));
      if (d >= cur) continue;
      if (!ITEM.test(text(j))) {
        if (!d) break; // under prose at the margin: no list here
        continue; // the words of an item: what is under them is under that item
      }
      out.unshift(j);
      cur = d;
    }
    return out;
  };
  // The element a line is drawn in: its .cm-line, or the block the plugin draws it as.
  const lineEl = (i) => {
    const { node, offset } = view.domAtPos(doc.line(i + 1).from);
    if (node === view.contentDOM) return node.childNodes[offset] || null;
    return (node.nodeType === 1 ? node : node.parentElement).closest('.cm-line, .dr-as-text-line, .dr-as-text-block') || null;
  };
  const win = view.dom.ownerDocument.defaultView;
  // Where a line's marker is drawn: its first visible character (not a guide, an indent or unseen words).
  const markerX = (j) => {
    const el = lineEl(j);
    if (!el) return NaN;
    const d = el.ownerDocument;
    const walk = d.createTreeWalker(el, 4, { acceptNode: (n) => (n.parentElement.closest('.dr-unseen, .dr-indent, .cm-widgetBuffer') ? 2 : 1) });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const k = n.data.search(/\S/);
      if (k < 0) continue;
      const r = d.createRange();
      r.setStart(n, k);
      r.setEnd(n, k + 1);
      const box = r.getBoundingClientRect();
      if (box.width || box.height) return box.left;
    }
    return NaN;
  };
  // Every guide drawn on a line, by where its line stands: the plugin's, and Obsidian's on the indent's spaces.
  const guides = (el) => {
    // Only what can be seen: a guide hidden (by a theme, a snippet, or anything) is a guide missing.
    const shown = (g) => { const cs = win.getComputedStyle(g); return g.getClientRects().length > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0 && parseFloat(cs.borderInlineEndWidth) > 0 && cs.borderInlineEndColor !== 'rgba(0, 0, 0, 0)'; };
    const xs = Array.from(el.querySelectorAll('.dr-indent-guide')).filter(shown).map((g) => g.getBoundingClientRect().right);
    Array.from(el.querySelectorAll('.cm-indent')).forEach((s) => {
      const before = win.getComputedStyle(s, '::before');
      const bw = parseFloat(before.borderInlineEndWidth);
      if (!s.getClientRects().length || before.content === 'none' || !(bw > 0) || before.display === 'none' || before.visibility === 'hidden' || before.borderInlineEndColor === 'rgba(0, 0, 0, 0)') return;
      xs.push(s.getBoundingClientRect().left + parseFloat(before.marginInlineStart || 0) + parseFloat(before.width || 0) + bw);
    });
    return xs.sort((a, b) => a - b);
  };
  const seen = [];
  for (let i = 0; i < doc.lines; i++) {
    const el = lineEl(i);
    if (el) seen.push({ i, under: blank(i) && !lead(text(i)).length ? [] : ancestors(i), xs: guides(el) });
  }
  // The distance a guide stands from its item's marker: the one most guides keep.
  const tally = new Map();
  seen.forEach(({ under, xs }) => { if (under.length === xs.length) xs.forEach((x, k) => { const d = Math.round(x - markerX(under[k])); tally.set(d, (tally.get(d) || 0) + 1); }); });
  const best = [...tally].sort((a, b) => b[1] - a[1])[0];
  const offset = best ? best[0] : null;
  const violations = [];
  const say = (i, why) => violations.push({ line: i + 1, text: text(i), why });
  seen.forEach(({ i, under, xs }) => {
    if (blank(i) && !under.length) { if (xs.length) say(i, 'a guide crosses an empty line'); return; }
    if (under.length && !blank(i)) {
      const own = markerX(i);
      const parent = markerX(under[under.length - 1]);
      if (!(own > parent + 4)) say(i, `starts ${Math.round(own - parent)}px from the marker of line ${under[under.length - 1] + 1}, which it is under, not to its right`);
    }
    if (xs.length !== under.length) return void say(i, `${xs.length} ${xs.length === 1 ? 'guide' : 'guides'} for the ${under.length} ${under.length === 1 ? 'item' : 'items'} it is under`);
    xs.forEach((x, k) => {
      const d = x - markerX(under[k]);
      if (offset !== null && Math.abs(d - offset) > 1.5) say(i, `guide ${k + 1} stands ${Math.round(d)}px from the marker of line ${under[k] + 1}, not ${offset}px`);
    });
  });
  return { offset, lines: seen.length, violations };
}

/** A line's indent made visible: a tab →, a space ·, a non-breaking space ⍽, anything else its code; then the words. */
export function showIndent(text) {
  const ws = lead(text);
  return Array.from(ws).map((c) => (c === '\t' ? '→' : c === ' ' ? '·' : c === ' ' ? '⍽' : `\\u${c.charCodeAt(0).toString(16)}`)).join('') + text.slice(ws.length);
}

export class GuideCheck extends Feature {
  /** The audit of the note in front, in the editor; null when there is none. */
  audit() {
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = md && md.editor && md.editor.cm; // CodeMirror's view: not public, so behind a check
    if (!cm || typeof cm.domAtPos !== 'function') return null;
    return Object.assign(auditGuides(cm), { md });
  }

  /** What the report says beside the problems: what draws the guides, in this note. Nothing of the note's other text. */
  setting(md) {
    const vault = this.app.vault;
    const config = (k) => (typeof vault.getConfig === 'function' ? vault.getConfig(k) : undefined);
    const css = this.app.customCss;
    const s = this.settings;
    return [
      `Design Redux ${this.plugin.manifest.version}; ${md.getMode && md.getMode() === 'source' ? (md.getState().source ? 'source mode' : 'live preview') : 'reading view'}`,
      `Look: ${s.look}, ${s.lookScope}; theme: ${(css && css.theme) || 'default'}; snippets on: ${css && css.enabledSnippets ? css.enabledSnippets.size : 0}`,
      `Indentation guides: ${config('showIndentGuide') !== false ? 'on' : 'off'}; tab size ${config('tabSize') || 4}; indent with ${config('useTab') === false ? 'spaces' : 'tabs'}`,
    ];
  }

  check() {
    const got = this.audit();
    if (!got) return void new Notice('Open a note in the editor to check its indent guides.');
    const { md, violations } = got;
    const report = [`Indent guides of ${md.file ? md.file.path : 'a note'}: ${violations.length ? `${violations.length} problems` : 'no problems'}`, ...this.setting(md), '']
      .concat(violations.map((v) => `Line ${v.line}: ${v.why}\n  ${showIndent(v.text)}`))
      .join('\n');
    new Sheet(this.app, {
      title: 'Indent guides',
      text: violations.length ? 'These lines are drawn otherwise than the outline means. The report says where and how, each line\'s indent shown: → a tab, · a space, ⍽ a non-breaking space.' : 'Every guide stands under its item, and every line where its outline puts it.',
      build: (matter) => {
        if (!violations.length) return void sayso(matter, { label: 'Nothing to mend' });
        const list = rows(matter);
        violations.slice(0, 60).forEach((v) => row(list, { name: v.text.trim() || 'A blank line', end: v.why.replace(/ of line \d+| from the marker of line \d+/, ''), error: true }));
      },
      actions: [{ text: 'Copy report', run: () => void copyText(report, 'Report copied.') }, { text: 'Close' }],
    }).open();
    return got;
  }

  actions() {
    return [{ id: 'check-guides', name: 'Check the indent guides of this note', on: 'editor', menu: false, run: () => this.check() }];
  }
}
