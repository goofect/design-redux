const LIBRARY_VIEW = 'design-redux-library';
const BROWSE_VIEW = 'design-redux-browse';

/* Destinations that aren't a file or folder. */
/* The browse screen each built-in entry opens, which is also how the
   sidebar knows which entry to highlight while that screen is up. */
const BUILTIN_SCREENS = {
  home: 'home',
  search: 'search',
  folders: 'folders',
  notes: 'notes',
  properties: 'properties',
  recents: 'recents',
  bookmarks: 'pinned',
};

const LIBRARY_BUILTINS = {
  search: { label: 'Search', icon: 'search' },
  home: { label: 'Home', icon: 'home' },
  graph: { label: 'Graph', icon: 'git-fork' },
  bookmarks: { label: 'Pinned', icon: 'pin' },
  recents: { label: 'Recently opened', icon: 'clock' },
  properties: { label: 'Properties', icon: 'tags' },
  folders: { label: 'Folders', icon: 'folder' },
  notes: { label: 'Notes', icon: 'file-text' },
  random: { label: 'Random note', icon: 'dice' },
};

const DEFAULTS = {
  library: true,
  singleArea: false,
  contextStrip: true,
  // The strip says where the note falls in its album: "3 of 12".
  stripPlace: true,
  // What the strip shows beside that: properties and the like, by name; empty for its pick.
  stripDetail: '',
  // A line along the strip's foot for how far down the note you are.
  stripProgress: true,
  // Notes lined up to read next, by path; the strip's » goes through them first.
  upNext: true,
  // A property's menu gives its value to the rest of the note's album.
  propertyForAlbum: true,
  queue: [],
  onePage: false,
  pinsExpanded: false,
  albumNoteLimit: 8,
  discNoteLimit: 10,
  albumColumns: 'domain, modified',
  // What an album row ends with, where a track's length would be:
  // 'time' to read it, 'words', or 'none'.
  trackLength: 'time',
  defaultSort: 'name',
  // Recently opened and Pinned have an order of their own, kept until
  // another is chosen there.
  keepOwnOrder: { recents: true, pinned: true },
  // An album sorted from its filter button keeps that order, by its path.
  albumSortMemory: true,
  // { folderPath: sort key }
  albumSorts: {},
  // In lists, typing a name jumps to it and Space previews the note in focus.
  typeToJump: true,
  // A note dragged onto a folder in the library, or from a list onto the file list's, moves there.
  sidebarDrop: true,
  tableColumns: 'domain, status',
  categoryProperty: 'domain',
  recentSearches: [],
  hideEmptyFolders: true,
  homePath: 'Home.md',
  // [{ title, items: [{ kind, id | path }] }] — empty means "derive a
  // starting layout from the vault the first time it's shown".
  librarySections: [],
  navDropdown: true,
  // Where each header icon sits: the class of the element it follows,
  // or 'start' for the front of the row.
  headerOrder: {},
  ribbonInMenu: true,
  propertiesDropdown: true,
  showMentions: true,
  settingsInHeader: true,
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
  // A legend in the corner of each canvas, naming what its colours mean.
  canvasLegend: true,
  // { canvasPath: { labels: { colour: name }, collapsed, hidden } }
  canvasLegends: {},
  // Centred text in canvas cards, and which cards have it.
  canvasTextAlign: true,
  // Cards folded to their first line, and groups to their label, from an arrow in their corner.
  // A card's branch — what its arrows lead to — tucked into it, from a knob where they leave.
  canvasBranches: true,
  // What's beyond a fold moves in to close up the room it left, and back out when it unfolds.
  canvasCloseGaps: true,
  // A card's branch laid out as a tidy tree.
  canvasTidy: true,
  // A card selected with everything its arrows lead to.
  canvasSelectBranch: true,
  // The canvas as a tree, in the right sidebar.
  canvasOutline: true,
  // A command to go to a card by its words, opening the folds it's in.
  canvasFind: true,
  // Dim everything but a card's branch.
  canvasFocus: true,
  // Copy a card with everything its arrows lead to.
  canvasDuplicate: true,
  // { canvasPath: { cardId: 'center' } }
  canvasAlignments: {},
  // Selected cards lined up, spaced, sized alike, or laid out in a grid.
  canvasArrange: true,
  // Tab and Enter on a selected card add one after it or beside it.
  canvasMindMap: true,
  // Where Tab and Enter put a new card: 'free' for the nearest free space, 'line' in line with room made.
  canvasMindMapPlace: 'free',
  // A card dropped onto another hangs from it.
  canvasRelink: true,
  // Shift+Enter puts a card before the selected one; Shift+Tab moves it up a level.
  canvasRestructure: true,
  // A branch written out as a note, and a note's headings or a card's list made into cards.
  canvasBranchNote: true,
  canvasOutlineBranch: true,
  // A branch laid out to one side, both sides, or all round its card.
  canvasLayouts: true,
  // Arrows named for how their cards relate, or marked related: out of branches.
  canvasRelations: true,
  // Empty: the names the plugin starts with.
  canvasRelationNames: '',
  // A text card grows to fit what's typed in it.
  canvasCardFit: true,
  // A text card's first line reads as its title, the rest as details.
  canvasCardTitles: true,
  // Arrows in a style of their own, from their menu or the bar above them.
  canvasArrows: true,
  // How arrows without a style of their own are drawn: 'curve', 'straight' or 'elbow'.
  canvasArrowShape: 'curve',
  // Arrows without a style of their own join cards at the sides facing each other.
  canvasArrowSides: false,
  // { folderPath: [{ key, value, type }] } — given to notes made there.
  folderDefaults: {},
  // Which shape the saved settings are in; see SETTINGS_MIGRATIONS.
  settingsVersion: 3,
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
const TYPE_ICONS = {
  text: 'text',
  number: 'binary',
  checkbox: 'check-square',
  date: 'calendar',
  datetime: 'clock',
  multitext: 'list',
  tags: 'tags',
  aliases: 'forward',
};

const TYPE_LABELS = {
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
const HIDDEN_MENU_ITEMS = ['Rename property'];

/* With one page these would all just open in place, so offering them
   would be a promise the menu can't keep. */
const ONE_PAGE_MENU_ITEMS = [
  'Open in new tab',
  'Open to the right',
  'Open in new window',
  'Move to new window',
  'Split right',
  'Split down',
];

/* What Bases will render as a card's cover image. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

const TAB_HEADER = '.workspace-split.mod-left-split .workspace-tab-header-container';
const NAV_BUTTONS = '.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container';
const RIBBON_ACTIONS = '.workspace-ribbon.mod-left .side-dock-actions';

