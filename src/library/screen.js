/* ------------------------------------------------------------------ */
/* The library screen: one place, three levels of detail               */
/*                                                                     */
/* What the sidebar and the browse view both are: a folder you are in  */
/* (`at`), shown as objects, as shelves or as words, under a head row  */
/* with the zoom control. Switching level keeps the folder, the pick   */
/* and the open note, and brings whichever is marked back into sight.  */
/* Drawing reads the index and nothing else, and is put off to one     */
/* turn however many things changed at once.                           */
/* ------------------------------------------------------------------ */

import { Keymap, TFile, TFolder } from 'obsidian';
import { clear, el } from '../core/dom.js';
import { headRow } from '../ui/head.js';
import { rove } from '../ui/keys.js';
import { segments } from '../ui/segments.js';
import { drawObjects } from './level-objects.js';
import { drawShelves } from './level-shelves.js';
import { drawWords } from './level-words.js';
import { folderMenu, noteMenu, showMenu } from './menus.js';
import { drawFiltered, isFiltering } from './filters.js';
import { drawSearch } from './search.js';

export const LEVELS = [
  { id: 'objects', glyph: 'zoom-objects', label: 'Objects' },
  { id: 'shelves', glyph: 'zoom-shelves', label: 'Shelves' },
  { id: 'words', glyph: 'zoom-words', label: 'Words' },
];

export class LibraryScreen {
  /** `opts`: { wide, place (the key its level is remembered under), buttons(screen): extra head buttons }. */
  constructor(plugin, host, opts = {}) {
    this.plugin = plugin;
    this.host = host;
    this.opts = opts;
    this.at = '/';
    this.past = [];
    this.ahead = [];
    this.expanded = new Map(); // in words: the folders opened or closed by hand, by path
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

  get level() {
    const kept = (this.plugin.settings.libraryZoom || {})[this.opts.place || 'main'];
    return LEVELS.some((l) => l.id === kept) ? kept : 'objects';
  }

  /** The folder being shown: the vault itself when the one remembered is gone. */
  folder() {
    const f = this.app.vault.getAbstractFileByPath(this.at);
    return f instanceof TFolder ? f : this.app.vault.getRoot();
  }

  async setLevel(id) {
    if (id === this.level) return;
    this.remember();
    (this.plugin.settings.libraryZoom || (this.plugin.settings.libraryZoom = {}))[this.opts.place || 'main'] = id;
    this.draw();
    await this.plugin.saveData(this.plugin.settings);
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

  /** In words: opens or closes a folder's line. */
  toggle(path, open) {
    this.expanded.set(path, !!open);
    this.draw();
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
    if (this.body) this.scrolls.set(`${this.at}|${this.level}`, this.body.scrollTop);
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
    const inside = folder.path !== '/';
    // Library and Search are the plugin's titles, in capitals; a folder's name or a filter's is the person's words, read as written.
    const own = this.query === null && (this.filter || inside);
    const head = headRow(host, {
      label: this.query !== null ? 'Search' : this.filter ? this.filterName || 'Filtered' : inside ? folder.name : 'Library',
      text: !!own,
      back: inside || this.query !== null || this.filter || this.past.length ? () => this.back() : null,
      buttons: [{ glyph: 'search', label: 'Search', pressed: this.query !== null, run: () => this.search(this.query === null ? '' : null) }].concat(this.opts.buttons ? this.opts.buttons(this) : []),
    });
    segments(head, { label: 'Level of detail', options: LEVELS, value: this.level, onChange: (id) => this.setLevel(id) });
    this.body = el(host, 'div', 'dr-library-body');
    if (this.query !== null) drawSearch(this, this.body);
    else if (this.filter) drawFiltered(this, this.body);
    else if (this.level === 'shelves') drawShelves(this, this.body, folder);
    else if (this.level === 'words') (this.opts.words || drawWords)(this, this.body, folder);
    else drawObjects(this, this.body, folder);
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
    const kept = this.scrolls.get(`${this.at}|${this.level}`);
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
