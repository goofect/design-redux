// Superscript and subscript against the real main.js: what's read as
// one, the toggle commands on a real CodeMirror state, the editor's
// decorations in Live Preview and source mode, and reading view.
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
global.CSS = { escape: (s) => s };
dom.window.document.createRange = dom.window.document.createRange;

const { EditorState, EditorSelection, StateField } = require('@codemirror/state');
const { EditorView } = require('@codemirror/view');
const { markdown } = require('@codemirror/lang-markdown');
const { ensureSyntaxTree } = require('@codemirror/language');

// Obsidian's Live Preview switch, as a field the test can set.
const livePreview = StateField.define({ create: () => true, update: (v) => v });

class MarkdownView {}
const menus = [];
class Menu {
  constructor() { this.items = []; }
  addItem(cb) {
    const item = {};
    item.setTitle = (v) => { item.title = v; return item; };
    item.setIcon = (v) => { item.icon = v; return item; };
    item.setSection = (v) => { item.section = v; return item; };
    item.onClick = (f) => { item.click = f; return item; };
    cb(item); this.items.push(item); return this;
  }
}
const obsidian = new Proxy({
  MarkdownView, Menu,
  setIcon: () => {},
  Notice: class {},
  Platform: { isMobile: false },
  editorLivePreviewField: livePreview,
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_scripts_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { scriptSpans, toggleScript, scriptAt, scriptEditorExtension, renderScripts, Scripts, DEFAULTS };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

const read = (text) => R.scriptSpans(text).map((s) => `${s.kind}:${s.syntax}:${text.slice(s.innerFrom, s.innerTo)}`);

/* -- what's read as one --------------------------------------------------- */

t('the short spellings and the tags are read, in any mix', () => {
  assert.deepStrictEqual(read('E = mc^2^ and H~2~O'), ['sup:short:2', 'sub:short:2']);
  assert.deepStrictEqual(read('the 1^st^, 2^nd^ and x<sub>i</sub> and <SUP>n + 1</SUP>'),
    ['sup:short:st', 'sup:short:nd', 'sub:html:i', 'sup:html:n + 1']);
  assert.deepStrictEqual(read('escaped \\^inside^ and a^b\\^c^'), ['sup:short:b\\^c']);
  assert.deepStrictEqual(read('~~H~2~O~~'), ['sub:short:2'], 'a subscript inside strikethrough');
});

t("what isn't: spaces, footnotes, block links, inline notes, strikethrough, maths", () => {
  [
    'x^2 + y^2 = z^2',            // plain-text maths, spaced
    'a footnote[^1] and [^2]: its text',
    'two notes[^1][^2]',
    'a block ^abc123',
    '[[Note#^abc]] and [[Other#^def]]',
    'an inline note^[with text]',
    '~~struck~~ and ~~more~~',
    'about ~5 km, or ~10',
    '$x^2^$ and $H~2~O$',
    'costs $5 and 10^9^ is $10',
    'see https://example.com/~user~/a^b^ for more',
  ].forEach((line, i) => {
    const got = read(line);
    if (i === 9) assert.deepStrictEqual(got, ['sup:short:9'], 'dollar amounts are not maths');
    else assert.deepStrictEqual(got, [], line);
  });
});

/* -- the commands ------------------------------------------------------------- */

/** "«" and "»" mark the selection, or "|" the cursor, before and after. */
function run(text, kind, html = false) {
  let doc = text;
  let anchor;
  let head;
  if (doc.includes('|')) {
    anchor = head = doc.indexOf('|');
    doc = doc.replace('|', '');
  } else {
    anchor = doc.indexOf('«');
    doc = doc.replace('«', '');
    head = doc.indexOf('»');
    doc = doc.replace('»', '');
  }
  let state = EditorState.create({ doc, selection: { anchor, head } });
  state = state.update(R.toggleScript(state, kind, html)).state;
  const out = state.doc.toString();
  const r = state.selection.main;
  if (r.empty) return out.slice(0, r.head) + '|' + out.slice(r.head);
  return out.slice(0, r.from) + '«' + out.slice(r.from, r.to) + '»' + out.slice(r.to);
}

t('wrapping a selection, with the text still selected', () => {
  assert.strictEqual(run('E = mc«2»', 'sup'), 'E = mc^«2»^');
  assert.strictEqual(run('H«2»O', 'sub'), 'H~«2»~O');
  assert.strictEqual(run('H«2»O', 'sub', true), 'H<sub>«2»</sub>O', 'the tags when asked for');
  assert.strictEqual(run('x« 2 »y', 'sup'), 'x ^«2»^ y', 'spaces at the ends stay outside');
});

t("text the short form can't hold gets the tags", () => {
  assert.strictEqual(run('x«n + 1»', 'sup'), 'x<sup>«n + 1»</sup>', 'spaces');
  assert.strictEqual(run('a«[b]»', 'sup'), 'a<sup>«[b]»</sup>', 'brackets');
  assert.strictEqual(run('see «1»', 'sup'), 'see ^«1»^');
  assert.strictEqual(run('[«x»', 'sup'), '[<sup>«x»</sup>', 'after [ it would be a footnote');
  assert.strictEqual(run('a«~b»', 'sub'), 'a<sub>«~b»</sub>');
});

t('with nothing selected, the markers go in around the cursor', () => {
  assert.strictEqual(run('x|', 'sup'), 'x^|^');
  assert.strictEqual(run('H|O', 'sub'), 'H~|~O');
  assert.strictEqual(run('x|', 'sup', true), 'x<sup>|</sup>');
});

t('inside one already, the same command takes it off', () => {
  assert.strictEqual(run('mc^«2»^', 'sup'), 'mc«2»');
  assert.strictEqual(run('mc«^2^»', 'sup'), 'mc«2»', 'with the markers selected too');
  assert.strictEqual(run('mc^2|^ x', 'sup'), 'mc2| x');
  assert.strictEqual(run('x<sup>«n + 1»</sup>', 'sup'), 'x«n + 1»');
});

t('the other command changes one kind into the other', () => {
  assert.strictEqual(run('H^«2»^O', 'sub'), 'H~«2»~O');
  assert.strictEqual(run('x<sup>«n + 1»</sup>', 'sub'), 'x<sub>«n + 1»</sub>');
  assert.strictEqual(run('a~«b»~', 'sup', true), 'a<sup>«b»</sup>');
});

t('several lines, each on its own, and several cursors at once', () => {
  assert.strictEqual(run('«a\n\nb»', 'sup'), '^«a^\n\n^b»^');
  let state = EditorState.create({
    doc: 'x2 y2',
    selection: EditorSelection.create([EditorSelection.range(1, 2), EditorSelection.range(4, 5)]),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  state = state.update(R.toggleScript(state, 'sup', false)).state;
  assert.strictEqual(state.doc.toString(), 'x^2^ y^2^');
  assert.deepStrictEqual(state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)), ['2', '2']);
});

/* -- the editor ------------------------------------------------------------------ */

function editor(doc, cursor, live = true) {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown(), livePreview.init(() => live), R.scriptEditorExtension()],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({}); // let the plugin see the parsed tree
  return view;
}
const shown = (view) => view.contentDOM.textContent;

t('Live Preview: markers hidden and the text raised, until the cursor reaches them', () => {
  const view = editor('E = mc^2^ and H~2~O', 0);
  assert.strictEqual(shown(view), 'E = mc2 and H2O');
  assert.strictEqual(view.contentDOM.querySelector('.dr-sup').textContent, '2');
  assert.strictEqual(view.contentDOM.querySelector('.dr-sub').textContent, '2');
  view.dispatch({ selection: { anchor: 8 } });
  assert.strictEqual(shown(view), 'E = mc^2^ and H2O', 'the markers of the one being edited show');
  assert.ok(view.contentDOM.querySelector('.dr-script-mark'));
  view.destroy();
});

t('source mode: markers shown faintly, text still raised', () => {
  const view = editor('E = mc^2^', 0, false);
  assert.strictEqual(shown(view), 'E = mc^2^');
  assert.strictEqual(view.contentDOM.querySelectorAll('.dr-script-mark').length, 2);
  assert.ok(view.contentDOM.querySelector('.dr-sup'));
  view.destroy();
});

t('tags are raised with their markers faint, never hidden', () => {
  const view = editor('x<sub>i</sub>', 0);
  assert.strictEqual(shown(view), 'x<sub>i</sub>');
  assert.strictEqual(view.contentDOM.querySelector('.dr-sub').textContent, 'i');
  view.destroy();
});

t('code, links and URLs are left as written', () => {
  const view = editor('`a^2^` and [b^2^](https://x.y/~u~) and https://x.y/^a^\n\n```\nc^2^\n```', 0);
  assert.strictEqual(view.contentDOM.querySelectorAll('.dr-sup, .dr-sub').length, 0);
  assert.ok(shown(view).includes('a^2^') && shown(view).includes('c^2^'));
  view.destroy();
});

/* -- reading view ------------------------------------------------------------------ */

const rendered = (html, source) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  R.renderScripts(el, source === undefined ? null : {
    getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: source.split('\n').length - 1 }),
  });
  return el.innerHTML;
};

