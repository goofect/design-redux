/* ------------------------------------------------------------------ */
/* Lists written as text: what Markdown takes for code under them      */
/*                                                                     */
/* A line indented past its list after a blank line is code to         */
/* Markdown. Under a list, and above all under an outline written as   */
/* text (2.1., i.), that is the note's own words and items, indented   */
/* to sit under them: they are drawn as the text they are, each run of */
/* lines rendered as Markdown at its indent. In live preview the lines */
/* show as typed where the cursor is in them, without the code's look. */
/* The note's text is left as written. Fenced code, and indented code  */
/* after words at the margin, stay code.                               */
/* ------------------------------------------------------------------ */

import { Component, Keymap, MarkdownRenderChild, MarkdownRenderer } from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { depth } from './list-markers.js';

// A list item of any kind: a dash, a number, an outline number, a letter or numeral.
const LISTISH = /^[ \t]*(?:[-*+]|\d+(?:\.\d+)*[.)]?|[a-z]+[.)])[ \t]/i;
const lead = (line) => depth(/^[ \t]*/.exec(line)[0]);

/** Lines in runs split at blank lines. */
function groupsOf(lines) {
  const groups = [];
  let open = null;
  lines.forEach((line) => {
    if (!line.trim()) return void (open = null);
    if (!open) groups.push((open = []));
    open.push(line);
  });
  return groups;
}

/**
 * Renders lines of a note as its text into `root`: each run of lines
 * Markdown on its own, its first line's indent taken off and given back
 * as an indent (--dr-indent levels), so no line is code. `levelOf(group,
 * i)` gives a run's level; by default its indent from the margin.
 */
export function renderAsText(app, root, lines, sourcePath, component, levelOf = (group) => Math.round(lead(group[0]) / 4)) {
  const doc = root.ownerDocument;
  groupsOf(lines).forEach((group, i) => {
    const part = root.appendChild(doc.createElement('div'));
    part.className = 'dr-as-text';
    part.style.setProperty('--dr-indent', String(Math.max(0, levelOf(group, i))));
    // Lines after the first carry on its paragraph, whatever their indent: Markdown never makes them code.
    MarkdownRenderer.render(app, [group[0].replace(/^[ \t]+/, '')].concat(group.slice(1)).join('\n'), part, sourcePath, component);
  });
}

/** Whether the block above a line, past blank lines, is a list: an item, or a line indented under one. */
function underList(lineAt, n) {
  for (let i = n - 1; i >= 0; i--) {
    const text = lineAt(i);
    if (!text.trim()) continue;
    return /^[ \t]/.test(text) || LISTISH.test(text);
  }
  return false;
}

/** The runs of lines Markdown takes for indented code under a list: [{ from, to }] line numbers, from 1. */
export function codeRuns(state) {
  const doc = state.doc;
  const code = new Set();
  syntaxTree(state).iterate({ enter: (node) => void (/hmd-indented-code/.test(node.name) && code.add(doc.lineAt(node.from).number)) });
  const runs = [];
  Array.from(code).sort((a, b) => a - b).forEach((n) => {
    const last = runs[runs.length - 1];
    let joined = !!last;
    for (let i = last ? last.to + 1 : n; joined && i < n; i++) joined = !doc.line(i).text.trim();
    if (joined) last.to = n;
    else runs.push({ from: n, to: n });
  });
  return runs.filter((r) => underList((i) => doc.line(i + 1).text, r.from - 1));
}

/** A run drawn as the note's text: clicking its words puts the cursor in it; a link opens. */
class AsText extends WidgetType {
  constructor(app, lines, path) {
    super();
    this.app = app;
    this.lines = lines;
    this.path = path;
    this.text = lines.join('\n');
  }

  eq(other) {
    return other.text === this.text && other.path === this.path;
  }

  toDOM(view) {
    const root = view.dom.ownerDocument.createElement('div');
    // Obsidian's class for rendered Markdown, so its lists and paragraphs are drawn as its own are.
    root.className = 'dr-as-text-block markdown-rendered';
    root.drComponent = new Component();
    root.drComponent.load();
    renderAsText(this.app, root, this.lines, this.path, root.drComponent);
    root.addEventListener('mousedown', (e) => {
      const link = e.target.closest && e.target.closest('a.internal-link');
      if (link) {
        e.preventDefault();
        this.app.workspace.openLinkText(link.getAttribute('data-href') || link.textContent, this.path, Keymap.isModEvent(e));
        return;
      }
      if (e.target.closest && e.target.closest('a')) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(root) } });
      view.focus();
    });
    return root;
  }

  destroy(dom) {
    if (dom.drComponent) dom.drComponent.unload();
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * The editor's part, a state field (a run is a block): `pathOf(state)`
 * the note's path, `live(state)` whether live preview is on (source mode
 * shows the text as it is).
 */
export function codeAsTextField(app, pathOf, live) {
  const build = (state, runs) => {
    const out = new RangeSetBuilder();
    if (live(state)) {
      runs.forEach(({ from, to }) => {
        const a = state.doc.line(from);
        const z = state.doc.line(to);
        if (state.selection.ranges.some((r) => r.from <= z.to && r.to >= a.from)) {
          for (let n = from; n <= to; n++) out.add(state.doc.line(n).from, state.doc.line(n).from, Decoration.line({ class: 'dr-as-text-raw' }));
        } else {
          const lines = [];
          for (let n = from; n <= to; n++) lines.push(state.doc.line(n).text);
          out.add(a.from, z.to, Decoration.replace({ widget: new AsText(app, lines, pathOf(state)), block: true }));
        }
      });
    }
    return { runs, live: live(state), deco: out.finish() };
  };
  return StateField.define({
    create: (state) => build(state, codeRuns(state)),
    update: (value, tr) => {
      const reparsed = tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState);
      if (!reparsed && !tr.selection && live(tr.state) === value.live) return value;
      return build(tr.state, reparsed ? codeRuns(tr.state) : value.runs);
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
  });
}

/**
 * Reading view: a code block Obsidian rendered in a list item, indented
 * there (not fenced), rendered as the note's text in its place.
 */
export function codeAsTextReading(app, root, ctx) {
  const info = ctx && typeof ctx.getSectionInfo === 'function' ? ctx.getSectionInfo(root) : null;
  if (!info) return;
  const source = info.text.split('\n').slice(info.lineStart, info.lineEnd + 1);
  root.querySelectorAll('li > pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || /language-/.test(code.className)) return;
    const lines = code.textContent.replace(/\n$/, '').split('\n');
    const first = lines.find((l) => l.trim());
    const at = first ? source.findIndex((l) => l.trim() === first.trim()) : -1;
    if (at < 0) return;
    for (let i = at - 1; i >= 0; i--) {
      if (!source[i].trim()) continue;
      if (/^[ \t]*(```|~~~)/.test(source[i])) return;
      break;
    }
    // Each run at its indent in the note, counted from the item the block is in: the code's own lines lose that indent.
    const within = [];
    for (let li = pre.parentElement; li && root.contains(li); li = li.parentElement) if (li.tagName === 'LI') within.push(li);
    let from = at;
    const levelOf = (group) => {
      const n = source.findIndex((l, i) => i >= from && l.trim() === group[0].trim());
      if (n < 0) return 0;
      from = n + 1;
      return Math.round(lead(source[n]) / 4) - (within.length - 1);
    };
    const div = root.ownerDocument.createElement('div');
    div.className = 'dr-as-text-block';
    const child = new MarkdownRenderChild(div);
    ctx.addChild(child);
    renderAsText(app, div, lines, ctx.sourcePath, child, levelOf);
    pre.replaceWith(div);
  });
}
