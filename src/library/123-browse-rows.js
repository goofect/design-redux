/* ------------------------------------------------------------------ */
/* Browse view: the list, shelves and cards                           */
/*                                                                    */
/* Rows of notes with their marks, shelves of albums, and              */
/* cards. A part of BrowseView (see 120).                             */
/* ------------------------------------------------------------------ */

import { Platform, setIcon, TFolder } from 'obsidian';
import { blankLook, coverGen, drawFolderArt, drawNoteArt, fillArt, leadProperty, noteCoverSrc } from '../core/030-art.js';
import { onContextMenu } from '../core/036-menus.js';
import { byName } from '../core/040-sorting.js';
import { asButton, onActivate, roveFocus } from '../core/042-controls.js';
import { noteExcerpt, relativeDay } from '../core/047-helpers-text.js';
import { libraryIndex } from '../core/077-library-index.js';
import { ask } from '../core/081-capabilities.js';
import { RowValues } from './122-browse-editing.js';
import { paintValue } from '../ui/248-value-options.js';

export class BrowseRows extends RowValues {
  /* -- the list --------------------------------------------------- */

  trackRow(list, file, index, nest) {
    const row = list.createDiv({ cls: 'dr-track' });
    asButton(row);
    if (nest && nest.depth) {
      row.addClass('is-nested');
      row.style.setProperty('--dr-nest', String(nest.depth));
    }

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
    if (nest && nest.children) {
      // A parent's notes fold away under it, and open again.
      const folded = this.foldedNotes && this.foldedNotes.has(file.path);
      const toggle = name.createSpan({ cls: 'dr-track-fold clickable-icon' });
      toggle.setAttribute('aria-label', folded ? `Show the ${nest.children} under it` : 'Fold away what’s under it');
      setIcon(toggle, folded ? 'chevron-right' : 'chevron-down');
      toggle.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (!this.foldedNotes) this.foldedNotes = new Set();
        if (folded) this.foldedNotes.delete(file.path);
        else this.foldedNotes.add(file.path);
        this.render();
      });
    }
    if (this.isPinned(file)) {
      // Pinned is this list's favourite: a mark beside the title.
      name.addClass('has-mark');
      name.createSpan({ cls: 'dr-track-title', text: file.basename });
      const pin = name.createSpan({ cls: 'dr-track-pin' });
      pin.setAttribute('aria-label', 'Pinned');
      setIcon(pin, 'pin');
    } else if (nest && nest.children) {
      name.createSpan({ cls: 'dr-track-title', text: file.basename });
    } else {
      name.setText(file.basename);
    }

    // In search, the grey line says why it matched instead.
    const why = this.mode === 'search' && this.searchWhy ? this.searchWhy.get(file.path) : null;
    if (why) {
      name.dataset.excerpt = why;
      name.addClass('has-excerpt');
      name.addClass('is-why');
    } else if (this.plugin.settings.albumExcerpts !== false) this.showExcerpt(name, file);

    this.albumColumns().forEach((key) => {
      const text = this.columnValue(file, key);
      const cell = row.createDiv({ cls: this.isTimeColumn(key) ? 'dr-track-time' : 'dr-track-sub', text });
      // A value with a colour or an icon of its own shows them.
      if (text && !this.isTimeColumn(key)) {
        paintValue(cell, this.plugin, key, text);
      }
      // A property's value changed where it's shown.
      if (this.plugin.settings.propertyInlineEdit && file.extension === 'md' && !this.isTimeColumn(key) && key !== 'folder') this.editableCell(cell, file, key);
    });

    const more = row.createDiv({ cls: 'clickable-icon dr-track-more' });
    more.setAttribute('aria-label', 'More');
    setIcon(more, 'ellipsis');

    more.addEventListener('click', (evt) => this.fileMenu(evt, file));
    onContextMenu(row, (evt) => this.fileMenu(evt, file));
    this.pickOrOpen(row, { file }, (evt) => this.openFile(file, evt), false);
    return row;
  }

  /**
   * A short grey line under a note's title: its description, or its
   * first sentence — read once, and again only when the note changes.
   * Drawn by the styles from an attribute, so the title's text is only
   * the title.
   */
  showExcerpt(el, file) {
    const put = (text) => {
      if (text) el.dataset.excerpt = text;
      else delete el.dataset.excerpt;
      el.toggleClass('has-excerpt', !!text);
    };
    noteExcerpt(this.plugin, file, put, el);
  }

  /**
   * What a click on a row or tile does: opens it — or, while the preview
   * shows, picks it, and a double click or Enter opens it. With Ctrl,
   * Cmd or Shift, a click always opens.
   */
  pickOrOpen(el, item, open, space = true) {
    const selection = this.plugin.selection;
    if (!selection) {
      onActivate(el, open, space);
      return;
    }
    if (selection.holds(item.file || item.folder)) el.addClass('is-selected');
    onActivate(el, (evt) => {
      if (evt.type === 'click' && !evt.ctrlKey && !evt.metaKey && !evt.shiftKey && this.clickPicks()) selection.set(item);
      else open(evt);
    }, space);
    el.addEventListener('dblclick', (evt) => {
      if (this.clickPicks()) open(evt);
    });
    // Moving through a list with the arrow keys moves what's picked.
    el.addEventListener('focus', () => {
      if (this.clickPicks()) selection.set(item);
    });
  }

  /** What's picked, marked: the rows and tiles that stand for it. */
  markPicked() {
    const item = this.plugin.selection && this.plugin.selection.get();
    const target = item && (item.file || item.folder);
    this.contentEl.querySelectorAll('.dr-track[data-path], .dr-tr[data-path], .dr-card[data-path]').forEach((el) => el.toggleClass('is-selected', !!target && el.dataset.path === target.path));
  }

  /**
   * What each album row shows after the title, from settings. Property
   * names, plus three that aren't properties: modified, created and
   * folder.
   */
  albumColumns() {
    // Nested by a property, the nesting says it: no column for it.
    const nest = String(this.plugin.settings.albumNestBy || '').trim().toLowerCase();
    return (this.plugin.settings.albumColumns || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k && k.toLowerCase() !== nest);
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

  /* -- marks ------------------------------------------------------ */

  /** What one drawing works out once, forgotten before the next. */
  beginDrawing() {
    this.pinMemo = null;
  }

  /**
   * The end of an album, as the reference ends one: when it began, and
   * how much there is — small, under the last track.
   */
  /**
   * The names the album's notes link to that are no note yet, most
   * linked first: [{ name, count }].
   */
  stillToWrite(folder, files) {
    const links = (this.app.metadataCache && this.app.metadataCache.unresolvedLinks) || {};
    const from = files.slice();
    const own = this.plugin.folderNote(folder);
    if (own) from.push(own);
    const counts = new Map();
    from.forEach((f) =>
      Object.keys(links[f.path] || {}).forEach((text) => {
        const name = text.split('/').pop().replace(/\.md$/i, '').trim();
        // A missing image or other file is no note to write.
        if (!name || /\.[a-z0-9]{1,5}$/i.test(name)) return;
        counts.set(name, (counts.get(name) || 0) + links[f.path][text]);
      })
    );
    return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || byName(a.name, b.name));
  }

  /**
   * At the foot of an album's notes: what its notes link to that's not
   * written yet, greyed — a click writes it here — and a row for a new
   * note.
   */
  renderAlbumEnd(root, folder, files) {
    if (!folder || (folder.isRoot && folder.isRoot())) return;
    const list = root.createDiv({ cls: 'dr-tracks dr-album-end' });
    const missing = this.plugin.settings.albumStillToWrite === false ? [] : this.stillToWrite(folder, files);
    const cap = 12;
    if (missing.length) {
      const head = list.createDiv({ cls: 'dr-disc dr-still-head' });
      head.createSpan({ cls: 'dr-disc-title', text: 'Still to write' });
      head.createSpan({ cls: 'dr-disc-count', text: missing.length === 1 ? '1 note' : `${missing.length} notes` });
      missing.slice(0, cap).forEach((m) => {
        const row = list.createDiv({ cls: 'dr-end-row is-unwritten' });
        asButton(row, `Write “${m.name}” here`);
        row.createDiv({ cls: 'dr-track-num' });
        row.createDiv({ cls: 'dr-track-name', text: m.name });
        row.createDiv({ cls: 'dr-track-time', text: m.count === 1 ? '1 link' : `${m.count} links` });
        onActivate(row, () => this.plugin.newNote(folder, m.name));
      });
      if (missing.length > cap) list.createDiv({ cls: 'dr-end-row is-unwritten dr-more-label', text: `And ${missing.length - cap} more` });
    }
    const add = list.createDiv({ cls: 'dr-end-row dr-new-note-row' });
    asButton(add, 'New note');
    setIcon(add.createDiv({ cls: 'dr-track-num' }), 'plus');
    add.createDiv({ cls: 'dr-track-name', text: 'New note' });
    onActivate(add, () => this.plugin.newNote(folder));
  }

  renderAlbumFoot(root, files, opts = {}) {
    if (!files.length) return;
    const first = files.reduce((t, f) => Math.min(t, f.stat.ctime || Infinity), Infinity);
    const foot = root.createDiv({ cls: 'dr-album-foot' });
    if (Number.isFinite(first) && first > 0) {
      foot.createDiv({
        text: `Started ${new Date(first).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`,
      });
    }
    // The count, where the header's isn't the whole of it: an album with discs.
    if (opts.count === false) return;
    foot.createDiv({ text: files.length === 1 ? '1 note' : `${files.length} notes` });
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
      else if (item.file) view.fileCard(row, item.file, item.subtitle);
      else view.fileCard(row, item);
    });
    this.arrows(head, row);
  }

  /** ‹ and ›, paging a shelf that runs past the edge. Swiped on touch instead. */
  arrows(head, row) {
    const arrows = head.createDiv({ cls: 'dr-shelf-arrows' });
    const button = (icon, label, dir) => {
      const el = arrows.createDiv({ cls: 'clickable-icon dr-shelf-arrow' });
      asButton(el, label);
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
    const structure = ask(this.plugin, 'albums');
    const kind = structure ? structure.info(folder).label : '';
    if (kind) {
      const label = card.ownerDocument.createElement('div');
      label.className = 'dr-card-kind';
      label.textContent = kind;
      card.insertBefore(label, card.querySelector('.dr-card-title'));
    }
    const src = this.folderCover(folder);
    drawFolderArt(this.plugin, card.querySelector('.dr-card-art'), folder);
    // On the cover, when pointed at: its menu, as a tile offers More.
    this.cardButtons(card, (evt) => this.folderMenu(evt, folder, src));

    this.pickOrOpen(card, { folder }, () => this.openFolder(folder));
    onContextMenu(card, (evt) => this.folderMenu(evt, folder, src));
  }

  /** A single file as a tile: its cover, or an icon for its type. */
  fileCard(grid, file, subtitle) {
    const card = this.card(
      grid,
      file.basename,
      subtitle || (file.parent && file.parent.path !== '/' ? file.parent.name : '')
    );
    card.dataset.path = file.path;
    const art = card.querySelector('.dr-card-art');
    drawNoteArt(this.plugin, art, file);
    this.cardButtons(card, (evt) => this.fileMenu(evt, file));

    this.pickOrOpen(card, { file }, (evt) => this.openFile(file, evt));
    onContextMenu(card, (evt) => this.fileMenu(evt, file));
  }

  /**
   * A round More button over a tile's cover, shown when it's pointed at.
   * Its clicks are its own, not the tile's.
   */
  cardButtons(card, menu) {
    const art = card.querySelector('.dr-card-art');
    if (!art) return;
    const bar = art.createDiv({ cls: 'dr-card-buttons' });
    const button = (icon, label, run, cls) => {
      const el = bar.createDiv({ cls: `dr-card-button ${cls}` });
      asButton(el, label);
      el.setAttribute('tabindex', '-1');
      setIcon(el, icon);
      onActivate(el, (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        run(evt);
      });
    };
    if (menu) button('ellipsis', 'More', menu, 'is-more');
  }

  /** A smart album's tile: drawn as the covers are, for its name; opens the album. */
  smartCard(grid, album) {
    const card = this.card(grid, album.name, 'Saved view');
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
    const n = libraryIndex(this.plugin).count(folder);
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
