/* ------------------------------------------------------------------ */
/* Canvas: outlines in and out                                         */
/*                                                                     */
/* A branch made into a note: each card a heading, as deep as it is in */
/* the branch — deeper than six, a list item — with what else it says  */
/* under it, and a note's card as a link. And back: a note's headings, */
/* or a text card's list, made into cards its card leads to, laid out  */
/* as a tidy branch in the free space beside it.                       */
/* ------------------------------------------------------------------ */

/* Cards an outline makes never pass this many: it was likely the wrong note. */
const OUTLINE_CARD_LIMIT = 200;

/**
 * An outline from markdown: headings, by level, and list items, by how
 * far in they are, under the heading they follow. `lists`: 'always', or
 * 'fallback' — only where there are no headings. `lines`: plain lines
 * count as items too. `subpath` ("#A#B"):
 * only what's under that heading. [{ text, children }].
 */
function outlineFromMarkdown(text, opts) {
  opts = opts || {};
  const lines = String(text || '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
    .split(/\r?\n/);
  const entries = [];
  let fence = null;
  lines.forEach((line) => {
    const fenced = /^[ \t]*(```|~~~)/.exec(line);
    if (fenced) {
      if (!fence) fence = fenced[1];
      else if (fenced[1] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (h) {
      entries.push({ kind: 'heading', level: h[1].length, text: h[2].trim() });
      return;
    }
    const li = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?(.+)$/.exec(line);
    if (li) entries.push({ kind: 'item', indent: li[1].replace(/\t/g, '    ').length, text: li[2].trim() });
    // `lines`: any other line with words is an item too, as far in as it's indented.
    else if (opts.lines && line.trim()) entries.push({ kind: 'item', indent: /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length, text: line.trim() });
  });
  // Only what's under one heading, its levels counted from there.
  let range = entries;
  const want = String(opts.subpath || '').split('#').map((s) => s.trim().toLowerCase()).filter(Boolean).pop();
  if (want) {
    const at = entries.findIndex((e) => e.kind === 'heading' && e.text.toLowerCase() === want);
    if (at === -1) return [];
    const top = entries[at].level;
    const end = entries.findIndex((e, i) => i > at && e.kind === 'heading' && e.level <= top);
    range = entries.slice(at + 1, end === -1 ? entries.length : end).map((e) => (e.kind === 'heading' ? Object.assign({}, e, { level: e.level - top }) : e));
  }
  const headings = range.some((e) => e.kind === 'heading');
  const items = opts.lists === 'always' || !headings ? range : range.filter((e) => e.kind === 'heading');
  // How far in one step of a list is: the least any item is indented.
  const steps = items.filter((e) => e.kind === 'item' && e.indent > 0).map((e) => e.indent);
  const step = steps.length ? Math.min(...steps) : 4;
  const out = [];
  const stack = [{ level: 0, children: out }];
  let under = 0;
  items.forEach((e) => {
    let level;
    if (e.kind === 'heading') {
      level = e.level;
      under = e.level;
    } else {
      level = under + 1 + Math.round(e.indent / step);
    }
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node = { text: e.text, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ level, children: node.children });
  });
  return out;
}

/** How many cards an outline makes. */
function outlineSize(items) {
  return items.reduce((n, it) => n + 1 + outlineSize(it.children), 0);
}

/**
 * A branch as markdown: the root's own words first, then each card below
 * it as a heading as deep as it is — past six, as a list item — with the
 * rest of what it says beneath. Children in the order they line up.
 * `linkFor(rec)` gives a note's card its link.
 */
function branchMarkdown(model, rootId, links, linkFor) {
  links = links || arrowLinks(model);
  const sides = branchSides(model, links);
  const root = model.byId.get(rootId);
  if (!root) return '';
  const seen = new Set([rootId]);
  const out = [];
  const words = (rec) => {
    if (rec.type === 'file') return { title: linkFor(rec), body: [] };
    if (rec.type === 'link') return { title: `[${canvasCardLabel(rec)}](${rec.url})`, body: [] };
    const lines = String(rec.text || '').split(/\r?\n/);
    const first = lines.findIndex((l) => l.trim());
    if (first === -1) return { title: 'Empty card', body: [] };
    const title = lines[first].trim().replace(/^#{1,6}[ \t]+/, '').replace(/^(?:[-*+]|\d+[.)])[ \t]+/, '');
    // Its own headings would break the outline's: kept as bold lines.
    const body = lines.slice(first + 1).map((l) => l.replace(/^#{1,6}[ \t]+(.*)$/, '**$1**'));
    while (body.length && !body[0].trim()) body.shift();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    return { title, body };
  };
  const kidsOf = (id) => {
    const across = sideAxes(sides.get(id) || 'right').across;
    const other = across === 'x' ? 'y' : 'x';
    const kids = (links.children.get(id) || [])
      .map((c) => model.byId.get(c))
      .filter((c) => c && !isGroupRecord(c) && !seen.has(c.id))
      .sort((a, b) => a[across] - b[across] || a[other] - b[other]);
    kids.forEach((c) => seen.add(c.id));
    return kids;
  };
  const walk = (id, depth) => {
    kidsOf(id).forEach((rec) => {
      const { title, body } = words(rec);
      if (depth <= 6) {
        out.push(`${'#'.repeat(depth)} ${title}`, '');
        if (body.length) out.push(...body, '');
      } else {
        const pad = '\t'.repeat(depth - 7);
        out.push(`${pad}- ${title}`);
        body.filter((l) => l.trim()).forEach((l) => out.push(`${pad}  ${l.trim()}`));
      }
      walk(rec.id, depth + 1);
    });
  };
  const top = words(root);
  if (root.type === 'text') {
    if (top.body.length) out.push(...top.body, '');
  } else {
    out.push(top.title, '');
  }
  walk(rootId, 1);
  // A blank line between a list and the heading after it.
  const text = [];
  out.forEach((line, i) => {
    if (i > 0 && /^#/.test(line) && /^\t*- /.test(out[i - 1])) text.push('');
    text.push(line);
  });
  return text.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Cards for a tree, as a tidy branch growing from `root` on `side`:
 * { nodes, edges } as a canvas file holds them, new ids from `newId`.
 * Each item is { card, children }, `card` the card's data without its
 * id or place — a size, and what it is.
 */
function treeCards(root, items, side, newId) {
  const nodes = [];
  const edges = [];
  const axes = sideAxes(side);
  // In order along the way siblings line up, so the tidy keeps that order.
  let order = 0;
  const add = (parentId, item, depth) => {
    const id = newId();
    const rec = Object.assign({ id, x: 0, y: 0 }, item.card);
    const ahead = (axes.forward ? 1 : -1) * depth * 1000;
    rec[axes.depth] = root[axes.depth] + ahead;
    rec[axes.across] = order++ * 1000;
    nodes.push(rec);
    edges.push({ id: newId(), fromNode: parentId, fromSide: side, toNode: id, toSide: OPPOSITE_SIDE[side] });
    item.children.forEach((c) => add(id, c, depth + 1));
  };
  items.forEach((it) => add(root.id, it, 1));
  const model = modelFromData({ nodes: [Object.assign({}, root, { tuck: null })].concat(nodes), edges });
  const places = tidyBranch(model, root.id, side, arrowLinks(model));
  nodes.forEach((n) => {
    const at = places.get(n.id);
    if (at) Object.assign(n, at);
  });
  return { nodes, edges };
}

/** An outline's items as text cards, each tall enough for its words. */
function outlineItems(items, size) {
  const height = (text) => Math.max(size.height, 24 * Math.ceil(String(text).length / 28) + 36);
  return items.map((it) => ({ card: { type: 'text', text: it.text, width: size.width, height: height(it.text) }, children: outlineItems(it.children, size) }));
}

/** Text cards for an outline, laid out from `root`. */
function outlineCards(root, items, side, size, newId) {
  return treeCards(root, outlineItems(items, size), side, newId);
}

/**
 * Cards (items as treeCards takes them) that a card leads to, as a tidy
 * branch in the nearest free space on the side its branch grows — after
 * any it leads to already, which stay where they are. Saved, one step of
 * Undo. `zoom`: brought into view, the card with them; `select`: the
 * first one made selected. { nodes, edges } as made, or null.
 */
function growCards(plugin, view, node, items, opts = {}) {
  const canvas = view && view.canvas;
  if (!canvas || !node || !items.length || typeof canvas.importData !== 'function') return null;
  const fold = plugin.feature(CanvasFold);
  if (fold) fold.settle(view);
  const model = canvasModel(canvas);
  const root = model.byId.get(node.id);
  if (!root || root.tuck) return null;
  const links = arrowLinks(model);
  const mind = plugin.feature(CanvasMindMap);
  const side = mind ? mind.growthSide(model, links, root) : 'right';
  const made = treeCards(root, items, side, () => newCanvasId(canvas));
  // Where they go: the box they make, in the nearest free space that side.
  const box = boundsOf(made.nodes);
  const kids = shownChildren(model, links, root.id);
  const axes = sideAxes(side);
  const deep = axes.depth === 'x' ? 'width' : 'height';
  let away = canvasGap(TIDY_DEPTH_GAP);
  if (kids.length) {
    const near = axes.forward ? Math.min(...kids.map((k) => k[axes.depth])) - (root[axes.depth] + root[deep]) : root[axes.depth] - Math.max(...kids.map((k) => k[axes.depth] + k[deep]));
    if (near > 0) away = near;
  }
  const spot = freeSpot(model, root, { width: box.width, height: box.height }, side, { away });
  if (spot) {
    made.nodes.forEach((n) => {
      n.x += spot.x - box.x;
      n.y += spot.y - box.y;
    });
  }
  try {
    canvas.importData({ nodes: made.nodes, edges: made.edges });
    canvas.requestSave();
    const all = boundsOf([root].concat(made.nodes));
    if (opts.zoom && typeof canvas.zoomToBbox === 'function') {
      canvas.zoomToBbox({ minX: all.x, minY: all.y, maxX: all.x + all.width, maxY: all.y + all.height });
    }
    const first = opts.select && made.nodes[0] ? canvas.nodes.get(made.nodes[0].id) : null;
    if (first && typeof canvas.selectOnly === 'function') canvas.selectOnly(first);
    if (first && !opts.zoom && typeof canvas.panIntoView === 'function') canvas.panIntoView(first.getBBox());
  } catch (err) {
    console.error('Design Redux: could not make the cards', err);
    new Notice('Could not make the cards.');
    return null;
  }
  if (fold) fold.schedule(view);
  plugin.app.workspace.trigger('design-redux:canvas-changed', view);
  return made;
}

/** A note card as a link from a note at `from`. */
function canvasCardLink(app, rec, from) {
  const vault = app.vault;
  const file = rec.file && typeof vault.getFileByPath === 'function' ? vault.getFileByPath(rec.file) : null;
  const sub = rec.subpath || '';
  if (file && app.metadataCache && typeof app.metadataCache.fileToLinktext === 'function') {
    return `[[${app.metadataCache.fileToLinktext(file, from, true)}${sub}]]`;
  }
  return `[[${String(rec.file || '').replace(/\.md$/i, '')}${sub}]]`;
}

class CanvasBranchNote extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasBranchNote',
        name: 'Branch to note',
        desc: 'From a card’s menu: its branch written out as a note beside the canvas, a heading for each card.',
      },
    ];
  }

  sync() {}

  actions() {
    return [
      {
        id: 'canvas-branch-to-note',
        name: 'Make a note from the selected card’s branch',
        menu: 'Make a note from branch',
        icon: 'file-text',
        on: 'canvas',
        when: (ctx) => this.enabled && this.hasBranch(ctx.view, ctx.node),
        run: (ctx) => this.makeNote(ctx.view, ctx.node),
      },
    ];
  }

  hasBranch(view, node) {
    if (!view || !view.canvas || !node || isCanvasEdge(node) || isGroupNode(node)) return false;
    const model = canvasModel(view.canvas);
    return (arrowLinks(model).children.get(node.id) || []).some((id) => !isGroupRecord(model.byId.get(id)));
  }

  /** The branch written out as a note in the canvas's folder, opened in a new tab. */
  async makeNote(view, node) {
    if (!view || !view.canvas || !node) return null;
    const model = canvasModel(view.canvas);
    const root = model.byId.get(node.id);
    if (!root) return null;
    const from = view.file && view.file.path ? view.file.path : '';
    const vault = this.app.vault;
    const text = branchMarkdown(model, root.id, null, (rec) => canvasCardLink(this.app, rec, from));
    const folder = view.file && view.file.parent ? view.file.parent : null;
    const path = this.plugin.freeChildPath(folder, noteNameFrom(canvasCardLabel(root)), 'md');
    let file = null;
    try {
      file = await vault.create(path, text);
    } catch (err) {
      console.error('Design Redux: could not make the note', err);
      new Notice('Could not make the note.');
      return null;
    }
    new Notice(`Made “${file.basename}” from the branch.`);
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf) await leaf.openFile(file);
    return file;
  }
}

CanvasBranchNote.settingKey = 'canvasBranchNote';

class CanvasOutlineBranch extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasOutlineBranch',
        name: 'Outline to branch',
        desc: 'From a card’s menu: a note’s headings, or a text card’s list, made into cards it leads to.',
      },
    ];
  }

  sync() {}

  actions() {
    return [
      {
        id: 'canvas-outline-to-branch',
        name: 'Make cards from the selected card’s headings or list',
        menu: (ctx) => (this.kindOf(ctx.view, ctx.node) === 'list' ? 'Make cards from list' : 'Make cards from headings'),
        icon: 'list-tree',
        on: 'canvas',
        when: (ctx) => this.enabled && !ctx.view.canvas.readonly && !!this.kindOf(ctx.view, ctx.node),
        run: (ctx) => this.expand(ctx.view, ctx.node),
      },
    ];
  }

  /** 'headings' for a note's card with an outline, 'list' for a text card with one, or null. */
  kindOf(view, node) {
    if (!view || !view.canvas || !node || isCanvasEdge(node) || isGroupNode(node) || tuckOf(node)) return null;
    const rec = canvasModel(view.canvas).byId.get(node.id);
    if (!rec) return null;
    if (rec.type === 'text') return outlineFromMarkdown(rec.text, { lists: 'always' }).length ? 'list' : null;
    if (rec.type !== 'file' || !/\.md$/i.test(String(rec.file || ''))) return null;
    const file = typeof this.app.vault.getFileByPath === 'function' ? this.app.vault.getFileByPath(rec.file) : null;
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    return cache && ((cache.headings && cache.headings.length) || (cache.listItems && cache.listItems.length)) ? 'headings' : null;
  }

  /** The outline read from the card: its own text, or its note's. */
  async outlineOf(rec) {
    if (rec.type === 'text') return outlineFromMarkdown(rec.text, { lists: 'always' });
    const file = this.app.vault.getFileByPath(rec.file);
    if (!file) return [];
    const text = await this.app.vault.cachedRead(file);
    return outlineFromMarkdown(text, { lists: 'fallback', subpath: rec.subpath });
  }

  /**
   * The outline made into cards the card leads to, laid out as a tidy
   * branch in the nearest free space on the side its branch grows —
   * after any cards it leads to already, which stay where they are.
   */
  async expand(view, node) {
    const canvas = view && view.canvas;
    if (!canvas || !node) return null;
    const root = canvasModel(canvas).byId.get(node.id);
    if (!root || root.tuck) return null;
    const items = await this.outlineOf(root);
    const count = outlineSize(items);
    if (!count) {
      new Notice('There’s no outline to make cards from.');
      return null;
    }
    if (count > OUTLINE_CARD_LIMIT) {
      new Notice(`That would make ${count} cards; ${OUTLINE_CARD_LIMIT} is the most at once.`);
      return null;
    }
    const base = (canvas.config && canvas.config.defaultTextNodeDimensions) || { width: 250, height: 60 };
    return growCards(this.plugin, view, node, outlineItems(items, base), { zoom: true });
  }
}

CanvasOutlineBranch.settingKey = 'canvasOutlineBranch';
