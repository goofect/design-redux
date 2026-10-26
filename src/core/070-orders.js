/* ------------------------------------------------------------------ */
/* Your own order                                                      */
/*                                                                     */
/* An album's notes, and the pins, in an order you've arranged by      */
/* dragging. Kept in settings — albums by note name, pins by path —    */
/* and followed through renames, moves and deletions, so the           */
/* arrangement outlives the files being tidied.                        */
/* ------------------------------------------------------------------ */

import { TFolder } from 'obsidian';
import { LIBRARY_MORE } from './020-constants.js';
import { normalHex } from './031-colours.js';
import { coverDesignById } from './032-drawn-covers.js';
import { schemasFromDefaults } from './086-property-schema.js';

/**
 * Items in a saved order: the ones it names, in its order, then any it
 * doesn't — new since it was saved — after them, in the fallback order.
 */
export function arrange(items, keyOf, saved, fallback) {
  const at = new Map(saved.map((k, i) => [k, i]));
  const known = items
    .filter((it) => at.has(keyOf(it)))
    .sort((a, b) => at.get(keyOf(a)) - at.get(keyOf(b)));
  return known.concat(fallback(items.filter((it) => !at.has(keyOf(it)))));
}

/** A list with one entry moved to just before another, or to the end. */
export function moveBefore(list, item, before) {
  const out = list.filter((k) => k !== item);
  const i = before === null || before === undefined ? -1 : out.indexOf(before);
  if (i === -1) out.push(item);
  else out.splice(i, 0, item);
  return out;
}

/** A path moved with a folder, or as it was. */
/* Settings kept by a file or folder's path, which follow it when it moves. */
export const PATH_KEYED = ['coverColors', 'coverDesigns', 'readingLog', 'albumSorts', 'knowledgeMeant', 'studyAlbums', 'propertySchemas', 'propertyHistory', 'panelFolderViews', 'pagesOpen'];

/* The canvas settings a mind map has a twin of: [canvas key, mind-map key, how its value reads there]. */
export const MINDMAP_TWINS = [
  ['canvasLegend', 'mindmapLegend'],
  ['canvasDepth', 'mindmapDepth'],
  ['canvasColourBy', 'mindmapColourBy', (v) => (v === 'branch' || v === 'depth' ? v : '')],
  ['canvasPins', 'mindmapPins'],
  ['canvasViews', 'mindmapViews'],
];

/* The twins mind maps took on with their knowledge tools. */
export const MINDMAP_TWINS_KNOWLEDGE = [
  ['canvasRelations', 'mindmapRelations'],
  ['canvasArguments', 'mindmapArguments'],
  ['canvasBranchNote', 'mindmapBranchNotes'],
  ['canvasCheck', 'mindmapCheck'],
  ['canvasCompare', 'mindmapCompare'],
  ['canvasVaultMap', 'mindmapVaultMap'],
  ['canvasMinimap', 'mindmapMinimap'],
  ['canvasPresent', 'mindmapPresent'],
];

/*
 * Changes to how settings are saved, in order. When a setting is renamed
 * or reshaped, a step here carries the old value across, so a choice
 * isn't lost to the change. Each step gets the saved data as it was and
 * edits it in place: { to: 2, run(saved) { ... } }.
 */
