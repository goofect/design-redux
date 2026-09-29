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
/* Nothing is set up by hand: it's read from the links. Of three notes */
/* all linked to one another, the one in between is the one broader   */
/* than one and narrower than the other, where broader means linked    */
/* with more notes. Notes linked with as many are told apart by which  */
/* way their one-way links run, read the way the vault mostly uses     */
/* them, then by how deep in folders they sit. Only notes take part:   */
/* tags, attachments and missing notes keep their lines as they are.   */
/*                                                                     */
/* The graph itself is Obsidian's. What it's given to draw passes      */
/* through here first, and its notes and lines are told, as they draw, */
/* when a route makes them part of what's hovered — all behind checks, */
/* so a graph that isn't built this way is simply left alone.          */
/* ------------------------------------------------------------------ */

const ROUTE_SEP = '\n';
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** One key for a line, whichever end it's read from. */
function routeKey(a, b) {
  return a < b ? a + ROUTE_SEP + b : b + ROUTE_SEP + a;
}

/** The graph's notes: not tags, attachments or notes that don't exist yet. */
function isRoutedNode(node) {
  return !!node && (!node.type || node.type === 'focused');
}

/** A path the graph shows as a note (so not an image or a PDF). */
function isNotePath(path) {
  return /\.(md|canvas)$/i.test(path);
}

/**
 * How broad each note is, from every link in the vault: the notes it's
 * linked with either way, and how its one-way links lean — whether it
 * more often links to notes that don't link back, or is linked by them.
 * Which of those makes a note the broader depends on the vault: where
 * one-way links mostly run from the note linked with more to the note
 * linked with fewer, linking out is broad; where they mostly run the
 * other way, being linked is.
 */
function linkStats(resolvedLinks) {
  const out = new Map();
  const near = new Map();
  const add = (map, key, value) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(value);
  };
  Object.keys(resolvedLinks || {}).forEach((from) => {
    if (!isNotePath(from)) return;
    const targets = resolvedLinks[from] || {};
    Object.keys(targets).forEach((to) => {
      if (to === from || !isNotePath(to)) return;
      add(out, from, to);
      add(near, from, to);
      add(near, to, from);
    });
  });
  const breadth = new Map();
  near.forEach((set, id) => breadth.set(id, set.size));
  const outward = new Map();
  let down = 0;
  let up = 0;
  out.forEach((targets, from) => {
    targets.forEach((to) => {
      const back = out.get(to);
      if (back && back.has(from)) return;
      const a = breadth.get(from) || 0;
      const b = breadth.get(to) || 0;
      if (a > b) down++;
      else if (a < b) up++;
      outward.set(from, (outward.get(from) || 0) + 1);
      outward.set(to, (outward.get(to) || 0) - 1);
    });
  });
  const sign = down >= up ? 1 : -1;
  const lean = new Map();
  outward.forEach((n, id) => lean.set(id, n * sign));
  return { breadth, lean };
}

/** The notes from broadest to narrowest. */
function rankNotes(ids, near, stats) {
  const breadth = (id) =>
    stats && stats.breadth && stats.breadth.has(id) ? stats.breadth.get(id) : near.get(id).size;
  const lean = (id) => (stats && stats.lean && stats.lean.get(id)) || 0;
  const depth = (id) => id.split('/').length;
  return ids.slice().sort(
    (a, b) =>
      breadth(b) - breadth(a) ||
      lean(b) - lean(a) ||
      depth(a) - depth(b) ||
      (a < b ? -1 : a > b ? 1 : 0)
  );
}

/**
 * What the graph is to draw with links through notes between. `nodes`
 * is the graph's own data — { id: { type, links: { id: true } } } —
 * and isn't changed; what comes back has the long lines left out.
 *
 * A line a–b is left out when some note c is linked with both and sits
 * between them, broader than one and narrower than the other. The
 * lines a–c and c–b stay, or are themselves left out for a note between
 * them in turn — so a route always remains, each step narrower.
 */
function routeGraph(nodes, stats) {
  const ids = Object.keys(nodes).filter((id) => isRoutedNode(nodes[id]));
  const near = new Map(ids.map((id) => [id, new Set()]));
  ids.forEach((id) => {
    const links = nodes[id].links || {};
    Object.keys(links).forEach((to) => {
      if (to === id || !near.has(to)) return;
      near.get(id).add(to);
      near.get(to).add(id);
    });
  });

  const order = rankNotes(ids, near, stats);
  const rank = new Map(order.map((id, i) => [id, i]));

  const hidden = new Map();
  const hide = (a, b) => {
    if (!hidden.has(a)) hidden.set(a, new Set());
    if (!hidden.has(b)) hidden.set(b, new Set());
    hidden.get(a).add(b);
    hidden.get(b).add(a);
  };
  order.forEach((a) => {
    const ra = rank.get(a);
    near.get(a).forEach((b) => {
      const rb = rank.get(b);
      if (rb <= ra) return;
      const fewer = near.get(a).size <= near.get(b).size ? near.get(a) : near.get(b);
      const more = fewer === near.get(a) ? near.get(b) : near.get(a);
      for (const c of fewer) {
        const rc = rank.get(c);
        if (rc > ra && rc < rb && more.has(c)) {
          hide(a, b);
          return;
        }
      }
    });
  });

  const kept = new Map();
  near.forEach((set, id) => {
    const gone = hidden.get(id);
    kept.set(id, gone ? new Set(Array.from(set).filter((x) => !gone.has(x))) : set);
  });

  const drawn = {};
  Object.keys(nodes).forEach((id) => {
    const node = nodes[id];
    const gone = hidden.get(id);
    if (!gone || !node.links) {
      drawn[id] = node;
      return;
    }
    const links = {};
    Object.keys(node.links).forEach((to) => {
      if (!gone.has(to)) links[to] = node.links[to];
    });
    drawn[id] = Object.assign({}, node, { links });
  });

  return { nodes: drawn, hidden, kept, rank };
}

