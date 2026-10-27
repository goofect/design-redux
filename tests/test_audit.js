// Regression tests for the defects the audit fixed, against the real
// main.js. Each test fails on the pre-audit code.
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
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (f) => setTimeout(f, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.CSS = { escape: (s) => s.replace(/"/g, '\\"') };

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

const notices = [];
const shown = [];
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = { title: '' };
    ['setTitle', 'setIcon', 'setChecked', 'setDisabled', 'setSection'].forEach((m) => {
      item[m] = (v) => { if (m === 'setTitle') item.title = v; return item; };
    });
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
  addSeparator() { return this; }
}
const originalShow = function () {
  shown.push(Array.isArray(this.items)
    ? this.items.map((i) => (i.titleEl ? i.titleEl.textContent : i.title))
    : this.items);
};
Menu.prototype.showAtPosition = originalShow;

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
class MarkdownView {}

const obsidian = new Proxy({
  Menu, ItemView, Component, TFile, TFolder, TAbstractFile, MarkdownView,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class { constructor(m) { notices.push(m); } },
  Platform: { isMobile: false, isPhone: false },
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_audit_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { Notes, PropertiesSection, Pins, BrowseView, MenuFilter, looseOr, fmGet, ' +
  'composing, listEnter, renderLists, makeHeaderDraggable };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);
const { EditorState } = require('@codemirror/state');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/* -- a properties panel over one note ----------------------------------- */

function panelFor(initial) {
  const file = { path: 'Court.md', basename: 'Court' };
  const stored = { fm: Object.assign({}, initial), writes: 0 };
  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter: Object.assign({ position: {} }, stored.fm) }) },
    metadataTypeManager: { getTypeInfo: () => null, registeredTypeWidgets: {}, getAllProperties: () => ({}) },
    fileManager: {
      processFrontMatter: async (f, fn) => {
        const fm = Object.assign({}, stored.fm);
        fn(fm);
        if (JSON.stringify(fm) !== JSON.stringify(stored.fm)) stored.writes++;
        stored.fm = fm;
      },
    },
  };
  document.body.innerHTML = '';
  const popupEl = document.body.appendChild(document.createElement('div'));
  const plugin = { app, settings: {} };
  plugin.notes = new R.Notes(plugin);
  const section = new R.PropertiesSection({ plugin, popupEl });
  section.mount(popupEl, file);
  return { section, stored, popupEl };
}

(async () => {
  /* -- properties ------------------------------------------------------ */

  await t("renaming onto a property the note has is refused, whatever its case", async () => {
    const { section, stored } = panelFor({ domain: 'Law', status: 'draft' });
    notices.length = 0;
    await section.rename('status', 'Domain');
    assert.deepStrictEqual(stored.fm, { domain: 'Law', status: 'draft' }, 'a value was overwritten');
    assert.strictEqual(stored.writes, 0);
    assert.match(notices[0], /already a property called "domain"/);
  });

  await t('the refusal holds when the cache is behind the file', async () => {
    const { section, stored } = panelFor({ domain: 'Law', status: 'draft' });
    stored.fm.extra = 'written elsewhere'; // the panel's copy hasn't seen it
    await section.rename('status', 'extra');
    assert.strictEqual(stored.fm.extra, 'written elsewhere');
    assert.strictEqual(stored.fm.status, 'draft');
  });

  await t('a plain rename still works, keeping the property in its place', async () => {
    const { section, stored } = panelFor({ domain: 'Law', status: 'draft', tags: ['a'] });
    await section.rename('status', 'stage');
    assert.deepStrictEqual(Object.keys(stored.fm), ['domain', 'stage', 'tags']);
    assert.strictEqual(stored.fm.stage, 'draft');
  });

  await t("adding a name the note already has goes to it instead of emptying it", async () => {
    const { stored, popupEl } = panelFor({ domain: 'Law' });
    notices.length = 0;
    popupEl.querySelector('.dr-props-add').click();
    const input = popupEl.querySelector('.dr-add input');
    input.value = 'DOMAIN';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    assert.strictEqual(stored.fm.domain, 'Law');
    assert.strictEqual(stored.writes, 0);
    assert.match(notices[0], /already has "domain"/);
    const row = popupEl.querySelector('.dr-row[data-key="domain"]');
    assert.ok(row.contains(document.activeElement), "focus didn't go to the existing property");
  });

  await t('adding a new name writes it empty; Enter mid-composition does nothing', async () => {
    const { stored, popupEl } = panelFor({ domain: 'Law' });
    popupEl.querySelector('.dr-props-add').click();
    const input = popupEl.querySelector('.dr-add input');
    input.value = 'rating';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    await settle();
    assert.strictEqual(stored.writes, 0, 'an IME Enter committed');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    assert.strictEqual(stored.fm.rating, '');
  });

  await t('properties are read whatever case the note wrote them in', () => {
    assert.strictEqual(R.fmGet({ Author: 'Le Guin' }, 'author'), 'Le Guin');
    assert.strictEqual(R.fmGet({ author: 'a', Author: 'b' }, 'Author'), 'b', 'an exact match comes first');
    assert.strictEqual(R.fmGet({ a: 1 }, 'b'), undefined);
    assert.strictEqual(R.fmGet(null, 'a'), undefined);
  });

  await t('composition is recognised by either flag', () => {
    assert.strictEqual(R.composing({ isComposing: true }), true);
    assert.strictEqual(R.composing({ keyCode: 229 }), true);
    assert.strictEqual(R.composing({ key: 'Enter', keyCode: 13 }), false);
    assert.strictEqual(R.composing(null), false);
  });

  /* -- pins -------------------------------------------------------------- */

  await t("a bookmark to a heading or block isn't a pin of the note, nor counted twice", () => {
    const a = new TFile('A.md');
    const b = new TFile('B.md');
    const byPath = { 'A.md': a, 'B.md': b };
    const bookmarks = [
      { type: 'file', path: 'A.md', subpath: '#Heading' },
      { type: 'file', path: 'B.md', subpath: '#^block' },
      { type: 'group', items: [{ type: 'file', path: 'A.md' }] },
      { type: 'file', path: 'A.md' },
    ];
    const pins = new R.Pins({
      app: {
        internalPlugins: { getPluginById: () => ({ enabled: true, instance: { getBookmarks: () => bookmarks } }) },
        vault: { getFileByPath: (p) => byPath[p] || null },
      },
    });
    assert.deepStrictEqual(pins.files(), [a]);
    assert.strictEqual(pins.has(b), false, 'a block bookmark made B look pinned');
    assert.strictEqual(pins.find('A.md').subpath, undefined, 'unpinning would remove the heading bookmark');
  });

  await t('a pin whose note or folder has gone is listed, found again by its name, re-pinned in its place, or let go', () => {
    const root = new TFolder('/');
    const books = new TFolder('Archive/Books');
    const moved = new TFile('Archive/Books/Moved.md');
    const archive = new TFolder('Archive');
    root.children = [archive];
    archive.children = [books];
    books.children = [moved];
    const all = { '/': root, Archive: archive, 'Archive/Books': books, 'Archive/Books/Moved.md': moved };
    let bookmarks = [
      { type: 'folder', path: 'Books' },
      { type: 'group', items: [{ type: 'file', path: 'Notes/Moved.md', title: 'Kept title' }] },
      { type: 'file', path: 'Gone.md' },
      { type: 'file', path: 'Gone.md', subpath: '#Heading' },
      { type: 'file', path: 'Archive/Books/Moved.md', subpath: '#x' },
    ];
    const followed = [];
    const instance = {
      getBookmarks: () => bookmarks,
      removeItem: (item) => {
        const drop = (items) => items.filter((i) => i !== item).map((i) => (i.type === 'group' ? Object.assign(i, { items: drop(i.items) }) : i));
        bookmarks = drop(bookmarks);
      },
      addItem: (item) => bookmarks.push(item),
    };
    const pins = new R.Pins({
      orders: { followRename: (file, old) => followed.push([file.path, old]), arrangePins: (items) => items },
      app: {
        internalPlugins: { getPluginById: () => ({ enabled: true, instance }) },
        vault: { getRoot: () => root, getAbstractFileByPath: (p) => all[p] || null, getFileByPath: (p) => (all[p] instanceof TFile ? all[p] : null), getFolderByPath: (p) => (all[p] instanceof TFolder ? all[p] : null) },
      },
    });
    const missing = pins.missing();
    assert.deepStrictEqual(missing.map((m) => [m.type, m.path, m.name]), [['folder', 'Books', 'Books'], ['file', 'Notes/Moved.md', 'Moved'], ['file', 'Gone.md', 'Gone']], 'a heading bookmark is not a pin');
    assert.deepStrictEqual(missing.map((m) => pins.likely(m)), [books, moved, null], 'the one of its name, of its kind');
    assert.strictEqual(pins.repoint(missing[1], moved), true);
    assert.deepStrictEqual(bookmarks.filter((b) => b.path === 'Archive/Books/Moved.md' && !b.subpath), [{ type: 'file', path: 'Archive/Books/Moved.md', title: 'Kept title' }]);
    assert.deepStrictEqual(followed, [['Archive/Books/Moved.md', 'Notes/Moved.md']], 'its place among the pins follows it');
    assert.strictEqual(pins.forget(missing[2]), true);
    assert.deepStrictEqual(pins.missing().map((m) => m.path), ['Books']);
    assert.deepStrictEqual(pins.files(), [moved]);
  });

  /* -- lists ------------------------------------------------------------- */

  const press = (text) => {
    const pos = text.indexOf('|');
    const view = {
      state: EditorState.create({ doc: text.replace('|', ''), selection: { anchor: pos } }),
      composing: false,
      dispatch(spec) { this.state = this.state.update(spec).state; },
    };
    R.listEnter(view);
    const out = view.state.doc.toString();
    const head = view.state.selection.main.head;
    return out.slice(0, head) + '|' + out.slice(head);
  };

  await t('renumbering stops at a code block, and leaves what is inside it', () => {
    assert.strictEqual(
      press('a. one|\nb. two\n```\nc. three\n```'),
      'a. one\nb. |\nc. two\n```\nc. three\n```'
    );
    assert.strictEqual(
      press('i. one|\nii. two\n$$\niii. x\n$$'),
      'i. one\nii. |\niii. two\n$$\niii. x\n$$'
    );
  });

  await t('an item whose content is an image or embed is still an item', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>a. <img src="one.png"><br>b. <img src="two.png"><br>c. text</p>';
    R.renderLists(el);
    const list = el.querySelector('ol');
    assert.ok(list, 'not made a list');
    assert.strictEqual(list.querySelectorAll(':scope > li').length, 3);
    assert.strictEqual(list.querySelectorAll('img').length, 2, 'the images went missing');
  });

  /* -- graph search ------------------------------------------------------ */

  await t('an OR outside brackets and quotes is found; inside them it is not', () => {
    assert.strictEqual(R.looseOr('law OR politics'), true);
    assert.strictEqual(R.looseOr('path:a OR [status:done]'), true);
    assert.strictEqual(R.looseOr('(law OR politics)'), false);
    assert.strictEqual(R.looseOr('"law OR politics"'), false);
    assert.strictEqual(R.looseOr('[domain:law OR politics]'), false);
    assert.strictEqual(R.looseOr('ORACLE tag:#x'), false);
    assert.strictEqual(R.looseOr(''), false);
  });

  /* -- menus ------------------------------------------------------------- */

  await t("hidden menu entries leave the menu's list, so the keyboard can't reach them", () => {
    const settings = { onePage: true };
    const filter = new R.MenuFilter({ settings, app: {} });
    const entry = (title) => {
      const dom = document.body.appendChild(document.createElement('div'));
      return { titleEl: { textContent: title }, dom };
    };
    filter.enable();
    const menu = new Menu();
    const items = [entry('Open in new tab'), entry('Rename'), entry('Split right'), entry('Rename property')];
    const same = items.slice();
    menu.items = same;
    menu.showAtPosition({ x: 0, y: 0 });
    assert.deepStrictEqual(shown.pop(), ['Rename']);
    assert.strictEqual(menu.items, same, 'the array was replaced rather than trimmed');
    assert.ok(!items[0].dom.isConnected, 'its element was left drawn');

    settings.onePage = false;
    const other = new Menu();
    other.items = [entry('Open in new tab'), entry('Rename property')];
    other.showAtPosition({ x: 0, y: 0 });
    assert.deepStrictEqual(shown.pop(), ['Open in new tab'], 'one page off keeps the open items');

    filter.disable();
    assert.strictEqual(Menu.prototype.showAtPosition, originalShow, 'not put back');
    const after = new Menu();
    after.items = [entry('Rename property')];
    after.showAtPosition({ x: 0, y: 0 });
    assert.deepStrictEqual(shown.pop(), ['Rename property']);
  });

  await t("a menu shaped unexpectedly is shown untouched", () => {
    const filter = new R.MenuFilter({ settings: { onePage: true }, app: {} });
    filter.enable();
    const odd = new Menu();
    odd.items = [{ title: 'Open in new tab' }, { titleEl: null, title: 'Split right' }];
    odd.showAtPosition({ x: 0, y: 0 });
    assert.deepStrictEqual(shown.pop(), ['Open in new tab', 'Split right']);
    Menu.prototype.showAtPosition.call({ items: 'not an array' });
    assert.strictEqual(shown.pop(), 'not an array');
    filter.disable();
  });

  /* -- header drag ------------------------------------------------------- */

  await t("header drag handlers belong to one running copy, and don't pile up", async () => {
    document.body.innerHTML = '';
    const header = document.body.appendChild(document.createElement('div'));
    const el = header.appendChild(document.createElement('div'));
    el.className = 'dr-trigger';
    const copy = () => {
      const cleanups = [];
      return {
        saves: 0, cleanups,
        settings: { headerOrder: {} },
        async saveData() { this.saves++; },
        register(fn) { cleanups.push(fn); },
        unload() { cleanups.forEach((f) => f()); },
      };
    };
    const drop = () => {
      const evt = new window.Event('drop', { bubbles: true, cancelable: true });
      evt.dataTransfer = { types: ['text/dr-header'], getData: () => 'actions' };
      header.dispatchEvent(evt);
      return settle();
    };
    let started = 0;
    const drag = () => {
      const evt = new window.Event('dragstart', { bubbles: true });
      evt.dataTransfer = { setData: () => { started++; } };
      el.dispatchEvent(evt);
    };

    const first = copy();
    R.makeHeaderDraggable(el, 'actions', first);
    R.makeHeaderDraggable(el, 'actions', first);
    drag();
    assert.strictEqual(started, 1, 'dragstart listeners piled up');
    await drop();
    assert.strictEqual(first.saves, 1);

    // A reload: the new copy takes the header over.
    const second = copy();
    R.makeHeaderDraggable(el, 'actions', second);
    await drop();
    assert.strictEqual(first.saves, 1, 'the unloaded copy still handled drops');
    assert.strictEqual(second.saves, 1);

    first.unload(); // late cleanup of the old copy leaves the new one alone
    await drop();
    assert.strictEqual(second.saves, 2);

    second.unload();
    await drop();
    assert.strictEqual(second.saves, 2, 'drops handled after unload');
  });

  /* -- browse view ------------------------------------------------------- */

  const root = new TFolder('/');
  const plugin = {
    settings: {
      defaultSort: 'name', recentSearches: [], categoryProperty: '', hideEmptyFolders: false,
      albumColumns: '', albumNoteLimit: 8, discNoteLimit: 10, coverProperty: 'cover', tableColumns: '',
    },
    saveData: async () => {}, isFolderNote: () => false, folderHasNotes: () => true,
    recentFiles: () => [], pins: { files: () => [], folders: () => [], has: () => false },
    folderNote: () => null, folderCoverSrc: () => null, feature: () => null,
  };
  const app = {
    workspace: { leftSplit: { expand() {} }, getLeaf: () => ({ openFile() {} }), trigger() {} },
    vault: {
      getRoot: () => root, getMarkdownFiles: () => [], getFolderByPath: () => null,
      getFileByPath: () => null, getAbstractFileByPath: () => null, getName: () => 'Vault',
    },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
  };
  plugin.app = app;
  const makeView = () => {
    const leaf = { history: { backHistory: [], forwardHistory: [] } };
    const view = new R.BrowseView(leaf, plugin);
    view.app = app;
    return view;
  };

  await t('a renamed folder is followed, with its subfolders, the filter and the way down', () => {
    const view = makeView();
    Object.assign(view, { mode: 'folder', path: 'Courts/Appeal', trail: 'Courts/Appeal/Civil', filterFolder: 'Courts' });
    view.followRename(new TFolder('Law/Courts'), 'Courts');
    assert.strictEqual(view.path, 'Law/Courts/Appeal');
    assert.strictEqual(view.trail, 'Law/Courts/Appeal/Civil');
    assert.strictEqual(view.filterFolder, 'Law/Courts');

    Object.assign(view, { path: 'Courtship', trail: null, filterFolder: null });
    view.followRename(new TFolder('Law/Courts'), 'Courts');
    assert.strictEqual(view.path, 'Courtship', 'a folder sharing the start of the name was moved');
    view.followRename(new TFile('Law/x.md'), 'Courtship');
    assert.strictEqual(view.path, 'Courtship', 'a note rename moved the page');
  });

  await t('a move to another screen asks for a history entry; the same screen does not', async () => {
    const view = makeView();
    Object.assign(view, { mode: 'home', path: '/', property: null, value: null });
    const moved = {};
    await view.setState({ mode: 'notes' }, moved);
    assert.strictEqual(moved.history, true);
    const stayed = {};
    await view.setState({ mode: 'notes' }, stayed);
    assert.notStrictEqual(stayed.history, true, 'a restore recorded a step');
  });

  /* -- styles ------------------------------------------------------------ */

  await t("the stylesheet's first-heading and nav-pair rules can match", () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    assert.ok(!/\.dr-shelf-head:first-child/.test(css) && !/\.dr-search-section:first-child/.test(css),
      'a :first-child rule that can never match (the title bar comes first)');
    assert.ok(/\.dr-browse-up:not\(\.dr-sidebar-toggle\) \+ \.dr-browse-up/.test(css));
    assert.ok(/\.dr-browse \.dr-empty\s*\{/.test(css));
    assert.ok(!/var\(--dr-label-width\) \+ var\(--dr-gutter\)\);\s*\n\s*padding: 3px 6px;\s*\n\s*color: var\(--text-faint\)/.test(css),
      '.dr-empty has no fallback outside the panel');
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
