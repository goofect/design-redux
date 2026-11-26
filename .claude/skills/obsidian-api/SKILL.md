---
name: "obsidian-api"
description: "Obsidian's plugin API, its JavaScript runtime, its Markdown parsers and plugin architecture, for building plugins that work and stay fast - what changed through 1.15, lifecycle, workspace and deferred views, vault, metadata cache, how Obsidian parses Markdown and how plugins change it, CodeMirror 6, reading view, settings definitions, popout windows, Bases, the Electron/Chromium versions and what JavaScript they allow, the build, plain-JS typing and tests, performance, and feature directions. Includes scripts that look up the installed API, audit a plugin's source, and read Obsidian's own app.css and app.js. Use before writing or changing plugin code that touches Obsidian."
---

# Obsidian API: functionality and performance

Checked on 2026-11-23 against three sources:
- the `obsidian` package 1.14.4 (`obsidian.d.ts`), still the latest on npm;
- the changelogs of Obsidian 1.15.0 and 1.15.1;
- 1.15.1's `app.css`.

The app is ahead of its typings. Anything below marked 1.15 runs but isn't
typed yet: guard it at runtime. Otherwise the installed types are the source
of truth, and the scripts read them rather than relying on memory.

## The scripts (plain Node, run from the plugin's folder)

The scripts and the references live beside this file when the skill is
installed as a folder. If you have only this file, the full skill is in the
Design Redux repo at `.claude/skills/obsidian-api/`
(github.com/goofect/design-redux).

| Script | What it answers |
| --- | --- |
| `scripts/obsidian-api.mjs <name>` | A declaration's signature, owner, `@since`, `@deprecated` and summary. `--class Workspace` lists a class, `--since 1.13` lists what was added from a version, `--deprecated` lists everything deprecated, and `--full` prints the whole doc comment. A name it can't find is not public API. |
| `scripts/obsidian-audit.mjs [src]` | Deprecated APIs in use, APIs newer than `minAppVersion`, risks of data loss or of breaking in a window or a version (including 1.15's runtime changes), slow patterns, and unguarded internals, each with file:line. `--stand-in tests/obsidian.js` also lists API methods a test stand-in lacks, and `--dts <path>` checks against other typings. |
| `scripts/obsidian-source.mjs` | Obsidian's own `app.js` / `worker.js` from the same `.asar`: `--find <text or /regex/>` each place a string occurs, with context; `--regexes <text>` every regex literal containing it (`--regexes "[.)]"` prints the three list rules); `--files` the scripts. For how Obsidian really does something the API doesn't say. |
| `scripts/obsidian-css.mjs` | Obsidian's own `app.css`. `--vars [filter]` lists every variable and value, `--selector ".cm-line"` the rules for a selector, `--uses --file-line-width` the rules that read a variable, and `--dump` prints the file. It finds the app's `.asar` on macOS and Linux, or takes `--asar <path>`. |

When to use them:
- before using an API: `obsidian-api.mjs`;
- before styling anything Obsidian draws: `obsidian-css.mjs --selector`;
- after a change: `obsidian-audit.mjs`;
- before relying on how Obsidian behaves inside (a parser, a filter, a
  decoration): `obsidian-source.mjs`.

The references:
- `references/recipes.md`: 24 working patterns, covering every area below
  plus workers, IndexedDB, chunked indexing, a virtual list, Bases options,
  a typed plain-JS plugin, and outline numbers both ways (23, 24).
- `references/markdown.md`: Obsidian's three Markdown readers (editor
  drawing, editor commands, reading view and cache), what each calls a
  list, why plugins can't extend them, and the two ways that work.
- `references/javascript.md`:
  - the Electron, Chromium, Node and V8 versions per installer;
  - which language features, Web APIs and CSS are safe;
  - the 2026 esbuild config;
  - typing and linting plain JavaScript;
  - testing.
- `references/performance.md`: startup, vault reads, events, drawing, the
  editor, reading view, writes, memory, and how to measure.
- `references/architecture.md`: how the large plugins organise their code,
  the architecture and layout that follow, the build, and tests.
