// Renders the real LibraryView into jsdom, with Obsidian's element
// helpers stubbed, and checks the parts of the sidebar that carry logic:
// which single row is highlighted, the disclosure, and the panel class.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.CSS = { escape: (s) => s };

// Obsidian's additions to elements, enough for the view to run.
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
P.isShown = function () { return !this.closest('.is-hidden'); };

class Component { registerEvent() {} register() {} }
class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.containerEl = document.createElement('div');
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
  }
}
class TAbstractFile {}
class TFile extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.[^.]+$/, ''); this.extension = this.name.split('.').pop(); }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
class MarkdownView { constructor(file) { this.file = file; } getMode() { return 'source'; } }
let lastMenu = null;
class Menu {
  constructor() { this.items = []; this.shownAt = null; }
  addItem(cb) {
    const item = { title: '', icon: '', click: null };
    item.setTitle = (t) => { item.title = t; return item; };
    item.setIcon = (i) => { item.icon = i; return item; };
    item.setChecked = () => item;
    item.onClick = (f) => { item.click = f; return item; };
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() { this.items.push({ title: '---' }); return this; }
  showAtMouseEvent(evt) { this.shownAt = 'pointer'; lastMenu = this; }
  showAtPosition(pos) { this.shownAt = 'position'; lastMenu = this; }
  titles() { return this.items.map((i) => i.title); }
}
class Modal { constructor(app) { this.app = app; } open() {} close() {} }
const obsidian = new Proxy({
  ItemView, TFile, TFolder, TAbstractFile, MarkdownView, Component, Menu, Modal,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Notice: class {},
  normalizePath: (p) => p.replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_sidebar_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { fullNameOnHover, LibraryView, BrowseView, Library, ContextStrip, DesignRedux, SidebarDrop, BUILTIN_SCREENS, clearSidebarChrome, showTargetMenu, pageFolder, headerDuplicates, Files };\n');
const { fullNameOnHover, LibraryView, BrowseView, Library, ContextStrip, DesignRedux, SidebarDrop, clearSidebarChrome, showTargetMenu, pageFolder, headerDuplicates, Files } = require(tmp).__test;

/* -- a vault and a plugin ----------------------------------------- */

const folders = {
  'Concepts Folder': new TFolder('Concepts Folder'),
  'Books Folder': new TFolder('Books Folder'),
};
const files = {
  'Concepts Folder/Logic.md': new TFile('Concepts Folder/Logic.md'),
  'Home.md': new TFile('Home.md'),
};
// Real files always know their folder.
const root = new TFolder('/');
root.path = '/';
files['Concepts Folder/Logic.md'].parent = folders['Concepts Folder'];
files['Home.md'].parent = root;
folders['Concepts Folder'].parent = root;
folders['Books Folder'].parent = root;
const all = Object.assign({}, folders, files);

function setup({ page, pinsExpanded = false, pinned = [] } = {}) {
  const sections = [
    { title: '', items: [{ kind: 'builtin', id: 'search' }, { kind: 'builtin', id: 'home' }] },
    { title: 'Library', items: [
      { kind: 'builtin', id: 'bookmarks' },
      { kind: 'builtin', id: 'recents' },
      { kind: 'builtin', id: 'properties' },
      { kind: 'builtin', id: 'folders' },
      { kind: 'builtin', id: 'notes' },
    ] },
    { title: 'Folders', items: [
      { kind: 'folder', path: 'Concepts Folder' },
      { kind: 'folder', path: 'Books Folder' },
      { kind: 'property', key: 'domain' },
    ] },
  ];
  const triggered = [];
  const workspace = {
    rootSplit: {},
    getMostRecentLeaf: () => page,
    on: () => ({}),
    trigger: (...args) => triggered.push(args),
  };
  const app = {
    workspace,
    vault: {
      getName: () => 'All the Notes',
      getAbstractFileByPath: (p) => all[p] || null,
      getFileByPath: (p) => files[p] || null,
      getResourcePath: (f) => 'app://' + f.path,
    },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
    commands: { executeCommandById() {} },
  };
  const saved = [];
  const created = [];
  const plugin = {
    app,
    settings: { librarySections: sections, pinsExpanded, coverProperty: 'cover' },
    saveData: (s) => saved.push(JSON.parse(JSON.stringify(s))),
    propertyLabel: (k) => k.charAt(0).toUpperCase() + k.slice(1),
    folderCoverSrc: (f) => (f.name === 'Books Folder' ? 'app://books.jpg' : null),
    feature: () => null,
    refreshBrowse() {},
    newNote: (f) => created.push(['note', f.path]),
    newFolder: (f) => created.push(['folder', f.path]),
    setFolderCover() {},
    setNoteCover() {},
    togglePin() {},
    pins: {
      has: () => false,
      instance: () => null,
      folders: () => pinned.filter((t) => t instanceof TFolder),
      files: () => pinned.filter((t) => t instanceof TFile),
      all: () => pinned.filter((t) => t instanceof TFolder).concat(pinned.filter((t) => t instanceof TFile)),
    },
  };
  const view = new LibraryView({}, plugin);
  view.app = app;
  // Dock it in a left sidebar, so the panel shape has somewhere to go.
  const split = document.body.appendChild(document.createElement('div'));
  split.className = 'workspace-split mod-left-split';
  const profile = split.createDiv({ cls: 'workspace-sidedock-vault-profile' });
  profile.createDiv({ cls: 'workspace-drawer-vault-switcher' });
  const leafEl = split.createDiv({ cls: 'workspace-leaf' });
  leafEl.appendChild(view.containerEl);
  view.syncChrome();
  view.render();
  return { view, split, leafEl, saved, plugin, created, triggered, app };
}

const browsePage = (mode, extra) => {
  const v = Object.create(BrowseView.prototype);
  Object.assign(v, { mode, path: '/', property: null }, extra);
  return { view: v, isDeferred: false };
};
const notePage = (p) => ({ view: new MarkdownView(files[p]), isDeferred: false });

const active = (view) =>
  Array.from(view.contentEl.querySelectorAll('.dr-lib-row.is-active')).map(
    (el) => el.querySelector('.dr-lib-label').textContent
  );

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

t('drawn again with nothing changed, the rows on screen stay — their covers don’t flash', () => {
  const { view } = setup({ page: browsePage('search') });
  const before = view.contentEl.querySelector('.dr-lib-row');
  view.render();
  assert.strictEqual(view.contentEl.querySelector('.dr-lib-row'), before, 'the same row, not one drawn again');
  assert.deepStrictEqual(active(view), ['Search'], 'still marked where you are');
  // A name pointed at shows in full: still the same rows, drawn again or not.
  before.setAttribute('title', 'Search');
  before.dataset.drFullName = '';
  view.render();
  assert.strictEqual(view.contentEl.querySelector('.dr-lib-row'), before, 'a tooltip isn’t a change in what’s listed');
  view.plugin.settings.librarySections[0].items.reverse();
  view.render();
  assert.notStrictEqual(view.contentEl.querySelector('.dr-lib-row'), before, 'changed: drawn again');
});

t('More folds away the occasional places, and opens again, remembered', () => {
  const { view } = setup({ page: browsePage('search') });
  view.plugin.settings.librarySections.push({ title: 'More', folded: true, items: [{ kind: 'builtin', id: 'graph' }] });
  view.render();
  const labels = () => Array.from(view.contentEl.querySelectorAll('.dr-lib-label')).map((e) => e.textContent);
  const head = () => view.contentEl.querySelector('.dr-lib-fold');
  assert.ok(!labels().includes('Graph'));
  assert.strictEqual(head().getAttribute('aria-expanded'), 'false');
  head().click();
  assert.ok(labels().includes('Graph'));
  assert.strictEqual(view.plugin.settings.librarySections.pop().folded, false);
});

/* -- the highlight ------------------------------------------------- */

t('Search screen highlights Search, and only Search', () => {
  assert.deepStrictEqual(active(setup({ page: browsePage('search') }).view), ['Search']);
});

t('each library screen highlights its own entry', () => {
  const cases = { home: 'Home', recents: 'Recently opened', properties: 'Properties',
    folders: 'Collections', notes: 'All Notes' };
  Object.entries(cases).forEach(([mode, label]) =>
    assert.deepStrictEqual(active(setup({ page: browsePage(mode) }).view), [label], mode));
});

t('Pinned is a group, not a place, so it never takes the highlight', () => {
  assert.deepStrictEqual(active(setup({ page: browsePage('pinned') }).view), []);
});

t('a property with its own row wins over the general entry', () => {
  const { view } = setup({ page: browsePage('properties', { property: 'domain' }) });
  assert.deepStrictEqual(active(view), ['Domain']);
});

t('a property without a row falls back to Properties', () => {
  const { view } = setup({ page: browsePage('properties', { property: 'status' }) });
  assert.deepStrictEqual(active(view), ['Properties']);
});

t('a folder screen highlights its folder', () => {
  const { view } = setup({ page: browsePage('folder', { path: 'Books Folder' }) });
  assert.deepStrictEqual(active(view), ['Books Folder']);
});

t('a note highlights the folder it sits in', () => {
  const { view } = setup({ page: notePage('Concepts Folder/Logic.md') });
  assert.deepStrictEqual(active(view), ['Concepts Folder']);
});

t('a folder shown twice is highlighted once', () => {
  const { view } = setup({
    page: browsePage('folder', { path: 'Books Folder' }),
    pinsExpanded: true,
    pinned: [folders['Books Folder']],
  });
  assert.strictEqual(active(view).length, 1);
});

t('nothing lights up for a page the sidebar has no row for', () => {
  assert.deepStrictEqual(active(setup({ page: null }).view), []);
  assert.deepStrictEqual(active(setup({ page: notePage('Home.md') }).view), []);
});

/* -- rows ---------------------------------------------------------- */

t('no counts, a gutter on every row, and artwork where there is some', () => {
  const { view } = setup({ page: null });
  const rows = Array.from(view.contentEl.querySelectorAll('.dr-lib-row'));
  assert.ok(rows.length >= 9);
  rows.forEach((r) => assert.ok(r.querySelector('.dr-lib-disclosure'), 'missing gutter'));
  assert.strictEqual(view.contentEl.querySelectorAll('.dr-lib-badge').length, 0);
  const books = rows.find((r) => r.textContent.includes('Books Folder'));
  assert.ok(books.querySelector('.dr-lib-icon.has-art img'), 'cover not shown');
  const concepts = rows.find((r) => r.textContent.includes('Concepts Folder'));
  assert.strictEqual(concepts.querySelector('.dr-lib-icon').dataset.icon, 'folder');
});

/* -- the disclosure ------------------------------------------------ */

t('only Pinned is expandable, and it starts closed', () => {
  const { view } = setup({ page: null, pinned: [folders['Books Folder']] });
  const expandable = view.contentEl.querySelectorAll('.dr-lib-disclosure.is-expandable');
  assert.strictEqual(expandable.length, 1);
  assert.strictEqual(view.contentEl.querySelectorAll('.dr-lib-row.is-nested').length, 0);
});

t('the chevron opens pins in place without leaving the page', () => {
  const { view, saved } = setup({ page: null, pinned: [folders['Books Folder'], files['Home.md']] });
  let navigated = false;
  view.browseMode = () => { navigated = true; };
  view.contentEl.querySelector('.dr-lib-disclosure.is-expandable')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(navigated, false, 'chevron also navigated');
  const nested = Array.from(view.contentEl.querySelectorAll('.dr-lib-row.is-nested'));
  assert.deepStrictEqual(nested.map((r) => r.textContent), ['Books Folder', 'Home']);
  assert.strictEqual(saved.pop().pinsExpanded, true);
  assert.ok(view.contentEl.querySelector('.dr-lib-disclosure.is-open'));
});

t('clicking Pinned opens and closes it, and goes nowhere', () => {
  const { view, saved } = setup({ page: null, pinned: [folders['Books Folder'], files['Home.md']] });
  let navigated = false;
  view.browseMode = () => { navigated = true; };
  const row = () => view.contentEl.querySelector('.dr-lib-row[data-group="pins"]');
  const click = () => row().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  click();
  assert.strictEqual(view.contentEl.querySelectorAll('.dr-lib-row.is-nested').length, 2);
  assert.strictEqual(row().getAttribute('aria-expanded'), 'true');
  assert.strictEqual(saved.pop().pinsExpanded, true);

  click();
  assert.strictEqual(view.contentEl.querySelectorAll('.dr-lib-row.is-nested').length, 0);
  assert.strictEqual(row().getAttribute('aria-expanded'), 'false');
  assert.strictEqual(saved.pop().pinsExpanded, false);

  assert.strictEqual(navigated, false, 'the Pinned screen was opened');
});

t('Enter on Pinned toggles it too', () => {
  const { view } = setup({ page: null, pinned: [files['Home.md']] });
  view.browseMode = () => { throw new Error('navigated'); };
  const row = () => view.contentEl.querySelector('.dr-lib-row[data-group="pins"]');
  row().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.strictEqual(view.contentEl.querySelectorAll('.dr-lib-row.is-nested').length, 1);
});

t('right arrow opens, left arrow closes', () => {
  const { view } = setup({ page: null, pinned: [files['Home.md']] });
  const row = () => view.contentEl.querySelector('.dr-lib-row[data-group="pins"]');
  row().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.strictEqual(view.contentEl.querySelectorAll('.dr-lib-row.is-nested').length, 1);
  row().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.strictEqual(view.contentEl.querySelectorAll('.dr-lib-row.is-nested').length, 0);
});

t('opened out with nothing pinned says so', () => {
  const { view } = setup({ page: null, pinsExpanded: true });
  assert.ok(view.contentEl.querySelector('.dr-lib-empty'));
});

/* -- the panel ----------------------------------------------------- */

t('the panel shape follows the view being shown, and comes off cleanly', () => {
  document.body.innerHTML = '';
  const { view, split } = setup({ page: null });
  assert.ok(split.classList.contains('dr-apple-sidebar'));
  assert.strictEqual(
    split.querySelector('.workspace-drawer-vault-switcher').getAttribute('data-dr-initial'), 'A');

  const leafEl = view.containerEl.closest('.workspace-leaf');
  leafEl.style.display = 'none'; // another sidebar tab chosen
  view.syncChrome();
  assert.ok(!split.classList.contains('dr-apple-sidebar'));

  leafEl.style.display = '';
  view.syncChrome();
  clearSidebarChrome();
  assert.strictEqual(document.querySelectorAll('.dr-apple-sidebar, [data-dr-initial]').length, 0);
});

t('docked outside the left sidebar, it leaves the surroundings alone', () => {
  document.body.innerHTML = '';
  const { view, split } = setup({ page: null });
  split.classList.remove('mod-left-split');
  split.classList.remove('dr-apple-sidebar');
  view.syncChrome();
  assert.ok(!split.classList.contains('dr-apple-sidebar'));
});


/* -- reported: the panel after closing and reopening ---------------- */

t('collapsing the sidebar leaves the panel shape in place for reopening', () => {
  document.body.innerHTML = '';
  const { view, split } = setup({ page: null });
  split.classList.add('is-sidedock-collapsed', 'is-hidden'); // collapsed
  view.syncChrome();
  assert.ok(split.classList.contains('dr-apple-sidebar'), 'lost on collapse');
});

t('reopening the sidebar brings the library back when tabs are hidden', () => {
  const run = (singleArea) => {
    let revealed = 0;
    const lib = Object.create(Library.prototype);
    lib.plugin = {
      app: {
        workspace: {
          leftSplit: { collapsed: false },
          getLeavesOfType: () => [],
        },
      },
      settings: { singleArea, library: true },
    };
    lib.showLibraryTab = () => revealed++;
    lib.wasCollapsed = true;
    lib.followSidebar();
    return revealed;
  };
  assert.strictEqual(run(true), 1);
  assert.strictEqual(run(false), 0, 'tabs visible: leave the choice alone');
});

t('a closed sidebar is marked on the body, for the show-sidebar buttons', () => {
  const lib = Object.create(Library.prototype);
  lib.plugin = {
    app: { workspace: { leftSplit: { collapsed: true }, getLeavesOfType: () => [] } },
    settings: { singleArea: true, library: true },
  };
  lib.followSidebar();
  assert.ok(document.body.classList.contains('dr-left-collapsed'));
  lib.plugin.app.workspace.leftSplit.collapsed = false;
  lib.followSidebar();
  assert.ok(!document.body.classList.contains('dr-left-collapsed'));
});

/* -- reported: right-click to create -------------------------------- */

const rightClick = (el) =>
  el.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));

t('right-clicking a folder in the sidebar offers New note and New folder', () => {
  document.body.innerHTML = '';
  const { view, created, triggered } = setup({ page: null });
  lastMenu = null;
  const row = Array.from(view.contentEl.querySelectorAll('.dr-lib-row'))
    .find((r) => r.textContent === 'Concepts Folder');
  rightClick(row);
  assert.ok(lastMenu, 'no menu');
  const titles = lastMenu.titles();
  assert.deepStrictEqual(titles.slice(0, 3), ['Open folder', 'New note', 'New folder']);
  assert.ok(titles.includes('Set cover image') && titles.includes('Pin'));
  lastMenu.items[1].click();
  lastMenu.items[2].click();
  assert.deepStrictEqual(created, [['note', 'Concepts Folder'], ['folder', 'Concepts Folder']]);
  assert.strictEqual(triggered[0][0], 'file-menu', "Obsidian's own entries not asked for");
});

t('a note gets no create items, and the vault root gets only those', () => {
  const { plugin } = setup({ page: null });
  const evt = new window.MouseEvent('contextmenu', { clientX: 1, clientY: 1 });
  showTargetMenu(plugin, evt, files['Home.md']);
  assert.ok(!lastMenu.titles().includes('New note'));

  showTargetMenu(plugin, evt, root, { here: true });
  assert.deepStrictEqual(lastMenu.titles().filter((x) => x !== '---'), ['New note', 'New folder', 'New canvas']);
});

t('a keyboard-opened menu is placed under its button, not at nothing', () => {
  const { plugin } = setup({ page: null });
  const btn = document.body.appendChild(document.createElement('div'));
  const evt = new window.KeyboardEvent('keydown', { key: 'Enter' });
  Object.defineProperty(evt, 'target', { value: btn });
  showTargetMenu(plugin, evt, folders['Books Folder']);
  assert.strictEqual(lastMenu.shownAt, 'position');
});

t('new names never overwrite: Untitled, then Untitled 1, and so on', () => {
  const taken = new Set(['Concepts Folder/Untitled.md', 'Concepts Folder/Untitled 1.md']);
  const ctx = { app: { vault: { getAbstractFileByPath: (p) => (taken.has(p) ? {} : null) } } };
  const files = new Files(ctx);
  const free = (f, b, e) => files.freeChildPath(f, b, e);
  assert.strictEqual(free(folders['Concepts Folder'], 'Untitled', 'md'), 'Concepts Folder/Untitled 2.md');
  assert.strictEqual(free(root, 'Untitled', 'md'), 'Untitled.md');
});

t('the page folder is the folder shown, or the open note\'s', () => {
  const app = (page) => ({ workspace: { rootSplit: {}, getMostRecentLeaf: () => page } });
  const folderScreen = browsePage('folder', { path: 'Books Folder' });
  folderScreen.view.folder = () => folders['Books Folder'];
  assert.strictEqual(pageFolder(app(folderScreen)), folders['Books Folder']);
  assert.strictEqual(pageFolder(app(notePage('Concepts Folder/Logic.md'))), folders['Concepts Folder']);
  assert.strictEqual(pageFolder(app(browsePage('search'))), null);
});

/* -- the strip ------------------------------------------------------ */

function strip(page) {
  const { app, plugin } = setup({ page });
  app.workspace.leftSplit = { expanded: 0, expand() { this.expanded++; } };
  plugin.app = app;
  plugin.orders = { arrangeAlbum: (f, files, fallback) => fallback(files), albumOn: () => false, hasAlbum: () => false, pinOrder: () => [], arrangePins: (x) => x };
  plugin.isFolderNote = plugin.isFolderNote || (() => false);
  const cs = Object.create(ContextStrip.prototype);
  cs.plugin = plugin;
  cs.el = document.body.appendChild(document.createElement('div'));
  cs.update();
  return { cs, app };
}

t('the strip carries a show-sidebar button that reopens it', () => {
  const { cs, app } = strip(browsePage('search'));
  const toggle = cs.el.querySelector('.dr-sidebar-toggle');
  assert.ok(toggle);
  toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(app.workspace.leftSplit.expanded, 1);
});

t('the strip stays up on an empty page, where the sidebar toggle is needed', () => {
  const empty = { isDeferred: false, view: { getDisplayText: () => 'New tab', getIcon: () => 'file' } };
  const { cs } = strip(empty);
  assert.ok(!cs.el.classList.contains('is-empty'));
  assert.ok(cs.el.querySelector('.dr-sidebar-toggle'));
  assert.strictEqual(cs.el.querySelector('.dr-strip-title').textContent, 'New tab');
});

t("a note's More opens the page menu the hidden header had", () => {
  const page = notePage('Concepts Folder/Logic.md');
  const asked = [];
  page.view.onPaneMenu = (menu, source) => asked.push(source);
  const { cs } = strip(page);
  const more = Array.from(cs.el.querySelectorAll('.dr-strip-btn')).find(
    (b) => b.getAttribute('aria-label') === 'More');
  more.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 3, clientY: 3 }));
  assert.deepStrictEqual(asked, ['more-options']);
});

