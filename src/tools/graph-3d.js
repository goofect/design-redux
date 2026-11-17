/* ------------------------------------------------------------------ */
/* The graph in three dimensions                                       */
/*                                                                     */
/* The vault's notes and the links between them as a cloud to turn, in */
/* a tab of its own. Drag to turn it, scroll to come closer, point at  */
/* a note to name it, click to pick it and again to open it. The more  */
/* a note links, the bigger it is drawn; the open note inverted. In the */
/* look's terms: ink squares, hairlines, one fill. It is drawn when    */
/* something changes and never by itself.                              */
/* ------------------------------------------------------------------ */

import { ItemView, TFile } from 'obsidian';
import { clear, el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { counted } from '../core/text.js';
import { headRow } from '../ui/head.js';
import { sayso } from '../ui/state.js';
import { fitZoom, graphSpace, layoutSpace, project } from './graph-space.js';

export const GRAPH_3D_VIEW = 'design-redux-graph-3d';

export class Graph3DView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.around = null;
    this.look = { yaw: 0.6, pitch: 0.35, zoom: 1 };
    this.picked = -1;
    this.hover = -1;
  }

  getViewType() { return GRAPH_3D_VIEW; }
  getDisplayText() { return this.around ? `3D graph: ${this.around.basename}` : '3D graph'; }
  getIcon() { return 'box'; }
  getState() { return { around: this.around ? this.around.path : null }; }

  async setState(state) {
    const file = state && state.around ? this.app.vault.getAbstractFileByPath(state.around) : null;
    this.around = file instanceof TFile ? file : null;
    this.schedule();
  }

  async onOpen() {
    this.contentEl.classList.add('dr', 'dr-graph3d');
    this.schedule();
  }

  /** Lays the cloud out once the view is open and knows what it is of: a layout is the costly part, so never twice. */
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

  /** Gathers the notes, lays them out, and draws. */
  build() {
    const host = clear(this.contentEl);
    this.space = graphSpace(this.plugin, this.around);
    const n = this.space.nodes.length;
    headRow(host, { label: this.around ? this.around.basename : '3D graph', text: !!this.around, muted: `${counted(n, 'note')} · ${counted(this.space.links.length, 'link')}`, buttons: [
      { glyph: 'fit', label: 'Fit', run: () => { this.look = { yaw: 0.6, pitch: 0.35, zoom: fitZoom(this.pos, ...this.size()) }; this.draw(); } },
      { glyph: 'plus', label: 'Closer', run: () => this.zoom(1.25) },
      { glyph: 'minus', label: 'Further', run: () => this.zoom(0.8) },
    ] });
    if (!n) return void sayso(host, { label: 'No notes to draw' });
    this.pos = layoutSpace(n, this.space.links);
    const box = el(host, 'div', 'dr-graph3d-box');
    this.canvas = el(box, 'canvas', 'dr-graph3d-canvas');
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `A graph of ${counted(n, 'note')}. Arrow keys turn it; plus and minus come closer and go further.`);
    this.name = el(box, 'div', 'dr-graph3d-name dr-text');
    this.look.zoom = fitZoom(this.pos, ...this.size());
    this.listen();
    this.draw();
  }

  zoom(by) {
    this.look.zoom = Math.max(0.02, Math.min(12, this.look.zoom * by));
    this.draw();
  }

  size() {
    const rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { width: 0, height: 0 };
    return [Math.round(rect.width) || 800, Math.round(rect.height) || 600];
  }

  /** The note under a point of the canvas, nearest the eye; -1 for none. */
  at(x, y) {
    let best = -1;
    for (let i = 0; i < this.space.nodes.length; i++) {
      const half = this.half(i) + 3;
      if (Math.abs(this.screen[i * 3] - x) <= half && Math.abs(this.screen[i * 3 + 1] - y) <= half && (best < 0 || this.screen[i * 3 + 2] > this.screen[best * 3 + 2])) best = i;
    }
    return best;
  }

  half(i) {
    return Math.max(3, Math.min(12, 2 + Math.sqrt(this.space.nodes[i].degree) * 1.5) * Math.max(0.6, Math.min(2, this.look.zoom)));
  }

  listen() {
    const c = this.canvas;
    let drag = null;
    const point = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; });
    c.addEventListener('pointermove', (e) => {
      if (drag) {
        const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.look.yaw += dx * 0.01;
        this.look.pitch = Math.max(-1.5, Math.min(1.5, this.look.pitch + dy * 0.01));
        drag.x = e.clientX;
        drag.y = e.clientY;
        return void this.draw();
      }
      const over = this.at(...point(e));
      if (over !== this.hover) { this.hover = over; this.draw(); }
    });
    const up = (e) => {
      const was = drag;
      drag = null;
      if (!was || was.moved) return;
      const i = this.at(...point(e));
      if (i >= 0 && i === this.picked) return void this.openNote(i);
      this.picked = i;
      this.plugin.selection.pick(i >= 0 ? this.app.vault.getAbstractFileByPath(this.space.nodes[i].id) : null);
      this.draw();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointerleave', () => { drag = null; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
    c.addEventListener('keydown', (e) => {
      const turn = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
      if (turn) { this.look.yaw += turn[0]; this.look.pitch = Math.max(-1.5, Math.min(1.5, this.look.pitch + turn[1])); }
      else if (e.key === '+' || e.key === '=') return void this.zoom(1.25);
      else if (e.key === '-') return void this.zoom(0.8);
      else if (e.key === 'Enter' && this.picked >= 0) return void this.openNote(this.picked);
      else return;
      e.preventDefault();
      this.draw();
    });
  }

  openNote(i) {
    const file = this.app.vault.getAbstractFileByPath(this.space.nodes[i].id);
    if (file instanceof TFile) this.app.workspace.getLeaf('tab').openFile(file);
  }

  draw() {
    const c = this.canvas;
    if (!c) return;
    const [w, h] = this.size();
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    c.width = w * ratio;
    c.height = h * ratio;
    this.screen = project(this.pos, Object.assign({ w, h }, this.look));
    const ctx = typeof c.getContext === 'function' ? c.getContext('2d') : null;
    const shown = this.hover >= 0 ? this.hover : this.picked;
    this.name.textContent = shown >= 0 ? this.space.nodes[shown].name : '';
    if (!ctx) return;
    const css = getComputedStyle(this.contentEl);
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const [ink, muted, ground] = [token('--dr-ink', '#000000'), token('--dr-muted', '#767676'), token('--dr-bg', '#FFFFFF')];
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    this.space.links.forEach(([a, b]) => {
      ctx.moveTo(this.screen[a * 3], this.screen[a * 3 + 1]);
      ctx.lineTo(this.screen[b * 3], this.screen[b * 3 + 1]);
    });
    ctx.stroke();
    const open = this.app.workspace.getActiveFile();
    // Far notes first, so near ones are drawn over them.
    const order = this.space.nodes.map((_, i) => i).sort((a, b) => this.screen[a * 3 + 2] - this.screen[b * 3 + 2]);
    order.forEach((i) => {
      const current = open && open.path === this.space.nodes[i].id;
      // The picked note and the open one larger and inverted: the ground's colour, an ink line round it.
      const marked = current || i === this.picked;
      const half = this.half(i) + (marked ? 2 : 0);
      const [x, y] = [this.screen[i * 3], this.screen[i * 3 + 1]];
      ctx.fillStyle = marked ? ground : ink;
      ctx.fillRect(Math.round(x - half), Math.round(y - half), Math.round(half * 2), Math.round(half * 2));
      if (marked || i === this.hover) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.round(x - half) + 1, Math.round(y - half) + 1, Math.round(half * 2) - 2, Math.round(half * 2) - 2);
      }
    });
  }
}

