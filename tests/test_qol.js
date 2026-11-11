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

const { EditorState, StateField } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');
const { markdown } = require('@codemirror/lang-markdown');
const { undo, history } = (() => {
  try { return require('@codemirror/commands'); } catch (e) { return {}; }
})();

const menus = [];
const modals = [];
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
  Notice: class {},
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
    const v = new EditorView({ parent, state: EditorState.create({ doc, extensions: [markdown(), livePreview.init(() => true), ext, history ? history() : []] }) });
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
