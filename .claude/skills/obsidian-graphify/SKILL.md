---
name: obsidian-graphify
description: Build a graphify knowledge graph of every component of Obsidian, extracted from a real running Obsidian in CI (no model needed), and join it to a plugin's own code graph. Use to map, query or explain Obsidian's internals, or which parts of Obsidian a plugin touches.
---

# Obsidian's components as a graphify graph

This skill starts a real Obsidian in CI or headlessly, and extracts what makes it up:
- from the running app;
- from the app's own code;
- from the public typings.

It writes the result in [graphify](https://pypi.org/project/graphifyy/)'s own graph
format. With that graph, an AI can answer questions with `graphify query`, `explain` and
`path` instead of guessing:
- "what is `app.workspace` made of";
- "which events does the metadata cache emit";
- "where is `--tab-*` used";
- "what in Obsidian does `lists.js` depend on".

It needs no model at any step: extraction is code, and graphify's clustering and community
names run with `GRAPHIFY_BACKEND=none`.

## What it captures (Obsidian 1.15.1: 4,214 nodes, 4,583 links)

| Source | Node kinds | Relations |
| --- | --- | --- |
| **The live app** (`scripts/extract-live.js`, run inside Obsidian) | every export of `obsidian` (101 classes with 1,238 methods, 51 functions, 7 objects); the `app` object and what it holds (86 runtime objects: `app.workspace`, `app.vault.adapter`, `app.internalPlugins`, …); 30 core plugins and the community plugins; 23 view types and 25 file extensions; 204 commands by owner; 40 events with live listeners, per emitter; 106 CLI handlers; 48 DOM regions; body classes; 49 globals | `exports`, `method`, `inherits`, `has`, `instance_of`, `extends_internally`, `contains`, `registers_view`, `opens_in`, `provides_command`, `emits`, `provides_cli`, `contains_dom`, `has_class`, `defines_global` |
| **The app's code** (`scripts/build-graph.mjs`, from the `.asar` the CI downloads) | 69 triggered event names; 54 settings with defaults; startup stages; URI actions; modules a plugin can `require`; 54 IPC channels; config files; storage; libraries; 1,227 CSS variables in 131 families | `triggers`, `is_event`, `has_setting`, `contains`, `handles_uri`, `provides_to_plugins`, `handles_ipc`, `uses_file`, `stores_in`, `bundles`, `defines` |
| **The typings** (graphify's own code graph of `obsidian.d.ts`) | every declared class, interface and member | graphify's `contains`, `method`, `inherits`, `implements` |

How the three join:
- **Shared ids.** The live extractor uses graphify's own code ids for public classes and
  methods (`obsidian_d_workspace`, `obsidian_d_workspace_getleaf`), so the live and typed
  versions are the same node.
- **Typed or not.** Every live class and method carries `metadata.typed`. On 1.15.1, **831
  live methods on public classes are not in the typings**: internal API, worth knowing
  before using one.
- **Other ids:**
  - runtime objects: `obsidian_rt_<path>`;
  - `obsidian_core_plugin_<id>`, `obsidian_view_<type>`, `obsidian_command_<id>`;
  - `obsidian_event_<emitter>_<name>` (a live listener) and `obsidian_event_name_<name>`;
  - `obsidian_setting_<key>`, `obsidian_css_<--var>`, `obsidian_dom_<class>`,
    `obsidian_cli_<name>`.
- **Node metadata.** `metadata.kind` holds the node's kind. A runtime object also records
  its public class, its internal methods and its fields.

## Run it

Locally, or in any CI, with Node 20+ and Python 3.11+:

```sh
npm i --no-save @wdio/cli@9 @wdio/local-runner@9 @wdio/mocha-framework@9 \
  wdio-obsidian-service wdio-obsidian-reporter obsidian
pip install graphifyy
npx wdio run <skill>/ci/wdio.conf.mjs        # Linux without a display: xvfb-run -a npx wdio run …
GRAPHIFY_BACKEND=none node <skill>/scripts/build-graph.mjs --dts node_modules/obsidian
```

`wdio-obsidian-service` downloads Obsidian into `.obsidian-cache/`. That folder also holds
the `.asar` the builder reads. The outputs, in `obsidian-graph/`:
- `live.json`: the live extraction;
- `graph.json`: the full graph, which validates with 0 errors;
- `graphify-out/`: `GRAPH_REPORT.md`, `graph.html` and the clustered `graph.json`, with
  communities named after their hubs (`app.workspace`, `Workspace`, `--tab-*`,
  `editor: (commands)`, …).

Choose versions with environment variables:
- `OBSIDIAN_APP`: `latest` (default), `latest-beta` or `1.x.y`. `latest-beta` needs
  `OBSIDIAN_EMAIL` and `OBSIDIAN_PASSWORD` of an Insiders account with 2FA off.
- `OBSIDIAN_INSTALLER`: `latest`, `earliest` or `1.x.y`.
- `OBSIDIAN_GRAPH_DEPTH`: how deep the runtime object walk goes (default 2).

The steps:
- `ci/wdio.conf.mjs` makes a fresh vault: notes with properties, tasks and links, a
  canvas and a base, so their views and parsers exist.
- `ci/extract.e2e.mjs` waits for layout-ready and an empty indexing queue, opens a note and
  the main core views, runs the extractor inside the app, and writes `live.json`.

In CI: `ci/obsidian-graph.yml` is a GitHub Actions workflow.
- It runs every Monday and on demand, caches Obsidian's downloads and uploads
  `obsidian-graph/` as an artifact.
- In a plugin's repository, it also links the plugin (below).
- With `publish: true`, it commits the graph to an `obsidian-graph` branch.
- Copy it to `.github/workflows/` and set `SKILL` to where this skill lives.

Without a CI, `build-graph.mjs` alone still makes the app-code and typings parts from an
installed Obsidian's `.asar`, found automatically on macOS and Linux or given with
`--asar`. `extract-live.js` also runs pasted into DevTools:
`(function (app, obsidian, options) { …file… })(app, require('obsidian'), {})`.

## Join a plugin

```sh
GRAPHIFY_BACKEND=none graphify update <plugin> --no-cluster    # the plugin's own code graph, no model
node <skill>/scripts/link-plugin.mjs --plugin <plugin> --obsidian obsidian-graph/graph.json
```

graphify gives everything a plugin imports from `obsidian` one node, `ref_obsidian`.
`link-plugin.mjs` instead reads each source file and links it to the components it uses:

| In the plugin's code | Relation | To |
| --- | --- | --- |
| `import { … } from 'obsidian'` | `uses_api` | the public class or function |
| `app.x`, `app.x.y` | `uses` | the runtime object |
| `.on('e')`, `.trigger('e')` | `listens_to` | the event |
| `executeCommandById('id')` | `runs_command` | the command |
| a view type it opens or finds | `uses_view` | the view type |
| `getConfig('key')` | `reads_setting` | the setting |
| `getPluginById('id')` | `uses_core_plugin` | the core plugin |
| `var(--x)` in its CSS | `uses_css_var` | Obsidian's CSS variable |
| an Obsidian class in its selectors | `styles_region` | the DOM region |

On Design Redux, it linked 178 uses from 51 of its 85 files, mostly `app.workspace` (26),
`app.vault` (24), `Notice`, `TFile` and `TFolder`.

## Ask the graph

```sh
cd obsidian-graph          # or obsidian-graph/with-plugin
graphify explain "app.workspace"              # its class, children, events, and (joined) the plugin files using it
graphify path "app.vault" "alwaysUpdateLinks"  # how two components connect
graphify query "which events does the metadata cache emit?"
graphify-mcp graphify-out/graph.json          # serve it to an assistant over MCP (needs graphifyy[mcp])
```

In an assistant with the graphify skill, `/graphify` reads the same `graphify-out/`.

How to read the answers:
- **Nodes in `graphify explain`.** A node's `Source` is `obsidian-runtime` (live),
  `app.js` / `main.js` / `app.css` (the app's code) or `obsidian.d.ts` (typings).
- **Internal API.** `metadata.typed: false` marks a live class or method that isn't
  public.
- **Paths.** A path through the root node `Obsidian 1.x.y` only says both ends belong to
  Obsidian. Read the specific hops.

## Limits, and why

- **The live part holds what this vault and session created.** A view type no core plugin
  registered, a command a disabled plugin would add, or an event no one listens to yet
  isn't live. The app's code fills in events, settings and the CLI.
- **Internal classes are named by path** (`app.commands`, built on `Events`), because their
  own names are minified (`Mw`, `ci`). Methods and fields keep their real names.
- **The runtime walk stops at depth 2.** It goes deeper for the workspace, vault, metadata
  cache, plugins and CSS. Maps over 150 entries (files, caches) are counted, not listed.
- **The plugin linking reads source text.** It finds direct uses, so a call through a
  helper or a computed name is not linked.
- **graphify's `graph.html` loads vis-network from unpkg**, so it needs the network to
  render. Above about 5,000 nodes, pass `--no-viz` to `cluster-only`.

## Pitfalls already solved here, in case you change the scripts

- **WebDriver's result serialisation loses values in a large object.** The extractor
  returns a JSON string, parsed in Node.
- **Every `Events` object keeps its listeners in `_`.** The path `app.commands._`
  normalises to the same id as `app.commands`. The walk skips `_` (listeners are read
  separately), and ids are made unique per path.
- **`app.cli.handlers` is a `Map`.**
- **Running Obsidian's own executable as root needs `--no-sandbox`**, and a container's
  small `/dev/shm` needs `--disable-dev-shm-usage`. `ci/wdio.conf.mjs` sets the second.
- **The settings defaults are read by evaluating the object literal around
  `alwaysUpdateLinks:` in `app.js`.** If a future version breaks that, the builder skips
  the defaults and says so; it doesn't stop.

## Files

- `scripts/extract-live.js`: the live extractor (runs inside Obsidian).
- `scripts/build-graph.mjs`: live + app code + typings into `graph.json`, then clusters it.
- `scripts/link-plugin.mjs`: joins a plugin's code graph to Obsidian's.
- `ci/wdio.conf.mjs`, `ci/extract.e2e.mjs`: the real Obsidian, and the run.
- `ci/obsidian-graph.yml`: the GitHub Actions workflow.

The full skill folder is in the Design Redux repository at
`.claude/skills/obsidian-graphify/` (github.com/goofect/design-redux). The `obsidian-api`
skill explains what the components do; this one maps them.
