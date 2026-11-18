/* ------------------------------------------------------------------ */
/* Migration: the old plugin's data.json, converted once               */
/*                                                                     */
/* Every key the old plugin kept is here in one of three lists: kept   */
/* under the same name (it is in DEFAULTS), renamed, or retired with   */
/* the reason. Nothing is thrown away: the caller keeps the whole old  */
/* file beside the new one as data.legacy.json. Notes are not touched. */
/* ------------------------------------------------------------------ */

import { DEFAULTS, REWRITE_VERSION, SETTINGS_VERSION } from './settings.js';

/** Old keys whose thing is gone, and why. Their values stay in data.legacy.json. */
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
  hideNativeProperties: 'the look hides nothing of Obsidian\'s own (docs/DESIGN.md, Conflicts 1)',
  propertiesSort: 'the old screen of every property',
  // Retired by the direction reset (docs/direction-reset.md); their values are kept under `retired` (settings 102).
  alwaysShowLabels: 'the reset: a folder is its name, always shown',
  libraryZoom: 'the reset: one view of a collection, no zoom levels',
  folderGlyphs: 'the reset: no generated glyphs; a folder is its name or its cover image',
  tableColumns: 'the reset: a folder\'s notes are one list, not a table',
  coverFromFolder: 'the reset: a note is its name; covers stand for folders only',
  stripPlace: 'the reset: the strip is one line, its place always "21 / 24"',
  stripDetail: 'the reset: the strip is one line, with no property beside it',
  albumStillToWrite: 'the reset: no switch that only chose what a page showed',
  propertyValueChips: 'the reset: no colour on a value; a value is its words',
  propertyOptions: 'the reset: no colour on a value; the colours the old plugin gave values are kept here, unread',
  ...Object.fromEntries(['albumStructure', 'albumRefactor', 'propertyForAlbum', 'smartAlbums', 'libraryCheck', 'footnotes', 'scripts', 'graph3d', 'propertySchemaMarks', 'graphRoutes', 'graphProperties', 'navDropdown', 'menuFilter']
    .map((k) => [k, 'the settings cut: a feature that only adds commands or marks has no switch; it is always there'])),
  folderCovers: 'covers are gone: the library is one ruled list, with no grid to show an image in',
  coverProperty: 'covers are gone: a note\'s cover property is left in the note, unread',
  coverDrop: 'covers are gone: an image dropped on a folder is no longer its cover',
  coverFromFirstImage: 'covers are gone',
  notePageChips: 'the reset: the note\'s head always shows its main properties on a line; no switch that only chose what a page showed',
  ...Object.fromEntries(['Chrome', 'Tabs', 'Sidebars', 'Editor', 'Overlays', 'Library', 'Note', 'Strip', 'Panel', 'Canvas', 'Graph', 'Maps', 'Icons', 'Compat']
    .map((r) => [`lookRegion${r}`, 'the reset: no switch a region; the look is on or off, on what the plugin draws or the whole window'])),
};

/** The 4.0 keys the direction reset retired: their values are moved under `retired` once, not dropped. */
const RESET_RETIRED = Object.keys(RETIRED).filter((k) => /^(alwaysShowLabels|libraryZoom|folderGlyphs|tableColumns|lookRegion|coverFromFolder|stripPlace|stripDetail|albumStillToWrite|propertyValueChips|propertyOptions|notePageChips|folderCovers|coverProperty|coverDrop|coverFromFirstImage|albumStructure|albumRefactor|propertyForAlbum|smartAlbums|libraryCheck|footnotes|scripts|graph3d|propertySchemaMarks|graphRoutes|graphProperties|navDropdown|menuFilter)$/.test(k) || /^(alwaysShowLabels|libraryZoom|folderGlyphs|tableColumns|lookRegion)/.test(k));

/** Old keys that live on under another name. */
export const RENAMED = {};

/**
 * The new settings from what data.json held. Returns { settings, legacy }:
 * `legacy` is the old file's contents when it was the old plugin's (to be
 * kept as data.legacy.json), or null when there is nothing to convert.
 */
export function migrateSettings(saved) {
  const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const settings = copy(DEFAULTS);
  if (!saved || typeof saved !== 'object') return { settings, legacy: null };
  const version = saved.settingsVersion || 1;
  const old = version < REWRITE_VERSION;
  Object.keys(saved).forEach((key) => {
    const to = RENAMED[key] || key;
    if (key === 'settingsVersion' || !(to in DEFAULTS)) return;
    const [value, fallback] = [saved[key], DEFAULTS[to]];
    // A value of the wrong kind (a hand-edited file) gives way to the default.
    const fits = fallback === null || value === null ? value !== undefined : Array.isArray(fallback) === Array.isArray(value) && typeof fallback === typeof value;
    if (fits) settings[to] = copy(value);
  });
  if (old) {
    // The old looks (classic, editorial and the rest) all become the one new look; lookScope is kept as it was.
    settings.look = 'redux';
    // The properties panel took over the inspector's switch.
    if (saved.propertyInspector === false) settings.inspector = false;
  }
  // 102: the direction reset retired what it cut; 103: covers; 104: the settings cut. A 4.0 file's values for those keys are kept under `retired`.
  if (version >= REWRITE_VERSION && version < SETTINGS_VERSION) {
    const kept = {};
    RESET_RETIRED.forEach((k) => { if (saved[k] !== undefined) kept[k] = copy(saved[k]); });
    if (Object.keys(kept).length) settings.retired = Object.assign({}, settings.retired, kept);
  }
  settings.settingsVersion = SETTINGS_VERSION;
  return { settings, legacy: old ? copy(saved) : null };
}
