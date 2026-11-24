/* ------------------------------------------------------------------ */
/* Bulk changes: one change made to many notes, and taken back as one  */
/*                                                                     */
/* Every property tool works the same way: it says which notes and     */
/* what would change, asks, makes the change note by note through      */
/* plugin.notes, and keeps the records so that Undo — offered at once, */
/* and as a command for the last change — puts back every value that   */
/* has not been edited since. The pure steps on one note's properties  */
/* are here too.                                                       */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { copyValue, keyOf, offerUndo, sameValue, valuesOf } from '../core/notes.js';
import { counted } from '../core/text.js';
import { confirm } from '../ui/sheet.js';

/** Renames a property in one note's properties, keeping its place; joins the values if the new name is taken. */
export function renameKey(fm, from, to) {
  const key = keyOf(fm, from);
  if (!key || key === to) return false;
  const entries = [];
  const have = Object.keys(fm).find((k) => k !== key && k.toLowerCase() === to.toLowerCase());
  Object.keys(fm).forEach((k) => {
    if (k === have) return;
    if (k === key) entries.push([have || to, have ? joinValues(fm[have], fm[key]) : fm[key]]);
    else entries.push([k, fm[k]]);
  });
  Object.keys(fm).forEach((k) => delete fm[k]);
  entries.forEach(([k, v]) => (fm[k] = v));
  return true;
}

/** Two values as one: the same once, different ones as a list. */
export function joinValues(a, b) {
  if (a == null || a === '') return copyValue(b);
  if (b == null || b === '' || sameValue(a, b)) return copyValue(a);
  const all = valuesOf(a).concat(valuesOf(b));
  return all.filter((v, i) => all.indexOf(v) === i);
}

/** Replaces one value of a property (in a list, that item), whatever its capitals. Returns whether it did. */
export function replaceValue(fm, key, from, to) {
  const k = keyOf(fm, key);
  if (!k) return false;
  const same = (v) => String(v).trim().toLowerCase() === String(from).trim().toLowerCase();
  if (Array.isArray(fm[k])) {
    if (!fm[k].some(same)) return false;
    const next = fm[k].map((v) => (same(v) ? to : v)).filter((v) => v !== '' && v != null);
    fm[k] = next.filter((v, i) => next.indexOf(v) === i);
    return true;
  }
  if (fm[k] == null || !same(fm[k])) return false;
  fm[k] = to;
  return true;
}

/** A note's properties block at the head of its text, "---" to "---". */
export const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;

export const VALUE_TYPES = { text: 'Text', number: 'Number', checkbox: 'Checkbox', multitext: 'List' };

/** A value as another type; undefined when it can't be read as one (the note is then left alone). */
export function retype(value, type) {
  if (value == null || value === '') return value;
  if (type === 'multitext') return Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim()).filter(Boolean);
  const one = Array.isArray(value) ? (value.length === 1 ? value[0] : type === 'text' ? value.join(', ') : undefined) : value;
  if (one === undefined) return undefined;
  if (type === 'text') return String(one);
  if (type === 'number') return Number.isFinite(Number(String(one).trim())) && String(one).trim() !== '' ? Number(String(one).trim()) : undefined;
  if (type === 'checkbox') return /^(true|yes|y|1|done)$/i.test(String(one)) ? true : /^(false|no|n|0)$/i.test(String(one)) ? false : undefined;
  return undefined;
}

/** A tag renamed in a note's text: #old and #old/nested; not in a code block or code span, nor part of a longer tag. */
export function renameTagInText(text, from, to) {
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let fence = false;
  return text.split('\n').map((line) => {
    if (/^ {0,3}(```|~~~)/.test(line)) { fence = !fence; return line; }
    if (fence) return line;
    // Inline code keeps what it says: only the parts between code spans are tags.
    return line.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part : part.replace(new RegExp(`(^|[^\\w/#])#${esc}(?=$|[^\\w/-]|/)`, 'gi'), (m, before) => `${before}#${to}`))).join('');
  }).join('\n');
}

export class Bulk {
  constructor(plugin) {
    this.plugin = plugin;
    this.last = null;
  }

  /**
   * Makes `change(fm, file)` on each of `files`; a note it leaves as it was
   * is not counted. `text(old, file)` may also give a note's new text.
   * Says what it did and offers Undo. Returns how many notes changed.
   */
  async run(files, title, change, text) {
    const records = [];
    const texts = [];
    for (const file of files) {
      if (text) {
        // Written through process, from the text as it is then, so an edit made meanwhile is kept.
        const vault = this.plugin.app.vault;
        const seen = await vault.cachedRead(file);
        if (text(seen, file) !== seen) {
          let before = seen;
          const after = await vault.process(file, (now) => text((before = now), file));
          if (after !== before) texts.push({ file, before, after });
        }
      }
      if (!change) continue;
      const record = await this.plugin.notes.write(file, (fm) => change(fm, file), { failure: false });
      if (record && Object.keys(record.before).length) records.push(record);
    }
    const n = new Set(records.map((r) => r.file).concat(texts.map((t) => t.file))).size;
    if (!n) return void new Notice('Nothing needed changing.'), 0;
    this.last = { title, records, texts };
    offerUndo(this.plugin, `${title}: ${counted(n, 'note')} changed.`, () => this.undo());
    return n;
  }

  /** Takes the last bulk change back. */
  async undo() {
    const last = this.last;
    if (!last) return void new Notice('There is no bulk change to undo.'), false;
    this.last = null;
    for (const t of last.texts) {
      // A note's text is put back only if nothing has been written in it since; its properties stay as they are now.
      const body = (text) => text.replace(FRONTMATTER, '');
      await this.plugin.app.vault.process(t.file, (now) => (body(now) === body(t.after) ? (FRONTMATTER.exec(now) || [''])[0] + body(t.before) : now));
    }
    await this.plugin.notes.undo(last.records);
    new Notice(`Undone: ${last.title}.`);
    return true;
  }

  /** Asks before a change to many notes. Resolves whether to go on. */
  ask(title, files, what) {
    if (!files.length) return void new Notice('No note would change.'), Promise.resolve(false);
    return confirm(this.plugin.app, { title, text: `${what} in ${counted(files.length, 'note')}. One Undo takes it back.`, action: 'Change' });
  }
}
