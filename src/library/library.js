/* ------------------------------------------------------------------ */
/* The library: the feature                                            */
/*                                                                     */
/* Registers the sidebar and the browse view, keeps every open screen  */
/* true to the vault, the pick and the open note, and lists what the   */
/* library can do.                                                     */
/* ------------------------------------------------------------------ */

import { Keymap } from 'obsidian';
import { Feature } from '../core/feature.js';
import { iconId } from '../core/icons.js';
import { drawFolderPage } from './contents.js';
import { neighbours } from './order.js';
import { BROWSE_VIEW, BrowseView, LIBRARY_VIEW, LibraryView } from './views.js';

/** Is an element on screen: Obsidian's own isShown() where there is one, else whether it has a box. */
const shown = (el) => !!el && (typeof el.isShown === 'function' ? el.isShown() : !!el.offsetParent);

export class Library extends Feature {
  register() {
    this.plugin.registerView(LIBRARY_VIEW, (leaf) => new LibraryView(leaf, this.plugin));
    this.plugin.registerView(BROWSE_VIEW, (leaf) => new BrowseView(leaf, this.plugin));
  }

  enable() {
    const ws = this.app.workspace;
    const redraw = () => this.screens().forEach((s) => s.refresh());
    ['design-redux:vault', 'design-redux:pick', 'design-redux:settings', 'file-open'].forEach((name) => this.listen(ws, name, redraw));
    // A note's properties show only in search and a filter's list: the tree and a folder's page are left be while one is typed.
    this.listen(ws, 'design-redux:props', () => this.screens().filter((s) => s.query !== null || s.filter).forEach((s) => s.refresh()));
    const ribbon = this.plugin.addRibbonIcon(iconId('library'), 'Open library', () => this.openSidebar());
    this.add(() => ribbon && ribbon.remove && ribbon.remove());
    this.add(() => {
      if (this.plugin.unloading) return;
      ws.detachLeavesOfType(LIBRARY_VIEW);
      ws.detachLeavesOfType(BROWSE_VIEW);
    });
    // For the sidebar's tree: a folder's name pressed shows it in the page.
    this.plugin.showFolder = (folder) => this.browse(folder);
    this.add(() => delete this.plugin.showFolder);
    // With the look on, Obsidian's tab strip and the sidebars' toggles are hidden, so nothing could bring the
    // library forward again: it is kept the tab the left sidebar shows, from the start and after any layout change.
    this.keepShown();
    this.listen(ws, 'layout-change', () => this.keepShown());
  }

  /** Opens the library if it is gone and, with the look on, brings it to the front of the left sidebar. */
  keepShown() {
    if (this.plugin.unloading || this.keeping) return;
    const ws = this.app.workspace;
    // One library: a reload of the plugin can leave a second behind it, which goes.
    const leaves = ws.getLeavesOfType(LIBRARY_VIEW);
    const leaf = leaves.find((l) => shown(l.view && l.view.containerEl)) || leaves[0];
    leaves.filter((l) => l !== leaf).forEach((l) => l.detach());
    const look = this.settings.look !== 'theme';
    if (leaf && (!look || shown(leaf.view && leaf.view.containerEl))) return;
    this.keeping = true;
    const open = leaf ? Promise.resolve(leaf) : this.openSidebar(true);
    open.then((l) => (l && look ? ws.revealLeaf(l) : null)).finally(() => { this.keeping = false; });
  }

  screens() {
    return Array.from(this.plugin.screens || []);
  }

  /** The screen an action means: the browse view if it has the page, else the sidebar's. */
  activeScreen() {
    const view = this.app.workspace.activeLeaf && this.app.workspace.activeLeaf.view;
    if (view && view.screen) return view.screen;
    return this.screens()[0] || null;
  }

  /** Shows the library in the left sidebar; `quiet` makes it without bringing it forward. */
  async openSidebar(quiet) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(LIBRARY_VIEW)[0];
    if (!leaf) {
      leaf = ws.getLeftLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: LIBRARY_VIEW, active: !quiet });
    }
    if (!quiet) ws.revealLeaf(leaf);
    return leaf;
  }

  /** Shows a folder (or the whole vault) in the browse view, in the page. */
  async browse(folder) {
    const ws = this.app.workspace;
    const leaf = ws.getLeavesOfType(BROWSE_VIEW)[0] || ws.getLeaf(false);
    await leaf.setViewState({ type: BROWSE_VIEW, active: true, state: { at: folder ? folder.path : '/' } });
    ws.revealLeaf(leaf);
    return leaf;
  }

  /** Steps to the note before or after the open one in its folder. */
  step(file, by) {
    const [previous, next] = neighbours(this.plugin, file);
    const to = by < 0 ? previous : next;
    if (to) this.app.workspace.getLeaf(false).openFile(to);
    return to;
  }

  actions() {
    const screen = () => this.activeScreen();
    return [
      { id: 'open-library', name: 'Open library', run: () => this.openSidebar() },
      { id: 'browse-vault', name: 'Show the vault in the page', run: () => this.browse(null) },
      { id: 'search-library', name: 'Search the library', run: async () => { const leaf = await this.browse(null); if (leaf && leaf.view.screen) leaf.view.screen.search(''); } },
      { id: 'reset-layout', name: 'Put the library back in place', run: async () => {
        this.app.workspace.detachLeavesOfType(LIBRARY_VIEW);
        await this.openSidebar();
        this.app.workspace.trigger('design-redux:reset-layout');
      } },
      { id: 'go-back', name: 'Go back', when: () => !!screen(), run: () => screen().back() },
      { id: 'go-forward', name: 'Go forward', when: () => !!screen() && screen().ahead.length > 0, run: () => screen().forward() },
      { id: 'new-note-here', name: 'New note in the current folder', on: 'folder', menu: false, run: (ctx) => this.plugin.files.newNote(ctx.folder) },
      { id: 'new-folder-here', name: 'New folder in the current folder', on: 'folder', menu: false, run: (ctx) => this.plugin.files.newFolder(ctx.folder) },
      { id: 'previous-in-album', name: 'Previous note in folder', on: 'note', menu: false, when: (ctx) => !!neighbours(this.plugin, ctx.file)[0], run: (ctx) => this.step(ctx.file, -1) },
      { id: 'next-in-album', name: 'Next note in folder', on: 'note', menu: false, when: (ctx) => !!neighbours(this.plugin, ctx.file)[1], run: (ctx) => this.step(ctx.file, 1) },
    ];
  }
}
Library.key = 'library';
Library.title = 'Library';
Library.section = 'Library';
Library.about = 'Folders and notes: a tree in the sidebar, a folder\'s notes in the page.';
