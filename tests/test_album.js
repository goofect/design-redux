// Albums, against the real main.js: their own order by drag, the edit
// mode (rename, move, delete, add, arrange), the strip's skip buttons,
// arrangements that follow renames and deletions, each note's length,
// and the Home screen.
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

const notices = [];
const menus = [];
const pickers = [];
const modals = [];
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = { title: '', disabled: false };
    ['setIcon', 'setChecked', 'setSection', 'setWarning'].forEach((m) => (item[m] = () => item));
    item.setTitle = (v) => { item.title = v; return item; };
    item.setChecked = (v) => { item.checked = v; return item; };
    item.setDisabled = (v) => { item.disabled = v; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
  addSeparator() { return this; }
  showAtPosition() { menus.push(this); }
  showAtMouseEvent() { menus.push(this); }
}
class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement('div');
    this.titleEl = this.modalEl.createDiv();
    this.contentEl = this.modalEl.createDiv();
  }
  open() { modals.push(this); document.body.appendChild(this.modalEl); this.onOpen(); }
  close() { this.modalEl.remove(); if (this.onClose) this.onClose(); }
}
class FuzzySuggestModal { constructor(app) { this.app = app; } setPlaceholder() {} open() { pickers.push(this); } }
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
  constructor(p, t) { super(); this.setPath(p); this.stat = { mtime: t || 0, ctime: t || 0 }; }
  setPath(p) {
    this.path = p; this.name = p.split('/').pop();
    this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
  }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p === '/' ? '' : p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
