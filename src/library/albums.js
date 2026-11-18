/* ------------------------------------------------------------------ */
/* What a folder is: its kind, its description, what it gathers        */
/*                                                                     */
/* A folder can say what it is (a subject, a project, a reference, an  */
/* index), what it is for, which notes from elsewhere belong to it     */
/* too (shown in it, not moved), which folders sit beside it, and      */
/* which notes to start with. The plugin keeps this by the folder's    */
/* path (settings.albums); a folder note from before is read, by the   */
/* same property names as ever, until the first change carries what    */
/* it says over. Nothing is written into a note.                       */
/* ------------------------------------------------------------------ */

import { TFile, TFolder } from 'obsidian';
import { Feature } from '../core/feature.js';
import { linkTarget, noteProps, propOf, valuesOf } from '../core/notes.js';
import { choose, chooseFolder } from '../ui/choose.js';

export const ALBUM_KINDS = [
  { id: 'subject', label: 'Subject' },
  { id: 'project', label: 'Project' },
  { id: 'reference', label: 'Reference' },
  { id: 'index', label: 'Index' },
];

/** The statuses that mean a note is done. */
export const DONE_VALUES = ['done', 'complete', 'completed', 'finished', 'read'];

/** The folder-note properties a folder's structure is read from; a vault may have renamed them (settings.albumKeyNames). */
export const ALBUM_KEY_DEFAULTS = { type: 'album', description: 'description', includes: 'includes', related: 'related', featured: 'featured' };

export class Albums extends Feature {
  enable() {
    this.plugin.gathering = (folder) => this.info(folder);
    this.plugin.describe = (folder) => {
      const info = this.info(folder);
      return [info.label, info.description, this.progress(folder, info)].filter(Boolean).join(' · ') || null;
    };
    this.add(() => {
      delete this.plugin.gathering;
      delete this.plugin.describe;
    });
  }

  key(field) {
    const own = (this.settings.albumKeyNames || {})[field];
    return (typeof own === 'string' && own.trim()) || ALBUM_KEY_DEFAULTS[field];
  }

  /** What a folder note says, in the shape settings.albums keeps. */
  fromNote(note) {
    if (!note) return null;
    const fm = noteProps(this.app, note);
    const out = {};
    const one = (field) => String(valuesOf(propOf(fm, this.key(field)))[0] || '');
    if (one('type')) out.type = one('type').toLowerCase();
    const description = valuesOf(propOf(fm, this.key('description'))).join(' ');
    if (description) out.description = description;
    ['includes', 'related', 'featured'].forEach((field) => {
      const list = valuesOf(propOf(fm, this.key(field))).map((v) => {
        const plain = linkTarget(v) || v;
        const file = this.app.metadataCache.getFirstLinkpathDest(plain, note.path);
        const target = file && this.plugin.files.isFolderNote(file) ? file.parent : file;
        return target ? target.path : plain;
      });
      if (list.length) out[field] = list;
    });
    return Object.keys(out).length ? out : null;
  }

  data(folder) {
    return (this.settings.albums || {})[folder.path] || this.fromNote(this.plugin.files.folderNote(folder)) || {};
  }

  /** { type, label, description, includes, related, featured, missing }: files and folders that still exist, and the names of those that don't. */
  info(folder) {
    const empty = { type: '', label: '', description: '', includes: [], related: [], featured: [], missing: [] };
    if (!folder || folder.path === '/') return empty;
    const data = this.data(folder);
    const type = String(data.type || '').toLowerCase();
    const known = ALBUM_KINDS.find((k) => k.id === type);
    const missing = [];
    const links = (field) => (Array.isArray(data[field]) ? data[field] : []).map((p) => {
      const target = this.app.vault.getAbstractFileByPath(p) || this.app.vault.getAbstractFileByPath(`${p}.md`);
      if (!target) missing.push(String(p).split('/').pop());
      return target;
    }).filter((t, i, all) => t && t !== folder && all.indexOf(t) === i);
    return {
      type,
      label: known ? known.label : type ? type.charAt(0).toUpperCase() + type.slice(1) : '',
      description: String(data.description || ''),
      includes: links('includes').flatMap((t) => (t instanceof TFolder ? this.plugin.index.notes(t) : [t])),
      related: links('related').filter((t) => t instanceof TFolder),
      featured: links('featured').filter((t) => t instanceof TFile),
      missing,
    };
  }

  /** Whether a note is done: `done: true`, or a status that says so. */
  isDone(file) {
    if (this.plugin.notes.get(file, 'done') === true) return true;
    return valuesOf(this.plugin.notes.get(file, 'status')).some((v) => DONE_VALUES.includes(v.toLowerCase()));
  }

  /** A project's "8 of 20 done"; with rollups on, any folder's, and the span of dates one property holds. */
  progress(folder, info) {
    const rollups = !!this.settings.albumRollups;
    if (info.type !== 'project' && !rollups) return null;
    const notes = this.plugin.index.notes(folder);
    if (!notes.length) return null;
    const parts = [];
    const done = notes.filter((f) => this.isDone(f)).length;
    if (info.type === 'project' || done) parts.push(`${done} of ${notes.length} done`);
    const key = String(this.settings.rollupDateKey || '').trim();
    if (rollups && key) {
      const dates = notes.flatMap((f) => valuesOf(this.plugin.notes.get(f, key))).filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v)).map((v) => v.slice(0, 10)).sort();
      const day = (iso) => new Date(`${iso}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      if (dates.length) parts.push(dates[0] === dates[dates.length - 1] ? `${key} ${day(dates[0])}` : `${key} ${day(dates[0])} – ${day(dates[dates.length - 1])}`);
    }
    return parts.join(' · ') || null;
  }

  /** Changes what a folder is. The first change carries over whatever its folder note said. */
  async change(folder, edit) {
    const albums = this.settings.albums || (this.settings.albums = {});
    const data = Object.assign({}, this.data(folder));
    edit(data);
    Object.keys(data).forEach((k) => (data[k] == null || data[k] === '' || (Array.isArray(data[k]) && !data[k].length)) && delete data[k]);
    albums[folder.path] = data;
    await this.plugin.saveSettings();
  }

  /** The folders that take a note in from elsewhere. */
  including(file) {
    return this.plugin.index.folders().filter((f) => this.info(f).includes.includes(file));
  }

  async chooseKind(folder) {
    const none = { id: '', label: 'No kind' };
    const kind = await choose(this.app, ALBUM_KINDS.concat(none), { placeholder: `What kind of folder is ${folder.name}?`, name: (k) => k.label });
    if (kind) await this.change(folder, (d) => (d.type = kind.id));
  }

  async includeNote(file) {
    const folder = await chooseFolder(this.plugin, { placeholder: `Show ${file.basename} in…`, except: (f) => f.path === '/' || f === file.parent });
    if (!folder) return;
    await this.change(folder, (d) => (d.includes = Array.from(new Set((d.includes || []).concat(file.path)))));
  }

  actions() {
    return [
      { id: 'album-set-type', name: 'Set what kind of folder this is…', on: 'folder', menu: 'Kind…', run: (ctx) => this.chooseKind(ctx.folder) },
      { id: 'album-include-note', name: 'Show this note in another folder too…', on: 'note', menu: 'Show in another folder too…', run: (ctx) => this.includeNote(ctx.file) },
    ];
  }
}
Albums.title = 'Folders as collections';
Albums.section = 'Library';
Albums.about = 'A folder’s kind and description, and the notes from elsewhere it takes in.';