export const SETTINGS_MIGRATIONS = [
  {
    // The quieter look: a note or folder without a cover shows its name,
    // set as a title, where the old default showed a file icon.
    to: 2,
    run(saved) {
      if (saved.coverFallback === undefined || saved.coverFallback === 'icon') saved.coverFallback = 'title';
    },
  },
  {
    // Album covers drawn for each name, where the name set as a title
    // was the default.
    to: 3,
    run(saved) {
      if (saved.coverFallback === undefined || saved.coverFallback === 'title') saved.coverFallback = 'art';
    },
  },
  {
    // Recently read joins the library, after Pinned.
    to: 4,
    run(saved) {
      if (!Array.isArray(saved.librarySections)) return;
      const items = (sec) => (sec && Array.isArray(sec.items) ? sec.items : []);
      if (saved.librarySections.some((sec) => items(sec).some((i) => i && i.kind === 'builtin' && i.id === 'read'))) return;
      const home = saved.librarySections.find((sec) => items(sec).some((i) => i && i.kind === 'builtin' && i.id === 'bookmarks'));
      if (!home) return;
      const at = home.items.findIndex((i) => i && i.kind === 'builtin' && i.id === 'bookmarks');
      home.items.splice(at + 1, 0, { kind: 'builtin', id: 'read' });
    },
  },
  {
    // Fewer places up front: the occasional ones move under a folded More,
    // in the order they were in. Nothing leaves the library.
    to: 5,
    run(saved) {
      if (!Array.isArray(saved.librarySections)) return;
      const items = (sec) => (sec && Array.isArray(sec.items) ? sec.items : []);
      if (saved.librarySections.some((sec) => sec && typeof sec.folded === 'boolean')) return;
      const moved = [];
      const emptied = new Set();
      saved.librarySections.forEach((sec) => {
        if (!items(sec).length) return;
        sec.items = sec.items.filter((i) => {
          const goes = i && i.kind === 'builtin' && LIBRARY_MORE.indexOf(i.id) !== -1;
          if (goes) moved.push(i);
          return !goes;
        });
        if (!sec.items.length) emptied.add(sec);
      });
      if (!moved.length) return;
      // A section only those filled goes with them; the rest keep their places.
      saved.librarySections = saved.librarySections.filter((sec) => !emptied.has(sec));
      saved.librarySections.push({ title: 'More', folded: true, items: moved });
    },
  },
  {
    // A quieter look to begin with: no glass behind the panels, no tint
    // from the cover behind a note. Both are a switch away in Appearance
    // and on the note page.
    to: 6,
    run(saved) {
      saved.glassPanels = false;
      saved.notePageTint = false;
    },
  },
  {
    // The library and its review are places now, not modes: someone in
    // either is in Standard, the workspace as it is.
    to: 7,
    run(saved) {
      if (saved.workspaceMode === 'library' || saved.workspaceMode === 'review') {
        saved.workspaceMode = '';
        saved.workspaceModeLayout = null;
      }
    },
  },
  {
    // Grouping a note's properties is only as set now — nothing guessed
    // from names — and off until groups are wanted.
    to: 8,
    run(saved) {
      if (saved.panelPropertyGroups === 'auto') saved.panelPropertyGroups = 'off';
    },
  },
  {
    // The note panel without Relationships and Kept in: properties and
    // mentions only. Both are a switch away in Notes → Properties.
    to: 9,
    run(saved) {
      saved.panelRelationships = false;
      saved.panelPlaces = false;
    },
  },
  {
    // Mind maps of their own take the choices made for the canvas's maps:
    // the legend, depth, tints, pinned cards and views. The canvas keeps its own.
    to: 10,
    run(saved) {
      MINDMAP_TWINS.forEach(([from, to, as]) => {
        if (saved[from] !== undefined) saved[to] = as ? as(saved[from]) : saved[from];
      });
    },
  },
  {
    // The same for the tools mind maps took on next: relations, arguments,
    // branches as notes, check, compare, maps of the vault, the minimap, present.
    to: 11,
    run(saved) {
      MINDMAP_TWINS_KNOWLEDGE.forEach(([from, to]) => {
        if (saved[from] !== undefined) saved[to] = saved[from];
      });
    },
  },
  {
    // Folder defaults become schemas: the same properties, as defaults
    // only, nothing required. The defaults themselves stay as they were.
    to: 12,
    run(saved) {
      if (saved.folderDefaults && typeof saved.folderDefaults === 'object') saved.propertySchemas = schemasFromDefaults(saved.folderDefaults, saved.propertySchemas);
    },
  },
  {
    // 3.0: canvas maps are gone. Their settings go with them; mind maps
    // took their place in 2.x, with settings of their own carried over
    // at step 11. Canvases themselves are untouched.
    to: 13,
    run(saved) {
      RETIRED_CANVAS_KEYS.forEach((k) => delete saved[k]);
    },
  },
  {
    // The Apple redesign is a Look of its own. Whoever had the theme's look
    // with notes in the Apple style — the 3.0 default — is on Apple now;
    // whoever had asked for the theme's look for notes stays on the theme's.
    // "Use the theme's look for notes" is that same choice, so it goes.
    to: 14,
    run(saved) {
      if ((saved.look === undefined || saved.look === 'theme') && saved.noteThemeLook !== true) saved.look = 'apple';
      delete saved.noteThemeLook;
    },
  },
  {
    // "Only what Design Redux draws" was a choice made for the editorial look; carried over to
    // Apple's it kept notes in the theme's type beside the plugin's own. Apple's covers the window.
    to: 15,
    run(saved) {
      if (saved.look === 'apple' && saved.lookScope === 'plugin') saved.lookScope = 'window';
    },
  },
  {
    // The strip and the moved gear are off to begin with now. Whoever already had the plugin keeps them as they were.
    to: 16,
    run(saved, was) {
      if (!was || !was.existing) return;
      if (saved.contextStrip === undefined) saved.contextStrip = true;
      if (saved.settingsInHeader === undefined) saved.settingsInHeader = true;
    },
  },
];

