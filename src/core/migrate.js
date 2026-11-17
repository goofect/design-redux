/* ------------------------------------------------------------------ */
/* Migration: the old plugin's data.json, converted once               */
/*                                                                     */
/* Every key the old plugin kept is here in one of three lists: kept   */
/* under the same name (it is in DEFAULTS), renamed, or retired with   */
/* the reason. Nothing is thrown away: the caller keeps the whole old  */
/* file beside the new one as data.legacy.json. Notes are not touched. */
/* ------------------------------------------------------------------ */

import { DEFAULTS, SETTINGS_VERSION } from './settings.js';

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
};

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
  const old = (saved.settingsVersion || 1) < SETTINGS_VERSION;
  Object.keys(saved).forEach((key) => {
    const to = RENAMED[key] || key;
    if (key === 'settingsVersion' || !(to in DEFAULTS)) return;
    const [value, fallback] = [saved[key], DEFAULTS[to]];
    // A value of the wrong kind (a hand-edited file) gives way to the default.
    const fits = fallback === null || value === null ? value !== undefined : Array.isArray(fallback) === Array.isArray(value) && typeof fallback === typeof value;
    if (fits) settings[to] = copy(value);
  });
  // The removed custom sort falls back to name; keep its saved order data intact.
  if (settings.defaultSort === 'own') settings.defaultSort = 'name';
  Object.keys(settings.albumSorts || {}).forEach((path) => {
    const sort = settings.albumSorts[path];
    if (sort === 'own') settings.albumSorts[path] = 'name';
    else if (sort && typeof sort === 'object' && sort.by === 'own') sort.by = 'name';
  });
  if (old) {
    // The old looks (classic, editorial and the rest) all become the one new look; lookScope is kept as it was.
    settings.look = 'redux';
    // The properties panel took over the inspector's switch.
    if (saved.propertyInspector === false) settings.inspector = false;
  }
  settings.settingsVersion = SETTINGS_VERSION;
  return { settings, legacy: old ? copy(saved) : null };
}
