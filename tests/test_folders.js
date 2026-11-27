/*
 * What a folder is and what can be done to it: its description and what
 * it gathers (read from a folder note, or kept by path, with no note
 * written); no kind, no colour, no merging or splitting; filters and
 * saved views; the library check.
 */
const assert = require('assert');
const { load, world, suite, settle, obsidian, front } = require('./harness.js');

const dr = load();
const check = suite('folders');
const feature = (w, name) => w.plugin.features.find((f) => f.constructor.name === name);
const answer = async (w, pick) => { await settle(); const m = front(); pick(m); await settle(); };
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
  await check('a folder note names the notes the folder starts with, and no note is written', async () => {
    const w = await world(VAULT);
    const logic = w.file('Logic');
    assert.deepStrictEqual(dr.featuredNotes(w.plugin, logic).map((f) => f.path), ['Logic/Validity.md']);
    assert.deepStrictEqual(dr.listedNotes(w.plugin, logic).map((f) => f.basename), ['Validity', 'Truth tables'], 'featured first, then its own, and nothing from elsewhere');
  });

  await check('no kind, no colour, no merging or splitting, no covers: their commands are gone', async () => {
    const w = await world(VAULT);
    ['album-set-type', 'set-cover-color', 'album-merge', 'album-split', 'set-cover-image', 'set-folder-cover', 'repair-cover-link', 'album-include-note'].forEach((id) => assert.ok(!w.app.commands.commands[`design-redux:${id}`], `${id} is still a command`));
    assert.strictEqual(w.plugin.colourOf, undefined, 'a folder still has a colour');
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
    const screen = await w.plugin.libraryPage();
    screen.setFilter({ prop: 'status=draft', folder: 'Logic' });
    assert.deepStrictEqual(Array.from(screen.host.querySelectorAll('.dr-rows .dr-row')).map((r) => r.dataset.path), ['Logic/Truth tables.md']);
    assert.deepStrictEqual(Array.from(screen.host.querySelectorAll('.dr-filter-bar .dr-chip')).map((c) => [c.textContent, c.getAttribute('role'), c.hasAttribute('aria-checked')]), [['InLogic', 'button', false], ['Propertystatus=draft', 'button', false]]);
    views.save();
    await answer(w, (m) => { m.contentEl.querySelector('input').value = 'Drafts in Logic'; m.contentEl.querySelector('.dr-sheet-actions > .dr-button:last-child').click(); });
    assert.deepStrictEqual(w.plugin.settings.smartAlbumList.map((v) => [v.name, v.prop, v.folder]), [['Drafts in Logic', 'status=draft', 'Logic']]);
    screen.host.querySelector('.dr-filter-bar .dr-chip').click();
    assert.deepStrictEqual(screen.filter, { prop: 'status=draft' });
    screen.back();
    assert.strictEqual(screen.filter, null);
    await views.open(w.plugin.settings.smartAlbumList[0]);
    // A filter is its own page: its name in the head over what passes.
    assert.strictEqual(screen.host.querySelector('.dr-head-name').textContent, 'Drafts in Logic');
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
