// Property filters in the graph, against the real main.js: a graph
// view's settings panel in Obsidian's markup, with a search field that
// records what the graph is told.
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
global.Event = dom.window.Event;
global.MutationObserver = dom.window.MutationObserver;
global.navigator = dom.window.navigator;
global.CSS = { escape: (s) => s };

const P = dom.window.HTMLElement.prototype;
const apply = (el, o) => {
  if (!o) return el;
  if (typeof o === 'string') { el.className = o; return el; }
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text !== undefined) el.textContent = o.text;
  if (o.type) el.setAttribute('type', o.type);
  return el;
};
P.createEl = function (tag, o) { return apply(this.appendChild(document.createElement(tag)), o); };
P.createDiv = function (o) { return this.createEl('div', o); };
P.createSpan = function (o) { return this.createEl('span', o); };
P.addClass = function (...c) { this.classList.add(...c); };
P.removeClass = function (...c) { this.classList.remove(...c); };
P.toggleClass = function (c, on) { this.classList.toggle(c, !!on); };
P.hasClass = function (c) { return this.classList.contains(c); };
P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
P.setText = function (t) { this.textContent = t; };

const obsidian = new Proxy({
  setIcon: (el, name) => { el.dataset.icon = name; },
  Platform: { isMobile: false },
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_graph_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { GraphPropertyFilter, graphClause, graphTerm, searchWithout, propertyValues, quietLabel, splitQuiet, quietMatches, quietRefs, linkAtCursor, toggledLink, settleQuietLinks, unsettleQuietLinks, quietSpans, portableSpans, rewriteSpans, strayLinkpath, renameQuietLinksIn, quietPointsAt, QuietLinkSuggest, QuietLinks, quietLinksIn, quietHint };\n');
const G = require(tmp).__test;
fs.unlinkSync(tmp);

/* -- a vault and a graph --------------------------------------------- */

const notes = [
  { path: 'a.md', fm: { domain: 'Politics', status: 'done' } },
  { path: 'b.md', fm: { domain: 'Politics', tags: ['x'] } },
  { path: 'c.md', fm: { Domain: 'Political theory' } },
  { path: 'd.md', fm: { domain: ['Law', '[[Politics]]'] } },
  { path: 'e.md', fm: null },
];

function graphLeaf(type = 'graph', search = '') {
  const containerEl = document.body.createDiv({ cls: 'workspace-leaf-content' });
  const controls = containerEl.createDiv({ cls: 'graph-controls' });
  const filter = controls.createDiv({ cls: 'tree-item graph-control-section mod-filter' });
  const input = filter.createDiv({ cls: 'tree-item-children' }).createEl('input', { type: 'search' });
  input.value = search;
  controls.createDiv({ cls: 'tree-item graph-control-section mod-color-groups' });
  controls.createDiv({ cls: 'tree-item graph-control-section mod-display' });
  const told = [];
  input.addEventListener('input', () => told.push(input.value));
  return { leaf: { view: { getViewType: () => type, containerEl } }, controls, input, told };
}

function feature(leaves, graphFilters = {}) {
  const saves = [];
  const plugin = {
    settings: { graphProperties: true, graphFilters },
    saveData: (s) => saves.push(JSON.parse(JSON.stringify(s.graphFilters))),
    app: {
      workspace: { iterateAllLeaves: (fn) => leaves.forEach((l) => fn(l.leaf)) },
      metadataTypeManager: {
        getAllProperties: () => ({
          domain: { name: 'domain', occurrences: 4 },
          status: { name: 'status', occurrences: 1 },
          tags: { name: 'tags', occurrences: 1 },
        }),
      },
      vault: { getMarkdownFiles: () => notes },
      metadataCache: { getFileCache: (f) => (f.fm ? { frontmatter: f.fm } : null) },
    },
  };
  const f = new G.GraphPropertyFilter(plugin);
  return { f, plugin, saves };
}

const section = (g) => g.controls.querySelector('.dr-graph-props');
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const choose = (select, value) => {
  select.value = value;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};
const addRule = (g) => click(section(g).querySelector('.dr-gp-add'));
const rules = (g) => Array.from(section(g).querySelectorAll('.dr-gp-rule'));

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  await t('conditions become the search terms Obsidian reads', () => {
    assert.strictEqual(G.graphTerm({ key: 'domain', op: 'is', value: 'Politics' }), '[domain:Politics]');
    assert.strictEqual(G.graphTerm({ key: 'domain', op: 'not', value: 'Law' }), '-[domain:Law]');
    assert.strictEqual(G.graphTerm({ key: 'domain', op: 'has' }), '[domain]');
    assert.strictEqual(G.graphTerm({ key: 'domain', op: 'lacks' }), '-[domain]');
    assert.strictEqual(G.graphTerm({ key: 'domain', op: 'is', value: 'Political theory' }), '[domain:"Political theory"]');
    assert.strictEqual(G.graphTerm({ key: 'due date', op: 'has' }), '["due date"]');
    assert.strictEqual(G.graphTerm({ key: 'domain', op: 'is', value: '  ' }), '', 'incomplete');
    assert.strictEqual(G.graphTerm({ key: '', op: 'has' }), '', 'no property');
  });

  await t('all of them side by side, any of them joined with OR', () => {
    const r = [{ key: 'domain', op: 'is', value: 'Law' }, { key: 'status', op: 'has' }];
    assert.strictEqual(G.graphClause({ mode: 'all', rules: r }), '[domain:Law] [status]');
    assert.strictEqual(G.graphClause({ mode: 'any', rules: r }), '([domain:Law] OR [status])');
    assert.strictEqual(G.graphClause({ mode: 'any', rules: r.slice(0, 1) }), '[domain:Law]');
  });

  await t("a property's values, from every note, most used first", () => {
    const values = G.propertyValues({
      vault: { getMarkdownFiles: () => notes },
      metadataCache: { getFileCache: (f) => (f.fm ? { frontmatter: f.fm } : null) },
    }, 'domain');
    assert.deepStrictEqual(values, ['Politics', 'Law', 'Political theory']);
  });

  await t('the section sits after Filters in the graph panel, folded like it', () => {
    document.body.innerHTML = '';
    const g = graphLeaf();
    const { f } = feature([g]);
    f.sync();
    const s = section(g);
    assert.ok(s, 'not added');
    assert.ok(s.previousElementSibling.classList.contains('mod-filter'));
    assert.strictEqual(s.querySelector('.graph-control-section-header').textContent, 'Properties');
    click(s.querySelector('.dr-graph-props-head'));
    assert.ok(s.classList.contains('is-collapsed'));
    f.sync();
    assert.strictEqual(g.controls.querySelectorAll('.dr-graph-props').length, 1, 'added twice');
  });

  await t('choosing a property and value filters the graph', () => {
    document.body.innerHTML = '';
    const g = graphLeaf();
    const { f, saves } = feature([g]);
    f.sync();
    addRule(g);
    const [rule] = rules(g);
    choose(rule.querySelector('.dr-gp-key'), 'domain');
    type(rules(g)[0].querySelector('.dr-gp-value'), 'Politics');
    assert.strictEqual(g.input.value, '[domain:Politics]');
    assert.strictEqual(g.told[g.told.length - 1], '[domain:Politics]', 'the graph was not told');
    assert.strictEqual(section(g).querySelector('.dr-gp-count').textContent, '1');
    assert.strictEqual(saves[saves.length - 1].graph.clause, '[domain:Politics]');
  });

  await t('what was typed in the filter stays, and the conditions follow it', () => {
    document.body.innerHTML = '';
    const g = graphLeaf('graph', 'path:Notes');
    const { f } = feature([g]);
    f.sync();
    addRule(g);
    choose(rules(g)[0].querySelector('.dr-gp-key'), 'domain');
    type(rules(g)[0].querySelector('.dr-gp-value'), 'Law');
    assert.strictEqual(g.input.value, 'path:Notes [domain:Law]');
    type(rules(g)[0].querySelector('.dr-gp-value'), 'Political theory');
    assert.strictEqual(g.input.value, 'path:Notes [domain:"Political theory"]');
    click(rules(g)[0].querySelector('.dr-gp-remove'));
    assert.strictEqual(g.input.value, 'path:Notes');
  });

  await t('two conditions, matched all or any', () => {
    document.body.innerHTML = '';
    const g = graphLeaf();
    const { f } = feature([g]);
    f.sync();
    addRule(g);
    choose(rules(g)[0].querySelector('.dr-gp-key'), 'domain');
    type(rules(g)[0].querySelector('.dr-gp-value'), 'Law');
    addRule(g);
    choose(rules(g)[1].querySelector('.dr-gp-key'), 'status');
    choose(rules(g)[1].querySelector('.dr-gp-op'), 'has');
    assert.ok(rules(g)[1].classList.contains('is-valueless'));
    assert.strictEqual(g.input.value, '[domain:Law] [status]');
    choose(section(g).querySelector('.dr-gp-mode'), 'any');
    assert.strictEqual(g.input.value, '([domain:Law] OR [status])');
  });

  await t('a condition with no value yet changes nothing', () => {
    document.body.innerHTML = '';
    const g = graphLeaf('graph', 'tag:#x');
    const { f } = feature([g]);
    f.sync();
    addRule(g);
    choose(rules(g)[0].querySelector('.dr-gp-key'), 'domain');
    assert.strictEqual(g.input.value, 'tag:#x');
    assert.deepStrictEqual(g.told, []);
  });

  await t('reopened, the conditions come back while the search still holds them', () => {
    document.body.innerHTML = '';
    const saved = { graph: { mode: 'all', rules: [{ key: 'domain', op: 'is', value: 'Law' }], clause: '[domain:Law]', open: true } };
    const kept = graphLeaf('graph', 'path:X [domain:Law]');
    feature([kept], saved).f.sync();
    assert.strictEqual(rules(kept).length, 1);
    assert.strictEqual(rules(kept)[0].querySelector('.dr-gp-value').value, 'Law');

    // Cleared by hand, or by the panel's reset: the conditions go with it.
    const cleared = graphLeaf('graph', 'path:X');
    feature([cleared], saved).f.sync();
    assert.strictEqual(rules(cleared).length, 0);
  });

  await t('put back when the panel is rebuilt', async () => {
    document.body.innerHTML = '';
    const g = graphLeaf();
    const { f } = feature([g]);
    f.sync();
    section(g).remove();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(section(g), 'not put back');
  });

  await t('local graphs get it too; other views are left alone', () => {
    document.body.innerHTML = '';
    const local = graphLeaf('localgraph');
    const other = graphLeaf('markdown');
    feature([local, other]).f.sync();
    assert.ok(section(local));
    assert.strictEqual(section(other), null);
  });

  await t('switched off, the section goes', () => {
    document.body.innerHTML = '';
    const g = graphLeaf();
    const { f, plugin } = feature([g]);
    f.sync();
    plugin.settings.graphProperties = false;
    f.disable();
    assert.strictEqual(section(g), null);
  });

  await t("the search is left as the user's own when they've edited the clause", () => {
    assert.strictEqual(G.searchWithout('path:X [domain:Law]', '[domain:Law]'), 'path:X');
    assert.strictEqual(G.searchWithout('path:X [domain:Lawyers]', '[domain:Law]'), 'path:X [domain:Lawyers]');
    assert.strictEqual(G.searchWithout('', ''), '');
  });

  await t('an open graph follows a property renamed across the vault, search and all', () => {
    document.body.innerHTML = '';
    const g = graphLeaf('graph', 'path:IR [domain:Law] [status]');
    const { f, plugin } = feature([g], {
      graph: { mode: 'all', rules: [{ key: 'domain', op: 'is', value: 'Law' }, { key: 'status', op: 'has' }], clause: '[domain:Law] [status]', open: true },
    });
    f.sync();
    f.renameProperty('Domain', 'field');
    assert.strictEqual(g.input.value, 'path:IR [field:Law] [status]');
    assert.strictEqual(plugin.settings.graphFilters.graph.rules[0].key, 'field');
    assert.strictEqual(rules(g)[0].querySelector('.dr-gp-key').value, 'field', 'the row still shows the old name');
  });

  await t('a graph opened after the rename rewrites its search to match', () => {
    document.body.innerHTML = '';
    // Saved while closed: the conditions renamed, the search not yet.
    const g = graphLeaf('graph', '[domain:Law]');
    const { f } = feature([g], {
      graph: { mode: 'all', rules: [{ key: 'field', op: 'is', value: 'Law' }], clause: '[domain:Law]', open: true },
    });
    f.sync();
    assert.strictEqual(g.input.value, '[field:Law]');
    // An untouched graph isn't rewritten.
    const h = graphLeaf('localgraph', 'x [status]');
    feature([h], { localgraph: { mode: 'all', rules: [{ key: 'status', op: 'has' }], clause: '[status]', open: true } }).f.sync();
    assert.deepStrictEqual(h.told, []);
  });

  /* -- quiet links ------------------------------------------------------------ */

  await t('[[[Note]]] is found — back to back too — read for its target, heading and words, and switched with [[Note]]', () => {
    const found = G.quietMatches('[[[A]]][[[B|b]]] and [[[[C]]]] and [[D]] and [[[E#F]]]').map((q) => q.inner);
    assert.deepStrictEqual(found, ['A', 'B|b', 'E#F'], 'four brackets or two are not quiet links');
    assert.deepStrictEqual(G.splitQuiet('Balance of power#x|the balance'),
      { target: 'Balance of power#x', path: 'Balance of power', subpath: '#x', words: 'the balance' });
    assert.strictEqual(G.quietLabel('Ideas/Entropy', ''), 'Ideas/Entropy', 'shown other than as written');
    assert.strictEqual(G.quietLabel('Entropy#Heat death', ''), 'Entropy > Heat death');
    assert.strictEqual(G.quietLabel('Entropy', ' disorder '), 'disorder');
    const editor = (line, ch) => ({ getCursor: () => ({ line: 0, ch }), getLine: () => line });
    assert.strictEqual(G.toggledLink(G.linkAtCursor(editor('See [[Entropy]] now', 8))), '[[[Entropy]]]');
    assert.strictEqual(G.toggledLink(G.linkAtCursor(editor('See [[[Order|chaos]]] now', 9))), '[[Order|chaos]]');
    assert.strictEqual(G.linkAtCursor(editor('no link here', 3)), null);
  });

  await t("what Obsidian makes of a quiet link — a missing \"[Name\" — is read back as the note it names", () => {
    const refs = G.quietRefs({
      links: [
        { link: '[Anarchy', original: '[[[Anarchy]]' },
        { link: '[Balance of power#x', original: '[[[Balance of power#x]]' },
        { link: 'Realism', original: '[[Realism]]' },
        { link: '[Anarchy', original: '[[[[Anarchy]]' },
      ],
      frontmatterLinks: [{ key: 'related', link: '[Realism]', original: '[[[Realism]]]' }],
    });
    assert.deepStrictEqual(refs.map((r) => [r.standIn, r.path]), [
      ['[Anarchy', 'Anarchy'],
      ['[Balance of power', 'Balance of power'],
      ['[Realism]', 'Realism'],
    ]);
  });

  await t("a note's quiet links are set aside from the links Obsidian counts, and put back as they were", () => {
    const cache = {
      links: [
        { link: '[Anarchy', original: '[[[Anarchy]]', position: { start: { offset: 4 } } },
        { link: 'Deterrence', original: '[[Deterrence]]', position: { start: { offset: 30 } } },
        { link: '[Anarchy#Heading', original: '[[[Anarchy#Heading]]', position: { start: { offset: 60 } } },
        { link: '[[Odd', original: '[[[[Odd]]', position: { start: { offset: 90 } } },
      ],
      frontmatterLinks: [{ key: 'related', link: '[Realism]', original: '[[[Realism]]]' }],
    };
    const moved = G.settleQuietLinks(cache);
    assert.deepStrictEqual(moved.map((r) => r.link), ['[Anarchy', '[Anarchy#Heading', '[Realism]']);
    assert.deepStrictEqual(cache.links.map((r) => r.link), ['Deterrence', '[[Odd'], 'a plain link, or [[[[, was taken');
    assert.ok(!('frontmatterLinks' in cache), 'an emptied list was left behind');
    // Still read as quiet links, from where they were set aside.
    assert.deepStrictEqual(G.quietRefs(cache).map((r) => r.path), ['Anarchy', 'Anarchy', 'Realism']);
    assert.deepStrictEqual(G.settleQuietLinks(cache), [], 'settling twice moved them again');
    const back = G.unsettleQuietLinks(cache);
    assert.strictEqual(back.length, 3);
    assert.deepStrictEqual(cache.links.map((r) => r.link), ['[Anarchy', 'Deterrence', '[Anarchy#Heading', '[[Odd']);
    assert.deepStrictEqual(cache.frontmatterLinks.map((r) => r.key), ['related']);
    assert.ok(!('drQuietLinks' in cache) && !('fromProperty' in cache.links[0]));
  });

  await t('[[[ opens the list, [[ and [[[[ do not; picking writes the link and closes it once', () => {
    const files = [
      { path: 'Politics/Deterrence.md', basename: 'Deterrence', extension: 'md', parent: { path: 'Politics' } },
      { path: 'Detours.md', basename: 'Detours', extension: 'md', parent: { path: '/' } },
    ];
    const feature = {
      enabled: true,
      app: {
        vault: { getMarkdownFiles: () => files },
        metadataCache: {
          getFileCache: (f) => (f.basename === 'Detours' ? { frontmatter: { aliases: ['Deterrent walk'] } } : null),
          fileToLinktext: (f) => f.basename,
        },
      },
    };
    const suggest = new G.QuietLinkSuggest(feature);
    let line = 'Typed [[[Det';
    const editor = {
      getLine: () => line,
      replaceRange: (text, from, to) => { line = line.slice(0, from.ch) + text + line.slice(to.ch); },
      setCursor: (c) => { editor.cursor = c; },
    };
    const trigger = (text) => { line = text; return suggest.onTrigger({ line: 0, ch: text.length }, editor); };
    const hit = trigger('Typed [[[Det');
    assert.deepStrictEqual([hit.start.ch, hit.query], [9, 'Det']);
    assert.strictEqual(trigger('Typed [[Det'), null);
    assert.strictEqual(trigger('Typed [[[[Det'), null);
    assert.strictEqual(trigger('Typed [[[Det|words'), null, 'still listing after the words began');
    const found = suggest.getSuggestions({ query: 'Det', file: null });
    assert.deepStrictEqual(found.map((f) => f.alias || f.file.basename), ['Detours', 'Deterrence', 'Deterrent walk'], 'shortest match first');
    // Obsidian has already paired the brackets: they're kept, not doubled.
    line = 'Typed [[[Det]]]';
    suggest.context = { editor, file: null, start: { line: 0, ch: 9 }, end: { line: 0, ch: 12 } };
    suggest.close = () => {};
    suggest.selectSuggestion(found[1]);
    assert.strictEqual(line, 'Typed [[[Deterrence]]]');
    assert.deepStrictEqual(editor.cursor, { line: 0, ch: 22 });
    // A letter typed after the list was asked for: taken in too, not left behind.
    line = 'Typed [[[Det]]]';
    editor.getCursor = () => ({ line: 0, ch: 12 });
    suggest.context = { editor, file: null, start: { line: 0, ch: 9 }, end: { line: 0, ch: 11 } };
    suggest.selectSuggestion(found[1]);
    assert.strictEqual(line, 'Typed [[[Deterrence]]]');
  });

  await t("what Obsidian already counted is taken back — a stray \"[Name\" note too — and counted again when switched off", () => {
    const caches = {
      'Triple.md': {
        links: [
          { link: '[Anarchy', original: '[[[Anarchy]]', position: { start: { offset: 0 } } },
          { link: '[Anarchy', original: '[[[Anarchy|words]]', position: { start: { offset: 20 } } },
          { link: 'Idea', original: '[[Idea]]', position: { start: { offset: 40 } } },
        ],
      },
      'Stray.md': { links: [{ link: '[Realism', original: '[[[Realism]]' }] },
      'Plain.md': { links: [{ link: 'Idea', original: '[[Idea]]' }] },
    };
    const files = { '[Realism.md': { path: '[Realism.md' }, 'Idea.md': { path: 'Idea.md' } };
    let announced = 0;
    const mc = {
      resolvedLinks: { 'Triple.md': { 'Idea.md': 1 }, 'Stray.md': { '[Realism.md': 1 }, 'Plain.md': { 'Idea.md': 1 } },
      unresolvedLinks: { 'Triple.md': { '[Anarchy': 2 }, 'Stray.md': {}, 'Plain.md': {} },
      getFileCache: (f) => caches[f.path] || null,
      getCachedFiles: () => Object.keys(caches),
      getFirstLinkpathDest: (name) => files[name + '.md'] || null,
      trigger: (name) => { if (name === 'resolved') announced++; },
    };
    const plugin = { settings: { quietLinks: true }, unloading: false };
    plugin.app = { metadataCache: mc, vault: { getFileByPath: (p) => (caches[p] ? { path: p } : null) } };
    const quiet = new G.QuietLinks(plugin);
    assert.strictEqual(quiet.sweep(), 2);
    assert.deepStrictEqual(mc.unresolvedLinks['Triple.md'], {});
    assert.deepStrictEqual(mc.resolvedLinks['Triple.md'], { 'Idea.md': 1 }, 'a plain link was uncounted');
    assert.deepStrictEqual(mc.resolvedLinks['Stray.md'], {}, 'the stray note is still linked');
    assert.strictEqual(announced, 1);
    assert.strictEqual(quiet.sweep(), 0, 'swept twice');
    assert.strictEqual(quiet.restoreAll(), 2);
    assert.deepStrictEqual(mc.unresolvedLinks['Triple.md'], { '[Anarchy': 2 });
    assert.deepStrictEqual(mc.resolvedLinks['Stray.md'], { '[Realism.md': 1 });
    assert.deepStrictEqual(caches['Triple.md'].links.map((r) => r.original), ['[[[Anarchy]]', '[[[Anarchy|words]]', '[[Idea]]']);
  });

  await t('quiet links become ordinary ones with a hidden mark, for sharing, and back — code and edits left alone', () => {
    const text = 'See [[[Anarchy]]] and [[[Deterrence|deterrence]]].\n```\nx = a[[[1]]]\n```\n';
    const at = (s) => text.indexOf(s);
    const span = (s) => ({ position: { start: { offset: at(s) }, end: { offset: at(s) + s.length - 1 } } });
    const cache = {
      drQuietLinks: [
        Object.assign({ link: '[Anarchy', original: '[[[Anarchy]]' }, span('[[[Anarchy]]]')),
        Object.assign({ link: '[Deterrence', original: '[[[Deterrence|deterrence]]' }, span('[[[Deterrence|deterrence]]]')),
        // Where the text has moved on since Obsidian read it: left alone.
        { link: '[Stale', original: '[[[Stale]]', position: { start: { offset: 0 }, end: { offset: 9 } } },
      ],
    };
    const spans = G.quietSpans(text, cache);
    assert.deepStrictEqual(spans.map((s) => s.inner), ['Anarchy', 'Deterrence|deterrence']);
    const shared = G.rewriteSpans(text, spans, (inner) => `[[${inner}]]%%quiet%%`);
    assert.strictEqual(shared, 'See [[Anarchy]]%%quiet%% and [[Deterrence|deterrence]]%%quiet%%.\n```\nx = a[[[1]]]\n```\n');
    const back = G.rewriteSpans(shared, G.portableSpans(shared), (inner) => `[[[${inner}]]]`);
    assert.strictEqual(back, text);
  });

  await t('a note’s quiet links, each once, with the lines and properties they’re in — not code', () => {
    const text = 'See [[[Anarchy]]].\nAgain [[[anarchy|it]]] and [[[Realism#Roots]]].\n```\nx = a[[[1]]]\n```\n';
    const at = (s) => text.indexOf(s);
    const span = (s, original) => Object.assign({ link: '[' + original.slice(3).split('|')[0], original }, { position: { start: { offset: at(s) }, end: { offset: at(s) + s.length - 1 } } });
    const cache = {
      drQuietLinks: [span('[[[Anarchy]]]', '[[[Anarchy]]'), span('[[[anarchy|it]]]', '[[[anarchy|it]]'), span('[[[Realism#Roots]]]', '[[[Realism#Roots]]')],
      frontmatterLinks: [{ key: 'related', link: '[Anarchy]', original: '[[[Anarchy]]]' }],
    };
    const links = G.quietLinksIn(text, cache);
    assert.deepStrictEqual(links.map((l) => [l.target, l.count, l.lines, l.keys]), [
      ['Anarchy', 3, [1, 2], ['related']],
      ['Realism#Roots', 1, [2], []],
    ]);
    assert.strictEqual(links[1].path, 'Realism');
    assert.strictEqual(G.quietHint('Realism#Roots'), 'Quiet link to Realism > Roots — kept off the graph and backlinks');
    assert.match(G.quietHint('Gone', true), /Gone \(not made yet\)/);
  });

  await t('a note made by a quiet link elsewhere is known by its bracket, and only when a quiet link points at it', () => {
    assert.strictEqual(G.strayLinkpath('[Anarchy.md'), 'Anarchy');
    assert.strictEqual(G.strayLinkpath('Inbox/[Anarchy.md'), 'Anarchy');
    assert.strictEqual(G.strayLinkpath('[Politics/Anarchy.md'), 'Politics/Anarchy');
    assert.strictEqual(G.strayLinkpath('[[Odd.md'), null);
    assert.strictEqual(G.strayLinkpath('Notes/Plain.md'), null);
    assert.strictEqual(G.strayLinkpath('[Anarchy.png'), null);
    const files = ['[Anarchy.md', '[Draft] Essay.md', 'Anarchy.md', 'Quiet.md', '[Missing.md'].map((p) => ({ path: p, basename: p.replace(/\.md$/, '') }));
    const caches = { 'Quiet.md': { drQuietLinks: [{ link: '[Anarchy', original: '[[[Anarchy]]' }, { link: '[Missing', original: '[[[Missing]]' }] } };
    const plugin = { settings: { quietLinks: true } };
    plugin.app = {
      vault: { getMarkdownFiles: () => files },
      metadataCache: {
        getFileCache: (f) => caches[f.path] || null,
        getFirstLinkpathDest: (name) => files.find((f) => f.path === `${name}.md`) || null,
      },
    };
    const found = new G.QuietLinks(plugin).strays().map((s) => [s.file.path, s.real && s.real.path]);
    assert.deepStrictEqual(found, [['[Anarchy.md', 'Anarchy.md'], ['[Missing.md', null]]);
  });

  await t('a rename rewrites the quiet links to the note, heading and words kept, and nothing else', () => {
    assert.ok(G.quietPointsAt('Anarchy', 'Politics/Anarchy.md'));
    assert.ok(G.quietPointsAt('politics/anarchy', 'Politics/Anarchy.md'));
    assert.ok(!G.quietPointsAt('Anarchy2', 'Politics/Anarchy.md'));
    const text = 'A [[[Anarchy]]], [[[Anarchy#Order|words]]] and [[[Politics/Anarchy]]]; [[Anarchy]] and [[[Anarchy2]]] stay.';
    const out = G.renameQuietLinksIn(text, [{ oldPath: 'Politics/Anarchy.md', linktext: 'Anarchism' }]);
    assert.strictEqual(out.count, 3);
    assert.strictEqual(out.text, 'A [[[Anarchism]]], [[[Anarchism#Order|words]]] and [[[Anarchism]]]; [[Anarchy]] and [[[Anarchy2]]] stay.');
    const kept = G.renameQuietLinksIn(text, [{ oldPath: 'Politics/Anarchy.md', linktext: 'Anarchism' }], () => true);
    assert.strictEqual(kept.count, 0, 'rewrote a link that still names a note');
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
