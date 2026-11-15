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

  /** What it can do: [{ id, name, glyph, on, when, run }] (core/actions.js). */
  actions() {
    return [];
  }

  /** Its rows on the settings page: [{ key, name, desc, type, options }]; the first is its switch. */
  settingsRows() {
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

  /** Listens on something of Obsidian's (the workspace, the vault) for as long as the feature is on. */
  listen(source, name, fn) {
    const ref = source.on(name, fn);
    this.add(() => source.offref(ref));
    return ref;
  }

  /** Listens on an element for as long as the feature is on. */
  listenDom(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this.add(() => target.removeEventListener(type, fn, options));
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
    }
  }
}
