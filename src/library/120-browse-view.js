/* ------------------------------------------------------------------ */
/* Browse                                                              */
/*                                                                     */
/* The main area, in four shapes: a folder as an album page, a         */
/* property as a list of its values, every folder as tiles, and every  */
/* note as a table.                                                    */
/* ------------------------------------------------------------------ */

import { ItemView, Menu, Notice, Platform, Scope, setIcon, TFile, TFolder } from 'obsidian';
import { BROWSE_VIEW, GRID_DENSITIES, TAG_KEYS } from '../core/020-constants.js';
import { blankLook, byName, canStep, drawFolderArt, fillArt, leafHistory, onContextMenu, showMenuAt, showTargetMenu, step } from '../core/030-helpers-art.js';
import { asButton, fullNameOnHover, onActivate, roveFocus, TABLE_SORTS } from '../core/040-helpers-sorting.js';
import { fmGet, nestByProperty, plainValue, propertyCounter } from '../core/045-helpers-properties.js';
import { readingOf } from '../core/075-reading.js';
import { libraryIndex } from '../core/077-library-index.js';
import { ACTION_CONTEXTS } from '../core/078-actions.js';
import { ARTWORK_SIZES } from '../core/085-appearance.js';
import { BROWSE_SCREENS, FolderScreen, ROOT_MODES } from './110-browse-screens.js';
import { ContextStrip } from '../chrome/190-strip.js';
import { AlbumStructure } from './257-album-structure.js';
import { BulkEditing } from '../bulk/310-bulk-feature.js';

export class BrowseView extends ItemView {
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
      // Find starts empty, unless the move is a search carried over.
      this.query = typeof state.query === 'string' ? state.query : '';
      // Unless asked to keep them: narrowing step by step across properties.
      if (!state.keepFilters) this.clearFilters();
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
    // What's picked is marked wherever it's listed.
    if (this.plugin.selection) {
      this.unpick = this.plugin.selection.onChange(() => {
        this.markPicked();
        this.renderPreview();
      });
    }
    fullNameOnHover(this, this.containerEl);

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
    if (this.unpick) this.unpick();
    this.unpick = null;
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
    asButton(el);
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
      asButton(el);
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
    // Covers sized on their own, when set apart from the density.
    const art = this.plugin.settings.artworkSize;
    if (ARTWORK_SIZES[art] && art) this.containerEl.dataset.drArt = art;
    else delete this.containerEl.dataset.drArt;
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
    this.renderPreview();
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
    asButton(row);

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

    row.dataset.path = file.path;
    this.pickOrOpen(row, { file }, (evt) => this.openFile(file, evt), false);
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

    asButton(cell);
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

