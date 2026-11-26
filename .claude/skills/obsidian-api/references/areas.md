# More of the API: how the other areas work

This covers the parts of the API the other references only touch:
- custom file types;
- the `Editor` and its modes;
- suggestions;
- hover previews;
- links and paths;
- utilities;
- keys;
- the workspace tree and view state;
- the file system;
- URIs and the command line;
- Bases values;
- Canvas;
- releasing;
- debugging;
- internals.

Every signature here was checked against `obsidian.d.ts` 1.14.4 (the
obsidianmd/obsidian-api repository, 2026-11-26). The complete list of
signatures is the API listing that comes with the handbook, or
`scripts/obsidian-api.mjs`.

## A view for your own file type

```js
class LedgerView extends TextFileView {   // EditableFileView → FileView → ItemView
  getViewType() { return 'my-ledger'; }
  getDisplayText() { return this.file?.basename ?? 'Ledger'; }
  getViewData() { return this.serialize(); }           // what gets written
  setViewData(data, clear) { this.parse(data); this.draw(); } // clear: a different file was loaded
  clear() { this.rows = []; this.contentEl.empty(); }
  edit(change) { change(this.rows); this.requestSave(); } // a debounced save
}
this.registerView('my-ledger', (leaf) => new LedgerView(leaf));
this.registerExtensions(['ledger'], 'my-ledger');      // *.ledger opens in it
```

- `this.data` holds the text as last loaded or saved, and `this.file` the
  file.
- `save()` writes now.
- A binary file or a viewer is a `FileView` with `onLoadFile(file)` and
  `onUnloadFile(file)`. `canAcceptExtension(ext)` lets a view take a file
  dropped on it.
- Never register `md` with `registerExtensions`: Markdown belongs to
  Obsidian's `MarkdownView`.

## The Editor and Markdown views