t('reading view: the short spellings become <sup> and <sub>', () => {
  assert.strictEqual(rendered('<p>E = mc^2^ and H~2~O</p>'),
    '<p>E = mc<sup class="dr-script">2</sup> and H<sub class="dr-script">2</sub>O</p>');
  assert.strictEqual(rendered('<p><strong>1^st^</strong> place</p>'),
    '<p><strong>1<sup class="dr-script">st</sup></strong> place</p>');
});

t("reading view: code, maths, links' addresses and footnotes are left alone", () => {
  const html = '<p><code>a^2^</code> <span class="math">x^2^</span> <a href="https://x.y/~u~">https://x.y/~u~</a> ' +
    '<sup class="footnote-ref">1</sup> <a class="internal-link">note^2^</a></p>';
  const out = rendered(html);
  assert.ok(out.includes('<code>a^2^</code>') && out.includes('x^2^</span>') && out.includes('https://x.y/~u~</a>'));
  assert.ok(out.includes('note<sup class="dr-script">2</sup>'), 'the name of a link is text like any other');
});

t("reading view: one escaped in the note stays flat; without the source it's drawn", () => {
  // The renderer has already taken the backslashes out of what it shows.
  assert.strictEqual(rendered('<p>a^b^ and c^d^</p>', 'a\\^b\\^ and c^d^'),
    '<p>a^b^ and c<sup class="dr-script">d</sup></p>');
  assert.strictEqual(rendered('<p>a^b^</p>', ''), '<p>a<sup class="dr-script">b</sup></p>');
});

