// Albums, against the real main.js: their own order by drag, the edit
// mode (rename, move, delete, add, arrange), the strip's skip buttons,
// arrangements that follow renames and deletions, each note's length,
// and the Home screen.
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
const menus = [];
const pickers = [];
const modals = [];
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = { title: '', disabled: false };
    ['setIcon', 'setChecked', 'setSection', 'setWarning'].forEach((m) => (item[m] = () => item));
    item.setTitle = (v) => { item.title = v; return item; };
    item.setChecked = (v) => { item.checked = v; return item; };
    item.setDisabled = (v) => { item.disabled = v; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
  addSeparator() { return this; }
  showAtPosition() { menus.push(this); }
  showAtMouseEvent() { menus.push(this); }
}
class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement('div');
    this.titleEl = this.modalEl.createDiv();
    this.contentEl = this.modalEl.createDiv();
  }
  open() { modals.push(this); document.body.appendChild(this.modalEl); this.onOpen(); }
  close() { this.modalEl.remove(); if (this.onClose) this.onClose(); }
}
class FuzzySuggestModal { constructor(app) { this.app = app; } setPlaceholder() {} open() { pickers.push(this); } }
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
  constructor(p, t) { super(); this.setPath(p); this.stat = { mtime: t || 0, ctime: t || 0 }; }
  setPath(p) {
    this.path = p; this.name = p.split('/').pop();
    this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
  }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p === '/' ? '' : p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
