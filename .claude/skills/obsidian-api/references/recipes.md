# Recipes

Small, correct patterns written against a plain `Plugin`. Check any API in
them with `scripts/obsidian-api.mjs <name>` before building on it.

## 1. Start without slowing startup

```js
export default class MyPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW, (leaf) => new MyView(leaf, this));      // register only
    this.addCommand({ id: 'open', name: 'Open', callback: () => this.open() });
    this.app.workspace.onLayoutReady(() => this.start());            // the real work
  }
  start() {
    const { vault, metadataCache } = this.app;
    this.index = buildIndex(this.app);                               // once
    this.registerEvent(vault.on('create', (f) => this.index.add(f))); // not fired per file at load now
    this.registerEvent(vault.on('delete', (f) => this.index.remove(f.path)));
    this.registerEvent(vault.on('rename', (f, old) => this.index.move(old, f)));
    this.registerEvent(metadataCache.on('changed', (f, _data, cache) => this.index.update(f, cache)));
  }
}
```

## 2. A view, safe with deferred tabs

```js
class MyView extends ItemView {
  getViewType() { return VIEW; }
  getDisplayText() { return 'My view'; }
  getIcon() { return 'list'; }
  async onOpen() { this.draw(); }
  async onClose() { this.contentEl.empty(); }
  draw() { /* build off-screen, then this.contentEl.replaceChildren(frag) */ }
}

redrawAll() {
  for (const leaf of this.app.workspace.getLeavesOfType(VIEW))
    if (leaf.view instanceof MyView) leaf.view.draw(); // deferred leaves are skipped, and draw on open
}

async open() {
  const ws = this.app.workspace;
  let leaf = ws.getLeavesOfType(VIEW)[0];
  if (!leaf) {
    leaf = ws.getLeaf(true);
    await leaf.setViewState({ type: VIEW, active: true });
  }
  await ws.revealLeaf(leaf); // async since 1.7.2; loads a deferred view
}
```

## 3. Open a note as the person clicked

```js
el.addEventListener('click', (evt) => {
  this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file); // Cmd or middle click: new tab
});
```

## 4. Change notes safely

```js
// Properties: atomic, Obsidian writes the YAML.
await this.app.fileManager.processFrontMatter(file, (fm) => { fm.status = 'done'; });

// A note that isn't open: atomic read-change-write.
await this.app.vault.process(file, (text) => text.replace(/^- \[ \]/gm, '- [x]'));

// The note being edited: through the editor, so cursor and undo history stay.
const editor = this.app.workspace.activeEditor?.editor;
editor?.replaceRange('text', editor.getCursor());

// Many notes: one at a time, and only those that change.
for (const file of files) {
  await this.app.vault.process(file, (text) => {
    const next = change(text);
    return next; // returning the same text still writes; filter files first when you can
  });
}
```

## 5. Move, rename, delete

```js
const to = normalizePath(`${folder.path}/${file.name}`);
await this.app.fileManager.renameFile(file, to); // rewrites links to it
const ok = await this.app.fileManager.trashFile(file); // honours the trash setting
if (ok === false) new Notice(`Couldn't delete ${file.name}`); // 1.15.1+: false when it couldn't trash; typed void until the typings catch up
```

## 6. Links in and out, without rescanning

```js
// Once, after links are first resolved:
this.app.metadataCache.on('resolved', () => { if (!this.backlinks) this.backlinks = invert(this.app.metadataCache.resolvedLinks); });
function invert(resolved) {
  const back = new Map();
  for (const [src, targets] of Object.entries(resolved))
    for (const t of Object.keys(targets)) (back.get(t) || back.set(t, new Set()).get(t)).add(src);
  return back;
}
// Then patch one source on metadata `changed`: drop it from every set, re-add from resolvedLinks[file.path].
const dest = this.app.metadataCache.getFirstLinkpathDest('Anarchy', file.path); // one link
```

## 7. Decorations for what is on screen

```js
import { ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const mark = Decoration.line({ class: 'my-hang' });
const visibleHangs = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const b = new RangeSetBuilder();
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        if (/^\s+\S/.test(line.text)) b.add(line.from, line.from, mark);
        pos = line.to + 1;
      }
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

