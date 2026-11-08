/* ------------------------------------------------------------------ */
/* What an album is                                                    */
/*                                                                     */
/* A folder is where notes are kept; an album can also say what it is  */
/* and what belongs to it, wherever that's kept. The plugin keeps it,  */
/* by the folder's path (settings.albums), so no folder note is needed; */
/* a folder note from before is read until the first change carries    */
/* what it says over:                                                  */
/*   album: subject, project, reference or index — shown at its head, */
/*     and each changes the album a little: progress for a project,    */
/*     an index's albums as tiles;                                     */
/*   description: what it's for, shown under its title;               */
/*   includes: notes from elsewhere that belong to it too — shown in   */
/*     it, not moved or copied;                                        */
/*   related: albums beside it, not above or below;                    */
/*   featured: notes to start with, at the top of the album;           */
/*   layout: how it opens — its notes as a list, as covers or a table. */
/* And an album's page shows the way down to it from the top.          */
/* ------------------------------------------------------------------ */

import { Notice, Setting, TFile } from 'obsidian';
import { ALBUM_TYPES, BROWSE_VIEW } from '../core/020-constants.js';
import { activeViewOfType } from '../core/034-tabs.js';
import { menuGroup } from '../core/036-menus.js';
import { asButton, onActivate } from '../core/042-controls.js';
import { fmGet, plainValue, rollupOf, valueList } from '../core/045-helpers-properties.js';
import { noteProps } from '../core/073-notes.js';
import { libraryIndex } from '../core/077-library-index.js';
import { Feature } from '../core/080-feature.js';
import { ask } from '../core/081-capabilities.js';
import { PanelSection } from '../core/082-panel-section.js';
import { ComparePicker, FolderPicker } from '../ui/230-pickers.js';

/* The folder note properties an album is read from; each can be given another name in settings, so none has to clash with your own. */
export const ALBUM_KEY_DEFAULTS = { type: 'album', description: 'description', includes: 'includes', related: 'related', featured: 'featured', layout: 'layout' };
export const ALBUM_KEY_LABELS = { type: 'Kind', description: 'Description', includes: 'Notes and collections it takes in', related: 'Related collections', featured: 'Notes to start with', layout: 'How it opens' };
export const ALBUM_KEYS = Object.assign({}, ALBUM_KEY_DEFAULTS);

/** The names set in settings, or the usual ones. */
export function applyAlbumKeys(names) {
  Object.keys(ALBUM_KEY_DEFAULTS).forEach((k) => {
    const own = names && typeof names[k] === 'string' ? names[k].trim() : '';
    ALBUM_KEYS[k] = own || ALBUM_KEY_DEFAULTS[k];
  });
}

export const ALBUM_LAYOUTS = [
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'covers', label: 'Covers', icon: 'layout-grid' },
  { id: 'table', label: 'Table', icon: 'table' },
];

/* What counts as finished, for a project's notes. */
export const DONE_VALUES = ['done', 'complete', 'completed', 'finished', 'read'];

/** In the note panel: the album a note is in, albums that include it from elsewhere, and canvases it's on. */
export class PlacesSection extends PanelSection {
  constructor(panel, structure) {
    super(panel);
    this.structure = structure;
  }

  get cls() {
    return 'dr-places-section';
  }

  render() {
    const file = this.file;
    if (!file || file.extension !== 'md') return;
    this.renderLabel('Kept in');
    const folder = file.parent && !(file.parent.isRoot && file.parent.isRoot()) ? file.parent : null;
    const albums = (folder ? [{ folder, own: true }] : []).concat(this.structure.albumsIncluding(file).map((f) => ({ folder: f, own: false })));
    this.renderList('places-albums', 'Collections', albums, (list, a) => {
      const row = list.createDiv({ cls: 'dr-mention' });
      asButton(row, `Open the collection ${a.folder.name}`);
      row.createSpan({ cls: 'dr-mention-name', text: a.folder.name });
      if (!a.own) row.createSpan({ cls: 'dr-mention-count', text: 'includes it' });
      onActivate(row, () => {
        const library = ask(this.plugin, 'library');
        if (library) library.browseMode({ mode: 'folder', path: a.folder.path });
        this.panel.close();
      });
    });
    this.renderList('places-canvases', 'Canvases', canvasesWith(this.plugin, file), (list, canvas) => this.fileRow(list, canvas));
  }
}

