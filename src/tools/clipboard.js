/* ------------------------------------------------------------------ */
/* The property clipboard, and property sets                           */
/*                                                                     */
/* A folder's properties as a table (tab-separated, a row a note) that */
/* can be edited in a spreadsheet and pasted back; a note's properties */
/* sorted by name; and sets of properties kept under a name, to stamp  */
/* on a note. Every write is one Undo.                                 */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { retiredActions } from '../core/actions.js';
import { Feature } from '../core/feature.js';
import { noteProps, valuesOf } from '../core/notes.js';
import { counted } from '../core/text.js';
import { choose } from '../ui/choose.js';
import { ask } from '../ui/sheet.js';
import { Bulk } from './bulk.js';

/** Notes' properties as a table: a head row of Note and every property, then a row a note. Lists are joined with "; ". */
export function propsTable(app, files) {
  const keys = [];
  files.forEach((f) => Object.keys(noteProps(app, f)).forEach((k) => keys.includes(k) || keys.push(k)));
  const cell = (v) => valuesOf(v).join('; ').replace(/[\t\n]/g, ' ');
  return [['Note'].concat(keys).join('\t')].concat(files.map((f) => [f.basename].concat(keys.map((k) => cell(noteProps(app, f)[k]))).join('\t'))).join('\n');
}

/** A pasted table read back: { keys, rows: Map(note name → { key: text }) }, or null when it is not one. */
export function readTable(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2 || !lines[0].includes('\t')) return null;
  const head = lines[0].split('\t').map((s) => s.trim());
  const rows = new Map();
  lines.slice(1).forEach((line) => {
    const cells = line.split('\t');
    const row = {};
    head.slice(1).forEach((k, i) => (row[k] = (cells[i + 1] || '').trim()));
    rows.set((cells[0] || '').trim(), row);
  });
  return { keys: head.slice(1), rows };
}

export class PropertyClipboard extends Feature {
  constructor(plugin) {
    super(plugin);
    this.bulk = new Bulk(plugin);
  }

  async copy(text, said) {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(said);
      return true;
    } catch (err) {
      new Notice('Could not reach the clipboard.');
      return false;
    }
  }

  async read() {
    try {
      return await navigator.clipboard.readText();
    } catch (err) {
      new Notice('Could not reach the clipboard.');
      return '';
    }
  }

  sort(file) {
    return this.plugin.notes.write(file, (fm) => {
      const entries = Object.keys(fm).sort((a, b) => a.localeCompare(b)).map((k) => [k, fm[k]]);
      Object.keys(fm).forEach((k) => delete fm[k]);
      entries.forEach(([k, v]) => (fm[k] = v));
    }, { undo: 'Properties sorted.' });
  }

  copyTable(folder) {
    const files = this.plugin.index.notes(folder);
    if (!files.length) return void new Notice('This folder has no notes.');
    return this.copy(propsTable(this.app, files), `The properties of ${counted(files.length, 'note')} copied as a table.`);
  }

  /** Updates a folder's notes from a table: a cell that differs is written, an empty one removes the property. */
  async pasteTable(folder, text) {
    const table = readTable(text === undefined ? await this.read() : text);
    if (!table) return void new Notice('The clipboard holds no table: copy one first, edit it, and paste it back.'), 0;
    const files = this.plugin.index.notes(folder).filter((f) => table.rows.has(f.basename));
    return this.bulk.run(files, `Notes updated from a table`, (fm, file) => {
      const row = table.rows.get(file.basename);
      table.keys.forEach((k) => {
        const was = valuesOf(fm[k]).join('; ');
        if (row[k] === was) return;
        if (row[k] === '') delete fm[k];
        else fm[k] = Array.isArray(fm[k]) || row[k].includes('; ') ? row[k].split(';').map((s) => s.trim()).filter(Boolean) : typeof fm[k] === 'number' && Number.isFinite(Number(row[k])) ? Number(row[k]) : row[k];
      });
    });
  }

  sets() {
    return this.settings.propertySets && typeof this.settings.propertySets === 'object' ? this.settings.propertySets : {};
  }

  async saveSet(file, name) {
    const props = noteProps(this.app, file);
    if (!Object.keys(props).length) return void new Notice('This note has no properties to keep.');
    const as = name || (await ask(this.app, { title: 'Keep these properties as a set', placeholder: 'Lecture note', action: 'Keep' }));
    if (!as) return false;
    this.settings.propertySets = Object.assign({}, this.sets(), { [as]: JSON.parse(JSON.stringify(props)) });
    await this.plugin.saveSettings();
    return true;
  }

  /** Stamps a set on a note: what the note already has, it keeps. */
  async applySet(file, name) {
    const as = name || (await choose(this.app, Object.keys(this.sets()), { placeholder: 'Apply which set?' }));
    const set = as ? this.sets()[as] : null;
    if (!set) return null;
    return this.plugin.notes.write(file, (fm) => Object.keys(set).forEach((k) => { if (!(k in fm)) fm[k] = JSON.parse(JSON.stringify(set[k])); }), { undo: `${as} applied to ${file.basename}.` });
  }

  async removeSet(name) {
    const as = name || (await choose(this.app, Object.keys(this.sets()), { placeholder: 'Remove which set?' }));
    if (!as || !(as in this.sets())) return false;
    const next = Object.assign({}, this.sets());
    delete next[as];
    this.settings.propertySets = next;
    await this.plugin.saveSettings();
    return true;
  }

  actions() {
    const some = () => Object.keys(this.sets()).length > 0;
    return [
      ...retiredActions(['copy-properties', 'copy-some-properties', 'paste-properties'], 'Add a property takes another note\'s'),
      { id: 'sort-properties', name: 'Sort properties alphabetically', on: 'note', menu: false, run: (ctx) => this.sort(ctx.file) },
      { id: 'copy-properties-table', name: 'Copy the properties of this folder’s notes as a table', on: 'folder', menu: 'Copy properties as a table', run: (ctx) => this.copyTable(ctx.folder) },
      { id: 'paste-properties-table', name: 'Update notes from a table on the clipboard…', on: 'folder', menu: 'Update notes from a table', run: (ctx) => this.pasteTable(ctx.folder) },
      { id: 'property-set-save', name: 'Keep this note’s properties as a set…', on: 'note', menu: false, run: (ctx) => this.saveSet(ctx.file) },
      { id: 'property-set-apply', name: 'Apply a property set…', on: 'note', menu: 'Apply a property set…', when: some, run: (ctx) => this.applySet(ctx.file) },
      { id: 'property-set-remove', name: 'Remove a property set…', when: some, run: () => this.removeSet() },
    ];
  }
}
PropertyClipboard.title = 'Property clipboard and sets';
PropertyClipboard.section = 'Tools';
PropertyClipboard.about = 'A folder’s properties as a table to copy and paste back, and sets to stamp on a note.';
