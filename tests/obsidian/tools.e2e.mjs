// Design Redux inside the real Obsidian app: the Properties window and its tools, rules, and the graph.
// What every spec shares, and how each test starts from the same place: helpers.mjs.
import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import fs from 'fs';
import path from 'path';
import { ACTIVE, OUT, clickText, closeMenus, menuTitles, openAlbum, perf, readUntil, shot, suite, version } from './helpers.mjs';

suite('Design Redux in Obsidian: property tools and the graph', function () {
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
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      // Read once the last note's link is counted; drawn once the graph has its lines.
      await until(() => (app.metadataCache.resolvedLinks['Routes/Individual responsibility.md'] || {})['Routes/Resignation.md']);
      app.commands.executeCommandById('graph:open');
      const graph = () => { const l = app.workspace.getLeavesOfType('graph')[0]; return l && l.view; };
      await until(() => {
        const g = graph();
        return g && g.renderer && g.renderer.links.some((l) => l.source.id === 'Routes/Westminster system.md') &&
          g.dataEngine && g.dataEngine.displayOptions.childrenEl.querySelector('.dr-graph-routes');
      });
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
      const has = (a, b) => view.renderer.links.some((l) => l.source.id === a && l.target.id === b);
      const [W, M, I, C] = names;
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => has(W, M) && has(M, I) && !has(W, I));
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

    // No routes button in the graph's header; and a local graph of Westminster, turned on by the command, is routed too.
    const local = await browser.executeObsidian(async ({ app, plugins }, names) => {
      const [W, M, I, C] = names;
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      const graphLeaf = app.workspace.getLeavesOfType('graph')[0];
      const noButton = !graphLeaf.view.containerEl.querySelector('.view-actions [aria-label="Links through notes between"]');
      const side = app.workspace.getLeaf('split');
      await side.setViewState({ type: 'localgraph', state: { file: W } });
      const r = () => side.view.renderer;
      const has = (a, b) => r().links.some((l) => (l.source.id === a && l.target.id === b) || (l.source.id === b && l.target.id === a));
      await until(() => r() && r().links.length > 0);
      const before = [has(W, I), has(W, C)];
      app.workspace.setActiveLeaf(side, { focus: true });
      app.commands.executeCommandById('design-redux:toggle-graph-routes');
      await until(() => !has(W, I) && has(M, I));
      const result = {
        noButton,
        before,
        routed: [has(W, M), has(M, I), has(M, C)],
        straight: [has(W, I), has(W, C)],
        localOn: plugins.designRedux.settings.graphRouting.localgraph === true,
      };
      app.commands.executeCommandById('design-redux:toggle-graph-routes');
      side.detach();
      app.workspace.setActiveLeaf(graphLeaf, { focus: true });
      return result;
    }, [W, M, I, C]);
    expect(local).toEqual({ noButton: true, before: [true, true], routed: [true, true, true], straight: [false, false], localOn: true });

    // Off again, from the command: every line straight across.
    const off = await browser.executeObsidian(async ({ app }, names) => {
      const [W, M, I, C] = names;
      const leaf = app.workspace.getLeavesOfType('graph')[0];
      app.workspace.setActiveLeaf(leaf, { focus: true });
      app.commands.executeCommandById('design-redux:toggle-graph-routes');
      const r = leaf.view.renderer;
      r.highlightNode = null;
      const has = (a, b) => r.links.some((l) => l.source.id === a && l.target.id === b);
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => has(W, I) && has(W, C));
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
      // One note writes "parent", two "Parent". Obsidian lists it one way — the first met
      // until 1.14, the most used since — and the other is offered to be put right.
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
    const listed = shown && shown[0];
    expect(['parent', 'Parent']).toContain(listed);
    const other = listed === 'parent' ? 'Parent' : 'parent';
    // Notes left by earlier tests may write it too: the other way's count, from the vault itself.
    const others = await browser.executeObsidian(({ app }, key) => app.vault.getMarkdownFiles().filter((f) => key in ((app.metadataCache.getFileCache(f) || {}).frontmatter || {})).length, other);
    expect(shown).toEqual([listed, `“${other}” in ${others}`]);
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
    // Every note now writes it as Obsidian lists it.
    expect(after).toEqual(listed === 'parent' ? { capitals: 0, lower: 3, fixLeft: false } : { capitals: 3, lower: 0, fixLeft: false });
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

  it('sets a property by a rule when a note is moved into a folder, once, with Undo', async function () {
    const out = await browser.executeObsidian(async ({ app }) => {
      const plugin = app.plugins.plugins['design-redux'];
      const saved = { on: plugin.settings.propertyRulesOn, dry: plugin.settings.propertyRulesDryRun, rules: plugin.settings.propertyRules };
      for (const p of ['Rule inbox/Incoming.md', 'Rule law/Incoming.md']) {
        const f = app.vault.getAbstractFileByPath(p);
        if (f) await app.vault.delete(f);
      }
      for (const p of ['Rule inbox', 'Rule law']) if (!app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p);
      Object.assign(plugin.settings, { propertyRulesOn: true, propertyRulesDryRun: false, propertyRules: [{ id: 'e2e', on: true, when: { kind: 'folder', folder: 'Rule law' }, set: [{ key: 'status', value: 'Open' }] }] });
      await plugin.saveSettings();
      const file = await app.vault.create('Rule inbox/Incoming.md', '---\ntitle: In\n---\nBody\n');
      const until = async (ok, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); return ok(); };
      await until(() => !!app.metadataCache.getFileCache(file)?.frontmatter);
      await new Promise((r) => setTimeout(r, 600));
      const before = Object.assign({}, app.metadataCache.getFileCache(file).frontmatter);
      await app.fileManager.renameFile(file, 'Rule law/Incoming.md');
      await until(() => app.metadataCache.getFileCache(file)?.frontmatter?.status === 'Open');
      const set = app.metadataCache.getFileCache(file).frontmatter.status;
      // Changed by hand: not set again.
      await app.fileManager.processFrontMatter(file, (fm) => { fm.status = 'Closed'; });
      await new Promise((r) => setTimeout(r, 800));
      const after = app.metadataCache.getFileCache(file).frontmatter.status;
      Object.assign(plugin.settings, { propertyRulesOn: saved.on, propertyRulesDryRun: saved.dry, propertyRules: saved.rules });
      await plugin.saveSettings();
      await app.vault.delete(file);
      return { before: before.status || null, set, after };
    });
    expect(out).toEqual({ before: null, set: 'Open', after: 'Closed' });
  });
  it('draws the vault in 3D (WebGL where there is some), lays it out in a worker, and picks and opens a note', async function () {
    await browser.executeObsidian(async ({ app }) => {
      if (!app.vault.getAbstractFileByPath('Space')) await app.vault.createFolder('Space');
      await app.vault.create('Space/Sun.md', '[[Earth]] and [[Moon]].');
      await app.vault.create('Space/Earth.md', '[[Moon]].');
      await app.vault.create('Space/Moon.md', 'Small.');
      const end = Date.now() + 8000;
      while (!(app.metadataCache.resolvedLinks['Space/Earth.md'] || {})['Space/Moon.md'] && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    });
    await browser.executeObsidianCommand('design-redux:open-graph-3d');
    await browser.$('.dr-graph3d-overlay').waitForExist({ timeout: 5000 });
    const out = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.activeLeaf.view;
      const until = async (ok, ms = 15000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      await until(() => view.at.has('Space/Moon.md') && view.graph.nodes[view.at.get('Space/Moon.md')].degree === 2 && !view.runner.hot);
      // What this Obsidian offers: WebGL, or not (a machine with no GPU).
      const probe = document.createElement('canvas');
      const webgl = !!(probe.getContext('webgl2') || document.createElement('canvas').getContext('webgl'));
      // Drawn once more, then its pixels read before they're shown: the notes are there.
      view.renderFrame();
      const [r, g, b] = view.theme.groundRgb.map((c) => Math.round(c * 255));
      let px;
      const gl = view.renderer.gl;
      if (gl) {
        px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
      } else {
        px = view.canvas.getContext('2d').getImageData(0, 0, view.canvas.width, view.canvas.height).data;
      }
      let inked = 0;
      for (let k = 0; k < px.length; k += 4) if (Math.abs(px[k] - r) + Math.abs(px[k + 1] - g) + Math.abs(px[k + 2] - b) > 60) inked++;
      const spots = view.spots;
      let onScreen = 0;
      for (let i = 0; i < view.graph.nodes.length; i++) if (spots.scale[i] && spots.x[i] >= 0 && spots.x[i] <= view.w && spots.y[i] >= 0 && spots.y[i] <= view.h) onScreen++;
      // A note with links picked by a click, then opened by another.
      // The note nearest the camera: nothing can be in front of it.
      const i = ['Space/Sun.md', 'Space/Earth.md', 'Space/Moon.md'].map((p) => view.at.get(p)).sort((a, b) => spots.depth[a] - spots.depth[b])[0];
      const path = view.graph.nodes[i].path;
      const rect = view.overlay.getBoundingClientRect();
      const click = () => {
        const at = { clientX: rect.left + spots.x[i], clientY: rect.top + spots.y[i], bubbles: true, pointerId: 1, button: 0, pointerType: 'mouse' };
        view.overlay.dispatchEvent(new PointerEvent('pointerdown', at));
        view.overlay.dispatchEvent(new PointerEvent('pointerup', at));
      };
      click();
      const picked = view.picked === i && !view.detail.hidden && view.detail.querySelector('.dr-graph3d-name').textContent === view.graph.nodes[i].name;
      // Seen with its settings open, a colour group in them, the note picked and its links lit.
      view.setOption('colorGroups', [{ query: 'path:Space', color: '#e0b84f' }]);
      view.renderColorGroups();
      view.togglePanel(true);
      return {
        renderer: view.renderer.kind === (webgl ? 'webgl' : 'canvas'),
        worker: !!view.runner.worker,
        drawn: view.graph.nodes.length === app.vault.getMarkdownFiles().length,
        onScreen: onScreen === view.graph.nodes.length,
        inked: inked > 200,
        finite: Array.prototype.every.call(view.runner.positions, Number.isFinite),
        picked,
      };
    });
    await shot('graph-3d');
    // A click on the picked note opens it.
    out.opened = await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.activeLeaf.view;
      view.togglePanel(false);
      // Picked, the camera flew to it: clicked again once it's there.
      const settle = Date.now() + 5000;
      while (view.easing && Date.now() < settle) await new Promise((r) => setTimeout(r, 50));
      view.renderFrame();
      const i = view.picked;
      const path = view.graph.nodes[i].path;
      const rect = view.overlay.getBoundingClientRect();
      const at = { clientX: rect.left + view.spots.x[i], clientY: rect.top + view.spots.y[i], bubbles: true, pointerId: 1, button: 0, pointerType: 'mouse' };
      view.overlay.dispatchEvent(new PointerEvent('pointerdown', at));
      view.overlay.dispatchEvent(new PointerEvent('pointerup', at));
      const end = Date.now() + 3000;
      while (!(app.workspace.getActiveFile() && app.workspace.getActiveFile().path === path) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      return !!app.workspace.getActiveFile() && app.workspace.getActiveFile().path === path;
    });
    await browser.executeObsidian(async ({ app }) => {
      const folder = app.vault.getAbstractFileByPath('Space');
      if (folder) await app.vault.delete(folder, true);
    });
    expect(out).toEqual({ renderer: true, worker: true, drawn: true, onScreen: true, inked: true, finite: true, picked: true, opened: true });
  });

  it('switches a graph tab between 2D and 3D from its header, in the same tab', async function () {
    const out = await browser.executeObsidian(async ({ app }) => {
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      app.commands.executeCommandById('graph:open');
      await until(() => app.workspace.activeLeaf && app.workspace.activeLeaf.view.getViewType() === 'graph');
      const leaf = app.workspace.activeLeaf;
      const button = () => leaf.view.containerEl.querySelector('.view-action.dr-graph3d-switch');
      await until(() => button());
      const to3d = button() ? button().getAttribute('aria-label') : null;
      button().click();
      await until(() => leaf.view.getViewType() === 'design-redux-graph-3d' && leaf.view.graph.nodes.length > 0);
      const in3d = leaf.view.getViewType();
      const notes = leaf.view.graph.nodes.length;
      const to2d = button() ? button().getAttribute('aria-label') : null;
      button().click();
      await until(() => leaf.view.getViewType() === 'graph');
      return { to3d, in3d, drawn: notes === app.vault.getMarkdownFiles().length, to2d, back: leaf.view.getViewType(), same: app.workspace.activeLeaf === leaf };
    });
    expect(out).toEqual({ to3d: 'Show in 3D', in3d: 'design-redux-graph-3d', drawn: true, to2d: 'Show in 2D', back: 'graph', same: true });
  });

  it('filters the 3D graph as Obsidian’s search does: words in the text, path:, tag:, -leaving out', async function () {
    const out = await browser.executeObsidian(async ({ app }) => {
      const until = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
      if (!app.vault.getAbstractFileByPath('Garden')) await app.vault.createFolder('Garden');
      await app.vault.create('Garden/Roses.md', 'Prune in March. #flower/red');
      await app.vault.create('Garden/Tulips.md', 'Plant bulbs in autumn. #flower');
      await app.vault.create('Garden/Shed.md', 'Tools and a mower.');
      await until(() => (app.metadataCache.getCache('Garden/Shed.md') || null) !== null);
      app.commands.executeCommandById('design-redux:open-graph-3d');
      await until(() => app.workspace.activeLeaf && app.workspace.activeLeaf.view.getViewType() === 'design-redux-graph-3d');
      const view = app.workspace.activeLeaf.view;
      // Its first build comes once the tab's saved settings are in (setState): set the search after.
      await until(() => !!view.input);
      // What the graph shows for a query, once it's what's wanted (or after 8 seconds, whatever it is).
      const shown = async (q, want) => {
        view.setOption('search', q);
        const ids = () => view.graph.nodes.map((n) => n.id).sort().join(',');
        await until(() => ids() === want);
        return ids();
      };
      const result = {
        text: await shown('bulbs', 'Garden/Tulips.md'),
        path: await shown('path:garden -mower', 'Garden/Roses.md,Garden/Tulips.md'),
        tag: await shown('tag:#flower', 'Garden/Roses.md,Garden/Tulips.md'),
        nested: await shown('tag:#flower/red', 'Garden/Roses.md'),
      };
      const folder = app.vault.getAbstractFileByPath('Garden');
      if (folder) await app.vault.delete(folder, true);
      return result;
    });
    expect(out).toEqual({ text: 'Garden/Tulips.md', path: 'Garden/Roses.md,Garden/Tulips.md', tag: 'Garden/Roses.md,Garden/Tulips.md', nested: 'Garden/Roses.md' });
  });
});
