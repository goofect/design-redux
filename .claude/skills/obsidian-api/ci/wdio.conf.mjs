// Checks the obsidian-api skill's claims about Obsidian's internals in the real app
// (references/internals.md). Run it on each new Obsidian: a failing probe is a claim to correct.
//
//   npm i -D @wdio/cli @wdio/local-runner @wdio/mocha-framework wdio-obsidian-service wdio-obsidian-reporter
//   npx wdio run <skill>/ci/wdio.conf.mjs            (Linux without a display: xvfb-run -a npx wdio …)
//
// OBSIDIAN_APP and OBSIDIAN_INSTALLER pick the versions: latest (default), earliest,
// latest-beta (needs OBSIDIAN_EMAIL and OBSIDIAN_PASSWORD of an Insiders account), or 1.x.y.
// OBSIDIAN_CACHE is where Obsidian is downloaded to (default .obsidian-cache). Results go to
// ci-output/probes.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = path.join(os.tmpdir(), 'obsidian-probe-vault');

export const config = {
  runner: 'local',
  framework: 'mocha',
  specs: [path.join(here, 'probes.e2e.mjs')],
  maxInstances: 1,
  capabilities: [{
    browserName: 'obsidian',
    browserVersion: process.env.OBSIDIAN_APP || 'latest',
    // Containers often have a 64 MB /dev/shm, too small for Chromium.
    'goog:chromeOptions': { args: ['--disable-dev-shm-usage'] },
    'wdio:obsidianOptions': {
      installerVersion: process.env.OBSIDIAN_INSTALLER || 'latest',
      plugins: [path.join(here, 'probe-a'), path.join(here, 'probe-b')], // enabled in this order
      vault,
    },
  }],
  services: ['obsidian'],
  reporters: ['obsidian'],
  cacheDir: path.resolve(process.env.OBSIDIAN_CACHE || '.obsidian-cache'),
  mochaOpts: { ui: 'bdd', timeout: 60000 },
  logLevel: 'warn',
  // A vault of 40 linked notes and one CSS snippet, made fresh for each run.
  onPrepare() {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.mkdirSync(path.join(vault, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(vault, '.obsidian', 'snippets'), { recursive: true });
    for (let i = 1; i <= 40; i++)
      fs.writeFileSync(path.join(vault, 'notes', `Note ${i}.md`), `---\ntags: [t${i % 5}]\n---\n# Note ${i}\n\nLinks to [[Note ${(i % 40) + 1}]].\n`);
    fs.writeFileSync(path.join(vault, '.obsidian', 'snippets', 'probe.css'), 'body { --probe-win: snippet; --probe-snippet: yes; }\n');
    fs.writeFileSync(path.join(vault, '.obsidian', 'appearance.json'), '{ "enabledCssSnippets": ["probe"] }\n');
  },
};
