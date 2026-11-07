/* ------------------------------------------------------------------ */
/* Lettered and roman numeral lists: the feature                       */
/*                                                                     */
/* Lines turned into a list of a kind, from the editor's menu, and     */
/* the feature that puts the editor's and reading view's parts on.     */
/* ------------------------------------------------------------------ */

import { findSubmenu } from '../core/036-menus.js';
import { rerenderReading } from '../core/050-helpers-dom.js';
import { addActionEntries, editorContext } from '../core/078-actions.js';
import { Feature } from '../core/080-feature.js';
import { leadingSpace, LIST_KINDS, parseListItem, toAlpha, toRoman } from './270-lists.js';
import { listEditorExtensions } from './271-lists-editor.js';
import { renderLists } from './272-lists-reading.js';

/* Obsidian's own bullet and number at the start of a line, and a task's box after one. */
export const PLAIN_LIST_MARK = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+/;

/** Each line read as a list item against the one above it at its indent, or null. */
export function readListLines(texts) {
  const prevAt = new Map();
  return texts.map((text) => {
    if (!text.trim()) return null;
    const indent = leadingSpace(text);
    // A shallower line ends the deeper lists below the one before it.
    Array.from(prevAt.keys()).forEach((k) => {
      if (k.length > indent.length) prevAt.delete(k);
    });
    const item = parseListItem(text, prevAt.get(indent) || null);
    prevAt.set(indent, item);
    return item;
  });
}

/** Whether every line but the blank ones is an item of one kind. */
export function allListOf(texts, kind, read) {
  read = read || readListLines(texts);
  const filled = texts.filter((t) => t.trim()).length;
  const items = read.filter(Boolean);
  return filled > 0 && items.length === filled && items.every((it) => it.kind === kind);
}

/**
 * Lines made a list of one kind — 'alpha' or 'roman' — counted down each
 * indent: a., b., c. or i., ii., iii., in place of any bullet, number,
 * letter or numeral they had. If they're all that kind of list already,
 * they're made plain lines again. Blank lines stay as they are.
 */
export function relistLines(texts, kind) {
  const read = readListLines(texts);
  if (allListOf(texts, kind, read)) return texts.map((text, i) => (read[i] ? read[i].indent + read[i].content : text));
  const counts = new Map();
  return texts.map((text, i) => {
    if (!text.trim()) return text;
    let indent;
    let content;
    if (read[i]) {
      indent = read[i].indent;
      content = read[i].content;
    } else {
      const plain = PLAIN_LIST_MARK.exec(text);
      indent = plain ? plain[1] : leadingSpace(text);
      content = plain ? text.slice(plain[0].length) : text.slice(indent.length);
    }
    Array.from(counts.keys()).forEach((k) => {
      if (k.length > indent.length) counts.delete(k);
    });
    const n = (counts.get(indent) || 0) + 1;
    counts.set(indent, n);
    return `${indent}${kind === 'alpha' ? toAlpha(n) : toRoman(n)}. ${content}`;
  });
}

/** A CodeMirror selection's lines — a selection ending at the start of a line doesn't take that line. */
export function selectedLines(state) {
  const doc = state.doc;
  const sel = state.selection.main;
  const first = doc.lineAt(sel.from);
  let last = doc.lineAt(sel.to);
  if (last.number > first.number && sel.to === last.from) last = doc.line(last.number - 1);
  const texts = [];
  for (let n = first.number; n <= last.number; n++) texts.push(doc.line(n).text);
  return { from: first.from, to: last.to, texts };
}

/** The changes making a CodeMirror selection's lines a list of one kind, or plain again: { changes } or null. */
export function relistSelection(state, kind) {
  const lines = selectedLines(state);
  const out = relistLines(lines.texts, kind);
  if (out.every((t, i) => t === lines.texts[i])) return null;
  return { changes: { from: lines.from, to: lines.to, insert: out.join('\n') } };
}

/* The right-click entries for each kind: toggles, as Obsidian's own Bullet and Numbered are. */
export const LIST_MENU = {
  alpha: { setting: 'letterLists', title: 'Alphabetical', icon: 'case-lower' },
  roman: { setting: 'romanLists', title: 'Roman numerals', icon: 'list-ordered' },
};

/**
 * The list entries under Paragraph: "list" dropped from each of
 * Obsidian's own — Bullet, Numbered, Task — and ours put straight after
 * Numbered. Obsidian lays a menu out section by section, in the order
 * entries were added, so the order here is the order shown.
 */
