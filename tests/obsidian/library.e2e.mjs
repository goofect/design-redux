// Design Redux inside the real Obsidian app: albums, the browse view, the library sidebar, swiping, search, shelves and the strip.
// What every spec shares, and how each test starts from the same place: helpers.mjs.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import fs from 'fs';
import path from 'path';
import { ACTIVE, OUT, clickText, closeMenus, menuTitles, openAlbum, perf, readUntil, shot, suite, version } from './helpers.mjs';

suite('Design Redux in Obsidian: the library', function () {
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
    await browser.$(ACTIVE + '.dr-detail-bar [aria-label="Edit"]').click();
    await browser.$('.dr-edit-grip').waitForExist({ timeout: 5000 });
    await shot('album-edit');
    await clickText('.dr-detail-action', 'Done');
  });

  it('swipes the sidebar on the pointer’s side in and back out, over an album and over a note', async function () {
    const result = await browser.executeObsidian(async ({ app, plugins }) => {
      const ws = app.workspace;
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (done) => {
        for (let i = 0; i < 50 && !done(); i++) await pause(30);
      };
      // A two-finger swipe at x across the window: a few sideways wheel events, straight after
      // the one before; then until it's done what it should, or long enough to say it hasn't.
      // Whether what's under it was kept from scrolling, too.
      const swipe = async (x, dx, done) => {
        const target = document.elementFromPoint(x, window.innerHeight / 2) || document.body;
        let kept = true;
        for (let i = 0; i < 6; i++) {
          const e = new WheelEvent('wheel', { deltaX: dx / 6, deltaY: 0, clientX: x, clientY: window.innerHeight / 2, bubbles: true, cancelable: true, view: window });
          target.dispatchEvent(e);
          kept = kept && e.defaultPrevented;
        }
        await until(done);
        return kept;
      };
      const round = async () => {
        if (ws.leftSplit.collapsed) ws.leftSplit.expand();
        if (ws.rightSplit.collapsed) ws.rightSplit.expand();
        const left = window.innerWidth * 0.25;
        const right = window.innerWidth * 0.75;
        const out = {};
        out.kept = await swipe(left, 120, () => ws.leftSplit.collapsed);
        out.leftIn = ws.leftSplit.collapsed && !ws.rightSplit.collapsed;
        await swipe(left, -120, () => !ws.leftSplit.collapsed);
        out.leftOut = !ws.leftSplit.collapsed;
        await swipe(right, -120, () => ws.rightSplit.collapsed);
        out.rightIn = ws.rightSplit.collapsed && !ws.leftSplit.collapsed;
        await swipe(right, 120, () => !ws.rightSplit.collapsed);
        out.rightOut = !ws.rightSplit.collapsed;
        return out;
      };
      // Over an album, then over a note.
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      await until(() => !!document.querySelector('.workspace-leaf.mod-active .dr-detail'));
      const album = await round();
      await ws.getLeaf(false).openFile(app.vault.getMarkdownFiles()[0]);
      await until(() => !!document.querySelector('.workspace-leaf.mod-active .markdown-source-view, .workspace-leaf.mod-active .markdown-reading-view'));
      const onNote = await round();
      return { album, note: onNote };
    });
    const all = { kept: true, leftIn: true, leftOut: true, rightIn: true, rightOut: true };
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
    await browser.$(ACTIVE + '.dr-detail-bar [aria-label="Edit"]').click();
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

  it('says what a collection is from the inspector, with no folder note made', async function () {
    const result = await browser.executeObsidian(async ({ app, plugins }) => {
      const plugin = plugins.designRedux;
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
      const library = plugin.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'folder', path: 'Politics' });
      const page = app.workspace.activeLeaf;
      await until(() => !!page.view.containerEl.querySelector('.dr-detail'));
      if (!page.view.previewOn()) app.commands.executeCommandById('design-redux:open-inspector');
      const dock = () => app.workspace.getLeavesOfType('design-redux-properties')[0];
      await until(() => !!dock() && page.view.previewOn());
      plugin.selection.set({ folder: app.vault.getFolderByPath('Politics') });
      const details = () => dock() && dock().view.containerEl.querySelector('.dr-album-details');
      await until(() => !!details());
      const kind = details().querySelector('select');
      kind.value = 'subject';
      kind.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => (page.view.containerEl.querySelector('.dr-detail-kind') || {}).textContent === 'Subject');
      const result = {
        rows: Array.from(details().querySelectorAll('.setting-item-name')).map((n) => n.textContent),
        kind: (page.view.containerEl.querySelector('.dr-detail-kind') || {}).textContent || null,
        kept: (plugin.settings.albums.Politics || {}).type || null,
        noFolderNote: !app.vault.getAbstractFileByPath('Politics/Politics.md'),
      };
      app.workspace.detachLeavesOfType('design-redux-properties');
      plugin.selection.clear();
      return result;
    });
    expect(result).toEqual({ rows: ['Kind', 'Description', 'Opens as'], kind: 'Subject', kept: 'subject', noFolderNote: true });
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
      await until(() => !!row());
      // Shown by its command, and only if it isn't already: the command, like the button it
      // stands for, shows or hides, and a test before may have left it showing.
      if (!page.view.previewOn()) app.commands.executeCommandById('design-redux:open-inspector');
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
        // Once to warm up, then the middle of five: one slow frame on a busy machine moves it no more.
        const time = (fn) => {
          fn();
          const runs = [];
          for (let i = 0; i < 5; i++) {
            const started = performance.now();
            fn();
            runs.push(performance.now() - started);
          }
          return Math.round(runs.sort((a, b) => a - b)[2]);
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

  it('times what an edit costs, in a note of an album of 500', async function () {
    // A baseline, not a check: what runs while a note in a big album is written in.
    this.timeout(300000);
    const root = 'Bench edit';
    await browser.executeObsidian(async ({ app }, root) => {
      if (!app.vault.getFolderByPath(root)) await app.vault.createFolder(root);
      for (let i = 0; i < 500; i++) {
        const p = `${root}/Note ${i}.md`;
        if (!app.vault.getFileByPath(p)) await app.vault.create(p, `---\nstatus: open\ntags: [bench]\n---\nA note, linking [[Note ${(i + 1) % 500}]].\n`);
      }
    }, root);
    await obsidianPage.openFile(`${root}/Note 0.md`);
    await browser.$(ACTIVE + '.markdown-source-view').waitForExist({ timeout: 10000 });
    const times = await browser.executeObsidian(async ({ app, plugins }, root) => {
      await new Promise((r) => setTimeout(r, 1500));
      const find = (name) => plugins.designRedux.features.find((f) => f.constructor.name === name);
      // Once to warm up, then the middle of five.
      const time = (fn) => {
        fn();
        const runs = [];
        for (let i = 0; i < 5; i++) {
          const started = performance.now();
          fn();
          runs.push(performance.now() - started);
        }
        return Math.round(runs.sort((a, b) => a - b)[2] * 10) / 10;
      };
      const other = app.vault.getFileByPath(`${root}/Note 7.md`);
      const cache = app.metadataCache;
      return {
        changed: time(() => cache.trigger('changed', other, '', cache.getFileCache(other))),
        notePage: time(() => find('NotePage').sync()),
        pages: time(() => find('NotePages').sync()),
        strip: time(() => find('ContextStrip').update()),
      };
    }, root);
    perf.push(`perf: an edit in an album of 500: its handlers ${times.changed} ms, the note page ${times.notePage} ms, pages ${times.pages} ms, the strip ${times.strip} ms`);
    await browser.executeObsidian(async ({ app }, root) => {
      const folder = app.vault.getFolderByPath(root);
      if (folder) await app.vault.delete(folder, true);
    }, root);
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

  it('shows the image set as a folder’s cover, with no folder note made', async function () {
    await browser.executeObsidian(async ({ app, plugins }) => {
      // A real 1×1 PNG, so the page has a picture to load.
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      if (!app.vault.getAbstractFileByPath('Pictures')) await app.vault.createFolder('Pictures');
      const image = await app.vault.createBinary('Pictures/cover-test.png', png.buffer);
      const covers = plugins.designRedux.capability('covers');
      await covers.setFolderImage(app.vault.getFolderByPath('Politics'), image);
    });
    await openAlbum('Politics');
    const seen = await readUntil(
      () => browser.executeObsidian(({ app }) => {
        const img = document.querySelector('.workspace-leaf.mod-active .dr-detail-art img');
        return {
          image: !!img && img.src.includes('cover-test') && img.complete && img.naturalWidth > 0,
          noFolderNote: !app.vault.getAbstractFileByPath('Politics/Politics.md'),
        };
      }),
      (r) => r.image
    );
    expect(seen).toEqual({ image: true, noFolderNote: true });
    await browser.executeObsidian(async ({ app, plugins }) => {
      await plugins.designRedux.capability('covers').clearFolderCover(app.vault.getFolderByPath('Politics'));
      const folder = app.vault.getAbstractFileByPath('Pictures');
      if (folder) await app.vault.delete(folder, true);
    });
  });

  it('draws Home with its shelves', async function () {
    await browser.executeObsidian(async ({ plugins }) => {
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode({ mode: 'home' });
      // The library in front in the left sidebar, for the picture: Home and the sidebar beside it.
      await library.reveal();
    });
    await browser.$('.dr-shelf-row .dr-card').waitForExist({ timeout: 10000 });
    await browser.$('.dr-library .dr-lib-row').waitForDisplayed({ timeout: 10000 });
    await shot('home');
  });

  it('draws the other screens of the library: all notes, collections, properties, search and the check', async function () {
    const open = (state) => browser.executeObsidian(async ({ plugins }, state) => {
      const library = plugins.designRedux.features.find((f) => f.constructor.name === 'Library');
      await library.browseMode(state);
    }, state);
    for (const [mode, sel] of [['notes', '.dr-tr'], ['folders', '.dr-card'], ['properties', '.dr-split-row'], ['search', '.dr-browse-search input'], ['library-check', '.dr-detail-bar']]) {
      await open({ mode });
      await browser.$(`.workspace-leaf-content[data-type="design-redux-browse"] ${sel}`).waitForExist({ timeout: 10000 });
      await shot(`screen-${mode}`);
    }
  });

  it('lays out the library the Apple way: shelf titles at 17px, covers 16px apart, an album with its icons after Find, a header that stays', async function () {
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
    expect(home).toEqual({ shelf: '17px', gap: '16px', scrolls: 'auto' });
    await browse({ mode: 'folder', path: 'Politics' });
    await browser.$(ACTIVE + '.dr-options-btn').waitForExist({ timeout: 10000 });
    const album = await read(() => {
      const page = document.querySelector('.workspace-leaf.mod-active .dr-browse');
      const bar = Array.from(page.querySelector('.dr-detail-bar').children);
      const find = bar.findIndex((el) => el.classList.contains('dr-browse-search'));
      return {
        art: page.querySelector('.dr-detail-art').offsetWidth <= 180,
        buttons: page.querySelectorAll('.dr-detail-actions, .dr-detail-more').length,
        icons: bar.slice(find + 1, find + 4).map((el) => [el.getAttribute('aria-label'), el.offsetWidth, el.textContent]),
      };
    });
    expect(album).toEqual({ art: true, buttons: 0, icons: [['Edit', 32, ''], ['Sort and filter', 32, ''], ['Options', 32, '']] });
    // Options: the folder's menu, then what's known of it.
    await browser.$(ACTIVE + '.dr-options-btn').click();
    const options = await readUntil(menuTitles, (t) => t.length > 0);
    expect([options.find((t) => /^\d+ notes?$/.test(t)) || options.join(' / '), options.includes('Pin')]).toEqual([expect.stringMatching(/^\d+ notes?$/), true]);
    await closeMenus();
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
});
