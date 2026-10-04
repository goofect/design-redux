/* ------------------------------------------------------------------ */
/* Your own order                                                      */
/*                                                                     */
/* An album's notes, and the pins, in an order you've arranged by      */
/* dragging. Kept in settings — albums by note name, pins by path —    */
/* and followed through renames, moves and deletions, so the           */
/* arrangement outlives the files being tidied.                        */
/* ------------------------------------------------------------------ */

/**
 * Items in a saved order: the ones it names, in its order, then any it
 * doesn't — new since it was saved — after them, in the fallback order.
 */
function arrange(items, keyOf, saved, fallback) {
  const at = new Map(saved.map((k, i) => [k, i]));
  const known = items
    .filter((it) => at.has(keyOf(it)))
    .sort((a, b) => at.get(keyOf(a)) - at.get(keyOf(b)));
  return known.concat(fallback(items.filter((it) => !at.has(keyOf(it)))));
}

/** A list with one entry moved to just before another, or to the end. */
function moveBefore(list, item, before) {
  const out = list.filter((k) => k !== item);
  const i = before === null || before === undefined ? -1 : out.indexOf(before);
  if (i === -1) out.push(item);
  else out.splice(i, 0, item);
  return out;
}

/** A path moved with a folder, or as it was. */
/* Settings kept by a file or folder's path, which follow it when it moves. */
const PATH_KEYED = ['coverColors', 'canvasLegends', 'canvasAlignments'];

/*
 * Changes to how settings are saved, in order. When a setting is renamed
 * or reshaped, a step here carries the old value across, so a choice
 * isn't lost to the change. Each step gets the saved data as it was and
 * edits it in place: { to: 2, run(saved) { ... } }.
 */
const SETTINGS_MIGRATIONS = [
  {
    // The quieter look: a note or folder without a cover shows its name,
    // set as a title, where the old default showed a file icon.
    to: 2,
    run(saved) {
      if (saved.coverFallback === undefined || saved.coverFallback === 'icon') saved.coverFallback = 'title';
    },
  },
];

function movedPath(p, oldPath, newPath) {
  if (p === oldPath) return newPath;
  if (p.startsWith(oldPath + '/')) return newPath + p.slice(oldPath.length);
  return p;
}

class Orders {
  constructor(plugin) {
    this.plugin = plugin;
  }

  get settings() {
    return this.plugin.settings;
  }

  album(folder) {
    const saved = folder && (this.settings.albumOrders || {})[folder.path];
    return saved && Array.isArray(saved.names) ? saved : null;
  }

  hasAlbum(folder) {
    return !!this.album(folder);
  }

  /** Whether an album is showing its own order rather than the shared one. */
  albumOn(folder) {
    const saved = this.album(folder);
    return !!saved && saved.on !== false;
  }

  setAlbumOn(folder, on) {
    const saved = this.album(folder);
    if (!saved || saved.on === on) return;
    saved.on = on;
    this.save();
  }

  /** Save an album's arrangement, by file name, and use it. */
  setAlbum(folder, names) {
    this.settings.albumOrders = Object.assign({}, this.settings.albumOrders, {
      [folder.path]: { names: names.slice(), on: true },
    });
    this.save();
  }

  arrangeAlbum(folder, files, fallback) {
    if (!this.albumOn(folder)) return fallback(files);
    return arrange(files, (f) => f.name, this.album(folder).names, fallback);
  }

  pinOrder() {
    return Array.isArray(this.settings.pinOrder) ? this.settings.pinOrder : [];
  }

  setPins(paths) {
    this.settings.pinOrder = paths.slice();
    this.save();
  }

  arrangePins(items) {
    const saved = this.pinOrder();
    return saved.length ? arrange(items, (t) => t.path, saved, (rest) => rest) : items;
  }

  save() {
    this.plugin.saveData(this.settings);
  }

  /* -- cover colours ------------------------------------------------ */

  /** The colour chosen for one folder or note, or null if it has none. */
  coverColor(target) {
    const saved = target ? (this.settings.coverColors || {})[target.path] : null;
    return saved === 'accent' ? saved : normalHex(saved);
  }

  /** Null goes back to the colour it would have had anyway. */
  setCoverColor(target, value) {
    const colors = Object.assign({}, this.settings.coverColors || {});
    const next = value === 'accent' ? value : normalHex(value);
    if (next) colors[target.path] = next;
    else delete colors[target.path];
    this.settings.coverColors = colors;
    // Through saveSettings, so the strip and open screens repaint too.
    return this.plugin.saveSettings();
  }

  /** A file or folder renamed or moved: every arrangement naming it follows. */
  followRename(file, oldPath) {
    let changed = false;
    // Colours and legends are kept by path — its own, and for a folder,
    // everything in it.
    PATH_KEYED.forEach((key) => {
      const kept = this.settings[key] || {};
      if (!Object.keys(kept).some((p) => movedPath(p, oldPath, file.path) !== p)) return;
      const next = {};
      Object.keys(kept).forEach((p) => (next[movedPath(p, oldPath, file.path)] = kept[p]));
      this.settings[key] = next;
      changed = true;
    });
    const orders = this.settings.albumOrders || {};
    if (file instanceof TFolder) {
      // Its own arrangement, and those of the folders inside it.
      const next = {};
      Object.keys(orders).forEach((p) => {
        const moved = movedPath(p, oldPath, file.path);
        if (moved !== p) changed = true;
        next[moved] = orders[p];
      });
      if (changed) this.settings.albumOrders = next;
    } else {
      const oldParent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '/';
      const oldName = oldPath.split('/').pop();
      const newParent = file.parent ? file.parent.path : '/';
      const saved = orders[oldParent];
      if (saved && Array.isArray(saved.names) && saved.names.indexOf(oldName) !== -1) {
        // Renamed in place keeps its position; moved away leaves the album.
        saved.names =
          newParent === oldParent
            ? saved.names.map((n) => (n === oldName ? file.name : n))
            : saved.names.filter((n) => n !== oldName);
        changed = true;
      }
    }
    const pins = this.pinOrder();
    const moved = pins.map((p) => movedPath(p, oldPath, file.path));
    if (moved.some((p, i) => p !== pins[i])) {
      this.settings.pinOrder = moved;
      changed = true;
    }
    if (changed) this.save();
  }

  /** A file or folder deleted: it leaves whatever arrangement named it. */
  followDelete(file) {
    let changed = false;
    PATH_KEYED.forEach((key) => {
      const kept = this.settings[key] || {};
      Object.keys(kept).forEach((p) => {
        if (p === file.path || p.startsWith(file.path + '/')) {
          delete kept[p];
          changed = true;
        }
      });
    });
    const orders = this.settings.albumOrders || {};
    if (file instanceof TFolder) {
      Object.keys(orders).forEach((p) => {
        if (p === file.path || p.startsWith(file.path + '/')) {
          delete orders[p];
          changed = true;
        }
      });
    } else {
      const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '/';
      const saved = orders[parent];
      if (saved && Array.isArray(saved.names) && saved.names.indexOf(file.name) !== -1) {
        saved.names = saved.names.filter((n) => n !== file.name);
        changed = true;
      }
    }
    const pins = this.pinOrder();
    const kept = pins.filter((p) => p !== file.path && !p.startsWith(file.path + '/'));
    if (kept.length !== pins.length) {
      this.settings.pinOrder = kept;
      changed = true;
    }
    if (changed) this.save();
  }
}

