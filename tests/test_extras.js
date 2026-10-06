// The small things that take friction out of daily use, against the real
// main.js: typing to jump in a list and Space to preview, the first image
// as a cover, a note dropped on an album in the library, an image dropped
// on a cover, and on a canvas: finding, focusing and duplicating.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.virtualConsole.removeAllListeners('jsdomError');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = (f) => setTimeout(f, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

const P = dom.window.HTMLElement.prototype;
const apply = (el, o) => {
  if (!o) return el;
  if (typeof o === 'string') { el.className = o; return el; }
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text !== undefined) el.textContent = o.text;
  if (o.type) el.setAttribute('type', o.type);
  return el;
};
P.createEl = function (tag, o) { return apply(this.appendChild(document.createElement(tag)), o); };
P.createDiv = function (o) { return this.createEl('div', o); };
P.createSpan = function (o) { return this.createEl('span', o); };
P.addClass = function (...c) { this.classList.add(...c); };
P.removeClass = function (...c) { this.classList.remove(...c); };
P.toggleClass = function (c, on) { this.classList.toggle(c, !!on); };
P.hasClass = function (c) { return this.classList.contains(c); };
P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };

class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = {};
    ['setIcon', 'setSection', 'setChecked'].forEach((m) => (item[m] = () => item));
    item.setTitle = (v) => { item.title = v; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
}
class TAbstractFile {}
class TFile extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p.split('/').pop(); this.extension = this.name.split('.').pop(); this.basename = this.name.replace(/\.[^.]+$/, ''); this.stat = { mtime: 0, ctime: 0 }; }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
const notices = [];
const obsidian = new Proxy({
  Menu, TFile, TFolder, TAbstractFile,
  Notice: class { constructor(m) { notices.push(m); } },
  setIcon: (el, name) => { el.dataset.icon = name; },
  Platform: { isMobile: false },
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_extras_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { noteCoverSrc, SidebarDrop, CoverDrop, CanvasDuplicate, CanvasFocus, CanvasFind };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const key = (el, k, extra = {}) => el.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));

const card = (id, x, y, w, h, extra) => Object.assign({ id, type: 'text', text: id, x, y, width: w, height: h }, extra);
const edge = (from, to, fromSide, toSide) => ({ id: `${from}-${to}`, fromNode: from, toNode: to, fromSide, toSide });

class FakeNode {
  constructor(canvas, data) {
    Object.assign(this, { id: data.id, x: data.x, y: data.y, width: data.width, height: data.height, color: data.color, unknownData: {}, isEditing: false, canvas });
    const extra = Object.keys(data).filter((k) => /^dr/.test(k));
    extra.forEach((k) => (this.unknownData[k] = data[k]));
    this.data = data;
    this.nodeEl = canvas.view.contentEl.createDiv({ cls: 'canvas-node' });
  }
  getData() { return Object.assign({}, this.data, this.unknownData, { x: this.x, y: this.y, width: this.width, height: this.height }); }
  moveAndResize(r) { Object.assign(this, r); }
  getBBox() { return { minX: this.x, minY: this.y, maxX: this.x + this.width, maxY: this.y + this.height }; }
}
const fakeCanvas = (data) => {
  const containerEl = document.createElement('div');
  document.body.appendChild(containerEl);
  const view = { containerEl, contentEl: containerEl.createDiv(), file: { path: 'Map.canvas', extension: 'canvas' } };
  const canvas = { view, nodes: new Map(), edges: new Map(), selection: new Set(), saves: 0 };
  canvas.requestSave = () => canvas.saves++;
  canvas.selectOnly = (n) => { canvas.selection = new Set([n]); };
  canvas.select = (n) => canvas.selection.add(n);
  view.canvas = canvas;
  const addEdge = (e) => {
    const g = containerEl.createDiv();
    canvas.edges.set(e.id, {
      id: e.id,
      from: { node: canvas.nodes.get(e.fromNode), side: e.fromSide, end: 'none' },
      to: { node: canvas.nodes.get(e.toNode), side: e.toSide, end: 'arrow' },
      lineGroupEl: g, lineEndGroupEl: g,
      getData: () => Object.assign({}, e),
    });
  };
  data.nodes.forEach((n) => canvas.nodes.set(n.id, new FakeNode(canvas, n)));
  data.edges.forEach(addEdge);
  canvas.getData = () => ({
    nodes: Array.from(canvas.nodes.values()).map((n) => n.getData()),
    edges: Array.from(canvas.edges.values()).map((e) => e.getData()),
  });
  canvas.importData = (more) => {
    (more.nodes || []).forEach((n) => canvas.nodes.set(n.id, new FakeNode(canvas, n)));
    (more.edges || []).forEach(addEdge);
  };
  return view;
};

