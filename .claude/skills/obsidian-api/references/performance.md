# Performance

Where Obsidian plugins get slow, and what to do instead. The figures are the
usual orders of magnitude; measure the real plugin before and after (see the
end).

## Startup

- `onload()` runs before the vault and the workspace are ready, while
  Obsidian is still drawing. Keep it to registering: views, commands,
  settings, editor extensions, post-processors, icons. Everything that reads
  the vault, builds an index or opens a view goes in
  `this.app.workspace.onLayoutReady(() => ...)`.
- Since 1.7.2, tabs that aren't shown hold a deferred placeholder, and that
  saves most of a large workspace's startup. Don't undo it: never call
  `loadIfDeferred()` on every leaf, never iterate leaves to draw into
  their views at startup. Draw a view when its `onOpen()` runs.
- Vault `create` fires once per file while the vault loads. Subscribe inside
  `onLayoutReady`, or check `this.app.workspace.layoutReady`.
- Obsidian's own heavy parts load late since 1.15.0: `PIXI` arrives with the
  first graph (`loadPixi()`), and Mermaid diagrams are drawn by Pele, which
  Obsidian says renders up to 500 times faster.
- Since 1.15.1 the workspace appears before indexing ends, with progress in
  the status bar. Work that needs the metadata cache waits for its
  `resolved` event, not only for layout-ready.
- Import heavy code (a 3D library, a parser) only when it's first used, or
  build it into the bundle once; never `require` it at load if few people
  use the feature.

## Reading the vault

- `vault.getFileByPath`, `getFolderByPath` and `getAbstractFileByPath` are
  map lookups. `getFiles()`, `getMarkdownFiles()` and `getAllLoadedFiles()`
  build a new array of every file on each call: fine once, slow in an event
  handler or a render on a 10,000-note vault.
- Ask the metadata cache before reading text. `getFileCache(file)` already
  holds frontmatter, headings, links, tags, list items, sections, blocks and
  footnotes, parsed once by Obsidian. Reading files with `vault.read` to find
  the same things costs a disk read and a parse per file.
- When text is needed, `cachedRead` for display (it can come from memory);
  `read` only right before writing.
- Keep an index of your own and change it from events, rather than
  rebuilding it: `create`, `delete` and `rename` on the vault, `changed` and
  `deleted` on the metadata cache. On `rename`, move the entry; on
  `changed`, redo only that file.
- `metadataCache.resolvedLinks` holds every link in the vault (source, then
  target, then count). Build backlinks from it once, after `resolved` has
  fired the first time, then patch them from `changed`. Scanning it per
  render is O(links in the vault).

## Events

- Vault `modify` fires on every save, and Obsidian saves about every two
  seconds while someone types. Metadata `changed` follows each one. Handlers
  for both must be cheap, or debounced.
- Collapse bursts into one piece of work: `debounce(fn, ms, true)` from
  `obsidian`, or a single flag and `requestAnimationFrame` for redraws.
  A rename of a folder fires one `rename` per file inside it.
- `resolved` fires after every batch of link resolution, not only once.
- `layout-change` fires for any change to panes, tabs or sizes. Check what
  actually changed before redrawing.
- Never write a file from a `changed` or `modify` handler without a guard:
  the write fires the event again.

## Drawing

- Build a list off-screen and attach it once: create the container, fill
  it, then append it. Appending rows one by one to a visible element forces
  a layout per row.
- Long lists (thousands of rows) draw only what is visible: a fixed row
  height, a spacer for the rest, and a `scroll` handler that redraws the
  window of rows once per frame (recipe 20). Obsidian's own file explorer
  does the same.
- Long work in the main thread runs in slices of about 8 ms, with
  `scheduler.yield()` between them (recipe 19), so typing never waits.
  Parsing that needs no `app` can go to a worker (recipe 17).
- Read layout, then write: measuring (`offsetHeight`,
  `getBoundingClientRect`) after changing styles in the same frame forces a
  synchronous layout each time.
- Redraw what changed, not the whole view. Keep a map from file path to its
  row element and update that row.