// Switchable: keep one array, change it, then reconfigure once.
this.extensions = [];
this.registerEditorExtension(this.extensions);
const setOn = (on) => { this.extensions.length = 0; if (on) this.extensions.push(visibleHangs); this.app.workspace.updateOptions(); };
```

Inside any extension, the note: `state.field(editorInfoField).file`.

## 8. Reading view, without leaks

```js
class Live extends MarkdownRenderChild {
  onload() { this.registerInterval(window.setInterval(() => this.tick(), 1000)); }
  tick() { /* update this.containerEl */ }
}
this.registerMarkdownPostProcessor((el, ctx) => {
  const lists = el.querySelectorAll('ol');
  if (!lists.length) return;                    // most sections: nothing to do
  const info = ctx.getSectionInfo(el);          // { lineStart, lineEnd, text } or null
  lists.forEach((ol) => ctx.addChild(new Live(ol)));
});
```

## 9. A picker

```js
class FolderPicker extends FuzzySuggestModal {
  constructor(app, done) { super(app); this.done = done; }
  getItems() { return this.app.vault.getAllFolders(); } // fine: runs once, when opened
  getItemText(f) { return f.path; }
  onChooseItem(f) { this.done(f); }
}
new FolderPicker(this.app, (f) => move(file, f)).open();
```

## 10. Settings Obsidian draws and searches (1.13)

```js
class Tab extends PluginSettingTab {
  // 1.13+: used instead of display(); rows are found by Obsidian's settings search.
  getSettingDefinitions() {
    return [
      { name: 'Enabled', control: { type: 'toggle', key: 'enabled' } },
      { name: 'Sort by', control: { type: 'dropdown', key: 'sort', options: { name: 'Name', mtime: 'Last edited' } } },
      { name: 'Folder', control: { type: 'folder', key: 'folder', validate: (v) => (v ? undefined : 'Pick a folder') } },
      { type: 'group', heading: 'Advanced', items: [
        { name: 'Limit', control: { type: 'number', key: 'limit', min: 10, max: 5000 }, visible: () => this.plugin.settings.enabled },
      ] },
    ];
  }
  async setControlValue(key, value) {        // default writes this.plugin.settings and saves
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    this.plugin.apply();                     // react at once
  }
  display() { /* older Obsidian calls this; it isn't called when definitions are returned */ }
}
```

To redraw, call `this.update()` when the set of definitions changes, and
`this.refreshDomState()` when only `visible` or `disabled` should be
re-evaluated. Never call `display()`. Keep `getSettingDefinitions()` cheap,
with no I/O: Obsidian calls it once for search, and again only on
`update()`.

A `render` row doesn't save on its own, and the cleanup it returns may not
run if the window is destroyed. Secrets use `{ type: 'secret', key }` (it
stores in `app.secretStorage`), and buttons use an `action` row. A
`SettingDefinitionItem` can take an `id` (1.14) to stay distinct from a
sibling with the same name.

The settings window is its own document since 1.13: build with
`containerEl.createEl`, and reach the document as `containerEl.ownerDocument`.

## 11. Every window

```js
const apply = (doc) => doc.body.addClass('my-on');
apply(document);
this.app.workspace.iterateAllLeaves((leaf) => apply(leaf.view.containerEl.ownerDocument));
this.registerEvent(this.app.workspace.on('window-open', (win) => apply(win.doc)));
this.register(() => { /* remove the class from each document it was added to */ });

el.doc.createElement('div');            // the element's own document
el.win.requestAnimationFrame(draw);     // and window
if (target.instanceOf(HTMLElement)) {}  // works across windows; instanceof doesn't
window.setTimeout(save, 500);           // long-lived timers on the main window: one on a popout's
                                        // window never fires once that window closes (1.15.1)
