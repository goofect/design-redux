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
import { drawDetail } from './detail.js';
import { enableDrop } from './drop.js';
import { drawTable } from './level-table.js';
import { folderMenu, showMenu } from './menus.js';
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
      words: drawTable,
      onGo: (folder) => { this.plugin.openFolder = folder.path === '/' ? null : folder; },
      // Four things at most in the head: search, filter, more, and the zoom control. New note and the order are in More.
      buttons: (screen) => (this.plugin.editFilter ? [{ glyph: 'filter', label: 'Filter', pressed: !!screen.filter, run: () => this.plugin.editFilter(screen) }] : []).concat([
        { glyph: 'more', label: 'More', run: (e) => showMenu(folderMenu(this.plugin, screen.folder(), null), e) },
      ]),
    });
  }

  /** The preview: the folder picked, beside the grid. */
  afterDraw() {
    const aside = this.aside;
    while (aside.firstChild) aside.removeChild(aside.firstChild);
    const picked = this.plugin.selection.item;
    aside.hidden = !(picked instanceof TFolder);
    if (aside.hidden) return;
    drawDetail(this.plugin, aside, picked, { open: (f) => this.screen.go(f), note: (file, e) => this.screen.openNote(file, e) });
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
