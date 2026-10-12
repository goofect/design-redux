/* ------------------------------------------------------------------ */
/* Files: made, moved, put back                                         */
/*                                                                      */
/* Notes, canvases and folders made under a free name; files moved as   */
/* Obsidian moves them, links kept, and put back with the album order   */
/* they left; the folder note found, made, and renamed with its folder. */
/* The plugin answers for these too (plugin.moveFile and so on), as     */
/* features and tests ask it.                                           */
/* ------------------------------------------------------------------ */

import { normalizePath, Notice, TFile, TFolder } from 'obsidian';

export class Files {
  constructor(plugin) {
    this.plugin = plugin;
    // Folder notes waiting to follow their folder's new name.
    this.folderNoteJobs = [];
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /** A name not yet taken in a folder: "Untitled", "Untitled 1", … */
  freeChildPath(folder, base, ext) {
    const dir = !folder || folder.path === '/' ? '' : folder.path + '/';
    const make = (n) =>
      normalizePath(`${dir}${n ? `${base} ${n}` : base}${ext ? '.' + ext : ''}`);
    let n = 0;
    while (this.app.vault.getAbstractFileByPath(make(n))) n++;
    return make(n);
  }

  /**
   * A note in a particular folder, opened with its title ready to type
   * over — the way the file explorer's New note behaves.
   */
  async newNote(folder) {
    try {
      const file = await this.app.vault.create(
        this.freeChildPath(folder, 'Untitled', 'md'),
        ''
      );
      await this.app.workspace
        .getLeaf(false)
        .openFile(file, { active: true, eState: { rename: 'all' } });
    } catch (err) {
      console.error('Design Redux: could not create the note', err);
      new Notice('Could not create the note.');
    }
  }

  /** An empty canvas in a folder, opened, as the file explorer's New canvas does. */
  async newCanvas(folder) {
    try {
      const file = await this.app.vault.create(
        this.freeChildPath(folder, 'Untitled', 'canvas'),
        JSON.stringify({ nodes: [], edges: [] })
      );
      await this.app.workspace.getLeaf(false).openFile(file, { active: true });
    } catch (err) {
      console.error('Design Redux: could not create the canvas', err);
      new Notice('Could not create the canvas.');
    }
  }

  /** The note that represents a folder, if it exists. */
  folderNote(folder) {
    const pattern = this.settings.folderNoteName || '{{folder}}';
    const name = pattern.replace(/\{\{folder\}\}/g, folder.name);
    return this.app.vault.getFileByPath(`${folder.path}/${name}.md`);
  }

  /**
   * A folder renamed takes its folder note's name with it — the note is
   * found by the folder's name, and holds its cover and properties, so
   * left behind it would stop being the folder's note. Renamed as
   * Obsidian renames, so links to it follow; not if the new name is
   * taken. A folder that's only moved keeps its name, and its note.
   *
   * Obsidian tells of the folder first and of what's inside it after,
   * a moment later, so the note is looked for then too.
   */
  followFolderNote(entry, oldPath) {
    if (!oldPath) return;
    const jobs = (this.folderNoteJobs || []).filter((j) => j.until > Date.now());
    this.folderNoteJobs = jobs;
    if (entry instanceof TFolder) {
      const oldName = oldPath.split('/').pop();
      const pattern = this.settings.folderNoteName || '{{folder}}';
      if (oldName === entry.name || pattern.indexOf('{{folder}}') === -1) return;
      const job = {
        folder: entry,
        was: pattern.replace(/\{\{folder\}\}/g, oldName),
        now: pattern.replace(/\{\{folder\}\}/g, entry.name),
        until: Date.now() + 10000,
      };
      jobs.push(job);
      window.setTimeout(() => this.renameFolderNote(job), 0);
    } else if (entry instanceof TFile && jobs.length) {
      const job = jobs.find((j) => entry.parent === j.folder && entry.name === `${j.was}.md`);
      if (job) window.setTimeout(() => this.renameFolderNote(job), 0);
    }
  }

  async renameFolderNote(job) {
    const jobs = this.folderNoteJobs || [];
    if (this.plugin.unloading || jobs.indexOf(job) === -1) return;
    const note = this.app.vault.getFileByPath(`${job.folder.path}/${job.was}.md`);
    // Not moved in yet: its own rename comes later, and asks again.
    if (!note) return;
    jobs.splice(jobs.indexOf(job), 1);
    const target = normalizePath(`${job.folder.path}/${job.now}.md`);
    if (this.app.vault.getAbstractFileByPath(target)) return;
    try {
      await this.app.fileManager.renameFile(note, target);
    } catch (err) {
      console.error('Design Redux: could not rename the folder note', err);
    }
  }

  /**
   * Move a file into a folder, keeping links intact.
   *
   * renameFile rather than a raw move, because Obsidian rewrites every
   * link to the file as part of it. A name already taken in the
   * destination gets a numbered suffix instead of overwriting.
   */
  /**
   * Move a file or folder into another folder, keeping its name unless
   * that's taken there. Resolves to where it was — or false if it didn't
   * move. With { announce: true } it says so, with an Undo.
   */
  async moveFile(file, folderPath, opts = {}) {
    const dir = !folderPath || folderPath === '/' ? '' : folderPath;
    const current = file.parent ? file.parent.path : '/';
    if (current === (dir || '/')) return false;
    const from = file.path;
    // The order of the album it leaves, to restore if it comes back.
    const order = (this.settings.albumOrders || {})[current];
    const kept = order ? JSON.parse(JSON.stringify(order)) : null;
    // A folder can't go inside itself, or inside anything in it.
    const isFolder = file instanceof TFolder;
    if (isFolder && (dir === file.path || dir.startsWith(file.path + '/'))) return false;

    const at = (name) => (dir ? `${dir}/${name}` : name);
    let candidate = at(file.name);
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = at(isFolder ? `${file.name} ${n}` : `${file.basename} ${n}.${file.extension}`);
      n++;
    }

    try {
      await this.app.fileManager.renameFile(file, candidate);
    } catch (err) {
      console.error('Design Redux: could not move the file', err);
      new Notice(`Could not move "${file.name}".`);
      return false;
    }
    if (opts.announce) {
      const name = file instanceof TFile ? file.basename : file.name;
      const where = dir ? dir.split('/').pop() : this.app.vault.getName();
      this.plugin.offerUndo(`Moved “${name}” to ${where}.`, () => this.putBack(file, from, current, kept));
    }
    return from;
  }