```

## 12. Icons and internals

```js
addIcon('my-fold', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="…"/></svg>');
setIcon(button, 'my-fold');

const cmds = this.app.commands;          // internal: guard it, and have a way through
if (cmds && typeof cmds.executeCommandById === 'function') cmds.executeCommandById('app:open-settings');
```

## 13. A view inside Bases (1.10)

```js
class LedgerView extends BasesView {
  type = 'my-ledger';
  constructor(controller, containerEl) { super(controller); this.containerEl = containerEl; }
  onDataUpdated() {
    const frag = this.containerEl.doc.createDocumentFragment();
    for (const group of this.data.groupedData)
      for (const entry of group.entries) frag.createDiv({ text: entry.file.basename });
    this.containerEl.replaceChildren(frag);
  }
}
if (requireApiVersion('1.10.0'))
  this.registerBasesView('my-ledger', {
    name: 'Ledger', icon: 'list',
    factory: (controller, containerEl) => new LedgerView(controller, containerEl),
  });
```

Bases does the filtering, sorting and grouping from the `.base` file; the
view only draws. Values come as `Value` objects: `entry.getValue('note.status')`.

## 14. Network

```js
const res = await requestUrl({ url, method: 'GET', throw: false }); // no CORS limits
if (res.status === 200) use(res.json);
```

## 15. Guard what 1.15 added before the typings did

```js
import * as obsidian from 'obsidian';
export async function getPixi() {
  const load = /** @type {any} */ (obsidian).loadPixi;
  if (typeof load === 'function') return load(); // 1.15.0+: PIXI loads with the first graph
  return /** @type {any} */ (window).PIXI ?? null; // older: loaded at start-up
}
```

The same for `window.pele` (Pele, 1.15.0's Mermaid replacement, set once
`loadMermaid()` resolves) and `trashFile`'s boolean (recipe 5).

## 16. Syntax-tree node names, 1.15-safe

```js
import { syntaxTree } from '@codemirror/language';
// 1.15.0 added `formatting-*-end` to closing tokens: test segments, never the whole name.
const has = (node, seg) => node.name.split('_').includes(seg);
syntaxTree(state).iterate({
  from, to, // the visible range, never the whole document
  enter(node) { if (has(node, 'inline-code') && !has(node, 'formatting-code')) found(node.from, node.to); },
});
```

The tree is parsed lazily: what isn't parsed yet isn't there. A
`StateField` that rebuilds from the tree must also rebuild when
`syntaxTree(tr.state) !== syntaxTree(tr.startState)`. Use a `StateField`
only for decorations that must exist off screen or change line heights
(block widgets); use the `ViewPlugin` of recipe 7 for everything else.

## 17. A web worker inside one main.js

```js
// build.mjs: bundle *.worker.js to a string the plugin imports
const inlineWorker = { name: 'inline-worker', setup(b) {
  b.onLoad({ filter: /\.worker\.js$/ }, async (a) => {
    const r = await esbuild.build({ entryPoints: [a.path], bundle: true, write: false, format: 'iife', target: 'chrome138', minify: true });
    return { contents: `export default ${JSON.stringify(r.outputFiles[0].text)}`, loader: 'js' };
  });
} };

// src/parse.js
import source from './parse.worker.js';
export function startWorker(plugin) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);                  // fine once the worker exists
  plugin.register(() => worker.terminate());
  return (text) => new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = (e) => { port1.close(); resolve(e.data); };
    port1.onmessageerror = reject;
    worker.postMessage({ text }, [port2]);   // one channel per request: no id bookkeeping
  });
}
```

A worker has no `obsidian`, no `app` and no DOM: send it text and get back
data. For WASM, read the bytes with
``app.vault.adapter.readBinary(`${plugin.manifest.dir}/x.wasm`)`` and transfer
them, rather than inlining base64.

## 18. An index kept in IndexedDB between starts

```js
const name = (app) => `my-plugin-${app.appId}`; // IndexedDB is shared by every vault
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function openDb(app) {
  const r = indexedDB.open(name(app), 1);       // bump the version when the row shape changes
  r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'path' });
  return req(r);
}
export async function load(db, app) {
  const rows = await req(db.transaction('files').objectStore('files').getAll());
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const stale = app.vault.getMarkdownFiles().filter((f) => byPath.get(f.path)?.mtime !== f.stat.mtime);
  return { byPath, stale };                     // index only `stale`, at layout-ready
}
export function save(db, rows) {                // one transaction for many rows
  const tx = db.transaction('files', 'readwrite');
  for (const row of rows) tx.objectStore('files').put(row);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
```

Also drop the rows of files that are gone (`byPath` keys not in the vault),
and close the database in `register(() => db.close())`.

## 19. Index in chunks without blocking typing

```js
const yieldToUI = () => globalThis.scheduler?.yield
  ? globalThis.scheduler.yield()
  : new Promise((r) => window.setTimeout(r, 0));

export async function indexAll(files, work, signal) {
  let last = performance.now();
  for (const f of files) {
    if (signal?.aborted) return;
    work(f);
    if (performance.now() - last > 8) { await yieldToUI(); last = performance.now(); } // about half a frame
  }
}
// const ac = new AbortController(); plugin.register(() => ac.abort()); indexAll(stale, add, ac.signal);
```

## 20. A virtual list, without a framework

```js
export class VirtualList {
  constructor(el, rowHeight, render) {
    Object.assign(this, { el, rowHeight, render, items: [] });
    el.addClass('vl-scroller');
    this.spacer = el.createDiv({ cls: 'vl-spacer' });
    this.layer = el.createDiv({ cls: 'vl-layer' });
    this.queued = false;
    this.onScroll = () => { if (!this.queued) { this.queued = true; el.win.requestAnimationFrame(() => { this.queued = false; this.draw(); }); } };
    el.addEventListener('scroll', this.onScroll, { passive: true });
    this.ro = new el.win.ResizeObserver(() => this.draw()); this.ro.observe(el);
  }
  setItems(items) { this.items = items; this.spacer.style.setProperty('--vl-height', `${items.length * this.rowHeight}px`); this.draw(); }
  draw() {
    const { scrollTop, clientHeight } = this.el;
    const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - 5);
    const end = Math.min(this.items.length, Math.ceil((scrollTop + clientHeight) / this.rowHeight) + 5);
    const frag = this.el.doc.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const row = frag.createDiv({ cls: 'vl-row' });
      row.style.setProperty('--vl-y', `${i * this.rowHeight}px`);
      this.render(row, this.items[i]);
    }
    this.layer.replaceChildren(frag);            // one DOM write per frame
  }
  destroy() { this.ro.disconnect(); this.el.removeEventListener('scroll', this.onScroll); }
}
```

```css
.vl-scroller { overflow: auto; position: relative; contain: strict; }
.vl-spacer { height: var(--vl-height); }
.vl-layer { position: absolute; inset: 0 0 auto 0; }
.vl-row { position: absolute; left: 0; right: 0; transform: translateY(var(--vl-y)); }
```

This handles fixed row heights. For rows of varying height use TanStack
Virtual: Notebook Navigator uses its React adapter, and
`@tanstack/virtual-core` works without a framework. Focus and
keyboard navigation must follow the item, not the DOM row, because rows are
recycled.

## 21. A Bases view with options

```js
import { BasesView } from 'obsidian';
export const VIEW = 'my-compact';
export function registerCompact(plugin) {
  const ok = plugin.registerBasesView(VIEW, {
    name: 'Compact', icon: 'list',
    factory: (controller, el) => new Compact(controller, el),
    options: () => [
      { type: 'text', displayName: 'Separator', key: 'sep', default: ' · ' },
      { type: 'toggle', displayName: 'Show empty', key: 'showEmpty', default: false },
    ],
  });
  if (!ok) console.debug('Bases is off in this vault');
}
class Compact extends BasesView {
  type = VIEW;
  constructor(controller, el) { super(controller); this.root = el.createDiv('my-compact'); }
  onDataUpdated() {                       // fires often; never keep this.data
    const sep = String(this.config.get('sep') ?? ' · ');
    const order = this.config.getOrder();  // the person's column order
    const frag = this.root.doc.createDocumentFragment();
    for (const group of this.data.groupedData) {
      const ul = frag.createEl('ul');
      for (const entry of group.entries) {
        const parts = order.map((id) => entry.getValue(id)).filter((v) => v && v.isTruthy()).map(String);
        ul.createEl('li', { text: parts.join(sep) || entry.file.basename });
      }
    }
    this.root.replaceChildren(frag);       // over about 1,000 entries: recipe 20
  }
}
```

Option types in the 1.14.4 typings are `text`, `toggle`, `slider`,
`dropdown`, `file`, `folder`, `formula`, `multitext`, `property` (a native
property picker) and `group`. An unfiltered base hands the view every file
in the vault.

## 22. A plain-JavaScript plugin, type-checked

```js
// @ts-check  (or checkJs in jsconfig.json: references/javascript.md)
import { Plugin, PluginSettingTab } from 'obsidian';

