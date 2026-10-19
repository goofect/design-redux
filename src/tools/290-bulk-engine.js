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
import { byName } from '../core/030-helpers-art.js';
import { noteTags } from '../core/040-helpers-sorting.js';
import { bulkCount, tagUnder } from '../core/047-helpers-text.js';
import { noteProps, sameValue } from '../core/073-notes.js';
import { checkNote, fixFor, schemaFor } from '../core/086-property-schema.js';
import { addPropertiesTo, assignedEntryDiffers, assignedType, convertValue, fmHasTag, isBlank, keyLike, mergePropertiesIn, propertyNameProblem, propertyType, removePropertiesFrom, renamedText, renamePropertyIn, renameTagIn, renameTagsAt, renameValueIn, respellAssignedType, tagSpots, valueKey } from './288-bulk-values.js';
import { renameInBaseBlocks, renameInBaseText, renamePropertyInSettings } from './289-bulk-bases.js';


/**
 * Plans and makes bulk changes, and keeps the last one for undoing.
 *
 * Every file is read before and after its change, and undo puts back
 * the earlier text only where the file still reads as this left it: a
 * note edited since keeps that edit, and is reported instead.
 */
export class BulkEdits {
  constructor(plugin) {
    this.plugin = plugin;
    this.last = null;
    this.busy = false;
    this.baseCache = null;
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

  /** Rename one value of a property in every note and base that uses it. */
  async renameValue(key, from, to) {
    const app = this.app;
    const what = { value: [key, from, to] };
    const record = await this.run(`Renaming “${from}”`, async (touch, step, rec) => {
      const { files } = this.planValueRename(key, from, to);
      let done = 0;
      for (const file of files) {
        await touch(file, () => app.fileManager.processFrontMatter(file, (fm) => renameValueIn(fm, key, from, to)));
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);
    });
    if (!record) return null;
    this.followRename({ value: [key, from, to] });
    record.undoFollow = () => this.followRename({ value: [key, to, from] });
    return record;
  }

  /** Several values of a property made one, `to`, in every note and base: one step of Undo. */
  async mergeValuesInto(key, froms, to) {
    const app = this.app;
    froms = froms.filter((f) => f !== to);
    if (!froms.length) return null;
    const record = await this.run(`Merging into “${to}”`, async (touch, step, rec) => {
      const files = [];
      froms.forEach((from) => this.planValueRename(key, from, to).files.forEach((f) => files.indexOf(f) === -1 && files.push(f)));
      let done = 0;
      for (const file of files) {
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (fm) => {
            froms.forEach((from) => renameValueIn(fm, key, from, to));
          })
        );
        step(++done, files.length);
      }
      rec.bases = [];
      for (const from of froms) rec.bases = rec.bases.concat(await this.rewriteBases({ value: [key, from, to] }, touch));
    });
    if (!record) return null;
    froms.forEach((from) => this.followRename({ value: [key, from, to] }));
    return record;
  }

  /** Groups of values that are one value written differently, each made the value it keeps, in every note and base: one step of Undo. */
  async cleanUpValues(key, groups) {
    const app = this.app;
    const merges = groups.map((g) => ({ to: g.keep, froms: g.values.filter((v) => v !== g.keep) })).filter((m) => m.froms.length);
    if (!merges.length) return null;
    const record = await this.run(`Cleaning up “${key}”`, async (touch, step, rec) => {
      const files = [];
      merges.forEach((m) => m.froms.forEach((from) => this.planValueRename(key, from, m.to).files.forEach((f) => files.indexOf(f) === -1 && files.push(f))));
      let done = 0;
      for (const file of files) {
        await touch(file, () => app.fileManager.processFrontMatter(file, (fm) => merges.forEach((m) => m.froms.forEach((from) => renameValueIn(fm, key, from, m.to)))));
        step(++done, files.length);
      }
      rec.bases = [];
      for (const m of merges) for (const from of m.froms) rec.bases = rec.bases.concat(await this.rewriteBases({ value: [key, from, m.to] }, touch));
    });
    if (!record) return null;
    merges.forEach((m) => m.froms.forEach((from) => this.followRename({ value: [key, from, m.to] })));
    return record;
  }

  /** What notes fall short of in their folders' schemas, put right where the fix is plain, in each note: one step of Undo. */
  async fixSchemas(files) {
    const fm = this.app.fileManager;
    const schemas = this.plugin.settings.propertySchemas || {};
    return this.run('Fixing properties', async (touch, step) => {
      let done = 0;
      for (const file of files) {
        await touch(file, () =>
          fm.processFrontMatter(file, (data) =>
            checkNote(schemaFor(schemas, file), data).forEach((issue) => {
              const fix = fixFor(issue);
              if (fix) fix(data);
            })
          )
        );
        step(++done, files.length);
      }
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

  /** Take properties out of the notes. */
  async removeProperties(files, keys) {
    const fm = this.app.fileManager;
    const changing = this.planRemove(files, keys);
    const label = `Removing ${keys.length === 1 ? `“${keys[0]}”` : `${keys.length} properties`}`;
    return this.run(label, async (touch, step) => {
      let done = 0;
      for (const file of changing) {
        await touch(file, () => fm.processFrontMatter(file, (data) => removePropertiesFrom(data, keys)));
        step(++done, changing.length);
      }
    });
  }

  /**
   * Give a property a type everywhere, converting the values that can
   * be converted and leaving — and naming — any that can't.
   */
  async changeType(key, type) {
    const app = this.app;
    const before = assignedType(app, key);
    // What it was taken to be, if nothing was assigned, to go back to.
    const seen = propertyType(app, key);
    const record = await this.run(`Changing “${key}”`, async (touch, step, rec) => {
      const plan = this.planTypeChange(key, type);
      rec.stuck = plan.stuck;
      let done = 0;
      for (const file of plan.convert) {
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (fm) => {
            const have = keyLike(fm, key);
            if (have === undefined) return;
            const result = convertValue(fm[have], type);
            if (result.ok) fm[have] = result.value;
          })
        );
        step(++done, plan.convert.length);
      }
      try {
        app.metadataTypeManager.setType(key, type);
        rec.undoSettings = () => {
          try {
            if (before) app.metadataTypeManager.setType(key, before);
            else if (typeof app.metadataTypeManager.unsetType === 'function') app.metadataTypeManager.unsetType(key);
            else app.metadataTypeManager.setType(key, seen);
          } catch (err) {
            /* the values are back either way */
          }
        };
      } catch (err) {
        /* the values are converted; Obsidian infers the type from them */
      }
    });
    return record;
  }

  /** Fill a property in the notes that lack it. */
  async fill(files, key, value, type) {
    const fm = this.app.fileManager;
    const record = await this.run(`Filling “${key}”`, async (touch, step) => {
      let done = 0;
      for (const file of files) {
        await touch(file, () =>
          fm.processFrontMatter(file, (data) => {
            const have = keyLike(data, key);
            if (have !== undefined && !isBlank(data[have])) return;
            data[have === undefined ? key : have] = value;
          })
        );
        step(++done, files.length);
      }
    });
    if (record && type && type !== 'text' && !assignedType(this.app, key)) {
      try {
        this.app.metadataTypeManager.setType(key, type);
      } catch (err) {
        /* inferred from the values */
      }
    }
    return record;
  }

  /* -- making changes ----------------------------------------------- */

  /**
   * Run a change, recording each file's text before and after. A
   * notice counts the notes as they go, since a large vault takes a
   * moment. Returns the record, which becomes the one Undo reverses.
   */
  async run(label, work) {
    if (this.busy) {
      new Notice('Another change is still being made.');
      return null;
    }
    this.busy = true;
    this.baseCache = null;
    const record = { label, files: [], failed: [], undoSettings: null };
    const progress = new Notice(`${label}…`, 0);
    const vault = this.app.vault;
    const touch = async (file, edit) => {
      try {
        const before = await vault.read(file);
        await edit(file);
        const after = await vault.read(file);
        if (after !== before) record.files.push({ file, before, after });
        return after !== before;
      } catch (err) {
        console.error(`Design Redux: could not change ${file.path}`, err);
        record.failed.push(file);
        return false;
      }
    };
    const step = (done, total) => {
      if (typeof progress.setMessage === 'function' && total > 20 && done % 10 === 0) {
        progress.setMessage(`${label}… ${done} of ${total}`);
      }
    };
    try {
      await work(touch, step, record);
    } finally {
      this.busy = false;
      if (typeof progress.hide === 'function') progress.hide();
    }
    if (record.files.length || record.undoSettings) this.last = record;
    return record;
  }

  /**
   * Add properties to the notes. Only a note the cache says will change
   * is written, since writing properties back can re-save a note's
   * frontmatter even when nothing in it is different.
   */
  async addProperties(files, props, replace) {
    const fm = this.app.fileManager;
    files = this.planAdd(files, props, replace).changing;
    const types = props.filter((p) => p.type && !assignedType(this.app, p.key));
    const label = `Adding ${props.length === 1 ? `“${props[0].key}”` : `${props.length} properties`}`;
    const record = await this.run(label, async (touch, step) => {
      let done = 0;
      for (const file of files) {
        await touch(file, () => fm.processFrontMatter(file, (data) => addPropertiesTo(data, props, replace)));
        step(++done, files.length);
      }
    });
    if (!record) return null;
    // A new property gets the type it was given here, so Obsidian shows
    // a list as a list from the first note on.
    types.forEach((p) => {
      try {
        if (p.type !== 'text' && typeof this.app.metadataTypeManager.setType === 'function') {
          this.app.metadataTypeManager.setType(p.key, p.type);
        }
      } catch (err) {
        /* the values still read as what they are */
      }
    });
    return record;
  }

  /**
   * Rename a property in every note that has it, in bases, and in this
   * plugin's settings. Notes where the two names hold different values
   * are left as they are and reported.
   */
  async renameProperty(from, to) {
    const app = this.app;
    const what = { property: [from, to] };
    const type = assignedType(app, from);
    const record = await this.run(`Renaming “${from}”`, async (touch, step, rec) => {
      const plan = this.planPropertyRename(from, to);
      const files = plan.renamed.concat(plan.merged);
      rec.conflicts = plan.conflicts.slice();
      let done = 0;
      for (const file of files) {
        let result = 'absent';
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (data) => {
            result = renamePropertyIn(data, from, to);
          })
        );
        if (result === 'conflict' && rec.conflicts.indexOf(file) === -1) rec.conflicts.push(file);
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);

      const settings = renamePropertyInSettings(this.plugin.settings, from, to);
      rec.settings = settings.changed;
      if (settings.changed.length) {
        rec.undoSettings = () => {
          settings.undo();
          this.afterSettings(to, from);
        };
        await this.plugin.saveData(this.plugin.settings);
        this.afterSettings(from, to);
      }
    });
    if (!record) return null;
    if (type && from.toLowerCase() !== to.toLowerCase() && !assignedType(app, to)) {
      try {
        app.metadataTypeManager.setType(to, type);
      } catch (err) {
        /* Obsidian infers it again from the values */
      }
    }
    // New capitals: the name Obsidian lists it by, too — even where every note had them already.
    const was = await respellAssignedType(app, to);
    record.respelled = !!was;
    this.followRename({ property: [from, to] });
    record.undoFollow = () => {
      this.followRename({ property: [to, from] });
      if (was) respellAssignedType(app, was);
    };
    return record;
  }

  /**
   * Several properties made one, in every note that has any of them, in
   * bases and in this plugin's settings. Where a note's values differ,
   * `mode` 'list' puts them together; otherwise it's left and reported.
   */
  async mergeProperties(froms, to, mode) {
    const app = this.app;
    const others = froms.filter((name) => name.toLowerCase() !== to.toLowerCase());
    const type = assignedType(app, to) || froms.map((name) => assignedType(app, name)).find(Boolean) || null;
    const label = `Merging ${nameList(froms)} into “${to}”`;
    const record = await this.run(label, async (touch, step, rec) => {
      const plan = this.planPropertyMerge(froms, to, mode);
      rec.conflicts = plan.conflicts.slice();
      rec.combined = plan.combined.slice();
      let done = 0;
      for (const file of plan.changed) {
        let result = 'absent';
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (data) => {
            result = mergePropertiesIn(data, froms, to, mode);
          })
        );
        if (result === 'conflict' && rec.conflicts.indexOf(file) === -1) rec.conflicts.push(file);
        step(++done, plan.changed.length);
      }
      rec.bases = [];
      for (const name of others) {
        (await this.rewriteBases({ property: [name, to] }, touch)).forEach((file) => {
          if (rec.bases.indexOf(file) === -1) rec.bases.push(file);
        });
      }

      const undo = [];
      rec.settings = [];
      others.forEach((name) => {
        const settings = renamePropertyInSettings(this.plugin.settings, name, to);
        if (!settings.changed.length) return;
        settings.changed.forEach((l) => rec.settings.indexOf(l) === -1 && rec.settings.push(l));
        undo.unshift(() => {
          settings.undo();
          this.afterSettings(to, name);
        });
      });
      if (undo.length) {
        rec.undoSettings = () => undo.forEach((fn) => fn());
        await this.plugin.saveData(this.plugin.settings);
        others.forEach((name) => this.afterSettings(name, to));
      }
    });
    if (!record) return null;
    // Values put together in lists make it a list property.
    const listType = record.combined && record.combined.length && (!type || type === 'text') ? 'multitext' : null;
    const want = listType || type;
    if (want && want !== assignedType(app, to)) {
      try {
        app.metadataTypeManager.setType(to, want);
      } catch (err) {
        /* Obsidian infers it again from the values */
      }
    }
    const was = await respellAssignedType(app, to);
    others.forEach((name) => this.followRename({ property: [name, to] }));
    record.undoFollow = () => {
      others.forEach((name) => this.followRename({ property: [to, name] }));
      if (was) respellAssignedType(app, was);
    };
    return record;
  }

  /** Rename a tag, and the tags nested beneath it, in notes' properties and text and in bases. */
  async renameTag(from, to) {
    const app = this.app;
    const what = { tag: [from, to] };
    const record = await this.run(`Renaming #${from}`, async (touch, step, rec) => {
      const { files } = this.planTagRename(from, to);
      rec.stale = [];
      let done = 0;
      for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        const spots = tagSpots(cache, from);
        const inFm = fmHasTag(cache && cache.frontmatter, from);
        await touch(file, async () => {
          // The text first, at the places the cache found; the
          // properties after, since rewriting them moves those places.
          if (spots.length) {
            let stale = false;
            await app.vault.process(file, (text) => {
              const next = renameTagsAt(text, spots, from, to);
              if (next === null) {
                stale = true;
                return text;
              }
              return next;
            });
            if (stale) rec.stale.push(file);
          }
          if (inFm) await app.fileManager.processFrontMatter(file, (data) => renameTagIn(data, from, to));
        });
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);
    });
    if (!record) return null;
    this.followRename({ tag: [from, to] });
    record.undoFollow = () => this.followRename({ tag: [to, from] });
    return record;
  }

  /** Apply a rename to every base that mentions it. Returns the files changed. */
  async rewriteBases(what, touch) {
    const changed = [];
    const vault = this.app.vault;
    const rename = (source, text) =>
      source.kind === 'base' ? renameInBaseText(text, what) : renameInBaseBlocks(text, what);
    for (const source of await this.baseSources(true)) {
      if (rename(source, source.text) === null) continue;
      const did = await touch(source.file, () =>
        vault.process(source.file, (text) => {
          const next = rename(source, text);
          return next === null ? text : next;
        })
      );
      if (did) changed.push(source.file);
    }
    this.baseCache = null;
    return changed;
  }

  /** Graphs and the sidebar follow a change to the settings that name a property: they listen for it. */
  afterSettings(from, to) {
    this.app.workspace.trigger('design-redux:property-renamed', from, to);
  }

  /** Open screens that were showing the old name show the new one: the library moves them on. */
  followRename(what) {
    this.app.workspace.trigger('design-redux:renamed', what);
    // Once Obsidian has read the changed files back.
    window.setTimeout(() => this.plugin.refreshBrowse(), 400);
  }

  /** Put back what the last change altered, where it hasn't been edited since. */
  async undo() {
    const record = this.last;
    if (!record) {
      new Notice('There is no bulk change to undo.');
      return null;
    }
    if (this.busy) {
      new Notice('Another change is still being made.');
      return null;
    }
    this.last = null;
    this.busy = true;
    let restored = 0;
    const kept = [];
    try {
      for (const { file, before, after } of record.files.slice().reverse()) {
        let ok = false;
        try {
          await this.app.vault.process(file, (text) => {
            if (text !== after) return text;
            ok = true;
            return before;
          });
        } catch (err) {
          ok = false;
        }
        if (ok) restored++;
        else kept.push(file);
      }
      if (record.undoSettings) {
        record.undoSettings();
        await this.plugin.saveData(this.plugin.settings);
      }
    } finally {
      this.busy = false;
    }
    if (record.undoFollow) record.undoFollow();
    this.baseCache = null;
    window.setTimeout(() => this.plugin.refreshBrowse(), 400);
    const notes = (n) => (n === 1 ? '1 file' : `${n} files`);
    new Notice(
      kept.length
        ? `Undone in ${notes(restored)}. ${notes(kept.length)} changed since, so left as they are: ${kept
            .slice(0, 3)
            .map((f) => f.basename)
            .join(', ')}${kept.length > 3 ? '…' : ''}`
        : `Undone in ${notes(restored)}.`,
      kept.length ? 10000 : 4000
    );
    return { restored, kept };
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

