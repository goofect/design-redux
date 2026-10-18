/* ------------------------------------------------------------------ */
/* Canvas: a branch and its outline, kept in step                       */
/*                                                                     */
/* A branch kept as an outline note — a list item a card, indented as   */
/* deep as it hangs, each carrying its card's id as a block id — and    */
/* the two kept the same: an item moved under another in the note      */
/* moves its card under that card; a card hung elsewhere on the canvas */
/* moves its item. Names follow too, and items added become cards,     */
/* cards added become items. Each side's shape is fingerprinted when   */
/* they agree, so a sync knows which one changed; where both did, it   */
/* asks which to keep. Cards keep the places they were put; new ones   */
/* go beside their parent. One Undo puts both back.                    */
/* ------------------------------------------------------------------ */

import { Modal, Notice, Setting } from 'obsidian';
import { RELATED_KEY } from '../core/020-constants.js';
import { fmGet, plainValue } from '../core/045-helpers-properties.js';
import { noteNameFrom } from '../core/047-helpers-text.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasModel } from './316-canvas-tree.js';
import { isCanvasEdge, nearestSides } from './332-canvas-arrows.js';
import { boxEdges } from './334-canvas-mindmap.js';
import { arrowLinks, branchSides, canvasCardLabel, isGroupRecord, modelFromData, sideAxes } from '../tree/400-tree-model.js';

export const OUTLINE_OF = 'outline-of';
export const OUTLINE_ROOT = 'outline-root';
export const OUTLINE_SYNCED = 'outline-synced';

/** A short fingerprint of a string. */
export function shapeHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** A tree's shape, the same however it was read: each item's id, parent, place among its siblings and words. */
export function shapeOf(items) {
  return shapeHash(items.map((i) => `${i.id}|${i.parent || ''}|${i.index}|${i.text}`).join('\n'));
}

/** The words a card stands for in an outline: its first line, a note as a link, a link as its address. */
export function outlineWords(rec) {
  if (rec.type === 'file') return `[[${String(rec.file || '').replace(/\.md$/i, '')}${rec.subpath || ''}]]`;
  if (rec.type === 'link') return String(rec.url || '');
  return canvasCardLabel(rec);
}

/** A branch of a canvas as outline items, in reading order: [{ id, parent, index, text, depth }]. */
export function branchItems(data, rootId) {
  const model = modelFromData(data);
  const links = arrowLinks(model);
  const sides = branchSides(model, links);
  const root = model.byId.get(rootId);
  if (!root) return [];
  const out = [];
  const seen = new Set([rootId]);
  const walk = (rec, parent, index, depth) => {
    out.push({ id: rec.id, parent, index, text: outlineWords(rec), depth });
    const across = sideAxes(sides.get(rec.id) || 'right').across;
    const other = across === 'x' ? 'y' : 'x';
    const kids = (links.children.get(rec.id) || [])
      .map((c) => model.byId.get(c))
      .filter((c) => c && !isGroupRecord(c) && !seen.has(c.id))
      .sort((a, b) => a[across] - b[across] || a[other] - b[other]);
    kids.forEach((c) => seen.add(c.id));
    kids.forEach((c, i) => walk(c, rec.id, i, depth + 1));
  };
  walk(root, null, 0, 0);
  return out;
}

/** An outline note's list as items: indentation for depth, a block id for a card's. Items without one are new. */
export function syncedOutlineItems(text) {
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  const out = [];
  const stack = [];
  let fresh = 0;
  body.split(/\r?\n/).forEach((line) => {
    const m = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*?)(?:[ \t]+\^([A-Za-z0-9-]+))?[ \t]*$/.exec(line);
    if (!m || !m[2].trim()) return;
    const indent = m[1].replace(/\t/g, '    ').length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].item : null;
    const index = out.filter((i) => i.parent === (parent ? parent.id : null)).length;
    const item = { id: m[3] || `new-${fresh++}`, isNew: !m[3], parent: parent ? parent.id : null, index, text: m[2].trim(), depth: stack.length };
    out.push(item);
    stack.push({ indent, item });
  });
  return out;
}

/** Items written as an outline: tabs for depth, numbered or not, each with its card's id. */
export function outlineText(items, numbered) {
  return items.map((i) => `${'\t'.repeat(i.depth)}${numbered ? '1.' : '-'} ${i.text} ^${i.id}`).join('\n') + '\n';
}

