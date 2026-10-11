// The whole plugin, loaded against the real main.js in a stand-in for
// Obsidian's window: every feature registered, switched on twice, off,
// on again and unloaded — and nothing doubled or left behind: classes on
// Obsidian's own elements, elements in them, listeners on the window,
// observers, timers, patched methods, event handlers. Also the command ids
// and setting keys, against a snapshot: hotkeys hang on the ids, saved
// settings on the keys. `node tests/test_lifecycle.js --update` records
// new ones after a deliberate change.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.virtualConsole.removeAllListeners('jsdomError');
const win = dom.window;
global.window = win;
global.document = win.document;
global.activeDocument = win.document;
global.activeWindow = win;
global.HTMLElement = win.HTMLElement;
global.Element = win.Element;
global.Node = win.Node;
global.Event = win.Event;
global.KeyboardEvent = win.KeyboardEvent;
global.MouseEvent = win.MouseEvent;
global.DOMParser = win.DOMParser;
global.getComputedStyle = win.getComputedStyle;
Object.defineProperty(global, 'navigator', { value: win.navigator, configurable: true });
global.CSS = { escape: (s) => String(s).replace(/"/g, '\\"') };

/* -- what's live: observers, intervals, frames, listeners on lasting targets -- */

const live = { observers: new Set(), intervals: new Set(), frames: 0, listeners: new Map() };
class TrackedObserver extends win.MutationObserver {
  observe(...args) { live.observers.add(this); return super.observe(...args); }
  disconnect() { live.observers.delete(this); return super.disconnect(); }
}
global.MutationObserver = win.MutationObserver = TrackedObserver;
const realSetInterval = setInterval;
const realClearInterval = clearInterval;
const trackedSetInterval = (fn, ms, ...rest) => { const id = realSetInterval(fn, ms, ...rest); live.intervals.add(id); return id; };
const trackedClearInterval = (id) => { live.intervals.delete(id); realClearInterval(id); };
global.setInterval = win.setInterval = trackedSetInterval;
global.clearInterval = win.clearInterval = trackedClearInterval;
win.setTimeout = setTimeout;
win.clearTimeout = clearTimeout;
global.requestAnimationFrame = win.requestAnimationFrame = (f) => { live.frames++; return setTimeout(() => f(Date.now()), 0); };
global.cancelAnimationFrame = win.cancelAnimationFrame = (id) => clearTimeout(id);

// Listeners on the window, the document, and Obsidian's own elements —
// the ones that outlive the plugin's. Elements the plugin makes take their
// listeners with them when they go.
const lasting = new WeakSet([win, win.document]);
const keyOf = (target, type, fn, opts) => [type, fn, !!(opts === true || (opts && opts.capture))];
const ET = win.EventTarget.prototype;
const realAdd = ET.addEventListener;
const realRemove = ET.removeEventListener;
ET.addEventListener = function (type, fn, opts) {
  // Only the plugin's: jsdom adds a few of its own as it goes.
  if (fn && lasting.has(this) && /main\.js/.test(new Error().stack)) {
    const list = live.listeners.get(this) || [];
    const [t, f, c] = keyOf(this, type, fn, opts);
    if (!list.some((e) => e[0] === t && e[1] === f && e[2] === c)) {
      const entry = [t, f, c];
      list.push(entry);
      live.listeners.set(this, list);
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => list.splice(list.indexOf(entry) >>> 0, 1));
    }
  }
  return realAdd.call(this, type, fn, opts);
};
ET.removeEventListener = function (type, fn, opts) {
  const list = live.listeners.get(this);
  if (list) {
    const [t, f, c] = keyOf(this, type, fn, opts);
    const i = list.findIndex((e) => e[0] === t && e[1] === f && e[2] === c);
    if (i !== -1) list.splice(i, 1);
  }
  return realRemove.call(this, type, fn, opts);
};
const listenerCount = () => [...live.listeners.values()].reduce((n, l) => n + l.length, 0);
const targetName = (t) => (t === win ? 'window' : t === win.document ? 'document' : t === win.document.body ? 'body' : t.className ? `.${t.className.split(' ')[0]}` : t.tagName);
const listenerList = () => [...live.listeners.entries()].flatMap(([t, l]) => l.map(([type, fn]) => `${targetName(t)} ${type}: ${String(fn).replace(/\s+/g, ' ').slice(0, 90)}`));

/* -- Obsidian's helpers on elements ----------------------------------------- */

const HP = win.HTMLElement.prototype;
const EP = win.Element.prototype;
const apply = (el, o) => {
  if (!o) return el;
  if (typeof o === 'string') { el.className = o; return el; }
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text !== undefined) el.textContent = o.text;
  if (o.attr) Object.entries(o.attr).forEach(([k, v]) => el.setAttribute(k, v));
  if (o.type) el.setAttribute('type', o.type);
  if (o.title) el.setAttribute('title', o.title);
  if (o.href) el.setAttribute('href', o.href);
  if (o.value !== undefined) el.value = o.value;
  if (o.placeholder) el.setAttribute('placeholder', o.placeholder);
  return el;
};
[HP, EP, win.DocumentFragment.prototype].forEach((p) => {
  p.createEl = function (tag, o, cb) { const el = apply(this.appendChild(win.document.createElement(tag)), o); if (cb) cb(el); return el; };
  p.createDiv = function (o, cb) { return this.createEl('div', o, cb); };
  p.createSpan = function (o, cb) { return this.createEl('span', o, cb); };
  p.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  p.setText = function (t) { this.textContent = t; };
});
[HP, EP].forEach((p) => {
  p.addClass = function (...c) { this.classList.add(...c.flat().filter(Boolean)); };
  p.addClasses = function (c) { this.classList.add(...c); };
  p.removeClass = function (...c) { this.classList.remove(...c.flat().filter(Boolean)); };
  p.toggleClass = function (c, on) { this.classList.toggle(c, !!on); };
  p.hasClass = function (c) { return this.classList.contains(c); };
  p.isShown = function () { return true; };
  p.setAttr = function (k, v) { if (v === null || v === undefined) this.removeAttribute(k); else this.setAttribute(k, v); };
  p.getAttr = function (k) { return this.getAttribute(k); };
  p.setCssProps = function (props) { Object.entries(props).forEach(([k, v]) => this.style.setProperty(k, v)); };
  p.setCssStyles = function (s) { Object.assign(this.style, s); };
  p.find = function (sel) { return this.querySelector(sel); };
  p.findAll = function (sel) { return [...this.querySelectorAll(sel)]; };
  p.detach = function () { this.remove(); };
  p.onClickEvent = function (fn) { this.addEventListener('click', fn); };
  p.instanceOf = function (C) { return this instanceof C; };
  p.show = function () { this.style.display = ''; };
  p.hide = function () { this.style.display = 'none'; };
});
win.document.createDiv = (o) => apply(win.document.createElement('div'), o);
win.document.createEl = (tag, o) => apply(win.document.createElement(tag), o);
global.createDiv = win.document.createDiv;
global.createEl = win.document.createEl;
global.createSpan = (o) => apply(win.document.createElement('span'), o);
global.createFragment = (cb) => { const f = win.document.createDocumentFragment(); if (cb) cb(f); return f; };
win.DocumentFragment.prototype.createEl = HP.createEl;

