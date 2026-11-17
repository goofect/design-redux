/*
 * What a folder is and what can be done to it: its kind, description and
 * what it gathers (read from a folder note until changed, then kept by
 * path, with no note written); merging and splitting, said first and undone
 * in one; covers and tones; filters and saved views; the library check.
 */
const assert = require('assert');
const { load, world, suite, settle, obsidian } = require('./harness.js');

const dr = load();
const check = suite('folders');
const feature = (w, name) => w.plugin.features.find((f) => f.constructor.name === name);
const answer = async (w, pick) => { await settle(); const m = obsidian.Modal.open[obsidian.Modal.open.length - 1]; pick(m); await settle(); };
const VAULT = {
  'Logic/Logic.md': '---\nalbum: Subject\ndescription: Arguments and their forms.\nincludes:\n  - "[[Hume]]"\nfeatured: "[[Validity]]"\nrelated: "[[Reading]]"\n---\n',
  'Logic/Truth tables.md': '---\nstatus: draft\ntags: [formal]\n---\n![[img/table.png]]\n',
  'Logic/Validity.md': '---\nstatus: done\nparent: "[[Truth tables]]"\n---\n[[Nowhere]]',
  'Reading/Reading.md': '',
  'Reading/Hume.md': '---\nstatus: draft\n---\n',
  'Reading/Validity.md': '',
  'img/table.png': 'png',
  'Empty/.keep': '',
  'Loose.md': '',
};

