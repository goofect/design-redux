/* ------------------------------------------------------------------ */
/* The workspace coordinator                                          */
/*                                                                    */
/* What the inspector is about, decided in one place: what's picked   */
/* in the library, a note or a collection, and the pin, which keeps   */
/* what's shown while other things are picked. A tab's note isn't     */
/* followed: its properties pop up from its own button (targetOf says */
/* what that's about). The answer is kept as a snapshot —             */
/* { target, leaf, origin, pinned } — and tells whoever listens when  */
/* it changes; they draw from it. One for the whole plugin, on        */
/* `plugin.coordinator`.                                              */
/* ------------------------------------------------------------------ */

import { MarkdownView, TFile } from 'obsidian';
import { cardElement, pickedOnCanvas } from './079-canvas-adapter.js';

/** Why the inspector shows `target`, in a few words. */
export function originLabel(origin) {
  return { picked: 'Picked in the library', card: 'A card on the canvas', note: 'The open note' }[origin] || '';
}

/** Whether two targets are about the same thing, drawn the same way. */
export const sameTarget = (a, b) =>
  a === b || (!!a && !!b && a.file === b.file && a.folder === b.folder && a.card === b.card && !!a.picked === !!b.picked);

export class WorkspaceCoordinator {
  constructor(plugin) {
    this.plugin = plugin;
    this.state = { target: null, leaf: null, origin: '', pinned: false };
    this.listeners = new Set();
  }

  get app() {
    return this.plugin.app;
  }

  /** Told of every change, with the new snapshot; returns a function to stop. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot() {
    return Object.assign({}, this.state);
  }

  /** The events it follows: picks and deletes. Once, at load. */
  listen() {
    const plugin = this.plugin;
    plugin.register(plugin.selection.onChange((item) => this.pick(item)));
    plugin.registerEvent(this.app.vault.on('delete', (file) => this.forget(file)));
  }

  /**
   * What a tab is about: its note; on a canvas, the
   * one card selected — a note's card the note, a text card itself.
   * { file } or { card }, { none: why not } or null.
   */
  targetOf(leaf) {
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    if (view instanceof MarkdownView) return view.file ? { file: view.file } : null;
    const canvas = view && view.canvas;
    if (!canvas) return null;
    const picked = pickedOnCanvas(canvas).filter((n) => n && cardElement(n) && typeof n.getData === 'function');
    if (picked.length !== 1) return { none: 'Select a card to see its properties.' };
    const node = picked[0];
    let data = {};
    try {
      data = node.getData() || {};
    } catch (err) {
      data = {};
    }
    if (data.type === 'file') {
      const file = typeof data.file === 'string' ? this.app.vault.getAbstractFileByPath(data.file) : null;
      if (file instanceof TFile && file.extension === 'md') return { file };
      return { none: 'Only notes and text cards have properties.' };
    }
    if ((data.type || 'text') === 'text' && typeof node.setText === 'function') return { card: node };
    return { none: 'Only notes and text cards have properties.' };
  }

  originOf(leaf, target) {
    if (!target) return '';
    if (target.picked || target.folder) return 'picked';
    if (target.card) return 'card';
    return 'note';
  }

  /** Picked in the library, without opening: a note or an album. */
  pick(item) {
    if (this.state.pinned) return;
    if (!item) {
      this.set({ target: null, leaf: null, origin: '', pinned: false });
      return;
    }
    if (item.file instanceof TFile && item.file.extension === 'md') this.show(null, { file: item.file, picked: true });
    else if (item.folder) this.show(null, { folder: item.folder });
  }

  /** Shown, pinned or not. */
  show(leaf, target) {
    this.set({ target, leaf, origin: this.originOf(leaf, target), pinned: this.state.pinned });
  }

  /** Pinned, it keeps what it shows; unpinned, it catches up with what's picked now. */
  pin(on) {
    const pinned = !!on && !!this.state.target;
    if (pinned === this.state.pinned) return;
    this.set(Object.assign({}, this.state, { pinned }));
    if (!pinned) this.pick(this.plugin.selection.get());
  }

  /** A deleted file or folder it shows is let go of, pinned or not. */
  forget(file) {
    const target = this.state.target;
    if (!file || !target || (target.file !== file && target.folder !== file)) return;
    this.set({ target: null, leaf: null, origin: '', pinned: false });
  }

  set(next) {
    const now = this.state;
    if (sameTarget(now.target, next.target) && now.leaf === next.leaf && now.pinned === next.pinned) return;
    this.state = next;
    const snap = this.snapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch (err) {
        console.error('Design Redux: a workspace listener failed', err);
      }
    });
  }
}
