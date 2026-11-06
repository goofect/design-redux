// Design Redux inside the real Obsidian app.
//
// The simulation suites in tests/ can't see Obsidian's own code — its menus,
// dialogs and canvas — so this checks the plugin where those are real: that it
// loads cleanly, that the unofficial parts of Obsidian it leans on are there,
// and that its main screens draw. Screenshots and a compatibility report go to
// ci-output/, which the workflow publishes to the ci-results branch.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

const OUT = path.resolve('ci-output');
let version = 'unknown';

// Screenshots are kept few, to keep the runs and the ci-results branch
// small: these, on the latest Obsidian only (not the oldest, the first
// entry in wdio.conf.mjs), plus any test that fails, on either.
const OLDEST = '1.7.7';
const SHOTS = ['right-sidebar-dark', 'right-sidebar-light', 'page-control-light', 'page-control-dark', 'album', 'album-editorial', 'album-light', 'home', 'note-and-strip', 'graph-routes', 'footnote-box', 'properties-edit', 'properties-list', 'properties-sheet', 'footnotes-view', 'preview', 'settings-appearance', 'settings-library', 'menu', 'properties-inspector', 'undo-notice', 'album-edit'];

async function shot(name) {
  const failed = name.startsWith('FAILED-');
  if (!failed && (version === OLDEST || SHOTS.indexOf(name) === -1)) return;
  fs.mkdirSync(OUT, { recursive: true });
  await browser.pause(400);
  await browser.saveScreenshot(path.join(OUT, `${version}-${name}.png`));
}

/** Click the first element matching a selector whose text is exactly `text`, in the page. */
async function clickText(selector, text) {
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
const ACTIVE = '.workspace-leaf.mod-active ';

async function menuTitles() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('.menu .menu-item-title')).map((e) => e.textContent.trim())
  );
}

/**
 * Reads with `read` until `ok` holds of what it got, or `ms` pass — then
 * what it read last, either way, so the expect after it says what was
 * wrong. In place of a fixed pause: no longer than it takes.
 */
async function readUntil(read, ok, ms = 8000) {
  const end = Date.now() + ms;
  let got = await read();
  while (!ok(got) && Date.now() < end) {
    await browser.pause(100);
    got = await read();
  }
  return got;
}

async function closeMenus() {
  await browser.keys('Escape');
  await browser.pause(200);
}

