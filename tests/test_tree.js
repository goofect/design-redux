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

  console.log(`\n${passed} passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
