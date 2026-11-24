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

  await check('an old data.json is converted once and saved: what is still read kept, the rest dropped, no copy written', async () => {
    const old = { settingsVersion: 34, library: false, coverProperty: 'art', folderCovers: { Logic: 'img/a.png' }, albumOrders: { Logic: { names: ['B.md', 'A.md'] } }, pinOrder: ['Logic/A.md'], gridDensity: 'large', coverDesigns: { Logic: { kind: 3 } }, lookScope: 'window', propertyRules: [{ id: 1 }], contextStrip: true, pagesOpen: 'broken' };
    const w = await world({ 'Logic/A.md': '' }, old);
    const s = w.plugin.settings;
    assert.strictEqual(s.library, false);
    assert.ok(!('coverProperty' in s) && !('folderCovers' in s), 'covers came through');
    assert.deepStrictEqual(s.albumOrders, { Logic: { names: ['B.md', 'A.md'] } });
    assert.deepStrictEqual(s.propertyRules, [{ id: 1 }]);
    assert.ok(!('contextStrip' in s), 'the strip\'s switch, retired, came through');
    assert.strictEqual(s.lookScope, 'window');
    assert.strictEqual(s.look, 'redux');
    assert.strictEqual(s.settingsVersion, dr.SETTINGS_VERSION);
    assert.ok(!('gridDensity' in s) && !('coverDesigns' in s), 'a retired key came through');
    assert.deepStrictEqual(s.pagesOpen, dr.DEFAULTS.pagesOpen, 'a value of the wrong kind was taken');
    assert.ok(!w.app.vault.adapter.files.has('.obsidian/plugins/design-redux/data.legacy.json'), 'a copy of the old settings was written');
    assert.ok(!('gridDensity' in w.plugin._data) && !('retired' in w.plugin._data), 'an unused value was saved');
    assert.strictEqual(w.plugin._data.settingsVersion, dr.SETTINGS_VERSION);
    // A second load converts nothing.
    const again = dr.migrateSettings(w.plugin._data);
    assert.strictEqual(again.converted, false);
    assert.deepStrictEqual(again.settings, s);
  });

  await check('a first run starts from the defaults and writes no file', async () => {
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

  await check('a 4.x file: what was cut since is dropped, the values kept before under retired too, nothing else touched', () => {
    const saved = { settingsVersion: 106, alwaysShowLabels: false, coverColors: { Logic: 'red' }, albumRollups: true, retired: { folderGlyphs: { Logic: 'cat' } }, look: 'redux', propertyRules: [{ id: 'r' }] };
    const { settings, converted } = dr.migrateSettings(saved);
    assert.strictEqual(converted, true);
    ['alwaysShowLabels', 'coverColors', 'albumRollups', 'retired'].forEach((k) => assert.ok(!(k in settings), `${k} is still kept`));
    ['alwaysShowLabels', 'coverColors', 'albumRollups', 'retired'].forEach((k) => assert.ok(dr.RETIRED[k], `${k} retired without a reason`));
    assert.deepStrictEqual(settings.propertyRules, [{ id: 'r' }]);
    assert.strictEqual(settings.settingsVersion, dr.SETTINGS_VERSION);
  });

  await check('path-keyed settings follow a rename and a delete', async () => {
    const w = await world({ 'School/Logic/A.md': '', 'School/Logic/B.md': '', 'Other/C.md': '' });
    const s = w.plugin.settings;
    Object.assign(s, { folderDefaults: { School: 'moss', 'School/Logic': 'rust' }, pinOrder: ['School/Logic/A.md'], albums: { Other: { includes: ['School/Logic/B.md'] } }, albumOrders: { 'School/Logic': { names: ['B.md', 'A.md'] } }, pagesOpen: { 'School/Logic/A.md': 'Two' } });
    await w.app.vault.rename(w.file('School'), 'University');
    assert.deepStrictEqual([s.folderDefaults.University, s.folderDefaults['University/Logic'], s.folderDefaults.School], ['moss', 'rust', undefined]);
    assert.deepStrictEqual(s.pinOrder, ['University/Logic/A.md']);
    assert.deepStrictEqual(s.albums.Other.includes, ['University/Logic/B.md']);
    assert.deepStrictEqual(s.pagesOpen, { 'University/Logic/A.md': 'Two' });
    await w.app.vault.rename(w.file('University/Logic/A.md'), 'University/Logic/Alpha.md');
    assert.deepStrictEqual(s.albumOrders['University/Logic'].names, ['B.md', 'Alpha.md']);
    await w.app.vault.delete(w.file('University/Logic'));
    assert.deepStrictEqual([s.folderDefaults.University, 'University/Logic' in s.folderDefaults], ['moss', false]);
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
    await w.app.vault.create('Logic/New.md', '');
    assert.strictEqual(index.count(w.file('Logic')), 4);
  });

  await check('a feature reaches every window: the main one, a popout already open, one opened after; none once it is off', async () => {
    const w = await world({});
    const docs = () => new (require('jsdom').JSDOM)('<body></body>').window.document;
    const [open, later, after] = [docs(), docs(), docs()];
    w.app.workspace.leaves.push({ view: { getViewType: () => 'empty', containerEl: open.body } });
    const f = new (class extends dr.Feature {})(w.plugin);
    const seen = [];
    f.on = true;
    f.eachWindow((doc) => seen.push(doc));
    w.app.workspace.trigger('window-open', { doc: later });
    w.app.workspace.trigger('window-open', { doc: later });
    f.off();
    w.app.workspace.trigger('window-open', { doc: after });
    assert.deepStrictEqual(seen, [w.doc, open, later]);
    w.app.workspace.leaves.pop();
  });

  await check('the look: classes on every window, changed with the settings, gone when the plugin unloads', async () => {
    const w = await world({});
    const body = w.doc.body;
    assert.ok(body.classList.contains('dr-active') && body.classList.contains('dr-region-workspace'));
    assert.ok(!body.classList.contains('dr-region-chrome'), 'Obsidian\'s regions are on though the look is kept to the plugin');
    const other = new (require('jsdom').JSDOM)('<body class="theme-dark"></body>').window.document;
    w.app.workspace.trigger('window-open', { doc: other });
    assert.ok(other.body.classList.contains('dr-active'));
    // The look on the whole window: every region, Obsidian's too; no switch a region.
    Object.assign(w.plugin.settings, { lookScope: 'window' });
    await w.plugin.saveSettings();
    [body, other.body].forEach((b) => {
      assert.ok(b.classList.contains('dr-region-chrome') && b.classList.contains('dr-region-overlays') && !b.classList.contains('dr-labels'));
    });
    w.plugin.settings.look = 'theme';
    await w.plugin.saveSettings();
    assert.strictEqual(body.className, 'theme-light', 'the theme is not left untouched');
    w.plugin.settings.look = 'redux';
    await w.plugin.saveSettings();
    const before = Object.keys(obsidian.icons).filter((id) => id.startsWith('dr-')).length;
    assert.strictEqual(before, dr.GLYPH_NAMES.length, `${before} glyphs registered`);
    w.plugin.unload();
    assert.strictEqual(body.className, 'theme-light');
    assert.strictEqual(other.body.className, 'theme-dark');
    assert.strictEqual(Object.keys(obsidian.icons).filter((id) => id.startsWith('dr-')).length, 0, 'glyphs left registered');
    assert.deepStrictEqual(Object.keys(w.app.commands.commands), [], 'commands left behind');
    void window;
  });

  await check('changes between two texts: only the lines that differ, and in them only the characters; applied, they make the second', () => {
    const apply = (was, changes) => changes.slice().reverse().reduce((t, c) => t.slice(0, c.from) + c.text + t.slice(c.to), was);
    const was = '# A\nkeep\nOne[^1].\nkeep\n\n[^1]: a\n';
    const now = '# A\nkeep\nOne[^1] two[^2].\nkeep\n\n[^1]: a\n[^2]: b\n';
    const changes = dr.changesBetween(was, now);
    assert.deepStrictEqual(changes, [{ from: 16, to: 16, text: ' two[^2]' }, { from: 32, to: 32, text: '[^2]: b\n' }]);
    // Footnotes renumbered: the numbers alone change, never a line's end.
    assert.deepStrictEqual(dr.changesBetween('a[^2] b[^1]\n\n[^1]: x\n[^2]: y\n', 'a[^1] b[^2]\n\n[^1]: y\n[^2]: x\n').map((c) => c.text), ['1] b[^2', 'y', 'x']);
    assert.strictEqual(apply(was, changes), now);
    assert.deepStrictEqual(dr.changesBetween(now, now), []);
    [['', 'a'], ['a', ''], ['a\nb', 'a\nb\n'], ['x\ny\nz\n', 'z\ny\nx\n']].forEach(([a, b]) => assert.strictEqual(apply(a, dr.changesBetween(a, b)), b));
  });

  await check('a typed name stays one name in its folder: no slash, and not only dots', async () => {
    assert.deepStrictEqual(['../x', '..', ' . ', 'a/b:c', 'Week 2'].map(dr.cleanName), ['.. x', '', '', 'a b c', 'Week 2']);
    const w = await world({ 'Logic/A.md': '' });
    assert.strictEqual(await w.plugin.files.rename(w.file('Logic/A.md'), '..'), false);
    assert.strictEqual((await w.plugin.files.newFolder(w.file('Logic'), '../../Out')).path, 'Logic/.. .. Out');
    assert.strictEqual(dr.renameTagInText('#old and #old/x', 'old', 'new$&'), '#new$& and #new$&/x');
  });

  check.done();
})();
