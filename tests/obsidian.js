/*
 * Obsidian, stood in for: the part of its API the plugin uses, over an
 * in-memory vault and a jsdom window. One stand-in for every suite, so a
 * suite says what it tests and not what Obsidian is. `tests/harness.js` puts
 * this where the bundle asks for 'obsidian'.
 */
const yaml = require('js-yaml');

class Events {
  constructor() { this._on = {}; }
  on(name, fn, ctx) { (this._on[name] || (this._on[name] = [])).push({ fn, ctx }); return { name, fn, from: this }; }
  off(name, fn) { this._on[name] = (this._on[name] || []).filter((h) => h.fn !== fn); }
  offref(ref) { if (ref) ref.from.off(ref.name, ref.fn); }
  trigger(name, ...args) { (this._on[name] || []).slice().forEach((h) => h.fn.apply(h.ctx, args)); }
}

class TAbstractFile {
  constructor(path, vault) { this.vault = vault; this.setPath(path); }
  setPath(path) { this.path = path; this.name = path.split('/').pop(); this.parent = null; }
}
class TFile extends TAbstractFile {
  setPath(path) {
    super.setPath(path);
    const dot = this.name.lastIndexOf('.');
    this.extension = dot > 0 ? this.name.slice(dot + 1) : '';
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.stat = this.stat || { ctime: 1, mtime: 1, size: 0 };
  }
}
class TFolder extends TAbstractFile {
  constructor(path, vault) { super(path, vault); this.children = []; }
  isRoot() { return this.path === '/'; }
}

const normalizePath = (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || '/';
const parentPath = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/');

class Vault extends Events {
  constructor(files) {
    super();
    this.items = new Map();
    this.text = new Map();
    this.root = new TFolder('/', this);
    this.items.set('/', this.root);
    this.clock = 10;
    this.adapter = {
      files: new Map(),
      exists: async (p) => this.adapter.files.has(p) || this.items.has(p),
      read: async (p) => this.adapter.files.get(p),
      write: async (p, data) => void this.adapter.files.set(p, data),
      remove: async (p) => void this.adapter.files.delete(p),
    };
    this.configDir = '.obsidian';
    Object.keys(files || {}).forEach((p) => this._add(p, files[p]));
  }
  _folder(path) {
    if (this.items.has(path)) return this.items.get(path);
    const folder = new TFolder(path, this);
    this.items.set(path, folder);
    this._attach(folder);
    return folder;
  }
  _attach(item) {
    const parent = this._folder(parentPath(item.path));
    item.parent = parent;
    if (!parent.children.includes(item)) parent.children.push(item);
  }
  _add(path, text) {
    const file = new TFile(path, this);
    file.stat = { ctime: this.clock, mtime: this.clock++, size: String(text).length };
    this.items.set(path, file);
    this.text.set(path, String(text));
    this._attach(file);
    return file;
  }
  getRoot() { return this.root; }
  getName() { return 'Seminar'; }
  getAbstractFileByPath(p) { return this.items.get(normalizePath(p)) || null; }
  getFileByPath(p) { const f = this.getAbstractFileByPath(p); return f instanceof TFile ? f : null; }
  getFolderByPath(p) { const f = this.getAbstractFileByPath(p); return f instanceof TFolder ? f : null; }
  getAllLoadedFiles() { return Array.from(this.items.values()); }
  getFiles() { return this.getAllLoadedFiles().filter((f) => f instanceof TFile); }
  getMarkdownFiles() { return this.getFiles().filter((f) => f.extension === 'md'); }
  getAllFolders() { return this.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path !== '/'); }
  async read(file) { return this.text.get(file.path); }
  async readBinary(file) { return new TextEncoder().encode(this.text.get(file.path)).buffer; }
  async cachedRead(file) { return this.text.get(file.path); }
  async create(path, text = '') {
    path = normalizePath(path);
    if (this.items.has(path)) throw new Error(`File already exists: ${path}`);
    const file = this._add(path, text);
    this.trigger('create', file);
    return file;
  }
  async createBinary(path, data) { return this.create(path, `binary:${data.byteLength || 0}`); }
  async createFolder(path) {
    path = normalizePath(path);
    if (this.items.has(path)) throw new Error(`Folder already exists: ${path}`);
    const folder = this._folder(path);
    this.trigger('create', folder);
    return folder;
  }
  async modify(file, text) {
    this.text.set(file.path, String(text));
    file.stat.mtime = this.clock++;
    file.stat.size = String(text).length;
    this.trigger('modify', file);
    this.app.metadataCache.trigger('changed', file, text, this.app.metadataCache.getFileCache(file));
    // As Obsidian does: once a change is read, its links are resolved again, and that is said too.
    this.app.metadataCache.trigger('resolve', file);
    this.app.metadataCache.trigger('resolved');
  }
  async process(file, fn) { const next = fn(this.text.get(file.path)); await this.modify(file, next); return next; }
  async rename(item, to) {
    to = normalizePath(to);
    if (this.items.has(to)) throw new Error(`Destination exists: ${to}`);
    const moves = [item].concat(item instanceof TFolder ? this.getAllLoadedFiles().filter((f) => f.path.startsWith(`${item.path}/`)) : []);
    const from = item.path;
    moves.forEach((it) => {
      const old = it.path;
      const next = to + old.slice(from.length);
      this.items.delete(old);
      if (it instanceof TFile) { this.text.set(next, this.text.get(old)); this.text.delete(old); }
      if (it.parent) it.parent.children = it.parent.children.filter((c) => c !== it);
      it.setPath(next);
      this.items.set(next, it);
      it._old = old;
    });
    moves.forEach((it) => this._attach(it));
    moves.forEach((it) => this.trigger('rename', it, it._old));
  }
  async delete(item) {
    const gone = [item].concat(item instanceof TFolder ? this.getAllLoadedFiles().filter((f) => f.path.startsWith(`${item.path}/`)) : []);
    gone.forEach((it) => { this.items.delete(it.path); this.text.delete(it.path); });
    if (item.parent) item.parent.children = item.parent.children.filter((c) => c !== item);
    gone.forEach((it) => this.trigger('delete', it));
  }
  async trash(item) { return this.delete(item); }
}

