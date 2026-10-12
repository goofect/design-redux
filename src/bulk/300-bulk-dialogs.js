/**
 * The parts every bulk dialog shares: labelled fields, a summary of
 * what will happen that updates as you type, and the button that does
 * it, which says how many notes it will change.
 */

import { Modal, setIcon, TFile, TFolder } from 'obsidian';
import { composing } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { plainValue, valueList } from '../core/045-helpers-properties.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { attachSuggest } from '../core/050-helpers-dom.js';
import { noteProps } from '../core/073-notes.js';
import { FolderPicker } from '../ui/230-pickers.js';

/** Conditions a note must meet to be among a dialog's notes. */
export const WHERE_OPS = {
  is: 'is',
  not: 'is not',
  contains: 'contains',
  has: 'has a value',
  lacks: 'has no value',
};

/** Whether a condition is filled in enough to count. */
export function whereReady(row) {
  if (!row.key || !row.key.trim()) return false;
  return row.op === 'has' || row.op === 'lacks' || plainValue(row.value || '') !== '';
}

/** Whether a note's properties meet a condition: any item of a list will do; case doesn't count. */
export function whereHolds(fm, row) {
  const low = row.key.trim().toLowerCase();
  const name = Object.keys(fm || {}).find((k) => k.toLowerCase() === low);
  const values = name === undefined ? [] : valueList(fm[name]).map((v) => plainValue(v).toLowerCase()).filter((v) => v !== '');
  const want = plainValue(row.value || '').toLowerCase();
  if (row.op === 'has') return values.length > 0;
  if (row.op === 'lacks') return !values.length;
  if (row.op === 'contains') return values.some((v) => v.includes(want));
  const is = values.indexOf(want) !== -1;
  return row.op === 'not' ? !is : is;
}

