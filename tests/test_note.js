/*
 * The note: its head, pages in one note (the text, the editor's folds, the
 * tabs, the page remembered), the panel (properties edited in place with an
 * Undo, where a note is named and mentioned), footnotes kept in order,
 * superscript and subscript, lettered and roman lists, the image router.
 */
const assert = require('assert');
const { EditorState } = require('@codemirror/state');
const { load, world, suite, settle, obsidian } = require('./harness.js');
const { editor } = require('./editor.js');

const dr = load();
const check = suite('note');
const feature = (w, name) => w.plugin.features.find((f) => f.constructor.name === name);
const answer = async (w, value) => { await settle(); const m = obsidian.Modal.open[obsidian.Modal.open.length - 1]; m.contentEl.querySelector('input').value = value; m.contentEl.querySelector('.is-primary').click(); await settle(); };
const PAGED = '---\nstatus: draft\n---\n%%page: Notes%%\n# Notes\nfirst\n\n```\n%%page: not one%%\n```\n%%page: Proofs%%\nsecond\n%%page: Notes%%\nthird\n';
const open = async (w, path, ed) => { const leaf = w.app.workspace.getLeaf(); await leaf.openFile(w.file(path)); if (ed) leaf.view.editor = ed; await settle(); return leaf.view; };

(async () => {
  await check('pages, from the text: a marker a page, none inside a fence, a name used twice numbered, the first takes what comes before', () => {
    const pages = dr.parsePages(PAGED);
    assert.deepStrictEqual(pages.map((p) => [p.name, p.line, p.from, p.to]), [['Notes', 3, 3, 10], ['Proofs', 10, 11, 12], ['Notes 2', 12, 13, 15]]);
    assert.deepStrictEqual(dr.parsePages('# plain\ntext'), []);
    const added = dr.addPage('---\na: 1\n---\n# Logic\nbody\n', 'Sources');
    assert.strictEqual(added.text, '---\na: 1\n---\n%%page: Logic%%\n# Logic\nbody\n\n%%page: Sources%%\n');
    assert.strictEqual(dr.addPage(PAGED, 'Notes').name, 'Notes 3');
    assert.strictEqual(dr.renamePage(PAGED, 'Proofs', 'Lemmas').split('\n')[10], '%%page: Lemmas%%');
    assert.deepStrictEqual(dr.parsePages(dr.removePage(PAGED, 'Proofs')).map((p) => p.name), ['Notes', 'Notes 2']);
    assert.strictEqual(dr.cleanPageName('a %% b\nc'), 'a b c');
  });

  await check('pages, in the editor: every line outside the open page is folded, the text untouched', () => {
    assert.deepStrictEqual(dr.hiddenLines(PAGED, 'Proofs'), [[3, 11], [12, 15]]);
    assert.deepStrictEqual(dr.hiddenLines(PAGED, 'Notes'), [[3, 4], [10, 15]]);
    assert.deepStrictEqual(dr.hiddenLines('no pages', 'x'), []);
    let state = EditorState.create({ doc: PAGED, extensions: [dr.pagesField] });
    assert.strictEqual(state.field(dr.pagesField).deco.size, 0);
    state = state.update({ effects: dr.showPage.of('Proofs') }).state;
    const folds = [];
    state.field(dr.pagesField).deco.between(0, state.doc.length, (from, to) => void folds.push([state.doc.lineAt(from).number - 1, state.doc.lineAt(Math.max(from, to - 1)).number - 1]));
    assert.deepStrictEqual(folds, [[3, 10], [12, 13]]);
    assert.strictEqual(state.doc.toString(), PAGED);
    state = state.update({ changes: { from: state.doc.length, insert: '%%page: New%%\nx\n' } }).state;
    assert.strictEqual(state.field(dr.pagesField).deco.size, 2, 'a page typed in was not folded');
  });

  await check('pages, in the note: tabs in its head, the page opened remembered, stepped through, added and renamed', async () => {
    const w = await world({ 'Logic/Paged.md': PAGED, 'Logic/Plain.md': 'x' });
    const view = await open(w, 'Logic/Paged.md');
    const pages = feature(w, 'NotePages');
    const tabsIn = (sel) => Array.from(view.contentEl.querySelectorAll(`${sel} .dr-note-pages .dr-segment`)).map((t) => `${t.textContent}${t.getAttribute('aria-selected') === 'true' ? '*' : ''}`);
    const tabs = () => tabsIn('.cm-sizer');
    assert.deepStrictEqual(tabs(), ['Notes*', 'Proofs', 'Notes 2']);
    assert.deepStrictEqual(tabsIn('.mod-header'), tabs(), 'reading view has other tabs');
    view.contentEl.querySelectorAll('.cm-sizer .dr-note-pages .dr-segment')[1].click();
    await settle();
    assert.deepStrictEqual(tabs(), ['Notes', 'Proofs*', 'Notes 2']);
    assert.strictEqual(w.plugin._data.pagesOpen['Logic/Paged.md'], 'Proofs');
    assert.strictEqual(view.contentEl.dataset.drPage, 'Proofs');
    w.app.commands.executeCommandById('design-redux:next-page');
    await settle();
    assert.strictEqual(w.plugin.settings.pagesOpen['Logic/Paged.md'], 'Notes 2');
    assert.deepStrictEqual(w.plugin.partsOf(w.file('Logic/Paged.md')).map((p) => [p.name, p.current]), [['Notes', false], ['Proofs', false], ['Notes 2', true]]);
    pages.add_(w.file('Logic/Paged.md'));
    await answer(w, 'Sources');
    assert.ok(w.text('Logic/Paged.md').endsWith('%%page: Sources%%\n'));
    assert.deepStrictEqual(tabs(), ['Notes', 'Proofs', 'Notes 2', 'Sources*']);
    await w.app.vault.rename(w.file('Logic/Paged.md'), 'Logic/Renamed.md');
    assert.strictEqual(w.plugin.settings.pagesOpen['Logic/Renamed.md'], 'Sources', 'the open page did not follow the rename');
    const hidden = { classList: { toggle(c, on) { this[c] = on; } } };
    pages.onRendered(hidden, { sourcePath: 'Logic/Renamed.md', getSectionInfo: () => ({ text: w.text('Logic/Renamed.md'), lineStart: 5, lineEnd: 5 }) });
    assert.strictEqual(hidden.classList['dr-page-hidden'], true, 'reading view shows a block of another page');
    const plain = await open(w, 'Logic/Plain.md');
    assert.ok(!plain.contentEl.querySelector('.dr-note-pages .dr-segment'), 'a note without pages has tabs');
    assert.strictEqual(w.text('Logic/Plain.md'), 'x', 'a note without pages was written to');
  });

  await check('the note\'s head: in the note\'s own column, folder over the title, the ledger and pages under it, a value edited where it stands; gone when the feature is off', async () => {
    const w = await world({ 'Logic/A.md': '---\nstatus: draft\ndomain: [logic, proof]\n---\n', 'Loose.md': '' });
    const view = await open(w, 'Logic/A.md');
    await w.plugin.saveSettings();
    const names = { 'dr-note-place': 'folder', 'inline-title': 'title', 'dr-note-head': 'head', 'metadata-container': 'properties', 'cm-contentContainer': 'text' };
    const order = (sel) => Array.from(view.contentEl.querySelector(sel).children).map((c) => names[Array.from(c.classList).find((k) => names[k])] || '?');
    // Editing and reading alike, so it all scrolls with the text: folder, title, the head, then the text.
    assert.deepStrictEqual(order('.cm-sizer'), ['folder', 'title', 'head', 'text']);
    assert.deepStrictEqual(order('.mod-header'), ['folder', 'title', 'head']);
    assert.ok(!Array.from(view.contentEl.children).some((c) => c.classList.contains('dr-note-head')), 'a head left at the top of the pane');
    // Obsidian's own properties under the title come before the head, so the pages stay right over the text.
    const sizer = view.contentEl.querySelector('.cm-sizer');
    const props = sizer.ownerDocument.createElement('div');
    props.className = 'metadata-container';
    sizer.insertBefore(props, sizer.querySelector('.inline-title').nextSibling);
    feature(w, 'NotePage').draw(view);
    assert.deepStrictEqual(order('.cm-sizer'), ['folder', 'title', 'properties', 'head', 'text']);
    const head = view.contentEl.querySelector('.dr-note-head');
    assert.strictEqual(view.contentEl.querySelector('.dr-note-folder').textContent, 'Logic');
    // The properties as the ledger: a ruled row each, name and value, no box, no heading, no button.
    const ledger = () => Array.from(head.querySelectorAll('.dr-note-props .dr-ledger > .dr-prop')).map((c) => [c.dataset.key, c.querySelector('.dr-prop-value').textContent]);
    assert.deepStrictEqual(ledger(), [['domain', 'logic, proof'], ['status', 'draft']]);
    assert.ok(!head.querySelector('.dr-chip, .dr-section, .dr-button, .dr-icon-button, svg'), 'a chip, a heading, a button or a glyph in the ledger');
    // A value is edited where it stands: Enter writes it, a list stays a list.
    head.querySelector('.dr-prop[data-key="domain"]').click();
    const input = head.querySelector('.dr-prop[data-key="domain"] input');
    input.value = 'logic, proof, sets';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    assert.deepStrictEqual(w.plugin.notes.get(w.file('Logic/A.md'), 'domain'), ['logic', 'proof', 'sets']);
    assert.deepStrictEqual(ledger()[0], ['domain', 'logic, proof, sets']);
    w.plugin.settings.notePage = false;
    await w.plugin.saveSettings();
    assert.ok(!view.contentEl.querySelector('.dr-note-head'), 'the head was left behind');
    w.plugin.settings.notePage = true;
    await w.plugin.saveSettings();
    view.contentEl.querySelector('.dr-note-folder').click();
    await settle();
    assert.strictEqual(w.plugin.openFolder.path, 'Logic');
  });

  await check('the ledger: values keep their kind, one Undo a change; a property added by its command (a name, or name: value), copied and pasted as text is, and removed by its menu; the panel gone, its view and commands kept quiet', async () => {
    const w = await world({ 'Logic/A.md': '---\nstatus: draft\nweek: 3\ntags: [a, b]\n---\n' });
    const file = w.file('Logic/A.md');
    const host = w.doc.body.appendChild(w.doc.createElement('div'));
    const draw = () => { host.textContent = ''; dr.drawLedger(w.plugin, host, file, draw); };
    draw();
    const keys = () => Array.from(host.querySelectorAll('.dr-prop')).map((p) => `${p.dataset.key}=${p.querySelector('.dr-prop-value').textContent}`);
    assert.deepStrictEqual(keys(), ['status=draft', 'week=3', 'tags=a, b']);
    const edit = async (key, value) => {
      host.querySelector(`.dr-prop[data-key="${key}"]`).click();
      const input = host.querySelector('.dr-prop input');
      input.value = value;
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
    };
    await edit('week', '4');
    await edit('tags', 'a, c , d');
    assert.deepStrictEqual(w.plugin.notes.props(file), { status: 'draft', week: 4, tags: ['a', 'c', 'd'] });
    await w.plugin.lastUndo.run();
    assert.deepStrictEqual(w.plugin.notes.get(file, 'tags'), ['a', 'b']);
    assert.deepStrictEqual([dr.parseValue('yes', true), dr.parseValue('x', 3), dr.parseValue('', ['a'])], [true, 'x', []]);
    assert.ok(w.app.commands.commands['design-redux:add-property'], 'no command adds a property');
    dr.addProperty(w.plugin, file);
    await answer(w, 'course');
    assert.ok('course' in w.plugin.notes.props(file));
    dr.addProperty(w.plugin, file);
    await answer(w, 'year: 1879');
    assert.strictEqual(w.plugin.notes.get(file, 'year'), '1879');
    // Copied and pasted as text is: "name: value" lines, no menu and no glyph.
    let board = '';
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { board = String(t); }, readText: async () => board } });
    const cmd = (node, k) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, metaKey: true, bubbles: true, cancelable: true }));
    const row = (k) => host.querySelector(`.dr-prop[data-key="${k}"]`);
    cmd(row('status'), 'c');
    await settle();
    assert.strictEqual(board, 'status: draft\n');
    // Rows selected as text: those the selection touches.
    const sel = w.doc.getSelection();
    const range = w.doc.createRange();
    range.setStart(row('status').querySelector('.dr-prop-name').firstChild, 0);
    range.setEnd(row('week').querySelector('.dr-prop-value').firstChild, 1);
    sel.removeAllRanges();
    sel.addRange(range);
    const data = {};
    const copy = new window.Event('copy', { bubbles: true, cancelable: true });
    copy.clipboardData = { setData: (type, t) => (data[type] = t) };
    row('status').dispatchEvent(copy);
    sel.removeAllRanges();
    assert.deepStrictEqual(dr.readProps(data['text/plain']), { status: 'draft', week: 4 });
    // ⌘V on a row: what is pasted is set, one Undo.
    board = 'status: done\nauthor: Frege\n';
    cmd(row('week'), 'v');
    await settle();
    assert.deepStrictEqual([w.plugin.notes.get(file, 'status'), w.plugin.notes.get(file, 'author')], ['done', 'Frege']);
    await w.plugin.lastUndo.run();
    assert.ok(!('author' in w.plugin.notes.props(file)), 'the paste was not one Undo');
    // Several lines pasted into the Add field are added at once; one line stays the field's text.
    const paste = (input, text) => {
      const e = new window.Event('paste', { bubbles: true, cancelable: true });
      e.clipboardData = { getData: () => text };
      input.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const adding = dr.addProperty(w.plugin, file);
    await settle();
    const field = obsidian.Modal.open[obsidian.Modal.open.length - 1].contentEl.querySelector('input');
    assert.strictEqual(paste(field, 'author: Frege'), false, 'one line pasted was not left as text');
    assert.strictEqual(paste(field, 'author: Frege\nborn: 1848\n'), true);
    await adding;
    assert.deepStrictEqual([w.plugin.notes.get(file, 'author'), w.plugin.notes.get(file, 'born')], ['Frege', 1848]);
    await dr.propertyMenu(w.plugin, file, 'course').click('Remove property');
    assert.ok(!('course' in w.plugin.notes.props(file)));
    // The panel is gone: its view type still opens (a saved layout names it) and closes itself; its commands are gone.
    assert.ok(w.app.viewRegistry['design-redux-properties'], 'the panel\'s view type is no longer registered');
    ['open-properties', 'open-inspector'].forEach((id) => assert.ok(!w.app.commands.commands[`design-redux:${id}`], `${id} is still a command`));
    host.remove();
  });

  await check('footnotes, from the text: found outside fences, put in order by where they appear, named ones kept', () => {
    const text = 'One[^2] two[^smith] three[^1].\n\n```\n[^9]\n```\n\n[^1]: first\n[^2]: second\n    more\n[^smith]: Smith 1776\n';
    const found = dr.findFootnotes(text);
    assert.deepStrictEqual(found.refs.map((r) => r.id), ['2', 'smith', '1']);
    assert.deepStrictEqual(found.defs.map((d) => [d.id, d.text]), [['1', 'first'], ['2', 'second more'], ['smith', 'Smith 1776']]);
    assert.strictEqual(dr.tidyFootnotes(text), 'One[^1] two[^smith] three[^2].\n\n```\n[^9]\n```\n\n[^1]: second more\n[^2]: first\n[^smith]: Smith 1776\n');
    assert.strictEqual(dr.tidyFootnotes('no notes'), 'no notes');
    const added = dr.addFootnote('A[^1] B C[^2].\n\n[^1]: one\n[^2]: two\n', 7, 'between');
    assert.deepStrictEqual([added.id, added.text], ['2', 'A[^1] B[^2] C[^3].\n\n[^1]: one\n[^2]: between\n[^3]: two\n']);
  });

  await check('footnotes, in the note: one added at the cursor, the list of them, put in order', async () => {
    const w = await world({ 'A.md': 'Claim. More[^1].\n\n[^1]: old\n' });
    const ed = editor('Claim. More[^1].\n\n[^1]: old\n', { line: 0, ch: 6 });
    const note = await open(w, 'A.md', ed);
    w.app.commands.executeCommandById('design-redux:add-footnote');
    await answer(w, 'Hume 1748');
    assert.strictEqual(ed.text, 'Claim.[^1] More[^2].\n\n[^1]: Hume 1748\n[^2]: old\n');
    assert.deepStrictEqual(ed.getCursor(), { line: 0, ch: 10 });
    await w.app.vault.modify(w.file('A.md'), ed.text);
    const leaf = await feature(w, 'Footnotes').show();
    await settle();
    assert.deepStrictEqual(Array.from(leaf.view.contentEl.querySelectorAll('.dr-row')).map((r) => r.textContent), ['1Hume 1748', '2old']);
    ed.setValue('B[^2] A[^1]\n\n[^1]: a\n[^2]: b\n');
    w.app.workspace.setActiveLeaf(note.leaf);
    w.app.commands.executeCommandById('design-redux:tidy-footnotes');
    assert.strictEqual(ed.text, 'B[^1] A[^2]\n\n[^1]: b\n[^2]: a\n');
  });

  await check('scripts: the short spelling found (not ~~struck~~), put on and taken off, raised in reading view', async () => {
    assert.deepStrictEqual(dr.findScripts('x^2^ and H~2~O, ~~no~~ and a ^ b').map((s) => [s.kind, s.text]), [['sup', '2'], ['sub', '2']]);
    assert.deepStrictEqual([dr.toggleScript('2', 'sup'), dr.toggleScript('^2^', 'sup'), dr.toggleScript('<sub>2</sub>', 'sub'), dr.toggleScript('2', 'sub', 'tags')], ['^2^', '2', '2', '<sub>2</sub>']);
    const w = await world({ 'A.md': 'x2' });
    const ed = editor('x2');
    await open(w, 'A.md', ed);
    ed.select({ line: 0, ch: 1 }, { line: 0, ch: 2 });
    w.app.commands.executeCommandById('design-redux:superscript');
    assert.strictEqual(ed.text, 'x^2^');
    const p = w.doc.createElement('p');
    p.appendChild(w.doc.createTextNode('E = mc^2^, H~2~O, the 1st, '));
    p.appendChild(w.doc.createElement('code')).textContent = 'a^b^';
    w.plugin.settings.autoOrdinals = true;
    feature(w, 'Scripts').render(p);
    assert.deepStrictEqual(Array.from(p.querySelectorAll('sup, sub')).map((e) => `${e.tagName}:${e.textContent}`), ['SUP:2', 'SUB:2', 'SUP:st']);
    assert.strictEqual(p.textContent, 'E = mc2, H2O, the 1st, a^b^');
  });

  await check('lists: letters and numerals counted, a marker read by the one before it, lines made a list, Enter carries it on', async () => {
    assert.deepStrictEqual([dr.toRoman(14), dr.fromRoman('xiv'), dr.fromRoman('iiii'), dr.toLetters(27), dr.fromLetters('aa')], ['xiv', 14, 0, 'aa', 27]);
    assert.deepStrictEqual([dr.nextMarker('h'), dr.nextMarker('i', 'h'), dr.nextMarker('i'), dr.nextMarker('ii', 'i'), dr.nextMarker('C')], ['i', 'j', 'ii', 'iii', 'D']);
    assert.deepStrictEqual(dr.makeList(['- one', '2. two', '', '  three'], 'roman'), ['i. one', 'ii. two', '', '  iii. three']);
    const w = await world({ 'A.md': '' });
    const lists = feature(w, 'MarkedLists');
    const ed = editor('a. first\nb. second', { line: 1, ch: 9 });
    assert.ok(lists.carryOn(ed));
    assert.strictEqual(ed.text, 'a. first\nb. second\nc. ');
    assert.ok(lists.carryOn(ed), 'an empty item should end the list');
    assert.strictEqual(ed.text, 'a. first\nb. second\n');
    const lone = editor('a. ', { line: 0, ch: 3 });
    assert.ok(!lists.carryOn(lone));
    const sel = editor('one\ntwo');
    sel.select({ line: 0, ch: 0 }, { line: 1, ch: 3 });
    await open(w, 'A.md', sel);
    w.app.commands.executeCommandById('design-redux:make-lettered-list');
    assert.strictEqual(sel.text, 'a. one\nb. two');
    const p = w.doc.createElement('p');
    p.textContent = 'i. one\nii. two';
    lists.render(p);
    assert.ok(p.classList.contains('dr-marked-list') && p.classList.contains('is-roman'));
  });

  check.done();
})();
