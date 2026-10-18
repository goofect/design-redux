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
  '\nmodule.exports.__test = { MindMapView, MindMaps, MINDMAP_VIEW, isMindMapNote, keepAsText, keptAsText, takeOverLeaves, layoutScene, estimateSize, nodeLabel, DEFAULTS, dropTarget, MINDMAP_HANDLERS, registerMindMapHandlers, actionCommands, setMindMapContext, mapLayout, modelFromData, arrowLinks, BRANCH_LAYOUTS, setBranchLayout, setNudge, nodeNudge };\n');
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
    const meant = ['canAcceptExtension', 'getViewType', 'getDisplayText', 'getIcon', 'getViewData', 'setViewData', 'clear', 'onOpen', 'onClose'];
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
