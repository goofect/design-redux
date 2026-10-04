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
const SHOTS = ['album', 'home', 'note-and-strip', 'graph-routes', 'footnote-box', 'properties-edit', 'properties-list', 'properties-sheet', 'footnotes-view'];

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

  it('folds a canvas card to its title, peeks at it, and folds every card at once', async function () {
    await obsidianPage.openFile('Map.canvas');
    await browser.$(ACTIVE + '.canvas-node .dr-fold-btn').waitForExist({ timeout: 10000 });
    const sizes = () =>
      browser.executeObsidian(({ app }) => {
        const canvas = app.workspace.activeLeaf.view.canvas;
        const out = {};
        canvas.nodes.forEach((node, id) => {
          node.nodeEl.setAttribute('data-test-id', id);
          const face = node.nodeEl.querySelector('.dr-fold-face-title');
          out[id] = { height: node.height, folded: node.nodeEl.classList.contains('dr-folded'), face: face ? face.textContent : null };
        });
        return out;
      });
    // Every card in view, none selected, whatever the test before left.
    await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      if (typeof canvas.deselectAll === 'function') canvas.deselectAll();
      if (typeof canvas.zoomToFit === 'function') canvas.zoomToFit();
    });
    await browser.pause(600);
    const before = await sizes();
    expect(before.note1.height).toBe(200);
    await browser.$(ACTIVE + '[data-test-id="note1"]').waitForExist({ timeout: 5000 });

    // The note card's arrow folds it to its first line.
    await browser.$(ACTIVE + '[data-test-id="note1"]').moveTo();
    await browser.$(ACTIVE + '[data-test-id="note1"] .dr-fold-btn').click();
    await browser.waitUntil(async () => (await sizes()).note1.folded, { timeout: 5000, timeoutMsg: 'the card never folded' });
    await browser.waitUntil(async () => (await sizes()).note1.height < 120, { timeout: 5000, timeoutMsg: 'the card never got shorter' });
    const folded = await sizes();
    expect(folded.note1.height).toBeGreaterThan(30);
    expect(folded.note1.face).toBe('Anarchy');
    expect(folded.red1.folded).toBe(false);
    await shot('canvas-folded');

    // Pointed at, it shows all of it.
    await browser.$(ACTIVE + '[data-test-id="green1"]').moveTo();
    await browser.$(ACTIVE + '[data-test-id="note1"]').moveTo();
    await browser.$('.dr-fold-peek').waitForExist({ timeout: 5000, timeoutMsg: 'no peek at the folded card' });
    await browser.waitUntil(async () => (await browser.$('.dr-fold-peek').getText()).includes('no government above them'), {
      timeout: 5000,
      timeoutMsg: 'the peek never showed the note',
    });
    await browser.keys('Escape');

    // The fold is kept in the canvas file.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const text = await app.vault.read(app.vault.getFileByPath('Map.canvas'));
          const node = JSON.parse(text).nodes.find((n) => n.id === 'note1');
          return !!(node.drFold && node.drFold.height === 200);
        }),
      { timeout: 6000, interval: 300, timeoutMsg: 'the fold was never saved' }
    );

    // Opened to edit, a folded card is as tall as it was while it's edited, and folded still.
    await browser.executeObsidian(async ({ app, plugins }) => {
      const view = app.workspace.activeLeaf.view;
      const fold = plugins.designRedux.features.find((f) => f.constructor.name === 'CanvasFold');
      await fold.fold(view, [view.canvas.nodes.get('green1')], true);
    });
    const tall = () => browser.execute((sel) => document.querySelector(sel).getBoundingClientRect().height, ACTIVE + '[data-test-id="green1"]');
    const shut = await tall();
    await browser.$(ACTIVE + '[data-test-id="green1"]').doubleClick();
    await browser.waitUntil(async () => (await tall()) > shut + 10, { timeout: 5000, timeoutMsg: 'the folded card never opened to be edited' });
    expect((await sizes()).green1.folded).toBe(true);
    // Done editing: clicked away.
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.deselectAll());
    await browser.waitUntil(async () => Math.abs((await tall()) - shut) < 2, { timeout: 5000, timeoutMsg: 'it never folded again after editing' });
    await browser.executeObsidian(async ({ app, plugins }) => {
      const view = app.workspace.activeLeaf.view;
      const fold = plugins.designRedux.features.find((f) => f.constructor.name === 'CanvasFold');
      await fold.fold(view, [view.canvas.nodes.get('green1')], false);
    });

    // Pressed again, it's back to the size it was.
    await browser.$(ACTIVE + '[data-test-id="note1"] .dr-fold-btn').click();
    await browser.waitUntil(async () => (await sizes()).note1.height === 200, { timeout: 5000, timeoutMsg: 'never back to its size' });
    expect((await sizes()).note1.folded).toBe(false);

    // The control beside the zoom buttons: a menu, to fold every card, then unfold them.
    const control = await browser.$(ACTIVE + '.canvas-controls .dr-fold-control .canvas-control-item');
    expect(await control.getAttribute('aria-label')).toBe('Folding');
    const pick = async (title) => {
      await control.click();
      await browser.waitUntil(async () => (await menuTitles()).includes(title), { timeout: 4000, timeoutMsg: `no ${title} in the menu` });
      await clickText('.menu .menu-item', title);
    };
    await pick('Fold every card');
    await browser.waitUntil(async () => Object.values(await sizes()).every((s) => s.folded), {
      timeout: 5000,
      timeoutMsg: 'not every card folded',
    });
    await pick('Unfold every card');
    await browser.waitUntil(
      async () => {
        const now = await sizes();
        return Object.keys(before).every((id) => !now[id].folded && now[id].height === before[id].height);
      },
      { timeout: 5000, timeoutMsg: 'not every card back as it was' }
    );

    // A card's right-click menu offers it too — one in the middle, clear of the legend.
    await browser.$(ACTIVE + '[data-test-id="green1"]').click();
    await browser.pause(300);
    await browser.$(ACTIVE + '[data-test-id="green1"]').click({ button: 'right' });
    await browser
      .waitUntil(async () => (await menuTitles()).includes('Fold card'), { timeout: 4000, interval: 200 })
      .catch(() => {});
    expect(await menuTitles()).toContain('Fold card');
    await closeMenus();
  });

  it('folds a branch and a group, closing the gaps; the outline follows; Undo puts it back', async function () {
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
    await browser.$(ACTIVE + '.canvas-node .dr-branch-knob').waitForExist({ timeout: 10000 });
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

    // Realism's knob: Power is tucked away; Anarchy, which Waltz leads to too, stays out.
    await browser.$(ACTIVE + '[data-test-id="a"]').moveTo();
    await browser.$(ACTIVE + '[data-test-id="a"] .dr-branch-knob').click();
    await browser.waitUntil(async () => (await cards()).a2.hidden, { timeout: 5000, timeoutMsg: 'the branch never folded' });
    let now = await cards();
    expect(now.a1.hidden).toBe(false);
    expect(await browser.$(ACTIVE + '[data-test-id="a"] .dr-branch-knob').getText()).toBe('+1');
    // Its room closed up: Liberalism, the group and what's below it move up by Power's overhang.
    expect(before.b.y - now.b.y).toBe(60);
    expect(before.below.y - now.below.y).toBe(60);
    expect(now.root.y).toBe(before.root.y);

    // The group folds from its arrow, its card tucked inside, and what's below closes up.
    await browser.$(ACTIVE + '[data-test-id="g"] .dr-fold-btn').click();
    await browser.waitUntil(async () => (await cards()).g1.hidden, { timeout: 5000, timeoutMsg: 'the group never folded' });
    now = await cards();
    expect(now.g.height).toBe(48);
    expect(now.below.y).toBe(before.below.y - 60 - 152);
    // Waltz's arrow to Anarchy now starts at the folded group.
    const fromBar = await browser.executeObsidian(({ app }) => {
      const canvas = app.workspace.activeLeaf.view.canvas;
      const g = canvas.nodes.get('g').getBBox();
      const d = canvas.edges.get('e5').path.display.getAttribute('d');
      const start = d.match(/^M\s*(-?[\d.]+)[ ,](-?[\d.]+)/);
      return Number(start[1]) >= g.minX && Number(start[1]) <= g.maxX + 1 && Number(start[2]) >= g.minY - 1 && Number(start[2]) <= g.maxY + 1;
    });
    expect(fromBar).toBe(true);
    await shot('canvas-tree-folded');

    // Kept in the file.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const nodes = JSON.parse(await app.vault.read(app.vault.getFileByPath('Tree.canvas'))).nodes;
          const find = (id) => nodes.find((n) => n.id === id);
          return !!(find('a2').drTuck && find('a2').drTuck.by === 'a' && find('g1').drTuck && find('g').drFold);
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
    expect(rows).toEqual(['Anarchy', 'Theory', 'Realism+1', 'Liberalism', 'Reading+1', 'Below']);

    // Unfolded from the outline: the group opens and what's below moves back down.
    await browser.execute(() => {
      const row = Array.from(document.querySelectorAll('.dr-canvas-outline .dr-outline-row')).find((r) => r.textContent.startsWith('Reading'));
      row.querySelector('.collapse-icon').click();
    });
    await browser.waitUntil(async () => !(await cards()).g1.hidden && (await cards()).below.y === before.below.y - 60, {
      timeout: 5000,
      timeoutMsg: 'the group never unfolded',
    });

    // Undo folds it again.
    await browser.pause(2500);
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.canvas.undo());
    await browser.$(ACTIVE + '.canvas-wrapper').click();
    await browser.waitUntil(async () => (await cards()).g1.hidden, { timeout: 5000, timeoutMsg: 'Undo didn’t fold the group again' });

    await browser.executeObsidian(async ({ app }) => {
      app.workspace.getLeavesOfType('design-redux-canvas-outline').forEach((leaf) => leaf.detach());
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
      // Listed as "parent", since that's how it was first met; most notes write "Parent".
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
    expect(shown).toEqual(['parent', '“Parent” in 2']);
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
    expect(after).toEqual({ capitals: 0, lower: 3, fixLeft: false });
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
