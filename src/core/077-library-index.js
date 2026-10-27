/* ------------------------------------------------------------------ */
/* The library index                                                  */
/*                                                                    */
/* What the screens ask of the vault, kept in one place: every file,  */
/* the notes (folder notes aside), the folders and their folder       */
/* notes, how much each folder holds, and which notes link where.     */
/* Every screen reads it rather than walking the vault itself, so     */
/* they agree, and a big folder costs one walk, not one per tile.     */
/*                                                                    */
/* It keeps what it has worked out once the plugin has it listen, and */
/* keeps it right as the vault changes: a file that comes, goes or    */
/* moves retallies only the folders on its branches, and a note whose */
/* links resolve again changes only the links it held. The lists are  */
/* made again on the next ask. `drift()` says where what's kept       */
/* differs from working it all out afresh. Not listening (a test's    */
/* stand-in vault), it works everything out on each ask.              */
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
    plugin.registerEvent(vault.on('create', (entry) => this.moved(entry)));
    plugin.registerEvent(vault.on('delete', (entry) => this.moved(entry, entry && entry.path)));
    plugin.registerEvent(vault.on('rename', (entry, oldPath) => this.moved(entry, oldPath)));
    // A note's links change as it's edited; its name and place don't.
    plugin.registerEvent(meta.on('resolve', (file) => this.relinked(file)));
    this.live = true;
    this.forget();
  }

  /** What's kept, forgotten: everything, or only the links. */
  forget(what) {
    if (what === 'links') {
      this.cache.delete('incoming');
      this.sent = null;
    } else {
      this.cache.clear();
      this.sent = null;
    }
  }

  /**
   * A file or folder came, went or moved. The lists are made again on
   * the next ask; what the folders hold is put right along the two
   * branches it touched, where it was and where it is, rather than
   * walking the vault again. Told twice — a folder's move tells of each
   * file in it too — it comes out the same.
   */
  moved(entry, oldPath) {
    ['files', 'markdown', 'notes', 'folders', 'folderNotes'].forEach((key) => this.cache.delete(key));
    this.forget('links');
    const held = this.cache.get('holdings');
    if (!held) return;
    if (!entry) return this.cache.delete('holdings');
    if (oldPath !== undefined) {
      if (entry instanceof TFolder && this.app.vault.getAbstractFileByPath(entry.path) !== entry) this.drop(held, entry);
      this.retally(held, this.folderAt(oldPath));
    }
    if (this.app.vault.getAbstractFileByPath(entry.path) === entry) {
      if (entry instanceof TFolder) this.tally(held, entry);
      this.retally(held, entry.parent);
    }
  }

  /** The folder a path was in, if it's still there. */
  folderAt(path) {
    if (!path.includes('/')) return this.root();
    const folder = this.app.vault.getAbstractFileByPath(path.slice(0, path.lastIndexOf('/')));
    return folder instanceof TFolder ? folder : null;
  }

  /** A folder gone: what was kept of it and its folders, let go. */
  drop(held, folder) {
    held.count.delete(folder);
    held.notes.delete(folder);
    (folder.children || []).forEach((c) => c instanceof TFolder && this.drop(held, c));
  }

  /** What one folder holds, from its own files and what's kept of its folders (worked out where it isn't). */
  tally(held, folder) {
    let n = 0;
    let has = false;
    (folder.children || []).forEach((c) => {
      if (c instanceof TFolder) {
        if (!held.count.has(c)) this.tally(held, c);
        n += held.count.get(c);
        has = has || held.notes.get(c);
      } else {
        n++;
        if (!this.plugin.isFolderNote(c)) has = true;
      }
    });
    held.count.set(folder, n);
    held.notes.set(folder, has);
  }

  /** A folder and each one above it, tallied again. */
  retally(held, folder) {
    for (let f = folder; f; f = f.parent) this.tally(held, f);
  }

  /**
   * One note's links resolved again: the links into each note are put
   * right from what it linked to before and what it links to now.
   * Without the note, or before the links were asked for, they're
   * forgotten and worked out again on the next ask.
   */
  relinked(file) {
    const into = this.cache.get('incoming');
    if (!file || !file.path || !into || !this.sent) return this.forget('links');
    const from = file.path;
    const was = this.sent.get(from) || {};
    const now = this.resolved()[from] || {};
    Object.keys(was).forEach((to) => {
      const links = into.get(to);
      if (!links) return;
      delete links[from];
      if (!Object.keys(links).length) into.delete(to);
    });
    Object.keys(now).forEach((to) => {
      if (!into.has(to)) into.set(to, {});
      into.get(to)[from] = now[to];
    });
    this.sent.set(from, Object.assign({}, now));
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
      const held = { count: new Map(), notes: new Map() };
      this.tally(held, this.root());
      return held;
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
      // What each note linked to when this was worked out, to put it right as one resolves again.
      this.sent = new Map();
      Object.keys(links).forEach((from) => {
        this.sent.set(from, Object.assign({}, links[from]));
        Object.keys(links[from] || {}).forEach((to) => {
          if (!into.has(to)) into.set(to, {});
          into.get(to)[from] = links[from][to];
        });
      });
      return into;
    });
    return all.get(path) || {};
  }

  /**
   * Where what's kept differs from working it all out afresh: a line
   * for each folder or note that differs, none when they agree. For
   * tests, and to check the index in a real vault.
   */
  drift() {
    const fresh = new LibraryIndex(this.plugin);
    fresh.live = true;
    const out = [];
    if (this.cache.has('holdings')) {
      const kept = this.cache.get('holdings');
      const cold = fresh.holdings();
      cold.count.forEach((n, folder) => {
        if (kept.count.get(folder) !== n) out.push(`${folder.path}: holds ${kept.count.get(folder)}, not ${n}`);
        if (kept.notes.get(folder) !== cold.notes.get(folder)) out.push(`${folder.path}: has notes ${kept.notes.get(folder)}, not ${cold.notes.get(folder)}`);
      });
    }
    if (this.cache.has('incoming')) {
      const kept = this.cache.get('incoming');
      fresh.incoming('');
      const cold = fresh.cache.get('incoming');
      new Set([...kept.keys(), ...cold.keys()]).forEach((to) => {
        const a = JSON.stringify(Object.entries(kept.get(to) || {}).sort());
        const b = JSON.stringify(Object.entries(cold.get(to) || {}).sort());
        if (a !== b) out.push(`${to}: linked from ${a}, not ${b}`);
      });
    }
    return out;
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