/* -- Obsidian's window: the parts the plugin dresses ------------------------ */

win.document.body.innerHTML = `
<div class="app-container"><div class="horizontal-main-container"><div class="workspace">
  <div class="workspace-ribbon side-dock-ribbon mod-left">
    <div class="side-dock-actions"><div class="clickable-icon side-dock-ribbon-action" aria-label="Open graph view"></div></div>
    <div class="side-dock-settings"><div class="clickable-icon side-dock-ribbon-action" aria-label="Settings"></div></div>
  </div>
  <div class="workspace-split mod-horizontal mod-sidedock mod-left-split">
    <div class="workspace-tabs mod-top"><div class="workspace-tab-header-container"><div class="workspace-tab-header-container-inner"></div></div><div class="workspace-tab-container"></div></div>
    <div class="workspace-sidedock-vault-profile"><div class="workspace-drawer-vault-switcher"><div class="workspace-drawer-vault-name">Vault</div></div><div class="workspace-drawer-vault-actions"></div></div>
  </div>
  <div class="workspace-split mod-vertical mod-root"><div class="workspace-tabs mod-top"><div class="workspace-tab-container"></div></div></div>
  <div class="workspace-split mod-horizontal mod-sidedock mod-right-split"><div class="workspace-tabs mod-top"><div class="workspace-tab-container"></div></div></div>
</div></div><div class="status-bar"></div></div>`;
win.document.body.classList.add('theme-dark');
const skeleton = [win.document.documentElement, win.document.body, ...win.document.body.querySelectorAll('*')];
skeleton.forEach((el) => lasting.add(el));
const leftTabs = win.document.querySelector('.mod-left-split .workspace-tab-container');
const rootTabs = win.document.querySelector('.mod-root .workspace-tab-container');
const rightTabs = win.document.querySelector('.mod-right-split .workspace-tab-container');

