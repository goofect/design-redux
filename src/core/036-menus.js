/* ------------------------------------------------------------------ */
/* Menus and touch                                                     */
/*                                                                     */
/* Menus shown where they were asked for, grouped and nested; a long   */
/* press standing in for a right-click; the menu of a note or folder.  */
/* ------------------------------------------------------------------ */

import { Menu, MenuItem, TFolder } from 'obsidian';
import { BROWSE_VIEW } from './020-constants.js';
import { resolveCover } from './030-art.js';

/* -- menus ------------------------------------------------------------ */

/**
 * Show a menu at the pointer, at the finger for a long press, or under
 * the element for a keyboard press, which has no position to use. On a
 * phone Obsidian draws every menu as a sheet from the bottom, wherever
 * it's asked to appear.
 */
export function showMenuAt(menu, evt) {
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

/* -- touch ------------------------------------------------------------ */

export const LONG_PRESS_MS = 500;

export const LONG_PRESS_SLOP = 10;

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
export function onContextMenu(el, handler) {
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
export function swallowClick(el) {
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
export function pressEvent(el, at) {
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
export function canNest() {
  return !!(MenuItem && MenuItem.prototype && typeof MenuItem.prototype.setSubmenu === 'function');
}

/**
 * Related entries under one, opening beside it, so a menu stays short.
 * Where that isn't possible they go in place instead, under their
 * longer names: fill is told which, and names them to suit.
 */
export function menuGroup(menu, title, icon, fill, section) {
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
export function findSubmenu(menu, title) {
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
export function canvasOn(app) {
  try {
    const plugins = app.internalPlugins;
    if (!plugins || typeof plugins.getEnabledPluginById !== 'function') return true;
    return !!plugins.getEnabledPluginById('canvas');
  } catch (err) {
    return true;
  }
}

export function showTargetMenu(plugin, evt, target, opts = {}) {
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
  // Ways to open a note the caller offers, first.
  (opts.first || []).forEach(([title, icon, run]) =>
    menu.addItem((item) => sectioned(item, 'open').setTitle(title).setIcon(icon).onClick(run))
  );
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

  // The album features' own entries, through the plugin: this helper is below them.
  if (typeof plugin.addAlbumMenuItems === 'function') plugin.addAlbumMenuItems(menu, target, sectioned, redraw, opts.album);

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
        const drawn = plugin.settings.coverFallback === 'art';
        m.addItem((item) =>
          item
            .setTitle(drawn ? (nested ? 'Design and colour…' : 'Cover design…') : nested ? 'Colour…' : 'Cover colour…')
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
