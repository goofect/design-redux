// The library's filter button, against the real main.js: tag, property
// and date filters alongside the folder one, through the menu, the
// pickers and the chips, on the screens they narrow.
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
P.hasClass = function (c) { return this.classList.contains(c); };
P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
P.setText = function (t) { this.textContent = t; };
P.isShown = function () { return true; };

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
const DAY = 86400000;
class TFile extends TAbstractFile {
  constructor(p, ageDays = 0, createdDays = ageDays) {
    super(); this.path = p; this.name = p.split('/').pop();
    this.basename = this.name.replace(/\.[^.]+$/, ''); this.extension = 'md';
    this.stat = { mtime: Date.now() - ageDays * DAY, ctime: Date.now() - createdDays * DAY };
  }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p === '/' ? '' : p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
let menus = [];
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = { title: '', checked: false };
    item.setTitle = (t) => { item.title = t; return item; };
    item.setIcon = () => item;
    item.setChecked = (c) => { item.checked = !!c; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
  addSeparator() { return this; }
  showAtMouseEvent() { menus.push(this); }
  showAtPosition() { menus.push(this); }
  find(prefix) { return this.items.find((i) => i.title.startsWith(prefix)); }
}
let pickers = [];
class FuzzySuggestModal {
  constructor(app) { this.app = app; }
  setPlaceholder(p) { this.placeholder = p; }
  open() { pickers.push(this); }
  choose(label) {
    const item = this.getItems().find((i) => this.getItemText(i) === label);
    assert.ok(item, `no "${label}" among ${this.getItems().map((i) => this.getItemText(i)).join(', ')}`);
    this.onChooseItem(item);
  }
}
const obsidian = new Proxy({
  ItemView, TFile, TFolder, TAbstractFile, Component, Menu, FuzzySuggestModal,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class {},
  Platform: { isMobile: false },
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_filters_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { BrowseView, noteTags, dateFloor, Orders };\n');
const { BrowseView, noteTags, dateFloor, Orders } = require(tmp).__test;
fs.unlinkSync(tmp);

/* -- a vault -------------------------------------------------------------- */

const root = new TFolder('/');
const folders = {};
const files = [];
const caches = new Map();
const folder = (p, parent) => {
  const f = new TFolder(p); f.parent = parent; parent.children.push(f); folders[p] = f; return f;
};
const note = (parent, name, { tags = [], fm = {}, age = 0, created } = {}) => {
  const f = new TFile(`${parent.path === '/' ? '' : parent.path + '/'}${name}.md`, age, created === undefined ? age : created);
  f.parent = parent; parent.children.push(f); files.push(f);
  caches.set(f, { tags: tags.map((t) => ({ tag: t })), frontmatter: fm });
  return f;
};
const law = folder('Law', root);
const courts = folder('Law/Courts', law);
const politics = folder('Politics', root);
const misc = folder('Misc', root);
note(law, 'Contract', { tags: ['#law'], fm: { status: 'draft', domain: 'Law' }, age: 2 });
note(law, 'Tort', { fm: { status: 'Done', tags: ['law/tort'] }, age: 40 });
note(courts, 'Supreme Court', { tags: ['#law/courts'], fm: { domain: ['[[Politics]]', 'Law'] }, age: 0, created: 0 });
note(courts, 'Tribunal', { fm: { status: 'draft' }, age: 400, created: 400 });
note(politics, 'Realism', { tags: ['#theory'], fm: { domain: 'Politics' }, age: 5, created: 100 });
note(misc, 'Shopping', { fm: {}, age: 1 });

const plugin = {
  settings: {
    defaultSort: 'name', recentSearches: [], categoryProperty: '', hideEmptyFolders: false,
    albumColumns: '', albumNoteLimit: 8, discNoteLimit: 10, coverProperty: 'cover', tableColumns: '',
  },
  saveData: async () => {},
  isFolderNote: () => false,
  folderHasNotes: () => true,
  recentFiles: () => files.slice(),
  pins: { files: () => [], folders: () => [law, politics, misc], has: () => false },
  folderNote: () => null,
  folderCoverSrc: () => null,
  feature: () => null,
  propertyLabel: (k) => k,
};
const app = {
  workspace: {
    leftSplit: { expand() {} }, getLeaf: () => ({ openFile() {} }), trigger() {},
    // The open library pages, as Obsidian would list them.
    open: [],
    getLeavesOfType: () => app.workspace.open.map((view) => ({ view, isDeferred: false })),
  },
  vault: {
    getRoot: () => root,
    getMarkdownFiles: () => files,
    getFolderByPath: (p) => (p === '/' ? root : folders[p] || null),
    getFileByPath: () => null,
    getAbstractFileByPath: (p) => folders[p] || null,
    getName: () => 'All the Notes',
  },
  metadataCache: { getFileCache: (f) => caches.get(f) || null, getFirstLinkpathDest: () => null },
  metadataTypeManager: {
    getAllProperties: () => ({ status: { name: 'status', occurrences: 3 }, domain: { name: 'domain', occurrences: 3 } }),
  },
};
plugin.app = app;
plugin.orders = new Orders(plugin);

/** A library page. Each test starts from the default order and one page, unless it keeps them. */
function page(state, { keep = false } = {}) {
  if (!keep) {
    plugin.settings.defaultSort = 'name';
    plugin.settings.keepOwnOrder = { recents: true, pinned: true };
    app.workspace.open = [];
    document.body.innerHTML = '';
  }
  const leaf = { history: null, setViewState: async (vs) => view.setState(vs.state, {}) };
  const view = new BrowseView(leaf, plugin);
  view.app = app;
  app.workspace.open.push(view);
  document.body.appendChild(view.containerEl);
  Object.assign(view, { mode: 'notes', path: '/', property: null, value: null }, state);
  view.render();
  return view;
}
const shownNotes = (view) =>
  Array.from(view.contentEl.querySelectorAll('.dr-tr:not(.dr-th) .dr-td-text')).map((e) => e.textContent).sort();
const shownCards = (view) =>
  Array.from(view.contentEl.querySelectorAll('.dr-card-title')).map((e) => e.textContent).sort();
const openMenu = (view) => {
  menus = [];
  view.contentEl.querySelector('.dr-filter-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
  return menus[0];
};
const chips = (view) => Array.from(view.contentEl.querySelectorAll('.dr-chip-label')).map((e) => e.textContent);

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

t("a note's tags come from its text and its properties, nested ones included", () => {
  assert.deepStrictEqual(noteTags(caches.get(files[1])), ['law/tort']);
  assert.deepStrictEqual(noteTags({ tags: [{ tag: '#A' }], frontmatter: { tags: 'b, #c' } }), ['a', 'b', 'c']);
});

t('a tag filter keeps the notes with it, and those with tags nested under it', () => {
  const view = page({});
  view.filterTag = 'law';
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Contract', 'Supreme Court', 'Tort']);
  view.filterTag = 'law/courts';
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Supreme Court']);
});

t('a property filter: is, is not, has any, and has none — without regard to case', () => {
  const view = page({});
  view.filterProp = { key: 'status', value: 'draft', negate: false };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Contract', 'Tribunal']);
  view.filterProp = { key: 'Status', value: 'DONE', negate: false };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Tort']);
  view.filterProp = { key: 'status', value: 'draft', negate: true };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Realism', 'Shopping', 'Supreme Court', 'Tort']);
  view.filterProp = { key: 'domain', value: null, negate: false };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Contract', 'Realism', 'Supreme Court']);
  view.filterProp = { key: 'domain', value: null, negate: true };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Shopping', 'Tort', 'Tribunal']);
});

t('a list value matches any of its entries, links included', () => {
  const view = page({});
  view.filterProp = { key: 'domain', value: 'Politics', negate: false };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Realism', 'Supreme Court']);
});

t('a date filter, modified or created', () => {
  const view = page({});
  view.filterDate = { field: 'modified', range: 'week' };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Contract', 'Realism', 'Shopping', 'Supreme Court']);
  view.filterDate = { field: 'created', range: 'month' };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Contract', 'Shopping', 'Supreme Court']);
  view.filterDate = { field: 'modified', range: 'year' };
  view.render();
  assert.ok(!shownNotes(view).includes('Tribunal'));
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  assert.strictEqual(dateFloor('day'), midnight.getTime());
});

t('filters combine', () => {
  const view = page({});
  view.filterTag = 'law';
  view.filterDate = { field: 'modified', range: 'week' };
  view.render();
  assert.deepStrictEqual(shownNotes(view), ['Contract', 'Supreme Court']);
});

t('folder tiles show the folders holding a match, anywhere inside', () => {
  const view = page({ mode: 'folders' });
  view.filterTag = 'law/courts';
  view.render();
  assert.deepStrictEqual(shownCards(view), ['Courts', 'Law']);
  view.filterTag = null;
  view.render();
  assert.deepStrictEqual(shownCards(view), ['Courts', 'Law', 'Misc', 'Politics']);
});

t('pinned folders are narrowed the same way', () => {
  const view = page({ mode: 'pinned' });
  view.filterProp = { key: 'domain', value: 'Politics', negate: false };
  view.render();
  assert.deepStrictEqual(shownCards(view), ['Law', 'Politics']);
});

t("an album's discs without a match drop out", () => {
  const view = page({ mode: 'folder', path: 'Law' });
  view.filterProp = { key: 'status', value: 'draft', negate: false };
  view.render();
  const discs = Array.from(view.contentEl.querySelectorAll('.dr-disc-title')).map((e) => e.textContent);
  assert.deepStrictEqual(discs, ['Law', 'Courts']);
  const tracks = Array.from(view.contentEl.querySelectorAll('.dr-track-name')).map((e) => e.textContent);
  assert.deepStrictEqual(tracks, ['Contract', 'Tribunal']);
  view.filterDate = { field: 'modified', range: 'day' };
  view.render();
  assert.strictEqual(view.contentEl.querySelector('.dr-track-name'), null);
});

t('the menu lists the filters; a tag is chosen from a picker with counts', () => {
  const view = page({});
  const menu = openMenu(view);
  ['Folder…', 'Tag…', 'Property…', 'Date…'].forEach((title) => assert.ok(menu.find(title), title));
  assert.ok(!menu.find('Clear filters'), 'nothing to clear yet');
  pickers = [];
  menu.find('Tag…').click();
  const tagItems = pickers[0].getItems();
  assert.deepStrictEqual(tagItems.map((i) => [i.label, i.note]),
    [['#law', '1'], ['#law/courts', '1'], ['#law/tort', '1'], ['#theory', '1']]);
  pickers[0].choose('#law');
  assert.deepStrictEqual(shownNotes(view), ['Contract', 'Supreme Court', 'Tort']);
  assert.ok(view.contentEl.querySelector('.dr-filter-btn').classList.contains('is-active'));
  // Ticked and named in the menu; choosing it again turns it off.
  const again = openMenu(view);
  const on = again.find('Tagged #law');
  assert.ok(on && on.checked);
  on.click();
  assert.strictEqual(view.filterTag, null);
});

t('a property is chosen, then its value — or any value', () => {
  const view = page({});
  pickers = [];
  openMenu(view).find('Property…').click();
  pickers[0].choose('status');
  assert.strictEqual(pickers[1].getItems()[0].label, 'Has any status');
  pickers[1].choose('draft');
  assert.deepStrictEqual(view.filterProp, { key: 'status', value: 'draft', negate: false });
  assert.deepStrictEqual(shownNotes(view), ['Contract', 'Tribunal']);
  // Exclude instead.
  const exclude = openMenu(view).find('Exclude these instead');
  assert.ok(exclude && !exclude.checked);
  exclude.click();
  assert.ok(!shownNotes(view).includes('Contract'));
  assert.deepStrictEqual(chips(view), ['status is not draft']);
});

t('a date is chosen from the ranges', () => {
  const view = page({});
  pickers = [];
  openMenu(view).find('Date…').click();
  pickers[0].choose('Created in the past month');
  assert.deepStrictEqual(view.filterDate, { field: 'created', range: 'month' });
});

t('chips name the filters in effect; a cross removes one, the name changes it', () => {
  const view = page({});
  view.filterFolder = 'Law';
  view.filterTag = 'law';
  view.filterDate = { field: 'modified', range: 'week' };
  view.render();
  assert.deepStrictEqual(chips(view), ['In Law', '#law', 'Modified in the past week']);
  view.contentEl.querySelectorAll('.dr-chip-clear')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(view.filterTag, null);
  assert.deepStrictEqual(chips(view), ['In Law', 'Modified in the past week']);
  pickers = [];
  view.contentEl.querySelectorAll('.dr-chip-label')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(pickers[0].placeholder, 'When?');
});

t('Clear filters takes them all off', () => {
  const view = page({});
  view.filterTag = 'law';
  view.filterProp = { key: 'status', value: null, negate: false };
  view.render();
  openMenu(view).find('Clear filters').click();
  assert.strictEqual(view.hasFilters(), false);
  assert.strictEqual(view.contentEl.querySelector('.dr-filter-chips'), null);
  assert.strictEqual(shownNotes(view).length, 6);
});

t('moving to another screen starts unfiltered, as the folder filter always has', async () => {
  const view = page({});
  view.filterTag = 'law';
  await view.setState({ mode: 'recents' }, {});
  assert.strictEqual(view.hasFilters(), false);
});


/* -- alphabetical ------------------------------------------------------ */

t('the menu offers alphabetical both ways, and by date', () => {
  const view = page({ mode: 'folders' });
  const titles = openMenu(view).items.slice(0, 4).map((i) => i.title);
  assert.deepStrictEqual(titles, ['Alphabetical (A–Z)', 'Alphabetical (Z–A)', 'Recently modified', 'Recently created']);
});

t('Z–A reverses the Notes table, and its Title column says so', () => {
  const view = page({});
  const menu = openMenu(view);
  assert.ok(menu.find('Alphabetical (A–Z)').checked, 'the table follows the shared order');
  menu.find('Alphabetical (Z–A)').click();
  const rows = Array.from(view.contentEl.querySelectorAll('.dr-tr:not(.dr-th) .dr-td-text')).map((e) => e.textContent);
  assert.deepStrictEqual(rows, ['Tribunal', 'Tort', 'Supreme Court', 'Shopping', 'Realism', 'Contract']);
  const sorted = view.contentEl.querySelector('.dr-th .dr-td.is-sorted');
  assert.strictEqual(sorted.querySelector('.dr-td-text').textContent, 'Title');
  assert.ok(openMenu(view).find('Alphabetical (Z–A)').checked);
});

t('numbers in names sort by value: Week 2 before Week 10', () => {
  const extra = [note(misc, 'Week 10'), note(misc, 'Week 2'), note(misc, 'week 1')];
  try {
    const view = page({});
    openMenu(view).find('Alphabetical (A–Z)').click();
    const rows = Array.from(view.contentEl.querySelectorAll('.dr-tr:not(.dr-th) .dr-td-text'))
      .map((e) => e.textContent).filter((n) => /week/i.test(n));
    assert.deepStrictEqual(rows, ['week 1', 'Week 2', 'Week 10']);
  } finally {
    extra.forEach((f) => { files.splice(files.indexOf(f), 1); misc.children.splice(misc.children.indexOf(f), 1); });
  }
});

t('Recently opened keeps its own order until an order is chosen', () => {
  const view = page({ mode: 'recents' });
  const before = Array.from(view.contentEl.querySelectorAll('.dr-card-title')).map((e) => e.textContent);
  assert.deepStrictEqual(before, files.map((f) => f.basename), 'recency order');
  openMenu(view).find('Alphabetical (A–Z)').click();
  const after = Array.from(view.contentEl.querySelectorAll('.dr-card-title')).map((e) => e.textContent);
  assert.deepStrictEqual(after, ['Contract', 'Realism', 'Shopping', 'Supreme Court', 'Tort', 'Tribunal']);
});

t('folder tiles follow alphabetical either way', () => {
  const view = page({ mode: 'folders' });
  openMenu(view).find('Alphabetical (Z–A)').click();
  assert.deepStrictEqual(
    Array.from(view.contentEl.querySelectorAll('.dr-card-title')).map((e) => e.textContent),
    ['Politics', 'Misc', 'Law', 'Courts']
  );
  openMenu(view).find('Alphabetical (A–Z)').click();
  assert.deepStrictEqual(
    Array.from(view.contentEl.querySelectorAll('.dr-card-title')).map((e) => e.textContent),
    ['Courts', 'Law', 'Misc', 'Politics']
  );
});

t("an album's notes follow Z–A too", () => {
  const view = page({ mode: 'folder', path: 'Law' });
  openMenu(view).find('Alphabetical (Z–A)').click();
  const tracks = Array.from(view.contentEl.querySelectorAll('.dr-track-name')).map((e) => e.textContent);
  assert.deepStrictEqual(tracks.slice(0, 2), ['Tort', 'Contract']);
});


/* -- one order, across the system --------------------------------------- */

const titles = (view, sel = '.dr-card-title') =>
  Array.from(view.contentEl.querySelectorAll(sel)).map((e) => e.textContent);

t('an order chosen on one screen is saved, and every open screen follows it', () => {
  const folderTiles = page({ mode: 'folders' });
  const notesTable = page({ mode: 'notes' }, { keep: true });
  openMenu(folderTiles).find('Alphabetical (Z–A)').click();
  assert.strictEqual(plugin.settings.defaultSort, 'name-desc', 'not saved');
  assert.deepStrictEqual(titles(notesTable, '.dr-tr:not(.dr-th) .dr-td-text'),
    ['Tribunal', 'Tort', 'Supreme Court', 'Shopping', 'Realism', 'Contract'], 'the other open screen');
});

t('and a page built later — after a note, a new tab, a restart — starts in it', () => {
  page({ mode: 'folders' });
  openMenu(app.workspace.open[0]).find('Alphabetical (Z–A)').click();
  const later = page({ mode: 'folders' }, { keep: true });
  assert.deepStrictEqual(titles(later), ['Politics', 'Misc', 'Law', 'Courts']);
});

t("an album's discs follow the order, as do a folder's subfolder tiles", () => {
  const extra = folder('Law/Appeals', law);
  const appeal = note(extra, 'Appeal', { age: 0 });
  try {
    const album = page({ mode: 'folder', path: 'Law' });
    const discs = () => titles(album, '.dr-disc-title');
    assert.deepStrictEqual(discs(), ['Law', 'Appeals', 'Courts']);
    openMenu(album).find('Alphabetical (Z–A)').click();
    assert.deepStrictEqual(discs(), ['Law', 'Courts', 'Appeals'], "the folder's own disc stays first");

    // By date, the disc with the newest note leads.
    caches.get(appeal); appeal.stat.mtime = Date.now() + 1000;
    openMenu(album).find('Recently modified').click();
    assert.deepStrictEqual(discs(), ['Law', 'Appeals', 'Courts']);
  } finally {
    law.children.splice(law.children.indexOf(extra), 1);
    files.splice(files.indexOf(appeal), 1);
    delete folders['Law/Appeals'];
  }
});

t('the subfolder tiles of a folder of folders follow it too', () => {
  const shelf = folder('Shelf', root);
  const a = folder('Shelf/Alpha', shelf); note(a, 'One', { age: 30 });
  const z = folder('Shelf/Zulu', shelf); note(z, 'Two', { age: 0 });
  try {
    const view = page({ mode: 'folder', path: 'Shelf' });
    assert.deepStrictEqual(titles(view), ['Alpha', 'Zulu']);
    openMenu(view).find('Recently modified').click();
    assert.deepStrictEqual(titles(view), ['Zulu', 'Alpha'], 'newest note first');
    openMenu(view).find('Alphabetical (Z–A)').click();
    assert.deepStrictEqual(titles(view), ['Zulu', 'Alpha']);
  } finally {
    root.children.splice(root.children.indexOf(shelf), 1);
    [a, z].forEach((f) => f.children.forEach((n) => files.splice(files.indexOf(n), 1)));
    ['Shelf', 'Shelf/Alpha', 'Shelf/Zulu'].forEach((p) => delete folders[p]);
  }
});

t("Home's folder shelf follows it", () => {
  const view = page({ mode: 'home' });
  openMenu(view).find('Alphabetical (Z–A)').click();
  const shelves = Array.from(view.contentEl.querySelectorAll('.dr-shelf-head'));
  const folderShelf = shelves.find((h) => h.textContent.startsWith('Folders')).nextElementSibling;
  assert.deepStrictEqual(Array.from(folderShelf.querySelectorAll('.dr-card-title')).map((e) => e.textContent),
    ['Politics', 'Misc', 'Law']);
});

t("the Properties screen's list and a property's values follow it", () => {
  const view = page({ mode: 'properties', property: 'status' });
  const props = () => titles(view, '.dr-split-name');
  const values = () => titles(view, '.dr-album-name');
  assert.deepStrictEqual(props(), ['domain', 'status']);
  assert.deepStrictEqual(values(), ['Done', 'draft']);
  openMenu(view).find('Alphabetical (Z–A)').click();
  assert.deepStrictEqual(props(), ['status', 'domain']);
  assert.deepStrictEqual(values(), ['draft', 'Done']);
  openMenu(view).find('Recently modified').click();
  assert.deepStrictEqual(values(), ['draft', 'Done'], 'draft has the newest note (Contract)');
});

t('Properties, in Edit: names to change, circles to pick, and Merge for two or more', () => {
  const opened = [];
  const renamed = [];
  let clash = false;
  const tools = {
    openMerge: (names) => opened.push(['merge', names]),
    openRenameProperty: (from, to) => opened.push(['rename', from, to]),
  };
  plugin.feature = () => tools;
  plugin.bulk = {
    last: null,
    planPropertyRename: () => ({ conflicts: clash ? [files[0]] : [], merged: [], total: 1 }),
    renameProperty: async (from, to) => {
      renamed.push([from, to]);
      return { files: [], bases: [], failed: [] };
    },
    // Some notes write status with a capital.
    propertySpellings: () => new Map([
      ['status', new Map([['status', 2], ['Status', 1]])],
      ['domain', new Map([['domain', 3]])],
    ]),
  };
  try {
    const view = page({ mode: 'properties' });
    const edit = view.contentEl.querySelector('.dr-bar-edit');
    assert.strictEqual(edit.textContent, 'Edit');
    edit.click();
    assert.strictEqual(view.editing, true);
    const fields = () => Array.from(view.contentEl.querySelectorAll('.dr-split-row.is-editing input.dr-edit-name'));
    assert.deepStrictEqual(fields().map((i) => i.value), ['domain', 'status']);
    assert.strictEqual(view.contentEl.querySelector('.dr-bar-edit').textContent, 'Done');
    const merge = () => view.contentEl.querySelector('.dr-prop-merge');
    assert.strictEqual(merge().disabled, true);

    // Picked by the circle or the row; Merge takes them.
    const rows = Array.from(view.contentEl.querySelectorAll('.dr-split-row.is-editing'));
    rows[0].querySelector('.dr-prop-pick').click();
    rows[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepStrictEqual(rows.map((r) => r.classList.contains('is-picked')), [true, true]);
    assert.strictEqual(merge().disabled, false);
    assert.strictEqual(merge().textContent, 'Merge 2…');
    merge().click();
    assert.deepStrictEqual(opened.pop(), ['merge', ['domain', 'status']]);

    // A name changed renames it everywhere; one that needs a look opens the rename.
    fields()[0].value = 'area';
    fields()[0].dispatchEvent(new window.Event('blur'));
    assert.deepStrictEqual(renamed.pop(), ['domain', 'area']);
    clash = true;
    const status = fields()[1];
    status.dispatchEvent(new window.Event('focus'));
    status.value = 'state';
    status.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepStrictEqual(opened.pop(), ['rename', 'status', 'state']);
    assert.strictEqual(renamed.length, 0);

    // Written two ways: shown, and one press writes it as listed.
    clash = false;
    view.propPicks = new Set();
    view.render();
    const spelled = Array.from(view.contentEl.querySelectorAll('.dr-prop-spelling'));
    assert.deepStrictEqual(spelled.map((b) => b.textContent), ['“Status” in 1']);
    spelled[0].click();
    assert.deepStrictEqual(renamed.pop(), ['status', 'status']);
    assert.ok(!view.contentEl.querySelector('.dr-split-row.is-picked'), 'the press picks nothing');
    // Enter on the name as it is does the same; on one written one way, nothing.
    const same = fields()[1];
    same.dispatchEvent(new window.Event('focus'));
    same.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepStrictEqual(renamed.pop(), ['status', 'status']);
    const plain = fields()[0];
    plain.dispatchEvent(new window.Event('focus'));
    plain.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.strictEqual(renamed.length, 0);

    view.contentEl.querySelector('.dr-bar-edit').click();
    assert.strictEqual(view.editing, false);
    assert.ok(view.contentEl.querySelector('.dr-split-name:not(input)'));
  } finally {
    plugin.feature = () => null;
    delete plugin.bulk;
  }
});

t('the Notes Title column sets the order everywhere; a property column stays in the table', () => {
  const notesTable = page({ mode: 'notes' });
  const tiles = page({ mode: 'folders' }, { keep: true });
  const heading = (label) => Array.from(notesTable.contentEl.querySelectorAll('.dr-th .dr-td'))
    .find((c) => c.textContent.startsWith(label));
  heading('Title').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(plugin.settings.defaultSort, 'name-desc');
  assert.deepStrictEqual(titles(tiles), ['Politics', 'Misc', 'Law', 'Courts']);
});

t('Recently opened offers its own order first, and goes back to it', () => {
  const view = page({ mode: 'recents' });
  const menu = openMenu(view);
  assert.strictEqual(menu.items[0].title, 'Most recently opened');
  assert.ok(menu.items[0].checked);
  menu.find('Alphabetical (A–Z)').click();
  assert.deepStrictEqual(titles(view), ['Contract', 'Realism', 'Shopping', 'Supreme Court', 'Tort', 'Tribunal']);
  assert.strictEqual(plugin.settings.keepOwnOrder.recents, false);
  openMenu(view).find('Most recently opened').click();
  assert.deepStrictEqual(titles(view), files.map((f) => f.basename));
  assert.strictEqual(plugin.settings.keepOwnOrder.recents, true);
  assert.strictEqual(plugin.settings.defaultSort, 'name', 'the shared order is untouched');
});

t('the filter button lights only when the order differs from the usual one', () => {
  const view = page({ mode: 'folders' });
  const lit = () => view.contentEl.querySelector('.dr-filter-btn').classList.contains('is-active');
  assert.ok(!lit());
  openMenu(view).find('Recently created').click();
  assert.ok(lit());
  openMenu(view).find('Alphabetical (A–Z)').click();
  assert.ok(!lit());
});

console.log(`\n${passed} passed`);
