/* ------------------------------------------------------------------ */
/* The graph in three dimensions                                      */
/*                                                                    */
/* The vault's notes and the links between them, as a cloud to turn,  */
/* in a tab of its own: Open 3D graph, or Open 3D graph around this   */
/* note. A note takes its top folder's colour (or its first tag's),   */
/* and the more it links, the bigger it's drawn; pointing at a note   */
/* names it and lights its links; the open note wears a ring.         */
/*                                                                    */
/* This, the view's last part (over 274 and 269), gathers the notes   */
/* from the library index, hands the layout (264) its work and the    */
/* renderer (268) what to draw, a frame at a time and only when       */
/* something moved. Where notes were is kept as notes come and go, so */
/* the cloud doesn't start again at each edit, nor when the tab is    */
/* opened again; what the tab is set to is kept with the workspace.   */
/* ------------------------------------------------------------------ */

import { getAllTags, Platform, TFile } from 'obsidian';
import { GRAPH_TYPES } from '../core/020-constants.js';
import { libraryIndex } from '../core/077-library-index.js';
import { Feature } from '../core/080-feature.js';
import { buildSpace, colourGroups, filtersFromGraph, GRAPH_3D_DEFAULTS, KIND_KEYS, parseColour, spaceSignature } from './263-graph-space.js';
import { layoutOptions, LayoutRunner, startPositions } from './264-graph-layout.js';
import { fitView, placeNames, projectInto } from './265-graph-camera.js';
import { CanvasRenderer, drawOverlay, GLRenderer } from './268-graph-draw.js';
import { GRAPH_3D_VIEW } from './269-graph-3d-input.js';
import { Graph3DPanel } from './274-graph-3d-panel.js';

/** The theme's colours a folder's (or tag's) notes take, in turn: the commonest first. */
const GRAPH_3D_COLOURS = ['--color-blue', '--color-orange', '--color-green', '--color-purple', '--color-red', '--color-cyan', '--color-yellow', '--color-pink'];

/** Where each colour sits in the palette: the kinds first, then the folders'. */
const GRAPH_3D_SLOT = { node: 0, focus: 1, tag: 2, file: 3, missing: 4, first: 5 };

export class Graph3DView extends Graph3DPanel {
  getViewType() {
    return GRAPH_3D_VIEW;
  }

  getDisplayText() {
    return '3D graph';
  }

  getIcon() {
    return 'rotate-3d';
  }

  get folderColours() {
    return GRAPH_3D_COLOURS.length;
  }

  get firstSlot() {
    return GRAPH_3D_SLOT.first;
  }