/* -- the obsidian module ----------------------------------------------------- */

class Events {
  constructor() { this.handlers = []; }
  on(name, fn, ctx) { const ref = { e: this, name, fn, ctx }; this.handlers.push(ref); return ref; }
  off(name, fn) { this.handlers = this.handlers.filter((h) => !(h.name === name && h.fn === fn)); }
  offref(ref) { this.handlers = this.handlers.filter((h) => h !== ref); }
  trigger(name, ...args) { this.handlers.filter((h) => h.name === name).forEach((h) => h.fn.apply(h.ctx, args)); }
  tryTrigger(evt, args) { this.trigger(evt, ...args); }
}

class Component {
  constructor() { this._cleanups = []; this._children = []; this._loaded = false; }
  load() { this._loaded = true; return this.onload && this.onload(); }
  onload() {}
  onunload() {}
  unload() {
    this._children.forEach((c) => c.unload());
    this.onunload();
    this._cleanups.splice(0).reverse().forEach((fn) => fn());
    this._loaded = false;
  }
  addChild(c) { this._children.push(c); c.load(); return c; }
  removeChild(c) { this._children = this._children.filter((x) => x !== c); c.unload(); return c; }
  register(fn) { this._cleanups.push(fn); }
  registerEvent(ref) { this._cleanups.push(() => ref.e.offref(ref)); }
  registerDomEvent(el, type, fn, opts) { el.addEventListener(type, fn, opts); this._cleanups.push(() => el.removeEventListener(type, fn, opts)); }
  registerScopeEvent() {}
  registerInterval(id) { this._cleanups.push(() => trackedClearInterval(id)); return id; }
}

class View extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = win.document.createElement('div');
    this.containerEl.className = 'workspace-leaf-content';
    this.containerEl.createDiv({ cls: 'view-header' });
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
    this.icon = '';
    this.navigation = false;
  }
  getViewType() { return ''; }
  getDisplayText() { return ''; }
  getIcon() { return this.icon; }
  getState() { return {}; }
  async setState() {}
  getEphemeralState() { return {}; }
  setEphemeralState() {}
  onResize() {}
  onPaneMenu() {}
  async onOpen() {}
  async onClose() {}
}
class ItemView extends View {
  addAction(icon, title, cb) { const el = this.containerEl.querySelector('.view-header').createDiv({ cls: 'clickable-icon view-action' }); el.setAttribute('aria-label', title); el.addEventListener('click', cb); return el; }
}
class MarkdownView extends ItemView {}
class FileView extends ItemView {}
class TextFileView extends FileView {}

class WorkspaceLeaf extends Events {
  constructor(app, parentEl) {
    super();
    this.app = app;
    this.parentEl = parentEl;
    this.containerEl = parentEl.createDiv({ cls: 'workspace-leaf' });
    this.view = new ItemView(this);
    this.view.getViewType = () => 'empty';
    this.containerEl.appendChild(this.view.containerEl);
  }
  getViewState() { return { type: this.view.getViewType(), state: this.view.getState() }; }
  async setViewState(vs) {
    const make = app.views[vs.type];
    if (!make) return;
    if (this.view) { await this.view.onClose(); this.view.containerEl.remove(); }
    this.view = make(this);
    this.containerEl.appendChild(this.view.containerEl);
    this.view.load();
    await this.view.onOpen();
    if (vs.state) await this.view.setState(vs.state, {});
  }
  getDisplayText() { return this.view.getDisplayText(); }
  async openFile() {}
  async open(view) { this.view = view; return view; }
  detach() {
    const i = app.workspace.leaves.indexOf(this);
    if (i !== -1) app.workspace.leaves.splice(i, 1);
    Promise.resolve(this.view.onClose()).then(() => {});
    this.view.unload();
    this.containerEl.remove();
  }
  setPinned() {}
  setGroup() {}
  getRoot() { return this.parentEl === leftTabs ? app.workspace.leftSplit : this.parentEl === rightTabs ? app.workspace.rightSplit : app.workspace.rootSplit; }
  getContainer() { return app.workspace.rootSplit; }
  loadIfDeferred() { return Promise.resolve(); }
}

