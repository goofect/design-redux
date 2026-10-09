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
const yaml = require('js-yaml');
const notices = [];
const obsidian = new Proxy({
  Menu, Component, ItemView, TFile,
  parseYaml: (t) => yaml.load(t),
  stringifyYaml: (o) => yaml.dump(o),
  Notice: class { constructor(m) { notices.push(m); } },
  setIcon: (el, name) => { el.dataset.icon = name; },
  Platform: { isMobile: false },
  getAllTags: (cache) => (cache.tags || []).map((t) => t.tag),
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
  'CanvasArrange, arrangePlaces, CanvasMindMap, cardTowards, freeSpot, CanvasFind, CanvasFocus, CanvasDuplicate, CanvasCards, PropertiesPanel, cardFrontmatter, CanvasRestructure, outlineFromMarkdown, branchMarkdown, CanvasBranchNote, CanvasOutlineBranch, directedLayout, radialLayout, CanvasLayouts, CanvasRelations, canvasProblems, CanvasVaultMap, vaultMapData, TFile, TFolder, CanvasMinimap, compareCanvases, compareBranches, CanvasCompare, CanvasArguments };\n');
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
    assert.deepStrictEqual(
      Array.from(bar.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
      ['Fold branch', 'Make master card'],
      'a card has no fold of its own'
    );
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
    const p = { settings: Object.assign({}, settings, { canvasArrange: true, canvasMindMap: true, canvasRelink: true }, extra), app: { workspace: { trigger() {} } }, feature: (C) => (C === R.CanvasFold ? fold : null) };
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
    const { p, fold } = plugin({ canvasMindMapPlace: 'line' });
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

  await t('in free space: Tab and Enter put the new card in the nearest gap round the card, nothing else moving', async () => {
    const view = mindCanvas({
      nodes: [
        card('g', -40, -40, 700, 400, { type: 'group', label: 'Theories' }),
        card('root', 0, 100, 200, 60),
        card('k1', 300, 0, 200, 60, { color: '4' }),
        card('k2', 300, 100, 200, 60),
        card('next', 300, 200, 200, 60),
        card('far', 900, 0, 200, 60),
      ],
      edges: [edge('root', 'k1', 'right', 'left'), edge('root', 'k2', 'right', 'left'), edge('root', 'next', 'right', 'left')],
    });
    const { p, fold } = plugin();
    fold.watched.set(view, { file: view.file, schedule() {} });
    const mind = new R.CanvasMindMap(p);
    const n = (id) => view.canvas.nodes.get(id);
    const still = () => ['k1', 'k2', 'next'].map((id) => n(id).y);
    // Tab on the root: level with its children, in the first gap after them.
    const child = await mind.addChild(view, n('root'));
    assert.deepStrictEqual([child.x, child.y], [300, 290]);
    assert.deepStrictEqual(still(), [0, 100, 200], 'nothing moved for it');
    const joined = Array.from(view.canvas.edges.values()).find((e) => e.to.node === child);
    assert.deepStrictEqual([joined.from.node.id, joined.from.side, joined.to.side], ['root', 'right', 'left']);
    // A card with nothing after it: out its free side, past nothing.
    const leaf = await mind.addChild(view, n('far'));
    assert.deepStrictEqual([leaf.x, leaf.y], [1180, 0]);
    // Enter on a card in a full column: below the column, its group grown round it.
    const sibling = await mind.addSibling(view, n('k2'));
    assert.deepStrictEqual([sibling.x, sibling.y], [300, 380]);
    assert.deepStrictEqual(still(), [0, 100, 200]);
    assert.ok(n('g').y + n('g').height >= sibling.y + sibling.height, 'its group grew round it');
    const free = R.freeSpot(R.canvasModel(view.canvas), R.canvasModel(view.canvas).byId.get('root'), { width: 100, height: 40 }, 'left');
    assert.ok(free && free.x + 100 <= 0 - 30, 'out the side asked for, clear of the card');
  });

  await t('a card dropped onto another hangs from it instead, its branch coming along into free space; Undo is one save away', async () => {
    const view = mindCanvas({
      nodes: [
        card('a', 0, 0, 200, 60),
        card('b', 0, 300, 200, 60),
        card('x', 300, 0, 200, 60),
        card('x1', 600, 0, 200, 60),
      ],
      edges: [edge('a', 'x', 'right', 'left'), edge('x', 'x1', 'right', 'left')],
    });
    const { p, fold } = plugin();
    fold.watched.set(view, { file: view.file, schedule() {} });
    const mind = new R.CanvasMindMap(p);
    const state = { file: view.file };
    mind.watched.set(view, state);
    mind.mount(view, state);
    const n = (id) => view.canvas.nodes.get(id);
    view.canvas.removeEdge = (e) => view.canvas.edges.delete(e.id);
    // Pressed, dragged over b, and let go.
    n('x').nodeEl.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    n('x').moveAndResize({ x: 10, y: 300, width: 200, height: 60 });
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true }));
    assert.ok('drDropTarget' in n('b').nodeEl.dataset, 'the card it would hang from is marked');
    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 10));
    assert.ok(!('drDropTarget' in n('b').nodeEl.dataset));
    const into = Array.from(view.canvas.edges.values()).filter((e) => e.to.node === n('x'));
    assert.deepStrictEqual(into.map((e) => e.from.node.id), ['b'], 'its arrow from a gone, one from b');
    // Beside b, out of its way, and its own card along with it, as they were.
    assert.ok(n('x').x >= 200 + 30, 'clear of b');
    assert.strictEqual(n('x1').x - n('x').x, 300);
    assert.strictEqual(n('x1').y - n('x').y, 0);
    assert.ok(view.canvas.saves >= 1);
    // Not onto its own branch.
    assert.strictEqual(await mind.relink(view, { id: 'x', x: n('x').x, y: n('x').y }, n('x1')), false);
    mind.cleanup(view, state);
  });

  await t('Shift+Enter puts a card between a card and its parent, its branch a level out; Shift+Tab and the menu move a card up or down a level', async () => {
    const view = mindCanvas({
      nodes: [
        card('root', 0, 100, 200, 60),
        card('a', 300, 0, 200, 60),
        card('b', 300, 100, 200, 60, { color: '2' }),
        card('c', 300, 200, 200, 60),
        card('a1', 600, 0, 200, 60),
        card('b1', 600, 100, 200, 60),
      ],
      edges: [edge('root', 'a', 'right', 'left'), edge('root', 'b', 'right', 'left'), edge('root', 'c', 'right', 'left'), edge('a', 'a1', 'right', 'left'), edge('b', 'b1', 'right', 'left')],
    });
    view.canvas.removeEdge = (e) => view.canvas.edges.delete(e.id);
    const { p, fold } = plugin({ canvasRestructure: true });
    fold.watched.set(view, { file: view.file, schedule() {} });
    const mind = new R.CanvasMindMap(p);
    const re = new R.CanvasRestructure(p);
    p.feature = (C) => (C === R.CanvasFold ? fold : C === R.CanvasMindMap ? mind : null);
    const n = (id) => view.canvas.nodes.get(id);
    const parentOf = (id) => Array.from(view.canvas.edges.values()).filter((e) => e.to.node === n(id)).map((e) => e.from.node.id);
    const state = { file: view.file };
    re.watched.set(view, state);
    re.mount(view, state);

    // Shift+Enter on b: a new card in its place, joined between; b and its branch a level out.
    view.canvas.selectOnly(n('b'));
    view.containerEl.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((res) => setTimeout(res, 10));
    const made = Array.from(view.canvas.nodes.values()).find((x) => x.id.startsWith('new'));
    assert.ok(made, 'no card made');
    assert.deepStrictEqual([made.x, made.y, made.color], [300, 100, '2']);
    assert.deepStrictEqual(parentOf(made.id), ['root']);
    assert.deepStrictEqual(parentOf('b'), [made.id]);
    assert.deepStrictEqual([n('b').x, n('b1').x], [580, 880], 'b and its branch a level further out');
    assert.deepStrictEqual([n('a').x, n('a1').x, n('c').x], [300, 600, 300], 'off its line, nothing else moves');
    assert.ok(made.isEditing, 'open to type in');

    // Under the card above: c hangs from the new card.
    assert.strictEqual(re.demoteTarget(view, n('a')), null, 'the first has none above it');
    const menu = new Menu();
    re.addMenuItems(menu, [n('c')]);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Add card before', 'Move under the card above']);
    await re.demote(view, n('c'));
    assert.deepStrictEqual(parentOf('c'), [made.id]);

    // Shift+Tab on a1: up to hang from root, as a's sibling.
    view.canvas.selectOnly(n('a1'));
    view.containerEl.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((res) => setTimeout(res, 10));
    assert.deepStrictEqual(parentOf('a1'), ['root']);
    assert.strictEqual(re.promoteTarget(view, n('a1')), null, 'root hangs from nothing');

    // A card hanging from nothing: the new one goes behind it, leading to it.
    const before = await re.addParent(view, n('root'));
    assert.ok(before.x + before.width <= 0, 'behind it, the way its branch grows from');
    assert.deepStrictEqual(parentOf('root'), [before.id]);

    // Switched off, the keys are left alone.
    p.settings.canvasRestructure = false;
    re.cleanup(view, state);
    const count = view.canvas.nodes.size;
    view.canvas.selectOnly(n('c'));
    view.containerEl.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    assert.strictEqual(view.canvas.nodes.size, count);
  });

  await t('an outline from markdown: headings by level, lists under them, code and front matter left out; one heading’s part', () => {
    const shape = (items) => items.map((i) => [i.text, shape(i.children)]);
    const note = '---\ntags: x\n---\n# Law\nIntro\n## Courts ##\n```\n# not a heading\n```\n### Appeal\n## Statute\n- not in a note with headings\n# Politics\n';
    assert.deepStrictEqual(shape(R.outlineFromMarkdown(note, { lists: 'fallback' })), [
      ['Law', [['Courts', [['Appeal', []]]], ['Statute', []]]],
      ['Politics', []],
    ]);
    assert.deepStrictEqual(shape(R.outlineFromMarkdown(note, { lists: 'fallback', subpath: '#Law#Courts' })), [['Appeal', []]]);
    // No headings: its list, by how far in each item is.
    assert.deepStrictEqual(shape(R.outlineFromMarkdown('Title\n- a\n    - a1\n    - [ ] a2\n- b\n1. c\n', { lists: 'fallback' })), [
      ['a', [['a1', []], ['a2', []]]], ['b', []], ['c', []],
    ]);
    // A card's list goes under its headings.
    assert.deepStrictEqual(shape(R.outlineFromMarkdown('Card\n## Part\n- x\n\t- y', { lists: 'always' })), [['Part', [['x', [['y', []]]]]]]);
  });

  await t('a branch as a note: a heading for each card as deep as it is, past six a list, its other words beneath, a note as a link', () => {
    const nodes = [card('r', 0, 0, 100, 50, { text: 'Root\nwhat it is' })];
    const edges = [];
    let prev = 'r';
    for (let i = 1; i <= 7; i++) {
      nodes.push(card(`d${i}`, i * 200, 0, 100, 50, { text: `Depth ${i}` }));
      edges.push(edge(prev, `d${i}`, 'right', 'left'));
      prev = `d${i}`;
    }
    nodes.push(card('z', 200, 300, 100, 50, { type: 'file', file: 'Notes/Zed.md' }));
    nodes.push(card('a', 200, -300, 100, 50, { text: '# Alpha\nfirst\n## inner' }));
    edges.push(edge('r', 'z', 'right', 'left'), edge('r', 'a', 'right', 'left'));
    const model = R.modelFromData({ nodes, edges });
    const text = R.branchMarkdown(model, 'r', null, (rec) => `[[${rec.file.replace(/\.md$/, '').split('/').pop()}]]`);
    assert.strictEqual(text, [
      'what it is', '',
      '# Alpha', '', 'first', '**inner**', '',
      '# Depth 1', '', '## Depth 2', '', '### Depth 3', '', '#### Depth 4', '', '##### Depth 5', '', '###### Depth 6', '',
      '- Depth 7', '',
      '# [[Zed]]', '',
    ].join('\n').replace(/\n+$/, '\n'));
  });

  await t('a text card’s list becomes cards it leads to, a tidy branch in free space; a branch becomes a note beside the canvas', async () => {
    const view = mindCanvas({
      nodes: [card('root', 0, 100, 200, 60, { text: 'Plan\n- one\n  - one a\n- two' }), card('x', 300, 100, 200, 60, { text: 'in the way' })],
      edges: [],
    });
    const canvas = view.canvas;
    canvas.importData = ({ nodes, edges }) => {
      (nodes || []).forEach((d) => canvas.nodes.set(d.id, new FakeNode(canvas, d)));
      (edges || []).forEach((e) => canvas.edges.set(e.id, {
        id: e.id,
        from: { node: canvas.nodes.get(e.fromNode), side: e.fromSide, end: 'none' },
        to: { node: canvas.nodes.get(e.toNode), side: e.toSide, end: 'arrow' },
        lineGroupEl: view.containerEl.createDiv(), lineEndGroupEl: view.containerEl.createDiv(), render() {},
      }));
    };
    const { p, fold } = plugin({ canvasOutlineBranch: true, canvasBranchNote: true });
    fold.watched.set(view, { file: view.file, schedule() {} });
    const mind = new R.CanvasMindMap(p);
    p.feature = (C) => (C === R.CanvasFold ? fold : C === R.CanvasMindMap ? mind : null);
    const out = new R.CanvasOutlineBranch(p);
    const menu = new Menu();
    out.addMenuItems(menu, [canvas.nodes.get('root')]);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Make cards from list']);
    const made = await out.expand(view, canvas.nodes.get('root'));
    const byText = (t) => Array.from(canvas.nodes.values()).find((n) => n.data.text === t);
    const [one, oneA, two] = ['one', 'one a', 'two'].map(byText);
    const parent = (n) => Array.from(canvas.edges.values()).find((e) => e.to.node === n).from.node.id;
    assert.deepStrictEqual([parent(one), parent(oneA), parent(two)], ['root', one.id, 'root']);
    assert.ok(one.y < two.y, 'in the list’s order');
    assert.ok(oneA.x > one.x, 'a level further out');
    const free = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    made.nodes.forEach((n) => assert.ok(free(canvas.nodes.get(n.id), canvas.nodes.get('x')), `${n.text} is on a card`));
    assert.ok(canvas.saves >= 1);

    // And back out: the branch written as a note in the canvas's folder.
    const created = [];
    p.freeChildPath = (folder, base, ext) => `${base}.${ext}`;
    p.app = {
      vault: { create: async (path, text) => { created.push([path, text]); return { path, basename: path.replace(/\.md$/, '') }; }, getFileByPath: () => null },
      metadataCache: {},
      workspace: { trigger() {}, getLeaf: () => ({ openFile: async () => {} }) },
    };
    const note = new R.CanvasBranchNote(p);
    const file = await note.makeNote(view, canvas.nodes.get('root'));
    assert.strictEqual(file.path, 'Plan.md');
    assert.strictEqual(created[0][1], '- one\n  - one a\n- two\n\n# one\n\n## one a\n\n# two\n');
  });

  await t('a branch laid out down, out both sides or all round: in the order it was, the same again when done twice, no cards meeting', async () => {
    const tree = () => R.modelFromData({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, -100, 100, 50), card('b', 200, 0, 100, 50), card('c', 200, 100, 100, 50), card('d', 200, 200, 100, 50), card('a1', 400, -100, 100, 50), card('a2', 400, -30, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left'), edge('r', 'b', 'right', 'left'), edge('r', 'c', 'right', 'left'), edge('r', 'd', 'right', 'left'), edge('a', 'a1', 'right', 'left'), edge('a', 'a2', 'right', 'left')],
    });
    const put = (model, places) => places.forEach((at, id) => Object.assign(model.byId.get(id), at));
    const same = (a, b) => assert.deepStrictEqual(Array.from(a.entries()).sort(), Array.from(b.entries()).sort());
    const meet = (model) => {
      const cards = model.nodes;
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
        const [p, q] = [cards[i], cards[j]];
        if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) return `${p.id} on ${q.id}`;
      }
      return '';
    };

    // Downward: a level below, left to right in the order they ran top to bottom.
    let model = tree();
    let places = R.directedLayout(model, 'r', 'bottom');
    put(model, places);
    assert.deepStrictEqual(['a', 'b', 'c', 'd'].map((id) => model.byId.get(id).y), [130, 130, 130, 130]);
    const xs = ['a', 'b', 'c', 'd'].map((id) => model.byId.get(id).x);
    assert.deepStrictEqual(xs.slice().sort((p, q) => p - q), xs);
    assert.ok(model.byId.get('a1').y > 130 && model.byId.get('a1').x < model.byId.get('a2').x);
    assert.strictEqual(meet(model), '');
    same(R.directedLayout(model, 'r', 'bottom'), places);

    // Both sides, half the cards each: a and its two right, the rest round the left from the bottom up.
    model = tree();
    places = R.directedLayout(model, 'r', 'both');
    put(model, places);
    const at = (id) => model.byId.get(id);
    assert.ok(at('a').x > 100 && at('a1').x > at('a').x, 'a and its branch go right');
    assert.ok(['b', 'c', 'd'].every((id) => at(id).x < 0), 'b, c and d go left');
    assert.ok(at('b').y > at('c').y && at('c').y > at('d').y, 'clockwise: from the bottom up');
    assert.strictEqual(meet(model), '');
    same(R.directedLayout(model, 'r', 'both'), places);

    // All round: the first straight up, then clockwise.
    model = tree();
    places = R.radialLayout(model, 'r');
    put(model, places);
    const mid = (id) => [at(id).x + at(id).width / 2, at(id).y + at(id).height / 2];
    assert.strictEqual(mid('a')[0], 50, 'first straight up');
    assert.ok(mid('a')[1] < 0);
    assert.ok(mid('b')[0] > 50 && mid('d')[0] < 50, 'then right, round to the left');
    assert.strictEqual(meet(model), '');
    same(R.radialLayout(model, 'r'), places);
  });

  await t('Lay out branch, from a card’s menu: its cards glide there, the card stays, one save', async () => {
    const view = mindCanvas({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, -100, 100, 50), card('b', 200, 0, 100, 50), card('c', 200, 100, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left'), edge('r', 'b', 'right', 'left'), edge('r', 'c', 'right', 'left')],
    });
    const { p, fold } = plugin({ canvasLayouts: true });
    fold.watched.set(view, { file: view.file, schedule() {} });
    const lay = new R.CanvasLayouts(p);
    const n = (id) => view.canvas.nodes.get(id);
    const menu = new Menu();
    lay.addMenuItems(menu, [n('r')]);
    assert.ok(menu.items.some((i) => /Lay out branch/.test(i.title)), menu.items.map((i) => i.title).join());
    assert.deepStrictEqual(lay.commands().map((c) => c.id), ['canvas-layout-right', 'canvas-layout-left', 'canvas-layout-down', 'canvas-layout-up', 'canvas-layout-both', 'canvas-layout-radial']);
    const saves = view.canvas.saves;
    await lay.layout(view, n('r'), 'bottom');
    assert.deepStrictEqual([n('r').x, n('r').y], [0, 0], 'the card stays');
    assert.deepStrictEqual(['a', 'b', 'c'].map((id) => n(id).y), [130, 130, 130]);
    assert.ok(view.canvas.saves >= saves, 'saved');
    assert.ok(!lay.hasBranch(view, n('a')), 'a card with nothing below it has nothing to lay out');
  });

  await t('an arrow named for how its cards relate, as its label; one made related is dashed and out of the branch', () => {
    // From a file: a related arrow takes no part in the tree.
    const saved = R.modelFromData({
      nodes: [card('a', 0, 0, 100, 50), card('b', 200, 0, 100, 50), card('c', 200, 100, 100, 50)],
      edges: [edge('a', 'b', 'right', 'left'), edge('a', 'c', 'right', 'left', { drRelated: true })],
    });
    assert.deepStrictEqual(R.arrowLinks(saved).children.get('a'), ['b']);

    const view = fakeCanvas({ nodes: [card('a', 0, 0, 100, 50), card('b', 200, 0, 100, 50), card('c', 200, 100, 100, 50)], edges: [edge('a', 'b', 'right', 'left'), edge('a', 'c', 'right', 'left')] });
    view.canvas.edges.forEach((e) => {
      e.canvas = view.canvas;
      e.unknownData = {};
      e.data = { id: e.id, fromNode: e.from.node.id, toNode: e.to.node.id };
      e.getData = function () { return Object.assign({}, this.data, this.unknownData); };
      e.setData = function (d) { this.data = Object.assign({}, d); };
    });
    const { p, fold } = plugin({ canvasRelations: true, canvasRelationNames: '' });
    fold.watched.set(view, { file: view.file, schedule() {} });
    const rel = new R.CanvasRelations(p);
    rel.watched.set(view, { file: view.file });
    const ac = view.canvas.edges.get('a-c');
    const menu = new Menu();
    rel.addEdgeItems(menu, [ac]);
    const titles = menu.items.map((i) => i.title);
    assert.ok(titles.some((t) => /causes/.test(t)) || titles.includes('Relationship'), titles.join());
    assert.ok(titles.includes('Make related, not a branch'));

    rel.setLabel(view, [ac], 'contrasts with');
    assert.strictEqual(ac.data.label, 'contrasts with');
    const saves = view.canvas.saves;
    rel.setRelated(view, [ac], true);
    assert.strictEqual(ac.unknownData.drRelated, true);
    assert.ok(ac.lineGroupEl.classList.contains('dr-related-edge'));
    assert.ok(view.canvas.saves > saves);
    const live = R.canvasModel(view.canvas);
    assert.deepStrictEqual(R.arrowLinks(live).children.get('a'), ['b'], 'c is out of a’s branch');
    rel.setRelated(view, [ac], false);
    assert.deepStrictEqual(R.arrowLinks(R.canvasModel(view.canvas)).children.get('a'), ['b', 'c']);
    assert.ok(!ac.lineGroupEl.classList.contains('dr-related-edge'));
    // The names are the setting's, when there are some.
    p.settings.canvasRelationNames = 'causes, causes, refutes';
    assert.deepStrictEqual(rel.names(), ['causes', 'refutes']);
  });

  await t('looking a canvas over: loose, empty and twice-named cards, notes gone, and arrows round in a circle', () => {
    const model = R.modelFromData({
      nodes: [
        card('a', 0, 0, 100, 50, { text: 'Rule of law' }),
        card('b', 200, 0, 100, 50, { text: 'Judicial review' }),
        card('c', 400, 0, 100, 50, { text: 'judicial review' }),
        card('e', 0, 200, 100, 50, { text: '  ' }),
        card('f', 200, 200, 100, 50, { type: 'file', file: 'Gone.md' }),
        card('x', 0, 400, 100, 50, { text: 'X' }),
        card('y', 200, 400, 100, 50, { text: 'Y' }),
        card('l', 400, 400, 100, 50, { text: 'Alone' }),
        card('g', -50, -50, 700, 600, { type: 'group', label: 'G' }),
      ],
      edges: [edge('a', 'b', 'right', 'left'), edge('b', 'c', 'right', 'left'), edge('a', 'f', 'bottom', 'top'), edge('x', 'y', 'right', 'left'), edge('y', 'x', 'left', 'right')],
    });
    const found = R.canvasProblems(model, (path) => path !== 'Gone.md').map((p) => `${p.id}: ${p.problem}`);
    assert.deepStrictEqual(found.sort(), [
      'b: On the canvas 2 times',
      'c: On the canvas 2 times',
      'e: Has nothing in it',
      'f: Its file is gone',
      'l: Not joined to anything',
      'x: Its arrows lead round in a circle',
      'y: Its arrows lead round in a circle',
    ].sort().filter((l, i, all) => all.indexOf(l) === i));
  });

  await t('a folder or a tag made into a canvas: its folders or narrower tags as branches, notes as cards, links as related arrows', async () => {
    const folder = (path, parent) => {
      const f = Object.assign(new R.TFolder(), { path, name: path.split('/').pop(), children: [], parent, isRoot: () => !path });
      if (parent) parent.children.push(f);
      return f;
    };
    const note = (path, parent, tags) => {
      const name = path.split('/').pop();
      const f = Object.assign(new R.TFile(), { path, name, basename: name.replace(/\.md$/, ''), extension: 'md', parent, tags, stat: { mtime: 0, ctime: 0 } });
      parent.children.push(f);
      return f;
    };
    const root = folder('', null);
    const law = folder('Law', root);
    const courts = folder('Law/Courts', law);
    folder('Law/Empty', law);
    const files = [
      note('Law/Law.md', law, []), note('Law/Statute.md', law, ['#law']), note('Law/Equity.md', law, []),
      note('Law/Courts/Appeal.md', courts, ['#law/court']), note('Law/Courts/Trial.md', courts, ['#law/court', '#law']),
    ];
    const created = [];
    const opened = [];
    const p = {
      settings: { canvasVaultMap: true, defaultSort: 'name' },
      isFolderNote: (f) => !!f.parent && f.basename === f.parent.name,
      folderNote: (fo) => fo.children.find((c) => c.basename === fo.name) || null,
      orders: { arrangeAlbum: (fo, list, sorter) => sorter(list) },
      freeChildPath: (fo, base, ext) => `${fo.path ? fo.path + '/' : ''}${base}.${ext}`,
      app: {
        vault: {
          getName: () => 'Vault', getRoot: () => root, getMarkdownFiles: () => files,
          create: async (path, text) => { created.push([path, JSON.parse(text)]); return { path }; },
        },
        metadataCache: {
          resolvedLinks: { 'Law/Statute.md': { 'Law/Courts/Appeal.md': 1, 'Elsewhere.md': 1 }, 'Law/Courts/Appeal.md': { 'Law/Statute.md': 2 } },
          getFileCache: (f) => ({ tags: f.tags.map((tag) => ({ tag })) }),
        },
        fileManager: { getNewFileParent: () => root },
        workspace: { getLeaf: () => ({ openFile: async (f) => opened.push(f.path) }) },
      },
    };
    const map = new R.CanvasVaultMap(p);
    await map.mapFolder(law);
    const [path, data] = created[0];
    assert.strictEqual(path, 'Law/Law map.canvas');
    assert.deepStrictEqual(opened, ['Law/Law map.canvas']);
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const name = (n) => (n.type === 'file' ? n.file : n.text);
    const tree = data.edges.filter((e) => !e.drRelated).map((e) => `${name(byId.get(e.fromNode))} > ${name(byId.get(e.toNode))}`);
    assert.deepStrictEqual(tree, [
      'Law/Law.md > Law/Equity.md', 'Law/Law.md > Law/Statute.md', 'Law/Law.md > Courts',
      'Courts > Law/Courts/Appeal.md', 'Courts > Law/Courts/Trial.md',
    ], 'the folder note at the root, notes then folders, an empty folder left out');
    const related = data.edges.filter((e) => e.drRelated).map((e) => [name(byId.get(e.fromNode)), name(byId.get(e.toNode))].sort().join(' ~ '));
    assert.deepStrictEqual(related, ['Law/Courts/Appeal.md ~ Law/Statute.md'], 'a link both ways is one arrow; one to a note not mapped, none');
    const meet = data.nodes.some((a, i) => data.nodes.some((b, j) => j > i && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
    assert.ok(!meet, 'no cards meet');

    await map.mapTag('#law');
    const [tagPath, tagData] = created[1];
    assert.strictEqual(tagPath, 'law map.canvas');
    const tags = new Map(tagData.nodes.map((n) => [n.id, n]));
    const tagTree = tagData.edges.filter((e) => !e.drRelated).map((e) => `${name(tags.get(e.fromNode))} > ${name(tags.get(e.toNode))}`);
    assert.deepStrictEqual(tagTree, ['# #law > Law/Statute.md', '# #law > #court', '#court > Law/Courts/Appeal.md', '#court > Law/Courts/Trial.md'],
      'each note once, under its narrowest tag');
    assert.strictEqual(tagData.edges.filter((e) => e.drRelated).length, 1);
  });

  await t('the minimap: the cards small, the part on screen outlined, there only while they don’t all fit; pressing goes there', () => {
    const view = fakeCanvas({ nodes: [card('a', 0, 0, 100, 50), card('b', 900, 600, 100, 50), card('g', -20, -20, 200, 100, { type: 'group', label: 'G' })], edges: [] });
    const canvas = view.canvas;
    let port = { minX: -100, minY: -100, maxX: 1200, maxY: 800 };
    const looked = [];
    canvas.getViewportBBox = () => port;
    canvas.zoom = 0;
    canvas.setViewport = (x, y, zoom) => looked.push([Math.round(x), Math.round(y), zoom]);
    const mini = new R.CanvasMinimap({ settings: { canvasMinimap: true }, app: {}, saveSettings() {} });
    const state = { file: view.file };
    mini.watched.set(view, state);
    mini.mount(view, state);
    mini.pass(view, state);
    const el = view.contentEl.querySelector('.dr-minimap');
    assert.ok(el.classList.contains('is-hidden'), 'everything fits: no map');
    port = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    mini.pass(view, state);
    assert.ok(!el.classList.contains('is-hidden'));
    assert.strictEqual(el.querySelectorAll('.dr-minimap-card').length, 2);
    assert.strictEqual(el.querySelectorAll('.dr-minimap-group').length, 1);
    const rect = el.querySelector('.dr-minimap-view');
    assert.ok(Number(rect.getAttribute('width')) > 0 && Number(rect.getAttribute('width')) < 200);
    // Pressing the middle of the map: the canvas looks at the middle of its cards, as near as it was.
    const svg = el.querySelector('svg');
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 136 });
    el.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 68 }));
    assert.deepStrictEqual(looked, [[490, 315, 0]]);
    // Off: hidden, and taken away when let go.
    mini.plugin.settings.canvasMinimap = false;
    mini.pass(view, state);
    assert.ok(el.classList.contains('is-hidden'));
    mini.cleanup(view, state);
    assert.ok(!view.contentEl.querySelector('.dr-minimap'));
  });

  await t('a canvas compared with how it was: new, reworded, moved and gone cards, by id or else by title; two branches compared', async () => {
    const then = {
      nodes: [card('a', 0, 0, 100, 50, { text: 'Root' }), card('b', 200, 0, 100, 50, { text: 'Courts' }), card('c', 200, 100, 100, 50, { text: 'Appeal' }), card('d', 200, 200, 100, 50, { text: 'Gone one' }), card('old', 0, 300, 100, 50, { text: 'Copied' })],
      edges: [edge('a', 'b', 'right', 'left'), edge('a', 'c', 'right', 'left'), edge('a', 'd', 'right', 'left')],
    };
    const now = {
      nodes: [card('a', 0, 0, 100, 50, { text: 'Root' }), card('b', 200, 0, 100, 50, { text: 'Law courts' }), card('c', 400, 0, 100, 50, { text: 'Appeal' }), card('e', 200, 200, 100, 50, { text: 'Brand new' }), card('copy', 0, 300, 100, 50, { text: 'Copied' })],
      edges: [edge('a', 'b', 'right', 'left'), edge('b', 'c', 'right', 'left'), edge('a', 'e', 'right', 'left')],
    };
    const found = R.compareCanvases(now, then);
    const ids = (list) => list.map((r) => r.id);
    assert.deepStrictEqual(ids(found.added), ['e']);
    assert.deepStrictEqual(ids(found.removed), ['d']);
    assert.deepStrictEqual(found.reworded, [{ id: 'b', label: 'Law courts', was: 'Courts' }]);
    assert.deepStrictEqual(found.moved.map((r) => [r.id, r.was]), [['c', 'hung from “Root”']], 'a new card isn’t moved as well');
    assert.deepStrictEqual(found.arrows, { added: 2, removed: 2 });

    const tree = R.modelFromData({
      nodes: [card('x', 0, 0, 100, 50), card('y', 0, 300, 100, 50), card('x1', 200, 0, 100, 50, { text: 'Shared' }), card('x2', 200, 60, 100, 50, { text: 'Only X' }), card('y1', 200, 300, 100, 50, { text: 'shared' }), card('y2', 200, 360, 100, 50, { text: 'Only Y' })],
      edges: [edge('x', 'x1', 'right', 'left'), edge('x', 'x2', 'right', 'left'), edge('y', 'y1', 'right', 'left'), edge('y', 'y2', 'right', 'left')],
    });
    const branches = R.compareBranches(tree, 'x', 'y');
    assert.deepStrictEqual([ids(branches.onlyA), ids(branches.onlyB), ids(branches.both)], [['x2'], ['y2'], ['x1']]);

    // On the canvas: marked, counted in a bar, and put back with Done.
    const view = fakeCanvas(now);
    view.canvas.getData = () => now;
    const files = {};
    const p = {
      settings: { canvasCompare: true },
      manifest: { dir: '.obsidian/plugins/design-redux' },
      app: { vault: { adapter: { exists: async (f) => f in files, read: async (f) => files[f], write: async (f, t) => { files[f] = t; } } }, workspace: { trigger() {} } },
      feature: () => null,
    };
    const cmp = new R.CanvasCompare(p);
    const state = { file: view.file };
    cmp.watched.set(view, state);
    view.file.path = 'Map.canvas';
    await cmp.keepSnapshot(view);
    assert.ok(JSON.parse(files['.obsidian/plugins/design-redux/canvas-snapshots.json'])['Map.canvas'].data);
    cmp.showVersions(view, then, 'the snapshot');
    const cls = (id) => Array.from(view.canvas.nodes.get(id).nodeEl.classList).filter((c) => c.startsWith('dr-diff')).join();
    assert.deepStrictEqual([cls('e'), cls('b'), cls('c'), cls('a')], ['dr-diff-added', 'dr-diff-reworded', 'dr-diff-moved', '']);
    const bar = view.contentEl.querySelector('.dr-compare-bar');
    assert.strictEqual(bar.querySelector('.dr-compare-counts').textContent, '1 new1 gone1 reworded1 moved4 arrows changed');
    Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === 'Done').click();
    assert.ok(!view.contentEl.querySelector('.dr-compare-bar'));
    assert.strictEqual(cls('e'), '');
  });

  await t('arguments: a card given a part shows it above itself; a reason or objection added names its arrow; a claim counts for and against', async () => {
    const view = mindCanvas({ nodes: [card('c', 0, 0, 250, 60, { text: 'Judicial review constrains legislatures' })], edges: [] });
    const canvas = view.canvas;
    const plain = canvas.importData;
    canvas.importData = (d) => {
      plain(d);
      (d.edges || []).forEach((e) => {
        const live = canvas.edges.get(e.id);
        live.data = Object.assign({}, e);
        live.getData = () => Object.assign({}, live.data);
        live.setData = (x) => { live.data = x; };
      });
    };
    const { p, fold } = plugin({ canvasArguments: true });
    fold.watched.set(view, { file: view.file, schedule() {} });
    const mind = new R.CanvasMindMap(p);
    p.feature = (C) => (C === R.CanvasFold ? fold : C === R.CanvasMindMap ? mind : null);
    const arg = new R.CanvasArguments(p);
    arg.watched.set(view, { file: view.file });
    const claim = canvas.nodes.get('c');
    const menu = new Menu();
    arg.addMenuItems(menu, [claim]);
    assert.ok(menu.items.some((i) => /Argument/.test(i.title)), menu.items.map((i) => i.title).join());
    arg.setRole(view, [claim], 'claim');
    assert.strictEqual(claim.unknownData.drRole, 'claim');
    assert.strictEqual(claim.nodeEl.dataset.drRoleLabel, 'Claim');
    const reason = await arg.addAnswer(view, claim, 'reason');
    const objection = await arg.addAnswer(view, claim, 'objection');
    assert.deepStrictEqual([reason.unknownData.drRole, objection.unknownData.drRole], ['reason', 'objection']);
    const labelTo = (n) => Array.from(canvas.edges.values()).find((e) => e.to.node === n).data.label;
    assert.deepStrictEqual([labelTo(reason), labelTo(objection)], ['supports', 'opposes']);
    arg.pass(view);
    assert.strictEqual(claim.nodeEl.dataset.drRoleLabel, 'Claim · 1 for, 1 against');
    assert.strictEqual(objection.nodeEl.dataset.drRole, 'objection');
    // No part, and switched off: nothing shown.
    arg.setRole(view, [objection], null);
    assert.ok(!('drRole' in objection.nodeEl.dataset));
    p.settings.canvasArguments = false;
    arg.pass(view);
    assert.ok(!('drRole' in claim.nodeEl.dataset));
  });

  await t('a card grows to fit what’s typed in it, a card below moving just far enough, and shrinks back no further than it was', () => {
    const view = fakeCanvas({ nodes: [card('a', 0, 0, 200, 60), card('b', 0, 100, 200, 60), card('c', 0, 300, 200, 60), card('side', 300, 70, 100, 60)], edges: [] });
    const cards = new R.CanvasCards({ settings: { canvasCardFit: true, canvasCardTitles: true }, app: {} });
    const n = (id) => view.canvas.nodes.get(id);
    const a = n('a');
    // Its editor, with text this tall.
    let text = 40;
    a.isEditing = true;
    a.child = { editMode: { cm: { get contentHeight() { return text; }, scrollDOM: { get clientHeight() { return a.height - 2; }, get scrollHeight() { return Math.max(a.height - 2, text + 10); } } } } };
    const state = { fitting: new Map() };
    cards.fitEditing(view, state);
    assert.strictEqual(a.height, 60, 'it fits already');
    text = 140;
    cards.fitEditing(view, state);
    assert.strictEqual(a.height, 152);
    assert.deepStrictEqual(['b', 'c', 'side'].map((id) => n(id).y), [182, 382, 70], 'b moved just clear of it, what was below with it; off to the side stays');
    text = 30;
    cards.fitEditing(view, state);
    assert.strictEqual(a.height, 60, 'no shorter than when typing began');
    assert.strictEqual(view.canvas.saves, 0);
    a.isEditing = false;
    cards.fitEditing(view, state);
    assert.strictEqual(view.canvas.saves, 1, 'saved once typing ended');
    // Marked as text cards, for their title and details.
    const sizer = a.nodeEl.createDiv({ cls: 'markdown-preview-sizer' });
    sizer.createDiv({ cls: 'markdown-preview-pusher' });
    sizer.createDiv({ cls: 'el-p' }).innerHTML = '<p>Speaker of the House of Commons<br>Chairs the debates</p>';
    cards.pass(view);
    assert.ok(a.nodeEl.classList.contains('dr-text-card'));
    // Its whole first line is its title, however it wraps; the rest isn't.
    assert.strictEqual(sizer.querySelector('p').innerHTML, '<span class="dr-card-title">Speaker of the House of Commons</span><br>Chairs the debates');
    cards.pass(view);
    assert.strictEqual(sizer.querySelectorAll('.dr-card-title').length, 1, 'wrapped once');
  });

  await t('the properties button: a note card’s note, or a text card’s own properties, kept at its top', () => {
    const view = fakeCanvas({ nodes: [card('t', 0, 0, 200, 60, { text: '---\nstatus: draft\ntags:\n  - ir\n---\nRealism\nStates seek power.' }), card('u', 0, 100, 200, 60)], edges: [] });
    const t1 = view.canvas.nodes.get('t');
    t1.setText = (text) => { t1.data.text = text; };
    const app = { vault: { getAbstractFileByPath: () => null }, workspace: { on: () => ({}) } };
    const panel = new R.PropertiesPanel({ settings: { propertiesDropdown: true }, app });
    panel.popupEl = document.body.createDiv({ cls: 'dr-props-popup' });
    const leaf = { view };
    assert.deepStrictEqual(panel.targetOf(leaf), { none: 'Select a card to see its properties.' });
    view.canvas.selection.add(t1);
    assert.strictEqual(panel.targetOf(leaf).card, t1);
    const anchor = document.body.createDiv();
    panel.toggle(leaf, anchor);
    assert.ok(panel.isOpen());
    assert.strictEqual(panel.popupEl.querySelector('.dr-props-title').textContent, 'Realism');
    const rows = () => Array.from(panel.popupEl.querySelectorAll('.dr-card-props-row')).map((r) => [r.querySelector('.dr-card-props-key').textContent, r.querySelector('input').value]);
    assert.deepStrictEqual(rows(), [['status', 'draft'], ['tags', 'ir']]);
    // Changed, added, taken away: written at the card's top, its text left as it was.
    panel.setCardProperty('status', R.cardFrontmatter(t1.data.text).data.status === 'draft' ? 'done' : 'x');
    panel.setCardProperty('year', 1979);
    panel.setCardProperty('tags', undefined);
    assert.deepStrictEqual(R.cardFrontmatter(t1.data.text), { data: { status: 'done', year: 1979 }, body: 'Realism\nStates seek power.' });
    assert.deepStrictEqual(rows(), [['status', 'done'], ['year', '1979']]);
    assert.strictEqual(view.canvas.saves, 3);
    panel.setCardProperty('status', undefined);
    panel.setCardProperty('year', undefined);
    assert.strictEqual(t1.data.text, 'Realism\nStates seek power.', 'none left: no --- lines');
    panel.close();
    panel.popupEl.remove();
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
    // Several at once, any card — even one at the top of its tree, with nothing above it yet.
    ['r', 'a', 'k'].forEach((id) => view.canvas.selection.add(n(id)));
    fold.pass(view);
    assert.strictEqual(crown.getAttribute('aria-label'), 'Make 4 master cards');
    crown.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepStrictEqual(['r', 'a', 'm', 'k'].map((id) => !!n(id).unknownData.drMaster), [true, true, true, true]);
    assert.strictEqual(crown.getAttribute('aria-label'), 'Master cards: on');
    fold.setMaster(view, [n('r')], false);
    const several = new Menu();
    fold.addMenuItems(several, ['a', 'm'].map(n));
    assert.deepStrictEqual(several.items.map((i) => i.title), ['Master cards']);
    several.items[0].click();
    assert.deepStrictEqual(['a', 'm', 'k'].map((id) => !!n(id).unknownData.drMaster), [false, false, true]);
    fold.setMaster(view, [n('k')], false);
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
    // Any card, even one at the top of its tree.
    menu = new Menu();
    fold.addMenuItems(menu, [n('r')]);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Fold branch', 'Master card']);
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

  await t('a group holding nothing but a branch’s cards folds away with them, and comes back where it was', async () => {
    const view = fakeCanvas({
      nodes: [
        card('outer', -40, -80, 900, 520, { type: 'group', label: 'Theories' }),
        card('r', 0, 100, 100, 50),
        card('a', 200, 100, 100, 50),
        card('kids', 360, -40, 300, 340, { type: 'group', label: 'Readings' }),
        card('inner', 380, 160, 260, 120, { type: 'group', label: 'Waltz' }),
        card('a1', 400, 0, 100, 50),
        card('a2', 400, 200, 100, 50),
        card('below', -40, 500, 300, 60),
      ],
      edges: [edge('r', 'a', 'right', 'left'), edge('a', 'a1', 'right', 'left'), edge('a', 'a2', 'right', 'left')],
    });
    const fold = new R.CanvasFold({ settings, app: {} });
    fold.watched.set(view, { file: view.file });
    const n = (id) => view.canvas.nodes.get(id);
    const where = () => Array.from(view.canvas.nodes.values()).map((c) => [c.id, c.x, c.y, c.width, c.height]);
    const start = where();
    await fold.foldBranches(view, [n('a')], true);
    // Readings and Waltz, inside it, hold only a's cards: folded away with them. Theories holds a too: it stays.
    assert.deepStrictEqual(['a1', 'a2', 'kids', 'inner', 'outer'].map((id) => (n(id).unknownData.drTuck || {}).by || null), ['a', 'a', 'a', 'a', null]);
    assert.ok(n('kids').nodeEl.classList.contains('dr-tucked'));
    // The count is of cards.
    assert.strictEqual(n('a').nodeEl.querySelector('.dr-branch-knob').textContent, '+2');
    // Theories closes up round what it still shows, and what's below it follows.
    assert.ok(n('outer').height < 520 && n('below').y < 500);
    await fold.foldBranches(view, [n('a')], false);
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
