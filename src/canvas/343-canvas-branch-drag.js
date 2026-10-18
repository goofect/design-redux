/* ------------------------------------------------------------------ */
/* Canvas: dragging a branch                                           */
/*                                                                     */
/* A card dragged brings the cards below it along, as a mind map's     */
/* branch moves with its topic. Each frame, its branch is put where it */
/* was, as far over as the card has gone. A card with nothing below    */
/* it, a group (whose cards the canvas moves already), several cards   */
/* dragged together, and a card being resized move as they always do. */
/* Dropped onto another card to hang from it, the branch is put back   */
/* first, and goes there with it.                                      */
/* ------------------------------------------------------------------ */

import { canvasReadonly, cardEditing, cardElement, liveCard, liveCards, placeCard } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasModel, saveCanvas, tuckOf } from './316-canvas-tree.js';
import { isCanvasEdge } from './332-canvas-arrows.js';
import { CanvasFold, isGroupNode } from './335-canvas-fold.js';
import { arrowLinks, branchOf } from '../tree/400-tree-model.js';

export class CanvasBranchDrag extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasBranchDrag',
        name: 'Drag a branch',
        desc: 'Dragging a card brings the cards below it along. Several cards dragged together, and groups, move as they always do.',
      },
    ];
  }

  // Nothing drawn on the canvas.
  pass() {}

  mount(view, state) {
    state.win = view.containerEl.ownerDocument.defaultView || window;
    state.down = (evt) => this.onDown(view, state, evt);
    state.move = () => this.onMove(view, state);
    state.up = () => this.onUp(view, state);
    view.contentEl.addEventListener('pointerdown', state.down, true);
    state.win.addEventListener('pointermove', state.move, true);
    state.win.addEventListener('pointerup', state.up, true);
  }

  cleanup(view, state) {
    if (!state || !state.down) return;
    view.contentEl.removeEventListener('pointerdown', state.down, true);
    state.win.removeEventListener('pointermove', state.move, true);
    state.win.removeEventListener('pointerup', state.up, true);
  }

  onDown(view, state, evt) {
    state.drag = null;
    const canvas = view.canvas;
    if (!this.enabled || evt.button !== 0 || evt.shiftKey || evt.altKey || evt.ctrlKey || evt.metaKey || !canvas || canvasReadonly(canvas)) return;
    const el = evt.target && typeof evt.target.closest === 'function' ? evt.target : null;
    const cardEl = el && el.closest('.canvas-node');
    // Not a resize handle, nor a point an arrow is drawn from.
    if (!cardEl || el.closest('.canvas-node-resizer, .canvas-node-connection-point')) return;
    const node = liveCards(canvas).find((n) => cardElement(n) === cardEl) || null;
    if (!node || isGroupNode(node) || tuckOf(node) || cardEditing(node)) return;
    // Part of a selection of several: the canvas moves those.
    const selected = this.selectedNodes(view).filter((n) => !isCanvasEdge(n));
    if (selected.length > 1 && selected.indexOf(node) !== -1) return;
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(canvas);
    const members = branchOf(model, node.id, arrowLinks(model))
      .map((id) => liveCard(canvas, id))
      .filter((n) => n && !tuckOf(n));
    if (!members.length) return;
    state.drag = { node, x: node.x, y: node.y, width: node.width, height: node.height, members: members.map((n) => ({ node: n, x: n.x, y: n.y })), moved: false };
  }

  onMove(view, state) {
    if (!state.drag) return;
    // Whether it's over a card it would hang from, marked as the pointer
    // moves; gone by the time it's let go.
    state.drag.over = !!view.contentEl.querySelector('.canvas-node[data-dr-drop-target]');
    if (state.frame2) return;
    state.frame2 = state.win.requestAnimationFrame(() => {
      state.frame2 = 0;
      this.follow(state);
    });
  }

  /** The branch put as far over as the card has gone. */
  follow(state) {
    const drag = state.drag;
    if (!drag) return;
    const { node } = drag;
    // Resized, not moved: left alone.
    if (node.width !== drag.width || node.height !== drag.height) {
      state.drag = null;
      return;
    }
    const dx = node.x - drag.x;
    const dy = node.y - drag.y;
    if (!dx && !dy && !drag.moved) return;
    drag.moved = true;
    drag.members.forEach((m) => {
      try {
        placeCard(m.node, { x: m.x + dx, y: m.y + dy, width: m.node.width, height: m.node.height });
      } catch (err) {
        /* left where it was */
      }
    });
  }

  onUp(view, state) {
    const drag = state.drag;
    if (!drag) return;
    if (state.frame2) {
      state.win.cancelAnimationFrame(state.frame2);
      state.frame2 = 0;
    }
    this.follow(state);
    state.drag = null;
    if (!drag.moved) return;
    // Dropped onto a card to hang from it: the branch goes back to where
    // it was, and the re-linking takes it there with the card.
    if (drag.over) {
      drag.members.forEach((m) => {
        try {
          placeCard(m.node, { x: m.x, y: m.y, width: m.node.width, height: m.node.height });
        } catch (err) {
          /* left where it was */
        }
      });
      return;
    }
    saveCanvas(view.canvas);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.schedule(view);
  }
}

CanvasBranchDrag.settingKey = 'canvasBranchDrag';
