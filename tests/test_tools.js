/*
 * The tools: the strip; property tools, each one Undo; the clipboard and
 * sets; folder schemas; rules (a dry run first, never firing themselves);
 * history; the graph's routes and filter; the 3D graph; maps (one model,
 * smooth at 500 nodes, worked from the keys); the menu filter, the actions
 * menu and diagnostics.
 */
const assert = require('assert');
const { load, world, suite, settle, obsidian, window } = require('./harness.js');

const dr = load();
const check = suite('tools');
const feature = (w, name) => w.plugin.features.find((f) => f.constructor.name === name);
const answer = async (pick) => { await settle(); const m = obsidian.Modal.open[obsidian.Modal.open.length - 1]; pick(m); await settle(); };
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const props = (w, p) => w.plugin.notes.props(w.file(p));

// The clipboard, stood in for.
let board = '';
Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { board = String(t); }, readText: async () => board } });
// A 2D context that counts what is drawn.
const drawn = { rects: 0, strokes: 0 };
window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, { get: (_, k) => (k === 'fillRect' ? () => drawn.rects++ : k === 'stroke' ? () => drawn.strokes++ : () => {}), set: () => true });
};

const VAULT = {
  'Logic/A.md': '---\nstatus: Draft\ncourse: logic\ntags: [formal, logic/proof]\nweek: "3"\n---\nText #formal and #formalism and `#formal` here. [[Missing one]]\n',
  'Logic/B.md': '---\nStatus: draft\n---\n#formal/sub\n',
  'Logic/C.md': '---\nstate: done\nstatus: draft\n---\n',
  'Logic/Sub/S.md': '---\nweek: three\n---\n',
  'Reading/D.md': '---\nstatus: done\ndomain: [ethics]\n---\n',
  'Reading/E.md': '',
};

