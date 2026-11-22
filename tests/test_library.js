/*
 * The library: two framed panes. The sidebar is headed "Vault" and holds
 * its folders as a tree (a slash after one that holds more; a name
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

  await check('a property changed leaves the tree and a folder\'s page as they are: only search and filters read properties', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    const p = await page(w, w.app.vault.getAbstractFileByPath('Logic'));
    const [tree, list] = [s.host.firstChild, p.host.firstChild];
    w.app.workspace.trigger('design-redux:props', w.app.vault.getMarkdownFiles()[0]);
    await settle();
    assert.ok(s.host.firstChild === tree && p.host.firstChild === list, 'a property change drew the tree or a folder page again');
    w.app.workspace.trigger('design-redux:vault');
    await settle();
    assert.ok(s.host.firstChild !== tree, 'a change to the vault should still draw the tree again');
  });

  await check('the sidebar opens with the plugin: headed Vault (pressed, the vault in the page), its folders as a tree, a slash after one that holds more, no glyph, no notes, no control', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    const head = s.host.querySelector('.dr-pane > .dr-head .dr-head-name');
    assert.strictEqual(head.textContent, 'Vault');
    assert.deepStrictEqual(paths(s.host, '.dr-tree-row'), ['Inbox', 'Logic', 'Reading'], 'the vault is the head, not a row of the tree');
    assert.deepStrictEqual(Array.from(s.host.querySelectorAll('.dr-tree-row')).map((r) => r.textContent), ['Inbox', 'Logic/', 'Reading']);
    assert.deepStrictEqual(Array.from(s.host.querySelectorAll('.dr-tree-row')).map((r) => r.getAttribute('aria-expanded')), [null, 'false', null]);
    head.click();
    await settle();
    const page = w.app.workspace.getLeavesOfType('design-redux-browse')[0];
    assert.ok(page && page.view.screen.at === '/', 'Vault pressed did not show the vault in the page');
    assert.ok(!s.host.querySelector('svg'), 'a glyph in the tree');
    assert.deepStrictEqual(controls(s.host), []);
    // Its head holds one word, Settings, for Obsidian's own.
    const ran = [];
    const run = w.app.commands.executeCommandById;
    w.app.commands.executeCommandById = (id) => ran.push(id);
    const link = s.host.querySelector('.dr-head .dr-head-link');
    assert.strictEqual(link.textContent, 'Settings');
    link.click();
    w.app.commands.executeCommandById = run;
    assert.deepStrictEqual(ran, ['app:open-settings']);
  });

  await check('the tree follows what is open: the open folder\'s subfolders and the path down to it, nothing else unfolded', async () => {
    const w = await world(Object.assign({}, VAULT, { 'Logic/Sets/Finite/a.md': '', 'Reading/Old/b.md': '' }));
    const s = sidebar(w);
    s.host.querySelector('.dr-tree-row[data-path="Logic"]').click();
    await settle();
    assert.deepStrictEqual(paths(s.host, '.dr-tree-row'), ['Inbox', 'Logic', 'Logic/Sets', 'Reading']);
    assert.strictEqual(s.host.querySelector('.dr-tree-row[data-path="Logic/Sets"]').getAttribute('aria-level'), '2');
    s.host.querySelector('.dr-tree-row[data-path="Logic/Sets"]').click();
    await settle();
    assert.deepStrictEqual(paths(s.host, '.dr-tree-row'), ['Inbox', 'Logic', 'Logic/Sets', 'Logic/Sets/Finite', 'Reading']);
    s.host.querySelector('.dr-tree-row[data-path="Reading"]').click();
    await settle();
    assert.deepStrictEqual(paths(s.host, '.dr-tree-row'), ['Inbox', 'Logic', 'Reading', 'Reading/Old']);
  });

  await check('with the look on, the library is kept the tab the left sidebar shows: brought forward after a layout change, and opened again if gone', async () => {
    const w = await world(VAULT);
    const ws = w.app.workspace;
    const library = ws.getLeavesOfType('design-redux-library')[0];
    ws.revealed = null;
    ws.trigger('layout-change');
    await settle();
    assert.strictEqual(ws.revealed, library, 'the library was not brought forward');
    // A second library, as a reload of the plugin can leave, goes.
    await ws.getLeftLeaf(false).setViewState({ type: 'design-redux-library' });
    ws.trigger('layout-change');
    await settle();
    assert.strictEqual(ws.getLeavesOfType('design-redux-library').length, 1, 'two libraries');
    library.detach();
    await settle();
    assert.strictEqual(ws.getLeavesOfType('design-redux-library').length, 1, 'the library was not opened again');
    w.plugin.settings.look = 'theme';
    await w.plugin.saveSettings();
    ws.revealed = null;
    ws.trigger('layout-change');
    await settle();
    assert.strictEqual(ws.revealed, null, 'the library was pushed forward with the look off');
  });

  await check('a folder\'s name pressed in the tree shows it in the page: headed by its name, the path boxed, its notes as ruled rows; the tree marks it', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    s.host.querySelector('.dr-tree-row[data-path="Logic"]').click();
    await settle();
    const p = w.app.workspace.getLeavesOfType('design-redux-browse')[0].view.screen;
    assert.strictEqual(p.at, 'Logic');
    assert.ok(!p.host.querySelector('.dr-head'), 'a folder\'s page names itself twice: a head over its path');
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
    assert.strictEqual(first.dataset.path, 'Inbox');
    key(first, 'ArrowDown');
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Logic');
    key(w.doc.activeElement, 'ArrowUp');
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
    assert.ok(!p.host.querySelector('input.dr-input') && !p.body.firstChild, 'the vault did not come back, empty');
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
    ['Cover…', 'Colour…', 'Kind…', 'Merge into…', 'Split notes off…'].forEach((t) => assert.ok(!menu.titles().includes(t), `a folder still offers ${t}`));
    await menu.click('Pin');
    assert.deepStrictEqual(w.plugin.settings.pinOrder, ['Logic']);
    // A pin counts in its own folder: first there, and nowhere else.
    const pinned = w.file('Logic/Validity.md');
    await dr.togglePin(w.plugin, pinned);
    assert.strictEqual(dr.pinnedFirst(w.plugin, w.file('Logic'), dr.listedNotes(w.plugin, w.file('Logic')))[0], pinned);
    assert.ok(!dr.pinnedFirst(w.plugin, w.app.vault.getRoot(), dr.listedNotes(w.plugin, w.app.vault.getRoot())).includes(pinned), 'a pin shows outside its folder');
    await dr.togglePin(w.plugin, pinned);
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
    const p = await page(w, w.file('Inbox'));
    const data = { store: {}, types: [], setData(t, v) { this.store[t] = v; this.types.push(t); }, getData(t) { return this.store[t] || ''; } };
    const fire = (el, type) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = data; el.dispatchEvent(e); return e; };
    fire(p.host.querySelector('[data-path="Inbox/Scrap.md"]'), 'dragstart');
    const target = s.host.querySelector('[data-path="Reading"]');
    assert.ok(fire(target, 'dragover').defaultPrevented && target.hasAttribute('data-drop'));
    fire(target, 'drop');
    await settle();
    assert.ok(w.file('Reading/Scrap.md') && !w.file('Inbox/Scrap.md'));
    await w.plugin.lastUndo.run();
    assert.ok(w.file('Inbox/Scrap.md'));
  });

  await check('the vault in the page shows nothing: no path, no notes, no buttons; the sidebar is where one goes from it', async () => {
    const w = await world(Object.assign({}, VAULT, { 'Alpha.md': '' }));
    const p = await page(w, null);
    assert.strictEqual(p.at, '/');
    assert.ok(!p.body.firstChild, 'the vault\'s page shows something');
    assert.ok(!p.host.querySelector('.dr-head, .dr-crumb, .dr-row, .dr-state'), 'a head, a path, a row or a say-so on the vault\'s page');
    assert.deepStrictEqual(controls(p.host), []);
  });

  await check('commands: the old ids, the levels\' one gone, and turning the library off takes its views away', async () => {
    const w = await world(VAULT);
    const ids = Object.keys(w.app.commands.commands).map((c) => c.split(':')[1]);
    ['open-library', 'browse-vault', 'search-library', 'reset-layout', 'go-back', 'go-forward', 'new-note-here', 'new-folder-here', 'previous-in-album', 'next-in-album'].forEach((id) => assert.ok(ids.includes(id), `${id} is not a command`));
    await w.app.workspace.getLeaf().openFile(w.file('Logic/Validity.md'));
    w.app.commands.executeCommandById('design-redux:next-in-album');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Week 2.md');
    assert.ok(!ids.includes('cycle-cover-size'), 'the levels command is still a command');
    w.plugin.settings.library = false;
    await w.plugin.saveSettings();
    assert.strictEqual(w.app.workspace.getLeavesOfType('design-redux-library').length, 0);
  });

  check.done();
})();
