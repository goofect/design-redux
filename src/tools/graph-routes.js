/* ------------------------------------------------------------------ */
/* The graph: a property filter, and routes through the notes between  */
/*                                                                     */
/* Filter: Obsidian's graph filters by its search, and its search      */
/* reads properties ([domain:Law]); a small field of the plugin's own  */
/* in the graph's pane writes that for you. Routes: where A links to   */
/* B and to C, and B links to C too, the long line A–C says nothing    */
/* the route A–B–C doesn't; with routes on, the long line is left out. */
/* Which lines those are is worked out here from the links alone. The  */
/* graph is drawn by Obsidian's own renderer, which has no supported   */
/* way in: both reach it behind checks, and do nothing if it changes.  */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';
import { el } from '../core/dom.js';
import { field } from '../ui/field.js';

/**
 * The links another route already makes: [[from, to]] such that `to` is
 * reached from `from` through at least one note between, within `depth` steps.
 * `links` is { from: { to: count } } (Obsidian's resolvedLinks).
 */
export function redundantLinks(links, depth = 4) {
  const out = [];
  Object.keys(links).forEach((from) => {
    const direct = Object.keys(links[from] || {}).filter((to) => to !== from);
    direct.forEach((target) => {
      const seen = new Set([from]);
      let frontier = direct.filter((d) => d !== target);
      frontier.forEach((f) => seen.add(f));
      for (let step = 0; step < depth && frontier.length; step++) {
        const next = [];
        for (const at of frontier) {
          for (const to of Object.keys(links[at] || {})) {
            if (to === target) return void out.push([from, target]);
            if (!seen.has(to)) { seen.add(to); next.push(to); }
          }
        }
        frontier = next;
      }
    });
  });
  return out;
}

const GRAPH_TYPES = ['graph', 'localgraph'];

export class GraphRoutes extends Feature {
  /** Whether a kind of graph ('graph', 'localgraph') leaves out the long lines: kept by kind, as the old plugin kept it, and off until turned on. */
  active(type) {
    return !!(this.settings.graphRouting || {})[type];
  }

  /** The kind of graph a command means: the one in the page, else the vault's. */
  currentType() {
    const view = this.app.workspace.activeLeaf && this.app.workspace.activeLeaf.view;
    const type = view && typeof view.getViewType === 'function' ? view.getViewType() : '';
    return GRAPH_TYPES.includes(type) ? type : 'graph';
  }

  enable() {
    const apply = () => this.apply();
    ['layout-change', 'design-redux:links', 'design-redux:settings'].forEach((name) => this.listen(this.app.workspace, name, apply));
    this.add(() => this.apply(true));
    this.apply();
  }

  /** Leaves out (or with `restore` puts back) the long lines in every graph that is open. Returns how many graphs it reached. */
  apply(restore) {
    const routes = redundantLinks(this.app.metadataCache.resolvedLinks || {}).map(([a, b]) => `${a}\n${b}`);
    let reached = 0;
    GRAPH_TYPES.forEach((type) => this.app.workspace.getLeavesOfType(type).forEach((leaf) => {
      const gone = new Set(restore || !this.active(type) ? [] : routes);
      const renderer = leaf.view && leaf.view.renderer;
      if (!renderer || !Array.isArray(renderer.links)) return;
      reached++;
      renderer.links.forEach((link) => {
        const key = link && link.source && link.target ? `${link.source.id}\n${link.target.id}` : null;
        if (key && link.line && typeof link.line === 'object' && 'visible' in link.line) link.line.visible = !gone.has(key);
      });
      if (typeof renderer.changed === 'function') renderer.changed();
    }));
    return reached;
  }

  async toggle(type = this.currentType()) {
    this.settings.graphRouting = Object.assign({}, this.settings.graphRouting, { [type]: !this.active(type) });
    await this.plugin.saveSettings();
    return this.active(type);
  }

  actions() {
    return [{ id: 'toggle-graph-routes', name: 'Graph: links through notes between, on or off', checked: () => this.active(this.currentType()), run: () => this.toggle() }];
  }
}
GraphRoutes.key = 'graphRoutes';
GraphRoutes.title = 'Graph routes';
GraphRoutes.section = 'Tools';
GraphRoutes.about = 'Leaves out a long line where a route through other notes says the same.';

export class GraphFilter extends Feature {
  enable() {
    const draw = () => this.drawAll();
    this.listen(this.app.workspace, 'layout-change', draw);
    this.add(() => GRAPH_TYPES.forEach((type) => this.app.workspace.getLeavesOfType(type).forEach((leaf) => {
      const bar = leaf.view && leaf.view.contentEl && Array.from(leaf.view.contentEl.children).find((c) => c.classList.contains('dr-graph-filter'));
      if (bar) bar.remove();
    })));
    this.drawAll();
  }

  drawAll() {
    GRAPH_TYPES.forEach((type) => this.app.workspace.getLeavesOfType(type).forEach((leaf) => this.draw(leaf.view, type)));
  }

  /** The filter as the graph's search reads it: "domain=Law" becomes [domain:Law], "status" becomes [status]. */
  query(text) {
    return String(text || '').split(',').map((s) => s.trim()).filter(Boolean).map((part) => { const [k, v] = part.split('=').map((x) => x.trim()); return v ? `[${k}:${v}]` : `[${k}]`; }).join(' ');
  }

  draw(view, type) {
    const host = view && view.contentEl;
    if (!host || Array.from(host.children).some((c) => c.classList.contains('dr-graph-filter'))) return;
    const bar = el(host, 'div', 'dr dr-graph-filter');
    const kept = (this.settings.graphFilters || {})[type] || {};
    field(bar, { label: 'Properties', value: kept.text || '', placeholder: 'domain=Law, status', onEnter: async (text) => {
      (this.settings.graphFilters || (this.settings.graphFilters = {}))[type] = { text };
      await this.plugin.saveData(this.settings);
      this.write(view, this.query(text));
    } });
  }

  /** Puts a query into the graph's own search field, if it still has one where it was. */
  write(view, query) {
    const input = view.contentEl.querySelector('.graph-controls input[type="search"], .graph-controls .search-input-container input');
    if (!input) return false;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
}
GraphFilter.key = 'graphProperties';
GraphFilter.title = 'Graph filter';
GraphFilter.section = 'Tools';
GraphFilter.about = 'A field in the graph that filters it by a property.';