/** A note's text as Obsidian caches it: frontmatter, headings, links. */
function parseNote(text) {
  const cache = { headings: [], links: [], frontmatterLinks: [] };
  let body = text;
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    try { cache.frontmatter = yaml.load(fm[1]) || {}; } catch (e) { cache.frontmatter = {}; }
    body = text.slice(fm[0].length);
    cache.frontmatterPosition = { start: { line: 0, offset: 0 }, end: { line: fm[0].split('\n').length - 2, offset: fm[0].length } };
    const walk = (key, v) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(key, x));
      if (typeof v === 'string') Array.from(v.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)).forEach((m) => cache.frontmatterLinks.push({ key, link: m[1], original: m[0], displayText: m[2] || m[1] }));
    };
    Object.keys(cache.frontmatter || {}).forEach((k) => walk(k, cache.frontmatter[k]));
  }
  const offset = text.length - body.length;
  let at = offset;
  body.split('\n').forEach((line, i) => {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const lineNo = text.slice(0, at).split('\n').length - 1;
    if (h) cache.headings.push({ level: h[1].length, heading: h[2].trim(), position: { start: { line: lineNo, col: 0, offset: at }, end: { line: lineNo, col: line.length, offset: at + line.length } } });
    Array.from(line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)).forEach((m) => cache.links.push({ link: m[1], original: m[0], displayText: m[2] || m[1], position: { start: { line: lineNo, col: m.index, offset: at + m.index } } }));
    at += line.length + 1;
    void i;
  });
  return cache;
}

