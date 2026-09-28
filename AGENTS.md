# Design Redux

An Obsidian plugin that makes the vault feel like Apple Music: folders open as
albums, notes as tracks, with covers, a library sidebar, a context strip along
the bottom, property tools, and canvas extras. Goes with the author's theme,
Coffee N' Christmas.

## Files

- `main.js` — the source. Plain JavaScript (CommonJS), not built: what's here is
  what Obsidian runs. `obsidian`, `@codemirror/view` and `@codemirror/state` are
  provided by Obsidian at runtime.
- `styles.css` — all styles.
- `manifest.json`, `versions.json` — **never edit versions by hand.** The release
  workflow bumps the patch version itself.
- `README.md` — don't update unless asked.
- `tests/test_*.js` — simulation suites (jsdom + real CodeMirror, Obsidian stood
  in for). `npm test`, or `node tests/run.js qol album` for just some.
- `tests/obsidian/` — tests inside the real Obsidian (`wdio.conf.mjs`,
  wdio-obsidian-service), run by GitHub Actions on the oldest supported version
  and the latest. They can't run in a sandbox without Obsidian's downloads.

## How the code is laid out

- Each feature is a `class X extends Feature` with `settingsSchema()`,
  `commands()`, `register()` (events, once), `enable()` / `disable()` / `sync()`,
  and `X.settingKey` naming the toggle that switches it on. `enable()` runs on
  every settings save, so it must be safe to call repeatedly.
- `DEFAULTS` holds every setting. Settings rows are placed in the settings tab by
  `SETTINGS_TABS`; a new row's key must be added there.
- Settings keyed by a file's path go in `PATH_KEYED`, so they follow renames and
  deletes (see `Orders.followRename`).
- Obsidian's unofficial internals (submenus, canvas internals, menu item lists,
  `metadataTypeManager`, `internalPlugins`) are only touched behind `typeof`
  checks, with a fallback.

## Rules that have bitten before

- No regex lookbehind (`(?<=`, `(?<!`): it breaks Obsidian on iOS before 16.4.
- Hover styles only inside `@media (any-hover: hover)`.
- Don't give a `Modal` subclass a field called `scope`: Obsidian uses it for the
  dialog's keys.

## Working here

- Keep testing light: run only the suites a change touches. The author has
  asked for less testing to save usage.
- Before pushing, fetch and rebase: the release workflow commits version bumps
  to the default branch.
- CI results (summary, test output, screenshots from real Obsidian, and a
  compatibility report of the internals the plugin uses) are published to the
  `ci-results` branch: `git fetch origin ci-results` and read them from there.
- Replies to the author: short, plain, no version-number bookkeeping.