  /**
   * A file or folder back where it was, and the order of the album it
   * came from as it was then. Not if something else has taken its place.
   */
  async putBack(entry, oldPath, parentPath, order) {
    if (this.app.vault.getAbstractFileByPath(entry.path) !== entry) {
      new Notice(`“${entry.name}” isn’t there any more, so it can’t go back.`);
      return false;
    }
    if (this.app.vault.getAbstractFileByPath(oldPath)) {
      new Notice(`Something else is at “${oldPath}” now, so it can’t go back.`);
      return false;
    }
    try {
      await this.app.fileManager.renameFile(entry, oldPath);
    } catch (err) {
      console.error('Design Redux: could not undo', err);
      new Notice('Could not undo that.');
      return false;
    }
    if (order && parentPath) {
      this.settings.albumOrders = Object.assign({}, this.settings.albumOrders, { [parentPath]: order });
      await this.plugin.saveData(this.settings);
    }
    this.plugin.refreshBrowse();
    return true;
  }

  /**
   * Whether a folder holds anything worth showing. Counted through
   * subfolders, since a folder whose only contents are folders of notes
   * is still somewhere you'd want to go — and the folder note doesn't
   * count, as it describes the folder rather than filling it.
   */
  folderHasNotes(folder) {
    for (const child of folder.children || []) {
      if (child instanceof TFolder) {
        if (this.folderHasNotes(child)) return true;
      } else if (!this.isFolderNote(child)) {
        return true;
      }
    }
    return false;
  }

  /** True for the note that stands for its own folder. */
  isFolderNote(file) {
    if (!this.settings.hideFolderNotes) return false;
    if (!file.parent || file.extension !== 'md') return false;
    const pattern = this.settings.folderNoteName || '{{folder}}';
    return file.basename === pattern.replace(/\{\{folder\}\}/g, file.parent.name);
  }

  async ensureFolderNote(folder) {
    const existing = this.folderNote(folder);
    if (existing) return existing;

    const pattern = this.settings.folderNoteName || '{{folder}}';
    const name = pattern.replace(/\{\{folder\}\}/g, folder.name);
    return this.app.vault.create(`${folder.path}/${name}.md`, '');
  }
}
