/* ------------------------------------------------------------------ */
/* The browse view: an album's page                                    */
/*                                                                     */
/* How an album is laid out: its head, discs of notes, the limits and  */
/* "more" rows, PDFs, and where things can be dropped. A part of the   */
/* view: BrowseView extends it.                                        */
/* ------------------------------------------------------------------ */

import { Platform, setIcon, TFile, TFolder } from 'obsidian';
import { blankLook, drawFolderArt } from '../core/030-art.js';
import { onContextMenu } from '../core/036-menus.js';
import { byName } from '../core/040-sorting.js';
import { asButton, onActivate, roveFocus } from '../core/042-controls.js';
import { nestByProperty } from '../core/045-helpers-properties.js';
import { ask } from '../core/081-capabilities.js';
import { ROOT_MODES } from './119-browse-registry.js';
import { BrowsePreview } from './124-browse-preview.js';
import { drIconButton, drMenu, isAppleLook } from '../ui/229-components.js';

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
    if (this.editing && this.mode === 'folder') this.renderBulkBar(root);
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
   * The cover, and beside it, from the top: the title, its kind, what its
   * notes come to, its description. Shared by folders and by the
   * collections — recents, pins, a property's value — which have no
   * folder behind them: they keep their count line and a Random. A
   * folder's own counts and ways in are under Options in the bar.
   */
  renderAlbumHead(root, spec) {
    const head = root.createDiv({ cls: 'dr-detail' });
    const folder = spec.folder || null;
    const editing = !!folder && !!this.editing;
    head.toggleClass('is-editing', editing);

    const art = head.createDiv({ cls: 'dr-detail-art' });
    if (folder) drawFolderArt(this.plugin, art, folder);
    else this.fillArt(art, spec.cover, spec.glyph || 'folder', spec.genName, blankLook(this.plugin.settings, spec.title));
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
    // Above the title, small: the way down to it.
    const structure = folder ? ask(this.plugin, 'albums') : null;
    const about = structure ? structure.info(folder) : null;
    const trail = structure && structure.enabled ? structure.trail(folder) : [];
    if (trail.length) {
      const kicker = info.createDiv({ cls: 'dr-detail-kicker' });
      const crumbs = kicker.createEl('nav', { cls: 'dr-crumbs', attr: { 'aria-label': 'Where this collection is' } });
      trail.forEach((f, i) => {
        if (i) crumbs.createSpan({ cls: 'dr-crumb-sep', text: '›' });
        const crumb = crumbs.createSpan({ cls: 'dr-crumb', text: f.name });
        asButton(crumb);
        onActivate(crumb, () => this.openFolder(f));
      });
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
    // Under the title, muted: what kind of album it is. The vault itself is the library, at the top of everything.
    const kind = about && about.label ? about.label : structure && structure.enabled && folder.isRoot && folder.isRoot() ? 'Library' : '';
    if (kind) info.createDiv({ cls: 'dr-detail-kind', text: kind });
    // The accented line, as the artist is: the folder note's own lead
    // property, or else the folder this one is in — which it opens, as
    // the artist's name does.
    const parent = folder && folder.parent && !(folder.isRoot && folder.isRoot()) ? folder.parent : null;
    if (spec.sub) {
      info.createDiv({ cls: 'dr-detail-sub', text: spec.sub });
    } else if (parent && !(parent.isRoot && parent.isRoot()) && !trail.length) {
      const up = info.createDiv({ cls: 'dr-detail-sub is-link', text: parent.name });
      asButton(up);
      onActivate(up, () => this.openFolder(parent));
    }

    const files = spec.files || [];
    // A folder's: what its notes come to. A collection's: its count line, as before.
    const props = folder ? this.albumRollups(folder, files) : [];
    if (props.length) info.createDiv({ cls: 'dr-detail-props', text: props.join('  ·  ') });
    if (!folder) info.createDiv({ cls: 'dr-detail-meta', text: this.albumStats(files).map((s) => s[1]).join('  ·  ') });
    if (about && about.description) info.createDiv({ cls: 'dr-detail-desc', text: about.description });

    if (editing) {
      const actions = info.createDiv({ cls: 'dr-detail-actions' });
      this.action(actions, 'check', 'Done', () => this.setEditing(false)).addClass('is-primary');
      this.action(actions, 'file-plus', 'New note', () => this.editNewNote(folder));
      this.action(actions, 'folder-plus', 'New folder', () => this.editNewFolder(folder));
      return;
    }
    if (folder) return;
    const actions = info.createDiv({ cls: 'dr-detail-actions' });
    // The Apple look: Random under an icon-only More.
    if (isAppleLook()) {
      const more = [{ title: 'Random', icon: 'shuffle', run: () => this.openRandom(files) }];
      drIconButton(actions, 'more-horizontal', 'More', (evt) => drMenu(evt, more)).addClass('dr-detail-more');
      return;
    }
    this.action(actions, 'shuffle', 'Random', () => this.openRandom(files));
  }

  /** One of these notes, any of them. */
  openRandom(files) {
    if (!files.length) return;
    const pick = files[Math.floor(Math.random() * files.length)];
    this.app.workspace.getLeaf(false).openFile(pick);
  }

  /** What a folder's notes come to, as settings ask: how many done, a date property's span. [text] */
  albumRollups(folder, files) {
    const structure = ask(this.plugin, 'albums');
    if (!structure) return [];
    const out = [];
    const progress = structure.progress(structure.info(folder), files);
    if (progress) out.push(`${progress.done} of ${progress.total} ${progress.word}`);
    // The done count unless progress has said it.
    const rolled = structure.rollupText(structure.rollup(files), !progress);
    if (rolled) out.push(rolled);
    return out;
  }

  /** What there is to say of some notes: [[icon, text]] — how many, when started (if asked), when last changed. */
  albumStats(files, opts = {}) {
    const notes = files.every((f) => f.extension === 'md');
    const out = [['files', files.length === 1 ? (notes ? '1 note' : '1 item') : `${files.length} ${notes ? 'notes' : 'items'}`]];
    const first = files.reduce((t, f) => Math.min(t, f.stat.ctime || Infinity), Infinity);
    if (opts.started && Number.isFinite(first) && first > 0) {
      out.push(['calendar-plus', `Started ${new Date(first).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`]);
    }
    const newest = files.reduce((t, f) => Math.max(t, f.stat.mtime), 0);
    if (newest) out.push(['clock', `Updated ${this.relative(newest)}`]);
    return out;
  }

  /** Every note of an album, Find and filters aside: its own, its subfolders', and those it shows from elsewhere. */
  albumNotes(folder) {
    const out = [];
    const walk = (f) => {
      this.allNotesIn(f).forEach((file) => out.push(file));
      this.visibleFolders(f).forEach(walk);
    };
    walk(folder);
    const structure = ask(this.plugin, 'albums');
    return structure ? out.concat(structure.included(folder, out)) : out;
  }

  /** In the bar of an album's page: Edit, which starts and ends editing. */
  renderEditIcon(bar) {
    const btn = bar.createDiv({ cls: 'clickable-icon dr-bar-icon dr-edit-btn' });
    asButton(btn, 'Edit');
    setIcon(btn, 'pencil');
    btn.toggleClass('is-active', !!this.editing);
    btn.setAttribute('aria-pressed', String(!!this.editing));
    onActivate(btn, () => this.setEditing(!this.editing));
  }

  /** In the bar of an album's page: Options, the folder's menu and what's known of it. */
  renderOptionsIcon(bar, folder) {
    const btn = bar.createDiv({ cls: 'clickable-icon dr-bar-icon dr-options-btn' });
    asButton(btn, 'Options');
    setIcon(btn, 'sliders-horizontal');
    onActivate(btn, (evt) => this.albumOptions(evt, folder));
  }

  /**
   * The folder's own menu — what its cover's menu offers — with a random
   * note, then, greyed, what's known of it: how many notes, when started
   * and last changed, what they come to — of the whole album, Find and
   * filters aside; while they narrow it, how many are shown. Random picks
   * among the notes last drawn on its page.
   */
  albumOptions(evt, folder) {
    const shown = this.headFiles && this.headFiles.folder === folder ? this.headFiles.files : [];
    const files = this.albumNotes(folder);
    this.folderMenu(evt, folder, this.folderCover(folder), {
      here: true,
      extra: (menu, sectioned) => {
        if (shown.length) {
          menu.addItem((item) => sectioned(item, 'open').setTitle('Random note').setIcon('shuffle').onClick(() => this.openRandom(shown)));
        }
        const facts = this.albumStats(files, { started: true }).concat(this.albumRollups(folder, files).map((t) => ['circle-check', t]));
        if (this.query.trim() || this.hasFilters()) facts.splice(1, 0, ['filter', `${shown.length} shown`]);
        facts.forEach(([icon, text]) =>
          menu.addItem((item) => {
            sectioned(item, 'info').setTitle(text).setIcon(icon);
            if (typeof item.setDisabled === 'function') item.setDisabled(true);
          })
        );
      },
    });
  }

  renderHeader(root, folder, files) {
    // The notes as drawn — discs concatenated, each sorted — for Options to count.
    this.headFiles = { folder, files };
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    this.renderSidebarToggle(bar);
    this.renderNav(bar);
    this.renderSearchField(bar, { album: folder });
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
      // The folder note stands for the folder rather than being part of its contents.
      files: files,
      onArtMenu: (evt) => this.folderMenu(evt, folder, src, { here: true }),
    });
  }
}
