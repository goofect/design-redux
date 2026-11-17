/* ------------------------------------------------------------------ */
/* The library: the feature                                            */
/*                                                                     */
/* Registers the sidebar and the browse view, keeps every open screen  */
/* true to the vault, the pick and the open note, and lists what the   */
/* library can do.                                                     */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';
import { folderGlyph } from './faces.js';
import { neighbours } from './order.js';
import { BROWSE_VIEW, BrowseView, LIBRARY_VIEW, LibraryView } from './views.js';
import { reducedWorkspace } from './workspace.js';

export class Library extends Feature {
  register() {
    this.plugin.registerView(LIBRARY_VIEW, (leaf) => new LibraryView(leaf, this.plugin));
    this.plugin.registerView(BROWSE_VIEW, (leaf) => new BrowseView(leaf, this.plugin));
  }

  enable() {
    const ws = this.app.workspace;
    const marked = new Set();
    const mark = (doc) => {
      if (!doc || !doc.body) return;
      doc.body.classList.add('dr-browser-open');
      marked.add(doc);
    };
    if (typeof document !== 'undefined') mark(document);
    if (typeof activeDocument !== 'undefined') mark(activeDocument);
    this.listen(ws, 'window-open', (win) => mark(win && (win.doc || (win.win && win.win.document))));
    this.add(() => { marked.forEach((doc) => doc.body.classList.remove('dr-browser-open')); marked.clear(); });
    const redraw = () => this.screens().forEach((s) => s.refresh());
    ['design-redux:vault', 'design-redux:pick', 'design-redux:settings', 'design-redux:props', 'file-open'].forEach((name) => this.listen(ws, name, redraw));
    this.add(() => {
      if (this.plugin.unloading) return;
      ws.detachLeavesOfType(LIBRARY_VIEW);
      ws.detachLeavesOfType(BROWSE_VIEW);
    });
    // For the strip: where a note stands in its folder, and the folder's face.
    this.plugin.placeOf = (file) => neighbours(this.plugin, file);
    this.plugin.faceOf = (folder) => folderGlyph(this.plugin, folder);
    this.add(() => { delete this.plugin.placeOf; delete this.plugin.faceOf; });
    ws.detachLeavesOfType(LIBRARY_VIEW);
    ws.detachLeavesOfType('file-explorer');
    reducedWorkspace(this);
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

  /** Shows a folder (or the whole vault) in the browse view, in the page. */
  browse(folder, onlyEmpty = false) {
    const pending = (this.browsing || Promise.resolve()).catch(() => {}).then(() => this.openBrowser(folder, onlyEmpty));
    this.browsing = pending;
    return pending.finally(() => { if (this.browsing === pending) this.browsing = null; });
  }

  async openBrowser(folder, onlyEmpty) {
    if (!this.on) return null;
    const ws = this.app.workspace;
    const type = ws.activeLeaf?.getViewState().type;
    if (onlyEmpty && (type ? !['empty', 'file-explorer'].includes(type) : ws.getLeavesOfType('markdown').length > 0)) return null;
    const existing = ws.getLeavesOfType(BROWSE_VIEW)[0];
    const leaf = existing || ws.getLeaf(false);
    if (existing) await ws.revealLeaf(leaf);
    if (leaf.view instanceof BrowseView && leaf.view.screen) {
      leaf.view.screen.go(folder);
      leaf.view.folderScreen.go(folder, true);
    } else await leaf.setViewState({ type: BROWSE_VIEW, active: true, state: { at: folder ? folder.path : '/' } });
    await ws.revealLeaf(leaf);
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
      { id: 'open-library', name: 'Open library', glyph: 'library', run: () => this.browse(null) },
      { id: 'library-inbox', name: 'Open vault notes', glyph: 'inbox', run: () => this.browse(null) },
      { id: 'browse-vault', name: 'Browse files', glyph: 'grid', run: () => this.browse(null) },
      { id: 'reset-layout', name: 'Put the library back in place', glyph: 'layout', run: async () => {
        this.app.workspace.detachLeavesOfType(LIBRARY_VIEW);
        await this.browse(null);
        this.app.workspace.trigger('design-redux:reset-layout');
      } },
      { id: 'cycle-cover-size', name: 'Open files', glyph: 'density', when: () => !!screen(), run: () => this.browse(screen().folder()) },
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
      { key: 'defaultSort', name: 'Order of notes', desc: 'Where a folder has no order of its own.', type: 'choice', options: { name: 'Name', modified: 'Last edited', created: 'Date made' } },
      { key: 'hideFolderNotes', name: 'Leave out folder notes', desc: 'A folder’s own note is not listed among its notes.', type: 'toggle' },
      { key: 'folderNoteName', name: 'A folder note’s name', desc: '{{folder}} stands for the folder’s name.', type: 'text' },
      { key: 'typeToJump', name: 'Type to jump', desc: 'Typing the start of a name goes to it.', type: 'toggle' },
      { key: 'sidebarDrop', name: 'Drag onto a folder to move', type: 'toggle' },
    ];
  }
}
Library.key = 'library';
Library.title = 'Library';
Library.glyph = 'library';
Library.section = 'Library';
Library.about = 'The workspace: folders, notes, and a way back.';
