/*
 * The library: two framed panes. The sidebar is headed "Library" and holds
 * the vault's folders as a tree (a slash after one that holds more; a name
 * shows the folder in the page, and the tree unfolds to it); the page is headed by the folder's name and holds the
 * path to it as boxed words and its notes as ruled rows; the vault's top the
 * same. No buttons at rest;
 * search is a command. Worked from the keys; a vault of 2,000 notes drawn
 * at once.
 */
const assert = require('assert');
const { load, world, suite, settle, obsidian } = require('./harness.js');

const dr = load();
const check = suite('library');
const key = (el, k, more = {}) => el.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, more)));
const VAULT = {
  'Inbox/Scrap.md': 'x',
  'Logic/Logic.md': '---\ncover: \n---\nAbout logic.',
  'Logic/Truth tables.md': `# What a table shows\n\n## Building one\n\n${'word '.repeat(900)}`,
  'Logic/Validity.md': 'short',
  'Logic/Week 10.md': '', 'Logic/Week 2.md': '',
  'Logic/Sets/Problem set 1.md': '',
  'Reading/Hume.md': '---\nstatus: draft\ndomain: epistemology\n---\n# Of miracles\n',
  'Empty/.keep': '',
  'Loose.md': '',
};
const sidebar = (w) => w.app.workspace.getLeavesOfType('design-redux-library')[0].view.screen;
const paths = (root, sel) => Array.from(root.querySelectorAll(sel)).map((n) => n.dataset.path);
// A control: what a person presses or types in that isn't the content itself (a row, a cell, a link).
const controls = (root) => Array.from(root.querySelectorAll('.dr-icon-button, .dr-button, input, select, .checkbox-container, .dr-chip[role]'));

