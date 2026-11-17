/* ------------------------------------------------------------------ */
/* The library's two views: the sidebar, and the browse view           */
/*                                                                     */
/* Both are one LibraryScreen. The sidebar is three columns wide; the  */
/* browse view is the window's width, its words are the table, and a   */
/* folder picked in it is shown beside the grid.                       */
/* ------------------------------------------------------------------ */

import { ItemView, TFolder } from 'obsidian';
import { el } from '../core/dom.js';
import { iconId } from '../core/icons.js';
import { enableDrop } from './drop.js';
import { browserIcon, browserType } from './file-list.js';
import { LibraryScreen } from './screen.js';

export const LIBRARY_VIEW = 'design-redux-library';
export const BROWSE_VIEW = 'design-redux-browse';

/** What both views share: a screen that is drawn on open and known to the plugin while it is. */
class ScreenView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  async onOpen() {
    this.screen = this.makeScreen();
    const draw = this.screen.draw.bind(this.screen);
    this.screen.draw = () => {
      draw();
      if (this.plugin.settings.sidebarDrop !== false) enableDrop(this.screen, this.screen.body);
      this.afterDraw();
    };
    (this.plugin.screens || (this.plugin.screens = new Set())).add(this.screen);
    this.screen.draw();
  }

  async onClose() {
    if (this.plugin.screens) this.plugin.screens.delete(this.screen);
    this.screen = null;
  }

  afterDraw() {}
}

export class LibraryView extends ScreenView {
  getViewType() { return LIBRARY_VIEW; }
  getDisplayText() { return 'Library'; }
  getIcon() { return iconId('library'); }

  makeScreen() {
    return new LibraryScreen(this.plugin, this.contentEl, { place: 'sidebar' });
  }
}

export class BrowseView extends ScreenView {
  getViewType() { return BROWSE_VIEW; }
  getDisplayText() { return this.screen && this.screen.folder().path !== '/' ? this.screen.folder().name : 'Library'; }
  getIcon() { return iconId('grid'); }

  makeScreen() {
    this.pane = el(this.contentEl, 'div', 'dr dr-browse');
    const main = el(this.pane, 'div', 'dr-browse-main');
    this.aside = el(this.pane, 'aside', 'dr dr-browse-aside');
    return new LibraryScreen(this.plugin, main, {
      wide: true,
      place: 'browse',
      onGo: (folder) => { this.plugin.openFolder = folder.path === '/' ? null : folder; },
    });
  }

  /** The preview: the folder picked, beside the grid. */
  afterDraw() {
    const aside = this.aside;
    while (aside.firstChild) aside.removeChild(aside.firstChild);
    const picked = this.plugin.selection.item;
    aside.hidden = false;
    el(aside, 'h2', 'dr-file-details-title', 'Details');
    if (picked) {
      const name = el(aside, 'div', 'dr-file-details-name');
      browserIcon(name, picked instanceof TFolder ? 'folder' : picked.extension === 'md' ? 'file-text' : 'file');
      el(name, 'span', 'dr-clip', picked.name);
      el(aside, 'div', 'dr-file-details-type', `File type: ${browserType(picked)}`);
    }
  }

  getState() { return { at: this.screen ? this.screen.at : '/' }; }

  async setState(state) {
    this.wanted = state && typeof state.at === 'string' ? state.at : '/';
    if (this.screen && this.screen.at !== this.wanted) this.screen.go(this.app.vault.getAbstractFileByPath(this.wanted));
  }

  async onOpen() {
    await super.onOpen();
    if (this.wanted && this.wanted !== '/') this.screen.go(this.app.vault.getAbstractFileByPath(this.wanted));
  }

  async onClose() {
    this.plugin.openFolder = null;
    await super.onClose();
  }
}
