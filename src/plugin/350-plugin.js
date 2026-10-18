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
import { Reading } from '../core/075-reading.js';
import { Selection } from '../core/076-selection.js';
import { LibraryIndex } from '../core/077-library-index.js';
import { Appearance } from '../core/085-appearance.js';
import { ListKeys } from '../library/105-list-keys.js';
import { SidebarDrop } from '../library/107-sidebar-drop.js';
import { BrowseView } from '../library/120-browse-view.js';
import { Library } from '../library/130-browse-filters.js';
import { ActionsMenu } from '../chrome/140-actions-menu.js';
import { NotePage } from '../library/140-note-page.js';
import { ReadingHistory } from '../library/145-reading-history.js';
import { Study } from '../library/147-study.js';
import { PropertiesPanel } from '../chrome/180-panel.js';
import { ContextStrip } from '../chrome/190-strip.js';
import { ReadingOutline } from '../chrome/195-reading-outline.js';
import { OnePage } from '../chrome/200-one-page.js';
import { MenuFilter } from '../chrome/210-menu-filter.js';
import { SettingsButton } from '../chrome/220-settings-button.js';
import { NamePrompt } from '../ui/230-pickers.js';
import { CoverImages } from '../ui/235-covers.js';
import { CoverDrop } from '../ui/237-cover-drop.js';
import { ImageRouter } from '../ui/240-image-router.js';
import { PropertyClipboard } from '../ui/250-property-clipboard.js';
import { Knowledge } from '../library/254-knowledge.js';
import { AlbumProperty } from '../library/255-album-property.js';
import { AlbumRefactor } from '../library/256-album-refactor.js';
import { AlbumStructure } from '../library/257-album-structure.js';
import { SmartAlbums } from '../library/258-smart-albums.js';
import { LibraryCheck } from '../library/259-library-check.js';
import { GraphPropertyFilter } from '../links/260-graph-filter.js';
import { KnowledgeCheck } from '../library/261-knowledge-check.js';
import { GraphRoutes } from '../links/262-graph-routes.js';
import { QuietLinks } from '../links/265-quiet-links.js';
import { MarkedLists } from '../editor/270-lists.js';
import { Scripts } from '../editor/280-scripts.js';
import { Footnotes } from '../editor/285-footnotes.js';
import { BulkEdits } from '../bulk/290-bulk-engine.js';
import { BulkEditing } from '../bulk/310-bulk-feature.js';
import { CanvasArguments } from '../canvas/319-canvas-arguments.js';
import { CanvasLegend } from '../canvas/320-canvas-legend.js';
import { CanvasDuplicate, CanvasFind, CanvasFocus, CanvasTools } from '../canvas/321-canvas-extras.js';
import { CanvasCardFacts, CanvasCards } from '../canvas/322-canvas-cards.js';
import { CanvasRestructure } from '../canvas/323-canvas-restructure.js';
import { CanvasBranchNote, CanvasOutlineBranch } from '../canvas/324-canvas-outlines.js';
import { CanvasLayouts } from '../canvas/325-canvas-layouts.js';
import { CanvasRelations } from '../canvas/326-canvas-relations.js';
import { CanvasCheck } from '../canvas/327-canvas-check.js';
import { CanvasVaultMap } from '../canvas/328-canvas-vault-map.js';
import { CanvasMinimap } from '../canvas/329-canvas-minimap.js';
import { CanvasAlign } from '../canvas/330-canvas-align.js';
import { CanvasCompare } from '../canvas/331-canvas-compare.js';
import { CanvasArrows } from '../canvas/332-canvas-arrows.js';
import { CanvasArrange } from '../canvas/333-canvas-arrange.js';
import { CanvasMindMap } from '../canvas/334-canvas-mindmap.js';
import { CanvasFold } from '../canvas/335-canvas-fold.js';
import { CanvasBranches } from '../canvas/338-canvas-branches.js';
import { CanvasOutline } from '../canvas/339-canvas-outline.js';
import { Diagnostics } from '../canvas/340-diagnostics.js';
import { CanvasQuickAdd } from '../canvas/341-canvas-quick-add.js';
import { CanvasPasteLines } from '../canvas/342-canvas-paste.js';
import { CanvasBranchDrag } from '../canvas/343-canvas-branch-drag.js';
import { CanvasPins } from '../canvas/344-canvas-pins.js';
import { CanvasOutlineSync } from '../canvas/345-canvas-outline-sync.js';
import { CanvasViews } from '../canvas/346-canvas-views.js';
import { CanvasDepth } from '../canvas/347-canvas-depth.js';
import { CanvasMap } from '../canvas/348-canvas-map.js';
import { WorkspaceModes } from '../chrome/348-workspace-modes.js';
import { AlbumMap } from '../canvas/349-canvas-album-map.js';
import { CanvasMapToolbar } from '../canvas/349-canvas-map-toolbar.js';
import { CanvasPresent } from '../canvas/349-canvas-present.js';
import { DesignReduxSettingTab } from './360-settings-tab.js';
import { MindMaps } from '../mindmap/420-mindmap-feature.js';