export function arrangeListEntries(host, section, ours) {
  try {
    const items = host && Array.isArray(host.items) ? host.items : null;
    if (!items) return;
    const theirs = items.filter((it) => it && it.section === section && ours.indexOf(it) === -1);
    const title = (it) => (it.titleEl ? it.titleEl.textContent || '' : '');
    theirs.forEach((it) => {
      const text = title(it);
      if (/ list$/i.test(text) && typeof it.setTitle === 'function') it.setTitle(text.replace(/ list$/i, ''));
    });
    const numbered = theirs.find((it) => /^numbered$/i.test(title(it))) || theirs[1];
    if (!numbered) return;
    ours.forEach((it) => {
      const at = items.indexOf(it);
      if (at !== -1) items.splice(at, 1);
    });
    items.splice(items.indexOf(numbered) + 1, 0, ...ours);
  } catch (err) {
    /* left where they were */
  }
}

export class MarkedLists extends Feature {
  constructor(plugin) {
    super(plugin);
    // Registered once, filled and emptied: the way to switch an editor
    // extension on and off without registering it again.
    this.extensions = [];
    this.state = null;
  }

  /** On if either kind is. */
  get enabled() {
    return !!(this.settings.letterLists || this.settings.romanLists);
  }

  settingsSchema() {
    return [
      {
        key: 'letterLists',
        name: 'Alphabetical lists',
        desc: 'Lines starting a., b) or (c) become a list, continued when you press Enter.',
      },
      {
        key: 'romanLists',
        name: 'Roman numeral lists',
        desc: 'The same for i., ii) or (iii).',
      },
    ];
  }

  actions() {
    return ['alpha', 'roman'].map((kind) => ({
      id: kind === 'alpha' ? 'make-lettered-list' : 'make-roman-numeral-list',
      name: kind === 'alpha' ? 'Make the selected lines an alphabetical list, or plain again' : 'Make the selected lines a Roman numeral list, or plain again',
      menu: LIST_MENU[kind].title,
      icon: LIST_MENU[kind].icon,
      on: 'editor',
      when: (ctx) => !!this.settings[LIST_MENU[kind].setting] && !!ctx.cm,
      run: (ctx) => this.relist(ctx.cm, kind),
    }));
  }

  /**
   * In the editor's right-click menu, under Paragraph straight after
   * Obsidian's own Numbered where that can be found; otherwise beside its
   * other entries for a selection.
   */
  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        const ctx = this.enabled ? editorContext(editor, info, 'menu') : null;
        if (!ctx || !ctx.cm) return;
        // Older Obsidian builds Paragraph as a submenu of its own; newer
        // gathers a section into it, list entries in 'selection.paragraph.list'.
        const paragraph = findSubmenu(menu, 'Paragraph');
        const configs = !paragraph && menu.submenuConfigs && typeof menu.submenuConfigs === 'object' ? menu.submenuConfigs : null;
        const section = paragraph ? 'selection-list' : configs && configs['selection.paragraph'] ? 'selection.paragraph.list' : 'selection';
        const into = paragraph || menu;
        const ours = addActionEntries(into, this.actions(), ctx, section);
        if (section !== 'selection') arrangeListEntries(into, section, ours);
      })
    );
  }

  /** The selected lines — or the cursor's — made a list of one kind, or plain again. */
  relist(cm, kind) {
    if (!cm || !cm.state) return;
    const spec = relistSelection(cm.state, kind);
    if (!spec) return;
    cm.dispatch(Object.assign(spec, { scrollIntoView: true, userEvent: 'input' }));
    if (typeof cm.focus === 'function') cm.focus();
  }

  registerTypes() {
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (this.enabled) renderLists(el, ctx);
    });
  }

  enable() {
    this.apply(true);
  }

  disable() {
    this.apply(false);
  }

  /**
   * Also runs when either setting changes while the other stays on, so
   * editors and open notes are redrawn for the kinds now recognised.
   */
  apply(on) {
    const state = on ? `${!!this.settings.letterLists}/${!!this.settings.romanLists}` : 'off';
    if (this.state === state) return;
    const first = this.state === null;
    this.state = state;

    LIST_KINDS.alpha = !!this.settings.letterLists;
    LIST_KINDS.roman = !!this.settings.romanLists;
    this.extensions.length = 0;
    if (on) this.extensions.push(listEditorExtensions());
    this.app.workspace.updateOptions();
    // Notes already drawn were drawn with the old settings.
    if (!first || !on) rerenderReading(this.app);
  }
}
