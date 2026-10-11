/* ------------------------------------------------------------------ */
/* Smart albums                                                        */
/*                                                                     */
/* Filters kept as an album: a folder, a tag, a property — or one      */
/* missing, as "no parent" — and a date, with an order of their own,   */
/* and the notes grouped by a property if you like, so the same notes */
/* can be seen by subject, by status or by kind without moving any.    */
/* Saved from the filter button; listed in the library; opened as an   */
/* album whose chips can be changed and the changes saved.             */
/* ------------------------------------------------------------------ */

class SmartScreen extends BrowseScreen {
  get smart() {
    const smart = this.plugin.feature(SmartAlbums);
    return smart && smart.enabled ? smart : null;
  }

  album() {
    return this.smart ? this.smart.byId(this.view.property) : null;
  }

  title() {
    const album = this.album();
    return album ? album.name : 'Smart album';
  }

  render(root) {
    const view = this.view;
    const smart = this.smart;
    const album = this.album();
    if (!album) {
      view.renderTitleBar(root, 'Smart album');
      view.emptyState(root, 'This smart album isn’t there any more.', 'sparkles');
      return;
    }
    // Its filters, once on arriving; after that the chips are yours to change.
    if (view.smartLoaded !== album.id) {
      smart.apply(view, album);
      view.smartLoaded = album.id;
    }
    const files = view.sortFiles(smart.files(view));
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    view.renderSidebarToggle(bar);
    view.renderNav(bar);
    view.renderSearchField(bar);
    view.renderFilterChips(root);
    const changed = !smart.same(view, album);
    view.renderAlbumHead(root, {
      title: album.name,
      sub: album.group ? `Smart album · by ${this.plugin.propertyLabel(album.group)}` : 'Smart album',
      cover: null,
      glyph: 'sparkles',
      genName: view.genName(album.name, `smart/${album.id}`),
      files,
      onArtMenu: (evt) => smart.menu(evt, view, album),
    });
    const actions = root.querySelector('.dr-detail-actions');
    if (actions) {
      if (changed) {
        view.action(actions, 'save', 'Save changes', () => {
          smart.update(view, album);
          view.render();
        });
      }
      view.action(actions, 'ellipsis', 'More', (evt) => smart.menu(evt, view, album));
    }
    if (!files.length) {
      view.emptyState(root, 'Nothing matches its filters', 'sparkles');
      return;
    }
    view.renderDiscs(root, smart.discs(album, files, view), null);
    view.renderAlbumFoot(root, files);
  }
}

BROWSE_SCREENS.smart = SmartScreen;

let smartAlbumCount = 0;

class SmartAlbums extends Feature {
  settingsSchema() {
    return [
      {
        key: 'smartAlbums',
        name: 'Smart albums',
        desc: 'The filter button keeps its filters, order and grouping as an album, listed in the library. The notes stay where they are.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'smart-album-open',
        name: 'Open a smart album…',
        icon: 'sparkles',
        check: () => this.enabled && this.list().length > 0,
        run: () => this.choose(),
      },
      {
        id: 'smart-album-save',
        name: 'Keep these filters as a smart album…',
        icon: 'sparkles',
        check: () => {
          const view = this.enabled ? this.app.workspace.getActiveViewOfType(BrowseView) : null;
          return !!view && view.hasFilters();
        },
        run: () => this.askName(this.app.workspace.getActiveViewOfType(BrowseView)),
      },
    ];
  }

  list() {
    const list = this.settings.smartAlbumList;
    return Array.isArray(list) ? list.filter((a) => a && a.id && a.name) : [];
  }

  byId(id) {
    return this.list().find((a) => a.id === id) || null;
  }

  /** A view's filters, as kept: copies, so changing the chips doesn't change the album. */
  filtersOf(view) {
    const copy = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
    return { folder: view.filterFolder || null, tag: view.filterTag || null, prop: copy(view.filterProp), date: copy(view.filterDate) };
  }

  apply(view, album) {
    const copy = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
    view.filterFolder = album.folder || null;
    view.filterTag = album.tag || null;
    view.filterProp = copy(album.prop);
    view.filterDate = copy(album.date);
  }

  /** Whether the chips on screen are still the album's. */
  same(view, album) {
    const kept = { folder: album.folder || null, tag: album.tag || null, prop: album.prop || null, date: album.date || null };
    return JSON.stringify(this.filtersOf(view)) === JSON.stringify(kept);
  }

