/* ------------------------------------------------------------------ */
/* Notes: their properties, read and written one way                    */
/*                                                                      */
/* Read as Obsidian has them, without its bookkeeping. Written through  */
/* its own processFrontMatter, saying what changed, key by key, so an   */
/* Undo can put back only what is still as the change left it: a value */
/* edited since is kept, and the notice says so.                        */
/* ------------------------------------------------------------------ */

/** Whether two property values are the same data. */
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A copy of a value as properties hold it: plain data. */
const copyValue = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The keys in `order` first, as they were, then any others: the order a note's properties are shown in. */
function orderKeys(fm, order) {
  const keys = Object.keys(fm).filter((k) => k !== 'position');
  const sorted = order.filter((k) => keys.indexOf(k) !== -1).concat(keys.filter((k) => order.indexOf(k) === -1));
  const entries = sorted.map((k) => [k, fm[k]]);
  keys.forEach((k) => delete fm[k]);
  entries.forEach(([k, v]) => (fm[k] = v));
}

class Notes {
  constructor(plugin) {
    this.plugin = plugin;
  }

  get app() {
    return this.plugin.app;
  }

  /** A note's properties as Obsidian read them, without its own bookkeeping. */
  props(file) {
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    const fm = (cache && cache.frontmatter) || {};
    const out = {};
    Object.keys(fm).forEach((k) => {
      if (k !== 'position') out[k] = fm[k];
    });
    return out;
  }

  /** One property by name, whatever case the note writes it in. */
  get(file, key) {
    return fmGet(this.props(file), key);
  }

  /**
   * A note's properties changed by `change(fm)`, written as Obsidian
   * writes them. What changed comes back, { file, before, after, order }
   * by key — or null if it couldn't be written, said in a notice
   * (`failure`, or false for none). With `undo`, a notice offers Undo
   * (`onUndo` runs after it).
   */
  async write(file, change, opts = {}) {
    let record = null;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const order = Object.keys(fm).filter((k) => k !== 'position');
        const was = {};
        order.forEach((k) => (was[k] = copyValue(fm[k])));
        change(fm);
        const before = {};
        const after = {};
        new Set(order.concat(Object.keys(fm))).forEach((k) => {
          if (k === 'position' || sameValue(was[k], fm[k])) return;
          before[k] = was[k];
          after[k] = copyValue(fm[k]);
        });
        record = { file, before, after, order };
      });
    } catch (err) {
      console.error('Design Redux: frontmatter write failed', err);
      if (opts.failure !== false) new Notice(opts.failure || 'Could not update the properties.');
      return null;
    }
    // Written, though nothing was asked of the change (as a stand-in for Obsidian may do): nothing changed.
    if (!record) record = { file, before: {}, after: {}, order: [] };
    if (opts.undo && Object.keys(record.before).length) this.offerUndo(opts.undo, [record], opts.onUndo);
    return record;
  }

  /** Undo for changes already written: one notice, one step, for all of them. */
  offerUndo(message, records, onUndo) {
    const kept = records.filter((r) => r && Object.keys(r.before).length);
    if (!kept.length || typeof this.plugin.offerUndo !== 'function') return null;
    return this.plugin.offerUndo(message, async () => {
      await this.undo(kept);
      if (onUndo) onUndo();
    });
  }

  /**
   * Each change put back, key by key, where the value is still what the
   * change left: one edited since is kept. A key put back where it had
   * gone takes its old place. How many were kept comes back, and a
   * notice says so.
   */
  async undo(records) {
    let kept = 0;
    for (const r of records) {
      try {
        await this.app.fileManager.processFrontMatter(r.file, (fm) => {
          let returned = false;
          Object.keys(r.before).forEach((k) => {
            if (!sameValue(fm[k], r.after[k])) {
              kept++;
              return;
            }
            if (r.before[k] === undefined) delete fm[k];
            else {
              if (fm[k] === undefined) returned = true;
              fm[k] = copyValue(r.before[k]);
            }
          });
          if (returned) orderKeys(fm, r.order);
        });
      } catch (err) {
        console.error('Design Redux: undo failed', err);
        new Notice(`Could not undo the change to ${r.file.basename}.`);
      }
    }
    if (kept) new Notice(`${bulkCount(kept, 'property', 'properties')} changed since ${kept === 1 ? 'was' : 'were'} kept as ${kept === 1 ? 'it is' : 'they are'}.`);
    return kept;
  }
}
