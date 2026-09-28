// Loads the real main.js against a stubbed 'obsidian' module and
// exercises the one-page patch: the part of the shell that can break
// other plugins if it's wrong.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');

class Dummy { constructor() {} }
const obsidian = new Proxy({}, {
  get: (_, key) => {
    if (key === '__esModule') return false;
    if (key === 'Notice') return class { constructor(msg) { notices.push(msg); } };
    return Dummy;
  },
});
const notices = [];
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return obsidian;
  return origLoad.call(this, req, ...rest);
};

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { around, OnePage, Library, pageLeaf, canStep, step, ONE_PAGE_MENU_ITEMS, HIDDEN_MENU_ITEMS };\n';
const tmp = path.join(__dirname, '_main_under_test.js');
fs.writeFileSync(tmp, src);
const { around, OnePage, Library, pageLeaf, canStep, step } = require(tmp).__test;

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

/* -- around ------------------------------------------------------- */

class WS { getLeaf(kind, dir) { return ['orig', kind, dir]; } }

t('wrap intercepts and unwrap restores the prototype method', () => {
  const ws = new WS();
  const undo = around(ws, 'getLeaf', (o, self, args) => ['wrapped', ...o.apply(self, args)]);
  assert.deepStrictEqual(ws.getLeaf('tab'), ['wrapped', 'orig', 'tab', undefined]);
  assert.ok(Object.prototype.hasOwnProperty.call(ws, 'getLeaf'));
  undo();
  assert.ok(!Object.prototype.hasOwnProperty.call(ws, 'getLeaf'), 'own property left behind');
  assert.deepStrictEqual(ws.getLeaf('tab'), ['orig', 'tab', undefined]);
});

t('a later wrapper survives ours being undone', () => {
  const ws = new WS();
  const undoOurs = around(ws, 'getLeaf', (o, self, args) => ['ours', ...o.apply(self, args)]);
  const undoTheirs = around(ws, 'getLeaf', (o, self, args) => ['theirs', ...o.apply(self, args)]);
  undoOurs();
  // Ours is now a pass-through; theirs still runs.
  assert.deepStrictEqual(ws.getLeaf('tab'), ['theirs', 'orig', 'tab', undefined]);
  undoTheirs();
  // Theirs restored to our (inert) wrapper, which still passes through.
  assert.deepStrictEqual(ws.getLeaf('tab'), ['orig', 'tab', undefined]);
});

t('undo twice is harmless', () => {
  const ws = new WS();
  const undo = around(ws, 'getLeaf', (o, self, args) => 'x');
  undo(); undo();
  assert.deepStrictEqual(ws.getLeaf(), ['orig', undefined, undefined]);
});

/* -- the feature -------------------------------------------------- */

function makePlugin({ onePage = true, singleArea = true, rootLeaves = 1, pageType = 'markdown' } = {}) {
  const calls = [];
  const page = {
    type: pageType,
    getViewState() { return { type: this.type }; },
    setViewState(vs) { calls.push(['setViewState', vs]); this.type = vs.type; return Promise.resolve(); },
  };
  const workspace = new (class extends WS {})();
  workspace.getLeaf = function (kind) { calls.push(['getLeaf', kind]); return page; };
  // getLeaf lives on the prototype in Obsidian, not as an own property.
  delete workspace.getLeaf;
  Object.getPrototypeOf(workspace).getLeaf = function (kind) { calls.push(['getLeaf', kind]); return page; };
  workspace.rootSplit = {};
  workspace.getMostRecentLeaf = () => page;
  workspace.iterateRootLeaves = (cb) => { for (let i = 0; i < rootLeaves; i++) cb({}); };
  workspace.on = () => ({});

  const plugin = {
    app: { workspace },
    settings: { onePage, singleArea, library: true },
    registerEvent() {},
  };
  const library = Object.create(Library.prototype);
  library.plugin = plugin;
  plugin.feature = (Ctor) => (Ctor === Library ? library : null);
  return { plugin, workspace, page, calls };
}

