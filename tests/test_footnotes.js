// Footnotes in place, against the real main.js: what's read as a
// footnote, the changes that add, change, remove and tidy them (kept in
// order), and the box on a real CodeMirror editor.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.virtualConsole.removeAllListeners('jsdomError');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.MutationObserver = dom.window.MutationObserver;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (f) => setTimeout(f, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

const P = dom.window.HTMLElement.prototype;
const apply = (el, o) => {
  if (!o) return el;
  if (typeof o === 'string') { el.className = o; return el; }
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text !== undefined) el.textContent = o.text;
  return el;
};
P.createEl = function (tag, o) { return apply(this.appendChild(document.createElement(tag)), o); };
P.createDiv = function (o) { return this.createEl('div', o); };
P.createSpan = function (o) { return this.createEl('span', o); };
P.addClass = function (...c) { this.classList.add(...c); };

const { EditorState, EditorSelection } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');

class MarkdownView {}
const notices = [];
const obsidian = new Proxy({
  MarkdownView,
  setIcon: () => {},
  Notice: class { constructor(m) { notices.push(m); } },
  Platform: { isMobile: false },
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_footnotes_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { scanFootnotes, planFootnotes, applyFootnoteChanges, footnoteBody, footnoteAt, Footnotes, DEFAULTS };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.log('  FAIL ' + name + '\n' + err.stack);
    process.exitCode = 1;
  }
};

/** A plan, applied; changes in order and not overlapping, as CodeMirror needs them. */
function run(text, op, opts) {
  const plan = R.planFootnotes(text, op, opts);
  for (let i = 1; i < plan.changes.length; i++) {
    assert.ok(plan.changes[i].from >= plan.changes[i - 1].to, `changes overlap: ${JSON.stringify(plan.changes)}`);
  }
  // The same changes, through CodeMirror itself.
  const state = EditorState.create({ doc: text });
  const tr = state.update({ changes: plan.changes });
  const out = R.applyFootnoteChanges(text, plan.changes);
  assert.strictEqual(tr.state.doc.toString(), out);
  return { text: out, cursor: plan.cursor, plan };
}
const at = (text, marker = '|') => ({ text: text.replace(marker, ''), at: text.indexOf(marker) });

/* -- what's read as a footnote ----------------------------------------- */

t('references and definitions, not code, properties, inline notes or a definition’s own label', () => {
  const text = [
    '---',
    'source: "[^9]"',
    '---',
    'A claim[^1] and `code [^2]` and an inline note^[here] and \\[^3].',
    '```',
    'x[^4]',
    '```',
    'Named[^smith].',
    '',
    '[^1]: First.',
    '    Carried on.',
    '',
    '    And on.',
    '[^smith]: Smith, *A Book* (2020), 4, see[^1].',
  ].join('\n');
  const { refs, defs } = R.scanFootnotes(text);
  assert.deepStrictEqual(refs.map((r) => r.label), ['1', 'smith', '1']);
  assert.deepStrictEqual(defs.map((d) => d.label), ['1', 'smith']);
  assert.strictEqual(R.footnoteBody(text, defs[0]), 'First.\nCarried on.\n\nAnd on.');
});

/* -- adding one -------------------------------------------------------- */

t('the first footnote: the number where the cursor is, the citation at the end', () => {
  const s = at('Parliament is sovereign.| It can make any law.');
  const r = run(s.text, { type: 'add', at: s.at, body: 'A. V. Dicey, *Law of the Constitution* (1885), 38.' });
  assert.strictEqual(
    r.text,
    'Parliament is sovereign.[^1] It can make any law.\n\n[^1]: A. V. Dicey, *Law of the Constitution* (1885), 38.\n'
  );
  assert.strictEqual(r.text.slice(0, r.cursor), 'Parliament is sovereign.[^1]', 'the cursor after the number');
  assert.strictEqual(r.plan.label, '1');
});

