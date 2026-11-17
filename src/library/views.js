/* ------------------------------------------------------------------ */
/* The library's two views: folders in the sidebar, notes in a folder. */
/* ------------------------------------------------------------------ */

import { ItemView } from 'obsidian';
import { iconId } from '../core/icons.js';
import { enableDrop } from './drop.js';
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
    return new LibraryScreen(this.plugin, this.contentEl, {
      place: 'sidebar',
      onGo: (folder) => {
        if (this.app.workspace.getLeavesOfType(BROWSE_VIEW).length) return;
        const library = this.plugin.features.find((feature) => typeof feature.browse === 'function');
        if (library) library.browse(folder.path === '/' ? null : folder);
      },
    });
  }
}

export class BrowseView extends ScreenView {
  getViewType() { return BROWSE_VIEW; }
  getDisplayText() { return this.screen && this.screen.folder().path !== '/' ? this.screen.folder().name : 'Library'; }
  getIcon() { return iconId('grid'); }

  makeScreen() {
    return new LibraryScreen(this.plugin, this.contentEl, {
      wide: true,
      place: 'browse',
      onGo: (folder) => { this.plugin.openFolder = folder.path === '/' ? null : folder; },
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
    this.plugin.openFolder = null;
    await super.onClose();
  }
}
