/* ------------------------------------------------------------------ */
/* Mind map: a look into a folded branch                               */
/*                                                                    */
/* Pointing at a fold's count — or Shift-Space on a folded node — lists */
/* what it holds, as the canvas's peek does; picking one opens the     */
/* folds on the way to it and goes to it, as one step of Undo.         */
/* ------------------------------------------------------------------ */

import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { FoldPopover } from '../ui/245-hover-popover.js';
import { nodeById } from '../tree/400-tree-model.js';
import { applyPatch } from '../tree/404-tree-ops.js';
import { nodeLabel } from './423-mindmap-scene.js';
import { countBelow } from './424-mindmap-render.js';

/* How many of a fold's nodes the list shows. */
export const PEEK_MOST = 14;

export class MindMapPeek {
  peekAllowed() {
    return !this.plugin || this.plugin.settings.mindmapPeek !== false;
  }

  /** A fold's count, drawn: pointing at it peeks. */
  peekOn(knob, id) {
    if (!this.peekAllowed()) return;
    if (!this.popover) this.popover = new FoldPopover();
    const folded = () => {
      const n = this.model && nodeById(this.model, id);
      return this.peekAllowed() && knob.isConnected && !!n && !!n.attrs.fold;
    };
    this.popover.attach(knob, folded, (pop) => this.fillPeek(pop, id), 'below');
  }

  /** A folded node's list shown now, by its box. */
  peek(id) {
    const n = this.model && nodeById(this.model, id);
    const el = this.renderer && this.renderer.nodeEls.get(id);
    if (!n || !n.attrs.fold || !el || !this.peekAllowed()) return;
    if (!this.popover) this.popover = new FoldPopover();
    this.popover.show(el, (pop) => this.fillPeek(pop, id), 'below');
    const first = this.popover.el && this.popover.el.querySelector('.dr-fold-list-row');
    if (first && typeof first.focus === 'function') first.focus();
  }

  /** What a fold holds, in reading order, set in by depth. */
  fillPeek(pop, id) {
    pop.addClass('dr-fold-list');
    const n = nodeById(this.model, id);
    if (!n) return;
    const inside = [];
    const go = (x, depth) => x.children.forEach((c) => (inside.push([c, depth]), go(c, depth + 1)));
    go(n, 0);
    pop.createDiv({ cls: 'dr-fold-list-head', text: inside.length === 1 ? '1 node folded away' : `${inside.length} nodes folded away` });
    const list = pop.createDiv({ cls: 'dr-fold-list-rows' });
    inside.slice(0, PEEK_MOST).forEach(([c, depth]) => {
      const row = list.createDiv({ cls: 'dr-fold-list-row' });
      row.style.setProperty('--dr-depth', String(depth));
      asButton(row);
      row.createSpan({ cls: 'dr-fold-list-label', text: nodeLabel(c) || 'Untitled' });
      if (c.children.length) row.createSpan({ cls: 'dr-fold-list-count', text: `+${countBelow(c)}` });
      onActivate(row, () => this.openTo(c.id));
    });
    if (inside.length > PEEK_MOST) list.createDiv({ cls: 'dr-fold-list-more', text: `and ${inside.length - PEEK_MOST} more` });
  }

  /** The folds on the way to a node opened, and the view brought round to it. */
  openTo(id) {
    this.closePeek();
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    const ops = [];
    for (let p = n.parent; p; p = p.parent) if (p.attrs.fold) ops.unshift({ type: 'attr', id: p.id, key: 'fold', value: undefined });
    if (ops.length) this.apply(applyPatch(this.model, ops, [id]));
    if (typeof this.rememberLook === 'function') this.rememberLook();
    this.select(id);
    this.reveal(id);
    if (this.root && typeof this.root.focus === 'function') this.root.focus();
  }

  closePeek() {
    if (this.popover) this.popover.hide();
  }
}
