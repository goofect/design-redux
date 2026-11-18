/* ------------------------------------------------------------------ */
/* What a folder is: its description, what it gathers                 */
/*                                                                     */
/* A folder can say what it is for, which folders sit beside it, and   */
/* which of its notes to start with. The plugin keeps this by the folder's      */
/* path (settings.albums); a folder note from before is read, by the   */
/* same property names as ever. Nothing is written into a note. A      */
/* folder's kind is gone; its command id stays, quiet. So are the old  */
/* cover and colour commands.                                          */
/* ------------------------------------------------------------------ */

import { TFile, TFolder } from 'obsidian';
import { Feature } from '../core/feature.js';
import { linkTarget, noteProps, propOf, valuesOf } from '../core/notes.js';
import { retiredActions } from '../core/actions.js';

/** The old cover and colour commands: kept so a hotkey on one is quiet, not broken; never offered. */
const RETIRED_COVER_COMMANDS = ['set-cover-image', 'remove-cover-image', 'cover-from-first-image', 'set-folder-cover', 'remove-folder-cover', 'repair-cover-link', 'set-cover-color'];

/** The statuses that mean a note is done. */
export const DONE_VALUES = ['done', 'complete', 'completed', 'finished', 'read'];

/** The folder-note properties a folder's structure is read from; a vault may have renamed them (settings.albumKeyNames). */
export const ALBUM_KEY_DEFAULTS = { description: 'description', includes: 'includes', related: 'related', featured: 'featured' };

export class Albums extends Feature {
  enable() {
    this.plugin.gathering = (folder) => this.info(folder);
    this.plugin.describe = (folder) => {
      const info = this.info(folder);
      return [info.description, this.progress(folder)].filter(Boolean).join(' · ') || null;
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

  /** { description, includes, related, featured, missing }: files and folders that still exist, and the names of those that don't. */
  info(folder) {
    const empty = { description: '', includes: [], related: [], featured: [], missing: [] };
    if (!folder || folder.path === '/') return empty;
    const data = this.data(folder);
    const missing = [];
    const links = (field) => (Array.isArray(data[field]) ? data[field] : []).map((p) => {
      const target = this.app.vault.getAbstractFileByPath(p) || this.app.vault.getAbstractFileByPath(`${p}.md`);
      if (!target) missing.push(String(p).split('/').pop());
      return target;
    }).filter((t, i, all) => t && t !== folder && all.indexOf(t) === i);
    return {
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

  /** With rollups on, a folder's "8 of 20 done", and the span of dates one property holds. */
  progress(folder) {
    if (!this.settings.albumRollups) return null;
    const notes = this.plugin.index.notes(folder);
    if (!notes.length) return null;
    const parts = [];
    const done = notes.filter((f) => this.isDone(f)).length;
    if (done) parts.push(`${done} of ${notes.length} done`);
    const key = String(this.settings.rollupDateKey || '').trim();
    if (key) {
      const dates = notes.flatMap((f) => valuesOf(this.plugin.notes.get(f, key))).filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v)).map((v) => v.slice(0, 10)).sort();
      const day = (iso) => new Date(`${iso}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      if (dates.length) parts.push(dates[0] === dates[dates.length - 1] ? `${key} ${day(dates[0])}` : `${key} ${day(dates[0])} – ${day(dates[dates.length - 1])}`);
    }
    return parts.join(' · ') || null;
  }

  actions() {
    return [
      ...retiredActions(['album-set-type'], 'a folder has no kind'),
      ...retiredActions(RETIRED_COVER_COMMANDS, 'covers and colours are gone'),
      ...retiredActions(['album-include-note'], 'a folder shows only the notes directly in it'),
    ];
  }
}
Albums.title = 'Folders as collections';
Albums.section = 'Library';
Albums.about = 'A folder’s description, and the notes to start with.';