  /** The notes through its filters and Find; folder notes stand for their folders, so aren't among them. */
  files(view) {
    const hide = this.settings.hideFolderNotes !== false;
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => !(hide && this.plugin.isFolderNote(f)) && view.inFilter(f) && view.matches(f.basename));
  }

  /** One disc, or one per value of the property it's grouped by, those without it last. */
  discs(album, files) {
    if (!album.group) return [{ title: album.name, folder: null, files }];
    const groups = new Map();
    const none = [];
    files.forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const raw = cache && fmGet(cache.frontmatter, album.group);
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
    if (none.length) out.push({ title: `No ${this.plugin.propertyLabel(album.group)}`, folder: null, files: none });
    return out;
  }

  persist() {
    // saveData, not saveSettings: a list of albums isn't a setting, and a
    // full save re-runs every feature.
    this.plugin.saveData(this.settings);
    if (typeof this.app.workspace.getLeavesOfType === 'function') {
      liveViews(this.app, LIBRARY_VIEW, LibraryView).forEach((v) => v.render());
    }
  }

  /** The view's filters and order kept as a new album, which opens. */
  save(view, name) {
    const sort = view.currentSort();
    const album = Object.assign({ id: `${Date.now().toString(36)}${(smartAlbumCount++).toString(36)}`, name: String(name).trim() }, this.filtersOf(view));
    if (sort && sort !== 'own') album.sort = sort;
    if (!album.name) return null;
    this.settings.smartAlbumList = this.list().concat(album);
    this.listInLibrary();
    this.persist();
    view.navigate({ mode: 'smart', property: album.id, path: '/' });
    return album;
  }

  /** Listed in the library: added to its first section the first time, if it isn't there. */
  listInLibrary() {
    const sections = this.settings.librarySections;
    if (!Array.isArray(sections) || !sections.length) return;
    const listed = sections.some((s) => (s.items || []).some((i) => i.kind === 'builtin' && i.id === 'smart'));
    if (!listed) sections[0].items = (sections[0].items || []).concat({ kind: 'builtin', id: 'smart' });
  }

  update(view, album) {
    Object.assign(album, this.filtersOf(view));
    this.persist();
  }

  change(album, fields) {
    Object.assign(album, fields);
    Object.keys(fields).forEach((k) => {
      if (fields[k] === null || fields[k] === '') delete album[k];
    });
    this.persist();
  }

  remove(album) {
    this.settings.smartAlbumList = this.list().filter((a) => a !== album);
    this.persist();
  }

  askName(view, album) {
    if (!view) return;
    new NamePrompt(this.app, album ? 'Rename smart album' : 'New smart album', 'Name', (name) => {
      if (!String(name || '').trim()) return;
      if (album) {
        this.change(album, { name: String(name).trim() });
        view.render();
      } else this.save(view, name);
    }, { value: album ? album.name : '' }).open();
  }

  chooseGroup(view, album) {
    let keys = view.propertyList().map((p) => p.key);
    // Where Obsidian won't list its properties, the notes' own.
    if (!keys.length) {
      const seen = new Set();
      this.app.vault.getMarkdownFiles().forEach((f) => {
        const cache = this.app.metadataCache.getFileCache(f);
        Object.keys((cache && cache.frontmatter) || {}).forEach((k) => k !== 'position' && seen.add(k));
      });
      keys = Array.from(seen).sort(byName);
    }
    const items = keys.map((key) => ({ label: this.plugin.propertyLabel(key), note: key === album.group ? 'Now' : '', key }));
    if (album.group) items.unshift({ label: 'Not grouped', note: '', key: '' });
    new ComparePicker(this.app, items, 'Group the notes by…', (item) => {
      this.change(album, { group: item.key });
      view.render();
    }).open();
  }

  choose() {
    const items = this.list().map((a) => ({ label: a.name, note: '', a }));
    new ComparePicker(this.app, items, 'Which smart album?', (item) => this.plugin.feature(Library).browseMode({ mode: 'smart', property: item.a.id })).open();
  }

  menu(evt, view, album) {
    const menu = new Menu();
    const add = (title, icon, run) => menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(run));
    if (!this.same(view, album)) add('Save changes', 'save', () => {
      this.update(view, album);
      view.render();
    });
    add('Rename…', 'pencil', () => this.askName(view, album));
    add(album.group ? `Grouped by ${this.plugin.propertyLabel(album.group)}…` : 'Group by…', 'rows-3', () => this.chooseGroup(view, album));
    add('Delete smart album', 'trash-2', () => {
      this.remove(album);
      view.navigate({ mode: 'home', property: null });
    });
    showMenuAt(menu, evt);
  }

  /** On the filter button's menu: keep the filters as an album. */
  addFilterItems(menu, view) {
    if (!this.enabled || !view.hasFilters() || view.mode === 'smart') return;
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('Keep as a smart album…').setIcon('sparkles').onClick(() => this.askName(view)));
  }

  /** In the library: a row each. */
  renderRows(library, list) {
    if (!this.enabled) return;
    this.list().forEach((album) =>
      library.row(list, {
        icon: 'sparkles',
        label: album.name,
        screen: 'smart',
        property: album.id,
        onClick: () => library.browseMode({ mode: 'smart', property: album.id }),
      })
    );
  }
}

SmartAlbums.settingKey = 'smartAlbums';
