/*
 * The core: the old data.json converted with nothing lost, path-keyed
 * settings following renames and deletes, a note's properties written and
 * taken back, files moved and put back, the index, and the look's classes
 * put on every window and taken off again.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { load, world, suite, settle, obsidian, window } = require('./harness.js');

const dr = load();
const check = suite('core');
const lifecycle = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshots', 'lifecycle.json'), 'utf8'));

(async () => {
  await check('every key the old plugin kept is kept, renamed, or retired with a reason', () => {
    const lost = lifecycle.settings.filter((k) => !(k in dr.DEFAULTS) && !(k in dr.RENAMED) && !(k in dr.RETIRED));
    assert.deepStrictEqual(lost, []);
    const both = Object.keys(dr.RETIRED).filter((k) => k in dr.DEFAULTS);
    assert.deepStrictEqual(both, [], 'retired and kept at once');
  });

  await check('an old data.json is converted once, its values kept, and the whole of it copied to data.legacy.json', async () => {
    const old = { settingsVersion: 34, library: false, coverProperty: 'art', folderCovers: { Logic: 'img/a.png' }, albumOrders: { Logic: { names: ['B.md', 'A.md'] } }, pinOrder: ['Logic/A.md'], gridDensity: 'large', coverDesigns: { Logic: { kind: 3 } }, lookScope: 'window', propertyRules: [{ id: 1 }], contextStrip: true, panelGroupList: 'broken' };
    const w = await world({ 'Logic/A.md': '' }, old);
    const s = w.plugin.settings;
    assert.strictEqual(s.library, false);
    assert.strictEqual(s.coverProperty, 'art');
    assert.deepStrictEqual(s.folderCovers, { Logic: 'img/a.png' });
    assert.deepStrictEqual(s.albumOrders, { Logic: { names: ['B.md', 'A.md'] } });
    assert.deepStrictEqual(s.propertyRules, [{ id: 1 }]);
    assert.strictEqual(s.contextStrip, true);
    assert.strictEqual(s.lookScope, 'window');
    assert.strictEqual(s.look, 'redux');
    assert.strictEqual(s.settingsVersion, dr.SETTINGS_VERSION);
    assert.ok(!('gridDensity' in s) && !('coverDesigns' in s), 'a retired key came through');
    assert.deepStrictEqual(s.panelGroupList, dr.DEFAULTS.panelGroupList, 'a value of the wrong kind was taken');
    const legacy = JSON.parse(w.app.vault.adapter.files.get('.obsidian/plugins/design-redux/data.legacy.json'));
    assert.deepStrictEqual(legacy, old, 'the copy is not the old file');
    assert.strictEqual(w.plugin._data.settingsVersion, dr.SETTINGS_VERSION);
    // A second load converts nothing and leaves the copy alone.
    w.app.vault.adapter.files.set('.obsidian/plugins/design-redux/data.legacy.json', 'kept');
    const again = dr.migrateSettings(w.plugin._data);
    assert.strictEqual(again.legacy, null);
    assert.deepStrictEqual(again.settings, s);
  });

  await check('a first run starts from the defaults and writes no legacy copy', async () => {
    const w = await world({});
    assert.deepStrictEqual(w.plugin.settings, dr.DEFAULTS);
    assert.strictEqual(w.app.vault.adapter.files.size, 0);
  });

  await check('upgrading changes no note', async () => {
    const files = { 'Logic/Logic.md': '---\ntype: album\ncover: "[[a.png]]"\n---\nAbout logic.\n', 'Logic/A.md': '---\nparent: "[[Logic]]"\n---\n%%page: One%%\ntext\n', 'B.md': 'plain' };
    const w = await world(files, { settingsVersion: 34, albums: { Logic: { includes: ['B.md'] } } });
    await settle();
    Object.keys(files).forEach((p) => assert.strictEqual(w.text(p), files[p], `${p} was rewritten`));
  });

  await check('settings 102: what the direction reset cut is retired, its values kept under retired, nothing else touched', () => {
    const saved = { settingsVersion: 101, alwaysShowLabels: false, libraryZoom: { sidebar: 'shelves' }, folderGlyphs: { Logic: 'cat' }, lookRegionTabs: false, stripPlace: false, tableColumns: 'status', look: 'redux', propertyRules: [{ id: 'r' }] };
    const { settings, legacy } = dr.migrateSettings(saved);
    assert.strictEqual(legacy, null, 'a 4.0 file was taken for the old plugin\'s');
    ['alwaysShowLabels', 'libraryZoom', 'folderGlyphs', 'lookRegionTabs', 'stripPlace', 'tableColumns'].forEach((k) => assert.ok(!(k in settings), `${k} is still a setting`));
    assert.deepStrictEqual(settings.retired, { alwaysShowLabels: false, libraryZoom: { sidebar: 'shelves' }, folderGlyphs: { Logic: 'cat' }, lookRegionTabs: false, stripPlace: false, tableColumns: 'status' });
    assert.deepStrictEqual(settings.propertyRules, [{ id: 'r' }]);
    assert.strictEqual(settings.settingsVersion, dr.SETTINGS_VERSION);
    Object.keys(settings.retired).forEach((k) => assert.ok(dr.RETIRED[k], `${k} retired without a reason`));
  });

  await check('path-keyed settings follow a rename and a delete', async () => {
    const w = await world({ 'School/Logic/A.md': '', 'School/Logic/B.md': '', 'Other/C.md': '' });
    const s = w.plugin.settings;
    Object.assign(s, { coverColors: { School: 'moss', 'School/Logic': 'rust' }, folderCovers: { 'School/Logic': 'School/Logic/cover.png' }, pinOrder: ['School/Logic/A.md'], albums: { Other: { includes: ['School/Logic/B.md'] } }, albumOrders: { 'School/Logic': { names: ['B.md', 'A.md'] } }, pagesOpen: { 'School/Logic/A.md': 'Two' } });
    await w.app.vault.rename(w.file('School'), 'University');
    assert.deepStrictEqual([s.coverColors.University, s.coverColors['University/Logic'], s.coverColors.School], ['moss', 'rust', undefined]);
    assert.deepStrictEqual(s.folderCovers, { 'University/Logic': 'University/Logic/cover.png' });
    assert.deepStrictEqual(s.pinOrder, ['University/Logic/A.md']);
    assert.deepStrictEqual(s.albums.Other.includes, ['University/Logic/B.md']);
    assert.deepStrictEqual(s.pagesOpen, { 'University/Logic/A.md': 'Two' });
    await w.app.vault.rename(w.file('University/Logic/A.md'), 'University/Logic/Alpha.md');
    assert.deepStrictEqual(s.albumOrders['University/Logic'].names, ['B.md', 'Alpha.md']);
    await w.app.vault.delete(w.file('University/Logic'));
    assert.deepStrictEqual([s.coverColors.University, 'University/Logic' in s.coverColors], ['moss', false]);
    assert.deepStrictEqual(s.folderCovers, {});
    assert.deepStrictEqual(s.pinOrder, []);
    assert.deepStrictEqual(s.albums.Other.includes, []);
  });

  await check('a write is recorded, and undoing it keeps what was edited since', async () => {
    const w = await world({ 'A.md': '---\nstatus: draft\nweek: 3\n---\nbody\n' });
    const file = w.file('A.md');
    const record = await w.plugin.notes.write(file, (fm) => { fm.status = 'done'; fm.week = 4; fm.added = true; }, { undo: 'Changed.' });
    assert.deepStrictEqual(record.before, { status: 'draft', week: 3, added: undefined });
    assert.deepStrictEqual(w.plugin.notes.props(file), { status: 'done', week: 4, added: true });
    assert.ok(obsidian.Notice.log.some((m) => m.includes('Changed.')), 'no undo was offered');
    await w.plugin.notes.write(file, (fm) => { fm.week = 9; });
    await w.plugin.notes.undo([record]);
    assert.deepStrictEqual(w.plugin.notes.props(file), { status: 'draft', week: 9 }, 'undo did not keep the later edit');
    assert.ok(w.text('A.md').endsWith('body\n'));
    assert.strictEqual(w.plugin.notes.get(file, 'STATUS'), 'draft');
  });

  await check('files: a free name, a move that can be put back, a folder note that follows its folder', async () => {
    const w = await world({ 'Logic/Logic.md': 'about', 'Logic/A.md': '', 'Inbox/A.md': '' });
    const { files } = w.plugin;
    assert.strictEqual(files.freePath(w.file('Logic'), 'A', 'md'), 'Logic/A 1.md');
    assert.strictEqual(files.folderNote(w.file('Logic')), w.file('Logic/Logic.md'));
    assert.ok(files.isFolderNote(w.file('Logic/Logic.md')) && !files.isFolderNote(w.file('Logic/A.md')));
    const from = await files.move(w.file('Inbox/A.md'), 'Logic', { announce: true });
    assert.strictEqual(from, 'Inbox/A.md');
    assert.ok(w.file('Logic/A 1.md'), 'the moved note did not take a free name');
    await w.plugin.lastUndo.run();
    assert.ok(w.file('Inbox/A.md') && !w.file('Logic/A 1.md'), 'the move was not put back');
    await w.app.vault.rename(w.file('Logic'), 'Reasoning');
    await settle();
    assert.ok(w.file('Reasoning/Reasoning.md'), 'the folder note kept the old name');
    assert.strictEqual(await files.move(w.file('Reasoning'), 'Reasoning'), false, 'a folder moved into itself');
  });

  await check('the index: folders, their notes without the folder note, counts, links; and it is forgotten when the vault changes', async () => {
    const w = await world({ 'Logic/Logic.md': '', 'Logic/Week 10.md': '[[Week 2]]', 'Logic/Week 2.md': '', 'Logic/Sets/A.md': '', 'Inbox/B.md': '[[Week 2]]', '.trash/x.md': '' });
    const { index } = w.plugin;
    assert.deepStrictEqual(index.folders().map((f) => f.path), ['Inbox', 'Logic', 'Logic/Sets']);
    assert.deepStrictEqual(index.notes(w.file('Logic')).map((f) => f.basename), ['Week 2', 'Week 10']);
    assert.strictEqual(index.count(w.file('Logic')), 3);
    assert.deepStrictEqual(index.subfolders(w.file('Logic')).map((f) => f.name), ['Sets']);
    assert.deepStrictEqual(index.incoming(w.file('Logic/Week 2.md')).map((f) => f.path).sort(), ['Inbox/B.md', 'Logic/Week 10.md']);
    assert.deepStrictEqual(index.outgoing(w.file('Inbox/B.md')).map((f) => f.path), ['Logic/Week 2.md']);
    await w.app.vault.create('Logic/New.md', '');
    assert.strictEqual(index.count(w.file('Logic')), 4);
    w.plugin.settings.hideFolderNotes = false;
    await w.plugin.saveSettings();
    assert.strictEqual(index.notes(w.file('Logic')).length, 4);
  });

  await check('the look: classes on every window, changed with the settings, gone when the plugin unloads', async () => {
    const w = await world({});
    const body = w.doc.body;
    assert.ok(body.classList.contains('dr-active') && body.classList.contains('dr-region-library'));
    assert.ok(!body.classList.contains('dr-region-chrome'), 'Obsidian\'s regions are on though the look is kept to the plugin');
    const other = new (require('jsdom').JSDOM)('<body class="theme-dark"></body>').window.document;
    w.app.workspace.trigger('window-open', { doc: other });
    assert.ok(other.body.classList.contains('dr-active'));
    // The look on the whole window: every region, Obsidian's too; no switch a region.
    Object.assign(w.plugin.settings, { lookScope: 'window' });
    await w.plugin.saveSettings();
    [body, other.body].forEach((b) => {
      assert.ok(b.classList.contains('dr-region-chrome') && b.classList.contains('dr-region-tabs') && !b.classList.contains('dr-labels'));
    });
    w.plugin.settings.look = 'theme';
    await w.plugin.saveSettings();
    assert.strictEqual(body.className, 'theme-light', 'the theme is not left untouched');
    w.plugin.settings.look = 'redux';
    await w.plugin.saveSettings();
    const before = Object.keys(obsidian.icons).filter((id) => id.startsWith('dr-')).length;
    assert.ok(before >= 9 && before <= 12, `${before} glyphs registered`);
    w.plugin.unload();
    assert.strictEqual(body.className, 'theme-light');
    assert.strictEqual(other.body.className, 'theme-dark');
    assert.strictEqual(Object.keys(obsidian.icons).filter((id) => id.startsWith('dr-')).length, 0, 'glyphs left registered');
    assert.deepStrictEqual(Object.keys(w.app.commands.commands), [], 'commands left behind');
    void window;
  });

  check.done();
})();
