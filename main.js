'use strict';

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Menu,
  MarkdownView,
  Notice,
  FuzzySuggestModal,
  TFile,
  TFolder,
  ItemView,
  Modal,
  normalizePath,
  Platform,
  setIcon,
  parseYaml,
  stringifyYaml,
  editorLivePreviewField,
  Scope,
  AbstractInputSuggest,
  MenuItem,
} = require('obsidian');
// Provided by Obsidian at runtime, as 'obsidian' is.
const { Decoration, EditorView, ViewPlugin, keymap } = require('@codemirror/view');
const { EditorSelection, Prec, RangeSetBuilder } = require('@codemirror/state');
const { syntaxTree } = require('@codemirror/language');

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
  onePage: false,
  pinsExpanded: false,
  albumNoteLimit: 8,
  discNoteLimit: 10,
  albumColumns: 'domain, modified',
  defaultSort: 'name',
  // Recently opened and Pinned have an order of their own, kept until
  // another is chosen there.
  keepOwnOrder: { recents: true, pinned: true },
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
  // What stands in for a missing cover: 'icon', the folder or note's
  // icon; or a gradient with initials, coloured 'name', 'accent' or 'custom'.
  coverFallback: 'icon',
  // The one colour used when the fallback is 'custom'.
  generatedCoverColor: '#fa2d48',
  // { path: '#rrggbb' | 'accent' } — a colour chosen for one album or note.
  coverColors: {},
  // A legend in the corner of each canvas, naming what its colours mean.
  canvasLegend: true,
  // { canvasPath: { labels: { colour: name }, collapsed, hidden } }
  canvasLegends: {},
  // Centred text in canvas cards, and which cards have it.
  canvasTextAlign: true,
  // { canvasPath: { cardId: 'center' } }
  canvasAlignments: {},
  // { folderPath: [{ key, value, type }] } — given to notes made there.
  folderDefaults: {},
  graphProperties: true,
  // { graph | localgraph: { mode, rules, clause, open } }
  graphFilters: {},
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

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Recover a lucide icon name from a button's inline svg. */
function iconNameOf(btn) {
  const svg = btn.querySelector('svg');
  if (!svg) return null;
  const cls = Array.from(svg.classList).find((c) => c !== 'svg-icon');
  return cls ? cls.replace(/^lucide-/, '') : null;
}

/**
 * The real views of a type, skipping deferred leaves.
 *
 * Since Obsidian 1.7.2 a leaf that hasn't been shown yet holds a
 * placeholder view, not the plugin's own — so anything reached through
 * getLeavesOfType has to be checked before its methods are used.
 */
function liveViews(app, type, ctor) {
  return app.workspace
    .getLeavesOfType(type)
    .filter((leaf) => !leaf.isDeferred && leaf.view instanceof ctor)
    .map((leaf) => leaf.view);
}

/* The properties that stand in for an artist line, in the order they're
   tried. Every place that shows one line about a note uses this. */
const LEAD_PROPERTIES = ['domain', 'author', 'book', 'status'];

/** A value without its wikilink brackets, alias or heading. */
function plainValue(value) {
  return String(value)
    .replace(/^!?\[\[/, '')
    .replace(/\]\]$/, '')
    .split('|')[0]
    .split('#')[0]
    .trim();
}

/**
 * A property's value by name, whatever case the note wrote it in —
 * Obsidian treats "Author" and "author" as one property, and lists it
 * lower-cased.
 */
function fmGet(fm, key) {
  if (!fm || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(fm, key)) return fm[key];
  const want = String(key).toLowerCase();
  const name = Object.keys(fm).find((k) => k.toLowerCase() === want);
  return name === undefined ? undefined : fm[name];
}

/** A frontmatter value as one line of text, lists included. */
function valueText(value) {
  if (value === undefined || value === null || value === '') return '';
  return Array.isArray(value)
    ? value.map(plainValue).filter(Boolean).join(', ')
    : plainValue(value);
}

/**
 * The one property worth showing beneath a note's name.
 *
 * Falls back to the folder, since a note with no properties still came
 * from somewhere and a blank line reads as a mistake.
 */
function leadProperty(app, file, fallbackToFolder) {
  const cache = app.metadataCache.getFileCache(file);
  const fm = (cache && cache.frontmatter) || {};
  for (const key of LEAD_PROPERTIES) {
    const text = valueText(fmGet(fm, key));
    if (text) return text;
  }
  if (!fallbackToFolder) return '';
  return file.parent && file.parent.path !== '/' ? file.parent.name : '';
}

/**
 * The image a note's cover property points at, as something an <img>
 * can load: a wikilink resolved against the vault, or a URL as given.
 * A colour isn't an image, so it comes back empty.
 */
function resolveCover(app, file, key) {
  if (file.extension !== 'md') return null;
  const cache = app.metadataCache.getFileCache(file);
  const raw = cache && fmGet(cache.frontmatter, key || 'cover');
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('#')) return null;

  // A Markdown link — [x](path) — is read too, for values written that way.
  const md = /^!?\[[^\]]*\]\(<?([^)>]+)>?\)$/.exec(value);
  let linkpath = plainValue(value);
  if (md) {
    try {
      linkpath = decodeURI(md[1]);
    } catch (err) {
      linkpath = md[1];
    }
  }
  const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
  return target ? app.vault.getResourcePath(target) : null;
}

/**
 * Artwork into an element: the image if there is one, a glyph if not,
 * and the glyph as well if the image turns out to be missing.
 */
function fillArt(el, src, glyph, gen) {
  const blank = () => {
    // With a name to go on, a cover is made from it: a gradient chosen
    // by the name, so it's always the same one, and its initials. A
    // colour can be given with it: { name, tint }.
    if (gen) return generatedArt(el, typeof gen === 'string' ? { name: gen } : gen);
    el.addClass('is-blank');
    setIcon(el.createSpan({ cls: 'dr-card-glyph' }), glyph);
  };
  if (!src) return blank();

  const img = el.createEl('img');
  img.src = src;
  img.alt = '';
  img.addEventListener('error', () => {
    img.remove();
    blank();
  });
}

/** A number from a name, stable between runs: the same name, the same colour. */
function nameHue(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

/** Up to two initials: "Theories of Justice" → TJ, "Realism" → R. */
function initialsOf(name) {
  const words = String(name)
    .replace(/[_\-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  const skip = /^(of|the|and|a|an|in|on|to|for|de|la|le)$/i;
  const main = words.filter((w, i) => i === 0 || !skip.test(w));
  return main
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join('')
    .toUpperCase();
}

function generatedArt(el, gen) {
  el.addClass('is-generated');
  paintTint(el, gen.tint, gen.name);
  el.createSpan({ cls: 'dr-gen-initials', text: initialsOf(gen.name) });
}

/**
 * A generated cover's colour onto an element: a chosen colour, the
 * theme's accent, or — with neither — one picked from the name.
 */
function paintTint(el, tint, name) {
  el.removeClass('is-tinted', 'is-accent', 'is-light');
  ['--dr-gen-h', '--dr-gen-s', '--dr-gen-l'].forEach((v) => el.style.removeProperty(v));
  if (tint === 'accent') {
    // Read from the theme by the stylesheet, so it follows a change of
    // accent without anything being redrawn.
    el.addClass('is-tinted', 'is-accent');
    return;
  }
  const hsl = hexToHsl(tint);
  if (!hsl) {
    el.style.setProperty('--dr-gen-h', String(nameHue(String(name || ''))));
    return;
  }
  el.addClass('is-tinted');
  el.style.setProperty('--dr-gen-h', String(hsl.h));
  el.style.setProperty('--dr-gen-s', `${hsl.s}%`);
  el.style.setProperty('--dr-gen-l', `${hsl.l}%`);
  // White initials vanish on yellow; pale colours get dark ones.
  el.toggleClass('is-light', luminance(tint) > 0.5);
}

/** "#abc" or "#aabbcc" as six lower-case digits, or null if it's neither. */
function normalHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) return null;
  const d = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return '#' + d.toLowerCase();
}

function hexToRgb(value) {
  const hex = normalHex(value);
  if (!hex) return null;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function hexToHsl(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Relative luminance, 0 for black to 1 for white. */
function luminance(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The colour chosen for one path, or null if it has none. */
function ownTint(settings, path) {
  const own = path && settings.coverColors ? settings.coverColors[path] : null;
  return own === 'accent' ? own : normalHex(own);
}

/**
 * What a missing cover gets from settings alone: 'icon' for the plain
 * icon, 'accent', a colour, or null for a colour picked from the name.
 */
function fallbackTint(settings) {
  const style = settings.coverFallback || 'icon';
  if (style === 'accent') return 'accent';
  if (style === 'custom') return normalHex(settings.generatedCoverColor) || DEFAULTS.generatedCoverColor;
  if (style === 'name') return null;
  return 'icon';
}

/** The colour a generated cover takes: its own, or the one in settings. */
function coverTint(settings, path) {
  return ownTint(settings, path) || fallbackTint(settings);
}

/**
 * What fillArt needs to make a cover, or null for the plain icon. A
 * colour chosen for one album makes it a cover whatever the default.
 */
function coverGen(settings, name, path) {
  if (name == null || name === '') return null;
  const tint = coverTint(settings, path);
  return tint === 'icon' ? null : { name: String(name), tint: tint };
}

/* The colours offered for a cover, before a custom one. */
const COVER_SWATCHES = [
  ['Red', '#e5484d'],
  ['Orange', '#f2811d'],
  ['Yellow', '#f5c518'],
  ['Green', '#30a46c'],
  ['Mint', '#12a594'],
  ['Cyan', '#0797b9'],
  ['Blue', '#3e63dd'],
  ['Indigo', '#5b5bd6'],
  ['Purple', '#8e4ec6'],
  ['Pink', '#d6409f'],
  ['Brown', '#8d6a4f'],
  ['Graphite', '#6f6e77'],
];

/**
 * The notes of the album a file is in, in the album's order — its own
 * arrangement if it has one on, otherwise the shared order. The folder
 * note stands for the album, so it isn't one of them.
 */
function albumSequence(plugin, file) {
  const folder = file && file.parent;
  if (!folder) return [];
  const files = (folder.children || []).filter((c) => c instanceof TFile && !plugin.isFolderNote(c));
  const sort = plugin.settings.defaultSort || 'name';
  return plugin.orders.arrangeAlbum(folder, files, (list) => sortByOrder(list, sort));
}

/** The note before and after one in its album. */
function albumNeighbours(plugin, file) {
  const list = albumSequence(plugin, file);
  const at = list.indexOf(file);
  if (at === -1) return { previous: null, next: null, index: -1, total: list.length };
  return { previous: list[at - 1] || null, next: list[at + 1] || null, index: at, total: list.length };
}

/* -- the page and its history --------------------------------------- */

/**
 * The page: the main area's most recent leaf. Not the focused one, so
 * clicking into the sidebar doesn't change what "the page" means.
 */
function pageLeaf(app) {
  return app.workspace.getMostRecentLeaf(app.workspace.rootSplit) || null;
}

/**
 * A leaf's back and forward stacks.
 *
 * History belongs to the leaf, not to whichever view is in it. Asking a
 * view was the bug behind dead back buttons: opening a note replaces
 * the screen you came from in the same leaf, leaving nothing to ask.
 * Not public API, so every use is guarded.
 */
function leafHistory(leaf) {
  const h = leaf && leaf.history;
  return h && typeof h.back === 'function' ? h : null;
}

function canStep(leaf, dir) {
  const h = leafHistory(leaf);
  if (!h) return false;
  const stack = dir === 'back' ? h.backHistory : h.forwardHistory;
  return !!(stack && stack.length);
}

function step(leaf, dir) {
  const h = leafHistory(leaf);
  if (!h) return;
  if (dir === 'back') h.back();
  else h.forward();
}

/**
 * Wrap an object's method, returning a function that undoes it.
 *
 * If something else has wrapped the method since, putting the original
 * back would throw that wrapper away too, so ours becomes a pass-through
 * instead. It's the approach monkey-around takes, and what lets plugins
 * that patch the same method coexist.
 */
function around(obj, method, wrap) {
  const original = obj[method];
  const hadOwn = Object.prototype.hasOwnProperty.call(obj, method);
  let active = true;
  const wrapper = function (...args) {
    return active ? wrap(original, this, args) : original.apply(this, args);
  };
  obj[method] = wrapper;
  return () => {
    active = false;
    if (obj[method] !== wrapper) return;
    if (hadOwn) obj[method] = original;
    else delete obj[method];
  };
}

/** Undo the sidebar panel shape wherever it was applied. */
function clearSidebarChrome() {
  document.body.removeClass('dr-left-collapsed');
  document
    .querySelectorAll('.dr-apple-sidebar')
    .forEach((el) => el.removeClass('dr-apple-sidebar'));
  document
    .querySelectorAll('[data-dr-initial]')
    .forEach((el) => el.removeAttribute('data-dr-initial'));
}

/* -- menus ------------------------------------------------------------ */

/**
 * Show a menu at the pointer, at the finger for a long press, or under
 * the element for a keyboard press, which has no position to use. On a
 * phone Obsidian draws every menu as a sheet from the bottom, wherever
 * it's asked to appear.
 */
function showMenuAt(menu, evt) {
  const at = evt && typeof evt.clientX === 'number' && (evt.clientX || evt.clientY);
  if (at && !evt.drTouch) {
    menu.showAtMouseEvent(evt);
    return;
  }
  if (at) {
    menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
    return;
  }
  const el = [evt && evt.currentTarget, evt && evt.target].find(
    (c) => c && typeof c.getBoundingClientRect === 'function'
  );
  const r = el ? el.getBoundingClientRect() : { left: 0, bottom: 0 };
  menu.showAtPosition({ x: r.left, y: r.bottom });
}

/**
 * An Enter that confirms a word being composed with an input method —
 * Chinese, Japanese, Korean — rather than one meant for the field.
 */
function composing(evt) {
  return !!(evt && (evt.isComposing || evt.keyCode === 229));
}

/* -- touch ------------------------------------------------------------ */

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

/**
 * A menu on right-click, and on a long press for touch. iOS never fires
 * contextmenu at all, so without this every menu in the plugin would be
 * out of reach on an iPhone. Android fires both, so whichever arrives
 * first opens the menu and the other is dropped.
 *
 * A press belongs to the innermost element offering a menu — holding a
 * card on a folder page opens the card's menu, not the page's as well —
 * and the lift that ends it isn't also a tap.
 */
function onContextMenu(el, handler) {
  let timer = 0;
  let start = null;
  let pressed = false;
  let firedAt = 0;

  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    start = null;
  };

  el.addEventListener('contextmenu', (evt) => {
    cancel();
    if (Date.now() - firedAt < 800) {
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }
    handler(evt);
  });

  el.addEventListener(
    'touchstart',
    (evt) => {
      cancel();
      if (evt.drPressClaimed || evt.touches.length !== 1) return;
      const target = evt.target;
      // Holding in a text field places the caret; it isn't a menu.
      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      evt.drPressClaimed = true;
      const touch = evt.touches[0];
      start = { x: touch.clientX, y: touch.clientY, target };
      timer = window.setTimeout(() => {
        const at = start;
        timer = 0;
        start = null;
        if (!at) return;
        pressed = true;
        firedAt = Date.now();
        handler(pressEvent(el, at));
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  el.addEventListener(
    'touchmove',
    (evt) => {
      if (!start) return;
      const touch = evt.touches[0];
      if (
        !touch ||
        Math.abs(touch.clientX - start.x) > LONG_PRESS_SLOP ||
        Math.abs(touch.clientY - start.y) > LONG_PRESS_SLOP
      ) {
        cancel();
      }
    },
    { passive: true }
  );

  el.addEventListener('touchcancel', () => {
    cancel();
    pressed = false;
  });

  el.addEventListener('touchend', (evt) => {
    cancel();
    if (!pressed) return;
    pressed = false;
    // Stops the tap the browser would otherwise make of the lift.
    if (evt.cancelable) evt.preventDefault();
    swallowClick(el);
  });
}

/** Drop the one click that may still follow a long press. */
function swallowClick(el) {
  const swallow = (evt) => {
    evt.preventDefault();
    evt.stopImmediatePropagation();
    done();
  };
  const done = () => {
    el.removeEventListener('click', swallow, true);
    window.clearTimeout(timeout);
  };
  const timeout = window.setTimeout(done, 600);
  el.addEventListener('click', swallow, true);
}

/**
 * What a long press hands a menu handler: enough of a mouse event for
 * the menus here — a position, a target, and the two methods they call.
 */
function pressEvent(el, at) {
  return {
    type: 'contextmenu',
    drTouch: true,
    clientX: at.x,
    clientY: at.y,
    target: at.target,
    currentTarget: el,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
  };
}

/**
 * Whether the single content area applies. It hides desktop chrome —
 * the tab bar, the view header, the status bar — and on a phone or
 * tablet that chrome is how Obsidian itself is driven.
 */
function singleAreaOn(settings) {
  return !!settings.singleArea && !Platform.isMobile;
}

/**
 * The menu for a folder or file, wherever it appears — the sidebar, a
 * tile, a disc, an album's artwork, the page itself or the strip — so
 * the same thing offers the same actions everywhere.
 *
 * Obsidian's file explorer adds New note and New folder itself, before
 * passing the menu on, so they never arrive through the shared
 * file-menu event; a folder's menu here adds them.
 *
 * opts: { open?, here?, redraw?, source? }. `here` means the folder is
 * the page being shown, so there's nothing to open.
 */
/**
 * Whether a menu entry can open a menu of its own beside it. It's how
 * Obsidian's own Format menu works, but not public API, so it's asked
 * rather than assumed.
 */
function canNest() {
  return !!(MenuItem && MenuItem.prototype && typeof MenuItem.prototype.setSubmenu === 'function');
}

/**
 * Related entries under one, opening beside it, so a menu stays short.
 * Where that isn't possible they go in place instead, under their
 * longer names: fill is told which, and names them to suit.
 */
function menuGroup(menu, title, icon, fill, section) {
  if (!canNest()) {
    fill(menu, false);
    return;
  }
  menu.addItem((item) => {
    item.setTitle(title).setIcon(icon);
    if (section && typeof item.setSection === 'function') item.setSection(section);
    fill(item.setSubmenu(), true);
  });
}

/**
 * A submenu Obsidian already put in this menu, found by its title —
 * so an entry can join Format rather than sit beside it. Null where
 * there's none, or it can't be told.
 */
function findSubmenu(menu, title) {
  try {
    const items = Array.isArray(menu.items) ? menu.items : [];
    const hit = items.find(
      (it) => it && it.submenu && it.titleEl && it.titleEl.textContent.trim() === title
    );
    return hit ? hit.submenu : null;
  } catch (err) {
    return null;
  }
}

/** Whether the Canvas core plugin is on; assumed so if it can't be told. */
function canvasOn(app) {
  try {
    const plugins = app.internalPlugins;
    if (!plugins || typeof plugins.getEnabledPluginById !== 'function') return true;
    return !!plugins.getEnabledPluginById('canvas');
  } catch (err) {
    return true;
  }
}

function showTargetMenu(plugin, evt, target, opts = {}) {
  evt.preventDefault();
  evt.stopPropagation();
  const app = plugin.app;
  const menu = new Menu();
  const isFolder = target instanceof TFolder;
  const redraw = opts.redraw || (() => plugin.refreshBrowse());

  // Ours first, a few lines long: each group opens beside the menu.
  if (isFolder && !opts.here && opts.open) {
    menu.addItem((item) =>
      item.setTitle('Open folder').setIcon('folder-open').onClick(opts.open)
    );
  }
  if (isFolder) {
    menuGroup(menu, 'New', 'plus', (m, nested) => {
      m.addItem((item) =>
        item.setTitle(nested ? 'Note' : 'New note').setIcon('file-plus').onClick(() => plugin.newNote(target))
      );
      m.addItem((item) =>
        item.setTitle(nested ? 'Folder' : 'New folder').setIcon('folder-plus').onClick(() => plugin.newFolder(target))
      );
      if (canvasOn(app)) {
        m.addItem((item) =>
          item
            .setTitle(nested ? 'Canvas' : 'New canvas')
            .setIcon('layout-dashboard')
            .onClick(() => plugin.newCanvas(target))
        );
      }
    });
  }

  // The vault's root can hold new things but isn't a thing to cover,
  // pin, rename or delete.
  if (isFolder && target.isRoot && target.isRoot()) {
    showMenuAt(menu, evt);
    return;
  }

  if (isFolder || target.extension === 'md') {
    const src = isFolder
      ? plugin.folderCoverSrc(target)
      : resolveCover(app, target, plugin.settings.coverProperty);
    menuGroup(menu, 'Cover', 'image', (m, nested) => {
      m.addItem((item) =>
        item
          .setTitle(src ? (nested ? 'Change image…' : 'Change cover image') : nested ? 'Set image…' : 'Set cover image')
          .setIcon('image')
          .onClick(() =>
            isFolder ? plugin.setFolderCover(target, redraw) : plugin.setNoteCover(target)
          )
      );
      if (src) {
        m.addItem((item) =>
          item
            .setTitle(nested ? 'Remove image' : 'Remove cover image')
            .setIcon('image-off')
            .onClick(() =>
              isFolder ? plugin.clearFolderCover(target, redraw) : plugin.clearNoteCover(target)
            )
        );
      } else {
        m.addItem((item) =>
          item
            .setTitle(nested ? 'Colour…' : 'Cover colour…')
            .setIcon('palette')
            .onClick(() => plugin.chooseCoverColor(target))
        );
      }
    });
  }

  const pinned = plugin.pins.has(target);
  menu.addItem((item) =>
    item
      .setTitle(pinned ? 'Unpin' : 'Pin')
      .setIcon(pinned ? 'pin-off' : 'pin')
      .onClick(() => plugin.togglePin(target))
  );
  // Where pins are being put in order: a step either way, for touch
  // and for anyone who'd rather not drag.
  if (opts.arrange) {
    menuGroup(menu, 'Move', 'arrow-left-right', (m, nested) =>
      [
        [nested ? 'Earlier' : 'Move earlier', 'arrow-left', opts.arrange.earlier],
        [nested ? 'Later' : 'Move later', 'arrow-right', opts.arrange.later],
      ].forEach(([title, icon, run]) =>
        m.addItem((item) => {
          item.setTitle(title).setIcon(icon);
          if (typeof item.setDisabled === 'function') item.setDisabled(!run);
          item.onClick(() => {
            if (run) run();
          });
        })
      )
    );
  }
  menu.addSeparator();

  // Obsidian's own entries, and whatever other plugins add.
  app.workspace.trigger('file-menu', menu, target, opts.source || BROWSE_VIEW);
  showMenuAt(menu, evt);
}

/**
 * The folder the page is in: the one a folder screen shows, or the one
 * holding the note that's open.
 */
function pageFolder(app) {
  const leaf = pageLeaf(app);
  const view = leaf && !leaf.isDeferred ? leaf.view : null;
  if (view instanceof BrowseView) return view.mode === 'folder' ? view.folder() : null;
  return view && view.file instanceof TFile ? view.file.parent : null;
}

/**
 * Names in the order a person would put them: numbers by value, so
 * "Week 2" comes before "Week 10", and case and accents not deciding.
 */
function byName(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Files in one of the shared orders. */
function sortByOrder(files, sort) {
  const by = {
    name: (a, b) => byName(a.basename, b.basename),
    'name-desc': (a, b) => byName(b.basename, a.basename),
    modified: (a, b) => b.stat.mtime - a.stat.mtime,
    created: (a, b) => b.stat.ctime - a.stat.ctime,
  }[sort] || ((a, b) => byName(a.basename, b.basename));
  return files.slice().sort(by);
}

/* Screens with an order of their own, offered first on their filter button. */
const OWN_ORDER = {
  recents: 'Most recently opened',
  pinned: 'Order pinned',
};

/* How the Notes table sorts for each shared order. */
const TABLE_SORTS = {
  name: { key: 'title', dir: 'asc' },
  'name-desc': { key: 'title', dir: 'desc' },
  modified: { key: 'modified', dir: 'desc' },
  created: { key: 'created', dir: 'desc' },
};

/* The orders every screen shares — one, saved in settings. */
const SORTS = [
  ['name', 'Alphabetical (A–Z)'],
  ['name-desc', 'Alphabetical (Z–A)'],
  ['modified', 'Recently modified'],
  ['created', 'Recently created'],
];

/* -- filters ---------------------------------------------------------- */

/** A note's tags, lower case and without the #, from its text and its properties. */
function noteTags(cache) {
  if (!cache) return [];
  const out = new Set();
  (cache.tags || []).forEach((t) => {
    const tag = String(t.tag || '').replace(/^#/, '').trim().toLowerCase();
    if (tag) out.add(tag);
  });
  const fm = cache.frontmatter || {};
  ['tags', 'tag'].forEach((key) => {
    const raw = fm[key];
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
    list.forEach((t) => {
      const tag = String(t).replace(/^#/, '').trim().toLowerCase();
      if (tag) out.add(tag);
    });
  });
  return Array.from(out);
}

/** Every tag in the vault with how many notes carry it, most used first. */
function vaultTags(app) {
  const counts = new Map();
  app.vault.getMarkdownFiles().forEach((file) => {
    noteTags(app.metadataCache.getFileCache(file)).forEach((tag) =>
      counts.set(tag, (counts.get(tag) || 0) + 1)
    );
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

const DATE_RANGES = {
  day: 'today',
  week: 'in the past week',
  month: 'in the past month',
  year: 'in the past year',
};

/** The earliest time a date filter lets through. */
function dateFloor(range, now = Date.now()) {
  if (range === 'day') {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  const days = { week: 7, month: 30, year: 365 }[range] || 0;
  return now - days * 86400000;
}

/** How a property filter reads: "status is draft", "has domain". */
function propertyFilterLabel(f) {
  if (f.value === null || f.value === undefined) return f.negate ? `No ${f.key}` : `Has ${f.key}`;
  return `${f.key} ${f.negate ? 'is not' : 'is'} ${f.value}`;
}

/** How a date filter reads: "Modified in the past week". */
function dateFilterLabel(f) {
  return `${f.field === 'created' ? 'Created' : 'Modified'} ${DATE_RANGES[f.range] || ''}`.trim();
}

/**
 * Recent searches as a list of what was looked for, not of keystrokes:
 * a term that only led to the newer one beside it ("liber", then
 * "liberal") gives way to where it ended up. Newest first, so each
 * entry is checked against the one before it. This also repairs lists
 * saved while every keystroke was being recorded.
 */
function collapseSearches(list) {
  const out = [];
  (list || []).forEach((term) => {
    const newer = out[out.length - 1];
    if (
      newer &&
      newer.length > term.length &&
      newer.toLowerCase().startsWith(term.toLowerCase())
    ) {
      return;
    }
    out.push(term);
  });
  return out;
}

/**
 * Arrow-key movement within a list.
 *
 * Every row here is focusable, but without this each one is its own tab
 * stop and nothing moves between them — which is not how a list behaves
 * anywhere else. One handler on the container walks its rows, so the
 * rows themselves stay unaware of it.
 */
function roveFocus(container, selector) {
  container.addEventListener('keydown', (evt) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (keys.indexOf(evt.key) === -1) return;
    if (evt.altKey || evt.metaKey || evt.ctrlKey) return;
    const target = evt.target;
    if (target && typeof target.closest === 'function' && target.closest('input, textarea, select')) return;

    const rows = Array.from(container.querySelectorAll(selector));
    if (!rows.length) return;

    // Tiles laid out in a grid move by the row as well as the item: as
    // many across as sit on the first line. A list has one across, and
    // leaves left and right to whatever else uses them.
    const across = gridColumns(rows);
    if ((evt.key === 'ArrowLeft' || evt.key === 'ArrowRight') && across < 2) return;

    // The container's own document: a popout window is another one.
    const active = container.ownerDocument.activeElement;
    const at = active && typeof active.closest === 'function' ? rows.indexOf(active.closest(selector)) : -1;
    const step = across > 1 ? across : 1;
    let next = at;
    if (evt.key === 'ArrowRight') next = at < 0 ? 0 : Math.min(at + 1, rows.length - 1);
    else if (evt.key === 'ArrowLeft') next = at < 0 ? 0 : Math.max(at - 1, 0);
    else if (evt.key === 'ArrowDown') next = at < 0 ? 0 : at + step < rows.length ? at + step : at;
    else if (evt.key === 'ArrowUp') next = at < 0 ? rows.length - 1 : at - step >= 0 ? at - step : at;
    else if (evt.key === 'Home') next = 0;
    else next = rows.length - 1;

    if (next === at) return;
    evt.preventDefault();
    rows[next].focus();
    if (typeof rows[next].scrollIntoView === 'function') rows[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

/** How many of these sit side by side on the first line. */
function gridColumns(items) {
  if (items.length < 2) return 1;
  const top = items[0].offsetTop;
  let n = 0;
  while (n < items.length && items[n].offsetTop === top) n++;
  // Nothing laid out (a hidden page) reads as all on one line; that's a list.
  return n === items.length && !items[0].offsetWidth ? 1 : n;
}

/**
 * Click, plus the keys a button answers to. Everything clickable in the
 * browse view is a div rather than a <button>, so this gives each one
 * the keyboard behaviour a real button would have. The handler gets the
 * event, so modifier keys still work (ctrl-click for a new tab).
 */
function onActivate(el, handler, space = true) {
  el.addEventListener('click', handler);
  el.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter' && !(space && evt.key === ' ')) return;
    evt.preventDefault();
    handler(evt);
  });
}

/** The icon for a file, by what kind of thing it is. */
function iconForFile(file) {
  if (file.extension === 'base') return 'layout-list';
  if (file.extension === 'canvas') return 'layout-dashboard';
  if (file.extension === 'md' || file.extension === 'pdf') return 'file-text';
  return 'file';
}

/** Every file beneath a folder, however deep. */
function countFilesIn(folder) {
  let n = 0;
  const walk = (f) =>
    (f.children || []).forEach((c) => {
      if (c instanceof TFolder) walk(c);
      else n++;
    });
  walk(folder);
  return n;
}

/**
 * A header button. Built as a div to match Obsidian's own chrome, so it
 * needs the role, tab stop and key handling a <button> would give for
 * free, plus aria-expanded since each one opens a panel or menu.
 */
function makeTrigger(cls, label, icon, onActivate) {
  const el = createDiv({ cls: `clickable-icon ${cls}` });
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-expanded', 'false');
  el.setAttribute('data-tooltip-position', 'bottom');
  setIcon(el, icon);

  el.addEventListener('click', (evt) => {
    evt.stopPropagation();
    onActivate(el);
  });
  el.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter' && evt.key !== ' ') return;
    evt.preventDefault();
    evt.stopPropagation();
    onActivate(el);
  });

  return el;
}

/* Classes stable enough to anchor a dropped icon to. */
const HEADER_ANCHORS = [
  'workspace-tab-header-container-inner',
  'workspace-tab-header-new-tab',
  'dr-trigger',
  'dr-settings-moved',
  'workspace-tab-header-spacer',
  'workspace-tab-header-tab-list',
  'sidebar-toggle-button',
];

function anchorClassOf(el) {
  if (!el) return null;
  for (const cls of HEADER_ANCHORS) {
    if (el.classList.contains(cls)) return cls;
  }
  return null;
}

/** Put an icon where it was last dropped, falling back to a default. */
function placeInHeader(header, el, anchor, fallback) {
  if (anchor === 'start') {
    header.prepend(el);
    return;
  }
  const target = anchor && header.querySelector(`.${anchor}`);
  if (target && target !== el && !target.contains(el)) {
    target.insertAdjacentElement('afterend', el);
    return;
  }
  fallback();
}

/**
 * The two icons, each after its saved neighbour. Whichever is placed
 * first can't follow the other, which isn't there yet; this runs after
 * each, so both end up where they were left.
 */
function settleHeader(header, order) {
  [
    ['.dr-trigger', order.actions],
    ['.dr-settings-moved', order.settings],
  ].forEach(([selector, anchor]) => {
    const el = header.querySelector(selector);
    if (!el || !anchor || anchor === 'start') return;
    placeInHeader(header, el, anchor, () => {});
  });
}

/**
 * Drag an icon along the header.
 *
 * The drop position is stored as the class of whatever it follows
 * rather than an index, so it survives Obsidian rebuilding the row and
 * doesn't shift when a tab is opened or closed.
 */
function makeHeaderDraggable(el, key, plugin) {
  // Obsidian's own gear can be made draggable more than once; its
  // earlier listeners go first, so they don't pile up.
  if (el.drDragOff) el.drDragOff();
  el.setAttribute('draggable', 'true');

  const start = (evt) => {
    evt.dataTransfer.setData('text/dr-header', key);
    evt.dataTransfer.effectAllowed = 'move';
    el.addClass('is-dragging');
    const header = el.parentElement;
    if (header) header.addClass('dr-header-dropping');
  };
  const end = () => {
    el.removeClass('is-dragging');
    document
      .querySelectorAll('.dr-header-dropping')
      .forEach((h) => h.removeClass('dr-header-dropping'));
    document
      .querySelectorAll('.dr-drop-before')
      .forEach((h) => h.removeClass('dr-drop-before'));
  };
  el.addEventListener('dragstart', start);
  el.addEventListener('dragend', end);
  el.drDragOff = () => {
    el.removeEventListener('dragstart', start);
    el.removeEventListener('dragend', end);
    el.removeAttribute('draggable');
    delete el.drDragOff;
  };

  // The header is Obsidian's, and outlives this plugin: its drop
  // handlers belong to one running copy, and go when that copy does —
  // so after an update or a reload, drops reach the copy now running.
  const header = el.parentElement;
  if (!header || header.drDropOwner === plugin) return;
  if (header.drDropOff) header.drDropOff();

  const nearest = (evt) => {
    const kids = Array.from(header.children).filter(
      (c) => !c.classList.contains('is-dragging')
    );
    for (const kid of kids) {
      const r = kid.getBoundingClientRect();
      if (evt.clientX < r.left + r.width / 2) return kid;
    }
    return null;
  };

  const over = (evt) => {
    if (!Array.from(evt.dataTransfer.types).includes('text/dr-header')) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'move';

    const before = nearest(evt);
    header
      .querySelectorAll('.dr-drop-before')
      .forEach((h) => h.removeClass('dr-drop-before'));
    if (before) before.addClass('dr-drop-before');
  };

  const drop = async (evt) => {
    const dropped = evt.dataTransfer.getData('text/dr-header');
    if (!dropped) return;
    evt.preventDefault();

    const moving = header.querySelector(
      dropped === 'actions' ? '.dr-trigger' : '.dr-settings-moved'
    );
    if (!moving) return;

    const before = nearest(evt);
    if (before) header.insertBefore(moving, before);
    else header.appendChild(moving);

    // Stored by what it now follows, so the position survives a rebuild.
    const previous = moving.previousElementSibling;
    plugin.settings.headerOrder[dropped] = anchorClassOf(previous) || 'start';
    await plugin.saveData(plugin.settings);

    header
      .querySelectorAll('.dr-drop-before')
      .forEach((h) => h.removeClass('dr-drop-before'));
  };

  header.addEventListener('dragover', over);
  header.addEventListener('drop', drop);
  header.drDropOwner = plugin;
  header.drDropOff = () => {
    header.removeEventListener('dragover', over);
    header.removeEventListener('drop', drop);
    delete header.drDropOwner;
    delete header.drDropOff;
  };
  plugin.register(() => {
    if (header.drDropOwner === plugin && header.drDropOff) header.drDropOff();
  });
}

/**
 * Park a hidden button row beneath a trigger.
 *
 * Buttons that open their own submenu anchor to their bounding box, so
 * hiding the row outright sends those submenus to the screen corner.
 * The CSS positions the row from these variables; it stays invisible
 * and inert but keeps a real, measurable position.
 */
function parkAt(rect) {
  document.body.style.setProperty('--dr-park-x', `${rect.left}px`);
  document.body.style.setProperty('--dr-park-y', `${rect.bottom + 4}px`);
}

function unpark() {
  document.body.style.removeProperty('--dr-park-x');
  document.body.style.removeProperty('--dr-park-y');
}

/**
 * A suggestion list matching the panel rather than the OS.
 *
 * A native datalist can't be styled — Electron draws it as a system
 * widget — so the list is built here. It lives on body and is fixed,
 * because the panel scrolls and an absolutely positioned child would
 * be clipped by its overflow box.
 */
function attachSuggest(field, input, opts) {
  const list = document.body.createDiv({ cls: 'dr-suggest' });
  let items = [];
  let active = -1;

  const hide = () => {
    list.removeClass('is-open');
    list.empty();
    items = [];
    active = -1;
  };

  const place = () => {
    const r = input.getBoundingClientRect();
    const width = Math.max(r.width, 180);
    const below = window.innerHeight - r.bottom;
    list.style.left = `${Math.min(r.left, window.innerWidth - width - 8)}px`;
    list.style.width = `${width}px`;
    if (below < 190 && r.top > below) {
      list.style.top = '';
      list.style.bottom = `${window.innerHeight - r.top + 4}px`;
    } else {
      list.style.bottom = '';
      list.style.top = `${r.bottom + 4}px`;
    }
  };

  const paint = () => {
    Array.from(list.children).forEach((c, i) => {
      if (i === active) c.addClass('is-selected');
      else c.removeClass('is-selected');
    });
  };

  const show = () => {
    // A list field suggests for the item being typed, not the whole line.
    const q = (opts.query ? opts.query() : input.value).trim().toLowerCase();
    items = opts
      .source()
      .filter((t) => t.toLowerCase().includes(q) && t.toLowerCase() !== q)
      .slice(0, 8);

    list.empty();
    if (!items.length) return hide();

    items.forEach((t) => {
      const el = list.createDiv({ cls: 'dr-suggest-item' });
      if (opts.icon) setIcon(el.createSpan({ cls: 'dr-suggest-icon' }), opts.icon);
      el.createSpan({ text: t });
      // mousedown, not click: blur would tear the list down first.
      el.addEventListener('mousedown', (evt) => {
        evt.preventDefault();
        opts.onSelect(t);
        hide();
      });
    });
    active = -1;
    place();
    list.addClass('is-open');
  };

  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => window.setTimeout(hide, 120));

  input.addEventListener('keydown', (evt) => {
    if (!list.hasClass('is-open')) return;
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      paint();
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      active = Math.max(active - 1, 0);
      paint();
    } else if (evt.key === 'Enter' && active >= 0 && !composing(evt)) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      opts.onSelect(items[active]);
      hide();
    } else if (evt.key === 'Escape') {
      evt.stopImmediatePropagation();
      hide();
    }
  });

  return list;
}

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/*                                                                     */
/* Pinning is bookmarking. The Bookmarks core plugin owns the data, so */
/* a pin made here shows in Obsidian's own bookmarks pane and outlives */
/* this plugin. Its add and remove methods aren't part of the public   */
/* API, so every call is guarded.                                      */
/* ------------------------------------------------------------------ */

class Pins {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  /** Pins in the order they've been arranged in, if they have been. */
  arranged(items) {
    return this.plugin.orders ? this.plugin.orders.arrangePins(items) : items;
  }

  /** Folders and notes together, in their arrangement, or folders first. */
  all() {
    return this.arranged(this.collect('folder', (p) => this.app.vault.getFolderByPath(p)).concat(
      this.collect('file', (p) => this.app.vault.getFileByPath(p))
    ));
  }

  /** The Bookmarks plugin's instance, if it's switched on. */
  instance() {
    try {
      const plugin = this.app.internalPlugins.getPluginById('bookmarks');
      if (!plugin || plugin.enabled === false) return null;
      const instance = plugin.instance;
      return instance && typeof instance.getBookmarks === 'function'
        ? instance
        : null;
    } catch (err) {
      return null;
    }
  }

  /** Every bookmark of a kind, flattened out of its groups. */
  collect(type, resolve) {
    const instance = this.instance();
    if (!instance) return [];
    const out = [];
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (item.type === 'group') return walk(item.items);
        // A bookmark to a heading or block is to that part, not a pin.
        if (item.type !== type || !item.path || item.subpath) return;
        const target = resolve(item.path);
        if (target && out.indexOf(target) === -1) out.push(target);
      });
    walk(instance.getBookmarks());
    return out;
  }

  files() {
    return this.arranged(this.collect('file', (p) => this.app.vault.getFileByPath(p)));
  }

  folders() {
    return this.arranged(this.collect('folder', (p) => this.app.vault.getFolderByPath(p)));
  }

  /** The bookmark for a path, searching inside groups too. */
  find(path) {
    const instance = this.instance();
    if (!instance) return null;
    let found = null;
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (found) return;
        if (item.type === 'group') return walk(item.items);
        if (item.path === path && !item.subpath) found = item;
      });
    walk(instance.getBookmarks());
    return found;
  }

  has(target) {
    return !!this.find(target.path);
  }

  toggle(target) {
    const instance = this.instance();
    if (!instance) {
      new Notice('Turn on the Bookmarks core plugin to pin things.');
      return false;
    }
    try {
      const existing = this.find(target.path);
      if (existing) instance.removeItem(existing);
      else {
        instance.addItem({
          type: target instanceof TFolder ? 'folder' : 'file',
          path: target.path,
        });
      }
      return true;
    } catch (err) {
      console.error('Design Redux: could not update pins', err);
      new Notice('Could not update pins.');
      return false;
    }
  }
}

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

/* ------------------------------------------------------------------ */
/* Feature base                                                        */
/*                                                                     */
/* Deliberately thin. Some features own DOM and need setting up and    */
/* tearing down; others are only commands. Everything here is optional */
/* so a feature implements what it actually has, rather than carrying  */
/* empty methods to satisfy a shape.                                   */
/*                                                                     */
/* Commands are declared, not registered: Obsidian has no public way   */
/* to remove a command, so registering them per feature on enable      */
/* would leave entries in the palette for features later switched off. */
/* The plugin registers every declared command once, at load.          */
/* ------------------------------------------------------------------ */

class Feature {
  constructor(plugin) {
    this.plugin = plugin;
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /**
   * Features with no settingKey are always on. A desktopOnly feature
   * rearranges chrome the mobile app doesn't have, so it's off there
   * whatever the setting says — the setting is shared through the vault.
   */
  get enabled() {
    if (this.constructor.desktopOnly && Platform.isMobile) return false;
    const key = this.constructor.settingKey;
    return !key || !!this.settings[key];
  }

  /** [{ id, name, check?, run }] — check gates palette visibility. */
  commands() {
    return [];
  }

  /** Rows for the settings tab, in order. */
  settingsSchema() {
    return [];
  }

  /**
   * Registrations that must happen at load: view types and anything
   * else Obsidian needs before it restores the workspace. Kept apart
   * from register(), which runs once the vault is ready.
   */
  registerTypes() {}

  /** Called once after layout is ready, whether enabled or not. */
  register() {}

  enable() {}
  disable() {}
  sync() {}
}

/* ------------------------------------------------------------------ */
/* Library layout editor                                               */
/*                                                                     */
/* The settings block that arranges the sidebar: sections, their       */
/* items, and the order of both. Kept apart from the feature so the    */
/* feature stays about behaviour.                                      */
/* ------------------------------------------------------------------ */

class LibraryEditor {
  constructor(library) {
    this.library = library;
    this.plugin = library.plugin;
    this.app = library.app;
  }

  get sections() {
    return this.plugin.settings.librarySections;
  }

  label(item) {
    if (item.kind === 'property') {
      return `By ${this.plugin.propertyLabel(item.key)}`;
    }
    if (item.kind === 'builtin') {
      const spec = LIBRARY_BUILTINS[item.id];
      return spec ? spec.label : item.id;
    }
    const target = this.app.vault.getAbstractFileByPath(item.path);
    if (!target) return `${item.path} (missing)`;
    return target instanceof TFolder ? target.name + '/' : target.basename;
  }

  icon(item) {
    if (item.kind === 'property') return 'tag';
    if (item.kind === 'builtin') {
      const spec = LIBRARY_BUILTINS[item.id];
      return spec ? spec.icon : 'circle';
    }
    return item.kind === 'folder' ? 'folder' : 'file-text';
  }

  /** Save, redraw the open views, and rebuild the settings block. */
  async commit(tab) {
    await this.plugin.saveSettings();
    this.library.refreshViews();
    tab.display();
  }

  /** A move-up, move-down, remove trio, since every row wants them. */
  controls(setting, list, index, tab, removeIcon) {
    setting.addExtraButton((b) =>
      b
        .setIcon('chevron-up')
        .setTooltip('Move up')
        .setDisabled(index === 0)
        .onClick(async () => {
          list.splice(index - 1, 0, list.splice(index, 1)[0]);
          await this.commit(tab);
        })
    );
    setting.addExtraButton((b) =>
      b
        .setIcon('chevron-down')
        .setTooltip('Move down')
        .setDisabled(index === list.length - 1)
        .onClick(async () => {
          list.splice(index + 1, 0, list.splice(index, 1)[0]);
          await this.commit(tab);
        })
    );
    setting.addExtraButton((b) =>
      b
        .setIcon(removeIcon)
        .setTooltip('Remove')
        .onClick(async () => {
          list.splice(index, 1);
          await this.commit(tab);
        })
    );
  }

  render(containerEl, tab) {
    this.sections.forEach((section, si) => {
      const head = new Setting(containerEl)
        .setClass('dr-set-section')
        .addText((t) =>
          t
            .setPlaceholder('Section heading (optional)')
            .setValue(section.title)
            .onChange(async (v) => {
              section.title = v;
              await this.plugin.saveSettings();
              this.library.refreshViews();
            })
        );
      this.controls(head, this.sections, si, tab, 'trash-2');

      (section.items || []).forEach((item, ii) => {
        const row = new Setting(containerEl)
          .setClass('dr-set-item')
          .setName(this.label(item));

        const icon = createSpan({ cls: 'dr-set-icon' });
        setIcon(icon, this.icon(item));
        row.nameEl.prepend(icon);

        this.controls(row, section.items, ii, tab, 'x');
      });

      new Setting(containerEl).setClass('dr-set-add').addButton((b) =>
        b.setButtonText('Add to this section').onClick(() => {
          new LibraryItemPicker(this.app, async (chosen) => {
            section.items.push(
              chosen.kind === 'builtin'
                ? { kind: 'builtin', id: chosen.id }
                : chosen.kind === 'property'
                  ? { kind: 'property', key: chosen.key }
                  : { kind: chosen.kind, path: chosen.path }
            );
            await this.commit(tab);
          }).open();
        })
      );
    });

    new Setting(containerEl)
      .setClass('dr-set-add')
      .addButton((b) =>
        b.setButtonText('Add section').onClick(async () => {
          this.sections.push({ title: 'New section', items: [] });
          await this.commit(tab);
        })
      )
      .addButton((b) =>
        b.setButtonText('Reset to vault layout').onClick(async () => {
          this.plugin.settings.librarySections = this.library.defaultSections();
          await this.commit(tab);
        })
      );
  }
}

/* ------------------------------------------------------------------ */
/* Library                                                             */
/*                                                                     */
/* A navigation view rather than a file tree: a short list of places    */
/* worth going, then folders you step into one level at a time, with   */
/* a back path across the top. The tree is still in the file explorer  */
/* for when the whole shape matters.                                   */
/* ------------------------------------------------------------------ */

class LibraryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return LIBRARY_VIEW;
  }

  getDisplayText() {
    return 'Library';
  }

  getIcon() {
    return 'library';
  }

  queueRender() {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      if (this.contentEl && this.contentEl.isConnected) this.render();
    }, 120);
  }

  /** Whether a note's change could change a row: it's listed, or it's a listed folder's note. */
  shows(file) {
    if (!file || !this.contentEl) return false;
    const listed = (path) => !!this.contentEl.querySelector(`.dr-lib-row[data-path="${CSS.escape(path)}"]`);
    if (listed(file.path)) return true;
    return !!file.parent && this.plugin.isFolderNote(file) && listed(file.parent.path);
  }

  async onOpen() {
    this.containerEl.addClass('dr-library');
    this.render();

    // Once per burst: a sync or a pull can create hundreds of files.
    this.registerEvent(this.app.vault.on('create', () => this.queueRender()));
    this.registerEvent(this.app.vault.on('delete', () => this.queueRender()));
    this.registerEvent(this.app.vault.on('rename', () => this.queueRender()));
    // A cover changed on something the list shows — a pinned note, or
    // a folder's note — shows here too.
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (this.shows(file)) this.queueRender();
      })
    );

    // markActive, not render: a rebuild between mousedown and mouseup
    // replaces the element under the cursor, so the click never
    // completes and the row appears to need a second press.
    const follow = () => {
      this.markActive();
      this.syncChrome();
    };
    this.registerEvent(this.app.workspace.on('file-open', follow));
    this.registerEvent(this.app.workspace.on('active-leaf-change', follow));
    // Moving between browse screens changes neither file nor leaf.
    this.registerEvent(this.app.workspace.on('layout-change', follow));

    // Pins made in Obsidian's own bookmarks pane, when Pinned is open.
    // The event isn't public API, so it's only listened for if there.
    try {
      const bookmarks = this.plugin.pins.instance();
      if (bookmarks && typeof bookmarks.on === 'function') {
        this.registerEvent(
          bookmarks.on('changed', () => {
            if (this.plugin.settings.pinsExpanded) this.render();
          })
        );
      }
    } catch (err) {
      /* no bookmarks events to follow */
    }

    this.syncChrome();
  }

  async onClose() {
    window.clearTimeout(this.renderTimer);
    const split = this.containerEl.closest('.workspace-split.mod-left-split');
    if (split) split.removeClass('dr-apple-sidebar');
  }

  onResize() {
    // Called when a sidebar tab is shown, which is when the panel shape
    // needs to follow it.
    this.syncChrome();
  }

  /**
   * The panel around the sidebar takes the reference's shape — a
   * floating rounded card with the vault at its foot — only while this
   * view is the one showing, so the file explorer or search in the same
   * sidebar keep Obsidian's own look.
   */
  syncChrome() {
    if (Platform.isMobile) return;
    const split = this.containerEl.closest('.workspace-split.mod-left-split');
    if (!split) return; // docked on the right, or in the main area
    // Whether this is the sidebar's chosen tab. isShown() also says no
    // while the sidebar is collapsed, which took the panel shape off and
    // nothing put it back when the sidebar reopened.
    const leafEl = this.containerEl.closest('.workspace-leaf');
    const chosen = leafEl
      ? window.getComputedStyle(leafEl).display !== 'none'
      : this.containerEl.isShown();
    split.toggleClass('dr-apple-sidebar', chosen);

    // The vault row stands in for the account row, with an initial in
    // place of the avatar.
    const switcher = split.querySelector('.workspace-drawer-vault-switcher');
    const name = this.app.vault.getName().trim();
    if (switcher && name) {
      switcher.setAttribute('data-dr-initial', name.charAt(0).toUpperCase());
    }
  }

  render() {
    const root = this.contentEl;
    root.empty();
    this.plugin.settings.librarySections.forEach((section) => {
      if (section.title) {
        root.createDiv({ cls: 'dr-lib-group', text: section.title });
      }
      const list = root.createDiv({ cls: 'dr-lib-list' });
      roveFocus(list, '.dr-lib-row');
      (section.items || []).forEach((item) => this.renderItem(list, item));
    });
    this.markActive();
  }

  /* -- the configured list ---------------------------------------- */

  renderItem(list, item) {
    if (item.kind === 'property') {
      this.row(list, {
        icon: 'tag',
        label: this.plugin.propertyLabel(item.key),
        screen: 'properties',
        property: item.key,
        onClick: () => this.browseMode({ mode: 'properties', property: item.key }),
      });
      return;
    }

    if (item.kind === 'builtin') {
      // "All notes" became the Notes screen; a saved layout still
      // naming it opens that instead of losing its row.
      const id = item.id === 'all' ? 'notes' : item.id;
      const spec = LIBRARY_BUILTINS[id];
      if (!spec) return;
      if (id === 'bookmarks') {
        this.renderPins(list, spec);
        return;
      }
      this.row(list, {
        icon: spec.icon,
        label: spec.label,
        screen: BUILTIN_SCREENS[id] || null,
        onClick: () => this.runBuiltin(id),
      });
      return;
    }

    const target = this.app.vault.getAbstractFileByPath(item.path);
    if (!target) return; // renamed or deleted since it was added
    this.targetRow(list, target, 0);
  }

  /** A folder or file, with its artwork and its menu. */
  targetRow(list, target, depth) {
    const menu = (evt, open) =>
      showTargetMenu(this.plugin, evt, target, {
        open: open,
        source: LIBRARY_VIEW,
        redraw: () => this.render(),
      });

    if (target instanceof TFolder) {
      const open = () => this.browseMode({ mode: 'folder', path: target.path });
      this.row(list, {
        depth: depth,
        icon: 'folder',
        art: this.plugin.folderCoverSrc(target),
        label: target.name,
        path: target.path,
        onClick: open,
        onMenu: (evt) => menu(evt, open),
      });
      return;
    }
    this.row(list, {
      depth: depth,
      icon: iconForFile(target),
      art: resolveCover(this.app, target, this.plugin.settings.coverProperty),
      label: target.basename,
      path: target.path,
      onClick: () => this.openFile(target),
      onMenu: (evt) => menu(evt, null),
    });
  }

  /**
   * Pinned as a group rather than a destination: clicking it anywhere
   * opens or closes its contents in place, the way Pins does in the app
   * this borrows from. The Pinned screen is still there, from Home's
   * Pinned heading. Not highlighted as where you are, since it isn't a
   * place you go.
   */
  renderPins(list, spec) {
    const open = !!this.plugin.settings.pinsExpanded;
    const toggle = () => this.togglePins();
    this.row(list, {
      icon: spec.icon,
      label: spec.label,
      group: 'pins',
      toggles: true,
      onClick: toggle,
      disclosure: { open: open, toggle: toggle },
    });
    if (!open) return;

    const pins = this.plugin.pins;
    const items = pins.all();
    if (!items.length) {
      list.createDiv({ cls: 'dr-lib-empty', text: 'Nothing pinned yet' });
      return;
    }
    items.forEach((target) => this.targetRow(list, target, 1));
  }

  togglePins() {
    const settings = this.plugin.settings;
    settings.pinsExpanded = !settings.pinsExpanded;
    // saveData, not saveSettings: this is a view preference, and a full
    // settings save would re-run every feature.
    this.plugin.saveData(settings);

    const hadFocus = this.contentEl.contains(document.activeElement);
    this.render();
    if (!hadFocus) return;
    const row = this.contentEl.querySelector('.dr-lib-row[data-group="pins"]');
    if (row) row.focus();
  }

  runBuiltin(id) {
    // Everything the sidebar points at opens in the main area, so the
    // sidebar is only a list of places and never a place of its own.
    if (BUILTIN_SCREENS[id]) {
      this.browseMode({ mode: BUILTIN_SCREENS[id] });
      return;
    }
    if (id === 'graph') this.app.commands.executeCommandById('graph:open');
    if (id === 'random') this.app.commands.executeCommandById('random-note:open');
  }

  browseMode(state) {
    const library = this.plugin.feature(Library);
    return library ? library.browseMode(state) : null;
  }

  /* -- rows ------------------------------------------------------- */

  /**
   * One row. Every row has a disclosure gutter left of its icon, empty
   * unless there's something to open out, so all the icons line up.
   *
   * spec: { icon, art?, label, onClick, onMenu?, path?, screen?,
   *         property?, group?, depth?, disclosure?: { open, toggle },
   *         toggles? } — toggles marks a row whose click opens or closes
   *         it rather than going somewhere.
   */
  row(parentEl, spec) {
    const el = parentEl.createDiv({ cls: 'dr-lib-row' });
    if (spec.depth) el.addClass('is-nested');
    if (spec.path) el.dataset.path = spec.path;
    if (spec.screen) el.dataset.screen = spec.screen;
    if (spec.property) el.dataset.property = spec.property;
    if (spec.group) el.dataset.group = spec.group;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');

    const gutter = el.createSpan({ cls: 'dr-lib-disclosure' });
    if (spec.disclosure) {
      const { open, toggle } = spec.disclosure;
      gutter.addClass('is-expandable');
      if (open) gutter.addClass('is-open');
      gutter.setAttribute('aria-label', open ? 'Collapse' : 'Expand');
      el.setAttribute('aria-expanded', String(open));
      setIcon(gutter, 'chevron-right');
      gutter.addEventListener('click', (evt) => {
        evt.stopPropagation();
        toggle();
      });
      // Right opens and left closes, as a disclosure does elsewhere.
      el.addEventListener('keydown', (evt) => {
        if ((evt.key === 'ArrowRight' && !open) || (evt.key === 'ArrowLeft' && open)) {
          evt.preventDefault();
          toggle();
        }
      });
    }

    const icon = el.createSpan({ cls: 'dr-lib-icon' });
    if (spec.art) {
      icon.addClass('has-art');
      fillArt(icon, spec.art, spec.icon);
    } else {
      setIcon(icon, spec.icon);
    }

    el.createSpan({ cls: 'dr-lib-label', text: spec.label });
    onActivate(el, (evt) => {
      spec.onClick(evt);
      // On a phone the library is a drawer over the page, so it gets
      // out of the way of what was just opened — but not of a group
      // being opened, whose contents you're about to choose from.
      if (Platform.isPhone && !spec.toggles) this.closeDrawer();
    });
    if (spec.onMenu) onContextMenu(el, (evt) => spec.onMenu(evt));
    return el;
  }

  closeDrawer() {
    const split = this.app.workspace.leftSplit;
    if (split && typeof split.collapse === 'function') split.collapse();
  }

  /** Exactly one row marks where you are, as the reference does. */
  markActive() {
    const rows = Array.from(this.contentEl.querySelectorAll('.dr-lib-row'));
    rows.forEach((el) => el.removeClass('is-active'));
    const here = this.activeRow(rows);
    if (here) here.addClass('is-active');
  }

  /**
   * A browse screen marks its own entry, a folder its row. A note marks
   * its own row if it has one, and otherwise the folder it sits in, so
   * reading something still shows which part of the library it's from.
   */
  activeRow(rows) {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    const byPath = (p) => (p ? rows.find((el) => el.dataset.path === p) : null);

    if (view instanceof BrowseView) {
      if (view.mode === 'folder') return byPath(view.path) || null;
      const screen = view.mode === 'property' ? 'properties' : view.mode;
      const exact =
        view.property &&
        rows.find(
          (el) => el.dataset.screen === screen && el.dataset.property === view.property
        );
      return (
        exact ||
        rows.find((el) => el.dataset.screen === screen && !el.dataset.property) ||
        rows.find((el) => el.dataset.screen === screen) ||
        null
      );
    }

    const file = view && view.file instanceof TFile ? view.file : null;
    if (!file) return null;
    return byPath(file.path) || (file.parent ? byPath(file.parent.path) : null);
  }

  openFile(file) {
    this.app.workspace.getLeaf(false).openFile(file);
  }

  /* -- data ------------------------------------------------------- */

}

/* ------------------------------------------------------------------ */
/* Browse screens                                                      */
/*                                                                     */
/* One class per screen. The view owns state, navigation and the parts */
/* every screen shares — artwork, rows, menus, sorting — and a screen  */
/* only decides what to draw. Adding a screen is a class and a line in */
/* the view's screen table.                                            */
/* ------------------------------------------------------------------ */

class BrowseScreen {
  constructor(view) {
    this.view = view;
    this.plugin = view.plugin;
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /** What the tab and the search field call this screen. */
  title() {
    return '';
  }

  render() {}
}

/* -- a folder, as an album ------------------------------------------ */

class FolderScreen extends BrowseScreen {
  title() {
    const folder = this.view.folder();
    return folder && folder.path !== '/'
      ? folder.name
      : this.app.vault.getName();
  }

  render(root) {
    const view = this.view;
    const folder = view.folder();

    // Which layout is decided by what the folder holds, not by what
    // Find or a filter lets through — otherwise typing flips the page
    // between tiles and an album, and hides the notes that match.
    const holdsNotes = (folder.children || []).some(
      (c) => c instanceof TFile && !this.plugin.isFolderNote(c)
    );
    const subfolders = view.visibleFolders(folder);

    // A folder of nothing but folders is a shelf: plain heading and
    // tiles. The album treatment is for one that actually holds notes.
    if (subfolders.length && !holdsNotes) {
      view.renderPlainHeader(root, folder);
      const folders = view.sortFolders(
        subfolders.filter((c) => view.folderInFilter(c)).filter((c) => view.matches(c.name))
      );
      if (!folders.length) {
        root.createDiv({ cls: 'dr-empty', text: 'No folders' });
        return;
      }
      const grid = root.createDiv({ cls: 'dr-grid' });
      roveFocus(grid, '.dr-card');
      folders.forEach((f) => view.folderCard(grid, f));
      return;
    }

    const discs = view.discsOf(folder, view.notesIn(folder));
    const all = discs.reduce((acc, d) => acc.concat(d.files), []);

    view.renderHeader(root, folder, all);
    if (!all.length && !view.editing) {
      root.createDiv({ cls: 'dr-empty', text: 'Nothing here' });
      return;
    }
    view.renderDiscs(root, discs, folder);
  }

}

/* -- every folder, as tiles ------------------------------------------ */

class FoldersScreen extends BrowseScreen {
  title() {
    return 'Folders';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const all = [];
    const walk = (folder) =>
      view.visibleFolders(folder).forEach((child) => {
        all.push(child);
        walk(child);
      });
    walk(this.app.vault.getRoot());

    const shown = view.sortFolders(
      all.filter((f) => view.folderInFilter(f)).filter((f) => view.matches(f.name))
    );

    if (!shown.length) {
      root.createDiv({ cls: 'dr-empty', text: 'No folders' });
      return;
    }

    const grid = root.createDiv({ cls: 'dr-grid' });
    roveFocus(grid, '.dr-card');
    shown.forEach((f) => view.folderCard(grid, f, f.parent && f.parent.name));
  }
}

/* -- every note, as a table ------------------------------------------ */

class NotesScreen extends BrowseScreen {
  title() {
    return 'Notes';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const notes = view.sortNotes(
      this.app.vault
        .getMarkdownFiles()
        .filter((f) => !this.plugin.isFolderNote(f))
        .filter((f) => view.inFilter(f))
        .filter((f) => view.matches(f.basename))
    );

    if (!notes.length) {
      root.createDiv({ cls: 'dr-empty', text: 'No notes' });
      return;
    }

    const columns = view.tableColumns();
    const table = root.createDiv({ cls: 'dr-table' });
    roveFocus(table, '.dr-tr:not(.dr-th)');

    const head = table.createDiv({ cls: 'dr-tr dr-th' });
    view.headerCell(head, 'title', 'Title', 'dr-td-title');
    columns.forEach((key) => view.headerCell(head, key, view.columnLabel(key)));
    view.headerCell(head, 'modified', 'Modified', 'dr-td-time');

    // Hundreds of rows are drawn at once; thousands wait to be asked for.
    const cap = 300;
    const all = view.expanded.has('notes-table');
    (all ? notes : notes.slice(0, cap)).forEach((file) => view.tableRow(table, file, columns));
    if (notes.length > cap) view.renderMoreRow(table, 'notes-table', notes.length, 'notes');
  }
}

/* -- a property, as an artist list ----------------------------------- */

class PropertiesScreen extends BrowseScreen {
  title() {
    return 'Properties';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const props = view.propertyList().filter((p) => view.matches(p.name));
    if (!props.length) {
      root.createDiv({ cls: 'dr-empty', text: 'No properties' });
      return;
    }

    const selected = props.find((p) => p.key === view.property) || null;

    const split = root.createDiv({ cls: 'dr-split' });
    const list = split.createDiv({ cls: 'dr-split-list' });
    roveFocus(list, '.dr-split-row');
    const detail = split.createDiv({ cls: 'dr-split-detail' });

    props.forEach((prop) => {
      const row = list.createDiv({ cls: 'dr-split-row' });
      if (selected && prop.key === selected.key) row.addClass('is-selected');
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      const thumb = row.createDiv({ cls: 'dr-split-thumb is-blank' });
      setIcon(
        thumb.createSpan({ cls: 'dr-card-glyph' }),
        TYPE_ICONS[prop.type] || 'tag'
      );

      row.createDiv({ cls: 'dr-split-name', text: prop.name });
      row.createDiv({ cls: 'dr-split-count', text: String(prop.count) });

      onActivate(row, () => view.navigate({ property: prop.key }));
      onContextMenu(row, (evt) => this.propertyMenu(evt, prop.name));
    });

    if (!selected) {
      detail.createDiv({ cls: 'dr-split-empty', text: 'Select a property' });
      return;
    }

    // On a phone there's room for the list or the values, not both, so
    // choosing a property swaps one for the other — the way an artist
    // opens from the Artists list — and back returns to the list. The
    // heading says whose values these are, since the list isn't beside
    // them to show it.
    split.addClass('has-selection');
    const heading = detail.createDiv({ cls: 'dr-split-heading', text: selected.name });
    onContextMenu(heading, (evt) => this.propertyMenu(evt, selected.name));

    const groups = view.groupsByProperty(selected.key);
    if (!groups.length) {
      detail.createDiv({
        cls: 'dr-split-empty',
        text: 'No notes carry this property',
      });
      return;
    }
    // A category arrives naming one value: it leads, and the rest
    // follow beneath so the screen is still the whole property.
    const ordered = view.value
      ? groups
          .slice()
          .sort((a, b) =>
            a.value === view.value ? -1 : b.value === view.value ? 1 : 0
          )
      : groups;
    ordered.forEach((group, i) => view.renderGroup(detail, group, i === 0));
  }

  /** A property's own menu, from its row or its heading: rename it everywhere. */
  propertyMenu(evt, name) {
    const bulk = this.plugin.feature(BulkEditing);
    if (!bulk) return;
    evt.preventDefault();
    const menu = new Menu();
    const root = this.app.vault.getRoot();
    [
      ['Rename everywhere…', 'pencil', () => bulk.openRenameProperty(name)],
      ['Change type…', 'shapes', () => bulk.openChangeType(name)],
      ['Find notes missing it…', 'list-checks', () => bulk.openMissing([root], name)],
      ['Remove from every note…', 'list-minus', () => bulk.openRemove([root], [name])],
    ].forEach(([title, icon, run]) => menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(run)));
    showMenuAt(menu, evt);
  }
}

/* -- recents and pins, as tiles -------------------------------------- */

class CollectionScreen extends BrowseScreen {
  get pinned() {
    return this.view.mode === 'pinned';
  }

  title() {
    return this.pinned ? 'Pinned' : 'Recently opened';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    let files = (this.pinned
      ? this.plugin.pins.files()
      : this.plugin.recentFiles()
    )
      .filter((f) => view.inFilter(f))
      .filter((f) => view.matches(f.basename));

    // Recency is the point of the recents screen, so it keeps that
    // order until another is chosen there. Pins keep the order they
    // were pinned in on the same terms.
    if (!view.keepsOwnOrder()) files = view.sortFiles(files);

    // Pinned folders come first, since a folder is a way into many of
    // the files that might follow.
    const folders = this.pinned
      ? this.plugin.pins
          .folders()
          .filter((f) => view.folderInFilter(f))
          .filter((f) => view.matches(f.name))
      : [];
    const orderedFolders = view.keepsOwnOrder() ? folders : view.sortFolders(folders);

    if (!files.length && !folders.length) {
      root.createDiv({
        cls: 'dr-empty',
        text: this.pinned ? 'Nothing pinned yet' : 'Nothing opened yet',
      });
      return;
    }

    const grid = root.createDiv({ cls: 'dr-grid' });
    roveFocus(grid, '.dr-card');
    // Pins you've put in order are shown in it, folders and notes mixed;
    // otherwise folders lead, as a way into many of the notes after them.
    if (this.pinned && view.keepsOwnOrder() && this.plugin.orders.pinOrder().length) {
      const shown = new Set(files.concat(folders));
      this.plugin.pins.all().filter((t) => shown.has(t)).forEach((t) => {
        if (t instanceof TFolder) view.folderCard(grid, t);
        else view.fileCard(grid, t);
      });
    } else {
      orderedFolders.forEach((f) => view.folderCard(grid, f));
      files.forEach((file) => view.fileCard(grid, file));
    }
    if (this.pinned && view.keepsOwnOrder()) view.arrangeableTiles(grid);
  }
}

/* -- search ---------------------------------------------------------- */

class SearchScreen extends BrowseScreen {
  title() {
    return 'Search';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const q = view.query.trim().toLowerCase();
    if (!q) return this.renderIdle(root);
    this.renderResults(root, q);
  }

  /* -- nothing typed yet ------------------------------------------ */

  /**
   * A screen in its own right rather than an empty box: what you looked
   * for last, and a way into the vault by category.
   */
  renderIdle(root) {
    const recents = collapseSearches(this.settings.recentSearches).slice(0, 8);

    if (recents.length) {
      const head = this.heading(root, 'Recently searched');
      const clear = head.createDiv({ cls: 'dr-search-clear' });
      clear.setAttribute('role', 'button');
      clear.setAttribute('tabindex', '0');
      clear.setText('Clear');
      onActivate(clear, async () => {
        this.settings.recentSearches = [];
        await this.plugin.saveData(this.settings);
        this.view.render();
      });

      const grid = root.createDiv({ cls: 'dr-recent-grid' });
      roveFocus(grid, '.dr-recent');
      recents.forEach((term) => this.recentCard(grid, term));
    }

    const categories = this.categories();
    if (!categories.length) {
      if (!recents.length) {
        root.createDiv({
          cls: 'dr-split-empty',
          text: 'Search notes, folders and properties',
        });
      }
      return;
    }

    this.heading(root, 'Browse categories');
    const grid = root.createDiv({ cls: 'dr-cat-grid' });
    roveFocus(grid, '.dr-cat');
    categories.forEach((cat) => this.categoryCard(grid, cat));
  }

  heading(root, text) {
    const head = root.createDiv({ cls: 'dr-search-section' });
    head.createSpan({ cls: 'dr-search-section-title', text: text });
    return head;
  }

  recentCard(grid, term) {
    const card = grid.createDiv({ cls: 'dr-recent' });
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const art = card.createDiv({ cls: 'dr-recent-art' });
    setIcon(art.createSpan({ cls: 'dr-card-glyph' }), 'search');

    const text = card.createDiv({ cls: 'dr-recent-text' });
    text.createDiv({ cls: 'dr-recent-title', text: term });
    text.createDiv({ cls: 'dr-recent-sub', text: 'Search' });

    onActivate(card, () => {
      this.view.query = term;
      this.view.render();
      const input = this.view.contentEl.querySelector('.dr-browse-search input');
      if (!input) return;
      input.focus();
      input.setSelectionRange(term.length, term.length);
    });
  }

  /**
   * The values of one property, standing in for Apple's genres: the
   * broadest thing a vault divides itself into. Which property is a
   * setting, since every vault names its own.
   */
  categories() {
    const key = this.settings.categoryProperty;
    if (!key) return [];
    return this.view
      .groupsByProperty(key)
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 18);
  }

  categoryCard(grid, group) {
    const card = grid.createDiv({ cls: 'dr-cat' });
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    // No artwork to draw on, so the colour comes from the name itself —
    // stable, so a category keeps its colour between visits.
    let hash = 0;
    for (let i = 0; i < group.value.length; i++) {
      hash = (hash * 31 + group.value.charCodeAt(i)) % 360;
    }
    card.style.setProperty('--dr-cat-hue', String(hash));

    const cover = this.view.groupCover(group);
    if (cover) {
      const img = card.createEl('img', { cls: 'dr-cat-art' });
      img.src = cover;
      img.alt = '';
      img.addEventListener('error', () => img.remove());
    }

    card.createSpan({ cls: 'dr-cat-name', text: group.value });
    card.createSpan({
      cls: 'dr-cat-count',
      text: group.files.length === 1 ? '1 note' : `${group.files.length} notes`,
    });

    onActivate(card, () =>
      this.view.navigate({
        mode: 'properties',
        property: this.settings.categoryProperty,
        value: group.value,
      })
    );
  }

  /* -- results ----------------------------------------------------- */

  renderResults(root, q) {
    const view = this.view;

    const folders = [];
    const walk = (folder) =>
      view.visibleFolders(folder).forEach((child) => {
        if (child.name.toLowerCase().includes(q) && view.folderInFilter(child)) folders.push(child);
        walk(child);
      });
    walk(this.app.vault.getRoot());

    // Names and property values, both of which the cache already holds.
    // Searching note bodies would mean reading every file on each
    // keystroke, so that's handed to Obsidian's own search instead.
    const notes = view.sortFiles(
      this.app.vault
        .getMarkdownFiles()
        .filter((f) => !this.plugin.isFolderNote(f))
        .filter((f) => view.inFilter(f))
        .filter(
          (f) =>
            f.basename.toLowerCase().includes(q) ||
            view.propertyText(f).includes(q)
        )
    );

    const count = folders.length + notes.length;
    const head = root.createDiv({ cls: 'dr-search-head' });
    head.createSpan({
      cls: 'dr-search-count',
      text: count === 1 ? '1 result' : `${count} results`,
    });

    const full = head.createDiv({ cls: 'dr-search-full' });
    full.setAttribute('role', 'button');
    full.setAttribute('tabindex', '0');
    setIcon(full.createSpan({ cls: 'dr-search-full-icon' }), 'file-search');
    full.createSpan({ text: 'Search inside notes' });
    onActivate(full, () => {
      try {
        const search = this.app.internalPlugins.getPluginById('global-search');
        search.instance.openGlobalSearch(view.query);
      } catch (err) {
        console.error('Design Redux: could not open search', err);
        new Notice('Turn on the Search core plugin to search inside notes.');
      }
    });

    if (!count) {
      root.createDiv({ cls: 'dr-split-empty', text: 'No matches' });
      return;
    }

    if (folders.length) {
      const grid = root.createDiv({ cls: 'dr-grid' });
      roveFocus(grid, '.dr-card');
      folders.forEach((f) => view.folderCard(grid, f, f.parent && f.parent.name));
    }

    if (notes.length) {
      const list = root.createDiv({ cls: 'dr-tracks' });
      roveFocus(list, '.dr-track');
      view.renderLimited(list, notes, 'search', 40);
    }
  }
}

class HomeScreen extends BrowseScreen {
  title() {
    return 'Home';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    // Find and the filters narrow every shelf, as they do every screen.
    const keep = (f) => view.inFilter(f) && view.matches(f.basename);
    const home = this.app.vault.getFileByPath(this.settings.homePath || 'Home.md');
    const note = home && keep(home) ? home : null;

    const recents = this.plugin.recentFiles().filter(keep).slice(0, 12);
    const pinned = this.plugin.pins.files().filter(keep).slice(0, 12);
    const folders = view.sortFolders(
      view
        .visibleFolders(this.app.vault.getRoot())
        .filter((f) => view.folderInFilter(f))
        .filter((f) => view.matches(f.name))
    );

    if (note) this.shelf(root, 'Continue', [note], null);
    if (recents.length) this.shelf(root, 'Recently opened', recents, 'recents');
    if (pinned.length) this.shelf(root, 'Pinned', pinned, 'pinned');
    if (folders.length) this.shelf(root, 'Folders', folders, 'folders');

    if (!note && !recents.length && !pinned.length && !folders.length) {
      root.createDiv({ cls: 'dr-split-empty', text: 'Nothing here yet' });
    }
  }

  /**
   * A titled row of tiles. The heading is the way through to the whole
   * of whatever it's showing, as a section header is on a home screen.
   */
  shelf(root, title, items, mode) {
    const view = this.view;
    const head = root.createDiv({ cls: 'dr-shelf-head' });

    if (mode) {
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.addClass('is-linked');
      onActivate(head, () => view.navigate({ mode: mode, property: null }));
    }
    head.createSpan({ cls: 'dr-shelf-title', text: title });
    if (mode) setIcon(head.createSpan({ cls: 'dr-shelf-more' }), 'chevron-right');

    const grid = root.createDiv({ cls: 'dr-grid' });
    roveFocus(grid, '.dr-card');
    items.forEach((item) => {
      if (item instanceof TFolder) view.folderCard(grid, item);
      else view.fileCard(grid, item);
    });
  }
}

/* Screens you start from, rather than arrive at. */
const ROOT_MODES = ['home', 'search'];

/* Which screen a mode draws. */
const BROWSE_SCREENS = {
  home: HomeScreen,
  search: SearchScreen,
  folder: FolderScreen,
  folders: FoldersScreen,
  notes: NotesScreen,
  properties: PropertiesScreen,
  property: PropertiesScreen,
  recents: CollectionScreen,
  pinned: CollectionScreen,
};

/* ------------------------------------------------------------------ */
/* Browse                                                              */
/*                                                                     */
/* The main area, in four shapes: a folder as an album page, a         */
/* property as a list of its values, every folder as tiles, and every  */
/* note as a table.                                                    */
/* ------------------------------------------------------------------ */

class BrowseView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    // Opts the view into the leaf's history, so moving between screens
    // is recorded alongside the notes opened in the same leaf — one
    // stack covering both, which is what back and forward need.
    this.navigation = true;
    this.mode = 'folder'; // folder | properties | folders | notes | recents | pinned
    this.path = '/';
    this.property = null;
    this.value = null;
    this.query = '';
    this.selected = null;
    this.renderTimer = 0;
    // A property column chosen in the Notes table; its Title and
    // Modified columns follow the shared order instead.
    this.columnSort = null;
    // Folder paths, or property values, whose full list is showing.
    this.expanded = new Set();
    // Filters, each narrowing every screen until cleared: notes under
    // one folder, with one tag, with a property value, from a period.
    this.clearFilters();
  }

  getViewType() {
    return BROWSE_VIEW;
  }

  getDisplayText() {
    return this.screen().title();
  }

  propertyLabel() {
    return this.plugin.propertyLabel(this.property || '');
  }

  getIcon() {
    return 'layout-grid';
  }

  getState() {
    return {
      mode: this.mode,
      path: this.path,
      property: this.property,
      value: this.value,
      // The way back down through folders, so history brings it back.
      trail: this.trail || null,
    };
  }

  async setState(state, result) {
    const before = JSON.stringify(this.getState());
    if (state) {
      // Leaving the search screen with something typed counts as having
      // searched for it; the query is about to be cleared.
      this.rememberSearch();
      if (state.mode) this.mode = state.mode;
      if (state.path) this.path = state.path;
      if (state.property !== undefined) this.property = state.property;
      this.value = state.value || null;
      if (state.trail !== undefined) this.trail = state.trail || null;
      // A move to another screen starts clean; refinements within one
      // screen keep their own state because they don't come through
      // here at all.
      this.selected = null;
      this.query = '';
      this.clearFilters();
      this.editing = false;
    }
    // A move to another screen is a step Obsidian's back and forward
    // should know about; it records one only when told.
    if (state && result && JSON.stringify(this.getState()) !== before) result.history = true;
    this.render();
    if (this.contentEl) this.contentEl.scrollTop = 0;
    return super.setState(state, result);
  }

  async onOpen() {
    this.containerEl.addClass('dr-browse');
    this.render();

    // "/" goes to Find from anywhere on the page. The keydown covers
    // focus inside it; the view's scope covers the page being active
    // with nothing on it focused, which keys wouldn't otherwise reach.
    this.registerDomEvent(this.containerEl, 'keydown', (evt) => this.onKey(evt));
    try {
      if (typeof Scope === 'function' && this.app.scope) {
        this.scope = new Scope(this.app.scope);
        if (typeof this.scope.register === 'function') {
          this.scope.register([], '/', (evt) => {
            const t = evt.target;
            if (t && typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"]')) return true;
            return !this.focusFind();
          });
        }
      }
    } catch (err) {
      /* the keydown alone still covers focus inside the page */
    }

    this.registerEvent(this.app.vault.on('create', () => this.queueRender()));
    this.registerEvent(this.app.vault.on('delete', () => this.queueRender()));
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.followRename(file, oldPath);
        this.queueRender();
      })
    );
    // A page redrawn while hidden is redrawn again when it's shown.
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf && this.stale) this.render();
      })
    );

    // Covers come from frontmatter, and processFrontMatter writes the
    // file a beat before the cache reflects it — so redrawing straight
    // after a write shows the card as it was. This catches up.
    this.registerEvent(
      this.app.metadataCache.on('changed', () => this.queueRender())
    );

    // Right-clicking the page itself, rather than something on it,
    // offers the folder's own menu — so a note can be made in the folder
    // you're looking at. Everything on the page with a menu of its own
    // stops the event before it gets here.
    onContextMenu(this.contentEl, (evt) => {
      if (this.mode !== 'folder') return;
      const el = evt.target;
      if (el && typeof el.closest === 'function' && el.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }
      showTargetMenu(this.plugin, evt, this.folder(), {
        here: true,
        redraw: () => this.render(),
      });
    });
  }

  /**
   * Coalesced: a single edit can fire several of these in a row. A page
   * that isn't showing — a background tab — isn't redrawn at all until
   * it is.
   */
  queueRender() {
    if (this.renderTimer) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = 0;
      if (!this.contentEl || !this.contentEl.isConnected) return;
      if (typeof this.containerEl.isShown === 'function' && !this.containerEl.isShown()) {
        this.stale = true;
        return;
      }
      const doc = this.contentEl.ownerDocument;
      const active = doc.activeElement;
      const inside = !!active && this.contentEl.contains(active);
      // A name being changed is drawn over once it's done with, not mid-word.
      if (inside && active.matches('.dr-edit-name')) {
        this.renderAfterEdit = true;
        return;
      }
      const typing = inside && active.matches('.dr-browse-search input');
      if (typing) this.renderBelowBar();
      else this.render();
    }, 50);
  }

  /** Obsidian calls this when the page is shown or resized. */
  onResize() {
    if (this.stale) this.render();
  }

  /**
   * A folder renamed or moved while it's shown — or while it's the
   * filter, or on the way back down — is followed to its new path,
   * rather than the page falling back to the vault's root.
   */
  followRename(file, oldPath) {
    if (!(file instanceof TFolder)) return;
    const moved = (p) =>
      !p ? p : p === oldPath ? file.path : p.startsWith(oldPath + '/') ? file.path + p.slice(oldPath.length) : p;
    this.path = moved(this.path);
    this.trail = moved(this.trail);
    this.filterFolder = moved(this.filterFolder);
  }

  async onClose() {
    // Replaced by a result opened in the same page.
    this.rememberSearch();
    // A pending redraw would otherwise run against a closed view.
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    this.renderTimer = 0;
  }

  /* -- navigation -------------------------------------------------- */

  /**
   * Change screens through the workspace rather than by re-rendering.
   *
   * setViewState is what puts an entry in the leaf's history; mutating
   * state and calling render() moves the view without the app knowing,
   * which is why back used to skip whole screens.
   */
  navigate(state) {
    return this.leaf.setViewState({
      type: BROWSE_VIEW,
      active: true,
      state: Object.assign(
        {
          mode: this.mode,
          path: this.path,
          property: this.property,
          value: null,
          trail: this.trail || null,
        },
        state
      ),
    });
  }

  canGo(dir) {
    return canStep(this.leaf, dir);
  }

  go(dir) {
    step(this.leaf, dir);
  }

  /**
   * Shown only while the sidebar is closed. Obsidian's own reopen
   * buttons sit in the tab bar and note header, which single content
   * area hides, so without this there was no way back.
   */
  renderSidebarToggle(bar) {
    const el = bar.createDiv({ cls: 'dr-browse-up dr-sidebar-toggle' });
    el.setAttribute('aria-label', 'Show sidebar');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    setIcon(el, 'panel-left');
    onActivate(el, () => this.app.workspace.leftSplit.expand());
  }

  /**
   * Back and forward. On a folder they move through the folders
   * themselves — back to the folder this one is in, forward down again
   * — while the strip's pair keeps to the history, so there's one of
   * each. Every other screen's pair is the history.
   */
  renderNav(bar) {
    const button = (icon, label, enabled, onClick) => {
      const el = bar.createDiv({ cls: 'dr-browse-up' });
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      if (!enabled) {
        el.addClass('is-disabled');
        return el;
      }
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      onActivate(el, onClick);
      return el;
    };

    if (this.mode === 'folder') {
      const folder = this.folder();
      const { parent, child } = this.folderSteps(folder);
      button(
        'chevron-left',
        parent ? `Back to ${this.folderName(parent)}` : 'Back',
        !!parent,
        () => this.folderUp(folder, parent)
      ).addClass('is-folder-step');
      button(
        'chevron-right',
        child ? `Forward to ${child.name}` : 'Forward',
        !!child,
        () => this.openFolder(child)
      ).addClass('dr-browse-forward', 'is-folder-step');
      return;
    }

    const hasHistory = !!leafHistory(this.leaf);
    button('chevron-left', 'Back', this.canGo('back'), () => this.go('back'));
    if (hasHistory) {
      button('chevron-right', 'Forward', this.canGo('forward'), () =>
        this.go('forward')
      ).addClass('dr-browse-forward');
    }
  }

  /**
   * Where a folder's back and forward lead. Back is the folder it sits
   * in; the vault's root has none. Forward is the way you came up, if
   * you came up — the trail keeps the deepest folder left, so going up
   * two levels comes back down both — and otherwise the first subfolder,
   * so forward always means further in.
   */
  folderSteps(folder) {
    if (!folder) return { parent: null, child: null };
    const root = !!(folder.isRoot && folder.isRoot());
    const parent = !root && folder.parent ? folder.parent : null;

    let child = null;
    const base = root ? '' : folder.path + '/';
    if (this.trail && this.trail.startsWith(base) && this.trail !== folder.path) {
      const next = base + this.trail.slice(base.length).split('/')[0];
      const found = this.app.vault.getFolderByPath(next);
      if (found && this.visibleFolders(folder).indexOf(found) !== -1) child = found;
    }
    if (!child) child = this.visibleFolders(folder)[0] || null;
    return { parent, child };
  }

  /** Up a level, remembering the way back down. */
  folderUp(folder, parent) {
    if (!parent) return;
    // A deeper trail through this folder is kept; any other is replaced.
    if (!this.trail || !this.trail.startsWith(folder.path + '/')) this.trail = folder.path;
    this.openFolder(parent);
  }

  folderName(folder) {
    return folder.isRoot && folder.isRoot() ? this.app.vault.getName() : folder.name;
  }

  /**
   * Go into a folder. The mode has to change too: render() picks the
   * screen from the mode before it ever looks at the path.
   */
  openFolder(folder) {
    return this.navigate({
      mode: 'folder',
      path: folder && folder.path ? folder.path : '/',
      property: null,
    });
  }

  folder() {
    return this.app.vault.getFolderByPath(this.path) || this.app.vault.getRoot();
  }

  render() {
    this.stale = false;
    const root = this.contentEl;
    root.empty();

    // A screen that throws should say so rather than leave a blank
    // pane: the rest of the view still works, and the console carries
    // the detail.
    try {
      this.screen().render(root);
    } catch (err) {
      console.error(`Design Redux: the ${this.mode} screen failed`, err);
      root.empty();
      root.createDiv({
        cls: 'dr-empty',
        text: 'This screen could not be drawn. See the console for details.',
      });
    }
  }

  /** The screen this mode draws, built fresh so it holds no state. */
  screen() {
    const Screen = BROWSE_SCREENS[this.mode] || FolderScreen;
    return new Screen(this);
  }

  /* -- every folder, as tiles ------------------------------------- */

  /* -- every note, as a table ------------------------------------- */

  tableRow(table, file, columns) {
    const row = table.createDiv({ cls: 'dr-tr' });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    const title = row.createDiv({ cls: 'dr-td dr-td-title' });
    title.createSpan({ cls: 'dr-td-text', text: file.basename });

    const more = title.createDiv({ cls: 'clickable-icon dr-td-more' });
    more.setAttribute('aria-label', 'More');
    setIcon(more, 'ellipsis');
    more.addEventListener('click', (evt) => this.fileMenu(evt, file));

    columns.forEach((key) =>
      row.createDiv({ cls: 'dr-td', text: this.valueOf(file, key) })
    );
    row.createDiv({
      cls: 'dr-td dr-td-time',
      text: this.relative(file.stat.mtime),
    });

    onActivate(row, (evt) => this.openFile(file, evt), false);
    onContextMenu(row, (evt) => this.fileMenu(evt, file));
  }

  /**
   * A column heading that sorts by its own column, the way a song list
   * does — clicking again reverses it, and the active column carries
   * the arrow. Title either way, and Modified newest first, are orders
   * every screen shares, so choosing them here chooses them everywhere;
   * a property column, or oldest first, is this table's alone.
   */
  headerCell(head, key, label, extra) {
    const cell = head.createDiv({ cls: `dr-td ${extra || ''}`.trim() });
    const current = this.tableSort;
    const active = current.key === key;
    if (active) cell.addClass('is-sorted');

    cell.createSpan({ cls: 'dr-td-text', text: label });
    if (active) {
      const arrow = cell.createSpan({ cls: 'dr-th-arrow' });
      setIcon(arrow, current.dir === 'asc' ? 'chevron-up' : 'chevron-down');
    }

    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    onActivate(cell, () => {
      // Text reads best ascending, time newest first.
      const next = active
        ? { key: key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: key, dir: key === 'modified' || key === 'created' ? 'desc' : 'asc' };
      const shared = Object.keys(TABLE_SORTS).find(
        (k) => TABLE_SORTS[k].key === next.key && TABLE_SORTS[k].dir === next.dir
      );
      if (shared) this.setSort(shared);
      else this.columnSort = next;
      this.render();
    });
  }

  sortNotes(files) {
    const { key, dir } = this.tableSort;
    const mul = dir === 'asc' ? 1 : -1;
    const value = (f) => {
      if (key === 'title') return f.basename.toLowerCase();
      if (key === 'modified') return f.stat.mtime;
      if (key === 'created') return f.stat.ctime;
      return (this.valueOf(f, key) || '').toLowerCase();
    };

    return files.slice().sort((a, b) => {
      if (key === 'title') return byName(a.basename, b.basename) * mul;
      const x = value(a);
      const y = value(b);
      // Blanks last whichever way the column is pointing.
      if (x === '' && y !== '') return 1;
      if (y === '' && x !== '') return -1;
      if (x === y) return byName(a.basename, b.basename);
      // Text in the order a person would put it — 2 before 10.
      if (typeof x === 'string' && typeof y === 'string') return byName(x, y) * mul;
      return (x > y ? 1 : -1) * mul;
    });
  }

  /** The properties used as columns, from settings. */
  tableColumns() {
    return (this.plugin.settings.tableColumns || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  columnLabel(key) {
    try {
      const info = this.app.metadataTypeManager.getAllProperties()[key.toLowerCase()];
      if (info && info.name) return info.name;
    } catch (err) {
      /* fall through */
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  valueOf(file, key) {
    const cache = this.app.metadataCache.getFileCache(file);
    const v = cache && fmGet(cache.frontmatter, key);
    if (v === undefined || v === null || v === '') return '';
    return Array.isArray(v) ? v.map((x) => this.plain(x)).join(', ') : this.plain(v);
  }

  plain(value) {
    return plainValue(value);
  }

  /* -- a property, two panes -------------------------------------- */

  /* -- properties -------------------------------------------------- */

  /** Every property in use, with how many notes carry it. */
  propertyList() {
    try {
      const all = this.app.metadataTypeManager.getAllProperties();
      return Object.keys(all)
        .map((key) => ({
          key: key,
          name: (all[key] && all[key].name) || key,
          count: (all[key] && (all[key].count || all[key].occurrences)) || 0,
          type: (all[key] && (all[key].type || all[key].widget)) || 'text',
        }))
        .filter((p) => p.count > 0)
        .sort((a, b) =>
          this.sort === 'name-desc' ? byName(b.name, a.name) : byName(a.name, b.name)
        );
    } catch (err) {
      return [];
    }
  }

  /** Every distinct value of a property, with the notes carrying it. */
  groupsByProperty(key) {
    const map = new Map();

    this.app.vault.getMarkdownFiles().forEach((file) => {
      if (this.plugin.isFolderNote(file)) return;
      if (!this.inFilter(file)) return;
      const cache = this.app.metadataCache.getFileCache(file);
      const raw = cache && fmGet(cache.frontmatter, key);
      if (raw === undefined || raw === null || raw === '') return;

      const values = Array.isArray(raw) ? raw : [raw];
      values.forEach((v) => {
        const value = this.plain(v);
        if (!value) return;
        if (!map.has(value)) map.set(value, []);
        map.get(value).push(file);
      });
    });

    return this.sortGroups(
      Array.from(map.entries()).map(([value, files]) => ({
        value: value,
        files: this.sortFiles(files),
      }))
    );
  }

  /** A group borrows the first cover any of its notes carries. */
  groupCover(group) {
    for (const file of group.files) {
      const src = this.coverFor(file);
      if (src) return src;
    }
    return null;
  }

  renderGroup(detail, group, isPrimary) {
    const block = detail.createDiv({ cls: 'dr-album' });

    const head = block.createDiv({ cls: 'dr-album-head' });
    const titles = head.createDiv({ cls: 'dr-album-titles' });
    titles.createDiv({
      cls: isPrimary ? 'dr-album-name is-primary' : 'dr-album-name',
      text: group.value,
    });
    // A value can be renamed everywhere it's used; under tags, each
    // value is a tag, renamed in notes' text as well.
    const bulk = this.plugin.feature(BulkEditing);
    if (bulk && this.property) {
      onContextMenu(head, (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        if (TAG_KEYS.indexOf(String(this.property).toLowerCase()) !== -1) {
          const tag = String(group.value).replace(/^#/, '');
          menu.addItem((item) =>
            item
              .setTitle(`Rename #${tag} everywhere…`)
              .setIcon('hash')
              .onClick(() => bulk.openRenameTag(tag))
          );
        } else {
          menu.addItem((item) =>
            item
              .setTitle('Rename this value everywhere…')
              .setIcon('pencil')
              .onClick(() => bulk.openRenameValue(this.plugin.propertyLabel(this.property), String(group.value)))
          );
        }
        showMenuAt(menu, evt);
      });
    }
    titles.createDiv({
      cls: 'dr-album-meta',
      text:
        `${this.propertyLabel()}  ·  ` +
        (group.files.length === 1 ? '1 note' : `${group.files.length} notes`),
    });

    const body = block.createDiv({ cls: 'dr-album-body' });
    const art = body.createDiv({ cls: 'dr-album-art' });
    this.fillArt(art, this.groupCover(group), 'file-text', this.genName(String(group.value)));

    const list = body.createDiv({ cls: 'dr-tracks' });
    roveFocus(list, '.dr-track');
    // Keyed by property too: the same value can occur under two.
    this.renderLimited(
      list,
      group.files,
      `value:${this.property}:${group.value}`,
      this.limitFrom('albumNoteLimit', 8)
    );
  }

  /** Title and search, for the screens with no folder behind them. */
  renderTitleBar(root, title) {
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    this.renderSidebarToggle(bar);
    // Home and Search are where you start, so there's nothing behind
    // them to go back to; the other screens are arrived at.
    if (ROOT_MODES.indexOf(this.mode) === -1) this.renderNav(bar);
    bar.createDiv({ cls: 'dr-browse-title', text: title });
    this.renderSearchField(bar);
    this.renderFilterChips(root);
  }

  /** Back, title and search — no artwork, no actions. */
  renderPlainHeader(root, folder) {
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    this.renderSidebarToggle(bar);

    this.renderNav(bar);

    bar.createDiv({ cls: 'dr-browse-title', text: this.getDisplayText() });
    this.renderSearchField(bar);
    this.renderFilterChips(root);
  }

  /* -- header ----------------------------------------------------- */

  /* -- discs ------------------------------------------------------ */

  /** Notes directly inside a folder, filtered and in the chosen order. */
  notesIn(folder) {
    return this.arranged(
      folder,
      (folder.children || [])
        .filter((c) => c instanceof TFile)
        .filter((c) => !this.plugin.isFolderNote(c))
        .filter((c) => this.inFilter(c))
        .filter((c) => this.matches(c.basename))
    );
  }

  /** A folder's notes in its own arrangement, if it has one on, or the shared order. */
  arranged(folder, files) {
    return this.plugin.orders.arrangeAlbum(folder, files, (list) => this.sortFiles(list));
  }

  /** Every note in a folder, Find and filters aside — what an arrangement covers. */
  allNotesIn(folder) {
    return this.arranged(
      folder,
      (folder.children || []).filter((c) => c instanceof TFile && !this.plugin.isFolderNote(c))
    );
  }

  /** An order can be arranged by hand only while everything in it is showing. */
  canArrange() {
    return !this.query.trim() && !this.hasFilters();
  }

  /**
   * An album's contents split the way a multi-disc album is: the
   * folder's own notes first, then each subfolder beneath it as its
   * own disc, numbered from one. Deeper folders become discs too,
   * titled by their path, so nothing nested goes missing.
   */
  discsOf(folder, loose) {
    const discs = [];
    // Editing shows the whole album — every note, and a disc for every
    // subfolder, even an empty one, so it can be renamed or filled.
    const editing = !!this.editing;
    const own = editing ? this.allNotesIn(folder) : loose;
    if (own.length || editing) discs.push({ title: this.folderName(folder), folder: folder, files: own });

    // Each level in the shared order, a folder's own discs after it.
    const subfolders = (parent) =>
      editing
        ? (parent.children || []).filter((c) => c instanceof TFolder).sort((a, b) => byName(a.name, b.name))
        : this.visibleFolders(parent);
    const walk = (parent, prefix) =>
      this.sortFolders(subfolders(parent)).forEach((child) => {
        const title = prefix ? `${prefix} / ${child.name}` : child.name;
        const files = editing ? this.allNotesIn(child) : this.notesIn(child);
        if (files.length || editing) discs.push({ title: title, folder: child, files: files });
        walk(child, title);
      });
    walk(folder, '');

    return discs;
  }

  /**
   * A run of track rows that stops after `limit`, with a row to reveal
   * the rest. `key` remembers the choice across redraws, so expanding a
   * list survives a sort or a metadata change.
   */
  renderLimited(list, files, key, limit) {
    if (this.editing && this.mode === 'folder') {
      files.forEach((file, i) => this.editRow(list, file, i + 1));
      return;
    }
    const expanded = this.expanded.has(key);
    const shown = expanded ? files : files.slice(0, limit);
    shown.forEach((file, i) => this.trackRow(list, file, i + 1));
    if (files.length <= limit) return;

    const more = list.createDiv({ cls: 'dr-track dr-track-more-row' });
    more.setAttribute('role', 'button');
    more.setAttribute('tabindex', '0');
    more.createDiv({ cls: 'dr-track-num' });
    more.createDiv({
      cls: 'dr-track-name dr-more-label',
      text: expanded ? 'Show less' : `Show all ${files.length}`,
    });
    onActivate(more, () => {
      if (expanded) this.expanded.delete(key);
      else this.expanded.add(key);
      this.render();
    });
  }

  /** A numeric setting, never below one. */
  limitFrom(key, fallback) {
    return Math.max(1, Number(this.plugin.settings[key]) || fallback);
  }

  /**
   * Dropping a note on a disc moves it into that folder.
   *
   * Rows and headings both carry the folder they belong to, so the
   * target is whatever the cursor is over — dropping on a note in a
   * disc means the same as dropping on its heading.
   */
  acceptDrops(list) {
    const folderAt = (evt) => {
      // Any element, from any window — a popout's aren't this window's HTMLElement.
      const el = evt.target && typeof evt.target.closest === 'function'
        ? evt.target.closest('[data-folder]')
        : null;
      return el ? el.dataset.folder : null;
    };

    const clear = () =>
      list
        .querySelectorAll('.is-drop-target, .is-drop-before, .is-drop-after')
        .forEach((el) => el.removeClass('is-drop-target', 'is-drop-before', 'is-drop-after'));

    // Over a row of the disc it came from, it's being put in order: a
    // line shows where it will go.
    const arrangingOver = (evt) => {
      const drag = this.dragging;
      const el = evt.target && typeof evt.target.closest === 'function'
        ? evt.target.closest('.dr-track[data-path]')
        : null;
      if (!drag || !el || el.dataset.folder !== drag.folder) return null;
      const box = el.getBoundingClientRect();
      return { row: el, after: evt.clientY > box.top + box.height / 2 };
    };

    list.addEventListener('dragover', (evt) => {
      if (!Array.from(evt.dataTransfer.types).includes('text/dr-file')) return;
      const over = arrangingOver(evt);
      if (over) {
        clear();
        if (!this.canArrange()) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'move';
        if (over.row.dataset.path !== this.dragging.path) {
          over.row.addClass(over.after ? 'is-drop-after' : 'is-drop-before');
        }
        return;
      }
      const folder = folderAt(evt);
      if (folder === null) return;
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'move';

      clear();
      // Mark the whole disc, not just the row under the cursor.
      list
        .querySelectorAll(`[data-folder="${CSS.escape(folder)}"]`)
        .forEach((el) => el.addClass('is-drop-target'));
    });

    list.addEventListener('dragleave', (evt) => {
      if (!list.contains(evt.relatedTarget)) clear();
    });

    list.addEventListener('drop', async (evt) => {
      const path = evt.dataTransfer.getData('text/dr-file');
      const over = arrangingOver(evt);
      const folder = folderAt(evt);
      clear();
      if (over) {
        evt.preventDefault();
        if (path && this.canArrange() && over.row.dataset.path !== path) {
          this.arrangeTrack(path, over.row.dataset.path, over.after);
        }
        return;
      }
      if (!path || folder === null) return;
      evt.preventDefault();

      const file = this.app.vault.getFileByPath(path);
      if (!file) return;
      if (await this.plugin.moveFile(file, folder)) {
        new Notice(`Moved "${file.basename}" to ${folder.split('/').pop()}.`);
      }
    });
  }

  /**
   * The discs, each headed. A subfolder's heading opens that folder, as
   * a disc's does; the folder's own disc is the page already showing.
   * An album of very many discs — the vault's root holds every folder —
   * shows the first few dozen, with a row for the rest.
   */
  renderDiscs(root, discs, album) {
    const list = root.createDiv({ cls: 'dr-tracks' });
    roveFocus(list, '.dr-track, .dr-disc[role="button"]');
    // Discs are folders, so dragging a note onto one moves it there; onto
    // a row of its own disc, it goes there in the album's order.
    if (!Platform.isMobile && !this.editing) this.acceptDrops(list);

    const key = `discs:${album ? album.path : ''}`;
    const cap = 24;
    const shown = this.expanded.has(key) ? discs : discs.slice(0, cap);

    // Every disc is headed, including the folder's own notes and a
    // lone disc, so an album reads the same whatever its shape.
    shown.forEach((disc) => {
      const head = list.createDiv({ cls: 'dr-disc' });
      if (disc.folder) head.dataset.folder = disc.folder.path;
      setIcon(head.createSpan({ cls: 'dr-disc-icon' }), 'disc');
      if (this.editing && disc.folder && album && disc.folder !== album) {
        this.editDiscHead(head, disc, album);
        this.renderLimited(list, disc.files, `disc:${disc.folder.path}`, 0);
        return;
      }
      head.createSpan({ cls: 'dr-disc-title', text: disc.title });
      head.createSpan({
        cls: 'dr-disc-count',
        text: disc.files.length === 1 ? '1 note' : `${disc.files.length} notes`,
      });

      if (disc.folder) {
        const here = !!album && disc.folder === album;
        if (!here) {
          head.setAttribute('role', 'button');
          head.setAttribute('tabindex', '0');
          head.setAttribute('aria-label', `Open ${disc.folder.name}`);
          onActivate(head, () => this.openFolder(disc.folder));
        }
        onContextMenu(head, (evt) =>
          this.folderMenu(evt, disc.folder, this.folderCover(disc.folder), { here })
        );
      }

      this.renderLimited(
        list,
        disc.files,
        `disc:${disc.folder ? disc.folder.path : disc.title}`,
        this.limitFrom('discNoteLimit', 10)
      );
    });

    if (discs.length > cap) this.renderMoreRow(list, key, discs.length, 'discs');
  }

  /** "Show all N …" / "Show less", remembered across redraws. */
  renderMoreRow(list, key, total, noun) {
    const expanded = this.expanded.has(key);
    const more = list.createDiv({ cls: 'dr-track dr-track-more-row' });
    more.setAttribute('role', 'button');
    more.setAttribute('tabindex', '0');
    more.createDiv({ cls: 'dr-track-num' });
    more.createDiv({
      cls: 'dr-track-name dr-more-label',
      text: expanded ? 'Show less' : `Show all ${total} ${noun}`,
    });
    onActivate(more, () => {
      if (expanded) this.expanded.delete(key);
      else this.expanded.add(key);
      this.render();
    });
  }

  /* -- the album header ------------------------------------------ */

  /**
   * Large art, a title block and two actions. Shared by folders and by
   * the collections — recents and pins — which have no folder behind
   * them but read the same way.
   */
  renderAlbumHead(root, spec) {
    const head = root.createDiv({ cls: 'dr-detail' });
    const folder = spec.folder || null;
    const editing = !!folder && !!this.editing;
    head.toggleClass('is-editing', editing);

    const art = head.createDiv({ cls: 'dr-detail-art' });
    this.fillArt(art, spec.cover, spec.glyph || 'folder', spec.genName);
    if (spec.onArtMenu) {
      onContextMenu(art, (evt) => spec.onArtMenu(evt));
    }
    if (editing && folder.path !== '/') {
      const tools = art.createDiv({ cls: 'dr-art-tools' });
      if (!spec.cover) {
        const tint = tools.createDiv({ cls: 'dr-art-edit' });
        tint.setAttribute('role', 'button');
        tint.setAttribute('tabindex', '0');
        tint.setAttribute('aria-label', 'Cover colour');
        setIcon(tint, 'palette');
        onActivate(tint, () => this.plugin.chooseCoverColor(folder));
      }
      const change = tools.createDiv({ cls: 'dr-art-edit' });
      change.setAttribute('role', 'button');
      change.setAttribute('tabindex', '0');
      change.setAttribute('aria-label', spec.cover ? 'Change cover image' : 'Set cover image');
      setIcon(change, 'image');
      onActivate(change, () => this.plugin.setFolderCover(folder, () => this.render()));
    }

    const info = head.createDiv({ cls: 'dr-detail-info' });
    if (editing && folder.path !== '/') {
      const title = info.createEl('input', { cls: 'dr-detail-title dr-edit-name', type: 'text' });
      title.value = folder.name;
      title.dataset.editPath = folder.path;
      title.setAttribute('aria-label', 'Folder name');
      this.editField(title, folder.name, (name) => this.renameEntry(folder, name));
    } else {
      info.createDiv({ cls: 'dr-detail-title', text: spec.title });
    }
    if (spec.sub) info.createDiv({ cls: 'dr-detail-sub', text: spec.sub });

    const files = spec.files || [];
    const meta = [files.length === 1 ? '1 item' : `${files.length} items`];
    const newest = files.reduce((t, f) => Math.max(t, f.stat.mtime), 0);
    if (newest) meta.push(`Updated ${this.relative(newest)}`);
    info.createDiv({ cls: 'dr-detail-meta', text: meta.join('  ·  ') });

    const actions = info.createDiv({ cls: 'dr-detail-actions' });
    if (editing) {
      this.action(actions, 'check', 'Done', () => this.setEditing(false)).addClass('is-primary');
      this.action(actions, 'file-plus', 'New note', () => this.editNewNote(folder));
      this.action(actions, 'folder-plus', 'New folder', () => this.editNewFolder(folder));
      return;
    }
    this.action(actions, 'book-open', 'Open', () => {
      const target = files[0];
      if (target) this.app.workspace.getLeaf(false).openFile(target);
    });
    this.action(actions, 'shuffle', 'Random', () => {
      if (!files.length) return;
      const pick = files[Math.floor(Math.random() * files.length)];
      this.app.workspace.getLeaf(false).openFile(pick);
    });
    if (folder) this.action(actions, 'pencil', 'Edit', () => this.setEditing(true));
  }

  renderHeader(root, folder, files) {
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    this.renderSidebarToggle(bar);
    this.renderNav(bar);
    this.renderSearchField(bar);
    this.renderFilterChips(root);

    const note = this.plugin.folderNote(folder);
    const src = this.folderCover(folder);
    this.renderAlbumHead(root, {
      title: this.getDisplayText(),
      sub: note ? this.subtitleFor(note) : '',
      cover: src,
      glyph: 'folder',
      genName: this.genName(this.getDisplayText(), folder.path),
      folder: folder,
      // files is in display order — discs concatenated, each sorted —
      // so Open lands on the first row you see. The folder note stands
      // for the folder rather than being part of its contents.
      files: files,
      onArtMenu: (evt) => this.folderMenu(evt, folder, src, { here: true }),
    });
  }

  /** Subfolders, minus the empty ones when that's switched on. */
  visibleFolders(folder) {
    return (folder.children || [])
      .filter((c) => c instanceof TFolder)
      .filter((c) => !this.plugin.settings.hideEmptyFolders || this.plugin.folderHasNotes(c))
      .sort((a, b) => byName(a.name, b.name));
  }

  fillArt(el, src, glyph, name) {
    fillArt(el, src, glyph, name);
  }

  /* -- shared actions --------------------------------------------- */

  openFile(file, evt) {
    // Opening a result is the clearest sign a search found something.
    this.rememberSearch();
    const newTab = !!(evt && (evt.ctrlKey || evt.metaKey));
    this.app.workspace.getLeaf(newTab).openFile(file);
  }

  fileMenu(evt, file) {
    if (this.mode === 'pinned') {
      showTargetMenu(this.plugin, evt, file, { redraw: () => this.render(), arrange: this.pinSteps(file) });
      return;
    }
    showTargetMenu(this.plugin, evt, file, { redraw: () => this.render() });
  }

  folderMenu(evt, folder, _src, opts) {
    showTargetMenu(this.plugin, evt, folder, {
      open: () => this.openFolder(folder),
      here: !!(opts && opts.here),
      redraw: () => this.render(),
      arrange: this.mode === 'pinned' ? this.pinSteps(folder) : null,
    });
  }

  /* -- sorting and filtering ------------------------------------- */

  /** The one ordering every screen uses, so a choice sticks. */
  sortFiles(files) {
    return sortByOrder(files, this.sort);
  }

  /**
   * Folders in the shared order: by name either way, or by their
   * newest note — a folder's own dates say nothing about what's in it.
   */
  sortFolders(folders) {
    const sort = this.sort;
    const list = folders.slice();
    if (sort === 'name-desc') return list.sort((a, b) => byName(b.name, a.name));
    if (sort === 'modified' || sort === 'created') {
      return list.sort(
        (a, b) => this.folderTime(b, sort) - this.folderTime(a, sort) || byName(a.name, b.name)
      );
    }
    return list.sort((a, b) => byName(a.name, b.name));
  }

  /** The newest note anywhere in a folder. Worked out once per drawing. */
  folderTime(folder, field) {
    if (!this.timeMemo) {
      const memo = { modified: new Map(), created: new Map() };
      this.app.vault.getMarkdownFiles().forEach((file) => {
        for (let p = file.parent; p; p = p.parent) {
          memo.modified.set(p.path, Math.max(memo.modified.get(p.path) || 0, file.stat.mtime));
          memo.created.set(p.path, Math.max(memo.created.get(p.path) || 0, file.stat.ctime));
          if (p.isRoot && p.isRoot()) break;
        }
      });
      this.timeMemo = memo;
      window.setTimeout(() => (this.timeMemo = null), 0);
    }
    return this.timeMemo[field].get(folder.path) || 0;
  }

  /** A property's values in the shared order: by value, or by their newest note. */
  sortGroups(groups) {
    const sort = this.sort;
    const newest = (g) =>
      g.files.reduce((t, f) => Math.max(t, sort === 'created' ? f.stat.ctime : f.stat.mtime), 0);
    const list = groups.slice();
    if (sort === 'name-desc') return list.sort((a, b) => byName(b.value, a.value));
    if (sort === 'modified' || sort === 'created') {
      return list.sort((a, b) => newest(b) - newest(a) || byName(a.value, b.value));
    }
    return list.sort((a, b) => byName(a.value, b.value));
  }

  /**
   * The order every screen uses. One, kept in settings, so a choice made
   * on any screen holds on all of them — in every open tab, after a
   * note has been opened and closed, and after a restart.
   */
  get sort() {
    return this.plugin.settings.defaultSort || 'name';
  }

  /** How the Notes table is sorted: its own column, or the shared order. */
  get tableSort() {
    return this.columnSort || TABLE_SORTS[this.sort] || TABLE_SORTS.name;
  }

  /**
   * The name of this screen's own order, if it has one: Recently opened
   * and Pinned always do, and an album does once it's been arranged.
   */
  ownOrderLabel() {
    if (this.mode === 'folder') {
      const folder = this.folder();
      return folder && this.plugin.orders.hasAlbum(folder) ? 'Album order' : null;
    }
    return OWN_ORDER[this.mode] || null;
  }

  /** Whether this screen keeps its own order — Recently opened, Pinned, an arranged album. */
  keepsOwnOrder() {
    if (this.mode === 'folder') {
      const folder = this.folder();
      return !!folder && this.plugin.orders.albumOn(folder);
    }
    if (!OWN_ORDER[this.mode]) return false;
    const own = this.plugin.settings.keepOwnOrder || {};
    return own[this.mode] !== false;
  }

  /**
   * Choose an order. 'own' goes back to a screen's own; anything else
   * becomes the order everywhere, and every open screen redraws in it.
   */
  setSort(key) {
    const settings = this.plugin.settings;
    if (this.mode === 'folder') {
      // An arranged album keeps its arrangement to go back to.
      const folder = this.folder();
      if (folder && this.plugin.orders.hasAlbum(folder)) this.plugin.orders.setAlbumOn(folder, key === 'own');
    } else if (OWN_ORDER[this.mode]) {
      settings.keepOwnOrder = Object.assign({}, settings.keepOwnOrder, {
        [this.mode]: key === 'own',
      });
    }
    if (key !== 'own') settings.defaultSort = key;
    this.columnSort = null;
    this.plugin.saveData(settings);

    if (typeof this.app.workspace.getLeavesOfType !== 'function') return;
    liveViews(this.app, BROWSE_VIEW, BrowseView).forEach((view) => {
      if (view === this) return;
      view.columnSort = null;
      view.render();
    });
  }

  /** The order in effect, as the menu names it; null for a column it doesn't list. */
  currentSort() {
    if (this.keepsOwnOrder()) return 'own';
    if (this.mode === 'notes' && this.columnSort) return null;
    return this.sort;
  }

  /** Through every filter that's set. */
  inFilter(file) {
    if (this.filterFolder && !file.path.startsWith(this.filterFolder + '/')) return false;
    if (!this.filterTag && !this.filterProp && !this.filterDate) return true;

    if (this.filterDate) {
      const stat = file.stat || {};
      const time = this.filterDate.field === 'created' ? stat.ctime : stat.mtime;
      if (!time || time < dateFloor(this.filterDate.range)) return false;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    if (this.filterTag) {
      const want = this.filterTag;
      // A parent tag takes in the ones nested under it, as in Obsidian.
      if (!noteTags(cache).some((t) => t === want || t.startsWith(want + '/'))) return false;
    }

    if (this.filterProp) {
      const f = this.filterProp;
      const fm = (cache && cache.frontmatter) || {};
      const name = Object.keys(fm).find((k) => k.toLowerCase() === f.key.toLowerCase());
      const raw = name === undefined ? undefined : fm[name];
      const values = (Array.isArray(raw) ? raw : [raw])
        .filter((v) => v !== null && v !== undefined && v !== '')
        .map((v) => plainValue(v).toLowerCase());
      const has =
        f.value === null || f.value === undefined
          ? values.length > 0
          : values.indexOf(String(f.value).toLowerCase()) !== -1;
      if (has === !!f.negate) return false;
    }
    return true;
  }

  hasFilters() {
    return !!(this.filterFolder || this.filterTag || this.filterProp || this.filterDate);
  }

  clearFilters() {
    this.filterFolder = null;
    this.filterTag = null;
    this.filterProp = null;
    this.filterDate = null;
  }

  /**
   * A folder shown as a tile: under the folder filter, and — while a
   * tag, property or date filter is on — holding at least one note that
   * passes, anywhere inside it. Worked out once per drawing.
   */
  folderInFilter(folder) {
    if (this.filterFolder && !folder.path.startsWith(this.filterFolder + '/')) return false;
    if (!this.filterTag && !this.filterProp && !this.filterDate) return true;
    if (!this.filterMemo) {
      const paths = new Set();
      this.app.vault.getMarkdownFiles().forEach((file) => {
        if (!this.inFilter(file)) return;
        for (let p = file.parent; p && !(p.isRoot && p.isRoot()); p = p.parent) paths.add(p.path);
      });
      this.filterMemo = paths;
      window.setTimeout(() => (this.filterMemo = null), 0);
    }
    return this.filterMemo.has(folder.path);
  }

  renderFilterButton(bar) {
    const btn = bar.createDiv({ cls: 'clickable-icon dr-filter-btn' });
    btn.setAttribute('aria-label', 'Sort and filter');
    setIcon(btn, 'list-filter');
    const usual = this.ownOrderLabel() ? 'own' : 'name';
    if (this.hasFilters() || this.currentSort() !== usual) btn.addClass('is-active');

    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    onActivate(btn, (evt) => showMenuAt(this.filterMenu(), evt));
  }

  /**
   * Sort, then the filters. A filter that's on shows what it's set to,
   * ticked; choosing it again turns it off, and the chips under the bar
   * change or remove one without the menu.
   */
  filterMenu() {
    const menu = new Menu();
    const redraw = () => this.render();

    const current = this.currentSort();
    const own = this.ownOrderLabel();
    const orders = own ? [['own', own]].concat(SORTS) : SORTS;
    orders.forEach(([key, label]) =>
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(current === key)
          .onClick(() => {
            this.setSort(key);
            redraw();
          })
      )
    );

    menu.addSeparator();
    const filter = (title, icon, on, pick, clear) =>
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .setChecked(on)
          .onClick(() => {
            if (!on) return pick();
            clear();
            redraw();
          })
      );

    filter(
      this.filterFolder ? `In ${this.filterFolder.split('/').pop()}` : 'Folder…',
      'folder', !!this.filterFolder,
      () => this.pickFolder(), () => (this.filterFolder = null)
    );
    filter(
      this.filterTag ? `Tagged #${this.filterTag}` : 'Tag…',
      'tag', !!this.filterTag,
      () => this.pickTag(), () => (this.filterTag = null)
    );
    filter(
      this.filterProp ? propertyFilterLabel(this.filterProp) : 'Property…',
      'list', !!this.filterProp,
      () => this.pickProperty(), () => (this.filterProp = null)
    );
    if (this.filterProp) {
      menu.addItem((item) =>
        item
          .setTitle('Exclude these instead')
          .setIcon('minus-circle')
          .setChecked(!!this.filterProp.negate)
          .onClick(() => {
            this.filterProp.negate = !this.filterProp.negate;
            redraw();
          })
      );
    }
    filter(
      this.filterDate ? dateFilterLabel(this.filterDate) : 'Date…',
      'calendar', !!this.filterDate,
      () => this.pickDate(), () => (this.filterDate = null)
    );

    if (this.hasFilters()) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle('Clear filters')
          .setIcon('x')
          .onClick(() => {
            this.clearFilters();
            redraw();
          })
      );
    }
    return menu;
  }

  pickFolder() {
    new FolderPicker(this.app, (folder) => {
      this.filterFolder = folder.path;
      this.render();
    }).open();
  }

  pickTag() {
    const items = vaultTags(this.app).map(({ tag, count }) => ({
      label: `#${tag}`,
      value: tag,
      note: String(count),
    }));
    new ChoicePicker(this.app, 'Which tag?', items, (item) => {
      this.filterTag = item.value;
      this.render();
    }).open();
  }

  /** The property, then its value — or any value at all. */
  pickProperty() {
    const items = knownPropertyNames(this.app).map((name) => ({ label: name, value: name }));
    new ChoicePicker(this.app, 'Which property?', items, (item) => {
      const key = item.value;
      const values = [{ label: `Has any ${key}`, value: null }].concat(
        propertyValues(this.app, key).map((v) => ({ label: v, value: v }))
      );
      new ChoicePicker(this.app, `${key} is…`, values, (choice) => {
        this.filterProp = { key: key, value: choice.value, negate: false };
        this.render();
      }).open();
    }).open();
  }

  pickDate() {
    const items = [];
    ['modified', 'created'].forEach((field) =>
      Object.keys(DATE_RANGES).forEach((range) =>
        items.push({ label: dateFilterLabel({ field, range }), value: { field, range } })
      )
    );
    new ChoicePicker(this.app, 'When?', items, (item) => {
      this.filterDate = item.value;
      this.render();
    }).open();
  }

  /**
   * The filters in effect, as chips under the bar — so a narrowed screen
   * never passes for the whole of something. A chip's name changes it;
   * its cross takes it off.
   */
  renderFilterChips(root) {
    const chips = [];
    if (this.filterFolder) {
      chips.push([`In ${this.filterFolder.split('/').pop()}`, () => this.pickFolder(), () => (this.filterFolder = null)]);
    }
    if (this.filterTag) {
      chips.push([`#${this.filterTag}`, () => this.pickTag(), () => (this.filterTag = null)]);
    }
    if (this.filterProp) {
      chips.push([propertyFilterLabel(this.filterProp), () => this.pickProperty(), () => (this.filterProp = null)]);
    }
    if (this.filterDate) {
      chips.push([dateFilterLabel(this.filterDate), () => this.pickDate(), () => (this.filterDate = null)]);
    }
    if (!chips.length) return;

    const row = root.createDiv({ cls: 'dr-filter-chips' });
    chips.forEach(([label, change, clear]) => {
      const chip = row.createDiv({ cls: 'dr-chip' });
      const name = chip.createSpan({ cls: 'dr-chip-label', text: label });
      name.setAttribute('role', 'button');
      name.setAttribute('tabindex', '0');
      name.setAttribute('aria-label', `Change: ${label}`);
      onActivate(name, change);
      const x = chip.createSpan({ cls: 'dr-chip-clear' });
      x.setAttribute('role', 'button');
      x.setAttribute('tabindex', '0');
      x.setAttribute('aria-label', `Remove: ${label}`);
      setIcon(x, 'x');
      onActivate(x, () => {
        clear();
        this.render();
      });
    });
  }

  /**
   * Keep a finished search — Enter, opening a result, or leaving the
   * screen with something typed. Saved with saveData rather than
   * saveSettings: a list of searches is not a setting, and a full
   * settings save re-runs every feature in the plugin.
   */
  async rememberSearch() {
    const term = this.query.trim();
    if (this.mode !== 'search' || term.length < 2) return;
    const settings = this.plugin.settings;
    const list = (settings.recentSearches || []).filter(
      (t) => t.toLowerCase() !== term.toLowerCase()
    );
    list.unshift(term);
    settings.recentSearches = collapseSearches(list).slice(0, 8);
    await this.plugin.saveData(settings);
  }

  /**
   * Redraw everything except the bar, for changes that don't alter it —
   * a query being typed, or data arriving while someone types. The
   * screen is drawn off to one side and everything after its bar is
   * moved in, so the bar on screen, and the field in it, stay put.
   */
  renderBelowBar() {
    const root = this.contentEl;
    const bar = root.firstElementChild;
    if (!bar || !bar.classList.contains('dr-detail-bar')) {
      this.render();
      return;
    }

    const scratch = root.ownerDocument.createElement('div');
    try {
      this.screen().render(scratch);
    } catch (err) {
      this.render();
      return;
    }

    const fresh = Array.from(scratch.children);
    if (fresh[0] && fresh[0].classList.contains('dr-detail-bar')) fresh.shift();
    while (bar.nextSibling) bar.nextSibling.remove();
    fresh.forEach((el) => root.appendChild(el));
  }

  renderSearchField(bar) {
    this.renderFilterButton(bar);

    const search = bar.createDiv({ cls: 'dr-browse-search' });
    setIcon(search.createSpan({ cls: 'dr-browse-search-icon' }), 'search');

    const input = search.createEl('input', { type: 'text' });
    input.placeholder =
      this.mode === 'search' ? 'Search' : `Find in ${this.getDisplayText()}`;
    input.value = this.query;

    // Enter finishes a search. Leaving the field doesn't: it used to,
    // and every redraw counted as leaving it.
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !composing(evt)) this.rememberSearch();
      // Escape clears what's typed; with nothing typed, it leaves the field.
      if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        if (input.value) {
          input.value = '';
          this.query = '';
          window.clearTimeout(this.findTimer);
          this.renderBelowBar();
        } else {
          input.blur();
        }
      }
    });

    // Only what's below the bar is redrawn, so the field being typed in
    // is never replaced — which kept the caret and focus without having
    // to put them back, and stopped each keystroke looking like a blur.
    // A short pause first, so a long list isn't rebuilt per letter.
    input.addEventListener('input', () => {
      this.query = input.value;
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.renderBelowBar(), 90);
    });
  }

  action(parentEl, icon, label, onClick) {
    const btn = parentEl.createDiv({ cls: 'dr-detail-action' });
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    setIcon(btn.createSpan({ cls: 'dr-detail-action-icon' }), icon);
    btn.createSpan({ text: label });
    onActivate(btn, onClick);
    return btn;
  }

  /* -- editing an album -------------------------------------------- */

  /**
   * What a cover is made from, while generated covers are on: the name,
   * and the colour chosen for the path, if any.
   */
  genName(name, path) {
    return coverGen(this.plugin.settings, name, path);
  }

  setEditing(on) {
    this.editing = !!on;
    this.render();
    if (!on) return;
    const first = this.contentEl.querySelector('.dr-detail-title.dr-edit-name, .dr-track .dr-edit-name');
    if (first && !Platform.isMobile) first.focus();
  }

  /**
   * A field that changes a name: Enter or leaving it saves, Escape puts
   * it back. Only a real change is saved.
   */
  editField(input, original, commit) {
    let settled = false;
    const finish = (keep) => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      if (!keep || !value || value === original) {
        input.value = original;
        return;
      }
      commit(value);
    };
    input.addEventListener('focus', () => {
      settled = false;
    });
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter') {
        evt.preventDefault();
        finish(true);
        input.blur();
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      finish(true);
      // Anything that changed while this was being typed in is drawn now.
      if (this.renderAfterEdit) {
        this.renderAfterEdit = false;
        this.queueRender();
      }
    });
  }

  /**
   * Rename a note or folder where it is. Links to it are rewritten, as
   * Obsidian's own rename does, and a name that's taken or can't be a
   * file name is refused with the reason.
   */
  async renameEntry(entry, name) {
    if (/[\\/:*?"<>|#^[\]]/.test(name)) {
      new Notice('A name can’t contain \\ / : * ? " < > | # ^ [ or ].');
      this.render();
      return false;
    }
    const dir = entry.parent && entry.parent.path !== '/' ? entry.parent.path + '/' : '';
    const target = normalizePath(dir + (entry instanceof TFile ? `${name}.${entry.extension}` : name));
    if (target === entry.path) return false;
    const taken = this.app.vault.getAbstractFileByPath(target);
    if (taken && taken !== entry) {
      new Notice(`There’s already something called “${name}” here.`);
      this.render();
      return false;
    }
    try {
      await this.app.fileManager.renameFile(entry, target);
      return true;
    } catch (err) {
      console.error('Design Redux: could not rename', err);
      new Notice(`Could not rename “${entry.name}”.`);
      this.render();
      return false;
    }
  }

  /** Delete the way Obsidian does: its confirmation, and its trash setting. */
  async deleteEntry(entry) {
    const fm = this.app.fileManager;
    try {
      const confirmed = typeof fm.promptForDeletion === 'function' ? await fm.promptForDeletion(entry) : true;
      if (!confirmed) return false;
      // The prompt may have deleted it already; if not, it goes to the trash.
      if (this.app.vault.getAbstractFileByPath(entry.path) === entry) await fm.trashFile(entry);
      return true;
    } catch (err) {
      console.error('Design Redux: could not delete', err);
      new Notice(`Could not delete “${entry.name}”.`);
      return false;
    }
  }

  /** A row being edited: a handle to drag, the name to change, move and delete. */
  editRow(list, file, index) {
    const row = list.createDiv({ cls: 'dr-track is-editing' });
    row.dataset.path = file.path;
    if (file.parent) row.dataset.folder = file.parent.path;

    const grip = row.createDiv({ cls: 'dr-edit-grip' });
    setIcon(grip, 'grip-vertical');
    grip.setAttribute('role', 'button');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-label', `Move “${file.basename}” — drag, or Alt+↑ and Alt+↓`);

    row.createDiv({ cls: 'dr-track-num', text: String(index) });
    const name = row.createEl('input', { cls: 'dr-track-name dr-edit-name', type: 'text' });
    name.value = file.basename;
    name.dataset.editPath = file.path;
    name.setAttribute('aria-label', 'Note name');
    this.editField(name, file.basename, (value) => this.renameEntry(file, value));

    const tools = row.createDiv({ cls: 'dr-edit-tools' });
    const tool = (icon, label, run, cls) => {
      const el = tools.createDiv({ cls: `clickable-icon dr-edit-tool ${cls || ''}`.trim() });
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      onActivate(el, run);
    };
    tool('folder-input', 'Move to another folder', () =>
      new FolderPicker(this.app, (folder) => this.plugin.moveFile(file, folder.path)).open()
    );
    tool('trash-2', 'Delete', () => this.deleteEntry(file), 'mod-warning');

    this.dragRow(row, grip, file);
  }

  /** A subfolder's heading while editing: its name, and a way to delete it. */
  editDiscHead(head, disc, album) {
    head.addClass('is-editing');
    const grip = head.createDiv({ cls: 'dr-edit-grip' });
    setIcon(grip, 'grip-vertical');
    grip.setAttribute('role', 'button');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-label', `Move the folder “${disc.folder.name}” — drag it onto another`);
    this.dragDisc(head, grip, disc.folder, album);
    const name = head.createEl('input', { cls: 'dr-disc-title dr-edit-name', type: 'text' });
    name.value = disc.folder.name;
    name.dataset.editPath = disc.folder.path;
    name.setAttribute('aria-label', 'Folder name');
    this.editField(name, disc.folder.name, (value) => this.renameEntry(disc.folder, value));
    head.createSpan({
      cls: 'dr-disc-count',
      text: disc.files.length === 1 ? '1 note' : `${disc.files.length} notes`,
    });
    const move = head.createDiv({ cls: 'clickable-icon dr-edit-tool' });
    move.setAttribute('role', 'button');
    move.setAttribute('tabindex', '0');
    move.setAttribute('aria-label', `Move the folder “${disc.folder.name}” into another`);
    setIcon(move, 'folder-input');
    onActivate(move, () => this.pickFolderHome(disc.folder));
    const del = head.createDiv({ cls: 'clickable-icon dr-edit-tool mod-warning' });
    del.setAttribute('role', 'button');
    del.setAttribute('tabindex', '0');
    del.setAttribute('aria-label', `Delete the folder “${disc.folder.name}”`);
    setIcon(del, 'trash-2');
    onActivate(del, () => this.deleteEntry(disc.folder));
  }

  /** Somewhere else for a folder: any folder but itself and those inside it. */
  pickFolderHome(folder) {
    const inside = (f) => f === folder || f.path.startsWith(folder.path + '/');
    new FolderPicker(
      this.app,
      (target) => this.moveFolderInto(folder, target.path),
      { withRoot: true, skip: inside, placeholder: `Move “${folder.name}” into…` }
    ).open();
  }

  async moveFolderInto(folder, targetPath) {
    const name = folder.name;
    if (await this.plugin.moveFile(folder, targetPath)) {
      const where = targetPath === '/' ? this.app.vault.getName() : targetPath.split('/').pop();
      new Notice(`Moved “${name}” into ${where}.`);
      return true;
    }
    return false;
  }

  /**
   * Drag a subfolder's heading onto another disc's to put it inside that
   * folder — or onto the album's own heading to bring it back to the
   * top. The heading under the pointer lights up; Escape calls it off.
   */
  dragDisc(head, grip, folder, album) {
    grip.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      down.preventDefault();
      const list = head.parentElement;
      const startX = down.clientX;
      const startY = down.clientY;
      let dragging = false;
      let target = null;

      // Somewhere it can go: not itself, not inside itself, not where it is.
      const allowed = (path) => {
        if (!path || path === folder.path || path.startsWith(folder.path + '/')) return false;
        return path !== (folder.parent ? folder.parent.path : '/');
      };
      const mark = (el) => {
        if (target === el) return;
        if (target) target.removeClass('is-drop-target');
        target = el;
        if (target) target.addClass('is-drop-target');
      };
      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4 && Math.abs(evt.clientX - startX) < 4) return;
          dragging = true;
          head.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        const doc = head.ownerDocument;
        const under = doc.elementFromPoint ? doc.elementFromPoint(evt.clientX, evt.clientY) : null;
        const over = under && typeof under.closest === 'function' ? under.closest('.dr-disc[data-folder]') : null;
        mark(over && list.contains(over) && allowed(over.dataset.folder) ? over : null);
      };
      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        const chosen = target;
        mark(null);
        head.removeClass('is-dragging');
        list.removeClass('is-sorting');
        if (keep && dragging && chosen) this.moveFolderInto(folder, chosen.dataset.folder);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /** A note made in the album, named where it's listed rather than opened. */
  async editNewNote(folder) {
    try {
      const file = await this.app.vault.create(this.plugin.freeChildPath(folder, 'Untitled', 'md'), '');
      this.render();
      const input = this.contentEl.querySelector(`.dr-edit-name[data-edit-path="${CSS.escape(file.path)}"]`);
      if (input) {
        input.focus();
        input.select();
      }
      return file;
    } catch (err) {
      console.error('Design Redux: could not create the note', err);
      new Notice('Could not create the note.');
      return null;
    }
  }

  /** A subfolder — a new disc — named first, and shown even while empty. */
  editNewFolder(parent) {
    new NamePrompt(this.app, 'New folder', 'Folder name', async (name) => {
      const clean = name.replace(/[\\/:]/g, '').trim();
      if (!clean) return;
      const dir = !parent || parent.path === '/' ? '' : parent.path + '/';
      const path = normalizePath(dir + clean);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(`“${clean}” already exists here.`);
        return;
      }
      try {
        await this.app.vault.createFolder(path);
        this.render();
      } catch (err) {
        console.error('Design Redux: could not create the folder', err);
        new Notice('Could not create the folder.');
      }
    }).open();
  }

  /**
   * Put a note before or after another in its album, and keep that
   * order. The album switches to it, as a playlist keeps the order you
   * drag its songs into.
   */
  arrangeTrack(path, targetPath, after) {
    const file = this.app.vault.getFileByPath(path);
    const target = this.app.vault.getFileByPath(targetPath);
    if (!file || !target || !file.parent || file.parent !== target.parent) return false;
    const names = this.allNotesIn(file.parent).map((f) => f.name);
    const rest = names.filter((n) => n !== file.name);
    const at = rest.indexOf(target.name);
    const before = after ? rest[at + 1] : target.name;
    this.plugin.orders.setAlbum(file.parent, moveBefore(names, file.name, before === undefined ? null : before));
    this.plugin.refreshBrowse();
    return true;
  }

  /** Save the order a disc's rows are in now. */
  saveRowOrder(list, folderPath) {
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) return;
    const rows = Array.from(list.querySelectorAll('.dr-track[data-path]')).filter(
      (r) => r.dataset.folder === folderPath
    );
    const shown = rows.map((r) => r.dataset.path.split('/').pop());
    // Notes not drawn (there are none while editing, but to be sure) keep their place after.
    const others = this.allNotesIn(folder).map((f) => f.name).filter((n) => shown.indexOf(n) === -1);
    this.plugin.orders.setAlbum(folder, shown.concat(others));
    this.plugin.refreshBrowse();
  }

  /**
   * Drag a row by its handle, to anywhere in the album: among its own
   * disc's rows to put it in order, or into another disc to move the
   * note into that folder, at that place. Pointer events, so a finger
   * works as well as a mouse; nothing happens until it has moved a
   * little, and Escape puts the row back. Alt+arrows move it one place
   * from the keyboard, over the edge of a disc into the next.
   */
  dragRow(row, grip, file) {
    const home = row.dataset.folder;
    // Rows and disc headings, top to bottom; a row belongs to the
    // heading above it.
    const items = (list) => Array.from(list.querySelectorAll('.dr-track[data-path], .dr-disc[data-folder]'));
    const discAbove = (el) => {
      let at = el.previousElementSibling;
      while (at && !(at.matches('.dr-disc[data-folder]'))) at = at.previousElementSibling;
      return at;
    };

    grip.addEventListener('keydown', (evt) => {
      if (!evt.altKey || (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown')) return;
      evt.preventDefault();
      const list = row.parentElement;
      const all = items(list);
      const at = all.indexOf(row);
      const up = evt.key === 'ArrowUp';
      const next = all[at + (up ? -1 : 1)];
      if (!next) return;
      if (up) {
        // Over the album's first heading there's nowhere to go.
        if (next.matches('.dr-disc') && all.indexOf(next) === 0) return;
        list.insertBefore(row, next);
      } else {
        list.insertBefore(row, next.nextSibling);
      }
      this.commitRow(list, row, file, home, discAbove(row));
    });

    grip.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      down.preventDefault();
      const list = row.parentElement;
      const startY = down.clientY;
      const before = Array.from(list.children);
      let dragging = false;

      const place = (y) => {
        const others = items(list).filter((el) => el !== row);
        if (!others.length) return;
        const next = others.find((el) => {
          const box = el.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        // Never above the first heading: a row needs a disc to be in.
        if (next === others[0]) {
          if (others[1] !== undefined && row.nextElementSibling !== others[1]) list.insertBefore(row, others[1]);
          else if (others[1] === undefined) list.appendChild(row);
        } else if (next) {
          if (row.nextElementSibling !== next) list.insertBefore(row, next);
        } else if (list.lastElementChild !== row) {
          list.appendChild(row);
        }
        const disc = discAbove(row);
        list.querySelectorAll('.dr-disc.is-drop-target').forEach((el) => el !== disc && el.removeClass('is-drop-target'));
        if (disc && disc.dataset.folder !== home) disc.addClass('is-drop-target');
      };
      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4) return;
          dragging = true;
          row.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        place(evt.clientY);
      };
      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        if (!dragging) return;
        row.removeClass('is-dragging');
        list.removeClass('is-sorting');
        list.querySelectorAll('.dr-disc.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
        if (!keep) {
          before.forEach((el) => list.appendChild(el));
          return;
        }
        this.commitRow(list, row, file, home, discAbove(row));
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /**
   * Where a moved row landed, kept: the order of its disc, and — if
   * that's another disc — the note moved into that folder first.
   */
  async commitRow(list, row, file, home, disc) {
    const folder = disc ? disc.dataset.folder : home;
    if (folder !== home) {
      const name = file.basename;
      if (!(await this.plugin.moveFile(file, folder))) {
        this.render();
        return;
      }
      row.dataset.folder = folder;
      row.dataset.path = file.path;
      new Notice(`Moved “${name}” to ${folder === '/' ? this.app.vault.getName() : folder.split('/').pop()}.`);
    }
    this.saveRowOrder(list, folder);
    const again = this.contentEl.querySelector(`.dr-track[data-path="${CSS.escape(file.path)}"] .dr-edit-grip`);
    if (again) again.focus();
  }

  /* -- pins in your own order ---------------------------------------- */

  /** Pinned, in the order kept for it, as the screen lists them. */
  pinnedInOrder() {
    return this.plugin.pins.all();
  }

  /** Move a pin one place, or to before another. */
  arrangePin(path, before) {
    const paths = this.pinnedInOrder().map((t) => t.path);
    this.plugin.orders.setPins(moveBefore(paths, path, before));
    const settings = this.plugin.settings;
    settings.keepOwnOrder = Object.assign({}, settings.keepOwnOrder, { pinned: true });
    this.plugin.saveData(settings);
    this.plugin.refreshBrowse();
    const library = this.plugin.feature(Library);
    if (library) library.refreshViews();
  }

  /** Earlier and later for one pin, where it isn't already at that end. */
  pinSteps(target) {
    if (this.mode !== 'pinned' || !this.keepsOwnOrder() || !this.canArrange()) return null;
    const paths = this.pinnedInOrder().map((t) => t.path);
    const at = paths.indexOf(target.path);
    if (at === -1) return null;
    return {
      earlier: at > 0 ? () => this.arrangePin(target.path, paths[at - 1]) : null,
      later: at < paths.length - 1 ? () => this.arrangePin(target.path, paths[at + 2] === undefined ? null : paths[at + 2]) : null,
    };
  }

  /** Tiles on the Pinned screen can be dragged into order, on desktop. */
  arrangeableTiles(grid) {
    if (Platform.isMobile || this.mode !== 'pinned') return;
    let dragged = null;
    grid.querySelectorAll('.dr-card[data-path]').forEach((card) => {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (evt) => {
        dragged = card.dataset.path;
        evt.dataTransfer.setData('text/dr-pin', dragged);
        evt.dataTransfer.effectAllowed = 'move';
        card.addClass('is-dragging');
      });
      card.addEventListener('dragend', () => {
        dragged = null;
        card.removeClass('is-dragging');
      });
    });
    const clear = () =>
      grid.querySelectorAll('.is-drop-before, .is-drop-after').forEach((el) => el.removeClass('is-drop-before', 'is-drop-after'));
    const over = (evt) => {
      const card = evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('.dr-card[data-path]') : null;
      if (!card || !dragged || card.dataset.path === dragged) return null;
      const box = card.getBoundingClientRect();
      return { card, after: evt.clientX > box.left + box.width / 2 };
    };
    grid.addEventListener('dragover', (evt) => {
      const at = over(evt);
      clear();
      if (!at || !this.canArrange()) return;
      evt.preventDefault();
      at.card.addClass(at.after ? 'is-drop-after' : 'is-drop-before');
    });
    grid.addEventListener('drop', (evt) => {
      const at = over(evt);
      clear();
      if (!at || !this.canArrange()) return;
      evt.preventDefault();
      const paths = this.pinnedInOrder().map((t) => t.path).filter((p) => p !== dragged);
      const i = paths.indexOf(at.card.dataset.path);
      const before = at.after ? paths[i + 1] : paths[i];
      this.arrangePin(dragged, before === undefined ? null : before);
    });
    // Alt+left and right move the focused tile, from the keyboard.
    grid.addEventListener('keydown', (evt) => {
      if (!evt.altKey || (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight')) return;
      const card = evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('.dr-card[data-path]') : null;
      if (!card) return;
      const target = this.app.vault.getAbstractFileByPath(card.dataset.path);
      const steps = target && this.pinSteps(target);
      const step = steps && (evt.key === 'ArrowLeft' ? steps.earlier : steps.later);
      if (!step) return;
      evt.preventDefault();
      step();
      const again = this.contentEl.querySelector(`.dr-card[data-path="${CSS.escape(card.dataset.path)}"]`);
      if (again) again.focus();
    });
  }

  /* -- keys and scroll ----------------------------------------------- */

  /** "/" jumps to Find, as on the web; Escape leaves editing. */
  onKey(evt) {
    const target = evt.target;
    const typing = target && typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"]');
    if (evt.key === '/' && !evt.metaKey && !evt.ctrlKey && !evt.altKey && !typing) {
      if (this.focusFind()) evt.preventDefault();
      return;
    }
    if (evt.key === 'Escape' && this.editing && !typing) {
      evt.preventDefault();
      this.setEditing(false);
    }
  }

  focusFind() {
    const input = this.contentEl && this.contentEl.querySelector('.dr-browse-search input');
    if (!input) return false;
    input.focus();
    if (typeof input.select === 'function') input.select();
    return true;
  }

  /** Where the page was scrolled to, kept with each step in the history. */
  getEphemeralState() {
    const base = typeof super.getEphemeralState === 'function' ? super.getEphemeralState() : {};
    return Object.assign({}, base, { scroll: this.contentEl ? this.contentEl.scrollTop : 0 });
  }

  /** Back and forward return to where the page was. */
  setEphemeralState(state) {
    if (typeof super.setEphemeralState === 'function') super.setEphemeralState(state);
    const y = state && typeof state.scroll === 'number' ? state.scroll : null;
    if (y === null || !this.contentEl) return;
    this.contentEl.scrollTop = y;
    // Covers load after the page is drawn, so it may not be tall enough yet.
    window.setTimeout(() => {
      if (this.contentEl && this.contentEl.scrollTop < y) this.contentEl.scrollTop = y;
    }, 150);
  }

  /* -- the list --------------------------------------------------- */

  trackRow(list, file, index) {
    const row = list.createDiv({ cls: 'dr-track' });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    // Which disc the row belongs to, so a drop knows what it's over.
    if (file.parent) row.dataset.folder = file.parent.path;
    row.dataset.path = file.path;
    // Not on touch: iOS starts a drag from a long press on anything
    // draggable, which is the gesture the row's menu needs. Moving a
    // note is in that menu instead, as Obsidian's "Move file to…".
    if (!Platform.isMobile) {
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', (evt) => {
        evt.dataTransfer.setData('text/dr-file', file.path);
        evt.dataTransfer.effectAllowed = 'move';
        row.addClass('is-dragging');
        // Types, not data, can be read while dragging, so which note and
        // disc are kept here for the rows to compare against.
        this.dragging = { path: file.path, folder: file.parent ? file.parent.path : '/' };
      });
      row.addEventListener('dragend', () => {
        row.removeClass('is-dragging');
        this.dragging = null;
      });
    }

    row.createDiv({ cls: 'dr-track-num', text: String(index) });
    row.createDiv({ cls: 'dr-track-name', text: file.basename });

    this.albumColumns().forEach((key) =>
      row.createDiv({
        cls: this.isTimeColumn(key) ? 'dr-track-time' : 'dr-track-sub',
        text: this.columnValue(file, key),
      })
    );

    const more = row.createDiv({ cls: 'clickable-icon dr-track-more' });
    more.setAttribute('aria-label', 'More');
    setIcon(more, 'ellipsis');

    more.addEventListener('click', (evt) => this.fileMenu(evt, file));
    onContextMenu(row, (evt) => this.fileMenu(evt, file));
    onActivate(row, (evt) => this.openFile(file, evt), false);
  }

  /**
   * What each album row shows after the title, from settings. Property
   * names, plus three that aren't properties: modified, created and
   * folder.
   */
  albumColumns() {
    return (this.plugin.settings.albumColumns || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  isTimeColumn(key) {
    return key === 'modified' || key === 'created';
  }

  columnValue(file, key) {
    if (key === 'modified') return this.relative(file.stat.mtime);
    if (key === 'created') return this.relative(file.stat.ctime);
    if (key === 'folder') return file.parent ? file.parent.name : '';
    if (file.extension !== 'md') return '';
    return this.valueOf(file, key);
  }

  /** Short, in the spirit of a track length: a glance, not a date. */
  relative(mtime) {
    const day = 86400000;
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (mtime >= midnight) return 'Today';
    if (mtime >= midnight - day) return 'Yesterday';
    const days = Math.floor((midnight - mtime) / day) + 1;
    if (days < 7) return `${days} days ago`;
    if (days < 30) {
      const weeks = Math.round(days / 7);
      return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    }
    return new Date(mtime).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /** A note's property values, flattened for matching against. */
  propertyText(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    return Object.keys(fm)
      .filter((k) => k !== 'position')
      .map((k) => {
        const v = fm[k];
        return Array.isArray(v) ? v.join(' ') : String(v === null ? '' : v);
      })
      .join(' ')
      .toLowerCase();
  }

  matches(name) {
    const q = this.query.trim().toLowerCase();
    return !q || name.toLowerCase().includes(q);
  }

  /* -- cards ------------------------------------------------------ */

  folderCard(grid, folder, subtitle) {
    const card = this.card(grid, folder.name, subtitle || this.countLabel(folder));
    card.dataset.path = folder.path;
    const src = this.folderCover(folder);
    this.fillArt(card.querySelector('.dr-card-art'), src, 'folder', this.genName(folder.name, folder.path));

    onActivate(card, () => this.openFolder(folder));
    onContextMenu(card, (evt) => this.folderMenu(evt, folder, src));
  }

  /** A single file as a tile: its cover, or an icon for its type. */
  fileCard(grid, file) {
    const card = this.card(
      grid,
      file.basename,
      file.parent && file.parent.path !== '/' ? file.parent.name : ''
    );
    card.dataset.path = file.path;
    const src = file.extension === 'md' ? this.coverFor(file) : null;
    this.fillArt(
      card.querySelector('.dr-card-art'),
      src,
      iconForFile(file),
      file.extension === 'md' ? this.genName(file.basename, file.path) : null
    );

    onActivate(card, (evt) => this.openFile(file, evt));
    onContextMenu(card, (evt) => this.fileMenu(evt, file));
  }

  card(grid, title, subtitle) {
    const card = grid.createDiv({ cls: 'dr-card' });
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.createDiv({ cls: 'dr-card-art' });
    card.createDiv({ cls: 'dr-card-title', text: title });
    if (subtitle) card.createDiv({ cls: 'dr-card-sub', text: subtitle });

    return card;
  }

  countLabel(folder) {
    const n = countFilesIn(folder);
    return n === 1 ? '1 item' : `${n} items`;
  }

  /** The line under a note's name in a list. */
  subtitleFor(file) {
    if (file.extension !== 'md') return file.extension.toUpperCase();
    return leadProperty(this.app, file, false);
  }

  folderCover(folder) {
    return this.plugin.folderCoverSrc(folder);
  }

  coverFor(file) {
    return resolveCover(this.app, file, this.plugin.settings.coverProperty);
  }
}

/* ------------------------------------------------------------------ */
/* Choosing what goes in the list                                      */
/* ------------------------------------------------------------------ */

class LibraryItemPicker extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChooseItem_ = onChoose;
    this.setPlaceholder('Add a destination, folder, base or note');
  }

  getItems() {
    const items = Object.keys(LIBRARY_BUILTINS).map((id) => ({
      kind: 'builtin',
      id: id,
      text: LIBRARY_BUILTINS[id].label,
    }));

    const walk = (folder) => {
      (folder.children || []).forEach((child) => {
        if (child instanceof TFolder) {
          items.push({ kind: 'folder', path: child.path, text: child.path + '/' });
          walk(child);
        }
      });
    };
    walk(this.app.vault.getRoot());

    this.app.vault.getFiles().forEach((f) => {
      if (f.extension !== 'base' && f.extension !== 'canvas' && f.extension !== 'md') return;
      items.push({ kind: 'file', path: f.path, text: f.path });
    });

    // A property, opening the Properties screen at its values.
    knownPropertyNames(this.app).forEach((name) =>
      items.push({ kind: 'property', key: name.toLowerCase(), text: `By ${name}` })
    );

    return items;
  }

  getItemText(item) {
    return item.text;
  }

  onChooseItem(item) {
    this.onChooseItem_(item);
  }
}

class Library extends Feature {
  settingsSchema() {
    return [
      {
        key: 'library',
        name: 'Library view',
        desc: 'A sidebar of the places you choose, under headings of your own. Folders open from it as albums.',
      },
      {
        key: 'singleArea',
        desktopOnly: true,
        name: 'Single content area',
        desc: 'Hide the tab bar, so the main area is one page you move through with back and forward. Tabs and splits still work behind it.',
        showIf: 'library',
      },
      {
        key: 'hideEmptyFolders',
        name: 'Hide empty folders',
        desc: 'Leave out folders with no notes in them or in their subfolders.',
        showIf: 'library',
      },
      {
        key: 'categoryProperty',
        type: 'text',
        name: 'Search categories',
        desc: 'The property whose values become categories on the Search screen. Leave it empty for none.',
        placeholder: 'domain',
        fallback: '',
        showIf: 'library',
        suggest: 'property',
      },
      {
        key: 'tableColumns',
        type: 'text',
        name: 'Notes table columns',
        desc: 'The properties shown as columns on the Notes screen, separated by commas.',
        placeholder: 'domain, status',
        fallback: 'domain, status',
        showIf: 'library',
        suggest: 'properties',
      },
      {
        key: 'defaultSort',
        type: 'dropdown',
        showIf: 'library',
        name: 'Order',
        desc: 'How every screen orders its lists. A screen\'s filter button changes this too; an album you\'ve arranged keeps its own order.',
        options: Object.fromEntries(SORTS),
      },
      {
        key: 'albumColumns',
        type: 'text',
        showIf: 'library',
        name: 'Album columns',
        desc: 'What each note\'s row in an album shows after its title: properties, or modified, created or folder. Separate them with commas.',
        placeholder: 'domain, modified',
        fallback: 'domain, modified',
        suggest: 'properties',
        suggestExtra: ['modified', 'created', 'folder'],
      },
      {
        key: 'discNoteLimit',
        type: 'number',
        name: 'Notes per disc',
        desc: 'How many notes a disc in an album lists before Show all.',
        showIf: 'library',
      },
      {
        key: 'albumNoteLimit',
        type: 'number',
        name: 'Notes per property value',
        desc: 'How many notes each value lists on the Properties screen before Show all.',
        showIf: 'library',
      },
      {
        key: 'homePath',
        type: 'text',
        name: 'Home note',
        desc: 'The note Home opens.',
        placeholder: 'Home.md',
        fallback: 'Home.md',
        showIf: 'library',
        suggest: 'file',
      },
      {
        key: 'librarySections',
        type: 'custom',
        name: 'Library layout',
        showIf: 'library',
        render: (containerEl, tab) => this.editor().render(containerEl, tab),
      },
    ];
  }

  editor() {
    return new LibraryEditor(this);
  }

  /**
   * A starting layout, derived once from the vault. Doing this rather
   * than shipping fixed defaults means the first view already reflects
   * how the vault is actually arranged.
   */
  defaultSections() {
    const folders = (this.app.vault.getRoot().children || [])
      .filter((c) => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ kind: 'folder', path: f.path }));

    // Anywhere in the vault: bases are commonly kept in a folder of
    // their own, which the root-only scan missed.
    const bases = this.app.vault
      .getFiles()
      .filter((f) => f.extension === 'base')
      .sort((a, b) => a.basename.localeCompare(b.basename))
      .map((f) => ({ kind: 'file', path: f.path }));

    // Shaped after the app this borrows from: a few destinations, then
    // the ways into the whole vault, then the saved views.
    const library = [
      { kind: 'builtin', id: 'bookmarks' },
      { kind: 'builtin', id: 'recents' },
      { kind: 'builtin', id: 'properties' },
      { kind: 'builtin', id: 'folders' },
      { kind: 'builtin', id: 'notes' },
    ];

    const sections = [
      {
        title: '',
        items: [
          { kind: 'builtin', id: 'search' },
          { kind: 'builtin', id: 'home' },
          { kind: 'builtin', id: 'graph' },
        ],
      },
      { title: 'Library', items: library },
    ];
    if (folders.length) sections.push({ title: 'Folders', items: folders });
    if (bases.length) sections.push({ title: 'Bases', items: bases });
    return sections;
  }

  refreshViews() {
    liveViews(this.app, LIBRARY_VIEW, LibraryView).forEach((v) => v.render());
  }

  commands() {
    return [
      {
        id: 'open-library',
        name: 'Open library',
        check: () => this.enabled,
        run: () => this.reveal(),
      },
      // The page's history, so these work from anywhere — including
      // the sidebar, where Obsidian's own navigate commands act on the
      // sidebar instead.
      {
        id: 'go-back',
        name: 'Go back',
        check: () => canStep(pageLeaf(this.app), 'back'),
        run: () => step(pageLeaf(this.app), 'back'),
      },
      {
        id: 'go-forward',
        name: 'Go forward',
        check: () => canStep(pageLeaf(this.app), 'forward'),
        run: () => step(pageLeaf(this.app), 'forward'),
      },
      {
        id: 'new-note-here',
        name: 'New note in the current folder',
        check: () => !!pageFolder(this.app),
        run: () => this.plugin.newNote(pageFolder(this.app)),
      },
      {
        id: 'new-folder-here',
        name: 'New folder in the current folder',
        check: () => !!pageFolder(this.app),
        run: () => this.plugin.newFolder(pageFolder(this.app)),
      },
      {
        id: 'browse-vault',
        name: 'Browse vault as a grid',
        check: () => this.enabled,
        run: () => this.browseRoot(),
      },
    ];
  }

  /**
   * View types are registered at load, not here: Obsidian rebuilds the
   * saved workspace before layout-ready, and a leaf whose type isn't
   * registered yet can't be restored — leaving a stray tab behind and
   * a second one when the view is opened again.
   */
  registerTypes() {
    this.plugin.registerView(
      LIBRARY_VIEW,
      (leaf) => new LibraryView(leaf, this.plugin)
    );
    this.plugin.registerView(
      BROWSE_VIEW,
      (leaf) => new BrowseView(leaf, this.plugin)
    );
  }

  register() {
    // The panel shape is set on Obsidian's own sidebar element, so it's
    // taken off again however the plugin goes away.
    this.plugin.register(() => clearSidebarChrome());

    // Opening and closing the sidebar fires neither a file nor a leaf
    // change; it does resize the workspace.
    const follow = () => this.followSidebar();
    this.plugin.registerEvent(this.app.workspace.on('resize', follow));
    this.plugin.registerEvent(this.app.workspace.on('layout-change', follow));
    this.wasCollapsed = this.leftCollapsed();
    this.followSidebar();

    if (!this.settings.librarySections.length) {
      this.settings.librarySections = this.defaultSections();
      this.plugin.saveData(this.settings);
    }

    // Entries are stored by path, so a rename elsewhere would silently
    // drop them from the list. Follow the move instead.
    this.plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => this.repath(file, oldPath))
    );
  }

  /**
   * Rewrite stored paths after a rename. A folder brings its contents
   * with it, so anything beneath the old path moves too.
   */
  async repath(file, oldPath) {
    const prefix = oldPath + '/';
    let changed = false;

    this.settings.librarySections.forEach((section) => {
      (section.items || []).forEach((item) => {
        if (!item.path) return;

        if (item.path === oldPath) {
          item.path = file.path;
          changed = true;
        } else if (item.path.startsWith(prefix)) {
          item.path = file.path + '/' + item.path.slice(prefix.length);
          changed = true;
        }
      });
    });

    // Checked separately: the home note can be renamed on its own.
    if (this.settings.homePath === oldPath) {
      this.settings.homePath = file.path;
      changed = true;
    }

    if (!changed) return;
    await this.plugin.saveData(this.settings);
    this.refreshViews();
  }

  /**
   * Opened when the feature is switched on, so it isn't hidden behind a
   * command. Not on every settings save, or a Library tab someone closed
   * would keep coming back; the first install is onUserEnable's.
   */
  enable() {
    document.body.toggleClass('dr-single-area', singleAreaOn(this.settings));
    const turnedOn = this.active === false;
    this.active = true;
    if (!turnedOn) return;
    if (this.app.workspace.getLeavesOfType(LIBRARY_VIEW).length) return;
    this.mount();
  }

  /** Docked without stealing focus, unlike reveal from the command. */
  async mount() {
    const leaf = this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: LIBRARY_VIEW });
  }

  /**
   * Open a browse screen in the main area.
   *
   * With one page, the page is wherever you are, so the screen goes
   * there and back returns to what you left. Otherwise an open browse
   * tab is reused rather than stacking more of them.
   */
  async browseMode(state) {
    const ws = this.app.workspace;
    const leaf = this.settings.onePage
      ? ws.getLeaf(false)
      : ws.getLeavesOfType(BROWSE_VIEW)[0] || ws.getLeaf(false);
    await leaf.setViewState({
      type: BROWSE_VIEW,
      active: true,
      state: Object.assign(
        { mode: 'folder', path: '/', property: null, value: null },
        state
      ),
    });
    ws.revealLeaf(leaf);
    liveViews(this.app, LIBRARY_VIEW, LibraryView).forEach((v) => v.markActive());
  }

  leftCollapsed() {
    const split = this.app.workspace.leftSplit;
    return !!(split && split.collapsed);
  }

  /**
   * Keep up with the left sidebar opening and closing: a body class the
   * "Show sidebar" buttons key off, and the panel shape re-checked. With
   * the sidebar's tabs hidden, reopening also brings the library back to
   * the front, since there'd be no way to switch to it otherwise.
   */
  followSidebar() {
    const collapsed = this.leftCollapsed();
    document.body.toggleClass('dr-left-collapsed', collapsed);
    if (this.wasCollapsed && !collapsed && this.enabled && singleAreaOn(this.settings)) {
      this.showLibraryTab();
    }
    this.wasCollapsed = collapsed;
    liveViews(this.app, LIBRARY_VIEW, LibraryView).forEach((v) => v.syncChrome());
  }

  showLibraryTab() {
    const ws = this.app.workspace;
    const leaf = ws
      .getLeavesOfType(LIBRARY_VIEW)
      .find((l) => l.getRoot() === ws.leftSplit);
    if (leaf) ws.revealLeaf(leaf);
  }

  async reveal() {
    const leaf = this.singleLeaf(LIBRARY_VIEW) || this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    if (!(leaf.view instanceof LibraryView)) {
      await leaf.setViewState({ type: LIBRARY_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * The one leaf of a type, closing any duplicates. A view type that
   * was registered too late in an earlier version could leave several
   * behind, and nothing else would ever clear them.
   */
  singleLeaf(type) {
    const leaves = this.app.workspace.getLeavesOfType(type);
    leaves.slice(1).forEach((extra) => extra.detach());
    return leaves[0] || null;
  }

  browseRoot() {
    return this.browseMode({ mode: 'folder', path: '/' });
  }

  disable() {
    this.active = false;
    document.body.removeClass('dr-single-area');

    // Only when the user switches the feature off. On unload Obsidian
    // reopens these views itself, at the position the user left them.
    if (this.plugin.unloading) return;
    this.app.workspace.getLeavesOfType(LIBRARY_VIEW).forEach((l) => l.detach());
    this.app.workspace.getLeavesOfType(BROWSE_VIEW).forEach((l) => l.detach());
  }
}

Library.settingKey = 'library';

/* ------------------------------------------------------------------ */
/* Actions menu: file explorer buttons, and optionally the ribbon's    */
/*                                                                     */
/* Nothing is relocated. The real buttons stay where Obsidian put      */
/* them, hidden by CSS, and each entry proxies a click to the live     */
/* button — re-queried every time, so rebuilds are irrelevant.         */
/* ------------------------------------------------------------------ */

class ActionsMenu extends Feature {
  constructor(plugin) {
    super(plugin);
    this.triggerEl = null;
  }

  settingsSchema() {
    return [
      {
        key: 'navDropdown',
        name: 'Actions menu',
        desc: 'Replace the file explorer\'s row of buttons with a menu in the sidebar header.',
      },
      {
        key: 'ribbonInMenu',
        showIf: 'navDropdown',
        name: 'Include the ribbon',
        desc: 'Put the left ribbon\'s buttons in that menu too, and hide the ribbon.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'open-actions',
        name: 'Open actions menu',
        check: () => this.enabled,
        run: () => {
          // The trigger lives in the left sidebar's tab header, so there
          // isn't one while that sidebar is collapsed.
          const trigger = document.querySelector('.dr-trigger');
          if (trigger) trigger.click();
          else new Notice('Open the left sidebar to reach the actions menu.');
        },
      },
    ];
  }

  enable() {
    document.body.addClass('dr-nav-active');
    document.body.toggleClass('dr-ribbon-active', !!this.settings.ribbonInMenu);
    this.sync();
  }

  disable() {
    document.body.removeClass('dr-nav-active');
    document.body.removeClass('dr-ribbon-active');
    unpark();
    if (this.triggerEl) {
      this.triggerEl.remove();
      this.triggerEl = null;
    }
  }

  sync() {
    const header = document.querySelector(TAB_HEADER);
    if (!header) return;
    if (this.triggerEl && this.triggerEl.isConnected) return;

    const trigger = makeTrigger('dr-trigger', 'Actions', 'ellipsis', (el) =>
      this.showMenu(el)
    );

    placeInHeader(header, trigger, this.settings.headerOrder.actions, () => {
      const newTab = header.querySelector('.workspace-tab-header-new-tab');
      if (newTab) newTab.insertAdjacentElement('afterend', trigger);
      else header.appendChild(trigger);
    });
    makeHeaderDraggable(trigger, 'actions', this.plugin);

    this.triggerEl = trigger;
    // The gear may have been saved as following this; it was placed
    // before this existed, so it goes back where it belongs.
    settleHeader(header, this.settings.headerOrder);
  }

  showMenu(trigger) {
    const rect = trigger.getBoundingClientRect();
    parkAt(rect);

    const menu = new Menu();
    let added = 0;

    const addFrom = (selector, buttonSelector) => {
      const root = document.querySelector(selector);
      if (!root) return 0;
      let n = 0;
      root.querySelectorAll(buttonSelector).forEach((btn) => {
        if (btn.style.display === 'none') return; // Obsidian hides some itself
        const label = btn.getAttribute('aria-label');
        if (!label) return;
        menu.addItem((item) => {
          item.setTitle(label);
          const icon = iconNameOf(btn);
          if (icon) item.setIcon(icon);
          item.onClick(() => btn.click());
        });
        n++;
      });
      return n;
    };

    added += addFrom(NAV_BUTTONS, '.nav-action-button');

    if (this.settings.ribbonInMenu) {
      // Counted first: a separator has to be added before the items it
      // precedes, and only when both sides actually contribute.
      const ribbon = document.querySelector(RIBBON_ACTIONS);
      const usable = ribbon
        ? Array.from(ribbon.querySelectorAll('.side-dock-ribbon-action')).filter(
            (b) => b.style.display !== 'none' && b.getAttribute('aria-label')
          ).length
        : 0;

      if (usable && added) menu.addSeparator();
      if (usable) added += addFrom(RIBBON_ACTIONS, '.side-dock-ribbon-action');
    }

    if (!added) {
      new Notice('No actions available.');
      return;
    }

    trigger.setAttribute('aria-expanded', 'true');
    menu.onHide(() => {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    });
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }
}

ActionsMenu.settingKey = 'navDropdown';
ActionsMenu.desktopOnly = true;

/* ------------------------------------------------------------------ */
/* Panel sections                                                      */
/*                                                                     */
/* Borrowing Obsidian's own elements gave exact behaviour but pulled   */
/* page-level styling with it, and each borrow is shared state the     */
/* note loses while the panel holds it. That doesn't stack.            */
/*                                                                     */
/* Sections own their markup instead. Where Obsidian exposes a         */
/* building block — the registered value widgets, the backlink cache — */
/* the section calls it, so behaviour stays native inside a layout     */
/* this plugin controls. Adding a section is one class.                */
/* ------------------------------------------------------------------ */

class PanelSection {
  constructor(panel) {
    this.panel = panel;
    this.plugin = panel.plugin;
    this.containerEl = null;
    this.file = null;
    // Suggestion lists live on <body>, outside the section, so they're
    // kept here to be taken away with it.
    this.suggests = [];
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /** Build into a section element the panel provides. */
  mount(parentEl, file) {
    this.file = file;
    this.containerEl = parentEl.createDiv({ cls: `dr-section ${this.cls}` });
    this.render();
  }

  /** Redraw in place, unless the user is mid-edit inside it. */
  refresh(file) {
    if (!this.containerEl || !this.containerEl.isConnected) return;
    if (file && this.file && file !== this.file) return;
    if (this.containerEl.contains(document.activeElement)) return;
    this.containerEl.empty();
    this.render();
  }

  render() {}

  destroy() {
    this.dropSuggests();
    if (this.containerEl) this.containerEl.remove();
    this.containerEl = null;
    this.file = null;
  }

  dropSuggests() {
    this.suggests.forEach((el) => el.remove());
    this.suggests = [];
  }
}

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/*                                                                     */
/* Rows are this plugin's markup. Each value cell is rendered by       */
/* Obsidian's own widget for that property's type, so date pickers,    */
/* link autocomplete, pill rendering and validation are the real       */
/* ones. Writes go through processFrontMatter, which is atomic.        */
/* ------------------------------------------------------------------ */

class PropertiesSection extends PanelSection {
  get cls() {
    return 'dr-properties';
  }

  get frontmatter() {
    const cache = this.app.metadataCache.getFileCache(this.file);
    return (cache && cache.frontmatter) || {};
  }

  render() {
    this.dropSuggests();
    const fm = this.frontmatter;
    const keys = Object.keys(fm).filter((k) => k !== 'position');

    const list = this.containerEl.createDiv({ cls: 'dr-rows' });
    if (!keys.length) {
      list.createDiv({ cls: 'dr-empty', text: 'No properties' });
    }
    keys.forEach((key) => this.renderRow(list, key, fm[key]));

    this.renderAdd(this.containerEl, keys);
  }

  renderRow(parentEl, key, value) {
    const type = this.typeOf(key);
    const row = parentEl.createDiv({ cls: 'dr-row' });
    row.setAttribute('data-property-type', type);
    row.dataset.key = key;

    const keyEl = row.createDiv({ cls: 'dr-key' });
    // The type icon is the row's handle, as in Obsidian's own block:
    // press and drag to move the property, click for its menu.
    const icon = keyEl.createSpan({ cls: 'dr-key-icon' });
    icon.setAttribute('aria-label', `${TYPE_LABELS[type] || type} — drag to move`);
    icon.setAttribute('role', 'button');
    icon.setAttribute('tabindex', '0');
    setIcon(icon, TYPE_ICONS[type] || 'text');
    icon.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (this.justMoved) return;
      this.showMenu(key, icon);
    });
    icon.addEventListener('keydown', (evt) => {
      if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
        evt.preventDefault();
        if (this.moveRow(row, evt.key === 'ArrowUp' ? -1 : 1)) icon.focus();
      } else if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        this.showMenu(key, icon);
      }
    });
    this.makeDraggable(parentEl, row, icon);

    const name = keyEl.createEl('input', { cls: 'dr-key-name', type: 'text' });
    name.value = key;
    name.setAttribute('aria-label', key);
    name.addEventListener('change', () => {
      const next = name.value.trim();
      if (!next || next === key) {
        name.value = key;
        return;
      }
      this.rename(key, next);
    });

    const valueEl = row.createDiv({ cls: 'dr-value' });
    if (!this.renderWidget(valueEl, key, value, type)) {
      this.renderFallback(valueEl, key, value);
    }
  }

  /** The properties in the order the rows now show them. */
  orderIn(list) {
    return Array.from(list.querySelectorAll(':scope > .dr-row')).map((r) => r.dataset.key);
  }

  /**
   * Drag a row by its handle. Nothing happens until the pointer has
   * moved a few pixels, so a press that doesn't move is still a click.
   * The row moves among the others as it's dragged, and the new order
   * is written when it's let go; Escape puts everything back. Pointer
   * events, not the browser's drag and drop, so it works the same with
   * a finger on a phone.
   */
  makeDraggable(list, row, handle) {
    handle.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      const startY = down.clientY;
      const before = this.orderIn(list);
      const scroller = this.panel && this.panel.popupEl;
      let dragging = false;

      const place = (y) => {
        const others = Array.from(list.querySelectorAll(':scope > .dr-row')).filter(
          (r) => r !== row
        );
        const next = others.find((r) => {
          const box = r.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        if (next) {
          if (row.nextElementSibling !== next) list.insertBefore(row, next);
        } else if (list.lastElementChild !== row) {
          list.appendChild(row);
        }
      };

      // Near the top or bottom of a long panel, it scrolls to follow.
      const follow = (y) => {
        if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return;
        const box = scroller.getBoundingClientRect();
        if (y < box.top + 28) scroller.scrollTop -= 10;
        else if (y > box.bottom - 28) scroller.scrollTop += 10;
      };

      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4) return;
          dragging = true;
          row.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        follow(evt.clientY);
        place(evt.clientY);
      };

      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        if (!dragging) return;
        row.removeClass('is-dragging');
        list.removeClass('is-sorting');
        // The click that ends a drag isn't a request for the menu.
        this.justMoved = true;
        window.setTimeout(() => (this.justMoved = false), 0);

        const after = this.orderIn(list);
        if (!keep) {
          before.forEach((k) => {
            const r = list.querySelector(`:scope > .dr-row[data-key="${CSS.escape(k)}"]`);
            if (r) list.appendChild(r);
          });
          return;
        }
        if (after.join('\n') !== before.join('\n')) this.reorder(after);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /** One place up or down, from the keyboard or the menu. */
  moveRow(row, delta) {
    const list = row.parentElement;
    if (!list) return false;
    const rows = Array.from(list.querySelectorAll(':scope > .dr-row'));
    const at = rows.indexOf(row);
    const to = at + delta;
    if (at === -1 || to < 0 || to >= rows.length) return false;
    list.insertBefore(row, delta < 0 ? rows[to] : rows[to].nextElementSibling);
    this.reorder(this.orderIn(list));
    return true;
  }

  /**
   * Obsidian's own editor for this type.
   *
   * registeredTypeWidgets holds the factories behind the native
   * property block; each exposes render(containerEl, value, ctx). The
   * context shape isn't documented, so every plausible field is passed
   * and the call is guarded.
   */
  renderWidget(parentEl, key, value, type) {
    try {
      const widgets = this.app.metadataTypeManager.registeredTypeWidgets;
      const widget = widgets && widgets[type];
      if (!widget || typeof widget.render !== 'function') return false;

      widget.render(parentEl, value, {
        app: this.app,
        key: key,
        sourcePath: this.file.path,
        blur: () => {},
        onChange: (v) => this.write(key, v, { redraw: false }),
        rendered: true,
        metadataEditor: {
          app: this.app,
          register: () => {},
          sourcePath: this.file.path,
        },
      });
      return parentEl.childElementCount > 0;
    } catch (err) {
      console.error('Design Redux: value widget failed', err);
      parentEl.empty();
      return false;
    }
  }

  /** Plain text, for when a widget isn't available. */
  renderFallback(parentEl, key, value) {
    const input = parentEl.createEl('input', { cls: 'dr-input', type: 'text' });
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', () => this.write(key, input.value, { redraw: false }));
  }

  renderAdd(parentEl, existing) {
    const add = parentEl.createDiv({ cls: 'dr-add' });
    const icon = add.createSpan({ cls: 'dr-add-icon' });
    setIcon(icon, 'plus');

    const field = add.createDiv({ cls: 'dr-field' });
    const input = field.createEl('input', { type: 'text' });
    input.placeholder = 'Add property';

    // A name the note already has goes to that property instead of
    // writing over it with an empty value.
    const commit = (name) => {
      const key = (name === undefined ? input.value : name).trim();
      if (!key) return;
      input.value = '';
      const have = Object.keys(this.frontmatter).find(
        (k) => k !== 'position' && k.toLowerCase() === key.toLowerCase()
      );
      if (have) {
        const row = this.containerEl.querySelector(`.dr-row[data-key="${CSS.escape(have)}"]`);
        const target = row && row.querySelector('.dr-value input, .dr-value [contenteditable], .dr-value textarea');
        if (target) target.focus();
        new Notice(`This note already has "${have}".`);
        return;
      }
      this.write(key, '', { onlyNew: true });
    };

    const have = existing.map((k) => k.toLowerCase());
    this.suggests.push(attachSuggest(field, input, {
      icon: 'tag',
      source: () =>
        this.knownProperties().filter(
          (n) => have.indexOf(n.toLowerCase()) === -1
        ),
      onSelect: (v) => commit(v),
    }));

    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt)) return;
      evt.preventDefault();
      commit();
    });
  }

  /** Property names already used in the vault, most common first. */
  knownProperties() {
    return knownPropertyNames(this.app);
  }

  typeOf(key) {
    try {
      const info = this.app.metadataTypeManager.getTypeInfo(key);
      const t =
        (info && info.expected && info.expected.type) ||
        (info && info.inferred && info.inferred.type);
      if (t && TYPE_ICONS[t]) return t;
    } catch (err) {
      /* fall through */
    }
    return 'text';
  }

  showMenu(key, anchorEl) {
    const menu = new Menu();
    const current = this.typeOf(key);

    Object.keys(TYPE_ICONS).forEach((type) => {
      menu.addItem((item) => {
        item.setTitle(TYPE_LABELS[type]);
        item.setIcon(TYPE_ICONS[type]);
        item.setChecked(type === current);
        item.onClick(() => {
          try {
            this.app.metadataTypeManager.setType(key, type);
            this.forceRefresh();
          } catch (err) {
            console.error('Design Redux: could not set the type', err);
          }
        });
      });
    });

    // For touch, where a drag is harder to aim, and for anyone who'd
    // rather not drag.
    const row = anchorEl.closest('.dr-row');
    const rows = row && row.parentElement
      ? Array.from(row.parentElement.querySelectorAll(':scope > .dr-row'))
      : [];
    const at = rows.indexOf(row);
    menu.addSeparator();
    [
      ['Move up', 'arrow-up', -1, at > 0],
      ['Move down', 'arrow-down', 1, at !== -1 && at < rows.length - 1],
    ].forEach(([title, icon, delta, possible]) => {
      menu.addItem((item) => {
        item.setTitle(title).setIcon(icon);
        if (typeof item.setDisabled === 'function') item.setDisabled(!possible);
        item.onClick(() => {
          if (possible) this.moveRow(row, delta);
        });
      });
    });

    menu.addSeparator();
    const bulk = this.plugin.feature ? this.plugin.feature(BulkEditing) : null;
    if (bulk) {
      menu.addItem((item) =>
        item
          .setTitle('Rename in every note…')
          .setIcon('pencil')
          .onClick(() => bulk.openRenameProperty(key))
      );
    }
    menu.addItem((item) =>
      item
        .setTitle('Remove property')
        .setIcon('trash-2')
        .onClick(() => this.write(key, undefined))
    );

    const r = anchorEl.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  /**
   * Single write path. undefined removes the key. `onlyNew` adds a
   * property only if the file doesn't have it — checked in the file
   * itself, since the cache can be a moment behind. A value edited in
   * its own field isn't redrawn: the field already shows it, and a
   * redraw would take the one being moved into.
   */
  async write(key, value, opts = {}) {
    const file = this.file;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (opts.onlyNew && Object.keys(fm).some((k) => k.toLowerCase() === key.toLowerCase())) return;
        if (value === undefined) delete fm[key];
        else fm[key] = value;
      });
      if (opts.redraw !== false) this.afterWrite(file);
    } catch (err) {
      console.error('Design Redux: frontmatter write failed', err);
      new Notice('Could not update the properties.');
    }
  }

  /**
   * Redraw once Obsidian has read the file back. processFrontMatter
   * resolves before the metadata cache catches up, so redrawing at
   * once showed the old values. Focus goes back where it was.
   */
  afterWrite(file) {
    if (this.file !== file) return;
    const cache = this.app.metadataCache;
    if (!cache || typeof cache.on !== 'function') return this.redraw();
    let done = false;
    let timer = 0;
    const ref = cache.on('changed', (changed) => {
      if (changed === file) finish();
    });
    const finish = () => {
      if (done) return;
      done = true;
      cache.offref(ref);
      window.clearTimeout(timer);
      if (this.file === file) this.redraw();
    };
    timer = window.setTimeout(finish, 1500);
  }

  /** forceRefresh, putting focus back on the same row's same field. */
  redraw() {
    if (!this.containerEl) return;
    const active = document.activeElement;
    const inside = active && this.containerEl.contains(active);
    const row = inside ? active.closest('.dr-row') : null;
    const key = row ? row.dataset.key : null;
    const part = !inside
      ? null
      : active.classList.contains('dr-key-name')
      ? '.dr-key-name'
      : active.classList.contains('dr-key-icon')
      ? '.dr-key-icon'
      : active.closest('.dr-add')
      ? '.dr-add input'
      : null;
    this.forceRefresh();
    if (!part) return;
    const again = key && part !== '.dr-add input'
      ? this.containerEl.querySelector(`.dr-row[data-key="${CSS.escape(key)}"] ${part}`)
      : this.containerEl.querySelector(part);
    if (again) again.focus();
  }

  /**
   * Rebuilt in place so ordering survives: re-adding a renamed key
   * would otherwise move it to the end of the block. A name another
   * property already has is refused — writing it would overwrite that
   * property's value — and checked again against the file itself, in
   * case the cache is behind.
   */
  async rename(oldKey, newKey) {
    const file = this.file;
    const clashWith = (keys) =>
      keys.find(
        (k) => k !== oldKey && k !== 'position' && k.toLowerCase() === newKey.toLowerCase()
      );
    const refuse = (clash) => {
      new Notice(`There's already a property called "${clash}".`);
      if (this.file === file) this.forceRefresh();
    };

    const cached = clashWith(Object.keys(this.frontmatter));
    if (cached) return refuse(cached);

    let clash = null;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        clash = clashWith(Object.keys(fm));
        if (clash) return;
        const entries = Object.keys(fm)
          .filter((k) => k !== 'position')
          .map((k) => [k, fm[k]]);
        entries.forEach(([k]) => delete fm[k]);
        entries.forEach(([k, v]) => {
          fm[k === oldKey ? newKey : k] = v;
        });
      });
      if (clash) return refuse(clash);
      this.afterWrite(file);
    } catch (err) {
      console.error('Design Redux: rename failed', err);
      new Notice('Could not rename the property.');
    }
  }

  /**
   * Write the properties in a new order. Rebuilt in place, as rename
   * is; any key the rows didn't know about — added elsewhere meanwhile —
   * keeps its place at the end. Not redrawn after, since the rows are
   * already where they belong, and redrawing before Obsidian has read
   * the file back would briefly show the old order.
   */
  async reorder(order) {
    const file = this.file;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const keys = Object.keys(fm).filter((k) => k !== 'position');
        const sorted = order
          .filter((k) => keys.indexOf(k) !== -1)
          .concat(keys.filter((k) => order.indexOf(k) === -1));
        const entries = sorted.map((k) => [k, fm[k]]);
        keys.forEach((k) => delete fm[k]);
        entries.forEach(([k, v]) => {
          fm[k] = v;
        });
      });
    } catch (err) {
      console.error('Design Redux: reorder failed', err);
      new Notice('Could not reorder the properties.');
      if (this.file === file) this.forceRefresh();
    }
  }

  /** After our own write, redraw even though focus is still inside. */
  forceRefresh() {
    if (!this.containerEl || !this.containerEl.isConnected) return;
    this.containerEl.empty();
    this.render();
  }
}

/* ------------------------------------------------------------------ */
/* Properties, Obsidian's own editor                                   */
/*                                                                     */
/* The alternative to rebuilding: borrow view.metadataEditor's own     */
/* element. Exact behaviour and exact appearance, at the cost of       */
/* bringing its page-level styling along and leaving the note without  */
/* its property block while the panel holds it.                        */
/**
 * Where a note is named but not linked: its name, or one of its
 * aliases, as a whole word in another note's text, matched without
 * case — as Obsidian's own unlinked mentions are. Links, embeds, tags
 * and frontmatter are passed over, since a name there is already a
 * link or isn't prose. Returns [{ file, count, line }], line being the
 * first mention's, for opening the note there.
 */
async function unlinkedMentions(app, target, limit = 5000) {
  const names = mentionNames(app, target);
  if (!names.length) return [];
  const escaped = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // A word boundary that knows about accented letters. Captured rather
  // than looked behind, which older iPhones can't parse.
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(${escaped.join('|')})(?=[^\\p{L}\\p{N}_]|$)`,
    'giu'
  );
  const lowered = names.map((n) => n.toLowerCase());

  const found = [];
  const files = app.vault.getMarkdownFiles().slice(0, limit);
  for (const file of files) {
    if (file.path === target.path) continue;
    let text = '';
    try {
      text = await app.vault.cachedRead(file);
    } catch (err) {
      continue;
    }
    const lower = text.toLowerCase();
    if (!lowered.some((n) => lower.includes(n))) continue;

    const skip = mentionSkips(app.metadataCache.getFileCache(file));
    let count = 0;
    let line = -1;
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text))) {
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      if (!skip.some(([a, b]) => start < b && end > a)) {
        count++;
        if (line < 0) line = text.slice(0, start).split('\n').length - 1;
      }
    }
    if (count) found.push({ file, count, line });
  }
  return found.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
}

/** A note's name and aliases — what counts as mentioning it. */
function mentionNames(app, file) {
  const names = [file.basename];
  const cache = app.metadataCache.getFileCache(file);
  const fm = (cache && cache.frontmatter) || {};
  ['aliases', 'alias'].forEach((key) => {
    const raw = fm[key];
    (Array.isArray(raw) ? raw : raw ? [raw] : []).forEach((a) => {
      const text = String(a).trim();
      if (text) names.push(text);
    });
  });
  const seen = new Set();
  return names.filter((n) => {
    const k = n.toLowerCase();
    if (!n.trim() || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Character ranges of a note that aren't prose: links, embeds, tags, frontmatter. */
function mentionSkips(cache) {
  if (!cache) return [];
  const ranges = [];
  const add = (pos) => {
    if (pos && pos.start && pos.end) ranges.push([pos.start.offset, pos.end.offset]);
  };
  ['links', 'embeds', 'tags'].forEach((kind) => (cache[kind] || []).forEach((item) => add(item.position)));
  add(cache.frontmatterPosition || (cache.frontmatter && cache.frontmatter.position));
  (cache.sections || []).forEach((sec) => {
    if (sec.type === 'yaml') add(sec.position);
  });
  return ranges;
}

class MentionsSection extends PanelSection {
  get cls() {
    return 'dr-mentions';
  }

  /**
   * Which groups are open. Kept on the panel, not the section, since a
   * section is rebuilt each time the panel opens or follows a note.
   * Unlinked starts folded, as Obsidian's does: it's a search through
   * every note, run only when it's asked for.
   */
  get folds() {
    if (!this.panel.mentionFolds) this.panel.mentionFolds = { linked: false, unlinked: true };
    return this.panel.mentionFolds;
  }

  /**
   * The notes that link here, as [{ file, count }] — from the newest
   * API shape or the older map. A note's links to itself, such as to
   * its own headings, aren't mentions of it and are left out, as
   * Obsidian's backlinks leave them.
   */
  backlinks() {
    try {
      const raw = this.app.metadataCache.getBacklinksForFile(this.file);
      if (!raw) return [];
      const data = raw.data || raw;
      const out = [];

      const add = (path, links) => {
        if (path === this.file.path) return;
        const file = this.app.vault.getFileByPath(path);
        if (file) out.push({ file: file, count: (links && links.length) || 1 });
      };

      if (typeof data.forEach === 'function' && !Array.isArray(data)) {
        data.forEach((links, path) => add(path, links));
      } else {
        Object.keys(data).forEach((path) => add(path, data[path]));
      }
      return out.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
    } catch (err) {
      console.error('Design Redux: could not read backlinks', err);
      return [];
    }
  }

  render() {
    this.renderGroup('linked', 'Linked mentions', () => this.backlinks());
    this.renderGroup('unlinked', 'Unlinked mentions', null);
  }

  /**
   * One group: a heading that folds it, then its notes. `read` gives the
   * notes at once; without it they're searched for, on first opening.
   */
  renderGroup(key, title, read) {
    const group = this.containerEl.createDiv({ cls: `dr-mention-group is-${key}` });
    const head = group.createDiv({ cls: 'dr-section-head' });
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    setIcon(head.createSpan({ cls: 'dr-section-chevron' }), 'chevron-down');
    head.createSpan({ cls: 'dr-section-title', text: title });
    const count = head.createSpan({ cls: 'dr-section-count' });
    const body = group.createDiv({ cls: 'dr-mention-body' });

    const fill = (items) => {
      body.empty();
      count.setText(String(items.length));
      if (!items.length) {
        body.createDiv({ cls: 'dr-empty', text: 'None' });
        return;
      }
      const list = body.createDiv({ cls: 'dr-mention-list' });
      items.forEach((item) => this.renderMention(list, item));
    };

    let searched = false;
    const search = async () => {
      if (searched) return;
      searched = true;
      const file = this.file;
      body.empty();
      body.createDiv({ cls: 'dr-empty', text: 'Searching…' });
      // The last search for this note stands until another note changes
      // or the note's own names do; a redraw alone doesn't repeat it.
      const panel = this.panel;
      const stamp = `${file.path}\n${mentionNames(this.app, file).join('\n')}\n${panel.otherEdits || 0}`;
      if (!panel.unlinkedCache) panel.unlinkedCache = new Map();
      let items = panel.unlinkedCache.get(stamp);
      if (!items) {
        try {
          items = await unlinkedMentions(this.app, file);
          panel.unlinkedCache.clear();
          panel.unlinkedCache.set(stamp, items);
        } catch (err) {
          console.error('Design Redux: could not search for mentions', err);
          items = [];
        }
      }
      // The panel may have moved on, or closed, while this ran.
      if (this.file !== file || !group.isConnected) return;
      fill(items);
    };

    const apply = () => {
      const folded = !!this.folds[key];
      group.toggleClass('is-collapsed', folded);
      head.setAttribute('aria-expanded', folded ? 'false' : 'true');
      if (!folded && !read) search();
    };
    onActivate(head, () => {
      this.folds[key] = !this.folds[key];
      apply();
    });

    if (read) fill(read());
    apply();
  }

  renderMention(list, item) {
    const row = list.createDiv({ cls: 'dr-mention' });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.createSpan({ cls: 'dr-mention-name', text: item.file.basename });
    if (item.count > 1) {
      row.createSpan({ cls: 'dr-mention-count', text: String(item.count) });
    }

    onActivate(
      row,
      (evt) => {
        const newLeaf = !!(evt && (evt.ctrlKey || evt.metaKey));
        if (typeof item.line === 'number' && item.line >= 0) {
          // An unlinked mention opens where the name is.
          this.app.workspace
            .getLeaf(newLeaf)
            .openFile(item.file, { eState: { line: item.line } });
        } else {
          this.app.workspace.openLinkText(item.file.path, this.file.path, newLeaf);
        }
        // Navigating away: the panel belongs to the note being left.
        this.panel.close();
      },
      false
    );
  }
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/*                                                                     */
/* Stacks sections and keeps them pointed at the active note. Nothing  */
/* is taken from the view, so the note keeps its own property block    */
/* and the panel can hold as many sections as it likes.                */
/* ------------------------------------------------------------------ */

class PropertiesPanel extends Feature {
  constructor(plugin) {
    super(plugin);
    this.popupEl = null;
    this.file = null;
    this.leaf = null;
    this.trigger = null;
    this.sections = [];
    // leaf -> its trigger element, so a fitted leaf costs a lookup
    // rather than a querySelector. Weak, so closing a tab drops it.
    this.fitted = new WeakMap();
  }

  settingsSchema() {
    return [
      {
        key: 'propertiesDropdown',
        name: 'Properties panel',
        desc: 'Hide properties in the note and open them from a button in its header instead.',
      },
      {
        key: 'showMentions',
        name: 'Mentions',
        desc: 'Below the properties, list the notes that link here or name it without linking.',
        showIf: 'propertiesDropdown',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'open-properties',
        name: 'Open properties',
        check: () => {
          const leaf = this.app.workspace.activeLeaf;
          return this.enabled && !!leaf && leaf.view instanceof MarkdownView;
        },
        run: () => {
          const leaf = this.app.workspace.activeLeaf;
          if (!leaf) return;
          const trigger = this.fitted.get(leaf);
          const box = trigger && trigger.isConnected ? trigger.getBoundingClientRect() : null;
          if (box && (box.width || box.height)) {
            trigger.click();
            return;
          }
          // Hidden while the strip is up: opened against the strip's button.
          const strip = document.querySelector('.dr-strip .dr-strip-btn[data-action="properties"]');
          this.toggleFrom(leaf, strip || trigger);
        },
      },
    ];
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (this.enabled) this.follow(leaf);
      })
    );
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // Fires when a leaf loads a different file, which
        // active-leaf-change does not cover.
        if (!this.isOpen() || !file || file === this.file) return;
        const leaf = this.app.workspace.activeLeaf;
        if (leaf && leaf.view instanceof MarkdownView) this.follow(leaf, true);
        else this.close();
      })
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (this.isOpen()) this.sections.forEach((sec) => sec.refresh(file));
      })
    );
    // A change to any note but the open one may add or remove a mention
    // of it, so the unlinked search is only repeated after one of those.
    this.otherEdits = 0;
    const edited = (file) => {
      if (!this.file || !file || file.path !== this.file.path) this.otherEdits++;
    };
    ['modify', 'create', 'delete', 'rename'].forEach((type) =>
      this.plugin.registerEvent(this.app.vault.on(type, edited))
    );
    this.plugin.registerDomEvent(document, 'keydown', (evt) => {
      if (evt.key === 'Escape' && this.isOpen()) this.close();
    });

    /*
     * Close on a click outside.
     *
     * pointerdown rather than click, so the panel goes before whatever
     * was clicked reacts. The exceptions all live on <body> rather than
     * inside the panel — the type menu, the property suggestions, and
     * the trigger itself, which does its own toggling — so a click on
     * any of them looks outside without being outside.
     */
    this.plugin.registerDomEvent(document, 'pointerdown', (evt) => {
      if (!this.isOpen()) return;
      // Any element — an icon is SVG, not HTML — and from any window.
      const el = evt.target;
      if (!el || el.nodeType !== 1 || typeof el.closest !== 'function') return;
      if (this.popupEl.contains(el)) return;
      if (
        el.closest(
          '.menu, .suggestion-container, .dr-suggest, .dr-props-trigger, .dr-strip-btn[data-action="properties"]'
        )
      ) {
        return;
      }
      this.close();
    });
    this.plugin.registerDomEvent(window, 'resize', () => this.reposition());
  }

  enable() {
    document.body.addClass('dr-props-active');
    // Only while the panel is actually listing them.
    document.body.toggleClass('dr-mentions-active', !!this.settings.showMentions);
    if (!this.popupEl || !this.popupEl.isConnected) {
      this.popupEl = document.body.createDiv({ cls: 'dr-props-popup' });
    }
    this.sync();
  }

  disable() {
    document.body.removeClass('dr-props-active');
    document.body.removeClass('dr-mentions-active');
    this.close();
    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
    document.querySelectorAll('.dr-props-trigger').forEach((el) => el.remove());
    this.fitted = new WeakMap();
  }

  /**
   * Give every rendered markdown leaf a trigger. Deferred leaves
   * (Obsidian 1.7.2+) have no header yet, so they are skipped here and
   * picked up when they become active.
   */
  sync() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred) return;
      if (!(leaf.view instanceof MarkdownView)) return;

      const known = this.fitted.get(leaf);
      if (known && known.isConnected) return;

      // The mobile header may have no left group; the actions take it.
      const header = leaf.containerEl.querySelector('.view-header');
      const left = header && header.querySelector('.view-header-left');
      const actions = header && header.querySelector('.view-actions');
      if (!left && !actions) return;

      const trigger = makeTrigger('dr-props-trigger', 'Properties', 'info', (el) => {
        this.anchor = null;
        this.toggle(leaf, el);
      });
      if (left) left.appendChild(trigger);
      else actions.prepend(trigger);
      this.fitted.set(leaf, trigger);
    });
  }

  /**
   * Opened from somewhere other than the header — the strip. The header's
   * trigger is hidden while the strip is up, and a hidden element has no
   * position, so the panel is placed against the button that asked.
   */
  toggleFrom(leaf, anchor) {
    const trigger = this.fitted.get(leaf);
    this.anchor = anchor;
    this.toggle(leaf, trigger && trigger.isConnected ? trigger : anchor);
  }

  toggle(leaf, trigger) {
    const file = leaf.view instanceof MarkdownView ? leaf.view.file : null;
    if (this.isOpen() && this.file === file) {
      this.close();
      return;
    }
    this.close();
    this.open(leaf, trigger);
  }

  /** Sections in the order they appear, subject to settings. */
  build() {
    const sections = [new PropertiesSection(this)];
    if (this.settings.showMentions) sections.push(new MentionsSection(this));
    return sections;
  }

  open(leaf, trigger) {
    if (!this.popupEl) return;
    const file = leaf.view instanceof MarkdownView ? leaf.view.file : null;
    if (!file) return;

    this.file = file;
    this.leaf = leaf;
    this.mount();

    // Shown first: the panel is display:none until then, and an
    // unrendered element measures zero, defeating the edge clamp.
    this.popupEl.addClass('is-open');
    this.place(trigger);
    this.setTrigger(trigger);
  }

  mount() {
    this.popupEl.empty();
    this.renderHead();
    this.sections = this.build();
    this.sections.forEach((sec) => sec.mount(this.popupEl, this.file));
  }

  /**
   * The note named, with one property raised to sit under it — the
   * title-and-artist shape an album page opens with. It tells you what
   * you're looking at before the details, which a bare list of fields
   * never does.
   */
  renderHead() {
    const head = this.popupEl.createDiv({ cls: 'dr-props-head' });
    head.createDiv({ cls: 'dr-props-title', text: this.file.basename });

    const lead = leadProperty(this.app, this.file, false);
    if (lead) head.createDiv({ cls: 'dr-props-lead', text: lead });
  }

  /** Switching notes moves the panel rather than closing it. */
  follow(leaf, force) {
    if (!this.isOpen()) return;
    if (!force && this.leaf === leaf) return;

    if (!leaf || !(leaf.view instanceof MarkdownView) || !leaf.view.file) {
      this.close();
      return;
    }

    this.file = leaf.view.file;
    this.leaf = leaf;
    this.mount();

    const trigger = this.fitted.get(leaf);
    if (trigger && trigger.isConnected) {
      this.setTrigger(trigger);
      this.place(trigger);
    }
  }

  /** Move the active marker and aria state onto a different trigger. */
  setTrigger(trigger) {
    document.querySelectorAll('.dr-props-trigger').forEach((el) => {
      el.removeClass('is-active');
      el.setAttribute('aria-expanded', 'false');
    });
    this.trigger = trigger;
    trigger.addClass('is-active');
    trigger.setAttribute('aria-expanded', 'true');
  }

  /**
   * Anchor under the trigger, flipping up when there's no room below.
   * On a phone it spans the screen, as a sheet would; the width comes
   * from the stylesheet.
   */
  place(trigger) {
    let r = trigger.getBoundingClientRect();
    if (!r.width && !r.height && this.anchor && this.anchor.isConnected) {
      r = this.anchor.getBoundingClientRect();
    }
    const el = this.popupEl;
    el.style.left = Platform.isPhone
      ? '8px'
      : `${Math.max(8, Math.min(r.left, window.innerWidth - 8 - el.offsetWidth))}px`;

    const below = window.innerHeight - r.bottom;
    if (below < 220 && r.top > below) {
      el.style.top = '';
      el.style.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      el.style.bottom = '';
      el.style.top = `${r.bottom + 6}px`;
    }
  }

  reposition() {
    if (this.isOpen() && this.trigger && this.trigger.isConnected) {
      this.place(this.trigger);
    }
  }

  close() {
    const wasInside =
      this.popupEl && this.popupEl.contains(document.activeElement);

    this.sections.forEach((sec) => sec.destroy());
    this.sections = [];
    this.file = null;
    this.leaf = null;

    // Each section takes its own suggestion lists with it; other
    // features' lists, such as the graph's, are theirs to keep.

    if (this.popupEl) {
      this.popupEl.removeClass('is-open');
      this.popupEl.empty();
    }

    document.querySelectorAll('.dr-props-trigger').forEach((el) => {
      el.removeClass('is-active');
      el.setAttribute('aria-expanded', 'false');
    });

    // Only reclaim focus if the panel held it; otherwise closing on a
    // click elsewhere would yank the caret out of whatever was clicked.
    if (wasInside && this.trigger && this.trigger.isConnected) {
      this.trigger.focus();
    }
    this.trigger = null;
  }

  isOpen() {
    return !!this.popupEl && this.popupEl.hasClass('is-open');
  }
}

PropertiesPanel.settingKey = 'propertiesDropdown';

/* ------------------------------------------------------------------ */
/* Context strip                                                       */
/*                                                                     */
/* The one piece of furniture the reference has that Obsidian doesn't: */
/* a bar that stays put and says what you're in. It carries the note   */
/* you're on, the way the now-playing bar carries the track, with the  */
/* actions that belong to it.                                          */
/* ------------------------------------------------------------------ */

/*
 * The note header's own reading toggle and More, which the strip
 * repeats. Found by the view's references to them where it keeps them,
 * then by their icons — Obsidian's More is three vertical dots, not
 * the horizontal ones, and both icons have been renamed across
 * versions, so every name is listed. Only in a view with a file: that's
 * where the strip has a More of its own.
 */
const HEADER_MORE_ICONS = ['more-vertical', 'ellipsis-vertical', 'more-horizontal', 'ellipsis'];
const HEADER_MODE_ICONS = ['book-open', 'edit-3', 'edit', 'pencil', 'pencil-line', 'pen-line'];

function headerDuplicates(leaf) {
  const view = leaf && !leaf.isDeferred ? leaf.view : null;
  if (!view || !view.containerEl || !(view.file instanceof TFile)) return [];
  const markdown = view instanceof MarkdownView;
  const found = new Set();
  const own = (el) => el && el.nodeType === 1;
  if (own(view.moreOptionsButtonEl)) found.add(view.moreOptionsButtonEl);
  if (markdown && own(view.modeButtonEl)) found.add(view.modeButtonEl);

  const icons = markdown ? HEADER_MORE_ICONS.concat(HEADER_MODE_ICONS) : HEADER_MORE_ICONS;
  view.containerEl.querySelectorAll('.view-actions > .clickable-icon').forEach((btn) => {
    const svg = btn.querySelector('svg');
    const names = ((svg && svg.getAttribute('class')) || '').split(/\s+/);
    if (icons.some((name) => names.indexOf(`lucide-${name}`) !== -1)) found.add(btn);
  });
  return Array.from(found);
}

class ContextStrip extends Feature {
  constructor(plugin) {
    super(plugin);
    this.el = null;
  }

  settingsSchema() {
    return [
      {
        key: 'contextStrip',
        name: 'Context strip',
        desc: 'A bar along the bottom with the note you\'re in: its cover, « » through its album, and its actions.',
      },
    ];
  }

  commands() {
    const step = (dir) => {
      const file = this.pageFile();
      const near = file ? albumNeighbours(this.plugin, file) : null;
      return near && near[dir];
    };
    return [
      {
        id: 'previous-in-album',
        name: 'Previous note in album',
        icon: 'chevrons-left',
        check: () => !!step('previous'),
        run: () => this.skip('previous'),
      },
      {
        id: 'next-in-album',
        name: 'Next note in album',
        icon: 'chevrons-right',
        check: () => !!step('next'),
        run: () => this.skip('next'),
      },
    ];
  }

  /** The note on the page, if the page is a note. */
  pageFile() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && !(view instanceof BrowseView) && view.file instanceof TFile ? view.file : null;
  }

  /** The note before or after this one in its album, opened in the same page. */
  skip(dir) {
    const file = this.pageFile();
    if (!file) return false;
    const target = albumNeighbours(this.plugin, file)[dir];
    const leaf = pageLeaf(this.app);
    if (!target || !leaf) return false;
    leaf.openFile(target);
    return true;
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', () => this.update())
    );
    this.plugin.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.update())
    );
    // Moving between browse screens changes neither the file nor the
    // leaf, so neither event above covers it.
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => this.update())
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file === this.app.workspace.getActiveFile()) this.update();
      })
    );
    // Moving notes around an album moves its neighbours.
    this.plugin.registerEvent(this.app.vault.on('rename', () => this.update()));

    if (Platform.isPhone) this.registerPhone();
  }

  /**
   * On a phone the strip is a mini player: it sits above Obsidian's
   * bottom bar, whose height depends on the device, so that's measured
   * rather than assumed; and it steps aside while the keyboard is up,
   * where it would otherwise float over what's being typed.
   */
  registerPhone() {
    const fit = () => this.fitAboveNavbar();
    this.plugin.registerEvent(this.app.workspace.on('resize', fit));
    this.plugin.registerEvent(this.app.workspace.on('layout-change', fit));
    this.plugin.registerDomEvent(window, 'resize', fit);

    const typing = (el) =>
      !!el &&
      typeof el.closest === 'function' &&
      !!el.closest('input, textarea, select, [contenteditable="true"]');
    this.plugin.registerDomEvent(document, 'focusin', (evt) => {
      document.body.toggleClass('dr-typing', typing(evt.target));
    });
    this.plugin.registerDomEvent(document, 'focusout', (evt) => {
      if (!typing(evt.relatedTarget)) document.body.removeClass('dr-typing');
    });
    this.plugin.register(() => {
      document.body.removeClass('dr-typing');
      document.body.style.removeProperty('--dr-strip-bottom');
      document.body.style.removeProperty('--dr-strip-z');
    });
  }

  fitAboveNavbar() {
    const bar = document.querySelector('.mobile-navbar');
    const r = bar ? bar.getBoundingClientRect() : null;
    const z = bar ? parseInt(window.getComputedStyle(bar).zIndex, 10) : NaN;
    if (Number.isFinite(z)) document.body.style.setProperty('--dr-strip-z', String(z));
    if (r && r.height) {
      document.body.style.setProperty(
        '--dr-strip-bottom',
        `${Math.round(window.innerHeight - r.top + 8)}px`
      );
    } else {
      // Hidden while typing, or not there: the stylesheet's fallback.
      document.body.style.removeProperty('--dr-strip-bottom');
    }
  }

  enable() {
    document.body.addClass('dr-strip-active');
    if (!this.el || !this.el.isConnected) {
      this.el = document.body.createDiv({ cls: 'dr-strip' });
    }
    if (Platform.isPhone) this.fitAboveNavbar();
    this.update();
  }

  disable() {
    document.body.removeClass('dr-strip-active');
    document.querySelectorAll('.dr-strip-dupe').forEach((el) => el.removeClass('dr-strip-dupe'));
    if (this.el) this.el.remove();
    this.el = null;
  }

  sync() {
    this.update();
  }

  /**
   * Mark the header buttons the strip repeats, in the main area, so the
   * stylesheet can take them away while the strip is up. Marked rather
   * than hidden here, so switching the strip off brings them straight
   * back.
   */
  markDuplicates() {
    const ws = this.app.workspace;
    if (typeof ws.iterateRootLeaves !== 'function') return;
    ws.iterateRootLeaves((leaf) => {
      headerDuplicates(leaf).forEach((el) => el.addClass('dr-strip-dupe'));
    });
  }

  canGo(dir) {
    return canStep(pageLeaf(this.app), dir);
  }

  go(dir) {
    step(pageLeaf(this.app), dir);
    // The stacks have moved, so the buttons need re-reading.
    window.setTimeout(() => this.update(), 50);
  }

  /**
   * Describes the page, not whatever has focus: getActiveFile and
   * activeLeaf both follow focus, so clicking into the sidebar could
   * leave the strip talking about something that isn't on screen.
   */
  update() {
    if (!this.el) return;
    this.markDuplicates();

    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    const browse = view instanceof BrowseView ? view : null;
    const file = !browse && view && view.file instanceof TFile ? view.file : null;

    this.el.empty();
    // Up whenever there's a page at all — including an empty one, since
    // the strip is also where a closed sidebar comes back from.
    this.el.toggleClass('is-empty', !view);
    if (!view) return;

    this.renderNav(this.el);
    if (file) {
      this.renderNow(this.el, file);
      this.renderActions(this.el, file, leaf);
    } else {
      this.renderScreen(this.el, view);
    }
  }

  /**
   * Anything that isn't a note: a browse screen, graph view, an empty
   * page. A folder screen gets the folder's menu, so making something
   * in it is a click away.
   */
  renderScreen(strip, view) {
    const browse = view instanceof BrowseView ? view : null;
    const now = strip.createDiv({ cls: 'dr-strip-now is-screen' });
    const art = now.createDiv({ cls: 'dr-strip-art is-blank' });
    const icon = browse
      ? 'library'
      : (typeof view.getIcon === 'function' && view.getIcon()) || 'layout';
    setIcon(art.createSpan({ cls: 'dr-card-glyph' }), icon);

    const title =
      (typeof view.getDisplayText === 'function' && view.getDisplayText()) ||
      'Nothing open';
    const text = now.createDiv({ cls: 'dr-strip-text' });
    text.createDiv({ cls: 'dr-strip-title', text: title });
    text.createDiv({ cls: 'dr-strip-sub', text: this.app.vault.getName() });

    const folder = browse && browse.mode === 'folder' ? browse.folder() : null;
    if (!folder) return;
    const actions = strip.createDiv({ cls: 'dr-strip-actions' });
    const more = actions.createDiv({ cls: 'clickable-icon dr-strip-btn' });
    more.setAttribute('aria-label', 'More');
    more.setAttribute('role', 'button');
    more.setAttribute('tabindex', '0');
    setIcon(more, 'ellipsis');
    onActivate(more, (evt) =>
      showTargetMenu(this.plugin, evt, folder, {
        here: true,
        source: 'design-redux-strip',
        redraw: () => browse.render(),
      })
    );
  }

  renderNav(strip) {
    const nav = strip.createDiv({ cls: 'dr-strip-nav' });

    // Only while the sidebar is closed; styled in and out by body class.
    const toggle = nav.createDiv({ cls: 'clickable-icon dr-strip-btn dr-sidebar-toggle' });
    toggle.setAttribute('aria-label', 'Show sidebar');
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('tabindex', '0');
    setIcon(toggle, 'panel-left');
    onActivate(toggle, () => this.app.workspace.leftSplit.expand());

    [
      ['chevron-left', 'Back', 'back'],
      ['chevron-right', 'Forward', 'forward'],
    ].forEach(([icon, label, dir]) => {
      const el = nav.createDiv({ cls: 'clickable-icon dr-strip-btn' });
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      if (!this.canGo(dir)) {
        el.addClass('is-disabled');
        return;
      }
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      onActivate(el, () => this.go(dir));
    });
  }

  /** The note itself: cover, name, and one property beneath it. */
  renderNow(strip, file) {
    // The middle of the strip, as a player's: back a note through the
    // album, the note itself, and on a note.
    const center = strip.createDiv({ cls: 'dr-strip-center' });
    const near = albumNeighbours(this.plugin, file);
    this.skipButton(center, near, 'previous');
    const now = center.createDiv({ cls: 'dr-strip-now' });
    now.setAttribute('role', 'button');
    now.setAttribute('tabindex', '0');

    const art = now.createDiv({ cls: 'dr-strip-art' });
    fillArt(
      art,
      resolveCover(this.app, file, this.settings.coverProperty),
      iconForFile(file),
      file.extension === 'md' ? coverGen(this.settings, file.basename, file.path) : null
    );

    const text = now.createDiv({ cls: 'dr-strip-text' });
    text.createDiv({ cls: 'dr-strip-title', text: file.basename });
    const lead = this.leadOf(file);
    if (lead) text.createDiv({ cls: 'dr-strip-sub', text: lead });

    // Clicking it goes to where the note lives, as the now-playing
    // bar goes to the album.
    onActivate(now, () => {
      if (!file.parent) return;
      const library = this.plugin.feature(Library);
      if (library) library.browseMode({ mode: 'folder', path: file.parent.path });
    });
    this.skipButton(center, near, 'next');
  }

  /** « or »: the note before or after this one in its album. */
  skipButton(parent, near, dir) {
    const target = near[dir];
    const word = dir === 'previous' ? 'Previous' : 'Next';
    const el = parent.createDiv({ cls: 'clickable-icon dr-strip-btn dr-strip-skip' });
    el.dataset.action = dir;
    setIcon(el, dir === 'previous' ? 'chevrons-left' : 'chevrons-right');
    el.setAttribute('aria-label', target ? `${word}: ${target.basename}` : `${word}: none`);
    if (!target) {
      el.addClass('is-disabled');
      return el;
    }
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    onActivate(el, () => this.skip(dir));
    return el;
  }

  renderActions(strip, file, leaf) {
    const actions = strip.createDiv({ cls: 'dr-strip-actions' });

    const button = (icon, label, onClick, active, role) => {
      const el = actions.createDiv({ cls: 'clickable-icon dr-strip-btn' });
      if (role) el.dataset.action = role;
      el.setAttribute('aria-label', label);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      setIcon(el, icon);
      if (active) el.addClass('is-active');
      onActivate(el, onClick);
    };

    // The last thing the view header carried that the strip didn't, so
    // the header can go entirely in single-area mode.
    if (leaf && !leaf.isDeferred && leaf.view instanceof MarkdownView) {
      const reading = leaf.view.getMode() === 'preview';
      button(
        reading ? 'pencil' : 'book-open',
        reading ? 'Edit' : 'Read',
        () => {
          // The command acts on whatever has focus, so the page is
          // given focus first; otherwise a click here with the sidebar
          // focused would do nothing.
          this.app.workspace.setActiveLeaf(leaf, { focus: true });
          this.app.commands.executeCommandById('markdown:toggle-preview');
          window.setTimeout(() => this.update(), 50);
        },
        false,
        'mode'
      );
    }

    const pinned = this.plugin.pins.has(file);
    button(pinned ? 'pin-off' : 'pin', pinned ? 'Unpin' : 'Pin', () => {
      this.plugin.togglePin(file);
      this.update();
    }, pinned, 'pin');

    button('info', 'Properties', (evt) => {
      const panel = this.plugin.feature(PropertiesPanel);
      if (panel && panel.enabled && leaf) panel.toggleFrom(leaf, evt.currentTarget);
    }, false, 'properties');

    // The page menu the note's own header had — Find, Replace, Export
    // to PDF, version history — followed by the file's entries, which
    // Obsidian adds as part of it. Hiding the header had taken all of
    // that away.
    button('ellipsis', 'More', (evt) => {
      const menu = new Menu();
      const view = leaf && !leaf.isDeferred ? leaf.view : null;
      if (view && typeof view.onPaneMenu === 'function') {
        view.onPaneMenu(menu, 'more-options');
      } else {
        this.app.workspace.trigger('file-menu', menu, file, 'design-redux-strip', leaf);
      }
      showMenuAt(menu, evt);
    }, false, 'more');
  }

  leadOf(file) {
    return leadProperty(this.app, file, true);
  }

}

ContextStrip.settingKey = 'contextStrip';

/* ------------------------------------------------------------------ */
/* One page                                                            */
/*                                                                     */
/* The last of the shell: one place content goes, moved through with   */
/* back and forward. Everything that would open a new tab, split or    */
/* window is routed through workspace.getLeaf, so wrapping that one    */
/* method covers links, menus, modifier-clicks and most plugins alike. */
/*                                                                     */
/* It overrides behaviour other plugins may count on — one that opens  */
/* a fresh tab to compare two notes will replace what you're reading   */
/* instead — so it's opt-in, and undone completely when switched off.  */
/* ------------------------------------------------------------------ */

class OnePage extends Feature {
  constructor(plugin) {
    super(plugin);
    this.unpatch = null;
    this.filling = false;
    this.warned = false;
  }

  settingsSchema() {
    return [
      {
        key: 'onePage',
        name: 'Keep to one page',
        desc: 'Open what would be a new tab, split or window in the page you are on, and show Home on an empty page. A plugin that expects a new tab will replace the page.',
      },
    ];
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.enabled) this.fillEmpty();
      })
    );
  }

  enable() {
    document.body.addClass('dr-one-page');

    if (!this.unpatch) {
      // A request for a new leaf of any kind becomes a request for the
      // current one. getLeaf(false) still makes a new tab when the page
      // is pinned, which is the one case where replacing it would be
      // wrong.
      this.unpatch = around(this.app.workspace, 'getLeaf', (original, ws, args) =>
        args[0] ? original.call(ws, false) : original.apply(ws, args)
      );
    }

    this.fillEmpty();
    this.warnHidden();
  }

  disable() {
    document.body.removeClass('dr-one-page');
    if (this.unpatch) this.unpatch();
    this.unpatch = null;
  }

  /**
   * An empty page shows Home, the way the app this borrows from never
   * shows a blank window. That covers the new-tab command, closing the
   * last note, and starting with nothing open.
   */
  fillEmpty() {
    if (this.filling) return;
    const library = this.plugin.feature(Library);
    if (!library || !library.enabled) return;

    const leaf = pageLeaf(this.app);
    if (!leaf || leaf.getViewState().type !== 'empty') return;

    this.filling = true;
    leaf
      .setViewState({
        type: BROWSE_VIEW,
        active: true,
        state: { mode: 'home', path: '/', property: null, value: null },
      })
      .catch((err) => console.error('Design Redux: could not show Home', err))
      .finally(() => {
        this.filling = false;
      });
  }

  /**
   * Tabs opened before this was switched on are still there. With the
   * tab bar hidden they'd be unreachable and easy to forget, so say so
   * once rather than closing anything on the user's behalf.
   */
  warnHidden() {
    if (this.warned || !singleAreaOn(this.settings)) return;
    let pages = 0;
    this.app.workspace.iterateRootLeaves(() => pages++);
    if (pages <= 1) return;

    this.warned = true;
    const others = pages - 1;
    new Notice(
      `${others} other ${others === 1 ? 'page is' : 'pages are'} still open behind this one. ` +
        'Run "Close all other tabs" to fold them away.'
    );
  }
}

OnePage.settingKey = 'onePage';

/* ------------------------------------------------------------------ */
/* Menu filter                                                         */
/*                                                                     */
/* Obsidian's own context menu is the better menu: it carries link     */
/* actions and everything else the native block offers. Rather than    */
/* suppress it and substitute a poorer copy, watch for menus appearing */
/* and drop the items not wanted.                                      */
/* ------------------------------------------------------------------ */

class MenuFilter extends Feature {
  constructor(plugin) {
    super(plugin);
    this.observer = null;
    this.unpatch = null;
  }

  /** Read per menu, so switching one page on or off applies to the next one. */
  hiddenTitles() {
    return this.settings.onePage ? HIDDEN_MENU_ITEMS.concat(ONE_PAGE_MENU_ITEMS) : HIDDEN_MENU_ITEMS;
  }

  enable() {
    if (this.observer) return;

    // The menu's own list first: arrow keys walk that, not the DOM, so
    // an item only taken off the screen could still be reached and
    // chosen from the keyboard. It isn't public API, so it's only
    // touched when it looks as expected; the DOM pass below still
    // tidies what's drawn either way.
    try {
      if (Menu && Menu.prototype && typeof Menu.prototype.showAtPosition === 'function') {
        this.unpatch = around(Menu.prototype, 'showAtPosition', (original, menu, args) => {
          try {
            this.prune(menu);
          } catch (err) {
            /* leave the menu as it was */
          }
          return original.apply(menu, args);
        });
      }
    } catch (err) {
      this.unpatch = null;
    }

    const strip = (menu) => {
      const hidden = this.hiddenTitles();
      menu.querySelectorAll('.menu-item').forEach((item) => {
        const title = item.querySelector('.menu-item-title');
        if (!title) return;
        if (hidden.indexOf(title.textContent.trim()) === -1) return;

        // Take a separator along if removing would leave two in a row.
        const prev = item.previousElementSibling;
        const next = item.nextElementSibling;
        if (
          prev &&
          prev.classList.contains('menu-separator') &&
          (!next || next.classList.contains('menu-separator'))
        ) {
          prev.remove();
        }
        item.remove();
      });
    };

    this.observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!node || node.nodeType !== 1) return;
          if (node.classList.contains('menu')) strip(node);
          else node.querySelectorAll('.menu').forEach(strip);
        });
      });
    });

    this.observer.observe(document.body, { childList: true });
  }

  /** Drop hidden entries from a menu's item list, and their elements with them. */
  prune(menu) {
    if (!menu || !Array.isArray(menu.items)) return;
    const hidden = this.hiddenTitles();
    const title = (item) => {
      const el = item && item.titleEl;
      return el && typeof el.textContent === 'string' ? el.textContent.trim() : null;
    };
    const kept = menu.items.filter((item) => {
      const t = title(item);
      if (t === null || hidden.indexOf(t) === -1) return true;
      if (item.dom && typeof item.dom.remove === 'function') item.dom.remove();
      return false;
    });
    // In place, in case anything else holds the same array.
    if (kept.length !== menu.items.length) menu.items.splice(0, menu.items.length, ...kept);
  }

  disable() {
    if (this.unpatch) {
      this.unpatch();
      this.unpatch = null;
    }
    if (!this.observer) return;
    this.observer.disconnect();
    this.observer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Settings gear relocated to the sidebar tab header                   */
/*                                                                     */
/* The real button is moved, not recreated, so its click handler and   */
/* tooltip come along untouched.                                       */
/* ------------------------------------------------------------------ */

class SettingsButton extends Feature {
  constructor(plugin) {
    super(plugin);
    this.el = null;
    this.home = null;
    this.nextSibling = null;
  }

  settingsSchema() {
    return [
      {
        key: 'settingsInHeader',
        name: 'Settings button',
        desc: 'Move the settings gear into the sidebar header.',
      },
    ];
  }

  enable() {
    document.body.addClass('dr-settings-active');
    this.sync();
  }

  disable() {
    document.body.removeClass('dr-settings-active');
    this.restore();
  }

  /**
   * Obsidian's gear. Each place it's kept is looked in in turn — the
   * vault's actions first — so a plugin's own gear-shaped button in the
   * ribbon is never taken for it.
   */
  find() {
    const holders = ['.workspace-drawer-vault-actions', '.side-dock-settings', '.workspace-ribbon'];
    for (const selector of holders) {
      for (const holder of document.querySelectorAll(selector)) {
        for (const icon of holder.querySelectorAll('.clickable-icon')) {
          if (icon.querySelector('svg.lucide-settings, svg.settings')) return icon;
        }
      }
    }
    return null;
  }

  sync() {
    const header = document.querySelector(TAB_HEADER);
    if (!header) return;
    if (this.el && this.el.isConnected && header.contains(this.el)) return;

    // Moved already, and the header rebuilt since: the gear was taken
    // down with the old one, and is put back rather than searched for.
    const moved = this.el && !this.el.isConnected;
    const gear = moved ? this.el : this.find();
    if (!gear) return;

    if (!moved) {
      this.home = gear.parentElement;
      this.nextSibling = gear.nextSibling;
      this.el = gear;
      this.hadLabel = gear.hasAttribute('aria-label');
      this.tooltip = gear.getAttribute('data-tooltip-position');
    }

    gear.addClass('dr-settings-moved');
    if (!gear.getAttribute('aria-label')) gear.setAttribute('aria-label', 'Settings');
    gear.setAttribute('data-tooltip-position', 'bottom');

    placeInHeader(header, gear, this.settings.headerOrder.settings, () => {
      const trigger = header.querySelector('.dr-trigger');
      const newTab = header.querySelector('.workspace-tab-header-new-tab');
      if (trigger) trigger.insertAdjacentElement('afterend', gear);
      else if (newTab) newTab.insertAdjacentElement('afterend', gear);
      else header.appendChild(gear);
    });
    makeHeaderDraggable(gear, 'settings', this.plugin);
    settleHeader(header, this.settings.headerOrder);
  }

  /** The gear back where it was, as it was. */
  restore() {
    const gear = this.el;
    if (gear) {
      gear.removeClass('dr-settings-moved');
      if (gear.drDragOff) gear.drDragOff();
      if (this.tooltip === null || this.tooltip === undefined) gear.removeAttribute('data-tooltip-position');
      else gear.setAttribute('data-tooltip-position', this.tooltip);
      if (!this.hadLabel) gear.removeAttribute('aria-label');
      if (this.home && this.home.isConnected) {
        // Its neighbour may have gone since; then it goes at the end.
        const next = this.nextSibling && this.nextSibling.parentNode === this.home ? this.nextSibling : null;
        this.home.insertBefore(gear, next);
      }
    }
    this.el = null;
    this.home = null;
    this.nextSibling = null;
  }
}

SettingsButton.settingKey = 'settingsInHeader';
SettingsButton.desktopOnly = true;

/* ------------------------------------------------------------------ */
/* Cover images for Bases cards                                        */
/*                                                                     */
/* A card reads its cover from a property holding a wikilink, an       */
/* external URL or a hex colour. A bare filename renders nothing,      */
/* which is the usual reason a card comes up blank — so the link is    */
/* built here rather than typed.                                       */
/* ------------------------------------------------------------------ */

class ImagePicker extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChooseFile = onChoose;
    this.setPlaceholder('Select an image for the card cover');
  }

  getItems() {
    return this.app.vault
      .getFiles()
      .filter((f) => IMAGE_EXTENSIONS.indexOf(f.extension.toLowerCase()) !== -1);
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    this.onChooseFile(file);
  }
}

/**
 * Asks for a name. Obsidian has no public prompt, so this is a small
 * modal of its own: Enter creates, Escape cancels.
 */
class NamePrompt extends Modal {
  constructor(app, title, placeholder, onSubmit, opts = {}) {
    super(app);
    this.titleText = title;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
    this.opts = opts;
  }

  onOpen() {
    this.titleEl.setText(this.titleText);
    const input = this.contentEl.createEl('input', { type: 'text' });
    input.addClass('dr-name-input');
    input.placeholder = this.placeholder;
    if (this.opts.value !== undefined) input.value = String(this.opts.value);
    if (this.opts.numeric) input.setAttribute('inputmode', 'numeric');

    const submit = () => {
      const value = input.value.trim();
      this.close();
      if (value || this.opts.allowEmpty) this.onSubmit(value);
    };
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt)) return;
      evt.preventDefault();
      submit();
    });

    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons
      .createEl('button', { cls: 'mod-cta', text: this.opts.button || 'Create' })
      .addEventListener('click', submit);
    buttons
      .createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());

    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * A colour for a generated cover: a swatch, the theme's accent, one of
 * your own, or back to automatic. The preview is the cover as it will
 * look, so the choice is made by eye rather than by name.
 */
class CoverColorModal extends Modal {
  constructor(plugin, target, name) {
    super(plugin.app);
    this.plugin = plugin;
    this.target = target;
    this.name = name;
    // Null is automatic: whatever the settings would give it.
    this.value = plugin.orders.coverColor(target);
  }

  /** What it has without a colour of its own: 'icon', or a tint. */
  automatic() {
    return fallbackTint(this.plugin.settings);
  }

  get glyph() {
    return this.target instanceof TFolder ? 'folder' : iconForFile(this.target);
  }

  /** The cover as it'll look: a colour, or the plain icon. */
  paintPreview(tint) {
    this.preview.empty();
    this.preview.className = 'dr-color-preview';
    this.preview.removeAttribute('style');
    fillArt(this.preview, null, this.glyph, tint === 'icon' ? null : { name: this.name, tint: tint });
  }

  onOpen() {
    this.modalEl.addClass('dr-color-modal');
    this.titleEl.setText('Cover colour');
    const { contentEl } = this;

    const head = contentEl.createDiv({ cls: 'dr-color-head' });
    this.preview = head.createDiv({ cls: 'dr-color-preview' });
    const text = head.createDiv({ cls: 'dr-color-text' });
    text.createDiv({ cls: 'dr-color-name', text: this.name });
    this.label = text.createDiv({ cls: 'dr-color-label' });
    text.createDiv({
      cls: 'dr-color-hint',
      text: 'Shown while there is no cover image.',
    });

    const grid = contentEl.createDiv({ cls: 'dr-color-swatches' });
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Cover colour');
    roveFocus(grid, '.dr-color-swatch');
    this.swatches = [];

    const auto = this.automatic();
    this.swatch(grid, null, 'Automatic', auto, auto === 'icon' ? this.glyph : 'sparkles');
    this.swatch(grid, 'accent', 'Accent colour', 'accent');
    COVER_SWATCHES.forEach(([label, hex]) => this.swatch(grid, hex, label, hex));
    this.customSwatch(grid);

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    const save = buttons.createEl('button', { cls: 'mod-cta', text: 'Save' });
    save.addEventListener('click', () => this.save());
    buttons
      .createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());

    this.select(this.value);
    window.setTimeout(() => {
      const on = this.swatches.find((s) => s.el.getAttribute('aria-checked') === 'true');
      (on ? on.el : save).focus();
    }, 0);
  }

  swatch(grid, value, label, paint, icon) {
    const el = grid.createEl('button', { cls: 'dr-color-swatch' });
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-label', label);
    el.setAttribute('title', label);
    // The plain icon, where that's what automatic means.
    const dot = el.createSpan({ cls: paint === 'icon' ? 'dr-color-dot is-icon' : 'dr-color-dot is-generated' });
    if (paint !== 'icon') paintTint(dot, paint, this.name);
    if (icon) setIcon(dot.createSpan({ cls: 'dr-color-mark' }), icon);
    // Read when clicked: the custom swatch's colour changes as it's picked.
    const entry = { el, value, label, onPick: null };
    el.addEventListener('click', () => (entry.onPick ? entry.onPick() : this.select(entry.value)));
    // Two clicks on the same colour is the choice made.
    el.addEventListener('dblclick', () => {
      if (entry.onPick) return;
      this.select(entry.value);
      this.save();
    });
    this.swatches.push(entry);
    return el;
  }

  /**
   * Any colour at all, through the system's own picker. The input is
   * hidden at the swatches' corner, so the picker opens near them.
   */
  customSwatch(grid) {
    const own = this.value && this.value !== 'accent' && !COVER_SWATCHES.some(([, hex]) => hex === this.value)
      ? this.value
      : null;
    const el = this.swatch(grid, own, 'Custom colour', own, own ? null : 'plus');
    el.addClass('is-custom');
    const entry = this.swatches[this.swatches.length - 1];
    // Beside the swatch rather than in it: a field can't sit in a button.
    const input = grid.createEl('input', { cls: 'dr-color-input', type: 'color' });
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.value = own || normalHex(this.value) || '#fa2d48';

    const take = () => {
      const hex = normalHex(input.value);
      if (!hex) return;
      entry.value = hex;
      const dot = el.querySelector('.dr-color-dot');
      paintTint(dot, hex, this.name);
      const mark = dot.querySelector('.dr-color-mark');
      if (mark) mark.remove();
      this.select(hex);
    };
    input.addEventListener('input', take);
    input.addEventListener('change', take);

    // Holding a colour that isn't the one chosen, a press chooses it;
    // otherwise — nothing picked yet, or pressed again — the picker opens.
    entry.onPick = () => {
      if (entry.value && this.value !== entry.value) {
        this.select(entry.value);
        return;
      }
      try {
        if (typeof input.showPicker === 'function') input.showPicker();
        else input.click();
      } catch (err) {
        input.click();
      }
    };
    this.custom = { el, input, entry };
  }

  select(value) {
    this.value = value || null;
    const on = this.swatches.find((s) => s.value === this.value) || this.swatches[0];
    this.swatches.forEach((s) => {
      s.el.setAttribute('aria-checked', String(s === on));
      s.el.toggleClass('is-selected', s === on);
    });
    this.paintPreview(this.value || this.automatic());
    this.label.setText(on.value === null ? `Automatic${this.automaticNote()}` : on.label === 'Custom colour' ? this.value : on.label);
  }

  automaticNote() {
    const style = this.plugin.settings.coverFallback || 'icon';
    if (style === 'accent') return ' · the accent colour';
    if (style === 'custom') return ' · the colour in settings';
    if (style === 'name') return ' · picked from the name';
    return ' · the icon';
  }

  async save() {
    const value = this.value;
    this.close();
    await this.plugin.orders.setCoverColor(this.target, value);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class FolderPicker extends FuzzySuggestModal {
  constructor(app, onChoose, opts = {}) {
    super(app);
    this.onChooseFolder = onChoose;
    this.opts = opts;
    this.setPlaceholder(opts.placeholder || 'Which folder?');
  }

  getItems() {
    const out = [];
    // The vault itself, where a folder is being moved: the top level is somewhere to go.
    if (this.opts.withRoot) out.push(this.app.vault.getRoot());
    const walk = (folder) =>
      (folder.children || []).forEach((child) => {
        if (!(child instanceof TFolder)) return;
        if (this.opts.skip && this.opts.skip(child)) return;
        out.push(child);
        walk(child);
      });
    walk(this.app.vault.getRoot());
    return out;
  }

  getItemText(folder) {
    return folder.isRoot && folder.isRoot() ? `${this.app.vault.getName()} (top level)` : folder.path;
  }

  onChooseItem(folder) {
    this.onChooseFolder(folder);
  }
}

/**
 * A choice from a list, with a count or note beside each: the tag, the
 * property, its value, the date range.
 */
class ChoicePicker extends FuzzySuggestModal {
  constructor(app, placeholder, items, onChoose) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder(placeholder);
  }

  getItems() {
    return this.items;
  }

  getItemText(item) {
    return item.label;
  }

  renderSuggestion(match, el) {
    super.renderSuggestion(match, el);
    if (match && match.item && match.item.note) {
      el.createSpan({ cls: 'dr-choice-note', text: match.item.note });
    }
  }

  onChooseItem(item) {
    this.onChoose(item);
  }
}

class CoverImages extends Feature {
  settingsSchema() {
    return [
      {
        key: 'folderNoteName',
        type: 'text',
        name: 'Folder note name',
        desc: 'The note that stands for a folder and gives it a cover. {{folder}} is the folder\'s name.',
        placeholder: '{{folder}}',
        fallback: '{{folder}}',
      },
      {
        key: 'hideFolderNotes',
        name: 'Hide folder notes',
        desc: 'Leave a folder\'s own note out of its listing.',
      },
      {
        key: 'coverProperty',
        type: 'text',
        name: 'Cover property',
        desc: 'The property a note\'s cover image is kept in. Match it to the image property in your bases\' card view.',
        placeholder: 'cover',
        fallback: 'cover',
        suggest: 'property',
      },
      {
        key: 'coverFallback',
        type: 'dropdown',
        name: 'Without a cover',
        desc: 'What a note or folder without a cover image shows. One can still have a colour of its own: right-click it and choose Cover colour.',
        options: {
          icon: 'The icon',
          name: 'A colour from each name',
          accent: 'The accent colour',
          custom: 'One colour for all',
        },
      },
      {
        key: 'generatedCoverColor',
        type: 'color',
        showIf: (settings) => settings.coverFallback === 'custom',
        name: 'Colour',
        desc: 'For every generated cover that hasn\'t a colour of its own.',
        parent: 'coverFallback',
      },
    ];
  }

  commands() {
    const withFile = (fn) => ({
      check: () => !!this.app.workspace.getActiveFile(),
      run: () => fn(this.app.workspace.getActiveFile()),
    });

    return [
      Object.assign(
        { id: 'set-cover-image', name: 'Set cover image for Bases card' },
        withFile((file) =>
          new ImagePicker(this.app, (image) =>
            this.setCover(file, this.linkTo(image, file))
          ).open()
        )
      ),
      Object.assign(
        { id: 'cover-from-first-image', name: 'Use first image in note as card cover' },
        withFile((file) => {
          const image = this.firstImageIn(file);
          if (!image) new Notice('No images embedded in this note.');
          else this.setCover(file, this.linkTo(image, file));
        })
      ),
      Object.assign(
        { id: 'repair-cover-link', name: 'Repair cover image link' },
        withFile((file) => this.repairCover(file))
      ),
      Object.assign(
        { id: 'remove-cover-image', name: 'Remove cover image' },
        withFile((file) => this.plugin.clearNoteCover(file))
      ),
      {
        id: 'set-cover-color',
        name: 'Set cover colour',
        icon: 'palette',
        // The page's own: the folder on screen, or the note that's open.
        check: () => !!this.coverColorTarget(),
        run: () => this.plugin.chooseCoverColor(this.coverColorTarget()),
      },
      {
        id: 'set-folder-cover',
        name: 'Set cover image for a folder',
        run: () =>
          new FolderPicker(this.app, (folder) =>
            this.plugin.setFolderCover(folder)
          ).open(),
      },
      {
        id: 'remove-folder-cover',
        name: 'Remove cover image from a folder',
        run: () =>
          new FolderPicker(this.app, (folder) =>
            this.plugin.clearFolderCover(folder)
          ).open(),
      },
    ];
  }

  get property() {
    return this.settings.coverProperty || 'cover';
  }

  coverColorTarget() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    if (view instanceof BrowseView) {
      const folder = view.mode === 'folder' ? view.folder() : null;
      return folder && !folder.isRoot() ? folder : null;
    }
    const file = view && view.file instanceof TFile ? view.file : null;
    return file && file.extension === 'md' ? file : null;
  }

  /**
   * A wikilink, the form properties and Bases read, whatever the vault's
   * own link format: a Markdown link in a property isn't a link to
   * Obsidian, and nothing here could find the image from it.
   */
  linkTo(image, from) {
    const text = this.app.metadataCache.fileToLinktext(image, from ? from.path : '', true);
    return `[[${text}]]`;
  }

  /** The first embedded image in a note, resolved to a real file. */
  firstImageIn(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const embeds = (cache && cache.embeds) || [];
    for (const embed of embeds) {
      const target = this.app.metadataCache.getFirstLinkpathDest(
        embed.link.split('#')[0],
        file.path
      );
      if (target && IMAGE_EXTENSIONS.indexOf(target.extension.toLowerCase()) !== -1) {
        return target;
      }
    }
    return null;
  }

  async setCover(file, value) {
    const key = this.property;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[key] = value;
      });
      new Notice(`Cover set on "${key}".`);
    } catch (err) {
      console.error('Design Redux: could not set the cover', err);
      new Notice('Could not update the properties.');
    }
  }

  /**
   * Turn a bare filename into a link. Typing "photo.png" is the natural
   * thing to do and the commonest reason a card shows no image.
   */
  repairCover(file) {
    const key = this.property;
    const cache = this.app.metadataCache.getFileCache(file);
    const raw = cache && fmGet(cache.frontmatter, key);

    if (typeof raw !== 'string' || !raw.trim()) {
      new Notice(`No "${key}" property to repair.`);
      return;
    }

    const value = raw.trim();
    if (value.startsWith('[[') || value.startsWith('#') || /^https?:\/\//i.test(value)) {
      new Notice('That cover is already in a form Bases can read.');
      return;
    }

    const target = this.app.metadataCache.getFirstLinkpathDest(
      value.replace(/^!?\[\[|\]\]$/g, '').split('#')[0],
      file.path
    );
    if (!target) {
      new Notice(`No file in the vault matches "${value}".`);
      return;
    }

    this.setCover(file, this.linkTo(target, file));
  }
}

/* ------------------------------------------------------------------ */
/* Image routing                                                       */
/* ------------------------------------------------------------------ */

class ImageRouter extends Feature {
  settingsSchema() {
    return [
      {
        key: 'routeImages',
        name: 'Move new images to a folder',
        desc: 'Move images added to the vault into one folder, updating the links to them. Other attachments follow Obsidian\'s own setting.',
      },
      {
        key: 'imageFolder',
        type: 'text',
        name: 'Image folder',
        desc: 'Relative to the vault root. Created if missing; images already in it stay put.',
        placeholder: 'attachments',
        showIf: 'routeImages',
        suggest: 'folder',
      },
    ];
  }

  register() {
    // Registered after layout is ready: every file in the vault fires a
    // create event during startup, and those must not be touched.
    this.plugin.registerEvent(
      this.app.vault.on('create', (file) => {
        if (this.enabled) this.route(file);
      })
    );
  }

  /**
   * Only files created while the app is running: Obsidian fires create
   * for every file in the vault during startup, and moving those would
   * reorganise the whole vault.
   *
   * The move waits for the note the image was pasted into to link it —
   * or a few seconds, whichever is first — so the link is updated with
   * the move, not left pointing at where the image first landed.
   */
  async route(file) {
    if (!(file instanceof TFile)) return;
    if (IMAGE_EXTENSIONS.indexOf(file.extension.toLowerCase()) === -1) return;

    const folder = normalizePath(
      (this.settings.imageFolder || '').replace(/^\/+|\/+$/g, '')
    );
    if (!folder || folder === '/') return;

    // Already there, or somewhere beneath it.
    if (file.path === `${folder}/${file.name}`) return;
    if (file.path.startsWith(`${folder}/`)) return;

    const cache = this.app.metadataCache;
    const path = file.path;
    let done = false;
    let timer = 0;
    const ref = cache.on('resolve', (source) => {
      const links = (cache.resolvedLinks && cache.resolvedLinks[source.path]) || {};
      if (links[path]) finish();
    });
    const finish = async () => {
      if (done) return;
      done = true;
      cache.offref(ref);
      window.clearTimeout(timer);
      if (this.app.vault.getAbstractFileByPath(path) !== file) return;
      try {
        if (!this.app.vault.getFolderByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
      } catch (err) {
        console.error('Design Redux: could not create the image folder', err);
        return;
      }
      this.plugin.moveFile(file, folder);
    };
    timer = window.setTimeout(finish, 4000);
  }

}

ImageRouter.settingKey = 'routeImages';

/* ------------------------------------------------------------------ */
/* Property clipboard                                                  */
/* ------------------------------------------------------------------ */

class PropertyClipboard extends Feature {
  commands() {
    const withFile = (fn) => ({
      check: () => !!this.app.workspace.getActiveFile(),
      run: () => fn(this.app.workspace.getActiveFile()),
    });

    return [
      {
        id: 'sort-properties',
        name: 'Sort properties alphabetically',
        check: () => {
          const editor = this.activeEditor();
          return !!(editor && typeof editor.sortProperties === 'function');
        },
        run: () => this.activeEditor().sortProperties(),
      },
      Object.assign({ id: 'copy-properties', name: 'Copy properties' },
        withFile((file) => this.copy(file))),
      Object.assign({ id: 'paste-properties', name: 'Paste properties' },
        withFile((file) => this.paste(file))),
    ];
  }

  activeEditor() {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf || leaf.isDeferred || !(leaf.view instanceof MarkdownView)) return null;
    return leaf.view.metadataEditor || null;
  }

  /**
   * Copied as JSON rather than YAML: it round-trips exactly, and the
   * paste side can parse it without a YAML parser.
   */
  async copy(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    const out = {};
    Object.keys(fm).forEach((k) => {
      if (k !== 'position') out[k] = fm[k];
    });

    const count = Object.keys(out).length;
    if (!count) {
      new Notice('This note has no properties.');
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(out, null, 2));
      new Notice(`Copied ${count} ${count === 1 ? 'property' : 'properties'}.`);
    } catch (err) {
      console.error('Design Redux: clipboard write failed', err);
      new Notice('Could not write to the clipboard.');
    }
  }

  /** Merges into whatever is already there; it never clears a note. */
  async paste(file) {
    let parsed;
    try {
      parsed = JSON.parse(await navigator.clipboard.readText());
    } catch (err) {
      new Notice('The clipboard does not contain copied properties.');
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      new Notice('The clipboard does not contain copied properties.');
      return;
    }

    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        Object.keys(parsed).forEach((k) => {
          fm[k] = parsed[k];
        });
      });
      const n = Object.keys(parsed).length;
      new Notice(`Pasted ${n} ${n === 1 ? 'property' : 'properties'}.`);
    } catch (err) {
      console.error('Design Redux: frontmatter write failed', err);
      new Notice('Could not update the properties.');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Property filters in the graph                                       */
/*                                                                     */
/* The graph's own filter is a search, and Obsidian's search already   */
/* reads properties: [domain] for notes that have one, [domain:Law]    */
/* for a value. What's missing is a way to build that without knowing  */
/* the syntax, so this adds a Properties section to the graph's        */
/* settings panel whose choices are written into its search field.     */
/* The graph does the filtering; nothing here reimplements it, and the */
/* query stays in the field where it can be read and edited by hand.   */
/* ------------------------------------------------------------------ */

const GRAPH_TYPES = ['graph', 'localgraph'];

const GRAPH_OPS = {
  is: 'is',
  not: 'is not',
  has: 'has any value',
  lacks: 'is missing',
};

/** Property names in the vault, most used first. */
function knownPropertyNames(app) {
  try {
    const m = app.metadataTypeManager;
    const all =
      (m && typeof m.getAllProperties === 'function' && m.getAllProperties()) ||
      (m && m.properties) ||
      {};
    return Object.keys(all)
      .map((k) => ({
        name: (all[k] && all[k].name) || k,
        count: (all[k] && (all[k].count || all[k].occurrences)) || 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((e) => e.name);
  } catch (err) {
    return [];
  }
}

/** Every value a property takes across the vault, most used first. */
function propertyValues(app, key) {
  const want = String(key || '').toLowerCase();
  if (!want) return [];
  const counts = new Map();
  app.vault.getMarkdownFiles().forEach((file) => {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache && cache.frontmatter;
    if (!fm) return;
    const name = Object.keys(fm).find((k) => k.toLowerCase() === want);
    if (!name) return;
    const raw = fm[name];
    (Array.isArray(raw) ? raw : [raw]).forEach((v) => {
      if (v === null || v === undefined || v === '') return;
      const text = plainValue(v);
      if (text) counts.set(text, (counts.get(text) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map((e) => e[0])
    .slice(0, 200);
}

/** Quoted when a bare word wouldn't survive the search syntax. */
function searchWord(text) {
  const t = String(text).trim();
  if (!/[\s"()[\]:]/.test(t) && !/^(OR|AND)$/i.test(t)) return t;
  return `"${t.replace(/"/g, '')}"`;
}

/** One condition as a search term, or '' while it's incomplete. */
function graphTerm(rule) {
  if (!rule.key) return '';
  const key = searchWord(rule.key);
  const value = (rule.value || '').trim();
  if (rule.op === 'has') return `[${key}]`;
  if (rule.op === 'lacks') return `-[${key}]`;
  if (!value) return '';
  const term = `[${key}:${searchWord(value)}]`;
  return rule.op === 'not' ? `-${term}` : term;
}

/** The conditions together: all of them, or any one. */
function graphClause(state) {
  const terms = state.rules.map(graphTerm).filter(Boolean);
  if (!terms.length) return '';
  if (state.mode === 'any' && terms.length > 1) return `(${terms.join(' OR ')})`;
  return terms.join(' ');
}

/**
 * Whether a search has an OR outside any brackets or quotes. Obsidian
 * reads "a OR b [x]" as "a OR (b and [x])", so such a search needs
 * brackets of its own before conditions can follow it.
 */
function looseOr(text) {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch) && /^\s+OR\s+/.test(text.slice(i))) return true;
  }
  return false;
}

/**
 * The part of a search that's the user's own, with the clause this
 * wrote last taken off the end. If they've edited it by hand, it's
 * no longer recognisable, and it's left as their own.
 */
function searchWithout(current, clause) {
  const text = (current || '').trim();
  if (clause && text.endsWith(clause)) return text.slice(0, -clause.length).trim();
  return text;
}

class GraphPropertyFilter extends Feature {
  constructor(plugin) {
    super(plugin);
    this.states = new WeakMap();
    this.observers = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'graphProperties',
        name: 'Property filters',
        desc: 'Add a Properties section to the graph view\'s filters, to show only notes with a property or a value.',
      },
    ];
  }

  enable() {
    this.sync();
  }

  /**
   * Called on layout changes, which is when a graph opens — and closes,
   * when its watcher and suggestion lists are let go.
   */
  sync() {
    this.observers.forEach((entry, controls) => {
      if (controls.isConnected) return;
      entry.mo.disconnect();
      const state = this.states.get(entry.leaf);
      if (state && state.suggests) state.suggests.forEach((el) => el.remove());
      this.observers.delete(controls);
    });
    this.app.workspace.iterateAllLeaves((leaf) => this.mount(leaf));
  }

  disable() {
    this.observers.forEach((entry) => entry.mo.disconnect());
    this.observers.clear();
    document.querySelectorAll('.dr-graph-props').forEach((el) => el.remove());
    document.querySelectorAll('.dr-graph-suggest').forEach((el) => el.remove());
  }

  controlsOf(leaf) {
    if (!leaf || leaf.isDeferred || !leaf.view) return null;
    const type = typeof leaf.view.getViewType === 'function' ? leaf.view.getViewType() : '';
    if (GRAPH_TYPES.indexOf(type) === -1) return null;
    return leaf.view.containerEl.querySelector('.graph-controls');
  }

  /**
   * The graph's search field. Obsidian's own markup, so looked for more
   * than one way: in the Filters section, then any search field.
   */
  filterInput(controls) {
    return (
      controls.querySelector('.mod-filter input[type="search"]') ||
      controls.querySelector('.mod-filter input') ||
      controls.querySelector('input[type="search"]')
    );
  }

  mount(leaf) {
    const controls = this.controlsOf(leaf);
    if (!controls) return;
    if (!controls.querySelector(':scope > .dr-graph-props')) this.render(leaf, controls);

    // The panel is rebuilt by "Restore default settings"; put it back.
    if (!this.observers.has(controls)) {
      const mo = new MutationObserver(() => {
        if (!controls.isConnected) return;
        if (this.enabled && !controls.querySelector(':scope > .dr-graph-props')) {
          this.render(leaf, controls);
        }
      });
      mo.observe(controls, { childList: true });
      this.observers.set(controls, { mo, leaf });
    }
  }

  /**
   * The conditions for a graph: the saved ones, if the search still
   * ends with the clause they made — otherwise the field was cleared or
   * reset, and there are none.
   */
  stateFor(leaf, controls) {
    const type = leaf.view.getViewType();
    const input = this.filterInput(controls);
    const saved = (this.settings.graphFilters || {})[type];
    const live = this.states.get(leaf);
    const current = input ? input.value.trim() : '';
    const holds = (s) => !!s && !!s.clause && current.endsWith(s.clause);

    if (live && (holds(live) || !live.clause)) return live;
    const state =
      holds(saved)
        ? { mode: saved.mode || 'all', rules: saved.rules.map((r) => Object.assign({}, r)), clause: saved.clause }
        : { mode: (saved && saved.mode) || 'all', rules: [], clause: '' };
    state.open = saved ? saved.open !== false : true;
    this.states.set(leaf, state);
    return state;
  }

  render(leaf, controls) {
    const state = this.stateFor(leaf, controls);
    controls.querySelectorAll(':scope > .dr-graph-props').forEach((el) => el.remove());

    // Obsidian's own section markup, so it looks and folds like the rest.
    const section = document.createElement('div');
    section.className = 'tree-item graph-control-section dr-graph-props';
    const head = section.createDiv({ cls: 'tree-item-self mod-collapsible dr-graph-props-head' });
    const icon = head.createDiv({ cls: 'tree-item-icon collapse-icon' });
    setIcon(icon, 'right-triangle');
    const inner = head.createDiv({ cls: 'tree-item-inner' });
    inner.createEl('header', { cls: 'graph-control-section-header', text: 'Properties' });
    const count = head.createDiv({ cls: 'dr-gp-count' });
    const body = section.createDiv({ cls: 'tree-item-children' });

    const fold = () => {
      section.toggleClass('is-collapsed', !state.open);
      icon.toggleClass('is-collapsed', !state.open);
    };
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    onActivate(head, () => {
      state.open = !state.open;
      fold();
      this.save(leaf, state);
    });
    fold();

    const filter = controls.querySelector(':scope > .mod-filter');
    if (filter) filter.after(section);
    else controls.prepend(section);

    const redraw = () => this.renderRules(leaf, controls, state, body, count);
    state.redraw = redraw;
    redraw();

    // Conditions renamed while this graph was closed still have the old
    // name in its search, which the clause they'd make now shows.
    if (state.clause && graphClause(state) !== state.clause) this.apply(leaf, controls, state);
  }

  renderRules(leaf, controls, state, body, count) {
    body.empty();
    if (state.suggests) state.suggests.forEach((el) => el.remove());
    state.suggests = [];

    const active = state.rules.map(graphTerm).filter(Boolean).length;
    count.setText(active ? String(active) : '');
    count.toggleClass('is-shown', active > 0);

    const names = knownPropertyNames(this.app);
    const apply = () => this.apply(leaf, controls, state);

    state.rules.forEach((rule, index) => {
      const row = body.createDiv({ cls: 'dr-gp-rule' });
      row.toggleClass('is-valueless', rule.op === 'has' || rule.op === 'lacks');

      const key = row.createEl('select', { cls: 'dropdown dr-gp-key' });
      key.setAttribute('aria-label', 'Property');
      const placeholder = key.createEl('option', { text: 'Property…' });
      placeholder.value = '';
      const listed = rule.key && names.indexOf(rule.key) === -1 ? [rule.key].concat(names) : names;
      listed.forEach((name) => {
        const opt = key.createEl('option', { text: name });
        opt.value = name;
      });
      key.value = rule.key || '';
      key.addEventListener('change', () => {
        rule.key = key.value;
        rule.value = '';
        apply();
        state.redraw();
      });

      const remove = row.createDiv({ cls: 'clickable-icon dr-gp-remove' });
      remove.setAttribute('aria-label', 'Remove');
      remove.setAttribute('role', 'button');
      remove.setAttribute('tabindex', '0');
      setIcon(remove, 'x');
      onActivate(remove, () => {
        state.rules.splice(index, 1);
        apply();
        state.redraw();
      });

      const op = row.createEl('select', { cls: 'dropdown dr-gp-op' });
      op.setAttribute('aria-label', 'Condition');
      Object.keys(GRAPH_OPS).forEach((k) => {
        const opt = op.createEl('option', { text: GRAPH_OPS[k] });
        opt.value = k;
      });
      op.value = rule.op || 'is';
      op.addEventListener('change', () => {
        rule.op = op.value;
        row.toggleClass('is-valueless', rule.op === 'has' || rule.op === 'lacks');
        apply();
        this.showCount(state, count);
      });

      const value = row.createEl('input', { cls: 'dr-gp-value', type: 'text' });
      value.placeholder = 'Value';
      value.setAttribute('aria-label', 'Value');
      value.value = rule.value || '';
      let timer = 0;
      const typed = () => {
        rule.value = value.value;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          apply();
          this.showCount(state, count);
        }, 300);
      };
      value.addEventListener('input', typed);
      value.addEventListener('keydown', (evt) => {
        if (evt.key !== 'Enter' || composing(evt)) return;
        window.clearTimeout(timer);
        rule.value = value.value;
        apply();
        this.showCount(state, count);
      });
      const list = attachSuggest(row, value, {
        icon: 'list',
        source: () => (rule.key ? propertyValues(this.app, rule.key) : []),
        onSelect: (v) => {
          value.value = v;
          window.clearTimeout(timer);
          rule.value = v;
          apply();
          this.showCount(state, count);
        },
      });
      list.addClass('dr-graph-suggest');
      state.suggests.push(list);
    });

    const foot = body.createDiv({ cls: 'dr-gp-foot' });
    const add = foot.createDiv({ cls: 'dr-gp-add' });
    add.setAttribute('role', 'button');
    add.setAttribute('tabindex', '0');
    setIcon(add.createSpan({ cls: 'dr-gp-add-icon' }), 'plus');
    add.createSpan({ text: state.rules.length ? 'Add another' : 'Add property filter' });
    onActivate(add, () => {
      state.rules.push({ key: '', op: 'is', value: '' });
      state.redraw();
      const keys = body.querySelectorAll('.dr-gp-key');
      if (keys.length) keys[keys.length - 1].focus();
    });

    if (state.rules.length > 1) {
      const mode = foot.createEl('select', { cls: 'dropdown dr-gp-mode' });
      mode.setAttribute('aria-label', 'Match');
      [['all', 'Match all'], ['any', 'Match any']].forEach(([v, label]) => {
        const opt = mode.createEl('option', { text: label });
        opt.value = v;
      });
      mode.value = state.mode;
      mode.addEventListener('change', () => {
        state.mode = mode.value;
        apply();
      });
    }

    if (!this.filterInput(controls)) {
      body.createDiv({
        cls: 'dr-gp-note',
        text: 'The graph\'s search field wasn\'t found, so these can\'t be applied.',
      });
    }
  }

  /**
   * A property renamed across the vault. Open graphs rename it in their
   * conditions and rewrite their search; one opened later finds its
   * saved conditions renamed, and rewrites its search then (render).
   */
  renameProperty(from, to) {
    const low = String(from).toLowerCase();
    this.observers.forEach((entry, controls) => {
      const state = this.states.get(entry.leaf);
      if (!state || !controls.isConnected) return;
      let hit = false;
      state.rules.forEach((rule) => {
        if (String(rule.key || '').toLowerCase() !== low) return;
        rule.key = to;
        hit = true;
      });
      if (!hit) return;
      this.apply(entry.leaf, controls, state);
      if (state.redraw) state.redraw();
    });
  }

  showCount(state, count) {
    const active = state.rules.map(graphTerm).filter(Boolean).length;
    count.setText(active ? String(active) : '');
    count.toggleClass('is-shown', active > 0);
  }

  /**
   * Write the conditions into the graph's search field, after whatever
   * was typed there, and let the graph know it changed. Typed text with
   * an OR of its own is bracketed first, so the conditions apply to all
   * of it rather than to its last alternative.
   */
  apply(leaf, controls, state) {
    const input = this.filterInput(controls);
    if (!input) return;
    let own = searchWithout(input.value, state.clause);
    const clause = graphClause(state);
    if (clause && looseOr(own)) own = `(${own})`;
    const next = [own, clause].filter(Boolean).join(' ');
    state.clause = clause;
    if (next !== input.value) {
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.save(leaf, state);
  }

  save(leaf, state) {
    const type = leaf.view.getViewType();
    if (!this.settings.graphFilters) this.settings.graphFilters = {};
    this.settings.graphFilters[type] = {
      mode: state.mode,
      rules: state.rules.map((r) => ({ key: r.key, op: r.op, value: r.value })),
      clause: state.clause,
      open: state.open,
    };
    this.plugin.saveData(this.settings);
  }
}

GraphPropertyFilter.settingKey = 'graphProperties';

/* ------------------------------------------------------------------ */
/* Lettered and roman numeral lists                                    */
/*                                                                     */
/* Markdown numbers lists 1., 2., 3. and nothing else, so a list       */
/* written a., b., c. or i., ii., iii. is plain paragraphs to          */
/* Obsidian. This makes it a list in the three places one shows:       */
/* drawn as one in reading view, styled as one in the editor, and      */
/* continued with the next letter or numeral when Enter is pressed.    */
/* The note's text is never changed — what you wrote is what's shown,  */
/* and any other markdown app reads the same file.                     */
/*                                                                     */
/* Some letters are numerals too — i, v, x, l, c, d, m — so what one   */
/* is depends on the item before it: "i" after "h" is the ninth        */
/* letter, and on its own it's the numeral one. Every item is read     */
/* against the one above it for that reason.                           */
/* ------------------------------------------------------------------ */

const ROMAN_DIGITS = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

const ROMAN_VALUES = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** Which kinds are recognised; the feature sets these from settings. */
const LIST_KINDS = { roman: true, alpha: true };

/*
 * "a." "a)" or "(a)" — letters in one case, at the start of a line
 * after any indentation, then at least one space. The same shapes legal
 * and academic writing number with.
 */
const LIST_ITEM = /^([ \t]*)(?:\(([a-z]+|[A-Z]+)\)|([a-z]+|[A-Z]+)([.)]))([ \t]+)/;

/** The opening or closing line of a fenced code block or a maths block. */
const LIST_FENCE = /^[ \t]*(```|~~~|\$\$)/;

/** A cheap test, run before anything that costs more. */
const LIST_HINT = /^[ \t]*(?:\([a-zA-Z]{1,15}\)|[a-zA-Z]{1,15}[.)])[ \t]/;

function toRoman(n) {
  let out = '';
  let rest = n;
  ROMAN_DIGITS.forEach(([value, digits]) => {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  });
  return out;
}

/**
 * A numeral's value, or 0 for anything not written the standard way —
 * "iiii", "vx" and "Iv" aren't numerals, and letting them through would
 * turn ordinary words at the start of a line into list items.
 */
function fromRoman(numeral) {
  if (!numeral || numeral.length > 15) return 0;
  const lower = numeral.toLowerCase();
  if (numeral !== lower && numeral !== numeral.toUpperCase()) return 0;
  let total = 0;
  for (let i = 0; i < lower.length; i++) {
    const here = ROMAN_VALUES[lower[i]];
    const next = ROMAN_VALUES[lower[i + 1]] || 0;
    if (!here) return 0;
    total += here < next ? -here : here;
  }
  if (total < 1 || total > 3999) return 0;
  return toRoman(total) === lower ? total : 0;
}

/** a–z, then aa, ab… as a spreadsheet's columns run. */
function toAlpha(n) {
  let out = '';
  let rest = n;
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

function fromAlpha(letters) {
  if (!letters || letters.length > 3) return 0;
  const lower = letters.toLowerCase();
  if (letters !== lower && letters !== letters.toUpperCase()) return 0;
  let total = 0;
  for (const ch of lower) {
    const code = ch.charCodeAt(0) - 96;
    if (code < 1 || code > 26) return 0;
    total = total * 26 + code;
  }
  return total;
}

/**
 * A line as a list item — { indent, kind, value, upper, style, marker,
 * prefix, content } — or null. `prev` is the item before it at the same
 * indent, as an item, null, or a function returning one; it's only
 * asked for when the line can't be read on its own.
 *
 * On its own, a line is an item only where lists start: at "a", or at
 * a numeral under 40 — so "i." is the numeral one. Anything else has to
 * follow the item before it, in the same style: "b" after "a", "i"
 * after "h", "xl" after "xxxix". That keeps words and names out — "etc."
 * "vs." "mix." "p. 12" and "J. Smith" don't follow anything — and a
 * single letter followed by another initial, "I. M. Pei" or
 * "A. B. Smith", is a name wherever it is.
 */
function parseListItem(text, prev) {
  const m = LIST_ITEM.exec(text);
  if (!m) return null;
  const token = m[2] || m[3];
  const content = text.slice(m[0].length);
  if (token.length === 1 && /^[A-Z]\.(\s|$)/.test(content)) return null;

  const roman = LIST_KINDS.roman ? fromRoman(token) : 0;
  const alpha = LIST_KINDS.alpha ? fromAlpha(token) : 0;
  if (!roman && !alpha) return null;

  const upper = token !== token.toLowerCase();
  const style = m[2] ? 'wrap' : m[4] === ')' ? 'paren' : 'dot';
  const make = (kind, value) => ({
    indent: m[1],
    kind: kind,
    value: value,
    upper: upper,
    style: style,
    marker: m[2] ? `(${token})` : token + m[4],
    prefix: m[0].length,
    content: content,
  });

  if (alpha === 1) return make('alpha', 1);
  if (roman && roman < 40 && token.length > 1) return make('roman', roman);

  const before = typeof prev === 'function' ? prev() : prev;
  if (before && before.upper === upper && before.style === style) {
    if (before.kind === 'alpha' && alpha === before.value + 1) return make('alpha', alpha);
    if (before.kind === 'roman' && roman === before.value + 1) return make('roman', roman);
  }
  if (roman && roman < 40) return make('roman', roman);
  return null;
}

/** The marker for a value, written the way `like` was. */
function listMarker(value, like) {
  let token = like.kind === 'alpha' ? toAlpha(value) : toRoman(value);
  if (like.upper) token = token.toUpperCase();
  if (like.style === 'wrap') return `(${token})`;
  return token + (like.style === 'paren' ? ')' : '.');
}

/** Whether two items belong to one list: same kind, case and punctuation. */
function sameListStyle(a, b) {
  return a.kind === b.kind && a.upper === b.upper && a.style === b.style;
}

/** The largest value a kind can be continued to. */
function listLimit(kind) {
  return kind === 'alpha' ? 18278 : 3999;
}

function leadingSpace(text) {
  return /^[ \t]*/.exec(text)[0];
}

/**
 * The item before a line, at its indent. The list is walked up to where
 * it starts and read back down, since what a letter is depends on what
 * came before it. Blank lines and deeper lines are passed over, and so
 * is text straight after an item, which continues it; the walk stops at
 * two blank lines, less indentation, or a paragraph that isn't part of
 * the list. `known` holds lines already read, by number.
 *
 * `doc` needs only line(n).text, numbered from 1 — an editor's document,
 * or a note's source seen from reading view.
 */
function listItemAbove(doc, lineNo, indent, known) {
  const run = [];
  let base = null;
  let blank = 0;
  let loose = false;
  for (let n = lineNo - 1; n >= 1 && n >= lineNo - 2000; n--) {
    const text = doc.line(n).text;
    if (!text.trim()) {
      // Plain text with a gap below and nothing above: a paragraph.
      if (loose) break;
      blank++;
      if (blank > 1) break;
      continue;
    }
    if (LIST_FENCE.test(text)) break;
    const own = leadingSpace(text);
    if (own.length > indent.length) {
      blank = 0;
      continue;
    }
    if (own === indent && LIST_ITEM.test(text)) {
      blank = 0;
      loose = false;
      const hit = known && known.has(n) ? known.get(n) : undefined;
      if (hit) {
        base = hit;
        break;
      }
      // Read already, and not an item: nothing to learn from it.
      if (hit === null) continue;
      run.push(text);
      continue;
    }
    if (own.length < indent.length) break;
    loose = true;
    blank = 0;
  }
  // A line shaped like an item that isn't one ("etc. and so on" under
  // an item) continues the item above rather than ending the list.
  let prev = base;
  for (let k = run.length - 1; k >= 0; k--) prev = parseListItem(run[k], prev) || prev;
  return prev;
}

/* -- the editor -------------------------------------------------------- */

/**
 * Code, maths, comments and frontmatter are left alone. Obsidian's
 * syntax tree names its nodes after the tokens they hold, so the names
 * say which of these a position is in.
 */
function listIgnored(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/code|frontmatter|math|comment/i.test(node.name)) return true;
  }
  return false;
}

function listItemAt(state, lineNo, known) {
  if (known && known.has(lineNo)) return known.get(lineNo);
  const line = state.doc.line(lineNo);
  let item = null;
  if (LIST_HINT.test(line.text) && !listIgnored(state, line.from)) {
    item = parseListItem(line.text, () =>
      listItemAbove(state.doc, lineNo, leadingSpace(line.text), known)
    );
  }
  if (known) known.set(lineNo, item);
  return item;
}

/**
 * The items after an insertion move up one, so the list still counts
 * in order. Each is read against the item written before it, not the
 * new numbering, so "i" after "h" stays a letter as it moves. Nested
 * lines are passed over, text straight after an item is part of it,
 * and the list ends at anything else — a different kind of marker,
 * less indentation, or two blank lines.
 */
function renumberListAfter(state, lineNo, like, expected, changes) {
  const doc = state.doc;
  let next = expected;
  let blank = 0;
  let written = like;
  for (let n = lineNo + 1; n <= doc.lines && n <= lineNo + 2000; n++) {
    const line = doc.line(n);
    if (!line.text.trim()) {
      blank++;
      if (blank > 1) return;
      continue;
    }
    // A code or maths block ends the list: what's inside isn't items,
    // however much it looks like them.
    if (LIST_FENCE.test(line.text) || listIgnored(state, line.from)) return;
    const indent = leadingSpace(line.text);
    if (indent.length > like.indent.length) {
      blank = 0;
      continue;
    }
    const item = parseListItem(line.text, written);
    if (!item || item.indent !== like.indent || !sameListStyle(item, like)) {
      // Text straight after an item continues it; after a gap, it's not the list.
      if (item || blank || indent.length < like.indent.length) return;
      continue;
    }
    blank = 0;
    written = item;
    if (next > listLimit(like.kind)) return;
    if (item.value !== next) {
      const from = line.from + item.indent.length;
      changes.push({ from, to: from + item.marker.length, insert: listMarker(next, like) });
    }
    next++;
  }
}

/**
 * Enter on an item starts the next one, as it does for numbers: "b. "
 * after "a. …", "iv. " after "iii. …", in the same case and punctuation,
 * at the same indent. Whatever was after the cursor goes with it. Enter
 * on an item with nothing in it ends the list instead. Anything else is
 * left to Obsidian, including Vim's normal mode and text being composed.
 */
function listEnter(view) {
  const state = view.state;
  if (view.composing) return false;
  const vim = view.cm && view.cm.state && view.cm.state.vim;
  if (vim && !vim.insertMode) return false;

  const sel = state.selection.main;
  if (state.selection.ranges.length !== 1 || !sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const item = listItemAt(state, line.number);
  if (!item || sel.head < line.from + item.prefix) return false;

  if (!line.text.slice(item.prefix).trim()) {
    const from = line.from + item.indent.length;
    view.dispatch({
      changes: { from, to: line.to },
      selection: { anchor: from },
      userEvent: 'delete',
    });
    return true;
  }

  const value = item.value + 1;
  if (value > listLimit(item.kind)) return false;
  const after = state.doc.sliceString(sel.head, line.to);
  const skip = after.length - after.replace(/^[ \t]+/, '').length;
  const insert = `\n${item.indent}${listMarker(value, item)} `;
  const changes = [{ from: sel.head, to: sel.head + skip, insert }];
  renumberListAfter(state, line.number, item, value + 1, changes);

  view.dispatch({
    changes,
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

/**
 * Text widths in the editor's own font, for the hanging indent. A
 * canvas measures without touching the page; where there's none, an
 * estimate from the font size.
 */
function listMeasurer(view) {
  const style = window.getComputedStyle(view.contentDOM);
  const font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily]
    .filter(Boolean)
    .join(' ');
  const size = parseFloat(style.fontSize) || 16;
  let ctx = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = font;
  } catch (err) {
    ctx = null;
  }
  const cache = new Map();
  const tab = ' '.repeat(view.state.tabSize || 4);
  return (text) => {
    const plain = text.replace(/\t/g, tab);
    if (!cache.has(plain)) {
      const width = ctx ? ctx.measureText(plain).width : plain.length * size * 0.5;
      cache.set(plain, Math.round(width * 10) / 10);
    }
    return cache.get(plain);
  };
}

const LIST_MARK = Decoration.mark({ class: 'dr-list-marker' });

/**
 * Each item line is given the marker's colour and a hanging indent, so
 * a long item wraps under its text rather than under its letter —
 * both as Obsidian does for its own numbered lists.
 */
function listDecorations(view, measure) {
  const builder = new RangeSetBuilder();
  const state = view.state;
  const known = new Map();
  let done = 0;
  view.visibleRanges.forEach(({ from, to }) => {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      // A fold inside a line splits it across two ranges; it's drawn once.
      if (line.number <= done) continue;
      done = line.number;
      const item = listItemAt(state, line.number, known);
      if (!item) continue;
      const width = measure(line.text.slice(0, item.prefix));
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: 'dr-marked-line',
          attributes: { style: `--dr-list-hang: ${width}px` },
        })
      );
      const start = line.from + item.indent.length;
      builder.add(start, start + item.marker.length, LIST_MARK);
    }
  });
  return builder.finish();
}

function listEditorExtensions() {
  const decorations = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.measure = listMeasurer(view);
        this.decorations = listDecorations(view, this.measure);
      }

      update(u) {
        if (u.geometryChanged) this.measure = listMeasurer(u.view);
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.geometryChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          this.decorations = listDecorations(u.view, this.measure);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
  // Ahead of Obsidian's own list handling, which would otherwise take
  // Enter and start a plain line.
  return [Prec.highest(keymap.of([{ key: 'Enter', run: listEnter }])), decorations];
}

/* -- reading view ------------------------------------------------------- */

const LIST_BLOCKS = new Set([
  'UL', 'OL', 'P', 'DIV', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'DETAILS',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

/** Obsidian's own furniture at the start of a list item. */
function isListFurniture(node) {
  return (
    node.nodeType === 1 &&
    (node.classList.contains('list-bullet') ||
      node.classList.contains('list-collapse-indicator') ||
      node.classList.contains('collapse-indicator'))
  );
}

/**
 * An element's text as the lines it was written in. Obsidian renders a
 * single line break as <br>, so a list typed one item per line arrives
 * as one paragraph with a <br> between items. Stops at the first block,
 * such as a list nested under an item.
 */
function renderedLines(container) {
  const lines = [{ br: null, nodes: [] }];
  let stop = null;
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 1 && node.tagName === 'BR') {
      lines.push({ br: node, nodes: [] });
      continue;
    }
    if (node.nodeType === 1 && !isListFurniture(node) && LIST_BLOCKS.has(node.tagName)) {
      stop = node;
      break;
    }
    lines[lines.length - 1].nodes.push(node);
  }
  return { lines, stop };
}

/**
 * The item a rendered line starts, if its marker is plain text. One in
 * bold, a link or code was written that way on purpose and is left be.
 */
function renderedItem(line, prev) {
  const first = line.nodes.find(
    (n) => !isListFurniture(n) && !(n.nodeType === 3 && !n.textContent.trim())
  );
  if (!first || first.nodeType !== 3) return null;
  const own = first.textContent.replace(/^\s+/, '');
  if (!LIST_HINT.test(own)) return null;
  const text = line.nodes
    .filter((n) => !isListFurniture(n))
    .map((n) => n.textContent)
    .join('')
    .replace(/^\s+/, '');
  const item = parseListItem(text, prev);
  if (!item || item.indent) return null;
  // Content can be an element with no text of its own — an image, an
  // embed, maths — which still makes the line an item.
  const more = line.nodes.some(
    (n) => n !== first && n.nodeType === 1 && !isListFurniture(n) && n.tagName !== 'BR'
  );
  if (!text.slice(item.prefix).trim() && !more) return null;
  if (own.length < item.prefix) return null;
  return Object.assign(item, { textNode: first, own: own });
}

/** A rough width for the gutter, so the longest marker fits it. */
function listGutter(markers) {
  const narrow = { i: 0.28, l: 0.28, j: 0.28, f: 0.3, t: 0.33, r: 0.36, I: 0.3, J: 0.5 };
  const wide = { m: 0.83, w: 0.75, M: 0.83, W: 0.95 };
  const widthOf = (ch) => {
    if (narrow[ch]) return narrow[ch];
    if (wide[ch]) return wide[ch];
    if (ch === '.' ) return 0.28;
    if (ch === ')' || ch === '(') return 0.33;
    return ch === ch.toUpperCase() ? 0.68 : 0.52;
  };
  const longest = Math.max(
    ...markers.map((m) => Array.from(m).reduce((sum, ch) => sum + widthOf(ch), 0))
  );
  return `max(var(--list-indent, 2.25em), ${(longest + 0.6).toFixed(2)}em)`;
}

/**
 * Turn the lettered lines in a paragraph or list item into lists. From
 * the first item on, every line is either an item or text continuing
 * the one above; lines before the first stay as they were. In a list
 * item its own first line is its text, never an item — "- a. something"
 * is a bullet that happens to start with a letter.
 *
 * `before` is the item above the first line in the note's source, when
 * that's known, so a list with blank lines between its items — where
 * each item is drawn on its own — still counts on from the last.
 */
function convertListLines(container, before) {
  const inItem = container.tagName === 'LI';
  const { lines, stop } = renderedLines(container);
  const doc = container.ownerDocument;
  const lists = [];
  let ol = null;
  let li = null;
  let like = null;
  let prev = before || null;

  for (let i = inItem ? 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    const item = renderedItem(line, prev);
    if (!item && !li) {
      // Only the very first line can follow on from the source.
      prev = null;
      continue;
    }

    if (!item) {
      if (line.br) li.appendChild(line.br);
      line.nodes.forEach((n) => li.appendChild(n));
      continue;
    }

    if (line.br) line.br.remove();
    if (!ol || !sameListStyle(item, like)) {
      ol = doc.createElement('ol');
      ol.className = [
        'dr-marked-list',
        item.kind === 'alpha' ? 'is-alpha' : 'is-roman',
        item.upper ? 'is-upper' : 'is-lower',
      ].join(' ');
      lists.push(ol);
      like = item;
    }
    li = ol.appendChild(doc.createElement('li'));
    li.className = 'dr-marked-item';
    li.setAttribute('value', String(item.value));
    const marker = li.appendChild(doc.createElement('span'));
    marker.className = 'dr-list-marker';
    marker.textContent = item.marker;

    // The marker comes out of the text; the rest moves in whole, so
    // links, bold and embeds keep working.
    item.textNode.textContent = item.own.slice(item.prefix);
    let started = false;
    line.nodes.forEach((n) => {
      if (n === item.textNode) started = true;
      // Only the line break's own whitespace, before the marker, goes;
      // spaces between words and formatting stay.
      if (!started && n.nodeType === 3) return;
      li.appendChild(n);
    });
    prev = item;
  }

  if (!lists.length) return false;
  lists.forEach((list) => {
    const markers = Array.from(list.querySelectorAll(':scope > li > .dr-list-marker')).map(
      (m) => m.textContent
    );
    list.style.setProperty('--dr-list-gutter', listGutter(markers));
  });

  if (inItem) {
    lists.forEach((list) => container.insertBefore(list, stop));
  } else {
    container.after(...lists);
    if (
      !container.textContent.trim() &&
      !container.querySelector('img, iframe, video, audio, .internal-embed')
    ) {
      container.remove();
    }
  }
  return true;
}

/**
 * The post-processor: every paragraph and list item in a rendered
 * block. A paragraph that is the whole block starts on a known line of
 * the note, so the item above it can be found in the source.
 */
function renderLists(el, ctx) {
  const containers = Array.from(el.querySelectorAll('p, li'));
  if (el.matches && el.matches('p, li')) containers.unshift(el);

  const sourceAbove = (container) => {
    if (container.tagName !== 'P' || container.parentElement !== el) return null;
    if (container !== el.firstElementChild) return null;
    if (!ctx || typeof ctx.getSectionInfo !== 'function') return null;
    return () => {
      const info = ctx.getSectionInfo(el);
      if (!info || typeof info.text !== 'string') return null;
      const source = info.text.split('\n');
      const doc = { line: (n) => ({ text: source[n - 1] || '' }) };
      const indent = leadingSpace(source[info.lineStart] || '');
      return listItemAbove(doc, info.lineStart + 1, indent);
    };
  };

  containers
    .filter((c) => !c.closest('pre, code, table, .callout-title, .dr-marked-list'))
    .forEach((c) => convertListLines(c, sourceAbove(c)));
}

class MarkedLists extends Feature {
  constructor(plugin) {
    super(plugin);
    // Registered once, filled and emptied: the way to switch an editor
    // extension on and off without registering it again.
    this.extensions = [];
    this.state = null;
  }

  /** On if either kind is. */
  get enabled() {
    return !!(this.settings.letterLists || this.settings.romanLists);
  }

  settingsSchema() {
    return [
      {
        key: 'letterLists',
        name: 'Lettered lists',
        desc: 'Treat lines starting a., b) or (c) as a list: drawn as one in reading view, and continued with the next letter when you press Enter.',
      },
      {
        key: 'romanLists',
        name: 'Roman numeral lists',
        desc: 'The same for i., ii) or (iii).',
      },
    ];
  }

  registerTypes() {
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (this.enabled) renderLists(el, ctx);
    });
  }

  enable() {
    this.apply(true);
  }

  disable() {
    this.apply(false);
  }

  /**
   * Also runs when either setting changes while the other stays on, so
   * editors and open notes are redrawn for the kinds now recognised.
   */
  apply(on) {
    const state = on ? `${!!this.settings.letterLists}/${!!this.settings.romanLists}` : 'off';
    if (this.state === state) return;
    const first = this.state === null;
    this.state = state;

    LIST_KINDS.alpha = !!this.settings.letterLists;
    LIST_KINDS.roman = !!this.settings.romanLists;
    this.extensions.length = 0;
    if (on) this.extensions.push(listEditorExtensions());
    this.app.workspace.updateOptions();
    // Notes already drawn were drawn with the old settings.
    if (!first || !on) this.rerender();
  }

  rerender() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.previewMode) return;
      if (typeof view.previewMode.rerender === 'function') view.previewMode.rerender(true);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Superscript and subscript                                           */
/*                                                                     */
/* Markdown has neither. Two spellings are read: the short one that    */
/* Pandoc and many editors use — x^2^ and H~2~O — and the <sup> and    */
/* <sub> tags, which Obsidian draws in reading view but leaves flat    */
/* while you edit. Both are raised and lowered in the editor, the      */
/* short one in reading view and exports too, and two commands put     */
/* either in place around the selection or take it off again. The      */
/* note's text is only what you wrote, so other apps read the same.    */
/* ------------------------------------------------------------------ */

const SCRIPT_MARKS = {
  sup: { short: '^', open: '<sup>', close: '</sup>', label: 'Superscript', icon: 'superscript' },
  sub: { short: '~', open: '<sub>', close: '</sub>', label: 'Subscript', icon: 'subscript' },
};

/*
 * x^2^ — no spaces inside, as in Pandoc, so "x^2 + y^2" stays as it is;
 * and not a footnote [^1], a link to a block #^id or an inline note ^[…].
 * The character before is matched, not looked behind at: iPhones and
 * iPads before iOS 16.4 can't read lookbehind, and one pattern they
 * can't read would stop the whole plugin loading there.
 */
const SUP_SHORT = /(^|[^\\[#^])\^((?:\\.|[^\s^\\[\]])+)\^/g;
/* H~2~O — one tilde each side, so ~~strikethrough~~ is left alone. */
const SUB_SHORT = /(^|[^\\~])~(?!~)((?:\\.|[^\s~\\])+)~(?!~)/g;
/* <sup>…</sup> and <sub>…</sub> with nothing else inside. */
const SCRIPT_TAG = /<(sup|sub)>([^<>\n]*?)<\/\1>/gi;
/* A web address, whose ~ and ^ are its own. */
const BARE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/gi;
/* Inline maths, whose ^ and ~ are TeX's. */
const INLINE_MATH = /(^|[^\\$])\$(?=\S)([^$\n]*?[^$\s])\$(?![\d$])/g;

/**
 * The superscripts and subscripts in one line of text, in either
 * spelling: { kind, syntax, from, to, innerFrom, innerTo }. Where two
 * overlap the outer one counts, and none is inside inline maths or
 * a web address.
 */
function scriptSpans(text) {
  if (!/[\^~]|<su[pb]>/i.test(text)) return [];
  const found = [];
  const maths = [];
  const collect = (re, into, make) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) into.push(make(m));
  };
  // `lead` is the character matched before the marker, which isn't part of it.
  const span = (m, kind, syntax, open, close, lead = 0) => ({
    kind,
    syntax,
    from: m.index + lead,
    to: m.index + m[0].length,
    innerFrom: m.index + lead + open,
    innerTo: m.index + m[0].length - close,
  });
  collect(SUP_SHORT, found, (m) => span(m, 'sup', 'short', 1, 1, m[1].length));
  collect(SUB_SHORT, found, (m) => span(m, 'sub', 'short', 1, 1, m[1].length));
  collect(SCRIPT_TAG, found, (m) => span(m, m[1].toLowerCase(), 'html', 5, 6));
  collect(INLINE_MATH, maths, (m) => ({ from: m.index + m[1].length, to: m.index + m[0].length }));
  collect(BARE_URL, maths, (m) => ({ from: m.index, to: m.index + m[0].length }));
  const inMaths = (s) => maths.some((r) => s.from < r.to && s.to > r.from);
  const spans = found.filter((s) => !inMaths(s));
  spans.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept = [];
  let end = -1;
  spans.forEach((s) => {
    if (s.from >= end) {
      kept.push(s);
      end = s.to;
    }
  });
  return kept;
}

/**
 * The markers to write around text in a line: the short ones when
 * they'd be read back as this — no spaces, nothing next to them that
 * makes them something else — or the tags otherwise, or when asked.
 */
function scriptSpelling(kind, lineText, a, b, html) {
  const marks = SCRIPT_MARKS[kind];
  if (!html) {
    const inner = lineText.slice(a, b) || 'x';
    const trial = lineText.slice(0, a) + marks.short + inner + marks.short + lineText.slice(b);
    const end = a + inner.length + 2;
    const reads = scriptSpans(trial).some(
      (s) => s.kind === kind && s.syntax === 'short' && s.from === a && s.to === end
    );
    if (reads) return [marks.short, marks.short];
  }
  return [marks.open, marks.close];
}

/**
 * Superscript or subscript on or off for each selection, as Bold is:
 * text inside one comes out of it, one of the other kind changes kind,
 * and anything else is wrapped — the selection trimmed of spaces at
 * its ends, each line of a longer one on its own. With nothing
 * selected the markers go in with the cursor between them.
 */
function toggleScript(state, kind, html) {
  const doc = state.doc;
  return state.changeByRange((range) => {
    const first = doc.lineAt(range.from);
    const last = doc.lineAt(range.to);

    if (first.number === last.number) {
      const hit = scriptSpans(first.text)
        .map((s) =>
          Object.assign({}, s, {
            from: s.from + first.from,
            to: s.to + first.from,
            innerFrom: s.innerFrom + first.from,
            innerTo: s.innerTo + first.from,
          })
        )
        .find((s) => s.from <= range.from && range.to <= s.to);
      if (hit) {
        const openLen = hit.innerFrom - hit.from;
        const clamp = (p) => Math.min(Math.max(p, hit.innerFrom), hit.innerTo);
        if (hit.kind === kind) {
          return {
            changes: [
              { from: hit.from, to: hit.innerFrom },
              { from: hit.innerTo, to: hit.to },
            ],
            range: EditorSelection.range(clamp(range.anchor) - openLen, clamp(range.head) - openLen),
          };
        }
        // The other kind: new markers, in the same spelling where it reads.
        const inner = doc.sliceString(hit.innerFrom, hit.innerTo);
        const at = hit.from - first.from;
        const bare = first.text.slice(0, at) + inner + first.text.slice(hit.to - first.from);
        const [open, close] = scriptSpelling(kind, bare, at, at + inner.length, html || hit.syntax === 'html');
        const shift = open.length - openLen;
        return {
          changes: [
            { from: hit.from, to: hit.innerFrom, insert: open },
            { from: hit.innerTo, to: hit.to, insert: close },
          ],
          range: EditorSelection.range(clamp(range.anchor) + shift, clamp(range.head) + shift),
        };
      }
    }

    const changes = [];
    let shift = 0;
    let selFrom = null;
    let selTo = null;
    for (let n = first.number; n <= last.number; n++) {
      const line = doc.line(n);
      let a = Math.max(line.from, range.from);
      let b = Math.min(line.to, range.to);
      const seg = doc.sliceString(a, b);
      if (seg.trim()) {
        a += seg.length - seg.trimStart().length;
        b -= seg.length - seg.trimEnd().length;
      } else if (!range.empty) {
        continue;
      }
      const [open, close] = scriptSpelling(kind, line.text, a - line.from, b - line.from, html);
      changes.push({ from: a, insert: open }, { from: b, insert: close });
      if (selFrom === null) selFrom = a + shift + open.length;
      shift += open.length + close.length;
      selTo = b + shift - close.length;
    }
    if (!changes.length) return { range };
    return { changes, range: EditorSelection.range(selFrom, selTo) };
  });
}

/** The superscript or subscript a selection is inside, if it's in one. */
function scriptAt(state, range) {
  const line = state.doc.lineAt(range.from);
  if (range.to > line.to) return null;
  const a = range.from - line.from;
  const b = range.to - line.from;
  return scriptSpans(line.text).find((s) => s.from <= a && b <= s.to) || null;
}

/** Whether Obsidian's editor is showing Live Preview rather than the source. */
function scriptLivePreview(state) {
  try {
    return !!editorLivePreviewField && state.field(editorLivePreviewField, false) === true;
  } catch (err) {
    return false;
  }
}

/** Code, maths, links, comments and frontmatter keep their ^ and ~ as they are. */
function scriptIgnored(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/code|frontmatter|math|comment|url|link|footref|blockid/i.test(node.name)) return true;
  }
  return false;
}

const SCRIPT_HIDE = Decoration.replace({});
const SCRIPT_MARK = Decoration.mark({ class: 'dr-script-mark' });
const SCRIPT_TEXT = {
  sup: Decoration.mark({ class: 'dr-sup' }),
  sub: Decoration.mark({ class: 'dr-sub' }),
};

/**
 * Raised and lowered text for what's on screen. In Live Preview the
 * short markers are hidden until the cursor reaches them, as **bold**'s
 * are; in source mode, and for the tags, they're shown faintly.
 */
function scriptDecorations(view) {
  const state = view.state;
  const live = scriptLivePreview(state);
  const ranges = state.selection.ranges;
  const touched = (from, to) => ranges.some((r) => r.from <= to && r.to >= from);
  const builder = new RangeSetBuilder();
  let lastLine = 0;
  for (const visible of view.visibleRanges) {
    let pos = visible.from;
    while (pos <= visible.to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine) continue;
      lastLine = line.number;
      scriptSpans(line.text).forEach((s) => {
        const from = line.from + s.from;
        const to = line.from + s.to;
        const innerFrom = line.from + s.innerFrom;
        const innerTo = line.from + s.innerTo;
        if (scriptIgnored(state, s.syntax === 'html' ? innerFrom : from)) return;
        const hide = live && s.syntax === 'short' && !touched(from, to);
        builder.add(from, innerFrom, hide ? SCRIPT_HIDE : SCRIPT_MARK);
        if (innerTo > innerFrom) builder.add(innerFrom, innerTo, SCRIPT_TEXT[s.kind]);
        builder.add(innerTo, to, hide ? SCRIPT_HIDE : SCRIPT_MARK);
      });
    }
  }
  return builder.finish();
}

function scriptEditorExtension() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = scriptDecorations(view);
      }

      update(u) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          syntaxTree(u.startState) !== syntaxTree(u.state) ||
          scriptLivePreview(u.startState) !== scriptLivePreview(u.state)
        ) {
          this.decorations = scriptDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/* -- ordinals as you type ------------------------------------------------- */

/** The suffix a number takes: 1st, 2nd, 3rd, 4th, 11th, 21st, 112th. */
function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

/* What ends a word, so the ordinal before it is finished. */
const ORDINAL_ENDS = [' ', '.', ',', ';', ':', '!', '?'];

/**
 * The ordinal just before a position — "21st" — if it's a real one and
 * written plainly: not "1th", not part of a longer word, not already
 * raised. { from, to, suffix } for the suffix, or null.
 */
function ordinalBefore(text) {
  const m = /(^|[^\p{L}\p{N}_^~>])(\d{1,6})(st|nd|rd|th)$/iu.exec(text);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (m[3] !== m[3].toLowerCase() || ordinalSuffix(n) !== m[3]) return null;
  const to = text.length;
  return { from: to - m[3].length, to, suffix: m[3] };
}

/**
 * Typing a space or punctuation after an ordinal raises its suffix:
 * 1st → 1^st^, or 1<sup>st</sup> when the tags are the chosen form. The
 * space goes in first and the change after it, as a step of its own, so
 * undo takes the change back and leaves what was typed.
 */
function ordinalInput(getHtml) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing || ORDINAL_ENDS.indexOf(text) === -1 || from !== to) return false;
    const state = view.state;
    if (state.selection.ranges.length !== 1) return false;
    const line = state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from);
    const found = ordinalBefore(before);
    if (!found) return false;
    // Inside code or maths still being typed — a ` or $ not yet closed —
    // which the editor can't know is code or maths until it is.
    const unclosed = (re) => (before.replace(/\\./g, '').match(re) || []).length % 2 === 1;
    if (unclosed(/`/g) || unclosed(/\$/g)) return false;
    const start = line.from + found.from;
    if (scriptIgnored(state, start) || scriptSpans(line.text).some((s) => s.from <= found.from && found.to <= s.to)) {
      return false;
    }
    const html = getHtml();
    const open = html ? '<sup>' : '^';
    const close = html ? '</sup>' : '^';
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input.type',
    });
    view.dispatch({
      changes: [
        { from: start, insert: open },
        { from: line.from + found.to, insert: close },
      ],
      userEvent: 'input.autoformat',
    });
    return true;
  });
}

/* Where ^ and ~ are something else in reading view. */
const SCRIPT_SKIP =
  'code, pre, kbd, samp, script, style, textarea, sup, sub, .math, mjx-container, .frontmatter, .dr-list-marker';

/**
 * The short spellings drawn as <sup> and <sub> in reading view. The
 * text there has lost its backslashes, so each one is checked against
 * the note's source when it's at hand: \^2\^ was written to stay flat.
 */
function renderScripts(el, ctx) {
  if (!/[\^~]/.test(el.textContent || '')) return;
  let source = null;
  const sourceText = () => {
    if (source !== null) return source;
    source = '';
    try {
      const info = ctx && typeof ctx.getSectionInfo === 'function' ? ctx.getSectionInfo(el) : null;
      if (info && typeof info.text === 'string') {
        source = info.text.split('\n').slice(info.lineStart, info.lineEnd + 1).join('\n');
      }
    } catch (err) {
      source = '';
    }
    return source;
  };
  const written = (raw) => {
    const text = sourceText();
    if (!text) return true;
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\\\])${escaped}`).test(text);
  };

  const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const text = node.data;
    if (!/[\^~]/.test(text)) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SCRIPT_SKIP)) return;
    const link = parent.closest('a');
    if (link && /:\/\//.test(link.textContent || '')) return;
    const spans = scriptSpans(text).filter(
      (s) => s.syntax === 'short' && written(text.slice(s.from, s.to))
    );
    if (!spans.length) return;
    const frag = document.createDocumentFragment();
    let at = 0;
    spans.forEach((s) => {
      if (s.from > at) frag.appendChild(document.createTextNode(text.slice(at, s.from)));
      const tag = document.createElement(s.kind);
      tag.className = 'dr-script';
      tag.textContent = text.slice(s.innerFrom, s.innerTo).replace(/\\(.)/g, '$1');
      frag.appendChild(tag);
      at = s.to;
    });
    if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
    node.parentNode.replaceChild(frag, node);
  });
}

/** Redraw open notes in reading view, after what they're drawn with has changed. */
function rerenderReading(app) {
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.previewMode) return;
    if (typeof view.previewMode.rerender === 'function') view.previewMode.rerender(true);
  });
}

class Scripts extends Feature {
  constructor(plugin) {
    super(plugin);
    // Registered once, filled and emptied, as the list extensions are.
    this.extensions = [];
    this.on = null;
  }

  settingsSchema() {
    return [
      {
        key: 'scripts',
        name: 'Raise and lower',
        desc: 'Show x^2^ and H~2~O as superscript and subscript, in the editor and in reading view. The Superscript and Subscript commands add and remove them.',
      },
      {
        key: 'scriptSyntax',
        type: 'dropdown',
        showIf: 'scripts',
        name: 'Write them as',
        desc: 'What the commands write. The short form reads well as plain text; tags work without this plugin. Text with spaces always gets tags.',
        options: { short: 'x^2^ and H~2~O', html: '<sup> and <sub> tags' },
      },
      {
        key: 'autoOrdinals',
        showIf: 'scripts',
        name: 'Raise ordinals as you type',
        desc: 'Raise the ending of 1st, 2nd or 3rd as you type it. Undo straight after puts it back.',
      },
    ];
  }

  commands() {
    return ['sup', 'sub'].map((kind) => ({
      id: kind === 'sup' ? 'superscript' : 'subscript',
      name: SCRIPT_MARKS[kind].label,
      icon: SCRIPT_MARKS[kind].icon,
      hotkeys: scriptHotkeys(kind),
      check: () => this.enabled && !!this.editorView(),
      run: () => this.toggle(this.editorView(), kind),
    }));
  }

  /** The editor of the note being edited, if one is. */
  editorView() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || (typeof view.getMode === 'function' && view.getMode() !== 'source')) return null;
    const cm = view.editor && view.editor.cm;
    return cm && cm.state && typeof cm.dispatch === 'function' ? cm : null;
  }

  toggle(cm, kind) {
    if (!cm) return;
    const spec = toggleScript(cm.state, kind, this.settings.scriptSyntax === 'html');
    cm.dispatch(Object.assign(spec, { scrollIntoView: true, userEvent: 'input' }));
    if (typeof cm.focus === 'function') cm.focus();
  }

  registerTypes() {
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (this.enabled) renderScripts(el, ctx);
    });
  }

  /** In the editor's right-click menu, with text selected or the cursor in one already. */
  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        const cm = editor && editor.cm;
        if (!this.enabled || !cm || !cm.state) return;
        const range = cm.state.selection.main;
        const inside = scriptAt(cm.state, range);
        if (range.empty && !inside) return;
        // With Obsidian's own Format entries, where they can be found;
        // otherwise beside them.
        const format = findSubmenu(menu, 'Format');
        const into = format || menu;
        ['sup', 'sub'].forEach((kind) =>
          into.addItem((item) => {
            const marks = SCRIPT_MARKS[kind];
            item
              .setTitle(inside && inside.kind === kind ? `Remove ${marks.label.toLowerCase()}` : marks.label)
              .setIcon(marks.icon)
              .onClick(() => this.toggle(cm, kind));
            if (!format && typeof item.setSection === 'function') item.setSection('selection');
          })
        );
      })
    );
  }

  enable() {
    this.apply(true);
  }

  disable() {
    this.apply(false);
  }

  apply(on) {
    // Ordinals follow their own setting, so it counts in whether to rebuild.
    const state = on ? `on/${!!this.settings.autoOrdinals}` : 'off';
    if (this.on === state) return;
    const first = this.on === null;
    const wasOn = !!this.on && this.on !== 'off';
    this.on = state;
    this.extensions.length = 0;
    if (on) {
      this.extensions.push(scriptEditorExtension());
      if (this.settings.autoOrdinals) {
        this.extensions.push(ordinalInput(() => this.settings.scriptSyntax === 'html'));
      }
    }
    this.app.workspace.updateOptions();
    if (!first && wasOn !== on) rerenderReading(this.app);
    else if (!first && !on) rerenderReading(this.app);
  }
}

/**
 * Default keys that nothing in Obsidian already uses: on a Mac, Pages'
 * own — Control-Command-= and Control-Command-hyphen; elsewhere Alt with
 * the same keys, since Ctrl+= and Ctrl+- zoom.
 */
function scriptHotkeys(kind) {
  const key = kind === 'sup' ? '=' : '-';
  return Platform.isMacOS ? [{ modifiers: ['Mod', 'Ctrl'], key }] : [{ modifiers: ['Alt'], key }];
}

Scripts.settingKey = 'scripts';

/* ------------------------------------------------------------------ */
/* Bulk edits                                                          */
/*                                                                     */
/* Properties added to every note in a set of folders at once, and a   */
/* property or tag renamed wherever it's used: in notes' properties    */
/* and text, in bases, and in this plugin's own settings. Each change  */
/* is recorded file by file as it's made, so the last one can be       */
/* undone for as long as those files haven't been edited since.        */
/* ------------------------------------------------------------------ */

/* Property types whose value is a list. */
const LIST_TYPES = ['multitext', 'tags', 'aliases'];

/* The properties Obsidian reads tags from. */
const TAG_KEYS = ['tags', 'tag'];

/* Returned by mergeValues when two values can't become one. */
const CONFLICT = Object.freeze({ conflict: true });

/** Whether a frontmatter value holds nothing. */
function isBlank(value) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A list with repeats taken out, text compared ignoring case and a leading #. */
function uniqueList(items) {
  const seen = new Set();
  return items.filter((v) => {
    const k =
      typeof v === 'string' ? v.trim().replace(/^#/, '').toLowerCase() : JSON.stringify(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A key of the note's that is `name`, whatever case either is written in. */
function keyLike(fm, name) {
  const want = String(name).toLowerCase();
  return Object.keys(fm).find((k) => k !== 'position' && k.toLowerCase() === want);
}

/** A property's type as Obsidian has it: assigned, or else inferred. */
function propertyType(app, key) {
  try {
    const info = app.metadataTypeManager.getTypeInfo(key);
    const t =
      (info && info.expected && info.expected.type) ||
      (info && info.inferred && info.inferred.type);
    if (t && TYPE_ICONS[t]) return t;
  } catch (err) {
    /* fall through */
  }
  const name = String(key || '').toLowerCase();
  return name === 'tags' ? 'tags' : name === 'aliases' ? 'aliases' : 'text';
}

/** Whether a property has a type assigned, not just one inferred from its values. */
function assignedType(app, key) {
  try {
    const info = app.metadataTypeManager.getTypeInfo(key);
    const t = info && info.expected && info.expected.type;
    return t && TYPE_ICONS[t] ? t : null;
  } catch (err) {
    return null;
  }
}

/**
 * What a typed value becomes in the note: a list split at commas, a
 * number, a checkbox's true or false, or text. Nothing typed is an
 * empty property, as Obsidian's own Add property leaves one.
 */
function parseTypedValue(type, raw) {
  if (type === 'checkbox') return raw === true || raw === 'true';
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!text) return null;
  if (LIST_TYPES.indexOf(type) !== -1) {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    return uniqueList(type === 'tags' ? parts.map((p) => p.replace(/^#/, '')) : parts);
  }
  if (type === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

/**
 * Add properties to one note's frontmatter. One the note already has
 * keeps its value unless `replace` — except a list, which takes the
 * new items as well. Names match whatever case the note wrote them in.
 * Returns whether anything changed.
 */
function addPropertiesTo(fm, props, replace) {
  let changed = false;
  props.forEach(({ key, value }) => {
    const have = keyLike(fm, key);
    if (have === undefined) {
      fm[key] = value;
      changed = true;
      return;
    }
    const current = fm[have];
    if (isBlank(current) && isBlank(value)) return;
    let next = current;
    if (replace || isBlank(current)) {
      next = value;
    } else if (Array.isArray(value) && !isBlank(value)) {
      // A list written as text — "tags: a, b" — is still a list.
      const list = Array.isArray(current)
        ? current
        : typeof current === 'string'
          ? current.split(TAG_KEYS.indexOf(have.toLowerCase()) !== -1 ? /[,\s]+/ : /,/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [current];
      next = uniqueList(list.concat(value));
    } else if (Array.isArray(current) && !isBlank(value)) {
      next = uniqueList(current.concat([value]));
    }
    if (!sameValue(next, current)) {
      fm[have] = next;
      changed = true;
    }
  });
  return changed;
}

/**
 * Several values of what's becoming one property, as one value: the
 * one they share, or a list holding them all when the first is a list.
 * Anything else can't be decided here, and is CONFLICT.
 */
function mergeValues(values) {
  const full = values.filter((v) => !isBlank(v));
  if (!full.length) {
    const kept = values.find((v) => v !== undefined);
    return kept === undefined ? null : kept;
  }
  if (full.every((v) => sameValue(v, full[0]))) return full[0];
  if (Array.isArray(full[0])) return uniqueList([].concat(...full));
  return CONFLICT;
}

/**
 * Rename a property in one note's frontmatter, keeping its place. If
 * the note already has the new name, the two become one where their
 * values allow it; otherwise the note is left as it was.
 *
 * Returns 'absent', 'same', 'renamed', 'merged' or 'conflict'.
 */
function renamePropertyIn(fm, from, to) {
  const low = (s) => String(s).toLowerCase();
  const keys = Object.keys(fm).filter((k) => k !== 'position');
  const olds = keys.filter((k) => low(k) === low(from));
  if (!olds.length) return 'absent';
  // A change of case is the same property, so there's nothing to merge.
  const targets = low(from) === low(to) ? [] : keys.filter((k) => low(k) === low(to));
  if (olds.length === 1 && !targets.length && olds[0] === to) return 'same';

  const involved = targets.concat(olds);
  const merged = mergeValues(involved.map((k) => fm[k]));
  if (merged === CONFLICT) return 'conflict';

  const first = keys.find((k) => involved.indexOf(k) !== -1);
  const entries = keys.map((k) => [k, fm[k]]);
  keys.forEach((k) => delete fm[k]);
  entries.forEach(([k, v]) => {
    if (k === first) fm[to] = merged;
    else if (involved.indexOf(k) === -1) fm[k] = v;
  });
  return involved.length > 1 ? 'merged' : 'renamed';
}

/** Whether a tag is `from` or nested beneath it, ignoring case and #. */
function tagUnder(tag, from) {
  const t = String(tag).trim().replace(/^#/, '').toLowerCase();
  const f = String(from).replace(/^#/, '').toLowerCase();
  return !!f && (t === f || t.startsWith(f + '/'));
}

/** A tag renamed, keeping its # if it had one and what's nested beneath as written. */
function renameTagText(tag, from, to) {
  const text = String(tag).trim();
  if (!tagUnder(text, from)) return tag;
  const hash = text.startsWith('#') ? '#' : '';
  const bare = text.replace(/^#/, '');
  return hash + to + bare.slice(String(from).replace(/^#/, '').length);
}

/** A tags property's value with one tag renamed, as a list or as the text it was. */
function renameTagsValue(value, from, to) {
  if (Array.isArray(value)) {
    const out = value.map((v) =>
      typeof v === 'string' && tagUnder(v, from) ? renameTagText(v, from, to) : v
    );
    return uniqueList(out);
  }
  if (typeof value === 'string') {
    return value.replace(/(^|[\s,])(#?[^\s,]+)/g, (m, lead, tag) =>
      lead + renameTagText(tag, from, to)
    );
  }
  return value;
}

/** Rename a tag in a note's tags properties. Returns whether anything changed. */
function renameTagIn(fm, from, to) {
  let changed = false;
  Object.keys(fm).forEach((k) => {
    if (TAG_KEYS.indexOf(k.toLowerCase()) === -1) return;
    const next = renameTagsValue(fm[k], from, to);
    if (!sameValue(next, fm[k])) {
      fm[k] = next;
      changed = true;
    }
  });
  return changed;
}

/** Whether a note's tags properties carry a tag, or one beneath it. */
function fmHasTag(fm, from) {
  if (!fm) return false;
  return Object.keys(fm).some((k) => {
    if (TAG_KEYS.indexOf(k.toLowerCase()) === -1) return false;
    const raw = fm[k];
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
    return list.some((t) => typeof t === 'string' && tagUnder(t, from));
  });
}

/**
 * Rename tags in a note's text at the places Obsidian found them, which
 * already leaves out code, links and headings. Each place is checked
 * against the text first; if one doesn't match, the cache is behind
 * the file, and null says so rather than guessing.
 */
function renameTagsAt(text, spots, from, to) {
  let out = text;
  const sorted = spots.slice().sort((a, b) => b.start - a.start);
  for (const s of sorted) {
    const found = out.slice(s.start, s.end);
    if (found.toLowerCase() !== String(s.tag).toLowerCase()) return null;
    out = out.slice(0, s.start) + renameTagText(found, from, to) + out.slice(s.end);
  }
  return out;
}

/** A note's tags in its text that are `from` or beneath it, with where they are. */
function tagSpots(cache, from) {
  return ((cache && cache.tags) || [])
    .filter((t) => t && t.position && tagUnder(t.tag, from))
    .map((t) => ({ tag: t.tag, start: t.position.start.offset, end: t.position.end.offset }));
}

/** Why a tag name can't be used, or '' if it can. */
function tagNameProblem(name) {
  const t = String(name || '').trim().replace(/^#/, '');
  if (!t) return 'Type the new name.';
  if (/\s/.test(t)) return "A tag can't contain spaces.";
  if (/[#.,;:!?'"()[\]{}@$%^&*+=<>|\\~`]/.test(t)) {
    return 'A tag can only use letters, numbers, - , _ and / .';
  }
  if (/^\/|\/$|\/\//.test(t)) return 'Each part of a nested tag needs a name.';
  if (/^[0-9/]+$/.test(t)) return 'A tag needs at least one letter.';
  return '';
}

/** Why a property name can't be used, or '' if it can. */
function propertyNameProblem(name) {
  const t = String(name || '').trim();
  if (!t) return 'Type the new name.';
  if (/[\r\n]/.test(t)) return "A property's name is one line.";
  if (t.toLowerCase() === 'position') return '"position" is kept for Obsidian\'s own use.';
  return '';
}

/* -- values, removal and types ------------------------------------------ */

/** A value as the text it's compared by. */
function valueKey(v) {
  return v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v);
}

/**
 * One value of a property renamed in a note: on its own, or as an item
 * of a list, where it joins any the list already had. A number stays a
 * number, and true or false a checkbox's value, where the new one can.
 */
function renameValueIn(fm, key, from, to) {
  const have = keyLike(fm, key);
  if (have === undefined) return false;
  const typed = (orig) => {
    if (typeof orig === 'number' && to.trim() !== '' && Number.isFinite(Number(to))) return Number(to);
    if (typeof orig === 'boolean' && /^(true|false)$/i.test(to)) return /^true$/i.test(to);
    return to;
  };
  // A link counts by what it points to, as the Properties screen shows
  // it; renamed, it points to the new name and keeps its heading and alias.
  const link = /^(!?\[\[)([^\]|#]+)(.*\]\])$/;
  const hit = (x) => {
    const text = valueKey(x);
    if (text === from) return true;
    const m = link.exec(text);
    return !!m && m[2].trim() === from;
  };
  const renamed = (x) => {
    const m = link.exec(valueKey(x));
    return m && valueKey(x) !== from ? `${m[1]}${to}${m[3]}` : typed(x);
  };
  const value = fm[have];
  if (Array.isArray(value)) {
    if (!value.some(hit)) return false;
    fm[have] = uniqueList(value.map((x) => (hit(x) ? renamed(x) : x)));
    return true;
  }
  if (!hit(value)) return false;
  fm[have] = renamed(value);
  return true;
}

/** Properties taken out of a note, whatever case it wrote them in. */
function removePropertiesFrom(fm, keys) {
  const drop = new Set(keys.map((k) => String(k).toLowerCase()));
  let changed = false;
  Object.keys(fm).forEach((k) => {
    if (k !== 'position' && drop.has(k.toLowerCase())) {
      delete fm[k];
      changed = true;
    }
  });
  return changed;
}

/** A date written any ordinary way, as YYYY-MM-DD and YYYY-MM-DDTHH:mm; null if it isn't one. */
function parseDateText(text) {
  const s = String(text || '').trim();
  if (!s || !/\d/.test(s)) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  const pad = (n) => String(n).padStart(2, '0');
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return { date, datetime: `${date}T${iso[4] || '00'}:${iso[5] || '00'}` };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { date, datetime: `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * A value converted to a type: { ok, value }, or { ok: false } where it
 * can't be without losing what it says. Nothing stays nothing.
 */
function convertValue(value, type) {
  if (isBlank(value)) return { ok: true, value };
  const list = Array.isArray(value);
  const text = list ? value.map(valueKey).join(', ') : valueKey(value);
  const single = list ? (value.length === 1 ? valueKey(value[0]) : null) : text;
  switch (type) {
    case 'multitext':
    case 'aliases':
      return { ok: true, value: list ? value : text.split(',').map((x) => x.trim()).filter(Boolean) };
    case 'tags': {
      // A tag has no spaces, so text is split at them as Obsidian reads it.
      const items = (list ? value.map(valueKey) : [text]).reduce((acc, x) => acc.concat(x.split(/[,\s]+/)), []);
      return { ok: true, value: uniqueList(items.map((x) => x.trim().replace(/^#/, '')).filter(Boolean)) };
    }
    case 'text':
      return { ok: true, value: text };
    case 'number': {
      if (typeof value === 'number') return { ok: true, value };
      const n = single === null ? NaN : Number(String(single).trim().replace(/,/g, ''));
      return single !== null && String(single).trim() !== '' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return { ok: true, value };
      const t = String(single === null ? '' : single).trim();
      if (/^(true|yes|y|1|on|done|x)$/i.test(t)) return { ok: true, value: true };
      if (/^(false|no|n|0|off)$/i.test(t)) return { ok: true, value: false };
      return { ok: false };
    }
    case 'date':
    case 'datetime': {
      const d = single === null ? null : parseDateText(single);
      return d ? { ok: true, value: type === 'date' ? d.date : d.datetime } : { ok: false };
    }
    default:
      return { ok: true, value };
  }
}

/** Every property the notes carry, with how many carry it, most first. */
function propertiesIn(app, files) {
  const counts = new Map();
  files.forEach((file) => {
    const cache = app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    Object.keys(fm).forEach((k) => {
      if (k === 'position') return;
      const low = k.toLowerCase();
      const entry = counts.get(low) || { name: k, count: 0 };
      entry.count++;
      counts.set(low, entry);
    });
  });
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || byName(a.name, b.name));
}

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* -- bases ------------------------------------------------------------ */

/*
 * A base names a note's property three ways — "status", "note.status"
 * and note["status"] — in its filters and formulas, which are
 * expressions, and in its columns, sort and grouping, which name one
 * property each. Renaming follows all of them. The words a base uses
 * for itself are never a property's bare name.
 */
const BASE_WORDS = [
  'file', 'note', 'formula', 'this', 'value', 'values', 'index',
  'true', 'false', 'null', 'undefined', 'and', 'or', 'not',
];

const isIdentifier = (s) => /^[A-Za-z_$][\w$]*$/.test(s);

/**
 * An expression with a property renamed, or a tag renamed inside the
 * text it tests for (hasTag, tags.contains). String literals are
 * skipped whole, so a word inside quotes is never taken for a name.
 * `what` is { property: [from, to] } or { tag: [from, to] }.
 */
function renameInExpression(expr, what) {
  if (typeof expr !== 'string') return expr;
  const prop = what.property;
  const tag = what.tag;
  const val = what.value;
  const lowFrom = prop ? prop[0].toLowerCase() : '';
  // A value is renamed where it's compared with its property — status ==
  // "draft", note["status"] != 'draft', status.contains("draft") — and
  // left alone anywhere else it happens to appear.
  const valKey = val ? escapeRegExp(val[0]) : '';
  const valBefore = val
    ? [
        new RegExp(`(?:^|[^\\w$.])(?:(?:note|this)\\s*\\.\\s*)?${valKey}\\s*(?:==|!=)\\s*$`, 'i'),
        new RegExp(`(?:note|this)\\s*\\[\\s*["']${valKey}["']\\s*\\]\\s*(?:==|!=)\\s*$`, 'i'),
        new RegExp(`(?:^|[^\\w$.])(?:(?:note|this)\\s*\\.\\s*)?${valKey}\\s*\\.\\s*contains(?:Any|All)?\\s*\\([^()]*$`, 'i'),
      ]
    : [];
  const valAfter = val
    ? new RegExp(`^\\s*(?:==|!=)\\s*(?:(?:note|this)\\s*\\.\\s*)?${valKey}(?![\\w$])`, 'i')
    : null;
  let out = '';
  let i = 0;
  const n = expr.length;
  const partOf = (c) => /[\w$]/.test(c || '');

  while (i < n) {
    const c = expr[i];

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && expr[j] !== c) j += expr[j] === '\\' ? 2 : 1;
      const body = expr.slice(i + 1, Math.min(j, n));
      const close = j < n ? c : '';
      let next = body;
      if (prop && /\b(note|this)\s*\[\s*$/.test(out) && body.toLowerCase() === lowFrom) {
        next = prop[1].replace(new RegExp(c, 'g'), '\\' + c);
      } else if (
        tag &&
        (/\b(hasTag|taggedWith)\s*\([^()]*$/.test(out) ||
          /\btags\s*\.\s*contains(?:Any|All)?\s*\([^()]*$/.test(out))
      ) {
        next = renameTagText(body, tag[0], tag[1]);
      } else if (
        val &&
        body === val[1] &&
        (valBefore.some((re) => re.test(out)) || valAfter.test(expr.slice(j + 1)))
      ) {
        next = val[2].replace(new RegExp(c, 'g'), '\\' + c);
      }
      out += c + next + close;
      i = j + 1;
      continue;
    }

    if (prop && /[A-Za-z_$]/.test(c) && !partOf(expr[i - 1])) {
      let j = i;
      while (j < n && partOf(expr[j])) j++;
      const word = expr.slice(i, j);
      if (word.toLowerCase() === lowFrom) {
        const dotted = /(^|[^\w$.])(note|this)\s*\.\s*$/.exec(out);
        const member = /\.\s*$/.test(out);
        const call = /^\s*\(/.test(expr.slice(j));
        const to = prop[1];
        if (dotted && !call) {
          // note.from → note.to, or note["to"] when it isn't a plain word.
          if (!isIdentifier(to)) out = out.replace(/\s*\.\s*$/, '') + `[${JSON.stringify(to)}]`;
          else out += to;
          i = j;
          continue;
        }
        if (!member && !call && BASE_WORDS.indexOf(lowFrom) === -1) {
          out += isIdentifier(to) ? to : `note[${JSON.stringify(to)}]`;
          i = j;
          continue;
        }
      }
      out += word;
      i = j;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/** One property named on its own — a column, a sort, a grouping — renamed. */
function renamePropertyId(id, from, to) {
  if (typeof id !== 'string') return id;
  const low = from.toLowerCase();
  const dotted = /^note\.(.+)$/.exec(id);
  if (dotted) return dotted[1].toLowerCase() === low ? `note.${to}` : id;
  if (/^(file|formula|this)\./.test(id)) return id;
  return id.toLowerCase() === low ? to : id;
}

/**
 * A base's settings, parsed from its YAML, with a property or a tag
 * renamed throughout. Returns a new object; the one given is untouched.
 */
function renameInBase(base, what) {
  if (!base || typeof base !== 'object') return base;
  const out = JSON.parse(JSON.stringify(base));
  const expr = (e) => renameInExpression(e, what);
  const id = (v) => (what.property ? renamePropertyId(v, what.property[0], what.property[1]) : v);

  const filters = (node) => {
    if (typeof node === 'string') return expr(node);
    if (Array.isArray(node)) return node.map(filters);
    if (node && typeof node === 'object') {
      const next = {};
      Object.keys(node).forEach((k) => (next[k] = filters(node[k])));
      return next;
    }
    return node;
  };
  const renameKeys = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const next = {};
    Object.keys(obj).forEach((k) => {
      const key = id(k);
      if (!(key in next)) next[key] = obj[k];
    });
    return next;
  };
  const byProperty = (entry) => {
    if (typeof entry === 'string') return id(entry);
    if (entry && typeof entry === 'object' && typeof entry.property === 'string') {
      return Object.assign({}, entry, { property: id(entry.property) });
    }
    return entry;
  };

  if (out.filters !== undefined) out.filters = filters(out.filters);
  if (out.formulas && typeof out.formulas === 'object') {
    Object.keys(out.formulas).forEach((k) => (out.formulas[k] = expr(out.formulas[k])));
  }
  if (out.properties) out.properties = renameKeys(out.properties);

  (Array.isArray(out.views) ? out.views : []).forEach((view) => {
    if (!view || typeof view !== 'object') return;
    if (view.filters !== undefined) view.filters = filters(view.filters);
    if (Array.isArray(view.order)) view.order = view.order.map(id);
    if (Array.isArray(view.sort)) view.sort = view.sort.map(byProperty);
    if (view.groupBy !== undefined) view.groupBy = byProperty(view.groupBy);
    if (view.summaries) view.summaries = renameKeys(view.summaries);
    // Anything else naming a property outright: a card's image, a map's place.
    Object.keys(view).forEach((k) => {
      if (['name', 'type', 'filters', 'order', 'sort', 'groupBy', 'summaries'].indexOf(k) !== -1) return;
      if (typeof view[k] === 'string' && /^note\./.test(view[k])) view[k] = id(view[k]);
    });
  });
  return out;
}

/**
 * A base's YAML with the rename applied, or null if nothing in it
 * changed — so a base that doesn't mention the name is never rewritten.
 */
function renameInBaseText(text, what) {
  let parsed;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const next = renameInBase(parsed, what);
  if (sameValue(next, parsed)) return null;
  return stringifyYaml(next);
}

/* A base written into a note as a code block. */
const BASE_BLOCK = /^([ \t]*)(`{3,}|~{3,})[ \t]*base[ \t]*$/;

/** A note's text with the rename applied in its base blocks, or null if none changed. */
function renameInBaseBlocks(text, what) {
  const lines = text.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const open = BASE_BLOCK.exec(lines[i]);
    if (!open) continue;
    const indent = open[1];
    const fence = open[2];
    let end = i + 1;
    while (end < lines.length && !new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`).test(lines[end])) end++;
    if (end >= lines.length) break;
    const body = lines
      .slice(i + 1, end)
      .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
      .join('\n');
    const next = renameInBaseText(body, what);
    if (next !== null) {
      const replaced = next.replace(/\n+$/, '').split('\n').map((l) => (l ? indent + l : l));
      lines.splice(i + 1, end - i - 1, ...replaced);
      end = i + 1 + replaced.length;
      changed = true;
    }
    i = end;
  }
  return changed ? lines.join('\n') : null;
}

/* -- settings --------------------------------------------------------- */

/** A comma-separated list of names with one renamed, or null if it isn't in it. */
function renameInNameList(list, from, to) {
  if (typeof list !== 'string' || !list.trim()) return null;
  const low = from.toLowerCase();
  const parts = list.split(',').map((s) => s.trim());
  if (!parts.some((p) => p.toLowerCase() === low)) return null;
  return uniqueList(parts.map((p) => (p.toLowerCase() === low ? to : p)).filter(Boolean)).join(', ');
}

/**
 * This plugin's settings with a property renamed wherever they name
 * one. Returns the labels of what changed, and a way to put each back
 * if it hasn't been changed again since.
 */
function renamePropertyInSettings(settings, from, to) {
  const low = from.toLowerCase();
  const changed = [];
  const undo = [];
  const keep = (label, get, set) => {
    const before = JSON.stringify(get());
    return (next) => {
      set(next);
      const after = JSON.stringify(get());
      if (after === before) return;
      changed.push(label);
      undo.push(() => {
        if (JSON.stringify(get()) === after) set(JSON.parse(before));
      });
    };
  };

  [
    ['coverProperty', 'Cover image property'],
    ['categoryProperty', 'Search categories'],
  ].forEach(([key, label]) => {
    if (typeof settings[key] === 'string' && settings[key].trim().toLowerCase() === low) {
      keep(label, () => settings[key], (v) => (settings[key] = v))(to);
    }
  });

  [
    ['albumColumns', 'Album columns'],
    ['tableColumns', 'Notes table columns'],
  ].forEach(([key, label]) => {
    const next = renameInNameList(settings[key], from, to);
    if (next !== null) keep(label, () => settings[key], (v) => (settings[key] = v))(next);
  });

  const sections = Array.isArray(settings.librarySections) ? settings.librarySections : [];
  const renamedSections = sections.map((section) =>
    Object.assign({}, section, {
      items: (section.items || []).map((item) =>
        item && item.kind === 'property' && String(item.key).toLowerCase() === low
          ? Object.assign({}, item, { key: to.toLowerCase() })
          : item
      ),
    })
  );
  if (!sameValue(renamedSections, sections)) {
    keep('Library', () => settings.librarySections, (v) => (settings.librarySections = v))(renamedSections);
  }

  // Graph conditions are put back one by one: an open graph re-saves
  // its own entry as soon as it follows the rename, so the entry as a
  // whole won't read as this left it by the time of an undo.
  const graphs = settings.graphFilters || {};
  const moved = [];
  Object.keys(graphs).forEach((type) => {
    const saved = graphs[type];
    if (!saved || !Array.isArray(saved.rules)) return;
    saved.rules.forEach((rule, index) => {
      if (!rule || String(rule.key || '').toLowerCase() !== low) return;
      moved.push({ type, index, key: rule.key });
      saved.rules[index] = Object.assign({}, rule, { key: to });
    });
  });
  if (moved.length) {
    changed.push('Graph property filters');
    undo.push(() =>
      moved.forEach(({ type, index, key }) => {
        const rules = settings.graphFilters && settings.graphFilters[type] && settings.graphFilters[type].rules;
        if (rules && rules[index] && rules[index].key === to) {
          rules[index] = Object.assign({}, rules[index], { key });
        }
      })
    );
  }

  return { changed, undo: () => undo.forEach((f) => f()) };
}

/* -- the service -------------------------------------------------------- */

/**
 * Plans and makes bulk changes, and keeps the last one for undoing.
 *
 * Every file is read before and after its change, and undo puts back
 * the earlier text only where the file still reads as this left it: a
 * note edited since keeps that edit, and is reported instead.
 */
class BulkEdits {
  constructor(plugin) {
    this.plugin = plugin;
    this.last = null;
    this.busy = false;
    this.baseCache = null;
  }

  get app() {
    return this.plugin.app;
  }

  /* -- what a change covers ------------------------------------------ */

  /**
   * The notes a set of folders and notes covers. scope: 'deep' (in them
   * and their subfolders), 'direct' (in them only) or 'folder-notes'.
   */
  notesFor(targets, scope) {
    const out = [];
    const add = (f) => {
      if (f instanceof TFile && f.extension === 'md' && out.indexOf(f) === -1) out.push(f);
    };
    (targets || []).forEach((target) => {
      if (target instanceof TFile) return add(target);
      if (!(target instanceof TFolder)) return;
      if (scope === 'folder-notes') {
        const note = this.plugin.folderNote(target);
        if (note) add(note);
        return;
      }
      const walk = (folder) =>
        (folder.children || []).forEach((child) => {
          if (child instanceof TFolder) {
            if (scope === 'deep') walk(child);
          } else add(child);
        });
      walk(target);
    });
    return out.sort((a, b) => byName(a.path, b.path));
  }

  frontmatterOf(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = Object.assign({}, (cache && cache.frontmatter) || {});
    delete fm.position;
    return fm;
  }

  /**
   * Which of the notes an addition would change, going by the cache —
   * and, for each property, how many notes already hold a value of their
   * own for it, which is what keeping or replacing decides.
   */
  planAdd(files, props, replace) {
    const changing = [];
    const held = {};
    files.forEach((file) => {
      const fm = this.frontmatterOf(file);
      props.forEach(({ key, value }) => {
        const have = keyLike(fm, key);
        if (have === undefined) return;
        const current = fm[have];
        // Nothing there yet, the same already, or lists, which merge.
        if (isBlank(current) || sameValue(current, value)) return;
        if (Array.isArray(current) || Array.isArray(value)) return;
        held[key] = (held[key] || 0) + 1;
      });
      if (addPropertiesTo(JSON.parse(JSON.stringify(fm)), props, replace)) changing.push(file);
    });
    return { files, changing, held };
  }

  /** How many notes carry a property, and which. */
  notesWithProperty(name) {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => keyLike(this.frontmatterOf(file), name) !== undefined);
  }

  /**
   * A property rename worked out from the cache: the notes it renames
   * in, the ones where two properties become one, the ones left as they
   * are because their values differ, and the settings that name it.
   */
  planPropertyRename(from, to) {
    const renamed = [];
    const merged = [];
    const conflicts = [];
    this.notesWithProperty(from).forEach((file) => {
      const result = renamePropertyIn(JSON.parse(JSON.stringify(this.frontmatterOf(file))), from, to);
      if (result === 'renamed') renamed.push(file);
      else if (result === 'merged') merged.push(file);
      else if (result === 'conflict') conflicts.push(file);
    });
    const settings = renamePropertyInSettings(JSON.parse(JSON.stringify(this.plugin.settings)), from, to).changed;
    return { renamed, merged, conflicts, settings, total: renamed.length + merged.length };
  }

  /** Notes with a tag or one beneath it, where it is, and nested tags met on the way. */
  planTagRename(from, to) {
    from = String(from).replace(/^#/, '');
    to = String(to || '').replace(/^#/, '');
    const files = [];
    let inText = 0;
    let inProps = 0;
    let already = 0;
    const nested = new Set();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const spots = tagSpots(cache, from);
      const fm = cache && cache.frontmatter;
      const inFm = fmHasTag(fm, from);
      noteTags(cache).forEach((t) => {
        if (tagUnder(t, from) && t !== from.toLowerCase()) nested.add(t);
      });
      if (spots.length || inFm) {
        files.push(file);
        if (spots.length) inText++;
        if (inFm) inProps++;
      }
      // Notes already carrying the new name, which the rename merges into.
      if (to && to.toLowerCase() !== from.toLowerCase() && noteTags(cache).some((t) => t === to.toLowerCase())) {
        already++;
      }
    });
    return { files, inText, inProps, already, nested: Array.from(nested).sort(byName) };
  }

  /**
   * Files a base lives in: .base files, and notes with a base block.
   * Read once per dialog; `fresh` reads again.
   */
  async baseSources(fresh) {
    if (this.baseCache && !fresh) return this.baseCache;
    const vault = this.app.vault;
    const out = [];
    for (const file of vault.getFiles()) {
      if (file.extension === 'base') {
        out.push({ file, kind: 'base', text: await vault.cachedRead(file) });
      } else if (file.extension === 'md') {
        const text = await vault.cachedRead(file);
        if (/^[ \t]*(`{3,}|~{3,})[ \t]*base[ \t]*$/m.test(text)) out.push({ file, kind: 'blocks', text });
      }
    }
    this.baseCache = out;
    return out;
  }

  /** The bases a rename would change. */
  async basesFor(what) {
    const sources = await this.baseSources();
    return sources
      .filter((s) =>
        s.kind === 'base' ? renameInBaseText(s.text, what) !== null : renameInBaseBlocks(s.text, what) !== null
      )
      .map((s) => s.file);
  }

  /** Notes where a property holds a value, and those where a list of it already holds the new one. */
  planValueRename(key, from, to) {
    const files = [];
    let merged = 0;
    this.notesWithProperty(key).forEach((file) => {
      const fm = JSON.parse(JSON.stringify(this.frontmatterOf(file)));
      const have = keyLike(fm, key);
      const hadTo = Array.isArray(fm[have]) && fm[have].some((x) => valueKey(x) === to);
      if (renameValueIn(fm, key, from, to)) {
        files.push(file);
        if (hadTo) merged++;
      }
    });
    return { files, merged };
  }

  /** The notes a removal would change. */
  planRemove(files, keys) {
    return files.filter((file) =>
      removePropertiesFrom(JSON.parse(JSON.stringify(this.frontmatterOf(file))), keys)
    );
  }

  /**
   * A type change worked out from the cache: the notes whose values are
   * converted, those whose values can't be and are left, and how many
   * are already right.
   */
  planTypeChange(key, type) {
    const convert = [];
    const stuck = [];
    let fine = 0;
    this.notesWithProperty(key).forEach((file) => {
      const fm = this.frontmatterOf(file);
      const value = fm[keyLike(fm, key)];
      const result = convertValue(value, type);
      if (!result.ok) stuck.push(file);
      else if (sameValue(result.value, value)) fine++;
      else convert.push(file);
    });
    return { convert, stuck, fine };
  }

  /** Notes without a property, or with it empty. */
  missing(files, key) {
    return files.filter((file) => {
      const fm = this.frontmatterOf(file);
      const have = keyLike(fm, key);
      return have === undefined || isBlank(fm[have]);
    });
  }

  /** Rename one value of a property in every note and base that uses it. */
  async renameValue(key, from, to) {
    const app = this.app;
    const what = { value: [key, from, to] };
    const record = await this.run(`Renaming “${from}”`, async (touch, step, rec) => {
      const { files } = this.planValueRename(key, from, to);
      let done = 0;
      for (const file of files) {
        await touch(file, () => app.fileManager.processFrontMatter(file, (fm) => renameValueIn(fm, key, from, to)));
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);
    });
    if (!record) return null;
    this.followRename({ value: [key, from, to] });
    record.undoFollow = () => this.followRename({ value: [key, to, from] });
    return record;
  }

  /** Take properties out of the notes. */
  async removeProperties(files, keys) {
    const fm = this.app.fileManager;
    const changing = this.planRemove(files, keys);
    const label = `Removing ${keys.length === 1 ? `“${keys[0]}”` : `${keys.length} properties`}`;
    return this.run(label, async (touch, step) => {
      let done = 0;
      for (const file of changing) {
        await touch(file, () => fm.processFrontMatter(file, (data) => removePropertiesFrom(data, keys)));
        step(++done, changing.length);
      }
    });
  }

  /**
   * Give a property a type everywhere, converting the values that can
   * be converted and leaving — and naming — any that can't.
   */
  async changeType(key, type) {
    const app = this.app;
    const before = assignedType(app, key);
    // What it was taken to be, if nothing was assigned, to go back to.
    const seen = propertyType(app, key);
    const record = await this.run(`Changing “${key}”`, async (touch, step, rec) => {
      const plan = this.planTypeChange(key, type);
      rec.stuck = plan.stuck;
      let done = 0;
      for (const file of plan.convert) {
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (fm) => {
            const have = keyLike(fm, key);
            if (have === undefined) return;
            const result = convertValue(fm[have], type);
            if (result.ok) fm[have] = result.value;
          })
        );
        step(++done, plan.convert.length);
      }
      try {
        app.metadataTypeManager.setType(key, type);
        rec.undoSettings = () => {
          try {
            if (before) app.metadataTypeManager.setType(key, before);
            else if (typeof app.metadataTypeManager.unsetType === 'function') app.metadataTypeManager.unsetType(key);
            else app.metadataTypeManager.setType(key, seen);
          } catch (err) {
            /* the values are back either way */
          }
        };
      } catch (err) {
        /* the values are converted; Obsidian infers the type from them */
      }
    });
    return record;
  }

  /** Fill a property in the notes that lack it. */
  async fill(files, key, value, type) {
    const fm = this.app.fileManager;
    const record = await this.run(`Filling “${key}”`, async (touch, step) => {
      let done = 0;
      for (const file of files) {
        await touch(file, () =>
          fm.processFrontMatter(file, (data) => {
            const have = keyLike(data, key);
            if (have !== undefined && !isBlank(data[have])) return;
            data[have === undefined ? key : have] = value;
          })
        );
        step(++done, files.length);
      }
    });
    if (record && type && type !== 'text' && !assignedType(this.app, key)) {
      try {
        this.app.metadataTypeManager.setType(key, type);
      } catch (err) {
        /* inferred from the values */
      }
    }
    return record;
  }

  /* -- making changes ----------------------------------------------- */

  /**
   * Run a change, recording each file's text before and after. A
   * notice counts the notes as they go, since a large vault takes a
   * moment. Returns the record, which becomes the one Undo reverses.
   */
  async run(label, work) {
    if (this.busy) {
      new Notice('Another change is still being made.');
      return null;
    }
    this.busy = true;
    this.baseCache = null;
    const record = { label, files: [], failed: [], undoSettings: null };
    const progress = new Notice(`${label}…`, 0);
    const vault = this.app.vault;
    const touch = async (file, edit) => {
      try {
        const before = await vault.read(file);
        await edit(file);
        const after = await vault.read(file);
        if (after !== before) record.files.push({ file, before, after });
        return after !== before;
      } catch (err) {
        console.error(`Design Redux: could not change ${file.path}`, err);
        record.failed.push(file);
        return false;
      }
    };
    const step = (done, total) => {
      if (typeof progress.setMessage === 'function' && total > 20 && done % 10 === 0) {
        progress.setMessage(`${label}… ${done} of ${total}`);
      }
    };
    try {
      await work(touch, step, record);
    } finally {
      this.busy = false;
      if (typeof progress.hide === 'function') progress.hide();
    }
    if (record.files.length || record.undoSettings) this.last = record;
    return record;
  }

  /**
   * Add properties to the notes. Only a note the cache says will change
   * is written, since writing properties back can re-save a note's
   * frontmatter even when nothing in it is different.
   */
  async addProperties(files, props, replace) {
    const fm = this.app.fileManager;
    files = this.planAdd(files, props, replace).changing;
    const types = props.filter((p) => p.type && !assignedType(this.app, p.key));
    const label = `Adding ${props.length === 1 ? `“${props[0].key}”` : `${props.length} properties`}`;
    const record = await this.run(label, async (touch, step) => {
      let done = 0;
      for (const file of files) {
        await touch(file, () => fm.processFrontMatter(file, (data) => addPropertiesTo(data, props, replace)));
        step(++done, files.length);
      }
    });
    if (!record) return null;
    // A new property gets the type it was given here, so Obsidian shows
    // a list as a list from the first note on.
    types.forEach((p) => {
      try {
        if (p.type !== 'text' && typeof this.app.metadataTypeManager.setType === 'function') {
          this.app.metadataTypeManager.setType(p.key, p.type);
        }
      } catch (err) {
        /* the values still read as what they are */
      }
    });
    return record;
  }

  /**
   * Rename a property in every note that has it, in bases, and in this
   * plugin's settings. Notes where the two names hold different values
   * are left as they are and reported.
   */
  async renameProperty(from, to) {
    const app = this.app;
    const what = { property: [from, to] };
    const type = assignedType(app, from);
    const record = await this.run(`Renaming “${from}”`, async (touch, step, rec) => {
      const plan = this.planPropertyRename(from, to);
      const files = plan.renamed.concat(plan.merged);
      rec.conflicts = plan.conflicts.slice();
      let done = 0;
      for (const file of files) {
        let result = 'absent';
        await touch(file, () =>
          app.fileManager.processFrontMatter(file, (data) => {
            result = renamePropertyIn(data, from, to);
          })
        );
        if (result === 'conflict' && rec.conflicts.indexOf(file) === -1) rec.conflicts.push(file);
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);

      const settings = renamePropertyInSettings(this.plugin.settings, from, to);
      rec.settings = settings.changed;
      if (settings.changed.length) {
        rec.undoSettings = () => {
          settings.undo();
          this.afterSettings(to, from);
        };
        await this.plugin.saveData(this.plugin.settings);
        this.afterSettings(from, to);
      }
    });
    if (!record) return null;
    if (type && from.toLowerCase() !== to.toLowerCase() && !assignedType(app, to)) {
      try {
        app.metadataTypeManager.setType(to, type);
      } catch (err) {
        /* Obsidian infers it again from the values */
      }
    }
    this.followRename({ property: [from, to] });
    record.undoFollow = () => this.followRename({ property: [to, from] });
    return record;
  }

  /** Rename a tag, and the tags nested beneath it, in notes' properties and text and in bases. */
  async renameTag(from, to) {
    const app = this.app;
    const what = { tag: [from, to] };
    const record = await this.run(`Renaming #${from}`, async (touch, step, rec) => {
      const { files } = this.planTagRename(from, to);
      rec.stale = [];
      let done = 0;
      for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        const spots = tagSpots(cache, from);
        const inFm = fmHasTag(cache && cache.frontmatter, from);
        await touch(file, async () => {
          // The text first, at the places the cache found; the
          // properties after, since rewriting them moves those places.
          if (spots.length) {
            let stale = false;
            await app.vault.process(file, (text) => {
              const next = renameTagsAt(text, spots, from, to);
              if (next === null) {
                stale = true;
                return text;
              }
              return next;
            });
            if (stale) rec.stale.push(file);
          }
          if (inFm) await app.fileManager.processFrontMatter(file, (data) => renameTagIn(data, from, to));
        });
        step(++done, files.length);
      }
      rec.bases = await this.rewriteBases(what, touch);
    });
    if (!record) return null;
    this.followRename({ tag: [from, to] });
    record.undoFollow = () => this.followRename({ tag: [to, from] });
    return record;
  }

  /** Apply a rename to every base that mentions it. Returns the files changed. */
  async rewriteBases(what, touch) {
    const changed = [];
    const vault = this.app.vault;
    const rename = (source, text) =>
      source.kind === 'base' ? renameInBaseText(text, what) : renameInBaseBlocks(text, what);
    for (const source of await this.baseSources(true)) {
      if (rename(source, source.text) === null) continue;
      const did = await touch(source.file, () =>
        vault.process(source.file, (text) => {
          const next = rename(source, text);
          return next === null ? text : next;
        })
      );
      if (did) changed.push(source.file);
    }
    this.baseCache = null;
    return changed;
  }

  /** Graphs and the sidebar follow a change to the settings that name a property. */
  afterSettings(from, to) {
    const graph = this.plugin.feature(GraphPropertyFilter);
    if (graph && typeof graph.renameProperty === 'function') graph.renameProperty(from, to);
    const library = this.plugin.feature(Library);
    if (library && typeof library.refreshViews === 'function') library.refreshViews();
  }

  /** Open screens that were showing the old name show the new one. */
  followRename(what) {
    liveViews(this.app, BROWSE_VIEW, BrowseView).forEach((view) => {
      if (what.property) {
        const [from, to] = what.property;
        if (view.property && view.property.toLowerCase() === from.toLowerCase()) {
          view.property = to.toLowerCase();
        }
        if (view.filterProp && String(view.filterProp.key).toLowerCase() === from.toLowerCase()) {
          view.filterProp = Object.assign({}, view.filterProp, { key: to });
        }
      }
      if (what.tag) {
        const [from, to] = what.tag;
        if (view.filterTag && tagUnder(view.filterTag, from)) {
          view.filterTag = renameTagText(view.filterTag, from, to).toLowerCase();
        }
      }
      if (what.value) {
        const [key, from, to] = what.value;
        const sameKey = (k) => String(k || '').toLowerCase() === key.toLowerCase();
        if (sameKey(view.property) && view.value === from) view.value = to;
        if (view.filterProp && sameKey(view.filterProp.key) && view.filterProp.value === from) {
          view.filterProp = Object.assign({}, view.filterProp, { value: to });
        }
      }
    });
    // Once Obsidian has read the changed files back.
    window.setTimeout(() => this.plugin.refreshBrowse(), 400);
  }

  /** Put back what the last change altered, where it hasn't been edited since. */
  async undo() {
    const record = this.last;
    if (!record) {
      new Notice('There is no bulk change to undo.');
      return null;
    }
    if (this.busy) {
      new Notice('Another change is still being made.');
      return null;
    }
    this.last = null;
    this.busy = true;
    let restored = 0;
    const kept = [];
    try {
      for (const { file, before, after } of record.files.slice().reverse()) {
        let ok = false;
        try {
          await this.app.vault.process(file, (text) => {
            if (text !== after) return text;
            ok = true;
            return before;
          });
        } catch (err) {
          ok = false;
        }
        if (ok) restored++;
        else kept.push(file);
      }
      if (record.undoSettings) {
        record.undoSettings();
        await this.plugin.saveData(this.plugin.settings);
      }
    } finally {
      this.busy = false;
    }
    if (record.undoFollow) record.undoFollow();
    this.baseCache = null;
    window.setTimeout(() => this.plugin.refreshBrowse(), 400);
    const notes = (n) => (n === 1 ? '1 file' : `${n} files`);
    new Notice(
      kept.length
        ? `Undone in ${notes(restored)}. ${notes(kept.length)} changed since, so left as they are: ${kept
            .slice(0, 3)
            .map((f) => f.basename)
            .join(', ')}${kept.length > 3 ? '…' : ''}`
        : `Undone in ${notes(restored)}.`,
      kept.length ? 10000 : 4000
    );
    return { restored, kept };
  }
}

/* -- dialogs ---------------------------------------------------------- */

const bulkCount = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/** Names in a sentence: "status", "status and domain", "status, domain and 2 more". */
function nameList(names, quote = true, most = 3) {
  const q = names.map((n) => (quote ? `“${n}”` : n));
  if (q.length <= 1) return q.join('');
  if (q.length <= most) return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
  return `${q.slice(0, most - 1).join(', ')} and ${q.length - most + 1} more`;
}

/** What a finished change did, with Undo while it's still the last one. */
function bulkNotice(bulk, message, record) {
  const frag = document.createDocumentFragment();
  const box = document.createElement('div');
  box.className = 'dr-bulk-notice';
  frag.appendChild(box);
  box.createDiv({ text: message });
  let notice = null;
  if (record && bulk.last === record) {
    const undo = box.createEl('button', { cls: 'dr-bulk-undo', text: 'Undo' });
    undo.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (notice && typeof notice.hide === 'function') notice.hide();
      bulk.undo();
    });
  }
  notice = new Notice(frag, record && bulk.last === record ? 12000 : 6000);
  return notice;
}

/** The ends of a result message: notes left alone, and notes that failed. */
function bulkTail(record) {
  const parts = [];
  if (record.conflicts && record.conflicts.length) {
    parts.push(
      `${bulkCount(record.conflicts.length, 'note')} kept both, as the values differ: ${nameList(
        record.conflicts.map((f) => f.basename), false
      )}.`
    );
  }
  if (record.stale && record.stale.length) {
    parts.push(`${bulkCount(record.stale.length, 'note')} changed while this ran and ${record.stale.length === 1 ? 'was' : 'were'} left: try again.`);
  }
  if (record.failed && record.failed.length) {
    parts.push(`${bulkCount(record.failed.length, 'file')} couldn't be changed; the console says why.`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

/** Notes changed by a record, leaving out the bases it changed too. */
function notesChanged(record) {
  const bases = record.bases || [];
  return record.files.filter((f) => bases.indexOf(f.file) === -1).length;
}

/**
 * The parts every bulk dialog shares: labelled fields, a summary of
 * what will happen that updates as you type, and the button that does
 * it, which says how many notes it will change.
 */
class BulkModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.bulk = plugin.bulk;
    // Bases are read afresh for each dialog, in case one was edited.
    this.bulk.baseCache = null;
    this.suggests = [];
    this.updateTimer = 0;
    this.action = null;
    this.targets = [];
    this.reach = 'deep';
  }

  frame(title) {
    this.modalEl.addClass('dr-bulk-modal');
    this.titleEl.setText(title);
    this.contentEl.empty();
    this.body = this.contentEl.createDiv({ cls: 'dr-bulk-body' });
    this.summaryEl = this.contentEl.createDiv({ cls: 'dr-bulk-summary' });
    this.summaryEl.setAttribute('aria-live', 'polite');
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    this.goButton = buttons.createEl('button', { cls: 'mod-cta' });
    this.goButton.addEventListener('click', () => this.go());
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  section(label) {
    const el = this.body.createDiv({ cls: 'dr-bulk-section' });
    if (label) el.createDiv({ cls: 'dr-bulk-label', text: label });
    return el;
  }

  /* -- folders and notes, as chips ---------------------------------- */

  addTarget(target) {
    if (!target || this.targets.indexOf(target) !== -1) return;
    if (target instanceof TFolder || (target instanceof TFile && target.extension === 'md')) {
      this.targets.push(target);
    }
  }

  /** A section of chips for the folders and notes, and which of their notes. */
  targetsSection(label) {
    const where = this.section(label);
    this.targetsEl = where.createDiv({ cls: 'dr-bulk-chips' });
    this.scopeEl = where.createDiv({ cls: 'dr-bulk-option' });
    this.renderTargets();
    return where;
  }

  renderTargets() {
    const el = this.targetsEl;
    el.empty();
    this.targets.forEach((target) => {
      const chip = el.createDiv({ cls: 'dr-bulk-chip' });
      const isFolder = target instanceof TFolder;
      setIcon(chip.createSpan({ cls: 'dr-bulk-chip-icon' }), isFolder ? 'folder' : 'file-text');
      const name = isFolder ? target.name || this.app.vault.getName() : target.basename;
      chip.createSpan({ cls: 'dr-bulk-chip-name', text: name });
      chip.setAttribute('aria-label', target.path);
      const remove = chip.createSpan({ cls: 'dr-bulk-chip-remove' });
      setIcon(remove, 'x');
      remove.setAttribute('role', 'button');
      remove.setAttribute('tabindex', '0');
      remove.setAttribute('aria-label', `Remove ${name}`);
      onActivate(remove, () => {
        this.targets.splice(this.targets.indexOf(target), 1);
        this.renderTargets();
        this.update();
      });
    });
    const pick = el.createDiv({ cls: 'dr-bulk-chip is-add' });
    pick.setAttribute('role', 'button');
    pick.setAttribute('tabindex', '0');
    setIcon(pick.createSpan({ cls: 'dr-bulk-chip-icon' }), 'folder-plus');
    pick.createSpan({ text: this.targets.length ? 'Add folder' : 'Choose a folder' });
    onActivate(pick, () =>
      new FolderPicker(this.app, (folder) => {
        this.addTarget(folder);
        this.renderTargets();
        this.update();
      }).open()
    );
    this.renderScope();
  }

  renderScope() {
    const el = this.scopeEl;
    el.empty();
    const folders = this.targets.some((t) => t instanceof TFolder);
    el.toggleClass('is-hidden', !folders);
    if (!folders) return;
    const select = el.createEl('select', { cls: 'dropdown' });
    [
      ['deep', 'Every note in them, subfolders included'],
      ['direct', 'Only the notes directly in them'],
      ['folder-notes', 'Only their folder notes'],
    ].forEach(([value, label]) => {
      const option = select.createEl('option', { text: label });
      option.value = value;
    });
    select.value = this.reach;
    select.setAttribute('aria-label', 'Which notes');
    select.addEventListener('change', () => {
      this.reach = select.value;
      this.update();
    });
  }


  /** A text field with a label, and a line beneath it for a hint. */
  field(parent, label, placeholder) {
    const wrap = parent.createDiv({ cls: 'dr-bulk-field' });
    const id = `dr-bulk-${Math.random().toString(36).slice(2)}`;
    const labelEl = wrap.createEl('label', { cls: 'dr-bulk-label', text: label });
    labelEl.setAttribute('for', id);
    const box = wrap.createDiv({ cls: 'dr-bulk-input' });
    const input = box.createEl('input', { type: 'text' });
    input.id = id;
    input.placeholder = placeholder;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    const hint = wrap.createDiv({ cls: 'dr-bulk-hint' });
    input.addEventListener('input', () => this.queueUpdate());
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      // The latest typing counts, not the summary from a moment ago.
      window.clearTimeout(this.updateTimer);
      this.update();
      if (this.action) this.go();
    });
    return { input, hint, box };
  }

  suggest(box, input, opts) {
    const list = attachSuggest(box, input, opts);
    list.addClass('dr-bulk-suggest');
    this.suggests.push(list);
    return list;
  }

  /** Whether a suggestion is highlighted, so Enter picks it rather than applying. */
  suggesting() {
    return this.suggests.some((l) => l.hasClass('is-open') && !!l.querySelector('.is-selected'));
  }

  queueUpdate() {
    window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => this.update(), 60);
  }

  update() {}

  /**
   * Lines of the summary: { text, cls?, icon?, notes? }. `action` is
   * { label, run } or null while there's nothing to do.
   */
  showSummary(lines, action) {
    this.summaryEl.empty();
    lines.forEach((line) => {
      const el = this.summaryEl.createDiv({ cls: `dr-bulk-line ${line.cls || ''}`.trim() });
      setIcon(el.createSpan({ cls: 'dr-bulk-line-icon' }), line.icon || 'dot');
      const text = el.createDiv({ cls: 'dr-bulk-line-text' });
      text.createSpan({ text: line.text });
      if (line.notes && line.notes.length) {
        const list = text.createDiv({ cls: 'dr-bulk-notes' });
        line.notes.slice(0, 6).forEach((file) => {
          const link = list.createSpan({ cls: 'dr-bulk-note', text: file.basename });
          link.setAttribute('role', 'link');
          link.setAttribute('tabindex', '0');
          link.setAttribute('aria-label', `Open ${file.path}`);
          onActivate(link, () => {
            this.close();
            this.app.workspace.getLeaf(false).openFile(file);
          });
        });
        if (line.notes.length > 6) list.createSpan({ cls: 'dr-bulk-more', text: `and ${line.notes.length - 6} more` });
      }
    });
    this.summaryEl.toggleClass('is-empty', !lines.length);
    this.action = action;
    this.goButton.setText(action ? action.label : this.idleLabel || 'Apply');
    this.goButton.disabled = !action;
    this.goButton.toggleClass('is-disabled', !action);
  }

  async go() {
    const action = this.action;
    if (!action || this.bulk.busy) return;
    this.action = null;
    this.close();
    await action.run();
  }

  onClose() {
    window.clearTimeout(this.updateTimer);
    this.suggests.forEach((el) => el.remove());
    this.suggests = [];
    this.contentEl.empty();
  }
}

/**
 * Add properties to every note in some folders — or to the notes
 * chosen — at once. Each property takes its type from the vault if
 * the vault has it already, or one chosen here if it's new.
 */
class AddPropertiesModal extends BulkModal {
  constructor(plugin, targets) {
    super(plugin);
    this.targets = [];
    (targets || []).forEach((t) => this.addTarget(t));
    this.reach = 'deep';
    this.replace = false;
    this.rows = [];
    this.idleLabel = 'Add';
  }

  onOpen() {
    this.frame('Add properties');
    const where = this.section('To the notes in');
    this.targetsEl = where.createDiv({ cls: 'dr-bulk-chips' });
    this.scopeEl = where.createDiv({ cls: 'dr-bulk-option' });

    const what = this.section('Properties');
    this.rowsEl = what.createDiv({ cls: 'dr-bulk-rows' });
    const add = what.createDiv({ cls: 'dr-bulk-add' });
    add.setAttribute('role', 'button');
    add.setAttribute('tabindex', '0');
    setIcon(add.createSpan({ cls: 'dr-bulk-add-icon' }), 'plus');
    add.createSpan({ text: 'Add another property' });
    onActivate(add, () => {
      this.rows.push(this.newRow());
      this.renderRows();
      const last = this.rowsEl.querySelector('.dr-bulk-row:last-child .dr-bulk-name input');
      if (last) last.focus();
    });
    this.existingEl = what.createDiv({ cls: 'dr-bulk-option' });

    this.rows.push(this.newRow());
    this.renderTargets();
    this.renderRows();
    this.renderExisting();
    this.update();
    window.setTimeout(() => {
      const first = this.rowsEl.querySelector('.dr-bulk-name input');
      if (first) first.focus();
    }, 0);
  }

  newRow() {
    return { key: '', type: 'text', raw: '', locked: false };
  }

  renderExisting() {
    const el = this.existingEl;
    el.empty();
    el.createSpan({ cls: 'dr-bulk-option-label', text: 'Where a note already has one' });
    const select = el.createEl('select', { cls: 'dropdown' });
    [
      ['keep', 'Keep its value — lists get the new items'],
      ['replace', 'Replace its value'],
    ].forEach(([value, label]) => {
      const option = select.createEl('option', { text: label });
      option.value = value;
    });
    select.value = this.replace ? 'replace' : 'keep';
    select.addEventListener('change', () => {
      this.replace = select.value === 'replace';
      this.update();
    });
  }

  renderRows() {
    this.suggests.forEach((el) => el.remove());
    this.suggests = [];
    this.rowsEl.empty();
    this.rows.forEach((row) => this.renderRow(row));
  }

  renderRow(row) {
    const el = this.rowsEl.createDiv({ cls: 'dr-bulk-row' });
    const typeBtn = el.createDiv({ cls: 'dr-bulk-type' });
    const nameBox = el.createDiv({ cls: 'dr-bulk-name' });
    const name = nameBox.createEl('input', { type: 'text' });
    name.placeholder = 'Property';
    name.value = row.key;
    name.setAttribute('aria-label', 'Property name');
    name.setAttribute('autocomplete', 'off');
    const valueBox = el.createDiv({ cls: 'dr-bulk-value' });
    const remove = el.createDiv({ cls: 'dr-bulk-remove clickable-icon' });
    setIcon(remove, 'x');
    remove.setAttribute('aria-label', 'Remove this property');
    remove.setAttribute('role', 'button');
    remove.setAttribute('tabindex', '0');
    onActivate(remove, () => {
      this.rows.splice(this.rows.indexOf(row), 1);
      if (!this.rows.length) this.rows.push(this.newRow());
      this.renderRows();
      this.update();
    });

    const paintType = () => {
      typeBtn.empty();
      setIcon(typeBtn, TYPE_ICONS[row.type] || 'text');
      typeBtn.toggleClass('is-locked', row.locked);
      typeBtn.setAttribute(
        'aria-label',
        row.locked
          ? `${TYPE_LABELS[row.type] || 'Text'}, as it is in the rest of the vault`
          : `${TYPE_LABELS[row.type] || 'Text'} — choose the type`
      );
      typeBtn.setAttribute('role', 'button');
      typeBtn.setAttribute('tabindex', row.locked ? '-1' : '0');
    };
    const setType = (type, locked) => {
      const was = row.type;
      row.type = type;
      row.locked = locked;
      paintType();
      if (was !== type) {
        const focused = valueBox.contains(document.activeElement);
        this.renderValue(row, valueBox);
        if (focused) {
          const field = valueBox.querySelector('input');
          if (field) field.focus();
        }
      }
    };
    // A name the vault already uses brings its type along.
    const settleName = () => {
      row.key = name.value.trim();
      const known = knownPropertyNames(this.app).find(
        (n) => n.toLowerCase() === row.key.toLowerCase()
      );
      if (known) setType(propertyType(this.app, known), true);
      else if (row.locked) setType('text', false);
      this.update();
    };
    onActivate(typeBtn, (evt) => {
      if (row.locked) return;
      const menu = new Menu();
      Object.keys(TYPE_ICONS).forEach((type) =>
        menu.addItem((item) =>
          item
            .setTitle(TYPE_LABELS[type])
            .setIcon(TYPE_ICONS[type])
            .setChecked(type === row.type)
            .onClick(() => {
              setType(type, false);
              this.update();
            })
        )
      );
      showMenuAt(menu, evt);
    });

    name.addEventListener('input', () => {
      row.key = name.value.trim();
      this.queueUpdate();
    });
    name.addEventListener('change', settleName);
    name.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      settleName();
      const field = valueBox.querySelector('input');
      if (field) field.focus();
    });
    this.suggest(nameBox, name, {
      icon: 'tag',
      source: () => {
        const taken = this.rows.filter((r) => r !== row).map((r) => r.key.toLowerCase());
        return knownPropertyNames(this.app).filter((n) => taken.indexOf(n.toLowerCase()) === -1);
      },
      onSelect: (v) => {
        name.value = v;
        settleName();
        const field = valueBox.querySelector('input');
        if (field) field.focus();
      },
    });

    if (row.key) {
      const known = knownPropertyNames(this.app).find((n) => n.toLowerCase() === row.key.toLowerCase());
      if (known) {
        row.type = propertyType(this.app, known);
        row.locked = true;
      }
    }
    paintType();
    this.renderValue(row, valueBox);
  }

  /** The value's field, shaped by the type: a checkbox, a date, a list, a number or text. */
  renderValue(row, box) {
    box.empty();
    const type = row.type;
    if (type === 'checkbox') {
      const label = box.createEl('label', { cls: 'dr-bulk-check' });
      const input = label.createEl('input', { type: 'checkbox' });
      input.checked = row.raw === true;
      row.raw = input.checked;
      label.createSpan({ text: 'Ticked' });
      input.addEventListener('change', () => {
        row.raw = input.checked;
        this.update();
      });
      return;
    }
    const input = box.createEl('input', {
      type: type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text',
    });
    input.setAttribute('aria-label', 'Value');
    input.setAttribute('autocomplete', 'off');
    if (typeof row.raw === 'string') input.value = row.raw;
    else row.raw = '';
    input.placeholder =
      LIST_TYPES.indexOf(type) !== -1
        ? 'Items, separated by commas'
        : type === 'number'
          ? 'Number, or leave empty'
          : 'Value, or leave empty';
    if (type === 'number') input.setAttribute('inputmode', 'decimal');
    input.addEventListener('input', () => {
      row.raw = input.value;
      this.queueUpdate();
    });
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      window.clearTimeout(this.updateTimer);
      this.update();
      if (this.action) this.go();
    });
    if (type === 'date' || type === 'datetime' || type === 'number' || type === 'checkbox') return;

    // The values the property already takes, to pick from; in a list,
    // for the item being typed.
    const isList = LIST_TYPES.indexOf(type) !== -1;
    const last = () => (isList ? input.value.split(',').pop() : input.value);
    this.suggest(box, input, {
      icon: type === 'tags' ? 'hash' : 'text',
      query: last,
      source: () => {
        if (!row.key) return [];
        const typed = isList
          ? input.value.split(',').slice(0, -1).map((s) => s.trim().toLowerCase())
          : [];
        return propertyValues(this.app, row.key).filter((v) => typed.indexOf(v.toLowerCase()) === -1);
      },
      onSelect: (v) => {
        if (isList) {
          const done = input.value.split(',').slice(0, -1).map((s) => s.trim()).filter(Boolean);
          input.value = done.concat(v).join(', ') + ', ';
        } else input.value = v;
        row.raw = input.value;
        input.focus();
        this.update();
      },
    });
  }

  /** What would be added, where, and what's stopping it if anything is. */
  update() {
    const lines = [];
    const named = this.rows.filter((r) => r.key);
    const files = this.bulk.notesFor(this.targets, this.reach);
    const seen = new Set();
    let problem = '';
    named.forEach((r) => {
      const k = r.key.toLowerCase();
      if (!problem && seen.has(k)) problem = `“${r.key}” is listed twice.`;
      seen.add(k);
      const why = propertyNameProblem(r.key);
      if (!problem && why) problem = why;
    });

    if (!this.targets.length) problem = problem || 'Choose the folders to add them to.';
    else if (!files.length) {
      problem =
        this.reach === 'folder-notes'
          ? 'None of these folders has a folder note.'
          : this.reach === 'direct'
            ? 'There are no notes directly in these folders.'
            : 'There are no notes in these folders.';
    }
    if (!named.length) problem = problem || 'Name a property to add.';

    if (problem) {
      lines.push({ text: problem, icon: 'info', cls: 'is-muted' });
      this.current = null;
      return this.showSummary(lines, null);
    }

    const props = named.map((r) => ({ key: r.key, value: parseTypedValue(r.type, r.raw), type: r.locked ? null : r.type }));
    const plan = this.bulk.planAdd(files, props, this.replace);
    const n = plan.changing.length;
    const names = nameList(props.map((p) => p.key));
    if (n) {
      lines.push({
        icon: 'plus',
        text: `Adds ${names} to ${n === files.length ? (n === 1 ? 'the note' : `all ${n} notes`) : `${n} of the ${files.length} notes`}.`,
      });
    }
    Object.keys(plan.held).forEach((key) => {
      const k = plan.held[key];
      lines.push(
        this.replace
          ? {
              icon: 'alert-triangle',
              cls: 'is-warning',
              text: `Replaces the “${key}” ${k === 1 ? 'value' : 'values'} ${bulkCount(k, 'note')} already ${k === 1 ? 'has' : 'have'}.`,
            }
          : {
              icon: 'info',
              cls: 'is-muted',
              text: `${bulkCount(k, 'note')} already ${k === 1 ? 'has' : 'have'} a “${key}” of ${k === 1 ? 'its' : 'their'} own, and ${k === 1 ? 'keeps' : 'keep'} it.`,
            }
      );
    });
    const unchanged = files.length - n;
    if (unchanged) {
      lines.push({
        icon: 'check',
        cls: 'is-muted',
        text: n
          ? `${bulkCount(unchanged, 'note')} already ${unchanged === 1 ? 'has' : 'have'} ${props.length === 1 ? 'it' : 'them'} as given.`
          : `Every note already has ${props.length === 1 ? 'it' : 'them'} as given.`,
      });
    }
    const folderless =
      this.reach === 'folder-notes'
        ? this.targets.filter((t) => t instanceof TFolder && !this.plugin.folderNote(t))
        : [];
    if (folderless.length) {
      lines.push({
        icon: 'info',
        cls: 'is-muted',
        text: `${nameList(folderless.map((f) => f.name))} ${folderless.length === 1 ? 'has' : 'have'} no folder note, so ${folderless.length === 1 ? "it's" : "they're"} skipped.`,
      });
    }
    this.current = { files, props };
    this.showSummary(
      lines,
      n
        ? {
            label: `Add to ${bulkCount(n, 'note')}`,
            run: async () => {
              const record = await this.bulk.addProperties(files, props, this.replace);
              if (!record) return;
              const done = notesChanged(record);
              bulkNotice(
                this.bulk,
                (done ? `Added ${names} to ${bulkCount(done, 'note')}.` : 'Nothing needed changing.') +
                  bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}

/**
 * Rename a property in every note that has it — and in bases and this
 * plugin's settings — with what will happen shown before it does.
 */
class RenamePropertyModal extends BulkModal {
  constructor(plugin, from) {
    super(plugin);
    this.from = from || '';
    this.bases = null;
    this.basesKey = '';
    this.idleLabel = 'Rename';
  }

  onOpen() {
    this.frame('Rename property');
    const section = this.section();
    const from = this.field(section, 'Property', 'The property to rename');
    const to = this.field(section, 'New name', 'What to call it');
    this.fromInput = from.input;
    this.fromHint = from.hint;
    this.toInput = to.input;
    this.toHint = to.hint;
    this.fromInput.value = this.from;
    this.suggest(from.box, from.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.fromInput.value = v;
        this.update();
        this.toInput.focus();
      },
    });
    this.update();
    window.setTimeout(() => {
      if (this.from) {
        this.toInput.value = this.from;
        this.toInput.focus();
        this.toInput.select();
        this.update();
      } else this.fromInput.focus();
    }, 0);
  }

  /** The property as the vault spells it, for what's been typed. */
  resolve(typed) {
    const t = typed.trim();
    if (!t) return '';
    return knownPropertyNames(this.app).find((n) => n.toLowerCase() === t.toLowerCase()) || t;
  }

  update() {
    const from = this.resolve(this.fromInput.value);
    const to = this.toInput.value.trim();
    const lines = [];
    const holders = from ? this.bulk.notesWithProperty(from).length : 0;
    this.fromHint.setText(from ? (holders ? `In ${bulkCount(holders, 'note')}` : 'Not in any note') : '');

    let problem = '';
    if (!from) problem = 'Choose the property to rename.';
    else if (!to || to === from) problem = 'Type the new name.';
    else problem = propertyNameProblem(to);
    this.toHint.setText('');
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }

    const plan = this.bulk.planPropertyRename(from, to);
    const key = `${from}\u0000${to}`;
    if (this.basesKey !== key) {
      this.basesKey = key;
      this.bases = null;
      this.bulk.basesFor({ property: [from, to] }).then((files) => {
        if (this.basesKey !== key) return;
        this.bases = files;
        this.update();
      }, () => {
        if (this.basesKey === key) this.bases = [];
      });
    }

    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (plan.total) {
      lines.push({
        icon: 'pencil',
        text: caseOnly
          ? `Changes its capitals in ${bulkCount(plan.total, 'note')}.`
          : `Renames it in ${bulkCount(plan.total, 'note')}.`,
      });
    } else if (!holders) {
      lines.push({ icon: 'info', cls: 'is-muted', text: `No note has a property called “${from}”.` });
    }
    if (plan.merged.length) {
      lines.push({
        icon: 'git-merge',
        text: `${bulkCount(plan.merged.length, 'note')} already ${plan.merged.length === 1 ? 'has' : 'have'} “${to}” too; the two become one, since the values agree or are lists.`,
      });
    }
    if (plan.conflicts.length) {
      lines.push({
        icon: 'alert-triangle',
        cls: 'is-warning',
        text: `${bulkCount(plan.conflicts.length, 'note')} ${plan.conflicts.length === 1 ? 'has' : 'have'} both, with different values, so ${plan.conflicts.length === 1 ? "it's" : "they're"} left as ${plan.conflicts.length === 1 ? 'it is' : 'they are'}:`,
        notes: plan.conflicts,
      });
    }
    if (this.bases === null) {
      lines.push({ icon: 'loader', cls: 'is-muted', text: 'Looking through bases…' });
    } else if (this.bases.length) {
      lines.push({
        icon: 'table',
        text: `Also changes ${bulkCount(this.bases.length, 'base')} that ${this.bases.length === 1 ? 'uses' : 'use'} it: ${nameList(this.bases.map((f) => f.basename), false)}.`,
      });
    }
    if (plan.settings.length) {
      lines.push({ icon: 'settings', text: `And in Design Redux: ${nameList(plan.settings, false, 4)}.` });
    }
    const special = { tags: 'tags', aliases: 'aliases', cssclasses: 'CSS classes' };
    if (special[from.toLowerCase()] && !caseOnly) {
      lines.push({
        icon: 'alert-triangle',
        cls: 'is-warning',
        text: `Obsidian reads ${special[from.toLowerCase()]} from “${from.toLowerCase()}”; renamed, these stop being ${special[from.toLowerCase()]}.`,
      });
    }
    if (special[to.toLowerCase()] && !caseOnly) {
      lines.push({
        icon: 'info',
        text: `Obsidian reads ${special[to.toLowerCase()]} from “${to.toLowerCase()}”, so these values will be ${special[to.toLowerCase()]}.`,
      });
    }

    const reach = plan.total + (this.bases ? this.bases.length : 0) + plan.settings.length;
    this.showSummary(
      lines,
      reach
        ? {
            label: plan.total ? `Rename in ${bulkCount(plan.total, 'note')}` : 'Rename',
            run: async () => {
              const record = await this.bulk.renameProperty(from, to);
              if (!record) return;
              const done = notesChanged(record);
              const bases = (record.bases || []).length;
              bulkNotice(
                this.bulk,
                `Renamed “${from}” to “${to}” in ${bulkCount(done, 'note')}` +
                  (bases ? ` and ${bulkCount(bases, 'base')}` : '') +
                  '.' +
                  bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}

/**
 * Rename a tag — and the tags nested beneath it — in every note's
 * properties and text, and in bases. Renaming to a tag that already
 * exists merges the two.
 */
class RenameTagModal extends BulkModal {
  constructor(plugin, from) {
    super(plugin);
    this.from = String(from || '').replace(/^#/, '');
    this.bases = null;
    this.basesKey = '';
    this.idleLabel = 'Rename';
  }

  onOpen() {
    this.frame('Rename tag');
    const section = this.section();
    const from = this.field(section, 'Tag', 'The tag to rename');
    const to = this.field(section, 'New name', 'What to call it');
    from.box.addClass('has-hash');
    to.box.addClass('has-hash');
    this.fromInput = from.input;
    this.fromHint = from.hint;
    this.toInput = to.input;
    this.toHint = to.hint;
    this.fromInput.value = this.from;
    this.suggest(from.box, from.input, {
      icon: 'hash',
      query: () => this.fromInput.value.replace(/^#/, ''),
      source: () => vaultTags(this.app).map((t) => t.tag),
      onSelect: (v) => {
        this.fromInput.value = v;
        this.update();
        this.toInput.focus();
      },
    });
    this.update();
    window.setTimeout(() => {
      if (this.from) {
        this.toInput.value = this.from;
        this.toInput.focus();
        this.toInput.select();
        this.update();
      } else this.fromInput.focus();
    }, 0);
  }

  update() {
    const from = this.fromInput.value.trim().replace(/^#/, '');
    const to = this.toInput.value.trim().replace(/^#/, '');
    const lines = [];
    const plan = from ? this.bulk.planTagRename(from, to) : null;
    this.fromHint.setText(
      plan
        ? plan.files.length
          ? `On ${bulkCount(plan.files.length, 'note')}` +
            (plan.nested.length ? `, with ${bulkCount(plan.nested.length, 'tag')} beneath it` : '')
          : 'Not on any note'
        : ''
    );

    let problem = '';
    if (!from) problem = 'Choose the tag to rename.';
    else if (!to || to === from) problem = 'Type the new name.';
    else problem = tagNameProblem(to);
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }

    const key = `${from.toLowerCase()}\u0000${to}`;
    if (this.basesKey !== key) {
      this.basesKey = key;
      this.bases = null;
      this.bulk.basesFor({ tag: [from, to] }).then((files) => {
        if (this.basesKey !== key) return;
        this.bases = files;
        this.update();
      }, () => {
        if (this.basesKey === key) this.bases = [];
      });
    }

    const n = plan.files.length;
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (n) {
      const where = [];
      if (plan.inProps) where.push(`the properties of ${plan.inProps}`);
      if (plan.inText) where.push(`the text of ${plan.inText}`);
      lines.push({
        icon: 'pencil',
        text: `${caseOnly ? 'Changes its capitals on' : 'Renames it on'} ${bulkCount(n, 'note')}: in ${where.join(', and ')}.`,
      });
    } else {
      lines.push({ icon: 'info', cls: 'is-muted', text: `No note is tagged #${from}.` });
    }
    if (plan.nested.length && !caseOnly) {
      const first = plan.nested[0];
      lines.push({
        icon: 'corner-down-right',
        text:
          `Tags beneath it follow: #${first} becomes #${renameTagText(first, from, to)}` +
          (plan.nested.length > 1 ? `, and ${bulkCount(plan.nested.length - 1, 'other')} the same way.` : '.'),
      });
    }
    if (plan.already) {
      lines.push({
        icon: 'git-merge',
        text: `#${to} is already on ${bulkCount(plan.already, 'note')}; the two become one.`,
      });
    }
    if (this.bases === null) {
      lines.push({ icon: 'loader', cls: 'is-muted', text: 'Looking through bases…' });
    } else if (this.bases.length) {
      lines.push({
        icon: 'table',
        text: `Also changes ${bulkCount(this.bases.length, 'base')} that ${this.bases.length === 1 ? 'tests' : 'test'} for it: ${nameList(this.bases.map((f) => f.basename), false)}.`,
      });
    }

    const reach = n + (this.bases ? this.bases.length : 0);
    this.showSummary(
      lines,
      reach
        ? {
            label: n ? `Rename on ${bulkCount(n, 'note')}` : 'Rename',
            run: async () => {
              const record = await this.bulk.renameTag(from, to);
              if (!record) return;
              const done = notesChanged(record);
              const bases = (record.bases || []).length;
              bulkNotice(
                this.bulk,
                `Renamed #${from} to #${to} on ${bulkCount(done, 'note')}` +
                  (bases ? ` and in ${bulkCount(bases, 'base')}` : '') +
                  '.' +
                  bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}

/**
 * Rename one value of a property everywhere it's used — "IR" to
 * "International Relations" — in notes, lists included, and in bases
 * that compare the property with it.
 */
class RenameValueModal extends BulkModal {
  constructor(plugin, key, value) {
    super(plugin);
    this.key = key || '';
    this.value = value === undefined || value === null ? '' : String(value);
    this.bases = null;
    this.basesKey = '';
    this.idleLabel = 'Rename';
  }

  onOpen() {
    this.frame('Rename a value');
    const section = this.section();
    const key = this.field(section, 'Property', 'Whose value to rename');
    const from = this.field(section, 'Value', 'The value as it is now');
    const to = this.field(section, 'New value', 'What it becomes');
    this.keyInput = key.input;
    this.fromInput = from.input;
    this.toInput = to.input;
    this.fromHint = from.hint;
    this.keyInput.value = this.key;
    this.fromInput.value = this.value;
    this.suggest(key.box, key.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.keyInput.value = v;
        this.update();
        this.fromInput.focus();
      },
    });
    this.suggest(from.box, from.input, {
      icon: 'text',
      source: () => (this.keyInput.value.trim() ? propertyValues(this.app, this.keyInput.value.trim()) : []),
      onSelect: (v) => {
        this.fromInput.value = v;
        this.update();
        this.toInput.focus();
      },
    });
    this.update();
    window.setTimeout(() => {
      if (this.key && this.value) {
        this.toInput.value = this.value;
        this.toInput.focus();
        this.toInput.select();
        this.update();
      } else if (this.key) this.fromInput.focus();
      else this.keyInput.focus();
    }, 0);
  }

  update() {
    const key = this.keyInput.value.trim();
    const from = this.fromInput.value;
    const to = this.toInput.value.trim();
    const lines = [];
    const plan = key && from ? this.bulk.planValueRename(key, from, from) : null;
    this.fromHint.setText(plan ? (plan.files.length ? `In ${bulkCount(plan.files.length, 'note')}` : 'Not in any note') : '');
    let problem = '';
    if (!key) problem = 'Choose the property.';
    else if (!from) problem = 'Choose the value to rename.';
    else if (!to || to === from) problem = 'Type the new value.';
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }

    const real = this.bulk.planValueRename(key, from, to);
    const basesKey = `${key}\u0000${from}\u0000${to}`;
    if (this.basesKey !== basesKey) {
      this.basesKey = basesKey;
      this.bases = null;
      this.bulk.basesFor({ value: [key, from, to] }).then(
        (files) => {
          if (this.basesKey !== basesKey) return;
          this.bases = files;
          this.update();
        },
        () => {
          if (this.basesKey === basesKey) this.bases = [];
        }
      );
    }
    const n = real.files.length;
    if (n) lines.push({ icon: 'pencil', text: `Changes “${from}” to “${to}” in ${bulkCount(n, 'note')}.` });
    else lines.push({ icon: 'info', cls: 'is-muted', text: `No note has “${from}” as its ${key}.` });
    if (real.merged) {
      lines.push({
        icon: 'git-merge',
        text: `${bulkCount(real.merged, 'note')} already ${real.merged === 1 ? 'lists' : 'list'} “${to}” as well; the two become one there.`,
      });
    }
    if (this.bases === null) lines.push({ icon: 'loader', cls: 'is-muted', text: 'Looking through bases…' });
    else if (this.bases.length) {
      lines.push({
        icon: 'table',
        text: `Also changes ${bulkCount(this.bases.length, 'base')} that ${this.bases.length === 1 ? 'filters' : 'filter'} on it: ${nameList(this.bases.map((f) => f.basename), false)}.`,
      });
    }
    const reach = n + (this.bases ? this.bases.length : 0);
    this.showSummary(
      lines,
      reach
        ? {
            label: n ? `Rename in ${bulkCount(n, 'note')}` : 'Rename',
            run: async () => {
              const record = await this.bulk.renameValue(key, from, to);
              if (!record) return;
              const bases = (record.bases || []).length;
              bulkNotice(
                this.bulk,
                `Renamed “${from}” to “${to}” in ${bulkCount(notesChanged(record), 'note')}` +
                  (bases ? ` and ${bulkCount(bases, 'base')}` : '') + '.' + bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}

/** Take properties out of every note in some folders. */
class RemovePropertiesModal extends BulkModal {
  constructor(plugin, targets, keys) {
    super(plugin);
    (targets || []).forEach((t) => this.addTarget(t));
    this.chosen = new Set((keys || []).map((k) => k.toLowerCase()));
    this.idleLabel = 'Remove';
  }

  onOpen() {
    this.frame('Remove properties');
    this.targetsSection('From the notes in');
    const what = this.section('Properties');
    this.listEl = what.createDiv({ cls: 'dr-bulk-checks' });
    this.update();
  }

  /** Redraw the choices when the notes they come from change. */
  renderTargets() {
    super.renderTargets();
    this.checksFor = null;
  }

  renderChecks(present) {
    const sig = present.map((p) => `${p.name}:${p.count}`).join('|');
    if (this.checksFor === sig) return;
    this.checksFor = sig;
    this.listEl.empty();
    if (!present.length) {
      this.listEl.createDiv({ cls: 'dr-bulk-hint', text: 'These notes have no properties.' });
      return;
    }
    present.forEach((p) => {
      const label = this.listEl.createEl('label', { cls: 'dr-bulk-check-row' });
      const box = label.createEl('input', { type: 'checkbox' });
      box.checked = this.chosen.has(p.name.toLowerCase());
      setIcon(label.createSpan({ cls: 'dr-bulk-check-icon' }), TYPE_ICONS[propertyType(this.app, p.name)] || 'text');
      label.createSpan({ cls: 'dr-bulk-check-name', text: p.name });
      label.createSpan({ cls: 'dr-bulk-check-count', text: String(p.count) });
      box.addEventListener('change', () => {
        if (box.checked) this.chosen.add(p.name.toLowerCase());
        else this.chosen.delete(p.name.toLowerCase());
        this.update();
      });
    });
  }

  update() {
    const files = this.bulk.notesFor(this.targets, this.reach);
    const present = propertiesIn(this.app, files);
    if (this.listEl) this.renderChecks(present);
    const keys = present.filter((p) => this.chosen.has(p.name.toLowerCase())).map((p) => p.name);
    const lines = [];
    if (!this.targets.length) lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the folders to remove them from.' });
    else if (!keys.length) lines.push({ icon: 'info', cls: 'is-muted', text: 'Tick the properties to remove.' });
    if (lines.length) return this.showSummary(lines, null);
    const changing = this.bulk.planRemove(files, keys);
    lines.push({
      icon: 'trash-2',
      cls: 'is-warning',
      text: `Removes ${nameList(keys)} from ${bulkCount(changing.length, 'note')}, values and all.`,
    });
    this.showSummary(lines, changing.length
      ? {
          label: `Remove from ${bulkCount(changing.length, 'note')}`,
          run: async () => {
            const record = await this.bulk.removeProperties(files, keys);
            if (!record) return;
            bulkNotice(this.bulk, `Removed ${nameList(keys)} from ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
          },
        }
      : null);
  }
}

/**
 * Change what type a property is, and convert its values to match —
 * text to a list, a list to text, text to a number or a date — naming
 * any note whose value can't be converted, which is left as it is.
 */
class ChangeTypeModal extends BulkModal {
  constructor(plugin, key) {
    super(plugin);
    this.key = key || '';
    this.type = null;
    this.idleLabel = 'Change';
  }

  onOpen() {
    this.frame('Change a property’s type');
    const section = this.section();
    const key = this.field(section, 'Property', 'The property to change');
    this.keyInput = key.input;
    this.keyHint = key.hint;
    this.keyInput.value = this.key;
    this.suggest(key.box, key.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.keyInput.value = v;
        this.type = null;
        this.update();
      },
    });
    const typeRow = section.createDiv({ cls: 'dr-bulk-field' });
    typeRow.createEl('label', { cls: 'dr-bulk-label', text: 'New type' });
    this.typeSelect = typeRow.createEl('select', { cls: 'dropdown' });
    Object.keys(TYPE_LABELS).forEach((t) => {
      const option = this.typeSelect.createEl('option', { text: TYPE_LABELS[t] });
      option.value = t;
    });
    this.typeSelect.addEventListener('change', () => {
      this.type = this.typeSelect.value;
      this.update();
    });
    this.update();
    window.setTimeout(() => (this.key ? this.typeSelect.focus() : this.keyInput.focus()), 0);
  }

  update() {
    const typed = this.keyInput.value.trim();
    const key = typed ? knownPropertyNames(this.app).find((n) => n.toLowerCase() === typed.toLowerCase()) || typed : '';
    const current = key ? propertyType(this.app, key) : null;
    const holders = key ? this.bulk.notesWithProperty(key).length : 0;
    this.keyHint.setText(key ? `${TYPE_LABELS[current] || 'Text'} · in ${bulkCount(holders, 'note')}` : '');
    if (!this.type && current) {
      this.type = current;
      this.typeSelect.value = current;
    }
    const lines = [];
    if (!key) {
      lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the property.' });
      return this.showSummary(lines, null);
    }
    if (!holders) {
      lines.push({ icon: 'info', cls: 'is-muted', text: `No note has a property called “${key}”.` });
      return this.showSummary(lines, null);
    }
    const type = this.type || current;
    const plan = this.bulk.planTypeChange(key, type);
    if (type === current && !plan.convert.length) {
      lines.push({ icon: 'check', cls: 'is-muted', text: `It’s ${TYPE_LABELS[type].toLowerCase()} already, and every value fits.` });
      return this.showSummary(lines, null);
    }
    lines.push({ icon: TYPE_ICONS[type] || 'text', text: `Makes “${key}” ${TYPE_LABELS[type].toLowerCase()} everywhere.` });
    if (plan.convert.length) lines.push({ icon: 'pencil', text: `Converts the value in ${bulkCount(plan.convert.length, 'note')}.` });
    if (plan.stuck.length) {
      lines.push({
        icon: 'alert-triangle',
        cls: 'is-warning',
        text: `${bulkCount(plan.stuck.length, 'note')} ${plan.stuck.length === 1 ? 'has a value' : 'have values'} that can’t be ${TYPE_LABELS[type].toLowerCase()}, so ${plan.stuck.length === 1 ? 'it’s' : 'they’re'} left as ${plan.stuck.length === 1 ? 'it is' : 'they are'}:`,
        notes: plan.stuck,
      });
    }
    this.showSummary(lines, {
      label: plan.convert.length ? `Change and convert ${bulkCount(plan.convert.length, 'note')}` : 'Change type',
      run: async () => {
        const record = await this.bulk.changeType(key, type);
        if (!record) return;
        const stuck = record.stuck && record.stuck.length ? ` ${bulkCount(record.stuck.length, 'note')} left as ${record.stuck.length === 1 ? 'it was' : 'they were'}: ${nameList(record.stuck.map((f) => f.basename), false)}.` : '';
        bulkNotice(this.bulk, `“${key}” is ${TYPE_LABELS[type].toLowerCase()} now; converted ${bulkCount(notesChanged(record), 'note')}.` + stuck + bulkTail(record), record);
      },
    });
  }
}

/**
 * The notes in some folders that are missing a property, each with a
 * field to fill it in — or one value for all of them at once.
 */
class MissingPropertyModal extends BulkModal {
  constructor(plugin, targets, key) {
    super(plugin);
    (targets || []).forEach((t) => this.addTarget(t));
    this.key = key || '';
    this.idleLabel = 'Fill';
    this.drawnFor = null;
  }

  onOpen() {
    this.frame('Find missing properties');
    this.targetsSection('In the notes in');
    const section = this.section();
    const key = this.field(section, 'Property', 'The property they should have');
    this.keyInput = key.input;
    this.keyInput.value = this.key;
    this.suggest(key.box, key.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.keyInput.value = v;
        this.update();
      },
    });
    this.listSection = this.section('Missing it');
    this.listEl = this.listSection.createDiv({ cls: 'dr-bulk-missing' });
    const all = this.section('Fill every one with');
    this.allInput = all.createDiv({ cls: 'dr-bulk-input' }).createEl('input', { type: 'text' });
    this.allInput.placeholder = 'A value for all of them';
    this.allInput.addEventListener('input', () => this.queueUpdate());
    this.allInput.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt)) return;
      evt.preventDefault();
      window.clearTimeout(this.updateTimer);
      this.update();
      if (this.action) this.go();
    });
    this.update();
    window.setTimeout(() => (this.key ? this.allInput.focus() : this.keyInput.focus()), 0);
  }

  resolvedKey() {
    const typed = this.keyInput.value.trim();
    if (!typed) return '';
    return knownPropertyNames(this.app).find((n) => n.toLowerCase() === typed.toLowerCase()) || typed;
  }

  /** One row per note: its name, and a field that fills it in on Enter. */
  renderMissing(key, missing, type) {
    const sig = key + '\u0000' + missing.map((f) => f.path).join('|');
    if (this.drawnFor === sig) return;
    this.drawnFor = sig;
    this.listEl.empty();
    this.listSection.toggleClass('is-hidden', !key || !missing.length);
    const shown = missing.slice(0, 60);
    shown.forEach((file) => {
      const row = this.listEl.createDiv({ cls: 'dr-bulk-missing-row' });
      const name = row.createSpan({ cls: 'dr-bulk-note', text: file.basename });
      name.setAttribute('role', 'link');
      name.setAttribute('tabindex', '0');
      onActivate(name, () => {
        this.close();
        this.app.workspace.getLeaf(false).openFile(file);
      });
      const input = row.createEl('input', { type: type === 'date' ? 'date' : 'text' });
      input.placeholder = LIST_TYPES.indexOf(type) !== -1 ? 'Items, separated by commas' : 'Value';
      input.setAttribute('aria-label', `${key} for ${file.basename}`);
      input.addEventListener('keydown', async (evt) => {
        if (evt.key !== 'Enter' || composing(evt)) return;
        evt.preventDefault();
        evt.stopPropagation();
        const value = parseTypedValue(type, input.value);
        if (isBlank(value)) return;
        input.disabled = true;
        const record = await this.bulk.fill([file], key, value, type);
        row.addClass('is-done');
        if (record) row.setAttribute('aria-label', `${file.basename}: filled`);
        const next = row.nextElementSibling && row.nextElementSibling.querySelector('input');
        if (next) next.focus();
      });
    });
    if (missing.length > shown.length) {
      this.listEl.createDiv({ cls: 'dr-bulk-hint', text: `and ${missing.length - shown.length} more` });
    }
  }

  update() {
    const key = this.resolvedKey();
    const files = this.bulk.notesFor(this.targets, this.reach);
    const missing = key ? this.bulk.missing(files, key) : [];
    const type = key ? propertyType(this.app, key) : 'text';
    if (this.listEl) this.renderMissing(key, missing, type);
    const lines = [];
    if (!this.targets.length) lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the folders to look in.' });
    else if (!key) lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the property to look for.' });
    else if (!missing.length) lines.push({ icon: 'check', text: `Every one of the ${bulkCount(files.length, 'note')} has “${key}”.` });
    if (lines.length) return this.showSummary(lines, null);
    lines.push({
      icon: 'search',
      text: `${bulkCount(missing.length, 'note')} of ${files.length} ${missing.length === 1 ? 'is' : 'are'} missing “${key}”. Fill one in and press Enter, or give them all one value below.`,
    });
    const value = parseTypedValue(type, this.allInput ? this.allInput.value : '');
    this.showSummary(lines, isBlank(value)
      ? null
      : {
          label: `Fill ${bulkCount(missing.length, 'note')}`,
          run: async () => {
            const record = await this.bulk.fill(missing, key, value, type);
            if (!record) return;
            bulkNotice(this.bulk, `Filled “${key}” in ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
          },
        });
  }
}

/**
 * Properties a folder gives every note made in it — and in its
 * subfolders — from then on. Uses the same rows as Add properties.
 */
class FolderDefaultsModal extends AddPropertiesModal {
  constructor(plugin, folder) {
    super(plugin, [folder]);
    this.folder = folder;
    this.alsoExisting = false;
    this.idleLabel = 'Save';
  }

  onOpen() {
    this.frame('Default properties');
    const intro = this.section();
    intro.createDiv({
      cls: 'dr-bulk-hint dr-bulk-intro',
      text: `New notes in “${this.folder.name || this.app.vault.getName()}” and its subfolders get these, where they don’t have them already.`,
    });
    const what = this.section('Properties');
    this.rowsEl = what.createDiv({ cls: 'dr-bulk-rows' });
    const add = what.createDiv({ cls: 'dr-bulk-add' });
    add.setAttribute('role', 'button');
    add.setAttribute('tabindex', '0');
    setIcon(add.createSpan({ cls: 'dr-bulk-add-icon' }), 'plus');
    add.createSpan({ text: 'Add another property' });
    onActivate(add, () => {
      this.rows.push(this.newRow());
      this.renderRows();
      const last = this.rowsEl.querySelector('.dr-bulk-row:last-child .dr-bulk-name input');
      if (last) last.focus();
    });
    const existing = this.section();
    const label = existing.createEl('label', { cls: 'dr-bulk-check' });
    const box = label.createEl('input', { type: 'checkbox' });
    this.existingCount = label.createSpan({ text: 'Also add them to the notes already here' });
    box.addEventListener('change', () => {
      this.alsoExisting = box.checked;
      this.update();
    });

    const saved = (this.plugin.settings.folderDefaults || {})[this.folder.path] || [];
    saved.forEach((p) => {
      const row = this.newRow();
      row.key = p.key;
      row.type = p.type || propertyType(this.app, p.key);
      row.raw = p.type === 'checkbox' ? p.value === true : Array.isArray(p.value) ? p.value.join(', ') : p.value === null || p.value === undefined ? '' : String(p.value);
      this.rows.push(row);
    });
    if (!this.rows.length) this.rows.push(this.newRow());
    this.renderRows();
    this.update();
  }

  update() {
    const named = this.rows.filter((r) => r.key);
    const lines = [];
    const seen = new Set();
    let problem = '';
    named.forEach((r) => {
      const k = r.key.toLowerCase();
      if (!problem && seen.has(k)) problem = `“${r.key}” is listed twice.`;
      seen.add(k);
      if (!problem) problem = propertyNameProblem(r.key);
    });
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }
    const props = named.map((r) => ({ key: r.key, value: parseTypedValue(r.type, r.raw), type: r.type }));
    const saved = (this.plugin.settings.folderDefaults || {})[this.folder.path] || [];
    const files = this.bulk.notesFor([this.folder], 'deep');
    const changing = this.alsoExisting && props.length ? this.bulk.planAdd(files, props, false).changing : [];
    if (this.existingCount) {
      this.existingCount.setText(`Also add them to the ${bulkCount(files.length, 'note')} already here`);
    }
    if (props.length) {
      lines.push({ icon: 'file-plus', text: `New notes here get ${nameList(props.map((p) => p.key))}.` });
    } else if (saved.length) {
      lines.push({ icon: 'x', cls: 'is-muted', text: 'Saving with none takes this folder’s defaults away.' });
    } else {
      lines.push({ icon: 'info', cls: 'is-muted', text: 'Name a property new notes here should have.' });
      return this.showSummary(lines, null);
    }
    if (changing.length) lines.push({ icon: 'plus', text: `And adds them now to ${bulkCount(changing.length, 'note')} already here.` });
    this.showSummary(lines, {
      label: changing.length ? `Save and add to ${bulkCount(changing.length, 'note')}` : 'Save',
      run: async () => {
        const all = Object.assign({}, this.plugin.settings.folderDefaults);
        if (props.length) all[this.folder.path] = props.map((p) => ({ key: p.key, value: p.value, type: p.type }));
        else delete all[this.folder.path];
        this.plugin.settings.folderDefaults = all;
        await this.plugin.saveData(this.plugin.settings);
        if (changing.length) {
          const record = await this.bulk.addProperties(files, props, false);
          if (record) bulkNotice(this.bulk, `Saved, and added them to ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
        } else {
          new Notice(props.length ? 'Default properties saved.' : 'Default properties removed.');
        }
      },
    });
  }
}

/* -- where they're reached from ---------------------------------------- */

/**
 * Commands for the three, and menu entries where they belong: a
 * folder's menu (Obsidian's file explorer, and every folder here), a
 * selection of several in the explorer, and a tag under the cursor.
 */
/* How long a new note is left for a template to fill before defaults go in. */
const DEFAULTS_DELAY = 800;

/**
 * The property tools as one window: Add, Remove, Find missing and — for
 * a single folder — the defaults its new notes get, as tabs across the
 * top. Each tab is one of the dialogs above, drawn into this window
 * rather than opening its own, so switching is instant and the folders
 * chosen carry across.
 */
class PropertyToolsModal extends Modal {
  constructor(plugin, targets, tab, args) {
    super(plugin.app);
    this.plugin = plugin;
    this.targets = (targets || []).slice();
    this.tab = tab || 'add';
    this.args = args || {};
    this.tool = null;
    // Defaults belong to one folder, so the tab is there only for one.
    const only = this.targets.length === 1 ? this.targets[0] : null;
    this.folder = only instanceof TFolder && !only.isRoot() ? only : null;
  }

  tabs() {
    const list = [
      ['add', 'Add', 'list-plus'],
      ['remove', 'Remove', 'list-minus'],
      ['missing', 'Find missing', 'list-checks'],
    ];
    if (this.folder) list.push(['defaults', 'Defaults', 'file-cog']);
    return list;
  }

  make(id) {
    const targets = this.tool ? this.tool.targets.slice() : this.targets;
    if (id === 'remove') return new RemovePropertiesModal(this.plugin, targets, this.args.keys);
    if (id === 'missing') return new MissingPropertyModal(this.plugin, targets, this.args.key);
    if (id === 'defaults') return new FolderDefaultsModal(this.plugin, this.folder);
    return new AddPropertiesModal(this.plugin, targets);
  }

  onOpen() {
    this.modalEl.addClass('dr-bulk-modal', 'dr-props-modal');
    const names = this.targets.map((t) => (t instanceof TFolder ? t.name || this.app.vault.getName() : t.basename));
    this.titleEl.setText(
      names.length === 1 ? `Properties · ${names[0]}` : names.length ? `Properties · ${names.length} items` : 'Properties'
    );
    const bar = this.contentEl.createDiv({ cls: 'dr-set-tabs dr-props-tabs' });
    bar.setAttribute('role', 'tablist');
    roveFocus(bar, '.dr-set-tab');
    this.buttons = {};
    this.tabs().forEach(([id, label, icon]) => {
      const button = bar.createEl('button', { cls: 'dr-set-tab' });
      button.setAttribute('role', 'tab');
      setIcon(button.createSpan({ cls: 'dr-set-tab-icon' }), icon);
      button.createSpan({ text: label });
      button.addEventListener('click', () => this.show(id));
      this.buttons[id] = button;
    });
    this.panel = this.contentEl.createDiv({ cls: 'dr-props-panel' });
    this.panel.setAttribute('role', 'tabpanel');
    this.show(this.buttons[this.tab] ? this.tab : 'add');
  }

  /** Draw one tool in the panel, closing the last one properly first. */
  show(id) {
    if (this.tool) {
      try {
        this.tool.onClose();
      } catch (err) {
        /* it was only drawing */
      }
    }
    Object.keys(this.buttons).forEach((key) => {
      this.buttons[key].toggleClass('is-active', key === id);
      this.buttons[key].setAttribute('aria-selected', String(key === id));
    });
    this.tab = id;
    this.panel.empty();
    const tool = this.make(id);
    // Its window is this one: the panel for its content, a spare for its
    // title (the tab says what it is), and closing closes this.
    tool.modalEl = this.modalEl;
    tool.titleEl = document.createElement('div');
    tool.contentEl = this.panel;
    tool.close = () => this.close();
    this.tool = tool;
    tool.onOpen();
  }

  onClose() {
    if (this.tool) {
      try {
        this.tool.onClose();
      } catch (err) {
        /* nothing more to tidy */
      }
    }
    this.tool = null;
    this.contentEl.empty();
  }
}

class BulkEditing extends Feature {
  commands() {
    return [
      {
        id: 'add-properties-to-folders',
        name: 'Add properties to folders…',
        run: () => {
          const folder = pageFolder(this.app);
          this.openAdd(folder && !(folder.isRoot && folder.isRoot()) ? [folder] : []);
        },
      },
      {
        id: 'rename-property-everywhere',
        name: 'Rename a property everywhere…',
        run: () => this.openRenameProperty(),
      },
      {
        id: 'rename-tag-everywhere',
        name: 'Rename a tag everywhere…',
        run: () => this.openRenameTag(),
      },
      {
        id: 'remove-properties-from-folders',
        name: 'Remove properties from folders…',
        run: () => this.openRemove(this.pageFolderTargets()),
      },
      {
        id: 'rename-value-everywhere',
        name: 'Rename a property value everywhere…',
        run: () => this.openRenameValue(),
      },
      {
        id: 'change-property-type',
        name: 'Change a property’s type…',
        run: () => this.openChangeType(),
      },
      {
        id: 'find-missing-properties',
        name: 'Find notes missing a property…',
        run: () => this.openMissing(this.pageFolderTargets()),
      },
      {
        id: 'folder-default-properties',
        name: 'Default properties for this folder…',
        check: () => this.pageFolderTargets().length > 0,
        run: () => this.openDefaults(this.pageFolderTargets()[0]),
      },
      {
        id: 'undo-bulk-change',
        name: 'Undo the last bulk change',
        check: () => !!this.plugin.bulk.last,
        run: () => this.plugin.bulk.undo(),
      },
    ];
  }

  /** The folder the page is in, as a starting point, unless it's the vault itself. */
  pageFolderTargets() {
    const folder = pageFolder(this.app);
    return folder && !(folder.isRoot && folder.isRoot()) ? [folder] : [];
  }

  /** The one Properties window, open at a tab. */
  openTools(targets, tab, args) {
    new PropertyToolsModal(this.plugin, targets, tab, args).open();
  }

  openRemove(targets, keys) {
    this.openTools(targets, 'remove', { keys: keys });
  }

  openRenameValue(key, value) {
    new RenameValueModal(this.plugin, key, value).open();
  }

  openChangeType(key) {
    new ChangeTypeModal(this.plugin, key).open();
  }

  openMissing(targets, key) {
    this.openTools(targets, 'missing', { key: key });
  }

  openDefaults(folder) {
    if (folder) this.openTools([folder], 'defaults');
  }

  /**
   * The defaults a note gets from the folders it's in: every folder up
   * from it that has some, the nearest deciding where two name the same
   * property.
   */
  defaultsFor(file) {
    const all = this.settings.folderDefaults || {};
    const chain = [];
    for (let f = file.parent; f; f = f.parent) {
      if (all[f.path]) chain.unshift(all[f.path]);
      if (f.isRoot && f.isRoot()) break;
    }
    const merged = new Map();
    chain.forEach((props) =>
      (props || []).forEach((p) => {
        if (p && p.key) merged.set(p.key.toLowerCase(), p);
      })
    );
    return Array.from(merged.values());
  }

  /**
   * A note made in a folder with defaults gets them — only what it
   * doesn't have, a moment after it's made, so a template filling it in
   * goes first and its values win. A folder's own note describes the
   * folder, and is left out.
   */
  applyDefaults(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || !file.parent) return;
    const props = this.defaultsFor(file);
    if (!props.length) return;
    const pattern = this.settings.folderNoteName || '{{folder}}';
    if (file.basename === pattern.replace(/\{\{folder\}\}/g, file.parent.name)) return;
    window.setTimeout(async () => {
      if (this.app.vault.getFileByPath(file.path) !== file) return;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) =>
          props.forEach((p) => {
            if (keyLike(fm, p.key) === undefined) fm[p.key] = JSON.parse(JSON.stringify(p.value === undefined ? null : p.value));
          })
        );
      } catch (err) {
        console.error('Design Redux: could not add default properties', err);
      }
    }, DEFAULTS_DELAY);
  }

  /** Defaults follow their folder when it's renamed or moved, and go with it. */
  followFolder(file, oldPath) {
    const all = this.settings.folderDefaults || {};
    if (!(file instanceof TFolder) || !Object.keys(all).length) return;
    const next = {};
    let changed = false;
    Object.keys(all).forEach((p) => {
      if (oldPath === null) {
        if (p === file.path || p.startsWith(file.path + '/')) {
          changed = true;
          return;
        }
        next[p] = all[p];
        return;
      }
      const moved = movedPath(p, oldPath, file.path);
      if (moved !== p) changed = true;
      next[moved] = all[p];
    });
    if (!changed) return;
    this.settings.folderDefaults = next;
    this.plugin.saveData(this.settings);
  }

  openAdd(targets) {
    this.openTools(targets, 'add');
  }

  openRenameProperty(from) {
    new RenamePropertyModal(this.plugin, from).open();
  }

  openRenameTag(from) {
    new RenameTagModal(this.plugin, from).open();
  }

  register() {
    const ws = this.app.workspace;
    const section = (item, name) => {
      if (typeof item.setSection === 'function') item.setSection(name);
      return item;
    };

    this.plugin.registerEvent(
      ws.on('file-menu', (menu, file) => {
        if (!(file instanceof TFolder) || (file.isRoot && file.isRoot())) return;
        // One entry, opening one window with a tab for each tool.
        menu.addItem((item) =>
          section(item, 'action')
            .setTitle('Properties…')
            .setIcon('list')
            .onClick(() => this.openTools([file], 'add'))
        );
      })
    );
    // New notes get their folder's defaults; defaults follow their folder.
    this.plugin.registerEvent(this.app.vault.on('create', (file) => this.applyDefaults(file)));
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.followFolder(file, oldPath)));
    this.plugin.registerEvent(this.app.vault.on('delete', (file) => this.followFolder(file, null)));

    // Several chosen in the file explorer at once.
    this.plugin.registerEvent(
      ws.on('files-menu', (menu, files) => {
        const targets = (files || []).filter(
          (f) => (f instanceof TFolder && !(f.isRoot && f.isRoot())) || (f instanceof TFile && f.extension === 'md')
        );
        if (!targets.length) return;
        const folders = targets.filter((f) => f instanceof TFolder).length;
        const notes = targets.length - folders;
        const parts = [];
        if (folders) parts.push(bulkCount(folders, 'folder'));
        if (notes) parts.push(bulkCount(notes, 'note'));
        menu.addItem((item) =>
          section(item, 'action')
            .setTitle(`Properties of ${parts.join(' and ')}…`)
            .setIcon('list')
            .onClick(() => this.openTools(targets, 'add'))
        );
      })
    );

    // A tag under the cursor, going by where Obsidian found tags.
    this.plugin.registerEvent(
      ws.on('editor-menu', (menu, editor, info) => {
        const file = info && info.file;
        if (!file || !editor || typeof editor.getCursor !== 'function') return;
        const at = editor.getCursor();
        const cache = this.app.metadataCache.getFileCache(file);
        const tag = ((cache && cache.tags) || []).find(
          (t) =>
            t.position &&
            t.position.start.line === at.line &&
            t.position.start.col <= at.ch &&
            at.ch <= t.position.end.col
        );
        if (!tag) return;
        menu.addItem((item) =>
          section(item, 'action')
            .setTitle(`Rename ${tag.tag} everywhere…`)
            .setIcon('hash')
            .onClick(() => this.openRenameTag(tag.tag))
        );
      })
    );
  }
}

/* ------------------------------------------------------------------ */
/* Canvas legend                                                       */
/*                                                                     */
/* A card in the corner of a canvas naming what its colours mean — the */
/* key a map has. The names are kept by the plugin, per canvas, since  */
/* Obsidian rewrites a canvas file with only what it knows of. Picking */
/* a colour fades the cards of every other, so they're easy to find.   */
/* ------------------------------------------------------------------ */

/* Obsidian's six card colours, by the number a canvas file keeps them as. */
const CANVAS_COLOURS = { 1: 'Red', 2: 'Orange', 3: 'Yellow', 4: 'Green', 5: 'Cyan', 6: 'Purple' };

/** A card's colour as the legend keys it: '1'–'6', '#rrggbb', or 'none'. */
function canvasColorKey(color) {
  if (color === undefined || color === null || color === '') return 'none';
  const c = String(color).trim();
  if (/^[1-6]$/.test(c)) return c;
  return normalHex(c) || 'none';
}

/**
 * The colours a canvas uses and how many cards have each, in the order
 * a legend lists them: Obsidian's six, then any others by how common
 * they are, then the uncoloured — which only needs a name beside others.
 */
function canvasColorCounts(nodes) {
  const counts = new Map();
  (nodes || []).forEach((node) => {
    const key = canvasColorKey(node && node.color);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const keys = Object.keys(CANVAS_COLOURS).filter((k) => counts.has(k));
  Array.from(counts.keys())
    .filter((k) => k.charAt(0) === '#')
    .sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b))
    .forEach((k) => keys.push(k));
  if (counts.has('none') && keys.length) keys.push('none');
  return keys.map((key) => ({ key, count: counts.get(key) }));
}

class CanvasLegend extends Feature {
  constructor(plugin) {
    super(plugin);
    // Each open canvas view, and what's drawn in it.
    this.mounted = new Map();
    this.saveTimer = 0;
  }

  settingsSchema() {
    return [
      {
        key: 'canvasLegend',
        name: 'Canvas legend',
        desc: 'A card in the corner of each canvas naming what its colours mean. Click a colour to fade out the rest. The legend button among the canvas controls hides it.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'toggle-canvas-legend',
        name: 'Show or hide the canvas legend',
        icon: 'list',
        check: () => !!this.pageCanvas(),
        run: () => this.toggleHidden(this.pageCanvas()),
      },
    ];
  }

  register() {
    // A canvas saves itself a moment after each change; the counts follow.
    this.plugin.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!this.enabled || !(file instanceof TFile) || file.extension !== 'canvas') return;
        this.mounted.forEach((state, view) => {
          if (state.file === file) this.refresh(view);
        });
      })
    );
    this.plugin.registerEvent(this.app.workspace.on('file-open', () => this.plugin.queueSync()));
  }

  enable() {
    this.sync();
  }

  disable() {
    Array.from(this.mounted.keys()).forEach((view) => this.unmount(view));
  }

  sync() {
    // Let go of canvases that have closed, or moved on to another file.
    this.mounted.forEach((state, view) => {
      if (!state.panel.isConnected || view.file !== state.file) this.unmount(view);
    });
    this.app.workspace.getLeavesOfType('canvas').forEach((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (view && view.file && view.contentEl && !this.mounted.has(view)) this.mount(view);
    });
  }

  pageCanvas() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && this.mounted.has(view) ? view : null;
  }

  /* -- what's kept, per canvas -------------------------------------- */

  entry(file) {
    return (this.settings.canvasLegends || {})[file.path] || {};
  }

  keep(file, patch) {
    const all = Object.assign({}, this.settings.canvasLegends || {});
    const next = Object.assign({}, all[file.path] || {}, patch);
    if (next.labels) {
      next.labels = Object.assign({}, next.labels);
      Object.keys(next.labels).forEach((k) => {
        if (!String(next.labels[k] || '').trim()) delete next.labels[k];
      });
      if (!Object.keys(next.labels).length) delete next.labels;
    }
    if (!next.collapsed) delete next.collapsed;
    if (!next.hidden) delete next.hidden;
    if (Object.keys(next).length) all[file.path] = next;
    else delete all[file.path];
    this.settings.canvasLegends = all;
    // Straight to disk: saveSettings would redraw every feature, and
    // with it the field being typed in.
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.plugin.saveData(this.settings), 300);
  }

  /* -- drawing ------------------------------------------------------- */

  mount(view) {
    const host = view.contentEl;
    host.addClass('dr-canvas-host');
    const panel = host.createDiv({ cls: 'dr-legend' });
    const state = { panel, file: view.file, focus: null, observer: null, control: null, stale: false };
    this.mounted.set(view, state);

    // Beside the canvas's own zoom and help buttons, to hide and show it.
    const controls = view.containerEl.querySelector('.canvas-controls');
    if (controls) {
      const group = controls.createDiv({ cls: 'canvas-control-group dr-legend-control' });
      const item = group.createDiv({ cls: 'canvas-control-item' });
      item.setAttribute('aria-label', 'Legend');
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      setIcon(item, 'list');
      onActivate(item, () => this.toggleHidden(view));
      state.control = group;
    }
    this.refresh(view);
  }

  unmount(view) {
    const state = this.mounted.get(view);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    state.panel.remove();
    if (state.control) state.control.remove();
    const host = view.contentEl;
    if (host) {
      host.removeClass('dr-canvas-host', 'dr-canvas-focus');
      host.querySelectorAll('.dr-legend-match').forEach((el) => el.removeClass('dr-legend-match'));
    }
    this.mounted.delete(view);
  }

  /**
   * The cards: live from the canvas where it lets them be read — which
   * isn't public, so it's asked carefully — or from its file.
   */
  async nodesOf(view, file) {
    try {
      const data = view.canvas && typeof view.canvas.getData === 'function' ? view.canvas.getData() : null;
      if (data && Array.isArray(data.nodes)) return data.nodes;
    } catch (err) {
      /* the file, then */
    }
    try {
      const parsed = JSON.parse((await this.app.vault.cachedRead(file)) || '{}');
      return Array.isArray(parsed.nodes) ? parsed.nodes : [];
    } catch (err) {
      return [];
    }
  }

  async refresh(view) {
    const state = this.mounted.get(view);
    if (!state) return;
    // Not while a colour is being named: that would take the field away.
    if (state.panel.contains(state.panel.ownerDocument.activeElement)) {
      state.stale = true;
      return;
    }
    state.rows = canvasColorCounts(await this.nodesOf(view, state.file));
    if (!this.mounted.has(view)) return;
    // A colour no card has any more can't stay picked.
    if (state.focus && !state.rows.some((r) => r.key === state.focus)) state.focus = null;
    this.render(view, state);
    this.applyFocus(view, state);
  }

  swatch(el, key) {
    el.addClass('dr-legend-dot');
    if (key === 'none') el.addClass('is-none');
    else if (CANVAS_COLOURS[key]) el.style.setProperty('background-color', `rgb(var(--canvas-color-${key}))`);
    else el.style.setProperty('background-color', key);
  }

  colourName(key) {
    if (key === 'none') return 'No colour';
    return CANVAS_COLOURS[key] || key;
  }

  render(view, state) {
    const { panel } = state;
    const saved = this.entry(state.file);
    const labels = saved.labels || {};
    const rows = state.rows || [];
    panel.empty();
    panel.toggleClass('is-hidden', !!saved.hidden);
    panel.toggleClass('is-collapsed', !!saved.collapsed);
    if (state.control) {
      const item = state.control.querySelector('.canvas-control-item');
      if (item) item.toggleClass('is-active', !saved.hidden);
    }

    const head = panel.createDiv({ cls: 'dr-legend-head' });
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', String(!saved.collapsed));
    head.createSpan({ cls: 'dr-legend-title', text: 'Legend' });
    // Folded away, the colours still show, as a row of dots.
    if (saved.collapsed) {
      const dots = head.createSpan({ cls: 'dr-legend-dots' });
      rows.filter((r) => r.key !== 'none').forEach((r) => this.swatch(dots.createSpan(), r.key));
    }
    setIcon(head.createSpan({ cls: 'dr-legend-chevron' }), saved.collapsed ? 'chevron-down' : 'chevron-up');
    onActivate(head, () => {
      this.keep(state.file, { collapsed: !saved.collapsed });
      this.render(view, state);
    });
    if (saved.collapsed) return;

    if (!rows.length) {
      panel.createDiv({ cls: 'dr-legend-empty', text: 'Colour some cards, then name the colours here.' });
      return;
    }

    const list = panel.createDiv({ cls: 'dr-legend-rows' });
    rows.forEach(({ key, count }) => {
      const row = list.createDiv({ cls: 'dr-legend-row' });
      row.dataset.key = key;
      row.toggleClass('is-focused', state.focus === key);
      const dot = row.createDiv();
      this.swatch(dot, key);
      dot.setAttribute('role', 'button');
      dot.setAttribute('tabindex', '0');
      dot.setAttribute('aria-label', `Show only the ${this.colourName(key).toLowerCase()} cards`);
      dot.setAttribute('aria-pressed', String(state.focus === key));
      onActivate(dot, () => this.setFocus(view, key));

      const name = row.createEl('input', { cls: 'dr-legend-name', type: 'text' });
      name.value = labels[key] || '';
      name.placeholder = this.colourName(key);
      name.setAttribute('aria-label', `Name for ${this.colourName(key).toLowerCase()}`);
      name.addEventListener('input', () => {
        const next = Object.assign({}, this.entry(state.file).labels || {});
        next[key] = name.value;
        this.keep(state.file, { labels: next });
      });
      // The canvas's own keys (Delete takes a card away) stay out of it.
      name.addEventListener('keydown', (evt) => {
        evt.stopPropagation();
        if (evt.key === 'Enter' || evt.key === 'Escape') name.blur();
      });
      name.addEventListener('blur', () => {
        if (!state.stale) return;
        state.stale = false;
        window.setTimeout(() => this.refresh(view), 0);
      });

      row.createSpan({ cls: 'dr-legend-count', text: String(count) });
      row.addEventListener('click', (evt) => {
        if (evt.target === name || evt.target === dot || dot.contains(evt.target)) return;
        this.setFocus(view, key);
      });
    });

    if (state.focus) {
      const all = panel.createDiv({ cls: 'dr-legend-all', text: 'Show every card' });
      all.setAttribute('role', 'button');
      all.setAttribute('tabindex', '0');
      onActivate(all, () => this.setFocus(view, state.focus));
    }
  }

  toggleHidden(view) {
    const state = view ? this.mounted.get(view) : null;
    if (!state) return;
    const hidden = !this.entry(state.file).hidden;
    this.keep(state.file, { hidden });
    if (hidden && state.focus) state.focus = null;
    this.render(view, state);
    this.applyFocus(view, state);
  }

  /* -- picking a colour ---------------------------------------------- */

  /** Picking the picked colour again shows every card. */
  setFocus(view, key) {
    const state = this.mounted.get(view);
    if (!state) return;
    state.focus = state.focus === key ? null : key;
    this.render(view, state);
    this.applyFocus(view, state);
  }

  /**
   * The cards on screen with their colours. The canvas's own list where
   * it can be read; otherwise the page, where Obsidian's six colours are
   * marked by class — a colour of your own can't be told that way.
   */
  cardsOf(view) {
    try {
      const nodes = view.canvas && view.canvas.nodes;
      if (nodes && typeof nodes.forEach === 'function') {
        const out = [];
        nodes.forEach((node) => {
          if (node && node.nodeEl) out.push({ el: node.nodeEl, key: canvasColorKey(node.color) });
        });
        if (out.length) return out;
      }
    } catch (err) {
      /* the page, then */
    }
    return Array.from(view.contentEl.querySelectorAll('.canvas-node')).map((el) => {
      const cls = Array.from(el.classList).find((c) => /^mod-canvas-color-[1-6]$/.test(c));
      return { el, key: cls ? cls.slice(-1) : el.style.getPropertyValue('--canvas-color') ? '?' : 'none' };
    });
  }

  applyFocus(view, state) {
    const host = view.contentEl;
    const on = !!state.focus && !this.entry(state.file).hidden;
    host.toggleClass('dr-canvas-focus', on);
    const mark = () => this.cardsOf(view).forEach(({ el, key }) => el.toggleClass('dr-legend-match', on && key === state.focus));
    mark();
    // Cards drawn later — scrolled to, added, recoloured — are marked as they come.
    if (on && !state.observer && typeof MutationObserver === 'function') {
      let frame = 0;
      state.observer = new MutationObserver(() => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          if (state.focus) mark();
        });
      });
      state.observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    } else if (!on && state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }
}

CanvasLegend.settingKey = 'canvasLegend';

/* ------------------------------------------------------------------ */
/* Centred text in canvas cards                                        */
/*                                                                     */
/* A canvas card has no alignment of its own, and a canvas file keeps  */
/* only what Obsidian knows of, so which cards are centred is kept by  */
/* the plugin, by canvas and card. The card's toolbar gets a button,   */
/* its right-click menu an entry, and there's a command to bind.       */
/* ------------------------------------------------------------------ */

/** Cards whose text can be centred: text cards, and notes. */
function alignable(node) {
  try {
    const data = node && typeof node.getData === 'function' ? node.getData() : node;
    if (data && data.type === 'text') return true;
    if (data && data.type === 'file') return /\.md$/i.test(String(data.file || ''));
    return !!node && typeof node.text === 'string';
  } catch (err) {
    return false;
  }
}

class CanvasAlign extends Feature {
  constructor(plugin) {
    super(plugin);
    this.watched = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'canvasTextAlign',
        name: 'Centred text',
        desc: 'Center the text in a canvas card, from the button in the bar above a selected card or its right-click menu.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'center-canvas-text',
        name: 'Center text in the selected cards',
        icon: 'align-center',
        check: () => this.selected(this.pageCanvas()).length > 0,
        run: () => {
          const view = this.pageCanvas();
          this.toggle(view, this.selected(view));
        },
      },
    ];
  }

  register() {
    const ws = this.app.workspace;
    // The canvas's own menus, which it announces for plugins to add to.
    this.plugin.registerEvent(
      ws.on('canvas:node-menu', (menu, node) => {
        if (this.enabled) this.addMenuItem(menu, [node]);
      })
    );
    this.plugin.registerEvent(
      ws.on('canvas:selection-menu', (menu, canvas) => {
        if (this.enabled && canvas) this.addMenuItem(menu, Array.from(canvas.selection || []));
      })
    );
    this.plugin.registerEvent(ws.on('file-open', () => this.plugin.queueSync()));
  }

  enable() {
    this.sync();
  }

  disable() {
    Array.from(this.watched.keys()).forEach((view) => this.unwatch(view));
  }

  sync() {
    this.watched.forEach((state, view) => {
      if (!view.contentEl || !view.contentEl.isConnected || view.file !== state.file) this.unwatch(view);
    });
    this.app.workspace.getLeavesOfType('canvas').forEach((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (view && view.file && view.contentEl && view.canvas && !this.watched.has(view)) this.watch(view);
    });
  }

  pageCanvas() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && view.canvas && view.file && view.file.extension === 'canvas' ? view : null;
  }

  /** The selected cards that can be centred. The selection isn't public, so it's asked carefully. */
  selected(view) {
    try {
      return view ? Array.from(view.canvas.selection || []).filter(alignable) : [];
    } catch (err) {
      return [];
    }
  }

  alignments(file) {
    return (this.settings.canvasAlignments || {})[file.path] || {};
  }

  isCentred(view, node) {
    return this.alignments(view.file)[node.id] === 'center';
  }

  /** Center them all — or, if they all are already, put them back. */
  toggle(view, nodes) {
    const cards = (nodes || []).filter(alignable);
    if (!view || !view.file || !cards.length) return;
    const all = Object.assign({}, this.settings.canvasAlignments || {});
    const mine = Object.assign({}, all[view.file.path] || {});
    const centre = !cards.every((node) => mine[node.id] === 'center');
    cards.forEach((node) => {
      if (centre) mine[node.id] = 'center';
      else delete mine[node.id];
    });
    if (Object.keys(mine).length) all[view.file.path] = mine;
    else delete all[view.file.path];
    this.settings.canvasAlignments = all;
    this.plugin.saveData(this.settings);
    this.apply(view);
    this.decorateMenu(view);
  }

  addMenuItem(menu, nodes) {
    const first = nodes[0];
    const view = first && first.canvas && first.canvas.view;
    const cards = nodes.filter(alignable);
    if (!view || !view.file || !cards.length) return;
    const on = cards.every((node) => this.isCentred(view, node));
    menu.addItem((item) =>
      item
        .setTitle(on ? 'Stop centering text' : 'Center text')
        .setIcon(on ? 'align-left' : 'align-center')
        .onClick(() => this.toggle(view, cards))
    );
  }

  /**
   * Cards are drawn as they come into view, and the bar above a
   * selection is rebuilt as it changes, so both are looked over again
   * whenever the canvas redraws — once a frame at most.
   */
  watch(view) {
    const state = { file: view.file, frame: 0, observer: null };
    this.watched.set(view, state);
    const pass = () => {
      state.frame = 0;
      this.apply(view);
      this.decorateMenu(view);
    };
    if (typeof MutationObserver === 'function') {
      state.observer = new MutationObserver(() => {
        if (!state.frame) state.frame = window.requestAnimationFrame(pass);
      });
      state.observer.observe(view.contentEl, { childList: true, subtree: true });
    }
    pass();
  }

  unwatch(view) {
    const state = this.watched.get(view);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.frame) window.cancelAnimationFrame(state.frame);
    if (view.contentEl) {
      view.contentEl.querySelectorAll('.dr-text-center').forEach((el) => el.removeClass('dr-text-center'));
      view.contentEl.querySelectorAll('.dr-align-button').forEach((el) => el.remove());
    }
    this.watched.delete(view);
  }

  apply(view) {
    const mine = this.alignments(view.file);
    try {
      view.canvas.nodes.forEach((node) => {
        if (node && node.nodeEl) node.nodeEl.toggleClass('dr-text-center', mine[node.id] === 'center');
      });
    } catch (err) {
      /* nothing to mark */
    }
  }

  /**
   * A button in the bar that floats above selected cards, beside
   * Obsidian's own. Only redrawn when what it shows changes, since
   * drawing it is itself a change the watcher would see.
   */
  decorateMenu(view) {
    const bar = view.contentEl.querySelector('.canvas-menu');
    if (!bar) return;
    const cards = this.selected(view);
    let button = bar.querySelector('.dr-align-button');
    if (!cards.length) {
      if (button) button.remove();
      return;
    }
    if (!button) {
      button = bar.createEl('button', { cls: 'clickable-icon dr-align-button' });
      button.addEventListener('click', (evt) => {
        evt.stopPropagation();
        this.toggle(view, this.selected(view));
      });
    }
    const on = cards.every((node) => this.isCentred(view, node));
    if (button.dataset.on === String(on)) return;
    button.dataset.on = String(on);
    button.empty();
    setIcon(button, on ? 'align-left' : 'align-center');
    button.setAttribute('aria-label', on ? 'Stop centering text' : 'Center text');
    button.toggleClass('is-active', on);
  }
}

CanvasAlign.settingKey = 'canvasTextAlign';

/* ------------------------------------------------------------------ */
/* Plugin: lifecycle only                                              */
/* ------------------------------------------------------------------ */

class DesignRedux extends Plugin {
  async onload() {
    await this.loadSettings();

    this.unloading = false;
    this.pins = new Pins(this);
    this.orders = new Orders(this);
    this.bulk = new BulkEdits(this);
    this.features = [
      new Library(this),
      new ActionsMenu(this),
      new PropertiesPanel(this),
      new ContextStrip(this),
      new OnePage(this),
      new MenuFilter(this),
      new SettingsButton(this),
      new CoverImages(this),
      new ImageRouter(this),
      new PropertyClipboard(this),
      new MarkedLists(this),
      new Scripts(this),
      new GraphPropertyFilter(this),
      new CanvasLegend(this),
      new CanvasAlign(this),
      new BulkEditing(this),
    ];

    this.syncFrame = 0;
    // Before the workspace is restored, so saved leaves of these types
    // can be rebuilt rather than dropped.
    this.each((f) => f.registerTypes());

    this.addSettingTab(new DesignReduxSettingTab(this.app, this));

    // Registered once, never withdrawn: Obsidian has no public way to
    // remove a command, so a disabled feature hides its own instead.
    this.features.forEach((feature) => {
      feature.commands().forEach((cmd) => {
        this.addCommand({
          id: cmd.id,
          name: cmd.name,
          // An icon lets a command sit in the phone's editing toolbar.
          ...(cmd.icon ? { icon: cmd.icon } : {}),
          ...(cmd.hotkeys ? { hotkeys: cmd.hotkeys } : {}),
          checkCallback: (checking) => {
            const ok = cmd.check ? cmd.check() : true;
            if (checking || !ok) return ok;
            cmd.run();
            return true;
          },
        });
      });
    });

    this.app.workspace.onLayoutReady(() => {
      this.each((f) => f.register());
      this.refresh();
      // Stray library panes left by an old version are cleared. Browse
      // pages aren't: several are normal — tabs, splits, one per page.
      this.each((f) => {
        if (typeof f.singleLeaf !== 'function') return;
        f.singleLeaf(LIBRARY_VIEW);
      });

      this.registerEvent(this.app.workspace.on('layout-change', () => this.queueSync()));
      // Arrangements follow the files they name.
      this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.orders.followRename(file, oldPath)));
      this.registerEvent(this.app.vault.on('delete', (file) => this.orders.followDelete(file)));
      this.registerEvent(
        this.app.workspace.on('active-leaf-change', () => this.queueSync())
      );
    });
  }

  /**
   * Runs once, when the plugin is first enabled — not on every load.
   * The official place to set up a custom view, so the library appears
   * without the user having to find the command.
   */
  async onUserEnable() {
    const library = this.feature(Library);
    if (library && library.enabled) await library.reveal();
  }

  onunload() {
    // Marked before features are torn down: leaves must survive an
    // unload, since Obsidian restores them itself when the plugin is
    // updated or re-enabled. Detaching here loses their position.
    this.unloading = true;
    window.clearTimeout(this.refreshTimer);
    if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame);
    this.each((f) => f.disable());
  }

  /** Ask for an image and record it on the note itself. */
  setNoteCover(file) {
    const covers = this.feature(CoverImages);
    new ImagePicker(this.app, (image) =>
      covers.setCover(file, covers.linkTo(image, file))
    ).open();
  }

  async clearNoteCover(file) {
    const key = this.settings.coverProperty || 'cover';
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        delete fm[key];
      });
    } catch (err) {
      console.error('Design Redux: could not clear the cover', err);
      new Notice('Could not update the properties.');
    }
  }

  /** Every kind of file, most recent first. */
  recentFiles() {
    return this.app.workspace
      .getLastOpenFiles()
      .map((path) => this.app.vault.getFileByPath(path))
      .filter(Boolean);
  }

  togglePin(target) {
    if (!this.pins.toggle(target)) return;
    this.refreshBrowse();
    // The sidebar lists pins too, when Pinned is opened out.
    const library = this.feature(Library);
    if (library) library.refreshViews();
  }

  /** A property's display name, which keeps its own capitalisation. */
  propertyLabel(key) {
    try {
      const info = this.app.metadataTypeManager.getAllProperties()[key];
      if (info && info.name) return info.name;
    } catch (err) {
      /* fall through */
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  /** A name not yet taken in a folder: "Untitled", "Untitled 1", … */
  freeChildPath(folder, base, ext) {
    const dir = !folder || folder.path === '/' ? '' : folder.path + '/';
    const make = (n) =>
      normalizePath(`${dir}${n ? `${base} ${n}` : base}${ext ? '.' + ext : ''}`);
    let n = 0;
    while (this.app.vault.getAbstractFileByPath(make(n))) n++;
    return make(n);
  }

  /**
   * A note in a particular folder, opened with its title ready to type
   * over — the way the file explorer's New note behaves.
   */
  async newNote(folder) {
    try {
      const file = await this.app.vault.create(
        this.freeChildPath(folder, 'Untitled', 'md'),
        ''
      );
      await this.app.workspace
        .getLeaf(false)
        .openFile(file, { active: true, eState: { rename: 'all' } });
    } catch (err) {
      console.error('Design Redux: could not create the note', err);
      new Notice('Could not create the note.');
    }
  }

  /** An empty canvas in a folder, opened, as the file explorer's New canvas does. */
  async newCanvas(folder) {
    try {
      const file = await this.app.vault.create(
        this.freeChildPath(folder, 'Untitled', 'canvas'),
        JSON.stringify({ nodes: [], edges: [] })
      );
      await this.app.workspace.getLeaf(false).openFile(file, { active: true });
    } catch (err) {
      console.error('Design Redux: could not create the canvas', err);
      new Notice('Could not create the canvas.');
    }
  }

  /**
   * A folder in a particular folder, asked for by name, then opened —
   * so the next thing, putting a note in it, is right there. An empty
   * folder is hidden from listings by default, so without that it would
   * seem not to have been made.
   */
  newFolder(parent) {
    new NamePrompt(this.app, 'New folder', 'Folder name', async (name) => {
      const clean = name.replace(/[\\/:]/g, '').trim();
      if (!clean) return;
      const dir = !parent || parent.path === '/' ? '' : parent.path + '/';
      const path = normalizePath(dir + clean);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(`"${clean}" already exists here.`);
        return;
      }
      try {
        await this.app.vault.createFolder(path);
        const library = this.feature(Library);
        if (library && library.enabled) library.browseMode({ mode: 'folder', path: path });
      } catch (err) {
        console.error('Design Redux: could not create the folder', err);
        new Notice('Could not create the folder.');
      }
    }).open();
  }

  /**
   * Artwork for a folder, which has no properties of its own: its
   * folder note's cover, then an image called "cover" inside it. Shared
   * by the browse view and the sidebar, so a folder looks the same in
   * both.
   */
  folderCoverSrc(folder) {
    const note = this.folderNote(folder);
    if (note) {
      const src = resolveCover(this.app, note, this.settings.coverProperty);
      if (src) return src;
    }
    const named = (folder.children || []).find(
      (c) =>
        c instanceof TFile &&
        ['cover', '_cover', 'folder'].indexOf(c.basename.toLowerCase()) !== -1 &&
        IMAGE_EXTENSIONS.indexOf(c.extension.toLowerCase()) !== -1
    );
    return named ? this.app.vault.getResourcePath(named) : null;
  }

  /** The note that represents a folder, if it exists. */
  folderNote(folder) {
    const pattern = this.settings.folderNoteName || '{{folder}}';
    const name = pattern.replace(/\{\{folder\}\}/g, folder.name);
    return this.app.vault.getFileByPath(`${folder.path}/${name}.md`);
  }

  /**
   * Move a file into a folder, keeping links intact.
   *
   * renameFile rather than a raw move, because Obsidian rewrites every
   * link to the file as part of it. A name already taken in the
   * destination gets a numbered suffix instead of overwriting.
   */
  async moveFile(file, folderPath) {
    const dir = !folderPath || folderPath === '/' ? '' : folderPath;
    const current = file.parent ? file.parent.path : '/';
    if (current === (dir || '/')) return false;
    // A folder can't go inside itself, or inside anything in it.
    const isFolder = file instanceof TFolder;
    if (isFolder && (dir === file.path || dir.startsWith(file.path + '/'))) return false;

    const at = (name) => (dir ? `${dir}/${name}` : name);
    let candidate = at(file.name);
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = at(isFolder ? `${file.name} ${n}` : `${file.basename} ${n}.${file.extension}`);
      n++;
    }

    try {
      await this.app.fileManager.renameFile(file, candidate);
      return true;
    } catch (err) {
      console.error('Design Redux: could not move the file', err);
      new Notice(`Could not move "${file.name}".`);
      return false;
    }
  }

  /**
   * Whether a folder holds anything worth showing. Counted through
   * subfolders, since a folder whose only contents are folders of notes
   * is still somewhere you'd want to go — and the folder note doesn't
   * count, as it describes the folder rather than filling it.
   */
  folderHasNotes(folder) {
    for (const child of folder.children || []) {
      if (child instanceof TFolder) {
        if (this.folderHasNotes(child)) return true;
      } else if (!this.isFolderNote(child)) {
        return true;
      }
    }
    return false;
  }

  /** True for the note that stands for its own folder. */
  isFolderNote(file) {
    if (!this.settings.hideFolderNotes) return false;
    if (!file.parent || file.extension !== 'md') return false;
    const pattern = this.settings.folderNoteName || '{{folder}}';
    return file.basename === pattern.replace(/\{\{folder\}\}/g, file.parent.name);
  }

  /**
   * Ask for an image and record it on the folder note, creating that
   * note if it doesn't exist. Stored in the vault rather than in plugin
   * settings, so the pairing survives being moved or rebuilt elsewhere.
   */
  /** Pick the colour a folder or note's generated cover takes. */
  chooseCoverColor(target) {
    const name = target instanceof TFolder ? target.name : target.basename;
    new CoverColorModal(this, target, name).open();
  }

  setFolderCover(folder, after) {
    new ImagePicker(this.app, async (image) => {
      try {
        const note = await this.ensureFolderNote(folder);
        const covers = this.feature(CoverImages);
        await covers.setCover(note, covers.linkTo(image, note));
        // The view redraws itself once the cache catches up.
        if (after) after();
      } catch (err) {
        console.error('Design Redux: could not set the folder cover', err);
        new Notice('Could not set the cover.');
      }
    }).open();
  }

  async ensureFolderNote(folder) {
    const existing = this.folderNote(folder);
    if (existing) return existing;

    const pattern = this.settings.folderNoteName || '{{folder}}';
    const name = pattern.replace(/\{\{folder\}\}/g, folder.name);
    return this.app.vault.create(`${folder.path}/${name}.md`, '');
  }

  async clearFolderCover(folder, after) {
    const note = this.folderNote(folder);
    if (!note) return;
    const key = this.settings.coverProperty || 'cover';
    try {
      await this.app.fileManager.processFrontMatter(note, (fm) => {
        delete fm[key];
      });
      this.refreshBrowse();
      if (after) after();
    } catch (err) {
      console.error('Design Redux: could not clear the folder cover', err);
    }
  }

  refreshBrowse() {
    liveViews(this.app, BROWSE_VIEW, BrowseView).forEach((v) => v.render());
  }

  /** One feature by its class, rather than by its name as a string. */
  feature(Ctor) {
    return (this.features || []).find((f) => f instanceof Ctor) || null;
  }

  /** A throw in one feature must not leave the others half set up. */
  each(fn) {
    (this.features || []).forEach((f) => {
      try {
        fn(f);
      } catch (err) {
        console.error(`Design Redux: ${f.constructor.name} failed`, err);
      }
    });
  }

  refresh() {
    this.each((f) => (f.enabled ? f.enable() : f.disable()));
  }

  /**
   * Workspace events arrive in bursts: opening a split fires several in
   * a row, and each would otherwise walk every leaf. Coalesce them into
   * a single pass on the next frame.
   */
  queueSync() {
    if (this.syncFrame) return;
    this.syncFrame = window.requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.each((f) => {
        if (f.enabled) f.sync();
      });
    });
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    // Cloned: some defaults are objects, and sharing the reference
    // would let a change to settings edit DEFAULTS itself.
    const settings = JSON.parse(JSON.stringify(DEFAULTS));

    // Only keys the plugin still recognises: a merge would carry
    // settings from removed features indefinitely.
    Object.keys(DEFAULTS).forEach((key) => {
      if (saved[key] !== undefined) settings[key] = saved[key];
    });

    this.settings = settings;

    const stale = Object.keys(saved).filter((k) => DEFAULTS[k] === undefined);
    if (stale.length) await this.saveData(this.settings);
  }

  /**
   * Saved at once; the features and open screens follow once typing in
   * a settings field pauses, rather than once per letter.
   */
  async saveSettings() {
    await this.saveData(this.settings);
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      if (this.unloading) return;
      this.refresh();
      // Open screens show the change at once — an order, album columns,
      // a limit — rather than on their next visit.
      this.refreshBrowse();
    }, 200);
  }
}

/* ------------------------------------------------------------------ */

/*
 * Where each setting sits: four tabs of short sections. Features still
 * own their rows — name, control, description; this only decides where
 * each goes. A row shown only while another in its section is on sits
 * indented beneath that one.
 */
const SETTINGS_TABS = [
  {
    id: 'library',
    title: 'Library',
    icon: 'library',
    sections: [
      { keys: ['library', 'homePath', 'hideEmptyFolders'] },
      {
        title: 'Layout',
        desc: 'What the library lists, under headings of your own.',
        keys: ['librarySections'],
      },
    ],
  },
  {
    id: 'browsing',
    title: 'Browsing',
    icon: 'layout-grid',
    sections: [
      { title: 'Lists', keys: ['defaultSort', 'discNoteLimit', 'albumNoteLimit'] },
      { title: 'Screens', keys: ['albumColumns', 'tableColumns', 'categoryProperty'] },
      { title: 'Folder notes', keys: ['folderNoteName', 'hideFolderNotes'] },
      { title: 'Covers', keys: ['coverProperty', 'coverFallback', 'generatedCoverColor'] },
    ],
  },
  {
    id: 'notes',
    title: 'Notes',
    icon: 'file-text',
    sections: [
      { title: 'Lists', keys: ['letterLists', 'romanLists'] },
      { title: 'Superscript and subscript', keys: ['scripts', 'scriptSyntax', 'autoOrdinals'] },
      { title: 'Properties', keys: ['propertiesDropdown', 'showMentions'] },
      { title: 'Images', keys: ['routeImages', 'imageFolder'] },
    ],
  },
  {
    id: 'interface',
    title: 'Interface',
    icon: 'app-window',
    sections: [
      { title: 'Page', keys: ['contextStrip', 'onePage', 'singleArea'] },
      { title: 'Sidebar header', keys: ['navDropdown', 'ribbonInMenu', 'settingsInHeader'] },
      { title: 'Graph', keys: ['graphProperties'] },
      { title: 'Canvas', keys: ['canvasLegend', 'canvasTextAlign'] },
    ],
  },
];

/**
 * Suggestions under a settings field: notes, folders, or property names
 * — for a comma list, just the name being typed after the last comma.
 */
class SettingSuggest extends (AbstractInputSuggest || class {}) {
  constructor(app, inputEl, kind, extra) {
    super(app, inputEl);
    this.app = app;
    this.inputEl = inputEl;
    this.kind = kind;
    this.extra = extra || [];
  }

  get isList() {
    return this.kind === 'properties';
  }

  candidates() {
    const vault = this.app.vault;
    if (this.kind === 'file') return vault.getMarkdownFiles().map((f) => f.path).sort(byName);
    if (this.kind === 'folder') {
      return vault
        .getAllLoadedFiles()
        .filter((f) => f instanceof TFolder && !f.isRoot())
        .map((f) => f.path)
        .sort(byName);
    }
    return this.extra.concat(knownPropertyNames(this.app).filter((n) => this.extra.indexOf(n) === -1));
  }

  getSuggestions() {
    const value = this.inputEl.value;
    const typed = (this.isList ? value.slice(value.lastIndexOf(',') + 1) : value).trim().toLowerCase();
    // In a list, what's already in it isn't offered again.
    const taken = this.isList
      ? value.split(',').slice(0, -1).map((v) => v.trim().toLowerCase())
      : [];
    return this.candidates()
      .filter((c) => c.toLowerCase().includes(typed) && taken.indexOf(c.toLowerCase()) === -1)
      .slice(0, 50);
  }

  renderSuggestion(value, el) {
    el.setText(value);
  }

  selectSuggestion(value) {
    const current = this.inputEl.value;
    const cut = current.lastIndexOf(',');
    this.inputEl.value = this.isList && cut !== -1 ? `${current.slice(0, cut + 1)} ${value}` : value;
    // The field's own listener saves it, as if typed.
    this.inputEl.dispatchEvent(new Event('input'));
    this.close();
  }
}

class DesignReduxSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.tab = SETTINGS_TABS[0].id;
  }

  get settings() {
    return this.plugin.settings;
  }

  /** Every row the features declare that belongs on this device. */
  rows() {
    // Settings for desktop chrome are left out on a phone or tablet,
    // where they'd do nothing; they keep their values for the desktop.
    const here = (desktopOnly) => !(desktopOnly && Platform.isMobile);
    const rows = [];
    this.plugin.features
      .filter((feature) => here(feature.constructor.desktopOnly))
      .forEach((feature) =>
        feature
          .settingsSchema()
          .filter((row) => here(row.desktopOnly))
          .forEach((row) => rows.push(row))
      );
    return rows;
  }

  shown(row) {
    if (!row.showIf) return true;
    return typeof row.showIf === 'function' ? !!row.showIf(this.settings) : !!this.settings[row.showIf];
  }

  display() {
    const { containerEl } = this;
    // Redrawn on every toggle; the place on the page stays put. Which
    // element scrolls depends on the version, so both are kept.
    const scroller = containerEl.parentElement;
    const tops = [containerEl.scrollTop, scroller ? scroller.scrollTop : 0];
    containerEl.empty();
    containerEl.addClass('dr-settings');

    const rows = this.rows();
    const placed = new Set();
    const tabs = SETTINGS_TABS.map((spec) => ({
      spec,
      sections: spec.sections.map((sec) => {
        const members = sec.keys
          .map((key) => rows.find((row) => row.key === key))
          .filter(Boolean);
        members.forEach((row) => placed.add(row));
        return Object.assign({}, sec, { rows: members });
      }),
    }));
    // Anything no tab claims still gets a place, at the end.
    const rest = rows.filter((row) => !placed.has(row));
    if (rest.length) tabs[tabs.length - 1].sections.push({ title: 'Other', rows: rest });

    const bar = containerEl.createDiv({ cls: 'dr-set-tabs' });
    bar.setAttribute('role', 'tablist');
    roveFocus(bar, '.dr-set-tab');
    const panes = [];

    tabs.forEach(({ spec, sections }) => {
      const on = spec.id === this.tab;
      const button = bar.createEl('button', { cls: 'dr-set-tab' });
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(on));
      button.id = `dr-set-tab-${spec.id}`;
      button.toggleClass('is-active', on);
      setIcon(button.createSpan({ cls: 'dr-set-tab-icon' }), spec.icon);
      button.createSpan({ text: spec.title });

      const pane = containerEl.createDiv({ cls: 'dr-set-pane' });
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', button.id);
      pane.dataset.tab = spec.id;
      pane.toggleClass('is-hidden', !on);
      panes.push(pane);
      this.renderPane(pane, spec, sections);

      button.addEventListener('click', () => {
        this.tab = spec.id;
        bar.querySelectorAll('.dr-set-tab').forEach((b) => {
          const active = b === button;
          b.toggleClass('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });
        panes.forEach((p) => p.toggleClass('is-hidden', p !== pane));
      });
    });

    containerEl.scrollTop = tops[0];
    if (scroller) scroller.scrollTop = tops[1];
  }

  renderPane(pane, spec, sections) {
    if (spec.id === 'browsing' && !this.settings.library) {
      const note = pane.createDiv({ cls: 'dr-set-callout' });
      note.createSpan({ text: 'The Library view is off, so the settings for its screens are hidden.' });
      const on = note.createEl('button', { text: 'Turn it on' });
      on.addEventListener('click', async () => {
        this.settings.library = true;
        await this.plugin.saveSettings();
        this.display();
      });
    }

    sections.forEach((sec) => {
      const visible = sec.rows.filter((row) => this.shown(row));
      if (!visible.length) return;
      if (sec.title) {
        const head = new Setting(pane).setName(sec.title).setHeading();
        if (sec.desc) head.setDesc(sec.desc);
      }
      // A row sits beneath the one it depends on, when that's here too.
      const blocks = {};
      visible.forEach((row) => {
        const parent = row.parent || (typeof row.showIf === 'string' ? row.showIf : null);
        const host = parent && blocks[parent] ? blocks[parent]() : pane;
        const el = this.row(host, row);
        if (row.key && el) {
          let children = null;
          blocks[row.key] = () => {
            if (!children) {
              children = document.createElement('div');
              children.className = 'dr-set-children';
              el.after(children);
            }
            return children;
          };
        }
      });
    });

    if (spec.id === 'interface' && Platform.isMobile) {
      pane.createDiv({
        cls: 'setting-item-description dr-settings-note',
        text: 'Settings for the desktop app\'s tab bar and sidebar header aren\'t shown on a phone or tablet.',
      });
    }
  }

  async set(key, value, redraw) {
    this.settings[key] = value;
    await this.plugin.saveSettings();
    if (redraw) this.display();
  }

  /** Back to the default, for a row that's been changed from it. */
  addReset(setting, row) {
    if (!(row.key in DEFAULTS)) return;
    const value = this.settings[row.key];
    if (JSON.stringify(value) === JSON.stringify(DEFAULTS[row.key])) return;
    setting.addExtraButton((b) =>
      b
        .setIcon('rotate-ccw')
        .setTooltip('Restore default')
        .onClick(() => this.set(row.key, JSON.parse(JSON.stringify(DEFAULTS[row.key])), true))
    );
  }

  /** One row; returns its element, so rows that depend on it can follow. */
  row(containerEl, row) {
    // A feature can render its own block when a toggle or text field
    // isn't enough to express the setting.
    if (row.type === 'custom') {
      const before = containerEl.lastElementChild;
      row.render(containerEl, this);
      return containerEl.lastElementChild !== before ? containerEl.lastElementChild : null;
    }

    const setting = new Setting(containerEl).setName(row.name).setDesc(row.desc || '');
    if (row.type) setting.setClass(`dr-set-${row.type}`);
    const value = this.settings[row.key];

    if (row.type === 'text') {
      this.addReset(setting, row);
      setting.addText((t) => {
        t.setPlaceholder(row.placeholder || '')
          .setValue(value == null ? '' : String(value))
          .onChange((v) => this.set(row.key, v.trim() || row.fallback || ''));
        if (row.suggest && AbstractInputSuggest) {
          new SettingSuggest(this.app, t.inputEl, row.suggest, row.suggestExtra);
        }
      });
    } else if (row.type === 'number') {
      this.addReset(setting, row);
      setting.addText((t) => {
        t.inputEl.type = 'number';
        t.inputEl.min = String(row.min || 1);
        t.inputEl.setAttribute('inputmode', 'numeric');
        t.setPlaceholder(String(DEFAULTS[row.key]))
          .setValue(String(value))
          .onChange((v) => {
            const n = parseInt(v, 10);
            // Mid-edit a field can be empty; it keeps the last good number.
            if (Number.isFinite(n) && n >= (row.min || 1)) this.set(row.key, n);
          });
      });
    } else if (row.type === 'dropdown') {
      this.addReset(setting, row);
      setting.addDropdown((d) => {
        Object.keys(row.options).forEach((v) => d.addOption(v, row.options[v]));
        // A choice can bring rows with it, as a toggle can.
        d.setValue(value).onChange((v) => this.set(row.key, v, true));
      });
    } else if (row.type === 'color') {
      this.addReset(setting, row);
      const hex = normalHex(value) || DEFAULTS[row.key];
      if (typeof setting.addColorPicker === 'function') {
        setting.addColorPicker((c) =>
          c.setValue(hex).onChange((v) => {
            if (normalHex(v)) this.set(row.key, normalHex(v));
          })
        );
      } else {
        setting.addText((t) =>
          t.setPlaceholder(DEFAULTS[row.key]).setValue(hex).onChange((v) => {
            if (normalHex(v)) this.set(row.key, normalHex(v));
          })
        );
      }
    } else {
      // Rows can be conditional on other rows, so a toggle redraws.
      setting.addToggle((t) => t.setValue(!!value).onChange((v) => this.set(row.key, v, true)));
    }
    return setting.settingEl || null;
  }
}

module.exports = DesignRedux;