t('one added between 1 and 2 becomes 2, and the rest move up, in the text and the list', () => {
  const s = at(
    'One.[^1] Two.| Three.[^2] Again one.[^1]\n\n[^1]: Source one.\n[^2]: Source three.\n'
  );
  const r = run(s.text, { type: 'add', at: s.at, body: 'Source two.' });
  assert.strictEqual(
    r.text,
    'One.[^1] Two.[^2] Three.[^3] Again one.[^1]\n\n[^1]: Source one.\n[^2]: Source two.\n[^3]: Source three.\n'
  );
  assert.strictEqual(r.text.slice(0, r.cursor), 'One.[^1] Two.[^2]');
});

t('numbers already out of order are put right as one is added; named ones keep their names', () => {
  const s = at('A.[^3] B.[^kant] C.[^1] D.|\n\n[^1]: Was one.\n[^kant]: Kant.\n[^3]: Was three.\n');
  const r = run(s.text, { type: 'add', at: s.at, body: 'New.' });
  assert.strictEqual(
    r.text,
    'A.[^1] B.[^kant] C.[^2] D.[^3]\n\n[^1]: Was three.\n[^kant]: Kant.\n[^2]: Was one.\n[^3]: New.\n'
  );
});

t('a citation whose number was taken out by hand is kept, numbered last', () => {
  const s = at('A.[^1] B.|\n\n[^1]: One.\n[^2]: Cut from the text.\n');
  const r = run(s.text, { type: 'add', at: s.at, body: 'Two.' });
  assert.strictEqual(r.text, 'A.[^1] B.[^2]\n\n[^1]: One.\n[^2]: Two.\n[^3]: Cut from the text.\n');
});

t('several lines become one citation, the later lines indented', () => {
  const s = at('A.|');
  const r = run(s.text, { type: 'add', at: s.at, body: 'Smith, 4.\nSee also Jones, 9.' });
  assert.strictEqual(r.text, 'A.[^1]\n\n[^1]: Smith, 4.\n    See also Jones, 9.\n');
});

t('without keeping order: the next number, added to the end', () => {
  const s = at('A.[^2] B.|\n\n[^2]: Two.\n');
  const r = run(s.text, { type: 'add', at: s.at, body: 'Next.' }, { renumber: false });
  assert.strictEqual(r.text, 'A.[^2] B.[^3]\n\n[^2]: Two.\n[^3]: Next.\n');
});

t('definitions kept by their paragraphs stay there, renumbered', () => {
  const s = at('A.[^1]\n\n[^1]: One.\n\nB.| C.[^2]\n\n[^2]: Two.\n');
  const r = run(s.text, { type: 'add', at: s.at, body: 'New.' });
  assert.strictEqual(r.text, 'A.[^1]\n\n[^1]: One.\n\nB.[^2] C.[^3]\n\n[^2]: New.\n[^3]: Two.\n');
});

/* -- changing and removing one ---------------------------------------- */

t('a footnote’s citation changed where it is listed', () => {
  const text = 'A.[^1] B.[^2]\n\n[^1]: Old.\n    Old too.\n[^2]: Two.\n';
  const r = run(text, { type: 'edit', label: '1', body: 'New.' });
  assert.strictEqual(r.text, 'A.[^1] B.[^2]\n\n[^1]: New.\n[^2]: Two.\n');
});

t('a reference with no citation yet gets one', () => {
  const r = run('A.[^1]\n', { type: 'edit', label: '1', body: 'Now cited.' });
  assert.strictEqual(r.text, 'A.[^1]\n\n[^1]: Now cited.\n');
});