- **`Editor`** is Obsidian's wrapper over CodeMirror. Positions are `{ line,
  ch }`, with lines starting at 0.
  - Reading: `getValue()`, `getLine(n)`, `lineCount()`, `getRange(from,
    to)`, `getSelection()`, `listSelections()`, `getCursor('head' |
    'anchor' | 'from' | 'to')`, `wordAt(pos)`.
  - Changing: `replaceRange(text, from, to?, origin?)`,
    `replaceSelection(text)`, `setCursor(pos)`, `setSelection(a, b)`,
    `setSelections([...])`.
  - **`transaction({ changes: [{ from, to, text }], selection }, origin)`**
    applies several changes as one undo step.
  - **`processLines(read, write)`** applies a change per line.
  - Moving between positions and offsets: `posToOffset`, `offsetToPos`;
    `scrollIntoView(range, center)`.
  - `exec(command)` runs a built-in command: `'indentMore'`,
    `'toggleFold'`, `'swapLineUp'` and the others in `EditorCommandName`.
- **CodeMirror itself**, when the wrapper isn't enough: `view.editor.cm` is
  the `EditorView`. It is untyped, so guard it.
- **Inside an extension:**
  - `state.field(editorInfoField)` is the `MarkdownFileInfo` (`app`,
    `file`, `editor`);
  - `state.field(editorLivePreviewField)` is `true` in Live Preview and
    `false` in source mode;
  - `livePreviewState` holds `{ mousedown }`, which says whether a drag is
    in progress.
- **`MarkdownView`:**
  - `getMode()` is `'source'` or `'preview'`, and `currentMode` is the
    sub-view showing;
  - `previewMode.rerender(true)` draws reading view again (after a
    post-processor's input changes);
  - `showSearch(replace)`;
  - `getViewData()` / `setViewData(text, clear)` for the whole text;
  - `getEphemeralState()` / `setEphemeralState({ line, scroll })` for
    scroll and cursor.
- To edit the note under a command, use **`editorCallback: (editor, ctx) =>
  …`** (shown only when an editor is focused) or `editorCheckCallback`.

## Suggestions

```js
class TagSuggest extends EditorSuggest {
  onTrigger(cursor, editor) {                          // return null to stay closed
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = before.match(/@(\w*)$/);
    return m ? { start: { line: cursor.line, ch: cursor.ch - m[0].length }, end: cursor, query: m[1] } : null;
  }
  getSuggestions(ctx) { return this.items.filter((i) => i.startsWith(ctx.query)); } // may be async
  renderSuggestion(item, el) { el.setText(item); }
  selectSuggestion(item) {
    const { editor, start, end } = this.context;       // EditorSuggestContext: editor, file, start, end, query
    editor.replaceRange(`@${item} `, start, end);
    this.close();
  }
}
this.registerEditorSuggest(new TagSuggest(this.app));
```

- `onTrigger` runs on every keystroke, so keep it to a slice of the current
  line.
- `this.limit` caps the list, and `setInstructions([{ command, purpose }])`
  shows the key hints.
- For a text field (settings, a modal), use **`AbstractInputSuggest`**: `new
  FolderSuggest(app, inputEl)` with `getSuggestions(query)`,
  `renderSuggestion` and `selectSuggestion` (or `.onSelect(cb)`).
- `SuggestModal` / `FuzzySuggestModal` are the palette-style pickers (recipe
  9). `prepareFuzzySearch(q)(text)` returns `{ score, matches }`, and
  `renderMatches(el, text, matches)` highlights them.

## Hover previews (Page preview)

```js
this.registerHoverLinkSource('my-plugin', { display: 'My plugin', defaultMod: true });
el.addEventListener('mouseover', (event) => {
  this.app.workspace.trigger('hover-link', {
    event, source: 'my-plugin', hoverParent: view, targetEl: el,
    linktext: file.path, sourcePath: '',
  });
});
```

- The payload is the one Obsidian's own file explorer and tab headers send
  (seen in `app.js`). It isn't typed, but it has been stable for years.
- `hoverParent` is an object with a `hoverPopover` field, such as a view or
  a `Component`.
- `defaultMod: true` means the preview needs Cmd/Ctrl unless the person
  changes it in Page preview's settings.

## Links, paths and the cache's helpers

| Need | Call |
| --- | --- |
| Split `Note#Heading\|alias` | `parseLinktext(text)` returns `{ path, subpath }`; `getLinkpath(text)` |
| Resolve a link | `metadataCache.getFirstLinkpathDest(path, sourcePath)` |
| A heading or block inside a file | `resolveSubpath(cache, '#Heading' or '#^id')` returns a `HeadingSubpathResult` / `BlockSubpathResult` with `start` and `end` |
| Write a link the person's way (wikilink or Markdown, shortest path) | `fileManager.generateMarkdownLink(file, sourcePath, subpath?, alias?)` |
| The shortest unique link text | `metadataCache.fileToLinktext(file, sourcePath, omitMdExtension?)` |
| Every link and embed in a cache entry | `iterateCacheRefs(cache, (ref) => …)` |
| All tags, front matter and body | `getAllTags(cache)` (with `#`) |
| Front matter values | `parseFrontMatterTags`, `parseFrontMatterAliases`, `parseFrontMatterEntry(fm, key)`, `parseFrontMatterStringArray` |
| Where a new note or attachment goes | `fileManager.getNewFileParent(sourcePath)`, `await fileManager.getAvailablePathForAttachment(name, sourcePath)` |
| The config folder | `vault.configDir` (not always `.obsidian`) |
| A file as a URL for `<img>` | `vault.getResourcePath(file)` (`app://…?mtime`) |
| Open a link as a click would | `workspace.openLinkText(linktext, sourcePath, newLeaf, { eState: { line } })` |

## Utilities Obsidian exports

- YAML: `parseYaml`, `stringifyYaml`.
- HTML: `htmlToMarkdown(html)`; `sanitizeHTMLToDom(html)` returns a safe
  `DocumentFragment` (never set `innerHTML` from outside text).
- Dates: `moment`, the copy Obsidian uses, with the person's locale set.
- Binary: `arrayBufferToBase64`, `base64ToArrayBuffer`, `arrayBufferToHex`,
  `hexToArrayBuffer`, `getBlobArrayBuffer`.
- Rendering:
  - `renderMath(src, display)` then `finishRenderMath()`;
  - `loadMathJax()`, `loadPrism()`, `loadPdfJs()`, `loadMermaid()`, and
    `loadPixi()` (1.15, untyped).
- Timing: `debounce(fn, ms, resetTimer)` returns a function with `.cancel()`
  and `.run()`.
