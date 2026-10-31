/* ------------------------------------------------------------------ */
/* Browse view: editing an album                                      */
/*                                                                    */
/* Edit mode (rename, move, delete, add, arrange by drag) and pins in */
/* your own order. A part of BrowseView (see 120).                    */
/* ------------------------------------------------------------------ */

import { Menu, normalizePath, Notice, Platform, setIcon, TFile } from 'obsidian';
import { byName, composing, coverGen, drawNoteArt, showMenuAt } from '../core/030-helpers-art.js';
import { asButton, edgeScroll, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { fmGet, plainValue, typeOfProperty } from '../core/045-helpers-properties.js';
import { moveBefore } from '../core/070-orders.js';
import { noteProps } from '../core/073-notes.js';
import { schemaFor } from '../core/086-property-schema.js';
import { BulkSelection } from './118-bulk-selection.js';
import { BrowseSorting } from './121-browse-sorting.js';
import { Library } from './130-browse-filters.js';
import { ConfirmModal, FolderPicker, NamePrompt } from '../ui/230-pickers.js';
import { markDue, paintValue } from '../ui/248-value-options.js';
import { PropertyClipboard } from '../ui/250-property-clipboard.js';
import { AlbumStructure } from './257-album-structure.js';

/* A shelf's tiles drawn at once, and then a frame at a time. */
export const TILES_AT_ONCE = 60;
export const TILES_A_FRAME = 120;

export class BrowseEditing extends BrowseSorting {
  /* -- editing an album -------------------------------------------- */

  /**
   * What a cover is made from, while generated covers are on: the name,
   * and the colour chosen for the path, if any.
   */
  genName(name, path) {
    return coverGen(this.plugin.settings, name, path);
  }

  setEditing(on) {
    this.editing = !!on;
    if (!on && this.bulkSelection) this.bulkSelection.clear();
    this.render();
    if (!on) return;
    const first = this.contentEl.querySelector('.dr-detail-title.dr-edit-name, .dr-track .dr-edit-name');
    if (first && !Platform.isMobile) first.focus();
  }

  /**
   * A field that changes a name: Enter or leaving it saves, Escape puts
   * it back. Only a real change is saved.
   */
  editField(input, original, commit, opts = {}) {
    let settled = false;
    const finish = (keep, entered) => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      // Enter on a name left as it was can still ask for something:
      // a property written other ways in some notes, made one.
      if (keep && entered && value === original && opts.enterSame) {
        opts.enterSame(value);
        return;
      }
      if (!keep || !value || value === original) {
        input.value = original;
        return;
      }
      commit(value);
    };
    input.addEventListener('focus', () => {
      settled = false;
    });
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter') {
        evt.preventDefault();
        finish(true, true);
        input.blur();
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      finish(true);
      // Anything that changed while this was being typed in is drawn now.
      if (this.renderAfterEdit) {
        this.renderAfterEdit = false;
        this.queueRender();
      }
    });
  }

  /**
   * Rename a note or folder where it is. Links to it are rewritten, as
   * Obsidian's own rename does, and a name that's taken or can't be a
   * file name is refused with the reason.
   */
  async renameEntry(entry, name) {
    if (/[\\/:*?"<>|#^[\]]/.test(name)) {
      new Notice('A name can’t contain \\ / : * ? " < > | # ^ [ or ].');
      this.render();
      return false;
    }
    const dir = entry.parent && entry.parent.path !== '/' ? entry.parent.path + '/' : '';
    const target = normalizePath(dir + (entry instanceof TFile ? `${name}.${entry.extension}` : name));
    if (target === entry.path) return false;
    const taken = this.app.vault.getAbstractFileByPath(target);
    if (taken && taken !== entry) {
      new Notice(`There’s already something called “${name}” here.`);
      this.render();
      return false;
    }
    const oldPath = entry.path;
    const oldName = entry instanceof TFile ? entry.basename : entry.name;
    try {
      await this.app.fileManager.renameFile(entry, target);
    } catch (err) {
      console.error('Design Redux: could not rename', err);
      new Notice(`Could not rename “${entry.name}”.`);
      this.render();
      return false;
    }
    this.plugin.offerUndo(`Renamed “${oldName}” to “${name}”.`, () => this.plugin.putBack(entry, oldPath));
    return true;
  }

  /** Delete the way Obsidian does: its confirmation, and its trash setting. */
  async deleteEntry(entry) {
    const fm = this.app.fileManager;
    try {
      const confirmed = typeof fm.promptForDeletion === 'function' ? await fm.promptForDeletion(entry) : true;
      if (!confirmed) return false;
      // The prompt may have deleted it already; if not, it goes to the trash.
      if (this.app.vault.getAbstractFileByPath(entry.path) === entry) await fm.trashFile(entry);
      return true;
    } catch (err) {
      console.error('Design Redux: could not delete', err);
      new Notice(`Could not delete “${entry.name}”.`);
      return false;
    }
  }

  /** A row being edited: a handle to drag, the name to change, move and delete. */
  editRow(list, file, index) {
    const row = list.createDiv({ cls: 'dr-track is-editing' });
    row.dataset.path = file.path;
    if (file.parent) row.dataset.folder = file.parent.path;
    this.tickBox(row, file, list);

    const grip = row.createDiv({ cls: 'dr-edit-grip' });
    setIcon(grip, 'grip-vertical');
    asButton(grip, `Move “${file.basename}” — drag, or Alt+↑ and Alt+↓`);

    row.createDiv({ cls: 'dr-track-num', text: String(index) });
    const name = row.createEl('input', { cls: 'dr-track-name dr-edit-name', type: 'text' });
    name.value = file.basename;
    name.dataset.editPath = file.path;
    name.setAttribute('aria-label', 'Note name');
    this.editField(name, file.basename, (value) => this.renameEntry(file, value));

    const tools = row.createDiv({ cls: 'dr-edit-tools' });
    const tool = (icon, label, run, cls) => {
      const el = tools.createDiv({ cls: `clickable-icon dr-edit-tool ${cls || ''}`.trim() });
      asButton(el, label);
      setIcon(el, icon);
      onActivate(el, run);
    };
    tool('folder-input', 'Move to another folder', () =>
      new FolderPicker(this.app, (folder) => this.plugin.moveFile(file, folder.path, { announce: true })).open()
    );
    tool('trash-2', 'Delete', () => this.deleteEntry(file), 'mod-warning');

    this.dragRow(row, grip, file);
  }

  /* -- several notes at once, while editing ----------------------- */

  /** What's ticked while editing: paths, and the last ticked, for Shift. */
  bulk() {
    if (!this.bulkSelection) this.bulkSelection = new BulkSelection();
    return this.bulkSelection;
  }

  /** The notes ticked while editing, by path. */
  ticked() {
    return this.bulk().paths;
  }

  /** A row's box to tick; Shift ticks every row from the last one ticked. */
  tickBox(row, file, list) {
    const box = row.createEl('input', { type: 'checkbox', cls: 'dr-edit-tick' });
    box.checked = this.ticked().has(file.path);
    box.setAttribute('aria-label', `Select “${file.basename}”`);
    row.toggleClass('is-ticked', box.checked);
    box.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.bulk().set(file.path, box.checked, { range: evt.shiftKey ? this.shownPaths() : null });
      this.showTicks();
    });
  }

  /** The notes' rows while editing, in the order they're shown, by path. */
  shownPaths() {
    return Array.from(this.contentEl.querySelectorAll('.dr-track.is-editing')).map((r) => r.dataset.path);
  }

  /** The rows' boxes and the tray brought in line with what's ticked. */
  showTicks() {
    this.contentEl.querySelectorAll('.dr-track.is-editing').forEach((r) => {
      const on = this.bulk().has(r.dataset.path);
      r.toggleClass('is-ticked', on);
      const b = r.querySelector('.dr-edit-tick');
      if (b) b.checked = on;
    });
    this.renderBulkBar();
  }

  /** Every note shown ticked: Select all, or Mod+A while editing. */
  tickAllShown() {
    this.shownPaths().forEach((p) => this.bulk().set(p, true));
    this.showTicks();
  }

  /**
   * At the foot of the notes while editing, floating while they scroll:
   * the covers and count of what's ticked, Move and Properties, the rest
   * under More (Delete last, apart), and ✕ to let go of it all. Nothing
   * ticked, nothing shown. It slides in once, when the first is ticked.
   */
  renderBulkBar(root) {
    if (root) {
      this.bulkBar = root.createDiv({ cls: 'dr-bulk-bar', attr: { role: 'toolbar', 'aria-label': 'Selected notes' } });
      if (this.bulkShown) this.bulkBar.addClass('is-shown');
    }
    const bar = this.bulkBar;
    if (!bar) return;
    bar.empty();
    const files = this.tickedFiles();
    bar.toggleClass('is-empty', !files.length);
    bar.toggleClass('is-busy', !!this.bulkBusy);
    if (!files.length) {
      this.bulkShown = false;
      bar.removeClass('is-shown');
      return;
    }
    if (!this.bulkShown) bar.addClass('is-arriving');
    this.bulkShown = true;
    bar.addClass('is-shown');

    const art = bar.createDiv({ cls: 'dr-bulk-art', attr: { 'aria-hidden': 'true' } });
    files.slice(0, 3).forEach((f) => drawNoteArt(this.plugin, art.createDiv({ cls: 'dr-bulk-cover' }), f));
    const shown = new Set(this.shownPaths());
    const hidden = files.filter((f) => !shown.has(f.path)).length;
    const count = bar.createDiv({ cls: 'dr-bulk-count', attr: { 'aria-live': 'polite' } });
    count.createSpan({ text: files.length === 1 ? '1 note selected' : `${files.length} notes selected` });
    if (hidden) count.createSpan({ cls: 'dr-bulk-hidden', text: ` · ${hidden} not shown` });

    const button = (icon, label, run, cls, word = true) => {
      const el = bar.createDiv({ cls: `dr-bulk-action ${cls || ''}`.trim() });
      asButton(el, label);
      if (this.bulkBusy) el.setAttribute('aria-disabled', 'true');
      setIcon(el.createSpan(), icon);
      if (word) el.createSpan({ text: label });
      onActivate(el, (evt) => !this.bulkBusy && run(evt));
      return el;
    };
    button('folder-input', 'Move to…', () => new FolderPicker(this.app, (folder) => this.moveTicked(folder)).open());
    button('list', 'Properties…', () => this.propertyToolsFor(this.tickedFiles()));
    button('more-horizontal', 'More', (evt) => this.bulkMenu(evt), 'dr-bulk-more', false).setAttribute('aria-haspopup', 'menu');
    button('x', 'Clear selection', () => {
      this.bulk().clear();
      this.showTicks();
    }, 'dr-bulk-clear', false);
  }

  /** What's less often done to what's ticked: Copy as table, Select all, and, apart, Delete. */
  bulkMenu(evt) {
    const menu = new Menu();
    const clip = this.plugin.feature(PropertyClipboard);
    if (clip)
      menu.addItem((i) => i.setSection('action').setTitle('Copy as table').setIcon('table').onClick(() => clip.copyTable(this.tickedFiles())));
    const shown = this.shownPaths();
    if (shown.some((p) => !this.bulk().has(p)))
      menu.addItem((i) => i.setSection('action').setTitle(`Select all ${shown.length}`).setIcon('check-check').onClick(() => this.tickAllShown()));
    menu.addItem((i) => i.setSection('danger').setTitle('Delete…').setIcon('trash-2').setWarning(true).onClick(() => this.deleteTicked()));
    showMenuAt(menu, evt);
  }

  /** The ticked notes still there. */
  tickedFiles() {
    return Array.from(this.ticked())
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f) => f instanceof TFile);
  }

  /** While a move or a delete runs, the tray waits: nothing done twice. */
  async bulkWhile(run) {
    if (this.bulkBusy) return;
    this.bulkBusy = true;
    this.renderBulkBar();
    try {
      await run();
    } finally {
      this.bulkBusy = false;
      this.render();
    }
  }

  /**
   * Every ticked note moved to a folder; one Undo puts them all back.
   * Any that couldn't be moved stay ticked, and the message says how many.
   */
  async moveTicked(folder) {
    await this.bulkWhile(async () => {
      const moved = [];
      const stuck = [];
      for (const file of this.tickedFiles()) {
        const from = file.path;
        const current = file.parent ? file.parent.path : '/';
        const order = (this.plugin.settings.albumOrders || {})[current];
        const kept = order ? JSON.parse(JSON.stringify(order)) : null;
        if (await this.plugin.moveFile(file, folder.path)) moved.push({ file, from, current, kept });
        else stuck.push(from);
      }
      this.bulk().clear();
      stuck.forEach((p) => this.bulk().set(p, true));
      const where = folder.path === '/' ? this.app.vault.getName() : folder.name;
      const notes = (n) => (n === 1 ? '1 note' : `${n} notes`);
      const left = stuck.length ? ` ${notes(stuck.length)} couldn't be moved, and ${stuck.length === 1 ? 'is' : 'are'} still selected.` : '';
      if (!moved.length) {
        if (stuck.length) new Notice(`Nothing moved to ${where}.${left}`);
        return;
      }
      this.plugin.offerUndo(`Moved ${notes(moved.length)} to ${where}.${left}`, async () => {
        for (const m of moved.slice().reverse()) await this.plugin.putBack(m.file, m.from, m.current, m.kept);
      });
    });
  }

  /** Every ticked note to the trash, once asked; any that couldn't go stay ticked. */
  deleteTicked() {
    const files = this.tickedFiles();
    if (!files.length || this.bulkBusy) return;
    const what = files.length === 1 ? `“${files[0].basename}”` : `${files.length} notes`;
    new ConfirmModal(this.app, `Delete ${what}?`, 'They go to the trash, where they can be got back.', 'Delete', () =>
      this.bulkWhile(async () => {
        const stuck = [];
        for (const file of files) {
          try {
            await this.app.fileManager.trashFile(file);
          } catch (err) {
            console.error('Design Redux: could not delete', err);
            stuck.push(file.path);
          }
        }
        this.bulk().clear();
        stuck.forEach((p) => this.bulk().set(p, true));
        if (stuck.length) new Notice(`${stuck.length === 1 ? '1 note' : `${stuck.length} notes`} couldn't be deleted, and ${stuck.length === 1 ? 'is' : 'are'} still selected.`);
      }), { warning: true }).open();
  }

  /** A subfolder's heading while editing: its name, and a way to delete it. */
  editDiscHead(head, disc, album) {
    head.addClass('is-editing');
    const grip = head.createDiv({ cls: 'dr-edit-grip' });
    setIcon(grip, 'grip-vertical');
    asButton(grip, `Move the folder “${disc.folder.name}” — drag it onto another`);
    this.dragDisc(head, grip, disc.folder, album);
    const name = head.createEl('input', { cls: 'dr-disc-title dr-edit-name', type: 'text' });
    name.value = disc.folder.name;
    name.dataset.editPath = disc.folder.path;
    name.setAttribute('aria-label', 'Folder name');
    this.editField(name, disc.folder.name, (value) => this.renameEntry(disc.folder, value));
    head.createSpan({
      cls: 'dr-disc-count',
      text: disc.files.length === 1 ? '1 note' : `${disc.files.length} notes`,
    });
    const move = head.createDiv({ cls: 'clickable-icon dr-edit-tool' });
    asButton(move, `Move the folder “${disc.folder.name}” into another`);
    setIcon(move, 'folder-input');
    onActivate(move, () => this.pickFolderHome(disc.folder));
    const del = head.createDiv({ cls: 'clickable-icon dr-edit-tool mod-warning' });
    asButton(del, `Delete the folder “${disc.folder.name}”`);
    setIcon(del, 'trash-2');
    onActivate(del, () => this.deleteEntry(disc.folder));
  }

  /** Somewhere else for a folder: any folder but itself and those inside it. */
  pickFolderHome(folder) {
    const inside = (f) => f === folder || f.path.startsWith(folder.path + '/');
    new FolderPicker(
      this.app,
      (target) => this.moveFolderInto(folder, target.path),
      { withRoot: true, skip: inside, placeholder: `Move “${folder.name}” into…` }
    ).open();
  }

  async moveFolderInto(folder, targetPath) {
    return !!(await this.plugin.moveFile(folder, targetPath, { announce: true }));
  }

  /**
   * Drag a subfolder's heading onto another disc's to put it inside that
   * folder — or onto the album's own heading to bring it back to the
   * top. The heading under the pointer lights up; Escape calls it off.
   */
  dragDisc(head, grip, folder, album) {
    grip.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      down.preventDefault();
      const list = head.parentElement;
      const startX = down.clientX;
      const startY = down.clientY;
      let dragging = false;
      let target = null;

      // Somewhere it can go: not itself, not inside itself, not where it is.
      const allowed = (path) => {
        if (!path || path === folder.path || path.startsWith(folder.path + '/')) return false;
        return path !== (folder.parent ? folder.parent.path : '/');
      };
      const mark = (el) => {
        if (target === el) return;
        if (target) target.removeClass('is-drop-target');
        target = el;
        if (target) target.addClass('is-drop-target');
      };
      let lastX = startX;
      const hover = (x, y) => {
        const doc = head.ownerDocument;
        const under = doc.elementFromPoint ? doc.elementFromPoint(x, y) : null;
        const over = under && typeof under.closest === 'function' ? under.closest('.dr-disc[data-folder]') : null;
        mark(over && list.contains(over) && allowed(over.dataset.folder) ? over : null);
      };
      const scroller = edgeScroll(list, (y) => hover(lastX, y));
      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4 && Math.abs(evt.clientX - startX) < 4) return;
          dragging = true;
          head.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        lastX = evt.clientX;
        hover(evt.clientX, evt.clientY);
        scroller.at(evt.clientY);
      };
      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        scroller.stop();
        const chosen = target;
        mark(null);
        head.removeClass('is-dragging');
        list.removeClass('is-sorting');
        if (keep && dragging && chosen) this.moveFolderInto(folder, chosen.dataset.folder);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /** A note made in the album, named where it's listed rather than opened. */
  async editNewNote(folder) {
    try {
      const file = await this.app.vault.create(this.plugin.freeChildPath(folder, 'Untitled', 'md'), '');
      this.render();
      const input = this.contentEl.querySelector(`.dr-edit-name[data-edit-path="${CSS.escape(file.path)}"]`);
      if (input) {
        input.focus();
        input.select();
      }
      return file;
    } catch (err) {
      console.error('Design Redux: could not create the note', err);
      new Notice('Could not create the note.');
      return null;
    }
  }

  /** A subfolder — a new disc — named first, and shown even while empty. */
  editNewFolder(parent) {
    new NamePrompt(this.app, 'New folder', 'Folder name', async (name) => {
      const clean = name.replace(/[\\/:]/g, '').trim();
      if (!clean) return;
      const dir = !parent || parent.path === '/' ? '' : parent.path + '/';
      const path = normalizePath(dir + clean);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(`“${clean}” already exists here.`);
        return;
      }
      try {
        await this.app.vault.createFolder(path);
        this.render();
      } catch (err) {
        console.error('Design Redux: could not create the folder', err);
        new Notice('Could not create the folder.');
      }
    }).open();
  }

  /**
   * Put a note before or after another in its album, and keep that
   * order. The album switches to it, as a playlist keeps the order you
   * drag its songs into.
   */
  arrangeTrack(path, targetPath, after) {
    const file = this.app.vault.getFileByPath(path);
    const target = this.app.vault.getFileByPath(targetPath);
    if (!file || !target || !file.parent || file.parent !== target.parent) return false;
    const names = this.allNotesIn(file.parent).map((f) => f.name);
    const rest = names.filter((n) => n !== file.name);
    const at = rest.indexOf(target.name);
    const before = after ? rest[at + 1] : target.name;
    this.plugin.orders.setAlbum(file.parent, moveBefore(names, file.name, before === undefined ? null : before));
    this.plugin.refreshBrowse();
    return true;
  }

  /** Save the order a disc's rows are in now. */
  saveRowOrder(list, folderPath) {
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) return;
    const rows = Array.from(list.querySelectorAll('.dr-track[data-path]')).filter(
      (r) => r.dataset.folder === folderPath
    );
    const shown = rows.map((r) => r.dataset.path.split('/').pop());
    // Notes not drawn (there are none while editing, but to be sure) keep their place after.
    const others = this.allNotesIn(folder).map((f) => f.name).filter((n) => shown.indexOf(n) === -1);
    this.plugin.orders.setAlbum(folder, shown.concat(others));
    this.plugin.refreshBrowse();
  }

  /**
   * Drag a row by its handle, to anywhere in the album: among its own
   * disc's rows to put it in order, or into another disc to move the
   * note into that folder, at that place. Pointer events, so a finger
   * works as well as a mouse; nothing happens until it has moved a
   * little, and Escape puts the row back. Alt+arrows move it one place
   * from the keyboard, over the edge of a disc into the next.
   */
  dragRow(row, grip, file) {
    const home = row.dataset.folder;
    // Rows and disc headings, top to bottom; a row belongs to the
    // heading above it.
    const items = (list) => Array.from(list.querySelectorAll('.dr-track[data-path], .dr-disc[data-folder]'));
    const discAbove = (el) => {
      let at = el.previousElementSibling;
      while (at && !(at.matches('.dr-disc[data-folder]'))) at = at.previousElementSibling;
      return at;
    };

    grip.addEventListener('keydown', (evt) => {
      if (!evt.altKey || (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown')) return;
      evt.preventDefault();
      const list = row.parentElement;
      const all = items(list);
      const at = all.indexOf(row);
      const up = evt.key === 'ArrowUp';
      const next = all[at + (up ? -1 : 1)];
      if (!next) return;
      if (up) {
        // Over the album's first heading there's nowhere to go.
        if (next.matches('.dr-disc') && all.indexOf(next) === 0) return;
        list.insertBefore(row, next);
      } else {
        list.insertBefore(row, next.nextSibling);
      }
      this.commitRow(list, row, file, home, discAbove(row));
    });

    grip.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      down.preventDefault();
      const list = row.parentElement;
      const startY = down.clientY;
      const before = Array.from(list.children);
      let dragging = false;
      // Near the album's top or bottom edge, it scrolls, and the row follows.
      const scroller = edgeScroll(list, (y) => place(y));

      const place = (y) => {
        const others = items(list).filter((el) => el !== row);
        if (!others.length) return;
        const next = others.find((el) => {
          const box = el.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        // Never above the first heading: a row needs a disc to be in.
        if (next === others[0]) {
          if (others[1] !== undefined && row.nextElementSibling !== others[1]) list.insertBefore(row, others[1]);
          else if (others[1] === undefined) list.appendChild(row);
        } else if (next) {
          if (row.nextElementSibling !== next) list.insertBefore(row, next);
        } else if (list.lastElementChild !== row) {
          list.appendChild(row);
        }
        const disc = discAbove(row);
        list.querySelectorAll('.dr-disc.is-drop-target').forEach((el) => el !== disc && el.removeClass('is-drop-target'));
        if (disc && disc.dataset.folder !== home) disc.addClass('is-drop-target');
      };
      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4) return;
          dragging = true;
          row.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        place(evt.clientY);
        scroller.at(evt.clientY);
      };
      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        scroller.stop();
        if (!dragging) return;
        row.removeClass('is-dragging');
        list.removeClass('is-sorting');
        list.querySelectorAll('.dr-disc.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
        if (!keep) {
          before.forEach((el) => list.appendChild(el));
          return;
        }
        this.commitRow(list, row, file, home, discAbove(row));
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /**
   * Where a moved row landed, kept: the order of its disc, and — if
   * that's another disc — the note moved into that folder first.
   */
  async commitRow(list, row, file, home, disc) {
    const folder = disc ? disc.dataset.folder : home;
    if (folder !== home) {
      if (!(await this.plugin.moveFile(file, folder, { announce: true }))) {
        this.render();
        return;
      }
      row.dataset.folder = folder;
      row.dataset.path = file.path;
    }
    this.saveRowOrder(list, folder);
    const again = this.contentEl.querySelector(`.dr-track[data-path="${CSS.escape(file.path)}"] .dr-edit-grip`);
    if (again) again.focus();
  }

  /* -- pins in your own order ---------------------------------------- */

  /** Pinned, in the order kept for it, as the screen lists them. */
  pinnedInOrder() {
    return this.plugin.pins.all();
  }

  /** Move a pin one place, or to before another. */
  arrangePin(path, before) {
    this.plugin.pins.move(path, before, this.pinnedInOrder().map((t) => t.path));
    this.plugin.refreshBrowse();
    const library = this.plugin.feature(Library);
    if (library) library.refreshViews();
  }

  /** Earlier and later for one pin, where it isn't already at that end. */
  pinSteps(target) {
    return this.mode === 'pinned' ? this.tileSteps(target) : null;
  }

  /** A shelf's albums, in the order they were put in, or as sorted. */
  shelfFolders(shelf) {
    return this.plugin.orders.arrangeAlbum(shelf, this.visibleFolders(shelf), (list) => this.sortFolders(list));
  }

  /** A folder of nothing but folders. */
  isShelf(folder) {
    return !!folder && !(folder.children || []).some((c) => c instanceof TFile && !this.plugin.isFolderNote(c)) && this.visibleFolders(folder).length > 0;
  }

  /**
   * Where tiles on screen can be put in order: pins in their own order,
   * or the albums on a shelf, kept by name as an album keeps its notes.
   */
  tileOrder() {
    if (this.mode === 'pinned') {
      return this.keepsOwnOrder() ? { paths: () => this.pinnedInOrder().map((t) => t.path), move: (path, before) => this.arrangePin(path, before) } : null;
    }
    const shelf = this.mode === 'folder' ? this.folder() : null;
    if (!this.isShelf(shelf)) return null;
    const paths = () => this.shelfFolders(shelf).map((f) => f.path);
    return {
      paths,
      move: (path, before) => {
        this.plugin.orders.setAlbum(shelf, moveBefore(paths(), path, before).map((p) => p.split('/').pop()));
        this.render();
      },
    };
  }

  /** Earlier and later for one tile, where it isn't already at that end. */
  tileSteps(target) {
    const order = this.canArrange() ? this.tileOrder() : null;
    if (!order) return null;
    const paths = order.paths();
    const at = paths.indexOf(target.path);
    if (at === -1) return null;
    return {
      earlier: at > 0 ? () => order.move(target.path, paths[at - 1]) : null,
      later: at < paths.length - 1 ? () => order.move(target.path, paths[at + 2] === undefined ? null : paths[at + 2]) : null,
    };
  }

  /**
   * Folder tiles in one grid, or grouped as the setting says: by kind of
   * album, or by the folder they're in. The grids, to arrange.
   */
  folderTiles(root, folders, subtitle) {
    const by = this.plugin.settings.tileGroups;
    const structure = typeof AlbumStructure === 'function' ? this.plugin.feature(AlbumStructure) : null;
    const top = (f) => !f.parent || (f.parent.isRoot && f.parent.isRoot());
    const keyOf =
      by === 'kind' && structure && structure.enabled
        ? (f) => structure.info(f).label
        : by === 'collection'
          ? (f) => (top(f) ? '' : f.parent.name)
          : null;
    const draw = (list) => {
      const grid = root.createDiv({ cls: 'dr-grid' });
      // Covers asked for, in settings: a gallery.
      if (this.plugin.settings.libraryLayout === 'covers') grid.addClass('is-gallery');
      roveFocus(grid, '.dr-card');
      const card = (f) => this.folderCard(grid, f, subtitle ? subtitle(f) : undefined);
      // The first rows at once; the rest a batch a frame, so a shelf of hundreds shows straight away.
      list.slice(0, TILES_AT_ONCE).forEach(card);
      this.drawLater(grid, list.slice(TILES_AT_ONCE), card);
      return grid;
    };
    const groups = new Map();
    if (keyOf) folders.forEach((f) => groups.set(keyOf(f), (groups.get(keyOf(f)) || []).concat(f)));
    if (!keyOf || groups.size < 2) return [draw(folders)];
    const keys = Array.from(groups.keys()).filter(Boolean).sort(byName);
    if (groups.has('')) keys.push('');
    return keys.map((key) => {
      root.createDiv({ cls: 'dr-tile-group-head', text: key || (by === 'kind' ? 'No kind given' : this.app.vault.getName()) });
      return draw(groups.get(key));
    });
  }

  /** Tiles that can be dragged into order, on desktop: pins, or a shelf's albums. */
  /** Tiles drawn a batch a frame, into a grid still on the page; those that can be arranged made draggable as they come. */
  drawLater(grid, rest, draw) {
    if (!rest.length) return;
    const win = grid.ownerDocument.defaultView || window;
    const next = () => {
      if (!grid.isConnected) return;
      rest.splice(0, TILES_A_FRAME).forEach(draw);
      if (grid.drArrange) grid.querySelectorAll('.dr-card[data-path]:not([draggable])').forEach((card) => card.setAttribute('draggable', 'true'));
      if (rest.length) win.requestAnimationFrame(next);
    };
    win.requestAnimationFrame(next);
  }

  arrangeableTiles(grid) {
    const order = this.tileOrder();
    if (Platform.isMobile || !order) return;
    let dragged = null;
    // Listened for on the grid, so tiles drawn later are arranged the same.
    grid.drArrange = true;
    grid.querySelectorAll('.dr-card[data-path]').forEach((card) => card.setAttribute('draggable', 'true'));
    const held = (evt) => (evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('.dr-card[data-path]') : null);
    grid.addEventListener('dragstart', (evt) => {
      const card = held(evt);
      if (!card) return;
      dragged = card.dataset.path;
      evt.dataTransfer.setData('text/dr-pin', dragged);
      evt.dataTransfer.effectAllowed = 'move';
      card.addClass('is-dragging');
    });
    grid.addEventListener('dragend', (evt) => {
      const card = held(evt);
      dragged = null;
      if (card) card.removeClass('is-dragging');
    });
    const clear = () =>
      grid.querySelectorAll('.is-drop-before, .is-drop-after').forEach((el) => el.removeClass('is-drop-before', 'is-drop-after'));
    const over = (evt) => {
      const card = evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('.dr-card[data-path]') : null;
      if (!card || !dragged || card.dataset.path === dragged) return null;
      const box = card.getBoundingClientRect();
      return { card, after: evt.clientX > box.left + box.width / 2 };
    };
    grid.addEventListener('dragover', (evt) => {
      const at = over(evt);
      clear();
      if (!at || !this.canArrange()) return;
      evt.preventDefault();
      at.card.addClass(at.after ? 'is-drop-after' : 'is-drop-before');
    });
    grid.addEventListener('drop', (evt) => {
      const at = over(evt);
      clear();
      if (!at || !this.canArrange()) return;
      evt.preventDefault();
      const paths = order.paths().filter((p) => p !== dragged);
      const i = paths.indexOf(at.card.dataset.path);
      const before = at.after ? paths[i + 1] : paths[i];
      order.move(dragged, before === undefined ? null : before);
    });
    // Alt+left and right move the focused tile, from the keyboard.
    grid.addEventListener('keydown', (evt) => {
      if (!evt.altKey || (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight')) return;
      const card = evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('.dr-card[data-path]') : null;
      if (!card) return;
      const target = this.app.vault.getAbstractFileByPath(card.dataset.path);
      const steps = target && this.tileSteps(target);
      const step = steps && (evt.key === 'ArrowLeft' ? steps.earlier : steps.later);
      if (!step) return;
      evt.preventDefault();
      step();
      const again = this.contentEl.querySelector(`.dr-card[data-path="${CSS.escape(card.dataset.path)}"]`);
      if (again) again.focus();
    });
  }
}

export class RowValues extends BrowseEditing {
  /** A row's value as a button: pick, set or tick it there, the album not drawn again. */
  editableCell(cell, file, key) {
    cell.addClass('is-editable');
    asButton(cell, `Change ${key}`);
    onActivate(cell, (evt) => {
      if (evt && evt.stopPropagation) evt.stopPropagation();
      this.editValueInRow(cell, file, key, evt);
    });
  }

  /** The value as its type has it: a checkbox ticked, a date picked, else one of its values chosen or typed. */
  editValueInRow(cell, file, key, evt) {
    const type = typeOfProperty(this.app, key);
    const now = fmGet(noteProps(this.app, file), key);
    if (type === 'checkbox') return this.writeRowValue(cell, file, key, !(now === true));
    if (type === 'date' || type === 'datetime') {
      cell.empty();
      const input = cell.createEl('input', { type: type === 'date' ? 'date' : 'datetime-local', cls: 'dr-row-value-input' });
      input.value = typeof now === 'string' ? now.slice(0, type === 'date' ? 10 : 16) : '';
      let done = false;
      const finish = (write) => {
        if (done) return;
        done = true;
        if (write && input.value) this.writeRowValue(cell, file, key, input.value);
        else this.showRowValue(cell, key, now);
      };
      input.addEventListener('change', () => finish(true));
      input.addEventListener('blur', () => finish(false));
      input.addEventListener('keydown', (e) => e.key === 'Escape' && finish(false));
      input.addEventListener('click', (e) => e.stopPropagation());
      input.focus();
      return null;
    }
    const menu = new Menu();
    this.rowValueChoices(file, key).forEach((v) =>
      menu.addItem((item) =>
        item
          .setTitle(v)
          .setChecked(String(now) === v)
          .setSection('action')
          .onClick(() => this.writeRowValue(cell, file, key, v))
      )
    );
    menu.addItem((item) =>
      item
        .setTitle('Other…')
        .setIcon('pencil')
        .setSection('view')
        .onClick(() => new NamePrompt(this.app, `${key} for ${file.basename}`, 'A value', (v) => this.writeRowValue(cell, file, key, v), { value: now === null || now === undefined ? '' : String(now), button: 'Set' }).open())
    );
    if (now !== undefined && now !== null && now !== '') menu.addItem((item) => item.setTitle('Clear').setIcon('x').setSection('danger').onClick(() => this.writeRowValue(cell, file, key, null)));
    showMenuAt(menu, evt || { target: cell });
    return menu;
  }

  /** The values to choose from: the folder's schema's, else those with a colour of their own, else the most used. */
  rowValueChoices(file, key) {
    const entry = schemaFor(this.plugin.settings.propertySchemas, file).find((e) => e.key.toLowerCase() === String(key).toLowerCase());
    if (entry && entry.values) return entry.values.slice();
    const options = this.plugin.settings.propertyOptions || {};
    const named = Object.keys(options).find((k) => k.toLowerCase() === String(key).toLowerCase());
    if (named && Object.keys(options[named]).length) return Object.keys(options[named]);
    return this.groupsByProperty(key)
      .slice()
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 12)
      .map((g) => String(g.value));
  }

  /** A value written through the notes service — one step of Undo — and shown in its cell, the album as it is. */
  async writeRowValue(cell, file, key, value) {
    if (!this.quietChanges) this.quietChanges = new Set();
    this.quietChanges.add(file.path);
    const record = await this.plugin.notes.write(
      file,
      (fm) => {
        const name = Object.keys(fm).find((k) => k.toLowerCase() === String(key).toLowerCase()) || key;
        if (value === null) delete fm[name];
        else fm[name] = value;
      },
      { undo: `Set “${key}” of ${file.basename}.` }
    );
    if (!record || !Object.keys(record.before).length) this.quietChanges.delete(file.path);
    this.showRowValue(cell, key, record ? value : fmGet(noteProps(this.app, file), key));
    return record;
  }

  showRowValue(cell, key, value) {
    cell.empty();
    const text = value === null || value === undefined ? '' : Array.isArray(value) ? value.map((v) => plainValue(v)).join(', ') : plainValue(value);
    cell.setText(text);
    paintValue(cell, this.plugin, key, text);
    markDue(cell, this.plugin, key, text);
  }
}
