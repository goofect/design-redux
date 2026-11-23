/*
 * The shared UI pieces, a check per state: each says its state with the ARIA attribute
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

  await check('icon button: its glyph, its word, a click and the keys; disabled and loading say so', () => {
    let ran = 0;
    const b = dr.iconButton(fresh(), { glyph: 'pin', label: 'Pin', run: () => ran++ });
    assert.deepStrictEqual([b.className, b.getAttribute('role'), b.getAttribute('tabindex'), b.getAttribute('aria-label'), glyphOf(b)], ['dr-icon-button', 'button', '0', 'Pin', 'pin']);
    b.click(); key(b, 'Enter'); key(b, ' ');
    assert.strictEqual(ran, 3);
    const off = dr.iconButton(root, { glyph: 'next', label: 'Next', disabled: true, run: () => ran++ });
    off.click(); key(off, 'Enter');
    assert.strictEqual(ran, 3, 'a disabled button ran');
    assert.strictEqual(off.getAttribute('aria-disabled'), 'true');
    const busy = dr.iconButton(root, { glyph: 'move', label: 'Moving', busy: true });
    // Working: no hourglass; the glyph stays, muted, and its word says what it is doing.
    assert.deepStrictEqual([busy.getAttribute('aria-busy'), glyphOf(busy)], ['true', 'move']);
  });

  await check('text button: an underlined word; disabled, loading', () => {
    const rest = dr.textButton(fresh(), { text: 'Cancel' });
    assert.deepStrictEqual([rest.className, rest.textContent], ['dr-button', 'Cancel']);
    assert.strictEqual(dr.textButton(root, { text: 'Move', disabled: true }).getAttribute('aria-disabled'), 'true');
    const busy = dr.textButton(root, { text: 'Moving…', busy: true });
    assert.deepStrictEqual([busy.getAttribute('aria-busy'), glyphOf(busy), busy.textContent], ['true', null, 'Moving…']);
  });

  await check('tabs: word segments, the open one selected', () => {
    const t = dr.segments(fresh(), { tabs: true, options: [{ id: 'a', text: 'Notes' }, { id: 'b', text: 'Proofs' }], value: 'b' });
    assert.deepStrictEqual([t.className, t.getAttribute('role')], ['dr-segments dr-tabs', 'tablist']);
    assert.deepStrictEqual(Array.from(t.children).map((i) => [i.getAttribute('role'), i.getAttribute('aria-selected'), i.textContent]), [['tab', 'false', 'Notes'], ['tab', 'true', 'Proofs']]);
  });

  await check('row: a name and what trails it, never a number; selected, open, disabled, missing, wrong, a heading', () => {
    const list = dr.rows(fresh());
    const r = dr.row(list, { name: 'Truth tables', end: '9 min', path: 'L/T.md' });
    assert.deepStrictEqual([list.className, r.className, r.querySelector('.dr-row-name').textContent, r.querySelector('.dr-row-end').textContent], ['dr-rows', 'dr-row', 'Truth tables', '9 min']);
    // Rows are never numbered: a row starts at the gutter, its name first.
    assert.strictEqual(r.firstElementChild.className.split(' ')[0], 'dr-row-name');
    assert.strictEqual(dr.row(list, { name: 'a', selected: true }).getAttribute('aria-selected'), 'true');
    assert.strictEqual(dr.row(list, { name: 'a', current: 'page' }).getAttribute('aria-current'), 'page');
    assert.strictEqual(dr.row(list, { name: 'a', disabled: true }).getAttribute('aria-disabled'), 'true');
    // Wrong: its words say so, red; no glyph.
    const bad = dr.row(list, { name: 'a', error: true, end: 'unreadable' });
    assert.ok(bad.getAttribute('aria-invalid') === 'true' && bad.className === 'dr-row' && !glyphOf(bad) && bad.querySelector('.dr-row-end').textContent === 'unreadable');
    const child = dr.row(dr.rows(root, { outline: true }), { name: 'A heading', current: 'location' });
    assert.ok(child.parentNode.className === 'dr-outline');
  });

  await check('panel row and section: a dash for no value, the reason when wrong, selected, disabled', () => {
    const p = dr.propRow(fresh(), { name: 'Status', value: 'Draft' });
    assert.deepStrictEqual([p.className, p.querySelector('.dr-prop-name').textContent, p.querySelector('.dr-prop-value').textContent], ['dr-prop', 'Status', 'Draft']);
    const none = dr.propRow(root, { name: 'Sources', value: '' });
    assert.ok(none.className === 'dr-prop' && none.querySelector('.dr-prop-value.dr-muted').textContent === '—');
    const bad = dr.propRow(root, { name: 'Week', value: 'six', invalid: 'not a number' });
    assert.deepStrictEqual([bad.getAttribute('aria-invalid'), glyphOf(bad), bad.getAttribute('aria-label'), bad.querySelector('.dr-prop-why').textContent], ['true', null, 'Week: not a number', 'not a number']);
    assert.strictEqual(dr.propRow(root, { name: 'a', value: 'b', selected: true }).getAttribute('aria-selected'), 'true');
    assert.strictEqual(dr.propRow(root, { name: 'a', value: 'b', disabled: true }).getAttribute('aria-disabled'), 'true');
    const sec = dr.sectionTitle(root, { title: 'Properties', buttons: [{ glyph: 'plus', label: 'Add a property' }] });
    assert.ok(sec.className === 'dr-section' && sec.querySelector('.dr-icon-button[aria-label="Add a property"]'));
  });

  await check('field: empty, filled, wrong with its reason, loading, disabled; it tells what is typed', () => {
    const typed = [];
    const f = dr.field(fresh(), { label: 'Name', placeholder: 'Untitled', onInput: (v) => typed.push(v), onEnter: (v) => typed.push(`enter:${v}`) });
    assert.deepStrictEqual([f.className, f.querySelector('.dr-muted').textContent, f.drInput.placeholder, f.drInput.className], ['dr-field', 'Name', 'Untitled', 'dr-input']);
    // No name over a field whose placeholder says what it is for: the placeholder names it.
    const bare = dr.field(root, { placeholder: 'Notes and folders' });
    assert.ok(!bare.querySelector('.dr-muted') && bare.drInput.getAttribute('aria-label') === 'Notes and folders');
    f.drInput.value = 'Set 4';
    f.drInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    key(f.drInput, 'Enter');
    assert.deepStrictEqual(typed, ['Set 4', 'enter:Set 4']);
    f.drSay('A name can’t hold a colon.', true);
    assert.deepStrictEqual([f.getAttribute('aria-invalid'), f.querySelectorAll('svg').length, f.querySelector('.dr-field-note').textContent], ['true', 0, 'A name can’t hold a colon.']);
    f.drSay('Looking…', false, true);
    // Working: the words, muted, under the box; no hourglass in it.
    assert.deepStrictEqual([f.hasAttribute('aria-invalid'), f.getAttribute('aria-busy'), f.querySelectorAll('svg').length, f.querySelector('.dr-field-note').textContent], [false, 'true', 0, 'Looking…']);
    f.drSay();
    assert.ok(!f.querySelector('.dr-field-note') && !f.querySelector('svg'));
    const off = dr.field(root, { label: 'Name', value: 'x', disabled: true, glyph: 'close' });
    assert.ok(off.getAttribute('aria-disabled') === 'true' && off.drInput.disabled && glyphOf(off) === 'close');
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
    assert.deepStrictEqual([e.className, e.getAttribute('role'), glyphOf(e), e.querySelector('.dr-button').textContent], ['dr-state', 'status', null, 'New note']);
    const busy = dr.sayso(root, { busy: true, label: 'Reading the vault…' });
    assert.deepStrictEqual([busy.className, busy.getAttribute('aria-busy'), glyphOf(busy)], ['dr-state', 'true', null]);
    const bad = dr.sayso(root, { error: true, label: 'Couldn’t read Logic' });
    assert.deepStrictEqual([bad.className, bad.getAttribute('role'), glyphOf(bad)], ['dr-state', 'alert', null]);
    const h = dr.headRow(root, { label: 'Logic', muted: '24 notes', buttons: [{ glyph: 'fit', label: 'Fit' }] });
    assert.deepStrictEqual(Array.from(h.querySelectorAll('.dr-icon-button')).map((b) => b.getAttribute('aria-label')), ['Fit']);
    assert.strictEqual(h.querySelector('.dr-head-name').textContent, 'Logic 24 notes');
  });

  await check('sheet: a question answered yes or no, a name asked for and checked', async () => {
    const yes = dr.confirm(w.app, { title: 'Delete Seminar', text: 'It goes to the bin.', action: 'Delete folder' });
    const open = obsidian.Modal.open[0];
    assert.deepStrictEqual([open.titleEl.textContent, open.contentEl.querySelector('.dr-sheet p').textContent, Array.from(open.contentEl.querySelectorAll('.dr-button')).map((b) => b.className)], ['Delete Seminar', 'It goes to the bin.', ['dr-button', 'dr-button']]);
    open.contentEl.querySelector('.dr-sheet-actions > .dr-button:last-child').click();
    assert.strictEqual(await yes, true);
    const no = dr.confirm(w.app, { title: 'x' });
    obsidian.Modal.open[0].close();
    assert.strictEqual(await no, false);
    const named = dr.ask(w.app, { title: 'New folder', value: 'Logic', check: (v) => (v.includes(':') ? 'A name can’t hold a colon.' : null) });
    const sheet = obsidian.Modal.open[0];
    const input = sheet.contentEl.querySelector('input');
    input.value = 'a:b';
    sheet.contentEl.querySelector('.dr-sheet-actions > .dr-button:last-child').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(obsidian.Modal.open.includes(sheet) && sheet.contentEl.querySelector('.dr-field').getAttribute('aria-invalid') === 'true', 'a wrong name closed the sheet');
    input.value = 'Sets';
    key(input, 'Enter');
    assert.strictEqual(await named, 'Sets');
  });

  await check('keys: one Tab stop, the arrows by row and column, Home and End, a typed name', () => {
    const g = fresh();
    ['Inbox', 'Essays', 'Logic', 'Reading', 'Lectures', 'Seminar', 'Field notes'].forEach((name, i) => {
      const c = g.appendChild(w.doc.createElement('div'));
      c.className = 'dr-cell';
      c.textContent = name;
      if (i === 2) c.setAttribute('aria-current', 'true');
    });
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
