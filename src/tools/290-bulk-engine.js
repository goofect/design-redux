/* ------------------------------------------------------------------ */
/* Bulk edits                                                          */
/*                                                                     */
/* Properties added to every note in a set of folders at once, and a   */
/* property or tag renamed wherever it's used: in notes' properties    */
/* and text, in bases, and in this plugin's own settings. Each change  */
/* is recorded file by file as it's made, so the last one can be       */
/* undone for as long as those files haven't been edited since.        */
/* ------------------------------------------------------------------ */

import { Notice, TFile, TFolder } from 'obsidian';
import { byName } from '../core/040-sorting.js';
import { noteTags } from '../core/045-helpers-properties.js';
import { bulkCount, tagUnder } from '../core/047-helpers-text.js';
import { noteProps, sameValue } from '../core/073-notes.js';
import { addPropertiesTo, assignedEntryDiffers, convertValue, fmHasTag, isBlank, keyLike, mergePropertiesIn, propertyNameProblem, removePropertiesFrom, renamedText, renamePropertyIn, renameValueIn, tagSpots, valueKey } from './288-bulk-values.js';
import { renameInBaseBlocks, renameInBaseText, renamePropertyInSettings } from './289-bulk-bases.js';

/**
 * Plans and makes bulk changes, and keeps the last one for undoing: the
 * plans here, as BulkPlans; making them is BulkEdits, its second part
 * (291), which is the class the plugin and tools use.
 *
 * Every file is read before and after its change, and undo puts back
 * the earlier text only where the file still reads as this left it: a
 * note edited since keeps that edit, and is reported instead.
 */
export class BulkPlans {
  constructor(plugin) {
    this.plugin = plugin;
    this.last = null;
    this.busy = false;
    this.baseCache = null;
  }

  /** What a finished change did, with Undo while it's still the last one: for callers outside the tools, which don't import them. */
  notify(message, record) {
    return bulkNotice(this, message, record);
  }

  /** The ends of a result message: notes left alone, and notes that failed. */
  tail(record) {
    return bulkTail(record);
  }

  /** A property renamed everywhere from a name typed into a list (see renamePropertyInPlace). */
  renameInPlace(from, to, opts) {
    return renamePropertyInPlace(this, from, to, opts);
  }

  get app() {
    return this.plugin.app;
  }

  /* -- what a change covers ------------------------------------------ */

  /**
   * The notes a set of folders and notes covers. scope: 'deep' (in them
   * and their subfolders), 'direct' (in them only) or 'folder-notes'.
   */
  notesFor(targets, scope) {
    const out = [];
    const add = (f) => {
      if (f instanceof TFile && f.extension === 'md' && out.indexOf(f) === -1) out.push(f);
    };
    (targets || []).forEach((target) => {
      if (target instanceof TFile) return add(target);
      if (!(target instanceof TFolder)) return;
      if (scope === 'folder-notes') {
        const note = this.plugin.folderNote(target);
        if (note) add(note);
        return;
      }
      const walk = (folder) =>
        (folder.children || []).forEach((child) => {
          if (child instanceof TFolder) {
            if (scope === 'deep') walk(child);
          } else add(child);
        });
      walk(target);
    });
    return out.sort((a, b) => byName(a.path, b.path));
  }

