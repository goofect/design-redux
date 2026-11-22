# Architecture and file layout

How the large, long-lived Obsidian plugins organise their code, and what
that suggests for a plugin of any size. Surveyed on 2026-11-22 from the
default branch of each repository (file trees, plus the Tasks plugin's own
contributor docs).

## What the big plugins do

| Plugin | Layout | Worth copying |
| --- | --- | --- |
| Sample plugin (Obsidian) | `src/main.ts`, `src/settings.ts` | The build: esbuild, `cjs`, `es2021`, Obsidian's packages external; `eslint-plugin-obsidianmd` (0.6.0) |
| Tasks (1,862 files) | By domain: `Task/`, `Query/` (`Filter/`, `Sort/`, `Group/`), `Statuses/`, `TaskSerializer/`, `Renderer/`, `Config/`, `Commands/`, `ui/`, `lib/`, and **`Obsidian/`** for everything that needs Obsidian's types | Obsidian kept to one folder, the rest testable with a mock `obsidian` module; circular dependencies tracked in CI; contributor docs with "How do I add a field / a filter" guides and architecture decision records |
| Dataview | By layer: `data-model/`, `data-import/` (parsing, in a **web worker**), `data-index/`, `query/`, `expression/`, `api/`, `ui/` | Parsing off the main thread; a public API in its own folder |
| Excalidraw (1,200 files) | `core/managers/`: `CommandManager`, `EventManager`, `FileManager`, `ObserverManager`, `StylesManager`, `StartupTimer`, `PluginSettingsManager` and more; host adapters; `view/`, `shared/` | A huge plugin class split into managers, each owning one kind of registration; a startup timer |
| Omnisearch | `search/` (engine, tokenizer), `repositories/`, `database.ts`, `notes-indexer.ts`, `tools/event-bus.ts` | The search index **persisted in IndexedDB**, so startup doesn't re-index the vault; an event bus between parts |
| QuickAdd (1,446 files) | `engine/`, `services/`, `gui/`, `formatters/`, `api/`, `cli/`, **`migrations/`** | One file per settings migration, each with a test beside it; tests colocated as `*.test.ts`; end-to-end tests in the real app |
| Kanban | `components/` (Preact), `parsers/`, `dnd/`, `lang/`, a `StateManager` per board | A state object per open file, separate from its view |
| Obsidian Git | Mostly flat, `gitManager/` behind one interface | Two back ends (CLI git, isomorphic-git) behind one abstraction |
| Templater | `core/`, `editor/`, `settings/`, `handlers/`, `utils/` | Real-app tests with WebdriverIO (`wdio.conf`) |

Warning signs seen too: a `utils/` folder that grows into hundreds of files
(QuickAdd's has 191), and a plugin class that does everything (which is
what Excalidraw's managers were made to undo).

## The architecture that works

1. **A thin entry point.** `main.ts` creates the services and features and
   registers them; it holds no feature logic. Startup work goes to
   `onLayoutReady`.
2. **Features as `Component`s.** Obsidian's `Component` (which `Plugin`
   extends) has `load`, `unload`, `register*` and `addChild`. Each feature
   extends it and is added with `this.addChild(feature)`: unloading the
   plugin unloads every feature, and a feature can be switched off by
   `removeChild`. No hand-written cleanup lists.
3. **Domain code that doesn't import `obsidian`.** Parsing, models, queries,
   sorting, formatting: plain modules that take data and return data. They
   run in unit tests without a mock, and can move into a web worker.
4. **One adapter layer over Obsidian.** Everything that touches `App`,
   `Vault`, `MetadataCache`, `Workspace` or the DOM of Obsidian's views sits
   in one folder (Tasks' `Obsidian/`, Excalidraw's host adapters). When
   Obsidian changes, that folder is where to look.
5. **One index, built once and kept current.** Screens and commands ask the
   index; it reads the metadata cache at layout-ready and updates from
   vault and cache events. For a large vault, persist it (IndexedDB, as
   Omnisearch does) or build it in a worker (Dataview), so startup doesn't
   pay for it.
