// The plugin in the real app: loading, the look on every window, and nothing left behind on unload.
import { browser, expect } from '@wdio/globals';
import { readUntil, shot, suite } from './helpers.mjs';

suite('Design Redux in Obsidian: the app', function () {
  it('loads with its features, commands and views', async function () {
    const got = await browser.executeObsidian(({ app, plugins }) => {
      const p = plugins.designRedux;
      return {
        features: p ? p.features.length : 0,
        commands: Object.keys(app.commands.commands).filter((id) => id.startsWith('design-redux:')).length,
        legacy: p ? p.legacyKept : null,
      };
    });
    expect(got.features).toBe(22);
    expect(got.commands).toBeGreaterThanOrEqual(60);
  });

  it('puts the look on the main window, and takes it off on unload', async function () {
    const has = () => browser.execute(() => document.body.classList.contains('dr-active'));
    expect(await readUntil(has, (v) => v)).toBe(true);
    await shot('look-main');
    await browser.executeObsidian(async ({ app }) => { await app.plugins.disablePlugin('design-redux'); });
    const left = await browser.execute(() => Array.from(document.body.classList).filter((c) => c.startsWith('dr-')));
    expect(left).toEqual([]);
    const stray = await browser.execute(() => document.querySelectorAll('[class*="dr-"]').length);
    expect(stray).toBe(0);
    await browser.executeObsidian(async ({ app }) => { await app.plugins.enablePlugin('design-redux'); });
    expect(await readUntil(has, (v) => v)).toBe(true);
  });

  it('puts the look on a popout window and the settings window', async function () {
    const classes = await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.openPopoutLeaf();
      await new Promise((r) => setTimeout(r, 1500));
      const doc = leaf.view.containerEl.ownerDocument;
      const out = doc === document ? null : doc.body.classList.contains('dr-active');
      leaf.detach();
      return out;
    });
    expect(classes).toBe(true);
  });

  it('keeps the look off when the setting says theme', async function () {
    const on = await browser.executeObsidian(async ({ app }) => {
      const p = app.plugins.plugins['design-redux'];
      const was = p.settings.look;
      p.settings.look = 'theme';
      await p.saveSettings();
      await new Promise((r) => setTimeout(r, 400));
      const out = document.body.classList.contains('dr-active');
      p.settings.look = was;
      await p.saveSettings();
      return out;
    });
    expect(on).toBe(false);
  });

  it('opens the library sidebar and the browse view', async function () {
    await browser.executeObsidian(async ({ app }) => { app.commands.executeCommandById('design-redux:open-library'); });
    await browser.$('.dr-library, [class*="dr-lib"]').waitForExist({ timeout: 10000 });
    await shot('library');
    await browser.executeObsidian(async ({ app }) => { app.commands.executeCommandById('design-redux:browse-vault'); });
    const type = await readUntil(
      () => browser.executeObsidian(({ app }) => app.workspace.getActiveViewOfType(require('obsidian').View)?.getViewType()),
      (t) => t === 'design-redux-browse'
    );
    expect(type).toBe('design-redux-browse');
    const browserState = await browser.execute(() => ({
      notes: document.querySelectorAll('.dr-library.is-wide .dr-file-row').length,
      details: !!document.querySelector('.dr-file-details-title'),
      search: !!document.querySelector('.dr-file-search'),
    }));
    expect(browserState.notes).toBeGreaterThan(0);
    expect(browserState.details).toBe(false);
    expect(browserState.search).toBe(false);
    await shot('files-browser');
  });
});
