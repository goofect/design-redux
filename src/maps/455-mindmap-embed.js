/* ------------------------------------------------------------------ */
/* Mind map: a map drawn in any note                                    */
/*                                                                    */
/* A mindmap code block — a list in it — is drawn as a map, in reading */
/* view and Live Preview. ![[Map]] of a map note, in reading view, or  */
/* of a .mindmap file, anywhere, draws that map, kept up to date as    */
/* it changes. Read-only, with the map's own renderer; a click opens   */
/* the map.                                                            */
/* ------------------------------------------------------------------ */

import { MarkdownRenderChild, TFile } from 'obsidian';
import { parseOutline } from '../tree/401-tree-outline.js';
import { parseMindmapJson } from '../tree/402-tree-json.js';
import { MINDMAP_EXTENSION, MINDMAP_VIEW } from './421-mindmap-view.js';
import { isMindMapNote, showFileAs } from './422-mindmap-takeover.js';
import { estimateSize, fitCamera, layoutScene, nodeLabel, nodeTints } from './423-mindmap-scene.js';
import { MindMapRenderer } from './424-mindmap-render.js';

/* How tall a map drawn in a note is. */
export const EMBED_HEIGHT = 320;

/** A list as a map's text: a code block's lines, taken as they are. */
function modelOf(text, kind) {
  if (kind === MINDMAP_EXTENSION) return parseMindmapJson(text);
  return parseOutline(text, { title: '' }).model;
}

/** A map drawn, read-only, into an element of a note. */
export class MapEmbed extends MarkdownRenderChild {
  constructor(el, maps, source) {
    super(el);
    this.maps = maps;
    this.source = source;
  }

  onload() {
    const el = this.containerEl;
    el.addClass('dr-mindmap-embed-host');
    this.host = el.createDiv({ cls: 'dr-mindmap dr-mindmap-embed' });
    this.host.style.height = `${EMBED_HEIGHT}px`;
    this.host.setAttribute('role', 'tree');
    this.renderer = new MindMapRenderer(this.host, {});
    const file = this.source.file;
    if (file) {
      this.host.setAttribute('aria-label', `${file.basename}, a mind map: press to open it`);
      this.host.setAttribute('tabindex', '0');
      this.registerDomEvent(this.host, 'click', () => this.open());
      this.registerDomEvent(this.host, 'keydown', (evt) => evt.key === 'Enter' && this.open());
      const vault = this.maps.app.vault;
      if (vault && typeof vault.on === 'function') this.registerEvent(vault.on('modify', (f) => f === file && this.read()));
    }
    if (typeof ResizeObserver === 'function') {
      const watch = new ResizeObserver(() => this.draw());
      watch.observe(this.host);
      this.register(() => watch.disconnect());
    }
    this.read();
  }

  /** The map's text read — from its file, or the block — and drawn. */
  async read() {
    const { file } = this.source;
    let text = this.source.text || '';
    if (file) {
      try {
        text = await this.maps.app.vault.cachedRead(file);
      } catch (err) {
        text = '';
      }
    }
    try {
      this.model = modelOf(text, file ? file.extension : 'md');
      this.error = null;
    } catch (err) {
      this.model = null;
      this.error = err;
    }
    this.draw();
  }

  draw() {
    if (!this.host) return;
    if (!this.model || !this.model.root) {
      this.host.empty();
      this.host.createDiv({ cls: 'dr-empty', text: this.error ? 'This map can’t be read.' : 'An empty map.' });
      this.renderer = new MindMapRenderer(this.host, {});
      return;
    }
    const settings = this.maps.settings || {};
    const mode = this.model.mode || settings.mindmapLayout || 'right';
    const scene = layoutScene(this.model, (n) => estimateSize(n.text || nodeLabel(n)), mode);
    const { width, height } = this.renderer.size();
    const camera = fitCamera(scene.bounds, width, height, 24);
    this.renderer.draw({ model: this.model, scene, camera, selected: null, mode, tints: nodeTints(this.model, settings.mindmapColourBy), roles: settings.mindmapArguments !== false });
  }

  /** The map opened, as a map. */
  open() {
    const file = this.source.file;
    if (!file) return;
    const leaf = this.maps.app.workspace.getLeaf(false);
    if (leaf) showFileAs(this.maps.app, leaf, MINDMAP_VIEW, file);
  }
}

export class MindMapsEmbeds {
  embedsOn() {
    return this.enabled && this.settings.mindmapEmbeds !== false;
  }

  /** The code block and the embeds, registered once; each checks the setting as it draws. */
  registerEmbeds() {
    const plugin = this.plugin;
    if (typeof plugin.registerMarkdownCodeBlockProcessor === 'function') {
      plugin.registerMarkdownCodeBlockProcessor('mindmap', (source, el, ctx) => {
        if (!this.embedsOn()) {
          el.createEl('pre').createEl('code', { text: source });
          return;
        }
        ctx.addChild(new MapEmbed(el, this, { text: source }));
      });
    }
    // ![[Map]] in reading view: a map note's embed filled with its map before Obsidian fills it with its text.
    plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.embedsOn()) return;
      el.querySelectorAll('.internal-embed:not(.dr-mindmap-embed-host)').forEach((embed) => {
        const file = this.embeddedMap(embed.getAttribute('src'), ctx.sourcePath);
        if (!file) return;
        embed.empty();
        embed.addClass('is-loaded');
        ctx.addChild(new MapEmbed(embed, this, { file }));
      });
    });
    // A .mindmap file embedded, in either view: Obsidian's embeds of other kinds of file, where this version has them.
    const registry = this.app.embedRegistry;
    if (registry && typeof registry.registerExtension === 'function' && typeof registry.unregisterExtension === 'function') {
      try {
        registry.registerExtension(MINDMAP_EXTENSION, (info, file) => {
          const el = info && info.containerEl;
          if (!el || !(file instanceof TFile)) return null;
          const child = new MapEmbed(el, this, { file });
          child.loadFile = () => child.read();
          return child;
        });
        plugin.register(() => registry.unregisterExtension(MINDMAP_EXTENSION));
      } catch (err) {
        // Taken by another plugin, or not this version's to give: a .mindmap embed stays a link.
      }
    }
  }

  /** The map an embed's link names: a map note or a .mindmap file; else null. */
  embeddedMap(src, from) {
    const cache = this.app.metadataCache;
    if (!src || !cache || typeof cache.getFirstLinkpathDest !== 'function') return null;
    const file = cache.getFirstLinkpathDest(String(src).split('#')[0].split('|')[0], from || '');
    if (!(file instanceof TFile)) return null;
    return file.extension === MINDMAP_EXTENSION || (file.extension === 'md' && isMindMapNote(this.app, file)) ? file : null;
  }
}
