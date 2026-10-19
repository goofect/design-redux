/* ------------------------------------------------------------------ */
/* Mind maps                                                           */
/*                                                                    */
/* The mind-map view, its file kinds and its commands: a note flagged  */
/* mindmap: true, or a .mindmap file, opens as a map; "Open as text"    */
/* and "Open as mind map" go between the two; "New mind map" makes one. */
/* ------------------------------------------------------------------ */

import { Notice, TFile, TFolder } from 'obsidian';
import { actionsOn, addActionEntries, MINDMAP_HANDLERS, setMindMapContext } from '../core/078-actions.js';
import { Feature } from '../core/080-feature.js';
import { ChoicePicker } from '../ui/230-pickers.js';
import { nodeById, treeModel, walk } from '../tree/400-tree-model.js';
import { writeOutline } from '../tree/401-tree-outline.js';
import { parseMindmapJson, writeMindmapJson } from '../tree/402-tree-json.js';
import { BRANCH_LAYOUTS } from '../tree/403-tree-layouts.js';
import { addChild, addParent, addSibling, duplicateBranch, indentNode, outdentNode, removeNode, reorderNode } from '../tree/404-tree-ops.js';
import { albumEntry, branchLayoutOf, clearNudges, lineUpChildren, savedViews, setBranchLayout, setMapLayout } from '../tree/406-tree-layout-block.js';
import { NODE_ROLES, nodeRole, relationsOf, setRelationMeaning } from '../tree/407-tree-relations.js';
import { relinkText } from '../tree/408-tree-notes.js';
import { taskOf } from '../tree/415-tree-tasks.js';
import { MINDMAP_EXTENSION, MINDMAP_VIEW, MindMapView } from './421-mindmap-view.js';
import { isMindMapNote, keepAsText, showFileAs, takeOverLeaves } from './422-mindmap-takeover.js';
import { nodeLabel } from './423-mindmap-scene.js';
import { MAP_SNAPSHOTS } from './435-mindmap-check.js';
import { VIEW_CHOICES } from './451-mindmap-views.js';

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
      { key: 'mindmapRelations', showIf: 'mindmaps', name: 'Relations', desc: 'Relate any two nodes — by command, or dragging one onto the other with Alt held — and say what it means: a kind of relationship, or your own words.' },
      { key: 'mindmapArguments', showIf: 'mindmaps', name: 'Arguments', desc: 'A node can be a claim, a reason, an objection, a rebuttal or evidence, shown above it; a claim counts what’s for and against it.' },
      { key: 'mindmapBranchNotes', showIf: 'mindmaps', name: 'Branches and notes', desc: 'A branch can be made into a note beside the map, its node a link to it; a node linking to a note can take the note’s headings as nodes.' },
      { key: 'mindmapCheck', showIf: 'mindmaps', name: 'Check a map', desc: 'Lists what may be wrong: nodes there twice, empty ones, links to notes that are gone, relations round in a circle.' },
      { key: 'mindmapCompare', showIf: 'mindmaps', name: 'Compare maps', desc: 'Keep a snapshot of a map and compare with it later, or with another map, or one branch with another.' },
      { key: 'mindmapVaultMap', showIf: 'mindmaps', name: 'Map a folder or tag', desc: 'A folder’s menu, or a command, makes a mind map of its notes: folders or narrower tags as branches, links between notes as relations.' },
      { key: 'mindmapMinimap', showIf: 'mindmaps', name: 'Minimap', desc: 'The whole map small in the corner while it doesn’t all fit, the part on screen outlined. Press it to go there.' },
      { key: 'mindmapPresent', showIf: 'mindmaps', name: 'Present a map', desc: 'Step through a map like a talk: one node at a time, the rest faded back, a trail at the foot. Arrow keys or Space to move, R to reveal nodes as you reach them, O for the whole map, Escape to leave. Nothing is changed.' },
      { key: 'mindmapAlbumMap', showIf: 'mindmaps', name: 'A collection’s map by parent', desc: 'A collection’s menu makes a mind map laid out by its notes’ parent property; while it’s open it follows the notes, and moving a note’s node can set its parent.' },
      { key: 'mindmapConvert', showIf: 'mindmaps', name: 'Convert maps', desc: 'Make a mind map of a canvas — its trees, folds, layouts and relations kept — of an OPML outline, a FreeMind map or a note’s headings; make a .mindmap file of a note’s map and back; export a map as a canvas, OPML, SVG, PNG or PDF.' },
      { key: 'mindmapTasks', showIf: 'mindmaps', name: 'Tasks', desc: 'A node can be a task, written - [ ] in the note: a box to tick, a due date typed as “tomorrow” or “+2w”, a status. A node with tasks below it shows how many are done; Show open tasks only dims the rest.' },
      { key: 'mindmapOtherViews', showIf: 'mindmaps', name: 'Show a map another way', desc: 'Show as… in the map’s bar: an outline to type into, a board by status or by tag with cards to drag between columns, a timeline of what’s due, or a table of the nodes and their attributes. Each changes the map itself.' },
      { key: 'mindmapLinkedCards', showIf: 'mindmaps', name: 'What a linked note says', desc: 'A node that’s just a link to a note shows the note’s status, due date and description or opening line, as the note has them now.' },
      { key: 'mindmapNodePanel', showIf: 'mindmaps', name: 'The node in the note panel', desc: 'The map’s bar opens the note panel, with a section for the node picked: its text and attributes, what points to it, and Make a note from this node.' },
      { key: 'mindmapFilters', showIf: 'mindmaps', name: 'Filter, levels, one branch alone', desc: 'Filter in the map’s bar dims all but the nodes with some words, a tag, a status, a colour or down to a depth. Show levels shows so many levels; a branch can be shown alone, the nodes above it at the top to step back.' },
      { key: 'mindmapEmbeds', showIf: 'mindmaps', name: 'Maps in notes', desc: 'A mindmap code block — a list in it — is drawn as a map. ![[Map]] of a map note draws it in reading view; of a .mindmap file, in either view. Read-only; a click opens the map.' },
      { key: 'mindmapTemplateFolder', type: 'text', showIf: 'mindmaps', name: 'Folder of map templates', desc: 'Maps in this folder are offered by New mind map from template, beside the meeting, project, argument and study maps built in. {{title}} and {{date}} in a template are filled in.', placeholder: 'Templates/Maps' },
      { key: 'mindmapKeepCanvasMaps', name: 'Keep making canvas maps', desc: 'Offer a canvas map beside the mind map when making a map of a folder, a tag, a collection by parent, or a note’s relationships. Off, new maps are mind maps; the canvases you have open and work as before, and Make a mind map of this canvas converts one.' },
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
    const rel = () => this.settings.mindmapRelations !== false;
    const tasks = () => this.settings.mindmapTasks !== false;
    const mapView = () => {
      const leaf = this.app.workspace.activeLeaf;
      return leaf && leaf.view instanceof MindMapView ? leaf : null;
    };
    return [
      { id: 'new-mind-map-from-template', name: 'New mind map from template…', icon: 'layout-template', menu: false, when: () => this.enabled, run: () => this.newFromTemplate() },
      { id: 'mindmap-save-as-template', name: 'Mind map: save this map as a template', icon: 'copy-plus', on: 'mindmap', menu: false, when: (ctx) => !!this.templateFolder() && !!ctx.file, run: (ctx) => this.saveAsTemplate(ctx.view) },
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
      { id: 'mindmap-relate-node', name: 'Mind map: relate the selected node to another…', icon: 'waypoints', on: 'mindmap', menu: false, when: (ctx) => rel(ctx) && !!ctx.node, run: (ctx) => ctx.view.relateFrom(ctx.node.id) },
      { id: 'mindmap-remove-relation', name: 'Mind map: remove a relation of the selected node…', icon: 'unlink', on: 'mindmap', menu: false, when: (ctx) => rel(ctx) && !!ctx.node && relationsOf(ctx.model, ctx.node.id).length > 0, run: (ctx) => ctx.view.pickRelation(ctx.node.id, (i) => ctx.view.removeRelationAt(i)) },
      { id: 'mindmap-find-statement', name: 'Mind map: find a statement…', icon: 'search', on: 'mindmap', menu: false, when: (ctx) => rel(ctx) && ctx.view.statements().length > 0, run: (ctx) => ctx.view.findStatement() },
      { id: 'mindmap-statements-note', name: 'Mind map: write what the map states as a note', icon: 'file-text', on: 'mindmap', menu: false, when: (ctx) => rel(ctx) && ctx.view.statements().length > 0, run: (ctx) => ctx.view.statementsNote() },
      { id: 'mindmap-branch-to-note', name: 'Mind map: make a note from the selected node’s branch', icon: 'file-output', on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapBranchNotes !== false && !!ctx.node && ctx.node !== ctx.model.root && ctx.node.children.length > 0, run: (ctx) => ctx.view.branchToNote(ctx.node.id) },
      { id: 'mindmap-note-to-branch', name: 'Mind map: make nodes from the linked note’s headings', icon: 'file-input', on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapBranchNotes !== false && !!ctx.view.linkedNote(ctx.node), run: (ctx) => ctx.view.noteToBranch(ctx.node.id) },
      { id: 'mindmap-map-folder', name: 'Make a mind map of this folder', menu: 'Make a mind map', icon: 'network', on: 'album', when: () => this.enabled && this.settings.mindmapVaultMap !== false, run: (ctx) => this.mapFolderAsMindMap(ctx.folder) },
      { id: 'mindmap-map-tag', name: 'Make a mind map of a tag…', menu: false, icon: 'tags', on: 'app', when: () => this.enabled && this.settings.mindmapVaultMap !== false, run: () => this.chooseTagToMap() },
      { id: 'mindmap-map-album', name: 'Make a mind map of this collection by its notes’ parents', menu: 'Mind map by parent', icon: 'network', on: 'album', when: (ctx) => this.enabled && this.settings.mindmapAlbumMap !== false && !!ctx.folder && !(ctx.folder.isRoot && ctx.folder.isRoot()), run: (ctx) => this.mapAlbumAsMindMap(ctx.folder) },
      { id: 'mindmap-convert-canvas', name: 'Make a mind map of this canvas', menu: 'Make a mind map', icon: 'network', on: 'file', when: (ctx) => this.enabled && this.settings.mindmapConvert !== false && !!ctx.file && ctx.file.extension === 'canvas', run: (ctx) => this.convertCanvas(ctx.file) },
      { id: 'mindmap-convert-to-mindmap-file', name: 'Mind map: make a .mindmap file of this map', icon: 'file-json', on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapConvert !== false && !!ctx.file && ctx.file.extension === 'md', run: (ctx) => this.convertMapFormat(ctx.view, MINDMAP_EXTENSION) },
      { id: 'mindmap-convert-to-note', name: 'Mind map: make a note of this map', icon: 'file-text', on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapConvert !== false && !!ctx.file && ctx.file.extension === MINDMAP_EXTENSION, run: (ctx) => this.convertMapFormat(ctx.view, 'md') },
      { id: 'mindmap-import-file', name: 'Make a mind map of an OPML or FreeMind file…', icon: 'file-input', menu: false, when: () => this.enabled && this.settings.mindmapConvert !== false, run: () => this.chooseImport() },
      { id: 'mindmap-import-this', name: 'Make a mind map of this outline', menu: 'Make a mind map', icon: 'network', on: 'file', when: (ctx) => this.enabled && this.settings.mindmapConvert !== false && !!ctx.file && (ctx.file.extension === 'opml' || ctx.file.extension === 'mm'), run: (ctx) => this.importFile(ctx.file) },
      { id: 'mindmap-from-headings', name: 'Make a mind map of this note’s headings', menu: 'Make a mind map of its headings', icon: 'network', on: 'note', when: (ctx) => this.enabled && this.settings.mindmapConvert !== false && !!ctx.file && ctx.file.extension === 'md' && !isMindMapNote(this.app, ctx.file), run: (ctx) => this.mapHeadings(ctx.file) },
      ...[['opml', 'OPML', 'list-tree'], ['svg', 'SVG', 'image'], ['png', 'PNG', 'image'], ['pdf', 'PDF', 'file-text']].map(([kind, label, icon]) => ({ id: `mindmap-export-${kind}`, name: `Mind map: export as ${label}`, icon, on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapConvert !== false && !!ctx.file, run: (ctx) => this.exportAs(ctx.view, kind) })),
      { id: 'mindmap-export-canvas', name: 'Mind map: export as a canvas', icon: 'layout-dashboard', on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapConvert !== false && !!ctx.file, run: (ctx) => this.exportCanvas(ctx.view) },
      { id: 'mindmap-toggle-task', name: 'Mind map: make the node a task, or tick it', icon: 'square-check', on: 'mindmap', menu: false, when: (ctx) => tasks() && !!ctx.node && !ctx.node.virtual, run: (ctx) => ctx.view.toggleTaskAt(ctx.node.id) },
      { id: 'mindmap-untask', name: 'Mind map: make the task a plain node', icon: 'square', on: 'mindmap', menu: false, when: (ctx) => tasks() && !!ctx.node && !!taskOf(ctx.node), run: (ctx) => ctx.view.untaskAt(ctx.node.id) },
      { id: 'mindmap-set-due', name: 'Mind map: set the node’s due date…', icon: 'calendar', on: 'mindmap', menu: false, when: (ctx) => tasks() && !!ctx.node && !ctx.node.virtual, run: (ctx) => ctx.view.chooseDue(ctx.node.id) },
      { id: 'mindmap-set-status', name: 'Mind map: set the node’s status…', icon: 'circle-dot', on: 'mindmap', menu: false, when: (ctx) => tasks() && !!ctx.node && !ctx.node.virtual, run: (ctx) => ctx.view.chooseStatus(ctx.node.id) },
      { id: 'mindmap-open-tasks', name: 'Mind map: show open tasks only, or everything', icon: 'list-checks', on: 'mindmap', menu: false, when: () => tasks(), run: (ctx) => ctx.view.toggleOpenTasks() },
      ...VIEW_CHOICES.map(([view, label, icon]) => ({ id: `mindmap-show-as-${view || 'map'}`, name: `Mind map: show as ${label.toLowerCase()}`, icon, on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapOtherViews !== false && ctx.view.shownAs() !== view, run: (ctx) => ctx.view.showAs(view) })),
      { id: 'mindmap-filter', name: 'Mind map: filter the nodes…', icon: 'filter', on: 'mindmap', menu: false, when: () => this.settings.mindmapFilters !== false, run: (ctx) => (ctx.view.filterEl ? ctx.view.filterEl.querySelector('input').focus() : ctx.view.toggleFilterBar()) },
      { id: 'mindmap-clear-filter', name: 'Mind map: clear the filter, levels and branch shown alone', icon: 'filter-x', on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapFilters !== false && !!(ctx.view.filterEl || ctx.view.levels || ctx.view.soloId), run: (ctx) => ctx.view.clearFilters() },
      { id: 'mindmap-show-levels', name: 'Mind map: show so many levels…', icon: 'list-tree', on: 'mindmap', menu: false, when: () => this.settings.mindmapFilters !== false, run: (ctx) => ctx.view.chooseLevels() },
      { id: 'mindmap-solo-branch', name: 'Mind map: show the selected branch alone, or the whole map', icon: 'focus', on: 'mindmap', menu: false, when: (ctx) => this.settings.mindmapFilters !== false && (!!ctx.view.soloId || (!!ctx.node && ctx.node !== ctx.model.root && !ctx.node.virtual)), run: (ctx) => ctx.view.toggleSolo(ctx.view.soloId && (!ctx.node || ctx.node.id === ctx.view.soloId) ? ctx.view.soloId : ctx.node.id) },
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
    if (typeof this.registerEmbeds === 'function') this.registerEmbeds();
    // A folder's menu: a mind map of it.
    this.plugin.registerEvent(
      ws.on('file-menu', (menu, target) => {
        if (target instanceof TFolder && this.enabled) addActionEntries(menu, actionsOn(this.actions(), 'album'), { folder: target, from: 'menu' }, 'action');
        if (target instanceof TFile && ['canvas', 'opml', 'mm'].includes(target.extension) && this.enabled) addActionEntries(menu, actionsOn(this.actions(), 'file'), { file: target, from: 'menu' }, 'action');
      })
    );
    // A collection's open maps follow its notes; a collection renamed, its maps follow it.
    const touch = (paths) => {
      if (!this.enabled || this.settings.mindmapAlbumMap === false || this.settings.albumMapAuto === false) return;
      this.albumMapsTouching(paths).forEach((view) => view.albumLater());
    };
    this.plugin.registerEvent(this.app.metadataCache.on('changed', (file) => touch([file.path])));
    ['create', 'delete', 'rename'].forEach((type) =>
      this.plugin.registerEvent(
        this.app.vault.on(type, (file, oldPath) => {
          if (type === 'rename' && file instanceof TFolder && this.enabled) this.followAlbumRename(file, oldPath);
          touch([file.path, oldPath]);
        })
      )
    );
    // A note renamed: links to it in .mindmap files follow, as Obsidian keeps them up in notes.
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.followRename(file, oldPath)));
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
    // Settings saved: open maps drawn as they now say.
    this.app.workspace.getLeavesOfType(MINDMAP_VIEW).forEach((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MindMapView) || !view.model) return;
      view.relayout(false);
      view.draw();
    });
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

  /** A tag picked from those in the vault, and mapped. */
  chooseTagToMap() {
    const cache = this.app.metadataCache;
    const counts = typeof cache.getTags === 'function' ? cache.getTags() : {};
    const items = Object.keys(counts)
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({ label: tag, note: String(counts[tag]), tag }));
    if (!items.length) {
      new Notice('There are no tags to map.');
      return;
    }
    new ChoicePicker(this.app, 'Make a mind map of a tag…', items, (item) => this.mapTagAsMindMap(item.tag)).open();
  }

  /** A map's kept snapshot, moved with it to its new path. */
  async moveSnapshot(from, to) {
    const dir = this.plugin.manifest && this.plugin.manifest.dir;
    const adapter = this.app.vault.adapter;
    const at = dir ? `${dir}/${MAP_SNAPSHOTS}` : null;
    if (!at || !adapter || !(await adapter.exists(at))) return;
    try {
      const all = JSON.parse(await adapter.read(at)) || {};
      if (!all[from]) return;
      all[to] = all[from];
      delete all[from];
      await adapter.write(at, JSON.stringify(all));
    } catch (err) {
      console.error('Design Redux: could not move the map’s snapshot', err);
    }
  }

  /** Whether a file is a mind map: a .mindmap file, or a note flagged as one. */
  isMap(file) {
    return file instanceof TFile && (file.extension === MINDMAP_EXTENSION || (file.extension === 'md' && isMindMapNote(this.app, file)));
  }

  /** Links in .mindmap files to a note renamed, pointed at its new name. */
  async followRename(file, oldPath) {
    if (!(file instanceof TFile) || !this.enabled) return;
    if (this.isMap(file)) await this.moveSnapshot(oldPath, file.path);
    if (file.extension !== 'md') return;
    const oldBase = oldPath.split('/').pop().replace(/\.md$/, '');
    const olds = [oldBase, oldPath.replace(/\.md$/, '')];
    const vault = this.app.vault;
    for (const map of vault.getFiles().filter((f) => f.extension === MINDMAP_EXTENSION)) {
      const text = await vault.read(map);
      if (!olds.some((o) => text.toLowerCase().includes(`[[${o.toLowerCase()}`))) continue;
      let model;
      try {
        model = parseMindmapJson(text);
      } catch (err) {
        continue;
      }
      const cache = this.app.metadataCache;
      const next = cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(file, map.path, true) : file.basename;
      let changed = false;
      walk(model, (n) => {
        const t = relinkText(n.text, olds, next);
        if (t !== n.text) {
          n.text = t;
          changed = true;
        }
      });
      if (changed) await vault.modify(map, writeMindmapJson(model));
    }
  }

  /** A new map, as the setting says it's made — or asked, the first time. */
  newMap(folder) {
    const kind = this.settings.mindmapDefaultFormat;
    if (kind === 'md' || kind === 'mindmap') return this.create(kind, folder);
    new ChoicePicker(this.app, 'Make the new mind map as…', MINDMAP_FORMATS.map((f) => Object.assign({ note: f.desc }, f)), async (chosen) => {
      this.settings.mindmapDefaultFormat = chosen.id;
      await this.plugin.saveSettings();
      this.create(chosen.id, folder);
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

  async create(kind, into) {
    const active = this.app.workspace.getActiveFile();
    const folder = into instanceof TFolder ? into : active && active.parent instanceof TFolder ? active.parent : this.app.vault.getRoot();
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
  // Relations and arguments, under the canvas's names for them.
  const related = (ctx) => !!ctx.node && relationsOf(ctx.model, ctx.node.id).length > 0 && ctx.view.plugin && ctx.view.plugin.settings.mindmapRelations !== false;
  handlers['canvas-name-relationship'] = { when: related, run: (ctx) => ctx.view.pickRelation(ctx.node.id, (i) => ctx.view.nameRelation(i)) };
  handlers['canvas-state-proposition'] = { when: related, run: (ctx) => ctx.view.pickRelation(ctx.node.id, (i) => ctx.view.stateProposition(i)) };
  handlers['canvas-reverse-relationship'] = { when: related, run: (ctx) => ctx.view.pickRelation(ctx.node.id, (i) => ctx.view.reverseRelationAt(i)) };
  handlers['canvas-relation-none'] = { when: related, run: (ctx) => ctx.view.pickRelation(ctx.node.id, (i) => ctx.view.apply(setRelationMeaning(ctx.model, i, null))) };
  const arguing = (ctx) => !!ctx.node && !ctx.node.virtual && ctx.view.plugin && ctx.view.plugin.settings.mindmapArguments !== false;
  Object.keys(NODE_ROLES).forEach((role) => {
    handlers[`canvas-make-${role}`] = { when: arguing, run: (ctx) => ctx.view.setRole(ctx.node.id, role) };
    if (role !== 'claim') handlers[`canvas-add-${role}`] = { when: arguing, run: (ctx) => ctx.view.answer(ctx.node.id, role) };
  });
  handlers['canvas-clear-part'] = { when: (ctx) => arguing(ctx) && !!nodeRole(ctx.node), run: (ctx) => ctx.view.setRole(ctx.node.id, null) };
  // Branches and notes.
  const notes = (ctx) => ctx.view.plugin && ctx.view.plugin.settings.mindmapBranchNotes !== false;
  handlers['canvas-branch-to-note'] = { when: (ctx) => notes(ctx) && !!ctx.node && ctx.node !== ctx.model.root && ctx.node.children.length > 0, run: (ctx) => ctx.view.branchToNote(ctx.node.id) };
  handlers['canvas-outline-to-branch'] = { when: (ctx) => notes(ctx) && !!ctx.view.linkedNote(ctx.node), run: (ctx) => ctx.view.noteToBranch(ctx.node.id) };
  // Looking a map over, and comparing.
  const on = (key) => (ctx) => ctx.view.plugin && ctx.view.plugin.settings[key] !== false;
  handlers['check-canvas'] = { when: on('mindmapCheck'), run: (ctx) => ctx.view.checkMap() };
  handlers['canvas-keep-snapshot'] = { when: (ctx) => on('mindmapCompare')(ctx) && !!ctx.view.file, run: (ctx) => ctx.view.keepSnapshot() };
  handlers['canvas-compare'] = { when: on('mindmapCompare'), run: (ctx) => ctx.view.chooseComparison() };
  handlers['canvas-compare-branches'] = { when: (ctx) => on('mindmapCompare')(ctx) && !!ctx.node && ctx.node.children.length > 0, run: (ctx) => ctx.view.chooseBranchComparison(ctx.node.id) };
  handlers['canvas-compare-done'] = { when: (ctx) => !!ctx.view.findingsEl, run: (ctx) => ctx.view.closeFindings() };
  // A collection's map.
  const album = (ctx) => !!ctx.view.albumFolder();
  handlers['refresh-album-map'] = { when: album, run: (ctx) => ctx.view.syncAlbum({ tell: true }) };
  handlers['add-left-out-note'] = { when: (ctx) => album(ctx) && albumEntry(ctx.model).leftOut.length > 0, run: (ctx) => ctx.view.putBackLeftOut() };
  // Finding and focusing, and the notes' own relationships.
  handlers['find-canvas-card'] = { run: (ctx) => ctx.view.findNode() };
  handlers['focus-canvas-branch'] = { when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.toggleFocus('branch', ctx.node.id) };
  handlers['focus-canvas-near'] = { when: (ctx) => !!ctx.node, run: (ctx) => ctx.view.toggleFocus('near', ctx.node.id) };
  handlers['knowledge-canvas-write'] = { when: (ctx) => !!ctx.view.knowledge(), run: (ctx) => ctx.view.writeRelationsToNotes() };
  handlers['knowledge-canvas-draw'] = { when: (ctx) => !!ctx.view.knowledge(), run: (ctx) => ctx.view.drawNoteRelations() };
  // Presenting a map.
  const presenting = (ctx) => !!ctx.view.presenting;
  handlers['present-map'] = { when: (ctx) => on('mindmapPresent')(ctx) && !presenting(ctx), run: (ctx) => ctx.view.present(ctx.node && ctx.node !== ctx.model.root ? ctx.node.id : null) };
  handlers['present-next'] = { when: presenting, run: (ctx) => ctx.view.presentGo(ctx.view.presenting.at + 1) };
  handlers['present-back'] = { when: presenting, run: (ctx) => ctx.view.presentGo(ctx.view.presenting.at - 1) };
  handlers['present-exit'] = { when: presenting, run: (ctx) => ctx.view.endPresent() };
  // Moving a node about the tree, under the canvas's names for it.
  const notRoot = (ctx) => !!ctx.node && ctx.node !== ctx.model.root;
  handlers['canvas-promote-card'] = { when: notRoot, run: (ctx) => ctx.view.apply(outdentNode(ctx.model, ctx.node.id)) };
  handlers['canvas-demote-card'] = { when: notRoot, run: (ctx) => ctx.view.apply(indentNode(ctx.model, ctx.node.id)) };
  handlers['canvas-card-earlier'] = { when: notRoot, run: (ctx) => ctx.view.apply(reorderNode(ctx.model, ctx.node.id, -1)) };
  handlers['canvas-card-later'] = { when: notRoot, run: (ctx) => ctx.view.apply(reorderNode(ctx.model, ctx.node.id, 1)) };
  Object.keys(handlers).forEach((id) => MINDMAP_HANDLERS.set(id, handlers[id]));
}
