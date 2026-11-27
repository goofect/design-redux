/* ------------------------------------------------------------------ */
/* Sheets: the browser's own modal dialog                              */
/*                                                                     */
/* A <dialog> opened modal, in the window in front: its header the     */
/* title (with what it asks, a heading group), the matter, a footer of */
/* buttons, the one that commits last. Escape, Cancel or a press       */
/* outside closes it; while it is open Obsidian's hotkeys wait.        */
/* ------------------------------------------------------------------ */

import { Scope } from 'obsidian';
import { el } from '../core/dom.js';
import { textButton } from './button.js';
import { field } from './field.js';

let titles = 0;

/**
 * A sheet. { title, text, build(matter, sheet), actions: [{ text, run(sheet) }] }, the one
 * that commits last; an action's run may return false to keep the sheet open.
 */
export class Sheet {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.closed = null;
    this.dialog = null;
  }

  /** What is in it (the dialog itself). */
  get contentEl() {
    return this.dialog;
  }

  open() {
    if (this.dialog) return;
    const dialog = (this.dialog = el(activeDocument.body, 'dialog', 'dr dr-sheet'));
    const head = el(dialog, 'header', 'dr-sheet-head');
    const named = this.opts.text ? el(head, 'hgroup', 'dr-sheet-titles') : head;
    const title = el(named, 'h2', 'dr-sheet-title', this.opts.title);
    title.id = `dr-sheet-title-${++titles}`;
    dialog.setAttribute('aria-labelledby', title.id);
    if (this.opts.text) el(named, 'p', 'dr-text dr-running', this.opts.text);
    this.matter = el(dialog, 'div', 'dr-sheet-matter');
    if (this.opts.build) this.opts.build(this.matter, this);
    const foot = el(dialog, 'footer', 'dr-sheet-actions');
    (this.opts.actions || []).forEach((action) =>
      textButton(foot, {
        text: action.text,
        run: async () => {
          if ((await (action.run ? action.run(this) : undefined)) !== false) this.close();
        },
      })
    );
    // Escape is the dialog's own cancel; a press on the backdrop (outside the dialog's box) closes it too.
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    dialog.addEventListener('mousedown', (e) => {
      if (e.target !== dialog || typeof dialog.getBoundingClientRect !== 'function') return;
      const box = dialog.getBoundingClientRect();
      if (box.width && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom)) this.close();
    });
    // A scope of its own, with no parent: no hotkey of Obsidian's acts under the sheet.
    const keymap = this.app.keymap;
    if (keymap && typeof keymap.pushScope === 'function') keymap.pushScope((this.keys = new Scope()));
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    Sheet.shown.push(this);
  }

  close() {
    const dialog = this.dialog;
    if (!dialog) return;
    this.dialog = null;
    Sheet.shown = Sheet.shown.filter((s) => s !== this);
    if (this.keys) this.app.keymap.popScope(this.keys);
    this.keys = null;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    dialog.remove();
    if (this.closed) this.closed();
  }
}

/** The sheets open now, the one in front last. */
Sheet.shown = [];

/** Asks yes or no. { title, text, action (the yes button's words, which say what it does) }. Resolves true on yes. */
export function confirm(app, opts) {
  return new Promise((resolve) => {
    let yes = false;
    const sheet = new Sheet(app, {
      title: opts.title,
      text: opts.text,
      actions: [{ text: 'Cancel' }, { text: opts.action || 'OK', run: () => void (yes = true) }],
    });
    sheet.closed = () => resolve(yes);
    sheet.open();
  });
}

/** Asks for a line of text. { title, text, label, value, placeholder, action, optional (nothing will do too, as ''), check(value): a reason it won't do, onPaste(text): true when it took what was pasted (the sheet then closes) }. Resolves the text, or null. */
export function ask(app, opts) {
  return new Promise((resolve) => {
    let answer = null;
    let input = null;
    const accept = (sheet) => {
      const value = input.drInput.value.trim();
      const wrong = !value ? (opts.optional ? null : 'It needs a name.') : opts.check ? opts.check(value) : null;
      if (wrong) return void input.drSay(wrong, true), false;
      answer = value;
      if (sheet) sheet.close();
      return true;
    };
    const sheet = new Sheet(app, {
      title: opts.title,
      text: opts.text,
      build: (matter, s) => {
        input = field(matter, { label: opts.label || 'Name', value: opts.value, placeholder: opts.placeholder, onEnter: () => accept(s) });
        if (opts.onPaste) input.drInput.addEventListener('paste', (e) => {
          if (e.clipboardData && opts.onPaste(e.clipboardData.getData('text/plain'))) { e.preventDefault(); s.close(); }
        });
        setTimeout(() => { input.drInput.focus(); input.drInput.select(); }, 0);
      },
      actions: [{ text: 'Cancel' }, { text: opts.action || 'OK', run: () => accept(null) }],
    });
    sheet.closed = () => resolve(answer);
    sheet.open();
  });
}
