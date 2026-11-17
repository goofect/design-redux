/* ------------------------------------------------------------------ */
/* The library screen: one place, one view of it                       */
/*                                                                     */
/* What the sidebar and the browse view both are: a place you are in   */
/* (`at`). At the vault's top the sidebar is its search field and the  */
/* folders' names; the browse view a head (search, more) and the grid. */
/* A folder is its page: a head (back, more), its name large, and what */
/* it holds as rows. Drawing reads the index and nothing else, and is  */
/* put off to one turn however many things changed at once.            */
/* ------------------------------------------------------------------ */

import { Keymap, TFile, TFolder } from 'obsidian';
import { clear, el } from '../core/dom.js';
import { headRow } from '../ui/head.js';
import { rove } from '../ui/keys.js';
import { contentRows, drawFolderPage, drawGrid } from './contents.js';
import { folderMenu, noteMenu, showMenu } from './menus.js';
import { drawFiltered, isFiltering } from './filters.js';
import { drawSearch } from './search.js';

export class LibraryScreen {
  /** `opts`: { wide (the browse view), place, onGo(folder) }. */
  constructor(plugin, host, opts = {}) {
    this.plugin = plugin;
    this.host = host;
    this.opts = opts;
    this.at = '/';
    this.past = [];
    this.ahead = [];
    this.scrolls = new Map();
    this.query = null;
    this.filter = null;
    this.filterName = null;
    this.pending = false;
    this.stops = [];
    host.classList.add('dr', 'dr-library');
    if (opts.wide) host.classList.add('is-wide');
  }

  get app() {
    return this.plugin.app;
  }

  /** The folder being shown: the vault itself when the one remembered is gone. */
  folder() {
    const f = this.app.vault.getAbstractFileByPath(this.at);
    return f instanceof TFolder ? f : this.app.vault.getRoot();
  }

  /** Goes into a folder (or back out to the vault with null). */
  go(folder, quiet) {
    const path = folder ? folder.path : '/';
    if (path === this.at) return;
    this.remember();
    if (!quiet) {
      this.past.push(this.at);
      this.ahead.length = 0;
    }
    this.at = path;
    this.query = null;
    if (this.opts.onGo) this.opts.onGo(this.folder());
    this.draw();
  }

  /** Shows the notes a filter lets through in place of the folder; null puts the folder back. */
  setFilter(filter, name) {
    this.filter = isFiltering(filter) ? filter : null;
    this.filterName = this.filter ? name || null : null;
    this.query = null;
    this.draw();
  }

  back() {
    if (this.query !== null) return void this.search(null);
    if (this.filter) return void this.setFilter(null);
    if (this.past.length) {
      this.ahead.push(this.at);
      return this.go(this.app.vault.getAbstractFileByPath(this.past.pop()), true);
    }
    const here = this.folder();
    if (here.path !== '/') this.go(here.parent && here.parent.path !== '/' ? here.parent : null, true);
  }

  forward() {
    if (!this.ahead.length) return;
    this.past.push(this.at);
    this.go(this.app.vault.getAbstractFileByPath(this.ahead.pop()), true);
  }

  /** Opens or closes the search: a string (even empty) shows it, null puts the folder back. */
  search(query) {
    this.query = query;
    this.draw();
    if (query !== null && this.searchInput) this.searchInput.focus();
  }

  /** Opens a note: in the page, or in a new tab with the modifier held. */
  openNote(file, event, subpath) {
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(event && Keymap.isModEvent(event) ? 'tab' : false);
    return leaf.openFile(file, subpath ? { eState: { subpath } } : undefined);
  }

  pick(entry) {
    this.plugin.selection.pick(entry);
  }

  /** The note open in the page, if it is one. */
  openFile() {
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile ? file : null;
  }

  remember() {
    if (this.body) this.scrolls.set(this.at, this.body.scrollTop);
  }

  /** Asks for a redraw; many asks in one turn are one redraw. */
  refresh() {
    if (this.pending) return;
    this.pending = true;
    Promise.resolve().then(() => {
      this.pending = false;
      if (this.host.isConnected) this.draw();
    });
  }

  draw() {
    const host = this.host;
    const hadFocus = host.contains(host.ownerDocument.activeElement) ? host.ownerDocument.activeElement.dataset.path : undefined;
    this.stops.splice(0).forEach((stop) => stop());
    clear(host);
    const folder = this.folder();
    const top = folder.path === '/' && !this.filter;
    const wide = !!this.opts.wide;
    const more = { glyph: 'more', label: 'More', run: (e) => showMenu(folderMenu(this.plugin, folder, this), e) };
    // The head holds a screen's few controls and a line under it; the sidebar's top has none: its search field is its one control.
    if (top && wide) headRow(host, { buttons: [{ glyph: 'search', label: 'Search', pressed: this.query !== null, run: () => this.search(this.query === null ? '' : null) }, more] });
    else if (!top) headRow(host, { back: () => this.back(), buttons: [more] });
    this.body = el(host, 'div', 'dr-library-body');
    if (top && !wide) drawSearch(this, this.body, (idle) => contentRows(this, idle, folder));
    else if (top && this.query !== null) drawSearch(this, this.body);
    else if (top) drawGrid(this, this.body, folder);
    else if (this.filter) {
      el(this.body, 'div', 'dr-display dr-folder-name', this.filterName || 'Filtered');
      drawFiltered(this, this.body);
    } else drawFolderPage(this, this.body, folder);
    this.body.addEventListener('contextmenu', (e) => this.menuFor(e));
    this.body.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) this.menuFor(e);
      else if (e.key === 'Backspace' && e.target.tagName !== 'INPUT') this.back();
    });
    this.keepPlace(hadFocus);
  }

  /** One Tab stop a list in what was drawn; `selector` is what the arrows move among. */
  roving(container, selector, columns) {
    this.stops.push(rove(container, selector, { columns, jump: this.plugin.settings.typeToJump !== false }));
  }

  /** After a draw: what is open or picked is brought into sight; failing that, where the list was left. */
  keepPlace(focusPath) {
    const body = this.body;
    const find = (path) => (path == null ? null : Array.from(body.querySelectorAll('[data-path]')).find((n) => n.dataset.path === path));
    const open = this.openFile();
    const marked = find(focusPath) || find(this.plugin.selection.path) || (open ? find(open.path) : null);
    const kept = this.scrolls.get(this.at);
    if (kept != null) body.scrollTop = kept;
    else if (marked && typeof marked.scrollIntoView === 'function') marked.scrollIntoView({ block: 'nearest' });
    if (focusPath !== undefined && marked) marked.focus();
  }

  menuFor(event) {
    const node = event.target.closest ? event.target.closest('[data-path]') : null;
    const entry = node ? this.app.vault.getAbstractFileByPath(node.dataset.path) : null;
    if (!entry) return;
    event.preventDefault();
    this.pick(entry);
    showMenu(entry instanceof TFolder ? folderMenu(this.plugin, entry, this) : noteMenu(this.plugin, entry, this), event);
  }
}
