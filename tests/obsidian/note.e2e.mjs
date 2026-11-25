// The note and the graph in the real app: pages in reading view, the 3D graph, routes on the real graph.
import { browser, expect } from '@wdio/globals';
import { readUntil, shot, suite } from './helpers.mjs';

/** In the active note, what stands round its title, in order, and how far its head moves when the text is scrolled 200px. */
const lookAt = (mode) => browser.execute(async (mode) => {
  const view = document.querySelector('.workspace-leaf.mod-active .view-content');
  const place = mode === 'source' ? view.querySelector('.markdown-source-view .cm-sizer') : view.querySelector('.markdown-preview-sizer > .mod-header');
  if (!place) return { order: [] };
  const names = { 'dr-note-place': 'folder', 'inline-title': 'title', 'metadata-container': 'properties', 'dr-note-head': 'head', 'cm-contentContainer': 'text' };
  const order = Array.from(place.children).map((c) => names[Array.from(c.classList).find((k) => names[k])]).filter(Boolean);
  const head = place.querySelector(':scope > .dr-note-head');
  const title = place.querySelector(':scope > .inline-title');
  if (!head || !title) return { order };
  const [h, t] = [head.getBoundingClientRect(), title.getBoundingClientRect()];
  // Whatever the app scrolls the note in: the nearest box round the head that has more to show than it shows.
  let scroller = head.parentElement;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
  if (!scroller) return { order, moved: 0, edges: [Math.round(h.left - t.left), Math.round(h.right - t.right)] };
  scroller.scrollTop = 200;
  await new Promise((r) => setTimeout(r, 400));
  const moved = h.top - head.getBoundingClientRect().top;
  scroller.scrollTop = 0;
  return { order, moved, edges: [Math.round(h.left - t.left), Math.round(h.right - t.right)] };
}, mode);

