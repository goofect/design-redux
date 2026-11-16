/* ------------------------------------------------------------------ */
/* The map's view                                                      */
/*                                                                     */
/* Nodes are square boxes with an ink hairline, links plain ink lines, */
/* the node picked a clay fill; a folder's tone is its box's line.     */
/* The toolbar is the plugin's icon buttons. Each node is placed by    */
/* two custom properties the script sets (its column and row in        */
/* units), the one kind of inline style the plugin allows itself. The  */
/* arrow keys walk the tree; Space folds; Enter opens.                 */
/* ------------------------------------------------------------------ */

import { ItemView, TFile, TFolder } from 'obsidian';
import { clear, el, flag, glyph } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { iconId } from '../core/icons.js';
import { counted } from '../core/text.js';
import { headRow } from '../ui/head.js';
import { MAP, foldAll, folderMap, layoutMap, noteMap, shownNodes } from './map-model.js';

export const MAP_VIEW = 'design-redux-mindmap';
export const RETIRED_VIEWS = ['design-redux-outline'];

export class MapView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.rootPath = '/';
    this.zoom = 1;
    this.picked = null;
  }

  getViewType() { return MAP_VIEW; }
  getDisplayText() { return this.root ? `Map: ${this.root.label}` : 'Map'; }
  getIcon() { return iconId('map'); }
  getState() { return { root: this.rootPath }; }

  async setState(state) {
    this.rootPath = state && typeof state.root === 'string' ? state.root : '/';
    this.schedule();
  }

  async onOpen() {
    this.contentEl.classList.add('dr', 'dr-map');
    this.schedule();
  }

  /** Builds once the view is open and its state is known: Obsidian opens a view, then gives it its state. */
  schedule() {
    if (this.pending) return;
    this.pending = window.setTimeout(() => {
      this.pending = null;
      if (this.leaf && this.contentEl.isConnected) this.build();
    }, 0);
  }

  async onClose() {
    if (this.pending) window.clearTimeout(this.pending);
    this.pending = null;
  }

  /** Makes the tree for what the map is of, and draws it. */
  build() {
    const target = this.app.vault.getAbstractFileByPath(this.rootPath) || this.app.vault.getRoot();
    this.root = target instanceof TFile ? noteMap(this.plugin, target, this.plugin.settings.albumNestBy || 'parent') : folderMap(this.plugin, target instanceof TFolder ? target : this.app.vault.getRoot());
    this.picked = this.root.id;
    this.draw();
  }

  draw() {
    const host = clear(this.contentEl);
    const shown = shownNodes(this.root);
    const head = headRow(host, { label: this.root.label, text: this.root.kind === 'note', muted: counted(shown.length, 'node'), buttons: [
      { glyph: 'fold', label: 'Fold all', run: () => { foldAll(this.root, true); this.draw(); } },
      { glyph: 'unfold', label: 'Unfold all', run: () => { foldAll(this.root, false); this.draw(); } },
      { glyph: 'fit', label: 'Fit', run: () => this.fit() },
      { glyph: 'minus', label: 'Smaller', run: () => this.scale(this.zoom / 1.25) },
      { glyph: 'plus', label: 'Larger', run: () => this.scale(this.zoom * 1.25) },
    ] });
    head.setAttribute('role', 'toolbar');
    this.pane = el(host, 'div', 'dr-map-pane');
    const canvas = el(this.pane, 'div', 'dr-map-canvas');
    this.canvas = canvas;
    const { at, w, h } = layoutMap(this.root);
    this.at = at;
    this.size = { w, h };
    canvas.style.setProperty('--dr-w', String(w));
    canvas.style.setProperty('--dr-h', String(h));
    canvas.style.setProperty('--dr-zoom', String(this.zoom));
    // Every link in one path: a step out of the parent, across, and into the child.
    const svg = canvas.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'dr-map-links');
    svg.setAttribute('viewBox', `0 0 ${w * 8} ${h * 8}`);
    svg.setAttribute('aria-hidden', 'true');
    const path = canvas.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    let d = '';
    at.forEach((p) => {
      if (!p.parent) return;
      const from = at.get(p.parent.id);
      const [x0, y0, x1, y1] = [(from.x + MAP.nodeW) * 8, (from.y + MAP.nodeH / 2) * 8, p.x * 8, (p.y + MAP.nodeH / 2) * 8];
      const mid = x0 + (MAP.gapX * 8) / 2;
      d += `M${x0} ${y0}H${mid}V${y1}H${x1}`;
    });
    path.setAttribute('d', d);
    svg.appendChild(path);
    canvas.appendChild(svg);
    const nodes = el(canvas, 'div', 'dr-map-nodes');
    nodes.setAttribute('role', 'tree');
    at.forEach((p) => this.drawNode(nodes, p));
    nodes.addEventListener('keydown', (e) => this.onKey(e));
  }

  drawNode(parent, p) {
    const { node } = p;
    const box = el(parent, 'div', 'dr-map-node');
    box.style.setProperty('--dr-x', String(p.x));
    box.style.setProperty('--dr-y', String(p.y));
    box.dataset.id = node.id;
    box.dataset.path = node.path;
    if (node.tone) box.dataset.tone = node.tone;
    // A press picks (a second folds); the keys are the tree's alone (onKey), so none is handled twice.
    box.addEventListener('click', () => this.pick(node, true));
    box.setAttribute('role', 'treeitem');
    box.setAttribute('tabindex', node.id === this.picked ? '0' : '-1');
    if (node.children.length) box.setAttribute('aria-expanded', String(!node.folded));
    flag(box, 'aria-selected', node.id === this.picked);
    const open = this.app.workspace.getActiveFile();
    flag(box, 'aria-current', !!open && open.path === node.path, 'page');
    glyph(box, node.kind === 'folder' ? (this.plugin.faceOf && node.path !== '/' && this.app.vault.getAbstractFileByPath(node.path) ? this.plugin.faceOf(this.app.vault.getAbstractFileByPath(node.path)) : 'folder') : 'note');
    el(box, 'span', 'dr-text dr-clip', node.label);
    if (node.children.length) {
      const count = el(box, 'span', 'dr-map-count dr-label', node.folded ? `+${node.children.length}` : '');
      if (node.folded) count.setAttribute('aria-label', `${counted(node.children.length, 'child', 'children')} folded`);
    }
    box.addEventListener('dblclick', () => this.open(node));
  }

  /** Picks a node: a press on the one already picked folds or unfolds it. */
  pick(node, byPointer) {
    if (byPointer && node.id === this.picked && node.children.length) node.folded = !node.folded;
    this.picked = node.id;
    const entry = this.app.vault.getAbstractFileByPath(node.path);
    if (entry) this.plugin.selection.pick(entry);
    this.draw();
    const box = this.contentEl.querySelector(`.dr-map-node[data-id="${node.id}"]`);
    if (box) box.focus();
  }

  open(node) {
    const entry = this.app.vault.getAbstractFileByPath(node.path);
    if (entry instanceof TFile) return this.app.workspace.getLeaf('tab').openFile(entry);
    const library = this.plugin.features.find((f) => typeof f.browse === 'function');
    return entry instanceof TFolder && library ? library.browse(entry) : null;
  }

  onKey(e) {
    const here = this.at.get(this.picked);
    if (!here) return;
    const { node, parent } = here;
    const siblings = parent ? parent.children : [node];
    const i = siblings.indexOf(node);
    let to = null;
    if (e.key === 'ArrowLeft') to = !node.folded && node.children.length ? (node.folded = true, node) : parent;
    else if (e.key === 'ArrowRight') to = node.children.length ? (node.folded ? (node.folded = false, node) : node.children[0]) : null;
    else if (e.key === 'ArrowUp') to = siblings[i - 1] || null;
    else if (e.key === 'ArrowDown') to = siblings[i + 1] || null;
    else if (e.key === ' ') { if (node.children.length) { node.folded = !node.folded; to = node; } }
    else if (e.key === 'Enter') return void this.open(node);
    else return;
    e.preventDefault();
    if (to) this.pick(to, false);
  }

  scale(zoom) {
    this.zoom = Math.max(0.25, Math.min(2, zoom));
    if (this.canvas) this.canvas.style.setProperty('--dr-zoom', String(this.zoom));
  }

  /** The whole map in the pane. */
  fit() {
    const rect = this.pane.getBoundingClientRect ? this.pane.getBoundingClientRect() : { width: 0, height: 0 };
    if (!rect.width || !rect.height) return void this.scale(1);
    this.scale(Math.min(1, (rect.width - 32) / (this.size.w * 8), (rect.height - 32) / (this.size.h * 8)));
  }
}

