/* ------------------------------------------------------------------ */
/* Smart collections                                                        */
/*                                                                     */
/* Filters kept as a collection: a folder, a tag, a property — or one      */
/* missing, as "no parent" — and a date, with an order of their own,   */
/* and the notes grouped by a property if you like, so the same notes */
/* can be seen by subject, by status or by kind without moving any.    */
/* Saved from the filter button; listed in the library; opened as an   */
/* collection whose chips can be changed and the changes saved.             */
/* ------------------------------------------------------------------ */

import { Menu } from 'obsidian';
import { LIBRARY_VIEW } from '../core/020-constants.js';
import { byName, liveViews, showMenuAt } from '../core/030-helpers-art.js';
import { fmGet, plainValue } from '../core/045-helpers-properties.js';
import { noteProps } from '../core/073-notes.js';
import { libraryIndex } from '../core/077-library-index.js';
import { Feature } from '../core/080-feature.js';
import { LibraryView } from './100-library.js';
import { BrowseScreen } from './108-browse-screen.js';
import { BrowseView } from './120-browse-view.js';
import { Library } from './130-browse-filters.js';
import { ComparePicker, NamePrompt } from '../ui/230-pickers.js';

export class SmartScreen extends BrowseScreen {
  get smart() {
    const smart = this.plugin.feature(SmartCollections);
    return smart && smart.enabled ? smart : null;
  }

  collection() {
    return this.smart ? this.smart.byId(this.view.property) : null;
  }

  title() {
    const collection = this.collection();
    return collection ? collection.name : 'Saved view';
  }

  render(root) {
    const view = this.view;
    const smart = this.smart;
    const collection = this.collection();
    if (!collection) {
      view.renderTitleBar(root, 'Saved view');
      view.emptyState(root, 'This saved view isn’t there any more.', 'sparkles');
      return;
    }
    // Its filters, once on arriving; after that the chips are yours to change.
    if (view.smartLoaded !== collection.id) {
      smart.apply(view, collection);
      view.smartLoaded = collection.id;
    }
    const files = view.sortFiles(smart.files(view));
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    view.renderSidebarToggle(bar);
    view.renderNav(bar);
    view.renderSearchField(bar);
    view.renderFilterChips(root);
    const changed = !smart.same(view, collection);
    view.renderCollectionHead(root, {
      title: collection.name,
      sub: collection.group ? `Saved view · by ${this.plugin.propertyLabel(collection.group)}` : 'Saved view',
      cover: null,
      glyph: 'sparkles',
      genName: view.genName(collection.name, `smart/${collection.id}`),
      files,
      onArtMenu: (evt) => smart.menu(evt, view, collection),
    });
    const actions = root.querySelector('.dr-detail-actions');
    if (actions) {
      if (changed) {
        view.action(actions, 'save', 'Save changes', () => {
          smart.update(view, collection);
          view.render();
        });
      }
      view.action(actions, 'ellipsis', 'More', (evt) => smart.menu(evt, view, collection));
    }
    if (!files.length) {
      view.emptyState(root, 'Nothing matches its filters', 'sparkles');
      return;
    }
    view.renderSections(root, smart.sections(collection, files, view), null);
    view.renderCollectionFoot(root, files);
  }
}

export let smartCollectionCount = 0;

export class SmartCollections extends Feature {
  settingsSchema() {
    return [
      {
        key: 'smartCollections',
        name: 'Saved views',
        desc: 'The filter button keeps its filters, order and grouping as a collection, listed in the library. The notes stay where they are.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'smart-album-open',
        name: 'Open a saved view…',
        icon: 'sparkles',
        when: () => this.enabled && this.list().length > 0,
        run: () => this.choose(),
      },
      {
        id: 'smart-album-save',
        name: 'Keep these filters as a saved view…',
        icon: 'sparkles',
        when: () => {
          const view = this.enabled ? this.app.workspace.getActiveViewOfType(BrowseView) : null;
          return !!view && view.hasFilters();
        },
        run: () => this.askName(this.app.workspace.getActiveViewOfType(BrowseView)),
      },
    ];
  }

  list() {
    const list = this.settings.smartCollectionList;
    return Array.isArray(list) ? list.filter((a) => a && a.id && a.name) : [];
  }

  byId(id) {
    return this.list().find((a) => a.id === id) || null;
  }

  /** A view's filters, as kept: copies, so changing the chips doesn't change the collection. */
  filtersOf(view) {
    const copy = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
    const out = { folder: view.filterFolder || null, tag: view.filterTag || null, prop: copy(view.filterProp), date: copy(view.filterDate) };
    // More property filters, only when there are: a collection kept before them stays the same.
    if (view.filterMore && view.filterMore.length) out.more = copy(view.filterMore);
    return out;
  }

  apply(view, collection) {
    const copy = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
    view.filterFolder = collection.folder || null;
    view.filterTag = collection.tag || null;
    view.filterProp = copy(collection.prop);
    view.filterMore = copy(collection.more) || [];
    view.filterDate = copy(collection.date);
  }

  /** Whether the chips on screen are still the collection's. */
  same(view, collection) {
    const kept = { folder: collection.folder || null, tag: collection.tag || null, prop: collection.prop || null, date: collection.date || null };
    if (collection.more && collection.more.length) kept.more = collection.more;
    return JSON.stringify(this.filtersOf(view)) === JSON.stringify(kept);
  }

  /** The notes through its filters and Find; folder notes stand for their folders, so aren't among them. */
  files(view) {
    const hide = this.settings.hideFolderNotes !== false;
    return libraryIndex(this.plugin)
      .markdown()
      .filter((f) => !(hide && this.plugin.isFolderNote(f)) && view.inFilter(f) && view.matches(f.basename));
  }

