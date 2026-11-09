// The 3D graph: what it draws (notes, tags, attachments, notes not
// written yet; cut down by a search, to what's round a note, without
// orphans), the layout that spreads them — here and as the worker runs
// it — the camera that says where each lands, the names that fit, the
// WebGL renderer against a stand-in GL, and the view itself on a 2D
// canvas that counts what's drawn: it opens on the vault, settles,
// picks and opens on clicks, moves a dragged note, keeps where notes
// were as links change and when it's opened again, and keeps its
// settings with the tab.
const assert = require('assert');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { loadMain, elementHelpers } = require('./harness');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const win = dom.window;
global.window = win;
global.document = win.document;
global.HTMLElement = win.HTMLElement;
global.MutationObserver = win.MutationObserver;
global.navigator = win.navigator;
elementHelpers(win.HTMLElement.prototype);

// Frames and timers run when the suite says.
let frame = null;
let timers = [];
win.requestAnimationFrame = (cb) => { frame = cb; return 1; };
win.cancelAnimationFrame = () => { frame = null; };
win.setTimeout = (cb) => { timers.push(cb); return timers.length; };
win.clearTimeout = () => {};
win.matchMedia = () => ({ matches: false });
const frames = (n) => {
  let ran = 0;
  while (ran < n && frame) { const cb = frame; frame = null; cb(); ran++; }
  return ran;
};
const flush = () => { const run = timers; timers = []; run.forEach((cb) => cb()); };

// A 2D canvas that counts what each frame draws; no WebGL unless a test gives some.
let drawn = { arcs: 0, names: [] };
let gl = null;
const ink = () => {
  const noop = () => {};
  return {
    setTransform: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, fill: noop, strokeText: noop, clearRect: noop,
    fillRect: () => { drawn = { arcs: 0, names: [] }; },
    arc: () => { drawn.arcs++; },
    fillText: (t) => { drawn.names.push(t); },
    measureText: (t) => ({ width: t.length * 6 }),
  };
};
win.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') return this._ink || (this._ink = ink());
  return gl ? gl() : null;
};

