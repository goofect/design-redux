/* ------------------------------------------------------------------ */
/* Files: made, moved, put back; and a folder's own note               */
/*                                                                     */
/* A folder note is the note inside a folder that is named for it (the */
/* pattern is a setting). It holds what the folder is: its kind, its   */
/* description, what it gathers. When the folder is renamed its note   */
/* is renamed with it.                                                 */
/* ------------------------------------------------------------------ */

import { Notice, TFile, TFolder, normalizePath } from 'obsidian';
import { offerUndo } from './notes.js';

export class Files {
  constructor(plugin) {
    this.plugin = plugin;
  }

  get app() {
    return this.plugin.app;
  }

  /** A path in `folder` that nothing has yet: "Untitled.md", "Untitled 1.md", … */
  freePath(folder, base, ext) {
    const dir = !folder || folder.path === '/' ? '' : `${folder.path}/`;
    const make = (n) => normalizePath(`${dir}${n ? `${base} ${n}` : base}${ext ? `.${ext}` : ''}`);
    let n = 0;
    while (this.app.vault.getAbstractFileByPath(make(n))) n++;
    return make(n);
  }

  /** A new, empty note in a folder, opened to be named. */
  async newNote(folder, name) {
    try {
      const file = await this.app.vault.create(this.freePath(folder, name || 'Untitled', 'md'), '');
      await this.app.workspace.getLeaf(false).openFile(file, name ? { active: true } : { active: true, eState: { rename: 'all' } });
      return file;
    } catch (err) {
      console.error('Design Redux: could not create the note', err);
      new Notice('Could not create the note.');
      return null;
    }
  }

  async newFolder(folder, name) {
    try {
      return await this.app.vault.createFolder(this.freePath(folder, name || 'Untitled', ''));
    } catch (err) {
      console.error('Design Redux: could not create the folder', err);
      new Notice('Could not create the folder.');
      return null;
    }
  }

  /** The name a folder's own note has. */
  folderNoteName(folderName) {
    return (this.plugin.settings.folderNoteName || '{{folder}}').replace(/\{\{folder\}\}/g, folderName);
  }

  /** A folder's own note, or null. */
  folderNote(folder) {
    if (!folder || folder.path === '/') return null;
    return this.app.vault.getFileByPath(`${folder.path}/${this.folderNoteName(folder.name)}.md`);
  }

  isFolderNote(file) {
    return file instanceof TFile && !!file.parent && this.folderNote(file.parent) === file;
  }

  /** A folder's own note, made if it has none. */
  async ensureFolderNote(folder) {
    const have = this.folderNote(folder);
    if (have) return have;
    try {
      return await this.app.vault.create(normalizePath(`${folder.path}/${this.folderNoteName(folder.name)}.md`), '');
    } catch (err) {
      console.error('Design Redux: could not create the folder note', err);
      return null;
    }
  }

  /** After a folder was renamed: its note, still under the old name, takes the new one. */
  async followFolderRename(folder, oldPath) {
    if (!(folder instanceof TFolder)) return;
    const oldName = oldPath.split('/').pop();
    if (oldName === folder.name || !(this.plugin.settings.folderNoteName || '{{folder}}').includes('{{folder}}')) return;
    const note = this.app.vault.getFileByPath(`${folder.path}/${this.folderNoteName(oldName)}.md`);
    const target = normalizePath(`${folder.path}/${this.folderNoteName(folder.name)}.md`);
    if (!note || this.app.vault.getAbstractFileByPath(target)) return;
    try {
      await this.app.fileManager.renameFile(note, target);
    } catch (err) {
      console.error('Design Redux: could not rename the folder note', err);
    }
  }

  /**
   * Moves a file or folder into a folder, under a free name there. Returns
   * the path it came from, or false when it did not move. `announce` offers
   * to put it back.
   */
  async move(file, folderPath, opts = {}) {
    const dir = !folderPath || folderPath === '/' ? '' : folderPath;
    const current = file.parent ? file.parent.path : '/';
    if (current === (dir || '/')) return false;
    const isFolder = file instanceof TFolder;
    if (isFolder && (dir === file.path || dir.startsWith(`${file.path}/`))) return false;
    const from = file.path;
    const at = (name) => (dir ? `${dir}/${name}` : name);
    let candidate = at(file.name);
    for (let n = 1; this.app.vault.getAbstractFileByPath(candidate); n++) candidate = at(isFolder ? `${file.name} ${n}` : `${file.basename} ${n}.${file.extension}`);
    try {
      await this.app.fileManager.renameFile(file, candidate);
    } catch (err) {
      console.error('Design Redux: could not move the file', err);
      new Notice(`Could not move “${file.name}”.`);
      return false;
    }
    if (opts.announce) {
      const name = file instanceof TFile ? file.basename : file.name;
      offerUndo(this.plugin, `Moved “${name}” to ${dir ? dir.split('/').pop() : 'the vault'}.`, () => this.putBack(file, from));
    }
    return from;
  }

  /** Puts a moved file back where it was, if it is still there to move and the place is still free. */
  async putBack(entry, oldPath) {
    if (this.app.vault.getAbstractFileByPath(entry.path) !== entry) {
      new Notice(`“${entry.name}” isn’t there any more, so it can’t go back.`);
      return false;
    }
    if (this.app.vault.getAbstractFileByPath(oldPath)) {
      new Notice(`Something else is at ${oldPath} now.`);
      return false;
    }
    try {
      await this.app.fileManager.renameFile(entry, oldPath);
      return true;
    } catch (err) {
      console.error('Design Redux: could not put the file back', err);
      return false;
    }
  }

  /** Renames a file or folder in place. Returns whether it did. */
  async rename(entry, name) {
    const clean = String(name || '').replace(/[\\/:]/g, ' ').trim();
    if (!clean) return false;
    const dir = entry.parent && entry.parent.path !== '/' ? `${entry.parent.path}/` : '';
    const target = normalizePath(`${dir}${clean}${entry instanceof TFile ? `.${entry.extension}` : ''}`);
    if (target === entry.path) return false;
    if (this.app.vault.getAbstractFileByPath(target)) {
      new Notice(`There is already a “${clean}” here.`);
      return false;
    }
    try {
      await this.app.fileManager.renameFile(entry, target);
      return true;
    } catch (err) {
      console.error('Design Redux: could not rename', err);
      new Notice(`Could not rename “${entry.name}”.`);
      return false;
    }
  }

  /** Sends a file or folder to the bin the person chose in Obsidian's settings. */
  async trash(entry) {
    try {
      if (typeof this.app.fileManager.trashFile === 'function') await this.app.fileManager.trashFile(entry);
      else await this.app.vault.trash(entry, true);
      return true;
    } catch (err) {
      console.error('Design Redux: could not delete', err);
      new Notice(`Could not delete “${entry.name}”.`);
      return false;
    }
  }
}
