/* ------------------------------------------------------------------ */
/* Browse view: sorting and filtering                                 */
/*                                                                    */
/* The order every screen shares; filters on properties, tags and     */
/* dates; the Find field. Methods of BrowseView, put on by mixInto.   */
/* ------------------------------------------------------------------ */

class BrowseSorting {
  /** A property, tag or value renamed by the bulk tools: what this screen shows and filters by follows. */
  followRenamed(what) {
    if (what.property) {
      const [from, to] = what.property;
      if (this.property && this.property.toLowerCase() === from.toLowerCase()) {
        this.property = to.toLowerCase();
      }
      if (this.filterProp && String(this.filterProp.key).toLowerCase() === from.toLowerCase()) {
        this.filterProp = Object.assign({}, this.filterProp, { key: to });
      }
    }
    if (what.tag) {
      const [from, to] = what.tag;
      if (this.filterTag && tagUnder(this.filterTag, from)) {
        this.filterTag = renameTagText(this.filterTag, from, to).toLowerCase();
      }
    }
    if (what.value) {
      const [key, from, to] = what.value;
      const sameKey = (k) => String(k || '').toLowerCase() === key.toLowerCase();
      if (sameKey(this.property) && this.value === from) this.value = to;
      if (this.filterProp && sameKey(this.filterProp.key) && this.filterProp.value === from) {
        this.filterProp = Object.assign({}, this.filterProp, { value: to });
      }
    }
  }

  /* -- sorting and filtering ------------------------------------- */

  /** The one ordering every screen uses, so a choice sticks. */
  sortFiles(files) {
    return sortByOrder(files, this.sort);
  }

  /**
   * Folders in the shared order: by name either way, or by their
   * newest note — a folder's own dates say nothing about what's in it.
   */
  sortFolders(folders) {
    const sort = this.sort;
    const list = folders.slice();
    if (sort === 'name-desc') return list.sort((a, b) => byName(b.name, a.name));
    if (sort === 'modified' || sort === 'created') {
      return list.sort(
        (a, b) => this.folderTime(b, sort) - this.folderTime(a, sort) || byName(a.name, b.name)
      );
    }
    return list.sort((a, b) => byName(a.name, b.name));
  }

  /** The newest note anywhere in a folder. Worked out once per drawing. */
  folderTime(folder, field) {
    if (!this.timeMemo) {
      const memo = { modified: new Map(), created: new Map() };
      this.app.vault.getMarkdownFiles().forEach((file) => {
        for (let p = file.parent; p; p = p.parent) {
          memo.modified.set(p.path, Math.max(memo.modified.get(p.path) || 0, file.stat.mtime));
          memo.created.set(p.path, Math.max(memo.created.get(p.path) || 0, file.stat.ctime));
          if (p.isRoot && p.isRoot()) break;
        }
      });
      this.timeMemo = memo;
      window.setTimeout(() => (this.timeMemo = null), 0);
    }
    return this.timeMemo[field].get(folder.path) || 0;
  }

  /** A property's values in the shared order: by value, or by their newest note. */
  sortGroups(groups) {
    const sort = this.sort;
    const newest = (g) =>
      g.files.reduce((t, f) => Math.max(t, sort === 'created' ? f.stat.ctime : f.stat.mtime), 0);
    const list = groups.slice();
    if (sort === 'name-desc') return list.sort((a, b) => byName(b.value, a.value));
    if (sort === 'modified' || sort === 'created') {
      return list.sort((a, b) => newest(b) - newest(a) || byName(a.value, b.value));
    }
    return list.sort((a, b) => byName(a.value, b.value));
  }

  /**
   * The order every screen uses. One, kept in settings, so a choice made
   * on any screen holds on all of them — in every open tab, after a
   * note has been opened and closed, and after a restart.
   */
  get sort() {
    const settings = this.plugin.settings;
    // A smart album keeps its own order.
    const smart = this.mode === 'smart' ? this.smartAlbum() : null;
    if (smart && smart.sort && SORTS.some(([key]) => key === smart.sort)) return smart.sort;
    // An album sorted on its own keeps that order; everywhere else, the shared one.
    if (this.mode === 'folder' && settings.albumSortMemory !== false) {
      const kept = (settings.albumSorts || {})[this.path];
      if (kept && SORTS.some(([key]) => key === kept)) return kept;
    }
    return settings.defaultSort || 'name';
  }

  /** How the Notes table is sorted: its own column, or the shared order. */
  get tableSort() {
    return this.columnSort || TABLE_SORTS[this.sort] || TABLE_SORTS.name;
  }

