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
}, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_graph_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { GraphPropertyFilter, graphClause, graphTerm, searchWithout, propertyValues };\n');
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

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
