/* ------------------------------------------------------------------ */
/* The library: the feature                                            */
/*                                                                     */
/* Registers the sidebar and the browse view, keeps every open screen  */
/* true to the vault, the pick and the open note, and lists what the   */
/* library can do.                                                     */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';
import { iconId } from '../core/icons.js';
import { drawDetail } from './detail.js';
import { folderGlyph } from './faces.js';
import { neighbours } from './order.js';
import { LEVELS } from './screen.js';
import { BROWSE_VIEW, BrowseView, LIBRARY_VIEW, LibraryView } from './views.js';

export class Library extends Feature {
  register() {
    this.plugin.registerView(LIBRARY_VIEW, (leaf) => new LibraryView(leaf, this.plugin));
    this.plugin.registerView(BROWSE_VIEW, (leaf) => new BrowseView(leaf, this.plugin));
  }

  enable() {
    const ws = this.app.workspace;
    const redraw = () => this.screens().forEach((s) => s.refresh());
    ['design-redux:vault', 'design-redux:pick', 'design-redux:settings', 'design-redux:props', 'file-open'].forEach((name) => this.listen(ws, name, redraw));
    const ribbon = this.plugin.addRibbonIcon(iconId('library'), 'Open library', () => this.openSidebar());
    this.add(() => ribbon && ribbon.remove && ribbon.remove());
    this.add(() => {
      if (this.plugin.unloading) return;
      ws.detachLeavesOfType(LIBRARY_VIEW);
      ws.detachLeavesOfType(BROWSE_VIEW);
    });
    // For the panel, which may not import the library: a folder picked, drawn.
    this.plugin.drawFolder = (host, folder) => drawDetail(this.plugin, host, folder, { open: (f) => this.browse(f), note: (file) => ws.getLeaf(false).openFile(file) });
    this.add(() => delete this.plugin.drawFolder);
    // For the strip: where a note stands in its folder, and the folder's face.
    this.plugin.placeOf = (file) => neighbours(this.plugin, file);
    this.plugin.faceOf = (folder) => folderGlyph(this.plugin, folder);
    this.add(() => { delete this.plugin.placeOf; delete this.plugin.faceOf; });
    if (!ws.getLeavesOfType(LIBRARY_VIEW).length) this.openSidebar(true);
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
      { id: 'open-library', name: 'Open library', glyph: 'library', run: () => this.openSidebar() },
      { id: 'browse-vault', name: 'Browse vault as a grid', glyph: 'grid', run: () => this.browse(null) },
      { id: 'reset-layout', name: 'Put the library back in place', glyph: 'layout', run: async () => {
        this.app.workspace.detachLeavesOfType(LIBRARY_VIEW);
        await this.openSidebar();
        this.app.workspace.trigger('design-redux:reset-layout');
      } },
      { id: 'cycle-cover-size', name: 'Next level of detail: objects, shelves, words', glyph: 'density', when: () => !!screen(), run: () => {
        const s = screen();
        const at = LEVELS.findIndex((l) => l.id === s.level);
        s.setLevel(LEVELS[(at + 1) % LEVELS.length].id);
      } },
      { id: 'go-back', name: 'Go back', glyph: 'back', when: () => !!screen(), run: () => screen().back() },
      { id: 'go-forward', name: 'Go forward', glyph: 'forward', when: () => !!screen() && screen().ahead.length > 0, run: () => screen().forward() },
      { id: 'new-note-here', name: 'New note in the current folder', glyph: 'note-new', on: 'folder', menu: false, run: (ctx) => this.plugin.files.newNote(ctx.folder) },
      { id: 'new-folder-here', name: 'New folder in the current folder', glyph: 'folder-new', on: 'folder', menu: false, run: (ctx) => this.plugin.files.newFolder(ctx.folder) },
      { id: 'previous-in-album', name: 'Previous note in folder', glyph: 'previous-note', on: 'note', menu: false, when: (ctx) => !!neighbours(this.plugin, ctx.file)[0], run: (ctx) => this.step(ctx.file, -1) },
      { id: 'next-in-album', name: 'Next note in folder', glyph: 'next-note', on: 'note', menu: false, when: (ctx) => !!neighbours(this.plugin, ctx.file)[1], run: (ctx) => this.step(ctx.file, 1) },
    ];
  }

  settingsRows() {
    return [
      { key: 'defaultSort', name: 'Order of notes', desc: 'Where a folder has no order of its own.', type: 'choice', options: { name: 'Name', modified: 'Last edited', created: 'Date made', own: 'Your order' } },
      { key: 'hideEmptyFolders', name: 'Leave out empty folders', type: 'toggle' },
      { key: 'hideFolderNotes', name: 'Leave out folder notes', desc: 'A folder’s own note is not listed among its notes.', type: 'toggle' },
      { key: 'folderNoteName', name: 'A folder note’s name', desc: '{{folder}} stands for the folder’s name.', type: 'text' },
      { key: 'tableColumns', name: 'Columns of the table', desc: 'Properties, by name, with commas between.', type: 'text' },
      { key: 'typeToJump', name: 'Type to jump', desc: 'Typing the start of a name goes to it.', type: 'toggle' },
      { key: 'sidebarDrop', name: 'Drag onto a folder to move', type: 'toggle' },
      { key: 'searchNoteText', name: 'Search headings and properties', desc: 'As well as names.', type: 'toggle' },
    ];
  }
}
Library.key = 'library';
Library.title = 'Library';
Library.glyph = 'library';
Library.section = 'Library';
Library.about = 'Folders and notes as objects, shelves or words, in the sidebar and the page.';
