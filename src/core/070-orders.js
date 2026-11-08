/* ------------------------------------------------------------------ */
/* Your own order                                                      */
/*                                                                     */
/* An album's notes, and the pins, in an order you've arranged by      */
/* dragging. Kept in settings — albums by note name, pins by path —    */
/* and followed through renames, moves and deletions, so the           */
/* arrangement outlives the files being tidied.                        */
/* ------------------------------------------------------------------ */

import { TFile, TFolder } from 'obsidian';
import { LIBRARY_MORE, libraryLayout } from './020-constants.js';
import { normalHex } from './031-colours.js';
import { coverDesignById } from './032-drawn-covers.js';
import { sortByOrder } from './040-sorting.js';
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
/* The plain names some versions after 3.0.25 gave settings, and the ones they have here: step 25 puts them back. */
export const UNRENAMED_KEYS = {
  propertyForCollection: 'propertyForAlbum',
  collectionNoteLimit: 'albumNoteLimit',
  sectionNoteLimit: 'discNoteLimit',
  collectionColumns: 'albumColumns',
  collectionExcerpts: 'albumExcerpts',
  collectionStillToWrite: 'albumStillToWrite',
  collectionNestBy: 'albumNestBy',
  noteLength: 'trackLength',
  collectionSortMemory: 'albumSortMemory',
  collectionStructure: 'albumStructure',
  collectionKeyNames: 'albumKeyNames',
  smartCollections: 'smartAlbums',
  collectionRefactor: 'albumRefactor',
  smartCollectionList: 'smartAlbumList',
  collectionSorts: 'albumSorts',
  collectionOrders: 'albumOrders',
  collectionRollups: 'albumRollups',
};

