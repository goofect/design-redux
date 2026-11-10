// Albums, against the real main.js: their own order by drag, the edit
// mode (rename, move, delete, add, arrange), the strip's skip buttons,
// arrangements that follow renames and deletions, each note's length,
// and the Home screen.
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
// Enough of a settings row for a dialog's buttons: each a <button>, clicked as Obsidian's are.
class Setting {
  constructor(el) { this.settingEl = el.createDiv({ cls: 'setting-item' }); }
  setName() { return this; }
  setDesc() { return this; }
  setClass() { return this; }
  addButton(cb) {
    const el = this.settingEl.createEl('button');
    const b = { buttonEl: el, setButtonText: (t) => { el.textContent = t; return b; }, setCta: () => b, setDisabled: (d) => { el.disabled = d; return b; }, onClick: (f) => { el.addEventListener('click', f); return b; } };
    cb(b);
    return this;
  }
  addExtraButton(cb) { return this.addButton((b) => cb(Object.assign(b, { setIcon: () => b, setTooltip: () => b }))); }
}
const obsidian = new Proxy({
  Menu, Modal, FuzzySuggestModal, Component, ItemView, TFile, TFolder, TAbstractFile, MarkdownView, Setting,
  // As Obsidian's: an icon must be named.
  setIcon: (el, name) => { if (typeof name !== 'string') throw new TypeError("Cannot read properties of undefined (reading 'startsWith')"); el.dataset.icon = name; },
  Notice: class { constructor(m) { notices.push(m); } },
  Platform: { isMobile: false, isPhone: false },
  normalizePath: (p) => p.replace(/\/+/g, '/').replace(/^\//, ''),
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const R = loadMain(obsidian, 'album');

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
    // A capability (core/081), as the plugin's: through the class offering it and feature(), so a test's own override still answers.
    capability(n) { const C = Object.values(R).find((c) => typeof c === 'function' && (c.offers || []).indexOf(n) !== -1); return C ? this.feature(C) : null; },
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
  await t('the browse view’s parts each write a method once: a later one never quietly replaces an earlier', () => {
    const seen = new Map();
    for (let proto = R.BrowseView.prototype; proto && proto.constructor !== ItemView; proto = Object.getPrototypeOf(proto)) {
      Object.getOwnPropertyNames(proto).forEach((name) => {
        if (name === 'constructor') return;
        assert.ok(!seen.has(name), `${name} is written in ${seen.get(name)} and ${proto.constructor.name}`);
        seen.set(name, proto.constructor.name);
      });
    }
    assert.ok(seen.size > 100);
  });

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
    Object.assign(plugin.settings, { notePage: true, notePageChips: true, notePageShelves: true, albumNestBy: 'parent' });
    // A note's view as Obsidian lays it out, editing, on the page.
    const containerEl = document.body.createDiv();
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
    assert.ok(!sizer.querySelector('.dr-note-glow') && !sizer.classList.contains('dr-has-glow'), 'no tint from a cover');
    assert.strictEqual(album.nextElementSibling, title, 'above the title');
    const meta = title.nextElementSibling;
    assert.ok(meta.classList.contains('dr-note-meta'));
    assert.ok(/^Under Balance {2}· {2}1 of 4 {2}· {2}Edited /.test(meta.textContent), meta.textContent);
    const chips = Array.from(sizer.querySelectorAll('.dr-note-chip')).map((c) => c.textContent);
    assert.deepStrictEqual(chips, ['draft', 'law'], 'its parent and cover said elsewhere; nothing more beside them');
    assert.ok(containerEl.classList.contains('dr-props-as-chips'));
    // First of four in IR: nothing before it, Balance next, as a row before the shelves.
    const next = sizer.querySelector('.dr-note-next');
    assert.strictEqual(next.previousElementSibling, content, 'after the text');
    const steps = Array.from(next.querySelectorAll('.dr-note-step'));
    assert.deepStrictEqual(steps.map((st) => [st.className, st.querySelector('.dr-note-step-label').textContent, st.querySelector('.dr-note-step-title').textContent]), [['dr-note-step is-next', 'Next', 'Balance']]);
    assert.strictEqual(steps[0].getAttribute('aria-label'), 'Next in IR: Balance');
    const shelves = sizer.querySelector('.dr-note-shelves');
    assert.strictEqual(shelves.previousElementSibling, next, 'after the step, before the backlinks');
    assert.deepStrictEqual(Array.from(shelves.querySelectorAll('.dr-note-shelf-head')).map((h) => h.textContent), ['Linked from here ›', 'Mentioned in ›', 'More in IR ›']);
    assert.deepStrictEqual(Array.from(shelves.querySelectorAll('.dr-note-shelf')[1].querySelectorAll('.dr-note-tile-title')).map((x) => x.textContent), ['Cooperation']);
    const more = Array.from(shelves.querySelectorAll('.dr-note-shelf')[2].querySelectorAll('.dr-note-tile-title')).map((x) => x.textContent);
    assert.ok(more.length && !more.includes('Balance') && !more.includes('Anarchy'), `More in IR leaves out the step and the note itself: ${more}`);
    assert.deepStrictEqual(page.actions().map((a) => a.id), ['previous-in-album', 'next-in-album']);
    await settle();
    assert.strictEqual(shelves.querySelector('.dr-note-tile-line').textContent, 'Balance begins here.');
    assert.strictEqual(steps[0].querySelector('.dr-note-step-line').textContent, 'Balance begins here.');
    // Drawn again with nothing changed: the same elements.
    page.draw(view);
    assert.strictEqual(sizer.querySelector('.dr-note-shelves'), shelves);
    assert.strictEqual(sizer.querySelector('.dr-note-next'), next);
    assert.strictEqual(sizer.querySelector('.dr-note-album'), album);
    // The steps switched off: the row goes, and the place leaves the grey line.
    plugin.settings.notePageNext = false;
    page.draw(view);
    assert.ok(!sizer.querySelector('.dr-note-next'));
    assert.ok(!/1 of 4/.test(sizer.querySelector('.dr-note-meta').textContent));
    plugin.settings.notePageNext = true;
    // Off: all of it gone.
    plugin.settings.notePage = false;
    page.draw(view);
    assert.ok(!sizer.querySelector('.dr-note-album, .dr-note-meta, .dr-note-chips, .dr-note-next, .dr-note-shelves'));
    assert.ok(!containerEl.classList.contains('dr-props-as-chips'));
    containerEl.remove();
  });

  await t('a note’s line is its description when it has one, on the note page’s step as on a row; read later, only while it’s on the page', async () => {
    const { v, plugin, app, view } = setup();
    const file = v.vault.getAbstractFileByPath('IR/Anarchy.md');
    const balance = v.vault.getAbstractFileByPath('IR/Balance.md');
    app.metadataCache.getFileCache = (f) => ({ frontmatter: f === balance ? { description: 'The **balance** of power.' } : {} });
    v.vault.cachedRead = async (f) => `${f.basename} begins here. More.`;
    Object.assign(plugin.settings, { notePage: true });
    const containerEl = document.body.createDiv();
    const sizer = containerEl.createDiv({ cls: 'markdown-source-view' }).createDiv({ cls: 'cm-sizer' });
    sizer.createDiv({ cls: 'inline-title', text: 'Anarchy' });
    sizer.createDiv({ cls: 'cm-contentContainer' });
    new R.NotePage(plugin).draw({ containerEl, file });
    await settle();
    assert.strictEqual(sizer.querySelector('.dr-note-step.is-next .dr-note-step-line').textContent, 'The balance of power.');
    const row = document.body.createDiv();
    view.showExcerpt(row, balance);
    assert.strictEqual(row.dataset.excerpt, 'The balance of power.', 'a row in the browse view');
    view.showExcerpt(row, file);
    await settle();
    assert.strictEqual(row.dataset.excerpt, 'Anarchy begins here.');
    // Gone from the page before the read came back: nothing written to it.
    plugin.excerpts.clear();
    const gone = document.createElement('div');
    R.noteExcerpt(plugin, file, (text) => gone.setText(text), gone);
    await settle();
    assert.strictEqual(gone.textContent, '');
    assert.strictEqual(plugin.excerpts.get(`${file.path}|${file.stat ? file.stat.mtime : 0}`), 'Anarchy begins here.', 'kept for the next');
    R.noteExcerpt(plugin, { path: 'a.pdf', extension: 'pdf' }, (text) => gone.setText(text || 'none'));
    assert.strictEqual(gone.textContent, 'none', 'not a note: no line');
    row.remove();
    containerEl.remove();
  });

  await t('a value’s colour changed: the note page’s chip is painted again', async () => {
    const { v, plugin, app } = setup();
    const file = v.vault.getAbstractFileByPath('IR/Anarchy.md');
    app.metadataCache.getFileCache = (f) => ({ frontmatter: f === file ? { status: 'draft' } : {} });
    Object.assign(plugin.settings, { notePage: true, notePageChips: true, propertyOptions: { status: { draft: { color: 'green' } } } });
    const containerEl = document.body.createDiv();
    const sizer = containerEl.createDiv({ cls: 'markdown-source-view' }).createDiv({ cls: 'cm-sizer' });
    sizer.createDiv({ cls: 'inline-title', text: 'Anarchy' });
    const view = { containerEl, file };
    app.workspace.getLeavesOfType = (type) => (type === 'markdown' ? [{ isDeferred: false, view }] : []);
    const page = new R.NotePage(plugin);
    plugin.feature = (C) => (C === R.NotePage ? page : null);
    page.draw(view);
    const chip = () => sizer.querySelector('.dr-note-chip');
    assert.strictEqual(chip().dataset.drColor, 'green');
    page.draw(view);
    const first = chip();
    assert.strictEqual(chip(), first, 'nothing changed: the same chip');
    // Set in the dialog: saved, and each feature drawn again on the next frame, as the plugin's own queueSync does.
    plugin.queueSync = () => R.DesignRedux.prototype.queueSync.call(plugin);
    plugin.each = (fn) => fn(page);
    plugin.saveData = async () => {};
    let browsed = 0;
    plugin.refreshBrowse = () => browsed++;
    await new R.ValueOptionModal(plugin, 'status', 'draft').save({ color: 'red', icon: 'star' });
    await settle(40);
    assert.notStrictEqual(chip(), first, 'made again');
    assert.strictEqual(chip().dataset.drColor, 'red');
    assert.ok(chip().querySelector('.dr-value-icon'), 'with its icon');
    assert.strictEqual(browsed, 1, 'the browse view drawn again as before');
    plugin.settings.propertyOptions = {};
    page.draw(view);
    assert.ok(!chip().classList.contains('dr-value-painted'), 'cleared: plain again');
    containerEl.remove();
  });

  await t('a note’s page is drawn again only when a note it could show changes: itself, its album’s, one linked either way', async () => {
    const { v, plugin, app } = setup();
    const on = {};
    app.metadataCache.on = (type, fn) => ((on[type] = fn), {});
    app.workspace.on = (type, fn) => ((on[type] = fn), {});
    app.workspace.trigger = (type) => on[type] && on[type]();
    plugin.registerEvent = () => {};
    const links = { 'IR/Anarchy.md': { 'IR/Theories/Realism.md': 1 } };
    app.metadataCache.resolvedLinks = links;
    let text = 'begins here.';
    v.vault.cachedRead = async (f) => `${f.basename} ${text}`;
    Object.assign(plugin.settings, { notePage: true, notePageShelves: true });
    v.folder('Elsewhere');
    const stray = v.file('Elsewhere/Stray.md');
    const at = (p) => v.vault.getAbstractFileByPath(p);
    const file = at('IR/Anarchy.md');
    // On the page: a line read later is written only while its place is.
    const containerEl = document.body.createDiv();
    const sizer = containerEl.createDiv({ cls: 'markdown-source-view' }).createDiv({ cls: 'cm-sizer' });
    sizer.createDiv({ cls: 'inline-title', text: 'Anarchy' });
    sizer.createDiv({ cls: 'cm-contentContainer' });
    const view = { containerEl, file };
    app.workspace.getLeavesOfType = (type) => (type === 'markdown' ? [{ view }] : []);
    // What the shelves read: the vault's notes, through the index.
    let scans = 0;
    const markdown = app.vault.getMarkdownFiles.bind(app.vault);
    app.vault.getMarkdownFiles = () => (scans++, markdown());
    const page = new R.NotePage(plugin);
    let draws = 0;
    const draw = page.draw.bind(page);
    page.draw = (x) => (draws++, draw(x));
    page.register();
    page.enable();
    await settle(40);
    assert.strictEqual(draws, 1);
    assert.ok(scans > 0);
    const heads = () => Array.from(sizer.querySelectorAll('.dr-note-shelf-head')).map((h) => h.textContent);
    const tiles = (head) => {
      const shelf = Array.from(sizer.querySelectorAll('.dr-note-shelf')).find((x) => x.querySelector('.dr-note-shelf-head').textContent === head);
      return shelf ? Array.from(shelf.querySelectorAll('.dr-note-tile-title')).map((x) => x.textContent) : [];
    };
    const steps = () => Array.from(sizer.querySelectorAll('.dr-note-step')).map((st) => `${st.querySelector('.dr-note-step-label').textContent} ${st.querySelector('.dr-note-step-title').textContent}`);
    assert.deepStrictEqual(heads(), ['Linked from here ›', 'More in IR ›']);
    assert.deepStrictEqual(steps(), ['Next Balance']);
    assert.deepStrictEqual(tiles('More in IR ›'), ['Deterrence', 'Cooperation']);
    const count = async (fire) => {
      draws = 0;
      scans = 0;
      fire();
      await settle(40);
      return [draws, scans];
    };
    // The vault's first load resolved: everything, worked out anew; once.
    assert.deepStrictEqual(await count(() => on.resolved()), [1, 1]);
    const shelves = sizer.querySelector('.dr-note-shelves');
    // A note in another folder, linked neither way: nothing drawn, nothing read.
    assert.deepStrictEqual(await count(() => (on.changed(stray), on.resolve(stray), on.resolved())), [0, 0]);
    assert.strictEqual(sizer.querySelector('.dr-note-shelves'), shelves);
    // Drawn again as a tab switch draws it: the shelves kept, the vault not read again.
    assert.deepStrictEqual(await count(() => page.sync()), [1, 0]);
    assert.strictEqual(sizer.querySelector('.dr-note-shelves'), shelves);
    // One it links to, in another folder: drawn again, its shelves worked out anew.
    assert.deepStrictEqual(await count(() => on.changed(at('IR/Theories/Realism.md'))), [1, 1]);
    // One that links to it once edited: seen as its links resolve.
    const liberalism = at('IR/Theories/Liberalism.md');
    assert.deepStrictEqual(await count(() => on.changed(liberalism)), [0, 0]);
    links['IR/Theories/Liberalism.md'] = { 'IR/Anarchy.md': 1 };
    assert.deepStrictEqual(await count(() => on.resolve(liberalism)), [1, 1]);
    assert.deepStrictEqual(heads(), ['Linked from here ›', 'Mentioned in ›', 'More in IR ›']);
    // And the link taken out again: it was on the shelves, so drawn again without it.
    delete links['IR/Theories/Liberalism.md'];
    assert.deepStrictEqual(await count(() => on.resolve(liberalism)), [1, 1]);
    assert.deepStrictEqual(heads(), ['Linked from here ›', 'More in IR ›']);
    // Ones in its album, edited: drawn again, the opening lines of its tile and its step fresh.
    const line = (cls, name) => Array.from(sizer.querySelectorAll(`.${cls}`)).find((x) => x.textContent.indexOf(name) !== -1);
    assert.strictEqual(line('dr-note-tile-line', 'Cooperation').textContent, 'Cooperation begins here.');
    assert.strictEqual(line('dr-note-step-line', 'Balance').textContent, 'Balance begins here.');
    text = 'says something new.';
    at('IR/Cooperation.md').stat.mtime += 1000;
    at('IR/Balance.md').stat.mtime += 1000;
    assert.deepStrictEqual(await count(() => (on.changed(at('IR/Cooperation.md')), on.changed(at('IR/Balance.md')))), [1, 1]);
    assert.strictEqual(line('dr-note-tile-line', 'Cooperation').textContent, 'Cooperation says something new.');
    assert.strictEqual(line('dr-note-step-line', 'Balance').textContent, 'Balance says something new.');
    containerEl.remove();
  });

  await t('an album put in an order of its own: the note page’s steps and its “More in” follow', async () => {
    const { plugin, app, ir } = setup();
    const on = {};
    app.metadataCache.on = () => ({});
    app.workspace.on = (type, fn) => ((on[type] = fn), {});
    app.workspace.trigger = (type) => on[type] && on[type]();
    plugin.registerEvent = () => {};
    app.metadataCache.resolvedLinks = {};
    Object.assign(plugin.settings, { notePage: true, notePageShelves: true });
    const file = app.vault.getAbstractFileByPath('IR/Anarchy.md');
    const containerEl = document.createElement('div');
    const sizer = containerEl.createDiv({ cls: 'markdown-source-view' }).createDiv({ cls: 'cm-sizer' });
    sizer.createDiv({ cls: 'inline-title', text: 'Anarchy' });
    sizer.createDiv({ cls: 'cm-contentContainer' });
    const view = { containerEl, file };
    app.workspace.getLeavesOfType = (type) => (type === 'markdown' ? [{ view }] : []);
    const page = new R.NotePage(plugin);
    page.register();
    page.enable();
    await settle(40);
    const steps = () => Array.from(sizer.querySelectorAll('.dr-note-step-title')).map((x) => x.textContent);
    const more = () => Array.from(sizer.querySelectorAll('.dr-note-tile-title')).map((x) => x.textContent);
    assert.deepStrictEqual([steps(), more()], [['Balance'], ['Deterrence', 'Cooperation']]);
    // Arranged in the browse view: told, and drawn again.
    plugin.orders.setAlbum(ir, ['Cooperation.md', 'Anarchy.md', 'Balance.md', 'Deterrence.md']);
    await settle(40);
    assert.deepStrictEqual([steps(), more()], [['Cooperation', 'Balance'], ['Deterrence']]);
    assert.ok(/2 of 4/.test(sizer.querySelector('.dr-note-meta').textContent));
    // Even untold, its shelves aren't served stale once the steps either side move.
    plugin.settings.albumOrders = { IR: { names: ['Anarchy.md', 'Deterrence.md', 'Balance.md', 'Cooperation.md'], on: true } };
    page.sync();
    assert.deepStrictEqual([steps(), more()], [['Deterrence'], ['Cooperation', 'Balance']]);
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
    // Classic is gone: whoever had it has the theme's look, without what it hid.
    const classic = { look: 'classic', notePage: true };
    R.SETTINGS_MIGRATIONS.find((m) => m.to === 17).run(classic);
    assert.deepStrictEqual(classic, { look: 'theme', notePage: false, albumExcerpts: false, glassPanels: false });
    assert.ok(!('classic' in R.LOOKS));
  });

  await t('progress rings are gone: no ring on a cover, and their setting migrated away', async () => {
    const { v, plugin, app } = setup();
    plugin.saveData = () => {};
    const f = (p) => v.vault.getAbstractFileByPath(p);
    // No rings on covers: they've gone, and their switch with them.
    const art = document.createElement('div');
    R.drawFolderArt(plugin, art, f('IR/Theories'));
    assert.strictEqual(art.querySelector('.dr-progress-ring'), null);
    const saved = { albumProgressRing: true };
    R.SETTINGS_MIGRATIONS.find((m) => m.to === 26).run(saved);
    assert.ok(!('albumProgressRing' in saved) && !('albumProgressRing' in R.DEFAULTS));
  });

  await t('images added go to the image folder once a note links them: names with spaces, any case; a folder made if missing; one gone first left alone', async () => {
    const { v, plugin, app } = setup();
    Object.assign(plugin.settings, { routeImages: true, imageFolder: '/Media files/' });
    const moved = [];
    plugin.moveFile = async (file, folder) => moved.push([file.path, folder]);
    const handlers = [];
    app.metadataCache = Object.assign(app.metadataCache, { on: (type, fn) => (handlers.push(fn), fn), offref: (ref) => handlers.splice(handlers.indexOf(ref), 1), resolvedLinks: {} });
    const router = new R.ImageRouter(plugin);
    router.app = app;
    const pic = v.file('IR/Pic One.PNG');
    await router.route(pic);
    assert.strictEqual(handlers.length, 1, 'waits for a note to link it');
    app.metadataCache.resolvedLinks['IR/Anarchy.md'] = { 'IR/Pic One.PNG': 1 };
    await handlers[0]({ path: 'IR/Anarchy.md' });
    await settle();
    assert.deepStrictEqual(moved, [['IR/Pic One.PNG', 'Media files']], 'any case of its extension; spaces in names');
    assert.ok(app.vault.getFolderByPath('Media files'), 'the folder made');
    assert.strictEqual(handlers.length, 0, 'stops listening');
    v.folder('Media files/Old');
    await router.route(v.file('Media files/Old/Inside.png'));
    await router.route(v.file('IR/Notes.txt'));
    assert.strictEqual(handlers.length, 0, 'beneath the folder already, or not an image: left');
    const gone = v.file('IR/Gone.jpg');
    await router.route(gone);
    await v.fileManager.trashFile(gone);
    app.metadataCache.resolvedLinks['IR/Balance.md'] = { 'IR/Gone.jpg': 1 };
    await handlers[0]({ path: 'IR/Balance.md' });
    await settle();
    assert.strictEqual(moved.length, 1, 'gone before it could move: nothing');
  });

  await t('1.x settings open on 2.0 with nothing lost: kept as they were, a backup first, retired ones dropped', async () => {
    const saved = {
      settingsVersion: 3,
      settingsLevel: 'all',
      libraryPreview: true,
      coverFallback: 'art',
      albumColumns: 'status, modified',
      canvasLegends: { 'Map.canvas': { labels: { 1: 'Cases' } } },
      homeShelves: [{ id: 'recents', on: false }],
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
    assert.ok(!('canvasLegends' in s), 'canvas maps’ settings let go at 3.0');
    assert.deepStrictEqual(s.homeShelves, saved.homeShelves);
    assert.deepStrictEqual(s.librarySections[0].items.map((i) => i.id || i.path), ['bookmarks', 'IR']);
    assert.strictEqual(s.settingsVersion, 30);
    assert.strictEqual(s.contextStrip, true, 'an existing install keeps its strip');
    // The diagnostics say what loading did.
    assert.match(R.settingsLine(ctx), /^Settings: version 30, brought up from \d+; steps [\d, ]+30$/);
    assert.ok(!('panelRelationships' in s), 'Relationships have gone');
    assert.ok(!('settingsLevel' in s) && !('libraryPreview' in s), 'two settings nothing read let go at step 27');
    assert.strictEqual(s.panelPlaces, false, 'nor Kept in');
    assert.strictEqual(s.glassPanels, false, 'the quieter look');
    assert.ok(!('notePageTint' in s), 'the tint from a cover let go at step 29');
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
    // Properties…: the property tools over the notes ticked.
    const opened = [];
    const capability = plugin.capability;
    plugin.capability = (n) => (n === 'propertyTools' ? { openTools: (targets, tab) => opened.push([targets.map((f) => f.basename).sort(), tab]) } : capability.call(plugin, n));
    Array.from(bar().querySelectorAll('.dr-bulk-action')).find((b) => b.textContent === 'Properties…').click();
    plugin.capability = capability;
    assert.deepStrictEqual(opened, [[['Anarchy', 'Balance', 'Cooperation'], null]]);
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

  await t('without the strip, « » sit in the note’s header, name where they go and open it there', () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    const containerEl = document.body.createDiv();
    containerEl.createDiv({ cls: 'view-header' }).createDiv({ cls: 'view-header-left' });
    const leaf = { isDeferred: false, containerEl, view: Object.assign(new MarkdownView(), { file }), openFile(f) { this.view.file = f; } };
    app.workspace.iterateAllLeaves = (fn) => fn(leaf);
    // Obsidian's own, which the buttons are made with.
    if (typeof global.createDiv !== 'function') global.createDiv = (o) => { const el = document.createElement('div').createDiv(o); el.remove(); return el; };
    const skip = new R.HeaderSkip(plugin);
    const labels = () => Array.from(containerEl.querySelectorAll('.dr-header-skip-btn')).map((b) => b.getAttribute('aria-label'));
    plugin.settings.contextStrip = true;
    skip.sync();
    assert.deepStrictEqual(labels(), [], 'the strip has them');
    plugin.settings.contextStrip = false;
    skip.sync();
    assert.deepStrictEqual(labels(), ['Previous in collection: Anarchy', 'Next in collection: Cooperation']);
    containerEl.querySelectorAll('.dr-header-skip-btn')[1].click();
    assert.strictEqual(leaf.view.file.basename, 'Cooperation');
    skip.sync();
    assert.strictEqual(containerEl.querySelectorAll('.dr-header-skip').length, 1, 'one pair a tab');
    skip.disable();
    assert.ok(!containerEl.querySelector('.dr-header-skip'));
    containerEl.remove();
  });

  await t('a Next row, a shelf tile and the next-in-album command all open in the page', () => {
    const { plugin, app } = setup();
    const file = app.vault.getFileByPath('IR/Balance.md');
    const leaf = { isDeferred: false, view: Object.assign(new MarkdownView(), { file }), openFile(f) { this.view.file = f; } };
    const other = { openFile() { throw new Error('opened beside the page'); } };
    app.workspace.rootSplit = {};
    app.workspace.getMostRecentLeaf = () => leaf;
    app.workspace.getLeaf = () => other;
    app.metadataCache.getFileCache = () => ({ frontmatter: {} });
    Object.assign(plugin.settings, { notePage: true, notePageShelves: true });
    const containerEl = document.createElement('div');
    const sizer = containerEl.createDiv({ cls: 'markdown-source-view' }).createDiv({ cls: 'cm-sizer' });
    sizer.createDiv({ cls: 'inline-title', text: 'Balance' });
    sizer.createDiv({ cls: 'cm-contentContainer' });
    const page = new R.NotePage(plugin);
    page.draw({ containerEl, file });
    click(sizer.querySelector('.dr-note-step.is-next'));
    assert.strictEqual(leaf.view.file.basename, 'Cooperation', 'the row opens in the page');
    leaf.view.file = file;
    const tile = sizer.querySelector('.dr-note-tile');
    const name = tile.querySelector('.dr-note-tile-title').textContent;
    click(tile);
    assert.strictEqual(leaf.view.file.basename, name, 'the tile opens in the page');
    leaf.view.file = file;
    const cmds = Object.fromEntries(page.commands().map((c) => [c.id, c]));
    cmds['next-in-album'].run();
    assert.strictEqual(leaf.view.file.basename, 'Cooperation', 'the command opens in the same page');
    assert.strictEqual(R.stepInAlbum(plugin, leaf.view.file, 'next'), true);
    assert.strictEqual(leaf.view.file.basename, 'Deterrence');
    assert.strictEqual(R.stepInAlbum(plugin, leaf.view.file, 'next'), false, 'none past the last');
    // The page pinned: not replaced — a row, a tile and the command open where Obsidian would, a new tab.
    leaf.view.file = file;
    leaf.getViewState = () => ({ type: 'markdown', pinned: true });
    const opened = [];
    other.openFile = (f) => opened.push(f.basename);
    click(sizer.querySelector('.dr-note-step.is-next'));
    click(tile);
    cmds['next-in-album'].run();
    assert.deepStrictEqual(opened, ['Cooperation', name, 'Cooperation']);
    assert.strictEqual(leaf.view.file, file, 'the pinned tab keeps its note');
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
    // The step commands are the note page's now, there with the strip off.
    plugin.settings.notePage = true;
    const cmds = Object.fromEntries(new R.NotePage(plugin).commands().map((c) => [c.id, c]));
    assert.deepStrictEqual(strip.commands(), [], 'none of the strip’s own');
    assert.strictEqual(cmds['next-in-album'].check(), true);
    cmds['next-in-album'].run();
    assert.strictEqual(leaf.view.file.basename, 'Deterrence');
    assert.strictEqual(cmds['next-in-album'].check(), false, 'offered past the last note');
    // Only what's needed shown until it's pointed at: Properties and More always, the rest waiting.
    const secondary = Array.from(strip.el.querySelectorAll('.dr-strip-actions .is-secondary')).map((b) => b.dataset.action);
    assert.deepStrictEqual(secondary, ['mode', 'pin']);
    // A narrow window doesn't move them into More: what counts is the pane's own width, and a narrow
    // pane only turns the strip into a sheet.
    app.workspace.trigger = () => {};
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
    strip.update();
    assert.ok(!strip.el.classList.contains('is-sheet'));
    assert.deepStrictEqual(Array.from(strip.el.querySelectorAll('.dr-strip-actions .is-secondary')).map((b) => b.dataset.action), ['mode', 'pin']);
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    strip.update();
    assert.ok(strip.el.classList.contains('is-sheet'), 'under 480px, a sheet');
    // The ··· menu, short: Read, Properties, Pin, … on top; Obsidian's own under More.
    click(strip.el.querySelector('[data-action="more"]'));
    const titles = menus[menus.length - 1].items.map((i) => i.title);
    assert.deepStrictEqual(titles.slice(0, 3), ['Read', 'Properties', 'Pin']);
    assert.ok(titles.includes('Delete') && titles[titles.length - 1] !== 'Read');
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    // An album's page, or any screen that isn't a note: no strip, and no room kept for it.
    const { view } = setup();
    Object.assign(view, { app, plugin });
    leaf.view = view;
    strip.update();
    assert.ok(strip.el.classList.contains('is-empty') && strip.el.children.length === 0);
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

  await t('a collection with no folder note says what it is, kept by the plugin; what it lists follows renames and deletes', async () => {
    const { v, plugin, app, view } = setup();
    plugin.folderNote = () => null;
    plugin.ensureFolderNote = async () => { throw new Error('no folder note is made'); };
    plugin.saveData = async () => {};
    const structure = new R.AlbumStructure(plugin);
    structure.enabled = true;
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    v.folder('Elsewhere');
    const sov = v.file('Elsewhere/Sovereignty.md');
    const ir = () => app.vault.getFolderByPath('IR') || app.vault.getFolderByPath('Relations');
    await structure.setType(ir(), 'project');
    await structure.setField(ir(), 'description', 'How states deal with each other.');
    await structure.setLayout(ir(), 'covers');
    await structure.include(ir(), sov);
    let info = structure.info(ir());
    assert.deepStrictEqual([info.type, info.description, info.layout, info.includes], ['project', 'How states deal with each other.', 'covers', [sov]]);
    assert.ok(info.kept && !info.note);
    assert.deepStrictEqual(structure.gathering(), [ir()], 'found as a collection that takes notes in, with no note');
    assert.deepStrictEqual(structure.ofKind('project'), [ir()]);
    view.render();
    await app.fileManager.renameFile(sov, 'Elsewhere/Sovereignty and power.md');
    assert.deepStrictEqual(plugin.settings.albums.IR.includes, ['Elsewhere/Sovereignty and power.md'], 'the note renamed: followed');
    await app.fileManager.renameFile(ir(), 'Relations');
    assert.ok(plugin.settings.albums.Relations && !plugin.settings.albums.IR, 'the folder renamed: followed');
    await app.fileManager.trashFile(app.vault.getFileByPath('Elsewhere/Sovereignty and power.md'));
    assert.ok(!('includes' in plugin.settings.albums.Relations), 'the note gone: off the list');
    info = structure.info(ir());
    assert.strictEqual(info.type, 'project', 'the rest kept');
    // A name that leads nowhere, kept by the plugin: taken off from the notice.
    plugin.settings.albums.Relations.related = ['Nowhere'];
    assert.deepStrictEqual(structure.info(ir()).missing.map((m) => m.name), ['Nowhere']);
    await structure.dropMissing(ir());
    assert.ok(!('related' in plugin.settings.albums.Relations));
  });

  await t('a folder takes the image set for it, kept by its path with no note; it follows renames and goes with deletes', async () => {
    const { v, plugin, app } = setup();
    app.vault.getResourcePath = (f) => `app://${f.path}`;
    plugin.folderNote = () => null;
    plugin.refreshBrowse = () => {};
    plugin.saveData = async () => {};
    plugin.ensureFolderNote = async () => { throw new Error('no folder note is made'); };
    const covers = new R.CoverImages(plugin);
    const ir = () => app.vault.getFolderByPath('IR') || app.vault.getFolderByPath('Relations');
    v.folder('Pictures');
    const pic = v.file('Pictures/view.png');
    v.file('IR/zebra.png');
    v.file('IR/apple.png');
    plugin.settings.coverFromFirstImage = false;
    assert.strictEqual(covers.folderCoverSrc(ir()), null, 'no cover yet: nothing');
    plugin.settings.coverFromFirstImage = true;
    assert.strictEqual(covers.folderCoverSrc(ir()), 'app://IR/apple.png', 'the first image in it, where the setting has it');
    v.file('IR/cover.jpg');
    assert.strictEqual(covers.folderCoverSrc(ir()), 'app://IR/cover.jpg', 'one called cover before that');
    await covers.setFolderImage(ir(), pic);
    assert.deepStrictEqual(plugin.settings.folderCovers, { IR: 'Pictures/view.png' });
    assert.strictEqual(covers.folderCoverSrc(ir()), 'app://Pictures/view.png', 'the one set comes first');
    await app.fileManager.renameFile(pic, 'Pictures/vista.png');
    assert.strictEqual(covers.folderCoverSrc(ir()), 'app://Pictures/vista.png', 'the image renamed: followed');
    await app.fileManager.renameFile(ir(), 'Relations');
    assert.deepStrictEqual(plugin.settings.folderCovers, { Relations: 'Pictures/vista.png' }, 'the folder renamed: followed');
    await app.fileManager.trashFile(app.vault.getFileByPath('Pictures/vista.png'));
    assert.deepStrictEqual(plugin.settings.folderCovers, {}, 'the image gone: the cover goes');
    await covers.setFolderImage(ir(), v.file('Pictures/other.png'));
    await covers.clearFolderCover(ir());
    assert.deepStrictEqual(plugin.settings.folderCovers, {}, 'removed');
  });

  await t("an image dropped on an album's cover becomes its cover, no folder note made; one from outside is saved first", async () => {
    const image = new TFile('Pictures/view.png');
    const set = [];
    const froms = [];
    const saved = [];
    const plugin = {
      settings: { coverDrop: true },
      app: {
        dragManager: { draggable: { type: 'file', file: image } },
        vault: {
          getFolderByPath: (p) => (p === 'Law' ? new TFolder('Law') : null),
          createBinary: async (p) => { saved.push(p); return new TFile(p); },
        },
        fileManager: { getAvailablePathForAttachment: async (name, from) => { froms.push(from); return `Attachments/${name}`; } },
      },
      ensureFolderNote: async () => { throw new Error('no folder note is made'); },
      capability: (n) => (n === 'covers' ? { setFolderImage: async (folder, img) => set.push([folder.path, img.path]) } : null),
    };
    const drop = new R.CoverDrop(plugin);
    const art = document.body.createDiv();
    art.dataset.coverFolder = 'Law';
    const event = (files) => ({ target: art, dataTransfer: { files, types: ['Files'] }, preventDefault() { this.prevented = true; }, stopPropagation() {} });
    const fromVault = event([]);
    await drop.onDrop(fromVault);
    assert.ok(fromVault.prevented);
    assert.deepStrictEqual(set, [['Law', 'Pictures/view.png']]);
    // From outside the vault: saved as an attachment, then linked.
    plugin.app.dragManager = { draggable: null };
    const blob = { name: 'photo.jpg', type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(4) };
    await drop.onDrop(event([blob]));
    assert.deepStrictEqual(saved, ['Attachments/photo.jpg']);
    assert.deepStrictEqual(set[1], ['Law', 'Attachments/photo.jpg']);
    assert.deepStrictEqual(froms, ['Law/Law.md'], 'saved where attachments go for a note in the folder');
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

  await t('the Apple look: an album page has one filled Open, Edit in plain text, Random under an icon-only More', async () => {
    const { view } = setup();
    document.body.addClass('dr-look-apple');
    try {
      view.render();
      const actions = Array.from(view.contentEl.querySelectorAll('.dr-detail-actions > *'));
      assert.deepStrictEqual(actions.map((b) => b.textContent), ['Open', 'Edit', '']);
      assert.strictEqual(view.contentEl.querySelectorAll('.dr-detail-actions .is-primary').length, 1);
      const more = view.contentEl.querySelector('.dr-detail-more');
      assert.strictEqual(more.getAttribute('aria-label'), 'More');
    } finally {
      document.body.removeClass('dr-look-apple');
    }
  });

  await t("a folder in a tab's path opens its collection in the library, not the file explorer", async () => {
    assert.strictEqual(R.crumbFolderPath('Concepts Folder/Philosophy Concepts/Philosophical position.md', 1, 2), 'Concepts Folder/Philosophy Concepts');
    assert.strictEqual(R.crumbFolderPath('Concepts Folder/Philosophy Concepts/Philosophical position.md', 0, 2), 'Concepts Folder');
    assert.strictEqual(R.crumbFolderPath('A/B/C/Note.md', 0, 2), null, 'a shortened path is left to Obsidian');
    assert.strictEqual(R.crumbFolderPath('Note.md', 0, 0), null);
    const { app } = setup();
    const leafEl = document.body.createDiv({ cls: 'workspace-leaf' });
    const parent = leafEl.createDiv({ cls: 'view-header-title-parent' });
    parent.createSpan({ cls: 'view-header-breadcrumb', text: 'IR' });
    const file = app.vault.getFileByPath('IR/Balance.md');
    app.workspace.iterateAllLeaves = (fn) => fn({ containerEl: leafEl, view: { file } });
    const went = [];
    const lib = Object.create(R.Library.prototype, { app: { value: app }, enabled: { value: true }, browseMode: { value: (st) => went.push(st) } });
    let stopped = false;
    const evt = { button: 0, target: parent.firstChild, preventDefault() {}, stopPropagation() { stopped = true; } };
    lib.openCrumb(evt);
    assert.deepStrictEqual(went, [{ mode: 'folder', path: 'IR' }]);
    assert.ok(stopped, 'Obsidian does not also reveal it in the file explorer');
    lib.openCrumb(Object.assign({}, evt, { metaKey: true }));
    assert.strictEqual(went.length, 1, 'a modified click is still Obsidian’s');
    leafEl.remove();
  });

  /* -- Home ----------------------------------------------------------------- */

  const f = (app, p) => app.vault.getFileByPath(p);
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
    // On a card, as a shelf draws one: notes aren't covers on any screen of their own.
    view.render = () => {
      view.contentEl.empty();
      const grid = view.contentEl.createDiv({ cls: 'dr-grid' });
      plugin.recentFiles().forEach((file) => view.fileCard(grid, file));
    };
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
    assert.deepStrictEqual(text('.dr-shelf-title'), ['Recently opened', 'Recently added', 'Rediscover', 'Folders']);
    click(view.contentEl.querySelector('.dr-pick[data-path="IR/Balance.md"]'));
    assert.strictEqual(opened[0].basename, 'Balance');
  });

  await t("Home's shelves: your collections, and the shelves you chose in the order you chose", async () => {
    const { v, view, plugin, app } = setup();
    const notes = R.albumSequence(plugin, f(app, 'IR/Balance.md'));
    plugin.recentFiles = () => [notes[1]];
    await view.setState({ mode: 'home' }, {});
    const shelf = (title) => {
      const head = Array.from(view.contentEl.querySelectorAll('.dr-shelf-head')).find((h) => h.textContent.includes(title));
      return head ? head.nextElementSibling : null;
    };
    const cards = (title) => Array.from(shelf(title).querySelectorAll('.dr-card')).map((c) => `${c.querySelector('.dr-card-title').textContent} · ${(c.querySelector('.dr-card-sub') || {}).textContent}`);
    assert.strictEqual(shelf('Continue reading'), null, 'nothing about where you were reading');


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
    assert.deepStrictEqual(R.homeShelves(plugin.settings).map((s) => `${s.id}:${s.on}`), ['folders:true', 'picks:false', 'recents:true', 'added:true', 'collections:true', 'pinned:true', 'rediscover:true']);
    plugin.settings.homeShelves = HOME_OFF.map((id) => ({ id, on: false })).concat([{ id: 'folders', on: true }, { id: 'recents', on: true }]);
    await view.setState({ mode: 'home' }, {});
    const titles = Array.from(view.contentEl.querySelectorAll('.dr-shelf-title')).map((e) => e.textContent);
    assert.deepStrictEqual(titles, ['Folders', 'Recently opened']);
    assert.ok(!view.contentEl.querySelector('.dr-pick'), 'the large cards were turned off');
  });

  await t('the inspector: while it shows, a click in the library picks and a double click or Enter opens; the library tells it what a pick is', async () => {
    const { view, plugin, app, opened } = setup();
    plugin.selection = new R.Selection(plugin);
    view.unpick = plugin.selection.onChange(() => view.markPicked());
    // The inspector's tab, in the right sidebar.
    const tabs = [];
    const tab = { view: { containerEl: document.body.createDiv() }, detach: () => tabs.splice(0) };
    tab.setViewState = async () => tabs.push(tab);
    Object.assign(app.workspace, {
      getLeavesOfType: (type) => (type === 'design-redux-properties' ? tabs : []),
      getRightLeaf: () => tab,
      revealLeaf() {},
    });
    const row = (name) => view.contentEl.querySelector(`.dr-track[data-path="IR/${name}.md"]`);
    view.render();
    click(row('Anarchy'));
    assert.strictEqual(opened.length, 1, 'without it, a click opens as it always has');

    // Shown with the button by Sort and filter.
    plugin.refreshBrowse = () => view.render();
    click(view.contentEl.querySelector('.dr-preview-btn'));
    await new Promise((r) => setTimeout(r));
    assert.strictEqual(tabs.length, 1, 'the inspector opened');
    assert.ok(view.contentEl.querySelector('.dr-preview-btn').classList.contains('is-active'));
    assert.ok(!view.containerEl.querySelector('.dr-preview'), 'no pane of its own: the inspector shows it');
    click(row('Balance'));
    assert.strictEqual(opened.length, 1, 'while it shows, a click picks');
    assert.ok(row('Balance').classList.contains('is-selected'));
    assert.strictEqual(plugin.selection.get().file.basename, 'Balance');

    row('Balance').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.strictEqual(opened[1].basename, 'Balance', 'a double click opens');
    row('Cooperation').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.strictEqual(opened[2].basename, 'Cooperation', 'Enter opens');

    // What a note picked here can do, in the inspector.
    const buttons = (el) => Array.from(el.querySelectorAll('.dr-detail-action')).map((b) => b.textContent);
    let el = document.createElement('div');
    view.inspectNoteActions(el, app.vault.getFileByPath('IR/Balance.md'));
    assert.deepStrictEqual(buttons(el), ['Open', 'More'], 'already in its collection: nothing to reveal');
    // Elsewhere, it can take you to the note's album, still picked there.
    const went = [];
    view.leaf.setViewState = async (st) => went.push(st.state);
    await view.setState({ mode: 'recents' }, {});
    el = document.createElement('div');
    view.inspectNoteActions(el, app.vault.getFileByPath('IR/Theories/Realism.md'));
    assert.deepStrictEqual(buttons(el), ['Open', 'Reveal in collection', 'More']);
    click(Array.from(el.querySelectorAll('.dr-detail-action')).find((b) => b.textContent === 'Reveal in collection'));
    assert.deepStrictEqual([went[0].mode, went[0].path], ['folder', 'IR/Theories']);
    assert.strictEqual(plugin.selection.get().file.basename, 'Realism');

    // An album: what kind, what it holds, where it is.
    await view.setState({ mode: 'folders' }, {});
    click(view.contentEl.querySelector('.dr-card[data-path="IR"]'));
    assert.strictEqual(plugin.selection.get().folder.path, 'IR');
    el = document.createElement('div');
    view.previewAlbum(el, app.vault.getFolderByPath('IR'));
    assert.deepStrictEqual(['.dr-preview-title', '.dr-preview-lead'].map((sel) => el.querySelector(sel).textContent), ['IR', 'Collection']);
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-preview-label')).map((e) => e.textContent), ['Holds', 'In']);

    // Space on a note's row: a look at it, Obsidian's page preview; on an album, nothing.
    const looked = [];
    const trigger = app.workspace.trigger;
    app.workspace.trigger = (name, info) => (name === 'hover-link' ? looked.push(info) : trigger && trigger.call(app.workspace, name, info));
    const noteRow = document.createElement('div');
    noteRow.dataset.path = 'IR/Balance.md';
    let stopped = 0;
    view.onKey({ key: ' ', target: noteRow, preventDefault: () => stopped++ });
    view.onKey({ key: ' ', target: view.contentEl.querySelector('.dr-card[data-path="IR"]'), preventDefault: () => stopped++ });
    app.workspace.trigger = trigger;
    assert.deepStrictEqual([looked.length, looked[0].linktext, looked[0].source, stopped], [1, 'IR/Balance.md', 'design-redux-library', 1]);

    view.onKey({ key: 'Escape', target: view.contentEl, preventDefault() {} });
    assert.strictEqual(plugin.selection.get(), null, 'Escape lets go');
    plugin.selection.set({ folder: app.vault.getFolderByPath('IR') });
    plugin.selection.followDelete(app.vault.getFolderByPath('IR'));
    assert.strictEqual(plugin.selection.get(), null, 'gone, no longer picked');

    // Set always to open; and closed again, what's picked stays picked.
    plugin.settings.inspectorClick = 'never';
    await view.setState({ mode: 'folder', path: 'IR' }, {});
    click(row('Deterrence'));
    assert.strictEqual(opened[3].basename, 'Deterrence', 'set always to open');
    plugin.selection.set({ folder: app.vault.getFolderByPath('IR/Theories') });
    await view.togglePreview();
    assert.ok(tabs.length === 0 && plugin.selection.get().folder.path === 'IR/Theories');
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
    // Notes are never covers, whatever the setting holds.
    plugin.settings.libraryLayout = 'covers';
    await view.setState({ mode: 'recents' }, {});
    assert.ok(!view.contentEl.querySelector('.dr-card'));
    assert.ok(view.contentEl.querySelector('.dr-collection-tracks .dr-track'));
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
    assert.ok(titles.includes('View as list') && titles.includes('View as table') && !titles.includes('View as covers'));
    assert.strictEqual(menu.items.find((i) => i.title === 'View as list').checked, true);
    menu.items.find((i) => i.title === 'View as table').click();
    await settle(0);
    assert.deepStrictEqual(set, [['IR', 'table']]);
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
    const rows = Array.from(view.contentEl.querySelectorAll('.dr-track-name')).map((e) => e.textContent);
    assert.deepStrictEqual(rows.slice(0, 2), ['Balance', 'Realism'], 'newest first');

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
    plugin.settings.libraryCheck = false;
    const sections = library.defaultSections();
    // As a music app's sidebar: places to start, the Library, Tools, Views; nothing folded away.
    assert.deepStrictEqual(sections.map((s) => s.title).slice(0, 4), ['', 'Library', 'Tools', 'Views']);
    assert.deepStrictEqual(sections[0].items.map((i) => i.id), ['search', 'home', 'random']);
    assert.deepStrictEqual(sections[1].items.map((i) => i.id), ['bookmarks', 'added', 'recents', 'folders', 'notes', 'properties', 'subjects'], 'Subjects offered once there is one');
    assert.ok(sections.every((s) => typeof s.folded !== 'boolean'));
    plugin.settings.libraryCheck = true;
    const checked = library.defaultSections();
    assert.deepStrictEqual(checked[0].items.map((i) => i.id), ['search', 'home', 'inbox', 'random'], 'the Inbox where the library check is on');
    assert.deepStrictEqual(checked[2].items.map((i) => i.id), ['graph', 'library-check', 'settings']);
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
    // A folder note that still says concept map keeps its word, as any kind of its own, and opens no map.
    fms.get(note).album = 'concept map';
    view.render();
    assert.ok(!action(view, 'Map'));
    fms.get(note).album = 'Project';
    // Further down: the way back up, and no lone parent link under the title.
    Object.assign(view, { path: 'IR/Theories' });
    view.render();
    assert.deepStrictEqual(text('.dr-detail-title'), ['Theories']);
    assert.deepStrictEqual(text('.dr-crumb'), ['IR']);
    assert.ok(!view.contentEl.querySelector('.dr-detail-sub.is-link'));
    // On its tile, its kind.
    Object.assign(view, { path: '/' });
    view.render();
    assert.deepStrictEqual(text('.dr-card[data-path="IR"] .dr-card-kind'), ['Project']);
    // A note shown in another album too: listed in its includes, left where it is.
    let written = null;
    app.fileManager.processFrontMatter = async (file, fn) => { const fm = Object.assign({}, fms.get(file)); fn(fm); written = [file, fm]; };
    fms.set(law, {});
    assert.strictEqual(await structure.include(v.vault.getFolderByPath('Law'), sov), true);
    assert.deepStrictEqual(plugin.settings.albums.Law, { includes: ['Elsewhere/Sovereignty.md'] }, 'kept by the plugin, by path');
    assert.strictEqual(written, null, 'no note written');
    assert.strictEqual(await structure.include(v.vault.getFolderByPath('IR'), sov), false, 'there already');
    // Kind set and taken away from the menu's way in: what the folder note said carried over first, the note left as it was.
    await structure.setType(v.vault.getFolderByPath('IR'), 'subject');
    assert.strictEqual(plugin.settings.albums.IR.type, 'subject');
    assert.strictEqual(plugin.settings.albums.IR.description, 'How states deal with each other.');
    assert.deepStrictEqual(plugin.settings.albums.IR.related, ['Treaties'], 'a folder note stands for its folder');
    assert.strictEqual(fms.get(note).album, 'Project', 'the note untouched');
    await structure.setType(v.vault.getFolderByPath('IR'), '');
    assert.ok(!('type' in plugin.settings.albums.IR));
    assert.strictEqual(written, null);
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

  await t('inside an album: notes to start with, a list or covers, no tabs, and why it’s empty', async () => {
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
    // Kept by the plugin from here on: what the note said carried over, the note left as it was.
    const kept = () => plugin.settings.albums.IR;
    await structure.toggleFeatured(v.vault.getFolderByPath('IR'), v.vault.getFileByPath('IR/Balance.md'));
    assert.ok(!('featured' in kept()), 'an empty list is taken away');
    assert.strictEqual(kept().type, 'project');
    await structure.toggleFeatured(v.vault.getFolderByPath('IR'), v.vault.getFileByPath('IR/Anarchy.md'));
    assert.deepStrictEqual(kept().featured, ['IR/Anarchy.md']);
    assert.strictEqual(written, null, 'no note written');
    // As covers: a heading and tiles for each disc.
    await structure.setLayout(v.vault.getFolderByPath('IR'), 'covers');
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-track[data-path]'));
    assert.deepStrictEqual(text('.dr-covers-head .dr-disc-title'), ['IR', 'Theories']);
    assert.ok(view.contentEl.querySelector('.dr-grid .dr-card[data-path="IR/Anarchy.md"]'));
    // Overview and map have gone: a folder note that still says so opens as a list, as asked for nothing.
    ['overview', 'map'].forEach((layout) => {
      kept().layout = layout;
      view.render();
      assert.ok(view.contentEl.querySelector('.dr-track[data-path]'), `${layout} opens as a list`);
      assert.ok(!view.contentEl.querySelector('.dr-album-lead'));
    });
    await structure.setLayout(v.vault.getFolderByPath('IR'), 'list');
    assert.ok(!('layout' in kept()), 'a list is how it opens anyway');
    assert.deepStrictEqual(R.ALBUM_LAYOUTS.map((l) => l.id), ['list', 'covers', 'table']);
    // A long album with links out, a map and folders inside: no tabs for any of it, and no word of its sub-collections.
    for (let i = 0; i < 10; i++) v.file(`IR/Extra ${i}.md`);
    v.file('IR/IR map.canvas');
    plugin.recentFiles = () => [v.vault.getFileByPath('IR/Extra 3.md'), v.vault.getFileByPath('IR/Anarchy.md')];
    app.metadataCache.unresolvedLinks = { 'IR/Anarchy.md': { Hegemony: 1 } };
    fms.set(v.vault.getFileByPath('IR/Extra 2.md'), { status: 'Open' });
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-album-panels'), 'just its notes');
    assert.ok(!text('.dr-detail-meta')[0].includes('sub-collection'));
    assert.deepStrictEqual(text('.dr-detail-title'), ['IR'], 'a folder’s page keeps its title');
    // A source among them: still just its notes, no tabs.
    fms.set(v.vault.getFileByPath('IR/Extra 1.md'), { author: 'Waltz' });
    view.render();
    assert.ok(!view.contentEl.querySelector('.dr-album-panels, .dr-panel-tab'), 'no Sources tab');
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
    assert.deepStrictEqual(plugin.settings.albums.IR.includes, ['Loose one.md', 'Loose two.md'], 'kept by the plugin, by path');
    assert.deepStrictEqual(fms.get(irNote), {}, 'the folder note untouched');
    view.render();
    assert.deepStrictEqual(rows(), [], 'shown in a collection: in one');
    assert.strictEqual(one.path, 'Loose one.md', 'left where it is');
    await undo();
    assert.ok(!plugin.settings.albums.IR, 'put back as it was');
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
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    app.metadataCache.getFirstLinkpathDest = (name) => v.vault.getMarkdownFiles().find((f) => f.basename === name) || null;
    plan = refactor.planMerge(folder('IR/Theories'), folder('Law'));
    assert.ok(plan.warnings.some((w) => w.includes('“Realism.md” is in both')));
    assert.ok(plan.lines.some((l) => l.includes('Its includes, related join Law’s')), plan.lines.join(' | '));
    await refactor.perform(plan);
    assert.ok(!folder('IR/Theories'), 'the empty folder is gone');
    assert.ok(file('Law/Realism 1.md') && file('Law/Liberalism.md') && file('Law/Theories.md'));
    const law = () => plugin.settings.albums.Law;
    assert.deepStrictEqual(law().related, ['Courts', 'Power'], 'joined, kept by the plugin');
    assert.deepStrictEqual(law().includes, ['IR/Anarchy.md'], 'not the collection it went into');
    assert.strictEqual(law().description, 'Rules.', 'its own description kept');
    assert.deepStrictEqual(fms.get(lawNote), { description: 'Rules.', related: ['[[Courts]]'] }, 'Law’s folder note untouched');
    assert.ok(!('album' in fms.get(theoriesNote)), 'a note like the rest: not saying it’s a collection');
    await undo();
    assert.ok(file('IR/Theories/Realism.md') && file('IR/Theories/Liberalism.md') && file('IR/Theories/Theories.md'));
    assert.ok(file('Law/Realism.md') && !file('Law/Realism 1.md'));
    assert.ok(!plugin.settings.albums.Law, 'put back as it was');
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

  await t('levels and views: a collection says so and can open as a tree; an album as a table; covers numbered; property names of your own', async () => {
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
    assert.ok(!view.contentEl.querySelector('.dr-table .dr-th'), 'no row of column names in a folder’s table');
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

  await t('actions: a place prefixes the palette name, never the id; a home says which surface shows it beyond the palette', () => {
    assert.strictEqual(R.placedName('Mark to revisit', 'Note'), 'Note: Mark to revisit');
    assert.strictEqual(R.placedName('Note: Mark', 'Note'), 'Note: Mark', 'not twice');
    assert.strictEqual(R.placedName('Anything', null), 'Anything');
    const cmds = R.actionCommands([{ id: 'x', name: 'Do x', run() {} }, { id: 'y', name: 'Do y', place: 'Tools', run() {} }], () => ({}), 'Library');
    assert.deepStrictEqual(cmds.map((c) => [c.id, c.name]), [['x', 'Library: Do x'], ['y', 'Tools: Do y']]);
    assert.strictEqual(R.featurePlace(new R.NotePage({ settings: {}, app: {} })), 'Note');
    const btn = document.createElement('div');
    btn.createSpan = (o) => { const e = document.createElement('span'); if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; btn.appendChild(e); return e; };
    R.iconWord(btn, 'clock', 'Length');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Length', 'the word is the tooltip');
    assert.strictEqual(btn.querySelector('.dr-icon-label').textContent, 'Length', 'and a span the setting can drop');
    assert.ok(btn.querySelector('.dr-icon-glyph'));
    const acts = [{ id: 'a' }, { id: 'b', menu: false }, { id: 'c', home: 'strip' }, { id: 'd', home: 'panel' }];
    assert.deepStrictEqual(acts.map((a) => R.homeOf(a)), ['menu', 'palette', 'strip', 'panel']);
    assert.deepStrictEqual(R.menuActions(acts, {}).map((a) => a.id), ['a'], 'menus show what lives on menus');
    assert.deepStrictEqual(R.menuActions(acts, {}, 'strip').map((a) => a.id), ['c']);
  });

  await t('appearance: density and the look as classes on the page, canvas spacing as a scale; a command for each; gone when unloaded', async () => {
    const { plugin } = setup();
    const look = new R.Appearance(plugin);
    plugin.feature = (C) => (C === R.Appearance ? look : null);
    const has = (c) => document.body.classList.contains(c);
    look.enable();
    assert.ok(!has('dr-density-compact') && !has('dr-density-spacious') && !has('dr-look-editorial'), 'standard');
    assert.ok(has('dr-look-apple') && !has('dr-note-apple'), 'Apple by default, on what the plugin draws; notes as the theme draws them');
    plugin.settings.lookScope = 'window';
    look.enable();
    assert.ok(has('dr-look-apple') && has('dr-note-apple'), 'the whole window, when asked');
    plugin.settings.lookScope = 'window';
    plugin.settings.gridDensity = 'large';
    look.enable();
    assert.ok(has('dr-density-spacious'));
    const cmds = Object.fromEntries(look.commands().map((c) => [c.id, c]));
    cmds['switch-look'].run();
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(plugin.settings.look, 'theme');
    assert.ok(!has('dr-look-apple') && !has('dr-note-apple'), 'the theme’s look: none of it');
    plugin.settings.look = 'editorial';
    look.enable();
    assert.ok(has('dr-look-editorial'));
    // The editorial look on the whole window, or on Design Redux only.
    assert.ok(!has('dr-look-scoped'));
    plugin.settings.lookScope = 'plugin';
    look.enable();
    assert.ok(has('dr-look-editorial') && has('dr-look-scoped'));
    look.disable();
    assert.ok(!has('dr-density-spacious') && !has('dr-look-editorial') && !has('dr-look-scoped') && !has('dr-look-apple'), 'nothing left behind');
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

  await t('the note panel: the albums and canvases a note is in', async () => {
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
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const panel = { plugin, close() {} };
    const host = document.body.createDiv();

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

  await t('what a collection comes to: how many done and a date property’s span, under its title and beside it in a list', () => {
    const { v, plugin, app, view } = setup();
    const structure = new R.AlbumStructure(plugin);
    plugin.feature = (C) => (C === R.AlbumStructure ? structure : null);
    const fms = { Anarchy: { status: 'Done', due: '2026-03-03' }, Balance: { done: true, due: '2026-04-12' }, Cooperation: { status: 'Doing', due: '2026-03-20' } };
    app.metadataCache.getFileCache = (f) => ({ frontmatter: fms[f.basename] || {} });
    const meta = () => view.contentEl.querySelector('.dr-detail-meta').textContent;
    view.render();
    assert.ok(!/done/.test(meta()), 'off by default');
    Object.assign(plugin.settings, { albumRollups: true, rollupDateKey: 'due' });
    view.render();
    const span = `due ${new Date('2026-03-03T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date('2026-04-12T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    assert.ok(meta().includes(`2 of 6 done  ·  ${span}`), meta());
    assert.strictEqual(structure.rollupText(structure.rollup(structure.notesUnder(v.vault.getAbstractFileByPath('IR')))), `2 of 6 done  ·  ${span}`);
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
