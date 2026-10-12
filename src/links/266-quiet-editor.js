/* ------------------------------------------------------------------ */
/* Quiet links: in the editor                                           */
/*                                                                      */
/* Live Preview draws each as the note it names, dotted, except in      */
/* code, maths and comments; [[[ offers notes as [[ does; the link at   */
/* the cursor can be made quiet or normal.                               */
/* ------------------------------------------------------------------ */

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { editorInfoField, EditorSuggest } from 'obsidian';
import { byName } from '../core/030-helpers-art.js';
import { scriptLivePreview } from '../core/050-helpers-dom.js';
import { quietHint, quietLabel, quietMatches, splitQuiet } from './263-quiet-text.js';

/**
 * The link around the cursor on its line — a quiet one first, then a
 * plain one: { line, from, to, inner, quiet }, or null.
 */
export function linkAtCursor(editor) {
  if (!editor || typeof editor.getCursor !== 'function') return null;
  const cursor = editor.getCursor();
  const text = editor.getLine(cursor.line);
  const within = (from, to) => cursor.ch >= from && cursor.ch <= to;
  const quiet = quietMatches(text).find((q) => within(q.from, q.to));
  if (quiet) return { line: cursor.line, from: quiet.from, to: quiet.to, inner: quiet.inner, quiet: true };
  const plain = /\[\[([^[\]\n]+?)\]\]/g;
  let m;
  while ((m = plain.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    const tripled = text[from - 1] === '[' && text[to] === ']';
    if (!tripled && within(from, to)) return { line: cursor.line, from, to, inner: m[1], quiet: false };
  }
  return null;
}

/** A quiet link in Live Preview: its name, dotted, opening where it points. */
export class QuietLinkWidget extends WidgetType {
  constructor(feature, label, target, sourcePath, missing) {
    super();
    this.feature = feature;
    this.label = label;
    this.target = target;
    this.sourcePath = sourcePath;
    this.missing = missing;
  }

  eq(other) {
    return (
      other.label === this.label &&
      other.target === this.target &&
      other.sourcePath === this.sourcePath &&
      other.missing === this.missing
    );
  }

  toDOM(view) {
    const el = view.dom.ownerDocument.createElement('span');
    el.className = 'cm-hmd-internal-link dr-quiet-link';
    if (this.missing) el.classList.add('is-unresolved');
    el.textContent = this.label;
    el.setAttribute('data-href', this.target);
    el.setAttribute('aria-label', quietHint(this.target, this.missing));
    el.addEventListener('mousedown', (evt) => {
      if (evt.button !== 0 && evt.button !== 1) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.feature.open(this.target, this.sourcePath, evt.button === 1 || evt.ctrlKey || evt.metaKey);
    });
    el.addEventListener('mouseover', (evt) => this.feature.preview(evt, el, this.target, this.sourcePath));
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

/** Code, maths and comments keep their brackets as written. */
export function quietIgnored(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/code|math|comment|frontmatter/i.test(node.name)) return true;
  }
  return false;
}

export function quietSourcePath(feature, state) {
  try {
    const info = editorInfoField ? state.field(editorInfoField, false) : null;
    if (info && info.file && info.file.path) return info.file.path;
  } catch (err) {
    /* none to hand */
  }
  const active = feature.app.workspace.getActiveFile();
  return active ? active.path : '';
}

/**
 * In Live Preview, each quiet link is drawn as the note it names, dotted,
 * until the cursor reaches it and its source shows, as any link's does.
 */
export function quietDecorations(feature, view) {
  const builder = new RangeSetBuilder();
  const state = view.state;
  if (!feature.enabled || !scriptLivePreview(state)) return builder.finish();
  const sourcePath = quietSourcePath(feature, state);
  const ranges = state.selection.ranges;
  const touched = (from, to) => ranges.some((r) => r.from <= to && r.to >= from);
  let lastLine = 0;
  for (const visible of view.visibleRanges) {
    let pos = visible.from;
    while (pos <= visible.to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine || line.text.indexOf('[[[') === -1) continue;
      lastLine = line.number;
      for (const q of quietMatches(line.text)) {
        const from = line.from + q.from;
        const to = line.from + q.to;
        if (touched(from, to) || quietIgnored(state, from)) continue;
        const parts = splitQuiet(q.inner);
        const missing = !feature.resolve(parts.path, sourcePath);
        builder.add(
          from,
          to,
          Decoration.replace({
            widget: new QuietLinkWidget(feature, quietLabel(parts.target, parts.words), parts.target, sourcePath, missing),
          })
        );
      }
    }
  }
  return builder.finish();
}

