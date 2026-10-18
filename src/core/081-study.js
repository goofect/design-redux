/* ------------------------------------------------------------------ */
/* Study: the revisit schedule                                         */
/*                                                                     */
/* Notes you want to remember come back on a ladder of days: read, then */
/* due after the first; Got it climbs a rung, Again starts over. Kept   */
/* apart from the settings, in study.json in the plugin's folder: it    */
/* grows with use, and the settings file is written on every save.     */
/* Nothing goes into the notes. Kept by path, following renames.       */
/* The scheduling itself is pure, beside it, to be tested on its own.  */
/* ------------------------------------------------------------------ */

import { TFile, TFolder } from 'obsidian';

export const STUDY_FILE = 'study.json';
export const DAY = 86400000;

/* The days between revisits when the setting can't be read. */
export const STUDY_LADDER = [1, 3, 7, 21, 60];

/* How many sessions are kept, the latest. */
export const STUDY_SESSIONS = 50;

/** A new, empty store. */
export function emptyStudy() {
  return { version: 1, items: {}, sessions: [], cards: {} };
}

/** The ladder as set — "1, 3, 7, 21, 60" — as days; the default where it can't be read. */
export function studyLadder(text) {
  const days = String(text === undefined || text === null ? '' : text)
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => n > 0 && Number.isFinite(n));
  return days.length ? days : STUDY_LADDER.slice();
}

/**
 * An item after a grade: 'read' (first read: on the ladder's first
 * rung, unless it's there already), 'got' (a rung up), 'again' (back to
 * the first, due tomorrow, a lapse counted) or 'later' (a day on).
 */
export function nextDue(item, grade, ladder, now) {
  const days = ladder && ladder.length ? ladder : STUDY_LADDER;
  const top = days.length - 1;
  if (!item) {
    return { added: now, rung: 0, due: now + days[0] * DAY, last: now, grade: null, lapses: 0 };
  }
  const next = Object.assign({ rung: 0, lapses: 0 }, item);
  next.rung = Math.min(Math.max(0, next.rung || 0), top);
  if (grade === 'read') return next;
  if (grade === 'got') {
    next.rung = Math.min(next.rung + 1, top);
    next.due = now + days[next.rung] * DAY;
  } else if (grade === 'again') {
    next.rung = 0;
    next.due = now + DAY;
    next.lapses = (next.lapses || 0) + 1;
  } else if (grade === 'later') {
    next.due = now + DAY;
  } else {
    return next;
  }
  next.grade = grade;
  next.last = now;
  return next;
}

/** Midnight before `now`, local time. */
export function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * What's due now, the most overdue first, as many as the day still has
 * room for: `cap` a day, less those already graded today. [path].
 */
export function dueNow(items, now, cap) {
  const today = startOfDay(now);
  const paths = Object.keys(items || {});
  const graded = paths.filter((p) => items[p].grade && items[p].last >= today).length;
  const room = cap > 0 ? Math.max(0, cap - graded) : Infinity;
  return paths
    .filter((p) => items[p].due <= now)
    .sort((a, b) => items[a].due - items[b].due || (a < b ? -1 : 1))
    .slice(0, room);
}

/** A path moved: itself, or anything under a folder that moved. */
function moved(p, from, to) {
  if (p === from) return to;
  if (p.startsWith(from + '/')) return to + p.slice(from.length);
  // Cards are kept as note path # passage.
  if (p.startsWith(from + '#')) return to + p.slice(from.length);
  return p;
}

