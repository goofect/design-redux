/* ------------------------------------------------------------------ */
/* Mind maps                                                           */
/*                                                                    */
/* The mind-map view, its file kinds and its commands: a note flagged  */
/* mindmap: true, or a .mindmap file, opens as a map; "Open as text"    */
/* and "Open as mind map" go between the two; "New mind map" makes one. */
/* ------------------------------------------------------------------ */

import { Notice, TFile, TFolder } from 'obsidian';
import { MINDMAP_HANDLERS, setMindMapContext } from '../core/078-actions.js';
import { Feature } from '../core/080-feature.js';
import { ChoicePicker } from '../ui/230-pickers.js';
import { nodeById, treeModel } from '../tree/400-tree-model.js';
import { writeOutline } from '../tree/401-tree-outline.js';
import { writeMindmapJson } from '../tree/402-tree-json.js';
import { BRANCH_LAYOUTS } from '../tree/403-tree-layouts.js';
import { addChild, addParent, addSibling, duplicateBranch, indentNode, outdentNode, removeNode, reorderNode } from '../tree/404-tree-ops.js';
import { branchLayoutOf, clearNudges, lineUpChildren, savedViews, setBranchLayout, setMapLayout } from '../tree/406-tree-layout-block.js';
import { MINDMAP_EXTENSION, MINDMAP_VIEW, MindMapView } from './421-mindmap-view.js';
import { isMindMapNote, keepAsText, showFileAs, takeOverLeaves } from './422-mindmap-takeover.js';
import { nodeLabel } from './423-mindmap-scene.js';