t('removing one takes its citation too, and the rest move down', () => {
  const text = 'A.[^1] B.[^2] C.[^3]\n\n[^1]: One.\n[^2]: Two.\n[^3]: Three.\n';
  const ref = R.scanFootnotes(text).refs[1];
  const r = run(text, { type: 'remove', from: ref.from, to: ref.to, label: ref.label });
  assert.strictEqual(r.text, 'A.[^1] B. C.[^2]\n\n[^1]: One.\n[^2]: Three.\n');
  assert.strictEqual(r.text.slice(0, r.cursor), 'A.[^1] B.');
});

t('removing one used twice leaves its citation for the other', () => {
  const text = 'A.[^1] B.[^1]\n\n[^1]: One.\n';
  const ref = R.scanFootnotes(text).refs[0];
  const r = run(text, { type: 'remove', from: ref.from, to: ref.to, label: ref.label });
  assert.strictEqual(r.text, 'A. B.[^1]\n\n[^1]: One.\n');
});

t('removing the only one takes the list away, blank lines and all', () => {
  const text = 'A.[^1]\n\n[^1]: One.\n';
  const ref = R.scanFootnotes(text).refs[0];
  const r = run(text, { type: 'remove', from: ref.from, to: ref.to, label: ref.label });
  assert.strictEqual(r.text, 'A.\n');
});

/* -- tidying ------------------------------------------------------------ */

t('Put footnotes in order: renumbered, listed in order, unused ones taken out', () => {
  const text = 'A.[^4] B.[^2]\n\n[^2]: Two.\n[^3]: Unused.\n[^4]: Four.\n';
  const r = run(text, { type: 'tidy' });
  assert.strictEqual(r.text, 'A.[^1] B.[^2]\n\n[^1]: Four.\n[^2]: Two.\n');
  assert.strictEqual(r.plan.removed, 1);
  const again = run(r.text, { type: 'tidy' });
  assert.strictEqual(again.text, r.text, 'in order already: nothing changes');
});

t('a note without footnotes is left as it is', () => {
  const r = run('Just text.\n', { type: 'tidy' });
  assert.strictEqual(r.text, 'Just text.\n');
  assert.strictEqual(r.plan.changes.length, 0);
});

/* -- the box, on a real editor ------------------------------------------ */

function editor(textWithCursor) {
  const s = at(textWithCursor);
  const view = new EditorView({
    state: EditorState.create({ doc: s.text, selection: EditorSelection.cursor(s.at) }),
    parent: document.body,
  });
  view.coordsAtPos = () => ({ left: 100, top: 100, bottom: 118 });
  return view;
}

function feature() {
  const settings = JSON.parse(JSON.stringify(R.DEFAULTS));
  const app = { workspace: { on: () => ({}), getActiveViewOfType: () => null } };
  return new R.Footnotes({ app, settings, registerEvent: () => {} });
}

const key = (el, k, extra) =>
  el.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));

t('the box: its number shown, Enter adds the footnote and puts the cursor after it', () => {
  const cm = editor('First.[^1] Second.| Third.[^2]\n\n[^1]: One.\n[^2]: Three.\n');
  const f = feature();
  f.openBox(cm);
  const box = document.querySelector('.dr-fn-box');
  assert.ok(box, 'box open');
  assert.strictEqual(box.querySelector('.dr-fn-num').textContent, '2');
  const input = box.querySelector('.dr-fn-input');
  assert.strictEqual(document.activeElement, input);
  input.value = 'Two.';
  key(input, 'Enter');
  assert.ok(!document.querySelector('.dr-fn-box'), 'box closed');
  assert.strictEqual(
    cm.state.doc.toString(),
    'First.[^1] Second.[^2] Third.[^3]\n\n[^1]: One.\n[^2]: Two.\n[^3]: Three.\n'
  );
  assert.strictEqual(cm.state.sliceDoc(0, cm.state.selection.main.head), 'First.[^1] Second.[^2]');
  cm.destroy();
});