/* -- the feature ------------------------------------------------------------------ */

t('commands with icons, for the palette and the phone toolbar; on only while editing', () => {
  const plugin = { settings: JSON.parse(JSON.stringify(R.DEFAULTS)), app: { workspace: {} } };
  const f = new R.Scripts(plugin);
  let active = null;
  plugin.app.workspace.getActiveViewOfType = () => active;
  const cmds = f.commands();
  assert.deepStrictEqual(cmds.map((c) => [c.id, c.name, c.icon]),
    [['superscript', 'Note: Superscript', 'superscript'], ['subscript', 'Note: Subscript', 'subscript']]);
  assert.strictEqual(cmds[0].check(), false, 'no note open');
  const view = editor('mc2', 2);
  view.dispatch({ selection: { anchor: 2, head: 3 } });
  active = Object.assign(new MarkdownView(), { getMode: () => 'preview', editor: { cm: view } });
  assert.strictEqual(cmds[0].check(), false, 'in reading view');
  active.getMode = () => 'source';
  assert.strictEqual(cmds[0].check(), true);
  cmds[0].run();
  assert.strictEqual(view.state.doc.toString(), 'mc^2^');
  plugin.settings.scriptSyntax = 'html';
  cmds[1].run();
  assert.strictEqual(view.state.doc.toString(), 'mc<sub>2</sub>', 'switched, in the tags now asked for');
  plugin.settings.scripts = false;
  assert.strictEqual(cmds[0].check(), false, 'switched off');
  view.destroy();
});

t("the editor's right-click menu: with a selection, or inside one to take it off", () => {
  const plugin = { settings: JSON.parse(JSON.stringify(R.DEFAULTS)), app: { workspace: {} }, registerEvent() {} };
  let handler = null;
  plugin.app.workspace.on = (name, fn) => { if (name === 'editor-menu') handler = fn; return {}; };
  const f = new R.Scripts(plugin);
  f.register();
  const view = editor('mc^2^ and x', 11);
  const open = () => { const m = new Menu(); handler(m, { cm: view }); return m.items.map((i) => i.title); };
  assert.deepStrictEqual(open(), [], 'nothing selected, nothing offered');
  view.dispatch({ selection: { anchor: 3 } });
  assert.deepStrictEqual(open(), ['Remove superscript', 'Subscript']);
  view.dispatch({ selection: { anchor: 10, head: 11 } });
  const m = new Menu();
  handler(m, { cm: view });
  assert.deepStrictEqual(m.items.map((i) => [i.title, i.icon, i.section]),
    [['Superscript', 'superscript', 'selection'], ['Subscript', 'subscript', 'selection']]);
  m.items[1].click();
  assert.strictEqual(view.state.doc.toString(), 'mc^2^ and ~x~');
  view.destroy();
});

t('settings: on by default, the short form by default, and its row shown only while on', () => {
  assert.strictEqual(R.DEFAULTS.scripts, true);
  assert.strictEqual(R.DEFAULTS.scriptSyntax, 'short');
  const rows = new R.Scripts({ settings: {} }).settingsSchema();
  assert.deepStrictEqual(rows.map((r) => [r.key, r.showIf]),
    [['scripts', undefined], ['scriptSyntax', 'scripts'], ['autoOrdinals', 'scripts']]);
  assert.deepStrictEqual(Object.keys(rows[1].options), ['short', 'html']);
});

t('no lookbehind anywhere: iPhones before iOS 16.4 would fail to load the plugin', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(!/\(\?<[!=]/.test(src), 'a regex uses lookbehind');
});

console.log(`\n${passed} passed`);
