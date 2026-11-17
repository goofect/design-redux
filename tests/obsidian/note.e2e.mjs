// The note and the graph in the real app: pages in reading view, the 3D graph, routes on the real graph.
import { browser, expect } from '@wdio/globals';
import { readUntil, shot, suite } from './helpers.mjs';

suite('Design Redux in Obsidian: notes and graphs', function () {
  it('switches pages in reading view without changing the file', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath('Politics/Pages.md');
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: 'preview' } });
    });
    const text = await readUntil(
      () => browser.execute(() => (document.querySelector('.workspace-leaf.mod-active .markdown-preview-view') || {}).innerText || ''),
      (t) => t.includes('First page text') && !t.includes('Second page text')
    );
    expect(text).toContain('First page text');
    expect(text).not.toContain('Second page text');
    await browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .dr-note-pages [role="tab"]')).find((tab) => tab.textContent === 'Sources').click());
    const second = await readUntil(
      () => browser.execute(() => (document.querySelector('.workspace-leaf.mod-active .markdown-preview-view') || {}).innerText || ''),
      (t) => t.includes('Second page text') && !t.includes('First page text')
    );
    expect(second).toContain('Second page text');
    const noteChrome = await browser.execute(() => {
      const note = document.querySelector('.workspace-leaf-content[data-type="markdown"]');
      const header = note?.querySelector(':scope > .view-header');
      const properties = note?.querySelector('.metadata-container');
      return { header: header && getComputedStyle(header).display, properties: properties && getComputedStyle(properties).display };
    });
    expect(noteChrome.header).toBe('none');
    expect(noteChrome.properties).toBe('none');
    await shot('pages-reading');
    await browser.execute(() => { document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); });
    await shot('pages-reading-dark');
    await browser.execute(() => { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); });
    await browser.$('.workspace-leaf.mod-active .dr-return-button').click();
    expect(await readUntil(() => browser.executeObsidian(({ app }) => app.workspace.getLeavesOfType('design-redux-browse')[0]?.view.screen?.at), (path) => path === 'Politics')).toBe('Politics');
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
    await browser.$('.dr-graph3d [aria-label="Back to folders"]').click();
    expect(await readUntil(() => browser.executeObsidian(({ app }) => app.workspace.activeLeaf?.view.getViewType()), (type) => type === 'design-redux-browse')).toBe('design-redux-browse');
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


});