/* The settings canvas maps had, dropped at step 13. */
export const RETIRED_CANVAS_KEYS = [
        'mindmapKeepCanvasMaps',
        'albumMapLayout',
        'canvasPresent',
        'presentCaption',
        'canvasToolButtons',
        'canvasTools',
        'canvasLegend',
        'canvasLegends',
        'canvasTextAlign',
        'canvasBranches',
        'canvasCloseGaps',
        'canvasTidy',
        'canvasSelectBranch',
        'canvasOutline',
        'canvasFind',
        'canvasFocus',
        'canvasFocusSelect',
        'canvasDuplicate',
        'canvasAlignments',
        'canvasArrange',
        'canvasMaps',
        'canvasMapFiles',
        'canvasCardFacts',
        'canvasCardChips',
        'canvasColourBy',
        'canvasMapToolbar',
        'canvasToolbarItems',
        'canvasMindMap',
        'canvasMindMapPlace',
        'canvasRelink',
        'canvasRestructure',
        'canvasBranchNote',
        'canvasOutlineBranch',
        'canvasOutlineSync',
        'canvasOutlineNumbers',
        'canvasLayouts',
        'canvasRelations',
        'canvasCheck',
        'canvasVaultMap',
        'canvasMinimap',
        'canvasCompare',
        'canvasArguments',
        'canvasQuickAdd',
        'canvasPasteLines',
        'canvasBranchDrag',
        'canvasPins',
        'canvasViews',
        'canvasDepth',
        'canvasCardFit',
        'canvasCardTitles',
        'canvasArrows',
        'canvasArrowShape',
        'canvasArrowSides',
];

export function movedPath(p, oldPath, newPath) {
  if (p === oldPath) return newPath;
  if (p.startsWith(oldPath + '/')) return newPath + p.slice(oldPath.length);
  return p;
}

export class Orders {
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

  /** The drawn cover's design picked for one folder or note, or null for the one its name gives it. */
  coverDesign(target) {
    const saved = target ? (this.settings.coverDesigns || {})[target.path] : null;
    return saved && coverDesignById(saved) ? saved : null;
  }

  /** A design and a colour together, saved once. */
  setCover(target, design, color) {
    const designs = Object.assign({}, this.settings.coverDesigns || {});
    if (design && coverDesignById(design)) designs[target.path] = design;
    else delete designs[target.path];
    this.settings.coverDesigns = designs;
    return this.setCoverColor(target, color);
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

