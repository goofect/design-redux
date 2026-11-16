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
      const room = row.classList.contains('is-more-after') ? 32 : 0;
      const tabs = Array.from(row.children);
      const shown = tabs.filter((t) => !t.classList.contains('is-cut'));
      const cut = shown.filter((t) => { const r = t.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right - room + 0.5; });
      return { tabs: tabs.length, shown: shown.length, cut: cut.length, after: row.classList.contains('is-more-after'), inColumn: box.right <= column.right + 0.5 };
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
});
