// The quality-of-life additions, against the real main.js: generated
// covers, pins in your own order, scroll kept through history, keys,
// word counts and goals, ordinals as you type, and default hotkeys.
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
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_qol_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { fillArt, initialsOf, nameHue, roveFocus, gridColumns, BrowseView, Orders, Pins, ' +
  'showTargetMenu, ContextStrip, ordinalSuffix, ordinalBefore, ' +
  'ordinalInput, Scripts, scriptHotkeys, DEFAULTS, SETTINGS_TABS, listKeys, ListKeys, coverTint, coverGen, DesignRedux, CanvasAlign, CanvasFold, foldOf, blankLook, SETTINGS_MIGRATIONS };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

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
    assert.deepStrictEqual(R.blankLook({ coverFallback: 'art', coverDesigns: { 'IR/Realism.md': 'pines' } }, 'Realism', 'IR/Realism.md'), { art: 'Realism', design: 'pines' });
    const drawn = document.createElement('div');
    R.fillArt(drawn, null, 'file-text', null, { art: 'Balance of power' });
    const again = document.createElement('div');
    R.fillArt(again, null, 'file-text', null, { art: 'Balance of power' });
    assert.ok(drawn.classList.contains('is-drawn') && drawn.querySelector('svg.dr-drawn').children.length > 0);
    assert.strictEqual(drawn.innerHTML, again.innerHTML, 'the same name, the same cover');
    assert.ok(!drawn.querySelector('.dr-card-glyph'));
    const picked = document.createElement('div');
    R.fillArt(picked, null, 'file-text', { name: 'Balance of power', tint: '#30a46c' }, { art: 'Balance of power', design: 'pines' });
    assert.strictEqual(picked.dataset.design, 'pines');
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
    assert.strictEqual(R.DEFAULTS.settingsVersion, 3);
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
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
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
    const grouped = [].concat(...R.SETTINGS_TABS.map((tab) => [].concat(...tab.sections.map((sec) => sec.keys))));
    const loose = keys.filter((k) => grouped.indexOf(k) === -1);
    assert.deepStrictEqual(loose, [], 'rows falling into "Other": ' + loose.join(', '));
    ['coverFallback', 'generatedCoverColor', 'autoOrdinals'].forEach((k) => {
      assert.ok(keys.indexOf(k) !== -1, k + ' has a row');
      assert.ok(k in R.DEFAULTS, k + ' has a default');
    });
  });

  await t('settings for things deleted while the plugin was off are let go; not while the vault is loading', () => {
    const existing = new Set(['A', 'A/n.md', 'Map.canvas']);
    const fake = {
      settings: {
        coverColors: { A: '#123456', Gone: '#000000' },
        canvasLegends: { 'Map.canvas': {}, 'Old.canvas': {} },
        canvasAlignments: { 'Old.canvas': { x: 'center' } },
        albumOrders: { '/': { names: [] }, A: { names: [] }, 'Gone/Sub': { names: [] } },
        folderDefaults: { Gone: [] },
      },
      saved: 0,
      saveData() { this.saved++; },
      app: { vault: { getAllLoadedFiles: () => Array.from(existing), getAbstractFileByPath: (p) => (existing.has(p) ? {} : null) } },
    };
    assert.strictEqual(R.DesignRedux.prototype.pruneLeftovers.call(fake), true);
    assert.deepStrictEqual(Object.keys(fake.settings.coverColors), ['A']);
    assert.deepStrictEqual(Object.keys(fake.settings.canvasLegends), ['Map.canvas']);
    assert.deepStrictEqual(fake.settings.canvasAlignments, {});
    assert.deepStrictEqual(Object.keys(fake.settings.albumOrders), ['/', 'A']);
    assert.deepStrictEqual(fake.settings.folderDefaults, {});
    assert.strictEqual(fake.saved, 1);
    fake.app.vault.getAllLoadedFiles = () => [];
    fake.settings.coverColors.Gone = '#000000';
    assert.strictEqual(R.DesignRedux.prototype.pruneLeftovers.call(fake), undefined);
    assert.ok('Gone' in fake.settings.coverColors, 'pruned while the vault looked empty');
  });

  await t('a canvas with no file — one closing, or not loaded — is passed over, not an error', () => {
    const align = new R.CanvasAlign({ settings: { canvasAlignments: { 'Map.canvas': { a: 'center' } } } });
    assert.deepStrictEqual(align.alignments(null), {});
    assert.deepStrictEqual(align.alignments({ path: 'Map.canvas' }), { a: 'center' });
    assert.doesNotThrow(() => align.apply({ file: null, canvas: { nodes: new Map() } }));
  });

  await t('canvas cards folded by an earlier version open to the size they were; nothing else folds a card', () => {
    const containerEl = document.createElement('div');
    containerEl.createDiv({ cls: 'canvas-controls' });
    const contentEl = containerEl.createDiv();
    let saves = 0;
    const card = (id, data, x, height, fold) => {
      const node = {
        id, x, y: 0, width: 200, height, unknownData: fold ? { drFold: fold } : {}, isEditing: false,
        nodeEl: contentEl.createDiv({ cls: 'canvas-node' }),
        getData: () => data,
        moveAndResize(r) { Object.assign(this, r); },
      };
      node.nodeEl.createDiv({ cls: 'canvas-node-content' });
      return node;
    };
    const text = card('t', { type: 'text' }, 0, 52, { height: 120, folded: 52, measured: true });
    const note = card('n', { type: 'file', file: 'A.md' }, 300, 52, { height: 200, folded: 52, measured: true });
    const pic = card('p', { type: 'file', file: 'a.png' }, 600, 200);
    const view = { containerEl, contentEl, canvas: { nodes: new Map([['t', text], ['n', note], ['p', pic]]), edges: new Map(), selection: new Set(), requestSave: () => saves++ } };
    const fold = new R.CanvasFold({ settings: { canvasBranches: true, canvasCloseGaps: true } });
    fold.pass(view);
    assert.deepStrictEqual([text.height, note.height, pic.height], [120, 200, 200]);
    assert.strictEqual(R.foldOf(text), null);
    assert.ok(!('drFold' in note.unknownData));
    assert.strictEqual(saves, 0, 'saved with the canvas’s next change');
    // No arrows, no branches: nothing to fold, so no folding button.
    assert.ok(!containerEl.querySelector('.dr-fold-control'));
    assert.deepStrictEqual(fold.commands().map((c) => c.id), ['fold-canvas-branch', 'fold-every-canvas-branch', 'toggle-canvas-master-card', 'unfold-canvas-everything']);
    fold.cleanup(view);
    assert.ok(!containerEl.querySelector('.dr-fold-control, .dr-stack, .dr-branch-knob'));
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

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
