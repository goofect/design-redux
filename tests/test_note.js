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
const answer = async (w, value) => { await settle(); const m = obsidian.Modal.open[obsidian.Modal.open.length - 1]; m.contentEl.querySelector('input').value = value; m.contentEl.querySelector('.dr-sheet-actions > .dr-button:last-child').click(); await settle(); };
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
    assert.deepStrictEqual(tabs(), ['Notes', 'Proofs', 'Notes 2*']);
    pages.addPageTo(w.file('Logic/Paged.md'));
    await answer(w, 'Sources');
    assert.ok(w.text('Logic/Paged.md').endsWith('%%page: Sources%%\n'));
    assert.deepStrictEqual(tabs(), ['Notes', 'Proofs', 'Notes 2', 'Sources*']);
    let shows = 0;
    const show = pages.show;
    pages.show = (...a) => (shows++, show.apply(pages, a));
    const typed = w.text('Logic/Paged.md');
    await w.app.vault.modify(w.file('Logic/Paged.md'), `${typed}More words.\n`);
    await w.app.vault.modify(w.file('Logic/Plain.md'), 'y');
    await settle();
    assert.strictEqual(shows, 0, 'a save that left the pages as they were drew them again');
    await w.app.vault.modify(w.file('Logic/Paged.md'), `${typed}More words.\n%%page: Last%%\n`);
    await settle();
    assert.deepStrictEqual(tabs(), ['Notes', 'Proofs', 'Notes 2', 'Sources*', 'Last'], 'a page typed in was not drawn');
    pages.show = show;
    await w.app.vault.modify(w.file('Logic/Plain.md'), 'x');
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
    // A value being typed survives what would draw the head again: a change in another note, a layout change.
    head.querySelector('.dr-prop[data-key="status"]').click();
    const typing = head.querySelector('.dr-prop[data-key="status"] input');
    typing.focus();
    typing.value = 'half typed';
    w.app.workspace.trigger('design-redux:props', w.file('Logic/A.md'));
    w.app.workspace.trigger('layout-change');
    await settle();
    assert.ok(typing.isConnected && typing.value === 'half typed', 'a value being typed was drawn over');
    typing.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
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

  await check('footnotes, in the note: one added at the cursor, gone to from the palette as it reads, put in order', async () => {
    const w = await world({ 'A.md': 'Claim. More[^1].\n\n[^1]: old\n' });
    const ed = editor('Claim. More[^1].\n\n[^1]: old\n', { line: 0, ch: 6 });
    const note = await open(w, 'A.md', ed);
    w.app.commands.executeCommandById('design-redux:add-footnote');
    await answer(w, 'Hume, [[Sources/Enquiry|An Enquiry]] 1748');
    assert.strictEqual(ed.text, 'Claim.[^1] More[^2].\n\n[^1]: Hume, [[Sources/Enquiry|An Enquiry]] 1748\n[^2]: old\n');
    assert.deepStrictEqual(ed.getCursor(), { line: 0, ch: 10 });
    assert.deepStrictEqual(ed.changes.pop().map((c) => c.text), ['[^1] More[^2', 'Hume, [[Sources/Enquiry|An Enquiry]] 1748\n[^2]: '], 'more of the note rewritten than changed');
    assert.ok(!w.app.workspace.getLeavesOfType('design-redux-footnotes').length && w.app.workspace.getActiveViewOfType(obsidian.MarkdownView) === note, 'a list opened beside the note, or the note left');
    // Go to footnote: each as it reads, a link as its name; one used nowhere says so, and is gone to where it stands.
    ed.setValue(`${ed.text}[^3]: spare\n`);
    w.app.commands.executeCommandById('design-redux:show-footnotes');
    await settle();
    const m = obsidian.Modal.open[obsidian.Modal.open.length - 1];
    assert.deepStrictEqual(m.getItems().map((i) => m.getItemText(i)), ['1  Hume, An Enquiry 1748', '2  old', '3  spare  (used nowhere)']);
    m.pick(m.getItems()[1]);
    await settle();
    assert.deepStrictEqual(ed.getCursor(), { line: 0, ch: 15 });
    w.app.commands.executeCommandById('design-redux:show-footnotes');
    await settle();
    const again = obsidian.Modal.open[obsidian.Modal.open.length - 1];
    again.pick(again.getItems()[2]);
    await settle();
    assert.deepStrictEqual(ed.getCursor(), { line: 4, ch: 0 });
    ed.setValue('B[^2] A[^1]\n\n[^1]: a\n[^2]: b\n');
    w.app.commands.executeCommandById('design-redux:tidy-footnotes');
    assert.strictEqual(ed.text, 'B[^1] A[^2]\n\n[^1]: b\n[^2]: a\n');
  });

  await check('cite a source: a note picked (those cited here first, then those with an author, as each will read), where in it asked; in full the first time, short after; cited again, its number again; the notes citing a source found from it', async () => {
    const w = await world({
      'A.md': 'Claim. More[^1].\n\n[^1]: old\n',
      'Sources/Enquiry.md': '---\nauthor: "[[David Hume]]"\ntitle: "An Enquiry: Concerning Human Understanding"\ndate: 1748-01-01\n---\n',
      'Sources/Federalist.md': '---\nauthors: [Alexander Hamilton, James Madison, John Jay]\nyear: 1788\n---\n',
      'Sources/Loose.md': '',
      'B.md': 'Also[^1].\n\n[^1]: Compare [[Sources/Enquiry]].\n',
      'C.md': 'Mentions [[Sources/Enquiry]] in the text only.\n',
    });
    const ed = editor('Claim. More[^1].\n\n[^1]: old\n', { line: 0, ch: 6 });
    await open(w, 'A.md', ed);
    const pickSource = async (name) => { await settle(); const m = obsidian.Modal.open[obsidian.Modal.open.length - 1]; const items = m.getItems(); assert.ok(!items.some((s) => s.file.path === 'A.md'), 'the note itself offered'); m.pick(items.find((s) => s.file.basename === name)); await settle(); return items.map((s) => m.getItemText(s)); };
    const cite = async (name, where) => { w.app.commands.executeCommandById('design-redux:cite-source'); const offered = await pickSource(name); await answer(w, where); return offered; };
    assert.deepStrictEqual((await cite('Federalist', 'no. 10')).slice(0, 2), ['David Hume, An Enquiry: Concerning Human Understanding, 1748', 'Alexander Hamilton et al., Federalist, 1788']);
    assert.strictEqual(ed.text, 'Claim.[^1] More[^2].\n\n[^1]: Alexander Hamilton et al., [[Sources/Federalist]], 1788, no. 10\n[^2]: old\n');
    // A source cited here is offered first; cited again further on, at another place, short: surnames, the title without its subtitle, where.
    ed.setCursor({ line: 0, ch: ed.text.indexOf('.', 10) });
    const offered = await cite('Federalist', 'no. 51');
    assert.strictEqual(offered[0], 'Alexander Hamilton et al., Federalist, 1788');
    assert.strictEqual(ed.text, 'Claim.[^1] More[^2][^3].\n\n[^1]: Alexander Hamilton et al., [[Sources/Federalist]], 1788, no. 10\n[^2]: old\n[^3]: Hamilton et al., [[Sources/Federalist]], no. 51\n');
    ed.setCursor({ line: 0, ch: 0 });
    await cite('Enquiry', '§10');
    ed.setCursor({ line: 0, ch: ed.text.indexOf('.') });
    await cite('Enquiry', '§12');
    assert.deepStrictEqual(ed.text.split('\n').filter((l) => /Hume/.test(l)), ['[^1]: David Hume, [[Sources/Enquiry|An Enquiry: Concerning Human Understanding]], 1748, §10', '[^2]: Hume, [[Sources/Enquiry|An Enquiry]], §12']);
    // The same place again: the same footnote, still in order.
    ed.setCursor({ line: 0, ch: ed.text.length > 0 ? ed.text.indexOf('More') : 0 });
    await cite('Enquiry', '§12');
    assert.strictEqual((ed.text.match(/\[\^2\]/g) || []).length, 3, ed.text);
    // Nothing for where: the citation alone; a source with no properties, by its name.
    await cite('Loose', '');
    assert.ok(/\[\^\d+\]: \[\[Sources\/Loose\]\]\n/.test(ed.text), ed.text);
    // From the source: the notes whose footnotes link to it, and only those; one taken opens.
    await w.app.vault.modify(w.file('A.md'), ed.text);
    await w.app.workspace.getLeaf().openFile(w.file('Sources/Enquiry.md'));
    w.app.commands.executeCommandById('design-redux:notes-citing-this');
    await settle();
    const m = obsidian.Modal.open[obsidian.Modal.open.length - 1];
    assert.deepStrictEqual(m.getItems().map((i) => m.getItemText(i)).sort(), ['A', 'B']);
    m.pick(m.getItems().find((i) => i.note.path === 'A.md'));
    await settle();
    assert.strictEqual(w.app.workspace.getActiveFile().path, 'A.md');
  });

  await check('a value typed in the ledger: the values used for it offered, most used first, once a key is pressed; one taken is written, in a list added; a schema\'s values offered instead', async () => {
    const w = await world({ 'Logic/A.md': '---\nstatus: draft\ntags: [a]\n---\n', 'Logic/B.md': '---\nstatus: done\ntags: [logic, sets]\n---\n', 'Logic/C.md': '---\nstatus: done\ntags: [logic]\n---\n', 'D.md': '---\nstatus: dormant\n---\n', 'E.md': '---\nstatus: ordered\n---\n' });
    const file = w.file('Logic/A.md');
    const host = w.doc.body.appendChild(w.doc.createElement('div'));
    const draw = () => { host.textContent = ''; dr.drawLedger(w.plugin, host, file, draw); };
    draw();
    const type = (key, value) => {
      const input = host.querySelector('.dr-prop input') || (host.querySelector(`.dr-prop[data-key="${key}"]`).click(), host.querySelector('.dr-prop input'));
      input.value = value;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      return obsidian.AbstractInputSuggest.last;
    };
    host.querySelector('.dr-prop[data-key="status"]').click();
    assert.deepStrictEqual(obsidian.AbstractInputSuggest.last.shown, [], 'offered before a key was pressed');
    const offered = (key, value) => type(key, value).shown.map((s) => s.text);
    assert.deepStrictEqual(offered('status', ''), ['done', 'dormant', 'draft', 'ordered'], 'not most used first');
    assert.deepStrictEqual(offered('status', 'O'), ['ordered', 'done', 'dormant'], 'not those it starts first, then those it is in');
    assert.deepStrictEqual(offered('status', 'ra'), ['draft']);
    assert.deepStrictEqual(offered('status', 'done'), [], 'the value typed offered again');
    const suggest = type('status', 'do');
    suggest.pick(suggest.shown[1]);
    await settle();
    assert.strictEqual(w.plugin.notes.get(file, 'status'), 'dormant', 'a value taken not written');
    assert.ok(!host.querySelector('.dr-prop input'), 'still editing once written');
    // A list: the part after the last comma is matched and replaced, those it has left out; it stays open for the next.
    host.querySelector('.dr-prop[data-key="tags"]').click();
    assert.deepStrictEqual(offered('tags', 'a, '), ['logic', 'sets']);
    const tags = type('tags', 'a, l');
    tags.pick(tags.shown[0]);
    const input = host.querySelector('.dr-prop input');
    assert.strictEqual(input.value, 'a, logic, ');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    assert.deepStrictEqual(w.plugin.notes.get(file, 'tags'), ['a', 'logic']);
    // The folder's schema says which values: only those are offered.
    w.plugin.settings.propertySchemas = { Logic: [{ key: 'status', type: 'text', values: ['draft', 'review', 'done'] }] };
    assert.deepStrictEqual(offered('status', ''), ['draft', 'review', 'done']);
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
    feature(w, 'Scripts').render(p);
    assert.deepStrictEqual(Array.from(p.querySelectorAll('sup, sub')).map((e) => `${e.tagName}:${e.textContent}`), ['SUP:2', 'SUB:2']);
    assert.strictEqual(p.textContent, 'E = mc2, H2O, the 1st, a^b^');
  });

  await check('lists: letters and numerals counted, a marker read by the one before it, lines made a list, Enter carries it on', async () => {
    assert.deepStrictEqual([dr.toRoman(14), dr.fromRoman('xiv'), dr.fromRoman('iiii'), dr.toLetters(27), dr.fromLetters('aa')], ['xiv', 14, 0, 'aa', 27]);
    assert.deepStrictEqual([dr.nextMarker('h'), dr.nextMarker('i', 'h'), dr.nextMarker('i'), dr.nextMarker('ii', 'i'), dr.nextMarker('C')], ['i', 'j', 'ii', 'iii', 'D']);
    const w = await world({ 'A.md': '' });
    const lists = feature(w, 'MarkedLists');
    const ed = editor('a. first\nb. second', { line: 1, ch: 9 });
    assert.ok(lists.carryOn(ed));
    assert.strictEqual(ed.text, 'a. first\nb. second\nc. ');
    assert.ok(lists.carryOn(ed), 'an empty item should end the list');
    assert.strictEqual(ed.text, 'a. first\nb. second\n');
    const lone = editor('a. ', { line: 0, ch: 3 });
    assert.ok(!lists.carryOn(lone));
    assert.ok(!lists.carryOn(editor('Mr. Smith', { line: 0, ch: 9 })), 'a word with a full stop is no marker');
    // A) i) and the like: Tab nests a level down, a then i then a; Enter reads the item at its own depth; Shift-Tab steps back out.
    const nest = editor('A) one\nB) ', { line: 1, ch: 3 });
    assert.ok(lists.indent(nest));
    assert.strictEqual(nest.text, 'A) one\n\ti) ');
    nest.replaceSelection('sub');
    assert.ok(lists.carryOn(nest));
    assert.strictEqual(nest.text, 'A) one\n\ti) sub\n\tii) ');
    assert.ok(lists.indent(nest));
    assert.strictEqual(nest.text, 'A) one\n\ti) sub\n\t\ta) ');
    assert.ok(lists.carryOn(nest), 'an empty nested item steps out');
    assert.strictEqual(nest.text, 'A) one\n\ti) sub\n\tii) ');
    assert.ok(lists.outdent(nest));
    assert.strictEqual(nest.text, 'A) one\n\ti) sub\nB) ');
    const deep = editor('h. eight\n\ti. one', { line: 1, ch: 7 });
    assert.ok(lists.carryOn(deep), 'i under h is a numeral of its own list');
    assert.strictEqual(deep.text, 'h. eight\n\ti. one\n\tii. ');
    const under = editor('1. first\n\ta. sub\n\tb. ', { line: 2, ch: 4 });
    assert.ok(lists.outdent(under));
    assert.strictEqual(under.text, '1. first\n\ta. sub\n2. ', 'stepping out of a lettered list carries on the numbers');
    const sel = editor('one\ntwo');
    sel.select({ line: 0, ch: 0 }, { line: 1, ch: 3 });
    await open(w, 'A.md', sel);
    w.app.commands.executeCommandById('design-redux:make-lettered-list');
    await settle();
    assert.strictEqual(sel.text, '1. one\n2. two', 'the lines are not one of Obsidian\'s lists');
    assert.strictEqual(w.plugin.notes.get(w.file('A.md'), 'numbering'), 'a i');
  });

  await check('lists in reading view: the items made a list in place, nested by the source, links moved not copied, prose left be', async () => {
    const w = await world({ 'A.md': '' });
    const lists = feature(w, 'MarkedLists');
    const d = w.doc;
    // A list as [marker, words, [its sub-list]].
    const shape = (list) => Array.from(list.children).map((row) => {
      assert.strictEqual(`${list.tagName}>${row.tagName}`, 'OL>LI', 'not an ol of li, as Obsidian renders its numbered lists');
      const sub = row.querySelector(':scope > .dr-marked-list');
      const out = [row.dataset.marker, Array.from(row.childNodes).filter((n) => n !== sub).map((n) => n.textContent).join('')];
      return sub ? out.concat([shape(sub)]) : out;
    });
    const section = (...nodes) => { const el = d.createElement('div'); el.append(...nodes); return el; };

    const p = d.createElement('p');
    p.textContent = 'i. one\nii. two';
    lists.render(section(p));
    assert.deepStrictEqual(shape(p.querySelector('.dr-marked-list')), [['i.', 'one'], ['ii.', 'two']]);
    assert.strictEqual(p.firstChild.className, 'dr-marked-list', 'nothing is left before a list that was the whole paragraph');

    const link = d.createElement('a');
    link.textContent = 'Note';
    const lead = d.createElement('p');
    lead.append('Choose:', d.createElement('br'), 'A) see ', link, d.createElement('br'), 'B) two');
    lists.render(section(lead));
    assert.strictEqual(lead.firstChild.data, 'Choose:');
    assert.strictEqual(lead.childNodes[1].className, 'dr-marked-list', 'no break is left between the lead and the list');
    assert.deepStrictEqual(shape(lead.childNodes[1]), [['A)', 'see Note'], ['B)', 'two']]);
    assert.ok(lead.contains(link), 'the link is the same node, moved');

    const nested = d.createElement('p');
    nested.append('A) one', d.createElement('br'), '\ni) sub', d.createElement('br'), '\nii) more', d.createElement('br'), '\nB) two');
    const root = section(nested);
    lists.render(root, { getSectionInfo: () => ({ text: 'A) one\n\ti) sub\n\tii) more\nB) two', lineStart: 0, lineEnd: 3 }) });
    assert.deepStrictEqual(shape(nested.querySelector('.dr-marked-list')), [['A)', 'one', [['i)', 'sub'], ['ii)', 'more']]], ['B)', 'two']]);

    const li = d.createElement('li');
    const indicator = d.createElement('div');
    const own = d.createElement('ul');
    li.append(indicator, 'Topic\na. sub\nb. more', own);
    lists.render(section(li));
    assert.deepStrictEqual(Array.from(li.childNodes).map((n) => n.className || n.nodeName), ['DIV', '#text', 'dr-marked-list dr-marked-sublist', 'UL'], 'a list in an item of Obsidian\'s is not a list in a list');
    assert.strictEqual(li.childNodes[1].data, 'Topic');
    assert.ok(li.firstChild === indicator && li.lastChild === own, "Obsidian's own nodes in the item stay where they were");

    const prose = d.createElement('p');
    prose.textContent = 'Mr. Smith\nDr. Who';
    const one = d.createElement('p');
    one.textContent = 'Intro\na. only one';
    lists.render(section(prose, one));
    assert.deepStrictEqual([prose.textContent, prose.childNodes.length, one.textContent, one.childNodes.length], ['Mr. Smith\nDr. Who', 1, 'Intro\na. only one', 1], 'words with full stops, or a lone item, are no list');
  });

  await check('lists in the editor: an item line hangs by its indent levels and its marker, the marker held in a span as wide; prose is left be', () => {
    const doc = 'a. one\n\ti) sub\nMr. Smith\nplain';
    const set = dr.itemLines(EditorState.create({ doc }), 0, doc.length, (t) => t.length * 10, 4);
    const got = [];
    for (let it = set.iter(); it.value; it.next()) got.push([it.from, it.to, it.value.spec.class, (it.value.spec.attributes || {}).style]);
    const prefix = 'dr-list-prefix cm-formatting-list cm-formatting-list-ol';
    assert.deepStrictEqual(got, [
      [0, 0, 'dr-marked-item HyperMD-list-line HyperMD-list-line-1', '--dr-mark: 30px; --dr-hang: calc(0 * var(--list-indent, 40px) + var(--list-padding-inline-start, 0px) + 30px); padding-inline-start: var(--dr-hang); text-indent: calc(-1 * var(--dr-hang))'],
      [0, 3, prefix, undefined],
      [7, 7, 'dr-marked-item HyperMD-list-line HyperMD-list-line-2', '--dr-mark: 30px; --dr-hang: calc(1 * var(--list-indent, 40px) + var(--list-padding-inline-start, 0px) + 30px); padding-inline-start: var(--dr-hang); text-indent: calc(-1 * var(--dr-hang))'],
      [8, 11, prefix, undefined],
    ]);
  });

  await check('outline lists (1.1., 1.2.1.): Enter carries on, Tab nests, an empty item steps out by its number; "1.1" without its stop only where it follows the item above; lines numbered by their indent', async () => {
    assert.deepStrictEqual([dr.nextMarker('1.1'), dr.nextMarker('2.3.9'), dr.firstUnder('1.1')], ['1.2', '2.3.10', '1.1.1']);
    assert.deepStrictEqual([['1', '1.1'], ['1.1', '1.2'], ['1.1.2', '1.2'], ['1.1', '1.3'], ['1', '2.1'], ['a', '1.1']].map(([b, m]) => dr.followsInOutline(b, m)), [true, true, true, false, false, false]);
    const w = await world({ 'A.md': '' });
    const lists = feature(w, 'MarkedLists');
    const ed = editor('1. Intro\n1.1. one', { line: 1, ch: 8 });
    assert.ok(lists.carryOn(ed));
    assert.strictEqual(ed.text, '1. Intro\n1.1. one\n1.2. ');
    assert.ok(lists.indent(ed));
    assert.strictEqual(ed.text, '1. Intro\n1.1. one\n\t1.1.1. ');
    ed.replaceSelection('deep');
    assert.ok(lists.carryOn(ed));
    assert.strictEqual(ed.text, '1. Intro\n1.1. one\n\t1.1.1. deep\n\t1.1.2. ');
    assert.ok(lists.carryOn(ed), 'an empty nested item steps out');
    assert.strictEqual(ed.text, '1. Intro\n1.1. one\n\t1.1.1. deep\n1.2. ');
    assert.ok(lists.carryOn(ed), 'an empty item written flat steps out by its number');
    assert.strictEqual(ed.text, '1. Intro\n1.1. one\n\t1.1.1. deep\n2. ');
    const flat = editor('1.1. one\n1.1.1. ', { line: 1, ch: 7 });
    assert.ok(lists.carryOn(flat));
    assert.strictEqual(flat.text, '1.1. one\n1.2. ');
    const bare = editor('1. Intro\n1.1 Background', { line: 1, ch: 14 });
    assert.ok(lists.carryOn(bare), '"1.1" under "1." is an item');
    assert.strictEqual(bare.text, '1. Intro\n1.1 Background\n1.2 ');
    assert.ok(!lists.carryOn(editor('3.5 million people', { line: 0, ch: 18 })), 'a number with a point is no item');
    assert.ok(!lists.carryOn(editor('1. one\n3.5 million', { line: 1, ch: 11 })), 'nor one that does not follow the item above');
    const out = editor('1. one\n\t1.1 sub', { line: 1, ch: 8 });
    assert.ok(lists.outdent(out));
    assert.strictEqual(out.text, '1. one\n2. sub', 'stepping out to a plain number gives it its stop');

    // As Obsidian numbers its own lists again: an item coming in or moving, the items after it count on, in the same Undo.
    const mid = editor('1.1. a\n1.2. b\n1.2.1. c\n\tmore of c\n1.3. d\n3.5 million\n', { line: 0, ch: 6 });
    assert.ok(lists.carryOn(mid));
    assert.strictEqual(mid.text, '1.1. a\n1.2. \n1.3. b\n1.3.1. c\n\tmore of c\n1.4. d\n3.5 million\n');
    assert.strictEqual(mid.changes.length, 1, 'the new item and the numbers after it are not one Undo');
    assert.deepStrictEqual(mid.getCursor(), { line: 1, ch: 5 });
    const tab = editor('1.1. a\n1.2. b\n1.3. c', { line: 1, ch: 6 });
    assert.ok(lists.indent(tab));
    assert.strictEqual(tab.text, '1.1. a\n\t1.1.1. b\n1.2. c');
    assert.ok(lists.outdent(tab));
    assert.strictEqual(tab.text, '1.1. a\n1.2. b\n1.3. c');
    const letters = editor('a. x\nb. y\nc. z\nMr. Smith', { line: 0, ch: 4 });
    assert.ok(lists.carryOn(letters));
    assert.strictEqual(letters.text, 'a. x\nb. \nc. y\nd. z\nMr. Smith');
    const moved = editor('a. x\nb. y\nc. z', { line: 1, ch: 4 });
    assert.ok(lists.indent(moved));
    assert.strictEqual(moved.text, 'a. x\n\ti. y\nb. z', 'the items it left do not count on without it');

    const d = w.doc;
    const shape = (list) => Array.from(list.children).map((row) => [row.dataset.marker, Array.from(row.childNodes).filter((n) => !n.classList || !n.classList.contains('dr-marked-list')).map((n) => n.textContent).join('')]);
    const section = (...nodes) => { const el = d.createElement('div'); el.append(...nodes); return el; };
    const p = d.createElement('p');
    p.textContent = '1.1. one\n1.2. two\n1.2.1. deep';
    lists.render(section(p));
    // With no source (an embed), an outline number says how deep it is: 1.2.1. sits under 1.2.
    assert.deepStrictEqual(shape(p.querySelector('.dr-marked-list')), [['1.1.', 'one'], ['1.2.', 'two']]);
    assert.deepStrictEqual(shape(p.querySelector('.dr-marked-list .dr-marked-list')), [['1.2.1.', 'deep']]);
    const li = d.createElement('li');
    li.append('Intro\n1.1 Background\n1.2 Scope');
    lists.render(section(li));
    assert.deepStrictEqual(shape(li.querySelector('.dr-marked-list')), [['1.1', 'Background'], ['1.2', 'Scope']]);
    const prose = d.createElement('p');
    prose.textContent = '3.5 million\n4.2 billion';
    lists.render(section(prose));
    assert.strictEqual(prose.childNodes.length, 1, 'numbers with points are no list');

    const doc = '1.1. one\n3.5 million';
    const set = dr.itemLines(EditorState.create({ doc }), 0, doc.length, (t) => t.length * 10, 4);
    const got = [];
    for (let it = set.iter(); it.value; it.next()) got.push([it.from, it.to, it.value.spec.class]);
    assert.deepStrictEqual(got, [[0, 0, 'dr-marked-item HyperMD-list-line HyperMD-list-line-1'], [0, 5, 'dr-list-prefix cm-formatting-list cm-formatting-list-ol']]);
  });

  await check('reading view: a code block Markdown made of lines indented under a list item is rendered as the note\'s text, a run at a time at its indent; fenced code stays code', async () => {
    const w = await world({ 'A.md': '' });
    const lists = feature(w, 'MarkedLists');
    const d = w.doc;
    const source = '3. [[Responsible government]]\n\t3.1. [[Parliamentary accountability]]\n\t\ti. **Summary**\n\n\t\tii. **Function**\n\t\t*Words*\n\n\t\t3.1.1. [[Parliamentary oversight]]\n\t\t\ti. **Summary**\n\n\t```\n\tfenced\n\t```';
    const section = d.createElement('div');
    const li = section.appendChild(d.createElement('ol')).appendChild(d.createElement('li'));
    li.append('Responsible government');
    const pre = li.appendChild(d.createElement('pre'));
    pre.appendChild(d.createElement('code')).textContent = 'ii. **Function**\n*Words*\n\n3.1.1. [[Parliamentary oversight]]\n\ti. **Summary**\n';
    const fenced = li.appendChild(d.createElement('pre'));
    fenced.appendChild(d.createElement('code')).textContent = 'fenced\n';
    const children = [];
    obsidian.MarkdownRenderer.calls.length = 0;
    lists.render(section, { sourcePath: 'A.md', getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: 12 }), addChild: (c) => children.push(c) });
    assert.deepStrictEqual([li.contains(pre), li.contains(fenced)], [false, true], 'the indented code is still code, or the fenced code is not');
    const block = li.querySelector('.dr-as-text-block');
    assert.deepStrictEqual(Array.from(block.children).map((g) => g.style.getPropertyValue('--dr-indent')), ['2', '2'], 'a run is not at its indent in the note');
    assert.deepStrictEqual(obsidian.MarkdownRenderer.calls.map((c) => c.markdown), ['ii. **Function**\n*Words*', '3.1.1. [[Parliamentary oversight]]\n\ti. **Summary**']);
    assert.strictEqual(children.length, 1, 'the render is not tied to the section');
  });

  await check('a note\'s numbering: its lists are Obsidian\'s own, its `numbering` says how they read; each label worked out from the numbers Obsidian keeps', async () => {
    const outline = dr.parseNumbering(1.1);
    assert.deepStrictEqual([dr.parseNumbering('1 a i'), dr.parseNumbering(['a', 'i']), outline, dr.parseNumbering('1'), dr.parseNumbering('alpha'), dr.parseNumbering(undefined)],
      [{ outline: false, styles: ['1', 'a', 'i'] }, { outline: false, styles: ['a', 'i'] }, { outline: true, styles: [] }, null, null, null]);
    const mixed = dr.parseNumbering('1 a i');
    assert.deepStrictEqual([[1], [2, 3], [2, 3, 4], [1, 1, 1, 2]].map((p) => dr.labelOf(mixed, p)), ['1.', 'c.', 'iv.', '2.']);
    assert.deepStrictEqual([dr.labelOf(outline, [1, 2, 1]), dr.labelOf(dr.parseNumbering('A I'), [3, 4], ')')], ['1.2.1.', 'IV)']);
    // The numbers an item is under, read up the lines: past words that are more of an item, never past a bullet or words at the margin.
    const lines = ['1. Intro', '\tmore of intro', '\t1. Background', '\t2. Scope', '\t\t1. Detail', '- a bullet', '\t1. under it', 'words', '\t1. under words'];
    assert.deepStrictEqual([0, 2, 3, 4, 6, 8, 1].map((n) => dr.pathAt((i) => lines[i], n)), [[1], [1, 1], [1, 2], [1, 2, 1], [1], [1], null]);
    assert.deepStrictEqual(dr.toRealList(['one', '\tsub', '\t\tdeep', '\tmore', 'two', '- three']), ['1. one', '\t1. sub', '\t\t1. deep', '\t2. more', '2. two', '3. three']);
    assert.deepStrictEqual(dr.toRealList(['1. Intro', '1.1. Background', '1.2.1. Detail', 'a. Other'], '  '), ['1. Intro', '  1. Background', '    1. Detail', '2. Other'], 'an outline written flat is nested by its numbers');

    // An outline written as text made Obsidian's lists in place: only its numbers change, so the lines under them are under a list item again.
    const written = ['---', 'tags: [a]', '---', '2. [[Responsible government]]', '\ti. **Summary**', '\tWords.', '', '\t2.1. [[Parliamentary accountability]]', '\t\ti. **Summary**', '', '\t\tii. **Function**', '\t\t1. [[Parliamentary oversight]]', '\t2.2 Confidence', '3.5 million', '```', '1.1. in code', '```'];
    assert.deepStrictEqual(dr.outlineToReal(written), ['---', 'tags: [a]', '---', '2. [[Responsible government]]', '\ti. **Summary**', '\tWords.', '', '\t1. [[Parliamentary accountability]]', '\t\ti. **Summary**', '', '\t\tii. **Function**', '\t\t1. [[Parliamentary oversight]]', '\t2. Confidence', '3.5 million', '```', '1.1. in code', '```']);
    assert.deepStrictEqual(dr.outlineToReal(['1. Intro', '1.1. Background', '1.2.1. Detail']), ['1. Intro', '\t1. Background', '\t\t1. Detail'], 'an outline written flat is not nested by its numbers');

    // In live preview: the label in the number's place, the number as typed where the cursor is; a label no wider than the number left be.
    const doc = '1. Intro\n\t1. Background\n\t2. Scope';
    const draw = (cursor) => {
      const set = dr.numberedLines(EditorState.create({ doc, selection: { anchor: cursor } }), 0, doc.length, outline, (t) => t.length * 10, 4);
      const got = [];
      for (let it = set.iter(); it.value; it.next()) got.push(it.value.spec.widget ? [it.from, it.to, it.value.spec.widget.text] : [it.from, 'line', /\+ (\d+)px\)$/.exec(it.value.spec.attributes.style.split(';')[0])[1]]);
      return got;
    };
    // The whole marker, its space too, gives way to the label, so no part of Obsidian's marker is left beside it.
    assert.deepStrictEqual(draw(0), [[9, 'line', '50'], [10, 13, '1.1. '], [24, 'line', '50'], [25, 28, '1.2. ']]);
    assert.deepStrictEqual(draw(11), [[9, 'line', '30'], [24, 'line', '50'], [25, 28, '1.2. ']], 'the number is not shown as typed where the cursor is');

    // In reading view: each item of Obsidian's lists labelled, the list given room for its widest label.
    const w = await world({ 'A.md': '---\nnumbering: 1.1\n---\n1. Intro\n\t1. Background\n', 'B.md': '1. plain\n' });
    const lists = feature(w, 'MarkedLists');
    const d = w.doc;
    const section = d.createElement('div');
    const top = section.appendChild(d.createElement('ol'));
    const intro = top.appendChild(d.createElement('li'));
    intro.append('Intro');
    const sub = intro.appendChild(d.createElement('ol'));
    sub.setAttribute('start', '3');
    ['Background', 'Scope'].forEach((t) => sub.appendChild(d.createElement('li')).append(t));
    const bullets = intro.appendChild(d.createElement('ul'));
    bullets.appendChild(d.createElement('li')).append('a bullet');
    const plain = section.cloneNode(true);
    lists.render(section, { sourcePath: 'A.md' });
    assert.deepStrictEqual(Array.from(section.querySelectorAll('li')).map((li) => li.dataset.drNumber || '-'), ['1.', '1.3.', '1.4.', '-']);
    assert.strictEqual(sub.style.getPropertyValue('--dr-marker'), '5ch');
    assert.ok(sub.querySelector('li').classList.contains('dr-numbered-in') && !intro.classList.contains('dr-numbered-in'));
    lists.render(plain, { sourcePath: 'B.md' });
    assert.ok(!plain.querySelector('[data-dr-number]'), 'a note with no numbering is labelled');

    // The commands: the selected lines made one of Obsidian's lists, the note's numbering set; a change of it draws the editors again.
    let redrawn = 0;
    w.app.workspace.updateOptions = () => redrawn++;
    const sel = editor('one\n\tsub\ntwo');
    sel.select({ line: 0, ch: 0 }, { line: 2, ch: 3 });
    await open(w, 'B.md', sel);
    w.app.commands.executeCommandById('design-redux:make-outline-list');
    await settle(8);
    assert.strictEqual(sel.text, '1. one\n\t1. sub\n2. two');
    assert.strictEqual(String(w.plugin.notes.get(w.file('B.md'), 'numbering')), '1.1');
    w.app.metadataCache.trigger('changed', w.file('B.md'));
    assert.ok(redrawn > 0, 'the editors are not drawn again when the numbering changes');
    // With nothing selected, the outline command makes the whole note's outline numbers Obsidian's lists, in one change.
    const whole = editor('1. Intro\n\tWords.\n\n\t1.1. Background\n\t\tMore.', { line: 0, ch: 0 });
    await open(w, 'B.md', whole);
    w.app.commands.executeCommandById('design-redux:make-outline-list');
    await settle(8);
    assert.strictEqual(whole.text, '1. Intro\n\tWords.\n\n\t1. Background\n\t\tMore.');
    assert.strictEqual(whole.changes.length, 1);
  });

  await check('a property added where the properties stand: a row at the ledger\'s foot, Enter from the name to the value and Enter writes it; a name the note has is said in red; Escape takes it away; with none, the row is the ledger', async () => {
    const w = await world({ 'Logic/A.md': '---\nstatus: draft\n---\n', 'Logic/B.md': '---\ncourse: Logic\n---\n', 'Logic/C.md': 'x' });
    const sheets = obsidian.Modal.open.length;
    const run = () => w.app.commands.commands['design-redux:add-property'].checkCallback(false);
    const key = (input, k) => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    const typed = (input, text) => { input.value = text; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
    const view = await open(w, 'Logic/A.md');
    const fresh = () => view.contentEl.querySelector('.markdown-source-view .dr-note-props .dr-ledger > .dr-prop-new');
    run();
    const row = fresh();
    assert.ok(row && row.previousElementSibling.dataset.key === 'status', 'the new row is not at the ledger\'s foot');
    assert.strictEqual(obsidian.Modal.open.length, sheets, 'a sheet opened');
    const [name, value] = row.querySelectorAll('input');
    assert.deepStrictEqual([w.doc.activeElement, name.placeholder, value.placeholder], [name, 'name', 'value']);
    typed(name, 'status');
    key(name, 'Enter');
    assert.strictEqual(w.doc.activeElement, value, 'Enter in the name did not go to the value');
    key(value, 'Enter');
    await settle();
    assert.deepStrictEqual([row.getAttribute('aria-invalid'), row.querySelector('.dr-prop-why').textContent, w.plugin.notes.get(w.file('Logic/A.md'), 'status')], ['true', 'This note already has it.', 'draft']);
    typed(name, 'course');
    assert.ok(!row.hasAttribute('aria-invalid'), 'the red stayed once the name changed');
    typed(value, 'Logic');
    key(value, 'Enter');
    await settle();
    assert.deepStrictEqual([w.plugin.notes.get(w.file('Logic/A.md'), 'course'), !!fresh()], ['Logic', false]);
    await w.plugin.lastUndo.run();
    assert.ok(!('course' in w.plugin.notes.props(w.file('Logic/A.md'))), 'adding was not one Undo');
    run();
    key(fresh().querySelector('input'), 'Escape');
    assert.ok(!fresh(), 'Escape left the row');
    // Within the note: its text's menu and its tab's offer it; the library's own note menu, which says file-menu too, is not given it twice.
    const textMenu = new obsidian.Menu();
    w.app.workspace.trigger('editor-menu', textMenu, view.editor, view);
    textMenu.click('Add a property');
    assert.ok(fresh(), 'the text\'s menu did not open the row');
    key(fresh().querySelector('input'), 'Escape');
    const tabMenu = new obsidian.Menu();
    w.app.workspace.trigger('file-menu', tabMenu, w.file('Logic/A.md'), 'tab-header');
    assert.deepStrictEqual(tabMenu.titles(), ['Add a property']);
    const libraryMenu = new obsidian.Menu();
    w.app.workspace.trigger('file-menu', libraryMenu, w.file('Logic/A.md'), 'design-redux-library');
    w.app.workspace.trigger('file-menu', libraryMenu, w.file('Logic/A.md'), 'file-explorer-context-menu');
    assert.deepStrictEqual(libraryMenu.titles(), [], 'offered outside the note');
    // A note with no properties: the row is the ledger, and "name: value" in the name writes at once.
    const plain = await open(w, 'Logic/C.md');
    run();
    const first = plain.contentEl.querySelector('.markdown-source-view .dr-note-props .dr-ledger > .dr-prop-new');
    assert.ok(first, 'no row for a note without properties');
    typed(first.querySelector('input'), 'week: 3');
    key(first.querySelector('input'), 'Enter');
    await settle();
    assert.strictEqual(w.plugin.notes.get(w.file('Logic/C.md'), 'week'), '3');
  });

  await check('a link in a property\'s value opens what it links to, Enter on it too; the rest of the row still edits the value', async () => {
    const w = await world({ 'Logic/A.md': '---\nrelated: "[[B]]"\nsee: ["[[Logic/C#Part|the part]]", plain]\n---\n', 'Logic/B.md': '', 'Logic/C.md': '' });
    const view = await open(w, 'Logic/A.md');
    const row = (k) => view.contentEl.querySelector(`.markdown-source-view .dr-prop[data-key="${k}"]`);
    const links = (k) => Array.from(row(k).querySelectorAll('.dr-prop-value .dr-link')).map((l) => [l.textContent, l.getAttribute('role'), l.getAttribute('tabindex')]);
    assert.deepStrictEqual([links('related'), links('see'), row('see').querySelector('.dr-prop-value').textContent], [[['B', 'link', '0']], [['the part', 'link', '0']], 'the part, plain']);
    const opened = [];
    const was = w.app.workspace.openLinkText;
    w.app.workspace.openLinkText = async (to, from, tab) => opened.push([to, from, tab]);
    row('related').querySelector('.dr-link').click();
    row('see').querySelector('.dr-link').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    w.app.workspace.openLinkText = was;
    assert.deepStrictEqual(opened, [['B', 'Logic/A.md', false], ['Logic/C#Part', 'Logic/A.md', true]]);
    assert.ok(!row('related').querySelector('input'), 'a link pressed opened the value for editing');
    row('related').click();
    assert.strictEqual(row('related').querySelector('input').value, '[[B]]', 'the row no longer edits its value');
  });

  await check('the properties listed first: a folder\'s own, and at the vault\'s top everywhere\'s', async () => {
    const w = await world({ 'Logic/A.md': '', 'B.md': '' });
    const run = () => w.app.commands.commands['design-redux:panel-folder-properties'].checkCallback(false);
    w.plugin.selection.pick(w.file('Logic'));
    run();
    await answer(w, 'week, status');
    assert.deepStrictEqual(w.plugin.settings.panelFolderViews, { Logic: { main: 'week, status' } });
    w.plugin.selection.pick(w.app.vault.getRoot());
    run();
    await answer(w, 'course');
    assert.deepStrictEqual([w.plugin.settings.panelPrimaryProps, dr.primaryProps(w.plugin.settings, w.file('B.md')), dr.primaryProps(w.plugin.settings, w.file('Logic/A.md'))], ['course', 'course', 'week, status']);
  });

  check.done();
})();
