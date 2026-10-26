/* ------------------------------------------------------------------ */
/* Mind map: pinned nodes, saved views, and back                       */
/*                                                                    */
/* A node can be pinned where it is: the layout leaves it there, and   */
/* what hangs from it comes along. A view of the map can be kept by    */
/* name — the node it looks at and how near — in the map's layout      */
/* block, and gone back to. And the map remembers where it was looking */
/* before each jump — to a branch, a view, a node from the outline or  */
/* a peek — so Back returns there, a step at a time.                   */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { ChoicePicker, NamePrompt } from '../ui/230-pickers.js';
import { nodeById } from '../tree/400-tree-model.js';
import { setAttr } from '../tree/404-tree-ops.js';
import { savedViews, setSavedView } from '../tree/406-tree-layout-block.js';
import { nodeLabel, pinOf } from './423-mindmap-scene.js';
import { MindMapLegend } from './431-mindmap-legend.js';

export const MAP_LOOKS_KEPT = 30;

export class MindMapViews extends MindMapLegend {
  /** A node pinned where it is now — or, pinned, let go to where the layout puts it. */
  togglePin(id) {
    const n = this.model && nodeById(this.model, id);
    const b = this.scene && this.scene.boxes.get(id);
    if (!n || n === this.model.root || !b) return;
    this.apply(setAttr(this.model, id, 'pin', pinOf(n) ? undefined : [Math.round(b.x), Math.round(b.y)]));
  }

  /** Where the map is looking, kept to come back to. */
  rememberLook() {
    if (!this.camera) return;
    if (!this.looks) this.looks = [];
    const last = this.looks[this.looks.length - 1];
    const c = this.camera;
    if (last && last.x === c.x && last.y === c.y && last.zoom === c.zoom) return;
    this.looks.push({ x: c.x, y: c.y, zoom: c.zoom });
    if (this.looks.length > MAP_LOOKS_KEPT) this.looks.shift();
  }

  /** Back to where the map was looking before the last jump. */
  lookBack() {
    const c = this.looks && this.looks.pop();
    if (!c) return;
    this.camera = c;
    this.draw();
  }

  /** The node a view is kept by: the selected one, or the one nearest the middle of the screen. */
  viewAnchor() {
    if (this.selected && this.scene && this.scene.boxes.has(this.selected)) return this.selected;
    let best = null;
    let dist = Infinity;
    if (this.scene && this.camera) {
      this.scene.boxes.forEach((b, id) => {
        const d = Math.hypot(b.x + b.width / 2 - this.camera.x, b.y + b.height / 2 - this.camera.y);
        if (d < dist) {
          dist = d;
          best = id;
        }
      });
    }
    return best;
  }

  /** The view now kept by a name, asked. */
  saveView() {
    const id = this.viewAnchor();
    const n = id && nodeById(this.model, id);
    if (!n || !this.camera) return;
    new NamePrompt(this.app, 'Keep this view as', nodeLabel(n) || 'View', (name) => this.apply(setSavedView(this.model, name, id, this.camera.zoom)), { value: nodeLabel(n) }).open();
  }

  /** A kept view gone to: its node in the middle, as near as it was. */
  goToView(name) {
    const v = savedViews(this.model)[name];
    const b = v && this.scene && this.scene.boxes.get(v.id);
    if (!b) {
      new Notice(v ? 'That view’s node is folded away or gone.' : 'No view of that name.');
      return;
    }
    this.rememberLook();
    this.camera = { x: b.x + b.width / 2, y: b.y + b.height / 2, zoom: v.zoom };
    this.selected = v.id;
    this.draw();
  }

  /** A kept view, picked by name: gone to — or, `forget`, let go. */
  chooseView(forget) {
    const names = Object.keys(savedViews(this.model));
    if (!names.length) return;
    new ChoicePicker(this.app, forget ? 'Forget a view…' : 'Go to a view…', names.map((label) => ({ label })), (item) => {
      if (forget) this.apply(setSavedView(this.model, item.label, null));
      else this.goToView(item.label);
    }).open();
  }
}
