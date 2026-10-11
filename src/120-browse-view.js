/* ------------------------------------------------------------------ */
/* Browse                                                              */
/*                                                                     */
/* The main area, in four shapes: a folder as an album page, a         */
/* property as a list of its values, every folder as tiles, and every  */
/* note as a table.                                                    */
/* ------------------------------------------------------------------ */

class BrowseView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    // Opts the view into the leaf's history, so moving between screens
    // is recorded alongside the notes opened in the same leaf — one
    // stack covering both, which is what back and forward need.
    this.navigation = true;
    this.mode = 'folder'; // folder | properties | folders | notes | recents | pinned
    this.path = '/';
    this.property = null;
    this.value = null;
    this.query = '';
    this.selected = null;
    this.renderTimer = 0;
    // A property column chosen in the Notes table; its Title and
    // Modified columns follow the shared order instead.
    this.columnSort = null;
    // Folder paths, or property values, whose full list is showing.
    this.expanded = new Set();
    // Notes a drawing found with no length yet, counted once it's done.
    this.toMeasure = [];
    // Filters, each narrowing every screen until cleared: notes under
    // one folder, with one tag, with a property value, from a period.
    this.clearFilters();
  }

  getViewType() {
    return BROWSE_VIEW;
  }

  getDisplayText() {
    return this.screen().title();
  }

  propertyLabel() {
    return this.plugin.propertyLabel(this.property || '');
  }

  getIcon() {
    return 'layout-grid';
  }

  getState() {
    return {
      mode: this.mode,
      path: this.path,
      property: this.property,
      value: this.value,
      // The way back down through folders, so history brings it back.
      trail: this.trail || null,
    };
  }

  async setState(state, result) {
    const before = JSON.stringify(this.getState());
    if (state) {
      // Leaving the search screen with something typed counts as having
      // searched for it; the query is about to be cleared.
      this.rememberSearch();
      if (state.mode) this.mode = state.mode;
      if (state.path) this.path = state.path;
      if (state.property !== undefined) this.property = state.property;
      this.value = state.value || null;
      if (state.trail !== undefined) this.trail = state.trail || null;
      // A move to another screen starts clean; refinements within one
      // screen keep their own state because they don't come through
      // here at all.
      this.selected = null;
      this.query = '';
      this.clearFilters();
      this.smartLoaded = null;
      this.editing = false;
    }
    // A move to another screen is a step Obsidian's back and forward
    // should know about; it records one only when told.
    if (state && result && JSON.stringify(this.getState()) !== before) result.history = true;
    this.render();
    if (this.contentEl) this.contentEl.scrollTop = 0;
    // A move within the same tab changes neither the leaf nor the file,
    // so nothing else tells the strip it's on another screen now.
    const strip = typeof this.plugin.feature === 'function' ? this.plugin.feature(ContextStrip) : null;
    if (strip && strip.enabled) strip.update();
    return super.setState(state, result);
  }

  async onOpen() {
    this.containerEl.addClass('dr-browse');
    this.render();

    // "/" goes to Find from anywhere on the page. The keydown covers
    // focus inside it; the view's scope covers the page being active
    // with nothing on it focused, which keys wouldn't otherwise reach.
    this.registerDomEvent(this.containerEl, 'keydown', (evt) => this.onKey(evt));
    try {
      if (typeof Scope === 'function' && this.app.scope) {
        this.scope = new Scope(this.app.scope);
        if (typeof this.scope.register === 'function') {
          this.scope.register([], '/', (evt) => {
            const t = evt.target;
            if (t && typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"]')) return true;
            return !this.focusFind();
          });
        }
      }
    } catch (err) {
      /* the keydown alone still covers focus inside the page */
    }

    // A press on the page holds off redrawing it until it's let go.
    // Drawn over mid-press, the button under the pointer is gone before
    // the click lands — as Done was, pressed straight after typing a new
    // name: leaving the name renames, and the rename redraws the page.
    this.registerDomEvent(
      this.contentEl,
      'pointerdown',
      () => {
        this.pressedAt = Date.now();
        const doc = this.contentEl.ownerDocument;
        const release = () => {
          doc.removeEventListener('pointerup', release, true);
          doc.removeEventListener('pointercancel', release, true);
          this.pressedAt = 0;
          if (!this.renderAfterPress) return;
          this.renderAfterPress = false;
          this.queueRender();
        };
        doc.addEventListener('pointerup', release, true);
        doc.addEventListener('pointercancel', release, true);
      },
      true
    );

    this.registerEvent(this.app.vault.on('create', () => this.queueRender()));
    this.registerEvent(this.app.vault.on('delete', () => this.queueRender()));
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.followRename(file, oldPath);
        this.queueRender();
      })
    );
    // A page redrawn while hidden is redrawn again when it's shown.
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf && this.stale) this.render();
      })
    );

    // Covers come from frontmatter, and processFrontMatter writes the
    // file a beat before the cache reflects it — so redrawing straight
    // after a write shows the card as it was. This catches up.
    this.registerEvent(
      this.app.metadataCache.on('changed', () => this.queueRender())
    );

    // Right-clicking the page itself, rather than something on it,
    // offers the folder's own menu — so a note can be made in the folder
    // you're looking at. Everything on the page with a menu of its own
    // stops the event before it gets here.
    onContextMenu(this.contentEl, (evt) => {
      if (this.mode !== 'folder') return;
      const el = evt.target;
      if (el && typeof el.closest === 'function' && el.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }
      showTargetMenu(this.plugin, evt, this.folder(), {
        here: true,
        redraw: () => this.render(),
      });
    });
  }

  /**
   * Coalesced: a single edit can fire several of these in a row. A page
   * that isn't showing — a background tab — isn't redrawn at all until
   * it is.
   */
  queueRender() {
    if (this.renderTimer) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = 0;
      if (!this.contentEl || !this.contentEl.isConnected) return;
      if (typeof this.containerEl.isShown === 'function' && !this.containerEl.isShown()) {
        this.stale = true;
        return;
      }
      // Not while something on the page is held down (a press held long
      // is a drag or a mistake, and waits no longer).
      if (this.pressedAt && Date.now() - this.pressedAt < 1500) {
        this.renderAfterPress = true;
        return;
      }
      const doc = this.contentEl.ownerDocument;
      const active = doc.activeElement;
      const inside = !!active && this.contentEl.contains(active);
      // A name being changed is drawn over once it's done with, not mid-word.
      if (inside && active.matches('.dr-edit-name')) {
        this.renderAfterEdit = true;
        return;
      }
      const typing = inside && active.matches('.dr-browse-search input');
      if (typing) this.renderBelowBar();
      else this.render();
    }, 50);
  }

  /** Obsidian calls this when the page is shown or resized. */
  onResize() {
    if (this.stale) this.render();
  }

  /**
   * A folder renamed or moved while it's shown — or while it's the
   * filter, or on the way back down — is followed to its new path,
   * rather than the page falling back to the vault's root.
   */
  followRename(file, oldPath) {
    if (!(file instanceof TFolder)) return;
    const moved = (p) =>
      !p ? p : p === oldPath ? file.path : p.startsWith(oldPath + '/') ? file.path + p.slice(oldPath.length) : p;
    this.path = moved(this.path);
    this.trail = moved(this.trail);
    this.filterFolder = moved(this.filterFolder);
  }

  async onClose() {
    // Replaced by a result opened in the same page.
    this.rememberSearch();
    // A pending redraw would otherwise run against a closed view.
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    this.renderTimer = 0;
  }

  /* -- navigation -------------------------------------------------- */

  /**
   * Change screens through the workspace rather than by re-rendering.
   *
   * setViewState is what puts an entry in the leaf's history; mutating
   * state and calling render() moves the view without the app knowing,
   * which is why back used to skip whole screens.
   */
  navigate(state) {
    return this.leaf.setViewState({
      type: BROWSE_VIEW,
      active: true,
      state: Object.assign(
        {
          mode: this.mode,
          path: this.path,
          property: this.property,
          value: null,
          trail: this.trail || null,
        },
        state
      ),
    });
  }

  canGo(dir) {
    return canStep(this.leaf, dir);
  }

  go(dir) {
    step(this.leaf, dir);
  }

  /**
   * Shown only while the sidebar is closed. Obsidian's own reopen
   * buttons sit in the tab bar and note header, which single content
   * area hides, so without this there was no way back.
   */
  renderSidebarToggle(bar) {
    const el = bar.createDiv({ cls: 'dr-browse-up dr-sidebar-toggle' });
    el.setAttribute('aria-label', 'Show sidebar');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    setIcon(el, 'panel-left');
    onActivate(el, () => this.app.workspace.leftSplit.expand());
  }

  /**
   * Back and forward. On a folder they move through the folders
   * themselves — back to the folder this one is in, forward down again
   * — while the strip's pair keeps to the history, so there's one of
   * each. Every other screen's pair is the history.
   */
  renderNav(bar) {
    const button = (icon, label, enabled, onClick) => {
      const el = bar.createDiv({ cls: 'dr-browse-up' });
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      if (!enabled) {
        el.addClass('is-disabled');
        return el;
      }
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      onActivate(el, onClick);
      return el;
    };

    if (this.mode === 'folder') {
      const folder = this.folder();
      const { parent, child } = this.folderSteps(folder);
      button(
        'chevron-left',
        parent ? `Back to ${this.folderName(parent)}` : 'Back',
        !!parent,
        () => this.folderUp(folder, parent)
      ).addClass('is-folder-step');
      button(
        'chevron-right',
        child ? `Forward to ${child.name}` : 'Forward',
        !!child,
        () => this.openFolder(child)
      ).addClass('dr-browse-forward', 'is-folder-step');
      return;
    }

    const hasHistory = !!leafHistory(this.leaf);
    button('chevron-left', 'Back', this.canGo('back'), () => this.go('back'));
    if (hasHistory) {
      button('chevron-right', 'Forward', this.canGo('forward'), () =>
        this.go('forward')
      ).addClass('dr-browse-forward');
    }
  }

  /**
   * Where a folder's back and forward lead. Back is the folder it sits
   * in; the vault's root has none. Forward is the way you came up, if
   * you came up — the trail keeps the deepest folder left, so going up
   * two levels comes back down both — and otherwise the first subfolder,
   * so forward always means further in.
   */
  folderSteps(folder) {
    if (!folder) return { parent: null, child: null };
    const root = !!(folder.isRoot && folder.isRoot());
    const parent = !root && folder.parent ? folder.parent : null;

    let child = null;
    const base = root ? '' : folder.path + '/';
    if (this.trail && this.trail.startsWith(base) && this.trail !== folder.path) {
      const next = base + this.trail.slice(base.length).split('/')[0];
      const found = this.app.vault.getFolderByPath(next);
      if (found && this.visibleFolders(folder).indexOf(found) !== -1) child = found;
    }
    if (!child) child = this.visibleFolders(folder)[0] || null;
    return { parent, child };
  }

  /** Up a level, remembering the way back down. */
  folderUp(folder, parent) {
    if (!parent) return;
    // A deeper trail through this folder is kept; any other is replaced.
    if (!this.trail || !this.trail.startsWith(folder.path + '/')) this.trail = folder.path;
    this.openFolder(parent);
  }

  folderName(folder) {
    return folder.isRoot && folder.isRoot() ? this.app.vault.getName() : folder.name;
  }

  /**
   * Go into a folder. The mode has to change too: render() picks the
   * screen from the mode before it ever looks at the path.
   */
  openFolder(folder) {
    return this.navigate({
      mode: 'folder',
      path: folder && folder.path ? folder.path : '/',
      property: null,
    });
  }

  folder() {
    return this.app.vault.getFolderByPath(this.path) || this.app.vault.getRoot();
  }

  render() {
    this.stale = false;
    const root = this.contentEl;
    root.empty();
    const density = this.plugin.settings.gridDensity;
    this.containerEl.dataset.drDensity = GRID_DENSITIES[density] ? density : 'standard';
    this.beginDrawing();

    // A screen that throws should say so rather than leave a blank
    // pane: the rest of the view still works, and the console carries
    // the detail.
    try {
      this.screen().render(root);
    } catch (err) {
      console.error(`Design Redux: the ${this.mode} screen failed`, err);
      root.empty();
      root.createDiv({
        cls: 'dr-empty',
        text: 'This screen could not be drawn. See the console for details.',
      });
    }
    this.measureLater();
    // The tab's name follows the screen's — as when the folder shown is
    // renamed, which Obsidian doesn't tell the tab about.
    const title = this.getDisplayText();
    if (title !== this.shownTitle) {
      this.shownTitle = title;
      if (this.leaf && typeof this.leaf.updateHeader === 'function') this.leaf.updateHeader();
    }
  }

  /** The screen this mode draws, built fresh so it holds no state. */
  screen() {
    const Screen = BROWSE_SCREENS[this.mode] || FolderScreen;
    return new Screen(this);
  }

  /* -- every folder, as tiles ------------------------------------- */

  /* -- every note, as a table ------------------------------------- */

  tableRow(table, file, columns) {
    const row = table.createDiv({ cls: 'dr-tr' });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    const title = row.createDiv({ cls: 'dr-td dr-td-title' });
    title.createSpan({ cls: 'dr-td-text', text: file.basename });

    const more = title.createDiv({ cls: 'clickable-icon dr-td-more' });
    more.setAttribute('aria-label', 'More');
    setIcon(more, 'ellipsis');
    more.addEventListener('click', (evt) => this.fileMenu(evt, file));

    columns.forEach((key) =>
      row.createDiv({ cls: 'dr-td', text: this.valueOf(file, key) })
    );
    if (this.lengthStyle()) row.createDiv({ cls: 'dr-td dr-td-length', text: this.lengthLabel(file) });
    row.createDiv({
      cls: 'dr-td dr-td-time',
      text: this.relative(file.stat.mtime),
    });

    onActivate(row, (evt) => this.openFile(file, evt), false);
    onContextMenu(row, (evt) => this.fileMenu(evt, file));
  }

  /**
   * A column heading that sorts by its own column, the way a song list
   * does — clicking again reverses it, and the active column carries
   * the arrow. Title either way, and Modified newest first, are orders
   * every screen shares, so choosing them here chooses them everywhere;
   * a property column, or oldest first, is this table's alone.
   */
  headerCell(head, key, label, extra) {
    const cell = head.createDiv({ cls: `dr-td ${extra || ''}`.trim() });
    const current = this.tableSort;
    const active = current.key === key;
    if (active) cell.addClass('is-sorted');

    cell.createSpan({ cls: 'dr-td-text', text: label });
    if (active) {
      const arrow = cell.createSpan({ cls: 'dr-th-arrow' });
      setIcon(arrow, current.dir === 'asc' ? 'chevron-up' : 'chevron-down');
    }

    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    onActivate(cell, () => {
      // Text reads best ascending, time newest first.
      const next = active
        ? { key: key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: key, dir: key === 'modified' || key === 'created' ? 'desc' : 'asc' };
      const shared = Object.keys(TABLE_SORTS).find(
        (k) => TABLE_SORTS[k].key === next.key && TABLE_SORTS[k].dir === next.dir
      );
      if (shared) this.setSort(shared);
      else this.columnSort = next;
      this.render();
    });
  }

  sortNotes(files) {
    const { key, dir } = this.tableSort;
    const mul = dir === 'asc' ? 1 : -1;
    const value = (f) => {
      if (key === 'title') return f.basename.toLowerCase();
      if (key === 'modified') return f.stat.mtime;
      if (key === 'created') return f.stat.ctime;
      return (this.valueOf(f, key) || '').toLowerCase();
    };

    return files.slice().sort((a, b) => {
      if (key === 'title') return byName(a.basename, b.basename) * mul;
      const x = value(a);
      const y = value(b);
      // Blanks last whichever way the column is pointing.
      if (x === '' && y !== '') return 1;
      if (y === '' && x !== '') return -1;
      if (x === y) return byName(a.basename, b.basename);
      // Text in the order a person would put it — 2 before 10.
      if (typeof x === 'string' && typeof y === 'string') return byName(x, y) * mul;
      return (x > y ? 1 : -1) * mul;
    });
  }

  /** The properties used as columns, from settings. */
  tableColumns() {
    return (this.plugin.settings.tableColumns || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  columnLabel(key) {
    try {
      const info = this.app.metadataTypeManager.getAllProperties()[key.toLowerCase()];
      if (info && info.name) return info.name;
    } catch (err) {
      /* fall through */
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  valueOf(file, key) {
    const cache = this.app.metadataCache.getFileCache(file);
    const v = cache && fmGet(cache.frontmatter, key);
    if (v === undefined || v === null || v === '') return '';
    return Array.isArray(v) ? v.map((x) => this.plain(x)).join(', ') : this.plain(v);
  }

  plain(value) {
    return plainValue(value);
  }

  /* -- a property, two panes -------------------------------------- */

  /* -- properties -------------------------------------------------- */

  /** Every property in use, with how many notes carry it. */
  propertyList() {
    try {
      const all = this.app.metadataTypeManager.getAllProperties();
      const count = propertyCounter(this.app);
      return Object.keys(all)
        .map((key) => ({
          key: key,
          name: (all[key] && all[key].name) || key,
          count: count(key, all[key]),
          type: (all[key] && (all[key].type || all[key].widget)) || 'text',
        }))
        .filter((p) => p.count > 0)
        .sort((a, b) =>
          this.sort === 'name-desc' ? byName(b.name, a.name) : byName(a.name, b.name)
        );
    } catch (err) {
      return [];
    }
  }

  /** Every distinct value of a property, with the notes carrying it. */
  groupsByProperty(key) {
    const map = new Map();

    this.app.vault.getMarkdownFiles().forEach((file) => {
      if (this.plugin.isFolderNote(file)) return;
      if (!this.inFilter(file)) return;
      const cache = this.app.metadataCache.getFileCache(file);
      const raw = cache && fmGet(cache.frontmatter, key);
      if (raw === undefined || raw === null || raw === '') return;

      const values = Array.isArray(raw) ? raw : [raw];
      values.forEach((v) => {
        const value = this.plain(v);
        if (!value) return;
        if (!map.has(value)) map.set(value, []);
        map.get(value).push(file);
      });
    });

    return this.sortGroups(
      Array.from(map.entries()).map(([value, files]) => ({
        value: value,
        files: this.sortFiles(files),
      }))
    );
  }

  /** A group borrows the first cover any of its notes carries. */
  groupCover(group) {
    for (const file of group.files) {
      const src = this.coverFor(file);
      if (src) return src;
    }
    return null;
  }

  renderGroup(detail, group, isPrimary) {
    const block = detail.createDiv({ cls: 'dr-album' });

    const head = block.createDiv({ cls: 'dr-album-head' });
    const titles = head.createDiv({ cls: 'dr-album-titles' });
    titles.createDiv({
      cls: isPrimary ? 'dr-album-name is-primary' : 'dr-album-name',
      text: group.value,
    });
    // A value can be renamed everywhere it's used; under tags, each
    // value is a tag, renamed in notes' text as well.
    const bulk = this.plugin.feature(BulkEditing);
    if (bulk && this.property) {
      onContextMenu(head, (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        if (TAG_KEYS.indexOf(String(this.property).toLowerCase()) !== -1) {
          const tag = String(group.value).replace(/^#/, '');
          menu.addItem((item) =>
            item
              .setTitle(`Rename #${tag} everywhere…`)
              .setIcon('hash')
              .onClick(() => bulk.openRenameTag(tag))
          );
        } else {
          menu.addItem((item) =>
            item
              .setTitle('Rename this value everywhere…')
              .setIcon('pencil')
              .onClick(() => bulk.openRenameValue(this.plugin.propertyLabel(this.property), String(group.value)))
          );
        }
        showMenuAt(menu, evt);
      });
    }
    titles.createDiv({
      cls: 'dr-album-meta',
      text:
        `${this.propertyLabel()}  ·  ` +
        (group.files.length === 1 ? '1 note' : `${group.files.length} notes`),
    });

    const body = block.createDiv({ cls: 'dr-album-body' });
    const art = body.createDiv({ cls: 'dr-album-art' });
    this.fillArt(art, this.groupCover(group), 'file-text', this.genName(String(group.value)), blankLook(this.plugin.settings, String(group.value)));

    const list = body.createDiv({ cls: 'dr-tracks' });
    roveFocus(list, '.dr-track');
    // Keyed by property too: the same value can occur under two.
    this.renderLimited(
      list,
      group.files,
      `value:${this.property}:${group.value}`,
      this.limitFrom('albumNoteLimit', 8)
    );
  }

  /** Title and search, for the screens with no folder behind them. */
  renderTitleBar(root, title) {
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    this.renderSidebarToggle(bar);
    // Home and Search are where you start, so there's nothing behind
    // them to go back to; the other screens are arrived at.
    if (ROOT_MODES.indexOf(this.mode) === -1) this.renderNav(bar);
    bar.createDiv({ cls: 'dr-browse-title', text: title });
    this.renderSearchField(bar);
    this.renderFilterChips(root);
  }

  /** Back, title and search — no artwork, no actions. */
  renderPlainHeader(root, folder) {
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    this.renderSidebarToggle(bar);

    this.renderNav(bar);

    bar.createDiv({ cls: 'dr-browse-title', text: this.getDisplayText() });
    this.renderSearchField(bar);
    this.renderFilterChips(root);
  }

  /* -- header ----------------------------------------------------- */

  /* -- discs ------------------------------------------------------ */

  /** Notes directly inside a folder, filtered and in the chosen order. */
  notesIn(folder) {
    return this.arranged(
      folder,
      (folder.children || [])
        .filter((c) => c instanceof TFile)
        .filter((c) => !this.plugin.isFolderNote(c))
        .filter((c) => this.inFilter(c))
        .filter((c) => this.matches(c.basename))
    );
  }

  /** A folder's notes in its own arrangement, if it has one on, or the shared order. */
  arranged(folder, files) {
    return this.plugin.orders.arrangeAlbum(folder, files, (list) => this.sortFiles(list));
  }

  /** Every note in a folder, Find and filters aside — what an arrangement covers. */
  allNotesIn(folder) {
    return this.arranged(
      folder,
      (folder.children || []).filter((c) => c instanceof TFile && !this.plugin.isFolderNote(c))
    );
  }

  /** An order can be arranged by hand only while everything in it is showing. */
  canArrange() {
    return !this.query.trim() && !this.hasFilters();
  }

  /**
   * An album's contents split the way a multi-disc album is: the
   * folder's own notes first, then each subfolder beneath it as its
   * own disc, numbered from one. Deeper folders become discs too,
   * titled by their path, so nothing nested goes missing.
   */
  discsOf(folder, loose) {
    const discs = [];
    // Editing shows the whole album — every note, and a disc for every
    // subfolder, even an empty one, so it can be renamed or filled.
    const editing = !!this.editing;
    const own = editing ? this.allNotesIn(folder) : loose;
    if (own.length || editing) discs.push({ title: this.folderName(folder), folder: folder, files: own });

    // Each level in the shared order, a folder's own discs after it.
    const subfolders = (parent) =>
      editing
        ? (parent.children || []).filter((c) => c instanceof TFolder).sort((a, b) => byName(a.name, b.name))
        : this.visibleFolders(parent);
    const walk = (parent, prefix) =>
      this.sortFolders(subfolders(parent)).forEach((child) => {
        const title = prefix ? `${prefix} / ${child.name}` : child.name;
        const files = editing ? this.allNotesIn(child) : this.notesIn(child);
        if (files.length || editing) discs.push({ title: title, folder: child, files: files });
        walk(child, title);
      });
    walk(folder, '');

    return discs;
  }

  /**
   * A run of track rows that stops after `limit`, with a row to reveal
   * the rest. `key` remembers the choice across redraws, so expanding a
   * list survives a sort or a metadata change.
   */
  renderLimited(list, files, key, limit) {
    if (this.editing && this.mode === 'folder') {
      files.forEach((file, i) => this.editRow(list, file, i + 1));
      return;
    }
    const expanded = this.expanded.has(key);
    const shown = expanded ? files : files.slice(0, limit);
    shown.forEach((file, i) => this.trackRow(list, file, i + 1));
    if (files.length <= limit) return;

    const more = list.createDiv({ cls: 'dr-track dr-track-more-row' });
    more.setAttribute('role', 'button');
    more.setAttribute('tabindex', '0');
    more.createDiv({ cls: 'dr-track-num' });
    more.createDiv({
      cls: 'dr-track-name dr-more-label',
      text: expanded ? 'Show less' : `Show all ${files.length}`,
    });
    onActivate(more, () => {
      if (expanded) this.expanded.delete(key);
      else this.expanded.add(key);
      this.render();
    });
  }

  /** A numeric setting, never below one. */
  limitFrom(key, fallback) {
    return Math.max(1, Number(this.plugin.settings[key]) || fallback);
  }

  /**
   * Dropping a note on a disc moves it into that folder.
   *
   * Rows and headings both carry the folder they belong to, so the
   * target is whatever the cursor is over — dropping on a note in a
   * disc means the same as dropping on its heading.
   */
  acceptDrops(list) {
    const folderAt = (evt) => {
      // Any element, from any window — a popout's aren't this window's HTMLElement.
      const el = evt.target && typeof evt.target.closest === 'function'
        ? evt.target.closest('[data-folder]')
        : null;
      return el ? el.dataset.folder : null;
    };

    const clear = () =>
      list
        .querySelectorAll('.is-drop-target, .is-drop-before, .is-drop-after')
        .forEach((el) => el.removeClass('is-drop-target', 'is-drop-before', 'is-drop-after'));

    // Over a row of the disc it came from, it's being put in order: a
    // line shows where it will go.
    const arrangingOver = (evt) => {
      const drag = this.dragging;
      const el = evt.target && typeof evt.target.closest === 'function'
        ? evt.target.closest('.dr-track[data-path]')
        : null;
      if (!drag || !el || el.dataset.folder !== drag.folder) return null;
      const box = el.getBoundingClientRect();
      return { row: el, after: evt.clientY > box.top + box.height / 2 };
    };

    list.addEventListener('dragover', (evt) => {
      if (!Array.from(evt.dataTransfer.types).includes('text/dr-file')) return;
      const over = arrangingOver(evt);
      if (over) {
        clear();
        if (!this.canArrange()) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'move';
        if (over.row.dataset.path !== this.dragging.path) {
          over.row.addClass(over.after ? 'is-drop-after' : 'is-drop-before');
        }
        return;
      }
      const folder = folderAt(evt);
      if (folder === null) return;
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'move';

      clear();
      // Mark the whole disc, not just the row under the cursor.
      list
        .querySelectorAll(`[data-folder="${CSS.escape(folder)}"]`)
        .forEach((el) => el.addClass('is-drop-target'));
    });

    list.addEventListener('dragleave', (evt) => {
      if (!list.contains(evt.relatedTarget)) clear();
    });

    list.addEventListener('drop', async (evt) => {
      const path = evt.dataTransfer.getData('text/dr-file');
      const over = arrangingOver(evt);
      const folder = folderAt(evt);
      clear();
      if (over) {
        evt.preventDefault();
        if (path && this.canArrange() && over.row.dataset.path !== path) {
          this.arrangeTrack(path, over.row.dataset.path, over.after);
        }
        return;
      }
      if (!path || folder === null) return;
      evt.preventDefault();

      const file = this.app.vault.getFileByPath(path);
      if (!file) return;
      await this.plugin.moveFile(file, folder, { announce: true });
    });
  }

  /**
   * The discs, each headed. A subfolder's heading opens that folder, as
   * a disc's does; the folder's own disc is the page already showing.
   * An album of very many discs — the vault's root holds every folder —
   * shows the first few dozen, with a row for the rest.
   */
  renderDiscs(root, discs, album) {
    const list = root.createDiv({ cls: 'dr-tracks' });
    roveFocus(list, '.dr-track, .dr-disc[role="button"]');
    // Discs are folders, so dragging a note onto one moves it there; onto
    // a row of its own disc, it goes there in the album's order.
    if (!Platform.isMobile && !this.editing) this.acceptDrops(list);

    const key = `discs:${album ? album.path : ''}`;
    const cap = 24;
    const shown = this.expanded.has(key) ? discs : discs.slice(0, cap);

    // Every disc is headed, including the folder's own notes and a
    // lone disc, so an album reads the same whatever its shape.
    shown.forEach((disc) => {
      const head = list.createDiv({ cls: 'dr-disc' });
      if (disc.folder) head.dataset.folder = disc.folder.path;
      if (this.editing && disc.folder && album && disc.folder !== album) {
        this.editDiscHead(head, disc, album);
        this.renderLimited(list, disc.files, `disc:${disc.folder.path}`, 0);
        return;
      }
      head.createSpan({ cls: 'dr-disc-title', text: disc.title });
      head.createSpan({
        cls: 'dr-disc-count',
        text: disc.files.length === 1 ? '1 note' : `${disc.files.length} notes`,
      });

      if (disc.folder) {
        const here = !!album && disc.folder === album;
        if (!here) {
          head.setAttribute('role', 'button');
          head.setAttribute('tabindex', '0');
          head.setAttribute('aria-label', `Open ${disc.folder.name}`);
          onActivate(head, () => this.openFolder(disc.folder));
        }
        onContextMenu(head, (evt) =>
          this.folderMenu(evt, disc.folder, this.folderCover(disc.folder), { here })
        );
      }

      this.renderLimited(
        list,
        disc.files,
        `disc:${disc.folder ? disc.folder.path : disc.title}`,
        this.limitFrom('discNoteLimit', 10)
      );
    });

    if (discs.length > cap) this.renderMoreRow(list, key, discs.length, 'discs');
  }

  /** "Show all N …" / "Show less", remembered across redraws. */
  renderMoreRow(list, key, total, noun) {
    const expanded = this.expanded.has(key);
    const more = list.createDiv({ cls: 'dr-track dr-track-more-row' });
    more.setAttribute('role', 'button');
    more.setAttribute('tabindex', '0');
    more.createDiv({ cls: 'dr-track-num' });
    more.createDiv({
      cls: 'dr-track-name dr-more-label',
      text: expanded ? 'Show less' : `Show all ${total} ${noun}`,
    });
    onActivate(more, () => {
      if (expanded) this.expanded.delete(key);
      else this.expanded.add(key);
      this.render();
    });
  }

  /* -- the album header ------------------------------------------ */

  /**
   * Large art, a title block and two actions. Shared by folders and by
   * the collections — recents and pins — which have no folder behind
   * them but read the same way.
   */
  renderAlbumHead(root, spec) {
    const head = root.createDiv({ cls: 'dr-detail' });
    const folder = spec.folder || null;
    const editing = !!folder && !!this.editing;
    head.toggleClass('is-editing', editing);

    // The cover's own colours, blurred, behind the header — as the
    // reference tints an album's page with its artwork.
    const glow = head.createDiv({ cls: 'dr-detail-glow' });
    const art = head.createDiv({ cls: 'dr-detail-art' });
    [glow, art].forEach((el) => {
      if (folder) drawFolderArt(this.plugin, el, folder);
      else this.fillArt(el, spec.cover, spec.glyph || 'folder', spec.genName, blankLook(this.plugin.settings, spec.title));
    });
    // An image dropped here — or pasted, once it's clicked — becomes the album's cover.
    if (folder && folder.path !== '/') {
      art.dataset.coverFolder = folder.path;
      art.setAttribute('tabindex', '-1');
    }
    if (spec.onArtMenu) {
      onContextMenu(art, (evt) => spec.onArtMenu(evt));
    }
    if (editing && folder.path !== '/') {
      const tools = art.createDiv({ cls: 'dr-art-tools' });
      if (!spec.cover) {
        const tint = tools.createDiv({ cls: 'dr-art-edit' });
        tint.setAttribute('role', 'button');
        tint.setAttribute('tabindex', '0');
        tint.setAttribute('aria-label', 'Cover colour');
        setIcon(tint, 'palette');
        onActivate(tint, () => this.plugin.chooseCoverColor(folder));
      }
      const change = tools.createDiv({ cls: 'dr-art-edit' });
      change.setAttribute('role', 'button');
      change.setAttribute('tabindex', '0');
      change.setAttribute('aria-label', spec.cover ? 'Change cover image' : 'Set cover image');
      setIcon(change, 'image');
      onActivate(change, () => this.plugin.setFolderCover(folder, () => this.render()));
    }

    const info = head.createDiv({ cls: 'dr-detail-info' });
    // Above the title, small: what kind of album it is, and the way down to it.
    const structure = folder ? this.plugin.feature(AlbumStructure) : null;
    const about = structure ? structure.info(folder) : null;
    const trail = structure && structure.enabled ? structure.trail(folder) : [];
    // The vault itself is the library, at the top of everything.
    const level = about && about.label ? about.label : structure && structure.enabled && folder.isRoot && folder.isRoot() ? 'Library' : '';
    if (level || trail.length) {
      const kicker = info.createDiv({ cls: 'dr-detail-kicker' });
      if (level) kicker.createSpan({ cls: 'dr-detail-kind', text: level });
      if (trail.length) {
        const crumbs = kicker.createEl('nav', { cls: 'dr-crumbs', attr: { 'aria-label': 'Where this album is' } });
        trail.forEach((f, i) => {
          if (i) crumbs.createSpan({ cls: 'dr-crumb-sep', text: '›' });
          const crumb = crumbs.createSpan({ cls: 'dr-crumb', text: f.name });
          crumb.setAttribute('role', 'button');
          crumb.setAttribute('tabindex', '0');
          onActivate(crumb, () => this.openFolder(f));
        });
      }
    }
    if (editing && folder.path !== '/') {
      const title = info.createEl('input', { cls: 'dr-detail-title dr-edit-name', type: 'text' });
      title.value = folder.name;
      title.dataset.editPath = folder.path;
      title.setAttribute('aria-label', 'Folder name');
      this.editField(title, folder.name, (name) => this.renameEntry(folder, name));
    } else {
      info.createDiv({ cls: 'dr-detail-title', text: spec.title });
    }
    // The accented line under the title, as the artist is: the folder
    // note's own lead property, or else the folder this one is in —
    // which it opens, as the artist's name does.
    const parent = folder && folder.parent && !(folder.isRoot && folder.isRoot()) ? folder.parent : null;
    if (spec.sub) {
      info.createDiv({ cls: 'dr-detail-sub', text: spec.sub });
    } else if (parent && !(parent.isRoot && parent.isRoot()) && !trail.length) {
      const up = info.createDiv({ cls: 'dr-detail-sub is-link', text: parent.name });
      up.setAttribute('role', 'button');
      up.setAttribute('tabindex', '0');
      onActivate(up, () => this.openFolder(parent));
    }

    const files = spec.files || [];
    const notes = files.every((f) => f.extension === 'md');
    const meta = [files.length === 1 ? (notes ? '1 note' : '1 item') : `${files.length} ${notes ? 'notes' : 'items'}`];
    const subs = about ? this.visibleFolders(folder).length : 0;
    if (subs) meta.push(subs === 1 ? '1 sub-album' : `${subs} sub-albums`);
    // How long the album is, as an album gives its running time.
    const length = this.totalLength(files);
    if (length) meta.push(length);
    const newest = files.reduce((t, f) => Math.max(t, f.stat.mtime), 0);
    if (newest) meta.push(`Updated ${this.relative(newest)}`);
    const progress = about ? structure.progress(about, files) : null;
    if (progress) meta.push(`${progress.done} of ${progress.total} ${progress.word}`);
    info.createDiv({ cls: 'dr-detail-meta', text: meta.join('  ·  ') });
    if (about && about.description) info.createDiv({ cls: 'dr-detail-desc', text: about.description });

    const actions = info.createDiv({ cls: 'dr-detail-actions' });
    if (editing) {
      this.action(actions, 'check', 'Done', () => this.setEditing(false)).addClass('is-primary');
      this.action(actions, 'file-plus', 'New note', () => this.editNewNote(folder));
      this.action(actions, 'folder-plus', 'New folder', () => this.editNewFolder(folder));
      return;
    }
    // Open leads, filled, as Play does.
    this.action(actions, 'book-open', 'Open', () => {
      const target = files[0];
      if (target) this.app.workspace.getLeaf(false).openFile(target);
    }).addClass('is-primary');
    // Shuffle lines the rest up after the one it opens, where Up Next is on.
    const upNext = this.plugin.feature(UpNext);
    const shuffling = !!(upNext && upNext.enabled);
    this.action(actions, 'shuffle', shuffling ? 'Shuffle' : 'Random', () => {
      if (shuffling && upNext.shuffle(folder, files)) return;
      if (!files.length) return;
      const pick = files[Math.floor(Math.random() * files.length)];
      this.app.workspace.getLeaf(false).openFile(pick);
    });
    if (about && about.type === 'concept map') this.action(actions, 'waypoints', 'Map', () => structure.openMap(folder));
    if (folder) this.action(actions, 'pencil', 'Edit', () => this.setEditing(true));
  }

  renderHeader(root, folder, files) {
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    this.renderSidebarToggle(bar);
    this.renderNav(bar);
    this.renderSearchField(bar);
    this.renderFilterChips(root);

    const note = this.plugin.folderNote(folder);
    const src = this.folderCover(folder);
    this.renderAlbumHead(root, {
      title: this.getDisplayText(),
      sub: note ? this.subtitleFor(note) : '',
      cover: src,
      glyph: 'folder',
      genName: this.genName(this.getDisplayText(), folder.path),
      folder: folder,
      // files is in display order — discs concatenated, each sorted —
      // so Open lands on the first row you see. The folder note stands
      // for the folder rather than being part of its contents.
      files: files,
      onArtMenu: (evt) => this.folderMenu(evt, folder, src, { here: true }),
    });
  }

  /** Subfolders, minus the empty ones when that's switched on. */
  visibleFolders(folder) {
    return (folder.children || [])
      .filter((c) => c instanceof TFolder)
      .filter((c) => !this.plugin.settings.hideEmptyFolders || this.plugin.folderHasNotes(c))
      .sort((a, b) => byName(a.name, b.name));
  }

  fillArt(el, src, glyph, name, look) {
    fillArt(el, src, glyph, name, look);
  }

  /* -- shared actions --------------------------------------------- */

  openFile(file, evt) {
    // Opening a result is the clearest sign a search found something.
    this.rememberSearch();
    const newTab = !!(evt && (evt.ctrlKey || evt.metaKey));
    this.app.workspace.getLeaf(newTab).openFile(file);
  }

  fileMenu(evt, file) {
    if (this.mode === 'pinned') {
      showTargetMenu(this.plugin, evt, file, { redraw: () => this.render(), arrange: this.pinSteps(file) });
      return;
    }
    showTargetMenu(this.plugin, evt, file, { redraw: () => this.render() });
  }

  folderMenu(evt, folder, _src, opts) {
    showTargetMenu(this.plugin, evt, folder, {
      open: () => this.openFolder(folder),
      here: !!(opts && opts.here),
      redraw: () => this.render(),
      arrange: this.tileSteps(folder),
    });
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
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
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
    btn.setAttribute('aria-label', 'Sort and filter');
    setIcon(btn, 'list-filter');
    const usual = this.ownOrderLabel() ? 'own' : 'name';
    if (this.hasFilters() || this.currentSort() !== usual) btn.addClass('is-active');

    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
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
    return menu;
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
    if (!chips.length) return;

    const row = root.createDiv({ cls: 'dr-filter-chips' });
    chips.forEach(([label, change, clear]) => {
      const chip = row.createDiv({ cls: 'dr-chip' });
      const name = chip.createSpan({ cls: 'dr-chip-label', text: label });
      name.setAttribute('role', 'button');
      name.setAttribute('tabindex', '0');
      name.setAttribute('aria-label', `Change: ${label}`);
      onActivate(name, change);
      const x = chip.createSpan({ cls: 'dr-chip-clear' });
      x.setAttribute('role', 'button');
      x.setAttribute('tabindex', '0');
      x.setAttribute('aria-label', `Remove: ${label}`);
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
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    setIcon(btn.createSpan({ cls: 'dr-detail-action-icon' }), icon);
    btn.createSpan({ text: label });
    onActivate(btn, onClick);
    return btn;
  }

  /* -- editing an album -------------------------------------------- */

  /**
   * What a cover is made from, while generated covers are on: the name,
   * and the colour chosen for the path, if any.
   */
  genName(name, path) {
    return coverGen(this.plugin.settings, name, path);
  }

  setEditing(on) {
    this.editing = !!on;
    this.render();
    if (!on) return;
    const first = this.contentEl.querySelector('.dr-detail-title.dr-edit-name, .dr-track .dr-edit-name');
    if (first && !Platform.isMobile) first.focus();
  }

  /**
   * A field that changes a name: Enter or leaving it saves, Escape puts
   * it back. Only a real change is saved.
   */
  editField(input, original, commit, opts = {}) {
    let settled = false;
    const finish = (keep, entered) => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      // Enter on a name left as it was can still ask for something:
      // a property written other ways in some notes, made one.
      if (keep && entered && value === original && opts.enterSame) {
        opts.enterSame(value);
        return;
      }
      if (!keep || !value || value === original) {
        input.value = original;
        return;
      }
      commit(value);
    };
    input.addEventListener('focus', () => {
      settled = false;
    });
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter') {
        evt.preventDefault();
        finish(true, true);
        input.blur();
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      finish(true);
      // Anything that changed while this was being typed in is drawn now.
      if (this.renderAfterEdit) {
        this.renderAfterEdit = false;
        this.queueRender();
      }
    });
  }

  /**
   * Rename a note or folder where it is. Links to it are rewritten, as
   * Obsidian's own rename does, and a name that's taken or can't be a
   * file name is refused with the reason.
   */
  async renameEntry(entry, name) {
    if (/[\\/:*?"<>|#^[\]]/.test(name)) {
      new Notice('A name can’t contain \\ / : * ? " < > | # ^ [ or ].');
      this.render();
      return false;
    }
    const dir = entry.parent && entry.parent.path !== '/' ? entry.parent.path + '/' : '';
    const target = normalizePath(dir + (entry instanceof TFile ? `${name}.${entry.extension}` : name));
    if (target === entry.path) return false;
    const taken = this.app.vault.getAbstractFileByPath(target);
    if (taken && taken !== entry) {
      new Notice(`There’s already something called “${name}” here.`);
      this.render();
      return false;
    }
    const oldPath = entry.path;
    const oldName = entry instanceof TFile ? entry.basename : entry.name;
    try {
      await this.app.fileManager.renameFile(entry, target);
    } catch (err) {
      console.error('Design Redux: could not rename', err);
      new Notice(`Could not rename “${entry.name}”.`);
      this.render();
      return false;
    }
    this.plugin.offerUndo(`Renamed “${oldName}” to “${name}”.`, () => this.plugin.putBack(entry, oldPath));
    return true;
  }

  /** Delete the way Obsidian does: its confirmation, and its trash setting. */
  async deleteEntry(entry) {
    const fm = this.app.fileManager;
    try {
      const confirmed = typeof fm.promptForDeletion === 'function' ? await fm.promptForDeletion(entry) : true;
      if (!confirmed) return false;
      // The prompt may have deleted it already; if not, it goes to the trash.
      if (this.app.vault.getAbstractFileByPath(entry.path) === entry) await fm.trashFile(entry);
      return true;
    } catch (err) {
      console.error('Design Redux: could not delete', err);
      new Notice(`Could not delete “${entry.name}”.`);
      return false;
    }
  }

  /** A row being edited: a handle to drag, the name to change, move and delete. */
  editRow(list, file, index) {
    const row = list.createDiv({ cls: 'dr-track is-editing' });
    row.dataset.path = file.path;
    if (file.parent) row.dataset.folder = file.parent.path;

    const grip = row.createDiv({ cls: 'dr-edit-grip' });
    setIcon(grip, 'grip-vertical');
    grip.setAttribute('role', 'button');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-label', `Move “${file.basename}” — drag, or Alt+↑ and Alt+↓`);

    row.createDiv({ cls: 'dr-track-num', text: String(index) });
    const name = row.createEl('input', { cls: 'dr-track-name dr-edit-name', type: 'text' });
    name.value = file.basename;
    name.dataset.editPath = file.path;
    name.setAttribute('aria-label', 'Note name');
    this.editField(name, file.basename, (value) => this.renameEntry(file, value));

    const tools = row.createDiv({ cls: 'dr-edit-tools' });
    const tool = (icon, label, run, cls) => {
      const el = tools.createDiv({ cls: `clickable-icon dr-edit-tool ${cls || ''}`.trim() });
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      onActivate(el, run);
    };
    tool('folder-input', 'Move to another folder', () =>
      new FolderPicker(this.app, (folder) => this.plugin.moveFile(file, folder.path, { announce: true })).open()
    );
    tool('trash-2', 'Delete', () => this.deleteEntry(file), 'mod-warning');

    this.dragRow(row, grip, file);
  }

  /** A subfolder's heading while editing: its name, and a way to delete it. */
  editDiscHead(head, disc, album) {
    head.addClass('is-editing');
    const grip = head.createDiv({ cls: 'dr-edit-grip' });
    setIcon(grip, 'grip-vertical');
    grip.setAttribute('role', 'button');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-label', `Move the folder “${disc.folder.name}” — drag it onto another`);
    this.dragDisc(head, grip, disc.folder, album);
    const name = head.createEl('input', { cls: 'dr-disc-title dr-edit-name', type: 'text' });
    name.value = disc.folder.name;
    name.dataset.editPath = disc.folder.path;
    name.setAttribute('aria-label', 'Folder name');
    this.editField(name, disc.folder.name, (value) => this.renameEntry(disc.folder, value));
    head.createSpan({
      cls: 'dr-disc-count',
      text: disc.files.length === 1 ? '1 note' : `${disc.files.length} notes`,
    });
    const move = head.createDiv({ cls: 'clickable-icon dr-edit-tool' });
    move.setAttribute('role', 'button');
    move.setAttribute('tabindex', '0');
    move.setAttribute('aria-label', `Move the folder “${disc.folder.name}” into another`);
    setIcon(move, 'folder-input');
    onActivate(move, () => this.pickFolderHome(disc.folder));
    const del = head.createDiv({ cls: 'clickable-icon dr-edit-tool mod-warning' });
    del.setAttribute('role', 'button');
    del.setAttribute('tabindex', '0');
    del.setAttribute('aria-label', `Delete the folder “${disc.folder.name}”`);
    setIcon(del, 'trash-2');
    onActivate(del, () => this.deleteEntry(disc.folder));
  }

  /** Somewhere else for a folder: any folder but itself and those inside it. */
  pickFolderHome(folder) {
    const inside = (f) => f === folder || f.path.startsWith(folder.path + '/');
    new FolderPicker(
      this.app,
      (target) => this.moveFolderInto(folder, target.path),
      { withRoot: true, skip: inside, placeholder: `Move “${folder.name}” into…` }
    ).open();
  }

  async moveFolderInto(folder, targetPath) {
    return !!(await this.plugin.moveFile(folder, targetPath, { announce: true }));
  }

  /**
   * Drag a subfolder's heading onto another disc's to put it inside that
   * folder — or onto the album's own heading to bring it back to the
   * top. The heading under the pointer lights up; Escape calls it off.
   */
  dragDisc(head, grip, folder, album) {
    grip.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      down.preventDefault();
      const list = head.parentElement;
      const startX = down.clientX;
      const startY = down.clientY;
      let dragging = false;
      let target = null;

      // Somewhere it can go: not itself, not inside itself, not where it is.
      const allowed = (path) => {
        if (!path || path === folder.path || path.startsWith(folder.path + '/')) return false;
        return path !== (folder.parent ? folder.parent.path : '/');
      };
      const mark = (el) => {
        if (target === el) return;
        if (target) target.removeClass('is-drop-target');
        target = el;
        if (target) target.addClass('is-drop-target');
      };
      let lastX = startX;
      const hover = (x, y) => {
        const doc = head.ownerDocument;
        const under = doc.elementFromPoint ? doc.elementFromPoint(x, y) : null;
        const over = under && typeof under.closest === 'function' ? under.closest('.dr-disc[data-folder]') : null;
        mark(over && list.contains(over) && allowed(over.dataset.folder) ? over : null);
      };
      const scroller = edgeScroll(list, (y) => hover(lastX, y));
      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4 && Math.abs(evt.clientX - startX) < 4) return;
          dragging = true;
          head.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        lastX = evt.clientX;
        hover(evt.clientX, evt.clientY);
        scroller.at(evt.clientY);
      };
      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        scroller.stop();
        const chosen = target;
        mark(null);
        head.removeClass('is-dragging');
        list.removeClass('is-sorting');
        if (keep && dragging && chosen) this.moveFolderInto(folder, chosen.dataset.folder);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /** A note made in the album, named where it's listed rather than opened. */
  async editNewNote(folder) {
    try {
      const file = await this.app.vault.create(this.plugin.freeChildPath(folder, 'Untitled', 'md'), '');
      this.render();
      const input = this.contentEl.querySelector(`.dr-edit-name[data-edit-path="${CSS.escape(file.path)}"]`);
      if (input) {
        input.focus();
        input.select();
      }
      return file;
    } catch (err) {
      console.error('Design Redux: could not create the note', err);
      new Notice('Could not create the note.');
      return null;
    }
  }

  /** A subfolder — a new disc — named first, and shown even while empty. */
  editNewFolder(parent) {
    new NamePrompt(this.app, 'New folder', 'Folder name', async (name) => {
      const clean = name.replace(/[\\/:]/g, '').trim();
      if (!clean) return;
      const dir = !parent || parent.path === '/' ? '' : parent.path + '/';
      const path = normalizePath(dir + clean);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(`“${clean}” already exists here.`);
        return;
      }
      try {
        await this.app.vault.createFolder(path);
        this.render();
      } catch (err) {
        console.error('Design Redux: could not create the folder', err);
        new Notice('Could not create the folder.');
      }
    }).open();
  }

  /**
   * Put a note before or after another in its album, and keep that
   * order. The album switches to it, as a playlist keeps the order you
   * drag its songs into.
   */
  arrangeTrack(path, targetPath, after) {
    const file = this.app.vault.getFileByPath(path);
    const target = this.app.vault.getFileByPath(targetPath);
    if (!file || !target || !file.parent || file.parent !== target.parent) return false;
    const names = this.allNotesIn(file.parent).map((f) => f.name);
    const rest = names.filter((n) => n !== file.name);
    const at = rest.indexOf(target.name);
    const before = after ? rest[at + 1] : target.name;
    this.plugin.orders.setAlbum(file.parent, moveBefore(names, file.name, before === undefined ? null : before));
    this.plugin.refreshBrowse();
    return true;
  }

  /** Save the order a disc's rows are in now. */
  saveRowOrder(list, folderPath) {
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) return;
    const rows = Array.from(list.querySelectorAll('.dr-track[data-path]')).filter(
      (r) => r.dataset.folder === folderPath
    );
    const shown = rows.map((r) => r.dataset.path.split('/').pop());
    // Notes not drawn (there are none while editing, but to be sure) keep their place after.
    const others = this.allNotesIn(folder).map((f) => f.name).filter((n) => shown.indexOf(n) === -1);
    this.plugin.orders.setAlbum(folder, shown.concat(others));
    this.plugin.refreshBrowse();
  }

  /**
   * Drag a row by its handle, to anywhere in the album: among its own
   * disc's rows to put it in order, or into another disc to move the
   * note into that folder, at that place. Pointer events, so a finger
   * works as well as a mouse; nothing happens until it has moved a
   * little, and Escape puts the row back. Alt+arrows move it one place
   * from the keyboard, over the edge of a disc into the next.
   */
  dragRow(row, grip, file) {
    const home = row.dataset.folder;
    // Rows and disc headings, top to bottom; a row belongs to the
    // heading above it.
    const items = (list) => Array.from(list.querySelectorAll('.dr-track[data-path], .dr-disc[data-folder]'));
    const discAbove = (el) => {
      let at = el.previousElementSibling;
      while (at && !(at.matches('.dr-disc[data-folder]'))) at = at.previousElementSibling;
      return at;
    };

    grip.addEventListener('keydown', (evt) => {
      if (!evt.altKey || (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown')) return;
      evt.preventDefault();
      const list = row.parentElement;
      const all = items(list);
      const at = all.indexOf(row);
      const up = evt.key === 'ArrowUp';
      const next = all[at + (up ? -1 : 1)];
      if (!next) return;
      if (up) {
        // Over the album's first heading there's nowhere to go.
        if (next.matches('.dr-disc') && all.indexOf(next) === 0) return;
        list.insertBefore(row, next);
      } else {
        list.insertBefore(row, next.nextSibling);
      }
      this.commitRow(list, row, file, home, discAbove(row));
    });

    grip.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      down.preventDefault();
      const list = row.parentElement;
      const startY = down.clientY;
      const before = Array.from(list.children);
      let dragging = false;
      // Near the album's top or bottom edge, it scrolls, and the row follows.
      const scroller = edgeScroll(list, (y) => place(y));

      const place = (y) => {
        const others = items(list).filter((el) => el !== row);
        if (!others.length) return;
        const next = others.find((el) => {
          const box = el.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        // Never above the first heading: a row needs a disc to be in.
        if (next === others[0]) {
          if (others[1] !== undefined && row.nextElementSibling !== others[1]) list.insertBefore(row, others[1]);
          else if (others[1] === undefined) list.appendChild(row);
        } else if (next) {
          if (row.nextElementSibling !== next) list.insertBefore(row, next);
        } else if (list.lastElementChild !== row) {
          list.appendChild(row);
        }
        const disc = discAbove(row);
        list.querySelectorAll('.dr-disc.is-drop-target').forEach((el) => el !== disc && el.removeClass('is-drop-target'));
        if (disc && disc.dataset.folder !== home) disc.addClass('is-drop-target');
      };
      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4) return;
          dragging = true;
          row.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        place(evt.clientY);
        scroller.at(evt.clientY);
      };
      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        scroller.stop();
        if (!dragging) return;
        row.removeClass('is-dragging');
        list.removeClass('is-sorting');
        list.querySelectorAll('.dr-disc.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
        if (!keep) {
          before.forEach((el) => list.appendChild(el));
          return;
        }
        this.commitRow(list, row, file, home, discAbove(row));
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /**
   * Where a moved row landed, kept: the order of its disc, and — if
   * that's another disc — the note moved into that folder first.
   */
  async commitRow(list, row, file, home, disc) {
    const folder = disc ? disc.dataset.folder : home;
    if (folder !== home) {
      if (!(await this.plugin.moveFile(file, folder, { announce: true }))) {
        this.render();
        return;
      }
      row.dataset.folder = folder;
      row.dataset.path = file.path;
    }
    this.saveRowOrder(list, folder);
    const again = this.contentEl.querySelector(`.dr-track[data-path="${CSS.escape(file.path)}"] .dr-edit-grip`);
    if (again) again.focus();
  }

  /* -- pins in your own order ---------------------------------------- */

  /** Pinned, in the order kept for it, as the screen lists them. */
  pinnedInOrder() {
    return this.plugin.pins.all();
  }

  /** Move a pin one place, or to before another. */
  arrangePin(path, before) {
    const paths = this.pinnedInOrder().map((t) => t.path);
    this.plugin.orders.setPins(moveBefore(paths, path, before));
    const settings = this.plugin.settings;
    settings.keepOwnOrder = Object.assign({}, settings.keepOwnOrder, { pinned: true });
    this.plugin.saveData(settings);
    this.plugin.refreshBrowse();
    const library = this.plugin.feature(Library);
    if (library) library.refreshViews();
  }

  /** Earlier and later for one pin, where it isn't already at that end. */
  pinSteps(target) {
    return this.mode === 'pinned' ? this.tileSteps(target) : null;
  }

  /** A shelf's albums, in the order they were put in, or as sorted. */
  shelfFolders(shelf) {
    return this.plugin.orders.arrangeAlbum(shelf, this.visibleFolders(shelf), (list) => this.sortFolders(list));
  }

  /** A folder of nothing but folders. */
  isShelf(folder) {
    return !!folder && !(folder.children || []).some((c) => c instanceof TFile && !this.plugin.isFolderNote(c)) && this.visibleFolders(folder).length > 0;
  }

  /**
   * Where tiles on screen can be put in order: pins in their own order,
   * or the albums on a shelf, kept by name as an album keeps its notes.
   */
  tileOrder() {
    if (this.mode === 'pinned') {
      return this.keepsOwnOrder() ? { paths: () => this.pinnedInOrder().map((t) => t.path), move: (path, before) => this.arrangePin(path, before) } : null;
    }
    const shelf = this.mode === 'folder' ? this.folder() : null;
    if (!this.isShelf(shelf)) return null;
    const paths = () => this.shelfFolders(shelf).map((f) => f.path);
    return {
      paths,
      move: (path, before) => {
        this.plugin.orders.setAlbum(shelf, moveBefore(paths(), path, before).map((p) => p.split('/').pop()));
        this.render();
      },
    };
  }

  /** Earlier and later for one tile, where it isn't already at that end. */
  tileSteps(target) {
    const order = this.canArrange() ? this.tileOrder() : null;
    if (!order) return null;
    const paths = order.paths();
    const at = paths.indexOf(target.path);
    if (at === -1) return null;
    return {
      earlier: at > 0 ? () => order.move(target.path, paths[at - 1]) : null,
      later: at < paths.length - 1 ? () => order.move(target.path, paths[at + 2] === undefined ? null : paths[at + 2]) : null,
    };
  }

  /**
   * Folder tiles in one grid, or grouped as the setting says: by kind of
   * album, or by the folder they're in. The grids, to arrange.
   */
  folderTiles(root, folders, subtitle) {
    const by = this.plugin.settings.tileGroups;
    const structure = typeof AlbumStructure === 'function' ? this.plugin.feature(AlbumStructure) : null;
    const top = (f) => !f.parent || (f.parent.isRoot && f.parent.isRoot());
    const keyOf =
      by === 'kind' && structure && structure.enabled
        ? (f) => structure.info(f).label
        : by === 'collection'
          ? (f) => (top(f) ? '' : f.parent.name)
          : null;
    const draw = (list) => {
      const grid = root.createDiv({ cls: 'dr-grid' });
      roveFocus(grid, '.dr-card');
      list.forEach((f) => this.folderCard(grid, f, subtitle ? subtitle(f) : undefined));
      return grid;
    };
    const groups = new Map();
    if (keyOf) folders.forEach((f) => groups.set(keyOf(f), (groups.get(keyOf(f)) || []).concat(f)));
    if (!keyOf || groups.size < 2) return [draw(folders)];
    const keys = Array.from(groups.keys()).filter(Boolean).sort(byName);
    if (groups.has('')) keys.push('');
    return keys.map((key) => {
      root.createDiv({ cls: 'dr-tile-group-head', text: key || (by === 'kind' ? 'No kind given' : this.app.vault.getName()) });
      return draw(groups.get(key));
    });
  }

  /** Tiles that can be dragged into order, on desktop: pins, or a shelf's albums. */
  arrangeableTiles(grid) {
    const order = this.tileOrder();
    if (Platform.isMobile || !order) return;
    let dragged = null;
    grid.querySelectorAll('.dr-card[data-path]').forEach((card) => {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (evt) => {
        dragged = card.dataset.path;
        evt.dataTransfer.setData('text/dr-pin', dragged);
        evt.dataTransfer.effectAllowed = 'move';
        card.addClass('is-dragging');
      });
      card.addEventListener('dragend', () => {
        dragged = null;
        card.removeClass('is-dragging');
      });
    });
    const clear = () =>
      grid.querySelectorAll('.is-drop-before, .is-drop-after').forEach((el) => el.removeClass('is-drop-before', 'is-drop-after'));
    const over = (evt) => {
      const card = evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('.dr-card[data-path]') : null;
      if (!card || !dragged || card.dataset.path === dragged) return null;
      const box = card.getBoundingClientRect();
      return { card, after: evt.clientX > box.left + box.width / 2 };
    };
    grid.addEventListener('dragover', (evt) => {
      const at = over(evt);
      clear();
      if (!at || !this.canArrange()) return;
      evt.preventDefault();
      at.card.addClass(at.after ? 'is-drop-after' : 'is-drop-before');
    });
    grid.addEventListener('drop', (evt) => {
      const at = over(evt);
      clear();
      if (!at || !this.canArrange()) return;
      evt.preventDefault();
      const paths = order.paths().filter((p) => p !== dragged);
      const i = paths.indexOf(at.card.dataset.path);
      const before = at.after ? paths[i + 1] : paths[i];
      order.move(dragged, before === undefined ? null : before);
    });
    // Alt+left and right move the focused tile, from the keyboard.
    grid.addEventListener('keydown', (evt) => {
      if (!evt.altKey || (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight')) return;
      const card = evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('.dr-card[data-path]') : null;
      if (!card) return;
      const target = this.app.vault.getAbstractFileByPath(card.dataset.path);
      const steps = target && this.tileSteps(target);
      const step = steps && (evt.key === 'ArrowLeft' ? steps.earlier : steps.later);
      if (!step) return;
      evt.preventDefault();
      step();
      const again = this.contentEl.querySelector(`.dr-card[data-path="${CSS.escape(card.dataset.path)}"]`);
      if (again) again.focus();
    });
  }

  /* -- keys and scroll ----------------------------------------------- */

  /** "/" jumps to Find, as on the web; Escape leaves editing. */
  onKey(evt) {
    const target = evt.target;
    const typing = target && typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"]');
    if (evt.key === '/' && !evt.metaKey && !evt.ctrlKey && !evt.altKey && !typing) {
      if (this.focusFind()) evt.preventDefault();
      return;
    }
    if (evt.key === 'Escape' && this.editing && !typing) {
      evt.preventDefault();
      this.setEditing(false);
    }
  }

  focusFind() {
    const input = this.contentEl && this.contentEl.querySelector('.dr-browse-search input');
    if (!input) return false;
    input.focus();
    if (typeof input.select === 'function') input.select();
    return true;
  }

  /** Where the page was scrolled to, kept with each step in the history. */
  getEphemeralState() {
    const base = typeof super.getEphemeralState === 'function' ? super.getEphemeralState() : {};
    return Object.assign({}, base, { scroll: this.contentEl ? this.contentEl.scrollTop : 0 });
  }

  /** Back and forward return to where the page was. */
  setEphemeralState(state) {
    if (typeof super.setEphemeralState === 'function') super.setEphemeralState(state);
    const y = state && typeof state.scroll === 'number' ? state.scroll : null;
    if (y === null || !this.contentEl) return;
    this.contentEl.scrollTop = y;
    // Covers load after the page is drawn, so it may not be tall enough yet.
    window.setTimeout(() => {
      if (this.contentEl && this.contentEl.scrollTop < y) this.contentEl.scrollTop = y;
    }, 150);
  }

  /* -- the list --------------------------------------------------- */

  trackRow(list, file, index) {
    const row = list.createDiv({ cls: 'dr-track' });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    // Which disc the row belongs to, so a drop knows what it's over.
    if (file.parent) row.dataset.folder = file.parent.path;
    row.dataset.path = file.path;
    // Not on touch: iOS starts a drag from a long press on anything
    // draggable, which is the gesture the row's menu needs. Moving a
    // note is in that menu instead, as Obsidian's "Move file to…".
    if (!Platform.isMobile) {
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', (evt) => {
        evt.dataTransfer.setData('text/dr-file', file.path);
        evt.dataTransfer.effectAllowed = 'move';
        row.addClass('is-dragging');
        // Types, not data, can be read while dragging, so which note and
        // disc are kept here for the rows to compare against.
        this.dragging = { path: file.path, folder: file.parent ? file.parent.path : '/' };
      });
      row.addEventListener('dragend', () => {
        row.removeClass('is-dragging');
        this.dragging = null;
      });
    }

    row.createDiv({ cls: 'dr-track-num', text: String(index) });

    const name = row.createDiv({ cls: 'dr-track-name' });
    if (this.isPinned(file)) {
      // Pinned is this list's favourite: a mark beside the title.
      name.addClass('has-mark');
      name.createSpan({ cls: 'dr-track-title', text: file.basename });
      const pin = name.createSpan({ cls: 'dr-track-pin' });
      pin.setAttribute('aria-label', 'Pinned');
      setIcon(pin, 'pin');
    } else {
      name.setText(file.basename);
    }

    this.albumColumns().forEach((key) =>
      row.createDiv({
        cls: this.isTimeColumn(key) ? 'dr-track-time' : 'dr-track-sub',
        text: this.columnValue(file, key),
      })
    );

    // Its length, where a track's would be: the last column, lined up.
    const style = this.lengthStyle();
    if (style) {
      const length = row.createDiv({ cls: 'dr-track-length', text: this.lengthLabel(file) });
      if (style === 'words') length.addClass('is-words');
    }

    const more = row.createDiv({ cls: 'clickable-icon dr-track-more' });
    more.setAttribute('aria-label', 'More');
    setIcon(more, 'ellipsis');

    more.addEventListener('click', (evt) => this.fileMenu(evt, file));
    onContextMenu(row, (evt) => this.fileMenu(evt, file));
    onActivate(row, (evt) => this.openFile(file, evt), false);
  }

  /**
   * What each album row shows after the title, from settings. Property
   * names, plus three that aren't properties: modified, created and
   * folder.
   */
  albumColumns() {
    return (this.plugin.settings.albumColumns || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  isTimeColumn(key) {
    return key === 'modified' || key === 'created';
  }

  columnValue(file, key) {
    if (key === 'modified') return this.relative(file.stat.mtime);
    if (key === 'created') return this.relative(file.stat.ctime);
    if (key === 'folder') return file.parent ? file.parent.name : '';
    if (file.extension !== 'md') return '';
    return this.valueOf(file, key);
  }

  /* -- lengths, marks -------------------------------------------- */

  /** How lengths are written here — 'time' or 'words' — or null for none. */
  lengthStyle() {
    const style = this.plugin.settings.trackLength;
    if (!this.plugin.lengths || !LENGTH_STYLES[style] || style === 'none') return null;
    return style;
  }

  /** A note's length for its row. One not yet counted is counted once the page is drawn. */
  lengthLabel(file) {
    const lengths = this.plugin.lengths;
    if (lengths.measurable(file) && lengths.words(file) === null) this.toMeasure.push(file);
    return lengths.label(file, this.lengthStyle());
  }

  /**
   * An album's length, all its notes together. Not for a very large
   * one — the vault's root holds every note — which would mean reading
   * the whole vault to write one line.
   */
  totalLength(files) {
    const style = this.lengthStyle();
    if (!style || files.length > 400) return '';
    const total = this.plugin.lengths.total(files, style);
    if (total !== null) return total;
    files.forEach((f) => this.toMeasure.push(f));
    return '';
  }

  /** What one drawing works out once, forgotten before the next. */
  beginDrawing() {
    this.toMeasure = [];
    this.pinMemo = null;
  }

  /**
   * The end of an album, as the reference ends one: when it began, and
   * how much there is — small, under the last track.
   */
  renderAlbumFoot(root, files) {
    if (!files.length) return;
    const first = files.reduce((t, f) => Math.min(t, f.stat.ctime || Infinity), Infinity);
    const foot = root.createDiv({ cls: 'dr-album-foot' });
    if (Number.isFinite(first) && first > 0) {
      foot.createDiv({
        text: `Started ${new Date(first).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`,
      });
    }
    const count = files.length === 1 ? '1 note' : `${files.length} notes`;
    const length = this.totalLength(files);
    foot.createDiv({ text: length ? `${count}, ${length.replace(/ read$/, '')}` : count });
  }

  /**
   * The folders beside this one, as an album page ends with more by the
   * same artist. Not while Find or a filter narrows the page.
   */
  renderMoreIn(root, folder) {
    if (!folder || (folder.isRoot && folder.isRoot()) || !folder.parent) return;
    if (this.query.trim() || this.hasFilters()) return;
    const parent = folder.parent;
    const others = this.sortFolders(this.visibleFolders(parent).filter((f) => f !== folder));
    if (!others.length) return;
    const top = !!(parent.isRoot && parent.isRoot());
    this.shelf(root, top ? 'More folders' : `More in ${parent.name}`, others, { head: () => this.openFolder(parent) });
  }

  /** Count what the drawing found uncounted, and draw again once it's known. */
  measureLater() {
    const files = this.toMeasure || [];
    this.toMeasure = [];
    if (!files.length || !this.plugin.lengths) return;
    this.plugin.lengths.measure(files).then(
      (changed) => {
        if (changed) this.queueRender();
      },
      (err) => console.error('Design Redux: could not count words', err)
    );
  }

  /** Whether a note is pinned. The pins are gathered once per drawing. */
  isPinned(file) {
    if (!this.pinMemo) {
      const pins = this.plugin.pins;
      const all = pins && typeof pins.all === 'function' ? pins.all() : [];
      this.pinMemo = new Set(all.map((t) => t.path));
    }
    return this.pinMemo.has(file.path);
  }

  /** Short, in the spirit of a track length: a glance, not a date. */
  relative(mtime) {
    return relativeDay(mtime);
  }

  /** A note's property values, flattened for matching against. */
  propertyText(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    return Object.keys(fm)
      .filter((k) => k !== 'position')
      .map((k) => {
        const v = fm[k];
        return Array.isArray(v) ? v.join(' ') : String(v === null ? '' : v);
      })
      .join(' ')
      .toLowerCase();
  }

  matches(name) {
    const q = this.query.trim().toLowerCase();
    return !q || name.toLowerCase().includes(q);
  }

  /* -- shelves ---------------------------------------------------- */

  /**
   * A titled row of tiles that scrolls sideways. The heading is the way
   * through to the whole of whatever it's showing, as a section header
   * is on a home screen; arrows beside it page through the row.
   */
  shelf(root, title, items, opts = {}) {
    const view = this;
    const head = root.createDiv({ cls: 'dr-shelf-head' });
    const label = head.createDiv({ cls: 'dr-shelf-label' });
    const through = opts.head || (opts.mode ? () => view.navigate({ mode: opts.mode, property: null }) : null);
    if (through) {
      label.setAttribute('role', 'button');
      label.setAttribute('tabindex', '0');
      label.addClass('is-linked');
      onActivate(label, through);
    }
    label.createSpan({ cls: 'dr-shelf-title', text: title });
    if (through) setIcon(label.createSpan({ cls: 'dr-shelf-more' }), 'chevron-right');

    const row = root.createDiv({ cls: 'dr-shelf-row' });
    roveFocus(row, '.dr-card');
    items.forEach((item) => {
      if (item instanceof TFolder) view.folderCard(row, item);
      else view.fileCard(row, item);
    });
    this.arrows(head, row);
  }

  /** ‹ and ›, paging a shelf that runs past the edge. Swiped on touch instead. */
  arrows(head, row) {
    const arrows = head.createDiv({ cls: 'dr-shelf-arrows' });
    const button = (icon, label, dir) => {
      const el = arrows.createDiv({ cls: 'clickable-icon dr-shelf-arrow' });
      el.setAttribute('aria-label', label);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '-1');
      setIcon(el, icon);
      onActivate(el, () => {
        const by = Math.max(row.clientWidth * 0.85, 160) * dir;
        if (typeof row.scrollBy === 'function') row.scrollBy({ left: by, behavior: 'smooth' });
        else row.scrollLeft += by;
      });
      return el;
    };
    const back = button('chevron-left', 'Scroll back', -1);
    const on = button('chevron-right', 'Scroll on', 1);
    const sync = () => {
      const room = row.scrollWidth - row.clientWidth;
      head.toggleClass('has-overflow', room > 2);
      back.toggleClass('is-disabled', row.scrollLeft <= 2);
      on.toggleClass('is-disabled', row.scrollLeft >= room - 2);
    };
    row.addEventListener('scroll', sync, { passive: true });
    // Its width is only known once it's on the page, and changes with
    // the page's; pointing at the shelf is when the arrows matter.
    head.addEventListener('pointerenter', sync);
    row.addEventListener('pointerenter', sync);
    window.setTimeout(sync, 0);
  }

  /* -- cards ------------------------------------------------------ */

  folderCard(grid, folder, subtitle) {
    const card = this.card(grid, folder.name, subtitle || this.countLabel(folder));
    card.dataset.path = folder.path;
    // What kind of album, small above its name.
    const structure = this.plugin.feature(AlbumStructure);
    const kind = structure ? structure.info(folder).label : '';
    if (kind) {
      const label = card.ownerDocument.createElement('div');
      label.className = 'dr-card-kind';
      label.textContent = kind;
      card.insertBefore(label, card.querySelector('.dr-card-title'));
    }
    const src = this.folderCover(folder);
    drawFolderArt(this.plugin, card.querySelector('.dr-card-art'), folder);
    // On the cover, when pointed at: straight into its first note, and
    // its menu — as a tile offers Play and More.
    this.cardButtons(card, () => {
      const first = this.notesIn(folder)[0] || this.allNotesIn(folder)[0];
      if (first) this.openFile(first);
      else this.openFolder(folder);
    }, (evt) => this.folderMenu(evt, folder, src));

    onActivate(card, () => this.openFolder(folder));
    onContextMenu(card, (evt) => this.folderMenu(evt, folder, src));
  }

  /** A single file as a tile: its cover, or an icon for its type. */
  fileCard(grid, file) {
    const card = this.card(
      grid,
      file.basename,
      file.parent && file.parent.path !== '/' ? file.parent.name : ''
    );
    card.dataset.path = file.path;
    drawNoteArt(this.plugin, card.querySelector('.dr-card-art'), file);
    this.cardButtons(card, null, (evt) => this.fileMenu(evt, file));

    onActivate(card, (evt) => this.openFile(file, evt));
    onContextMenu(card, (evt) => this.fileMenu(evt, file));
  }

  /**
   * Round buttons over a tile's cover, shown when it's pointed at: one
   * to open straight away where there's something to open, and More.
   * Their clicks are theirs, not the tile's.
   */
  cardButtons(card, open, menu) {
    const art = card.querySelector('.dr-card-art');
    if (!art) return;
    const bar = art.createDiv({ cls: 'dr-card-buttons' });
    const button = (icon, label, run, cls) => {
      const el = bar.createDiv({ cls: `dr-card-button ${cls}` });
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      el.addEventListener('click', (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        run(evt);
      });
    };
    if (open) button('book-open', 'Open the first note', open, 'is-open');
    if (menu) button('ellipsis', 'More', menu, 'is-more');
  }

  card(grid, title, subtitle) {
    const card = grid.createDiv({ cls: 'dr-card' });
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.createDiv({ cls: 'dr-card-art' });
    card.createDiv({ cls: 'dr-card-title', text: title });
    if (subtitle) card.createDiv({ cls: 'dr-card-sub', text: subtitle });

    return card;
  }

  countLabel(folder) {
    const n = countFilesIn(folder);
    return n === 1 ? '1 item' : `${n} items`;
  }

  /** The line under a note's name in a list. */
  subtitleFor(file) {
    if (file.extension !== 'md') return file.extension.toUpperCase();
    return leadProperty(this.app, file, false);
  }

  folderCover(folder) {
    return this.plugin.folderCoverSrc(folder);
  }

  coverFor(file) {
    return noteCoverSrc(this.plugin, file);
  }
}