t("a folder page's More offers making something in it", () => {
  const page = browsePage('folder', { path: 'Books Folder' });
  page.view.folder = () => folders['Books Folder'];
  page.view.getDisplayText = () => 'Books Folder';
  const { cs } = strip(page);
  lastMenu = null;
  const more = Array.from(cs.el.querySelectorAll('.dr-strip-btn')).find(
    (b) => b.getAttribute('aria-label') === 'More');
  more.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 3, clientY: 3 }));
  assert.deepStrictEqual(lastMenu.titles().slice(0, 2), ['New note', 'New folder']);
});


/* -- the header's own copies of the strip's buttons ----------------- */

/** A leaf whose header holds these buttons, by icon name. */
function headerLeaf(view, icons) {
  view.containerEl = document.createElement('div');
  const actions = view.containerEl.createDiv({ cls: 'view-header' }).createDiv({ cls: 'view-actions' });
  const buttons = {};
  icons.forEach((name) => {
    const btn = actions.createDiv({ cls: 'clickable-icon view-action' });
    btn.innerHTML = `<svg class="svg-icon lucide-${name}"></svg>`;
    buttons[name] = btn;
  });
  return { leaf: { isDeferred: false, view }, buttons };
}
const marked = (buttons) => Object.keys(buttons).filter((k) => buttons[k].classList.contains('dr-strip-dupe'));

