/* ------------------------------------------------------------------ */
/* Settings: where each row sits                                      */
/*                                                                    */
/* The tabs, each feature's row in them (its switch, and the keys     */
/* its gear opens), the look's rows, the presets, and the tabs that   */
/* went. The settings tab (360) draws what this says.                 */
/* ------------------------------------------------------------------ */

export const SETTINGS_TABS = [
  {
    id: 'general',
    title: 'General',
    features: [
      {
        id: 'home',
        icon: 'home',
        name: 'Home screen',
        desc: 'What the library opens with: its shelves.',
        keys: ['homePath', 'homeShelves'],
      },
      {
        id: 'strip',
        icon: 'panel-bottom',
        name: 'Context strip and modes',
        desc: 'The bar along the bottom, one page, and the sidebar header.',
        switch: 'contextStrip',
        keys: ['workspaceModes', 'onePage', 'stripPlace', 'stripDetail', 'singleArea', 'navDropdown', 'ribbonInMenu', 'settingsInHeader', 'swipeSidebars', 'stripSide'],
      },
    ],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    features: [
      {
        id: 'covers',
        icon: 'image',
        name: 'Covers',
        desc: 'Where covers come from, and how the made ones look.',
        keys: ['coverDrop', 'coverProperty', 'coverFromFirstImage', 'coverFromFolder', 'coverFallback', 'coverPrint', 'generatedCoverColor'],
      },
    ],
  },
  {
    id: 'library',
    title: 'Library',
    features: [
      {
        id: 'library',
        icon: 'library',
        name: 'Library',
        desc: 'Folders as albums, notes as tracks, and a sidebar to browse them.',
        switch: 'library',
        keys: ['libraryLayout', 'inspector', 'inspectorClick', 'hideEmptyFolders', 'sidebarDrop', 'defaultSort', 'albumSortMemory', 'typeToJump', 'searchNoteText', 'albumColumns', 'albumExcerpts', 'albumStillToWrite', 'albumNestBy', 'trackLength', 'tileGroups', 'categoryProperty', 'smartAlbums', 'albumStructure', 'albumRollups', 'albumRecents', 'libraryCheck', 'libraryInbox', 'albumRefactor', 'hideFolderNotes', 'folderNoteName', 'librarySections', 'discNoteLimit', 'albumNoteLimit', 'tableColumns', 'albumKeyNames', 'rollupDateKey', 'thinNoteWords'],
      },
    ],
  },
  {
    id: 'notes',
    title: 'Notes',
    features: [
      {
        id: 'notePage',
        icon: 'file-text',
        name: 'Note page',
        desc: 'A note’s collection, details, property chips and shelves.',
        switch: 'notePage',
        keys: ['notePageShelves', 'notePageTint', 'notePageChips'],
      },
      {
        id: 'writing',
        icon: 'pen-line',
        name: 'Writing extras',
        desc: 'Footnotes, superscripts, lettered lists and image folders.',
        keys: ['footnotes', 'footnotesAside', 'footnoteOrder', 'letterLists', 'romanLists', 'scripts', 'routeImages', 'scriptSyntax', 'autoOrdinals', 'imageFolder'],
      },
      {
        id: 'pages',
        icon: 'files',
        name: 'Pages',
        desc: 'Several pages in one note, switched under its title.',
        switch: 'notePages',
        keys: [],
      },
    ],
  },
  {
    id: 'inspector',
    title: 'Inspector',
    features: [
      {
        id: 'properties',
        icon: 'list',
        name: 'Properties panel',
        desc: 'Where a note is edited: its properties and places.',
        switch: 'propertiesDropdown',
        keys: ['hideNativeProperties', 'panelPropertiesView', 'panelPrimaryProps', 'panelPropertyGroups', 'propertyForAlbum', 'propertySchemaMarks', 'propertyInspector', 'propertyInlineEdit', 'propertyLinks', 'propertyValueChips', 'propertyDueChips', 'propertyRulesOn', 'showMentions', 'panelPlaces', 'panelGroupList', 'propertyHistoryLimit', 'propertyDueKeys', 'propertyRulesDryRun'],
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    features: [
      {
        id: 'graph',
        icon: 'share-2',
        name: 'Graph',
        desc: 'Filter the graph by a property, and route links through notes.',
        switch: 'graphProperties',
        keys: ['graphRoutes', 'graphRouteProperty'],
      },
      {
        id: 'compat',
        icon: 'shield-check',
        name: 'Compatibility',
        desc: 'What Design Redux relies on in Obsidian, and whether it works.',
        keys: ['compatibility'],
      },
    ],
  },
];

/** The rows above every tab: how the plugin looks, wherever you are. */
export const LOOK_KEYS = ['look', 'lookScope', 'glassPanels', 'gridDensity', 'artworkSize', 'iconMode'];

/** Where each setting sat before the four places, so a search for the old tab's name still finds it. */
/** Every key a feature's row holds: its switch, then what its gear opens. */
export const featureKeys = (feature) => (feature.switch ? [feature.switch] : []).concat(feature.keys || []);

/**
 * What each switch is set to by a preset. Minimal keeps the library and
 * the note page; Everything turns every switch on; Standard is the
 * everyday set. A preset only flips switches; each can be changed after.
 */
export const SETTING_PRESETS = {
  minimal: { name: 'Minimal', on: ['library', 'notePage'] },
  // Without the strip, as a first install has it: « » sit in the note's header, Properties in the inspector.
  standard: { name: 'Standard', on: ['library', 'notePage', 'propertiesDropdown'] },
  everything: { name: 'Everything', on: null },
};

export const FORMER_TABS = {
  Appearance: ['look', 'lookScope', 'glassPanels', 'gridDensity', 'artworkSize'],
  Library: ['library', 'libraryLayout', 'homePath', 'homeShelves', 'inspector', 'inspectorClick', 'hideEmptyFolders', 'sidebarDrop', 'librarySections', 'defaultSort', 'albumSortMemory', 'typeToJump', 'discNoteLimit', 'albumNoteLimit', 'albumColumns', 'albumExcerpts', 'albumStillToWrite', 'albumNestBy', 'trackLength', 'tileGroups', 'tableColumns', 'categoryProperty', 'searchNoteText', 'albumStructure', 'albumKeyNames', 'albumRollups', 'rollupDateKey', 'smartAlbums', 'libraryCheck', 'libraryInbox', 'thinNoteWords', 'albumRefactor', 'folderNoteName', 'hideFolderNotes', 'coverProperty', 'coverDrop', 'coverFromFirstImage', 'coverFromFolder', 'coverFallback', 'generatedCoverColor', 'coverPrint'],
  Notes: ['notePage', 'notePageTint', 'notePageChips', 'notePageShelves', 'letterLists', 'romanLists', 'scripts', 'scriptSyntax', 'autoOrdinals', 'propertiesDropdown', 'panelPropertiesView', 'panelPrimaryProps', 'panelPropertyGroups', 'panelGroupList', 'propertyForAlbum', 'propertySchemaMarks', 'propertyInspector', 'propertyInlineEdit', 'propertyLinks', 'propertyValueChips', 'propertyHistoryLimit', 'propertyDueChips', 'propertyDueKeys', 'propertyRulesOn', 'propertyRulesDryRun', 'showMentions', 'panelPlaces', 'footnotes', 'footnotesAside', 'footnoteOrder', 'routeImages', 'imageFolder'],
  Workspace: ['contextStrip', 'stripPlace', 'stripDetail', 'onePage', 'singleArea', 'navDropdown', 'ribbonInMenu', 'settingsInHeader', 'graphProperties', 'graphRoutes', 'graphRouteProperty'],
  Advanced: ['compatibility'],
  // 3.0's last tab, before the tabs went by task.
  Tools: ['contextStrip', 'stripPlace', 'stripDetail', 'stripSide', 'graphProperties', 'graphRoutes', 'graphRouteProperty', 'compatibility'],
};