/**
 * What a hovered note lights up beyond its own lines: each note it's
 * linked with only by a route, and the shortest routes to it — every
 * note and line on them, one step narrower at a time.
 */
function routeLight(plan, id) {
  const lit = { nodes: new Set(), links: new Set() };
  const partners = plan && plan.hidden.get(id);
  if (!partners) return lit;
  const { kept, rank } = plan;

  const walk = (from, lo, hi, down) => {
    const dist = new Map([[from, 0]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const u = queue[i];
      const ru = rank.get(u);
      (kept.get(u) || []).forEach((v) => {
        if (dist.has(v)) return;
        const rv = rank.get(v);
        if (down ? rv <= ru || rv > hi : rv >= ru || rv < lo) return;
        dist.set(v, dist.get(u) + 1);
        queue.push(v);
      });
    }
    return dist;
  };

  partners.forEach((p) => {
    lit.nodes.add(p);
    const [top, bottom] = rank.get(id) < rank.get(p) ? [id, p] : [p, id];
    const lo = rank.get(top);
    const hi = rank.get(bottom);
    const fromTop = walk(top, lo, hi, true);
    const total = fromTop.get(bottom);
    if (total === undefined) return;
    const fromBottom = walk(bottom, lo, hi, false);
    fromTop.forEach((du, u) => {
      kept.get(u).forEach((v) => {
        if (rank.get(v) <= rank.get(u)) return;
        const dv = fromBottom.get(v);
        if (dv === undefined || du + 1 + dv !== total) return;
        lit.links.add(routeKey(u, v));
        lit.nodes.add(u);
        lit.nodes.add(v);
      });
    });
  });
  lit.nodes.delete(id);
  return lit;
}

/** Every line some route runs along. */
function routeLines(plan) {
  const used = new Set();
  plan.hidden.forEach((partners, id) => {
    routeLight(plan, id).links.forEach((key) => used.add(key));
  });
  return used;
}

/**
 * How big the graph would draw each note: by the lines it has, counted
 * as Obsidian counts them, before any are left out — so a note keeps
 * its size when its lines become routes.
 */
function linkWeights(nodes) {
  const weights = {};
  Object.keys(nodes).forEach((id) => {
    weights[id] = weights[id] || 0;
    const links = nodes[id].links || {};
    Object.keys(links).forEach((to) => {
      if (!hasOwn(nodes, to)) return;
      weights[id]++;
      weights[to] = (weights[to] || 0) + 1;
    });
  });
  return weights;
}

/* -- drawing: what the graph's notes and lines do when one is hovered - */

function routesOf(renderer) {
  const state = renderer && renderer.drRoutes;
  return state && state.plan ? state : null;
}

function hoveredOf(renderer) {
  return typeof renderer.getHighlightNode === 'function' ? renderer.getHighlightNode() : null;
}

/** What the hovered note lights, worked out once per hover. */
function litFor(state, id) {
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
function routedNodeRender() {
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
function routedLinkRender() {
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

class GraphRoutes extends Feature {
  constructor(plugin) {
    super(plugin);
    this.graphs = new Set();
    this.watched = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'graphRoutes',
        name: 'Links through notes between',
        desc: 'Add a switch to the graph\'s Display settings that draws a link through the note in between — Westminster system → Ministerial responsibility → Individual responsibility — rather than straight across. Hovering a note still lights up everything it links to.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'toggle-graph-routes',
        name: 'Graph: links through notes between, on or off',
        check: () => this.enabled && !!this.commandGraph(),
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
      if (graph) graph.view.containerEl.querySelectorAll('.dr-graph-routes').forEach((el) => el.remove());
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
    const on = this.isOn(graph.type);
    if (on && !graph.renderer.drRoutes) this.patch(graph);
    else if (!on && graph.renderer.drRoutes) this.unpatch(graph.renderer);
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
    const tip =
      'Where a note links to two that link to each other, draw its link to the narrower one through the broader.';
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

    const plan = routeGraph(nodes, linkStats(resolved));

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

    plan.data = Object.assign({}, data, {
      nodes: plan.nodes,
      weights: data.weights || linkWeights(data.nodes),
    });
    return plan;
  }
}

GraphRoutes.settingKey = 'graphRoutes';