export class BulkModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.bulk = plugin.bulk;
    // Bases are read afresh for each dialog, in case one was edited.
    this.bulk.baseCache = null;
    this.suggests = [];
    this.updateTimer = 0;
    this.action = null;
    this.targets = [];
    this.reach = 'deep';
    // Only notes meeting these, less the ones left out from the summary.
    this.where = [];
    this.excluded = new Set();
  }

  /** The notes in the folders and notes chosen that meet the conditions, less any left out. */
  notes() {
    const rows = this.where.filter(whereReady);
    return this.bulk.notesFor(this.targets, this.reach).filter((file) => {
      if (this.excluded.has(file.path)) return false;
      if (!rows.length) return true;
      const fm = noteProps(this.app, file);
      return rows.every((row) => whereHolds(fm, row));
    });
  }

  frame(title) {
    this.modalEl.addClass('dr-bulk-modal');
    this.titleEl.setText(title);
    this.contentEl.empty();
    this.body = this.contentEl.createDiv({ cls: 'dr-bulk-body' });
    this.summaryEl = this.contentEl.createDiv({ cls: 'dr-bulk-summary' });
    this.summaryEl.setAttribute('aria-live', 'polite');
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    this.goButton = buttons.createEl('button', { cls: 'mod-cta' });
    this.goButton.addEventListener('click', () => this.go());
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  section(label) {
    const el = this.body.createDiv({ cls: 'dr-bulk-section' });
    if (label) el.createDiv({ cls: 'dr-bulk-label', text: label });
    return el;
  }

  /* -- folders and notes, as chips ---------------------------------- */

  addTarget(target) {
    if (!target || this.targets.indexOf(target) !== -1) return;
    if (target instanceof TFolder || (target instanceof TFile && target.extension === 'md')) {
      this.targets.push(target);
    }
  }

  /** A section of chips for the folders and notes, and which of their notes. */
  targetsSection(label) {
    const where = this.section(label);
    where.addClass('is-where');
    this.targetsEl = where.createDiv({ cls: 'dr-bulk-chips' });
    this.scopeEl = where.createDiv({ cls: 'dr-bulk-option' });
    this.whereEl = where.createDiv({ cls: 'dr-bulk-where' });
    this.renderTargets();
    this.renderWhere();
    return where;
  }

  /** The conditions, a row each — property, how, value — and a way to add one. */
  renderWhere() {
    const el = this.whereEl;
    if (!el) return;
    el.empty();
    this.where.forEach((row, i) => {
      const line = el.createDiv({ cls: 'dr-bulk-where-row' });
      line.createSpan({ cls: 'dr-bulk-where-word', text: i ? 'and' : 'where' });
      const key = line.createEl('input', { type: 'text', cls: 'dr-bulk-where-key' });
      key.placeholder = 'property';
      key.value = row.key;
      key.setAttribute('aria-label', 'Property');
      key.setAttribute('autocomplete', 'off');
      key.setAttribute('spellcheck', 'false');
      key.addEventListener('input', () => {
        row.key = key.value;
        this.queueUpdate();
      });
      const op = line.createEl('select', { cls: 'dropdown dr-bulk-where-op' });
      Object.entries(WHERE_OPS).forEach(([value, label]) => {
        const option = op.createEl('option', { text: label });
        option.value = value;
      });
      op.value = row.op;
      op.setAttribute('aria-label', 'How');
      const value = line.createEl('input', { type: 'text', cls: 'dr-bulk-where-value' });
      value.placeholder = 'value';
      value.value = row.value;
      value.setAttribute('aria-label', 'Value');
      value.toggleClass('is-hidden', row.op === 'has' || row.op === 'lacks');
      value.addEventListener('input', () => {
        row.value = value.value;
        this.queueUpdate();
      });
      op.addEventListener('change', () => {
        row.op = op.value;
        value.toggleClass('is-hidden', row.op === 'has' || row.op === 'lacks');
        this.update();
      });
      const remove = line.createSpan({ cls: 'dr-bulk-chip-remove' });
      setIcon(remove, 'x');
      asButton(remove, 'Remove this condition');
      onActivate(remove, () => {
        this.where.splice(this.where.indexOf(row), 1);
        this.renderWhere();
        this.update();
      });
    });
    const add = el.createDiv({ cls: 'dr-bulk-where-add' });
    asButton(add);
    setIcon(add.createSpan({ cls: 'dr-bulk-chip-icon' }), 'filter');
    add.createSpan({ text: this.where.length ? 'And where…' : 'Only notes where…' });
    onActivate(add, () => {
      this.where.push({ key: '', op: 'is', value: '' });
      this.renderWhere();
      const last = el.querySelector('.dr-bulk-where-row:last-of-type .dr-bulk-where-key');
      if (last) last.focus();
    });
  }

  renderTargets() {
    const el = this.targetsEl;
    el.empty();
    this.targets.forEach((target) => {
      const chip = el.createDiv({ cls: 'dr-bulk-chip' });
      const isFolder = target instanceof TFolder;
      setIcon(chip.createSpan({ cls: 'dr-bulk-chip-icon' }), isFolder ? 'folder' : 'file-text');
      const name = isFolder ? target.name || this.app.vault.getName() : target.basename;
      chip.createSpan({ cls: 'dr-bulk-chip-name', text: name });
      chip.setAttribute('aria-label', target.path);
      const remove = chip.createSpan({ cls: 'dr-bulk-chip-remove' });
      setIcon(remove, 'x');
      asButton(remove, `Remove ${name}`);
      onActivate(remove, () => {
        this.targets.splice(this.targets.indexOf(target), 1);
        this.renderTargets();
        this.update();
      });
    });
    const pick = el.createDiv({ cls: 'dr-bulk-chip is-add' });
    asButton(pick);
    // With folders chosen, just a round + beside them; with none, it says what it's for.
    pick.toggleClass('is-icon', this.targets.length > 0);
    setIcon(pick.createSpan({ cls: 'dr-bulk-chip-icon' }), this.targets.length ? 'plus' : 'folder-plus');
    if (this.targets.length) pick.setAttribute('aria-label', 'Add a folder');
    else pick.createSpan({ text: 'Choose a folder' });
    onActivate(pick, () =>
      new FolderPicker(this.app, (folder) => {
        this.addTarget(folder);
        this.renderTargets();
        this.update();
      }).open()
    );
    this.renderScope();
  }

  renderScope() {
    const el = this.scopeEl;
    el.empty();
    const folders = this.targets.some((t) => t instanceof TFolder);
    el.toggleClass('is-hidden', !folders);
    if (!folders) return;
    const select = el.createEl('select', { cls: 'dropdown' });
    [
      ['deep', 'Including subfolders'],
      ['direct', 'Not their subfolders'],
      ['folder-notes', 'Folder notes only'],
    ].forEach(([value, label]) => {
      const option = select.createEl('option', { text: label });
      option.value = value;
    });
    select.value = this.reach;
    select.setAttribute('aria-label', 'Which notes');
    select.addEventListener('change', () => {
      this.reach = select.value;
      this.update();
    });
  }


  /** A text field with a label, and a line beneath it for a hint. */
  field(parent, label, placeholder) {
    const wrap = parent.createDiv({ cls: 'dr-bulk-field' });
    const id = `dr-bulk-${Math.random().toString(36).slice(2)}`;
    const labelEl = wrap.createEl('label', { cls: 'dr-bulk-label', text: label });
    labelEl.setAttribute('for', id);
    const box = wrap.createDiv({ cls: 'dr-bulk-input' });
    const input = box.createEl('input', { type: 'text' });
    input.id = id;
    input.placeholder = placeholder;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    const hint = wrap.createDiv({ cls: 'dr-bulk-hint' });
    input.addEventListener('input', () => this.queueUpdate());
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      // The latest typing counts, not the summary from a moment ago.
      window.clearTimeout(this.updateTimer);
      this.update();
      if (this.action) this.go();
    });
    return { input, hint, box };
  }

  suggest(box, input, opts) {
    const list = attachSuggest(box, input, opts);
    list.addClass('dr-bulk-suggest');
    this.suggests.push(list);
    return list;
  }

  /** Whether a suggestion is highlighted, so Enter picks it rather than applying. */
  suggesting() {
    return this.suggests.some((l) => l.hasClass('is-open') && !!l.querySelector('.is-selected'));
  }

  queueUpdate() {
    window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => this.update(), 60);
  }

  update() {}

  /**
   * Lines of the summary: { text, cls?, icon?, notes? }. `action` is
   * { label, run } or null while there's nothing to do.
   */
  showSummary(lines, action) {
    this.summaryEl.empty();
    lines.forEach((line) => {
      const el = this.summaryEl.createDiv({ cls: `dr-bulk-line ${line.cls || ''}`.trim() });
      setIcon(el.createSpan({ cls: 'dr-bulk-line-icon' }), line.icon || 'dot');
      const text = el.createDiv({ cls: 'dr-bulk-line-text' });
      text.createSpan({ text: line.text });
      if (line.notes && line.notes.length) this.noteList(text.createDiv({ cls: 'dr-bulk-notes' }), line.notes, 6);
    });
    // Notes left out of a dialog that picks its notes from folders, and a way to put them back.
    const left = this.whereEl ? this.excluded.size : 0;
    if (left) {
      const el = this.summaryEl.createDiv({ cls: 'dr-bulk-line is-left-out' });
      setIcon(el.createSpan({ cls: 'dr-bulk-line-icon' }), 'eye-off');
      const text = el.createDiv({ cls: 'dr-bulk-line-text' });
      text.createSpan({ text: `${bulkCount(left, 'note')} left out. ` });
      const back = text.createSpan({ cls: 'dr-bulk-note dr-bulk-put-back', text: 'Put back' });
      asButton(back);
      onActivate(back, () => {
        this.excluded.clear();
        this.update();
      });
    }
    this.summaryEl.toggleClass('is-empty', !lines.length && !left);
    this.action = action;
    this.goButton.setText(action ? action.label : this.idleLabel || 'Apply');
    this.goButton.disabled = !action;
    this.goButton.toggleClass('is-disabled', !action);
  }

  /**
   * Notes as links, the first few and "and N more" to show the rest; in a
   * dialog that picks its notes from folders, each with an × to leave it out.
   */
  noteList(list, notes, shown) {
    list.empty();
    notes.slice(0, shown).forEach((file) => {
      const wrap = list.createSpan({ cls: 'dr-bulk-note-wrap' });
      const link = wrap.createSpan({ cls: 'dr-bulk-note', text: file.basename });
      link.setAttribute('role', 'link');
      link.setAttribute('tabindex', '0');
      link.setAttribute('aria-label', `Open ${file.path}`);
      onActivate(link, () => {
        this.close();
        this.app.workspace.getLeaf(false).openFile(file);
      });
      if (!this.whereEl) return;
      const leave = wrap.createSpan({ cls: 'dr-bulk-chip-remove dr-bulk-leave' });
      setIcon(leave, 'x');
      asButton(leave, `Leave out ${file.basename}`);
      onActivate(leave, () => {
        this.excluded.add(file.path);
        this.update();
      });
    });
    if (notes.length <= shown) return;
    const more = list.createSpan({ cls: 'dr-bulk-more', text: `and ${notes.length - shown} more` });
    asButton(more);
    onActivate(more, () => this.noteList(list, notes, notes.length));
  }

  async go() {
    const action = this.action;
    if (!action || this.bulk.busy) return;
    this.action = null;
    this.close();
    await action.run();
  }

  onClose() {
    window.clearTimeout(this.updateTimer);
    this.suggests.forEach((el) => el.remove());
    this.suggests = [];
    this.contentEl.empty();
  }
}
