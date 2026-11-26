# JavaScript in Obsidian

This covers which JavaScript a plugin can count on, how to build it, and how
to type, lint and test a plugin written in plain JavaScript. It was gathered
on 2026-11-23 from Obsidian's changelog, Electron's release notes, the
`obsidian` package 1.14.4 and the tools' release pages.

## The runtime is the installer's, not the app's

Obsidian updates its app code in place, but the Electron shell (Chromium,
V8, Node) changes only when the person downloads a new installer. One Mac
reported app 1.14.5 while still running the 1.10.3 installer, which is
Chromium 138. Macs on Big Sur can't run Electron 38 or later, so they stay
there.

| Installer | Electron | Chromium | Node | V8 |
| --- | --- | --- | --- | --- |
| 1.10.3 (Nov 2025; the last for macOS 11) | 37.9.0 | 138 | 22.x | 13.8 |
| 1.11 (Jan 2026) | 39.2.6 | 142 | 22.20 | 14.2 |
| 1.12.7 (Mar 2026) | 39.8.3 | 142 | 22.x | 14.2 |
| 1.13 / 1.13.6 (Jul–Aug 2026) | 43.1.1 / 43.3.0 | 150 | 24.x | 15.0 |
| 1.14.5 (22 Oct 2026) | 43.8.3 | 150.0.7871.250 | 24.22.0 | 15.0 |
| **1.15.1 (12 Nov 2026)** | **43.8.9** | **150** | **24.22** | **15.0** |

- **Rule:** support Chromium 138 unless you control every machine (your own
  vaults), in which case Chromium 150.
- `requireApiVersion()` checks the app version, not the installer. For a
  JavaScript or Web feature, check for the feature itself:
  `typeof Temporal`, `'yield' in (globalThis.scheduler ?? {})`.
- To check a machine, run this in the developer console:
  `process.versions` (gives `chrome`, `electron`, `node`, `v8`).

## What is available

The Chromium version is the one each feature first shipped in. Most come from
MDN and chromestatus. Temporal (144), `Math.sumPrecise` (147),
`corner-shape` (139), Uint8Array base64 (140) and `RegExp.escape` (136) were
checked against release notes. Check anything critical with the console line
above.

### Language

| Feature | Chromium | On 150 | On 138 |
| --- | --- | --- | --- |
| Class fields, private methods, static blocks | 72–94 | yes | yes |
| `at()`, `Object.hasOwn`, `Error` `cause`, `findLast` | 92–97 | yes | yes |
| `structuredClone`, `Intl.Segmenter`, `WeakRef` | 84–98 | yes | yes |
| `toSorted` / `toSpliced` / `with` | 110 | yes | yes |
| RegExp `v` flag | 112 | yes | yes |
| `Object.groupBy` / `Map.groupBy` | 117 | yes | yes |
| `Promise.withResolvers` | 119 | yes | yes |
| `Array.fromAsync` | 121 | yes | yes |
| Set methods (`union`, `intersection`, `difference`, …), iterator helpers | 122 | yes | yes |
| `Promise.try` | 128 | yes | yes |
| `using` / `await using` | 134 | yes | yes |
| `Float16Array` | 135 | yes | yes |
| `RegExp.escape` | 136 | yes | yes |
| `Uint8Array.fromBase64` / `toBase64` / `toHex` | 140 | yes | **no** |
| `Temporal` | 144 | yes | **no** |
| `Math.sumPrecise` | 147 | yes | **no** |
| Top-level `await` | — | **no**: a `cjs` bundle can't hold it | — |

`target` lowers syntax but never adds APIs: Temporal on a 138 installer
needs a check and a fallback, whatever the target.

### Web APIs

| API | Chromium | On 138 | Note |
| --- | --- | --- | --- |
| `requestIdleCallback` | 47 | yes | Per window: `el.win.requestIdleCallback` |
| `scheduler.postTask` / `scheduler.yield` | 94 / 129 | yes | `yield` is the best tool for chunked indexing |
| `AbortSignal.timeout` / `.any` | 103 / 116 | yes | `requestUrl` takes no signal: use `fetch` where CORS allows |
| `ResizeObserver`, `IntersectionObserver` | 64 / 51 | yes | Create from the element's window (`new el.win.ResizeObserver`) |
| Web Workers from a Blob URL | old | yes | Recipe 17 |
| `SharedArrayBuffer` | 92 + isolation | **unknown** | Needs cross-origin isolation, which wasn't verified for `app://`: check `crossOriginIsolated` and assume it is off |
| IndexedDB, Cache API | old | yes | Per origin, so **shared by every vault**: put `app.appId` in the name |
| `OffscreenCanvas`, `CompressionStream` | 69 / 80 | yes | |
| Popover API, View Transitions | 114 / 111 | yes | |

