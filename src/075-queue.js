/* ------------------------------------------------------------------ */
/* Up Next                                                             */
/*                                                                     */
/* Notes queued to read, in order. The strip's » goes to the first of  */
/* them before going on through the album, the way a player's next     */
/* goes to Up Next before the rest of what's on. Kept in settings by   */
/* path, and followed through renames, moves and deletions.            */
/* ------------------------------------------------------------------ */

class Queue {
  constructor(plugin) {
    this.plugin = plugin;
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  paths() {
    return Array.isArray(this.settings.queue) ? this.settings.queue : [];
  }

  /** The queued notes that still exist, in order. */
  files() {
    return this.paths()
      .map((p) => this.app.vault.getFileByPath(p))
      .filter(Boolean);
  }

  has(file) {
    return !!file && this.paths().indexOf(file.path) !== -1;
  }

  /** The first queued note, passing over `except` — the one already open. */
  peek(except) {
    return this.files().find((f) => f !== except) || null;
  }

  /**
   * Queue notes: at the front, to be read next, or at the end. A note
   * already queued moves rather than being there twice.
   */
  add(files, next) {
    const adding = files
      .filter((f) => f instanceof TFile)
      .map((f) => f.path)
      .filter((p, i, all) => all.indexOf(p) === i);
    if (!adding.length) return 0;
    const rest = this.paths().filter((p) => adding.indexOf(p) === -1);
    this.set(next ? adding.concat(rest) : rest.concat(adding));
    return adding.length;
  }

  remove(file) {
    if (!this.has(file)) return;
    this.set(this.paths().filter((p) => p !== file.path));
  }

  clear() {
    if (this.paths().length) this.set([]);
  }

  set(paths) {
    this.settings.queue = paths.slice();
    this.plugin.saveData(this.settings);
    const upNext = this.plugin.feature(UpNext);
    if (upNext) upNext.refresh();
  }

  followRename(file, oldPath) {
    const paths = this.paths();
    const moved = paths.map((p) => movedPath(p, oldPath, file.path));
    if (moved.some((p, i) => p !== paths[i])) this.set(moved);
  }

  followDelete(file) {
    const paths = this.paths();
    const kept = paths.filter((p) => p !== file.path && !p.startsWith(file.path + '/'));
    if (kept.length !== paths.length) this.set(kept);
  }
}
