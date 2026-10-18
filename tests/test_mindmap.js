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
  '\nmodule.exports.__test = { MindMapView, MindMaps, MINDMAP_VIEW, isMindMapNote, keepAsText, keptAsText, takeOverLeaves, layoutScene, estimateSize, nodeLabel, DEFAULTS };\n');
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
const shown = (view) => Array.from(view.contentEl.querySelectorAll('.dr-mindmap-node')).map((el) => el.textContent.replace(/\d+$/, ''));

const NOTE = '---\nmindmap: true\n---\n- Launch plan ^root\n\t- Research\n\t\t- [[Competitor notes]]\n\t\t- Interview script\n\t- Build\n\t\t- API\n\t\t- UI\n\t- Ship\n';

(async () => {
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
    assert.strictEqual(view.saves, 1);
    assert.strictEqual(view.data, NOTE.replace('\t- Research\n', '\t- Research %%{"fold":1}%%\n'), 'only its own line changed');
    // The knob unfolds.
    pointer(node('Research').querySelector('.dr-mindmap-knob'), 'pointerdown');
    assert.strictEqual(view.data, NOTE, 'and back, byte for byte');
    view.foldAll(true);
    assert.deepStrictEqual(shown(view).sort(), ['Build', 'Launch plan', 'Research', 'Ship']);
    view.foldAll(false);
    assert.strictEqual(view.data, NOTE);
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
    assert.ok(json.data.startsWith('{\n  "v": 1,\n  "root": {\n    "id": "r",'), 'written as a .mindmap file');
  });

  await t('a file that can’t be read is shown as it is, with what went wrong, and never written', async () => {
    const view = await open('{ broken', 'Broken.mindmap');
    assert.ok(view.contentEl.querySelector('.dr-mindmap-failure'));
    assert.ok(view.contentEl.querySelector('.dr-mindmap-failure-text').textContent.includes('{ broken'));
    view.foldAll(true);
    view.commit();
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
