/* ------------------------------------------------------------------ */
/* Browse view: sorting                                               */
/*                                                                    */
/* The order every screen shares, and a screen's empty state. Filters */
/* and Find are 128's. A part of BrowseView (see 120).                */
/* ------------------------------------------------------------------ */

import { ItemView, setIcon } from 'obsidian';
import { BROWSE_VIEW } from '../core/020-constants.js';
import { liveViews } from '../core/034-tabs.js';
import { byName, OWN_ORDER, sortByOrder, SORTS, TABLE_SORTS } from '../core/040-sorting.js';
import { asButton, onActivate } from '../core/042-controls.js';
import { renameTagText, tagUnder } from '../core/047-helpers-text.js';
import { libraryIndex } from '../core/077-library-index.js';
import { ask } from '../core/081-capabilities.js';
import { BrowseView } from './120-browse-view.js';

export class BrowseSorting extends ItemView {
  /** A property, tag or value renamed by the bulk tools: what this screen shows and filters by follows. */
  followRenamed(what) {
    if (what.property) {
      const [from, to] = what.property;
      if (this.property && this.property.toLowerCase() === from.toLowerCase()) {
        this.property = to.toLowerCase();
      }
      if (this.filterProp && String(this.filterProp.key).toLowerCase() === from.toLowerCase()) {
        this.filterProp = Object.assign({}, this.filterProp, { key: to });
      }
      this.filterMore = (this.filterMore || []).map((f) => (String(f.key).toLowerCase() === from.toLowerCase() ? Object.assign({}, f, { key: to }) : f));
    }
    if (what.tag) {
      const [from, to] = what.tag;
      if (this.filterTag && tagUnder(this.filterTag, from)) {
        this.filterTag = renameTagText(this.filterTag, from, to).toLowerCase();
      }
    }
    if (what.value) {
      const [key, from, to] = what.value;
      const sameKey = (k) => String(k || '').toLowerCase() === key.toLowerCase();
      if (sameKey(this.property) && this.value === from) this.value = to;
      if (this.filterProp && sameKey(this.filterProp.key) && this.filterProp.value === from) {
        this.filterProp = Object.assign({}, this.filterProp, { value: to });
      }
      this.filterMore = (this.filterMore || []).map((f) => (sameKey(f.key) && f.value === from ? Object.assign({}, f, { value: to }) : f));
    }
  }

  /* -- sorting and filtering ------------------------------------- */

  /** The one ordering every screen uses, so a choice sticks. */
  sortFiles(files) {
    return sortByOrder(files, this.sort);
  }

  /**
   * Folders in the shared order: by name either way, or by their
   * newest note — a folder's own dates say nothing about what's in it.
   */
  sortFolders(folders) {
    const sort = this.sort;
    const list = folders.slice();
    if (sort === 'name-desc') return list.sort((a, b) => byName(b.name, a.name));
    if (sort === 'modified' || sort === 'created') {
      return list.sort(
        (a, b) => this.folderTime(b, sort) - this.folderTime(a, sort) || byName(a.name, b.name)
      );
    }
    return list.sort((a, b) => byName(a.name, b.name));
  }

  /** The newest note anywhere in a folder. Worked out once per drawing. */
  folderTime(folder, field) {
    if (!this.timeMemo) {
      const memo = { modified: new Map(), created: new Map() };
      libraryIndex(this.plugin).markdown().forEach((file) => {
        for (let p = file.parent; p; p = p.parent) {
          memo.modified.set(p.path, Math.max(memo.modified.get(p.path) || 0, file.stat.mtime));
          memo.created.set(p.path, Math.max(memo.created.get(p.path) || 0, file.stat.ctime));
          if (p.isRoot && p.isRoot()) break;
        }
      });
      this.timeMemo = memo;
      window.setTimeout(() => (this.timeMemo = null), 0);
    }
    return this.timeMemo[field].get(folder.path) || 0;
  }

  /** A property's values in the shared order: by value, or by their newest note. */
  sortGroups(groups) {
    const sort = this.sort;
    const newest = (g) =>
      g.files.reduce((t, f) => Math.max(t, sort === 'created' ? f.stat.ctime : f.stat.mtime), 0);
    const list = groups.slice();
    if (sort === 'name-desc') return list.sort((a, b) => byName(b.value, a.value));
    if (sort === 'modified' || sort === 'created') {
      return list.sort((a, b) => newest(b) - newest(a) || byName(a.value, b.value));
    }
    return list.sort((a, b) => byName(a.value, b.value));
  }