class MetadataCache extends Events {
  constructor(app) { super(); this.app = app; }
  getFileCache(file) { const text = this.app.vault.text.get(file.path); return text == null ? null : parseNote(text); }
  getCache(path) { const f = this.app.vault.getFileByPath(path); return f ? this.getFileCache(f) : null; }
  getFirstLinkpathDest(link, from) {
    const vault = this.app.vault;
    const name = String(link).replace(/\.md$/, '');
    return vault.getFileByPath(`${name}.md`) || vault.getFileByPath(name)
      || vault.getMarkdownFiles().find((f) => f.basename === name.split('/').pop() && (name.includes('/') ? f.path === `${name}.md` : true)) || null;
  }
  _links(resolved) {
    const out = {};
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const cache = this.getFileCache(file);
      const into = (out[file.path] = {});
      cache.links.concat(cache.frontmatterLinks).forEach((l) => {
        const dest = this.getFirstLinkpathDest(l.link, file.path);
        if (resolved && dest) into[dest.path] = (into[dest.path] || 0) + 1;
        if (!resolved && !dest) into[l.link] = (into[l.link] || 0) + 1;
      });
    });
    return out;
  }
  get resolvedLinks() { return this._links(true); }
  get unresolvedLinks() { return this._links(false); }
}

class FileManager {
  constructor(app) { this.app = app; }
  async processFrontMatter(file, fn) {
    const vault = this.app.vault;
    const text = vault.text.get(file.path);
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    const data = fm ? yaml.load(fm[1]) || {} : {};
    fn(data);
    const body = fm ? text.slice(fm[0].length) : text;
    const head = Object.keys(data).length ? `---\n${yaml.dump(data, { lineWidth: -1 })}---\n` : '';
    await vault.modify(file, head + body);
  }
  async renameFile(item, to) { return this.app.vault.rename(item, to); }
  async trashFile(item) { return this.app.vault.trash(item); }
  generateMarkdownLink(file, from, sub = '', alias = '') { return `[[${file.path.replace(/\.md$/, '')}${sub}${alias ? `|${alias}` : ''}]]`; }
}

class Component {
  constructor() { this._undo = []; this._children = []; }
  register(fn) { this._undo.push(fn); }
  registerEvent(ref) { this._undo.push(() => ref && ref.from && ref.from.off(ref.name, ref.fn)); }
  registerDomEvent(el, type, fn, options) { el.addEventListener(type, fn, options); this._undo.push(() => el.removeEventListener(type, fn, options)); }
  registerInterval(id) { this._undo.push(() => clearInterval(id)); return id; }
  addChild(child) { this._children.push(child); child.load(); return child; }
  removeChild(child) { this._children = this._children.filter((c) => c !== child); child.unload(); }
  load() { if (this.onload) this.onload(); }
  unload() {
    this._children.splice(0).forEach((c) => c.unload());
    if (this.onunload) this.onunload();
    this._undo.splice(0).reverse().forEach((fn) => fn());
  }
}

class WorkspaceLeaf {
  constructor(workspace, side) { this.workspace = workspace; this.side = side; this.view = null; this.containerEl = workspace.doc.createElement('div'); this.containerEl.className = 'workspace-leaf'; workspace.containerEl.appendChild(this.containerEl); }
  getViewState() { return { type: this.view ? this.view.getViewType() : 'empty', state: this.view && this.view.getState ? this.view.getState() : {} }; }
  async setViewState(vs) {
    if (this.view && this.view.onClose) await this.view.onClose();
    while (this.containerEl.firstChild) this.containerEl.removeChild(this.containerEl.firstChild);
    const make = this.workspace.app.viewRegistry[vs.type];
    this.view = make ? make(this) : null;
    if (this.view) {
      this.containerEl.appendChild(this.view.containerEl);
      if (vs.state && this.view.setState) await this.view.setState(vs.state, {});
      if (this.view.onOpen) await this.view.onOpen();
    }
    if (vs.active) this.workspace.setActiveLeaf(this);
    this.workspace.trigger('layout-change');
  }
  async openFile(file) {
    await this.setViewState({ type: file.extension === 'md' ? 'markdown' : file.extension, state: { file: file.path } });
    if (this.view) this.view.file = file;
    this.workspace.lastFile = file;
    this.workspace.setActiveLeaf(this);
    this.workspace.trigger('file-open', file);
  }
  detach() { if (this.view && this.view.onClose) this.view.onClose(); this.containerEl.remove(); this.workspace.leaves = this.workspace.leaves.filter((l) => l !== this); this.workspace.trigger('layout-change'); }
}

