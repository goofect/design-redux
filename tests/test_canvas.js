// The canvas as a hierarchy, against the real main.js: arrows as parent
// and child, groups holding their cards, folds that tuck cards away and
// the room they leave closed up, tidy trees, and the outline.
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
class Component { registerEvent() {} register() {} }
class ItemView extends Component {
  constructor(leaf) { super(); this.leaf = leaf; this.containerEl = document.createElement('div'); this.contentEl = this.containerEl.createDiv({ cls: 'view-content' }); }
}
class TFile {}
const obsidian = new Proxy({
  Menu, Component, ItemView, TFile,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Platform: { isMobile: false },
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_canvas_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { modelFromData, canvasModel, arrowLinks, branchOf, branchSides, canvasHomes, unfoldRecord, openOldFolds, ' +
  'foldBranch, unfoldBranch, tidyBranch, tidyRecords, outlineTree, canvasCardLabel, snapshotModel, applyCanvasModel, CanvasFold, CanvasBranches, ' +
  'tuckedBBox, ' +
  'CanvasArrows, elbowPoints, nearestSides, roundedPath, polylineMiddle, ARROW_HEAD_POINTS, ' +
  'CanvasArrange, arrangePlaces, CanvasMindMap, cardTowards, CanvasFind, CanvasFocus, CanvasDuplicate };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

const card = (id, x, y, w, h, extra) => Object.assign({ id, type: 'text', text: id, x, y, width: w, height: h }, extra);
const edge = (from, to, fromSide, toSide, extra) => Object.assign({ id: `${from}-${to}`, fromNode: from, toNode: to, fromSide, toSide }, extra);
const at = (model, id) => { const n = model.byId.get(id); return [n.x, n.y, n.width, n.height]; };

(async () => {
  await t('arrows read as parent and child, the way the arrowhead points; groups take no part', () => {
    const m = R.modelFromData({
      nodes: [card('a', 0, 0, 100, 50), card('b', 0, 100, 100, 50), card('c', 0, 200, 100, 50), card('g', -20, -20, 300, 400, { type: 'group' })],
      edges: [edge('a', 'b', 'bottom', 'top'), edge('c', 'b', 'top', 'bottom', { fromEnd: 'arrow', toEnd: 'none' }), edge('g', 'a', 'right', 'left')],
    });
    const links = R.arrowLinks(m);
    assert.deepStrictEqual(links.children.get('a'), ['b']);
    assert.deepStrictEqual(links.children.get('b'), ['c']);
    assert.strictEqual(links.children.get('g'), undefined);
  });

  await t('a branch is what a card leads to, less a card reached from outside it too', () => {
    const m = R.modelFromData({
      nodes: ['r', 'a', 'b', 'c', 'x', 'shared'].map((id, i) => card(id, i * 200, 0, 100, 50)),
      edges: [edge('r', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'r'), edge('r', 'shared'), edge('x', 'shared')],
    });
    assert.deepStrictEqual(R.branchOf(m, 'r'), ['a', 'b', 'c']);
  });

  await t('a branch grows from the side its arrows leave — or, with none, the way its children lie', () => {
    const m = R.modelFromData({
      nodes: [card('r', 0, 0, 100, 50), card('a', 0, 200, 100, 50), card('b', 200, 200, 100, 50), card('s', 500, 0, 100, 50), card('t', 300, 0, 100, 50)],
      edges: [edge('r', 'a', 'bottom', 'top'), edge('r', 'b', 'bottom', 'left'), edge('s', 't')],
    });
    const sides = R.branchSides(m);
    assert.strictEqual(sides.get('r'), 'bottom');
    assert.strictEqual(sides.get('s'), 'left');
  });

  await t('a card sits in the smallest group round it', () => {
    const m = R.modelFromData({
      nodes: [card('outer', 0, 0, 1000, 1000, { type: 'group' }), card('inner', 100, 100, 400, 400, { type: 'group' }), card('a', 150, 150, 100, 50), card('b', 700, 700, 100, 50), card('c', 2000, 0, 100, 50)],
      edges: [],
    });
    const homes = R.canvasHomes(m);
    assert.strictEqual(homes.get('a'), 'inner');
    assert.strictEqual(homes.get('inner'), 'outer');
    assert.strictEqual(homes.get('b'), 'outer');
    assert.strictEqual(homes.get('c'), null);
  });

  // A card or group folded by an earlier version: its open height kept in drFold.
  const folded = (height, extra) => Object.assign({ drFold: { height, folded: 52, measured: true } }, extra);

  await t('a card folded by an earlier version opens, and what is below it in its column moves back down', () => {
    const m = R.modelFromData({
      nodes: [card('a', 0, 0, 200, 52, folded(200)), card('below', 0, 92, 200, 100), card('under', 50, 252, 230, 100), card('beside', 300, 240, 100, 100), card('far', 600, 600, 100, 100)],
      edges: [],
    });
    assert.ok(R.unfoldRecord(m, m.byId.get('a'), true));
    assert.deepStrictEqual(at(m, 'a'), [0, 0, 200, 200]);
    assert.deepStrictEqual(at(m, 'below'), [0, 240, 200, 100]);
    // Under the one that moved: it moves too, though it's wider than the card.
    assert.deepStrictEqual(at(m, 'under'), [50, 400, 230, 100]);
    assert.deepStrictEqual(at(m, 'beside'), [300, 240, 100, 100]);
    assert.deepStrictEqual(at(m, 'far'), [600, 600, 100, 100]);
    assert.ok(!m.byId.get('a').fold);
  });

  await t('what is below takes along what its arrows lead to, and what would otherwise be run into', () => {
    const m = R.modelFromData({
      nodes: [card('a', 0, 0, 200, 52, folded(200)), card('b', 0, 92, 200, 60), card('kid', 400, 92, 100, 60), card('side', 600, 100, 100, 60), card('wide', 300, 252, 500, 60)],
      edges: [edge('b', 'kid', 'right', 'left')],
    });
    R.unfoldRecord(m, m.byId.get('a'), true);
    // kid comes along with b, and wide, under kid, with it; side is above the fold and stays.
    assert.deepStrictEqual(['b', 'kid', 'wide', 'side'].map((id) => m.byId.get(id).y), [240, 240, 400, 100]);
  });

  await t('the group an old fold is in keeps its margin, and what is below the group moves too', () => {
    const m = R.modelFromData({
      nodes: [
        card('g', 0, 0, 400, 252, { type: 'group' }),
        card('a', 20, 20, 200, 52, folded(200)),
        card('b', 20, 112, 200, 100),
        card('after', 0, 302, 400, 100),
      ],
      edges: [],
    });
    R.unfoldRecord(m, m.byId.get('a'), true);
    assert.deepStrictEqual([at(m, 'g'), at(m, 'b'), at(m, 'after')], [[0, 0, 400, 400], [20, 260, 200, 100], [0, 450, 400, 100]]);
  });

  await t('a group folded by an earlier version opens, its cards back beside it even after it has moved', () => {
    const m = R.modelFromData({
      nodes: [
        card('g', 1000, 0, 400, 48, { type: 'group', drFold: { height: 300, folded: 48, measured: true } }),
        card('a', 1000, 0, 100, 50, { drTuck: { by: 'g', dx: 20, dy: 20 } }),
        card('b', 1000, 0, 100, 50, { drTuck: { by: 'g', dx: 20, dy: 120 } }),
        card('after', 1000, 88, 400, 100),
      ],
      edges: [],
    });
    assert.ok(R.openOldFolds(m, true));
    assert.strictEqual(m.byId.get('a').tuck, null);
    assert.deepStrictEqual([at(m, 'g'), at(m, 'a'), at(m, 'b'), at(m, 'after')], [[1000, 0, 400, 300], [1020, 20, 100, 50], [1020, 120, 100, 50], [1000, 340, 400, 100]]);
    assert.ok(!R.openOldFolds(m, true), 'nothing left to open');
  });

  await t('a folded branch tucks into its card, and the siblings round it close in from both sides', () => {
    // A tree growing right: p's children s1, r and s2 stacked; r's own children above and below it.
    const m = R.modelFromData({
      nodes: [
        card('p', 0, 300, 100, 50),
        card('s1', 200, 0, 100, 50),
        card('r', 200, 300, 100, 50),
        card('k1', 400, 150, 100, 50),
        card('k2', 400, 450, 100, 50),
        card('s2', 200, 600, 100, 50),
      ],
      edges: [edge('p', 's1', 'right', 'left'), edge('p', 'r', 'right', 'left'), edge('p', 's2', 'right', 'left'), edge('r', 'k1', 'right', 'left'), edge('r', 'k2', 'right', 'left')],
    });
    const start = ['p', 's1', 'r', 's2'].map((id) => at(m, id));
    assert.deepStrictEqual(R.foldBranch(m, m.byId.get('r'), true), ['k1', 'k2']);
    // r and its children spanned 150–500; folded, it's 300–350: 150 given back on each side.
    assert.deepStrictEqual(at(m, 's1'), [200, 150, 100, 50]);
    assert.deepStrictEqual(at(m, 's2'), [200, 450, 100, 50]);
    assert.deepStrictEqual(at(m, 'p'), [0, 300, 100, 50]);
    assert.deepStrictEqual(R.unfoldBranch(m, m.byId.get('r'), true), ['k1', 'k2']);
    assert.deepStrictEqual(['p', 's1', 'r', 's2'].map((id) => at(m, id)), start);
    assert.deepStrictEqual(at(m, 'k1'), [400, 150, 100, 50]);
  });

  await t('a tidy tree: children in a row beyond their card, centred on it, in the order they were', () => {
    const m = R.modelFromData({
      nodes: [card('r', 0, 0, 100, 50), card('b', 300, 400, 100, 50), card('a', -500, 90, 100, 50), card('c', 0, 900, 60, 50)],
      edges: [edge('r', 'a', 'bottom', 'top'), edge('r', 'b', 'bottom', 'top'), edge('a', 'c', 'bottom', 'top')],
    });
    const places = R.tidyBranch(m, 'r', 'bottom');
    // a and b in a row 80 below r, a first as it was further left, the pair centred under r.
    assert.deepStrictEqual(places.get('a'), { x: -65, y: 130 });
    assert.deepStrictEqual(places.get('b'), { x: 65, y: 130 });
    assert.deepStrictEqual(places.get('c'), { x: -45, y: 260 });
  });

  await t('a tidy tree packs a small branch in beside a big one, and lines each level up', () => {
    const m = R.modelFromData({
      nodes: [
        card('r', 0, 0, 100, 50),
        card('a', -200, 200, 100, 50),
        card('a1', -400, 400, 100, 50),
        card('a2', -200, 400, 100, 50),
        card('a3', 0, 400, 100, 50),
        card('b', 200, 200, 100, 50),
      ],
      edges: [edge('r', 'a', 'bottom', 'top'), edge('r', 'b', 'bottom', 'top'), edge('a', 'a1', 'bottom', 'top'), edge('a', 'a2', 'bottom', 'top'), edge('a', 'a3', 'bottom', 'top')],
    });
    const places = R.tidyBranch(m, 'r', 'bottom');
    // b sits just beside a: a's children spread out under both, a centred on them.
    assert.deepStrictEqual(['a', 'b', 'a1', 'a2', 'a3'].map((id) => [places.get(id).x, places.get(id).y]), [
      [-65, 130], [65, 130], [-195, 260], [-65, 260], [65, 260],
    ]);
    // Growing right, with a wide card on the first level: the next level lines up past it.
    const w = R.modelFromData({
      nodes: [card('r', 0, 0, 100, 50), card('wide', 300, -100, 300, 50), card('thin', 300, 100, 100, 50), card('w1', 700, -100, 100, 50), card('t1', 500, 100, 100, 50)],
      edges: [edge('r', 'wide', 'right', 'left'), edge('r', 'thin', 'right', 'left'), edge('wide', 'w1', 'right', 'left'), edge('thin', 't1', 'right', 'left')],
    });
    const across = R.tidyBranch(w, 'r', 'right');
    assert.deepStrictEqual([across.get('wide').x, across.get('thin').x, across.get('w1').x, across.get('t1').x], [180, 180, 560, 560]);
  });

  await t('a mind map spreading both ways is tidied both ways', () => {
    const m = R.modelFromData({
      nodes: [card('r', 0, 0, 100, 50), card('k', 300, 30, 100, 50), card('k2', 300, 200, 100, 50), card('l', -400, -20, 100, 50), card('l1', -700, -20, 100, 50)],
      edges: [edge('r', 'k', 'right', 'left'), edge('r', 'k2', 'right', 'left'), edge('r', 'l', 'left', 'right'), edge('l', 'l1', 'left', 'right')],
    });
    const places = R.tidyBranch(m, 'r', 'right');
    assert.ok(places.both);
    assert.deepStrictEqual(['k', 'k2', 'l', 'l1'].map((id) => [places.get(id).x, places.get(id).y]), [[180, -40], [180, 40], [-180, 0], [-360, 0]]);
    assert.deepStrictEqual(['k', 'l', 'l1'].map((id) => places.sides.get(id)), ['right', 'left', 'left']);
  });

  await t('a tidied branch takes the group its cards are in along, fitted round them', () => {
    const m = R.modelFromData({
      nodes: [
        card('r', 0, 0, 100, 50),
        card('g', 300, -100, 300, 400, { type: 'group', label: 'Ministers' }),
        card('c1', 320, -80, 100, 50),
        card('c2', 320, 200, 100, 50),
      ],
      edges: [edge('r', 'c1', 'right', 'left'), edge('r', 'c2', 'right', 'left')],
    });
    assert.ok(R.tidyRecords(m, m.byId.get('r'), true));
    assert.deepStrictEqual([at(m, 'c1').slice(0, 2), at(m, 'c2').slice(0, 2)], [[180, -40], [180, 40]]);
    assert.deepStrictEqual(at(m, 'g'), [160, -60, 300, 200]);
  });

  await t('tidying moves a card caught where the tree now lies out beyond it', () => {
    const m = R.modelFromData({
      nodes: [card('r', 0, 0, 200, 60), card('a', -300, 200, 160, 60), card('b', 400, 50, 160, 60), card('c', 100, 400, 160, 60), card('n', 140, 140, 160, 60)],
      edges: [edge('r', 'a', 'bottom', 'top'), edge('r', 'b', 'right', 'left'), edge('r', 'c', 'bottom', 'top')],
    });
    assert.ok(R.tidyRecords(m, m.byId.get('r'), true));
    // a, c and b in a row under r, as they were left to right; n, caught under them, below the tree.
    assert.deepStrictEqual(['a', 'c', 'b'].map((id) => at(m, id).slice(0, 2)), [[-170, 140], [20, 140], [210, 140]]);
    assert.deepStrictEqual(at(m, 'n'), [140, 230, 160, 60]);
  });

  await t('the outline: groups hold their cards, cards what their arrows lead to; folds show their count', () => {
    const m = R.modelFromData({
      nodes: [
        card('g', 0, 0, 600, 400, { type: 'group', label: 'Theories' }),
        card('root', 20, 20, 100, 50, { text: '# Realism\nStates seek power.' }),
        card('kid', 20, 120, 100, 50, { type: 'file', file: 'Politics/Anarchy.md' }),
        card('free', 300, 20, 100, 50, { text: '- [ ] a task' }),
        card('top', 0, -200, 100, 50, { type: 'link', url: 'https://example.com/' }),
        card('hidden', 900, 0, 100, 50, { drTuck: { by: 'top', dx: 900, dy: 200 } }),
        card('shared', 900, -300, 100, 50, { text: 'Also elsewhere' }),
      ],
      edges: [edge('root', 'kid'), edge('top', 'hidden'), edge('top', 'shared'), edge('free', 'shared')],
    });
    const tree = R.outlineTree(m);
    const brief = (items) => items.map((i) => [i.label, i.folded ? `+${i.count}` : '', brief(i.children)]);
    // shared hangs from the folded card too, but it's still out: it isn't shut away under it.
    assert.deepStrictEqual(brief(tree), [
      ['Also elsewhere', '', []],
      ['example.com', '+1', []],
      ['Theories', '', [['Realism', '', [['Anarchy', '', []]]], ['a task', '', []]]],
    ]);
  });

  // -- on a canvas ---------------------------------------------------------

  class FakeNode {
    constructor(canvas, data) {
      Object.assign(this, { id: data.id, x: data.x, y: data.y, width: data.width, height: data.height, color: data.color, unknownData: {}, isEditing: false, canvas });
      this.data = data;
      this.nodeEl = canvas.view.contentEl.createDiv({ cls: 'canvas-node' });
    }
    getData() { return Object.assign({}, this.data, { x: this.x, y: this.y, width: this.width, height: this.height }); }
    moveAndResize(r) { Object.assign(this, r); }
    getBBox() { return { minX: this.x, minY: this.y, maxX: this.x + this.width, maxY: this.y + this.height }; }
  }
  const fakeCanvas = (data) => {
    const containerEl = document.createElement('div');
    containerEl.createDiv({ cls: 'canvas-controls' });
    const view = { containerEl, contentEl: containerEl.createDiv(), file: { path: 'Map.canvas', extension: 'canvas' } };
    const canvas = { view, nodes: new Map(), edges: new Map(), selection: new Set(), saves: 0 };
    canvas.requestSave = () => canvas.saves++;
    canvas.deselect = (n) => canvas.selection.delete(n);
    canvas.deselectAll = () => canvas.selection.clear();
    canvas.select = (n) => canvas.selection.add(n);
    view.canvas = canvas;
    data.nodes.forEach((n) => canvas.nodes.set(n.id, new FakeNode(canvas, n)));
    data.edges.forEach((e) => {
      const g = containerEl.createDiv();
      canvas.edges.set(e.id, {
        id: e.id,
        from: { node: canvas.nodes.get(e.fromNode), side: e.fromSide, end: 'none' },
        to: { node: canvas.nodes.get(e.toNode), side: e.toSide, end: 'arrow' },
        lineGroupEl: g, lineEndGroupEl: g, renders: 0,
        render() { this.renders++; },
      });
    });
    return view;
  };
  const settings = { canvasBranches: true, canvasCloseGaps: true, canvasTidy: true, canvasSelectBranch: true };

  await t('Fold branch, above a selected card, tucks its branch away: arrows from elsewhere end at the fold', () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50), card('b', 400, 0, 100, 50), card('x', 200, 300, 100, 50), card('y', 0, 300, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left'), edge('a', 'b', 'right', 'left'), edge('x', 'b', 'top', 'bottom'), edge('y', 'x', 'right', 'left')],
    });
    const bar = view.contentEl.createDiv({ cls: 'canvas-menu' });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    fold.pass(view);
    const r = view.canvas.nodes.get('r');
    // Nothing on the canvas for an open branch: nothing among its arrows.
    assert.ok(!view.contentEl.querySelector('.dr-branch-knob'));
    assert.ok(!bar.querySelector('.dr-branch-button'));
    view.canvas.selection.add(r);
    fold.pass(view);
    assert.strictEqual(bar.querySelectorAll('button').length, 1, 'only Fold branch: a card has no fold of its own');
    const button = bar.querySelector('.dr-branch-button');
    assert.strictEqual(button.getAttribute('aria-label'), 'Fold branch');
    // x leads to b too, so b isn't r's alone: only a is tucked away.
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const a = view.canvas.nodes.get('a');
    const b = view.canvas.nodes.get('b');
    assert.deepStrictEqual(a.unknownData.drTuck, { by: 'r', dx: 200, dy: 0 });
    assert.ok(!b.unknownData.drTuck);
    assert.ok(a.nodeEl.classList.contains('dr-tucked'));
    assert.deepStrictEqual(a.getBBox(), r.getBBox());
    assert.strictEqual(button.getAttribute('aria-label'), 'Unfold branch');
    // Folded, it says how many cards it holds, where its arrows left it.
    const knob = r.nodeEl.querySelector('.dr-branch-knob');
    assert.strictEqual(knob.textContent, '+1');
    assert.ok(knob.classList.contains('is-right') && knob.classList.contains('is-folded'));
    view.canvas.selection.clear();
    // r → a is inside the fold: not drawn. a → b now starts at r.
    assert.ok(view.canvas.edges.get('r-a').lineGroupEl.classList.contains('dr-tucked-edge'));
    assert.ok(!view.canvas.edges.get('a-b').lineGroupEl.classList.contains('dr-tucked-edge'));
    assert.ok(view.canvas.edges.get('a-b').renders > 0);
    assert.strictEqual(view.canvas.saves, 1);
    // A box dragged round it can't take a tucked card along.
    view.canvas.selection.add(a);
    view.canvas.selection.add(r);
    fold.pass(view);
    assert.deepStrictEqual(Array.from(view.canvas.selection), [r]);
    // Unfolded: back, drawn as itself.
    knob.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(!a.unknownData.drTuck);
    assert.ok(!a.nodeEl.classList.contains('dr-tucked'));
    assert.ok(!Object.prototype.hasOwnProperty.call(a, 'getBBox'));
  });

  await t('deleting a folded card brings back what was tucked into it, beside where it was', () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    const state = { file: view.file };
    fold.watched.set(view, state);
    const r = view.canvas.nodes.get('r');
    fold.foldBranches(view, [r], true);
    r.moveAndResize({ x: 500, y: 500, width: 100, height: 50 });
    fold.pass(view);
    view.canvas.nodes.delete('r');
    view.canvas.edges.delete('r-a');
    fold.pass(view);
    const a = view.canvas.nodes.get('a');
    assert.ok(!a.unknownData.drTuck);
    assert.deepStrictEqual([a.x, a.y], [700, 500]);
    assert.ok(!a.nodeEl.classList.contains('dr-tucked'));
  });

  await t('a group has no fold of its own: nothing on it, nothing in its menu', () => {
    const view = fakeCanvas({
      nodes: [card('g', 0, 0, 400, 300, { type: 'group', label: 'G' }), card('a', 20, 20, 100, 50), card('b', 20, 120, 100, 50)],
      edges: [],
    });
    const bar = view.contentEl.createDiv({ cls: 'canvas-menu' });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const g = view.canvas.nodes.get('g');
    view.canvas.selection.add(g);
    fold.pass(view);
    assert.strictEqual(g.nodeEl.children.length, 0);
    assert.ok(!bar.querySelector('button'));
    const menu = new Menu();
    fold.addMenuItems(menu, [g]);
    assert.deepStrictEqual(menu.items, []);
  });

  await t('a group folded by an earlier version opens when the canvas is drawn — even rewritten without its fold’s record — nothing saved', () => {
    const view = fakeCanvas({
      nodes: [card('g', 0, 0, 400, 48, { type: 'group', label: 'G' }), card('a', 900, 900, 100, 50), card('b', 900, 900, 100, 160)],
      edges: [],
    });
    view.canvas.nodes.get('a').unknownData.drTuck = { by: 'g', dx: 20, dy: 20 };
    view.canvas.nodes.get('b').unknownData.drTuck = { by: 'g', dx: 200, dy: 60 };
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    fold.pass(view);
    const g = view.canvas.nodes.get('g');
    assert.strictEqual(view.canvas.saves, 0);
    assert.deepStrictEqual([g.height, view.canvas.nodes.get('b').x, view.canvas.nodes.get('b').y], [260, 200, 60]);
    assert.ok(!view.canvas.nodes.get('b').unknownData.drTuck);
    assert.ok(!g.unknownData.drFold);
  });

  await t('with folding switched off, nothing new folds, but what is folded can still be opened', () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left')],
    });
    const off = Object.assign({}, settings, { canvasBranches: false });
    const fold = new R.CanvasFold({ settings: off, app: {} });
    fold.watched.set(view, { file: view.file });
    fold.pass(view);
    const r = view.canvas.nodes.get('r');
    assert.ok(!r.nodeEl.querySelector('.dr-branch-knob'));
    view.canvas.nodes.get('a').unknownData.drTuck = { by: 'r', dx: 200, dy: 0 };
    fold.pass(view);
    assert.strictEqual(r.nodeEl.querySelector('.dr-branch-knob').textContent, '+1');
  });

  await t('select a branch: the card and everything below it by its arrows', () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50), card('b', 400, 0, 100, 50), card('other', 0, 300, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left'), edge('a', 'b', 'right', 'left')],
    });
    const branches = new R.CanvasBranches({ settings, app: {} });
    branches.selectBranch(view, view.canvas.nodes.get('r'));
    assert.deepStrictEqual(Array.from(view.canvas.selection).map((n) => n.id).sort(), ['a', 'b', 'r']);
    const menu = new Menu();
    branches.addMenuItems(menu, [view.canvas.nodes.get('r')]);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Tidy branch', 'Select branch']);
  });

  await t('a card holding its folded branch sits on a stack of them, gone when it opens', () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 200, 160, { text: '# Root\nwords' }), card('a', 300, 0, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const r = view.canvas.nodes.get('r');
    fold.foldBranches(view, [r], true);
    assert.ok(r.nodeEl.classList.contains('dr-holds'));
    assert.strictEqual(r.nodeEl.querySelectorAll(':scope > .dr-stack').length, 2);
    assert.strictEqual(r.height, 160, 'the card itself as it was');
    fold.foldBranches(view, [r], false);
    assert.ok(!r.nodeEl.classList.contains('dr-holds'));
    assert.ok(!r.nodeEl.querySelector('.dr-stack'));
  });

  await t('the tucked cards of a fold listed by name; one picked opens the fold', async () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('b', 200, 100, 100, 50, { text: '# Second' }), card('a', 200, 0, 100, 50, { text: 'First', color: '4' })],
      edges: [edge('r', 'a', 'right', 'left'), edge('r', 'b', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const r = view.canvas.nodes.get('r');
    fold.foldBranches(view, [r], true);
    const pop = document.createElement('div');
    fold.fillTucked(view, 'r', pop);
    assert.strictEqual(pop.querySelector('.dr-fold-list-head').textContent, '2 cards tucked away');
    const rows = Array.from(pop.querySelectorAll('.dr-fold-list-row'));
    assert.deepStrictEqual(rows.map((row) => row.textContent), ['First', 'Second']);
    view.canvas.selectOnly = (n) => { view.canvas.selection = new Set([n]); };
    rows[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 0));
    assert.ok(!view.canvas.nodes.get('b').unknownData.drTuck);
    assert.deepStrictEqual(Array.from(view.canvas.selection).map((n) => n.id), ['b']);
  });

  await t('a card folded by an earlier version, in a group, opens when the canvas is drawn and takes its room back', () => {
    const view = fakeCanvas({
      nodes: [
        card('g', -40, -60, 680, 372, { type: 'group', label: 'G' }),
        card('t1', 0, 0, 280, 52, { text: '# One\nwords' }),
        card('t3', 0, 92, 280, 180),
        card('below', -40, 412, 300, 100),
      ],
      edges: [],
    });
    const n = (id) => view.canvas.nodes.get(id);
    n('t1').unknownData.drFold = { height: 200, folded: 52, measured: true };
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    fold.pass(view);
    assert.deepStrictEqual([n('t1').height, n('t3').y, n('g').height, n('below').y], [200, 240, 520, 560]);
    assert.ok(!n('t1').unknownData.drFold);
    assert.strictEqual(view.canvas.saves, 0, 'saved with the canvas’s next change');
  });

  await t('a branch folded down inside a group gives the group its room back, and takes it again when it opens', async () => {
    const view = fakeCanvas({
      nodes: [
        card('g', 0, 0, 400, 300, { type: 'group', label: 'Treasury Board' }),
        card('pres', 20, 20, 200, 80),
        card('sec', 20, 180, 200, 80),
        card('out', 0, 340, 200, 60),
      ],
      edges: [edge('pres', 'sec', 'bottom', 'top')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const n = (id) => view.canvas.nodes.get(id);
    await fold.foldBranches(view, [n('pres')], true);
    assert.deepStrictEqual(at(R.canvasModel(view.canvas), 'g'), [0, 0, 400, 140], 'the group closed up round what it still shows');
    assert.strictEqual(n('out').y, 180, 'and what was below it followed');
    await fold.foldBranches(view, [n('pres')], false);
    assert.deepStrictEqual([n('g').height, n('sec').y, n('out').y], [300, 180, 340]);
  });

  await t('a branch folded across to a group’s edge narrows the group; groups inside groups follow a card, and all come back', async () => {
    const view = fakeCanvas({
      nodes: [
        card('g', 0, 0, 520, 200, { type: 'group', label: 'PMO' }),
        card('r', 20, 20, 200, 80),
        card('k', 280, 20, 200, 80),
        card('right', 600, 0, 100, 60),
        card('outer', 1000, 0, 600, 360, { type: 'group', label: 'Outer' }),
        card('inner', 1020, 20, 300, 300, { type: 'group', label: 'Inner' }),
        card('a', 1040, 40, 200, 200, { text: '# A\nwords' }),
        card('b', 1040, 260, 200, 40),
        card('c', 1360, 40, 200, 100),
        card('z', 1000, 400, 100, 50),
      ],
      edges: [edge('r', 'k', 'right', 'left'), edge('a', 'b', 'bottom', 'top')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const n = (id) => view.canvas.nodes.get(id);
    const sizes = () => ['g', 'right', 'outer', 'inner', 'b', 'z'].map((id) => [n(id).x, n(id).y, n(id).width, n(id).height]);
    const start = sizes();
    await fold.foldBranches(view, [n('r')], true);
    assert.strictEqual(n('g').width, 260, 'the group narrowed to what it shows');
    assert.strictEqual(n('right').x, 340, 'and what was beside it moved in');
    await fold.foldBranches(view, [n('a')], true);
    assert.strictEqual(n('inner').height, 240);
    assert.strictEqual(n('outer').height, 300);
    assert.strictEqual(n('z').y, 340);
    await fold.foldBranches(view, [n('a')], false);
    await fold.foldBranches(view, [n('r')], false);
    assert.deepStrictEqual(sizes(), start);
  });

  await t('arrows with square corners run out of one card, across, and into the other; sides that face each other are found', () => {
    const box = (x, y, w, h) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });
    const pts = (list) => list.map((p) => [p.x, p.y]);
    const A = box(0, 0, 100, 50);
    const B = box(300, 200, 100, 50);
    assert.deepStrictEqual(pts(R.elbowPoints({ x: 100, y: 25 }, 'right', { x: 300, y: 225 }, 'left', A, B)), [[100, 25], [200, 25], [200, 225], [300, 225]]);
    assert.deepStrictEqual(pts(R.elbowPoints({ x: 100, y: 25 }, 'right', { x: 350, y: 200 }, 'top', A, B)), [[100, 25], [350, 25], [350, 200]]);
    // Close together, one above the other: straight down, not round the side.
    const close = box(0, 80, 100, 50);
    assert.deepStrictEqual(pts(R.elbowPoints({ x: 50, y: 50 }, 'bottom', { x: 50, y: 80 }, 'top', A, close)), [[50, 50], [50, 80]]);
    assert.deepStrictEqual(pts(R.elbowPoints({ x: 50, y: 50 }, 'bottom', { x: 70, y: 80 }, 'top', A, box(20, 80, 100, 50))), [[50, 50], [50, 65], [70, 65], [70, 80]]);
    // Facing away, side by side: round the far side of both.
    const C = box(0, 100, 100, 50);
    const round = pts(R.elbowPoints({ x: 100, y: 25 }, 'right', { x: 100, y: 125 }, 'right', A, C));
    assert.deepStrictEqual(round, [[100, 25], [124, 25], [124, 125], [100, 125]]);
    assert.deepStrictEqual(R.nearestSides(A, B), { from: 'right', to: 'left' }, 'further apart across than down');
    assert.deepStrictEqual(R.nearestSides(A, box(40, 200, 100, 50)), { from: 'bottom', to: 'top' });
    assert.deepStrictEqual(R.nearestSides(B, A), { from: 'left', to: 'right' });
    const d = R.roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 14);
    assert.strictEqual(d, 'M0 0 L86 0 Q100 0 100 14 L100 100');
    assert.deepStrictEqual(R.polylineMiddle([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]), { x: 100, y: 0 });
  });

  await t('an arrow takes a style of its own — shape, line, head, sides — kept in its data, and back to the default', () => {
    // An arrow as the canvas draws one: a curve, and heads square to the card.
    class FakeEdge {
      constructor(canvas, id, from, to) {
        Object.assign(this, { canvas, id, from, to, unknownData: {} });
        this.lineGroupEl = document.createElement('div');
        const svg = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);
        this.path = { display: svg('path'), interaction: svg('path') };
        const end = svg('g');
        end.appendChild(svg('polygon')).setAttribute('points', '0,0 6.5,10.4 -6.5,10.4');
        this.toLineEnd = { el: end, type: 'arrow' };
        this.fromLineEnd = null;
      }
      updatePath() {
        this.bezier = { from: 'curve' };
        this.path.display.setAttribute('d', 'M curve');
        this.path.interaction.setAttribute('d', 'M curve');
        this.toLineEnd.el.style.transform = 'square';
      }
      getCenter() { return { x: -1, y: -1 }; }
      getBBox() { return { minX: 0, minY: 0, maxX: 1, maxY: 1 }; }
      render() { this.updatePath(); }
    }
    const drawnByCanvas = FakeEdge.prototype.updatePath;
    const view = fakeCanvas({ nodes: [card('a', 0, 0, 100, 50), card('b', 300, 200, 100, 50)], edges: [] });
    const bar = view.contentEl.createDiv({ cls: 'canvas-menu' });
    const edge = new FakeEdge(view.canvas, 'e', { node: view.canvas.nodes.get('a'), side: 'right' }, { node: view.canvas.nodes.get('b'), side: 'left' });
    view.canvas.edges.set('e', edge);
    const arrows = new R.CanvasArrows({ settings: { canvasArrows: true, canvasArrowShape: 'curve', canvasArrowSides: false }, app: {} });
    arrows.watched.set(view, { file: view.file });
    arrows.mount(view);
    assert.strictEqual(edge.path.display.getAttribute('d'), 'M curve', 'left as the canvas draws it by default');
    view.canvas.selection.add(edge);
    arrows.pass(view);
    assert.strictEqual(bar.querySelector('.dr-arrow-button').getAttribute('aria-label'), 'Arrow style');
    const menu = new Menu();
    arrows.addMenuItems(menu, [edge]);
    assert.ok(menu.items.some((i) => i.title === 'Arrow: square corners'));

    arrows.setStyle(view, [edge], { shape: 'elbow', line: 'dashed', head: 'dot' });
    assert.deepStrictEqual(edge.unknownData.drArrow, { shape: 'elbow', line: 'dashed', head: 'dot' });
    assert.strictEqual(edge.path.display.getAttribute('d'), 'M100 25 L186 25 Q200 25 200 39 L200 211 Q200 225 214 225 L293 225');
    assert.ok(edge.lineGroupEl.classList.contains('dr-line-dashed'));
    assert.strictEqual(edge.toLineEnd.el.querySelector('polygon').getAttribute('points'), R.ARROW_HEAD_POINTS.dot);
    assert.deepStrictEqual(edge.getCenter(), { x: 200, y: 121.5 });
    assert.strictEqual(view.canvas.saves, 1, 'by hand: saved, a step of Undo');

    // Straight: the head turns to the line.
    arrows.setStyle(view, [edge], { shape: 'straight' });
    assert.ok(/rotate\(/.test(edge.toLineEnd.el.style.transform));
    // Joined at the sides facing each other, as the cards now lie.
    edge.from.side = 'top';
    edge.to.side = 'bottom';
    arrows.setStyle(view, [edge], { sides: 'near' });
    assert.deepStrictEqual([edge.from.side, edge.to.side], ['right', 'left']);
    // Not while an end is folded away: drawn to the fold, it keeps the sides it has.
    const tucked = view.canvas.nodes.get('a');
    tucked.drInto = view.canvas.nodes.get('b');
    tucked.getBBox = R.tuckedBBox;
    edge.from.side = 'bottom';
    edge.to.side = 'top';
    edge.render();
    assert.deepStrictEqual([edge.from.side, edge.to.side], ['bottom', 'top']);
    delete tucked.getBBox;
    delete tucked.drInto;

    arrows.setStyle(view, [edge], null);
    assert.ok(!edge.unknownData.drArrow);
    assert.strictEqual(edge.path.display.getAttribute('d'), 'M curve');
    assert.strictEqual(edge.toLineEnd.el.querySelector('polygon').getAttribute('points'), R.ARROW_HEAD_POINTS.arrow);
    assert.ok(!edge.lineGroupEl.classList.contains('dr-line-dashed'));
    assert.notStrictEqual(FakeEdge.prototype.updatePath, drawnByCanvas);
    arrows.disable();
    assert.strictEqual(FakeEdge.prototype.updatePath, drawnByCanvas, 'the canvas draws its own arrows again');
  });

  const plugin = (extra) => {
    const fold = new R.CanvasFold({ settings, app: {} });
    const p = { settings: Object.assign({}, settings, { canvasArrange: true, canvasMindMap: true }, extra), app: { workspace: { trigger() {} } }, feature: (C) => (C === R.CanvasFold ? fold : null) };
    fold.plugin = p;
    return { p, fold };
  };

  await t('selected cards line up, space out evenly, match sizes, and fall into a grid — a group with its cards, one step of Undo', async () => {
    const view = fakeCanvas({
      nodes: [
        card('a', 0, 0, 100, 50),
        card('b', 220, 30, 140, 60),
        card('c', 400, 10, 100, 80),
        card('g', 600, 100, 300, 200, { type: 'group', label: 'G' }),
        card('in', 620, 140, 100, 50),
        card('other', 0, 500, 100, 50),
      ],
      edges: [],
    });
    const { p, fold } = plugin();
    fold.watched.set(view, { file: view.file, schedule() {} });
    const arrange = new R.CanvasArrange(p);
    const n = (id) => view.canvas.nodes.get(id);
    const box = (id) => [n(id).x, n(id).y, n(id).width, n(id).height];
    ['a', 'b', 'c', 'g', 'in'].forEach((id) => view.canvas.selection.add(n(id)));
    assert.deepStrictEqual(arrange.cards(view).map((r) => r.id), ['a', 'b', 'c', 'g'], 'a card inside a selected group moves with it');
    await arrange.arrange(view, 'top');
    assert.deepStrictEqual([box('a')[1], box('b')[1], box('c')[1], box('g')[1]], [0, 0, 0, 0]);
    assert.deepStrictEqual(box('in'), [620, 40, 100, 50], 'carried along with its group');
    assert.strictEqual(view.canvas.saves, 1);
    await arrange.arrange(view, 'right');
    assert.deepStrictEqual([box('a')[0], box('b')[0], box('g')[0]], [800, 760, 600]);
    view.canvas.selection.delete(n('g'));
    view.canvas.selection.delete(n('in'));
    // Back to a row, then spaced evenly between the first and last.
    n('a').moveAndResize({ x: 0, y: 0, width: 100, height: 50 });
    n('b').moveAndResize({ x: 120, y: 0, width: 140, height: 60 });
    n('c').moveAndResize({ x: 500, y: 0, width: 100, height: 80 });
    await arrange.arrange(view, 'space-across');
    assert.deepStrictEqual([box('a')[0], box('b')[0], box('c')[0]], [0, 230, 500]);
    await arrange.arrange(view, 'width');
    assert.deepStrictEqual([box('a')[2], box('b')[2], box('c')[2]], [140, 140, 140]);
    await arrange.arrange(view, 'column');
    assert.deepStrictEqual([box('a'), box('b'), box('c')].map((b) => [b[0], b[1]]), [[0, 0], [0, 90], [0, 190]]);
    assert.deepStrictEqual(
      R.arrangePlaces([card('w', 0, 0, 100, 50), card('x', 300, 0, 100, 50), card('y', 0, 200, 100, 50), card('z', 300, 200, 100, 80)], 'grid').get('x'),
      { x: 140, y: 0, width: 100, height: 50 }
    );
    view.canvas.selection.delete(n('c'));
    const menu = new Menu();
    arrange.addMenuItems(menu, [n('a'), n('b')]);
    assert.ok(menu.items.some((i) => i.title === 'Align left edges'));
    assert.ok(!menu.items.some((i) => i.title === 'Space evenly across'), 'spacing out takes three');
  });

  const mindCanvas = (data) => {
    const view = fakeCanvas(data);
    const canvas = view.canvas;
    let made = 0;
    canvas.config = { defaultTextNodeDimensions: { width: 250, height: 60 } };
    canvas.createTextNode = ({ pos, size }) => {
      const node = new FakeNode(canvas, { id: `new${++made}`, type: 'text', text: '', x: pos.x, y: pos.y, width: size.width, height: size.height });
      node.setColor = (c) => { node.color = c; node.data.color = c; };
      node.startEditing = () => { node.isEditing = true; };
      canvas.nodes.set(node.id, node);
      return node;
    };
    canvas.importData = ({ edges }) => edges.forEach((e) => {
      const g = view.containerEl.createDiv();
      canvas.edges.set(e.id, {
        id: e.id,
        from: { node: canvas.nodes.get(e.fromNode), side: e.fromSide, end: 'none' },
        to: { node: canvas.nodes.get(e.toNode), side: e.toSide, end: 'arrow' },
        lineGroupEl: g, lineEndGroupEl: g, render() {},
      });
    });
    canvas.selectOnly = (n) => { canvas.selection = new Set([n]); };
    return view;
  };

  await t('Tab adds a card the selected one leads to, in line after the others; Enter adds one beside it, room made below', async () => {
    const view = mindCanvas({
      nodes: [
        card('g', -40, -40, 700, 400, { type: 'group', label: 'Theories' }),
        card('root', 0, 100, 200, 60),
        card('k1', 300, 0, 200, 60, { color: '4' }),
        card('k2', 300, 100, 200, 60),
        card('next', 300, 200, 200, 60),
      ],
      edges: [edge('root', 'k1', 'right', 'left'), edge('root', 'k2', 'right', 'left'), edge('root', 'next', 'right', 'left')],
    });
    const { p, fold } = plugin();
    fold.watched.set(view, { file: view.file, schedule() {} });
    const mind = new R.CanvasMindMap(p);
    const n = (id) => view.canvas.nodes.get(id);
    // Tab on the root: after its last child, joined to it.
    const child = await mind.addChild(view, n('root'));
    assert.deepStrictEqual([child.x, child.y, child.width, child.height], [300, 290, 200, 60]);
    const joined = Array.from(view.canvas.edges.values()).find((e) => e.to.node === child);
    assert.deepStrictEqual([joined.from.node.id, joined.from.side, joined.to.side], ['root', 'right', 'left']);
    assert.ok(child.isEditing && view.canvas.selection.has(child), 'opened to type in');
    assert.strictEqual(n('g').height, 400, 'it fits in its group as it is');
    // Enter on the first child: the next one along, in its colour; what was below it moves down.
    const sibling = await mind.addSibling(view, n('k1'));
    assert.deepStrictEqual([sibling.x, sibling.y, sibling.color], [300, 90, '4']);
    assert.deepStrictEqual([n('k2').y, n('next').y, child.y], [180, 280, 370]);
    assert.strictEqual(n('g').height, 480, 'pushed out of its group, the group grows round them');
    // A card with nothing after it grows the way its branch does.
    const grand = await mind.addChild(view, n('k2'));
    assert.deepStrictEqual([grand.x, grand.y], [580, 180]);
    assert.ok(n('g').width > 700);
    // Alt and an arrow: the next card that way.
    view.canvas.selectOnly(n('k2'));
    assert.strictEqual(mind.step(view, 'left'), n('root'));
    view.canvas.selectOnly(n('k2'));
    assert.strictEqual(mind.step(view, 'right').id, grand.id);
    assert.ok(view.canvas.selection.has(grand));
  });

  await t('the keys only answer a selected card that isn’t being typed in', () => {
    const view = mindCanvas({ nodes: [card('root', 0, 0, 200, 60)], edges: [] });
    const { p, fold } = plugin();
    fold.watched.set(view, { file: view.file, schedule() {} });
    const mind = new R.CanvasMindMap(p);
    const state = { file: view.file };
    mind.watched.set(view, state);
    mind.mount(view, state);
    const press = (key, target, extra) => {
      const evt = new window.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, extra));
      (target || view.containerEl).dispatchEvent(evt);
      return evt.defaultPrevented;
    };
    assert.strictEqual(press('Tab'), false, 'nothing selected');
    view.canvas.selectOnly(view.canvas.nodes.get('root'));
    const editor = view.contentEl.createDiv({ cls: 'cm-editor' });
    assert.strictEqual(press('Tab', editor), false, 'typing');
    assert.strictEqual(press('Tab', undefined, { ctrlKey: true }), false);
    assert.strictEqual(press('Tab'), true);
    assert.strictEqual(view.canvas.nodes.size, 2);
    mind.cleanup(view, state);
  });

  await t('the folding menu offers what can be done now, and how folding works', () => {
    const view = fakeCanvas({
      nodes: [card('g', 0, 0, 400, 300, { type: 'group', label: 'G' }), card('a', 20, 20, 100, 50), card('r', 600, 0, 100, 50), card('k', 800, 0, 100, 50)],
      edges: [edge('r', 'k', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const titles = () => fold.foldMenu(view, view.containerEl, null).items.map((i) => i.title);
    assert.deepStrictEqual(titles(), ['Fold every branch', 'How folding works']);
    fold.foldEverything(view, 'branches');
    assert.deepStrictEqual(titles(), ['Unfold every branch', 'How folding works']);
  });

  await t('every branch at once, from the top of each tree, and every one unfolded — folds within folds too', () => {
    const view = fakeCanvas({
      nodes: [
        card('g', 0, 0, 600, 500, { type: 'group', label: 'G' }),
        card('r', 40, 300, 100, 50),
        card('k', 300, 300, 100, 50),
        card('kk', 450, 300, 100, 50),
        card('x', 40, 80, 100, 50),
        card('y', 300, 80, 100, 50),
      ],
      edges: [edge('r', 'k', 'right', 'left'), edge('k', 'kk', 'right', 'left'), edge('x', 'y', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const ud = (id) => view.canvas.nodes.get(id).unknownData;
    // k's own branch folded first: it goes into r's fold with it.
    fold.foldBranches(view, [view.canvas.nodes.get('k')], true);
    fold.foldEverything(view, 'branches');
    assert.deepStrictEqual(['k', 'kk', 'y'].map((id) => ud(id).drTuck.by), ['r', 'k', 'x']);
    assert.strictEqual(fold.foldStatus(R.canvasModel(view.canvas)).roots, 0);
    fold.foldEverything(view, 'everything');
    ['k', 'kk', 'y'].forEach((id) => assert.ok(!ud(id).drTuck, `${id} out`));
  });

  await t('a master card stays out of the folds above it, with what hangs from it, and folds its own branch', () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50), card('m', 400, 0, 100, 50), card('k', 600, 0, 100, 50), card('b', 200, 100, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left'), edge('a', 'm', 'right', 'left'), edge('m', 'k', 'right', 'left'), edge('r', 'b', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const n = (id) => view.canvas.nodes.get(id);
    // In the bar above it when it's selected: a crown, lit once it's a master card.
    const bar = view.contentEl.createDiv({ cls: 'canvas-menu' });
    view.canvas.selection.add(n('m'));
    fold.pass(view);
    const crown = bar.querySelector('.dr-master-button');
    assert.strictEqual(crown.getAttribute('aria-label'), 'Make master card');
    crown.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(n('m').unknownData.drMaster, true);
    assert.strictEqual(crown.getAttribute('aria-label'), 'Master card: on');
    assert.ok(crown.classList.contains('is-active'));
    crown.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(!('drMaster' in n('m').unknownData));
    view.canvas.selection.clear();
    view.canvas.saves = 0;
    // Offered for a card hanging from another, from its right-click menu.
    let menu = new Menu();
    fold.addMenuItems(menu, [n('m')]);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Fold branch', 'Master card']);
    menu.items[1].click();
    assert.strictEqual(n('m').unknownData.drMaster, true);
    assert.strictEqual(view.canvas.saves, 1, 'saved, a step of Undo');
    assert.ok(n('m').nodeEl.querySelector('.dr-master-mark'));
    // Not for one at the top of its tree: there's no fold above it.
    menu = new Menu();
    fold.addMenuItems(menu, [n('r')]);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Fold branch']);
    fold.foldBranches(view, [n('r')], true);
    assert.deepStrictEqual(['a', 'b', 'm', 'k'].map((id) => !!n(id).unknownData.drTuck), [true, true, false, false]);
    assert.strictEqual(n('r').nodeEl.querySelector('.dr-branch-knob').textContent, '+2');
    // Everything at once: from the top of each tree, and from each master card.
    fold.foldEverything(view, 'everything');
    fold.foldEverything(view, 'branches');
    assert.deepStrictEqual(['a', 'b', 'm', 'k'].map((id) => (n(id).unknownData.drTuck || {}).by || null), ['r', 'r', null, 'm']);
    fold.foldEverything(view, 'everything');
    fold.setMaster(view, [n('m')], false);
    assert.ok(!('drMaster' in n('m').unknownData));
    assert.ok(!n('m').nodeEl.querySelector('.dr-master-mark'));
  });

  await t('unfolding moves back exactly what folding moved, whatever came between; closing up stops short of a card in the way', async () => {
    const view = fakeCanvas({
      nodes: [
        card('r', 0, 100, 100, 50),
        card('a', 200, 100, 100, 50),
        card('a1', 400, 0, 100, 50),
        card('a2', 400, 200, 100, 50),
        card('b', 100, 300, 150, 50),
        card('b1', 400, 300, 100, 50),
        card('fixed', 100, 200, 60, 40),
      ],
      edges: [edge('r', 'a', 'right', 'left'), edge('a', 'a1', 'right', 'left'), edge('a', 'a2', 'right', 'left'), edge('r', 'b', 'right', 'left'), edge('b', 'b1', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const n = (id) => view.canvas.nodes.get(id);
    const where = () => Array.from(view.canvas.nodes.values()).map((c) => [c.id, c.x, c.y]);
    const start = where();
    await fold.foldBranches(view, [n('a')], true);
    // a's branch gave back 100 below it, but b closes up only to 20 short of the card in its way.
    assert.deepStrictEqual([n('b').y, n('b1').y, n('fixed').y], [260, 260, 200]);
    assert.deepStrictEqual(n('a').unknownData.drRoom, { b: [0, -40, 0, 0], b1: [0, -40, 0, 0] });
    await fold.foldBranches(view, [n('b')], true);
    // a opened while b's still folded: b1 comes out where it would have been.
    await fold.foldBranches(view, [n('a')], false);
    assert.ok(!('drRoom' in n('a').unknownData));
    await fold.foldBranches(view, [n('b')], false);
    assert.deepStrictEqual(where(), start);
  });

  await t('a fold that moved nothing moves nothing back, even with closing the gaps switched on since', async () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50), card('b', 0, 100, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left')],
    });
    const off = new R.CanvasFold({ settings: Object.assign({}, settings, { canvasCloseGaps: false }), app: {} });
    off.watched.set(view, { file: view.file });
    await off.foldBranches(view, [view.canvas.nodes.get('r')], true);
    assert.deepStrictEqual(view.canvas.nodes.get('r').unknownData.drRoom, {});
    const on = new R.CanvasFold({ settings, app: {} });
    on.watched.set(view, { file: view.file });
    await on.foldBranches(view, [view.canvas.nodes.get('r')], false);
    assert.deepStrictEqual([view.canvas.nodes.get('a').x, view.canvas.nodes.get('b').y], [200, 100]);
  });

  await t('the canvas finds the folded card under the pointer, not one tucked into it: arrows join the card that’s there', () => {
    const view = fakeCanvas({ nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50)], edges: [edge('r', 'a', 'right', 'left')] });
    const c = view.canvas;
    view.canvas.nodes.get('r').zIndex = 1;
    view.canvas.nodes.get('a').zIndex = 2;
    // As the canvas does it: from an index of the cards' boxes, the one on top.
    const inBox = (n, b) => { const o = n.getBBox(); return o.minX <= b.maxX && o.maxX >= b.minX && o.minY <= b.maxY && o.maxY >= b.minY; };
    Object.setPrototypeOf(c, {
      getIntersectingNodes(b) { return Array.from(this.nodes.values()).filter((n) => inBox(n, b)); },
      hitTestNode(pos) {
        const found = this.getIntersectingNodes({ minX: pos.x, minY: pos.y, maxX: pos.x, maxY: pos.y });
        return found.sort((x, y) => y.zIndex - x.zIndex)[0] || null;
      },
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    fold.foldBranches(view, [c.nodes.get('r')], true);
    assert.strictEqual(c.nodes.get('a').getBBox, R.tuckedBBox);
    assert.strictEqual(c.hitTestNode({ x: 50, y: 25 }).id, 'r');
    assert.deepStrictEqual(c.getIntersectingNodes({ minX: -10, minY: -10, maxX: 400, maxY: 100 }).map((n) => n.id), ['r']);
    fold.cleanup(view);
    assert.ok(!Object.prototype.hasOwnProperty.call(c, 'hitTestNode'), 'the canvas finds cards as it did');
    assert.ok(!Object.prototype.hasOwnProperty.call(c, 'getIntersectingNodes'));
  });

  class ExtrasNode {
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
  const extrasCanvas = (data) => {
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
    data.nodes.forEach((n) => canvas.nodes.set(n.id, new ExtrasNode(canvas, n)));
    data.edges.forEach(addEdge);
    canvas.getData = () => ({
      nodes: Array.from(canvas.nodes.values()).map((n) => n.getData()),
      edges: Array.from(canvas.edges.values()).map((e) => e.getData()),
    });
    canvas.importData = (more) => {
      (more.nodes || []).forEach((n) => canvas.nodes.set(n.id, new ExtrasNode(canvas, n)));
      (more.edges || []).forEach(addEdge);
    };
    return view;
  };

  const pressKey = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  /* -- the canvas ---------------------------------------------------------------- */

  const extrasPlugin = (settings) => ({ settings, app: {}, feature: () => null });

  await t('Duplicate branch copies a card with what it leads to, arrows and folds included, beside it', () => {
    const view = extrasCanvas({
      nodes: [
        card('r', 0, 0, 100, 50),
        card('a', 200, 0, 100, 50),
        card('b', 200, 100, 100, 50),
        card('t', 200, 100, 100, 50, { drTuck: { by: 'b', dx: 200, dy: 0 } }),
        card('elsewhere', 0, 400, 100, 50),
      ],
      edges: [edge('r', 'a', 'right', 'left'), edge('r', 'b', 'right', 'left'), edge('b', 't', 'right', 'left'), edge('elsewhere', 'r', 'top', 'bottom')],
    });
    const dup = new R.CanvasDuplicate(extrasPlugin({ canvasDuplicate: true }));
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
    const view = extrasCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50), card('x', 0, 300, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left'), edge('x', 'r', 'top', 'bottom')],
    });
    const focus = new R.CanvasFocus(extrasPlugin({ canvasFocus: true }));
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
    pressKey(view.containerEl, 'Escape');
    assert.ok(!view.contentEl.classList.contains('dr-branch-focus'));
    assert.ok(!lit('r'));
  });

  await t('Find goes to a card tucked into a fold by opening the fold first', async () => {
    const view = extrasCanvas({
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
