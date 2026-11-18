/* ------------------------------------------------------------------ */
/* Reorganising folders safely                                         */
/*                                                                     */
/* Renaming a folder, moving it, merging it into another, splitting    */
/* notes off into a new one, deleting it: each said first — what       */
/* moves, what is renamed because its name is taken, how many links    */
/* point in — and done only when that is agreed. Files move the way    */
/* Obsidian moves them, so links follow, and one Undo puts every file  */
/* back.                                                               */
/* ------------------------------------------------------------------ */

import { Notice, TFile, normalizePath } from 'obsidian';
import { Feature } from '../core/feature.js';
import { offerUndo } from '../core/notes.js';
import { counted } from '../core/text.js';
import { chooseFolder } from '../ui/choose.js';
import { row, rows } from '../ui/row.js';
import { Sheet, ask, confirm } from '../ui/sheet.js';
import { deleteEntry, moveEntry, renameEntry } from './menus.js';

/**
 * Where each of `entries` would go in `target`: [{ entry, to, renamed }],
 * a name already taken there given a number.
 */
export function planMoves(app, entries, targetPath) {
  const taken = new Set();
  const dir = targetPath === '/' ? '' : `${targetPath}/`;
  return entries.map((entry) => {
    const isFile = entry instanceof TFile;
    const make = (n) => normalizePath(`${dir}${isFile ? entry.basename : entry.name}${n ? ` ${n}` : ''}${isFile ? `.${entry.extension}` : ''}`);
    let n = 0;
    while (app.vault.getAbstractFileByPath(make(n)) || taken.has(make(n))) n++;
    taken.add(make(n));
    return { entry, to: make(n), from: entry.path, renamed: n > 0 };
  });
}

export class AlbumRefactor extends Feature {
  /** How many links from outside point at these notes. */
  linksInto(files, folder) {
    const inside = new Set(files);
    return files.reduce((n, f) => n + this.plugin.index.incoming(f).filter((from) => !inside.has(from) && !(folder && from.path.startsWith(`${folder.path}/`))).length, 0);
  }

  /** Carries out a plan; returns the moves that happened. */
  async carry(plan) {
    const done = [];
    for (const move of plan) {
      try {
        await this.app.fileManager.renameFile(move.entry, move.to);
        done.push(move);
      } catch (err) {
        console.error('Design Redux: could not move', move.from, err);
      }
    }
    if (done.length < plan.length) new Notice(`${counted(plan.length - done.length, 'file')} could not be moved.`);
    return done;
  }

  /** Puts every moved file back, last first, making again a folder that was removed. */
  async putBack(done, folderPath) {
    if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) await this.app.vault.createFolder(folderPath);
    for (const move of done.slice().reverse()) {
      if (this.app.vault.getAbstractFileByPath(move.entry.path) !== move.entry || this.app.vault.getAbstractFileByPath(move.from)) continue;
      await this.app.fileManager.renameFile(move.entry, move.from);
    }
  }

  async merge(folder) {
    const into = await chooseFolder(this.plugin, { placeholder: `Merge ${folder.name} into…`, except: (f) => f.path === '/' || f === folder || f.path.startsWith(`${folder.path}/`) });
    if (!into) return false;
    const entries = folder.children.slice();
    const plan = planMoves(this.app, entries, into.path);
    const notes = this.plugin.index.notes(folder);
    const renamed = plan.filter((m) => m.renamed).length;
    const yes = await confirm(this.app, {
      title: `Merge ${folder.name} into ${into.name}`,
      text: [`${counted(plan.length, 'item')} move into ${into.name}.`, renamed ? `${counted(renamed, 'name is', 'names are')} taken there: those get a number.` : '', `${counted(this.linksInto(notes, folder), 'link')} from elsewhere follow.`, `${folder.name} is then removed.`].filter(Boolean).join(' '),
      action: 'Merge',
    });
    if (!yes) return false;
    const path = folder.path;
    const done = await this.carry(plan);
    if (done.length === plan.length && !folder.children.length) await this.plugin.files.trash(folder);
    offerUndo(this.plugin, `Merged ${folder.name} into ${into.name}.`, () => this.putBack(done, path));
    return true;
  }

  async split(folder) {
    const notes = this.plugin.index.notes(folder);
    if (!notes.length) return void new Notice('There are no notes here to split off.');
    const picked = new Set();
    const chosen = await new Promise((resolve) => {
      let go = false;
      const sheet = new Sheet(this.app, {
        title: `Split notes off from ${folder.name}`,
        text: 'Pick the notes to move into a new folder beside this one.',
        build: (matter) => {
          const list = rows(matter);
          notes.forEach((note) => {
            const r = row(list, { name: note.basename, run: () => {
              if (picked.has(note)) picked.delete(note); else picked.add(note);
              r.setAttribute('aria-selected', String(picked.has(note)));
            } });
            r.setAttribute('aria-selected', 'false');
          });
        },
        actions: [{ text: 'Cancel' }, { text: 'Split off', kind: 'primary', run: () => (picked.size ? void (go = true) : false) }],
      });
      sheet.closed = () => resolve(go);
      sheet.open();
    });
    if (!chosen) return false;
    const name = await ask(this.app, { title: 'The new folder', placeholder: `${folder.name} 2`, action: 'Make it' });
    if (!name) return false;
    const made = await this.plugin.files.newFolder(folder.parent, name);
    if (!made) return false;
    const done = await this.carry(planMoves(this.app, Array.from(picked), made.path));
    offerUndo(this.plugin, `Split ${counted(done.length, 'note')} off into ${made.name}.`, async () => {
      await this.putBack(done);
      if (!made.children.length) await this.plugin.files.trash(made);
    });
    return true;
  }

  actions() {
    const on = 'folder';
    return [
      { id: 'album-rename', name: 'Rename this folder…', on, menu: false, run: (ctx) => renameEntry(this.plugin, ctx.folder) },
      { id: 'album-move', name: 'Move this folder…', on, menu: false, run: (ctx) => moveEntry(this.plugin, ctx.folder) },
      { id: 'album-merge', name: 'Merge this folder into another…', on, menu: 'Merge into…', section: 'danger', run: (ctx) => this.merge(ctx.folder) },
      { id: 'album-split', name: 'Split notes off into a new folder…', on, menu: 'Split notes off…', section: 'danger', run: (ctx) => this.split(ctx.folder) },
      { id: 'album-delete', name: 'Delete this folder…', on, menu: false, run: (ctx) => deleteEntry(this.plugin, ctx.folder) },
    ];
  }
}
AlbumRefactor.title = 'Reorganising folders';
AlbumRefactor.section = 'Library';
AlbumRefactor.about = 'Merge a folder into another or split notes off, said first and undone in one.';