export class DesignRedux extends Plugin {
  async onload() {
    await this.loadSettings();

    this.unloading = false;
    this.pins = new Pins(this);
    this.orders = new Orders(this);
    this.files = new Files(this);
    this.notes = new Notes(this);
    this.selection = new Selection(this);
    // What every screen reads of the vault, kept while files and links stay as they are.
    this.libraryIndex = new LibraryIndex(this);
    this.reading = new Reading(this);
    this.libraryIndex.listen();
    this.lengths = new Lengths(this);
    this.bulk = new BulkEdits(this);
    this.features = [
      new Appearance(this),
      new Library(this),
      new ReadingHistory(this),
      new ReadingOutline(this),
      new Study(this),
      new NotePage(this),
      new ListKeys(this),
      new SidebarDrop(this),
      new ActionsMenu(this),
      new PropertiesPanel(this),
      new ContextStrip(this),
      new OnePage(this),
      new MenuFilter(this),
      new SettingsButton(this),
      new CoverImages(this),
      new CoverDrop(this),
      new ImageRouter(this),
      new PropertyClipboard(this),
      new AlbumProperty(this),
      new Knowledge(this),
      new KnowledgeCheck(this),
      new WorkspaceModes(this),
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
      new CanvasTools(this),
      new CanvasLegend(this),
      new CanvasAlign(this),
      new CanvasArrows(this),
      new CanvasArrange(this),
      new CanvasMindMap(this),
      new CanvasRestructure(this),
      new CanvasBranchNote(this),
      new CanvasOutlineBranch(this),
      new CanvasOutlineSync(this),
      new CanvasLayouts(this),
      new CanvasRelations(this),
      new CanvasCheck(this),
      new CanvasVaultMap(this),
      new CanvasMinimap(this),
      new CanvasCompare(this),
      new CanvasArguments(this),
      new CanvasQuickAdd(this),
      new CanvasPasteLines(this),
      new CanvasBranchDrag(this),
      new CanvasPins(this),
      new CanvasViews(this),
      new CanvasDepth(this),
      new CanvasMap(this),
      new CanvasMapToolbar(this),
      new CanvasCards(this),
      new CanvasCardFacts(this),
      new CanvasFold(this),
      new CanvasBranches(this),
      new CanvasOutline(this),
      new CanvasPresent(this),
      new AlbumMap(this),
      new MindMaps(this),
      new CanvasFind(this),
      new CanvasFocus(this),
      new CanvasDuplicate(this),
      new Diagnostics(this),
      new BulkEditing(this),
    ];

    this.syncFrame = 0;
    // Before the workspace is restored, so saved leaves of these types
    // can be rebuilt rather than dropped.
    this.each((f) => f.registerTypes());

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
      this.each((f) => f.register());
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
    const knowledge = this.feature(Knowledge);
    if (knowledge && !isFolder) knowledge.addFileItems(menu, target, sectioned);
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

  /** A new mind map in the folder, where mind maps are on. */
  newMindMap(folder) {
    const maps = this.feature(MindMaps);
    return maps && maps.enabled ? maps.newMap(folder) : null;
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

  /** A throw in one feature must not leave the others half set up. */
  each(fn) {
    (this.features || []).forEach((f) => {
      try {
        fn(f);
      } catch (err) {
        console.error(`Design Redux: ${f.constructor.name} failed`, err);
        this.noteError(`${f.constructor.name}: ${(err && err.stack) || err}`);
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
    this.each((f) => (f.enabled ? f.enable() : f.disable()));
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
    const steps = SETTINGS_MIGRATIONS.filter((m) => m.to > from).sort((a, b) => a.to - b.to);
    if (steps.length) {
      try {
        const dir = this.manifest && this.manifest.dir;
        if (dir) await this.app.vault.adapter.write(`${dir}/data.before-v${steps[0].to}.json`, JSON.stringify(saved, null, 2));
      } catch (err) {
        console.error('Design Redux: could not back up settings before updating them', err);
      }
      steps.forEach((m) => {
        try {
          m.run(saved);
          saved.settingsVersion = m.to;
        } catch (err) {
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