export class Graph3D extends Feature {
  register() {
    this.plugin.registerView(GRAPH_3D_VIEW, (leaf) => new Graph3DView(leaf, this.plugin));
  }

  enable() {
    const ws = this.app.workspace;
    const again = () => ws.getLeavesOfType(GRAPH_3D_VIEW).forEach((l) => l.view && l.view.canvas && l.view.schedule());
    this.listen(ws, 'design-redux:links', again);
    this.listen(ws, 'file-open', () => ws.getLeavesOfType(GRAPH_3D_VIEW).forEach((l) => l.view && l.view.draw && l.view.draw()));
    this.add(() => !this.plugin.unloading && ws.detachLeavesOfType(GRAPH_3D_VIEW));
  }

  async open(around) {
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: GRAPH_3D_VIEW, active: true, state: { around: around ? around.path : null } });
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /** In Obsidian's graph: the same in 3D. In the 3D graph: Obsidian's. */
  async swap() {
    const leaf = this.app.workspace.activeLeaf;
    const type = leaf && leaf.view ? leaf.view.getViewType() : '';
    if (type === GRAPH_3D_VIEW) return leaf.setViewState({ type: 'graph', active: true });
    if (type === 'graph' || type === 'localgraph') return leaf.setViewState({ type: GRAPH_3D_VIEW, active: true, state: { around: null } });
    return this.open(null);
  }

  actions() {
    return [
      { id: 'open-graph-3d', name: 'Open 3D graph', run: () => this.open(null) },
      { id: 'open-graph-3d-local', name: 'Open 3D graph around this note', on: 'note', menu: '3D graph around this note', run: (ctx) => this.open(ctx.file) },
      { id: 'toggle-graph-3d', name: 'Switch the graph between 2D and 3D', run: () => this.swap() },
    ];
  }
}
Graph3D.key = 'graph3d';
Graph3D.title = '3D graph';
Graph3D.section = 'Tools';
Graph3D.about = 'The vault’s notes and links as a cloud to turn.';