- `references/community.md`: what the forum and plugin authors say about
  speed and profiling, and what users want.

## Versions

- An API whose `@since` is later than the plugin's `minAppVersion` breaks on
  older installs. Guard it with `requireApiVersion('1.x.y')` or a `typeof`
  check, or raise `minAppVersion`.
- `requireApiVersion` checks the app, not the installer. JavaScript and Web
  features depend on the installer's Chromium (see below).

| Version | Added or changed |
| --- | --- |
| 1.7.2 | Deferred views (`leaf.isDeferred`, `loadIfDeferred()`), `revealLeaf` async, `ensureSideLeaf`, `onUserEnable`, `removeCommand`, footnotes in the metadata cache |
| 1.8.7 | `vault.copy`, `app.loadLocalStorage` / `saveLocalStorage`, `displayTooltip`, `getLanguage`, `Notice.messageEl`, reference links in the cache |
| 1.10 | Bases: `registerBasesView`, `BasesView`, `Value` types; `app.isDarkMode()`; `Modal.setCloseCallback` |
| 1.11 | `SettingGroup`; `SettingTab.icon`; 1.11.4 adds `app.secretStorage` and `SecretComponent` |
| 1.12 | `registerCliHandler` (Obsidian's command line); `vault.appendBinary` |
| 1.13 | Settings as definitions: `getSettingDefinitions()`, `getControlValue`, `setControlValue`, `update()`, `refreshDomState()`; `display()` deprecated; Settings opens in its own window |
| 1.14 | `TExternalFile` (a file outside the vault); `SettingDefinitionItem.id`; `SliderComponent.setDynamicTooltip` deprecated (the value always shows); Bases `groupOrder` (must be a list) |
| 1.15.0 (2 Nov 2026) | Syntax-tree names of closing tokens gain `formatting-*-end`. Mermaid is replaced by Pele: `loadMermaid()` and `window.mermaid` keep `initialize`, `render`, `parse` and `mermaidAPI`, Mermaid's SVG class names are gone (`.pele-*` instead), and `window.pele` is set once `loadMermaid()` resolves. `PIXI` loads with the first graph, so call `loadPixi()`. `prepareFuzzySearch` / `prepareSimpleSearch` ignore accents. Faster plugin loading at start |
| 1.15.1 (12 Nov 2026) | Timers run on time in hidden windows. A timer set on a popout's window never fires once that window closes, so use `window.setTimeout`. `Array#contains` / `String#contains` deprecated (use `includes`). `trashFile` / `promptForDeletion` resolve `false` when the file couldn't go to the trash, with no quiet fallback to `.trash`. A new install ignores a `data.json` already in the vault (it is kept as `.bak`). The workspace shows before indexing ends. CLI `eval` takes top-level `await`. Installer Electron 43.8.9 |

Plugin authors also report that since 1.15, `Plugin` and `PluginSettingTab`
are native classes. A bundle down-levelled to ES5 fails with "Class
constructor cannot be invoked without 'new'".

## JavaScript and the runtime

The detail is in `references/javascript.md`.
- The installer decides the runtime, and in-app updates don't change it:
  - 1.15.1's installer is Electron 43.8.9, which is Chromium 150, Node
    24.22 and V8 15.0;
  - old installers are still in use, down to 1.10.3, which is Electron 37
    and Chromium 138 (macOS 11 stops there).
- Support Chromium 138 unless every machine is yours.
  - On 138, everything through ES2025 is available, including Set methods,
    iterator helpers, `using`, `Promise.try`, `RegExp.escape`,
    `scheduler.yield`, `:has()`, nesting and `@scope`.
  - Temporal (144), `Uint8Array.fromBase64` (140) and `Math.sumPrecise`
    (147) need a check and a fallback.
- Build with esbuild: `format: 'cjs'`, `target: 'chrome138'` rather than the
  sample's `es2021`, and Obsidian's packages external. A `cjs` bundle can't
  hold top-level `await`, and `import.meta` is empty, so use
  `this.manifest.dir`.
- Node's modules (`fs`, `path`, `child_process`) and `electron` work on
  desktop, behind `Platform.isDesktopApp`. Use the Vault API for notes.
- Plain JavaScript can be type-checked: `checkJs` in a `jsconfig.json`,
  JSDoc types, `tsc -p jsconfig.json`, and one `.d.ts` that augments
  `obsidian` for internals and for 1.15 APIs not yet typed.

## Lifecycle

- `onload()` registers. The work waits for `workspace.onLayoutReady(fn)`
  (`workspace.layoutReady` says if it already has). Work that needs every
  note indexed also waits for the metadata cache's `resolved` event: since
  1.15.1 the workspace shows before indexing ends.
- These are released on unload automatically: `registerEvent`,
  `registerDomEvent`, `registerInterval`, `register(fn)`, `addCommand`,
  `registerView`, `registerEditorExtension`,
  `registerMarkdownPostProcessor` and `addChild`. Anything else needs its
  own cleanup (workers, observers, IndexedDB connections).
- Don't detach your views' leaves in `onunload()`: Obsidian restores them in
  place after an update.
- `onUserEnable()` (1.7.2) runs when the person turns the plugin on, not at
  every start. `onExternalSettingsChange()` runs when `data.json` changed on
  disk (sync): reload settings there.
- `loadData()` / `saveData()` read and write the whole `data.json`.
  `app.loadLocalStorage(key)` / `saveLocalStorage(key, value)` (1.8.7) keep
  per-vault state that shouldn't sync.

## Workspace and views

- To find what is open:
  - the current Markdown view: `getActiveViewOfType(MarkdownView)`;
  - its editor: `workspace.activeEditor?.editor`;
  - the open file: `getActiveFile()`;
  - the last main-area leaf: `getMostRecentLeaf()`.

  `workspace.activeLeaf` can be a sidebar leaf or null.
- To get a leaf:
  - `getLeaf(false)` reuses the current tab;
  - `getLeaf(true)` or `'tab'` opens a new one;
  - `'split'` or `'window'` splits or pops out;
  - side panes: `getLeftLeaf(false)`, `getRightLeaf(false)`,
    `ensureSideLeaf(type, side)`.
- **Deferred views (1.7.2):** a tab not yet shown holds a placeholder.
  `getLeavesOfType` returns it too, so test `leaf.view instanceof MyView`
  before calling methods. `await leaf.loadIfDeferred()` only when the real
  view is needed now; `await revealLeaf(leaf)` shows and loads it.
- `registerView(type, (leaf) => new MyView(leaf))`. Find views with
  `getLeavesOfType` and never keep them. `ItemView` gives `contentEl`,
  `onOpen`, `onClose`, `getViewType`, `getDisplayText` and `getIcon`.
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

- Look up by path with `getFileByPath`, `getFolderByPath` and
  `getAbstractFileByPath` (map lookups). `getFiles()`, `getMarkdownFiles()`,
  `getAllFolders()` and `getAllLoadedFiles()` build arrays of everything.
- Paths someone typed or code built: `normalizePath()`.
- Read with `cachedRead` to show, and with `read` right before writing.
- Write with `vault.process(file, fn)`, which is atomic. `vault.modify`
  writes a string read earlier and loses edits made in between. A note open
  in an editor is changed through the `Editor`, which keeps the cursor and
  undo.
- Properties: `fileManager.processFrontMatter(file, (fm) => …)` (atomic,
  Obsidian writes the YAML).
- Rename or move with `fileManager.renameFile`, which updates links;
  `vault.rename` doesn't. Delete with `fileManager.trashFile`, which honours
  the trash setting; `vault.delete` skips it.
  - Since 1.15.1, `trashFile` resolves `false` when it couldn't trash, so
    check it. It is still typed `Promise<void>`.
- `vault.copy` (1.8.7), `vault.append`, `vault.appendBinary` (1.12.3).
  `TExternalFile` (1.14.4) is outside the vault: check for it before
  treating a `TFile` as a note. `vault.adapter` is the raw file system, for
  files that aren't notes.

## Metadata cache

- `getFileCache(file)` returns null until the file is indexed. It holds
  `frontmatter`, `frontmatterPosition`, `headings`, `sections`, `links`,
  `embeds`, `tags`, `listItems`, `blocks`, `footnotes`, `footnoteRefs` and
  `referenceLinks`.
- `resolvedLinks` / `unresolvedLinks` hold source, target and count for the
  whole vault. `getFirstLinkpathDest(link, sourcePath)` resolves one link.
- `getFrontMatterInfo(text)` locates frontmatter in raw text.
- Read the cache instead of the files whenever it holds what you need.

## Markdown: three readers

The detail is in `references/markdown.md`. There is no single parser, and
none can be extended:
- **Editor drawing:** the CM5 `hypermd` mode run as a CM6
  `StreamLanguage`. It gives the syntax tree, line classes and Live
  Preview.
- **Editor commands:** Obsidian's own pattern. It drives Enter, Tab and
  renumbering.
- **Reading view and metadata cache:** a remark-parse-8 fork in `app.js`
  and in the cache's worker. It gives the HTML, `listItems` and `sections`.

All three take only `1.` / `1)` as an ordered marker, so `3.1.1.`, `a.` and
`iv.` are paragraphs everywhere. A plugin changes the result in one of two
ways:
- **the look:** keep a standard list and draw other numbers (CSS counters
  in the reading view, a widget in the editor);
- **every layer:** own the editor's decorations and keys, a post-processor,
  and its own index.

Replacing the editor's language is possible (the highest-precedence
`language` wins), but it breaks Live Preview, which reads hypermd's tokens.

