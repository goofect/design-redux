/* ------------------------------------------------------------------ */
/* Notes: a note's properties, read and written one way                */
/*                                                                     */
/* Reading is from Obsidian's cache. Writing goes through              */
/* processFrontMatter, here and nowhere else, and returns a record of  */
/* what changed; undoing a record puts back only the values that are   */
/* still as the write left them, so an edit made since is kept.        */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';

export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const copyValue = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** A note's properties as Obsidian has them cached. */
export function noteProps(app, file) {
  const cache = file ? app.metadataCache.getFileCache(file) : null;
  const fm = (cache && cache.frontmatter) || {};
  const out = {};
  Object.keys(fm).forEach((k) => {
    if (k !== 'position') out[k] = fm[k];
  });
  return out;
}

/** Every property name the notes have, most used first: [[name, count]]. From Obsidian's cache, so no file is read. */
export function namesIn(app, files) {
  return tally(files.map((f) => Object.keys(noteProps(app, f))));
}

/** Words counted across lists, most used first: [[word, count]]. */
export function tally(lists) {
  const counts = new Map();
  lists.forEach((list) => list.forEach((w) => counts.set(w, (counts.get(w) || 0) + 1)));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The name a property has in `props`, whatever its capitals: "Status" for "status". Undefined when it has none. */
export function keyOf(props, key) {
  if (key in props) return key;
  const lower = String(key).toLowerCase();
  return Object.keys(props).find((k) => k.toLowerCase() === lower);
}

/** A property by name, whatever its capitals. */
export function propOf(props, key) {
  const k = keyOf(props, key);
  return k === undefined ? undefined : props[k];
}

/** A value as a list of plain strings: "a", ["a", "b"], "[[a]]" all read. */
export function valuesOf(value) {
  if (value == null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v != null && v !== '').map((v) => String(v));
}

/** One value that is a link, "[[Folder/Note#Part|shown]]": { to (what it links to, a heading's part too), shown }; else null. */
export function linkOf(value) {
  const m = /^\s*\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\s*$/.exec(String(value));
  return m ? { to: m[1].trim(), shown: m[2] || m[1].split('#')[0].split('/').pop() } : null;
}

/** The note a link written as a value points at: "[[Folder/Note#Part|alias]]" gives "Folder/Note". */
export function linkTarget(value) {
  const link = linkOf(value);
  return (link && link.to.split('#')[0].trim()) || null;
}

/** A value as it is shown: a link as the name of what it links to. */
export const valueShown = (value) => valuesOf(value).map((v) => (linkOf(v) || { shown: v }).shown).join(', ');

/** Writes a note's properties anew in the order given, [[key, value]]: Obsidian keeps them in the order they were set. */
export function setInOrder(fm, entries) {
  Object.keys(fm).forEach((k) => delete fm[k]);
  entries.forEach(([k, v]) => (fm[k] = v));
}

/** A note's tags, from its properties and its text, lower case, without the #. */
export function tagsOf(app, file) {
  const cache = app.metadataCache.getFileCache(file) || {};
  const props = noteProps(app, file);
  return valuesOf(propOf(props, 'tags')).concat(valuesOf(propOf(props, 'tag')), (cache.tags || []).map((t) => t.tag)).map((t) => String(t).replace(/^#/, '').toLowerCase());
}

/** A notice that offers to take something back. */
export function offerUndo(plugin, message, run) {
  const doc = plugin.app.workspace.containerEl ? plugin.app.workspace.containerEl.ownerDocument : document;
  const body = doc.createDocumentFragment();
  body.appendChild(doc.createTextNode(`${message} `));
  const button = doc.createElement('button');
  button.textContent = 'Undo';
  body.appendChild(button);
  const notice = new Notice(body, 8000);
  button.addEventListener('click', () => {
    if (notice && typeof notice.hide === 'function') notice.hide();
    run();
  });
  plugin.lastUndo = { message, run };
  return notice;
}

export class Notes {
  constructor(plugin) {
    this.plugin = plugin;
  }

  get app() {
    return this.plugin.app;
  }

  props(file) {
    return noteProps(this.app, file);
  }

  get(file, key) {
    return propOf(this.props(file), key);
  }

  /**
   * Changes a note's properties: `change(fm)` edits them in place. Returns
   * { file, before, after, order }, or null when the note could not be written.
   * `opts.undo` is the message of a notice that offers to take it back.
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
      console.error('Design Redux: could not write the properties', err);
      if (opts.failure !== false) new Notice(opts.failure || 'Could not update the properties.');
      return null;
    }
    if (!record) record = { file, before: {}, after: {}, order: [] };
    const changed = Object.keys(record.before).length > 0;
    if (changed && opts.undo) offerUndo(this.plugin, opts.undo, () => this.undo([record]));
    return record;
  }

  /** Takes back writes. Returns how many values were left alone because they had been edited since. */
  async undo(records) {
    let kept = 0;
    for (const r of records.filter(Boolean)) {
      try {
        await this.app.fileManager.processFrontMatter(r.file, (fm) => {
          let returned = false;
          Object.keys(r.before).forEach((k) => {
            if (!sameValue(fm[k], r.after[k])) return void kept++;
            if (r.before[k] === undefined) delete fm[k];
            else {
              if (fm[k] === undefined) returned = true;
              fm[k] = copyValue(r.before[k]);
            }
          });
          if (returned) {
            // A property that comes back goes where it was, not to the end.
            const keys = Object.keys(fm).filter((k) => k !== 'position');
            const sorted = r.order.filter((k) => keys.includes(k)).concat(keys.filter((k) => !r.order.includes(k)));
            const entries = sorted.map((k) => [k, fm[k]]);
            keys.forEach((k) => delete fm[k]);
            entries.forEach(([k, v]) => (fm[k] = v));
          }
        });
      } catch (err) {
        console.error('Design Redux: could not undo', err);
      }
    }
    if (kept) new Notice(`${kept} ${kept === 1 ? 'value was' : 'values were'} edited since and left as ${kept === 1 ? 'it is' : 'they are'}.`);
    return kept;
  }
}
