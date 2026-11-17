/* Library lists folders; a folder lists notes; notes remain ordinary Obsidian files. */
const assert = require('assert');
const { load, world, suite, settle, obsidian, window } = require('./harness.js');
const dr = load();
const check = suite('library');
const files = { 'Philosophy/Logic/Proof.md': '', 'Philosophy/Metaphysics/Being.md': '', 'Philosophy/Arguments.md': '', 'Philosophy/Diagram.pdf': 'pdf', 'Empty/.keep': '', 'Loose.md': '' };
const sidebar = async (w) => { const lib = w.plugin.features.find((f) => f.constructor.name === 'Library'); return (await lib.browse(null)).view.folderScreen; };
const paths = (host) => Array.from(host.querySelectorAll('.dr-file-row')).map((n) => n.dataset.path);
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

(async () => {
  await check('an empty workspace starts in the browser and notes can return to their folder with pages disabled', async () => {
    const w = await world(files, { settingsVersion: 100, notePages: false });
    await settle();
    assert.strictEqual(w.app.workspace.getLeavesOfType('design-redux-browse').length, 1);
    const leaf = w.app.workspace.getLeaf();
    await leaf.openFile(w.file('Philosophy/Arguments.md')); await settle();
    const nav = leaf.view.contentEl.querySelector('.dr-workspace-return');
    assert.strictEqual(nav.querySelector('button').textContent, '← Philosophy');
    assert.strictEqual(nav.querySelector('span').textContent, 'Arguments');
    nav.querySelector('button').click(); await settle();
    const view = w.app.workspace.getLeavesOfType('design-redux-browse')[0].view;
    assert.strictEqual(view.screen.at, 'Philosophy');
    assert.strictEqual(view.folderScreen.at, 'Philosophy');
    w.plugin.unload(); await settle();
    assert.ok(!w.doc.querySelector('.dr-workspace-return'));
    assert.ok(!w.doc.body.classList.contains('dr-browser-open'));
  });

  await check('the library lists only folders, including empty and nested folders', async () => {
    const w = await world(files); const s = await sidebar(w);
    assert.deepStrictEqual(paths(s.host), ['/', 'Empty', 'Philosophy']);
    assert.strictEqual(s.host.querySelector('.dr-file-items').getAttribute('role'), 'tree');
    assert.ok(!s.host.querySelector('input, .dr-file-details-title'));
    s.host.querySelector('[data-path="Philosophy"] .dr-file-disclosure').click();
    assert.deepStrictEqual(paths(s.host), ['/', 'Empty', 'Philosophy', 'Philosophy/Logic', 'Philosophy/Metaphysics']);
    assert.ok(!s.host.querySelector('[data-path="Philosophy/Arguments.md"]'));
  });

  await check('a folder lists only its notes, and the root shows loose notes', async () => {
    const w = await world(files); const lib = w.plugin.features.find((f) => f.constructor.name === 'Library');
    const leaf = await lib.browse(w.file('Philosophy')); const s = leaf.view.screen;
    assert.deepStrictEqual(paths(s.host), ['Philosophy/Arguments.md']);
    assert.strictEqual(s.host.querySelector('.dr-file-items').getAttribute('role'), 'listbox');
    assert.ok(!s.host.querySelector('.dr-file-details-title, .dr-file-type, input'));
    s.host.querySelector('.dr-file-breadcrumb button').click();
    assert.deepStrictEqual(paths(s.host), ['Loose.md']);
  });

  await check('choosing a folder updates the folder screen and Enter opens its note in Obsidian', async () => {
    const w = await world(files); const s = await sidebar(w);
    const lib = w.plugin.features.find((f) => f.constructor.name === 'Library');
    const leaf = await lib.browse(null);
    let updates = 0; leaf.updateHeader = () => { updates++; };
    key(s.host.querySelector('[data-path="Philosophy"]'), 'Enter');
    assert.strictEqual(leaf.view.screen.at, 'Philosophy');
    assert.strictEqual(leaf.view.getDisplayText(), 'Philosophy');
    assert.ok(updates > 0, 'folder changes must refresh the tab title');
    const note = leaf.view.screen.host.querySelector('[data-path="Philosophy/Arguments.md"]');
    key(note, 'Enter'); await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Philosophy/Arguments.md');
    assert.ok(!leaf.view.contentEl.querySelector('.dr-note-head, .dr-strip'));
  });

  await check('the browser keeps both panels in one view', async () => {
    const w = await world(files); const s = await sidebar(w);
    const view = w.app.workspace.getLeavesOfType('design-redux-browse')[0].view;
    assert.ok(view.contentEl.classList.contains('dr-browser-layout'));
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-library').length, 2);
    assert.ok(w.doc.body.classList.contains('dr-browser-open'));
    key(s.host.querySelector('[data-path="Philosophy"]'), 'Enter');
    assert.deepStrictEqual(paths(view.screen.host), ['Philosophy/Arguments.md']);
    await w.app.workspace.getLeaf().openFile(w.file('Loose.md'));
    assert.ok(w.doc.body.classList.contains('dr-browser-open'), 'the native chrome stays out of the plugin workspace');
  });

  await check('arrow keys expand folders and focus survives redraws', async () => {
    const w = await world(files); const s = await sidebar(w);
    const folder = s.host.querySelector('[data-path="Philosophy"]');
    folder.focus(); key(folder, 'ArrowRight');
    assert.ok(s.host.querySelector('[data-path="Philosophy/Logic"]'));
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Philosophy');
    key(w.doc.activeElement, 'ArrowLeft');
    assert.ok(!s.host.querySelector('[data-path="Philosophy/Logic"]'));
  });

  await check('the folder list refreshes on create, rename and delete without exposing attachments', async () => {
    const w = await world(files); const lib = w.plugin.features.find((f) => f.constructor.name === 'Library');
    const leaf = await lib.browse(w.file('Philosophy')); const s = leaf.view.screen;
    await w.app.vault.create('Philosophy/New.md', ''); await settle();
    assert.ok(s.host.querySelector('[data-path="Philosophy/New.md"]'));
    await w.app.vault.rename(w.file('Philosophy/New.md'), 'Philosophy/Changed.md'); await settle();
    assert.ok(s.host.querySelector('[data-path="Philosophy/Changed.md"]'));
    await w.app.vault.delete(w.file('Philosophy/Changed.md')); await settle();
    assert.ok(!s.host.querySelector('[data-path="Philosophy/Changed.md"]'));
    assert.ok(!s.host.querySelector('[data-path="Philosophy/Diagram.pdf"]'));
    assert.ok(w.file('Philosophy/Diagram.pdf'));
  });

  await check('large folders reuse the vault index and coalesce redraws', async () => {
    const vault = {}; for (let i = 0; i < 2000; i++) vault[`Notes/Note ${i}.md`] = '';
    const w = await world(vault); const lib = w.plugin.features.find((f) => f.constructor.name === 'Library');
    const leaf = await lib.browse(w.file('Notes')); const s = leaf.view.screen;
    const index = w.plugin.index.build(); let draws = 0; const draw = s.draw.bind(s); s.draw = () => { draws++; draw(); };
    for (let i = 0; i < 50; i++) s.refresh(); await settle();
    assert.strictEqual(draws, 1); assert.strictEqual(w.plugin.index.build(), index);
    assert.strictEqual(s.host.querySelectorAll('.dr-file-row').length, 2000);
  });

  await check('removed workspace views close while the 3D graph remains available', async () => {
    const w = await world(files);
    for (const type of ['design-redux-mindmap', 'design-redux-properties']) {
      const leaf = w.app.workspace.getLeaf(); await leaf.setViewState({ type }); await settle();
      assert.strictEqual(w.app.workspace.getLeavesOfType(type).length, 0);
    }
    assert.ok(w.app.commands.commands['design-redux:open-graph-3d']);
  });
  check.done();
})();
