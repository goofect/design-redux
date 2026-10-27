/* ------------------------------------------------------------------ */
/* Pins                                                                */
/*                                                                     */
/* Pinning is bookmarking. The Bookmarks core plugin owns the data, so */
/* a pin made here shows in Obsidian's own bookmarks pane and outlives */
/* this plugin. Its add and remove methods aren't part of the public   */
/* API, so every call is guarded.                                      */
/* ------------------------------------------------------------------ */

import { Notice, TFolder } from 'obsidian';
import { moveBefore } from './070-orders.js';

export class Pins {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  /** Pins in the order they've been arranged in, if they have been. */
  arranged(items) {
    return this.plugin.orders ? this.plugin.orders.arrangePins(items) : items;
  }

  /**
   * One pin put before another, or last, and the order from then on your
   * own: in the sidebar and on the Pinned screen alike. `paths` is the
   * order it was moved in, where that's shown sorted rather than as kept.
   */
  move(path, before, paths = this.all().map((t) => t.path)) {
    if (!this.plugin.orders) return;
    this.plugin.orders.setPins(moveBefore(paths, path, before));
    const settings = this.plugin.settings;
    settings.keepOwnOrder = Object.assign({}, settings.keepOwnOrder, { pinned: true });
    this.plugin.saveData(settings);
  }

  /** Folders and notes together, in their arrangement, or folders first. */
  all() {
    return this.arranged(this.collect('folder', (p) => this.app.vault.getFolderByPath(p)).concat(
      this.collect('file', (p) => this.app.vault.getFileByPath(p))
    ));
  }

  /** The Bookmarks plugin's instance, if it's switched on. */
  instance() {
    try {
      const plugin = this.app.internalPlugins.getPluginById('bookmarks');
      if (!plugin || plugin.enabled === false) return null;
      const instance = plugin.instance;
      return instance && typeof instance.getBookmarks === 'function'
        ? instance
        : null;
    } catch (err) {
      return null;
    }
  }

  /** Every bookmark of a kind, flattened out of its groups. */
  collect(type, resolve) {
    const instance = this.instance();
    if (!instance) return [];
    const out = [];
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (item.type === 'group') return walk(item.items);
        // A bookmark to a heading or block is to that part, not a pin.
        if (item.type !== type || !item.path || item.subpath) return;
        const target = resolve(item.path);
        if (target && out.indexOf(target) === -1) out.push(target);
      });
    walk(instance.getBookmarks());
    return out;
  }

  files() {
    return this.arranged(this.collect('file', (p) => this.app.vault.getFileByPath(p)));
  }

  folders() {
    return this.arranged(this.collect('folder', (p) => this.app.vault.getFolderByPath(p)));
  }

  /**
   * Pins whose folder or note isn't there any more — moved while Obsidian
   * was closed, synced away, deleted: { item, type, path, name }, so they
   * can be shown and put right rather than quietly dropped.
   */
  missing() {
    const instance = this.instance();
    if (!instance) return [];
    const out = [];
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (item.type === 'group') return walk(item.items);
        if ((item.type !== 'file' && item.type !== 'folder') || !item.path || item.subpath) return;
        if (this.app.vault.getAbstractFileByPath(item.path)) return;
        const leaf = item.path.split('/').pop();
        out.push({ item, type: item.type, path: item.path, name: item.type === 'file' ? leaf.replace(/\.md$/, '') : leaf });
      });
    walk(instance.getBookmarks());
    return out;
  }

  /** Where a missing pin's folder or note likely went: the one of its name elsewhere, if there's exactly one. */
  likely(pin) {
    const leaf = pin.path.split('/').pop();
    const found = [];
    const walk = (folder) =>
      (folder.children || []).forEach((child) => {
        const isFolder = child instanceof TFolder;
        if (isFolder === (pin.type === 'folder') && child.name === leaf) found.push(child);
        if (isFolder) walk(child);
      });
    walk(this.app.vault.getRoot());
    return found.length === 1 ? found[0] : null;
  }

  /** A missing pin made to point at `target`, keeping its place among the pins and what was kept by its path. */
  repoint(pin, target) {
    const instance = this.instance();
    if (!instance) return false;
    try {
      instance.removeItem(pin.item);
      if (!this.find(target.path)) {
        const item = { type: target instanceof TFolder ? 'folder' : 'file', path: target.path };
        if (pin.item.title) item.title = pin.item.title;
        instance.addItem(item);
      }
    } catch (err) {
      console.error('Design Redux: could not update pins', err);
      new Notice('Could not update pins.');
      return false;
    }
    if (this.plugin.orders) this.plugin.orders.followRename(target, pin.path);
    return true;
  }

  /** A missing pin let go. */
  forget(pin) {
    const instance = this.instance();
    if (!instance) return false;
    try {
      instance.removeItem(pin.item);
      return true;
    } catch (err) {
      console.error('Design Redux: could not update pins', err);
      new Notice('Could not update pins.');
      return false;
    }
  }

  /** The bookmark for a path, searching inside groups too. */
  find(path) {
    const instance = this.instance();
    if (!instance) return null;
    let found = null;
    const walk = (items) =>
      (items || []).forEach((item) => {
        if (found) return;
        if (item.type === 'group') return walk(item.items);
        if (item.path === path && !item.subpath) found = item;
      });
    walk(instance.getBookmarks());
    return found;
  }

  has(target) {
    return !!this.find(target.path);
  }

  toggle(target) {
    const instance = this.instance();
    if (!instance) {
      new Notice('Turn on the Bookmarks core plugin to pin things.');
      return false;
    }
    try {
      const existing = this.find(target.path);
      if (existing) instance.removeItem(existing);
      else {
        instance.addItem({
          type: target instanceof TFolder ? 'folder' : 'file',
          path: target.path,
        });
      }
      return true;
    } catch (err) {
      console.error('Design Redux: could not update pins', err);
      new Notice('Could not update pins.');
      return false;
    }
  }
}

