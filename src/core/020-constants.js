export const LIBRARY_VIEW = 'design-redux-library';
export const BROWSE_VIEW = 'design-redux-browse';
// The note panel docked in the right sidebar. The old inspector's type (design-redux-inspector) is still closed on load.
export const INSPECTOR_VIEW = 'design-redux-properties';

/* Destinations that aren't a file or folder. */
/* The browse screen each built-in entry opens, which is also how the
   sidebar knows which entry to highlight while that screen is up. */
export const BUILTIN_SCREENS = {
  home: 'home',
  search: 'search',
  folders: 'folders',
  notes: 'notes',
  properties: 'properties',
  recents: 'recents',
  added: 'added',
  read: 'read',
  subjects: 'subjects',
  collections: 'collections',
  bookmarks: 'pinned',
  inbox: 'inbox',
  'library-check': 'library-check',
  'knowledge-check': 'knowledge-check',
};

export const LIBRARY_BUILTINS = {
  search: { label: 'Search', icon: 'search' },
  home: { label: 'Home', icon: 'home' },
  graph: { label: 'Graph', icon: 'git-fork' },
  bookmarks: { label: 'Pinned', icon: 'pin' },
  recents: { label: 'Recently opened', icon: 'clock' },
  added: { label: 'Recently added', icon: 'calendar-plus' },
  read: { label: 'Recently read', icon: 'book-check' },
  subjects: { label: 'Subjects', icon: 'book' },
  collections: { label: 'Views', icon: 'library' },
  properties: { label: 'Properties', icon: 'tags' },
  folders: { label: 'Collections', icon: 'folder' },
  notes: { label: 'All Notes', icon: 'file-text' },
  random: { label: 'Random note', icon: 'dice' },
  // The plugin's own settings, from the library rather than a gear moved into Obsidian's header.
  settings: { label: 'Settings', icon: 'settings' },
  smart: { label: 'Saved views', icon: 'sparkles' },
  inbox: { label: 'Inbox', icon: 'inbox' },
  'library-check': { label: 'Library check', icon: 'stethoscope', needs: 'libraryCheck' },
  'knowledge-check': { label: 'Knowledge check', icon: 'network', needs: 'knowledgeCheck' },
  highlights: { label: 'Highlighted passages', icon: 'highlighter', needs: 'studyEnabled' },
};

/* The library's places that wait under More, so the first few stand out. */
export const LIBRARY_MORE = ['collections', 'smart', 'properties', 'subjects', 'read', 'added', 'graph', 'random', 'inbox', 'library-check', 'knowledge-check', 'highlights', 'settings'];

/* How large covers are on screens of tiles. */
export const GRID_DENSITIES = { compact: 'Compact', standard: 'Standard', large: 'Spacious' };

/* How screens of albums group their covers. */
export const TILE_GROUPS = { '': 'Nothing', kind: 'Kind of collection', collection: 'Shelf' };

