/* ------------------------------------------------------------------ */
/* Choosing what goes in the list                                      */
/* ------------------------------------------------------------------ */

class LibraryItemPicker extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChooseItem_ = onChoose;
    this.setPlaceholder('Add a destination, folder, base or note');
  }

  getItems() {
    const items = Object.keys(LIBRARY_BUILTINS).map((id) => ({
      kind: 'builtin',
      id: id,
      text: LIBRARY_BUILTINS[id].label,
    }));

    const walk = (folder) => {
      (folder.children || []).forEach((child) => {
        if (child instanceof TFolder) {
          items.push({ kind: 'folder', path: child.path, text: child.path + '/' });
          walk(child);
        }
      });
    };
    walk(this.app.vault.getRoot());

    this.app.vault.getFiles().forEach((f) => {
      if (f.extension !== 'base' && f.extension !== 'canvas' && f.extension !== 'md') return;
      items.push({ kind: 'file', path: f.path, text: f.path });
    });

    // A property, opening the Properties screen at its values.
    knownPropertyNames(this.app).forEach((name) =>
      items.push({ kind: 'property', key: name.toLowerCase(), text: `By ${name}` })
    );

    return items;
  }

  getItemText(item) {
    return item.text;
  }

  onChooseItem(item) {
    this.onChooseItem_(item);
  }
}

class Library extends Feature {
  settingsSchema() {
    return [
      {
        key: 'library',
        name: 'Library',
        desc: 'A sidebar of the places you choose, where folders open as albums.',
      },
      {
        key: 'singleArea',
        desktopOnly: true,
        name: 'Hide the tab bar',
        desc: 'Move through one page with back and forward. Tabs still work behind it.',
        showIf: 'library',
      },
      {
        key: 'hideEmptyFolders',
        name: 'Hide empty folders',
        desc: 'Leave out folders with no notes, counting subfolders.',
        showIf: 'library',
      },
      {
        key: 'categoryProperty',
        type: 'text',
        name: 'Search categories',
        desc: 'The property whose values become categories on the Search screen. Empty for none.',
        placeholder: 'domain',
        fallback: '',
        showIf: 'library',
        suggest: 'property',
      },
      {
        key: 'tableColumns',
        type: 'text',
        name: 'Notes table columns',
        desc: 'The properties shown as columns on the Notes screen, separated by commas.',
        placeholder: 'domain, status',
        fallback: 'domain, status',
        showIf: 'library',
        suggest: 'properties',
      },
      {
        key: 'defaultSort',
        type: 'dropdown',
        showIf: 'library',
        name: 'Sort order',
        desc: 'How lists are sorted. A screen’s filter button changes it there; arranged albums keep their own order.',
        options: Object.fromEntries(SORTS),
      },
      {
        key: 'albumSortMemory',
        showIf: 'library',
        name: 'Remember each album’s sort',
        desc: 'An album sorted from its filter button keeps that order.',
      },
      {
        key: 'albumColumns',
        type: 'text',
        showIf: 'library',
        name: 'Album columns',
        desc: 'What each row shows after the title: properties, modified, created or folder, separated by commas.',
        placeholder: 'domain, modified',
        fallback: 'domain, modified',
        suggest: 'properties',
        suggestExtra: ['modified', 'created', 'folder'],
      },
      {
        key: 'trackLength',
        type: 'dropdown',
        showIf: 'library',
        name: 'Note length',
        desc: 'Shown at the end of each row, with the total in an album’s header.',
        options: LENGTH_STYLES,
      },
      {
        key: 'gridDensity',
        type: 'dropdown',
        showIf: 'library',
        name: 'Cover size',
        desc: 'How large covers are on screens of tiles: a compact catalogue, standard, or large.',
        options: GRID_DENSITIES,
      },
      {
        key: 'tileGroups',
        type: 'dropdown',
        showIf: 'library',
        name: 'Group covers by',
        desc: 'On screens of albums: by the kind of album each is, or the collection — the folder — each is in.',
        options: TILE_GROUPS,
      },
      {
        key: 'discNoteLimit',
        type: 'number',
        name: 'Notes per disc',
        desc: 'How many notes a disc shows before Show all.',
        showIf: 'library',
      },
      {
        key: 'albumNoteLimit',
        type: 'number',
        name: 'Notes per value',
        desc: 'How many notes each value shows on the Properties screen before Show all.',
        showIf: 'library',
      },
      {
        key: 'homePath',
        type: 'text',
        name: 'Home note',
        desc: 'The note Home opens.',
        placeholder: 'Home.md',
        fallback: 'Home.md',
        showIf: 'library',
        suggest: 'file',
      },
      {
        key: 'librarySections',
        type: 'custom',
        name: 'Library layout',
        showIf: 'library',
        render: (containerEl, tab) => this.editor().render(containerEl, tab),
      },
    ];
  }

