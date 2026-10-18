/* ------------------------------------------------------------------ */
/* Canvas: add or connect a card                                       */
/*                                                                     */
/* One box for what to put on the map next. What's typed is matched    */
/* against the vault's notes: one already on the canvas is joined to   */
/* rather than added twice; one that isn't comes as its card. Or it    */
/* becomes a new note, or a card with those words. Below the selected  */
/* card, where its branch grows; with none selected, in the middle of  */
/* the screen.                                                         */
/* ------------------------------------------------------------------ */

import { Notice, prepareFuzzySearch, SuggestModal } from 'obsidian';
import { RELATED_KEY } from '../core/020-constants.js';
import { byName } from '../core/030-helpers-art.js';
import { noteNameFrom } from '../core/047-helpers-text.js';
import { addArrows, addToCanvas, canvasReadonly, canvasViewport, liveCard, pickOnCanvas, requestCanvasSave } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasModel } from './316-canvas-tree.js';
import { CanvasFind } from './321-canvas-extras.js';
import { growCards } from './324-canvas-outlines.js';
import { MAP_NOTE_SIZE } from './328-canvas-vault-map.js';
import { isCanvasEdge, nearestSides } from './332-canvas-arrows.js';
import { arrowsInto, boxEdges, newCanvasId } from './334-canvas-mindmap.js';
import { CanvasFold, isGroupNode } from './335-canvas-fold.js';
import { canvasCardLabel } from '../tree/400-tree-model.js';

export const QUICK_ADD_LIMIT = 30;

export class QuickAddModal extends SuggestModal {
  constructor(app, feature, view, node) {
    super(app);
    this.feature = feature;
    this.view = view;
    this.node = node;
    this.setPlaceholder(node ? 'A note, or words for a new card, below this one' : 'A note, or words for a new card');
  }

  getSuggestions(query) {
    return this.feature.suggestions(this.view, query);
  }

  renderSuggestion(item, el) {
    el.createDiv({ text: item.title });
    if (item.note) el.createDiv({ cls: 'dr-find-where', text: item.note });
  }

  onChooseSuggestion(item) {
    this.feature.choose(this.view, this.node, item);
  }
}

