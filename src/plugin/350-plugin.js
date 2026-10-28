/* ------------------------------------------------------------------ */
/* Plugin: lifecycle only                                              */
/* ------------------------------------------------------------------ */

import { normalizePath, Notice, Plugin, TFolder } from 'obsidian';
import { BROWSE_VIEW, DEFAULTS, LIBRARY_VIEW } from '../core/020-constants.js';
import { liveViews } from '../core/030-helpers-art.js';
import { propertyLabel } from '../core/045-helpers-properties.js';
import { Pins } from '../core/060-pins.js';
import { Lengths } from '../core/065-lengths.js';
import { Orders, PATH_KEYED, SETTINGS_MIGRATIONS } from '../core/070-orders.js';
import { Notes } from '../core/073-notes.js';
import { Files } from '../core/074-files.js';
import { Selection } from '../core/076-selection.js';
import { LibraryIndex } from '../core/077-library-index.js';
import { WorkspaceCoordinator } from '../core/084-workspace-coordinator.js';
import { Appearance } from '../core/085-appearance.js';
import { ListKeys } from '../note/105-list-keys.js';
import { SidebarDrop } from '../library/107-sidebar-drop.js';
import { BrowseView } from '../library/120-browse-view.js';
import { Library } from '../library/130-browse-filters.js';
import { ActionsMenu } from '../tools/140-actions-menu.js';
import { NotePage } from '../library/140-note-page.js';
import { PropertyLinks } from '../note/165-panel-references.js';
import { PropertiesPanel } from '../note/180-panel.js';
import { ContextStrip } from '../tools/190-strip.js';
import { HeaderSkip } from '../tools/191-header-skip.js';
import { ReadingOutline } from '../note/195-reading-outline.js';
import { OnePage } from '../tools/200-one-page.js';
import { MenuFilter } from '../tools/210-menu-filter.js';
import { SettingsButton } from '../tools/220-settings-button.js';
import { NamePrompt } from '../ui/230-pickers.js';
import { CoverImages } from '../ui/235-covers.js';
import { CoverDrop } from '../ui/237-cover-drop.js';
import { ImageRouter } from '../ui/240-image-router.js';
import { PropertyClipboard } from '../ui/250-property-clipboard.js';
import { AlbumProperty } from '../library/255-album-property.js';
import { AlbumRefactor } from '../library/256-album-refactor.js';
import { AlbumStructure } from '../library/257-album-structure.js';
import { SmartAlbums } from '../library/258-smart-albums.js';
import { LibraryCheck } from '../library/259-library-check.js';
import { GraphPropertyFilter } from '../tools/260-graph-filter.js';
import { PropertyDates } from '../library/260-property-dates.js';
import { GraphRoutes } from '../tools/262-graph-routes.js';
import { QuietLinks } from '../note/265-quiet-links.js';
import { NotePages } from '../note/267-pages.js';
import { MarkedLists } from '../note/270-lists.js';
import { Scripts } from '../note/280-scripts.js';
import { Footnotes } from '../note/285-footnotes.js';
import { BulkEdits } from '../tools/290-bulk-engine.js';
import { PropertySchemas } from '../tools/305-bulk-schema.js';
import { PropertyHistory } from '../tools/306-bulk-history.js';
import { PropertyRules } from '../tools/307-bulk-rules.js';
import { BulkEditing } from '../tools/310-bulk-feature.js';
import { Diagnostics } from './355-diagnostics.js';
import { DesignReduxSettingTab } from './360-settings-tab.js';