/** The canvases with a card for a note, as Obsidian counts their links. */
export function canvasesWith(plugin, file) {
  return Object.keys(libraryIndex(plugin).incoming(file))
    .filter((p) => p.endsWith('.canvas'))
    .map((p) => plugin.app.vault.getFileByPath(p))
    .filter(Boolean)
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

export class AlbumStructure extends Feature {
  /** Every settings save: the property names, as set. Safe to run again. */
  enable() {
    applyAlbumKeys(this.settings.albumKeyNames);
  }

  disable() {
    applyAlbumKeys(null);
  }

  settingsSchema() {
    return [
      {
        key: 'panelPlaces',
        name: 'Where a note is kept, in the note panel',
        desc: 'Below a note’s properties: its collections and canvases.',
        showIf: 'albumStructure',
      },
      {
        key: 'albumKeyNames',
        type: 'custom',
        showIf: 'albumStructure',
        name: 'Collection property names',
        render: (containerEl) => this.renderKeyNames(containerEl),
      },
      {
        key: 'albumStructure',
        name: 'Collections say what they are',
        desc: 'Collections say their kind, what they’re for and what they take in.',
      },
      {
        key: 'albumRollups',
        name: 'What a collection comes to',
        desc: 'How many notes are done, and the span of dates, under a collection’s title.',
      },
      {
        key: 'rollupDateKey',
        type: 'text',
        showIf: 'albumRollups',
        name: 'Date property for the span',
        desc: 'The date property whose earliest and latest dates show.',
      },
    ];
  }

  actions() {
    return [
      { id: 'album-set-type', name: 'Set what kind of collection this is…', icon: 'shapes', when: () => this.enabled && !!this.currentFolder(), run: () => this.chooseType(this.currentFolder()) },
      { id: 'album-include-note', name: 'Show this note in another collection too…', icon: 'folder-input', on: 'note', menu: false, when: () => this.enabled, run: (ctx) => this.chooseAlbumFor(ctx.file) },
    ];
  }

  /** The album on screen in the browse view, or the open note's folder. */
  currentFolder() {
    const view = activeViewOfType(this.app, BROWSE_VIEW);
    if (view && view.mode === 'folder') {
      const folder = view.folder();
      return folder && !(folder.isRoot && folder.isRoot()) ? folder : null;
    }
    const note = this.pageNote();
    return note && note.parent && !(note.parent.isRoot && note.parent.isRoot()) ? note.parent : null;
  }

  pageNote() {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === 'md' ? file : null;
  }

  /** What the plugin keeps of each collection, by its folder's path. */
  get kept() {
    if (!this.settings.albums || typeof this.settings.albums !== 'object') this.settings.albums = {};
    return this.settings.albums;
  }

  /**
   * What a folder note from before says of its album, as the plugin keeps
   * it: { type, description, includes, related, featured, layout }, the
   * lists as paths (a folder note standing for its folder), a name that
   * leads nowhere kept as it's written.
   */
  fromNote(note) {
    if (!note) return null;
    const fm = noteProps(this.app, note);
    const out = {};
    const one = (key) => String(valueList(fmGet(fm, key))[0] || '').toLowerCase();
    if (one(ALBUM_KEYS.type)) out.type = one(ALBUM_KEYS.type);
    const description = valueList(fmGet(fm, ALBUM_KEYS.description)).join(' ');
    if (description) out.description = description;
    ['includes', 'related', 'featured'].forEach((field) => {
      const list = valueList(fmGet(fm, ALBUM_KEYS[field])).map((v) => {
        const file = this.app.metadataCache.getFirstLinkpathDest(plainValue(v), note.path);
        const target = file && this.plugin.isFolderNote(file) && file.parent ? file.parent : file;
        return target ? target.path : plainValue(v);
      });
      if (list.length) out[field] = list;
    });
    if (one(ALBUM_KEYS.layout)) out.layout = one(ALBUM_KEYS.layout);
    return Object.keys(out).length ? out : null;
  }

  /** A collection's details: what the plugin keeps, else what its folder note says, else nothing. */
  dataOf(folder, note) {
    const kept = this.kept[folder.path];
    if (kept) return kept;
    return this.fromNote(note === undefined ? this.plugin.folderNote(folder) : note) || {};
  }

  /** What's known of an album: { type, label, description, includes, related, featured, layout, missing, note }. */
  info(folder) {
    const empty = { type: '', label: '', description: '', includes: [], related: [], featured: [], layout: 'list', layoutGiven: false, missing: [], note: null };
    if (!this.enabled || !folder || (folder.isRoot && folder.isRoot())) return empty;
    const note = this.plugin.folderNote(folder);
    const data = this.dataOf(folder, note);
    if (!Object.keys(data).length) return Object.assign({}, empty, { note });
    const type = String(data.type || '').toLowerCase();
    const known = ALBUM_TYPES.find((t) => t.id === type);
    const missing = [];
    const links = (field) => {
      const out = [];
      (Array.isArray(data[field]) ? data[field] : []).forEach((p) => {
        const target = this.app.vault.getAbstractFileByPath(p);
        if (!target) {
          missing.push({ key: ALBUM_KEYS[field], name: String(p).split('/').pop().replace(/\.md$/i, '') });
          return;
        }
        if (target !== folder && target !== note && out.indexOf(target) === -1) out.push(target);
      });
      return out;
    };
    const layout = ALBUM_LAYOUTS.find((l) => l.id === String(data.layout || '').toLowerCase());
    return {
      type,
      label: known ? known.label : type ? type.charAt(0).toUpperCase() + type.slice(1) : '',
      description: String(data.description || ''),
      includes: links('includes'),
      related: links('related'),
      featured: links('featured').filter((t) => t instanceof TFile),
      layout: (layout || ALBUM_LAYOUTS[0]).id,
      // Whether it says, rather than opening as albums usually do.
      layoutGiven: !!layout,
      // Names its includes, related and featured give that lead nowhere.
      missing,
      note,
      // Whether the plugin keeps it, rather than a folder note from before saying it.
      kept: !!this.kept[folder.path],
    };
  }

  /** Every folder with something said of it: what the plugin keeps, and folder notes from before. */
  described() {
    const out = new Set();
    Object.keys(this.kept).forEach((p) => {
      const f = this.app.vault.getFolderByPath(p);
      if (f) out.add(f);
    });
    libraryIndex(this.plugin).folderNotes().forEach(({ folder }) => out.add(folder));
    return Array.from(out);
  }

  /**
   * The settings' property names, one row each, with a way to carry
   * values already written under the old names over to the new.
   */
  renderKeyNames(containerEl) {
    const doc = containerEl.ownerDocument;
    const block = containerEl.appendChild(doc.createElement('div'));
    block.className = 'dr-album-keys';
    const names = Object.assign({}, this.settings.albumKeyNames || {});
    new Setting(block)
      .setName('Collection property names')
      .setDesc('The properties folder notes from before are read from.')
      .setHeading();
    Object.keys(ALBUM_KEY_DEFAULTS).forEach((k) => {
      new Setting(block).setName(ALBUM_KEY_LABELS[k]).addText((t) =>
        t
          .setPlaceholder(ALBUM_KEY_DEFAULTS[k])
          .setValue(names[k] || '')
          .onChange((v) => {
            names[k] = v.trim();
            this.settings.albumKeyNames = Object.assign({}, names);
            this.plugin.saveSettings();
          })
      );
    });
    new Setting(block)
      .setDesc('Old values stay under their old names until carried over.')
      .addButton((b) => b.setButtonText('Carry values over to these names').onClick(() => this.carryKeys()));
    return block;
  }

  /** Every folder note's values under any earlier name moved to the name now set, as one step of Undo. */
  async carryKeys() {
    const notes = libraryIndex(this.plugin).folderNotes().map((x) => x.note);
    const changes = [];
    for (const note of notes) {
      const fm = this.plugin.notes.props(note);
      const moves = Object.keys(ALBUM_KEY_DEFAULTS)
        .map((k) => [ALBUM_KEY_DEFAULTS[k], ALBUM_KEYS[k]])
        .filter(([from, to]) => from !== to && fmGet(fm, from) !== undefined && fmGet(fm, to) === undefined);
      if (!moves.length) continue;
      const record = await this.plugin.notes.write(note, (data) => {
        moves.forEach(([from, to]) => {
          data[to] = data[from];
          delete data[from];
        });
      });
      if (record) changes.push(record);
    }
    if (!changes.length) {
      new Notice('Nothing to carry over: every value is under the names set.');
      return 0;
    }
    this.plugin.notes.offerUndo(`Carried values over in ${changes.length} folder ${changes.length === 1 ? 'note' : 'notes'}.`, changes);
    return changes.length;
  }

  /** Above a collection's albums: that it's a collection — or the library itself — the way down, what it's for, how many. */
  renderCollectionHead(root, folder, view, count) {
    const top = !!(folder.isRoot && folder.isRoot());
    const info = this.info(folder);
    const head = root.createDiv({ cls: 'dr-collection-head' });
    const kicker = head.createDiv({ cls: 'dr-detail-kicker' });
    kicker.createSpan({ cls: 'dr-detail-kind', text: top ? 'Library' : info.label || 'Shelf' });
    const trail = top ? [] : this.trail(folder);
    if (trail.length) {
      const crumbs = kicker.createEl('nav', { cls: 'dr-crumbs', attr: { 'aria-label': 'Where this shelf is' } });
      trail.forEach((f, i) => {
        if (i) crumbs.createSpan({ cls: 'dr-crumb-sep', text: '›' });
        const crumb = crumbs.createSpan({ cls: 'dr-crumb', text: f.name });
        asButton(crumb);
        onActivate(crumb, () => view.openFolder(f));
      });
    }
    head.createDiv({ cls: 'dr-detail-meta', text: count === 1 ? '1 collection' : `${count} collections` });
    if (info.description) head.createDiv({ cls: 'dr-detail-desc', text: info.description });
    return head;
  }

  panelSections(panel) {
    return this.settings.panelPlaces ? [new PlacesSection(panel, this)] : [];
  }

  /** The albums that gather notes from elsewhere: those whose folder note names some under includes, by name. */
  gathering() {
    return this.described()
      .filter((folder) => (this.dataOf(folder).includes || []).length)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The albums of one kind ('subject' and so on), by name. */
  ofKind(type) {
    return this.described()
      .filter((folder) => this.info(folder).type === type)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The albums that include a note from elsewhere: those whose folder note names it under includes. */
  albumsIncluding(file) {
    return this.gathering().filter((folder) => folder !== file.parent && this.info(folder).includes.indexOf(file) !== -1);
  }

  /** Notes from elsewhere that belong to the album too, less any already in it. */
  included(folder, already) {
    const have = new Set(already || []);
    return this.info(folder).includes.filter((t) => t instanceof TFile && !have.has(t));
  }

  /** The folders above an album, from the top down; not the vault itself. */
  trail(folder) {
    const out = [];
    for (let p = folder && folder.parent; p && !(p.isRoot && p.isRoot()); p = p.parent) out.unshift(p);
    return out;
  }

  /** How far along a project is: { done, total, word }, or null. */
  /** Whether a note's done: ticked done, or a status saying so. */
  isDone(fm) {
    if (fmGet(fm, 'done') === true) return true;
    return valueList(fmGet(fm, 'status')).some((v) => DONE_VALUES.indexOf(v.toLowerCase()) !== -1);
  }

  /** What a collection's notes come to, as settings ask: { count, done, earliest, latest }, or null when off or empty. */
  rollup(files) {
    if (!this.settings.albumRollups) return null;
    const notes = (files || []).filter((f) => f.extension === 'md');
    if (!notes.length) return null;
    return rollupOf(notes.map((f) => noteProps(this.app, f)), (fm) => this.isDone(fm), String(this.settings.rollupDateKey || '').trim());
  }

  /** A rollup said in a line: 12 of 30 done · due 3 Mar – 12 Apr. `withDone` false leaves the done count to what's shown already. */
  rollupText(r, withDone = true) {
    if (!r) return '';
    const parts = [];
    if (withDone && r.done) parts.push(`${r.done} of ${r.count} done`);
    if (r.earliest) {
      const day = (iso) => new Date(`${iso}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const key = String(this.settings.rollupDateKey || '').trim();
      parts.push(r.earliest === r.latest ? `${key} ${day(r.earliest)}` : `${key} ${day(r.earliest)} – ${day(r.latest)}`);
    }
    return parts.join('  ·  ');
  }

  /** A collection's notes at any depth, as its rows' rollup reads them. */
  notesUnder(folder) {
    const out = [];
    const walk = (f) => (f.children || []).forEach((c) => (c instanceof TFile ? c.extension === 'md' && out.push(c) : walk(c)));
    walk(folder);
    return out;
  }

  progress(info, files) {
    if (info.type !== 'project') return null;
    const notes = files.filter((f) => f.extension === 'md');
    if (!notes.length) return null;
    const done = notes.filter((f) => this.isDone(noteProps(this.app, f))).length;
    return { done, total: notes.length, word: 'done' };
  }

  /**
   * One of a collection's details (type, description, includes, related,
   * featured, layout) set, or, given '', removed: kept by the plugin, by the
   * folder's path. No folder note is made; one from before has what it says
   * carried over first, and is left as it is.
   */
  async setField(folder, field, value) {
    if (!folder || (folder.isRoot && folder.isRoot())) return false;
    const note = this.plugin.folderNote(folder);
    const entry = Object.assign({}, this.dataOf(folder, note));
    if (value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length)) delete entry[field];
    else entry[field] = value;
    // Kept even when empty while a folder note is there: it stands in front of what the note says.
    if (Object.keys(entry).length || note) this.kept[folder.path] = entry;
    else delete this.kept[folder.path];
    await this.plugin.saveData(this.settings);
    this.changed();
    return true;
  }

  /** A collection's details as they were, put back: for an Undo. */
  async restore(folder, data) {
    if (data) this.kept[folder.path] = data;
    else delete this.kept[folder.path];
    await this.plugin.saveData(this.settings);
    this.changed();
  }

  /** Whatever shows collections drawn again. */
  changed() {
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
    const library = ask(this.plugin, 'library');
    if (library && typeof library.refreshViews === 'function') library.refreshViews();
    this.app.workspace.trigger('design-redux:albums-changed');
  }

  /**
   * One collection's lists and description joined into another's, as a
   * merge does (not the one it goes into, nor one listed already): an Undo
   * for it, or null when there was nothing to join.
   */
  async mergeInto(folder, target) {
    const theirs = this.dataOf(folder);
    const before = { from: this.kept[folder.path], into: this.kept[target.path] };
    const ours = Object.assign({}, this.dataOf(target));
    let joined = false;
    ['includes', 'related', 'featured'].forEach((field) => {
      const list = Array.isArray(ours[field]) ? ours[field].slice() : [];
      (theirs[field] || []).forEach((p) => {
        if (p === target.path || list.indexOf(p) !== -1) return;
        list.push(p);
        joined = true;
      });
      if (list.length) ours[field] = list;
    });
    if (theirs.description && !ours.description) {
      ours.description = theirs.description;
      joined = true;
    }
    if (!joined) return null;
    this.kept[target.path] = ours;
    await this.plugin.saveData(this.settings);
    this.changed();
    return async () => {
      if (before.into) this.kept[target.path] = before.into;
      else delete this.kept[target.path];
      if (before.from) this.kept[folder.path] = before.from;
      await this.plugin.saveData(this.settings);
      this.changed();
    };
  }

  /** What a collection lists that leads nowhere, taken off its lists. */
  async dropMissing(folder) {
    const data = this.dataOf(folder);
    for (const field of ['includes', 'related', 'featured']) {
      const list = data[field];
      if (!Array.isArray(list)) continue;
      const there = list.filter((p) => this.app.vault.getAbstractFileByPath(p));
      if (there.length !== list.length) await this.setField(folder, field, there);
    }
  }

  /** The ways a collection can open: [{ id, label, icon }]. */
  layouts() {
    return ALBUM_LAYOUTS;
  }

  /** What a collection's lists say, by path: for adding to one. */
  listOf(folder, field) {
    const list = this.dataOf(folder)[field];
    return Array.isArray(list) ? list.slice() : [];
  }

  setType(folder, type) {
    return this.setField(folder, 'type', type || '');
  }

  chooseType(folder) {
    if (!folder) return;
    const now = this.info(folder).type;
    const items = ALBUM_TYPES.map((t) => ({ label: t.label, note: t.id === now ? 'Now' : '', id: t.id }));
    if (now) items.push({ label: 'None', note: '', id: '' });
    new ComparePicker(this.app, items, `What kind of collection is ${folder.name}?`, (item) => this.setType(folder, item.id)).open();
  }

  /** The note listed in another album's includes; it stays where it is. */
  chooseAlbumFor(file) {
    if (!file) return;
    new FolderPicker(
      this.app,
      (folder) => this.include(folder, file),
      { placeholder: `Show ${file.basename} in which collection too?` }
    ).open();
  }

  async include(folder, file) {
    if (this.info(folder).includes.indexOf(file) !== -1) {
      new Notice(`${file.basename} is in ${folder.name} already.`);
      return false;
    }
    const ok = await this.setField(folder, 'includes', this.listOf(folder, 'includes').concat(file.path));
    if (ok) new Notice(`${file.basename} shows in ${folder.name} now, and stays where it is.`);
    return ok;
  }

  setLayout(folder, layout) {
    return this.setField(folder, 'layout', layout === 'list' ? '' : layout);
  }

  /** A note kept at the top of an album, or no longer: in its featured, by link. */
  async toggleFeatured(folder, file) {
    const list = this.listOf(folder, 'featured');
    const kept = list.filter((p) => p !== file.path);
    if (kept.length === list.length) kept.push(file.path);
    return this.setField(folder, 'featured', kept);
  }

  /** On a note's menu: kept at the top of its album, or not. */
  addFileItems(menu, file, sectioned, redraw) {
    const folder = file && file.parent;
    if (!this.enabled || !folder || (folder.isRoot && folder.isRoot()) || this.plugin.isFolderNote(file)) return;
    const on = this.info(folder).featured.indexOf(file) !== -1;
    menu.addItem((item) =>
      sectioned(item, 'action')
        .setTitle(on ? `Don’t keep at the top of ${folder.name}` : `Keep at the top of ${folder.name}`)
        .setIcon(on ? 'pin-off' : 'arrow-up-to-line')
        .onClick(async () => {
          if (await this.toggleFeatured(folder, file)) redraw();
        })
    );
  }

  /** On a folder's menu: what kind of album it is, and how it opens. */
  addFolderItems(menu, folder, sectioned, redraw) {
    if (!this.enabled || !folder || (folder.isRoot && folder.isRoot())) return;
    const info = this.info(folder);
    const now = info.type;
    menuGroup(
      menu,
      'Collection layout',
      'layout-grid',
      (m, nested) => {
        if (!nested) m = { addItem: (fn) => menu.addItem((item) => fn(sectioned(item, 'action'))) };
        ALBUM_LAYOUTS.forEach((l) =>
          m.addItem((item) =>
            item
              .setTitle(nested ? l.label : `Layout: ${l.label}`)
              .setIcon(l.icon)
              .setChecked(info.layout === l.id)
              .onClick(async () => {
                if (await this.setLayout(folder, l.id)) redraw();
              })
          )
        );
      },
      'action'
    );
    menuGroup(
      menu,
      'Kind of collection',
      'shapes',
      (m, nested) => {
        if (!nested) m = { addItem: (fn) => menu.addItem((item) => fn(sectioned(item, 'action'))) };
        ALBUM_TYPES.forEach((t) =>
          m.addItem((item) =>
            item
              .setTitle(nested ? t.label : `Collection: ${t.label}`)
              .setIcon(t.icon)
              .setChecked(now === t.id)
              .onClick(async () => {
                if (await this.setType(folder, now === t.id ? '' : t.id)) redraw();
              })
          )
        );
      },
      'action'
    );
  }
}

AlbumStructure.settingKey = 'albumStructure';
AlbumStructure.offers = ['albums'];
