/* ------------------------------------------------------------------ */
/* Settings: every key the plugin keeps in data.json, and its default  */
/*                                                                     */
/* The names are the old plugin's wherever the thing is still there,   */
/* so a vault's data.json opens with nothing to redo (core/migrate.js  */
/* converts it once). A key that is keyed by a path, or holds paths,   */
/* is listed below so it follows a rename and a delete.                */
/* ------------------------------------------------------------------ */

/** The regions of the look, each with a body class and a setting of its own. */
export const REGIONS = ['chrome', 'tabs', 'sidebars', 'editor', 'overlays', 'library', 'note', 'strip', 'panel', 'canvas', 'graph', 'maps', 'icons', 'compat'];

/** The regions that are Obsidian's own: off when the look is kept to what the plugin draws. */
export const OBSIDIAN_REGIONS = ['chrome', 'tabs', 'sidebars', 'editor', 'overlays', 'canvas', 'graph', 'icons', 'compat'];

/** Marks a data.json this plugin wrote; the old plugin's stopped at 34. Each step past 100 is one change of a default, made once (core/migrate.js). */
export const SETTINGS_VERSION = 103;

/** A data.json marked lower is the old plugin's, converted once. */
export const REWRITE_VERSION = 100;

export const DEFAULTS = {
  settingsVersion: SETTINGS_VERSION,
  retired: {}, // values of keys the direction reset retired (settings 102), kept, not read

  // The look
  look: 'redux', // 'theme' leaves the window to the person's theme
  lookScope: 'plugin', // 'window': Obsidian's own regions too; 'plugin': only what the plugin draws

  // The library
  library: true,
  coverColors: {}, // by folder path: one of Obsidian's named colours (red, orange, yellow, green, cyan, blue, purple, pink), or an old hex kept as it was
  defaultSort: 'name',
  albumSorts: {}, // by folder path: the order chosen there
  albumSortMemory: true,
  albumOrders: {}, // by folder path: { names: [...] }, the person's own order
  pinOrder: [],
  hideEmptyFolders: true,
  hideFolderNotes: true,
  folderNoteName: '{{folder}}',
  typeToJump: true,
  sidebarDrop: true,
  searchNoteText: true,
  recentSearches: [],
  categoryProperty: 'domain',
  navDropdown: true,

  // Folders as collections
  albumStructure: true,
  albumKeyNames: {},
  albums: {}, // by folder path: { includes, related, featured }
  albumNestBy: 'parent',
  albumRollups: false,
  rollupDateKey: '',
  albumRefactor: true,
  propertyForAlbum: true,
  smartAlbums: true,
  smartAlbumList: [],
  libraryCheck: true,
  libraryInbox: true,

  // The note
  notePage: true,
  notePages: true,
  pagesOpen: {}, // by note path: the page left open
  footnotes: true,
  footnoteOrder: true,
  footnotesAside: true,
  scripts: true,
  scriptSyntax: 'short',
  autoOrdinals: false,
  letterLists: true,
  romanLists: true,
  routeImages: false,
  imageFolder: 'attachments',

  // The panel
  propertiesDropdown: true,
  inspector: true,
  panelPrimaryProps: 'type, domain, status',
  panelPropertyGroups: 'off',
  panelGroupList: [
    { title: 'General', keys: 'type, domain, status' },
    { title: 'Relationships', keys: 'parent, broader, narrower, related' },
    { title: 'Information', keys: 'created, modified' },
  ],
  panelFoldedGroups: [],
  panelFolderViews: {},
  showMentions: true,
  propertyLinks: true,

  // The strip
  contextStrip: false,

  // Property tools
  propertySets: {},
  folderDefaults: {},
  propertySchemas: {},
  propertySchemaMarks: true,
  propertyHistory: {},
  propertyHistoryLimit: 0,
  propertyRules: [],
  propertyRulesOn: false,
  propertyRulesDryRun: true,

  // The graph
  graphProperties: true,
  graphFilters: {},
  graphRoutes: true,
  graphRouting: {},
  graphRouteProperty: 'parent',
  graph3d: true,

  // Obsidian's menus
  menuFilter: true,
};

/** Settings whose keys are paths: a rename moves the key, a delete drops it. */
export const PATH_KEYED = ['albums', 'coverColors', 'albumSorts', 'albumOrders', 'folderDefaults', 'propertySchemas', 'propertyHistory', 'panelFolderViews', 'pagesOpen'];

/** `path` after `from` became `to`: itself, or moved with the folder it was under. */
export function movedPath(path, from, to) {
  if (path === from) return to;
  return String(path).startsWith(`${from}/`) ? to + String(path).slice(from.length) : path;
}

/**
 * The settings after a file or folder moved from `from` to `to`. Changes
 * `settings` in place; returns whether anything changed.
 */
export function followRename(settings, from, to, isFolder) {
  let changed = false;
  PATH_KEYED.forEach((key) => {
    const kept = settings[key] || {};
    if (!Object.keys(kept).some((p) => movedPath(p, from, to) !== p)) return;
    settings[key] = Object.fromEntries(Object.keys(kept).map((p) => [movedPath(p, from, to), kept[p]]));
    changed = true;
  });
  const lists = [[settings, 'pinOrder']].concat(Object.values(settings.albums || {}).flatMap((a) => ['includes', 'related', 'featured'].map((f) => [a, f])));
  lists.forEach(([holder, field]) => {
    const list = holder && holder[field];
    if (!Array.isArray(list)) return;
    const moved = list.map((p) => movedPath(p, from, to));
    if (moved.some((p, i) => p !== list[i])) {
      holder[field] = moved;
      changed = true;
    }
  });
  if (!isFolder) {
    // A note keeps its place in its folder's own order when renamed there, and leaves it when moved away.
    const parent = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/');
    const [oldName, newName] = [from.split('/').pop(), to.split('/').pop()];
    const order = (settings.albumOrders || {})[parent(from)];
    if (order && Array.isArray(order.names) && order.names.includes(oldName)) {
      order.names = parent(from) === parent(to) ? order.names.map((n) => (n === oldName ? newName : n)) : order.names.filter((n) => n !== oldName);
      changed = true;
    }
  }
  return changed;
}

/** The settings after a file or folder at `gone` was deleted. Changes `settings` in place; returns whether anything changed. */
export function followDelete(settings, gone) {
  let changed = false;
  const under = (p) => p === gone || String(p).startsWith(`${gone}/`);
  PATH_KEYED.forEach((key) => {
    const kept = settings[key] || {};
    Object.keys(kept).filter(under).forEach((p) => {
      delete kept[p];
      changed = true;
    });
  });
  const lists = [[settings, 'pinOrder']].concat(Object.values(settings.albums || {}).flatMap((a) => ['includes', 'related', 'featured'].map((f) => [a, f])));
  lists.forEach(([holder, field]) => {
    const list = holder && holder[field];
    if (!Array.isArray(list) || !list.some(under)) return;
    holder[field] = list.filter((p) => !under(p));
    changed = true;
  });
  const parent = gone.includes('/') ? gone.slice(0, gone.lastIndexOf('/')) : '/';
  const order = (settings.albumOrders || {})[parent];
  const name = gone.split('/').pop();
  if (order && Array.isArray(order.names) && order.names.includes(name)) {
    order.names = order.names.filter((n) => n !== name);
    changed = true;
  }
  return changed;
}