describe('Design Redux in Obsidian', function () {
  before(async function () {
    version = await browser.executeObsidian(({ obsidian }) => obsidian.apiVersion);
    // Watch for errors for the rest of the run, then load the plugin afresh
    // so its start-up is watched too.
    await browser.executeObsidian(async ({ app }) => {
      window.__drErrors = [];
      const original = console.error;
      console.error = (...args) => {
        window.__drErrors.push(args.map((a) => (a && a.stack) || String(a)).join(' '));
        original.apply(console, args);
      };
      window.addEventListener('error', (e) => window.__drErrors.push(String((e.error && e.error.stack) || e.message)));
      window.addEventListener('unhandledrejection', (e) =>
        window.__drErrors.push(String((e.reason && e.reason.stack) || e.reason))
      );
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
  });

  // How long each test takes, slowest first, beside the other results: what to speed up.
  const timings = [];
  // Measured, not timed tests: plugin load, a library redraw.
  const perf = [];
  let started = 0;
  beforeEach(function () {
    started = Date.now();
  });

  afterEach(async function () {
    if (this.currentTest) timings.push([Date.now() - started, this.currentTest.title]);
    if (this.currentTest && this.currentTest.state === 'failed') {
      const name = this.currentTest.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 50);
      await shot(`FAILED-${name}`);
    }
  });

  after(function () {
    fs.mkdirSync(OUT, { recursive: true });
    const lines = perf.concat(timings.sort((x, y) => y[0] - x[0]).map(([ms, title]) => `${(ms / 1000).toFixed(1).padStart(5)}s  ${title}`));
    fs.writeFileSync(path.join(OUT, `${version}-timings.txt`), lines.join('\n') + '\n');
  });

  it('loads, with its features running', async function () {
    const state = await browser.executeObsidian(({ plugins }) => {
      const p = plugins.designRedux;
      return p ? p.features.map((f) => [f.constructor.name, !!f.enabled]) : null;
    });
    expect(state).not.toBeNull();
    perf.push(`perf: plugin load ${await browser.executeObsidian(() => window.__drLoadMs)} ms`);
    const on = Object.fromEntries(state);
    // Switched on by default.
    for (const name of ['Library', 'ContextStrip', 'CoverImages', 'Scripts', 'BulkEditing']) {
      expect([name, on[name]]).toEqual([name, true]);
    }
  });

  it('shows one settings gear, in the sidebar header', async function () {
    const gears = () =>
      browser.executeObsidian(() =>
        Array.from(document.querySelectorAll('.workspace .clickable-icon'))
          .filter((el) => el.querySelector('svg.lucide-settings') && el.offsetParent !== null)
          .map((el) => (el.closest('.workspace-tab-header-container') ? 'header' : el.parentElement.className))
      );
    await browser.waitUntil(async () => (await gears()).includes('header'), { timeout: 5000, timeoutMsg: 'the gear never reached the header' });
    expect(await gears()).toEqual(['header']);
    // The sidebar drawn again — as a new layout does — and still one.
    await browser.executeObsidian(async ({ app }) => {
      const layout = app.workspace.getLayout();
      await app.workspace.changeLayout(layout);
    });
    await browser.waitUntil(async () => (await gears()).includes('header'), { timeout: 5000, timeoutMsg: 'the gear never came back to the header' });
    expect(await gears()).toEqual(['header']);
  });

  it('finds the unofficial parts of Obsidian it relies on', async function () {
    const compat = await browser.executeObsidian(({ app, obsidian }) => {
      const has = (fn) => {
        try {
          return !!fn();
        } catch (err) {
          return false;
        }
      };
      return {
        submenus: has(() => typeof obsidian.MenuItem.prototype.setSubmenu === 'function'),
        inputSuggest: has(() => typeof obsidian.AbstractInputSuggest === 'function'),
        propertyTypes: has(() => typeof app.metadataTypeManager.getAllProperties === 'function'),
        corePlugins: has(() => typeof app.internalPlugins.getEnabledPluginById === 'function'),
        canvasOn: has(() => app.internalPlugins.getEnabledPluginById('canvas')),
        settingsWindow: has(() => typeof app.setting.openTabById === 'function'),
        editorSuggestList: has(() => Array.isArray(app.workspace.editorSuggest.suggests)),
        modalKeys: has(() => new obsidian.Modal(app).scope instanceof obsidian.Scope),
        menuItems: has(() => Array.isArray(new obsidian.Menu().items)),
      };
    });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${version}-compat.json`), JSON.stringify(compat, null, 2));
    for (const [part, ok] of Object.entries(compat)) expect([part, ok]).toEqual([part, true]);
  });

  it('draws its settings as four places and a look, by what they’re for', async function () {
    await browser.executeObsidian(({ app }) => {
      app.setting.open();
      app.setting.openTabById('design-redux');
    });
    await browser.pause(1000);
    // Newer Obsidian can show settings in a window of their own, so the
    // tab is asked where it is rather than looked for in the main window.
    const where = await browser.executeObsidian(({ app }) => {
      const tab = (app.setting.pluginTabs || []).find((t) => t.id === 'design-redux');
      const doc = tab && tab.containerEl ? tab.containerEl.ownerDocument : null;
      return {
        sameWindow: doc === document,
        title: doc ? doc.title : null,
        tabs: doc ? doc.querySelectorAll('.dr-settings .dr-set-tab').length : 0,
      };
    });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${version}-settings-facts.json`), JSON.stringify(where, null, 2));
    expect(where.tabs).toBe(6);

    // A screenshot from whichever window they're in.
    const main = await browser.getWindowHandle();
    if (!where.sameWindow) {
      for (const handle of await browser.getWindowHandles()) {
        if (handle === main) continue;
        await browser.switchToWindow(handle);
        if ((await browser.$$('.dr-settings').length) > 0) break;
      }
    }
    await shot('settings-appearance');
    await clickText('.dr-settings .dr-set-tab', 'Library');
    await shot('settings-library');

    // Searching shows the matching rows from every tab, named as ever, and nothing else.
    const found = await browser.execute(() => {
      const input = document.querySelector('.dr-settings .dr-set-search input');
      input.value = 'cover';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const rows = Array.from(document.querySelectorAll('.dr-settings .setting-item[data-dr-search]'));
      const seen = rows.filter((r) => r.offsetParent !== null);
      const names = seen.map((r) => r.querySelector('.setting-item-name')).filter((n) => n && n.offsetHeight > 0).map((n) => n.textContent);
      const panes = Array.from(document.querySelectorAll('.dr-settings .dr-set-pane:not(.is-hidden)')).map((p) => p.dataset.tab);
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { names, all: rows.length, seen: seen.length, panes };
    });
    expect(found.names).toContain('Drop to set a cover');
    expect(found.names.length).toBe(found.seen);
    expect(found.seen).toBeLessThan(found.all);
    expect(found.panes).toContain('appearance');
    await browser.switchToWindow(main);
    await browser.executeObsidian(({ app }) => app.setting.close());
    await browser.pause(500);
  });

  it('opens a folder as an album, with an Edit mode', async function () {
    await browser.executeObsidian(async ({ plugins }) => {
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Politics' });
    });
    await browser.$('.dr-detail').waitForExist({ timeout: 10000 });
    const rows = await browser.$$('.dr-track');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    await shot('album');
    // A folder's page keeps its title, and a left sidebar as square as the right.
    const look = await browser.execute(() => {
      const left = getComputedStyle(document.querySelector('.workspace-split.mod-left-split'));
      return {
        named: !!document.querySelector('.dr-detail .dr-detail-title'),
        tabs: Array.from(document.querySelectorAll('.dr-panel-tab')).map((t) => t.dataset.panel).filter((id) => id !== 'notes' && id !== 'sources'),
        corner: left.borderTopRightRadius,
        shadow: left.boxShadow,
        margin: left.marginLeft,
      };
    });
    expect(look).toEqual({ named: true, tabs: [], corner: '0px', shadow: 'none', margin: '0px' });
    await clickText('.dr-detail-action', 'Edit');
    await browser.$('.dr-edit-grip').waitForExist({ timeout: 5000 });
    await shot('album-edit');
    await clickText('.dr-detail-action', 'Done');
  });

  it('swipes the sidebars in and back out, over an album and over a note', async function () {
    const result = await browser.executeObsidian(async ({ app, plugins }) => {
      const ws = app.workspace;
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      let at = performance.now();
      // A two-finger swipe: a few sideways wheel events, a gesture of their own.
      const swipe = async (el, dx) => {
        await pause(400);
        const box = el.getBoundingClientRect();
        const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) || el;
        for (let i = 0; i < 6; i++) {
          target.dispatchEvent(new WheelEvent('wheel', { deltaX: dx / 6, deltaY: 0, bubbles: true, cancelable: true }));
          await pause(16);
        }
        await pause(400);
        return target;
      };
      // What under the hand scrolls sideways, should a swipe be refused.
      const blockers = (el) => {
        const out = [];
        for (; el && el !== document.body; el = el.parentElement) {
          if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) {
            const edge = el.getBoundingClientRect().left + el.clientWidth + 1;
            const wide = Array.from(el.querySelectorAll('*')).filter((c) => c.getBoundingClientRect().right > edge && c.parentElement.getBoundingClientRect().right <= edge).slice(0, 4).map((c) => `${c.tagName}.${c.className} ${Math.round(c.getBoundingClientRect().right - edge)}`);
            out.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}: ${wide.join(' | ')}`);
          }
        }
        return out;
      };
      const page = () => ws.rootSplit.containerEl.querySelector('.workspace-leaf.mod-active .view-content') || ws.rootSplit.containerEl;
      const round = async () => {
        const out = {};
        if (ws.leftSplit.collapsed) ws.leftSplit.expand();
        if (ws.rightSplit.collapsed) ws.rightSplit.expand();
        await pause(400);
        await swipe(ws.leftSplit.containerEl, 120);
        out.leftIn = ws.leftSplit.collapsed;
        let t = await swipe(page(), -120);
        out.leftOut = !ws.leftSplit.collapsed;
        if (!out.leftOut) out.leftBlockedBy = blockers(t);
        await swipe(ws.rightSplit.containerEl, -120);
        out.rightIn = ws.rightSplit.collapsed;
        t = await swipe(page(), 120);
        out.rightOut = !ws.rightSplit.collapsed;
        if (!out.rightOut) out.rightBlockedBy = blockers(t);
        return out;
      };
      const was = { left: ws.leftSplit.collapsed, right: ws.rightSplit.collapsed };
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      await pause(800);
      const album = await round();
      const note = app.vault.getMarkdownFiles()[0];
      await ws.getLeaf(false).openFile(note);
      await pause(800);
      const onNote = await round();
      // Left as the tests after it expect: the album open, the sidebars as they were.
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      [[ws.leftSplit, was.left], [ws.rightSplit, was.right]].forEach(([split, collapsed]) => (collapsed ? split.collapse() : split.expand()));
      await pause(400);
      return { album, note: onNote };
    });
    const all = { leftIn: true, leftOut: true, rightIn: true, rightOut: true };
    expect(result).toEqual({ album: all, note: all });
  });

  it('holds the left panel and the album page still while nothing changes', async function () {
    // Watched for three seconds with an album open and nothing touched: the
    // left panel's classes, the page's, and anything redrawn on either side.
    await browser.executeObsidian(async ({ app, plugins }) => {
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      if (typeof library.reveal === 'function') await library.reveal();
    });
    await browser.$('.dr-detail').waitForExist({ timeout: 10000 });
    // The library open: how long one redraw of it takes, for the baseline.
    const redraw = await browser.executeObsidian(({ app }) => {
      const leaf = app.workspace.getLeavesOfType('design-redux-library')[0];
      if (!leaf || !leaf.view || typeof leaf.view.render !== 'function') return null;
      const started = performance.now();
      leaf.view.render();
      return Math.round(performance.now() - started);
    });
    perf.push(`perf: library redraw ${redraw} ms`);
    await browser.pause(1500);
    const report = await browser.executeObsidian(async ({ app }) => {
      const out = { split: [], body: [], panel: 0, panelSample: [], page: 0, pageSample: [], splitStyle: 0 };
      const split = app.workspace.leftSplit && app.workspace.leftSplit.containerEl;
      const name = (n) => (n.nodeType === 1 ? `${n.tagName.toLowerCase()}.${String(n.className).split(' ').slice(0, 2).join('.')}` : '#text');
      const watch = [];
      if (split) {
        const mo = new MutationObserver((records) => records.forEach((r) => {
          if (r.target === split && r.attributeName === 'class') out.split.push(`${r.oldValue} -> ${split.className}`);
          else if (r.target === split && r.attributeName === 'style') out.splitStyle++;
          else if (r.type === 'childList' || r.attributeName) {
            out.panel++;
            if (out.panelSample.length < 6) out.panelSample.push(`${r.type}:${r.attributeName || ''} ${name(r.target)}`);
          }
        }));
        mo.observe(split, { attributes: true, attributeOldValue: true, childList: true, subtree: true, characterData: true });
        watch.push(mo);
      }
      const bodyMo = new MutationObserver((records) => records.forEach((r) => {
        if (r.attributeName === 'class') out.body.push(`${r.oldValue} -> ${document.body.className}`.replace(/\s+/g, ' ').slice(0, 300));
      }));
      bodyMo.observe(document.body, { attributes: true, attributeOldValue: true });
      watch.push(bodyMo);
      const page = document.querySelector('.workspace-split.mod-root');
      if (page) {
        const pageMo = new MutationObserver((records) => records.forEach((r) => {
          out.page++;
          if (out.pageSample.length < 6) out.pageSample.push(`${r.type}:${r.attributeName || ''} ${name(r.target)}`);
        }));
        pageMo.observe(page, { attributes: true, childList: true, subtree: true, characterData: true });
        watch.push(pageMo);
      }
      await new Promise((r) => setTimeout(r, 3000));
      watch.forEach((mo) => mo.disconnect());
      return out;
    });
    expect(report.split).toEqual([]);
    expect(report.body).toEqual([]);
    expect([report.panel, report.panelSample]).toEqual([0, []]);
    expect([report.page, report.pageSample]).toEqual([0, []]);
  });

  it('keeps to its design system in the dark theme, the light one and the editorial look: one control size, square covers, rows by density, readable text', async function () {
    const started = await browser.executeObsidian(({ app }) => (app.vault && typeof app.vault.getConfig === 'function' ? app.vault.getConfig('theme') : null) || 'moonstone');
    // The album page, the library beside it; covers are measured on the home screen's tiles.
    const covers = await browser.executeObsidian(async ({ plugins }) => {
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      if (typeof library.reveal === 'function') await library.reveal();
      await library.browseMode({ mode: 'home' });
      await new Promise((r) => setTimeout(r, 600));
      const page = document.querySelector('.workspace-leaf.mod-active .dr-browse') || document.querySelector('.dr-browse');
      const tiles = Array.from(page.querySelectorAll('.dr-card-art, .dr-pick-art')).filter((c) => c.offsetWidth > 0);
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      return tiles.map((c) => Math.abs(c.offsetWidth - c.offsetHeight));
    });
    expect(covers.length).toBeGreaterThan(0);
    covers.forEach((d) => expect(d).toBeLessThanOrEqual(1));
    await browser.$('.dr-detail').waitForExist({ timeout: 10000 });
    // Set the theme (Obsidian's dark or light) and the look, then measure what's on screen.
    const measure = (theme, look, density) => browser.executeObsidian(async ({ app, plugins }, theme, look, density) => {
      const plugin = plugins.designRedux;
      const appearance = plugin.features.find((f) => f.constructor.name === 'Appearance');
      if (typeof app.changeTheme === 'function') app.changeTheme(theme);
      else if (app.vault && typeof app.vault.setConfig === 'function') {
        app.vault.setConfig('theme', theme);
        if (typeof app.updateTheme === 'function') app.updateTheme();
      }
      plugin.settings.look = look;
      plugin.settings.gridDensity = density;
      appearance.apply();
      plugin.refreshBrowse();
      await new Promise((r) => setTimeout(r, 400));
      const lum = (rgb) => {
        const [r, g, b] = (rgb.match(/[\d.]+/g) || ['0', '0', '0']).slice(0, 3).map((n) => {
          const c = Number(n) / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const behind = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor;
          const parts = c.match(/[\d.]+/g) || [];
          if (parts.length >= 3 && (parts.length < 4 || Number(parts[3]) > 0.9)) return c;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const contrast = (el) => {
        if (!el) return 99;
        const a = lum(getComputedStyle(el).color);
        const b = lum(behind(el));
        return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
      };
      const page = document.querySelector('.workspace-leaf.mod-active .dr-browse') || document.querySelector('.dr-browse');
      const control = parseFloat(getComputedStyle(document.body).getPropertyValue('--dr-control-size'));
      const shown = (el) => el.offsetWidth > 0 && el.offsetHeight > 0;
      return {
        dark: document.body.classList.contains('theme-dark'),
        control,
        buttons: Array.from(document.querySelectorAll('.dr-strip .dr-strip-btn:not(.is-secondary)')).filter(shown).map((b) => [b.offsetWidth, b.offsetHeight]),
        rows: Array.from(document.querySelectorAll('.dr-library .dr-lib-row')).filter(shown).map((r) => [Math.round(parseFloat(getComputedStyle(r).minHeight)), r.offsetHeight]),
        title: contrast(page.querySelector('.dr-detail-title')),
        meta: contrast(page.querySelector('.dr-detail-meta')),
      };
    }, theme, look, density);
    const check = (m, label) => {
      m.buttons.forEach(([w, h]) => expect([label, w, h]).toEqual([label, m.control, m.control]));
      m.rows.forEach(([min, h]) => expect([label, h >= min]).toEqual([label, true]));
      expect([label, m.title >= 4.5, m.meta >= 4.5]).toEqual([label, true, true]);
    };
    const dark = await measure('obsidian', 'theme', 'standard');
    check(dark, 'dark');
    expect(dark.dark).toBe(true);
    expect(dark.rows.length).toBeGreaterThan(0);
    expect(dark.rows[0][0]).toBe(32);
    const editorial = await measure('obsidian', 'editorial', 'standard');
    check(editorial, 'editorial, dark');
    await shot('album-editorial');
    check(await measure('moonstone', 'editorial', 'standard'), 'editorial, light');
    const light = await measure('moonstone', 'theme', 'standard');
    check(light, 'light');
    expect(light.dark).toBe(false);
    await shot('album-light');
    // Density: rows a unit tighter or looser.
    const compact = await measure('obsidian', 'theme', 'compact');
    const spacious = await measure('obsidian', 'theme', 'large');
    expect([compact.rows[0][0], spacious.rows[0][0]]).toEqual([28, 36]);
    check(compact, 'compact');
    check(spacious, 'spacious');
    // Back as it was, for the tests after.
    await measure(started, 'apple', 'standard');
  });

  it('keeps the ribbon’s buttons out of sight while they’re in the menu', async function () {
    const seen = await browser.executeObsidian(({ plugins }) => {
      const s = plugins.designRedux.settings;
      const ribbon = document.querySelector('.workspace-ribbon.mod-left, .workspace-ribbon.mod-primary');
      const visible = Array.from(document.querySelectorAll('.side-dock-ribbon-action')).filter((el) => {
        const r = el.getBoundingClientRect();
        let opacity = 1;
        for (let e = el; e && e !== document.body; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
        const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
        return onScreen && opacity > 0.05;
      });
      return {
        on: !!(s.navDropdown && s.ribbonInMenu),
        body: document.body.classList.contains('dr-ribbon-active'),
        ribbonWidth: ribbon ? ribbon.getBoundingClientRect().width : -1,
        actions: document.querySelectorAll('.side-dock-ribbon-action').length,
        visible: visible.map((el) => el.getAttribute('aria-label')),
      };
    });
    expect(seen.on).toBe(true);
    expect(seen.body).toBe(true);
    expect(seen.ribbonWidth).toBe(0);
    expect(seen.visible).toEqual([]);
  });

  it('renames a folder in Edit mode, and one press of Done finishes', async function () {
    await browser.executeObsidian(async ({ app, plugins }) => {
      await app.vault.createFolder('Renaming');
      await app.vault.create('Renaming/Inside.md', 'Hello.');
      // A cover, kept on the folder's note.
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0)
      );
      await app.vault.createBinary('Renaming/pic.png', png.buffer);
      await app.vault.create('Renaming/Renaming.md', '---\ncover: "[[pic.png]]"\n---\n');
      await new Promise((r) => setTimeout(r, 800));
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Renaming' });
    });
    await browser.$('.dr-detail').waitForExist({ timeout: 10000 });
    await clickText('.dr-detail-action', 'Edit');
    const title = await browser.$('.dr-detail-title.dr-edit-name');
    await title.waitForExist({ timeout: 5000 });
    await title.click();
    await browser.execute((el) => el.select(), title);
    await browser.keys('Renamed'.split(''));

    // Pressed as a hand does: down, a moment, up.
    const done = await browser.$('.dr-detail-action.is-primary');
    await browser.action('pointer').move({ origin: done }).down().pause(200).up().perform();
    await browser.pause(1500);

    const after = await browser.executeObsidian(async ({ app, plugins }) => {
      const leaf = app.workspace.getMostRecentLeaf();
      const page = leaf.view.contentEl;
      const result = {
        renamed: !!app.vault.getAbstractFileByPath('Renamed/Inside.md'),
        stillEditing: !!page.querySelector('.dr-edit-name'),
        shows: (page.querySelector('.dr-detail-title') || {}).textContent || null,
        tab: leaf.tabHeaderInnerTitleEl ? leaf.tabHeaderInnerTitleEl.textContent : 'Renamed',
        folderNote: !!app.vault.getFileByPath('Renamed/Renamed.md'),
        cover: !!page.querySelector('.dr-detail-art img[src*="pic.png"]'),
        noteAsTrack: !!page.querySelector('.dr-track[data-path$="Renamed.md"], .dr-track[data-path$="Renaming.md"]'),
      };
      // Back to Politics, where the tests after this one expect to be.
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      const folder = app.vault.getAbstractFileByPath('Renamed') || app.vault.getAbstractFileByPath('Renaming');
      if (folder) await app.vault.delete(folder, true);
      // Its Undo, which a later test would otherwise find first.
      document.querySelectorAll('.notice').forEach((n) => {
        if (n.textContent.includes('Renaming')) n.remove();
      });
      return result;
    });
    expect(after).toEqual({
      renamed: true,
      stillEditing: false,
      shows: 'Renamed',
      tab: 'Renamed',
      folderNote: true,
      cover: true,
      noteAsTrack: false,
    });
  });

  it('groups its right-click entries, with New canvas under New', async function () {
    const disc = await browser.$('.dr-disc[data-folder="Politics/Theories"]');
    await disc.waitForExist({ timeout: 5000 });
    await disc.click({ button: 'right' });
    await browser.$('.menu').waitForExist({ timeout: 5000 });
    const titles = await menuTitles();
    for (const want of ['New', 'Cover', 'Pin', 'Properties…']) expect(titles).toContain(want);
    // The New entry opens beside the menu, under a real pointer.
    const items = await browser.$$('.menu .menu-item');
    let newItem = null;
    for (const item of items) {
      if ((await item.getText()).trim() === 'New') newItem = item;
    }
    expect(newItem).not.toBeNull();
    await newItem.moveTo();
    // Opened on hover, after a moment — longer on a busy machine.
    await browser
      .waitUntil(async () => (await menuTitles()).includes('Canvas'), { timeout: 4000, interval: 200 })
      .catch(() => {});
    await shot('menu');
    expect(await menuTitles()).toContain('Canvas');
    await closeMenus();
    await closeMenus();
  });

  it('opens the Properties window as a list of properties, each tool a sheet over it', async function () {
    await browser.executeObsidian(({ app, plugins }) => {
      const tools = plugins.designRedux.features.find((f) => f.constructor.name === 'BulkEditing');
      tools.openTools([app.vault.getAbstractFileByPath('Politics')]);
    });
    await browser.$('.dr-props-modal .dr-plist-row').waitForExist({ timeout: 5000 });
    const listed = await browser.execute(() =>
      Array.from(document.querySelectorAll('.dr-props-modal .dr-plist-row')).map((r) => {
        const values = r.querySelector('.dr-plist-values');
        return [
          r.querySelector('.dr-plist-name').textContent,
          r.querySelector('.dr-plist-cover').textContent,
          values ? values.textContent : null,
          values ? values.getBoundingClientRect().width > 20 : false,
        ];
      })
    );
    expect(listed.length).toBeGreaterThanOrEqual(2);
    expect(listed[0][1]).toMatch(/^\d+ of \d+$/);
    // Each property's values, shown under its name.
    const domain = listed.find((r) => r[0] === 'domain');
    expect(domain[2]).toContain('Politics');
    expect(domain[3]).toBe(true);
    // Under the pointer, a row lights up and shows its •••.
    const look = () =>
      browser.execute(() => {
        const row = document.querySelector('.dr-props-modal .dr-plist-row');
        return [getComputedStyle(row).backgroundColor, getComputedStyle(row.querySelector('.dr-plist-more')).opacity];
      });
    await (await browser.$('.dr-props-modal .modal-title')).moveTo();
    await browser.pause(300);
    const resting = await look();
    await (await browser.$('.dr-props-modal .dr-plist-row .dr-plist-values')).moveTo();
    await browser.pause(300);
    const hovered = await look();
    expect(hovered[0]).not.toBe(resting[0]);
    expect([resting[1], hovered[1]]).toEqual(['0', '1']);
    await shot('properties-list');

    // Add property opens over the list, and Back returns to it.
    await clickText('.dr-props-modal .dr-plist-foot button', 'Add property');
    await browser.$('.dr-props-modal .dr-sheet-back').waitForExist({ timeout: 5000 });
    expect(await browser.$('.dr-props-modal .modal-title .dr-sheet-title').getText()).toBe('Add properties');
    await shot('properties-sheet');
    await browser.execute(() => document.querySelector('.dr-props-modal .dr-sheet-back').click());
    await browser.$('.dr-props-modal .dr-plist-row').waitForExist({ timeout: 5000 });
    const chips = await browser.execute(() =>
      Array.from(document.querySelectorAll('.dr-props-modal .dr-bulk-chip-name')).map((c) => c.textContent)
    );
    expect(chips).toEqual(['Politics']);

    await browser.keys('Escape');
    await browser.pause(400);
    expect(await browser.$('.dr-props-modal').isExisting()).toBe(false);
  });

  it('searches: words from a note show their passage; the note named for the query comes first, and Enter opens it', async function () {
    await browser.executeObsidian(async ({ plugins }) => {
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'search' });
    });
    const input = await browser.$(ACTIVE + '.dr-browse-search input');
    await input.waitForExist({ timeout: 8000 });
    // A notice left by an earlier test can sit over the field.
    await browser.execute(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
    // Whatever leaves the field from here on, kept with where it went and the stack.
    await browser.execute(() => {
      window.__drBlur = null;
      document.addEventListener('focusout', (e) => {
        if (!e.target.closest || !e.target.closest('.dr-browse-search')) return;
        window.__drBlur = { to: e.relatedTarget ? `${e.relatedTarget.tagName}.${e.relatedTarget.className}` : null, at: Math.round(performance.now()), stack: String(new Error().stack).split('\n').slice(1, 9).map((l) => l.trim()) };
      }, { capture: true });
    });
    await input.click();
    // Typed only once the field has held the focus a moment: the page can still be settling as it opens.
    let held = 0;
    const focused = await readUntil(
      () => browser.execute(() => {
        const field = document.querySelector('.workspace-leaf.mod-active .dr-browse-search input');
        if (field && document.activeElement !== field) field.focus();
        return !!field && document.activeElement === field;
      }),
      (f) => (f ? ++held >= 4 : (held = 0) > 0)
    );
    expect(focused).toBe(true);
    // Where the keys go, kept for a miss: what got them, and whether something stopped them.
    await browser.execute(() => {
      const log = (window.__drKeys = []);
      const field = document.querySelector('.workspace-leaf.mod-active .dr-browse-search input');
      window.__drField = field;
      document.addEventListener('keydown', (e) => log.push(['down', e.key, e.target.className || e.target.tagName]), { capture: true });
      window.addEventListener('keydown', (e) => e.defaultPrevented && log.push(['stopped', e.key]), false);
      if (field) field.addEventListener('input', () => log.push(['input', field.value]));
    });
    // Words from a note's text: the passage they're in, shown.
    await browser.keys('lettered item'.split(''));
    // With what the field holds, so a miss says whether the keys arrived.
    const passage = await readUntil(
      () => browser.execute(() => {
        const field = document.querySelector('.workspace-leaf.mod-active .dr-browse-search input');
        const found = Array.from(document.querySelectorAll('.workspace-leaf.mod-active [data-excerpt]')).some((e) => /lettered item/i.test(e.dataset.excerpt));
        return { found, field: field ? field.value : null };
      }),
      (w) => w.found
    );
    if (!passage.found) {
      const seen = await browser.execute(() => ({
        keys: (window.__drKeys || []).slice(0, 8),
        same: window.__drField === document.querySelector('.workspace-leaf.mod-active .dr-browse-search input'),
        connected: !!(window.__drField && window.__drField.isConnected),
        active: document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}` : null,
        focus: document.hasFocus(),
        modal: document.querySelectorAll('.modal-container').length,
        blur: window.__drBlur || null,
      }));
      expect(seen).toEqual({});
    }
    expect(passage).toEqual({ found: true, field: 'lettered item' });
    await browser.execute(() => {
      const field = document.querySelector('.workspace-leaf.mod-active .dr-browse-search input');
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus();
    });
    await browser.keys('Deterrence'.split(''));
    const top = await readUntil(
      () => browser.execute(() => {
        const el = document.querySelector('.workspace-leaf.mod-active .dr-search-top-title');
        return el ? el.textContent : null;
      }),
      (t) => t === 'Deterrence'
    );
    expect(top).toBe('Deterrence');
    await browser.execute(() => document.querySelector('.workspace-leaf.mod-active .dr-search-top').focus());
    await browser.keys('Enter');
    const opened = await readUntil(() => browser.executeObsidian(({ app }) => (app.workspace.getActiveFile() || {}).path), (p) => p === 'Politics/Deterrence.md');
    expect(opened).toBe('Politics/Deterrence.md');
  });

  it('shows one page of a note with pages, in editing and in reading view', async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const old = app.vault.getFileByPath('Pages note.md');
      if (old) await app.vault.delete(old);
      const file = await app.vault.create('Pages note.md', '---\ntype: test\n---\n%%page: Overview%%\nAlpha text\n\n%%page: Sources%%\nBeta text\n');
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file, { state: { mode: 'source', source: false } });
      await wait(1500);
      const root = leaf.view.containerEl;
      const content = () => leaf.view.contentEl.querySelector('.cm-content').textContent;
      const tabEls = () => Array.from(root.querySelectorAll('.markdown-source-view .dr-page-tab'));
      const lines = () => Array.from(leaf.view.contentEl.querySelectorAll('.cm-line')).filter((l) => l.offsetHeight > 0).map((l) => l.textContent.trim()).filter(Boolean);
      const first = {
        tabs: tabEls().length,
        text: content(),
        height: root.querySelector('.markdown-source-view .dr-pages-capsule').offsetHeight,
        widthOpen: tabEls()[0].offsetWidth,
        firstLine: lines()[0],
      };
      tabEls()[1].click();
      await wait(1000);
      first.widthClosed = tabEls()[0].offsetWidth;
      first.slide = getComputedStyle(root.querySelector('.markdown-source-view .dr-pages-pill')).transitionDuration;
      const second = { firstLine: lines()[0], text: content(), open: root.querySelector('.markdown-source-view .dr-page-tab.is-open .dr-page-name').textContent };
      await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'preview' }, active: true });
      await wait(1800);
      const reading = Array.from(leaf.view.containerEl.querySelectorAll('.markdown-preview-sizer [data-dr-line]')).map((el) => [el.textContent.trim(), el.classList.contains('dr-page-off'), el.offsetHeight]);
      leaf.detach();
      await app.vault.delete(file);
      return { first, second, reading };
    });
    expect(result.first.tabs).toBe(2);
    expect(result.first.height).toBe(32);
    expect(result.first.widthClosed).toBe(result.first.widthOpen);
    expect(result.first.firstLine).toBe('Alpha text');
    expect(result.second.firstLine).toBe('Beta text');
    expect(result.first.slide).toContain('0.22s');
    expect(result.first.text).toContain('Alpha text');
    expect(result.first.text).not.toContain('Beta text');
    expect(result.second.open).toBe('Sources');
    expect(result.second.text).toContain('Beta text');
    expect(result.second.text).not.toContain('Alpha text');
    expect(result.reading.find((r) => r[0].includes('Alpha text'))[1]).toBe(true);
    expect(result.reading.find((r) => r[0].includes('Alpha text'))[2]).toBe(0);
    expect(result.reading.find((r) => r[0].includes('Beta text'))[1]).toBe(false);
  });

  it('draws the page control as a segmented control, in light and dark', async function () {
    await browser.executeObsidian(async ({ app }) => {
      if (!app.vault.getFolderByPath('Look')) await app.vault.createFolder('Look');
      const old = app.vault.getFileByPath('Look/Parliamentary sovereignty.md');
      if (old) await app.vault.delete(old);
      const file = await app.vault.create('Look/Parliamentary sovereignty.md', '---\npages:\n  Argument: { icon: network }\n---\n%%page: Overview%%\nProse, read as it is. Parliament can make or unmake any law.\n\n%%page: Sources%%\n| Title | Year |\n| --- | --- |\n| Law of the Constitution | 1885 |\n\n%%page: Argument%%\n- Parliament is sovereign\n');
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file, { state: { mode: 'source', source: false } });
      await new Promise((r) => setTimeout(r, 1500));
    });
    await shot('page-control-light');
    await browser.executeObsidian(({ app }) => app.changeTheme && app.changeTheme('obsidian'));
    await browser.pause(800);
    await shot('page-control-dark');
    const ok = await browser.executeObsidian(async ({ app }) => {
      if (app.changeTheme) app.changeTheme('moonstone');
      const root = app.workspace.activeLeaf.view.containerEl;
      const tabs = Array.from(root.querySelectorAll('.markdown-source-view .dr-page-tab'));
      const widths = tabs.map((t) => t.offsetWidth);
      // A theme with a serif face: the control and the title stay in the system's.
      document.body.style.setProperty('--font-interface', 'Georgia, serif');
      document.body.style.setProperty('--inline-title-font', 'Georgia, serif');
      const title = root.querySelector('.markdown-source-view .inline-title');
      const faces = [getComputedStyle(tabs[0]).fontFamily, title ? getComputedStyle(title).fontFamily : '-apple-system'].map((f) => f.startsWith('-apple-system'));
      document.body.style.removeProperty('--font-interface');
      document.body.style.removeProperty('--inline-title-font');
      // The open page always shows its thumb: the measured pill, or worn by the page itself.
      const open = root.querySelector('.markdown-source-view .dr-page-tab.is-open');
      const pill = root.querySelector('.markdown-source-view .dr-pages-pill.is-set');
      const thumb = (!!pill && pill.offsetWidth === open.offsetWidth) || getComputedStyle(open).backgroundColor !== 'rgba(0, 0, 0, 0)';
      // Lined up with the title, not floating in the middle of the column.
      const bar = root.querySelector('.markdown-source-view .dr-pages-capsule');
      const aligned = !title || Math.abs(bar.getBoundingClientRect().left - title.getBoundingClientRect().left) <= 2;
      app.workspace.activeLeaf.detach();
      await app.vault.delete(app.vault.getFileByPath('Look/Parliamentary sovereignty.md'));
      return { count: tabs.length, equal: widths.every((w) => w === widths[0]), faces, thumb, aligned };
    });
    expect(ok).toEqual({ count: 3, equal: true, faces: [true, true], thumb: true, aligned: true });
  });

  it('draws the nine components to their measures, in light and dark', async function () {
    const measure = () =>
      browser.executeObsidian(async ({ app }) => {
        await new Promise((r) => setTimeout(r, 400));
        const box = document.body.createDiv({ cls: 'dr-settings dr-component-probe' });
        const icon = box.createDiv({ cls: 'dr-icon-button' });
        const main = box.createDiv({ cls: 'dr-text-button is-primary', text: 'Open' });
        const plain = box.createDiv({ cls: 'dr-text-button', text: 'Edit' });
        const seg = box.createDiv({ cls: 'dr-segmented' });
        seg.createDiv({ cls: 'dr-segment is-active', text: 'One' });
        seg.createDiv({ cls: 'dr-segment', text: 'Two' });
        const list = box.createDiv();
        const row = list.createDiv({ cls: 'dr-list-row' });
        row.createDiv({ cls: 'dr-list-row-cover' });
        row.createDiv({ cls: 'dr-list-row-text', text: 'A note' });
        const art = box.createDiv({ cls: 'dr-tile' }).createDiv({ cls: 'dr-tile-art' });
        const chip = box.createSpan({ cls: 'dr-chip', text: 'tag' });
        const sheet = box.createDiv({ cls: 'dr-sheet', text: 'Sheet' });
        const toggle = box.createDiv({ cls: 'checkbox-container' });
        const field = box.createEl('input', { type: 'text' });
        const cs = (el) => getComputedStyle(el);
        const out = {
          icon: [icon.offsetWidth, icon.offsetHeight, cs(icon).borderRadius],
          main: cs(main).backgroundColor !== 'rgba(0, 0, 0, 0)' && main.offsetHeight,
          plain: [cs(plain).backgroundColor, cs(plain).color === cs(document.body).getPropertyValue('--text-accent') || cs(plain).color !== cs(document.body).color],
          segmented: seg.offsetHeight,
          row: [row.offsetHeight >= 44, row.querySelector('.dr-list-row-cover').offsetWidth],
          tile: [cs(art).boxShadow, cs(art).borderTopWidth],
          chip: [chip.offsetHeight, cs(chip).borderTopWidth, cs(chip).fontSize],
          sheet: [cs(sheet).borderTopLeftRadius, cs(sheet).boxShadow !== 'none'],
          toggle: [toggle.offsetWidth, toggle.offsetHeight],
          // A hairline: Chromium snaps 0.5px to one device pixel.
          field: [field.offsetHeight, parseFloat(cs(field).borderTopWidth) > 0 && parseFloat(cs(field).borderTopWidth) * devicePixelRatio <= 1, cs(field).boxShadow],
        };
        box.remove();
        return out;
      });
    const expected = {
      icon: [32, 32, '50%'],
      main: 32,
      plain: ['rgba(0, 0, 0, 0)', true],
      segmented: 32,
      row: [true, 36],
      tile: ['none', '0px'],
      chip: [24, '0px', '13px'],
      sheet: ['12px', true],
      toggle: [51, 31],
      field: [32, true, 'none'],
    };
    await browser.executeObsidian(({ app }) => app.changeTheme && app.changeTheme('moonstone'));
    expect(await measure()).toEqual(expected);
    await browser.executeObsidian(({ app }) => app.changeTheme && app.changeTheme('obsidian'));
    const dark = await measure();
    await browser.executeObsidian(({ app }) => app.changeTheme && app.changeTheme('moonstone'));
    expect(dark).toEqual(expected);
  });

  it('adds a page to a plain note in one step and names it where it stands', async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const old = app.vault.getFileByPath('Plain note.md');
      if (old) await app.vault.delete(old);
      const file = await app.vault.create('Plain note.md', 'Some words\n');
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file, { state: { mode: 'source', source: false } });
      await wait(1000);
      const before = leaf.view.containerEl.querySelectorAll('.dr-pages').length;
      app.workspace.setActiveLeaf(leaf, { focus: true });
      app.commands.executeCommandById('design-redux:add-page');
      let el = null;
      for (let i = 0; i < 40 && !el; i++) {
        await wait(100);
        el = leaf.view.containerEl.querySelector('.markdown-source-view .dr-page-name.is-editing');
      }
      const editing = !!el;
      if (el) {
        el.textContent = 'Sources';
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }
      await wait(1200);
      const text = await app.vault.read(file);
      const names = Array.from(leaf.view.containerEl.querySelectorAll('.markdown-source-view .dr-page-name')).map((n) => n.textContent);
      leaf.detach();
      await app.vault.delete(file);
      return { before, editing, text, names };
    });
    expect(result.before).toBe(0);
    expect(result.editing).toBe(true);
    expect(result.text).toContain('%%page: Untitled%%\nSome words');
    expect(result.text).toContain('%%page: Sources%%');
    expect(result.names).toEqual(['Untitled', 'Sources']);
  });

  it('gives notes an Apple-style look in type and spacing only, keeps room under them for the strip, and keeps the header in order', async function () {
    const result = await browser.executeObsidian(async ({ app, plugins }) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const mine = plugins.designRedux;
      if (!app.vault.getFolderByPath('Look')) await app.vault.createFolder('Look');
      const old = app.vault.getFileByPath('Look/Look note.md');
      if (old) await app.vault.delete(old);
      const file = await app.vault.create('Look/Look note.md', '---\ntype: test\nstatus: draft\n---\n%%page: One%%\n# Heading\n\nBody words here.\n\n---\n\n- an item\n\n%%page: Two%%\nOther\n');
      mine.settings.notePageChips = true;
      mine.settings.look = 'apple';
      await mine.saveSettings();
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file, { state: { mode: 'preview' } });
      await wait(1800);
      const css = (el, props) => {
        const c = getComputedStyle(el);
        return props.map((p) => c[p]).join('|');
      };
      const root = () => leaf.view.containerEl.querySelector('.markdown-preview-view');
      const typeOf = () => ['h1', 'p', 'li'].map((t) => {
        const el = root().querySelector(t);
        return el ? css(el, ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'marginTop', 'marginBottom']) : '';
      });
      const colours = () => ['h1', 'p', 'li', '.inline-title', '.dr-note-meta'].map((t) => {
        const el = leaf.view.containerEl.querySelector('.markdown-preview-view ' + t);
        return el ? css(el, ['color', 'backgroundColor', 'borderTopColor']) : '';
      });
      const apple = {
        title: css(leaf.view.containerEl.querySelector('.markdown-preview-view .inline-title'), ['fontSize', 'fontWeight']),
        body: css(root().querySelector('p'), ['fontSize', 'lineHeight']),
        column: root().querySelector('.markdown-preview-sizer').getBoundingClientRect().width,
        rule: getComputedStyle(root().querySelector('hr')).borderTopWidth,
        weights: ['p', 'li', '.inline-title', 'h1'].map((t) => {
          const el = leaf.view.containerEl.querySelector('.markdown-preview-view ' + t);
          return el ? t + ':' + getComputedStyle(el).fontWeight + ':' + getComputedStyle(el).webkitFontSmoothing : t + ':none';
        }),
        order: Array.from(leaf.view.containerEl.querySelectorAll('.markdown-preview-view .dr-note-album, .markdown-preview-view .inline-title, .markdown-preview-view .dr-note-chips, .markdown-preview-view .dr-note-rule')).map((el) => el.className.split(' ')[0]),
        colours: colours(),
        type: typeOf(),
      };
      const strip = document.querySelector('.dr-strip');
      const room = { strip: strip ? strip.offsetHeight : 0, reading: parseFloat(getComputedStyle(root()).paddingBottom) };
      // The theme's look: none of it applies, and it is as with the plugin off.
      mine.settings.look = 'theme';
      await mine.saveSettings();
      await wait(600);
      const theme = { colours: colours(), type: typeOf() };
      await app.plugins.disablePlugin('design-redux');
      await wait(1500);
      const without = typeOf();
      await app.plugins.enablePlugin('design-redux');
      await wait(1500);
      const again = app.plugins.plugins['design-redux'];
      again.settings.look = 'apple';
      again.settings.notePageChips = false;
      await again.saveSettings();
      leaf.detach();
      await app.vault.delete(file);
      return { apple, theme, without, room };
    });
    expect(result.apple.weights).toEqual(['p:400:antialiased', 'li:400:antialiased', '.inline-title:700:antialiased', 'h1:700:antialiased']);
    expect(result.apple.title).toBe('34px|700');
    expect(result.apple.body).toBe('17px|25.5px');
    expect(result.apple.column).toBeLessThanOrEqual(680);
    expect(result.apple.rule).toBe('1px');
    expect(result.apple.order).toEqual(['dr-note-album', 'inline-title', 'dr-note-chips', 'dr-note-rule']);
    expect(result.apple.colours).toEqual(result.theme.colours);
    expect(result.apple.type).not.toEqual(result.theme.type);
    expect(result.theme.type).toEqual(result.without);
    expect(result.room.reading).toBeGreaterThanOrEqual(result.room.strip + 24);
  });

  it('draws the right sidebar on one edge, in one font, with no boxes or lines between its parts', async function () {
    const prepare = (theme) => browser.executeObsidian(async ({ app, plugins }, theme) => {
      if (typeof app.changeTheme === 'function') app.changeTheme(theme);
      const path = 'Politics/Canada’s Federal parliamentary constitutional monarchy.md';
      if (!app.vault.getFileByPath(path)) {
        await app.vault.create(path, '---\nparent:\n  - "[[Parliamentary system]]"\n  - "[[Federalism]]"\n  - "[[Constitutional monarchy]]"\ndomain:\nstatus:\n---\nText.\n');
      }
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      const plugin = plugins.designRedux;
      plugin.settings.panelPropertiesView = 'all';
      await plugin.features.find((f) => f.constructor.name === 'Library').browseMode({ mode: 'folder', path: 'Politics' });
      const page = app.workspace.activeLeaf;
      const row = () => page.view.containerEl.querySelector(`.dr-track[data-path="${path}"]`);
      await until(() => !!row() && !!page.view.containerEl.querySelector('.dr-preview-btn'));
      if (!page.view.previewOn()) page.view.containerEl.querySelector('.dr-preview-btn').click();
      await until(() => page.view.previewOn());
      plugin.selection.set(null);
      await new Promise((r) => setTimeout(r, 100));
      row().click();
      const dock = () => app.workspace.getLeavesOfType('design-redux-properties')[0];
      await until(() => !!dock() && !!dock().view.containerEl.querySelector('.dr-rows .dr-value'));
      await new Promise((r) => setTimeout(r, 400));
    }, theme);
    try {
    await prepare('obsidian');
    const look = await browser.execute(() => {
      const dock = document.querySelector('.dr-panel-dock');
      // Where its words start, not only its box.
      const left = (sel) => {
        const el = dock.querySelector(sel);
        if (!el) return null;
        const range = document.createRange();
        range.selectNodeContents(el);
        const first = Array.from(range.getClientRects()).filter((r) => r.width > 0)[0] || el.getBoundingClientRect();
        return Math.round(first.left);
      };
      const css = (sel) => { const el = dock.querySelector(sel); return el ? getComputedStyle(el) : null; };
      const edges = ['.dr-panel-dock-origin', '.dr-props-art', '.dr-preview-actions', '.dr-section .dr-props-title', '.dr-key-name', '.dr-section-title'].map(left).filter((x) => x !== null);
      const font = (sel) => css(sel) && css(sel).fontFamily;
      const rows = css('.dr-rows');
      return {
        edge: new Set(edges).size,
        fonts: new Set(['.dr-panel-dock-origin', '.dr-props-title', '.dr-key', '.dr-section-title', '.dr-mention-group'].map(font).filter(Boolean)).size,
        box: [rows.backgroundColor, rows.borderRadius],
        lines: Array.from(dock.querySelectorAll('.dr-section, .dr-row, .dr-preview-actions, .dr-props-head')).filter((el) => parseFloat(getComputedStyle(el).borderTopWidth) > 0 || parseFloat(getComputedStyle(el).borderBottomWidth) > 0).length,
        valueAlign: css('.dr-value .multi-select-container') ? css('.dr-value .multi-select-container').justifyContent : 'none',
        pills: Array.from(dock.querySelectorAll('.dr-value .multi-select-pill')).map((p) => p.textContent.trim()),
        action: css('.dr-preview-actions .dr-detail-action').color === css('.dr-props-title').color,
        titleWhole: dock.querySelector('.dr-props-title').scrollHeight <= dock.querySelector('.dr-props-title').clientHeight + 1,
        handle: css('.dr-key-icon').display !== 'none' && dock.querySelector('.dr-key-icon').getBoundingClientRect().right <= dock.querySelector('.dr-key-name').getBoundingClientRect().left,
      };
    });
    expect(look).toEqual({ edge: 1, fonts: 1, box: ['rgba(0, 0, 0, 0)', '0px'], lines: 0, valueAlign: 'flex-start', action: true, titleWhole: true, handle: true, pills: ['Parliamentary system', 'Federalism', 'Constitutional monarchy'] });
    await shot('right-sidebar-dark');
    await prepare('moonstone');
    await shot('right-sidebar-light');
    } finally {
      await browser.executeObsidian(async ({ app, plugins }) => {
        plugins.designRedux.settings.panelPropertiesView = 'compact';
        if (typeof app.changeTheme === 'function') app.changeTheme('obsidian');
        const file = app.vault.getFileByPath('Politics/Canada’s Federal parliamentary constitutional monarchy.md');
        if (file) await app.vault.delete(file);
      });
    }
  });

  it('shows a note picked in an album in the inspector, and opens it on a double click', async function () {
    const result = await browser.executeObsidian(async ({ app, plugins }) => {
      const plugin = plugins.designRedux;
      const find = (name) => plugin.features.find((f) => f.constructor.name === name);
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
      await find('Library').browseMode({ mode: 'folder', path: 'Politics' });
      const page = app.workspace.activeLeaf;
      const el = () => page.view.containerEl;
      const row = () => el().querySelector('.dr-track[data-path="Politics/Anarchy.md"]');
      await until(() => !!row() && !!el().querySelector('.dr-preview-btn'));
      el().querySelector('.dr-preview-btn').click();
      const dock = () => app.workspace.getLeavesOfType('design-redux-properties')[0];
      // In sight, not only open: until then a click opens rather than picks.
      await until(() => !!dock() && !!row() && page.view.previewOn());
      row().click();
      const title = () => { const t = dock() && dock().view.containerEl.querySelector('.dr-props-popup.is-open .dr-props-title'); return t ? t.textContent : ''; };
      await until(() => title() === 'Anarchy');
      const actions = Array.from(dock().view.containerEl.querySelectorAll('.dr-detail-action')).map((b) => b.textContent.trim());
      return { title: title(), still: page.view.getViewType(), marked: row().classList.contains('is-selected'), right: dock().getRoot() === app.workspace.rightSplit, open: actions.includes('Open') };
    });
    expect(result).toEqual({ title: 'Anarchy', still: 'design-redux-browse', marked: true, right: true, open: true });
    await shot('inspector-picked');
    const opened = await browser.executeObsidian(async ({ app, plugins }) => {
      const plugin = plugins.designRedux;
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
      const row = app.workspace.activeLeaf.view.containerEl.querySelector('.dr-track[data-path="Politics/Anarchy.md"]');
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const active = () => { const f = app.workspace.getActiveFile(); return f ? f.basename : null; };
      await until(() => active() === 'Anarchy');
      // Closed again, for the tests after.
      app.workspace.detachLeavesOfType('design-redux-properties');
      plugin.selection.clear();
      return active();
    });
    expect(opened).toBe('Anarchy');
  });

  it('times a shelf of 50 and of 500 albums, and the sidebar beside them', async function () {
    // A baseline, not a check: a folder of albums, each with one note.
    this.timeout(300000);
    const made = [];
    for (const n of [50, 500]) {
      const root = `Bench ${n} albums`;
      made.push(root);
      await browser.executeObsidian(async ({ app }, n, root) => {
        if (!app.vault.getFolderByPath(root)) await app.vault.createFolder(root);
        for (let i = 0; i < n; i++) {
          const dir = `${root}/Album ${i}`;
          if (!app.vault.getFolderByPath(dir)) await app.vault.createFolder(dir);
          if (!app.vault.getFileByPath(`${dir}/Note.md`)) await app.vault.create(`${dir}/Note.md`, 'A note.');
        }
      }, n, root);
      const times = await browser.executeObsidian(async ({ app, plugins }, root) => {
        const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
        await library.browseMode({ mode: 'folder', path: root });
        if (typeof library.reveal === 'function') await library.reveal();
        const leaf = app.workspace.getLeavesOfType('design-redux-browse').find((l) => l.view && l.view.path === root);
        const time = (fn) => {
          const started = performance.now();
          fn();
          return Math.round(performance.now() - started);
        };
        const shelf = leaf ? time(() => leaf.view.render()) : null;
        const side = app.workspace.getLeavesOfType('design-redux-library')[0];
        const sidebar = side && side.view && typeof side.view.render === 'function' ? time(() => side.view.render()) : null;
        const parts = side && side.view && side.view.lastTimes;
        const round = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' && v >= 1).map(([k, v]) => [k, Math.round(v)]));
        return { shelf, sidebar, parts: parts ? JSON.stringify(Object.assign(round(parts), { items: round(parts.items) })) : '' };
      }, root);
      perf.push(`perf: shelf of ${n} albums: drawn ${times.shelf} ms, the sidebar ${times.sidebar} ms ${times.parts}`);
    }
    await browser.executeObsidian(async ({ app }, roots) => {
      for (const root of roots) {
        const folder = app.vault.getFolderByPath(root);
        if (folder) await app.vault.delete(folder, true);
      }
    }, made);
  });

  it('opens a folder in a note’s path at the top as its collection in the library', async function () {
    await obsidianPage.openFile('Politics/Deterrence.md');
    const crumb = await browser.$(ACTIVE + '.view-header-title-parent .view-header-breadcrumb');
    await crumb.waitForExist({ timeout: 5000 });
    await crumb.click();
    const shown = await readUntil(
      () => browser.executeObsidian(({ app }) => {
        const v = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
        return v && v.getViewType() === 'design-redux-browse' ? `${v.mode}:${v.path}` : null;
      }),
      (s) => s === 'folder:Politics'
    );
    expect(shown).toBe('folder:Politics');
  });

  it('opens a note with its album above its title, a grey line under it, and shelves at its end, editing and reading', async function () {
    await browser.executeObsidian(async ({ app }) => {
      if (!app.vault.getFolderByPath('Page album')) await app.vault.createFolder('Page album');
      for (const [path, text] of [
        ['Page album/Judicial review.md', 'Courts check power. See [[Page album/Standing]].'],
        ['Page album/Standing.md', '---\nparent: "[[Judicial review]]"\n---\nWho may sue. Back to [[Page album/Judicial review]].'],
      ]) {
        const old = app.vault.getFileByPath(path);
        if (old) await app.vault.delete(old);
        await app.vault.create(path, text);
      }
    });
    await obsidianPage.openFile('Page album/Standing.md');
    const look = () =>
      browser.executeObsidian(({ app }) => {
        const view = app.workspace.activeLeaf.view;
        const root = view.containerEl.querySelector(view.getMode() === 'preview' ? '.markdown-reading-view' : '.markdown-source-view');
        const album = root.querySelector('.dr-note-album');
        const title = root.querySelector('.inline-title');
        const meta = root.querySelector('.dr-note-meta');
        return {
          album: album ? album.textContent : null,
          above: !!album && !!title && album.nextElementSibling === title,
          meta: meta ? meta.textContent : null,
          shelves: Array.from(root.querySelectorAll('.dr-note-shelf-head')).map((h) => h.textContent),
        };
      });
    // The link shelves come once Obsidian has the links: all three, not the first drawn.
    await browser.waitUntil(async () => (await look()).shelves.length >= 3, { timeout: 5000, timeoutMsg: 'the note page was never drawn with its shelves' });
    let now = await look();
    expect(now.album).toBe('Page album');
    expect(now.above).toBe(true);
    expect(now.meta.startsWith('Under Judicial review')).toBe(true);
    expect(now.shelves).toEqual(['Linked from here ›', 'Mentioned in ›', 'More in Page album ›']);
    // Reading: the same.
    await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.activeLeaf;
      await leaf.setViewState({ type: 'markdown', state: Object.assign({}, leaf.getViewState().state, { mode: 'preview' }) });
    });
    await browser.waitUntil(async () => (await look()).shelves.length > 0, { timeout: 5000, timeoutMsg: 'not drawn in reading view' });
    now = await look();
    expect(now.album).toBe('Page album');
    expect(now.shelves.length).toBe(3);
    await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.activeLeaf;
      await leaf.setViewState({ type: 'markdown', state: Object.assign({}, leaf.getViewState().state, { mode: 'source' }) });
      // Its notes gone again, so later tests count the vault as it was.
      const folder = app.vault.getFolderByPath('Page album');
      if (folder) await app.vault.delete(folder, true);
    });
  });

  it('offers Undo after a move, and it puts the note back', async function () {
    await browser.executeObsidian(async ({ app, plugins }) => {
      const file = app.vault.getFileByPath('Politics/Deterrence.md');
      await plugins.designRedux.moveFile(file, 'Politics/Theories', { announce: true });
    });
    const undo = await browser.$('.notice .dr-undo');
    await undo.waitForExist({ timeout: 5000 });
    await shot('undo-notice');
    await undo.click();
    await browser.pause(800);
    const back = await browser.executeObsidian(({ app }) => !!app.vault.getFileByPath('Politics/Deterrence.md'));
    expect(back).toBe(true);
  });

  it('reports what works on this version, and copies diagnostics', async function () {
    const report = await browser.executeObsidian(({ plugins }) => {
      const d = plugins.designRedux.features.find((f) => f.constructor.name === 'Diagnostics');
      return d.report();
    });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${version}-diagnostics.txt`), report);
    expect(report).toContain('Design Redux');
    expect(report).toContain(`Obsidian ${version}`);
    expect(report).not.toContain('✗');
  });

  it('puts « » either side of the note in the strip', async function () {
    await obsidianPage.openFile('Politics/Balance of power.md');
    await browser.$('.dr-strip .dr-strip-center').waitForExist({ timeout: 10000 });
    const skips = await browser.$$('.dr-strip-center .dr-strip-skip');
    expect(skips.length).toBe(2);
    // With its properties open over it: the popup is judged from this.
    await browser.executeObsidianCommand('design-redux:open-properties');
    await browser.$('.dr-props-popup.is-open .dr-props-head').waitForExist({ timeout: 5000 });
    await shot('note-and-strip');
    await browser.executeObsidian(({ app }) => app.workspace.detachLeavesOfType('design-redux-properties'));

    // What this version draws for the note's own properties, which the
    // Properties panel setting hides.
    const facts = await browser.execute(() => {
      const chain = (el) => {
        const out = [];
        for (let at = el, i = 0; at && i < 8; at = at.parentElement, i++) {
          out.push(`${at.tagName.toLowerCase()}.${String(at.className).trim().replace(/\s+/g, '.')}`);
        }
        return out;
      };
      const add = Array.from(document.querySelectorAll('.workspace-leaf.mod-active *')).find(
        (e) => e.children.length === 0 && e.textContent.trim() === 'Add property'
      );
      const box = document.querySelector('.workspace-leaf.mod-active .metadata-container');
      return {
        style: box ? box.getAttribute('style') : null,
        leafType: box && box.closest('.workspace-leaf-content') ? box.closest('.workspace-leaf-content').dataset.type : null,
        inRootSplit: !!(box && box.closest('.workspace-split.mod-root')),
        bodyHasPanelClass: document.body.classList.contains('dr-props-active'),
        metadataContainers: Array.from(document.querySelectorAll('.workspace-leaf.mod-active .metadata-container')).map((e) => [
          e.className,
          getComputedStyle(e).display,
        ]),
        addPropertyChain: add ? chain(add) : null,
      };
    });
    fs.writeFileSync(path.join(OUT, `${version}-properties-facts.json`), JSON.stringify(facts, null, 2));
    // With the note's own properties hidden while the panel shows them (put on in before), the block is hidden.
    expect(facts.metadataContainers.map((m) => m[1])).toEqual(['none']);
  });

  it('draws Home with its shelves', async function () {
    await browser.executeObsidian(async ({ plugins }) => {
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'home' });
    });
    await browser.$('.dr-shelf-row .dr-card').waitForExist({ timeout: 10000 });
    await shot('home');
  });

  it('lays out the library the Apple way: shelf titles at 22px, covers 16px apart, an album with one filled button, a header that stays', async function () {
    const browse = (state) =>
      browser.executeObsidian(async ({ plugins }, state) => {
        const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
        await library.browseMode(state);
      }, state);
    const read = (fn) => browser.execute(fn);
    await browse({ mode: 'home' });
    await browser.$(ACTIVE + '.dr-shelf-row .dr-card').waitForExist({ timeout: 10000 });
    const home = await read(() => {
      const page = document.querySelector('.workspace-leaf.mod-active .dr-browse');
      const row = page.querySelector('.dr-shelf-row');
      return { shelf: getComputedStyle(page.querySelector('.dr-shelf-title')).fontSize, gap: getComputedStyle(row).columnGap, scrolls: getComputedStyle(row).overflowX };
    });
    expect(home).toEqual({ shelf: '22px', gap: '16px', scrolls: 'auto' });
    await browse({ mode: 'folder', path: 'Politics' });
    await browser.$(ACTIVE + '.dr-detail-actions').waitForExist({ timeout: 10000 });
    const album = await read(() => {
      const page = document.querySelector('.workspace-leaf.mod-active .dr-browse');
      const more = page.querySelector('.dr-detail-more');
      return {
        art: page.querySelector('.dr-detail-art').offsetWidth <= 240,
        filled: page.querySelectorAll('.dr-detail-actions .is-primary').length,
        more: more ? [more.getAttribute('aria-label'), more.offsetWidth, more.textContent] : null,
      };
    });
    expect(album).toEqual({ art: true, filled: 1, more: ['More', 32, ''] });
    await browse({ mode: 'notes' });
    const head = await readUntil(
      () => read(() => {
        const th = document.querySelector('.workspace-leaf.mod-active .dr-th');
        return th ? getComputedStyle(th).position : null;
      }),
      (p) => p !== null
    );
    expect(head).toBe('sticky');
  });

  after(async function () {
    const errors = await browser.executeObsidian(() => window.__drErrors || []);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${version}-errors.txt`), errors.join('\n\n') || 'none');
  });

  it('draws graph links through the notes between, and lights the routes on hover', async function () {
    const setUp = await browser.executeObsidian(async ({ app }) => {
      if (!app.vault.getAbstractFileByPath('Routes')) await app.vault.createFolder('Routes');
      const notes = {
        'Routes/Westminster system.md': '[[Ministerial responsibility]], [[Individual responsibility]] and [[Collective responsibility]].',
        'Routes/Ministerial responsibility.md': '[[Individual responsibility]] and [[Collective responsibility]].',
        'Routes/Individual responsibility.md': 'Can end in [[Resignation]].',
        'Routes/Collective responsibility.md': 'Cabinet speaks as one.',
        'Routes/Resignation.md': 'Going.',
      };
      for (const [p, text] of Object.entries(notes)) await app.vault.create(p, text);
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      // Read once the last note's link is counted; drawn once the graph has its lines.
      await until(() => (app.metadataCache.resolvedLinks['Routes/Individual responsibility.md'] || {})['Routes/Resignation.md']);
      app.commands.executeCommandById('graph:open');
      const graph = () => { const l = app.workspace.getLeavesOfType('graph')[0]; return l && l.view; };
      await until(() => {
        const g = graph();
        return g && g.renderer && g.renderer.links.some((l) => l.source.id === 'Routes/Westminster system.md') &&
          g.dataEngine && g.dataEngine.displayOptions.childrenEl.querySelector('.dr-graph-routes');
      });
      const view = app.workspace.getLeavesOfType('graph')[0].view;
      const rows = view.dataEngine.displayOptions.childrenEl;
      const row = rows.querySelector('.dr-graph-routes');
      // Filters starts folded, with its search field out of the page;
      // the Properties section finds it all the same.
      const filters = app.plugins.plugins['design-redux'].features.find((f) => f.constructor.name === 'GraphPropertyFilter');
      const leaf = app.workspace.getLeavesOfType('graph')[0];
      const controls = view.containerEl.querySelector('.graph-controls');
      return {
        switch: !!row,
        besideArrows: !!row && !!row.previousElementSibling && row.previousElementSibling.matches('.setting-item.mod-toggle'),
        filtersFolded: !controls.querySelector('.mod-filter input'),
        searchFound: !!filters.filterInput(controls, leaf),
        noWarning: !view.containerEl.querySelector('.dr-graph-props .dr-gp-note'),
      };
    });
    expect(setUp).toEqual({ switch: true, besideArrows: true, filtersFolded: true, searchFound: true, noWarning: true });

    const W = 'Routes/Westminster system.md';
    const M = 'Routes/Ministerial responsibility.md';
    const I = 'Routes/Individual responsibility.md';
    const C = 'Routes/Collective responsibility.md';
    const R = 'Routes/Resignation.md';

    const drawn = await browser.executeObsidian(async ({ app }, names) => {
      const view = app.workspace.getLeavesOfType('graph')[0].view;
      // Settings open, Display unfolded, and the switch clicked.
      view.dataEngine.controlsEl.removeClass('is-close');
      await view.dataEngine.displayOptions.setCollapsed(false, false);
      const row = view.dataEngine.displayOptions.childrenEl.querySelector('.dr-graph-routes');
      row.querySelector('.checkbox-container').click();
      const has = (a, b) => view.renderer.links.some((l) => l.source.id === a && l.target.id === b);
      const [W, M, I, C] = names;
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => has(W, M) && has(M, I) && !has(W, I));
      return {
        saved: !!app.plugins.plugins['design-redux'].settings.graphRouting.graph,
        straight: [has(W, I), has(W, C)],
        routed: [has(W, M), has(M, I), has(M, C)],
      };
    }, [W, M, I, C]);
    expect(drawn).toEqual({ saved: true, straight: [false, false], routed: [true, true, true] });

    // Hovered, as the pointer would: Obsidian's own drawing fades what's
    // not linked to 0.2 and brings what is up to full.
    const lit = await browser.executeObsidian(async ({ app }, names) => {
      const [W, M, I, C, R] = names;
      const view = app.workspace.getLeavesOfType('graph')[0].view;
      const r = view.renderer;
      const hover = async (id) => {
        r.highlightNode = r.nodeLookup[id];
        for (let i = 0; i < 90; i++) {
          r.changed();
          await new Promise((res) => requestAnimationFrame(res));
        }
      };
      const line = (a, b) => r.links.find((l) => l.source.id === a && l.target.id === b);
      const alpha = (link) => (link && link.line ? Math.round(link.line.alpha * 10) / 10 : null);
      const fade = (id) => Math.round(r.nodeLookup[id].fadeAlpha * 10) / 10;
      await hover(W);
      const fromWestminster = {
        notes: [M, I, C, R].map(fade),
        lines: [alpha(line(M, I)), alpha(line(M, C)), alpha(line(I, R))],
      };
      await hover(C);
      const fromCollective = { notes: [W, M, I].map(fade), lines: [alpha(line(W, M)), alpha(line(M, I))] };
      await hover(W);
      return { fromWestminster, fromCollective };
    }, [W, M, I, C, R]);
    await shot('graph-routes');
    const full = (n) => n >= 0.9;
    expect(lit.fromWestminster.notes.map(full)).toEqual([true, true, true, false]);
    expect(lit.fromWestminster.lines.map((a) => a !== null && a > 0.5)).toEqual([true, true, false]);
    expect(lit.fromCollective.notes.map(full)).toEqual([true, true, false]);
    expect(lit.fromCollective.lines.map((a) => a !== null && a > 0.5)).toEqual([true, false]);

    // Off again, from the command: every line straight across.
    const off = await browser.executeObsidian(async ({ app }, names) => {
      const [W, M, I, C] = names;
      const leaf = app.workspace.getLeavesOfType('graph')[0];
      app.workspace.setActiveLeaf(leaf, { focus: true });
      app.commands.executeCommandById('design-redux:toggle-graph-routes');
      const r = leaf.view.renderer;
      r.highlightNode = null;
      const has = (a, b) => r.links.some((l) => l.source.id === a && l.target.id === b);
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => has(W, I) && has(W, C));
      const result = {
        saved: !!app.plugins.plugins['design-redux'].settings.graphRouting.graph,
        straight: [has(W, I), has(W, C)],
        switchShows: leaf.view.dataEngine.displayOptions.childrenEl.querySelector('.dr-graph-routes .checkbox-container').classList.contains('is-enabled'),
        leftBehind: !!r.drRoutes || r.nodes.some((n) => Object.prototype.hasOwnProperty.call(n, 'render')),
      };
      leaf.detach();
      const folder = app.vault.getAbstractFileByPath('Routes');
      if (folder) await app.vault.delete(folder, true);
      return result;
    }, [W, M, I, C]);
    expect(off).toEqual({ saved: false, straight: [true, true], switchShows: false, leftBehind: false });
  });

  it('adds a footnote in place from a box at the cursor, keeping numbers in order', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = await app.vault.create(
        'Footnotes.md',
        'Parliament is sovereign.[^1] It can make any law. No court may set one aside.[^2]\n\n[^1]: Dicey, 38.\n[^2]: Dicey, 40.\n'
      );
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file, { state: { mode: 'source' } });
      await new Promise((r) => setTimeout(r, 800));
      const editor = leaf.view.editor;
      editor.focus();
      editor.setCursor(editor.offsetToPos(editor.getValue().indexOf(' No court')));
    });
    await browser.executeObsidianCommand('design-redux:add-footnote');
    const box = await browser.$('.dr-fn-box');
    await box.waitForExist({ timeout: 5000 });
    expect(await browser.$('.dr-fn-box .dr-fn-num').getText()).toBe('2');
    await browser.keys('Bagehot, 12.'.split(''));
    await shot('footnote-box');
    await browser.keys('Enter');
    await browser.pause(400);

    const added = await browser.executeObsidian(({ app }) => {
      const editor = app.workspace.getMostRecentLeaf().view.editor;
      const text = editor.getValue();
      return {
        boxGone: !document.querySelector('.dr-fn-box'),
        text,
        before: text.slice(0, editor.posToOffset(editor.getCursor())),
      };
    });
    expect(added).toEqual({
      boxGone: true,
      text:
        'Parliament is sovereign.[^1] It can make any law.[^2] No court may set one aside.[^3]\n\n[^1]: Dicey, 38.\n[^2]: Bagehot, 12.\n[^3]: Dicey, 40.\n',
      before: 'Parliament is sovereign.[^1] It can make any law.[^2]',
    });

    // On a footnote, the editor's menu offers to change it; the box shows its citation.
    const onOne = await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getMostRecentLeaf().view;
      const editor = view.editor;
      editor.setCursor(editor.offsetToPos(editor.getValue().indexOf('[^3]') + 2));
      const menu = new obsidian.Menu();
      app.workspace.trigger('editor-menu', menu, editor, view);
      const titles = menu.items.map((i) => (i.titleEl ? i.titleEl.textContent : '')).filter(Boolean);
      menu.hide && menu.hide();
      return titles;
    });
    expect(onOne).toContain('Change footnote');
    await browser.executeObsidianCommand('design-redux:add-footnote');
    await browser.$('.dr-fn-box').waitForExist({ timeout: 5000 });
    expect(await browser.execute(() => document.querySelector('.dr-fn-input').value)).toBe('Dicey, 40.');
    await browser.keys('Escape');
    await browser.pause(300);

    const tidied = await browser.executeObsidian(async ({ app }) => {
      const editor = app.workspace.getMostRecentLeaf().view.editor;
      editor.setValue('A.[^2] B.[^1]\n\n[^1]: One.\n[^2]: Two.\n[^3]: Spare.\n');
      app.commands.executeCommandById('design-redux:tidy-footnotes');
      await new Promise((r) => setTimeout(r, 300));
      const text = editor.getValue();
      const file = app.vault.getFileByPath('Footnotes.md');
      app.workspace.getMostRecentLeaf().detach();
      await new Promise((r) => setTimeout(r, 300));
      if (file) await app.vault.delete(file);
      return { boxGone: !document.querySelector('.dr-fn-box'), text };
    });
    expect(tidied).toEqual({ boxGone: true, text: 'A.[^1] B.[^2]\n\n[^1]: Two.\n[^2]: One.\n' });
  });

  it('keeps citations off the page and lists them in a Footnotes view', async function () {
    const page = await browser.executeObsidian(async ({ app }) => {
      const file = await app.vault.create(
        'Cited.md',
        'Parliament is sovereign.[^1] Courts defer to it.[^2]\n\n[^1]: Dicey, *Law of the Constitution*, 38.\n[^2]: Bagehot, 12.\n'
      );
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file, { state: { mode: 'source', source: false } });
      await new Promise((r) => setTimeout(r, 1200));
      const editor = leaf.view.editor;
      editor.setCursor({ line: 0, ch: 3 });
      await new Promise((r) => setTimeout(r, 400));
      const shown = leaf.view.contentEl.querySelector('.cm-content').textContent;
      return { citesShown: shown.includes('Dicey'), textShown: shown.includes('Parliament is sovereign') };
    });
    expect(page).toEqual({ citesShown: false, textShown: true });

    // The footnote button along the bottom opens the view — the strip has slid away while typing, and comes back at the pointer.
    await browser.execute(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: window.innerHeight - 10, bubbles: true })));
    await browser.pause(400);
    const button = await browser.$('.dr-strip-btn[data-action="footnotes"]');
    await button.waitForExist({ timeout: 5000 });
    expect(await button.getAttribute('aria-label')).toBe('Footnotes (2)');
    await button.click();
    await browser.$('.dr-fn-view .dr-fn-item').waitForExist({ timeout: 5000 });
    const listed = await browser.execute(() =>
      Array.from(document.querySelectorAll('.dr-fn-view .dr-fn-item')).map((i) => [
        i.querySelector('.dr-fn-num').textContent,
        i.querySelector('.dr-fn-item-body').textContent.trim(),
        i.querySelector('.dr-fn-where').textContent,
      ])
    );
    expect(listed).toEqual([
      ['1', 'Dicey, Law of the Constitution, 38.', '…Parliament is sovereign.'],
      ['2', 'Bagehot, 12.', '…Parliament is sovereign. Courts defer to it.'],
    ]);
    await shot('footnotes-view');

    // A footnote clicked in the view selects its number in the note.
    await browser.execute(() => document.querySelectorAll('.dr-fn-view .dr-fn-item')[1].click());
    await browser.pause(400);
    const selected = await browser.executeObsidian(({ app }) => {
      const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file && l.view.file.path === 'Cited.md');
      return leaf.view.editor.getSelection();
    });
    expect(selected).toBe('[^2]');

    // Reading view: the list out of sight too, and a number opens the view at it.
    const reading = await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file && l.view.file.path === 'Cited.md');
      await leaf.setViewState({ type: 'markdown', state: { file: 'Cited.md', mode: 'preview' } });
      await new Promise((r) => setTimeout(r, 1200));
      const root = leaf.view.containerEl.querySelector('.markdown-reading-view');
      const list = root.querySelector('.footnotes');
      const link = root.querySelector('sup.footnote-ref a, a.footnote-link');
      const out = { listHidden: !list || getComputedStyle(list).display === 'none', hasLink: !!link };
      if (link) link.click();
      await new Promise((r) => setTimeout(r, 600));
      out.highlighted = Array.from(document.querySelectorAll('.dr-fn-view .dr-fn-item.is-highlighted')).map((i) => i.dataset.label);
      for (const l of app.workspace.getLeavesOfType('design-redux-footnotes')) l.detach();
      leaf.detach();
      const file = app.vault.getFileByPath('Cited.md');
      if (file) await app.vault.delete(file);
      return out;
    });
    expect(reading).toEqual({ listHidden: true, hasLink: true, highlighted: ['1'] });
  });

  it('renames and merges properties from Edit on the Properties screen', async function () {
    await browser.executeObsidian(async ({ app, plugins }) => {
      await app.vault.createFolder('Merging');
      await app.vault.create('Merging/One.md', '---\narena: Law\n---\nOne.\n');
      await app.vault.create('Merging/Two.md', '---\narena: Law\nfield: Politics\n---\nTwo.\n');
      await app.vault.create('Merging/Three.md', '---\nfield: History\n---\nThree.\n');
      await new Promise((r) => setTimeout(r, 1200));
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'properties' });
    });
    const edit = await browser.$('.dr-bar-edit');
    await edit.waitForExist({ timeout: 10000 });
    await edit.click();
    await browser.$('.dr-split-row.is-editing').waitForExist({ timeout: 5000 });

    // A name changed in place, and Enter: renamed everywhere.
    const field = await browser.execute(() => {
      const input = Array.from(document.querySelectorAll('.dr-split-row.is-editing input.dr-edit-name')).find((i) => i.value === 'arena');
      if (input) input.dataset.test = 'arena';
      return !!input;
    });
    expect(field).toBe(true);
    const arena = await browser.$('input[data-test="arena"]');
    await arena.click();
    await browser.execute((el) => el.select(), arena);
    await browser.keys('venue'.split(''));
    await browser.keys('Enter');
    await browser.pause(1500);
    const renamed = await browser.executeObsidian(({ app }) => {
      const fm = (p) => (app.metadataCache.getFileCache(app.vault.getFileByPath(p)) || {}).frontmatter || {};
      return { one: fm('Merging/One.md').venue, two: fm('Merging/Two.md').venue, arenaLeft: 'arena' in fm('Merging/One.md') };
    });
    expect(renamed).toEqual({ one: 'Law', two: 'Law', arenaLeft: false });

    // Picked, and merged.
    await browser.execute(() => {
      Array.from(document.querySelectorAll('.dr-split-row.is-editing')).forEach((row) => {
        const input = row.querySelector('input.dr-edit-name');
        if (input && (input.value === 'venue' || input.value === 'field')) row.querySelector('.dr-prop-pick').click();
      });
    });
    await shot('properties-edit');
    const merge = await browser.$('.dr-prop-merge');
    expect(await merge.getText()).toBe('Merge 2…');
    await merge.click();
    const into = await browser.$('.dr-bulk-modal .dr-bulk-field input');
    await into.waitForExist({ timeout: 5000 });
    await browser.execute((el) => el.select(), into);
    await browser.keys('topic'.split(''));
    await browser.pause(400);
    await browser.execute(() => document.querySelector('.dr-bulk-modal .mod-cta').click());
    await browser.pause(1500);

    const merged = await browser.executeObsidian(async ({ app, plugins }) => {
      const fm = (p) => (app.metadataCache.getFileCache(app.vault.getFileByPath(p)) || {}).frontmatter || {};
      const result = {
        one: fm('Merging/One.md').topic,
        two: fm('Merging/Two.md').topic,
        three: fm('Merging/Three.md').topic,
        left: ['venue', 'field'].filter((k) => ['One', 'Two', 'Three'].some((n) => k in fm(`Merging/${n}.md`))),
      };
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      const view = app.workspace.getMostRecentLeaf().view;
      if (view && view.editing && typeof view.setEditing === 'function') view.setEditing(false);
      const folder = app.vault.getAbstractFileByPath('Merging');
      if (folder) await app.vault.delete(folder, true);
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      return result;
    });
    // Picked in the list's order, field before venue, so its value leads.
    expect(merged).toEqual({ one: 'Law', two: ['Politics', 'Law'], three: 'History', left: [] });
  });

  it('writes a property the same way in every note, where Obsidian lists it one way and notes another', async function () {
    await browser.executeObsidian(async ({ app, plugins }) => {
      // One note writes "parent", two "Parent". Obsidian lists it one way — the first met
      // until 1.14, the most used since — and the other is offered to be put right.
      await app.vault.createFolder('Spelling');
      await app.vault.create('Spelling/C.md', '---\nparent: "[[Home]]"\n---\nC\n');
      await new Promise((r) => setTimeout(r, 800));
      await app.vault.create('Spelling/A.md', '---\nParent: "[[Home]]"\n---\nA\n');
      await app.vault.create('Spelling/B.md', '---\nParent: "[[Home]]"\ntitle: b\n---\nB\n');
      await new Promise((r) => setTimeout(r, 1200));
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'properties' });
    });
    const edit = await browser.$('.dr-bar-edit');
    await edit.waitForExist({ timeout: 10000 });
    await edit.click();
    await browser.$('.dr-split-row.is-editing').waitForExist({ timeout: 5000 });
    const shown = await browser.execute(() => {
      const row = Array.from(document.querySelectorAll('.dr-split-row.is-editing')).find(
        (r) => r.querySelector('input.dr-edit-name').value.toLowerCase() === 'parent'
      );
      const fix = row && row.querySelector('.dr-prop-spelling');
      if (fix) fix.dataset.test = 'fix';
      return row ? [row.querySelector('input.dr-edit-name').value, fix ? fix.textContent : null] : null;
    });
    const listed = shown && shown[0];
    expect(['parent', 'Parent']).toContain(listed);
    const other = listed === 'parent' ? 'Parent' : 'parent';
    // Notes left by earlier tests may write it too: the other way's count, from the vault itself.
    const others = await browser.executeObsidian(({ app }, key) => app.vault.getMarkdownFiles().filter((f) => key in ((app.metadataCache.getFileCache(f) || {}).frontmatter || {})).length, other);
    expect(shown).toEqual([listed, `“${other}” in ${others}`]);
    await (await browser.$('[data-test="fix"]')).click();
    await browser.pause(1500);
    const after = await browser.executeObsidian(async ({ app, plugins }) => {
      const texts = [];
      for (const n of ['A', 'B', 'C']) texts.push(await app.vault.read(app.vault.getFileByPath(`Spelling/${n}.md`)));
      const view = app.workspace.getMostRecentLeaf().view;
      const fixLeft = !!view.contentEl.querySelector('.dr-prop-spelling');
      if (view.editing) view.setEditing(false);
      const folder = app.vault.getAbstractFileByPath('Spelling');
      if (folder) await app.vault.delete(folder, true);
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      return { capitals: texts.filter((t) => t.includes('Parent:')).length, lower: texts.filter((t) => t.includes('parent:')).length, fixLeft };
    });
    // Every note now writes it as Obsidian lists it.
    expect(after).toEqual(listed === 'parent' ? { capitals: 0, lower: 3, fixLeft: false } : { capitals: 3, lower: 0, fixLeft: false });
  });

  it('routes graph links by a property where notes name what they sit under', async function () {
    const result = await browser.executeObsidian(async ({ app, plugins }) => {
      // Cabinet is linked with the most notes, so guessing from the links
      // would put it above Crown; the parent property says otherwise.
      await app.vault.createFolder('Tree');
      const notes = {
        'Tree/Crown.md': 'The [[Cabinet]] and each [[Minister]].',
        'Tree/Cabinet.md': '---\nparent: "[[Crown]]"\n---\nEach [[Minister]]; [[Other 1]], [[Other 2]], [[Other 3]].',
        'Tree/Minister.md': '---\nparent: "[[Cabinet]]"\n---\nAnswers to Parliament.',
        'Tree/Other 1.md': 'One.',
        'Tree/Other 2.md': 'Two.',
        'Tree/Other 3.md': 'Three.',
      };
      for (const [p, text] of Object.entries(notes)) await app.vault.create(p, text);
      await new Promise((r) => setTimeout(r, 1500));
      const plugin = plugins.designRedux;
      const routes = plugin.features.find((f) => f.constructor.name === 'GraphRoutes');
      plugin.settings.graphRouting = Object.assign({}, plugin.settings.graphRouting, { graph: true });
      plugin.settings.graphRouteProperty = 'parent';
      app.commands.executeCommandById('graph:open');
      await new Promise((r) => setTimeout(r, 2500));
      const leaf = app.workspace.getLeavesOfType('graph')[0];
      routes.sync();
      await new Promise((r) => setTimeout(r, 1500));
      const has = (a, b) =>
        leaf.view.renderer.links.some(
          (l) => (l.source.id === `Tree/${a}.md` && l.target.id === `Tree/${b}.md`) || (l.source.id === `Tree/${b}.md` && l.target.id === `Tree/${a}.md`)
        );
      const byProperty = { crownMinister: has('Crown', 'Minister'), cabinetMinister: has('Cabinet', 'Minister'), crownCabinet: has('Crown', 'Cabinet') };
      plugin.settings.graphRouteProperty = '';
      routes.enable();
      await new Promise((r) => setTimeout(r, 1500));
      const byLinks = { crownMinister: has('Crown', 'Minister') };
      plugin.settings.graphRouteProperty = 'parent';
      routes.enable();
      plugin.settings.graphRouting.graph = false;
      routes.sync();
      leaf.detach();
      const folder = app.vault.getAbstractFileByPath('Tree');
      if (folder) await app.vault.delete(folder, true);
      await plugin.saveSettings();
      return { byProperty, byLinks };
    });
    expect(result).toEqual({
      byProperty: { crownMinister: false, cabinetMinister: true, crownCabinet: true },
      byLinks: { crownMinister: true },
    });
  });

  it('shows a note\'s properties as a light inspector: the main ones, + to add, a five-entry menu per row', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const path = 'Inspector note.md';
      const old = app.vault.getFileByPath(path);
      if (old) await app.vault.delete(old);
      await app.vault.create(path, '---\nsource: book\ntype: concept\ndomain: Law\nstatus: draft\nbroader: "[[Balance of power]]"\ncreated: 2026-10-14\n---\nA note.');
    });
    await obsidianPage.openFile('Inspector note.md');
    await browser.executeObsidianCommand('design-redux:open-properties');
    await browser.$('.dr-props-popup.is-open .dr-props-head').waitForExist({ timeout: 5000 });
    // Docked in the right sidebar, it stays while another note opens, and follows it.
    await obsidianPage.openFile('Politics/Balance of power.md');
    const followed = await browser.executeObsidian(async ({ app }) => {
      const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
      const leaf = app.workspace.getLeavesOfType('design-redux-properties')[0];
      const title = () => { const t = leaf && leaf.view.containerEl.querySelector('.dr-props-popup.is-open .dr-props-title'); return t ? t.textContent : ''; };
      await until(() => title() === 'Balance of power');
      return { right: !!leaf && leaf.getRoot() === app.workspace.rightSplit, title: title() };
    });
    expect(followed).toEqual({ right: true, title: 'Balance of power' });
    await obsidianPage.openFile('Inspector note.md');
    await browser.waitUntil(() => browser.execute(() => {
      const t = document.querySelector('.dr-panel-dock .dr-props-popup.is-open .dr-props-title');
      return !!t && t.textContent === 'Inspector note';
    }), { timeout: 5000 });
    await browser.waitUntil(() => browser.execute(() => document.querySelectorAll('.dr-props-popup.is-open .dr-row').length === 6), { timeout: 5000 });
    const look = await browser.execute(() => {
      const pop = document.querySelector('.dr-props-popup.is-open');
      const shown = Array.from(pop.querySelectorAll('.dr-row')).filter((r) => r.offsetParent !== null);
      const row = shown[0];
      const key = row.querySelector('.dr-key');
      const more = row.querySelector('.dr-row-more');
      return {
        shown: shown.map((r) => r.dataset.key),
        more: (pop.querySelector('.dr-props-more') || {}).textContent,
        labelShare: Math.round((key.getBoundingClientRect().width / row.getBoundingClientRect().width) * 100),
        rowHeight: Math.round(row.getBoundingClientRect().height),
        moreHidden: getComputedStyle(more).opacity === '0',
        widgets: shown.filter((r) => r.querySelector('.dr-value input, .dr-value [contenteditable], .dr-value .multi-select-container')).length,
      };
    });
    expect(look.shown).toEqual(['type', 'domain', 'status']);
    expect(look.more).toBe('Show 3 more');
    expect(look.labelShare).toBeGreaterThanOrEqual(30);
    expect(look.labelShare).toBeLessThanOrEqual(45);
    expect(look.rowHeight).toBeGreaterThanOrEqual(28);
    expect(look.moreHidden).toBe(true);
    expect(look.widgets).toBe(3);
    // Docked: no box, no lines between rows, the value from the left.
    const group = await browser.execute(() => {
      const pop = document.querySelector('.dr-props-popup.is-open');
      const rows = Array.from(pop.querySelectorAll('.dr-row')).filter((r) => r.offsetParent !== null);
      const field = rows[0].querySelector('.dr-value input, .dr-value [contenteditable]');
      return {
        radius: getComputedStyle(pop.querySelector('.dr-rows')).borderTopLeftRadius,
        hairline: parseFloat(getComputedStyle(rows[1]).borderTopWidth) > 0,
        boxed: field ? parseFloat(getComputedStyle(field).borderTopWidth) > 0 : false,
        right: field ? getComputedStyle(field).textAlign : 'right',
      };
    });
    expect(group).toEqual({ radius: '0px', hairline: false, boxed: false, right: 'left' });
    await shot('properties-inspector');

    // + : the search, with the cursor in it.
    await browser.execute(() => document.querySelector('.dr-props-popup.is-open .dr-props-add').click());
    const picker = await browser.execute(() => ({
      focused: document.activeElement && document.activeElement.classList.contains('dr-add-search'),
      items: Array.from(document.querySelectorAll('.dr-props-popup .dr-add-item')).map((e) => e.textContent),
    }));
    expect(picker.focused).toBe(true);
    expect(picker.items).toContain('Create new property');
    expect(picker.items).not.toContain('type');
    await browser.keys('Escape');

    // The row's menu, by reach.
    await browser.execute(() => document.querySelector('.dr-props-popup.is-open .dr-row[data-key="domain"] .dr-row-more').click());
    await browser.$('.menu').waitForExist({ timeout: 3000 });
    const items = await browser.execute(() => Array.from(document.querySelectorAll('.menu .menu-item-title')).map((e) => e.textContent));
    // Five, the rest a press further: Type ›, Rename, Find notes ›, Across the vault ›, Remove.
    expect(items).toEqual(['Type', 'Rename', 'Find notes', 'Across the vault', 'Remove']);
    await browser.keys('Escape');
    await browser.keys('Escape');
    await browser.executeObsidian(async ({ app }) => {
      app.workspace.detachLeavesOfType('design-redux-properties');
      const f = app.vault.getFileByPath('Inspector note.md');
      if (f) await app.vault.delete(f);
    });
  });

  it('sets a property by a rule when a note is moved into a folder, once, with Undo', async function () {
    const out = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins['design-redux'];
      const saved = { on: plugin.settings.propertyRulesOn, dry: plugin.settings.propertyRulesDryRun, rules: plugin.settings.propertyRules };
      for (const p of ['Rule inbox/Incoming.md', 'Rule law/Incoming.md']) {
        const f = app.vault.getAbstractFileByPath(p);
        if (f) await app.vault.delete(f);
      }
      for (const p of ['Rule inbox', 'Rule law']) if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p);
      Object.assign(plugin.settings, { propertyRulesOn: true, propertyRulesDryRun: false, propertyRules: [{ id: 'e2e', on: true, when: { kind: 'folder', folder: 'Rule law' }, set: [{ key: 'status', value: 'Open' }] }] });
      await plugin.saveSettings();
      const file = await app.vault.create('Rule inbox/Incoming.md', '---\ntitle: In\n---\nBody\n');
      const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
      await until(() => !!app.metadataCache.getFileCache(file)?.frontmatter);
      await new Promise((r) => setTimeout(r, 600));
      const before = Object.assign({}, app.metadataCache.getFileCache(file).frontmatter);
      await app.fileManager.renameFile(file, 'Rule law/Incoming.md');
      await until(() => app.metadataCache.getFileCache(file)?.frontmatter?.status === 'Open');
      const set = app.metadataCache.getFileCache(file).frontmatter.status;
      // Changed by hand: not set again.
      await app.fileManager.processFrontMatter(file, (fm) => { fm.status = 'Closed'; });
      await new Promise((r) => setTimeout(r, 800));
      const after = app.metadataCache.getFileCache(file).frontmatter.status;
      Object.assign(plugin.settings, { propertyRulesOn: saved.on, propertyRulesDryRun: saved.dry, propertyRules: saved.rules });
      await plugin.saveSettings();
      await app.vault.delete(file);
      return { before: before.status || null, set, after };
    });
    expect(out).toEqual({ before: null, set: 'Open', after: 'Closed' });
  });

  it('logged no errors of its own along the way', async function () {
    const errors = await browser.executeObsidian(() => window.__drErrors || []);
    const ours = errors.filter((e) => /design redux|plugin:design-redux/i.test(e));
    expect(ours).toEqual([]);
  });
});
