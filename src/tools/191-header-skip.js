/* ------------------------------------------------------------------ */
/* « » in the note's header                                           */
/*                                                                    */
/* The way out of a collection, beside back and forward: « goes back, */
/* in this tab, to the last note it showed outside this note's        */
/* folder, and » comes back to where « left. Previous and next inside */
/* the collection are the strip's, the note page's and the commands', */
/* so these show whether the strip is up or not.                      */
/*                                                                    */
/* Each tab keeps its own short history of notes, kept here (not      */
/* Obsidian's own): a note at the vault's root is in the root folder, */
/* so « from it goes to the last note in any folder.                  */
/* ------------------------------------------------------------------ */

import { MarkdownView } from 'obsidian';
import { makeTrigger } from '../core/042-controls.js';
import { openInPage } from '../core/070-orders.js';
import { Feature } from '../core/080-feature.js';

const HISTORY_CAP = 50;

const folderOf = (file) => (file && file.parent ? file.parent.path : '/');

export class HeaderSkip extends Feature {
  constructor(plugin) {
    super(plugin);
    // leaf -> its pair of buttons. Weak, so closing a tab drops it.
    this.fitted = new WeakMap();
    // leaf -> { notes, forward, pending, from }: the tab's notes, oldest first; where » goes; a jump of
    // ours on its way (to pending, from the note it left), which isn't a new step.
    this.histories = new WeakMap();
  }

  register() {
    // Another note in the same tab: one more step in its history, and other ways out.
    this.plugin.registerEvent(this.app.workspace.on('file-open', () => this.sync()));
    this.plugin.registerEvent(this.app.workspace.on('active-leaf-change', () => this.sync()));
    // A note renamed or gone: the labels and where they lead follow.
    this.plugin.registerEvent(this.app.vault.on('rename', () => this.sync()));
    this.plugin.registerEvent(this.app.vault.on('delete', () => this.sync()));
  }

  enable() {
    this.sync();
  }

  disable() {
    this.clear();
  }

  /** Every tab's, a window of its own's too. */
  clear() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.containerEl) leaf.containerEl.querySelectorAll('.dr-header-skip').forEach((el) => el.remove());
    });
    this.fitted = new WeakMap();
  }

  sync() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred || !(leaf.view instanceof MarkdownView)) return;
      this.record(leaf);
      this.fit(leaf);
    });
  }

  history(leaf) {
    let h = this.histories.get(leaf);
    if (!h) {
      h = { notes: [], forward: null, pending: null, from: null };
      this.histories.set(leaf, h);
    }
    return h;
  }

  /** The tab's note, as the latest step of its history — unless a jump of ours is still on its way there. */
  record(leaf) {
    const file = leaf.view.file;
    if (!file) return;
    const h = this.history(leaf);
    if (h.pending) {
      // Not there yet; anything else than the jump's two ends, and it's over.
      if (file === h.from) return;
      h.pending = null;
    }
    if (h.notes[h.notes.length - 1] === file) return;
    this.push(h, file);
    // Somewhere new: the way forward is gone, as in a browser.
    h.forward = null;
  }

  push(h, file) {
    h.notes.push(file);
    if (h.notes.length > HISTORY_CAP) h.notes.splice(0, h.notes.length - HISTORY_CAP);
  }

  /**
   * Opens a note of the history in its tab, as one jump of ours: on its way, it's
   * not a new step; once it's there — or it isn't, landing elsewhere than a note
   * or failing — the tab records and draws as usual again.
   */
  jump(leaf, target) {
    const h = this.history(leaf);
    h.pending = target;
    const settle = () => {
      if (h.pending === target) h.pending = null;
      if (leaf.view instanceof MarkdownView) {
        this.record(leaf);
        this.fit(leaf);
      }
    };
    let done;
    try {
      done = leaf.openFile(target);
    } catch (e) {
      done = Promise.reject(e);
    }
    Promise.resolve(done).then(settle, settle);
    this.fit(leaf);
  }

  /** Still in the vault, as it was. */
  exists(file) {
    return !!file && this.app.vault.getAbstractFileByPath(file.path) === file;
  }

  /** Where « goes: the latest note before this one whose folder isn't this one's, as an index into the history. */
  backIndex(leaf) {
    const h = this.history(leaf);
    const file = h.pending || leaf.view.file;
    if (!file) return -1;
    const notes = h.notes;
    const here = folderOf(file);
    for (let i = notes.length - 2; i >= 0; i--) {
      if (folderOf(notes[i]) !== here && this.exists(notes[i])) return i;
    }
    return -1;
  }

  pinned(leaf) {
    const state = typeof leaf.getViewState === 'function' ? leaf.getViewState() : null;
    return !!(state && state.pinned);
  }

  backOut(leaf) {
    const at = this.backIndex(leaf);
    if (at === -1) return false;
    const h = this.history(leaf);
    const target = h.notes[at];
    // A pinned tab stays as it is: the note opens in a new one, which has a history of its own.
    if (this.pinned(leaf)) return openInPage(this.plugin, target, leaf);
    h.forward = h.from = leaf.view.file;
    h.notes.length = at + 1;
    this.jump(leaf, target);
    return true;
  }

  forwardOut(leaf) {
    const h = this.history(leaf);
    const target = h.forward;
    if (!this.exists(target)) return false;
    if (this.pinned(leaf)) return openInPage(this.plugin, target, leaf);
    h.from = leaf.view.file;
    h.forward = null;
    this.push(h, target);
    this.jump(leaf, target);
    return true;
  }

  fit(leaf) {
    const header = leaf.containerEl.querySelector('.view-header');
    const left = header && header.querySelector('.view-header-left');
    if (!left) return;
    let box = this.fitted.get(leaf);
    if (!box || !box.isConnected) {
      box = left.createDiv({ cls: 'dr-header-skip' });
      this.fitted.set(leaf, box);
    }
    box.empty();
    const h = this.history(leaf);
    const at = this.backIndex(leaf);
    if (at !== -1) {
      box.appendChild(makeTrigger('dr-header-skip-btn', `Back to ${h.notes[at].basename}`, 'chevrons-left', () => this.backOut(leaf)));
    }
    if (this.exists(h.forward)) {
      box.appendChild(makeTrigger('dr-header-skip-btn', `Forward to ${h.forward.basename}`, 'chevrons-right', () => this.forwardOut(leaf)));
    }
    box.toggleClass('is-hidden', !box.childElementCount);
  }
}
