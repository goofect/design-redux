/* ------------------------------------------------------------------ */
/* What the canvas features share                                      */
/*                                                                     */
/* Each open canvas is watched while it's open: cards are drawn as they */
/* come into view and the bar above a selection is rebuilt as it        */
/* changes, so a feature looks its canvas over again whenever the       */
/* canvas redraws — once a frame at most. The canvas's own menus, which */
/* it announces for plugins, get the feature's entries.                 */
/*                                                                     */
/* The canvas's insides aren't public: they're asked carefully.         */
/* ------------------------------------------------------------------ */

class CanvasFeature extends Feature {
  constructor(plugin) {
    super(plugin);
    this.watched = new Map();
  }

  register() {
    const ws = this.app.workspace;
    this.plugin.registerEvent(
      ws.on('canvas:node-menu', (menu, node) => {
        if (this.enabled && node) this.addMenuItems(menu, [node]);
      })
    );
    this.plugin.registerEvent(
      ws.on('canvas:selection-menu', (menu, canvas) => {
        if (this.enabled && canvas) this.addMenuItems(menu, Array.from(canvas.selection || []));
      })
    );
    this.plugin.registerEvent(ws.on('file-open', () => this.plugin.queueSync()));
  }

  enable() {
    this.sync();
  }

  disable() {
    Array.from(this.watched.keys()).forEach((view) => this.unwatch(view));
  }

  sync() {
    this.watched.forEach((state, view) => {
      if (!view.contentEl || !view.contentEl.isConnected || view.file !== state.file) this.unwatch(view);
    });
    this.app.workspace.getLeavesOfType('canvas').forEach((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (view && view.file && view.contentEl && view.canvas && !this.watched.has(view)) this.watch(view);
    });
  }

  /** The canvas of the page in use, if it is one. */
  pageCanvas() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && view.canvas && view.file && view.file.extension === 'canvas' ? view : null;
  }

  /** The cards selected on a canvas. */
  selectedNodes(view) {
    try {
      return view ? Array.from(view.canvas.selection || []) : [];
    } catch (err) {
      return [];
    }
  }

  /** Every card on a canvas. */
  allNodes(view) {
    try {
      return view && view.canvas && view.canvas.nodes ? Array.from(view.canvas.nodes.values()) : [];
    } catch (err) {
      return [];
    }
  }

  watch(view) {
    const state = { file: view.file, frame: 0, observer: null };
    this.watched.set(view, state);
    const pass = () => {
      state.frame = 0;
      if (this.watched.get(view) === state) this.pass(view, state);
    };
    if (typeof MutationObserver === 'function') {
      state.observer = new MutationObserver(() => {
        if (!state.frame) state.frame = window.requestAnimationFrame(pass);
      });
      state.observer.observe(view.contentEl, { childList: true, subtree: true });
    }
    this.mount(view, state);
    pass();
  }

  unwatch(view) {
    const state = this.watched.get(view);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.frame) window.cancelAnimationFrame(state.frame);
    this.watched.delete(view);
    if (view.contentEl) this.cleanup(view, state);
  }

  /** Once, when a canvas is first watched. */
  mount() {}

  /** Each time the canvas redraws. */
  pass() {}

  /** When it's let go: what was added to it, taken away. */
  cleanup() {}

  /** Entries for the canvas's own menus, for these cards. */
  addMenuItems() {}
}
