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

import { Menu, Modal, Notice, setIcon } from 'obsidian';
import { TYPE_LABELS } from '../core/020-constants.js';
import { pageFolder } from '../core/034-tabs.js';
import { showMenuAt } from '../core/036-menus.js';
import { asButton, onActivate } from '../core/042-controls.js';
import { knownPropertyNames } from '../core/045-helpers-properties.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { noteProps } from '../core/073-notes.js';
import { Feature } from '../core/080-feature.js';
import { PanelSection } from '../core/082-panel-section.js';
import { asType, checkNote, emptyValue, fixFor, SCHEMA_TYPES, schemaFor, tidyEntry } from '../core/086-property-schema.js';
import { nearDuplicates } from '../core/088-property-options.js';
import { NamePrompt } from '../ui/230-pickers.js';
import { parseTypedValue, propertyType } from './288-bulk-values.js';
import { bulkNotice, bulkTail, notesChanged } from './290-bulk-engine.js';
import { BulkModal } from './300-bulk-dialogs.js';

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
      if (!issue.fix) {
        const set = row.createSpan({ cls: 'dr-schema-fix dr-schema-set', text: 'Set…' });
        asButton(set, `Set “${issue.key}”`);
        onActivate(set, (evt) => this.askValue(issue, evt));
        return;
      }
      const fix = row.createSpan({ cls: 'dr-schema-fix', text: 'Fix' });
      asButton(fix, `Set it to ${JSON.stringify(issue.fix.value)}`);
      onActivate(fix, () => this.fix([issue]));
    });
  }

  /** A value for an issue with no plain fix: one of the values allowed from a menu, otherwise typed; written in the schema's type. */
  askValue(issue, evt) {
    const file = this.file;
    if (!file) return;
    const want = issue.key.toLowerCase();
    const entry = schemaFor(this.settings.propertySchemas, file).find((e) => e.key.toLowerCase() === want) || { key: issue.key };
    const allowed = (x) => !entry.values || !entry.values.length || entry.values.includes(String(x));
    // Written to the note asked about, even if the panel has closed since (a prompt's click is outside it).
    const put = (raw) => {
      const typed = typeof raw === 'string' && (entry.type === 'date' || entry.type === 'datetime') ? parseTypedValue(entry.type, raw) : raw;
      const value = asType(entry.type, typed);
      if (value === undefined) {
        new Notice(`“${raw}” isn’t of the type “${issue.key}” takes here.`);
        return null;
      }
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) {
        new Notice('Nothing was set: the note is gone.');
        return null;
      }
      if (this.file === file) this.blurSection();
      return this.plugin.notes.write(
        file,
        (fm) => {
          const name = Object.keys(fm).find((k) => k.toLowerCase() === want) || issue.key;
          if (!Array.isArray(value)) {
            fm[name] = value;
            return;
          }
          // A list keeps the values allowed; those that aren't give way to the one chosen.
          const have = fm[name];
          const items = emptyValue(have) ? [] : Array.isArray(have) ? have : asType(entry.type, have) || [have];
          const out = [];
          const add = (y) => {
            if (!out.includes(y)) out.push(y);
          };
          items.forEach((x) => (allowed(x) ? add(x) : value.forEach(add)));
          value.forEach(add);
          fm[name] = out;
        },
        { undo: `Set “${issue.key}”.` }
      );
    };
    const choices = entry.values && entry.values.length ? entry.values.map((v) => [v, v]) : entry.type === 'checkbox' ? [['Yes', true], ['No', false]] : null;
    if (choices) {
      const menu = new Menu();
      choices.forEach(([title, v]) => menu.addItem((item) => item.setTitle(title).setSection('action').onClick(() => put(v))));
      showMenuAt(menu, evt);
      return;
    }
    new NamePrompt(this.app, `Set “${issue.key}”`, entry.type ? TYPE_LABELS[entry.type] || entry.type : 'Value', put, { button: 'Set', numeric: entry.type === 'number' }).open();
  }

  /** Focus off the section, so the panel draws it again once Obsidian has read the change. */
  blurSection() {
    const doc = this.containerEl && this.containerEl.ownerDocument;
    if (doc && doc.activeElement && this.containerEl.contains(doc.activeElement) && typeof doc.activeElement.blur === 'function') doc.activeElement.blur();
  }

  /** Fixes written as one change to the note: one step of Undo. */
  async fix(issues) {
    const file = this.file;
    const changes = issues.map(fixFor).filter(Boolean);
    if (!file || !changes.length) return null;
    this.blurSection();
    return this.plugin.notes.write(file, (fm) => changes.forEach((change) => change(fm)), { undo: issues.length === 1 ? `Fixed “${issues[0].key}”.` : `Fixed ${issues.length} properties.` });
  }
}

