/* ------------------------------------------------------------------ */
/* The library's two views: the sidebar, and the browse view           */
/*                                                                     */
/* Both are one LibraryScreen: the sidebar the folders as a tree, the  */
/* browse view the folder shown in the page. One job each.             */
/* ------------------------------------------------------------------ */

import { ItemView } from 'obsidian';
import { LibraryScreen } from './screen.js';

export const LIBRARY_VIEW = 'design-redux-library';
export const BROWSE_VIEW = 'design-redux-browse';

/** What both views share: a screen that is drawn on open and known to the plugin while it is. */
/** The library's screens open now, in every pane: the library redraws them all. */
export const openScreens = new Set();

class ScreenView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  async onOpen() {
    this.screen = this.makeScreen();
    openScreens.add(this.screen);
    this.screen.draw();
  }

  async onClose() {
    openScreens.delete(this.screen);
    this.screen = null;
  }
}

export class LibraryView extends ScreenView {
  getViewType() { return LIBRARY_VIEW; }
  getDisplayText() { return 'Library'; }
  getIcon() { return 'library'; }

  makeScreen() {
    return new LibraryScreen(this.plugin, this.contentEl);
  }
}

export class BrowseView extends ScreenView {
  getViewType() { return BROWSE_VIEW; }
  getDisplayText() { return this.screen && this.screen.folder().path !== '/' ? this.screen.folder().name : 'Library'; }
  getIcon() { return 'library'; }

  makeScreen() {
    return new LibraryScreen(this.plugin, this.contentEl, {
      wide: true,
      onGo: (folder) => {
        this.plugin.selection.folder = folder;
        openScreens.forEach((s) => s !== this.screen && s.refresh());
      },
    });
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
    this.plugin.selection.folder = null;
    openScreens.forEach((s) => s !== this.screen && s.refresh());
    await super.onClose();
  }
}
