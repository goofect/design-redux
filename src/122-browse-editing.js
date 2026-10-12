/* ------------------------------------------------------------------ */
/* Browse view: editing an album                                      */
/*                                                                    */
/* Edit mode (rename, move, delete, add, arrange by drag) and pins in */
/* your own order. Methods of BrowseView, put on by mixInto.          */
/* ------------------------------------------------------------------ */

class BrowseEditing {
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

    const grip = row.createDiv({ cls: 'dr-edit-grip' });
    setIcon(grip, 'grip-vertical');
    grip.setAttribute('role', 'button');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-label', `Move “${file.basename}” — drag, or Alt+↑ and Alt+↓`);

    row.createDiv({ cls: 'dr-track-num', text: String(index) });
    const name = row.createEl('input', { cls: 'dr-track-name dr-edit-name', type: 'text' });
    name.value = file.basename;
    name.dataset.editPath = file.path;
    name.setAttribute('aria-label', 'Note name');
    this.editField(name, file.basename, (value) => this.renameEntry(file, value));

    const tools = row.createDiv({ cls: 'dr-edit-tools' });
    const tool = (icon, label, run, cls) => {
      const el = tools.createDiv({ cls: `clickable-icon dr-edit-tool ${cls || ''}`.trim() });
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      onActivate(el, run);
    };
    tool('folder-input', 'Move to another folder', () =>
      new FolderPicker(this.app, (folder) => this.plugin.moveFile(file, folder.path, { announce: true })).open()
    );
    tool('trash-2', 'Delete', () => this.deleteEntry(file), 'mod-warning');

    this.dragRow(row, grip, file);
  }

  /** A subfolder's heading while editing: its name, and a way to delete it. */
  editDiscHead(head, disc, album) {
    head.addClass('is-editing');
    const grip = head.createDiv({ cls: 'dr-edit-grip' });
    setIcon(grip, 'grip-vertical');
    grip.setAttribute('role', 'button');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-label', `Move the folder “${disc.folder.name}” — drag it onto another`);
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
    move.setAttribute('role', 'button');
    move.setAttribute('tabindex', '0');
    move.setAttribute('aria-label', `Move the folder “${disc.folder.name}” into another`);
    setIcon(move, 'folder-input');
    onActivate(move, () => this.pickFolderHome(disc.folder));
    const del = head.createDiv({ cls: 'clickable-icon dr-edit-tool mod-warning' });
    del.setAttribute('role', 'button');
    del.setAttribute('tabindex', '0');
    del.setAttribute('aria-label', `Delete the folder “${disc.folder.name}”`);
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
    const paths = this.pinnedInOrder().map((t) => t.path);
    this.plugin.orders.setPins(moveBefore(paths, path, before));
    const settings = this.plugin.settings;
    settings.keepOwnOrder = Object.assign({}, settings.keepOwnOrder, { pinned: true });
    this.plugin.saveData(settings);
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
      roveFocus(grid, '.dr-card');
      list.forEach((f) => this.folderCard(grid, f, subtitle ? subtitle(f) : undefined));
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
  arrangeableTiles(grid) {
    const order = this.tileOrder();
    if (Platform.isMobile || !order) return;
    let dragged = null;
    grid.querySelectorAll('.dr-card[data-path]').forEach((card) => {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (evt) => {
        dragged = card.dataset.path;
        evt.dataTransfer.setData('text/dr-pin', dragged);
        evt.dataTransfer.effectAllowed = 'move';
        card.addClass('is-dragging');
      });
      card.addEventListener('dragend', () => {
        dragged = null;
        card.removeClass('is-dragging');
      });
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

mixInto(BrowseView, BrowseEditing);