export const DEFAULTS = {
  library: true,
  singleArea: false,
  // Off to begin with since 3.1: « » sit in the note's header, Properties in the inspector.
  contextStrip: false,
  // The strip says where the note falls in its album: "3 of 12".
  stripPlace: true,
  // What the strip shows beside that: properties and the like, by name; empty for its pick.
  stripDetail: '',
  // A line along the strip's foot for how far down the note you are.
  stripProgress: true,
  stripSide: 'bottom',
  notePages: true,
  pagesOpen: {},
  // Notes lined up to read next, by path; the strip's » goes through them first.
  // A property's menu gives its value to the rest of the note's album.
  propertyForAlbum: true,
  onePage: false,
  pinsExpanded: false,
  albumNoteLimit: 8,
  discNoteLimit: 10,
  albumColumns: 'domain, modified',
  // A grey line under each note in an album: its description, or its first sentence.
  albumExcerpts: true,
  // A note's album above its title, and one grey line under it.
  notePage: true,
  // Menus, suggestions and the canvas's bar and controls as frosted glass.
  glassPanels: false,
  // Notes read to the end remembered, in this data: albums' progress, what's new, where you were.
  readingHistory: true,
  // On a collection's cover, a ring for how much of it you've read.
  albumProgressRing: true,
  // Home's From what you read: notes linked from what you read in this many days.
  fromReadingDays: 14,
  // Notes with fewer words of their own than this are thin; 0 for no check.
  thinNoteWords: 60,
  // Mind maps: a note flagged mindmap: true, or a .mindmap file, opened as a map.
  mindmaps: true,
  mindmapTakeover: true,
  mindmapDefaultFormat: '',
  mindmapLayout: 'right',
  mindmapGlide: true,
  mindmapPeek: true,
  mindmapLegend: true,
  mindmapDepth: true,
  mindmapColourBy: '',
  mindmapPins: true,
  mindmapViews: true,
  mindmapRelations: true,
  mindmapArguments: true,
  mindmapBranchNotes: true,
  mindmapCheck: true,
  mindmapCompare: true,
  mindmapVaultMap: true,
  mindmapMinimap: true,
  mindmapPresent: true,
  mindmapAlbumMap: true,
  mindmapConvert: true,
  mindmapTasks: true,
  mindmapOtherViews: true,
  mindmapLinkedCards: true,
  mindmapNodePanel: true,
  mindmapFilters: true,
  mindmapEmbeds: true,
  mindmapTemplateFolder: '',
  mindmapQueries: true,
  mindmapHistory: 20,
  mindmapPresentSpotlight: false,
  mindmapPresentNotes: true,
  mindmapRichNodes: true,
  mindmapTheme: 'cards',
  // A collection mapped by its notes' parents: kept current while open; re-linking a card sets the parent as this says.
  albumMapAuto: true,
  albumMapWritesParent: 'ask',
  presentDimLevel: 0.15,
  // Notes in studied collections come back to be revisited, on a ladder of days.
  studyEnabled: false,
  studyLadder: '1, 3, 7, 21, 60',
  studyDailyMax: 20,
  // { path: { added } } — the collections studied.
  studyAlbums: {},
  // Passages marked ==like this== gathered, and asked back as a quiz.
  studyHighlights: true,
  studyCardMax: 10,
  // A note opens at the line you were on.
  rememberPlace: true,
  // The open note's headings in the right sidebar, the one you're reading lit.
  readingOutline: true,
  // Beside each heading in the outline, the words in its section.
  outlineWordCounts: true,
  // { path: { opened, read, mtime, line, lineAt } } — when each note was opened and read, and where you were.
  readingLog: {},
  // When the reading history began: notes made before it aren't news.
  readingSince: 0,
  // A soft glow of a note's cover, or its album's, behind its title.
  notePageTint: false,
  // A note's properties as quiet chips under its title, the full block a click away.
  notePageChips: false,
  // Shelves at a note's end: linked from here, mentioned in, more in its album.
  notePageShelves: true,
  // At an album's end, greyed: the notes its notes link to that aren't written yet.
  albumStillToWrite: true,
  // The property naming a note's parent, to nest an album's notes by; empty for a flat list.
  albumNestBy: 'parent',
  // What an album row ends with, where a track's length would be:
  // 'time' to read it, 'words', or 'none'.
  trackLength: 'time',
  defaultSort: 'name',
  // Recently opened and Pinned have an order of their own, kept until
  // another is chosen there.
  keepOwnOrder: { recents: true, pinned: true, read: true },
  // An album sorted from its filter button keeps that order, by its path.
  albumSortMemory: true,
  // A folder note's album, description, includes and related properties, shown.
  // Relationships kept in notes as properties named for the canvas's kinds of relationship.
  knowledge: true,
  knowledgeCheck: true,
  knowledgeTreeKinds: '',
  knowledgeBroader: 'concept',
  // Warnings marked as meant, by the note they're about: { path: [code] }.
  knowledgeMeant: {},
  // Property sets kept by name, to apply to a note as a template: { name: { key: value } }.
  propertySets: {},
  // Workspace modes, and the one on with the layout it put aside.
  workspaceModes: true,
  workspaceMode: '',
  workspaceModeLayout: null,
  albumStructure: true,
  // Other names for the folder note properties albums are read from: { type, description, includes, related, featured, layout }.
  albumKeyNames: {},
  // In a long album, shelves of what changed and was opened lately.
  albumRecents: true,
  // Filters kept as albums, and the list of them: { id, name, folder, tag, prop, date, sort?, group? }.
  smartAlbums: true,
  // How large covers are on screens of tiles: compact, standard or large.
  gridDensity: 'standard',
  // The theme's look, or the editorial one; how far apart canvas layouts put cards.
  look: 'apple',
  canvasSpacing: 'standard',
  // Screens of albums grouped: '' not at all, 'kind' by kind of album, 'collection' by the folder they're in.
  tileGroups: '',
  // An album cover that isn't a picture has its kind, name and collection printed on it.
  coverPrint: false,
  // A command listing what the library has lost track of.
  libraryCheck: true,
  // The notes in no album, in one place, to put in albums a few at a time.
  libraryInbox: true,
  // Renaming, moving, merging and splitting albums, shown first and undone in one step.
  albumRefactor: true,
  smartAlbumList: [],
  // { folderPath: sort key }
  albumSorts: {},
  // In lists, typing a name jumps to it and Space previews the note in focus.
  typeToJump: true,
  // A note dragged onto a folder in the library, or from a list onto the file list's, moves there.
  sidebarDrop: true,
  tableColumns: 'domain, status',
  categoryProperty: 'domain',
  searchNoteText: true,
  // The Properties screen's list: 'name', 'count' (notes using it) or 'type'.
  propertiesSort: 'name',
  // A property's values: 'auto' (covers while there are few), 'grid' or 'list'.
  propertyValueView: 'auto',
  // Settings shown: 'basic', the everyday ones, or 'all'.
  settingsLevel: 'basic',
  // Covers or lists on the library's screens: 'auto', 'covers' or 'lists'.
  libraryLayout: 'auto',
  recentSearches: [],
  hideEmptyFolders: true,
  homePath: 'Home.md',
  homeShelves: [],
  inspector: true,
  // Only what Design Redux draws, to begin with since 3.1: notes stay as the theme draws them unless asked.
  lookScope: 'plugin',
  artworkSize: '',
  iconMode: 'auto',
  inspectorClick: 'shown',
  libraryPreview: false,
  // [{ title, items: [{ kind, id | path }] }] — empty means "derive a
  // starting layout from the vault the first time it's shown".
  librarySections: [],
  navDropdown: true,
  // Where each header icon sits: the class of the element it follows,
  // or 'start' for the front of the row.
  headerOrder: {},
  ribbonInMenu: true,
  propertiesDropdown: true,
  // The note panel's properties: 'compact', the main ones first and alone, or 'all'.
  panelPropertiesView: 'compact',
  // The main ones, by name.
  panelPrimaryProps: 'type, domain, status',
  // Under the groups set below: 'on' or 'off'.
  panelPropertyGroups: 'off',
  // The groups, in order: { title, keys: names by commas }; what none names goes under Other.
  panelGroupList: [
    { title: 'General', keys: 'type, domain, status' },
    { title: 'Relationships', keys: 'parent, broader, narrower, related' },
    { title: 'Information', keys: 'created, modified' },
  ],
  // The panel folded to its heading, and groups folded in it, from note to note.
  panelPropsCollapsed: false,
  panelFoldedGroups: [],
  showMentions: true,
  // The note panel's sections from relationships and albums.
  // A note's broader, narrower and related notes in the panel, as the inspector has room for them.
  panelRelationships: true,
  panelPlaces: false,
  // Off to begin with since 3.1: Obsidian's gear stays put; Settings is in the library.
  settingsInHeader: false,
  coverProperty: 'cover',
  // {{folder}} stands for the folder's own name, which is the common
  // convention; a literal like "index" works too.
  folderNoteName: '{{folder}}',
  hideFolderNotes: true,
  routeImages: false,
  imageFolder: 'attachments',
  letterLists: true,
  romanLists: true,
  scripts: true,
  // 'short' writes x^2^ and H~2~O; 'html' writes <sup> and <sub>.
  scriptSyntax: 'short',
  // 1st, 2nd, 3rd written as 1^st^ as you type.
  autoOrdinals: false,
  // { folderPath: { names: [file names], on } } — an album's own order.
  albumOrders: {},
  // Pinned things by path, in the order they were arranged.
  pinOrder: [],
  // What stands in for a missing cover: 'art', an album cover drawn for
  // its name; 'title', its name set as a title; 'icon', the folder or
  // note's icon; 'soft', that icon on a soft colour from its name; or a
  // gradient with initials, coloured 'name', 'accent' or 'custom'.
  coverFallback: 'art',
  // A note without a cover shows the cover of the folder it's in.
  coverFromFolder: false,
  // A note without a cover shows the first image in it; a folder, its folder note's.
  coverFromFirstImage: false,
  // An image dropped on a cover becomes it.
  coverDrop: true,
  // The one colour used when the fallback is 'custom'.
  generatedCoverColor: '#fa2d48',
  // { path: '#rrggbb' | 'accent' } — a colour chosen for one album or note.
  coverColors: {},
  // { path: designId } — a drawn cover's design, picked for one album or note.
  coverDesigns: {},
  // { folderPath: [{ key, value, type }] } — given to notes made there.
  folderDefaults: {},
  // { folderPath: [{ key, type, required, values, default }] } — what notes there should have; '/' for the vault.
  // Empty: the names the plugin starts with (kept from before kinds had styles).
  canvasRelationNames: '',
  // Kinds of relationship, each { name, inverse, category, line, color }; empty: the kinds it starts with.
  canvasRelationTypes: [],
  propertySchemas: {},
  // { key: { value: { color, icon } } } — how a value shows wherever it's shown.
  propertyOptions: {},
  propertySchemaMarks: true,
  propertyValueChips: true,
  // { notePath: [{ at, changes: { key: [before, after, how] } }] } — the last changes written to each note.
  propertyHistory: {},
  propertyHistoryLimit: 20,
  propertyDueChips: true,
  propertyDueKeys: 'due, deadline',
  // [{ id, name, on, when: { kind, folder | tag | key, value }, set: [{ key, value }], replace }]
  propertyRules: [],
  propertyRulesOn: false,
  propertyRulesDryRun: true,
  propertyInspector: true,
  propertyInlineEdit: false,
  propertyLinks: true,
  // { folderPath: { main: 'status, due' } } — the note panel's main properties for notes there.
  panelFolderViews: {},
  albumRollups: false,
  rollupDateKey: '',
  // Which shape the saved settings are in; see SETTINGS_MIGRATIONS.
  settingsVersion: 17,
  graphProperties: true,
  // Links written [[[Note]]] open their note but stay off the graph and
  // out of backlinks.
  quietLinks: false,
  // { graph | localgraph: { mode, rules, clause, open } }
  graphFilters: {},
  // A switch in the graph's Display settings: links drawn through the
  // note in between. Which graphs have it on: { graph | localgraph: bool }
  graphRoutes: true,
  graphRouting: {},
  // Where a note names the note it sits under; the routes go by it.
  graphRouteProperty: 'parent',
  // A box at the cursor for footnotes, and their numbers kept in order.
  footnotes: true,
  footnoteOrder: true,
  // The citations off the page, listed in a Footnotes view instead.
  footnotesAside: true,
};

