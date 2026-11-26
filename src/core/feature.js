/* ------------------------------------------------------------------ */
/* Feature: the shape every feature has                                */
/*                                                                     */
/* register() runs once, when the plugin loads: views, events that     */
/* must outlive a switch-off. enable() and disable() may run any       */
/* number of times; whatever enable() adds it adds through             */
/* this.add(undo), so disable() takes away exactly that. `X.key` names */
/* the setting that turns the feature on; without one it is always on. */
/* What it can do is listed once, in actions().                        */
/* ------------------------------------------------------------------ */

export class Feature {
  constructor(plugin) {
    this.plugin = plugin;
    this.on = false;
    this.undo = [];
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /** Whether its setting has it on. */
  get wanted() {
    const key = this.constructor.key;
    return !key || !!this.settings[key];
  }

  /** What it can do: [{ id, name, on, when, run }] (core/actions.js). */
  actions() {
    return [];
  }

  /** Once, as the plugin loads. */
  register() {}

  /** What turning it on does. Called through `turn()`, never directly. */
  enable() {}

  /** What turning it off does beyond undoing what `add` recorded. */
  disable() {}

  /** After any setting changed while it is on. */
  sync() {}

  /** Remembers how to take back something enable() did; returns what it was given. */
  add(undo) {
    this.undo.push(undo);
    return undo;
  }

  /** Listens on something of Obsidian's (the workspace, the vault) for as long as the feature is on; `name` may be a list. */
  listen(source, name, fn) {
    if (Array.isArray(name)) return name.map((n) => this.listen(source, n, fn));
    const ref = source.on(name, fn);
    this.add(() => source.offref(ref));
    return ref;
  }

  /** Listens on an element for as long as the feature is on. */
  listenDom(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this.add(() => target.removeEventListener(type, fn, options));
  }

  /**
   * Registers one of its views, once, in register(). Its leaves close when the feature turns
   * off, but not when Obsidian unloads the plugin: Obsidian keeps them for the next load.
   */
  registerView(type, make) {
    this.plugin.registerView(type, make);
    (this.views || (this.views = [])).push(type);
  }

  /** Keeps a place among the editors' extensions, once, in register(): `useEditor` fills it while the feature is on. */
  registerEditor() {
    this.editorSlot = [];
    this.plugin.registerEditorExtension(this.editorSlot);
  }

  /** Puts extensions in every editor for as long as the feature is on. */
  useEditor(...extensions) {
    const ws = this.app.workspace;
    const rebuild = () => typeof ws.updateOptions === 'function' && ws.updateOptions();
    this.editorSlot.push(...extensions);
    rebuild();
    this.add(() => {
      this.editorSlot.length = 0;
      rebuild();
    });
  }

  /**
   * Runs `fn` on every window's document while the feature is on: the main
   * one, the popouts already open, and each one opened after.
   */
  eachWindow(fn) {
    const seen = new Set();
    const visit = (doc) => {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      fn(doc);
    };
    const ws = this.app.workspace;
    visit(activeDocument);
    if (typeof document !== 'undefined') visit(document);
    if (typeof ws.iterateAllLeaves === 'function') ws.iterateAllLeaves((leaf) => visit(leaf.view && leaf.view.containerEl && leaf.view.containerEl.ownerDocument));
    this.listen(ws, 'window-open', (win) => visit(win && (win.doc || (win.win && win.win.document))));
    this.listen(ws, 'window-close', (win) => seen.delete(win && (win.doc || (win.win && win.win.document))));
  }

  /** Brings the feature to what its setting says. Safe to call on every save. */
  turn() {
    const want = this.wanted;
    if (want && !this.on) {
      this.on = true;
      this.enable();
    } else if (!want && this.on) {
      this.off();
    } else if (want) {
      this.sync();
    }
  }

  /** Turns it off: disable(), then everything `add` recorded, last first. */
  off() {
    if (!this.on) return;
    this.on = false;
    try {
      this.disable();
    } finally {
      this.undo.splice(0).reverse().forEach((undo) => {
        try {
          undo();
        } catch (err) {
          console.error('Design Redux: could not undo', err);
        }
      });
      if (this.views && !this.plugin.unloading) this.views.forEach((type) => this.app.workspace.detachLeavesOfType(type));
    }
  }
}
