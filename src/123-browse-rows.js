/* ------------------------------------------------------------------ */
/* Browse view: the list, shelves and cards                           */
/*                                                                    */
/* Rows of notes with their lengths and marks, shelves of albums, and */
/* cards. Methods of BrowseView, put on by mixInto.                   */
/* ------------------------------------------------------------------ */

class BrowseRows {
  /* -- the list --------------------------------------------------- */

  trackRow(list, file, index) {
    const row = list.createDiv({ cls: 'dr-track' });
    asButton(row);

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

  /** The names of the columns, above the rows, which then keep them lined up. */
  trackHead(list) {
    list.addClass('has-head');
    const head = list.createDiv({ cls: 'dr-track-head' });
    head.createDiv({ cls: 'dr-track-num', text: '#' });
    head.createDiv({ cls: 'dr-track-name', text: 'Title' });
    this.albumColumns().forEach((key) =>
      head.createDiv({ cls: this.isTimeColumn(key) ? 'dr-track-time' : 'dr-track-sub', text: this.isTimeColumn(key) || key === 'folder' ? key.charAt(0).toUpperCase() + key.slice(1) : this.columnLabel(key) })
    );
    const style = this.lengthStyle();
    if (style) head.createDiv({ cls: `dr-track-length${style === 'words' ? ' is-words' : ''}`, text: style === 'words' ? 'Words' : 'Length' });
    // As wide as a row's More, unseen, so the columns end where theirs do.
    const spacer = head.createDiv({ cls: 'clickable-icon dr-track-more', attr: { 'aria-hidden': 'true' } });
    setIcon(spacer, 'ellipsis');
    return head;
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
    const fm = noteProps(this.app, file);
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
      asButton(label);
      label.addClass('is-linked');
      onActivate(label, through);
    }
    label.createSpan({ cls: 'dr-shelf-title', text: title });
    if (through) setIcon(label.createSpan({ cls: 'dr-shelf-more' }), 'chevron-right');

    const row = root.createDiv({ cls: 'dr-shelf-row' });
    roveFocus(row, '.dr-card');
    // A folder, a note, a note with a line of its own ({ file, subtitle,
    // progress }), or a tile drawn by the screen ({ draw }).
    items.forEach((item) => {
      if (item instanceof TFolder) view.folderCard(row, item);
      else if (item.draw) item.draw(row);
      else if (item.file) view.fileCard(row, item.file, item.subtitle, item.progress);
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
  fileCard(grid, file, subtitle, progress) {
    const card = this.card(
      grid,
      file.basename,
      subtitle || (file.parent && file.parent.path !== '/' ? file.parent.name : '')
    );
    card.dataset.path = file.path;
    const art = card.querySelector('.dr-card-art');
    drawNoteArt(this.plugin, art, file);
    // How far along its album: a thin bar along the cover's foot.
    if (progress > 0) art.createDiv({ cls: 'dr-card-progress' }).style.setProperty('--dr-progress', Math.min(1, progress).toFixed(4));
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

  /** A smart album's tile: drawn as the covers are, for its name; opens the album. */
  smartCard(grid, album) {
    const card = this.card(grid, album.name, 'Smart album');
    const key = `smart:${album.id}`;
    fillArt(card.querySelector('.dr-card-art'), null, 'sparkles', coverGen(this.plugin.settings, album.name, key), blankLook(this.plugin.settings, album.name, key));
    onActivate(card, () => this.navigate({ mode: 'smart', property: album.id, path: '/' }));
    return card;
  }

  card(grid, title, subtitle) {
    const card = grid.createDiv({ cls: 'dr-card' });
    asButton(card);
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

mixInto(BrowseView, BrowseRows);