t("a note's reading toggle and More are marked; a plugin's own button isn't", () => {
  const note = headerLeaf(new MarkdownView(files['Home.md']), ['star', 'book-open', 'more-vertical']);
  const cs = Object.create(ContextStrip.prototype);
  cs.plugin = { app: { workspace: { iterateRootLeaves: (fn) => fn(note.leaf) } } };
  cs.markDuplicates();
  assert.deepStrictEqual(marked(note.buttons), ['book-open', 'more-vertical']);
});

t('the reading toggle is marked in either mode, under any of its names', () => {
  ['edit-3', 'pencil', 'pen-line', 'book-open'].forEach((icon) => {
    const note = headerLeaf(new MarkdownView(files['Home.md']), [icon, 'ellipsis-vertical']);
    assert.strictEqual(headerDuplicates(note.leaf).length, 2, icon);
  });
});

t("the view's own references are used, whatever their icon", () => {
  const view = new MarkdownView(files['Home.md']);
  const note = headerLeaf(view, ['dots-unknown', 'mode-unknown']);
  view.moreOptionsButtonEl = note.buttons['dots-unknown'];
  view.modeButtonEl = note.buttons['mode-unknown'];
  assert.strictEqual(headerDuplicates(note.leaf).length, 2);
});

t("a view with no file keeps its More — the strip has none for it", () => {
  const graph = headerLeaf({ getViewType: () => 'graph' }, ['more-vertical']);
  assert.deepStrictEqual(headerDuplicates(graph.leaf), []);
});

