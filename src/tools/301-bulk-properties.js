/* ------------------------------------------------------------------ */
/* Bulk: properties added and removed                                 */
/*                                                                    */
/* In folders or chosen notes; a folder's defaults for new notes.     */
/* Renaming and merging are 308-bulk-rename-merge's.                  */
/* ------------------------------------------------------------------ */

import { Menu, Notice, setIcon, TFolder } from 'obsidian';
import { TYPE_ICONS, TYPE_LABELS } from '../core/020-constants.js';
import { showMenuAt } from '../core/036-menus.js';
import { asButton, composing, onActivate } from '../core/042-controls.js';
import { knownPropertyNames, propertyValues } from '../core/045-helpers-properties.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { schemaWithDefaults } from '../core/086-property-schema.js';
import { LIST_TYPES, parseTypedValue, propertiesIn, propertyNameProblem, propertyType } from './288-bulk-values.js';
import { bulkNotice, bulkTail, nameList, notesChanged } from './290-bulk-engine.js';
import { BulkModal } from './300-bulk-dialogs.js';

/**
 * Add properties to every note in some folders — or to the notes
 * chosen — at once. Each property takes its type from the vault if
 * the vault has it already, or one chosen here if it's new.
 */
export class AddPropertiesModal extends BulkModal {
  constructor(plugin, targets) {
    super(plugin);
    this.targets = [];
    (targets || []).forEach((t) => this.addTarget(t));
    this.reach = 'deep';
    this.replace = false;
    this.rows = [];
    this.idleLabel = 'Add';
  }

  onOpen() {
    this.frame('Add properties');
    this.targetsSection('Add to');

    const what = this.section('Properties');
    this.rowsEl = what.createDiv({ cls: 'dr-bulk-rows' });
    const add = what.createDiv({ cls: 'dr-bulk-add' });
    asButton(add);
    setIcon(add.createSpan({ cls: 'dr-bulk-add-icon' }), 'plus');
    add.createSpan({ text: 'Add another property' });
    onActivate(add, () => {
      this.rows.push(this.newRow());
      this.renderRows();
      const last = this.rowsEl.querySelector('.dr-bulk-row:last-child .dr-bulk-name input');
      if (last) last.focus();
    });
    this.existingEl = what.createDiv({ cls: 'dr-bulk-option' });

    this.rows.push(this.newRow());
    this.renderTargets();
    this.renderRows();
    this.renderExisting();
    this.update();
    window.setTimeout(() => {
      const first = this.rowsEl.querySelector('.dr-bulk-name input');
      if (first) first.focus();
    }, 0);
  }

  newRow() {
    return { key: '', type: 'text', raw: '', locked: false };
  }

  renderExisting() {
    const el = this.existingEl;
    el.empty();
    el.createSpan({ cls: 'dr-bulk-option-label', text: 'Where a note already has one' });
    const select = el.createEl('select', { cls: 'dropdown' });
    [
      ['keep', 'Keep its value — lists get the new items'],
      ['replace', 'Replace its value'],
    ].forEach(([value, label]) => {
      const option = select.createEl('option', { text: label });
      option.value = value;
    });
    select.value = this.replace ? 'replace' : 'keep';
    select.addEventListener('change', () => {
      this.replace = select.value === 'replace';
      this.update();
    });
  }

  renderRows() {
    this.suggests.forEach((el) => el.remove());
    this.suggests = [];
    this.rowsEl.empty();
    this.rows.forEach((row) => this.renderRow(row));
  }

