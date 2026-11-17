/*
 * The shared UI pieces, a check per state: each is built as
 * docs/design-language.md says, and says its state with the ARIA attribute
 * the styles read. Also: one Tab stop a list, the arrows inside it.
 */
const assert = require('assert');
const { load, world, suite, obsidian } = require('./harness.js');

const dr = load();
const check = suite('ui');
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const glyphOf = (el) => { const svg = el.querySelector('svg.dr-glyph'); return svg ? svg.getAttribute('data-glyph') : null; };

(async () => {
  const w = await world({});
  const root = w.doc.body.appendChild(w.doc.createElement('div'));
  root.className = 'dr';
  const fresh = () => dr.clear(root);

  await check('icon button: its glyph, its word, a click and the keys; on, disabled and loading say so', () => {
    let ran = 0;
    const b = dr.iconButton(fresh(), { glyph: 'pin', label: 'Pin', run: () => ran++ });
    assert.deepStrictEqual([b.className, b.getAttribute('role'), b.getAttribute('tabindex'), b.getAttribute('aria-label'), glyphOf(b)], ['dr-icon-button', 'button', '0', 'Pin', 'pin']);
    assert.ok(!b.hasAttribute('aria-pressed'));
    b.click(); key(b, 'Enter'); key(b, ' ');
    assert.strictEqual(ran, 3);
    const on = dr.iconButton(root, { glyph: 'pin', label: 'Unpin', pressed: true });
    assert.strictEqual(on.getAttribute('aria-pressed'), 'true');
    dr.setPressed(on, false);
    assert.strictEqual(on.getAttribute('aria-pressed'), 'false');
    const off = dr.iconButton(root, { glyph: 'next', label: 'Next', disabled: true, run: () => ran++ });
    off.click(); key(off, 'Enter');
    assert.strictEqual(ran, 3, 'a disabled button ran');
    assert.strictEqual(off.getAttribute('aria-disabled'), 'true');
    const busy = dr.iconButton(root, { glyph: 'move', label: 'Moving', busy: true });
    // Working: no hourglass; the glyph stays, muted, and its word says what it is doing.
    assert.deepStrictEqual([busy.getAttribute('aria-busy'), glyphOf(busy)], ['true', 'move']);
  });

  await check('text button: rest, proposed, destroys, disabled, loading', () => {
    const rest = dr.textButton(fresh(), { text: 'Cancel' });
    assert.deepStrictEqual([rest.className, rest.textContent], ['dr-button', 'Cancel']);
    assert.ok(dr.textButton(root, { text: 'Move', kind: 'primary' }).classList.contains('is-primary'));
    assert.ok(dr.textButton(root, { text: 'Delete', kind: 'danger' }).classList.contains('is-danger'));
    assert.strictEqual(dr.textButton(root, { text: 'Move', disabled: true }).getAttribute('aria-disabled'), 'true');
    const busy = dr.textButton(root, { text: 'Moving…', busy: true });
    assert.deepStrictEqual([busy.getAttribute('aria-busy'), glyphOf(busy), busy.textContent], ['true', null, 'Moving…']);
  });

  await check('zoom control: three glyph radios, one checked; a click and the arrows choose; a disabled level is passed over', () => {
    const seen = [];
    const options = [{ id: 'objects', glyph: 'zoom-objects', label: 'Objects' }, { id: 'shelves', glyph: 'zoom-shelves', label: 'Shelves', disabled: true }, { id: 'words', glyph: 'zoom-words', label: 'Words' }];
    const z = dr.segments(fresh(), { label: 'Level of detail', options, value: 'objects', onChange: (id) => seen.push(id) });
    const items = Array.from(z.children);
    assert.deepStrictEqual([z.getAttribute('role'), z.getAttribute('aria-label')], ['radiogroup', 'Level of detail']);
    assert.deepStrictEqual(items.map((i) => [i.getAttribute('role'), i.getAttribute('aria-checked'), i.getAttribute('tabindex'), i.getAttribute('aria-label')]), [['radio', 'true', '0', 'Objects'], ['radio', 'false', '-1', 'Shelves'], ['radio', 'false', '-1', 'Words']]);
    items[1].click();
    assert.deepStrictEqual(seen, [], 'a disabled level was chosen');
    key(items[0], 'ArrowRight');
    assert.deepStrictEqual(seen, ['words']);
    assert.strictEqual(items[2].getAttribute('aria-checked'), 'true');
    items[0].click(); items[0].click();
    assert.deepStrictEqual(seen, ['words', 'objects'], 'choosing the level shown told again');
    z.drSet('words');
    assert.deepStrictEqual(seen, ['words', 'objects'], 'drSet told');
  });

  await check('tabs: word segments, the open one selected', () => {
    const t = dr.segments(fresh(), { tabs: true, options: [{ id: 'a', text: 'Notes' }, { id: 'b', text: 'Proofs' }], value: 'b' });
    assert.deepStrictEqual([t.className, t.getAttribute('role')], ['dr-segments dr-tabs', 'tablist']);
    assert.deepStrictEqual(Array.from(t.children).map((i) => [i.getAttribute('role'), i.getAttribute('aria-selected'), i.textContent]), [['tab', 'false', 'Notes'], ['tab', 'true', 'Proofs']]);
  });

  await check('object cell: no words drawn at rest but always named; picked, open, disabled, wrong; a click picks, a second opens', () => {
    const log = [];
    const g = dr.grid(fresh(), { labelled: true });
    assert.strictEqual(g.className, 'dr-grid is-labelled');
    const c = dr.cell(g, { glyph: 'pie', name: 'Logic', count: 24, counted: '24 notes', path: 'Logic', pick: () => log.push('pick'), open: () => log.push('open') });
    assert.deepStrictEqual([c.getAttribute('aria-label'), glyphOf(c), c.querySelector('.dr-cell-name').textContent, c.querySelector('.dr-cell-count').textContent, c.dataset.path], ['Logic, 24 notes', 'pie', 'Logic', '24', 'Logic']);
    c.click();
    c.setAttribute('aria-selected', 'true');
    c.click(); key(c, 'Enter'); key(c, ' ');
    assert.deepStrictEqual(log, ['pick', 'open', 'open', 'pick']);
    const cur = dr.cell(g, { glyph: 'pie', name: 'Open', current: true, selected: true });
    assert.deepStrictEqual([cur.getAttribute('aria-current'), cur.getAttribute('aria-selected')], ['true', 'true']);
    const off = dr.cell(g, { glyph: 'pie', name: 'Off', disabled: true, pick: () => log.push('off') });
    off.click();
    assert.ok(!log.includes('off'));
    const bad = dr.cell(g, { glyph: 'pie', name: 'Bad', flag: 'cover not found' });
    assert.ok(bad.querySelector('.dr-cell-flag svg') && bad.getAttribute('aria-label').includes('cover not found'));
    const cover = dr.cell(g, { glyph: 'pie', name: 'Covered', cover: 'app://x/a.png' });
    assert.ok(cover.querySelector('img.dr-cell-cover') && !glyphOf(cover));
    cover.querySelector('img').dispatchEvent(new window.Event('error'));
    assert.ok(!cover.querySelector('img') && glyphOf(cover) === 'pie' && cover.querySelector('.dr-cell-flag'), 'a cover that fails does not give way to the glyph');
  });

  await check('row: numbered; selected, open, disabled, missing, wrong, a heading', () => {
    const list = dr.rows(fresh());
    const r = dr.row(list, { number: 5, name: 'Truth tables', end: '9 min', path: 'L/T.md' });
    assert.deepStrictEqual([list.className, r.className, r.querySelector('.dr-slot').textContent, r.querySelector('.dr-row-name').textContent, r.querySelector('.dr-row-end').textContent], ['dr-rows', 'dr-row is-numbered', '05', 'Truth tables', '9 min']);
    // Without a number a row has no slot: it starts at the gutter.
    assert.ok(!dr.row(list, { name: 'Unnumbered' }).querySelector('.dr-slot'), 'an unnumbered row keeps an empty slot');
    assert.strictEqual(dr.row(list, { number: 1, name: 'a', selected: true }).getAttribute('aria-selected'), 'true');
    assert.strictEqual(dr.row(list, { number: 1, name: 'a', current: 'page' }).getAttribute('aria-current'), 'page');
    assert.strictEqual(dr.row(list, { number: 1, name: 'a', disabled: true }).getAttribute('aria-disabled'), 'true');
    assert.ok(dr.row(list, { number: 1, name: 'a', missing: true }).classList.contains('is-missing'));
    const bad = dr.row(list, { number: 1, name: 'a', error: true, end: 'unreadable', endGlyph: 'alert' });
    assert.ok(bad.classList.contains('is-error') && glyphOf(bad) === 'alert');
    const child = dr.row(dr.rows(root, { outline: true }), { name: 'A heading', child: true, current: 'location' });
    assert.ok(child.classList.contains('is-child') && child.parentNode.className === 'dr-outline' && !child.querySelector('.dr-slot'));
  });

  await check('outline folder: closed and open, by its chevron and aria-expanded', () => {
    let n = 0;
    const closed = dr.outlineFolder(fresh(), { name: 'Inbox', count: 7, open: false, toggle: () => n++ });
    assert.deepStrictEqual([closed.getAttribute('aria-expanded'), glyphOf(closed), closed.querySelector('.dr-row-end').textContent], ['false', 'next', '7']);
    closed.click();
    assert.strictEqual(n, 1);
    assert.deepStrictEqual([dr.outlineFolder(root, { name: 'Logic', open: true }).getAttribute('aria-expanded'), glyphOf(root.lastChild)], ['true', 'down']);
  });

  await check('shelf: a bar a note, as tall as it is long; the open note and the picked one marked; one listener', () => {
    const got = [];
    const s = dr.shelf(fresh(), { name: 'Logic', count: 3, onHead: () => got.push('head'), onNote: (p) => got.push(p), notes: [{ size: 1, label: 'A, 200 words', path: 'a' }, { size: 4, label: 'B', path: 'b', current: true }, { size: 2, label: 'C', path: 'c', selected: true }] });
    const bars = Array.from(s.querySelectorAll('.dr-bar'));
    assert.deepStrictEqual(bars.map((b) => [b.style.getPropertyValue('--dr-size'), b.getAttribute('aria-label'), b.getAttribute('aria-current'), b.getAttribute('aria-selected'), b.getAttribute('tabindex')]), [['1', 'A, 200 words', null, null, '-1'], ['4', 'B', 'page', null, '0'], ['2', 'C', null, 'true', '-1']]);
    bars[2].click(); key(bars[0], 'Enter'); s.querySelector('.dr-shelf-head').click();
    assert.deepStrictEqual(got, ['c', 'a', 'head']);
    assert.strictEqual(dr.shelf(root, { name: 'Open', count: 0, current: true, notes: [] }).querySelector('.dr-shelf-head').getAttribute('aria-current'), 'true');
    assert.strictEqual(root.lastChild.querySelector('.dr-shelf-bars').childNodes.length, 0, 'an empty shelf must be empty for its bare line to show');
  });

  await check('panel row and section: a dash for no value, the reason when wrong, selected, disabled', () => {
    const p = dr.propRow(fresh(), { name: 'Status', value: 'Draft' });
    assert.deepStrictEqual([p.className, p.querySelector('.dr-label').textContent, p.querySelector('.dr-prop-value').textContent], ['dr-prop', 'Status', 'Draft']);
    const none = dr.propRow(root, { name: 'Sources', value: '' });
    assert.ok(none.classList.contains('is-empty') && none.querySelector('.dr-prop-value').textContent === '—');
    const bad = dr.propRow(root, { name: 'Week', value: 'six', invalid: 'not a number' });
    assert.deepStrictEqual([bad.getAttribute('aria-invalid'), glyphOf(bad), bad.getAttribute('aria-label')], ['true', 'alert', 'Week: not a number']);
    assert.strictEqual(dr.propRow(root, { name: 'a', value: 'b', selected: true }).getAttribute('aria-selected'), 'true');
    assert.strictEqual(dr.propRow(root, { name: 'a', value: 'b', disabled: true }).getAttribute('aria-disabled'), 'true');
    const sec = dr.sectionTitle(root, { title: 'Properties', buttons: [{ glyph: 'plus', label: 'Add a property' }] });
    assert.ok(sec.className === 'dr-section' && sec.querySelector('.dr-icon-button[aria-label="Add a property"]'));
  });

  await check('table: one header, the sorted column says which way, rows carry their state, an empty one says so', () => {
    const sorts = [];
    const picked = [];
    const cols = [{ id: 'name', name: 'Name' }, { id: 'words', name: 'Words', number: true }];
    const t = dr.table(fresh(), { flush: true, numbered: true, columns: cols, sort: { id: 'name', down: false }, onSort: (id) => sorts.push(id), onRow: (r) => picked.push(r.path), rows: [{ number: 1, path: 'a', cells: { name: 'A', words: 420 } }, { number: 2, path: 'b', cells: { name: 'B', words: 'many' }, current: true, invalid: ['words'] }, { number: 3, path: 'c', cells: { name: 'C' }, selected: true }, { number: 4, path: 'd', cells: { name: 'D' }, disabled: true }] });
    assert.strictEqual(t.className, 'dr-table is-flush');
    const heads = Array.from(t.querySelectorAll('th'));
    assert.deepStrictEqual(heads.map((h) => h.getAttribute('aria-sort')), [null, 'ascending', null]);
    assert.strictEqual(glyphOf(heads[1]), 'up');
    heads[2].click();
    const trs = Array.from(t.querySelectorAll('tbody tr'));
    trs[0].click(); trs[3].click();
    assert.deepStrictEqual([sorts, picked], [['words'], ['a']]);
    assert.deepStrictEqual(trs.map((r) => [r.getAttribute('aria-current'), r.getAttribute('aria-selected'), r.getAttribute('aria-disabled')]), [[null, null, null], ['page', null, null], [null, 'true', null], [null, null, 'true']]);
    assert.strictEqual(trs[1].children[2].getAttribute('aria-invalid'), 'true');
    assert.strictEqual(trs[0].children[0].textContent, '01');
    // No number column unless the order means something.
    const plain = dr.table(root, { columns: cols, rows: [{ number: 1, path: 'a', cells: { name: 'A', words: 1 } }] });
    assert.deepStrictEqual(Array.from(plain.querySelectorAll('th')).map((h) => h.textContent), ['Name', 'Words']);
    assert.ok(!plain.querySelector('.is-slot'), 'a number column where no order was set');
    const empty = dr.table(root, { columns: cols, rows: [], empty: { label: 'No notes' } });
    assert.ok(empty.querySelector('td[colspan="2"] .dr-state .dr-state-label').textContent === 'No notes');
  });

  await check('field: empty, filled, wrong with its reason, loading, disabled; it tells what is typed', () => {
    const typed = [];
    const f = dr.field(fresh(), { label: 'Name', placeholder: 'Untitled', onInput: (v) => typed.push(v), onEnter: (v) => typed.push(`enter:${v}`) });
    assert.deepStrictEqual([f.className, f.querySelector('.dr-small').textContent, f.drInput.placeholder, f.drInput.className], ['dr-field', 'Name', 'Untitled', 'dr-input']);
    // No name over a field whose placeholder says what it is for: the placeholder names it.
    const bare = dr.field(root, { placeholder: 'Notes and folders' });
    assert.ok(!bare.querySelector('.dr-small') && bare.drInput.getAttribute('aria-label') === 'Notes and folders');
    f.drInput.value = 'Set 4';
    f.drInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    key(f.drInput, 'Enter');
    assert.deepStrictEqual(typed, ['Set 4', 'enter:Set 4']);
    f.drSay('A name can’t hold a colon.', true);
    assert.deepStrictEqual([f.getAttribute('aria-invalid'), glyphOf(f), f.querySelector('.dr-field-note').textContent], ['true', 'alert', 'A name can’t hold a colon.']);
    f.drSay('Looking…', false, true);
    // Working: the words, muted, under the box; no hourglass in it.
    assert.deepStrictEqual([f.hasAttribute('aria-invalid'), f.getAttribute('aria-busy'), glyphOf(f), f.querySelector('.dr-field-note').textContent], [false, 'true', null, 'Looking…']);
    f.drSay();
    assert.ok(!f.querySelector('.dr-field-note') && !glyphOf(f));
    const off = dr.field(root, { label: 'Name', value: 'x', disabled: true, glyph: 'search' });
    assert.ok(off.getAttribute('aria-disabled') === 'true' && off.drInput.disabled && glyphOf(off) === 'search');
  });

  await check('chip: a property, a filter off and on, disabled, wrong', () => {
    const c = dr.chip(fresh(), { name: 'Status', value: 'Draft' });
    assert.deepStrictEqual([c.className, c.hasAttribute('role'), c.textContent], ['dr-chip', false, 'StatusDraft']);
    let n = 0;
    const filter = dr.chip(root, { value: 'Unread', checked: false, run: () => n++ });
    assert.deepStrictEqual([filter.getAttribute('role'), filter.getAttribute('aria-checked'), filter.getAttribute('tabindex')], ['checkbox', 'false', '0']);
    filter.click();
    assert.strictEqual(n, 1);
    assert.strictEqual(dr.chip(root, { value: 'Unread', checked: true }).getAttribute('aria-checked'), 'true');
    assert.strictEqual(dr.chip(root, { value: 'x', disabled: true }).getAttribute('aria-disabled'), 'true');
    assert.strictEqual(dr.chip(root, { value: 'x', invalid: true }).getAttribute('aria-invalid'), 'true');
  });

  await check('say-so: empty, loading, wrong; and the head row', () => {
    const e = dr.sayso(fresh(), { label: 'No notes yet', text: 'A folder’s notes are listed here.', button: { text: 'New note' } });
    assert.deepStrictEqual([e.className, e.getAttribute('role'), glyphOf(e), e.querySelector('.dr-button').textContent], ['dr-state', 'status', 'empty', 'New note']);
    assert.strictEqual(glyphOf(dr.sayso(root, { glyph: 'wait', label: 'Reading the vault' })), 'wait');
    const bad = dr.sayso(root, { error: true, label: 'Couldn’t read Logic' });
    assert.deepStrictEqual([bad.className, bad.getAttribute('role'), glyphOf(bad)], ['dr-state is-error', 'alert', 'alert']);
    let back = 0;
    const h = dr.headRow(root, { label: 'Logic', muted: '24 notes', back: () => back++, buttons: [{ glyph: 'search', label: 'Search' }] });
    assert.deepStrictEqual(Array.from(h.querySelectorAll('.dr-icon-button')).map((b) => b.getAttribute('aria-label')), ['Back', 'Search']);
    assert.strictEqual(h.querySelector('.dr-label').textContent, 'Logic 24 notes');
    h.querySelector('.dr-icon-button').click();
    assert.strictEqual(back, 1);
  });

  await check('sheet: a question answered yes or no, a name asked for and checked', async () => {
    const yes = dr.confirm(w.app, { title: 'Delete Seminar', text: 'It goes to the bin.', action: 'Delete folder', danger: true });
    const open = obsidian.Modal.open[0];
    assert.deepStrictEqual([open.titleEl.textContent, open.contentEl.querySelector('.dr-sheet p').textContent, Array.from(open.contentEl.querySelectorAll('.dr-button')).map((b) => b.className)], ['Delete Seminar', 'It goes to the bin.', ['dr-button', 'dr-button is-danger']]);
    open.contentEl.querySelector('.is-danger').click();
    assert.strictEqual(await yes, true);
    const no = dr.confirm(w.app, { title: 'x' });
    obsidian.Modal.open[0].close();
    assert.strictEqual(await no, false);
    const named = dr.ask(w.app, { title: 'New folder', value: 'Logic', check: (v) => (v.includes(':') ? 'A name can’t hold a colon.' : null) });
    const sheet = obsidian.Modal.open[0];
    const input = sheet.contentEl.querySelector('input');
    input.value = 'a:b';
    sheet.contentEl.querySelector('.is-primary').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(obsidian.Modal.open.includes(sheet) && sheet.contentEl.querySelector('.dr-field').getAttribute('aria-invalid') === 'true', 'a wrong name closed the sheet');
    input.value = 'Sets';
    key(input, 'Enter');
    assert.strictEqual(await named, 'Sets');
  });

  await check('keys: one Tab stop, the arrows by row and column, Home and End, a typed name', () => {
    const g = dr.grid(fresh());
    ['Inbox', 'Essays', 'Logic', 'Reading', 'Lectures', 'Seminar', 'Field notes'].forEach((name, i) => dr.cell(g, { glyph: 'pie', name, current: i === 2 }));
    const cells = Array.from(g.children);
    const stop = dr.rove(g, '.dr-cell', { columns: () => 3, jump: true });
    assert.deepStrictEqual(cells.map((c) => c.getAttribute('tabindex')), ['-1', '-1', '0', '-1', '-1', '-1', '-1'], 'the open one should be the Tab stop');
    const at = () => cells.indexOf(w.doc.activeElement);
    cells[2].focus();
    key(cells[2], 'ArrowDown'); assert.strictEqual(at(), 5);
    key(cells[5], 'ArrowLeft'); assert.strictEqual(at(), 4);
    key(cells[4], 'ArrowUp'); assert.strictEqual(at(), 1);
    key(cells[1], 'ArrowUp'); assert.strictEqual(at(), 1, 'moved past the first row');
    key(cells[1], 'End'); assert.strictEqual(at(), 6);
    key(cells[6], 'Home'); assert.strictEqual(at(), 0);
    key(cells[0], 'l'); assert.strictEqual(at(), 2);
    key(cells[2], 'e'); assert.strictEqual(at(), 4, 'typing "le" should reach Lectures');
    assert.strictEqual(cells.filter((c) => c.getAttribute('tabindex') === '0').length, 1);
    stop();
    key(cells[4], 'Home'); assert.strictEqual(at(), 4, 'still listening after stop');
  });

  check.done();
})();