class Workspace extends Events {
  constructor(app, doc) { super(); this.app = app; this.doc = doc; this.leaves = []; this.activeLeaf = null; this.layoutReady = true; this.containerEl = doc.createElement('div'); this.containerEl.className = 'workspace'; doc.body.appendChild(this.containerEl); }
  onLayoutReady(fn) { fn(); }
  _leaf(side) { const leaf = new WorkspaceLeaf(this, side); this.leaves.push(leaf); return leaf; }
  getLeaf() { return this.leaves.find((l) => l.side === 'main' && (!l.view || ['markdown', 'empty'].includes(l.view.getViewType()))) || this._leaf('main'); }
  getLeftLeaf() { return this._leaf('left'); }
  getRightLeaf() { return this._leaf('right'); }
  getLeavesOfType(type) { return this.leaves.filter((l) => l.view && l.view.getViewType() === type); }
  iterateAllLeaves(fn) { this.leaves.forEach(fn); }
  iterateRootLeaves(fn) { this.leaves.filter((l) => l.side === 'main').forEach(fn); }
  detachLeavesOfType(type) { this.getLeavesOfType(type).forEach((l) => l.detach()); }
  async revealLeaf(leaf) { this.revealed = leaf; }
  setActiveLeaf(leaf) { this.activeLeaf = leaf; this.trigger('active-leaf-change', leaf); }
  // As in the app: the file of the last pane that held one, whatever has the keyboard since.
  getActiveFile() { const v = this.activeLeaf && this.activeLeaf.view; if (v && v.file) this.lastFile = v.file; return this.lastFile && this.app.vault.getAbstractFileByPath(this.lastFile.path) === this.lastFile ? this.lastFile : null; }
  getActiveViewOfType(Type) { const v = this.activeLeaf && this.activeLeaf.view; return v instanceof Type ? v : null; }
  async openLinkText(link, from) { const file = this.app.metadataCache.getFirstLinkpathDest(link, from) || (await this.app.vault.create(`${link}.md`, '')); await this.getLeaf().openFile(file); }
}

class App {
  constructor(files, doc) {
    this.viewRegistry = { markdown: (leaf) => new MarkdownView(leaf), empty: () => null };
    this.vault = new Vault(files);
    this.vault.app = this;
    this.metadataCache = new MetadataCache(this);
    this.fileManager = new FileManager(this);
    this.workspace = new Workspace(this, doc);
    this.keymap = { scopes: [], pushScope(scope) { this.scopes.push(scope); }, popScope(scope) { this.scopes = this.scopes.filter((x) => x !== scope); } };
    this.commands = { commands: {}, executeCommandById: (id) => { const c = this.commands.commands[id]; if (!c) return false; if (c.checkCallback) return c.checkCallback(false) !== false; if (c.callback) c.callback(); return true; } };
    this.lastEvent = null;
    this.appId = 'a1b2c3d4e5f60718';
    // Obsidian's secret storage (1.11.4) and its per-vault local storage (1.8.7).
    const secrets = new Map();
    this.secretStorage = { getSecret: (id) => secrets.get(id) || null, setSecret: (id, v) => void (v ? secrets.set(id, v) : secrets.delete(id)), listSecrets: () => Array.from(secrets.keys()) };
    const local = new Map();
    this.loadLocalStorage = (k) => (local.has(k) ? JSON.parse(local.get(k)) : null);
    this.saveLocalStorage = (k, v) => void (v == null ? local.delete(k) : local.set(k, JSON.stringify(v)));
  }
}