/* What each kind of issue says of the notes it's found in. */
const KIND_TEXT = { missing: 'missing', empty: 'empty', type: 'of another type', value: 'not among the values allowed' };

/** The notes in some folders checked against their schemas: what each falls short of, and Fix for every plain fix, one step of Undo. */
export class SchemaCheckModal extends BulkModal {
  constructor(plugin, targets) {
    super(plugin);
    (targets || []).forEach((t) => this.addTarget(t));
    if (!this.targets.length) this.addTarget(plugin.app.vault.getRoot());
    this.idleLabel = 'Fix';
  }

  onOpen() {
    this.frame('Check against schemas');
    this.targetsSection('Look in');
    this.update();
  }

  /** Each note that falls short, with how: [{ file, issues }]. */
  findings() {
    const schemas = this.plugin.settings.propertySchemas || {};
    return this.notes()
      .map((file) => ({ file, issues: checkNote(schemaFor(schemas, file), noteProps(this.app, file)) }))
      .filter((f) => f.issues.length);
  }

  update() {
    if (!Object.keys(this.plugin.settings.propertySchemas || {}).length) {
      return this.showSummary([{ icon: 'info', cls: 'is-muted', text: 'No folder has a schema yet: set one with Property schema for this folder….' }], null);
    }
    const found = this.findings();
    if (!found.length) return this.showSummary([{ icon: 'check', text: 'Every note here is as its folder asks.' }], null);
    // A line for each property and how it falls short, with its notes.
    const lines = new Map();
    found.forEach(({ file, issues }) =>
      issues.forEach((i) => {
        const id = `${i.key.toLowerCase()}|${i.kind}`;
        if (!lines.has(id)) lines.set(id, { key: i.key, kind: i.kind, files: [], fixable: 0 });
        const line = lines.get(id);
        line.files.push(file);
        if (i.fix) line.fixable++;
      })
    );
    const out = Array.from(lines.values()).map((l) => ({
      icon: l.fixable ? 'wrench' : 'alert-circle',
      cls: l.fixable ? '' : 'is-muted',
      text: `“${l.key}” ${KIND_TEXT[l.kind]} in ${bulkCount(l.files.length, 'note')}${l.fixable === l.files.length ? '' : l.fixable ? `; ${l.fixable} can be put right` : '; to be put right by hand'}.`,
      notes: l.files,
    }));
    const fixable = found.filter((f) => f.issues.some((i) => i.fix)).map((f) => f.file);
    this.showSummary(
      out,
      fixable.length
        ? {
            label: `Fix ${bulkCount(fixable.length, 'note')}`,
            run: async () => {
              const record = await this.bulk.fixSchemas(fixable);
              if (record) bulkNotice(this.bulk, `Put right ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
            },
          }
        : null
    );
  }
}

/** A property's values that are one value written differently, found, and each group made the value it keeps: one step of Undo. */
export class CleanUpValuesModal extends BulkModal {
  constructor(plugin, key) {
    super(plugin);
    this.key = key || '';
    this.idleLabel = 'Merge';
    this.skipped = new Set();
    this.keeps = new Map();
  }

  onOpen() {
    this.frame('Clean up values');
    const section = this.section();
    const key = this.field(section, 'Property', 'The property whose values to look through');
    this.keyInput = key.input;
    this.keyInput.value = this.key;
    this.suggest(key.box, key.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.keyInput.value = v;
        this.update();
      },
    });
    this.keyInput.addEventListener('input', () => this.queueUpdate());
    this.listEl = this.section('One value, written differently').createDiv({ cls: 'dr-cleanup-groups' });
    this.update();
  }

  update() {
    const key = this.keyInput.value.trim();
    this.listEl.empty();
    if (!key) return this.showSummary([{ icon: 'info', cls: 'is-muted', text: 'Name a property to look through its values.' }], null);
    const groups = nearDuplicates(this.bulk.valueCounts(key));
    if (!groups.length) return this.showSummary([{ icon: 'check', text: `No two of “${key}”’s values look like one value written differently.` }], null);
    const chosen = [];
    let notes = 0;
    groups.forEach((g) => {
      const id = g.values.map((v) => v.value).join('\u0000');
      const keep = this.keeps.get(id) || g.keep;
      const row = this.listEl.createDiv({ cls: 'dr-cleanup-group' });
      const box = row.createEl('input', { type: 'checkbox' });
      box.checked = !this.skipped.has(id);
      box.setAttribute('aria-label', `Merge into “${keep}”`);
      box.addEventListener('change', () => {
        if (box.checked) this.skipped.delete(id);
        else this.skipped.add(id);
        this.update();
      });
      const pick = row.createEl('select', { cls: 'dropdown' });
      pick.setAttribute('aria-label', 'The value to keep');
      g.values.forEach((v) => (pick.createEl('option', { text: `${v.value} (${v.count})` }).value = v.value));
      pick.value = keep;
      pick.addEventListener('change', () => {
        this.keeps.set(id, pick.value);
        this.update();
      });
      row.createSpan({ cls: 'dr-cleanup-others', text: `in place of ${g.values.filter((v) => v.value !== keep).map((v) => `“${v.value}”`).join(', ')}` });
      if (!box.checked) return;
      chosen.push({ keep, values: g.values.map((v) => v.value) });
      notes += g.values.filter((v) => v.value !== keep).reduce((n, v) => n + v.count, 0);
    });
    this.showSummary(
      chosen.length ? [{ icon: 'git-merge', text: `${chosen.length === 1 ? 'One value' : `${chosen.length} values`} made one, in ${bulkCount(notes, 'note')}.` }] : [],
      chosen.length
        ? {
            label: `Merge ${chosen.length === 1 ? '1 group' : `${chosen.length} groups`}`,
            run: async () => {
              const record = await this.bulk.cleanUpValues(key, chosen);
              if (record) bulkNotice(this.bulk, `Cleaned up “${key}” in ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
            },
          }
        : null
    );
  }
}

export class PropertySchemas extends Feature {
  settingsSchema() {
    return [
      {
        key: 'propertySchemaMarks',
        name: 'Property schemas',
        desc: 'Folders set what their notes’ properties should be; the panel flags gaps.',
      },
      {
        key: 'propertyInspector',
        name: 'A property’s facts on its page',
        desc: 'A property’s type, use and common values on its page, with fixes.',
      },
      {
        key: 'propertyInlineEdit',
        name: 'Change values in a collection’s rows',
        desc: 'Edit a property’s value right in a collection’s row.',
      },
      {
        key: 'propertyValueChips',
        name: 'Colours and icons for values',
        desc: 'Give property values a colour and an icon.',
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
      {
        id: 'check-property-schemas',
        name: 'Check notes against their schemas…',
        icon: 'list-checks',
        when: () => Object.keys(this.settings.propertySchemas || {}).length > 0,
        run: () => new SchemaCheckModal(this.plugin, [pageFolder(this.app) || this.app.vault.getRoot()]).open(),
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