/* The kinds of file a new map can be. */
export const MINDMAP_FORMATS = [
  { id: 'md', label: 'A note', desc: 'Indexed, searched and linked like any note: its nodes are a list' },
  { id: 'mindmap', label: 'A .mindmap file', desc: 'For diagrams and large maps that shouldn’t show among notes' },
];

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
      { key: 'mindmapGlide', showIf: 'mindmaps', name: 'Nodes glide to their places', desc: 'As the map changes. Never when your system asks for less motion.' },
      { key: 'mindmapLegend', showIf: 'mindmaps', name: 'Legend', desc: 'A corner list naming what each colour means on the map. Pick a colour to fade the rest.' },
      { key: 'mindmapDepth', showIf: 'mindmaps', name: 'Show how deep a node is', desc: 'The root larger, the nodes a step from it heavier.' },
      {
        key: 'mindmapColourBy',
        type: 'dropdown',
        showIf: 'mindmaps',
        name: 'Tint nodes with no colour',
        options: { '': 'No tint', branch: 'By the branch they’re in', depth: 'By how deep they are' },
      },
      { key: 'mindmapPins', showIf: 'mindmaps', name: 'Pin nodes in place', desc: 'Keep in place pins the selected node where it is; the layout leaves it, and what hangs from it, there.' },
      { key: 'mindmapViews', showIf: 'mindmaps', name: 'Saved views and Back', desc: 'Keep a view of a map by name, go back to it, and step back after each jump.' },
      { key: 'mindmapPeek', showIf: 'mindmaps', name: 'Peek into a folded branch', desc: 'Pointing at its count, or Shift-Space, lists what it holds; picking one opens the way to it.' },
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
      { id: 'mindmap-edit-node', name: 'Mind map: edit the selected node', icon: 'pencil', on: 'mindmap', menu: false, when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.edit(ctx.node.id) },
      { id: 'mindmap-delete-node', name: 'Mind map: delete the selected node and its branch', icon: 'trash', on: 'mindmap', menu: false, when: (ctx) => !!ctx.node && ctx.node !== ctx.model.root, run: (ctx) => ctx.view.apply(removeNode(ctx.model, ctx.node.id)) },
      { id: 'mindmap-indent-node', name: 'Mind map: move the node under the one before it', icon: 'indent', on: 'mindmap', menu: false, when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.apply(indentNode(ctx.model, ctx.node.id)) },
      { id: 'mindmap-outdent-node', name: 'Mind map: move the node out a level', icon: 'outdent', on: 'mindmap', menu: false, when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.apply(outdentNode(ctx.model, ctx.node.id)) },
      { id: 'mindmap-move-node-up', name: 'Mind map: move the node up', icon: 'arrow-up', on: 'mindmap', menu: false, when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.apply(reorderNode(ctx.model, ctx.node.id, -1)) },
      { id: 'mindmap-move-node-down', name: 'Mind map: move the node down', icon: 'arrow-down', on: 'mindmap', menu: false, when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.apply(reorderNode(ctx.model, ctx.node.id, 1)) },
      { id: 'mindmap-colour-node', name: 'Mind map: colour the selected node…', icon: 'palette', on: 'mindmap', menu: false, when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.chooseColour(ctx.node.id) },
      { id: 'mindmap-save-view', name: 'Mind map: keep this view…', icon: 'bookmark-plus', on: 'mindmap', menu: false, when: (ctx) => !!this.settings.mindmapViews && !!ctx.view.camera, run: (ctx) => ctx.view.saveView() },
      { id: 'mindmap-go-to-view', name: 'Mind map: go to a kept view…', icon: 'bookmark', on: 'mindmap', menu: false, when: (ctx) => !!this.settings.mindmapViews && Object.keys(savedViews(ctx.model)).length > 0, run: (ctx) => ctx.view.chooseView(false) },
      { id: 'mindmap-forget-view', name: 'Mind map: forget a kept view…', icon: 'bookmark-x', on: 'mindmap', menu: false, when: (ctx) => !!this.settings.mindmapViews && Object.keys(savedViews(ctx.model)).length > 0, run: (ctx) => ctx.view.chooseView(true) },
      { id: 'mindmap-undo', name: 'Mind map: undo', icon: 'undo-2', on: 'mindmap', menu: false, when: (ctx) => ctx.view.undo.canUndo, run: (ctx) => ctx.view.undoStep(false) },
      { id: 'mindmap-redo', name: 'Mind map: redo', icon: 'redo-2', on: 'mindmap', menu: false, when: (ctx) => ctx.view.undo.canRedo, run: (ctx) => ctx.view.undoStep(true) },
      { id: 'open-note-as-mind-map', name: 'Open as mind map', icon: 'network', on: 'note', menu: false, when: (ctx) => this.enabled && isMindMapNote(this.app, ctx.file), run: () => this.openAsMap(this.app.workspace.activeLeaf) },
    ];
  }

  register() {
    const ws = this.app.workspace;
    // The mind map in use, for its own actions and for canvas actions that act on it too.
    setMindMapContext(() => {
      const leaf = this.enabled ? this.app.workspace.activeLeaf : null;
      const view = leaf && leaf.view instanceof MindMapView ? leaf.view : null;
      if (!view || !view.model || view.failure) return null;
      return { view, file: view.file, model: view.model, node: view.selected ? nodeById(view.model, view.selected) : null, from: 'palette' };
    });
    this.plugin.register(() => setMindMapContext(null));
    registerMindMapHandlers();
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
    new ChoicePicker(this.app, 'Make the new mind map as…', MINDMAP_FORMATS.map((f) => Object.assign({ note: f.desc }, f)), async (chosen) => {
      this.settings.mindmapDefaultFormat = chosen.id;
      await this.plugin.saveSettings();
      this.create(chosen.id);
    }).open();
    return null;
  }

  /** How a branch grows — or, from the root or with nothing picked, the whole map — asked. */
  chooseLayout(view, whole) {
    const model = view.model;
    if (!model || !model.root) return;
    const node = !whole && view.selected ? nodeById(model, view.selected) : null;
    const branch = node && node !== model.root && !model.free.includes(node) ? node : null;
    const items = BRANCH_LAYOUTS.map(([mode, label]) => ({ label, mode }));
    if (branch && branchLayoutOf(model, branch.id)) items.unshift({ label: 'As the branch above', mode: null });
    const ask = branch ? `Lay out “${nodeLabel(branch)}” and what's under it…` : 'Lay out the whole map…';
    new ChoicePicker(this.app, ask, items, (item) => {
      view.apply(branch ? setBranchLayout(model, branch.id, item.mode) : setMapLayout(model, item.mode));
    }).open();
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

/** What the canvas's commands do on a mind map: the same ids, so their hotkeys work on either. */
export function registerMindMapHandlers() {
  const node = (ctx) => ctx.node || ctx.model.root;
  const addThen = (make) => (ctx) => {
    const p = ctx.view.apply(make(ctx));
    if (p && p.selection[0]) ctx.view.edit(p.selection[0]);
  };
  const handlers = {
    'canvas-quick-add': { run: addThen((ctx) => addChild(ctx.model, node(ctx).id, '')) },
    'canvas-add-child-card': { run: addThen((ctx) => addChild(ctx.model, node(ctx).id, '')) },
    'canvas-add-sibling-card': { when: (ctx) => !!ctx.node, run: addThen((ctx) => addSibling(ctx.model, ctx.node.id, '')) },
    'canvas-add-parent-card': { when: (ctx) => !!ctx.node && ctx.node !== ctx.model.root, run: addThen((ctx) => addParent(ctx.model, ctx.node.id, '')) },
    'fold-canvas-branch': { when: (ctx) => !!ctx.node && ctx.node.children.length > 0, run: (ctx) => ctx.view.toggleFold(ctx.node.id) },
    'fold-every-canvas-branch': { run: (ctx) => ctx.view.foldAll(true) },
    'unfold-canvas-everything': { run: (ctx) => ctx.view.foldAll(false) },
    'duplicate-canvas-branch': { when: (ctx) => !!ctx.node && ctx.node !== ctx.model.root, run: (ctx) => ctx.view.apply(duplicateBranch(ctx.model, ctx.node.id)) },
    'canvas-zoom-to-branch': { when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.fitBranch(ctx.node.id) },
    'fit-canvas-cards': { run: (ctx) => ctx.view.fit() },
    'canvas-layout-choose': { when: (ctx) => !!ctx.view.feature && typeof ctx.view.feature.chooseLayout === 'function', run: (ctx) => ctx.view.feature.chooseLayout(ctx.view) },
    'canvas-layout-everything': { when: (ctx) => !!ctx.view.feature && typeof ctx.view.feature.chooseLayout === 'function', run: (ctx) => ctx.view.feature.chooseLayout(ctx.view, true) },
    'toggle-canvas-legend': { run: (ctx) => ctx.view.toggleLegend() },
    'canvas-toggle-keep-in-place': { when: (ctx) => !!ctx.node && ctx.node !== ctx.model.root && ctx.view.plugin && ctx.view.plugin.settings.mindmapPins !== false, run: (ctx) => ctx.view.togglePin(ctx.node.id) },
    'canvas-view-back': { when: (ctx) => !!(ctx.view.looks && ctx.view.looks.length), run: (ctx) => ctx.view.lookBack() },
    'canvas-map-tidy': { when: (ctx) => !!(ctx.model.layout && ctx.model.layout.nudge), run: (ctx) => ctx.view.apply(clearNudges(ctx.model)) },
    'tidy-canvas-branch': { when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.apply(clearNudges(ctx.model, ctx.node.id)) },
  };
  // Arrange and align, on a map, are the layout's: a row or a column is a branch's layout; lining up puts its children back in line.
  const withKids = (ctx) => !!ctx.node && ctx.node.children.length > 0;
  handlers['arrange-canvas-row'] = { when: withKids, run: (ctx) => ctx.view.apply(setBranchLayout(ctx.model, ctx.node.id, 'bottom')) };
  handlers['arrange-canvas-column'] = { when: withKids, run: (ctx) => ctx.view.apply(setBranchLayout(ctx.model, ctx.node.id, 'right')) };
  ['left', 'center', 'right', 'top', 'middle', 'bottom', 'space-across', 'space-down'].forEach((a) => {
    handlers[`arrange-canvas-${a}`] = { when: withKids, run: (ctx) => ctx.view.apply(lineUpChildren(ctx.model, ctx.node.id)) };
  });
  handlers['canvas-spread-overlaps'] = { when: (ctx) => !!(ctx.model.layout && ctx.model.layout.nudge), run: (ctx) => ctx.view.apply(clearNudges(ctx.model)) };
  // Moving a node about the tree, under the canvas's names for it.
  const notRoot = (ctx) => !!ctx.node && ctx.node !== ctx.model.root;
  handlers['canvas-promote-card'] = { when: notRoot, run: (ctx) => ctx.view.apply(outdentNode(ctx.model, ctx.node.id)) };
  handlers['canvas-demote-card'] = { when: notRoot, run: (ctx) => ctx.view.apply(indentNode(ctx.model, ctx.node.id)) };
  handlers['canvas-card-earlier'] = { when: notRoot, run: (ctx) => ctx.view.apply(reorderNode(ctx.model, ctx.node.id, -1)) };
  handlers['canvas-card-later'] = { when: notRoot, run: (ctx) => ctx.view.apply(reorderNode(ctx.model, ctx.node.id, 1)) };
  Object.keys(handlers).forEach((id) => MINDMAP_HANDLERS.set(id, handlers[id]));
}
