/* ------------------------------------------------------------------ */
/* Footnotes in place                                                  */
/*                                                                     */
/* A citation shouldn't mean leaving the sentence. Add footnote opens  */
/* a small box at the cursor: the citation's typed there, the number   */
/* goes in where the cursor was and the citation to the end of the     */
/* note, and writing carries on. On a footnote already there, the same */
/* box shows its text, to change or remove.                            */
/*                                                                     */
/* Numbers are kept in the order footnotes appear: one added between   */
/* 1 and 2 becomes 2, and what was 2 becomes 3, in the text and at the */
/* end alike, where the citations are listed in that order. Named      */
/* footnotes ([^smith]) keep their names. A citation whose number was  */
/* taken out of the text by hand is kept, numbered last — it may be on */
/* its way somewhere else — until Put footnotes in order clears it.    */
/*                                                                     */
/* Everything is worked out from the note's text by the functions      */
/* here, and made as one change: one undo puts it all back.            */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { findSubmenu } from '../core/030-helpers-art.js';
import { activeEditorView } from '../core/050-helpers-dom.js';
import { actionsOn, addActionEntries, editorContext } from '../core/078-actions.js';
import { Feature } from '../core/080-feature.js';
import { applyFootnoteChanges, footnoteAt, footnoteBody, planFootnotes, scanFootnotes } from './283-footnote-text.js';
import { FootnoteBox, footnoteHider, FOOTNOTES_VIEW, FootnotesView } from './284-footnote-views.js';

export class Footnotes extends Feature {
  settingsSchema() {
    return [
      {
        key: 'footnotes',
        name: 'Footnote box',
        desc: 'Add footnote opens a box at the cursor; the citation goes to the end of the note.',
      },
      {
        key: 'footnotesAside',
        showIf: 'footnotes',
        name: 'Footnotes view',
        desc: 'Hide the citations at the end of a note and list them in a sidebar view.',
      },
      {
        key: 'footnoteOrder',
        showIf: 'footnotes',
        name: 'Renumber footnotes',
        desc: 'Keep footnotes numbered in the order they appear.',
      },
    ];
  }

  actions() {
    const hit = (ctx) => footnoteAt(ctx.cm.state.doc.toString(), ctx.cm.state.selection.main.head);
    return [
      {
        id: 'add-footnote',
        name: 'Add footnote',
        // ctx.place: where the editor's menu put it — in Obsidian's Insert, it's "here".
        menu: (ctx) => (hit(ctx) ? 'Change footnote' : ctx.place === 'insert' ? 'Footnote here' : 'Add footnote'),
        icon: 'file-signature',
        on: 'editor',
        when: (ctx) => this.enabled && !!ctx.cm,
        run: (ctx) => this.openBox(ctx.cm),
      },
      { id: 'show-footnotes', name: 'Show footnotes', icon: 'file-signature', when: () => this.enabled, run: () => this.showView() },
      { id: 'tidy-footnotes', name: 'Put footnotes in order', menu: false, icon: 'list-ordered', on: 'editor', when: (ctx) => this.enabled && !!ctx.cm, run: (ctx) => this.tidy(ctx.cm) },
    ];
  }

  /** The editor of the note being edited, if one is. */
  editorView() {
    return activeEditorView(this.app);
  }

  registerTypes() {
    this.extensions = [];
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerView(FOOTNOTES_VIEW, (leaf) => new FootnotesView(leaf, this));
  }

  get aside() {
    return this.enabled && this.settings.footnotesAside !== false;
  }

  enable() {
    this.applyAside();
  }

  /** The citations off the page, or back on it, as the setting says — or off, when going away. */
  applyAside(on = this.aside) {
    document.body.toggleClass('dr-footnotes-aside', on);
    if (this.asideOn === on || !this.extensions) return;
    this.asideOn = on;
    this.extensions.length = 0;
    if (on) this.extensions.push(footnoteHider(() => this.aside));
    this.app.workspace.updateOptions();
  }

