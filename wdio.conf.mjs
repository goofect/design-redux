// Runs the plugin inside the real Obsidian app (downloaded by wdio-obsidian-service), a
// session of its own for each spec in tests/obsidian/, on the latest version: the only
// one that matters. Used by the GitHub workflow;
// locally: npm run test:obsidian (needs a display, and access to Obsidian's downloads).
import path from 'path';
import { joinParts } from './tests/obsidian/parts.mjs';

const cacheDir = path.resolve('.obsidian-cache');

export const config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./tests/obsidian/**/*.e2e.mjs'],
  // One Obsidian at a time by default: two at once crash each other.
  maxInstances: Number(process.env.WDIO_MAX_INSTANCES || 1),

  capabilities: [
    {
      browserName: 'obsidian',
      browserVersion: 'latest',
      // A container's /dev/shm is often 64 MB: canvases fill it and Chrome kills the tab. Shared memory in /tmp instead.
      'goog:chromeOptions': { args: ['--disable-dev-shm-usage'] },
      'wdio:obsidianOptions': {
        installerVersion: 'latest',
        plugins: ['.'],
        vault: 'tests/obsidian/vault',
      },
    },
  ],

  services: ['obsidian'],
  reporters: ['obsidian'],
  cacheDir,
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  logLevel: 'warn',
  // Each spec's timings and errors, joined per version into the files tests/ci.sh reads;
  // in CI, where each spec has a job of its own, by the results job once all are in.
  onComplete() {
    if (!process.env.WDIO_KEEP_PARTS) joinParts();
  },
};
