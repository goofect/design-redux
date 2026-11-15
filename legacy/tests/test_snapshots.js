// tools/snapshot-diff.mjs, which compares the UI snapshots the
// real-Obsidian tests save with main's last ones: a PNG read back as
// written, a change found and boxed, antialiasing let through, and a
// folder's snapshots named new, gone, resized or unchanged.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const { readPng, writePng, compare, diffFolders } = await import('../tools/snapshot-diff.mjs');
  let passed = 0;
  const t = (name, fn) => {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  };
  const image = (width, height, fill) => {
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) pixels.set(fill, i * 4);
    return { width, height, pixels };
  };

  t('a PNG written is read back the same', () => {
    const img = image(7, 5, [10, 200, 30, 255]);
    img.pixels.set([1, 2, 3, 4], 4 * 12);
    const back = readPng(writePng(img));
    assert.deepStrictEqual([back.width, back.height], [7, 5]);
    assert.ok(back.pixels.equals(img.pixels));
  });

  t('a change is counted and boxed; a shade of antialiasing is not', () => {
    const a = image(10, 10, [255, 255, 255, 255]);
    const b = image(10, 10, [255, 255, 255, 255]);
    b.pixels.set([240, 240, 240, 255], 0);
    assert.strictEqual(compare(a, b).changed, 0, 'within the tolerance');
    b.pixels.set([0, 0, 0, 255], (3 * 10 + 4) * 4);
    b.pixels.set([0, 0, 0, 255], (6 * 10 + 8) * 4);
    const result = compare(a, b);
    assert.strictEqual(result.changed, 2);
    assert.deepStrictEqual(result.box, { left: 4, top: 3, right: 8, bottom: 6 });
  });

  t('a folder against another: unchanged, changed, new, gone and resized', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-snap-'));
    const [before, after] = ['before', 'after'].map((d) => (fs.mkdirSync(path.join(dir, d)), path.join(dir, d)));
    const put = (d, name, img) => fs.writeFileSync(path.join(d, `${name}.png`), writePng(img));
    put(before, 'same', image(4, 4, [9, 9, 9, 255]));
    put(after, 'same', image(4, 4, [9, 9, 9, 255]));
    put(before, 'moved', image(4, 4, [9, 9, 9, 255]));
    put(after, 'moved', image(4, 4, [200, 9, 9, 255]));
    put(before, 'gone', image(4, 4, [0, 0, 0, 255]));
    put(after, 'new', image(4, 4, [0, 0, 0, 255]));
    put(before, 'size', image(4, 4, [0, 0, 0, 255]));
    put(after, 'size', image(5, 4, [0, 0, 0, 255]));
    const { lines, pictures } = diffFolders(before, after);
    assert.deepStrictEqual(lines.map((l) => l.split(/\s+/)[0] + ' ' + l.split(/\s+/)[1].replace(':', '')), ['gone gone', 'changed moved', 'new new', 'unchanged same', 'resized size']);
    assert.deepStrictEqual(pictures.map((p) => p.name), ['moved.diff.png']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
