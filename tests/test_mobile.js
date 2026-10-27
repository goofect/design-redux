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
  constructor(el) { this.el = el; this.settingEl = el && el.createDiv ? el.createDiv({ cls: "setting-item" }) : null; this.controlEl = this.settingEl ? this.settingEl.createDiv({ cls: "setting-item-control" }) : null; }
  setName(n) { settingNames.push(n); return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addToggle(cb) { const c = { setValue: () => c, onChange: () => c }; cb(c); return this; }
  addText(cb) { const c = { inputEl: document.createElement('input'), setPlaceholder: () => c, setValue: (v) => ((c.inputEl.value = v), c), getValue: () => c.inputEl.value, onChange: () => c }; cb(c); return this; }
  addDropdown(cb) { const c = { addOption: () => c, setValue: () => c, onChange: () => c }; cb(c); return this; }
  setClass() { return this; }
  addExtraButton(cb) { const b = { setIcon: () => b, setTooltip: (t) => ((b.tip = t), b), setDisabled: () => b, onClick: (f) => ((b.click = f), b) }; cb(b); settingButtons.push(b); return this; }
  addButton(cb) { const b = { setButtonText: (t) => ((b.tip = t), b), onClick: (f) => ((b.click = f), b) }; cb(b); settingButtons.push(b); return this; }
}
const settingButtons = [];
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
  'DesignReduxSettingTab, SETTINGS_TABS, PropertiesPanel, PanelDockView, WorkspaceCoordinator, Selection, drSegmented, drOpenSheet };\n');
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
    assert.ok(settingNames.includes('Ribbon in menu'));

    phone(true);
    settingNames.length = 0;
    tab.display();
    assert.ok(!settingNames.includes('Single content area'));
    assert.ok(settingNames.includes('Context strip and modes'));
    assert.ok(tab.containerEl.querySelector('.dr-settings-note'));
    phone(false);

    // Opened at one setting, from where it shows: its tab, its row marked.
    tab.query = 'single';
    tab.reveal('contextStrip');
    tab.display();
    const row = Array.from(tab.containerEl.querySelectorAll('[data-dr-key]')).find((e) => e.dataset.drKey === 'contextStrip');
    assert.ok(row && row.classList.contains('is-revealed'));
    assert.strictEqual(tab.tab, T.SETTINGS_TABS.find((s) => s.features.some((f) => f.switch === 'contextStrip' || f.keys.includes('contextStrip'))).id);
    assert.strictEqual(tab.query, '', 'a search left in the field would hide it');
  });

  await t('settings: one row a feature, with a switch and a gear; its options open under it, one at a time; presets flip the switches', async () => {
    const p = fakePlugin(Object.assign(settings(), { library: false, contextStrip: false, graphProperties: false }));
    p.saveData = async () => {};
    p.saveSettings = async () => {};
    p.features = [{ settingsSchema: () => [
      { key: 'contextStrip', name: 'Context strip' },
      { key: 'stripDetail', name: 'Strip detail' },
      { key: 'graphProperties', name: 'Graph properties' },
      { key: 'graphRoutes', name: 'Graph routes' },
    ] }];
    const tab = new T.DesignReduxSettingTab(p.app, p);
    tab.tab = 'general';
    tab.display();
    const row = (key) => Array.from(tab.containerEl.querySelectorAll('[data-dr-key]')).find((e) => e.dataset.drKey === key);
    assert.deepStrictEqual(Array.from(tab.containerEl.querySelectorAll('.dr-set-tab')).map((b) => b.textContent), ['General', 'Appearance', 'Library', 'Notes', 'Inspector', 'Maps', 'Advanced'], 'by category, not by part of the code');
    assert.ok(row('contextStrip').closest('.dr-set-feature'), 'the switch is the feature’s own row');
    const more = row('stripDetail').closest('.dr-set-more');
    assert.ok(more && more.classList.contains('is-off') && !more.classList.contains('is-open'), 'a feature that is off has its options out of sight');
    assert.ok(row('graphRoutes').closest('.dr-set-more'), 'options sit under their feature');

    // Search finds an option by its old tab's name and opens the gear that holds it.
    tab.query = 'workspace';
    tab.display();
    assert.ok(row('stripDetail').closest('.dr-set-more').classList.contains('is-open'));
    tab.query = '';
    // And by the tab it had last, before the tabs went by task.
    tab.query = 'tools';
    tab.display();
    assert.ok(row('stripDetail').closest('.dr-set-more').classList.contains('is-open'));
    tab.query = '';

    // A link to an option opens its gear, and it stays open while the page redraws.
    p.settings.contextStrip = true;
    tab.reveal('stripDetail');
    tab.display();
    assert.ok(row('stripDetail').closest('.dr-set-more').classList.contains('is-open'));
    assert.strictEqual(tab.gear, 'strip');
    tab.display();
    assert.ok(row('stripDetail').closest('.dr-set-more').classList.contains('is-open'), 'kept while the page redraws');
    // One gear at a time.
    tab.gear = 'graph';
    tab.display();
    assert.ok(!row('stripDetail').closest('.dr-set-more').classList.contains('is-open'));

    // A preset only flips the switches.
    await tab.applyPreset('minimal');
    assert.strictEqual(p.settings.library, true);
    assert.strictEqual(p.settings.contextStrip, false);
    await tab.applyPreset('everything');
    assert.strictEqual(p.settings.contextStrip, true);
    assert.strictEqual(p.settings.graphProperties, true);
  });

  await t('settings: under the Apple look, a choice marked segmented is a segmented control', async () => {
    const p = fakePlugin(Object.assign(settings(), { library: true, libraryLayout: 'auto' }));
    p.saveData = async () => {};
    p.saveSettings = async () => {};
    p.features = [{ settingsSchema: () => [
      { key: 'library', name: 'Library' },
      { key: 'libraryLayout', type: 'dropdown', segmented: true, name: 'Layout', options: { auto: 'Automatic', covers: 'Covers', lists: 'Lists' } },
    ] }];
    document.body.classList.add('dr-look-apple');
    try {
      const tab = new T.DesignReduxSettingTab(p.app, p);
      tab.tab = 'library';
      tab.gear = 'library';
      tab.display();
      const seg = tab.containerEl.querySelector('.dr-segmented');
      assert.ok(seg, 'drawn as a segmented control');
      assert.deepStrictEqual(Array.from(seg.querySelectorAll('.dr-segment')).map((s) => s.textContent), ['Automatic', 'Covers', 'Lists']);
      assert.strictEqual(seg.querySelector('.is-active').textContent, 'Automatic');
      seg.querySelectorAll('.dr-segment')[1].click();
      assert.strictEqual(p.settings.libraryLayout, 'covers');
    } finally {
      document.body.classList.remove('dr-look-apple');
    }
  });

  await t('the shared controls: a segmented control is a tab list to the keys; a sheet gives focus back only when it had it', () => {
    document.body.innerHTML = '';
    const chosen = [];
    const seg = T.drSegmented(document.body, [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], 'a', (id) => chosen.push(id));
    const segs = Array.from(seg.querySelectorAll('.dr-segment'));
    assert.deepStrictEqual(segs.map((s) => s.getAttribute('role')), ['tab', 'tab', 'tab'], 'tabs, as a screen reader hears them');
    assert.deepStrictEqual(segs.map((s) => s.getAttribute('tabindex')), ['0', '-1', '-1'], 'Tab reaches the chosen one only');
    const key = (k) => seg.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowLeft');
    key('Home');
    key('End');
    key('ArrowRight');
    assert.deepStrictEqual(chosen, ['c', 'a', 'c', 'a'], 'round from either end; Home and End');
    assert.strictEqual(document.activeElement, segs[0]);

    const opener = document.body.createEl('button');
    const other = document.body.createEl('input');
    const sheet = document.body.createDiv();
    const field = sheet.createEl('input');
    let closed = 0;
    let close = T.drOpenSheet(sheet, opener, () => closed++);
    field.focus();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.strictEqual(document.activeElement, opener, 'Escape from inside: back to what opened it');
    close();
    assert.strictEqual(closed, 1, 'closing twice closes once');
    close = T.drOpenSheet(sheet, opener, () => closed++);
    other.focus();
    other.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    assert.ok(closed === 2 && document.activeElement === other, 'a press outside leaves focus where it went');
  });

  await t('settings: the main properties as a list to order, take off and add to by name', () => {
    const p = fakePlugin(settings());
    p.settings.panelPrimaryProps = 'type, domain, status';
    p.saveSettings = () => {};
    p.app.metadataTypeManager = { getAllProperties: () => ({ author: { name: 'author' } }) };
    const panel = new T.PropertiesPanel(p);
    const el = document.createElement('div');
    settingNames.length = 0;
    settingButtons.length = 0;
    panel.renderMainChoice(el);
    assert.deepStrictEqual(settingNames.slice(1, 4), ['type', 'domain', 'status']);
    // domain up, status off.
    settingButtons.filter((b) => b.tip === 'Move up')[1].click();
    assert.strictEqual(p.settings.panelPrimaryProps, 'domain, type, status');
    settingButtons.length = 0;
    settingNames.length = 0;
    panel.renderMainChoice(el);
    settingButtons.filter((b) => b.tip === 'Take off')[2].click();
    assert.strictEqual(p.settings.panelPrimaryProps, 'domain, type');
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

  await t('docked in the sidebar, the panel stays open and follows the note and what the library picks', async () => {
    document.body.innerHTML = '';
    const a = new TFile('Theories/Realism.md');
    const b = new TFile('Theories/Liberalism.md');
    const c = new TFile('Theories/Deterrence.md');
    const noteLeaf = { view: new MarkdownView(a) };
    const panel = Object.create(T.PropertiesPanel.prototype);
    Object.assign(panel, { sections: [], dockView: null, fitted: new WeakMap() });
    panel.popupEl = document.body.createDiv({ cls: 'dr-props-popup' });
    // A note drawn as its path; an album, as the panel draws it.
    panel.mount = function () {
      if (this.shown.kind !== 'note') return T.PropertiesPanel.prototype.mount.call(this);
      this.popupEl.empty();
      this.popupEl.createDiv({ text: this.file.path });
    };
    // Pressed on a computer, the Properties button docks it in the right sidebar.
    const tabs = [];
    const sidebarLeaf = {
      setViewState: async () => {
        sidebarLeaf.view = new T.PanelDockView(sidebarLeaf, panel);
        tabs.push(sidebarLeaf);
        await sidebarLeaf.view.onOpen();
      },
    };
    const ran = [];
    panel.plugin = {
      app: {
        commands: { executeCommandById: (id) => ran.push(id) },
        workspace: {
          getMostRecentLeaf: () => noteLeaf,
          revealLeaf() {},
          getRightLeaf: () => sidebarLeaf,
          getLeavesOfType: (type) => (type === 'design-redux-properties' ? tabs : []),
        },
      },
      folderNote: () => null,
    };
    // What it's about is the coordinator's to say; the panel draws it.
    panel.plugin.selection = new T.Selection(panel.plugin);
    const coordinator = (panel.plugin.coordinator = new T.WorkspaceCoordinator(panel.plugin));
    panel.plugin.register = () => {};
    panel.plugin.selection.onChange((item) => coordinator.pick(item));
    coordinator.onChange((snap) => panel.showSnapshot(snap));
    panel.toggle(noteLeaf, null);
    await new Promise((r) => setTimeout(r));
    const view = sidebarLeaf.view;
    assert.ok(view.contentEl.contains(panel.popupEl), 'in the sidebar');
    assert.ok(panel.isOpen() && panel.popupEl.textContent === a.path, 'the note last worked in');
    // Another note opens: it follows; the sidebar's own leaf and an empty pane leave it be.
    coordinator.look({ view: new MarkdownView(b) });
    assert.strictEqual(panel.popupEl.textContent, b.path);
    coordinator.look(view.leaf);
    coordinator.look({ view: {} });
    assert.strictEqual(panel.popupEl.textContent, b.path);
    // A map says what it's about — its file — and stays the page the node section reads its selection from.
    const map = new TFile('Theories/Map.mindmap');
    const mapLeaf = { view: { panelTarget: () => ({ file: map }) } };
    coordinator.look(mapLeaf);
    assert.ok(panel.popupEl.textContent === map.path && panel.leaf === mapLeaf);
    coordinator.look(view.leaf);
    assert.strictEqual(panel.leaf, mapLeaf, 'working in the inspector keeps the map as its page');
    // A node picked on it: the map draws it, and the line says it's a node.
    const nodeMap = { drawNodeInspector: (p, el, id) => { el.createDiv({ text: `node ${id}` }); return []; } };
    coordinator.look({ view: { panelTarget: () => ({ file: map, node: 'n1', map: nodeMap }) } });
    assert.strictEqual(panel.popupEl.textContent, 'node n1');
    assert.strictEqual(view.contentEl.querySelector('.dr-panel-dock-origin').textContent, 'A node on the map');
    // Picked in the library, without opening.
    panel.plugin.selection.set({ file: c });
    assert.strictEqual(panel.popupEl.textContent, c.path);
    // An album picked: its name, at least, with no page of the library to tell more.
    const album = new TFolder('Theories');
    panel.plugin.selection.set({ folder: album });
    assert.strictEqual(panel.popupEl.querySelector('.dr-inspector-brief').textContent, 'Theories');
    // Why it shows it, above it; pinned, it stays while notes open and picks change; unpinned, it catches up.
    const origin = () => view.contentEl.querySelector('.dr-panel-dock-origin').textContent;
    // The note open, then picked: drawn again, as a pick.
    coordinator.look({ view: new MarkdownView(b) });
    let mounts = 0;
    const mount = panel.mount;
    panel.mount = function () { mounts++; mount.call(this); };
    panel.plugin.selection.set({ file: b });
    assert.ok(mounts === 1 && panel.picked, 'redrawn as picked');
    panel.mount = mount;
    assert.strictEqual(origin(), 'Picked in the library');
    // The line is the pin too: a button, pressed while pinned.
    const originEl = view.contentEl.querySelector('.dr-panel-dock-origin');
    assert.ok(originEl.getAttribute('role') === 'button' && originEl.getAttribute('aria-pressed') === 'false');
    assert.match(originEl.getAttribute('aria-label'), /^Following: Picked in the library\./);
    originEl.click();
    assert.ok(panel.pinned && originEl.classList.contains('is-pinned') && originEl.getAttribute('aria-pressed') === 'true', 'clicked, it pins');
    assert.strictEqual(origin(), 'Pinned · Picked in the library');
    coordinator.look({ view: new MarkdownView(c) });
    panel.plugin.selection.set({ file: a });
    assert.strictEqual(panel.popupEl.textContent, b.path, 'pinned: neither the open note nor a pick moves it');
    panel.togglePin();
    assert.ok(panel.popupEl.textContent === a.path && origin() === 'The open note', 'unpinned: the note last worked in');
    // Deleted, it's let go of, pinned or not.
    panel.togglePin();
    coordinator.forget(a);
    assert.ok(!panel.isOpen() && !panel.pinned && origin() === '');
    // Nothing to show: what to do, and a way to start.
    const empty = view.contentEl.querySelector('.dr-panel-dock-empty');
    assert.ok(!empty.classList.contains('is-hidden'));
    assert.strictEqual(empty.querySelector('.dr-panel-dock-empty-text').textContent, 'Open or pick a note to see its properties.');
    empty.querySelector('.dr-panel-dock-empty-action').click();
    assert.deepStrictEqual(ran, ['design-redux:open-library']);
    // Pinned, or following something else: said once, politely.
    assert.strictEqual(view.contentEl.querySelector('.dr-panel-dock-origin-text').getAttribute('aria-live'), 'polite');
    // Something shown again: the empty state, and its button, gone.
    panel.plugin.selection.set({ file: b });
    assert.ok(empty.classList.contains('is-hidden') && !empty.querySelector('.dr-panel-dock-empty-action'));
    // Closed, it's a popup again.
    panel.undock(view);
    assert.ok(panel.popupEl.parentElement === document.body && !panel.isOpen() && !panel.popupEl.hasClass('is-docked'));
  });

  fs.unlinkSync(tmp);
  console.log(`\n${passed} passed`);
})().catch((err) => {
  try { fs.unlinkSync(tmp); } catch (e) {}
  console.error(err);
  process.exit(1);
});