/** @typedef {{ enabled: boolean, mode: 'fast' | 'thorough' }} Settings */
/** @type {Settings} */
const DEFAULTS = { enabled: true, mode: 'fast' };

export default class MyPlugin extends Plugin {
  /** @type {Settings} */ settings = { ...DEFAULTS };
  async onload() {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    this.addSettingTab(new Tab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.start());
  }
  start() {}
}

class Tab extends PluginSettingTab {
  /** @param {import('obsidian').App} app @param {MyPlugin} plugin */
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  /** @returns {import('obsidian').SettingDefinitionItem[]} */
  getSettingDefinitions() {
    return [
      { name: 'Enabled', control: { type: 'toggle', key: 'enabled' } },
      { name: 'Mode', visible: () => this.plugin.settings.enabled,
        control: { type: 'dropdown', key: 'mode', options: { fast: 'Fast', thorough: 'Thorough' } } },
    ];
  }
}
```

## 23. Outline numbers written as text ("3.1.1.")

To Obsidian these lines are paragraphs (`references/markdown.md`), so the
plugin owns drawing, keys, the reading view and the index. One definition,
used by every layer (no `obsidian` import, so it can be unit-tested):

```js
import { EditorSelection, Prec, RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin, keymap } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

// "3.1.1. text": two or more parts, so Obsidian's own "1. " is never claimed.
export const ITEM = /^([ \t]*)(\d+(?:\.\d+)+)([.)]?)([ \t]+)(.*)$/;
export const bump = (num) => num.replace(/\d+$/, (n) => String(Number(n) + 1));
export const child = (num) => `${num}.1`;
export const parent = (num) => num.split('.').slice(0, -1).join('.');