  /** One section, or one per value of the property it's grouped by, those without it last. */
  sections(collection, files) {
    if (!collection.group) return [{ title: collection.name, folder: null, files }];
    const groups = new Map();
    const none = [];
    files.forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const raw = cache && fmGet(cache.frontmatter, collection.group);
      const values = (Array.isArray(raw) ? raw : [raw]).map((v) => (v === null || v === undefined ? '' : plainValue(v))).filter(Boolean);
      if (!values.length) none.push(file);
      values.forEach((v) => {
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(file);
      });
    });
    const out = Array.from(groups.keys())
      .sort(byName)
      .map((v) => ({ title: v, folder: null, files: groups.get(v) }));
    if (none.length) out.push({ title: `No ${this.plugin.propertyLabel(collection.group)}`, folder: null, files: none });
    return out;
  }

  persist() {
    // saveData, not saveSettings: a list of collections isn't a setting, and a
    // full save re-runs every feature.
    this.plugin.saveData(this.settings);
    if (typeof this.app.workspace.getLeavesOfType === 'function') {
      liveViews(this.app, LIBRARY_VIEW, LibraryView).forEach((v) => v.render());
    }
  }

  /** The view's filters and order kept as a new collection, which opens. */
  save(view, name) {
    const sort = view.currentSort();
    const collection = Object.assign({ id: `${Date.now().toString(36)}${(smartCollectionCount++).toString(36)}`, name: String(name).trim() }, this.filtersOf(view));
    if (sort && sort !== 'own') collection.sort = sort;
    if (!collection.name) return null;
    this.settings.smartCollectionList = this.list().concat(collection);
    this.listInLibrary();
    this.persist();
    view.navigate({ mode: 'smart', property: collection.id, path: '/' });
    return collection;
  }

  /** Listed in the library: added to its first section the first time, if it isn't there. */
  listInLibrary() {
    const sections = this.settings.librarySections;
    if (!Array.isArray(sections) || !sections.length) return;
    const listed = sections.some((s) => (s.items || []).some((i) => i.kind === 'builtin' && i.id === 'smart'));
    if (!listed) sections[0].items = (sections[0].items || []).concat({ kind: 'builtin', id: 'smart' });
  }

  update(view, collection) {
    Object.assign(collection, this.filtersOf(view));
    this.persist();
  }

  change(collection, fields) {
    Object.assign(collection, fields);
    Object.keys(fields).forEach((k) => {
      if (fields[k] === null || fields[k] === '') delete collection[k];
    });
    this.persist();
  }

  remove(collection) {
    this.settings.smartCollectionList = this.list().filter((a) => a !== collection);
    this.persist();
  }

  askName(view, collection) {
    if (!view) return;
    new NamePrompt(this.app, collection ? 'Rename saved view' : 'New saved view', 'Name', (name) => {
      if (!String(name || '').trim()) return;
      if (collection) {
        this.change(collection, { name: String(name).trim() });
        view.render();
      } else this.save(view, name);
    }, { value: collection ? collection.name : '' }).open();
  }

  chooseGroup(view, collection) {
    let keys = view.propertyList().map((p) => p.key);
    // Where Obsidian won't list its properties, the notes' own.
    if (!keys.length) {
      const seen = new Set();
      libraryIndex(this.plugin).markdown().forEach((f) => {
        Object.keys(noteProps(this.app, f)).forEach((k) => k !== 'position' && seen.add(k));
      });
      keys = Array.from(seen).sort(byName);
    }
    const items = keys.map((key) => ({ label: this.plugin.propertyLabel(key), note: key === collection.group ? 'Now' : '', key }));
    if (collection.group) items.unshift({ label: 'Not grouped', note: '', key: '' });
    new ComparePicker(this.app, items, 'Group the notes by…', (item) => {
      this.change(collection, { group: item.key });
      view.render();
    }).open();
  }

  choose() {
    const items = this.list().map((a) => ({ label: a.name, note: '', a }));
    new ComparePicker(this.app, items, 'Which saved view?', (item) => this.plugin.feature(Library).browseMode({ mode: 'smart', property: item.a.id })).open();
  }

  menu(evt, view, collection) {
    const menu = new Menu();
    const add = (title, icon, run) => menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(run));
    if (!this.same(view, collection)) add('Save changes', 'save', () => {
      this.update(view, collection);
      view.render();
    });
    add('Rename…', 'pencil', () => this.askName(view, collection));
    add('Properties of these notes…', 'list', () => view.propertyToolsFor(this.files(view)));
    add(collection.group ? `Grouped by ${this.plugin.propertyLabel(collection.group)}…` : 'Group by…', 'rows-3', () => this.chooseGroup(view, collection));
    add('Delete saved view', 'trash-2', () => {
      this.remove(collection);
      view.navigate({ mode: 'home', property: null });
    });
    showMenuAt(menu, evt);
  }

  /** On the filter button's menu: keep the filters as a collection. */
  addFilterItems(menu, view) {
    if (!this.enabled || !view.hasFilters() || view.mode === 'smart') return;
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('Keep as a saved view…').setIcon('sparkles').onClick(() => this.askName(view)));
  }

  /** In the library: a row each. */
  renderRows(library, list) {
    if (!this.enabled) return;
    this.list().forEach((collection) =>
      library.row(list, {
        icon: 'sparkles',
        label: collection.name,
        screen: 'smart',
        property: collection.id,
        onClick: () => library.browseMode({ mode: 'smart', property: collection.id }),
      })
    );
  }
}

SmartCollections.settingKey = 'smartCollections';
