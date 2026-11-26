// Records what Obsidian does around a plugin at startup, into window.__probe.
const { Plugin } = require('obsidian');
module.exports = class ProbeA extends Plugin {
  async onload() {
    const P = (window.__probe ??= { t0: performance.now(), log: [] });
    const log = (k, v = {}) => P.log.push([Math.round(performance.now() - P.t0), `a:${k}`, v]);
    const { vault, metadataCache, workspace } = this.app;
    const styleVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
    log('onload-start', { files: vault.getFiles().length, layoutReady: workspace.layoutReady, styles: styleVar('--probe-a') });
    let creates = 0;
    this.registerEvent(vault.on('create', () => { creates++; }));
    this.registerEvent(metadataCache.on('finished', () => log('finished', { creates })));
    const cached = () => vault.getMarkdownFiles().filter((f) => metadataCache.getFileCache(f)).length;
    const pending = () => metadataCache.inProgressTaskCount;  // internal
    this.registerEvent(metadataCache.on('resolved', () => log('resolved', { creates, cached: cached(), pending: pending(), resolvedSources: Object.keys(metadataCache.resolvedLinks).length })));
    this.registerEvent(workspace.on('layout-ready', () => log('layout-ready-event')));
    this.registerEvent(vault.on('modify', (f) => log('modify', { path: f.path })));
    workspace.onLayoutReady(() => log('onLayoutReady', {
      files: vault.getFiles().length, creates,
      cached: cached(), pending: pending(),
      styles: styleVar('--probe-a'),
    }));
    await new Promise((r) => window.setTimeout(r, 500)); // a slow onload: does the next plugin wait?
    log('onload-end', { styles: styleVar('--probe-a') });
  }
};
