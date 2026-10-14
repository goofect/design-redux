// Rearranging properties in the panel, against the real main.js: drag
// by the type icon, Alt+arrows, Move up / Move down, and the order
// written back to the note's frontmatter.
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

let menus = [];
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = { title: '', disabled: false };
    item.setTitle = (t) => { item.title = t; return item; };
    item.setIcon = () => item;
    item.setChecked = () => item;
    item.setSection = () => item;
    item.setDisabled = (d) => { item.disabled = d; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
  addSeparator() { return this; }
  showAtPosition() { menus.push(this); }
}
const Platform = { isMobile: false };
const obsidian = new Proxy({
  Menu,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class { constructor(m) { notices.push(m); } },
  Platform,
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const notices = [];
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_reorder_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { PropertiesSection, Notes };\n');
const { PropertiesSection, Notes } = require(tmp).__test;
fs.unlinkSync(tmp);

/* -- a note and a panel -------------------------------------------------- */

function setup(initial = { parent: '[[Judiciary]]', domain: 'Law', status: 'draft', tags: ['court'] }) {
  const file = { path: 'Court.md', basename: 'Court' };
  const stored = { fm: Object.assign({}, initial), writes: 0 };
  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter: Object.assign({ position: {} }, stored.fm) }) },
    metadataTypeManager: { getTypeInfo: () => null, registeredTypeWidgets: {}, getAllProperties: () => ({}) },
    fileManager: {
      processFrontMatter: async (f, fn) => {
        const fm = Object.assign({}, stored.fm);
        fn(fm);
        stored.fm = fm;
        stored.writes++;
      },
    },
  };
  const popupEl = document.body.appendChild(document.createElement('div'));
  // Every property showing: these are about moving them.
  const plugin = { app, settings: { panelPropertiesView: 'all' } };
  plugin.notes = new Notes(plugin);
  const panel = { plugin, popupEl };
  const section = new PropertiesSection(panel);
  section.mount(popupEl, file);
  const list = popupEl.querySelector('.dr-rows');
  // Rows stacked 40px apart, wherever they are in the list at the time.
  list.querySelectorAll('.dr-row').forEach((r) => {
    r.getBoundingClientRect = () => {
      const i = Array.from(list.querySelectorAll(':scope > .dr-row')).indexOf(r);
      return { top: i * 40, bottom: i * 40 + 40, height: 40, left: 0, width: 300 };
    };
  });
  return { section, list, stored };
}

const order = (list) => Array.from(list.querySelectorAll(':scope > .dr-row')).map((r) => r.dataset.key);
const icon = (list, key) => list.querySelector(`.dr-row[data-key="${key}"] .dr-key-icon`);
const pointer = (target, type, y) =>
  target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
