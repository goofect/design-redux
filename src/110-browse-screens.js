/* ------------------------------------------------------------------ */
/* Browse screens                                                      */
/*                                                                     */
/* One class per screen. The view owns state, navigation and the parts */
/* every screen shares — artwork, rows, menus, sorting — and a screen  */
/* only decides what to draw. Adding a screen is a class and a line in */
/* the view's screen table.                                            */
/* ------------------------------------------------------------------ */

class BrowseScreen {
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

class FolderScreen extends BrowseScreen {
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
      if (!view.editing) view.renderAlbumFoot(el, all);
    };
    const panels = about ? this.panels(folder, about, all, drawNotes) : [];
    if (panels.length > 1) this.renderPanels(root, folder, about, panels);
    else drawNotes(root);
    if (view.editing) return;
    if (about && about.related.length) view.shelf(root, 'Related albums', about.related);
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
    if (subs.length) out.push({ id: 'albums', label: 'Sub-albums', count: subs.length, draw: (el) => view.folderTiles(el, subs) });
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
      onActivate(row, () => view.openFolder(f));
      onContextMenu(row, (evt) => view.folderMenu(evt, f, view.folderCover(f)));
      if (depth < 4) this.renderTree(list, view.sortFolders(view.visibleFolders(f)), depth + 1);
    });
  }

  /** Notes elsewhere tied to the album's by links: each, how strongly, and a way to show it here. */
  renderLinked(el, folder, linked) {
    const view = this.view;
    const structure = this.plugin.feature(AlbumStructure);
    el.createDiv({ cls: 'dr-report-lead', text: 'Notes kept elsewhere that link with this album’s. Shown here, they stay where they are.' });
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
const ALBUM_RECENTS_FROM = 12;

/* -- every folder, as tiles ------------------------------------------ */

class FoldersScreen extends BrowseScreen {
  title() {
    return 'Folders';
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

    view.folderTiles(root, shown, (f) => f.parent && f.parent.name);
  }
}

/* -- every note, as a table ------------------------------------------ */

class NotesScreen extends BrowseScreen {
  title() {
    return 'Notes';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const notes = view.sortNotes(
      this.app.vault
        .getMarkdownFiles()
        .filter((f) => !this.plugin.isFolderNote(f))
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

class PropertiesScreen extends BrowseScreen {
  title() {
    return 'Properties';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const props = view.propertyList().filter((p) => view.matches(p.name));
    this.editButton(root, props.length > 0);
    if (!props.length) {
      root.createDiv({ cls: 'dr-empty', text: 'No properties' });
      return;
    }
    if (view.editing) {
      this.renderEditing(root, props);
      return;
    }

    const selected = props.find((p) => p.key === view.property) || null;

    const split = root.createDiv({ cls: 'dr-split' });
    const list = split.createDiv({ cls: 'dr-split-list' });
    roveFocus(list, '.dr-split-row');
    const detail = split.createDiv({ cls: 'dr-split-detail' });

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

      onActivate(row, () => view.navigate({ property: prop.key }));
      onContextMenu(row, (evt) => this.propertyMenu(evt, prop.name));
    });

    if (!selected) {
      detail.createDiv({ cls: 'dr-split-empty', text: 'Select a property' });
      return;
    }

    // On a phone there's room for the list or the values, not both, so
    // choosing a property swaps one for the other — the way an artist
    // opens from the Artists list — and back returns to the list. The
    // heading says whose values these are, since the list isn't beside
    // them to show it.
    split.addClass('has-selection');
    const heading = detail.createDiv({ cls: 'dr-split-heading', text: selected.name });
    onContextMenu(heading, (evt) => this.propertyMenu(evt, selected.name));

    const groups = view.groupsByProperty(selected.key);
    if (!groups.length) {
      detail.createDiv({
        cls: 'dr-split-empty',
        text: 'No notes carry this property',
      });
      return;
    }
    // A category arrives naming one value: it leads, and the rest
    // follow beneath so the screen is still the whole property.
    const ordered = view.value
      ? groups
          .slice()
          .sort((a, b) =>
            a.value === view.value ? -1 : b.value === view.value ? 1 : 0
          )
      : groups;
    ordered.forEach((group, i) => view.renderGroup(detail, group, i === 0));
  }

  /** Edit, beside Find, as an album has it; Done while editing. */
  editButton(root, any) {
    const view = this.view;
    const bar = root.querySelector('.dr-detail-bar');
    if (!bar || (!any && !view.editing) || !this.plugin.feature(BulkEditing)) return;
    const button = bar.createEl('button', {
      cls: `dr-bar-edit${view.editing ? ' is-done' : ''}`,
      text: view.editing ? 'Done' : 'Edit',
    });
    button.setAttribute('aria-label', view.editing ? 'Stop editing properties' : 'Rename and merge properties');
    button.addEventListener('click', () => {
      view.propPicks = new Set();
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
      onContextMenu(row, (evt) => this.propertyMenu(evt, prop.name));
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

  /** A property's own menu, from its row or its heading: rename it everywhere. */
  propertyMenu(evt, name) {
    const bulk = this.plugin.feature(BulkEditing);
    if (!bulk) return;
    evt.preventDefault();
    const menu = new Menu();
    const root = this.app.vault.getRoot();
    [
      ['Rename everywhere…', 'pencil', () => bulk.openRenameProperty(name)],
      ['Merge with…', 'git-merge', () => bulk.openMerge([name])],
      ['Change type…', 'shapes', () => bulk.openChangeType(name)],
      ['Find notes missing it…', 'list-checks', () => bulk.openMissing([root], name)],
      ['Remove from every note…', 'list-minus', () => bulk.openRemove([root], [name])],
    ].forEach(([title, icon, run]) => menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(run)));
    showMenuAt(menu, evt);
  }
}

/* -- recents and pins, as tiles -------------------------------------- */

class CollectionScreen extends BrowseScreen {
  get pinned() {
    return this.view.mode === 'pinned';
  }

  title() {
    return this.pinned ? 'Pinned' : 'Recently opened';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    let files = (this.pinned
      ? this.plugin.pins.files()
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
      view.emptyState(root, this.pinned ? 'Nothing pinned yet' : 'Nothing opened yet', this.pinned ? 'pin' : 'clock', view.clearAction());
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

/* -- search ---------------------------------------------------------- */

class SearchScreen extends BrowseScreen {
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
   * A screen in its own right rather than an empty box: what you looked
   * for last, and a way into the vault by category.
   */
  renderIdle(root) {
    const recents = collapseSearches(this.settings.recentSearches).slice(0, 8);

    if (recents.length) {
      const head = this.heading(root, 'Recently searched');
      const clear = head.createDiv({ cls: 'dr-search-clear' });
      asButton(clear);
      clear.setText('Clear');
      onActivate(clear, async () => {
        this.settings.recentSearches = [];
        await this.plugin.saveData(this.settings);
        this.view.render();
      });

      const grid = root.createDiv({ cls: 'dr-recent-grid' });
      roveFocus(grid, '.dr-recent');
      recents.forEach((term) => this.recentCard(grid, term));
    }

    const categories = this.categories();
    if (!categories.length) {
      if (!recents.length) {
        root.createDiv({
          cls: 'dr-split-empty',
          text: 'Search notes, folders and properties',
        });
      }
      return;
    }

    this.heading(root, 'Browse categories');
    const grid = root.createDiv({ cls: 'dr-cat-grid' });
    roveFocus(grid, '.dr-cat');
    categories.forEach((cat) => this.categoryCard(grid, cat));
  }

  heading(root, text) {
    const head = root.createDiv({ cls: 'dr-search-section' });
    head.createSpan({ cls: 'dr-search-section-title', text: text });
    return head;
  }

  recentCard(grid, term) {
    const card = grid.createDiv({ cls: 'dr-recent' });
    asButton(card);

    const art = card.createDiv({ cls: 'dr-recent-art' });
    setIcon(art.createSpan({ cls: 'dr-card-glyph' }), 'search');

    const text = card.createDiv({ cls: 'dr-recent-text' });
    text.createDiv({ cls: 'dr-recent-title', text: term });
    text.createDiv({ cls: 'dr-recent-sub', text: 'Search' });

    onActivate(card, () => {
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

  renderResults(root, q) {
    const view = this.view;

    const folders = [];
    const walk = (folder) =>
      view.visibleFolders(folder).forEach((child) => {
        if (child.name.toLowerCase().includes(q) && view.folderInFilter(child)) folders.push(child);
        walk(child);
      });
    walk(this.app.vault.getRoot());

    // Names and property values, both of which the cache already holds.
    // Searching note bodies would mean reading every file on each
    // keystroke, so that's handed to Obsidian's own search instead.
    const notes = view.sortFiles(
      this.app.vault
        .getMarkdownFiles()
        .filter((f) => !this.plugin.isFolderNote(f))
        .filter((f) => view.inFilter(f))
        .filter(
          (f) =>
            f.basename.toLowerCase().includes(q) ||
            view.propertyText(f).includes(q)
        )
    );

    const count = folders.length + notes.length;
    const head = root.createDiv({ cls: 'dr-search-head' });
    head.createSpan({
      cls: 'dr-search-count',
      text: count === 1 ? '1 result' : `${count} results`,
    });

    const full = head.createDiv({ cls: 'dr-search-full' });
    asButton(full);
    setIcon(full.createSpan({ cls: 'dr-search-full-icon' }), 'file-search');
    full.createSpan({ text: 'Search inside notes' });
    onActivate(full, () => {
      try {
        const search = this.app.internalPlugins.getPluginById('global-search');
        search.instance.openGlobalSearch(view.query);
      } catch (err) {
        console.error('Design Redux: could not open search', err);
        new Notice('Turn on the Search core plugin to search inside notes.');
      }
    });

    if (!count) {
      root.createDiv({ cls: 'dr-split-empty', text: 'No matches' });
      return;
    }

    if (folders.length) {
      const grid = root.createDiv({ cls: 'dr-grid' });
      roveFocus(grid, '.dr-card');
      folders.forEach((f) => view.folderCard(grid, f, f.parent && f.parent.name));
    }

    if (notes.length) {
      const list = root.createDiv({ cls: 'dr-tracks' });
      roveFocus(list, '.dr-track');
      view.renderLimited(list, notes, 'search', 40);
    }
  }
}

class HomeScreen extends BrowseScreen {
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
    const notes = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !this.plugin.isFolderNote(f))
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
    if (picks.length) this.picks(root, picks);

    if (recents.length) view.shelf(root, 'Recently opened', recents.slice(0, 12), { mode: 'recents' });
    if (added.length) view.shelf(root, 'Recently added', added);
    if (pinned.length) view.shelf(root, 'Pinned', pinned, { mode: 'pinned' });
    if (older.length > 1) view.shelf(root, 'Rediscover', older.slice(1));
    if (folders.length) view.shelf(root, 'Folders', folders, { mode: 'folders' });

    if (!note && !recents.length && !pinned.length && !folders.length && !notes.length) {
      root.createDiv({ cls: 'dr-split-empty', text: 'Nothing here yet' });
    }
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
    return notes
      .filter((f) => !seen.has(f.path) && now - f.stat.mtime > 30 * day)
      .map((f) => ({ file: f, order: stableHash(`${today}:${f.path}`) }))
      .sort((a, b) => a.order - b.order)
      .slice(0, 13)
      .map((x) => x.file);
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
function stableHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Screens you start from, rather than arrive at. */
const ROOT_MODES = ['home', 'search'];

/* Which screen a mode draws. */
const BROWSE_SCREENS = {
  home: HomeScreen,
  search: SearchScreen,
  folder: FolderScreen,
  folders: FoldersScreen,
  notes: NotesScreen,
  properties: PropertiesScreen,
  property: PropertiesScreen,
  recents: CollectionScreen,
  pinned: CollectionScreen,
};