class View extends Component {
  constructor(leaf) { super(); this.leaf = leaf; this.app = leaf.workspace.app; const d = leaf.workspace.doc; this.containerEl = d.createElement('div'); this.containerEl.className = 'workspace-leaf-content'; }
  getState() { return {}; }
  async setState() {}
}
class ItemView extends View {
  constructor(leaf) { super(leaf); const d = leaf.workspace.doc; this.headerEl = this.containerEl.appendChild(d.createElement('div')); this.headerEl.className = 'view-header'; this.contentEl = this.containerEl.appendChild(d.createElement('div')); this.contentEl.className = 'view-content'; }
  addAction() { return this.headerEl.appendChild(this.headerEl.ownerDocument.createElement('div')); }
}
class MarkdownView extends ItemView {
  constructor(leaf) {
    super(leaf);
    // Laid out as Obsidian lays a note: the editor's sizer holds the inline title, then the text; reading view's sizer a header with the title, the blocks, a footer.
    const div = (parent, cls) => { const n = parent.appendChild(parent.ownerDocument.createElement('div')); n.className = cls; return n; };
    const sizer = div(div(div(div(this.contentEl, 'markdown-source-view cm-s-obsidian mod-cm6'), 'cm-editor'), 'cm-scroller'), 'cm-sizer');
    this.titleEls = [div(sizer, 'inline-title')];
    div(div(sizer, 'cm-contentContainer'), 'cm-content');
    const reading = div(div(div(this.contentEl, 'markdown-reading-view'), 'markdown-preview-view markdown-rendered'), 'markdown-preview-sizer markdown-preview-section');
    this.titleEls.push(div(div(reading, 'mod-header'), 'inline-title'));
    div(reading, 'mod-footer');
  }
  getViewType() { return 'markdown'; }
  getMode() { return this.mode || 'source'; }
  async setState(state) {
    if (state && state.file) this.file = this.app.vault.getFileByPath(state.file);
    if (this.file) this.titleEls.forEach((t) => (t.textContent = this.file.basename));
  }
}

class Plugin extends Component {
  constructor(app, manifest) { super(); this.app = app; this.manifest = manifest || { id: 'design-redux', version: '0.0.0', dir: '.obsidian/plugins/design-redux' }; this._data = null; this.settingTabs = []; this.ribbon = []; }
  async loadData() { return this._data == null ? null : JSON.parse(JSON.stringify(this._data)); }
  async saveData(data) { this._data = JSON.parse(JSON.stringify(data)); }
  addCommand(c) { this.app.commands.commands[`${this.manifest.id}:${c.id}`] = c; this.register(() => delete this.app.commands.commands[`${this.manifest.id}:${c.id}`]); return c; }
  registerView(type, make) { this.app.viewRegistry[type] = make; this.register(() => delete this.app.viewRegistry[type]); }
  addSettingTab(tab) { this.settingTabs.push(tab); }
  addRibbonIcon(icon, title, fn) { const el = this.app.workspace.doc.createElement('div'); this.ribbon.push({ icon, title, fn, el }); return el; }
  registerEditorExtension(ext) { (this.editorExtensions || (this.editorExtensions = [])).push(ext); }
  registerMarkdownPostProcessor(fn) { (this.postProcessors || (this.postProcessors = [])).push(fn); return fn; }
  registerHoverLinkSource() {}
}

