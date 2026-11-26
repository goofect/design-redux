# What the community says: practices, speed, and what people want

Gathered 2026-11-22 from the Obsidian forum, the Obsidian Hub, community
guides and the community plugin directory. Reddit refused access to
automated readers, and YouTube videos could only be found by title (no
transcripts), so neither is a source below; the forum covers the same
ground.

## Speed, as users and plugin authors see it

- **Users measure plugins.** Settings → Community plugins can show each
  plugin's startup time, and the forum's advice to slow vaults is to sort by
  it. A plugin that costs tens of milliseconds at startup gets noticed and
  disabled.
- **Users bisect.** The standard advice (Obsidian Hub) is Safe mode, then
  turning plugins back on by halves, or the *Divide & Conquer* plugin that
  automates it. The same guide notes that some plugins don't release their
  resources until a restart: unload must leave nothing running.
- **People run many plugins.** Reports of 60 to 80 enabled plugins are
  common, with the command palette and settings search slowing as plugins
  pile up. Each command a plugin registers is one more line to search: keep
  commands to what is used, and use `checkCallback` so the rest are hidden
  when they don't apply.
- **Defer.** The repeated advice on startup is to do nothing until the
  feature is needed, or until the layout is ready.
- **Minify harder.** The Excalidraw author reported that running Terser
  over his plugins' `main.js` cut his vault's load time from 11 to 6 seconds
  and package size by 12% (forum, "Call for plugin performance
  optimization"). Worth measuring for a large bundle: esbuild's minifier is
  faster, Terser's output smaller.
- **Profile the way plugin developers do** (Fevol's debugging gist):
  - `console.time('x')` / `console.timeEnd('x')` around a suspect block;
  - `performance.mark()` and `performance.measure()` to put labelled spans in
    the Performance tab's Timings track, so the plugin's work is easy to
    find among others';
  - record in the Performance tab and run *Reload app without saving* while
    recording, to profile startup;
  - in the flame chart, wide blocks are the slow functions; the Bottom-Up
    tab sorts by time spent (the Hub guide's example: Layout and Recalculate
    Style dominating, i.e. too much DOM work);
  - breakpoints under `plugin:<id>` in Sources, or a `debugger;` line.
  The gist's example: a render function at 20 ms, nearly all in
  `MarkdownRenderer.render`. Call expensive renders less, or write a cheaper
  path.

## Coding practices that keep coming up

These agree with the architecture and performance references:
- Register everything through the plugin or a `Component`, so Safe mode and
  disabling really stop the plugin.
- Use the public API; plugins that depend on Obsidian's DOM or internals
  break on updates. The forum's case for native folder notes is exactly
  that the Folder Notes plugin "relies on unofficial APIs and DOM changes".
- Ship small: one bundle, Obsidian's packages external, minified.
- Test against a large vault before release; slowness only shows at
  thousands of notes.

## What people want: directions for features

### A better file browser is the most wanted thing in Obsidian

*Notebook Navigator* became the most popular plugin in the community
directory in August 2026, approaching a million downloads (by dsebastien's
count; a vendor case study by the author says 700,000). It is "a better
file browser and calendar inspired by Apple Notes, Bear, Evernote and Day
One": a folder tree, a list pane of notes, notes from subfolders merged into
one list, search over aliases and all properties, tags, a calendar for
daily notes, folder notes, manual sort, and vault profiles.

What users say about it on the forum:
- they want it as the *default* explorer, not beside the built-in one, and
  switching between the two confuses them;
- clicking a tag in a note should show its notes in the browser, not
  Obsidian's tag popup;
- the settings are many and the interface dense for minimalists;
- it handles large vaults well, and replaces several other plugins.

How it stays fast:
- a cache in IndexedDB, mirrored in memory for synchronous reads;
- lists virtualised with TanStack Virtual;
- a batched, debounced pipeline that can be cancelled, for previews;
- by its own claim, 100,000+ notes.

For a library or explorer plugin, that sets the bar: speed on a large
vault, one place to browse instead of two, tags and properties as ways in,
and fewer settings than the leader.

### Folder notes, done as if they were native

A top forum request is for each folder to have a note of its own:
- pairing automatic and optional: a note named like the folder, or a
  configurable `index.md` inside it;
- clicking the folder opens its note;
- the folder note shows up wherever notes do: links, breadcrumbs, the graph;
- folders, notes and folder notes stay distinct for those who don't use it.

### Properties and Bases

- Requests for block-level properties (metadata below the note level), and
  the attention on the *Embed Metadata* plugin, show properties are central
  to how people organise.
- Bases requests: multi-level grouping, and a Kanban with manual card order
  saved to a property. *Base Board* (a property-driven Kanban on Bases) drew
  attention.
- Plugins can add view types to Bases (`registerBasesView`, 1.10). A
  plugin's list, table or board as a Bases view gets filtering, sorting,
  grouping and saved views from Obsidian, and lands where users already
  look for "database" views.

### Where these point for a library plugin

In order of reach:
1. **Be the explorer, not a second one.** A command or setting that opens
   the library where the file explorer was, and handles everything people
   do there (create, rename, move, drag, reveal).
2. **Tags and properties as ways in.** Opening a tag or a property value
   from a note shows its notes in the library's list.
3. **Notes from subfolders**, merged in one list, as an option.
4. **Folder notes that behave natively:** pairing, opening on click,
   appearing in links and breadcrumbs.
5. **A Bases view** for the library's list, so it can be saved, filtered
   and grouped with Obsidian's own tools.
6. **A startup budget** (a few milliseconds in `onload`), checked by a test,
   and a measured choice between esbuild and Terser minification.

## Sources

- [Call for plugin performance optimization - especially for plugin startup](https://forum.obsidian.md/t/call-for-plugin-performance-optimization-especially-for-plugin-startup/32321), Obsidian forum
- [A big number of plugins make Obsidian slow](https://forum.obsidian.md/t/a-big-number-of-plugins-make-obsidian-slow-community-plugin-settings-command-palette/72450), Obsidian forum
- [How to debug why Obsidian is running slowly](https://publish.obsidian.md/hub/04+-+Guides%2C+Workflows%2C+%26+Courses/Guides/How+to+debug+why+Obsidian+is+running+slowly), Obsidian Hub
- [Debugging and profiling in Obsidian](https://gist.github.com/Fevol/b672865d61e54ac6f61e7c88aa05ba42), Fevol (gist)
- [Notebook Navigator is now Obsidian's most popular plugin](https://www.dsebastien.net/notebook-navigator-is-now-obsidians-most-popular-plugin/), dsebastien.net, 2026-08-20
- [Set default File Explorer: Internal or plugin like Notebook Navigator](https://forum.obsidian.md/t/set-default-file-explorer-internal-or-plugin-like-notebook-navigator/108593?page=2), Obsidian forum
- [Notebook Navigator Folder Tools](https://community.obsidian.md/plugins/notebook-navigator-folder-tools), community directory
- [Have each folder be automatically associated with a note](https://forum.obsidian.md/t/have-each-folder-be-automatically-associated-with-a-note-like-the-folder-notes-plugin/), Obsidian forum
- [Top topics](https://forum.obsidian.md/top.md), Obsidian forum
