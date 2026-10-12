import { TFile, TFolder } from 'obsidian';
import { pageFolder } from '../core/030-helpers-art.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { movedPath } from '../core/070-orders.js';
import { Feature } from '../core/080-feature.js';
import { keyLike } from './290-bulk-engine.js';
import { DEFAULTS_DELAY, MergePropertiesModal, RenamePropertyModal } from './301-bulk-properties.js';
import { RenameTagModal, RenameValueModal } from './302-bulk-tags-values.js';
import { ChangeTypeModal } from './303-bulk-types.js';
import { PropertyToolsModal } from './304-bulk-list.js';

export class BulkEditing extends Feature {
  actions() {
    return [
      {
        id: 'add-properties-to-folders',
        name: 'Add properties to folders…',
        run: () => {
          const folder = pageFolder(this.app);
          this.openAdd(folder && !(folder.isRoot && folder.isRoot()) ? [folder] : []);
        },
      },
      {
        id: 'rename-property-everywhere',
        name: 'Rename a property everywhere…',
        run: () => this.openRenameProperty(),
      },
      {
        id: 'merge-properties',
        name: 'Merge properties…',
        run: () => this.openMerge(),
      },
      {
        id: 'rename-tag-everywhere',
        name: 'Rename a tag everywhere…',
        run: () => this.openRenameTag(),
      },
      {
        id: 'remove-properties-from-folders',
        name: 'Remove properties from folders…',
        run: () => this.openRemove(this.pageFolderTargets()),
      },
      {
        id: 'rename-value-everywhere',
        name: 'Rename a property value everywhere…',
        run: () => this.openRenameValue(),
      },
      {
        id: 'change-property-type',
        name: 'Change a property’s type…',
        run: () => this.openChangeType(),
      },
      {
        id: 'find-missing-properties',
        name: 'Find notes missing a property…',
        run: () => this.openMissing(this.pageFolderTargets()),
      },
      {
        id: 'folder-default-properties',
        name: 'Default properties for this folder…',
        when: () => this.pageFolderTargets().length > 0,
        run: () => this.openDefaults(this.pageFolderTargets()[0]),
      },
      {
        id: 'undo-bulk-change',
        name: 'Undo the last bulk change',
        when: () => !!this.plugin.bulk.last,
        run: () => this.plugin.bulk.undo(),
      },
    ];
  }

  /** The folder the page is in, as a starting point, unless it's the vault itself. */
  pageFolderTargets() {
    const folder = pageFolder(this.app);
    return folder && !(folder.isRoot && folder.isRoot()) ? [folder] : [];
  }

  /** The one Properties window, open at a tab. */
  openTools(targets, tab, args) {
    new PropertyToolsModal(this.plugin, targets, tab, args).open();
  }

  openRemove(targets, keys) {
    this.openTools(targets, 'remove', { keys: keys });
  }

  openRenameValue(key, value) {
    new RenameValueModal(this.plugin, key, value).open();
  }

  openChangeType(key) {
    new ChangeTypeModal(this.plugin, key).open();
  }

  openMissing(targets, key) {
    this.openTools(targets, 'missing', { key: key });
  }

  openDefaults(folder) {
    if (folder) this.openTools([folder], 'defaults');
  }

  /**
   * The defaults a note gets from the folders it's in: every folder up
   * from it that has some, the nearest deciding where two name the same
   * property.
   */
  defaultsFor(file) {
    const all = this.settings.folderDefaults || {};
    const chain = [];
    for (let f = file.parent; f; f = f.parent) {
      if (all[f.path]) chain.unshift(all[f.path]);
      if (f.isRoot && f.isRoot()) break;
    }
    const merged = new Map();
    chain.forEach((props) =>
      (props || []).forEach((p) => {
        if (p && p.key) merged.set(p.key.toLowerCase(), p);
      })
    );
    return Array.from(merged.values());
  }

