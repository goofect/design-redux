/* ------------------------------------------------------------------ */
/* Migration: the old plugin's data.json, converted once               */
/*                                                                     */
/* Every key the old plugin kept is here in one of three lists: kept   */
/* under the same name (it is in DEFAULTS), renamed, or retired with   */
/* the reason. A retired key's value is dropped, not kept unread.      */
/* Notes are not touched.                                              */
/* ------------------------------------------------------------------ */

import { copyValue } from './notes.js';
import { DEFAULTS, REWRITE_VERSION, SETTINGS_VERSION } from './settings.js';

/** The 4.0 keys retired since (102 the reset, 103 covers, 104 the settings cut, 105 the image router, 106 the panel and property history, 107 folder colours and rollups, and unused values no longer kept, 109 the strip, 110 and 111 the fixed defaults). */
const RETIRED_SINCE_4 = {
  alwaysShowLabels: 'the reset: a folder is its name, always shown',
  libraryZoom: 'the reset: one view of a collection, no zoom levels',
  folderGlyphs: 'the reset: no generated glyphs; a folder is its name or its cover image',
  tableColumns: 'the reset: a folder\'s notes are one list, not a table',
  coverFromFolder: 'the reset: a note is its name; covers stand for folders only',
  stripPlace: 'the reset: the strip is one line, its place always "21 / 24"',
  stripDetail: 'the reset: the strip is one line, with no property beside it',
  albumStillToWrite: 'the reset: no switch that only chose what a page showed',
  propertyValueChips: 'the reset: no colour on a value; a value is its words',
  propertyOptions: 'the reset: no colour on a value',
  ...Object.fromEntries(['albumStructure', 'albumRefactor', 'propertyForAlbum', 'smartAlbums', 'libraryCheck', 'footnotes', 'scripts', 'graph3d', 'propertySchemaMarks', 'graphRoutes', 'graphProperties', 'navDropdown', 'menuFilter']
    .map((k) => [k, 'the settings cut: a feature that only adds commands or marks has no switch; it is always there'])),
  folderCovers: 'covers are gone: the library is one ruled list, with no grid to show an image in',
  coverProperty: 'covers are gone: a note\'s cover property is left in the note',
  coverDrop: 'covers are gone: an image dropped on a folder is no longer its cover',
  coverFromFirstImage: 'covers are gone',
  ...Object.fromEntries(['propertiesDropdown', 'inspector', 'panelPropertyGroups', 'panelGroupList', 'panelFoldedGroups', 'showMentions', 'propertyLinks']
    .map((k) => [k, 'the panel is gone: a note\'s properties are its ledger, under its title; the right sidebar stays hidden'])),
  propertyHistory: 'property history is gone: it had no place to be seen without the panel',
  propertyHistoryLimit: 'property history is gone',
  coverColors: 'a folder\'s colour is gone: black, white and one grey',
  albumRollups: 'counts are gone: a folder shows no "8 of 20 done"',
  rollupDateKey: 'counts are gone',
  footnotesAside: 'the footnotes list beside the note is gone (it stood in the sidebar the look hides): Go to footnote picks one in the palette',
  contextStrip: 'the strip is gone: its place in the folder ("21 / 24") was a count; Previous and Next are commands',
  retired: 'unused values are not kept: a retired key\'s value is dropped',
  ...Object.fromEntries(['albumSortMemory', 'hideEmptyFolders', 'hideFolderNotes', 'typeToJump', 'sidebarDrop', 'searchNoteText', 'albumNestBy', 'libraryInbox', 'footnoteOrder', 'scriptSyntax', 'letterLists', 'romanLists']
    .map((k) => [k, 'the fixed defaults: a setting nothing could change is the behaviour it chose, always'])),
  folderNoteName: 'the fixed defaults: a folder\'s own note has the folder\'s name, the one convention',
  albumKeyNames: 'the fixed defaults: a folder note\'s description, includes, related and featured are read by those names',
  categoryProperty: 'the fixed defaults: an empty search shows the recent ones only; Filter… finds notes by a property\'s value',
  autoOrdinals: 'the fixed defaults: 1st and 2nd are left as written; it was off and nothing could turn it on',
  routeImages: 'the image router is gone: Obsidian\'s own setting says where a pasted image goes',
  imageFolder: 'the image router is gone',
  notePageChips: 'the reset: the note\'s head always shows its main properties on a line; no switch that only chose what a page showed',
  ...Object.fromEntries(['Chrome', 'Tabs', 'Sidebars', 'Editor', 'Overlays', 'Library', 'Note', 'Strip', 'Panel', 'Canvas', 'Graph', 'Maps', 'Icons', 'Compat']
    .map((r) => [`lookRegion${r}`, 'the reset: no switch a region; the look is on or off, on what the plugin draws or the whole window'])),
};

