/* ------------------------------------------------------------------ */
/* Up Next                                                             */
/*                                                                     */
/* Notes queued to read, in order. The strip's » goes to the first of  */
/* them before going on through the album, the way a player's next     */
/* goes to Up Next before the rest of what's on. Kept in settings by   */
/* path, and followed through renames, moves and deletions.            */
/* ------------------------------------------------------------------ */

import { TFile, TFolder } from 'obsidian';
import { pageLeaf } from './030-helpers-art.js';
import { movedPath } from './070-orders.js';

export class Queue {
  constructor(plugin) {
    this.plugin = plugin;
    // Told whenever the queue changes (Up Next, to redraw what shows it).
    this.listeners = [];
  }

  /** Call `fn` whenever the queue changes; returns what stops it. */
  onChange(fn) {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  paths() {
    return Array.isArray(this.settings.queue) ? this.settings.queue : [];
  }

  /** The queued notes that still exist, in order. */
  files() {
    return this.paths()
      .map((p) => this.app.vault.getFileByPath(p))
      .filter(Boolean);
  }

  has(file) {
    return !!file && this.paths().indexOf(file.path) !== -1;
  }

  /** The first queued note, passing over `except` — the one already open. */
  peek(except) {
    return this.files().find((f) => f !== except) || null;
  }

  /**
   * Queue notes: at the front, to be read next, or at the end. A note
   * already queued moves rather than being there twice.
   */
  add(files, next) {
    const adding = files
      .filter((f) => f instanceof TFile)
      .map((f) => f.path)
      .filter((p, i, all) => all.indexOf(p) === i);
    if (!adding.length) return 0;
    const rest = this.paths().filter((p) => adding.indexOf(p) === -1);
    this.set(next ? adding.concat(rest) : rest.concat(adding));
    return adding.length;
  }

  remove(file) {
    if (!this.has(file)) return;
    this.set(this.paths().filter((p) => p !== file.path));
  }

  clear() {
    if (this.paths().length) this.set([]);
  }

  set(paths) {
    this.settings.queue = paths.slice();
    // An empty queue isn't playing from anywhere.
    if (!paths.length) this.settings.queueSource = '';
    this.save();
  }

  save() {
    this.plugin.saveData(this.settings);
    this.listeners.forEach((fn) => fn());
  }

  /* -- where it's from, the one before, the ones kept ---------------- */

  /** The album it's playing from, while there is one. */
  source() {
    const path = this.settings.queueSource;
    const folder = path ? this.app.vault.getAbstractFileByPath(path) : null;
    return folder instanceof TFolder ? folder : null;
  }

  /** What's there now, to put back: { paths, source }. */
  snapshot() {
    return { paths: this.paths().slice(), source: this.settings.queueSource || '' };
  }

  restore(was) {
    this.settings.queueSource = was.source || '';
    this.set(was.paths || []);
  }

  /** In place of what's there — which is kept, to resume — played from `source`, an album, or none. Returns what was there. */
  replace(paths, source) {
    const was = this.snapshot();
    if (was.paths.length) this.settings.queuePrevious = was;
    this.settings.queueSource = source ? source.path : '';
    this.set(paths);
    return was;
  }

  /** The queue before the last one put in its place, while it has anything left in it. */
  previous() {
    const was = this.settings.queuePrevious;
    return was && Array.isArray(was.paths) && was.paths.some((p) => this.app.vault.getFileByPath(p)) ? was : null;
  }

  /** The queue before back again; the one now becomes the one before. */
  resume() {
    const was = this.previous();
    if (!was) return false;
    const folder = was.source ? this.app.vault.getAbstractFileByPath(was.source) : null;
    this.replace(was.paths, folder instanceof TFolder ? folder : null);
    return true;
  }

  /**
   * Notes played: the first opened in the page, the rest lined up in
   * place of what was there, from `source`. Undo puts it back.
   */
  play(files, source, name) {
    const notes = files.filter((f) => f instanceof TFile);
    if (!notes.length) return false;
    const was = this.replace(notes.slice(1).map((f) => f.path), source);
    const leaf = pageLeaf(this.app) || this.app.workspace.getLeaf(false);
    if (leaf) leaf.openFile(notes[0]);
    if (typeof this.plugin.offerUndo === 'function') {
      this.plugin.offerUndo(`Playing ${name || (source ? source.name : 'the list')}${notes.length > 1 ? `: ${notes.length - 1} up next` : ''}.`, () => this.restore(was));
    }
    return true;
  }

  /** Reading queues kept to play again: { id, name, paths }. */
  saved() {
    const list = this.settings.readingQueues;
    return Array.isArray(list) ? list.filter((q) => q && q.id && q.name && Array.isArray(q.paths)) : [];
  }

  /** The queue as it is, kept under a name. */
  keep(name) {
    const paths = this.paths();
    if (!paths.length || !name) return null;
    const kept = { id: `q${Date.now().toString(36)}`, name, paths: paths.slice() };
    this.settings.readingQueues = this.saved().concat([kept]);
    this.save();
    return kept;
  }

  forget(id) {
    const list = this.saved();
    const kept = list.filter((q) => q.id !== id);
    if (kept.length === list.length) return;
    this.settings.readingQueues = kept;
    this.save();
  }

  /** A kept queue's notes that still exist. */
  filesOf(kept) {
    return kept.paths.map((p) => this.app.vault.getFileByPath(p)).filter(Boolean);
  }

  /* -- following the files ------------------------------------------- */

  /** Every path it keeps — the queue, its source, the one before, those kept — passed through `fn`, which returns the new path or null to drop it. */
  mapPaths(fn) {
    const s = this.settings;
    let changed = false;
    const list = (paths) => {
      const out = [];
      paths.forEach((p) => {
        const next = fn(p);
        if (next !== p) changed = true;
        if (next) out.push(next);
      });
      return out;
    };
    const queue = list(this.paths());
    if (s.queueSource) {
      const next = fn(s.queueSource) || '';
      if (next !== s.queueSource) {
        changed = true;
        s.queueSource = next;
      }
    }
    if (s.queuePrevious && Array.isArray(s.queuePrevious.paths)) {
      const source = s.queuePrevious.source ? fn(s.queuePrevious.source) || '' : '';
      if (source !== (s.queuePrevious.source || '')) changed = true;
      s.queuePrevious = { paths: list(s.queuePrevious.paths), source };
    }
    if (Array.isArray(s.readingQueues)) s.readingQueues = s.readingQueues.map((q) => (q && Array.isArray(q.paths) ? Object.assign({}, q, { paths: list(q.paths) }) : q));
    if (!changed) return;
    s.queue = queue;
    this.save();
  }

  followRename(file, oldPath) {
    this.mapPaths((p) => movedPath(p, oldPath, file.path));
  }

  followDelete(file) {
    this.mapPaths((p) => (p === file.path || p.startsWith(file.path + '/') ? null : p));
  }
}