- Network: `requestUrl({ url, method, headers, body, contentType, throw })`
  has no CORS limits. The response has `.status`, `.text`, `.json`,
  `.arrayBuffer` and `.headers`.
- Platform: `Platform.isDesktopApp`, `isMacOS`, `isWin`, `isLinux`,
  `isMobile`.
- `getIcon(id)` returns the SVG element; `getIconIds()`.

## Keys

- Commands: `addCommand({ id, name, hotkeys: [{ modifiers: ['Mod',
  'Shift'], key: 'k' }] })`. Default hotkeys are better left to the person.
- **`Scope`** gives keys that work only while something is open:
  ```js
  this.scope = new Scope(this.app.scope);              // falls through to the app's keys
  this.scope.register(['Mod'], 'Enter', (evt) => { this.submit(); return false; }); // false: handled
  this.app.keymap.pushScope(this.scope);  /* … */  this.app.keymap.popScope(this.scope);
  ```
  `Modal` and `ItemView` already have a `scope`, so register on it. A plugin
  field named `scope` on a `Modal` breaks the modal's keys.
- `Keymap.isModEvent(evt)` turns a Cmd or middle click into a `PaneType`
  (open in a new tab, split or window).

## The workspace tree, and views that come back

- The tree is `workspace.rootSplit` (main area) and `leftSplit` /
  `rightSplit` (sidedocks). Each holds `WorkspaceSplit` / `WorkspaceTabs`
  items that hold `WorkspaceLeaf`s. Popout windows are `WorkspaceWindow`s
  (their container, `floatingSplit`, is internal).
  - `iterateRootLeaves(fn)` walks the main area, and `iterateAllLeaves(fn)`
    walks everything.
  - `getLeafById(id)` finds a leaf, and `leaf.getRoot()` its area.
- To move and open leaves:
  - `duplicateLeaf(leaf, 'vertical')`, `moveLeafToPopout(leaf)` and
    `openPopoutLeaf()`;
  - `leaf.setPinned(true)`, `leaf.detach()`;
  - `detachLeavesOfType(type)`, only when the person asks: never on
    unload.
- `getLayout()` / `changeLayout(layout)` save and restore the whole
  workspace as JSON.
- **A view that survives a restart:**
  - `getState()` returns what to save;
  - `setState(state, result)` restores it. Call `super.setState`, and set
    `result.history = true` to make the change a step in back/forward.
  - Obsidian stores this in `workspace.json` and calls `setState` when the
    leaf comes back. A deferred leaf keeps its state until it is shown.
- `navigation = true` on a view puts its state changes in the leaf's
  back/forward history.
- Other places in the window: `addRibbonIcon(icon, title, cb)` and
  `addStatusBarItem()` (desktop), both removed on unload.

## The file system under the vault

- `vault.adapter` is a `DataAdapter`: `exists`, `read`, `write`,
  `readBinary`, `writeBinary`, `append`, `list(dir)` (giving `{ files,
  folders }`), `stat`, `mkdir`, `rmdir`, `remove`, `rename`, `copy`,
  `trashSystem`, `trashLocal`, `getResourcePath`.
  - Use it for files the vault doesn't index: the config folder, dotfiles,
    a plugin's own cache files under `this.manifest.dir`.
  - On desktop it is a `FileSystemAdapter`, which adds `getBasePath()` and
    `getFullPath(path)`. On mobile it is a `CapacitorAdapter`.
- `vault.create`, `modify`, `process`, `append` and `copy` take a
  `DataWriteOptions` (`{ ctime, mtime }`) to set the file's times.
- A plugin's own big data belongs in `this.manifest.dir` (via the adapter)
  or IndexedDB, not in `data.json`, which is read and written whole.

## URIs and the command line

```js
this.registerObsidianProtocolHandler('my-action', (params) => { /* params.action, params.file, … */ });
// obsidian://my-action?vault=Main&file=Note  (values are strings, or 'true' for a bare flag)

this.registerCliHandler('my-export', 'Export the vault index', {
  out: { value: '<path>', description: 'Where to write', required: true },
  pretty: { description: 'Indent the JSON' },
}, async (params) => { await exportTo(params.out, params.pretty === 'true'); return 'done'; });
```

