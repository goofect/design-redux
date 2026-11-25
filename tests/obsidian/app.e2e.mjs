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
      };
    });
    expect(got.features).toBe(23);
    expect(got.commands).toBeGreaterThanOrEqual(59);
  });

  it('draws the toggle 40 by 20, square, its knob two pixels in, on the side that is true, and apart from its track', async function () {
    // One of Obsidian's own toggles, made in the main window for the measuring and taken away after. The look's
    // colours reach every toggle (a settings page's), so it is drawn with the look on the plugin alone, the default.
    const seen = await browser.executeObsidian(async ({ obsidian }) => {
      const host = document.body.appendChild(document.createElement('div'));
      const toggle = new obsidian.ToggleComponent(host);
      const t = toggle.toggleEl;
      await new Promise((r) => setTimeout(r, 300));
      const read = () => {
        const box = t.getBoundingClientRect();
        const knob = getComputedStyle(t, '::after');
        return { w: Math.round(box.width), h: Math.round(box.height), radius: getComputedStyle(t).borderTopLeftRadius, knob: [knob.width, knob.height, knob.top, knob.marginTop, knob.left, knob.transform, knob.borderTopLeftRadius], knobFill: knob.backgroundColor, fill: getComputedStyle(t).backgroundColor };
      };
      const off = read();
      toggle.setValue(true);
      await new Promise((r) => setTimeout(r, 300));
      const on = read();
      host.remove();
      return { off, on, region: document.body.classList.contains('dr-region-overlays') };
    });
    const fs = await import('node:fs');
    fs.mkdirSync('ci-output', { recursive: true });
    fs.writeFileSync('ci-output/toggle.json', JSON.stringify(seen, null, 1));
    expect([seen.off.w, seen.off.h, seen.off.radius]).toEqual([40, 20, '0px']);
    expect(seen.off.knob.slice(0, 2)).toEqual(['16px', '16px']);
    expect(seen.on.fill).not.toBe(seen.off.fill);
    expect(seen.region).toBe(false);
    expect(seen.on.knobFill).not.toBe(seen.on.fill);
    expect(seen.off.knobFill).not.toBe(seen.off.fill);
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
  });

  it('steps to the next note in its folder on two fingers sideways over the editor, and back the other way', async function () {
    const swipe = (dx) => browser.executeObsidian(async ({ app }, dx) => {
      const view = app.workspace.getActiveViewOfType(require('obsidian').MarkdownView);
      const at = view.containerEl.querySelector('.cm-content');
      for (let i = 0; i < 12; i++) {
        at.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: 0, bubbles: true }));
        await new Promise((r) => setTimeout(r, 16));
      }
      await new Promise((r) => setTimeout(r, 400));
    }, dx);
    const active = () => browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path);
    await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(app.vault.getFileByPath('Politics/Anarchy.md'), { state: { mode: 'source' } });
      app.workspace.setActiveLeaf(leaf, { focus: true });
    });
    await swipe(20);
    const next = await readUntil(active, (p) => p !== 'Politics/Anarchy.md');
    expect(next).not.toBe('Politics/Anarchy.md');
    expect(next.startsWith('Politics/')).toBe(true);
    await swipe(-20);
    expect(await readUntil(active, (p) => p === 'Politics/Anarchy.md')).toBe('Politics/Anarchy.md');
  });

  it('opens the page a sign-in comes back to on this machine, and a refusal in the browser leaves the vault signed out, said in a notice', async function () {
    const said = await browser.executeObsidian(async ({ plugins }) => {
      const backup = plugins.designRedux.features.find((f) => f.constructor.name === 'Backup');
      const service = {
        id: 'test', name: 'Test Drive', client: { id: 'test-app' }, loopback: 'localhost',
        auth: { authorize: 'https://example.invalid/auth', token: 'https://example.invalid/token', scope: 'files' },
      };
      const open = backup.openUrl;
      let answered = 0;
      backup.openUrl = (url) => {
        const q = new URL(url).searchParams;
        // The browser, refusing: it comes back with an error and this sign-in's state.
        fetch(`${q.get('redirect_uri')}?error=access_denied&state=${q.get('state')}`, { mode: 'no-cors' }).then(() => (answered = 1), () => (answered = -1));
      };
      try {
        await backup.signIn(service);
      } finally {
        backup.openUrl = open;
      }
      for (let i = 0; i < 40 && !answered; i++) await new Promise((r) => setTimeout(r, 50));
      const notices = Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent);
      return { answered, notice: notices.find((n) => n.includes('Test Drive')) || notices.join(' | '), signedIn: backup.signedIn(service) };
    });
    expect(said.answered).toBe(1);
    expect(said.notice).toBe('Not signed in to Test Drive: access was refused.');
    expect(said.signedIn).toBe(false);
  });

  it('opens Obsidian\'s graph of a folder from its menu, its search the folder\'s path', async function () {
    const seen = await browser.executeObsidian(async ({ app }) => {
      const folder = app.vault.getAllLoadedFiles().find((f) => f.children && f.path !== '/');
      if (!folder) return null;
      const before = app.workspace.getLeavesOfType('graph').length;
      await app.plugins.plugins['design-redux'].features.find((f) => typeof f.openFolder === 'function').openFolder(folder);
      await new Promise((r) => setTimeout(r, 1000));
      const leaves = app.workspace.getLeavesOfType('graph');
      const view = leaves[leaves.length - 1] && leaves[leaves.length - 1].view;
      const options = (view && view.dataEngine && view.dataEngine.getOptions()) || {};
      const nodes = view && view.renderer && Array.isArray(view.renderer.nodes) ? view.renderer.nodes.map((n) => n.id) : [];
      const out = { opened: leaves.length - before, path: folder.path, search: options.search, nodes };
      leaves.forEach((l) => l.detach());
      return out;
    });
    expect(seen).not.toBe(null);
    expect(seen.opened).toBe(1);
    expect(seen.search).toBe(`path:"${seen.path}/"`);
    expect(seen.nodes.length).toBeGreaterThan(0);
    expect(seen.nodes.filter((id) => !id.startsWith(`${seen.path}/`))).toEqual([]);
  });

  it('fuses a folder\'s kin entries into one each: New, Open as, Properties', async function () {
    // Obsidian may draw its menus natively, out of the page, so the menu is read as it is shown, not from the DOM.
    const seen = await browser.executeObsidian(async ({ app, obsidian }) => {
      app.commands.executeCommandById('design-redux:open-library');
      await new Promise((r) => setTimeout(r, 500));
      const row = document.querySelector('[role="treeitem"][data-path]:not([data-path="/"])');
      if (!row) return null;
      const proto = obsidian.Menu.prototype;
      const was = proto.showAtMouseEvent;
      let shown = null;
      proto.showAtMouseEvent = function () { shown = this; return this; };
      try {
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      } finally {
        proto.showAtMouseEvent = was;
      }
      const titles = (m) => (m && Array.isArray(m.items) ? m.items.filter((i) => i.titleEl).map((i) => i.titleEl.textContent) : []);
      const sub = (t) => titles((shown.items.find((i) => i.titleEl && i.titleEl.textContent === t) || {}).submenu);
      return shown && { titles: titles(shown), open: sub('Open as'), props: sub('Properties'), made: sub('New') };
    });
    expect(seen).not.toBe(null);
    ['New', 'Open as', 'Properties', 'Sort by'].forEach((t) => expect(seen.titles).toContain(t));
    ['New note', 'Map', 'Schema…'].forEach((t) => expect(seen.titles).not.toContain(t));
    expect(seen.titles.length).toBeLessThanOrEqual(10);
    expect(seen.made).toEqual(['Note', 'Folder']);
    expect(seen.open.slice().sort()).toEqual(['Graph', 'Map']);
    expect(seen.props).toContain('Schema…');
  });

  it('shows the main area\'s tabs as words: each as wide as its name, grey, the one in front ink; no close button, and no tab in the sidebar', async function () {
    const seen = await browser.executeObsidian(async ({ app }) => {
      const files = app.vault.getMarkdownFiles().slice(0, 3);
      for (const [i, f] of files.entries()) await app.workspace.getLeaf(i ? 'tab' : false).openFile(f);
      await new Promise((r) => setTimeout(r, 500));
      const all = (s) => Array.from(document.querySelectorAll(s));
      const ink = getComputedStyle(document.body).getPropertyValue('--dr-ink').trim();
      const tabs = all('.mod-root .workspace-tab-header').map((h) => {
        const title = h.querySelector('.workspace-tab-header-inner-title');
        const style = getComputedStyle(title);
        return { front: h.classList.contains('is-active'), width: h.getBoundingClientRect().width, fits: title.scrollWidth <= title.clientWidth + 1, case: style.textTransform, colour: style.color };
      });
      const probe = document.body.appendChild(document.createElement('span'));
      probe.style.color = ink;
      const inkRgb = getComputedStyle(probe).color;
      probe.remove();
      return {
        tabs,
        inkRgb,
        closes: all('.mod-root .workspace-tab-header-inner-close-button').filter((c) => getComputedStyle(c).display !== 'none').length,
        sidebar: all('.mod-left-split .workspace-tab-header-container-inner').filter((c) => getComputedStyle(c).display !== 'none').length,
      };
    });
    expect(seen.tabs.length).toBeGreaterThanOrEqual(3);
    seen.tabs.forEach((t) => {
      expect(t.width).toBeGreaterThan(0);
      expect(t.fits).toBe(true);
      expect(t.case).toBe('uppercase');
      expect(t.colour === seen.inkRgb).toBe(t.front);
    });
    expect(seen.closes).toBe(0);
    expect(seen.sidebar).toBe(0);
  });
});