class Scope { constructor(parent) { this.parent = parent; this.keys = []; } register(mods, key, fn) { const k = { mods, key, fn }; this.keys.push(k); return k; } unregister(k) { this.keys = this.keys.filter((x) => x !== k); } }
class Modal {
  constructor(app) { this.app = app; const d = app.workspace.doc; this.containerEl = d.createElement('div'); this.containerEl.className = 'modal-container'; this.modalEl = this.containerEl.appendChild(d.createElement('div')); this.modalEl.className = 'modal'; this.titleEl = this.modalEl.appendChild(d.createElement('div')); this.titleEl.className = 'modal-title'; this.contentEl = this.modalEl.appendChild(d.createElement('div')); this.contentEl.className = 'modal-content'; }
  setTitle(t) { this.titleEl.textContent = t; return this; }
  open() { this.app.workspace.doc.body.appendChild(this.containerEl); Modal.open.push(this); if (this.onOpen) this.onOpen(); }
  close() { if (!this.containerEl.isConnected) return; this.containerEl.remove(); Modal.open = Modal.open.filter((m) => m !== this); if (this.onClose) this.onClose(); }
}
Modal.open = [];
class SuggestModal extends Modal {
  setPlaceholder(p) { this.placeholder = p; }
  open() { super.open(); this.shown = this.getSuggestions ? this.getSuggestions('') : []; }
  pick(item) { this.close(); this.onChooseSuggestion(item, {}); }
}
class FuzzySuggestModal extends SuggestModal {
  getSuggestions() { return this.getItems().map((item) => ({ item })); }
  onChooseSuggestion(s, evt) { this.onChooseItem(s.item, evt); }
  pick(item) { this.close(); this.onChooseItem(item, {}); }
}
// Obsidian's suggester under a field: asked on focus and on every input, as Obsidian asks; `shown` is what it offers, `pick` takes one.
class AbstractInputSuggest {
  constructor(app, input) {
    this.app = app; this.textInputEl = input; this.limit = 100; this.shown = []; this.isOpen = false;
    const ask = () => { const got = this.getSuggestions(input.value) || []; this.shown = this.limit > 0 ? got.slice(0, this.limit) : got; this.isOpen = this.shown.length > 0; AbstractInputSuggest.last = this; };
    input.addEventListener('input', ask);
    input.addEventListener('focus', ask);
    input.addEventListener('blur', () => this.close());
  }
  open() { this.isOpen = true; }
  close() { this.isOpen = false; this.shown = []; }
  pick(item) { this.selectSuggestion(item, {}); }
}
AbstractInputSuggest.last = null;

class MenuItem {
  constructor() { this.title = ''; }
  setTitle(t) { this.title = t; return this; }
  setIcon(i) { this.icon = i; return this; }
  setSection(s) { this.section = s; return this; }
  setChecked(c) { this.checked = c; return this; }
  setDisabled(d) { this.disabled = d; return this; }
  setWarning(w) { this.warning = w; return this; }
  onClick(fn) { this.click = fn; return this; }
  setSubmenu() { this.submenu = new Menu(); this.submenu.own = true; return this.submenu; }
}
class Menu {
  constructor() { this.items = []; Menu.made.push(this); }
  addItem(fn) { const item = new MenuItem(); fn(item); if (!this.own && !item.section) throw new Error(`menu entry "${item.title}" has no section`); this.items.push(item); return this; }
  addSeparator() { this.items.push({ separator: true }); return this; }
  showAtMouseEvent(e) { this.shownAt = e; Menu.shown = this; return this; }
  showAtPosition(p) { this.shownAt = p; Menu.shown = this; return this; }
  titles() { return this.items.filter((i) => !i.separator).map((i) => i.title); }
  click(title) { const item = this.items.find((i) => i.title === title); if (!item) throw new Error(`no menu entry "${title}" among: ${this.titles().join(', ')}`); return item.click({}); }
}
Menu.made = [];