(async () => {
  const library = (w) => w.plugin.features.find((f) => f.constructor.name === 'Library');
  const page = async (w, folder) => (await library(w).browse(folder)).view.screen;

  await check('the sidebar opens with the plugin: headed Library, the vault\'s folders as a tree, a slash after one that holds more, no glyph, no notes, no control', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    assert.strictEqual(s.host.querySelector('.dr-pane > .dr-head .dr-head-name').textContent, 'Library');
    assert.deepStrictEqual(paths(s.host, '.dr-tree-row'), ['/', 'Inbox', 'Logic', 'Reading']);
    assert.deepStrictEqual(Array.from(s.host.querySelectorAll('.dr-tree-row')).map((r) => r.textContent), ['Vault', 'Inbox', 'Logic/', 'Reading']);
    assert.deepStrictEqual(Array.from(s.host.querySelectorAll('.dr-tree-row')).map((r) => r.getAttribute('aria-expanded')), [null, null, 'false', null]);
    assert.ok(!s.host.querySelector('svg'), 'a glyph in the tree');
    assert.deepStrictEqual(controls(s.host), []);
  });

  await check('the tree follows what is open: the open folder\'s subfolders and the path down to it, nothing else unfolded', async () => {
    const w = await world(Object.assign({}, VAULT, { 'Logic/Sets/Finite/a.md': '', 'Reading/Old/b.md': '' }));
    const s = sidebar(w);
    s.host.querySelector('.dr-tree-row[data-path="Logic"]').click();
    await settle();
    assert.deepStrictEqual(paths(s.host, '.dr-tree-row'), ['/', 'Inbox', 'Logic', 'Logic/Sets', 'Reading']);
    assert.strictEqual(s.host.querySelector('.dr-tree-row[data-path="Logic/Sets"]').getAttribute('aria-level'), '3');
    s.host.querySelector('.dr-tree-row[data-path="Logic/Sets"]').click();
    await settle();
    assert.deepStrictEqual(paths(s.host, '.dr-tree-row'), ['/', 'Inbox', 'Logic', 'Logic/Sets', 'Logic/Sets/Finite', 'Reading']);
    s.host.querySelector('.dr-tree-row[data-path="Reading"]').click();
    await settle();
    assert.deepStrictEqual(paths(s.host, '.dr-tree-row'), ['/', 'Inbox', 'Logic', 'Reading', 'Reading/Old']);
  });

  await check('a folder\'s name pressed in the tree shows it in the page: headed by its name, the path boxed, its notes as ruled rows; the tree marks it', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    s.host.querySelector('.dr-tree-row[data-path="Logic"]').click();
    await settle();
    const p = w.app.workspace.getLeavesOfType('design-redux-browse')[0].view.screen;
    assert.strictEqual(p.at, 'Logic');
    assert.strictEqual(p.host.querySelector('.dr-head-name').textContent, 'Logic');
    assert.deepStrictEqual(Array.from(p.host.querySelectorAll('.dr-crumb')).map((c) => [c.textContent, c.getAttribute('aria-current')]), [['Vault', null], ['Logic', 'location']]);
    assert.deepStrictEqual(paths(p.host, '.dr-rows .dr-row'), ['Logic/Truth tables.md', 'Logic/Validity.md', 'Logic/Week 2.md', 'Logic/Week 10.md']);
    assert.deepStrictEqual(controls(p.host), []);
    assert.strictEqual(s.host.querySelector('.dr-tree-row[data-path="Logic"]').getAttribute('aria-current'), 'location');
    p.host.querySelector('.dr-crumb').click();
    assert.strictEqual(p.at, '/');
  });

  await check('what is open is filled, and so is what is picked: one sign, nothing beside it', async () => {
    const w = await world(VAULT);
    await w.app.workspace.getLeaf().openFile(w.file('Logic/Validity.md'));
    const p = await page(w, w.file('Logic'));
    await settle();
    assert.strictEqual(p.host.querySelector('.dr-row[data-path="Logic/Validity.md"]').getAttribute('aria-current'), 'page');
    w.plugin.selection.pick(w.file('Logic/Week 2.md'));
    await settle();
    assert.strictEqual(p.host.querySelector('.dr-row[data-path="Logic/Week 2.md"]').getAttribute('aria-selected'), 'true');
    assert.ok(!p.host.querySelector('.dr-slot, .dr-mark'), 'a mark beside a row');
  });

  await check('from the keys: one Tab stop, arrows, Enter shows a folder, a letter jumps', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    const stops = () => Array.from(s.body.querySelectorAll('.dr-tree [tabindex="0"]'));
    assert.strictEqual(stops().length, 1);
    const first = stops()[0];
    first.focus();
    key(first, 'ArrowDown');
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Inbox');
    key(w.doc.activeElement, 'l');
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Logic');
    key(w.doc.activeElement, 'Enter');
    await settle();
    const p = w.app.workspace.getLeavesOfType('design-redux-browse')[0].view.screen;
    assert.strictEqual(p.at, 'Logic');
    const row = p.body.querySelector('.dr-row[data-path="Logic/Validity.md"]');
    row.focus();
    key(row, 'Enter');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Validity.md');
  });

  await check('2,000 notes: drawn at once, and a redraw asked many times is one', async () => {
    const files = {};
    for (let f = 0; f < 40; f++) for (let n = 0; n < 50; n++) files[`Folder ${f}/Note ${n}.md`] = 'x'.repeat((n % 9) * 700);
    const w = await world(files);
    const s = await page(w, null);
    const t = Date.now();
    for (let f = 0; f < 40; f++) s.go(w.file(`Folder ${f}`));
    const took = Date.now() - t;
    assert.strictEqual(s.host.querySelectorAll('.dr-row').length, 50);
    // jsdom is many times slower than the app; this is the ceiling there for 40 pages.
    assert.ok(took < 3000, `40 pages took ${took}ms`);
    let draws = 0;
    const draw = s.draw.bind(s);
    s.draw = () => { draws++; draw(); };
    for (let i = 0; i < 50; i++) s.refresh();
    await settle();
    assert.strictEqual(draws, 1);
    const built = w.plugin.index.build();
    s.draw();
    assert.strictEqual(w.plugin.index.build(), built, 'the vault was walked again for a draw');
  });

  await check('search: folders and notes by name, notes by a heading or a property; the last searches kept; a command, its field the page\'s', async () => {
    const w = await world(VAULT);
    const found = dr.searchLibrary(w.plugin, 'tab');
    assert.deepStrictEqual(found.notes.map((f) => f.path), ['Logic/Truth tables.md']);
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'miracles').inside.map((h) => [h.file.path, h.subpath]), [['Reading/Hume.md', '#Of miracles']]);
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'epistem').inside.map((h) => h.where), ['domain'], 'a hit says where, not the person\'s words');
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'log').folders.map((f) => f.path), ['Logic']);
    w.app.commands.executeCommandById('design-redux:search-library');
    await settle();
    const p = w.app.workspace.getLeavesOfType('design-redux-browse')[0].view.screen;
    const input = p.host.querySelector('input.dr-input');
    input.value = 'week';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.deepStrictEqual(paths(p.host, '.dr-search-results .dr-row'), ['Logic/Week 2.md', 'Logic/Week 10.md']);
    key(input, 'Enter');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Week 2.md');
    assert.deepStrictEqual(w.plugin.settings.recentSearches, ['week']);
    key(p.host.querySelector('input.dr-input'), 'Escape');
    assert.strictEqual(p.host.querySelector('.dr-head-name').textContent, 'Vault', 'the vault did not come back');
  });

  await check('a folder\'s menu and a note\'s: every entry sectioned, pin, sort, rename, move and delete do what they say', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    const row = s.host.querySelector('[data-path="Logic"]');
    row.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    const menu = obsidian.Menu.shown;
    const base = ['Open', 'New note', 'New folder', 'Pin', 'Sort by', 'Rename…', 'Move to…', 'Delete folder'];
    assert.deepStrictEqual(menu.titles().filter((t) => base.includes(t)), base);
    assert.ok(!menu.titles().includes('Glyph…'), 'a folder still offers a glyph');
    ['Kind…', 'Merge into…', 'Split notes off…'].forEach((t) => assert.ok(menu.titles().includes(t), `the folder menu lacks ${t}`));
    assert.ok(!menu.titles().includes('Cover…'), 'a folder still offers a cover');
    await menu.click('Pin');
    assert.deepStrictEqual(w.plugin.settings.pinOrder, ['Logic']);
    menu.items.find((i) => i.title === 'Sort by').submenu.click('Last edited');
    await settle();
    assert.strictEqual(dr.sortOf(w.plugin, w.file('Logic')), 'modified');
    const del = dr.deleteEntry(w.plugin, w.file('Inbox'));
    obsidian.Modal.open[0].contentEl.querySelector('.is-danger').click();
    await del;
    assert.ok(!w.file('Inbox'));
    const note = dr.noteMenu(w.plugin, w.file('Logic/Validity.md'));
    assert.deepStrictEqual(note.titles().slice(0, 3), ['Open', 'Open in a new tab', 'Pin']);
  });

  await check('dropping a note on a folder moves it there, with an Undo', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    const p = await page(w, null);
    const data = { store: {}, types: [], setData(t, v) { this.store[t] = v; this.types.push(t); }, getData(t) { return this.store[t] || ''; } };
    const fire = (el, type) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = data; el.dispatchEvent(e); return e; };
    fire(p.host.querySelector('[data-path="Loose.md"]'), 'dragstart');
    const target = s.host.querySelector('[data-path="Reading"]');
    assert.ok(fire(target, 'dragover').defaultPrevented && target.hasAttribute('data-drop'));
    fire(target, 'drop');
    await settle();
    assert.ok(w.file('Reading/Loose.md') && !w.file('Loose.md'));
    await w.plugin.lastUndo.run();
    assert.ok(w.file('Loose.md'));
  });

  await check('the vault\'s top is a page like any folder\'s: headed Vault, its loose notes as ruled rows, pinned ones first; no grid, no buttons', async () => {
    const w = await world(Object.assign({}, VAULT, { 'Alpha.md': '', 'Zed.md': '' }), { settingsVersion: 103, pinOrder: ['Zed.md'] });
    const host = (await page(w, null)).host;
    assert.strictEqual(host.querySelector('.dr-head-name').textContent, 'Vault');
    assert.deepStrictEqual(Array.from(host.querySelectorAll('.dr-crumb')).map((c) => c.textContent), ['Vault']);
    assert.deepStrictEqual(paths(host, '.dr-rows .dr-row'), ['Zed.md', 'Alpha.md', 'Loose.md']);
    assert.ok(!host.querySelector('.dr-grid, .dr-cell, img'), 'a grid or a cover');
    assert.deepStrictEqual(controls(host), []);
  });

  await check('commands: the old ids, the levels\' one kept but quiet, and turning the library off takes its views away', async () => {
    const w = await world(VAULT);
    const ids = Object.keys(w.app.commands.commands).map((c) => c.split(':')[1]);
    ['open-library', 'browse-vault', 'search-library', 'reset-layout', 'cycle-cover-size', 'go-back', 'go-forward', 'new-note-here', 'new-folder-here', 'previous-in-album', 'next-in-album'].forEach((id) => assert.ok(ids.includes(id), `${id} is not a command`));
    await w.app.workspace.getLeaf().openFile(w.file('Logic/Validity.md'));
    w.app.commands.executeCommandById('design-redux:next-in-album');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Week 2.md');
    const levels = w.app.commands.commands['design-redux:cycle-cover-size'];
    assert.strictEqual(levels.checkCallback ? levels.checkCallback(true) : false, false, 'the retired levels command still offers itself');
    w.plugin.settings.library = false;
    await w.plugin.saveSettings();
    assert.strictEqual(w.app.workspace.getLeavesOfType('design-redux-library').length, 0);
  });

  check.done();
})();
