/*
 * The library: one place, one view of it (docs/direction-reset.md). The
 * sidebar is its search field and the folders' names; a folder is its page
 * (back, more, its name large, what it holds as rows); the browse view a
 * grid of the folders' names or their cover images. Worked from the keys;
 * a vault of 2,000 notes drawn at once.
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
  await check('the sidebar opens with the plugin: its search field, then the folders\' names as rows, empty ones left out, loose notes after; one control', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    assert.deepStrictEqual(paths(s.host, '.dr-row'), ['Inbox', 'Logic', 'Reading', 'Loose.md']);
    assert.deepStrictEqual(Array.from(s.host.querySelectorAll('.dr-row')).map((r) => r.textContent), ['Inbox', 'Logic', 'Reading', 'Loose']);
    assert.ok(!s.host.querySelector('.dr-row svg, .dr-head, .dr-segments, .dr-row-end, .dr-slot'), 'a glyph, a head, a level, a count or a number in the sidebar');
    assert.deepStrictEqual(controls(s.host).map((c) => c.getAttribute('aria-label') || c.tagName), ['Notes and folders']);
  });

  await check('a folder is its page: back and more, its name large, its folders and notes as rows; Back comes out', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    s.host.querySelector('.dr-row[data-path="Logic"]').click();
    assert.strictEqual(s.at, 'Logic');
    assert.deepStrictEqual(controls(s.host).map((c) => c.getAttribute('aria-label')), ['Back', 'More']);
    assert.strictEqual(s.host.querySelector('.dr-display.dr-folder-name').textContent, 'Logic');
    assert.deepStrictEqual(paths(s.host, '.dr-row'), ['Logic/Sets', 'Logic/Truth tables.md', 'Logic/Validity.md', 'Logic/Week 2.md', 'Logic/Week 10.md']);
    s.host.querySelector('[aria-label="Back"]').click();
    assert.strictEqual(s.at, '/');
  });

  await check('what is open is inverted, and so is what is picked: one sign, nothing beside it', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    await w.app.workspace.getLeaf().openFile(w.file('Logic/Validity.md'));
    s.go(w.file('Logic'));
    await settle();
    assert.strictEqual(s.host.querySelector('.dr-row[data-path="Logic/Validity.md"]').getAttribute('aria-current'), 'page');
    w.plugin.selection.pick(w.file('Logic/Week 2.md'));
    await settle();
    assert.strictEqual(s.host.querySelector('.dr-row[data-path="Logic/Week 2.md"]').getAttribute('aria-selected'), 'true');
    assert.ok(!s.host.querySelector('.dr-slot, .dr-mark'), 'a mark beside a row');
  });

  await check('from the keys: one Tab stop, arrows, Enter goes in or opens, Backspace comes out, a letter jumps', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    const stops = () => Array.from(s.body.querySelectorAll('.dr-rows [tabindex="0"]'));
    assert.strictEqual(stops().length, 1);
    const first = stops()[0];
    first.focus();
    key(first, 'ArrowDown');
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Logic');
    key(w.doc.activeElement, 'r');
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Reading');
    key(w.doc.activeElement, 'ArrowUp');
    key(w.doc.activeElement, 'Enter');
    assert.strictEqual(s.at, 'Logic');
    const row = s.body.querySelector('.dr-row[data-path="Logic/Validity.md"]');
    row.focus();
    key(row, 'Enter');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Validity.md');
    key(s.body.querySelector('.dr-row'), 'Backspace');
    assert.strictEqual(s.at, '/');
  });

  await check('2,000 notes: drawn at once, and a redraw asked many times is one', async () => {
    const files = {};
    for (let f = 0; f < 40; f++) for (let n = 0; n < 50; n++) files[`Folder ${f}/Note ${n}.md`] = 'x'.repeat((n % 9) * 700);
    const w = await world(files);
    const s = sidebar(w);
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

  await check('search: folders and notes by name, notes by a heading or a property; the last searches kept; its field the sidebar\'s top', async () => {
    const w = await world(VAULT);
    const found = dr.searchLibrary(w.plugin, 'tab');
    assert.deepStrictEqual(found.notes.map((f) => f.path), ['Logic/Truth tables.md']);
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'miracles').inside.map((h) => [h.file.path, h.subpath]), [['Reading/Hume.md', '#Of miracles']]);
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'epistem').inside.map((h) => h.where), ['domain'], 'a hit says where, not the person\'s words');
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'log').folders.map((f) => f.path), ['Logic']);
    const s = sidebar(w);
    const input = s.host.querySelector('input.dr-input');
    input.value = 'week';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.deepStrictEqual(paths(s.host, '.dr-search-results .dr-row'), ['Logic/Week 2.md', 'Logic/Week 10.md']);
    key(input, 'Enter');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Week 2.md');
    assert.deepStrictEqual(w.plugin.settings.recentSearches, ['week']);
    key(s.host.querySelector('input.dr-input'), 'Escape');
    assert.deepStrictEqual(paths(s.host, '.dr-row'), ['Inbox', 'Logic', 'Reading', 'Loose.md'], 'the folders did not come back');
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
    ['Kind…', 'Merge into…', 'Split notes off…', 'Cover…'].forEach((t) => assert.ok(menu.titles().includes(t), `the folder menu lacks ${t}`));
    await menu.click('Pin');
    assert.deepStrictEqual(w.plugin.settings.pinOrder, ['Logic']);
    await settle();
    assert.deepStrictEqual(Array.from(s.host.querySelectorAll('.dr-section')).map((x) => x.textContent), ['Pinned', 'Folders']);
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
    const data = { store: {}, types: [], setData(t, v) { this.store[t] = v; this.types.push(t); }, getData(t) { return this.store[t] || ''; } };
    const fire = (el, type) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = data; el.dispatchEvent(e); return e; };
    fire(s.host.querySelector('[data-path="Loose.md"]'), 'dragstart');
    const target = s.host.querySelector('[data-path="Reading"]');
    assert.ok(fire(target, 'dragover').defaultPrevented && target.hasAttribute('data-drop'));
    fire(target, 'drop');
    await settle();
    assert.ok(w.file('Reading/Loose.md') && !w.file('Loose.md'));
    await w.plugin.lastUndo.run();
    assert.ok(w.file('Loose.md'));
  });

  await check('the browse view: a grid of the folders\' names (or their covers), nothing else in a cell; search and more; a folder pressed is its page', async () => {
    const w = await world(Object.assign({}, VAULT, { 'Reading/cover.png': '' }), { settingsVersion: 102, folderCovers: { Reading: 'Reading/cover.png' } });
    const leaf = await w.plugin.features.find((f) => f.constructor.name === 'Library').browse(null);
    const view = leaf.view;
    const host = view.screen.host;
    assert.deepStrictEqual(controls(host).map((c) => c.getAttribute('aria-label')), ['Search', 'More']);
    assert.deepStrictEqual(paths(host, '.dr-grid .dr-cell'), ['Inbox', 'Logic', 'Reading']);
    assert.deepStrictEqual(Array.from(host.querySelectorAll('.dr-cell .dr-display')).map((n) => n.textContent), ['Inbox', 'Logic']);
    assert.ok(host.querySelector('.dr-cell[data-path="Reading"] img'), 'a folder\'s cover is not in its cell');
    assert.ok(!host.querySelector('.dr-cell svg, .dr-cell-count, .dr-segments'), 'a glyph, a count or a level in the grid');
    host.querySelector('.dr-cell[data-path="Logic"]').click();
    assert.strictEqual(view.screen.at, 'Logic');
    assert.strictEqual(w.plugin.openFolder.path, 'Logic');
    assert.deepStrictEqual(leaf.getViewState().state, { at: 'Logic' });
    assert.deepStrictEqual(controls(host).map((c) => c.getAttribute('aria-label')), ['Back', 'More']);
    assert.strictEqual(host.querySelector('.dr-folder-name').textContent, 'Logic');
  });

  await check('commands: the old ids, the levels\' one kept but quiet, and turning the library off takes its views away', async () => {
    const w = await world(VAULT);
    const ids = Object.keys(w.app.commands.commands).map((c) => c.split(':')[1]);
    ['open-library', 'browse-vault', 'reset-layout', 'cycle-cover-size', 'go-back', 'go-forward', 'new-note-here', 'new-folder-here', 'previous-in-album', 'next-in-album'].forEach((id) => assert.ok(ids.includes(id), `${id} is not a command`));
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