/* Settings kept by a file or folder's path, which follow it when it moves. */
export const PATH_KEYED = ['folderCovers', 'coverColors', 'coverDesigns', 'albumSorts', 'propertySchemas', 'propertyHistory', 'panelFolderViews', 'pagesOpen'];

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
    // Recently read joined the library here; it's gone (step 26), so nothing to add.
    to: 4,
    run() {},
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
    // mentions only. Both are a switch away in Notes → Properties. Only for
    // whoever had the plugin then: docked, the panel has room, and a first
    // install starts with Relationships.
    to: 9,
    run(saved, was) {
      if (was && !was.existing) return;
      saved.panelRelationships = false;
      saved.panelPlaces = false;
    },
  },
  {
    // Mind maps took the canvas maps' choices here; they're gone (step 26), so nothing to carry.
    to: 10,
    run() {},
  },
  {
    // And their tools' choices: gone with them too.
    to: 11,
    run() {},
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
    // 3.0: canvas maps are gone. Their settings go with them. Canvases
    // themselves are untouched.
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
    // The strip and the moved gear are off to begin with now, and the look stays on what the plugin draws.
    // Whoever already had the plugin keeps them as they were.
    to: 16,
    run(saved, was) {
      if (!was || !was.existing) return;
      if (saved.contextStrip === undefined) saved.contextStrip = true;
      if (saved.settingsInHeader === undefined) saved.settingsInHeader = true;
      if (saved.lookScope === undefined) saved.lookScope = 'window';
      // The panel used to hide the note's own properties whenever it was on.
      if (saved.hideNativeProperties === undefined) saved.hideNativeProperties = saved.propertiesDropdown !== false;
    },
  },
  {
    // Classic, kept for one release after 2.0, goes: the theme's look with
    // what it hid switched off — the note page's additions, row excerpts, glass.
    to: 17,
    run(saved) {
      if (saved.look !== 'classic') return;
      Object.assign(saved, { look: 'theme', notePage: false, albumExcerpts: false, glassPanels: false });
    },
  },
  // Steps 18–24 belonged to the versions after 3.0.25 and are gone with them.
  // A vault that ran them is at 24, one on 3.0.25 at 17: 25 and 26 suit both.
  {
    // Back to 3.0.25 from the plain names, the one Clear look and covers off by default.
    to: 25,
    run(saved) {
      Object.entries(UNRENAMED_KEYS).forEach(([now, was]) => {
        if (now in saved) {
          saved[was] = saved[now];
          delete saved[now];
        }
      });
      if (saved.look === 'clear') delete saved.look;
      ['motion', 'hideRightSidebar', 'pinsLarge', 'showCovers'].forEach((key) => delete saved[key]);
    },
  },
  {
    // Maps, due dates, workspace modes, reading history, the reading outline,
    // Study, relationships and the knowledge check, quiet links, a folder's
    // tabs and covers for notes go, with their settings and places. Notes
    // keep their text and properties: what relationships wrote stays in them,
    // [[[quiet links]]] stay as typed, and a saved layout of overview or map
    // opens as a list.
    to: 26,
    run(saved) {
      Object.keys(saved).forEach((key) => {
        if (/^(mindmap|workspaceMode|study|knowledge|reading(History|Log|Since|Outline)$|propertyDue)/.test(key)) delete saved[key];
      });
      ['albumProgressRing', 'albumRecents', 'albumMapAuto', 'albumMapWritesParent', 'presentDimLevel', 'canvasSpacing', 'fromReadingDays', 'rememberPlace', 'propertyValueView', 'outlineWordCounts', 'stripProgress', 'quietLinks', 'panelRelationships', 'canvasRelationNames', 'canvasRelationTypes'].forEach((key) => delete saved[key]);
      if (saved.libraryLayout === 'covers') saved.libraryLayout = 'auto';
      const gone = ['read', 'highlights', 'knowledge-check'];
      if (Array.isArray(saved.librarySections)) {
        saved.librarySections.forEach((sec) => {
          if (sec && Array.isArray(sec.items)) sec.items = sec.items.filter((i) => !(i && i.kind === 'builtin' && gone.includes(i.id)));
        });
      }
      if (Array.isArray(saved.homeShelves)) saved.homeShelves = saved.homeShelves.filter((sh) => !(sh && ['continue', 'revisit', 'fromReading'].includes(sh.id)));
      if (saved.keepOwnOrder && typeof saved.keepOwnOrder === 'object') delete saved.keepOwnOrder.read;
      if (Array.isArray(saved.smartAlbumList)) saved.smartAlbumList = saved.smartAlbumList.filter((a) => !(a && a.prop && a.prop.due));
    },
  },
  {
    // Two settings nothing read any more.
    to: 27,
    run(saved) {
      delete saved.settingsLevel;
      delete saved.libraryPreview;
    },
  },
  {
    // The sidebar laid out as a music app's (LIBRARY_LAYOUT): places to start,
    // Library, Tools, Views with the bases, then Folders; More is gone. Only a
    // sidebar still in the plugin's own sections is laid out again, keeping
    // what it held; one arranged by hand keeps its shape.
    to: 28,
    run(saved) {
      const secs = saved.librarySections;
      if (!Array.isArray(secs) || !secs.length) return;
      const stock = ['', 'Recent', 'More', 'Folders', 'Bases'];
      if (!secs.every((s) => s && stock.indexOf(s.title || '') !== -1)) return;
      const items = (s) => (Array.isArray(s.items) ? s.items : []);
      const titled = (t) => [].concat(...secs.filter((s) => (s.title || '') === t).map(items));
      const all = [].concat(...secs.map(items)).filter(Boolean);
      const has = all.filter((i) => i.kind === 'builtin').map((i) => (i.id === 'all' ? 'notes' : i.id));
      if (has.indexOf('random') === -1) has.push('random');
      const folders = titled('Folders');
      const bases = titled('Bases');
      const others = all.filter((i) => i.kind !== 'builtin' && folders.indexOf(i) === -1 && bases.indexOf(i) === -1);
      const out = libraryLayout(has, folders, bases);
      if (others.length) {
        const library = out.find((s) => s.title === 'Library');
        if (library) library.items.push(...others);
        else out.push({ title: 'Library', items: others });
      }
      saved.librarySections = out;
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
    // A folder's cover is an image by its path: the image moved, the cover follows it.
    const covers = this.settings.folderCovers || {};
    Object.keys(covers).forEach((p) => {
      const moved = movedPath(covers[p], oldPath, file.path);
      if (moved !== covers[p]) {
        covers[p] = moved;
        changed = true;
      }
    });
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
    // The image a folder's cover was, gone: the folder has none.
    const covers = this.settings.folderCovers || {};
    Object.keys(covers).forEach((p) => {
      if (covers[p] === file.path || String(covers[p]).startsWith(file.path + '/')) {
        delete covers[p];
        changed = true;
      }
    });
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

/**
 * The notes of the album a file is in, in the album's order — its own
 * arrangement if it has one on, otherwise the shared order. The folder
 * note stands for the album, so it isn't one of them.
 */
export function albumSequence(plugin, file) {
  const folder = file && file.parent;
  if (!folder) return [];
  const files = (folder.children || []).filter((c) => c instanceof TFile && !plugin.isFolderNote(c));
  const sort = plugin.settings.defaultSort || 'name';
  return plugin.orders.arrangeAlbum(folder, files, (list) => sortByOrder(list, sort));
}

/** The note before and after one in its album. */
export function albumNeighbours(plugin, file) {
  const list = albumSequence(plugin, file);
  const at = list.indexOf(file);
  if (at === -1) return { previous: null, next: null, index: -1, total: list.length };
  return { previous: list[at - 1] || null, next: list[at + 1] || null, index: at, total: list.length };
}
