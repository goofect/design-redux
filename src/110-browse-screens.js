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
      const folders = view.sortFolders(
        subfolders.filter((c) => view.folderInFilter(c)).filter((c) => view.matches(c.name))
      );
      if (!folders.length) {
        root.createDiv({ cls: 'dr-empty', text: 'No folders' });
        return;
      }
      const grid = root.createDiv({ cls: 'dr-grid' });
      roveFocus(grid, '.dr-card');
      folders.forEach((f) => view.folderCard(grid, f));
      return;
    }

    const discs = view.discsOf(folder, view.notesIn(folder));
    const all = discs.reduce((acc, d) => acc.concat(d.files), []);

    view.renderHeader(root, folder, all);
    if (!all.length && !view.editing) {
      root.createDiv({ cls: 'dr-empty', text: 'Nothing here' });
      view.renderMoreIn(root, folder);
      return;
    }
    view.renderDiscs(root, discs, folder);
    if (view.editing) return;
    view.renderAlbumFoot(root, all);
    view.renderMoreIn(root, folder);
  }

}

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
      root.createDiv({ cls: 'dr-empty', text: 'No folders' });
      return;
    }

    const grid = root.createDiv({ cls: 'dr-grid' });
    roveFocus(grid, '.dr-card');
    shown.forEach((f) => view.folderCard(grid, f, f.parent && f.parent.name));
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
      root.createDiv({ cls: 'dr-empty', text: 'No notes' });
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
    if (!props.length) {
      root.createDiv({ cls: 'dr-empty', text: 'No properties' });
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
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

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

  /** A property's own menu, from its row or its heading: rename it everywhere. */
  propertyMenu(evt, name) {
    const bulk = this.plugin.feature(BulkEditing);
    if (!bulk) return;
    evt.preventDefault();
    const menu = new Menu();
    const root = this.app.vault.getRoot();
    [
      ['Rename everywhere…', 'pencil', () => bulk.openRenameProperty(name)],
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
      root.createDiv({
        cls: 'dr-empty',
        text: this.pinned ? 'Nothing pinned yet' : 'Nothing opened yet',
      });
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
      clear.setAttribute('role', 'button');
      clear.setAttribute('tabindex', '0');
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
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

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
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

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
    full.setAttribute('role', 'button');
    full.setAttribute('tabindex', '0');
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
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${caption}: ${file.basename}`);
      card.createDiv({ cls: 'dr-pick-caption', text: caption });

      const body = card.createDiv({ cls: 'dr-pick-body' });
      const glow = body.createDiv({ cls: 'dr-pick-glow' });
      drawNoteArt(this.plugin, glow, file);
      // White type on the cover's colours; a plain icon has none to give.
      body.toggleClass('is-lit', !!(glow.querySelector('img') || glow.hasClass('is-generated') || glow.hasClass('is-hued')));
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