### CSS

All of these are on 138 except `corner-shape`:
- `content-visibility` (85)
- `@layer` (99)
- `:has()` and container queries (105)
- `color-mix()` / `oklch()` (111)
- nesting (112; relaxed syntax in 120)
- `subgrid` and `@starting-style` (117)
- `@scope` (118)
- anchor positioning (125)

`corner-shape` arrived in 139, so it is not on the 138 installer. Obsidian's
own themes use it from 1.12.

## Node and Electron (desktop only)

- `require('fs')`, `require('path')`, `require('child_process')` and
  `require('electron')` work in a desktop plugin, and Node 24's APIs are
  there on the current installer. Keep them external in the bundle, and
  guard them with `Platform.isDesktopApp`.
- `app.vault.adapter` is a `FileSystemAdapter` on desktop: `getBasePath()`
  and `getFullPath(path)` give the real paths for Node's `fs`.
  - Reading through `fs` skips the vault's cache and events: writes there
    are seen by Obsidian only through its file watcher.
  - Use the Vault API for notes, and `fs` only for bulk, read-only work
    outside them, such as hashing attachments.
- `electron.remote` is gone in modern Electron. Avoid internal IPC: it is
  undocumented and changes with the installer.

## Build (esbuild, 2026)

```js
// build.mjs
import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
const prod = process.argv[2] === 'production';
const ctx = await esbuild.context({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'cjs',                 // Obsidian require()s main.js
  platform: 'browser',
  target: ['chrome138'],         // the oldest installer you support; chrome150 for your own machines
  external: [
    'obsidian', 'electron',
    '@codemirror/autocomplete', '@codemirror/collab', '@codemirror/commands',
    '@codemirror/language', '@codemirror/lint', '@codemirror/search',
    '@codemirror/state', '@codemirror/view',
    '@lezer/common', '@lezer/highlight', '@lezer/lr',
    ...builtinModules, ...builtinModules.map((m) => `node:${m}`),
  ],
  treeShaking: true,
  minify: prod,
  legalComments: 'none',
  sourcemap: prod ? false : 'inline',
  outfile: 'main.js',
});
if (prod) { await ctx.rebuild(); await ctx.dispose(); } else await ctx.watch();
```

Why:
- **Target.** The sample plugin still says `es2021`. That makes esbuild
  rewrite class fields, static blocks and `using` into helper code that
  every supported installer runs natively. `chrome138` emits them as
  written: a smaller and more direct bundle.
- **Since 1.15, `Plugin` and `PluginSettingTab` are native classes**
  (reported by plugin authors, not in the changelog). An ES5 target fails
  with "Class constructor Plugin cannot be invoked without 'new'"; any
  ES2015+ target is fine.
- **`import.meta`** is empty in `cjs` output, so don't rely on it. Find the
  plugin's folder with `this.manifest.dir`.
- **CodeMirror and Lezer stay external.** A second copy of
  `@codemirror/state` breaks facets ("Unrecognized extension value"). The
  typings 1.14.4 pin `@codemirror/state` 6.7.6 and `@codemirror/view`
  6.43.13: install those as dev dependencies, so the types match what runs.
- **Minify.** esbuild's minifier is fast. Terser's output is smaller, which
  matters only for very large bundles (Excalidraw's load went from 11 s to
  6 s). Measure before switching.

## Plain JavaScript, typed

You can check plain JavaScript against `obsidian.d.ts` with no TypeScript
source:

```jsonc
// jsconfig.json
{ "compilerOptions": { "checkJs": true, "strict": true, "target": "ES2023",
    "module": "ESNext", "moduleResolution": "Bundler", "noEmit": true },
  "include": ["src/**/*.js", "src/types/*.d.ts"] }
```