export class DesignRedux extends Plugin {
  async onload() {
    await this.loadSettings();

    this.unloading = false;
    this.pins = new Pins(this);
    this.orders = new Orders(this);
    this.files = new Files(this);
    this.notes = new Notes(this);
    this.selection = new Selection(this);
    // What the inspector is about: the tab worked in, a pick, a card.
    this.coordinator = new WorkspaceCoordinator(this);
    this.coordinator.listen();
    // What every screen reads of the vault, kept while files and links stay as they are.
    this.libraryIndex = new LibraryIndex(this);
    this.libraryIndex.listen();
    this.lengths = new Lengths(this);
    this.bulk = new BulkEdits(this);
    this.features = [
      new Appearance(this),
      new Library(this),
      new ReadingOutline(this),
      new NotePage(this),
      new ListKeys(this),
      new SidebarDrop(this),
      new ActionsMenu(this),
      new PropertiesPanel(this),
      new ContextStrip(this),
      new HeaderSkip(this),
      new OnePage(this),
      new MenuFilter(this),
      new SettingsButton(this),
      new CoverImages(this),
      new CoverDrop(this),
      new ImageRouter(this),
      new PropertyClipboard(this),
      new AlbumProperty(this),
      new AlbumStructure(this),
      new SmartAlbums(this),
      new LibraryCheck(this),
      new AlbumRefactor(this),
      new MarkedLists(this),
      new Scripts(this),
      new Footnotes(this),
      new GraphPropertyFilter(this),
      new GraphRoutes(this),
      new QuietLinks(this),
      new NotePages(this),
      new Diagnostics(this),
      new BulkEditing(this),
      new PropertySchemas(this),
      new PropertyHistory(this),
      new PropertyDates(this),
      new PropertyRules(this),
      new PropertyLinks(this),
    ];

    this.syncFrame = 0;
    // Before the workspace is restored, so saved leaves of these types
    // can be rebuilt rather than dropped.
    this.each((f) => f.registerTypes(), 'types');

    this.settingTab = new DesignReduxSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Registered once, never withdrawn: Obsidian has no public way to
    // remove a command, so a disabled feature hides its own instead.
    this.features.forEach((feature) => {
      feature.commands().forEach((cmd) => {
        this.addCommand({
          id: cmd.id,
          name: cmd.name,
          // An icon lets a command sit in the phone's editing toolbar.
          ...(cmd.icon ? { icon: cmd.icon } : {}),
          ...(cmd.hotkeys ? { hotkeys: cmd.hotkeys } : {}),
          checkCallback: (checking) => {
            const ok = cmd.check ? cmd.check() : true;
            if (checking || !ok) return ok;
            cmd.run();
            return true;
          },
        });
      });
    });

    this.app.workspace.onLayoutReady(() => {
      this.each((f) => f.register(), 'register');
      this.refresh();
      // Stray library panes left by an old version are cleared. Browse
      // pages aren't: several are normal — tabs, splits, one per page.
      this.each((f) => {
        if (typeof f.singleLeaf !== 'function') return;
        f.singleLeaf(LIBRARY_VIEW);
      });

      this.registerEvent(this.app.workspace.on('layout-change', () => this.queueSync()));
      // The inspector that was in the right sidebar became the library's preview: its tab goes.
      this.app.workspace.getLeavesOfType('design-redux-inspector').forEach((leaf) => leaf.detach());
      // Later, once the vault is surely all there.
      window.setTimeout(() => {
        if (!this.unloading) this.pruneLeftovers();
      }, 15000);
      // Arrangements follow the files they name.
      this.registerEvent(
        this.app.vault.on('rename', (file, oldPath) => {
          this.orders.followRename(file, oldPath);
          this.followFolderNote(file, oldPath);
        })
      );
      this.registerEvent(
        this.app.vault.on('delete', (file) => {
          this.orders.followDelete(file);
          this.selection.followDelete(file);
        })
      );
      this.registerEvent(
        this.app.workspace.on('active-leaf-change', () => this.queueSync())
      );
    });
  }

  /**
   * Runs once, when the plugin is first enabled — not on every load.
   * The official place to set up a custom view, so the library appears
   * without the user having to find the command.
   */
  async onUserEnable() {
    const library = this.feature(Library);
    if (library && library.enabled) await library.reveal();
  }

