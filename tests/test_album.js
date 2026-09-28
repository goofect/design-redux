// Albums, against the real main.js: their own order by drag, the edit
// mode (rename, move, delete, add, arrange), the strip's skip buttons,
// arrangements that follow renames and deletions, each note's length,
// Up Next, and the Home screen.
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
  '\nmodule.exports.__test = { BrowseView, ContextStrip, Orders, DEFAULTS, albumNeighbours, albumSequence, arrange, moveBefore, DesignRedux, Queue, UpNext, Lengths, countWords, readingTime };\n');
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

  /* -- lengths, Up Next, Home ---------------------------------------------- */

  const f = (app, p) => app.vault.getFileByPath(p);
  const withQueue = (ctx) => {
    const { plugin, app } = ctx;
    plugin.queue = new R.Queue(plugin);
    const upNext = new R.UpNext(plugin);
    plugin.feature = (C) => (C === R.UpNext ? upNext : null);
    plugin.queueChanged = () => upNext.refresh();
    app.vault.on('rename', (file, old) => plugin.queue.followRename(file, old));
    return upNext;
  };

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

  await t("the strip's » goes to Up Next first and takes the note off it; the queue follows renames", async () => {
    const ctx = setup();
    const { plugin, app } = ctx;
    withQueue(ctx);
    plugin.queue.add([f(app, 'IR/Anarchy.md'), f(app, 'IR/Theories/Realism.md')], false);
    plugin.queue.add([f(app, 'IR/Deterrence.md')], true);
    plugin.queue.add([f(app, 'IR/Anarchy.md')], false);
    assert.deepStrictEqual(plugin.queue.files().map((x) => x.basename), ['Deterrence', 'Realism', 'Anarchy']);
    await app.fileManager.renameFile(app.vault.getFolderByPath('IR/Theories'), 'IR/Ideas');
    assert.strictEqual(plugin.settings.queue[1], 'IR/Ideas/Realism.md');
    const leaf = { isDeferred: false, view: Object.assign(new MarkdownView(), { file: f(app, 'IR/Balance.md'), getMode: () => 'source' }), openFile(x) { this.view.file = x; } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.commands = { executeCommandById() {} };
    plugin.pins.has = () => false;
    const strip = new R.ContextStrip(plugin);
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    strip.update();
    const next = strip.el.querySelector('[data-action="next"]');
    assert.strictEqual(next.getAttribute('aria-label'), 'Next: Deterrence (Up Next)');
    click(next);
    assert.strictEqual(leaf.view.file.basename, 'Deterrence');
    assert.deepStrictEqual(plugin.settings.queue, ['IR/Ideas/Realism.md', 'IR/Anarchy.md']);
    strip.el.remove();
  });

  await t('Home leads with large cards, then shelves; a queued note opens off the queue', async () => {
    const ctx = setup();
    const { view, plugin, app } = ctx;
    withQueue(ctx);
    plugin.recentFiles = () => [f(app, 'IR/Balance.md')];
    plugin.queue.add([f(app, 'IR/Deterrence.md')], false);
    const leaf = { isDeferred: false, view: view, openFile(x) { this.opened = x; } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    await view.setState({ mode: 'home' }, {});
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((e) => e.textContent);
    assert.deepStrictEqual(text('.dr-pick-caption'), ['Last opened', 'Up next', 'Rediscover']);
    assert.deepStrictEqual(text('.dr-shelf-title'), ['Up Next', 'Recently opened', 'Recently added', 'Rediscover', 'Folders']);
    click(view.contentEl.querySelector('.dr-pick[data-path="IR/Deterrence.md"]'));
    assert.strictEqual(leaf.opened.basename, 'Deterrence');
    assert.deepStrictEqual(plugin.settings.queue, []);
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