t('the box on a footnote shows its citation to change; Shift+Enter is a new line; Escape changes nothing', () => {
  const cm = editor('A.[^1|] B.[^2]\n\n[^1]: Dicey, 38.\n[^2]: Two.\n');
  const f = feature();
  f.openBox(cm);
  let input = document.querySelector('.dr-fn-input');
  assert.strictEqual(input.value, 'Dicey, 38.');
  key(input, 'Enter', { shiftKey: true });
  assert.ok(document.querySelector('.dr-fn-box'), 'Shift+Enter keeps it open');
  key(input, 'Escape');
  assert.ok(!document.querySelector('.dr-fn-box'));
  assert.strictEqual(cm.state.doc.toString(), 'A.[^1] B.[^2]\n\n[^1]: Dicey, 38.\n[^2]: Two.\n');

  f.openBox(cm);
  input = document.querySelector('.dr-fn-input');
  input.value = 'Dicey, 40.';
  document.querySelector('.dr-fn-box button.mod-cta').click();
  assert.strictEqual(cm.state.doc.toString(), 'A.[^1] B.[^2]\n\n[^1]: Dicey, 40.\n[^2]: Two.\n');

  f.openBox(cm);
  document.querySelector('.dr-fn-box button.mod-warning').click();
  assert.strictEqual(cm.state.doc.toString(), 'A. B.[^1]\n\n[^1]: Two.\n');
  cm.destroy();
});

t('clicking away keeps what was typed; an empty box adds nothing', () => {
  const cm = editor('A.|');
  const f = feature();
  f.openBox(cm);
  document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.strictEqual(cm.state.doc.toString(), 'A.');
  f.openBox(cm);
  document.querySelector('.dr-fn-input').value = 'Kept.';
  document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.strictEqual(cm.state.doc.toString(), 'A.[^1]\n\n[^1]: Kept.\n');
  cm.destroy();
});

t('with text selected, the footnote goes after what’s cited (not after a space selected with it)', () => {
  const s = 'The Crown in Parliament is sovereign.';
  const view = new EditorView({
    state: EditorState.create({ doc: s, selection: EditorSelection.range(4, 24) }),
    parent: document.body,
  });
  view.coordsAtPos = () => ({ left: 0, top: 0, bottom: 10 });
  const f = feature();
  f.openBox(view);
  document.querySelector('.dr-fn-input').value = 'Cite.';
  key(document.querySelector('.dr-fn-input'), 'Enter');
  assert.strictEqual(view.state.doc.toString(), 'The Crown in Parliament[^1] is sovereign.\n\n[^1]: Cite.\n');
  view.destroy();
});

t('one undo puts it all back', () => {
  const { history, undo } = require('@codemirror/commands');
  const text = 'One.[^1] Two. Three.[^2]\n\n[^1]: One.\n[^2]: Three.\n';
  const view = new EditorView({
    state: EditorState.create({ doc: text, selection: EditorSelection.cursor(13), extensions: [history()] }),
    parent: document.body,
  });
  view.coordsAtPos = () => ({ left: 0, top: 0, bottom: 10 });
  const f = feature();
  f.openBox(view);
  document.querySelector('.dr-fn-input').value = 'Two.';
  key(document.querySelector('.dr-fn-input'), 'Enter');
  assert.notStrictEqual(view.state.doc.toString(), text);
  undo(view);
  assert.strictEqual(view.state.doc.toString(), text);
  view.destroy();
});

t('Put footnotes in order, from the command, says what it did', () => {
  const cm = editor('A.[^2] B.[^1]|\n\n[^1]: One.\n[^2]: Two.\n[^3]: Spare.\n');
  const f = feature();
  notices.length = 0;
  f.tidy(cm);
  assert.strictEqual(cm.state.doc.toString(), 'A.[^1] B.[^2]\n\n[^1]: Two.\n[^2]: One.\n');
  assert.ok(/one no longer used/.test(notices.pop()));
  f.tidy(cm);
  assert.ok(/already in order/.test(notices.pop()));
  cm.destroy();
});

console.log(`${passed} passed`);