function lineCommand(view, change) {
  const { state } = view;
  if (state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = ITEM.exec(line.text);
  if (!m) return false;                      // not ours: Obsidian's own keys run
  const spec = change(line, m, state.selection.main.head);
  if (!spec) return false;
  view.dispatch(state.update({ ...spec, scrollIntoView: true, userEvent: 'input' }));
  return true;
}
// Enter: the next number, or end the list when the item is empty.
export const continueItem = (view) => lineCommand(view, (line, [, indent, num, stop, gap, rest], head) => {
  if (!rest.trim()) return { changes: { from: line.from, to: line.to, insert: '' } };
  if (head !== line.to) return null;
  const insert = `\n${indent}${bump(num)}${stop}${gap}`;
  return { changes: { from: head, insert }, selection: EditorSelection.cursor(head + insert.length) };
});
// Tab and Shift-Tab: one level in or out, renumbered as it goes.
const relevel = (to) => (view) => lineCommand(view, (line, [, indent, num, stop, gap, rest]) => {
  const next = to(num);
  if (!next.includes('.')) return null;      // never a one-part number: that is Obsidian's list
  const insert = `${indent}${next}${stop}${gap}`;
  const at = line.from + insert.length;
  return { changes: { from: line.from, to: line.to - rest.length, insert }, selection: EditorSelection.cursor(at) };
});
export const demote = relevel(child);
export const promote = relevel(parent);
```

The editor: draw them as a list, hung like Obsidian's own, and skip code:

```js
// The tokens at a position, as Obsidian names them ("hmd-codeblock", "formatting-list-ol", …).
const tokensAt = (state, pos) => new Set(syntaxTree(state).resolveInner(pos, 1).name.split('_'));
const inCode = (state, pos) => { const t = tokensAt(state, pos); return t.has('hmd-codeblock') || t.has('inline-code'); };

const number = Decoration.mark({ class: 'my-outline-number' });
const hangs = new Map();                      // one decoration per width, as Obsidian does
const hang = (px) => hangs.get(px) || hangs.set(px, Decoration.line({
  class: 'my-outline-line',
  attributes: { style: `text-indent:${-px}px;padding-inline-start:${px}px` },
})).get(px);

export const outlineText = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const b = new RangeSetBuilder();
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        const m = ITEM.exec(line.text);
        if (m && !inCode(view.state, line.from)) {
          const head = m[1].length + m[2].length + m[3].length + m[4].length;
          b.add(line.from, line.from, hang(Math.round(head * view.defaultCharacterWidth)));
          b.add(line.from + m[1].length, line.from + m[1].length + m[2].length + m[3].length, number);
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });
```

The reading view: the paragraph becomes a list. The rendered links and bold
move with their row, and the depth comes from the number:

```js
const READ_ITEM = /^\s*(\d+(?:\.\d+)+)([.)]?)\s+/;
function outlineParagraphs(el) {
  for (const p of el.querySelectorAll('p')) {
    const rows = [[]];
    for (const n of [...p.childNodes]) n.nodeName === 'BR' ? rows.push([]) : rows.at(-1).push(n);
    const head = (row) => row[0]?.nodeType === 3 && READ_ITEM.exec(row[0].textContent);
    if (!head(rows[0])) continue;              // not an outline: leave Obsidian's paragraph
    const doc = p.ownerDocument;
    const list = doc.createElement('div');
    list.className = 'my-outline-list';
    list.setAttribute('role', 'list');
    let text = null;
    for (const row of rows) {
      const m = head(row);
      if (m) {
        const item = list.appendChild(doc.createElement('div'));
        item.className = 'my-outline-item';
        item.setAttribute('role', 'listitem');
        item.style.setProperty('--my-depth', String(m[1].split('.').length - 2));
        const num = item.appendChild(doc.createElement('span'));
        num.className = 'my-outline-number';
        num.textContent = m[1] + m[2];
        text = item.appendChild(doc.createElement('span'));
        text.className = 'my-outline-text';
        row[0].textContent = row[0].textContent.slice(m[0].length);
      } else text.append(doc.createElement('br')); // a line with no number belongs to the item above
      text.append(...row);
    }
    p.replaceWith(list);
  }
}
```

Wiring and styles:

```js
this.registerEditorExtension([outlineText, Prec.high(keymap.of([
  { key: 'Enter', run: continueItem },
  { key: 'Tab', run: demote },
  { key: 'Shift-Tab', run: promote },
]))]);
this.registerMarkdownPostProcessor((el) => outlineParagraphs(el));
```

```css
.my-outline-number { color: var(--list-marker-color); }
.my-outline-item { display: flex; gap: 0.5em; padding-inline-start: calc(var(--my-depth) * 1.5em); }
.my-outline-item > .my-outline-number { flex: none; }
```

The index: these lines are a `paragraph` in `getFileCache(file).sections`.
Parse that section's lines with `ITEM` when the index reads the note, never
per render. A line with no number under an item continues it.

## 24. A standard list, drawn with outline numbers

Here the file keeps a plain nested list (`1.` at each level), so Obsidian's
Enter, Tab, renumbering, folding and `listItems` all keep working. Only the
look changes.

The reading view and PDF export use CSS counters on Obsidian's native
markers:

```css
.markdown-rendered ol { counter-reset: my-outline; }
.markdown-rendered ol > li { counter-increment: my-outline; }
.markdown-rendered ol ol > li::marker { content: counters(my-outline, ".") ". "; }
```

The editor can't use counters: only visible lines are in the DOM. Count
from the document instead, and show the source while the cursor is on the
marker:

```js
// Imports and inCode() as in recipe 23, plus WidgetType from '@codemirror/view'.
const OL = /^(\s*)(\d+)[.)]\s/;
const BULLET = /^(\s*)[-*+]\s/;
const columns = (ws, tab) => [...ws].reduce((n, c) => n + (c === '\t' ? tab - (n % tab) : 1), 0);
// "3.1.1" for the ordered item on line n (1-based), or '' when it isn't one.
export function outlineNumber(doc, n, tab = 4) {
  if (!OL.test(doc.line(n).text)) return '';
  const parts = [];
  let want = Infinity;
  for (; n >= 1; n--) {
    const text = doc.line(n).text;
    if (!text.trim()) continue;              // blank lines don't end a loose list
    const m = OL.exec(text);
    const ws = columns(text.match(/^\s*/)[0], tab);
    if (ws >= want) continue;                // a sibling, its children, or its text
    if (!m) { if (BULLET.test(text) || ws === 0) break; continue; } // a bullet or a paragraph ends it
    parts.unshift(m[2]);
    want = ws;
    if (ws === 0) break;
  }
  return parts.join('.');
}

