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
await this.app.fileManager.trashFile(file);      // honours the trash setting
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
