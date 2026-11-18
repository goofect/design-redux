/* ------------------------------------------------------------------ */
/* Sheets: what the plugin puts in one of Obsidian's modals            */
/* ------------------------------------------------------------------ */

import { Modal } from 'obsidian';
import { el } from '../core/dom.js';
import { textButton } from './button.js';
import { field } from './field.js';

/**
 * A sheet: a title, the matter, the buttons at the foot.
 * { title, build(matter, sheet), actions: [{ text, kind, run(sheet) }] };
 * an action's run may return false to keep the sheet open.
 */
export class Sheet extends Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
    this.closed = null;
  }

  onOpen() {
    this.setTitle ? this.setTitle(this.opts.title) : (this.titleEl.textContent = this.opts.title);
    const sheet = el(this.contentEl, 'div', 'dr dr-sheet');
    this.matter = el(sheet, 'div', 'dr-sheet-matter');
    if (this.opts.text) el(this.matter, 'p', 'dr-text is-running', this.opts.text);
    if (this.opts.build) this.opts.build(this.matter, this);
    const foot = el(sheet, 'div', 'dr-sheet-actions');
    (this.opts.actions || []).forEach((action) =>
      textButton(foot, {
        text: action.text,
        kind: action.kind,
        run: async () => {
          if ((await (action.run ? action.run(this) : undefined)) !== false) this.close();
        },
      })
    );
  }

  onClose() {
    while (this.contentEl.firstChild) this.contentEl.removeChild(this.contentEl.firstChild);
    if (this.closed) this.closed();
  }
}

/** Asks yes or no. { title, text, action (the yes button's words), danger }. Resolves true on yes. */
export function confirm(app, opts) {
  return new Promise((resolve) => {
    let yes = false;
    const sheet = new Sheet(app, {
      title: opts.title,
      text: opts.text,
      actions: [{ text: 'Cancel' }, { text: opts.action || 'OK', kind: opts.danger ? 'danger' : 'primary', run: () => void (yes = true) }],
    });
    sheet.closed = () => resolve(yes);
    sheet.open();
  });
}

/** Asks for a line of text. { title, text, label, value, placeholder, action, check(value): a reason it won't do, more: [{ text, run }] (words beside Cancel) }. Resolves the text, or null. */
export function ask(app, opts) {
  return new Promise((resolve) => {
    let answer = null;
    let input = null;
    const accept = (sheet) => {
      const value = input.drInput.value.trim();
      const wrong = !value ? 'It needs a name.' : opts.check ? opts.check(value) : null;
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
        setTimeout(() => { input.drInput.focus(); input.drInput.select(); }, 0);
      },
      actions: [{ text: 'Cancel' }].concat(opts.more || [], [{ text: opts.action || 'OK', kind: 'primary', run: () => accept(null) }]),
    });
    sheet.closed = () => resolve(answer);
    sheet.open();
  });
}
