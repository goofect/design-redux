/* ------------------------------------------------------------------ */
/* Selection                                                          */
/*                                                                    */
/* What's picked — a note, an album, a card on a canvas — apart from  */
/* what's open, so it can be looked at without being opened. One for */
/* the whole plugin, on `plugin.selection`.                           */
/* ------------------------------------------------------------------ */

class Selection {
  constructor(plugin) {
    this.plugin = plugin;
    this.item = null;
    this.listeners = new Set();
    // Whatever shows the selection says whether it's showing now: while
    // one is, a single click picks rather than opens.
    this.viewers = new Set();
  }

  /** Told of every change, with the new item; returns a function to stop. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** { file } | { folder } | { card } | null. */
  get() {
    return this.item;
  }

  set(item) {
    const next = item && (item.file || item.folder || item.card) ? item : null;
    const now = this.item;
    if (now === next || (now && next && now.file === next.file && now.folder === next.folder && now.card === next.card)) return;
    this.item = next;
    this.listeners.forEach((fn) => {
      try {
        fn(next);
      } catch (err) {
        console.error('Design Redux: a selection listener failed', err);
      }
    });
  }

  clear() {
    this.set(null);
  }

  /** Whether `target` — a file or a folder — is what's picked. */
  holds(target) {
    const item = this.item;
    return !!item && !!target && (item.file === target || item.folder === target);
  }

  /** A deleted note or album is no longer picked. Renamed, it still is: the same file. */
  followDelete(file) {
    if (this.holds(file)) this.clear();
  }

  /** `isShown()` for something that shows the selection; returns a function to take it away. */
  addViewer(isShown) {
    this.viewers.add(isShown);
    return () => this.viewers.delete(isShown);
  }

  /** Whether a single click picks: always, never, or — the default — while the selection is showing somewhere. */
  clickPicks() {
    const how = this.plugin.settings.inspectorClick || 'shown';
    if (how === 'always') return true;
    if (how === 'never') return false;
    return Array.from(this.viewers).some((shown) => {
      try {
        return !!shown();
      } catch (err) {
        return false;
      }
    });
  }
}
