# Testing a plugin, in CI and in the real app

Everything here was run on 2026-11-26 against Obsidian 1.15.1 in a headless Linux container
(Xvfb), the same setup a GitHub Actions runner gives. The probe kit in `ci/` is the proof:
16 probes, all passing.

## Three levels, and what each can show

| Level | Runs | Shows | Can't show |
| --- | --- | --- | --- |
| **Unit** | Code that never imports `obsidian` (parsing, models, sorting), with `node:test` or Vitest | Logic, fast | Anything Obsidian does |
| **Simulation** | jsdom, with a stand-in `obsidian` module that implements only what the code calls | Screens, commands, settings, migrations, at hundreds of tests a second | How Obsidian's own styles, editor and DOM meet yours; timing; startup order |
| **Real app** | The real Obsidian, driven by WebdriverIO through `wdio-obsidian-service` | Everything: the editor, Obsidian's CSS, the startup order, save timing, popouts | — (slower: seconds per spec) |

Write the many cases at the lower levels. Give the real app one `it` per thing only it can
show: anything that draws in a note's text, the editor, or Obsidian's own regions.

## wdio-obsidian-service

`wdio-obsidian-service` 3.5.0 is for WebdriverIO 10; 3.2–3.4 are for WebdriverIO 9.

```js
// wdio.conf.mjs
export const config = {
  runner: 'local', framework: 'mocha', specs: ['tests/obsidian/*.e2e.mjs'],
  maxInstances: 1,                                    // two Obsidians at once fight over the same profile
  capabilities: [{
    browserName: 'obsidian',
    browserVersion: process.env.OBSIDIAN_APP || 'latest',          // the app: latest, latest-beta, 1.x.y
    'goog:chromeOptions': { args: ['--disable-dev-shm-usage'] },   // containers have a 64 MB /dev/shm
    'wdio:obsidianOptions': {
      installerVersion: process.env.OBSIDIAN_INSTALLER || 'latest', // the Electron shell: latest, earliest, 1.x.y
      plugins: ['.'],                                 // built plugin folders, enabled in this order
      vault: 'tests/vault',                           // copied fresh for the run
    },
  }],
  services: ['obsidian'], reporters: ['obsidian'],
  cacheDir: '.obsidian-cache',                        // the downloads: cache it in CI
  mochaOpts: { ui: 'bdd', timeout: 60000 },
  specFileRetries: 1,                                 // a real app flakes; retry, then fix what needed it
};
```

The helpers you'll use:
- `browser.executeObsidian(({ app, obsidian, plugins }, ...args) => …)` runs code in the
  app and returns its result.
  - Return plain data. For anything large, return `JSON.stringify(...)` and parse it:
    WebDriver's own serialisation drops values in big objects.
- `browser.executeObsidianCommand('id')` runs a command.
- `browser.reloadObsidian({ vault })` restarts the app (a warm start), optionally with
  another vault.
- `obsidianPage.resetVault()` puts the vault back between specs.

**Versions.** The app and the installer are separate. The installer decides the runtime:
Chromium 138 on `earliest`, 150 on `latest`. Test both in CI. `latest-beta` needs an
Insiders account in `OBSIDIAN_EMAIL` / `OBSIDIAN_PASSWORD`, with 2FA off; a second account
just for CI is easiest.

**Linux needs a display.** Use `xvfb-run -a -s "-screen 0 1280x1024x24" npx wdio run
wdio.conf.mjs`, or a background `Xvfb :99` with `DISPLAY=:99`.

## Waiting correctly

Wrong waits are where real-app tests go flaky. These are measured:
- **Layout-ready first:**
  `await browser.executeObsidian(({ app }) => new Promise((r) => app.workspace.onLayoutReady(r)))`.
- **Then indexing, when the test reads the metadata cache.** On a first start, most notes
  are still being parsed at layout-ready (39 of 40 in the probe). Wait with
  `browser.waitUntil(() => browser.executeObsidian(({ app }) =>
  app.metadataCache.inProgressTaskCount === 0))`. A warm restart has everything indexed
  at layout-ready.
