/* File-browser navigation, file handling, selection and Obsidian lifecycle. */
const assert = require('assert');
const { load, world, suite, settle, obsidian, window } = require('./harness.js');
const dr = load();
const check = suite('library');
const files = { 'Philosophy/Logic/Proof.md': '', 'Philosophy/Metaphysics/Being.md': '', 'Philosophy/Arguments.md': '', 'Philosophy/Diagram.pdf': 'pdf', 'Empty/.keep': '', 'Loose.md': '' };
const sidebar = (w) => w.app.workspace.getLeavesOfType('design-redux-library')[0].view.screen;
const paths = (host) => Array.from(host.querySelectorAll('.dr-file-row')).map((n) => n.dataset.path);
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

(async () => {
  await check('the sidebar lists folders, notes and attachments without hiding empty folders', async () => {
    const w = await world(files);
    const s = sidebar(w);
    assert.deepStrictEqual(paths(s.host), ['Empty', 'Philosophy', 'Loose.md']);
    assert.strictEqual(s.host.querySelector('.dr-file-items').getAttribute('role'), 'tree');
    assert.ok(s.host.querySelector('input[aria-label="Search files"]'));
    assert.ok(!s.host.querySelector('[aria-label="Level of detail"]'));
    s.go(w.file('Philosophy'));
    assert.deepStrictEqual(paths(s.host), ['Philosophy', 'Philosophy/Logic', 'Philosophy/Metaphysics', 'Philosophy/Arguments.md', 'Philosophy/Diagram.pdf']);
    s.host.querySelector('[aria-label="Expand Logic"]').click();
    assert.ok(s.host.querySelector('[data-path="Philosophy/Logic/Proof.md"]'));
    s.host.querySelector('[aria-label="Collapse Logic"]').click();
    assert.ok(!s.host.querySelector('[data-path="Philosophy/Logic/Proof.md"]'));
  });

  await check('search finds non-Markdown files throughout the vault and clears', async () => {
    const w = await world(files); const s = sidebar(w);
    const input = s.host.querySelector('input[aria-label="Search files"]');
    input.value = 'diagram'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.deepStrictEqual(paths(s.host), ['Philosophy/Diagram.pdf']);
    assert.ok(s.host.textContent.includes('Philosophy/Diagram.pdf'));
    input.value = ''; input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.deepStrictEqual(paths(s.host), ['Empty', 'Philosophy', 'Loose.md']);
  });

  await check('the main view shows file types, details and synchronized navigation', async () => {
    const w = await world(files); const lib = w.plugin.features.find((f) => f.constructor.name === 'Library');
    const leaf = await lib.browse(w.file('Philosophy')); const s = leaf.view.screen;
    assert.strictEqual(s.host.querySelector('.dr-file-items').getAttribute('role'), 'listbox');
    assert.deepStrictEqual(paths(s.host), ['Philosophy/Logic', 'Philosophy/Metaphysics', 'Philosophy/Arguments.md', 'Philosophy/Diagram.pdf']);
    assert.ok(s.host.textContent.includes('Markdown') && s.host.textContent.includes('PDF'));
    w.plugin.selection.pick(w.file('Philosophy/Diagram.pdf')); await settle();
    assert.ok(leaf.view.aside.textContent.includes('Diagram.pdf') && leaf.view.aside.textContent.includes('PDF'));
    sidebar(w).go(w.file('Philosophy/Logic')); assert.strictEqual(s.at, 'Philosophy/Logic');
    assert.deepStrictEqual(leaf.getViewState().state, { at: 'Philosophy/Logic' });
    s.host.querySelector('.dr-file-breadcrumb button').click(); assert.strictEqual(s.at, '/');
  });

  await check('keyboard activation opens a file using Obsidian, and attachment menus contain file actions', async () => {
    const w = await world(files); const s = sidebar(w); s.go(w.file('Philosophy'));
    const pdf = s.host.querySelector('[data-path="Philosophy/Diagram.pdf"]');
    pdf.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.deepStrictEqual(obsidian.Menu.shown.titles().slice(0, 4), ['Open', 'Open in a new tab', 'Rename…', 'Move to…']);
    key(pdf, 'Enter'); await settle(); assert.strictEqual(w.app.workspace.getActiveFile().path, 'Philosophy/Diagram.pdf');
  });

  await check('index and browser refresh on create, rename and delete', async () => {
    const w = await world(files); const s = sidebar(w); s.go(w.file('Philosophy'));
    await w.app.vault.create('Philosophy/New.pdf', 'pdf'); await settle();
    assert.ok(s.host.querySelector('[data-path="Philosophy/New.pdf"]'));
    await w.app.vault.rename(w.file('Philosophy/New.pdf'), 'Philosophy/Changed.pdf'); await settle();
    assert.ok(s.host.querySelector('[data-path="Philosophy/Changed.pdf"]'));
    await w.app.vault.delete(w.file('Philosophy/Changed.pdf')); await settle();
    assert.ok(!s.host.querySelector('[data-path="Philosophy/Changed.pdf"]'));
  });

  await check('dragging a file onto a folder uses Obsidian file operations and supports undo', async () => {
    const w = await world(files); const s = sidebar(w);
    const data = { store: {}, types: [], setData(t, v) { this.store[t] = v; this.types.push(t); }, getData(t) { return this.store[t] || ''; } };
    const fire = (el, type) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = data; el.dispatchEvent(e); return e; };
    fire(s.host.querySelector('[data-path="Loose.md"]'), 'dragstart');
    const target = s.host.querySelector('[data-path="Philosophy"]');
    assert.ok(fire(target, 'dragover').defaultPrevented);
    fire(target, 'drop'); await settle();
    assert.ok(w.file('Philosophy/Loose.md'));
    await w.plugin.lastUndo.run();
    assert.ok(w.file('Loose.md'));
  });

  await check('arrow keys expand folders and focus survives redraws', async () => {
    const w = await world(files); const s = sidebar(w);
    const folder = s.host.querySelector('[data-path="Philosophy"]');
    folder.focus(); key(folder, 'ArrowRight');
    assert.ok(s.host.querySelector('[data-path="Philosophy/Logic"]'));
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Philosophy');
    key(w.doc.activeElement, 'ArrowLeft');
    assert.ok(!s.host.querySelector('[data-path="Philosophy/Logic"]'));
  });

  await check('repeated refreshes coalesce and reuse the index', async () => {
    const vault = {};
    for (let i = 0; i < 2000; i++) vault[`Notes/Note ${i}.md`] = '';
    const w = await world(vault); const s = sidebar(w); s.go(w.file('Notes'));
    const index = w.plugin.index.build(); let draws = 0;
    const draw = s.draw.bind(s); s.draw = () => { draws++; draw(); };
    for (let i = 0; i < 50; i++) s.refresh();
    await settle();
    assert.strictEqual(draws, 1);
    assert.strictEqual(w.plugin.index.build(), index);
    assert.strictEqual(s.host.querySelectorAll('.dr-file-row').length, 2001);
  });

  await check('library commands retain their ids and disabling the library closes its views', async () => {
    const w = await world(files);
    ['open-library', 'browse-vault', 'cycle-cover-size', 'go-back', 'go-forward'].forEach((id) => assert.ok(w.app.commands.commands[`design-redux:${id}`]));
    w.plugin.settings.library = false; await w.plugin.saveSettings();
    assert.strictEqual(w.app.workspace.getLeavesOfType('design-redux-library').length, 0);
  });
  await check('a workspace saved with the removed map closes its retired tab', async () => {
    const w = await world(files); const leaf = w.app.workspace.getLeaf();
    await leaf.setViewState({ type: 'design-redux-mindmap' });
    await settle();
    assert.strictEqual(w.app.workspace.getLeavesOfType('design-redux-mindmap').length, 0);
    assert.ok(w.app.commands.commands['design-redux:open-graph-3d']);
  });
  check.done();
})();
