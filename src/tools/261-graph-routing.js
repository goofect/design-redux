/* ------------------------------------------------------------------ */
/* Routing the graph: the plan                                         */
/*                                                                     */
/* Worked out from the links alone, with nothing drawn: which notes    */
/* sit above which, broadest first, and the routes a line takes        */
/* through the notes between. Pure, so it's tested without a graph;   */
/* drawing it is 262-graph-routes's. See there for what it's for.      */
/* ------------------------------------------------------------------ */

export const ROUTE_SEP = '\n';

export const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** One key for a line, whichever end it's read from. */
export function routeKey(a, b) {
  return a < b ? a + ROUTE_SEP + b : b + ROUTE_SEP + a;
}

/** The graph's notes: not tags, attachments or notes that don't exist yet. */
export function isRoutedNode(node) {
  return !!node && (!node.type || node.type === 'focused');
}

/** A path the graph shows as a note (so not an image or a PDF). */
export function isNotePath(path) {
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
export function linkStats(resolvedLinks) {
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
  return { breadth, lean, sign };
}

/**
 * How two notes compare apart from where links put them: by how many
 * notes each is linked with, the lean of their one-way links, and how
 * shallow in folders they sit. Positive when `a` is the broader, 0 when
 * nothing tells them apart.
 */
export function compareBreadth(a, b, near, stats) {
  const breadth = (id) => (stats && stats.breadth && stats.breadth.has(id) ? stats.breadth.get(id) : near.get(id).size);
  const lean = (id) => (stats && stats.lean && stats.lean.get(id)) || 0;
  const depth = (id) => id.split('/').length;
  return breadth(a) - breadth(b) || lean(a) - lean(b) || depth(b) - depth(a);
}

/**
 * Which note is above which by a link that runs one way only, read the
 * way the vault mostly uses them: id -> the notes directly below it.
 */
export function oneWayAbove(ids, nodes, near, stats) {
  const below = new Map(ids.map((id) => [id, new Set()]));
  const sign = stats && stats.sign ? stats.sign : 1;
  ids.forEach((a) => {
    const links = nodes[a].links || {};
    Object.keys(links).forEach((b) => {
      if (a === b || !near.has(b)) return;
      const back = nodes[b].links || {};
      if (hasOwn(back, a)) return;
      if (sign > 0) below.get(a).add(b);
      else below.get(b).add(a);
    });
  });
  return below;
}

/**
 * The notes from broadest to narrowest: every note above the notes its
 * one-way links — and a property's parents — put below it, and among
 * those free to go either way, the broader first. Where links go round
 * in a circle, the broadest of it is taken first and the circle opened
 * there. `above` (optional) adds more: id -> notes it must be above.
 */
export function rankNotes(ids, near, stats, nodes, above) {
  const below = nodes ? oneWayAbove(ids, nodes, near, stats) : new Map(ids.map((id) => [id, new Set()]));
  if (above) {
    above.forEach((kids, id) => {
      if (!below.has(id)) return;
      kids.forEach((k) => {
        if (below.has(k) && k !== id) below.get(id).add(k);
      });
    });
  }
  const better = (a, b) => {
    const c = compareBreadth(a, b, near, stats);
    return c > 0 || (c === 0 && a < b);
  };
  const waiting = new Map(ids.map((id) => [id, 0]));
  below.forEach((kids) => kids.forEach((k) => waiting.set(k, waiting.get(k) + 1)));
  // A heap of the notes nothing left is above, the broadest on top.
  const heap = [];
  const push = (id) => {
    heap.push(id);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!better(heap[i], heap[up])) break;
      [heap[i], heap[up]] = [heap[up], heap[i]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && better(heap[l], heap[m])) m = l;
        if (r < heap.length && better(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  ids.forEach((id) => {
    if (!waiting.get(id)) push(id);
  });
  const order = [];
  const done = new Set();
  let rest = null;
  while (order.length < ids.length) {
    let id = null;
    while (heap.length && id === null) {
      const next = pop();
      if (!done.has(next)) id = next;
    }
    if (id === null) {
      // A circle: its broadest note first.
      if (!rest) rest = ids.slice().sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
      id = rest.find((x) => !done.has(x));
    }
    done.add(id);
    order.push(id);
    below.get(id).forEach((k) => {
      if (done.has(k)) return;
      waiting.set(k, waiting.get(k) - 1);
      if (waiting.get(k) === 0) push(k);
    });
  }
  return order;
}

/**
 * Whether anything tells two linked notes apart: a link one way only, a
 * property's parent, or how broad they are. Two notes nothing tells
 * apart don't put one between the others: a guess would be a route the
 * notes don't mean.
 */
export function toldApart(a, b, nodes, near, stats, parents) {
  const la = nodes[a].links || {};
  const lb = nodes[b].links || {};
  if (hasOwn(la, b) !== hasOwn(lb, a)) return true;
  if (parents && (((parents.get(a) || []).indexOf(b) !== -1) || (parents.get(b) || []).indexOf(a) !== -1)) return true;
  return compareBreadth(a, b, near, stats) !== 0;
}

/**
 * What the graph is to draw with links through notes between. `nodes`
 * is the graph's own data — { id: { type, links: { id: true } } } —
 * and isn't changed; what comes back has the long lines left out.
 *
 * A line a–b is left out when notes between them, each narrower than
 * the last, link one to the next from a to b: one note between, or
 * two. Those lines stay, or are themselves left out for notes between
 * them in turn — so a route always remains, each step narrower.
 *
 * Where notes name what they sit under (`parents`), that decides for
 * them: a line between two of them goes through the notes between when
 * one is above the other by way of them, and is left as it is when not.
 * Lines with a note the property doesn't place are still worked out.
 */
export function routeGraph(nodes, stats, parents) {
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

  const tree = parents ? parentTree(parents, near) : null;
  const order = rankNotes(ids, near, stats, nodes, tree ? tree.below : null);
  const rank = new Map(order.map((id, i) => [id, i]));

  const hidden = new Map();
  const hide = (a, b) => {
    if (!hidden.has(a)) hidden.set(a, new Set());
    if (!hidden.has(b)) hidden.set(b, new Set());
    hidden.get(a).add(b);
    hidden.get(b).add(a);
  };

  // What the property says, first: the way up the tree, where there is one.
  const routes = tree ? new Map() : null;
  if (tree) {
    ids.forEach((a) => {
      near.get(a).forEach((b) => {
        if (a >= b || !tree.places(a) || !tree.places(b)) return;
        const route = tree.route(a, b) || tree.route(b, a);
        if (!route) return;
        hide(a, b);
        routes.set(routeKey(a, b), route);
      });
    });
  }

  // The rest, from the links. Steps must be told apart, so nothing is guessed.
  const apart = (x, y) => toldApart(x, y, nodes, near, stats, parents);
  const between = (lo, hi) => (id) => {
    const r = rank.get(id);
    return r > lo && r < hi;
  };
  // Long ways round are only looked for while the graph is small enough to look quickly.
  let budget = 400000;
  order.forEach((a) => {
    const ra = rank.get(a);
    near.get(a).forEach((b) => {
      const rb = rank.get(b);
      if (rb <= ra) return;
      if (tree && tree.places(a) && tree.places(b)) return;
      const inside = between(ra, rb);
      // One note between.
      const na = near.get(a);
      const nb = near.get(b);
      const fewer = na.size <= nb.size ? na : nb;
      const more = fewer === na ? nb : na;
      for (const c of fewer) {
        if (inside(c) && more.has(c) && apart(a, c) && apart(c, b)) {
          hide(a, b);
          return;
        }
      }
      // Two: a–c–d–b, each narrower.
      if (budget <= 0) return;
      for (const d of nb) {
        if (!inside(d) || !apart(d, b)) continue;
        const nd = near.get(d);
        const small = na.size <= nd.size ? na : nd;
        const large = small === na ? nd : na;
        budget -= small.size;
        for (const c of small) {
          if (c !== d && large.has(c) && rank.get(c) > ra && rank.get(c) < rank.get(d) && apart(a, c) && apart(c, d)) {
            hide(a, b);
            return;
          }
        }
      }
    });
  });

  // How two notes are told apart goes with the plan: the lines turned broad-first ask it.
  return Object.assign(finishRoutes(nodes, near, hidden, rank, routes), { apart });
}

/**
 * The lines to draw, each running from the broader note to the narrower,
 * so the graph's arrows point down the routes. A line between notes
 * nothing tells apart keeps the way it ran. `drawn` isn't changed.
 */
export function broadFirst(drawn, rank, apart) {
  const out = Object.assign({}, drawn);
  const copied = new Set();
  const own = (id) => {
    if (!copied.has(id)) {
      out[id] = Object.assign({}, out[id], { links: Object.assign({}, out[id].links || {}) });
      copied.add(id);
    }
    return out[id].links;
  };
  Object.keys(drawn).forEach((from) => {
    const links = drawn[from] && drawn[from].links;
    if (!links || !rank.has(from)) return;
    Object.keys(links).forEach((to) => {
      if (!rank.has(to) || !out[to] || rank.get(to) >= rank.get(from) || !apart(from, to)) return;
      delete own(from)[to];
      own(to)[from] = links[to];
    });
  });
  return out;
}

/** The lines kept, and the graph's data without the ones left out. */
export function finishRoutes(nodes, near, hidden, rank, routes) {
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

  return { nodes: drawn, hidden, kept, rank, routes };
}

/**
 * The notes each note sits under, as a property names them, among the
 * notes shown: what's above a note and how far, and the way down from
 * one note to another. Null when no note shown names one.
 */
export function parentTree(parents, near) {
  const up = new Map();
  const down = new Map();
  let any = false;
  near.forEach((links, id) => {
    const above = (parents.get(id) || []).filter((p) => p !== id && near.has(p));
    if (!above.length) return;
    any = true;
    up.set(id, above);
    above.forEach((p) => {
      if (!down.has(p)) down.set(p, []);
      down.get(p).push(id);
    });
  });
  if (!any) return null;

  const memo = new Map();
  /** Every note above `id`, and how many steps up. */
  const above = (id) => {
    if (memo.has(id)) return memo.get(id);
    const dist = new Map();
    const queue = [id];
    const seen = new Set([id]);
    for (let i = 0; i < queue.length; i++) {
      const u = queue[i];
      (up.get(u) || []).forEach((p) => {
        if (seen.has(p)) return;
        seen.add(p);
        dist.set(p, (u === id ? 0 : dist.get(u)) + 1);
        queue.push(p);
      });
    }
    memo.set(id, dist);
    return dist;
  };

  /**
   * From `low` up to `high`, two or more steps above it: the notes and
   * lines of the shortest ways up — or null, where `high` isn't above
   * `low` that way, or a step of the way has no line to show it.
   */
  const route = (low, high) => {
    const total = above(low).get(high);
    if (!total || total < 2) return null;
    const toHigh = new Map([[high, 0]]);
    const queue = [high];
    for (let i = 0; i < queue.length; i++) {
      const u = queue[i];
      (down.get(u) || []).forEach((c) => {
        if (toHigh.has(c)) return;
        toHigh.set(c, toHigh.get(u) + 1);
        queue.push(c);
      });
    }
    const fromLow = above(low);
    const lit = { nodes: new Set(), links: new Set() };
    [low].concat(Array.from(fromLow.keys())).forEach((u) => {
      const du = u === low ? 0 : fromLow.get(u);
      (up.get(u) || []).forEach((p) => {
        if (!toHigh.has(p) || du + 1 + toHigh.get(p) !== total) return;
        lit.links.add(routeKey(u, p));
        lit.nodes.add(u);
        lit.nodes.add(p);
      });
    });
    for (const key of lit.links) {
      const [a, b] = key.split(ROUTE_SEP);
      if (!near.get(a) || !near.get(a).has(b)) return null;
    }
    return lit;
  };

  /** Whether the property places a note: it names what it sits under, or something names it. */
  const places = (id) => up.has(id) || down.has(id);
  const below = new Map();
  down.forEach((kids, id) => below.set(id, new Set(kids)));

  return { route, places, below };
}

/**
 * What a hovered note lights up beyond its own lines: each note it's
 * linked with only by a route, and the shortest routes to it — every
 * note and line on them, one step narrower at a time.
 */
export function routeLight(plan, id) {
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
    // Routes a property set out: already known, the way up the tree.
    const known = plan.routes && plan.routes.get(routeKey(id, p));
    if (known) {
      known.nodes.forEach((n) => lit.nodes.add(n));
      known.links.forEach((k) => lit.links.add(k));
      return;
    }
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
export function routeLines(plan) {
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
export function linkWeights(nodes) {
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

/**
 * A fingerprint of the graph's notes and their lines: the same for the same
 * data, so a plan worked out once is used again while nothing has changed.
 */
export function graphSignature(nodes) {
  let h = 0;
  let count = 0;
  const mix = (text) => {
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  };
  Object.keys(nodes).forEach((id) => {
    const node = nodes[id] || {};
    mix(id);
    mix(String(node.type || ''));
    Object.keys(node.links || {}).forEach((to) => {
      mix(to);
      count++;
    });
    mix('|');
  });
  return `${Object.keys(nodes).length}:${count}:${h}`;
}

/** How many of the graph's own lines (`nodes`) a plan draws through notes between instead. */
export function routedCount(plan, nodes) {
  let n = 0;
  const has = (a, b) => !!nodes[a] && hasOwn(nodes[a].links || {}, b);
  if (plan && plan.hidden) {
    plan.hidden.forEach((set, a) => set.forEach((b) => {
      if (a < b && (has(a, b) || has(b, a))) n++;
    }));
  }
  return n;
}