- Run `npx tsc -p jsconfig.json` in CI. It reports wrong arguments, misspelt
  APIs, and nulls not handled (`getFileCache` returns `CachedMetadata |
  null`).
- Type with JSDoc: `/** @type {import('obsidian').TFile} */`,
  `/** @param {import('obsidian').App} app */`, and `@typedef` for settings.
- Internals and runtime-only APIs (anything 1.15 adds before the typings
  do) go in one `src/types/obsidian-augment.d.ts`:
  ```ts
  import 'obsidian';
  declare module 'obsidian' {
    interface App { commands?: { executeCommandById(id: string): boolean } }
    function loadPixi(): Promise<unknown>;            // 1.15.0, untyped in 1.14.4
  }
  ```
  Still guard each one at runtime with `typeof`.
- `eslint-plugin-obsidianmd` (0.5 and later) runs its typed rules on
  JavaScript once a `jsconfig.json` exists and the config enables them for
  `**/*.js`. The rules that concern function and speed:
  - `no-unsupported-api`: an API newer than `minAppVersion`; it understands
    `requireApiVersion` guards;
  - `no-plugin-as-component`, `no-view-references-in-plugin`: leaks;
  - `prefer-window-timers`, `prefer-active-doc`, `no-global-this`: popouts;
  - `prefer-file-manager-trash-file`, `no-tfile-tfolder-cast`,
    `prefer-instanceof`, `regex-lookbehind`;
  - `settings-tab/prefer-update-over-display`.

## Testing

- **wdio-obsidian-service 3.5.0** (1 Nov 2026) supports WebdriverIO 10. Its
  releases:
  - 3.4.0 resolves `latest` per platform;
  - 3.3.0 added `getMainWindowHandle` and runs `executeObsidian` with the
    Settings window as the context.

  `installerVersion: 'earliest'` and `'latest'` let a CI matrix cover the
  Chromium 138 floor and Chromium 150.
- **Since 1.15.1, a newly installed plugin ignores a `data.json` already in
  the vault**: it is kept as `data.json.bak`. A fixture that seeds settings
  before install must seed after, or through `executeObsidian`.
- **A jsdom stand-in for 1.13+ settings** needs `PluginSettingTab.update`,
  `refreshDomState`, `getControlValue`, `setControlValue` and `SettingPage`.
  Test a declarative tab by asserting on the array of definitions, not on
  the DOM.
- `node:test` or Vitest both work for domain code that doesn't import
  `obsidian`.

## Sources

- [Obsidian changelog](https://obsidian.md/changelog/): [1.14.5](https://obsidian.md/changelog/2026-10-22-desktop-v1.14.5/), [1.15.0](https://obsidian.md/changelog/2026-11-02-desktop-v1.15.0/), [1.15.1](https://obsidian.md/changelog/2026-11-12-desktop-v1.15.1/), [1.12.7](https://obsidian.md/changelog/2026-03-23-desktop-v1.12.7/), [1.13.6](https://obsidian.md/changelog/2026-08-10-desktop-v1.13.6/)
- [Electron 43.0](https://www.electronjs.org/blog/electron-43-0), [v43.8.3](https://releases.electronjs.org/release/v43.8.3)
- [The installer is not updated in-app](https://note.com/pc_article/n/n9953ab5bedfc?hl=en); [1.14.5 no longer runs on macOS 11](https://forum.obsidian.md/t/obsidian-1-14-5-no-longer-runs-on-macos-11/119797)
- [Sample plugin esbuild config](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/esbuild.config.mjs)
- [eslint-plugin-obsidianmd 0.5.0](https://github.com/obsidianmd/eslint-plugin/releases/tag/0.5.0) and its [JavaScript docs](https://github.com/obsidianmd/eslint-plugin/pull/215)
- [wdio-obsidian-service 3.5.0](https://github.com/jesse-r-s-hines/wdio-obsidian-service/releases/tag/3.5.0), [3.4.0](https://github.com/jesse-r-s-hines/wdio-obsidian-service/releases/tag/3.4.0), [3.3.0](https://github.com/jesse-r-s-hines/wdio-obsidian-service/releases/tag/3.3.0)
- [Native Plugin class in 1.15](https://github.com/cristianvasquez/obsidian-prettify/pull/101) (plugin author's report)
- The `obsidian` package 1.14.4 (npm): typings and `@codemirror` peer pins.
