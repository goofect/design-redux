// Bulk edits against the real main.js: adding properties to folders,
// renaming a property or a tag everywhere, and undoing it. The vault is
// simulated with real text: frontmatter goes through a YAML parser, tags
// are found in the text with their positions, and every write is seen.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const yaml = require('js-yaml');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.virtualConsole.removeAllListeners('jsdomError');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.MutationObserver = dom.window.MutationObserver;
global.navigator = dom.window.navigator;
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

/* -- obsidian ------------------------------------------------------------ */

const notices = [];
class Notice {
  constructor(message, duration) {
    this.message = message;
    this.duration = duration;
    this.hidden = false;
    notices.push(this);
  }
  setMessage(m) { this.message = m; }
  hide() { this.hidden = true; }
  get text() { return typeof this.message === 'string' ? this.message : this.message.textContent; }
}
const menus = [];
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = { title: '', section: null };
    item.setTitle = (v) => { item.title = v; return item; };
    item.setIcon = () => item;
    item.setChecked = () => item;
    item.setSection = (v) => { item.section = v; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
  addSeparator() { return this; }
  showAtPosition() { menus.push(this); }
  showAtMouseEvent() { menus.push(this); }
}
const modals = [];
class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal';
    this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
    this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
  }
  open() { document.body.appendChild(this.modalEl); modals.push(this); this.onOpen(); }
  close() { this.modalEl.remove(); this.onClose(); }
  onOpen() {}
  onClose() {}
}
const pickers = [];
class FuzzySuggestModal {
  constructor(app) { this.app = app; }
  setPlaceholder() {}
  open() { pickers.push(this); }
}
class TAbstractFile {}
class TFile extends TAbstractFile {
  constructor(p) {
    super(); this.path = p; this.name = p.split('/').pop();
    this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.stat = { mtime: 0, ctime: 0 };
  }
}
class TFolder extends TAbstractFile {
  constructor(p) { super(); this.path = p; this.name = p === '/' ? '' : p.split('/').pop(); this.children = []; }
  isRoot() { return this.path === '/'; }
}
class Component { registerEvent() {} register() {} }
class ItemView extends Component {}
class MarkdownView {}

