// Back and forward on a folder page, against the real main.js: they
// move through the folders — up to the one it's in, down again — while
// every other screen's pair, and the strip's, keep to the history.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.CSS = { escape: (s) => s };

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
P.setText = function (t) { this.textContent = t; };
P.isShown = function () { return true; };

class Component { registerEvent() {} register() {} registerDomEvent(el, t, f) { el.addEventListener(t, f); } }
class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.containerEl = document.createElement('div');
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
  }
  async setState() {}
}
class TAbstractFile {}
class TFile extends TAbstractFile {
  constructor(p) {
    super(); this.path = p; this.name = p.split('/').pop();
    this.basename = this.name.replace(/\.[^.]+$/, ''); this.extension = 'md';
    this.stat = { mtime: Date.now(), ctime: Date.now() };
  }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p === '/' ? '' : p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
const obsidian = new Proxy({
  ItemView, TFile, TFolder, TAbstractFile, Component,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class {},
  Platform: { isMobile: false },
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_foldernav_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { BrowseView, ContextStrip, Orders };\n');
const { BrowseView, Orders } = require(tmp).__test;
fs.unlinkSync(tmp);

/* -- a vault ------------------------------------------------------------ */

const root = new TFolder('/');
const folders = {};
const files = [];
const folder = (p, parent) => {
  const f = new TFolder(p); f.parent = parent; parent.children.push(f); folders[p] = f; return f;
};
const note = (parent, name) => {
  const f = new TFile(`${parent.path === '/' ? '' : parent.path + '/'}${name}.md`);
  f.parent = parent; parent.children.push(f); files.push(f); return f;
};
const ir = folder('IR', root);
const theories = folder('IR/Theories', ir);
const critical = folder('IR/Theories/Critical', theories); // sorts first, so forward's fallback
const liberal = folder('IR/Theories/Liberal', theories);
const thinkers = folder('IR/Thinkers', ir);
const books = folder('Books', root);
note(ir, 'Anarchy'); note(theories, 'Realism'); note(critical, 'Cox'); note(liberal, 'Kant'); note(thinkers, 'Waltz'); note(books, 'Crisis');

const plugin = {
  settings: {
    defaultSort: 'name', recentSearches: [], categoryProperty: '', hideEmptyFolders: false,
    albumColumns: '', albumNoteLimit: 8, discNoteLimit: 10, coverProperty: 'cover', tableColumns: '',
  },
  saveData: async () => {},
  isFolderNote: () => false,
  folderHasNotes: () => true,
  recentFiles: () => [],
  pins: { files: () => [], folders: () => [], has: () => false },
  folderNote: () => null,
  folderCoverSrc: () => null,
  feature: () => null,
};
const app = {
  workspace: { leftSplit: { expand() {} }, getLeaf: () => ({ openFile() {} }), trigger() {} },
  vault: {
    getRoot: () => root,
    getMarkdownFiles: () => files,
    getFolderByPath: (p) => (p === '/' ? root : folders[p] || null),
    getFileByPath: () => null,
    getAbstractFileByPath: (p) => folders[p] || null,
    getName: () => 'All the Notes',
  },
  metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
};
plugin.app = app;
plugin.orders = new Orders(plugin);

/** A page whose moves go through setViewState and land in history, as in Obsidian. */
function page(state) {
  const stepped = [];
  const leaf = {
    history: { backHistory: [{}], forwardHistory: [{}], back() { stepped.push('back'); }, forward() { stepped.push('forward'); } },
    setViewState: async (vs) => { leaf.entries.push(vs.state); await view.setState(vs.state, {}); },
    entries: [],
  };
  const view = new BrowseView(leaf, plugin);
  view.app = app;
  document.body.innerHTML = '';
  document.body.appendChild(view.containerEl);
  Object.assign(view, { mode: 'folder', path: '/', property: null, value: null }, state);
  view.render();
  return { view, leaf, stepped };
}
const nav = (view, dir) => view.contentEl.querySelector(
  `.dr-detail-bar .dr-browse-up[aria-label^="${dir}"]`);
const press = async (view, dir) => {
  nav(view, dir).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
};

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  await t('back goes up to the folder this one is in', async () => {
    const { view } = page({ path: 'IR/Theories' });
    assert.strictEqual(nav(view, 'Back').getAttribute('aria-label'), 'Back to IR');
    await press(view, 'Back');
    assert.strictEqual(view.path, 'IR');
  });

  await t('forward goes back down the way you came up', async () => {
    const { view } = page({ path: 'IR/Theories' });
    await press(view, 'Back');
    assert.strictEqual(nav(view, 'Forward').getAttribute('aria-label'), 'Forward to Theories');
    await press(view, 'Forward');
    assert.strictEqual(view.path, 'IR/Theories');
  });

  await t('up two levels comes back down both', async () => {
    const { view } = page({ path: 'IR/Theories/Liberal' });
    await press(view, 'Back');
    await press(view, 'Back');
    assert.strictEqual(view.path, 'IR');
    await press(view, 'Forward');
    assert.strictEqual(view.path, 'IR/Theories');
    await press(view, 'Forward');
    assert.strictEqual(view.path, 'IR/Theories/Liberal');
  });

  await t('going up from another branch replaces the way down', async () => {
    const { view } = page({ path: 'IR/Theories' });
    await press(view, 'Back'); // trail: Theories
    await view.openFolder(thinkers); // into a different subfolder by its tile
    await press(view, 'Back'); // trail: Thinkers now
    assert.strictEqual(nav(view, 'Forward').getAttribute('aria-label'), 'Forward to Thinkers');
  });

  await t("with no way back down, forward goes into the first subfolder", async () => {
    const { view } = page({ path: 'IR' });
    assert.strictEqual(nav(view, 'Forward').getAttribute('aria-label'), 'Forward to Theories');
    const leafFolder = page({ path: 'IR/Thinkers' }).view;
    assert.ok(nav(leafFolder, 'Forward').classList.contains('is-disabled'), 'nowhere further in');
  });

  await t('the vault root has nothing above it; a top folder goes back to it', async () => {
    const top = page({ path: '/' }).view;
    assert.ok(nav(top, 'Back').classList.contains('is-disabled'));
    const { view } = page({ path: 'Books' });
    assert.strictEqual(nav(view, 'Back').getAttribute('aria-label'), 'Back to All the Notes');
    await press(view, 'Back');
    assert.strictEqual(view.path, '/');
    assert.strictEqual(nav(view, 'Forward').getAttribute('aria-label'), 'Forward to Books');
  });

  await t("folder steps are real moves, so the strip's back returns from them", async () => {
    const { view, leaf } = page({ path: 'IR/Theories' });
    await press(view, 'Back');
    assert.strictEqual(leaf.entries.length, 1, 'not recorded in the history');
    assert.strictEqual(leaf.entries[0].path, 'IR');
  });

  await t('the way down survives a round trip through the history', async () => {
    const { view } = page({ path: 'IR/Theories/Liberal' });
    await press(view, 'Back');
    const saved = view.getState();
    assert.strictEqual(saved.trail, 'IR/Theories/Liberal');
    // A fresh view, as when a note was opened in the page and back was pressed.
    const again = page({}).view;
    await again.setState(saved, {});
    assert.strictEqual(nav(again, 'Forward').getAttribute('aria-label'), 'Forward to Liberal');
  });

  await t("other screens' back and forward are still the history", async () => {
    const { view, stepped } = page({ mode: 'notes' });
    await press(view, 'Back');
    await press(view, 'Forward');
    assert.deepStrictEqual(stepped, ['back', 'forward']);
  });

  await t('the folder pair is marked, so a phone keeps its forward', () => {
    const { view } = page({ path: 'IR' });
    assert.ok(nav(view, 'Forward').classList.contains('is-folder-step'));
    assert.ok(nav(view, 'Forward').classList.contains('dr-browse-forward'));
    const notes = page({ mode: 'notes' }).view;
    assert.ok(!nav(notes, 'Forward').classList.contains('is-folder-step'));
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