  /** The window the view is in: the main one, or a popout's. */
  host() {
    return this.contentEl.ownerDocument.defaultView || window;
  }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass('dr-graph3d');
    const win = this.host();
    this.still = typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.stage = el.createDiv({ cls: 'dr-graph3d-stage' });
    this.makeRenderer();
    this.overlay = this.stage.createEl('canvas', { cls: 'dr-graph3d-overlay' });
    this.overlay.setAttribute('tabindex', '0');
    this.overlay.setAttribute('aria-label', 'Notes and their links, in 3D');
    this.ink = this.overlay.getContext('2d');
    this.caption = el.createDiv({ cls: 'dr-graph3d-caption' });
    this.caption.setAttribute('aria-live', 'polite');
    this.buildPanel();
    this.panelButton = this.addAction('sliders-horizontal', 'Graph settings', () => this.togglePanel());
    this.panelButton.addClass('dr-graph3d-settings');
    this.addAction('scan', 'Fit every note in view', () => this.fit());
    this.spinButton = this.addAction('rotate-3d', 'Turn slowly', () => this.setOption('spin', !this.options.spin));
    this.spinButton.addClass('dr-graph3d-spin');
    this.addAction('git-fork', 'Show in 2D', () => this.feature.flip(this.leaf)).addClass('dr-graph3d-switch');
    this.runner = new LayoutRunner(win, () => this.draw());
    this.runner.setForces(layoutOptions(this.options), 0);
    const later = () => this.queueBuild(800);
    this.registerEvent(this.app.metadataCache.on('resolved', later));
    ['create', 'delete', 'rename'].forEach((type) => this.registerEvent(this.app.vault.on(type, later)));
    this.registerEvent(this.app.workspace.on('file-open', (file) => this.opened(file)));
    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        this.readTheme();
        this.restyle();
      })
    );
    this.listen(this.overlay);
    this.readTheme();
    this.syncControls();
    // Obsidian gives the tab its saved state after it opens: the first build waits for it.
    this.queueBuild(0);
  }

  /** WebGL if there's some to be had; else a 2D canvas, a new one (a canvas that tried WebGL can't draw 2D). */
  makeRenderer() {
    const canvas = this.stage.createEl('canvas', { cls: 'dr-graph3d-canvas' });
    let renderer = GLRenderer.create(canvas);
    if (!renderer) {
      canvas.remove();
      renderer = new CanvasRenderer(this.stage.createEl('canvas', { cls: 'dr-graph3d-canvas' }));
    }
    this.renderer = renderer;
    this.canvas = renderer.canvas;
  }

  async onClose() {
    this.savePositions();
    this.feature.remember(this);
    const win = this.host();
    if (this.raf) win.cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.buildTimer) win.clearTimeout(this.buildTimer);
    this.cancelLongPress();
    if (this.runner) this.runner.destroy();
    if (this.renderer) this.renderer.destroy();
    this.contentEl.empty();
  }

  onResize() {
    this.draw();
  }

  getState() {
    const state = super.getState ? super.getState() : {};
    return Object.assign({}, state, { options: Object.assign({}, this.options), camera: this.camera.toJSON(), root: this.root });
  }

  async setState(state, result) {
    const s = state || {};
    if (s.options) {
      Object.keys(GRAPH_3D_DEFAULTS).forEach((k) => {
        if (typeof s.options[k] === typeof GRAPH_3D_DEFAULTS[k]) this.options[k] = s.options[k];
      });
    }
    if (s.camera) {
      this.camera.restore(s.camera);
      this.cameraKept = true;
      this.touched = true;
    }
    if (typeof s.root === 'string') this.root = s.root;
    if (this.runner) {
      this.syncControls();
      this.runner.setForces(layoutOptions(this.options), 0);
      this.queueBuild(0);
    }
    if (super.setState) await super.setState(state, result);
  }

  /* -- what's drawn ------------------------------------------------ */

  queueBuild(delay) {
    const win = this.host();
    if (this.buildTimer) win.clearTimeout(this.buildTimer);
    this.buildTimer = win.setTimeout(() => this.build(), delay);
  }

  /** The vault as buildSpace takes it: notes with their links and tags, and attachments if they're shown. */
  collect() {
    const index = libraryIndex(this.feature.plugin);
    const meta = this.app.metadataCache;
    const o = this.options;
    const wantTags = o.tags || o.colourBy === 'tag' || !!o.search;
    const unresolved = (o.missing && meta.unresolvedLinks) || {};
    const notes = index.markdown().map((f) => {
      let tags = [];
      if (wantTags && typeof getAllTags === 'function') {
        const cache = meta.getFileCache(f);
        tags = cache ? [...new Set((getAllTags(cache) || []).map((t) => t.toLowerCase()))] : [];
      }
      return { path: f.path, name: f.basename, tags, links: index.outgoing(f), missing: unresolved[f.path] || null };
    });
    const files = o.attachments ? index.files().filter((f) => f.extension !== 'md').map((f) => ({ path: f.path, name: f.name })) : [];
    return { notes, files };
  }

  /** The graph worked out again; laid out again only where its notes or links changed. */
  build() {
    this.buildTimer = 0;
    if (!this.runner) return;
    const { notes, files } = this.collect();
    const graph = buildSpace(notes, files, this.options, this.options.local ? this.root || this.openPath() : '');
    const sign = spaceSignature(graph);
    if (sign === this.sign) {
      graph.nodes.forEach((n, i) => (this.graph.nodes[i].key = n.key));
      this.graph.root = graph.root;
      this.restyle();
      return;
    }
    const before = this.positionsById();
    const pickedId = this.picked >= 0 && this.graph.nodes[this.picked] ? this.graph.nodes[this.picked].id : null;
    const { pos, known } = startPositions(graph.nodes, before);
    const share = graph.nodes.length ? known / graph.nodes.length : 1;
    this.graph = graph;
    this.sign = sign;
    this.at = new Map(graph.nodes.map((n, i) => [n.id, i]));
    this.picked = pickedId && this.at.has(pickedId) ? this.at.get(pickedId) : -1;
    this.hover = -1;
    this.held = -1;
    this.runner.load(graph.nodes.length, graph.links, pos, share > 0.98 ? 0.05 : share > 0.6 ? 0.3 : 1);
    this.renderer.setGraph(graph.nodes.length, graph.links);
    this.uploaded = -1;
    if (share < 0.6 && !this.cameraKept) this.touched = false;
    this.restyle();
    if (this.fitAfterBuild) {
      this.fitAfterBuild = false;
      this.fit(true);
    }
  }

  /** Where every note drawn is, by id, over where notes were the last time any 3D graph had them. */
  positionsById() {
    const map = new Map(this.feature.positions);
    const pos = this.runner.positions;
    this.graph.nodes.forEach((n, i) => {
      if (pos.length >= i * 3 + 3) map.set(n.id, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    });
    return map;
  }

  savePositions() {
    if (this.runner) this.feature.positions = this.positionsById();
  }

  readTheme() {
    const css = this.host().getComputedStyle(this.contentEl);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const probe = this.contentEl.ownerDocument.createElement('canvas').getContext('2d');
    const normalize = (s) => {
      if (!probe) return s;
      probe.fillStyle = '#000000';
      probe.fillStyle = s;
      return probe.fillStyle;
    };
    const node = v('--graph-node', v('--text-muted', '#888888'));
    const focus = v('--graph-node-focused', v('--interactive-accent', '#7b6cd9'));
    const list = [node, focus, v('--graph-node-tag', v('--color-green', '#3a9a5b')), v('--graph-node-attachment', v('--color-yellow', '#c99a1f')), v('--graph-node-unresolved', v('--text-faint', '#aaaaaa'))].concat(GRAPH_3D_COLOURS.map((name) => v(name, node)));
    const ground = v('--background-primary', '#ffffff');
    const line = v('--graph-line', v('--background-modifier-border', '#888888'));
    const size = parseFloat(v('--font-ui-smaller', '12px')) || 12;
    this.palette = { css: list, rgb: list.map((c) => parseColour(c, normalize)) };
    this.theme = {
      ground,
      groundRgb: parseColour(ground, normalize),
      line,
      lineRgb: parseColour(line, normalize),
      accent: focus,
      accentRgb: parseColour(focus, normalize),
      text: v('--graph-text', v('--text-normal', '#222222')),
      font: `${size}px ${v('--font-interface', css.fontFamily || 'sans-serif')}`,
    };
    this.lineHeight = Math.round(size * 1.3);
    this.widths = new Map();
  }

  /** Sizes and colours, from the graph and the settings; and what's lit. */
  restyle() {
    const nodes = this.graph.nodes;
    const n = nodes.length;
    const groups = colourGroups(nodes, GRAPH_3D_COLOURS.length);
    const slotOf = new Map(groups.map((g) => [g.key, GRAPH_3D_SLOT.first + g.slot]));
    const kinds = { [KIND_KEYS.tag]: GRAPH_3D_SLOT.tag, [KIND_KEYS.file]: GRAPH_3D_SLOT.file, [KIND_KEYS.missing]: GRAPH_3D_SLOT.missing };
    this.slots = new Uint8Array(n);
    this.sizes = new Float32Array(n);
    const k = this.options.nodeSize;
    nodes.forEach((node, i) => {
      this.slots[i] = node.key in kinds ? kinds[node.key] : slotOf.has(node.key) ? slotOf.get(node.key) : GRAPH_3D_SLOT.node;
      this.sizes[i] = (2.4 + Math.sqrt(node.degree) * 0.9) * k * (node.kind === 'note' ? 1 : 0.8);
    });
    this.renderLegend(groups);
    this.lightChanged();
  }

  /** The note whose links are lit (the one pointed at, else the one picked) and those it links to; null for none. */
  lit() {
    const focus = this.hover >= 0 ? this.hover : this.picked;
    if (focus < 0 || !this.graph.nodes[focus]) return null;
    const set = new Set([focus].concat(this.graph.nodes[focus].near));
    set.focus = focus;
    return set;
  }

  /** What's lit changed: the rest dimmed, its links drawn in the accent colour, the caption told. */
  lightChanged() {
    if (!this.renderer || !this.slots) return;
    const n = this.graph.nodes.length;
    const lit = this.lit();
    const presence = new Float32Array(n).fill(lit ? 0.22 : 1);
    const slots = this.slots.slice();
    const pairs = [];
    if (lit) {
      lit.forEach((i) => (presence[i] = 1));
      slots[lit.focus] = GRAPH_3D_SLOT.focus;
      this.graph.nodes[lit.focus].near.forEach((j) => pairs.push(lit.focus, j));
    }
    if (this.picked >= 0 && this.picked < n) slots[this.picked] = GRAPH_3D_SLOT.focus;
    this.renderer.setStyle(this.sizes, slots, presence, this.palette.rgb);
    this.renderer.setLit(Int32Array.from(pairs));
    this.setCaption();
    this.draw();
  }

  /** The note open in the workspace. */
  openPath() {
    const file = this.app.workspace.getActiveFile();
    return file ? file.path : '';
  }

  /** The open note, if it's among those drawn: its index, or -1. */
  current() {
    const path = this.openPath();
    return path && this.at.has(path) ? this.at.get(path) : -1;
  }

  opened(file) {
    if (this.options.local && file && file.path !== this.root) {
      this.root = file.path;
      this.fitAfterBuild = true;
      this.queueBuild(150);
    } else if (this.options.follow && file && this.at.has(file.path)) {
      this.centreOn(this.at.get(file.path));
    }
    this.draw();
  }

  pick(i) {
    this.picked = i;
    this.lightChanged();
  }

  /** What's around one note (or tag) only, a few steps out. */
  showAround(id) {
    this.root = id;
    this.fitAfterBuild = true;
    if (this.options.local) this.queueBuild(0);
    else this.setOption('local', true);
  }

  setCaption() {
    const cap = this.caption;
    if (!cap) return;
    cap.empty();
    const nodes = this.graph.nodes;
    const lit = this.lit();
    const i = lit ? lit.focus : -1;
    const line = (cls, text) => cap.createDiv({ cls, text });
    if (i >= 0) {
      const n = nodes[i];
      const folder = n.path && n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : n.path ? 'Vault' : '';
      const kind = { note: '', file: 'Attachment', tag: 'Tag', missing: 'Not written yet' }[n.kind];
      const tap = Platform.isMobile ? 'Tap' : 'Click';
      const next = { note: 'open it', file: 'open it', tag: 'see what’s around it', missing: 'write it' }[n.kind];
      line('dr-graph3d-name', n.name);
      line('dr-graph3d-meta', [kind, folder, `${n.degree} ${n.degree === 1 ? 'link' : 'links'}`, i === this.picked ? `${tap} again to ${next}` : ''].filter(Boolean).join(' · '));
      return;
    }
    if (!nodes.length) {
      const o = this.options;
      if (o.local && !this.root && !this.openPath()) line('dr-graph3d-name', 'Open a note to see what’s around it');
      else if (o.search) line('dr-graph3d-name', `Nothing matches “${o.search}”`);
      else line('dr-graph3d-name', 'No notes yet');
      line('dr-graph3d-meta', o.search || o.local ? 'Change what’s shown in Graph settings.' : 'Notes and their links appear here as you write them.');
      return;
    }
    const notes = nodes.filter((n) => n.kind === 'note').length;
    const rest = nodes.length - notes;
    const root = this.graph.root >= 0 ? nodes[this.graph.root].name : '';
    line('dr-graph3d-name', [`${notes.toLocaleString()} ${notes === 1 ? 'note' : 'notes'}`, rest ? `${rest.toLocaleString()} more` : '', `${(this.graph.links.length / 2).toLocaleString()} links`].filter(Boolean).join(' · ') + (root ? ` around ${root}` : ''));
    line('dr-graph3d-meta', Platform.isMobile ? 'Drag to turn · Pinch to zoom · Two fingers to move' : 'Drag to turn · Scroll to zoom · Shift-drag to move');
  }

  /* -- the loop: layout, camera, a frame --------------------------- */

  draw() {
    if (!this.raf && this.overlay) this.raf = this.host().requestAnimationFrame(() => this.tick());
  }

  tick() {
    this.raf = 0;
    const w = this.contentEl.clientWidth;
    const h = this.contentEl.clientHeight;
    // A tab out of sight has no size: nothing to draw till it's shown (onResize).
    if (!w || !h || !this.overlay.isConnected) return;
    const dpr = this.host().devicePixelRatio || 1;
    if (w !== this.w || h !== this.h || dpr !== this.dpr) this.size(w, h, dpr);
    let again = false;
    if (this.runner.pump(this.still ? 30 : 8)) again = true;
    if (this.runner.hot && !this.touched && Date.now() - (this.lastFit || 0) > 120) this.fit(true);
    if (this.options.spin && this.held < 0) {
      this.camera.yaw += 0.0025;
      again = true;
    }
    if (this.easing && this.ease()) again = true;
    this.renderFrame();
    if (again) this.draw();
  }

  size(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    [this.canvas, this.overlay].forEach((c) => {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
    });
  }

  /** The camera moved to take in every note drawn: eased there, unless motion's to be kept down. */
  fit(quiet) {
    if (!quiet) this.touched = true;
    this.lastFit = Date.now();
    const aim = fitView(this.camera, this.runner.positions, this.graph.nodes.length, this.w || 1, this.h || 1);
    if (aim) this.easing = aim;
    this.draw();
  }

  /** The camera turned to one note, and brought a little nearer. */
  centreOn(i) {
    if (i < 0 || i >= this.graph.nodes.length) return;
    const pos = this.runner.positions;
    this.touched = true;
    this.easing = { target: { x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] }, distance: Math.min(this.camera.distance, 240) };
    this.draw();
  }

  ease() {
    const e = this.easing;
    const c = this.camera;
    const k = this.still ? 1 : 0.15;
    c.target = { x: c.target.x + (e.target.x - c.target.x) * k, y: c.target.y + (e.target.y - c.target.y) * k, z: c.target.z + (e.target.z - c.target.z) * k };
    c.distance += (e.distance - c.distance) * k;
    const off = Math.hypot(e.target.x - c.target.x, e.target.y - c.target.y, e.target.z - c.target.z);
    if (off < 0.5 && Math.abs(e.distance - c.distance) < 0.5) {
      this.easing = null;
      return false;
    }
    return true;
  }

  renderFrame() {
    const n = this.graph.nodes.length;
    const pos = this.runner.positions;
    if (this.uploaded !== this.runner.version) {
      this.renderer.setPositions(pos);
      this.uploaded = this.runner.version;
    }
    const spots = (this.spots = projectInto(this.camera, pos, n, this.w, this.h, this.spots));
    this.updateHover();
    const t = this.theme;
    const lit = this.lit();
    this.renderer.draw({
      camera: this.camera,
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      near: spots.near,
      far: spots.far,
      spots,
      ground: t.groundRgb,
      groundCss: t.ground,
      line: t.lineRgb,
      lineCss: t.line,
      accent: t.accentRgb,
      accentCss: t.accent,
      paletteCss: this.palette.css,
      lineStrength: (lit ? 0.35 : 1) * this.options.lines,
    });
    this.drawNames(spots, lit);
  }

  nameOf(i) {
    const name = this.graph.nodes[i].name;
    return name.length > 40 ? `${name.slice(0, 39)}…` : name;
  }

  /** Names: always the lit, picked and open notes'; then their neighbours', then the notes drawn biggest, as many as the setting asks for and fit. */
  drawNames(spots, lit) {
    const ctx = this.ink;
    if (!ctx) return;
    const nodes = this.graph.nodes;
    const n = nodes.length;
    const open = this.current();
    const always = new Set();
    if (lit) always.add(lit.focus);
    if (this.picked >= 0) always.add(this.picked);
    if (open >= 0) always.add(open);
    const order = [...always];
    const seen = new Set(always);
    if (lit) {
      [...lit].filter((i) => !seen.has(i)).sort((a, b) => nodes[b].degree - nodes[a].degree).forEach((i) => {
        seen.add(i);
        order.push(i);
      });
    }
    const want = this.options.names;
    if (want > 0) {
      const smallest = 14 - 12 * want;
      const big = [];
      for (let i = 0; i < n; i++) {
        const s = spots.scale[i];
        if (s && !seen.has(i) && this.sizes[i] * s >= smallest) big.push(i);
      }
      big.sort((a, b) => this.sizes[b] * spots.scale[b] - this.sizes[a] * spots.scale[a]);
      const most = Math.round(20 + 280 * want);
      for (let k = 0; k < big.length && k < most; k++) order.push(big[k]);
    }
    const t = this.theme;
    ctx.font = t.font;
    const width = (i) => {
      const text = this.nameOf(i);
      let w = this.widths.get(text);
      if (w === undefined) {
        w = ctx.measureText(text).width;
        this.widths.set(text, w);
      }
      return w;
    };
    const radius = (i) => Math.max(this.sizes[i] * spots.scale[i], 1.2);
    const names = placeNames(order, spots, width, radius, this.lineHeight, this.w, this.h, always);
    const span = Math.max(spots.far - spots.near, 1);
    const rings = [];
    if (open >= 0) rings.push({ i: open, width: 2 });
    if (this.picked >= 0 && this.picked !== open) rings.push({ i: this.picked, width: 1.5 });
    drawOverlay(ctx, {
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      spots,
      radius,
      rings,
      names,
      text: (i) => this.nameOf(i),
      alpha: (i) => (lit && !lit.has(i) ? 0.45 : 1) * Math.max(0.5, 1 - (0.65 * (spots.depth[i] - spots.near)) / span),
      focus: lit ? lit.focus : -1,
      font: t.font,
      accent: t.accent,
      textColour: t.text,
      ground: t.ground,
    });
  }
}