  onunload() {
    // Marked before features are torn down: leaves must survive an
    // unload, since Obsidian restores them itself when the plugin is
    // updated or re-enabled. Detaching here loses their position.
    this.unloading = true;
    window.clearTimeout(this.refreshTimer);
    if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame);
    this.each((f) => f.disable());
  }

  /** An album's info from its folder note — its kind and label — or null: asked by helpers below the album features. */
  albumInfo(folder) {
    const structure = this.feature(AlbumStructure);
    return structure ? structure.info(folder) : null;
  }

  /** The album features' entries on a folder's or a note's menu, in this order. */
  addAlbumMenuItems(menu, target, sectioned, redraw) {
    const isFolder = target instanceof TFolder;
    const structure = this.feature(AlbumStructure);
    if (structure && isFolder) structure.addFolderItems(menu, target, sectioned, redraw);
    else if (structure && target.extension === 'md') structure.addFileItems(menu, target, sectioned, redraw);
    const refactor = this.feature(AlbumRefactor);
    if (refactor && isFolder) refactor.addFolderItems(menu, target, sectioned);
  }

  setNoteCover(file) {
    return this.feature(CoverImages).setNoteCover(file);
  }

  clearNoteCover(file) {
    return this.feature(CoverImages).clearNoteCover(file);
  }

  /** Every kind of file, most recent first. */
  recentFiles() {
    return this.app.workspace
      .getLastOpenFiles()
      .map((path) => this.app.vault.getFileByPath(path))
      .filter(Boolean);
  }

  togglePin(target) {
    if (!this.pins.toggle(target)) return;
    this.refreshBrowse();
    // The sidebar lists pins too, when Pinned is opened out.
    const library = this.feature(Library);
    if (library) library.refreshViews();
  }

  /** A property's display name, which keeps its own capitalisation. */
  propertyLabel(key) {
    return propertyLabel(this.app, key);
  }

  /* -- files: done by plugin.files (074-files); asked of the plugin by features and tests -- */

  freeChildPath(folder, base, ext) {
    return this.files.freeChildPath(folder, base, ext);
  }

  newNote(folder, name) {
    return this.files.newNote(folder, name);
  }

  newCanvas(folder) {
    return this.files.newCanvas(folder);
  }

  /**
   * A folder in a particular folder, asked for by name, then opened —
   * so the next thing, putting a note in it, is right there. An empty
   * folder is hidden from listings by default, so without that it would
   * seem not to have been made.
   */
  newFolder(parent) {
    new NamePrompt(this.app, 'New folder', 'Folder name', async (name) => {
      const clean = name.replace(/[\\/:]/g, '').trim();
      if (!clean) return;
      const dir = !parent || parent.path === '/' ? '' : parent.path + '/';
      const path = normalizePath(dir + clean);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(`"${clean}" already exists here.`);
        return;
      }
      try {
        await this.app.vault.createFolder(path);
        const library = this.feature(Library);
        if (library && library.enabled) library.browseMode({ mode: 'folder', path: path });
      } catch (err) {
        console.error('Design Redux: could not create the folder', err);
        new Notice('Could not create the folder.');
      }
    }).open();
  }

  folderCoverSrc(folder) {
    return this.feature(CoverImages).folderCoverSrc(folder);
  }

  folderNote(folder) {
    return this.files.folderNote(folder);
  }

  followFolderNote(entry, oldPath) {
    return this.files.followFolderNote(entry, oldPath);
  }

  renameFolderNote(job) {
    return this.files.renameFolderNote(job);
  }

  moveFile(file, folderPath, opts = {}) {
    return this.files.moveFile(file, folderPath, opts);
  }

  /**
   * A notice saying what was done, with an Undo that reverses it —
   * Obsidian has none for moving or renaming files.
   */
  offerUndo(message, undo) {
    const fragment = document.createDocumentFragment();
    const text = document.createElement('span');
    text.textContent = `${message} `;
    const link = document.createElement('a');
    link.className = 'dr-undo';
    link.setAttribute('href', '#');
    link.textContent = 'Undo';
    fragment.append(text, link);
    const notice = new Notice(fragment, 8000);
    link.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (notice && typeof notice.hide === 'function') notice.hide();
      undo();
    });
    return notice;
  }

  putBack(entry, oldPath, parentPath, order) {
    return this.files.putBack(entry, oldPath, parentPath, order);
  }

  folderHasNotes(folder) {
    return this.libraryIndex.hasNotes(folder);
  }

  isFolderNote(file) {
    return this.files.isFolderNote(file);
  }

  chooseCoverColor(target) {
    return this.feature(CoverImages).chooseCoverColor(target);
  }

  setFolderCover(folder, after) {
    return this.feature(CoverImages).setFolderCover(folder, after);
  }

  ensureFolderNote(folder) {
    return this.files.ensureFolderNote(folder);
  }

  clearFolderCover(folder, after) {
    return this.feature(CoverImages).clearFolderCover(folder, after);
  }

  refreshBrowse() {
    liveViews(this.app, BROWSE_VIEW, BrowseView).forEach((v) => v.render());
  }

  /**
   * The plugin's settings, opened at one setting: its tab, its row
   * scrolled to and marked a moment — from wherever that setting shows.
   * Obsidian has no public way to open its settings, so without one a
   * notice says where to look.
   */
  openSettingsAt(key) {
    const setting = this.app.setting;
    if (!setting || typeof setting.open !== 'function' || typeof setting.openTabById !== 'function') {
      new Notice('In Settings, under Design Redux.');
      return false;
    }
    if (this.settingTab) this.settingTab.reveal(key);
    setting.open();
    setting.openTabById(this.manifest.id);
    // Already showing this tab, Obsidian doesn't draw it again.
    if (this.settingTab && this.settingTab.revealKey) this.settingTab.display();
    return true;
  }

  /** One feature by its class, rather than by its name as a string. */
  feature(Ctor) {
    return (this.features || []).find((f) => f instanceof Ctor) || null;
  }

  /** One feature by its class's name, for a feature that mustn't import the one it asks for (that would cross the places). */
  featureNamed(name) {
    return (this.features || []).find((f) => f.constructor.name === name) || null;
  }

  /** A throw in one feature must not leave the others half set up. */
  each(fn, phase) {
    // Named, a step is timed for each feature — the last time it ran — so
    // what loading costs, and which feature, can be read (startupTimes).
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    (this.features || []).forEach((f) => {
      const started = phase ? now() : 0;
      try {
        fn(f);
      } catch (err) {
        console.error(`Design Redux: ${f.constructor.name} failed`, err);
        this.noteError(`${f.constructor.name}: ${(err && err.stack) || err}`);
      }
      if (phase) {
        const times = this.startupTimes || (this.startupTimes = {});
        (times[phase] || (times[phase] = {}))[f.constructor.name] = now() - started;
      }
    });
  }

  /**
   * Settings kept for files and folders that no longer exist — deleted
   * or renamed while the plugin was off, so nothing followed them — are
   * let go. Not if the vault looks empty: that's a vault still loading.
   */
  pruneLeftovers() {
    const vault = this.app.vault;
    if (typeof vault.getAllLoadedFiles === 'function' && vault.getAllLoadedFiles().length < 2) return;
    const exists = (p) => p === '/' || !!vault.getAbstractFileByPath(p);
    let changed = false;
    PATH_KEYED.concat(['albumOrders', 'folderDefaults']).forEach((key) => {
      const kept = this.settings[key];
      if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return;
      Object.keys(kept).forEach((p) => {
        if (exists(p)) return;
        delete kept[p];
        changed = true;
      });
    });
    if (changed) this.saveData(this.settings);
    return changed;
  }

  /** The last few errors, for Copy diagnostics. Kept in memory only. */
  noteError(text) {
    this.errors = (this.errors || []).concat([`${new Date().toISOString()}  ${text}`]).slice(-20);
  }

  refresh() {
    this.each((f) => (f.enabled ? f.enable() : f.disable()), 'enable');
  }

  /**
   * Workspace events arrive in bursts: opening a split fires several in
   * a row, and each would otherwise walk every leaf. Coalesce them into
   * a single pass on the next frame.
   */
  queueSync() {
    if (this.syncFrame) return;
    this.syncFrame = window.requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.each((f) => {
        if (f.enabled) f.sync();
      });
    });
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    // Older saved settings are brought up to date first, keeping a copy
    // of them as they were in case a step goes wrong.
    const from = saved.settingsVersion || 1;
    // Whether these were saved before, or it's a first install: some steps keep an old default for the first.
    const was = { existing: Object.keys(saved).length > 0 };
    const steps = SETTINGS_MIGRATIONS.filter((m) => m.to > from).sort((a, b) => a.to - b.to);
    // What this load brought up to date, for the diagnostics.
    this.migrated = { from, ran: [], failed: [] };
    if (steps.length) {
      try {
        const dir = this.manifest && this.manifest.dir;
        if (dir) await this.app.vault.adapter.write(`${dir}/data.before-v${steps[0].to}.json`, JSON.stringify(saved, null, 2));
      } catch (err) {
        console.error('Design Redux: could not back up settings before updating them', err);
      }
      steps.forEach((m) => {
        try {
          m.run(saved, was);
          saved.settingsVersion = m.to;
          this.migrated.ran.push(m.to);
        } catch (err) {
          this.migrated.failed.push(m.to);
          console.error(`Design Redux: settings step ${m.to} failed`, err);
        }
      });
    }

    // Cloned: some defaults are objects, and sharing the reference
    // would let a change to settings edit DEFAULTS itself.
    const settings = JSON.parse(JSON.stringify(DEFAULTS));

    // Only keys the plugin still recognises: a merge would carry
    // settings from removed features indefinitely.
    Object.keys(DEFAULTS).forEach((key) => {
      if (saved[key] !== undefined) settings[key] = saved[key];
    });

    this.settings = settings;

    const stale = Object.keys(saved).filter((k) => DEFAULTS[k] === undefined);
    if (stale.length) await this.saveData(this.settings);
  }

  /**
   * Saved at once; the features and open screens follow once typing in
   * a settings field pauses, rather than once per letter.
   */
  async saveSettings() {
    // Which notes stand for their folders is a setting.
    if (this.libraryIndex) this.libraryIndex.forget();
    await this.saveData(this.settings);
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      if (this.unloading) return;
      this.refresh();
      // Open screens show the change at once — an order, album columns,
      // a limit — rather than on their next visit.
      this.refreshBrowse();
    }, 200);
  }
}

/* ------------------------------------------------------------------ */