export class CanvasQuickAdd extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasQuickAdd',
        name: 'Add or connect a card',
        desc: 'A box to type a note’s name or new words into: an existing note comes as its card, or is joined to if it’s on the canvas already; or it’s a new note, or a new card.',
      },
    ];
  }

  sync() {}

  actions() {
    const card = (ctx) => (ctx.node && !isCanvasEdge(ctx.node) && !isGroupNode(ctx.node) ? ctx.node : null);
    return [
      {
        // From a card's menu, joined to that card; from the palette, to the one selected, if any.
        id: 'canvas-quick-add',
        name: 'Add or connect a card…',
        icon: 'circle-plus',
        on: 'canvas',
        when: (ctx) => this.enabled && !canvasReadonly(ctx.view.canvas) && (ctx.from === 'palette' || !!card(ctx)),
        run: (ctx) => this.open(ctx.view, card(ctx)),
      },
    ];
  }

  open(view, node) {
    if (!view || !view.canvas) return;
    new QuickAddModal(this.app, this, view, node).open();
  }

  /** Notes on this canvas: path -> its card's id. */
  notesOn(view) {
    const out = new Map();
    canvasModel(view.canvas).nodes.forEach((n) => {
      if (n.type === 'file' && n.file && !out.has(n.file)) out.set(n.file, n.id);
    });
    return out;
  }

  /** What's offered for what's typed: the notes it matches, then a new note and a new card. */
  suggestions(view, query) {
    const q = String(query || '').trim();
    const on = this.notesOn(view);
    const out = [];
    if (q) {
      const match = typeof prepareFuzzySearch === 'function' ? prepareFuzzySearch(q) : (t) => (t.toLowerCase().includes(q.toLowerCase()) ? { score: 0 } : null);
      this.app.vault
        .getMarkdownFiles()
        .map((f) => ({ f, m: match(f.basename) || match(f.path) }))
        .filter((x) => x.m)
        .sort((a, b) => b.m.score - a.m.score || byName(a.f.path, b.f.path))
        .slice(0, QUICK_ADD_LIMIT)
        .forEach(({ f }) => {
          const card = on.get(f.path);
          out.push({ kind: card ? 'join' : 'note', file: f, card, title: f.basename, note: card ? 'On this canvas: join to it' : f.parent && f.parent.path !== '/' ? f.parent.path : '' });
        });
      const same = out.some((x) => x.file.basename.toLowerCase() === q.toLowerCase());
      if (!same) out.push({ kind: 'new-note', name: q, title: `New note “${q}”`, note: 'Made beside the canvas, as Obsidian makes new notes' });
      out.push({ kind: 'card', text: q, title: `New card “${q}”` });
    }
    return out;
  }

  async choose(view, node, item) {
    if (item.kind === 'join') return this.join(view, node, item.card);
    if (item.kind === 'card') return this.place(view, node, { type: 'text', text: item.text, width: 250, height: 60 });
    let file = item.file;
    if (item.kind === 'new-note') {
      file = await this.newNote(view, item.name);
      if (!file) return null;
    }
    return this.place(view, node, Object.assign({ type: 'file', file: file.path }, MAP_NOTE_SIZE));
  }

  async newNote(view, name) {
    let folder = null;
    try {
      folder = typeof this.app.fileManager.getNewFileParent === 'function' ? this.app.fileManager.getNewFileParent(view.file ? view.file.path : '') : null;
    } catch (err) {
      folder = null;
    }
    const path = this.plugin.freeChildPath(folder || this.app.vault.getRoot(), noteNameFrom(name), 'md');
    try {
      return await this.app.vault.create(path, '');
    } catch (err) {
      console.error('Design Redux: could not make the note', err);
      new Notice('Could not make the note.');
      return null;
    }
  }

  /** A card below the selected one, or in the middle of the screen. Selected, and in view. */
  place(view, node, card) {
    const canvas = view.canvas;
    if (node) return growCards(this.plugin, view, node, [{ card, children: [] }], { select: true });
    const port = canvasViewport(canvas);
    const at = port ? { x: port.x + port.width / 2, y: port.y + port.height / 2 } : { x: 0, y: 0 };
    const data = Object.assign({ id: newCanvasId(canvas), x: Math.round(at.x - card.width / 2), y: Math.round(at.y - card.height / 2) }, card);
    if (!addToCanvas(canvas, { nodes: [data], edges: [] })) return null;
    requestCanvasSave(canvas);
    const made = liveCard(canvas, data.id);
    if (made) pickOnCanvas(canvas, [made]);
    return { nodes: [data], edges: [] };
  }

  /**
   * The selected card joined to a card already on the canvas: it hangs
   * from the selected one if it hangs from nothing yet; otherwise it's
   * related, so it isn't torn from where it is. Without a selected card,
   * the card's brought into view.
   */
  join(view, node, id) {
    const canvas = view.canvas;
    const target = liveCard(canvas, id);
    if (!target) return null;
    if (!node || node.id === id) {
      const find = this.plugin.feature(CanvasFind);
      if (find) find.goTo(view, id);
      return null;
    }
    const model = canvasModel(canvas);
    const from = model.byId.get(node.id);
    const to = model.byId.get(id);
    const hangs = arrowsInto(model, id).length > 0;
    const sides = nearestSides(boxEdges(from), boxEdges(to));
    const edge = { id: newCanvasId(canvas), fromNode: node.id, fromSide: sides.from, toNode: id, toSide: sides.to };
    if (hangs) edge[RELATED_KEY] = true;
    if (!addArrows(canvas, [edge])) return null;
    requestCanvasSave(canvas);
    new Notice(hangs ? `Joined to “${canvasCardLabel(to)}”, as related: it hangs from another card already.` : `“${canvasCardLabel(to)}” now hangs from “${canvasCardLabel(from)}”.`);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.schedule(view);
    this.app.workspace.trigger('design-redux:canvas-changed', view);
    return edge;
  }
}

CanvasQuickAdd.settingKey = 'canvasQuickAdd';
