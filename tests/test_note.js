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
    const tabs = () => Array.from(view.contentEl.querySelectorAll('.dr-note-pages .dr-segment')).map((t) => `${t.textContent}${t.getAttribute('aria-selected') === 'true' ? '*' : ''}`);
    assert.deepStrictEqual(tabs(), ['Notes*', 'Proofs', 'Notes 2']);
    view.contentEl.querySelectorAll('.dr-note-pages .dr-segment')[1].click();
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

  await check('the image router: an image that arrives after a paste goes to the images folder; any other stays', async () => {
    const w = await world({ 'A.md': '' }, { settingsVersion: 100, routeImages: true });
    await w.app.vault.create('before.png', 'x');
    await settle();
    assert.ok(w.file('before.png'), 'an image made with no paste was moved');
    w.app.workspace.trigger('editor-paste', {});
    await w.app.vault.create('Pasted image.png', 'x');
    await settle();
    assert.ok(w.file('attachments/Pasted image.png') && !w.file('Pasted image.png'));
  });

  check.done();
})();
