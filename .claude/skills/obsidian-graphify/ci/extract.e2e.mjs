// Starts a real Obsidian (wdio-obsidian-service), runs scripts/extract-live.js inside it, and
// writes the live components as graphify JSON. browser and expect are WebdriverIO's globals.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.env.OBSIDIAN_GRAPH_OUT || 'obsidian-graph');
const source = fs.readFileSync(path.join(here, '..', 'scripts', 'extract-live.js'), 'utf8');

describe('Obsidian components', function () {
  it('extracts the live app', async function () {
    await browser.executeObsidian(({ app }) => new Promise((r) => app.workspace.onLayoutReady(r)));
    await browser.waitUntil(() => browser.executeObsidian(({ app }) => app.metadataCache.inProgressTaskCount === 0), { timeout: 60000 });
    // Open one note in each mode and a few core views, so their components exist.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getMarkdownFiles()[0];
      if (file) await app.workspace.getLeaf(true).openFile(file);
      for (const type of ['graph', 'search', 'backlink', 'outline', 'tag', 'bookmarks'])
        if (app.viewRegistry.viewByType[type] && !app.workspace.getLeavesOfType(type).length)
          await app.workspace.getRightLeaf(false)?.setViewState({ type });
    });
    // Returned as text: WebDriver's own serialisation drops some values of a graph this size.
    const graph = JSON.parse(await browser.executeObsidian(({ app, obsidian }, src, options) =>
      JSON.stringify(new Function('app', 'obsidian', 'options', src)(app, obsidian, options)),
    source, { depth: Number(process.env.OBSIDIAN_GRAPH_DEPTH || 2) }));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'live.json'), JSON.stringify(graph, null, 1));
    console.log(`live: ${graph.nodes.length} nodes, ${graph.links.length} links`, JSON.stringify(graph.inventory.counts));
    expect(graph.nodes.length).toBeGreaterThan(500);
  });
});