/** Old keys whose thing is gone, and why. Their values are dropped. */
export const RETIRED = {
  singleArea: 'cut: the one-page layout',
  onePage: 'cut: the one-page layout',
  settingsInHeader: 'cut: the settings button in the header',
  swipeSidebars: 'cut: swiping the sidebars (the plugin is desktop only)',
  ribbonInMenu: 'cut with the old actions menu: the ribbon stays where Obsidian puts it',
  headerOrder: 'the old header\'s own order of buttons: the new head rows have none',
  pinsExpanded: 'the old sidebar\'s folded Pinned section',
  librarySections: 'the old sidebar\'s sections: the library is one place at three levels now',
  homeShelves: 'the old home screen\'s shelves',
  libraryLayout: 'covers or lists: now the zoom control, kept by window (libraryZoom)',
  gridDensity: 'the old cover sizes: cells are cut from the width now',
  artworkSize: 'the old artwork size',
  tileGroups: 'the old tiles\' grouping',
  showArt: 'small covers beside names: the new look shows glyphs, not art',
  iconMode: 'the old icon style',
  coverPrint: 'words printed on a generated cover: generated cover art is gone',
  coverFallback: 'what stood in for a missing cover: now always the folder\'s glyph',
  coverDesigns: 'the drawn cover of each folder: generated cover art is gone (folderGlyphs takes its place)',
  generatedCoverColor: 'the colour of generated covers',
  albumNoteLimit: 'how many notes the old album page showed before folding',
  discNoteLimit: 'how many notes the old album page showed a disc',
  albumExcerpts: 'the grey line under a note in the old album page',
  keepOwnOrder: 'the own order of the old Recents and Pinned lists',
  stripSide: 'the old strip could sit at the top: it is a bar at the foot now',
  panelPropertiesView: 'compact or full: the panel has one kind of row now',
  panelPropsCollapsed: 'the panel\'s folded Properties section',
  panelPlaces: 'the panel\'s Places section',
  propertyInspector: 'folded into the inspector setting',
  propertyInlineEdit: 'a value is always edited in place now',
  homePath: 'the old home screen\'s note: the library\'s top level is home now',
  albumColumns: 'the old album page\'s columns: a folder\'s table takes tableColumns',
  notePageShelves: 'moved: what a note links to and where it is mentioned are in the panel',
  notePageNext: 'moved: the notes before and after are the strip\'s',
  inspectorClick: 'a click picks and a second opens, always',
  hideNativeProperties: 'the look hides nothing of Obsidian\'s own',
  propertiesSort: 'the old screen of every property',
  ...RETIRED_SINCE_4,
};


/** Old keys that live on under another name. */
export const RENAMED = {};

/**
 * The new settings from what data.json held. Returns { settings, converted }:
 * `converted` when the file was written by an older version (to be saved
 * at once, so what it held that is no longer read goes).
 */
export function migrateSettings(saved) {
  const settings = copyValue(DEFAULTS);
  if (!saved || typeof saved !== 'object') return { settings, converted: false };
  const version = saved.settingsVersion || 1;
  const old = version < REWRITE_VERSION;
  Object.keys(saved).forEach((key) => {
    const to = RENAMED[key] || key;
    if (key === 'settingsVersion' || !(to in DEFAULTS)) return;
    const [value, fallback] = [saved[key], DEFAULTS[to]];
    // A value of the wrong kind (a hand-edited file) gives way to the default.
    const fits = fallback === null || value === null ? value !== undefined : Array.isArray(fallback) === Array.isArray(value) && typeof fallback === typeof value;
    if (fits) settings[to] = copyValue(value);
  });
  if (old) {
    // The old looks (classic, editorial and the rest) all become the one new look; lookScope is kept as it was.
    settings.look = 'redux';
  }
  settings.settingsVersion = SETTINGS_VERSION;
  return { settings, converted: version < SETTINGS_VERSION };
}
