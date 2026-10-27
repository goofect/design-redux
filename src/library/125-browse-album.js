/* ------------------------------------------------------------------ */
/* The browse view: an album's page                                    */
/*                                                                     */
/* How an album is laid out: its head, discs of notes, the limits and  */
/* "more" rows, PDFs, and where things can be dropped. A part of the   */
/* view: BrowseView extends it.                                        */
/* ------------------------------------------------------------------ */

import { Platform, setIcon, TFile, TFolder } from 'obsidian';
import { blankLook, byName, drawFolderArt, onContextMenu } from '../core/030-helpers-art.js';
import { asButton, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { nestByProperty } from '../core/045-helpers-properties.js';
import { readingOf } from '../core/075-reading.js';
import { studyReady } from '../core/081-study.js';
import { ROOT_MODES } from './119-browse-registry.js';
import { BrowsePreview } from './124-browse-preview.js';
import { drIconButton, drMenu, isAppleLook } from '../ui/229-components.js';
import { AlbumStructure } from './257-album-structure.js';

export class BrowseAlbum extends BrowsePreview {
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
    const list = root.createDiv({ cls: 'dr-tracks' });
    roveFocus(list, '.dr-track, .dr-disc[role="button"]');
    // Discs are folders, so dragging a note onto one moves it there; onto
    // a row of its own disc, it goes there in the album's order.
    if (!Platform.isMobile && !this.editing) this.acceptDrops(list);

    // PDFs aren't notes in the album's order: they wait at the end, in a list of their own, unnumbered.
    const pdfs = [];
    if (!this.editing) {
      discs = discs
        .map((disc) => {
          const notes = disc.files.filter((f) => f.extension !== 'pdf');
          disc.files.forEach((f) => f.extension === 'pdf' && pdfs.push(f));
          return notes.length === disc.files.length ? disc : Object.assign({}, disc, { files: notes });
        })
        .filter((disc) => disc.files.length);
    }

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
    if (pdfs.length) this.renderPdfs(root, pdfs, album);
    // After the notes, so at the end it sits below the last of them rather than over it.
    if (this.editing && this.mode === 'folder') this.renderBulkBar(root);
  }

  /** A folder's PDFs: under their own heading, after its notes, each a row without a number. */
  renderPdfs(root, pdfs, album) {
    const list = root.createDiv({ cls: 'dr-tracks dr-pdf-list' });
    roveFocus(list, '.dr-track');
    const head = list.createDiv({ cls: 'dr-disc' });
    head.createSpan({ cls: 'dr-disc-title', text: 'PDFs' });
    head.createSpan({ cls: 'dr-disc-count', text: pdfs.length === 1 ? '1 PDF' : `${pdfs.length} PDFs` });
    const key = `pdfs:${album ? album.path : ''}`;
    const limit = this.limitFrom('discNoteLimit', 10);
    const shown = this.expanded.has(key) ? pdfs : pdfs.slice(0, limit);
    shown.forEach((file) => this.trackRow(list, file, '').addClass('is-unnumbered'));
    if (pdfs.length > limit) this.renderMoreRow(list, key, pdfs.length, 'PDFs');
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
        const crumbs = kicker.createEl('nav', { cls: 'dr-crumbs', attr: { 'aria-label': 'Where this collection is' } });
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
    if (subs) meta.push(subs === 1 ? '1 sub-collection' : `${subs} sub-collections`);
    // How long the album is, as an album gives its running time.
    const length = this.totalLength(files);
    if (length) meta.push(length);
    const newest = files.reduce((t, f) => Math.max(t, f.stat.mtime), 0);
    if (newest) meta.push(`Updated ${this.relative(newest)}`);
    const progress = about ? structure.progress(about, files) : null;
    if (progress) meta.push(`${progress.done} of ${progress.total} ${progress.word}`);
    // What its notes come to, as settings ask: the done count unless progress has said it, a date property's span.
    const rolled = folder && structure ? structure.rollupText(structure.rollup(files), !progress) : '';
    if (rolled) meta.push(rolled);
    // How far through it you are, once you've read any of it.
    else if (folder && this.plugin.settings.readingHistory) {
      const notes = files.filter((f) => f.extension === 'md');
      const read = readingOf(this.plugin).countRead(notes);
      if (read) meta.push(`${read} of ${notes.length} read`);
    }
    // Studied: when you last sat down with it.
    const studied = folder && studyReady(this.plugin) ? this.plugin.study.lastSession(folder) : null;
    if (studied) meta.push(`Last studied ${this.relative(studied.endedAt)}`);
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
    const random = () => {
      if (!files.length) return;
      const pick = files[Math.floor(Math.random() * files.length)];
      this.app.workspace.getLeaf(false).openFile(pick);
    };
    const map = about && about.type === 'concept map' ? () => structure.openMap(folder) : null;
    // The Apple look: one filled button, Edit in plain text, the rest under an icon-only More.
    if (isAppleLook()) {
      if (folder) this.action(actions, 'pencil', 'Edit', () => this.setEditing(true));
      const more = [{ title: 'Random', icon: 'shuffle', run: random }];
      if (map) more.push({ title: 'Map', icon: 'waypoints', run: map });
      drIconButton(actions, 'more-horizontal', 'More', (evt) => drMenu(evt, more)).addClass('dr-detail-more');
      return;
    }
    this.action(actions, 'shuffle', 'Random', random);
    if (map) this.action(actions, 'waypoints', 'Map', map);
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
}
