# Inside Obsidian

This was read from Obsidian 1.15.1's own code on 2026-11-26: the release
archive (`obsidian-1.15.1.asar.gz` on GitHub) holds `main.js` (Electron's
main process), `app.js` (the app), `worker.js` and the libraries. It was
cross-checked against the community typings
`@obsidian-typings/obsidian-public-1.15.1` 1.5.0.

Names in minified code change with every release; strings don't. To
re-derive every list here after an update, run `scripts/obsidian-source.mjs
--inventory`.

The claims marked ✓ are checked in the real app by the probe kit in `ci/`
(16 probes, all passing on 1.15.1; `references/testing.md`).

Nothing below is public API unless the main skill says so. Read it to
understand behaviour, and guard anything you call.

## What ships

| File | What it is |
| --- | --- |
| `main.js` | Electron's main process: windows, menus, the `app://` protocol, the CLI socket, updates, the managed policy |
| `index.html` → `app.js` | The app, one window per vault (3.4 MB) |
| `worker.js` | The "Metadata Cache Worker": parses notes into `CachedMetadata`, and sections into HTML |
| `sim.js` | The "Graph Worker": the graph's force simulation |
| `enhance.js` | The DOM helpers (`createEl`, `el.doc`, `instanceOf`, `Array.prototype.contains`, …) |
| `i18n.js` | Translations, used through i18next |
| `starter.js`, `help.js`, `quicklook.js` | The vault chooser, the help window, and macOS Quick Look previews |
| `sandbox/` | The sandbox vault's notes |

| Library | Version | Used for |
| --- | --- | --- |
| CodeMirror 5 (`lib/codemirror/`) | 5.64.0 | The `hypermd` Markdown mode (run inside CM6), code block modes, Vim |
| CodeMirror 6 | bundled in `app.js` | The editor |
| moment | 2.30.1 | Dates (exported as `moment`) |
| PDF.js | 5.3.34 | The PDF view |
| PIXI | 7.2.4 | The graph (loaded on first use since 1.15) |
| Pele (`pele.min.js`) | — | Mermaid diagrams since 1.15 |
| MathJax (`obsidian-mathjax.js`) | — | Maths |
| Prism | — | Code highlighting in reading view |
| Turndown, Defuddle 0.13.3, Readability | — | HTML to Markdown, and the Web viewer's "save page" |
| i18next, scrypt, reveal.js | — | Translations, encryption, Slides |
| `idb` (bundled) | — | Every IndexedDB database |

## Startup, in order

The marks are the ones `dev:startup` (and Settings → General → Advanced →
the stopwatch) report.

1. **Main process.** Opens the vault's window. The renderer asks over IPC for
   `startup` (zoom, the vault's last colours) and `startup-snapshot`.
2. **Snapshot.** The window paints the last session's snapshot (see below)
   in a sandboxed iframe while scripts load. It waits up to 150 ms for it.
3. **Libraries, then `app.js`.** `initialization.boot`, `.language`,
   `.electron`, `.construct`.
4. **`vault.setup`.** The config folder is read.
5. **`workspace.components.managers`.** Obsidian creates these objects:
   - the workspace, `fileManager`, status bar and `metadataCache`;
   - `metadataTypeManager` and `foldManager`;
   - `internalPlugins` and `plugins`.
6. **`workspace.appearance`.** Theme, fonts, the CSS theme and snippets.
7. **`workspace.managers.*`.** Property types (`types.json`), secret
   storage, hotkeys, then the built-in commands.
8. **`corePlugins`.** About 30 core plugins are constructed and enabled.
9. **`communityPlugins`.** Each enabled community plugin in turn:
   - **one at a time**, in the order of `community-plugins.json`;
   - its `onload` is awaited, then its `styles.css` is added;
   - one taking over 3 s shows a "hanging" notice with a Disable button.
10. **`vault.load`.** The vault's file tree is listed: `create` fires for
    every file and folder. ✓
11. **`vault.metadata`.** The metadata cache loads from IndexedDB and queues
    changed files for the worker. Its internal `finished` event fires here
    (and again once that queue is empty). ✓
12. **`workspace.layout.load`, `.open`, `.finalize`.** The saved layout is
    restored (tabs not in front stay deferred), and the opening behaviour
    runs.
13. **Layout-ready.** `onLayoutReady` callbacks run, and the snapshot is
    removed shortly after. CLI commands that arrived early run now.
14. **Later.** The worker finishes changed files (`changed` per file), and
    links resolve (`resolved`, once per batch). ✓

What this means for a plugin:
- **In `onload` the vault is empty.** `getFiles()` returns nothing, and the
  metadata cache and the layout aren't there yet. ✓ That is why work belongs
  in `onLayoutReady`.
- **Layout-ready doesn't mean indexed.** On a first start (or after many
  changes) most notes are still being parsed at layout-ready: in the probe,
  39 of 40. `resolved` then fires once per batch, as often as once per file.
  On a warm start, everything is indexed by layout-ready and `resolved` fires
  once. ✓ To know every note is indexed:
  - wait until `metadataCache.inProgressTaskCount === 0` (internal; guard
    it), checked on each `resolved`;
  - or wait for the second `finished`;
  - or check only the files you need with `getFileCache(file)`.