  /** The Footnotes view in the right sidebar, opened if it isn't, and shown. */
  async showView(highlight) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(FOOTNOTES_VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: FOOTNOTES_VIEW, active: false });
    }
    ws.revealLeaf(leaf);
    if (leaf.view instanceof FootnotesView) leaf.view.render(highlight);
    return leaf;
  }

  /** How many footnotes a note has, from what Obsidian read of it. */
  countIn(file) {
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    return cache && Array.isArray(cache.footnotes) ? cache.footnotes.length : 0;
  }

  register() {
    // In reading view the list at the end is out of sight, so a number
    // clicked opens the view at its citation instead.
    this.plugin.registerDomEvent(
      document,
      'click',
      (evt) => {
        if (!this.aside) return;
        const target = evt.target;
        const link = target && typeof target.closest === 'function' ? target.closest('.markdown-reading-view sup.footnote-ref a, .markdown-reading-view a.footnote-link') : null;
        if (!link) return;
        evt.preventDefault();
        evt.stopPropagation();
        // Reading view numbers them in order, as the view does.
        const label = (link.textContent || '').replace(/[^\w-]/g, '');
        this.showView(label || undefined);
      },
      true
    );

    this.plugin.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        const ctx = this.enabled ? editorContext(editor, info, 'menu') : null;
        if (!ctx || !ctx.cm) return;
        const hit = footnoteAt(ctx.cm.state.doc.toString(), ctx.cm.state.selection.main.head);
        const insert = hit ? null : findSubmenu(menu, 'Insert');
        if (insert) ctx.place = 'insert';
        addActionEntries(insert || menu, actionsOn(this.actions(), 'editor'), ctx, insert ? null : hit ? 'action' : 'selection');
      })
    );
  }

  disable() {
    if (this.box) this.box.finish(false);
    // Off whatever the setting says: unloading, the setting is still on.
    this.applyAside(false);
  }

  get renumber() {
    return this.settings.footnoteOrder !== false;
  }

  /**
   * The box, for the footnote under the cursor or a new one after it —
   * after the selection, if there is one: that's what's being cited.
   */
  openBox(cm) {
    if (!cm) return;
    if (this.box) this.box.finish(false);
    const text = cm.state.doc.toString();
    const range = cm.state.selection.main;
    const hit = footnoteAt(text, range.head);
    let spec;
    if (hit) {
      const def = scanFootnotes(text).defs.find((d) => d.label === hit.label);
      spec = {
        mode: 'edit',
        at: hit.from,
        ref: hit,
        label: hit.label,
        body: def ? footnoteBody(text, def) : '',
      };
    } else {
      // After what's selected, not after a space selected with it.
      let at = range.to;
      while (at > range.from && /\s/.test(text[at - 1])) at--;
      const plan = planFootnotes(text, { type: 'add', at, body: '' }, { renumber: this.renumber });
      spec = { mode: 'add', at, label: plan.label, body: '' };
    }
    spec.doc = cm.state.doc;
    this.box = new FootnoteBox(this, cm, spec);
    this.box.open();
  }

  /** What the box was left with, made into one change to the note. */
  settle(cm, spec, keep, body) {
    const focus = () => {
      if (typeof cm.focus === 'function') cm.focus();
    };
    if (!keep || (keep === true && !body.trim() && spec.mode === 'add')) {
      focus();
      return;
    }
    const text = cm.state.doc.toString();
    // The note changed while the box was open (synced, say): the box's
    // place is looked for again.
    let at = spec.at;
    let ref = spec.ref;
    if (cm.state.doc !== spec.doc) {
      at = Math.min(cm.state.selection.main.to, text.length);
      if (ref) ref = footnoteAt(text, at) || footnoteAt(text, cm.state.selection.main.head);
      if (spec.mode === 'edit' && !ref) {
        focus();
        return;
      }
    }
    let op;
    if (keep === 'remove') op = { type: 'remove', from: ref.from, to: ref.to, label: ref.label };
    else if (spec.mode === 'edit') op = { type: 'edit', label: ref.label, body };
    else op = { type: 'add', at, body };
    const plan = planFootnotes(text, op, { renumber: this.renumber, cursor: cm.state.selection.main.head });
    this.dispatch(cm, plan);
    focus();
  }

  tidy(cm) {
    if (!cm) return;
    const text = cm.state.doc.toString();
    const plan = planFootnotes(text, { type: 'tidy' }, { renumber: true, cursor: cm.state.selection.main.head });
    if (!plan.changes.length || applyFootnoteChanges(text, plan.changes) === text) {
      new Notice('The footnotes are already in order.');
      return;
    }
    this.dispatch(cm, plan);
    new Notice(
      plan.removed
        ? `Footnotes put in order, and ${plan.removed === 1 ? 'one no longer used' : `${plan.removed} no longer used`} taken out.`
        : 'Footnotes put in order.'
    );
  }

  dispatch(cm, plan) {
    if (!plan.changes.length) return;
    const spec = { changes: plan.changes, scrollIntoView: true, userEvent: 'input' };
    if (plan.cursor !== null && plan.cursor !== undefined) spec.selection = { anchor: plan.cursor };
    cm.dispatch(spec);
  }
}

Footnotes.settingKey = 'footnotes';