class Modal {
  constructor(a) {
    this.app = a;
    this.containerEl = win.document.createElement('div');
    this.containerEl.className = 'modal-container';
    this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
    this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
    this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
    this.scope = { register() {}, unregister() {} };
  }
  open() { win.document.body.appendChild(this.containerEl); this.onOpen(); }
  close() { this.containerEl.remove(); this.onClose(); }
  setTitle(t) { this.titleEl.textContent = t; return this; }
  onOpen() {}
  onClose() {}
}
class SuggestModal extends Modal { setPlaceholder() {} setInstructions() {} }
class FuzzySuggestModal extends SuggestModal {}
class Menu {
  constructor() { this.items = []; this.dom = win.document.createElement('div'); }
  addItem(cb) {
    const item = { dom: win.document.createElement('div') };
    ['setIcon', 'setChecked', 'setSection', 'setWarning', 'setDisabled', 'setIsLabel'].forEach((m) => (item[m] = () => item));
    item.setTitle = (t) => { item.title = t; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    item.setSubmenu = () => new Menu();
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() { return this; }
  showAtPosition() {}
  showAtMouseEvent() {}
  hide() {}
  close() {}
  onHide() {}
  setNoIcon() { return this; }
  setUseNativeMenu() { return this; }
}
class Setting {
  constructor(el) {
    this.settingEl = el.createDiv({ cls: 'setting-item' });
    this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
    this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    this.components = [];
  }
  setName(n) { this.nameEl.textContent = typeof n === 'string' ? n : ''; return this; }
  setDesc(d) { this.descEl.textContent = typeof d === 'string' ? d : ''; return this; }
  setHeading() { return this; }
  setClass(c) { this.settingEl.classList.add(c); return this; }
  setTooltip() { return this; }
  setDisabled() { return this; }
  then(cb) { cb(this); return this; }
}
['addToggle', 'addText', 'addTextArea', 'addDropdown', 'addButton', 'addExtraButton', 'addSlider', 'addColorPicker', 'addSearch', 'addMomentFormat'].forEach((m) => {
  Setting.prototype[m] = function (cb) {
    const c = new Proxy({ inputEl: win.document.createElement('input'), selectEl: win.document.createElement('select'), buttonEl: win.document.createElement('button'), extraSettingsEl: win.document.createElement('div') }, {
      get: (t, k) => (k in t ? t[k] : () => c),
    });
    cb(c);
    return this;
  };
});
class PluginSettingTab { constructor(a, plugin) { this.app = a; this.plugin = plugin; this.containerEl = win.document.createElement('div'); } }
class Notice { constructor(m) { this.message = m; this.noticeEl = win.document.createElement('div'); } setMessage(m) { this.message = m; return this; } hide() {} }
class EditorSuggest { constructor(a) { this.app = a; } close() {} }
class AbstractInputSuggest { constructor(a, el) { this.app = a; this.inputEl = el; } close() {} onSelect() { return this; } }
class Scope { register() {} unregister() {} }

class Plugin extends Component {
  constructor(a, manifest) { super(); this.app = a; this.manifest = manifest; this.data = null; }
  addCommand(cmd) {
    if (app.commands.list[cmd.id]) throw new Error(`command ${cmd.id} added twice`);
    app.commands.list[cmd.id] = cmd;
    this._cleanups.push(() => delete app.commands.list[cmd.id]);
    return cmd;
  }
  removeCommand(id) { delete app.commands.list[id]; }
  addSettingTab(tab) { app.settingTabs.push(tab); this._cleanups.push(() => app.settingTabs.splice(app.settingTabs.indexOf(tab), 1)); }
  addRibbonIcon(icon, title, cb) { const el = win.document.querySelector('.side-dock-actions').createDiv({ cls: 'clickable-icon side-dock-ribbon-action' }); el.addEventListener('click', cb); this._cleanups.push(() => el.remove()); return el; }
  addStatusBarItem() { const el = win.document.querySelector('.status-bar').createDiv({ cls: 'status-bar-item' }); this._cleanups.push(() => el.remove()); return el; }
  registerView(type, make) {
    app.views[type] = make;
    this._cleanups.push(() => {
      // As Obsidian does: the views close; their leaves stay, emptied.
      app.workspace.leaves.filter((l) => l.view.getViewType() === type).forEach((l) => { l.view.onClose(); l.view.unload(); l.view.containerEl.remove(); });
      delete app.views[type];
    });
  }
  registerExtensions() {}
  registerEditorExtension(ext) { app.editorExtensions.push(ext); this._cleanups.push(() => app.editorExtensions.splice(app.editorExtensions.indexOf(ext), 1)); }
  registerMarkdownPostProcessor(fn) { app.postProcessors.push(fn); this._cleanups.push(() => app.postProcessors.splice(app.postProcessors.indexOf(fn), 1)); return fn; }
  registerMarkdownCodeBlockProcessor() {}
  registerEditorSuggest(s) { app.workspace.editorSuggest.suggests.push(s); this._cleanups.push(() => app.workspace.editorSuggest.suggests.splice(app.workspace.editorSuggest.suggests.indexOf(s), 1)); }
  registerHoverLinkSource() {}
  registerObsidianProtocolHandler() {}
  async loadData() { return this.data; }
  async saveData(d) { this.data = JSON.parse(JSON.stringify(d)); }
}

const iconsSet = [];
const obsidian = {
  Plugin, PluginSettingTab, Setting, Menu, MarkdownView, Notice, FuzzySuggestModal, SuggestModal, Modal, Component, ItemView, View, FileView, TextFileView, WorkspaceLeaf,
  Events, Scope, EditorSuggest, AbstractInputSuggest, MenuItem: class {}, MarkdownRenderer: { render: async () => {}, renderMarkdown: async () => {} },
  TAbstractFile: class {}, Platform: { isMobile: false, isPhone: false, isDesktop: true, isDesktopApp: true, isMacOS: false, isIosApp: false, isAndroidApp: false },
  apiVersion: '1.13.1', normalizePath: (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || '/',
  setIcon: (el, name) => { if (typeof name !== 'string') throw new TypeError('setIcon needs a name'); el.dataset.icon = name; iconsSet.push(name); },
  setTooltip: (el, t) => el.setAttribute('aria-label', t),
  parseYaml: () => ({}), stringifyYaml: (o) => JSON.stringify(o), getAllTags: () => [], prepareFuzzySearch: (q) => (t) => (String(t).toLowerCase().includes(String(q).toLowerCase()) ? { score: 0, matches: [] } : null),
  debounce: (fn) => fn, requestUrl: async () => ({}), moment: () => ({ format: () => '' }),
  editorLivePreviewField: null, editorInfoField: null,
};
class TFile extends obsidian.TAbstractFile {
  constructor(p) {
    super();
    this.path = p; this.name = p.split('/').pop();
    this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.stat = { mtime: 1, ctime: 1, size: 10 };
  }
}
class TFolder extends obsidian.TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p === '/' ? '' : p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
Object.assign(obsidian, { TFile, TFolder });
const { StateField } = require('@codemirror/state');
obsidian.editorLivePreviewField = StateField.define({ create: () => true, update: (v) => v });
obsidian.editorInfoField = StateField.define({ create: () => ({}), update: (v) => v });

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};

/* -- a small vault ------------------------------------------------------------- */

const root = new TFolder('/');
const byPath = { '/': root };
const add = (p, f) => {
  const parentPath = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/';
  if (!byPath[parentPath]) add(parentPath, new TFolder(parentPath));
  f.parent = byPath[parentPath];
  f.parent.children.push(f);
  byPath[p] = f;
};
const texts = {
  'Politics/Politics.md': '---\nalbum: true\n---\n',
  'Politics/Realism.md': '---\nstatus: draft\n---\nPower. See [[[Anarchy]]].',
  'Politics/Anarchy.md': 'No ruler.',
  'Maps/Map.canvas': '{"nodes":[],"edges":[]}',
  'Inbox.md': 'Loose note.',
};
Object.keys(texts).forEach((p) => add(p, new TFile(p)));
const files = () => Object.values(byPath).filter((f) => f instanceof TFile);
const fm = (p) => (/^---\n([\s\S]*?)\n---/.exec(texts[p] || '') || [, ''])[1].split('\n').filter(Boolean).reduce((o, line) => {
  const [k, ...v] = line.split(':');
  o[k.trim()] = v.join(':').trim() === 'true' ? true : v.join(':').trim();
  return o;
}, {});

const workspace = Object.assign(new Events(), {
  leaves: [],
  layoutReady: true,
  activeLeaf: null,
  containerEl: win.document.querySelector('.workspace'),
  editorSuggest: { suggests: [] },
  leftSplit: { collapsed: false, containerEl: win.document.querySelector('.mod-left-split'), expand() { this.collapsed = false; }, collapse() { this.collapsed = true; }, toggle() { this.collapsed = !this.collapsed; } },
  rightSplit: { collapsed: true, containerEl: win.document.querySelector('.mod-right-split'), expand() {}, collapse() {}, toggle() {} },
  rootSplit: { containerEl: win.document.querySelector('.mod-root') },
  leftRibbon: { containerEl: win.document.querySelector('.workspace-ribbon') },
  onLayoutReady(fn) { fn(); },
  getLeavesOfType(type) { return this.leaves.filter((l) => l.view.getViewType() === type); },
  iterateAllLeaves(fn) { this.leaves.slice().forEach(fn); },
  iterateRootLeaves(fn) { this.leaves.filter((l) => l.parentEl === rootTabs).forEach(fn); },
  newLeaf(parentEl) { const l = new WorkspaceLeaf(app, parentEl); this.leaves.push(l); return l; },
  getLeaf() { return this.newLeaf(rootTabs); },
  getLeftLeaf() { return this.newLeaf(leftTabs); },
  getRightLeaf() { return this.newLeaf(rightTabs); },
  createLeafBySplit() { return this.newLeaf(rootTabs); },
  getMostRecentLeaf() { return this.activeLeaf; },
  getActiveFile() { return null; },
  getActiveViewOfType() { return null; },
  getLastOpenFiles() { return []; },
  async revealLeaf() {},
  setActiveLeaf(l) { this.activeLeaf = l; },
  detachLeavesOfType(type) { this.getLeavesOfType(type).forEach((l) => l.detach()); },
  openLinkText: async () => {},
  updateOptions() {},
  changeLayout: async () => {},
  requestSaveLayout() {},
  getLayout() { return {}; },
  getGroupLeaves() { return []; },
});
workspace.on('noop', () => {}); // the stand-in's own: kept out of the counts
const vault = Object.assign(new Events(), {
  adapter: { write: async () => {}, read: async () => '', exists: async () => false, getResourcePath: (p) => p, basePath: '/vault' },
  configDir: '.obsidian',
  getRoot: () => root,
  getName: () => 'Vault',
  getFiles: () => files(),
  getMarkdownFiles: () => files().filter((f) => f.extension === 'md'),
  getAllLoadedFiles: () => Object.values(byPath),
  getAllFolders: () => Object.values(byPath).filter((f) => f instanceof TFolder),
  getAbstractFileByPath: (p) => byPath[p] || null,
  getFileByPath: (p) => (byPath[p] instanceof TFile ? byPath[p] : null),
  getFolderByPath: (p) => (byPath[p] instanceof TFolder ? byPath[p] : null),
  read: async (f) => texts[f.path] || '',
  cachedRead: async (f) => texts[f.path] || '',
  process: async (f, fn) => (texts[f.path] = fn(texts[f.path] || '')),
  modify: async (f, t) => { texts[f.path] = t; },
  create: async (p, t) => { add(p, new TFile(p)); texts[p] = t; return byPath[p]; },
  createFolder: async (p) => { add(p, new TFolder(p)); return byPath[p]; },
  getResourcePath: (f) => `app://${f.path}`,
  getConfig: () => undefined,
});
const metadataCache = Object.assign(new Events(), {
  resolvedLinks: {},
  unresolvedLinks: {},
  getFileCache: (f) => (f && f.extension === 'md' ? { frontmatter: Object.keys(fm(f.path)).length ? fm(f.path) : undefined, links: [], headings: [], sections: [] } : null),
  getCache: (p) => metadataCache.getFileCache(byPath[p]),
  getFirstLinkpathDest: (name) => files().find((f) => f.basename === name || f.path === name || f.path === `${name}.md`) || null,
  fileToLinktext: (f) => f.basename,
  getCachedFiles: () => files().map((f) => f.path),
  getTags: () => ({}),
  getBacklinksForFile: () => ({ data: new Map() }),
});
const app = {
  workspace, vault, metadataCache,
  fileManager: { processFrontMatter: async () => {}, renameFile: async () => {}, trashFile: async () => {}, getNewFileParent: () => root, generateMarkdownLink: (f) => `[[${f.basename}]]` },
  commands: { list: {}, commands: {}, executeCommandById() {} },
  settingTabs: [],
  views: {},
  editorExtensions: [],
  postProcessors: [],
  keymap: { pushScope() {}, popScope() {} },
  scope: new Scope(),
  loadLocalStorage: () => null,
  saveLocalStorage: () => {},
  isDarkMode: () => true,
};
const eventSources = { workspace, vault, metadataCache };
const handlerCount = () => Object.values(eventSources).reduce((n, e) => n + e.handlers.length, 0);

/* -- what the plugin left on Obsidian's things ------------------------------------ */

const ownViews = () => app.workspace.leaves.map((l) => l.view.containerEl);
function footprint() {
  const marks = [];
  skeleton.forEach((el) => {
    const label = el === win.document.body ? 'body' : el === win.document.documentElement ? 'html' : el.className.split(' ')[0];
    [...el.classList].filter((c) => /^dr-|^is-dr-/.test(c)).forEach((c) => marks.push(`${label}.${c}`));
    [...el.attributes].filter((a) => /^data-dr-/.test(a.name)).forEach((a) => marks.push(`${label}[${a.name}]`));
    for (let i = 0; i < el.style.length; i++) if (el.style[i].startsWith('--dr-')) marks.push(`${label} ${el.style[i]}`);
  });
  // Elements the plugin put into Obsidian's own, outside its views.
  const views = ownViews();
  const added = [...win.document.body.querySelectorAll('*')].filter((el) => !skeleton.includes(el) && !views.some((v) => v.contains(el)) && !el.closest('.workspace-leaf'));
  added.filter((el) => !added.includes(el.parentElement)).forEach((el) => marks.push(`+${el.tagName.toLowerCase()}.${el.className || '?'}`));
  return marks.sort();
}
const state = () => ({ marks: footprint(), observers: live.observers.size, intervals: live.intervals.size, listeners: listenerCount(), handlers: handlerCount() });

/* -- run -------------------------------------------------------------------------- */

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const realError = console.error;
console.error = (...args) => errors.push(args.map((a) => (a && a.stack) || String(a)).join(' '));
process.on('unhandledRejection', (e) => errors.push(`unhandled: ${(e && e.stack) || e}`));

const patched = [Menu.prototype, Modal.prototype, FuzzySuggestModal.prototype, MarkdownView.prototype, ItemView.prototype, WorkspaceLeaf.prototype, win.Element.prototype, win.HTMLElement.prototype, win.Document.prototype];
const methodsOf = (p) => Object.getOwnPropertyNames(p).filter((k) => { try { return typeof p[k] === 'function'; } catch (e) { return false; } }).map((k) => [k, p[k]]);
const before = patched.map(methodsOf);

const DesignRedux = require(path.join(__dirname, '..', 'main.js'));
const snapshotFile = path.join(__dirname, 'snapshots', 'lifecycle.json');
const update = process.argv.includes('--update');

(async () => {
  const plugin = new DesignRedux(app, { id: 'design-redux', dir: '.obsidian/plugins/design-redux', version: '0.0.0' });
  const quietErrors = () => errors.splice(0).filter((e) => !/^Design Redux: could not back up/.test(e));

  await t('the whole plugin loads with no feature failing', async () => {
    plugin.noteError = (m) => errors.push(`noteError: ${m}`);
    await plugin.load();
    // As on first install: the library opened in the sidebar.
    await plugin.onUserEnable();
    await settle(120);
    assert.deepStrictEqual(quietErrors(), [], 'errors while loading');
    assert.ok(plugin.features.length > 50, `${plugin.features.length} features`);
  });

  let first;
  await t('switched on again — as every settings save does — nothing is doubled', async () => {
    first = state();
    plugin.refresh();
    await settle();
    plugin.refresh();
    await settle();
    assert.deepStrictEqual(state(), first);
    assert.deepStrictEqual(quietErrors(), []);
  });

  await t('every feature with a switch, switched off, takes its marks with it; on again, as before', async () => {
    const keys = [...new Set(plugin.features.map((f) => f.constructor.settingKey).filter(Boolean))];
    const was = {};
    keys.forEach((k) => { was[k] = plugin.settings[k]; plugin.settings[k] = false; });
    plugin.refresh();
    await settle();
    const off = state();
    // What's left belongs to the features that can't be switched off.
    assert.ok(off.observers <= first.observers && off.listeners <= first.listeners && off.handlers <= first.handlers, 'switching off added something');
    if (off.marks.length > first.marks.length) assert.fail(`switched off, more marks than on: ${off.marks.join(', ')}`);
    keys.forEach((k) => (plugin.settings[k] = was[k]));
    plugin.refresh();
    await settle();
    assert.deepStrictEqual(state(), first, 'on again, not as before');
    assert.deepStrictEqual(quietErrors(), []);
  });

  await t('unloaded, nothing is left on Obsidian’s window', async () => {
    const framesBefore = live.frames;
    plugin.unload();
    await settle(120);
    const after = state();
    assert.deepStrictEqual(after.marks, [], 'marks left behind');
    assert.strictEqual(after.observers, 0, 'observers still watching');
    assert.strictEqual(after.intervals, 0, 'intervals still running');
    assert.deepStrictEqual(listenerList(), [], 'listeners left on the window, the document or Obsidian’s elements');
    assert.strictEqual(after.handlers, 1, 'workspace, vault or metadata handlers left');
    const framesAfter = live.frames;
    await settle(120);
    assert.strictEqual(live.frames, framesAfter, `still asking for frames after unloading (${framesAfter - framesBefore} since)`);
    assert.deepStrictEqual(Object.keys(app.commands.list), [], 'commands left');
    assert.deepStrictEqual(quietErrors(), []);
  });

  await t('Obsidian’s methods are as they were', () => {
    patched.forEach((p, i) => {
      const now = methodsOf(p);
      assert.deepStrictEqual(now.map(([k]) => k), before[i].map(([k]) => k), 'a method added or removed');
      now.forEach(([k, f], j) => assert.strictEqual(f, before[i][j][1], `${k} still patched`));
    });
  });

  await t('command ids and setting keys are kept: hotkeys and saved settings hang on them', () => {
    // The ids a load adds, from the features themselves.
    const ids = [];
    plugin.features.forEach((f) => f.commands().forEach((c) => ids.push(c.id)));
    const now = { commands: ids.sort(), settings: Object.keys(plugin.settings).sort() };
    if (update || !fs.existsSync(snapshotFile)) {
      fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
      fs.writeFileSync(snapshotFile, JSON.stringify(now, null, 1) + '\n');
      return;
    }
    const kept = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    const gone = (a, b) => a.filter((x) => !b.includes(x));
    assert.deepStrictEqual(gone(kept.commands, now.commands), [], 'command ids gone or renamed: hotkeys hang on them');
    assert.deepStrictEqual(gone(kept.settings, now.settings), [], 'setting keys gone: saved settings hang on them (migrate, then --update)');
    const fresher = gone(now.commands, kept.commands).concat(gone(now.settings, kept.settings));
    assert.deepStrictEqual(fresher, [], 'new ids or keys: record them with node tests/test_lifecycle.js --update');
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error = realError;
  console.error(err && err.stack ? err.stack : err);
  if (errors.length) console.error('logged:\n' + errors.slice(0, 15).join('\n'));
  process.exit(1);
});
