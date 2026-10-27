/* ------------------------------------------------------------------ */
/* Browse                                                              */
/*                                                                     */
/* The main area, in four shapes: a folder as an album page, a         */
/* property as a list of its values, every folder as tiles, and every  */
/* note as a table.                                                    */
/* ------------------------------------------------------------------ */

import { Menu, Notice, Scope, setIcon, TFile, TFolder } from 'obsidian';
import { BROWSE_VIEW, GRID_DENSITIES, LIBRARY_HOVER_SOURCE, TAG_KEYS } from '../core/020-constants.js';
import { blankLook, byName, canStep, fillArt, leafHistory, onContextMenu, showMenuAt, showTargetMenu, step } from '../core/030-helpers-art.js';
import { asButton, fullNameOnHover, iconWord, onActivate, roveFocus, TABLE_SORTS } from '../core/040-helpers-sorting.js';
import { fmGet, plainValue, propertyCounter } from '../core/045-helpers-properties.js';
import { libraryIndex } from '../core/077-library-index.js';
import { ACTION_CONTEXTS } from '../core/078-actions.js';
import { ARTWORK_SIZES } from '../core/085-appearance.js';
import { FolderScreen } from './110-browse-screens.js';
import { BROWSE_SCREENS } from './119-browse-registry.js';
import { BrowseAlbum } from './125-browse-album.js';
import { ContextStrip } from '../tools/190-strip.js';
import { BulkEditing } from '../tools/310-bulk-feature.js';