The command line arrived in 1.12.2, and its binary ships in the installer
from 1.12.7. A handler returns the text to print.

## Bases values

- Each `entry.getValue(propertyId)` returns a `Value` subclass:
  - `StringValue`, `NumberValue`, `BooleanValue`;
  - `DateValue`, `DurationValue`, `RelativeDateValue`;
  - `ListValue`, `ObjectValue`;
  - `LinkValue`, `FileValue`, `TagValue`, `UrlValue`, `ImageValue`,
    `IconValue`, `HTMLValue`, `RegExpValue`;
  - `NullValue`.

  They share `toString()`, `isTruthy()`, `isEmpty()` and `renderTo(el,
  ctx)` (the way Bases draws it). Test the kind with `instanceof`.
- A property id is `note.status`, `file.name` or `formula.total`.
  `parsePropertyId(id)` gives `{ type, name }`.
- A `.base` file is YAML holding `filters`, `formulas`, `properties` and
  `views` (each view with `type`, `name`, `order`, `sort`, `groupBy`,
  `limit`, and its options). Its type is `BasesConfigFile`. Write one with
  `vault.create(path, stringifyYaml(config))`.

## Canvas

- A `.canvas` file is JSON Canvas: `{ nodes: [], edges: [] }`.
  - Nodes have `id`, `type` (`text`, `file`, `link`, `group`), `x`, `y`,
    `width`, `height`, `color?`, and `text`, `file`, `url` or `label` by
    type.
  - Edges have `id`, `fromNode`, `toNode`, `fromSide?`, `toSide?` and
    `label?`.
- The types are in the package's `canvas.d.ts`. Change a canvas with
  `vault.process(file, (json) => JSON.stringify(change(JSON.parse(json)),
  null, '\t'))`.
- The open canvas's live object is internal (`leaf.view.canvas`).

## Releasing (the mechanics)

- `manifest.json`:
  - required: `id`, `name`, `version` (x.y.z), `minAppVersion`,
    `description`, `author`, `isDesktopOnly`;
  - optional: `authorUrl`, `fundingUrl`.
  - The `id` must match the plugin's folder, or `onExternalSettingsChange`
    isn't called.
- A release is a GitHub release whose tag is the version, with `main.js`,
  `manifest.json` and (if any) `styles.css` attached.
- `versions.json` maps plugin versions to `minAppVersion`. An older
  Obsidian installs the newest plugin version whose `minAppVersion` it
  meets. Only add a line when `minAppVersion` changes.
- Beta testers install from a repository with BRAT.

## Debugging

- DevTools: Cmd+Opt+I (macOS) or Ctrl+Shift+I. "Reload app without saving"
  is in the command palette.
- Startup time: Settings → General → Advanced, then the stopwatch. Settings
  → Community plugins also shows each plugin's time.
- The Hot Reload plugin (pjeby) reloads a plugin when its `main.js`
  changes.
- `app.vault.getConfig(key)` (internal) reads Obsidian's settings.

## Internals worth knowing (guard every one)

| Internal | What it is |
| --- | --- |
| `app.commands.executeCommandById(id)`, `.commands` | Run or list any command |
| `app.setting.open()`, `.openTabById(id)` | Open Settings |
| `app.plugins.plugins[id]`, `.enabledPlugins` | Other plugins (their public `api`, if they offer one) |
| `app.internalPlugins.getPluginById(id)?.enabled` | Core plugins (Bases, Page preview, Sync) |
| `app.metadataTypeManager.getTypeInfo(prop)`, `.setType(prop, type)` | Property types |
| `app.dragManager` | The drag in progress |
| `app.embedRegistry` | Who draws an embed of each file type |
| `app.viewRegistry` | View types and extensions |
| `app.hotkeyManager` | The person's hotkeys |
| `app.foldManager` | Saved folds per file |
| `workspace.editorSuggest.suggests` | Open editor suggestions |
| `leaf.view.canvas` | The open canvas |
| `MenuItem.setSubmenu()` | Submenus |

The community package **`obsidian-typings`** (6.64.0, November 2026) types
these. Install it as a dev dependency and add it to `types` in
`tsconfig.json` / `jsconfig.json`: it extends `obsidian`'s own types, so
`app.commands` and the rest type-check. It is types only; the code still
needs the guards.
