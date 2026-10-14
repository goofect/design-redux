// The iPhone work, run against the real main.js in jsdom with Obsidian's
// Platform switchable between desktop and phone: long press for menus,
// desktop-only features and settings, the phone layouts' hooks, the
// strip as a mini player, and the properties panel's placement.
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
global.MutationObserver = dom.window.MutationObserver;
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

const Platform = { isMobile: false, isPhone: false, isDesktop: true };
const phone = (on) => {
  Platform.isMobile = on; Platform.isPhone = on; Platform.isDesktop = !on;
  document.body.classList.toggle('is-mobile', on);
  document.body.classList.toggle('is-phone', on);
};

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
    this.basename = this.name.replace(/\.[^.]+$/, ''); this.extension = this.name.split('.').pop();
    this.stat = { mtime: Date.now(), ctime: Date.now() };
  }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
class MarkdownView { constructor(file) { this.file = file; } getMode() { return 'source'; } }
let menus = [];
class Menu {
  constructor() { this.items = []; this.shownAt = null; }
  addItem(cb) {
    const item = { title: '' };
    item.setTitle = (t) => { item.title = t; return item; };
    item.setIcon = () => item;
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
  addSeparator() { this.items.push({ title: '---' }); return this; }
  showAtMouseEvent() { this.shownAt = 'pointer'; menus.push(this); }
  showAtPosition(pos) { this.shownAt = pos; menus.push(this); }
  titles() { return this.items.map((i) => i.title); }
}
const settingNames = [];
class Setting {
  constructor(el) { this.el = el; this.settingEl = el && el.createDiv ? el.createDiv({ cls: "setting-item" }) : null; }
  setName(n) { settingNames.push(n); return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addToggle(cb) { const c = { setValue: () => c, onChange: () => c }; cb(c); return this; }
  addText(cb) { const c = { setPlaceholder: () => c, setValue: () => c, onChange: () => c }; cb(c); return this; }
  addDropdown(cb) { const c = { addOption: () => c, setValue: () => c, onChange: () => c }; cb(c); return this; }
}
class PluginSettingTab { constructor(app) { this.app = app; this.containerEl = document.createElement('div'); } }

const obsidian = new Proxy({
  ItemView, TFile, TFolder, TAbstractFile, MarkdownView, Component, Menu, Setting,
  PluginSettingTab, Platform,
  Modal: class { constructor(app) { this.app = app; } open() {} close() {} },
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class {},
  normalizePath: (p) => p,
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_mobile_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { onContextMenu, singleAreaOn, showMenuAt, LibraryView, BrowseView, ' +
  'Library, ActionsMenu, SettingsButton, ContextStrip, PropertiesPanel, PropertiesScreen, ' +
  'DesignReduxSettingTab, SETTINGS_TABS };\n');
const T = require(tmp).__test;

/* -- helpers -------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const touch = (el, type, x = 50, y = 50, target = el) => {
  const evt = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'touches', {
    value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }],
  });
  target.dispatchEvent(evt);
  return evt;
};
const tap = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const hold = async (el, target = el) => {
  touch(el, 'touchstart', 50, 50, target);
  await sleep(560);
  const end = touch(el, 'touchend', 50, 50, target);
  tap(target);
  return end;
};

/** A page holding a row, each with a menu; the row also opens on a tap. */
function nested() {
  document.body.innerHTML = '';
  const page = document.body.createDiv({ cls: 'page' });
  const row = page.createDiv({ cls: 'row' });
  const field = page.createEl('input', { type: 'text' });
  const got = { page: 0, row: 0, opened: 0, events: [] };
  T.onContextMenu(page, (e) => { got.page++; got.events.push(e); });
  row.addEventListener('click', () => got.opened++);
  T.onContextMenu(row, (e) => { got.row++; got.events.push(e); });
  return { page, row, field, got };
}

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  /* -- long press ---------------------------------------------------- */

  await t('holding a row opens its menu, and only its menu', async () => {
    const { row, got } = nested();
    await hold(row);
    assert.strictEqual(got.row, 1);
    assert.strictEqual(got.page, 0, 'the page behind opened its menu too');
  });

  await t('lifting the finger after a hold is not also a tap', async () => {
    const { row, got } = nested();
    const end = await hold(row);
    assert.ok(end.defaultPrevented, 'the lift was left to become a tap');
    assert.strictEqual(got.opened, 0, 'the row opened as well as showing its menu');
    tap(row);
    assert.strictEqual(got.opened, 1, 'the next real tap was swallowed');
  });

  await t('a quick tap opens the row and shows no menu', async () => {
    const { row, got } = nested();
    touch(row, 'touchstart');
    await sleep(80);
    touch(row, 'touchend');
    tap(row);
    await sleep(520);
    assert.strictEqual(got.row, 0);
    assert.strictEqual(got.opened, 1);
  });

  await t('a finger that moves is scrolling, not holding', async () => {
    const { row, got } = nested();
    touch(row, 'touchstart', 50, 50);
    touch(row, 'touchmove', 50, 80);
    await sleep(560);
    assert.strictEqual(got.row, 0);
  });

  await t("Android's own contextmenu after a hold doesn't open a second menu", async () => {
    const { row, got } = nested();
    touch(row, 'touchstart');
    await sleep(560);
    const cm = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    row.dispatchEvent(cm);
    touch(row, 'touchend');
    assert.strictEqual(got.row, 1);
    assert.strictEqual(got.page, 0);
    assert.ok(cm.defaultPrevented);
  });

  await t('right-click still works as before', () => {
    const { row, got } = nested();
    row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    assert.strictEqual(got.row, 1);
  });

  await t('holding in a text field places the caret, not a menu', async () => {
    const { field, got } = nested();
    touch(field, 'touchstart');
    await sleep(560);
    touch(field, 'touchend');
    assert.strictEqual(got.page, 0);
  });

  await t('a held menu opens where the finger is', async () => {
    const { row, got } = nested();
    touch(row, 'touchstart', 120, 340);
    await sleep(560);
    touch(row, 'touchend');
    menus = [];
    T.showMenuAt(new Menu(), got.events[0]);
    assert.deepStrictEqual(menus[0].shownAt, { x: 120, y: 340 });
    // A mouse still gets the pointer placement it always had.
    T.showMenuAt(new Menu(), new window.MouseEvent('contextmenu', { clientX: 5, clientY: 5 }));
    assert.strictEqual(menus[1].shownAt, 'pointer');
  });

  /* -- desktop-only ------------------------------------------------------- */

  const settings = () => ({
    library: true, singleArea: true, navDropdown: true, settingsInHeader: true,
    contextStrip: true, onePage: false, librarySections: [],
  });
  const fakePlugin = (s) => ({
    settings: s,
    app: { workspace: { getLeavesOfType: () => [{}], leftSplit: { collapsed: true } }, vault: {} },
  });

  await t('header features are off on a phone whatever the synced setting says', () => {
    const p = fakePlugin(settings());
    phone(false);
    assert.ok(new T.ActionsMenu(p).enabled && new T.SettingsButton(p).enabled);
    phone(true);
    assert.ok(!new T.ActionsMenu(p).enabled, 'actions menu on');
    assert.ok(!new T.SettingsButton(p).enabled, 'settings button on');
    assert.ok(new T.ContextStrip(p).enabled, 'the strip belongs on a phone too');
    phone(false);
  });

  await t('single content area never hides the mobile chrome', () => {
    const p = fakePlugin(settings());
    phone(true);
    new T.Library(p).enable();
    assert.ok(!document.body.classList.contains('dr-single-area'));
    assert.strictEqual(T.singleAreaOn(p.settings), false);
    phone(false);
    new T.Library(p).enable();
    assert.ok(document.body.classList.contains('dr-single-area'));
    document.body.classList.remove('dr-single-area');
  });

  await t("settings that do nothing on a phone aren't listed there", () => {
    const p = fakePlugin(Object.assign(settings(), { library: false }));
    p.features = [
      new T.ActionsMenu(p),
      { settingsSchema: () => [
        { key: 'singleArea', desktopOnly: true, name: 'Single content area' },
        { key: 'contextStrip', name: 'Context strip' },
      ] },
    ];
    const tab = new T.DesignReduxSettingTab(p.app, p);
    tab.containerEl.addClass = () => {};

    phone(false);
    settingNames.length = 0;
    tab.display();
    assert.ok(settingNames.includes('Single content area'));
    assert.ok(settingNames.includes('Sidebar header'));

    phone(true);
    settingNames.length = 0;
    tab.display();
    assert.ok(!settingNames.includes('Single content area'));
    assert.ok(!settingNames.includes('Sidebar header'), 'the header section is all desktop');
    assert.ok(settingNames.includes('Context strip'));
    assert.ok(tab.containerEl.querySelector('.dr-settings-note'));
    phone(false);

    // Opened at one setting, from where it shows: its tab, its row marked.
    tab.query = 'single';
    tab.reveal('contextStrip');
    tab.display();
    const row = Array.from(tab.containerEl.querySelectorAll('[data-dr-key]')).find((e) => e.dataset.drKey === 'contextStrip');
    assert.ok(row && row.classList.contains('is-revealed'));
    assert.strictEqual(tab.tab, T.SETTINGS_TABS.find((s) => s.sections.some((sec) => sec.keys.includes('contextStrip'))).id);
    assert.strictEqual(tab.query, '', 'a search left in the field would hide it');
  });

  await t('settings show the everyday ones first; Show all settings, a search or a link to one shows the rest', async () => {
    const p = fakePlugin(Object.assign(settings(), { library: false, settingsLevel: 'basic' }));
    p.saveData = async () => {};
    p.features = [{ settingsSchema: () => [
      { key: 'contextStrip', name: 'Context strip' },
      { key: 'stripDetail', name: 'Strip detail' },
      { key: 'graphRoutes', name: 'Graph routes' },
    ] }];
    const tab = new T.DesignReduxSettingTab(p.app, p);
    tab.display();
    const row = (key) => Array.from(tab.containerEl.querySelectorAll('[data-dr-key]')).find((e) => e.dataset.drKey === key);
    assert.ok(tab.containerEl.classList.contains('dr-settings-basic'));
    assert.ok(!row('contextStrip').classList.contains('is-advanced'));
    assert.ok(row('stripDetail').classList.contains('is-advanced'));
    assert.ok(row('graphRoutes').closest('.dr-set-block').classList.contains('is-advanced'), 'a section with nothing everyday');
    const tabs = Array.from(tab.containerEl.querySelectorAll('.dr-set-tab'));
    assert.ok(tabs.find((b) => b.textContent === 'Advanced').classList.contains('is-advanced'));
    assert.strictEqual(tab.tab, 'workspace', 'opens where there is something to show');

    const level = tab.containerEl.querySelector('.dr-set-level');
    assert.strictEqual(level.textContent, 'Show all settings');
    level.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(p.settings.settingsLevel, 'all');
    assert.ok(!tab.containerEl.classList.contains('dr-settings-basic'));
    assert.strictEqual(tab.containerEl.querySelector('.dr-set-level').textContent, 'Show fewer settings');

    // Back to the few; a link to one of the rest shows them all while the tab is open.
    p.settings.settingsLevel = 'basic';
    tab.reveal('graphRoutes');
    tab.display();
    assert.ok(!tab.containerEl.classList.contains('dr-settings-basic'));
    tab.hide();
    tab.display();
    assert.ok(tab.containerEl.classList.contains('dr-settings-basic'));
  });

  /* -- browse view hooks ----------------------------------------------- */

  const browseView = () => {
    const plugin = {
      settings: { albumColumns: 'domain, modified', coverProperty: 'cover', recentSearches: [] },
      isFolderNote: () => false,
      pins: { has: () => false },
    };
    const app = { metadataCache: { getFileCache: () => null }, workspace: {} };
    plugin.app = app;
    const view = new T.BrowseView({ history: null }, plugin);
    view.app = app;
    return view;
  };

  await t("rows aren't draggable on touch, where a drag would take the hold", () => {
    const view = browseView();
    const file = new TFile('Concepts/Logic.md');
    phone(true);
    const list = document.createElement('div');
    view.trackRow(list, file, 1);
    assert.ok(!list.firstChild.hasAttribute('draggable'));
    phone(false);
    view.trackRow(list, file, 2);
    assert.strictEqual(list.lastChild.getAttribute('draggable'), 'true');
  });

  await t('choosing a property marks the split, and heads the values', () => {
    const view = {
      renderTitleBar() {},
      propertyList: () => [{ key: 'domain', name: 'Domain', type: 'text', count: 2 }],
      matches: () => true,
      property: null,
      value: null,
      groupsByProperty: () => [],
      navigate() {},
      plugin: { settings: {}, feature: () => null },
      propFilters: () => [],
    };
    const screen = new T.PropertiesScreen(view);
    screen.emptyNotes = () => [];
    let root = document.createElement('div');
    screen.render(root);
    assert.ok(!root.querySelector('.dr-split').classList.contains('has-selection'));
    view.property = 'domain';
    root = document.createElement('div');
    screen.render(root);
    assert.ok(root.querySelector('.dr-split').classList.contains('has-selection'));
    assert.strictEqual(root.querySelector('.dr-split-heading').textContent, 'Domain');
  });

  /* -- the library drawer ------------------------------------------------ */

  await t('opening something from the library drawer closes it on a phone', () => {
    let collapsed = 0;
    const plugin = {
      settings: { librarySections: [{ title: '', items: [{ kind: 'builtin', id: 'folders' }] }] },
      feature: () => ({ browseMode() {} }),
      pins: { has: () => false, files: () => [], folders: () => [], all: () => [] },
    };
    const app = {
      workspace: {
        rootSplit: {}, getMostRecentLeaf: () => null,
        leftSplit: { collapse: () => collapsed++ },
      },
      vault: { getName: () => 'Vault', getAbstractFileByPath: () => null },
      metadataCache: { getFileCache: () => null },
    };
    plugin.app = app;
    const view = new T.LibraryView({}, plugin);
    view.app = app;
    view.render();
    const row = view.contentEl.querySelector('.dr-lib-row');
    phone(true);
    tap(row);
    assert.strictEqual(collapsed, 1);
    phone(false);
    tap(row);
    assert.strictEqual(collapsed, 1, 'the desktop sidebar was collapsed');
  });

  await t('opening Pinned in the drawer leaves the drawer open', () => {
    let collapsed = 0;
    const plugin = {
      settings: { pinsExpanded: false, librarySections: [{ title: '', items: [{ kind: 'builtin', id: 'bookmarks' }] }] },
      feature: () => ({ browseMode() { throw new Error('navigated'); } }),
      pins: { has: () => false, files: () => [], folders: () => [], all: () => [] },
      saveData() {},
    };
    const app = {
      workspace: { rootSplit: {}, getMostRecentLeaf: () => null, leftSplit: { collapse: () => collapsed++ } },
      vault: { getName: () => 'Vault', getAbstractFileByPath: () => null },
      metadataCache: { getFileCache: () => null },
    };
    plugin.app = app;
    const view = new T.LibraryView({}, plugin);
    view.app = app;
    view.render();
    phone(true);
    tap(view.contentEl.querySelector('.dr-lib-row[data-group="pins"]'));
    phone(false);
    assert.strictEqual(plugin.settings.pinsExpanded, true);
    assert.strictEqual(collapsed, 0, 'the drawer closed on a group being opened');
  });

  /* -- the strip ---------------------------------------------------------- */

  const stripFor = () => {
    const file = new TFile('Concepts/Logic.md');
    file.parent = new TFolder('Concepts');
    const view = new MarkdownView(file);
    const leaf = { isDeferred: false, view };
    const plugin = {
      settings: { coverProperty: 'cover' },
      pins: { has: () => false },
      orders: { arrangeAlbum: (f, files, fallback) => fallback(files), albumOn: () => false, hasAlbum: () => false, pinOrder: () => [], arrangePins: (x) => x },
      isFolderNote: () => false,
      folderCoverSrc: () => null,
      feature: () => null,
      registerEvent() {},
      registerDomEvent: (el, type, fn) => el.addEventListener(type, fn),
      register() {},
    };
    const app = {
      workspace: { rootSplit: {}, getMostRecentLeaf: () => leaf, on: () => ({}), getActiveFile: () => file },
      metadataCache: { getFileCache: () => null, on: () => ({}), getFirstLinkpathDest: () => null },
      vault: { getName: () => 'Vault', getResourcePath: () => '' },
    };
    plugin.app = app;
    const cs = new T.ContextStrip(plugin);
    cs.el = document.body.createDiv({ cls: 'dr-strip' });
    return cs;
  };

  await t('the strip names its buttons, so a phone can keep two', () => {
    document.body.innerHTML = '';
    const cs = stripFor();
    cs.update();
    const roles = Array.from(cs.el.querySelectorAll('.dr-strip-actions .dr-strip-btn'))
      .map((b) => b.dataset.action);
    assert.deepStrictEqual(roles, ['mode', 'pin', 'properties', 'more']);
  });

  await t('the strip sits above the bottom bar, at its height and stacking', () => {
    document.body.innerHTML = '';
    const bar = document.body.createDiv({ cls: 'mobile-navbar' });
    bar.style.zIndex = '7';
    bar.getBoundingClientRect = () => ({ top: 700, bottom: 768, height: 68, left: 0, width: 390 });
    const cs = stripFor();
    cs.fitAboveNavbar();
    assert.strictEqual(document.body.style.getPropertyValue('--dr-strip-bottom'), '76px');
    assert.strictEqual(document.body.style.getPropertyValue('--dr-strip-z'), '7');
    bar.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: 0 });
    cs.fitAboveNavbar();
    assert.strictEqual(document.body.style.getPropertyValue('--dr-strip-bottom'), '');
  });

