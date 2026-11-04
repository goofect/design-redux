/* ------------------------------------------------------------------ */
/* The library index                                                  */
/*                                                                    */
/* What the screens ask of the vault, kept in one place: every file,  */
/* the notes (folder notes aside), the folders and their folder       */
/* notes, how much each folder holds, and which notes link where.     */
/* Every screen reads it rather than walking the vault itself, so     */
/* they agree, and a big folder costs one walk, not one per tile.     */
/*                                                                    */
/* It keeps what it has worked out once the plugin has it listen —    */
/* files come and go, links are resolved — and forgets it when they   */
/* do. Not listening (a test's stand-in vault), it works everything   */
/* out on each ask.                                                   */
/* ------------------------------------------------------------------ */

import { TFile, TFolder } from 'obsidian';
import { countFilesIn } from './040-helpers-sorting.js';

export class LibraryIndex {
  constructor(plugin) {
    this.plugin = plugin;
    this.live = false;
    this.cache = new Map();
  }

  get app() {
    return this.plugin.app;
  }

  /** From now on, keep what's worked out, and forget it as the vault changes. */
  listen() {
    const plugin = this.plugin;
    const vault = this.app.vault;
    const meta = this.app.metadataCache;
    ['create', 'delete', 'rename'].forEach((type) => plugin.registerEvent(vault.on(type, () => this.forget())));
    // A note's links change as it's edited; its name and place don't.
    ['resolve', 'resolved'].forEach((type) => plugin.registerEvent(meta.on(type, () => this.forget('links'))));
    this.live = true;
    this.forget();
  }

  /** What's kept, forgotten: everything, or only the links. */
  forget(what) {
    if (what === 'links') this.cache.delete('incoming');
    else this.cache.clear();
  }

  /** Worked out once while listening; each time otherwise. */
  kept(key, work) {
    if (!this.live) return work();
    if (!this.cache.has(key)) this.cache.set(key, work());
    return this.cache.get(key);
  }

  /** A list kept, as a copy of its own for the caller to sort or trim. */
  list(key, work) {
    return this.kept(key, work).slice();
  }

  root() {
    return this.app.vault.getRoot();
  }

  /** Every file. */
  files() {
    return this.list('files', () => this.app.vault.getFiles());
  }

  /** Every Markdown file, folder notes included. */
  markdown() {
    return this.list('markdown', () => this.app.vault.getMarkdownFiles());
  }

  /** The notes: Markdown files that don't stand for their folder. */
  notes() {
    return this.list('notes', () => this.markdown().filter((f) => !this.plugin.isFolderNote(f)));
  }

  /** Every folder but the vault's own, each before what's inside it. */
  folders() {
    return this.list('folders', () => {
      const out = [];
      const walk = (folder) =>
        (folder.children || []).forEach((c) => {
          if (c instanceof TFolder) {
            out.push(c);
            walk(c);
          }
        });
      walk(this.root());
      return out;
    });
  }

  /** Each folder that has a folder note, with it: [{ folder, note }]. */
  folderNotes() {
    return this.list('folderNotes', () =>
      this.markdown()
        .filter((note) => note.parent && this.plugin.isFolderNote(note))
        .map((note) => ({ folder: note.parent, note }))
    );
  }

  /** What each folder holds, however deep: files, and whether any is a note. Worked out in one walk. */
  holdings() {
    return this.kept('holdings', () => {
      const count = new Map();
      const notes = new Map();
      const walk = (folder) => {
        let n = 0;
        let has = false;
        (folder.children || []).forEach((c) => {
          if (c instanceof TFolder) {
            walk(c);
            n += count.get(c);
            has = has || notes.get(c);
          } else {
            n++;
            if (!this.plugin.isFolderNote(c)) has = true;
          }
        });
        count.set(folder, n);
        notes.set(folder, has);
      };
      walk(this.root());
      return { count, notes };
    });
  }

  /** How many files are beneath a folder, however deep. */
  count(folder) {
    if (!this.live) return countFilesIn(folder);
    const n = this.holdings().count.get(folder);
    return n === undefined ? countFilesIn(folder) : n;
  }

  /** Whether a folder holds a note — not only its own folder note — however deep. */
  hasNotes(folder) {
    if (!this.live) return this.plugin.files.folderHasNotes(folder);
    const has = this.holdings().notes.get(folder);
    return has === undefined ? this.plugin.files.folderHasNotes(folder) : has;
  }

  /** The links Obsidian resolved: { from: { to: count } }. */
  resolved() {
    return this.app.metadataCache.resolvedLinks || {};
  }

  /** The paths of the files linking to one, with how often: { from: count }. */
  incoming(file) {
    const path = file instanceof TFile ? file.path : file;
    const all = this.kept('incoming', () => {
      const into = new Map();
      const links = this.resolved();
      Object.keys(links).forEach((from) =>
        Object.keys(links[from] || {}).forEach((to) => {
          if (!into.has(to)) into.set(to, {});
          into.get(to)[from] = links[from][to];
        })
      );
      return into;
    });
    return all.get(path) || {};
  }

  /** The paths a file links to, with how often: { to: count }. */
  outgoing(file) {
    const path = file instanceof TFile ? file.path : file;
    return this.resolved()[path] || {};
  }
}

/** The plugin's index — or, where none was made (a test's stand-in plugin), one that works things out each time. */
export function libraryIndex(plugin) {
  if (!plugin.libraryIndex) plugin.libraryIndex = new LibraryIndex(plugin);
  return plugin.libraryIndex;
}