(async () => {
  /* -- covers --------------------------------------------------------------- */

  await t('a note without a cover shows the first image in it, where the setting has it', () => {
    const note = new TFile('Notes/Trip.md');
    const image = new TFile('Pictures/view.png');
    const app = {
      metadataCache: {
        getFileCache: () => ({ embeds: [{ link: 'notes.pdf' }, { link: 'view.png' }] }),
        getFirstLinkpathDest: (link) => (link === 'view.png' ? image : link === 'notes.pdf' ? new TFile('notes.pdf') : null),
      },
      vault: { getResourcePath: (f) => `app://${f.path}` },
    };
    const plugin = { app, settings: { coverProperty: 'cover', coverFromFirstImage: false } };
    assert.strictEqual(R.noteCoverSrc(plugin, note), null, 'off by default');
    plugin.settings.coverFromFirstImage = true;
    assert.strictEqual(R.noteCoverSrc(plugin, note), 'app://Pictures/view.png');
  });

  await t('an image from the vault dropped on an album\'s cover becomes its folder note\'s cover', async () => {
    const image = new TFile('Pictures/view.png');
    const note = new TFile('Law/Law.md');
    const set = [];
    const plugin = {
      settings: { coverDrop: true },
      app: { dragManager: { draggable: { type: 'file', file: image } }, vault: { getFolderByPath: (p) => (p === 'Law' ? new TFolder('Law') : null) } },
      ensureFolderNote: async () => note,
      feature: () => ({ setCover: async (file, value) => set.push([file.path, value]), linkTo: (img) => `[[${img.name}]]` }),
    };
    const drop = new R.CoverDrop(plugin);
    const art = document.body.createDiv();
    art.dataset.coverFolder = 'Law';
    let prevented = false;
    await drop.onDrop({ target: art, dataTransfer: { files: [] }, preventDefault: () => (prevented = true), stopPropagation() {} });
    assert.ok(prevented);
    assert.deepStrictEqual(set, [['Law/Law.md', '[[view.png]]']]);
  });

  /* -- the library ------------------------------------------------------------- */

  await t('a track dropped on a folder in the library moves there, with an Undo', async () => {
    const file = new TFile('Law/Tort.md');
    const moves = [];
    const plugin = {
      settings: { sidebarDrop: true },
      app: {
        vault: {
          getFolderByPath: (p) => (p === 'Politics' ? new TFolder('Politics') : null),
          getAbstractFileByPath: (p) => (p === file.path ? file : null),
        },
      },
      moveFile: async (f, to, opts) => moves.push([f.path, to, opts]),
    };
    const drop = new R.SidebarDrop(plugin);
    const row = document.body.createDiv({ cls: 'dr-lib-row' });
    row.dataset.path = 'Politics';
    const transfer = { types: ['text/dr-file'], getData: (type) => (type === 'text/dr-file' ? file.path : '') };
    const over = { target: row, dataTransfer: transfer, preventDefault() { this.prevented = true; } };
    drop.onDragOver(over);
    assert.ok(over.prevented && row.classList.contains('dr-drop-target'));
    await drop.onDrop({ target: row, dataTransfer: transfer, preventDefault() {}, stopPropagation() {} });
    assert.deepStrictEqual(moves, [['Law/Tort.md', 'Politics', { announce: true }]]);
    assert.ok(!row.classList.contains('dr-drop-target'));
    // A folder in Obsidian's file list takes a track from a list too — not its own drags, which it takes itself.
    const explorer = document.body.createDiv({ cls: 'nav-folder-title' });
    explorer.dataset.path = 'Politics';
    const fromList = { target: explorer, dataTransfer: transfer, preventDefault() { this.prevented = true; } };
    drop.onDragOver(fromList);
    assert.ok(fromList.prevented);
    plugin.app.dragManager = { draggable: { file } };
    const ownDrag = { target: explorer, dataTransfer: { types: [], getData: () => '' }, preventDefault() { this.prevented = true; } };
    drop.onDragOver(ownDrag);
    assert.ok(!ownDrag.prevented);
    // A note row isn't somewhere to drop.
    const noteRow = document.body.createDiv({ cls: 'dr-lib-row' });
    noteRow.dataset.path = 'Law/Tort.md';
    const onNote = { target: noteRow, dataTransfer: transfer, preventDefault() { this.prevented = true; } };
    drop.onDragOver(onNote);
    assert.ok(!onNote.prevented);
  });

  /* -- the canvas ---------------------------------------------------------------- */

  const plugin = (settings) => ({ settings, app: {}, feature: () => null });

  await t('Duplicate branch copies a card with what it leads to, arrows and folds included, beside it', () => {
    const view = fakeCanvas({
      nodes: [
        card('r', 0, 0, 100, 50),
        card('a', 200, 0, 100, 50),
        card('b', 200, 100, 100, 50),
        card('t', 200, 100, 100, 50, { drTuck: { by: 'b', dx: 200, dy: 0 } }),
        card('elsewhere', 0, 400, 100, 50),
      ],
      edges: [edge('r', 'a', 'right', 'left'), edge('r', 'b', 'right', 'left'), edge('b', 't', 'right', 'left'), edge('elsewhere', 'r', 'top', 'bottom')],
    });
    const dup = new R.CanvasDuplicate(plugin({ canvasDuplicate: true }));
    const c = view.canvas;
    const menu = new Menu();
    dup.addMenuItems(menu, [c.nodes.get('r')]);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Duplicate branch']);
    menu.items[0].click();
    assert.strictEqual(c.nodes.size, 9);
    const copies = Array.from(c.nodes.values()).slice(5);
    // Laid below the original, as its children line up down the page.
    assert.deepStrictEqual(copies.map((n) => [n.data.text, n.x, n.y]), [['r', 0, 230], ['a', 200, 230], ['b', 200, 330], ['t', 200, 330]]);
    const copyOf = (text) => copies.find((n) => n.data.text === text);
    assert.deepStrictEqual(copyOf('t').unknownData.drTuck, { by: copyOf('b').id, dx: 200, dy: 0 }, 'the copy is folded as the original');
    const copiedEdges = Array.from(c.edges.values()).slice(4).map((e) => [e.from.node.data.text, e.to.node.data.text]);
    assert.deepStrictEqual(copiedEdges, [['r', 'a'], ['r', 'b'], ['b', 't']], 'the arrow from outside stays with the original');
    assert.deepStrictEqual(Array.from(c.selection), [copyOf('r')]);
    assert.strictEqual(c.saves, 1);
  });

  await t('Focus on branch dims everything but a card and what its arrows lead to', () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50), card('x', 0, 300, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left'), edge('x', 'r', 'top', 'bottom')],
    });
    const focus = new R.CanvasFocus(plugin({ canvasFocus: true }));
    const state = { file: view.file };
    focus.watched.set(view, state);
    focus.mount(view, state);
    focus.setFocus(view, ['r']);
    const lit = (id) => view.canvas.nodes.get(id).nodeEl.classList.contains('dr-focus-lit');
    assert.ok(view.contentEl.classList.contains('dr-branch-focus'));
    assert.deepStrictEqual([lit('r'), lit('a'), lit('x')], [true, true, false]);
    assert.ok(view.canvas.edges.get('r-a').lineGroupEl.classList.contains('dr-focus-lit'));
    assert.ok(!view.canvas.edges.get('x-r').lineGroupEl.classList.contains('dr-focus-lit'));
    // Escape ends it.
    key(view.containerEl, 'Escape');
    assert.ok(!view.contentEl.classList.contains('dr-branch-focus'));
    assert.ok(!lit('r'));
  });

  await t('Find goes to a card tucked into a fold by opening the fold first', async () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50, { drTuck: { by: 'r', dx: 200, dy: 0 } })],
      edges: [edge('r', 'a', 'right', 'left')],
    });
    const opened = [];
    const fold = {
      foldBranches: async (v, nodes) => {
        opened.push(nodes[0].id);
        delete view.canvas.nodes.get('a').unknownData.drTuck;
      },
    };
    const find = new R.CanvasFind({ settings: { canvasFind: true }, app: {}, feature: () => fold });
    let zoomed = false;
    view.canvas.zoomToSelection = () => (zoomed = true);
    await find.goTo(view, 'a');
    assert.deepStrictEqual(opened, ['r']);
    assert.deepStrictEqual(Array.from(view.canvas.selection).map((n) => n.id), ['a']);
    assert.ok(zoomed);
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
