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
const SHOTS = ['album', 'home', 'note-and-strip', 'graph-routes'];

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

async function menuTitles() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('.menu .menu-item-title')).map((e) => e.textContent.trim())
  );
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
      await app.plugins.enablePlugin('design-redux');
    });
    await browser.pause(1500);
  });

  afterEach(async function () {
    if (this.currentTest && this.currentTest.state === 'failed') {
      const name = this.currentTest.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 50);
      await shot(`FAILED-${name}`);
    }
  });

  it('loads, with its features running', async function () {
    const state = await browser.executeObsidian(({ plugins }) => {
      const p = plugins.designRedux;
      return p ? p.features.map((f) => [f.constructor.name, !!f.enabled]) : null;
    });
    expect(state).not.toBeNull();
    const on = Object.fromEntries(state);
    // Switched on by default.
    for (const name of ['Library', 'ContextStrip', 'CoverImages', 'Scripts', 'CanvasLegend', 'CanvasAlign', 'BulkEditing']) {
      expect([name, on[name]]).toEqual([name, true]);
    }
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

  it('draws its settings as four tabs', async function () {
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
    expect(where.tabs).toBe(4);

    // A screenshot from whichever window they're in.
    const main = await browser.getWindowHandle();
    if (!where.sameWindow) {
      for (const handle of await browser.getWindowHandles()) {
        if (handle === main) continue;
        await browser.switchToWindow(handle);
        if ((await browser.$$('.dr-settings').length) > 0) break;
      }
    }
    await shot('settings-library');
    await clickText('.dr-settings .dr-set-tab', 'Browsing');
    await shot('settings-browsing');
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
    await browser.pause(700);
    await shot('menu');
    expect(await menuTitles()).toContain('Canvas');
    await closeMenus();
    await closeMenus();
  });

  it('opens the Properties window with tabs, and Escape closes it', async function () {
    await browser.executeObsidianCommand('design-redux:add-properties-to-folders');
    await browser.$('.dr-props-modal').waitForExist({ timeout: 5000 });
    const tabs = await browser.$$('.dr-props-modal .dr-set-tab');
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    // Each tab, as it looks: the window's design is judged from these.
    await shot('properties-add');
    for (const [tab, name] of [['Remove', 'remove'], ['Find missing', 'missing'], ['Defaults', 'defaults']]) {
      await clickText('.dr-props-modal .dr-set-tab', tab);
      await shot(`properties-${name}`);
    }
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
        metadataContainers: Array.from(document.querySelectorAll('.metadata-container')).map((e) => [
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
      const on = standIns();
      plugin.settings.quietLinks = false;
      await plugin.saveSettings();
      await new Promise((r) => setTimeout(r, 800));
      const off = standIns();
      plugin.settings.quietLinks = true;
      await plugin.saveSettings();
      await new Promise((r) => setTimeout(r, 800));
      return { on, off, again: standIns() };
    });
    expect(counts.on).toEqual([]);
    expect(counts.off.length).toBeGreaterThan(0);
    expect(counts.again).toEqual([]);

    // Reading view: the note each names, dotted, and no stray bracket.
    const reading = await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.setViewState({ type: 'markdown', state: { file: 'Quiet.md', mode: 'preview' } });
      await new Promise((r) => setTimeout(r, 1200));
      const p = leaf.view.containerEl.querySelector('.markdown-preview-view p');
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
      await new Promise((r) => setTimeout(r, 1000));
      leaf.view.editor.setCursor({ line: 0, ch: 0 });
      await new Promise((r) => setTimeout(r, 400));
      return Array.from(leaf.view.containerEl.querySelectorAll('.cm-content .dr-quiet-link')).map((e) => e.textContent);
    });
    expect(live).toEqual(['Politics/Anarchy', 'the first', 'Not yet written']);
    const missing = await browser.$('.cm-content .dr-quiet-link[data-href="Not yet written"]');
    await missing.click();
    await browser.pause(1000);
    const made = await browser.executeObsidian(({ app }) => (app.workspace.getActiveFile() || {}).path);
    expect(made).toBe('Not yet written.md');
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath('Quiet.md'));
      await new Promise((r) => setTimeout(r, 800));
    });

    // Obsidian's own properties block names the note, not the stand-in.
    const property = await browser.executeObsidian(({ app }) => {
      const leaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
      const link = leaf.view.containerEl.querySelector('.metadata-container .internal-link.dr-quiet-link');
      return link ? [link.getAttribute('data-href'), link.textContent] : null;
    });
    expect(property).toEqual(['Target two', 'Target two']);

    // The graph: no quiet line, and no "[Name" stand-in.
    const graph = await browser.executeObsidian(async ({ app }) => {
      app.commands.executeCommandById('graph:open');
      await new Promise((r) => setTimeout(r, 2500));
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
      await new Promise((r) => setTimeout(r, 1500));
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
      await new Promise((r) => setTimeout(r, 600));
      const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView).editor;
      const last = editor.lastLine();
      editor.setCursor({ line: last, ch: editor.getLine(last).length });
      editor.replaceSelection('\nTyped ');
      editor.focus();
    });
    await browser.keys(['[', '[', '[', 'D', 'e', 't']);
    await browser.pause(900);
    const listed = await browser.execute(() =>
      Array.from(document.querySelectorAll('.suggestion-container .dr-quiet-suggest')).map((e) => e.textContent)
    );
    expect(listed.length).toBeGreaterThan(0);
    await browser.keys(['Enter']);
    await browser.pause(600);
    const typed = await browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView).editor;
      return editor.getLine(editor.lastLine());
    });
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
    await browser.pause(900);
    const plainList = await browser.execute(() =>
      Array.from(document.querySelectorAll('.suggestion-container .suggestion-item')).map((e) => e.textContent)
    );
    await browser.keys(['Escape']);
    expect(plainList.length).toBeGreaterThan(0);
    expect(plainList.filter((t) => t.includes('[Politics'))).toEqual([]);
    await browser.executeObsidianCommand('switcher:open');
    await browser.pause(500);
    await browser.keys(['A', 'n', 'a']);
    await browser.pause(800);
    const switched = await browser.execute(() =>
      Array.from(document.querySelectorAll('.prompt .suggestion-item')).map((e) => e.textContent)
    );
    await browser.keys(['Escape']);
    await browser.pause(300);
    expect(switched.length).toBeGreaterThan(0);
    expect(switched.filter((t) => t.includes('[Politics'))).toEqual([]);

    // Renames: at once where Obsidian updates links itself…
    const updated = await browser.executeObsidian(async ({ app }) => {
      const before = app.vault.getConfig('alwaysUpdateLinks');
      app.vault.setConfig('alwaysUpdateLinks', true);
      await app.fileManager.renameFile(app.vault.getFileByPath('Target one.md'), 'Target first.md');
      await new Promise((r) => setTimeout(r, 1500));
      app.vault.setConfig('alwaysUpdateLinks', before);
      return app.vault.read(app.vault.getFileByPath('Quiet.md'));
    });
    expect(updated).toContain('[[[Target first|the first]]]');

    // …and otherwise from a notice, when asked.
    await browser.executeObsidian(async ({ app }) => {
      app.vault.setConfig('alwaysUpdateLinks', false);
      await app.fileManager.renameFile(app.vault.getFileByPath('Target two.md'), 'Target second.md');
      await new Promise((r) => setTimeout(r, 1200));
    });
    const asked = await browser.execute(() => {
      const button = Array.from(document.querySelectorAll('.notice .dr-undo')).find((a) => a.textContent === 'Update them');
      if (button) button.click();
      return !!button;
    });
    expect(asked).toBe(true);
    await browser.pause(1200);
    const updatedLater = await browser.executeObsidian(async ({ app, plugins }) => {
      const text = await app.vault.read(app.vault.getFileByPath('Quiet.md'));
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
      await new Promise((r) => setTimeout(r, 1500));
      app.commands.executeCommandById('graph:open');
      await new Promise((r) => setTimeout(r, 2500));
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
      await new Promise((r) => setTimeout(r, 1500));
      const has = (a, b) => view.renderer.links.some((l) => l.source.id === a && l.target.id === b);
      const [W, M, I, C] = names;
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
      await new Promise((r) => setTimeout(r, 1500));
      const r = leaf.view.renderer;
      r.highlightNode = null;
      const has = (a, b) => r.links.some((l) => l.source.id === a && l.target.id === b);
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

  it('logged no errors of its own along the way', async function () {
    const errors = await browser.executeObsidian(() => window.__drErrors || []);
    const ours = errors.filter((e) => /design redux|plugin:design-redux/i.test(e));
    expect(ours).toEqual([]);
  });
});