/* Obsidian's property types, with the icon it shows for each. */
export const TYPE_ICONS = {
  text: 'text',
  number: 'binary',
  checkbox: 'check-square',
  date: 'calendar',
  datetime: 'clock',
  multitext: 'list',
  tags: 'tags',
  aliases: 'forward',
};

export const TYPE_LABELS = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  date: 'Date',
  datetime: 'Date & time',
  multitext: 'List',
  tags: 'Tags',
  aliases: 'Aliases',
};

/* Entries stripped from Obsidian's own context menus. */
export const HIDDEN_MENU_ITEMS = ['Rename property'];

/* With one page these would all just open in place, so offering them
   would be a promise the menu can't keep. */
export const ONE_PAGE_MENU_ITEMS = [
  'Open in new tab',
  'Open to the right',
  'Open in new window',
  'Move to new window',
  'Split right',
  'Split down',
];

/* What Bases will render as a card's cover image. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

export const TAB_HEADER = '.workspace-split.mod-left-split .workspace-tab-header-container';
export const NAV_BUTTONS = '.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container';
// The left ribbon's buttons: .mod-left until Obsidian 1.14, .mod-primary since.
export const RIBBON_ACTIONS = '.workspace-ribbon:is(.mod-left, .mod-primary) .side-dock-actions';

/* Each kind's symbol, and its colour where covers are coloured by kind: muted, so colour means kind and no more. */
export const ALBUM_TYPES = [
  { id: 'subject', label: 'Subject', icon: 'book', color: '#4f6d8f' },
  { id: 'concept map', label: 'Concept map', icon: 'waypoints', color: '#7a5c8e' },
  { id: 'project', label: 'Project', icon: 'target', color: '#b0703a' },
  { id: 'reading list', label: 'Reading list', icon: 'library', color: '#5e7f5a' },
  { id: 'reference', label: 'Reference', icon: 'bookmark', color: '#4d7f80' },
  { id: 'index', label: 'Index', icon: 'list', color: '#8a6f52' },
];