  /**
   * The name of this screen's own order, if it has one: Recently opened
   * and Pinned always do, and an album does once it's been arranged.
   */
  ownOrderLabel() {
    if (this.mode === 'folder') {
      const folder = this.folder();
      return folder && this.plugin.orders.hasAlbum(folder) ? 'Album order' : null;
    }
    return OWN_ORDER[this.mode] || null;
  }

  /** Whether this screen keeps its own order — Recently opened, Pinned, an arranged album. */
  keepsOwnOrder() {
    if (this.mode === 'folder') {
      const folder = this.folder();
      return !!folder && this.plugin.orders.albumOn(folder);
    }
    if (!OWN_ORDER[this.mode]) return false;
    const own = this.plugin.settings.keepOwnOrder || {};
    return own[this.mode] !== false;
  }

  /**
   * Choose an order. 'own' goes back to a screen's own; anything else
   * becomes the order everywhere, and every open screen redraws in it.
   */
  setSort(key) {
    const settings = this.plugin.settings;
    if (this.mode === 'folder') {
      // An arranged album keeps its arrangement to go back to.
      const folder = this.folder();
      if (folder && this.plugin.orders.hasAlbum(folder)) this.plugin.orders.setAlbumOn(folder, key === 'own');
    } else if (OWN_ORDER[this.mode]) {
      settings.keepOwnOrder = Object.assign({}, settings.keepOwnOrder, {
        [this.mode]: key === 'own',
      });
    }
    const smart = this.mode === 'smart' ? this.smartAlbum() : null;
    if (smart && key !== 'own') this.plugin.feature(SmartAlbums).change(smart, { sort: key });
    else if (key !== 'own') {
      const folder = this.mode === 'folder' ? this.folder() : null;
      // An album's order is its own, kept by its path; other screens share one.
      if (folder && settings.albumSortMemory !== false) {
        settings.albumSorts = Object.assign({}, settings.albumSorts, { [folder.path]: key });
      } else settings.defaultSort = key;
    }
    this.columnSort = null;
    this.plugin.saveData(settings);

    if (typeof this.app.workspace.getLeavesOfType !== 'function') return;
    liveViews(this.app, BROWSE_VIEW, BrowseView).forEach((view) => {
      if (view === this) return;
      view.columnSort = null;
      view.render();
    });
  }

  /** Where a screen has nothing: a quiet icon, why, and at most one thing to do. */
  emptyState(root, text, icon, action) {
    const box = root.createDiv({ cls: 'dr-empty' });
    if (icon) setIcon(box.createSpan({ cls: 'dr-empty-icon', attr: { 'aria-hidden': 'true' } }), icon);
    box.createSpan({ cls: 'dr-empty-text', text });
    if (action) {
      const button = box.createSpan({ cls: 'dr-empty-action', text: action[0] });
      asButton(button);
      onActivate(button, action[1]);
    }
    return box;
  }

  /** Clear filters, where Find or a filter is why nothing shows; otherwise none. */
  clearAction() {
    if (!this.query.trim() && !this.hasFilters()) return null;
    return [
      'Clear filters',
      () => {
        this.clearFilters();
        this.query = '';
        this.render();
      },
    ];
  }

  /** The smart album on screen, if it's one. */
  smartAlbum() {
    const smart = typeof SmartAlbums === 'function' ? this.plugin.feature(SmartAlbums) : null;
    return smart && smart.enabled ? smart.byId(this.property) : null;
  }

  /** The order in effect, as the menu names it; null for a column it doesn't list. */
  currentSort() {
    if (this.keepsOwnOrder()) return 'own';
    if (this.mode === 'notes' && this.columnSort) return null;
    return this.sort;
  }