## The editor (CodeMirror 6)

- `registerEditorExtension(array)`. To switch later, change the same array
  and call `workspace.updateOptions()`, which rebuilds every editor, so not
  per event.
- In an extension, the note is `state.field(editorInfoField)`
  (`editorViewField` is deprecated).
- `@codemirror/*` and `@lezer/*` are provided by Obsidian at runtime: mark
  them external when bundling, so there is one copy. The 1.14.4 typings pin
  `@codemirror/state` 6.7.6 and `@codemirror/view` 6.43.13: install those
  for types that match.
- Decorations for what is on screen: a `ViewPlugin` over
  `view.visibleRanges`, updated on `docChanged || viewportChanged`. A line
  decoration's class wins over Obsidian's own line styles. Use a
  `StateField` only for decorations that must exist off screen or change
  heights.
- Syntax-tree node names are segments joined by `_`
  (`formatting_formatting-code_formatting-code-end_inline-code`). Since
  1.15.0, match a segment (`name.split('_').includes('inline-code')`),
  never the whole name. The tree is parsed lazily.

## Reading view

- `registerMarkdownPostProcessor((el, ctx) => …)` runs per rendered section.
  It has `ctx.getSectionInfo(el)` and `ctx.sourcePath`; put long-lived work
  in a `MarkdownRenderChild` added with `ctx.addChild`.