- Let CSS skip off-screen work: `content-visibility: auto` with
  `contain-intrinsic-size` on long sections, `contain: content` on
  self-contained panes.
- `:has()` and long descendant selectors are evaluated on every style change
  of a large DOM such as the editor; keep selectors short and anchored on a
  class.
- A `MutationObserver` on `document.body` with `subtree: true` sees every
  keystroke's DOM change in every editor. Observe the smallest element that
  can change, without `subtree` where possible, and debounce the callback.

## The editor (CodeMirror 6)

- A decoration `StateField` that rebuilds over the whole document on every
  change is O(note length) per keystroke. For decorations that depend only
  on what is shown, use a `ViewPlugin` that builds from `view.visibleRanges`
  and updates on `update.docChanged || update.viewportChanged`.
- When a whole-document field is needed, update it from the transaction's
  changes (`tr.changes.iterChangedRanges`) and map the old decorations
  (`set.map(tr.changes)`) instead of rebuilding.
- `syntaxTree(state)` returns only what the parser has reached; a long note
  may be half parsed. `ensureSyntaxTree(state, upto, timeout)` parses
  further within a time limit; don't force a full parse on each keystroke.
- `editor.getValue()` copies the whole note into a new string. In a change
  handler, read the changed lines with `getLine` or `getRange`.
- `RangeSetBuilder` needs ranges in document order; sorting first is cheaper
  than letting `Decoration.set(ranges, true)` sort a large array.
- Reconfiguring an extension (`workspace.updateOptions()`) rebuilds every
  open editor's state: do it when a setting changes, not per event.

## Reading view

- A post-processor runs for every section of every note rendered, and again
  each time a section re-renders. Keep it to the element it is given, and
  bail out early when the section has nothing for it (check a tag name or a
  class first).
- Don't read files or walk the vault from a post-processor; take what it
  needs from the metadata cache or from an index built beforehand.
- Anything a section starts (a listener, an interval, a child component)
  goes in a `MarkdownRenderChild` added with `ctx.addChild`, so it stops when
  the section goes. Otherwise it leaks once per re-render.

## Writing

- `processFrontMatter` and `vault.process` each read, change and write one
  file, and each triggers a re-parse. For many files, run them one after
  another (`for … of` with `await`), not all at once: hundreds of
  simultaneous writes stall the app and the sync.
- Batch a change to many notes behind one notice or progress line, and skip
  files the change wouldn't alter, so they aren't rewritten at all.
- `saveData()` writes the whole `data.json`. Debounce saves of settings that
  change often (a remembered scroll position); UI state that doesn't need to
  sync is cheaper in `app.saveLocalStorage` (1.8.7).

## Memory

- Everything registered through the plugin (`registerEvent`,
  `registerDomEvent`, `registerInterval`, `addChild`) is released on unload;
  anything else needs explicit cleanup.
- Drop map entries for deleted files on vault `delete`; keep paths, not
  `TFile` objects, in long-lived structures.
- Associate data with DOM elements in a `WeakMap`, so it goes when the
  element does.
- Timers that must outlive a popout go on the main `window`: one set on a
  popout's window never fires once it closes (1.15.1).
- Known leaks in Obsidian itself, fixed in 1.13.6 (Live Preview table
  reordering) and 1.14.4 (the metadata cache with external files). Hunt
  your own leaks on 1.14.4 or later.

## Measuring

- Developer Tools: Cmd+Option+I (macOS) or Ctrl+Shift+I. The Performance
  tab records a trace: reload the app with the recording on to see startup,
  or record while typing in a long note.
- Around a suspect: `const t = performance.now(); …; console.debug('index', performance.now() - t)`.
- Startup: compare app reload time with the plugin on and off, on a large
  vault, a few times each.
- `performance.mark('x:start')` / `performance.measure('x', 'x:start')`
  put a labelled span in the Timings track of a recording.
- Know the runtime you measure: `process.versions.chrome` in the console.
  The Electron 43 installers (1.13 and later) have V8's profile-guided
  builtins and bytecode caching, so an old installer is slower for reasons
  that aren't the plugin's.
- Test with a vault big enough to show it: a few thousand notes and a note of
  several thousand lines.