  /** Through every filter that's set. */
  inFilter(file) {
    if (this.filterFolder && !file.path.startsWith(this.filterFolder + '/')) return false;
    if (!this.filterTag && !this.filterProp && !this.filterDate) return true;

    if (this.filterDate) {
      const stat = file.stat || {};
      const time = this.filterDate.field === 'created' ? stat.ctime : stat.mtime;
      if (!time || time < dateFloor(this.filterDate.range)) return false;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    if (this.filterTag) {
      const want = this.filterTag;
      // A parent tag takes in the ones nested under it, as in Obsidian.
      if (!noteTags(cache).some((t) => t === want || t.startsWith(want + '/'))) return false;
    }

    if (this.filterProp) {
      const f = this.filterProp;
      const fm = (cache && cache.frontmatter) || {};
      const name = Object.keys(fm).find((k) => k.toLowerCase() === f.key.toLowerCase());
      const raw = name === undefined ? undefined : fm[name];
      const values = (Array.isArray(raw) ? raw : [raw])
        .filter((v) => v !== null && v !== undefined && v !== '')
        .map((v) => plainValue(v).toLowerCase());
      const has =
        f.value === null || f.value === undefined
          ? values.length > 0
          : values.indexOf(String(f.value).toLowerCase()) !== -1;
      if (has === !!f.negate) return false;
    }
    return true;
  }

  hasFilters() {
    return !!(this.filterFolder || this.filterTag || this.filterProp || this.filterDate);
  }

  clearFilters() {
    this.filterFolder = null;
    this.filterTag = null;
    this.filterProp = null;
    this.filterDate = null;
  }

  /**
   * A folder shown as a tile: under the folder filter, and — while a
   * tag, property or date filter is on — holding at least one note that
   * passes, anywhere inside it. Worked out once per drawing.
   */
  folderInFilter(folder) {
    if (this.filterFolder && !folder.path.startsWith(this.filterFolder + '/')) return false;
    if (!this.filterTag && !this.filterProp && !this.filterDate) return true;
    if (!this.filterMemo) {
      const paths = new Set();
      this.app.vault.getMarkdownFiles().forEach((file) => {
        if (!this.inFilter(file)) return;
        for (let p = file.parent; p && !(p.isRoot && p.isRoot()); p = p.parent) paths.add(p.path);
      });
      this.filterMemo = paths;
      window.setTimeout(() => (this.filterMemo = null), 0);
    }
    return this.filterMemo.has(folder.path);
  }

  renderFilterButton(bar) {
    const btn = bar.createDiv({ cls: 'clickable-icon dr-filter-btn' });
    btn.setAttribute('aria-label', 'Sort, filter and view');
    setIcon(btn, 'list-filter');
    const usual = this.ownOrderLabel() ? 'own' : 'name';
    if (this.hasFilters() || this.currentSort() !== usual) btn.addClass('is-active');

    asButton(btn);
    onActivate(btn, (evt) => showMenuAt(this.filterMenu(), evt));
  }

  /**
   * Sort, then the filters. A filter that's on shows what it's set to,
   * ticked; choosing it again turns it off, and the chips under the bar
   * change or remove one without the menu.
   */
  filterMenu() {
    const menu = new Menu();
    const redraw = () => this.render();

    const current = this.currentSort();
    const own = this.ownOrderLabel();
    const orders = own ? [['own', own]].concat(SORTS) : SORTS;
    orders.forEach(([key, label]) =>
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(current === key)
          .onClick(() => {
            this.setSort(key);
            redraw();
          })
      )
    );

    // Covers on a screen of albums, grouped.
    if (this.mode === 'folders' || (this.mode === 'folder' && this.isShelf(this.folder()))) {
      menu.addSeparator();
      const structure = typeof AlbumStructure === 'function' ? this.plugin.feature(AlbumStructure) : null;
      const by = this.plugin.settings.tileGroups || '';
      Object.keys(TILE_GROUPS)
        .filter((key) => (key !== 'kind' || (structure && structure.enabled)) && (key !== 'collection' || this.mode === 'folders'))
        .forEach((key) =>
          menu.addItem((item) =>
            item
              .setTitle(key ? `Grouped by ${TILE_GROUPS[key].toLowerCase()}` : 'Not grouped')
              .setChecked(by === key)
              .onClick(() => {
                this.plugin.settings.tileGroups = key;
                this.plugin.saveData(this.plugin.settings);
                redraw();
              })
          )
        );
    }

    this.addViewItems(menu, redraw);

    menu.addSeparator();
    const filter = (title, icon, on, pick, clear) =>
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .setChecked(on)
          .onClick(() => {
            if (!on) return pick();
            clear();
            redraw();
          })
      );

