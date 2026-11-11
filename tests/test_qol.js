// The quality-of-life additions, against the real main.js: generated
// covers, pins in your own order, scroll kept through history, keys,
// word counts and goals, ordinals as you type, and default hotkeys.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { elementHelpers, loadMain } = require('./harness');

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
elementHelpers(P);
P.isShown = function () { return true; };

const { EditorSelection, EditorState, StateField } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');
const { markdown } = require('@codemirror/lang-markdown');
const { undo, history } = (() => {
  try { return require('@codemirror/commands'); } catch (e) { return {}; }
})();

const menus = [];
const modals = [];
const notices = [];
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = { title: '', disabled: false };
    ['setIcon', 'setChecked', 'setSection', 'setWarning'].forEach((m) => (item[m] = () => item));
    item.setTitle = (v) => { item.title = v; return item; };
    item.setDisabled = (v) => { item.disabled = v; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
  addSeparator() { return this; }
  showAtPosition() { menus.push(this); }
  showAtMouseEvent() { menus.push(this); }
}
class Modal {
  constructor(app) { this.app = app; this.modalEl = document.createElement('div'); this.titleEl = this.modalEl.createDiv(); this.contentEl = this.modalEl.createDiv(); }
  open() { modals.push(this); document.body.appendChild(this.modalEl); this.onOpen(); }
  close() { this.modalEl.remove(); if (this.onClose) this.onClose(); }
}
class Component { registerEvent() {} register() {} registerDomEvent(el, t, f) { el.addEventListener(t, f); } }
class ItemView extends Component {
  constructor(leaf) { super(); this.leaf = leaf; this.containerEl = document.createElement('div'); this.contentEl = this.containerEl.createDiv({ cls: 'view-content' }); }
  async setState() {}
  getEphemeralState() { return {}; }
  setEphemeralState() {}
}
class TAbstractFile {}
class TFile extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p.split('/').pop(); this.extension = this.name.split('.').pop(); this.basename = this.name.replace(/\.[^.]+$/, ''); this.stat = { mtime: 0, ctime: 0 }; }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
class MarkdownView {}
const livePreview = StateField.define({ create: () => true, update: (v) => v });
const platform = { isMobile: false, isPhone: false, isMacOS: false };
const obsidian = new Proxy({
  Menu, Modal, Component, ItemView, TFile, TFolder, TAbstractFile, MarkdownView,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class { constructor(m) { notices.push(m); } },
  Platform: platform,
  editorLivePreviewField: livePreview,
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const R = loadMain(obsidian, 'qol');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const key = (el, k, extra = {}) => el.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* -- generated covers -------------------------------------------------- */

  await t('a cover made from the name: initials, and a colour that stays the same', () => {
    assert.strictEqual(R.initialsOf('Theories of Justice'), 'TJ');
    assert.strictEqual(R.initialsOf('Realism'), 'R');
    assert.strictEqual(R.initialsOf('the_cold-war notes'), 'TC');
    assert.strictEqual(R.initialsOf('état de droit'), 'ÉD');
    assert.strictEqual(R.nameHue('Realism'), R.nameHue('Realism'));
    assert.notStrictEqual(R.nameHue('Realism'), R.nameHue('Liberalism'));
    const el = document.createElement('div');
    R.fillArt(el, null, 'folder', 'Theories of Justice');
    assert.ok(el.classList.contains('is-generated'));
    assert.strictEqual(el.querySelector('.dr-gen-initials').textContent, 'TJ');
    assert.strictEqual(el.style.getPropertyValue('--dr-gen-h'), String(R.nameHue('Theories of Justice')));
    const plain = document.createElement('div');
    R.fillArt(plain, null, 'folder');
    assert.ok(plain.classList.contains('is-blank') && !plain.querySelector('.dr-gen-initials'), 'no name, the glyph as before');
    const pic = document.createElement('div');
    R.fillArt(pic, 'cover.png', 'folder', 'Realism');
    assert.ok(pic.querySelector('img') && !pic.classList.contains('is-generated'), 'a real cover comes first');
  });

  /* -- a browse view over a small vault ---------------------------------- */

  const root = new TFolder('/');
  const mk = (p, parent) => { const f = p.endsWith('.md') ? new TFile(p) : new TFolder(p); f.parent = parent; parent.children.push(f); return f; };
  const ir = mk('IR', root);
  const books = mk('Books', root);
  const a = mk('IR/Anarchy.md', ir);
  const b = mk('IR/Balance.md', ir);
  const c = mk('Books/Crisis.md', books);
  const everything = [ir, books, a, b, c];
  const bookmarks = [{ type: 'file', path: 'IR/Anarchy.md' }, { type: 'folder', path: 'Books' }, { type: 'file', path: 'Books/Crisis.md' }];
  const plugin = {
    settings: JSON.parse(JSON.stringify(R.DEFAULTS)),
    saveData: async () => {},
    isFolderNote: () => false, folderHasNotes: () => true, recentFiles: () => [],
    folderNote: () => null, folderCoverSrc: () => null, feature: () => null,
    refreshBrowse: () => view.render(),
    propertyLabel: (k) => k,
    togglePin() {},
  };
  const app = {
    vault: {
      getRoot: () => root, getName: () => 'Vault', getResourcePath: () => '',
      getMarkdownFiles: () => [a, b, c],
      getFolderByPath: (p) => everything.find((e) => e.path === p && e instanceof TFolder) || null,
      getFileByPath: (p) => everything.find((e) => e.path === p && e instanceof TFile) || null,
      getAbstractFileByPath: (p) => everything.find((e) => e.path === p) || null,
    },
    internalPlugins: { getPluginById: () => ({ enabled: true, instance: { getBookmarks: () => bookmarks } }) },
    workspace: { leftSplit: { expand() {} }, getLeaf: () => ({ openFile() {} }), trigger() {}, getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
  };
  plugin.app = app;
  plugin.pins = new R.Pins(plugin);
  plugin.orders = new R.Orders(plugin);
  const view = new R.BrowseView({ history: { backHistory: [], forwardHistory: [] }, setViewState: async () => {} }, plugin);
  view.app = app;
  document.body.appendChild(view.containerEl);

  await t('tiles without art show their icon by default; the setting gives them generated covers', () => {
    Object.assign(view, { mode: 'folders', path: '/' });
    delete plugin.settings.coverFallback;
    view.render();
    assert.strictEqual(view.contentEl.querySelectorAll('.is-generated').length, 0);
    assert.ok(view.contentEl.querySelectorAll('.dr-card-art.is-blank').length >= 2);
    plugin.settings.coverFallback = 'name';
    view.render();
    assert.ok(view.contentEl.querySelectorAll('.dr-card-art.is-generated').length >= 2);
  });

  await t('a cover can be drawn for its name, the default, or the name set as a title; older settings move on, a choice made stays', () => {
    assert.deepStrictEqual(R.blankLook({ coverFallback: 'art' }, 'Realism'), { art: 'Realism' });
    assert.deepStrictEqual(R.blankLook({ coverFallback: 'art', coverDesigns: { 'IR/Realism.md': 'woods' } }, 'Realism', 'IR/Realism.md'), { art: 'Realism', design: 'woods' });
    const drawn = document.createElement('div');
    R.fillArt(drawn, null, 'file-text', null, { art: 'Balance of power' });
    const again = document.createElement('div');
    R.fillArt(again, null, 'file-text', null, { art: 'Balance of power' });
    assert.ok(drawn.classList.contains('is-drawn') && drawn.querySelector('svg.dr-drawn').children.length > 0);
    assert.strictEqual(drawn.innerHTML, again.innerHTML, 'the same name, the same cover');
    assert.ok(!drawn.querySelector('.dr-card-glyph'));
    const picked = document.createElement('div');
    R.fillArt(picked, null, 'file-text', { name: 'Balance of power', tint: '#30a46c' }, { art: 'Balance of power', design: 'woods' });
    assert.strictEqual(picked.dataset.design, 'woods');
    const retired = document.createElement('div');
    R.fillArt(retired, null, 'file-text', null, { art: 'Balance of power', design: 'pines' });
    assert.strictEqual(retired.dataset.design, drawn.dataset.design, "a design that's gone: the name's own instead");
    assert.ok(/hsl\(151/.test(picked.style.backgroundImage), 'drawn in the colour chosen for it');

    assert.deepStrictEqual(R.blankLook({ coverFallback: 'title' }, 'Realism'), { title: 'Realism' });
    assert.deepStrictEqual(R.blankLook({ coverFallback: 'soft' }, 'Realism'), { hue: 'Realism' });
    assert.strictEqual(R.blankLook({ coverFallback: 'icon' }, 'Realism'), null);
    assert.strictEqual(R.blankLook({ coverFallback: 'title' }, ''), null);

    const el = document.createElement('div');
    R.fillArt(el, null, 'file-text', null, { title: 'Balance of power' });
    assert.ok(el.classList.contains('is-blank') && el.classList.contains('is-titled'));
    assert.strictEqual(el.querySelector('.dr-type-title').textContent, 'Balance of power');
    assert.ok(el.querySelector('.dr-card-glyph'), 'the icon too, for covers too small for a title');

    plugin.settings.coverFallback = 'title';
    Object.assign(view, { mode: 'folders', path: '/' });
    view.render();
    const titled = Array.from(view.contentEl.querySelectorAll('.dr-card-art.is-titled .dr-type-title')).map((e) => e.textContent);
    assert.ok(titled.includes('IR'), 'a folder without a cover shows its name');

    const steps = R.SETTINGS_MIGRATIONS.filter((m) => m.to >= 2).sort((a, b) => a.to - b.to);
    const run = (saved) => {
      steps.forEach((m) => m.run(saved));
      return saved.coverFallback;
    };
    assert.strictEqual(run({}), 'art');
    assert.strictEqual(run({ coverFallback: 'icon' }), 'art');
    assert.strictEqual(run({ coverFallback: 'title' }), 'art');
    assert.strictEqual(run({ coverFallback: 'name' }), 'name');
    assert.strictEqual(run({ coverFallback: 'soft' }), 'soft');
    assert.strictEqual(R.DEFAULTS.coverFallback, 'art');
    assert.strictEqual(R.DEFAULTS.settingsVersion, 30);
    // Step 30: lengths are gone, and their settings with them.
    const s29 = { trackLength: 'words', noteLength: 'time', thinNoteWords: 60, notePage: true };
    R.SETTINGS_MIGRATIONS.find((m) => m.to === 30).run(s29);
    assert.deepStrictEqual(s29, { notePage: true });
    assert.ok(!('trackLength' in R.DEFAULTS) && !('thinNoteWords' in R.DEFAULTS));
    // Step 28: a sidebar in the plugin's own sections is laid out as a music app's; one arranged by hand keeps its shape.
    const layout = R.SETTINGS_MIGRATIONS.find((m) => m.to === 28);
    const built = (id) => ({ kind: 'builtin', id });
    const stock = { librarySections: [
      { title: '', items: [built('search'), built('home'), built('notes'), built('folders'), built('bookmarks')] },
      { title: 'Recent', items: [built('recents')] },
      { title: 'More', folded: true, items: [built('collections'), built('smart'), built('properties'), built('added'), built('graph'), built('settings')] },
      { title: 'Folders', items: [{ kind: 'folder', path: 'IR' }] },
      { title: 'Bases', items: [{ kind: 'file', path: 'Reading.base' }] },
    ] };
    layout.run(stock);
    assert.deepStrictEqual(stock.librarySections.map((s) => [s.title, s.items.map((i) => i.id || i.path)]), [
      ['', ['search', 'home', 'random']],
      ['Library', ['bookmarks', 'added', 'recents', 'folders', 'notes', 'properties']],
      ['Tools', ['graph', 'settings']],
      ['Views', ['collections', 'smart', 'Reading.base']],
      ['Folders', ['IR']],
    ]);
    const mine = { librarySections: [{ title: 'Yours', items: [built('bookmarks'), { kind: 'folder', path: 'IR' }] }] };
    const before = JSON.stringify(mine);
    layout.run(mine);
    assert.strictEqual(JSON.stringify(mine), before);
    // Step 14: the Apple redesign is a Look; the theme's look with Apple notes becomes it, and the old switch goes.
    const step = R.SETTINGS_MIGRATIONS.find((m) => m.to === 14);
    const a = { look: 'theme' }; step.run(a);
    assert.strictEqual(a.look, 'apple');
    const b = { look: 'theme', noteThemeLook: true }; step.run(b);
    assert.deepStrictEqual(b, { look: 'theme' }, 'whoever asked for the theme’s look keeps it');
    const c = { look: 'editorial', noteThemeLook: false }; step.run(c);
    assert.deepStrictEqual(c, { look: 'editorial' });
    assert.strictEqual(R.DEFAULTS.look, 'apple');
    // Step 15: Apple's look covers notes too, whatever scope the editorial look was given.
    const scope = R.SETTINGS_MIGRATIONS.find((m) => m.to === 15);
    const d = { look: 'apple', lookScope: 'plugin' }; scope.run(d);
    assert.strictEqual(d.lookScope, 'window');
    const e = { look: 'editorial', lookScope: 'plugin' }; scope.run(e);
    assert.strictEqual(e.lookScope, 'plugin', 'the editorial look keeps its scope');
    // Step 16: the strip is off to begin with; whoever had the plugin keeps it on unless they'd said.
    const strip = R.SETTINGS_MIGRATIONS.find((m) => m.to === 16);
    const f = { look: 'apple' }; strip.run(f, { existing: true });
    assert.ok(f.contextStrip === true && f.settingsInHeader === true && f.lookScope === 'window' && f.hideNativeProperties === true);
    const off = { propertiesDropdown: false }; strip.run(off, { existing: true });
    assert.strictEqual(off.hideNativeProperties, false, 'the panel off hid nothing, so nothing is hidden');
    const g = { contextStrip: false }; strip.run(g, { existing: true });
    assert.strictEqual(g.contextStrip, false);
    // Step 9 leaves a first install's Relationships on.
    const rel = {}; R.SETTINGS_MIGRATIONS.find((m) => m.to === 9).run(rel, { existing: false });
    assert.ok(!('panelRelationships' in rel));
    // Step 25: a vault back from the plain names and the one Clear look; what it had set stays.
    const s25 = { look: 'clear', motion: 'off', hideRightSidebar: true, pinsLarge: true, showCovers: false, collectionColumns: 'status', smartCollectionList: [{ id: 'a' }], noteLength: 'words', notePage: true };
    R.SETTINGS_MIGRATIONS.find((m) => m.to === 25).run(s25);
    // noteLength is no longer renamed to trackLength: step 29 drops both.
    assert.deepStrictEqual(s25, { notePage: true, albumColumns: 'status', smartAlbumList: [{ id: 'a' }], noteLength: 'words' });
    const apple = { look: 'apple', albumColumns: 'status' };
    R.SETTINGS_MIGRATIONS.find((m) => m.to === 25).run(apple);
    assert.deepStrictEqual(apple, { look: 'apple', albumColumns: 'status' }, 'a vault on 3.0.25 keeps what it has');
    // Step 26: maps, due dates, modes, reading history, the outline, Study, relationships and quiet links go, and their places.
    const s26 = { mindmaps: true, mindmapLegend: true, workspaceModes: true, workspaceMode: 'study', readingHistory: true, readingLog: { 'a.md': {} }, studyEnabled: true, fromReadingDays: 14, rememberPlace: true,
      propertyDueChips: true, propertyDueKeys: 'due', albumRecents: true, albumProgressRing: true, propertyValueView: 'grid', libraryLayout: 'covers', knowledge: true, knowledgeCheck: true, knowledgeMeant: {}, knowledgeBroader: 'concept', panelRelationships: true, canvasRelationTypes: [], canvasRelationNames: '', readingOutline: true, outlineWordCounts: true, stripProgress: true, quietLinks: true, notePage: true,
      smartAlbumList: [{ id: 'd', prop: { key: 'due', value: null, negate: false, due: true } }, { id: 'k', prop: { key: 'status', value: 'x' } }],
      librarySections: [{ title: 'More', items: [{ kind: 'builtin', id: 'read' }, { kind: 'builtin', id: 'added' }, { kind: 'builtin', id: 'highlights' }, { kind: 'builtin', id: 'knowledge-check' }] }],
      homeShelves: [{ id: 'continue', on: true }, { id: 'recents', on: true }], keepOwnOrder: { read: true, pinned: true } };
    R.SETTINGS_MIGRATIONS.find((m) => m.to === 26).run(s26);
    assert.deepStrictEqual(Object.keys(s26).sort(), ['homeShelves', 'keepOwnOrder', 'libraryLayout', 'librarySections', 'notePage', 'smartAlbumList']);
    assert.strictEqual(s26.libraryLayout, 'auto', 'notes are no longer covers');
    assert.deepStrictEqual(s26.smartAlbumList.map((a) => a.id), ['k'], 'the saved view of what’s due goes');
    assert.deepStrictEqual(s26.librarySections[0].items, [{ kind: 'builtin', id: 'added' }]);
    assert.deepStrictEqual(s26.homeShelves, [{ id: 'recents', on: true }]);
    assert.deepStrictEqual(s26.keepOwnOrder, { pinned: true });
    const h = {}; strip.run(h, { existing: false });
    assert.ok(!('contextStrip' in h) && R.DEFAULTS.contextStrip === false && R.DEFAULTS.settingsInHeader === false && R.DEFAULTS.lookScope === 'plugin', 'a first install starts without them, its notes as the theme draws them');
  });

  /* -- pins in your own order ------------------------------------------------ */

  const pinnedNames = () => Array.from(view.contentEl.querySelectorAll('.dr-card .dr-card-title')).map((e) => e.textContent);

  await t('pins keep the order you put them in, folders and notes mixed, everywhere they show', () => {
    Object.assign(view, { mode: 'pinned' });
    view.render();
    assert.deepStrictEqual(pinnedNames(), ['Books', 'Anarchy', 'Crisis'], 'folders lead before any arranging');
    view.arrangePin('Books/Crisis.md', 'Books');
    assert.deepStrictEqual(pinnedNames(), ['Crisis', 'Books', 'Anarchy']);
    assert.deepStrictEqual(plugin.pins.files().map((f) => f.basename), ['Crisis', 'Anarchy'], 'Home and the sidebar see it too');
    assert.deepStrictEqual(plugin.pins.all().map((f) => f.name), ['Crisis.md', 'Books', 'Anarchy.md']);
  });

  await t('Move earlier and later in a pin’s menu; unavailable at the ends', () => {
    view.render();
    const card = view.contentEl.querySelector('.dr-card[data-path="IR/Anarchy.md"]');
    card.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    const items = Object.fromEntries(menus.pop().items.map((i) => [i.title, i]));
    assert.strictEqual(items['Move later'].disabled, true);
    items['Move earlier'].click();
    assert.deepStrictEqual(pinnedNames(), ['Crisis', 'Anarchy', 'Books']);
  });

  await t('a pin moved by dragging, or with Alt+arrows', () => {
    view.render();
    const grid = view.contentEl.querySelector('.dr-grid');
    const cardOf = (p) => grid.querySelector(`.dr-card[data-path="${p}"]`);
    const books = cardOf('Books');
    books.dispatchEvent(Object.assign(new window.Event('dragstart', { bubbles: true }), { dataTransfer: { setData() {} } }));
    const target = cardOf('Books/Crisis.md');
    target.getBoundingClientRect = () => ({ left: 0, width: 100 });
    const over = Object.assign(new window.Event('dragover', { bubbles: true, cancelable: true }), { clientX: 10 });
    target.dispatchEvent(over);
    assert.ok(target.classList.contains('is-drop-before'));
    target.dispatchEvent(Object.assign(new window.Event('drop', { bubbles: true, cancelable: true }), { clientX: 10 }));
    assert.deepStrictEqual(pinnedNames(), ['Books', 'Crisis', 'Anarchy']);
    key(view.contentEl.querySelector('.dr-card[data-path="IR/Anarchy.md"]'), 'ArrowLeft', { altKey: true });
    assert.deepStrictEqual(pinnedNames(), ['Books', 'Anarchy', 'Crisis']);
    assert.strictEqual(document.activeElement.dataset.path, 'IR/Anarchy.md', 'focus stayed with the tile');
  });

  await t('arranged pins follow a rename and forget a deletion', () => {
    plugin.orders.followRename(Object.assign(Object.create(TFile.prototype), { path: 'Books/Crisis 2.md' }), 'Books/Crisis.md');
    assert.ok(plugin.settings.pinOrder.includes('Books/Crisis 2.md'));
    plugin.orders.followRename(Object.assign(Object.create(TFolder.prototype), { path: 'Library' }), 'Books');
    assert.ok(plugin.settings.pinOrder.includes('Library') && plugin.settings.pinOrder.includes('Library/Crisis 2.md'));
    plugin.orders.followDelete(Object.assign(Object.create(TFolder.prototype), { path: 'Library' }));
    assert.deepStrictEqual(plugin.settings.pinOrder, ['IR/Anarchy.md']);
  });

  /* -- keys ----------------------------------------------------------------- */

  await t('"/" jumps to Find from anywhere on the page, but types in a field', () => {
    plugin.settings.pinOrder = [];
    Object.assign(view, { mode: 'folder', path: 'IR' });
    view.render();
    view.onOpen && view.registerDomEvent(view.containerEl, 'keydown', (evt) => view.onKey(evt));
    const row = view.contentEl.querySelector('.dr-track');
    row.focus();
    key(row, '/');
    const find = view.contentEl.querySelector('.dr-browse-search input');
    assert.strictEqual(document.activeElement, find);
    const typed = key(find, '/');
    assert.strictEqual(typed, true, '"/" was taken from the field');
  });

  await t('Escape in Find clears what was typed, then leaves the field', async () => {
    const find = view.contentEl.querySelector('.dr-browse-search input');
    find.value = 'bal';
    find.dispatchEvent(new window.Event('input'));
    await settle(120);
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-track').length, 1);
    key(find, 'Escape');
    assert.strictEqual(view.query, '');
    assert.strictEqual(find.value, '');
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-track').length, 2);
    key(find, 'Escape');
    assert.notStrictEqual(document.activeElement, find);
  });

  await t('arrows move through tiles by the item and by the row', () => {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const cards = [];
    for (let i = 0; i < 7; i++) {
      const card = grid.createDiv({ cls: 'dr-card' });
      card.tabIndex = 0;
      Object.defineProperty(card, 'offsetTop', { value: Math.floor(i / 3) * 100 });
      Object.defineProperty(card, 'offsetWidth', { value: 90 });
      cards.push(card);
    }
    R.roveFocus(grid, '.dr-card');
    cards[1].focus();
    key(cards[1], 'ArrowRight');
    assert.strictEqual(document.activeElement, cards[2]);
    key(cards[2], 'ArrowDown');
    assert.strictEqual(document.activeElement, cards[5]);
    key(cards[5], 'ArrowDown');
    assert.strictEqual(document.activeElement, cards[5], 'no row below the end of the last');
    key(cards[5], 'ArrowUp');
    key(cards[2], 'ArrowLeft');
    assert.strictEqual(document.activeElement, cards[1]);
    // A list leaves left and right alone, for the rows that use them.
    const list = document.createElement('div');
    document.body.appendChild(list);
    const rows = [0, 1].map(() => { const r = list.createDiv({ cls: 'row' }); r.tabIndex = 0; return r; });
    R.roveFocus(list, '.row');
    rows[0].focus();
    const ev = new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    rows[0].dispatchEvent(ev);
    assert.strictEqual(ev.defaultPrevented, false);
    key(rows[0], 'ArrowDown');
    assert.strictEqual(document.activeElement, rows[1]);
  });

  /* -- scroll through history -------------------------------------------------- */

  await t('back returns to where the page was scrolled to', async () => {
    Object.defineProperty(view.contentEl, 'scrollTop', { writable: true, value: 0 });
    view.contentEl.scrollTop = 420;
    const saved = view.getEphemeralState();
    assert.strictEqual(saved.scroll, 420);
    view.contentEl.scrollTop = 0;
    view.setEphemeralState(saved);
    assert.strictEqual(view.contentEl.scrollTop, 420);
    view.setEphemeralState({});
    assert.strictEqual(view.contentEl.scrollTop, 420, 'an entry without a scroll moved the page');
  });

  /* -- words ------------------------------------------------------------------ */

  await t('cover colours: own, accent or one for all; pale ones get dark initials; they follow a rename', async () => {
    const st = { coverFallback: 'icon', generatedCoverColor: '#fa2d48', coverColors: { 'A/B': '#F5C518' } };
    assert.strictEqual(R.coverGen(st, 'X', 'X'), null, 'the icon by default');
    st.coverFallback = 'name';
    assert.strictEqual(R.coverTint(st, 'X'), null);
    assert.strictEqual(R.coverTint(st, 'A/B'), '#f5c518');
    const el = document.createElement('div');
    R.fillArt(el, null, 'x', R.coverGen(st, 'Bee', 'A/B'));
    assert.ok(el.classList.contains('is-tinted') && el.classList.contains('is-light'));
    assert.strictEqual(el.style.getPropertyValue('--dr-gen-h'), '47');
    st.coverFallback = 'accent';
    assert.strictEqual(R.coverTint(st, 'X'), 'accent');
    st.coverFallback = 'custom';
    assert.strictEqual(R.coverTint(st, 'X'), '#fa2d48');
    assert.ok(R.coverGen(Object.assign({}, st, { coverFallback: 'icon' }), 'Bee', 'A/B'), 'its own colour whatever the default');
    const plugin = { settings: { coverColors: { 'A/B': '#123456', 'A/B/c.md': 'accent', Z: '#000000' } }, saveData() {}, saveSettings() {} };
    const orders = new R.Orders(plugin);
    orders.followRename({ path: 'Q/B', name: 'B' }, 'A/B');
    assert.deepStrictEqual(Object.keys(plugin.settings.coverColors).sort(), ['Q/B', 'Q/B/c.md', 'Z']);
    orders.followDelete({ path: 'Q/B', name: 'B' });
    assert.deepStrictEqual(Object.keys(plugin.settings.coverColors), ['Z']);
  });

  await t('ordinals: only real ones, written plainly', () => {
    assert.deepStrictEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(R.ordinalSuffix),
      ['st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'st', 'nd', 'rd', 'st', 'th', 'th']);
    assert.ok(R.ordinalBefore('the 21st'));
    assert.strictEqual(R.ordinalBefore('the 21th'), null);
    assert.strictEqual(R.ordinalBefore('a1st'), null, 'part of a word');
    assert.strictEqual(R.ordinalBefore('1^st'), null, 'already raised');
    assert.strictEqual(R.ordinalBefore('1ST'), null);
  });

  const typing = (doc, html = false) => {
    const parent = document.body.appendChild(document.createElement('div'));
    const exts = [markdown(), livePreview.init(() => false), R.ordinalInput(() => html)];
    if (history) exts.push(history());
    const v = new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: exts }) });
    const type = (ch) => {
      const at = v.state.selection.main.head;
      const handled = v.state.facet(EditorView.inputHandler).some((h) => h(v, at, at, ch, () => v.state.update({ changes: { from: at, insert: ch } })));
      if (!handled) v.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
    };
    return { v, type };
  };

  await t('typing a space or full stop after 1st raises it', () => {
    const { v, type } = typing('She came 1st');
    type(' ');
    assert.strictEqual(v.state.doc.toString(), 'She came 1^st^ ');
    assert.strictEqual(v.state.selection.main.head, v.state.doc.length, 'the cursor stayed before the space');
    const h = typing('the 22nd', true);
    h.type('.');
    assert.strictEqual(h.v.state.doc.toString(), 'the 22<sup>nd</sup>.');
    const n = typing('a 5rd');
    n.type(' ');
    assert.strictEqual(n.v.state.doc.toString(), 'a 5rd ', 'a wrong suffix was raised');
    const code = typing('`1st');
    code.type(' ');
    assert.strictEqual(code.v.state.doc.toString(), '`1st ');
    v.destroy(); h.v.destroy(); n.v.destroy(); code.v.destroy();
  });

  await t('undo straight after takes the raising back, and leaves what was typed', () => {
    if (!undo) return;
    const { v, type } = typing('came 3rd');
    type(' ');
    assert.strictEqual(v.state.doc.toString(), 'came 3^rd^ ');
    undo(v);
    assert.strictEqual(v.state.doc.toString(), 'came 3rd ');
    v.destroy();
  });

  await t('the setting brings the ordinals in and out of editors', () => {
    const settings = JSON.parse(JSON.stringify(R.DEFAULTS));
    let updated = 0;
    const f = new R.Scripts({ settings, app: { workspace: { updateOptions: () => updated++, iterateAllLeaves() {} } } });
    f.apply(true);
    assert.strictEqual(f.extensions.length, 1, 'ordinals on by default');
    settings.autoOrdinals = true;
    f.apply(true);
    assert.strictEqual(f.extensions.length, 2);
    f.apply(true);
    assert.strictEqual(updated, 2, 'rebuilt without a change');
    f.apply(false);
    assert.strictEqual(f.extensions.length, 0);
  });

  /* -- hotkeys --------------------------------------------------------------------- */

  await t("default hotkeys that don't clash: Pages' own on a Mac, Alt elsewhere", () => {
    platform.isMacOS = true;
    assert.deepStrictEqual(R.scriptHotkeys('sup'), [{ modifiers: ['Mod', 'Ctrl'], key: '=' }]);
    assert.deepStrictEqual(R.scriptHotkeys('sub'), [{ modifiers: ['Mod', 'Ctrl'], key: '-' }]);
    platform.isMacOS = false;
    assert.deepStrictEqual(R.scriptHotkeys('sup'), [{ modifiers: ['Alt'], key: '=' }]);
    const cmds = new R.Scripts({ settings: {} }).commands();
    assert.ok(cmds.every((c) => Array.isArray(c.hotkeys) && c.hotkeys.length === 1));
  });

  await t('every settings row sits in a named group, and every row has a default', () => {
    // The sources as written: main.js is esbuild's reprint of them.
    const srcDir = path.join(__dirname, '..', 'src');
    const src = fs.readdirSync(srcDir).filter((d) => fs.statSync(path.join(srcDir, d)).isDirectory())
      .map((d) => fs.readdirSync(path.join(srcDir, d)).sort().map((f) => fs.readFileSync(path.join(srcDir, d, f), 'utf8')).join(''))
      .join('');
    const keys = [];
    let at = 0;
    while ((at = src.indexOf('settingsSchema() {', at)) !== -1) {
      const end = src.indexOf('\n  }\n', at);
      const body = src.slice(at, end);
      (body.match(/group: '([^']+)'/g) || []).forEach((m) => {
        const title = m.slice(8, -1);
        throw new Error('rows are placed by SETTINGS_TABS, not by group: ' + title);
      });
      (body.match(/^\s+key: '(\w+)',/gm) || []).forEach((m) => keys.push(m.trim().slice(6, -2)));
      at = end;
    }
    assert.ok(keys.length > 20, 'found ' + keys.length + ' rows');
    const grouped = [].concat(...R.SETTINGS_TABS.map((tab) => [].concat(...tab.features.map((feature) => R.featureKeys(feature))))).concat(R.LOOK_KEYS);
    const dup = grouped.filter((k, i) => grouped.indexOf(k) !== i);
    assert.deepStrictEqual(dup, [], 'a key under two rows: ' + dup.join(', '));
    const loose = keys.filter((k) => grouped.indexOf(k) === -1);
    assert.deepStrictEqual(loose, [], 'rows falling into "Other": ' + loose.join(', '));
    ['coverFallback', 'generatedCoverColor', 'autoOrdinals'].forEach((k) => {
      assert.ok(keys.indexOf(k) !== -1, k + ' has a row');
      assert.ok(k in R.DEFAULTS, k + ' has a default');
    });
  });

  await t('pages: markers found outside code fences; the others\' text and every marker hidden; a second page added; a note round-trips', () => {
    const text = '---\nfoo: 1\n---\nIntro\n%%page: A%%\nalpha\n\n```\n%%page: fake%%\n```\n%%page: B%%\nbeta\n';
    const pages = R.parsePages(text);
    assert.deepStrictEqual(pages.map((p) => p.name), ['A', 'B'], 'a marker in a code fence is not one');
    assert.strictEqual(text.slice(pages[1].from, pages[1].to), 'beta\n');
    // The text before the first marker belongs to the first page.
    assert.deepStrictEqual(R.hiddenRanges(text, 'A').map(([a, b]) => text.slice(a, b)), ['%%page: A%%\n', '%%page: B%%\n', 'beta\n']);
    // A marker the cursor is on is shown, to be edited.
    assert.deepStrictEqual(R.hiddenRanges(text, 'A', [pages[1].marker[0] + 3]).map(([a, b]) => text.slice(a, b)), ['%%page: A%%\n', 'beta\n']);
    assert.deepStrictEqual(R.hiddenRanges(text, 'B').map(([a, b]) => text.slice(a, b)), ['Intro', '%%page: A%%\n', 'alpha\n\n```\n%%page: fake%%\n```', '%%page: B%%\n']);
    assert.deepStrictEqual(R.hiddenRanges('plain note\n', 'A'), [], 'nothing is added to a plain note');
    assert.strictEqual(R.openPage(pages, 'nope').name, 'A', 'an unknown page opens the first');
    // A plain note gets a marker above its text, named Page 1, and one for the new page.
    const plain = '---\nx: 1\n---\nHello\n';
    const two = R.withPageAdded(plain, 'Untitled 2');
    assert.strictEqual(two, '---\nx: 1\n---\n%%page: Untitled%%\nHello\n\n%%page: Untitled 2%%\n', 'named from the first heading, else Untitled');
    assert.strictEqual(R.withPageAdded('# Overview\nHi\n', 'Untitled'), '%%page: Overview%%\n# Overview\nHi\n\n%%page: Untitled%%\n');
    assert.strictEqual(R.newPageName(R.parsePages(two)), 'Untitled 3');
    // Take the markers away and it is one plain page again, unchanged.
    assert.strictEqual(R.withPageRemoved(R.withPageRemoved(two, 'Untitled 2'), 'Untitled').trim(), plain.trim());
    assert.strictEqual(R.withPageRenamed(two, 'Untitled 2', 'Sources'), two.replace('Untitled 2', 'Sources'));
    const moved = R.withPageMoved(two, 'Untitled 2', -1);
    assert.deepStrictEqual(R.parsePages(moved).map((p) => p.name), ['Untitled 2', 'Untitled']);
    assert.ok(moved.includes('Hello'));
    assert.strictEqual(R.withPageMoved(two, 'Untitled', -1), two, 'the first cannot go earlier');
    assert.ok('pagesOpen' in R.DEFAULTS && 'notePages' in R.DEFAULTS);
  });

  // An editor with pages, in Live Preview, the page open told as the plugin tells it.
  const paged = (doc, open) => {
    const parent = document.body.appendChild(document.createElement('div'));
    const heard = [];
    const ext = R.pagesExtension((view, name) => heard.push(name));
    const v = new EditorView({ parent, state: EditorState.create({ doc, extensions: [markdown(), livePreview.init(() => true), EditorState.allowMultipleSelections.of(true), ext, history ? history() : []] }) });
    if (open) v.dispatch({ effects: R.setOpenPage.of(open) });
    const field = () => v.state.field(ext[0]);
    const hidden = () => {
      const out = [];
      field().deco.between(0, v.state.doc.length, (a, b) => { out.push([a, b]); });
      return out.sort((x, y) => x[0] - y[0]);
    };
    const type = (ch) => {
      const at = v.state.selection.main.head;
      v.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + ch.length }, userEvent: 'input.type' });
    };
    return { v, heard, field, hidden, type };
  };
  const PAGED = 'Intro\n%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n';

  await t('pages: the cursor put on a hidden page (undo, a jump) opens it; by hand it stays on the page, and select all takes just the page', () => {
    const e = paged(PAGED, 'B');
    const pages = R.parsePages(PAGED);
    assert.strictEqual(R.pageAt(pages, e.v.state.selection.main.head), 1, 'choosing a page takes the cursor to it');
    e.type('x');
    e.v.dispatch({ effects: R.setOpenPage.of('A') });
    assert.strictEqual(e.field().open, 'A');
    if (undo) {
      undo(e.v);
      assert.strictEqual(e.v.state.doc.toString(), PAGED);
      assert.strictEqual(e.field().open, 'B', 'undo went to page B: B opens');
      assert.deepStrictEqual(e.heard, ['B'], 'and the plugin hears of it');
    }
    // A jump (a link, a stale place): no user event.
    e.v.dispatch({ selection: { anchor: PAGED.indexOf('alpha') + 2 } });
    assert.strictEqual(e.field().open, 'A');
    assert.deepStrictEqual(e.hidden(), R.hiddenRanges(PAGED, 'A', [e.v.state.selection.main.head]));
    // By hand: a click at the end of the note, Ctrl+End, select all.
    const a = pages[0];
    e.v.dispatch({ selection: { anchor: PAGED.length }, userEvent: 'select.pointer' });
    assert.strictEqual(e.v.state.selection.main.head, a.to, 'kept to the page');
    assert.strictEqual(e.field().open, 'A');
    e.v.dispatch({ selection: { anchor: 0, head: PAGED.length }, userEvent: 'select' });
    assert.deepStrictEqual([e.v.state.selection.main.from, e.v.state.selection.main.to], [a.from, a.to], 'select all is the page');
    e.v.dispatch(e.v.state.replaceSelection(''));
    assert.deepStrictEqual(R.parsePages(e.v.state.doc.toString()).map((p) => p.name), ['A', 'B'], 'Backspace after select all leaves the other pages');
    assert.ok(e.v.state.doc.toString().includes('beta'));
  });

  await t('pages: a name with %% or a line break is cleaned before it goes in a marker', () => {
    assert.strictEqual(R.pageMarker('a%%b\nc'), '%%page: a b c%%');
    assert.strictEqual(R.cleanPageName(' %%\r\n '), 'Untitled', 'nothing left: the default');
    const text = '%%page: A%%\nalpha\n%%page: B%%\nbeta\n';
    const renamed = R.withPageRenamed(text, 'B', 'x%%\ny');
    assert.deepStrictEqual(R.parsePages(renamed).map((p) => p.name), ['A', 'x y']);
    assert.ok(renamed.endsWith('beta\n'), 'the rest of the note is as it was');
    assert.deepStrictEqual(R.parsePages(R.withPageAdded(text, '%%\n')).map((p) => p.name), ['A', 'B', 'Untitled']);
  });

  await t('pages: two markers of one name are two pages, each reached by its own name', () => {
    const text = '%%page: A%%\none\n%%page: A%%\ntwo\n%%page:%%\nthree\n%%page: Untitled%%\nfour\n';
    const pages = R.parsePages(text);
    assert.deepStrictEqual(pages.map((p) => p.name), ['A', 'A 2', 'Untitled', 'Untitled 2']);
    assert.strictEqual(R.openPage(pages, 'A 2'), pages[1]);
    const shown = (open) => {
      const hide = R.hiddenRanges(text, open);
      return ['one', 'two', 'three', 'four'].filter((w) => !hide.some(([a, b]) => text.indexOf(w) >= a && text.indexOf(w) < b));
    };
    assert.deepStrictEqual(shown('A 2'), ['two']);
    assert.deepStrictEqual(shown('Untitled 2'), ['four']);
    const gone = R.withPageRemoved(text, 'A 2');
    assert.ok(gone.includes('one') && !gone.includes('two'));
    assert.deepStrictEqual(R.parsePages(R.withPageRenamed(text, 'A 2', 'B')).map((p) => p.name), ['A', 'B', 'Untitled', 'Untitled 2']);
  });

  await t('pages: the text before the first marker stays first when pages move', () => {
    const text = '---\nx: 1\n---\nIntro\n%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n';
    assert.strictEqual(R.withPageMoved(text, 'B', -1), '---\nx: 1\n---\nIntro\n%%page: B%%\nbeta\n\n%%page: A%%\nalpha\n');
    assert.strictEqual(R.withPageMoved(text, 'A', 1), R.withPageMoved(text, 'B', -1));
  });

  await t('pages: as you type, the note is read again only when a marker or a fence is touched', () => {
    const counts = {};
    const run = (label, doc, open, at) => {
      const e = paged(doc, open);
      e.v.dispatch({ selection: { anchor: at } });
      const before = R.pageStats.parses;
      for (let i = 0; i < 100; i++) {
        if (i % 10 === 9) e.v.dispatch({ selection: { anchor: e.v.state.selection.main.head - 1 }, userEvent: 'select' });
        else e.type('x');
      }
      counts[label] = R.pageStats.parses - before;
      return e;
    };
    run('plain', 'Just a note\nwith two lines\n', null, 4);
    const e = run('marked', PAGED, 'A', PAGED.indexOf('alpha') + 2);
    assert.deepStrictEqual(counts, { plain: 0, marked: 0 });
    // What's hidden is still right, moved along with the text.
    const doc = e.v.state.doc.toString();
    assert.deepStrictEqual(e.hidden(), R.hiddenRanges(doc, 'A', [e.v.state.selection.main.head]));
    assert.deepStrictEqual(e.field().pages, R.parsePages(doc));
    // Writing a marker is read: a page more.
    e.v.dispatch({ effects: R.setOpenPage.of('B') });
    e.v.dispatch({ selection: { anchor: doc.length } });
    '%%page: C%%\n'.split('').forEach((ch) => e.type(ch));
    assert.deepStrictEqual(e.field().pages.map((p) => p.name), ['A', 'B', 'C']);
    // The cursor on a marker shows it.
    const m = e.field().pages[1].marker[0] + 2;
    e.v.dispatch({ selection: { anchor: m } });
    assert.deepStrictEqual(e.hidden(), R.hiddenRanges(e.v.state.doc.toString(), e.field().open, [m]));
  });

  await t('pages: choosing a page takes the cursor onto it with its marker still out of sight', () => {
    const doc = '%%page: A%%\nalpha\n\n%%page: B%%\nbeta text\n\n%%page: C%%\n\ngamma\n';
    const e = paged(doc, 'A');
    e.v.dispatch({ selection: { anchor: doc.indexOf('alpha') + 2 } });
    const markerShown = (name) => {
      const p = e.field().pages.find((x) => x.name === name);
      return !e.hidden().some(([a, b]) => a === p.marker[0] && b >= p.marker[1]);
    };
    e.v.dispatch({ effects: R.setOpenPage.of('B') });
    assert.strictEqual(e.field().open, 'B');
    assert.strictEqual(R.pageAt(e.field().pages, e.v.state.selection.main.head), 1, 'the cursor is on B');
    assert.strictEqual(markerShown('B'), false, "B's marker stays hidden");
    // A page whose first line is blank.
    e.v.dispatch({ effects: R.setOpenPage.of('C') });
    assert.strictEqual(R.pageAt(e.field().pages, e.v.state.selection.main.head), 2, 'the cursor is on C');
    assert.strictEqual(markerShown('C'), false, "C's marker stays hidden");
    // The cursor on the marker's own line still shows it.
    const c = e.field().pages[2].marker[0] + 3;
    e.v.dispatch({ selection: { anchor: c } });
    assert.strictEqual(markerShown('C'), true, 'on its line, the marker shows');
  });

  await t('pages: a page just added, with nothing on it yet, keeps its marker out of sight', () => {
    const doc = R.withPageAdded('%%page: A%%\nalpha\n', 'Untitled');
    const e = paged(doc, 'A');
    e.v.dispatch({ effects: R.setOpenPage.of('Untitled') });
    const p = e.field().pages.find((x) => x.name === 'Untitled');
    assert.strictEqual(p.to, p.from, 'the new page is empty');
    assert.ok(e.hidden().some(([a, b]) => a === p.marker[0] && b >= p.marker[1]), "the new page's marker stays hidden");
  });

  await t('pages: several cursors keep to the page shown; a selection of the whole note with no user event takes just the page', () => {
    const doc = 'Intro\n%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n\n%%page: C%%\ngamma\n';
    const e = paged(doc, 'A');
    const at = (w) => doc.indexOf(w) + 1;
    // Add the next occurrence (search-tagged): the main cursor on B opens B; the one left on A goes.
    e.v.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(at('alpha')), EditorSelection.cursor(at('beta'))], 1), userEvent: 'select.search' });
    assert.strictEqual(e.field().open, 'B');
    assert.deepStrictEqual(e.v.state.selection.ranges.map((r) => r.head), [at('beta')]);
    // A range across pages beside one on the page: the first kept to the page, the second as it was.
    e.v.dispatch({ selection: EditorSelection.create([EditorSelection.range(at('alpha'), at('gamma')), EditorSelection.cursor(at('beta') + 2)], 1) });
    assert.strictEqual(e.field().open, 'B');
    const b = e.field().pages[1];
    e.v.state.selection.ranges.forEach((r) => assert.ok(r.from >= b.from && r.to <= b.to, 'on B: ' + JSON.stringify(r)));
    // A vim V G d: the whole note, no user event: kept to B, and deleting it leaves A and C.
    e.v.dispatch({ selection: { anchor: 0, head: doc.length } });
    assert.strictEqual(e.field().open, 'B');
    assert.deepStrictEqual([e.v.state.selection.main.from, e.v.state.selection.main.to], [b.from, b.to]);
    e.v.dispatch(e.v.state.replaceSelection(''));
    const left = e.v.state.doc.toString();
    assert.ok(left.includes('alpha') && left.includes('gamma') && !left.includes('beta'), left);
    assert.deepStrictEqual(R.parsePages(left).map((p) => p.name), ['A', 'B', 'C']);
  });

  // The feature drawn into a stand-in note view, on the real editor.
  const pagedNote = (doc, open) => {
    const settings = { notePages: true, pagesOpen: { 'n.md': open } };
    const leaves = [];
    const saves = { data: 0, settings: 0 };
    const plugin = { settings, app: { workspace: { getLeavesOfType: () => leaves } }, notes: { get: () => ({}) }, saveData: async () => saves.data++, saveSettings: async () => saves.settings++ };
    const f = new R.NotePages(plugin);
    f.extensions = [R.pagesExtension((cm, name) => f.follow(cm, name))];
    const parent = document.body.appendChild(document.createElement('div'));
    const v = new EditorView({ parent, state: EditorState.create({ doc, extensions: [markdown(), livePreview.init(() => true), f.extensions] }) });
    const view = { file: new TFile('n.md'), containerEl: document.body.appendChild(document.createElement('div')), editor: { cm: v, getValue: () => v.state.doc.toString() } };
    leaves.push({ view });
    const go = (name) => {
      settings.pagesOpen['n.md'] = name;
      f.draw(view);
    };
    f.draw(view);
    return { f, v, view, go, saves, settings, field: () => v.state.field(f.extensions[0][0]) };
  };
  const later = (ms) => new Promise((done) => setTimeout(done, ms));

  await t('pages: a page keeps its cursor while another is open, and a quick second step is not undone by the first', async () => {
    const doc = '%%page: A%%\nalpha alpha\n%%page: B%%\nbeta beta\n%%page: C%%\ngamma\n';
    const n = pagedNote(doc, 'A');
    const mid = doc.indexOf('alpha') + 7;
    n.v.dispatch({ selection: { anchor: mid }, userEvent: 'select.pointer' });
    n.go('B');
    await later(80);
    n.go('A');
    await later(80);
    assert.strictEqual(n.field().open, 'A');
    assert.strictEqual(n.v.state.selection.main.head, mid, 'back where it was on A');
    // B has a place of its own now; two steps at once: B, then C straight away.
    n.v.dispatch({ selection: { anchor: doc.indexOf('beta') + 6 } });
    await later(20);
    n.go('A');
    await later(80);
    n.go('B');
    n.go('C');
    await later(80);
    assert.strictEqual(n.field().open, 'C', "B's late restore didn't open B again");
    assert.strictEqual(R.pageAt(n.field().pages, n.v.state.selection.main.head), 2);
  });

  // Views of notes, each with an editor (or only its text) and a reading view's sizer, the
  // plugin's events and post-processor heard as Obsidian would send them.
  const pagedViews = () => {
    const settings = { notePages: true, pagesOpen: {} };
    const leaves = [];
    const on = {};
    const hear = (kind) => (type, fn) => ((on[`${kind}:${type}`] = fn), {});
    const post = [];
    const app = { workspace: { getLeavesOfType: () => leaves, on: hear('ws') }, vault: { on: hear('vault') }, metadataCache: { on: hear('meta') } };
    const looks = {};
    const plugin = { settings, app, notes: { get: (file, key) => (key === 'pages' ? looks[file.path] : undefined) }, saveData: async () => {}, saveSettings: async () => {}, registerEvent() {}, registerEditorExtension() {}, registerMarkdownPostProcessor: (fn) => post.push(fn) };
    const f = new R.NotePages(plugin);
    f.registerTypes();
    f.register();
    f.extensions = [R.pagesExtension((cm, name) => f.follow(cm, name))];
    const open = (path, doc, { editor = true, file = new TFile(path) } = {}) => {
      const containerEl = document.body.appendChild(document.createElement('div'));
      const source = containerEl.createDiv({ cls: 'markdown-source-view' });
      const preview = containerEl.createDiv({ cls: 'markdown-preview-view' });
      const sizer = preview.createDiv({ cls: 'markdown-preview-sizer' });
      Object.defineProperty(preview, 'clientHeight', { value: 100 });
      Object.defineProperty(preview, 'scrollTop', { value: 0, writable: true });
      const v = editor ? new EditorView({ parent: source, state: EditorState.create({ doc, extensions: [markdown(), livePreview.init(() => true), f.extensions] }) }) : null;
      let text = doc;
      const view = { file, containerEl, editor: v ? { cm: v, getValue: () => v.state.doc.toString() } : { getValue: () => text } };
      leaves.push({ view });
      return { view, v, preview, sizer, setText: (t) => (text = t) };
    };
    const render = (path, el, line, containerEl) => post.forEach((fn) => fn(el, { sourcePath: path, containerEl, getSectionInfo: () => ({ lineStart: line }) }));
    const close = (view) => leaves.splice(leaves.findIndex((l) => l.view === view), 1);
    return { f, settings, on, open, render, close, looks };
  };

  await t("pages: a change to another note draws none of this note's views, and a draw with nothing new reads nothing", async () => {
    const n = pagedViews();
    n.settings.pagesOpen['n.md'] = 'A';
    const a = n.open('n.md', PAGED);
    const b = n.open('m.md', PAGED, { editor: false });
    n.f.sync();
    let drawn = [];
    const draw = n.f.draw.bind(n.f);
    n.f.draw = (view) => (drawn.push(view.file.path), draw(view));
    n.on['vault:modify'](new TFile('other.md'));
    n.on['meta:changed'](new TFile('other.md'));
    await later(50);
    assert.deepStrictEqual(drawn, [], 'another note changed: nothing drawn');
    n.on['vault:modify'](a.view.file);
    await later(50);
    assert.deepStrictEqual(drawn, ['n.md'], 'this note changed: only its view');
    // Drawn again with nothing new: nothing read, nothing drawn.
    const count = () => [R.pageStats.parses, R.pageStats.draws];
    let before = count();
    n.f.sync();
    assert.deepStrictEqual(count(), before, 'the same text: no parse, no draw');
    // Typed into: drawn again from the editor's own record, still unread.
    a.v.dispatch({ changes: { from: PAGED.indexOf('alpha'), insert: 'x' } });
    before = count();
    n.f.draw(a.view);
    assert.deepStrictEqual(count(), [before[0], before[1] + 1]);
    // A view with no editor of ours: its text read again only when it's changed.
    b.setText(PAGED + 'more\n');
    before = count();
    n.f.draw(b.view);
    n.f.draw(b.view);
    assert.deepStrictEqual(count(), [before[0] + 1, before[1] + 1]);
  });

  await t('pages: reading view hides each block as it comes, with no full draw; an embed inside keeps its own lines', async () => {
    const lines = ['Intro', '%%page: A%%'];
    for (let i = 0; i < 23; i++) lines.push(`a${i}`);
    lines.push('%%page: B%%');
    for (let i = 0; i < 24; i++) lines.push(`b${i}`);
    const doc = lines.join('\n') + '\n';
    const n = pagedViews();
    n.settings.pagesOpen['r.md'] = 'A';
    const r = n.open('r.md', doc);
    n.f.sync();
    let syncs = 0;
    const sync = n.f.sync.bind(n.f);
    n.f.sync = (paths) => (syncs++, sync(paths));
    const blocks = lines.map((_, i) => {
      const el = r.sizer.createDiv();
      n.render('r.md', el, i);
      return el;
    });
    await later(50);
    assert.strictEqual(blocks.length, 50);
    assert.strictEqual(syncs, 0, 'no full draw as blocks come');
    blocks.forEach((el, i) => assert.strictEqual(el.classList.contains('dr-page-off'), i >= 25, `line ${i}`));
    // An embed in the note, its lines its own note's: line 3 is on A here, hidden once B is open — not in the embed.
    const embedSizer = () => r.sizer.createDiv({ cls: 'internal-embed markdown-embed' }).createDiv({ cls: 'markdown-embed-content' }).createDiv({ cls: 'markdown-preview-view' }).createDiv({ cls: 'markdown-preview-sizer' });
    const inner = embedSizer().createDiv();
    n.render('r.md', inner, 3);
    n.settings.pagesOpen['r.md'] = 'B';
    n.f.sync();
    assert.ok(blocks[3].classList.contains('dr-page-off') && !blocks[30].classList.contains('dr-page-off'));
    assert.ok(!inner.classList.contains('dr-page-off'), "the embed's block shows");
  });

  await t('pages: a note shown elsewhere — embedded in another note, in a hover, laid nowhere yet — shows whole; its own view hides by its pages', async () => {
    const lines = ['%%page: A%%', 'alpha', '## Heading', 'under it', '%%page: B%%', 'beta'];
    const doc = lines.join('\n') + '\n';
    const n = pagedViews();
    n.settings.pagesOpen['a.md'] = 'B';
    const a = n.open('a.md', doc);
    const b = n.open('b.md', 'Text\n![[a#Heading]]\n');
    n.f.sync();
    // Rendered before it's put anywhere, as Obsidian does: in B's embed of A, in a hover, with nothing said.
    const embed = b.sizer.createDiv({ cls: 'internal-embed markdown-embed' }).createDiv({ cls: 'markdown-embed-content' }).createDiv({ cls: 'markdown-preview-view' }).createDiv({ cls: 'markdown-preview-sizer' });
    const hover = document.body.createDiv({ cls: 'popover hover-popover' }).createDiv({ cls: 'markdown-preview-view' }).createDiv({ cls: 'markdown-preview-sizer' });
    const come = (where) => {
      const el = document.createElement('div');
      n.render('a.md', el, 3, where);
      if (where) where.appendChild(el);
      return el;
    };
    const shown = [come(embed), come(hover), come(undefined)];
    await later(50);
    shown.forEach((el, i) => assert.ok(!el.classList.contains('dr-page-off'), `shown whole: ${i}`));
    // A's own view: hidden as it comes, said where; else once it's laid, by the view's own draw.
    const said = come(a.sizer);
    assert.ok(said.classList.contains('dr-page-off'), 'its own view, said: hidden straight away');
    const unsaid = come(undefined);
    a.sizer.appendChild(unsaid);
    await later(50);
    assert.ok(unsaid.classList.contains('dr-page-off'), 'its own view, unsaid: hidden once drawn');
  });

  await t("pages: a page's new icon or colour shows, though the note's change is heard before its properties'", async () => {
    const n = pagedViews();
    n.settings.pagesOpen['n.md'] = 'A';
    const a = n.open('n.md', PAGED);
    n.f.sync();
    a.view.file.stat.mtime = 5;
    n.on['vault:modify'](a.view.file);
    await later(50);
    n.looks['n.md'] = { B: { color: 'red' } };
    n.on['meta:changed'](a.view.file);
    await later(50);
    const tab = a.view.containerEl.querySelector('.dr-page-tab[data-page="B"]');
    assert.strictEqual(tab.dataset.drColor, 'red');
  });

  await t('pages: a note changed while closed hides nothing by its old pages till it is drawn again; renamed or deleted, its pages are forgotten', async () => {
    const lines = ['%%page: A%%', 'alpha', '%%page: B%%', 'beta'];
    const n = pagedViews();
    n.settings.pagesOpen['c.md'] = 'A';
    const c = n.open('c.md', lines.join('\n') + '\n');
    n.f.sync();
    n.close(c.view);
    // Changed by sync while closed: B now has a line more above it, on A.
    const now = ['%%page: A%%', 'alpha', 'more', '%%page: B%%', 'beta'].join('\n') + '\n';
    c.view.file.stat.mtime = 9;
    const again = n.open('c.md', now, { file: c.view.file });
    const el = again.sizer.createDiv();
    n.render('c.md', el, 2);
    assert.ok(!el.classList.contains('dr-page-off'), "line 2 was B's, by the old pages: not hidden by them");
    await later(50);
    assert.ok(!el.classList.contains('dr-page-off'), "and drawn again, it's A's");
    const late = again.sizer.createDiv();
    n.render('c.md', late, 4);
    assert.ok(late.classList.contains('dr-page-off'), "B's, by the new pages");
    n.on['vault:rename'](c.view.file, 'c.md');
    assert.ok(!n.f.lines_.has('c.md'));
    n.f.sync();
    n.on['vault:delete'](c.view.file);
    assert.ok(!n.f.lines_.has('c.md'));
  });

  await t("pages: a tab reused for another paged note doesn't take the first one's place; two panes of a note keep their own", async () => {
    const n = pagedViews();
    n.settings.pagesOpen = { 'n.md': 'A', 'm.md': 'X' };
    const a = n.open('n.md', PAGED);
    n.f.sync();
    a.preview.scrollTop = 120;
    // The tab opens another note, which Obsidian scrolls to a heading in it.
    const other = '%%page: X%%\nx\n%%page: Y%%\ny\n';
    a.view.file = new TFile('m.md');
    a.v.dispatch({ changes: { from: 0, to: a.v.state.doc.length, insert: other } });
    n.f.sync();
    a.preview.scrollTop = 300;
    await later(80);
    assert.strictEqual(a.preview.scrollTop, 300, 'left where Obsidian put it');
    // Two panes of one note: each its own cursor on A, through B and back.
    const doc = '%%page: A%%\nalpha alpha\n%%page: B%%\nbeta beta\n';
    const p1 = n.open('two.md', doc);
    const p2 = n.open('two.md', doc);
    n.settings.pagesOpen['two.md'] = 'A';
    n.f.sync();
    p1.v.dispatch({ selection: { anchor: doc.indexOf('alpha') + 2 }, userEvent: 'select.pointer' });
    p2.v.dispatch({ selection: { anchor: doc.indexOf('alpha') + 8 }, userEvent: 'select.pointer' });
    n.settings.pagesOpen['two.md'] = 'B';
    n.f.sync();
    await later(80);
    n.settings.pagesOpen['two.md'] = 'A';
    n.f.sync();
    await later(80);
    assert.deepStrictEqual([p1.v.state.selection.main.head, p2.v.state.selection.main.head], [doc.indexOf('alpha') + 2, doc.indexOf('alpha') + 8]);
  });

  await t("pages: measuring the control again (a resize) scrolls only the control, sideways, never the note", () => {
    const n = pagedViews();
    n.settings.pagesOpen['n.md'] = 'A';
    const a = n.open('n.md', PAGED);
    n.f.sync();
    const bar = a.view.containerEl.querySelector('.dr-pages');
    const capsule = bar.querySelector('.dr-pages-capsule');
    Object.defineProperty(capsule, 'clientWidth', { value: 100 });
    Object.defineProperty(capsule, 'scrollLeft', { value: 0, writable: true });
    let scrolled = 0;
    bar.querySelectorAll('.dr-page-tab').forEach((tab, i) => {
      Object.defineProperty(tab, 'offsetWidth', { value: 40 });
      Object.defineProperty(tab, 'offsetLeft', { value: i * 200 });
      tab.scrollIntoView = () => scrolled++;
    });
    a.preview.scrollTop = 500;
    n.f.select(bar, 'B', false);
    assert.strictEqual(scrolled, 0, 'nothing scrolled into view');
    assert.strictEqual(a.preview.scrollTop, 500);
    assert.strictEqual(capsule.scrollLeft, 140, "the control scrolled to show B's tab");
  });

  await t('pages: with two pages of one name, a change to one writes the names as shown, so the other keeps its own', () => {
    const text = '%%page: A%%\none\n%%page: A%%\ntwo\n%%page: B%%\nthree\n';
    assert.deepStrictEqual(R.parsePages(R.withPageRemoved(text, 'A')).map((p) => p.name), ['A 2', 'B']);
    assert.deepStrictEqual(R.parsePages(R.withPageRenamed(text, 'A', 'Z')).map((p) => p.name), ['Z', 'A 2', 'B']);
    const moved = R.withPageMoved(text, 'A', 1);
    assert.deepStrictEqual(R.parsePages(moved).map((p) => p.name), ['A 2', 'A', 'B']);
    assert.ok(moved.indexOf('two') < moved.indexOf('one'));
    assert.strictEqual(R.withNamesWritten('%%page: A%%\r\nx\r\n%%page: A%%\r\ny\r\n'), '%%page: A%%\r\nx\r\n%%page: A 2%%\r\ny\r\n');
  });

  await t('pages: taking a page from two leaves a plain note, no marker', () => {
    const text = '%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n';
    const one = R.withPageRemoved(text, 'B');
    assert.ok(!one.includes('%%page') && one.includes('alpha'), one);
    assert.strictEqual(R.withPageRemoved(text, 'A'), 'beta\n');
  });

  await t("pages: a CRLF note keeps its line endings; frontmatter markers don't count; a last marker with no newline does", () => {
    const lone = (s) => /(^|[^\r])\n/.test(s);
    const two = R.withPageAdded('Hello\r\n', 'Untitled 2');
    assert.ok(!lone(two), JSON.stringify(two));
    assert.deepStrictEqual(R.parsePages(two).map((p) => p.name), ['Untitled', 'Untitled 2']);
    const three = R.withPageAdded(two + 'more', 'C');
    assert.ok(!lone(three), JSON.stringify(three));
    const moved = R.withPageMoved(three, 'C', -1);
    assert.ok(!lone(moved), JSON.stringify(moved));
    const text = '---\n%%page: X%%\n---\nbody\n%%page: A%%\na\n%%page: B%%';
    const pages = R.parsePages(text);
    assert.deepStrictEqual(pages.map((p) => p.name), ['A', 'B']);
    assert.strictEqual(pages[1].from, text.length);
  });

  // A paged note on disk: its properties in a block written whole again on each change, as
  // Obsidian does, read through the plugin's own notes; each Undo offered kept.
  const pagedFile = (body, props = {}) => {
    const file = new TFile('p.md');
    const yaml = () => (Object.keys(props).length ? `---\n${Object.keys(props).map((k) => `${k}: ${JSON.stringify(props[k])}`).join('\n')}\n---\n` : '');
    let text = yaml() + body;
    const undos = [];
    const saves = { data: 0, settings: 0 };
    const gone = { yes: false };
    const app = {
      workspace: { getLeavesOfType: () => [] },
      vault: { process: async (f, fn) => void (text = fn(text)), read: async () => text, getAbstractFileByPath: (p) => (p === file.path && !gone.yes ? file : null) },
      fileManager: { processFrontMatter: async (f, fn) => { fn(props); text = yaml() + text.slice(R.bodyStart(text)); } },
      metadataCache: { getFileCache: () => ({ frontmatter: props }) },
    };
    const plugin = { app, settings: { notePages: true, pagesOpen: {} }, saveData: async () => saves.data++, saveSettings: async () => saves.settings++, offerUndo: (message, fn) => undos.push({ message, fn }) };
    plugin.notes = new R.Notes(plugin);
    const f = new R.NotePages(plugin);
    return {
      f, file, undos, saves, props, gone,
      body: () => text.slice(R.bodyStart(text)),
      edit: (fn) => (text = text.slice(0, R.bodyStart(text)) + fn(text.slice(R.bodyStart(text)))),
      open: () => plugin.settings.pagesOpen['p.md'],
      setOpen: (name) => (plugin.settings.pagesOpen['p.md'] = name),
      undo: () => undos[undos.length - 1].fn(),
      remove: async (name) => {
        const going = f.remove(file, name);
        await settle();
        click(modals[modals.length - 1].contentEl.querySelector('.mod-cta'));
        await going;
      },
    };
  };

  await t('pages: Merge with previous page keeps the text, in order, without the marker; the last two merged leave a plain note; Undo puts it back exactly', async () => {
    assert.strictEqual(R.withPageMerged('%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n', 'B'), 'alpha\n\nbeta\n', 'one plain page, no markers');
    assert.strictEqual(R.withPageMerged('%%page: A%%\r\nalpha\r\n%%page: B%%\r\nbeta\r\n', 'B'), 'alpha\r\nbeta\r\n', 'CRLF kept');
    const text = '%%page: A%%\nalpha\n%%page: A%%\nbeta\n%%page: A%%\ngamma\n';
    assert.strictEqual(R.withPageMerged(text, 'A'), text.replace('A%%\nbeta', 'A 2%%\nbeta').replace('A%%\ngamma', 'A 3%%\ngamma'), 'the first page: nothing to merge with');
    assert.strictEqual(R.withPageMerged(text, 'A 2'), '%%page: A%%\nalpha\nbeta\n%%page: A 3%%\ngamma\n', 'names written as shown');
    const body = 'Intro\n%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n\n%%page: C%%\ngamma\n';
    const n = pagedFile(body, { pages: { B: { icon: 'star' }, C: { color: 'red' } } });
    n.setOpen('B');
    await n.f.merge(n.file, 'B', 'A');
    const pages = R.parsePages(n.body());
    assert.deepStrictEqual(pages.map((p) => p.name), ['A', 'C']);
    assert.strictEqual(n.body().slice(pages[0].from, pages[0].to), 'alpha\n\nbeta\n');
    assert.deepStrictEqual(n.props.pages, { C: { color: 'red' } }, 'the merged page’s look goes');
    assert.strictEqual(n.open(), 'A', 'the previous page open');
    assert.strictEqual(n.undos.length, 1);
    await n.undo();
    assert.strictEqual(n.body(), body);
    assert.deepStrictEqual(n.props.pages, { C: { color: 'red' }, B: { icon: 'star' } });
    assert.strictEqual(n.open(), 'B');
    // Not offered on the first page.
    const titles = (name) => {
      const before = menus.length;
      n.f.menu({ clientX: 1, clientY: 1 }, n.file, name, R.parsePages(n.body()));
      return menus.length > before ? menus[menus.length - 1].items.map((i) => i.title) : [];
    };
    assert.ok(!titles('A').includes('Merge with previous page'));
    assert.ok(titles('B').includes('Merge with previous page'));
  });

  await t('pages: Undo of a rename or a removal is one step, putting back the text, the look and the page open, after edits elsewhere; edited around, nothing is put back and a notice says so', async () => {
    const body = 'Intro\n%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n\n%%page: C%%\ngamma\n';
    const n = pagedFile(body, { tags: ['x'], pages: { B: { icon: 'star' }, C: { color: 'red' } } });
    n.setOpen('B');
    await n.f.renameTo(n.file, 'B', 'Sources');
    assert.deepStrictEqual(R.parsePages(n.body()).map((p) => p.name), ['A', 'Sources', 'C']);
    assert.deepStrictEqual(n.props.pages, { C: { color: 'red' }, Sources: { icon: 'star' } });
    assert.strictEqual(n.open(), 'Sources');
    assert.strictEqual(n.undos.length, 1, 'one Undo for the text, the look and the page open');
    // Saved since, with more written elsewhere in the note.
    n.edit((b) => b.replace('alpha\n', 'alpha\nmore\n'));
    await n.undo();
    const edited = body.replace('alpha\n', 'alpha\nmore\n');
    assert.strictEqual(n.body(), edited);
    assert.deepStrictEqual(n.props.pages, { C: { color: 'red' }, B: { icon: 'star' } });
    assert.strictEqual(n.open(), 'B');
    // Removed, with its look; written elsewhere; Undo puts back the block, its marker and its look.
    await n.remove('B');
    assert.ok(!n.body().includes('beta') && !n.body().includes('%%page: B'));
    assert.deepStrictEqual(n.props.pages, { C: { color: 'red' } });
    assert.strictEqual(n.open(), undefined, 'the page open was the one removed');
    n.edit((b) => 'Intro, edited\n' + b.slice('Intro\n'.length));
    await n.undo();
    assert.strictEqual(n.body(), edited.replace('Intro\n', 'Intro, edited\n'));
    assert.deepStrictEqual(n.props.pages, { C: { color: 'red' }, B: { icon: 'star' } });
    assert.strictEqual(n.open(), 'B');
    // Removed, then written right where it was: nothing put back, and a notice.
    await n.remove('C');
    const left = n.body();
    n.edit((b) => b + 'written after\n');
    notices.length = 0;
    await n.undo();
    assert.strictEqual(n.body(), left + 'written after\n', 'newer text kept');
    assert.deepStrictEqual(n.props.pages, { B: { icon: 'star' } }, 'the look not put back either');
    assert.ok(notices.some((m) => /edited around the page/.test(m)), notices.join(' | '));
  });

  await t('pages: Undo of an added page takes out both its markers after edits elsewhere; removing the last marker drops the looks', async () => {
    const n = pagedFile('# Plan\nHello\n\nmore\n');
    await n.f.add(n.file);
    assert.deepStrictEqual(R.parsePages(n.body()).map((p) => p.name), ['Plan', 'Untitled']);
    assert.strictEqual(n.open(), 'Untitled');
    n.edit((b) => b.replace('Hello', 'Hello there'));
    await n.undo();
    assert.strictEqual(n.body(), '# Plan\nHello there\n\nmore\n');
    assert.strictEqual(n.open(), undefined);
    // Two pages, each with a look: taking one out leaves a plain note, and no `pages` property.
    const m = pagedFile('%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n', { pages: { A: { color: 'red' }, B: { icon: 'star' } } });
    await m.remove('B');
    assert.ok(!m.body().includes('%%page'));
    assert.ok(!('pages' in m.props), JSON.stringify(m.props));
    await m.undo();
    assert.strictEqual(m.body(), '%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n');
    assert.deepStrictEqual(m.props.pages, { A: { color: 'red' }, B: { icon: 'star' } });
  });

  await t("pages: a note's own `pages` property (a page count) is left alone, with a notice; the pages still work", async () => {
    const n = pagedFile('%%page: A%%\nalpha\n%%page: B%%\nbeta\n', { pages: 320 });
    notices.length = 0;
    await n.f.setLook(n.file, 'A', (mine) => (mine.icon = 'star'));
    assert.strictEqual(n.props.pages, 320);
    assert.ok(notices.some((m) => /used for something else/.test(m)), notices.join(' | '));
    await n.f.renameTo(n.file, 'A', 'Z');
    assert.deepStrictEqual(R.parsePages(n.body()).map((p) => p.name), ['Z', 'B']);
    assert.strictEqual(n.props.pages, 320);
    assert.deepStrictEqual(n.f.look(n.file, 'Z'), { icon: '', color: '' });
  });

  await t('pages: switching page saves only the page open, a moment later, and never all the settings', async () => {
    const doc = '%%page: A%%\nalpha\n%%page: B%%\nbeta\n%%page: C%%\ngamma\n';
    const n = pagedNote(doc, 'A');
    // The editor's cursor sent to page B (a jump): B opens.
    n.v.dispatch({ selection: { anchor: doc.indexOf('beta') + 1 } });
    assert.strictEqual(n.settings.pagesOpen['n.md'], 'B', 'the editor opened B');
    n.f.open(n.view.file, 'C');
    assert.strictEqual(n.settings.pagesOpen['n.md'], 'C');
    await later(450);
    assert.deepStrictEqual(n.saves, { data: 1, settings: 0 }, 'one quiet save for both switches');
  });

  await t('pages: the control is a tablist of tabs, the open one selected, worked by keys', async () => {
    const n = pagedViews();
    n.settings.pagesOpen['k.md'] = 'A';
    const k = n.open('k.md', PAGED);
    n.f.sync();
    const capsule = k.view.containerEl.querySelector('.dr-pages-capsule');
    assert.strictEqual(capsule.getAttribute('role'), 'tablist');
    const tabs = () => [...capsule.querySelectorAll('.dr-page-tab')];
    assert.deepStrictEqual(tabs().map((el) => [el.getAttribute('role'), el.getAttribute('aria-selected'), el.getAttribute('tabindex')]), [['tab', 'true', '0'], ['tab', 'false', '-1']]);
    key(tabs()[1], 'Enter');
    assert.strictEqual(n.settings.pagesOpen['k.md'], 'B');
    await later(50);
    assert.deepStrictEqual(tabs().map((el) => el.getAttribute('aria-selected')), ['false', 'true']);
    key(tabs()[1], 'ArrowLeft');
    assert.strictEqual(n.settings.pagesOpen['k.md'], 'A');
  });

  await t('pages: Icon and Colour work with no submenus, and None takes the look off', async () => {
    const n = pagedFile('%%page: A%%\nalpha\n%%page: B%%\nbeta\n', { pages: { A: { icon: 'star', color: 'red' } } });
    const choose = async (title, inner) => {
      n.f.menu({ clientX: 5, clientY: 5 }, n.file, 'A', R.parsePages(n.body()));
      const shown = menus.length;
      menus[menus.length - 1].items.find((i) => i.title === title).click();
      assert.strictEqual(menus.length, shown + 1, `${title} opens a menu of its own`);
      menus[menus.length - 1].items.find((i) => i.title === inner).click();
      await settle();
    };
    await choose('Icon', 'None');
    assert.deepStrictEqual(n.props.pages, { A: { color: 'red' } });
    await choose('Colour', 'blue');
    assert.deepStrictEqual(n.props.pages, { A: { color: 'blue' } });
    await choose('Colour', 'None');
    assert.ok(!('pages' in n.props));
  });

  await t('pages: Undo clicked twice puts a page back once; a note gone since is left, with a notice; an empty look counts as one', async () => {
    const body = '%%page: A%%\nalpha\n\n%%page: B%%\nbeta\n\n%%page: C%%\ngamma\n';
    const n = pagedFile(body);
    await n.remove('B');
    await Promise.all([n.undo(), n.undo()]);
    await n.undo();
    assert.strictEqual(n.body(), body);
    assert.strictEqual(n.body().split('%%page: B%%').length, 2, 'B once');
    await n.remove('C');
    n.gone.yes = true;
    notices.length = 0;
    await n.undo();
    assert.ok(notices.some((m) => /the note is gone/.test(m)), notices.join(' | '));
    // `A:` with nothing after it is a page with no look yet, not a property of the note's own.
    const m = pagedFile('%%page: A%%\na\n%%page: B%%\nb\n', { pages: { A: null } });
    await m.f.setLook(m.file, 'B', (mine) => (mine.icon = 'star'));
    assert.deepStrictEqual(m.props.pages, { A: null, B: { icon: 'star' } });
  });

  await t('pages: the page open, waiting to be saved, is saved when the feature is turned off', () => {
    const n = pagedFile('%%page: A%%\na\n%%page: B%%\nb\n');
    n.f.open(n.file, 'B');
    assert.strictEqual(n.saves.data, 0, 'not straight away');
    n.f.disable();
    assert.deepStrictEqual(n.saves, { data: 1, settings: 0 });
  });

  await t('pages: the changes of a move in a long note are found quickly and in little memory, as small as they can be', () => {
    // Fewest lines changed, by the slow way: the longest run of lines the two share.
    const fewest = (a, b) => {
      const A = a.split('\n');
      const B = b.split('\n');
      let row = new Array(B.length + 1).fill(0);
      for (let i = 1; i <= A.length; i++) {
        const next = [0];
        for (let j = 1; j <= B.length; j++) next[j] = A[i - 1] === B[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
        row = next;
      }
      return A.length + B.length - 2 * row[B.length];
    };
    const changed = (h) => h.reduce((sum, x) => sum + x.old.length + x.now.length, 0);
    const lines = (tag, count) => Array.from({ length: count }, (_, i) => `${tag} ${i % 7}`).join('\n') + '\n';
    const small = `%%page: A%%\n${lines('a', 120)}\n%%page: B%%\n${lines('b', 40)}\n%%page: C%%\n${lines('a', 30)}`;
    const smallMoved = R.withPageMoved(small, 'B', -1);
    const h = R.pageHunks(small, smallMoved);
    assert.strictEqual(changed(h), fewest(small, smallMoved));
    assert.strictEqual(R.withHunksUndone(smallMoved, h), small);
    // 6,000 lines, a short page and a long one swapped, then two long ones (past the step limit: one change).
    [[10, 5990], [3000, 3000]].forEach(([x, y]) => {
      const long = `%%page: A%%\n${lines('a', x)}\n%%page: B%%\n${lines('b', y)}`;
      const moved = R.withPageMoved(long, 'B', -1);
      const began = Date.now();
      const hunks = R.pageHunks(long, moved);
      assert.ok(Date.now() - began < 1500, `${Date.now() - began} ms`);
      assert.strictEqual(R.withHunksUndone(moved, hunks), long);
      if (x === 10) assert.ok(changed(hunks) <= 2 * (x + 3), String(changed(hunks)));
    });
  });

  await t('settings for things deleted while the plugin was off are let go; not while the vault is loading', () => {
    const existing = new Set(['A', 'A/n.md', 'Map.canvas']);
    const fake = {
      settings: {
        coverColors: { A: '#123456', Gone: '#000000' },
        coverDesigns: { 'Map.canvas': {}, 'Old.canvas': {} },
        albumOrders: { '/': { names: [] }, A: { names: [] }, 'Gone/Sub': { names: [] } },
        folderDefaults: { Gone: [] },
      },
      saved: 0,
      saveData() { this.saved++; },
      app: { vault: { getAllLoadedFiles: () => Array.from(existing), getAbstractFileByPath: (p) => (existing.has(p) ? {} : null) } },
    };
    assert.strictEqual(R.DesignRedux.prototype.pruneLeftovers.call(fake), true);
    assert.deepStrictEqual(Object.keys(fake.settings.coverColors), ['A']);
    assert.deepStrictEqual(Object.keys(fake.settings.coverDesigns), ['Map.canvas']);
    assert.deepStrictEqual(Object.keys(fake.settings.albumOrders), ['/', 'A']);
    assert.deepStrictEqual(fake.settings.folderDefaults, {});
    assert.strictEqual(fake.saved, 1);
    fake.app.vault.getAllLoadedFiles = () => [];
    fake.settings.coverColors.Gone = '#000000';
    assert.strictEqual(R.DesignRedux.prototype.pruneLeftovers.call(fake), undefined);
    assert.ok('Gone' in fake.settings.coverColors, 'pruned while the vault looked empty');
  });

  /* -- type to jump, Space to preview ---------------------------------- */

  const trackList = () => {
    const el = document.body.createDiv();
    ['Anarchy', 'Balance of power', 'Contract', 'Realism', 'Tort', 'Tribunal'].forEach((name, i) => {
      const row = el.createDiv({ cls: 'dr-track' });
      row.setAttribute('tabindex', '0');
      row.dataset.path = `Law/${name}.md`;
      row.createDiv({ cls: 'dr-track-num', text: String(i + 1) });
      row.createDiv({ cls: 'dr-track-name', text: name });
      row.addEventListener('keydown', (evt) => {
        if (evt.key === ' ') row.dataset.opened = 'yes';
      });
    });
    R.roveFocus(el, '.dr-track');
    return el;
  };
  const focusedName = () => document.activeElement.querySelector('.dr-track-name').textContent;

  await t('typing the start of a name jumps to it; the same letter again moves on', () => {
    const el = trackList();
    R.listKeys.on = true;
    try {
      el.firstChild.focus();
      key(document.activeElement, 'r');
      assert.strictEqual(focusedName(), 'Realism');
      el.drTyped.at = 0;
      key(document.activeElement, 't');
      assert.strictEqual(focusedName(), 'Tort');
      key(document.activeElement, 't');
      assert.strictEqual(focusedName(), 'Tribunal');
      el.drTyped.at = 0;
      ['b', 'a', 'l', ' '].forEach((k) => key(document.activeElement, k));
      assert.strictEqual(focusedName(), 'Balance of power', 'a space inside a name being typed is part of it');
      assert.ok(!document.activeElement.dataset.opened);
      // "/" is still the page's way to Find.
      el.drTyped.at = 0;
      const slash = new window.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
      document.activeElement.dispatchEvent(slash);
      assert.ok(!slash.defaultPrevented);
    } finally {
      R.listKeys.on = false;
      el.remove();
    }
  });

  await t("Space previews the note in focus; switched off, the keys are the row's own again", () => {
    const el = trackList();
    const seen = [];
    const keys = new R.ListKeys({ settings: { typeToJump: true }, app: { vault: { getAbstractFileByPath: () => null } } });
    keys.enable();
    R.listKeys.preview = (row, p) => { seen.push(p); return true; };
    try {
      el.children[2].focus();
      key(document.activeElement, ' ');
      assert.deepStrictEqual(seen, ['Law/Contract.md']);
      assert.ok(!el.children[2].dataset.opened, 'Space no longer opens it');
    } finally {
      keys.disable();
    }
    assert.strictEqual(R.listKeys.on, false);
    el.children[2].focus();
    key(document.activeElement, ' ');
    assert.strictEqual(el.children[2].dataset.opened, 'yes');
    key(document.activeElement, 'r');
    assert.strictEqual(focusedName(), 'Contract', 'no jumping when off');
    el.remove();
  });

  await t('a suggest list takes what it suggests once while its field is in use, and afresh after', () => {
    const box = document.body.createDiv();
    const input = box.createEl('input');
    let asked = 0;
    const list = R.attachSuggest(box, input, { source: () => (asked++, ['alpha', 'alpine', 'beta']), onSelect() {} });
    ['a', 'al', 'alp'].forEach((v) => {
      input.value = v;
      input.dispatchEvent(new window.Event('input'));
    });
    assert.strictEqual(asked, 1, 'once for three keys');
    assert.deepStrictEqual(Array.from(list.querySelectorAll('.dr-suggest-item')).map((e) => e.textContent), ['alpha', 'alpine']);
    input.dispatchEvent(new window.Event('blur'));
    input.value = 'b';
    input.dispatchEvent(new window.Event('input'));
    assert.strictEqual(asked, 2, 'afresh once the field was left');
    list.remove();
    box.remove();
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