export function quietEditorExtension(feature) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = quietDecorations(feature, view);
      }

      update(u) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          scriptLivePreview(u.startState) !== scriptLivePreview(u.state) ||
          feature.changed
        ) {
          this.decorations = quietDecorations(feature, u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/**
 * After [[[: notes, their aliases, and — after a # — a note's headings,
 * written as a quiet link. The plugin's own list, since Obsidian's would
 * also offer to make a note called "[Name".
 */
export class QuietLinkSuggest extends (EditorSuggest || class {}) {
  constructor(feature) {
    super(feature.app);
    this.app = feature.app;
    this.feature = feature;
    this.limit = 50;
  }

  onTrigger(cursor, editor) {
    if (!this.feature.enabled) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = /(^|[^[])\[\[\[([^[\]|\n]*)$/.exec(before);
    if (!m) return null;
    const ch = m.index + m[1].length + 3;
    return { start: { line: cursor.line, ch }, end: cursor, query: m[2] };
  }

  getSuggestions(context) {
    const query = context.query || '';
    const app = this.app;
    const source = context.file ? context.file.path : '';
    const hash = query.indexOf('#');
    if (hash !== -1) {
      const file = app.metadataCache.getFirstLinkpathDest(query.slice(0, hash), source);
      const cache = file && app.metadataCache.getFileCache(file);
      const want = query.slice(hash + 1).toLowerCase();
      return ((cache && cache.headings) || [])
        .filter((h) => h.heading.toLowerCase().includes(want))
        .slice(0, this.limit)
        .map((h) => ({ kind: 'heading', file, heading: h.heading }));
    }
    const want = query.toLowerCase();
    const found = [];
    app.vault.getMarkdownFiles().forEach((file) => {
      const name = file.basename.toLowerCase();
      const at = name.indexOf(want);
      if (at !== -1) found.push({ kind: 'file', file, rank: at === 0 ? 0 : 1, len: name.length });
      const cache = app.metadataCache.getFileCache(file);
      const raw = cache && cache.frontmatter ? cache.frontmatter.aliases || cache.frontmatter.alias : null;
      (Array.isArray(raw) ? raw : raw ? [raw] : []).forEach((alias) => {
        const text = String(alias);
        const where = text.toLowerCase().indexOf(want);
        if (want && where !== -1) found.push({ kind: 'alias', file, alias: text, rank: where === 0 ? 0 : 1, len: text.length });
      });
    });
    return found
      .sort((a, b) => a.rank - b.rank || a.len - b.len || byName(a.file.basename, b.file.basename))
      .slice(0, this.limit);
  }

  renderSuggestion(item, el) {
    el.addClass('dr-quiet-suggest');
    const content = el.createDiv({ cls: 'suggestion-content' });
    const title = item.kind === 'heading' ? item.heading : item.kind === 'alias' ? item.alias : item.file.basename;
    content.createDiv({ cls: 'suggestion-title', text: title });
    const where = item.kind === 'file'
      ? (item.file.parent && item.file.parent.path !== '/' ? item.file.parent.path : '')
      : item.file.basename;
    if (where) content.createDiv({ cls: 'suggestion-note', text: where });
  }

  selectSuggestion(item) {
    const context = this.context;
    if (!context) return;
    const editor = context.editor;
    const source = context.file ? context.file.path : '';
    const linktext = this.app.metadataCache.fileToLinktext(item.file, source, true);
    const text =
      item.kind === 'heading' ? `${linktext}#${item.heading}` : item.kind === 'alias' ? `${linktext}|${item.alias}` : linktext;
    // Typed on since the list was last asked for — a fast hand, a slow
    // older Obsidian: up to where the cursor is now, not where it was.
    const cursor = typeof editor.getCursor === 'function' ? editor.getCursor() : null;
    const now = cursor && cursor.line === context.start.line ? this.onTrigger(cursor, editor) : null;
    const end = now && now.start.ch === context.start.ch ? now.end : context.end;
    // Closing brackets Obsidian may already have paired: kept, not doubled.
    const after = editor.getLine(end.line).slice(end.ch);
    const closing = (/^\]{0,3}/.exec(after) || [''])[0].length;
    editor.replaceRange(`${text}]]]`, context.start, { line: end.line, ch: end.ch + closing });
    editor.setCursor({ line: context.start.line, ch: context.start.ch + text.length + 3 });
    this.close();
  }
}