    filter(
      this.filterFolder ? `In ${this.filterFolder.split('/').pop()}` : 'Folder…',
      'folder', !!this.filterFolder,
      () => this.pickFolder(), () => (this.filterFolder = null)
    );
    filter(
      this.filterTag ? `Tagged #${this.filterTag}` : 'Tag…',
      'tag', !!this.filterTag,
      () => this.pickTag(), () => (this.filterTag = null)
    );
    filter(
      this.filterProp ? propertyFilterLabel(this.filterProp) : 'Property…',
      'list', !!this.filterProp,
      () => this.pickProperty(), () => (this.filterProp = null)
    );
    if (this.filterProp) {
      menu.addItem((item) =>
        item
          .setTitle('Exclude these instead')
          .setIcon('minus-circle')
          .setChecked(!!this.filterProp.negate)
          .onClick(() => {
            this.filterProp.negate = !this.filterProp.negate;
            redraw();
          })
      );
    }
    filter(
      this.filterDate ? dateFilterLabel(this.filterDate) : 'Date…',
      'calendar', !!this.filterDate,
      () => this.pickDate(), () => (this.filterDate = null)
    );

    const smart = typeof SmartAlbums === 'function' ? this.plugin.feature(SmartAlbums) : null;
    if (smart) smart.addFilterItems(menu, this);

