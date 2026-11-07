// Runs the plugin inside the real Obsidian app (downloaded by wdio-obsidian-service), a
// session of its own for each spec in tests/obsidian/,
// on the oldest version it supports and on the latest. Used by the GitHub workflow;
// locally: npm run test:obsidian (needs a display, and access to Obsidian's downloads).
import path from 'path';
import { joinParts } from './tests/obsidian/parts.mjs';

const cacheDir = path.resolve('.obsidian-cache');

// [app version, installer version]: the oldest public release the plugin
// supports, and the newest. (The manifest's minAppVersion, 1.7.2, was an
// Insiders-only beta, which can't be downloaded without an Insiders account.)
// WDIO_VERSION=oldest or latest runs that one alone (CI gives each a job of its own);
// WDIO_LATEST_ONLY=1 is the same as latest, for a quick check.
const all = { oldest: ['1.7.7', 'earliest'], latest: ['latest', 'latest'] };
const only = process.env.WDIO_VERSION || (process.env.WDIO_LATEST_ONLY ? 'latest' : '');
const versions = only ? [all[only]] : [all.oldest, all.latest];

export const config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./tests/obsidian/**/*.e2e.mjs'],
  // One Obsidian at a time by default: two of the same version at once crash each other.
  maxInstances: Number(process.env.WDIO_MAX_INSTANCES || 1),

  capabilities: versions.map(([appVersion, installerVersion]) => ({
    browserName: 'obsidian',
    browserVersion: appVersion,
    'wdio:obsidianOptions': {
      installerVersion,
      plugins: ['.'],
      vault: 'tests/obsidian/vault',
    },
  })),

  services: ['obsidian'],
  reporters: ['obsidian'],
  cacheDir,
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  logLevel: 'warn',
  // Each spec's timings and errors, joined per version into the files tests/ci.sh reads.
  onComplete() {
    joinParts();
  },
};
