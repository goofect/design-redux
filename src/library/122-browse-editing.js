/* ------------------------------------------------------------------ */
/* Browse view: editing an album                                      */
/*                                                                    */
/* Edit mode: rename, move, delete, add, and tick to act on several.  */
/* Arranging is 126's. A part of BrowseView (see 120).                */
/* ------------------------------------------------------------------ */

import { Menu, normalizePath, Notice, Platform, setIcon, TFile } from 'obsidian';
import { coverGen } from '../core/030-art.js';
import { showMenuAt } from '../core/036-menus.js';
import { asButton, composing, onActivate } from '../core/042-controls.js';
import { fmGet, plainValue, typeOfProperty } from '../core/045-helpers-properties.js';
import { noteProps } from '../core/073-notes.js';
import { ask } from '../core/081-capabilities.js';
import { schemaFor } from '../core/086-property-schema.js';
import { BrowseSorting } from './121-browse-sorting.js';
import { ConfirmModal, FolderPicker, NamePrompt } from '../ui/230-pickers.js';
import { paintValue } from '../ui/248-value-options.js';

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
    if (!on && this.tickedPaths) this.tickedPaths.clear();
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

  /** The notes ticked while editing, by path. */
  ticked() {
    if (!this.tickedPaths) this.tickedPaths = new Set();
    return this.tickedPaths;
  }

  /** A row's box to tick; Shift ticks every row from the last one ticked. */
  tickBox(row, file, list) {
    const box = row.createEl('input', { type: 'checkbox', cls: 'dr-edit-tick' });
    box.checked = this.ticked().has(file.path);
    box.setAttribute('aria-label', `Select “${file.basename}”`);
    row.toggleClass('is-ticked', box.checked);
    box.addEventListener('click', (evt) => {
      evt.stopPropagation();
      const ticked = this.ticked();
      const rows = Array.from(list.querySelectorAll('.dr-track.is-editing'));
      const paths = rows.map((r) => r.dataset.path);
      const from = this.lastTick ? paths.indexOf(this.lastTick) : -1;
      const to = paths.indexOf(file.path);
      const run = evt.shiftKey && from !== -1 ? paths.slice(Math.min(from, to), Math.max(from, to) + 1) : [file.path];
      run.forEach((p) => (box.checked ? ticked.add(p) : ticked.delete(p)));
      this.lastTick = file.path;
      rows.forEach((r) => {
        const on = ticked.has(r.dataset.path);
        r.toggleClass('is-ticked', on);
        const b = r.querySelector('.dr-edit-tick');
        if (b) b.checked = on;
      });
      this.renderBulkBar();
    });
  }

  /** Above the notes while editing: how many are ticked, and what can be done to them all. */
  renderBulkBar(root) {
    if (root) this.bulkBar = root.createDiv({ cls: 'dr-bulk-bar' });
    const bar = this.bulkBar;
    if (!bar) return;
    bar.empty();
    const files = this.tickedFiles();
    bar.toggleClass('is-empty', !files.length);
    if (!files.length) return;
    bar.createSpan({ cls: 'dr-bulk-count', text: files.length === 1 ? '1 note selected' : `${files.length} notes selected` });
    const button = (icon, label, run, cls) => {
      const el = bar.createDiv({ cls: `dr-bulk-action ${cls || ''}`.trim() });
      asButton(el, label);
      setIcon(el.createSpan(), icon);
      el.createSpan({ text: label });
      onActivate(el, run);
    };
    button('folder-input', 'Move to…', () => new FolderPicker(this.app, (folder) => this.moveTicked(folder)).open());
    button('list', 'Properties…', () => this.propertyToolsFor(this.tickedFiles()));
    const clip = ask(this.plugin, 'clipboard');
    if (clip) button('table', 'Copy as table', () => clip.copyTable(this.tickedFiles()));
    button('trash-2', 'Delete', () => this.deleteTicked(), 'mod-warning');
    button('x', 'Clear', () => {
      this.ticked().clear();
      this.render();
    });
  }

  /** The ticked notes still there. */
  tickedFiles() {
    return Array.from(this.ticked())
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f) => f instanceof TFile);
  }

  /** Every ticked note moved to a folder; one Undo puts them all back. */
  async moveTicked(folder) {
    const moved = [];
    for (const file of this.tickedFiles()) {
      const from = file.path;
      const current = file.parent ? file.parent.path : '/';
      const order = (this.plugin.settings.albumOrders || {})[current];
      const kept = order ? JSON.parse(JSON.stringify(order)) : null;
      if (await this.plugin.moveFile(file, folder.path)) moved.push({ file, from, current, kept });
    }
    this.ticked().clear();
    this.render();
    if (!moved.length) return;
    const where = folder.path === '/' ? this.app.vault.getName() : folder.name;
    this.plugin.offerUndo(`Moved ${moved.length === 1 ? '1 note' : `${moved.length} notes`} to ${where}.`, async () => {
      for (const m of moved.slice().reverse()) await this.plugin.putBack(m.file, m.from, m.current, m.kept);
    });
  }

  /** Every ticked note to the trash, once asked. */
  deleteTicked() {
    const files = this.tickedFiles();
    if (!files.length) return;
    const what = files.length === 1 ? `“${files[0].basename}”` : `${files.length} notes`;
    new ConfirmModal(this.app, `Delete ${what}?`, 'They go to the trash, where they can be got back.', 'Delete', async () => {
      for (const file of files) {
        try {
          await this.app.fileManager.trashFile(file);
        } catch (err) {
          console.error('Design Redux: could not delete', err);
        }
      }
      this.ticked().clear();
      this.render();
    }, { warning: true }).open();
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
  }
}
