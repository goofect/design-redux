/* ------------------------------------------------------------------ */
/* The graph in three dimensions                                       */
/*                                                                     */
/* The vault's notes as spheres in space and the links between them as */
/* lines, in a tab of its own, seen in perspective: what is near is    */
/* larger and darker, what is far smaller and fainter, and a nearer    */
/* sphere covers what is behind it. Drag to turn it, scroll to come    */
/* closer, point at a note to name it, click to pick it and again to   */
/* open it. The more a note links, the bigger its sphere; the picked   */
/* and the open note ringed. Only the look's colours: a sphere is lit  */
/* from its grey to its ink. It is drawn when something changes and    */
/* never by itself.                                                    */
/* ------------------------------------------------------------------ */

import { ItemView, TFile, View } from 'obsidian';
import { clear, el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { headRow } from '../ui/head.js';
import { sayso } from '../ui/state.js';
import { drawOrder, fitView, graphSpace, layoutSpace, project, spaceRadius, sphereRadius, sphereUnit } from './graph-space.js';

export const GRAPH_3D_VIEW = 'design-redux-graph-3d';

const START = { yaw: 0.6, pitch: 0.35 };

export class Graph3DView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.around = null;
    this.look = { ...START, zoom: 1 };
    this.picked = -1;
    this.hover = -1;
    this.sprites = new Map();
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
    headRow(host, { label: this.around ? this.around.basename : '3D graph', buttons: [
      { glyph: 'fit', label: 'Fit', run: () => { this.look = { ...START, ...fitView(this.pos, ...this.size(), START) }; this.draw(); } },
      { glyph: 'plus', label: 'Closer', run: () => this.zoom(1.25) },
      { glyph: 'minus', label: 'Further', run: () => this.zoom(0.8) },
    ] });
    if (!n) return void sayso(host, { label: 'No notes to draw' });
    this.pos = layoutSpace(n, this.space.links);
    this.radius = spaceRadius(this.pos);
    this.unit = sphereUnit(this.pos, this.space.links);
    const box = el(host, 'div', 'dr-graph3d-box');
    this.canvas = el(box, 'canvas', 'dr-graph3d-canvas');
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `A graph of the notes in three dimensions. Arrow keys turn it; plus and minus come closer and go further.`);
    this.name = el(box, 'div', 'dr-graph3d-name dr-text');
    this.look = { ...START, ...fitView(this.pos, ...this.size(), START) };
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

  /** A note's sphere on the screen now: its radius. */
  r(i) {
    return sphereRadius(this.space.nodes[i].degree, this.screen[i * 4 + 3], this.look.zoom, this.unit);
  }

  /** The note under a point of the canvas, nearest the eye; -1 for none. */
  at(x, y) {
    let best = -1;
    for (let i = 0; i < this.space.nodes.length; i++) {
      const reach = this.r(i) + 3;
      if (Math.hypot(this.screen[i * 4] - x, this.screen[i * 4 + 1] - y) <= reach && (best < 0 || this.screen[i * 4 + 2] > this.screen[best * 4 + 2])) best = i;
    }
    return best;
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
    c.addEventListener('pointerleave', () => { drag = null; if (this.hover >= 0) { this.hover = -1; this.draw(); } });
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

  /** The look's colours, and which of ink and grey is the lighter: a sphere is lit from the lighter to the darker. */
  colours() {
    const css = getComputedStyle(this.contentEl);
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const [ink, muted, ground] = [token('--dr-ink', '#000000'), token('--dr-muted', '#767676'), token('--dr-bg', '#FFFFFF')];
    const light = (c) => {
      const hex = /^#?([0-9a-f]{6})$/i.exec(c);
      const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
      const v = hex ? [parseInt(hex[1], 16) >> 16, (parseInt(hex[1], 16) >> 8) & 255, parseInt(hex[1], 16) & 255] : rgb ? rgb.slice(1, 4).map(Number) : [128, 128, 128];
      return (v[0] + v[1] + v[2]) / 765;
    };
    const inkLight = light(ink) > light(muted);
    return { ink, muted, ground, lit: inkLight ? ink : muted, shade: inkLight ? muted : ink };
  }

  /** A sphere of radius r, drawn once and kept: lit from above and to the left, from the lighter tone to the darker. */
  sprite(r, ratio, tones) {
    const key = `${Math.round(r * 2)}|${ratio}|${tones.lit}|${tones.shade}`;
    if (this.sprites.has(key)) return this.sprites.get(key);
    const size = Math.ceil((Math.round(r * 2) / 2) * 2 * ratio) + 2;
    const s = this.contentEl.ownerDocument.createElement('canvas');
    s.width = size;
    s.height = size;
    const g = typeof s.getContext === 'function' ? s.getContext('2d') : null;
    if (g) {
      const c = size / 2;
      const rad = c - 1;
      const grad = g.createRadialGradient(c - rad * 0.35, c - rad * 0.4, rad * 0.05, c, c, rad);
      grad.addColorStop(0, tones.lit);
      grad.addColorStop(0.55, tones.shade);
      grad.addColorStop(1, tones.shade);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(c, c, rad, 0, Math.PI * 2);
      g.fill();
    }
    if (this.sprites.size > 200) this.sprites.clear();
    this.sprites.set(key, s);
    return s;
  }

  draw() {
    const c = this.canvas;
    if (!c) return;
    const [w, h] = this.size();
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    c.width = w * ratio;
    c.height = h * ratio;
    this.screen = project(this.pos, Object.assign({ w, h, radius: this.radius }, this.look));
    const ctx = typeof c.getContext === 'function' ? c.getContext('2d') : null;
    const shown = this.hover >= 0 ? this.hover : this.picked;
    this.name.textContent = shown >= 0 ? this.space.nodes[shown].name : '';
    if (!ctx) return;
    const tones = this.colours();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = tones.ground;
    ctx.fillRect(0, 0, w, h);
    // Depth as nearness, 0 (the far side) to 1 (the near side): far things fainter, near ones clear.
    const near = (z) => Math.max(0, Math.min(1, (z / this.radius + 1) / 2));
    const open = this.app.workspace.getActiveFile();
    const marked = (i) => (open && open.path === this.space.nodes[i].id) || i === this.picked;
    ctx.lineCap = 'round';
    drawOrder(this.screen, this.space.links).forEach((item) => {
      if (item.link) {
        const [a, b] = item.link;
        const k = near(item.depth);
        ctx.globalAlpha = 0.25 + 0.5 * k;
        ctx.strokeStyle = tones.ink;
        ctx.lineWidth = Math.max(0.75, 1.6 * (this.screen[a * 4 + 3] + this.screen[b * 4 + 3]) / 2);
        ctx.beginPath();
        ctx.moveTo(this.screen[a * 4], this.screen[a * 4 + 1]);
        ctx.lineTo(this.screen[b * 4], this.screen[b * 4 + 1]);
        ctx.stroke();
        return;
      }
      const i = item.sphere;
      const r = this.r(i);
      const [x, y] = [this.screen[i * 4], this.screen[i * 4 + 1]];
      // Solid, so it hides what is behind it; the further it is, the more the ground's haze lies over it.
      ctx.globalAlpha = 1;
      const img = this.sprite(r, ratio, tones);
      ctx.drawImage(img, x - img.width / ratio / 2, y - img.height / ratio / 2, img.width / ratio, img.height / ratio);
      const haze = 0.6 * (1 - near(item.depth));
      if (haze > 0.02) {
        ctx.globalAlpha = haze;
        ctx.fillStyle = tones.ground;
        ctx.beginPath();
        ctx.arc(x, y, r + 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // The picked and the open note ringed, apart from the sphere by the ground; the one pointed at, a hairline.
      if (marked(i) || i === this.hover) {
        ctx.strokeStyle = tones.ink;
        ctx.lineWidth = marked(i) ? 2 : 1;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }
}

export class Graph3D extends Feature {
  register() {
    this.registerView(GRAPH_3D_VIEW, (leaf) => new Graph3DView(leaf, this.plugin));
  }

  enable() {
    const ws = this.app.workspace;
    const again = () => ws.getLeavesOfType(GRAPH_3D_VIEW).forEach((l) => l.view && l.view.canvas && l.view.schedule());
    this.listen(ws, 'design-redux:links', again);
    this.listen(ws, 'file-open', () => ws.getLeavesOfType(GRAPH_3D_VIEW).forEach((l) => l.view && l.view.draw && l.view.draw()));
  }

  async open(around) {
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: GRAPH_3D_VIEW, active: true, state: { around: around ? around.path : null } });
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /** In Obsidian's graph: the same in 3D. In the 3D graph: Obsidian's. */
  async swap() {
    const view = this.app.workspace.getActiveViewOfType(View);
    const leaf = view && view.leaf;
    const type = leaf ? view.getViewType() : '';
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
Graph3D.title = '3D graph';
Graph3D.section = 'Tools';
Graph3D.about = 'The vault’s notes as spheres in space, joined by their links, to turn.';