(async () => {
  await check('the removed custom order falls back to name, while saved data is preserved', async () => {
    const saved = { settingsVersion: dr.SETTINGS_VERSION, defaultSort: 'own', albumSorts: { Logic: 'own', Reading: { by: 'own' }, Other: 'modified' }, albumOrders: { Logic: { names: ['Validity.md', 'Truth tables.md'] } } };
    const w = await world(VAULT, saved);
    const s = w.plugin.settings;
    assert.strictEqual(s.defaultSort, 'name');
    assert.deepStrictEqual(s.albumSorts, { Logic: 'name', Reading: { by: 'name' }, Other: 'modified' });
    assert.deepStrictEqual(s.albumOrders, saved.albumOrders);
    assert.strictEqual(saved.albumSorts.Reading.by, 'own', 'migration changed its input');
    assert.strictEqual(dr.sortOf(w.plugin, w.file('Logic')), 'name');
    assert.deepStrictEqual(dr.sortedNotes(w.plugin, w.file('Logic')).map((f) => f.basename), ['Truth tables', 'Validity']);
    assert.ok(!('own' in dr.SORTS));
    assert.ok(!('own' in feature(w, 'Library').settingsRows().find((r) => r.key === 'defaultSort').options));
  });

  await check('a folder note is read by the old property names; a change is kept by path and writes no note', async () => {
    const w = await world(VAULT);
    const albums = feature(w, 'Albums');
    const logic = w.file('Logic');
    const info = albums.info(logic);
    assert.deepStrictEqual([info.type, info.label, info.description], ['subject', 'Subject', 'Arguments and their forms.']);
    assert.deepStrictEqual([info.includes.map((f) => f.path), info.featured.map((f) => f.path), info.related.map((f) => f.path)], [['Reading/Hume.md'], ['Logic/Validity.md'], ['Reading']]);
    assert.deepStrictEqual(dr.listedNotes(w.plugin, logic).map((f) => f.basename), ['Validity', 'Truth tables', 'Hume'], 'featured first, then its own, then what it takes in');
    assert.strictEqual(w.plugin.describe(logic), 'Subject · Arguments and their forms.');
    const before = w.text('Logic/Logic.md');
    albums.chooseKind(logic);
    await answer(w, (m) => m.pick(dr.ALBUM_KINDS[1]));
    assert.strictEqual(albums.info(logic).type, 'project');
    assert.deepStrictEqual(w.plugin.settings.albums.Logic.includes, ['Reading/Hume.md'], 'the change did not carry over what the note said');
    assert.strictEqual(w.text('Logic/Logic.md'), before, 'the folder note was rewritten');
    albums.includeNote(w.file('Loose.md'));
    await answer(w, (m) => m.pick(w.file('Reading')));
    assert.deepStrictEqual(albums.including(w.file('Loose.md')).map((f) => f.path), ['Reading']);
    w.plugin.settings.albumKeyNames = { type: 'kind' };
    assert.strictEqual(albums.fromNote(w.file('Logic/Logic.md')).type, undefined, 'a renamed property is still read under its old name');
  });

  await check('merging: said first, names taken get a number, the emptied folder goes, and one Undo puts it all back', async () => {
    const w = await world(VAULT);
    const refactor = feature(w, 'AlbumRefactor');
    const plan = dr.planMoves(w.app, w.file('Logic').children, 'Reading');
    assert.deepStrictEqual(plan.map((m) => [m.from, m.to, m.renamed]), [['Logic/Logic.md', 'Reading/Logic.md', false], ['Logic/Truth tables.md', 'Reading/Truth tables.md', false], ['Logic/Validity.md', 'Reading/Validity 1.md', true]]);
    const merging = refactor.merge(w.file('Logic'));
    await answer(w, (m) => m.pick(w.file('Reading')));
    const said = obsidian.Modal.open[0].contentEl.querySelector('p').textContent;
    assert.ok(/3 items move into Reading/.test(said) && /1 name is taken/.test(said), said);
    obsidian.Modal.open[0].contentEl.querySelector('.is-primary').click();
    await merging;
    assert.ok(w.file('Reading/Validity 1.md') && !w.file('Logic'));
    await w.plugin.lastUndo.run();
    assert.ok(w.file('Logic/Validity.md') && w.file('Logic/Logic.md') && !w.file('Reading/Validity 1.md'), 'the merge was not put back');
  });

  await check('splitting: the picked notes move into a new folder beside the old one', async () => {
    const w = await world(VAULT);
    const splitting = feature(w, 'AlbumRefactor').split(w.file('Logic'));
    await answer(w, (m) => { m.contentEl.querySelectorAll('.dr-row')[0].click(); m.contentEl.querySelector('.is-primary').click(); });
    await answer(w, (m) => { m.contentEl.querySelector('input').value = 'Tables'; m.contentEl.querySelector('.is-primary').click(); });
    await splitting;
    assert.ok(w.file('Tables/Truth tables.md') && w.file('Logic/Validity.md'));
  });

  await check('covers: a note\'s in its property, a folder\'s by its path, the first image, a tone, a drop, a repair', async () => {
    const w = await world(VAULT);
    const covers = feature(w, 'Covers');
    const note = w.file('Logic/Truth tables.md');
    await covers.coverFromFirstImage(note);
    assert.strictEqual(w.plugin.notes.get(note, 'cover'), '[[img/table.png]]');
    assert.strictEqual(dr.noteCover(w.plugin, note), 'img/table.png');
    await covers.setFolderCover(w.file('Logic'), w.file('img/table.png'));
    assert.strictEqual(dr.folderCover(w.plugin, w.file('Logic')), 'img/table.png');
    await covers.dropped(w.file('Reading'), { name: 'photo.JPG', arrayBuffer: async () => new ArrayBuffer(8) });
    assert.strictEqual(w.plugin.settings.folderCovers.Reading, 'attachments/Reading cover.jpg');
    await w.app.vault.rename(w.file('img'), 'pictures');
    assert.strictEqual(w.plugin.settings.folderCovers.Logic, 'pictures/table.png', 'a folder\'s cover did not follow its image');
    w.plugin.settings.folderCovers.Logic = 'gone/table.png';
    assert.deepStrictEqual(await covers.repair(), { fixed: 2, lost: 0 });
    assert.strictEqual(w.plugin.settings.folderCovers.Logic, 'pictures/table.png');
    w.plugin.settings.coverColors = { Logic: '#fa2d48', Reading: 'moss', Empty: '#777777' };
    assert.deepStrictEqual(['Logic', 'Reading', 'Empty'].map((p) => w.plugin.toneOf(w.file(p))), ['rust', 'moss', null]);
    assert.deepStrictEqual(['#4f6d8f', '#b0703a', '#4d7f80', '#8a6f52'].map(dr.toneOf), ['slate', 'ochre', 'slate', 'ochre']);
  });

  await check('a property for the whole folder: given where there is none, asked about where there is, one Undo', async () => {
    const w = await world(Object.assign({}, VAULT, { 'Logic/Third.md': '' }));
    const give = feature(w, 'AlbumProperty');
    const n = await give.give(w.file('Logic/Truth tables.md'), 'status', false);
    assert.strictEqual(n, 1);
    assert.deepStrictEqual(['Third', 'Validity'].map((x) => w.plugin.notes.get(w.file(`Logic/${x}.md`), 'status')), ['draft', 'done']);
    await w.plugin.lastUndo.run();
    assert.strictEqual(w.plugin.notes.get(w.file('Logic/Third.md'), 'status'), undefined);
    assert.strictEqual(await give.give(w.file('Logic/Truth tables.md'), 'status', true), 2);
  });

  await check('filters: by folder, tag, property (has, lacks, equals), date and looseness; kept as a saved view and opened again', async () => {
    const w = await world(VAULT);
    const names = (f) => dr.matchNotes(w.plugin, f, 1e6).map((n) => n.path).sort();
    assert.deepStrictEqual(names({ folder: 'Reading' }), ['Reading/Hume.md', 'Reading/Validity.md']);
    assert.deepStrictEqual(names({ tag: '#formal' }), ['Logic/Truth tables.md']);
    assert.deepStrictEqual(names({ prop: 'status=DRAFT' }), ['Logic/Truth tables.md', 'Reading/Hume.md']);
    assert.deepStrictEqual(names({ prop: 'parent' }), ['Logic/Validity.md']);
    assert.deepStrictEqual(names({ prop: '!status', folder: 'Reading' }), ['Reading/Validity.md']);
    assert.deepStrictEqual(names({ loose: true }), ['Loose.md']);
    assert.deepStrictEqual(dr.matchNotes(w.plugin, { date: 'week' }, 40 * 864e5).length, 0);
    const views = feature(w, 'SavedViews');
    const screen = await views.screen();
    screen.setFilter({ prop: 'status=draft', folder: 'Logic' });
    assert.deepStrictEqual(Array.from(screen.host.querySelectorAll('.dr-rows .dr-row')).map((r) => r.dataset.path), ['Logic/Truth tables.md']);
    assert.deepStrictEqual(Array.from(screen.host.querySelectorAll('.dr-filter-bar .dr-chip')).map((c) => [c.textContent, c.getAttribute('role'), c.hasAttribute('aria-checked')]), [['InLogic', 'button', false], ['Propertystatus=draft', 'button', false]]);
    views.save();
    await answer(w, (m) => { m.contentEl.querySelector('input').value = 'Drafts in Logic'; m.contentEl.querySelector('.is-primary').click(); });
    assert.deepStrictEqual(w.plugin.settings.smartAlbumList.map((v) => [v.name, v.prop, v.folder]), [['Drafts in Logic', 'status=draft', 'Logic']]);
    screen.host.querySelector('.dr-filter-bar .dr-chip').click();
    assert.deepStrictEqual(screen.filter, { prop: 'status=draft' });
    screen.back();
    assert.strictEqual(screen.filter, null);
    await views.open(w.plugin.settings.smartAlbumList[0]);
    assert.strictEqual(screen.host.querySelector('.dr-head .dr-label').textContent, 'Drafts in Logic');
  });

  await check('the library check: what it finds, in a report that changes nothing; and the inbox', async () => {
    const w = await world(Object.assign({}, VAULT, { 'A.md': '---\nparent: "[[B]]"\n---\n', 'B.md': '---\nparent: "[[A]]"\n---\n', 'Sub/Logic/x.md': '' }));
    const lc = feature(w, 'LibraryCheck');
    const found = Object.fromEntries(lc.findings().map((g) => [g.title, g.items.map((i) => i.name)]));
    assert.deepStrictEqual(found['Folders with nothing in them'], ['Empty']);
    assert.deepStrictEqual(found['Folders of one name'].sort(), ['Logic', 'Sub/Logic']);
    assert.deepStrictEqual(found['Notes in no folder'], ['A', 'B', 'Loose']);
    assert.deepStrictEqual(found['Notes whose parents lead round in a circle'].sort(), ['A', 'B']);
    assert.ok(found['Links that lead nowhere'].includes('Validity'));
    const before = JSON.stringify(Array.from(w.app.vault.text.entries()));
    const sheet = lc.report();
    assert.ok(sheet.contentEl.querySelectorAll('.dr-section').length >= 5);
    sheet.close();
    assert.strictEqual(JSON.stringify(Array.from(w.app.vault.text.entries())), before);
    await lc.inbox();
    const screen = w.app.workspace.getLeavesOfType('design-redux-browse')[0].view.screen;
    assert.deepStrictEqual([screen.filterName, screen.host.querySelectorAll('.dr-rows .dr-row').length], ['Inbox', 3]);
  });

  check.done();
})();