/**
 * The 3D graph: a view of its own, opened by a command, on every note or
 * what's around one; and a switch in the header of every graph tab, 2D
 * or 3D, that turns that tab into the other, what it shows carried over.
 */
export class Graph3D extends Feature {
  constructor(plugin) {
    super(plugin);
    // Where notes were the last time a 3D graph drew them, by id: a tab opened again starts there.
    this.positions = new Map();
    // How the last 3D graph was set, and turned: the next starts so.
    this.lastOptions = null;
    this.lastCamera = null;
  }

  actions() {
    return [
      { id: 'open-graph-3d', name: 'Open 3D graph', icon: 'rotate-3d', run: () => this.open() },
      { id: 'open-graph-3d-local', name: 'Open 3D graph around this note', icon: 'git-fork', on: 'note', menu: false, when: (ctx) => !!ctx.file, run: (ctx) => this.open(ctx.file.path) },
      { id: 'toggle-graph-3d', name: 'Switch the graph between 2D and 3D', icon: 'box', when: () => !!this.graphKind(this.app.workspace.activeLeaf), run: () => this.flip(this.app.workspace.activeLeaf) },
    ];
  }

  /** What a tab's graph is — 'graph', 'localgraph' or the 3D graph's type — or null for anything else. */
  graphKind(leaf) {
    if (!leaf || leaf.isDeferred || !leaf.view || typeof leaf.view.getViewType !== 'function') return null;
    const type = leaf.view.getViewType();
    return type === GRAPH_3D_VIEW || GRAPH_TYPES.indexOf(type) !== -1 ? type : null;
  }