suite('Design Redux in Obsidian: notes and graphs', function () {
  it('puts the folder over the title and the head under it, in both views, as wide as the text, scrolling with it', async function () {
    const lines = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the first page.`).join('\n\n');
    await browser.executeObsidian(async ({ app }, lines) => {
      const file = app.vault.getAbstractFileByPath('Politics/Long.md') || (await app.vault.create('Politics/Long.md', `---\nalbum: Politics\n---\n${lines}\n\n%%page: Sources%%\nThe second page.\n`));
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
    }, lines);
    const editing = await readUntil(() => lookAt('source'), (r) => r.order.includes('head') && r.order.includes('folder'));
    await shot('note-head-editing');
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.getLeaf(false).setViewState({ type: 'markdown', state: { file: 'Politics/Long.md', mode: 'preview' } });
    });
    // Reading view takes the editor's place in the text once it has drawn: let it, then scroll.
    await browser.pause(1500);
    const reading = await readUntil(() => lookAt('preview'), (r) => r.order.includes('head') && r.order.includes('folder'));
    await shot('note-head-reading');
    [editing, reading].forEach((r) => {
      const at = (name) => r.order.indexOf(name);
      expect(at('folder')).toBe(at('title') - 1);
      expect(at('title')).toBeLessThan(at('head'));
      if (r.order.includes('text')) expect(at('head')).toBeLessThan(at('text'));
      expect(r.edges).toEqual([0, 0]);
      expect(r.moved).toBeGreaterThan(150);
    });
  });

  it('shows many page tabs whole: one the edge would cut is not drawn, and an ellipsis stands there', async function () {
    const text = Array.from({ length: 12 }, (_, i) => `%%page: Exercises for week ${i + 1}%%\nText ${i + 1}.`).join('\n');
    await browser.executeObsidian(async ({ app }, text) => {
      const file = app.vault.getAbstractFileByPath('Politics/Many pages.md') || (await app.vault.create('Politics/Many pages.md', text));
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
    }, text);
    const seen = await readUntil(() => browser.execute(() => {
      const row = document.querySelector('.workspace-leaf.mod-active .cm-sizer .dr-note-head .dr-tabs');
      if (!row) return null;
      const box = row.getBoundingClientRect();
      const column = row.closest('.dr-note-head').getBoundingClientRect();
      const room = row.hasAttribute('data-more-after') ? 32 : 0;
      const tabs = Array.from(row.children);
      const shown = tabs.filter((t) => !t.hasAttribute('data-cut'));
      const cut = shown.filter((t) => { const r = t.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right - room + 0.5; });
      return { tabs: tabs.length, shown: shown.length, cut: cut.length, after: row.hasAttribute('data-more-after'), inColumn: box.right <= column.right + 0.5 };
    }), (r) => r && r.tabs === 12 && r.shown < 12);
    await shot('many-tabs');
    expect(seen.inColumn).toBe(true);
    expect(seen.cut).toBe(0);
    expect(seen.after).toBe(true);
  });

  it('hides the other pages in reading view', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath('Politics/Pages.md');
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: 'preview' } });
    });
    const text = await readUntil(
      () => browser.execute(() => (document.querySelector('.workspace-leaf.mod-active .markdown-preview-view') || {}).innerText || ''),
      (t) => t.includes('First page text')
    );
    expect(text).toContain('First page text');
    expect(text).not.toContain('Second page text');
    await shot('pages-reading');
  });

  it('shows every page as plain text in the file on disk', async function () {
    const raw = await browser.executeObsidian(({ app }) => app.vault.adapter.read('Politics/Pages.md'));
    expect(raw).toContain('%%page: Sources%%');
    expect(raw).toContain('Second page text.');
  });

  it('opens the 3D graph', async function () {
    await browser.executeObsidian(({ app }) => { app.commands.executeCommandById('design-redux:open-graph-3d'); });
    const type = await readUntil(
      () => browser.executeObsidian(({ app }) => app.workspace.getLeavesOfType('design-redux-graph-3d').length),
      (n) => n > 0
    );
    expect(type).toBeGreaterThan(0);
    await browser.pause(1500);
    await shot('graph-3d');
  });

  it('turns routes on the real graph on and off without errors', async function () {
    const kinds = await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: 'graph', active: true });
      await new Promise((r) => setTimeout(r, 2000));
      app.commands.executeCommandById('design-redux:toggle-graph-routes');
      await new Promise((r) => setTimeout(r, 800));
      const p = app.plugins.plugins['design-redux'];
      const routes = p.features.find((f) => f.constructor.name === 'GraphRoutes');
      const on = routes.active('graph');
      app.commands.executeCommandById('design-redux:toggle-graph-routes');
      await new Promise((r) => setTimeout(r, 800));
      return [on, routes.active('graph')];
    });
    expect(kinds).toEqual([true, false]);
  });

  it('opens the map of the vault', async function () {
    await browser.executeObsidian(({ app }) => { app.commands.executeCommandById('design-redux:open-map'); });
    const n = await readUntil(
      () => browser.executeObsidian(({ app }) => app.workspace.getLeavesOfType('design-redux-mindmap').length),
      (v) => v > 0
    );
    expect(n).toBeGreaterThan(0);
    await browser.pause(1000);
    await shot('map');
  });

  it('goes to a footnote picked in the palette, each as it reads, with the keys back in the text', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const path = 'Politics/Cited.md';
      const file = app.vault.getAbstractFileByPath(path) || (await app.vault.create(path, 'One[^1] two[^2].\n\n[^1]: Compare [[Home|the home note]], 4.\n[^2]: Plain.\n'));
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
      app.commands.executeCommandById('design-redux:show-footnotes');
    });
    const offered = await readUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll('.prompt .suggestion-item')).map((e) => e.textContent.replace(/\s+/g, ' '))),
      (v) => v.length > 1
    );
    expect(offered).toEqual(['1 Compare the home note, 4.', '2 Plain.']);
    await browser.keys(['ArrowDown', 'Enter']);
    const at = await readUntil(
      () => browser.executeObsidian(({ app }) => ({ cursor: app.workspace.activeEditor.editor.getCursor(), inText: !!document.activeElement.closest('.cm-editor') })),
      (v) => v.cursor.ch === 11
    );
    expect(at).toEqual({ cursor: { line: 0, ch: 11 }, inText: true });
  });

  it('makes an outline (1.1., 1.2.) a list: Enter carries it on and Tab nests it in the editor, a line hangs under its words, and reading view shows the markers in a column', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const path = 'Politics/Outline.md';
      const start = '1. Intro\n1.1. Background\n';
      const had = app.vault.getAbstractFileByPath(path);
      // Written afresh, so a second try starts where the first did.
      const file = had ? (await app.vault.modify(had, start), had) : await app.vault.create(path, start);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: 'source' } });
      const editor = app.workspace.activeEditor.editor;
      editor.focus();
      editor.setCursor({ line: 1, ch: editor.getLine(1).length });
    });
    await browser.keys(['Enter']);
    await browser.keys('Scope');
    await browser.keys(['Enter', 'Tab']);
    await browser.keys('Detail');
    const text = await readUntil(() => browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.getValue()), (t) => t.includes('Detail'));
    expect(text).toBe('1. Intro\n1.1. Background\n1.2. Scope\n\t1.2.1. Detail\n');
    const hung = await browser.execute(() => {
      const line = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line')).find((l) => l.textContent.startsWith('1.2. '));
      if (!line) return null;
      const prefix = line.querySelector('.dr-list-prefix');
      return { item: line.classList.contains('dr-marked-item'), prefix: prefix && prefix.textContent, hang: parseFloat(getComputedStyle(line).paddingLeft) > 0 };
    });
    expect(hung).toEqual({ item: true, prefix: '1.2. ', hang: true });
    await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.getMostRecentLeaf();
      await leaf.setViewState({ type: 'markdown', state: { file: 'Politics/Outline.md', mode: 'preview' } });
    });
    const rows = await readUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .markdown-preview-view .dr-marked-list .dr-list-marker')).map((m) => m.textContent)),
      (v) => v.length >= 3
    );
    expect(rows).toEqual(['1.1.', '1.2.', '1.2.1.']);
    const column = await browser.execute(() => {
      const top = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view .dr-marked-list');
      const left = (sel) => Array.from(top.querySelectorAll(sel)).map((t) => Math.round(t.getBoundingClientRect().left));
      return { top: left(':scope > .dr-list-row > .dr-list-text'), nested: left(':scope > .dr-list-row > .dr-marked-list > .dr-list-row > .dr-list-marker') };
    });
    // The top items' words in one column; the nested item's marker starts where they do.
    expect(new Set(column.top).size).toBe(1);
    expect(column.nested).toEqual([column.top[0]]);
    await shot('outline-list');
  });

  it('keeps a folded section the footnotes leave alone folded when they are put in order', async function () {
    // Obsidian unfolds a section whose text changes; the footnotes change only One's and Three's, so Two stays folded.
    const before = '# One\nBody[^2] then[^1].\n\n# Two\nMore text.\n\n# Three\n\n[^1]: a\n[^2]: b\n';
    await browser.executeObsidian(async ({ app }, text) => {
      const path = 'Politics/Folded.md';
      const was = app.vault.getAbstractFileByPath(path);
      // Out of order every time, a second try too.
      const file = was ? (await app.vault.modify(was, text), was) : await app.vault.create(path, text);
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
    }, before);
    const folded = () => browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-editor .cm-line:has(.cm-foldPlaceholder)')).map((l) => l.textContent.replace(/…$/, '').trim()));
    // A note just made is drawn a moment later: fold it once its headings are there.
    await readUntil(() => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .cm-editor .HyperMD-header').length), (n) => n === 3);
    const all = await readUntil(async () => { await browser.executeObsidian(({ app }) => app.commands.executeCommandById('editor:fold-all')); return folded(); }, (v) => v.length === 3);
    expect(all.length).toBe(3);
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:tidy-footnotes'));
    const text = await readUntil(() => browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.getValue()), (t) => t.startsWith('# One\nBody[^1]'));
    expect(text).toBe('# One\nBody[^1] then[^2].\n\n# Two\nMore text.\n\n# Three\n\n[^1]: b\n[^2]: a\n');
    await browser.pause(300);
    expect(await folded()).toEqual(['Two']);
  });

  it('offers the values used for a property under its field in the head, and writes the one taken with Enter', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const make = async (path, text) => app.vault.getAbstractFileByPath(path) || app.vault.create(path, text);
      await make('Politics/Phase one.md', '---\nphase: drafted\n---\n');
      await make('Politics/Phase two.md', '---\nphase: done\n---\n');
      const file = await make('Politics/Phase three.md', '---\nphase: new\n---\nText.\n');
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
    });
    const value = await $('.workspace-leaf.mod-active .dr-note-head .dr-prop[data-key="phase"]');
    await value.waitForExist({ timeout: 8000 });
    await value.click();
    await browser.keys(['Backspace', 'd']);
    const offered = await readUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll('.suggestion-container .suggestion-item')).map((e) => e.textContent)),
      (v) => v.length > 0
    );
    expect(offered).toEqual(['done', 'drafted']);
    const look = await browser.execute(() => {
      const box = getComputedStyle(document.querySelector('.suggestion-container'));
      return { shadow: box.boxShadow, radius: box.borderRadius, font: getComputedStyle(document.querySelector('.suggestion-item')).fontFamily };
    });
    await shot('ledger-suggested-values');
    expect(look.shadow).toBe('none');
    expect(look.radius).toBe('0px');
    await browser.keys(['ArrowDown', 'Enter']);
    const written = await readUntil(
      () => browser.executeObsidian(({ app }) => (app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('Politics/Phase three.md')).frontmatter || {}).phase),
      (v) => v === 'drafted'
    );
    expect(written).toBe('drafted');
    expect(await browser.execute(() => document.querySelectorAll('.suggestion-container').length)).toBe(0);
  });

  it('opens what a link in a property\'s value links to when it is pressed', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const make = async (path, text) => app.vault.getAbstractFileByPath(path) || app.vault.create(path, text);
      await make('Politics/Linked.md', 'Linked to.');
      const file = await make('Politics/Linking.md', '---\nrelated: "[[Linked]]"\n---\nText.\n');
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
    });
    const link = await $('.workspace-leaf.mod-active .dr-note-head .dr-prop[data-key="related"] .dr-link');
    await link.waitForExist({ timeout: 8000 });
    expect(await link.getText()).toBe('Linked');
    await link.click();
    const open = await readUntil(() => browser.executeObsidian(({ app }) => (app.workspace.getActiveFile() || {}).path), (p) => p === 'Politics/Linked.md');
    expect(open).toBe('Politics/Linked.md');
  });

  it('adds a property where the properties stand: a row at the ledger\'s foot, typed with the keys, its name offered, Enter to the value and Enter writes it', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const make = async (path, text) => app.vault.getAbstractFileByPath(path) || app.vault.create(path, text);
      await make('Politics/Course one.md', '---\ncourse: IR\n---\n');
      const file = await make('Politics/Course two.md', '---\nstatus: draft\n---\nText.\n');
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
    });
    await (await $('.workspace-leaf.mod-active .dr-note-head .dr-prop[data-key="status"]')).waitForExist({ timeout: 8000 });
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:add-property'));
    const row = await $('.workspace-leaf.mod-active .dr-note-head .dr-prop-new');
    await row.waitForExist({ timeout: 4000 });
    const at = await browser.execute(() => {
      const r = document.querySelector('.workspace-leaf.mod-active .dr-prop-new');
      return { foot: r.previousElementSibling && r.previousElementSibling.dataset.key, focused: document.activeElement === r.querySelector('input') };
    });
    expect(at).toEqual({ foot: 'status', focused: true });
    await browser.keys(['c', 'o', 'u']);
    const offered = await readUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll('.suggestion-container .suggestion-item')).map((e) => e.textContent)),
      (v) => v.length > 0
    );
    expect(offered[0]).toBe('course');
    await shot('ledger-adding');
    await browser.keys(['ArrowDown', 'Enter']);
    await browser.keys(['I', 'R', 'Enter']);
    const written = await readUntil(
      () => browser.executeObsidian(({ app }) => (app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('Politics/Course two.md')).frontmatter || {}).course),
      (v) => v === 'IR'
    );
    expect(written).toBe('IR');
    expect(await browser.execute(() => document.querySelectorAll('.dr-prop-new').length)).toBe(0);
  });
});
