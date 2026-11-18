/* ------------------------------------------------------------------ */
/* Folder schemas: what a folder's notes should have                   */
/*                                                                     */
/* A folder's schema says, a property at a time, its type, whether it  */
/* is required, and the values allowed. Kept by the folder's path, as  */
/* the old plugin kept it: [{ key, type, required, values, default }]. */
/* Where a note falls short the panel marks the row and says why; a    */
/* command lists every note that does.                                 */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';
import { noteProps, propOf, valuesOf } from '../core/notes.js';
import { field } from '../ui/field.js';
import { row, rows, sectionTitle } from '../ui/row.js';
import { Sheet } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';
import { retype } from './bulk.js';

/** A schema written as lines — "status: text, required, draft | done" — read into entries. */
export function parseSchema(text) {
  return String(text || '').split(/\n|;/).map((line) => {
    const at = line.indexOf(':');
    const key = (at < 0 ? line : line.slice(0, at)).trim();
    if (!key) return null;
    const entry = { key };
    (at < 0 ? '' : line.slice(at + 1)).split(',').map((s) => s.trim()).filter(Boolean).forEach((part) => {
      if (part.toLowerCase() === 'required') entry.required = true;
      else if (['text', 'number', 'checkbox', 'date', 'list', 'multitext'].includes(part.toLowerCase())) entry.type = part.toLowerCase() === 'list' ? 'multitext' : part.toLowerCase();
      else if (part.includes('|')) entry.values = part.split('|').map((v) => v.trim()).filter(Boolean);
    });
    return entry;
  }).filter(Boolean);
}

/** Entries written back as the lines they are edited as. */
export function schemaText(entries) {
  return (entries || []).map((e) => `${e.key}: ${[e.type === 'multitext' ? 'list' : e.type, e.required ? 'required' : '', (e.values || []).join(' | ')].filter(Boolean).join(', ')}`.replace(/: $/, '')).join('; ');
}

/** Why a value does not fit an entry, in words; null when it does. */
export function valueFault(entry, value) {
  const none = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
  if (none) return entry.required ? 'required here, and missing' : null;
  if (entry.type === 'date' && !/^\d{4}-\d{2}-\d{2}/.test(String(value))) return 'not a date';
  if (entry.type && entry.type !== 'date' && entry.type !== 'text' && entry.type !== 'multitext' && retype(value, entry.type) === undefined) return `not a ${entry.type}`;
  if (entry.values && entry.values.length) {
    const bad = valuesOf(value).filter((v) => !entry.values.some((a) => a.toLowerCase() === v.toLowerCase()));
    if (bad.length) return `“${bad[0]}” is not one of ${entry.values.join(', ')}`;
  }
  return null;
}

export class PropertySchemas extends Feature {
  enable() {
    this.plugin.checkValue = (file, key, value) => {
      const entry = this.schemaOf(file).find((e) => e.key.toLowerCase() === key.toLowerCase());
      return entry ? valueFault(entry, value) : null;
    };
    this.add(() => delete this.plugin.checkValue);
  }

  /** The schema that holds for a note: its folder's, or the nearest folder above that has one. */
  schemaOf(file) {
    const all = this.settings.propertySchemas || {};
    for (let dir = file.parent; dir; dir = dir.parent) {
      const kept = all[dir.path];
      if (Array.isArray(kept) && kept.length) return kept.filter((e) => e && e.key);
      if (dir.path === '/') break;
    }
    return [];
  }

  /** Where a note falls short of its schema: [{ key, fault }]. */
  faults(file) {
    const props = noteProps(this.app, file);
    return this.schemaOf(file).map((e) => ({ key: e.key, fault: valueFault(e, propOf(props, e.key)) })).filter((f) => f.fault);
  }

  edit(folder) {
    let box = null;
    const now = (this.settings.propertySchemas || {})[folder.path];
    new Sheet(this.app, {
      title: `Schema for ${folder.name}`,
      text: 'A property a part, with semicolons between: its name, then its type, “required”, and the values allowed with | between them.',
      build: (matter) => { box = field(matter, { label: 'Schema', value: schemaText(now), placeholder: 'status: text, required, draft | done; week: number' }); },
      actions: [{ text: 'Cancel' }, { text: 'Keep', kind: 'primary', run: async () => {
        const entries = parseSchema(box.drInput.value);
        const all = this.settings.propertySchemas || (this.settings.propertySchemas = {});
        if (entries.length) all[folder.path] = entries;
        else delete all[folder.path];
        await this.plugin.saveSettings();
      } }],
    }).open();
  }

  /** Every note that falls short of its folder's schema, in a sheet. */
  check() {
    const found = this.plugin.index.markdown().map((file) => ({ file, faults: this.faults(file) })).filter((x) => x.faults.length);
    const sheet = new Sheet(this.app, {
      title: 'Notes against their schemas',
      build: (matter, s) => {
        if (!found.length) return void sayso(matter, { label: 'Every note fits', text: Object.keys(this.settings.propertySchemas || {}).length ? '' : 'No folder has a schema yet.' });
        const list = rows(matter);
        found.slice(0, 100).forEach((x) => row(list, { name: x.file.basename, error: true, end: `${x.faults[0].key}: ${x.faults[0].fault}`.slice(0, 40), run: () => { s.close(); this.app.workspace.getLeaf(false).openFile(x.file); } }));
      },
      actions: [{ text: 'Close' }],
    });
    sheet.open();
    return found;
  }

  actions() {
    return [
      { id: 'folder-property-schema', name: 'Property schema for this folder…', on: 'folder', menu: 'Schema…', run: (ctx) => this.edit(ctx.folder) },
      { id: 'check-property-schemas', name: 'Check notes against their schemas…', run: () => this.check() },
    ];
  }
}
PropertySchemas.title = 'Folder schemas';
PropertySchemas.section = 'Tools';
PropertySchemas.about = 'What a folder’s notes should have, and a mark where one falls short.';
