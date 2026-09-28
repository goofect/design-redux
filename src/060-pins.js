/* ------------------------------------------------------------------ */
/* Pins                                                                */
/*                                                                     */
/* Pinning is bookmarking. The Bookmarks core plugin owns the data, so */
/* a pin made here shows in Obsidian's own bookmarks pane and outlives */
/* this plugin. Its add and remove methods aren't part of the public   */
/* API, so every call is guarded.                                      */
/* ------------------------------------------------------------------ */

class Pins {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }

  /** Pins in the order they've been arranged in, if they have been. */
  arranged(items) {
    return this.plugin.orders ? this.plugin.orders.arrangePins(items) : items;
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