t('a file that isn\'t a note loses More, but keeps its own pencil', () => {
  const canvas = headerLeaf({ file: files['Home.md'] }, ['pencil', 'more-vertical']);
  const cs = Object.create(ContextStrip.prototype);
  cs.plugin = { app: { workspace: { iterateRootLeaves: (fn) => fn(canvas.leaf) } } };
  cs.markDuplicates();
  assert.deepStrictEqual(marked(canvas.buttons), ['more-vertical']);
});

t('switching the strip off gives the buttons back', () => {
  const note = headerLeaf(new MarkdownView(files['Home.md']), ['book-open', 'more-vertical']);
  document.body.appendChild(note.leaf.view.containerEl);
  const cs = Object.create(ContextStrip.prototype);
  cs.plugin = { app: { workspace: { iterateRootLeaves: (fn) => fn(note.leaf) } } };
  cs.markDuplicates();
  cs.el = null;
  cs.disable();
  assert.deepStrictEqual(marked(note.buttons), []);
});

t('a track dropped on a folder in the library, or in the file list, moves there with an Undo', () => {
  const file = new TFile('Law/Tort.md');
  const moves = [];
  const plugin = {
    settings: { sidebarDrop: true },
    app: {
      vault: {
        getFolderByPath: (p) => (p === 'Politics' ? new TFolder('Politics') : null),
        getAbstractFileByPath: (p) => (p === file.path ? file : null),
      },
    },
    moveFile: (f, to, opts) => moves.push([f.path, to, opts]),
  };
  const drop = new SidebarDrop(plugin);
  const transfer = { types: ['text/dr-file'], getData: (type) => (type === 'text/dr-file' ? file.path : '') };
  const event = (target, dataTransfer) => ({ target, dataTransfer, preventDefault() { this.prevented = true; }, stopPropagation() {} });

  const row = document.body.createDiv({ cls: 'dr-lib-row' });
  row.dataset.path = 'Politics';
  const over = event(row, transfer);
  drop.onDragOver(over);
  assert.ok(over.prevented && row.classList.contains('dr-drop-target'), 'the folder says it will take it');
  drop.onDrop(event(row, transfer));
  assert.deepStrictEqual(moves, [['Law/Tort.md', 'Politics', { announce: true }]]);
  assert.ok(!row.classList.contains('dr-drop-target'));

  // A folder in Obsidian's file list takes a track from a list too — not its own drags, which it takes itself.
  const explorer = document.body.createDiv({ cls: 'nav-folder-title' });
  explorer.dataset.path = 'Politics';
  const fromList = event(explorer, transfer);
  drop.onDragOver(fromList);
  assert.ok(fromList.prevented);
  plugin.app.dragManager = { draggable: { file } };
  const ownDrag = event(explorer, { types: [], getData: () => '' });
  drop.onDragOver(ownDrag);
  assert.ok(!ownDrag.prevented);

  // A note's row isn't somewhere to drop; and switched off, nothing is.
  const noteRow = document.body.createDiv({ cls: 'dr-lib-row' });
  noteRow.dataset.path = 'Law/Tort.md';
  const onNote = event(noteRow, transfer);
  drop.onDragOver(onNote);
  assert.ok(!onNote.prevented);
  plugin.settings.sidebarDrop = false;
  const off = event(row, transfer);
  drop.onDragOver(off);
  assert.ok(!off.prevented);
  [row, explorer, noteRow].forEach((el) => el.remove());
});

t('a name cut short shows in full under the pointer, only while it doesn’t fit', () => {
  const box = document.body.createDiv();
  const view = { registerDomEvent: (el, type, fn) => el.addEventListener(type, fn) };
  fullNameOnHover(view, box);
  const row = box.createDiv({ cls: 'dr-lib-row' });
  row.setAttribute('tabindex', '0');
  const label = row.createSpan({ cls: 'dr-lib-label', text: 'A rather long album name' });
  const size = (scroll, client) => Object.defineProperties(label, { scrollWidth: { value: scroll, configurable: true }, clientWidth: { value: client, configurable: true } });
  const point = () => label.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  size(240, 120);
  point();
  assert.strictEqual(row.getAttribute('title'), 'A rather long album name');
  size(120, 120);
  point();
  assert.ok(!row.hasAttribute('title'), 'fits again: no tooltip');
  row.setAttribute('title', 'Its own');
  size(240, 120);
  point();
  assert.strictEqual(row.getAttribute('title'), 'Its own', 'a title of its own is left alone');
  box.remove();
});

fs.unlinkSync(tmp);
console.log(`\n${passed} passed`);
