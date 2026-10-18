// The tree core on its own: src/tree/ bundled without the rest of the
// plugin, without Obsidian and without a DOM — which is also the proof
// that it needs none of them. Layout cases are the canvas tests' own.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const entries = fs.readdirSync(path.join(root, 'src', 'tree')).filter((f) => /^\d{3}-.*\.js$/.test(f)).sort();
const built = esbuild.buildSync({
  stdin: { contents: entries.map((f) => `export * from './src/tree/${f}';`).join('\n'), resolveDir: root, loader: 'js' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const tmp = path.join(__dirname, '_tree_under_test.js');
fs.writeFileSync(tmp, built.outputFiles[0].text);
const R = require(tmp);
fs.unlinkSync(tmp);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

const card = (id, x, y, w, h, extra) => Object.assign({ id, type: 'text', text: id, x, y, width: w, height: h }, extra);
const edge = (from, to, fromSide, toSide, extra) => Object.assign({ id: `${from}-${to}`, fromNode: from, toNode: to, fromSide, toSide }, extra);

(async () => {
  await t('the tree core loads with nothing but core: no Obsidian, no DOM', () => {
    assert.strictEqual(typeof R.layoutPlaces, 'function');
    assert.strictEqual(typeof R.modelFromData, 'function');
    assert.strictEqual(typeof globalThis.document, 'undefined');
  });

  await t('arrows read as parent and child; a tree of four levels', () => {
    const m = R.modelFromData({ nodes: [card('r', 0, 0, 100, 50), card('a', 200, 0, 100, 50), card('b', 400, 0, 100, 50)], edges: [edge('r', 'a', 'right', 'left'), edge('a', 'b', 'right', 'left')] });
    const links = R.arrowLinks(m);
    assert.deepStrictEqual(links.children.get('r'), ['a']);
    assert.deepStrictEqual(links.parents.get('b'), ['a']);
    assert.deepStrictEqual(R.branchOf(m, 'r', links), ['a', 'b']);
  });

  const tree = () => R.modelFromData({
    nodes: [card('r', 0, 0, 100, 50), card('a', 200, -150, 100, 50), card('b', 200, -50, 100, 50), card('c', 200, 50, 100, 50), card('d', 200, 150, 100, 50), card('a1', 400, -200, 100, 50), card('a2', 400, -100, 100, 50)],
    edges: [edge('r', 'a', 'right', 'left'), edge('r', 'b', 'right', 'left'), edge('r', 'c', 'right', 'left'), edge('r', 'd', 'right', 'left'), edge('a', 'a1', 'right', 'left'), edge('a', 'a2', 'right', 'left')],
  });
  const put = (model, places) => places.forEach((at, id) => Object.assign(model.byId.get(id), at));
  const overlap = (model) => {
    const cs = model.nodes;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const [p, q] = [cs[i], cs[j]];
      if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) return `${p.id} on ${q.id}`;
    }
    return '';
  };

  await t('layouts: downward, both sides and all round — no card on another, the same twice', () => {
    let model = tree();
    let places = R.layoutPlaces(model, 'r', 'bottom');
    put(model, places);
    assert.deepStrictEqual(['a', 'b', 'c', 'd'].map((id) => model.byId.get(id).y), [130, 130, 130, 130]);
    assert.strictEqual(overlap(model), '');
    assert.deepStrictEqual(Array.from(R.layoutPlaces(model, 'r', 'bottom')), Array.from(places));
    model = tree();
    places = R.layoutPlaces(model, 'r', 'both');
    put(model, places);
    assert.ok(model.byId.get('a').x > 100 && ['b', 'c', 'd'].every((id) => model.byId.get(id).x < 0));
    assert.strictEqual(overlap(model), '');
    model = tree();
    places = R.layoutPlaces(model, 'r', 'radial');
    put(model, places);
    assert.strictEqual(model.byId.get('a').x + 50, 50, 'the first straight up');
    assert.strictEqual(overlap(model), '');
  });

  await t('an outline, each level set in, exactly where the canvas puts it', () => {
    const m = R.modelFromData({
      nodes: [card('r', 0, 0, 100, 50), card('a', 200, -100, 100, 50), card('b', 200, 100, 100, 50), card('a1', 400, -100, 100, 50), card('b1', 400, 100, 100, 50), card('b2', 400, 200, 100, 50)],
      edges: [edge('r', 'a', 'right', 'left'), edge('r', 'b', 'right', 'left'), edge('a', 'a1', 'right', 'left'), edge('b', 'b1', 'right', 'left'), edge('b', 'b2', 'right', 'left')],
    });
    const outline = R.layoutPlaces(m, 'r', 'outline');
    assert.deepStrictEqual(['a', 'a1', 'b', 'b1', 'b2'].map((id) => [outline.get(id).x, outline.get(id).y]), [[48, 66], [96, 132], [48, 198], [96, 264], [96, 330]]);
  });

  await t('the order a presentation walks: depth first, each card once', () => {
    assert.deepStrictEqual(R.presentationOrder(tree()).map((o) => o.id), ['r', 'a', 'a1', 'a2', 'b', 'c', 'd']);
  });

  // -- the files ---------------------------------------------------------

  const HAND = [
    ['the plan’s own example', [
      '---', 'mindmap: true', 'mindmap-layout: right', '---',
      '- Launch plan ^root %%{"color":2}%%',
      '    - Research',
      '        - [[Competitor notes]]',
      '        - Interview script %%{"fold":1}%%',
      '    - Build ^build',
      '        - API',
      '        - UI %%{"master":1}%%',
      '    - Ship',
      '', '## Free nodes', '- Open question ^q1', '',
      '## Relations', '- ^build -> ^q1 "blocks" %%{"style":"dashed"}%%', '',
      '```design-redux-layout', '{"v":1,"nudge":{"build":[40,-12]},"view":[0,0,1]}', '```', ''].join('\n')],
    ['a hand-written list, tabs', '- Topic\n\t- One\n\t\t- One a\n\t- Two\n'],
    ['several items at the top', '- Alpha\n- Beta\n  - Beta one\n- Gamma'],
    ['prose round the list', '# Notes\n\nSome writing first.\n\n- Root\n  - Child\n\nAnd writing after, with a [[link]].\n'],
    ['odd indentation', '- Root\n   - three spaces\n      - six\n   - three again\n'],
    ['numbered and starred', '1. First\n   * nested star\n   * another\n2. Second\n'],
    ['a node over several lines', '- Root\n  - A long node\n    that goes on here\n    and here\n  - Short\n'],
    ['blank lines between items', '- Root\n\n  - One\n\n  - Two\n\n'],
    ['no list at all', '---\nmindmap: true\n---\nJust words.\n'],
    ['an empty note', ''],
    ['crlf line ends', '- Root\r\n  - One\r\n  - Two\r\n'],
    ['code with a dash in it', '- Root\n  - Child\n\n```\n- not a node\n```\n'],
    ['checkboxes and tags', '- Plan\n  - [ ] call #todo\n  - [x] write\n'],
    ['attributes that aren’t JSON', '- Root %%{not json}%%\n  - Child %%a comment%%\n'],
    ['a relation line it can’t read', '- A ^a\n  - B ^b\n\n## Relations\n- ^a -> ^b\n- something else\n'],
  ];
  // Maps made at random, the same each run.
  let seed = 7;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const words = ['alpha', 'beta', '[[Gamma note]]', '#tag', 'delta epsilon', '**bold**', 'zeta', 'eta theta iota', '`code`', 'kappa'];
  const generated = (k) => {
    const unit = ['\t', '  ', '   ', '    '][rand(4)];
    const marker = ['-', '*', '+'][rand(3)];
    const lines = [];
    if (rand(2)) lines.push('---', 'mindmap: true', '---');
    if (rand(3) === 0) lines.push('Some prose above.', '');
    const node = (depth) => {
      let text = Array.from({ length: 1 + rand(3) }, () => words[rand(words.length)]).join(' ');
      if (rand(5) === 0) text += ` ^id${k}x${lines.length}`;
      if (rand(6) === 0) text += ` %%{"color":${rand(6)}}%%`;
      lines.push(unit.repeat(depth) + marker + ' ' + text);
      if (rand(8) === 0) lines.push(unit.repeat(depth) + '  continued text');
      if (rand(10) === 0) lines.push('');
      if (depth < 4) for (let c = rand(4 - depth); c > 0; c--) node(depth + 1);
    };
    node(0);
    if (rand(3) === 0) lines.push('', '## Free nodes', `${marker} free one`);
    if (rand(3) === 0) lines.push('', '```design-redux-layout', '{"v":1}', '```');
    if (rand(2)) lines.push('');
    return lines.join('\n');
  };
  const CORPUS = HAND.concat(Array.from({ length: 15 }, (_, k) => [`generated ${k + 1}`, generated(k)]));

  await t(`the markdown file: ${CORPUS.length} maps read and written with no change come back byte for byte`, () => {
    assert.ok(CORPUS.length >= 30);
    CORPUS.forEach(([name, text]) => {
      const { model } = R.parseOutline(text, { title: 'Map' });
      assert.strictEqual(R.writeOutline(model, text), text, name);
    });
  });

  await t('the grammar: the root, ids where written, attributes, free nodes, relations, the layout block', () => {
    const { model } = R.parseOutline(HAND[0][1]);
    assert.strictEqual(model.root.text, 'Launch plan');
    assert.deepStrictEqual([model.root.id, model.root.anchor, model.root.attrs], ['root', true, { color: 2 }]);
    assert.deepStrictEqual(model.root.children.map((c) => c.text), ['Research', 'Build', 'Ship']);
    assert.deepStrictEqual(model.root.children[0].children[1].attrs, { fold: 1 });
    assert.strictEqual(model.root.children[0].anchor, false, 'an id only where one is written');
    assert.deepStrictEqual(model.free.map((n) => [n.id, n.text]), [['q1', 'Open question']]);
    assert.deepStrictEqual(model.relations, [{ from: 'build', to: 'q1', label: 'blocks', attrs: { style: 'dashed' } }]);
    assert.deepStrictEqual(model.layout, { v: 1, nudge: { build: [40, -12] }, view: [0, 0, 1] });
    assert.strictEqual(model.mode, 'right');
    const several = R.parseOutline(HAND[2][1], { title: 'My map' }).model;
    assert.deepStrictEqual([several.root.virtual, several.root.text, several.root.children.map((c) => c.text)], [true, 'My map', ['Alpha', 'Beta', 'Gamma']]);
    const long = R.parseOutline(HAND[6][1]).model;
    assert.strictEqual(long.root.children[0].text, 'A long node\nthat goes on here\nand here');
    const bad = R.parseOutline(HAND[13][1]).model;
    assert.deepStrictEqual([bad.root.text, bad.root.attrs], ['Root %%{not json}%%', {}], 'a comment that isn’t JSON stays text');
  });

  await t('a change writes only the lines it has to; the rest stay exactly as they were', () => {
    const text = HAND[0][1];
    const { model } = R.parseOutline(text);
    const diff = (a, b) => {
      const x = a.split('\n');
      const y = b.split('\n');
      return { changed: x.filter((l, k) => l !== y[k]).length, lengths: [x.length, y.length] };
    };
    model.root.children[2].text = 'Ship it';
    let next = R.writeOutline(model, text);
    assert.deepStrictEqual(diff(text, next), { changed: 1, lengths: [23, 23] });
    assert.ok(next.includes('    - Ship it\n'), 'the new line indented as the list is');
    R.bindSource(model, next);
    // A child added: one line more, nothing else touched.
    const kid = R.newNode('Launch party');
    kid.parent = model.root.children[2];
    model.root.children[2].children.push(kid);
    const after = R.writeOutline(model, next);
    assert.strictEqual(after.split('\n').length, 24);
    assert.ok(after.includes('    - Ship it\n        - Launch party\n'));
    R.bindSource(model, after);
    // A node moved: its own line written again at its new depth; its children follow.
    const research = model.root.children[0];
    model.root.children.splice(0, 1);
    model.root.children[0].children.push(research);
    research.parent = model.root.children[0];
    const moved = R.writeOutline(model, after);
    assert.ok(moved.includes('    - Build ^build\n        - API\n        - UI %%{"master":1}%%\n        - Research\n            - [[Competitor notes]]'), moved);
    // An attribute set, and an id needed by a new relation.
    R.bindSource(model, moved);
    const api = model.root.children[0].children[0];
    api.attrs.color = 4;
    api.anchor = true;
    model.relations.push({ from: api.id, to: 'q1', label: '', attrs: {} });
    const linked = R.writeOutline(model, moved);
    assert.ok(linked.includes(`- API ^${api.id} %%{"color":4}%%`));
    assert.ok(linked.includes(`- ^${api.id} -> ^q1`));
    assert.ok(linked.endsWith('```design-redux-layout\n{"v":1,"nudge":{"build":[40,-12]},"view":[0,0,1]}\n```\n'), 'the layout block still last');
  });

  await t('a new map: a flagged note with its root; sections and the layout block added only when there’s something for them', () => {
    const model = R.treeModel('Launch plan');
    let text = R.writeOutline(model);
    assert.strictEqual(text, '---\nmindmap: true\n---\n- Launch plan\n');
    const back = R.parseOutline(text).model;
    assert.strictEqual(back.root.text, 'Launch plan');
    back.free.push(R.newNode('Loose end'));
    back.layout = { v: 1, view: [0, 0, 1] };
    back.mode = 'bottom';
    text = R.writeOutline(back, text);
    assert.strictEqual(text, '---\nmindmap: true\nmindmap-layout: bottom\n---\n- Launch plan\n\n## Free nodes\n- Loose end\n\n```design-redux-layout\n{"v":1,"view":[0,0,1]}\n```\n');
  });

  await t('the .mindmap file: the same tree as JSON, read and written stably, and either way without loss', () => {
    const { model } = R.parseOutline(HAND[0][1]);
    const json = R.writeMindmapJson(model);
    const again = R.parseMindmapJson(json);
    assert.strictEqual(R.writeMindmapJson(again), json, 'byte for byte');
    assert.deepStrictEqual([again.mode, again.root.attrs, again.free[0].text, again.relations[0].label, again.layout.nudge], ['right', { color: 2 }, 'Open question', 'blocks', { build: [40, -12] }]);
    assert.ok(json.startsWith('{\n  "v": 1,\n  "layout": "right",\n  "root": {\n    "id": "root",\n    "text": "Launch plan",\n    "color": 2,'));
    // To a note and back: the same tree, attributes and all.
    const note = R.writeOutline(again);
    const there = R.parseOutline(note).model;
    const shape = (m) => {
      const out = [];
      R.walk(m, (n, d) => out.push(`${d}:${n.text}:${JSON.stringify(n.attrs)}`));
      return out;
    };
    assert.deepStrictEqual(shape(there), shape(model));
    assert.throws(() => R.parseMindmapJson('[1,2]'));
  });

  // -- changes and Undo --------------------------------------------------

  const shapeOf = (m) => {
    const out = [];
    R.walk(m, (n, d) => out.push(`${d}|${n.id}|${n.text}|${JSON.stringify(n.attrs)}|${n.anchor ? 1 : 0}|${n.parent ? n.parent.id : '-'}`));
    return out.join('\n') + '\n' + JSON.stringify(m.relations) + JSON.stringify(m.mode || null) + JSON.stringify(m.layout || null);
  };
  const sample = () => R.parseOutline('- Root ^root\n\t- A ^a\n\t\t- A1\n\t\t- A2\n\t- B ^b\n\t\t- B1\n\t- C\n\n## Relations\n- ^a -> ^b "leads to"\n').model;

  await t('changes: add, insert a parent, indent, outdent, reorder, split, merge, duplicate, paste — each as asked', () => {
    let m = sample();
    const id = (text) => { let f = null; R.walk(m, (n) => { if (n.text === text) f = n.id; }); return f; };
    const kids = (text) => R.nodeById(m, id(text)).children.map((c) => c.text);
    R.addChild(m, id('B'), 'B2');
    assert.deepStrictEqual(kids('B'), ['B1', 'B2']);
    R.addSibling(m, id('A1'), 'A1½');
    assert.deepStrictEqual(kids('A'), ['A1', 'A1½', 'A2']);
    R.addParent(m, id('C'), 'Group');
    assert.deepStrictEqual(kids('Group'), ['C']);
    R.indentNode(m, id('A2'));
    assert.deepStrictEqual(kids('A1½'), ['A2']);
    R.outdentNode(m, id('A2'));
    assert.deepStrictEqual(kids('A'), ['A1', 'A1½', 'A2']);
    R.reorderNode(m, id('A2'), -2);
    assert.deepStrictEqual(kids('A'), ['A2', 'A1', 'A1½']);
    R.splitNode(m, id('A1½'), 2);
    assert.deepStrictEqual(kids('A'), ['A2', 'A1', 'A1', '½']);
    R.mergeIntoPrevious(m, R.nodeById(m, id('A')).children[3].id);
    assert.deepStrictEqual(kids('A'), ['A2', 'A1', 'A1 ½']);
    R.duplicateBranch(m, id('B'));
    assert.deepStrictEqual(R.nodeById(m, 'root').children.map((c) => c.text), ['A', 'B', 'B', 'Group']);
    R.pasteLines(m, id('Group'), '- One\n  - One a\n- Two\nplain three');
    assert.deepStrictEqual(kids('Group'), ['C', 'One', 'Two', 'plain three']);
    assert.deepStrictEqual(kids('One'), ['One a']);
    R.removeNode(m, 'b');
    assert.deepStrictEqual(m.relations, [], 'a relation goes with the node it pointed to');
    assert.strictEqual(R.moveNode(m, 'a', id('A2')), null, 'not into its own branch');
    assert.strictEqual(R.removeNode(m, 'root'), null, 'not the root');
  });

  await t('every change undone by its own patch: 10,000 random sequences, each undone back to exactly where it began', () => {
    let seed = 12345;
    const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    const all = (m) => { const out = []; R.walk(m, (n) => out.push(n)); return out; };
    const pick = (m) => { const ns = all(m); return ns[rnd(ns.length)]; };
    const changes = [
      (m) => R.addChild(m, pick(m).id, `new ${rnd(99)}`),
      (m) => R.addSibling(m, pick(m).id, `sib ${rnd(99)}`, rnd(2) === 0),
      (m) => R.addParent(m, pick(m).id, 'parent'),
      (m) => R.removeNode(m, pick(m).id),
      (m) => R.moveNode(m, pick(m).id, pick(m).id, rnd(4)),
      (m) => R.indentNode(m, pick(m).id),
      (m) => R.outdentNode(m, pick(m).id),
      (m) => R.reorderNode(m, pick(m).id, rnd(2) ? 1 : -1),
      (m) => R.setText(m, pick(m).id, `text ${rnd(999)}`),
      (m) => R.setAttr(m, pick(m).id, ['color', 'fold', 'pin'][rnd(3)], rnd(3) ? rnd(6) : undefined),
      (m) => R.duplicateBranch(m, pick(m).id),
      (m) => { const n = pick(m); return R.splitNode(m, n.id, rnd(Math.max(1, n.text.length))); },
      (m) => R.mergeIntoPrevious(m, pick(m).id),
      (m) => R.pasteLines(m, pick(m).id, '- x\n  - y\nz'),
      (m) => R.applyPatch(m, [{ type: 'relation-add', relation: { from: pick(m).id, to: pick(m).id, label: 'r', attrs: {} } }]),
      (m) => R.applyPatch(m, [{ type: 'mode', mode: ['right', 'bottom', null][rnd(3)] }]),
    ];
    for (let k = 0; k < 10000; k++) {
      const m = sample();
      const start = shapeOf(m);
      const patches = [];
      const steps = 1 + rnd(12);
      for (let s = 0; s < steps; s++) {
        const p = changes[rnd(changes.length)](m);
        if (p) patches.push(p);
      }
      patches.reverse().forEach((p) => R.undoPatch(m, p));
      if (shapeOf(m) !== start) assert.fail(`sequence ${k} didn't undo back`);
    }
  });

  await t('the layout block: a branch’s own layout and a nudge, by id; the whole map laid out one way lets them go, its nudges kept', () => {
    const m = sample();
    const c = m.root.children[2];
    R.setBranchLayout(m, c.id, 'bottom');
    assert.ok(c.anchor && R.branchLayoutOf(m, c.id) === 'bottom', 'C given its id and its layout');
    const nudged = R.setNudge(m, 'a', 12.4, -3.6);
    assert.deepStrictEqual(R.nodeNudge(m, 'a'), [12, -4]);
    const text = R.writeOutline(m, '');
    const back = R.parseOutline(text).model;
    assert.strictEqual(R.branchLayoutOf(back, c.id), 'bottom', 'read back by its id');
    assert.deepStrictEqual(R.nodeNudge(back, 'a'), [12, -4]);
    R.undoPatch(m, nudged);
    assert.strictEqual(R.nodeNudge(m, 'a'), null);
    assert.strictEqual(R.setNudge(m, 'b', 0, 0), null, 'no nudge to take off: no change');
    R.setNudge(m, 'b', 5, 5);
    R.setMapLayout(m, 'radial');
    assert.strictEqual(m.mode, 'radial');
    assert.strictEqual(R.branchLayoutOf(m, c.id), null, 'its own layout let go');
    assert.deepStrictEqual(R.nodeNudge(m, 'b'), [5, 5], 'nudges kept');
    R.clearNudges(m, 'b');
    assert.strictEqual(m.layout, null, 'nothing left: no block');
    R.setBranchLayout(m, m.root.id, 'left');
    assert.strictEqual(m.mode, 'left', 'the root’s layout is the map’s');
  });

  await t('Undo and Redo: typing in one node a moment apart is one step; a change of shape is its own; redone until something new', () => {
    const m = sample();
    const u = new R.UndoStack();
    const a = R.nodeById(m, 'a');
    u.push(R.setText(m, 'a', 'A b'), 'a', ['a'], 1000);
    u.push(R.setText(m, 'a', 'A bc'), 'a', ['a'], 1300);
    u.push(R.addChild(m, 'a', 'new'), null, ['a'], 1400);
    u.push(R.setText(m, 'a', 'A bcd'), 'a', ['a'], 1500);
    u.undo(m);
    assert.strictEqual(a.text, 'A bc');
    u.undo(m);
    assert.deepStrictEqual(a.children.map((c) => c.text), ['A1', 'A2']);
    assert.deepStrictEqual(u.undo(m), ['a']);
    assert.strictEqual(a.text, 'A', 'both keystrokes in one step');
    u.redo(m);
    assert.strictEqual(a.text, 'A bc');
    u.push(R.setText(m, 'a', 'Other'), null, ['a'], 9000);
    assert.ok(!u.canRedo, 'something new: nothing to redo');
    assert.ok(u.keepWhere((id) => !!R.nodeById(m, id)));
    assert.ok(!u.keepWhere(() => false) && !u.canUndo, 'read afresh without its nodes: cleared');
    // A node added, then named a while later: one step.
    const added = R.addChild(m, 'a', '');
    const id = added.selection[0];
    u.push(added, null, ['a'], 10000);
    u.naming(id);
    u.push(R.setText(m, id, 'N'), id, [id], 20000);
    u.push(R.setText(m, id, 'Na'), id, [id], 20100);
    u.undo(m);
    assert.ok(!R.nodeById(m, id), 'added and named, undone at once');
  });

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