/** A view type that has gone: a layout saved with one open would keep a dead tab, so it stays registered and closes itself. */
class RetiredView extends ItemView {
  constructor(leaf, type) { super(leaf); this.type = type; }
  getViewType() { return this.type; }
  getDisplayText() { return 'Closed'; }
  async onOpen() { setTimeout(() => this.leaf.detach(), 0); }
}

export class Maps extends Feature {
  register() {
    this.plugin.registerView(MAP_VIEW, (leaf) => new MapView(leaf, this.plugin));
    RETIRED_VIEWS.forEach((type) => this.plugin.registerView(type, (leaf) => new RetiredView(leaf, type)));
  }

  enable() {
    const ws = this.app.workspace;
    this.listen(ws, 'design-redux:vault', () => ws.getLeavesOfType(MAP_VIEW).forEach((l) => l.view && l.view.root && l.view.schedule()));
    this.add(() => !this.plugin.unloading && ws.detachLeavesOfType(MAP_VIEW));
  }

  async open(entry) {
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: MAP_VIEW, active: true, state: { root: entry ? entry.path : '/' } });
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  actions() {
    return [
      { id: 'open-map', name: 'Open the map of the vault', glyph: 'map', run: () => this.open(null) },
      { id: 'open-map-here', name: 'Open the map of this folder', glyph: 'map', on: 'folder', menu: 'Map', run: (ctx) => this.open(ctx.folder) },
      { id: 'open-map-note', name: 'Open the map under this note', glyph: 'node-child', on: 'note', menu: false, run: (ctx) => this.open(ctx.file) },
    ];
  }
}
Maps.title = 'Maps';
Maps.glyph = 'map';
Maps.section = 'Tools';
Maps.about = 'A folder, or the notes under a note, as a tree to fold and walk.';
