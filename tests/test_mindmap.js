// The mind-map view against the real main.js, in jsdom: a note's list
// drawn as a map, only what's on screen; selection and arrow keys; fold
// and what it writes; the takeover of a flagged note and "Open as text";
// a file that can't be read; a 2,000-node map opened and panned.
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
P.setText = function (t) { this.textContent = t; };

class Component {
  registerEvent() {}
  register() {}
  registerDomEvent(el, type, fn, opts) { el.addEventListener(type, fn, opts); }
}
class ItemView extends Component {
  constructor(leaf) { super(); this.leaf = leaf; this.containerEl = document.createElement('div'); this.contentEl = this.containerEl.createDiv({ cls: 'view-content' }); }
  addAction() {}
}
class TextFileView extends ItemView {
  constructor(leaf) { super(leaf); this.data = ''; this.saves = 0; }
  requestSave() { this.saves++; }
}
class TFile {
  constructor(p) { this.path = p; this.name = p.split('/').pop(); this.extension = this.name.split('.').pop(); this.basename = this.name.replace(/\.[^.]+$/, ''); }
}
const obsidian = new Proxy({
  Component, ItemView, TextFileView, TFile,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class {},
  Platform: { isMobile: false },
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_mindmap_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { MindMapView, MindMaps, MINDMAP_VIEW, isMindMapNote, keepAsText, keptAsText, takeOverLeaves, layoutScene, estimateSize, nodeLabel, DEFAULTS, dropTarget, MINDMAP_HANDLERS, registerMindMapHandlers, actionCommands, setMindMapContext, mapLayout, modelFromData, arrowLinks, BRANCH_LAYOUTS, setBranchLayout, setNudge, nodeNudge, setAttr, setText, addChild, setLegendName, setSavedView, setMapLayout, SETTINGS_MIGRATIONS, branchLayoutOf, setRelationMeaning, relationTypes, statementsMarkdown, nodeParts, branchNoteText, relinkText, mapProblems, compareMaps, compareMapBranches, parseOutline, nodeById, mapPresentation, Notes, albumEntry, moveNode, removeNode, mapFromCanvas, canvasFromMap, writeOutline, writeMindmapJson, parseMindmapJson, layoutScene, Knowledge };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const pointer = (el, type, x, y) => {
  const evt = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0, button: 0 });
  el.dispatchEvent(evt);
};

const plugin = { settings: JSON.parse(JSON.stringify(R.DEFAULTS)), saveSettings: async () => {} };
const feature = { plugin, openAsText: () => {} };
async function open(text, name = 'Plan.md') {
  const view = new R.MindMapView({}, feature);
  view.file = new TFile(name);
  document.body.appendChild(view.containerEl);
  await view.onOpen();
  view.setViewData(text, true);
  return view;
}
// As Obsidian passes a change made outside: its own `data` set first, then the view told.
const changedOutside = (view, text) => {
  view.data = text;
  view.setViewData(text, false);
};
const shown = (view) => Array.from(view.contentEl.querySelectorAll('.dr-mindmap-node')).map((el) => el.textContent.replace(/\d+$/, ''));

const NOTE = '---\nmindmap: true\n---\n- Launch plan ^root\n\t- Research\n\t\t- [[Competitor notes]]\n\t\t- Interview script\n\t- Build\n\t\t- API\n\t\t- UI\n\t- Ship\n';