export class StudyStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.data = emptyStudy();
    this.loaded = false;
    this.loading = null;
    this.timer = 0;
  }

  get app() {
    return this.plugin.app;
  }

  get path() {
    const dir = this.plugin.manifest && this.plugin.manifest.dir;
    return dir ? `${dir}/${STUDY_FILE}` : STUDY_FILE;
  }

  /** Whether there's a store on disk, without making one. */
  async exists() {
    const adapter = this.app.vault.adapter;
    return !!adapter && typeof adapter.exists === 'function' && (await adapter.exists(this.path));
  }

  /**
   * Read once. A file that can't be read as a store is moved aside as
   * study.json.bad and a new one started: a broken file never breaks
   * the plugin.
   */
  load() {
    if (this.loaded) return Promise.resolve(this.data);
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const adapter = this.app.vault.adapter;
      let text = null;
      try {
        if (adapter && (await adapter.exists(this.path))) text = await adapter.read(this.path);
      } catch (err) {
        console.error('Design Redux: could not read the study file', err);
      }
      if (text !== null) {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          parsed = null;
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.items && typeof parsed.items === 'object') {
          this.data = Object.assign(emptyStudy(), parsed);
          if (!Array.isArray(this.data.sessions)) this.data.sessions = [];
          if (!this.data.cards || typeof this.data.cards !== 'object') this.data.cards = {};
        } else {
          try {
            await adapter.write(`${this.path}.bad`, text);
          } catch (err) {
            console.error('Design Redux: could not keep the broken study file', err);
          }
          this.data = emptyStudy();
          this.writeNow();
        }
      }
      this.loaded = true;
      this.loading = null;
      return this.data;
    })();
    return this.loading;
  }

  /** Written a moment after the last change, not on every one. */
  save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.writeNow();
    }, 1500);
  }

  writeNow() {
    const adapter = this.app.vault.adapter;
    if (!adapter || typeof adapter.write !== 'function') return Promise.resolve();
    return adapter.write(this.path, JSON.stringify(this.data)).catch((err) => console.error('Design Redux: could not save the study file', err));
  }

  /** Written now if a save is waiting: on unload. */
  flush() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = 0;
    this.writeNow();
  }

  item(file) {
    const path = typeof file === 'string' ? file : file && file.path;
    return (path && this.data.items[path]) || null;
  }

  /** A note graded — or read for the first time — on the ladder. */
  grade(file, grade, ladder, now = Date.now()) {
    const next = nextDue(this.item(file), grade, ladder, now);
    this.data.items[file.path] = next;
    this.save();
    return next;
  }

  remove(file) {
    if (!this.data.items[file.path]) return;
    delete this.data.items[file.path];
    this.save();
  }

  /** A session ended: kept with the latest. */
  addSession(session) {
    this.data.sessions = [session].concat(this.data.sessions || []).slice(0, STUDY_SESSIONS);
    this.save();
  }

  /** The latest session in an album, or null. */
  lastSession(folder) {
    return (this.data.sessions || []).find((s) => s.album === folder.path) || null;
  }

  /** A file or folder renamed or moved: its schedule follows. */
  followRename(file, oldPath) {
    let changed = false;
    ['items', 'cards'].forEach((key) => {
      const kept = this.data[key] || {};
      const next = {};
      Object.keys(kept).forEach((p) => {
        const to = moved(p, oldPath, file.path);
        if (to !== p) changed = true;
        next[to] = kept[p];
      });
      this.data[key] = next;
    });
    (this.data.sessions || []).forEach((s) => {
      const to = moved(s.album, oldPath, file.path);
      if (to !== s.album) {
        s.album = to;
        changed = true;
      }
    });
    if (changed) this.save();
  }

  /** A file or folder deleted: its schedule goes with it. */
  followDelete(file) {
    let changed = false;
    ['items', 'cards'].forEach((key) => {
      const kept = this.data[key] || {};
      Object.keys(kept).forEach((p) => {
        if (p === file.path || p.startsWith(file.path + '/') || p.startsWith(file.path + '#')) {
          delete kept[p];
          changed = true;
        }
      });
    });
    if (changed) this.save();
  }
}

/** The plugin's study store, made the first time it's asked for. */
export function studyOf(plugin) {
  if (!plugin.study) plugin.study = new StudyStore(plugin);
  return plugin.study;
}

/** Whether study is on and loaded: what screens check before showing any of it. */
export function studyReady(plugin) {
  return !!(plugin.settings.studyEnabled && plugin.study && plugin.study.loaded);
}

/** The studied album a note is in, however deep, or null. */
export function studiedAlbum(plugin, file) {
  const albums = plugin.settings.studyAlbums || {};
  let folder = file instanceof TFile ? file.parent : file instanceof TFolder ? file : null;
  while (folder && !(folder.isRoot && folder.isRoot())) {
    if (albums[folder.path]) return folder;
    folder = folder.parent;
  }
  return null;
}

/** The notes due now, as files, the most overdue first, within the day's cap. */
export function dueNotes(plugin, now = Date.now()) {
  if (!studyReady(plugin)) return [];
  const vault = plugin.app.vault;
  return dueNow(plugin.study.data.items, now, Number(plugin.settings.studyDailyMax) || 0)
    .map((p) => vault.getAbstractFileByPath(p))
    .filter((f) => f instanceof TFile);
}

/** Whether a note is due now. */
export function isDue(plugin, file, now = Date.now()) {
  if (!studyReady(plugin) || !file) return false;
  const item = plugin.study.item(file);
  return !!item && item.due <= now;
}
