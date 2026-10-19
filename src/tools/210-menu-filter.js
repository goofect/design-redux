/* ------------------------------------------------------------------ */
/* Menu filter                                                         */
/*                                                                     */
/* Obsidian's own context menu is the better menu: it carries link     */
/* actions and everything else the native block offers. Rather than    */
/* suppress it and substitute a poorer copy, watch for menus appearing */
/* and drop the items not wanted.                                      */
/* ------------------------------------------------------------------ */

import { Menu } from 'obsidian';
import { HIDDEN_MENU_ITEMS, ONE_PAGE_MENU_ITEMS } from '../core/020-constants.js';
import { around } from '../core/030-helpers-art.js';
import { Feature } from '../core/080-feature.js';

export class MenuFilter extends Feature {
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

