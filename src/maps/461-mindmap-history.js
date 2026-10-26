/* ------------------------------------------------------------------ */
/* Mind map: its history                                                */
/*                                                                    */
/* Before a save after a pause of a couple of minutes, the map as it   */
/* was is kept: the last so many a map, kept by the plugin, by path,   */
/* under a size for them all, the oldest let go first. Map history     */
/* lists them, to compare the map with one or to put one back — one    */
/* step of Undo, like any change.                                       */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { ChoicePicker } from '../ui/230-pickers.js';
import { adoptIds } from '../tree/400-tree-model.js';
import { replaceMap } from '../tree/404-tree-ops.js';

export const MAP_HISTORY = 'mindmap-history.json';
/* A save this long after the last one kept starts a new one. */
export const HISTORY_GAP = 2 * 60 * 1000;
/* What every map's history may come to, all told, in characters. */
export const HISTORY_CAP = 4 * 1024 * 1024;

/**
 * A history with one more state kept: { path: [{ at, text }] } — oldest
 * first, `limit` a map, under `cap` characters in all, the oldest
 * anywhere let go first. Nothing kept within `gap` of the last, nor the
 * same text twice running.
 */
export function withHistory(all, path, text, at, opts = {}) {
  const limit = opts.limit === undefined ? 20 : opts.limit;
  const cap = opts.cap || HISTORY_CAP;
  const gap = opts.gap === undefined ? HISTORY_GAP : opts.gap;
  const next = Object.assign({}, all);
  const list = (next[path] || []).slice();
  const last = list[list.length - 1];
  if (!limit || (last && (at - last.at < gap || last.text === text))) return all;
  list.push({ at, text });
  while (list.length > limit) list.shift();
  next[path] = list;
  let size = Object.keys(next).reduce((n, p) => n + next[p].reduce((m, e) => m + e.text.length, 0), 0);
  while (size > cap) {
    let oldest = null;
    Object.keys(next).forEach((p) => {
      const e = next[p][0];
      if (e && (!oldest || e.at < oldest.at)) oldest = { p, at: e.at };
    });
    if (!oldest) break;
    size -= next[oldest.p].shift().text.length;
    if (!next[oldest.p].length) delete next[oldest.p];
  }
  return next;
}

/** Where the plugin keeps history, and reading and writing it, one write at a time. */
function historyFile(plugin) {
  const dir = plugin && plugin.manifest && plugin.manifest.dir;
  return dir ? `${dir}/${MAP_HISTORY}` : null;
}

async function readAll(app, plugin) {
  const at = historyFile(plugin);
  const adapter = app && app.vault && app.vault.adapter;
  if (!at || !adapter) return {};
  try {
    return (await adapter.exists(at)) ? JSON.parse(await adapter.read(at)) || {} : {};
  } catch (err) {
    return {};
  }
}

let writing = Promise.resolve();

/** History changed, one change after another: none written over by one begun before it ended. */
function changeAll(app, plugin, change) {
  const at = historyFile(plugin);
  const adapter = app && app.vault && app.vault.adapter;
  if (!at || !adapter) return Promise.resolve();
  writing = writing
    .then(async () => {
      const all = await readAll(app, plugin);
      const next = change(all);
      if (next !== all) await adapter.write(at, JSON.stringify(next));
    })
    .catch((err) => console.error('Design Redux: could not keep the map’s history', err));
  return writing;
}

export class MindMapHistory {
  historyOn() {
    return !!this.plugin && (this.plugin.settings.mindmapHistory === undefined ? 20 : Number(this.plugin.settings.mindmapHistory)) > 0;
  }

  /** The map as it was before this save kept, where it's been a while since the last. */
  keepHistory(before) {
    if (!this.historyOn() || !this.file || !before) return null;
    const path = this.file.path;
    const limit = Number(this.plugin.settings.mindmapHistory === undefined ? 20 : this.plugin.settings.mindmapHistory);
    return changeAll(this.app, this.plugin, (all) => withHistory(all, path, before, Date.now(), { limit }));
  }

  /** The states kept, newest first, to compare with or put back. */
  async chooseHistory(put) {
    if (!this.file) return;
    const list = ((await readAll(this.app, this.plugin))[this.file.path] || []).slice().reverse();
    if (!list.length) {
      new Notice('Nothing kept yet: the map is kept as it was before a save, a couple of minutes after the last.');
      return;
    }
    const items = list.map((e) => ({ label: new Date(e.at).toLocaleString(), note: `${e.text.split('\n').filter((l) => /^\s*[-*+]/.test(l)).length} lines`, e }));
    new ChoicePicker(this.app, put ? 'Put the map back as it was…' : 'Compare the map with how it was…', items, (item) => {
      if (put) this.putBack(item.e.text);
      else if (typeof this.compareWithText === 'function') this.compareWithText(item.e.text, this.file, new Date(item.e.at).toLocaleString());
    }).open();
  }

  /** The map as it was, put back: one step of Undo. */
  putBack(text) {
    let then;
    try {
      then = this.format.parse(text, this.file);
    } catch (err) {
      new Notice('That state of the map can’t be read.');
      return;
    }
    // The same nodes keep their ids, so Undo and the kept views still find them.
    adoptIds(this.model, then);
    this.apply(replaceMap(this.model, then));
    new Notice('The map is back as it was. Undo puts it as it is now.');
  }
}

export class MindMapsHistory {
  /** A map's history, moved with it to its new path. */
  moveHistory(from, to) {
    return changeAll(this.app, this.plugin, (all) => {
      if (!all[from]) return all;
      const next = Object.assign({}, all);
      next[to] = next[from];
      delete next[from];
      return next;
    });
  }
}