- **Edits reach the disk about 2 s later** (measured: 2,009–2,013 ms). Wait for the
  vault's `modify`, or write with `vault.process` (immediate), rather than sleeping.
- **A plugin's `styles.css` is added after its `onload`.** Check computed styles after
  layout-ready, not during `onload`.
- **Since 1.15.1, a freshly installed plugin ignores a `data.json` already in the vault**
  (it becomes `data.json.bak`). Seed settings after install, through `executeObsidian`.

## Obsidian's command line, from a test

The command line is off by default. Turn it on from inside the app (this is the setting
under General), then call `obsidian-cli`, the native client beside the app's executable:

```js
const { exe } = await browser.executeObsidian(() => ({
  on: window.electron.ipcRenderer.sendSync('cli', true),
  exe: window.electron.remote.process.execPath,
}));
const cli = (...args) => execFileSync(exe.replace(/obsidian(\.exe)?$/i, 'obsidian-cli$1'), args, { encoding: 'utf8' });
cli('plugin:reload', 'id=my-plugin');                 // "Reloaded: my-plugin"
cli('eval', 'code=app.vault.getFiles().length');      // "=> 40"
cli('eval', 'code=const n = await f(); return n');    // statements with await end in return
cli('dev:errors');                                    // "No errors captured." or the errors
cli('dev:dom', 'selector=.workspace');                // the matching elements
cli('dev:screenshot', 'path=/abs/shot.png');          // a screenshot of the window
cli('dev:startup', 'format=json');                    // { durations: { 'communityPlugins.my-plugin': 12.3, … } }
```

`dev:console` captures only after `dev:debug on`. As root, the app's own executable needs
`--no-sandbox`; `obsidian-cli` doesn't.

This is also how an AI can check its own work on a plugin, with no person at the screen:
build, `plugin:reload`, `dev:errors`, `dev:screenshot`.

## A startup budget

`dev:startup format=json` reports each plugin's load time as `communityPlugins.<id>`. A
500 ms wait in `onload` reads as 509 ms. A budget test:

```js
it('loads in under 30 ms', async function () {
  const t = JSON.parse(cli('dev:startup', 'format=json')).durations['communityPlugins.my-plugin'];
  expect(t).toBeLessThan(30);
});
```

## GitHub Actions

A worked example is Design Redux's `.github/workflows/ci.yml`:
- **Jobs:**
  - one job runs the simulation suites;
  - a matrix runs one job per real-app spec, in parallel, under `xvfb-run`;
  - a final job releases only if both passed.
- **The cache.** `.obsidian-cache` is cached with a key that changes weekly, so a new
  Obsidian is picked up within a week.
- **Flaky tests.** A spec is retried once. One that passed only on the retry is reported
  as flaky, and wants fixing.
- **Results.** These go to a `ci-results` branch: one short summary file. Read it with
  `git show origin/ci-results:obsidian-tests.txt`, not by scrolling logs.
- **`paths-ignore`** skips runs for changes that can't affect the plugin (`.claude/**`,
  `*.md`).

## The probe kit: checking what this skill claims

`ci/` holds two tiny plugins and a spec. They record a real startup and check this skill's
claims about Obsidian's internals (`references/internals.md`):
- `onload` runs before the vault is listed;
- plugins load one at a time;
- `styles.css` comes after `onload`;
- `create` fires for files and folders;
- indexing is still running at layout-ready on a first start, but not on a warm one;
- the `finished` and `resolved` events;
- the style order;
- the 2 s save;
- `trashFile` returns a boolean;
- the metadata cache's database;
- the command line.

```sh
npx wdio run <skill>/ci/wdio.conf.mjs     # writes ci-output/probes.json: timings, startup breakdown
```

Run it on each new Obsidian (`OBSIDIAN_APP=latest-beta` to see one before release). A
failing probe is a claim in this skill to correct.

For a map of every component, see the `obsidian-graphify` skill.
