/*
 * The library: one place at three levels of detail, in the sidebar and the
 * page. Each level drawn from the same vault; a click picks and a second
 * opens; switching level keeps the folder, the pick and the open note;
 * every level worked from the keys; a vault of 2,000 notes drawn at once.
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

(async () => {
  await check('the sidebar opens with the plugin; objects: folders as glyphs, no folder twice, empty ones left out, loose notes after', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    assert.strictEqual(s.level, 'objects');
    assert.deepStrictEqual(paths(s.host, '.dr-cell'), ['Inbox', 'Logic', 'Reading', 'Loose.md']);
    const glyphs = Array.from(s.host.querySelectorAll('.dr-cell svg')).map((g) => g.getAttribute('data-glyph'));
    assert.strictEqual(new Set(glyphs.slice(0, 3)).size, 3, 'two folders share a glyph');
    assert.strictEqual(glyphs[3], 'note');
    assert.strictEqual(s.host.querySelector('[data-path="Logic"]').getAttribute('aria-label'), 'Logic, 5 notes');
    assert.deepStrictEqual(Array.from(s.host.querySelectorAll('.dr-head .dr-segment')).map((x) => x.getAttribute('aria-checked')), ['true', 'false', 'false']);
    await settle();
    assert.deepStrictEqual(Object.keys(w.plugin._data.folderGlyphs).sort(), ['Inbox', 'Logic', 'Reading'], 'the glyphs given were not stored');
  });

  await check('a face once given is kept: a folder made later takes another glyph and changes none', async () => {
    const w = await world(VAULT);
    const before = Object.assign({}, w.plugin.settings.folderGlyphs);
    for (const name of ['Aa', 'Bb', 'Cc', 'Dd']) await w.app.vault.create(`${name}/n.md`, '');
    await settle();
    const after = w.plugin.settings.folderGlyphs;
    Object.keys(before).forEach((p) => assert.strictEqual(after[p], before[p], `${p} changed its face`));
    assert.strictEqual(new Set(Object.values(after)).size, Object.keys(after).length);
    await w.app.vault.rename(w.file('Logic'), 'Reasoning');
    assert.strictEqual(w.plugin.settings.folderGlyphs.Reasoning, before.Logic, 'a rename changed the face');
  });

  await check('a click picks, a second opens; Back comes out; the pick shows its name', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    s.host.querySelector('[data-path="Logic"]').click();
    await settle();
    assert.strictEqual(w.plugin.selection.path, 'Logic');
    assert.strictEqual(s.host.querySelector('[data-path="Logic"]').getAttribute('aria-selected'), 'true');
    assert.strictEqual(s.at, '/');
    s.host.querySelector('[data-path="Logic"]').click();
    assert.strictEqual(s.at, 'Logic');
    assert.deepStrictEqual(paths(s.host, '.dr-cell'), ['Logic/Sets', 'Logic/Truth tables.md', 'Logic/Validity.md', 'Logic/Week 2.md', 'Logic/Week 10.md']);
    assert.strictEqual(s.host.querySelector('.dr-head .dr-label').textContent, 'Logic');
    s.host.querySelector('.dr-head [aria-label="Back"]').click();
    assert.strictEqual(s.at, '/');
    s.forward();
    assert.strictEqual(s.at, 'Logic');
    s.host.querySelector('[data-path="Logic/Validity.md"]').click();
    await settle();
    s.host.querySelector('[data-path="Logic/Validity.md"]').click();
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Validity.md');
    assert.strictEqual(s.host.querySelector('[data-path="Logic/Validity.md"]').getAttribute('aria-current'), 'page');
  });

  await check('shelves: a bar a note, as tall as it is long, the open note marked', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    await w.app.workspace.getLeaf().openFile(w.file('Logic/Truth tables.md'));
    await s.setLevel('shelves');
    const shelves = Array.from(s.host.querySelectorAll('.dr-shelf'));
    assert.deepStrictEqual(shelves.map((x) => x.dataset.path), ['/', 'Inbox', 'Logic', 'Reading']);
    const bars = Array.from(shelves[2].querySelectorAll('.dr-bar'));
    assert.deepStrictEqual(bars.map((b) => b.dataset.path), ['Logic/Truth tables.md', 'Logic/Validity.md', 'Logic/Week 2.md', 'Logic/Week 10.md']);
    assert.deepStrictEqual(bars.map((b) => b.style.getPropertyValue('--dr-size')), ['3', '1', '1', '1']);
    assert.strictEqual(bars[0].getAttribute('aria-current'), 'page');
    bars[1].click();
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Validity.md');
    shelves[2].querySelector('.dr-shelf-head').click();
    assert.strictEqual(s.at, 'Logic');
  });

  await check('words: folders one line each, the open note\'s folder open, its headings under it', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    await w.app.workspace.getLeaf().openFile(w.file('Logic/Truth tables.md'));
    await s.setLevel('words');
    const lines = Array.from(s.host.querySelectorAll('.dr-outline > *')).map((n) => `${n.className.includes('folder') ? 'F' : n.classList.contains('is-child') ? 'h' : 'n'}:${(n.querySelector('.dr-row-name, .dr-label.dr-clip') || {}).textContent}`);
    assert.deepStrictEqual(lines, ['n:Loose', 'F:Inbox', 'F:Logic', 'n:Truth tables', 'h:What a table shows', 'h:Building one', 'n:Validity', 'n:Week 2', 'n:Week 10', 'F:Reading']);
    const folderLine = (p) => s.host.querySelector(`.dr-outline-folder[data-path="${p}"]`);
    assert.deepStrictEqual([folderLine('Logic').getAttribute('aria-expanded'), folderLine('Inbox').getAttribute('aria-expanded')], ['true', 'false']);
    folderLine('Inbox').click();
    assert.ok(s.host.querySelector('[data-path="Inbox/Scrap.md"]'));
    folderLine('Logic').click();
    assert.ok(!s.host.querySelector('.dr-row[data-path="Logic/Validity.md"]'), 'a folder closed by hand stays closed');
    assert.strictEqual(s.host.querySelector('.dr-row .dr-slot').textContent, '01');
  });

  await check('switching level keeps the folder, the pick and the open note, and the keyboard where it was', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    s.go(w.file('Logic'));
    await w.app.workspace.getLeaf().openFile(w.file('Logic/Week 2.md'));
    await settle();
    s.host.querySelector('[data-path="Logic/Week 2.md"]').focus();
    for (const level of ['shelves', 'words', 'objects']) {
      await s.setLevel(level);
      assert.strictEqual(s.at, 'Logic', `${level}: the folder was lost`);
      const marked = Array.from(s.host.querySelectorAll('[aria-current="page"]')).map((n) => n.dataset.path);
      assert.deepStrictEqual(marked, ['Logic/Week 2.md'], `${level}: the open note is not marked`);
      assert.strictEqual(w.doc.activeElement.dataset.path, 'Logic/Week 2.md', `${level}: the keyboard was lost`);
    }
    assert.strictEqual(w.plugin.settings.libraryZoom.sidebar, 'objects');
    assert.strictEqual(w.plugin._data.libraryZoom.sidebar, 'objects', 'the level was not kept');
  });

  await check('every level from the keys: one Tab stop, arrows, Enter opens, Backspace comes out, a letter jumps', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    const stops = () => Array.from(s.body.querySelectorAll('[tabindex="0"]'));
    assert.strictEqual(stops().length, 1);
    const first = stops()[0];
    first.focus();
    key(first, 'ArrowRight');
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Logic');
    key(w.doc.activeElement, 'r');
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Reading');
    key(w.doc.activeElement, 'ArrowLeft');
    key(w.doc.activeElement, 'Enter');
    assert.strictEqual(s.at, 'Logic');
    key(s.body.querySelector('.dr-cell'), 'Backspace');
    assert.strictEqual(s.at, '/');
    await s.setLevel('words');
    const line = s.body.querySelector('.dr-outline-folder[data-path="Logic"]');
    line.focus();
    key(line, 'Enter');
    key(line.ownerDocument.activeElement, 'ArrowDown');
    await s.setLevel('shelves');
    const bar = s.body.querySelector('.dr-bar[data-path="Logic/Truth tables.md"]');
    bar.focus();
    key(bar, 'ArrowRight');
    assert.strictEqual(w.doc.activeElement.dataset.path, 'Logic/Validity.md');
    key(w.doc.activeElement, 'Enter');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Validity.md');
    const zoom = s.host.querySelector('.dr-segment[aria-checked="true"]');
    key(zoom, 'ArrowRight');
    assert.strictEqual(s.level, 'words');
  });

  await check('2,000 notes: every level drawn at once, bars for all, and a redraw asked many times is one', async () => {
    const files = {};
    for (let f = 0; f < 40; f++) for (let n = 0; n < 50; n++) files[`Folder ${f}/Note ${n}.md`] = 'x'.repeat((n % 9) * 700);
    const w = await world(files);
    const s = sidebar(w);
    const time = async (level) => { const t = Date.now(); await s.setLevel(level); return Date.now() - t; };
    await s.setLevel('words');
    const took = { shelves: await time('shelves'), words: await time('words'), objects: await time('objects') };
    await s.setLevel('shelves');
    assert.strictEqual(s.host.querySelectorAll('.dr-bar').length, 2000);
    // jsdom is many times slower than the app; these are the ceilings there.
    Object.keys(took).forEach((level) => assert.ok(took[level] < 1500, `${level} took ${took[level]}ms`));
    let draws = 0;
    const draw = s.draw.bind(s);
    s.draw = () => { draws++; draw(); };
    for (let i = 0; i < 50; i++) s.refresh();
    await settle();
    assert.strictEqual(draws, 1);
    const built = w.plugin.index.build();
    await s.setLevel('objects');
    assert.strictEqual(w.plugin.index.build(), built, 'the vault was walked again for a draw');
  });

  await check('search: folders and notes by name, notes by a heading or a property; the last searches kept', async () => {
    const w = await world(VAULT);
    const found = dr.searchLibrary(w.plugin, 'tab');
    assert.deepStrictEqual(found.notes.map((f) => f.path), ['Logic/Truth tables.md']);
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'miracles').inside.map((h) => [h.file.path, h.subpath]), [['Reading/Hume.md', '#Of miracles']]);
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'epistem').inside.map((h) => h.where), ['domain: epistemology']);
    assert.deepStrictEqual(dr.searchLibrary(w.plugin, 'log').folders.map((f) => f.path), ['Logic']);
    const s = sidebar(w);
    s.host.querySelector('[aria-label="Search"]').click();
    const input = s.host.querySelector('input.dr-input');
    input.value = 'week';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.deepStrictEqual(paths(s.host, '.dr-search-results .dr-row'), ['Logic/Week 2.md', 'Logic/Week 10.md']);
    key(input, 'Enter');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Week 2.md');
    assert.deepStrictEqual(w.plugin.settings.recentSearches, ['week']);
    key(input, 'Escape');
    assert.ok(!s.host.querySelector('input.dr-input') && s.host.querySelector('.dr-cell'));
  });

  await check('a folder\'s menu and a note\'s: every entry sectioned, pin, sort, rename, move and delete do what they say', async () => {
    const w = await world(VAULT);
    const s = sidebar(w);
    const cell = s.host.querySelector('[data-path="Logic"]');
    cell.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    const menu = obsidian.Menu.shown;
    const base = ['Open', 'New note', 'New folder', 'Pin', 'Glyph…', 'Sort by', 'Rename…', 'Move to…', 'Delete folder'];
    assert.deepStrictEqual(menu.titles().filter((t) => base.includes(t)), base);
    ['Kind…', 'Merge into…', 'Split notes off…', 'Cover…', 'Tone…'].forEach((t) => assert.ok(menu.titles().includes(t), `the folder menu lacks ${t}`));
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
    const sheet = dr.pickGlyphSheet(w.plugin, w.file('Reading'));
    sheet.contentEl.querySelector('.dr-cell[aria-label="cat"]').click();
    await settle();
    assert.strictEqual(w.plugin.settings.folderGlyphs.Reading, 'cat');
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

  await check('the browse view: the grid at the window\'s width, words as the table sorted by a column, the pick beside it', async () => {
    const w = await world(VAULT);
    const lib = w.plugin.features.find((f) => f.constructor.name === 'Library');
    const leaf = await lib.browse(w.file('Reading'));
    const view = leaf.view;
    assert.ok(view.screen.host.classList.contains('is-wide') && view.screen.host.querySelector('.dr-grid.is-wide'));
    assert.strictEqual(w.plugin.openFolder.path, 'Reading');
    assert.deepStrictEqual(leaf.getViewState().state, { at: 'Reading' });
    await view.screen.setLevel('words');
    const heads = Array.from(view.screen.host.querySelectorAll('th')).map((h) => h.textContent);
    assert.deepStrictEqual(heads, ['Number', 'Name', 'Domain', 'Status', 'Words']);
    assert.deepStrictEqual(Array.from(view.screen.host.querySelectorAll('tbody td')).map((t) => t.textContent), ['01', 'Hume', 'epistemology', 'draft', String(w.plugin.index.words(w.file('Reading/Hume.md')))]);
    view.screen.go(null);
    view.screen.host.querySelectorAll('th')[1].click();
    view.screen.host.querySelectorAll('th')[1].click();
    assert.strictEqual(view.screen.host.querySelectorAll('th')[1].getAttribute('aria-sort'), 'descending');
    await view.screen.setLevel('objects');
    view.screen.host.querySelector('[data-path="Logic"]').click();
    await settle();
    assert.ok(!view.aside.hidden && view.aside.querySelector('.dr-detail-name').textContent === 'Logic');
    assert.deepStrictEqual(Array.from(view.aside.querySelectorAll('.dr-detail-counts span')).map((x) => x.textContent), ['5 notes', '1 folder']);
    assert.strictEqual(view.aside.querySelectorAll('.dr-rows .dr-row').length, 4);
    assert.strictEqual(sidebar(w).host.querySelector('[data-path="Logic"]').getAttribute('aria-selected'), 'true', 'the sidebar does not show the pick');
  });

  await check('commands: the old ids, and turning the library off takes its views away', async () => {
    const w = await world(VAULT);
    const ids = Object.keys(w.app.commands.commands).map((c) => c.split(':')[1]);
    ['open-library', 'browse-vault', 'reset-layout', 'cycle-cover-size', 'go-back', 'go-forward', 'new-note-here', 'new-folder-here', 'previous-in-album', 'next-in-album'].forEach((id) => assert.ok(ids.includes(id), `${id} is not a command`));
    await w.app.workspace.getLeaf().openFile(w.file('Logic/Validity.md'));
    w.app.commands.executeCommandById('design-redux:next-in-album');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/Week 2.md');
    w.app.commands.executeCommandById('design-redux:cycle-cover-size');
    assert.strictEqual(sidebar(w).level, 'shelves');
    w.plugin.settings.library = false;
    await w.plugin.saveSettings();
    assert.strictEqual(w.app.workspace.getLeavesOfType('design-redux-library').length, 0);
  });

  check.done();
})();
