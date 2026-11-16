// What every spec in tests/obsidian/ shares. Each spec file runs in an Obsidian of its own
// (a fresh copy of the vault); suite() loads the plugin afresh, watches for errors and writes
// the spec's errors and timings as parts, which wdio.conf.mjs joins once every spec has run.
import { browser, expect } from '@wdio/globals';
import fs from 'fs';
import path from 'path';

import { OUT, PARTS } from './parts.mjs';

export { OUT };
export let version = 'unknown';

export async function shot(name) {
  fs.mkdirSync(OUT, { recursive: true });
  await browser.pause(400);
  await browser.saveScreenshot(path.join(OUT, `${version}-${name}.png`));
}

/** Reads until `ok` holds of what it got, or `ms` pass; what it read last either way. */
export async function readUntil(read, ok, ms = 8000) {
  const end = Date.now() + ms;
  let got = await read();
  while (!ok(got) && Date.now() < end) {
    await browser.pause(100);
    got = await read();
  }
  return got;
}

async function start() {
  version = await browser.executeObsidian(({ obsidian }) => obsidian.apiVersion);
  await browser.executeObsidian(async ({ app }) => {
    window.__drErrors = [];
    const original = console.error;
    console.error = (...args) => {
      window.__drErrors.push(args.map((a) => (a && a.stack) || String(a)).join(' '));
      original.apply(console, args);
    };
    window.addEventListener('error', (e) => window.__drErrors.push(String((e.error && e.error.stack) || e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__drErrors.push(String((e.reason && e.reason.stack) || e.reason)));
    await app.plugins.disablePlugin('design-redux');
    await app.plugins.enablePlugin('design-redux');
  });
  await browser.pause(1500);
}

export function suite(name, body) {
  const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  describe(name, function () {
    const timings = [];
    let started = 0;
    before(start);
    beforeEach(() => { started = Date.now(); });
    afterEach(async function () {
      if (this.currentTest) timings.push([Date.now() - started, this.currentTest.title]);
      if (this.currentTest && this.currentTest.state === 'failed') await shot(`FAILED-${this.currentTest.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}`);
    });
    after(async function () {
      const dir = path.join(PARTS, version);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${slug}.timings.json`), JSON.stringify({ perf: [], timings }));
      const errors = await browser.executeObsidian(() => window.__drErrors || []);
      fs.writeFileSync(path.join(dir, `${slug}.errors.json`), JSON.stringify(errors));
    });
    body();
    it('logged no errors of its own along the way', async function () {
      const errors = await browser.executeObsidian(() => window.__drErrors || []);
      expect(errors.filter((e) => /design redux|plugin:design-redux/i.test(e))).toEqual([]);
    });
  });
}
