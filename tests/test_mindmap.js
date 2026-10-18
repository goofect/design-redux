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
  '\nmodule.exports.__test = { MindMapView, MindMaps, MINDMAP_VIEW, isMindMapNote, keepAsText, keptAsText, takeOverLeaves, layoutScene, estimateSize, nodeLabel, DEFAULTS, dropTarget, MINDMAP_HANDLERS, registerMindMapHandlers, actionCommands, setMindMapContext, mapLayout, modelFromData, arrowLinks, BRANCH_LAYOUTS, setBranchLayout, setNudge, nodeNudge, setAttr, setText, addChild, setLegendName, setSavedView, setMapLayout, SETTINGS_MIGRATIONS, branchLayoutOf, setRelationMeaning, relationTypes, statementsMarkdown, nodeParts, branchNoteText, relinkText, mapProblems, compareMaps, compareMapBranches, parseOutline };\n');
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
        const across = depth ? order++ * 1000 : 0;
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