- **A slow `onload` delays every plugin after it, and the app.** ✓ Await
  nothing slow there. `dev:startup` shows each plugin's cost as
  `communityPlugins.<id>`; a 500 ms wait in `onload` reads as 509 ms.
- **`styles.css` arrives after `onload`.** ✓ A view drawn inside `onload`
  appears unstyled for a moment.

## How a plugin is loaded

- The manifest is read from `<configDir>/plugins/<dir>/manifest.json`. An
  `author` of "Obsidian" is blanked.
- **On desktop, `main.js` runs as a real `<script>`.** The main process serves
  it from a plugin script root (`…/<appId>/<dir>?id=<id>`), so DevTools shows
  the file. Otherwise it is read and run with `window.eval` inside a wrapper,
  ending `//# sourceURL=plugin:<id>`. Either way, DevTools lists it under
  `plugin:<id>`.
- **Inline source maps are stripped**, unless debug mode is on or the file
  ends with `/* nosourcemap */`. To debug with source maps, run
  `app.debugMode(true)` in the console and reload the plugin.
- **`require` inside a plugin resolves to:**
  - `obsidian`;
  - `@codemirror/autocomplete`, `collab`, `commands`, `language`, `lint`,
    `search`, `state`, `view` (and `text`, mapped to `state`);
  - `@lezer/common`, `lr`, `highlight`;
  - the CM 0.19 package names (`@codemirror/stream-parser`, `fold`,
    `gutter`, `rangeset`, …), mapped to their successors with a
    deprecation error;
  - anything else is Node's `require` (desktop). Under mobile emulation, Node
    packages are refused.
- The export (`default` or `module.exports`) must extend `Plugin`. Then
  Obsidian runs `load()` (your `onload`), then `loadCSS()`, then
  `onUserEnable()` if the person just turned it on.
- `onExternalSettingsChange` is driven by the `raw` event on the plugin's
  `data.json`: Obsidian compares its mtime with the last one it wrote.

## Style order

`<head>` holds, in this order:
1. `app.css`;
2. each plugin's `styles.css`, in load order (inserted before the theme);
3. the theme (`customCss.styleEl`);
4. each enabled snippet.

At equal specificity, later wins: **a theme or snippet overrides a plugin**. ✓
Snippets and themes reload 100 ms after their files change.

## The startup snapshot (1.15.1)

- **When it is saved.** Each window saves a snapshot when it closes, and
  when it loses focus (after a delay). The snapshot is:
  - a clone of the title bar and the app container, keeping only what is
    visible (`getClientRects()`);
  - the values of inputs, but not passwords;
  - scroll positions;
  - `img`, `iframe`, `video` and the like, with `src` removed;
  - every stylesheet, inlined.

  It goes to `<userData>/<vaultId>.snapshot`, with the layout and the body
  classes.