    if (this.hasFilters()) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle('Clear filters')
          .setIcon('x')
          .onClick(() => {
            this.clearFilters();
            redraw();
          })
      );
    }

    // What this screen shows, and how, in settings.
    if (typeof this.plugin.openSettingsAt === 'function') {
      menu.addSeparator();
      const key = { home: 'homeShelves', folder: 'albumColumns', notes: 'tableColumns' }[this.mode] || 'gridDensity';
      menu.addItem((item) => item.setTitle('Display settings…').setIcon('settings').onClick(() => this.plugin.openSettingsAt(key)));
    }
    return menu;
  }

  /** An album shown as a list, covers, a table, an overview or its map — as its folder note says, set from here. */
  addViewItems(menu, redraw) {
    const structure = typeof AlbumStructure === 'function' ? this.plugin.feature(AlbumStructure) : null;
    const folder = this.mode === 'folder' ? this.folder() : null;
    if (!structure || !structure.enabled || !folder || this.isShelf(folder)) return;
    const now = structure.info(folder).layout;
    menu.addSeparator();
    ALBUM_LAYOUTS.forEach((l) =>
      menu.addItem((item) =>
        item
          .setTitle(`View as ${l.label.toLowerCase()}`)
          .setIcon(l.icon)
          .setChecked(now === l.id)
          .onClick(async () => {
            if (await structure.setLayout(folder, l.id)) redraw();
          })
      )
    );
  }

  pickFolder() {
    new FolderPicker(this.app, (folder) => {
      this.filterFolder = folder.path;
      this.render();
    }).open();
  }

  pickTag() {
    const items = vaultTags(this.app).map(({ tag, count }) => ({
      label: `#${tag}`,
      value: tag,
      note: String(count),
    }));
    new ChoicePicker(this.app, 'Which tag?', items, (item) => {
      this.filterTag = item.value;
      this.render();
    }).open();
  }

  /** The property, then its value — or any value at all. */
  pickProperty() {
    const items = knownPropertyNames(this.app).map((name) => ({ label: name, value: name }));
    new ChoicePicker(this.app, 'Which property?', items, (item) => {
      const key = item.value;
      const values = [{ label: `Has any ${key}`, value: null }].concat(
        propertyValues(this.app, key).map((v) => ({ label: v, value: v }))
      );
      new ChoicePicker(this.app, `${key} is…`, values, (choice) => {
        this.filterProp = { key: key, value: choice.value, negate: false };
        this.render();
      }).open();
    }).open();
  }

  pickDate() {
    const items = [];
    ['modified', 'created'].forEach((field) =>
      Object.keys(DATE_RANGES).forEach((range) =>
        items.push({ label: dateFilterLabel({ field, range }), value: { field, range } })
      )
    );
    new ChoicePicker(this.app, 'When?', items, (item) => {
      this.filterDate = item.value;
      this.render();
    }).open();
  }

  /**
   * The filters in effect, as chips under the bar — so a narrowed screen
   * never passes for the whole of something. A chip's name changes it;
   * its cross takes it off.
   */
  renderFilterChips(root) {
    const chips = [];
    if (this.filterFolder) {
      chips.push([`In ${this.filterFolder.split('/').pop()}`, () => this.pickFolder(), () => (this.filterFolder = null)]);
    }
    if (this.filterTag) {
      chips.push([`#${this.filterTag}`, () => this.pickTag(), () => (this.filterTag = null)]);
    }
    if (this.filterProp) {
      chips.push([propertyFilterLabel(this.filterProp), () => this.pickProperty(), () => (this.filterProp = null)]);
    }
    if (this.filterDate) {
      chips.push([dateFilterLabel(this.filterDate), () => this.pickDate(), () => (this.filterDate = null)]);
    }
    // Find looks in this screen; a press takes what's typed to the whole library.
    const find = this.query.trim();
    if (!chips.length && !(find && this.mode !== 'search')) return;

    const row = root.createDiv({ cls: 'dr-filter-chips' });
    if (find && this.mode !== 'search') {
      const wide = row.createDiv({ cls: 'dr-chip dr-chip-wide' });
      setIcon(wide.createSpan({ cls: 'dr-chip-icon' }), 'search');
      const label = wide.createSpan({ cls: 'dr-chip-label', text: `Search everywhere for “${find}”` });
      asButton(label);
      onActivate(label, () => this.navigate({ mode: 'search', property: null, path: '/', query: find }));
    }
    chips.forEach(([label, change, clear]) => {
      const chip = row.createDiv({ cls: 'dr-chip' });
      const name = chip.createSpan({ cls: 'dr-chip-label', text: label });
      asButton(name, `Change: ${label}`);
      onActivate(name, change);
      const x = chip.createSpan({ cls: 'dr-chip-clear' });
      asButton(x, `Remove: ${label}`);
      setIcon(x, 'x');
      onActivate(x, () => {
        clear();
        this.render();
      });
    });
  }

  /**
   * Keep a finished search — Enter, opening a result, or leaving the
   * screen with something typed. Saved with saveData rather than
   * saveSettings: a list of searches is not a setting, and a full
   * settings save re-runs every feature in the plugin.
   */
  async rememberSearch() {
    const term = this.query.trim();
    if (this.mode !== 'search' || term.length < 2) return;
    const settings = this.plugin.settings;
    const list = (settings.recentSearches || []).filter(
      (t) => t.toLowerCase() !== term.toLowerCase()
    );
    list.unshift(term);
    settings.recentSearches = collapseSearches(list).slice(0, 8);
    await this.plugin.saveData(settings);
  }

  /**
   * Redraw everything except the bar, for changes that don't alter it —
   * a query being typed, or data arriving while someone types. The
   * screen is drawn off to one side and everything after its bar is
   * moved in, so the bar on screen, and the field in it, stay put.
   */
  renderBelowBar() {
    const root = this.contentEl;
    const bar = root.firstElementChild;
    if (!bar || !bar.classList.contains('dr-detail-bar')) {
      this.render();
      return;
    }

    const scratch = root.ownerDocument.createElement('div');
    this.beginDrawing();
    try {
      this.screen().render(scratch);
    } catch (err) {
      this.render();
      return;
    }
    this.measureLater();

    const fresh = Array.from(scratch.children);
    if (fresh[0] && fresh[0].classList.contains('dr-detail-bar')) fresh.shift();
    while (bar.nextSibling) bar.nextSibling.remove();
    fresh.forEach((el) => root.appendChild(el));
  }

  renderSearchField(bar) {
    this.renderFilterButton(bar);
    this.renderPreviewToggle(bar);

    const search = bar.createDiv({ cls: 'dr-browse-search' });
    setIcon(search.createSpan({ cls: 'dr-browse-search-icon' }), 'search');

    const input = search.createEl('input', { type: 'text' });
    input.placeholder =
      this.mode === 'search' ? 'Search' : `Find in ${this.getDisplayText()}`;
    input.value = this.query;

    // Enter finishes a search. Leaving the field doesn't: it used to,
    // and every redraw counted as leaving it.
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !composing(evt)) this.rememberSearch();
      // Escape clears what's typed; with nothing typed, it leaves the field.
      if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        if (input.value) {
          input.value = '';
          this.query = '';
          window.clearTimeout(this.findTimer);
          this.renderBelowBar();
        } else {
          input.blur();
        }
      }
    });

    // Only what's below the bar is redrawn, so the field being typed in
    // is never replaced — which kept the caret and focus without having
    // to put them back, and stopped each keystroke looking like a blur.
    // A short pause first, so a long list isn't rebuilt per letter.
    input.addEventListener('input', () => {
      this.query = input.value;
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.renderBelowBar(), 90);
    });
  }

  action(parentEl, icon, label, onClick) {
    const btn = parentEl.createDiv({ cls: 'dr-detail-action' });
    asButton(btn);
    setIcon(btn.createSpan({ cls: 'dr-detail-action-icon' }), icon);
    btn.createSpan({ text: label });
    onActivate(btn, onClick);
    return btn;
  }
}

mixInto(BrowseView, BrowseSorting);