- `registerMarkdownCodeBlockProcessor(lang, fn)` owns a fenced block.
- There is no hook before parsing. A post-processor may rebuild what it is
  given (it is drawn again from the note); recipe 23 turns a paragraph into
  a list.
- `MarkdownRenderer.render(app, md, el, sourcePath, component)`;
  `renderMarkdown` is deprecated.
- Mermaid diagrams are drawn by Pele since 1.15.0. Anything that styled or
  post-processed Mermaid's SVG by its class names must change.

## Settings

- **1.13:** a tab returns `getSettingDefinitions()`, which Obsidian draws
  and indexes for search. The items:
  - a control: `{ name, desc, control: { type, key, defaultValue, validate,
    … } }`, where `type` is `toggle`, `text`, `textarea`, `number`,
    `slider`, `dropdown`, `color`, `file`, `folder` or `secret`;
  - an action: `{ name, action(el) }`;
  - a custom `render`;
  - a group: `{ type: 'group', heading, items }`;
  - a list with add, delete and reorder;
  - a page: `{ type: 'page', name, items }`.

  `visible` and `disabled` may be functions. An `id` (1.14) keeps two
  siblings with the same name apart.
- **Values.** They go through `getControlValue` / `setControlValue`, which
  by default read `this.plugin.settings` and save. An override must save
  itself.
  - A `render` row doesn't save on its own, and the cleanup it returns may
    not run if the window is destroyed.
  - `validate` returns an error string (it may be async).