// document.body stand-in, since enable() toggles a class on it.
global.document = { body: { classes: new Set(), addClass(c) { this.classes.add(c); }, removeClass(c) { this.classes.delete(c); } } };

t('new tab, split and window requests all land on the current page', () => {
  const { plugin, workspace, calls } = makePlugin();
  const f = new OnePage(plugin);
  f.enable();
  ['tab', 'split', 'window', true].forEach((kind) => workspace.getLeaf(kind));
  const kinds = calls.filter((c) => c[0] === 'getLeaf').map((c) => c[1]);
  assert.deepStrictEqual(kinds, [false, false, false, false]);
  f.disable();
});

t('a same-page request passes through untouched', () => {
  const { plugin, workspace, calls } = makePlugin();
  const f = new OnePage(plugin);
  f.enable();
  workspace.getLeaf(false);
  workspace.getLeaf();
  const kinds = calls.filter((c) => c[0] === 'getLeaf').map((c) => c[1]);
  assert.deepStrictEqual(kinds, [false, undefined]);
  f.disable();
});

t('enabling twice wraps once', () => {
  const { plugin, workspace, calls } = makePlugin();
  const f = new OnePage(plugin);
  f.enable(); f.enable(); f.enable();
  workspace.getLeaf('tab');
  assert.strictEqual(calls.filter((c) => c[0] === 'getLeaf').length, 1);
  f.disable();
  assert.ok(!Object.prototype.hasOwnProperty.call(workspace, 'getLeaf'), 'patch left behind');
});

t('switching off restores real new tabs', () => {
  const { plugin, workspace, calls } = makePlugin();
  const f = new OnePage(plugin);
  f.enable(); f.disable();
  workspace.getLeaf('tab');
  assert.deepStrictEqual(calls.filter((c) => c[0] === 'getLeaf').map((c) => c[1]), ['tab']);
  assert.ok(!document.body.classes.has('dr-one-page'));
});

t('an empty page becomes Home, once', async () => {
  const { plugin, calls } = makePlugin({ pageType: 'empty' });
  const f = new OnePage(plugin);
  f.enable();
  f.fillEmpty(); // re-entry while the first is in flight
  const sets = calls.filter((c) => c[0] === 'setViewState');
  assert.strictEqual(sets.length, 1);
  assert.strictEqual(sets[0][1].state.mode, 'home');
  f.disable();
});

t('a page with something on it is left alone', () => {
  const { plugin, calls } = makePlugin({ pageType: 'markdown' });
  const f = new OnePage(plugin);
  f.enable();
  assert.strictEqual(calls.filter((c) => c[0] === 'setViewState').length, 0);
  f.disable();
});

t('hidden tabs are mentioned once, only when the tab bar is hidden', () => {
  notices.length = 0;
  let { plugin } = makePlugin({ rootLeaves: 3, singleArea: true });
  let f = new OnePage(plugin);
  f.enable(); f.enable();
  assert.strictEqual(notices.length, 1);
  assert.ok(/2 other pages are/.test(notices[0]), notices[0]);
  f.disable();

  notices.length = 0;
  ({ plugin } = makePlugin({ rootLeaves: 3, singleArea: false }));
  f = new OnePage(plugin);
  f.enable();
  assert.strictEqual(notices.length, 0);
  f.disable();
});

/* -- history helpers --------------------------------------------- */

t('history reads the leaf, and tolerates a leaf without one', () => {
  const moves = [];
  const leaf = { history: { backHistory: [1], forwardHistory: [], back: () => moves.push('b'), forward: () => moves.push('f') } };
  assert.strictEqual(canStep(leaf, 'back'), true);
  assert.strictEqual(canStep(leaf, 'forward'), false);
  step(leaf, 'back');
  assert.deepStrictEqual(moves, ['b']);
  assert.strictEqual(canStep({}, 'back'), false);
  assert.strictEqual(canStep(null, 'back'), false);
  step(null, 'back'); // no throw
});

fs.unlinkSync(tmp);
setTimeout(() => console.log(`\n${passed} passed`), 20);
