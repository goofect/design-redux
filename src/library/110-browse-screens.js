/* ------------------------------------------------------------------ */
/* Browse screens                                                      */
/*                                                                     */
/* One class per screen. The view owns state, navigation and the parts */
/* every screen shares — artwork, rows, menus, sorting — and a screen  */
/* only decides what to draw. Adding a screen is a class and a line in */
/* the view's screen table.                                            */
/* ------------------------------------------------------------------ */

import { Notice, setIcon, TFile, TFolder } from 'obsidian';
import { blankLook, drawFolderArt, onContextMenu } from '../core/030-helpers-art.js';
import { asButton, iconWord, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { readingOf } from '../core/075-reading.js';
import { libraryIndex } from '../core/077-library-index.js';
import { BrowseScreen } from './108-browse-screen.js';
import { AlbumStructure } from './257-album-structure.js';
import { SmartAlbums } from './258-smart-albums.js';

/* -- a folder, as an album ------------------------------------------ */

export class FolderScreen extends BrowseScreen {
  title() {
    const folder = this.view.folder();
    return folder && folder.path !== '/'
      ? folder.name
      : this.app.vault.getName();
  }

  render(root) {
    const view = this.view;
    const folder = view.folder();

    // Which layout is decided by what the folder holds, not by what
    // Find or a filter lets through — otherwise typing flips the page
    // between tiles and an album, and hides the notes that match.
    const holdsNotes = (folder.children || []).some(
      (c) => c instanceof TFile && !this.plugin.isFolderNote(c)
    );
    const subfolders = view.visibleFolders(folder);

    // A folder of nothing but folders is a shelf: plain heading and
    // tiles. The album treatment is for one that actually holds notes.
    if (subfolders.length && !holdsNotes) {
      view.renderPlainHeader(root, folder);
      // In the order they were put in, where they have been.
      const folders = view.shelfFolders(folder).filter((c) => view.folderInFilter(c)).filter((c) => view.matches(c.name));
      const structure = this.plugin.feature(AlbumStructure);
      const shows = !!(structure && structure.enabled);
      if (shows) structure.renderCollectionHead(root, folder, view, subfolders.length);
      if (!folders.length) {
        view.emptyState(root, 'No folders', 'folder', view.clearAction());
        return;
      }
      // A collection asked to open as a list: its albums as a tree.
      const about = shows ? structure.info(folder) : null;
      if (about && about.layoutGiven && about.layout === 'list') this.renderTree(root, folders, 0);
      else view.folderTiles(root, folders).forEach((grid) => view.arrangeableTiles(grid));
      return;
    }

    let discs = view.discsOf(folder, view.notesIn(folder));
    // What the folder note says belongs too: albums, as tiles; notes kept
    // elsewhere, after its own. Shown here, not moved.
    const structure = view.editing ? null : this.plugin.feature(AlbumStructure);
    const about = structure ? structure.info(folder) : null;
    const kept = discs.reduce((acc, d) => acc.concat(d.files), []);
    const elsewhere = about ? structure.included(folder, kept).filter((f) => view.inFilter(f) && view.matches(f.basename)) : [];
    // One list without headings: the album's own notes, then those from
    // elsewhere. Its folders wait at the foot. Edit mode keeps a disc for
    // each folder, to rename and fill.
    if (!view.editing) {
      const own = discs.find((d) => d.folder === folder);
      const files = (own ? own.files : []).concat(view.sortFiles(elsewhere));
      discs = files.length ? [{ title: view.folderName(folder), folder, files }] : [];
    }
    const all = discs.reduce((acc, d) => acc.concat(d.files), []);
    const albums = about ? about.includes.filter((t) => t instanceof TFolder && view.matches(t.name)) : [];

    view.renderHeader(root, folder, all);
    if (about) {
      // Names its properties give that lead nowhere: said, with the way to fix them.
      if (about.missing.length) this.missingNotice(root, about);
      const featured = about.featured.filter((f) => view.matches(f.basename));
      if (featured.length) view.shelf(root, 'Start here', featured);
    }
    if (albums.length) {
      const grid = root.createDiv({ cls: 'dr-grid dr-album-includes' });
      roveFocus(grid, '.dr-card');
      albums.forEach((f) => view.folderCard(grid, f));
    }
    if (!all.length && !view.editing) {
      if (!albums.length) {
        const add = folder.isRoot && folder.isRoot() ? null : ['New note', () => this.plugin.newNote(folder)];
        view.emptyState(root, this.emptyText(about), 'folder-open', view.clearAction() || add);
      }
      this.renderInside(root, folder);
      view.renderMoreIn(root, folder);
      return;
    }
    const drawNotes = (el) => {
      if (about && about.layout === 'covers') this.renderCovers(el, discs);
      else if (about && about.layout === 'table') this.renderTable(el, discs);
      else view.renderDiscs(el, discs, folder);
      if (!view.editing) view.renderAlbumEnd(el, folder, all);
      if (!view.editing) view.renderAlbumFoot(el, all, { count: discs.length > 1 });
    };
    drawNotes(root);
    if (view.editing) return;
    if (about && about.related.length) view.shelf(root, 'Related collections', about.related);
    this.renderInside(root, folder);
    view.renderMoreIn(root, folder);
  }

  /** The folders inside the album, at its foot: a shelf, before those beside it. */
  renderInside(root, folder) {
    const view = this.view;
    const inside = view.sortFolders(view.visibleFolders(folder)).filter((f) => view.folderInFilter(f) && view.matches(f.name));
    if (inside.length) view.shelf(root, `In ${view.folderName(folder)}`, inside);
  }

  /** The album's notes as a table: a row each, the columns set for tables. */
  renderTable(el, discs) {
    const view = this.view;
    const columns = view.tableColumns();
    const table = el.createDiv({ cls: 'dr-table' });
    roveFocus(table, '.dr-tr');
    discs.forEach((disc) => disc.files.forEach((file) => view.tableRow(table, file, columns)));
  }

  /** A collection's albums as a tree: each, with its kind and size, and the albums inside it beneath. */
  renderTree(root, folders, depth) {
    const view = this.view;
    const structure = this.plugin.feature(AlbumStructure);
    const list = depth ? root : root.createDiv({ cls: 'dr-tree' });
    if (!depth) roveFocus(list, '.dr-tree-row');
    folders.forEach((f) => {
      const row = list.createDiv({ cls: 'dr-tree-row' });
      row.style.setProperty('--dr-tree-depth', String(depth));
      row.dataset.path = f.path;
      asButton(row);
      setIcon(row.createSpan({ cls: 'dr-tree-icon' }), 'folder');
      row.createSpan({ cls: 'dr-tree-name', text: f.name });
      const kind = structure && structure.enabled ? structure.info(f).label : '';
      if (kind) row.createSpan({ cls: 'dr-card-kind', text: kind });
      row.createSpan({ cls: 'dr-tree-count', text: view.countLabel(f) });
      const rolled = structure ? structure.rollupText(structure.rollup(structure.notesUnder(f))) : '';
      if (rolled) row.createSpan({ cls: 'dr-tree-rollup', text: rolled });
      onActivate(row, () => view.openFolder(f));
      onContextMenu(row, (evt) => view.folderMenu(evt, f, view.folderCover(f)));
      if (depth < 4) this.renderTree(list, view.sortFolders(view.visibleFolders(f)), depth + 1);
    });
  }

  /** Why an album shows nothing: Find or a filter, or nothing put in it yet. */
  emptyText(about) {
    const view = this.view;
    if (view.query.trim() || view.hasFilters()) return 'Nothing matches';
    if (about && about.label) return `Nothing in this ${about.label.toLowerCase()} yet`;
    return 'Nothing here';
  }

  missingNotice(root, about) {
    const names = about.missing.map((m) => `“${m.name}”`).join(', ');
    const note = root.createDiv({ cls: 'dr-album-notice' });
    setIcon(note.createSpan({ cls: 'dr-album-notice-icon' }), 'link-2-off');
    note.createSpan({ text: `${about.missing.length === 1 ? 'A link in its properties leads' : 'Links in its properties lead'} nowhere: ${names}` });
    asButton(note, 'Open the folder note to fix it');
    onActivate(note, () => this.app.workspace.getLeaf(false).openFile(about.note));
  }

  /** The album's notes as covers. */
  renderCovers(root, discs) {
    const view = this.view;
    const grid = root.createDiv({ cls: 'dr-grid' });
    roveFocus(grid, '.dr-card');
    discs.forEach((disc) => disc.files.forEach((f) => view.fileCard(grid, f)));
  }
}

/* -- every folder, as tiles ------------------------------------------ */

export class FoldersScreen extends BrowseScreen {
  title() {
    return 'Collections';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const all = [];
    const walk = (folder) =>
      view.visibleFolders(folder).forEach((child) => {
        all.push(child);
        walk(child);
      });
    walk(this.app.vault.getRoot());

    const shown = view.sortFolders(
      all.filter((f) => view.folderInFilter(f)).filter((f) => view.matches(f.name))
    );

    if (!shown.length) {
      view.emptyState(root, 'No folders', 'folder', view.clearAction());
      return;
    }

    if (showsCovers(this.settings, 'collections')) view.folderTiles(root, shown, (f) => f.parent && f.parent.name);
    else folderRows(view, root, shown);
  }
}

/* -- every note, as a table ------------------------------------------ */

export class NotesScreen extends BrowseScreen {
  title() {
    return 'Notes';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const notes = view.sortNotes(
      libraryIndex(this.plugin).notes()
        .filter((f) => view.inFilter(f))
        .filter((f) => view.matches(f.basename))
    );

    if (!notes.length) {
      view.emptyState(root, 'No notes', 'file-text', view.clearAction());
      return;
    }

    const columns = view.tableColumns();
    const table = root.createDiv({ cls: 'dr-table' });
    roveFocus(table, '.dr-tr:not(.dr-th)');

    const head = table.createDiv({ cls: 'dr-tr dr-th' });
    view.headerCell(head, 'title', 'Title', 'dr-td-title');
    columns.forEach((key) => view.headerCell(head, key, view.columnLabel(key)));
    if (view.lengthStyle()) {
      iconWord(head.createDiv({ cls: 'dr-td dr-td-length' }), 'clock', view.lengthStyle() === 'words' ? 'Words' : 'Length');
    }
    view.headerCell(head, 'modified', 'Modified', 'dr-td-time');

    // Hundreds of rows are drawn at once; thousands wait to be asked for.
    const cap = 300;
    const all = view.expanded.has('notes-table');
    (all ? notes : notes.slice(0, cap)).forEach((file) => view.tableRow(table, file, columns));
    if (notes.length > cap) view.renderMoreRow(table, 'notes-table', notes.length, 'notes');
  }
}

/* -- a property, as an artist list ----------------------------------- */

/* How long Search waits after typing before reading notes' text, and how many it shows. */
export const TEXT_PAUSE = 250;
export const TEXT_MOST = 50;

/** Whether a screen shows covers or a list: as set, or — Automatic — covers for collections, lists for notes. */
export function showsCovers(settings, what) {
  const as = settings.libraryLayout || 'auto';
  if (as === 'covers') return true;
  if (as === 'lists') return false;
  return what !== 'notes';
}

/** Collections as rows, for Lists: a small cover, the name, how many it holds. */
export function folderRows(view, root, folders) {
  const list = root.createDiv({ cls: 'dr-search-props dr-folder-rows' });
  roveFocus(list, '.dr-search-prop');
  folders.forEach((folder) => {
    const row = list.createDiv({ cls: 'dr-search-prop' });
    asButton(row);
    row.dataset.path = folder.path;
    drawFolderArt(view.plugin, row.createDiv({ cls: 'dr-search-prop-art' }), folder);
    const text = row.createDiv({ cls: 'dr-search-prop-text' });
    text.createDiv({ cls: 'dr-search-prop-title', text: folder.name });
    const structure = view.plugin.feature(AlbumStructure);
    const rolled = structure ? structure.rollupText(structure.rollup(structure.notesUnder(folder))) : '';
    text.createDiv({ cls: 'dr-search-prop-sub', text: rolled ? `${view.countLabel(folder)}  ·  ${rolled}` : view.countLabel(folder) });
    view.pickOrOpen(row, { folder }, () => view.openFolder(folder), false);
    onContextMenu(row, (evt) => view.folderMenu(evt, folder, view.folderCover(folder)));
  });
  return list;
}

/** A value's cover: the first a note of it carries, else one drawn from its name — the same on its tile and its page. */
export function valueArt(view, el, key, value, files) {
  const name = String(value);
  const src = view.groupCover({ files: files || [] });
  view.fillArt(el, src, 'tag', view.genName(name, `value:${key}:${name}`), blankLook(view.plugin.settings, name));
}

/* The Properties screen's name for the notes that leave a property empty, where a value would go. */
export const EMPTY_VALUE = '\u2205';

/* Up to how many values a property shows as covers, unless set to always or never. */
export const VALUE_GRID_MOST = 40;

/** Text to the clipboard, with a word that it's there. */
export function copyText(text) {
  const clip = typeof navigator !== 'undefined' && navigator.clipboard;
  if (!clip) return;
  clip.writeText(text).then(() => new Notice('Copied'), () => new Notice('Could not copy'));
}

/* -- recents and pins, as tiles -------------------------------------- */

export class CollectionScreen extends BrowseScreen {
  get pinned() {
    return this.view.mode === 'pinned';
  }

  get added() {
    return this.view.mode === 'added';
  }

  get read() {
    return this.view.mode === 'read';
  }

  title() {
    return this.pinned ? 'Pinned' : this.added ? 'Recently added' : this.read ? 'Recently read' : 'Recently opened';
  }

  /** The notes made most lately, the newest first: albums' own notes aside. */
  recentlyAdded() {
    return libraryIndex(this.plugin).notes()
      .sort((a, b) => b.stat.ctime - a.stat.ctime)
      .slice(0, 100);
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    let files = (this.pinned
      ? this.plugin.pins.files()
      : this.added
        ? this.recentlyAdded()
        : this.read
          ? readingOf(this.plugin).latest('read', 100)
          : this.plugin.recentFiles()
    )
      .filter((f) => view.inFilter(f))
      .filter((f) => view.matches(f.basename));

    // Recency is the point of the recents screen, so it keeps that
    // order until another is chosen there. Pins keep the order they
    // were pinned in on the same terms.
    if (!view.keepsOwnOrder()) files = view.sortFiles(files);

    // Pinned folders come first, since a folder is a way into many of
    // the files that might follow.
    const folders = this.pinned
      ? this.plugin.pins
          .folders()
          .filter((f) => view.folderInFilter(f))
          .filter((f) => view.matches(f.name))
      : [];
    const orderedFolders = view.keepsOwnOrder() ? folders : view.sortFolders(folders);

    if (!files.length && !folders.length) {
      const empty = this.pinned ? ['Nothing pinned yet', 'pin'] : this.added ? ['Nothing added yet', 'calendar-plus'] : this.read ? ['Nothing read to the end yet', 'book-check'] : ['Nothing opened yet', 'clock'];
      view.emptyState(root, empty[0], empty[1], view.clearAction());
      return;
    }

    // Notes you opened, added or read are a list, unless set to covers; pins stay covers, in your order.
    if (!this.pinned && !showsCovers(this.settings, 'notes')) {
      const list = root.createDiv({ cls: 'dr-tracks dr-collection-tracks' });
      roveFocus(list, '.dr-track');
      files.forEach((file, i) => view.trackRow(list, file, i + 1));
      return;
    }

    const grid = root.createDiv({ cls: 'dr-grid' });
    roveFocus(grid, '.dr-card');
    // Pins you've put in order are shown in it, folders and notes mixed;
    // otherwise folders lead, as a way into many of the notes after them.
    if (this.pinned && view.keepsOwnOrder() && this.plugin.orders.pinOrder().length) {
      const shown = new Set(files.concat(folders));
      this.plugin.pins.all().filter((t) => shown.has(t)).forEach((t) => {
        if (t instanceof TFolder) view.folderCard(grid, t);
        else view.fileCard(grid, t);
      });
    } else {
      orderedFolders.forEach((f) => view.folderCard(grid, f));
      files.forEach((file) => view.fileCard(grid, file));
    }
    if (this.pinned && view.keepsOwnOrder()) view.arrangeableTiles(grid);
  }
}

/* -- subjects and collections, as tiles ------------------------------ */

/** Your own collections, as tiles: smart albums, then albums that gather notes from elsewhere. */
export function collectionTiles(view) {
  const plugin = view.plugin;
  const items = [];
  const smart = plugin.feature(SmartAlbums);
  if (smart && smart.enabled) {
    smart.list().filter((album) => view.matches(album.name)).forEach((album) => items.push({ draw: (row) => view.smartCard(row, album) }));
  }
  const structure = plugin.feature(AlbumStructure);
  if (structure && structure.enabled) {
    structure.gathering().filter((f) => view.folderInFilter(f) && view.matches(f.name)).forEach((f) => items.push(f));
  }
  return items;
}

/** Tiles in a grid: a folder's, or one drawn by its item. */
export function tileGrid(view, root, items) {
  const grid = root.createDiv({ cls: 'dr-grid' });
  roveFocus(grid, '.dr-card');
  items.forEach((item) => (item instanceof TFolder ? view.folderCard(grid, item) : item.draw(grid)));
  return grid;
}

export class CollectionsScreen extends BrowseScreen {
  title() {
    return 'Views';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());
    const items = collectionTiles(view);
    if (!items.length) {
      view.emptyState(root, 'No views yet: saved views, and collections that gather notes from elsewhere, show here', 'library', null);
      return;
    }
    tileGrid(view, root, items);
  }
}

/** The albums marked as a subject: the vault's fields of knowledge. */
export class SubjectsScreen extends BrowseScreen {
  title() {
    return 'Subjects';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());
    const structure = this.plugin.feature(AlbumStructure);
    const subjects = structure && structure.enabled
      ? view.sortFolders(structure.ofKind('subject').filter((f) => view.folderInFilter(f) && view.matches(f.name)))
      : [];
    if (!subjects.length) {
      view.emptyState(root, 'No subjects yet: collections whose kind is Subject show here', 'book', null);
      return;
    }
    tileGrid(view, root, subjects);
  }
}

/* -- search ---------------------------------------------------------- */