  editor() {
    return new LibraryEditor(this);
  }

  /**
   * A starting layout, derived once from the vault. Doing this rather
   * than shipping fixed defaults means the first view already reflects
   * how the vault is actually arranged.
   */
  defaultSections() {
    const folders = (this.app.vault.getRoot().children || [])
      .filter((c) => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ kind: 'folder', path: f.path }));

    // Anywhere in the vault: bases are commonly kept in a folder of
    // their own, which the root-only scan missed.
    const bases = this.app.vault
      .getFiles()
      .filter((f) => f.extension === 'base')
      .sort((a, b) => a.basename.localeCompare(b.basename))
      .map((f) => ({ kind: 'file', path: f.path }));

    // Shaped after the app this borrows from: a few destinations, then
    // the ways into the whole vault, then the saved views.
    const library = [
      { kind: 'builtin', id: 'bookmarks' },
      { kind: 'builtin', id: 'recents' },
      { kind: 'builtin', id: 'properties' },
      { kind: 'builtin', id: 'folders' },
      { kind: 'builtin', id: 'notes' },
    ];

    const sections = [
      {
        title: '',
        items: [
          { kind: 'builtin', id: 'search' },
          { kind: 'builtin', id: 'home' },
          { kind: 'builtin', id: 'graph' },
        ],
      },
      { title: 'Library', items: library },
    ];
    if (folders.length) sections.push({ title: 'Folders', items: folders });
    if (bases.length) sections.push({ title: 'Bases', items: bases });
    return sections;
  }

  refreshViews() {
    liveViews(this.app, LIBRARY_VIEW, LibraryView).forEach((v) => v.render());
  }

  actions() {
    return [
      {
        id: 'open-library',
        name: 'Open library',
        when: () => this.enabled,
        run: () => this.reveal(),
      },
      {
        id: 'cycle-cover-size',
        name: 'Next cover size: compact, standard, large',
        icon: 'grid-2x2',
        when: () => this.enabled,
        run: () => {
          const keys = Object.keys(GRID_DENSITIES);
          const now = keys.indexOf(this.settings.gridDensity);
          this.settings.gridDensity = keys[(now + 1) % keys.length];
          this.plugin.saveData(this.settings);
          this.plugin.refreshBrowse();
          new Notice(`Covers: ${GRID_DENSITIES[this.settings.gridDensity].toLowerCase()}`);
        },
      },
      // The page's history, so these work from anywhere — including
      // the sidebar, where Obsidian's own navigate commands act on the
      // sidebar instead.
      {
        id: 'go-back',
        name: 'Go back',
        when: () => canStep(pageLeaf(this.app), 'back'),
        run: () => step(pageLeaf(this.app), 'back'),
      },
      {
        id: 'go-forward',
        name: 'Go forward',
        when: () => canStep(pageLeaf(this.app), 'forward'),
        run: () => step(pageLeaf(this.app), 'forward'),
      },
      {
        id: 'new-note-here',
        name: 'New note in the current folder',
        on: 'album',
        menu: false,
        run: (ctx) => this.plugin.newNote(ctx.folder),
      },
      {
        id: 'new-folder-here',
        name: 'New folder in the current folder',
        on: 'album',
        menu: false,
        run: (ctx) => this.plugin.newFolder(ctx.folder),
      },
      {
        id: 'browse-vault',
        name: 'Browse vault as a grid',
        when: () => this.enabled,
        run: () => this.browseRoot(),
      },
    ];
  }

  /**
   * View types are registered at load, not here: Obsidian rebuilds the
   * saved workspace before layout-ready, and a leaf whose type isn't
   * registered yet can't be restored — leaving a stray tab behind and
   * a second one when the view is opened again.
   */
  registerTypes() {
    this.plugin.registerView(
      LIBRARY_VIEW,
      (leaf) => new LibraryView(leaf, this.plugin)
    );
    this.plugin.registerView(
      BROWSE_VIEW,
      (leaf) => new BrowseView(leaf, this.plugin)
    );
  }

  register() {
    // The panel shape is set on Obsidian's own sidebar element, so it's
    // taken off again however the plugin goes away.
    this.plugin.register(() => clearSidebarChrome());

    // Opening and closing the sidebar fires neither a file nor a leaf
    // change; it does resize the workspace.
    const follow = () => this.followSidebar();
    this.plugin.registerEvent(this.app.workspace.on('resize', follow));
    this.plugin.registerEvent(this.app.workspace.on('layout-change', follow));
    this.wasCollapsed = this.leftCollapsed();
    this.followSidebar();

    if (!this.settings.librarySections.length) {
      this.settings.librarySections = this.defaultSections();
      this.plugin.saveData(this.settings);
    }

    // Entries are stored by path, so a rename elsewhere would silently
    // drop them from the list. Follow the move instead.
    this.plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => this.repath(file, oldPath))
    );
  }

  /**
   * Rewrite stored paths after a rename. A folder brings its contents
   * with it, so anything beneath the old path moves too.
   */
  async repath(file, oldPath) {
    const prefix = oldPath + '/';
    let changed = false;

    this.settings.librarySections.forEach((section) => {
      (section.items || []).forEach((item) => {
        if (!item.path) return;

        if (item.path === oldPath) {
          item.path = file.path;
          changed = true;
        } else if (item.path.startsWith(prefix)) {
          item.path = file.path + '/' + item.path.slice(prefix.length);
          changed = true;
        }
      });
    });

    // Checked separately: the home note can be renamed on its own.
    if (this.settings.homePath === oldPath) {
      this.settings.homePath = file.path;
      changed = true;
    }

    if (!changed) return;
    await this.plugin.saveData(this.settings);
    this.refreshViews();
  }

  /**
   * Opened when the feature is switched on, so it isn't hidden behind a
   * command. Not on every settings save, or a Library tab someone closed
   * would keep coming back; the first install is onUserEnable's.
   */
  enable() {
    document.body.toggleClass('dr-single-area', singleAreaOn(this.settings));
    const turnedOn = this.active === false;
    this.active = true;
    if (!turnedOn) return;
    if (this.app.workspace.getLeavesOfType(LIBRARY_VIEW).length) return;
    this.mount();
  }

  /** Docked without stealing focus, unlike reveal from the command. */
  async mount() {
    const leaf = this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: LIBRARY_VIEW });
  }

  /**
   * Open a browse screen in the main area.
   *
   * With one page, the page is wherever you are, so the screen goes
   * there and back returns to what you left. Otherwise an open browse
   * tab is reused rather than stacking more of them.
   */
  async browseMode(state) {
    const ws = this.app.workspace;
    const leaf = this.settings.onePage
      ? ws.getLeaf(false)
      : ws.getLeavesOfType(BROWSE_VIEW)[0] || ws.getLeaf(false);
    await leaf.setViewState({
      type: BROWSE_VIEW,
      active: true,
      state: Object.assign(
        { mode: 'folder', path: '/', property: null, value: null },
        state
      ),
    });
    ws.revealLeaf(leaf);
    liveViews(this.app, LIBRARY_VIEW, LibraryView).forEach((v) => v.markActive());
  }

  leftCollapsed() {
    const split = this.app.workspace.leftSplit;
    return !!(split && split.collapsed);
  }

  /**
   * Keep up with the left sidebar opening and closing: a body class the
   * "Show sidebar" buttons key off, and the panel shape re-checked. With
   * the sidebar's tabs hidden, reopening also brings the library back to
   * the front, since there'd be no way to switch to it otherwise.
   */
  followSidebar() {
    const collapsed = this.leftCollapsed();
    document.body.toggleClass('dr-left-collapsed', collapsed);
    if (this.wasCollapsed && !collapsed && this.enabled && singleAreaOn(this.settings)) {
      this.showLibraryTab();
    }
    this.wasCollapsed = collapsed;
    liveViews(this.app, LIBRARY_VIEW, LibraryView).forEach((v) => v.syncChrome());
  }

  showLibraryTab() {
    const ws = this.app.workspace;
    const leaf = ws
      .getLeavesOfType(LIBRARY_VIEW)
      .find((l) => l.getRoot() === ws.leftSplit);
    if (leaf) ws.revealLeaf(leaf);
  }

  async reveal() {
    const leaf = this.singleLeaf(LIBRARY_VIEW) || this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    if (!(leaf.view instanceof LibraryView)) {
      await leaf.setViewState({ type: LIBRARY_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * The one leaf of a type, closing any duplicates. A view type that
   * was registered too late in an earlier version could leave several
   * behind, and nothing else would ever clear them.
   */
  singleLeaf(type) {
    const leaves = this.app.workspace.getLeavesOfType(type);
    leaves.slice(1).forEach((extra) => extra.detach());
    return leaves[0] || null;
  }

  browseRoot() {
    return this.browseMode({ mode: 'folder', path: '/' });
  }

  disable() {
    this.active = false;
    document.body.removeClass('dr-single-area');

    // Only when the user switches the feature off. On unload Obsidian
    // reopens these views itself, at the position the user left them.
    if (this.plugin.unloading) return;
    this.app.workspace.getLeavesOfType(LIBRARY_VIEW).forEach((l) => l.detach());
    this.app.workspace.getLeavesOfType(BROWSE_VIEW).forEach((l) => l.detach());
  }
}

Library.settingKey = 'library';