/** Pick which side wins where both changed. */
export class OutlineConflict extends Modal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    if (this.titleEl) this.titleEl.setText('Both changed');
    contentEl.createEl('p', { text: 'The canvas and the outline have both changed since they were last the same. Which should the other follow?' });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText('The canvas').setCta().onClick(() => {
        this.close();
        this.onChoose('canvas');
      }))
      .addButton((b) => b.setButtonText('The outline').onClick(() => {
        this.close();
        this.onChoose('outline');
      }))
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class CanvasOutlineSync extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasOutlineSync',
        name: 'Keep a branch and its outline in step',
        desc: 'A card’s menu keeps its branch as an outline note; after that, moving or renaming in either moves or renames in the other, and anything added to one is added to the other. Where both have changed, you choose which wins.',
      },
      {
        key: 'canvasOutlineNumbers',
        showIf: 'canvasOutlineSync',
        name: 'Numbered outlines',
        desc: 'Outline notes are numbered lists rather than bullets.',
      },
    ];
  }

  actions() {
    // A branch's card: its outline opened, or one kept.
    const branch = (ctx) => {
      const node = ctx.node;
      if (!this.enabled || !node || isCanvasEdge(node) || !this.watched.has(ctx.view)) return false;
      return (arrowLinks(canvasModel(ctx.view.canvas)).children.get(node.id) || []).length > 0;
    };
    const kept = (ctx) => this.outlinesOf(ctx.view.file).find((f) => this.outlineInfo(f).root === ctx.node.id);
    return [
      {
        id: 'canvas-outline-sync',
        name: 'Bring the outline and its canvas into step',
        menu: false,
        icon: 'refresh-cw',
        on: 'note',
        when: (ctx) => this.enabled && !!this.outlineNote(ctx.file),
        run: (ctx) => this.sync(ctx.file, true),
      },
      {
        id: 'canvas-keep-outline',
        name: 'Keep an outline of this branch',
        menu: (ctx) => (kept(ctx) ? 'Open its outline' : 'Keep an outline of this branch'),
        icon: 'list-tree',
        on: 'canvas',
        palette: false,
        when: branch,
        run: (ctx) => {
          const note = kept(ctx);
          return note ? this.app.workspace.getLeaf('split').openFile(note) : this.keep(ctx.view, ctx.node);
        },
      },
    ];
  }

  // Nothing drawn on the canvas.
  pass() {}

  register() {
    super.register();
    // Either side saved: the other follows, once it's settled, where only that side changed.
    this.plugin.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!this.enabled || !file) return;
        const notes = file.extension === 'canvas' ? this.outlinesOf(file) : this.outlineNote(file) ? [file] : [];
        notes.forEach((note) => this.later(note));
      })
    );
  }

  later(note) {
    if (!this.timers) this.timers = new Map();
    window.clearTimeout(this.timers.get(note.path));
    this.timers.set(note.path, window.setTimeout(() => this.sync(note, false), 1200));
  }

  /** The outline note's frontmatter, if it's one kept with a canvas. */
  outlineInfo(file) {
    if (!file || file.extension !== 'md') return null;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache && cache.frontmatter;
    const link = fm && fmGet(fm, OUTLINE_OF);
    const root = fm && fmGet(fm, OUTLINE_ROOT);
    if (!link || !root) return null;
    const canvas = this.app.metadataCache.getFirstLinkpathDest(plainValue(link), file.path);
    return canvas && canvas.extension === 'canvas' ? { canvas, root: String(root), synced: String(fmGet(fm, OUTLINE_SYNCED) || '') } : null;
  }

  outlineNote(file) {
    return this.outlineInfo(file) ? file : null;
  }

  /** The outline notes kept with a canvas. */
  outlinesOf(canvas) {
    return this.app.vault.getMarkdownFiles().filter((f) => {
      const info = this.outlineInfo(f);
      return info && info.canvas === canvas;
    });
  }

  /** A new outline note for the branch, beside the canvas, opened beside it. */
  async keep(view, node) {
    const canvasFile = view.file;
    const data = JSON.parse(await this.app.vault.read(canvasFile));
    const items = branchItems(data, node.id);
    if (!items.length) return null;
    const folder = canvasFile.parent || this.app.vault.getRoot();
    const path = this.plugin.freeChildPath(folder, noteNameFrom(`${items[0].text.replace(/[[\]]/g, '')} outline`), 'md');
    const link = this.app.metadataCache.fileToLinktext(canvasFile, path, true);
    const text = `---\n${OUTLINE_OF}: "[[${link}]]"\n${OUTLINE_ROOT}: ${node.id}\n${OUTLINE_SYNCED}: ${shapeOf(items)}\n---\n${outlineText(items, !!this.settings.canvasOutlineNumbers)}`;
    let note = null;
    try {
      note = await this.app.vault.create(path, text);
    } catch (err) {
      console.error('Design Redux: could not make the outline', err);
      new Notice('Could not make the outline.');
      return null;
    }
    const leaf = this.app.workspace.getLeaf('split');
    if (leaf) await leaf.openFile(note);
    return note;
  }

  /**
   * The two brought into step: whichever changed since they last agreed
   * is followed; where both did, `ask` asks, and otherwise it's left to
   * be done by hand.
   */
  async sync(note, ask) {
    const info = this.outlineInfo(note);
    if (!info) return null;
    // One at a time; and the saves a sync makes itself aren't followed.
    if (this.running || (!ask && Date.now() < (this.quietUntil || 0))) return null;
    this.running = true;
    try {
      const canvasText = await this.app.vault.read(info.canvas);
      const noteText = await this.app.vault.read(note);
      const data = JSON.parse(canvasText);
      const fromCanvas = branchItems(data, info.root);
      const fromOutline = syncedOutlineItems(noteText);
      if (!fromCanvas.length) {
        if (ask) new Notice('The card this outline follows isn’t on the canvas any more.');
        return null;
      }
      const hc = shapeOf(fromCanvas);
      const ho = shapeOf(fromOutline);
      let follow = null;
      if (hc === ho) follow = 'same';
      else if (ho === info.synced) follow = 'canvas';
      else if (hc === info.synced) follow = 'outline';
      if (follow === 'same') {
        if (info.synced !== hc) await this.stamp(note, hc);
        if (ask) new Notice('The outline and the canvas are in step.');
        return 'same';
      }
      if (!follow) {
        if (!ask) {
          new Notice(`${note.basename} and its canvas have both changed: bring them into step to choose which wins.`);
          return null;
        }
        follow = await new Promise((resolve) => new OutlineConflict(this.app, resolve).open());
        if (!follow) return null;
      }
      if (follow === 'canvas') {
        await this.writeOutline(note, noteText, fromCanvas);
      } else {
        const next = this.applyOutline(data, info.root, fromOutline);
        await this.app.vault.modify(info.canvas, JSON.stringify(next.data, null, '\t'));
        // New cards' ids into the outline, so they're matched from now on.
        await this.writeOutline(note, noteText, branchItems(next.data, info.root));
        if (next.loose) new Notice(`${next.loose} ${next.loose === 1 ? 'card' : 'cards'} taken out of the outline now hang from nothing on the canvas.`);
      }
      this.plugin.offerUndo(follow === 'canvas' ? `${note.basename} follows the canvas.` : `The canvas follows ${note.basename}.`, async () => {
        this.quietUntil = Date.now() + 2500;
        await this.app.vault.modify(info.canvas, canvasText);
        await this.app.vault.modify(note, noteText);
      });
      return follow;
    } catch (err) {
      console.error('Design Redux: could not bring the outline into step', err);
      if (ask) new Notice('Could not bring the outline and the canvas into step.');
      return null;
    } finally {
      this.running = false;
      this.quietUntil = Date.now() + 2500;
    }
  }

  async stamp(note, hash) {
    await this.app.fileManager.processFrontMatter(note, (fm) => {
      fm[OUTLINE_SYNCED] = hash;
    });
  }

  /** The note's list rewritten from the canvas, its frontmatter kept, the shape stamped. */
  async writeOutline(note, noteText, items) {
    const fmMatch = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(noteText);
    const head = fmMatch ? fmMatch[0] : '';
    const numbered = /^[ \t]*\d+[.)][ \t]/m.test(noteText.slice(head.length)) || !!this.settings.canvasOutlineNumbers;
    const hash = shapeOf(items);
    const stamped = head
      ? head.replace(new RegExp(`^${OUTLINE_SYNCED}:.*$`, 'm'), `${OUTLINE_SYNCED}: ${hash}`)
      : `---\n${OUTLINE_SYNCED}: ${hash}\n---\n`;
    await this.app.vault.modify(note, stamped + outlineText(items, numbered));
  }

  /**
   * The canvas's data made to follow the outline: names, parents and
   * order; new items as new cards beside their parent; cards no longer in
   * it let go of their branch. Existing cards keep their places but for
   * changes of order, where siblings trade places.
   */
  applyOutline(data, rootId, items) {
    data = JSON.parse(JSON.stringify(data));
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const model = modelFromData(data);
    const links = arrowLinks(model);
    const sides = branchSides(model, links);
    const before = branchItems(data, rootId);
    const inBranch = new Set(before.map((i) => i.id));
    let n = 0;
    const stamp = Date.now().toString(16);
    const freshId = () => {
      let id;
      do id = `${stamp}${(n++).toString(16).padStart(4, '0')}`.slice(-16);
      while (byId.has(id));
      return id;
    };
    const parentEdge = (childId) =>
      data.edges.find((e) => {
        const reversed = e.fromEnd === 'arrow' && (e.toEnd || 'arrow') !== 'arrow';
        return (reversed ? e.fromNode : e.toNode) === childId && !e[RELATED_KEY] && inBranch.has(reversed ? e.toNode : e.fromNode);
      });
    const ids = new Map();
    items.forEach((item) => {
      // An id the canvas doesn't have: a new card.
      if (!item.isNew && byId.has(item.id)) ids.set(item.id, item.id);
    });
    let loose = 0;
    items.forEach((item) => {
      const parentId = item.parent ? ids.get(item.parent) : null;
      let card = ids.has(item.id) ? byId.get(ids.get(item.id)) : null;
      if (!card) {
        if (!parentId) return;
        const parent = byId.get(parentId);
        const kids = items.filter((i) => i.parent === item.parent && ids.has(i.id) && i !== item).map((i) => byId.get(ids.get(i.id)));
        const lowest = kids.reduce((y, k) => Math.max(y, k.y + k.height), parent.y - 80);
        card = { id: freshId(), type: 'text', text: item.text, x: parent.x + parent.width + 80, y: lowest + 20, width: Math.max(160, Math.min(320, item.text.length * 9)), height: 60 };
        data.nodes.push(card);
        byId.set(card.id, card);
        ids.set(item.id, card.id);
        inBranch.add(card.id);
      } else if (card.type === 'text' && canvasCardLabel(card) !== item.text) {
        // Its first line renamed; what else it says kept.
        const lines = String(card.text || '').split(/\r?\n/);
        const first = lines.findIndex((l) => l.trim());
        lines[first === -1 ? 0 : first] = item.text;
        card.text = lines.join('\n');
      }
      if (!parentId) return;
      const edge = parentEdge(card.id);
      const reversed = edge && edge.fromEnd === 'arrow' && (edge.toEnd || 'arrow') !== 'arrow';
      const now = edge ? (reversed ? edge.toNode : edge.fromNode) : null;
      if (now === parentId) return;
      if (edge) data.edges.splice(data.edges.indexOf(edge), 1);
      const sidesOf = nearestSides(boxEdges(byId.get(parentId)), boxEdges(card));
      data.edges.push({ id: freshId(), fromNode: parentId, fromSide: sidesOf.from, toNode: card.id, toSide: sidesOf.to });
    });
    // Cards the outline no longer has: off the branch, left where they are.
    const kept = new Set(Array.from(ids.values()));
    before.forEach((item) => {
      if (kept.has(item.id) || !item.parent) return;
      const edge = parentEdge(item.id);
      if (edge && kept.has(edge.fromNode === item.id ? edge.toNode : edge.fromNode)) {
        data.edges.splice(data.edges.indexOf(edge), 1);
        loose++;
      }
    });
    // Order: siblings trade places along the way they're laid, each with all below it.
    const below = (id, acc) => {
      acc.push(id);
      data.edges.forEach((e) => {
        const reversed = e.fromEnd === 'arrow' && (e.toEnd || 'arrow') !== 'arrow';
        const from = reversed ? e.toNode : e.fromNode;
        const to = reversed ? e.fromNode : e.toNode;
        if (from === id && !e[RELATED_KEY] && acc.indexOf(to) === -1 && kept.has(to)) below(to, acc);
      });
      return acc;
    };
    const parents = new Set(items.map((i) => i.parent).filter(Boolean));
    parents.forEach((p) => {
      const pid = ids.get(p);
      const across = sideAxes(sides.get(pid) || 'right').across;
      const kids = items.filter((i) => i.parent === p).map((i) => byId.get(ids.get(i.id))).filter(Boolean);
      const slots = kids.map((k) => k[across]).sort((a, b) => a - b);
      kids.forEach((k, i) => {
        const delta = slots[i] - k[across];
        if (!delta) return;
        below(k.id, []).forEach((id) => (byId.get(id)[across] += delta));
      });
    });
    return { data, loose };
  }
}

CanvasOutlineSync.settingKey = 'canvasOutlineSync';