  await t('the strip steps aside while typing, and comes back after', () => {
    document.body.innerHTML = '';
    const cs = stripFor();
    cs.registerPhone();
    const field = document.body.createEl('textarea');
    const button = document.body.createEl('button');
    field.focus();
    assert.ok(document.body.classList.contains('dr-typing'));
    button.focus();
    assert.ok(!document.body.classList.contains('dr-typing'));
  });

  /* -- the properties panel ------------------------------------------------ */

  await t('opened from the strip, the panel sits against the strip, not the corner', () => {
    document.body.innerHTML = '';
    const panel = Object.create(T.PropertiesPanel.prototype);
    panel.popupEl = document.body.createDiv({ cls: 'dr-props-popup' });
    const hidden = document.body.createDiv();
    hidden.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 0, width: 0, height: 0 });
    panel.anchor = document.body.createDiv();
    panel.anchor.getBoundingClientRect = () => ({ left: 500, top: 700, bottom: 738, width: 38, height: 38 });
    panel.place(hidden);
    assert.strictEqual(panel.popupEl.style.bottom, `${window.innerHeight - 700 + 6}px`);
    assert.strictEqual(panel.popupEl.style.top, '');
    phone(true);
    panel.place(hidden);
    assert.strictEqual(panel.popupEl.style.left, '8px', 'not across the phone');
    phone(false);
  });

  fs.unlinkSync(tmp);
  console.log(`\n${passed} passed`);
})().catch((err) => {
  try { fs.unlinkSync(tmp); } catch (e) {}
  console.error(err);
  process.exit(1);
});