export class BrowseView extends BrowseAlbum {
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
    let moved = true;
    if (state) {
      const was = this.screenKey();
      const to = JSON.stringify([state.mode || this.mode, state.path || this.path, state.property !== undefined ? state.property : this.property, state.value || null]);
      // Leaving the search screen with something typed counts as having
      // searched for it; the query is about to be cleared.
      if (to !== was) this.rememberSearch();
      if (state.mode) this.mode = state.mode;
      if (state.path) this.path = state.path;
      if (state.property !== undefined) this.property = state.property;
      this.value = state.value || null;
      if (state.trail !== undefined) this.trail = state.trail || null;
      // The same screen asked for again — Obsidian restoring the tab, or a
      // second ask as it opens — keeps what's typed, filtered and picked.
      moved = this.screenKey() !== was;
      if (moved || typeof state.query === 'string') this.startClean(state);
    }
    // A move to another screen is a step Obsidian's back and forward
    // should know about; it records one only when told.
    if (state && result && JSON.stringify(this.getState()) !== before) result.history = true;
    // Typing in Find on this same screen: the field stays as it is, and what's under it is redrawn.
    const doc = this.contentEl ? this.contentEl.ownerDocument : null;
    const active = doc ? doc.activeElement : null;
    if (!moved && active && this.contentEl.contains(active) && active.matches('.dr-browse-search input')) {
      this.renderBelowBar();
    } else {
      this.render();
      if (this.contentEl) this.contentEl.scrollTop = 0;
    }
    // A move within the same tab changes neither the leaf nor the file,
    // so nothing else tells the strip it's on another screen now.
    const strip = typeof this.plugin.feature === 'function' ? this.plugin.feature(ContextStrip) : null;
    if (strip && strip.enabled) strip.update();
    return super.setState(state, result);
  }

  /** Which screen this is: what it shows, not how it's refined. */
  screenKey() {
    return JSON.stringify([this.mode, this.path, this.property, this.value]);
  }

  /** A move to another screen starts clean; refinements within one screen keep their own state. */
  startClean(state) {
    this.selected = null;
    // Find starts empty, unless the move is a search carried over.
    this.query = typeof state.query === 'string' ? state.query : '';
    // Unless asked to keep them: narrowing step by step across properties.
    if (!state.keepFilters) this.clearFilters();
    this.smartLoaded = null;
    this.editing = false;
  }

  async onOpen() {
    this.containerEl.addClass('dr-browse');
    this.render();
    // What's picked is marked wherever it's listed.
    if (this.plugin.selection) {
      this.unpick = this.plugin.selection.onChange(() => this.markPicked());
    }
    this.registerEvent(this.app.workspace.on('layout-change', () => this.markPreviewToggle()));
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
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.followDelete(file);
        this.queueRender();
      })
    );
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
      this.app.metadataCache.on('changed', (file) => {
        // A value changed in its row is shown there already: no redraw for it.
        if (file && this.quietChanges && this.quietChanges.delete(file.path)) return;
        this.queueRender();
      })
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

  /** A note or a folder deleted: what was ticked there is let go. */
  followDelete(file) {
    if (this.bulkSelection) this.bulkSelection.remove(file.path);
  }

  /**
   * A folder renamed or moved while it's shown — or while it's the
   * filter, or on the way back down — is followed to its new path,
   * rather than the page falling back to the vault's root.
   */
  followRename(file, oldPath) {
    // What's ticked follows a note or a folder renamed.
    if (this.bulkSelection) this.bulkSelection.rename(oldPath, file.path);
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
    // What had the keys, if it's drawn again unchanged, keeps them.
    const active = root.ownerDocument.activeElement;
    const held = active && active !== root && root.contains(active) ? active : null;
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
    if (held && held.isConnected && root.ownerDocument.activeElement !== held) held.focus({ preventScroll: true });
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

    // Modified is a calendar, to be read at a glance; its word is the tooltip.
    if (key === 'modified') iconWord(cell.createSpan({ cls: 'dr-td-text' }), 'calendar', label);
    else cell.createSpan({ cls: 'dr-td-text', text: label });
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

  /** The property tools over some notes — those picked, found or in a saved view — rather than folders. */
  propertyToolsFor(files) {
    const bulk = this.plugin.feature(BulkEditing);
    if (bulk && files.length) bulk.openTools(files.slice(), null);
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
    if (file.parent && !here && typeof this.revealInAlbum === 'function') out.push(['Reveal in collection', 'folder-open', () => this.revealInAlbum(file)]);
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

  /** "/" jumps to Find, as on the web; Escape lets go of what's ticked, then leaves editing; Mod+A ticks every note shown. */
  onKey(evt) {
    const target = evt.target;
    // A row's tick box is an input, but no one types in it.
    const typing = target && typeof target.closest === 'function' && target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]');
    if (evt.key === '/' && !evt.metaKey && !evt.ctrlKey && !evt.altKey && !typing) {
      if (this.focusFind()) evt.preventDefault();
      return;
    }
    if (evt.key === 'Escape' && this.editing && !typing) {
      evt.preventDefault();
      if (this.bulkSelection && this.bulkSelection.size) {
        this.bulkSelection.clear();
        this.showTicks();
      } else this.setEditing(false);
      return;
    }
    if (evt.key === 'a' && (evt.metaKey || evt.ctrlKey) && !evt.altKey && !evt.shiftKey && this.editing && !typing && this.shownPaths().length) {
      evt.preventDefault();
      this.tickAllShown();
      return;
    }
    // Space on a note's row or tile: a look at it, without opening it.
    if (evt.key === ' ' && !typing && !evt.metaKey && !evt.ctrlKey && !evt.altKey && this.quickLook(evt)) {
      evt.preventDefault();
      return;
    }
    // Escape lets go of what's picked here.
    const selection = this.plugin.selection;
    if (evt.key === 'Escape' && !typing && selection && selection.get() && this.contentEl.querySelector('.is-selected')) {
      evt.preventDefault();
      selection.clear();
    }
  }

  /** Obsidian's page preview of the note a row or tile stands for: read only, no history. */
  quickLook(evt) {
    const target = evt.target;
    const el = target && typeof target.closest === 'function' ? target.closest('[data-path]') : null;
    const file = el && this.app.vault.getAbstractFileByPath(el.dataset.path);
    if (!(file instanceof TFile) || file.extension !== 'md') return false;
    this.app.workspace.trigger('hover-link', {
      event: evt,
      source: LIBRARY_HOVER_SOURCE,
      hoverParent: this,
      targetEl: el,
      linktext: file.path,
      sourcePath: '',
    });
    return true;
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
