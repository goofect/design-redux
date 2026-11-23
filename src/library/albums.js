/* ------------------------------------------------------------------ */
/* What a folder is: its description, what it gathers                 */
/*                                                                     */
/* A folder can say what it is for, which folders sit beside it, and   */
/* which of its notes to start with. The plugin keeps this by the     */
/* folder's path (settings.albums); a folder note from before is read, */
/* by the same property names as ever. Nothing is written into a note. */
/* ------------------------------------------------------------------ */

import { TFile, TFolder } from 'obsidian';
import { Feature } from '../core/feature.js';
import { linkTarget, noteProps, propOf, valuesOf } from '../core/notes.js';

export class Albums extends Feature {
  enable() {
    this.plugin.gathering = (folder) => this.info(folder);
    this.add(() => {
      delete this.plugin.gathering;
    });
  }

  /** What a folder note says, in the shape settings.albums keeps: its description, includes, related and featured properties. */
  fromNote(note) {
    if (!note) return null;
    const fm = noteProps(this.app, note);
    const out = {};
    const description = valuesOf(propOf(fm, 'description')).join(' ');
    if (description) out.description = description;
    ['includes', 'related', 'featured'].forEach((field) => {
      const list = valuesOf(propOf(fm, field)).map((v) => {
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

}
Albums.title = 'Folders as collections';
Albums.section = 'Library';
Albums.about = 'A folder’s description, and the notes to start with.';
