/* ------------------------------------------------------------------ */
/* Footnotes: where they are seen                                     */
/*                                                                    */
/* The citations kept off the page in a view of their own, hidden from*/
/* the note, and the small box at the cursor that adds and edits one. */
/* ------------------------------------------------------------------ */

import { RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { ItemView, MarkdownRenderer, MarkdownView, Notice, Platform, setIcon } from 'obsidian';
import { composing } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { scriptLivePreview } from '../core/050-helpers-dom.js';
import { applyFootnoteChanges, footnoteBody, planFootnotes, scanFootnotes, trailingFootnotes } from './283-footnote-text.js';

/* -- the citations, kept off the page ------------------------------ */

export const FOOTNOTES_VIEW = 'design-redux-footnotes';

/**
 * The stretches of a note its citations take up, as whole lines: each
 * definition with the lines continuing it, and the blank lines before
 * the list at the end, so hiding it leaves no gap.
 */
export const footnoteRangeCache = new WeakMap();
export function footnoteDefRanges(text, key) {
  if (key && footnoteRangeCache.has(key)) return footnoteRangeCache.get(key);
  const { defs } = scanFootnotes(text);
  const trailing = trailingFootnotes(text, defs);
  const ranges = [];
  defs.forEach((d) => {
    if (trailing.indexOf(d) === -1) ranges.push([d.lineFrom, d.to]);
  });
  if (trailing.length) {
    let from = trailing[0].lineFrom;
    // Back over the blank lines before it, a line at a time.
    while (from > 0) {
      const start = text.lastIndexOf('\n', from - 2) + 1;
      if (text.slice(start, from - 1).trim() || start === from) break;
      from = start;
    }
    ranges.push([from, text.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (key) footnoteRangeCache.set(key, ranges);
  return ranges;
}

/**
 * In Live Preview, the citations out of sight — the numbers stay in the
 * text, and the Footnotes view lists what they cite. Brought back while
 * the cursor is in them, so they can still be reached and edited.
 */
export function footnoteHider(isOn) {
  const build = (state) => {
    if (!isOn() || !scriptLivePreview(state)) return Decoration.none;
    const ranges = footnoteDefRanges(state.doc.toString(), state.doc);
    if (!ranges.length) return Decoration.none;
    const sel = state.selection.ranges;
    const builder = new RangeSetBuilder();
    ranges.forEach(([from, to]) => {
      if (to <= from || sel.some((r) => r.to >= from && r.from <= to)) return;
      builder.add(from, to, Decoration.replace({ block: true }));
    });
    return builder.finish();
  };
  return StateField.define({
    create: build,
    update(value, tr) {
      if (tr.docChanged || tr.selection || scriptLivePreview(tr.startState) !== scriptLivePreview(tr.state)) {
        return build(tr.state);
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

/** A citation's text, drawn as the note would draw it, or as plain text. */
export function renderCitation(app, text, el, sourcePath, component) {
  try {
    if (MarkdownRenderer && typeof MarkdownRenderer.render === 'function') {
      MarkdownRenderer.render(app, text, el, sourcePath, component);
      return;
    }
    if (MarkdownRenderer && typeof MarkdownRenderer.renderMarkdown === 'function') {
      MarkdownRenderer.renderMarkdown(text, el, sourcePath, component);
      return;
    }
  } catch (err) {
    /* plain text, below */
  }
  el.setText(text);
}

/**
 * The note's footnotes, in a view of their own beside it: each number,
 * what it cites, and the sentence it's in. A footnote opens where it's
 * cited; its citation is changed or removed right here.
 */
export class FootnotesView extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
    this.plugin = feature.plugin;
    this.file = null;
    this.timer = 0;
    this.editing = null;
  }

  getViewType() {
    return FOOTNOTES_VIEW;
  }

  getDisplayText() {
    return 'Footnotes';
  }

  getIcon() {
    return 'file-signature';
  }

  async onOpen() {
    this.containerEl.addClass('dr-fn-view');
    const queue = () => this.queue();
    this.registerEvent(this.app.workspace.on('active-leaf-change', queue));
    this.registerEvent(this.app.workspace.on('file-open', queue));
    this.registerEvent(this.app.workspace.on('editor-change', queue));
    this.registerEvent(this.app.metadataCache.on('changed', queue));
    this.render();
  }

  async onClose() {
    window.clearTimeout(this.timer);
  }

  queue() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), 200);
  }

  /** The note followed: the one in use, or, while this view is, the one last in use. */
  noteView() {
    const ws = this.app.workspace;
    const active = ws.getActiveViewOfType(MarkdownView);
    if (active && active.file) {
      this.markdownLeaf = active.leaf;
      return active;
    }
    const kept = this.markdownLeaf;
    if (kept && kept.view instanceof MarkdownView && kept.view.file && kept.parent) return kept.view;
    const leaf = typeof ws.getMostRecentLeaf === 'function' ? ws.getMostRecentLeaf() : null;
    return leaf && leaf.view instanceof MarkdownView && leaf.view.file ? leaf.view : null;
  }

  textOf(view) {
    try {
      return view.editor ? view.editor.getValue() : view.data || '';
    } catch (err) {
      return view.data || '';
    }
  }

  render(highlight) {
    if (this.editing) return;
    const root = this.contentEl;
    root.empty();
    const view = this.noteView();
    if (!view) {
      root.createDiv({ cls: 'dr-fn-view-empty', text: 'Open a note to see its footnotes.' });
      return;
    }
    const text = this.textOf(view);
    const { refs, defs } = scanFootnotes(text);
    const labels = [];
    refs.forEach((r) => labels.indexOf(r.label) === -1 && labels.push(r.label));
    defs.forEach((d) => labels.indexOf(d.label) === -1 && labels.push(d.label));

    const head = root.createDiv({ cls: 'dr-fn-view-head' });
    head.createDiv({ cls: 'dr-fn-view-note', text: view.file.basename });
    const tools = head.createDiv({ cls: 'dr-fn-view-tools' });
    const tool = (icon, label, run) => {
      const el = tools.createDiv({ cls: 'clickable-icon' });
      el.setAttribute('aria-label', label);
      asButton(el);
      setIcon(el, icon);
      onActivate(el, run);
    };
    tool('plus', 'Add footnote at the cursor', () => this.addAtCursor(view));
    if (labels.length) tool('list-ordered', 'Put footnotes in order', () => this.apply(view, { type: 'tidy' }, true));

    if (!labels.length) {
      root.createDiv({ cls: 'dr-fn-view-empty', text: 'No footnotes in this note.' });
      return;
    }

    const list = root.createDiv({ cls: 'dr-fn-list' });
    labels.forEach((label) => {
      const def = defs.find((d) => d.label === label);
      const ref = refs.find((r) => r.label === label);
      const item = list.createDiv({ cls: 'dr-fn-item' });
      item.dataset.label = label;
      if (!ref) item.addClass('is-unused');
      if (highlight === label) item.addClass('is-highlighted');

      const top = item.createDiv({ cls: 'dr-fn-item-top' });
      top.createSpan({ cls: 'dr-fn-num', text: label });
      const body = top.createDiv({ cls: 'dr-fn-item-body' });
      if (def) renderCitation(this.app, footnoteBody(text, def), body, view.file.path, this);
      else body.createSpan({ cls: 'dr-fn-missing', text: 'No citation yet' });

      const actions = top.createDiv({ cls: 'dr-fn-item-actions' });
      const act = (icon, title, run) => {
        const el = actions.createDiv({ cls: 'clickable-icon' });
        el.setAttribute('aria-label', title);
        asButton(el);
        setIcon(el, icon);
        onActivate(el, (evt) => {
          if (evt && evt.stopPropagation) evt.stopPropagation();
          run();
        });
      };
      act('pencil', 'Change', () => this.edit(item, body, view, label, def ? footnoteBody(text, def) : ''));
      act('trash-2', 'Remove', () => this.apply(view, { type: 'remove', label, all: true }));

      // Where it's cited: the words just before the number.
      const where = item.createDiv({ cls: 'dr-fn-where' });
      if (ref) {
        const before = text.slice(Math.max(0, ref.from - 90), ref.from).split('\n').pop();
        const words = before.replace(/\[\^[^\]]*\]/g, '').trim();
        where.setText(words ? `…${words.slice(-70)}` : 'At the start of a line');
        asButton(item);
        onActivate(item, () => this.reveal(view, ref));
      } else {
        where.setText('Not cited in the text');
      }
    });
    if (highlight) {
      const hit = list.querySelector('.dr-fn-item.is-highlighted');
      if (hit && typeof hit.scrollIntoView === 'function') hit.scrollIntoView({ block: 'nearest' });
    }
  }

  /** The reference in the note, selected and in view. */
  reveal(view, ref) {
    const leaf = view.leaf;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const editor = view.editor;
    if (!editor || (typeof view.getMode === 'function' && view.getMode() !== 'source')) return;
    const from = editor.offsetToPos(ref.from);
    const to = editor.offsetToPos(ref.to);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    editor.focus();
  }

  addAtCursor(view) {
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    if (typeof view.getMode === 'function' && view.getMode() !== 'source') {
      new Notice('Switch to editing to add a footnote at the cursor.');
      return;
    }
    const cm = view.editor && view.editor.cm;
    if (cm && cm.state) this.feature.openBox(cm);
  }

  /** The citation as a field in place: Enter keeps it, Shift+Enter a new line, Escape leaves it. */
  edit(item, body, view, label, current) {
    if (this.editing) return;
    this.editing = label;
    body.empty();
    const input = body.createEl('textarea', { cls: 'dr-fn-input' });
    input.value = current;
    input.rows = Math.max(2, current.split('\n').length);
    item.addClass('is-editing');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      this.editing = null;
      const value = input.value;
      if (keep && value.trim() !== current.trim()) this.apply(view, { type: 'edit', label, body: value });
      else this.render();
    };
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        finish(true);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  /**
   * A change to the note's footnotes: through its editor where it has
   * one, so it can be undone there; otherwise to the file.
   */
  async apply(view, op, say) {
    const renumber = op.type === 'tidy' ? true : this.feature.renumber;
    const cm = view.editor && view.editor.cm;
    if (cm && cm.state && typeof cm.dispatch === 'function') {
      const plan = planFootnotes(cm.state.doc.toString(), op, { renumber, cursor: cm.state.selection.main.head });
      if (plan.changes.length) this.feature.dispatch(cm, plan);
      if (say) this.say(plan);
    } else if (view.file) {
      let plan = null;
      await this.app.vault.process(view.file, (text) => {
        plan = planFootnotes(text, op, { renumber });
        return applyFootnoteChanges(text, plan.changes);
      });
      if (say && plan) this.say(plan);
    }
    this.render();
  }

  say(plan) {
    if (!plan.changes.length) new Notice('The footnotes are already in order.');
    else if (plan.removed) new Notice(`Footnotes put in order, and ${plan.removed === 1 ? 'one no longer used' : `${plan.removed} no longer used`} taken out.`);
    else new Notice('Footnotes put in order.');
  }
}

/* -- the box ------------------------------------------------------- */

/**
 * A small box by the cursor to type a footnote in. Enter keeps it,
 * Shift+Enter starts a new line, Escape leaves it as it was. Clicking
 * away keeps what was typed rather than lose it.
 */
export class FootnoteBox {
  constructor(feature, cm, spec) {
    this.feature = feature;
    this.cm = cm;
    this.spec = spec;
    this.done = false;
  }

  open() {
    const doc = this.cm.dom.ownerDocument;
    const win = doc.defaultView || window;
    const spec = this.spec;
    const box = (this.el = doc.body.createDiv({ cls: 'dr-fn-box' }));
    if (Platform.isMobile) box.addClass('is-mobile');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', spec.mode === 'edit' ? 'Footnote' : 'Add footnote');

    const head = box.createDiv({ cls: 'dr-fn-head' });
    head.createSpan({ cls: 'dr-fn-num', text: spec.label || '' });
    head.createSpan({ text: spec.mode === 'edit' ? 'Footnote' : 'New footnote' });

    const input = (this.input = box.createEl('textarea', { cls: 'dr-fn-input' }));
    input.rows = 1;
    input.placeholder = 'Citation or note';
    input.value = spec.body || '';
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        this.finish(true);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        this.finish(false);
      }
    });

    const foot = box.createDiv({ cls: 'dr-fn-foot' });
    foot.createDiv({
      cls: 'dr-fn-hint',
      text: Platform.isMobile ? '' : `↵ ${spec.mode === 'edit' ? 'save' : 'add'} · ⇧↵ new line · esc cancel`,
    });
    const buttons = foot.createDiv({ cls: 'dr-fn-buttons' });
    if (spec.mode === 'edit') {
      const remove = buttons.createEl('button', { cls: 'mod-warning', text: 'Remove' });
      remove.addEventListener('click', () => this.finish('remove'));
    }
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.finish(false));
    const keep = buttons.createEl('button', { cls: 'mod-cta', text: spec.mode === 'edit' ? 'Save' : 'Add' });
    keep.addEventListener('click', () => this.finish(true));

    // Clicking elsewhere keeps what was typed.
    this.outside = (evt) => {
      if (!box.contains(evt.target)) this.finish(input.value.trim() !== (spec.body || '').trim() ? true : false);
    };
    doc.addEventListener('mousedown', this.outside, true);
    doc.addEventListener('touchstart', this.outside, true);
    this.doc = doc;

    this.place(win);
    grow();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** Under the cursor's line, or above it where there's no room below. */
  place(win) {
    const box = this.el;
    if (Platform.isMobile) return;
    let coords = null;
    try {
      coords = this.cm.coordsAtPos(this.spec.at);
    } catch (err) {
      coords = null;
    }
    const rect = coords || this.cm.dom.getBoundingClientRect();
    const width = box.offsetWidth || 420;
    const height = box.offsetHeight || 120;
    const left = Math.max(12, Math.min(rect.left - 24, win.innerWidth - width - 12));
    let top = (coords ? coords.bottom : rect.top + 40) + 8;
    if (top + height > win.innerHeight - 12) top = Math.max(12, (coords ? coords.top : rect.top) - height - 8);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  finish(keep) {
    if (this.done) return;
    this.done = true;
    const text = this.input.value;
    this.doc.removeEventListener('mousedown', this.outside, true);
    this.doc.removeEventListener('touchstart', this.outside, true);
    this.el.remove();
    this.feature.box = null;
    this.feature.settle(this.cm, this.spec, keep, text);
  }
}