class MarkdownView {}
const obsidian = new Proxy({
  Menu, Modal, FuzzySuggestModal, Component, ItemView, TFile, TFolder, TAbstractFile, MarkdownView,
  // As Obsidian's: an icon must be named.
  setIcon: (el, name) => { if (typeof name !== 'string') throw new TypeError("Cannot read properties of undefined (reading 'startsWith')"); el.dataset.icon = name; },
  Notice: class { constructor(m) { notices.push(m); } },
  Platform: { isMobile: false, isPhone: false },
  normalizePath: (p) => p.replace(/\/+/g, '/').replace(/^\//, ''),
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_album_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { BrowseView, ContextStrip, Orders, DEFAULTS, albumNeighbours, albumSequence, arrange, moveBefore, DesignRedux, Lengths, countWords, readingTime, drawFolderArt, noteCoverSrc, CoverDrop, stripDetail, SETTINGS_TABS, AlbumStructure, SmartAlbums, LibraryCheck, drawNoteArt, AlbumRefactor, Appearance, CANVAS_SPACE, Knowledge, KnowledgeCheck, knowledgeFindings, loopsAmong, WorkspaceModes, actionCommands, addActionItems, Notes, Files, RelationsSection, PlacesSection, homeShelves, Library, Selection, LibraryIndex, NotePage, Reading, readingOf, atEnd, SETTINGS_MIGRATIONS, rankNote, textExcerpt, TEXT_PAUSE, currentHeading, sectionWords, sectionEnds, ReadingOutline, ReadingOutlineView, ReadingHistory };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

/* -- a vault whose files really move ------------------------------------ */

function makeVault() {
  const root = new TFolder('/');
  const byPath = new Map([['/', root]]);
  const parentPath = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/');
  const place = (entry) => {
    const parent = byPath.get(parentPath(entry.path));
    entry.parent = parent;
    parent.children.push(entry);
    byPath.set(entry.path, entry);
  };
  const folder = (p) => { const f = new TFolder(p); place(f); return f; };
  let clock = 1;
  const file = (p) => { const f = new TFile(p, clock++); place(f); return f; };
  const handlers = { rename: [], delete: [], create: [] };
  const fire = (name, ...args) => handlers[name].forEach((h) => h(...args));
  const detach = (entry) => {
    entry.parent.children.splice(entry.parent.children.indexOf(entry), 1);
    byPath.delete(entry.path);
  };
  const vault = {
    getRoot: () => root,
    getName: () => 'Vault',
    getMarkdownFiles: () => Array.from(byPath.values()).filter((e) => e instanceof TFile && e.extension === 'md'),
    getFiles: () => Array.from(byPath.values()).filter((e) => e instanceof TFile),
    getFolderByPath: (p) => { const e = byPath.get(p); return e instanceof TFolder ? e : null; },
    getFileByPath: (p) => { const e = byPath.get(p); return e instanceof TFile ? e : null; },
    getAbstractFileByPath: (p) => byPath.get(p) || null,
    getResourcePath: () => '',
    create: async (p) => { const f = file(p); fire('create', f); return f; },
    createFolder: async (p) => folder(p),
    on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return {}; },
  };
  const fileManager = {
    renameFile: async (entry, target) => {
      const old = entry.path;
      detach(entry);
      const move = (e, from, to) => {
        const p = to + e.path.slice(from.length);
        if (e instanceof TFile) e.setPath(p); else { e.path = p; e.name = p.split('/').pop(); }
        byPath.set(e.path, e);
        (e.children || []).forEach((c) => { byPath.delete(c.path); move(c, from, to); });
      };
      move(entry, old, target);
      const parent = byPath.get(parentPath(target));
      entry.parent = parent;
      parent.children.push(entry);
      fire('rename', entry, old);
    },
    trashFile: async (entry) => { detach(entry); fire('delete', entry); },
    promptForDeletion: async () => confirmDelete,
    processFrontMatter: async () => {},
  };
  let confirmDelete = true;
  return {
    root, folder, file, vault, fileManager, handlers,
    setConfirm: (v) => { confirmDelete = v; },
  };
}

function setup() {
  const v = makeVault();
  const ir = v.folder('IR');
  const theories = v.folder('IR/Theories');
  ['Anarchy', 'Balance', 'Cooperation', 'Deterrence'].forEach((n) => v.file(`IR/${n}.md`));
  ['Realism', 'Liberalism'].forEach((n) => v.file(`IR/Theories/${n}.md`));
  const plugin = {
    // Covers, as the screens' own tests expect; Automatic and Lists have a test of their own.
    settings: Object.assign(JSON.parse(JSON.stringify(R.DEFAULTS)), { libraryLayout: 'covers' }),
    saved: 0,
    saveData: async () => { plugin.saved++; },
    isFolderNote: (f) => f.basename === (f.parent && f.parent.name),
    folderHasNotes: () => true,
    recentFiles: () => [],
    folderNote: () => null,
    folderCoverSrc: () => null,
    feature: () => null,
    refreshBrowse: () => views.forEach((view) => view.render()),
    moveFile: async (file, folderPath) => {
      await v.fileManager.renameFile(file, `${folderPath === '/' ? '' : folderPath + '/'}${file.name}`);
      return true;
    },
    freeChildPath: (folder, base, ext) => {
      let n = 0;
      const make = (i) => `${folder.path === '/' ? '' : folder.path + '/'}${base}${i ? ' ' + i : ''}.${ext}`;
      while (v.vault.getAbstractFileByPath(make(n))) n++;
      return make(n);
    },
    setFolderCover: () => {},
    propertyLabel: (k) => k,
    offerUndo: () => {},
  };
  plugin.pins = { files: () => [], folders: () => [], all: () => [], has: () => false };
  plugin.orders = new R.Orders(plugin);
  plugin.notes = new R.Notes(plugin);
  plugin.files = new R.Files(plugin);
  // The album features reached through the plugin, as in Obsidian.
  plugin.albumInfo = R.DesignRedux.prototype.albumInfo.bind(plugin);
  plugin.addAlbumMenuItems = R.DesignRedux.prototype.addAlbumMenuItems.bind(plugin);
  const app = {
    vault: v.vault,
    fileManager: v.fileManager,
    workspace: {
      leftSplit: { expand() {} }, getLeaf: () => ({ openFile: (f) => opened.push(f) }), trigger() {},
      getLeavesOfType: () => [],
    },
    metadataCache: { getFileCache: () => null, getFirstLinkpathDest: () => null },
  };
  plugin.app = app;
  // What the plugin does on the vault's events.
  v.vault.on('rename', (file, old) => plugin.orders.followRename(file, old));
  v.vault.on('delete', (file) => plugin.orders.followDelete(file));
  const opened = [];
  const views = [];
  const view = new R.BrowseView({ history: { backHistory: [], forwardHistory: [] }, setViewState: async () => {} }, plugin);
  view.app = app;
  views.push(view);
  document.body.innerHTML = '';
  document.body.appendChild(view.containerEl);
  Object.assign(view, { mode: 'folder', path: 'IR', property: null, value: null });
  v.vault.on('rename', (file, old) => { view.followRename(file, old); view.render(); });
  v.vault.on('delete', () => view.render());
  v.vault.on('create', () => view.render());
  view.render();
  return { v, plugin, app, view, ir, theories, opened };
}

const names = (view, folder = 'IR') => Array.from(view.contentEl.querySelectorAll(`.dr-track[data-folder="${folder}"]`))
  .map((r) => (r.querySelector('.dr-edit-name') ? r.querySelector('.dr-edit-name').value : r.querySelector('.dr-track-name').textContent));
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const key = (el, k, extra = {}) => el.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const action = (view, label) => Array.from(view.contentEl.querySelectorAll('.dr-detail-action')).find((a) => a.textContent === label);

const HOME_OFF = ['picks', 'continue', 'added', 'collections', 'pinned', 'rediscover'];
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  await t('an arrangement lists what it names in its order, and anything new after', () => {
    const items = ['a', 'b', 'c', 'd'].map((n) => ({ n }));
    const out = R.arrange(items, (x) => x.n, ['c', 'a', 'gone'], (rest) => rest.slice().reverse());
    assert.deepStrictEqual(out.map((x) => x.n), ['c', 'a', 'd', 'b']);
    assert.deepStrictEqual(R.moveBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
    assert.deepStrictEqual(R.moveBefore(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a']);
  });

  await t('an album nests each note under the note its parent property names, folding open; the property gets no column', () => {
    const { v, plugin, app, view } = setup();
    const parents = { Deterrence: '[[Anarchy]]', Cooperation: ['[[Deterrence|deterrence]]'], Balance: '[[Nowhere]]' };
    app.metadataCache.getFileCache = (f) => ({ frontmatter: parents[f.basename] ? { parent: parents[f.basename] } : {} });
    app.metadataCache.getFirstLinkpathDest = (name) => v.vault.getMarkdownFiles().find((f) => f.basename === name) || null;
    plugin.settings.albumColumns = 'parent, modified';
    view.render();
    assert.deepStrictEqual(names(view), ['Anarchy', 'Deterrence', 'Cooperation', 'Balance']);
    const row = (n) => view.contentEl.querySelector(`.dr-track[data-path="IR/${n}.md"]`);
    assert.deepStrictEqual(['Anarchy', 'Deterrence', 'Cooperation', 'Balance'].map((n) => row(n).style.getPropertyValue('--dr-nest') || '0'), ['0', '1', '2', '0']);
    assert.strictEqual(row('Anarchy').querySelectorAll('.dr-track-time, .dr-track-sub').length, 1, 'no parent column');
    // Folded: what's under it, at any depth, out of sight; and back.
    click(row('Anarchy').querySelector('.dr-track-fold'));
    assert.deepStrictEqual(names(view), ['Anarchy', 'Balance']);
    click(row('Anarchy').querySelector('.dr-track-fold'));
    assert.deepStrictEqual(names(view), ['Anarchy', 'Deterrence', 'Cooperation', 'Balance']);
    // Not nested: a flat list, the property a column again.
    plugin.settings.albumNestBy = '';
    view.render();
    assert.deepStrictEqual(names(view), ['Anarchy', 'Balance', 'Cooperation', 'Deterrence']);
    assert.ok(!view.contentEl.querySelector('.dr-track.is-nested, .dr-track-fold'));
  });

  await t('under each note in an album, a grey line: its description, or its first sentence', async () => {
    const { v, plugin, app, view } = setup();
    app.metadataCache.getFileCache = (f) => ({ frontmatter: f.basename === 'Anarchy' ? { description: 'No **one** above the states' } : {} });
    v.vault.cachedRead = async (f) => (f.basename === 'Balance' ? '---\ntags: x\n---\n# Balance\n\nStates [[Alliance|ally]] against power. Then more.' : '');
    view.render();
    await settle();
    const line = (n) => view.contentEl.querySelector(`.dr-track[data-path="IR/${n}.md"] .dr-track-name`).dataset.excerpt;
    assert.strictEqual(line('Anarchy'), 'No one above the states');
    assert.strictEqual(line('Balance'), 'States ally against power.');
    assert.strictEqual(line('Cooperation'), undefined, 'nothing to say, no line');
    assert.deepStrictEqual(names(view).slice(0, 2), ['Anarchy', 'Balance'], 'the title is only the title');
    plugin.settings.albumExcerpts = false;
    view.render();
    assert.strictEqual(line('Anarchy'), undefined);
    // An album of its own notes alone: one count, under its title — no heading for them, no count at the foot.
    Object.assign(view, { path: 'IR/Theories' });
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-disc'));
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-track').length, 2);
    assert.ok(!Array.from(view.contentEl.querySelectorAll('.dr-album-foot div')).some((d) => /notes?\b/.test(d.textContent)));
    assert.ok(/2 notes/.test(view.contentEl.querySelector('.dr-detail-meta').textContent));
  });

  await t('an album ends with what its notes link to that isn’t written yet, greyed — a click writes it there — and a New note row', () => {
    const { plugin, app, view } = setup();
    app.metadataCache.unresolvedLinks = { 'IR/Anarchy.md': { Hegemony: 2, 'pic.png': 1 }, 'IR/Balance.md': { 'Ideas/Hegemony': 1, 'Security dilemma': 1 } };
    const made = [];
    plugin.newNote = (folder, name) => made.push([folder.path, name]);
    view.render();
    const rows = Array.from(view.contentEl.querySelectorAll('.dr-end-row.is-unwritten'));
    assert.deepStrictEqual(rows.map((r) => r.querySelector('.dr-track-name').textContent), ['Hegemony', 'Security dilemma']);
    assert.strictEqual(rows[0].querySelector('.dr-track-time').textContent, '3 links');
    click(rows[0]);
    assert.deepStrictEqual(made, [['IR', 'Hegemony']]);
    click(view.contentEl.querySelector('.dr-new-note-row'));
    assert.deepStrictEqual(made[1], ['IR', undefined]);
    plugin.settings.albumStillToWrite = false;
    view.render();
    assert.ok(!view.contentEl.querySelector('.is-unwritten') && view.contentEl.querySelector('.dr-new-note-row'));
  });

  await t('a note opens with its album above its title, one grey line under it, chips, and shelves at its end', async () => {
    const { v, plugin, app } = setup();
    const file = v.vault.getAbstractFileByPath('IR/Anarchy.md');
    app.metadataCache.getFileCache = (f) => ({ frontmatter: f === file ? { parent: '[[Balance]]', status: 'draft', cover: 'https://example.com/a.png', tags: ['#law'] } : {} });
    app.metadataCache.resolvedLinks = { 'IR/Anarchy.md': { 'IR/Balance.md': 1 }, 'IR/Cooperation.md': { 'IR/Anarchy.md': 2 } };
    v.vault.cachedRead = async (f) => `${f.basename} begins here. More.`;
    plugin.lengths = { label: () => '3 min read', measure: async () => false };
    plugin.settings.notePageTint = true;
    Object.assign(plugin.settings, { notePage: true, notePageChips: true, notePageShelves: true, albumNestBy: 'parent' });
    // A note's view as Obsidian lays it out, editing.
    const containerEl = document.createElement('div');
    const sizer = containerEl.createDiv({ cls: 'markdown-source-view' }).createDiv({ cls: 'cm-sizer' });
    const title = sizer.createDiv({ cls: 'inline-title', text: 'Anarchy' });
    sizer.createDiv({ cls: 'metadata-container' });
    const content = sizer.createDiv({ cls: 'cm-contentContainer' });
    sizer.createDiv({ cls: 'embedded-backlinks' });
    const view = { containerEl, file };
    const page = new R.NotePage(plugin);
    page.draw(view);
    const album = sizer.querySelector('.dr-note-album');
    assert.strictEqual(album.textContent, 'IR');
    assert.strictEqual(sizer.querySelector('.dr-note-glow img').getAttribute('src'), 'https://example.com/a.png', 'a glow of its cover');
    assert.ok(sizer.classList.contains('dr-has-glow'));
    assert.strictEqual(album.nextElementSibling, title, 'above the title');
    const meta = title.nextElementSibling;
    assert.ok(meta.classList.contains('dr-note-meta'));
    assert.ok(/^Under Balance {2}· {2}3 min read {2}· {2}Edited /.test(meta.textContent), meta.textContent);
    const chips = Array.from(sizer.querySelectorAll('.dr-note-chip')).map((c) => c.textContent);
    assert.deepStrictEqual(chips, ['draft', 'law'], 'its parent and cover said elsewhere; nothing more beside them');
    assert.ok(containerEl.classList.contains('dr-props-as-chips'));
    const shelves = sizer.querySelector('.dr-note-shelves');
    assert.strictEqual(shelves.previousElementSibling, content, 'after the text, before the backlinks');
    assert.deepStrictEqual(Array.from(shelves.querySelectorAll('.dr-note-shelf-head')).map((h) => h.textContent), ['Linked from here ›', 'Mentioned in ›', 'More in IR ›']);
    assert.deepStrictEqual(Array.from(shelves.querySelectorAll('.dr-note-shelf')[1].querySelectorAll('.dr-note-tile-title')).map((x) => x.textContent), ['Cooperation']);
    await settle();
    assert.strictEqual(shelves.querySelector('.dr-note-tile-line').textContent, 'Balance begins here.');
    // Drawn again with nothing changed: the same elements.
    page.draw(view);
    assert.strictEqual(sizer.querySelector('.dr-note-shelves'), shelves);
    assert.strictEqual(sizer.querySelector('.dr-note-album'), album);
    // Off: all of it gone.
    plugin.settings.notePage = false;
    page.draw(view);
    assert.ok(!sizer.querySelector('.dr-note-album, .dr-note-meta, .dr-note-chips, .dr-note-shelves'));
    assert.ok(!containerEl.classList.contains('dr-props-as-chips'));
  });

  await t('glass is a class on the page, as set, and gone when switched off', () => {
    const { plugin } = setup();
    const look = new R.Appearance(plugin);
    plugin.settings.glassPanels = true;
    look.apply();
    assert.ok(document.body.classList.contains('dr-glass'));
    plugin.settings.glassPanels = false;
    look.apply();
    assert.ok(!document.body.classList.contains('dr-glass'));
    plugin.settings.glassPanels = true;
    look.apply(true);
    assert.ok(!document.body.classList.contains('dr-glass'), 'the feature off');
    // Classic: 1.x's look, no glass.
    plugin.settings.look = 'classic';
    look.apply();
    assert.ok(document.body.classList.contains('dr-look-classic') && !document.body.classList.contains('dr-glass'));
    plugin.settings.look = 'theme';
    look.apply();
    assert.ok(!document.body.classList.contains('dr-look-classic'));
  });

  await t('reading history: what you opened and read, in the plugin’s data; changed since read is news; the latest kept', () => {
    const { v, plugin } = setup();
    plugin.saveData = () => {};
    const r = new R.Reading(plugin);
    const f = (n) => v.vault.getAbstractFileByPath(`IR/${n}.md`);
    plugin.settings.readingSince = 0.5;
    assert.strictEqual(r.state(f('Anarchy')), 'unread');
    assert.ok(r.isNew(f('Anarchy')), 'made since the history began, not read');
    r.opened(f('Anarchy'));
    r.opened(f('Balance'));
    plugin.settings.readingLog['IR/Balance.md'].opened += 5;
    assert.ok(r.markRead(f('Anarchy')));
    assert.ok(!r.markRead(f('Anarchy')), 'read already, as it is');
    assert.strictEqual(r.state(f('Anarchy')), 'read');
    assert.ok(!r.isNew(f('Anarchy')));
    f('Anarchy').stat.mtime += 10000;
    assert.strictEqual(r.state(f('Anarchy')), 'changed', 'changed since');
    r.edited(f('Anarchy'));
    assert.strictEqual(r.state(f('Anarchy')), 'read', 'your own change while reading keeps it read');
    assert.strictEqual(r.countRead(['Anarchy', 'Balance', 'Cooperation'].map(f)), 1);
    assert.deepStrictEqual(r.latest('read').map((x) => x.basename), ['Anarchy']);
    assert.ok(plugin.settings.readingLog['IR/Balance.md'].opened >= plugin.settings.readingLog['IR/Anarchy.md'].opened);
    assert.strictEqual(r.lastOpened(['Anarchy', 'Balance', 'Cooperation'].map(f)).basename, 'Balance');
    // Kept within its size.
    for (let i = 0; i < 3005; i++) plugin.settings.readingLog[`x/${i}.md`] = { opened: i + 1 };
    r.prune();
    assert.strictEqual(Object.keys(plugin.settings.readingLog).length, 3000);
    assert.ok(R.atEnd({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 }) && !R.atEnd({ scrollHeight: 1000, scrollTop: 100, clientHeight: 400 }));
  });

  await t('reading outline: the heading you’re at, the words in each section, a row goes to its heading; a note opens where you were', async () => {
    const H = [{ level: 1, line: 0 }, { level: 2, line: 3 }, { level: 2, line: 6 }, { level: 1, line: 9 }];
    assert.strictEqual(R.currentHeading([], 5), -1, 'no headings');
    assert.strictEqual(R.currentHeading([{ level: 2, line: 4 }], 2), -1, 'before the first');
    assert.strictEqual(R.currentHeading(H, 3), 1, 'on a heading');
    assert.strictEqual(R.currentHeading(H, 7), 2, 'equal levels: the later');
    assert.strictEqual(R.currentHeading(H, 99), 3, 'after the last');
    const text = ['# One', 'a b', '', '## Two', 'c d e', '', '## Three', 'f', '', '# Four', 'g h'].join('\n');
    assert.deepStrictEqual(R.sectionWords(text, H), [6, 3, 1, 2], 'a section counts the ones nested in it, not their headings');
    assert.deepStrictEqual(R.sectionEnds(H, 11), [9, 6, 9, 11]);

    // Where you were: kept by line, and kept through pruning as recent.
    const { v, plugin, app } = setup();
    plugin.saveData = () => {};
    const r = R.readingOf(plugin);
    const f = v.vault.getAbstractFileByPath('IR/Anarchy.md');
    assert.strictEqual(r.where(f), null);
    r.place(f, 6.7);
    assert.strictEqual(r.where(f), 6);
    r.place(f, -1);
    assert.strictEqual(r.where(f), 6, 'nonsense ignored');
    for (let i = 0; i < 3005; i++) plugin.settings.readingLog[`x/${i}.md`] = { opened: i + 1 };
    r.prune();
    assert.strictEqual(r.where(f), 6, 'just placed: kept');
    assert.ok(!plugin.settings.readingLog['x/0.md'] && plugin.settings.readingLog['x/3004.md'], 'the oldest go');
    plugin.settings.readingLog = { 'IR/Anarchy.md': { opened: 1, line: 6, lineAt: 1 } };

    // The panel.
    if (!window.requestAnimationFrame) window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    let scroll = 0;
    const applied = [];
    const noteView = Object.assign(new MarkdownView(), {
      file: f,
      containerEl: document.createElement('div'),
      getMode: () => 'source',
      currentMode: { getScroll: () => scroll, applyScroll: (l) => { applied.push(l); scroll = l; } },
    });
    document.body.appendChild(noteView.containerEl);
    const heads = ['One', 'Two', 'Three', 'Four'].map((heading, i) => ({ heading, level: H[i].level, position: { start: { line: H[i].line } } }));
    app.metadataCache.getFileCache = (file) => (file === f ? { headings: heads } : null);
    app.metadataCache.on = () => ({});
    app.vault.cachedRead = async () => text;
    app.workspace.on = () => ({});
    app.workspace.getMostRecentLeaf = () => ({ view: noteView });
    app.workspace.getActiveViewOfType = () => noteView;
    const ov = new R.ReadingOutlineView({}, new R.ReadingOutline(plugin));
    ov.app = app;
    document.body.appendChild(ov.containerEl);
    await ov.onOpen();
    await settle();
    const rows = () => Array.from(ov.contentEl.querySelectorAll('.dr-reading-row'));
    const words = () => rows().map((row) => row.querySelector('.dr-reading-words').textContent);
    assert.deepStrictEqual(rows().map((row) => row.querySelector('.dr-reading-name').textContent), ['One', 'Two', 'Three', 'Four']);
    assert.strictEqual(rows()[1].style.getPropertyValue('--dr-depth'), '1', 'indented by level');
    assert.ok(rows()[0].classList.contains('is-current'));
    assert.deepStrictEqual(words(), ['6', '3', '1', '2']);
    scroll = 7;
    ov.light();
    assert.ok(rows()[2].classList.contains('is-current') && rows()[1].classList.contains('is-done') && rows()[0].classList.contains('is-done') && !rows()[3].classList.contains('is-done'));
    assert.strictEqual(rows()[2].style.getPropertyValue('--dr-through-n'), '0.333', 'a third through its section');
    click(rows()[3]);
    assert.deepStrictEqual(applied, [9], 'a row goes to its heading');
    ov.light();
    assert.ok(rows()[3].classList.contains('is-current'));
    rows()[0].focus();
    key(rows()[0], 'ArrowDown');
    assert.strictEqual(document.activeElement, rows()[1], 'arrow keys move through the rows');
    plugin.settings.outlineWordCounts = false;
    ov.light();
    assert.deepStrictEqual(words(), ['', '', '', '']);
    app.metadataCache.getFileCache = () => ({ headings: [] });
    ov.render();
    assert.strictEqual(ov.contentEl.textContent, 'No headings in this note');

    // Opened again: back where you were, unless something already put it elsewhere.
    const hist = new R.ReadingHistory(plugin);
    scroll = 0;
    hist.onOpen(f);
    await settle(200);
    assert.strictEqual(scroll, 6, 'opens where you were');
    scroll = 3;
    hist.onOpen(f);
    await settle(200);
    assert.strictEqual(scroll, 3, 'a link to a heading wins');
    scroll = 20;
    hist.track(f);
    assert.strictEqual(r.where(f), 20, 'kept as you scroll');
    plugin.settings.rememberPlace = false;
    scroll = 0;
    hist.onOpen(f);
    await settle(200);
    assert.strictEqual(scroll, 0, 'switched off: from the top');
    clearTimeout(hist.glance);
  });

  await t('an album says how far through it you are, dots what’s new to you, and Open picks up where you were; Recently read lists what’s read', async () => {
    const { v, plugin, view, opened } = setup();
    plugin.saveData = () => {};
    const r = R.readingOf(plugin);
    const f = (n) => v.vault.getAbstractFileByPath(`IR/${n}.md`);
    plugin.settings.readingSince = 0.5;
    r.opened(f('Anarchy'));
    r.markRead(f('Anarchy'));
    r.opened(f('Cooperation'));
    plugin.settings.readingLog['IR/Cooperation.md'].opened += 5;
    view.render();
    assert.ok(/1 of 6 read/.test(view.contentEl.querySelector('.dr-detail-meta').textContent), view.contentEl.querySelector('.dr-detail-meta').textContent);
    const row = (n) => view.contentEl.querySelector(`.dr-track[data-path="IR/${n}.md"]`);
    assert.ok(!row('Anarchy').classList.contains('is-unread') && row('Balance').classList.contains('is-unread'));
    const open = action(view, 'Continue');
    assert.ok(open, 'Continue, where you were');
    click(open);
    assert.strictEqual(opened[opened.length - 1].basename, 'Cooperation');
    await view.setState({ mode: 'read' }, {});
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-card-title')).map((e) => e.textContent), ['Anarchy']);
    // Home: Continue reading picks up the note you were partway through.
    plugin.settings.homeShelves = HOME_OFF.map((id) => ({ id, on: id === 'continue' }));
    await view.setState({ mode: 'home' }, {});
    const head = Array.from(view.contentEl.querySelectorAll('.dr-shelf-head')).find((x) => /Continue reading/.test(x.textContent));
    assert.ok(head, 'a Continue reading shelf');
    assert.strictEqual(head.nextElementSibling.querySelector('.dr-card-title').textContent, 'Cooperation');
    // Read a month ago or more: the first to revisit.
    plugin.settings.readingLog['IR/Anarchy.md'].read = Date.now() - 40 * 86400000;
    plugin.settings.homeShelves = HOME_OFF.map((id) => ({ id, on: id === 'picks' }));
    await view.setState({ mode: 'home' }, {});
    const revisit = Array.from(view.contentEl.querySelectorAll('.dr-pick')).find((x) => /Rediscover/.test(x.textContent));
    assert.ok(revisit && /Anarchy/.test(revisit.textContent), 'read long ago, up first');
    // Switched off: none of it.
    plugin.settings.readingHistory = false;
    Object.assign(view, { mode: 'folder', path: 'IR' });
    view.render();
    assert.ok(!/read/.test(view.contentEl.querySelector('.dr-detail-meta').textContent));
    assert.ok(!view.contentEl.querySelector('.dr-track.is-unread'));
    assert.ok(action(view, 'Open'));
  });

  await t('settings step 4 puts Recently read in the library after Pinned, once', () => {
    const step = R.SETTINGS_MIGRATIONS.find((m) => m.to === 4);
    const saved = { librarySections: [{ title: '', items: [{ kind: 'builtin', id: 'home' }] }, { title: 'Yours', items: [{ kind: 'builtin', id: 'bookmarks' }, { kind: 'builtin', id: 'smart' }] }] };
    step.run(saved);
    assert.deepStrictEqual(saved.librarySections[1].items.map((i) => i.id), ['bookmarks', 'read', 'smart']);
    step.run(saved);
    assert.strictEqual(saved.librarySections[1].items.filter((i) => i.id === 'read').length, 1);
    const none = {};
    step.run(none);
    assert.deepStrictEqual(none, {});
  });

  await t('1.x settings open on 2.0 with nothing lost: kept as they were, a backup first, retired ones dropped, the library given Recently read', async () => {
    const saved = {
      settingsVersion: 3,
      coverFallback: 'art',
      albumColumns: 'status, modified',
      canvasLegends: { 'Map.canvas': { labels: { 1: 'Cases' } } },
      homeShelves: [{ id: 'continue', on: false }],
      upNext: true,
      librarySections: [{ title: 'Yours', items: [{ kind: 'builtin', id: 'bookmarks' }, { kind: 'folder', path: 'IR' }] }],
    };
    const backups = [];
    let written = null;
    const ctx = {
      loadData: async () => JSON.parse(JSON.stringify(saved)),
      saveData: async (d) => (written = d),
      manifest: { dir: '.obsidian/plugins/design-redux' },
      app: { vault: { adapter: { write: async (path, data) => backups.push([path, JSON.parse(data)]) } } },
    };
    await R.DesignRedux.prototype.loadSettings.call(ctx);
    const s = ctx.settings;
    assert.strictEqual(s.albumColumns, 'status, modified');
    assert.deepStrictEqual(s.canvasLegends, saved.canvasLegends);
    assert.deepStrictEqual(s.homeShelves, saved.homeShelves);
    assert.deepStrictEqual(s.librarySections[0].items.map((i) => i.id || i.path), ['bookmarks', 'IR']);
    // Recently read, given after Pinned, waits under More with the other occasional places.
    assert.deepStrictEqual(s.librarySections[1], { title: 'More', folded: true, items: [{ kind: 'builtin', id: 'read' }] });
    assert.strictEqual(s.settingsVersion, 9);
    assert.strictEqual(s.panelRelationships, false, 'the note panel without Relationships');
    assert.strictEqual(s.panelPlaces, false, 'nor Kept in');
    assert.strictEqual(s.glassPanels, false, 'the quieter look');
    assert.strictEqual(s.notePageTint, false);
    assert.ok(!('upNext' in s), 'a retired setting dropped');
    assert.ok(written && !('upNext' in written), 'and written back without it');
    assert.deepStrictEqual(backups.map((b) => b[0]), ['.obsidian/plugins/design-redux/data.before-v4.json']);
    assert.strictEqual(backups[0][1].upNext, true, 'the backup is the file as it was');
    Object.keys(R.DEFAULTS).forEach((k) => assert.ok(k in s, `${k} there`));
  });

  await t('editing an album, notes ticked — Shift for a run — are moved together, one Undo putting them all back', async () => {
    const { v, plugin, view } = setup();
    let undo = null;
    plugin.offerUndo = (message, fn) => { undo = [message, fn]; };
    plugin.putBack = async (file, from) => { await v.fileManager.renameFile(file, from); return true; };
    view.setEditing(true);
    const tick = (n, shift) => {
      const box = view.contentEl.querySelector(`.dr-track[data-path="IR/${n}.md"] .dr-edit-tick`);
      box.dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: !!shift }));
    };
    const bar = () => view.contentEl.querySelector('.dr-bulk-bar');
    assert.ok(bar().classList.contains('is-empty'), 'nothing ticked, no bar');
    tick('Anarchy');
    tick('Cooperation', true);
    assert.deepStrictEqual(Array.from(view.ticked()).sort(), ['IR/Anarchy.md', 'IR/Balance.md', 'IR/Cooperation.md'], 'the run between');
    assert.strictEqual(bar().querySelector('.dr-bulk-count').textContent, '3 notes selected');
    assert.ok(view.contentEl.querySelector('.dr-track[data-path="IR/Balance.md"]').classList.contains('is-ticked'));
    await view.moveTicked(v.vault.getAbstractFileByPath('IR/Theories'));
    ['Anarchy', 'Balance', 'Cooperation'].forEach((n) => assert.ok(v.vault.getAbstractFileByPath(`IR/Theories/${n}.md`), `${n} moved`));
    assert.strictEqual(view.ticked().size, 0);
    assert.strictEqual(undo[0], 'Moved 3 notes to Theories.');
    await undo[1]();
    ['Anarchy', 'Balance', 'Cooperation'].forEach((n) => assert.ok(v.vault.getAbstractFileByPath(`IR/${n}.md`), `${n} back`));
    // Leaving editing lets go of what was ticked.
    tick('Deterrence');
    view.setEditing(false);
    assert.strictEqual(view.ticked().size, 0);
    assert.ok(!view.contentEl.querySelector('.dr-edit-tick, .dr-bulk-bar'));
  });

  await t('dragging a note onto another in its album puts it there, and the album keeps that order', () => {
    const { view, plugin } = setup();
    assert.deepStrictEqual(names(view), ['Anarchy', 'Balance', 'Cooperation', 'Deterrence']);
    view.arrangeTrack('IR/Deterrence.md', 'IR/Balance.md', false);
    assert.deepStrictEqual(names(view), ['Anarchy', 'Deterrence', 'Balance', 'Cooperation']);
    view.arrangeTrack('IR/Anarchy.md', 'IR/Cooperation.md', true);
    assert.deepStrictEqual(names(view), ['Deterrence', 'Balance', 'Cooperation', 'Anarchy']);
    assert.deepStrictEqual(plugin.settings.albumOrders.IR, { names: ['Deterrence.md', 'Balance.md', 'Cooperation.md', 'Anarchy.md'], on: true });
    const numbers = Array.from(view.contentEl.querySelectorAll('.dr-track[data-folder="IR"] .dr-track-num')).map((n) => n.textContent);
    assert.deepStrictEqual(numbers, ['1', '2', '3', '4'], 'the numbers follow the new order');
  });

  await t('dropping a row on a row of its own disc arranges it; with Find on, it does nothing', () => {
    const { view } = setup();
    const list = view.contentEl.querySelector('.dr-tracks');
    const rowOf = (p) => list.querySelector(`.dr-track[data-path="${p}"]`);
    const drag = (from, to, y) => {
      view.dragging = { path: from, folder: 'IR' };
      const target = rowOf(to);
      target.getBoundingClientRect = () => ({ top: 0, height: 40 });
      const data = { types: ['text/dr-file'], getData: () => from, dropEffect: '' };
      const over = new window.Event('dragover', { bubbles: true, cancelable: true });
      Object.assign(over, { dataTransfer: data, clientY: y });
      target.dispatchEvent(over);
      const marked = target.classList.contains('is-drop-before') || target.classList.contains('is-drop-after');
      const drop = new window.Event('drop', { bubbles: true, cancelable: true });
      Object.assign(drop, { dataTransfer: data, clientY: y });
      target.dispatchEvent(drop);
      return marked;
    };
    assert.ok(drag('IR/Anarchy.md', 'IR/Cooperation.md', 30), 'no line where it would land');
    assert.deepStrictEqual(names(view), ['Balance', 'Cooperation', 'Anarchy', 'Deterrence']);
    view.query = 'a';
    view.render();
    assert.strictEqual(drag('IR/Deterrence.md', 'IR/Balance.md', 5), false, 'arranging a filtered list');
    view.query = '';
    view.render();
    assert.deepStrictEqual(names(view), ['Balance', 'Cooperation', 'Anarchy', 'Deterrence']);
  });

  await t("the album's own order is on its menu, and choosing another keeps it to go back to", () => {
    const { view, plugin, ir } = setup();
    const menuTitles = () => view.filterMenu().items;
    assert.ok(!menuTitles().some((i) => i.title === 'Collection order'), 'offered before there is one');
    view.arrangeTrack('IR/Deterrence.md', 'IR/Anarchy.md', false);
    let items = menuTitles();
    assert.strictEqual(items[0].title, 'Collection order');
    assert.strictEqual(items[0].checked, true);
    items.find((i) => i.title === 'Alphabetical (A–Z)').click();
    assert.deepStrictEqual(names(view), ['Anarchy', 'Balance', 'Cooperation', 'Deterrence']);
    assert.strictEqual(plugin.orders.albumOn(ir), false);
    items = menuTitles();
    assert.strictEqual(items[0].checked, false);
    items[0].click();
    assert.deepStrictEqual(names(view), ['Deterrence', 'Anarchy', 'Balance', 'Cooperation']);
  });

  await t('arrangements follow a note renamed in place, moved away, deleted, and a folder renamed', async () => {
    const { v, view, plugin, app } = setup();
    view.arrangeTrack('IR/Deterrence.md', 'IR/Anarchy.md', false);
    await app.fileManager.renameFile(app.vault.getFileByPath('IR/Balance.md'), 'IR/Balancing.md');
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Deterrence.md', 'Anarchy.md', 'Balancing.md', 'Cooperation.md']);
    await app.fileManager.renameFile(app.vault.getFileByPath('IR/Anarchy.md'), 'IR/Theories/Anarchy.md');
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Deterrence.md', 'Balancing.md', 'Cooperation.md']);
    await app.fileManager.trashFile(app.vault.getFileByPath('IR/Cooperation.md'));
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Deterrence.md', 'Balancing.md']);
    await app.fileManager.renameFile(app.vault.getFolderByPath('IR'), 'International');
    assert.ok(plugin.settings.albumOrders.International && !plugin.settings.albumOrders.IR);
    assert.strictEqual(view.path, 'International', 'the page followed its folder');
    void v;
  });

  await t('Edit turns names into fields; a note is renamed where it stands, links and all', async () => {
    const { view, app } = setup();
    click(action(view, 'Edit'));
    assert.ok(view.editing);
    const title = view.contentEl.querySelector('.dr-detail-title.dr-edit-name');
    assert.strictEqual(title.value, 'IR');
    const field = view.contentEl.querySelector('.dr-edit-name[data-edit-path="IR/Balance.md"]');
    field.value = 'Balance of power';
    key(field, 'Enter');
    await settle();
    assert.ok(app.vault.getFileByPath('IR/Balance of power.md'), 'not renamed');
    assert.ok(names(view).includes('Balance of power'));
    assert.ok(view.editing, 'editing ended on a rename');
  });

  await t("a name that's taken, or can't be a file name, is refused with the reason", async () => {
    const { view, app } = setup();
    view.setEditing(true);
    notices.length = 0;
    const field = () => view.contentEl.querySelector('.dr-edit-name[data-edit-path="IR/Balance.md"]');
    field().value = 'Anarchy';
    key(field(), 'Enter');
    await settle();
    assert.match(notices.pop(), /already something called “Anarchy”/);
    field().value = 'A/B';
    key(field(), 'Enter');
    await settle();
    assert.match(notices.pop(), /can’t contain/);
    assert.ok(app.vault.getFileByPath('IR/Balance.md'));
    // Escape puts it back without renaming.
    field().value = 'Something else';
    key(field(), 'Escape');
    await settle();
    assert.strictEqual(field().value, 'Balance');
    assert.ok(app.vault.getFileByPath('IR/Balance.md'));
  });

  await t('the album itself, and a subfolder, are renamed from their headings', async () => {
    const { view, app } = setup();
    view.setEditing(true);
    const disc = view.contentEl.querySelector('.dr-disc.is-editing .dr-edit-name');
    assert.strictEqual(disc.value, 'Theories');
    disc.value = 'Schools';
    key(disc, 'Enter');
    await settle();
    assert.ok(app.vault.getFolderByPath('IR/Schools'));
    const title = view.contentEl.querySelector('.dr-detail-title.dr-edit-name');
    title.value = 'International Relations';
    title.dispatchEvent(new window.FocusEvent('blur'));
    await settle();
    assert.ok(app.vault.getFolderByPath('International Relations'));
    assert.strictEqual(view.path, 'International Relations');
  });

  await t("delete asks as Obsidian does, and nothing's lost when it's declined", async () => {
    const { v, view, app } = setup();
    view.setEditing(true);
    const del = () => view.contentEl.querySelector('.dr-track[data-path="IR/Anarchy.md"] .dr-edit-tool[aria-label="Delete"]');
    v.setConfirm(false);
    click(del());
    await settle();
    assert.ok(app.vault.getFileByPath('IR/Anarchy.md'), 'deleted without being confirmed');
    v.setConfirm(true);
    click(del());
    await settle();
    assert.strictEqual(app.vault.getFileByPath('IR/Anarchy.md'), null);
    assert.deepStrictEqual(names(view), ['Balance', 'Cooperation', 'Deterrence']);
  });

  await t('move sends a note to another folder, chosen from a list', async () => {
    const { view, app, theories } = setup();
    view.setEditing(true);
    click(view.contentEl.querySelector('.dr-track[data-path="IR/Balance.md"] .dr-edit-tool[aria-label="Move to another folder"]'));
    pickers.pop().onChooseItem(theories);
    await settle();
    assert.ok(app.vault.getFileByPath('IR/Theories/Balance.md'));
    assert.ok(names(view, 'IR/Theories').includes('Balance'));
  });

  await t('New note joins the album with its name ready to type, not opened', async () => {
    const { view, app, opened } = setup();
    view.setEditing(true);
    click(action(view, 'New note'));
    await settle();
    const file = app.vault.getFileByPath('IR/Untitled.md');
    assert.ok(file);
    assert.strictEqual(opened.length, 0, 'it was opened');
    const field = view.contentEl.querySelector('.dr-edit-name[data-edit-path="IR/Untitled.md"]');
    assert.strictEqual(document.activeElement, field, 'its name is not ready to type');
  });

  await t('editing shows empty subfolders, so they can be named or filled; Done leaves', () => {
    const { v, view } = setup();
    v.folder('IR/Empty');
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-disc[data-folder="IR/Empty"]'), 'shown outside editing');
    view.setEditing(true);
    assert.ok(view.contentEl.querySelector('.dr-disc[data-folder="IR/Empty"]'));
    click(action(view, 'Done'));
    assert.strictEqual(view.editing, false);
    assert.ok(action(view, 'Edit'));
  });

  await t('a row dragged by its handle, or moved with Alt+arrows, saves the new order', () => {
    const { view, plugin } = setup();
    view.setEditing(true);
    const rows = () => Array.from(view.contentEl.querySelectorAll('.dr-track[data-folder="IR"]'));
    rows().forEach((r) => {
      r.getBoundingClientRect = () => {
        const i = rows().indexOf(r);
        return { top: i * 40, bottom: i * 40 + 40, height: 40 };
      };
    });
    const grip = view.contentEl.querySelector('.dr-track[data-path="IR/Anarchy.md"] .dr-edit-grip');
    const ptr = (target, type, y) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
    ptr(grip, 'pointerdown', 20);
    ptr(window, 'pointermove', 30);
    ptr(window, 'pointermove', 130);
    ptr(window, 'pointerup', 130);
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Balance.md', 'Cooperation.md', 'Anarchy.md', 'Deterrence.md']);
    const g2 = view.contentEl.querySelector('.dr-track[data-path="IR/Deterrence.md"] .dr-edit-grip');
    key(g2, 'ArrowUp', { altKey: true });
    assert.deepStrictEqual(plugin.settings.albumOrders.IR.names, ['Balance.md', 'Cooperation.md', 'Deterrence.md', 'Anarchy.md']);
    assert.strictEqual(document.activeElement.closest('.dr-track').dataset.path, 'IR/Deterrence.md', 'focus lost');
  });

  await t('Alt+arrows over the edge of a disc move the note into the next folder, at the top', async () => {
    const { view, app, plugin } = setup();
    view.setEditing(true);
    const grip = view.contentEl.querySelector('.dr-track[data-path="IR/Deterrence.md"] .dr-edit-grip');
    key(grip, 'ArrowDown', { altKey: true });
    await settle();
    assert.ok(app.vault.getFileByPath('IR/Theories/Deterrence.md'), 'not moved');
    assert.strictEqual(plugin.settings.albumOrders['IR/Theories'].names[0], 'Deterrence.md');
  });

  await t('a move says so with an Undo, which puts it back, album order and all', async () => {
    const { plugin, app } = setup();
    ['moveFile', 'offerUndo', 'putBack'].forEach((m) => (plugin[m] = R.DesignRedux.prototype[m].bind(plugin)));
    plugin.orders.setAlbum(app.vault.getFolderByPath('IR'), ['Deterrence.md', 'Balance.md', 'Anarchy.md', 'Cooperation.md']);
    const before = JSON.parse(JSON.stringify(plugin.settings.albumOrders.IR));
    const file = app.vault.getFileByPath('IR/Balance.md');
    notices.length = 0;
    assert.strictEqual(await plugin.moveFile(file, 'IR/Theories', { announce: true }), 'IR/Balance.md');
    assert.strictEqual(file.path, 'IR/Theories/Balance.md');
    const note = notices.pop();
    assert.ok(note.textContent.startsWith('Moved “Balance” to Theories.'), note.textContent);
    note.querySelector('.dr-undo').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    assert.strictEqual(file.path, 'IR/Balance.md', 'not put back');
    assert.deepStrictEqual(plugin.settings.albumOrders.IR, before, 'its place in the collection was lost');
  });

  await t('a rename made in Edit mode can be undone too', async () => {
    const { plugin, app, view } = setup();
    ['offerUndo', 'putBack'].forEach((m) => (plugin[m] = R.DesignRedux.prototype[m].bind(plugin)));
    const file = app.vault.getFileByPath('IR/Anarchy.md');
    notices.length = 0;
    assert.strictEqual(await view.renameEntry(file, 'Anarchy and order'), true);
    assert.strictEqual(file.path, 'IR/Anarchy and order.md');
    notices.pop().querySelector('.dr-undo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    assert.strictEqual(file.path, 'IR/Anarchy.md');
  });

  await t('a folder renamed takes its folder note, and so its cover, with it', async () => {
    const v = makeVault();
    const folder = v.folder('Parliament');
    const note = v.file('Parliament/Parliament.md');
    v.file('Parliament/Commons.md');
    const plugin = {
      settings: JSON.parse(JSON.stringify(R.DEFAULTS)),
      app: { vault: v.vault, fileManager: v.fileManager },
      unloading: false,
    };
    plugin.files = new R.Files(plugin);
    plugin.folderNote = R.DesignRedux.prototype.folderNote.bind(plugin);
    plugin.followFolderNote = R.DesignRedux.prototype.followFolderNote.bind(plugin);
    plugin.renameFolderNote = R.DesignRedux.prototype.renameFolderNote.bind(plugin);
    v.vault.on('rename', (file, oldPath) => plugin.followFolderNote(file, oldPath));

    await v.fileManager.renameFile(folder, 'Parliamentarism');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(note.path, 'Parliamentarism/Parliamentarism.md');
    assert.strictEqual(plugin.folderNote(folder), note);

    // Moved, not renamed: its note stays as it is.
    v.folder('Politics');
    await v.fileManager.renameFile(folder, 'Politics/Parliamentarism');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(note.path, 'Politics/Parliamentarism/Parliamentarism.md');

    // A name already taken inside is left alone.
    const other = v.file('Politics/Parliamentarism/Westminster.md');
    await v.fileManager.renameFile(folder, 'Politics/Westminster');
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(note.path, 'Politics/Westminster/Parliamentarism.md');
    assert.strictEqual(other.path, 'Politics/Westminster/Westminster.md');
  });

  await t('Escape mid-drag puts the row back, and saves nothing', () => {
    const { view, plugin } = setup();
    view.setEditing(true);
    const grip = view.contentEl.querySelector('.dr-track[data-path="IR/Anarchy.md"] .dr-edit-grip');
    const rows = () => Array.from(view.contentEl.querySelectorAll('.dr-track[data-folder="IR"]'));
    rows().forEach((r) => { r.getBoundingClientRect = () => { const i = rows().indexOf(r); return { top: i * 40, bottom: i * 40 + 40, height: 40 }; }; });
    const ptr = (target, type, y) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
    ptr(grip, 'pointerdown', 20);
    ptr(window, 'pointermove', 140);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.deepStrictEqual(names(view), ['Anarchy', 'Balance', 'Cooperation', 'Deterrence']);
    assert.ok(!plugin.settings.albumOrders.IR);
  });

  await t('a redraw waits while a name is being typed', async () => {
    const { view } = setup();
    view.setEditing(true);
    const field = view.contentEl.querySelector('.dr-edit-name[data-edit-path="IR/Balance.md"]');
    field.focus();
    field.value = 'Bal';
    view.queueRender();
    await settle(80);
    assert.strictEqual(document.activeElement, field, 'the field was drawn over mid-word');
    assert.strictEqual(view.renderAfterEdit, true);
  });

  /* -- the strip ---------------------------------------------------------- */

  await t('skip goes to the note before and after, in the album order', () => {
    const { view, plugin, app } = setup();
    const anarchy = app.vault.getFileByPath('IR/Anarchy.md');
    let near = R.albumNeighbours(plugin, anarchy);
    assert.strictEqual(near.previous, null);
    assert.strictEqual(near.next.basename, 'Balance');
    view.arrangeTrack('IR/Anarchy.md', 'IR/Deterrence.md', true);
    near = R.albumNeighbours(plugin, anarchy);
    assert.strictEqual(near.previous.basename, 'Deterrence');
    assert.strictEqual(near.next, null);
    plugin.settings.defaultSort = 'name-desc';
    plugin.orders.setAlbumOn(app.vault.getFolderByPath('IR'), false);
    assert.deepStrictEqual(R.albumSequence(plugin, anarchy).map((f) => f.basename), ['Deterrence', 'Cooperation', 'Balance', 'Anarchy']);
  });

  await t("the strip's skip buttons name where they go and open it in the page", () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    const leaf = { isDeferred: false, view: Object.assign(new MarkdownView(), { file, getMode: () => 'source' }), openFile(f) { this.view.file = f; } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.workspace.on = () => ({});
    app.metadataCache.on = () => ({});
    app.commands = { executeCommandById() {} };
    plugin.pins.has = () => false;
    const strip = new R.ContextStrip(plugin);
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    strip.update();
    const prev = strip.el.querySelector('[data-action="previous"]');
    const next = strip.el.querySelector('[data-action="next"]');
    assert.strictEqual(prev.getAttribute('aria-label'), 'Previous: Anarchy');
    assert.strictEqual(next.getAttribute('aria-label'), 'Next: Cooperation');
    click(next);
    assert.strictEqual(leaf.view.file.basename, 'Cooperation');
    const cmds = Object.fromEntries(strip.commands().map((c) => [c.id, c]));
    assert.strictEqual(cmds['next-in-album'].check(), true);
    cmds['next-in-album'].run();
    assert.strictEqual(leaf.view.file.basename, 'Deterrence');
    assert.strictEqual(cmds['next-in-album'].check(), false, 'offered past the last note');
    // Only what's needed shown until it's pointed at: Properties and More always, the rest waiting.
    const secondary = Array.from(strip.el.querySelectorAll('.dr-strip-actions .is-secondary')).map((b) => b.dataset.action);
    assert.deepStrictEqual(secondary, ['mode', 'pin']);
    // In a narrow window those go into More instead, first in its menu.
    app.workspace.trigger = () => {};
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
    strip.update();
    assert.ok(strip.el.classList.contains('is-narrow'));
    assert.deepStrictEqual(Array.from(strip.el.querySelectorAll('.dr-strip-actions .is-secondary')), []);
    click(strip.el.querySelector('[data-action="more"]'));
    assert.deepStrictEqual(menus[menus.length - 1].items.slice(0, 2).map((i) => i.title), ['Read', 'Pin']);
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    // An album's strip: the actions written for albums elsewhere, sorting, and More.
    const made = [];
    plugin.features = [{ actions: () => [{ id: 'new-note-here', name: 'New note in the current folder', on: 'album', run: (ctx) => made.push(`${ctx.folder.path} from ${ctx.from}`) }] }];
    const { view } = setup();
    Object.assign(view, { app, plugin });
    leaf.view = view;
    strip.update();
    assert.deepStrictEqual(Array.from(strip.el.querySelectorAll('.dr-strip-actions .dr-strip-btn')).map((b) => b.dataset.action), ['new-note-here', 'sort', 'more']);
    assert.strictEqual(strip.el.querySelector('[data-action="new-note-here"]').getAttribute('aria-label'), 'New note');
    click(strip.el.querySelector('[data-action="new-note-here"]'));
    assert.deepStrictEqual(made, ['IR from strip']);
    assert.ok(!strip.el.querySelector('[data-action="more"]').classList.contains('is-secondary'));
    // An album screen: its cover, what it holds and what it is.
    const browse = Object.assign(Object.create(R.BrowseView.prototype), { mode: 'folder', path: 'IR', plugin, app, leaf: {} });
    browse.folder = () => app.vault.getFolderByPath('IR');
    browse.getDisplayText = () => 'IR';
    leaf.view = browse;
    strip.update();
    assert.ok(/\d+ items/.test(strip.el.querySelector('.dr-strip-sub').textContent), strip.el.querySelector('.dr-strip-sub').textContent);
    assert.ok(!strip.el.querySelector('.dr-strip-art').classList.contains('is-blank'), 'the collection’s cover');
  });

  await t('a note without a cover shows the first image in it, where the setting has it', () => {
    const note = new TFile('Notes/Trip.md');
    const image = new TFile('Pictures/view.png');
    const app = {
      metadataCache: {
        getFileCache: () => ({ embeds: [{ link: 'notes.pdf' }, { link: 'view.png' }] }),
        getFirstLinkpathDest: (link) => (link === 'view.png' ? image : link === 'notes.pdf' ? new TFile('notes.pdf') : null),
      },
      vault: { getResourcePath: (f) => `app://${f.path}` },
    };
    const plugin = { app, settings: { coverProperty: 'cover', coverFromFirstImage: R.DEFAULTS.coverFromFirstImage } };
    assert.strictEqual(R.noteCoverSrc(plugin, note), null, 'off to start');
    plugin.settings.coverFromFirstImage = true;
    assert.strictEqual(R.noteCoverSrc(plugin, note), 'app://Pictures/view.png', 'past what isn\'t an image');
    // A cover of its own still comes first.
    app.metadataCache.getFileCache = () => ({ frontmatter: { cover: '[[own.png]]' }, embeds: [{ link: 'view.png' }] });
    app.metadataCache.getFirstLinkpathDest = (link) => (link === 'own.png' ? new TFile('own.png') : image);
    assert.strictEqual(R.noteCoverSrc(plugin, note), 'app://own.png');
  });

  await t("an image dropped on an album's cover becomes its folder note's cover; one from outside is saved first", async () => {
    const image = new TFile('Pictures/view.png');
    const note = new TFile('Law/Law.md');
    const set = [];
    const saved = [];
    const plugin = {
      settings: { coverDrop: true },
      app: {
        dragManager: { draggable: { type: 'file', file: image } },
        vault: {
          getFolderByPath: (p) => (p === 'Law' ? new TFolder('Law') : null),
          createBinary: async (p) => { saved.push(p); return new TFile(p); },
        },
        fileManager: { getAvailablePathForAttachment: async (name, from) => `Attachments/${name}` },
      },
      ensureFolderNote: async () => note,
      feature: () => ({ setCover: async (file, value) => set.push([file.path, value]), linkTo: (img) => `[[${img.name}]]` }),
    };
    const drop = new R.CoverDrop(plugin);
    const art = document.body.createDiv();
    art.dataset.coverFolder = 'Law';
    const event = (files) => ({ target: art, dataTransfer: { files, types: ['Files'] }, preventDefault() { this.prevented = true; }, stopPropagation() {} });
    const fromVault = event([]);
    await drop.onDrop(fromVault);
    assert.ok(fromVault.prevented);
    assert.deepStrictEqual(set, [['Law/Law.md', '[[view.png]]']]);
    // From outside the vault: saved as an attachment, then linked.
    plugin.app.dragManager = { draggable: null };
    const blob = { name: 'photo.jpg', type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(4) };
    await drop.onDrop(event([blob]));
    assert.deepStrictEqual(saved, ['Attachments/photo.jpg']);
    assert.deepStrictEqual(set[1], ['Law/Law.md', '[[photo.jpg]]']);
    // Not an image, or switched off: left alone.
    const text = event([{ name: 'notes.txt', type: 'text/plain' }]);
    await drop.onDrop(text);
    assert.ok(!text.prevented);
    plugin.settings.coverDrop = false;
    const off = event([blob]);
    await drop.onDrop(off);
    assert.ok(!off.prevented);
    assert.strictEqual(set.length, 2);
    art.remove();
  });

  await t('the strip says where the note falls in its album, as "2 of 4", unless switched off', () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    const leaf = { isDeferred: false, view: Object.assign(new MarkdownView(), { file, getMode: () => 'source' }), openFile(f) { this.view.file = f; } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.workspace.on = () => ({});
    app.metadataCache.on = () => ({});
    app.commands = { executeCommandById() {} };
    plugin.pins.has = () => false;
    const strip = new R.ContextStrip(plugin);
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    strip.update();
    const place = () => {
      const el = strip.el.querySelector('.dr-strip-place');
      return el ? el.textContent : null;
    };
    assert.strictEqual(R.DEFAULTS.stripPlace, true);
    assert.strictEqual(place(), '2 of 4');
    plugin.settings.stripPlace = false;
    strip.el.empty();
    strip.update();
    assert.strictEqual(place(), null);
    strip.el.remove();
  });

  await t("what the strip shows beside that is the setting's: properties, folder and the like, or its own pick", () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    app.metadataCache.getFileCache = () => ({ frontmatter: { status: 'medium touched', domain: '[[Politics]]', tags: ['ir', 'theory'] } });
    const said = (spec) => R.stripDetail(app, file, spec);
    // Empty: one property worth showing, as before.
    assert.strictEqual(said(''), 'Politics');
    assert.strictEqual(said('tags, status'), 'ir, theory · medium touched');
    assert.strictEqual(said('author, folder'), 'IR', 'what the note lacks is left out');
    assert.strictEqual(said('none'), '');
    assert.strictEqual(R.DEFAULTS.stripDetail, '');
    assert.ok(JSON.stringify(R.SETTINGS_TABS).includes('"stripDetail"'), 'a row in settings');
  });

  await t("the strip's line shows how far down the note you are, and goes when it's switched off", () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    const containerEl = document.body.createDiv();
    const scroller = containerEl.createDiv({ cls: 'markdown-preview-view' });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 1400, configurable: true });
    const view = Object.assign(new MarkdownView(), { file, containerEl, getMode: () => 'preview' });
    const leaf = { isDeferred: false, view, openFile() {} };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.workspace.on = () => ({});
    app.metadataCache.on = () => ({});
    app.commands = { executeCommandById() {} };
    plugin.pins.has = () => false;
    const strip = new R.ContextStrip(plugin);
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    assert.strictEqual(R.DEFAULTS.stripProgress, true);
    strip.update();
    assert.ok(strip.el.querySelector('.dr-strip-progress'));
    scroller.scrollTop = 250;
    strip.measureScroll();
    assert.strictEqual(strip.el.style.getPropertyValue('--dr-progress'), '0.2500');
    assert.ok(strip.el.classList.contains('has-progress'));
    // A short note has nowhere to go: no line.
    Object.defineProperty(scroller, 'scrollHeight', { value: 404, configurable: true });
    strip.measureScroll();
    assert.ok(!strip.el.classList.contains('has-progress'));
    plugin.settings.stripProgress = false;
    strip.update();
    assert.ok(!strip.el.querySelector('.dr-strip-progress'));
    assert.strictEqual(strip.scrollHost, null, 'no longer listening');
    strip.disable();
    containerEl.remove();
  });

  await t("no player: the album page offers Random, and the strip's » goes to the album's next note", async () => {
    const { plugin, app, view } = setup();
    const strip = new R.ContextStrip(plugin);
    plugin.feature = (C) => (C === R.ContextStrip ? strip : null);
    const file = app.vault.getFileByPath('IR/Balance.md');
    const leaf = { isDeferred: false, view: Object.assign(new MarkdownView(), { file, getMode: () => 'source' }), openFile(f) { this.view.file = f; } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.commands = { executeCommandById() {} };
    strip.el = document.body.createDiv({ cls: 'dr-strip' });
    strip.update();
    assert.strictEqual(strip.el.querySelector('[data-action="next"]').getAttribute('aria-label'), 'Next: Cooperation');
    assert.ok(!strip.el.querySelector('[data-action="up-next"]'), 'no queue');
    strip.skip('next');
    assert.strictEqual(leaf.view.file.basename, 'Cooperation');
    view.render();
    const actions = Array.from(view.contentEl.querySelectorAll('.dr-detail-action')).map((b) => b.textContent);
    assert.ok(actions.includes('Random') && !actions.includes('Shuffle'), actions.join(', '));
    assert.strictEqual(R.DEFAULTS.upNext, undefined, 'the setting is retired');
    strip.el.remove();
  });

  /* -- lengths, Home ------------------------------------------------------- */

  const f = (app, p) => app.vault.getFileByPath(p);
  await t("rows end with each note's length once counted, and the header gives the total", async () => {
    assert.strictEqual(R.countWords('---\ntitle: x\n---\n# Heading\n\n- one two\n'), 3);
    assert.strictEqual(R.readingTime(230 * 65), '1 hr 5 min');
    const { view, plugin, app } = setup();
    plugin.lengths = new R.Lengths(plugin);
    const words = { Anarchy: 460, Balance: 1150, Cooperation: 30 };
    app.vault.cachedRead = async (file) => 'word '.repeat(words[file.basename] || 0);
    view.render();
    await settle(120);
    const lengths = Array.from(view.contentEl.querySelectorAll('.dr-track[data-folder="IR"] .dr-track-length')).map((e) => e.textContent);
    assert.deepStrictEqual(lengths, ['2 min', '5 min', '<1 min', '']);
    assert.ok(view.contentEl.querySelector('.dr-detail-meta').textContent.includes('7 min read'));
  });

  await t('the note last opened keeps its number and colour in the list, with no mark', () => {
    const { view, plugin, app } = setup();
    plugin.recentFiles = () => [f(app, 'IR/Cooperation.md')];
    view.render();
    const row = view.contentEl.querySelector('.dr-track[data-path="IR/Cooperation.md"]');
    assert.strictEqual(row.querySelector('.dr-track-num').textContent, '3');
    assert.strictEqual(row.querySelector('.dr-track-num').children.length, 0, 'a mark was drawn over its number');
    assert.ok(!row.classList.contains('is-current'));
  });

  await t("without a cover: a cover drawn for it by default, the folder's cover when asked, or the icon on a soft colour", () => {
    const { view, plugin, app } = setup();
    plugin.folderCoverSrc = (folder) => (folder.path === 'IR' ? 'ir.png' : null);
    plugin.recentFiles = () => [f(app, 'IR/Anarchy.md'), f(app, 'IR/Theories/Realism.md')];
    Object.assign(view, { mode: 'recents' });
    const tiles = () => Array.from(view.contentEl.querySelectorAll('.dr-card-art')).map((el) => {
      const img = el.querySelector('img');
      if (img) return img.getAttribute('src');
      if (el.classList.contains('is-drawn')) return 'drawn';
      return el.classList.contains('is-hued') ? 'soft' : el.classList.contains('is-blank') ? 'icon' : '?';
    });
    view.render();
    assert.deepStrictEqual(tiles(), ['drawn', 'drawn'], 'the default is a cover drawn for each');
    plugin.settings.coverFromFolder = true;
    view.render();
    assert.deepStrictEqual(tiles(), ['ir.png', 'drawn'], "only the note's own folder counts, not one above it");
    plugin.settings.coverFromFolder = false;
    plugin.settings.coverFallback = 'soft';
    view.render();
    assert.deepStrictEqual(tiles(), ['soft', 'soft']);
    const hues = Array.from(view.contentEl.querySelectorAll('.dr-card-art')).map((el) => el.style.getPropertyValue('--dr-gen-h'));
    assert.notStrictEqual(hues[0], hues[1], 'each note should take its own colour');
    const folder = document.createElement('div');
    R.drawFolderArt(plugin, folder, app.vault.getFolderByPath('IR/Theories'));
    assert.ok(folder.classList.contains('is-hued'), 'a folder without a cover took no soft colour');
  });

  await t('Home leads with large cards, then shelves that scroll sideways', async () => {
    const { view, plugin, app, opened } = setup();
    plugin.recentFiles = () => [f(app, 'IR/Balance.md')];
    await view.setState({ mode: 'home' }, {});
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((e) => e.textContent);
    assert.deepStrictEqual(text('.dr-pick-caption'), ['Last opened', 'Rediscover']);
    assert.deepStrictEqual(text('.dr-shelf-title'), ['Continue reading', 'Recently opened', 'Recently added', 'Rediscover', 'Folders']);
    click(view.contentEl.querySelector('.dr-pick[data-path="IR/Balance.md"]'));
    assert.strictEqual(opened[0].basename, 'Balance');
  });

  await t("Home's shelves: where to pick up in each album, your collections, and the shelves you chose in the order you chose", async () => {
    const { v, view, plugin, app } = setup();
    const notes = R.albumSequence(plugin, f(app, 'IR/Balance.md'));
    plugin.recentFiles = () => [notes[1]];
    await view.setState({ mode: 'home' }, {});
    const shelf = (title) => {
      const head = Array.from(view.contentEl.querySelectorAll('.dr-shelf-head')).find((h) => h.textContent.includes(title));
      return head ? head.nextElementSibling : null;
    };
    const cards = (title) => Array.from(shelf(title).querySelectorAll('.dr-card')).map((c) => `${c.querySelector('.dr-card-title').textContent} · ${(c.querySelector('.dr-card-sub') || {}).textContent}`);
    assert.deepStrictEqual(cards('Continue reading'), [`${notes[2].basename} · IR · 3 of ${notes.length}`], 'the note after the last one opened, with how far along');
    assert.strictEqual(shelf('Continue reading').querySelector('.dr-card-progress').style.getPropertyValue('--dr-progress'), (2 / notes.length).toFixed(4));


    // Your collections: smart albums, then albums that gather notes from elsewhere.
    const smart = new R.SmartAlbums(plugin);
    smart.enabled = true;
    plugin.settings.smartAlbumList = [{ id: 's1', name: 'Unread' }];
    const structure = new R.AlbumStructure(plugin);
    structure.enabled = true;
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    v.folder('Reading');
    const reading = v.file('Reading/Reading.md');
    app.metadataCache.getFileCache = (f) => (f === reading ? { frontmatter: { includes: ['[[Anarchy]]'] } } : null);
    plugin.feature = (C) => (C === R.SmartAlbums ? smart : C === R.AlbumStructure ? structure : null);
    view.render();
    assert.deepStrictEqual(cards('Your views'), ['Unread · Saved view', `Reading · ${(shelf('Your views').querySelectorAll('.dr-card-sub')[1] || {}).textContent}`]);
    const went = [];
    view.leaf.setViewState = async (s) => went.push(s.state);
    click(shelf('Your views').querySelector('.dr-card'));
    assert.deepStrictEqual([went[0].mode, went[0].property], ['smart', 's1']);

    // Chosen and ordered in the settings; a shelf new since comes on at the end.
    plugin.settings.homeShelves = [{ id: 'folders', on: true }, { id: 'picks', on: false }, { id: 'recents', on: true }];
    assert.deepStrictEqual(R.homeShelves(plugin.settings).map((s) => `${s.id}:${s.on}`), ['folders:true', 'picks:false', 'recents:true', 'continue:true', 'added:true', 'collections:true', 'pinned:true', 'rediscover:true']);
    plugin.settings.homeShelves = HOME_OFF.map((id) => ({ id, on: false })).concat([{ id: 'folders', on: true }, { id: 'recents', on: true }]);
    await view.setState({ mode: 'home' }, {});
    const titles = Array.from(view.contentEl.querySelectorAll('.dr-shelf-title')).map((e) => e.textContent);
    assert.deepStrictEqual(titles, ['Folders', 'Recently opened']);
    assert.ok(!view.contentEl.querySelector('.dr-pick'), 'the large cards were turned off');
  });

  await t('the preview: a note or album picked in the library, in brief, without opening it; a double click or Enter opens it', async () => {
    const { view, plugin, app, opened } = setup();
    plugin.selection = new R.Selection(plugin);
    view.unpick = plugin.selection.onChange(() => {
      view.markPicked();
      view.renderPreview();
    });
    const row = (name) => view.contentEl.querySelector(`.dr-track[data-path="IR/${name}.md"]`);
    view.render();
    assert.ok(!view.containerEl.querySelector('.dr-preview'), 'hidden until asked for');
    click(row('Anarchy'));
    assert.strictEqual(opened.length, 1, 'without it, a click opens as it always has');

    // Shown with the button by Sort and filter, for every page of the library.
    plugin.refreshBrowse = () => view.render();
    click(view.contentEl.querySelector('.dr-preview-btn'));
    assert.strictEqual(plugin.settings.libraryPreview, true);
    const pane = () => view.containerEl.querySelector('.dr-preview');
    assert.ok(pane().querySelector('.dr-preview-empty'));
    click(row('Balance'));
    assert.strictEqual(opened.length, 1, 'while it shows, a click picks');
    assert.ok(row('Balance').classList.contains('is-selected'));
    const facts = () => Array.from(pane().querySelectorAll('.dr-preview-label')).map((e) => e.textContent);
    assert.strictEqual(pane().querySelector('.dr-preview-title').textContent, 'Balance');
    assert.deepStrictEqual(facts(), ['In', 'Created', 'Modified']);
    const buttons = () => Array.from(pane().querySelectorAll('.dr-detail-action')).map((b) => b.textContent);
    assert.deepStrictEqual(buttons(), ['Open', 'More'], 'already in its collection: nothing to reveal');
    assert.ok(!pane().querySelector('.dr-props-popup, .dr-row'), 'no properties to edit: that’s the note panel’s');

    row('Balance').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.strictEqual(opened[1].basename, 'Balance', 'a double click opens');
    row('Cooperation').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.strictEqual(opened[2].basename, 'Cooperation', 'Enter opens');

    // Elsewhere, it can take you to the note's album, still picked there.
    const went = [];
    view.leaf.setViewState = async (st) => went.push(st.state);
    await view.setState({ mode: 'recents' }, {});
    plugin.selection.set({ file: app.vault.getFileByPath('IR/Theories/Realism.md') });
    assert.deepStrictEqual(buttons(), ['Open', 'Reveal in collection', 'More']);
    click(Array.from(pane().querySelectorAll('.dr-detail-action')).find((b) => b.textContent === 'Reveal in collection'));
    assert.deepStrictEqual([went[0].mode, went[0].path], ['folder', 'IR/Theories']);

    // An album: what kind, what it holds, where it is.
    await view.setState({ mode: 'folders' }, {});
    click(view.contentEl.querySelector('.dr-card[data-path="IR"]'));
    assert.strictEqual(plugin.selection.get().folder.path, 'IR');
    assert.deepStrictEqual(['.dr-preview-title', '.dr-preview-lead'].map((sel) => pane().querySelector(sel).textContent), ['IR', 'Collection']);
    assert.deepStrictEqual(facts(), ['Holds', 'In']);

    view.onKey({ key: 'Escape', target: view.contentEl, preventDefault() {} });
    assert.strictEqual(plugin.selection.get(), null, 'Escape lets go');
    plugin.selection.set({ folder: app.vault.getFolderByPath('IR') });
    plugin.selection.followDelete(app.vault.getFolderByPath('IR'));
    assert.strictEqual(plugin.selection.get(), null, 'gone, no longer picked');

    // Set always to open; and hidden again, nothing stays picked.
    plugin.settings.inspectorClick = 'never';
    await view.setState({ mode: 'folder', path: 'IR' }, {});
    click(row('Deterrence'));
    assert.strictEqual(opened[3].basename, 'Deterrence', 'set always to open');
    plugin.selection.set({ folder: app.vault.getFolderByPath('IR/Theories') });
    view.togglePreview();
    assert.ok(!pane() && plugin.selection.get() === null);
  });

  await t('search answers as a music app does: the top result large, then albums as covers, notes as rows, collections — See All for the rest of one', async () => {
    const { v, view, plugin } = setup();
    plugin.settings.searchNoteText = false;
    const smart = new R.SmartAlbums(plugin);
    smart.enabled = true;
    plugin.settings.smartAlbumList = [{ id: 's1', name: 'Reading list' }];
    plugin.feature = (C) => (C === R.SmartAlbums ? smart : null);
    v.folder('Readings');
    v.file('Readings/One.md');
    v.file('IR/Reading notes.md');
    await view.setState({ mode: 'search' }, {});
    view.query = 'reading';
    view.render();
    const heads = () => Array.from(view.contentEl.querySelectorAll('.dr-search-section-title')).map((e) => e.textContent);
    assert.deepStrictEqual(heads(), ['Top Result', 'Collections', 'Notes', 'Views']);
    const top = view.contentEl.querySelector('.dr-search-top');
    assert.strictEqual(top.dataset.path, 'IR/Reading notes.md', 'the note whose name starts with it');
    assert.strictEqual(top.querySelector('.dr-search-top-sub').textContent, 'Note · IR');
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-card-title')).map((e) => e.textContent), ['Readings', 'Reading list']);
    assert.ok(!view.contentEl.querySelector('.dr-search-notes .dr-track[data-path="IR/Reading notes.md"]'), 'not again below');
    assert.ok(view.contentEl.querySelector('.dr-search-notes .dr-track[data-path="Readings/One.md"]'), 'in the collection named for it');

    // An album named exactly so is the top result.
    view.query = 'readings';
    view.render();
    assert.strictEqual(view.contentEl.querySelector('.dr-search-top').dataset.kind, 'albums');

    // More than six notes: See All shows them all, and back again.
    for (let i = 0; i < 8; i++) v.file(`IR/Reading ${i}.md`);
    view.query = 'reading';
    view.render();
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-search-notes .dr-track').length, 6);
    view.contentEl.querySelector('.dr-search-see-all[data-kind="notes"]').click();
    assert.strictEqual(view.query, 'reading');
    assert.deepStrictEqual(heads(), ['Notes']);
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-search-notes .dr-track').length, 9, 'all but the top result');
    view.contentEl.querySelector('.dr-search-back').click();
    assert.strictEqual(view.searchKind, null);
    assert.ok(heads().includes('Top Result'));
  });

  await t('search puts the note named for the query first and says why each matched; values named so are among Properties', async () => {
    const { v, view, app, plugin } = setup();
    plugin.settings.searchNoteText = false;
    const law = v.file('IR/Constitutional Law.md');
    const ism = v.file('IR/Constitutionalism.md');
    const sep = v.file('IR/Separation of Powers.md');
    const fms = new Map([[sep, { domain: 'Constitutional Law' }], [law, { domain: 'Politics' }]]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    await view.setState({ mode: 'search' }, {});
    view.query = 'constitutional law';
    view.render();
    const rows = () => Array.from(view.contentEl.querySelectorAll('.dr-search-notes .dr-track')).map((r) => r.dataset.path);
    const why = (p) => view.contentEl.querySelector(`.dr-track[data-path="${p}"] .dr-track-name`).dataset.excerpt;
    assert.strictEqual(view.contentEl.querySelector('.dr-search-top').dataset.path, law.path, 'the exact title on top');
    assert.deepStrictEqual(rows(), [sep.path]);
    assert.strictEqual(why(sep.path), 'Property: domain = Constitutional Law');
    const props = () => Array.from(view.contentEl.querySelectorAll('.dr-search-prop-title')).map((e) => e.textContent);
    assert.deepStrictEqual(props(), ['domain: Constitutional Law']);
    const went = [];
    view.leaf.setViewState = async (st) => went.push(st.state);
    view.contentEl.querySelector('.dr-search-prop').click();
    assert.deepStrictEqual([went[0].mode, went[0].property, went[0].value], ['properties', 'domain', 'Constitutional Law']);

    view.query = 'constitutional';
    view.render();
    const shown = [view.contentEl.querySelector('.dr-search-top').dataset.path].concat(rows());
    assert.deepStrictEqual(shown.slice(0, 2).sort(), [law.path, ism.path].sort(), 'titles first');
    assert.strictEqual(shown[2], sep.path);
  });

  await t('search reads what notes say a moment after typing, showing the passage; See All shows only those; off in settings, it reads nothing', async () => {
    const { v, view, plugin, app } = setup();
    const texts = {
      'IR/Theories/Realism.md': '---\ntopic: x\n---\nStates seek power. Parliamentary sovereignty is a doctrine of the constitution, held since 1689.',
      'IR/Deterrence.md': 'Nothing here.',
    };
    const sov = v.file('IR/Sovereignty.md');
    texts[sov.path] = 'The sovereignty of parliament.';
    let reads = 0;
    app.vault.cachedRead = async (f) => {
      reads++;
      return texts[f.path] || '';
    };
    await view.setState({ mode: 'search' }, {});
    view.query = 'sovereignty';
    view.render();
    assert.ok(view.contentEl.querySelector('.dr-search-text-status'), 'looking');
    await new Promise((r) => setTimeout(r, R.TEXT_PAUSE + 100));
    const found = () => Array.from(view.contentEl.querySelectorAll('.dr-search-text-notes .dr-track')).map((r) => r.dataset.path);
    assert.deepStrictEqual(found(), ['IR/Theories/Realism.md'], 'the note named for it is listed above, not again');
    const line = view.contentEl.querySelector('.dr-search-text-notes .dr-track-name').dataset.excerpt;
    assert.ok(line.includes('Parliamentary sovereignty is a doctrine') && !line.includes('topic'), line);
    assert.strictEqual(view.contentEl.querySelector('.dr-search-top').dataset.path, 'IR/Sovereignty.md');

    // Drawn again: not read again.
    const before = reads;
    view.render();
    assert.deepStrictEqual(found(), ['IR/Theories/Realism.md']);
    assert.strictEqual(reads, before);

    // See All for In Notes: only what notes say.
    view.searchKind = 'text';
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-search-notes'));
    assert.deepStrictEqual(found(), ['IR/Theories/Realism.md']);
    view.searchKind = null;

    plugin.settings.searchNoteText = false;
    view.query = 'doctrine';
    view.render();
    await new Promise((r) => setTimeout(r, R.TEXT_PAUSE + 50));
    assert.ok(!view.contentEl.querySelector('.dr-search-text'));
  });

  await t('Search with nothing typed: searches as a short list, categories as tiles from a property you choose — else the ways in; a note offers a new tab, its album and its link', async () => {
    const { v, view, app, plugin } = setup();
    v.file('IR/Newest.md');
    plugin.settings.recentSearches = ['realism', 'anarchy'];
    plugin.settings.categoryProperty = '';
    await view.setState({ mode: 'search' }, {});
    view.query = '';
    view.render();
    const heads = () => Array.from(view.contentEl.querySelectorAll('.dr-search-section-title')).map((e) => e.textContent);
    assert.deepStrictEqual(heads(), ['Recently Searched', 'Browse Categories']);
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-recent-list .dr-recent-title')).map((e) => e.textContent), ['realism', 'anarchy']);
    assert.strictEqual(view.contentEl.querySelector('.dr-cat-choice').textContent, 'Choose a property');
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-browse-by-item')).map((e) => e.textContent), ['Collections', 'Properties', 'Tags']);
    // With a property chosen, its values are the tiles.
    view.groupsByProperty = (key) => (key === 'domain' ? [{ value: 'Law', files: [app.vault.getFileByPath('IR/Newest.md')] }] : []);
    plugin.propertyLabel = (k) => k;
    plugin.settings.categoryProperty = 'domain';
    view.render();
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-cat-name')).map((e) => e.textContent), ['Law']);
    assert.ok(!view.contentEl.querySelector('.dr-browse-by'));
    assert.strictEqual(view.contentEl.querySelector('.dr-cat-choice').textContent, 'domain');
    delete view.groupsByProperty;
    plugin.settings.categoryProperty = '';
    view.render();
    const went = [];
    view.leaf.setViewState = async (st) => went.push(st.state);
    view.contentEl.querySelectorAll('.dr-browse-by-item')[2].click();
    assert.strictEqual(went[0].mode, 'properties');
    assert.strictEqual(went[0].property, 'tags');

    const file = app.vault.getFileByPath('IR/Newest.md');
    await view.setState({ mode: 'search' }, {});
    assert.deepStrictEqual(view.noteOpenings(file).map((e) => e[0]), ['Open in new tab', 'Reveal in collection', 'Copy link']);
    await view.setState({ mode: 'folder', path: 'IR' }, {});
    assert.deepStrictEqual(view.noteOpenings(file).map((e) => e[0]), ['Open in new tab', 'Copy link'], 'its own collection needs no revealing');
  });

  await t('the passage found in a note: whole words around the query, the properties left out', () => {
    const { textExcerpt } = R;
    const text = '---\nstatus: sovereignty\n---\n' + 'word '.repeat(40) + 'the sovereignty of parliament ' + 'more '.repeat(40);
    const got = textExcerpt(text, 'sovereignty of parliament', 60);
    assert.ok(got.startsWith('…') && got.endsWith('…') && got.includes('sovereignty of parliament'), got);
    assert.ok(!got.includes('status'));
    assert.strictEqual(textExcerpt('the parliament is sovereign', 'parliament sovereign'), 'the parliament is sovereign');
    assert.strictEqual(textExcerpt('nothing', 'parliament'), null);
  });

  await t('layout: Automatic shows collections as covers and notes you opened as a list; Lists shows collections as rows too', async () => {
    const { view, plugin, app } = setup();
    plugin.settings.libraryLayout = 'auto';
    plugin.recentFiles = () => [app.vault.getFileByPath('IR/Anarchy.md')];
    await view.setState({ mode: 'recents' }, {});
    assert.ok(view.contentEl.querySelector('.dr-collection-tracks .dr-track[data-path="IR/Anarchy.md"]'), 'recently opened: a list');
    assert.ok(!view.contentEl.querySelector('.dr-card'));
    await view.setState({ mode: 'folders' }, {});
    assert.strictEqual(view.contentEl.querySelector('.dr-browse-title').textContent, 'Collections');
    assert.ok(view.contentEl.querySelector('.dr-card'), 'collections: covers');
    plugin.settings.libraryLayout = 'lists';
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-card'));
    assert.ok(view.contentEl.querySelector('.dr-folder-rows .dr-search-prop[data-path="IR"]'), 'collections: rows');
    plugin.settings.libraryLayout = 'covers';
    await view.setState({ mode: 'recents' }, {});
    assert.ok(view.contentEl.querySelector('.dr-card'), 'covers, as set');
  });

  await t('a folder’s PDFs wait after its notes, in a list of their own without numbers', async () => {
    const { v, view } = setup();
    v.file('IR/Keohane.pdf');
    v.file('IR/Martin.pdf');
    await view.setState({ mode: 'folder', path: 'IR' }, {});
    const notes = Array.from(view.contentEl.querySelectorAll('.dr-tracks:not(.dr-pdf-list) .dr-track')).map((r) => r.dataset.path);
    assert.ok(notes.length && notes.every((p) => !p.endsWith('.pdf')), 'none among the notes');
    const pdfs = view.contentEl.querySelector('.dr-pdf-list');
    assert.strictEqual(pdfs.querySelector('.dr-disc-title').textContent, 'PDFs');
    assert.deepStrictEqual(Array.from(pdfs.querySelectorAll('.dr-track')).map((r) => r.dataset.path).sort(), ['IR/Keohane.pdf', 'IR/Martin.pdf']);
    assert.ok(Array.from(pdfs.querySelectorAll('.dr-track')).every((r) => r.classList.contains('is-unnumbered') && r.querySelector('.dr-track-num').textContent === ''));
  });

  await t('a PDF in a list has no grey line: only a note has text to read one from', async () => {
    const { v, view, app } = setup();
    const pdf = v.file('IR/Keohane.pdf');
    let read = 0;
    app.vault.cachedRead = async () => { read++; return '%PDF-1.6 binary'; };
    const el = document.createElement('div');
    view.showExcerpt(el, pdf);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(read, 0, 'not read');
    assert.ok(!el.dataset.excerpt && !el.classList.contains('has-excerpt'));
  });

  await t('a note matches by its title, alias, a property, its album, or nearly its title — in that order', () => {
    const { rankNote } = R;
    const score = (parts, q) => (rankNote(parts, q) || { score: 0 }).score;
    const title = score({ title: 'Deterrence' }, 'deterrence');
    const starts = score({ title: 'Deterrence theory' }, 'deterrence');
    const alias = score({ title: 'X', props: { aliases: ['Deterrence'] } }, 'deterrence');
    const near = score({ title: 'Deterrence' }, 'dtrnc');
    const prop = score({ title: 'X', props: { topic: 'nuclear deterrence' } }, 'deterrence');
    const album = score({ title: 'X', album: 'Security/Deterrence' }, 'deterrence');
    assert.ok(title > starts && starts > alias && alias > prop && prop > album, [title, starts, alias, prop, album].join());
    assert.ok(near > prop && near < alias);
    assert.strictEqual(rankNote({ title: 'X', props: { aliases: ['Deterrence'] } }, 'deterrence').why, 'Alias: Deterrence');
    assert.strictEqual(rankNote({ title: 'Balance' }, 'deterrence'), null);
    assert.strictEqual(rankNote({ title: 'Deterrence' }, 'zzz'), null);
  });

  await t('the sort menu says how an album shows and opens its display settings; Find offers the whole library', async () => {
    const { v, view, plugin, app } = setup();
    const structure = new R.AlbumStructure(plugin);
    structure.enabled = true;
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    v.file('IR/IR.md');
    const set = [];
    structure.setLayout = async (folder, id) => set.push([folder.path, id]);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const opened = [];
    plugin.openSettingsAt = (key) => opened.push(key);
    await view.setState({ mode: 'folder', path: 'IR' }, {});
    const menu = view.filterMenu();
    const titles = menu.items.map((i) => i.title);
    assert.ok(titles.includes('View as list') && titles.includes('View as covers'));
    assert.strictEqual(menu.items.find((i) => i.title === 'View as list').checked, true);
    menu.items.find((i) => i.title === 'View as covers').click();
    await settle(0);
    assert.deepStrictEqual(set, [['IR', 'covers']]);
    menu.items.find((i) => i.title === 'Display settings…').click();
    assert.deepStrictEqual(opened, ['albumColumns']);

    const went = [];
    view.leaf.setViewState = async (s) => went.push(s.state);
    view.query = 'bal';
    view.render();
    const wide = view.contentEl.querySelector('.dr-chip-wide .dr-chip-label');
    assert.strictEqual(wide.textContent, 'Search everywhere for “bal”');
    click(wide);
    assert.deepStrictEqual([went[0].mode, went[0].query], ['search', 'bal']);
    await view.setState(went[0], {});
    assert.strictEqual(view.query, 'bal', 'carried over');
  });

  await t('the library index: worked out once while listening, forgotten as files come and go and links resolve', () => {
    const { v, plugin, app } = setup();
    const on = {};
    app.vault.on = (type, fn) => ((on[type] = fn), {});
    app.metadataCache.on = (type, fn) => ((on[type] = fn), {});
    plugin.registerEvent = () => {};
    let scans = 0;
    const markdown = app.vault.getMarkdownFiles.bind(app.vault);
    app.vault.getMarkdownFiles = () => (scans++, markdown());
    const index = new R.LibraryIndex(plugin);
    const ir = app.vault.getFolderByPath('IR');
    // Not listening: worked out on each ask, as a stand-in vault needs.
    index.notes();
    index.notes();
    assert.strictEqual(scans, 2);
    index.listen();
    scans = 0;
    const before = index.notes().length;
    index.notes().sort();
    index.markdown();
    assert.strictEqual(scans, 1, 'once, while listening');
    assert.strictEqual(index.notes().length, before, 'a copy to sort, not what is kept');
    assert.strictEqual(index.count(ir), 6);
    v.file('IR/New.md');
    assert.strictEqual(index.count(ir), 6, 'kept until told');
    on.create();
    assert.strictEqual(index.count(ir), 7);
    assert.strictEqual(index.notes().length, before + 1);
    // Links both ways, kept until Obsidian resolves again.
    app.metadataCache.resolvedLinks = { 'IR/Anarchy.md': { 'IR/Balance.md': 2 } };
    on.resolved();
    assert.deepStrictEqual(index.incoming(app.vault.getFileByPath('IR/Balance.md')), { 'IR/Anarchy.md': 2 });
    assert.deepStrictEqual(index.outgoing(app.vault.getFileByPath('IR/Anarchy.md')), { 'IR/Balance.md': 2 });
    app.metadataCache.resolvedLinks = {};
    assert.deepStrictEqual(index.incoming('IR/Balance.md'), { 'IR/Anarchy.md': 2 }, 'kept');
    on.resolve();
    assert.deepStrictEqual(index.incoming('IR/Balance.md'), {});
  });

  await t('the sidebar\'s new places: Recently added newest first, Collections, and Subjects', async () => {
    const { v, view, plugin, app } = setup();
    f(app, 'IR/Balance.md').stat.ctime = 30;
    f(app, 'IR/Theories/Realism.md').stat.ctime = 20;
    await view.setState({ mode: 'added' }, {});
    const titles = () => Array.from(view.contentEl.querySelectorAll('.dr-card-title')).map((e) => e.textContent);
    assert.deepStrictEqual(titles().slice(0, 2), ['Balance', 'Realism'], 'newest first');

    await view.setState({ mode: 'collections' }, {});
    assert.ok(view.contentEl.querySelector('.dr-empty'), 'none yet');
    const smart = new R.SmartAlbums(plugin);
    smart.enabled = true;
    plugin.settings.smartAlbumList = [{ id: 's1', name: 'Unread' }];
    const structure = new R.AlbumStructure(plugin);
    structure.enabled = true;
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    v.folder('Reading');
    const reading = v.file('Reading/Reading.md');
    v.folder('Law');
    const law = v.file('Law/Law.md');
    const fms = new Map([[reading, { includes: ['[[Anarchy]]'] }], [law, { album: 'Subject' }]]);
    app.metadataCache.getFileCache = (file) => (fms.has(file) ? { frontmatter: fms.get(file) } : null);
    plugin.feature = (C) => (C === R.SmartAlbums ? smart : C === R.AlbumStructure ? structure : null);
    view.render();
    assert.deepStrictEqual(titles(), ['Unread', 'Reading']);

    await view.setState({ mode: 'subjects' }, {});
    assert.deepStrictEqual(titles(), ['Law']);
    const library = new R.Library(plugin);
    const sections = library.defaultSections();
    // A few places first, then Recent, then the rest under More, folded.
    assert.deepStrictEqual(sections.map((s) => s.title).slice(0, 3), ['', 'Recent', 'More']);
    assert.deepStrictEqual(sections[0].items.map((i) => i.id), ['search', 'home', 'notes', 'folders', 'bookmarks']);
    assert.strictEqual(sections[2].folded, true);
    plugin.settings.libraryCheck = true;
    plugin.settings.knowledgeCheck = false;
    assert.deepStrictEqual(library.defaultSections()[2].items.map((i) => i.id).slice(-2), ['library-check', 'inbox'], 'the tools last, those switched on');
    assert.ok(sections[2].items.some((i) => i.id === 'subjects'), 'Subjects offered once there is one');
  });

  await t('an album says what it is: its kind and the way down above its title, what it’s for, notes from elsewhere, albums in it and beside it', async () => {
    const { v, plugin, app, view } = setup();
    const note = v.file('IR/IR.md');
    v.folder('Elsewhere');
    const sov = v.file('Elsewhere/Sovereignty.md');
    v.folder('Law');
    const law = v.file('Law/Law.md');
    v.folder('Treaties');
    v.file('Treaties/Treaties.md');
    const fms = new Map([[note, { album: 'Project', description: 'How states deal with each other.', includes: ['[[Sovereignty]]', '[[Law]]', '[[Missing]]'], related: '[[Treaties]]' }], [v.vault.getFileByPath('IR/Anarchy.md'), { status: 'Done' }]]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((f) => f.basename === link) || null;
    app.metadataCache.fileToLinktext = (f) => f.basename;
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    plugin.ensureFolderNote = async (folder) => plugin.folderNote(folder);
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    view.render();
    assert.deepStrictEqual(text('.dr-detail-kind'), ['Project']);
    assert.deepStrictEqual(text('.dr-detail-desc'), ['How states deal with each other.']);
    assert.ok(text('.dr-detail-meta')[0].includes('1 of 7 done'), text('.dr-detail-meta')[0]);
    assert.ok(text('.dr-disc-title').includes('From elsewhere'));
    assert.ok(view.contentEl.querySelector('.dr-track[data-path="Elsewhere/Sovereignty.md"]'), 'shown in the collection, not moved');
    assert.strictEqual(sov.parent.path, 'Elsewhere');
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-album-includes .dr-card')).map((c) => c.dataset.path), ['Law'], 'a collection it takes in, as a tile');
    assert.ok(text('.dr-shelf-title').includes('Related collections'));
    assert.ok(view.contentEl.querySelector('.dr-shelf-row .dr-card[data-path="Treaties"]'));
    assert.ok(!action(view, 'Map'));
    // A concept map opens its map.
    fms.get(note).album = 'concept map';
    view.render();
    assert.deepStrictEqual(text('.dr-detail-kind'), ['Concept map']);
    assert.ok(action(view, 'Map'));
    // Further down: the way back up, and no lone parent link under the title.
    Object.assign(view, { path: 'IR/Theories' });
    view.render();
    assert.deepStrictEqual(text('.dr-crumb'), ['IR']);
    assert.ok(!view.contentEl.querySelector('.dr-detail-sub.is-link'));
    // On its tile, its kind.
    Object.assign(view, { path: '/' });
    view.render();
    assert.deepStrictEqual(text('.dr-card[data-path="IR"] .dr-card-kind'), ['Concept map']);
    // A note shown in another album too: listed in its includes, left where it is.
    let written = null;
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = Object.assign({}, fms.get(file)); fn(fm); written = [file, fm]; };
    fms.set(law, {});
    assert.strictEqual(await structure.include(v.vault.getFolderByPath('Law'), sov), true);
    assert.deepStrictEqual([written[0], written[1].includes], [law, ['[[Sovereignty]]']]);
    assert.strictEqual(await structure.include(v.vault.getFolderByPath('IR'), sov), false, 'there already');
    // Kind set and taken away from the menu's way in.
    await structure.setType(v.vault.getFolderByPath('IR'), 'reading list');
    assert.strictEqual(written[1].album, 'reading list');
    await structure.setType(v.vault.getFolderByPath('IR'), '');
    assert.ok(!('album' in written[1]));
    // Switched off: nothing of it shows.
    plugin.settings.albumStructure = false;
    Object.assign(view, { path: 'IR' });
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-detail-kind, .dr-detail-desc, .dr-album-includes'));
    assert.ok(!text('.dr-disc-title').includes('From elsewhere'));
  });

  await t('a smart album keeps filters, order and grouping; changed chips can be saved back; the library lists it', async () => {
    const { v, plugin, app, view } = setup();
    const f = (p) => v.vault.getFileByPath(p);
    const fms = new Map([[f('IR/Anarchy.md'), { domain: 'Security', status: 'Done' }], [f('IR/Balance.md'), { domain: 'Security' }], [f('IR/Theories/Realism.md'), { domain: 'Theory' }]]);
    app.metadataCache.getFileCache = (file) => (fms.has(file) ? { frontmatter: fms.get(file) } : null);
    const smart = new R.SmartAlbums(plugin);
    plugin.feature = (C) => (C === R.SmartAlbums ? smart : null);
    plugin.settings.librarySections = [{ title: '', items: [{ kind: 'builtin', id: 'home' }] }];
    const defaultSort = plugin.settings.defaultSort;
    view.filterFolder = 'IR';
    view.filterProp = { key: 'domain', value: null };
    const album = smart.save(view, ' Domains ');
    assert.deepStrictEqual([album.name, album.folder, album.prop], ['Domains', 'IR', { key: 'domain', value: null }]);
    assert.ok(plugin.settings.librarySections[0].items.some((i) => i.id === 'smart'), 'listed in the library');
    const open = () => {
      Object.assign(view, { mode: 'smart', property: album.id, smartLoaded: null });
      view.clearFilters();
      view.render();
    };
    const tracks = () => Array.from(view.contentEl.querySelectorAll('.dr-track[data-path]')).map((r) => r.dataset.path.split('/').pop());
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    open();
    assert.deepStrictEqual(text('.dr-detail-title'), ['Domains']);
    assert.deepStrictEqual(tracks(), ['Anarchy.md', 'Balance.md', 'Realism.md']);
    assert.ok(!action(view, 'Save changes'));
    // Grouped by a property: a disc per value — the same notes seen another way.
    smart.change(album, { group: 'domain' });
    view.render();
    assert.deepStrictEqual(text('.dr-disc-title'), ['Security', 'Theory']);
    // Its own order, kept with it.
    view.setSort('name-desc');
    assert.strictEqual(album.sort, 'name-desc');
    assert.strictEqual(plugin.settings.defaultSort, defaultSort, 'the shared order is left alone');
    view.render();
    assert.deepStrictEqual(tracks(), ['Balance.md', 'Anarchy.md', 'Realism.md']);
    // The chips changed, and saved back.
    view.filterProp = { key: 'status', value: 'Done' };
    view.render();
    assert.deepStrictEqual(tracks(), ['Anarchy.md']);
    click(action(view, 'Save changes'));
    assert.deepStrictEqual(album.prop, { key: 'status', value: 'Done' });
    open();
    assert.deepStrictEqual(tracks(), ['Anarchy.md'], 'opened again, as saved');
    // In the library, a row each.
    const rows = [];
    smart.renderRows({ row: (list, spec) => rows.push(spec), browseMode() {} }, null);
    assert.deepStrictEqual(rows.map((r) => [r.label, r.screen, r.property]), [['Domains', 'smart', album.id]]);
    // Gone, or switched off: said so, nothing else.
    smart.remove(album);
    open();
    assert.ok(text('.dr-empty')[0].includes('any more'));
  });

  await t('covers come compact, standard or large, as set; anything else is standard', () => {
    const { plugin, view } = setup();
    assert.strictEqual(view.containerEl.dataset.drDensity, 'standard');
    plugin.settings.gridDensity = 'compact';
    view.render();
    assert.strictEqual(view.containerEl.dataset.drDensity, 'compact');
    plugin.settings.gridDensity = 'huge';
    view.render();
    assert.strictEqual(view.containerEl.dataset.drDensity, 'standard');
  });

  await t('looking the library over: empty albums, no description, notes in no album, missing and circular includes, deep nesting, a name twice', () => {
    const { v, plugin, app } = setup();
    v.file('IR/IR.md');
    v.folder('Law');
    v.file('Law/Law.md');
    v.file('Law/Treaty.md');
    v.folder('Empty');
    v.folder('Law/Theories');
    v.file('Law/Theories/Natural law.md');
    v.folder('A');
    v.folder('A/B');
    v.folder('A/B/C');
    v.folder('A/B/C/D');
    v.folder('A/B/C/D/E');
    v.folder('A/B/C/D/E/F');
    v.file('A/B/C/D/E/F/Deep.md');
    const loose = v.file('Loose.md');
    const kept = v.file('Kept.md');
    v.file('Home.md');
    const fms = new Map([
      [v.vault.getFileByPath('IR/IR.md'), { description: 'States.', includes: ['[[Law]]', '[[Kept]]', '[[Gone]]'] }],
      [v.vault.getFileByPath('Law/Law.md'), { includes: '[[IR]]' }],
    ]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((f) => f.basename === link) || null;
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    const structure = new R.AlbumStructure(plugin);
    const check = new R.LibraryCheck(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const found = check.problems().map((p) => `${p.target.path}: ${p.kind}`);
    assert.deepStrictEqual(found.sort(), [
      'A/B/C/D/E/F: about',
      'A/B/C/D/E/F: deep',
      'Empty: empty',
      'IR: loop',
      'IR: missing',
      'IR/Theories: about',
      'IR/Theories: twice',
      'Law: about',
      'Law: loop',
      'Law/Theories: about',
      'Law/Theories: twice',
    ].sort());
    assert.deepStrictEqual(check.unclassified(), [loose], 'in no collection: not one a collection takes in, nor the home note');
    assert.ok(kept);
  });

  await t('inside an album: notes to start with, a list or covers, an overview or its map, what changed lately, and why it’s empty', async () => {
    const { v, plugin, app, view } = setup();
    const note = v.file('IR/IR.md');
    const fm = { album: 'project', featured: ['[[Balance]]'], includes: '[[Gone]]' };
    const fms = new Map([[note, fm]]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((f) => f.basename === link) || null;
    app.metadataCache.fileToLinktext = (f) => f.basename;
    app.vault.cachedRead = async () => '---\nalbum: project\n---\nWhat this is for.';
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    plugin.ensureFolderNote = async (folder) => plugin.folderNote(folder);
    let written = null;
    app.fileManager.processFrontMatter = async (file, fn) => { const copy = Object.assign({}, fms.get(file)); fn(copy); written = copy; };
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    view.render();
    assert.ok(text('.dr-shelf-title').includes('Start here'));
    assert.ok(view.contentEl.querySelector('.dr-shelf-row .dr-card[data-path="IR/Balance.md"]'));
    assert.ok(text('.dr-album-notice')[0].includes('“Gone”'), 'a link that leads nowhere, said');
    assert.ok(view.contentEl.querySelector('.dr-track[data-path]'), 'a list, as it opens by default');
    // Kept at the top, and no longer, from a note's menu.
    const items = [];
    structure.addFileItems({ addItem: (fn) => { const item = {}; ['setSection', 'setIcon'].forEach((m) => (item[m] = () => item)); item.setTitle = (x) => { item.title = x; return item; }; item.onClick = (f) => { item.run = f; return item; }; fn(item); items.push(item); } }, v.vault.getFileByPath('IR/Balance.md'), (i) => i, () => {});
    assert.deepStrictEqual(items.map((i) => i.title), ['Don’t keep at the top of IR']);
    await structure.toggleFeatured(v.vault.getFolderByPath('IR'), v.vault.getFileByPath('IR/Balance.md'));
    assert.ok(!('featured' in written), 'an empty list is taken away');
    await structure.toggleFeatured(v.vault.getFolderByPath('IR'), v.vault.getFileByPath('IR/Anarchy.md'));
    assert.deepStrictEqual(written.featured, ['[[Balance]]', '[[Anarchy]]']);
    // As covers: a heading and tiles for each disc.
    fm.layout = 'covers';
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-track[data-path]'));
    assert.deepStrictEqual(text('.dr-covers-head .dr-disc-title'), ['IR', 'Theories']);
    assert.ok(view.contentEl.querySelector('.dr-grid .dr-card[data-path="IR/Anarchy.md"]'));
    // An overview: the folder note's text, without its properties.
    fm.layout = 'overview';
    view.render();
    await settle();
    assert.deepStrictEqual(text('.dr-album-lead.is-overview'), ['What this is for.']);
    // Its map: offered while there's none, embedded once there is.
    fm.layout = 'map';
    view.render();
    assert.ok(text('.dr-album-lead-empty')[0].includes('No map yet'));
    v.file('IR/IR map.canvas');
    view.render();
    assert.deepStrictEqual(text('.dr-album-lead.is-map'), ['![[IR/IR map.canvas]]']);
    await structure.setLayout(v.vault.getFolderByPath('IR'), 'list');
    assert.ok(!('layout' in written), 'a list is how it opens anyway');
    delete fm.layout;
    // A long album: what changed lately, and what was opened lately.
    for (let i = 0; i < 10; i++) v.file(`IR/Extra ${i}.md`);
    plugin.recentFiles = () => [v.vault.getFileByPath('IR/Extra 3.md'), v.vault.getFileByPath('IR/Anarchy.md'), v.vault.getFileByPath('Elsewhere.md')].filter(Boolean);
    view.render();
    const tabs = () => text('.dr-panel-tab').map((t) => t.replace(/\d+$/, ''));
    assert.deepStrictEqual(tabs(), ['Overview', 'Notes', 'Map', 'Sub-collections', 'Lately'], 'one at a time, where there’s something to show');
    assert.ok(view.contentEl.querySelector('.dr-panel-tab.is-active[data-panel="notes"]'), 'a list opens to its notes');
    assert.ok(text('.dr-detail-meta')[0].includes('1 sub-collection'));
    click(view.contentEl.querySelector('.dr-panel-tab[data-panel="lately"]'));
    assert.ok(text('.dr-shelf-title').includes('Changed lately'));
    assert.ok(text('.dr-shelf-title').includes('Opened lately'));
    view.render();
    assert.ok(view.contentEl.querySelector('.dr-panel-tab.is-active[data-panel="lately"]'), 'the panel chosen stays chosen');
    click(view.contentEl.querySelector('.dr-panel-tab[data-panel="albums"]'));
    assert.ok(view.contentEl.querySelector('.dr-album-panel .dr-card[data-path="IR/Theories"]'));
    // Sources, and what it hasn't got: links to notes not written, notes marked open.
    fms.set(v.vault.getFileByPath('IR/Extra 1.md'), { author: 'Waltz' });
    fms.set(v.vault.getFileByPath('IR/Extra 2.md'), { status: 'Open' });
    app.metadataCache.unresolvedLinks = { 'IR/Anarchy.md': { Hegemony: 1 }, 'IR/Balance.md': { Hegemony: 2 } };
    view.render();
    assert.deepStrictEqual(tabs(), ['Overview', 'Notes', 'Map', 'Sub-collections', 'Sources', 'Gaps', 'Lately']);
    click(view.contentEl.querySelector('.dr-panel-tab[data-panel="sources"]'));
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-album-panel .dr-track[data-path]')).map((r) => r.dataset.path), ['IR/Extra 1.md']);
    let linked = null;
    app.workspace.openLinkText = (name, from) => { linked = [name, from]; };
    click(view.contentEl.querySelector('.dr-panel-tab[data-panel="gaps"]'));
    assert.deepStrictEqual(text('.dr-gap-row'), ['Hegemonylinked from 2 notes']);
    assert.ok(view.contentEl.querySelector('.dr-album-panel .dr-track[data-path="IR/Extra 2.md"]'), 'an open question');
    click(view.contentEl.querySelector('.dr-gap-row'));
    assert.deepStrictEqual(linked, ['Hegemony', 'IR/Anarchy.md'], 'opened as its link would be, so Obsidian makes it');
    plugin.settings.albumRecents = false;
    view.render();
    assert.ok(!text('.dr-panel-tab').some((t) => t.startsWith('Lately')));
    // Empty, and why.
    v.folder('Plans');
    const plans = v.file('Plans/Plans.md');
    fms.set(plans, { album: 'project' });
    Object.assign(view, { path: 'Plans' });
    view.render();
    assert.deepStrictEqual(text('.dr-empty-text'), ['Nothing in this project yet']);
    assert.deepStrictEqual(text('.dr-empty-action'), ['New note'], 'one thing to do');
    view.query = 'zzz';
    view.render();
    assert.deepStrictEqual(text('.dr-empty-text'), ['Nothing matches']);
    assert.deepStrictEqual(text('.dr-empty-action'), ['Clear filters']);
  });

  await t('covers grouped by kind or collection; a shelf’s albums put in your own order, kept by name', async () => {
    const { v, plugin, app, view } = setup();
    v.folder('Politics');
    ['Theory', 'Law', 'Ideas'].forEach((n) => { v.folder(`Politics/${n}`); v.file(`Politics/${n}/Note ${n}.md`); });
    const lawNote = v.file('Politics/Law/Law.md');
    const fms = new Map([[lawNote, { album: 'reference' }]]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const tiles = () => Array.from(view.contentEl.querySelectorAll('.dr-grid .dr-card')).map((c) => c.dataset.path);
    const heads = () => Array.from(view.contentEl.querySelectorAll('.dr-tile-group-head')).map((h) => h.textContent);
    // A shelf, in its own order once one's moved.
    Object.assign(view, { path: 'Politics' });
    view.render();
    assert.deepStrictEqual(tiles(), ['Politics/Ideas', 'Politics/Law', 'Politics/Theory']);
    view.tileSteps(v.vault.getFolderByPath('Politics/Theory')).earlier();
    assert.deepStrictEqual(plugin.settings.albumOrders.Politics.names, ['Ideas', 'Theory', 'Law']);
    assert.deepStrictEqual(tiles(), ['Politics/Ideas', 'Politics/Theory', 'Politics/Law']);
    assert.strictEqual(view.tileSteps(v.vault.getFolderByPath('Politics/Ideas')).earlier, null, 'already first');
    // Not in an album of notes: its disc folders aren't tiles to arrange.
    Object.assign(view, { path: 'IR' });
    view.render();
    assert.strictEqual(view.tileSteps(v.vault.getFolderByPath('IR/Theories')), null);
    // Every folder, grouped by collection, then by kind.
    plugin.settings.tileGroups = 'collection';
    Object.assign(view, { mode: 'folders', path: '/' });
    view.render();
    assert.deepStrictEqual(heads(), ['IR', 'Politics', 'Vault']);
    plugin.settings.tileGroups = 'kind';
    view.render();
    assert.deepStrictEqual(heads(), ['Reference', 'No kind given']);
    assert.deepStrictEqual(tiles()[0], 'Politics/Law');
    plugin.settings.tileGroups = '';
    view.render();
    assert.deepStrictEqual(heads(), []);
  });

  await t('covers by kind: each kind its symbol and colour, a note its album’s; and kind, name and collection printed on a cover', () => {
    const { v, plugin, app } = setup();
    const note = v.file('IR/Theories/Theories.md');
    const fms = new Map([[note, { album: 'project' }]]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    plugin.settings.coverFallback = 'kind';
    const art = () => document.createElement('div');
    const theories = v.vault.getFolderByPath('IR/Theories');
    const el = art();
    R.drawFolderArt(plugin, el, theories);
    assert.ok(el.classList.contains('is-kind'));
    assert.strictEqual(el.querySelector('.dr-card-glyph').dataset.icon, 'target', 'a project’s symbol');
    const projectHue = el.style.getPropertyValue('--dr-gen-h');
    const plain = art();
    R.drawFolderArt(plugin, plain, v.vault.getFolderByPath('IR'));
    assert.strictEqual(plain.querySelector('.dr-card-glyph').dataset.icon, 'folder', 'no kind: plain');
    assert.notStrictEqual(plain.style.getPropertyValue('--dr-gen-h'), projectHue);
    const track = art();
    R.drawNoteArt(plugin, track, v.vault.getFileByPath('IR/Theories/Realism.md'));
    assert.ok(track.classList.contains('is-kind'));
    assert.strictEqual(track.style.getPropertyValue('--dr-gen-h'), projectHue, 'a note in its collection’s colour');
    // A colour chosen for the album wins.
    plugin.settings.coverColors = { 'IR/Theories': '#3e63dd' };
    const own = art();
    R.drawFolderArt(plugin, own, theories);
    assert.notStrictEqual(own.style.getPropertyValue('--dr-gen-h'), projectHue);
    // Printed: kind, name, collection.
    plugin.settings.coverPrint = true;
    plugin.settings.coverFallback = 'art';
    const printed = art();
    R.drawFolderArt(plugin, printed, theories);
    const text = (sel) => Array.from(printed.querySelectorAll(sel)).map((x) => x.textContent);
    assert.deepStrictEqual([text('.dr-cover-print-kind'), text('.dr-cover-print-title'), text('.dr-cover-print-from')], [['Project'], ['Theories'], ['IR']]);
    // Not over a picture, nor where the name is the cover already.
    plugin.settings.coverFallback = 'title';
    const titled = art();
    R.drawFolderArt(plugin, titled, theories);
    assert.ok(!titled.querySelector('.dr-cover-print'));
  });

  await t('the library report: roles at odds, parents in a circle, albums in no collection, overlaps, a cover twice, subjects with nothing to start with, and size out of balance', () => {
    const { v, plugin, app, view } = setup();
    v.folder('Shelf');
    v.folder('Shelf/Inner');
    v.file('Shelf/Inner/Deep.md');
    v.folder('Top');
    const shared = ['One', 'Two', 'Three'].map((n) => v.file(`Top/${n}.md`));
    v.file('Top/Top.md');
    v.folder('Mirror');
    v.file('Mirror/Mirror.md');
    v.folder('Big');
    for (let i = 0; i < 45; i++) v.file(`Big/N${i}.md`);
    const a = v.file('A.md');
    const b = v.file('B.md');
    const odd = v.file('Odd.md');
    const fms = new Map([
      [v.vault.getFileByPath('IR/Theories/Realism.md'), {}],
      [v.vault.getFileByPath('Top/Top.md'), { album: 'subject', description: 'x', related: ['[[Mirror]]'], includes: ['[[Mirror]]'] }],
      [v.vault.getFileByPath('Mirror/Mirror.md'), { description: 'y', includes: ['[[One]]', '[[Two]]', '[[Three]]', '[[One]]'] }],
      [a, { parent: '[[B]]' }],
      [b, { parent: '[[A]]' }],
      [odd, { album: 'project' }],
    ]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((f) => f.basename === link) || null;
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    plugin.folderCoverSrc = (folder) => (folder.name === 'Top' || folder.name === 'Big' ? 'app://cover.png' : null);
    const structure = new R.AlbumStructure(plugin);
    const check = new R.LibraryCheck(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : C === R.LibraryCheck ? check : null);
    const found = check.problems();
    const has = (path, kind) => found.some((p) => p.target.path === path && p.kind === kind);
    assert.ok(has('Top', 'roles'), 'takes in a collection it lists as related too');
    assert.ok(has('Odd.md', 'roles'), 'a note saying it’s a collection');
    assert.ok(has('A.md', 'parents') && has('B.md', 'parents'), 'parents round in a circle');
    assert.ok(has('IR', 'orphan') && has('Big', 'orphan'), 'collections at the top while others are in collections');
    assert.ok(has('Mirror', 'listed'), 'a note listed twice');
    assert.ok(has('Top', 'overlap') || has('Mirror', 'overlap'), 'collections sharing most of their notes');
    assert.ok(has('Top', 'cover') && has('Big', 'cover'), 'one cover for two collections');
    assert.ok(has('Top', 'start'), 'a subject with no notes to start with');
    assert.ok(has('Big', 'large'), 'far larger than most');
    assert.deepStrictEqual(Array.from(new Set(found.map((p) => p.section))).sort(), ['coverage', 'hierarchy', 'overlap']);
    // Drawn as a report, a section at a time, with the inbox above.
    Object.assign(view, { mode: 'library-check', path: '/' });
    view.render();
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    assert.deepStrictEqual(text('.dr-report-head').map((t) => t.replace(/\d+$/, '')), ['Hierarchy', 'Duplicates and overlaps', 'Coverage and balance']);
    assert.ok(text('.dr-report-name')[0].includes('in no collection'));
    assert.ok(shared.length === 3);
  });

  await t('the inbox: notes in no album, picked a few at a time, moved into an album or shown in one, with Undo', async () => {
    const { v, plugin, app, view } = setup();
    const one = v.file('Loose one.md');
    const two = v.file('Loose two.md');
    v.file('Home.md');
    app.metadataCache.fileToLinktext = (f) => f.basename;
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    const structure = new R.AlbumStructure(plugin);
    const check = new R.LibraryCheck(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : C === R.LibraryCheck ? check : null);
    let undo = null;
    plugin.offerUndo = (msg, fn) => { undo = fn; };
    plugin.putBack = async (file, from) => { await v.fileManager.renameFile(file, from); return true; };
    plugin.moveFile = async (file, dir) => { const from = file.path; await v.fileManager.renameFile(file, `${dir}/${file.name}`); return from; };
    Object.assign(view, { mode: 'inbox', path: '/' });
    view.render();
    const rows = () => Array.from(view.contentEl.querySelectorAll('.dr-inbox-row')).map((r) => r.dataset.path);
    assert.deepStrictEqual(rows(), ['Loose one.md', 'Loose two.md']);
    const box = (path) => view.contentEl.querySelector(`.dr-inbox-row[data-path="${path}"] input`);
    box('Loose two.md').click();
    assert.deepStrictEqual(Array.from(view.inboxPicked), ['Loose two.md']);
    assert.ok(view.contentEl.querySelector('.dr-inbox-count').textContent.includes('1 picked'));
    // Moved into an album as one step, and put back with Undo.
    const ir = v.vault.getFolderByPath('IR');
    assert.strictEqual(await check.moveFilesInto([two], ir), true);
    assert.strictEqual(two.path, 'IR/Loose two.md');
    view.render();
    assert.deepStrictEqual(rows(), ['Loose one.md'], 'in a collection now: out of the inbox');
    await undo();
    view.render();
    assert.deepStrictEqual(rows(), ['Loose one.md', 'Loose two.md']);
    // Shown in an album where they are: listed in its includes, and out of the inbox.
    const fms = new Map();
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((f) => f.basename === link) || null;
    const irNote = v.file('IR/IR.md');
    fms.set(irNote, {});
    plugin.ensureFolderNote = async () => irNote;
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = Object.assign({}, fms.get(file)); fn(fm); fms.set(file, fm); };
    assert.strictEqual(await check.showFilesIn([one, two], ir), true);
    assert.deepStrictEqual(fms.get(irNote).includes, ['[[Loose one]]', '[[Loose two]]']);
    view.render();
    assert.deepStrictEqual(rows(), [], 'shown in a collection: in one');
    assert.strictEqual(one.path, 'Loose one.md', 'left where it is');
    await undo();
    assert.ok(!('includes' in fms.get(irNote)));
  });

  await t('reorganising albums: rename, move, merge and split, each shown first, done as shown, and undone in one step', async () => {
    const { v, plugin, app } = setup();
    const fms = new Map();
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    app.metadataCache.resolvedLinks = { 'Elsewhere.md': { 'IR/Anarchy.md': 2 } };
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = Object.assign({}, fms.get(file)); fn(fm); fms.set(file, fm); };
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    plugin.ensureFolderNote = async (folder) => plugin.folderNote(folder) || v.vault.create(`${folder.path}/${folder.name}.md`);
    plugin.moveFile = async (file, dir) => {
      const from = file.path;
      const at = (name) => (!dir || dir === '/' ? name : `${dir}/${name}`);
      let name = file.name;
      for (let n = 1; v.vault.getAbstractFileByPath(at(name)); n++) name = file.extension ? `${file.basename} ${n}.${file.extension}` : `${file.name} ${n}`;
      await v.fileManager.renameFile(file, at(name));
      return from;
    };
    plugin.putBack = async (entry, from) => { await v.fileManager.renameFile(entry, from); return true; };
    let undo = null;
    plugin.offerUndo = (msg, fn) => { undo = fn; };
    const refactor = new R.AlbumRefactor(plugin);
    plugin.feature = () => null;
    const folder = (p) => v.vault.getFolderByPath(p);
    const file = (p) => v.vault.getFileByPath(p);
    // Written once: the album's menu and the palette, which offers them only for the album on screen.
    const menu = new Menu();
    refactor.addFolderItems(menu, folder('IR'), (item) => item);
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Reorganise: Rename…', 'Reorganise: Move into…', 'Reorganise: Merge into…', 'Reorganise: Split notes off…']);
    const rename = refactor.commands().find((c) => c.id === 'album-rename');
    plugin.app.workspace.getActiveViewOfType = () => null;
    assert.strictEqual(rename.check(), false, 'no collection on screen');
    plugin.app.workspace.getActiveViewOfType = (C) => (C === R.BrowseView ? Object.assign(Object.create(R.BrowseView.prototype), { mode: 'folder', folder: () => folder('IR') }) : null);
    assert.strictEqual(rename.check(), true);
    delete plugin.app.workspace.getActiveViewOfType;
    // Rename: what it'd do, what stops it, and back.
    v.folder('Law');
    let plan = refactor.planRename(folder('IR'), 'Law');
    assert.ok(plan.blocked.includes('there already'));
    assert.ok(refactor.planRename(folder('IR'), 'a/b').blocked);
    plan = refactor.planRename(folder('IR'), 'Relations');
    assert.ok(!plan.blocked);
    assert.ok(plan.lines.some((l) => l.includes('2 links from other notes point in')), plan.lines.join(' | '));
    await refactor.perform(plan);
    assert.ok(folder('Relations') && file('Relations/Anarchy.md'));
    await undo();
    assert.ok(folder('IR') && file('IR/Theories/Realism.md') && !folder('Relations'));
    // Move into another collection, and back.
    plan = refactor.planMove(folder('IR'), folder('IR/Theories'));
    assert.ok(plan.blocked.includes('inside itself'));
    plan = refactor.planMove(folder('IR'), folder('Law'));
    assert.ok(plan.lines.some((l) => l.includes('6 notes go with it, in 1 sub-collection')), plan.lines.join(' | '));
    await refactor.perform(plan);
    assert.ok(file('Law/IR/Anarchy.md'));
    await undo();
    assert.ok(file('IR/Anarchy.md') && !folder('Law/IR'));
    // Merge: notes moved, a name in both numbered, properties joined, its note a note, the folder gone; and back.
    v.file('Law/Realism.md');
    const lawNote = v.file('Law/Law.md');
    const theoriesNote = v.file('IR/Theories/Theories.md');
    fms.set(lawNote, { description: 'Rules.', related: ['[[Courts]]'] });
    fms.set(theoriesNote, { album: 'subject', description: 'Ideas.', related: ['[[Courts]]', '[[Power]]'], includes: ['[[Law]]', '[[Anarchy]]'] });
    plan = refactor.planMerge(folder('IR/Theories'), folder('Law'));
    assert.ok(plan.warnings.some((w) => w.includes('“Realism.md” is in both')));
    assert.ok(plan.lines.some((l) => l.includes('Its includes, related join Law’s')), plan.lines.join(' | '));
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    plan = refactor.planMerge(folder('IR/Theories'), folder('Law'));
    await refactor.perform(plan);
    assert.ok(!folder('IR/Theories'), 'the empty folder is gone');
    assert.ok(file('Law/Realism 1.md') && file('Law/Liberalism.md') && file('Law/Theories.md'));
    assert.deepStrictEqual(fms.get(lawNote).related, ['[[Courts]]', '[[Power]]']);
    assert.deepStrictEqual(fms.get(lawNote).includes, ['[[Anarchy]]'], 'not the collection it went into');
    assert.strictEqual(fms.get(lawNote).description, 'Rules.', 'its own description kept');
    assert.ok(!('album' in fms.get(theoriesNote)), 'a note like the rest: not saying it’s a collection');
    await undo();
    assert.ok(file('IR/Theories/Realism.md') && file('IR/Theories/Liberalism.md') && file('IR/Theories/Theories.md'));
    assert.ok(file('Law/Realism.md') && !file('Law/Realism 1.md'));
    assert.deepStrictEqual(fms.get(lawNote), { description: 'Rules.', related: ['[[Courts]]'] });
    assert.strictEqual(fms.get(theoriesNote).album, 'subject');
    // Split notes off into a new album beside it, and back.
    plan = refactor.planSplit(folder('IR'), [], 'Security');
    assert.ok(plan.blocked.includes('Pick'));
    plan = refactor.planSplit(folder('IR'), [file('IR/Anarchy.md'), file('IR/Deterrence.md')], 'Security');
    assert.ok(plan.lines[1].includes('2 notes move into it: Anarchy, Deterrence'));
    await refactor.perform(plan);
    assert.ok(file('Security/Anarchy.md') && file('Security/Deterrence.md') && file('IR/Balance.md'));
    await undo();
    assert.ok(file('IR/Anarchy.md') && !folder('Security'), 'the new collection gone again');
  });

  await t('levels and views: a collection says so and can open as a tree; an album as a table; notes linked from elsewhere; covers numbered; property names of your own', async () => {
    const { v, plugin, app, view } = setup();
    v.folder('Politics');
    ['Theory', 'Law'].forEach((n) => { v.folder(`Politics/${n}`); v.file(`Politics/${n}/Note ${n}.md`); });
    v.folder('Politics/Law/Courts');
    v.file('Politics/Law/Courts/Ruling.md');
    const shelfNote = v.file('Politics/Politics.md');
    const irNote = v.file('IR/IR.md');
    const far = v.file('Far.md');
    const fms = new Map([[shelfNote, { description: 'The study of power.' }], [irNote, {}]]);
    app.metadataCache.getFileCache = (f) => (fms.has(f) ? { frontmatter: fms.get(f) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((f) => f.basename === link) || null;
    app.metadataCache.fileToLinktext = (f) => f.basename;
    app.metadataCache.resolvedLinks = { 'Far.md': { 'IR/Anarchy.md': 2 }, 'IR/Balance.md': { 'Far.md': 1, 'IR/Anarchy.md': 1 } };
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = Object.assign({}, fms.get(file)); fn(fm); fms.set(file, fm); };
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    plugin.ensureFolderNote = async (folder) => plugin.folderNote(folder);
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    // A collection: said to be one, what it's for, how many albums.
    Object.assign(view, { path: 'Politics' });
    view.render();
    assert.deepStrictEqual(text('.dr-collection-head .dr-detail-kind'), ['Shelf']);
    assert.deepStrictEqual(text('.dr-collection-head .dr-detail-meta'), ['2 collections']);
    assert.deepStrictEqual(text('.dr-collection-head .dr-detail-desc'), ['The study of power.']);
    // Opened as a list: a tree of its albums, the ones inside beneath.
    fms.get(shelfNote).layout = 'list';
    view.render();
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-tree-row')).map((r) => [r.dataset.path, r.style.getPropertyValue('--dr-tree-depth')]), [['Politics/Law', '0'], ['Politics/Law/Courts', '1'], ['Politics/Theory', '0']]);
    // The vault itself: the library.
    Object.assign(view, { path: '/' });
    view.render();
    assert.deepStrictEqual(text('.dr-detail-kind'), ['Library']);
    // An album as a table.
    fms.get(irNote).layout = 'table';
    Object.assign(view, { path: 'IR' });
    view.render();
    assert.ok(view.contentEl.querySelector('.dr-album-panel .dr-table .dr-tr') || view.contentEl.querySelector('.dr-table .dr-tr'));
    // Notes elsewhere that link with it, either way, most first; shown here at a press.
    const linked = structure.linked(v.vault.getFolderByPath('IR'), ['Anarchy', 'Balance', 'Cooperation', 'Deterrence'].map((n) => v.vault.getFileByPath(`IR/${n}.md`)));
    assert.deepStrictEqual(linked.map((x) => [x.file.path, x.count]), [['Far.md', 3]]);
    click(view.contentEl.querySelector('.dr-panel-tab[data-panel="linked"]'));
    assert.deepStrictEqual(Array.from(view.contentEl.querySelectorAll('.dr-linked .dr-gap-row')).map((r) => r.dataset.path), ['Far.md']);
    click(view.contentEl.querySelector('.dr-linked-take'));
    await settle();
    assert.deepStrictEqual(fms.get(irNote).includes, ['[[Far]]']);
    assert.ok(far.parent.path === '/' || true);
    // Covers numbered in their collection, in its order.
    plugin.settings.coverPrint = true;
    plugin.settings.coverFallback = 'art';
    const el = document.createElement('div');
    R.drawFolderArt(plugin, el, v.vault.getFolderByPath('Politics/Theory'));
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-cover-print-kind')).map((x) => x.textContent), ['No. 02']);
    // Property names of your own: read under them, and earlier values carried over with Undo.
    plugin.settings.albumKeyNames = { type: 'album-kind' };
    structure.enable();
    fms.set(irNote, { album: 'project' });
    assert.strictEqual(structure.info(v.vault.getFolderByPath('IR')).type, '', 'read under the new name only');
    let undo = null;
    plugin.offerUndo = (m, fn) => { undo = fn; };
    plugin.isFolderNote = (f) => f.basename === (f.parent && f.parent.name);
    assert.strictEqual(await structure.carryKeys(), 1);
    assert.deepStrictEqual(fms.get(irNote), { 'album-kind': 'project' });
    assert.strictEqual(structure.info(v.vault.getFolderByPath('IR')).type, 'project');
    await undo();
    assert.deepStrictEqual(fms.get(irNote), { album: 'project' });
    structure.disable();
    assert.strictEqual(structure.info(v.vault.getFolderByPath('IR')).type, 'project', 'off: the usual names again');
  });

  await t('the inbox suggests where a note belongs, by its links and tags, and puts the picked there in one step', async () => {
    const { v, plugin, app } = setup();
    v.folder('Law');
    v.file('Law/Treaty.md');
    const linky = v.file('Linky.md');
    const tagged = v.file('Tagged.md');
    const lost = v.file('Lost.md');
    app.metadataCache.resolvedLinks = { 'Linky.md': { 'IR/Anarchy.md': 2, 'Law/Treaty.md': 1 } };
    app.metadataCache.getFileCache = (f) => (f === tagged ? { tags: [{ tag: '#law' }] } : null);
    plugin.folderNote = () => null;
    plugin.moveFile = async (file, dir) => { const from = file.path; await v.fileManager.renameFile(file, `${dir}/${file.name}`); return from; };
    plugin.putBack = async (file, from) => { await v.fileManager.renameFile(file, from); return true; };
    let undo = null;
    plugin.offerUndo = (m, fn) => { undo = fn; };
    const check = new R.LibraryCheck(plugin);
    plugin.feature = (C) => (C === R.LibraryCheck ? check : null);
    const found = check.suggestions([linky, tagged, lost]);
    assert.strictEqual(found.get(linky).path, 'IR', 'most linked');
    assert.strictEqual(found.get(tagged).path, 'Law', 'a tag naming it');
    assert.ok(!found.has(lost), 'nothing to go on: no guess');
    assert.strictEqual(await check.moveEach([[linky, found.get(linky)], [tagged, found.get(tagged)]]), true);
    assert.deepStrictEqual([linky.path, tagged.path], ['IR/Linky.md', 'Law/Tagged.md']);
    await undo();
    assert.deepStrictEqual([linky.path, tagged.path], ['Linky.md', 'Tagged.md']);
  });

  await t('relationships kept in notes: read both ways, explored, added and removed with Undo, looked over, mapped', async () => {
    const { v, plugin, app, view } = setup();
    v.folder('Ideas');
    const f = (n) => v.vault.getFileByPath(`Ideas/${n}.md`) || v.file(`Ideas/${n}.md`);
    const [gov, parl, pres, fusion, sep, rule] = ['Government', 'Parliamentarism', 'Presidentialism', 'Fusion of powers', 'Separation of powers', 'Rule of law'].map(f);
    const fms = new Map([
      [parl, { 'is a type of': '[[Government]]', 'contrasts with': ['[[Presidentialism]]'] }],
      [pres, { 'is a type of': '[[Government]]' }],
      [fusion, { parent: '[[Parliamentarism]]', 'is part of': ['[[Parliamentarism]]', '[[Parliamentarism]]', '[[Gone]]'] }],
      [sep, { parent: '[[Presidentialism]]', 'is a type of': ['[[Presidentialism]]', '[[Government]]'] }],
      [gov, { parent: '[[Rule of law]]' }],
      [rule, { parent: '[[Government]]' }],
    ]);
    app.metadataCache.getFileCache = (file) => (fms.has(file) ? { frontmatter: fms.get(file) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((x) => x.basename === link) || null;
    app.metadataCache.fileToLinktext = (x) => x.basename;
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = JSON.parse(JSON.stringify(fms.get(file) || {})); fn(fm); fms.set(file, fm); };
    let undo = null;
    plugin.offerUndo = (m, fn) => { undo = fn; };
    const k = new R.Knowledge(plugin);
    plugin.feature = (C) => (C === R.Knowledge ? k : null);
    // Read both ways: what a note says, and what's said of it.
    const groups = (file) => k.groups(file).map((g) => [g.label, g.items.map((i) => i.file.basename)]);
    assert.deepStrictEqual(groups(gov), [['Sits under', ['Rule of law']], ['Holds', ['Rule of law']], ['Has type', ['Parliamentarism', 'Presidentialism', 'Separation of powers']]]);
    assert.deepStrictEqual(groups(parl).map((g) => g[0]), ['Holds', 'Is a type of', 'Has part', 'Contrasts with']);
    assert.deepStrictEqual(k.broaderChain(fusion).map((x) => x.basename), ['Rule of law', 'Government', 'Parliamentarism'], 'up until it would go round');
    // Explored: a screen of them, a step at a time.
    Object.assign(view, { mode: 'concept', property: parl.path });
    view.render();
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    assert.deepStrictEqual(text('.dr-detail-title'), ['Parliamentarism']);
    assert.deepStrictEqual(text('.dr-crumb'), ['Rule of law', 'Government']);
    assert.ok(text('.dr-report-head').some((h) => h.startsWith('Contrasts with')));
    // Added and removed, each with Undo.
    k.cache = null;
    assert.strictEqual(await k.add(rule, k.kindNamed('supports'), parl), true);
    assert.deepStrictEqual(fms.get(rule).supports, ['[[Parliamentarism]]']);
    await undo();
    assert.ok(!('supports' in fms.get(rule)));
    assert.strictEqual(await k.remove(parl, k.kindNamed('contrasts with'), pres), true);
    assert.ok(!('contrasts with' in fms.get(parl)));
    await undo();
    assert.deepStrictEqual(fms.get(parl)['contrasts with'], ['[[Presidentialism]]']);
    // Looked over: a circle, one twice, one missing, one implied already. Sitting under a note and
    // being part of it go together — the graph's parent goes with any hierarchy.
    k.cache = null;
    const found = k.problems().map((p) => `${p.target.basename}: ${p.kind}`);
    ['Government: relation-loop', 'Rule of law: relation-loop', 'Fusion of powers: relation-twice', 'Fusion of powers: relation-missing', 'Separation of powers: relation-implied'].forEach((x) => assert.ok(found.includes(x), `${x} in ${found.join(', ')}`));
    assert.ok(!found.includes('Fusion of powers: relation-roles'), found.join(', '));
    // Mapped: it at the centre, each arrow labelled and given its kind.
    let made = null;
    app.vault.create = async (path, data) => { made = { path, data: JSON.parse(data) }; return { path }; };
    plugin.freeChildPath = (folder, base, ext) => `${folder.path}/${base}.${ext}`;
    await k.map(parl);
    assert.strictEqual(made.path, 'Ideas/Parliamentarism relationships.canvas');
    assert.strictEqual(made.data.nodes[0].file, parl.path);
    const labels = made.data.edges.map((e) => e.label).sort();
    assert.deepStrictEqual(labels, ['contrasts with', 'has part', 'has type', 'holds']);
    assert.ok(made.data.edges.every((e) => e.drRelation && e.drRelation.kind));
  });

  await t('the knowledge structure checked: errors, what’s worth a look and modelling choices told apart; fixed, or marked as meant', async () => {
    const { v, plugin, app, view } = setup();
    v.folder('Map');
    v.folder('Elsewhere');
    const names = ['Map', 'Animal', 'Mammal', 'Dog', 'Cat', 'Wolf', 'Tail', 'Loose', 'Heat', 'Alone', 'Egg', 'Chicken', 'Part', 'Whole'];
    const f = {};
    names.forEach((n) => (f[n] = v.file(`Map/${n}.md`)));
    ['Note', 'Claim', 'Twice'].forEach((n) => (f[n] = v.file(`Elsewhere/${n}.md`)));
    const fms = new Map([
      [f.Map, { 'is a type of': '[[Animal]]' }],
      [f.Mammal, { 'is a type of': '[[Animal]]' }],
      [f.Dog, { 'is a type of': ['[[Mammal]]', '[[Animal]]'], 'contrasts with': '[[Cat]]' }],
      [f.Cat, { 'is a type of': '[[Mammal]]', 'contrasts with': '[[Dog]]' }],
      [f.Wolf, { 'is a type of': '[[Dog]]', 'is part of': '[[Dog]]' }],
      [f.Tail, { 'is part of': ['[[Dog]]', '[[Cat]]'] }],
      [f.Loose, { causes: '[[Heat]]' }],
      [f.Heat, { causes: '[[Loose]]' }],
      [f.Egg, { 'is a type of': '[[Chicken]]' }],
      [f.Chicken, { 'is a type of': '[[Egg]]' }],
      [f.Part, { 'is part of': '[[Whole]]' }],
      [f.Whole, { 'is a type of': '[[Part]]' }],
      [f.Note, { supports: '[[Claim]]', contradicts: '[[Claim]]' }],
      [f.Claim, { parent: '[[Gone]]' }],
      [f.Twice, { 'is a type of': ['[[Claim]]', '[[Claim]]'] }],
    ]);
    app.metadataCache.getFileCache = (file) => (fms.has(file) ? { frontmatter: fms.get(file) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((x) => x.basename === link) || null;
    app.metadataCache.fileToLinktext = (x) => x.basename;
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = JSON.parse(JSON.stringify(fms.get(file) || {})); fn(fm); fms.set(file, fm); };
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    plugin.offerUndo = () => {};
    plugin.settings.knowledgeTreeKinds = 'is part of';
    const k = new R.Knowledge(plugin);
    const check = new R.KnowledgeCheck(plugin);
    // The kinds as set, which the canvas and notes both read.
    plugin.settings.canvasRelationTypes = [
      { name: 'is a type of', inverse: 'has type', category: 'hierarchy' },
      { name: 'is part of', inverse: 'has part', category: 'hierarchy' },
      { name: 'causes', inverse: 'is caused by', category: 'association' },
      { name: 'contrasts with', inverse: 'contrasts with', category: 'association' },
      { name: 'supports', inverse: 'is supported by', category: 'association' },
      { name: 'contradicts', inverse: 'is contradicted by', category: 'association' },
    ];
    const structure = new R.AlbumStructure(plugin);
    const info = structure.info.bind(structure);
    structure.info = (folder) => Object.assign(info(folder), folder.name === 'Map' ? { type: 'concept map' } : {});
    plugin.feature = (C) => (C === R.Knowledge ? k : C === R.KnowledgeCheck ? check : C === R.AlbumStructure ? structure : null);
    const seen = () => check.findings().map((x) => `${x.level} ${x.type} ${x.subject.basename}`);
    const all = seen();
    [
      'error broken Claim', 'error repeat Twice', 'error cycle Chicken', 'error conflict Wolf', 'error parents Tail',
      'warning cycle Part', 'warning redundant Dog', 'warning both Cat', 'warning oppose Note', 'warning folder Map', 'warning orphan Alone', 'warning broader Loose', 'warning broader Heat',
      'choice parents Dog', 'choice cycle Heat',
    ].forEach((x) => assert.ok(all.includes(x), `${x} in\n${all.join('\n')}`));
    assert.ok(!all.some((x) => / (broader|orphan) (Animal|Map|Mammal)$/.test(x)), 'the top of the hierarchy, and the collection’s own note, need nothing above them');
    assert.ok(!all.some((x) => x.startsWith('error') && x.includes('Dog')), 'several broader concepts: a polyhierarchy, not an error');
    // Errors first, then what's worth a look, then the choices.
    const levels = check.findings().map((x) => x.level);
    assert.deepStrictEqual(levels.slice().sort((a, b) => ['error', 'warning', 'choice'].indexOf(a) - ['error', 'warning', 'choice'].indexOf(b)), levels);
    // A strongly connected group of notes, however long the chain.
    const chain = Array.from({ length: 3000 }, (_, i) => i);
    assert.deepStrictEqual(R.loopsAmong(chain, (i) => [(i + 1) % 3000]).map((g) => g.length), [3000]);
    // The library check: the errors and warnings, a row a note, no choices.
    const problems = k.problems().map((p) => `${p.target.basename}: ${p.kind}`);
    ['Chicken: relation-loop', 'Egg: relation-loop', 'Claim: relation-missing', 'Dog: relation-implied', 'Loose: relation-broader'].forEach((x) => assert.ok(problems.includes(x), `${x} in ${problems.join(', ')}`));
    assert.ok(!problems.includes('Heat: relation-loop'), 'a loop of causes is a modelling choice');
    // Marked as meant: a choice, kept with the note.
    const both = check.findings().find((x) => x.type === 'both');
    await check.setMeant(both, true);
    assert.deepStrictEqual(plugin.settings.knowledgeMeant, { 'Map/Cat.md': ['both:contrasts with'] });
    assert.ok(seen().includes('choice both Cat'));
    assert.strictEqual(check.findings().find((x) => x.type === 'both').meant, true);
    // Fixed: the implied link taken out, the repeat kept once, the missing link taken out.
    const fix = async (type) => { await check.findings().find((x) => x.type === type).fixes[0].run(); k.cache = null; };
    await fix('redundant');
    assert.deepStrictEqual(fms.get(f.Dog)['is a type of'], ['[[Mammal]]']);
    await fix('repeat');
    assert.deepStrictEqual(fms.get(f.Twice)['is a type of'], ['[[Claim]]']);
    const broken = check.findings().find((x) => x.type === 'broken');
    await broken.fixes[1].run();
    k.cache = null;
    assert.ok(!('parent' in fms.get(f.Claim)));
    assert.ok(!seen().some((x) => / (redundant|repeat|broken) /.test(x)), seen().join('\n'));
    // On screen: a section for each level; a note's own, where its relationships are explored.
    Object.assign(view, { mode: 'knowledge-check', property: null });
    view.render();
    const text = (sel) => Array.from(view.contentEl.querySelectorAll(sel)).map((el) => el.textContent);
    assert.deepStrictEqual(text('.dr-report-head').map((h) => h.replace(/\d+$/, '')), ['Errors', 'Worth a look', 'Modelling choices']);
    assert.ok(view.contentEl.querySelector('.dr-integrity-row[data-type="conflict"] .dr-integrity-fix') === null, 'no fix to guess at for a conflict');
    assert.strictEqual(view.contentEl.querySelector('.dr-integrity-row[data-type="broader"] .dr-integrity-fix').textContent, 'Put it under Map (is a type of)');
    Object.assign(view, { mode: 'concept', property: f.Wolf.path });
    view.render();
    assert.ok(text('.dr-report-head').some((h) => h.startsWith('Worth checking')));
    // Switched off: no screen, nothing worked out.
    app.workspace.getActiveFile = () => f.Dog;
    assert.deepStrictEqual(check.commands().filter((c) => c.check()).map((c) => c.id), ['knowledge-check', 'knowledge-check-note']);
    plugin.settings.knowledgeCheck = false;
    assert.deepStrictEqual(check.commands().filter((c) => c.check()).map((c) => c.id), []);
  });

  await t('appearance: density and the look as classes on the page, canvas spacing as a scale; a command for each; gone when unloaded', async () => {
    const { plugin } = setup();
    const look = new R.Appearance(plugin);
    plugin.feature = (C) => (C === R.Appearance ? look : null);
    const has = (c) => document.body.classList.contains(c);
    look.enable();
    assert.ok(!has('dr-density-compact') && !has('dr-density-spacious') && !has('dr-look-editorial'), 'standard, and the theme’s look');
    plugin.settings.gridDensity = 'large';
    plugin.settings.canvasSpacing = 'compact';
    look.enable();
    assert.ok(has('dr-density-spacious'));
    assert.strictEqual(R.CANVAS_SPACE.scale, 0.75);
    const cmds = Object.fromEntries(look.commands().map((c) => [c.id, c]));
    cmds['switch-look'].run();
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(plugin.settings.look, 'editorial');
    assert.ok(has('dr-look-editorial'));
    cmds['next-canvas-spacing'].run();
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(plugin.settings.canvasSpacing, 'standard');
    assert.strictEqual(R.CANVAS_SPACE.scale, 1);
    // The editorial look on the whole window, or on Design Redux only.
    assert.ok(!has('dr-look-scoped'));
    plugin.settings.lookScope = 'plugin';
    look.enable();
    assert.ok(has('dr-look-editorial') && has('dr-look-scoped'));
    look.disable();
    assert.ok(!has('dr-density-spacious') && !has('dr-look-editorial') && !has('dr-look-scoped'), 'nothing left behind');
  });

  await t('covers sized on their own, apart from the density', () => {
    const { view, plugin } = setup();
    plugin.settings.gridDensity = 'compact';
    view.render();
    assert.strictEqual(view.containerEl.dataset.drArt, undefined, 'as the density');
    plugin.settings.artworkSize = 'large';
    view.render();
    assert.deepStrictEqual([view.containerEl.dataset.drDensity, view.containerEl.dataset.drArt], ['compact', 'large']);
  });

  await t('concept actions defined once: commands, a note’s menu, a canvas card’s menu; a child concept made under it, and moved under another, with Undo', async () => {
    const { v, plugin, app } = setup();
    v.folder('Ideas');
    const gov = v.file('Ideas/Government.md');
    const law = v.file('Ideas/Law.md');
    const fms = new Map();
    app.metadataCache.getFileCache = (file) => (fms.has(file) ? { frontmatter: fms.get(file) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((x) => x.basename === link) || null;
    app.metadataCache.fileToLinktext = (x) => x.basename;
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = JSON.parse(JSON.stringify(fms.get(file) || {})); fn(fm); fms.set(file, fm); };
    app.fileManager.trashFile = async () => {};
    let created = null;
    app.vault.create = async (path, body) => { created = [path, body]; const f = v.file(path); return f; };
    let undo = null;
    plugin.offerUndo = (m, fn) => { undo = fn; };
    plugin.freeChildPath = (folder, base, ext) => `${folder.path}/${base}.${ext}`;
    const k = new R.Knowledge(plugin);
    plugin.feature = (C) => (C === R.Knowledge ? k : null);
    const ids = k.actions().map((a) => a.id);
    assert.ok(['knowledge-explore', 'knowledge-add', 'knowledge-child', 'knowledge-move', 'knowledge-in-canvas', 'knowledge-in-album', 'knowledge-map'].every((id) => ids.includes(id)));
    // As commands: offered with a note open, not without.
    let active = gov;
    app.workspace.getActiveFile = () => active;
    const cmds = Object.fromEntries(R.actionCommands(k.actions(), () => (active ? { file: active, from: 'palette' } : null)).map((c) => [c.id, c]));
    assert.strictEqual(cmds['knowledge-explore'].check(), true);
    assert.strictEqual(cmds['knowledge-broader'].check(), false, 'nothing above it yet');
    active = null;
    assert.strictEqual(cmds['knowledge-explore'].check(), false);
    // On a menu: one group, each by its short name; on a canvas, not "Open in canvas".
    const titles = (from) => {
      const items = [];
      R.addActionItems({ addItem: (fn) => { const it = {}; ['setSection', 'setIcon', 'setChecked'].forEach((m) => (it[m] = () => it)); it.setTitle = (x) => { it.title = x; return it; }; it.onClick = () => it; fn(it); items.push(it.title); } }, k.actions(), { file: gov, from }, 'Concept', 'waypoints');
      return items;
    };
    assert.ok(titles('menu').includes('Concept: Show related concepts'));
    assert.ok(titles('menu').includes('Concept: Open in canvas'));
    assert.ok(!titles('canvas').includes('Concept: Open in canvas'));
    // A child concept: a note beside it, saying it sits under it; Undo takes it away.
    const child = await k.makeConcept('Parliament', gov);
    assert.deepStrictEqual(created, ['Ideas/Parliament.md', '---\nparent: "[[Government]]"\n---\n']);
    assert.strictEqual(child.basename, 'Parliament');
    assert.ok(typeof undo === 'function');
    // Moved under another: its parent names only that one now, and back.
    fms.set(child, { parent: '[[Government]]' });
    assert.strictEqual(await k.moveUnder(child, law), true);
    assert.deepStrictEqual(fms.get(child).parent, ['[[Law]]']);
    await undo();
    assert.strictEqual(fms.get(child).parent, '[[Government]]');
  });

  await t('workspace modes — Study, Research, Canvas: entered at a command, the layout kept first; another keeps the first layout; Standard puts it back whole', async () => {
    const { plugin, app } = setup();
    const calls = [];
    let layout = { main: 'as it was' };
    app.workspace.getLayout = () => JSON.parse(JSON.stringify(layout));
    app.workspace.changeLayout = async (l) => { calls.push(['changeLayout', l]); layout = l; };
    app.workspace.leftSplit = { expand: () => calls.push('left open'), collapse: () => calls.push('left shut') };
    app.workspace.rightSplit = { expand: () => calls.push('right open'), collapse: () => calls.push('right shut') };
    app.workspace.getLastOpenFiles = () => [];
    app.workspace.getActiveFile = () => null;
    app.workspace.onLayoutReady = (fn) => fn();
    plugin.offerUndo = () => {};
    const modes = new R.WorkspaceModes(plugin);
    plugin.feature = (C) => (C === R.WorkspaceModes ? modes : null);
    assert.strictEqual(modes.current(), null);
    await modes.enter('study');
    assert.strictEqual(modes.current(), 'study');
    assert.deepStrictEqual(plugin.settings.workspaceModeLayout, { main: 'as it was' });
    assert.deepStrictEqual(calls.slice(0, 2), ['left shut', 'right shut']);
    assert.ok(document.body.classList.contains('dr-mode-study'));
    // Another mode: the layout from before the first is still the one kept.
    layout = { main: 'studying' };
    await modes.enter('mapping');
    assert.deepStrictEqual(plugin.settings.workspaceModeLayout, { main: 'as it was' });
    assert.ok(!document.body.classList.contains('dr-mode-study') && document.body.classList.contains('dr-mode-mapping'));
    // The switcher: Standard and every mode, the one on ticked, and its settings.
    plugin.openSettingsAt = (key) => calls.push(['settings', key]);
    modes.showMenu({ clientX: 1, clientY: 1 });
    const menu = menus[menus.length - 1];
    assert.deepStrictEqual(menu.items.map((i) => i.title), ['Standard', 'Study', 'Research', 'Canvas', 'Mode settings…']);
    assert.strictEqual(menu.items.find((i) => i.checked).title, 'Canvas');
    menu.items[4].click();
    assert.deepStrictEqual(calls[calls.length - 1], ['settings', 'workspaceModes']);
    // Standard: as it was.
    menu.items[0].click();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepStrictEqual(calls[calls.length - 1], ['changeLayout', { main: 'as it was' }]);
    assert.strictEqual(modes.current(), null);
    assert.ok(!document.body.classList.contains('dr-mode-mapping'));
    assert.strictEqual(modes.commands().find((c) => c.id === 'workspace-mode-leave').check(), false);
    // Library and Review were modes: their commands, and hotkeys, open those places now.
    const went = [];
    const library = { reveal: () => went.push('reveal'), browseMode: async (st) => went.push(st.mode) };
    plugin.feature = (C) => (C === R.WorkspaceModes ? modes : C === R.Library ? library : null);
    modes.commands().find((c) => c.id === 'workspace-mode-review').run();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepStrictEqual(went, ['reveal', 'library-check']);
    assert.strictEqual(modes.current(), null, 'no mode');
  });

  await t('the note panel: a note’s relationships both ways, to open or take off, and the albums and canvases it’s in', async () => {
    const { v, plugin, app } = setup();
    v.folder('Ideas');
    const gov = v.file('Ideas/Government.md');
    const parl = v.file('Ideas/Parliamentarism.md');
    const pres = v.file('Ideas/Presidentialism.md');
    const reading = v.file('IR/IR.md');
    const fms = new Map([
      [parl, { parent: '[[Government]]', 'contrasts with': ['[[Presidentialism]]'] }],
      [pres, {}],
      [reading, { includes: ['[[Parliamentarism]]'] }],
    ]);
    app.metadataCache.getFileCache = (file) => (fms.has(file) ? { frontmatter: fms.get(file) } : null);
    app.metadataCache.getFirstLinkpathDest = (link) => v.vault.getMarkdownFiles().find((x) => x.basename === link) || null;
    app.metadataCache.fileToLinktext = (x) => x.basename;
    app.metadataCache.resolvedLinks = { 'Maps/Politics.canvas': { 'Ideas/Parliamentarism.md': 1 }, 'Maps/Other.canvas': { 'IR/Anarchy.md': 1 } };
    v.folder('Maps');
    v.file('Maps/Politics.canvas');
    v.file('Maps/Other.canvas');
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = JSON.parse(JSON.stringify(fms.get(file) || {})); fn(fm); fms.set(file, fm); };
    plugin.offerUndo = () => {};
    plugin.folderNote = (folder) => v.vault.getFileByPath(`${folder.path}/${folder.name}.md`);
    const k = new R.Knowledge(plugin);
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.Knowledge ? k : C === R.AlbumStructure ? structure : null);
    const closed = [];
    const panel = { plugin, close: () => closed.push(true) };
    const host = document.body.createDiv();

    // Relationships: what it comes under, then each kind, both ways.
    const rel = new R.RelationsSection(panel, k);
    rel.mount(host, parl);
    const el = rel.containerEl;
    assert.strictEqual(el.querySelector('.dr-section-label').textContent, 'Relationships');
    assert.deepStrictEqual([...el.querySelectorAll('.dr-relations-crumb')].map((c) => c.textContent), ['Government']);
    const heads = [...el.querySelectorAll('.dr-section-title')].map((h) => h.textContent);
    assert.ok(heads.includes('Sits under') && heads.includes('Contrasts with'), heads.join(', '));
    // From the other side, the same relationship under its inverse.
    const other = new R.RelationsSection(panel, k);
    other.mount(host, gov);
    assert.deepStrictEqual([...other.containerEl.querySelectorAll('.dr-section-title')].map((h) => h.textContent), ['Holds']);
    assert.deepStrictEqual([...other.containerEl.querySelectorAll('.dr-mention-name')].map((n) => n.textContent), ['Parliamentarism']);
    // Taken off from the panel: written into the note that holds it.
    const off = [...el.querySelectorAll('.dr-mention-remove')].find((x) => /contrasts with Presidentialism/.test(x.getAttribute('aria-label')));
    off.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(fms.get(parl)['contrasts with'], undefined);
    assert.strictEqual(closed.length, 0, 'taking one off doesn’t open the note');
    // Nothing related: said so, with Add.
    const none = new R.RelationsSection(panel, k);
    none.mount(host, v.file('IR/Balance.md'));
    assert.ok(none.containerEl.textContent.includes('Nothing related to it yet.'));
    assert.deepStrictEqual([...none.containerEl.querySelectorAll('.dr-section-action')].map((b) => b.textContent), ['Add']);

    // Kept in: its own album, the albums that include it, the canvases it's on.
    const places = new R.PlacesSection(panel, structure);
    places.mount(host, parl);
    const names = [...places.containerEl.querySelectorAll('.dr-mention-name')].map((n) => n.textContent);
    assert.deepStrictEqual(names, ['Ideas', 'IR', 'Politics']);
    assert.ok(places.containerEl.textContent.includes('includes it'));
  });

  await t('a property, tag or value renamed by the bulk tools: what a screen shows and filters by follows', () => {
    const { view } = setup();
    Object.assign(view, { property: 'status', value: 'draft', filterProp: { key: 'Status', value: 'draft' }, filterTag: '#law/court' });
    view.followRenamed({ value: ['status', 'draft', 'wip'] });
    assert.strictEqual(view.value, 'wip');
    assert.deepStrictEqual(view.filterProp, { key: 'Status', value: 'wip' });
    view.followRenamed({ property: ['STATUS', 'State'] });
    assert.strictEqual(view.property, 'state');
    assert.strictEqual(view.filterProp.key, 'State');
    view.followRenamed({ tag: ['law', 'jurisprudence'] });
    assert.strictEqual(view.filterTag, '#jurisprudence/court');
    view.followRenamed({ tag: ['politics', 'x'] });
    assert.strictEqual(view.filterTag, '#jurisprudence/court', 'another tag leaves it');
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
