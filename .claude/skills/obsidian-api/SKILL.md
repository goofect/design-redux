---
name: obsidian-api
description: Obsidian's plugin API and plugin architecture, for building plugins that work and stay fast - file layout and architecture from the large plugins, lifecycle, workspace and deferred views, vault, metadata cache, CodeMirror 6, reading view, 1.13 settings definitions, popout windows, Bases, what changed since 1.7, and performance. Includes scripts that look up the installed API, audit a plugin's source and read Obsidian's own app.css. Use before writing or changing plugin code that touches Obsidian.
---

# Obsidian API: functionality and performance

Checked against the `obsidian` package 1.14.4 (`obsidian.d.ts`, published
2026-10-08) and Obsidian 1.15.1's `app.css`, on 2026-11-22. The installed
types are the source of truth; the scripts below read them instead of
memory.

## The scripts (plain Node; in `scripts/` beside this file; run them from the plugin's folder)

| Script | What it answers |
| --- | --- |
| `scripts/obsidian-api.mjs <name>` | A declaration's signature, owner, `@since`, `@deprecated` and summary. `--class Workspace` lists a class; `--since 1.13` what was added from a version; `--deprecated` everything deprecated; `--full` the whole doc comment. A name it can't find is not public API. |
| `scripts/obsidian-audit.mjs [src]` | Deprecated APIs in use, APIs newer than `minAppVersion`, data-loss and window risks, slow patterns, unguarded internals, with file:line. `--stand-in tests/obsidian.js` also lists API methods a test stand-in lacks. |
| `scripts/obsidian-css.mjs` | Obsidian's own `app.css`: `--vars [filter]` every variable and value, `--selector ".cm-line"` the rules for a selector, `--uses --file-line-width` the rules that read a variable, `--dump [file]` the file (to stdout without one). Finds the app's `.asar` on macOS and Linux, or take `--asar <path>`. |

Use them: before using an API (`obsidian-api.mjs`), before styling anything
Obsidian draws (`obsidian-css.mjs --selector`), and after a change
(`obsidian-audit.mjs`). The references:
- `references/recipes.md`: working patterns for every area below.
- `references/performance.md`: startup, vault reads, events, drawing, the
  editor, reading view, writes, memory, and how to measure.
- `references/architecture.md`: how the large plugins (Tasks, Dataview,
  Excalidraw, Omnisearch, QuickAdd and others) organise their code, the
  architecture and file layout that follow from it, the build, and tests.
- `references/community.md`: what the forum and plugin authors say about
  speed and profiling, and what users want (file browsers, folder notes,
  properties, Bases), as directions for features.

## Versions

- An API marked `@since` later than the plugin's `minAppVersion` breaks on
  older installs: guard it with `requireApiVersion('1.x.y')` or a `typeof`
  check, or raise `minAppVersion`.
- What arrived since 1.7 that changes how plugins are built:

| Version | Added |
| --- | --- |
| 1.7.2 | Deferred views (`leaf.isDeferred`, `loadIfDeferred()`), `revealLeaf` async, `ensureSideLeaf`, `onUserEnable`, `removeCommand`, footnotes in the metadata cache |
| 1.8.7 | `vault.copy`, `app.loadLocalStorage` / `saveLocalStorage`, `displayTooltip`, `getLanguage`, `Notice.messageEl`, reference links in the cache |
| 1.10 | Bases: `registerBasesView`, `BasesView`, `Value` types; `app.isDarkMode()`; `Modal.setCloseCallback` |
| 1.11 | `SettingGroup`; `SettingTab.icon`; 1.11.4 `app.secretStorage`, `SecretComponent` |
| 1.12 | `registerCliHandler` (Obsidian's command line); `vault.appendBinary` |
| 1.13 | Settings as definitions: `getSettingDefinitions()`, `getControlValue`, `setControlValue`; `display()` deprecated; Settings opens in its own window |
| 1.14 | `TExternalFile` (a file outside the vault), Bases `groupOrder` |

## Lifecycle

- `onload()` registers; the work waits for `workspace.onLayoutReady(fn)`
  (`workspace.layoutReady` says if it already has).
- Released on unload automatically: `registerEvent`, `registerDomEvent`,
  `registerInterval`, `register(fn)`, `addCommand`, `registerView`,
  `registerEditorExtension`, `registerMarkdownPostProcessor`, `addChild`.
  Anything else needs its own cleanup.
- Don't detach your views' leaves in `onunload()`: Obsidian restores them
  in place after an update.
- `onUserEnable()` (1.7.2) runs when the person turns the plugin on, not at
  every start. `onExternalSettingsChange()` runs when `data.json` changed on
  disk (sync): reload settings there.
- `loadData()` / `saveData()` read and write the whole `data.json`.
  `app.loadLocalStorage(key)` / `saveLocalStorage(key, value)` (1.8.7) keep
  per-vault state that shouldn't sync.

## Workspace and views

- The current Markdown view: `getActiveViewOfType(MarkdownView)`; its
  editor: `workspace.activeEditor?.editor`; the open file:
  `getActiveFile()`; the last main-area leaf: `getMostRecentLeaf()`.
  `workspace.activeLeaf` can be a sidebar leaf or null.
- `getLeaf(false)` reuses the current tab; `getLeaf(true)` or `'tab'` a new
  one; `'split'` or `'window'` split or pop out. Side panes:
  `getLeftLeaf(false)`, `getRightLeaf(false)`, `ensureSideLeaf(type, side)`.
- **Deferred views (1.7.2):** a tab not yet shown holds a placeholder.
  `getLeavesOfType` returns it too, so test `leaf.view instanceof MyView`
  before calling methods, and `await leaf.loadIfDeferred()` only when the
  real view is needed now. `await revealLeaf(leaf)` shows and loads it.
- `registerView(type, (leaf) => new MyView(leaf))`; find views with
  `getLeavesOfType`, never keep them. `ItemView` gives `contentEl`,
  `onOpen`, `onClose`, `getViewType`, `getDisplayText`, `getIcon`.
- `leaf.setViewState({ type, state, active })`, `leaf.openFile(file)`.
  `Keymap.isModEvent(evt)` turns a Cmd or middle click into `getLeaf(true)`.

## Events

| Emitter | Events |
| --- | --- |
| `app.vault` | `create` (also once per file while loading), `modify` (every autosave), `delete`, `rename` (file, oldPath) |
| `app.metadataCache` | `changed` (file, data, cache), `deleted`, `resolve`, `resolved` (after each batch) |
| `app.workspace` | `file-open`, `active-leaf-change`, `layout-change`, `resize`, `css-change`, `quit`, `window-open`, `window-close`, `editor-change`, `editor-paste`, `editor-drop`, `file-menu`, `files-menu`, `editor-menu`, `url-menu`, `quick-preview` |

Custom events between parts of a plugin: `workspace.trigger('my:event', …)`
and `workspace.on('my:event', …)`.

## Vault and files

- Lookup by path: `getFileByPath`, `getFolderByPath`,
  `getAbstractFileByPath` (map lookups). `getFiles()`,
  `getMarkdownFiles()`, `getAllFolders()`, `getAllLoadedFiles()` build arrays
  of everything.
- Paths someone typed or code built: `normalizePath()`.
- Read: `cachedRead` to show, `read` right before writing.
- Write: `vault.process(file, fn)` (atomic); `vault.modify` writes a string
  read earlier and loses edits made in between. A note open in an editor:
  through the `Editor`, which keeps the cursor and undo.
- Properties: `fileManager.processFrontMatter(file, (fm) => …)` (atomic,
  Obsidian writes the YAML).
- Rename or move: `fileManager.renameFile` (updates links); `vault.rename`
  doesn't. Delete: `fileManager.trashFile` (honours the trash setting);
  `vault.delete` skips it.
- `vault.copy` (1.8.7), `vault.append`, `vault.appendBinary` (1.12.3).
  `TExternalFile` (1.14.4) is outside the vault: check before treating a
  `TFile` as a note. `vault.adapter` is the raw file system, for files that
  aren't notes.

## Metadata cache

- `getFileCache(file)` (null until indexed): `frontmatter`,
  `frontmatterPosition`, `headings`, `sections`, `links`, `embeds`, `tags`,
  `listItems`, `blocks`, `footnotes`, `footnoteRefs`, `referenceLinks`.
- `resolvedLinks` / `unresolvedLinks`: source, target, count, for the whole
  vault. `getFirstLinkpathDest(link, sourcePath)` resolves one.
- `getFrontMatterInfo(text)` locates frontmatter in raw text.
- Read the cache instead of the files whenever it holds what you need.

## The editor (CodeMirror 6)

- `registerEditorExtension(array)`; to switch later, change the same array
  and call `workspace.updateOptions()` (rebuilds every editor: not per
  event).
- In an extension, the note: `state.field(editorInfoField)`
  (`editorViewField` is deprecated).
- `@codemirror/*` is provided by Obsidian at runtime: mark it external when
  bundling, so there is one copy.
- Decorations for what is on screen: a `ViewPlugin` over
  `view.visibleRanges`. A line decoration's class wins over Obsidian's own
  line styles.

## Reading view

- `registerMarkdownPostProcessor((el, ctx) => …)` per rendered section;
  `ctx.getSectionInfo(el)`, `ctx.sourcePath`; long-lived work in a
  `MarkdownRenderChild` added with `ctx.addChild`.
- `registerMarkdownCodeBlockProcessor(lang, fn)` owns a fenced block.
- `MarkdownRenderer.render(app, md, el, sourcePath, component)`;
  `renderMarkdown` is deprecated.

## Settings

- **1.13:** a tab returns `getSettingDefinitions()`, which Obsidian draws and
  indexes for search. Items: a control `{ name, desc, control: { type, key,
  defaultValue, validate, … } }` (`toggle`, `text`, `textarea`, `number`,
  `slider`, `dropdown`, `color`, `file`, `folder`, `secret`); an action
  `{ name, action(el) }`; a custom `render`; a group `{ type: 'group',
  heading, items }`; a list with add, delete and reorder; a page `{ type:
  'page', name, items }`. `visible` and `searchable` may be functions.
  Values go through `getControlValue` / `setControlValue` (default:
  `this.plugin.settings` and save). `display()` is called only when the
  definitions are empty, so both can live together for older versions.
- The settings window is its own document since 1.13:
  `containerEl.ownerDocument`, never the global `document`.
- `SettingGroup` (1.11); secrets in `app.secretStorage` (1.11.4).

## UI pieces

- Commands: `callback`, `checkCallback` (shown only when it applies),
  `editorCallback`, `editorCheckCallback`; `removeCommand(id)` (1.7.2).
- `Menu` / `MenuItem`: `setSection(...)` places an entry among Obsidian's
  sections. `setSubmenu()` is not public.
- `Modal` (`setCloseCallback` 1.10; a field named `scope` breaks its keys),
  `SuggestModal`, `FuzzySuggestModal`.
- `Notice` (`messageEl`), `setTooltip`, `displayTooltip`; buttons
  `setCta`, `setDestructive` (`setWarning` deprecated).
- Icons: `addIcon(id, svg)`, `removeIcon`, `setIcon(el, id)`, `getIconIds()`.

## DOM and windows

- `createEl`, `createDiv`, `createSpan`, `el.empty()`, `el.toggleClass`.
- Popouts have their own `document` and `window`: `activeDocument` /
  `activeWindow` for the focused one, `el.doc` / `el.win` for an element's.
  `x.instanceOf(HTMLElement)` works across windows; `instanceof` doesn't.
- `window-open` / `window-close`; `el.onWindowMigrated(fn)` when a tab is
  dragged to another window.

## Styling facts

- `app.css` (1,229 variables in 1.15.1) is inside the app's `.asar`; read it
  with `scripts/obsidian-css.mjs`. Example: every editor line is
  `.markdown-source-view.mod-cm6 .cm-line { padding: 0; position: relative }`,
  so a plain class loses to it.
- `body.theme-light` / `.theme-dark`, `app.isDarkMode()`, and `css-change`
  when the theme changes.

## Other APIs

- Bases (1.10): `registerBasesView(id, { name, icon, factory, options })`;
  the view gets `data.groupedData` and `config`, already filtered, sorted and
  grouped.
- `registerCliHandler` (1.12.2), `registerObsidianProtocolHandler`,
  `registerHoverLinkSource`, `registerExtensions(exts, viewType)`.
- `requestUrl` (no CORS limits), `debounce(fn, ms, resetTimer)`,
  `getLanguage()`, `requireApiVersion`.

## Internals (not in the types)

Common ones: `app.commands.executeCommandById`, `app.setting.open()`,
`app.plugins`, `app.internalPlugins`, `vault.getConfig`,
`app.metadataTypeManager`, `MenuItem.setSubmenu`. They can change in any
release: guard each with a `typeof` check and keep a way through when it's
missing. `obsidian-audit.mjs` lists them and whether they're guarded.

## Sources

- The `obsidian` package 1.14.4, `obsidian.d.ts` (npm).
- Obsidian 1.15.1's `app.css`, from its release `.asar`.
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) (for the vault and workspace API advice).
