/* ------------------------------------------------------------------ */
/* Property schemas: the feature                                       */
/*                                                                    */
/* A folder's schema set in a dialog — each property's type, whether  */
/* it's required, the values allowed, a default — kept by the folder's */
/* path, its defaults kept in step with the folder defaults that give  */
/* them to new notes. In the note panel, where the note falls short —  */
/* one required and missing, a value of the wrong type or not among    */
/* those allowed — a mark for each, its reason, and Fix where the fix  */
/* is plain: written through the notes service, a step of Undo.        */
/* Nothing shows when the note fits.                                   */
/* ------------------------------------------------------------------ */

import { Modal, Notice, setIcon } from 'obsidian';
import { TYPE_LABELS } from '../core/020-constants.js';
import { pageFolder } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { noteProps } from '../core/073-notes.js';
import { Feature } from '../core/080-feature.js';
import { PanelSection } from '../core/082-panel-section.js';
import { checkNote, fixFor, SCHEMA_TYPES, schemaFor, tidyEntry } from '../core/086-property-schema.js';
import { parseTypedValue, propertyType } from './290-bulk-engine.js';

/** A folder's key in the schemas: its path, or '/' for the vault. */
export function schemaPath(folder) {
  return !folder || !folder.path || folder.path === '/' ? '/' : folder.path;
}

