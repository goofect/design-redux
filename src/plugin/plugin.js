/* ------------------------------------------------------------------ */
/* The plugin: settings loaded, services made, features turned on      */
/* ------------------------------------------------------------------ */

import { Plugin, TFile, TFolder } from 'obsidian';
import { actionCommand } from '../core/actions.js';
import { Files } from '../core/files.js';
import { registerGlyphs, unregisterGlyphs } from '../core/icons.js';
import { LibraryIndex } from '../core/index.js';
import { migrateSettings } from '../core/migrate.js';
import { Notes } from '../core/notes.js';
import { Selection } from '../core/selection.js';
import { followDelete, followRename } from '../core/settings.js';
import { FEATURES } from './features.js';
import { SettingsTab } from './settings-tab.js';

export class DesignRedux extends Plugin {
  async onload() {
    await this.loadSettings();
    this.notes = new Notes(this);
    this.files = new Files(this);
    this.index = new LibraryIndex(this);
    this.selection = new Selection(this);
    registerGlyphs();
    this.register(() => unregisterGlyphs());

    this.features = FEATURES.map((F) => new F(this));
    this.features.forEach((f) => f.register());
    this.actions().forEach((action) => {
      if (action.palette !== false) this.addCommand(actionCommand(this, action));
    });
    this.addSettingTab(new SettingsTab(this.app, this));
    this.watchVault();
    this.app.workspace.onLayoutReady(() => this.features.forEach((f) => f.turn()));
  }

  onunload() {
    this.unloading = true;
    (this.features || []).slice().reverse().forEach((f) => f.off());
  }

  /** One feature, by its class. */
  feature(F) {
    return this.features.find((f) => f instanceof F) || null;
  }

  /** Everything every feature can do. */
  actions() {
    return this.features.flatMap((f) => f.actions().map((a) => Object.assign({ feature: f }, a)));
  }

  /** The folder an action on a folder means: the one picked, else the one open, else the open note's. */
  currentFolder() {
    const picked = this.selection.item;
    if (picked instanceof TFolder) return picked;
    if (this.openFolder instanceof TFolder && this.app.vault.getAbstractFileByPath(this.openFolder.path)) return this.openFolder;
    const file = this.app.workspace.getActiveFile();
    return file && file.parent ? file.parent : null;
  }

  /** Keeps the index, the pick and the path-keyed settings true to the vault. */
  watchVault() {
    const { vault, metadataCache, workspace } = this.app;
    const changed = () => {
      this.index.forget();
      workspace.trigger('design-redux:vault');
    };
    this.registerEvent(vault.on('create', changed));
    this.registerEvent(vault.on('delete', (entry) => {
      this.selection.followDelete(entry.path);
      if (followDelete(this.settings, entry.path)) this.saveData(this.settings);
      changed();
    }));
    this.registerEvent(vault.on('rename', (entry, oldPath) => {
      this.selection.followRename(oldPath, entry.path);
      if (followRename(this.settings, oldPath, entry.path, entry instanceof TFolder)) this.saveData(this.settings);
      if (entry instanceof TFolder) this.files.followFolderRename(entry, oldPath);
      changed();
      workspace.trigger('design-redux:renamed', entry, oldPath);
    }));
    this.registerEvent(vault.on('modify', (entry) => {
      if (entry instanceof TFile) workspace.trigger('design-redux:modified', entry);
    }));
    this.registerEvent(metadataCache.on('resolved', () => {
      this.index.forget(true);
      workspace.trigger('design-redux:links');
    }));
    this.registerEvent(metadataCache.on('changed', (file) => workspace.trigger('design-redux:props', file)));
  }

  /** Reads data.json. The old plugin's is converted once, and kept whole beside it as data.legacy.json. */
  async loadSettings() {
    const saved = await this.loadData();
    const { settings, legacy } = migrateSettings(saved);
    this.settings = settings;
    if (!legacy) return;
    const adapter = this.app.vault.adapter;
    const file = `${this.manifest.dir}/data.legacy.json`;
    try {
      if (!(await adapter.exists(file))) await adapter.write(file, JSON.stringify(legacy, null, 2));
    } catch (err) {
      // Without the copy the old file is left as it is: better the old settings than none.
      console.error('Design Redux: could not keep a copy of the old settings; they are left untouched', err);
      this.legacyKept = false;
      return;
    }
    this.legacyKept = true;
    await this.saveData(this.settings);
  }

  /** Saves the settings and brings every feature to what they now say. */
  async saveSettings() {
    await this.saveData(this.settings);
    this.index.forget();
    this.features.forEach((f) => f.turn());
    this.app.workspace.trigger('design-redux:settings');
  }
}