- **Redrawing.** Call `update()` when the set of definitions changes and
  `refreshDomState()` when only `visible` / `disabled` should be
  re-evaluated. Never call `display()`.
  - Keep `getSettingDefinitions()` cheap, with no I/O: it runs once for
    search and again on `update()`.
  - `display()` runs only when the definitions are empty, so both can live
    together for versions before 1.13.
- The settings window is its own document since 1.13: use
  `containerEl.ownerDocument`, never the global `document`.
- `SettingGroup` (1.11); secrets in `app.secretStorage` (1.11.4), or the
  `secret` control.

## UI pieces

- Commands: `callback`, `checkCallback` (shown only when it applies),
  `editorCallback`, `editorCheckCallback`; `removeCommand(id)` (1.7.2).
- `Menu` / `MenuItem`: `setSection(...)` places an entry among Obsidian's
  sections. `setSubmenu()` is not public.
- `Modal` (`setCloseCallback` 1.10; a field named `scope` breaks its keys),
  `ConfirmationModal`, `SuggestModal`, `FuzzySuggestModal`.
  `prepareFuzzySearch` ignores accents since 1.15.0.
- `Notice` (`messageEl`), `setTooltip`, `displayTooltip`; buttons have
  `setCta` and `setDestructive` (`setWarning` is deprecated).
- Icons: `addIcon(id, svg)`, `removeIcon`, `setIcon(el, id)`, `getIconIds()`.

## DOM and windows

- `createEl`, `createDiv`, `createSpan`, `el.empty()`, `el.toggleClass`.
- Popouts have their own `document` and `window`. `activeDocument` /
  `activeWindow` give the focused one, and `el.doc` / `el.win` an element's.
  `x.instanceOf(HTMLElement)` works across windows; `instanceof` doesn't.
  Create observers and `requestAnimationFrame` from `el.win`.
- Put long-lived timers on the main `window` (`window.setTimeout`), not on
  `activeWindow`: a popout's timers die with it (1.15.1).
- Listen for `window-open` / `window-close`. `el.onWindowMigrated(fn)` runs
  when a tab is dragged to another window.

## Styling facts

- `app.css` (1,229 variables in 1.15.1) is inside the app's `.asar`; read it
  with `scripts/obsidian-css.mjs`. For example, every editor line is
  `.markdown-source-view.mod-cm6 .cm-line { padding: 0; position: relative }`,
  so a plain class loses to it.
- Theme: `body.theme-light` / `.theme-dark`, `app.isDarkMode()`, and
  `css-change` when the theme changes.
- New variable families:
  - 1.14: `--tooltip-*`, `--notice-*`, `--hotkey*` and `--tab-*`;
  - 1.15: `--mermaid-*`.

## Other APIs

- **Bases (1.10).** `registerBasesView(id, { name, icon, factory, options })`
  returns `false` when Bases is off in the vault.
  - The view's `onDataUpdated()` gets `this.data.groupedData`, already
    filtered, sorted and grouped. It fires often, and the view must never
    keep `this.data`.
  - `entry.getValue(id)` returns a `Value`. `this.config.get(key)` and
    `getOrder()` give the view's options and the column order;
    `parsePropertyId` and the controller's `getEvaluatedFormula` are there
    too.
  - Option types: `text`, `toggle`, `slider`, `dropdown`, `file`, `folder`,
    `formula`, `multitext`, `property` and `group`.
  - An unfiltered base gives every file in the vault: reuse rows and draw
    only what shows.
- `registerCliHandler` (1.12.2), `registerObsidianProtocolHandler`,
  `registerHoverLinkSource`, `registerExtensions(exts, viewType)`.
- `requestUrl` (no CORS limits, no abort signal), `debounce(fn, ms,
  resetTimer)`, `getLanguage()`, `requireApiVersion`, `loadMermaid()`,
  `loadPixi()` (1.15.0, untyped).

## Internals (not in the types)