6. **Settings with a schema, defaults and versioned migrations.** A
   `version` in `data.json`; one migration file per change, run in order on
   load, each with a test of old data in, new data out (QuickAdd).
7. **Events between features, not imports.** Features signal each other
   through `workspace.trigger('plugin-id:event', …)` or a small event bus,
   so one can be removed without touching the others.
8. **A public API object** (`plugin.api`) when other plugins or scripts
   should use it, kept stable and versioned apart from the internals.
9. **Views hold no state of their own.** A view draws from a state object
   or the index and is rebuilt when it reopens (Kanban's `StateManager`);
   that matters because views are created and destroyed freely, and may be
   deferred.

## A layout to start from

```
src/
  main.ts               wiring: services, features, settings tab
  domain/               pure logic: models, parsers, queries (no obsidian import)
  obsidian/             adapters: vault, metadata cache, workspace, editor helpers
  index/                the vault index, its persistence, its event wiring
  features/
    <feature>/          one folder per feature
      feature.ts        a Component: register, load, unload
      commands.ts
      view.ts           an ItemView, if any
      settings.ts       its part of the settings definitions
      styles.css
  ui/                   shared pieces: list rows, pickers, modals
  settings/             schema, defaults, migrations/NNN-name.ts
  api/                  the public API, if any
  workers/              web-worker entry points
tests/
  __mocks__/obsidian.ts a stand-in for what the domain-adjacent code uses
  unit/  e2e/
```

Rules that keep it in shape, all checkable in CI:
- Folders import downwards only: `features` may import `ui`, `index`,
  `obsidian`, `domain`; `domain` imports nothing of the plugin's. A
  dependency checker (madge, dependency-cruiser, or a few lines in the build)
  refuses cycles and upward imports.
- A size limit per module (a few hundred lines) forces splits before a file
  becomes a second `main.ts`.
- No `utils/` without a name: a helper lives with the feature that uses it,
  or in a folder named for what it does.
- Styles split per feature and joined in a fixed order by the build.

## Build and tooling

- **esbuild**, `format: 'cjs'`, `target: 'es2021'`, `bundle: true`,
  `treeShaking: true`, minified for release, inline source maps in
  development.
- **External** (provided by Obsidian, never bundled): `obsidian`,
  `electron`, `@codemirror/autocomplete`, `collab`, `commands`, `language`,
  `lint`, `search`, `state`, `view`, `@lezer/common`, `highlight`, `lr`, and
  Node's built-in modules. Bundling a second copy of `@codemirror/state`
  breaks editor extensions at runtime.
- **eslint-plugin-obsidianmd** catches API misuse (and the review rules) at
  edit time.
- A UI framework (Preact, Svelte, React) pays for itself in large stateful
  views (boards, editors); mount it in `onOpen` and unmount in `onClose`, or
  it leaks. For lists and forms, `createEl` is smaller and faster.

## Tests

- **Unit:** the domain code, with no mock; the adapters, with a mock
  `obsidian` module that implements only what they call. Vitest or Jest.
- **End to end:** the real app with WebdriverIO and `wdio-obsidian-service`
  (Templater, QuickAdd), for anything that depends on Obsidian's DOM, the
  editor or styles. Run on the oldest supported version and the latest.
- **Performance:** a generated vault of a few thousand notes in the e2e
  suite, with startup and a typical command timed against a budget.

## For a plugin that already exists

Moving towards this is incremental: first a thin `main.ts`; then the
adapter folder (move every `obsidian` import of non-UI code behind it); then
the index; then features as `Component`s one at a time. Each step ships on
its own.

Design Redux already has most of it: layered folders checked by its build,
a 400-line limit, feature classes with an undo list, an index read by
screens, a test stand-in and real-app tests. What it lacks against this
list: features as `Component`s (its `Feature` keeps its own undo list),
domain code free of `obsidian` imports in a folder of its own, one
migration file per settings change, and a persisted or worker-built index
for very large vaults.
