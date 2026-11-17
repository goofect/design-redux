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
import { drawFileList } from './file-list.js';
import { folderMenu, noteMenu, showMenu } from './menus.js';

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
    if (path === this.at) {
      if (!quiet && this.opts.onGo) this.opts.onGo(this.folder());
      return;
    }
    this.remember();
    if (!quiet) {
      this.past.push(this.at);
      this.ahead.length = 0;
    }
    this.at = path;
    if (this.opts.onGo) this.opts.onGo(this.folder());
    this.draw();
    if (!quiet) (this.plugin.screens || []).forEach((screen) => { if (screen !== this) screen.go(folder, true); });
  }

  back() {
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
    const inside = folder.path !== '/';
    headRow(host, { label: this.opts.wide ? (inside ? folder.name : 'Vault') : 'Library' });
    if (this.opts.wide) {
      const breadcrumb = el(host, 'div', 'dr-file-breadcrumb');
      const parts = [];
      for (let f = folder; f && f.path !== '/'; f = f.parent) parts.unshift(f);
      const root = el(breadcrumb, 'button', '', 'Vault');
      root.type = 'button';
      root.addEventListener('click', () => this.go(null));
      parts.forEach((part) => {
        el(breadcrumb, 'span', '', ' / ');
        const button = el(breadcrumb, 'button', '', part.name);
        button.type = 'button';
        button.addEventListener('click', () => this.go(part));
      });
    }
    this.body = el(host, 'div', 'dr-library-body');
    drawFileList(this, this.body, folder);
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
    if (entry instanceof TFolder && entry.path === '/') return;
    event.preventDefault();
    this.pick(entry);
    const menu = entry instanceof TFolder ? folderMenu(this.plugin, entry, this) : noteMenu(this.plugin, entry, this);
    showMenu(menu, event);
  }
}
