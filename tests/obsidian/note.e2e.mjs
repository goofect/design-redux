// The note and the graph in the real app: pages in reading view, the 3D graph, routes on the real graph.
import { browser, expect } from '@wdio/globals';
import { GUIDE_NOTES, OLD_NOTES, auditGuides } from './guides.mjs';
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

  it('opens the 3D graph: notes as spheres in perspective, their links as lines', async function () {
    // A small linked vault of its own: a ring of notes, each linked on to the next and across.
    await browser.executeObsidian(async ({ app }) => {
      if (!app.vault.getAbstractFileByPath('Graph')) await app.vault.createFolder('Graph');
      for (let i = 0; i < 14; i++) {
        const path = `Graph/G${i}.md`;
        if (!app.vault.getAbstractFileByPath(path)) await app.vault.create(path, `[[G${(i + 1) % 14}]] [[G${(i * 5 + 3) % 14}]]`);
      }
      await new Promise((r) => setTimeout(r, 1200));
      app.commands.executeCommandById('design-redux:open-graph-3d');
    });
    const seen = await readUntil(
      () => browser.executeObsidian(({ app }) => {
        const leaf = app.workspace.getLeavesOfType('design-redux-graph-3d')[0];
        const view = leaf && leaf.view;
        if (!view || !view.canvas || !view.screen) return null;
        // How much of the canvas is painted in something other than the ground: the spheres and the lines.
        const c = view.canvas;
        const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const ground = [data[0], data[1], data[2]];
        let painted = 0;
        for (let i = 0; i < data.length; i += 16) if (Math.abs(data[i] - ground[0]) + Math.abs(data[i + 1] - ground[1]) + Math.abs(data[i + 2] - ground[2]) > 60) painted++;
        const radii = view.space.nodes.map((_, i) => view.r(i));
        return { links: view.space.links.length, painted: painted / (data.length / 16), smallest: Math.min(...radii), largest: Math.max(...radii) };
      }),
      (v) => v && v.links > 0
    );
    expect(seen.links).toBeGreaterThanOrEqual(14);
    expect(seen.painted).toBeGreaterThan(0.005);
    expect(seen.smallest).toBeGreaterThanOrEqual(3);
    expect(seen.largest).toBeGreaterThan(seen.smallest);
    await browser.pause(500);
    await shot('graph-3d');
    await browser.executeObsidian(async ({ app }) => {
      app.workspace.getLeavesOfType('design-redux-graph-3d').forEach((l) => l.detach());
      const f = app.vault.getAbstractFileByPath('Graph');
      if (f) await app.vault.delete(f, true);
    });
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

  it('draws an outline (1.1., 1.2.) as Obsidian draws its own numbered lists, and leaves typing in it to Obsidian: Enter after an item is a new line, no marker', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const path = 'Politics/Outline.md';
      const start = '1. Intro\n1.1. Background\n1.2. Scope\n\t1.2.1. Detail\n';
      const had = app.vault.getAbstractFileByPath(path);
      // Written afresh, so a second try starts where the first did.
      const file = had ? (await app.vault.modify(had, start), had) : await app.vault.create(path, start);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: 'source', source: false } });
      const editor = app.workspace.activeEditor.editor;
      editor.focus();
      editor.setCursor({ line: 1, ch: editor.getLine(1).length });
    });
    const value = () => browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.getValue());
    await browser.keys(['Enter']);
    await browser.keys('New');
    expect(await readUntil(value, (t) => t.includes('New'))).toBe('1. Intro\n1.1. Background\nNew\n1.2. Scope\n\t1.2.1. Detail\n');
    // Beside Obsidian's own "1.": the same grey, the same inset, the same spacing between items.
    const drawn = await browser.execute(() => {
      const lines = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line'));
      const own = lines.find((l) => l.textContent.startsWith('1. Intro'));
      const ours = lines.find((l) => l.textContent.startsWith('1.1. '));
      const mark = (l) => l.querySelector('.cm-formatting-list-ol');
      const box = (l) => l.getBoundingClientRect();
      return {
        colour: [getComputedStyle(mark(own)).color, getComputedStyle(mark(ours)).color],
        spacing: [getComputedStyle(own).paddingTop, getComputedStyle(ours).paddingTop],
        inset: [Math.round(mark(own).getBoundingClientRect().left - box(own).left), Math.round(mark(ours).getBoundingClientRect().left - box(ours).left)],
        hang: parseFloat(getComputedStyle(ours).paddingLeft) > 0,
        // Each of our markers fits the box the hang reckons: its words never run into it.
        fits: lines.filter((l) => l.classList.contains('dr-marked-item')).map((l) => {
          const prefix = l.querySelector('.dr-list-prefix');
          const range = document.createRange();
          range.selectNodeContents(prefix);
          const room = prefix.getBoundingClientRect().right - range.getBoundingClientRect().left;
          return range.getBoundingClientRect().width <= room + 0.5;
        }),
      };
    });
    expect(drawn.colour[1]).toBe(drawn.colour[0]);
    expect(drawn.spacing[1]).toBe(drawn.spacing[0]);
    expect(drawn.inset[1]).toBe(drawn.inset[0]);
    expect(drawn.hang).toBe(true);
    expect(drawn.fits).toEqual([true, true, true]);
    await shot('outline-list-editor');
    await browser.executeObsidian(async ({ app }) => {
      const leaf = app.workspace.getMostRecentLeaf();
      await leaf.setViewState({ type: 'markdown', state: { file: 'Politics/Outline.md', mode: 'preview' } });
    });
    const rows = await readUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .markdown-preview-view ol.dr-marked-list > li')).map((li) => li.dataset.marker)),
      (v) => v.length >= 3
    );
    expect(rows).toEqual(['1.1.', '1.2.', '1.2.1.']);
    const read = await browser.execute(() => {
      const view = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view');
      const own = view.querySelector('ol:not(.dr-marked-list) > li');
      const ours = view.querySelector('ol.dr-marked-list > li');
      const marker = (li) => getComputedStyle(li, '::marker');
      return { colour: [marker(own).color, marker(ours).color], content: marker(ours).content, spacing: [getComputedStyle(own).paddingTop, getComputedStyle(ours).paddingTop] };
    });
    expect(read.colour[1]).toBe(read.colour[0]);
    expect(read.spacing[1]).toBe(read.spacing[0]);
    expect(read.content).toContain('1.1.');
    await shot('outline-list');
  });

  it('leaves a marker written as text alone where Markdown makes its line code (indented past its list after a blank line)', async function () {
    await browser.executeObsidian(async ({ app }) => {
      const text = '2. [[Responsible government]]\n\ti. **Summary**\n\tWords.\n\n\t2.1. [[Parliamentary accountability]]\n\t\ti. **Summary**\n\n\t\tii. **Function**\n\t\tMore words.\n';
      const file = app.vault.getAbstractFileByPath('Politics/Indented.md') || (await app.vault.create('Politics/Indented.md', text));
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source', source: false } });
      app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });
    });
    const marked = await readUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line.dr-marked-item')).map((l) => l.textContent.trim())),
      (v) => v.length >= 3
    );
    expect(marked).toEqual(['i. Summary', '2.1. Parliamentary accountability', 'i. Summary']);
    const code = () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .cm-hmd-indented-code').length);
    // The outline command makes the note's outline numbers Obsidian's lists: nothing under them is code any more, and 2.1. reads as it did.
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:make-outline-list'));
    expect(await readUntil(code, (n) => n === 0)).toBe(0);
    const text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.getValue());
    expect(text).toContain('\t1. [[Parliamentary accountability]]\n');
    expect(text).toContain('numbering: "1.1"');
    await browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 }));
    const labels = await readUntil(
      () => browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line .dr-number')).map((n) => n.textContent.trim())),
      (v) => v.includes('2.1.')
    );
    expect(labels).toContain('2.1.');
    await shot('outline-made-lists');
  });

  it('draws what Markdown takes for code under a list as the note\'s text: rendered where the cursor is not, as typed without the code\'s look where it is, and in reading view', async function () {
    const text = 'A. regime\n1. [[Fusion of powers]]\n\ti. **Summary**\n\tThe *fusion of powers* is the core.\n\n3. [[Responsible government]]\n\ti. **Summary**\n\tWords.\n\n\t3.1. [[Parliamentary accountability]]\n\t\ti. **Summary**\n\t\t*Parliamentary accountability* is the doctrine.\n\n\t\tii. **Function**\n\t\t*Parliamentary accountability* connects things.\n\n\t\t3.1.1. [[Parliamentary oversight]]\n\t\t\ti. **Summary**\n\t\t\t*Parliamentary oversight* is the mechanism.\n\n\t\t\tii. **Process**\n\t\t\tIt works in three stages.\n\n\t3.2. [[Confidence convention]]\n\t\ti. **Summary**\n';
    const path = await browser.executeObsidian(async ({ app }, text) => {
      const path = `Politics/As text ${Date.now()}.md`;
      const file = await app.vault.create(path, text);
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source', source: false } });
      app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });
      return path;
    }, text);
    const look = () => browser.execute(() => {
      const view = document.querySelector('.workspace-leaf.mod-active .markdown-source-view');
      return {
        code: view.querySelectorAll('.cm-line .cm-hmd-indented-code').length,
        blocks: view.querySelectorAll('.dr-as-text-block').length,
        bold: Array.from(view.querySelectorAll('.dr-as-text-block strong')).map((b) => b.textContent),
        links: Array.from(view.querySelectorAll('.dr-as-text-block a.internal-link')).map((a) => a.textContent),
        // The guides: where Obsidian draws its own on the line above, in its colour and width.
        guides: (() => {
          const own = Array.from(view.querySelectorAll('.cm-line')).find((l) => l.textContent.includes('is the doctrine'));
          const mark = (el) => { const s = getComputedStyle(el, el.matches('.cm-indent') ? '::before' : null); return [Math.round(el.getBoundingClientRect().left + (el.matches('.cm-indent') ? parseFloat(s.marginLeft) : 0)), s.borderRightColor, s.borderRightWidth]; };
          return { own: Array.from(own.querySelectorAll('.cm-indent')).map(mark), ours: Array.from(view.querySelectorAll('.dr-as-text-guide')).slice(0, 2).map(mark) };
        })(),
      };
    });
    const shown = await readUntil(look, (v) => v.blocks > 0 && v.bold.length > 0);
    expect(shown.code).toBe(0);
    expect(shown.bold).toEqual(['Function', 'Summary', 'Process']);
    expect(shown.links).toEqual(['Parliamentary oversight']);
    expect(shown.guides.ours).toEqual(shown.guides.own);
    await shot('as-text-editor');
    // The cursor in them: the lines as typed, in the text's face, with no line round them.
    await browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.setCursor({ line: 13, ch: 4 }));
    const raw = await readUntil(
      () => browser.execute(() => {
        const lines = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line.dr-as-text-raw'));
        const code = lines.map((l) => l.querySelector('.cm-inline-code')).find(Boolean);
        const plain = document.querySelector('.workspace-leaf.mod-active .cm-line:not(.dr-as-text-raw)');
        return {
          lines: lines.map((l) => l.textContent.trim()),
          rest: document.querySelectorAll('.workspace-leaf.mod-active .dr-as-text-block').length,
          border: code ? getComputedStyle(code).borderTopWidth : '',
          face: code ? [getComputedStyle(code).fontFamily, getComputedStyle(plain).fontFamily] : [],
          size: code ? [getComputedStyle(code).fontSize, getComputedStyle(plain).fontSize] : [],
          hung: lines.every((l) => parseFloat(getComputedStyle(l).textIndent) < 0),
        };
      }),
      (v) => v.lines.length > 0
    );
    // Only the line the cursor is on, as typed: in the text's face and size, no line round it, a long line hung by its indent.
    expect(raw.lines).toEqual(['ii. **Function**']);
    expect(raw.rest).toBeGreaterThan(0);
    expect(raw.border).toBe('0px');
    expect(raw.face[0]).toBe(raw.face[1]);
    expect(raw.size[0]).toBe(raw.size[1]);
    expect(raw.hung).toBe(true);
    await shot('as-text-editing');
    // Typing in it is Obsidian's: Enter at the end of 3.1.1. is a new line, with no marker the plugin made.
    await browser.executeObsidian(({ app }) => {
      const editor = app.workspace.activeEditor.editor;
      editor.focus();
      editor.setCursor({ line: 16, ch: editor.getLine(16).length });
    });
    await browser.keys(['Enter']);
    await browser.keys('Next');
    const typed = await readUntil(() => browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.getLine(17)), (l) => l.includes('Next'));
    expect(typed.trim()).toBe('Next');
    await browser.executeObsidian(async ({ app }, path) => {
      await app.workspace.getMostRecentLeaf().setViewState({ type: 'markdown', state: { file: path, mode: 'preview' } });
    }, path);
    const read = await readUntil(
      () => browser.execute(() => {
        const view = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view');
        return { code: view.querySelectorAll('li pre').length, bold: Array.from(view.querySelectorAll('.dr-as-text-block strong')).map((b) => b.textContent) };
      }),
      (v) => v.bold.length > 0
    );
    expect(read.code).toBe(0);
    expect(read.bold).toContain('Function');
    await shot('as-text-reading');
  });

  it('leaves typing in a list written as text to Obsidian (Enter splits no item into a new one, nothing is counted on), and moves an item with what is under it from the palette', async function () {
    const value = () => browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.getValue());
    const at = (line, ch) => browser.executeObsidian(({ app }, line, ch) => { const e = app.workspace.activeEditor.editor; e.focus(); e.setCursor({ line, ch }); }, line, ch);
    await browser.executeObsidian(async ({ app }) => {
      const file = await app.vault.create(`Politics/Typing ${Date.now()}.md`, '3. Top\n\t3.1. one\n\tthree\n\t3.2. four\n\t3.3. five\n');
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source', source: false } });
    });
    await at(1, 9);
    await browser.keys(['Enter']);
    await browser.keys('more');
    const typed = await readUntil(value, (t) => t.includes('more'));
    expect(typed).not.toMatch(/3\.2\. more/);
    expect(typed).toContain('\t3.2. four\n\t3.3. five');
    // An item moved up with what is under it (its words), from the palette's command; the markers stay where they were.
    await browser.executeObsidian(({ app }) => {
      const e = app.workspace.activeEditor.editor;
      e.setValue('3. Top\n\t3.1. one\n\tthree\n\t3.2. four\n\t3.3. five\n');
      e.focus();
      e.setCursor({ line: 3, ch: 8 });
    });
    await browser.executeObsidian(({ app }) => app.commands.executeCommandById('design-redux:move-list-item-up'));
    expect(await readUntil(value, (t) => t.indexOf('four') < t.indexOf('one'))).toBe('3. Top\n\t3.1. four\n\t3.2. one\n\tthree\n\t3.3. five\n');
  });

  it('lays a list written as text out under the words: every line under an item, drawn by Obsidian or as text, starts where that item\'s words do', async function () {
    const text = '3. [[Responsible]]\n\ti. **SumA**\n\tWords A.\n\n\tii. **FunA**\n\n\t3.1. [[Accountability]]\n\t\ti. **SumB**\n\t\tWords B.\n\n\t\tii. **InternalB**\n\n\t\tiii. **UpstreamB**\n\t\tWords C.\n\n\t\t3.1.1. [[Oversight]]\n\t\t\ti. **SumC**\n\t\t\tWords D.\n';
    await browser.executeObsidian(async ({ app }, text) => {
      const file = await app.vault.create(`Politics/Laid out ${Date.now()}.md`, text);
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source', source: false } });
      // On a blank line, so every line around shows as it reads, its link's brackets hidden.
      app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
    }, text);
    const measure = () => browser.execute(() => {
      const root = document.querySelector('.workspace-leaf.mod-active .cm-content');
      const nodes = () => {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const out = [];
        for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n);
        return out;
      };
      const leftAt = (node, i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect().left; };
      const words = (s) => { const n = nodes().find((t) => t.data.includes(s)); return n ? leftAt(n, n.data.indexOf(s)) : null; };
      // Where a line's first character is drawn: its number, or its first word.
      const first = (s) => {
        const line = Array.from(root.querySelectorAll('.cm-line, .dr-as-text-line')).find((l) => l.textContent.includes(s));
        if (!line) return null;
        const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const i = n.data.search(/\S/);
          if (i >= 0) return leftAt(n, i);
        }
        return null;
      };
      const under = (parent, kids) => kids.map((k) => [k, Math.round((first(k) - words(parent)) * 10) / 10]);
      return {
        three: under('Responsible', ['SumA', 'Words A', 'FunA', 'Accountability']),
        threeOne: under('Accountability', ['SumB', 'Words B', 'InternalB', 'UpstreamB', 'Words C', 'Oversight']),
        threeOneOne: under('Oversight', ['SumC', 'Words D']),
      };
    });
    const got = await readUntil(measure, (v) => v.threeOneOne.every(([, d]) => !Number.isNaN(d)));
    // Under Obsidian's own "3.", within its figures' widths (Obsidian sets them one width, which no canvas measures); under these, to a pixel.
    got.three.forEach(([k, d]) => expect([k, Math.abs(d) <= 3]).toEqual([k, true]));
    got.threeOne.concat(got.threeOneOne).forEach(([k, d]) => expect([k, Math.abs(d) <= 1]).toEqual([k, true]));
    await shot('laid-out');
  });

  it('draws an outline\'s guides as the outline means them, in every look and mode: one under each item a line is under, all the same distance from their markers, none across a blank line', async function () {
    const found = [];
    for (const [name, text] of Object.entries({ ...GUIDE_NOTES, ...OLD_NOTES })) {
      for (const look of OLD_NOTES[name] ? [['theme', 'plugin']] : [['redux', 'plugin'], ['redux', 'window'], ['theme', 'plugin']]) {
        for (const mode of [{ mode: 'source', source: false }, { mode: 'source', source: true }]) for (const cursorAt of ['', 'ii. **', '\te']) {
          await browser.executeObsidian(async ({ app, plugins }, text, look, mode, name, cursorAt) => {
            Object.assign(plugins.designRedux.settings, { look: look[0], lookScope: look[1] });
            await plugins.designRedux.saveSettings();
            const path = `Politics/Audit ${name}.md`;
            let file = app.vault.getAbstractFileByPath(path);
            if (file) await app.vault.modify(file, text);
            else file = await app.vault.create(path, text);
            const leaf = app.workspace.getLeaf(false);
            await leaf.openFile(file, { state: mode });
            await leaf.setViewState({ type: 'markdown', state: { file: file.path, ...mode } });
            // The cursor where it is drawn differently: on an item, on words among code, or at the top.
            const at = cursorAt ? text.split('\n').findIndex((l) => l.includes(cursorAt)) : 0;
            app.workspace.activeEditor.editor.setCursor({ line: Math.max(0, at), ch: 0 });
            await new Promise((r) => setTimeout(r, 500));
          }, text, look, mode, name, cursorAt);
          const got = await browser.executeObsidian(auditGuides);
          const where = `${name}, look ${look.join('/')}, ${mode.source ? 'source' : 'live preview'}, cursor ${cursorAt || 'at the top'}`;
          got.violations.forEach((v) => found.push({ where, ...v }));
          if (got.violations.length) await shot(`guides-audit-${name}-${look.join('-')}-${mode.source ? 'source' : 'live'}`);
        }
      }
    }
    await browser.executeObsidian(async ({ plugins }) => {
      Object.assign(plugins.designRedux.settings, { look: 'redux', lookScope: 'plugin' });
      await plugins.designRedux.saveSettings();
    });
    // Typing, as the person types: Enter after a line of words, Tab twice, words; Enter after an item's last words. The guides are
    // audited after every key, in both modes.
    for (const mode of [{ mode: 'source', source: false }, { mode: 'source', source: true }]) {
      await browser.executeObsidian(async ({ app }, text, mode) => {
        const path = 'Politics/Audit typing.md';
        let file = app.vault.getAbstractFileByPath(path);
        if (file) await app.vault.modify(file, text);
        else file = await app.vault.create(path, text);
        const leaf = app.workspace.getLeaf(false);
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, ...mode } });
        const e = app.workspace.activeEditor.editor;
        const n = e.getValue().split('\n').findIndex((l) => l.includes('are shared.'));
        e.setCursor({ line: n, ch: e.getLine(n).length });
        e.focus();
        await new Promise((r) => setTimeout(r, 400));
      }, GUIDE_NOTES.tabs, mode);
      const steps = [['Enter'], ['Tab'], ['Tab'], ['W', 'o', 'r', 'd'], ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'End', 'Enter']];
      for (const keys of steps) {
        await browser.keys(keys);
        await browser.pause(250);
        const got = await browser.executeObsidian(auditGuides);
        const where = `typing in ${mode.source ? 'source' : 'live preview'}, after ${keys.join(' ')}`;
        got.violations.forEach((v) => found.push({ where, ...v }));
      }
    }
    if (found.length) console.log(JSON.stringify(found, null, 1));
    expect(found).toEqual([]);
  });

  it('checks a note\'s indent guides by command: nothing to mend on a sound one; a broken one listed, with a report that shows each line\'s indent', async function () {
    await browser.executeObsidian(async ({ app }, text) => {
      const path = 'Politics/Audit command.md';
      let file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.modify(file, text);
      else file = await app.vault.create(path, text);
      await app.workspace.getLeaf(false).setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: false } });
      await new Promise((r) => setTimeout(r, 500));
      app.commands.executeCommandById('design-redux:check-guides');
    }, GUIDE_NOTES.tabs);
    const sound = await readUntil(() => browser.execute(() => { const d = document.querySelector('dialog.dr-sheet'); return d ? d.textContent : ''; }), (t) => t.includes('INDENT GUIDES') || t.includes('Indent guides'));
    expect(sound).toContain('Nothing to mend');
    await browser.keys(['Escape']);
    // Broken on purpose: the plugin's guides hidden, as a theme or an old snippet might.
    const broken = await browser.executeObsidian(async ({ app, plugins }) => {
      const style = document.head.appendChild(document.createElement('style'));
      style.textContent = '.dr-indent-guide { display: none }';
      await new Promise((r) => setTimeout(r, 200));
      const got = plugins.designRedux.features.find((f) => f.constructor.name === 'GuideCheck').check();
      const sheet = document.querySelector('dialog.dr-sheet');
      const rows = sheet ? sheet.querySelectorAll('.dr-row').length : 0;
      const report = [];
      const clip = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async (t) => void report.push(t);
      sheet.querySelector('.dr-sheet-actions .dr-button').click();
      await new Promise((r) => setTimeout(r, 200));
      navigator.clipboard.writeText = clip;
      style.remove();
      return { problems: got.violations.length, rows, report: report[0] || '' };
    });
    expect(broken.problems).toBeGreaterThan(5);
    expect(broken.rows).toBeGreaterThan(5);
    expect(broken.report).toMatch(/Line \d+: \d guides? for the \d items? it is under\n  →/);
    expect(broken.report).toContain('Indentation guides: on');
  });

  it('gives a blank line of a list written as text the guides of its indent, an empty one none, Obsidian\'s at its own tab stops neither, and leaves the caret and typing Obsidian\'s', async function () {
    // As the person writes it: blank lines between an item's parts, some empty, some only the indent.
    const text = '2. [[Division]]\n\ti. **Summary**\n\tWords.\n\n\t2.1. [[Concurrent]]\n\t\ti. **Summary**\n\t\tMore words.\n\t\t\n\t\tii. **Internal**\n\t\t\n\t\tiii. **Upstream**\n\nAfter.\n';
    await browser.executeObsidian(async ({ app }, text) => {
      const file = await app.vault.create(`Politics/Guides ${Date.now()}.md`, text);
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source', source: false } });
      app.workspace.activeEditor.editor.setCursor({ line: 12, ch: 0 });
    }, text);
    const seen = await readUntil(() => browser.execute(() => {
      const lines = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-content > .cm-line'));
      const xs = (line) => Array.from(line.querySelectorAll('.dr-indent-guide')).map((g) => Math.round(g.getBoundingClientRect().right));
      const blank = lines.filter((l) => !l.textContent.trim());
      return {
        lines: lines.length,
        items: lines.filter((l) => l.textContent.trim()).map(xs),
        blank: blank.map(xs),
        // Obsidian's own guides on a blank line's spaces, drawn with any width (they stand at its tab stops, not where the items start).
        obsidian: blank.map((l) => Array.from(l.querySelectorAll('.cm-indent')).filter((s) => parseFloat(getComputedStyle(s, '::before').borderInlineEndWidth) > 0).length),
        // A blank line keeps a line's height: it is the gap the person wrote.
        heights: blank.map((l) => Math.round(l.getBoundingClientRect().height)),
        line: Math.round(lines.find((l) => l.textContent.includes('Words')).getBoundingClientRect().height),
      };
    }), (v) => v.lines >= 13);
    // The item lines keep their guides; a blank line of tabs under 2.1. has its two (2. and 2.1.), an empty one none.
    expect(seen.items.some((g) => g.length)).toBe(true);
    expect(seen.blank.map((g) => g.length)).toEqual([0, 2, 2, 0, 0]);
    expect(seen.obsidian.every((n) => n === 0)).toBe(true);
    seen.heights.forEach((h) => expect([h, h >= seen.line * 0.8]).toEqual([h, true]));
    await shot('guides-blank-gaps');
    // A gap made with Enter after a line of words: a blank line, the caret on it where the words typed there will stand, not at the margin.
    await browser.executeObsidian(({ app }) => {
      const e = app.workspace.activeEditor.editor;
      const at = e.getValue().split('\n').findIndex((l) => l.includes('More words.'));
      e.setCursor({ line: at, ch: e.getLine(at).length });
      e.focus();
    });
    await browser.keys(['Enter']);
    const gap = await readUntil(() => browser.executeObsidian(({ app }) => {
      // Where CodeMirror draws the caret (a collapsed DOM range beside a widget has no box to measure).
      const view = app.workspace.activeEditor.editor.cm;
      const head = view.state.selection.main.head;
      const caret = view.coordsAtPos(head).left;
      const words = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line')).find((l) => l.textContent.includes('More words.'));
      const range = document.createRange();
      const text = Array.from(words.querySelectorAll('*')).concat(words).flatMap((n) => Array.from(n.childNodes)).find((n) => n.nodeType === 3 && n.data.includes('More'));
      range.setStart(text, text.data.indexOf('More'));
      range.setEnd(text, text.data.indexOf('More') + 1);
      return Math.round(caret - range.getBoundingClientRect().left);
    }), (d) => Math.abs(d) <= 24, 3000);
    // After the spaces, which stay text: by the words, within one indent of them, not at the margin.
    expect([gap, Math.abs(gap) <= 24]).toEqual([gap, true]);
    // A click on a blank line, then typing: the indent is kept, the words go after it.
    await browser.keys(['Escape']);
    const target = await browser.executeObsidian(({ app }) => {
      const e = app.workspace.activeEditor.editor;
      const n = e.getValue().split('\n').findIndex((l, i, all) => !l.trim() && l.length && all[i + 1] && all[i + 1].includes('Internal'));
      const view = e.cm;
      const line = view.state.doc.line(n + 1);
      const box = view.coordsAtPos(line.to);
      return { n, x: Math.round(box.left + 40), y: Math.round((box.top + box.bottom) / 2) };
    });
    await browser.performActions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: target.x, y: target.y, origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }]);
    await browser.keys(['W', 'o', 'r', 'd']);
    const typed = await readUntil(() => browser.executeObsidian(({ app }, n) => app.workspace.activeEditor.editor.getLine(n), target.n), (l) => l.includes('Word'), 3000);
    expect(typed).toBe('\t\tWord');
  });

  it('numbers Obsidian\'s own lists as the note\'s numbering says: Obsidian keeps the list (Enter, its numbers, folding, collapsing) and the labels follow it, in live preview and reading view', async function () {
    // A note of its own each try, so a second try starts where the first did.
    const path = await browser.executeObsidian(async ({ app }) => {
      const path = `Politics/Numbered ${Date.now()}.md`;
      const file = await app.vault.create(path, '---\nnumbering: 1.1\n---\n1. Intro\n\t1. Background\n\t2. Scope\n\t\t1. Detail\n2. Method\n');
      await new Promise((r) => setTimeout(r, 300));
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: 'source', source: false } });
      const editor = app.workspace.activeEditor.editor;
      editor.focus();
      editor.setCursor({ line: 7, ch: editor.getLine(7).length });
      return path;
    });
    const labels = () => browser.execute(() => Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line .dr-number')).map((n) => n.textContent.trim()));
    expect(await readUntil(labels, (v) => v.length === 3)).toEqual(['1.1.', '1.2.', '1.2.1.']);
    // Obsidian's own Enter: it puts the item in and numbers the rest again; the labels follow.
    await browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.setCursor({ line: 4, ch: 14 }));
    await browser.keys(['Enter']);
    await browser.keys('New');
    const value = () => browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.getValue());
    expect(await readUntil(value, (t) => t.includes('New'))).toBe('---\nnumbering: 1.1\n---\n1. Intro\n\t1. Background\n\t2. New\n\t3. Scope\n\t\t1. Detail\n2. Method\n');
    await browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.setCursor({ line: 8, ch: 9 }));
    expect(await readUntil(labels, (v) => v.length === 4)).toEqual(['1.1.', '1.2.', '1.3.', '1.3.1.']);
    const drawn = await browser.execute(() => {
      const lines = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .cm-line'));
      const own = lines.find((l) => l.textContent.startsWith('1. Intro'));
      const ours = lines.find((l) => l.querySelector('.dr-number'));
      const label = ours.querySelector('.dr-number');
      const mark = own.querySelector('.cm-formatting-list-ol');
      // The words start where the line's hang says: the label is as wide as it was measured.
      const words = label.getBoundingClientRect().right;
      return {
        colour: [getComputedStyle(mark).color, getComputedStyle(label).color],
        inset: [getComputedStyle(mark).paddingLeft, getComputedStyle(label).paddingLeft],
        alone: !label.parentElement.matches('.cm-formatting-list-ol') && ours.querySelectorAll('.cm-formatting-list-ol').length === 1,
        fold: !!own.querySelector('.cm-fold-indicator'),
        fits: Math.abs(words - (ours.getBoundingClientRect().left + parseFloat(getComputedStyle(ours).paddingLeft))) < 2,
      };
    });
    expect(drawn.colour[1]).toBe(drawn.colour[0]);
    expect(drawn.inset[1]).toBe(drawn.inset[0]);
    expect(drawn.alone).toBe(true);
    expect(drawn.fold).toBe(true);
    expect(drawn.fits).toBe(true);
    // The cursor in a number: it shows as typed there, as live preview shows other marks.
    await browser.executeObsidian(({ app }) => app.workspace.activeEditor.editor.setCursor({ line: 4, ch: 2 }));
    expect(await readUntil(labels, (v) => v.length === 3)).toEqual(['1.2.', '1.3.', '1.3.1.']);
    await shot('numbered-editor');
    await browser.executeObsidian(async ({ app }, path) => {
      await app.workspace.getMostRecentLeaf().setViewState({ type: 'markdown', state: { file: path, mode: 'preview' } });
    }, path);
    const read = await readUntil(
      () => browser.execute(() => {
        const view = document.querySelector('.workspace-leaf.mod-active .markdown-preview-view');
        const items = Array.from(view.querySelectorAll('li'));
        return {
          labels: items.map((li) => li.dataset.drNumber),
          marker: items[1] ? getComputedStyle(items[1], '::marker').content : '',
          collapse: !!view.querySelector('li > .list-collapse-indicator'),
        };
      }),
      (v) => v.labels.length === 6
    );
    expect(read.labels).toEqual(['1.', '1.1.', '1.2.', '1.3.', '1.3.1.', '2.']);
    expect(read.marker).toContain('1.1.');
    expect(read.collapse).toBe(true);
    await shot('numbered-reading');
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

  it('edits a date in the browser\'s own date field, in the plugin\'s face and with no glyph, and turns a yes or no where it stands', async function () {
    const kind = await browser.executeObsidian(async ({ app }) => {
      const text = '---\ndue: 2026-01-05\ndone: false\n---\nText.\n';
      let file = app.vault.getAbstractFileByPath('Politics/Dated.md');
      if (file) await app.vault.modify(file, text);
      else file = await app.vault.create('Politics/Dated.md', text);
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'source' } });
      await new Promise((r) => setTimeout(r, 300));
      return typeof (app.metadataCache.getFileCache(file).frontmatter || {}).due;
    });
    expect(kind).toBe('string');
    const due = await $('.workspace-leaf.mod-active .dr-note-head .dr-prop[data-key="due"]');
    await due.waitForExist({ timeout: 8000 });
    await due.click();
    const field = await browser.execute(() => {
      const input = document.querySelector('.workspace-leaf.mod-active .dr-note-head .dr-prop[data-key="due"] input');
      if (!input) return null;
      // The rules that take the field's glyphs away are there (one pseudo-element the browser didn't know would drop a whole rule).
      const rules = Array.from(document.styleSheets).flatMap((sheet) => { try { return Array.from(sheet.cssRules); } catch (e) { return []; } }).map((r) => r.selectorText || '');
      const glyph = rules.some((t) => t.includes('dr-input::-webkit-calendar-picker-indicator')) && rules.some((t) => t.includes('dr-input::-webkit-datetime-edit'));
      const seen = { type: input.type, value: input.value, glyph: glyph ? 'none' : 'kept', font: getComputedStyle(input).fontFamily };
      input.value = '2026-03-02';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return seen;
    });
    await browser.keys(['Escape']);
    expect(field && [field.type, field.value, field.glyph]).toEqual(['date', '2026-01-05', 'none']);
    expect(field.font).toMatch(/mono/i);
    const read = () => browser.executeObsidian(({ app }) => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath('Politics/Dated.md')).frontmatter || {});
    expect((await readUntil(read, (fm) => fm.due === '2026-03-02')).due).toBe('2026-03-02');
    const done = await $('.workspace-leaf.mod-active .dr-note-head .dr-prop[data-key="done"]');
    await done.waitForExist({ timeout: 8000 });
    await done.click();
    expect((await readUntil(read, (fm) => fm.done === true)).done).toBe(true);
    expect(await browser.execute(() => !!document.querySelector('.workspace-leaf.mod-active .dr-note-head .dr-prop[data-key="done"] input'))).toBe(false);
  });

  it('draws the HTML a note holds in reading view: a heading group\'s line grey, a disclosure with no triangle (with the look on Obsidian\'s own regions), a progress bar the keys set and write into the text', async function () {
    const seen = await browser.executeObsidian(async ({ app, plugins }) => {
      // The note's own text takes the look only where it reaches Obsidian's regions.
      plugins.designRedux.settings.lookScope = 'window';
      await plugins.designRedux.saveSettings();
      const text = '# HTML\n\n<hgroup>\n<h2>Logic</h2>\n<p>A first course</p>\n</hgroup>\n\n<details>\n<summary>Proof</summary>\n\nBy induction.\n\n</details>\n\nDone: <progress value="2" max="5"></progress>\n';
      let file = app.vault.getAbstractFileByPath('Politics/Html.md');
      if (file) await app.vault.modify(file, text);
      else file = await app.vault.create('Politics/Html.md', text);
      await app.workspace.getLeaf(false).openFile(file, { state: { mode: 'preview' } });
      await new Promise((r) => setTimeout(r, 800));
      const root = document.querySelector('.workspace-leaf.mod-active .markdown-reading-view');
      const bar = root && root.querySelector('progress');
      const sub = root && root.querySelector('hgroup > p');
      const summary = root && root.querySelector('details > summary');
      return {
        bar: bar ? [bar.getAttribute('role'), bar.value, bar.max, getComputedStyle(bar).borderTopLeftRadius] : null,
        grey: sub ? getComputedStyle(sub).color !== getComputedStyle(root.querySelector('hgroup > h2')).color : null,
        marker: summary ? getComputedStyle(summary).listStyleType : null,
      };
    });
    expect(seen.bar).toEqual(['slider', 2, 5, '0px']);
    expect(seen.grey).toBe(true);
    expect(seen.marker).toBe('none');
    await shot('note-html-reading');
    await browser.execute(() => document.querySelector('.workspace-leaf.mod-active .markdown-reading-view progress').focus());
    await browser.keys(['ArrowRight', 'ArrowRight']);
    const written = await readUntil(
      () => browser.executeObsidian(({ app }) => app.vault.read(app.vault.getAbstractFileByPath('Politics/Html.md'))),
      (t) => t.includes('value="4"')
    );
    expect(written).toContain('<progress value="4" max="5"></progress>');
    const refocused = await readUntil(() => browser.execute(() => document.activeElement && document.activeElement.tagName), (t) => t === 'PROGRESS', 3000).catch(() => null);
    expect(refocused).toBe('PROGRESS');
    await browser.executeObsidian(async ({ plugins }) => {
      plugins.designRedux.settings.lookScope = 'plugin';
      await plugins.designRedux.saveSettings();
    });
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