const SCHEMA = { schema: yaml.CORE_SCHEMA };
const obsidian = new Proxy({
  Notice, Menu, Modal, FuzzySuggestModal, TFile, TFolder, TAbstractFile, Component, ItemView, MarkdownView,
  setIcon: (el, name) => { el.dataset.icon = name; },
  Platform: { isMobile: false, isPhone: false },
  parseYaml: (text) => yaml.load(text, SCHEMA),
  stringifyYaml: (obj) => yaml.dump(obj, { lineWidth: -1 }),
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_bulk_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { PropertyToolsModal, BulkEdits, BulkEditing, AddPropertiesModal, RenamePropertyModal, RenameTagModal, renamedText, ' +
  'addPropertiesTo, renamePropertyIn, mergeValues, renameTagText, renameTagsValue, renameTagIn, tagNameProblem, ' +
  'propertyNameProblem, renameInExpression, renameInBase, renameInBaseText, renameInBaseBlocks, parseTypedValue, ' +
  'renamePropertyInSettings, renameInNameList, PropertiesSection, DEFAULTS, renameValueIn, removePropertiesFrom, ' +
  'convertValue, parseDateText, RenameValueModal, RemovePropertiesModal, ChangeTypeModal, MissingPropertyModal, ' +
  'FolderDefaultsModal, propertiesIn, MergePropertiesModal, mergePropertiesIn, PropertyListTool, propertyOverview, AlbumProperty, ' +
  'propertyPastePlan, joinedValues, PropertyPasteModal, PropertyClipboard, whereHolds, Notes };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

/* -- a vault, simulated with real text --------------------------------- */

const FM = /^---\n([\s\S]*?)\n?---(?:\n|$)/;

function parseNote(text) {
  const m = FM.exec(text);
  const cache = {};
  let bodyStart = 0;
  if (m) {
    const fm = yaml.load(m[1], SCHEMA) || {};
    cache.frontmatter = Object.assign({}, fm, { position: {} });
    bodyStart = m[0].length;
  }
  // Tags in the text, as Obsidian finds them: not in code, not in frontmatter.
  const tags = [];
  let offset = 0;
  let fenced = false;
  text.split('\n').forEach((line, lineNo) => {
    const start = offset;
    offset += line.length + 1;
    if (start < bodyStart) return;
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    const re = /(^|\s)(#[^\s#.,;:!?'"()[\]{}`]+)/g;
    let hit;
    while ((hit = re.exec(line))) {
      if (/^#[0-9/]+$/.test(hit[2])) continue;
      const col = hit.index + hit[1].length;
      tags.push({
        tag: hit[2],
        position: {
          start: { line: lineNo, col, offset: start + col },
          end: { line: lineNo, col: col + hit[2].length, offset: start + col + hit[2].length },
        },
      });
    }
  });
  if (tags.length) cache.tags = tags;
  return cache;
}

function makeVault(spec) {
  const root = new TFolder('/');
  const folders = { '/': root };
  const texts = new Map();
  const writes = [];
  const folderFor = (p) => {
    if (folders[p]) return folders[p];
    const parent = folderFor(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/');
    const f = new TFolder(p);
    f.parent = parent;
    parent.children.push(f);
    folders[p] = f;
    return f;
  };
  const files = [];
  Object.keys(spec).forEach((p) => {
    const f = new TFile(p);
    const parent = folderFor(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/');
    f.parent = parent;
    parent.children.push(f);
    files.push(f);
    texts.set(f, spec[p]);
  });
  const types = {};
  // The cache can be made to lag behind the text, as it does in Obsidian.
  const frozen = new Map();
  const cacheOf = (f) => (frozen.has(f) ? frozen.get(f) : parseNote(texts.get(f)));
  const write = (f, text) => {
    if (!texts.has(f)) throw new Error(`gone: ${f.path}`);
    texts.set(f, text);
    writes.push(f.path);
  };
  const app = {
    vault: {
      getRoot: () => root,
      getName: () => 'Vault',
      getFiles: () => files.filter((f) => texts.has(f)),
      getMarkdownFiles: () => files.filter((f) => texts.has(f) && f.extension === 'md'),
      getFolderByPath: (p) => folders[p] || null,
      getFileByPath: (p) => files.find((f) => f.path === p && texts.has(f)) || null,
      getAbstractFileByPath: (p) => folders[p] || files.find((f) => f.path === p) || null,
      read: async (f) => texts.get(f),
      cachedRead: async (f) => texts.get(f),
      on: () => ({}),
      process: async (f, fn) => {
        const next = fn(texts.get(f));
        write(f, next);
        return next;
      },
    },
    metadataCache: { getFileCache: (f) => (f.extension === 'md' ? cacheOf(f) : null), on: () => ({}), offref() {} },
    fileManager: {
      processFrontMatter: async (f, fn) => {
        const text = texts.get(f);
        const m = FM.exec(text);
        const fm = m ? yaml.load(m[1], SCHEMA) || {} : {};
        fn(fm);
        const block = `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n`;
        write(f, m ? block + text.slice(m[0].length) : block + text);
      },
    },
    metadataTypeManager: {
      getAllProperties: () => {
        const out = {};
        files.filter((f) => texts.has(f) && f.extension === 'md').forEach((f) => {
          const fm = (cacheOf(f) || {}).frontmatter || {};
          Object.keys(fm).forEach((k) => {
            if (k === 'position') return;
            const low = k.toLowerCase();
            if (!out[low]) out[low] = { name: k, count: 0, type: types[low] || 'text' };
            out[low].count++;
          });
        });
        return out;
      },
      getTypeInfo: (k) => {
        // Inferred from the values, as Obsidian does: a list is a list.
        const low = k.toLowerCase();
        const values = files.filter((f) => texts.has(f) && f.extension === 'md').map((f) => {
          const fm = (cacheOf(f) || {}).frontmatter || {};
          const key = Object.keys(fm).find((x) => x.toLowerCase() === low);
          return key === undefined ? undefined : fm[key];
        }).filter((x) => x !== undefined && x !== null);
        const inferred = low === 'tags' ? 'tags'
          : values.some(Array.isArray) ? 'multitext'
          : values.length && values.every((x) => typeof x === 'number') ? 'number' : 'text';
        return { expected: types[low] ? { type: types[low] } : null, inferred: { type: inferred } };
      },
      setType: (k, t) => { types[k.toLowerCase()] = t; },
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => ({ openFile: (f) => opened.push(f) }),
      on: (name, fn) => { handlers[name] = fn; return {}; },
    },
  };
  const opened = [];
  const handlers = {};
  const file = (p) => files.find((f) => f.path === p);
  return {
    app, root, folders, files, texts, writes, types, handlers, opened, file,
    text: (p) => texts.get(file(p)),
    fm: (p) => (parseNote(texts.get(file(p))).frontmatter || {}),
    freeze: (p) => frozen.set(file(p), parseNote(texts.get(file(p)))),
    thaw: () => frozen.clear(),
    edit: (p, t) => texts.set(file(p), t),
  };
}

function makePlugin(vault) {
  const plugin = {
    app: vault.app,
    settings: JSON.parse(JSON.stringify(R.DEFAULTS)),
    saved: 0,
    saveData: async () => { plugin.saved++; },
    refreshBrowse() {},
    registerEvent() {},
    folderNote: (folder) => vault.app.vault.getFileByPath(`${folder.path}/${folder.name}.md`),
    features: [],
    feature(C) { return this.features.find((f) => f instanceof C) || null; },
  };
  plugin.bulk = new R.BulkEdits(plugin);
  const editing = new R.BulkEditing(plugin);
  plugin.features.push(editing);
  return { plugin, bulk: plugin.bulk, editing };
}

const note = (fm, body = '') =>
  (fm ? `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n` : '') + body;

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const change = (input, value) => {
  if (value !== undefined) input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const enter = (el) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const lastNotice = () => notices.filter((n) => typeof n.message !== 'string').pop();

(async () => {
  /* -- adding ----------------------------------------------------------- */

  await t('adding keeps a value a note has, unless asked to replace it', () => {
    const fm = { Status: 'draft', domain: '' };
    assert.strictEqual(R.addPropertiesTo(fm, [{ key: 'status', value: 'done' }, { key: 'domain', value: 'Law' }], false), true);
    assert.deepStrictEqual(fm, { Status: 'draft', domain: 'Law' }, 'an empty value is filled; one in another case is kept');
    R.addPropertiesTo(fm, [{ key: 'status', value: 'done' }], true);
    assert.deepStrictEqual(fm, { Status: 'done', domain: 'Law' }, 'replaced under the name the note uses');
  });

  await t('a list takes the new items without repeats, even one written as text', () => {
    const fm = { tags: ['law', 'Court'], aliases: 'Bench' , plain: 'x' };
    R.addPropertiesTo(fm, [
      { key: 'tags', value: ['court', 'appeal'] },
      { key: 'aliases', value: ['Bar'] },
      { key: 'fresh', value: null },
    ], false);
    assert.deepStrictEqual(fm.tags, ['law', 'Court', 'appeal']);
    assert.deepStrictEqual(fm.aliases, ['Bench', 'Bar']);
    assert.ok('fresh' in fm && fm.fresh === null, 'an empty property is still added');
    const same = { tags: 'law court' };
    assert.strictEqual(R.addPropertiesTo(same, [{ key: 'tags', value: ['court'] }], false), true);
    assert.deepStrictEqual(same.tags, ['law', 'court']);
    assert.strictEqual(R.addPropertiesTo({ a: null }, [{ key: 'a', value: null }], false), false, 'nothing into nothing is no change');
  });

  await t('typed values become what the type says', () => {
    assert.deepStrictEqual(R.parseTypedValue('multitext', ' a, b ,, a '), ['a', 'b']);
    assert.deepStrictEqual(R.parseTypedValue('tags', '#law, court'), ['law', 'court']);
    assert.strictEqual(R.parseTypedValue('number', '3.5'), 3.5);
    assert.strictEqual(R.parseTypedValue('number', 'three'), 'three');
    assert.strictEqual(R.parseTypedValue('checkbox', true), true);
    assert.strictEqual(R.parseTypedValue('text', '  '), null);
    assert.strictEqual(R.parseTypedValue('date', '2026-09-27'), '2026-09-27');
  });

  await t('the notes a set of folders covers: all, direct, or folder notes; and chosen notes', () => {
    const v = makeVault({
      'IR/IR.md': note({ a: 1 }), 'IR/Anarchy.md': '', 'IR/Theories/Realism.md': '', 'IR/cover.png': '',
      'Books/Crisis.md': '', 'Loose.md': '',
    });
    const { bulk } = makePlugin(v);
    const ir = v.folders.IR;
    const paths = (fs) => fs.map((f) => f.path);
    assert.deepStrictEqual(paths(bulk.notesFor([ir], 'deep')), ['IR/Anarchy.md', 'IR/IR.md', 'IR/Theories/Realism.md']);
    assert.deepStrictEqual(paths(bulk.notesFor([ir], 'direct')), ['IR/Anarchy.md', 'IR/IR.md']);
    assert.deepStrictEqual(paths(bulk.notesFor([ir, v.folders.Books], 'folder-notes')), ['IR/IR.md']);
    assert.deepStrictEqual(paths(bulk.notesFor([v.file('Loose.md'), ir, v.file('IR/Anarchy.md')], 'direct')),
      ['IR/Anarchy.md', 'IR/IR.md', 'Loose.md'], 'no repeats, and a chosen note always counts');
  });

  await t('adding writes only the notes that change, and undo puts them back', async () => {
    const v = makeVault({
      'IR/a.md': note({ status: 'done' }, 'Body a\n'),
      'IR/b.md': 'No properties yet\n',
      'IR/c.md': note({ status: 'draft', domain: 'IR' }),
    });
    const { bulk } = makePlugin(v);
    const files = bulk.notesFor([v.folders.IR], 'deep');
    const before = new Map(files.map((f) => [f.path, v.texts.get(f)]));
    const record = await bulk.addProperties(files, [{ key: 'domain', value: 'IR' }], false);
    assert.deepStrictEqual(v.writes.slice().sort(), ['IR/a.md', 'IR/b.md'], 'c already had it, and was written anyway');
    assert.strictEqual(v.fm('IR/b.md').domain, 'IR');
    assert.ok(v.text('IR/b.md').endsWith('No properties yet\n'), 'the text was disturbed');
    assert.strictEqual(record.files.length, 2);
    assert.strictEqual(bulk.last, record);
    await bulk.undo();
    files.forEach((f) => assert.strictEqual(v.texts.get(f), before.get(f.path), `${f.path} not restored`));
    assert.strictEqual(bulk.last, null);
  });

  await t("undo leaves a note that's been edited since, and says so", async () => {
    const v = makeVault({ 'F/a.md': note({ x: 1 }), 'F/b.md': note({ x: 2 }) });
    const { bulk } = makePlugin(v);
    const original = v.text('F/a.md');
    await bulk.addProperties(bulk.notesFor([v.folders.F], 'deep'), [{ key: 'y', value: 'new' }], false);
    v.edit('F/b.md', v.text('F/b.md') + 'typed afterwards\n');
    notices.length = 0;
    const result = await bulk.undo();
    assert.strictEqual(result.restored, 1);
    assert.deepStrictEqual(result.kept.map((f) => f.path), ['F/b.md']);
    assert.strictEqual(v.text('F/a.md'), original);
    assert.ok(v.text('F/b.md').includes('typed afterwards'), 'the later edit was lost');
    assert.match(notices.pop().message, /1 file changed since, so left as they are: b/);
  });

  await t("a new property's chosen type is set for the vault; an existing one's isn't touched", async () => {
    const v = makeVault({ 'F/a.md': note({ status: 'x' }) });
    const { bulk } = makePlugin(v);
    v.types.status = 'text';
    await bulk.addProperties([v.file('F/a.md')], [{ key: 'topics', value: ['a'], type: 'multitext' }, { key: 'status', value: 'y', type: null }], true);
    assert.strictEqual(v.types.topics, 'multitext');
    assert.strictEqual(v.types.status, 'text');
  });

  /* -- renaming a property ----------------------------------------------- */

  await t('a rename keeps the property in its place, whatever case the note wrote', () => {
    const fm = { title: 'x', Domain: 'Law', status: 'y' };
    assert.strictEqual(R.renamePropertyIn(fm, 'domain', 'field'), 'renamed');
    assert.deepStrictEqual(Object.keys(fm), ['title', 'field', 'status']);
    assert.strictEqual(fm.field, 'Law');
    const c = { author: 'Le Guin' };
    assert.strictEqual(R.renamePropertyIn(c, 'author', 'Author'), 'renamed', 'a change of case');
    assert.deepStrictEqual(c, { Author: 'Le Guin' });
    assert.strictEqual(R.renamePropertyIn({ Author: 1 }, 'author', 'Author'), 'same');
    assert.strictEqual(R.renamePropertyIn({ a: 1 }, 'b', 'c'), 'absent');
  });

  await t('two names become one where the values agree or are lists; otherwise the note is left', () => {
    const same = { domain: 'Law', x: 1, field: 'Law' };
    assert.strictEqual(R.renamePropertyIn(same, 'domain', 'field'), 'merged');
    assert.deepStrictEqual(same, { field: 'Law', x: 1 });
    const lists = { field: ['a'], domain: ['b', 'A'] };
    assert.strictEqual(R.renamePropertyIn(lists, 'domain', 'field'), 'merged');
    assert.deepStrictEqual(lists, { field: ['a', 'b'] });
    const empty = { domain: 'Law', field: null };
    R.renamePropertyIn(empty, 'domain', 'field');
    assert.deepStrictEqual(empty, { field: 'Law' });
    const clash = { domain: 'Law', field: 'Politics' };
    assert.strictEqual(R.renamePropertyIn(clash, 'domain', 'field'), 'conflict');
    assert.deepStrictEqual(clash, { domain: 'Law', field: 'Politics' }, 'a value was lost');
    assert.strictEqual(R.mergeValues(['x', ['y']]), R.mergeValues(['a', 'b']), 'text then list is a conflict too');
  });

  await t('names that can and cannot be used', () => {
    assert.strictEqual(R.propertyNameProblem('due date'), '');
    assert.match(R.propertyNameProblem('  '), /Type/);
    assert.match(R.propertyNameProblem('Position'), /Obsidian/);
    assert.strictEqual(R.tagNameProblem('#legal/courts'), '');
    assert.strictEqual(R.tagNameProblem('état_2'), '');
    assert.match(R.tagNameProblem('two words'), /spaces/);
    assert.match(R.tagNameProblem('a.b'), /letters/);
    assert.match(R.tagNameProblem('2026'), /letter/);
    assert.match(R.tagNameProblem('law/'), /nested/);
  });

  await t('in a base expression: bare names, note. and note[""], but never quoted text, members or calls', () => {
    const r = (e, to = 'field') => R.renameInExpression(e, { property: ['domain', to] });
    assert.strictEqual(r('domain == "domain"'), 'field == "domain"');
    assert.strictEqual(r('note.domain.contains("Law") && note["domain"] != null'), 'note.field.contains("Law") && note["field"] != null');
    assert.strictEqual(r("this.domain + note['Domain']"), "this.field + note['field']");
    assert.strictEqual(r('file.domain + formula.domain + domain(x) + domains + mydomain'), 'file.domain + formula.domain + domain(x) + domains + mydomain');
    assert.strictEqual(r('if(domain, "a \\"domain\\" b", domain)'), 'if(field, "a \\"domain\\" b", field)');
    assert.strictEqual(r('note.domain + domain', 'due date'), 'note["due date"] + note["due date"]');
    assert.strictEqual(R.renameInExpression('value > 2', { property: ['value', 'v'] }), 'value > 2', "a base's own word");
  });

  await t('in a base expression: a tag inside hasTag and tags.contains, nested ones too', () => {
    const r = (e) => R.renameInExpression(e, { tag: ['law', 'legal'] });
    assert.strictEqual(r('file.hasTag("law", "law/court", "lawyer")'), 'file.hasTag("legal", "legal/court", "lawyer")');
    assert.strictEqual(r('file.tags.contains("#law") && name == "law"'), 'file.tags.contains("#legal") && name == "law"');
  });

  await t('a whole base: filters, formulas, columns, sort, grouping, summaries and a card image', () => {
    const base = {
      filters: { and: ['domain != "x"', { or: ['file.hasTag("law")', 'note.domain.isEmpty()'] }] },
      formulas: { d: 'domain + "!"' },
      properties: { domain: { displayName: 'Domain' }, 'note.status': { displayName: 'S' }, 'formula.d': {} },
      views: [{
        type: 'cards', name: 'domain', order: ['file.name', 'domain', 'note.domain'],
        sort: [{ property: 'domain', direction: 'ASC' }], groupBy: { property: 'note.domain', direction: 'DESC' },
        summaries: { domain: 'Unique' }, image: 'note.domain', filters: 'domain == "Law"',
      }],
    };
    const out = R.renameInBase(base, { property: ['domain', 'field'] });
    assert.deepStrictEqual(out.filters, { and: ['field != "x"', { or: ['file.hasTag("law")', 'note.field.isEmpty()'] }] });
    assert.strictEqual(out.formulas.d, 'field + "!"');
    assert.deepStrictEqual(Object.keys(out.properties), ['field', 'note.status', 'formula.d']);
    const view = out.views[0];
    assert.strictEqual(view.name, 'domain', "the view's own name was renamed");
    assert.deepStrictEqual(view.order, ['file.name', 'field', 'note.field']);
    assert.strictEqual(view.sort[0].property, 'field');
    assert.strictEqual(view.groupBy.property, 'note.field');
    assert.deepStrictEqual(Object.keys(view.summaries), ['field']);
    assert.strictEqual(view.image, 'note.field');
    assert.strictEqual(view.filters, 'field == "Law"');
    assert.strictEqual(base.formulas.d, 'domain + "!"', 'the original was changed');
    assert.strictEqual(R.renameInBaseText('views:\n  - type: table\n    order: [status]\n', { property: ['domain', 'f'] }), null,
      "a base that doesn't mention it isn't rewritten");
  });

  await t('a base written in a note as a code block is renamed in place', () => {
    const text = 'Intro #law\n\n```base\nfilters: \'domain == "Law"\'\nviews:\n  - type: table\n    order: [domain]\n```\n\n```js\ndomain = 1\n```\n';
    const out = R.renameInBaseBlocks(text, { property: ['domain', 'field'] });
    assert.ok(out.includes("filters: field == \"Law\"") || out.includes('filters: \'field == "Law"\''), out);
    assert.ok(out.includes('- field'));
    assert.ok(out.includes('```js\ndomain = 1\n```'), 'another code block was touched');
    assert.ok(out.startsWith('Intro #law\n\n```base\n'));
    assert.strictEqual(R.renameInBaseBlocks('no bases here', { property: ['a', 'b'] }), null);
  });

  await t("the plugin's own settings follow a renamed property, and undo puts them back", () => {
    const s = clone(R.DEFAULTS);
    s.coverProperty = 'Cover';
    s.librarySections = [{ title: 'x', items: [{ kind: 'property', key: 'domain' }, { kind: 'builtin', id: 'home' }] }];
    s.graphFilters = { graph: { mode: 'all', rules: [{ key: 'domain', op: 'has' }], clause: '[domain]' } };
    const { changed, undo } = R.renamePropertyInSettings(s, 'domain', 'field');
    assert.deepStrictEqual(changed, ['Search categories', 'Album columns', 'Notes table columns', 'Library', 'Graph property filters']);
    assert.strictEqual(s.categoryProperty, 'field');
    assert.strictEqual(s.albumColumns, 'field, modified');
    assert.strictEqual(s.tableColumns, 'field, status');
    assert.strictEqual(s.librarySections[0].items[0].key, 'field');
    assert.strictEqual(s.graphFilters.graph.rules[0].key, 'field');
    assert.strictEqual(s.coverProperty, 'Cover');
    s.tableColumns = 'field';          // changed again since: kept
    s.graphFilters.graph.clause = '[field]'; // re-saved by an open graph: its rule still goes back
    undo();
    assert.strictEqual(s.categoryProperty, 'domain');
    assert.strictEqual(s.albumColumns, 'domain, modified');
    assert.strictEqual(s.tableColumns, 'field');
    assert.strictEqual(s.graphFilters.graph.rules[0].key, 'domain');
    assert.strictEqual(R.renameInNameList('status, Domain', 'domain', 'status'), 'status', 'no repeats');
  });

  const vaultForRename = () => makeVault({
    'IR/a.md': note({ domain: 'Law', status: 'x' }, 'Text a\n'),
    'IR/b.md': note({ Domain: ['Law'], field: ['Politics'] }),
    'IR/c.md': note({ domain: 'Law', field: 'Politics' }),
    'IR/d.md': note({ other: 1 }, 'Nothing to do with it\n'),
    'Reading.base': 'filters:\n  and:\n    - domain == "Law"\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - domain\n',
    'Other.base': 'views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n',
    'Dash.md': 'Top\n\n```base\nviews:\n  - type: table\n    order: [note.domain]\n```\n',
  });

  await t('renaming a property: every note, its bases and settings; a clash left and reported', async () => {
    const v = vaultForRename();
    const { plugin, bulk } = makePlugin(v);
    v.types.domain = 'text';
    const plan = bulk.planPropertyRename('domain', 'field');
    assert.deepStrictEqual(plan.renamed.map((f) => f.path), ['IR/a.md']);
    assert.deepStrictEqual(plan.merged.map((f) => f.path), ['IR/b.md']);
    assert.deepStrictEqual(plan.conflicts.map((f) => f.path), ['IR/c.md']);
    const bases = await bulk.basesFor({ property: ['domain', 'field'] });
    assert.deepStrictEqual(bases.map((f) => f.path).sort(), ['Dash.md', 'Reading.base']);

    const record = await bulk.renameProperty('domain', 'field');
    assert.deepStrictEqual(Object.keys(v.fm('IR/a.md')).filter((k) => k !== 'position'), ['field', 'status']);
    assert.deepStrictEqual(v.fm('IR/b.md').field, ['Politics', 'Law']);
    assert.ok(!('Domain' in v.fm('IR/b.md')));
    assert.deepStrictEqual(v.fm('IR/c.md'), { domain: 'Law', field: 'Politics', position: {} }, 'the clash was touched');
    assert.ok(v.text('Reading.base').includes('field == "Law"') && v.text('Reading.base').includes('- field'));
    assert.ok(v.text('Dash.md').includes('note.field') && v.text('Dash.md').startsWith('Top\n\n```base\n'));
    assert.ok(!v.writes.includes('Other.base') && !v.writes.includes('IR/d.md') && !v.writes.includes('IR/c.md'),
      `untouched files were written: ${v.writes}`);
    assert.strictEqual(plugin.settings.categoryProperty, 'field');
    assert.strictEqual(v.types.field, 'text', 'the type was left behind');
    assert.deepStrictEqual(record.conflicts.map((f) => f.path), ['IR/c.md']);
    assert.deepStrictEqual(record.bases.map((f) => f.path).sort(), ['Dash.md', 'Reading.base']);
  });

  await t('undoing a property rename restores notes, bases and settings', async () => {
    const v = vaultForRename();
    const { plugin, bulk } = makePlugin(v);
    const before = new Map(v.files.map((f) => [f, v.texts.get(f)]));
    await bulk.renameProperty('domain', 'field');
    await bulk.undo();
    v.files.forEach((f) => assert.strictEqual(v.texts.get(f), before.get(f), `${f.path} not restored`));
    assert.strictEqual(plugin.settings.categoryProperty, 'domain');
    assert.strictEqual(plugin.settings.albumColumns, 'domain, modified');
  });

  await t('new capitals for a property change the name Obsidian lists it by too, even with every note written so already', async () => {
    const v = makeVault({ 'IR/a.md': note({ Parent: '[[Law]]' }), 'IR/b.md': note({ parent: '[[Politics]]' }) });
    const { bulk } = makePlugin(v);
    // Obsidian keeps a property's type under the name first written, and lists the property by it.
    const m = v.app.metadataTypeManager;
    m.assignedWidgets = { parent: { name: 'Parent', widget: 'text' } };
    m.unsetType = async (k) => { delete m.assignedWidgets[k.toLowerCase()]; };
    m.setType = async (k, t) => {
      const low = k.toLowerCase();
      if (m.assignedWidgets[low]) m.assignedWidgets[low].widget = t;
      else m.assignedWidgets[low] = { name: k, widget: t };
    };
    const record = await bulk.renameProperty('Parent', 'parent');
    assert.deepStrictEqual(v.fm('IR/a.md'), { parent: '[[Law]]', position: {} });
    assert.deepStrictEqual(m.assignedWidgets.parent, { name: 'parent', widget: 'text' });
    assert.strictEqual(R.renamedText('Parent', 'parent', 1, record), 'Renamed “Parent” to “parent” in 1 note');
    await bulk.undo();
    assert.strictEqual(m.assignedWidgets.parent.name, 'Parent');
    // Every note "parent" already: still a change to make, to the name it's listed by.
    v.edit('IR/a.md', note({ parent: '[[Law]]' }));
    assert.strictEqual(bulk.planPropertyRename('Parent', 'parent').total, 0);
    const again = await bulk.renameProperty('Parent', 'parent');
    assert.strictEqual(m.assignedWidgets.parent.name, 'parent');
    assert.strictEqual(R.renamedText('Parent', 'parent', 0, again), '“parent” is written that way now');
  });

  /* -- merging properties ------------------------------------------------ */

  await t('properties merged in a note: in the first one’s place, the kept one’s value first', () => {
    const fm = { title: 'x', area: 'Law', domain: 'Law', status: 1 };
    assert.strictEqual(R.mergePropertiesIn(fm, ['domain', 'area'], 'domain'), 'merged');
    assert.deepStrictEqual(Object.keys(fm), ['title', 'domain', 'status']);
    assert.strictEqual(fm.domain, 'Law');
    const lists = { area: ['Law'], Domain: ['Politics'] };
    R.mergePropertiesIn(lists, ['domain', 'area'], 'domain');
    assert.deepStrictEqual(lists, { domain: ['Politics', 'Law'] });
    const differ = { area: 'Law', domain: 'Politics' };
    assert.strictEqual(R.mergePropertiesIn(JSON.parse(JSON.stringify(differ)), ['area', 'domain'], 'domain'), 'conflict');
    assert.strictEqual(R.mergePropertiesIn(differ, ['area', 'domain'], 'domain', 'list'), 'combined');
    assert.deepStrictEqual(differ, { domain: ['Politics', 'Law'] });
    const one = { field: 'x' };
    assert.strictEqual(R.mergePropertiesIn(one, ['field', 'area'], 'domain'), 'renamed');
    assert.deepStrictEqual(one, { domain: 'x' });
    assert.strictEqual(R.mergePropertiesIn({ domain: 1 }, ['domain', 'area'], 'domain'), 'same');
    assert.strictEqual(R.mergePropertiesIn({ other: 1 }, ['area'], 'domain'), 'absent');
    const caps = { Domain: 'x' };
    assert.strictEqual(R.mergePropertiesIn(caps, ['Domain', 'area'], 'domain'), 'renamed', 'a change of capitals');
    assert.deepStrictEqual(caps, { domain: 'x' });
  });

  await t('merging properties: every note, bases and settings; different values in a list, and the type a list', async () => {
    const v = vaultForRename();
    const { plugin, bulk } = makePlugin(v);
    v.types.field = 'text';
    const plan = bulk.planPropertyMerge(['domain', 'field'], 'field', 'list');
    assert.deepStrictEqual(plan.changed.map((f) => f.path).sort(), ['IR/a.md', 'IR/b.md', 'IR/c.md']);
    assert.deepStrictEqual(plan.combined.map((f) => f.path), ['IR/c.md']);
    const record = await bulk.mergeProperties(['domain', 'field'], 'field', 'list');
    assert.strictEqual(v.fm('IR/a.md').field, 'Law');
    assert.deepStrictEqual(v.fm('IR/b.md').field, ['Politics', 'Law']);
    assert.deepStrictEqual(v.fm('IR/c.md'), { field: ['Politics', 'Law'], position: {} });
    assert.ok(v.text('Reading.base').includes('field == "Law"'));
    assert.strictEqual(plugin.settings.categoryProperty, 'field');
    assert.strictEqual(v.types.field, 'multitext', 'a list property now');
    assert.deepStrictEqual(record.combined.map((f) => f.path), ['IR/c.md']);
    assert.ok(!v.writes.includes('IR/d.md'));

    await bulk.undo();
    assert.deepStrictEqual(v.fm('IR/c.md'), { domain: 'Law', field: 'Politics', position: {} });
    assert.strictEqual(plugin.settings.categoryProperty, 'domain');
  });

  await t('merging, leaving notes whose values differ as they are', async () => {
    const v = vaultForRename();
    const { bulk } = makePlugin(v);
    const record = await bulk.mergeProperties(['domain', 'field'], 'field', 'skip');
    assert.deepStrictEqual(v.fm('IR/c.md'), { domain: 'Law', field: 'Politics', position: {} });
    assert.deepStrictEqual(record.conflicts.map((f) => f.path), ['IR/c.md']);
    assert.strictEqual(v.fm('IR/a.md').field, 'Law');
  });

  await t('Merge properties: chips, the name most used kept, what differs shown, and Merge merges', async () => {
    const v = vaultForRename();
    const { plugin } = makePlugin(v);
    const modal = new R.MergePropertiesModal(plugin, ['field']);
    modal.open();
    await settle(20);
    const el = modal.contentEl;
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-bulk-chip-name')).map((c) => c.textContent), ['field']);
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /Add another property to merge it with/);
    assert.strictEqual(el.querySelector('.mod-cta').disabled, true);

    const add = el.querySelector('.dr-merge-add input');
    type(add, 'domain');
    enter(add);
    await settle(150);
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-bulk-chip-name')).map((c) => c.textContent), ['field', 'domain']);
    const into = el.querySelectorAll('.dr-bulk-field input')[0];
    assert.strictEqual(into.value, 'domain', 'the one in the most notes');
    const text = el.querySelector('.dr-bulk-summary').textContent;
    assert.match(text, /Brings “field” and “domain” together as “domain” in 2 notes/);
    assert.match(text, /1 note has different values in more than one; they’re put together in a list/);
    assert.ok(!el.querySelector('.dr-merge-mode').hasClass('is-hidden'), 'the choice for differing values shows');
    assert.strictEqual(el.querySelector('.mod-cta').textContent, 'Merge into “domain”');

    click(el.querySelector('.mod-cta'));
    await settle(200);
    assert.deepStrictEqual(v.fm('IR/c.md').domain, ['Law', 'Politics']);
    assert.ok(!('field' in v.fm('IR/b.md')));
    assert.match(lastNotice().text, /Merged “field” and “domain” into “domain” in 2 notes\. 1 note now has a list of the different values\./);
  });

  /* -- renaming a tag ------------------------------------------------------ */

  await t('a tag renamed, keeping its # and what is nested beneath', () => {
    assert.strictEqual(R.renameTagText('#Law/Court', 'law', 'legal'), '#legal/Court');
    assert.strictEqual(R.renameTagText('lawyer', 'law', 'legal'), 'lawyer');
    assert.deepStrictEqual(R.renameTagsValue(['law', '#law/court', 'legal', 'x'], 'law', 'legal'), ['legal', '#legal/court', 'x']);
    assert.strictEqual(R.renameTagsValue('law, law/court x', 'law', 'legal'), 'legal, legal/court x');
    const fm = { tags: ['law'], Tag: 'law', other: 'law' };
    assert.strictEqual(R.renameTagIn(fm, 'law', 'legal'), true);
    assert.deepStrictEqual(fm, { tags: ['legal'], Tag: 'legal', other: 'law' });
  });

  const vaultForTags = () => makeVault({
    'a.md': note({ tags: ['law', 'politics'] }, 'See #law and #law/court, not #lawyer.\n\n```\n#law in code\n```\n'),
    'b.md': note({ tags: 'law legal' }),
    'c.md': 'Only in the text: #Law here.\n',
    'd.md': note({ tags: ['politics'] }, 'Nothing #else\n'),
    'Cases.base': 'filters:\n  and:\n    - file.hasTag("law")\nviews:\n  - type: table\n    name: Table\n',
  });

  await t('renaming a tag: in properties and text, nested ones, merged, and never in code', async () => {
    const v = vaultForTags();
    const { bulk } = makePlugin(v);
    const plan = bulk.planTagRename('#law', 'legal');
    assert.deepStrictEqual(plan.files.map((f) => f.path), ['a.md', 'b.md', 'c.md']);
    assert.strictEqual(plan.inProps, 2);
    assert.strictEqual(plan.inText, 2);
    assert.deepStrictEqual(plan.nested, ['law/court']);
    assert.strictEqual(plan.already, 1, 'b already has legal');

    const record = await bulk.renameTag('law', 'legal');
    assert.ok(v.text('a.md').includes('See #legal and #legal/court, not #lawyer.'), v.text('a.md'));
    assert.ok(v.text('a.md').includes('#law in code'), 'code was changed');
    assert.deepStrictEqual(v.fm('a.md').tags, ['legal', 'politics']);
    assert.strictEqual(v.fm('b.md').tags, 'legal legal', 'a text list keeps its form');
    assert.strictEqual(v.text('c.md'), 'Only in the text: #legal here.\n');
    assert.ok(v.text('Cases.base').includes('hasTag("legal")'));
    assert.ok(!v.writes.includes('d.md'));
    assert.strictEqual(record.bases.length, 1);
  });

  await t("a note whose cache is behind is left alone and reported, not guessed at", async () => {
    const v = vaultForTags();
    const { bulk } = makePlugin(v);
    v.freeze('c.md');
    v.edit('c.md', 'Edited: now the tag moved #Law here.\n');
    const record = await bulk.renameTag('law', 'legal');
    assert.strictEqual(v.text('c.md'), 'Edited: now the tag moved #Law here.\n');
    assert.deepStrictEqual(record.stale.map((f) => f.path), ['c.md']);
    v.thaw();
  });

  await t('undoing a tag rename restores every note and the base', async () => {
    const v = vaultForTags();
    const { bulk } = makePlugin(v);
    const before = new Map(v.files.map((f) => [f, v.texts.get(f)]));
    await bulk.renameTag('law', 'legal');
    await bulk.undo();
    v.files.forEach((f) => assert.strictEqual(v.texts.get(f), before.get(f), `${f.path} not restored`));
  });

  await t('one change at a time', async () => {
    const v = vaultForTags();
    const { bulk } = makePlugin(v);
    notices.length = 0;
    const first = bulk.renameTag('law', 'legal');
    const second = await bulk.renameTag('politics', 'policy');
    assert.strictEqual(second, null);
    assert.ok(notices.some((n) => /still being made/.test(n.text)));
    await first;
  });

  /* -- the dialogs ------------------------------------------------------------ */

  await t('Add properties: folders as chips, a live count, and the button names it', async () => {
    const v = makeVault({
      'IR/IR.md': note({ status: 'done' }), 'IR/a.md': '', 'IR/Sub/b.md': note({ status: 'x' }), 'Books/c.md': '',
    });
    const { plugin, bulk } = makePlugin(v);
    const modal = new R.AddPropertiesModal(plugin, [v.folders.IR]);
    modal.open();
    const el = modal.contentEl;
    const button = el.querySelector('.modal-button-container .mod-cta');
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-bulk-chip-name')).map((c) => c.textContent), ['IR']);
    assert.strictEqual(button.disabled, true, 'enabled with nothing named');
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /Name a property/);

    const name = el.querySelector('.dr-bulk-name input');
    change(name, 'status');
    assert.ok(el.querySelector('.dr-bulk-type').classList.contains('is-locked'), 'a known name should bring its type');
    const value = el.querySelector('.dr-bulk-value input');
    type(value, 'review');
    await settle();
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /Adds “status” to 1 of the 3 notes/);
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /2 notes already have it/);
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /2 notes already have a “status” of their own, and keep it\./);
    assert.strictEqual(button.textContent, 'Add to 1 note');

    const select = el.querySelectorAll('.dr-bulk-option select')[1];
    select.value = 'replace';
    select.dispatchEvent(new window.Event('change'));
    assert.strictEqual(button.textContent, 'Add to 3 notes');
    const warning = el.querySelector('.dr-bulk-line.is-warning');
    assert.ok(warning && /Replaces the “status” values 2 notes already have\./.test(warning.textContent), 'replacing says what it overwrites');

    const scope = el.querySelector('.dr-bulk-option select');
    scope.value = 'direct';
    scope.dispatchEvent(new window.Event('change'));
    assert.strictEqual(button.textContent, 'Add to 2 notes', 'the subfolder is still counted');

    // Another folder, chosen from the picker.
    click(el.querySelector('.dr-bulk-chip.is-add'));
    pickers.pop().onChooseItem(v.folders.Books);
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-bulk-chip-name')).map((c) => c.textContent), ['IR', 'Books']);
    assert.strictEqual(button.textContent, 'Add to 3 notes');

    notices.length = 0;
    click(button);
    await settle(150);
    assert.ok(!modal.modalEl.isConnected, 'still open');
    ['IR/IR.md', 'IR/a.md', 'Books/c.md'].forEach((p) => assert.strictEqual(v.fm(p).status, 'review', p));
    assert.strictEqual(v.fm('IR/Sub/b.md').status, 'x');
    const done = lastNotice();
    assert.match(done.text, /Added “status” to 3 notes\./);
    const undo = done.message.querySelector('.dr-bulk-undo');
    assert.ok(undo, 'no Undo in the notice');
    click(undo);
    await settle(150);
    assert.strictEqual(v.fm('IR/IR.md').status, 'done');
    assert.ok(!('status' in v.fm('IR/a.md')));
    assert.strictEqual(bulk.last, null);
  });

  await t('Add properties: several at once, a new list, and what stops it', async () => {
    const v = makeVault({ 'F/a.md': note({ Topics: ['x'] }), 'F/b.md': '' });
    const { plugin } = makePlugin(v);
    const modal = new R.AddPropertiesModal(plugin, [v.folders.F]);
    modal.open();
    const el = modal.contentEl;
    const summary = () => el.querySelector('.dr-bulk-summary').textContent;
    change(el.querySelector('.dr-bulk-name input'), 'rating');
    // New: its type is chosen here.
    click(el.querySelector('.dr-bulk-type'));
    const typeMenu = menus.pop();
    typeMenu.items.find((i) => i.title === 'Number').click();
    assert.strictEqual(el.querySelector('.dr-bulk-value input').getAttribute('inputmode'), 'decimal');
    type(el.querySelector('.dr-bulk-value input'), '4');

    click(el.querySelector('.dr-bulk-add'));
    const names = el.querySelectorAll('.dr-bulk-name input');
    change(names[1], 'RATING');
    await settle();
    assert.match(summary(), /“RATING” is listed twice/);
    change(names[1], 'topics');
    const listField = el.querySelectorAll('.dr-bulk-value input')[1];
    assert.match(listField.placeholder, /separated by commas/);
    type(listField, 'y, x');
    await settle();
    assert.match(summary(), /Adds “rating” and “topics” to all 2 notes/);
    enter(listField);
    await settle(150);
    assert.strictEqual(v.fm('F/a.md').rating, 4);
    assert.deepStrictEqual(v.fm('F/a.md').Topics, ['x', 'y'], 'the list lost an item or took a repeat');
    assert.deepStrictEqual(v.fm('F/b.md').topics, ['y', 'x']);
    assert.strictEqual(v.types.rating, 'number');

    const empty = new R.AddPropertiesModal(plugin, []);
    empty.open();
    assert.match(empty.contentEl.querySelector('.dr-bulk-summary').textContent, /Choose the folders/);
    assert.strictEqual(empty.contentEl.querySelector('.dr-bulk-chip.is-add').textContent, 'Choose a folder');
    empty.close();
  });

  await t('Add properties: only folder notes, and the folders without one named', async () => {
    const v = makeVault({ 'A/A.md': '', 'A/x.md': '', 'B/y.md': '' });
    const { plugin } = makePlugin(v);
    const modal = new R.AddPropertiesModal(plugin, [v.folders.A, v.folders.B]);
    modal.open();
    const el = modal.contentEl;
    const scope = el.querySelector('.dr-bulk-option select');
    scope.value = 'folder-notes';
    scope.dispatchEvent(new window.Event('change'));
    change(el.querySelector('.dr-bulk-name input'), 'kind');
    await settle();
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /“B” has no folder note, so it's skipped/);
    assert.strictEqual(el.querySelector('.mod-cta').textContent, 'Add to 1 note');
    modal.close();
    assert.strictEqual(document.querySelectorAll('.dr-suggest').length, 0, 'suggestion lists left behind');
  });

  await t('Rename property: starts from the one chosen, shows the clash and the bases, and Enter renames', async () => {
    const v = vaultForRename();
    const { plugin } = makePlugin(v);
    const modal = new R.RenamePropertyModal(plugin, 'domain');
    modal.open();
    await settle(20);
    const el = modal.contentEl;
    const [from, to] = el.querySelectorAll('.dr-bulk-input input');
    assert.strictEqual(from.value, 'domain');
    assert.strictEqual(to.value, 'domain', 'the new name starts as the old, to edit');
    assert.match(el.querySelector('.dr-bulk-hint').textContent, /In 3 notes/);
    type(to, 'field');
    await settle(150);
    const text = el.querySelector('.dr-bulk-summary').textContent;
    assert.match(text, /Renames it in 2 notes/);
    assert.match(text, /1 note already has “field” too/);
    assert.match(text, /1 note has both, with different values/);
    assert.match(text, /Also changes 2 bases that use it: (Dash and Reading|Reading and Dash)/);
    assert.match(text, /And in Design Redux: Search categories, Album columns and Notes table columns/);
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-bulk-note')).map((n) => n.textContent), ['c']);
    assert.strictEqual(el.querySelector('.mod-cta').textContent, 'Rename in 2 notes');
    enter(to);
    await settle(200);
    assert.strictEqual(v.fm('IR/a.md').field, 'Law');
    assert.match(lastNotice().text, /Renamed “domain” to “field” in 2 notes and 2 bases\. 1 note kept both, as the values differ: c\./);
  });

  await t('Rename property: the same name, where some notes write it otherwise, makes them one', async () => {
    const v = vaultForRename();
    const { plugin } = makePlugin(v);
    const modal = new R.RenamePropertyModal(plugin, 'domain', 'domain');
    modal.open();
    await settle(150);
    const el = modal.contentEl;
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /Changes its capitals in 1 note/);
    assert.strictEqual(el.querySelector('.mod-cta').disabled, false);
    click(el.querySelector('.mod-cta'));
    await settle(200);
    assert.ok('domain' in v.fm('IR/b.md') && !('Domain' in v.fm('IR/b.md')));
    assert.match(lastNotice().text, /Wrote “domain” the same way in 1 note/);
  });

  await t("Rename property: a clashing note's name opens it", async () => {
    const v = vaultForRename();
    const { plugin } = makePlugin(v);
    const modal = new R.RenamePropertyModal(plugin, 'domain');
    modal.open();
    await settle(20);
    type(modal.contentEl.querySelectorAll('.dr-bulk-input input')[1], 'field');
    await settle(150);
    click(modal.contentEl.querySelector('.dr-bulk-note'));
    assert.deepStrictEqual(v.opened.map((f) => f.path), ['IR/c.md']);
    assert.ok(!modal.modalEl.isConnected);
  });

  await t("Rename property: nothing happens until there's a new name, and warnings for tags", async () => {
    const v = makeVault({ 'a.md': note({ tags: ['x'], kw: ['y'] }) });
    const { plugin } = makePlugin(v);
    const modal = new R.RenamePropertyModal(plugin);
    modal.open();
    await settle(20);
    const el = modal.contentEl;
    const [from, to] = el.querySelectorAll('.dr-bulk-input input');
    assert.strictEqual(el.querySelector('.mod-cta').disabled, true);
    type(from, 'TAGS');
    type(to, 'keywords');
    await settle(150);
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /Obsidian reads tags from “tags”; renamed, these stop being tags/);
    type(from, 'kw');
    type(to, 'Tags');
    await settle(150);
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /these values will be tags/);
    type(from, 'nothing');
    await settle(150);
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /No note has a property called “nothing”/);
    assert.strictEqual(el.querySelector('.mod-cta').disabled, true);
    modal.close();
  });

  await t('Rename tag: the plan in words, and the rename made', async () => {
    const v = vaultForTags();
    const { plugin } = makePlugin(v);
    const modal = new R.RenameTagModal(plugin, '#law');
    modal.open();
    await settle(20);
    const el = modal.contentEl;
    const [from, to] = el.querySelectorAll('.dr-bulk-input input');
    assert.strictEqual(from.value, 'law');
    assert.match(el.querySelector('.dr-bulk-hint').textContent, /On 3 notes, with 1 tag beneath it/);
    type(to, '#legal');
    await settle(150);
    const text = el.querySelector('.dr-bulk-summary').textContent;
    assert.match(text, /Renames it on 3 notes: in the properties of 2, and the text of 2\./);
    assert.match(text, /#law\/court becomes #legal\/court/);
    assert.match(text, /#legal is already on 1 note; the two become one/);
    assert.match(text, /Also changes 1 base that tests for it: Cases/);
    type(to, 'le gal');
    await settle(150);
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /can't contain spaces/);
    assert.strictEqual(el.querySelector('.mod-cta').disabled, true);
    type(to, 'legal');
    await settle(150);
    click(el.querySelector('.mod-cta'));
    await settle(200);
    assert.strictEqual(v.text('c.md'), 'Only in the text: #legal here.\n');
    assert.match(lastNotice().text, /Renamed #law to #legal on 3 notes and in 1 base\./);
  });

  await t('the suggestion list picks with Enter instead of renaming', async () => {
    // "domain" is a property in its own right, and "domains" is offered for it.
    const v = makeVault({ 'a.md': note({ domain: 'x' }), 'b.md': note({ domains: ['y'] }) });
    const { plugin, bulk } = makePlugin(v);
    const modal = new R.RenamePropertyModal(plugin);
    modal.open();
    await settle(20);
    const [from, to] = modal.contentEl.querySelectorAll('.dr-bulk-input input');
    type(to, 'field');
    from.dispatchEvent(new window.Event('focus'));
    type(from, 'domain');
    await settle(100);
    const list = modal.suggests[0];
    assert.ok(list.classList.contains('is-open'), 'no suggestions');
    from.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    enter(from);
    await settle(150);
    assert.strictEqual(from.value, 'domains');
    assert.strictEqual(bulk.last, null, 'Enter on a suggestion renamed');
    assert.strictEqual(v.fm('a.md').domain, 'x');
    assert.ok(modal.modalEl.isConnected);
    modal.close();
  });

  /* -- where they're reached from ---------------------------------------------- */

  await t('the Properties window lists the properties: values, how many have each, fill in, pick, rename in place', async () => {
    const v = vaultForRename();
    const { plugin } = makePlugin(v);
    const modal = new R.PropertyToolsModal(plugin, [v.folders.IR]);
    modal.open();
    await settle(20);
    const el = modal.contentEl;
    const rows = () => Array.from(el.querySelectorAll('.dr-plist-row'));
    const foot = () => Array.from(el.querySelectorAll('.dr-plist-foot button')).map((b) => b.textContent);
    assert.deepStrictEqual(rows().map((r) => r.querySelector('.dr-plist-name').textContent), ['domain', 'field', 'other', 'status']);
    const first = rows()[0];
    assert.strictEqual(first.querySelector('.dr-plist-values').textContent, 'Law');
    assert.strictEqual(first.querySelector('.dr-plist-cover').textContent, '3 of 4');
    assert.strictEqual(first.querySelector('.dr-plist-fill').textContent, 'Fill in 1');
    assert.strictEqual(el.querySelector('.dr-plist-count').textContent, '4 notes');
    assert.deepStrictEqual(foot(), ['Add property', 'Defaults for new notes']);

    // Fill in opens as a sheet, for that property; back returns to the list.
    click(first.querySelector('.dr-plist-fill'));
    assert.ok(modal.tool instanceof R.MissingPropertyModal);
    assert.strictEqual(modal.tool.key, 'domain');
    click(modal.titleEl.querySelector('.dr-sheet-back'));
    assert.ok(modal.tool instanceof R.PropertyListTool);

    // Two picked: Remove, and Merge.
    click(rows()[1].querySelector('.dr-plist-pick'));
    assert.deepStrictEqual(foot(), ['Clear', 'Remove', 'Merge…']);
    assert.strictEqual(el.querySelector('.dr-plist-merge').disabled, true, 'one is not enough to merge');
    click(rows()[3].querySelector('.dr-plist-pick'));
    assert.strictEqual(el.querySelector('.dr-plist-merge').disabled, false);
    click(el.querySelector('.dr-plist-merge'));
    assert.ok(modal.tool instanceof R.MergePropertiesModal);
    assert.deepStrictEqual(modal.tool.names, ['field', 'status']);
    click(modal.titleEl.querySelector('.dr-sheet-back'));

    // A name renamed where it's shown.
    click(rows()[0].querySelector('.dr-plist-name'));
    const input = el.querySelector('input.dr-plist-name-edit');
    assert.ok(input, 'the name became a field');
    input.value = 'area';
    enter(input);
    await settle(200);
    assert.strictEqual(v.fm('IR/a.md').area, 'Law');
    assert.ok(!('domain' in v.fm('IR/a.md')));
    assert.match(lastNotice().text, /Renamed “domain” to “area”/);
    modal.close();
  });

  await t('with nothing chosen, the window lists every note’s properties', async () => {
    const v = vaultForRename();
    const { plugin } = makePlugin(v);
    const modal = new R.PropertyToolsModal(plugin, []);
    modal.open();
    await settle(20);
    const el = modal.contentEl;
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-bulk-chip-name')).map((c) => c.textContent), ['All notes']);
    assert.ok(el.querySelectorAll('.dr-plist-row').length >= 4);
    assert.deepStrictEqual(Array.from(el.querySelectorAll('.dr-plist-foot button')).map((b) => b.textContent), ['Add property']);
    modal.close();
  });

  await t("menus: a folder's, several chosen, and a tag under the cursor", () => {
    const v = makeVault({ 'IR/a.md': 'Some #law/court text\n', 'b.md': '', 'img.png': '' });
    const { editing } = makePlugin(v);
    editing.register();
    const menu = () => new Menu();

    const folderMenu = menu();
    v.handlers['file-menu'](folderMenu, v.folders.IR);
    assert.deepStrictEqual(folderMenu.items.map((i) => i.title),
      ['Properties…']);
    const noteMenu = menu();
    v.handlers['file-menu'](noteMenu, v.file('b.md'));
    assert.strictEqual(noteMenu.items.length, 0);
    const rootMenu = menu();
    v.handlers['file-menu'](rootMenu, v.root);
    assert.strictEqual(rootMenu.items.length, 0);

    const several = menu();
    v.handlers['files-menu'](several, [v.folders.IR, v.file('b.md'), v.file('img.png')]);
    assert.deepStrictEqual(several.items.map((i) => i.title),
      ['Properties of 1 folder and 1 note…']);
    several.items[0].click();
    const opened = modals.pop();
    // One window: the properties in what was chosen, each tool a sheet over them.
    assert.ok(opened instanceof R.PropertyToolsModal);
    assert.ok(opened.tool instanceof R.PropertyListTool);
    assert.deepStrictEqual(opened.tool.targets.map((x) => x.path), ['IR', 'b.md']);
    const foot = () => Array.from(opened.contentEl.querySelectorAll('.dr-plist-foot button')).map((b) => b.textContent);
    assert.deepStrictEqual(foot(), ['Add property'], 'no Defaults for several');
    opened.openSheet('remove', { keys: ['x'] });
    assert.ok(opened.tool instanceof R.RemovePropertiesModal);
    assert.deepStrictEqual(opened.tool.targets.map((x) => x.path), ['IR', 'b.md'], 'the choice carries into a sheet');
    assert.strictEqual(opened.titleEl.querySelector('.dr-sheet-title').textContent, 'Remove properties');
    click(opened.titleEl.querySelector('.dr-sheet-back'));
    assert.ok(opened.tool instanceof R.PropertyListTool, 'back to the list');
    opened.openSheet('merge', { keys: ['x'] });
    assert.ok(opened.tool instanceof R.MergePropertiesModal);
    opened.showList();
    assert.deepStrictEqual(opened.tool.targets.map((x) => x.path), ['IR', 'b.md'], 'and back again past Merge, which has none');
    opened.close();
    folderMenu.items[0].click();
    const one = modals.pop();
    assert.deepStrictEqual(Array.from(one.contentEl.querySelectorAll('.dr-plist-foot button')).map((b) => b.textContent),
      ['Add property', 'Defaults for new notes']);
    one.close();

    const onTag = menu();
    v.handlers['editor-menu'](onTag, { getCursor: () => ({ line: 0, ch: 8 }) }, { file: v.file('IR/a.md') });
    assert.deepStrictEqual(onTag.items.map((i) => i.title), ['Rename #law/court everywhere…']);
    const offTag = menu();
    v.handlers['editor-menu'](offTag, { getCursor: () => ({ line: 0, ch: 1 }) }, { file: v.file('IR/a.md') });
    assert.strictEqual(offTag.items.length, 0);
  });

  await t("the properties panel's menu renames a property in every note", () => {
    const v = makeVault({ 'a.md': note({ domain: 'x' }) });
    const { plugin } = makePlugin(v);
    const popupEl = document.body.appendChild(document.createElement('div'));
    const section = new R.PropertiesSection({ plugin, popupEl });
    section.mount(popupEl, v.file('a.md'));
    click(popupEl.querySelector('.dr-row[data-key="domain"] .dr-key-icon'));
    const m = menus.pop();
    const item = m.items.find((i) => i.title === 'Rename in every note…');
    assert.ok(item, `not offered: ${m.items.map((i) => i.title)}`);
    item.click();
    const opened = modals.pop();
    assert.ok(opened instanceof R.RenamePropertyModal);
    assert.strictEqual(opened.from, 'domain');
    opened.close();
    popupEl.remove();
  });

  await t("a property's menu sets its value for the whole album, asking before it replaces a note's own, with one Undo", async () => {
    const v = makeVault({
      'IR/IR.md': note({ cover: 'x.png' }),
      'IR/a.md': note({ status: 'done' }),
      'IR/b.md': 'Nothing yet\n',
      'IR/c.md': note({ status: 'draft' }),
      'IR/Sub/d.md': '',
    });
    const { plugin, bulk } = makePlugin(v);
    plugin.isFolderNote = (f) => !!f.parent && f.basename === f.parent.name;
    const album = new R.AlbumProperty(plugin);
    plugin.features.push(album);
    assert.strictEqual(R.DEFAULTS.propertyForAlbum, true);

    // Offered on the row's menu, under the album's name.
    const popupEl = document.body.appendChild(document.createElement('div'));
    const section = new R.PropertiesSection({ plugin, popupEl });
    section.mount(popupEl, v.file('IR/a.md'));
    click(popupEl.querySelector('.dr-row[data-key="status"] .dr-key-icon'));
    const item = menus.pop().items.find((i) => i.title === 'Set for all of IR');
    assert.ok(item, 'not offered');
    const before = v.text('IR/c.md');
    item.click();
    await settle();
    // c has its own: asked first. Cancel leaves everything.
    let ask = modals.pop();
    assert.ok(ask.contentEl.textContent.includes('1 note already has a value'));
    Array.from(ask.contentEl.querySelectorAll('button')).find((b) => b.textContent === 'Cancel').click();
    await settle();
    assert.strictEqual(v.text('IR/c.md'), before);
    assert.strictEqual(v.writes.length, 0);

    const done = album.apply(v.file('IR/a.md'), 'status');
    await settle();
    ask = modals.pop();
    Array.from(ask.contentEl.querySelectorAll('button')).find((b) => b.textContent === 'Replace').click();
    const record = await done;
    assert.strictEqual(v.fm('IR/b.md').status, 'done');
    assert.strictEqual(v.fm('IR/c.md').status, 'done');
    assert.strictEqual(v.fm('IR/IR.md').status, undefined, 'the folder note stands for the album');
    assert.strictEqual(v.fm('IR/Sub/d.md').status, undefined, 'only the album, not the folders in it');
    assert.strictEqual(bulk.last, record);
    await bulk.undo();
    assert.strictEqual(v.text('IR/c.md'), before);

    // Off: not on the menu.
    plugin.settings.propertyForAlbum = false;
    click(popupEl.querySelector('.dr-row[data-key="status"] .dr-key-icon'));
    assert.ok(!menus.pop().items.some((i) => i.title === 'Set for all of IR'));
    popupEl.remove();
  });

  await t('the commands are there, and Undo only when there is something to undo', async () => {
    const v = makeVault({ 'F/a.md': '' });
    const { bulk, editing } = makePlugin(v);
    const cmds = Object.fromEntries(editing.commands().map((c) => [c.id, c]));
    assert.deepStrictEqual(Object.keys(cmds), ['add-properties-to-folders', 'rename-property-everywhere', 'merge-properties', 'rename-tag-everywhere',
      'remove-properties-from-folders', 'rename-value-everywhere', 'change-property-type', 'find-missing-properties',
      'folder-default-properties', 'undo-bulk-change']);
    assert.strictEqual(cmds['undo-bulk-change'].check(), false);
    await bulk.addProperties([v.file('F/a.md')], [{ key: 'x', value: 1 }], false);
    assert.strictEqual(cmds['undo-bulk-change'].check(), true);
    cmds['rename-tag-everywhere'].run();
    const opened = modals.pop();
    assert.ok(opened instanceof R.RenameTagModal);
    opened.close();
  });


  /* -- property tools ------------------------------------------------------ */

  await t('a value renamed on its own, in a list (merged), as a number, and as a link', () => {
    const fm = { Domain: 'IR', tags: ['x'] };
    assert.strictEqual(R.renameValueIn(fm, 'domain', 'IR', 'International Relations'), true);
    assert.strictEqual(fm.Domain, 'International Relations');
    const list = { topics: ['IR', 'Law', 'International Relations'] };
    R.renameValueIn(list, 'topics', 'IR', 'International Relations');
    assert.deepStrictEqual(list.topics, ['International Relations', 'Law']);
    const num = { rating: 4 };
    R.renameValueIn(num, 'rating', '4', '5');
    assert.strictEqual(num.rating, 5, 'a number stays a number');
    const links = { parent: '[[Law|Legal studies]]', seeAlso: ['[[Law#Courts]]', '[[Politics]]'] };
    R.renameValueIn(links, 'parent', 'Law', 'Jurisprudence');
    R.renameValueIn(links, 'seeAlso', 'Law', 'Jurisprudence');
    assert.strictEqual(links.parent, '[[Jurisprudence|Legal studies]]');
    assert.deepStrictEqual(links.seeAlso, ['[[Jurisprudence#Courts]]', '[[Politics]]']);
    assert.strictEqual(R.renameValueIn({ domain: 'IRL' }, 'domain', 'IR', 'x'), false, 'part of a value');
  });

  await t('removing properties, whatever case; and converting values between types', () => {
    const fm = { Status: 'x', domain: 'y', keep: 1 };
    assert.strictEqual(R.removePropertiesFrom(fm, ['status', 'DOMAIN']), true);
    assert.deepStrictEqual(fm, { keep: 1 });
    const c = (v, t) => R.convertValue(v, t);
    assert.deepStrictEqual(c('a, b', 'multitext'), { ok: true, value: ['a', 'b'] });
    assert.deepStrictEqual(c(['#a', 'b c'], 'tags'), { ok: true, value: ['a', 'b', 'c'] });
    assert.deepStrictEqual(c(['a', 'b'], 'text'), { ok: true, value: 'a, b' });
    assert.deepStrictEqual(c('1,200', 'number'), { ok: true, value: 1200 });
    assert.deepStrictEqual(c('many', 'number'), { ok: false });
    assert.deepStrictEqual(c('yes', 'checkbox'), { ok: true, value: true });
    assert.deepStrictEqual(c('maybe', 'checkbox'), { ok: false });
    assert.deepStrictEqual(c('2026-09-27T14:05', 'date'), { ok: true, value: '2026-09-27' });
    assert.deepStrictEqual(c('2026-09-27', 'datetime'), { ok: true, value: '2026-09-27T00:00' });
    assert.deepStrictEqual(c('soon', 'date'), { ok: false });
    assert.deepStrictEqual(c(null, 'number'), { ok: true, value: null }, 'nothing stays nothing');
    assert.strictEqual(R.parseDateText('March 3, 2024').date, '2024-03-03');
  });

  await t('in bases, a value is renamed where it is compared with its property, and nowhere else', () => {
    const r = (e) => R.renameInExpression(e, { value: ['status', 'draft', 'in progress'] });
    assert.strictEqual(r('status == "draft"'), 'status == "in progress"');
    assert.strictEqual(r("note[\"status\"] != 'draft'"), "note[\"status\"] != 'in progress'");
    assert.strictEqual(r('note.status.contains("draft")'), 'note.status.contains("in progress")');
    assert.strictEqual(r('"draft" == status'), '"in progress" == status');
    assert.strictEqual(r('kind == "draft" && status == "drafted"'), 'kind == "draft" && status == "drafted"');
    assert.strictEqual(r('mystatus == "draft"'), 'mystatus == "draft"');
  });

  const vaultForTools = () => makeVault({
    'IR/a.md': note({ domain: 'IR', status: 'draft' }),
    'IR/b.md': note({ domain: ['IR', 'Law'], rating: '4' }),
    'IR/c.md': note({ status: 'done', rating: 'lots' }),
    'IR/Sub/d.md': note({ domain: 'Law' }),
    'Plan.base': 'filters:\n  and:\n    - domain == "IR"\nviews:\n  - type: table\n    name: Table\n',
  });

  await t('renaming a value everywhere, bases included, and undoing it', async () => {
    const v = vaultForTools();
    const { bulk } = makePlugin(v);
    const before = new Map(v.files.map((f) => [f, v.texts.get(f)]));
    const plan = bulk.planValueRename('domain', 'IR', 'International Relations');
    assert.deepStrictEqual(plan.files.map((f) => f.path), ['IR/a.md', 'IR/b.md']);
    const record = await bulk.renameValue('domain', 'IR', 'International Relations');
    assert.strictEqual(v.fm('IR/a.md').domain, 'International Relations');
    assert.deepStrictEqual(v.fm('IR/b.md').domain, ['International Relations', 'Law']);
    assert.ok(v.text('Plan.base').includes('domain == "International Relations"'));
    assert.ok(!v.writes.includes('IR/c.md') && !v.writes.includes('IR/Sub/d.md'));
    assert.strictEqual(record.bases.length, 1);
    await bulk.undo();
    v.files.forEach((f) => assert.strictEqual(v.texts.get(f), before.get(f), f.path));
  });

  await t('removing properties from a folder, subfolders included, and undoing it', async () => {
    const v = vaultForTools();
    const { bulk } = makePlugin(v);
    const files = bulk.notesFor([v.folders.IR], 'deep');
    assert.deepStrictEqual(R.propertiesIn(v.app, files).map((p) => [p.name, p.count]), [['domain', 3], ['rating', 2], ['status', 2]]);
    await bulk.removeProperties(files, ['domain']);
    assert.ok(files.every((f) => !('domain' in v.fm(f.path))));
    assert.strictEqual(v.fm('IR/a.md').status, 'draft', 'another property went too');
    assert.ok(!v.writes.includes('IR/c.md'), 'a note without it was written');
    await bulk.undo();
    assert.strictEqual(v.fm('IR/Sub/d.md').domain, 'Law');
  });

  await t("changing a type converts what can be, names what can't, and undo puts the type back", async () => {
    const v = vaultForTools();
    const { bulk } = makePlugin(v);
    const plan = bulk.planTypeChange('rating', 'number');
    assert.deepStrictEqual(plan.convert.map((f) => f.path), ['IR/b.md']);
    assert.deepStrictEqual(plan.stuck.map((f) => f.path), ['IR/c.md']);
    const record = await bulk.changeType('rating', 'number');
    assert.strictEqual(v.fm('IR/b.md').rating, 4);
    assert.strictEqual(v.fm('IR/c.md').rating, 'lots', 'an unconvertible value was changed');
    assert.strictEqual(v.types.rating, 'number');
    assert.deepStrictEqual(record.stuck.map((f) => f.path), ['IR/c.md']);
    await bulk.undo();
    assert.strictEqual(v.fm('IR/b.md').rating, '4');
    assert.ok(!v.types.rating || v.types.rating === 'text', 'the type stayed');
  });

  await t('finding notes missing a property, and filling them', async () => {
    const v = vaultForTools();
    const { bulk } = makePlugin(v);
    const files = bulk.notesFor([v.folders.IR], 'deep');
    const missing = bulk.missing(files, 'Status');
    assert.deepStrictEqual(missing.map((f) => f.path), ['IR/b.md', 'IR/Sub/d.md']);
    await bulk.fill(missing, 'status', 'todo', 'text');
    assert.strictEqual(v.fm('IR/b.md').status, 'todo');
    assert.strictEqual(v.fm('IR/a.md').status, 'draft', 'a note that had it was filled');
  });

  await t('folder defaults: nearest folder first, given only what a new note lacks, a moment after', async () => {
    const v = makeVault({ 'IR/x.md': '', 'IR/Sub/y.md': '', 'IR/Sub/Sub.md': '' });
    const { plugin, editing } = makePlugin(v);
    plugin.settings.folderDefaults = {
      IR: [{ key: 'domain', value: 'IR' }, { key: 'status', value: 'draft' }],
      'IR/Sub': [{ key: 'status', value: 'reading' }, { key: 'topics', value: ['a'] }],
    };
    const y = v.file('IR/Sub/y.md');
    assert.deepStrictEqual(editing.defaultsFor(y).map((p) => [p.key, JSON.stringify(p.value)]),
      [['domain', '"IR"'], ['status', '"reading"'], ['topics', '["a"]']]);
    v.edit('IR/Sub/y.md', note({ status: 'from a template' }));
    editing.applyDefaults(y);
    await settle(200);
    assert.strictEqual(v.writes.length, 0, 'written straight away, before a template could fill it');
    await settle(750);
    assert.deepStrictEqual(v.fm('IR/Sub/y.md'), { status: 'from a template', domain: 'IR', topics: ['a'], position: {} });
    editing.applyDefaults(v.file('IR/Sub/Sub.md'));
    await settle(900);
    assert.strictEqual(v.text('IR/Sub/Sub.md'), '', "the folder's own note was given them");
    editing.followFolder(Object.assign(Object.create(Object.getPrototypeOf(v.folders.IR)), { path: 'Relations' }), 'IR');
    assert.deepStrictEqual(Object.keys(plugin.settings.folderDefaults).sort(), ['Relations', 'Relations/Sub']);
    editing.followFolder(Object.assign(Object.create(Object.getPrototypeOf(v.folders.IR)), { path: 'Relations/Sub' }), null);
    assert.deepStrictEqual(Object.keys(plugin.settings.folderDefaults), ['Relations']);
  });

  await t('Rename a value: starts from the one chosen, and says what changes', async () => {
    const v = vaultForTools();
    const { plugin } = makePlugin(v);
    const modal = new R.RenameValueModal(plugin, 'domain', 'IR');
    modal.open();
    await settle(20);
    const inputs = modal.contentEl.querySelectorAll('.dr-bulk-input input');
    assert.strictEqual(inputs[2].value, 'IR', 'the new value starts as the old, to edit');
    assert.match(modal.contentEl.querySelectorAll('.dr-bulk-hint')[1].textContent, /In 2 notes/);
    type(inputs[2], 'International Relations');
    await settle(150);
    const text = modal.contentEl.querySelector('.dr-bulk-summary').textContent;
    assert.match(text, /Changes “IR” to “International Relations” in 2 notes/);
    assert.match(text, /Also changes 1 base that filters on it: Plan/);
    enter(inputs[2]);
    await settle(150);
    assert.strictEqual(v.fm('IR/a.md').domain, 'International Relations');
  });

  await t('Remove properties: tick what goes, see how many notes change', async () => {
    const v = vaultForTools();
    const { plugin } = makePlugin(v);
    const modal = new R.RemovePropertiesModal(plugin, [v.folders.IR]);
    modal.open();
    const boxes = Array.from(modal.contentEl.querySelectorAll('.dr-bulk-check-row'));
    assert.deepStrictEqual(boxes.map((b) => b.querySelector('.dr-bulk-check-name').textContent), ['domain', 'rating', 'status']);
    assert.strictEqual(modal.contentEl.querySelector('.mod-cta').disabled, true);
    const status = boxes[2].querySelector('input');
    status.checked = true;
    status.dispatchEvent(new window.Event('change'));
    assert.match(modal.contentEl.querySelector('.dr-bulk-summary').textContent, /Removes “status” from 2 notes/);
    click(modal.contentEl.querySelector('.mod-cta'));
    await settle(150);
    assert.ok(!('status' in v.fm('IR/a.md')));
  });

  await t("Change type: the notes that can't be converted are named before anything happens", async () => {
    const v = vaultForTools();
    const { plugin } = makePlugin(v);
    const modal = new R.ChangeTypeModal(plugin, 'rating');
    modal.open();
    const select = modal.contentEl.querySelector('select');
    select.value = 'number';
    select.dispatchEvent(new window.Event('change'));
    const summary = modal.contentEl.querySelector('.dr-bulk-summary').textContent;
    assert.match(summary, /Makes “rating” number everywhere/);
    assert.match(summary, /Converts the value in 1 note/);
    assert.match(summary, /1 note has a value that can’t be number/);
    assert.deepStrictEqual(Array.from(modal.contentEl.querySelectorAll('.dr-bulk-note')).map((n) => n.textContent), ['c']);
    assert.strictEqual(modal.contentEl.querySelector('.mod-cta').textContent, 'Change and convert 1 note');
    modal.close();
  });

  await t('Find missing: each note fills on Enter, or all of them with one value', async () => {
    const v = vaultForTools();
    const { plugin } = makePlugin(v);
    const modal = new R.MissingPropertyModal(plugin, [v.folders.IR], 'status');
    modal.open();
    const rows = () => Array.from(modal.contentEl.querySelectorAll('.dr-bulk-missing-row'));
    assert.deepStrictEqual(rows().map((r) => r.querySelector('.dr-bulk-note').textContent), ['b', 'd']);
    const first = rows()[0].querySelector('input');
    first.value = 'reading';
    enter(first);
    await settle(50);
    assert.strictEqual(v.fm('IR/b.md').status, 'reading');
    assert.ok(rows()[0].classList.contains('is-done'));
    const all = modal.allInput;
    type(all, 'todo');
    await settle(100);
    assert.match(modal.contentEl.querySelector('.mod-cta').textContent, /Fill 1 note/);
    enter(all);
    await settle(150);
    assert.strictEqual(v.fm('IR/Sub/d.md').status, 'todo');
  });

  await t('Default properties: saved for the folder, and added to the notes there when asked', async () => {
    const v = vaultForTools();
    const { plugin } = makePlugin(v);
    const modal = new R.FolderDefaultsModal(plugin, v.folders.IR);
    modal.open();
    change(modal.contentEl.querySelector('.dr-bulk-name input'), 'course');
    type(modal.contentEl.querySelector('.dr-bulk-value input'), 'POL101');
    await settle(100);
    assert.strictEqual(modal.contentEl.querySelector('.mod-cta').textContent, 'Save');
    const also = modal.contentEl.querySelector('.dr-bulk-check input');
    also.checked = true;
    also.dispatchEvent(new window.Event('change'));
    assert.strictEqual(modal.contentEl.querySelector('.mod-cta').textContent, 'Save and add to 4 notes');
    click(modal.contentEl.querySelector('.mod-cta'));
    await settle(150);
    assert.deepStrictEqual(plugin.settings.folderDefaults.IR, [{ key: 'course', value: 'POL101', type: 'text' }]);
    assert.strictEqual(v.fm('IR/Sub/d.md').course, 'POL101');
    // Opened again, it shows what's saved.
    const again = new R.FolderDefaultsModal(plugin, v.folders.IR);
    again.open();
    assert.strictEqual(again.contentEl.querySelector('.dr-bulk-name input').value, 'course');
    assert.strictEqual(again.contentEl.querySelector('.dr-bulk-value input').value, 'POL101');
    again.close();
  });

  /* -- notes: properties written one way, undone only where unchanged ----- */

  await t('a write says what it changed, key by key; one that fails says so and changes nothing', async () => {
    const v = makeVault({ 'n.md': note({ status: 'draft', tags: ['law'], keep: 1 }, 'Body') });
    const { plugin } = makePlugin(v);
    const notes = new R.Notes(plugin);
    assert.deepStrictEqual(notes.props(v.file('n.md')), { status: 'draft', tags: ['law'], keep: 1 }, 'without Obsidian’s bookkeeping');
    assert.strictEqual(notes.get(v.file('n.md'), 'STATUS'), 'draft');
    const r = await notes.write(v.file('n.md'), (fm) => {
      fm.status = 'done';
      fm.tags.push('court');
      delete fm.keep;
      fm.area = 'IR';
    });
    assert.deepStrictEqual(r.before, { status: 'draft', tags: ['law'], keep: 1, area: undefined });
    assert.deepStrictEqual(r.after, { status: 'done', tags: ['law', 'court'], keep: undefined, area: 'IR' });
    assert.deepStrictEqual(r.order, ['status', 'tags', 'keep']);
    const was = notices.length;
    const failing = await notes.write(v.file('n.md'), () => { throw new Error('no'); }, { failure: 'Could not do it.' });
    assert.strictEqual(failing, null);
    assert.strictEqual(notices[was].message, 'Could not do it.');
  });

  await t('undo puts back what’s still as the change left it, keeps what was edited since, and a removed key returns to its place', async () => {
    const v = makeVault({ 'n.md': note({ status: 'draft', area: 'IR', year: 2001 }, 'Body'), 'm.md': note({ status: 'draft' }) });
    const { plugin } = makePlugin(v);
    const undos = [];
    plugin.offerUndo = (message, undo) => undos.push({ message, undo });
    const notes = new R.Notes(plugin);
    const a = await notes.write(v.file('n.md'), (fm) => { fm.status = 'done'; fm.area = 'Law'; delete fm.year; }, { undo: 'Changed n.' });
    const b = await notes.write(v.file('m.md'), (fm) => { fm.status = 'done'; });
    assert.strictEqual(undos.length, 1, 'only the one asked for offers Undo');
    // Edited since: area by hand.
    await v.app.fileManager.processFrontMatter(v.file('n.md'), (fm) => { fm.area = 'Politics'; });
    const was = notices.length;
    await undos[0].undo();
    assert.deepStrictEqual(v.fm('n.md'), { status: 'draft', year: 2001, area: 'Politics', position: {} });
    assert.deepStrictEqual(Object.keys(v.fm('n.md')).filter((k) => k !== 'position'), ['status', 'area', 'year'], 'year back in its place');
    assert.match(notices[was].message, /1 property changed since was kept as it is/);
    // Several at once: one step.
    let after = 0;
    notes.offerUndo('Both.', [b, null], () => after++);
    await undos[1].undo();
    assert.strictEqual(v.fm('m.md').status, 'draft');
    assert.strictEqual(after, 1);
    assert.strictEqual(notes.offerUndo('Nothing.', [{ before: {}, after: {} }]), null, 'nothing changed, nothing to undo');
  });

  /* -- only notes where, and notes left out ------------------------------- */

  await t('a condition holds on any item of a list, whatever the case or link brackets', () => {
    const fm = { Status: 'Draft', tags: ['law', 'court'], links: '[[Law]]', empty: '' };
    assert.ok(R.whereHolds(fm, { key: 'status', op: 'is', value: 'draft' }));
    assert.ok(!R.whereHolds(fm, { key: 'status', op: 'not', value: 'draft' }));
    assert.ok(R.whereHolds(fm, { key: 'tags', op: 'is', value: 'COURT' }));
    assert.ok(R.whereHolds(fm, { key: 'links', op: 'is', value: '[[law]]' }));
    assert.ok(R.whereHolds(fm, { key: 'tags', op: 'contains', value: 'our' }));
    assert.ok(R.whereHolds(fm, { key: 'empty', op: 'lacks', value: '' }));
    assert.ok(R.whereHolds(fm, { key: 'missing', op: 'lacks', value: '' }));
    assert.ok(R.whereHolds(fm, { key: 'missing', op: 'not', value: 'x' }), 'a note without it isn’t it');
    assert.ok(!R.whereHolds(fm, { key: 'empty', op: 'has', value: '' }));
  });

  await t('Add properties: only notes where…, and a note left out from the summary, then put back', async () => {
    const v = makeVault({
      'IR/a.md': note({ status: 'draft' }), 'IR/b.md': note({ status: 'done' }), 'IR/c.md': note({ status: 'Draft' }), 'IR/d.md': '',
    });
    const { plugin } = makePlugin(v);
    const modal = new R.AddPropertiesModal(plugin, [v.folders.IR]);
    modal.open();
    const el = modal.contentEl;
    const button = el.querySelector('.modal-button-container .mod-cta');
    change(el.querySelector('.dr-bulk-name input'), 'area');
    type(el.querySelector('.dr-bulk-value input'), 'IR');
    await settle();
    assert.strictEqual(button.textContent, 'Add to 4 notes');
    click(el.querySelector('.dr-bulk-where-add'));
    const row = el.querySelector('.dr-bulk-where-row');
    assert.ok(row, 'a condition row');
    type(row.querySelector('.dr-bulk-where-key'), 'status');
    type(row.querySelector('.dr-bulk-where-value'), 'draft');
    await settle();
    assert.strictEqual(button.textContent, 'Add to 2 notes', 'a and c, whatever the case');
    // Leave c out from the summary.
    const leave = [...el.querySelectorAll('.dr-bulk-leave')].find((x) => x.getAttribute('aria-label') === 'Leave out c');
    click(leave);
    assert.strictEqual(button.textContent, 'Add to 1 note');
    assert.match(el.querySelector('.dr-bulk-summary').textContent, /1 note left out/);
    click(el.querySelector('.dr-bulk-put-back'));
    assert.strictEqual(button.textContent, 'Add to 2 notes');
    // "has no value" needs no value; the condition removed brings them all back.
    const op = el.querySelector('.dr-bulk-where-op');
    change(op, 'lacks');
    assert.ok(el.querySelector('.dr-bulk-where-value').classList.contains('is-hidden'));
    assert.strictEqual(button.textContent, 'Add to 1 note', 'only d has no status');
    click(el.querySelector('.dr-bulk-where-row .dr-bulk-chip-remove'));
    assert.strictEqual(button.textContent, 'Add to 4 notes');
    // Then left out and applied: the note left out isn't touched.
    click([...el.querySelectorAll('.dr-bulk-leave')].find((x) => x.getAttribute('aria-label') === 'Leave out b'));
    click(button);
    await settle(150);
    assert.strictEqual(v.fm('IR/a.md').area, 'IR');
    assert.strictEqual(v.fm('IR/b.md').area, undefined);
  });

  await t('a long list of notes in the summary shows the rest when asked', async () => {
    const spec = {};
    for (let i = 0; i < 9; i++) spec[`F/n${i}.md`] = '';
    const v = makeVault(spec);
    const { plugin } = makePlugin(v);
    const modal = new R.AddPropertiesModal(plugin, [v.folders.F]);
    modal.open();
    const el = modal.contentEl;
    change(el.querySelector('.dr-bulk-name input'), 'area');
    type(el.querySelector('.dr-bulk-value input'), 'x');
    await settle();
    const more = el.querySelector('.dr-bulk-more');
    assert.ok(more, 'the notes it adds to are listed');
    assert.strictEqual(more.textContent, 'and 3 more');
    click(more);
    assert.strictEqual(el.querySelectorAll('.dr-bulk-summary .dr-bulk-note:not(.dr-bulk-put-back)').length, 9);
    assert.ok(!el.querySelector('.dr-bulk-more'));
  });

  /* -- pasting properties ------------------------------------------------ */

  await t('a paste plan says, property by property, what each mode would do', () => {
    const now = { Status: 'draft', tags: ['law'], empty: '' };
    const incoming = { status: 'done', tags: ['Law', 'court'], empty: 'x', fresh: 1, same: 'y' };
    now.same = 'y';
    const plan = (mode) => Object.fromEntries(R.propertyPastePlan(now, incoming, mode).map((r) => [r.key, r]));
    const add = plan('add');
    assert.strictEqual(add.Status.status, 'keep', 'matched whatever the case, under the note’s own name');
    assert.strictEqual(add.Status.apply, false);
    assert.strictEqual(add.tags.status, 'keep');
    assert.strictEqual(add.empty.status, 'add', 'an empty value counts as missing');
    assert.strictEqual(add.fresh.status, 'add');
    assert.strictEqual(add.same.status, 'same');
    assert.strictEqual(add.same.apply, false);
    const merge = plan('merge');
    assert.strictEqual(merge.tags.status, 'merge');
    assert.deepStrictEqual(merge.tags.value, ['law', 'court'], 'joined, each once whatever the case');
    assert.strictEqual(merge.Status.status, 'keep', 'text isn’t joined');
    const replace = plan('replace');
    assert.strictEqual(replace.Status.status, 'replace');
    assert.strictEqual(replace.Status.value, 'done');
    assert.deepStrictEqual(R.joinedValues('a', ['A', 'b']), ['a', 'b']);
  });

  await t('pasting shows what it would do, takes only what’s ticked, and undoes', async () => {
    const v = makeVault({ 'n.md': note({ status: 'draft', tags: ['law'] }, 'Body') });
    const { plugin } = makePlugin(v);
    const undos = [];
    plugin.offerUndo = (message, undo) => undos.push({ message, undo });
    const clip = new R.PropertyClipboard(plugin);
    const file = v.file('n.md');
    const modal = new R.PropertyPasteModal(clip, file, { status: 'done', tags: ['court'], area: 'IR' }, { mode: 'merge' });
    modal.open();
    const rows = () => [...modal.contentEl.querySelectorAll('.dr-paste-row')];
    assert.deepStrictEqual(rows().map((r) => r.dataset.status), ['keep', 'merge', 'add']);
    assert.strictEqual(modal.contentEl.querySelector('.mod-cta').textContent, 'Paste 2 properties');
    assert.ok(rows()[0].querySelector('.dr-paste-value').textContent.includes('draft → done'));
    // Replace mode: the text one would replace too.
    change(modal.contentEl.querySelector('.dr-paste-mode'), 'replace');
    assert.deepStrictEqual(rows().map((r) => r.dataset.status), ['replace', 'replace', 'add']);
    assert.strictEqual(modal.contentEl.querySelector('.mod-cta').textContent, 'Paste 3 properties');
    // Back to merge; the list left out; status ticked in, so it replaces.
    change(modal.contentEl.querySelector('.dr-paste-mode'), 'merge');
    const box = (i) => rows()[i].querySelector('input');
    box(1).checked = false;
    box(1).dispatchEvent(new window.Event('change'));
    box(0).checked = true;
    box(0).dispatchEvent(new window.Event('change'));
    assert.strictEqual(rows()[0].dataset.status, 'replace');
    assert.strictEqual(modal.contentEl.querySelector('.mod-cta').textContent, 'Paste 2 properties');
    click(modal.contentEl.querySelector('.mod-cta'));
    await settle();
    assert.deepStrictEqual(v.fm('n.md'), { status: 'done', tags: ['law'], area: 'IR', position: {} });
    assert.ok(v.text('n.md').endsWith('Body'));
    assert.strictEqual(undos.length, 1);
    await undos[0].undo();
    assert.deepStrictEqual(v.fm('n.md'), { status: 'draft', tags: ['law'], position: {} }, 'undone: the old value back, the added one gone');
  });

  await t('a property set is kept by name and applied like a paste, missing ones only', async () => {
    const v = makeVault({ 'a.md': note({ kind: 'case', court: 'ICJ', year: 2001 }), 'b.md': note({ kind: 'statute' }) });
    const { plugin } = makePlugin(v);
    plugin.offerUndo = () => {};
    const clip = new R.PropertyClipboard(plugin);
    await clip.keepSet('Case', { kind: 'case', court: '' });
    assert.deepStrictEqual(plugin.settings.propertySets, { Case: { kind: 'case', court: '' } });
    assert.ok(plugin.saved > 0);
    const before = modals.length;
    clip.chooseSet(v.file('b.md'));
    pickers.pop().onChoose({ name: 'Case' });
    const modal = modals[before];
    assert.ok(modal instanceof R.PropertyPasteModal);
    assert.strictEqual(modal.mode, 'add');
    assert.ok(!modal.contentEl.textContent.includes('Keep as a set'), 'a set isn’t offered to be kept again');
    click(modal.contentEl.querySelector('.mod-cta'));
    await settle();
    assert.deepStrictEqual(v.fm('b.md'), { kind: 'statute', court: '', position: {} }, 'its kind kept; the empty court added');
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