Common ones are `app.commands.executeCommandById`, `app.setting.open()`,
`app.plugins`, `app.internalPlugins`, `vault.getConfig`,
`app.metadataTypeManager`, `MenuItem.setSubmenu`, and 1.15's `window.pele`.
They can change in any release: guard each with a `typeof` check, and keep a
way through when it's missing. `obsidian-audit.mjs` lists them and whether
they're guarded.

## Performance in brief

The detail is in `references/performance.md`.
- **Startup.** `onload` only registers; reading the vault waits for
  layout-ready. Never load every deferred leaf. Subscribe to vault `create`
  after layout-ready.
- **One index.** Build it once from the metadata cache and patch it from
  `create`, `delete`, `rename` and `changed`; never walk the vault per
  render. For very large vaults, persist it in IndexedDB, named per vault
  (recipe 18), and parse in a worker (recipe 17).
- **Long work** runs in slices of about 8 ms, with `scheduler.yield()`
  between them (recipe 19).
- **Events.** `modify` and `changed` fire on every autosave: debounce, and
  never write from them without a guard.
- **Drawing.** Build lists off-screen and attach them once. Draw only the
  visible rows of long lists (recipe 20). Read layout before writing styles.
- **Writing.** Write many notes one at a time, skipping those that wouldn't
  change.
- **Measuring.**
  - Settings → Community plugins shows each plugin's startup time.
  - `performance.mark` / `measure` put labelled spans in DevTools'
    Performance tab. Record while reloading the app to profile startup.
  - Check `process.versions.chrome`: an old installer is slower for reasons
    that aren't yours.
  - One large plugin's author cut his vault load from 11 s to 6 s by
    minifying with Terser.

## Architecture in brief

The detail is in `references/architecture.md`.
- A thin `main` that only wires the parts together.
- Features as `Component`s added with `addChild`.
- Domain logic that never imports `obsidian`, and one adapter folder for
  everything that does.
- Settings with versioned migrations, one file and one test each.
- Events between features rather than imports.
- A size limit per module and a cycle check in CI.
- Build: esbuild, `cjs`, `chrome138`, Obsidian's packages external, minified
  for release.
- Tests: unit tests with a mock `obsidian`; end-to-end in the real app with
  wdio-obsidian-service 3.5, on the earliest and latest installers.

## Feature directions in brief

The detail is in `references/community.md`.
- Notebook Navigator became the most popular plugin (August 2026). People
  want one file browser that replaces the built-in one, opens tags and
  properties as lists, merges notes from subfolders, and stays fast on a
  large vault. Notebook Navigator keeps its cache in IndexedDB, mirrored in
  memory, and virtualises its lists.
- Folder notes that behave natively are a top forum request. Properties and
  Bases (plugins can add views inside Bases) are where people organise.

## Sources

- The `obsidian` package 1.14.4, `obsidian.d.ts` (npm, checked 2026-11-23).
- Obsidian 1.15.1's `app.js` and `worker.js`, from its release `.asar` on GitHub (read 2026-11-26).
- [Obsidian changelog](https://obsidian.md/changelog/): [1.15.0](https://obsidian.md/changelog/2026-11-02-desktop-v1.15.0/), [1.15.1](https://obsidian.md/changelog/2026-11-12-desktop-v1.15.1/), [1.14.4](https://obsidian.md/changelog/2026-10-01-desktop-v1.14.4/), [1.14.5](https://obsidian.md/changelog/2026-10-22-desktop-v1.14.5/).
- [Settings](https://docs.obsidian.md/Plugins/User+interface/Settings) and [migrating to declarative settings](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings); [Bases views](https://docs.obsidian.md/plugins/guides/bases-view).
- [Electron 43.0](https://www.electronjs.org/blog/electron-43-0) and the installer versions in `references/javascript.md`.
- Obsidian 1.15.1's `app.css`, from its release `.asar`.
- The Obsidian forum and Hub, and the repositories of Tasks, Dataview,
  Excalidraw, Omnisearch, QuickAdd, Templater, Obsidian Git, Kanban,
  Notebook Navigator and the sample plugin; the full lists are in the
  references.
