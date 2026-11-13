// What every spec in tests/obsidian/ shares: the helpers, and suite(), which
// wraps a spec's tests so each one starts from the same place.
//
// Each spec file runs in an Obsidian of its own (a fresh copy of the vault),
// so specs never see each other. Inside a spec, suite() puts back before
// every test what the spec began with: the settings, the sidebars, one tab
// showing what it showed, the theme, the inspector, no menus, nothing
// picked. A test sets up what it needs itself; it never relies on the one
// before. Files a test makes or moves are its own to put back.
//
// Timings and errors are written as parts, one per spec, and joined into
// ci-output/<version>-timings.txt and <version>-errors.txt by wdio.conf.mjs
// once every spec has run.
import { browser, expect } from '@wdio/globals';
import fs from 'fs';
import path from 'path';

import { OUT, PARTS } from './parts.mjs';

export { OUT };

/** The Obsidian version this run is on, once the spec has started. */
export let version = 'unknown';

// Screenshots are kept few, to keep the runs and the ci-results branch
// small: these, plus any test that fails.
const SHOTS = ['right-sidebar-dark', 'right-sidebar-light', 'page-control-light', 'page-control-dark', 'album', 'album-light', 'home', 'note-and-strip', 'graph-routes', 'footnote-box', 'properties-edit', 'properties-list', 'properties-sheet', 'footnotes-view', 'preview', 'settings-appearance', 'settings-library', 'menu', 'properties-inspector', 'undo-notice', 'album-edit', 'graph-3d', 'note-next'];

export async function shot(name) {
  const failed = name.startsWith('FAILED-');
  if (!failed && SHOTS.indexOf(name) === -1) return;
  fs.mkdirSync(OUT, { recursive: true });
  await browser.pause(400);
  await browser.saveScreenshot(path.join(OUT, `${version}-${name}.png`));
}

/** Click the first element matching a selector whose text is exactly `text`, in the page. */
export async function clickText(selector, text) {
  const found = await browser.execute(
    (sel, want) => {
      const el = Array.from(document.querySelectorAll(sel)).find((e) => e.textContent.trim() === want);
      if (el) el.click();
      return !!el;
    },
    selector,
    text
  );
  expect(found).toBe(true);
}

/** Inside the tab in use — another tab may show the same file. */
export const ACTIVE = '.workspace-leaf.mod-active ';

export async function menuTitles() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('.menu .menu-item-title')).map((e) => e.textContent.trim())
  );
}

/**
 * Reads with `read` until `ok` holds of what it got, or `ms` pass — then
 * what it read last, either way, so the expect after it says what was
 * wrong. In place of a fixed pause: no longer than it takes.
 */
export async function readUntil(read, ok, ms = 8000) {
  const end = Date.now() + ms;
  let got = await read();
  while (!ok(got) && Date.now() < end) {
    await browser.pause(100);
    got = await read();
  }
  return got;
}

export async function closeMenus() {
  await browser.keys('Escape');
  await browser.pause(200);
}

/** Measured, not timed: plugin load, a library redraw, shelves. A spec's own; joined with the rest after. */
export const perf = [];

/** Opens a folder as an album in the tab in use, and waits for its page. */
export async function openAlbum(folder) {
  await browser.executeObsidian(async ({ plugins }, folder) => {
    const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
    await library.browseMode({ mode: 'folder', path: folder });
  }, folder);
  await browser.$(ACTIVE + '.dr-detail').waitForExist({ timeout: 10000 });
}