  /**
   * A note made in a folder with defaults gets them — only what it
   * doesn't have, a moment after it's made, so a template filling it in
   * goes first and its values win. A folder's own note describes the
   * folder, and is left out.
   */
  applyDefaults(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || !file.parent) return;
    const props = this.defaultsFor(file);
    if (!props.length) return;
    const pattern = this.settings.folderNoteName || '{{folder}}';
    if (file.basename === pattern.replace(/\{\{folder\}\}/g, file.parent.name)) return;
    window.setTimeout(async () => {
      if (this.app.vault.getFileByPath(file.path) !== file) return;
      await this.plugin.notes.write(
        file,
        (fm) =>
          props.forEach((p) => {
            if (keyLike(fm, p.key) === undefined) fm[p.key] = JSON.parse(JSON.stringify(p.value === undefined ? null : p.value));
          }),
        { failure: false }
      );
    }, DEFAULTS_DELAY);
  }

  /** Defaults follow their folder when it's renamed or moved, and go with it. */
  followFolder(file, oldPath) {
    const all = this.settings.folderDefaults || {};
    if (!(file instanceof TFolder) || !Object.keys(all).length) return;
    const next = {};
    let changed = false;
    Object.keys(all).forEach((p) => {
      if (oldPath === null) {
        if (p === file.path || p.startsWith(file.path + '/')) {
          changed = true;
          return;
        }
        next[p] = all[p];
        return;
      }
      const moved = movedPath(p, oldPath, file.path);
      if (moved !== p) changed = true;
      next[moved] = all[p];
    });
    if (!changed) return;
    this.settings.folderDefaults = next;
    this.plugin.saveData(this.settings);
  }

  openAdd(targets) {
    this.openTools(targets, 'add');
  }

  openRenameProperty(from, to) {
    new RenamePropertyModal(this.plugin, from, to).open();
  }

  openMerge(names) {
    new MergePropertiesModal(this.plugin, names || []).open();
  }

  openRenameTag(from) {
    new RenameTagModal(this.plugin, from).open();
  }

  register() {
    const ws = this.app.workspace;
    const section = (item, name) => {
      if (typeof item.setSection === 'function') item.setSection(name);
      return item;
    };

    this.plugin.registerEvent(
      ws.on('file-menu', (menu, file) => {
        if (!(file instanceof TFolder) || (file.isRoot && file.isRoot())) return;
        // One entry, opening one window with a tab for each tool.
        menu.addItem((item) =>
          section(item, 'action')
            .setTitle('Properties…')
            .setIcon('list')
            .onClick(() => this.openTools([file]))
        );
      })
    );
    // New notes get their folder's defaults; defaults follow their folder.
    this.plugin.registerEvent(this.app.vault.on('create', (file) => this.applyDefaults(file)));
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.followFolder(file, oldPath)));
    this.plugin.registerEvent(this.app.vault.on('delete', (file) => this.followFolder(file, null)));

    // Several chosen in the file explorer at once.
    this.plugin.registerEvent(
      ws.on('files-menu', (menu, files) => {
        const targets = (files || []).filter(
          (f) => (f instanceof TFolder && !(f.isRoot && f.isRoot())) || (f instanceof TFile && f.extension === 'md')
        );
        if (!targets.length) return;
        const folders = targets.filter((f) => f instanceof TFolder).length;
        const notes = targets.length - folders;
        const parts = [];
        if (folders) parts.push(bulkCount(folders, 'folder'));
        if (notes) parts.push(bulkCount(notes, 'note'));
        menu.addItem((item) =>
          section(item, 'action')
            .setTitle(`Properties of ${parts.join(' and ')}…`)
            .setIcon('list')
            .onClick(() => this.openTools(targets))
        );
      })
    );

    // A tag under the cursor, going by where Obsidian found tags.
    this.plugin.registerEvent(
      ws.on('editor-menu', (menu, editor, info) => {
        const file = info && info.file;
        if (!file || !editor || typeof editor.getCursor !== 'function') return;
        const at = editor.getCursor();
        const cache = this.app.metadataCache.getFileCache(file);
        const tag = ((cache && cache.tags) || []).find(
          (t) =>
            t.position &&
            t.position.start.line === at.line &&
            t.position.start.col <= at.ch &&
            at.ch <= t.position.end.col
        );
        if (!tag) return;
        menu.addItem((item) =>
          section(item, 'action')
            .setTitle(`Rename ${tag.tag} everywhere…`)
            .setIcon('hash')
            .onClick(() => this.openRenameTag(tag.tag))
        );
      })
    );
  }
}

