// The skill's claims about Obsidian, checked in the real app (browser and expect are
// WebdriverIO's globals). probe-a and probe-b record the startup into window.__probe;
// each `it` is one claim from references/internals.md. Measurements go to ci-output/probes.json.
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const report = {};
const log = () => browser.executeObsidian(() => window.__probe?.log ?? []);
const find = (entries, key) => entries.find((e) => e[1] === key);
const indexed = () => browser.executeObsidian(({ app }) => app.metadataCache.inProgressTaskCount === 0);
const run = (bin, args) => new Promise((done) => execFile(bin, args, { timeout: 20000, maxBuffer: 1 << 22 },
  (err, out, errOut) => done({ code: err ? err.code ?? 1 : 0, out: String(out).trim(), err: String(errOut).trim() })));

describe('Obsidian at startup', function () {
  let entries;
  before(async function () {
    await browser.executeObsidian(({ app }) => new Promise((r) => app.workspace.onLayoutReady(r)));
    await browser.waitUntil(indexed, { timeout: 30000 });
    entries = await log();
    report.firstStart = entries;
  });

  it("runs a plugin's onload before the vault is listed or the layout is ready", function () {
    const start = find(entries, 'a:onload-start')[2];
    expect(start.files).toBe(0);
    expect(start.layoutReady).toBe(false);
  });

  it('loads plugins one at a time, awaiting each onload', function () {
    expect(find(entries, 'b:onload-start')[2].aEnded).toBe(true);
  });

  it("adds a plugin's styles.css after its onload", function () {
    expect(find(entries, 'a:onload-start')[2].styles).toBe('');
    expect(find(entries, 'a:onload-end')[2].styles).toBe('');
    expect(find(entries, 'a:onLayoutReady')[2].styles).toBe('yes');
  });

  it('fires create for every file and folder while the vault loads, before layout-ready', function () {
    const ready = find(entries, 'a:onLayoutReady')[2];
    expect(ready.files).toBe(40);
    expect(ready.creates).toBe(41); // 40 notes and their folder
  });

  it('on a first start, is still indexing at layout-ready; resolved fires per batch until nothing is pending', function () {
    const ready = find(entries, 'a:onLayoutReady')[2];
    const resolved = entries.filter((e) => e[1] === 'a:resolved');
    expect(ready.pending).toBeGreaterThan(0);
    expect(resolved.length).toBeGreaterThan(1);
    expect(resolved.at(-1)[2].pending).toBe(0);
    expect(resolved.at(-1)[2].cached).toBe(40);
  });

  it('fires the internal layout-ready event, and finished once queued and again once the queue is empty', function () {
    expect(find(entries, 'a:layout-ready-event')).toBeDefined();
    expect(entries.filter((e) => e[1] === 'a:finished').length).toBe(2);
  });

  it('orders head styles app, plugins, theme, snippets: a snippet beats a plugin at equal specificity', async function () {
    const got = await browser.executeObsidian(({ app }) => {
      const els = [...document.head.querySelectorAll('style, link[rel=stylesheet]')];
      const at = (pred) => els.findIndex(pred);
      return {
        win: getComputedStyle(document.body).getPropertyValue('--probe-win').trim(),
        plugin: at((e) => e.textContent?.includes('--probe-a')),
        theme: els.indexOf(app.customCss.styleEl),
        snippet: at((e) => e.textContent?.includes('--probe-snippet')),
      };
    });
    expect(got.win).toBe('snippet');
    expect(got.plugin).toBeLessThan(got.theme);
    expect(got.theme).toBeLessThan(got.snippet);
  });

  it('saves an edited note about 2 s after the change', async function () {
    const ms = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath('notes/Note 1.md');
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file);
      const saved = new Promise((r) => {
        const ref = app.vault.on('modify', (f) => { if (f === file) { app.vault.offref(ref); r(performance.now()); } });
      });
      const t = performance.now();
      leaf.view.editor.replaceRange('x', { line: 4, ch: 0 });
      return (await saved) - t;
    });
    report.saveMs = Math.round(ms);
    expect(ms).toBeGreaterThan(1500);
    expect(ms).toBeLessThan(3500);
  });

  it('resolves trashFile to a boolean (1.15.1)', async function () {
    const got = await browser.executeObsidian(async ({ app }) =>
      typeof (await app.fileManager.trashFile(await app.vault.create('to-trash.md', 'bye'))));
    expect(got).toBe('boolean');
  });

  it('keeps the metadata cache in IndexedDB <appId>-cache, and has app.debugMode', async function () {
    const got = await browser.executeObsidian(async ({ app }) => ({
      dbs: (await indexedDB.databases()).map((d) => d.name), id: app.appId, debug: typeof app.debugMode,
    }));
    expect(got.dbs).toContain(`${got.id}-cache`);
    expect(got.debug).toBe('function');
  });
});

describe('Obsidian on a warm restart', function () {
  it('has every note indexed by layout-ready, and resolves once', async function () {
    await browser.reloadObsidian();
    await browser.executeObsidian(({ app }) => new Promise((r) => app.workspace.onLayoutReady(r)));
    await browser.waitUntil(async () => (await indexed()) && !!find(await log(), 'a:resolved'), { timeout: 30000 });
    await browser.pause(300);
    const entries = await log();
    report.warmStart = entries;
    const ready = find(entries, 'a:onLayoutReady')[2];
    expect(ready.pending).toBe(0);
    expect(ready.cached).toBe(40);
    expect(entries.filter((e) => e[1] === 'a:resolved').length).toBe(1);
  });
});

describe("Obsidian's command line", function () {
  let cli;
  before(async function () {
    const info = await browser.executeObsidian(() => ({
      on: window.electron.ipcRenderer.sendSync('cli', true), // Settings → General → Command line interface
      exe: window.electron.remote.process.execPath,
    }));
    cli = (...args) => run(info.exe.replace(/obsidian(\.exe)?$/i, (m, ext) => `obsidian-cli${ext || ''}`), args);
    await browser.pause(500);
  });

  it('answers once turned on', async function () {
    expect((await cli('version')).out).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('runs JavaScript in the app: an expression prints its value', async function () {
    expect((await cli('eval', 'code=app.vault.getFiles().length')).out).toBe('=> 40');
    report.evalStatements = await cli('eval', 'code=const n = await Promise.resolve(2); return n * 21');
  });

  it('reloads a plugin, and reports errors, the DOM and a screenshot', async function () {
    expect((await cli('plugin:reload', 'id=probe-b')).out).toMatch(/Reloaded/);
    expect((await cli('dev:errors')).code).toBe(0);
    expect((await cli('dev:dom', 'selector=.workspace')).out).toMatch(/class="workspace/);
    fs.mkdirSync('ci-output', { recursive: true });
    const shot = `${process.cwd()}/ci-output/probe-screenshot.png`;
    await cli('dev:screenshot', `path=${shot}`);
    expect(fs.existsSync(shot)).toBe(true);
  });

  it('needs dev:debug on before dev:console captures', async function () {
    expect((await cli('dev:console')).out).toMatch(/dev:debug on/);
  });

  it('gives the startup breakdown as JSON', async function () {
    const out = (await cli('dev:startup', 'format=json')).out;
    report.startup = JSON.parse(out);
    expect(report.startup.durations['vault.load']).toBeGreaterThan(0);
  });
});

after(function () {
  fs.mkdirSync('ci-output', { recursive: true });
  fs.writeFileSync('ci-output/probes.json', JSON.stringify(report, null, 1));
});
