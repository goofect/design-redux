// Runs the plugin inside the real Obsidian app (downloaded by wdio-obsidian-service),
// on the oldest version it supports and on the latest. Used by the GitHub workflow;
// locally: npm run test:obsidian (needs a display, and access to Obsidian's downloads).
import path from 'path';

const cacheDir = path.resolve('.obsidian-cache');

// [app version, installer version]: the manifest's minAppVersion, and the newest.
const versions = [
  ['earliest', 'earliest'],
  ['latest', 'latest'],
];

export const config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./tests/obsidian/**/*.e2e.mjs'],
  maxInstances: Number(process.env.WDIO_MAX_INSTANCES || 2),

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
};