class TFile {
  constructor(path) {
    this.path = path;
    this.name = path.split('/').pop();
    this.extension = this.name.split('.').pop();
    this.basename = this.name.replace(/\.[^.]+$/, '');
  }
}
class ItemView {
  constructor(leaf) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = document.createElement('div');
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
    document.body.appendChild(this.containerEl);
    Object.defineProperty(this.contentEl, 'clientWidth', { get: () => 800 });
    Object.defineProperty(this.contentEl, 'clientHeight', { get: () => 600 });
  }
  addAction(icon, title, cb) {
    const b = this.containerEl.createEl('button', { cls: 'view-action' });
    b.setAttribute('aria-label', title);
    b.addEventListener('click', cb);
    return b;
  }
  registerEvent() {}
  registerDomEvent(el, type, cb, opts) { el.addEventListener(type, cb, opts); }
}
// Settings rows: each control keeps its value and what it calls on a change.
class Setting {
  constructor(el) { this.el = el.createDiv({ cls: 'setting-item' }); }
  setName(n) { this.el.dataset.name = n; return this; }
  setDesc() { return this; }
  setClass(c) { this.el.addClass(c); return this; }
  control(cb, extra) {
    const c = Object.assign({ value: undefined, cb: null, setValue(v) { this.value = v; return this; }, getValue() { return this.value; }, onChange(fn) { this.cb = fn; return this; }, change(v) { this.value = v; this.cb(v); } }, extra);
    cb(c);
    return this;
  }
  addToggle(cb) { return this.control(cb); }
  addSearch(cb) { return this.control(cb, { setPlaceholder() { return this; }, inputEl: document.createElement('input') }); }
  addSlider(cb) { return this.control(cb, { setLimits() { return this; }, setDynamicTooltip() { return this; } }); }
  addDropdown(cb) { return this.control(cb, { addOption() { return this; } }); }
  addButton(cb) { return this.control(cb, { setButtonText() { return this; }, onClick(fn) { this.cb = fn; return this; } }); }
}
const menus = [];
class Menu {
  constructor() { this.items = []; menus.push(this); }
  addItem(fn) {
    const item = { setSection(s) { this.section = s; return this; }, setTitle(t) { this.title = t; return this; }, setIcon() { return this; }, onClick(f) { this.run = f; return this; } };
    fn(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent() { this.shown = true; }
  showAtPosition() { this.shown = true; }
}
const getAllTags = (cache) => cache.tags || null;
const setIcon = (el, name) => el.setAttribute('data-icon', name);
let copied = null;
Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true });
const obsidian = new Proxy({ ItemView, TFile, Setting, Menu, getAllTags, setIcon, Platform: { isMobile: false } }, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const G = loadMain(obsidian, 'graph3d');

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}\n${err.stack}`);
    process.exitCode = 1;
  }
};

const note = (path, links = {}, tags = [], missing = null) => ({ path, name: path.split('/').pop().replace(/\.md$/, ''), links, tags, missing });
const opts = (o) => Object.assign({}, G.GRAPH_3D_DEFAULTS, o);
const ids = (g) => g.nodes.map((n) => n.id).sort();
const pairs = (g) => {
  const out = [];
  for (let k = 0; k < g.links.length; k += 2) out.push([g.nodes[g.links[k]].id, g.nodes[g.links[k + 1]].id].sort().join(' – '));
  return out.sort();
};
const at = (pos, i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/* -- what's drawn --------------------------------------------------- */

const VAULT = () => [
  note('Work/Plan.md', { 'Work/Notes.md': 1, 'Ideas.md': 1, 'Work/chart.png': 1 }, ['#project']),
  note('Work/Notes.md', { 'Work/Plan.md': 1, 'Work/Notes.md': 3 }, ['#project', '#draft']),
  note('Home/List.md', { 'Ideas.md': 2 }, [], { Shopping: 1 }),
  note('Ideas.md'),
  note('Lonely.md'),
];
const FILES = [{ path: 'Work/chart.png', name: 'chart.png' }, { path: 'cat.jpg', name: 'cat.jpg' }];

test('a link counts once either way, a note’s link to itself not at all; attachments, tags and unwritten notes only when asked', () => {
  const plain = G.buildSpace(VAULT(), FILES, opts());
  assert.deepStrictEqual(ids(plain), ['Home/List.md', 'Ideas.md', 'Lonely.md', 'Work/Notes.md', 'Work/Plan.md']);
  assert.deepStrictEqual(pairs(plain), ['Home/List.md – Ideas.md', 'Ideas.md – Work/Plan.md', 'Work/Notes.md – Work/Plan.md']);
  const all = G.buildSpace(VAULT(), FILES, opts({ attachments: true, tags: true, missing: true }));
  assert.deepStrictEqual(ids(all).filter((id) => !id.endsWith('.md')), ['#draft', '#project', 'Work/chart.png', 'cat.jpg', 'missing:Shopping']);
  assert.ok(pairs(all).includes('Work/Plan.md – Work/chart.png'));
  assert.ok(pairs(all).includes('#project – Work/Notes.md') && pairs(all).includes('#project – Work/Plan.md'));
  assert.ok(pairs(all).includes('Home/List.md – missing:Shopping'));
  assert.strictEqual(all.nodes.find((n) => n.id === '#project').degree, 2);
});

test('a search keeps the notes it matches, every word, and the tags of those it keeps; orphans can be left out', () => {
  const g = G.buildSpace(VAULT(), FILES, opts({ search: 'work', tags: true }));
  assert.deepStrictEqual(ids(g), ['#draft', '#project', 'Work/Notes.md', 'Work/Plan.md']);
  assert.deepStrictEqual(ids(G.buildSpace(VAULT(), FILES, opts({ search: 'work draft' }))), ['Work/Notes.md'], 'every word must match: name, path or tag');
  assert.deepStrictEqual(ids(G.buildSpace(VAULT(), FILES, opts({ orphans: false }))), ['Home/List.md', 'Ideas.md', 'Work/Notes.md', 'Work/Plan.md']);
});

test('what’s around a note: as many steps out as asked, the note itself marked', () => {
  const one = G.buildSpace(VAULT(), FILES, opts({ local: true, depth: 1 }), 'Ideas.md');
  assert.deepStrictEqual(ids(one), ['Home/List.md', 'Ideas.md', 'Work/Plan.md']);
  assert.strictEqual(one.nodes[one.root].id, 'Ideas.md');
  assert.deepStrictEqual(ids(G.buildSpace(VAULT(), FILES, opts({ local: true, depth: 2 }), 'Ideas.md')), ['Home/List.md', 'Ideas.md', 'Work/Notes.md', 'Work/Plan.md']);
  assert.deepStrictEqual(ids(G.buildSpace(VAULT(), FILES, opts({ local: true, depth: 3, orphans: false }), 'Lonely.md')), ['Lonely.md'], 'the note itself is never an orphan');
  assert.strictEqual(G.buildSpace(VAULT(), FILES, opts({ local: true }), '').nodes.length, 0, 'no note open: nothing around it');
});

test('colours go by top folder or first tag, the commonest first; a tag called #tag is a tag like any other', () => {
  const vault = VAULT().concat([note('Work/Third.md', {}, ['#tag'])]);
  const byFolder = G.buildSpace(vault, FILES, opts({ attachments: true, colourBy: 'folder' }));
  assert.deepStrictEqual(G.colourGroups(byFolder.nodes, 8).map((g) => [g.key, g.count, g.slot]), [['Work', 3, 0], ['Home', 1, 1]]);
  const byTag = G.buildSpace(vault, FILES, opts({ colourBy: 'tag', tags: true }));
  assert.deepStrictEqual(G.colourGroups(byTag.nodes, 8).map((g) => g.key), ['#project', '#tag']);
  assert.strictEqual(byTag.nodes.find((n) => n.id === '#tag').key, G.KIND_KEYS.tag, 'the tag’s own node takes the tags’ colour');
  assert.strictEqual(G.colourGroups(byFolder.nodes, 1).map((g) => g.slot).join(), '0,0', 'more keys than colours: round again');
});

test('the mark changes when the notes or links do, not otherwise', () => {
  const a = G.spaceSignature(G.buildSpace(VAULT(), FILES, opts()));
  assert.strictEqual(G.spaceSignature(G.buildSpace(VAULT(), FILES, opts({ colourBy: 'tag' }))), a, 'colours aren’t notes or links');
  const more = VAULT();
  more[3].links = { 'Lonely.md': 1 };
  assert.notStrictEqual(G.spaceSignature(G.buildSpace(more, FILES, opts())), a);
});

test('colours are read from hex, rgb(), or what a canvas makes of anything else', () => {
  assert.deepStrictEqual(G.parseColour('#ff8000'), [1, 128 / 255, 0]);
  assert.deepStrictEqual(G.parseColour('#f80'), [1, 136 / 255, 0]);
  assert.deepStrictEqual(G.parseColour('rgba(0, 51, 255, 0.5)'), [0, 0.2, 1]);
  assert.deepStrictEqual(G.parseColour('hsl(0, 100%, 50%)', () => '#ff0000'), [1, 0, 0]);
  assert.deepStrictEqual(G.parseColour('nonsense'), [0.5, 0.5, 0.5]);
});

/* -- the layout ----------------------------------------------------- */

function twoClusters() {
  const notes = [];
  ['North', 'South'].forEach((side) => {
    for (let i = 0; i < 6; i++) {
      const links = {};
      for (let j = 0; j < i; j++) links[`${side}/${j}.md`] = 1;
      notes.push(note(`${side}/${i}.md`, links));
    }
  });
  return G.buildSpace(notes, [], opts());
}

function settle(graph, kernel, steps) {
  const k = kernel || G.layoutKernel();
  const { pos } = G.startPositions(graph.nodes, null);
  k.load(graph.nodes.length, graph.links, pos);
  const o = G.layoutOptions();
  let alpha = 1;
  const moves = [];
  for (let s = 0; s < (steps || 400) && alpha >= o.cold; s++) {
    moves.push(k.step(alpha, o));
    alpha *= 1 - o.cool;
  }
  return { k, moves, pos: k.positions() };
}

test('linked notes settle together, apart from notes they aren’t linked to, and the layout calms down', () => {
  const g = twoClusters();
  const { moves, pos } = settle(g);
  assert.ok(moves[moves.length - 1] < moves[0] / 20, `it calms down (${moves[0].toFixed(2)} → ${moves[moves.length - 1].toFixed(3)})`);
  const mid = (from) => [0, 1, 2].map((d) => [0, 1, 2, 3, 4, 5].reduce((s, i) => s + pos[(from + i) * 3 + d], 0) / 6);
  const north = mid(0);
  const south = mid(6);
  let within = 0;
  for (let i = 0; i < 12; i++) within = Math.max(within, dist(at(pos, i), i < 6 ? north : south));
  assert.ok(dist(north, south) > within * 1.5, 'the two clusters stand apart');
  for (let k = 0; k < g.links.length; k += 2) assert.ok(dist(at(pos, g.links[k]), at(pos, g.links[k + 1])) < 120, 'a link stays short');
});

test('a note held stays where it’s held while the rest move, and goes with them once let go', () => {
  const g = twoClusters();
  const k = G.layoutKernel();
  const { pos } = G.startPositions(g.nodes, null);
  k.load(g.nodes.length, g.links, pos);
  k.fix(0, 300, 0, 0);
  const o = G.layoutOptions();
  for (let s = 0; s < 50; s++) k.step(0.5, o);
  assert.deepStrictEqual(at(k.positions(), 0), [300, 0, 0]);
  k.release(0);
  for (let s = 0; s < 50; s++) k.step(0.5, o);
  assert.ok(at(k.positions(), 0)[0] < 300, 'let go, it’s pulled back to its links');
});

test('the forces follow the sliders: a longer link length spreads the notes', () => {
  const span = (scale) => {
    const g = twoClusters();
    const k = G.layoutKernel();
    k.load(g.nodes.length, g.links, G.startPositions(g.nodes, null).pos);
    const o = G.layoutOptions(scale);
    let a = 1;
    while (a >= o.cold) { k.step(a, o); a *= 1 - o.cool; }
    const p = k.positions();
    return dist(at(p, 0), at(p, 1));
  };
  assert.ok(span({ linkLength: 2.5 }) > span({ linkLength: 0.5 }) * 2);
});

test('ten thousand notes: a step in good time', () => {
  const notes = [];
  for (let i = 0; i < 10000; i++) notes.push(note(`n${i}.md`, { [`n${Math.floor(i / 3)}.md`]: 1, [`n${(i * 7919) % 10000}.md`]: 1 }));
  const g = G.buildSpace(notes, [], opts());
  const k = G.layoutKernel();
  k.load(g.nodes.length, g.links, G.startPositions(g.nodes, null).pos);
  const o = G.layoutOptions();
  k.step(1, o);
  const start = Date.now();
  for (let s = 0; s < 5; s++) k.step(1, o);
  const each = (Date.now() - start) / 5;
  assert.ok(each < 150, `a step takes ${each.toFixed(1)} ms`);
  assert.ok(Array.prototype.every.call(k.positions(), Number.isFinite));
});

test('notes start where they were; a new one beside a note it links to', () => {
  const g = G.buildSpace([note('A.md'), note('B.md'), note('C.md', { 'A.md': 1 })], [], opts());
  const before = new Map([['A.md', [500, 1, 2]], ['B.md', [-5, 6, 7]]]);
  const { pos, known } = G.startPositions(g.nodes, before);
  assert.strictEqual(known, 2);
  assert.deepStrictEqual(at(pos, 0), [500, 1, 2]);
  assert.ok(dist(at(pos, 2), [500, 1, 2]) <= 8.01, 'C starts beside A');
});

test('the worker’s code runs on its own, and sends back where the notes went', () => {
  const posted = [];
  const later = [];
  const sandbox = { Float32Array, Float64Array, Int32Array, Uint8Array, Math, Date, self: { postMessage: (m) => posted.push(m) }, setTimeout: (cb) => later.push(cb) };
  vm.runInNewContext(G.layoutWorkerSource(), sandbox);
  const g = twoClusters();
  const { pos } = G.startPositions(g.nodes, null);
  sandbox.self.onmessage({ data: { type: 'load', gen: 7, count: g.nodes.length, links: g.links, pos, opts: G.layoutOptions(), alpha: 1 } });
  while (later.length && posted.length < 200) later.shift()();
  assert.ok(posted.length > 0);
  const last = posted[posted.length - 1];
  assert.strictEqual(last.gen, 7);
  assert.strictEqual(last.pos.length, g.nodes.length * 3);
  assert.ok(last.alpha < 0.003, 'it ran till the layout was calm');
  assert.ok(Array.prototype.every.call(last.pos, Number.isFinite));
});

test('the runner, where there’s no worker, lays out here a few milliseconds at a time', () => {
  const r = new G.LayoutRunner(win, () => {});
  assert.strictEqual(r.worker, null);
  const g = twoClusters();
  r.load(g.nodes.length, g.links, G.startPositions(g.nodes, null).pos, 1);
  const v = r.version;
  assert.ok(r.pump(5) && r.version > v);
  while (r.hot) r.pump(50);
  assert.strictEqual(r.pump(5), false, 'calm: nothing to do');
  r.receive({ type: 'positions', gen: r.gen - 1, pos: new Float32Array(36), alpha: 1 });
  assert.ok(!r.hot, 'what a worker sent for an older graph is dropped');
});

/* -- the camera ----------------------------------------------------- */

test('what the camera looks at is the middle of the screen; right is right, behind is unseen', () => {
  const cam = new G.Camera();
  const { right, ahead } = cam.frame();
  const t = cam.target;
  const far = cam.distance + 50;
  const pos = Float32Array.from([t.x, t.y, t.z, t.x + right.x * 50, t.y + right.y * 50, t.z + right.z * 50, t.x - ahead.x * far, t.y - ahead.y * far, t.z - ahead.z * far]);
  const s = G.projectInto(cam, pos, 3, 800, 600);
  assert.ok(Math.abs(s.x[0] - 400) < 1e-3 && Math.abs(s.y[0] - 300) < 1e-3);
  assert.ok(s.x[1] > 400 && Math.abs(s.y[1] - 300) < 1e-3);
  assert.strictEqual(s.scale[2], 0);
});

test('fitting puts every note on the screen, however the camera’s turned', () => {
  const { pos } = settle(twoClusters(), null, 120);
  const p32 = Float32Array.from(pos);
  [0, 1.2, 2.5, -0.8].forEach((yaw) => {
    const cam = new G.Camera();
    cam.yaw = yaw;
    cam.pitch = yaw / 3;
    const aim = G.fitView(cam, p32, 12, 400, 700);
    cam.target = aim.target;
    cam.distance = aim.distance;
    const s = G.projectInto(cam, p32, 12, 400, 700);
    for (let i = 0; i < 12; i++) assert.ok(s.scale[i] && s.x[i] >= 0 && s.x[i] <= 400 && s.y[i] >= 0 && s.y[i] <= 700, `on screen at yaw ${yaw}`);
  });
});

test('a zoom keeps still what’s under the pointer', () => {
  const cam = new G.Camera();
  const { right, up } = cam.frame();
  const t = cam.target;
  const p = Float32Array.from([t.x + right.x * 60 + up.x * 30, t.y + right.y * 60 + up.y * 30, t.z + right.z * 60 + up.z * 30]);
  const before = G.projectInto(cam, p, 1, 800, 600);
  const x = before.x[0];
  const y = before.y[0];
  cam.zoomAt(0.5, x, y, 800, 600);
  const after = G.projectInto(cam, p, 1, 800, 600);
  assert.ok(Math.abs(after.x[0] - x) < 1e-2 && Math.abs(after.y[0] - y) < 1e-2);
  assert.ok(Math.abs(cam.distance - 200) < 1e-9);
});

test('the note under the pointer is the nearest of those there', () => {
  const spots = { n: 2, x: Float32Array.from([100, 101]), y: Float32Array.from([100, 100]), depth: Float32Array.from([300, 200]), scale: Float32Array.from([1, 1]) };
  const sizes = Float32Array.from([3, 3]);
  assert.strictEqual(G.hitNode(spots, sizes, 100, 100), 1);
  assert.strictEqual(G.hitNode(spots, sizes, 300, 300), -1);
  spots.scale[1] = 0;
  assert.strictEqual(G.hitNode(spots, sizes, 100, 100), 0, 'behind the camera: not there');
});

test('names that would cover one another are left out, but for those always named', () => {
  const spots = { n: 3, x: Float32Array.from([100, 104, 300]), y: Float32Array.from([100, 102, 100]), depth: new Float32Array(3), scale: Float32Array.from([1, 1, 1]) };
  const placed = (always) => G.placeNames([0, 1, 2], spots, () => 60, () => 3, 14, 800, 600, always).map((p) => p.i);
  assert.deepStrictEqual(placed(new Set()), [0, 2]);
  assert.deepStrictEqual(placed(new Set([1])), [0, 1, 2]);
});

test('WebGL’s matrix puts each note where the camera says it is', () => {
  const cam = new G.Camera();
  cam.yaw = 1.1;
  cam.pitch = -0.4;
  cam.target = { x: 10, y: -20, z: 5 };
  const p = [37, 12, -40];
  const m = G.cameraMatrix(cam, 800, 600, 1, 5000);
  const clip = [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
  const s = G.projectInto(cam, Float32Array.from(p), 1, 800, 600);
  assert.ok(Math.abs((clip[0] / clip[3] + 1) * 400 - s.x[0]) < 1e-2);
  assert.ok(Math.abs((1 - clip[1] / clip[3]) * 300 - s.y[0]) < 1e-2);
});

/* -- WebGL ----------------------------------------------------------- */

function fakeGL(calls) {
  const C = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, DYNAMIC_DRAW: 8, ALIASED_POINT_SIZE_RANGE: 9, COLOR_BUFFER_BIT: 16, DEPTH_BUFFER_BIT: 32, DEPTH_TEST: 10, LEQUAL: 11, BLEND: 12, FLOAT: 13, POINTS: 0, LINES: 1, UNSIGNED_SHORT: 14, UNSIGNED_INT: 15 };
  const noop = () => {};
  const g = Object.assign({}, C, {
    texStorage2D: noop,
    createShader: () => ({}), shaderSource: noop, compileShader: noop, getShaderParameter: () => true, deleteShader: noop,
    createProgram: () => ({}), attachShader: noop, linkProgram: noop, getProgramParameter: () => true, deleteProgram: noop,
    getExtension: () => null, createBuffer: () => ({}), deleteBuffer: noop, getParameter: () => [1, 256],
    getAttribLocation: (p, name) => ['a_pos', 'a_size', 'a_colour'].indexOf(name), getUniformLocation: (p, name) => name,
    bindBuffer: noop, bufferData: (t, data) => calls.push(['data', t, data.length]),
    viewport: noop, clearColor: noop, clearDepth: noop, clear: noop, enable: noop, depthFunc: noop, disable: noop, depthMask: noop,
    useProgram: noop, uniformMatrix4fv: noop, uniform3f: noop, uniform2f: noop, uniform1f: noop,
    enableVertexAttribArray: noop, disableVertexAttribArray: noop, vertexAttribPointer: noop,
    drawArrays: (mode, first, count) => calls.push(['points', count]),
    drawElements: (mode, count, type) => calls.push(['lines', count, type]),
  });
  return () => g;
}

test('WebGL: the notes as points, the links and the lit links as lines, from one buffer of positions', () => {
  const calls = [];
  gl = fakeGL(calls);
  try {
    const canvas = document.createElement('canvas');
    const r = G.GLRenderer.create(canvas);
    assert.ok(r && r.kind === 'webgl');
    const g = twoClusters();
    r.setGraph(g.nodes.length, g.links);
    r.setPositions(new Float32Array(g.nodes.length * 3));
    r.setStyle(new Float32Array(12).fill(3), new Uint8Array(12), new Float32Array(12).fill(1), [[1, 0, 0]]);
    r.setLit(Int32Array.from([0, 1, 0, 2]));
    calls.length = 0;
    r.draw({ camera: new G.Camera(), w: 800, h: 600, dpr: 2, near: 300, far: 500, ground: [1, 1, 1], line: [0.5, 0.5, 0.5], accent: [0, 0, 1], lineStrength: 0.5 });
    assert.deepStrictEqual(calls, [['points', 12], ['lines', g.links.length, 14], ['lines', 4, 14]]);
  } finally {
    gl = null;
  }
  assert.strictEqual(G.GLRenderer.create(document.createElement('canvas')), null, 'no WebGL: none');
});

/* -- the view --------------------------------------------------------- */

function vault(paths, links) {
  const files = paths.map((p) => new TFile(p));
  const opened = [];
  const triggered = [];
  const app = {
    vault: {
      getMarkdownFiles: () => files.filter((f) => f.extension === 'md'),
      getFiles: () => files.slice(),
      getRoot: () => ({ path: '/', children: [] }),
      getAbstractFileByPath: (p) => files.find((f) => f.path === p) || null,
      on: () => ({}),
    },
    metadataCache: { resolvedLinks: links, unresolvedLinks: {}, on: () => ({}), getFileCache: (f) => ({ tags: f.path.startsWith('Work/') ? ['#Project'] : null }) },
    workspace: {
      active: files[0],
      on: () => ({}),
      getActiveFile: () => app.workspace.active,
      getLeaf: (how) => ({ openFile: (f) => opened.push([f.path, how]) }),
      openLinkText: (text, from, how) => opened.push([`link:${text}`, how]),
      trigger: (...args) => triggered.push(args),
      requestSaveLayout: () => {},
      leaves: [],
      iterateAllLeaves: (fn) => app.workspace.leaves.forEach(fn),
    },
  };
  app.fileManager = { generateMarkdownLink: (f) => `[[${f.basename}]]` };
  const plugin = { app, isFolderNote: () => false, registerView: (type, make) => (plugin.views[type] = make), views: {} };
  return { app, plugin, files, opened, triggered };
}

function openView(paths, links, state, feature) {
  const v = feature ? Object.assign(vault(paths, links), { plugin: feature.plugin, app: feature.plugin.app }) : vault(paths, links);
  const f = feature || new G.Graph3D(v.plugin);
  f.registerTypes();
  const leaf = { app: v.app, states: [], setViewState(vs) { this.states.push(vs); return Promise.resolve(); } };
  const view = v.plugin.views[G.GRAPH_3D_VIEW](leaf);
  leaf.view = view;
  view.onOpen();
  if (state) view.setState(state, {});
  flush();
  return Object.assign(v, { view, feature: f });
}

const PATHS = ['Work/Plan.md', 'Work/Notes.md', 'Home/List.md', 'Ideas.md'];
const LINKS = () => ({ 'Work/Plan.md': { 'Work/Notes.md': 1, 'Ideas.md': 1 }, 'Home/List.md': { 'Ideas.md': 2 } });
const clickAt = (view, i, mods = {}) => {
  const x = view.spots.x[i];
  const y = view.spots.y[i];
  view.down(Object.assign({ pointerId: 1, offsetX: x, offsetY: y, button: 0, pointerType: 'mouse' }, mods));
  view.up(Object.assign({ pointerId: 1, offsetX: x, offsetY: y }, mods), false);
};

test('the commands and the view type are the feature’s', () => {
  const v = vault([], {});
  const f = new G.Graph3D(v.plugin);
  assert.deepStrictEqual(f.actions().map((a) => a.id), ['open-graph-3d', 'open-graph-3d-local', 'toggle-graph-3d']);
  f.registerTypes();
  assert.ok(v.plugin.views['design-redux-graph-3d']);
});

test('it opens on the vault’s notes, draws each on a 2D canvas where there’s no WebGL, names them, and settles', () => {
  const { view } = openView(PATHS, LINKS());
  assert.strictEqual(view.renderer.kind, 'canvas');
  assert.strictEqual(view.graph.nodes.length, 4);
  frames(1);
  assert.ok(drawn.arcs >= 4 + 1, `every note drawn, and a ring round the open one (${drawn.arcs} arcs)`);
  frames(3000);
  assert.ok(!view.runner.hot && frame === null, 'the layout settles and the drawing stops');
  for (let i = 0; i < 4; i++) assert.ok(view.spots.scale[i] && view.spots.x[i] >= 0 && view.spots.x[i] <= 800 && view.spots.y[i] >= 0 && view.spots.y[i] <= 600, 'the camera kept them in view');
  assert.ok(view.empty.hidden);
});

test('a click picks a note and lights its links; a click on it again opens it, Ctrl-click in a new tab', () => {
  const { view, opened } = openView(PATHS, LINKS());
  frames(3000);
  const i = view.at.get('Ideas.md');
  clickAt(view, i);
  assert.strictEqual(view.picked, i);
  assert.ok(!view.detail.hidden);
  assert.strictEqual(view.detail.querySelector('.dr-graph3d-name').textContent, 'Ideas');
  assert.match(view.detail.textContent, /click it again/);
  assert.ok(view.easing, 'the camera turns to it');
  assert.deepStrictEqual([...view.lit()].sort(), [i, view.at.get('Work/Plan.md'), view.at.get('Home/List.md')].sort());
  assert.strictEqual(view.renderer.lit.length, 4, 'its two links lit');
  assert.deepStrictEqual(opened, []);
  clickAt(view, i);
  assert.deepStrictEqual(opened, [['Ideas.md', false]]);
  clickAt(view, i, { ctrlKey: true });
  assert.deepStrictEqual(opened[1], ['Ideas.md', 'tab']);
  view.key({ key: 'Escape', preventDefault() {} });
  assert.strictEqual(view.picked, -1);
});

test('a drag on the background turns the graph; a drag on a note moves the note', () => {
  const { view } = openView(PATHS, LINKS());
  frames(3000);
  const yaw = view.camera.yaw;
  view.down({ pointerId: 1, offsetX: 3, offsetY: 3, button: 0, pointerType: 'mouse' });
  view.move({ pointerId: 1, offsetX: 63, offsetY: 3 });
  view.up({ pointerId: 1, offsetX: 63, offsetY: 3 }, false);
  assert.notStrictEqual(view.camera.yaw, yaw);
  assert.strictEqual(view.picked, -1);
  frames(1);
  const i = view.at.get('Home/List.md');
  const from = [view.spots.x[i], view.spots.y[i]];
  view.down({ pointerId: 2, offsetX: from[0], offsetY: from[1], button: 0, pointerType: 'mouse' });
  view.move({ pointerId: 2, offsetX: from[0] + 40, offsetY: from[1] });
  view.move({ pointerId: 2, offsetX: from[0] + 80, offsetY: from[1] });
  assert.strictEqual(view.held, i);
  frames(1);
  assert.ok(Math.abs(view.spots.x[i] - (from[0] + 80)) < 1 && Math.abs(view.spots.y[i] - from[1]) < 1, 'the note is where the pointer is');
  view.up({ pointerId: 2, offsetX: from[0] + 80, offsetY: from[1] }, false);
  assert.strictEqual(view.held, -1);
  assert.strictEqual(view.picked, -1, 'a drag isn’t a click');
});

test('a note’s menu: open it three ways, centre on it, what’s around it, and Obsidian’s own file menu', () => {
  const { view, triggered } = openView(PATHS, LINKS());
  frames(3000);
  menus.length = 0;
  view.menuAt(view.at.get('Ideas.md'), {});
  const m = menus[0];
  assert.deepStrictEqual(m.items.map((it) => [it.section, it.title]), [['open', 'Open'], ['open', 'Open in new tab'], ['open', 'Open to the right'], ['view', 'Centre on it'], ['view', 'Show what’s around it']]);
  assert.ok(m.shown);
  assert.ok(triggered.some((t) => t[0] === 'file-menu' && t[2].path === 'Ideas.md'));
  m.items[4].run();
  flush();
  assert.ok(view.options.local);
  assert.deepStrictEqual(view.graph.nodes.map((n) => n.id).sort(), ['Home/List.md', 'Ideas.md', 'Work/Notes.md', 'Work/Plan.md'], 'two steps out from Ideas: everything');
  assert.strictEqual(view.graph.nodes[view.graph.root].id, 'Ideas.md');
});

test('settings: a search narrows the graph; colouring by tag recolours without laying out again; forces reach the layout', () => {
  const { view } = openView(PATHS, LINKS());
  frames(3000);
  const where = view.positionsById();
  view.controls.search.change('work');
  flush();
  assert.deepStrictEqual(view.graph.nodes.map((n) => n.id).sort(), ['Work/Notes.md', 'Work/Plan.md']);
  view.controls.search.change('');
  flush();
  const sign = view.sign;
  view.controls.colourBy.change('tag');
  flush();
  assert.strictEqual(view.sign, sign, 'same notes and links');
  assert.strictEqual(view.graph.nodes[view.at.get('Work/Plan.md')].key, '#project');
  assert.notStrictEqual(view.slots[view.at.get('Work/Plan.md')], view.slots[view.at.get('Ideas.md')]);
  view.controls.repel.change(3);
  assert.strictEqual(view.runner.opts.repel, G.LAYOUT.repel * 3);
  assert.ok(view.runner.hot, 'warmed to show it');
  assert.ok(where.size >= 4);
});

test('the tab keeps its settings and camera, and a graph opened again starts where the notes were', () => {
  const first = openView(PATHS, LINKS());
  frames(3000);
  first.view.controls.names.change(0.9);
  first.view.camera.yaw = 2;
  const state = first.view.getState();
  const before = first.view.positionsById();
  first.view.onClose();
  const again = openView(PATHS, LINKS(), state, first.feature);
  assert.strictEqual(again.view.options.names, 0.9);
  assert.strictEqual(again.view.camera.yaw, 2);
  assert.strictEqual(again.view.controls.names.value, 0.9);
  const now = again.view.positionsById();
  ['Work/Plan.md', 'Ideas.md'].forEach((id) => assert.ok(dist(now.get(id), before.get(id)) < 1e-3, `${id} where it was`));
  assert.ok(again.view.runner.alpha <= 0.05 + 1e-9, 'barely warmed: nothing to lay out');
});

test('as links change, notes keep their places, and the picked note stays picked', () => {
  const { view, app, files } = openView(PATHS, LINKS());
  frames(3000);
  view.pick(view.at.get('Home/List.md'));
  const was = view.positionsById();
  app.metadataCache.resolvedLinks = Object.assign(LINKS(), { 'Ideas.md': { 'Work/Notes.md': 1 } });
  files.push(new TFile('Home/New.md'));
  view.build();
  assert.strictEqual(view.graph.nodes.length, 5);
  assert.strictEqual(view.graph.links.length / 2, 4);
  PATHS.forEach((p) => assert.ok(dist(view.positionsById().get(p), was.get(p)) < 1e-3, `${p} kept its place`));
  assert.strictEqual(view.graph.nodes[view.picked].id, 'Home/List.md');
  assert.ok(view.runner.alpha > 0.003 && view.runner.alpha <= 0.3 + 1e-9, 'warmed a little, not started again');
});

test('the view on WebGL: draws through it, the same notes', () => {
  const calls = [];
  gl = fakeGL(calls);
  try {
    const { view } = openView(PATHS, LINKS());
    assert.strictEqual(view.renderer.kind, 'webgl');
    calls.length = 0;
    frames(1);
    assert.ok(calls.some((c) => c[0] === 'points' && c[1] === 4));
    assert.ok(calls.some((c) => c[0] === 'lines' && c[1] === 6));
    view.onClose();
  } finally {
    gl = null;
  }
});

/* -- 2D and 3D, from the graph's own tab ------------------------------- */

test('what a 2D graph shows comes over to the 3D graph, as far as it can be read', () => {
  assert.deepStrictEqual(G.filtersFromGraph({ search: 'plan ', showTags: true, showAttachments: false, hideUnresolved: true, showOrphans: false, localJumps: 9 }), { search: 'plan', tags: true, attachments: false, missing: false, orphans: false, depth: 5 });
  assert.deepStrictEqual(G.filtersFromGraph({ search: 'path:Work -tag:#x', localJumps: 0 }), {}, 'a query in Obsidian’s own terms stays behind');
  assert.deepStrictEqual(G.filtersFromGraph(null), {});
});

function graphLeaf(type, state) {
  const header = document.createElement('div');
  return {
    isDeferred: false,
    states: [],
    view: {
      getViewType: () => type,
      addAction(icon, title, cb) {
        const b = header.createEl('button', { cls: 'view-action' });
        b.setAttribute('aria-label', title);
        b.addEventListener('click', cb);
        document.body.appendChild(header);
        return b;
      },
    },
    header,
    getViewState: () => ({ type, state }),
    setViewState(vs) { this.states.push(vs); return Promise.resolve(); },
  };
}

test('a graph tab gets Show in 3D in its header, once; it turns that tab into the 3D graph, what it shows carried over', () => {
  const v = vault(PATHS, LINKS());
  const f = new G.Graph3D(v.plugin);
  const local = graphLeaf('localgraph', { file: 'Ideas.md', options: { showTags: true, localJumps: 3, search: 'path:x' } });
  const whole = graphLeaf('graph', {});
  v.app.workspace.leaves = [local, whole, { view: { getViewType: () => 'markdown' } }];
  f.sync();
  f.sync();
  assert.strictEqual(local.header.querySelectorAll('[aria-label="Show in 3D"]').length, 1);
  assert.strictEqual(whole.header.querySelectorAll('[aria-label="Show in 3D"]').length, 1);
  local.header.querySelector('[aria-label="Show in 3D"]').click();
  const to3d = local.states[0];
  assert.strictEqual(to3d.type, G.GRAPH_3D_VIEW);
  assert.deepStrictEqual([to3d.state.options.local, to3d.state.options.tags, to3d.state.options.depth, to3d.state.root], [true, true, 3, 'Ideas.md']);
  assert.ok(!('search' in to3d.state.options));
  v.app.workspace.activeLeaf = whole;
  const cmd = f.actions().find((a) => a.id === 'toggle-graph-3d');
  assert.ok(cmd.when());
  cmd.run();
  assert.deepStrictEqual([whole.states[0].type, whole.states[0].state.options.local], [G.GRAPH_3D_VIEW, false]);
  v.app.workspace.activeLeaf = v.app.workspace.leaves[2];
  assert.ok(!cmd.when(), 'not a graph: nothing to switch');
});

test('the 3D graph’s Show in 2D turns its tab back: the local graph of the note it was round, or the whole graph; set as it was when it comes back', () => {
  const { view, feature } = openView(PATHS, LINKS());
  frames(3000);
  view.showAround('Ideas.md');
  flush();
  view.controls.names.change(0.8);
  view.containerEl.querySelector('[aria-label="Show in 2D"]').click();
  assert.deepStrictEqual(view.leaf.states[0], { type: 'localgraph', active: true, state: { file: 'Ideas.md' } });
  assert.strictEqual(feature.lastOptions.names, 0.8);
  view.setOption('local', false);
  feature.flip(view.leaf);
  assert.deepStrictEqual(view.leaf.states[1], { type: 'graph', active: true, state: {} });
  view.showAround('#project');
  feature.flip(view.leaf);
  assert.strictEqual(view.leaf.states[2].type, 'graph', 'round a tag: there’s no local graph of a tag, so the whole graph');
  const back = graphLeaf('graph', {});
  feature.flip(back);
  assert.strictEqual(back.states[0].state.options.names, 0.8, 'the 3D graph comes back set as it was');
  assert.ok(back.states[0].state.camera, 'and turned as it was');
});

/* -- communities, folders, the HUD ---------------------------------------- */

function bridged() {
  // Two tight groups of four, one link between them.
  const notes = [];
  ['A', 'B'].forEach((side) => {
    for (let i = 0; i < 4; i++) {
      const links = {};
      for (let j = 0; j < i; j++) links[`${side}/${side}${j}.md`] = 1;
      if (side === 'B' && i === 0) links['A/A0.md'] = 1;
      notes.push(note(`${side}/${side}${i}.md`, links));
    }
  });
  notes.push(note('Alone.md'));
  return notes;
}

test('communities: notes tightly linked share one, named by its most-linked note; a note linked to nothing has none', () => {
  const g = G.buildSpace(bridged(), [], opts({ colourBy: 'community' }));
  const key = (id) => g.nodes.find((n) => n.id === id).key;
  assert.strictEqual(key('A/A1.md'), key('A/A3.md'));
  assert.strictEqual(key('B/B1.md'), key('B/B3.md'));
  assert.notStrictEqual(key('A/A1.md'), key('B/B1.md'));
  assert.strictEqual(key('Alone.md'), '');
  assert.strictEqual(G.groupName(g, key('A/A1.md')), 'A0', 'A0 has the most links, the bridge among them');
  assert.strictEqual(G.groupName(g, ''), 'Vault');
  const again = G.buildSpace(bridged(), [], opts({ colourBy: 'community' }));
  assert.deepStrictEqual(again.nodes.map((n) => n.key), g.nodes.map((n) => n.key), 'the same graph, the same communities');
});

test('a top folder hidden leaves its notes and their tags out', () => {
  const g = G.buildSpace(VAULT(), FILES, opts({ hidden: ['Work'], tags: true }));
  assert.deepStrictEqual(ids(g), ['Home/List.md', 'Ideas.md', 'Lonely.md']);
  assert.deepStrictEqual(ids(G.buildSpace(VAULT(), FILES, opts({ hidden: [''] }))), ['Home/List.md', 'Work/Notes.md', 'Work/Plan.md'], "'' is the vault's root");
});

test('each community its own hue, a golden angle on; brighter on a dark background', () => {
  const hues = [0, 1, 2, 3].map((k) => G.groupColour(k, false).css);
  assert.strictEqual(new Set(hues).size, 4);
  const lum = (c) => 0.2126 * c.rgb[0] + 0.7152 * c.rgb[1] + 0.0722 * c.rgb[2];
  assert.ok(lum(G.groupColour(2, true)) > lum(G.groupColour(2, false)));
  assert.match(G.groupColour(0, true).css, /^rgb\(\d+, \d+, \d+\)$/);
});

test('grouping pulls each community to its anchor', () => {
  const g = G.buildSpace(bridged(), [], opts());
  const k = G.layoutKernel();
  k.load(g.nodes.length, g.links, G.startPositions(g.nodes, null).pos);
  const anchors = new Float64Array(g.nodes.length * 3).fill(NaN);
  g.nodes.forEach((n, i) => {
    if (n.id.startsWith('A/')) anchors.set([300, 0, 0], i * 3);
    if (n.id.startsWith('B/')) anchors.set([-300, 0, 0], i * 3);
  });
  k.anchor(anchors);
  const o = G.layoutOptions({ group: true });
  let a = 1;
  while (a >= o.cold) { k.step(a, o); a *= 1 - o.cool; }
  const p = k.positions();
  const mean = (prefix) => g.nodes.reduce((s, n, i) => (n.id.startsWith(prefix) ? s + p[i * 3] / 4 : s), 0);
  assert.ok(mean('A/') > 150 && mean('B/') < -150, `A at ${mean('A/').toFixed(0)}, B at ${mean('B/').toFixed(0)}`);
});

function hudView(state) {
  const paths = bridged().map((n) => n.path);
  const links = {};
  bridged().forEach((n) => (links[n.path] = n.links));
  const v = openView(paths, links, state);
  frames(3000);
  return v;
}

test('what’s picked: its links, the ways they run, each a step to that note; Open, Copy link', () => {
  const { view, opened } = hudView();
  view.pick(view.at.get('B/B0.md'));
  const sections = [...view.detail.querySelectorAll('.dr-graph3d-rel')].map((s) => [s.querySelector('.dr-graph3d-heading').firstChild.textContent, [...s.querySelectorAll('.dr-graph3d-step-name')].map((e) => e.textContent).sort()]);
  assert.deepStrictEqual(sections, [['Links to', ['A0']], ['Linked from', ['B1', 'B2', 'B3']]]);
  view.detail.querySelector('.dr-graph3d-step').click();
  assert.strictEqual(view.graph.nodes[view.picked].id, 'A/A0.md');
  view.detail.querySelector('[data-act="open"]').click();
  assert.deepStrictEqual(opened.pop(), ['A/A0.md', false]);
  view.detail.querySelector('[data-act="tab"]').click();
  assert.deepStrictEqual(opened.pop(), ['A/A0.md', 'tab']);
  view.detail.querySelector('[data-act="copy"]').click();
  assert.strictEqual(copied, '[[A0]]');
  view.detail.querySelector('[data-group]').click();
  assert.ok(view.focusKey, 'its community, a click away');
  view.detail.querySelector('[data-act="close"]').click();
  assert.ok(view.detail.hidden);
});

test('shut, the settings are a gear and the turn, as the graph’s own; links, names and grouping still answer their settings', () => {
  const { view } = hudView();
  const side = (key) => view.sideButtons[key];
  assert.deepStrictEqual([...view.hud.querySelectorAll('.dr-graph3d-side-button')].map((b) => b.dataset.icon), ['settings', 'rotate-3d']);
  side('panel').click();
  assert.ok(!view.panel.hidden && side('panel').hasClass('is-active'));
  side('panel').click();
  assert.ok(view.panel.hidden);
  side('spin').click();
  assert.ok(view.options.spin && side('spin').hasClass('is-active'));
  side('spin').click();
  let strength = null;
  const draw = view.renderer.draw.bind(view.renderer);
  view.renderer.draw = (f) => { strength = f.lineStrength; draw(f); };
  view.setOption('links', false);
  frames(1);
  assert.strictEqual(strength, 0);
  view.app.workspace.active = null;
  view.controls.names.change(0);
  frames(1);
  assert.deepStrictEqual(drawn.names, [], 'nothing picked, names at nothing: no names');
  view.setOption('group', true);
  assert.ok(view.runner.anchors && view.runner.hot, 'pulled apart by community');
  view.setOption('group', false);
  assert.strictEqual(view.runner.anchors, null);
});

test('the tip names what’s under the pointer: name, where, community and links', () => {
  const { view } = hudView();
  const i = view.at.get('A/A0.md');
  view.pointer = { x: view.spots.x[i], y: view.spots.y[i], evt: {} };
  view.updateHover();
  assert.ok(!view.tip.hidden);
  assert.match(view.tip.textContent, /^A0A\/A0\.mdA0 · 4 links$/);
  view.left();
  assert.ok(view.tip.hidden);
});

/* -- what keeps it quick ------------------------------------------------- */

function sparseVault(n, seed) {
  // Power-law-ish, as vaults are: a few hubs, many notes linked to one or two.
  let s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const notes = [];
  for (let i = 0; i < n; i++) notes.push(note(`F/n${i}.md`));
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(-Math.log(1 - r() * 0.999) * 1.5);
    for (let j = 0; j < k; j++) {
      const t = Math.floor(Math.pow(r(), 2.2) * n);
      if (t !== i) notes[i].links[`F/n${t}.md`] = 1;
    }
  }
  return notes;
}

test('a sparse vault’s communities: no crumbs, none swallowing the rest', () => {
  const g = G.buildSpace(sparseVault(1000, 7), [], opts({ colourBy: 'community' }));
  const groups = G.colourGroups(g.nodes, Infinity);
  const smallest = Math.round(Math.sqrt(1000) / 2);
  assert.ok(groups.length >= 10 && groups.length <= 100, `${groups.length} communities`);
  assert.ok(groups[0].count < 1000 * 0.25, `the biggest has ${groups[0].count}`);
  assert.ok(groups.every((x) => x.count >= smallest), 'each at least √n⁄2 notes');
});

test('the input mark: the same notes, links, tags and settings, the same mark; any of them changed, another', () => {
  const mark = (v, o, root) => G.inputSignature(v, FILES, opts(o), root);
  const a = mark(VAULT(), {});
  assert.strictEqual(mark(VAULT(), {}), a);
  const linked = VAULT();
  linked[4].links = { 'Ideas.md': 1 };
  assert.notStrictEqual(mark(linked, {}), a);
  const tagged = VAULT();
  tagged[3].tags = ['#new'];
  assert.notStrictEqual(mark(tagged, {}), a);
  assert.notStrictEqual(mark(VAULT(), { colourBy: 'tag' }), a);
  assert.notStrictEqual(mark(VAULT(), { hidden: ['Work'] }), a);
  assert.notStrictEqual(mark(VAULT(), { local: true }, 'Ideas.md'), mark(VAULT(), { local: true }, 'Home/List.md'));
});

test('links resolved but nothing changed: the graph isn’t worked out again, nor its list redrawn', () => {
  const { view, app } = openView(PATHS, LINKS());
  frames(3000);
  let restyled = 0;
  let listed = 0;
  const restyle = view.restyle.bind(view);
  const list = view.renderGroupList.bind(view);
  view.restyle = () => { restyled++; restyle(); };
  view.renderGroupList = () => { listed++; list(); };
  view.build();
  view.build();
  assert.deepStrictEqual([restyled, listed], [0, 0]);
  app.metadataCache.resolvedLinks = Object.assign(LINKS(), { 'Ideas.md': { 'Work/Notes.md': 1 } });
  view.build();
  assert.strictEqual(restyled, 1, 'a link changed: worked out again');
  const before = listed;
  view.controls.nodeSize.change(1.5);
  assert.strictEqual(restyled, 2, 'sizes changed: restyled');
  assert.strictEqual(listed, before, 'the groups didn’t: the list stays as it was');
});

test('the layout cools faster once the notes barely move: fewer steps, as calm', () => {
  const g = G.buildSpace(sparseVault(600, 3), [], opts());
  const r = new G.LayoutRunner(win, () => {});
  r.load(g.nodes.length, g.links, G.startPositions(g.nodes, null).pos, 1);
  while (r.hot) r.pump(1e9);
  assert.ok(r.steps < 230, `${r.steps} steps (252 without)`);
  const k = G.layoutKernel();
  k.load(g.nodes.length, g.links, r.positions);
  assert.ok(k.step(G.LAYOUT.cold, G.layoutOptions()) < 0.05, 'and as still at the end');
});

test('pushing in the tree’s order gives the same layout as one note after another would', () => {
  // Two notes far from the rest and from each other: each pushed only by the clump, the same either way.
  const g = twoClusters();
  const a = G.layoutKernel();
  a.load(g.nodes.length, g.links, G.startPositions(g.nodes, null).pos);
  const o = G.layoutOptions();
  for (let s = 0; s < 5; s++) a.step(0.8, o);
  const p = a.positions();
  // Brute force: every pair, nothing taken as a clump (theta 0).
  const b = G.layoutKernel();
  b.load(g.nodes.length, g.links, G.startPositions(g.nodes, null).pos);
  const exact = Object.assign({}, o, { theta: 0 });
  for (let s = 0; s < 5; s++) b.step(0.8, exact);
  const q = b.positions();
  let off = 0;
  for (let k = 0; k < p.length; k++) off = Math.max(off, Math.abs(p[k] - q[k]));
  assert.ok(off < 2, `within ${off.toFixed(3)} of the exact sums`);
});

test('a hover reuses its arrays: nothing new made each time the pointer moves on', () => {
  const calls = [];
  gl = fakeGL(calls);
  try {
    const { view } = openView(PATHS, LINKS());
    frames(3000);
    view.hover = 0;
    view.lightChanged();
    const presence = view.presence;
    const colours = view.renderer.colourData;
    const lit = view.lit();
    assert.strictEqual(view.lit(), lit, 'what’s lit, worked out once a change');
    view.hover = 1;
    view.lightChanged();
    assert.strictEqual(view.presence, presence);
    assert.strictEqual(view.renderer.colourData, colours);
    assert.notStrictEqual(view.lit(), lit, 'and again when it changes');
    view.onClose();
  } finally {
    gl = null;
  }
});

test('settings back from the tab’s state reach the drawing, though the vault is as it was', () => {
  const { view } = openView(PATHS, LINKS());
  frames(3000);
  const size = view.sizes[0];
  view.setState({ options: Object.assign({}, view.options, { nodeSize: 2 }) }, {});
  flush();
  assert.ok(Math.abs(view.sizes[0] - size * 2) < 1e-4, `note size applied (${size} → ${view.sizes[0]})`);
});

test('links in their notes’ colours: on a 2D canvas, each in the colour of the note it starts from', () => {
  const canvas = document.createElement('canvas');
  const strokes = [];
  const ctx = Object.assign(ink(), { stroke() { strokes.push(this.strokeStyle); } });
  canvas.getContext = () => ctx;
  const r = new G.CanvasRenderer(canvas);
  r.setGraph(3, Int32Array.from([0, 1, 2, 1]));
  r.setStyle(new Float32Array([3, 3, 3]), Uint16Array.from([5, 6, 7]), new Float32Array([1, 1, 1]), []);
  const spots = { n: 3, x: Float32Array.from([10, 50, 90]), y: Float32Array.from([10, 50, 90]), depth: Float32Array.from([100, 100, 100]), scale: Float32Array.from([1, 1, 1]) };
  const paletteCss = ['grey', 'accent', 't', 'f', 'm', 'red', 'green', 'blue'];
  r.draw({ w: 100, h: 100, dpr: 1, near: 100, far: 101, spots, groundCss: 'black', lineCss: 'grey', accentCss: 'accent', paletteCss, lineStrength: 0.5 });
  assert.ok(strokes.includes('red') && strokes.includes('blue'), `strokes in ${strokes.join(', ')}`);
  assert.ok(!strokes.includes('grey'), 'none in the plain line colour');
});

console.log(`${passed} passed`);
