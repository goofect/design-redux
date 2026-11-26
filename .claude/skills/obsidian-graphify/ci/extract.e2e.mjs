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
    // Every core plugin on (this is a throwaway vault), so each one's commands, views and events exist;
    // the ones on by default are recorded first.
    const defaultEnabled = await browser.executeObsidian(async ({ app }) => {
      const all = app.internalPlugins?.plugins ?? {};
      const before = Object.keys(all).filter((id) => all[id].enabled);
      for (const p of Object.values(all))
        if (!p.enabled && typeof p.enable === 'function') { try { await p.enable(true); } catch { /* one that needs an account */ } }
      return before;
    });
    // Open each kind of file and every view that needs none, so their components exist.
    await browser.executeObsidian(async ({ app }) => {
      const settle = () => new Promise((r) => setTimeout(r, 150));
      const files = app.vault.getFiles();
      for (const ext of ['md', 'canvas', 'base']) {
        const file = files.find((f) => f.extension === ext);
        if (file) { try { await app.workspace.getLeaf('tab').openFile(file); } catch { /* skip */ } await settle(); }
      }
      const byFile = new Set(Object.values(app.viewRegistry.typeByExtension ?? {}));
      for (const type of Object.keys(app.viewRegistry.viewByType ?? {})) {
        if (byFile.has(type) || type === 'empty' || app.workspace.getLeavesOfType(type).length) continue;
        try { await app.workspace.getLeaf('tab').setViewState({ type, active: false }); } catch { /* skip */ }
        await settle();
      }
      const md = files.find((f) => f.extension === 'md');
      if (md) await app.workspace.getLeaf('tab').openFile(md);
      await settle();
    });
    // Returned as text: WebDriver's own serialisation drops some values of a graph this size.
    const graph = JSON.parse(await browser.executeObsidian(({ app, obsidian }, src, options) =>
      JSON.stringify(new Function('app', 'obsidian', 'options', src)(app, obsidian, options)),
    source, { depth: Number(process.env.OBSIDIAN_GRAPH_DEPTH || 2), defaultEnabled }));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'live.json'), JSON.stringify(graph, null, 1));
    console.log(`live: ${graph.nodes.length} nodes, ${graph.links.length} links`, JSON.stringify(graph.inventory.counts));
    expect(graph.nodes.length).toBeGreaterThan(500);
  });
});