/** A default as it's typed in the dialog. */
function typedDefault(v) {
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

export class SchemaModal extends Modal {
  constructor(plugin, folder) {
    super(plugin.app);
    this.plugin = plugin;
    this.folder = folder;
    this.path = schemaPath(folder);
    this.rows = ((plugin.settings.propertySchemas || {})[this.path] || []).map((e) => ({
      key: e.key,
      type: e.type || '',
      required: !!e.required,
      values: (e.values || []).join(', '),
      raw: typedDefault(e.default),
    }));
    if (!this.rows.length) this.rows.push(this.blank());
  }

  blank() {
    return { key: '', type: '', required: false, values: '', raw: '' };
  }

  onOpen() {
    this.modalEl.addClass('dr-schema-modal');
    this.titleEl.setText(`What notes in ${this.path === '/' ? 'the vault' : `“${this.folder.name}”`} should have`);
    this.contentEl.createDiv({ cls: 'dr-schema-intro', text: 'Each property’s type, whether it’s required, the values allowed and a default for new notes. A folder below takes these too, unless it names the same property. The note panel marks a note that falls short, with a fix where it’s plain.' });
    this.listEl = this.contentEl.createDiv({ cls: 'dr-schema-rows' });
    this.renderRows();
    const add = this.contentEl.createDiv({ cls: 'dr-schema-add' });
    setIcon(add.createSpan(), 'plus');
    add.createSpan({ text: 'Add a property' });
    asButton(add, 'Add a property');
    onActivate(add, () => {
      this.rows.push(this.blank());
      this.renderRows();
      const inputs = this.listEl.querySelectorAll('.dr-schema-row-key');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { cls: 'mod-cta', text: 'Save' }).addEventListener('click', () => this.save());
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  renderRows() {
    this.listEl.empty();
    this.rows.forEach((row, i) => {
      const el = this.listEl.createDiv({ cls: 'dr-schema-row' });
      const key = el.createEl('input', { type: 'text', cls: 'dr-schema-row-key', attr: { placeholder: 'Property', 'aria-label': 'Property' } });
      key.value = row.key;
      key.addEventListener('input', () => {
        row.key = key.value;
        if (!row.type && key.value.trim()) row.typeGuess = propertyType(this.app, key.value.trim());
      });
      const type = el.createEl('select', { cls: 'dropdown dr-schema-row-type', attr: { 'aria-label': 'Type' } });
      [''].concat(SCHEMA_TYPES).forEach((t) => (type.createEl('option', { text: t ? TYPE_LABELS[t] : 'Any type' }).value = t));
      type.value = row.type;
      type.addEventListener('change', () => (row.type = type.value));
      const req = el.createEl('label', { cls: 'dr-schema-row-required' });
      const box = req.createEl('input', { type: 'checkbox' });
      box.checked = row.required;
      box.addEventListener('change', () => (row.required = box.checked));
      req.createSpan({ text: 'Required' });
      const values = el.createEl('input', { type: 'text', cls: 'dr-schema-row-values', attr: { placeholder: 'Values allowed, by commas', 'aria-label': 'Values allowed' } });
      values.value = row.values;
      values.addEventListener('input', () => (row.values = values.value));
      const def = el.createEl('input', { type: 'text', cls: 'dr-schema-row-default', attr: { placeholder: 'Default', 'aria-label': 'Default' } });
      def.value = row.raw;
      def.addEventListener('input', () => (row.raw = def.value));
      const remove = el.createSpan({ cls: 'clickable-icon dr-schema-row-remove' });
      setIcon(remove, 'x');
      asButton(remove, 'Take this property off');
      onActivate(remove, () => {
        this.rows.splice(i, 1);
        if (!this.rows.length) this.rows.push(this.blank());
        this.renderRows();
      });
    });
  }

  /** The rows as schema entries: each named once, the first winning. */
  entries() {
    const seen = new Set();
    return this.rows
      .map((row) => {
        const key = row.key.trim();
        if (!key || seen.has(key.toLowerCase())) return null;
        seen.add(key.toLowerCase());
        const type = row.type || '';
        const values = row.values.split(',').map((s) => s.trim()).filter(Boolean);
        const value = row.raw.trim() ? parseTypedValue(type || row.typeGuess || 'text', row.raw) : undefined;
        return tidyEntry({ key, type, required: row.required, values, default: value });
      })
      .filter(Boolean);
  }

  async save() {
    const entries = this.entries();
    const settings = this.plugin.settings;
    const schemas = Object.assign({}, settings.propertySchemas);
    if (entries.length) schemas[this.path] = entries;
    else delete schemas[this.path];
    settings.propertySchemas = schemas;
    // The defaults new notes here are given, in step with the schema's.
    const defaults = Object.assign({}, settings.folderDefaults);
    const given = entries.filter((e) => e.default !== undefined).map((e) => ({ key: e.key, value: e.default, type: e.type || propertyType(this.app, e.key) }));
    if (given.length) defaults[this.path] = given;
    else delete defaults[this.path];
    settings.folderDefaults = defaults;
    await this.plugin.saveData(settings);
    this.close();
    new Notice(entries.length ? 'Schema saved.' : 'Schema taken off.');
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class SchemaSection extends PanelSection {
  get cls() {
    return 'dr-schema-section';
  }

  /** What's wrong with the note, held to its folders' schemas. */
  issues() {
    if (!this.file) return [];
    const schema = schemaFor(this.settings.propertySchemas, this.file);
    return schema.length ? checkNote(schema, noteProps(this.app, this.file)) : [];
  }

  render() {
    const issues = this.issues();
    this.containerEl.toggleClass('is-empty', !issues.length);
    if (!issues.length) return;
    const head = this.containerEl.createDiv({ cls: 'dr-section-head' });
    setIcon(head.createSpan({ cls: 'dr-schema-mark' }), 'alert-circle');
    head.createSpan({ cls: 'dr-section-title', text: 'Not as this folder asks' });
    head.createSpan({ cls: 'dr-section-count', text: String(issues.length) });
    const fixable = issues.filter((i) => i.fix);
    if (fixable.length > 1) {
      const all = head.createSpan({ cls: 'dr-schema-fix-all', text: 'Fix all' });
      asButton(all, `Fix ${fixable.length}`);
      onActivate(all, () => this.fix(fixable));
    }
    const list = this.containerEl.createDiv({ cls: 'dr-schema-list' });
    issues.forEach((issue) => {
      const row = list.createDiv({ cls: `dr-schema-issue is-${issue.kind}` });
      row.setAttribute('title', issue.reason);
      row.createSpan({ cls: 'dr-schema-key', text: issue.key });
      row.createSpan({ cls: 'dr-schema-reason', text: issue.reason });
      if (!issue.fix) return;
      const fix = row.createSpan({ cls: 'dr-schema-fix', text: 'Fix' });
      asButton(fix, `Set it to ${JSON.stringify(issue.fix.value)}`);
      onActivate(fix, () => this.fix([issue]));
    });
  }

  /** Fixes written as one change to the note: one step of Undo. */
  async fix(issues) {
    const file = this.file;
    const changes = issues.map(fixFor).filter(Boolean);
    if (!file || !changes.length) return null;
    // Focus off the section, so the panel draws it again once Obsidian has read the change.
    const doc = this.containerEl.ownerDocument;
    if (doc.activeElement && this.containerEl.contains(doc.activeElement) && typeof doc.activeElement.blur === 'function') doc.activeElement.blur();
    return this.plugin.notes.write(file, (fm) => changes.forEach((change) => change(fm)), { undo: issues.length === 1 ? `Fixed “${issues[0].key}”.` : `Fixed ${issues.length} properties.` });
  }
}

export class PropertySchemas extends Feature {
  settingsSchema() {
    return [
      {
        key: 'propertySchemaMarks',
        name: 'Property schemas',
        desc: 'A folder can say what its notes’ properties should be — required, of a type, from some values — and the note panel marks a note that falls short, with a fix where it’s plain. Set one from a folder’s Property schema….',
      },
      {
        key: 'propertyValueChips',
        name: 'Colours and icons for values',
        desc: 'A property’s value can take a colour and an icon — from its menu on the property’s page, Colour and icon… — shown wherever it shows: the note panel, the note page, album rows and filters.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'folder-property-schema',
        name: 'Property schema for this folder…',
        icon: 'clipboard-check',
        run: () => this.openSchema(pageFolder(this.app)),
      },
    ];
  }

  openSchema(folder) {
    new SchemaModal(this.plugin, folder || this.app.vault.getRoot()).open();
  }

  panelSections(panel) {
    return [new SchemaSection(panel)];
  }
}

PropertySchemas.settingKey = 'propertySchemaMarks';
