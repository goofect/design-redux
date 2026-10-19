/* ------------------------------------------------------------------ */
/* Mind map: saving, and changes made elsewhere                        */
/*                                                                    */
/* A change is written 400 ms after it's made — straight away when the  */
/* view's closed or loses focus — and only the lines it changed. What   */
/* the view wrote it knows, so its own writes coming back aren't news.  */
/* A change made outside — the note edited as text, Sync, another      */
/* plugin — is read in: nodes keep their ids where they're the same     */
/* nodes, and changes not yet written are put again on top. One that   */
/* can't be is set aside, with a notice; nothing typed is lost.        */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { mixInto } from '../core/080-feature.js';
import { adoptIds, nodeById } from '../tree/400-tree-model.js';
import { bindSource } from '../tree/401-tree-outline.js';
import { applyPatch } from '../tree/404-tree-ops.js';
import { MindMapView } from './421-mindmap-view.js';

/* How long after a change the file's written. */
export const SAVE_PAUSE = 400;

class MindMapSaving {
  /** The file's text, read into the map: a file new to the view centres it; the same one keeps its place. */
  setViewData(data, clear) {
    // Its own write, back: nothing new. (Obsidian sets the view's `data` before this, so the text read is kept apart.)
    if (!clear && this.model && (data === this.text || data === this.lastWritten)) return;
    if (clear || !this.model) return this.readIn(data, true);
    this.outsideChange(data);
  }

  readIn(data, centre) {
    this.text = data;
    this.lastWritten = data;
    this.pending = [];
    this.undo.clear();
    try {
      const model = this.format.parse(data, this.file);
      if (this.format.id === 'md' && !model.source) bindSource(model, data);
      this.model = model;
      this.failure = null;
      if (this.selected && !nodeById(model, this.selected)) this.selected = null;
    } catch (err) {
      this.model = null;
      this.failure = err;
    }
    this.relayout(false);
    if (centre || !this.camera) this.fit(true);
    this.draw();
    if (typeof this.focusPending === 'function') this.focusPending();
    // A collection's map: in step with its notes as soon as it's open.
    if (this.model && typeof this.syncAlbum === 'function') this.albumLater();
  }

  /** The file changed outside the view: read in, with what isn't written yet put on top. */
  outsideChange(data) {
    let fresh;
    try {
      fresh = this.format.parse(data, this.file);
    } catch (err) {
      // Unreadable now: shown so, and not written over — what's unsaved here stays in memory.
      this.text = data;
      this.failure = err;
      this.draw();
      return;
    }
    adoptIds(this.model, fresh);
    const mine = this.pending.filter((p) => p.ops.length);
    const setAside = [];
    mine.forEach((p) => {
      try {
        applyPatch(fresh, p.ops, p.selection);
      } catch (err) {
        setAside.push(p);
      }
    });
    if (this.format.id === 'md') bindSource(fresh, data, { title: this.file ? this.file.basename : '' });
    this.text = data;
    this.lastWritten = data;
    this.model = fresh;
    this.failure = null;
    this.pending = mine.length > setAside.length ? [{ ops: [], inverse: [], selection: [] }] : [];
    if (!this.undo.keepWhere((id) => !!nodeById(fresh, id))) new Notice('The map changed outside this view, so Undo starts again from here.');
    if (setAside.length) {
      this.setAside = (this.setAside || []).concat(setAside);
      new Notice(`The map changed outside this view; ${setAside.length === 1 ? 'one change' : `${setAside.length} changes`} made here couldn’t be put on top of it, and ${setAside.length === 1 ? 'was' : 'were'} set aside.`);
    }
    if (this.selected && !nodeById(fresh, this.selected)) this.selected = null;
    // Typing in a node that's still there goes on; one that's gone takes its editor with it.
    if (this.editing && !nodeById(fresh, this.editing.id) && typeof this.closeEditor === 'function') this.closeEditor(false);
    this.relayout();
    this.draw();
    if (this.pending.length) this.scheduleSave();
  }

  /** Written a moment from now, once, however many changes come. */
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = 0;
      this.flushSave();
    }, SAVE_PAUSE);
  }

  /** Written now, if there's anything to write. */
  flushSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = 0;
    }
    if (!this.model || this.failure || !this.pending.length || !this.file) return null;
    const text = this.format.write(this.model, this.text, this.file);
    this.pending = [];
    if (text === this.text) return null;
    // How it was before this save, kept in its history where it's been a while.
    if (typeof this.keepHistory === 'function') this.keepHistory(this.text);
    this.text = text;
    this.lastWritten = text;
    const vault = this.app && this.app.vault;
    if (vault && typeof vault.modify === 'function') return vault.modify(this.file, text);
    if (typeof this.requestSave === 'function') this.requestSave();
    return null;
  }
}

mixInto(MindMapView, MindMapSaving);
