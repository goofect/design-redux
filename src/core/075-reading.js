/* ------------------------------------------------------------------ */
/* Reading history                                                     */
/*                                                                     */
/* When each note was last opened, and when it was read — reached to   */
/* its end — kept in the plugin's own data, never in the notes: a note  */
/* changed since it was read reads as changed. From it, lists mark     */
/* what's new to you, and an album opens where you were. Kept by path, */
/* so it follows renames.                                              */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';

/* How many notes the history keeps, the latest. */
export const READING_KEEP = 3000;

/* A change this soon after reading is the reading's own save, not news. */
export const READ_GRACE = 2000;

/** The line at the top of a note's view, or null. */
export function noteLine(view) {
  const mode = view && view.currentMode;
  if (!mode || typeof mode.getScroll !== 'function') return null;
  const line = mode.getScroll();
  return typeof line === 'number' && line >= 0 ? line : null;
}

/** A note's view scrolled to a line, in whichever mode it's in. */
export function scrollNoteTo(view, line) {
  if (!view || !(line >= 0)) return;
  const mode = view.currentMode;
  if (mode && typeof mode.applyScroll === 'function') mode.applyScroll(line);
  else if (typeof view.setEphemeralState === 'function') view.setEphemeralState({ line });
}

export class Reading {
  constructor(plugin) {
    this.plugin = plugin;
    this.timer = 0;
    // Counted up on every change, so what's worked out from the log knows when it's stale.
    this.version = 0;
  }

  get app() {
    return this.plugin.app;
  }

  /** { path: { opened, read, mtime, line, lineAt } }. */
  get log() {
    const s = this.plugin.settings;
    if (!s.readingLog || typeof s.readingLog !== 'object' || Array.isArray(s.readingLog)) s.readingLog = {};
    return s.readingLog;
  }

  /** When the history began: notes made before it aren't news. */
  since() {
    const s = this.plugin.settings;
    if (!s.readingSince) {
      s.readingSince = Date.now();
      this.save();
    }
    return s.readingSince;
  }

  entry(file) {
    return (file && this.log[file.path]) || null;
  }

  /** A note opened, now. */
  opened(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this.since();
    const e = this.log[file.path] || {};
    e.opened = Date.now();
    this.log[file.path] = e;
    this.prune();
    this.save();
  }

  /** A note read through, as it is now; whether that's news. */
  markRead(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return false;
    const e = this.log[file.path] || {};
    const mtime = (file.stat && file.stat.mtime) || 0;
    if (e.read && e.mtime >= mtime) return false;
    e.read = Date.now();
    e.mtime = mtime;
    if (!e.opened) e.opened = e.read;
    this.log[file.path] = e;
    this.save();
    return true;
  }

  /** Where you were in a note, by line: written a moment later with the rest, not on every scroll. */
  place(file, line) {
    if (!(file instanceof TFile) || file.extension !== 'md' || !(line >= 0)) return;
    const e = this.log[file.path] || {};
    const at = Math.floor(line);
    if (e.line === at) return;
    e.line = at;
    e.lineAt = Date.now();
    if (!e.opened) e.opened = e.lineAt;
    this.log[file.path] = e;
    this.prune();
    this.save();
  }

  /** The line you were on in a note, or null. */
  where(file) {
    const e = this.entry(file);
    return e && typeof e.line === 'number' ? e.line : null;
  }

  /** Changed while open, by you: still read. */
  edited(file) {
    const e = this.entry(file);
    if (!e || !e.read) return;
    e.mtime = (file.stat && file.stat.mtime) || e.mtime;
    this.save();
  }

  /** 'read', 'changed' — read, then changed — or 'unread'. */
  state(file) {
    const e = this.entry(file);
    if (!e || !e.read) return 'unread';
    return ((file.stat && file.stat.mtime) || 0) > e.mtime + READ_GRACE ? 'changed' : 'read';
  }

  /** Whether a note is news to you: changed since you read it, or made since the history began and not read. */
  isNew(file) {
    const state = this.state(file);
    if (state === 'changed') return true;
    if (state === 'read') return false;
    return ((file.stat && file.stat.ctime) || 0) > this.since();
  }

  /** How many of these notes are read. */
  countRead(files) {
    return files.filter((f) => f.extension === 'md' && this.state(f) === 'read').length;
  }

  /** The notes by when they were `key` ('opened' or 'read'), the latest first. */
  latest(key, limit) {
    const vault = this.app.vault;
    return Object.keys(this.log)
      .filter((p) => this.log[p][key])
      .sort((a, b) => this.log[b][key] - this.log[a][key])
      .map((p) => vault.getAbstractFileByPath(p))
      .filter((f) => f instanceof TFile)
      .slice(0, limit || 100);
  }

  /** Of these notes, the one last opened, or null. */
  lastOpened(files) {
    let best = null;
    let at = 0;
    files.forEach((f) => {
      const e = this.entry(f);
      if (e && e.opened > at) {
        at = e.opened;
        best = f;
      }
    });
    return best;
  }

  /** Only the latest kept. */
  prune() {
    const log = this.log;
    const paths = Object.keys(log);
    if (paths.length <= READING_KEEP) return;
    const when = (p) => Math.max(log[p].opened || 0, log[p].read || 0, log[p].lineAt || 0);
    paths
      .sort((a, b) => when(b) - when(a))
      .slice(READING_KEEP)
      .forEach((p) => delete log[p]);
  }

  /** Written to the plugin's data a moment after the last change, not on every one. */
  save() {
    this.version++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = 0;
      if (typeof this.plugin.saveData === 'function') this.plugin.saveData(this.plugin.settings);
    }, 1500);
  }
}

/** The plugin's reading history — made on first ask, where none was (a test's stand-in plugin). */
export function readingOf(plugin) {
  if (!plugin.reading) plugin.reading = new Reading(plugin);
  return plugin.reading;
}