  /** Show in 3D, in the header of each 2D graph tab: placed once, again if Obsidian drew the header anew. */
  sync() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const kind = this.graphKind(leaf);
      if (!kind || kind === GRAPH_3D_VIEW) return;
      const view = leaf.view;
      if (view.drGraph3dSwitch && view.drGraph3dSwitch.isConnected) return;
      if (typeof view.addAction !== 'function') return;
      const button = view.addAction('box', 'Show in 3D', () => this.flip(leaf));
      if (!button) return;
      button.addClass('dr-graph3d-switch');
      view.drGraph3dSwitch = button;
    });
  }

  remember(view) {
    this.lastOptions = Object.assign({}, view.options);
    this.lastCamera = view.camera.toJSON();
  }

  /**
   * A graph tab turned into the other kind, in its place: a 2D graph (or
   * a local one) into the 3D graph, set as the last one was, with what
   * the 2D graph shows; the 3D graph back into the graph, or the local
   * graph of the note it was round.
   */
  async flip(leaf) {
    const kind = this.graphKind(leaf);
    if (!kind) return null;
    if (kind === GRAPH_3D_VIEW) {
      const view = leaf.view;
      this.remember(view);
      const root = view.options.local ? view.root || view.openPath() : '';
      const note = root && this.app.vault.getAbstractFileByPath(root) instanceof TFile;
      await leaf.setViewState({ type: note ? 'localgraph' : 'graph', active: true, state: note ? { file: root } : {} });
      return leaf;
    }
    const was = typeof leaf.getViewState === 'function' ? leaf.getViewState() : null;
    const s = (was && was.state) || {};
    const local = kind === 'localgraph';
    const state = { options: Object.assign({}, this.lastOptions || {}, filtersFromGraph(s.options), { local }) };
    if (local && typeof s.file === 'string') state.root = s.file;
    else if (!local && this.lastCamera) state.camera = this.lastCamera;
    await leaf.setViewState({ type: GRAPH_3D_VIEW, active: true, state });
    return leaf;
  }

  registerTypes() {
    this.plugin.registerView(GRAPH_3D_VIEW, (leaf) => new Graph3DView(leaf, this));
    if (typeof this.plugin.registerHoverLinkSource === 'function') this.plugin.registerHoverLinkSource(GRAPH_3D_VIEW, { display: '3D graph', defaultMod: true });
  }

  /** The 3D graph's tab, opened if there's none, and shown; round one note, if one is given. */
  async open(around) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(GRAPH_3D_VIEW)[0];
    if (!leaf) {
      leaf = ws.getLeaf('tab');
      await leaf.setViewState({ type: GRAPH_3D_VIEW, active: true, state: this.lastOptions ? { options: this.lastOptions } : {} });
    }
    ws.revealLeaf(leaf);
    if (around && leaf.view instanceof Graph3DView) leaf.view.showAround(around);
    return leaf;
  }
}
