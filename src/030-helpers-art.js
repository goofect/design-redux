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
 * and the glyph as well if the image turns out to be missing. `hue`
 * names what the glyph's backdrop takes its colour from.
 */
function fillArt(el, src, glyph, gen, hue) {
  const blank = () => {
    // With a name to go on, a cover is made from it: a gradient chosen
    // by the name, so it's always the same one, and its initials. A
    // colour can be given with it: { name, tint }.
    if (gen) return generatedArt(el, typeof gen === 'string' ? { name: gen } : gen);
    blankArt(el, glyph, hue);
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

/**
 * Where there's no artwork at all: the glyph for what it is on a soft
 * gradient in a colour picked from a name, rather than a grey box — so
 * a vault of notes without covers still reads as a shelf of records.
 */
function blankArt(el, glyph, hue) {
  el.addClass('is-blank');
  if (hue) {
    el.addClass('is-hued');
    el.style.setProperty('--dr-gen-h', String(nameHue(String(hue))));
  }
  setIcon(el.createSpan({ cls: 'dr-card-glyph' }), glyph);
}

/* -- artwork, as the settings ask for it -------------------------------- */

/** The name a placeholder's soft colour comes from — only when that's the choice. */
function softHue(settings, name) {
  return settings.coverFallback === 'soft' ? name : null;
}

/**
 * A note's artwork: its own cover, or a colour chosen for it; then, with
 * 'Use the folder's cover' on, the cover of the folder it's directly in,
 * as a song shows its album's; then the icon — on a soft colour picked
 * from the note's own name, where that's the choice.
 */
function drawNoteArt(plugin, el, file) {
  const settings = plugin.settings;
  const md = file.extension === 'md';
  const hue = softHue(settings, file.basename);
  const src = md ? resolveCover(plugin.app, file, settings.coverProperty) : null;
  const gen = md ? coverGen(settings, file.basename, file.path) : null;
  if (src || gen) {
    fillArt(el, src, iconForFile(file), gen, hue);
    return;
  }
  const folder = settings.coverFromFolder && file.parent && !(file.parent.isRoot && file.parent.isRoot())
    ? file.parent
    : null;
  fillArt(el, folder ? plugin.folderCoverSrc(folder) : null, iconForFile(file), null, hue);
}

/** A folder's artwork: its cover, or a colour chosen for it, or the icon as the settings say. */
function drawFolderArt(plugin, el, folder) {
  const root = !!(folder.isRoot && folder.isRoot());
  const name = root ? plugin.app.vault.getName() : folder.name;
  const gen = coverGen(plugin.settings, name, folder.path);
  fillArt(el, plugin.folderCoverSrc(folder), 'folder', gen, softHue(plugin.settings, name));
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
 * What a missing cover gets from settings alone: 'icon' for the icon —
 * plain, or on a soft colour, which is drawn with it rather than made
 * into a cover — 'accent', a colour, or null for a colour from the name.
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
  // Obsidian orders a menu by section, and puts entries with none last,
  // so ours are given the sections its own open and action entries use.
  const sectioned = (item, name) => {
    if (typeof item.setSection === 'function') item.setSection(name);
    return item;
  };
  if (isFolder && !opts.here && opts.open) {
    menu.addItem((item) =>
      sectioned(item, 'open').setTitle('Open folder').setIcon('folder-open').onClick(opts.open)
    );
  }
  if (isFolder) {
    menuGroup(menu, 'New', 'plus', (m, nested) => {
      if (!nested) m = { addItem: (fn) => menu.addItem((item) => fn(sectioned(item, 'action'))) };
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
    }, 'action');
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
      if (!nested) m = { addItem: (fn) => menu.addItem((item) => fn(sectioned(item, 'action'))) };
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
    }, 'action');
  }

  const pinned = plugin.pins.has(target);
  menu.addItem((item) =>
    sectioned(item, 'action')
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
          if (!nested) sectioned(item, 'action');
          item.setTitle(title).setIcon(icon);
          if (typeof item.setDisabled === 'function') item.setDisabled(!run);
          item.onClick(() => {
            if (run) run();
          });
        })
      ),
      'action'
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