class OutlineNumber extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(other) { return other.text === this.text; }
  toDOM(view) {
    const el = view.dom.ownerDocument.createElement('span');
    el.className = 'list-number';                // Obsidian's own look for a number
    el.textContent = this.text;
    return el;
  }
}

export const outlineNumbers = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = this.build(u.view); }
  build(view) {
    const { state } = view;
    const b = new RangeSetBuilder();
    const tab = state.tabSize;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = state.doc.lineAt(pos);
        const m = OL.exec(line.text);
        const start = line.from + (m ? m[1].length : 0);
        const end = m ? start + m[0].trimEnd().length - m[1].length : 0;
        const editing = m && state.selection.ranges.some((r) => r.from <= end && r.to >= start);
        if (m && !editing && !inCode(state, start)) {
          const num = outlineNumber(state.doc, line.number, tab);
          if (num.includes('.')) b.add(start, end, Decoration.replace({ widget: new OutlineNumber(`${num}.`) }));
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });

this.registerEditorExtension(outlineNumbers);
```

`outlineNumber` walks back from the line to its parents. That is cheap for
the few dozen visible lines, but not for a whole long document per keystroke.

Two gaps in this recipe:
- The counters ignore `<ol start>`, so a list that starts at another number
  loses it.
- An ordered list under a bullet starts again in the editor but continues
  its ordered ancestor's count in CSS. Keep outlines unmixed, or reset the
  counter at `ul > li > ol`.
