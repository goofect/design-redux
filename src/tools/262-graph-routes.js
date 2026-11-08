/* ------------------------------------------------------------------ */
/* Links through the notes between, in the graph                       */
/*                                                                     */
/* Westminster system links to Ministerial responsibility and to       */
/* Individual responsibility, and Ministerial responsibility links to  */
/* Individual responsibility too. Drawn straight, that's a triangle;   */
/* drawn through the note in between, it's what it means: Westminster  */
/* → Ministerial → Individual. With this on, the graph leaves out the  */
/* long line and keeps the route. Hovering a note still lights up      */
/* every note it links to, as a direct link would, and the lines of    */
/* the routes it takes to them.                                        */
/*                                                                     */
/* Nothing is set up by hand: it's read from the links. The notes are  */
/* put in order, broadest first: a one-way link puts the note it runs  */
/* from above the note it runs to (or below, in a vault whose notes    */
/* mostly link up to what they're part of); what that leaves open goes */
/* by how many notes each is linked with, then the lean of its one-way */
/* links, then how shallow in folders it sits. A line between two      */
/* notes is drawn through the notes between when they link one to the */
/* next, each narrower — one note between, or two. Notes nothing tells */
/* apart are left as they are rather than guessed at. Where notes name */
/* what they sit under in a property, that decides for them; the rest  */
/* are still worked out. Only notes take part: tags, attachments and   */
/* missing notes keep their lines as they are.                         */
/*                                                                     */
/* The plan is worked out in 261-graph-routing; this draws it.         */
/*                                                                     */
/* The graph itself is Obsidian's. What it's given to draw passes      */
/* through here first, and its notes and lines are told, as they draw, */
/* when a route makes them part of what's hovered — all behind checks, */
/* so a graph that isn't built this way is simply left alone.          */
/* ------------------------------------------------------------------ */

import { Setting } from 'obsidian';
import { GRAPH_TYPES } from '../core/020-constants.js';
import { fmGet, parentLinkpaths } from '../core/045-helpers-properties.js';
import { Feature } from '../core/080-feature.js';
import { broadFirst, hasOwn, isRoutedNode, linkStats, linkWeights, ROUTE_SEP, routeGraph, routeKey, routeLight, routeLines } from './261-graph-routing.js';

/* -- drawing: what the graph's notes and lines do when one is hovered - */

export function routesOf(renderer) {
  const state = renderer && renderer.drRoutes;
  return state && state.plan ? state : null;
}

export function hoveredOf(renderer) {
  return typeof renderer.getHighlightNode === 'function' ? renderer.getHighlightNode() : null;
}

/** What the hovered note lights, worked out once per hover. */
export function litFor(state, id) {
  if (state.litId !== id || state.litPlan !== state.plan) {
    state.litId = id;
    state.litPlan = state.plan;
    state.lit = routeLight(state.plan, id);
  }
  return state.lit;
}

/**
 * A note's own drawing, told that the hovered note is one of its links
 * when a route joins them. Obsidian lights a note whose links include
 * the hovered one; for the moment it draws, a routed one does.
 */
export function routedNodeRender() {
  const base = Object.getPrototypeOf(this).render;
  const renderer = this.renderer;
  const state = routesOf(renderer);
  const hovered = state && hoveredOf(renderer);
  if (
    !hovered ||
    hovered === this ||
    !this.forward ||
    hasOwn(this.forward, hovered.id) ||
    (this.reverse && hasOwn(this.reverse, hovered.id)) ||
    !litFor(state, hovered.id).nodes.has(this.id)
  ) {
    return base.apply(this, arguments);
  }
  this.forward[hovered.id] = null;
  try {
    return base.apply(this, arguments);
  } finally {
    delete this.forward[hovered.id];
  }
}

/**
 * A line's own drawing, lit as a hovered note's own lines are when it's
 * on one of that note's routes: for the moment it draws, the note it
 * starts from is the hovered one.
 */
export function routedLinkRender() {
  const base = Object.getPrototypeOf(this).render;
  const renderer = this.renderer;
  const state = routesOf(renderer);
  const hovered = state && hoveredOf(renderer);
  if (
    !hovered ||
    !this.source ||
    !this.target ||
    this.source === hovered ||
    this.target === hovered ||
    !litFor(state, hovered.id).links.has(routeKey(this.source.id, this.target.id))
  ) {
    return base.apply(this, arguments);
  }
  const own = hasOwn(renderer, 'getHighlightNode');
  const before = renderer.getHighlightNode;
  const source = this.source;
  renderer.getHighlightNode = () => source;
  try {
    return base.apply(this, arguments);
  } finally {
    if (own) renderer.getHighlightNode = before;
    else delete renderer.getHighlightNode;
  }
}