  /**
   * How each property's name is written across the notes: for each, by
   * its name in small letters, every spelling and how many notes use it.
   */
  propertySpellings() {
    const all = new Map();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      Object.keys(this.frontmatterOf(file)).forEach((key) => {
        const low = key.toLowerCase();
        if (!all.has(low)) all.set(low, new Map());
        const counts = all.get(low);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return all;
  }

  frontmatterOf(file) {
    return noteProps(this.app, file);
  }

  /**
   * Which of the notes an addition would change, going by the cache —
   * and, for each property, how many notes already hold a value of their
   * own for it, which is what keeping or replacing decides.
   */
  planAdd(files, props, replace) {
    const changing = [];
    const held = {};
    files.forEach((file) => {
      const fm = this.frontmatterOf(file);
      props.forEach(({ key, value }) => {
        const have = keyLike(fm, key);
        if (have === undefined) return;
        const current = fm[have];
        // Nothing there yet, the same already, or lists, which merge.
        if (isBlank(current) || sameValue(current, value)) return;
        if (Array.isArray(current) || Array.isArray(value)) return;
        held[key] = (held[key] || 0) + 1;
      });
      if (addPropertiesTo(JSON.parse(JSON.stringify(fm)), props, replace)) changing.push(file);
    });
    return { files, changing, held };
  }

  /** How many notes carry a property, and which. */
  notesWithProperty(name) {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => keyLike(this.frontmatterOf(file), name) !== undefined);
  }

  /**
   * A property rename worked out from the cache: the notes it renames
   * in, the ones where two properties become one, the ones left as they
   * are because their values differ, and the settings that name it.
   */
  planPropertyRename(from, to) {
    const renamed = [];
    const merged = [];
    const conflicts = [];
    this.notesWithProperty(from).forEach((file) => {
      const result = renamePropertyIn(JSON.parse(JSON.stringify(this.frontmatterOf(file))), from, to);
      if (result === 'renamed') renamed.push(file);
      else if (result === 'merged') merged.push(file);
      else if (result === 'conflict') conflicts.push(file);
    });
    const settings = renamePropertyInSettings(JSON.parse(JSON.stringify(this.plugin.settings)), from, to).changed;
    return { renamed, merged, conflicts, settings, total: renamed.length + merged.length };
  }

  /**
   * A merge worked out from the cache: the notes it changes, those
   * where the values differ (put together in a list, or left as they
   * are), and the settings that name any of them.
   */
  planPropertyMerge(froms, to, mode) {
    const changed = [];
    const combined = [];
    const conflicts = [];
    const seen = new Set();
    froms.forEach((name) =>
      this.notesWithProperty(name).forEach((file) => {
        if (seen.has(file)) return;
        seen.add(file);
        const result = mergePropertiesIn(JSON.parse(JSON.stringify(this.frontmatterOf(file))), froms, to, mode);
        if (result === 'conflict') conflicts.push(file);
        else if (result === 'combined') {
          combined.push(file);
          changed.push(file);
        } else if (result !== 'absent' && result !== 'same') changed.push(file);
      })
    );
    const copy = JSON.parse(JSON.stringify(this.plugin.settings));
    const settings = [];
    froms.forEach((name) => {
      if (name.toLowerCase() === to.toLowerCase()) return;
      renamePropertyInSettings(copy, name, to).changed.forEach((label) => {
        if (settings.indexOf(label) === -1) settings.push(label);
      });
    });
    return { changed, combined, conflicts, settings, total: changed.length };
  }

  /** Notes with a tag or one beneath it, where it is, and nested tags met on the way. */
  planTagRename(from, to) {
    from = String(from).replace(/^#/, '');
    to = String(to || '').replace(/^#/, '');
    const files = [];
    let inText = 0;
    let inProps = 0;
    let already = 0;
    const nested = new Set();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const spots = tagSpots(cache, from);
      const fm = cache && cache.frontmatter;
      const inFm = fmHasTag(fm, from);
      noteTags(cache).forEach((t) => {
        if (tagUnder(t, from) && t !== from.toLowerCase()) nested.add(t);
      });
      if (spots.length || inFm) {
        files.push(file);
        if (spots.length) inText++;
        if (inFm) inProps++;
      }
      // Notes already carrying the new name, which the rename merges into.
      if (to && to.toLowerCase() !== from.toLowerCase() && noteTags(cache).some((t) => t === to.toLowerCase())) {
        already++;
      }
    });
    return { files, inText, inProps, already, nested: Array.from(nested).sort(byName) };
  }

  /**
   * Files a base lives in: .base files, and notes with a base block.
   * Read once per dialog; `fresh` reads again.
   */
  async baseSources(fresh) {
    if (this.baseCache && !fresh) return this.baseCache;
    const vault = this.app.vault;
    const out = [];
    for (const file of vault.getFiles()) {
      if (file.extension === 'base') {
        out.push({ file, kind: 'base', text: await vault.cachedRead(file) });
      } else if (file.extension === 'md') {
        const text = await vault.cachedRead(file);
        if (/^[ \t]*(`{3,}|~{3,})[ \t]*base[ \t]*$/m.test(text)) out.push({ file, kind: 'blocks', text });
      }
    }
    this.baseCache = out;
    return out;
  }

  /** The bases a rename would change. */
  async basesFor(what) {
    const sources = await this.baseSources();
    return sources
      .filter((s) =>
        s.kind === 'base' ? renameInBaseText(s.text, what) !== null : renameInBaseBlocks(s.text, what) !== null
      )
      .map((s) => s.file);
  }

  /** Notes where a property holds a value, and those where a list of it already holds the new one. */
  planValueRename(key, from, to) {
    const files = [];
    let merged = 0;
    this.notesWithProperty(key).forEach((file) => {
      const fm = JSON.parse(JSON.stringify(this.frontmatterOf(file)));
      const have = keyLike(fm, key);
      const hadTo = Array.isArray(fm[have]) && fm[have].some((x) => valueKey(x) === to);
      if (renameValueIn(fm, key, from, to)) {
        files.push(file);
        if (hadTo) merged++;
      }
    });
    return { files, merged };
  }

  /** The notes a removal would change. */
  planRemove(files, keys) {
    return files.filter((file) =>
      removePropertiesFrom(JSON.parse(JSON.stringify(this.frontmatterOf(file))), keys)
    );
  }

  /**
   * A type change worked out from the cache: the notes whose values are
   * converted, those whose values can't be and are left, and how many
   * are already right.
   */
  planTypeChange(key, type) {
    const convert = [];
    const stuck = [];
    let fine = 0;
    this.notesWithProperty(key).forEach((file) => {
      const fm = this.frontmatterOf(file);
      const value = fm[keyLike(fm, key)];
      const result = convertValue(value, type);
      if (!result.ok) stuck.push(file);
      else if (sameValue(result.value, value)) fine++;
      else convert.push(file);
    });
    return { convert, stuck, fine };
  }

  /** Notes without a property, or with it empty. */
  missing(files, key) {
    return files.filter((file) => {
      const fm = this.frontmatterOf(file);
      const have = keyLike(fm, key);
      return have === undefined || isBlank(fm[have]);
    });
  }

  /** Each value a property takes across the vault, as notes write it, and how many notes: [[value, count]], most used first. */
  valueCounts(key) {
    const counts = new Map();
    this.notesWithProperty(key).forEach((file) => {
      const fm = this.frontmatterOf(file);
      const have = keyLike(fm, key);
      if (have === undefined) return;
      const raw = fm[have];
      new Set((Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && v !== '').map(valueKey)).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
}

/* -- dialogs ---------------------------------------------------------- */

/** Names in a sentence: "status", "status and domain", "status, domain and 2 more". */
export function nameList(names, quote = true, most = 3) {
  const q = names.map((n) => (quote ? `“${n}”` : n));
  if (q.length <= 1) return q.join('');
  if (q.length <= most) return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
  return `${q.slice(0, most - 1).join(', ')} and ${q.length - most + 1} more`;
}

/** What a finished change did, with Undo while it's still the last one. */
export function bulkNotice(bulk, message, record) {
  const frag = document.createDocumentFragment();
  const box = document.createElement('div');
  box.className = 'dr-bulk-notice';
  frag.appendChild(box);
  box.createDiv({ text: message });
  let notice = null;
  if (record && bulk.last === record) {
    const undo = box.createEl('button', { cls: 'dr-bulk-undo', text: 'Undo' });
    undo.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (notice && typeof notice.hide === 'function') notice.hide();
      bulk.undo();
    });
  }
  notice = new Notice(frag, record && bulk.last === record ? 12000 : 6000);
  return notice;
}

/** The ends of a result message: notes left alone, and notes that failed. */
export function bulkTail(record) {
  const parts = [];
  if (record.conflicts && record.conflicts.length) {
    parts.push(
      `${bulkCount(record.conflicts.length, 'note')} kept both, as the values differ: ${nameList(
        record.conflicts.map((f) => f.basename), false
      )}.`
    );
  }
  if (record.stale && record.stale.length) {
    parts.push(`${bulkCount(record.stale.length, 'note')} changed while this ran and ${record.stale.length === 1 ? 'was' : 'were'} left: try again.`);
  }
  if (record.failed && record.failed.length) {
    parts.push(`${bulkCount(record.failed.length, 'file')} couldn't be changed; the console says why.`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

/**
 * A property renamed everywhere from a name typed into a list, with Undo.
 * One that needs a look first — notes where both names hold different
 * values, or tags, aliases or CSS classes — goes to `review` instead;
 * `redraw` puts the list back when nothing changes. A picked property
 * stays picked under its new name. The record, when it ran.
 */
export async function renamePropertyInPlace(bulk, from, to, { redraw, review, picks }) {
  const problem = propertyNameProblem(to);
  if (problem) {
    new Notice(problem);
    redraw();
    return null;
  }
  const plan = bulk.planPropertyRename(from, to);
  if (from === to && !plan.total && !plan.conflicts.length && !assignedEntryDiffers(bulk.app, to)) {
    redraw();
    return null;
  }
  const special = ['tags', 'aliases', 'cssclasses'];
  const changing = from.toLowerCase() !== to.toLowerCase();
  if (plan.conflicts.length || (changing && (special.indexOf(from.toLowerCase()) !== -1 || special.indexOf(to.toLowerCase()) !== -1))) {
    review();
    return null;
  }
  if (picks instanceof Set && picks.has(from)) {
    picks.delete(from);
    picks.add(to);
  }
  const record = await bulk.renameProperty(from, to);
  if (!record) {
    redraw();
    return null;
  }
  const done = notesChanged(record);
  const bases = (record.bases || []).length;
  bulkNotice(
    bulk,
    renamedText(from, to, done, record) +
      (bases ? ` and ${bulkCount(bases, 'base')}` : '') +
      '.' +
      (plan.merged.length ? ` ${bulkCount(plan.merged.length, 'note')} already had “${to}”; the two are one now.` : '') +
      bulkTail(record),
    record
  );
  return record;
}

/** Notes changed by a record, leaving out the bases it changed too. */
export function notesChanged(record) {
  const bases = record.bases || [];
  return record.files.filter((f) => bases.indexOf(f.file) === -1).length;
}