/** Watches for errors, loads the plugin afresh (so its start is watched too), puts the tested settings on, and keeps what it all began as. */
async function start() {
  version = await browser.executeObsidian(({ obsidian }) => obsidian.apiVersion);
  await browser.executeObsidian(async ({ app }) => {
    window.__drErrors = [];
    const original = console.error;
    console.error = (...args) => {
      window.__drErrors.push(args.map((a) => (a && a.stack) || String(a)).join(' '));
      original.apply(console, args);
    };
    window.addEventListener('error', (e) => window.__drErrors.push(String((e.error && e.error.stack) || e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__drErrors.push(String((e.reason && e.reason.stack) || e.reason)));
    await app.plugins.disablePlugin('design-redux');
    // How long loading takes: the baseline the refactor is held to.
    const started = performance.now();
    await app.plugins.enablePlugin('design-redux');
    window.__drLoadMs = Math.round(performance.now() - started);
    // A first install starts without the strip, with notes as the theme draws them, its own
    // properties in sight and Obsidian's gear where it was; all are still offered, and tested
    // here, so they're put on.
    const plugin = app.plugins.plugins['design-redux'];
    plugin.settings.contextStrip = true;
    plugin.settings.lookScope = 'window';
    plugin.settings.hideNativeProperties = true;
    plugin.settings.settingsInHeader = true;
    await plugin.saveSettings();
  });
  await browser.pause(1500);
  await browser.executeObsidian(({ app }) => {
    const ws = app.workspace;
    const leaves = [];
    ws.iterateRootLeaves((l) => leaves.push(l));
    window.__drBaseline = {
      settings: JSON.stringify(app.plugins.plugins['design-redux'].settings),
      view: leaves[0] ? leaves[0].getViewState() : { type: 'empty' },
      left: ws.leftSplit.collapsed,
      right: ws.rightSplit.collapsed,
      inspector: ws.getLeavesOfType('design-redux-properties').length > 0,
      theme: app.getTheme ? app.getTheme() : null,
    };
  });
}

/** Back to what the spec began with: see the top of this file. */
async function reset() {
  for (let i = 0; i < 3; i++) {
    const open = await browser.execute(() => !!document.querySelector('.menu, .modal-container, .suggestion-container'));
    if (!open) break;
    await browser.keys('Escape');
    await browser.pause(100);
  }
  await browser.executeObsidian(async ({ app }) => {
    const b = window.__drBaseline;
    const plugin = app.plugins.plugins['design-redux'];
    const ws = app.workspace;
    if (app.setting && typeof app.setting.close === 'function') app.setting.close();
    if (plugin.selection && typeof plugin.selection.clear === 'function') plugin.selection.clear();
    if (b.theme && app.getTheme && app.getTheme() !== b.theme) app.changeTheme(b.theme);
    if (JSON.stringify(plugin.settings) !== b.settings) {
      // Into the same object: features read it through the plugin, but some may hold it.
      const saved = JSON.parse(b.settings);
      Object.keys(plugin.settings).forEach((k) => delete plugin.settings[k]);
      Object.assign(plugin.settings, saved);
      await plugin.saveSettings();
    }
    const leaves = [];
    ws.iterateRootLeaves((l) => leaves.push(l));
    leaves.slice(1).forEach((l) => l.detach());
    const first = leaves[0] || ws.getLeaf(false);
    await first.setViewState(Object.assign({}, b.view, { active: true }));
    ws.setActiveLeaf(first, { focus: true });
    const inspectors = ws.getLeavesOfType('design-redux-properties');
    if (!b.inspector) inspectors.forEach((l) => l.detach());
    else if (!inspectors.length) {
      const leaf = ws.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: 'design-redux-properties', active: false });
    }
    [[ws.leftSplit, b.left], [ws.rightSplit, b.right]].forEach(([split, collapsed]) => {
      if (split.collapsed !== collapsed) (collapsed ? split.collapse() : split.expand());
    });
  });
  // Settings saved are applied a beat later; until then a test would see the old ones.
  await readUntil(() => browser.executeObsidian(({ app }) => !app.plugins.plugins['design-redux'].refreshTimer), (done) => done, 3000);
}

/**
 * A spec: its tests, each from the same place, then a check that the
 * plugin logged no errors of its own along the way.
 */
export function suite(name, body) {
  const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  describe(name, function () {
    // How long each test takes, beside the other results: what to speed up.
    const timings = [];
    let started = 0;

    before(start);

    beforeEach(async function () {
      await reset();
      started = Date.now();
    });

    afterEach(async function () {
      if (this.currentTest) timings.push([Date.now() - started, this.currentTest.title]);
      if (this.currentTest && this.currentTest.state === 'failed') {
        await shot(`FAILED-${this.currentTest.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}`);
      }
    });

    after(async function () {
      const dir = path.join(PARTS, version);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${slug}.timings.json`), JSON.stringify({ perf, timings }));
      const errors = await browser.executeObsidian(() => window.__drErrors || []);
      fs.writeFileSync(path.join(dir, `${slug}.errors.json`), JSON.stringify(errors));
    });

    body();

    it('logged no errors of its own along the way', async function () {
      const errors = await browser.executeObsidian(() => window.__drErrors || []);
      const ours = errors.filter((e) => /design redux|plugin:design-redux/i.test(e));
      expect(ours).toEqual([]);
    });
  });
}