/** A control of a settings row: remembers its value and tells whoever listens. */
function control(row, tag, read) {
  const el = row.controlEl.appendChild(row.settingEl.ownerDocument.createElement(tag));
  const c = { el, inputEl: el, toggleEl: el, selectEl: el, buttonEl: el, extraSettingsEl: el, value: undefined };
  ['setValue', 'setPlaceholder', 'setButtonText', 'setIcon', 'setTooltip', 'setCta', 'setWarning', 'setDisabled', 'setLimits', 'setDynamicTooltip', 'addOption', 'addOptions', 'setClass'].forEach((m) => { c[m] = (v) => { if (m === 'setValue') c.value = v; if (m === 'setButtonText') el.textContent = v; if (m === 'setTooltip') el.setAttribute('aria-label', v); return c; }; });
  c.onChange = (fn) => { c.change = fn; return c; };
  c.onClick = (fn) => { c.click = fn; el.addEventListener('click', fn); return c; };
  c.getValue = () => c.value;
  void read;
  return c;
}
class Setting {
  constructor(containerEl) { const d = containerEl.ownerDocument; this.settingEl = containerEl.appendChild(d.createElement('div')); this.settingEl.className = 'setting-item'; this.infoEl = this.settingEl.appendChild(d.createElement('div')); this.nameEl = this.infoEl.appendChild(d.createElement('div')); this.nameEl.className = 'setting-item-name'; this.descEl = this.infoEl.appendChild(d.createElement('div')); this.descEl.className = 'setting-item-description'; this.controlEl = this.settingEl.appendChild(d.createElement('div')); this.controlEl.className = 'setting-item-control'; this.components = []; Setting.made.push(this); }
  setName(n) { this.name = n; this.nameEl.textContent = n; return this; }
  setDesc(dsc) { this.descEl.textContent = typeof dsc === 'string' ? dsc : ''; return this; }
  setHeading() { this.heading = true; this.settingEl.classList.add('setting-item-heading'); return this; }
  setClass(c) { this.settingEl.classList.add(c); return this; }
  setDisabled() { return this; }
  _add(tag, fn) { const c = control(this, tag); this.components.push(c); if (fn) fn(c); return this; }
  addToggle(fn) {
    // As Obsidian makes it: a .checkbox-container holding a checkbox, .is-enabled when on.
    return this._add('div', (c) => {
      c.el.className = 'checkbox-container';
      c.el.appendChild(c.el.ownerDocument.createElement('input')).type = 'checkbox';
      const set = c.setValue;
      c.setValue = (v) => { c.el.classList.toggle('is-enabled', !!v); return set(v); };
      if (fn) fn(c);
    });
  }
  addText(fn) { return this._add('input', fn); }
  addTextArea(fn) { return this._add('textarea', fn); }
  addDropdown(fn) { return this._add('select', fn); }
  addButton(fn) { return this._add('button', fn); }
  addExtraButton(fn) { return this._add('div', fn); }
  addSlider(fn) { return this._add('input', fn); }
}
Setting.made = [];
/** Obsidian's toggle and dropdown, as they are made: a .checkbox-container holding a checkbox, a select.dropdown. */
class ToggleComponent {
  constructor(containerEl) { const d = containerEl.ownerDocument; this.toggleEl = containerEl.appendChild(d.createElement('div')); this.toggleEl.className = 'checkbox-container'; const input = this.toggleEl.appendChild(d.createElement('input')); input.type = 'checkbox'; input.tabIndex = 0; this.on = false; this.toggleEl.addEventListener('click', () => this.setValue(!this.on)); }
  getValue() { return this.on; }
  setValue(on) { this.on = !!on; this.toggleEl.classList.toggle('is-enabled', this.on); if (this.changed) this.changed(this.on); return this; }
  onChange(fn) { this.changed = fn; return this; }
  setDisabled(off) { this.toggleEl.classList.toggle('is-disabled', !!off); return this; }
  setTooltip(t) { this.toggleEl.setAttribute('aria-label', t); return this; }
}
class DropdownComponent {
  constructor(containerEl) { this.selectEl = containerEl.appendChild(containerEl.ownerDocument.createElement('select')); this.selectEl.className = 'dropdown'; this.selectEl.addEventListener('change', () => this.changed && this.changed(this.selectEl.value)); }
  addOption(value, text) { const o = this.selectEl.appendChild(this.selectEl.ownerDocument.createElement('option')); o.value = value; o.textContent = text; return this; }
  addOptions(map) { Object.keys(map).forEach((k) => this.addOption(k, map[k])); return this; }
  getValue() { return this.selectEl.value; }
  setValue(v) { this.selectEl.value = v; return this; }
  onChange(fn) { this.changed = fn; return this; }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = app.workspace.doc.createElement('div'); } }

