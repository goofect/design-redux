// Design Redux inside the real Obsidian app: pages, footnotes, the note page and its look, the inspector of a note.
// What every spec shares, and how each test starts from the same place: helpers.mjs.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import fs from 'fs';
import path from 'path';
import { ACTIVE, OUT, clickText, closeMenus, menuTitles, openAlbum, perf, readUntil, shot, suite, version } from './helpers.mjs';

suite('Design Redux in Obsidian: notes', function () {
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
          steps: Array.from(root.querySelectorAll('.dr-note-step')).map((st) => [st.querySelector('.dr-note-step-label').textContent, st.querySelector('.dr-note-step-title').textContent]),
          stepsBeforeShelves: !!root.querySelector('.dr-note-next + .dr-note-shelves'),
        };
      });
    // The link shelves come once Obsidian has the links: all three, not the first drawn.
    await browser.waitUntil(async () => (await look()).shelves.length >= 3, { timeout: 5000, timeoutMsg: 'the note page was never drawn with its shelves' });
    let now = await look();
    expect(now.album).toBe('Page album');
    expect(now.above).toBe(true);
    expect(now.meta.startsWith('Under Judicial review')).toBe(true);
    expect(now.shelves).toEqual(['Linked from here ›', 'Mentioned in ›', 'More in Page album ›']);
    // Second of two in its album: its place in the grey line, and the note before it as a step at its end.
    expect(now.meta).toContain('2 of 2');
    expect(now.steps).toEqual([['Previous', 'Judicial review']]);
    expect(now.stepsBeforeShelves).toBe(true);
    await browser.executeObsidian(({ app }) => app.workspace.activeLeaf.view.contentEl.querySelector('.cm-scroller').scrollTo(0, 10000));
    await shot('note-next');
    // Reading: the same.
    await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.activeLeaf;
      await leaf.setViewState({ type: 'markdown', state: Object.assign({}, leaf.getViewState().state, { mode: 'preview' }) });
    });
    await browser.waitUntil(async () => (await look()).shelves.length > 0, { timeout: 5000, timeoutMsg: 'not drawn in reading view' });
    now = await look();
    expect(now.album).toBe('Page album');
    expect(now.shelves.length).toBe(3);
    expect(now.steps).toEqual([['Previous', 'Judicial review']]);
    await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.activeLeaf;
      await leaf.setViewState({ type: 'markdown', state: Object.assign({}, leaf.getViewState().state, { mode: 'source' }) });
      // Its notes gone again, so later tests count the vault as it was.
      const folder = app.vault.getFolderByPath('Page album');
      if (folder) await app.vault.delete(folder, true);
    });
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
    // A popup above its button, not the right sidebar; it stays while another note opens, and follows it.
    await obsidianPage.openFile('Politics/Balance of power.md');
    const followed = await browser.executeObsidian(async ({ app }) => {
      const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
      const pop = () => document.querySelector('.dr-props-popup.is-open');
      const title = () => { const t = pop() && pop().querySelector('.dr-props-title'); return t ? t.textContent : ''; };
      await until(() => title() === 'Balance of power');
      return { popup: !!pop() && pop().parentElement === document.body && !pop().classList.contains('is-docked'), docked: app.workspace.getLeavesOfType('design-redux-properties').length, title: title() };
    });
    expect(followed).toEqual({ popup: true, docked: 0, title: 'Balance of power' });
    await obsidianPage.openFile('Inspector note.md');
    await browser.waitUntil(() => browser.execute(() => {
      const t = document.querySelector('.dr-props-popup.is-open .dr-props-title');
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
    // A popup: its rows grouped in a rounded box with hairlines between, the value to the right.
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
    expect(group).toEqual({ radius: '10px', hairline: true, boxed: false, right: 'right' });
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
});
