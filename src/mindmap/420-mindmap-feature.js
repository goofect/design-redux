/* ------------------------------------------------------------------ */
/* Mind maps                                                           */
/*                                                                    */
/* The mind-map view, its file kinds and its commands: a note flagged  */
/* mindmap: true, or a .mindmap file, opens as a map; "Open as text"    */
/* and "Open as mind map" go between the two; "New mind map" makes one. */
/* ------------------------------------------------------------------ */

import { FuzzySuggestModal, Notice, TFile, TFolder } from 'obsidian';
import { Feature } from '../core/080-feature.js';
import { treeModel } from '../tree/400-tree-model.js';
import { writeOutline } from '../tree/401-tree-outline.js';
import { writeMindmapJson } from '../tree/402-tree-json.js';
import { BRANCH_LAYOUTS } from '../tree/403-tree-layouts.js';
import { MINDMAP_EXTENSION, MINDMAP_VIEW, MindMapView } from './421-mindmap-view.js';
import { isMindMapNote, keepAsText, showFileAs, takeOverLeaves } from './422-mindmap-takeover.js';

/* The kinds of file a new map can be. */
export const MINDMAP_FORMATS = [
  { id: 'md', label: 'A note', desc: 'Indexed, searched and linked like any note: its nodes are a list' },
  { id: 'mindmap', label: 'A .mindmap file', desc: 'For diagrams and large maps that shouldn’t show among notes' },
];

export class FormatPicker extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Make the new mind map as…');
  }

  getItems() {
    return MINDMAP_FORMATS;
  }

  getItemText(f) {
    return `${f.label} — ${f.desc}`;
  }

  onChooseItem(f) {
    this.onChoose(f.id);
  }
}

export class MindMaps extends Feature {
  settingsSchema() {
    return [
      {
        key: 'mindmaps',
        name: 'Mind maps',
        desc: 'A note whose properties say mindmap: true — or a .mindmap file — opens as a mind map: its list is the tree. "Open as text" shows the list.',
      },
      {
        key: 'mindmapTakeover',
        showIf: 'mindmaps',
        name: 'Open mind-map notes as maps',
        desc: 'Off, they open as text, and "Open as mind map" opens one as a map.',
      },
      {
        key: 'mindmapDefaultFormat',
        type: 'dropdown',
        showIf: 'mindmaps',
        name: 'A new mind map is',
        options: { '': 'Ask the first time', md: 'A note', mindmap: 'A .mindmap file' },
      },
      {
        key: 'mindmapLayout',
        type: 'dropdown',
        showIf: 'mindmaps',
        name: 'How a mind map is laid out',
        desc: 'Unless the map says otherwise, in its mindmap-layout property.',
        options: Object.fromEntries(BRANCH_LAYOUTS.filter(([m]) => m !== 'concept').map(([mode, title]) => [mode, title])),
      },
    ];
  }

  registerTypes() {
    this.plugin.registerView(MINDMAP_VIEW, (leaf) => new MindMapView(leaf, this));
    try {
      this.plugin.registerExtensions([MINDMAP_EXTENSION], MINDMAP_VIEW);
    } catch (err) {
      // Another plugin has .mindmap: the notes still work.
      console.warn('Design Redux: .mindmap files are opened by another plugin', err);
    }
  }

  actions() {
    const mapView = () => {
      const leaf = this.app.workspace.activeLeaf;
      return leaf && leaf.view instanceof MindMapView ? leaf : null;
    };
    return [
      { id: 'new-mind-map', name: 'New mind map', icon: 'network', menu: false, when: () => this.enabled, run: () => this.newMap() },
      { id: 'make-note-mind-map', name: 'Make this note a mind map', icon: 'network', on: 'note', menu: false, when: (ctx) => this.enabled && ctx.file.extension === 'md' && !isMindMapNote(this.app, ctx.file), run: (ctx) => this.makeMap(ctx.file) },
      { id: 'open-mind-map-as-text', name: 'Open as text', icon: 'file-text', menu: false, when: () => this.enabled && !!mapView() && mapView().view.file.extension === 'md', run: () => this.openAsText(mapView()) },
      { id: 'open-note-as-mind-map', name: 'Open as mind map', icon: 'network', on: 'note', menu: false, when: (ctx) => this.enabled && isMindMapNote(this.app, ctx.file), run: () => this.openAsMap(this.app.workspace.activeLeaf) },
    ];
  }

  register() {
    const ws = this.app.workspace;
    const take = () => this.takeOver();
    ['file-open', 'active-leaf-change', 'layout-change'].forEach((type) => this.plugin.registerEvent(ws.on(type, take)));
    // Flagged just now — "Make this note a mind map", or typed into its properties.
    this.plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (isMindMapNote(this.app, file)) take();
      })
    );
  }

  get takesOver() {
    return this.enabled && this.settings.mindmapTakeover !== false;
  }

  enable() {
    if (this.app.workspace.layoutReady !== false) this.takeOver();
  }

  disable() {
    // Switched off: maps of notes back to text. Not when the plugin's only unloading.
    if (this.plugin.unloading) return;
    this.app.workspace.getLeavesOfType(MINDMAP_VIEW).forEach((leaf) => {
      const file = leaf.view && leaf.view.file;
      if (file && file.extension === 'md') showFileAs(this.app, leaf, 'markdown', file);
    });
  }

  takeOver() {
    if (this.takesOver) takeOverLeaves(this.app);
  }

  /** The map in this tab shown as its list, and kept so for the note. */
  openAsText(leaf) {
    const file = leaf && leaf.view && leaf.view.file;
    if (!file) return null;
    keepAsText(leaf, file.path, true);
    return showFileAs(this.app, leaf, 'markdown', file, { mode: 'source' });
  }

  /** The note in this tab shown as a map. */
  openAsMap(leaf) {
    const file = leaf && leaf.view && leaf.view.file;
    if (!file) return null;
    keepAsText(leaf, file.path, false);
    return showFileAs(this.app, leaf, MINDMAP_VIEW, file);
  }

  /** A note flagged as a mind map — its list kept as it is — and opened as one. */
  async makeMap(file) {
    const done = await this.plugin.notes.write(file, (fm) => (fm.mindmap = true));
    if (!done) return;
    const leaf = this.app.workspace.activeLeaf;
    if (leaf && leaf.view && leaf.view.file === file) await this.openAsMap(leaf);
  }

  /** A new map, as the setting says it's made — or asked, the first time. */
  newMap() {
    const kind = this.settings.mindmapDefaultFormat;
    if (kind === 'md' || kind === 'mindmap') return this.create(kind);
    new FormatPicker(this.app, async (chosen) => {
      this.settings.mindmapDefaultFormat = chosen;
      await this.plugin.saveSettings();
      this.create(chosen);
    }).open();
    return null;
  }

  async create(kind) {
    const active = this.app.workspace.getActiveFile();
    const folder = active && active.parent instanceof TFolder ? active.parent : this.app.vault.getRoot();
    const model = treeModel('Mind map');
    const text = kind === 'mindmap' ? writeMindmapJson(model) : writeOutline(model);
    const path = this.plugin.freeChildPath(folder, 'Mind map', kind === 'mindmap' ? MINDMAP_EXTENSION : 'md');
    let file = null;
    try {
      file = await this.app.vault.create(path, text);
    } catch (err) {
      console.error('Design Redux: could not make the mind map', err);
      new Notice('Could not make the mind map.');
      return null;
    }
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf && file instanceof TFile) await showFileAs(this.app, leaf, MINDMAP_VIEW, file);
    return file;
  }
}

MindMaps.settingKey = 'mindmaps';