/* An album of no kind, where covers are coloured by kind. */
export const ALBUM_KIND_NEUTRAL = '#7d7770';

/* The graph views: the vault's and a note's own. */
export const GRAPH_TYPES = ['graph', 'localgraph'];

/* The properties Obsidian reads tags from. */
export const TAG_KEYS = ['tags', 'tag'];

/* How far apart canvas cards are put, as set (Appearance): every gap a tidy makes goes through canvasGap(). */
export const CANVAS_SPACE = { scale: 1 };

/* On an arrow: a relationship, not a branch — trees, folds and layouts pass it by. */
export const RELATED_KEY = 'drRelated';

/* On an arrow: what it means — { kind, subject, object } or { predicate, subject, object }, the ends as card ids. */
export const RELATION_KEY = 'drRelation';

/*
 * Each kind: its reading the other way, whether it's hierarchy or
 * association, its line — solid, dashed or dotted — and colour: one of
 * the canvas's six, or none. Grey by default.
 */
export const DEFAULT_RELATION_TYPES = [
  { name: 'is a type of', inverse: 'has type', category: 'hierarchy', line: 'solid', color: '' },
  { name: 'is part of', inverse: 'has part', category: 'hierarchy', line: 'solid', color: '' },
  { name: 'depends on', inverse: 'is needed by', category: 'association', line: 'dashed', color: '' },
  { name: 'causes', inverse: 'is caused by', category: 'association', line: 'solid', color: '' },
  { name: 'contrasts with', inverse: 'contrasts with', category: 'association', line: 'dotted', color: '' },
  { name: 'supports', inverse: 'is supported by', category: 'association', line: 'solid', color: '' },
  { name: 'exemplifies', inverse: 'is exemplified by', category: 'association', line: 'dashed', color: '' },
  { name: 'governed by', inverse: 'governs', category: 'association', line: 'solid', color: '' },
];

/**
 * The kinds of relationship, as set: each with its reading the other way,
 * its category, line and colour — the defaults' where it's one of them.
 * Shared by the canvas's arrows and the relationships kept in notes.
 */
export function relationTypes(settings) {
  const fill = (t) => Object.assign({ inverse: '', category: 'association', line: 'solid', color: '' }, DEFAULT_RELATION_TYPES.find((d) => d.name === t.name) || {}, t);
  const set = Array.isArray(settings.canvasRelationTypes) ? settings.canvasRelationTypes.filter((t) => t && String(t.name || '').trim()) : [];
  if (set.length) return set.map(fill);
  // Names set before kinds had styles: each as the default of that name has, or plain.
  const names = String(settings.canvasRelationNames || '').trim();
  if (!names) return DEFAULT_RELATION_TYPES;
  return names
    .split(',')
    .map((n) => n.trim())
    .filter((n, i, all) => n && all.indexOf(n) === i)
    .map((name) => fill({ name }));
}
