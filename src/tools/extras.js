/* ------------------------------------------------------------------ */
/* Small tools: diagnostics, the actions menu, the menu filter, a pane */
/* filling the screen                                                  */
/* ------------------------------------------------------------------ */

import { Menu, Notice } from 'obsidian';
import { applies } from '../core/actions.js';
import { copyText } from '../core/dom.js';
import { Feature } from '../core/feature.js';

/** What a bug report needs, as text: versions, what is on, how big the vault is. Nothing of the notes themselves. */
export function diagnosticsText(plugin) {
  const s = plugin.settings;
  const on = plugin.features.filter((f) => f.on).map((f) => f.constructor.name);
  const lines = [
    `Design Redux ${plugin.manifest.version}`,
    `Obsidian ${typeof navigator !== 'undefined' ? (/obsidian\/([\d.]+)/i.exec(navigator.userAgent) || [0, 'unknown'])[1] : 'unknown'}`,
    `Look: ${s.look}, ${s.lookScope}`,
    `Features on: ${on.join(', ')}`,
    `Notes: ${plugin.index.markdown().length}; folders: ${plugin.index.folders().length}`,
    `Settings: ${Object.keys(s).length} keys; path-keyed entries: ${['albums', 'albumOrders', 'propertySchemas'].map((k) => `${k} ${Object.keys(s[k] || {}).length}`).join(', ')}`,
  ];
  return lines.join('\n');
}

export class Diagnostics extends Feature {
  actions() {
    return [{ id: 'copy-diagnostics', name: 'Copy diagnostics for a bug report', run: () => copyText(diagnosticsText(this.plugin), 'Diagnostics copied.') }];
  }
}

/** Everything the plugin can do that needs nothing picked, in one menu. */
export class ActionsMenu extends Feature {
  menu() {
    const menu = new Menu();
    this.plugin.actions().filter((a) => (a.on || 'app') === 'app' && a.id !== 'open-actions' && a.palette !== false && applies(a, {})).forEach((a) =>
      menu.addItem((item) => item.setTitle(a.name).setSection(a.feature.constructor.section || 'action').onClick(() => a.run({ from: 'menu' }))));
    return menu;
  }

  actions() {
    return [{ id: 'open-actions', name: 'Open actions menu', run: () => {
      const e = this.app.lastEvent;
      const menu = this.menu();
      return e && typeof e.clientX === 'number' ? menu.showAtMouseEvent(e) : menu.showAtPosition({ x: 0, y: 0 });
    } }];
  }
}
ActionsMenu.title = 'Actions menu';
ActionsMenu.section = 'Tools';
ActionsMenu.about = 'One menu of everything the plugin can do.';

/** Entries of Obsidian's own menus for its properties block, which the look hides: they would act on nothing to be seen. */
export const HIDDEN_MENU_ITEMS = ['Rename property', 'Add file property'];

/**
 * The menu filter. Obsidian's own context menu is the better menu, so it is
 * kept, and the entries not wanted in it are left undrawn: marked with a
 * class of the plugin's as the menu appears. Nothing of Obsidian's is removed.
 */
export class MenuFilter extends Feature {
  enable() {
    const mark = (menu) => {
      if (!menu.classList || !menu.classList.contains('menu')) return;
      Array.from(menu.querySelectorAll('.menu-item')).forEach((item) => {
        const title = item.querySelector('.menu-item-title');
        if (title && HIDDEN_MENU_ITEMS.includes(title.textContent.trim())) item.classList.add('dr-menu-hidden');
      });
    };
    // In every window, a menu is added straight to the body: only the body's own children are watched, never what is under them.
    this.eachWindow((doc) => {
      const Observer = (doc.defaultView && doc.defaultView.MutationObserver) || MutationObserver;
      const observer = new Observer((changes) => changes.forEach((c) => Array.from(c.addedNodes).forEach(mark))); // scoped
      observer.observe(doc.body, { childList: true });
      this.add(() => observer.disconnect());
      this.add(() => Array.from(doc.querySelectorAll('.dr-menu-hidden')).forEach((n) => n.classList.remove('dr-menu-hidden')));
    });
  }
}
MenuFilter.title = 'Menu filter';
MenuFilter.section = 'Tools';
MenuFilter.about = 'Leaves the entries that only repeat the plugin’s own out of Obsidian’s menus.';

/** The pane in front fills the screen (the browser's full screen of its content); the same command, or Escape, gives it back. */
export class FullPane extends Feature {
  enable() {
    this.add(() => this.leave());
  }

  /** The content of the pane in front, or null. */
  pane() {
    const ws = this.app.workspace;
    const leaf = typeof ws.getMostRecentLeaf === 'function' ? ws.getMostRecentLeaf() : null;
    const el = leaf && leaf.view && leaf.view.contentEl;
    return el && typeof el.requestFullscreen === 'function' ? el : null;
  }

  get full() {
    return !!activeDocument.fullscreenElement;
  }

  async toggle() {
    if (this.full) return this.leave();
    const el = this.pane();
    if (el) await el.requestFullscreen({ navigationUI: 'hide' }).catch(() => new Notice('The pane could not fill the screen.'));
    return !!el;
  }

  leave() {
    const doc = activeDocument;
    if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') return doc.exitFullscreen().catch(() => null);
    return null;
  }

  actions() {
    return [{ id: 'fill-screen', name: 'Fill the screen with this pane, or give it back', when: () => this.full || !!this.pane(), run: () => this.toggle() }];
  }
}
