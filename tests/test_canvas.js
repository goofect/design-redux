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
  '\nmodule.exports.__test = { modelFromData, canvasModel, arrowLinks, branchOf, branchSides, canvasHomes, foldRecord, unfoldRecord, ' +
  'foldBranch, unfoldBranch, tidyBranch, tidyRecords, outlineTree, canvasCardLabel, snapshotModel, applyCanvasModel, CanvasFold, CanvasBranches, ' +
  'tuckedBBox, GROUP_FOLD_HEIGHT, foldFace, faceHeight, FOLD_TITLE_HEIGHT, FOLD_GLIMPSE_HEIGHT };\n');
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

  await t('a folded card closes up what is below it, in its column — and unfolding puts it all back', () => {
    const m = R.modelFromData({
      nodes: [card('a', 0, 0, 200, 200), card('below', 0, 240, 200, 100), card('under', 50, 400, 230, 100), card('beside', 300, 240, 100, 100), card('far', 600, 600, 100, 100)],
      edges: [],
    });
    const start = ['a', 'below', 'under', 'beside', 'far'].map((id) => at(m, id));
    assert.ok(R.foldRecord(m, m.byId.get('a'), 52, true, true));
    assert.deepStrictEqual(at(m, 'a'), [0, 0, 200, 52]);
    assert.deepStrictEqual(at(m, 'below'), [0, 92, 200, 100]);
    // Under the one that moved: it moves too, though it's wider than the card.
    assert.deepStrictEqual(at(m, 'under'), [50, 252, 230, 100]);
    assert.deepStrictEqual(at(m, 'beside'), [300, 240, 100, 100]);
    assert.deepStrictEqual(at(m, 'far'), [600, 600, 100, 100]);
    assert.ok(R.unfoldRecord(m, m.byId.get('a'), true));
    assert.deepStrictEqual(['a', 'below', 'under', 'beside', 'far'].map((id) => at(m, id)), start);
  });

  await t('what is below takes along what its arrows lead to, and what would otherwise be run into', () => {
    const m = R.modelFromData({
      nodes: [card('a', 0, 0, 200, 200), card('b', 0, 240, 200, 60), card('kid', 400, 240, 100, 60), card('side', 600, 100, 100, 60), card('wide', 300, 400, 500, 60)],
      edges: [edge('b', 'kid', 'right', 'left')],
    });
    R.foldRecord(m, m.byId.get('a'), 52, true, true);
    // kid comes along with b, and wide, under kid, with it; side is above the fold and stays.
    assert.deepStrictEqual(['b', 'kid', 'wide', 'side'].map((id) => m.byId.get(id).y), [92, 92, 252, 100]);
  });

  await t('the group a fold is in keeps its margin, and what is below the group closes up too', () => {
    const m = R.modelFromData({
      nodes: [
        card('g', 0, 0, 400, 400, { type: 'group' }),
        card('a', 20, 20, 200, 200),
        card('b', 20, 260, 200, 100),
        card('after', 0, 450, 400, 100),
      ],
      edges: [],
    });
    R.foldRecord(m, m.byId.get('a'), 52, true, true);
    assert.deepStrictEqual(at(m, 'b'), [20, 112, 200, 100]);
    assert.deepStrictEqual(at(m, 'g'), [0, 0, 400, 252]);
    assert.deepStrictEqual(at(m, 'after'), [0, 302, 400, 100]);
    R.unfoldRecord(m, m.byId.get('a'), true);
    assert.deepStrictEqual([at(m, 'g'), at(m, 'b'), at(m, 'after')], [[0, 0, 400, 400], [20, 260, 200, 100], [0, 450, 400, 100]]);
  });

  await t('a folded group tucks its cards in, and they come back beside it even after it has moved', () => {
    const m = R.modelFromData({
      nodes: [card('g', 0, 0, 400, 300, { type: 'group' }), card('a', 20, 20, 100, 50), card('b', 20, 120, 100, 50), card('after', 0, 340, 400, 100)],
      edges: [],
    });
    R.foldRecord(m, m.byId.get('g'), R.GROUP_FOLD_HEIGHT, true, true);
    assert.deepStrictEqual(m.byId.get('a').tuck, { by: 'g', dx: 20, dy: 20 });
    assert.strictEqual(m.byId.get('g').height, 48);
    assert.deepStrictEqual(at(m, 'after'), [0, 88, 400, 100]);
    // Unfolded, it opens out over the room it gave back: what's below moves back down.
    R.unfoldRecord(m, m.byId.get('g'), true);
    assert.deepStrictEqual(at(m, 'after'), [0, 340, 400, 100]);
    R.foldRecord(m, m.byId.get('g'), R.GROUP_FOLD_HEIGHT, true, true);
    // Moved while folded.
    m.byId.get('g').x = 1000;
    R.unfoldRecord(m, m.byId.get('g'), true);
    assert.strictEqual(m.byId.get('a').tuck, null);
    assert.deepStrictEqual(at(m, 'a'), [1020, 20, 100, 50]);
    assert.deepStrictEqual(at(m, 'g'), [1000, 0, 400, 300]);
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
  const settings = { canvasFold: true, canvasBranches: true, canvasCloseGaps: true, canvasTidy: true, canvasSelectBranch: true };

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
    assert.ok(!view.contentEl.querySelector('.dr-branch-knob, .dr-fold-btn'));
    assert.ok(!bar.querySelector('.dr-branch-button'));
    view.canvas.selection.add(r);
    fold.pass(view);
    assert.strictEqual(bar.querySelector('.dr-fold-button').getAttribute('aria-label'), 'Fold card');
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

  await t('a group folds from its arrow, and says how many cards it holds', () => {
    const view = fakeCanvas({
      nodes: [card('g', 0, 0, 400, 300, { type: 'group', label: 'G' }), card('a', 20, 20, 100, 50), card('b', 20, 120, 100, 50)],
      edges: [],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    fold.pass(view);
    const g = view.canvas.nodes.get('g');
    g.nodeEl.querySelector('.dr-fold-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(g.height, R.GROUP_FOLD_HEIGHT);
    assert.strictEqual(g.nodeEl.querySelector('.dr-group-summary').textContent, '2 cards');
    assert.ok(view.canvas.nodes.get('a').nodeEl.classList.contains('dr-tucked'));
    const menu = new Menu();
    fold.addMenuItems(menu, [g]);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Unfold group']);
    menu.items[0].click();
    assert.strictEqual(g.height, 300);
    assert.ok(!g.nodeEl.querySelector('.dr-group-summary'));
  });

  await t('a group rewritten without its fold’s record still opens out round its cards — nothing saved', () => {
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
    assert.ok(g.nodeEl.classList.contains('dr-folded'));
    fold.fold(view, [g], false);
    assert.deepStrictEqual([g.height, view.canvas.nodes.get('b').x, view.canvas.nodes.get('b').y], [260, 200, 60]);
  });

  await t('with folding switched off, nothing new folds, but what is folded can still be opened', () => {
    const view = fakeCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left')],
    });
    const off = Object.assign({}, settings, { canvasFold: false, canvasBranches: false });
    const fold = new R.CanvasFold({ settings: off, app: {} });
    fold.watched.set(view, { file: view.file });
    fold.pass(view);
    const r = view.canvas.nodes.get('r');
    assert.ok(!r.nodeEl.querySelector('.dr-branch-knob, .dr-fold-btn'));
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

  await t('a folded card shows its title and a glimpse of the rest; a note’s heading that repeats its name is skipped', () => {
    const face = R.foldFace({ type: 'text', text: '---\ntag: x\n---\n# **Realism**\nStates seek [[Power|power]].\n\n- in a world\n' });
    assert.deepStrictEqual(face, { title: 'Realism', glimpse: 'States seek power. in a world', pending: false });
    assert.strictEqual(R.faceHeight(face), R.FOLD_GLIMPSE_HEIGHT);
    const bare = R.foldFace({ type: 'text', text: '## Only a title' });
    assert.strictEqual(bare.glimpse, '');
    assert.strictEqual(R.faceHeight(bare), R.FOLD_TITLE_HEIGHT);
    const note = { type: 'file', file: 'Politics/Anarchy.md' };
    assert.deepStrictEqual(R.foldFace(note), { title: 'Anarchy', glimpse: '', pending: true });
    assert.strictEqual(R.faceHeight(R.foldFace(note)), R.FOLD_GLIMPSE_HEIGHT, 'room kept for a note not read yet');
    assert.strictEqual(R.foldFace(note, '---\na: 1\n---\n# Anarchy\nNo government above.').glimpse, 'No government above.');
  });

  await t('opening a card leaves its branch folded; folding a card shows its face and a stack for what it holds', () => {
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
    fold.fold(view, [r], true);
    assert.strictEqual(r.height, R.FOLD_GLIMPSE_HEIGHT);
    const face = r.nodeEl.querySelector('.dr-fold-face');
    assert.deepStrictEqual([face.firstElementChild.textContent, face.lastElementChild.textContent], ['Root', 'words']);
    // The arrow by its title, inside the card, opens it.
    face.querySelector('.dr-fold-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(r.height, 160);
    assert.ok(view.canvas.nodes.get('a').unknownData.drTuck, 'its branch still folded');
    assert.ok(!r.nodeEl.querySelector('.dr-fold-face'));
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

  await t('a folded card in a group, pulled open by hand, gives the group back the room it took', () => {
    const view = fakeCanvas({
      nodes: [
        card('g', -40, -60, 680, 520, { type: 'group', label: 'G' }),
        card('t1', 0, 0, 280, 200, { text: '# One\nwords' }),
        card('t3', 0, 240, 280, 180),
        card('below', -40, 560, 300, 100),
      ],
      edges: [],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const n = (id) => view.canvas.nodes.get(id);
    fold.fold(view, [n('t1')], true);
    assert.ok(n('g').height < 520, 'the group closed up');
    // Caught by the edge's handle and pulled: opened out, as unfolding opens it.
    n('t1').moveAndResize({ x: 0, y: 0, width: 280, height: n('t1').height + 20 });
    fold.pass(view);
    assert.deepStrictEqual([n('t1').height, n('t3').y, n('g').height, n('below').y], [200, 240, 520, 560]);
    assert.ok(!n('t1').unknownData.drFold);
  });

  await t('the folding menu offers what can be done now, and how folding works', () => {
    const view = fakeCanvas({
      nodes: [card('g', 0, 0, 400, 300, { type: 'group', label: 'G' }), card('a', 20, 20, 100, 50), card('r', 600, 0, 100, 50), card('k', 800, 0, 100, 50)],
      edges: [edge('r', 'k', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const titles = () => fold.foldMenu(view, view.containerEl, null).items.map((i) => i.title);
    assert.deepStrictEqual(titles(), ['Fold every card', 'Fold every group', 'Fold every branch', 'How folding works']);
    fold.foldEverything(view, 'groups');
    assert.deepStrictEqual(titles(), ['Fold every card', 'Unfold every group', 'Fold every branch', 'Unfold everything', 'How folding works']);
  });

  await t('everything at once: inner groups fold first, and unfolding everything opens folds within folds', () => {
    const view = fakeCanvas({
      nodes: [
        card('outer', 0, 0, 600, 500, { type: 'group', label: 'Outer' }),
        card('inner', 20, 40, 300, 200, { type: 'group', label: 'Inner' }),
        card('x', 40, 80, 100, 50),
        card('r', 40, 300, 100, 50),
        card('k', 300, 300, 100, 50),
      ],
      edges: [edge('r', 'k', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    fold.foldEverything(view, 'branches');
    assert.ok(view.canvas.nodes.get('k').unknownData.drTuck);
    fold.foldEverything(view, 'groups');
    const ud = (id) => view.canvas.nodes.get(id).unknownData;
    assert.strictEqual(ud('x').drTuck.by, 'inner');
    assert.strictEqual(ud('inner').drTuck.by, 'outer');
    const model = R.canvasModel(view.canvas);
    assert.deepStrictEqual(fold.foldStatus(model).foldedGroups, 1, 'only the outer one shows');
    fold.foldEverything(view, 'everything');
    ['x', 'inner', 'r', 'k'].forEach((id) => assert.ok(!ud(id).drTuck, `${id} out`));
    ['outer', 'inner'].forEach((id) => assert.ok(!ud(id).drFold, `${id} open`));
    assert.strictEqual(view.canvas.nodes.get('outer').height, 500);
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
