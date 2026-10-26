/* ------------------------------------------------------------------ */
/* Notes ticked together                                              */
/*                                                                    */
/* What's ticked while editing an album, apart from what's open and   */
/* from the one thing picked (plugin.selection): paths, and the last  */
/* one ticked, from which Shift ticks a run. It follows renames and   */
/* lets go of what's deleted, so the ticks stay on the notes and not  */
/* on paths that are gone. Only state: the browse view draws it.      */
/* ------------------------------------------------------------------ */

export class BulkSelection {
  constructor() {
    this.paths = new Set();
    this.anchor = null;
  }

  get size() {
    return this.paths.size;
  }

  has(path) {
    return this.paths.has(path);
  }

  /**
   * Ticks a path, or unticks it. Given the paths in the order they're
   * shown, and with one ticked before among them, it does the whole run
   * between that one and this. Returns the paths it changed.
   */
  set(path, on, { range } = {}) {
    const from = range && this.anchor !== null ? range.indexOf(this.anchor) : -1;
    const to = range ? range.indexOf(path) : -1;
    const run = from !== -1 && to !== -1 ? range.slice(Math.min(from, to), Math.max(from, to) + 1) : [path];
    run.forEach((p) => (on ? this.paths.add(p) : this.paths.delete(p)));
    this.anchor = path;
    return run;
  }

  clear() {
    this.paths.clear();
    this.anchor = null;
  }

  /** A note or a folder renamed: what was ticked at the old path, or inside it, is ticked at the new. */
  rename(oldPath, newPath) {
    const moved = (p) => (p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : null);
    const next = new Set();
    this.paths.forEach((p) => next.add(moved(p) || p));
    this.paths = next;
    if (this.anchor !== null) this.anchor = moved(this.anchor) || this.anchor;
  }

  /** A note or a folder deleted: what was ticked there is let go. */
  remove(path) {
    const gone = (p) => p === path || p.startsWith(`${path}/`);
    Array.from(this.paths).forEach((p) => gone(p) && this.paths.delete(p));
    if (this.anchor !== null && gone(this.anchor)) this.anchor = null;
  }
}