(async () => {
  await check('the strip: one line, its place "2 / 3", Previous and Next as words, no control; gone when turned off', async () => {
    const w = await world(VAULT, { settingsVersion: 100, contextStrip: true });
    const leaf = w.app.workspace.getLeaf();
    await leaf.openFile(w.file('Logic/B.md'));
    await settle();
    const bar = leaf.view.contentEl.querySelector('.dr-strip');
    const words = () => Array.from(leaf.view.contentEl.querySelectorAll('.dr-strip > *')).map((n) => `${n.textContent}${n.getAttribute('aria-disabled') === 'true' ? '(off)' : ''}`);
    assert.deepStrictEqual(words(), ['2 / 3', 'Previous', 'Next']);
    assert.ok(!bar.querySelector('svg, .dr-icon-button, .dr-button'), 'the strip has a glyph or a control');
    Array.from(bar.querySelectorAll('.dr-link')).find((l) => l.textContent === 'Next').click();
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Logic/C.md');
    assert.deepStrictEqual(words(), ['3 / 3', 'Previous', 'Next(off)']);
    w.plugin.settings.contextStrip = false;
    await w.plugin.saveSettings();
    assert.ok(!leaf.view.contentEl.querySelector('.dr-strip'));
  });

  await check('rename a property everywhere: its place kept, joined where the new name is taken, one Undo', async () => {
    const w = await world(VAULT);
    const tools = feature(w, 'PropertyTools');
    assert.strictEqual(await tools.renameProperty('status', 'state'), 4);
    assert.deepStrictEqual(Object.keys(props(w, 'Logic/A.md')), ['state', 'course', 'tags', 'week']);
    assert.deepStrictEqual(props(w, 'Logic/C.md'), { state: ['done', 'draft'] });
    assert.deepStrictEqual(props(w, 'Logic/B.md'), { state: 'draft' });
    w.app.commands.executeCommandById('design-redux:undo-bulk-change');
    await settle();
    assert.deepStrictEqual(props(w, 'Logic/C.md'), { state: 'done', status: 'draft' });
    assert.deepStrictEqual(Object.keys(props(w, 'Logic/A.md')), ['status', 'course', 'tags', 'week']);
  });

  await check('merge properties; rename a value; clean up a property\'s values; change a type', async () => {
    const w = await world(Object.assign({}, VAULT, { 'Logic/F.md': '---\nstatus: draft\n---\n' }));
    const tools = feature(w, 'PropertyTools');
    await tools.mergeProperties('course', 'domain');
    assert.deepStrictEqual(props(w, 'Logic/A.md').domain, 'logic');
    assert.ok(!('course' in props(w, 'Logic/A.md')));
    await tools.renameValue('status', 'done', 'finished');
    assert.strictEqual(props(w, 'Reading/D.md').status, 'finished');
    assert.deepStrictEqual(dr.valueVariants([['draft', 3], ['Draft', 1], ['done', 1]]), new Map([['draft', ['Draft']]]));
    assert.strictEqual(await tools.cleanValues('status'), 1);
    assert.strictEqual(props(w, 'Logic/A.md').status, 'draft');
    assert.strictEqual(await tools.changeType('week', 'number'), 1);
    assert.deepStrictEqual([props(w, 'Logic/A.md').week, props(w, 'Logic/Sub/S.md').week], [3, 'three']);
    assert.ok(obsidian.Notice.log.some((m) => /1 could not be read as number/.test(m)));
    assert.deepStrictEqual([dr.retype('yes', 'checkbox'), dr.retype('a, b', 'multitext'), dr.retype(['x'], 'text'), dr.retype(['x', 'y'], 'number')], [true, ['a', 'b'], 'x', undefined]);
  });

  await check('rename a tag everywhere: in properties and text, nested ones too, not in code or a longer tag; one Undo puts the text back', async () => {
    const w = await world(VAULT);
    const tools = feature(w, 'PropertyTools');
    const before = w.text('Logic/A.md');
    await tools.renameTag('formal', 'rigorous');
    assert.deepStrictEqual(props(w, 'Logic/A.md').tags, ['rigorous', 'logic/proof']);
    assert.ok(w.text('Logic/A.md').includes('Text #rigorous and #formalism and `#formal` here.'));
    assert.ok(w.text('Logic/B.md').includes('#rigorous/sub'));
    await tools.bulk.undo();
    const body = (t) => t.replace(/^---\n[\s\S]*?\n---\n/, '');
    assert.strictEqual(body(w.text('Logic/A.md')), body(before));
    assert.deepStrictEqual(props(w, 'Logic/A.md').tags, ['formal', 'logic/proof']);
  });

  await check('properties added and removed in a folder; a folder\'s defaults given to a note made there; notes missing one found', async () => {
    const w = await world(VAULT);
    const tools = feature(w, 'PropertyTools');
    await tools.addToFolder(w.file('Logic'), { reviewed: 'no', status: 'x' });
    assert.deepStrictEqual([props(w, 'Logic/A.md').reviewed, props(w, 'Logic/A.md').status, props(w, 'Logic/Sub/S.md').reviewed], ['no', 'Draft', 'no']);
    assert.ok(!('reviewed' in props(w, 'Reading/D.md')));
    await tools.removeFromFolder(w.file('Logic'), ['week']);
    assert.ok(!('week' in props(w, 'Logic/A.md')) && !('week' in props(w, 'Logic/Sub/S.md')));
    await tools.folderDefaults(w.file('Reading'), { source: 'book' });
    assert.deepStrictEqual(w.plugin.settings.folderDefaults.Reading, [{ key: 'source', value: 'book' }]);
    await w.app.vault.create('Reading/New.md', '');
    await settle();
    assert.deepStrictEqual(props(w, 'Reading/New.md'), { source: 'book' });
    w.plugin.settings.folderDefaults.Logic = { kind: 'lecture' };
    assert.deepStrictEqual(dr.defaultsOf(w.plugin.settings, 'Logic'), { kind: 'lecture' }, 'the old way of keeping defaults is not read');
    const missing = await tools.findMissing('status');
    assert.deepStrictEqual(missing.map((f) => f.path).sort(), ['Reading/E.md', 'Reading/New.md'], 'S was given a status above');
    const screen = w.app.workspace.getLeavesOfType('design-redux-browse')[0].view.screen;
    assert.deepStrictEqual(screen.filter, { prop: '!status' });
  });

  await check('the clipboard: properties copied and pasted; a folder\'s as a table and back; sorted; sets kept and stamped', async () => {
    const w = await world(VAULT);
    const clip = feature(w, 'PropertyClipboard');
    await clip.copyProps(w.file('Reading/D.md'));
    assert.ok(/status: done/.test(board) && /domain:/.test(board));
    await clip.paste(w.file('Reading/E.md'));
    assert.deepStrictEqual(props(w, 'Reading/E.md'), { status: 'done', domain: ['ethics'] });
    await clip.copyTable(w.file('Reading'));
    const table = dr.readTable(board);
    assert.deepStrictEqual(table.keys, ['status', 'domain']);
    board = board.replace('D\tdone\tethics', 'D\tread\tethics; law').replace('E\tdone\tethics', 'E\t\tethics');
    assert.strictEqual(await clip.pasteTable(w.file('Reading')), 2);
    assert.deepStrictEqual(props(w, 'Reading/D.md'), { status: 'read', domain: ['ethics', 'law'] });
    assert.deepStrictEqual(props(w, 'Reading/E.md'), { domain: ['ethics'] });
    await clip.sort(w.file('Logic/A.md'));
    assert.deepStrictEqual(Object.keys(props(w, 'Logic/A.md')), ['course', 'status', 'tags', 'week']);
    await clip.saveSet(w.file('Reading/D.md'), 'Reading note');
    await clip.applySet(w.file('Logic/B.md'), 'Reading note');
    assert.deepStrictEqual(props(w, 'Logic/B.md'), { Status: 'draft', status: 'read', domain: ['ethics', 'law'] });
    await clip.removeSet('Reading note');
    assert.deepStrictEqual(w.plugin.settings.propertySets, {});
  });

  await check('schemas: written as lines and read back; a value that doesn\'t fit says why, in the panel too; folders below inherit', async () => {
    const entries = dr.parseSchema('status: text, required, draft | done; week: number');
    assert.deepStrictEqual(entries, [{ key: 'status', type: 'text', required: true, values: ['draft', 'done'] }, { key: 'week', type: 'number' }]);
    assert.deepStrictEqual(dr.parseSchema(dr.schemaText(entries)), entries);
    assert.deepStrictEqual([dr.valueFault(entries[0], ''), dr.valueFault(entries[0], 'Done'), dr.valueFault(entries[0], 'drafty'), dr.valueFault(entries[1], 'three'), dr.valueFault(entries[1], '3')], ['required here, and missing', null, '“drafty” is not one of draft, done', 'not a number', null]);
    const w = await world(Object.assign({}, VAULT, { 'Logic/G.md': '---\nstatus: drafty\n---\n' }), { settingsVersion: 100, propertySchemas: { Logic: entries } });
    const schemas = feature(w, 'PropertySchemas');
    assert.deepStrictEqual(schemas.faults(w.file('Logic/Sub/S.md')), [{ key: 'status', fault: 'required here, and missing' }, { key: 'week', fault: 'not a number' }]);
    assert.deepStrictEqual(schemas.check().map((x) => x.file.basename).sort(), ['G', 'S']);
    obsidian.Modal.open[0].close();
    await w.app.workspace.getLeaf().openFile(w.file('Logic/G.md'));
    const leaf = await feature(w, 'Panel').reveal();
    const row = leaf.view.contentEl.querySelector('.dr-prop[data-key="status"]');
    assert.deepStrictEqual([row.getAttribute('aria-invalid'), row.getAttribute('aria-label')], ['true', 'status: “drafty” is not one of draft, done']);
  });

  await check('the rules sheet: each rule its sentence and a toggle beside it, no numbers; a new one written as a sentence with fields', async () => {
    const w = await world(VAULT, { settingsVersion: 100, propertyRules: [dr.parseRule('folder Reading -> shelf=reading')] });
    const sheet = feature(w, 'PropertyRules').edit();
    const m = sheet.modalEl;
    const said = () => Array.from(m.querySelectorAll('.dr-rule-name')).map((n) => n.textContent);
    assert.deepStrictEqual(said(), ['When a note comes into Reading, set shelf to reading']);
    assert.ok(!m.querySelector('.dr-slot'), 'the rules are numbered');
    const toggle = m.querySelector('.dr-rule .checkbox-container');
    assert.ok(toggle.classList.contains('is-enabled'), 'a rule that is on shows off');
    toggle.click();
    await settle();
    assert.strictEqual(w.plugin.settings.propertyRules[0].on, false);
    const kind = m.querySelector('.dr-rule-sentence select');
    kind.value = 'tag';
    kind.dispatchEvent(new window.Event('change'));
    const [what, key, value] = Array.from(m.querySelectorAll('.dr-rule-sentence input'));
    assert.strictEqual(what.placeholder, 'tag');
    Object.assign(what, { value: 'formal' });
    Object.assign(key, { value: 'reviewed' });
    Object.assign(value, { value: 'yes' });
    Array.from(m.querySelectorAll('.dr-button')).find((b) => b.textContent === 'Add rule').click();
    await settle();
    assert.deepStrictEqual(said(), ['When a note comes into Reading, set shelf to reading', 'When a note gets #formal, set reviewed to yes']);
    sheet.close();
  });

  await check('rules: read from a line; a dry run says and sets nothing; live, one write, which fires no rule of its own', async () => {
    const rule = dr.parseRule('tag formal -> reviewed=yes, stage=1');
    assert.deepStrictEqual([rule.when, rule.set, rule.name], [{ kind: 'tag', tag: 'formal' }, [{ key: 'reviewed', value: 'yes' }, { key: 'stage', value: '1' }], 'When a note gets #formal, set reviewed to yes and stage to 1']);
    // Written in the sheet's sentence: "When a note [comes into] [Logic], set [status] to [draft]".
    const made = dr.ruleOf({ kind: 'folder', what: '/Logic/', key: 'status', value: 'draft' });
    assert.deepStrictEqual([made.when, made.set, made.name], [{ kind: 'folder', folder: 'Logic' }, [{ key: 'status', value: 'draft' }], 'When a note comes into Logic, set status to draft']);
    assert.strictEqual(dr.ruleOf({ kind: 'tag', what: '', key: 'x' }), null);
    assert.strictEqual(dr.parseRule('folder Logic'), null);
    const w = await world(VAULT, { settingsVersion: 100, propertyRulesOn: true, propertyRules: [rule, dr.parseRule('folder Reading -> shelf=reading')] });
    let writes = 0;
    w.plugin.notes.watch(() => writes++);
    await w.plugin.notes.write(w.file('Reading/E.md'), (fm) => (fm.tags = ['formal']));
    await settle();
    assert.ok(obsidian.Notice.log.some((m) => /^Dry run: “When a note gets #formal, set reviewed to yes and stage to 1” would set reviewed, stage on E/.test(m)));
    assert.ok(!('reviewed' in props(w, 'Reading/E.md')));
    w.plugin.settings.propertyRulesDryRun = false;
    await w.plugin.saveSettings();
    writes = 0;
    await w.plugin.notes.write(w.file('Reading/D.md'), (fm) => (fm.tags = ['formal']));
    await settle();
    assert.deepStrictEqual([props(w, 'Reading/D.md').reviewed, props(w, 'Reading/D.md').stage, writes], ['yes', '1', 2]);
    writes = 0;
    await w.plugin.notes.write(w.file('Logic/A.md'), (fm) => (fm.week = 5));
    await settle();
    assert.deepStrictEqual([props(w, 'Logic/A.md').reviewed, writes], [undefined, 1], 'a rule fired on a note that already had its tag');
    await w.app.vault.create('Reading/Made.md', '');
    await settle(6);
    assert.strictEqual(props(w, 'Reading/Made.md').shelf, 'reading', 'a rule did not fire for a note made in its folder');
    await w.plugin.lastUndo.run();
    await settle(6);
    assert.ok(!('shelf' in props(w, 'Reading/Made.md')), 'the rule fired again after its write was undone');
    await w.app.vault.rename(w.file('Logic/B.md'), 'Reading/B.md');
    await settle();
    assert.strictEqual(props(w, 'Reading/B.md').shelf, 'reading', 'a rule did not fire for a note moved into its folder');
  });

  await check('history: the last changes kept by the note, newest first; one value put back from the panel', async () => {
    const w = await world(VAULT, { settingsVersion: 100, propertyHistoryLimit: 2 });
    const file = w.file('Reading/D.md');
    for (const s of ['one', 'two', 'three']) await w.plugin.notes.write(file, (fm) => (fm.status = s));
    const kept = w.plugin.historyOf(file);
    assert.deepStrictEqual(kept.map((h) => [h.was, h.now]), [['two', 'three'], ['one', 'two']]);
    await w.app.workspace.getLeaf().openFile(file);
    const panel = feature(w, 'Panel');
    const history = panel.sections(file).find((s) => s.title === 'History');
    await history.items[1].run();
    assert.strictEqual(props(w, 'Reading/D.md').status, 'one');
  });

  await check('graph routes: the long lines worked out from links alone; left out of a graph only once turned on for its kind', async () => {
    assert.deepStrictEqual(dr.redundantLinks({ A: { B: 1, C: 1 }, B: { C: 1 }, C: {} }), [['A', 'C']]);
    assert.deepStrictEqual(dr.redundantLinks({ A: { B: 1 }, B: { A: 1 } }), []);
    const w = await world({ 'A.md': '[[B]] [[C]]', 'B.md': '[[C]]', 'C.md': '' });
    const link = (a, b) => ({ source: { id: a }, target: { id: b }, line: { visible: true } });
    const renderer = { links: [link('A.md', 'B.md'), link('A.md', 'C.md'), link('B.md', 'C.md')], changed() { this.n = (this.n || 0) + 1; } };
    w.app.viewRegistry.graph = (leaf) => {
      const view = new obsidian.ItemView(leaf);
      view.getViewType = () => 'graph';
      view.renderer = renderer;
      const controls = view.contentEl.appendChild(w.doc.createElement('div'));
      controls.className = 'graph-controls';
      controls.appendChild(w.doc.createElement('input')).type = 'search';
      return view;
    };
    const leaf = w.app.workspace.getLeaf();
    await leaf.setViewState({ type: 'graph', active: true });
    assert.deepStrictEqual(renderer.links.map((l) => l.line.visible), [true, true, true], 'routes are on before they were asked for');
    w.app.commands.executeCommandById('design-redux:toggle-graph-routes');
    await settle();
    assert.deepStrictEqual(w.plugin.settings.graphRouting, { graph: true });
    assert.deepStrictEqual(renderer.links.map((l) => l.line.visible), [true, false, true]);
    // The graph's filter: a field of the plugin's that writes the graph's own search.
    const input = leaf.view.contentEl.querySelector('.dr-graph-filter input');
    input.value = 'domain=Law, status';
    key(input, 'Enter');
    await settle();
    assert.strictEqual(leaf.view.contentEl.querySelector('.graph-controls input').value, '[domain:Law] [status]');
    assert.deepStrictEqual(w.plugin.settings.graphFilters.graph, { text: 'domain=Law, status' });
    w.plugin.unload();
    assert.deepStrictEqual(renderer.links.map((l) => l.line.visible), [true, true, true], 'unloading left lines out');
    assert.ok(!leaf.view.contentEl.querySelector('.dr-graph-filter'));
  });

  await check('the 3D graph: the same cloud every time; drawn as squares and hairlines; picked by a click, opened by a second; turned by the keys', async () => {
    const files = {};
    for (let i = 0; i < 30; i++) files[`N${i}.md`] = `[[N${(i * 7 + 3) % 30}]] [[N${(i + 1) % 30}]]`;
    const w = await world(files);
    const space = dr.graphSpace(w.plugin);
    assert.strictEqual(space.nodes.length, 30);
    const a = dr.layoutSpace(30, space.links);
    const b = dr.layoutSpace(30, space.links);
    assert.ok(a.every((v, i) => v === b[i]) && a.every(Number.isFinite), 'the layout differs from run to run');
    assert.strictEqual(dr.graphSpace(w.plugin, w.file('N0.md'), 1).nodes.length, 5);
    const t = Date.now();
    dr.layoutSpace(2000, Array.from({ length: 3000 }, (_, i) => [i % 2000, (i * 13) % 2000]));
    assert.ok(Date.now() - t < 4000, `2,000 notes took ${Date.now() - t}ms to lay out`);
    const g3 = feature(w, 'Graph3D');
    const leaf = await g3.open(null);
    await settle();
    const view = leaf.view;
    assert.ok(view.canvas && /30 notes/.test(view.canvas.getAttribute('aria-label')));
    assert.ok(drawn.rects >= 31 && drawn.strokes >= 1, 'nothing was drawn');
    const [x, y] = [view.screen[0], view.screen[1]];
    const at = (type) => view.canvas.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    at('pointerdown'); at('pointerup');
    const picked = view.picked;
    assert.ok(picked >= 0 && w.plugin.selection.path === view.space.nodes[picked].id);
    at('pointerdown'); at('pointerup');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, view.space.nodes[picked].id);
    const yaw = view.look.yaw;
    key(view.canvas, 'ArrowRight');
    assert.ok(view.look.yaw > yaw);
    w.app.viewRegistry.graph = (l) => { const v = new obsidian.ItemView(l); v.getViewType = () => 'graph'; return v; };
    view.leaf.workspace.setActiveLeaf(view.leaf);
    w.app.commands.executeCommandById('design-redux:toggle-graph-3d');
    await settle();
    assert.strictEqual(view.leaf.getViewState().type, 'graph');
  });

  await check('maps: one model of a tree; laid out with no two boxes on each other; folded and unfolded; a note\'s map follows its parents and stops at a circle', async () => {
    const files = { 'Logic/A.md': '', 'Logic/B.md': '', 'Logic/Sets/S1.md': '', 'Logic/Sets/Deep/D.md': '', 'Root.md': '', 'Kid.md': '---\nparent: "[[Root]]"\n---\n', 'Grandkid.md': '---\nparent: "[[Kid]]"\n---\n', 'X.md': '---\nparent: "[[Y]]"\n---\n', 'Y.md': '---\nparent: "[[X]]"\n---\n' };
    const w = await world(files);
    const tree = dr.folderMap(w.plugin, w.file('Logic'));
    assert.deepStrictEqual(tree.children.map((c) => c.label), ['Sets', 'A', 'B']);
    assert.strictEqual(tree.children[0].children.find((c) => c.label === 'Deep').folded, true);
    const boxes = (root) => Array.from(dr.layoutMap(root).at.values());
    const overlap = (list) => list.some((p, i) => list.some((q, j) => j > i && p.x === q.x && Math.abs(p.y - q.y) < dr.MAP.nodeH));
    assert.ok(!overlap(boxes(tree)));
    dr.foldAll(tree, false);
    assert.strictEqual(dr.shownNodes(tree).length, 7);
    assert.ok(!overlap(boxes(tree)));
    const kin = dr.noteMap(w.plugin, w.file('Root.md'));
    assert.deepStrictEqual([kin.label, kin.children[0].label, kin.children[0].children[0].label], ['Root', 'Kid', 'Grandkid']);
    assert.strictEqual(dr.shownNodes(dr.noteMap(w.plugin, w.file('X.md'))).length, 2, 'a circle of parents did not stop');
  });

  await check('the map\'s view: the toolbar the plugin\'s glyphs, the keys walk the tree, Space folds, Enter opens; 500 nodes at once', async () => {
    const files = {};
    for (let f = 0; f < 10; f++) for (let n = 0; n < 49; n++) files[`Big/F${f}/N${n}.md`] = '';
    files['Big/Top.md'] = '';
    const w = await world(files);
    const maps = feature(w, 'Maps');
    const t = Date.now();
    const leaf = await maps.open(w.file('Big'));
    await settle();
    const view = leaf.view;
    dr.foldAll(view.root, false);
    view.draw();
    const took = Date.now() - t;
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-map-node').length, 502, 'the folder, its 10 folders, their 490 notes and its own note');
    assert.ok(took < 1500, `500 nodes took ${took}ms`);
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-map-links path').length, 1, 'the links are not one path');
    const tools = Array.from(view.contentEl.querySelectorAll('.dr-head .dr-icon-button'));
    assert.deepStrictEqual(tools.map((b) => b.querySelector('svg').getAttribute('data-icon')), ['dr-fold', 'dr-unfold', 'dr-fit', 'dr-minus', 'dr-plus']);
    tools[0].click();
    assert.strictEqual(view.contentEl.querySelectorAll('.dr-map-node').length, 12);
    const node = (label) => Array.from(view.contentEl.querySelectorAll('.dr-map-node')).find((n) => n.textContent.startsWith(label));
    const root = node('Big');
    assert.strictEqual(root.getAttribute('aria-selected'), 'true');
    // Words on the ground: no glyph on any node. A folder's colour is a small square before its word.
    view.root.children.find((c) => c.label === 'F0').colour = 'green';
    view.draw();
    assert.ok(node('F0').querySelector(':scope > .dr-map-colour[data-colour="green"]'), 'a folder\'s colour is not the square before its word');
    key(root, 'ArrowRight');
    assert.ok(node('F0').getAttribute('aria-selected') === 'true' && w.doc.activeElement === node('F0'));
    key(node('F0'), 'ArrowDown');
    assert.strictEqual(node('F1').getAttribute('aria-selected'), 'true');
    key(node('F1'), ' ');
    assert.strictEqual(node('F1').getAttribute('aria-expanded'), 'true');
    key(node('F1'), 'ArrowRight');
    key(w.doc.activeElement, 'Enter');
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'Big/F1/N0.md');
    assert.ok(w.app.viewRegistry['design-redux-outline'], 'a retired view type is not registered');
  });

  await check('the menu filter marks an unwanted entry of Obsidian\'s menus, and takes its mark off when turned off', async () => {
    const w = await world({});
    const menu = w.doc.createElement('div');
    menu.className = 'menu';
    ['Copy', 'Rename property'].forEach((t) => { const item = menu.appendChild(w.doc.createElement('div')); item.className = 'menu-item'; item.appendChild(w.doc.createElement('div')).className = 'menu-item-title'; item.firstChild.textContent = t; });
    w.doc.body.appendChild(menu);
    await settle();
    assert.deepStrictEqual(Array.from(menu.children).map((i) => i.classList.contains('dr-menu-hidden')), [false, true]);
    w.plugin.settings.menuFilter = false;
    await w.plugin.saveSettings();
    assert.ok(!menu.querySelector('.dr-menu-hidden'));
  });

  await check('the actions menu: everything that needs nothing picked, sectioned; diagnostics say nothing of the notes', async () => {
    const w = await world({ 'Private thoughts.md': 'secret words' });
    w.app.commands.executeCommandById('design-redux:open-actions');
    const titles = obsidian.Menu.shown.titles();
    ['Open library', 'Open 3D graph', 'Look the library over', 'Rename a property everywhere…'].forEach((t) => assert.ok(titles.includes(t), `${t} is not on the actions menu`));
    assert.ok(!titles.includes('Open actions menu'));
    const text = dr.diagnosticsText(w.plugin);
    assert.ok(/^Design Redux 4\.0\.0/.test(text) && /Notes: 1;/.test(text));
    assert.ok(!/Private|secret/.test(text), 'diagnostics give away a note');
    w.app.commands.executeCommandById('design-redux:copy-diagnostics');
    await settle();
    assert.strictEqual(board, text);
  });

  check.done();
})();