(async () => {
  await t('the view’s parts write none of the names Obsidian calls on a view itself', async () => {
    // Obsidian calls these on every view; one written over (load, as it was once) leaves the tab empty.
    const OBSIDIAN = ['load', 'onload', 'unload', 'onunload', 'addChild', 'removeChild', 'register', 'registerEvent', 'registerDomEvent', 'registerInterval',
      'getState', 'setState', 'getEphemeralState', 'setEphemeralState', 'onResize', 'onPaneMenu', 'onHeaderMenu', 'close', 'open', 'handleDrop', 'onFileOpen',
      'loadFile', 'onLoadFile', 'onUnloadFile', 'onRename', 'save', 'requestSave', 'canAcceptExtension', 'getViewType', 'getDisplayText', 'getIcon', 'getViewData', 'setViewData', 'clear', 'onOpen', 'onClose'];
    const own = Object.getOwnPropertyNames(R.MindMapView.prototype);
    const meant = ['canAcceptExtension', 'getViewType', 'getDisplayText', 'getIcon', 'getViewData', 'setViewData', 'clear', 'onOpen', 'onClose', 'onResize'];
    assert.deepStrictEqual(own.filter((n) => OBSIDIAN.includes(n) && !meant.includes(n)), []);
  });

  await t('a note’s list drawn as a map: a box for each node, an edge for each branch, the root at the middle', async () => {
    const view = await open(NOTE);
    assert.deepStrictEqual(shown(view).sort(), ['API', 'Build', 'Competitor notes', 'Interview script', 'Launch plan', 'Research', 'Ship', 'UI']);
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-mindmap-edge').length, 7);
    const root = view.contentEl.querySelector('.dr-mindmap-node.is-root');
    assert.strictEqual(root.textContent.replace(/\d+$/, ''), 'Launch plan');
    const b = view.scene.boxes;
    assert.ok(b.get(view.model.root.children[0].id).x > b.get(view.model.root.id).x, 'to the right of the root');
    const kids = view.model.root.children.map((c) => b.get(c.id).y);
    assert.deepStrictEqual(kids.slice().sort((x, y) => x - y), kids, 'siblings in the list’s order');
    assert.strictEqual(view.contentEl.querySelector('.dr-mindmap').getAttribute('role'), 'tree');
  });

  await t('select with a click, walk with the arrow keys, fold with Space — the fold written to the note, its lines otherwise as they were', async () => {
    const view = await open(NOTE);
    const node = (label) => Array.from(view.contentEl.querySelectorAll('.dr-mindmap-node')).find((el) => el.textContent.replace(/\d+$/, '') === label);
    pointer(node('Build'), 'pointerdown');
    assert.strictEqual(view.contentEl.querySelector('.is-selected').textContent.replace(/\d+$/, ''), 'Build');
    const map = view.contentEl.querySelector('.dr-mindmap');
    key(map, 'ArrowRight');
    assert.strictEqual(view.contentEl.querySelector('.is-selected').textContent, 'API', 'right: into the branch');
    key(map, 'ArrowDown');
    assert.strictEqual(view.contentEl.querySelector('.is-selected').textContent, 'UI', 'down: the next sibling');
    key(map, 'ArrowLeft');
    key(map, 'ArrowUp');
    assert.strictEqual(view.contentEl.querySelector('.is-selected').textContent.replace(/\d+$/, ''), 'Research');
    key(map, ' ');
    assert.ok(!shown(view).includes('Interview script'), 'folded away');
    assert.strictEqual(node('Research').querySelector('.dr-mindmap-knob').textContent, '2', 'the fold says how many it holds');
    assert.strictEqual(view.saves, 0, 'written a moment later, not at once');
    await settle(450);
    assert.strictEqual(view.saves, 1);
    assert.strictEqual(view.text, NOTE.replace('\t- Research\n', '\t- Research %%{"fold":1}%%\n'), 'only its own line changed');
    // The knob unfolds.
    pointer(node('Research').querySelector('.dr-mindmap-knob'), 'pointerdown');
    view.flushSave();
    assert.strictEqual(view.text, NOTE, 'and back, byte for byte');
    view.foldAll(true);
    assert.deepStrictEqual(shown(view).sort(), ['Build', 'Launch plan', 'Research', 'Ship']);
    view.foldAll(false);
    view.flushSave();
    assert.strictEqual(view.text, NOTE);
  });

  await t('only what’s on screen is drawn; a pan draws what comes into view', async () => {
    const view = await open(NOTE);
    view.camera = { x: 0, y: 0, zoom: 1 };
    view.draw();
    const all = shown(view).length;
    view.camera = { x: 20000, y: 20000, zoom: 1 };
    view.draw();
    assert.strictEqual(shown(view).length, 0, 'nothing there');
    const map = view.contentEl.querySelector('.dr-mindmap');
    view.fit();
    pointer(map, 'pointerdown', 500, 300);
    pointer(map, 'pointermove', 400, 300);
    pointer(map, 'pointerup', 400, 300);
    await settle();
    assert.ok(view.camera.x !== 0 && shown(view).length === all, 'dragged the background: panned');
    const z = view.camera.zoom;
    map.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.ok(view.camera.zoom > z, 'Ctrl and the wheel: zoomed in');
  });

  await t('a list of several items at the top: the note stands for the root; a .mindmap file reads the same', async () => {
    const view = await open('- Alpha\n- Beta\n  - Beta one\n', 'Topics.md');
    assert.ok(view.model.root.virtual);
    assert.strictEqual(view.contentEl.querySelector('.is-virtual').textContent, 'Topics');
    const json = await open('{\n  "v": 1,\n  "root": { "id": "r", "text": "Centre", "children": [ { "id": "a", "text": "Spoke", "fold": true, "children": [ { "id": "b", "text": "Hidden" } ] } ] }\n}\n', 'Diagram.mindmap');
    assert.deepStrictEqual(shown(json).sort(), ['Centre', 'Spoke']);
    json.toggleFold('a');
    assert.ok(shown(json).includes('Hidden'));
    json.flushSave();
    assert.ok(json.text.startsWith('{\n  "v": 1,\n  "root": {\n    "id": "r",'), 'written as a .mindmap file');
  });

  await t('a file that can’t be read is shown as it is, with what went wrong, and never written', async () => {
    const view = await open('{ broken', 'Broken.mindmap');
    assert.ok(view.contentEl.querySelector('.dr-mindmap-failure'));
    assert.ok(view.contentEl.querySelector('.dr-mindmap-failure-text').textContent.includes('{ broken'));
    view.foldAll(true);
    view.flushSave();
    assert.strictEqual(view.saves, 0);
  });

  await t('the outline beside the map is the same tree; a row goes to its node', async () => {
    const view = await open(NOTE);
    view.toggleOutline();
    const rows = Array.from(view.contentEl.querySelectorAll('.dr-mindmap-outline-row'));
    assert.deepStrictEqual(rows.map((r) => r.textContent), ['Launch plan', 'Research', 'Competitor notes', 'Interview script', 'Build', 'API', 'UI', 'Ship']);
    rows[5].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(view.contentEl.querySelector('.dr-mindmap-node.is-selected').textContent, 'API');
  });

  await t('a flagged note is taken over, unless its tab was asked for text', async () => {
    const file = new TFile('Plan.md');
    const set = [];
    const leaf = { view: { file }, setViewState: async (s) => set.push(s) };
    const app = {
      metadataCache: { getFileCache: (f) => (f === file ? { frontmatter: { mindmap: true } } : null) },
      workspace: { activeLeaf: leaf, getLeavesOfType: (type) => (type === 'markdown' ? [leaf] : []) },
    };
    assert.ok(R.isMindMapNote(app, file));
    assert.ok(!R.isMindMapNote(app, new TFile('Other.md')));
    await R.takeOverLeaves(app);
    assert.deepStrictEqual(set, [{ type: R.MINDMAP_VIEW, state: { file: 'Plan.md' }, active: true }]);
    R.keepAsText(leaf, 'Plan.md', true);
    await R.takeOverLeaves(app);
    assert.strictEqual(set.length, 1, 'asked for text: left as text');
    assert.ok(R.keptAsText(leaf, 'Plan.md'));
  });

  await t('editing with the keys: Enter adds after, Tab under, typing starts a node over, Delete removes; Alt and the arrows move — each one step of Undo', async () => {
    const view = await open(NOTE);
    const map = view.contentEl.querySelector('.dr-mindmap');
    const sel = () => view.contentEl.querySelector('.is-selected').textContent.replace(/\d+$/, '');
    const kids = (text) => { let f = null; (function w(n) { if (n.text === text) f = n; n.children.forEach(w); })(view.model.root); return f.children.map((c) => c.text); };
    view.select(view.model.root.children[2].id);
    key(map, 'Enter');
    assert.ok(view.editing, 'a node after Ship, being typed in');
    view.editing.editor.dispatch({ changes: { from: 0, insert: 'Launch' } });
    view.editing.editor.contentDOM.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.ok(!view.editing);
    assert.deepStrictEqual(view.model.root.children.map((c) => c.text), ['Research', 'Build', 'Ship', 'Launch']);
    key(map, 'Tab');
    view.editing.editor.dispatch({ changes: { from: 0, insert: 'Party' } });
    view.closeEditor(true);
    assert.deepStrictEqual(kids('Launch'), ['Party']);
    key(map, 'x');
    assert.strictEqual(view.editing.editor.state.doc.toString(), 'x', 'typing on a node starts it over');
    view.closeEditor(true);
    assert.deepStrictEqual(kids('Launch'), ['x']);
    view.select(view.model.root.children[1].children[0].id);
    key(map, 'ArrowDown');
    assert.strictEqual(sel(), 'UI');
    map.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
    assert.deepStrictEqual(kids('Build'), ['UI', 'API'], 'Alt and up: a step up');
    key(map, 'Delete');
    assert.deepStrictEqual(kids('Build'), ['API']);
    // Undo, step by step: the delete, the move, the typing, the child with its name, the new node with its.
    const z = (shift) => map.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: !!shift, bubbles: true, cancelable: true }));
    z();
    assert.deepStrictEqual(kids('Build'), ['UI', 'API']);
    z();
    assert.deepStrictEqual(kids('Build'), ['API', 'UI']);
    z();
    assert.deepStrictEqual(kids('Launch'), ['Party']);
    z();
    assert.deepStrictEqual(kids('Launch'), [], 'a node added and named: one step');
    z();
    assert.deepStrictEqual(view.model.root.children.map((c) => c.text), ['Research', 'Build', 'Ship']);
    view.flushSave();
    assert.strictEqual(view.text, NOTE, 'undone all the way: the note as it was');
    z(true);
    assert.deepStrictEqual(view.model.root.children.map((c) => c.text), ['Research', 'Build', 'Ship', 'Launch'], 'redone, named');
  });

  await t('a node dragged onto another hangs there; onto its edge, beside it — not into its own branch', async () => {
    const view = await open(NOTE);
    const id = (text) => { let f = null; (function w(n) { if (n.text === text) f = n.id; n.children.forEach(w); })(view.model.root); return f; };
    const at = (text, part) => { const b = view.scene.boxes.get(id(text)); return { x: b.x + b.width / 2, y: b.y + b.height * part }; };
    assert.deepStrictEqual(R.dropTarget(view.model, view.scene, id('Ship'), at('API', 0.5), false), { parentId: id('API'), index: 0, target: id('API'), zone: 'child' });
    assert.deepStrictEqual(R.dropTarget(view.model, view.scene, id('Ship'), at('API', 0.1), false).zone, 'before');
    assert.strictEqual(R.dropTarget(view.model, view.scene, id('Build'), at('API', 0.5), false), null, 'not into its own branch');
    view.dropNode({ node: id('Ship'), target: R.dropTarget(view.model, view.scene, id('Ship'), at('UI', 0.9), false) });
    const build = view.model.root.children.find((c) => c.text === 'Build');
    assert.deepStrictEqual(build.children.map((c) => c.text), ['API', 'UI', 'Ship']);
  });

  await t('every layout puts the nodes where the canvas’s mind map puts the same cards, within a pixel — a branch with its own layout and a nudge too', async () => {
    const view = await open(NOTE);
    const byText = (text) => { let f = null; (function w(n) { if (n.text === text) f = n; n.children.forEach(w); })(view.model.root); return f; };
    // The same cards on a canvas, set out in the list's order, laid out by the canvas's own map engine.
    const onCanvas = (mode, own, nudges) => {
      const nodes = [];
      const edges = [];
      let order = 0;
      (function w(n, depth) {
        const b = view.scene.boxes.get(n.id);
        const along = depth * 1000 * (mode === 'left' || mode === 'top' ? -1 : 1);
        const across = depth ? ++order * 1000 : 0;
        const down = mode === 'bottom' || mode === 'top';
        nodes.push({ id: n.id, type: 'text', x: down ? across : along, y: down ? along : across, width: b.width, height: b.height });
        if (n.parent) edges.push({ id: `e${n.id}`, fromNode: n.parent.id, toNode: n.id });
        n.children.forEach((c) => w(c, depth + 1));
      })(view.model.root, 0);
      const cards = R.modelFromData({ nodes, edges });
      cards.nodes.forEach((r) => {
        const kept = {};
        if (r.id === view.model.root.id) kept.drLayout = mode;
        if (own[r.id]) kept.drLayout = own[r.id];
        if (nudges[r.id]) kept.drNudge = { dx: nudges[r.id][0], dy: nudges[r.id][1] };
        r.node = { unknownData: kept };
      });
      return R.mapLayout(cards, R.arrowLinks(cards)).places;
    };
    const same = (mode, own, nudges) => {
      const places = onCanvas(mode, own, nudges);
      view.scene.boxes.forEach((b, id) => {
        const at = places.get(id);
        assert.ok(at && Math.abs(at.x - b.x) <= 1 && Math.abs(at.y - b.y) <= 1, `${mode}: ${id} at ${b.x},${b.y}; on the canvas ${at && at.x},${at && at.y}`);
      });
    };
    for (const [mode] of R.BRANCH_LAYOUTS) {
      view.apply(R.setBranchLayout(view.model, view.model.root.id, mode));
      assert.strictEqual(view.mode, mode);
      same(mode, {}, {});
    }
    view.apply(R.setBranchLayout(view.model, view.model.root.id, 'right'));
    const build = byText('Build');
    view.apply(R.setBranchLayout(view.model, build.id, 'bottom'));
    assert.ok(build.anchor, 'a branch with a layout of its own gets its id');
    const research = byText('Research');
    view.apply(R.setNudge(view.model, research.id, 30, -20));
    same('right', { [build.id]: 'bottom' }, { [research.id]: [30, -20] });
    // The edges of the branch laid out downward go down.
    assert.strictEqual(view.scene.boxes.get(byText('API').id).way, 'bottom');
  });

  await t('a node dropped clear of the others stays where it’s put, its branch with it; Undo and Tidy put it back; the note keeps it by its id', async () => {
    const view = await open(NOTE);
    const build = view.model.root.children[1];
    const api = build.children[0];
    const before = Object.assign({}, view.scene.boxes.get(build.id));
    const apiBefore = Object.assign({}, view.scene.boxes.get(api.id));
    view.dropNode({ node: build.id, target: null, x: 100, y: 100, last: { x: 160, y: 140 } });
    const z = view.camera.zoom;
    const b = view.scene.boxes.get(build.id);
    assert.ok(Math.abs(b.x - before.x - 60 / z) <= 1 && Math.abs(b.y - before.y - 40 / z) <= 1, 'moved as far as it was dragged');
    assert.ok(Math.abs(view.scene.boxes.get(api.id).x - apiBefore.x - 60 / z) <= 1, 'its branch came along');
    view.flushSave();
    const id = build.id;
    assert.ok(view.text.includes(`\t- Build ^${id}\n`), 'given its id in the note');
    assert.ok(view.text.includes('```design-redux-layout') && view.text.includes(`"${id}":[`), 'the nudge in the layout block');
    // Read again: the same nudge, on the same node.
    const again = await open(view.text);
    assert.deepStrictEqual(R.nodeNudge(again.model, id), R.nodeNudge(view.model, id));
    view.undoStep(false);
    assert.deepStrictEqual(view.scene.boxes.get(build.id).x, before.x, 'undone');
    view.undoStep(true);
    R.registerMindMapHandlers();
    R.MINDMAP_HANDLERS.get('canvas-map-tidy').run({ view, model: view.model, node: null });
    assert.deepStrictEqual(view.scene.boxes.get(build.id).x, before.x, 'tidied: back in its place');
    assert.strictEqual(view.model.layout, null, 'nothing left in the layout block');
  });

  await t('nodes glide to their places as a branch folds — not while typing, not with the setting off, never when less motion is asked for', async () => {
    let reduce = false;
    const frames = [];
    window.matchMedia = (q) => ({ matches: q.includes('reduced-motion') ? reduce : q.includes('any-hover'), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    const realFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = (fn) => (frames.push(fn), frames.length);
    const run = (ms) => { const fns = frames.splice(0); fns.forEach((fn) => fn(window.performance.now() + ms)); };
    try {
      const view = await open(NOTE);
      const build = view.model.root.children[1];
      const el = () => view.renderer.nodeEls.get(build.id);
      const was = parseFloat(el().style.top);
      view.toggleFold(view.model.root.children[0].id);
      const end = view.scene.boxes.get(build.id).y;
      assert.ok(view.gliding, 'gliding');
      assert.strictEqual(parseFloat(el().style.top), was, 'from where it was');
      run(120);
      const mid = parseFloat(el().style.top);
      assert.ok(mid !== was && mid !== end, `part of the way: ${was} → ${mid} → ${end}`);
      run(400);
      assert.ok(!view.gliding && parseFloat(el().style.top) === end, 'there');
      view.edit(build.id);
      view.typed('Build it all the way through');
      assert.ok(!view.gliding, 'typing: no glide');
      view.closeEditor(true);
      plugin.settings.mindmapGlide = false;
      view.toggleFold(view.model.root.children[0].id);
      assert.ok(!view.gliding, 'setting off');
      plugin.settings.mindmapGlide = true;
      reduce = true;
      view.toggleFold(view.model.root.children[0].id);
      assert.ok(!view.gliding, 'less motion asked for');
    } finally {
      delete window.matchMedia;
      window.requestAnimationFrame = realFrame;
    }
  });

  await t('a peek into a folded branch lists what it holds; picking one opens the way to it, in one step', async () => {
    window.matchMedia = (q) => ({ matches: q.includes('any-hover'), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    try {
      const view = await open(NOTE);
      const map = view.contentEl.querySelector('.dr-mindmap');
      const research = view.model.root.children[0];
      view.toggleFold(research.id);
      view.select(research.id);
      map.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true, cancelable: true }));
      assert.ok(research.attrs.fold, 'Shift-Space peeks; it doesn’t unfold');
      const rows = () => Array.from(document.querySelectorAll('.dr-fold-pop .dr-fold-list-row')).map((r) => r.textContent);
      assert.deepStrictEqual(rows(), ['Competitor notes', 'Interview script']);
      document.querySelectorAll('.dr-fold-pop .dr-fold-list-row')[1].click();
      assert.ok(!research.attrs.fold && !document.querySelector('.dr-fold-pop'), 'opened, the peek gone');
      assert.strictEqual(view.selected, research.children[1].id, 'and gone to');
      view.undoStep(false);
      assert.ok(research.attrs.fold, 'one step of Undo');
      // Pointing at the count, a moment: the same list.
      const knob = view.renderer.nodeEls.get(research.id).querySelector('.dr-mindmap-knob');
      knob.dispatchEvent(new window.MouseEvent('pointerenter', { bubbles: false }));
      await new Promise((r) => setTimeout(r, 520));
      assert.deepStrictEqual(rows(), ['Competitor notes', 'Interview script']);
      view.closePeek();
    } finally {
      delete window.matchMedia;
    }
  });

  await t('a node’s first line is its title and the rest its details; it’s as big as its text, measured once and kept', async () => {
    const text = '---\nmindmap: true\n---\n- Plan\n\t- Build\n\t  with care\n\t  and tests\n\t- Ship\n';
    const view = await open(text);
    const build = view.model.root.children[0];
    assert.strictEqual(build.text, 'Build\nwith care\nand tests');
    const el = view.renderer.nodeEls.get(build.id);
    assert.strictEqual(el.querySelector('.dr-mindmap-text').textContent, 'Build');
    assert.strictEqual(el.querySelector('.dr-mindmap-details').textContent, 'with care\nand tests');
    const ship = view.scene.boxes.get(view.model.root.children[1].id);
    assert.ok(view.scene.boxes.get(build.id).height > ship.height, 'its details make it taller');
    // Where things have a size: measured off screen, and the map laid out by what was measured.
    const P = window.HTMLElement.prototype;
    const size = (w, h) => function () {
      if (this.classList.contains('dr-mindmap')) return w === 'w' ? 1000 : 700;
      const m = this.closest && this.closest('.dr-mindmap-measure');
      if (!m) return 0;
      return w === 'w' ? (this.textContent.startsWith('Build') ? 150 : 90) : this.textContent.startsWith('Build') ? 76 : 36;
    };
    Object.defineProperty(P, 'offsetWidth', { get: size('w'), configurable: true });
    Object.defineProperty(P, 'offsetHeight', { get: size('h'), configurable: true });
    try {
      view.draw();
      await new Promise((r) => setTimeout(r, 0));
      assert.deepStrictEqual([view.scene.boxes.get(build.id).width, view.scene.boxes.get(build.id).height], [150, 76], 'measured');
      assert.ok(!view.root.querySelector('.dr-mindmap-measure .dr-mindmap-node'), 'nothing left where it was measured');
      const kept = view.sizes.size;
      view.draw();
      await new Promise((r) => setTimeout(r, 0));
      assert.strictEqual(view.sizes.size, kept, 'measured once');
    } finally {
      delete P.offsetWidth;
      delete P.offsetHeight;
    }
  });

  await t('a node’s text as markdown where Obsidian renders it: a link in it is a link, and opens', async () => {
    const calls = [];
    obsidian.MarkdownRenderer = { render: (app, md, el) => { el.innerHTML = `<p>${md.replace(/\[\[([^\]]+)\]\]/g, '<a class="internal-link" data-href="$1">$1</a>')}</p>`; return Promise.resolve(); } };
    Component.prototype.load = function () {};
    Component.prototype.unload = function () { this.gone = true; };
    try {
      const view = await open(NOTE);
      view.app = { workspace: { openLinkText: (...a) => calls.push(a) } };
      view.renderer.nodeEls.forEach((el) => el.remove());
      view.renderer.nodeEls.clear();
      view.draw();
      const link = view.contentEl.querySelector('.dr-mindmap-node a.internal-link');
      assert.ok(link && link.textContent === 'Competitor notes', 'rendered as a link');
      link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.deepStrictEqual(calls, [['Competitor notes', 'Plan.md', false]]);
      const parts = Array.from(view.textParts);
      await view.onClose();
      assert.ok(parts.length && parts.every((c) => c.gone), 'let go as the view closes');
    } finally {
      delete obsidian.MarkdownRenderer;
      delete Component.prototype.load;
      delete Component.prototype.unload;
    }
  });

  await t('edges take their branch’s colour; a relation is drawn as its attributes say', async () => {
    const view = await open(NOTE);
    const [research, build, ship] = view.model.root.children;
    view.apply(R.setAttr(view.model, build.id, 'color', '1'));
    view.apply(R.setAttr(view.model, research.id, 'color', '#ff0000'));
    const edges = Array.from(view.contentEl.querySelectorAll('.dr-mindmap-edge'));
    assert.strictEqual(edges.filter((p) => p.getAttribute('data-color') === '1').length, 3, 'into Build, and on to API and UI');
    assert.strictEqual(edges.filter((p) => p.style.stroke === 'rgb(255, 0, 0)' || p.style.stroke === '#ff0000').length, 3);
    view.model.relations.push({ from: build.id, to: ship.id, label: '', attrs: { style: 'dotted', shape: 'elbow', head: 'diamond' } });
    view.model.relations.push({ from: research.id, to: ship.id, label: '', attrs: {} });
    view.draw();
    const [styled, plain] = Array.from(view.contentEl.querySelectorAll('.dr-mindmap-relation'));
    assert.strictEqual(styled.getAttribute('data-line'), 'dotted');
    assert.ok(/ H /.test(styled.getAttribute('d')), 'square corners');
    assert.ok(/-diamond\)$/.test(styled.getAttribute('marker-end')));
    assert.ok(view.contentEl.querySelector(`marker[id="${styled.getAttribute('marker-end').slice(5, -1)}"]`), 'its head drawn');
    assert.strictEqual(plain.getAttribute('data-line'), 'dashed', 'unstyled: dashed with a triangle head');
    assert.ok(/-arrow\)$/.test(plain.getAttribute('marker-end')));
  });

  await t('the legend names the map’s colours and counts them; a colour picked fades the rest; uncoloured nodes tinted as set; depth shown', async () => {
    const view = await open(NOTE);
    const [research, build, ship] = view.model.root.children;
    assert.ok(!view.contentEl.querySelector('.dr-mindmap-legend'), 'no colours: no legend');
    view.apply(R.setAttr(view.model, build.id, 'color', '1'));
    view.apply(R.setAttr(view.model, ship.id, 'color', '1'));
    view.apply(R.setAttr(view.model, research.id, 'color', '4'));
    const rows = () => Array.from(view.contentEl.querySelectorAll('.dr-mindmap-legend-row')).map((r) => `${r.querySelector('.dr-mindmap-legend-name').textContent} ${r.querySelector('.dr-mindmap-legend-count').textContent}`);
    assert.deepStrictEqual(rows(), ['Red 2', 'Green 1', 'No colour 5']);
    view.apply(R.setLegendName(view.model, '1', 'Risky'));
    assert.deepStrictEqual(rows()[0], 'Risky 2', 'named in the map');
    view.flushSave();
    assert.ok(view.text.includes('"legend":{"1":"Risky"}'), 'the name kept in the layout block');
    view.contentEl.querySelectorAll('.dr-mindmap-legend-row')[0].click();
    const faded = () => Array.from(view.contentEl.querySelectorAll('.dr-mindmap-node.is-faded')).length;
    assert.strictEqual(faded(), 6, 'all but the two red faded');
    view.contentEl.querySelectorAll('.dr-mindmap-legend-row')[0].click();
    assert.strictEqual(faded(), 0, 'picked again: back');
    R.registerMindMapHandlers();
    R.MINDMAP_HANDLERS.get('toggle-canvas-legend').run({ view, model: view.model });
    assert.ok(!view.contentEl.querySelector('.dr-mindmap-legend'), 'hidden');
    R.MINDMAP_HANDLERS.get('toggle-canvas-legend').run({ view, model: view.model });
    assert.ok(view.contentEl.querySelector('.dr-mindmap-legend'));
    // Tints: by branch, the uncoloured below each of the root's children.
    plugin.settings.mindmapColourBy = 'branch';
    view.apply(R.setAttr(view.model, research.id, 'color', undefined));
    view.draw();
    const tint = (n) => view.renderer.nodeEls.get(n.id).dataset.tint;
    assert.deepStrictEqual([tint(research), tint(research.children[0]), tint(build), tint(build.children[0])], ['1', '1', undefined, '2'], 'Build has its own colour; what’s below it the second branch’s tint');
    plugin.settings.mindmapColourBy = 'depth';
    view.draw();
    assert.deepStrictEqual([tint(research), tint(research.children[0])], ['1', '2']);
    plugin.settings.mindmapColourBy = '';
    view.draw();
    assert.strictEqual(tint(research), undefined);
    assert.ok(view.root.hasClass('is-depth'), 'depth shown');
    plugin.settings.mindmapDepth = false;
    view.draw();
    assert.ok(!view.root.hasClass('is-depth'));
    plugin.settings.mindmapDepth = true;
  });

  await t('a pinned node stays where it is as the layout changes, its branch with it; a kept view goes back to its node; Back steps back', async () => {
    const view = await open(NOTE);
    R.registerMindMapHandlers();
    const build = view.model.root.children[1];
    const api = build.children[0];
    view.select(build.id);
    const ctx = () => ({ view, model: view.model, node: build });
    const at = Object.assign({}, view.scene.boxes.get(build.id));
    R.MINDMAP_HANDLERS.get('canvas-toggle-keep-in-place').run(ctx());
    assert.deepStrictEqual(build.attrs.pin, [Math.round(at.x), Math.round(at.y)]);
    assert.ok(view.renderer.nodeEls.get(build.id).hasClass('is-pinned'));
    view.apply(R.setMapLayout(view.model, 'left'));
    const b = view.scene.boxes.get(build.id);
    assert.deepStrictEqual([b.x, b.y], build.attrs.pin, 'laid out to the left: Build stays');
    const a = view.scene.boxes.get(api.id);
    assert.ok(a.x < b.x, 'API hangs to its left, as the layout says, from where Build is');
    // Dragged clear of the others: the pin moves.
    view.dropNode({ node: build.id, target: null, x: 0, y: 0, last: { x: 50 * view.camera.zoom, y: 0 } });
    assert.deepStrictEqual(build.attrs.pin, [Math.round(at.x) + 50, Math.round(at.y)]);
    R.MINDMAP_HANDLERS.get('canvas-toggle-keep-in-place').run(ctx());
    assert.strictEqual(build.attrs.pin, undefined, 'let go');
    // A kept view, and Back.
    view.apply(R.setSavedView(view.model, 'The build', api.id, 1.5));
    const before = Object.assign({}, view.camera);
    view.goToView('The build');
    const ab = view.scene.boxes.get(api.id);
    assert.deepStrictEqual(view.camera, { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2, zoom: 1.5 });
    assert.strictEqual(view.selected, api.id);
    view.fitBranch(view.model.root.children[0].id);
    assert.ok(R.MINDMAP_HANDLERS.get('canvas-view-back').when({ view }));
    R.MINDMAP_HANDLERS.get('canvas-view-back').run({ view });
    assert.strictEqual(view.camera.zoom, 1.5, 'back to the kept view');
    R.MINDMAP_HANDLERS.get('canvas-view-back').run({ view });
    assert.deepStrictEqual(view.camera, before, 'and back to where it began');
    assert.ok(!R.MINDMAP_HANDLERS.get('canvas-view-back').when({ view }), 'nothing more to go back to');
  });

  await t('arrange and align on a map are the layout’s: a row or a column lays the branch out so; lining up puts the children back in line', async () => {
    const view = await open(NOTE);
    R.registerMindMapHandlers();
    const build = view.model.root.children[1];
    const run = (id, node) => R.MINDMAP_HANDLERS.get(id).run({ view, model: view.model, node });
    run('arrange-canvas-row', build);
    assert.strictEqual(R.branchLayoutOf(view.model, build.id), 'bottom');
    run('arrange-canvas-column', build);
    assert.strictEqual(R.branchLayoutOf(view.model, build.id), 'right');
    view.apply(R.setNudge(view.model, build.children[0].id, 20, 10));
    view.apply(R.setNudge(view.model, build.id, 5, 5));
    run('arrange-canvas-left', build);
    assert.strictEqual(R.nodeNudge(view.model, build.children[0].id), null, 'the children lined up');
    assert.deepStrictEqual(R.nodeNudge(view.model, build.id), [5, 5], 'Build itself left be');
    run('canvas-card-earlier', build);
    assert.deepStrictEqual(view.model.root.children.map((c) => c.text), ['Build', 'Research', 'Ship'], 'the canvas’s names for moving a node about');
    run('canvas-demote-card', view.model.root.children[1]);
    assert.deepStrictEqual(build.children.map((c) => c.text), ['API', 'UI', 'Research']);
  });

  await t('settings saved by 2.0: the mind map takes the canvas maps’ legend, depth, tints, pins and views', async () => {
    const saved = { settingsVersion: 9, canvasLegend: false, canvasDepth: false, canvasColourBy: 'branch', canvasPins: false, canvasViews: true, mindmapLegend: true, canvasTidy: false };
    R.SETTINGS_MIGRATIONS.filter((m) => m.to > saved.settingsVersion).sort((a, b) => a.to - b.to).forEach((m) => { m.run(saved); saved.settingsVersion = m.to; });
    assert.deepStrictEqual(
      [saved.mindmapLegend, saved.mindmapDepth, saved.mindmapColourBy, saved.mindmapPins, saved.mindmapViews, saved.settingsVersion],
      [false, false, 'branch', false, true, R.DEFAULTS.settingsVersion]
    );
    assert.strictEqual(saved.canvasLegend, false, 'the canvas keeps its own');
    // And the knowledge tools, saved by 2.0.34 or so.
    const later = { settingsVersion: 10, canvasPresent: false, canvasMinimap: false, canvasBranchNote: false, mindmapPresent: true };
    R.SETTINGS_MIGRATIONS.filter((m) => m.to > 10).forEach((m) => m.run(later));
    assert.deepStrictEqual([later.mindmapPresent, later.mindmapMinimap, later.mindmapBranchNotes, later.mindmapCheck], [false, false, false, undefined]);
    const none = { settingsVersion: 9, canvasColourBy: 'none' };
    R.SETTINGS_MIGRATIONS.filter((m) => m.to > 9).forEach((m) => m.run(none));
    assert.strictEqual(none.mindmapColourBy, '', 'no tint');
  });

  await t('relations: two nodes related by Alt-dragging one onto the other; a kind or a proposition said, turned round, listed and written out; kept in the note', async () => {
    const view = await open('---\nmindmap: true\n---\n- Law\n\t- Courts\n\t- Legislatures\n\t- Judicial review\n');
    R.registerMindMapHandlers();
    const [a, b, c] = view.model.root.children;
    view.dropNode({ node: a.id, relate: true, target: { target: b.id, zone: 'relate' } });
    view.dropNode({ node: c.id, relate: true, target: { target: a.id, zone: 'relate' } });
    assert.deepStrictEqual(view.model.relations.map((r) => [r.from, r.to]), [[a.id, b.id], [c.id, a.id]]);
    assert.ok(a.anchor && b.anchor && c.anchor, 'each end given its id');
    assert.deepStrictEqual(view.model.root.children.map((n) => n.text), ['Courts', 'Legislatures', 'Judicial review'], 'nothing moved');
    const kinds = R.relationTypes(plugin.settings);
    // A kind: its name the label, its line and colour the relation's.
    view.apply(R.setRelationMeaning(view.model, 0, { kind: 'contrasts with' }, kinds.find((k) => k.name === 'contrasts with')));
    assert.deepStrictEqual([view.model.relations[0].label, view.model.relations[0].attrs], ['contrasts with', { kind: 'contrasts with', style: 'dotted' }]);
    const rel = view.contentEl.querySelector('.dr-mindmap-relation');
    assert.strictEqual(rel.getAttribute('data-line'), 'dotted');
    assert.ok(Array.from(view.contentEl.querySelectorAll('.dr-mindmap-label.is-relation')).some((l) => l.textContent === 'contrasts with'), 'its label along it');
    // A proposition: Judicial review constrains Courts; turned round, Courts constrains Judicial review.
    view.apply(R.setRelationMeaning(view.model, 1, { predicate: ' constrains ' }));
    assert.deepStrictEqual([view.model.relations[1].label, view.model.relations[1].attrs.predicate], ['constrains', 'constrains']);
    view.reverseRelationAt(1);
    assert.deepStrictEqual([view.model.relations[1].from, view.model.relations[1].to, view.model.relations[1].label], [a.id, c.id, 'constrains']);
    // A hierarchy kind, and what the map states.
    view.apply(R.setRelationMeaning(view.model, 0, { kind: 'is a type of' }, kinds.find((k) => k.name === 'is a type of')));
    const st = view.statements();
    assert.deepStrictEqual(st.map((x) => [x.category, x.subject.text, x.verb, x.object.text]), [['hierarchy', 'Courts', 'is a type of', 'Legislatures'], ['proposition', 'Courts', 'constrains', 'Judicial review']]);
    assert.strictEqual(R.statementsMarkdown(st, (n) => R.nodeParts(n).title), '## Hierarchy\n\n- Courts is a type of Legislatures\n\n## Propositions\n\n- Courts constrains Judicial review\n');
    view.goToStatement(st[1]);
    assert.strictEqual(view.selected, a.id, 'gone to: its first node picked, both in view');
    // Kept in the note, and read back the same.
    view.flushSave();
    assert.ok(view.text.includes(`- ^${a.id} -> ^${b.id} "is a type of" %%{"style":"solid","kind":"is a type of"}%%`), view.text);
    const again = await open(view.text);
    assert.deepStrictEqual(again.statements().map((x) => [x.category, x.verb]), [['hierarchy', 'is a type of'], ['proposition', 'constrains']]);
    // Says nothing again: the plain relation it was.
    view.select(c.id);
    R.MINDMAP_HANDLERS.get('canvas-relation-none').run({ view, model: view.model, node: c });
    assert.ok(view.model.relations.some((r) => !r.label && !r.attrs.kind && !r.attrs.predicate), 'one said nothing');
  });

  await t('arguments: a node given a part shows it above itself; a reason or objection added names its edge; a claim counts for and against', async () => {
    const view = await open('---\nmindmap: true\n---\n- Debate\n\t- Judicial review constrains legislatures\n');
    R.registerMindMapHandlers();
    const claim = view.model.root.children[0];
    const run = (id, node) => R.MINDMAP_HANDLERS.get(id).run({ view, model: view.model, node });
    run('canvas-make-claim', claim);
    assert.strictEqual(claim.attrs.role, 'claim');
    const el = (n) => view.renderer.nodeEls.get(n.id);
    assert.strictEqual(el(claim).dataset.roleLabel, 'Claim');
    run('canvas-add-reason', claim);
    assert.ok(view.editing, 'the reason opened to type in');
    view.typed('Courts protect rights');
    view.closeEditor(true);
    run('canvas-add-objection', claim);
    view.closeEditor(true);
    const [reason, objection] = claim.children;
    assert.deepStrictEqual([reason.attrs.role, objection.attrs.role], ['reason', 'objection']);
    const labels = Array.from(view.contentEl.querySelectorAll('.dr-mindmap-label:not(.is-relation)')).filter((l) => l.style.display !== 'none').map((l) => l.textContent);
    assert.deepStrictEqual(labels.sort(), ['opposes', 'supports']);
    assert.strictEqual(el(claim).dataset.roleLabel, 'Claim · 1 for, 1 against');
    assert.strictEqual(el(objection).dataset.role, 'objection');
    view.undoStep(false);
    assert.strictEqual(claim.children.length, 1, 'an answer added: one step of Undo');
    view.undoStep(true);
    run('canvas-clear-part', claim.children[1]);
    assert.ok(!('role' in el(claim.children[1]).dataset));
    plugin.settings.mindmapArguments = false;
    view.draw();
    assert.ok(!('role' in el(claim).dataset), 'switched off: nothing shown');
    plugin.settings.mindmapArguments = true;
  });

  await t('a branch as a note: a heading for each node as deep as it is, past six a list, its details beneath; a node’s own headings bold', async () => {
    let text = '---\nmindmap: true\n---\n- Map\n\t- Root\n\t  what it is\n';
    let pad = '\t\t';
    for (let i = 1; i <= 7; i++) {
      text += `${pad}- Depth ${i}\n`;
      pad += '\t';
    }
    text += '\t\t- [[Zed]]\n';
    const view = await open(text);
    const root = view.model.root.children[0];
    // A node's own heading kept bold, so it doesn't break the outline.
    view.apply(R.setText(view.model, root.children[1].id, '[[Zed]]\n## inner'));
    assert.strictEqual(R.branchNoteText(root), [
      'what it is', '',
      '# Depth 1', '', '## Depth 2', '', '### Depth 3', '', '#### Depth 4', '', '##### Depth 5', '', '###### Depth 6', '',
      '- Depth 7', '',
      '# [[Zed]]', '', '**inner**', '',
    ].join('\n').replace(/\n+$/, '\n'));
  });

  await t('a branch made a note beside the map, its node a link to it in one step; a link’s note made nodes under it; .mindmap links follow a rename', async () => {
    const view = await open(NOTE);
    const created = [];
    const files = new Map();
    view.plugin = Object.assign({}, plugin, { freeChildPath: (folder, base, ext) => `${base}.${ext}` });
    view.app = {
      vault: {
        create: async (path, text) => { const f = new TFile(path); files.set(path, text); created.push([path, text]); return f; },
        cachedRead: async (f) => files.get(f.path),
        modify: async () => {},
      },
      metadataCache: {
        fileToLinktext: (f) => f.basename,
        getFirstLinkpathDest: (target) => (files.has(`${target}.md`) ? new TFile(`${target}.md`) : null),
      },
      workspace: {},
    };
    const build = view.model.root.children[1];
    view.model.relations.push({ from: build.children[0].id, to: view.model.root.children[2].id, label: '', attrs: {} });
    await view.branchToNote(build.id);
    assert.deepStrictEqual(created, [['Build.md', '# API\n\n# UI\n']]);
    assert.strictEqual(build.text, '[[Build]]');
    assert.strictEqual(build.children.length, 0);
    assert.strictEqual(view.model.relations.length, 0, 'relations into the branch gone with it');
    view.undoStep(false);
    assert.deepStrictEqual([build.text, build.children.map((c) => c.text), view.model.relations.length], ['Build', ['API', 'UI'], 1], 'one step of Undo');
    view.undoStep(true);
    // And back: the note's headings as nodes.
    files.set('Build.md', '# API\n## Auth\n# UI\n');
    assert.ok(view.linkedNote(build));
    await view.noteToBranch(build.id);
    assert.deepStrictEqual(build.children.map((c) => [c.text, c.children.map((x) => x.text)]), [['API', ['Auth']], ['UI', []]]);
    // A rename, in a .mindmap file's text.
    assert.strictEqual(R.relinkText('See [[Build]] and [[build|it]] and ![[Build#Top]], not [[Builder]]', ['Build'], 'Plans/Make'), 'See [[Plans/Make]] and [[Plans/Make|it]] and ![[Plans/Make#Top]], not [[Builder]]');
  });

  await t('looking a map over: empty and twice-named nodes, notes gone, free nodes joined to nothing, relations round in a circle or leading nowhere', async () => {
    const m = R.parseOutline('- Law\n\t- Rule of law ^a\n\t\t- Judicial review ^b\n\t- judicial review ^c\n\t- [[Gone]] ^f\n\t- %%{"color":"1"}%%\n\t- X ^x\n\t- Y ^y\n\n## Free nodes\n- Alone ^l\n- Joined ^j\n\n## Relations\n- ^x -> ^y\n- ^y -> ^x\n- ^j -> ^a\n- ^a -> ^zz\n').model;
    const empty = m.root.children[3].id;
    const found = R.mapProblems(m, (target) => target !== 'Gone').map((p) => `${p.id === empty ? 'empty' : p.id}: ${p.problem}`);
    assert.deepStrictEqual(found.sort(), [
      'a: A relation of it leads nowhere',
      'b: On the map 2 times',
      'c: On the map 2 times',
      'empty: Has nothing in it',
      'f: Its note is gone',
      'l: Not joined to anything',
      'x: Its relations lead round in a circle',
      'y: Its relations lead round in a circle',
    ].sort());
    // On the map: listed, marked, a row going to its node, until Done.
    const view = await open(NOTE);
    view.apply(R.setText(view.model, view.model.root.children[2].id, 'Research'));
    view.checkMap();
    const rows = Array.from(view.contentEl.querySelectorAll('.dr-mindmap-findings-row')).map((r) => r.textContent);
    assert.deepStrictEqual(rows, ['ResearchOn the map 2 times', 'ResearchOn the map 2 times']);
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-mindmap-node[data-mark="problem"]').length, 2);
    view.contentEl.querySelectorAll('.dr-mindmap-findings-row')[1].click();
    assert.strictEqual(view.selected, view.model.root.children[2].id);
    Array.from(view.contentEl.querySelectorAll('.dr-mindmap-findings button')).find((b) => b.textContent === 'Done').click();
    assert.ok(!view.contentEl.querySelector('.dr-mindmap-findings') && !view.contentEl.querySelector('[data-mark]'));
  });

  await t('a map compared with how it was: new, reworded, moved and gone nodes, by id or else by title; two branches compared; a snapshot kept', async () => {
    const then = R.parseOutline('- Root ^a\n\t- Courts ^b\n\t- Appeal ^c\n\t- Gone one ^d\n\n## Free nodes\n- Copied ^old\n\n## Relations\n- ^b -> ^c\n').model;
    const now = R.parseOutline('- Root ^a\n\t- Law courts ^b\n\t\t- Appeal ^c\n\t- Brand new ^e\n\n## Free nodes\n- Copied ^copy\n\n## Relations\n- ^c -> ^b\n').model;
    const found = R.compareMaps(now, then);
    const ids = (list) => list.map((r) => r.id);
    assert.deepStrictEqual(ids(found.added), ['e']);
    assert.deepStrictEqual(ids(found.removed), ['d']);
    assert.deepStrictEqual(found.reworded, [{ id: 'b', label: 'Law courts', was: 'Courts' }]);
    assert.deepStrictEqual(found.moved.map((r) => [r.id, r.was]), [['c', 'hung from “Root”']], 'a new node isn’t moved as well');
    assert.deepStrictEqual(found.relations, { added: 1, removed: 1 });
    const tree = R.parseOutline('- M\n\t- X ^x\n\t\t- Shared ^x1\n\t\t- Only X ^x2\n\t- Y ^y\n\t\t- shared ^y1\n\t\t- Only Y ^y2\n').model;
    const branches = R.compareMapBranches(tree, 'x', 'y');
    assert.deepStrictEqual([ids(branches.onlyA), ids(branches.onlyB), ids(branches.both)], [['x2'], ['y2'], ['x1']]);
    // On the map: a snapshot kept, compared with, marked and counted until Done.
    const files = {};
    const view = await open('- Root ^a\n\t- Courts ^b\n\t- Appeal ^c\n');
    view.plugin = Object.assign({}, plugin, { manifest: { dir: '.obsidian/plugins/design-redux' } });
    view.app = { vault: { adapter: { exists: async (f) => f in files, read: async (f) => files[f], write: async (f, x) => { files[f] = x; } }, modify: async () => {} } };
    await view.keepSnapshot();
    const kept = JSON.parse(files['.obsidian/plugins/design-redux/mindmap-snapshots.json'])['Plan.md'];
    assert.ok(kept && kept.text.includes('Courts'));
    view.apply(R.setText(view.model, 'b', 'Law courts'));
    view.apply(R.addChild(view.model, 'a', 'Brand new'));
    view.compareWithText(kept.text, view.file, 'the snapshot');
    assert.strictEqual(view.contentEl.querySelector('.dr-mindmap-findings-title').textContent, 'Against the snapshot: 1 new, 1 reworded');
    assert.strictEqual(view.renderer.nodeEls.get('b').dataset.mark, 'reworded');
    view.closeFindings();
    assert.ok(!view.renderer.nodeEls.get('b').dataset.mark);
  });

  await t('a folder or a tag made into a mind map: its folders or narrower tags as branches, notes as links, links between them as relations', async () => {
    obsidian.getAllTags = (cache) => cache.tags.map((x) => x.tag);
    const TFolder = obsidian.TFolder;
    const folder = (path, parent) => {
      const f = Object.assign(new TFolder(), { path, name: path.split('/').pop(), children: [], parent, isRoot: () => !path });
      if (parent) parent.children.push(f);
      return f;
    };
    const note = (path, parent, tags) => {
      const f = Object.assign(new TFile(path), { parent, tags, stat: { mtime: 0, ctime: 0 } });
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
    const isFolderNote = (f) => !!f.parent && f.basename === f.parent.name;
    const p = {
      settings: Object.assign({}, plugin.settings, { defaultSort: 'name', mindmapDefaultFormat: 'md' }),
      isFolderNote,
      folderNote: (fo) => fo.children.find((c) => c.basename === fo.name) || null,
      files: { folderHasNotes: () => true },
      orders: { arrangeAlbum: (fo, list, sorter) => sorter(list) },
      freeChildPath: (fo, base, ext) => `${fo.path ? fo.path + '/' : ''}${base}.${ext}`,
      app: {
        vault: {
          getName: () => 'Vault', getRoot: () => root, getMarkdownFiles: () => files,
          create: async (path, text) => { created.push([path, text]); return new TFile(path); },
        },
        metadataCache: {
          resolvedLinks: { 'Law/Statute.md': { 'Law/Courts/Appeal.md': 1, 'Elsewhere.md': 1 }, 'Law/Courts/Appeal.md': { 'Law/Statute.md': 2 } },
          getFileCache: (f) => ({ tags: f.tags.map((tag) => ({ tag })) }),
          fileToLinktext: (f) => f.basename,
        },
        fileManager: { getNewFileParent: () => root },
        workspace: { getLeaf: () => ({ openFile: async (f) => opened.push(f.path) }) },
      },
    };
    const maps = new R.MindMaps(p);
    await maps.mapFolderAsMindMap(law);
    const [path, text] = created[0];
    assert.strictEqual(path, 'Law/Law map.md');
    assert.ok(text.startsWith('---\nmindmap: true\n---\n'), 'flagged, so it opens as a map');
    assert.deepStrictEqual(opened, ['Law/Law map.md']);
    const m = R.parseOutline(text).model;
    const shape = (n) => [n.text.replace(/ \^\w+$/, ''), n.children.map(shape)];
    assert.deepStrictEqual(shape(m.root), ['[[Law]]', [['[[Equity]]', []], ['[[Statute]]', []], ['Courts', [['[[Appeal]]', []], ['[[Trial]]', []]]]]], 'the folder note at the root, notes then folders, an empty folder left out');
    const title = (id) => R.nodeParts(R.nodeById(m, id)).title;
    assert.deepStrictEqual(m.relations.map((r) => [title(r.from), title(r.to)].sort().join(' ~ ')), ['[[Appeal]] ~ [[Statute]]'], 'a link both ways is one relation; one to a note not mapped, none');
    await maps.mapTagAsMindMap('#law');
    const tagMap = R.parseOutline(created[1][1]).model;
    assert.strictEqual(created[1][0], 'law map.md');
    assert.deepStrictEqual(shape(tagMap.root), ['#law', [['[[Statute]]', []], ['#court', [['[[Appeal]]', []], ['[[Trial]]', []]]]]], 'each note once, under its narrowest tag');
    assert.strictEqual(tagMap.relations.length, 1);
    delete obsidian.getAllTags;
  });

  await t('the minimap: the map small, the part on screen outlined, there only while it doesn’t all fit; pressing goes there', async () => {
    const view = await open(NOTE);
    view.fit();
    const el = () => view.contentEl.querySelector('.dr-mindmap-minimap');
    assert.ok(el().hasClass('is-hidden'), 'it all fits: no minimap');
    view.camera = { x: 0, y: 0, zoom: 3 };
    view.draw();
    assert.ok(!el().hasClass('is-hidden'));
    assert.strictEqual((el().querySelector('.dr-minimap-card').getAttribute('d').match(/M/g) || []).length, view.scene.boxes.size, 'a box for each node, in one path');
    const rect = el().querySelector('.dr-minimap-view');
    assert.ok(Number(rect.getAttribute('width')) > 0);
    const svg = el().querySelector('svg');
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 136 });
    const p = Object.assign({}, view.minimapPlane);
    el().dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 68 }));
    assert.ok(Math.abs(view.camera.x - (p.minX + p.maxX) / 2) < 1 && Math.abs(view.camera.y - (p.minY + p.maxY) / 2) < 1, 'the middle of the minimap: the middle of the map');
    assert.strictEqual(view.camera.zoom, 3, 'as near as it was');
    plugin.settings.mindmapMinimap = false;
    view.draw();
    assert.ok(el().hasClass('is-hidden'), 'switched off');
    plugin.settings.mindmapMinimap = true;
  });

  await t('present a map: depth first from the root, each node once; nothing changes while it runs; leaving puts back the view and the selection', async () => {
    const m = R.parseOutline('- r ^r\n\t- a ^a\n\t\t- a1 ^a1\n\t- b ^b\n\t\t- b1 ^b1 %%{"fold":1}%%\n\t\t\t- hidden\n\n## Free nodes\n- s ^s\n').model;
    const order = R.mapPresentation(m);
    assert.deepStrictEqual(order.map((o) => o.id), ['r', 'a', 'a1', 'b', 'b1', 's'], 'in the list’s order; a folded branch one step; free nodes after');
    assert.deepStrictEqual(order[2].ancestors, ['r', 'a']);
    assert.deepStrictEqual(R.mapPresentation(m, 'a').map((o) => o.id), ['a', 'a1'], 'from a node: its branch');
    // Live.
    const view = await open('- r ^r\n\t- a ^a\n\t\t- a1 ^a1\n\t- b ^b\n');
    view.select('b');
    const camera = Object.assign({}, view.camera);
    const text = view.text;
    plugin.settings.presentDimLevel = 0.2;
    view.present(null);
    const cls = (id, c) => view.renderer.nodeEls.get(id).hasClass(c);
    assert.ok(view.root.hasClass('dr-presenting') && view.selected === null);
    assert.ok(cls('r', 'dr-present-now') && cls('a', 'dr-present-dim'));
    const press = (key) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    view.app = { workspace: { activeLeaf: view.leaf } };
    press('ArrowRight');
    press('ArrowRight');
    assert.ok(cls('a1', 'dr-present-now') && !cls('a', 'dr-present-dim') && !cls('r', 'dr-present-dim') && cls('b', 'dr-present-dim'), 'the node and those above it at full strength');
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-present-crumb')).map((e) => e.textContent), ['r', 'a', 'a1'], 'the trail: root to node');
    assert.strictEqual(view.contentEl.querySelector('.dr-present-count').textContent, '3 of 4');
    press('ArrowUp');
    assert.ok(cls('a', 'dr-present-now'), 'up: its parent');
    press('r');
    assert.ok(cls('b', 'dr-present-hidden') && !cls('a', 'dr-present-hidden'), 'reveal: not yet reached, hidden');
    // Nothing changes while it runs.
    view.dropNode({ node: 'b', target: { parentId: 'a', index: 0, target: 'a', zone: 'child' } });
    view.edit('a');
    assert.ok(!view.editing && view.model.root.children.map((c) => c.id).join() === 'a,b', 'no move, no typing');
    view.contentEl.querySelector('.dr-present-crumb').click();
    assert.ok(cls('r', 'dr-present-now'), 'a name in the trail goes to its node');
    press('Escape');
    assert.ok(!view.root.hasClass('dr-presenting') && !view.contentEl.querySelector('.dr-present-bar, .dr-present-now, .dr-present-dim, .dr-present-hidden'));
    assert.deepStrictEqual(view.camera, camera, 'the view as it was');
    assert.strictEqual(view.selected, 'b', 'the selection as it was');
    view.flushSave();
    assert.strictEqual(view.text, text, 'nothing written');
  });

  // A collection in a vault of its own: notes with properties, Obsidian's metadata, and a notes service writing them.
  const albumVault = (count, parentOf, extra) => {
    const TFolder = obsidian.TFolder;
    const root = Object.assign(new TFolder(), { path: '', name: '', children: [], isRoot: () => true });
    const folder = Object.assign(new TFolder(), { path: 'Album', name: 'Album', children: [], parent: root, isRoot: () => false });
    const files = new Map();
    const fm = new Map();
    const add = (name, props, where) => {
      const f = Object.assign(new TFile(`${(where || folder).path}/${name}.md`), { parent: where || folder, stat: { mtime: 0, ctime: 0 } });
      (where || folder).children.push(f);
      files.set(f.path, f);
      fm.set(f.path, props);
      return f;
    };
    add('Album', { kind: 'album' });
    for (let i = 0; i < count; i++) add(`N${i}`, Object.assign({ rating: i % 5, tags: ['t' + (i % 3)], status: 'draft' }, parentOf(i) ? { parent: parentOf(i) } : {}, extra ? extra(i) : {}));
    const created = new Map();
    const app = {
      vault: {
        getAbstractFileByPath: (p) => files.get(p) || (p === 'Album' ? folder : null),
        getFiles: () => Array.from(files.values()),
        create: async (path, text) => { const f = new TFile(path); created.set(path, text); return f; },
        read: async (f) => created.get(f.path),
        modify: async () => {},
      },
      metadataCache: {
        getFileCache: (f) => ({ frontmatter: fm.get(f.path) }),
        getFirstLinkpathDest: (link) => Array.from(files.values()).find((f) => f.basename === link || f.path === `${link}.md`) || null,
        fileToLinktext: (f) => f.basename,
      },
      fileManager: { processFrontMatter: async (f, fn) => fn(fm.get(f.path)) },
      workspace: { getLeaf: () => ({ openFile: async () => {} }), getLeavesOfType: () => [] },
    };
    const p = {
      settings: Object.assign({}, plugin.settings, { defaultSort: 'name', graphRouteProperty: 'parent', albumMapWritesParent: 'always' }),
      app,
      isFolderNote: (f) => !!f.parent && f.basename === f.parent.name,
      folderNote: (fo) => fo.children.find((c) => c.basename === fo.name) || null,
      orders: { arrangeAlbum: (fo, list, sorter) => sorter(list) },
      saveSettings: async () => {},
    };
    p.notes = new R.Notes(p);
    return { folder, files, fm, created, app, p, add };
  };

  // The map open on what was made: a view of it, followed as Obsidian would follow it.
  const openAlbumMap = async (v, maps) => {
    const view = await open(v.created.get('Album/Album map.md'), 'Album/Album map.md');
    Object.assign(view, { app: v.app, plugin: v.p, feature: maps });
    view.file.parent = v.folder;
    view.syncAlbum();
    return view;
  };
  const shapeOf = (view, n) => {
    const out = {};
    const go = (x, up) => {
      const path = view.feature.albumNotePath(x, view.file.path);
      if (path) out[path.replace(/^Album\/|\.md$/g, '')] = up;
      x.children.forEach((c) => go(c, path ? path.replace(/^Album\/|\.md$/g, '') : up));
    };
    (n || view.model.root).children.forEach((c) => go(c, 'root'));
    return out;
  };

  await t('a collection as a map by parent: chains, siblings, loops, several parents and outside notes; the map follows the notes; a node moved sets the parent as the setting says', async () => {
    const v = albumVault(0, () => null);
    v.add('A', { parent: '[[B]]' });
    v.add('B', { parent: '[[A]]' });
    v.add('C', { parent: ['[[A]]', '[[D]]'] });
    v.add('D', {});
    v.add('E', { parent: '[[Elsewhere]]' });
    v.add('F', { parent: '[[Outside]]' });
    const out = Object.assign(new obsidian.TFolder(), { path: 'Other', name: 'Other', children: [] });
    v.add('Outside', {}, out);
    const maps = new R.MindMaps(v.p);
    await maps.mapAlbumAsMindMap(v.folder);
    const view = await openAlbumMap(v, maps);
    assert.ok(v.created.get('Album/Album map.md').startsWith('---\nmindmap: true\n---\n'), 'flagged, so it opens as a map');
    assert.strictEqual(R.nodeParts(view.model.root).title, '[[Album]]', 'the folder note at the root');
    assert.deepStrictEqual(shapeOf(view), { A: 'B', B: 'root', C: 'A', D: 'root', E: 'root', F: 'Other/Outside', 'Other/Outside': 'root' }, 'a loop broken; the first of several parents; a missing parent at the root; a parent from outside shown');
    const rel = view.model.relations.map((r) => [r.from, r.to].map((id) => view.feature.albumNotePath(R.nodeById(view.model, id), '').replace(/^Album\/|\.md$/g, '')).join('→'));
    assert.deepStrictEqual(rel.sort(), ['A→B', 'D→C'].sort(), 'the loop and the second parent as dashed relations');
    assert.deepStrictEqual(R.albumEntry(view.model), { path: 'Album', leftOut: [] }, 'the collection kept in the map');
  });

  await t('a 200-note collection: its map follows the notes, moving a node sets the parent, and no note’s other properties change', async () => {
    const v = albumVault(200, (i) => (i ? `[[N${Math.floor((i - 1) / 3)}]]` : null));
    const before = new Map(Array.from(v.fm.entries()).map(([k, x]) => [k, JSON.parse(JSON.stringify(x))]));
    const maps = new R.MindMaps(v.p);
    const t0 = Date.now();
    await maps.mapAlbumAsMindMap(v.folder);
    const view = await openAlbumMap(v, maps);
    const want = (fmOf) => {
      const out = {};
      for (let i = 0; i < 200; i++) {
        const raw = fmOf(`Album/N${i}.md`).parent;
        out[`N${i}`] = raw ? raw.replace(/\[\[|\]\]/g, '') : 'root';
      }
      return out;
    };
    assert.deepStrictEqual(shapeOf(view), want((p) => v.fm.get(p)), 'every note under its parent');
    assert.ok(Date.now() - t0 < 2000, `made and followed in ${Date.now() - t0} ms`);
    const id = (name) => { let f = null; (function w(n) { if (n.text === `[[${name}]]`) f = n.id; n.children.forEach(w); })(view.model.root); return f; };
    // The notes change: a new parent, a new note, a note gone.
    v.fm.get('Album/N5.md').parent = '[[N1]]';
    v.add('N200', { parent: '[[N3]]' });
    const n7 = v.files.get('Album/N7.md');
    v.folder.children.splice(v.folder.children.indexOf(n7), 1);
    v.files.delete(n7.path);
    const kidsOf7 = R.nodeById(view.model, id('N7')).children.map((c) => c.text);
    view.syncAlbum();
    assert.strictEqual(shapeOf(view).N5, 'N1');
    assert.strictEqual(shapeOf(view).N200, 'N3');
    assert.ok(!id('N7'), 'a note gone takes its node');
    assert.deepStrictEqual(kidsOf7.filter((t) => R.nodeById(view.model, id(t.replace(/\[\[|\]\]/g, '')))).length, kidsOf7.length, 'what hung from it kept');
    // A node taken off by hand: its note left out, untouched.
    view.apply(R.removeNode(view.model, id('N9')));
    view.syncAlbum();
    assert.ok(!id('N9') && R.albumEntry(view.model).leftOut.includes('Album/N9.md'), 'left out, not put back');
    // Moving nodes sets their notes' parents.
    view.apply(R.moveNode(view.model, id('N10'), id('N2'), 0));
    view.apply(R.moveNode(view.model, id('N20'), view.model.root.id, 0));
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(v.fm.get('Album/N10.md').parent, '[[N2]]');
    assert.ok(!('parent' in v.fm.get('Album/N20.md')), 'onto the root: no parent');
    // Round trip: the notes' parents and the map agree, and nothing else about a note changed.
    view.syncAlbum();
    const agreed = want((p) => v.fm.get(p) || {});
    delete agreed.N7;
    // Taken off by hand with its branch: those notes left out.
    R.albumEntry(view.model).leftOut.forEach((pth) => delete agreed[pth.replace(/^Album\/|\.md$/g, '')]);
    const under9 = (i) => { for (let k = i; k > 0; k = Math.floor((k - 1) / 3)) if (k === 9) return true; return false; };
    const expectOut = []; for (let i = 0; i < 200; i++) if (under9(i)) expectOut.push(`Album/N${i}.md`);
    assert.deepStrictEqual(R.albumEntry(view.model).leftOut.sort(), expectOut.sort(), 'N9 and its branch');
    const shown = shapeOf(view);
    delete shown.N200;
    // A child of a gone note now hangs where it was moved up to: from its note's own view, its parent is gone.
    Object.keys(agreed).forEach((k) => { if (agreed[k] === 'N7') agreed[k] = shown[k]; });
    assert.deepStrictEqual(shown, agreed, 'the map and the notes agree');
    before.forEach((props, path) => {
      const now = v.fm.get(path);
      if (!now) return;
      const strip = (x) => { const c = Object.assign({}, x); delete c.parent; return c; };
      assert.deepStrictEqual(strip(now), strip(props), `${path}: nothing but its parent changed`);
    });
    ['Album/N10.md', 'Album/N20.md'].forEach((pth) => before.delete(pth));
    let same = 0;
    before.forEach((props, path) => { if (v.fm.get(path) && JSON.stringify(v.fm.get(path)) === JSON.stringify(props)) same++; });
    assert.ok(same >= 196, `${same} notes untouched, as they were written`);
  });

  const fixtures = fs.readdirSync(path.join(__dirname, 'fixtures', 'canvas')).filter((f) => f.endsWith('.canvas')).sort();
  const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'canvas', name), 'utf8');
  // A map's shape by its nodes' words — a node without an id gets a new one each time it's read.
  const shapeOfModel = (m) => {
    const go = (n) => [n.text, n.attrs, n.children.map(go)];
    const text = (id) => R.nodeById(m, id).text;
    return [go(m.root), m.free.map(go), m.relations.map((r) => [text(r.from), text(r.to), r.label, r.attrs]), m.layout, m.mode || null];
  };

  await t('every canvas fixture converts to a map, written either way and read back the same, laid out where the canvas’s own map engine puts it', async () => {
    assert.ok(fixtures.length >= 6, fixtures.join());
    fixtures.forEach((name) => {
      const data = JSON.parse(fixture(name));
      const title = name.replace(/\.canvas$/, '');
      const { model } = R.mapFromCanvas(data, { title });
      const md = R.parseOutline(R.writeOutline(model, null, { title }), { title }).model;
      assert.deepStrictEqual(shapeOfModel(md), shapeOfModel(model), `${name}: as a note and back`);
      assert.deepStrictEqual(shapeOfModel(R.parseMindmapJson(R.writeMindmapJson(model))), shapeOfModel(model), `${name}: as a .mindmap file and back`);
      if (model.root.virtual) return;
      // The same cards laid out by the canvas's map engine, and by the map: within a pixel, the root where it is.
      const cards = R.modelFromData(data);
      cards.nodes.forEach((r) => { r.node = { unknownData: data.nodes.find((n) => n.id === r.id) }; });
      const places = R.mapLayout(cards, R.arrowLinks(cards)).places;
      const size = new Map(data.nodes.map((n) => [n.id, { width: n.width, height: n.height }]));
      const scene = R.layoutScene(model, (n) => size.get(n.id), model.mode || 'right');
      const root = places.get(model.root.id);
      scene.boxes.forEach((b, id) => {
        const at = places.get(id);
        assert.ok(at && Math.abs(at.x - root.x - b.x) <= 1 && Math.abs(at.y - root.y - b.y) <= 1, `${name}: ${id} at ${b.x},${b.y}; on the canvas ${at && at.x - root.x},${at && at.y - root.y}`);
      });
    });
  });

  await t('a canvas’s kept keys find their place in the map: folds, master, pins, colours, parts, groups, relations and their styles, layouts and nudges', async () => {
    const conv = (name) => R.mapFromCanvas(JSON.parse(fixture(name)), { title: name });
    const node = (m, id) => R.nodeById(m, id);
    let { model, report } = conv('folds.canvas');
    assert.deepStrictEqual([node(model, 'a').attrs.fold, node(model, 'a').children.map((c) => c.id)], [1, ['a1', 'a2']], 'a fold, what it holds under it');
    assert.deepStrictEqual([node(model, 'b').attrs.master, node(model, 'b').attrs.color], [1, '4']);
    assert.deepStrictEqual(node(model, 'p').attrs.pin, [300, 200], 'pinned where it lay, from the root');
    ({ model } = conv('branch-layout.canvas'));
    assert.strictEqual(model.mode, 'right');
    assert.deepStrictEqual([model.layout.branch, model.layout.nudge], [{ a: 'bottom' }, { b: [40, 20] }]);
    assert.ok(node(model, 'a').anchor && node(model, 'b').anchor, 'given their ids');
    ({ model } = conv('relations.canvas'));
    assert.deepStrictEqual(model.relations, [
      { from: 'a', to: 'b', label: 'contrasts with', attrs: { kind: 'contrasts with', style: 'dotted', shape: 'elbow', head: 'diamond', color: '1' } },
      { from: 'c', to: 'b', label: 'constrains', attrs: { predicate: 'constrains' } },
      { from: 'c', to: 'c1', label: '', attrs: { style: 'dashed' } },
    ]);
    assert.strictEqual(node(model, 'c1').parent.id, 'a', 'two parents: the first to reach it, as the canvas reads it; the other a dashed relation');
    assert.deepStrictEqual([node(model, 'c').attrs.role, node(model, 'c1').attrs.role], ['claim', 'reason']);
    ({ model, report } = conv('groups-notes.canvas'));
    assert.ok(model.root.virtual, 'two trees: a root of their own');
    assert.deepStrictEqual(model.root.children.map((c) => c.id), ['r', 't2']);
    assert.deepStrictEqual(model.free.map((n) => n.id), ['loose'], 'a card joined to nothing: free');
    assert.deepStrictEqual([node(model, 'f').text, node(model, 'f').attrs.group, node(model, 'u').text], ['[[Notes/Deterrence]]', 'Sources', '[https://example.com](https://example.com)']);
    assert.deepStrictEqual(report, ['The group “Loose ends”'], 'what has no place, said');
  });

  await t('converting a canvas leaves it byte for byte as it was; a map exported as a canvas converts back to the same tree', async () => {
    const text = fixture('relations.canvas');
    const created = new Map();
    const app = {
      vault: {
        read: async () => text,
        create: async (pth, t) => { created.set(pth, t); return new TFile(pth); },
        modify: async () => { throw new Error('the canvas written to'); },
        getAbstractFileByPath: () => null,
        getRoot: () => ({ path: '/' }),
      },
      metadataCache: {},
      workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    };
    const p = { settings: Object.assign({}, plugin.settings, { mindmapDefaultFormat: 'md' }), app, freeChildPath: (fo, base, ext) => `${base}.${ext}` };
    const maps = new R.MindMaps(p);
    const canvasFile = new TFile('relations.canvas');
    await maps.convertCanvas(canvasFile);
    assert.deepStrictEqual(Array.from(created.keys()), ['relations map.md']);
    assert.strictEqual(text, fixture('relations.canvas'), 'the canvas as it was');
    // Exported, and read back.
    const view = await open(created.get('relations map.md'), 'relations map.md');
    view.app = app;
    view.plugin = p;
    created.clear();
    await maps.exportCanvas(view);
    const back = R.mapFromCanvas(JSON.parse(created.get('relations map.canvas')));
    const ids = (m) => { const go = (n) => [n.id, n.children.map(go)]; return go(m.root); };
    assert.deepStrictEqual(ids(back.model), ids(view.model));
    assert.deepStrictEqual(back.model.relations.map((r) => [r.from, r.to, r.attrs.kind || r.attrs.predicate || '']), view.model.relations.map((r) => [r.from, r.to, r.attrs.kind || r.attrs.predicate || '']));
  });

  await t('a master node stays out of the folds above it, with what hangs from it; a group frames its branch, named', async () => {
    const view = await open('---\nmindmap: true\n---\n- Root ^r\n\t- Topic ^t %%{"group":"Phase 1"}%%\n\t\t- Detail ^d\n\t\t- Key idea ^k %%{"master":1}%%\n\t\t\t- Its example ^e\n\t- Other ^o\n');
    const frame = view.contentEl.querySelector('.dr-mindmap-group');
    assert.ok(frame && frame.textContent === 'Phase 1', 'the group framed and named');
    const t = view.scene.boxes.get('t');
    const e = view.scene.boxes.get('e');
    assert.ok(parseFloat(frame.style.left) < t.x && parseFloat(frame.style.left) + parseFloat(frame.style.width) > e.x + e.width, 'round the whole branch');
    view.toggleFold('t');
    assert.deepStrictEqual(['d', 'k', 'e'].map((id) => view.scene.boxes.has(id)), [false, true, true], 'folded: the master and what hangs from it stay');
    const edges = view.contentEl.querySelectorAll('.dr-mindmap-edge');
    assert.strictEqual(Array.from(edges).filter((p) => p.style.display !== 'none').length, 4, 'the master hangs from the fold');
  });

  await t('find goes to a node, opening the folds on the way; focus on a branch, or on what’s near a node, wider and narrower by keys', async () => {
    const view = await open(NOTE);
    R.registerMindMapHandlers();
    const research = view.model.root.children[0];
    const script = research.children[1];
    view.toggleFold(research.id);
    view.openTo(script.id);
    assert.ok(!research.attrs.fold && view.selected === script.id, 'found: the fold opened, the node selected');
    const dim = () => Array.from(view.contentEl.querySelectorAll('.dr-mindmap-node.is-unfocused')).map((el) => el.textContent.replace(/\d+$/, '')).sort();
    R.MINDMAP_HANDLERS.get('focus-canvas-branch').run({ view, model: view.model, node: research });
    assert.deepStrictEqual(dim(), ['API', 'Build', 'Launch plan', 'Ship', 'UI'], 'all but Research and its branch dimmed');
    R.MINDMAP_HANDLERS.get('focus-canvas-branch').run({ view, model: view.model, node: research });
    assert.deepStrictEqual(dim(), [], 'asked again: off');
    const build = view.model.root.children[1];
    R.MINDMAP_HANDLERS.get('focus-canvas-near').run({ view, model: view.model, node: build });
    assert.deepStrictEqual(dim(), ['Competitor notes', 'Interview script', 'Research', 'Ship'], 'a step from Build: the root, API and UI');
    const map = view.contentEl.querySelector('.dr-mindmap');
    key(map, '+');
    assert.deepStrictEqual(dim(), ['Competitor notes', 'Interview script'], 'wider');
    key(map, '-');
    key(map, 'Escape');
    assert.deepStrictEqual(dim(), [], 'Escape: off');
  });

  await t('a map and its notes’ relationships, both ways: relations with a kind written into the notes, and notes’ relationships drawn as relations', async () => {
    const files = {};
    ['Government', 'Parliamentarism', 'Courts'].forEach((n) => (files[`Ideas/${n}.md`] = Object.assign(new TFile(`Ideas/${n}.md`), {})));
    const fms = new Map([[files['Ideas/Courts.md'], { supports: '[[Parliamentarism]]' }]]);
    const app = {
      vault: { getFileByPath: (p) => files[p] || null, getMarkdownFiles: () => Object.values(files), getAbstractFileByPath: (p) => files[p] || null },
      metadataCache: {
        getFileCache: (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null),
        getFirstLinkpathDest: (l) => Object.values(files).find((f) => f.basename === l) || null,
        fileToLinktext: (f) => f.basename,
        on: () => ({}),
      },
      fileManager: { processFrontMatter: async (f, fn) => { const fm = JSON.parse(JSON.stringify(fms.get(f) || {})); fn(fm); fms.set(f, fm); } },
      workspace: { trigger() {} },
    };
    let undo = null;
    const p = { settings: Object.assign({}, plugin.settings, { knowledge: true, graphRouteProperty: 'parent' }), app, offerUndo: (m, fn) => { undo = fn; }, refreshBrowse() {} };
    p.notes = new R.Notes(p);
    const k = new R.Knowledge(p);
    k.enabled = true;
    p.feature = (C) => (C === R.Knowledge ? k : null);
    const view = await open('---\nmindmap: true\n---\n- [[Government]] ^g\n\t- [[Parliamentarism]] ^p\n\t- [[Courts]] ^c\n\n## Relations\n- ^p -> ^g "is a type of" %%{"kind":"is a type of"}%%\n', 'Ideas/Map.md');
    Object.assign(view, { app, plugin: p });
    // The map into the notes: the first note says it.
    assert.strictEqual(await view.writeRelationsToNotes(), 1);
    assert.deepStrictEqual(fms.get(files['Ideas/Parliamentarism.md'])['is a type of'], ['[[Government]]']);
    assert.strictEqual(await view.writeRelationsToNotes(), 0, 'in them already');
    await undo();
    assert.ok(!('is a type of' in fms.get(files['Ideas/Parliamentarism.md'])));
    // The notes onto the map: a relation for each relationship not drawn, labelled and given its kind.
    k.cache = null;
    assert.strictEqual(view.drawNoteRelations(), 1);
    const drawn = view.model.relations[1];
    assert.deepStrictEqual([drawn.from, drawn.to, drawn.label, drawn.attrs.kind], ['c', 'p', 'supports', 'supports']);
  });

  await t('the parity matrix: every canvas module and scenario has its place on a map, and each proving test is there', async () => {
    const parity = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshots', 'parity.json'), 'utf8'));
    const modules = fs.readdirSync(path.join(__dirname, '..', 'src', 'canvas')).map((f) => f.replace(/\.js$/, '')).sort();
    const titles = (file) => Array.from(fs.readFileSync(path.join(__dirname, file), 'utf8').matchAll(/await t\('((?:[^'\\]|\\.)*)'/g)).map((m) => m[1]);
    const scenarios = titles('test_canvas.js');
    const proofs = titles('test_mindmap.js').concat(titles('test_tree.js'));
    assert.deepStrictEqual(Object.keys(parity.modules).sort(), modules, 'one entry for each canvas module');
    assert.deepStrictEqual(Object.keys(parity.scenarios).sort(), scenarios.slice().sort(), 'one entry for each canvas scenario');
    const statuses = ['ported', 'automatic', 'replaced', 'not needed'];
    Object.entries(Object.assign({}, parity.modules, parity.scenarios)).forEach(([name, entry]) => {
      assert.ok(statuses.includes(entry.status), `${name}: ${entry.status}`);
      if (entry.status === 'not needed') assert.ok(entry.reason && entry.reason.length > 10, `${name}: why it isn’t needed`);
      else assert.ok(entry.test && proofs.some((t) => t.includes(entry.test)), `${name}: no test proves it (${entry.test})`);
    });
  });

  await t('the budgets on a 2,000-node map: parse and write, open, layout after an edit, fold of 500 nodes, a pan — each under 1.5 times its target', async () => {
    const { mapText } = require('./mapgen');
    const BUDGET = { parse: 20, write: 20, open: 300, edit: 50, fold: 50, pan: 1000 / 60 };
    const measure = async (count) => {
      const text = mapText(count);
      const ms = (fn) => { const t0 = process.hrtime.bigint(); const out = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, out]; };
      const [parse, parsed] = ms(() => R.parseOutline(text));
      const first = parsed.model.root.children[0];
      R.setText(parsed.model, first.id, first.text + ' and more');
      const [write] = ms(() => R.writeOutline(parsed.model, text));
      const t0 = Date.now();
      const view = await open(text, 'Big.md');
      const openMs = Date.now() - t0;
      // Edit and fold: the best of three, as a machine's hiccup isn't the map's.
      const node = view.model.root.children[1].children[0];
      const edit = Math.min(...[1, 2, 3].map((k) => ms(() => view.apply(R.setText(view.model, node.id, `${node.text} changed ${k}`)))[0]));
      const big = view.model.root.children[0];
      const fold = Math.min(...[1, 2, 3].map(() => {
        const [took] = ms(() => view.toggleFold(big.id));
        view.toggleFold(big.id);
        return took;
      }));
      view.camera = { x: view.camera.x, y: view.camera.y, zoom: 1 };
      const [pans] = ms(() => {
        for (let k = 0; k < 20; k++) {
          view.camera = { x: view.camera.x + 40, y: view.camera.y, zoom: 1 };
          view.draw();
        }
      });
      let below = 0;
      (function c(x) { x.children.forEach((k) => { below++; c(k); }); })(big);
      return { parse, write, open: openMs, edit, fold, pan: pans / 20, below };
    };
    const t2 = await measure(2000);
    const t5 = await measure(5000);
    const show = (m) => Object.keys(BUDGET).map((k) => `${k} ${m[k].toFixed(1)} ms`).join(', ');
    if (process.env.SHOW_TIMES) console.log(`    2,000 nodes: ${show(t2)}\n    5,000 nodes: ${show(t5)}`);
    assert.ok(t2.below + 1 >= 499, `the folded branch holds ${t2.below} nodes`);
    Object.keys(BUDGET).forEach((k) => assert.ok(t2[k] <= BUDGET[k] * 1.5, `${k}: ${t2[k].toFixed(1)} ms, over 1.5 × ${BUDGET[k].toFixed(1)} ms`));
  });

  await t('lines pasted under the selected node keep their nesting', async () => {
    const view = await open(NOTE);
    view.select(view.model.root.children[2].id);
    const evt = new window.Event('paste', { bubbles: true, cancelable: true });
    evt.clipboardData = { getData: () => '- Launch\n  - Party\n- Review' };
    view.contentEl.querySelector('.dr-mindmap').dispatchEvent(evt);
    const ship = view.model.root.children[2];
    assert.deepStrictEqual(ship.children.map((c) => c.text), ['Launch', 'Review']);
    assert.deepStrictEqual(ship.children[0].children.map((c) => c.text), ['Party']);
  });

  await t('the note changed outside while typing: nothing typed is lost, the outside change is kept, own writes aren’t news', async () => {
    const view = await open(NOTE);
    const writes = [];
    view.app = { vault: { modify: async (f, text) => writes.push(text) } };
    const build = view.model.root.children[1];
    view.edit(build.id);
    view.editing.editor.dispatch({ changes: { from: view.editing.editor.state.doc.length, insert: ' it' } });
    // Meanwhile, as text: a node added under Ship and Research renamed.
    const outside = NOTE.replace('\t- Ship\n', '\t- Ship\n\t\t- Launch party\n').replace('\t- Research\n', '\t- Research and notes\n');
    changedOutside(view, outside);
    assert.ok(view.editing && view.editing.id === build.id, 'still typing in the same node');
    view.editing.editor.dispatch({ changes: { from: view.editing.editor.state.doc.length, insert: '!' } });
    view.closeEditor(true);
    view.flushSave();
    const text = writes[writes.length - 1];
    assert.ok(text.includes('\t- Build it!\n'), 'what was typed, before and after');
    assert.ok(text.includes('\t\t- Launch party\n') && text.includes('\t- Research and notes\n'), 'and the outside change');
    const before = writes.length;
    changedOutside(view, text);
    assert.strictEqual(writes.length, before);
    assert.strictEqual(view.pending.length, 0, 'its own write back: nothing new');
    // A node changed here and deleted outside: the outside wins, the change set aside.
    const ship = view.model.root.children.find((c) => c.text === 'Ship');
    view.select(ship.id);
    view.edit(ship.id);
    view.editing.editor.dispatch({ changes: { from: 0, insert: 'Go ' } });
    changedOutside(view, text.replace(/\t- Ship\n\t\t- Launch party\n/, ''));
    assert.ok(!view.model.root.children.some((c) => /Ship/.test(c.text)), 'gone outside: gone');
    assert.strictEqual((view.setAside || []).length, 1, 'the change here set aside');
    assert.ok(!view.editing, 'and its editor with it');
  });

  await t('the canvas’s commands act on a mind map under the same ids', async () => {
    const view = await open(NOTE);
    R.registerMindMapHandlers();
    R.setMindMapContext(() => ({ view, model: view.model, node: view.selected ? view.model.root.children.find((c) => c.id === view.selected) : null }));
    const commands = R.actionCommands([{ id: 'fold-canvas-branch', name: 'Fold', on: 'canvas', run: () => assert.fail('the canvas’s own') }], () => null);
    view.select(view.model.root.children[0].id);
    assert.ok(commands[0].check());
    commands[0].run();
    assert.strictEqual(view.model.root.children[0].attrs.fold, 1, 'Fold branch folded the node');
    R.setMindMapContext(null);
    assert.ok(!commands[0].check(), 'with no map, the canvas’s again');
    // Every canvas command a map answers, there; a few run.
    ['canvas-quick-add', 'canvas-add-child-card', 'canvas-add-sibling-card', 'canvas-add-parent-card', 'fold-canvas-branch', 'fold-every-canvas-branch', 'unfold-canvas-everything', 'duplicate-canvas-branch', 'canvas-zoom-to-branch', 'fit-canvas-cards', 'canvas-layout-choose', 'canvas-layout-everything', 'canvas-map-tidy', 'tidy-canvas-branch', 'toggle-canvas-legend', 'canvas-toggle-keep-in-place', 'canvas-view-back', 'find-canvas-card', 'focus-canvas-branch', 'focus-canvas-near', 'present-map', 'check-canvas', 'canvas-compare', 'canvas-branch-to-note', 'canvas-outline-to-branch', 'canvas-name-relationship', 'canvas-make-claim', 'canvas-add-reason', 'canvas-promote-card', 'canvas-demote-card', 'canvas-card-earlier', 'canvas-card-later', 'arrange-canvas-row', 'arrange-canvas-left', 'knowledge-canvas-write', 'knowledge-canvas-draw', 'refresh-album-map'].forEach((id) => assert.ok(R.MINDMAP_HANDLERS.has(id), `${id} acts on a map`));
    const ctx = { view, model: view.model, node: view.model.root.children[1] };
    R.MINDMAP_HANDLERS.get('unfold-canvas-everything').run(ctx);
    R.MINDMAP_HANDLERS.get('fold-every-canvas-branch').run(ctx);
    assert.ok(view.model.root.children[1].attrs.fold, 'every branch folded');
    R.MINDMAP_HANDLERS.get('unfold-canvas-everything').run(ctx);
    assert.ok(!view.model.root.children.some((c) => c.attrs.fold), 'and unfolded');
    const before = view.model.root.children[1].children.length;
    R.MINDMAP_HANDLERS.get('canvas-quick-add').run(ctx);
    assert.strictEqual(view.model.root.children[1].children.length, before + 1, 'quick add: a node under it, to type in');
    assert.ok(view.editing);
    view.closeEditor(true);
  });

  await t('2,000 nodes: laid out and drawn at once, only what’s on screen, and a pan in well under a frame', async () => {
    const lines = ['- Root'];
    let n = 1;
    const branch = (depth) => {
      for (let k = 0; k < (depth === 1 ? 20 : depth === 2 ? 10 : 9) && n < 2000; k++) {
        lines.push('\t'.repeat(depth) + `- Node ${n++} with a few words of text`);
        if (depth < 3) branch(depth + 1);
      }
    };
    branch(1);
    let started = Date.now();
    const view = await open(lines.join('\n') + '\n', 'Big.md');
    const opened = Date.now() - started;
    let count = 0;
    view.model && (function c(x) { count++; x.children.forEach(c); })(view.model.root);
    assert.ok(count >= 1999, `${count} nodes`);
    assert.ok(view.renderer.drawn < count / 4, `only what's on screen: ${view.renderer.drawn} of ${count}`);
    view.camera = { x: view.camera.x, y: view.camera.y, zoom: 1 };
    started = Date.now();
    for (let k = 0; k < 20; k++) {
      view.camera = { x: view.camera.x + 40, y: view.camera.y, zoom: 1 };
      view.draw();
    }
    const perPan = (Date.now() - started) / 20;
    if (process.env.SHOW_TIMES) console.log(`    opened in ${opened} ms; a pan ${perPan.toFixed(1)} ms`);
    assert.ok(opened < 2000, `opened in ${opened} ms`);
    assert.ok(perPan < 16, `a pan in ${perPan} ms`);
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
