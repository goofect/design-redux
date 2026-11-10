/* ------------------------------------------------------------------ */
/* The note header's back and forward, out of the folder and in       */
/*                                                                    */
/* The way out of a collection is Obsidian's own ← in a note's        */
/* header: while this tab showed a note outside this note's folder,   */
/* ← goes back to the last such one ("Back to …"), and → right after  */
/* comes back to where ← left ("Forward to …"). Otherwise they're     */
/* Obsidian's, as are the keys and the commands: one step back and    */
/* forward. Previous and next inside the collection are the strip's,  */
/* the note page's and the commands'.                                 */
/*                                                                    */
/* The arrows are Obsidian's DOM, not an API: found behind checks,    */
/* taken by a click in the capture phase only while there's a way out */
/* to take; not found, and they stay as they are.                     */
/*                                                                    */
/* Each tab keeps its own short history of notes, kept here (not      */
/* Obsidian's own): a note at the vault's root is in the root folder, */
/* so ← from it goes to the last note in any folder.                  */
/* ------------------------------------------------------------------ */

import { MarkdownView } from 'obsidian';
import { openInPage } from '../core/070-orders.js';
import { Feature } from '../core/080-feature.js';

const HISTORY_CAP = 50;

const folderOf = (file) => (file && file.parent ? file.parent.path : '/');

export class HeaderSkip extends Feature {
  constructor(plugin) {
    super(plugin);
    // leaf -> its header's arrows, taken over: { nav, back, forward, onClick, taken }. Weak, so closing a tab drops it.
    this.fitted = new WeakMap();
    // leaf -> { notes, forward, pending, from }: the tab's notes, oldest first; where → goes; a jump of
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
    // The plugin unloaded: the arrows are Obsidian's again.
    if (typeof this.plugin.register === 'function') this.plugin.register(() => this.clear());
  }

  enable() {
    this.sync();
  }

  disable() {
    this.clear();
  }

  /** Every tab's, a window of its own's too. */
  clear() {
    this.app.workspace.iterateAllLeaves((leaf) => this.unfit(leaf));
    this.fitted = new WeakMap();
  }

  sync() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred || !(leaf.view instanceof MarkdownView)) {
        this.unfit(leaf);
        return;
      }
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

  /** Where ← goes: the latest note before this one whose folder isn't this one's, as an index into the history. */
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

  /**
   * The header's own back and forward: its two buttons, a listener on them
   * once (capture phase, so it's ahead of Obsidian's), ours only while
   * there's a way out to take. Not found, null, and they stay Obsidian's.
   */
  arrows(leaf) {
    const nav = leaf.containerEl ? leaf.containerEl.querySelector('.view-header .view-header-nav-buttons') : null;
    let arrows = this.fitted.get(leaf);
    if (arrows && arrows.nav === nav) return arrows;
    this.unfit(leaf);
    const buttons = nav ? Array.from(nav.children).filter((el) => el.tagName === 'BUTTON') : [];
    if (buttons.length !== 2) return null;
    const [back, forward] = buttons;
    arrows = { nav, back, forward, taken: {} };
    arrows.onClick = (evt) => {
      const which = back.contains(evt.target) ? 'back' : forward.contains(evt.target) ? 'forward' : null;
      if (!which || !(leaf.view instanceof MarkdownView)) return;
      if (which === 'back' ? this.backIndex(leaf) === -1 : !this.exists(this.history(leaf).forward)) return;
      evt.preventDefault();
      evt.stopPropagation();
      if (which === 'back') this.backOut(leaf);
      else this.forwardOut(leaf);
    };
    nav.addEventListener('click', arrows.onClick, true);
    this.fitted.set(leaf, arrows);
    return arrows;
  }

  /** An arrow named for where it goes — or, with no text, Obsidian's again. */
  label(leaf, arrows, which, text) {
    const el = arrows[which];
    const was = arrows.taken[which];
    if (text) {
      if (!was) arrows.taken[which] = { label: el.getAttribute('aria-label'), disabled: el.getAttribute('aria-disabled') };
      el.setAttribute('aria-label', text);
      // Obsidian greys an arrow with no step of its own; this one has one of ours.
      el.setAttribute('aria-disabled', 'false');
      return;
    }
    if (!was) return;
    delete arrows.taken[which];
    if (was.label === null) el.removeAttribute('aria-label');
    else el.setAttribute('aria-label', was.label);
    // Greyed as Obsidian would now: by its own history, where it can be read.
    const history = leaf.history;
    const steps = history ? (which === 'back' ? history.backHistory : history.forwardHistory) : null;
    const disabled = Array.isArray(steps) ? String(steps.length === 0) : was.disabled;
    if (disabled === null) el.removeAttribute('aria-disabled');
    else el.setAttribute('aria-disabled', disabled);
  }

  /** The arrows Obsidian's again: their labels back, the listener gone. */
  unfit(leaf) {
    const arrows = this.fitted.get(leaf);
    if (!arrows) return;
    arrows.nav.removeEventListener('click', arrows.onClick, true);
    this.label(leaf, arrows, 'back', null);
    this.label(leaf, arrows, 'forward', null);
    this.fitted.delete(leaf);
  }

  fit(leaf) {
    const arrows = this.arrows(leaf);
    if (!arrows) return;
    const h = this.history(leaf);
    const at = this.backIndex(leaf);
    this.label(leaf, arrows, 'back', at !== -1 ? `Back to ${h.notes[at].basename}` : null);
    this.label(leaf, arrows, 'forward', this.exists(h.forward) ? `Forward to ${h.forward.basename}` : null);
  }
}