    libraryIndex(this.plugin).markdown().forEach((file) => {
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
    // Notes under the note their property names as parent, a step in; what's under a folded one hidden.
    // Not in search, whose order is how well each matches.
    const nestKey = this.mode === 'search' ? '' : String(this.plugin.settings.albumNestBy || '').trim();
    const entries = [];
    let hideBelow = -1;
    (nestKey ? nestByProperty(this.app, files, nestKey) : files.map((file) => ({ file, depth: 0, children: 0 }))).forEach((e) => {
      if (hideBelow >= 0 && e.depth > hideBelow) return;
      hideBelow = e.children && this.foldedNotes && this.foldedNotes.has(e.file.path) ? e.depth : -1;
      entries.push(e);
    });
    const expanded = this.expanded.has(key);
    const shown = expanded ? entries : entries.slice(0, limit);
    shown.forEach((e, i) => this.trackRow(list, e.file, i + 1, e));
    if (entries.length <= limit) return;

    const more = list.createDiv({ cls: 'dr-track dr-track-more-row' });
    asButton(more);
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
    if (this.editing && this.mode === 'folder') this.renderBulkBar(root);
    const list = root.createDiv({ cls: 'dr-tracks' });
    roveFocus(list, '.dr-track, .dr-disc[role="button"]');
    // Discs are folders, so dragging a note onto one moves it there; onto
    // a row of its own disc, it goes there in the album's order.
    if (!Platform.isMobile && !this.editing) this.acceptDrops(list);

    const key = `discs:${album ? album.path : ''}`;
    const cap = 24;
    const shown = this.expanded.has(key) ? discs : discs.slice(0, cap);

    // Every disc is headed, including the folder's own notes — but an
    // album of its own notes alone, whose header already counts them,
    // needs no heading for them.
    const lone = !this.editing && discs.length === 1 && !!album && discs[0].folder === album;
    shown.forEach((disc) => {
      if (lone) {
        this.renderLimited(list, disc.files, `disc:${album.path}`, this.limitFrom('discNoteLimit', 10));
        return;
      }
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
          asButton(head, `Open ${disc.folder.name}`);
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
    asButton(more);
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
        asButton(tint, 'Cover colour');
        setIcon(tint, 'palette');
        onActivate(tint, () => this.plugin.chooseCoverColor(folder));
      }
      const change = tools.createDiv({ cls: 'dr-art-edit' });
      asButton(change, spec.cover ? 'Change cover image' : 'Set cover image');
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
          asButton(crumb);
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
      asButton(up);
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
    // How far through it you are, once you've read any of it.
    else if (folder && this.plugin.settings.readingHistory) {
      const notes = files.filter((f) => f.extension === 'md');
      const read = readingOf(this.plugin).countRead(notes);
      if (read) meta.push(`${read} of ${notes.length} read`);
    }
    info.createDiv({ cls: 'dr-detail-meta', text: meta.join('  ·  ') });
    if (about && about.description) info.createDiv({ cls: 'dr-detail-desc', text: about.description });

    const actions = info.createDiv({ cls: 'dr-detail-actions' });
    if (editing) {
      this.action(actions, 'check', 'Done', () => this.setEditing(false)).addClass('is-primary');
      this.action(actions, 'file-plus', 'New note', () => this.editNewNote(folder));
      this.action(actions, 'folder-plus', 'New folder', () => this.editNewFolder(folder));
      return;
    }
    // Open leads, filled, as Play does — at the note you were on, where you've been in it.
    const resume = this.plugin.settings.readingHistory ? readingOf(this.plugin).lastOpened(files) : null;
    this.action(actions, 'book-open', resume && resume !== files[0] ? 'Continue' : 'Open', () => {
      const target = resume || files[0];
      if (target) this.app.workspace.getLeaf(false).openFile(target);
    }).addClass('is-primary');
    this.action(actions, 'shuffle', 'Random', () => {
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
    const first = this.noteOpenings(file);
    if (this.mode === 'pinned') {
      showTargetMenu(this.plugin, evt, file, { redraw: () => this.render(), arrange: this.pinSteps(file), first });
      return;
    }
    showTargetMenu(this.plugin, evt, file, { redraw: () => this.render(), first });
  }

  /** A note's own ways out of a list: a new tab, its album where that isn't here, and a link to paste. */
  noteOpenings(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return [];
    const out = [['Open in new tab', 'file-plus', () => this.app.workspace.getLeaf('tab').openFile(file)]];
    const here = this.mode === 'folder' && file.parent && file.parent.path === this.path;
    if (file.parent && !here && typeof this.revealInAlbum === 'function') out.push(['Reveal in album', 'folder-open', () => this.revealInAlbum(file)]);
    out.push([
      'Copy link',
      'link',
      () => {
        const link = this.app.fileManager.generateMarkdownLink(file, '');
        const clip = typeof navigator !== 'undefined' && navigator.clipboard;
        if (!clip) return;
        clip.writeText(link).then(() => new Notice('Link copied'), () => new Notice('Could not copy the link'));
      },
    ]);
    return out;
  }

  folderMenu(evt, folder, _src, opts) {
    showTargetMenu(this.plugin, evt, folder, {
      open: () => this.openFolder(folder),
      here: !!(opts && opts.here),
      redraw: () => this.render(),
      arrange: this.tileSteps(folder),
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
      return;
    }
    // Escape lets go of what's picked here.
    const selection = this.plugin.selection;
    if (evt.key === 'Escape' && !typing && selection && selection.get() && this.contentEl.querySelector('.is-selected')) {
      evt.preventDefault();
      selection.clear();
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
}

/* What a browse action acts on: the album the browse view shows. */
ACTION_CONTEXTS.browse = (app) => {
  const view = app.workspace.getActiveViewOfType(BrowseView);
  const folder = view && view.mode === 'folder' ? view.folder() : null;
  return folder ? { folder, view, from: 'palette' } : null;
};

