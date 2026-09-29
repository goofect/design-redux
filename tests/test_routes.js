// Links through notes between, in the graph: which lines become routes,
// what a hover lights, and the feature standing between a graph and what
// it's given — against a stand-in drawn the way Obsidian's graph draws:
// a note is lit when the hovered one is among its links, a line when the
// hovered note is at one end.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.MutationObserver = dom.window.MutationObserver;
global.navigator = dom.window.navigator;

class Setting {
  constructor(containerEl) {
    this.settingEl = containerEl.ownerDocument.createElement('div');
    this.settingEl.className = 'setting-item';
    containerEl.appendChild(this.settingEl);
  }
  setName(name) { this.settingEl.dataset.name = name; return this; }
  setClass(cls) { this.settingEl.classList.add(cls); return this; }
  setTooltip(tip) { this.settingEl.setAttribute('aria-label', tip); return this; }
  addToggle(cb) {
    const toggle = {
      value: false,
      cb: null,
      setValue(v) { this.value = v; return this; },
      getValue() { return this.value; },
      onChange(fn) { this.cb = fn; return this; },
      click() { this.value = !this.value; if (this.cb) this.cb(this.value); },
    };
    cb(toggle);
    return this;
  }
}

const obsidian = new Proxy({ Setting, Platform: { isMobile: false } }, { get: (t, k) => (k in t ? t[k] : class {}) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_routes_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { routeGraph, routeLight, routeLines, linkStats, linkWeights, routeKey, GraphRoutes, routedNodeRender, routedLinkRender };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}\n${err.stack}`);
    process.exitCode = 1;
  }
};

/* -- a vault: links as Obsidian's resolvedLinks has them -------------- */

const W = 'Politics/Westminster system.md';
const M = 'Politics/Ministerial responsibility.md';
const I = 'Politics/Individual responsibility.md';
const C = 'Politics/Collective responsibility.md';

function graphData(resolved, extra) {
  const nodes = {};
  const note = (id) => (nodes[id] = nodes[id] || { type: '', links: {} });
  Object.keys(resolved).forEach((from) => {
    note(from);
    Object.keys(resolved[from]).forEach((to) => {
      note(to);
      nodes[from].links[to] = true;
    });
  });
  Object.assign(nodes, extra || {});
  return nodes;
}

const lines = (nodes) => {
  const out = new Set();
  Object.keys(nodes).forEach((a) => Object.keys(nodes[a].links || {}).forEach((b) => out.add(R.routeKey(a, b))));
  return out;
};
const key = (a, b) => R.routeKey(a, b);
const sorted = (set) => Array.from(set).sort();

/* -- which lines become routes ---------------------------------------- */

test('Westminster reaches Individual and Collective through Ministerial', () => {
  const resolved = {
    [W]: { [M]: 1, [I]: 1, [C]: 1, 'Politics/Parliament.md': 1 },
    [M]: { [I]: 1, [C]: 1 },
    [I]: { [M]: 1 },
  };
  const nodes = graphData(resolved);
  const plan = R.routeGraph(nodes, R.linkStats(resolved));
  const drawn = lines(plan.nodes);
  assert.ok(!drawn.has(key(W, I)) && !drawn.has(key(W, C)), 'the long lines go');
  assert.ok(drawn.has(key(W, M)) && drawn.has(key(M, I)) && drawn.has(key(M, C)), 'the route stays');
  assert.ok(drawn.has(key(W, 'Politics/Parliament.md')));
  assert.deepStrictEqual(sorted(plan.hidden.get(W)), sorted([I, C]));
  assert.ok(nodes[W].links[I], 'what the graph was given is left as it was');
});

test('hovering Westminster lights Individual and Collective, and the lines through Ministerial', () => {
  const resolved = { [W]: { [M]: 1, [I]: 1, [C]: 1 }, [M]: { [I]: 1, [C]: 1 } };
  const plan = R.routeGraph(graphData(resolved), R.linkStats(resolved));
  const lit = R.routeLight(plan, W);
  assert.deepStrictEqual(sorted(lit.nodes), sorted([M, I, C]));
  assert.deepStrictEqual(sorted(lit.links), sorted([key(W, M), key(M, I), key(M, C)]));
  const up = R.routeLight(plan, I);
  assert.deepStrictEqual(sorted(up.nodes), sorted([W, M]), 'and the other way, from the narrow end');
  assert.deepStrictEqual(sorted(up.links), sorted([key(W, M), key(M, I)]));
  assert.strictEqual(R.routeLight(plan, M).nodes.size, 0, 'Ministerial links to them all directly');
});

test('a tie in breadth is settled by which way the one-way links run', () => {
  // Westminster and Ministerial are each linked with three notes.
  const down = { [W]: { [M]: 1, [I]: 1, [C]: 1 }, [M]: { [I]: 1, [C]: 1 } };
  let plan = R.routeGraph(graphData(down), R.linkStats(down));
  assert.deepStrictEqual(sorted(plan.hidden.get(W)), sorted([I, C]));
  // The same, in a vault whose notes link up to what they're part of.
  const up = { [I]: { [M]: 1, [W]: 1 }, [C]: { [M]: 1, [W]: 1 }, [M]: { [W]: 1 } };
  plan = R.routeGraph(graphData(up), R.linkStats(up));
  assert.deepStrictEqual(sorted(plan.hidden.get(W)), sorted([I, C]));
  assert.ok(!plan.hidden.has(M));
});

test('links both ways: the broader note is the one linked with more', () => {
  const resolved = {
    [W]: { [M]: 1, [I]: 1, 'Politics/Cabinet.md': 1, 'Politics/Parliament.md': 1 },
    [M]: { [W]: 1, [I]: 1, [C]: 1 },
    [I]: { [W]: 1, [M]: 1 },
    [C]: { [M]: 1 },
  };
  const plan = R.routeGraph(graphData(resolved), R.linkStats(resolved));
  assert.deepStrictEqual(sorted(plan.hidden.get(W)), [I]);
});

test('tags, attachments and missing notes keep their lines', () => {
  const resolved = { [W]: { [M]: 1, [I]: 1 }, [M]: { [I]: 1 } };
  const nodes = graphData(resolved, {
    '#politics': { type: 'tag', links: {} },
    'map.png': { type: 'attachment', links: {} },
    Missing: { type: 'unresolved', links: {} },
  });
  [W, M, I].forEach((id) => Object.assign(nodes[id].links, { '#politics': true, 'map.png': true, Missing: true }));
  const plan = R.routeGraph(nodes, R.linkStats(resolved));
  [W, M, I].forEach((id) => {
    ['#politics', 'map.png', 'Missing'].forEach((to) => assert.ok(plan.nodes[id].links[to], `${id} → ${to}`));
  });
  assert.ok(!plan.nodes[W].links[I]);
});

test('every line left out still has a route, each step narrower (random vaults)', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let round = 0; round < 60; round++) {
    const n = 4 + Math.floor(rand() * 18);
    const ids = Array.from({ length: n }, (_, i) => `n${i}.md`);
    const resolved = {};
    const p = 0.15 + rand() * 0.5;
    ids.forEach((a) => ids.forEach((b) => {
      if (a !== b && rand() < p) (resolved[a] = resolved[a] || {})[b] = 1;
    }));
    const nodes = graphData(resolved);
    ids.forEach((id) => { nodes[id] = nodes[id] || { type: '', links: {} }; });
    const plan = R.routeGraph(nodes, R.linkStats(resolved));
    const before = lines(nodes);
    const after = lines(plan.nodes);
    plan.hidden.forEach((partners, a) => partners.forEach((b) => {
      assert.ok(before.has(key(a, b)) && !after.has(key(a, b)));
      const lit = R.routeLight(plan, a);
      assert.ok(lit.nodes.has(b), `${a} lights ${b}`);
      lit.links.forEach((k) => assert.ok(after.has(k), 'a route runs only along drawn lines'));
    }));
    after.forEach((k) => assert.ok(before.has(k)));
    // Every note keeps a line, as long as it had one.
    ids.forEach((id) => {
      const had = Array.from(before).some((k) => k.split('\n').includes(id));
      const has = Array.from(after).some((k) => k.split('\n').includes(id));
      assert.strictEqual(has, had, id);
    });
  }
});

test('sizes stay as they were: counted as Obsidian counts a note’s lines', () => {
  const nodes = graphData({ [W]: { [M]: 1, [I]: 1 }, [M]: { [I]: 1, [W]: 1 } });
  assert.deepStrictEqual(R.linkWeights(nodes), { [W]: 3, [M]: 3, [I]: 2 });
});

/* -- a graph drawn the way Obsidian's is ------------------------------ */

class FakeNode {
  constructor(renderer, id, type) {
    Object.assign(this, { renderer, id, type, forward: {}, reverse: {}, lit: null, weight: 0 });
  }
  render() {
    const hl = this.renderer.getHighlightNode();
    this.lit = !hl || hl === this || this.forward.hasOwnProperty(hl.id) || this.reverse.hasOwnProperty(hl.id);
  }
}
class FakeLink {
  constructor(renderer, source, target) {
    Object.assign(this, { renderer, source, target, lit: null });
  }
  render() {
    const hl = this.renderer.getHighlightNode();
    this.lit = !hl || this.source === hl || this.target === hl;
  }
}
class FakeRenderer {
  constructor(containerEl) {
    Object.assign(this, { containerEl, nodes: [], links: [], nodeLookup: {}, highlightNode: null, dragNode: null, fed: [] });
  }
  getHighlightNode() {
    return this.dragNode || this.highlightNode;
  }
  changed() {}
  setData(data) {
    this.fed.push(data);
    const o = data.nodes;
    this.nodes.filter((n) => !o[n.id]).forEach((n) => {
      this.nodes.splice(this.nodes.indexOf(n), 1);
      delete this.nodeLookup[n.id];
    });
    Object.keys(o).forEach((id) => {
      if (!this.nodeLookup[id]) {
        const node = new FakeNode(this, id, o[id].type);
        this.nodes.push(node);
        this.nodeLookup[id] = node;
      }
    });
    this.links.slice().forEach((l) => {
      const want = o[l.source.id] && o[l.source.id].links[l.target.id] && this.nodeLookup[l.target.id];
      if (want) return;
      this.links.splice(this.links.indexOf(l), 1);
      delete l.source.forward[l.target.id];
      delete l.target.reverse[l.source.id];
    });
    Object.keys(o).forEach((id) => {
      const f = this.nodeLookup[id];
      Object.keys(o[id].links).forEach((to) => {
        if (f.forward[to] || !this.nodeLookup[to]) return;
        const l = new FakeLink(this, f, this.nodeLookup[to]);
        this.links.push(l);
        f.forward[to] = l;
        this.nodeLookup[to].reverse[id] = l;
      });
    });
    const w = data.weights;
    this.nodes.forEach((n) => {
      n.weight = w ? w[n.id] || 0 : Object.keys(n.forward).length + Object.keys(n.reverse).length;
    });
  }
  draw() {
    this.nodes.forEach((n) => n.render());
    this.links.forEach((l) => l.render());
  }
}

function makeGraph(type, data) {
  const containerEl = document.body.appendChild(document.createElement('div'));
  const controls = containerEl.appendChild(document.createElement('div'));
  controls.className = 'graph-controls';
  const display = controls.appendChild(document.createElement('div'));
  display.className = 'tree-item graph-control-section mod-display';
  const rows = document.createElement('div'); // folded: not in the page
  rows.className = 'tree-item-children';
  const arrows = rows.appendChild(document.createElement('div'));
  arrows.className = 'setting-item mod-toggle';
  const slider = rows.appendChild(document.createElement('div'));
  slider.className = 'setting-item mod-slider';
  const renderer = new FakeRenderer(containerEl);
  const engine = { displayOptions: { childrenEl: rows }, data, render() { renderer.setData(this.data()); } };
  const view = { containerEl, renderer, getViewType: () => type };
  if (type === 'graph') view.dataEngine = engine;
  else view.engine = engine;
  const leaf = { view };
  view.leaf = leaf;
  engine.render();
  return { leaf, renderer, engine, rows };
}

function makeFeature(leaves, resolved) {
  const settings = { graphRoutes: true, graphRouting: {} };
  const app = {
    metadataCache: { resolvedLinks: resolved },
    workspace: { iterateAllLeaves: (fn) => leaves().forEach(fn), activeLeaf: null },
  };
  const plugin = { app, settings, saves: 0, saveData() { this.saves++; } };
  return new R.GraphRoutes(plugin);
}

const vault = { [W]: { [M]: 1, [I]: 1, [C]: 1 }, [M]: { [I]: 1, [C]: 1 } };
const node = (g, id) => g.renderer.nodeLookup[id];
const linkBetween = (g, a, b) =>
  g.renderer.links.find((l) => (l.source.id === a && l.target.id === b) || (l.source.id === b && l.target.id === a));

test('the switch sits beside Arrows in Display, and draws the graph routed', () => {
  const g = makeGraph('graph', () => ({ nodes: graphData(vault) }));
  const feature = makeFeature(() => [g.leaf], vault);
  feature.enable();
  const row = g.rows.querySelector('.dr-graph-routes');
  assert.ok(row, 'switch added to the folded section');
  assert.strictEqual(row.previousElementSibling.className, 'setting-item mod-toggle');
  assert.ok(linkBetween(g, W, I), 'off: every line drawn');

  row.drToggle.click();
  assert.strictEqual(feature.settings.graphRouting.graph, true);
  assert.ok(!linkBetween(g, W, I) && !linkBetween(g, W, C), 'on: the long lines go');
  assert.ok(linkBetween(g, W, M) && linkBetween(g, M, I));
  assert.strictEqual(node(g, W).weight, 3, 'Westminster keeps its size');

  feature.sync();
  assert.strictEqual(g.rows.querySelectorAll('.dr-graph-routes').length, 1, 'one switch, however often synced');
  feature.disable();
  feature.settings.graphRouting.graph = false;
});

test('hovering lights routed notes and the route’s lines as direct ones are lit', () => {
  const g = makeGraph('graph', () => ({ nodes: graphData(vault) }));
  const feature = makeFeature(() => [g.leaf], vault);
  feature.settings.graphRouting.graph = true;
  feature.enable();

  g.renderer.highlightNode = node(g, W);
  g.renderer.draw();
  [M, I, C].forEach((id) => assert.strictEqual(node(g, id).lit, true, `${id} lit`));
  assert.strictEqual(linkBetween(g, M, I).lit, true, 'Ministerial → Individual lit');
  assert.strictEqual(linkBetween(g, M, C).lit, true);
  assert.deepStrictEqual(Object.keys(node(g, I).forward), [], 'nothing left behind in the graph’s own links');
  assert.ok(!g.renderer.hasOwnProperty('getHighlightNode'));

  g.renderer.highlightNode = node(g, C);
  g.renderer.draw();
  assert.strictEqual(node(g, W).lit, true, 'from the narrow end too');
  assert.strictEqual(node(g, I).lit, false, 'a note not linked stays faded');
  assert.strictEqual(linkBetween(g, M, I).lit, false);
  assert.strictEqual(linkBetween(g, W, M).lit, true, 'Westminster → Ministerial, on the route to Collective');

  g.renderer.highlightNode = null;
  g.renderer.draw();
  assert.ok(g.renderer.nodes.every((n) => n.lit) && g.renderer.links.every((l) => l.lit));

  feature.disable();
  assert.ok(linkBetween(g, W, I), 'switched off: the lines come back');
  assert.ok(g.renderer.nodes.every((n) => !n.hasOwnProperty('render')));
  assert.ok(!g.renderer.hasOwnProperty('setData') && !g.renderer.drRoutes);
});

test('a local graph draws only the neighbour lines a route runs along', () => {
  // The local graph of Westminster, two steps out, without Neighbor
  // links: only the lines outward from Westminster are given.
  const R2 = 'Politics/Resignation.md';
  const resolved = Object.assign({ [I]: { [R2]: 1 }, [C]: { [R2]: 1 } }, vault);
  const local = () => ({
    nodes: {
      [W]: { type: '', links: { [M]: true, [I]: true, [C]: true } },
      [M]: { type: '', links: {} },
      [I]: { type: '', links: { [R2]: true } },
      [C]: { type: '', links: {} },
      [R2]: { type: '', links: {} },
    },
    weights: { [W]: 30, [M]: 15, [I]: 15, [C]: 15, [R2]: 0 },
  });
  const g = makeGraph('localgraph', local);
  const feature = makeFeature(() => [g.leaf], resolved);
  feature.settings.graphRouting.localgraph = true;
  feature.enable();
  assert.ok(!linkBetween(g, W, I) && !linkBetween(g, W, C));
  assert.ok(linkBetween(g, M, I) && linkBetween(g, M, C), 'the route’s lines drawn');
  assert.ok(linkBetween(g, I, R2), 'the local graph’s own lines stay');
  assert.ok(!linkBetween(g, C, R2), 'Collective → Resignation isn’t on a route, so not drawn');
  assert.strictEqual(node(g, W).weight, 30, 'the local graph’s own sizes');
  g.renderer.highlightNode = node(g, W);
  g.renderer.draw();
  assert.ok([M, I, C].every((id) => node(g, id).lit));
  assert.strictEqual(node(g, R2).lit, false);
  feature.disable();
});

test('a graph drawn differently is left alone', () => {
  const leaf = { view: { getViewType: () => 'graph', containerEl: document.createElement('div'), renderer: {} } };
  const feature = makeFeature(() => [leaf], vault);
  feature.settings.graphRouting.graph = true;
  feature.enable();
  assert.ok(!leaf.view.renderer.drRoutes);
  feature.disable();
});

console.log(`${passed} passed`);
