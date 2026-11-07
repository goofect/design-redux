// Design Redux inside the real Obsidian app: loading, settings, the unofficial parts it relies on, the look, menus and diagnostics.
// What every spec shares, and how each test starts from the same place: helpers.mjs.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import fs from 'fs';
import path from 'path';
import { ACTIVE, OUT, clickText, closeMenus, menuTitles, openAlbum, perf, readUntil, shot, suite, version } from './helpers.mjs';

suite('Design Redux in Obsidian: the app', function () {
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
    // The library's rows a little slimmer than the density's own.
    expect(dark.rows[0][0]).toBe(26);
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
    expect([compact.rows[0][0], spacious.rows[0][0]]).toEqual([22, 30]);
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

  it('groups its right-click entries, with New canvas under New', async function () {
    await openAlbum('Politics');
    const disc = await browser.$(ACTIVE + '.dr-disc[data-folder="Politics/Theories"]');
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

  it('draws the shared components to their measures, in light and dark', async function () {
    const measure = () =>
      browser.executeObsidian(async ({ app }) => {
        await new Promise((r) => setTimeout(r, 400));
        const box = document.body.createDiv({ cls: 'dr-settings dr-component-probe' });
        const icon = box.createDiv({ cls: 'dr-icon-button' });
        const main = box.createDiv({ cls: 'dr-detail-action is-primary', text: 'Open' });
        const plain = box.createDiv({ cls: 'dr-detail-action', text: 'Edit' });
        const seg = box.createDiv({ cls: 'dr-segmented' });
        seg.createDiv({ cls: 'dr-segment is-active', text: 'One' });
        seg.createDiv({ cls: 'dr-segment', text: 'Two' });
        const art = box.createDiv({ cls: 'dr-card' }).createDiv({ cls: 'dr-card-art' });
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
});