class Notice { constructor(message) { this.message = message; Notice.log.push(String(message && message.textContent != null ? message.textContent : message)); } hide() {} setMessage(m) { this.message = m; Notice.log.push(String(m)); return this; } }
Notice.log = [];

const registered = {};
function addIcon(id, svg) { registered[id] = svg; }
function removeIcon(id) { delete registered[id]; }
function setIcon(el, id) {
  while (el.firstChild) el.removeChild(el.firstChild);
  const svg = el.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `svg-icon ${id}`);
  svg.setAttribute('viewBox', registered[id] ? '0 0 100 100' : '0 0 24 24');
  svg.setAttribute('data-icon', id);
  el.appendChild(svg);
}
// Markdown rendered into an element: here a paragraph of the text, each call kept.
class MarkdownRenderChild extends Component { constructor(el) { super(); this.containerEl = el; } }
const MarkdownRenderer = {
  calls: [],
  render: async (app, markdown, el, sourcePath) => { MarkdownRenderer.calls.push({ markdown, sourcePath }); el.appendChild(el.ownerDocument.createElement('p')).textContent = markdown; },
};

// The editor's fields Obsidian gives a plugin: the note an editor holds, and whether it is in live preview.
const { StateField } = require('@codemirror/state');
const editorInfoField = StateField.define({ create: () => ({ file: null }), update: (v) => v });
const editorLivePreviewField = StateField.define({ create: () => true, update: (v) => v });

// requestUrl: answered by whatever a suite puts in requestUrl.handler ({ url, method, headers, body, contentType } → { status, json?, text?, headers? }).
async function requestUrl(req) {
  if (typeof req === 'string') req = { url: req };
  if (!requestUrl.handler) throw new Error('net::ERR_INTERNET_DISCONNECTED');
  requestUrl.log.push(req);
  const out = await requestUrl.handler(req);
  const text = out.text != null ? out.text : out.json !== undefined ? JSON.stringify(out.json) : '';
  return { status: out.status || 200, headers: out.headers || {}, text, get json() { return JSON.parse(text); }, arrayBuffer: new TextEncoder().encode(text).buffer };
}
requestUrl.handler = null;
requestUrl.log = [];
const debounce = (fn) => { const run = (...a) => fn(...a); run.cancel = () => {}; run.run = run; return run; };

module.exports = {
  Scope, Events, TAbstractFile, TFile, TFolder, Vault, MetadataCache, FileManager, Component, Workspace, WorkspaceLeaf, App,
  View, ItemView, MarkdownView, Plugin, Modal, SuggestModal, FuzzySuggestModal, AbstractInputSuggest, Menu, MenuItem, Setting, PluginSettingTab, Notice, ToggleComponent, DropdownComponent,
  addIcon, removeIcon, setIcon, requestUrl, editorInfoField, editorLivePreviewField, MarkdownRenderer, MarkdownRenderChild, getIconIds: () => Object.keys(registered), icons: registered, normalizePath, debounce,
  Platform: { isMobile: false, isDesktop: true, isDesktopApp: true, isMacOS: true },
  parseYaml: (s) => yaml.load(s), stringifyYaml: (o) => yaml.dump(o, { lineWidth: -1 }),
  Keymap: { isModEvent: (e) => !!(e && (e.metaKey || e.ctrlKey)), isModifier: (e, m) => !!(e && m === 'Mod' && (e.metaKey || e.ctrlKey)) },
  parseNote,
};