class MarkdownView {}
const obsidian = new Proxy({
  Menu, Modal, FuzzySuggestModal, Component, ItemView, TFile, TFolder, TAbstractFile, MarkdownView,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class { constructor(m) { notices.push(m); } },
  Platform: { isMobile: false, isPhone: false },
  normalizePath: (p) => p.replace(/\/+/g, '/').replace(/^\//, ''),
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_album_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { BrowseView, ContextStrip, Orders, DEFAULTS, albumNeighbours, albumSequence, arrange, moveBefore, DesignRedux, Lengths, countWords, readingTime, drawFolderArt, noteCoverSrc, CoverDrop, Queue, UpNext, stripDetail, SETTINGS_TABS, AlbumStructure, SmartAlbums };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

/* -- a vault whose files really move ------------------------------------ */

function makeVault() {
  const root = new TFolder('/');
  const byPath = new Map([['/', root]]);
  const parentPath = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/');
  const place = (entry) => {
    const parent = byPath.get(parentPath(entry.path));
    entry.parent = parent;
    parent.children.push(entry);
    byPath.set(entry.path, entry);
  };
  const folder = (p) => { const f = new TFolder(p); place(f); return f; };
  let clock = 1;
  const file = (p) => { const f = new TFile(p, clock++); place(f); return f; };
  const handlers = { rename: [], delete: [], create: [] };
  const fire = (name, ...args) => handlers[name].forEach((h) => h(...args));
  const detach = (entry) => {
    entry.parent.children.splice(entry.parent.children.indexOf(entry), 1);
    byPath.delete(entry.path);
  };
  const vault = {
    getRoot: () => root,
    getName: () => 'Vault',
    getMarkdownFiles: () => Array.from(byPath.values()).filter((e) => e instanceof TFile && e.extension === 'md'),
    getFiles: () => Array.from(byPath.values()).filter((e) => e instanceof TFile),
    getFolderByPath: (p) => { const e = byPath.get(p); return e instanceof TFolder ? e : null; },
    getFileByPath: (p) => { const e = byPath.get(p); return e instanceof TFile ? e : null; },
    getAbstractFileByPath: (p) => byPath.get(p) || null,
    getResourcePath: () => '',
    create: async (p) => { const f = file(p); fire('create', f); return f; },
    createFolder: async (p) => folder(p),
    on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return {}; },
  };
  const fileManager = {
    renameFile: async (entry, target) => {
      const old = entry.path;
      detach(entry);
      const move = (e, from, to) => {
        const p = to + e.path.slice(from.length);
        if (e instanceof TFile) e.setPath(p); else { e.path = p; e.name = p.split('/').pop(); }
        byPath.set(e.path, e);
        (e.children || []).forEach((c) => { byPath.delete(c.path); move(c, from, to); });
      };
      move(entry, old, target);
      const parent = byPath.get(parentPath(target));
      entry.parent = parent;
      parent.children.push(entry);
      fire('rename', entry, old);
    },
    trashFile: async (entry) => { detach(entry); fire('delete', entry); },
    promptForDeletion: async () => confirmDelete,
    processFrontMatter: async () => {},
  };
  let confirmDelete = true;
  return {
    root, folder, file, vault, fileManager, handlers,
    setConfirm: (v) => { confirmDelete = v; },
  };
}

function setup() {
  const v = makeVault();
  const ir = v.folder('IR');
  const theories = v.folder('IR/Theories');
  ['Anarchy', 'Balance', 'Cooperation', 'Deterrence'].forEach((n) => v.file(`IR/${n}.md`));
  ['Realism', 'Liberalism'].forEach((n) => v.file(`IR/Theories/${n}.md`));
  const plugin = {
    settings: JSON.parse(JSON.stringify(R.DEFAULTS)),
    saved: 0,
    saveData: async () => { plugin.saved++; },
    isFolderNote: (f) => f.basename === (f.parent && f.parent.name),
    folderHasNotes: () => true,
    recentFiles: () => [],
    folderNote: () => null,
    folderCoverSrc: () => null,
    feature: () => null,
    refreshBrowse: () => views.forEach((view) => view.render()),
    moveFile: async (file, folderPath) => {
      await v.fileManager.renameFile(file, `${folderPath === '/' ? '' : folderPath + '/'}${file.name}`);
      return true;
    },
    freeChildPath: (folder, base, ext) => {
      let n = 0;
      const make = (i) => `${folder.path === '/' ? '' : folder.path + '/'}${base}${i ? ' ' + i : ''}.${ext}`;
      while (v.vault.getAbstractFileByPath(make(n))) n++;
      return make(n);
    },
    setFolderCover: () => {},
    propertyLabel: (k) => k,
    offerUndo: () => {},
  };
  plugin.pins = { files: () => [], folders: () => [], all: () => [], has: () => false };
  plugin.orders = new R.Orders(plugin);
  const app = {
    vault: v.vault,
    fileManager: v.fileManager,
    workspace: {
      leftSplit: { expand() {} }, getLeaf: () => ({ openFile: (f) => opened.push(f) }), trigger() {},
      getLeavesOfType: () => [],
    },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
  };
  plugin.app = app;
  // What the plugin does on the vault's events.
  v.vault.on('rename', (file, old) => plugin.orders.followRename(file, old));
  v.vault.on('delete', (file) => plugin.orders.followDelete(file));
  const opened = [];
  const views = [];
  const view = new R.BrowseView({ history: { backHistory: [], forwardHistory: [] }, setViewState: async () => {} }, plugin);
  view.app = app;
  views.push(view);
  document.body.innerHTML = '';
  document.body.appendChild(view.containerEl);
  Object.assign(view, { mode: 'folder', path: 'IR', property: null, value: null });
  v.vault.on('rename', (file, old) => { view.followRename(file, old); view.render(); });
  v.vault.on('delete', () => view.render());
  v.vault.on('create', () => view.render());
  view.render();
  return { v, plugin, app, view, ir, theories, opened };
}

const names = (view, folder = 'IR') => Array.from(view.contentEl.querySelectorAll(`.dr-track[data-folder="${folder}"]`))
  .map((r) => (r.querySelector('.dr-edit-name') ? r.querySelector('.dr-edit-name').value : r.querySelector('.dr-track-name').textContent));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const key = (el, k, extra = {}) => el.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const action = (view, label) => Array.from(view.contentEl.querySelectorAll('.dr-detail-action')).find((a) => a.textContent === label);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  await t('an arrangement lists what it names in its order, and anything new after', () => {
    const items = ['a', 'b', 'c', 'd'].map((n) => ({ n }));
    const out = R.arrange(items, (x) => x.n, ['c', 'a', 'gone'], (rest) => rest.slice().reverse());
    assert.deepStrictEqual(out.map((x) => x.n), ['c', 'a', 'd', 'b']);
    assert.deepStrictEqual(R.moveBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
    assert.deepStrictEqual(R.moveBefore(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a']);
  });

  await t('dragging a note onto another in its album puts it there, and the album keeps that order', () => {
    const { view, plugin } = setup();
    assert.deepStrictEqual(names(view), ['Anarchy', 'Balance', 'Cooperation', 'Deterrence']);
    view.arrangeTrack('IR/Deterrence.md', 'IR/Balance.md', false);
    assert.deepStrictEqual(names(view), ['Anarchy', 'Deterrence', 'Balance', 'Cooperation']);
    view.arrangeTrack('IR/Anarchy.md', 'IR/Cooperation.md', true);
    assert.deepStrictEqual(names(view), ['Deterrence', 'Balance', 'Cooperation', 'Anarchy']);
    assert.deepStrictEqual(plugin.settings.albumOrders.IR, { names: ['Deterrence.md', 'Balance.md', 'Cooperation.md', 'Anarchy.md'], on: true });
    const numbers = Array.from(view.contentEl.querySelectorAll('.dr-track[data-folder="IR"] .dr-track-num')).map((n) => n.textContent);
    assert.deepStrictEqual(numbers, ['1', '2', '3', '4'], 'the numbers follow the new order');
  });

  await t('dropping a row on a row of its own disc arranges it; with Find on, it does nothing', () => {
    const { view } = setup();
    const list = view.contentEl.querySelector('.dr-tracks');
    const rowOf = (p) => list.querySelector(`.dr-track[data-path="${p}"]`);
    const drag = (from, to, y) => {
      view.dragging = { path: from, folder: 'IR' };
      const target = rowOf(to);
      target.getBoundingClientRect = () => ({ top: 0, height: 40 });
      const data = { types: ['text/dr-file'], getData: () => from, dropEffect: '' };
      const over = new window.Event('dragover', { bubbles: true, cancelable: true });
      Object.assign(over, { dataTransfer: data, clientY: y });
      target.dispatchEvent(over);
      const marked = target.classList.contains('is-drop-before') || target.classList.contains('is-drop-after');
      const drop = new window.Event('drop', { bubbles: true, cancelable: true });
      Object.assign(drop, { dataTransfer: data, clientY: y });
      target.dispatchEvent(drop);
      return marked;
    };
    assert.ok(drag('IR/Anarchy.md', 'IR/Cooperation.md', 30), 'no line where it would land');
    assert.deepStrictEqual(names(view), ['Balance', 'Cooperation', 'Anarchy', 'Deterrence']);
    view.query = 'a';
    view.render();
    assert.strictEqual(drag('IR/Deterrence.md', 'IR/Balance.md', 5), false, 'arranging a filtered list');
    view.query = '';
    view.render();
    assert.deepStrictEqual(names(view), ['Balance', 'Cooperation', 'Anarchy', 'Deterrence']);
  });

  await t("the album's own order is on its menu, and choosing another keeps it to go back to", () => {
    const { view, plugin, ir } = setup();
    const menuTitles = () => view.filterMenu().items;
    assert.ok(!menuTitles().some((i) => i.title === 'Album order'), 'offered before there is one');
    view.arrangeTrack('IR/Deterrence.md', 'IR/Anarchy.md', false);
    let items = menuTitles();
    assert.strictEqual(items[0].title, 'Album order');
    assert.strictEqual(items[0].checked, true);
    items.find((i) => i.title === 'Alphabetical (A–Z)').click();
    assert.deepStrictEqual(names(view), ['Anarchy', 'Balance', 'Cooperation', 'Deterrence']);
    assert.strictEqual(plugin.orders.albumOn(ir), false);
    items = menuTitles();
    assert.strictEqual(items[0].checked, false);
    items[0].click();
    assert.deepStrictEqual(names(view), ['Deterrence', 'Anarchy', 'Balance', 'Cooperation']);
  });

  await t('arrangements follow a note renamed in place, moved away, deleted, and a folder renamed', async () => {
    const { v, view, plugin, app } = setup();
    view.arrangeTrack('IR/Deterrence.md', 'IR/Anarchy.md', false);
    await app.fileManager.renameFile(app.vault.getFileByPath('IR/Balance.md'), 'IR/Balancing.md');
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Deterrence.md', 'Anarchy.md', 'Balancing.md', 'Cooperation.md']);
    await app.fileManager.renameFile(app.vault.getFileByPath('IR/Anarchy.md'), 'IR/Theories/Anarchy.md');
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Deterrence.md', 'Balancing.md', 'Cooperation.md']);
    await app.fileManager.trashFile(app.vault.getFileByPath('IR/Cooperation.md'));
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Deterrence.md', 'Balancing.md']);
    await app.fileManager.renameFile(app.vault.getFolderByPath('IR'), 'International');
    assert.ok(plugin.settings.albumOrders.International && !plugin.settings.albumOrders.IR);
    assert.strictEqual(view.path, 'International', 'the page followed its folder');
    void v;
  });

  await t('Edit turns names into fields; a note is renamed where it stands, links and all', async () => {
    const { view, app } = setup();
    click(action(view, 'Edit'));
    assert.ok(view.editing);
    const title = view.contentEl.querySelector('.dr-detail-title.dr-edit-name');
    assert.strictEqual(title.value, 'IR');
    const field = view.contentEl.querySelector('.dr-edit-name[data-edit-path="IR/Balance.md"]');
    field.value = 'Balance of power';
    key(field, 'Enter');
    await settle();
    assert.ok(app.vault.getFileByPath('IR/Balance of power.md'), 'not renamed');
    assert.ok(names(view).includes('Balance of power'));
    assert.ok(view.editing, 'editing ended on a rename');
  });

  await t("a name that's taken, or can't be a file name, is refused with the reason", async () => {
    const { view, app } = setup();
    view.setEditing(true);
    notices.length = 0;
    const field = () => view.contentEl.querySelector('.dr-edit-name[data-edit-path="IR/Balance.md"]');
    field().value = 'Anarchy';
    key(field(), 'Enter');
    await settle();
    assert.match(notices.pop(), /already something called “Anarchy”/);
    field().value = 'A/B';
    key(field(), 'Enter');
    await settle();
    assert.match(notices.pop(), /can’t contain/);
    assert.ok(app.vault.getFileByPath('IR/Balance.md'));
    // Escape puts it back without renaming.
    field().value = 'Something else';
    key(field(), 'Escape');
    await settle();
    assert.strictEqual(field().value, 'Balance');
    assert.ok(app.vault.getFileByPath('IR/Balance.md'));
  });

  await t('the album itself, and a subfolder, are renamed from their headings', async () => {
    const { view, app } = setup();
    view.setEditing(true);
    const disc = view.contentEl.querySelector('.dr-disc.is-editing .dr-edit-name');
    assert.strictEqual(disc.value, 'Theories');
    disc.value = 'Schools';
    key(disc, 'Enter');
    await settle();
    assert.ok(app.vault.getFolderByPath('IR/Schools'));
    const title = view.contentEl.querySelector('.dr-detail-title.dr-edit-name');
    title.value = 'International Relations';
    title.dispatchEvent(new window.FocusEvent('blur'));
    await settle();
    assert.ok(app.vault.getFolderByPath('International Relations'));
    assert.strictEqual(view.path, 'International Relations');
  });

  await t("delete asks as Obsidian does, and nothing's lost when it's declined", async () => {
    const { v, view, app } = setup();
    view.setEditing(true);
    const del = () => view.contentEl.querySelector('.dr-track[data-path="IR/Anarchy.md"] .dr-edit-tool[aria-label="Delete"]');
    v.setConfirm(false);
    click(del());
    await settle();
    assert.ok(app.vault.getFileByPath('IR/Anarchy.md'), 'deleted without being confirmed');
    v.setConfirm(true);
    click(del());
    await settle();
    assert.strictEqual(app.vault.getFileByPath('IR/Anarchy.md'), null);
    assert.deepStrictEqual(names(view), ['Balance', 'Cooperation', 'Deterrence']);
  });

  await t('move sends a note to another folder, chosen from a list', async () => {
    const { view, app, theories } = setup();
    view.setEditing(true);
    click(view.contentEl.querySelector('.dr-track[data-path="IR/Balance.md"] .dr-edit-tool[aria-label="Move to another folder"]'));
    pickers.pop().onChooseItem(theories);
    await settle();
    assert.ok(app.vault.getFileByPath('IR/Theories/Balance.md'));
    assert.ok(names(view, 'IR/Theories').includes('Balance'));
  });

  await t('New note joins the album with its name ready to type, not opened', async () => {
    const { view, app, opened } = setup();
    view.setEditing(true);
    click(action(view, 'New note'));
    await settle();
    const file = app.vault.getFileByPath('IR/Untitled.md');
    assert.ok(file);
    assert.strictEqual(opened.length, 0, 'it was opened');
    const field = view.contentEl.querySelector('.dr-edit-name[data-edit-path="IR/Untitled.md"]');
    assert.strictEqual(document.activeElement, field, 'its name is not ready to type');
  });

  await t('editing shows empty subfolders, so they can be named or filled; Done leaves', () => {
    const { v, view } = setup();
    v.folder('IR/Empty');
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-disc[data-folder="IR/Empty"]'), 'shown outside editing');
    view.setEditing(true);
    assert.ok(view.contentEl.querySelector('.dr-disc[data-folder="IR/Empty"]'));
    click(action(view, 'Done'));
    assert.strictEqual(view.editing, false);
    assert.ok(action(view, 'Edit'));
  });

  await t('a row dragged by its handle, or moved with Alt+arrows, saves the new order', () => {
    const { view, plugin } = setup();
    view.setEditing(true);
    const rows = () => Array.from(view.contentEl.querySelectorAll('.dr-track[data-folder="IR"]'));
    rows().forEach((r) => {
      r.getBoundingClientRect = () => {
        const i = rows().indexOf(r);
        return { top: i * 40, bottom: i * 40 + 40, height: 40 };
      };
    });
    const grip = view.contentEl.querySelector('.dr-track[data-path="IR/Anarchy.md"] .dr-edit-grip');
    const ptr = (target, type, y) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
    ptr(grip, 'pointerdown', 20);
    ptr(window, 'pointermove', 30);
    ptr(window, 'pointermove', 130);
    ptr(window, 'pointerup', 130);
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Balance.md', 'Cooperation.md', 'Anarchy.md', 'Deterrence.md']);
    const g2 = view.contentEl.querySelector('.dr-track[data-path="IR/Deterrence.md"] .dr-edit-grip');
    key(g2, 'ArrowUp', { altKey: true });
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Balance.md', 'Cooperation.md', 'Deterrence.md', 'Anarchy.md']);
    assert.strictEqual(document.activeElement.closest('.dr-track').dataset.path, 'IR/Deterrence.md', 'focus lost');
  });

  await t('Alt+arrows over the edge of a disc move the note into the next folder, at the top', async () => {
    const { view, app, plugin } = setup();
    view.setEditing(true);
    const grip = view.contentEl.querySelector('.dr-track[data-path="IR/Deterrence.md"] .dr-edit-grip');
    key(grip, 'ArrowDown', { altKey: true });
    await settle();
    assert.ok(app.vault.getFileByPath('IR/Theories/Deterrence.md'), 'not moved');
    assert.strictEqual(plugin.settings.albumOrders['IR/Theories'].names[0], 'Deterrence.md');
  });

  await t('a move says so with an Undo, which puts it back, album order and all', async () => {
    const { plugin, app } = setup();
    ['moveFile', 'offerUndo', 'putBack'].forEach((m) => (plugin[m] = R.DesignRedux.prototype[m].bind(plugin)));
    plugin.orders.setAlbum(app.vault.getFolderByPath('IR'), ['Deterrence.md', 'Balance.md', 'Anarchy.md', 'Cooperation.md']);
    const before = JSON.parse(JSON.stringify(plugin.settings.albumOrders.IR));
    const file = app.vault.getFileByPath('IR/Balance.md');
    notices.length = 0;
    assert.strictEqual(await plugin.moveFile(file, 'IR/Theories', { announce: true }), 'IR/Balance.md');
    assert.strictEqual(file.path, 'IR/Theories/Balance.md');
    const note = notices.pop();
    assert.ok(note.textContent.startsWith('Moved “Balance” to Theories.'), note.textContent);
    note.querySelector('.dr-undo').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    assert.strictEqual(file.path, 'IR/Balance.md', 'not put back');
    assert.deepStrictEqual(plugin.settings.albumOrders.IR, before, 'its place in the album was lost');
  });

  await t('a rename made in Edit mode can be undone too', async () => {
    const { plugin, app, view } = setup();
    ['offerUndo', 'putBack'].forEach((m) => (plugin[m] = R.DesignRedux.prototype[m].bind(plugin)));
    const file = app.vault.getFileByPath('IR/Anarchy.md');
    notices.length = 0;
    assert.strictEqual(await view.renameEntry(file, 'Anarchy and order'), true);
    assert.strictEqual(file.path, 'IR/Anarchy and order.md');
    notices.pop().querySelector('.dr-undo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    assert.strictEqual(file.path, 'IR/Anarchy.md');
  });

  await t('a folder renamed takes its folder note, and so its cover, with it', async () => {
    const v = makeVault();
    const folder = v.folder('Parliament');
    const note = v.file('Parliament/Parliament.md');
    v.file('Parliament/Commons.md');
    const plugin = {
      settings: JSON.parse(JSON.stringify(R.DEFAULTS)),
      app: { vault: v.vault, fileManager: v.fileManager },
      unloading: false,
    };
    plugin.folderNote = R.DesignRedux.prototype.folderNote.bind(plugin);
    plugin.followFolderNote = R.DesignRedux.prototype.followFolderNote.bind(plugin);
    plugin.renameFolderNote = R.DesignRedux.prototype.renameFolderNote.bind(plugin);
    v.vault.on('rename', (file, oldPath) => plugin.followFolderNote(file, oldPath));

    await v.fileManager.renameFile(folder, 'Parliamentarism');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(note.path, 'Parliamentarism/Parliamentarism.md');
    assert.strictEqual(plugin.folderNote(folder), note);

    // Moved, not renamed: its note stays as it is.
    v.folder('Politics');
    await v.fileManager.renameFile(folder, 'Politics/Parliamentarism');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(note.path, 'Politics/Parliamentarism/Parliamentarism.md');

    // A name already taken inside is left alone.
    const other = v.file('Politics/Parliamentarism/Westminster.md');
    await v.fileManager.renameFile(folder, 'Politics/Westminster');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(note.path, 'Politics/Westminster/Parliamentarism.md');
    assert.strictEqual(other.path, 'Politics/Westminster/Westminster.md');
  });

  await t('Escape mid-drag puts the row back, and saves nothing', () => {
    const { view, plugin } = setup();
    view.setEditing(true);
    const grip = view.contentEl.querySelector('.dr-track[data-path="IR/Anarchy.md"] .dr-edit-grip');
    const rows = () => Array.from(view.contentEl.querySelectorAll('.dr-track[data-folder="IR"]'));
    rows().forEach((r) => { r.getBoundingClientRect = () => { const i = rows().indexOf(r); return { top: i * 40, bottom: i * 40 + 40, height: 40 }; }; });
    const ptr = (target, type, y) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
    ptr(grip, 'pointerdown', 20);
    ptr(window, 'pointermove', 140);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.deepStrictEqual(names(view), ['Anarchy', 'Balance', 'Cooperation', 'Deterrence']);
    assert.ok(!plugin.settings.albumOrders.IR);
  });

  await t('a redraw waits while a name is being typed', async () => {
    const { view } = setup();
    view.setEditing(true);
    const field = view.contentEl.querySelector('.dr-edit-name[data-edit-path="IR/Balance.md"]');
    field.focus();
    field.value = 'Bal';
    view.queueRender();
    await settle(80);
    assert.strictEqual(document.activeElement, field, 'the field was drawn over mid-word');
    assert.strictEqual(view.renderAfterEdit, true);
  });

  /* -- the strip ---------------------------------------------------------- */

  await t('skip goes to the note before and after, in the album order', () => {
    const { view, plugin, app } = setup();
    const anarchy = app.vault.getFileByPath('IR/Anarchy.md');
    let near = R.albumNeighbours(plugin, anarchy);
    assert.strictEqual(near.previous, null);
    assert.strictEqual(near.next.basename, 'Balance');
    view.arrangeTrack('IR/Anarchy.md', 'IR/Deterrence.md', true);
    near = R.albumNeighbours(plugin, anarchy);
    assert.strictEqual(near.previous.basename, 'Deterrence');
    assert.strictEqual(near.next, null);
    plugin.settings.defaultSort = 'name-desc';
    plugin.orders.setAlbumOn(app.vault.getFolderByPath('IR'), false);
    assert.deepStrictEqual(R.albumSequence(plugin, anarchy).map((f) => f.basename), ['Deterrence', 'Cooperation', 'Balance', 'Anarchy']);
  });

  await t("the strip's skip buttons name where they go and open it in the page", () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    const leaf = { isDeferred: false, view: Object.assign(new MarkdownView(), { file, getMode: () => 'source' }), openFile(f) { this.view.file = f; } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.workspace.on = () => ({});
    app.metadataCache.on = () => ({});
    app.commands = { executeCommandById() {} };
    plugin.pins.has = () => false;
    const strip = new R.ContextStrip(plugin);
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    strip.update();
    const prev = strip.el.querySelector('[data-action="previous"]');
    const next = strip.el.querySelector('[data-action="next"]');
    assert.strictEqual(prev.getAttribute('aria-label'), 'Previous: Anarchy');
    assert.strictEqual(next.getAttribute('aria-label'), 'Next: Cooperation');
    click(next);
    assert.strictEqual(leaf.view.file.basename, 'Cooperation');
    const cmds = Object.fromEntries(strip.commands().map((c) => [c.id, c]));
    assert.strictEqual(cmds['next-in-album'].check(), true);
    cmds['next-in-album'].run();
    assert.strictEqual(leaf.view.file.basename, 'Deterrence');
    assert.strictEqual(cmds['next-in-album'].check(), false, 'offered past the last note');
  });

  await t('a note without a cover shows the first image in it, where the setting has it', () => {
    const note = new TFile('Notes/Trip.md');
    const image = new TFile('Pictures/view.png');
    const app = {
      metadataCache: {
        getFileCache: () => ({ embeds: [{ link: 'notes.pdf' }, { link: 'view.png' }] }),
        getFirstLinkpathDest: (link) => (link === 'view.png' ? image : link === 'notes.pdf' ? new TFile('notes.pdf') : null),
      },
      vault: { getResourcePath: (f) => `app://${f.path}` },
    };
    const plugin = { app, settings: { coverProperty: 'cover', coverFromFirstImage: R.DEFAULTS.coverFromFirstImage } };
    assert.strictEqual(R.noteCoverSrc(plugin, note), null, 'off to start');
    plugin.settings.coverFromFirstImage = true;
    assert.strictEqual(R.noteCoverSrc(plugin, note), 'app://Pictures/view.png', 'past what isn\'t an image');
    // A cover of its own still comes first.
    app.metadataCache.getFileCache = () => ({ frontmatter: { cover: '[[own.png]]' }, embeds: [{ link: 'view.png' }] });
    app.metadataCache.getFirstLinkpathDest = (link) => (link === 'own.png' ? new TFile('own.png') : image);
    assert.strictEqual(R.noteCoverSrc(plugin, note), 'app://own.png');
  });

  await t("an image dropped on an album's cover becomes its folder note's cover; one from outside is saved first", async () => {
    const image = new TFile('Pictures/view.png');
    const note = new TFile('Law/Law.md');
    const set = [];
    const saved = [];
    const plugin = {
      settings: { coverDrop: true },
      app: {
        dragManager: { draggable: { type: 'file', file: image } },
        vault: {
          getFolderByPath: (p) => (p === 'Law' ? new TFolder('Law') : null),
          createBinary: async (p) => { saved.push(p); return new TFile(p); },
        },
        fileManager: { getAvailablePathForAttachment: async (name, from) => `Attachments/${name}` },
      },
      ensureFolderNote: async () => note,
      feature: () => ({ setCover: async (file, value) => set.push([file.path, value]), linkTo: (img) => `[[${img.name}]]` }),
    };
    const drop = new R.CoverDrop(plugin);
    const art = document.body.createDiv();
    art.dataset.coverFolder = 'Law';
    const event = (files) => ({ target: art, dataTransfer: { files, types: ['Files'] }, preventDefault() { this.prevented = true; }, stopPropagation() {} });
    const fromVault = event([]);
    await drop.onDrop(fromVault);
    assert.ok(fromVault.prevented);
    assert.deepStrictEqual(set, [['Law/Law.md', '[[view.png]]']]);
    // From outside the vault: saved as an attachment, then linked.
    plugin.app.dragManager = { draggable: null };
    const blob = { name: 'photo.jpg', type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(4) };
    await drop.onDrop(event([blob]));
    assert.deepStrictEqual(saved, ['Attachments/photo.jpg']);
    assert.deepStrictEqual(set[1], ['Law/Law.md', '[[photo.jpg]]']);
    // Not an image, or switched off: left alone.
    const text = event([{ name: 'notes.txt', type: 'text/plain' }]);
    await drop.onDrop(text);
    assert.ok(!text.prevented);
    plugin.settings.coverDrop = false;
    const off = event([blob]);
    await drop.onDrop(off);
    assert.ok(!off.prevented);
    assert.strictEqual(set.length, 2);
    art.remove();
  });

  await t('the strip says where the note falls in its album, as "2 of 4", unless switched off', () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    const leaf = { isDeferred: false, view: Object.assign(new MarkdownView(), { file, getMode: () => 'source' }), openFile(f) { this.view.file = f; } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.workspace.on = () => ({});
    app.metadataCache.on = () => ({});
    app.commands = { executeCommandById() {} };
    plugin.pins.has = () => false;
    const strip = new R.ContextStrip(plugin);
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    strip.update();
    const place = () => {
      const el = strip.el.querySelector('.dr-strip-place');
      return el ? el.textContent : null;
    };
    assert.strictEqual(R.DEFAULTS.stripPlace, true);
    assert.strictEqual(place(), '2 of 4');
    plugin.settings.stripPlace = false;
    strip.el.empty();
    strip.update();
    assert.strictEqual(place(), null);
    strip.el.remove();
  });

  await t("what the strip shows beside that is the setting's: properties, folder and the like, or its own pick", () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    app.metadataCache.getFileCache = () => ({ frontmatter: { status: 'medium touched', domain: '[[Politics]]', tags: ['ir', 'theory'] } });
    const said = (spec) => R.stripDetail(app, file, spec);
    // Empty: one property worth showing, as before.
    assert.strictEqual(said(''), 'Politics');
    assert.strictEqual(said('tags, status'), 'ir, theory · medium touched');
    assert.strictEqual(said('author, folder'), 'IR', 'what the note lacks is left out');
    assert.strictEqual(said('none'), '');
    assert.strictEqual(R.DEFAULTS.stripDetail, '');
    assert.ok(JSON.stringify(R.SETTINGS_TABS).includes('"stripDetail"'), 'a row in settings');
  });

  await t("the strip's line shows how far down the note you are, and goes when it's switched off", () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    const containerEl = document.body.createDiv();
    const scroller = containerEl.createDiv({ cls: 'markdown-preview-view' });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 1400, configurable: true });
    const view = Object.assign(new MarkdownView(), { file, containerEl, getMode: () => 'preview' });
    const leaf = { isDeferred: false, view, openFile() {} };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.workspace.on = () => ({});
    app.metadataCache.on = () => ({});
    app.commands = { executeCommandById() {} };
    plugin.pins.has = () => false;
    const strip = new R.ContextStrip(plugin);
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    assert.strictEqual(R.DEFAULTS.stripProgress, true);
    strip.update();
    assert.ok(strip.el.querySelector('.dr-strip-progress'));
    scroller.scrollTop = 250;
    strip.measureScroll();
    assert.strictEqual(strip.el.style.getPropertyValue('--dr-progress'), '0.2500');
    assert.ok(strip.el.classList.contains('has-progress'));
    // A short note has nowhere to go: no line.
    Object.defineProperty(scroller, 'scrollHeight', { value: 404, configurable: true });
    strip.measureScroll();
    assert.ok(!strip.el.classList.contains('has-progress'));
    plugin.settings.stripProgress = false;
    strip.update();
    assert.ok(!strip.el.querySelector('.dr-strip-progress'));
    assert.strictEqual(strip.scrollHost, null, 'no longer listening');
    strip.disable();
    containerEl.remove();
  });

  await t("Up Next: notes lined up from their menus come before the album's next, follow renames, and Shuffle lines up the rest", async () => {
    const { plugin, app, view, v } = setup();
    plugin.queue = new R.Queue(plugin);
    const upNext = new R.UpNext(plugin);
    const strip = new R.ContextStrip(plugin);
    plugin.feature = (C) => (C === R.UpNext ? upNext : C === R.ContextStrip ? strip : null);
    v.vault.on('rename', (file, old) => plugin.queue.followRename(file, old));
    v.vault.on('delete', (file) => plugin.queue.followDelete(file));
    const file = app.vault.getFileByPath('IR/Balance.md');
    const leaf = { isDeferred: false, view: Object.assign(new MarkdownView(), { file, getMode: () => 'source' }), openFile(f) { this.view.file = f; } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.commands = { executeCommandById() {} };
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    assert.strictEqual(R.DEFAULTS.upNext, true);

    // A note's menu: Read next, then Remove once it's in.
    const titles = (target) => {
      const menu = new Menu();
      upNext.addMenuItems(menu, target, (item) => item);
      return menu.items.map((i) => i.title);
    };
    const deterrence = app.vault.getFileByPath('IR/Deterrence.md');
    assert.deepStrictEqual(titles(deterrence), ['Read next', 'Add to Up Next']);
    upNext.enqueue([deterrence], true);
    assert.deepStrictEqual(titles(deterrence), ['Read next', 'Remove from Up Next']);
    assert.deepStrictEqual(titles(app.vault.getFolderByPath('IR')), ['Add to Up Next', 'Shuffle']);

    // » goes to it before Cooperation, and reading it takes it off.
    strip.update();
    const next = strip.el.querySelector('[data-action="next"]');
    assert.strictEqual(next.getAttribute('aria-label'), 'Up Next: Deterrence');
    assert.strictEqual(strip.el.querySelector('[data-action="up-next"]').getAttribute('aria-label'), 'Up Next (1)');
    strip.skip('next');
    assert.strictEqual(leaf.view.file.basename, 'Deterrence');
    assert.deepStrictEqual(plugin.settings.queue, []);
    assert.ok(!strip.el.querySelector('[data-action="up-next"]'), 'nothing lined up, no button');

    // A folder's notes go in album order, and follow a rename and a delete.
    upNext.enqueue([app.vault.getFolderByPath('IR/Theories')].flatMap((f) => upNext.notesOf(f)), false, 'Theories');
    assert.deepStrictEqual(plugin.settings.queue, ['IR/Theories/Liberalism.md', 'IR/Theories/Realism.md']);
    await app.fileManager.renameFile(app.vault.getFolderByPath('IR/Theories'), 'IR/Schools');
    assert.deepStrictEqual(plugin.settings.queue, ['IR/Schools/Liberalism.md', 'IR/Schools/Realism.md']);
    await app.fileManager.trashFile(app.vault.getFileByPath('IR/Schools/Realism.md'));
    assert.deepStrictEqual(plugin.settings.queue, ['IR/Schools/Liberalism.md']);

    // Shuffle on the album page: one opened, the rest lined up in place of what was there.
    leaf.view.file = file;
    view.render();
    const shuffle = Array.from(view.contentEl.querySelectorAll('.dr-detail-action')).find((b) => b.textContent === 'Shuffle');
    assert.ok(shuffle, 'Random became Shuffle');
    click(shuffle);
    const opened = leaf.view.file;
    // The album as the page shows it, its disc included.
    assert.ok(plugin.settings.queue.indexOf(opened.path) === -1);
    assert.deepStrictEqual(plugin.settings.queue.concat(opened.path).sort(), ['IR/Anarchy.md', 'IR/Balance.md', 'IR/Cooperation.md', 'IR/Deterrence.md', 'IR/Schools/Liberalism.md']);

    // Off: no button, » is the album's again, and the page says Random.
    plugin.settings.upNext = false;
    leaf.view.file = file;
    strip.update();
    assert.ok(!strip.el.querySelector('[data-action="up-next"]'));
    assert.strictEqual(strip.el.querySelector('[data-action="next"]').getAttribute('aria-label'), 'Next: Cooperation');
    view.render();
    assert.ok(Array.from(view.contentEl.querySelectorAll('.dr-detail-action')).some((b) => b.textContent === 'Random'));
    strip.el.remove();
  });

  /* -- lengths, Home ------------------------------------------------------- */

  const f = (app, p) => app.vault.getFileByPath(p);
  await t("rows end with each note's length once counted, and the header gives the total", async () => {
    assert.strictEqual(R.countWords('---\ntitle: x\n---\n# Heading\n\n- one two\n'), 3);
    assert.strictEqual(R.readingTime(230 * 65), '1 hr 5 min');
    const { view, plugin, app } = setup();
    plugin.lengths = new R.Lengths(plugin);
    const words = { Anarchy: 460, Balance: 1150, Cooperation: 30 };
    app.vault.cachedRead = async (file) => 'word '.repeat(words[file.basename] || 0);
    view.render();
    await settle(120);
    const lengths = Array.from(view.contentEl.querySelectorAll('.dr-track[data-folder="IR"] .dr-track-length')).map((e) => e.textContent);
    assert.deepStrictEqual(lengths, ['2 min', '5 min', '<1 min', '']);
    assert.ok(view.contentEl.querySelector('.dr-detail-meta').textContent.includes('7 min read'));
  });

  await t('the note last opened keeps its number and colour in the list, with no mark', () => {
    const { view, plugin, app } = setup();
    plugin.recentFiles = () => [f(app, 'IR/Cooperation.md')];
    view.render();
    const row = view.contentEl.querySelector('.dr-track[data-path="IR/Cooperation.md"]');
    assert.strictEqual(row.querySelector('.dr-track-num').textContent, '3');
    assert.strictEqual(row.querySelector('.dr-track-num').children.length, 0, 'a mark was drawn over its number');
    assert.ok(!row.classList.contains('is-current'));
  });

  await t("without a cover: a cover drawn for it by default, the folder's cover when asked, or the icon on a soft colour", () => {
    const { view, plugin, app } = setup();
    plugin.folderCoverSrc = (folder) => (folder.path === 'IR' ? 'ir.png' : null);
    plugin.recentFiles = () => [f(app, 'IR/Anarchy.md'), f(app, 'IR/Theories/Realism.md')];
    Object.assign(view, { mode: 'recents' });
    const tiles = () => Array.from(view.contentEl.querySelectorAll('.dr-card-art')).map((el) => {
      const img = el.querySelector('img');
      if (img) return img.getAttribute('src');
      if (el.classList.contains('is-drawn')) return 'drawn';
      return el.classList.contains('is-hued') ? 'soft' : el.classList.contains('is-blank') ? 'icon' : '?';
    });
    view.render();
    assert.deepStrictEqual(tiles(), ['drawn', 'drawn'], 'the default is a cover drawn for each');
    plugin.settings.coverFromFolder = true;
    view.render();
    assert.deepStrictEqual(tiles(), ['ir.png', 'drawn'], "only the note's own folder counts, not one above it");
    plugin.settings.coverFromFolder = false;
    plugin.settings.coverFallback = 'soft';
    view.render();
    assert.deepStrictEqual(tiles(), ['soft', 'soft']);
    const hues = Array.from(view.contentEl.querySelectorAll('.dr-card-art')).map((el) => el.style.getPropertyValue('--dr-gen-h'));
    assert.notStrictEqual(hues[0], hues[1], 'each note should take its own colour');
    const folder = document.createElement('div');
    R.drawFolderArt(plugin, folder, app.vault.getFolderByPath('IR/Theories'));
    assert.ok(folder.classList.contains('is-hued'), 'a folder without a cover took no soft colour');
  });

  await t('Home leads with large cards, then shelves that scroll sideways', async () => {
    const { view, plugin, app, opened } = setup();
    plugin.recentFiles = () => [f(app, 'IR/Balance.md')];
    await view.setState({ mode: 'home' }, {});
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((e) => e.textContent);
    assert.deepStrictEqual(text('.dr-pick-caption'), ['Last opened', 'Rediscover']);
    assert.deepStrictEqual(text('.dr-shelf-title'), ['Recently opened', 'Recently added', 'Rediscover', 'Folders']);
    click(view.contentEl.querySelector('.dr-pick[data-path="IR/Balance.md"]'));
    assert.strictEqual(opened[0].basename, 'Balance');
  });

  await t('an album says what it is: its kind and the way down above its title, what it’s for, notes from elsewhere, albums in it and beside it', async () => {
    const { v, plugin, app, view } = setup();
    const note = v.file('IR/IR.md');
    v.folder('Elsewhere');
    const sov = v.file('Elsewhere/Sovereignty.md');
    v.folder('Law');
    const law = v.file('Law/Law.md');
    v.folder('Treaties');
    v.file('Treaties/Treaties.md');
    const fms = new Map([[note, { album: 'Project', description: 'How states deal with each other.', includes: ['[[Sovereignty]]', '[[Law]]', '[[Missing]]'], related: '[[Treaties]]' }], [v.vault.getFileByPath('IR/Anarchy.md'), { status: 'Done' }]]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((f) => f.basename === link) || null;
    app.metadataCache.fileToLinktext = (f) => f.basename;
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    plugin.ensureFolderNote = async (folder) => plugin.folderNote(folder);
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    view.render();
    assert.deepStrictEqual(text('.dr-detail-kind'), ['Project']);
    assert.deepStrictEqual(text('.dr-detail-desc'), ['How states deal with each other.']);
    assert.ok(text('.dr-detail-meta')[0].includes('1 of 7 done'), text('.dr-detail-meta')[0]);
    assert.ok(text('.dr-disc-title').includes('From elsewhere'));
    assert.ok(view.contentEl.querySelector('.dr-track[data-path="Elsewhere/Sovereignty.md"]'), 'shown in the album, not moved');
    assert.strictEqual(sov.parent.path, 'Elsewhere');
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-album-includes .dr-card')).map((c) => c.dataset.path), ['Law'], 'an album it takes in, as a tile');
    assert.ok(text('.dr-shelf-title').includes('Related albums'));
    assert.ok(view.contentEl.querySelector('.dr-shelf-row .dr-card[data-path="Treaties"]'));
    assert.ok(!action(view, 'Map'));
    // A concept map opens its map.
    fms.get(note).album = 'concept map';
    view.render();
    assert.deepStrictEqual(text('.dr-detail-kind'), ['Concept map']);
    assert.ok(action(view, 'Map'));
    // Further down: the way back up, and no lone parent link under the title.
    Object.assign(view, { path: 'IR/Theories' });
    view.render();
    assert.deepStrictEqual(text('.dr-crumb'), ['IR']);
    assert.ok(!view.contentEl.querySelector('.dr-detail-sub.is-link'));
    // On its tile, its kind.
    Object.assign(view, { path: '/' });
    view.render();
    assert.deepStrictEqual(text('.dr-card[data-path="IR"] .dr-card-kind'), ['Concept map']);
    // A note shown in another album too: listed in its includes, left where it is.
    let written = null;
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = Object.assign({}, fms.get(file)); fn(fm); written = [file, fm]; };
    fms.set(law, {});
    assert.strictEqual(await structure.include(v.vault.getFolderByPath('Law'), sov), true);
    assert.deepStrictEqual([written[0], written[1].includes], [law, ['[[Sovereignty]]']]);
    assert.strictEqual(await structure.include(v.vault.getFolderByPath('IR'), sov), false, 'there already');
    // Kind set and taken away from the menu's way in.
    await structure.setType(v.vault.getFolderByPath('IR'), 'reading list');
    assert.strictEqual(written[1].album, 'reading list');
    await structure.setType(v.vault.getFolderByPath('IR'), '');
    assert.ok(!('album' in written[1]));
    // Switched off: nothing of it shows.
    plugin.settings.albumStructure = false;
    Object.assign(view, { path: 'IR' });
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-detail-kind, .dr-detail-desc, .dr-album-includes'));
    assert.ok(!text('.dr-disc-title').includes('From elsewhere'));
  });

  await t('a smart album keeps filters, order and grouping; changed chips can be saved back; the library lists it', async () => {
    const { v, plugin, app, view } = setup();
    const f = (p) => v.vault.getFileByPath(p);
    const fms = new Map([[f('IR/Anarchy.md'), { domain: 'Security', status: 'Done' }], [f('IR/Balance.md'), { domain: 'Security' }], [f('IR/Theories/Realism.md'), { domain: 'Theory' }]]);
    app.metadataCache.getFileCache = (file) => (fms.has(file) ? { frontmatter: fms.get(file) } : null);
    const smart = new R.SmartAlbums(plugin);
    plugin.feature = (C) => (C === R.SmartAlbums ? smart : null);
    plugin.settings.librarySections = [{ title: '', items: [{ kind: 'builtin', id: 'home' }] }];
    const defaultSort = plugin.settings.defaultSort;
    view.filterFolder = 'IR';
    view.filterProp = { key: 'domain', value: null };
    const album = smart.save(view, ' Domains ');
    assert.deepStrictEqual([album.name, album.folder, album.prop], ['Domains', 'IR', { key: 'domain', value: null }]);
    assert.ok(plugin.settings.librarySections[0].items.some((i) => i.id === 'smart'), 'listed in the library');
    const open = () => {
      Object.assign(view, { mode: 'smart', property: album.id, smartLoaded: null });
      view.clearFilters();
      view.render();
    };
    const tracks = () => Array.from(view.contentEl.querySelectorAll('.dr-track[data-path]')).map((r) => r.dataset.path.split('/').pop());
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    open();
    assert.deepStrictEqual(text('.dr-detail-title'), ['Domains']);
    assert.deepStrictEqual(tracks(), ['Anarchy.md', 'Balance.md', 'Realism.md']);
    assert.ok(!action(view, 'Save changes'));
    // Grouped by a property: a disc per value — the same notes seen another way.
    smart.change(album, { group: 'domain' });
    view.render();
    assert.deepStrictEqual(text('.dr-disc-title'), ['Security', 'Theory']);
    // Its own order, kept with it.
    view.setSort('name-desc');
    assert.strictEqual(album.sort, 'name-desc');
    assert.strictEqual(plugin.settings.defaultSort, defaultSort, 'the shared order is left alone');
    view.render();
    assert.deepStrictEqual(tracks(), ['Balance.md', 'Anarchy.md', 'Realism.md']);
    // The chips changed, and saved back.
    view.filterProp = { key: 'status', value: 'Done' };
    view.render();
    assert.deepStrictEqual(tracks(), ['Anarchy.md']);
    click(action(view, 'Save changes'));
    assert.deepStrictEqual(album.prop, { key: 'status', value: 'Done' });
    open();
    assert.deepStrictEqual(tracks(), ['Anarchy.md'], 'opened again, as saved');
    // In the library, a row each.
    const rows = [];
    smart.renderRows({ row: (list, spec) => rows.push(spec), browseMode() {} }, null);
    assert.deepStrictEqual(rows.map((r) => [r.label, r.screen, r.property]), [['Domains', 'smart', album.id]]);
    // Gone, or switched off: said so, nothing else.
    smart.remove(album);
    open();
    assert.ok(text('.dr-empty')[0].includes('any more'));
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
