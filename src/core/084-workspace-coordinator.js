/* ------------------------------------------------------------------ */
/* The workspace coordinator                                          */
/*                                                                    */
/* What the inspector is about, decided in one place. What's open in  */
/* a tab, what's picked in the library, a card on a canvas, a node of */
/* a map: each can say what to show, and the pin says whether any of  */
/* them may. The coordinator keeps the answer as a snapshot —          */
/* { target, leaf, origin, pinned } — and tells whoever listens when  */
/* it changes; they draw from it. One for the whole plugin, on        */
/* `plugin.coordinator`.                                              */
/* ------------------------------------------------------------------ */

import { MarkdownView, TFile } from 'obsidian';
import { INSPECTOR_VIEW } from './020-constants.js';
import { cardElement, pickedOnCanvas } from './079-canvas-adapter.js';

/** A view of a note's own kind — a mind map — that says what the inspector is about. */
export function hostsPanel(view) {
  return !!view && typeof view.panelTarget === 'function';
}

/** Why the inspector shows `target`, in a few words. */
export function originLabel(origin) {
  return { picked: 'Picked in the library', card: 'A card on the canvas', map: 'The open map', note: 'The open note' }[origin] || '';
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

  /** The events it follows: tabs, notes opening, picks, canvases, deletes. Once, at load. */
  listen() {
    const plugin = this.plugin;
    const ws = this.app.workspace;
    plugin.registerEvent(ws.on('active-leaf-change', (leaf) => this.look(leaf)));
    // A tab that loads another note: active-leaf-change doesn't cover it.
    plugin.registerEvent(ws.on('file-open', () => this.look(ws.activeLeaf)));
    plugin.register(plugin.selection.onChange((item) => this.pick(item)));
    plugin.registerEvent(this.app.vault.on('delete', (file) => this.forget(file)));
    // A card picked on a canvas says nothing, so a click or a key there is looked at once it's done.
    const onCanvas = (evt) => {
      if (!this.listeners.size) return;
      const leaf = ws.activeLeaf;
      const view = leaf && !leaf.isDeferred ? leaf.view : null;
      const el = evt.target;
      if (!view || !view.canvas || !el || el.nodeType !== 1 || !view.containerEl.contains(el)) return;
      window.setTimeout(() => this.look(leaf), 0);
    };
    const listenIn = (doc) => {
      plugin.registerDomEvent(doc, 'pointerup', onCanvas);
      plugin.registerDomEvent(doc, 'keyup', onCanvas);
    };
    listenIn(document);
    // A canvas in a window of its own is listened to there.
    plugin.registerEvent(
      ws.on('window-open', (workspaceWindow, win) => {
        const doc = (win && win.document) || (workspaceWindow && workspaceWindow.doc);
        if (doc && doc !== document) listenIn(doc);
      })
    );
  }

  /**
   * What a tab is about: its note; a map's own answer; on a canvas, the
   * one card selected — a note's card the note, a text card itself.
   * { file } or { card }, { none: why not } or null.
   */
  targetOf(leaf) {
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    if (view instanceof MarkdownView) return view.file ? { file: view.file } : null;
    if (hostsPanel(view)) return view.panelTarget();
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
    if (leaf && hostsPanel(leaf.view)) return 'map';
    return 'note';
  }

  /**
   * A tab worked in: what it's about, unless pinned. The inspector's own
   * tab, and a tab with nothing to show, leave it as it was. The snapshot.
   */
  look(leaf) {
    if (this.state.pinned || !leaf || this.isInspector(leaf)) return this.snapshot();
    const target = this.targetOf(leaf);
    if (target && !target.none) this.show(leaf, target);
    return this.snapshot();
  }

  /** Picked in the library, without opening: a note or an album. */
  pick(item) {
    if (this.state.pinned || !item) return;
    if (item.file instanceof TFile && item.file.extension === 'md') this.show(null, { file: item.file, picked: true });
    else if (item.folder) this.show(null, { folder: item.folder });
  }

  /** Asked for outright — the Properties button — so shown, pinned or not. */
  show(leaf, target) {
    this.set({ target, leaf, origin: this.originOf(leaf, target), pinned: this.state.pinned });
  }

  /** Pinned, it keeps what it shows; unpinned, it catches up with the tab last worked in. */
  pin(on) {
    const pinned = !!on && !!this.state.target;
    if (pinned === this.state.pinned) return;
    this.set(Object.assign({}, this.state, { pinned }));
    if (!pinned) {
      const ws = this.app.workspace;
      this.look(typeof ws.getMostRecentLeaf === 'function' ? ws.getMostRecentLeaf() : ws.activeLeaf);
    }
  }

  /** A deleted file or folder it shows is let go of, pinned or not. */
  forget(file) {
    const target = this.state.target;
    if (!file || !target || (target.file !== file && target.folder !== file)) return;
    this.set({ target: null, leaf: null, origin: '', pinned: false });
  }

  isInspector(leaf) {
    return !!leaf.view && typeof leaf.view.getViewType === 'function' && leaf.view.getViewType() === INSPECTOR_VIEW;
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