  /**
   * The order every screen uses. One, kept in settings, so a choice made
   * on any screen holds on all of them — in every open tab, after a
   * note has been opened and closed, and after a restart.
   */
  get sort() {
    const settings = this.plugin.settings;
    // A smart album keeps its own order.
    const smart = this.mode === 'smart' ? this.smartAlbum() : null;
    if (smart && smart.sort && SORTS.some(([key]) => key === smart.sort)) return smart.sort;
    // An album sorted on its own keeps that order; everywhere else, the shared one.
    if (this.mode === 'folder' && settings.albumSortMemory !== false) {
      const kept = (settings.albumSorts || {})[this.path];
      if (kept && SORTS.some(([key]) => key === kept)) return kept;
    }
    return settings.defaultSort || 'name';
  }

  /** How the Notes table is sorted: its own column, or the shared order. */
  get tableSort() {
    return this.columnSort || TABLE_SORTS[this.sort] || TABLE_SORTS.name;
  }

  /**
   * The name of this screen's own order, if it has one: Recently opened
   * and Pinned always do, and an album does once it's been arranged.
   */
  ownOrderLabel() {
    if (this.mode === 'folder') {
      const folder = this.folder();
      return folder && this.plugin.orders.hasAlbum(folder) ? 'Collection order' : null;
    }
    return OWN_ORDER[this.mode] || null;
  }

  /** Whether this screen keeps its own order — Recently opened, Pinned, an arranged album. */
  keepsOwnOrder() {
    if (this.mode === 'folder') {
      const folder = this.folder();
      return !!folder && this.plugin.orders.albumOn(folder);
    }
    if (!OWN_ORDER[this.mode]) return false;
    const own = this.plugin.settings.keepOwnOrder || {};
    return own[this.mode] !== false;
  }

  /**
   * Choose an order. 'own' goes back to a screen's own; anything else
   * becomes the order everywhere, and every open screen redraws in it.
   */
  setSort(key) {
    const settings = this.plugin.settings;
    if (this.mode === 'folder') {
      // An arranged album keeps its arrangement to go back to.
      const folder = this.folder();
      if (folder && this.plugin.orders.hasAlbum(folder)) this.plugin.orders.setAlbumOn(folder, key === 'own');
    } else if (OWN_ORDER[this.mode]) {
      settings.keepOwnOrder = Object.assign({}, settings.keepOwnOrder, {
        [this.mode]: key === 'own',
      });
    }
    const smart = this.mode === 'smart' ? this.smartAlbum() : null;
    if (smart && key !== 'own') ask(this.plugin, 'savedViews').change(smart, { sort: key });
    else if (key !== 'own') {
      const folder = this.mode === 'folder' ? this.folder() : null;
      // An album's order is its own, kept by its path; other screens share one.
      if (folder && settings.albumSortMemory !== false) {
        settings.albumSorts = Object.assign({}, settings.albumSorts, { [folder.path]: key });
      } else settings.defaultSort = key;
    }
    this.columnSort = null;
    this.plugin.saveData(settings);

    if (typeof this.app.workspace.getLeavesOfType !== 'function') return;
    liveViews(this.app, BROWSE_VIEW, BrowseView).forEach((view) => {
      if (view === this) return;
      view.columnSort = null;
      view.render();
    });
  }

  /** Where a screen has nothing: a quiet icon, why, and at most one thing to do. */
  emptyState(root, text, icon, action) {
    const box = root.createDiv({ cls: 'dr-empty' });
    if (icon) setIcon(box.createSpan({ cls: 'dr-empty-icon', attr: { 'aria-hidden': 'true' } }), icon);
    box.createSpan({ cls: 'dr-empty-text', text });
    if (action) {
      const button = box.createSpan({ cls: 'dr-empty-action', text: action[0] });
      asButton(button);
      onActivate(button, action[1]);
    }
    return box;
  }

  /** The order in effect, as the menu names it; null for a column it doesn't list. */
  currentSort() {
    if (this.keepsOwnOrder()) return 'own';
    if (this.mode === 'notes' && this.columnSort) return null;
    return this.sort;
  }

  action(parentEl, icon, label, onClick) {
    const btn = parentEl.createDiv({ cls: 'dr-detail-action' });
    asButton(btn);
    setIcon(btn.createSpan({ cls: 'dr-detail-action-icon' }), icon);
    btn.createSpan({ text: label });
    onActivate(btn, onClick);
    return btn;
  }
}
