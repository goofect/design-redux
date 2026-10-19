/* ------------------------------------------------------------------ */
/* Browse screens                                                      */
/*                                                                     */
/* One class per screen. The view owns state, navigation and the parts */
/* every screen shares — artwork, rows, menus, sorting — and a screen  */
/* only decides what to draw. Adding a screen is a class and a line in */
/* the view's screen table.                                            */
/* ------------------------------------------------------------------ */

import { Menu, Notice, setIcon, TFile, TFolder } from 'obsidian';
import { BROWSE_VIEW, TAG_KEYS, TYPE_ICONS, TYPE_LABELS } from '../core/020-constants.js';
import { albumNeighbours, blankLook, drawFolderArt, drawNoteArt, onContextMenu, showMenuAt } from '../core/030-helpers-art.js';
import { asButton, collapseSearches, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { typeOfProperty } from '../core/045-helpers-properties.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { rankNote, searchWords, textExcerpt } from '../core/048-search-rank.js';
import { noteProps } from '../core/073-notes.js';
import { readingOf } from '../core/075-reading.js';
import { libraryIndex } from '../core/077-library-index.js';
import { dueNotes } from '../core/081-study.js';
import { fromReading } from './145-reading-history.js';
import { paintValue, ValueOptionModal, valueOptionsOn } from '../ui/248-value-options.js';
import { AlbumStructure } from './257-album-structure.js';
import { SmartAlbums } from './258-smart-albums.js';
import { renamePropertyInPlace } from '../bulk/290-bulk-engine.js';
import { BulkEditing } from '../bulk/310-bulk-feature.js';

export class BrowseScreen {
  constructor(view) {
    this.view = view;
    this.plugin = view.plugin;
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /** What the tab and the search field call this screen. */
  title() {
    return '';
  }

  render() {}
}

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

    const discs = view.discsOf(folder, view.notesIn(folder));
    // What the folder note says belongs too: albums, as tiles; notes kept
    // elsewhere, as a disc of their own. Shown here, not moved.
    const structure = view.editing ? null : this.plugin.feature(AlbumStructure);
    const about = structure ? structure.info(folder) : null;
    const kept = discs.reduce((acc, d) => acc.concat(d.files), []);
    const elsewhere = about ? structure.included(folder, kept).filter((f) => view.inFilter(f) && view.matches(f.basename)) : [];
    if (elsewhere.length) discs.push({ title: 'From elsewhere', folder: null, files: view.sortFiles(elsewhere) });
    const all = kept.concat(elsewhere);
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
      view.renderMoreIn(root, folder);
      return;
    }
    const drawNotes = (el) => {
      if (about && about.layout === 'covers') this.renderCovers(el, discs, folder);
      else if (about && about.layout === 'table') this.renderTable(el, discs, folder);
      else view.renderDiscs(el, discs, folder);
      if (!view.editing) view.renderAlbumEnd(el, folder, all);
      if (!view.editing) view.renderAlbumFoot(el, all, { count: discs.length > 1 });
    };
    const panels = about ? this.panels(folder, about, all, drawNotes) : [];
    if (panels.length > 1) this.renderPanels(root, folder, about, panels);
    else drawNotes(root);
    if (view.editing) return;
    if (about && about.related.length) view.shelf(root, 'Related collections', about.related);
    view.renderMoreIn(root, folder);
  }

  /**
   * What an album can show, one at a time: its notes; the folder note's
   * text; its map; its sub-albums; its sources; what it hasn't got yet;
   * and, in a long one, what changed and was opened lately. Each only
   * where there's something to show.
   */
  panels(folder, about, all, drawNotes) {
    const view = this.view;
    const structure = this.plugin.feature(AlbumStructure);
    const out = [{ id: 'notes', label: 'Notes', count: all.length, draw: drawNotes }];
    if (structure.hasOverview(about)) out.unshift({ id: 'overview', label: 'Overview', draw: (el) => structure.renderLead(el, folder, about, view, 'overview') });
    if (structure.mapOf(folder) || about.type === 'concept map' || about.layout === 'map') {
      out.push({ id: 'map', label: 'Map', draw: (el) => structure.renderLead(el, folder, about, view, 'map') });
    }
    const subs = view.sortFolders(view.visibleFolders(folder));
    if (subs.length) out.push({ id: 'albums', label: 'Sub-collections', count: subs.length, draw: (el) => view.folderTiles(el, subs) });
    const sources = structure.sources(all);
    if (sources.length) out.push({ id: 'sources', label: 'Sources', count: sources.length, draw: (el) => view.renderDiscs(el, [{ title: 'Sources', folder: null, files: sources }], null) });
    const gaps = structure.gaps(all);
    if (gaps.unwritten.length || gaps.open.length) out.push({ id: 'gaps', label: 'Gaps', count: gaps.unwritten.length + gaps.open.length, draw: (el) => this.renderGaps(el, gaps) });
    const linked = structure.linked(folder, all);
    if (linked.length) out.push({ id: 'linked', label: 'Linked', count: linked.length, draw: (el) => this.renderLinked(el, folder, linked) });
    if (this.settings.albumRecents !== false && all.length >= ALBUM_RECENTS_FROM) out.push({ id: 'lately', label: 'Lately', draw: (el) => this.renderRecents(el, all) });
    return out;
  }

  /** The album's notes as a table — a row each, the columns set for tables — under a heading for each disc. */
  renderTable(el, discs, album) {
    const view = this.view;
    const columns = view.tableColumns();
    discs.forEach((disc) => {
      const head = el.createDiv({ cls: 'dr-disc dr-covers-head' });
      head.createSpan({ cls: 'dr-disc-title', text: disc.title });
      head.createSpan({ cls: 'dr-disc-count', text: disc.files.length === 1 ? '1 note' : `${disc.files.length} notes` });
      if (disc.folder && disc.folder !== album) {
        asButton(head);
        onActivate(head, () => view.openFolder(disc.folder));
      }
      const table = el.createDiv({ cls: 'dr-table' });
      roveFocus(table, '.dr-tr:not(.dr-th)');
      const th = table.createDiv({ cls: 'dr-tr dr-th' });
      th.createDiv({ cls: 'dr-td dr-td-title', text: 'Title' });
      columns.forEach((key) => th.createDiv({ cls: 'dr-td', text: view.columnLabel(key) }));
      if (view.lengthStyle()) th.createDiv({ cls: 'dr-td dr-td-length', text: view.lengthStyle() === 'words' ? 'Words' : 'Length' });
      th.createDiv({ cls: 'dr-td dr-td-time', text: 'Modified' });
      disc.files.forEach((file) => view.tableRow(table, file, columns));
    });
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

  /** Notes elsewhere tied to the album's by links: each, how strongly, and a way to show it here. */
  renderLinked(el, folder, linked) {
    const view = this.view;
    const structure = this.plugin.feature(AlbumStructure);
    el.createDiv({ cls: 'dr-report-lead', text: 'Notes kept elsewhere that link with this collection’s. Shown here, they stay where they are.' });
    const list = el.createDiv({ cls: 'dr-tracks dr-linked' });
    roveFocus(list, '.dr-gap-row');
    linked.forEach(({ file, count }) => {
      const row = list.createDiv({ cls: 'dr-gap-row' });
      row.dataset.path = file.path;
      row.setAttribute('tabindex', '0');
      const name = row.createSpan({ cls: 'dr-gap-name', text: file.basename });
      name.setAttribute('role', 'button');
      onActivate(name, (evt) => view.openFile(file, evt));
      row.createSpan({ cls: 'dr-gap-from', text: `${count} ${count === 1 ? 'link' : 'links'} · ${file.parent && file.parent.path !== '/' ? file.parent.name : this.app.vault.getName()}` });
      const take = row.createSpan({ cls: 'dr-linked-take', text: 'Show here' });
      asButton(take);
      onActivate(take, async (evt) => {
        evt.stopPropagation();
        if (await structure.include(folder, file)) view.render();
      });
    });
  }

  /** Tabs over the panel shown: as last chosen here, or as the album's layout says. */
  renderPanels(root, folder, about, panels) {
    const view = this.view;
    const structure = this.plugin.feature(AlbumStructure);
    if (!view.albumPanels) view.albumPanels = new Map();
    const strip = root.createDiv({ cls: 'dr-album-panels' });
    strip.setAttribute('role', 'tablist');
    const body = root.createDiv({ cls: 'dr-album-panel' });
    body.setAttribute('role', 'tabpanel');
    const show = (id) => {
      strip.querySelectorAll('.dr-panel-tab').forEach((tab) => {
        const on = tab.dataset.panel === id;
        tab.toggleClass('is-active', on);
        tab.setAttribute('aria-selected', String(on));
        tab.setAttribute('tabindex', on ? '0' : '-1');
      });
      body.empty();
      panels.find((p) => p.id === id).draw(body);
    };
    panels.forEach((p) => {
      const tab = strip.createDiv({ cls: 'dr-panel-tab' });
      tab.dataset.panel = p.id;
      tab.setAttribute('role', 'tab');
      tab.createSpan({ text: p.label });
      if (p.count) tab.createSpan({ cls: 'dr-panel-count', text: String(p.count) });
      onActivate(tab, () => {
        // Chosen here: kept while the album's open in this tab.
        view.albumPanels.set(folder.path, p.id);
        show(p.id);
      });
    });
    // Left and right step between the tabs.
    strip.addEventListener('keydown', (evt) => {
      if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;
      const tabs = Array.from(strip.querySelectorAll('.dr-panel-tab'));
      const at = tabs.indexOf(evt.target.closest('.dr-panel-tab'));
      const next = tabs[(at + (evt.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (!next) return;
      evt.preventDefault();
      next.focus();
      next.click();
    });
    const has = (id) => panels.some((p) => p.id === id);
    const kept = view.albumPanels.get(folder.path);
    show([kept, structure.defaultPanel(about)].find(has) || 'notes');
  }

  /** What an album hasn't got: notes linked to but not written, then notes marked open. */
  renderGaps(el, gaps) {
    const view = this.view;
    if (gaps.unwritten.length) {
      const list = el.createDiv({ cls: 'dr-tracks dr-gaps' });
      list.createDiv({ cls: 'dr-disc' }).createSpan({ cls: 'dr-disc-title', text: 'Not written yet' });
      gaps.unwritten.forEach((gap) => {
        const row = list.createDiv({ cls: 'dr-gap-row' });
        asButton(row);
        row.createSpan({ cls: 'dr-gap-name', text: gap.name });
        row.createSpan({ cls: 'dr-gap-from', text: gap.count === 1 ? `linked from ${gap.from.basename}` : `linked from ${gap.count} notes` });
        // Opened as its link would be: Obsidian makes the note.
        onActivate(row, () => this.app.workspace.openLinkText(gap.name, gap.from.path, false));
      });
    }
    if (gaps.open.length) view.renderDiscs(el, [{ title: 'Open questions', folder: null, files: gaps.open }], null);
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

  /** The album's notes as covers, under a heading for each disc. */
  renderCovers(root, discs, album) {
    const view = this.view;
    discs.forEach((disc) => {
      const head = root.createDiv({ cls: 'dr-disc dr-covers-head' });
      head.createSpan({ cls: 'dr-disc-title', text: disc.title });
      head.createSpan({ cls: 'dr-disc-count', text: disc.files.length === 1 ? '1 note' : `${disc.files.length} notes` });
      if (disc.folder && disc.folder !== album) {
        asButton(head);
        onActivate(head, () => view.openFolder(disc.folder));
      }
      const grid = root.createDiv({ cls: 'dr-grid' });
      roveFocus(grid, '.dr-card');
      disc.files.forEach((f) => view.fileCard(grid, f));
    });
  }

  /** In a long album, what changed lately and what was opened lately, apart from its own order. */
  renderRecents(root, all) {
    if (all.length < ALBUM_RECENTS_FROM) return;
    const view = this.view;
    const changed = all.slice().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 8);
    const inAlbum = new Set(all);
    const opened = this.plugin.recentFiles().filter((f) => inAlbum.has(f)).slice(0, 8);
    if (opened.length > 1) view.shelf(root, 'Opened lately', opened);
    view.shelf(root, 'Changed lately', changed);
  }

}

/* An album this long shows what changed and what was opened lately. */
export const ALBUM_RECENTS_FROM = 12;

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
      head.createDiv({ cls: 'dr-td dr-td-length', text: view.lengthStyle() === 'words' ? 'Words' : 'Length' });
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

export class PropertiesScreen extends BrowseScreen {
  title() {
    return 'Properties';
  }

  /**
   * As a music app's Artists: the properties listed on the left, and the
   * one chosen as a page of its own on the right — its values as covers,
   * each opening as an album of the notes that carry it.
   */
  render(root) {
    const view = this.view;
    const all = view.propertyList();
    const chosen = all.find((p) => p.key === view.property) || null;
    // A value is a page of its own, as an album is.
    if (chosen && view.value && !view.editing) return this.renderValuePage(root, chosen, view.value);

    view.renderTitleBar(root, this.title());
    const props = this.sortProps(all.filter((p) => view.matches(p.name)));
    this.editButton(root, props.length > 0, !!chosen);
    if (!view.editing) this.renderMatching(root);
    if (!props.length) {
      root.createDiv({ cls: 'dr-empty', text: 'No properties' });
      return;
    }
    if (view.editing && !chosen) {
      this.renderEditing(root, props);
      return;
    }

    const selected = props.find((p) => p.key === view.property) || null;

    const split = root.createDiv({ cls: 'dr-split' });
    const list = split.createDiv({ cls: 'dr-split-list' });
    roveFocus(list, '.dr-split-row');
    const detail = split.createDiv({ cls: 'dr-split-detail' });
    this.listHead(list);

    props.forEach((prop) => {
      const row = list.createDiv({ cls: 'dr-split-row' });
      if (selected && prop.key === selected.key) row.addClass('is-selected');
      asButton(row);

      const thumb = row.createDiv({ cls: 'dr-split-thumb is-blank' });
      setIcon(
        thumb.createSpan({ cls: 'dr-card-glyph' }),
        TYPE_ICONS[prop.type] || 'tag'
      );

      row.createDiv({ cls: 'dr-split-name', text: prop.name });
      row.createDiv({ cls: 'dr-split-count', text: String(prop.count) });

      onActivate(row, () => view.navigate({ property: prop.key, keepFilters: true }));
      onContextMenu(row, (evt) => this.propertyMenu(evt, prop));
    });

    if (!selected) {
      detail.createDiv({ cls: 'dr-split-empty', text: 'Select a property' });
      return;
    }

    // On a phone there's room for the list or the page, not both, so
    // choosing a property swaps one for the other — the way an artist
    // opens from the Artists list — and back returns to the list.
    split.addClass('has-selection');
    this.renderOverview(detail, selected);
  }

  /** The property list's order: by name, by how many notes use it, or by type. */
  sortProps(props) {
    const by = this.settings.propertiesSort || 'name';
    const name = (a, b) => a.name.localeCompare(b.name);
    if (by === 'count') return props.slice().sort((a, b) => b.count - a.count || name(a, b));
    if (by === 'type') return props.slice().sort((a, b) => String(a.type).localeCompare(String(b.type)) || name(a, b));
    return props;
  }

  /** Above the list: what it's ordered by, and a menu to change it. */
  listHead(list) {
    const sorts = [
      ['name', 'Name'],
      ['count', 'Notes'],
      ['type', 'Type'],
    ];
    const by = this.settings.propertiesSort || 'name';
    const head = list.createDiv({ cls: 'dr-split-list-head' });
    const button = head.createDiv({ cls: 'dr-search-sort dr-prop-sort' });
    asButton(button);
    button.createSpan({ text: `Sort: ${(sorts.find((s) => s[0] === by) || sorts[0])[1]}` });
    setIcon(button.createSpan({ cls: 'dr-search-sort-icon' }), 'chevron-down');
    onActivate(button, (evt) => {
      const menu = new Menu();
      sorts.forEach(([id, label]) =>
        menu.addItem((item) =>
          item
            .setTitle(label)
            .setChecked(id === by)
            .setSection('action')
            .onClick(async () => {
              this.settings.propertiesSort = id;
              await this.plugin.saveData(this.settings);
              this.view.render();
            })
        )
      );
      showMenuAt(menu, evt);
    });
  }

  /** Notes that carry the property with nothing in it. */
  emptyNotes(key) {
    const view = this.view;
    const want = String(key).toLowerCase();
    const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.some((x) => x !== null && x !== ''));
    return libraryIndex(this.plugin)
      .markdown()
      .filter((file) => {
        if (this.plugin.isFolderNote(file) || !view.inFilter(file)) return false;
        const fm = noteProps(this.app, file);
        const have = Object.keys(fm).find((k) => k.toLowerCase() === want);
        return have !== undefined && blank(fm[have]);
      });
  }

  /** A property's facts, as Obsidian counts them: its type, how many notes have it and don't, its top values, when last changed — each with its fix a click away. */
  inspect(key) {
    const want = String(key).toLowerCase();
    const all = libraryIndex(this.plugin).markdown();
    let last = 0;
    const using = all.filter((file) => {
      const fm = noteProps(this.app, file);
      const has = Object.keys(fm).some((k) => k !== 'position' && k.toLowerCase() === want);
      if (has) last = Math.max(last, file.stat ? file.stat.mtime : 0);
      return has;
    });
    return { type: typeOfProperty(this.app, want), uses: using.length, without: all.length - using.length, last };
  }

  renderInspector(detail, prop, groups) {
    const facts = this.inspect(prop.key);
    const bulk = this.plugin.feature(BulkEditing);
    const root = this.app.vault.getRoot();
    const box = detail.createDiv({ cls: 'dr-prop-facts' });
    const fact = (label, text, fix) => {
      const el = box.createDiv({ cls: 'dr-prop-fact' });
      el.createDiv({ cls: 'dr-prop-fact-label', text: label });
      const value = el.createDiv({ cls: 'dr-prop-fact-value', text });
      if (fix && bulk) {
        const go = value.createSpan({ cls: 'dr-prop-fact-fix', text: fix[0] });
        asButton(go, fix[0]);
        onActivate(go, fix[1]);
      }
      return el;
    };
    fact('Type', TYPE_LABELS[facts.type] || facts.type, ['Change…', () => bulk.openChangeType(prop.name)]);
    fact('In', bulkCount(facts.uses, 'note'));
    fact('Without it', bulkCount(facts.without, 'note'), facts.without ? ['Fill in…', () => bulk.openMissing([root], prop.name)] : null);
    const top = groups.slice().sort((a, b) => b.files.length - a.files.length).slice(0, 3).map((g) => `${g.value} (${g.files.length})`);
    fact('Values', top.length ? `${groups.length}: ${top.join(', ')}${groups.length > 3 ? '…' : ''}` : 'None', groups.length > 1 ? ['Clean up…', () => bulk.openTools([root], 'cleanup', { key: prop.name })] : null);
    if (facts.last) fact('Last changed', this.view.relative(facts.last));
  }

  /** Values as covers or as a list: as chosen, or covers while there are few enough to take in. */
  showsGrid(n) {
    const as = this.settings.propertyValueView || 'auto';
    if (as !== 'auto') return as === 'grid';
    const layout = this.settings.libraryLayout || 'auto';
    return layout === 'covers' || (layout === 'auto' && n <= VALUE_GRID_MOST);
  }

  /**
   * A property's page, as an artist's: its name, how many notes and
   * values, then the values — as covers, or a list when there are many —
   * each opening its own page. Picking values to merge is Edit's.
   */
  renderOverview(detail, prop) {
    const view = this.view;
    const groups = view.groupsByProperty(prop.key);
    const empty = this.emptyNotes(prop.key);
    const using = new Set(empty.map((f) => f.path));
    groups.forEach((g) => g.files.forEach((f) => using.add(f.path)));

    const title = detail.createDiv({ cls: 'dr-split-heading dr-prop-page-title', text: prop.name });
    onContextMenu(title, (evt) => this.propertyMenu(evt, prop));
    const meta = [bulkCount(using.size, 'note'), bulkCount(groups.length, 'value')];
    if (empty.length) meta.push(`${empty.length} empty`);
    detail.createDiv({ cls: 'dr-prop-page-meta', text: meta.join('  ·  ') });
    if (!groups.length && !empty.length) {
      detail.createDiv({ cls: 'dr-split-empty', text: 'No notes carry this property' });
      return;
    }
    if (this.settings.propertyInspector !== false && !view.editing) this.renderInspector(detail, prop, groups);

    const head = detail.createDiv({ cls: 'dr-search-section' });
    head.createSpan({ cls: 'dr-search-section-title', text: 'Values' });
    head.createSpan({ cls: 'dr-search-section-count', text: String(groups.length) });
    if (view.editing) return this.renderValuePicks(detail, prop, groups);

    const grid = this.showsGrid(groups.length);
    const toggle = head.createDiv({ cls: 'dr-prop-view-toggle' });
    [
      ['grid', 'layout-grid', 'Covers'],
      ['list', 'list', 'List'],
    ].forEach(([id, icon, label]) => {
      const b = toggle.createDiv({ cls: 'clickable-icon dr-prop-view' });
      asButton(b, `Show values as ${label.toLowerCase()}`);
      b.dataset.view = id;
      b.toggleClass('is-active', (id === 'grid') === grid);
      setIcon(b, icon);
      onActivate(b, () => {
        this.settings.propertyValueView = id;
        view.render();
        this.plugin.saveData(this.settings);
      });
    });

    const open = (value) => view.navigate({ mode: 'properties', property: prop.key, value, keepFilters: true });
    const limit = view.expanded.has(`values:${prop.key}`) ? groups.length : 200;
    const shown = groups.slice(0, limit);
    if (grid) {
      const tiles = detail.createDiv({ cls: 'dr-grid dr-prop-values-grid' });
      roveFocus(tiles, '.dr-card');
      shown.forEach((group) => {
        const value = String(group.value);
        const card = view.card(tiles, value, bulkCount(group.files.length, 'note'));
        card.dataset.value = value;
        valueArt(view, card.querySelector('.dr-card-art'), prop.key, value, group.files);
        onActivate(card, () => open(value));
        onContextMenu(card, (evt) => this.valueMenu(evt, prop, value));
      });
      if (empty.length) {
        const card = view.card(tiles, 'No value', bulkCount(empty.length, 'note'));
        card.addClass('is-empty-value');
        card.dataset.value = EMPTY_VALUE;
        view.fillArt(card.querySelector('.dr-card-art'), null, 'circle-dashed', null, null);
        onActivate(card, () => open(EMPTY_VALUE));
      }
    } else {
      const list = detail.createDiv({ cls: 'dr-prop-values' });
      roveFocus(list, '.dr-prop-value');
      shown.forEach((group) => {
        const value = String(group.value);
        const row = list.createDiv({ cls: 'dr-prop-value' });
        asButton(row);
        row.dataset.value = value;
        valueArt(view, row.createDiv({ cls: 'dr-prop-value-art' }), prop.key, value, group.files);
        paintValue(row.createDiv({ cls: 'dr-prop-value-name', text: value }), this.plugin, prop.key, value);
        row.createDiv({ cls: 'dr-prop-value-count', text: String(group.files.length) });
        onActivate(row, () => open(value));
        onContextMenu(row, (evt) => this.valueMenu(evt, prop, value));
      });
      if (empty.length) {
        const row = list.createDiv({ cls: 'dr-prop-value is-empty-value' });
        asButton(row);
        row.dataset.value = EMPTY_VALUE;
        row.createDiv({ cls: 'dr-prop-value-art is-blank' });
        row.createDiv({ cls: 'dr-prop-value-name', text: 'No value' });
        row.createDiv({ cls: 'dr-prop-value-count', text: String(empty.length) });
        onActivate(row, () => open(EMPTY_VALUE));
      }
    }
    if (groups.length > limit) {
      const more = detail.createDiv({ cls: 'dr-prop-value-more', text: `Show all ${groups.length}` });
      asButton(more);
      onActivate(more, () => {
        view.expanded.add(`values:${prop.key}`);
        view.render();
      });
    }
  }

  /** In Edit: the values as a list to pick from, and Merge for two or more. */
  renderValuePicks(detail, prop, groups) {
    const view = this.view;
    const bulk = this.plugin.feature(BulkEditing);
    const isTags = TAG_KEYS.indexOf(String(prop.key).toLowerCase()) !== -1;
    if (!view.valuePicks || view.valuePicks.key !== prop.key) view.valuePicks = { key: prop.key, set: new Set() };
    const picks = view.valuePicks.set;
    Array.from(picks).forEach((v) => {
      if (!groups.some((g) => String(g.value) === v)) picks.delete(v);
    });
    const bar = detail.createDiv({ cls: 'dr-prop-merge-bar' });
    const list = detail.createDiv({ cls: 'dr-prop-values is-picking' });
    const refresh = () => {
      bar.empty();
      bar.createSpan({
        cls: 'dr-prop-merge-said',
        text: isTags
          ? 'Tags are renamed from their menu.'
          : picks.size === 0
          ? 'Pick two or more values to merge them into one.'
          : picks.size === 1
          ? '1 value picked. Pick another to merge them.'
          : `${picks.size} values picked.`,
      });
      if (isTags || !bulk) return;
      const merge = bar.createEl('button', { cls: 'mod-cta dr-prop-merge-values', text: picks.size > 1 ? `Merge ${picks.size}…` : 'Merge…' });
      merge.disabled = picks.size < 2;
      merge.addEventListener('click', () => {
        if (picks.size < 2) return;
        bulk.openMergeValues(this.plugin.propertyLabel(prop.key), Array.from(picks));
      });
    };
    groups.forEach((group) => {
      const value = String(group.value);
      const row = list.createDiv({ cls: 'dr-prop-value' });
      row.dataset.value = value;
      if (!isTags && bulk) {
        const tick = row.createEl('input', { cls: 'dr-prop-value-tick', type: 'checkbox' });
        tick.checked = picks.has(value);
        tick.setAttribute('aria-label', `Pick “${value}” to merge`);
        row.toggleClass('is-picked', tick.checked);
        tick.addEventListener('change', () => {
          if (tick.checked) picks.add(value);
          else picks.delete(value);
          row.toggleClass('is-picked', tick.checked);
          refresh();
        });
        row.addEventListener('click', (evt) => {
          if (evt.target === tick) return;
          tick.checked = !tick.checked;
          tick.dispatchEvent(new Event('change'));
        });
      }
      paintValue(row.createDiv({ cls: 'dr-prop-value-name', text: value }), this.plugin, prop.key, value);
      row.createDiv({ cls: 'dr-prop-value-count', text: String(group.files.length) });
      onContextMenu(row, (evt) => this.valueMenu(evt, prop, value));
    });
    refresh();
  }

  /**
   * One value, as an album: its cover, its name, the property it's a
   * value of — the way back — and its notes, in the album's own list.
   * "No value" gathers the notes that leave the property empty.
   */
  renderValuePage(root, prop, value) {
    const view = this.view;
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    view.renderSidebarToggle(bar);
    view.renderNav(bar);
    view.renderSearchField(bar);
    view.renderFilterChips(root);

    const isEmpty = value === EMPTY_VALUE;
    const group = isEmpty
      ? { value: 'No value', files: this.emptyNotes(prop.key) }
      : view.groupsByProperty(prop.key).find((g) => String(g.value) === String(value));
    if (!group) {
      root.createDiv({ cls: 'dr-split-empty', text: `No notes have “${value}” as their ${prop.name}` });
      return;
    }
    const files = view.sortFiles(group.files.filter((f) => view.matches(f.basename)));
    const title = String(group.value);
    const id = `value:${prop.key}:${title}`;
    view.renderAlbumHead(root, {
      title,
      sub: prop.name,
      cover: isEmpty ? null : view.groupCover(group),
      glyph: isEmpty ? 'circle-dashed' : 'tag',
      genName: view.genName(title, id),
      files,
      onArtMenu: isEmpty ? null : (evt) => this.valueMenu(evt, prop, title),
    });
    // The property it belongs to, under the name, is the way back to it — as an album's artist is.
    const sub = root.querySelector('.dr-detail-sub');
    if (sub) {
      sub.addClass('is-link');
      asButton(sub, `Back to ${prop.name}`);
      onActivate(sub, () => view.navigate({ mode: 'properties', property: prop.key, value: null, keepFilters: true }));
    }
    const actions = root.querySelector('.dr-detail-actions');
    if (actions && !isEmpty) {
      const more = view.action(actions, 'ellipsis', 'More', (evt) => this.valueMenu(evt, prop, title));
      more.addClass('dr-value-more');
    }

    const list = root.createDiv({ cls: 'dr-tracks dr-value-tracks' });
    roveFocus(list, '.dr-track');
    view.renderLimited(list, files, `value:${prop.key}:${title}`, 1000);
  }

  /**
   * While property filters narrow the library: how many notes pass all of
   * them, and the way to see them — as a list, or to search among them.
   */
  renderMatching(root) {
    const view = this.view;
    if (!view.propFilters().length) return;
    const files = libraryIndex(this.plugin)
      .markdown()
      .filter((f) => !this.plugin.isFolderNote(f) && view.inFilter(f));
    const line = root.createDiv({ cls: 'dr-prop-matching' });
    line.createSpan({ cls: 'dr-prop-matching-count', text: `${bulkCount(files.length, 'matching note')}` });
    [
      ['Show them', 'notes'],
      ['Search among them', 'search'],
    ].forEach(([label, mode]) => {
      const go = line.createEl('button', { cls: 'dr-prop-matching-go', text: label });
      go.dataset.mode = mode;
      go.addEventListener('click', () => view.navigate({ mode, property: null, value: null, path: '/', keepFilters: true }));
    });
  }

  /**
   * A value's menu, as an album's: opening it first, then what changes
   * it — renamed or merged everywhere — and copying it; last, narrowing
   * the library to its notes.
   */
  valueMenu(evt, prop, value) {
    const view = this.view;
    evt.preventDefault();
    const menu = new Menu();
    const bulk = this.plugin.feature(BulkEditing);
    const state = { mode: 'properties', property: prop.key, value };
    const add = (title, icon, section, run) => menu.addItem((item) => item.setTitle(title).setIcon(icon).setSection(section).onClick(run));
    add('Open', 'book-open', 'open', () => view.navigate(Object.assign({ keepFilters: true }, state)));
    add('Open in new tab', 'file-plus', 'open', () =>
      this.app.workspace.getLeaf('tab').setViewState({ type: BROWSE_VIEW, active: true, state: Object.assign({ path: '/' }, state) })
    );
    if (bulk && TAG_KEYS.indexOf(String(prop.key).toLowerCase()) !== -1) {
      const tag = value.replace(/^#/, '');
      add(`Rename #${tag}…`, 'hash', 'action', () => bulk.openRenameTag(tag));
    } else if (bulk) {
      add('Rename value…', 'pencil', 'action', () => bulk.openRenameValue(this.plugin.propertyLabel(prop.key), value));
      // Merging is picking: Edit on the property's page, this value picked.
      add('Merge with…', 'git-merge', 'action', () => {
        view.valuePicks = { key: prop.key, set: new Set([value]) };
        Promise.resolve(view.navigate({ mode: 'properties', property: prop.key, value: null, keepFilters: true })).then(() => view.setEditing(true));
      });
    }
    if (valueOptionsOn(this.plugin) && TAG_KEYS.indexOf(String(prop.key).toLowerCase()) === -1) {
      add('Colour and icon…', 'palette', 'action', () => new ValueOptionModal(this.plugin, prop.key, value, () => view.render()).open());
    }
    add('Copy value', 'copy', 'action', () => copyText(value));
    add('Narrow the library to these', 'filter', 'view', () => {
      view.addPropFilter({ key: prop.name, value, negate: false });
      view.navigate({ mode: 'properties', property: null, value: null, keepFilters: true });
    });
    showMenuAt(menu, evt);
  }

  /** Edit, beside Find, as an album has it: on a property's page, to pick values to merge; else to rename and merge properties. */
  editButton(root, any, onProperty) {
    const view = this.view;
    const bar = root.querySelector('.dr-detail-bar');
    if (!bar || (!any && !view.editing) || !this.plugin.feature(BulkEditing)) return;
    const button = bar.createEl('button', {
      cls: `dr-bar-edit${view.editing ? ' is-done' : ''}`,
      text: view.editing ? 'Done' : 'Edit',
    });
    button.setAttribute(
      'aria-label',
      view.editing ? 'Stop editing' : onProperty ? 'Pick values to merge' : 'Rename and merge properties'
    );
    button.addEventListener('click', () => {
      view.propPicks = new Set();
      if (view.editing && view.valuePicks) view.valuePicks.set.clear();
      view.setEditing(!view.editing);
    });
    const next = bar.querySelector('.dr-filter-btn') || bar.querySelector('.dr-browse-search');
    if (next) next.before(button);
  }

  /**
   * Every property as a name to change, and a circle to pick it by:
   * changing a name renames it everywhere, and two or more picked can
   * be merged into one.
   */
  renderEditing(root, props) {
    const view = this.view;
    const picks = view.propPicks instanceof Set ? view.propPicks : (view.propPicks = new Set());
    // Picks renamed or gone since are let go.
    Array.from(picks).forEach((name) => {
      if (!props.some((p) => p.name === name)) picks.delete(name);
    });

    const wrap = root.createDiv({ cls: 'dr-prop-edit' });
    const bar = wrap.createDiv({ cls: 'dr-prop-edit-bar' });
    const said = bar.createDiv({ cls: 'dr-prop-edit-said' });
    const merge = bar.createEl('button', { cls: 'mod-cta dr-prop-merge' });
    const refresh = () => {
      const n = picks.size;
      said.setText(
        n === 0
          ? 'Change a name to rename it everywhere. Pick two or more to merge them.'
          : n === 1
          ? '1 picked. Pick another to merge them.'
          : `${n} picked.`
      );
      merge.setText(n > 1 ? `Merge ${n}…` : 'Merge…');
      merge.disabled = n < 2;
      merge.toggleClass('is-disabled', n < 2);
    };
    merge.addEventListener('click', () => {
      if (picks.size < 2) return;
      const tools = this.plugin.feature(BulkEditing);
      if (tools) tools.openMerge(props.filter((p) => picks.has(p.name)).map((p) => p.name));
    });

    const spellings =
      this.plugin.bulk && typeof this.plugin.bulk.propertySpellings === 'function'
        ? this.plugin.bulk.propertySpellings()
        : new Map();
    const list = wrap.createDiv({ cls: 'dr-split-list dr-prop-edit-list' });
    props.forEach((prop) => {
      const row = list.createDiv({ cls: 'dr-split-row is-editing' });
      const pick = row.createDiv({ cls: 'dr-prop-pick' });
      pick.setAttribute('role', 'checkbox');
      pick.setAttribute('tabindex', '0');
      const paint = () => {
        const on = picks.has(prop.name);
        row.toggleClass('is-picked', on);
        pick.setAttribute('aria-checked', String(on));
        pick.empty();
        if (on) setIcon(pick, 'check');
      };
      const flip = () => {
        if (picks.has(prop.name)) picks.delete(prop.name);
        else picks.add(prop.name);
        paint();
        refresh();
      };
      onActivate(pick, flip);
      paint();

      const thumb = row.createDiv({ cls: 'dr-split-thumb is-blank' });
      setIcon(thumb.createSpan({ cls: 'dr-card-glyph' }), TYPE_ICONS[prop.type] || 'tag');

      const name = row.createEl('input', { cls: 'dr-edit-name dr-split-name', type: 'text' });
      name.value = prop.name;
      name.setAttribute('spellcheck', 'false');
      // Notes can write a property's name differently — Parent and
      // parent are one property to Obsidian, which lists it one way.
      // Enter on the name as shown writes it that way in all of them.
      const others = Array.from((spellings.get(prop.name.toLowerCase()) || new Map()).entries()).filter(
        ([spelling]) => spelling !== prop.name
      );
      view.editField(name, prop.name, (value) => this.renameProperty(prop.name, value), {
        enterSame: others.length ? (value) => this.renameProperty(prop.name, value) : null,
      });

      if (others.length) {
        const count = others.reduce((n, [, c]) => n + c, 0);
        const fix = row.createEl('button', {
          cls: 'dr-prop-spelling',
          text: `${others.map(([spelling]) => `“${spelling}”`).join(', ')} in ${count}`,
        });
        fix.setAttribute(
          'aria-label',
          `${bulkCount(count, 'note')} ${count === 1 ? 'writes' : 'write'} it ${others.map(([spelling]) => `“${spelling}”`).join(' or ')}. Change ${count === 1 ? 'it' : 'them'} to “${prop.name}”`
        );
        const icon = fix.createSpan({ cls: 'dr-prop-spelling-icon' });
        setIcon(icon, 'wand-2');
        fix.prepend(icon);
        fix.addEventListener('click', (evt) => {
          evt.stopPropagation();
          this.renameProperty(prop.name, name.value.trim() || prop.name);
        });
      }

      row.createDiv({ cls: 'dr-split-count', text: String(prop.count) });
      // The row itself picks too, except where the name is typed.
      row.addEventListener('click', (evt) => {
        if (evt.target === name || pick.contains(evt.target)) return;
        flip();
      });
      onContextMenu(row, (evt) => this.propertyMenu(evt, prop));
    });
    refresh();
  }

  /**
   * A name changed in the list: renamed everywhere, with Undo. One that
   * needs a look first — notes where both names hold different values,
   * or tags, aliases or CSS classes — opens the rename, filled in.
   */
  async renameProperty(from, to) {
    const view = this.view;
    const tools = this.plugin.feature(BulkEditing);
    if (!tools || !this.plugin.bulk) return;
    await renamePropertyInPlace(this.plugin.bulk, from, to, {
      redraw: () => view.render(),
      review: () => {
        view.render();
        tools.openRenameProperty(from, to);
      },
      picks: view.propPicks,
    });
  }

  /** A property's menu: its values, then what changes it everywhere, and copying its name. */
  propertyMenu(evt, prop) {
    const view = this.view;
    evt.preventDefault();
    const menu = new Menu();
    const name = prop.name;
    const add = (title, icon, section, run) => menu.addItem((item) => item.setTitle(title).setIcon(icon).setSection(section).onClick(run));
    add('View values', 'layout-grid', 'open', () => view.navigate({ mode: 'properties', property: prop.key, value: null, keepFilters: true }));
    const bulk = this.plugin.feature(BulkEditing);
    if (bulk) {
      const root = this.app.vault.getRoot();
      add('Rename property…', 'pencil', 'action', () => bulk.openRenameProperty(name));
      add('Merge property…', 'git-merge', 'action', () => bulk.openMerge([name]));
      add('Change type…', 'shapes', 'action', () => bulk.openChangeType(name));
      add('Find notes missing it…', 'list-checks', 'action', () => bulk.openMissing([root], name));
    }
    add('Copy property name', 'copy', 'action', () => copyText(name));
    if (bulk) add('Remove from every note…', 'list-minus', 'remove', () => bulk.openRemove([this.app.vault.getRoot()], [name]));
    showMenuAt(menu, evt);
  }
}

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

export class SearchScreen extends BrowseScreen {
  title() {
    return 'Search';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const q = view.query.trim().toLowerCase();
    if (!q) return this.renderIdle(root);
    this.renderResults(root, q);
  }

  /* -- nothing typed yet ------------------------------------------ */

  /**
   * A screen in its own right rather than an empty box, as a music
   * app's Search tab is: what you looked for last, as a short list, and
   * the categories to browse, as tiles.
   */
  renderIdle(root) {
    const recents = collapseSearches(this.settings.recentSearches).slice(0, 6);

    if (recents.length) {
      const head = this.heading(root, 'Recently Searched');
      const clear = head.createDiv({ cls: 'dr-search-clear' });
      asButton(clear);
      clear.setText('Clear');
      onActivate(clear, async () => {
        this.settings.recentSearches = [];
        await this.plugin.saveData(this.settings);
        this.view.render();
      });

      const list = root.createDiv({ cls: 'dr-recent-list' });
      roveFocus(list, '.dr-recent');
      recents.forEach((term) => this.recentCard(list, term));
    }

    // The categories lead: the screen's main thing, as a music app's genres are.
    const categories = this.categories();
    const head = this.heading(root, 'Browse Categories');
    this.categoryChoice(head);
    if (categories.length) {
      const grid = root.createDiv({ cls: 'dr-cat-grid' });
      roveFocus(grid, '.dr-cat');
      categories.forEach((cat) => this.categoryCard(grid, cat));
      return;
    }

    // No property to draw them from yet: the ways into the vault instead.
    const ways = root.createDiv({ cls: 'dr-browse-by' });
    roveFocus(ways, '.dr-browse-by-item');
    [
      ['Collections', 'library', { mode: 'folders', path: '/' }],
      ['Properties', 'list', { mode: 'properties', property: null }],
      ['Tags', 'tag', { mode: 'properties', property: 'tags' }],
    ].forEach(([label, icon, state]) => {
      const item = ways.createDiv({ cls: 'dr-browse-by-item' });
      asButton(item);
      setIcon(item.createSpan({ cls: 'dr-browse-by-icon' }), icon);
      item.createSpan({ text: label });
      onActivate(item, () => this.view.navigate(state));
    });
  }

  /** Beside Browse Categories: which property they come from, and a menu to choose another. */
  categoryChoice(head) {
    const key = this.settings.categoryProperty || '';
    const pick = head.createDiv({ cls: 'dr-search-sort dr-cat-choice' });
    asButton(pick, 'Which property the categories come from');
    pick.createSpan({ text: key ? this.plugin.propertyLabel(key) : 'Choose a property' });
    setIcon(pick.createSpan({ cls: 'dr-search-sort-icon' }), 'chevron-down');
    onActivate(pick, (evt) => {
      const menu = new Menu();
      const props = this.view
        .propertyList()
        .filter((p) => TAG_KEYS.indexOf(p.key) === -1 && ['text', 'multitext', 'tags'].indexOf(p.type) !== -1)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
      props.forEach((p) =>
        menu.addItem((item) =>
          item
            .setTitle(p.name)
            .setChecked(p.key === String(key).toLowerCase())
            .setSection('action')
            .onClick(() => this.setCategories(p.name))
        )
      );
      if (key) menu.addItem((item) => item.setTitle('None').setIcon('x').setSection('remove').onClick(() => this.setCategories('')));
      showMenuAt(menu, evt);
    });
  }

  async setCategories(key) {
    this.settings.categoryProperty = key;
    await this.plugin.saveData(this.settings);
    this.view.render();
  }

  heading(root, text) {
    const head = root.createDiv({ cls: 'dr-search-section' });
    head.createSpan({ cls: 'dr-search-section-title', text: text });
    return head;
  }

  /** A search you made, as a row: a press searches it again. */
  recentCard(list, term) {
    const row = list.createDiv({ cls: 'dr-recent' });
    asButton(row);
    setIcon(row.createSpan({ cls: 'dr-recent-icon' }), 'search');
    row.createSpan({ cls: 'dr-recent-title', text: term });

    onActivate(row, () => {
      this.view.query = term;
      this.view.render();
      const input = this.view.contentEl.querySelector('.dr-browse-search input');
      if (!input) return;
      input.focus();
      input.setSelectionRange(term.length, term.length);
    });
  }

  /**
   * The values of one property, standing in for Apple's genres: the
   * broadest thing a vault divides itself into. Which property is a
   * setting, since every vault names its own.
   */
  categories() {
    const key = this.settings.categoryProperty;
    if (!key) return [];
    return this.view
      .groupsByProperty(key)
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 18);
  }

  categoryCard(grid, group) {
    const card = grid.createDiv({ cls: 'dr-cat' });
    asButton(card);

    // No artwork to draw on, so the colour comes from the name itself —
    // stable, so a category keeps its colour between visits.
    let hash = 0;
    for (let i = 0; i < group.value.length; i++) {
      hash = (hash * 31 + group.value.charCodeAt(i)) % 360;
    }
    card.style.setProperty('--dr-cat-hue', String(hash));

    const cover = this.view.groupCover(group);
    if (cover) {
      const img = card.createEl('img', { cls: 'dr-cat-art' });
      img.src = cover;
      img.alt = '';
      img.addEventListener('error', () => img.remove());
    }

    card.createSpan({ cls: 'dr-cat-name', text: group.value });
    card.createSpan({
      cls: 'dr-cat-count',
      text: group.files.length === 1 ? '1 note' : `${group.files.length} notes`,
    });

    onActivate(card, () =>
      this.view.navigate({
        mode: 'properties',
        property: this.settings.categoryProperty,
        value: group.value,
      })
    );
  }

  /* -- results ----------------------------------------------------- */

  /**
   * As a music app's search answers: the best match on its own, large;
   * then each kind under its name — albums as covers, notes as rows,
   * properties and their values, your collections, and what notes say —
   * a few of each, with See All for the rest of one kind.
   */
  renderResults(root, q) {
    const view = this.view;
    const words = searchWords(q);
    const hasAll = (text) => words.every((w) => text.indexOf(w) !== -1);

    const folders = [];
    const walk = (folder) =>
      view.visibleFolders(folder).forEach((child) => {
        if (hasAll(child.name.toLowerCase()) && view.folderInFilter(child)) folders.push(child);
        walk(child);
      });
    walk(this.app.vault.getRoot());
    // The album named for the query first, then those it starts.
    const albumScore = (f) => {
      const name = f.name.toLowerCase();
      return name === q ? 95 : name.startsWith(q) ? 80 : 60;
    };
    folders.sort((a, b) => albumScore(b) - albumScore(a) || a.name.localeCompare(b.name));

    // Names and property values, both of which the cache already holds;
    // what notes say is read after, a moment later.
    const ranked = [];
    libraryIndex(this.plugin)
      .notes()
      .forEach((f) => {
        if (!view.inFilter(f)) return;
        const parent = f.parent && f.parent.path !== '/' ? f.parent.path : '';
        const match = rankNote({ title: f.basename, props: noteProps(this.app, f), album: parent }, q);
        if (match) ranked.push({ file: f, score: match.score, why: match.why });
      });
    ranked.sort((a, b) => b.score - a.score || a.file.basename.localeCompare(b.file.basename));
    view.searchWhy = new Map(ranked.map((r) => [r.file.path, r.why]));

    // Your collections by name: smart albums, and albums that gather
    // notes from elsewhere not already among the albums.
    const collections = collectionTiles(view).filter((item) => !(item instanceof TFolder) || folders.indexOf(item) === -1);
    const properties = this.propertyHits(hasAll, q);
    const textOn = this.settings.searchNoteText !== false && q.length >= 3;

    // The one best match, whichever kind it is.
    const candidates = [];
    if (ranked.length) candidates.push({ kind: 'notes', score: ranked[0].score, item: ranked[0].file });
    if (folders.length) candidates.push({ kind: 'albums', score: albumScore(folders[0]), item: folders[0] });
    if (properties.length && properties[0].exact) candidates.push({ kind: 'properties', score: 90, item: properties[0] });
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0] || null;

    const notes = ranked.map((r) => r.file).filter((f) => !top || top.item !== f);
    const albums = folders.filter((f) => !top || top.item !== f);
    const props = properties.filter((p) => !top || top.item !== p);
    const count = ranked.length + folders.length + collections.length + properties.length;

    const head = root.createDiv({ cls: 'dr-search-head' });
    head.createSpan({ cls: 'dr-search-count', text: count === 1 ? '1 result' : `${count} results` });
    const full = head.createDiv({ cls: 'dr-search-full' });
    asButton(full);
    setIcon(full.createSpan({ cls: 'dr-search-full-icon' }), 'file-search');
    full.createSpan({ text: textOn ? 'Obsidian search' : 'Search inside notes' });
    onActivate(full, () => {
      try {
        const search = this.app.internalPlugins.getPluginById('global-search');
        search.instance.openGlobalSearch(view.query);
      } catch (err) {
        console.error('Design Redux: could not open search', err);
        new Notice('Turn on the Search core plugin to search inside notes.');
      }
    });

    const sections = {
      albums: { title: 'Collections', n: albums.length, draw: (el, all) => this.albumsSection(el, all ? albums : albums.slice(0, 6)) },
      notes: { title: 'Notes', n: notes.length, draw: (el, all) => this.notesSection(el, all ? notes : notes.slice(0, 6), all) },
      properties: { title: 'Properties', n: props.length, draw: (el, all) => this.propertiesSection(el, all ? props : props.slice(0, 5)) },
      collections: { title: 'Views', n: collections.length, draw: (el, all) => tileGrid(view, el, all ? collections : collections.slice(0, 6)) },
    };
    const limits = { albums: 6, notes: 6, properties: 5, collections: 6 };
    const skip = new Set(ranked.map((r) => r.file.path));

    // See All: one kind, whole, with the way back to everything.
    const only = view.searchKind && (sections[view.searchKind] || (view.searchKind === 'text' && textOn)) ? view.searchKind : null;
    if (only) {
      const back = root.createDiv({ cls: 'dr-search-back' });
      asButton(back, 'All results');
      setIcon(back.createSpan({ cls: 'dr-search-back-icon' }), 'chevron-left');
      back.createSpan({ text: 'All results' });
      onActivate(back, () => {
        view.searchKind = null;
        view.render();
      });
      if (only === 'text') return this.renderText(root, q, skip, 0);
      this.heading(root, sections[only].title).createSpan({ cls: 'dr-search-section-count', text: String(sections[only].n) });
      sections[only].draw(root, true);
      return;
    }

    if (!count) root.createDiv({ cls: 'dr-split-empty dr-search-none', text: 'No matches by name or property' });
    if (top) this.topResult(root, top);
    ['albums', 'notes', 'properties', 'collections'].forEach((id) => {
      const s = sections[id];
      if (!s.n) return;
      const h = this.heading(root, s.title);
      if (s.n > limits[id]) this.seeAll(h, id);
      if (id === 'notes' && s.n > 1) this.notesTools(h, ranked.map((r) => r.file));
      s.draw(root, false);
    });
    if (textOn) this.renderText(root, q, skip, 5);
  }

  /** Properties…, at the notes' heading: the property tools over every note found. */
  notesTools(head, files) {
    const tools = head.createSpan({ cls: 'dr-search-see-all dr-search-props', text: 'Properties…' });
    asButton(tools, `The properties of these ${files.length} notes`);
    onActivate(tools, () => this.view.propertyToolsFor(files));
  }

  /** "See All", at a section's heading: that kind, whole. */
  seeAll(head, id) {
    const all = head.createSpan({ cls: 'dr-search-see-all', text: 'See All' });
    asButton(all);
    all.dataset.kind = id;
    onActivate(all, () => {
      this.view.searchKind = id;
      this.view.render();
      if (this.view.contentEl) this.view.contentEl.scrollTop = 0;
    });
  }

  /** The best match, large: its cover, its name, what it is. */
  topResult(root, top) {
    const view = this.view;
    this.heading(root, 'Top Result');
    const card = root.createDiv({ cls: 'dr-search-top' });
    asButton(card);
    card.dataset.kind = top.kind;
    const art = card.createDiv({ cls: 'dr-search-top-art' });
    const text = card.createDiv({ cls: 'dr-search-top-text' });
    let title = '';
    let sub = '';
    if (top.kind === 'notes') {
      const file = top.item;
      drawNoteArt(this.plugin, art, file);
      title = file.basename;
      sub = ['Note'].concat(file.parent && file.parent.path !== '/' ? [file.parent.name] : []).join(' · ');
      card.dataset.path = file.path;
      view.pickOrOpen(card, { file }, (evt) => view.openFile(file, evt), false);
      onContextMenu(card, (evt) => view.fileMenu(evt, file));
    } else if (top.kind === 'albums') {
      const folder = top.item;
      drawFolderArt(this.plugin, art, folder);
      title = folder.name;
      sub = `Collection · ${view.countLabel(folder)}`;
      card.dataset.path = folder.path;
      view.pickOrOpen(card, { folder }, () => view.openFolder(folder), false);
      onContextMenu(card, (evt) => view.folderMenu(evt, folder, view.folderCover(folder)));
    } else {
      const hit = top.item;
      this.valueArt(art, hit.key, hit.value, hit.files);
      title = hit.value;
      sub = `${hit.name} · ${bulkCount(hit.files.length, 'note')}`;
      onActivate(card, () => view.navigate({ mode: 'properties', property: hit.key, value: hit.value }));
    }
    text.createDiv({ cls: 'dr-search-top-title', text: title });
    text.createDiv({ cls: 'dr-search-top-sub', text: sub });
  }

  albumsSection(root, folders) {
    const grid = root.createDiv({ cls: 'dr-grid' });
    roveFocus(grid, '.dr-card');
    folders.forEach((f) => this.view.folderCard(grid, f, f.parent && f.parent.path !== '/' ? f.parent.name : null));
  }

  notesSection(root, notes, all) {
    const list = root.createDiv({ cls: 'dr-tracks dr-search-notes' });
    roveFocus(list, '.dr-track');
    this.view.renderLimited(list, notes, 'search', all ? 500 : notes.length);
  }

  /** Properties named like the query, and values of any property that are: each opening its page. */
  propertiesSection(root, hits) {
    const view = this.view;
    const list = root.createDiv({ cls: 'dr-search-props' });
    roveFocus(list, '.dr-search-prop');
    hits.forEach((hit) => {
      const row = list.createDiv({ cls: 'dr-search-prop' });
      asButton(row);
      const art = row.createDiv({ cls: 'dr-search-prop-art' });
      const text = row.createDiv({ cls: 'dr-search-prop-text' });
      if (hit.value === null) {
        setIcon(art, TYPE_ICONS[hit.type] || 'list');
        art.addClass('is-blank');
        text.createDiv({ cls: 'dr-search-prop-title', text: hit.name });
        text.createDiv({ cls: 'dr-search-prop-sub', text: `Property · ${bulkCount(hit.count, 'note')}` });
        onActivate(row, () => view.navigate({ mode: 'properties', property: hit.key, value: null }));
        return;
      }
      this.valueArt(art, hit.key, hit.value, hit.files);
      text.createDiv({ cls: 'dr-search-prop-title', text: `${hit.name}: ${hit.value}` });
      text.createDiv({ cls: 'dr-search-prop-sub', text: bulkCount(hit.files.length, 'note') });
      onActivate(row, () => view.navigate({ mode: 'properties', property: hit.key, value: hit.value }));
    });
  }

  valueArt(el, key, value, files) {
    valueArt(this.view, el, key, value, files);
  }

  /**
   * Properties whose names hold the query, and values that do, with the
   * notes carrying each — one pass over the notes. A value that is the
   * query exactly comes first, and may be the top result.
   */
  propertyHits(hasAll, q) {
    const view = this.view;
    const out = [];
    view.propertyList().forEach((p) => {
      if (hasAll(p.name.toLowerCase())) out.push({ key: p.key, name: p.name, type: p.type, count: p.count, value: null, files: [], exact: p.name.toLowerCase() === q });
    });
    const values = new Map();
    libraryIndex(this.plugin)
      .notes()
      .forEach((file) => {
        if (!view.inFilter(file)) return;
        const fm = noteProps(this.app, file);
        Object.keys(fm).forEach((k) => {
          if (k === 'position') return;
          const raw = fm[k];
          (Array.isArray(raw) ? raw : [raw]).forEach((v) => {
            if (v === null || v === undefined || typeof v === 'object') return;
            const value = view.plain(v);
            if (!value || value.length > 80 || !hasAll(value.toLowerCase())) return;
            const id = `${k.toLowerCase()}\u0000${value}`;
            if (!values.has(id)) values.set(id, { key: k.toLowerCase(), name: k, value, files: [], exact: value.toLowerCase() === q });
            const hit = values.get(id);
            if (hit.files.indexOf(file) === -1) hit.files.push(file);
          });
        });
      });
    const sorted = Array.from(values.values()).sort(
      (a, b) => Number(b.exact) - Number(a.exact) || b.files.length - a.files.length || a.value.localeCompare(b.value)
    );
    // Values first — they're where the notes are — then the properties by name.
    return sorted.concat(out).slice(0, 60);
  }

  /**
   * Notes whose text holds the query, each with the passage — read once
   * typing has paused, a few at a time so typing stays quick, and kept
   * for a while so drawing the screen again doesn't read them again.
   * `limit` shows that many, with See All for the rest; 0 shows them all.
   */
  renderText(root, q, skip, limit) {
    const view = this.view;
    const section = root.createDiv({ cls: 'dr-search-text' });
    const head = this.heading(section, 'In Notes');
    const count = head.createSpan({ cls: 'dr-search-section-count' });
    const status = section.createDiv({ cls: 'dr-search-text-status', text: 'Looking through notes…' });
    const list = section.createDiv({ cls: 'dr-tracks dr-search-text-notes' });
    roveFocus(list, '.dr-track');

    const key = [q, view.filterFolder, view.filterTag, JSON.stringify(view.propFilters()), JSON.stringify(view.filterDate)].join('|');
    const show = (hits) => {
      status.remove();
      count.setText(hits.length >= TEXT_MOST ? `${TEXT_MOST}+` : String(hits.length));
      if (!hits.length) {
        section.createDiv({ cls: 'dr-split-empty', text: 'No other notes say that' });
        return;
      }
      if (limit && hits.length > limit) this.seeAll(head, 'text');
      if (!view.searchWhy) view.searchWhy = new Map();
      const shown = limit ? hits.slice(0, limit) : hits;
      shown.forEach((h) => view.searchWhy.set(h.file.path, h.excerpt));
      shown.forEach((h, i) => view.trackRow(list, h.file, i + 1));
    };
    const kept = view.textFound;
    if (kept && kept.key === key && Date.now() - kept.at < 15000) return show(kept.hits.filter((h) => !skip.has(h.file.path)));

    const token = (view.textToken = (view.textToken || 0) + 1);
    const live = () => view.textToken === token && section.isConnected;
    window.setTimeout(async () => {
      if (!live()) return;
      const hits = await this.textHits(q, skip, live);
      if (!hits || !live()) return;
      view.textFound = { key, at: Date.now(), hits };
      show(hits);
    }, TEXT_PAUSE);
  }

  async textHits(q, skip, live) {
    const view = this.view;
    const files = libraryIndex(this.plugin)
      .markdown()
      .filter((f) => !skip.has(f.path) && !this.plugin.isFolderNote(f) && view.inFilter(f));
    const hits = [];
    for (let i = 0; i < files.length && hits.length < TEXT_MOST; i++) {
      if (i && i % 40 === 0) {
        await new Promise((r) => window.setTimeout(r, 0));
        if (!live()) return null;
      }
      let body = '';
      try {
        body = await this.app.vault.cachedRead(files[i]);
      } catch (err) {
        continue;
      }
      const excerpt = textExcerpt(body, q);
      if (excerpt) hits.push({ file: files[i], excerpt });
    }
    return hits;
  }
}

/* Home's shelves, in the order they first come; which show, and in what order, is the homeShelves setting. */
export const HOME_SHELVES = [
  { id: 'picks', label: 'Highlights' },
  { id: 'revisit', label: 'To revisit' },
  { id: 'continue', label: 'Continue reading' },
  { id: 'fromReading', label: 'From what you read' },
  { id: 'recents', label: 'Recently opened' },
  { id: 'added', label: 'Recently added' },
  { id: 'collections', label: 'Your views' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'rediscover', label: 'Rediscover' },
  { id: 'folders', label: 'Folders' },
];

/** Home's shelves as set: each once, in the order chosen, on or off; any new since, on at the end. */
export function homeShelves(settings) {
  const known = new Map(HOME_SHELVES.map((s) => [s.id, s]));
  const out = [];
  (Array.isArray(settings.homeShelves) ? settings.homeShelves : []).forEach((s) => {
    if (s && known.has(s.id) && !out.some((o) => o.id === s.id)) out.push(Object.assign({}, known.get(s.id), { on: s.on !== false }));
  });
  HOME_SHELVES.forEach((s) => {
    if (!out.some((o) => o.id === s.id)) out.push(Object.assign({}, s, { on: true }));
  });
  return out;
}

export class HomeScreen extends BrowseScreen {
  title() {
    return 'Home';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    // Find and the filters narrow every shelf, as they do every screen.
    const keep = (f) => view.inFilter(f) && view.matches(f.basename);
    const home = this.app.vault.getFileByPath(this.settings.homePath || 'Home.md');
    const note = home && keep(home) ? home : null;

    const recents = this.plugin.recentFiles().filter(keep);
    const pinned = this.plugin.pins.files().filter(keep).slice(0, 12);
    const notes = libraryIndex(this.plugin).notes()
      .filter(keep);
    const added = notes
      .slice()
      .sort((a, b) => b.stat.ctime - a.stat.ctime)
      .slice(0, 12);
    const older = this.rediscover(notes, recents);
    const folders = view.sortFolders(
      view
        .visibleFolders(this.app.vault.getRoot())
        .filter((f) => view.folderInFilter(f))
        .filter((f) => view.matches(f.name))
    );

    // Up front, large: where you were, the home note, and one to come
    // back to — each captioned with why it's there.
    const picks = [];
    const pick = (caption, file) => {
      if (file && !picks.some((p) => p.file === file)) picks.push({ caption, file });
    };
    pick('Last opened', recents.find((f) => f.extension === 'md' && f !== note));
    pick('Home note', note);
    pick('Rediscover', older[0]);

    // The shelves, in the order and as many as the settings say.
    const continuing = this.continuing(recents, keep);
    const collections = collectionTiles(view);
    const shelf = (title, items, opts) => items.length > 0 && (view.shelf(root, title, items, opts), true);
    const shelves = {
      picks: () => picks.length > 0 && (this.picks(root, picks), true),
      revisit: () => {
        const due = dueNotes(this.plugin);
        return shelf(`To revisit · ${due.length}`, due.slice(0, 12));
      },
      continue: () => shelf('Continue reading', continuing),
      fromReading: () => shelf('From what you read', this.fromReading(keep)),
      recents: () => shelf('Recently opened', recents.slice(0, 12), { mode: 'recents' }),
      added: () => shelf('Recently added', added, { mode: 'added' }),
      collections: () => shelf('Your views', collections, { mode: 'collections' }),
      pinned: () => shelf('Pinned', pinned, { mode: 'pinned' }),
      rediscover: () => shelf('Rediscover', older.slice(1)),
      folders: () => shelf('Folders', folders, { mode: 'folders' }),
    };
    const drawn = homeShelves(this.settings).filter((s) => s.on && shelves[s.id]()).length;
    if (!drawn) root.createDiv({ cls: 'dr-split-empty', text: 'Nothing here yet' });
  }

  /** Notes what you've read lately links to, not opened yet: why each is there, under it. */
  fromReading(keep) {
    if (!this.settings.readingHistory) return [];
    const history = readingOf(this.plugin);
    const index = libraryIndex(this.plugin);
    const vault = this.app.vault;
    const recent = history.latest('read', 40).map((f) => ({ path: f.path, at: history.entry(f).read }));
    const outgoing = (p) => {
      const f = vault.getAbstractFileByPath(p);
      return f instanceof TFile ? index.outgoing(f) : {};
    };
    const opened = (p) => !!(history.log[p] && history.log[p].opened);
    return fromReading(recent, outgoing, opened, Date.now(), Number(this.settings.fromReadingDays) || 14, 40)
      .map((r) => ({ r, file: vault.getAbstractFileByPath(r.path) }))
      .filter(({ file }) => file instanceof TFile && keep(file) && !this.plugin.isFolderNote(file))
      .slice(0, 12)
      .map(({ r, file }) => {
        const from = vault.getAbstractFileByPath(r.from);
        return { file, subtitle: r.count > 1 ? `From ${r.count} notes you read` : `From ${from ? from.basename : 'a note you read'}` };
      });
  }

  /**
   * Where to pick up: the albums you're partway through, the latest
   * first — the note after the last one you opened in each, with how far
   * along it is.
   */
  continuing(recents, keep) {
    const items = [];
    const seen = new Set();
    // With a reading history: by when you were last in each, and a note not read to its end is where you pick up.
    const history = this.settings.readingHistory ? readingOf(this.plugin) : null;
    const order = history ? history.latest('opened', 200).filter(keep) : recents;
    (order.length ? order : recents).forEach((file) => {
      const album = file.parent;
      if (items.length >= 12 || !album || (album.isRoot && album.isRoot()) || this.plugin.isFolderNote(file) || seen.has(album.path)) return;
      seen.add(album.path);
      const near = albumNeighbours(this.plugin, file);
      if (history && history.entry(file) && history.state(file) !== 'read' && keep(file) && !items.some((i) => i.file === file)) {
        items.push({ file, subtitle: `${album.name} · ${near.index + 1} of ${near.total}`, progress: near.index / near.total });
        return;
      }
      if (!near.next || !keep(near.next) || items.some((i) => i.file === near.next)) return;
      items.push({ file: near.next, subtitle: `${album.name} · ${near.index + 2} of ${near.total}`, progress: (near.index + 1) / near.total });
    });
    return items;
  }

  /**
   * Notes you haven't been in for a while — not opened lately, not
   * changed in a month. A different handful each day, the same one all
   * day, so the shelf doesn't reshuffle on every visit.
   */
  rediscover(notes, recents) {
    const day = 86400000;
    const now = Date.now();
    const seen = new Set(recents.map((f) => f.path));
    const today = Math.floor(now / day);
    // Due a revisit first: read a month ago or more, the longest ago first.
    const history = this.settings.readingHistory ? readingOf(this.plugin) : null;
    const due = history
      ? notes
          .filter((f) => !seen.has(f.path) && history.state(f) === 'read' && now - history.entry(f).read > 30 * day)
          .sort((a, b) => history.entry(a).read - history.entry(b).read)
      : [];
    const dueSet = new Set(due);
    const rest = notes
      .filter((f) => !seen.has(f.path) && !dueSet.has(f) && now - f.stat.mtime > 30 * day)
      .map((f) => ({ file: f, order: stableHash(`${today}:${f.path}`) }))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.file);
    return due.concat(rest).slice(0, 13);
  }

  /**
   * The large cards: a caption above each, its cover, and a band of
   * that cover's colour — the cover itself, blurred — under the title.
   */
  picks(root, picks) {
    const view = this.view;
    const row = root.createDiv({ cls: 'dr-picks' });
    roveFocus(row, '.dr-pick');
    picks.forEach(({ caption, file }) => {
      const card = row.createDiv({ cls: 'dr-pick' });
      card.dataset.path = file.path;
      asButton(card, `${caption}: ${file.basename}`);
      card.createDiv({ cls: 'dr-pick-caption', text: caption });

      const body = card.createDiv({ cls: 'dr-pick-body' });
      const glow = body.createDiv({ cls: 'dr-pick-glow' });
      drawNoteArt(this.plugin, glow, file);
      // White type on the cover's colours; a plain icon has none to give.
      body.toggleClass('is-lit', !!(glow.querySelector('img') || glow.hasClass('is-generated') || glow.hasClass('is-hued') || glow.hasClass('is-drawn')));
      const art = body.createDiv({ cls: 'dr-pick-art' });
      drawNoteArt(this.plugin, art, file);

      const text = body.createDiv({ cls: 'dr-pick-text' });
      text.createDiv({ cls: 'dr-pick-title', text: file.basename });
      const where = file.parent && !(file.parent.isRoot && file.parent.isRoot()) ? file.parent.name : '';
      // Its length as the setting writes it, everywhere a length is shown.
      const length = view.lengthStyle() ? view.lengthLabel(file) : '';
      const sub = [where, length].filter(Boolean).join('  ·  ');
      if (sub) text.createDiv({ cls: 'dr-pick-sub', text: sub });

      onActivate(card, (evt) => view.openFile(file, evt));
      onContextMenu(card, (evt) => view.fileMenu(evt, file));
    });
  }

}

/** A number from text, the same every time: an order that holds for a day. */
export function stableHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Screens you start from, rather than arrive at. */
export const ROOT_MODES = ['home', 'search'];

/* Which screen a mode draws. */
export const BROWSE_SCREENS = {
  home: HomeScreen,
  search: SearchScreen,
  folder: FolderScreen,
  folders: FoldersScreen,
  notes: NotesScreen,
  properties: PropertiesScreen,
  property: PropertiesScreen,
  recents: CollectionScreen,
  pinned: CollectionScreen,
  added: CollectionScreen,
  read: CollectionScreen,
  subjects: SubjectsScreen,
  collections: CollectionsScreen,
};