export class GraphRoutes extends Feature {
  constructor(plugin) {
    super(plugin);
    this.graphs = new Set();
    this.watched = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'graphRoutes',
        name: 'Links through concepts',
        desc: 'Draw graph links through the notes in between.',
      },
      {
        key: 'graphRouteProperty',
        type: 'text',
        showIf: 'graphRoutes',
        name: 'Parent property',
        desc: 'The property naming a note’s parent, like parent: [[Topic]].',
        placeholder: 'parent',
        fallback: '',
        suggest: 'property',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'toggle-graph-routes',
        name: 'Graph: links through notes between, on or off',
        icon: 'route',
        when: () => this.enabled && !!this.commandGraph(),
        run: () => {
          const graph = this.commandGraph();
          if (graph) this.setOn(graph.type, !this.isOn(graph.type));
        },
      },
    ];
  }

  /** The graph a command means: the one in use, or else an open one, the whole-vault graph first. */
  commandGraph() {
    const ws = this.app.workspace;
    const active = this.graphOf(ws.activeLeaf);
    if (active) return active;
    let found = null;
    ws.iterateAllLeaves((leaf) => {
      const graph = this.graphOf(leaf);
      if (graph && (!found || (found.type !== 'graph' && graph.type === 'graph'))) found = graph;
    });
    return found;
  }

  enable() {
    this.sync();
    // A different property to go by: graphs drawn by the old one, again.
    const by = (this.settings.graphRouteProperty || '').trim().toLowerCase();
    if (this.routedBy !== undefined && this.routedBy !== by) {
      this.graphs.forEach((renderer) => renderer.drRoutes && this.redraw(renderer.drRoutes.engine));
    }
    this.routedBy = by;
  }

  /**
   * What each note shown sits under, as the property names it: the notes
   * its links there lead to. Null with no property set, or none naming one.
   */
  parentsFor(nodes) {
    const prop = (this.settings.graphRouteProperty || '').trim();
    if (!prop) return null;
    const mc = this.app.metadataCache;
    if (typeof mc.getCache !== 'function' || typeof mc.getFirstLinkpathDest !== 'function') return null;
    const parents = new Map();
    Object.keys(nodes).forEach((id) => {
      if (!isRoutedNode(nodes[id])) return;
      const cache = mc.getCache(id);
      const raw = cache && fmGet(cache.frontmatter, prop);
      if (raw === undefined || raw === null || raw === '') return;
      const found = [];
      parentLinkpaths(raw).forEach((linkpath) => {
        const dest = mc.getFirstLinkpathDest(linkpath, id);
        if (dest && dest.path !== id && found.indexOf(dest.path) === -1) found.push(dest.path);
      });
      if (found.length) parents.set(id, found);
    });
    return parents.size ? parents : null;
  }

  sync() {
    this.watched.forEach((entry, controls) => {
      if (controls.isConnected) return;
      entry.mo.disconnect();
      this.watched.delete(controls);
    });
    this.graphs.forEach((renderer) => {
      if (!renderer.containerEl || !renderer.containerEl.isConnected) this.graphs.delete(renderer);
    });
    this.app.workspace.iterateAllLeaves((leaf) => this.mount(leaf));
  }

  disable() {
    this.watched.forEach((entry) => entry.mo.disconnect());
    this.watched.clear();
    this.graphs.forEach((renderer) => this.unpatch(renderer));
    this.graphs.clear();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const graph = this.graphOf(leaf);
      if (graph) graph.view.containerEl.querySelectorAll('.dr-graph-routes, .dr-graph-route-action').forEach((el) => el.remove());
      if (graph) delete graph.view.drRouteAction;
      const shown = graph && this.displayChildren(graph);
      if (shown) shown.querySelectorAll('.dr-graph-routes').forEach((el) => el.remove());
    });
  }

  isOn(type) {
    return !!(this.settings.graphRouting || {})[type];
  }

  setOn(type, on) {
    if (!this.settings.graphRouting) this.settings.graphRouting = {};
    this.settings.graphRouting[type] = !!on;
    this.plugin.saveData(this.settings);
    this.app.workspace.iterateAllLeaves((leaf) => {
      const graph = this.graphOf(leaf);
      if (!graph || graph.type !== type) return;
      this.mount(leaf);
      const toggle = graph.renderer.drRouteToggle || (this.switchOf(graph) || {}).toggle;
      if (toggle && typeof toggle.setValue === 'function' && toggle.getValue() !== !!on) toggle.setValue(!!on);
    });
  }

  /** A graph or local graph built as this expects: its view, what draws it, what feeds it. */
  graphOf(leaf) {
    if (!leaf || leaf.isDeferred || !leaf.view || typeof leaf.view.getViewType !== 'function') return null;
    const type = leaf.view.getViewType();
    if (GRAPH_TYPES.indexOf(type) === -1) return null;
    const view = leaf.view;
    const renderer = view.renderer;
    const engine = view.dataEngine || view.engine;
    if (!renderer || typeof renderer.setData !== 'function' || !Array.isArray(renderer.nodes)) return null;
    if (!engine || typeof engine.render !== 'function') return null;
    return { type, view, renderer, engine };
  }

  mount(leaf) {
    const graph = this.graphOf(leaf);
    if (!graph) return;
    this.placeSwitch(graph);
    this.placeAction(graph);
    const on = this.isOn(graph.type);
    if (on && !graph.renderer.drRoutes) this.patch(graph);
    else if (!on && graph.renderer.drRoutes) this.unpatch(graph.renderer);
  }

  /** A button in the graph's own header, lit while it's on: routes on and off in one click. */
  placeAction(graph) {
    const view = graph.view;
    let button = view.drRouteAction;
    if (!button || !button.isConnected) {
      if (typeof view.addAction !== 'function') return;
      button = view.addAction('route', 'Links through notes between', () => this.setOn(graph.type, !this.isOn(graph.type)));
      if (!button) return;
      button.addClass('dr-graph-route-action');
      view.drRouteAction = button;
    }
    const on = this.isOn(graph.type);
    button.toggleClass('is-active', on);
    button.setAttribute('aria-pressed', String(on));
  }

  /**
   * The Display section's rows. Obsidian takes a folded section's rows
   * out of the page, so they're found through the section itself where
   * that can be, and in the page where it can't.
   */
  displayChildren(graph) {
    const section = graph.engine.displayOptions;
    if (section && section.childrenEl && typeof section.childrenEl.querySelector === 'function') {
      return section.childrenEl;
    }
    const controls = graph.view.containerEl.querySelector('.graph-controls');
    return controls && controls.querySelector('.graph-control-section.mod-display .tree-item-children');
  }

  switchOf(graph) {
    const rows = this.displayChildren(graph);
    const row = rows && rows.querySelector('.dr-graph-routes');
    return row ? { row, toggle: row.drToggle } : null;
  }

  placeSwitch(graph) {
    const controls = graph.view.containerEl.querySelector('.graph-controls');
    if (controls && !this.watched.has(controls)) {
      // Restoring the graph's default settings rebuilds its panel.
      const mo = new MutationObserver(() => {
        if (!controls.isConnected || !this.enabled) return;
        const again = this.graphOf(graph.view.leaf);
        if (again) this.placeSwitch(again);
      });
      mo.observe(controls, { childList: true, subtree: true });
      this.watched.set(controls, { mo });
    }
    const rows = this.displayChildren(graph);
    if (!rows || rows.querySelector('.dr-graph-routes')) return;

    let made = null;
    const setting = new Setting(rows)
      .setName('Links through notes between')
      .setClass('mod-toggle')
      .setClass('dr-graph-routes')
      .addToggle((toggle) => {
        made = toggle;
        toggle.setValue(this.isOn(graph.type)).onChange((value) => {
          if (value !== this.isOn(graph.type)) this.setOn(graph.type, value);
        });
      });
    setting.settingEl.drToggle = made;
    graph.renderer.drRouteToggle = made;
    const tip = 'Draw links through the notes between, broad to narrow. With Arrows on, they point down.';
    if (typeof setting.setTooltip === 'function') setting.setTooltip(tip);
    else setting.settingEl.setAttribute('aria-label', tip);

    // Beside Obsidian's own Arrows switch, the first row.
    const first = rows.querySelector(':scope > .setting-item.mod-toggle:not(.dr-graph-routes)');
    if (first) first.after(setting.settingEl);
  }

  /**
   * Stand between the graph and what it's given to draw, and ask it to
   * draw again. The graph's own drawing is used throughout; notes and
   * lines are only told, while they draw, whether a route lights them.
   */
  patch(graph) {
    const { renderer, engine, type } = graph;
    const feature = this;
    const original = renderer.setData;
    const state = {
      plan: null,
      type,
      engine,
      original,
      own: hasOwn(renderer, 'setData'),
      off: false,
    };
    state.routed = function routedSetData(data) {
      if (state.off || !feature.enabled) return original.apply(this, arguments);
      let fed = data;
      let plan = null;
      try {
        plan = feature.plan(data, type);
        if (plan) fed = plan.data;
      } catch (err) {
        console.error('Design Redux: could not work out links through notes between', err);
        plan = null;
        fed = data;
      }
      state.plan = plan;
      const result = original.call(this, fed);
      feature.wrapParts(renderer);
      return result;
    };
    Object.defineProperty(renderer, 'drRoutes', { value: state, configurable: true, writable: true });
    renderer.setData = state.routed;
    this.graphs.add(renderer);
    this.redraw(engine);
  }

  unpatch(renderer) {
    const state = renderer.drRoutes;
    if (!state) return;
    state.off = true;
    state.plan = null;
    if (renderer.setData === state.routed) {
      if (state.own) renderer.setData = state.original;
      else delete renderer.setData;
    }
    (renderer.nodes || []).forEach((node) => {
      if (node.render === routedNodeRender) delete node.render;
    });
    (renderer.links || []).forEach((link) => {
      if (link.render === routedLinkRender) delete link.render;
    });
    delete renderer.drRoutes;
    this.graphs.delete(renderer);
    this.redraw(state.engine);
  }

  redraw(engine) {
    try {
      engine.render();
    } catch (err) {
      console.error('Design Redux: the graph could not redraw', err);
    }
  }

  wrapParts(renderer) {
    (renderer.nodes || []).forEach((node) => {
      if (node.render !== routedNodeRender && typeof node.render === 'function' && !hasOwn(node, 'render')) {
        node.render = routedNodeRender;
      }
    });
    (renderer.links || []).forEach((link) => {
      if (link.render !== routedLinkRender && typeof link.render === 'function' && !hasOwn(link, 'render')) {
        link.render = routedLinkRender;
      }
    });
    if (typeof renderer.changed === 'function') renderer.changed();
  }

  /**
   * The graph's data, routed. A local graph only has the lines from its
   * note outward, so the links between the notes it shows are read from
   * the vault: a route needs them. Of those, only the ones some route
   * runs along are drawn, so the local graph looks as it did apart from
   * the routes — unless its Neighbor links option shows them all anyway.
   */
  plan(data, type) {
    if (!data || !data.nodes || typeof data.nodes !== 'object') return null;
    const resolved = this.app.metadataCache.resolvedLinks || {};
    let nodes = data.nodes;
    const added = new Set();
    if (type === 'localgraph') {
      nodes = Object.assign({}, nodes);
      Object.keys(data.nodes).forEach((from) => {
        if (!isRoutedNode(data.nodes[from])) return;
        const targets = resolved[from] || {};
        Object.keys(targets).forEach((to) => {
          if (to === from || !isRoutedNode(data.nodes[to])) return;
          const links = nodes[from].links || {};
          if (hasOwn(links, to)) return;
          if (nodes[from] === data.nodes[from]) {
            nodes[from] = Object.assign({}, data.nodes[from], { links: Object.assign({}, links) });
          }
          nodes[from].links[to] = true;
          added.add(from + ROUTE_SEP + to);
        });
      });
    }

    const plan = routeGraph(nodes, linkStats(resolved), this.parentsFor(nodes));

    if (added.size) {
      const used = routeLines(plan);
      const drawnLinks = (id) => (plan.nodes[id] && plan.nodes[id].links) || {};
      const pairs = Array.from(added).map((pair) => pair.split(ROUTE_SEP));
      pairs.forEach(([from, to]) => {
        if (used.has(routeKey(from, to)) || !hasOwn(drawnLinks(from), to)) return;
        if (plan.nodes[from] === data.nodes[from]) {
          plan.nodes[from] = Object.assign({}, plan.nodes[from], { links: Object.assign({}, drawnLinks(from)) });
        }
        delete plan.nodes[from].links[to];
      });
      // A line that isn't drawn is no step for a route to take.
      pairs.forEach(([from, to]) => {
        if (hasOwn(drawnLinks(from), to) || hasOwn(drawnLinks(to), from)) return;
        if (plan.kept.get(from)) plan.kept.get(from).delete(to);
        if (plan.kept.get(to)) plan.kept.get(to).delete(from);
      });
    }

    // Each line from the broader note to the narrower: the graph's arrows point down.
    if (plan.apart) plan.nodes = broadFirst(plan.nodes, plan.rank, plan.apart);

    plan.data = Object.assign({}, data, {
      nodes: plan.nodes,
      weights: data.weights || linkWeights(data.nodes),
    });
    return plan;
  }
}

GraphRoutes.settingKey = 'graphRoutes';
