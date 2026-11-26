// A real Obsidian for the extractor. OBSIDIAN_APP / OBSIDIAN_INSTALLER pick versions
// (latest, earliest, latest-beta with an Insiders account, or 1.x.y); OBSIDIAN_CACHE is
// the download folder; OBSIDIAN_GRAPH_OUT the output folder (default obsidian-graph).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = path.join(os.tmpdir(), 'obsidian-graph-vault');

export const config = {
  runner: 'local',
  framework: 'mocha',
  specs: [path.join(here, 'extract.e2e.mjs')],
  maxInstances: 1,
  capabilities: [{
    browserName: 'obsidian',
    browserVersion: process.env.OBSIDIAN_APP || 'latest',
    'goog:chromeOptions': { args: ['--disable-dev-shm-usage'] },
    'wdio:obsidianOptions': { installerVersion: process.env.OBSIDIAN_INSTALLER || 'latest', vault },
  }],
  services: ['obsidian'],
  reporters: ['obsidian'],
  cacheDir: path.resolve(process.env.OBSIDIAN_CACHE || '.obsidian-cache'),
  mochaOpts: { ui: 'bdd', timeout: 120000 },
  logLevel: 'warn',
  // A small vault with every kind of file, so every view and parser has something to hold.
  onPrepare() {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.mkdirSync(path.join(vault, 'notes'), { recursive: true });
    for (let i = 1; i <= 20; i++)
      fs.writeFileSync(path.join(vault, 'notes', `Note ${i}.md`), `---\ntags: [t${i % 4}]\nstatus: draft\n---\n# Note ${i}\n\n- [ ] a task\n\nLinks to [[Note ${(i % 20) + 1}]] and ![[Board.canvas]].\n`);
    fs.writeFileSync(path.join(vault, 'Board.canvas'), JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: 'Hi', x: 0, y: 0, width: 200, height: 60 }], edges: [] }));
    fs.writeFileSync(path.join(vault, 'Notes.base'), 'views:\n  - type: table\n    name: All\n');
  },
};
