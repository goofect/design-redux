/* ------------------------------------------------------------------ */
/* The library index: what screens read of the vault                   */
/*                                                                     */
/* Folders, the notes in each, and who links to whom, worked out once  */
/* and kept until a file is made, moved or deleted, or a link changes. */
/* A screen asks here instead of walking the vault, which is what      */
/* keeps a vault of thousands of notes instant.                        */
/* ------------------------------------------------------------------ */

import { TFile, TFolder } from 'obsidian';
import { byName } from './text.js';

export class LibraryIndex {
  constructor(plugin) {
    this.plugin = plugin;
    this.tree = null;
    this.links = null;
  }

  get app() {
    return this.plugin.app;
  }

  /** Forgets what was worked out about files (`links` only: about links). */
  forget(linksOnly) {
    this.links = null;
    if (!linksOnly) this.tree = null;
  }

  build() {
    if (this.tree) return this.tree;
    const files = this.plugin.files;
    const hide = !!this.plugin.settings.hideFolderNotes;
    const tree = { folders: [], notes: new Map(), files: new Map(), subfolders: new Map(), totals: new Map() };
    const visit = (folder) => {
      if (folder.path !== '/') tree.folders.push(folder);
      const notes = [];
      const entries = [];
      const subs = [];
      folder.children.forEach((child) => {
        if (child instanceof TFolder) {
          if (!child.name.startsWith('.')) subs.push(child);
        } else if (child instanceof TFile) {
          if (!child.name.startsWith('.')) entries.push(child);
          if (child.extension === 'md' && !(hide && files.isFolderNote(child))) notes.push(child);
        }
      });
      notes.sort((a, b) => byName(a.basename, b.basename));
      entries.sort((a, b) => byName(a.name, b.name));
      subs.sort((a, b) => byName(a.name, b.name));
      const total = notes.length + subs.reduce((n, sub) => n + visit(sub), 0);
      tree.notes.set(folder.path, notes);
      tree.files.set(folder.path, entries);
      tree.subfolders.set(folder.path, subs);
      tree.totals.set(folder.path, total);
      return total;
    };
    visit(this.app.vault.getRoot());
    this.tree = tree;
    return tree;
  }

  /** Every folder, parents before their children. */
  folders() {
    return this.build().folders;
  }

  /** A folder's own notes, by name; its own note left out when those are hidden. */
  notes(folder) {
    return this.build().notes.get(folder ? folder.path : '/') || [];
  }

  /** All visible files directly in a folder, including non-Markdown files. */
  files(folder) {
    return this.build().files.get(folder ? folder.path : '/') || [];
  }

  /** A folder's folders, by name. */
  subfolders(folder) {
    return this.build().subfolders.get(folder ? folder.path : '/') || [];
  }

  /** How many notes a folder holds, with those of the folders inside it. */
  count(folder) {
    return this.build().totals.get(folder ? folder.path : '/') || 0;
  }

  /** Every note in the vault. */
  markdown() {
    const tree = this.build();
    return Array.from(tree.notes.values()).flat();
  }

  /** A note's length in words, near enough for a bar: from its size, so no file is read. */
  words(file) {
    return file && file.stat ? Math.round(file.stat.size / 6) : 0;
  }

  linkMaps() {
    if (this.links) return this.links;
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const incoming = new Map();
    Object.keys(resolved).forEach((from) => {
      Object.keys(resolved[from]).forEach((to) => {
        if (!incoming.has(to)) incoming.set(to, []);
        incoming.get(to).push(from);
      });
    });
    this.links = { resolved, incoming };
    return this.links;
  }

  /** The notes that link to a file. */
  incoming(file) {
    return (this.linkMaps().incoming.get(file.path) || []).map((p) => this.app.vault.getFileByPath(p)).filter(Boolean);
  }

  /** The files a note links to. */
  outgoing(file) {
    return Object.keys(this.linkMaps().resolved[file.path] || {}).map((p) => this.app.vault.getFileByPath(p)).filter(Boolean);
  }
}