  renderRow(row) {
    const el = this.rowsEl.createDiv({ cls: 'dr-bulk-row' });
    const typeBtn = el.createDiv({ cls: 'dr-bulk-type' });
    const nameBox = el.createDiv({ cls: 'dr-bulk-name' });
    const name = nameBox.createEl('input', { type: 'text' });
    name.placeholder = 'Property';
    name.value = row.key;
    name.setAttribute('aria-label', 'Property name');
    name.setAttribute('autocomplete', 'off');
    const valueBox = el.createDiv({ cls: 'dr-bulk-value' });
    const remove = el.createDiv({ cls: 'dr-bulk-remove clickable-icon' });
    setIcon(remove, 'x');
    remove.setAttribute('aria-label', 'Remove this property');
    asButton(remove);
    onActivate(remove, () => {
      this.rows.splice(this.rows.indexOf(row), 1);
      if (!this.rows.length) this.rows.push(this.newRow());
      this.renderRows();
      this.update();
    });

    const paintType = () => {
      typeBtn.empty();
      setIcon(typeBtn, TYPE_ICONS[row.type] || 'text');
      typeBtn.toggleClass('is-locked', row.locked);
      asButton(
        typeBtn,
        row.locked
          ? `${TYPE_LABELS[row.type] || 'Text'}, as it is in the rest of the vault`
          : `${TYPE_LABELS[row.type] || 'Text'} — choose the type`
      );
      if (row.locked) typeBtn.setAttribute('tabindex', '-1');
    };
    const setType = (type, locked) => {
      const was = row.type;
      row.type = type;
      row.locked = locked;
      paintType();
      if (was !== type) {
        const focused = valueBox.contains(document.activeElement);
        this.renderValue(row, valueBox);
        if (focused) {
          const field = valueBox.querySelector('input');
          if (field) field.focus();
        }
      }
    };
    // A name the vault already uses brings its type along.
    const settleName = () => {
      row.key = name.value.trim();
      const known = knownPropertyNames(this.app).find(
        (n) => n.toLowerCase() === row.key.toLowerCase()
      );
      if (known) setType(propertyType(this.app, known), true);
      else if (row.locked) setType('text', false);
      this.update();
    };
    onActivate(typeBtn, (evt) => {
      if (row.locked) return;
      const menu = new Menu();
      Object.keys(TYPE_ICONS).forEach((type) =>
        menu.addItem((item) =>
          item
            .setTitle(TYPE_LABELS[type])
            .setIcon(TYPE_ICONS[type])
            .setChecked(type === row.type)
            .onClick(() => {
              setType(type, false);
              this.update();
            })
        )
      );
      showMenuAt(menu, evt);
    });

    name.addEventListener('input', () => {
      row.key = name.value.trim();
      this.queueUpdate();
    });
    name.addEventListener('change', settleName);
    name.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      settleName();
      const field = valueBox.querySelector('input');
      if (field) field.focus();
    });
    this.suggest(nameBox, name, {
      icon: 'tag',
      source: () => {
        const taken = this.rows.filter((r) => r !== row).map((r) => r.key.toLowerCase());
        return knownPropertyNames(this.app).filter((n) => taken.indexOf(n.toLowerCase()) === -1);
      },
      onSelect: (v) => {
        name.value = v;
        settleName();
        const field = valueBox.querySelector('input');
        if (field) field.focus();
      },
    });

    if (row.key) {
      const known = knownPropertyNames(this.app).find((n) => n.toLowerCase() === row.key.toLowerCase());
      if (known) {
        row.type = propertyType(this.app, known);
        row.locked = true;
      }
    }
    paintType();
    this.renderValue(row, valueBox);
  }

  /** The value's field, shaped by the type: a checkbox, a date, a list, a number or text. */
  renderValue(row, box) {
    box.empty();
    const type = row.type;
    if (type === 'checkbox') {
      const label = box.createEl('label', { cls: 'dr-bulk-check' });
      const input = label.createEl('input', { type: 'checkbox' });
      input.checked = row.raw === true;
      row.raw = input.checked;
      label.createSpan({ text: 'Ticked' });
      input.addEventListener('change', () => {
        row.raw = input.checked;
        this.update();
      });
      return;
    }
    const input = box.createEl('input', {
      type: type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text',
    });
    input.setAttribute('aria-label', 'Value');
    input.setAttribute('autocomplete', 'off');
    if (typeof row.raw === 'string') input.value = row.raw;
    else row.raw = '';
    input.placeholder =
      LIST_TYPES.indexOf(type) !== -1
        ? 'Items, separated by commas'
        : type === 'number'
          ? 'Number, or leave empty'
          : 'Value, or leave empty';
    if (type === 'number') input.setAttribute('inputmode', 'decimal');
    input.addEventListener('input', () => {
      row.raw = input.value;
      this.queueUpdate();
    });
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      window.clearTimeout(this.updateTimer);
      this.update();
      if (this.action) this.go();
    });
    if (type === 'date' || type === 'datetime' || type === 'number' || type === 'checkbox') return;

    // The values the property already takes, to pick from; in a list,
    // for the item being typed.
    const isList = LIST_TYPES.indexOf(type) !== -1;
    const last = () => (isList ? input.value.split(',').pop() : input.value);
    this.suggest(box, input, {
      icon: type === 'tags' ? 'hash' : 'text',
      query: last,
      source: () => {
        if (!row.key) return [];
        const typed = isList
          ? input.value.split(',').slice(0, -1).map((s) => s.trim().toLowerCase())
          : [];
        return propertyValues(this.app, row.key).filter((v) => typed.indexOf(v.toLowerCase()) === -1);
      },
      onSelect: (v) => {
        if (isList) {
          const done = input.value.split(',').slice(0, -1).map((s) => s.trim()).filter(Boolean);
          input.value = done.concat(v).join(', ') + ', ';
        } else input.value = v;
        row.raw = input.value;
        input.focus();
        this.update();
      },
    });
  }

  /** What would be added, where, and what's stopping it if anything is. */
  update() {
    const lines = [];
    const named = this.rows.filter((r) => r.key);
    const files = this.notes();
    const seen = new Set();
    let problem = '';
    named.forEach((r) => {
      const k = r.key.toLowerCase();
      if (!problem && seen.has(k)) problem = `“${r.key}” is listed twice.`;
      seen.add(k);
      const why = propertyNameProblem(r.key);
      if (!problem && why) problem = why;
    });

    if (!this.targets.length) problem = problem || 'Choose the folders to add them to.';
    else if (!files.length) {
      problem =
        this.reach === 'folder-notes'
          ? 'None of these folders has a folder note.'
          : this.reach === 'direct'
            ? 'There are no notes directly in these folders.'
            : 'There are no notes in these folders.';
    }
    if (!named.length) problem = problem || 'Name a property to add.';

    if (problem) {
      lines.push({ text: problem, icon: 'info', cls: 'is-muted' });
      this.current = null;
      return this.showSummary(lines, null);
    }

    const props = named.map((r) => ({ key: r.key, value: parseTypedValue(r.type, r.raw), type: r.locked ? null : r.type }));
    const plan = this.bulk.planAdd(files, props, this.replace);
    const n = plan.changing.length;
    const names = nameList(props.map((p) => p.key));
    if (n) {
      lines.push({
        icon: 'plus',
        text: `Adds ${names} to ${n === files.length ? (n === 1 ? 'the note' : `all ${n} notes`) : `${n} of the ${files.length} notes`}.`,
        notes: plan.changing,
      });
    }
    Object.keys(plan.held).forEach((key) => {
      const k = plan.held[key];
      lines.push(
        this.replace
          ? {
              icon: 'alert-triangle',
              cls: 'is-warning',
              text: `Replaces the “${key}” ${k === 1 ? 'value' : 'values'} ${bulkCount(k, 'note')} already ${k === 1 ? 'has' : 'have'}.`,
            }
          : {
              icon: 'info',
              cls: 'is-muted',
              text: `${bulkCount(k, 'note')} already ${k === 1 ? 'has' : 'have'} a “${key}” of ${k === 1 ? 'its' : 'their'} own, and ${k === 1 ? 'keeps' : 'keep'} it.`,
            }
      );
    });
    const unchanged = files.length - n;
    if (unchanged) {
      lines.push({
        icon: 'check',
        cls: 'is-muted',
        text: n
          ? `${bulkCount(unchanged, 'note')} already ${unchanged === 1 ? 'has' : 'have'} ${props.length === 1 ? 'it' : 'them'} as given.`
          : `Every note already has ${props.length === 1 ? 'it' : 'them'} as given.`,
      });
    }
    const folderless =
      this.reach === 'folder-notes'
        ? this.targets.filter((t) => t instanceof TFolder && !this.plugin.folderNote(t))
        : [];
    if (folderless.length) {
      lines.push({
        icon: 'info',
        cls: 'is-muted',
        text: `${nameList(folderless.map((f) => f.name))} ${folderless.length === 1 ? 'has' : 'have'} no folder note, so ${folderless.length === 1 ? "it's" : "they're"} skipped.`,
      });
    }
    this.current = { files, props };
    this.showSummary(
      lines,
      n
        ? {
            label: `Add to ${bulkCount(n, 'note')}`,
            run: async () => {
              const record = await this.bulk.addProperties(files, props, this.replace);
              if (!record) return;
              const done = notesChanged(record);
              bulkNotice(
                this.bulk,
                (done ? `Added ${names} to ${bulkCount(done, 'note')}.` : 'Nothing needed changing.') +
                  bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}

/**
 * Properties a folder gives every note made in it — and in its
 * subfolders — from then on. Uses the same rows as Add properties.
 */
export class FolderDefaultsModal extends AddPropertiesModal {
  constructor(plugin, folder) {
    super(plugin, [folder]);
    this.folder = folder;
    this.alsoExisting = false;
    this.idleLabel = 'Save';
  }

  onOpen() {
    this.frame('Default properties');
    const intro = this.section();
    intro.createDiv({
      cls: 'dr-bulk-hint dr-bulk-intro',
      text: `New notes in “${this.folder.name || this.app.vault.getName()}” and its subfolders get these, where they don’t have them already.`,
    });
    const what = this.section('Properties');
    this.rowsEl = what.createDiv({ cls: 'dr-bulk-rows' });
    const add = what.createDiv({ cls: 'dr-bulk-add' });
    asButton(add);
    setIcon(add.createSpan({ cls: 'dr-bulk-add-icon' }), 'plus');
    add.createSpan({ text: 'Add another property' });
    onActivate(add, () => {
      this.rows.push(this.newRow());
      this.renderRows();
      const last = this.rowsEl.querySelector('.dr-bulk-row:last-child .dr-bulk-name input');
      if (last) last.focus();
    });
    const existing = this.section();
    const label = existing.createEl('label', { cls: 'dr-bulk-check' });
    const box = label.createEl('input', { type: 'checkbox' });
    this.existingCount = label.createSpan({ text: 'Also add them to the notes already here' });
    box.addEventListener('change', () => {
      this.alsoExisting = box.checked;
      this.update();
    });

    const saved = (this.plugin.settings.folderDefaults || {})[this.folder.path] || [];
    saved.forEach((p) => {
      const row = this.newRow();
      row.key = p.key;
      row.type = p.type || propertyType(this.app, p.key);
      row.raw = p.type === 'checkbox' ? p.value === true : Array.isArray(p.value) ? p.value.join(', ') : p.value === null || p.value === undefined ? '' : String(p.value);
      this.rows.push(row);
    });
    if (!this.rows.length) this.rows.push(this.newRow());
    this.renderRows();
    this.update();
  }

  update() {
    const named = this.rows.filter((r) => r.key);
    const lines = [];
    const seen = new Set();
    let problem = '';
    named.forEach((r) => {
      const k = r.key.toLowerCase();
      if (!problem && seen.has(k)) problem = `“${r.key}” is listed twice.`;
      seen.add(k);
      if (!problem) problem = propertyNameProblem(r.key);
    });
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }
    const props = named.map((r) => ({ key: r.key, value: parseTypedValue(r.type, r.raw), type: r.type }));
    const saved = (this.plugin.settings.folderDefaults || {})[this.folder.path] || [];
    const files = this.bulk.notesFor([this.folder], 'deep');
    const changing = this.alsoExisting && props.length ? this.bulk.planAdd(files, props, false).changing : [];
    if (this.existingCount) {
      this.existingCount.setText(`Also add them to the ${bulkCount(files.length, 'note')} already here`);
    }
    if (props.length) {
      lines.push({ icon: 'file-plus', text: `New notes here get ${nameList(props.map((p) => p.key))}.` });
    } else if (saved.length) {
      lines.push({ icon: 'x', cls: 'is-muted', text: 'Saving with none takes this folder’s defaults away.' });
    } else {
      lines.push({ icon: 'info', cls: 'is-muted', text: 'Name a property new notes here should have.' });
      return this.showSummary(lines, null);
    }
    if (changing.length) lines.push({ icon: 'plus', text: `And adds them now to ${bulkCount(changing.length, 'note')} already here.` });
    this.showSummary(lines, {
      label: changing.length ? `Save and add to ${bulkCount(changing.length, 'note')}` : 'Save',
      run: async () => {
        const all = Object.assign({}, this.plugin.settings.folderDefaults);
        if (props.length) all[this.folder.path] = props.map((p) => ({ key: p.key, value: p.value, type: p.type }));
        else delete all[this.folder.path];
        this.plugin.settings.folderDefaults = all;
        // The folder's schema keeps the same defaults.
        this.plugin.settings.propertySchemas = schemaWithDefaults(this.plugin.settings.propertySchemas, this.folder.path, all[this.folder.path] || []);
        await this.plugin.saveData(this.plugin.settings);
        if (changing.length) {
          const record = await this.bulk.addProperties(files, props, false);
          if (record) bulkNotice(this.bulk, `Saved, and added them to ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
        } else {
          new Notice(props.length ? 'Default properties saved.' : 'Default properties removed.');
        }
      },
    });
  }
}

/* How long a new note is left for a template to fill before defaults go in. */
export const DEFAULTS_DELAY = 800;

/** Take properties out of every note in some folders. */
export class RemovePropertiesModal extends BulkModal {
  constructor(plugin, targets, keys) {
    super(plugin);
    (targets || []).forEach((t) => this.addTarget(t));
    this.chosen = new Set((keys || []).map((k) => k.toLowerCase()));
    this.idleLabel = 'Remove';
  }

  onOpen() {
    this.frame('Remove properties');
    this.targetsSection('Remove from');
    const what = this.section('Properties');
    this.listEl = what.createDiv({ cls: 'dr-bulk-checks' });
    this.update();
  }

  /** Redraw the choices when the notes they come from change. */
  renderTargets() {
    super.renderTargets();
    this.checksFor = null;
  }

  renderChecks(present) {
    const sig = present.map((p) => `${p.name}:${p.count}`).join('|');
    if (this.checksFor === sig) return;
    this.checksFor = sig;
    this.listEl.empty();
    if (!present.length) {
      this.listEl.createDiv({ cls: 'dr-bulk-hint', text: 'These notes have no properties.' });
      return;
    }
    present.forEach((p) => {
      const label = this.listEl.createEl('label', { cls: 'dr-bulk-check-row' });
      const box = label.createEl('input', { type: 'checkbox' });
      box.checked = this.chosen.has(p.name.toLowerCase());
      setIcon(label.createSpan({ cls: 'dr-bulk-check-icon' }), TYPE_ICONS[propertyType(this.app, p.name)] || 'text');
      label.createSpan({ cls: 'dr-bulk-check-name', text: p.name });
      label.createSpan({ cls: 'dr-bulk-check-count', text: String(p.count) });
      box.addEventListener('change', () => {
        if (box.checked) this.chosen.add(p.name.toLowerCase());
        else this.chosen.delete(p.name.toLowerCase());
        this.update();
      });
    });
  }

  update() {
    const files = this.notes();
    const present = propertiesIn(this.app, files);
    if (this.listEl) this.renderChecks(present);
    const keys = present.filter((p) => this.chosen.has(p.name.toLowerCase())).map((p) => p.name);
    const lines = [];
    if (!this.targets.length) lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the folders to remove them from.' });
    else if (!keys.length) lines.push({ icon: 'info', cls: 'is-muted', text: 'Tick the properties to remove.' });
    if (lines.length) return this.showSummary(lines, null);
    const changing = this.bulk.planRemove(files, keys);
    lines.push({
      icon: 'trash-2',
      cls: 'is-warning',
      text: `Removes ${nameList(keys)} from ${bulkCount(changing.length, 'note')}, values and all.`,
      notes: changing,
    });
    this.showSummary(lines, changing.length
      ? {
          label: `Remove from ${bulkCount(changing.length, 'note')}`,
          run: async () => {
            const record = await this.bulk.removeProperties(files, keys);
            if (!record) return;
            bulkNotice(this.bulk, `Removed ${nameList(keys)} from ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
          },
        }
      : null);
  }
}
