// Lettered and roman numeral lists, against the real main.js: the
// letters and numerals, Enter in
// a real CodeMirror state, the editor's decorations in a real
// EditorView, and the reading-view conversion in jsdom.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const virtualConsole = dom.virtualConsole;
virtualConsole.removeAllListeners('jsdomError'); // canvas "not implemented"
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.MutationObserver = dom.window.MutationObserver;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (f) => setTimeout(f, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.CSS = { escape: (s) => s };
dom.window.document.createRange = dom.window.document.createRange || (() => ({}));

class MarkdownView {}
const obsidian = new Proxy({
  MarkdownView,
  setIcon: () => {},
  Notice: class {},
  Platform: { isMobile: false, isPhone: false },
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_lists_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { toRoman, fromRoman, toAlpha, fromAlpha, parseListItem, ' +
  'listEnter, renderLists, listEditorExtensions, MarkedLists, LIST_KINDS };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);
const { EditorState } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

/* -- numerals -------------------------------------------------------- */

t('every numeral from 1 to 3999 reads back as itself', () => {
  for (let n = 1; n <= 3999; n++) {
    assert.strictEqual(R.fromRoman(R.toRoman(n)), n);
    assert.strictEqual(R.fromRoman(R.toRoman(n).toUpperCase()), n);
  }
  assert.strictEqual(R.toRoman(1994), 'mcmxciv');
});

t('only numerals written the standard way count', () => {
  ['iiii', 'vx', 'iiv', 'Iv', 'vV', 'mmmm', '', 'ic', 'xm'].forEach((s) =>
    assert.strictEqual(R.fromRoman(s), 0, s));
});

t('the three marker shapes, in either case, at any indent', () => {
  const a = R.parseListItem('iv. Fourth point', null);
  assert.deepStrictEqual([a.value, a.style, a.upper, a.marker, a.content], [4, 'dot', false, 'iv.', 'Fourth point']);
  const b = R.parseListItem('IX) Ninth', null);
  assert.deepStrictEqual([b.value, b.style, b.upper, b.marker], [9, 'paren', true, 'IX)']);
  const c = R.parseListItem('\t(ii) nested', null);
  assert.deepStrictEqual([c.value, c.style, c.indent, c.marker, c.prefix], [2, 'wrap', '\t', '(ii)', 6]);
});

t("names, words and half-markers aren't items", () => {
  ['I. M. Pei designed it', 'C. S. Lewis wrote', 'V. S. Naipaul', 'D. H. Lawrence',
    'iv.no space', 'Iv. mixed case', 'viii', 'it. is', 'did. it']
    .forEach((s) => assert.strictEqual(R.parseListItem(s, null), null, s));
});

t('40 and over is an item only when it continues a list', () => {
  ['l. fifty', 'xl. forty', 'mix. of letters', 'cd) drive', 'C. hundredth', 'mi. amigo']
    .forEach((s) => assert.strictEqual(R.parseListItem(s, null), null, s));
  const numeral = (value, upper = false) => ({ kind: 'roman', value, upper, style: 'dot' });
  assert.strictEqual(R.parseListItem('l. fifty', numeral(49)).value, 50);
  assert.strictEqual(R.parseListItem('C. hundredth', () => numeral(99, true)).value, 100);
  assert.strictEqual(R.parseListItem('xl. forty', numeral(38)), null, 'skipped a number');
  assert.strictEqual(R.parseListItem('L. fifty', numeral(49)), null, 'case changed');
  assert.strictEqual(R.parseListItem('xxxix. thirty-nine', null).value, 39);
  assert.strictEqual(R.parseListItem('x. ten', null).value, 10);
});


/* -- Enter ------------------------------------------------------------- */

/** "|" marks the cursor, before and after. */
function press(text) {
  const pos = text.indexOf('|');
  const view = {
    state: EditorState.create({ doc: text.replace('|', ''), selection: { anchor: pos } }),
    composing: false,
    dispatch(spec) { this.state = this.state.update(spec).state; },
  };
  const handled = R.listEnter(view);
  const out = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return { handled, text: out.slice(0, head) + '|' + out.slice(head) };
}

t('Enter continues with the next numeral, in the same style', () => {
  assert.deepStrictEqual(press('i. First|'), { handled: true, text: 'i. First\nii. |' });
  assert.strictEqual(press('III. Third|').text, 'III. Third\nIV. |');
  assert.strictEqual(press('viii) eighth|').text, 'viii) eighth\nix) |');
  assert.strictEqual(press('(xxxix) a|').text, '(xxxix) a\n(xl) |');
  assert.strictEqual(press('xxxix. a\nxl. b|').text, 'xxxix. a\nxl. b\nxli. |');
});

t('Enter keeps the indent of a nested list', () => {
  assert.strictEqual(press('1. Top\n   ii. sub|').text, '1. Top\n   ii. sub\n   iii. |');
  assert.strictEqual(press('\t\ti. deep|').text, '\t\ti. deep\n\t\tii. |');
});

t('Enter in the middle of an item takes the rest with it', () => {
  assert.strictEqual(press('i. hello| world').text, 'i. hello\nii. |world');
});

t('Enter on an empty item ends the list', () => {
  assert.deepStrictEqual(press('i. a\nii. |'), { handled: true, text: 'i. a\n|' });
  assert.strictEqual(press('   iv) |').text, '   |');
});

t('the items after an insertion are renumbered', () => {
  assert.strictEqual(press('i. a|\nii. b\niii. c').text, 'i. a\nii. |\niii. b\niv. c');
  // Across a blank line and a line continuing an item; past nested lines.
  assert.strictEqual(
    press('I. a|\nII. b\ncontinues b\n\nIII. c\n    - nested\nIV. d').text,
    'I. a\nII. |\nIII. b\ncontinues b\n\nIV. c\n    - nested\nV. d'
  );
});

t('renumbering stops where the list does', () => {
  // A different style, two blank lines, or text after a gap.
  assert.strictEqual(press('i. a|\n(ii) b').text, 'i. a\nii. |\n(ii) b');
  assert.strictEqual(press('i. a|\n\n\nii. b').text, 'i. a\nii. |\n\n\nii. b');
  assert.strictEqual(press('i. a|\n\nA paragraph.\nii. b').text, 'i. a\nii. |\n\nA paragraph.\nii. b');
});

t("anything that isn't a roman item is left to Obsidian", () => {
  ['Plain text|', '1. numbered|', 'I. M. Pei|', '|i. before the marker', 'i|. inside it']
    .forEach((s) => assert.strictEqual(press(s).handled, false, s));
  // A selection, rather than a cursor.
  const view = {
    state: EditorState.create({ doc: 'i. abc', selection: { anchor: 3, head: 5 } }),
    dispatch() { throw new Error('changed'); },
  };
  assert.strictEqual(R.listEnter(view), false);
});

t("Vim's normal mode and composing text are left alone", () => {
  const make = (extra) => Object.assign({
    state: EditorState.create({ doc: 'i. a', selection: { anchor: 4 } }),
    dispatch() { throw new Error('changed'); },
  }, extra);
  assert.strictEqual(R.listEnter(make({ cm: { state: { vim: { insertMode: false } } } })), false);
  assert.strictEqual(R.listEnter(make({ composing: true })), false);
});

/* -- the editor's styling ----------------------------------------------- */

t('item lines get a hanging indent and a coloured numeral in the editor', () => {
  document.body.innerHTML = '';
  const exts = R.listEditorExtensions();
  const view = new EditorView({
    state: EditorState.create({ doc: 'Intro\ni. one\n  (ii) two\nI. M. Pei', extensions: exts }),
    parent: document.body,
  });
  const found = [];
  view.plugin(exts[1]).decorations.between(0, view.state.doc.length, (from, to, deco) => {
    found.push([view.state.doc.sliceString(from, to), deco.spec.class]);
  });
  assert.deepStrictEqual(found, [
    ['', 'dr-marked-line'], ['i.', 'dr-list-marker'],
    ['', 'dr-marked-line'], ['(ii)', 'dr-list-marker'],
  ]);
  const lines = view.contentDOM.querySelectorAll('.cm-line.dr-marked-line');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0].getAttribute('style'), /--dr-list-hang: [\d.]+px/);
  view.destroy();
});

/* -- reading view ----------------------------------------------------- */

const render = (html) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  R.renderLists(el);
  return el;
};
const items = (list) => Array.from(list.querySelectorAll(':scope > li')).map((li) => [
  li.getAttribute('value'),
  li.querySelector('.dr-list-marker').textContent,
  li.innerHTML.replace(/<span class="dr-list-marker">[^<]*<\/span>/, '').trim(),
]);

t('a paragraph of roman lines becomes a list, numerals as written', () => {
  const el = render('<p>i. First<br>\nii. Second<br>\niv. Fourth</p>');
  assert.strictEqual(el.querySelector('p'), null);
  const ol = el.querySelector('ol.dr-marked-list');
  assert.deepStrictEqual(items(ol), [['1', 'i.', 'First'], ['2', 'ii.', 'Second'], ['4', 'iv.', 'Fourth']]);
  assert.match(ol.getAttribute('style'), /--dr-list-gutter/);
});

t('an item on its own, as blank-line lists render, is a list of one', () => {
  const el = render('<p>III. Methods</p>');
  assert.deepStrictEqual(items(el.querySelector('ol')), [['3', 'III.', 'Methods']]);
  assert.ok(el.querySelector('ol').classList.contains('is-upper'));
});

t('text before the list stays a paragraph, and the list follows it', () => {
  const el = render('<p>Consider:<br>\n(i) this<br>\n(ii) that</p>');
  assert.strictEqual(el.querySelector('p').textContent.trim(), 'Consider:');
  assert.strictEqual(el.querySelector('p').nextElementSibling.tagName, 'OL');
  assert.deepStrictEqual(items(el.querySelector('ol')).map((i) => i[1]), ['(i)', '(ii)']);
});

t('a line after an item continues it', () => {
  const el = render('<p>i. a<br>\nmore of a<br>\nii. b</p>');
  const li = el.querySelectorAll('li');
  assert.strictEqual(li.length, 2);
  assert.match(li[0].innerHTML, /a<br>\s*more of a/);
});

t('formatting, links and the spaces between them survive', () => {
  const el = render('<p>i. <strong>bold</strong> <a href="x">link</a> end</p>');
  const li = el.querySelector('li');
  assert.strictEqual(li.textContent, 'i.bold link end');
  assert.ok(li.querySelector('strong') && li.querySelector('a'));
});

t('roman lines under a list item become a list inside it', () => {
  const el = render('<ol><li>Top<br>\ni. sub one<br>\nii. sub two<ul><li>deeper</li></ul></li></ol>');
  const top = el.querySelector('ol > li');
  const kids = Array.from(top.children).map((c) => c.tagName + (c.className ? '.' + c.className.split(' ')[0] : ''));
  assert.deepStrictEqual(kids, ['OL.dr-marked-list', 'UL']);
  assert.strictEqual(top.firstChild.textContent, 'Top');
  assert.deepStrictEqual(items(top.querySelector('.dr-marked-list')).map((i) => i[2]), ['sub one', 'sub two']);
});

t("a bullet that starts with a numeral stays a bullet", () => {
  const html = '<ul><li><span class="list-bullet"></span>i. not a sublist</li></ul>';
  assert.strictEqual(render(html).innerHTML, html);
});

t('a numeral in bold, a name, or code is left as written', () => {
  ['<p><strong>i.</strong> bold marker</p>', '<p>I. M. Pei designed it</p>',
    '<pre><code>i. in code</code></pre>', '<p>Plain text</p>']
    .forEach((html) => assert.strictEqual(render(html).innerHTML, html, html));
});

t('a change of style starts a new list', () => {
  const el = render('<p>i. a<br>\nii. b<br>\nI. c</p>');
  assert.strictEqual(el.querySelectorAll('ol.dr-marked-list').length, 2);
});

/* -- the feature ---------------------------------------------------------- */

t('switching it off and on takes effect in open notes and editors', () => {
  const calls = { options: 0, rerendered: 0 };
  let extensions = null;
  let processor = null;
  const view = Object.create(MarkdownView.prototype);
  view.previewMode = { rerender: (full) => { if (full) calls.rerendered++; } };
  const plugin = {
    settings: { romanLists: true, letterLists: true },
    app: { workspace: {
      updateOptions: () => calls.options++,
      iterateAllLeaves: (fn) => fn({ view }),
    } },
    registerEditorExtension: (e) => { extensions = e; },
    registerMarkdownPostProcessor: (fn) => { processor = fn; },
  };
  const feature = new R.MarkedLists(plugin);
  feature.registerTypes();

  feature.enable();
  assert.strictEqual(extensions.length, 1);
  assert.strictEqual(calls.rerendered, 0, 'first load needs no redraw');
  feature.enable();
  assert.strictEqual(calls.options, 1, 'enable ran twice');

  // One kind off: still on, redrawn for what's now recognised.
  plugin.settings.letterLists = false;
  feature.enable();
  assert.strictEqual(R.LIST_KINDS.alpha, false);
  assert.strictEqual(calls.rerendered, 1);
  assert.strictEqual(extensions.length, 1);
  const letters = document.createElement('div');
  letters.innerHTML = '<p>a. not a list now</p>';
  processor(letters);
  assert.ok(letters.querySelector('p'), 'letters converted with lettered lists off');

  plugin.settings.romanLists = false;
  feature.disable();
  assert.strictEqual(extensions.length, 0);
  assert.strictEqual(calls.rerendered, 2);
  const el = document.createElement('div');
  el.innerHTML = '<p>i. a</p>';
  processor(el);
  assert.ok(el.querySelector('p'), 'converted while switched off');

  plugin.settings.romanLists = true;
  plugin.settings.letterLists = true;
  feature.enable();
  processor(el);
  assert.ok(el.querySelector('ol.dr-marked-list'));
  assert.strictEqual(calls.rerendered, 3);
  assert.strictEqual(R.LIST_KINDS.alpha, true);
});

t('a long list is followed past xxxix, in the editor and in reading view', () => {
  const lines = [];
  for (let n = 1; n <= 45; n++) lines.push(`${R.toRoman(n)}. item ${n}`);
  const last = press(lines.join('\n') + '|');
  assert.ok(last.handled);
  assert.ok(last.text.endsWith('xlv. item 45\nxlvi. |'));
  // Inserting before xxxix renumbers through the forties.
  const mid = press(lines.slice(0, 42).join('\n').replace('item 38', 'item 38|'));
  assert.ok(mid.text.includes('xxxviii. item 38\nxxxix. |\nxl. item 39\nxli. item 40'), mid.text.slice(-120));
  assert.ok(mid.text.endsWith('xliii. item 42'), 'stopped renumbering at forty');
  const el = render('<p>' + lines.join('<br>\n') + '</p>');
  assert.strictEqual(el.querySelectorAll('li').length, 45);
});


/* -- letters -------------------------------------------------------------- */

t('letters run a to z, then aa, ab… and read back as themselves', () => {
  for (let n = 1; n <= 18278; n++) assert.strictEqual(R.fromAlpha(R.toAlpha(n)), n);
  assert.deepStrictEqual([1, 26, 27, 28, 52, 53, 702].map(R.toAlpha), ['a', 'z', 'aa', 'ab', 'az', 'ba', 'zz']);
  assert.strictEqual(R.fromAlpha('Ab'), 0);
});

const P = (text, prev) => {
  const item = R.parseListItem(text, prev);
  return item && [item.kind, item.value];
};

t('a list of letters starts at a, and each letter follows the one before', () => {
  assert.deepStrictEqual(P('a. first', null), ['alpha', 1]);
  assert.deepStrictEqual(P('A) First', null), ['alpha', 1]);
  assert.deepStrictEqual(P('(a) first', null), ['alpha', 1]);
  assert.strictEqual(P('b. second', null), null, 'a list starting at b');
  const a = R.parseListItem('a. first', null);
  assert.deepStrictEqual(P('b. second', a), ['alpha', 2]);
  assert.strictEqual(P('c. skipped b', a), null);
  assert.strictEqual(P('B. case changed', a), null);
  assert.strictEqual(P('b) punctuation changed', a), null);
});

t('i, v, x, c, d and m are letters or numerals by what came before', () => {
  const chain = (texts) => texts.reduce((prev, t) => R.parseListItem(t, prev), null);
  const h = chain(['a. x', 'b. x', 'c. x', 'd. x', 'e. x', 'f. x', 'g. x', 'h. x']);
  assert.deepStrictEqual(P('i. ninth letter', h), ['alpha', 9]);
  assert.deepStrictEqual(P('i. on its own', null), ['roman', 1]);
  const iv = R.parseListItem('iv. x', null);
  assert.deepStrictEqual(P('v. five', iv), ['roman', 5]);
  const u = chain('abcdefghijklmnopqrstu'.split('').map((l) => `${l}. x`));
  assert.deepStrictEqual(P('v. the letter', u), ['alpha', 22]);
  const b = chain(['a. x', 'b. x']);
  assert.deepStrictEqual(P('c. third letter', b), ['alpha', 3]);
  assert.strictEqual(P('c. alone', null), null);
  const k = chain('abcdefghijk'.split('').map((l) => `${l}. x`));
  assert.deepStrictEqual(P('l. twelfth', k), ['alpha', 12]);
});

t("words, abbreviations and names aren't items", () => {
  ['etc. and so on', 'vs. them', 'p. 12', 'c. 1900', 'J. Smith said', 'A. B. Smith',
    'Dr. Who', 'OK. then', 'no. 5', 'e.g. this', 'ok.no space']
    .forEach((s) => assert.strictEqual(R.parseListItem(s, null), null, s));
});

t('Enter continues a lettered list', () => {
  assert.deepStrictEqual(press('a. First|'), { handled: true, text: 'a. First\nb. |' });
  assert.strictEqual(press('A) First|').text, 'A) First\nB) |');
  assert.strictEqual(press('(a) x\n(b) y|').text, '(a) x\n(b) y\n(c) |');
  const toH = 'abcdefgh'.split('').map((l) => `${l}. x`).join('\n');
  assert.strictEqual(press(toH + '|').text, toH + '\ni. |');
  assert.strictEqual(press(toH + '\ni. x|').text, toH + '\ni. x\nj. |');
  const toZ = 'abcdefghijklmnopqrstuvwxyz'.split('').map((l) => `${l}. x`).join('\n');
  assert.strictEqual(press(toZ + '|').text, toZ + '\naa. |');
});

t('a letter after a blank line still counts on', () => {
  assert.strictEqual(press('a. x\n\nb. y|').text, 'a. x\n\nb. y\nc. |');
  assert.strictEqual(press('a. x\nmore of x\n\nb. y|').text, 'a. x\nmore of x\n\nb. y\nc. |');
  // A paragraph between is not the list.
  assert.strictEqual(press('a. x\n\nA paragraph.\n\nb. y|').handled, false);
});

t('inserting a letter renumbers the rest, through i', () => {
  const list = 'abcdefghij'.split('').map((l) => `${l}. item ${l}`);
  const out = press(list.join('\n').replace('item g', 'item g|')).text;
  assert.ok(out.includes('g. item g\nh. |\ni. item h\nj. item i\nk. item j'), out);
});

t('a numbered list with lettered and roman levels under it', () => {
  const doc = '1. Top\n   a. sub\n      i. deeper|';
  assert.strictEqual(press(doc).text, '1. Top\n   a. sub\n      i. deeper\n      ii. |');
  assert.strictEqual(press('1. Top\n   a. sub|\n      i. deeper').text,
    '1. Top\n   a. sub\n   b. |\n      i. deeper');
});

t('with lettered lists off, letters are left alone and numerals still work', () => {
  R.LIST_KINDS.alpha = false;
  try {
    assert.strictEqual(press('a. x|').handled, false);
    assert.strictEqual(press('i. x|').text, 'i. x\nii. |');
    assert.strictEqual(render('<p>a. x<br>\nb. y</p>').querySelector('ol'), null);
  } finally {
    R.LIST_KINDS.alpha = true;
  }
});

t('reading view: letters, with i as the ninth one where it follows h', () => {
  const src = 'abcdefghij'.split('').map((l) => `${l}. item ${l}`);
  const el = render('<p>' + src.join('<br>\n') + '</p>');
  const ol = el.querySelectorAll('ol.dr-marked-list');
  assert.strictEqual(ol.length, 1, 'split at i');
  assert.ok(ol[0].classList.contains('is-alpha'));
  assert.deepStrictEqual(items(ol[0]).map((i) => i[0]), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
});

t('reading view: items apart, one per paragraph, count on from the source', () => {
  const source = 'A. Introduction\n\nB. Methods\n\nC. Results';
  const section = (html, lineStart) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    R.renderLists(el, { getSectionInfo: () => ({ text: source, lineStart, lineEnd: lineStart }) });
    return el;
  };
  assert.deepStrictEqual(items(section('<p>A. Introduction</p>', 0).querySelector('ol')).map((i) => i[0]), ['1']);
  assert.deepStrictEqual(items(section('<p>B. Methods</p>', 2).querySelector('ol')).map((i) => i[0]), ['2']);
  assert.deepStrictEqual(items(section('<p>C. Results</p>', 4).querySelector('ol')).map((i) => i[0]), ['3']);
  // Without the source, a lone B. can't know it follows A.
  const bare = document.createElement('div');
  bare.innerHTML = '<p>B. Methods</p>';
  R.renderLists(bare, null);
  assert.strictEqual(bare.querySelector('ol'), null);
});

t('reading view: roman past xxxix one per paragraph, now that the source is read', () => {
  const lines = [];
  for (let n = 1; n <= 42; n++) lines.push(`${R.toRoman(n)}. item`);
  const source = lines.join('\n\n');
  const el = document.createElement('div');
  el.innerHTML = '<p>xlii. item</p>';
  R.renderLists(el, { getSectionInfo: () => ({ text: source, lineStart: 82, lineEnd: 82 }) });
  assert.deepStrictEqual(items(el.querySelector('ol')).map((i) => i[1]), ['xlii.']);
});

t('the editor colours letters too', () => {
  document.body.innerHTML = '';
  const exts = R.listEditorExtensions();
  const view = new EditorView({
    state: EditorState.create({ doc: 'a. one\nb. two\nJ. Smith said', extensions: exts }),
    parent: document.body,
  });
  const found = [];
  view.plugin(exts[1]).decorations.between(0, view.state.doc.length, (from, to, deco) => {
    if (deco.spec.class === 'dr-list-marker') found.push(view.state.doc.sliceString(from, to));
  });
  assert.deepStrictEqual(found, ['a.', 'b.']);
  view.destroy();
});

console.log(`\n${passed} passed`);
