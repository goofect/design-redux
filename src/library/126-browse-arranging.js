/* ------------------------------------------------------------------ */
/* Browse view: arranging                                             */
/*                                                                    */
/* Your own order, by drag or by keys: an album’s discs and tracks,   */
/* pins, and a shelf’s tiles (drawn a frame at a time). A part of     */
/* BrowseView (see 120).                                              */
/* ------------------------------------------------------------------ */

import { Platform, TFile } from 'obsidian';
import { byName } from '../core/040-sorting.js';
import { edgeScroll, roveFocus } from '../core/042-controls.js';
import { moveBefore } from '../core/070-orders.js';
import { ask } from '../core/081-capabilities.js';
import { BrowseAlbum } from './125-browse-album.js';

/* A shelf's tiles drawn at once, and then a frame at a time. */
export const TILES_AT_ONCE = 60;
export const TILES_A_FRAME = 120;

export class BrowseArranging extends BrowseAlbum {
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
    const library = ask(this.plugin, 'library');
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
    const structure = ask(this.plugin, 'albums');
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
