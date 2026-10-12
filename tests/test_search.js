// Types into the real search screen, letter by letter, in jsdom, and
// checks what's kept: the field itself, the focus, and which searches
// are saved.
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
P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
P.setText = function (t) { this.textContent = t; };
P.isShown = function () { return true; };

class Component { registerEvent() {} registerDomEvent(el, type, fn) { el.addEventListener(type, fn); } register() {} }
class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.containerEl = document.createElement('div');
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
  }
  async setState() {}
}
class TFile {
  constructor(p) {
    this.path = p; this.name = p.split('/').pop();
    this.basename = this.name.replace(/\.[^.]+$/, ''); this.extension = this.name.split('.').pop();
    this.stat = { mtime: Date.now(), ctime: Date.now() };
  }
}
class TFolder { constructor(p) { this.path = p; this.name = p; this.children = []; } isRoot() { return this.path === '/'; } }
const obsidian = new Proxy({
  ItemView, TFile, TFolder, Component,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class {},
}, { get: (t, k) => (k in t ? t[k] : class {}) });

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_search_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { BrowseView, collapseSearches };\n');
const { BrowseView, collapseSearches } = require(tmp).__test;

/* -- a vault ------------------------------------------------------ */

const root = new TFolder('/');
const notes = [new TFile('Liberal internationalism.md'), new TFile('Realism.md')];

function makeView(recentSearches = []) {
  const saves = [];
  const plugin = {
    settings: {
      defaultSort: 'name', recentSearches, categoryProperty: '', hideEmptyFolders: true,
      albumColumns: 'domain, modified', albumNoteLimit: 8, coverProperty: 'cover',
    },
    saveData: async (s) => saves.push(JSON.parse(JSON.stringify(s.recentSearches))),
    saveSettings: async () => { throw new Error('saveSettings should not run for a search'); },
    isFolderNote: () => false,
    feature: () => null,
    folderHasNotes: () => true,
    recentFiles: () => [],
    pins: { files: () => [], folders: () => [], has: () => false },
    folderNote: () => null,
    folderCoverSrc: () => null,
  };
  const app = {
    workspace: { leftSplit: { expand() {} }, getLeaf: () => ({ openFile() {} }), trigger() {} },
    vault: {
      getRoot: () => root,
      getMarkdownFiles: () => notes,
      getFileByPath: () => null,
      getName: () => 'All the Notes',
    },
    metadataCache: { getFileCache: () => null },
  };
  plugin.app = app;
  const view = new BrowseView({ history: null }, plugin);
  view.app = app;
  view.mode = 'search';
  document.body.innerHTML = '';
  document.body.appendChild(view.containerEl);
  view.render();
  return { view, saves, plugin };
}

const field = (view) => view.contentEl.querySelector('.dr-browse-search input');
const typeInto = (input, text) => {
  for (let i = 1; i <= text.length; i++) {
    input.value = text.slice(0, i);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
};
const titles = (view) =>
  Array.from(view.contentEl.querySelectorAll('.dr-track-name')).map((e) => e.textContent);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  await t('typing keeps the same field, focused, the whole way through', () => {
    const { view } = makeView();
    const input = field(view);
    input.focus();
    for (const prefix of ['l', 'li', 'lib', 'liberal', 'liberal inter']) {
      input.value = prefix;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      assert.strictEqual(field(view), input, `field replaced at "${prefix}"`);
      assert.strictEqual(document.activeElement, input, `focus lost at "${prefix}"`);
    }
  });

  await t('results follow the query once typing pauses', async () => {
    const { view } = makeView();
    const input = field(view);
    typeInto(input, 'liberal');
    await new Promise((r) => setTimeout(r, 130));
    assert.deepStrictEqual(titles(view), ['Liberal internationalism']);
    typeInto(input, 'realism');
    await new Promise((r) => setTimeout(r, 130));
    assert.deepStrictEqual(titles(view), ['Realism']);
    assert.strictEqual(field(view), input, 'the field was replaced');
  });

  await t('typing saves nothing — no keystroke is a finished search', async () => {
    const { view, saves } = makeView();
    typeInto(field(view), 'liberal inter');
    await new Promise((r) => setTimeout(r, 10));
    assert.deepStrictEqual(saves, []);
  });

  await t('the field losing focus is not a finished search', async () => {
    const { view, saves } = makeView();
    const input = field(view);
    typeInto(input, 'liberal');
    input.dispatchEvent(new window.FocusEvent('blur'));
    await new Promise((r) => setTimeout(r, 10));
    assert.deepStrictEqual(saves, []);
  });

  await t('Enter saves the search once, as typed', async () => {
    const { view, saves } = makeView();
    const input = field(view);
    typeInto(input, 'liberal inter');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    assert.deepStrictEqual(saves, [['liberal inter']]);
  });

  await t('leaving the screen with something typed saves it', async () => {
    const { view, saves } = makeView(['older']);
    typeInto(field(view), 'realism');
    await view.setState({ mode: 'home' }, {});
    await new Promise((r) => setTimeout(r, 10));
    assert.deepStrictEqual(saves, [['realism', 'older']]);
    assert.strictEqual(view.query, '');
  });

  await t('opening a result saves the search that found it', async () => {
    const { view, saves } = makeView();
    typeInto(field(view), 'realism');
    view.openFile(notes[1]);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepStrictEqual(saves, [['realism']]);
  });

  await t('data arriving mid-typing leaves the field alone', async () => {
    const { view } = makeView();
    const input = field(view);
    input.focus();
    typeInto(input, 'lib');
    view.queueRender();
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(field(view), input);
    assert.strictEqual(document.activeElement, input);
  });

  await t('the list you have now repairs to the search you made', () => {
    const yours = ['liberal inter', 'liberal inte', 'liberal int', 'liberal in',
      'liberal i', 'liberal', 'libera', 'liber'];
    assert.deepStrictEqual(collapseSearches(yours), ['liberal inter']);
  });

  await t('separate searches that share a start are both kept', () => {
    // Newer shorter after older longer: two searches, not a keystroke run.
    assert.deepStrictEqual(collapseSearches(['liberal', 'liberal international']),
      ['liberal', 'liberal international']);
    assert.deepStrictEqual(collapseSearches(['realism', 'liberalism']), ['realism', 'liberalism']);
  });

  await t('the idle screen shows the repaired list', () => {
    const { view } = makeView(['liberal inter', 'liberal inte', 'liberal', 'liber', 'realism']);
    const shown = Array.from(view.contentEl.querySelectorAll('.dr-recent-title')).map((e) => e.textContent);
    assert.deepStrictEqual(shown, ['liberal inter', 'realism']);
  });

  fs.unlinkSync(tmp);
  console.log(`\n${passed} passed`);
})().catch((err) => {
  try { fs.unlinkSync(tmp); } catch (e) {}
  console.error(err);
  process.exit(1);
});
