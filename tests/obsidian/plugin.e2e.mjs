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
import path from 'path';

const OUT = path.resolve('ci-output');
let version = 'unknown';

// Screenshots are kept few, to keep the runs and the ci-results branch
// small: these, on the latest Obsidian only (not the oldest, the first
// entry in wdio.conf.mjs), plus any test that fails, on either.
const OLDEST = '1.7.7';
const SHOTS = ['album', 'album-editorial', 'album-light', 'home', 'note-and-strip', 'graph-routes', 'footnote-box', 'properties-edit', 'properties-list', 'properties-sheet', 'footnotes-view', 'preview'];

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
    for (const name of ['Library', 'ContextStrip', 'CoverImages', 'Scripts', 'CanvasLegend', 'CanvasAlign', 'BulkEditing']) {
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

  it('draws its settings as six tabs, by what they’re for', async function () {
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
    expect(found.panes).toContain('library');
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
    await clickText('.dr-detail-action', 'Edit');
    await browser.$('.dr-edit-grip').waitForExist({ timeout: 5000 });
    await shot('album-edit');
    await clickText('.dr-detail-action', 'Done');
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
    await measure(started, 'theme', 'standard');
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

  it('opens an album with its map embedded, or its folder note as an overview', async function () {
    await browser.executeObsidian(async ({ app, plugins }) => {
      if (!app.vault.getFolderByPath('Atlas')) {
        await app.vault.createFolder('Atlas');
        await app.vault.create('Atlas/Coast.md', 'Shore.');
        await app.vault.create('Atlas/Atlas map.canvas', JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'Coastline', x: 0, y: 0, width: 200, height: 60 }], edges: [] }));
        await app.vault.create('Atlas/Atlas.md', '---\nalbum: concept map\nlayout: map\n---\nWhere the land meets the sea.');
      }
      const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => !!(app.metadataCache.getCache('Atlas/Atlas.md') || {}).frontmatter);
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Atlas' });
    });
    await browser.$(ACTIVE + '.dr-album-lead.is-map .internal-embed').waitForExist({ timeout: 10000 });
    // Obsidian draws the canvas in it, as a picture of its cards.
    await browser.waitUntil(async () => browser.execute((active) => {
      const lead = document.querySelector(active + '.dr-album-lead.is-map');
      const map = lead && lead.querySelector('svg.canvas-minimap');
      return !!map && map.childElementCount > 0 && lead.getBoundingClientRect().height > 100;
    }, ACTIVE), { timeout: 10000, timeoutMsg: 'the map was never drawn in the album' });
    expect(await browser.$(ACTIVE + '.dr-detail-kind').getText()).toMatch(/concept map/i);
    await shot('album-map');
    // As an overview: the folder note's text, without its properties.
    await browser.executeObsidian(async ({ app }) => {
      await app.fileManager.processFrontMatter(app.vault.getFileByPath('Atlas/Atlas.md'), (fm) => { fm.layout = 'overview'; });
    });
    await browser.waitUntil(async () => browser.execute((active) => {
      const lead = document.querySelector(active + '.dr-album-lead.is-overview');
      return !!lead && lead.textContent.includes('Where the land meets the sea') && !lead.textContent.includes('layout');
    }, ACTIVE), { timeout: 10000, timeoutMsg: 'the overview never showed the folder note’s text' });
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

  it('shows a legend on a canvas, and centres a card', async function () {
    await obsidianPage.openFile('Map.canvas');
    await browser.$('.dr-legend').waitForExist({ timeout: 10000 });
    await browser.waitUntil(async () => (await browser.$$('.dr-legend-row')).length > 0, {
      timeout: 10000,
      timeoutMsg: 'the legend never listed any colours',
    });
    const keys = await browser.execute(() =>
      Array.from(document.querySelectorAll('.dr-legend-row')).map((r) => r.dataset.key)
    );
    expect(keys).toEqual(['1', '4', '#aa2222', 'none']);
    // Obsidian's own colours are drawn, not left empty, whatever form this version keeps them in.
    const red = await browser.execute(
      () => getComputedStyle(document.querySelector('.dr-legend-row[data-key="1"] .dr-legend-dot')).backgroundColor
    );
    expect(red).not.toBe('rgba(0, 0, 0, 0)');

    const inner = await browser.executeObsidian(({ app }) => {
      const view = app.workspace.getLeavesOfType('canvas')[0].view;
      const canvas = view.canvas;
      const ok = {
        nodes: !!canvas && canvas.nodes instanceof Map,
        getData: !!canvas && typeof canvas.getData === 'function',
        selection: !!canvas && canvas.selection instanceof Set,
      };
      // Mark the cards so the test can find them on screen.
      if (ok.nodes) canvas.nodes.forEach((node, id) => node.nodeEl && node.nodeEl.setAttribute('data-test-id', id));
      return ok;
    });
    expect(inner).toEqual({ nodes: true, getData: true, selection: true });

    // Picking green fades the rest.
    await browser.$('.dr-legend-row[data-key="4"] .dr-legend-dot').click();
    await browser.pause(300);
    expect(await browser.$('[data-test-id="green1"]').getAttribute('class')).toContain('dr-legend-match');
    await shot('canvas-legend');
    await browser.$('.dr-legend-row[data-key="4"] .dr-legend-dot').click();

    // Select a card: the bar above it gets the Center text button.
    await browser.$('[data-test-id="green2"]').click();
    const button = await browser.$('.canvas-menu .dr-align-button');
    await button.waitForExist({ timeout: 5000 });
    await button.click();
    await browser.pause(300);
    expect(await browser.$('[data-test-id="green2"]').getAttribute('class')).toContain('dr-text-center');
    await shot('canvas-centred');

    // Its right-click menu offers to undo that.
    await browser.$('[data-test-id="green2"]').click({ button: 'right' });
    await browser.pause(400);
    expect(await menuTitles()).toContain('Stop centering text');
    await closeMenus();
  });

  it('shows a minimap while the cards don’t all fit, and goes where it’s pressed', async function () {
    await obsidianPage.openFile('Map.canvas');
    // Close in on one corner, so the rest is off screen.
    const has = await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      const box = Array.from(canvas.nodes.values())[0].getBBox();
      canvas.zoomToBbox({ minX: box.minX, minY: box.minY, maxX: box.minX + 40, maxY: box.minY + 30 });
      return { viewport: typeof canvas.getViewportBBox === 'function', move: typeof canvas.setViewport === 'function', zoom: typeof canvas.zoom === 'number' };
    });
    expect(has).toEqual({ viewport: true, move: true, zoom: true });
    // Closed in again while it isn't showing: a canvas just opened can put
    // back the view it was saved with, after the first zoom.
    await browser.waitUntil(async () => browser.executeObsidian(({ app }) => {
      const view = app.workspace.activeLeaf.view;
      const el = view.containerEl.querySelector('.dr-minimap');
      const shown = !!el && !el.classList.contains('is-hidden') && Number(el.querySelector('.dr-minimap-view').getAttribute('width')) > 0;
      if (!shown) {
        const box = Array.from(view.canvas.nodes.values())[0].getBBox();
        view.canvas.zoomToBbox({ minX: box.minX, minY: box.minY, maxX: box.minX + 40, maxY: box.minY + 30 });
      }
      return shown;
    }), { timeout: 10000, interval: 500, timeoutMsg: 'the minimap never showed the part on screen' });
    const before = await browser.executeObsidian(({ app }) => {
      const b = app.workspace.activeLeaf.view.canvas.getViewportBBox();
      return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    });
    // Pressed in the corner furthest from the part on screen: the view goes there.
    // (Offsets are from the map's middle.)
    const far = await browser.execute((active) => {
      const r = document.querySelector(active + '.dr-minimap-view');
      const x = Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2;
      const y = Number(r.getAttribute('y')) + Number(r.getAttribute('height')) / 2;
      return { x: x < 100 ? 85 : -85, y: y < 68 ? 55 : -55 };
    }, ACTIVE);
    // Pressed as the pointer would: on a small window something else can
    // lie over the map's corner, and WebDriver won't click through it.
    await browser.execute((active, at) => {
      const svg = document.querySelector(active + '.dr-minimap svg');
      const r = svg.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: r.left + r.width / 2 + at.x, clientY: r.top + r.height / 2 + at.y };
      svg.dispatchEvent(new PointerEvent('pointerdown', init));
      svg.dispatchEvent(new PointerEvent('pointerup', init));
    }, ACTIVE, far);
    await browser.pause(600);
    const after = await browser.executeObsidian(({ app }) => {
      const b = app.workspace.activeLeaf.view.canvas.getViewportBBox();
      return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    });
    expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeGreaterThan(20);
    // Everything in view again: no minimap.
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.zoomToFit());
    await browser.waitUntil(async () => browser.execute((active) => document.querySelector(active + '.dr-minimap').classList.contains('is-hidden'), ACTIVE), {
      timeout: 5000, timeoutMsg: 'the minimap stayed with everything in view',
    });
  });

  it('shows a card’s part in an argument above it, and a claim’s count', async function () {
    await obsidianPage.openFile('Map.canvas');
    const shown = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.activeLeaf.view;
      const plugin = app.plugins.plugins['design-redux'];
      const arg = plugin.features.find((f) => f.constructor.name === 'CanvasArguments');
      const node = Array.from(view.canvas.nodes.values()).find((n) => n.getData().type === 'text' && n.nodeEl && n.nodeEl.isConnected);
      arg.setRole(view, [node], 'claim');
      await new Promise((r) => setTimeout(r, 300));
      const after = getComputedStyle(node.nodeEl, '::after');
      const saved = JSON.parse(JSON.stringify(view.canvas.getData())).nodes.find((n) => n.id === node.id);
      const out = { content: after.content, overflow: getComputedStyle(node.nodeEl).overflow, saved: saved.drRole, height: parseFloat(after.height) };
      arg.setRole(view, [node], null);
      return out;
    });
    expect(shown.content).toContain('Claim');
    expect(shown.overflow).toBe('visible');
    expect(shown.saved).toBe('claim');
    expect(shown.height).toBeGreaterThan(8);
  });

  it('states a proposition on an arrow: head at the object, meaning saved apart, and turned round', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const old = app.vault.getFileByPath('Relations.canvas');
      if (old) await app.vault.delete(old);
      const card = (id, text, x) => ({ id, type: 'text', text, x, y: 0, width: 220, height: 60 });
      await app.vault.create('Relations.canvas', JSON.stringify({
        nodes: [card('a', 'Judicial review', 0), card('b', 'Legislative power', 400)],
        edges: [{ id: 'e', fromNode: 'b', fromSide: 'left', toNode: 'a', toSide: 'right' }],
      }));
    });
    await obsidianPage.openFile('Relations.canvas');
    await browser.$(ACTIVE + '.canvas-node').waitForExist({ timeout: 10000 });
    const result = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.activeLeaf.view;
      const rel = app.plugins.plugins['design-redux'].features.find((f) => f.constructor.name === 'CanvasRelations');
      const edge = view.canvas.edges.get('e');
      // The box names both cards.
      const modal = rel.askProposition(view, edge);
      const cards = Array.from(document.querySelectorAll('.dr-proposition-card')).map((el) => el.textContent);
      modal.close();
      rel.setProposition(view, edge, 'constrains', 'a');
      await new Promise((r) => setTimeout(r, 300));
      const saved = () => JSON.parse(JSON.stringify(view.canvas.getData())).edges.find((e) => e.id === 'e');
      const first = { ends: [edge.from.end, edge.to.end], saved: saved(), italic: !!view.contentEl.querySelector('.canvas-path-label-wrapper.dr-proposition-edge') };
      rel.reverse(view, [edge]);
      await new Promise((r) => setTimeout(r, 300));
      const second = { ends: [edge.from.end, edge.to.end], saved: saved() };
      return { cards, first, second };
    });
    expect(result.cards).toEqual(['Legislative power', 'Judicial review']);
    expect(result.first.ends).toEqual(['arrow', 'none']);
    expect(result.first.saved.label).toBe('constrains');
    expect(result.first.saved.drRelation).toEqual({ predicate: 'constrains', subject: 'a', object: 'b' });
    expect(result.first.saved.drRelated).toBe(true);
    expect(result.first.italic).toBe(true);
    expect(result.second.ends).toEqual(['none', 'arrow']);
    expect(result.second.saved.drRelation).toEqual({ predicate: 'constrains', subject: 'b', object: 'a' });
  });

  it('keeps a branch and its outline note in step, with the canvas open', async function () {
    await browser.executeObsidian(async ({ app }) => {
      for (const p of ['Sync.canvas', 'Government outline.md']) {
        const old = app.vault.getAbstractFileByPath(p);
        if (old) await app.vault.delete(old);
      }
      const card = (id, text, x, y) => ({ id, type: 'text', text, x, y, width: 180, height: 60 });
      await app.vault.create('Sync.canvas', JSON.stringify({
        nodes: [card('g', 'Government', 0, 0), card('p', 'Parliamentary', 300, -100), card('s', 'Presidential', 300, 100), card('f', 'Fusion of powers', 600, -100)],
        edges: [
          { id: 'e1', fromNode: 'g', fromSide: 'right', toNode: 'p', toSide: 'left' },
          { id: 'e2', fromNode: 'g', fromSide: 'right', toNode: 's', toSide: 'left' },
          { id: 'e3', fromNode: 'p', fromSide: 'right', toNode: 'f', toSide: 'left' },
        ],
      }));
    });
    await obsidianPage.openFile('Sync.canvas');
    await browser.$(ACTIVE + '.canvas-node').waitForExist({ timeout: 10000 });
    const result = await browser.executeObsidian(async ({ app, plugins }) => {
      const view = app.workspace.activeLeaf.view;
      const sync = plugins.designRedux.features.find((f) => f.constructor.name === 'CanvasOutlineSync');
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 100)); };
      const note = await sync.keep(view, view.canvas.nodes.get('g'));
      await until(() => !!sync.outlineInfo(note));
      // Fusion of powers moved under Presidential, in the note.
      const text = await app.vault.read(note);
      await app.vault.modify(note, text.replace(/\t\t- Fusion of powers (\^f)\n/, '').replace(/(\t- Presidential \^s\n)/, `$1\t\t- Fusion of powers ^f\n`));
      const followed = await sync.sync(note, true);
      // The open canvas takes the file as it now is.
      const parentOfF = () => {
        let parent = null;
        view.canvas.edges.forEach((e) => { if (e.to.node.id === 'f') parent = e.from.node.id; });
        return parent;
      };
      await until(() => parentOfF() === 's');
      const out = { followed, parent: parentOfF() };
      // The outline opened beside the canvas: closed, so later tests find the tabs they left.
      app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file && l.view.file.path === note.path).forEach((l) => l.detach());
      return out;
    });
    expect(result.followed).toBe('outline');
    expect(result.parent).toBe('s');
  });

  it('enters a workspace mode and leaves it with the workspace as it was', async function () {
    const result = await browser.executeObsidian(async ({ app, plugins }) => {
      const modes = plugins.designRedux.features.find((f) => f.constructor.name === 'WorkspaceModes');
      const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      app.workspace.leftSplit.expand();
      await until(() => !app.workspace.leftSplit.collapsed);
      const leaves = () => { const out = []; app.workspace.iterateRootLeaves((l) => out.push(l.view.getViewType())); return out.sort().join(','); };
      const before = { left: app.workspace.leftSplit.collapsed, leaves: leaves() };
      await modes.enter('study');
      await until(() => app.workspace.leftSplit.collapsed);
      const during = { left: app.workspace.leftSplit.collapsed, cls: document.body.classList.contains('dr-mode-study'), chip: !!document.querySelector('.dr-strip-mode') };
      await modes.leave();
      await until(() => !app.workspace.leftSplit.collapsed);
      const after = { left: app.workspace.leftSplit.collapsed, leaves: leaves(), cls: document.body.classList.contains('dr-mode-study') };
      return { before, during, after };
    });
    expect(result.during).toEqual({ left: true, cls: true, chip: true });
    expect(result.after.left).toBe(result.before.left);
    expect(result.after.leaves).toBe(result.before.leaves);
    expect(result.after.cls).toBe(false);
  });

  it('previews a note picked in an album beside it, and opens it on a double click', async function () {
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
      await until(() => !!el().querySelector('.dr-preview') && !!row());
      const pane = el().querySelector('.dr-preview').getBoundingClientRect();
      const list = el().querySelector('.view-content').getBoundingClientRect();
      row().click();
      const title = () => { const t = el().querySelector('.dr-preview-title'); return t ? t.textContent : ''; };
      await until(() => title() === 'Anarchy');
      return { title: title(), still: page.view.getViewType(), marked: row().classList.contains('is-selected'), beside: pane.left >= list.right - 1 && pane.width > 100 };
    });
    expect(result).toEqual({ title: 'Anarchy', still: 'design-redux-browse', marked: true, beside: true });
    await shot('preview');
    const opened = await browser.executeObsidian(async ({ app, plugins }) => {
      const plugin = plugins.designRedux;
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
      const row = app.workspace.activeLeaf.view.containerEl.querySelector('.dr-track[data-path="Politics/Anarchy.md"]');
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const active = () => { const f = app.workspace.getActiveFile(); return f ? f.basename : null; };
      await until(() => active() === 'Anarchy');
      // Hidden again, for the tests after.
      plugin.settings.libraryPreview = false;
      await plugin.saveData(plugin.settings);
      plugin.selection.clear();
      return active();
    });
    expect(opened).toBe('Anarchy');
  });

  it('pastes several lines onto a selected card as cards below it, and nothing else', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const old = app.vault.getFileByPath('Paste.canvas');
      if (old) await app.vault.delete(old);
      await app.vault.create('Paste.canvas', JSON.stringify({ nodes: [{ id: 'root', type: 'text', text: 'Government', x: 0, y: 0, width: 250, height: 60 }], edges: [] }));
    });
    await obsidianPage.openFile('Paste.canvas');
    await browser.$(ACTIVE + '.canvas-node').waitForExist({ timeout: 10000 });
    const result = await browser.executeObsidian(async ({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      canvas.selectOnly(canvas.nodes.get('root'));
      const data = new DataTransfer();
      data.setData('text/plain', 'Constitutionalism\n  Rule of law\nFederalism');
      const target = document.activeElement || document.body;
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => canvas.nodes.size >= 4);
      await new Promise((r) => setTimeout(r, 300));
      const texts = Array.from(canvas.nodes.values()).map((n) => n.getData().text).sort();
      const parentOf = {};
      canvas.edges.forEach((e) => (parentOf[e.to.node.getData().text] = e.from.node.getData().text));
      return { texts, parentOf };
    });
    expect(result.texts).toEqual(['Constitutionalism', 'Federalism', 'Government', 'Rule of law']);
    expect(result.parentOf).toEqual({ Constitutionalism: 'Government', 'Rule of law': 'Constitutionalism', Federalism: 'Government' });
  });

  it('drags a card with its branch, selected or not, and keeps where they went', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const old = app.vault.getFileByPath('Drag.canvas');
      if (old) await app.vault.delete(old);
      const card = (id, x, y) => ({ id, type: 'text', text: id, x, y, width: 160, height: 60 });
      await app.vault.create('Drag.canvas', JSON.stringify({
        nodes: [card('r', 0, 0), card('a', 240, 0), card('a1', 480, 0), card('x', 0, 240)],
        edges: [
          { id: 'e1', fromNode: 'r', fromSide: 'right', toNode: 'a', toSide: 'left' },
          { id: 'e2', fromNode: 'a', fromSide: 'right', toNode: 'a1', toSide: 'left' },
        ],
      }));
    });
    await obsidianPage.openFile('Drag.canvas');
    await browser.$(ACTIVE + '.canvas-node').waitForExist({ timeout: 10000 });
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      canvas.nodes.forEach((node, id) => node.nodeEl.setAttribute('data-test-id', id));
      canvas.zoomToFit();
    });
    await browser.pause(500);
    const where = () => browser.executeObsidian(({ app }) => {
      const out = {};
      app.workspace.activeLeaf.view.canvas.nodes.forEach((n, id) => (out[id] = [Math.round(n.x), Math.round(n.y)]));
      return out;
    });
    const drag = async (id, dy) => {
      const el = await browser.$(ACTIVE + `[data-test-id="${id}"]`);
      const box = await browser.execute((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; }, el);
      await browser.action('pointer').move({ x: Math.round(box.x), y: Math.round(box.y) }).down()
        .move({ x: Math.round(box.x), y: Math.round(box.y) + 8, duration: 60 })
        .move({ x: Math.round(box.x), y: Math.round(box.y) + dy, duration: 250 }).up().perform();
      await browser.pause(400);
    };
    const before = await where();
    await drag('r', 60);
    const after = await where();
    const moved = after.r[1] - before.r[1];
    expect(moved).toBeGreaterThan(20);
    expect([after.a[1] - before.a[1], after.a1[1] - before.a1[1], after.x[1] - before.x[1]]).toEqual([moved, moved, 0]);
    // Again, now that it's selected.
    await drag('r', 60);
    const again = await where();
    const twice = again.r[1] - after.r[1];
    expect(twice).toBeGreaterThan(20);
    expect(again.a1[1] - after.a1[1]).toBe(twice);
    // Kept in the file.
    const saved = await readUntil(() => browser.executeObsidian(async ({ app }) => {
      const nodes = JSON.parse(await app.vault.read(app.vault.getFileByPath('Drag.canvas'))).nodes;
      return Object.fromEntries(nodes.map((n) => [n.id, Math.round(n.y)]));
    }), (y) => y.a1 === again.a1[1]);
    expect(saved.a1).toBe(again.a1[1]);
  });

  it('gives a tree’s root card, and the cards a step from it, more weight', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const old = app.vault.getFileByPath('Depth.canvas');
      if (old) await app.vault.delete(old);
      const card = (id, x) => ({ id, type: 'text', text: id, x, y: 0, width: 160, height: 60 });
      await app.vault.create('Depth.canvas', JSON.stringify({
        nodes: [card('root', 0), card('one', 240), card('two', 480)],
        edges: [{ id: 'e1', fromNode: 'root', fromSide: 'right', toNode: 'one', toSide: 'left' }, { id: 'e2', fromNode: 'one', fromSide: 'right', toNode: 'two', toSide: 'left' }],
      }));
    });
    await obsidianPage.openFile('Depth.canvas');
    // In view: older versions draw a card's insides only once it's on screen.
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.zoomToFit());
    // Read from the cards as drawn on screen, by their words.
    const looks = await readUntil(() => browser.execute((active) => {
      const out = {};
      document.querySelectorAll(active + '.canvas-node').forEach((el) => {
        const content = el.querySelector('.canvas-node-content');
        const box = el.querySelector(':scope > .canvas-node-container');
        if (!content || !box) return;
        out[content.textContent.trim()] = [el.dataset.drDepth, Number(getComputedStyle(content).fontWeight), getComputedStyle(box).borderTopWidth];
      });
      return out;
    }, ACTIVE), (v) => v.root && v.root[0] === '0' && v.one && v.two);
    expect(looks.root[0]).toBe('0');
    expect(looks.root[1]).toBeGreaterThanOrEqual(700);
    expect(looks.root[2]).toBe('3px');
    expect(looks.one[0]).toBe('1');
    expect(looks.one[1]).toBeGreaterThan(looks.two[1]);
  });

  it('opens a card and a group an earlier version folded; a card has no fold of its own', async function () {
    // As an earlier version left them: a card folded to its title, and a
    // group folded with its card tucked inside, what's below closed up.
    const old = {
      nodes: [
        { id: 'c', type: 'text', text: '# Anarchy\nNo government above them.', x: 0, y: 0, width: 260, height: 52, drFold: { height: 200, folded: 52, measured: true } },
        { id: 'under', type: 'text', text: 'Under', x: 0, y: 92, width: 260, height: 60 },
        { id: 'g', type: 'group', label: 'Shelf', x: 400, y: 0, width: 400, height: 48, drFold: { height: 300, folded: 48, measured: true } },
        { id: 'g1', type: 'text', text: 'Waltz', x: 420, y: 20, width: 200, height: 60, drTuck: { by: 'g', dx: 20, dy: 40 } },
        { id: 'past', type: 'text', text: 'Past the shelf', x: 400, y: 88, width: 400, height: 60 },
      ],
      edges: [],
    };
    await browser.executeObsidian(async ({ app }, data) => {
      const was = app.vault.getFileByPath('Old folds.canvas');
      if (was) await app.vault.delete(was);
      await app.vault.create('Old folds.canvas', JSON.stringify(data));
    }, old);
    await obsidianPage.openFile('Old folds.canvas');
    const cards = () =>
      browser.executeObsidian(({ app }) => {
        const out = {};
        app.workspace.activeLeaf.view.canvas.nodes.forEach((node, id) => {
          node.nodeEl.setAttribute('data-test-id', id);
          out[id] = { y: node.y, height: node.height, hidden: node.nodeEl.classList.contains('dr-tucked') };
        });
        return out;
      });
    await browser.waitUntil(
      async () => {
        const now = await cards();
        return now.c && now.c.height === 200 && now.g.height === 300 && !now.g1.hidden;
      },
      { timeout: 10000, timeoutMsg: 'the old folds never opened' }
    );
    const now = await cards();
    expect([now.under.y, now.g1.y, now.past.y]).toEqual([240, 40, 340]);

    // Selected, a card has nothing to fold in the bar above it, nor in its menu.
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      canvas.zoomToFit();
      canvas.selectOnly(canvas.nodes.get('c'));
    });
    await browser.$(ACTIVE + '.canvas-menu').waitForExist({ timeout: 5000 });
    await browser.pause(400);
    expect(await browser.$(ACTIVE + '.canvas-menu .dr-branch-button').isExisting()).toBe(false);
    expect(await browser.$(ACTIVE + '.canvas-menu .dr-fold-button').isExisting()).toBe(false);
    await browser.$(ACTIVE + '[data-test-id="c"]').click({ button: 'right' });
    await browser.waitUntil(async () => (await menuTitles()).length > 0, { timeout: 4000 }).catch(() => {});
    expect((await menuTitles()).some((t) => /fold/i.test(t))).toBe(false);
    await closeMenus();
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.deselectAll());
  });

  it('folds a branch, closing the gaps; the outline follows, closing a group there only; Undo puts it back', async function () {
    // A small tree growing right, and a group with a card below it.
    const tree = {
      nodes: [
        { id: 'root', type: 'text', text: '# Theory', x: 0, y: 120, width: 200, height: 60 },
        { id: 'a', type: 'text', text: 'Realism', x: 300, y: 0, width: 180, height: 60 },
        { id: 'b', type: 'text', text: 'Liberalism', x: 300, y: 240, width: 180, height: 60 },
        { id: 'a1', type: 'text', text: 'Anarchy', x: 560, y: -60, width: 180, height: 60 },
        { id: 'a2', type: 'text', text: 'Power', x: 560, y: 60, width: 180, height: 60 },
        { id: 'g', type: 'group', label: 'Reading', x: -40, y: 400, width: 560, height: 200 },
        { id: 'g1', type: 'text', text: 'Waltz', x: 0, y: 440, width: 200, height: 60 },
        { id: 'below', type: 'text', text: 'Below', x: -40, y: 640, width: 560, height: 60 },
      ],
      edges: [
        { id: 'e1', fromNode: 'root', fromSide: 'right', toNode: 'a', toSide: 'left' },
        { id: 'e2', fromNode: 'root', fromSide: 'right', toNode: 'b', toSide: 'left' },
        { id: 'e3', fromNode: 'a', fromSide: 'right', toNode: 'a1', toSide: 'left' },
        { id: 'e4', fromNode: 'a', fromSide: 'right', toNode: 'a2', toSide: 'left' },
        { id: 'e5', fromNode: 'g1', fromSide: 'right', toNode: 'a1', toSide: 'bottom' },
      ],
    };
    await browser.executeObsidian(async ({ app }, data) => {
      const old = app.vault.getFileByPath('Tree.canvas');
      if (old) await app.vault.delete(old);
      await app.vault.create('Tree.canvas', JSON.stringify(data));
    }, tree);
    await obsidianPage.openFile('Tree.canvas');
    await browser.$(ACTIVE + '.canvas-controls .dr-fold-control').waitForExist({ timeout: 10000 });
    const cards = () =>
      browser.executeObsidian(({ app }) => {
        const out = {};
        app.workspace.activeLeaf.view.canvas.nodes.forEach((node, id) => {
          node.nodeEl.setAttribute('data-test-id', id);
          out[id] = { y: node.y, height: node.height, hidden: node.nodeEl.classList.contains('dr-tucked') };
        });
        return out;
      });
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      canvas.deselectAll();
      canvas.zoomToFit();
    });
    await browser.pause(600);
    const before = await cards();

    // Realism's branch, from the bar above it: Power is tucked away;
    // Anarchy, which Waltz leads to too, stays out.
    await browser.$(ACTIVE + '[data-test-id="a"]').click();
    const branchButton = await browser.$(ACTIVE + '.canvas-menu .dr-branch-button');
    await branchButton.waitForExist({ timeout: 5000 });
    await branchButton.click();
    await browser.waitUntil(async () => (await cards()).a2.hidden, { timeout: 5000, timeoutMsg: 'the branch never folded' });
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.deselectAll());
    let now = await cards();
    expect(now.a1.hidden).toBe(false);
    expect(await browser.$(ACTIVE + '[data-test-id="a"] .dr-branch-knob').getText()).toBe('+1');
    // Its room closed up: Liberalism, the group and what's below it move up by Power's overhang.
    expect(before.b.y - now.b.y).toBe(60);
    expect(before.below.y - now.below.y).toBe(60);
    expect(now.root.y).toBe(before.root.y);

    // A folded card joins up with arrows like any other — even with what's
    // tucked into it listed by the canvas at the fold, and on top of it.
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      const a = canvas.nodes.get('a');
      const a2 = canvas.nodes.get('a2');
      a2.zIndex = Math.max(a2.zIndex || 0, (a.zIndex || 0) + 1);
      canvas.markMoved(a2);
    });
    await browser.pause(300);
    const found = await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      const a = canvas.nodes.get('a');
      const hit = canvas.hitTestNode({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
      return hit && hit.id;
    });
    expect(found).toBe('a');
    const middle = (sel) =>
      browser.execute((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }, sel);
    const drawArrow = async (fromId, side, toId) => {
      // Both cards framed in the middle of the canvas, clear of the strip
      // along its foot, however short the window.
      await browser.executeObsidian(({ app }, ids) => {
        const canvas = app.workspace.activeLeaf.view.canvas;
        const boxes = ids.map((id) => canvas.nodes.get(id).getBBox());
        const minY = Math.min(...boxes.map((b) => b.minY));
        const maxY = Math.max(...boxes.map((b) => b.maxY));
        const pad = (maxY - minY) * 0.6;
        canvas.zoomToBbox({
          minX: Math.min(...boxes.map((b) => b.minX)),
          maxX: Math.max(...boxes.map((b) => b.maxX)),
          minY: minY - pad,
          maxY: maxY + pad,
        });
      }, [fromId, toId]);
      await browser.pause(400);
      const from = await middle(ACTIVE + `[data-test-id="${fromId}"]`);
      await browser.action('pointer').move({ x: from.x, y: from.y }).perform();
      await browser.pause(300);
      const point = await middle(ACTIVE + `.canvas-node-interaction-layer .canvas-node-connection-point[data-side="${side}"]`);
      const to = await middle(ACTIVE + `[data-test-id="${toId}"]`);
      await browser
        .action('pointer')
        .move({ x: point.x, y: point.y })
        .down()
        .move({ x: point.x, y: point.y + 12, duration: 60 })
        .move({ x: to.x, y: to.y, duration: 250 })
        .up()
        .perform();
      await browser.pause(400);
      return browser.executeObsidian(({ app }, ends) => {
        const canvas = app.workspace.activeLeaf.view.canvas;
        const made = Array.from(canvas.edges.values()).find((e) => !/^e\d$/.test(e.id));
        const out = made ? [made.from.node.id, made.to.node.id] : null;
        if (made) canvas.removeEdge(made);
        return out;
      });
    };
    // From the folded card, and onto it.
    expect(await drawArrow('a', 'bottom', 'b')).toEqual(['a', 'b']);
    expect(await drawArrow('below', 'top', 'a')).toEqual(['below', 'a']);
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.deselectAll());

    await shot('canvas-tree-folded');

    // Kept in the file.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const nodes = JSON.parse(await app.vault.read(app.vault.getFileByPath('Tree.canvas'))).nodes;
          const find = (id) => nodes.find((n) => n.id === id);
          return !!(find('a2').drTuck && find('a2').drTuck.by === 'a');
        }),
      { timeout: 6000, interval: 300, timeoutMsg: 'the folds were never saved' }
    );

    // The outline, from the button among the canvas controls — pressed as
    // the page has it, since in a short window the column runs under the
    // status bar — with folds shown with their counts.
    const pressed = await browser.execute((sel) => {
      const button = document.querySelector(sel);
      if (button) button.click();
      return !!button;
    }, ACTIVE + '.dr-outline-control .canvas-control-item');
    expect(pressed).toBe(true);
    await browser.$('.dr-canvas-outline .dr-outline-row').waitForExist({ timeout: 5000 });
    const rows = await browser.execute(() =>
      Array.from(document.querySelectorAll('.dr-canvas-outline .dr-outline-row')).map((r) => r.textContent.trim())
    );
    expect(rows).toEqual(['Anarchy', 'Theory', 'Realism+1', 'Liberalism', 'Reading', 'Waltz', 'Below']);
    const outlineRows = () =>
      browser.execute(() => Array.from(document.querySelectorAll('.dr-canvas-outline .dr-outline-row')).map((r) => r.textContent.trim()));
    const toggleRow = (label) =>
      browser.execute((label) => {
        const row = Array.from(document.querySelectorAll('.dr-canvas-outline .dr-outline-row')).find((r) => r.textContent.startsWith(label));
        row.querySelector('.collapse-icon').click();
      }, label);

    // A group closes in the outline only: the canvas is left as it is.
    await toggleRow('Reading');
    await browser.waitUntil(async () => !(await outlineRows()).includes('Waltz'), { timeout: 5000, timeoutMsg: 'the group never closed in the outline' });
    now = await cards();
    expect(now.g1.hidden).toBe(false);
    expect(now.g.height).toBe(before.g.height);

    // Unfolded from the outline: Power comes back and what's below moves back down.
    await toggleRow('Realism');
    await browser.waitUntil(async () => !(await cards()).a2.hidden && (await cards()).below.y === before.below.y, {
      timeout: 5000,
      timeoutMsg: 'the branch never unfolded',
    });

    // Undo folds it again.
    await browser.pause(2500);
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.undo());
    await browser.$(ACTIVE + '.canvas-wrapper').click();
    await browser.waitUntil(async () => (await cards()).a2.hidden, { timeout: 5000, timeoutMsg: 'Undo didn’t fold the branch again' });

    await browser.executeObsidian(async ({ app }) => {
      app.workspace.getLeavesOfType('design-redux-canvas-outline').forEach((leaf) => leaf.detach());
    });
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
        return { shelf, sidebar };
      }, root);
      perf.push(`perf: shelf of ${n} albums: drawn ${times.shelf} ms, the sidebar ${times.sidebar} ms`);
    }
    await browser.executeObsidian(async ({ app }, roots) => {
      for (const root of roots) {
        const folder = app.vault.getFolderByPath(root);
        if (folder) await app.vault.delete(folder, true);
      }
    }, made);
  });

  it('times folding, unfolding and tidying canvases of 20, 100 and 500 cards', async function () {
    // A baseline, not a check: each canvas a tree, every card with up to four under it.
    this.timeout(180000);
    const made = [];
    for (const n of [20, 100, 500]) {
      const path = await browser.executeObsidian(async ({ app }, n) => {
        const nodes = [];
        const edges = [];
        const rows = {};
        const depth = [];
        for (let i = 0; i < n; i++) {
          const parent = i ? Math.floor((i - 1) / 4) : -1;
          depth[i] = i ? depth[parent] + 1 : 0;
          const row = (rows[depth[i]] = (rows[depth[i]] || 0) + 1) - 1;
          nodes.push({ id: `c${i}`, type: 'text', text: `Card ${i}`, x: depth[i] * 320, y: row * 90, width: 200, height: 60 });
          if (parent >= 0) edges.push({ id: `e${i}`, fromNode: `c${parent}`, fromSide: 'right', toNode: `c${i}`, toSide: 'left' });
        }
        const at = `Bench ${n}.canvas`;
        const old = app.vault.getFileByPath(at);
        if (old) await app.vault.delete(old);
        await app.vault.create(at, JSON.stringify({ nodes, edges }));
        return at;
      }, n);
      made.push(path);
      await obsidianPage.openFile(path);
      await browser.waitUntil(
        () => browser.executeObsidian(({ app }, n) => {
          const v = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
          return !!(v && v.canvas && v.canvas.nodes && v.canvas.nodes.size === n);
        }, n),
        { timeout: 30000, timeoutMsg: `the canvas of ${n} cards never loaded` }
      );
      const times = await browser.executeObsidian(async ({ app, plugins }) => {
        const view = app.workspace.activeLeaf.view;
        const features = plugins.designRedux.features;
        const fold = features.find((f) => f.constructor.name === 'CanvasFold');
        const branches = features.find((f) => f.constructor.name === 'CanvasBranches');
        // Without motion, so what's timed is the work, not the glide.
        const real = window.matchMedia;
        window.matchMedia = (q) => (/reduced-motion/.test(q) ? { matches: true } : real.call(window, q));
        const time = async (fn) => {
          const started = performance.now();
          await fn();
          return Math.round(performance.now() - started);
        };
        try {
          return {
            fold: fold ? await time(() => fold.foldEverything(view, 'branches')) : null,
            unfold: fold ? await time(() => fold.foldEverything(view, 'everything')) : null,
            tidy: branches ? await time(() => branches.tidy(view, view.canvas.nodes.get('c0'))) : null,
          };
        } finally {
          window.matchMedia = real;
        }
      });
      perf.push(`perf: canvas of ${n} cards: fold ${times.fold} ms, unfold ${times.unfold} ms, tidy ${times.tidy} ms`);
    }
    await browser.executeObsidian(async ({ app }, paths) => {
      for (const at of paths) {
        const file = app.vault.getFileByPath(at);
        if (file) await app.vault.delete(file);
      }
    }, made);
  });

  it('keeps a master card, and what hangs from it, out of the fold above it', async function () {
    const data = {
      nodes: [
        { id: 'top', type: 'text', text: '# Politics', x: 0, y: 0, width: 220, height: 60 },
        { id: 'mid', type: 'text', text: 'Theories', x: 300, y: 0, width: 200, height: 60 },
        { id: 'boss', type: 'text', text: 'Realism', x: 580, y: 0, width: 200, height: 60 },
        { id: 'kid', type: 'text', text: 'Waltz', x: 860, y: 0, width: 200, height: 60 },
      ],
      edges: [
        { id: 'e1', fromNode: 'top', fromSide: 'right', toNode: 'mid', toSide: 'left' },
        { id: 'e2', fromNode: 'mid', fromSide: 'right', toNode: 'boss', toSide: 'left' },
        { id: 'e3', fromNode: 'boss', fromSide: 'right', toNode: 'kid', toSide: 'left' },
      ],
    };
    await browser.executeObsidian(async ({ app }, data) => {
      const old = app.vault.getFileByPath('Master.canvas');
      if (old) await app.vault.delete(old);
      await app.vault.create('Master.canvas', JSON.stringify(data));
    }, data);
    await obsidianPage.openFile('Master.canvas');
    await browser.$(ACTIVE + '.canvas-controls .dr-fold-control').waitForExist({ timeout: 10000 });
    const hidden = () =>
      browser.executeObsidian(({ app }) => {
        const out = {};
        app.workspace.activeLeaf.view.canvas.nodes.forEach((node, id) => {
          node.nodeEl.setAttribute('data-test-id', id);
          out[id] = node.nodeEl.classList.contains('dr-tucked');
        });
        return out;
      });
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      canvas.deselectAll();
      canvas.zoomToFit();
    });
    await browser.pause(500);
    await hidden();

    // Made a master card from its right-click menu: a crown marks it, and it's kept in the file.
    await browser.$(ACTIVE + '[data-test-id="boss"]').click({ button: 'right' });
    await browser.waitUntil(async () => (await menuTitles()).includes('Master card'), { timeout: 4000, timeoutMsg: 'no Master card in the menu' });
    await clickText('.menu .menu-item', 'Master card');
    await browser.$(ACTIVE + '[data-test-id="boss"] .dr-master-mark').waitForExist({ timeout: 5000 });
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const nodes = JSON.parse(await app.vault.read(app.vault.getFileByPath('Master.canvas'))).nodes;
          return nodes.find((n) => n.id === 'boss').drMaster === true;
        }),
      { timeout: 6000, interval: 300, timeoutMsg: 'the master card was never saved' }
    );

    // Folding every branch: Theories folds away with the top; Realism stays out and holds Waltz.
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:fold-every-canvas-branch'));
    await browser.waitUntil(async () => (await hidden()).mid && (await hidden()).kid, { timeout: 5000, timeoutMsg: 'the branches never folded' });
    expect((await hidden()).boss).toBe(false);
    expect(await browser.$(ACTIVE + '[data-test-id="top"] .dr-branch-knob').getText()).toBe('+1');
    expect(await browser.$(ACTIVE + '[data-test-id="boss"] .dr-branch-knob').getText()).toBe('+1');
    await shot('canvas-master');
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:unfold-canvas-everything'));
    await browser.waitUntil(async () => !Object.values(await hidden()).some(Boolean), { timeout: 5000, timeoutMsg: 'never all unfolded' });
  });

  it('grows a mind map by keys — Tab, typing, Escape, Enter — and arranges cards in one step', async function () {
    const data = {
      nodes: [
        { id: 'root', type: 'text', text: '# Government', x: 0, y: 0, width: 260, height: 70 },
        { id: 'k1', type: 'text', text: 'Executive', x: 360, y: -60, width: 220, height: 60 },
        { id: 'k2', type: 'text', text: 'Legislature', x: 360, y: 40, width: 220, height: 60 },
        { id: 'x1', type: 'text', text: 'One', x: 0, y: 300, width: 160, height: 60 },
        { id: 'x2', type: 'text', text: 'Two', x: 230, y: 330, width: 120, height: 90 },
      ],
      edges: [
        { id: 'e1', fromNode: 'root', fromSide: 'right', toNode: 'k1', toSide: 'left' },
        { id: 'e2', fromNode: 'root', fromSide: 'right', toNode: 'k2', toSide: 'left' },
      ],
    };
    await browser.executeObsidian(async ({ app }, data) => {
      const old = app.vault.getFileByPath('Mind.canvas');
      if (old) await app.vault.delete(old);
      await app.vault.create('Mind.canvas', JSON.stringify(data));
    }, data);
    await obsidianPage.openFile('Mind.canvas');
    await browser.$(ACTIVE + '.canvas-node').waitForExist({ timeout: 10000 });
    const cards = () =>
      browser.executeObsidian(({ app }) => {
        const canvas = app.workspace.activeLeaf.view.canvas;
        const out = {};
        canvas.nodes.forEach((n, id) => {
          n.nodeEl.setAttribute('data-test-id', id);
          out[id] = { x: n.x, y: n.y, editing: !!n.isEditing, selected: canvas.selection.has(n), text: n.getData().text || '' };
        });
        return { nodes: out, edges: canvas.edges.size };
      });
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      canvas.deselectAll();
      canvas.zoomToFit();
    });
    await browser.pause(600);
    await cards();
    const fresh = (now) => Object.keys(now.nodes).filter((id) => !data.nodes.some((n) => n.id === id));

    // Tab on the root: a card after its others, joined to it, open to type in.
    // Selected as a click would, with the keys going to the canvas — the
    // legend can sit over the card in a small window.
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      canvas.selectOnly(canvas.nodes.get('root'));
      canvas.wrapperEl.focus();
    });
    await browser.pause(300);
    await browser.keys('Tab');
    await browser.waitUntil(async () => fresh(await cards()).length === 1, { timeout: 5000, timeoutMsg: 'Tab added no card' });
    let now = await cards();
    const child = fresh(now)[0];
    // Grown out of the root, then opened to type in.
    await browser.waitUntil(async () => (await cards()).nodes[child].editing, { timeout: 5000, timeoutMsg: 'the new card never opened' });
    // Its editor taking the keys, not just open: typed sooner, the first letter is lost.
    await browser.waitUntil(async () => browser.executeObsidian(({ app }, id) => {
      const node = app.workspace.activeLeaf.view.canvas.nodes.get(id);
      if (!node || !node.nodeEl) return false;
      const at = node.nodeEl.ownerDocument.activeElement;
      return !!node.nodeEl.querySelector('.cm-editor.cm-focused') || (!!at && at !== node.nodeEl && node.nodeEl.contains(at));
    }, child), { timeout: 5000, timeoutMsg: 'the new card’s editor never took the keys' });
    now = await cards();
    expect(now.edges).toBe(3);
    expect(now.nodes[child].x).toBe(360);
    expect(now.nodes[child].y).toBe(130);
    await browser.keys('Judiciary'.split(''));
    await browser.pause(300);
    // Escape: done typing, still selected — and Enter adds the next one beside it.
    await browser.keys('Escape');
    await browser.waitUntil(async () => !(await cards()).nodes[child].editing, { timeout: 5000, timeoutMsg: 'Escape never ended the typing' });
    now = await cards();
    expect(now.nodes[child].text).toBe('Judiciary');
    expect(now.nodes[child].selected).toBe(true);
    await browser.keys('Enter');
    await browser.waitUntil(async () => fresh(await cards()).length === 2, { timeout: 5000, timeoutMsg: 'Enter added no card' });
    const sibling = fresh(await cards()).find((id) => id !== child);
    await browser.waitUntil(async () => (await cards()).nodes[sibling].editing, { timeout: 5000, timeoutMsg: 'the next card never opened' });
    now = await cards();
    expect(now.edges).toBe(4);
    expect(now.nodes[sibling].y).toBe(220);
    await browser.keys('Escape');
    await browser.pause(300);

    // Two loose cards lined up along their tops, saved.
    await browser.executeObsidian(async ({ app, plugins }) => {
      const view = app.workspace.activeLeaf.view;
      const canvas = view.canvas;
      canvas.deselectAll();
      canvas.select(canvas.nodes.get('x1'));
      canvas.select(canvas.nodes.get('x2'));
      const arrange = plugins.designRedux.features.find((f) => f.constructor.name === 'CanvasArrange');
      await arrange.arrange(view, 'top');
    });
    now = await cards();
    expect([now.nodes.x1.y, now.nodes.x2.y]).toEqual([300, 300]);
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const nodes = JSON.parse(await app.vault.read(app.vault.getFileByPath('Mind.canvas'))).nodes;
          return nodes.find((n) => n.id === 'x2').y === 300 && nodes.length === 7;
        }),
      { timeout: 6000, interval: 300, timeoutMsg: 'never saved' }
    );
  });

  it('lays out a canvas made a mind map as its tree changes, in the step of Undo the change made', async function () {
    const data = {
      nodes: [
        { id: 'root', type: 'text', text: 'Law', x: 0, y: 0, width: 220, height: 60 },
        { id: 'k1', type: 'text', text: 'Public', x: 320, y: -50, width: 200, height: 60 },
        { id: 'k2', type: 'text', text: 'Private', x: 340, y: 90, width: 200, height: 60 },
      ],
      edges: [
        { id: 'e1', fromNode: 'root', fromSide: 'right', toNode: 'k1', toSide: 'left' },
        { id: 'e2', fromNode: 'root', fromSide: 'right', toNode: 'k2', toSide: 'left' },
      ],
    };
    await browser.executeObsidian(async ({ app }, data) => {
      const old = app.vault.getFileByPath('Live map.canvas');
      if (old) await app.vault.delete(old);
      await app.vault.create('Live map.canvas', JSON.stringify(data));
    }, data);
    await obsidianPage.openFile('Live map.canvas');
    await browser.$(ACTIVE + '.canvas-node').waitForExist({ timeout: 10000 });
    const cards = () =>
      browser.executeObsidian(({ app }) => {
        const out = {};
        app.workspace.activeLeaf.view.canvas.nodes.forEach((n, id) => (out[id] = { x: n.x, y: n.y }));
        return out;
      });
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:canvas-make-mind-map'));
    // Made a map: nothing moves, and it's a step of its own.
    await browser.pause(600);
    const made = await cards();
    expect(made.k2).toEqual({ x: 340, y: 90 });
    // A card added the canvas's own way goes to its place, after the others.
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      const node = canvas.createTextNode({ pos: { x: 900, y: 600 }, size: { width: 200, height: 60 }, text: 'Criminal', focus: false, save: false });
      canvas.importData({ nodes: [], edges: [{ id: 'e3', fromNode: 'root', fromSide: 'right', toNode: node.id, toSide: 'left' }] });
      node.nodeEl.setAttribute('data-test-id', 'added');
      canvas.requestSave();
    });
    const added = async () => {
      const now = await cards();
      return Object.keys(now).filter((id) => !made[id]).map((id) => now[id])[0];
    };
    await browser.waitUntil(async () => {
      const a = await added();
      return !!a && a.x !== 900;
    }, { timeout: 5000, timeoutMsg: 'the added card was never laid out' });
    await browser.pause(400);
    const now = await cards();
    const card = await added();
    // In the root's column — k1 keeps the 20 it was moved by hand — and below the others.
    expect(card.x).toBe(now.k1.x - 20);
    expect(card.y).toBeGreaterThan(now.k2.y);
    // One Undo takes back the card and its layout together.
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.undo());
    await browser.pause(600);
    expect(await cards()).toEqual(made);
    // Folded and unfolded: every card back where it was.
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:fold-every-canvas-branch'));
    await browser.pause(800);
    const tucked = await browser.executeObsidian(({ app }) => Array.from(app.workspace.activeLeaf.view.canvas.nodes.values()).filter((n) => n.unknownData && n.unknownData.drTuck).length);
    expect(tucked).toBe(2);
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:unfold-canvas-everything'));
    await browser.pause(800);
    expect(await cards()).toEqual(made);
    // Tab on the root: the new card goes straight to its place, the last of its column.
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      canvas.selectOnly(canvas.nodes.get('root'));
      canvas.wrapperEl.focus();
    });
    await browser.pause(300);
    await browser.keys('Tab');
    await browser.waitUntil(async () => !!(await added()), { timeout: 5000, timeoutMsg: 'Tab added no card' });
    await browser.pause(800);
    const tabbed = await added();
    const after = await cards();
    expect(tabbed.x).toBe(after.k1.x - 20);
    expect(tabbed.y).toBeGreaterThan(after.k2.y);
    await browser.keys('Escape');
  });

  it('draws an arrow in a style of its own, keeps it in the canvas file, and goes back to the default', async function () {
    await obsidianPage.openFile('Map.canvas');
    await browser.$(ACTIVE + '.canvas-controls .dr-fold-control').waitForExist({ timeout: 10000 });
    const style = (change) =>
      browser.executeObsidian(({ app, plugins }, change) => {
        const view = app.workspace.activeLeaf.view;
        const edge = view.canvas.edges.get('e1');
        const arrows = plugins.designRedux.features.find((f) => f.constructor.name === 'CanvasArrows');
        arrows.setStyle(view, [edge], change);
        return { d: edge.path.display.getAttribute('d'), dashed: edge.lineGroupEl.classList.contains('dr-line-dashed') };
      }, change);
    // Square corners, between cards side by side: a straight line, not the canvas's curve.
    const styled = await style({ shape: 'elbow', line: 'dashed' });
    expect(styled.d).not.toContain('C');
    expect(styled.dashed).toBe(true);
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const edge = JSON.parse(await app.vault.read(app.vault.getFileByPath('Map.canvas'))).edges.find((e) => e.id === 'e1');
          return !!(edge && edge.drArrow && edge.drArrow.shape === 'elbow' && edge.drArrow.line === 'dashed');
        }),
      { timeout: 6000, interval: 300, timeoutMsg: 'the style was never saved' }
    );
    const plain = await style(null);
    expect(plain.d).toContain('C');
    expect(plain.dashed).toBe(false);
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
    await browser.keys('Escape');

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
    // With the Properties panel on (the default), the note's own block is hidden.
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

  it('draws quiet links, keeps them off the graph and backlinks, and follows renames', async function () {
    this.timeout(180000);
    const backlinked = await browser.executeObsidian(async ({ app, plugins }) => {
      const plugin = plugins.designRedux;
      plugin.settings.quietLinks = true;
      await plugin.saveSettings();
      await app.vault.create('Target one.md', 'One.\n');
      await app.vault.create('Target two.md', 'Two.\n');
      await app.vault.create(
        'Quiet.md',
        '---\nrelated: "[[[Target two]]]"\n---\nIn passing [[[Politics/Anarchy]]], with words [[[Target one|the first]]], [[[Not yet written]]], and plainly [[Politics/Deterrence]].\n'
      );
      await new Promise((r) => setTimeout(r, 1500));
      const found = app.metadataCache.getBacklinksForFile(app.vault.getFileByPath('Politics/Anarchy.md'));
      const from = found && found.data ? (found.data instanceof Map ? Array.from(found.data.keys()) : Object.keys(found.data)) : [];
      return from.includes('Quiet.md');
    });
    expect(backlinked).toBe(false);

    // Obsidian never counts the stand-ins: set aside as the note is read.
    // Off, they're counted again, as Obsidian would; on again — as when
    // Obsidian starts with what it remembered — they're set aside again.
    const counts = await browser.executeObsidian(async ({ app, plugins }) => {
      const standIns = () =>
        Object.keys(app.metadataCache.unresolvedLinks['Quiet.md'] || {}).filter((k) => k.startsWith('['));
      const plugin = plugins.designRedux;
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      const on = standIns();
      plugin.settings.quietLinks = false;
      await plugin.saveSettings();
      await until(() => standIns().length > 0);
      const off = standIns();
      plugin.settings.quietLinks = true;
      await plugin.saveSettings();
      await until(() => standIns().length === 0);
      return { on, off, again: standIns() };
    });
    expect(counts.on).toEqual([]);
    expect(counts.off.length).toBeGreaterThan(0);
    expect(counts.again).toEqual([]);

    // Reading view: the note each names, dotted, and no stray bracket.
    const reading = await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.setViewState({ type: 'markdown', state: { file: 'Quiet.md', mode: 'preview' } });
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      const para = () => leaf.view.containerEl.querySelector('.markdown-preview-view p');
      await until(() => para() && para().querySelectorAll('a.internal-link').length >= 4);
      const p = para();
      return {
        links: Array.from(p.querySelectorAll('a.internal-link')).map((a) => [a.getAttribute('data-href'), a.textContent, a.classList.contains('dr-quiet-link')]),
        text: p.textContent,
      };
    });
    expect(reading.links).toEqual([
      ['Politics/Anarchy', 'Politics/Anarchy', true],
      ['Target one', 'the first', true],
      ['Not yet written', 'Not yet written', true],
      ['Politics/Deterrence', 'Politics/Deterrence', false],
    ]);
    expect(reading.text).not.toContain(']');

    // Live Preview: drawn the same, and a missing note is made on click.
    const live = await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.setViewState({ type: 'markdown', state: { file: 'Quiet.md', mode: 'source', source: false } });
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => leaf.view.editor && leaf.view.containerEl.querySelector('.cm-content'));
      leaf.view.editor.setCursor({ line: 0, ch: 0 });
      const drawn = () => Array.from(leaf.view.containerEl.querySelectorAll('.cm-content .dr-quiet-link')).map((e) => e.textContent);
      await until(() => drawn().length >= 3);
      return drawn();
    });
    expect(live).toEqual(['Politics/Anarchy', 'the first', 'Not yet written']);
    const missing = await browser.$('.cm-content .dr-quiet-link[data-href="Not yet written"]');
    await missing.click();
    const made = await readUntil(() => browser.executeObsidian(({ app }) => (app.workspace.getActiveFile() || {}).path), (p) => p === 'Not yet written.md');
    expect(made).toBe('Not yet written.md');
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Quiet.md'));
    });

    // Obsidian's own properties block names the note, not the stand-in.
    const property = await readUntil(() => browser.executeObsidian(({ app }) => {
      const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
      const link = leaf.view.containerEl.querySelector('.metadata-container .internal-link.dr-quiet-link');
      return link ? [link.getAttribute('data-href'), link.textContent] : null;
    }), (v) => !!v);
    expect(property).toEqual(['Target two', 'Target two']);

    // The graph: no quiet line, and no "[Name" stand-in.
    const graph = await browser.executeObsidian(async ({ app }) => {
      app.commands.executeCommandById('graph:open');
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      // Drawn once the note's plain line is.
      const drawn = () => { const l = app.workspace.getLeavesOfType('graph')[0]; return l && l.view.renderer; };
      await until(() => drawn() && drawn().links.some((l) => l.source.id === 'Quiet.md'));
      const leaf = app.workspace.getLeavesOfType('graph')[0];
      const drawing = leaf.view.renderer;
      const out = {
        lines: drawing.links.map((l) => `${l.source.id} -> ${l.target.id}`).filter((l) => l.startsWith('Quiet.md')),
        standIns: drawing.nodes.map((n) => n.id).filter((id) => id.startsWith('[')),
      };
      leaf.detach();
      return out;
    });
    expect(graph).toEqual({ lines: ['Quiet.md -> Politics/Deterrence.md'], standIns: [] });

    // The Outgoing links pane doesn't offer to make "[Name" notes.
    const outgoing = await browser.executeObsidian(async ({ app }) => {
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Quiet.md'));
      const leaf = app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: 'outgoing-link', state: { file: 'Quiet.md' } });
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => leaf.view.containerEl.querySelectorAll('.outgoing-link-item').length > 0);
      const shown = Array.from(leaf.view.containerEl.querySelectorAll('.outgoing-link-item'))
        .filter((i) => getComputedStyle(i).display !== 'none')
        .map((i) => i.textContent.trim());
      leaf.detach();
      return shown;
    });
    expect(outgoing.filter((t) => t.startsWith('['))).toEqual([]);

    // After [[[, the plugin's own list; picking writes a quiet link.
    await browser.executeObsidian(async ({ app, obsidian }) => {
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Quiet.md'));
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => app.workspace.getActiveViewOfType(obsidian.MarkdownView));
      const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView).editor;
      const last = editor.lastLine();
      editor.setCursor({ line: last, ch: editor.getLine(last).length });
      editor.replaceSelection('\nTyped ');
      editor.focus();
    });
    await browser.keys(['[', '[', '[', 'D', 'e', 't']);
    const listed = await readUntil(() => browser.execute(() =>
      Array.from(document.querySelectorAll('.suggestion-container .dr-quiet-suggest')).map((e) => e.textContent)
    ), (l) => l.length > 0);
    expect(listed.length).toBeGreaterThan(0);
    await browser.keys(['Enter']);
    const typed = await readUntil(() => browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView).editor;
      return editor.getLine(editor.lastLine());
    }), (line) => line === 'Typed [[[Deterrence]]]');
    expect(typed).toBe('Typed [[[Deterrence]]]');

    // Obsidian's own [[ list and Quick switcher don't offer "[Name" notes.
    await browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView).editor;
      const last = editor.lastLine();
      editor.setCursor({ line: last, ch: editor.getLine(last).length });
      editor.replaceSelection('\nPlain ');
      editor.focus();
    });
    await browser.keys(['[', '[', 'A', 'n', 'a']);
    const plainList = await readUntil(() => browser.execute(() =>
      Array.from(document.querySelectorAll('.suggestion-container .suggestion-item')).map((e) => e.textContent)
    ), (l) => l.length > 0);
    await browser.keys(['Escape']);
    expect(plainList.length).toBeGreaterThan(0);
    expect(plainList.filter((t) => t.includes('[Politics'))).toEqual([]);
    await browser.executeObsidianCommand('switcher:open');
    await browser.$('.prompt input').waitForExist({ timeout: 5000 });
    await browser.keys(['A', 'n', 'a']);
    const switched = await readUntil(() => browser.execute(() =>
      Array.from(document.querySelectorAll('.prompt .suggestion-item')).map((e) => e.textContent)
    ), (l) => l.length > 0 && l.some((x) => x.includes('Ana')));
    await browser.keys(['Escape']);
    await browser.pause(300);
    expect(switched.length).toBeGreaterThan(0);
    expect(switched.filter((t) => t.includes('[Politics'))).toEqual([]);

    // Renames: at once where Obsidian updates links itself…
    const updated = await browser.executeObsidian(async ({ app }) => {
      const before = app.vault.getConfig('alwaysUpdateLinks');
      app.vault.setConfig('alwaysUpdateLinks', true);
      await app.fileManager.renameFile(app.vault.getFileByPath('Target one.md'), 'Target first.md');
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(async () => (await app.vault.read(app.vault.getFileByPath('Quiet.md'))).includes('[[[Target first|the first]]]'));
      app.vault.setConfig('alwaysUpdateLinks', before);
      return app.vault.read(app.vault.getFileByPath('Quiet.md'));
    });
    expect(updated).toContain('[[[Target first|the first]]]');

    // …and otherwise from a notice, when asked.
    await browser.executeObsidian(async ({ app }) => {
      app.vault.setConfig('alwaysUpdateLinks', false);
      await app.fileManager.renameFile(app.vault.getFileByPath('Target two.md'), 'Target second.md');
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => Array.from(document.querySelectorAll('.notice .dr-undo')).some((a) => a.textContent === 'Update them'));
    });
    const asked = await browser.execute(() => {
      const button = Array.from(document.querySelectorAll('.notice .dr-undo')).find((a) => a.textContent === 'Update them');
      if (button) button.click();
      return !!button;
    });
    expect(asked).toBe(true);
    const updatedLater = await browser.executeObsidian(async ({ app, plugins }) => {
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      const read = () => app.vault.read(app.vault.getFileByPath('Quiet.md'));
      await until(async () => (await read()).includes('related: "[[[Target second]]]"'));
      const text = await read();
      for (const p of ['Quiet.md', 'Target first.md', 'Target second.md', 'Not yet written.md']) {
        const f = app.vault.getFileByPath(p);
        if (f) await app.vault.delete(f);
      }
      plugins.designRedux.settings.quietLinks = false;
      await plugins.designRedux.saveSettings();
      return text;
    });
    expect(updatedLater).toContain('related: "[[[Target second]]]"');
  });

  after(async function () {
    const errors = await browser.executeObsidian(() => window.__drErrors || []);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${version}-errors.txt`), errors.join('\n\n') || 'none');
  });

  it('makes quiet links normal for sharing and back, and folds in notes they made elsewhere', async function () {
    this.timeout(120000);
    const original = 'See [[[Politics/Anarchy]]] and [[[Politics/Deterrence|deterrence]]].\n\n```\nx = a[[[1]]]\n```\n';
    await browser.executeObsidian(async ({ app, plugins }, text) => {
      plugins.designRedux.settings.quietLinks = true;
      await plugins.designRedux.saveSettings();
      await app.vault.create('Share.md', text);
      await new Promise((r) => setTimeout(r, 1500));
      const quiet = plugins.designRedux.features.find((f) => f.constructor.name === 'QuietLinks');
      quiet.makePortable();
    }, original);
    await browser.$('.modal .mod-cta').waitForExist({ timeout: 5000 });
    await clickText('.modal .mod-cta', 'Make them normal');
    await browser.pause(1500);
    const shared = await browser.executeObsidian(async ({ app }) => {
      const text = await app.vault.read(app.vault.getFileByPath('Share.md'));
      const found = app.metadataCache.getBacklinksForFile(app.vault.getFileByPath('Politics/Anarchy.md'));
      const from = found && found.data ? (found.data instanceof Map ? Array.from(found.data.keys()) : Object.keys(found.data)) : [];
      return { text, backlinked: from.includes('Share.md') };
    });
    expect(shared.text).toBe('See [[Politics/Anarchy]]%%quiet%% and [[Politics/Deterrence|deterrence]]%%quiet%%.\n\n```\nx = a[[[1]]]\n```\n');
    expect(shared.backlinked).toBe(true);

    const back = await browser.executeObsidian(async ({ app, plugins }) => {
      const quiet = plugins.designRedux.features.find((f) => f.constructor.name === 'QuietLinks');
      await quiet.makeQuietAgain(true);
      await new Promise((r) => setTimeout(r, 800));
      return app.vault.read(app.vault.getFileByPath('Share.md'));
    });
    expect(back).toBe(original);

    // A device without the plugin made "[Politics/Anarchy" from the link; "[Draft] Essay" is just a name.
    const folded = await browser.executeObsidian(async ({ app, plugins }) => {
      await app.vault.createFolder('[Politics');
      await app.vault.create('[Politics/Anarchy.md', 'Written elsewhere.');
      await app.vault.create('[Draft] Essay.md', 'Just a name.');
      await new Promise((r) => setTimeout(r, 1500));
      const quiet = plugins.designRedux.features.find((f) => f.constructor.name === 'QuietLinks');
      const strays = quiet.strays();
      const listed = strays.map((s) => [s.file.path, s.real ? s.real.path : null]);
      for (const stray of strays) await quiet.fold(stray);
      await new Promise((r) => setTimeout(r, 800));
      const anarchy = await app.vault.read(app.vault.getFileByPath('Politics/Anarchy.md'));
      const result = {
        listed,
        added: anarchy.trim().endsWith('Written elsewhere.'),
        strayGone: !app.vault.getAbstractFileByPath('[Politics/Anarchy.md'),
        folderGone: !app.vault.getAbstractFileByPath('[Politics'),
        draftKept: !!app.vault.getFileByPath('[Draft] Essay.md'),
      };
      for (const p of ['Share.md', '[Draft] Essay.md']) {
        const f = app.vault.getFileByPath(p);
        if (f) await app.vault.delete(f);
      }
      plugins.designRedux.settings.quietLinks = false;
      await plugins.designRedux.saveSettings();
      return result;
    });
    expect(folded).toEqual({
      listed: [['[Politics/Anarchy.md', 'Politics/Anarchy.md']],
      added: true,
      strayGone: true,
      folderGone: true,
      draftKept: true,
    });
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

    // The footnote button along the bottom opens the view.
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
    expect(shown).toEqual([listed, `“${other}” in ${listed === 'parent' ? 2 : 1}`]);
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

  it('logged no errors of its own along the way', async function () {
    const errors = await browser.executeObsidian(() => window.__drErrors || []);
    const ours = errors.filter((e) => /design redux|plugin:design-redux/i.test(e));
    expect(ours).toEqual([]);
  });
});