const settle = () => new Promise((r) => setTimeout(r, 5));

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  await t('dragging a property by its icon moves it, and the note is written in that order', async () => {
    const { list, stored } = setup();
    pointer(icon(list, 'parent'), 'pointerdown', 20);
    pointer(window, 'pointermove', 26);
    assert.ok(list.querySelector('.dr-row[data-key="parent"]').classList.contains('is-dragging'));
    pointer(window, 'pointermove', 130);
    assert.deepStrictEqual(order(list), ['domain', 'status', 'parent', 'tags'], 'rows did not follow');
    pointer(window, 'pointerup', 130);
    await settle();
    assert.deepStrictEqual(Object.keys(stored.fm), ['domain', 'status', 'parent', 'tags']);
    assert.deepStrictEqual(stored.fm.tags, ['court'], 'values moved with their keys');
    assert.strictEqual(stored.fm.parent, '[[Judiciary]]');
    assert.ok(!list.classList.contains('is-sorting'));
  });

  await t('dragging to the end, and back to the top', async () => {
    const { list, stored } = setup();
    pointer(icon(list, 'domain'), 'pointerdown', 60);
    pointer(window, 'pointermove', 400);
    pointer(window, 'pointerup', 400);
    await settle();
    assert.deepStrictEqual(Object.keys(stored.fm), ['parent', 'status', 'tags', 'domain']);
    pointer(icon(list, 'tags'), 'pointerdown', 100);
    pointer(window, 'pointermove', -10);
    pointer(window, 'pointerup', -10);
    await settle();
    assert.deepStrictEqual(Object.keys(stored.fm), ['tags', 'parent', 'status', 'domain']);
  });

  await t("a press that doesn't move is a click: the menu, and no write", async () => {
    const { list, stored } = setup();
    menus = [];
    const handle = icon(list, 'status');
    pointer(handle, 'pointerdown', 100);
    pointer(window, 'pointermove', 102);
    pointer(window, 'pointerup', 102);
    handle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    assert.strictEqual(menus.length, 1);
    assert.strictEqual(stored.writes, 0);
  });

  await t("the click that ends a drag doesn't open the menu", async () => {
    const { list } = setup();
    menus = [];
    const handle = icon(list, 'parent');
    pointer(handle, 'pointerdown', 20);
    pointer(window, 'pointermove', 90);
    pointer(window, 'pointerup', 90);
    handle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(menus.length, 0);
    await settle();
  });

  await t('Escape mid-drag puts everything back and writes nothing', async () => {
    const { list, stored } = setup();
    pointer(icon(list, 'parent'), 'pointerdown', 20);
    pointer(window, 'pointermove', 150);
    assert.notDeepStrictEqual(order(list), ['parent', 'domain', 'status', 'tags']);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.deepStrictEqual(order(list), ['parent', 'domain', 'status', 'tags']);
    pointer(window, 'pointerup', 150);
    await settle();
    assert.strictEqual(stored.writes, 0);
  });

  await t('Alt+arrows move a property one place, and stop at the ends', async () => {
    const { list, stored } = setup();
    const key = (k, dir) => icon(list, k).dispatchEvent(
      new window.KeyboardEvent('keydown', { key: dir, altKey: true, bubbles: true, cancelable: true }));
    key('status', 'ArrowUp');
    await settle();
    assert.deepStrictEqual(Object.keys(stored.fm), ['parent', 'status', 'domain', 'tags']);
    key('tags', 'ArrowDown');
    await settle();
    assert.strictEqual(stored.writes, 1, 'moved past the end');
  });

  await t('on touch, the menu moves a property up or down — where it can go; with a pointer, the grip does', async () => {
    const { list, stored } = setup();
    menus = [];
    icon(list, 'parent').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(!menus[0].items.some((i) => i.title.startsWith('Move')), 'not with a pointer');
    Platform.isMobile = true;
    try {
      icon(list, 'parent').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const first = menus[1].items.map((i) => i.title);
      assert.ok(!first.includes('Move up') && first.includes('Move down'), 'the first only goes down');
      menus[1].items.find((i) => i.title === 'Move down').click();
      await settle();
      assert.deepStrictEqual(Object.keys(stored.fm), ['domain', 'parent', 'status', 'tags']);
    } finally {
      Platform.isMobile = false;
    }
  });

  await t('a property added elsewhere meanwhile keeps its place at the end', async () => {
    const { section, stored } = setup();
    stored.fm.added = 'meanwhile';
    await section.reorder(['status', 'parent', 'domain', 'tags']);
    assert.deepStrictEqual(Object.keys(stored.fm), ['status', 'parent', 'domain', 'tags', 'added']);
  });

  await t('Remove, in the row’s menu, takes a property off, and Undo puts it back in its place, value and all', async () => {
    const { section, list, stored } = setup();
    let undo = null;
    section.plugin.offerUndo = (message, fn) => { undo = fn; };
    list.querySelector('.dr-row[data-key="parent"] .dr-row-more').click();
    menus.pop().items.find((i) => i.title === 'Remove').click();
    await settle();
    assert.deepStrictEqual(Object.keys(stored.fm), ['domain', 'status', 'tags']);
    await undo();
    assert.deepStrictEqual(Object.keys(stored.fm), ['parent', 'domain', 'status', 'tags']);
    assert.strictEqual(stored.fm.parent, '[[Judiciary]]');
  });

  await t('the handle says what it does', () => {
    const { list } = setup();
    const handle = icon(list, 'domain');
    assert.match(handle.getAttribute('aria-label'), /drag to move/);
    assert.strictEqual(handle.getAttribute('tabindex'), '0');
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
