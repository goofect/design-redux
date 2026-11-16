/*
 * Screenshot tests of docs/specimen.html (docs/DESIGN.md, "Tests"): every
 * section of the page, in light and in dark, photographed with Playwright's
 * Chromium and compared with the approved images in tests/screenshots/. A
 * change to the look is seen here before it ships.
 *
 *   node tests/screenshots.js             build the page, photograph, compare
 *   node tests/screenshots.js --update    approve what the page shows now
 *   node tests/screenshots.js library     only the sections whose name holds a word
 *
 * A section that differs leaves what was seen in tests/screenshots/failed/.
 * Not one of the test_*.js suites: it needs a browser, and the images are
 * this Mac's fonts. Playwright: npm i -D playwright && npx playwright install chromium.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const page = path.join(root, 'docs', 'specimen.html');
const approved = path.join(__dirname, 'screenshots');
const failed = path.join(approved, 'failed');
const args = process.argv.slice(2);
const update = args.includes('--update');
const only = args.filter((a) => !a.startsWith('--'));
const WIDTH = 1440;
// A pixel counts as changed past this much difference in any channel; a section fails past this share of changed pixels.
const CHANNEL = 24;
const SHARE = 0.0005;

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    console.log('not ok  Playwright is not installed: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  execFileSync(process.execPath, [path.join(root, 'build.mjs')], { stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(root, 'tools', 'specimen.mjs')], { stdio: 'pipe' });
  fs.rmSync(failed, { recursive: true, force: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
  const tab = await context.newPage();
  let shots = 0;
  const differ = [];
  const seen = new Set();
  for (const scheme of ['light', 'dark']) {
    await tab.goto(`${pathToFileURL(page).href}?scheme=${scheme}`);
    await tab.evaluate(() => document.fonts.ready);
    const names = await tab.$$eval('[data-shot]', (els) => els.map((el) => el.dataset.shot));
    for (const name of names.filter((n) => !only.length || only.some((o) => n.includes(o)))) {
      const file = `${name}-${scheme}.png`;
      seen.add(file);
      const image = await tab.locator(`[data-shot="${name}"]`).screenshot({ animations: 'disabled' });
      shots++;
      const was = path.join(approved, file);
      if (update || !fs.existsSync(was)) {
        if (!update) differ.push(`${file}: no approved image (node tests/screenshots.js --update)`);
        else fs.writeFileSync(was, image);
        continue;
      }
      const before = fs.readFileSync(was);
      if (before.equals(image)) continue;
      // Not byte for byte: count the pixels that changed, in the browser, which can read a PNG.
      const share = await tab.evaluate(async ({ a, b, channel }) => {
        const load = async (data) => { const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode(); return img; };
        const [x, y] = [await load(a), await load(b)];
        if (x.width !== y.width || x.height !== y.height) return 1;
        const read = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
        const [p, q] = [read(x), read(y)];
        let changed = 0;
        for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) > channel || Math.abs(p[i + 1] - q[i + 1]) > channel || Math.abs(p[i + 2] - q[i + 2]) > channel) changed++;
        return changed / (p.length / 4);
      }, { a: before.toString('base64'), b: image.toString('base64'), channel: CHANNEL });
      if (share <= SHARE) continue;
      fs.mkdirSync(failed, { recursive: true });
      fs.writeFileSync(path.join(failed, file), image);
      differ.push(`${file}: ${(share * 100).toFixed(2)}% of its pixels changed (seen: tests/screenshots/failed/${file})`);
    }
  }
  await browser.close();
  if (!only.length) {
    const stale = fs.readdirSync(approved).filter((f) => f.endsWith('.png') && !seen.has(f));
    if (update) stale.forEach((f) => fs.rmSync(path.join(approved, f)));
    else stale.forEach((f) => differ.push(`${f}: approved, but the page has no such section`));
  }
  if (differ.length) {
    console.log(differ.map((d) => `not ok  ${d}`).join('\n'));
    process.exit(1);
  }
  console.log(`screenshots: ${shots} sections ${update ? 'approved' : 'match the approved images'}, light and dark, ${WIDTH}px wide`);
})();