- **When it is shown.** At the next start it is shown before any script
  runs, and removed after layout-ready.
- **For a plugin:** its DOM and its body classes (a look turned on through
  `body.my-active`) appear at once, before the plugin has loaded. Keep what
  the plugin draws at rest a true picture: whatever is on screen when the
  window blurs is what the next start shows first.

## The `app` object

| Member | What it is |
| --- | --- |
| `appId` | The vault's id (names its IndexedDB databases and localStorage keys) |
| `vault`, `metadataCache`, `fileManager`, `workspace` | Public |
| `commands` | `commands`, `editorCommands`, `executeCommandById(id)`, `findCommand(id)`, `listCommands()` |
| `setting` | The Settings window: `open()`, `openTabById(id)`, `close()` |
| `plugins` | Community plugins: `plugins`, `manifests`, `enabledPlugins`, `enablePluginAndSave`, `disablePluginAndSave`, `loadPlugin`, `unloadPlugin` |
| `internalPlugins` | Core plugins: `getPluginById(id)` gives `{ enabled, instance }`; `getEnabledPluginById(id)` |
| `customCss` | Themes and snippets: `theme`, `snippets`, `enabledSnippets`, `setTheme`, `setCssEnabledStatus` |
| `hotkeyManager` | `customKeys`, `defaultKeys`, `getHotkeys(id)`, `printHotkeyForCommand(id)` |
| `metadataTypeManager` | Property types (`types.json`): `getTypeInfo(name)`, `setType(name, type)`, `properties` |
| `foldManager` | Saved folds per file |
| `dragManager` | The drag in progress (`draggable`), `handleDrag`, `handleDrop` |
| `embedRegistry` | Who draws an embed of each extension: `registerExtension(ext, creator)` |
| `viewRegistry` | View types and extensions: `viewByType`, `typeByExtension`, `getTypeByExtension(ext)` |
| `keymap`, `scope` | Public (`Keymap`, the app's root `Scope`) |
| `secretStorage` | Public (1.11.4) |
| `statusBar`, `dom`, `appMenuBarManager`, `cli`, `renderContext` | The status bar, the app's DOM roots, the native menu, the CLI, the rendering context |
| `lastEvent` | The last user input event (for `Keymap.isModEvent` and the like) |
| `debugMode(on)` | Debug mode: keeps source maps, and loads plugin scripts with `debug=1` |
| `emulateMobile(on)` | Mobile emulation (desktop) |
| `openVaultChooser()`, `getObsidianUrl(file)`, `showInFolder(path)`, `openWithDefaultApp(path)` | What they say |

## Core plugins, views and file types

- **Core plugin ids:**
  - `audio-recorder`, `backlink`, `bases`, `bookmarks`, `canvas`;
  - `command-palette`, `daily-notes`, `editor-status`, `file-explorer`;
  - `file-recovery`, `footnotes`, `global-search`, `graph`;
  - `note-composer`, `outgoing-link`, `outline`, `page-preview`;
  - `properties`, `publish`, `random-note`, `slash-command`, `slides`;
  - `switcher`, `sync`, `tag-pane`, `templates`, `webviewer`;
  - `word-count`, `workspaces`, `zk-prefixer` (unique note).
- **View types:**
  - `markdown`, `empty`, `image`, `audio`, `video`, `pdf`;
  - `canvas`, `bases`, `graph`, `localgraph`;
  - `file-explorer`, `search`, `tag`, `bookmarks`, `backlink`,
    `outgoing-link`, `outline`;
  - `all-properties`, `file-properties`;
  - `webviewer`, `webviewer-history`, `sync`, `release-notes`.
- **Extensions with a view:**
  - Markdown, Canvas and Bases: `md`, `canvas`, `base`;
  - PDF and images: `pdf`, `png`, `jpg`, `jpeg`, `gif`, `bmp`, `svg`, `webp`,
    `avif`;
  - audio: `mp3`, `wav`, `m4a`, `flac`, `ogg`, `oga`, `opus`;
  - video: `mp4`, `webm`, `ogv`, `mov`, `mkv`, `3gp`.

## Events Obsidian triggers

Typed ones are in the main skill. These are also fired, and are internal:

| Event | Emitter, and when |
| --- | --- |
| `layout-ready` | workspace, once, as layout-ready |
| `editor-selection-change`, `editor-formatting-target-change` | workspace, from the editor |
| `markdown-scroll` | workspace, a Markdown view scrolled |
| `leaf-menu`, `tab-group-menu`, `markdown-viewport-menu`, `markdown-properties-menu`, `receive-text-menu`, `receive-files-menu` | workspace, a menu is being built (add items like `file-menu`) |
| `canvas:node-menu`, `canvas:edge-menu`, `canvas:selection-menu`, `canvas:node-connection-drop-menu` | workspace, Canvas's menus |
| `bookmarks:bookmarks-menu`, `search:results-menu` | workspace, those views' menus |
| `hover-link` | workspace, show a page preview (payload in `references/areas.md`) |
| `hover-link-sources-changed`, `extensions-updated`, `view-registered`, `view-unregistered` | registries changed |
| `window-frame-change`, `swipe`, `history-change`, `pinned-change`, `group-change` | window and tab state |
| `finished` | metadataCache, the initial pass over the vault is queued |
| `raw` | vault, every path the watcher sees, config files included |
| `config-changed` | vault, `app.json` changed |
| `file-created`, `file-removed`, `folder-created`, `folder-removed`, `renamed`, `modified`, `external-watch`, `unreadable`, `closed` | the adapter and watcher, below `create` / `delete` |
| `status-change`, `new-log` | Sync |
| `webviewer:update-history` | Web viewer |

## Settings and storage

- **Defaults of `vault.getConfig(key)` (1.15.1):**
  - Editing:
    - `livePreview: true`, `defaultViewMode: 'source'`;
    - `useTab: true`, `tabSize: 4`;
    - `smartIndentList`, `foldHeading`, `foldIndent`, `showIndentGuide`:
      `true`;
    - `showLineNumber: false`, `autoPairBrackets: true`,
      `autoPairMarkdown: true`;
    - `spellcheck: true`, `strictLineBreaks: false`,
      `readableLineLength: true`;
    - `rightToLeft: false`, `vimMode: false`, `autoConvertHtml: true`.
  - Display:
    - `propertiesInDocument: 'visible'`;
    - `showInlineTitle`, `showViewHeader`, `showRibbon`,
      `floatingNavigation`: `true`;
    - `theme: 'system'`, `cssTheme: ''`, `accentColor: ''`;
    - `translucency: false`, `nativeMenus: null`;
    - `textFontFamily`, `interfaceFontFamily`, `monospaceFontFamily`: `''`;
    - `baseFontSizeAction: false`.
  - Files and links:
    - `alwaysUpdateLinks: false`, `useMarkdownLinks: false`,
      `newLinkFormat: 'shortest'`;
    - `newFileLocation: 'root'`, `newFileFolderPath: '/'`,
      `attachmentFolderPath: '/'`;
    - `showUnsupportedFiles: false`, `userIgnoreFilters: null`;
    - `promptDelete: true`, `trashOption: 'system'`,
      `deleteUnlinkedAttachments: 'ask'`.
  - Behaviour:
    - `focusNewTab: true`, `openBehavior: ''`;
    - `uriCallbacks: false`, `settingsPopoutWindow: true`;
    - `pdfExportSettings: { pageSize: 'Letter', landscape: false, margin:
      '0', downscalePercent: 100 }`.
  - Also stored: `hotkeys`, `enabledCssSnippets`, `types`, and the mobile
    keys.
- **The config folder** (`vault.configDir`) holds:
  - `app.json` (the settings above), `appearance.json`;
  - `core-plugins.json`, `community-plugins.json`, `hotkeys.json`;
  - `types.json` (property types);
  - `workspace.json` (`workspace-mobile.json` on mobile);
  - each core plugin's own file (`graph.json`, `bookmarks.json`, …);
  - `plugins/<id>/` (`manifest.json`, `main.js`, `styles.css`,
    `data.json`), `themes/<name>/`, `snippets/*.css`.
- **IndexedDB, per vault:**
  - `<appId>-cache`: the metadata cache;
  - `<appId>-backup`: File recovery's snapshots, taken on change and pruned
    hourly;
  - `<appId>-sync`, `<appId>-webview`.
- **localStorage:**
  - `app.loadLocalStorage` keys are prefixed with the app id:
    `recent-commands`, `recent-searches`, `base-font-size`,
    `last-plugin-update-check`, `note-fold-*`, `canvas-*`, `tag-pane-fold`;
  - also global keys: `language`, `<appId>-config`.
- **The user-data folder** (Electron's):
  - `obsidian.json` (the vault list);
  - `<vaultId>.snapshot`;
  - `obsidian-<version>.asar` (the app's code, updated in place);
  - Chromium's own storage.

## The metadata cache

- **Stored in IndexedDB `<appId>-cache`** as two stores:
  - `file`: each path's `{ mtime, size, hash }`;
  - `metadata`: each hash's `CachedMetadata`, so identical files share one
    entry.
- **At startup:**
  - a file whose `mtime` and `size` are unchanged reuses its entry and only
    has its links resolved again;
  - others go to the worker, which gets the file's bytes and returns its
    metadata;
  - deleted paths are cleaned 1 minute after start, then every 10 minutes.
- **Lookups.** `getFileCache(file)` is two map lookups (path → hash →
  metadata). A link resolves through a lowercase name index
  (`uniqueFileLookup`).
- **The order of events.** `finished` fires once the first pass is queued,
  `changed` fires per file as the worker returns it, and `resolved` fires
  when the link queue empties. A large first index shows a progress notice
  after 1 s.

## The vault on disk

- **Watching.** Node's `fs.watch`: recursive on macOS and Windows, one
  watcher per folder on Linux.
  - Every change is reconciled through a serial queue, and fires `raw` with
    the path first.
  - Hidden paths (a name starting with `.`, which includes the config
    folder) fire `raw` but never `create`, `modify` or `delete`.
- **The first listing** comes from a quick native list where available, and
  otherwise a recursive `readdir`.
- **Vault files are served to the page** over `app://` (as
  `getResourcePath` returns them), with `Last-Modified` set.

## Save timings

| What | After |
| --- | --- |
| A Markdown note, while typing | 2 s after the last change, so `modify` follows about 2 s after typing stops (measured: 2,009–2,013 ms ✓) |
| A `TextFileView`'s `requestSave()` | 2 s |
| Folds | 0.5 s |
| `workspace.json` (`requestSaveLayout`) | 1 s |
| `app.json` (`requestSaveConfig`) | 1 s |
| `layout-change` | 10 ms after the change |
| Theme / snippets reload | 0.1 s |

## URIs, and the command line

- **`obsidian://` actions built in:**
  - `open`, `new`, `search`;
  - `show-plugin`, `show-theme`, `show-release-notes`, `debug-info`;
  - `publish-sites`, `sync-setup`, `vault-setup`;
  - `hook-get-address`.

  Core plugins add their own (`daily`, `unique`, …). With `uriCallbacks` on,
  `x-success` / `x-error` callbacks work.
- **The command line:**
  - **Off by default.** Turn it on in Settings → General → Command line
    interface; this is stored in `obsidian.json`. In a test, call
    `electron.ipcRenderer.sendSync('cli', true)` in the app. ✓
  - **What it is.** Two executables:
    - the `obsidian` executable, which is the app itself (run as root, it
      needs `--no-sandbox`);
    - `obsidian-cli`, a native client of about 18 KB beside it, which talks
      to the socket directly and is what `/usr/local/bin/obsidian` links to
      on macOS. On Windows, Settings adds the app's folder to PATH.
  - **How it reaches the app.** It passes its arguments to the running app
    through `~/.obsidian-cli.sock` (`$XDG_RUNTIME_DIR` on Linux, a named
    pipe on Windows), and starts the app when none is running.
  - **Syntax.** `obsidian [vault=<name>] <command> key=value …`, with
    `--json`, `--md`, `--csv`, `--tsv`, `--copy` or `--help`. With no
    command, it opens an interactive prompt with completions.
  - **The developer commands**, a loop an AI can drive without a person:

| Command | Does |
| --- | --- |
| `plugin:reload id=<id>` | Reload a plugin after building it |
| `dev:errors [clear]` | The errors captured since start (or since cleared) |
| `dev:console [clear]` | The console messages captured, once `dev:debug on` has attached the debugger ✓ |
| `eval code=<js>` | Run JavaScript in the app: an expression prints `=> value`; statements with `await` end in `return x` ✓ |
| `dev:dom selector=<css>` | The elements a selector matches |
| `dev:css selector=<css>` | The CSS rules that apply, with their source |
| `dev:screenshot path=<file>` | A screenshot of the window |
| `dev:startup [format=json]` | The startup time breakdown, by the marks above, with each plugin as `communityPlugins.<id>` ✓ |
| `dev:cdp method=<CDP.method>`, `dev:debug on` | Chrome DevTools Protocol |
| `dev:mobile on` | Mobile emulation |
| `devtools`, `reload`, `restart` | What they say |

- **The other commands:**
  - files: `files`, `file`, `folder(s)`, `read`, `create`, `append`,
    `prepend`, `move`, `rename`, `delete`, `open`, `diff`;
  - links and metadata: `backlinks`, `links`, `unresolved`, `orphans`,
    `deadends`, `tags`, `tag`, `aliases`, `properties`, `property:read`,
    `property:set`, `property:remove`, `tasks`, `task`, `outline`,
    `wordcount`, `search`, `search:context`;
  - commands and hotkeys: `command(s)`, `hotkey(s)`;
  - plugins, themes and snippets: `plugins`, `plugin:enable`, `plugin:disable`,
    `plugin:install`, `plugin:uninstall`, `plugins:restrict`, `themes`,
    `theme:set`, `theme:install`, `snippets`, `snippet:enable`;
  - core plugins: `daily*`, `bases`, `base:query`, `base:create`,
    `bookmarks`, `templates`, `history*`, `sync*`, `publish*`,
    `workspace*`, `web`, `random`, `recents`, `tabs`, `vault(s)`,
    `version`.

  A plugin adds its own with `registerCliHandler` (1.12.2).

## Managed policy (organisations)

Obsidian reads a `policy.json` (`schemaVersion: 1`) at a fixed path:
- macOS: `/Library/Application Support/Obsidian/policy.json`;
- Windows: `C:\Program Files\Obsidian\policy.json`;
- Linux: `/etc/obsidian/policy.json`.

The "Obsidian Work" build uses `ObsidianWork` / `obsidian-work` instead. The
policy can:
- set each core plugin `off`, `manual` or `forced`;
- limit community and private plugins, themes and snippets, DevTools and
  insider builds;
- require a minimum app or installer version, and block versions.

A plugin the policy doesn't allow refuses to install or enable, saying it
is "managed by your organization's policy".

## Debugging, from all of the above

- Run `app.debugMode(true)` (in the console or with `obsidian eval`) to keep
  source maps, then reload the plugin.
- Build, `obsidian plugin:reload id=<id>`, then `obsidian dev:errors` and
  `obsidian dev:console`; check the DOM with `dev:dom` and the cascade with
  `dev:css`.
- `obsidian dev:startup` shows what each plugin costs at start. A plugin is
  timed under `communityPlugins`.
- A plugin that seems to load twice or not at all: check
  `community-plugins.json`'s order and the `plugin:<id>` entry in DevTools.
