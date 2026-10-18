/* ------------------------------------------------------------------ */
/* Mind map: pointer and keys                                          */
/*                                                                    */
/* Drag the background, or scroll, to pan; pinch or Ctrl and the wheel  */
/* to zoom about the pointer. Click a node to select it, double-click   */
/* or start typing to edit it, its knob to fold it. Drag a node onto    */
/* another to hang it there — onto its top or bottom edge to go beside  */
/* it — with a ghost showing where it would land. Keys: arrows walk;    */
/* Enter adds after, Tab under; Delete removes; Alt and the arrows move */
/* a node; Space folds; Ctrl or Cmd Z and Y undo and redo. Paste puts   */
/* lines in as nodes.                                                  */
/* ------------------------------------------------------------------ */

import { mixInto } from '../core/080-feature.js';
import { nodeById } from '../tree/400-tree-model.js';
import { addChild, addSibling, indentNode, moveNode, outdentNode, pasteLines, removeNode, reorderNode } from '../tree/404-tree-ops.js';
import { nodeNudge, setNudge } from '../tree/406-tree-layout-block.js';
import { MindMapView } from './421-mindmap-view.js';
import { screenToPlane } from './423-mindmap-scene.js';

/* How far a node is dragged before it's a drag and not a click. */
export const DRAG_START = 5;

/** Where a node dropped at a point would go: { parentId, index, target, zone }, or null. Not into its own branch. */
export function dropTarget(model, scene, draggedId, point, vertical) {
  const dragged = nodeById(model, draggedId);
  if (!dragged) return null;
  let found = null;
  scene.boxes.forEach((b, id) => {
    if (found || id === draggedId) return;
    if (point.x < b.x || point.x > b.x + b.width || point.y < b.y || point.y > b.y + b.height) return;
    found = { id, b };
  });
  if (!found) return null;
  const target = nodeById(model, found.id);
  for (let p = target; p; p = p.parent) if (p === dragged) return null;
  const along = vertical ? (point.x - found.b.x) / found.b.width : (point.y - found.b.y) / found.b.height;
  const list = target.parent ? target.parent.children : null;
  if (list && along < 0.25) return { parentId: target.parent.id, index: list.indexOf(target), target: target.id, zone: 'before' };
  if (list && along > 0.75) return { parentId: target.parent.id, index: list.indexOf(target) + 1, target: target.id, zone: 'after' };
  return { parentId: target.id, index: target.children.length, target: target.id, zone: 'child' };
}

class MindMapInput {
  listen() {
    const root = this.root;
    let drag = null;
    this.registerDomEvent(root, 'pointerdown', (evt) => {
      if (evt.button !== 0 || (evt.target.closest && evt.target.closest('.dr-mindmap-bar, .dr-mindmap-outline, .dr-mindmap-failure, .dr-mindmap-editor'))) return;
      if (typeof root.focus === 'function') root.focus();
      if (this.editing) this.closeEditor(false);
      const knob = evt.target.closest && evt.target.closest('.dr-mindmap-knob');
      const id = this.renderer.nodeAt(evt.target);
      if (knob && id) {
        this.toggleFold(id);
        return;
      }
      if (!this.camera) return;
      if (id) this.select(id);
      drag = { x: evt.clientX, y: evt.clientY, cx: this.camera.x, cy: this.camera.y, moved: false, node: id && !nodeById(this.model, id).virtual && nodeById(this.model, id) !== this.model.root ? id : null, onNode: !!id };
      if (typeof root.setPointerCapture === 'function' && evt.pointerId !== undefined) {
        try {
          root.setPointerCapture(evt.pointerId);
        } catch (err) {
          /* not captured: the moves still come while over it */
        }
      }
    });
    this.registerDomEvent(root, 'pointermove', (evt) => {
      if (!drag) return;
      const dx = evt.clientX - drag.x;
      const dy = evt.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_START) return;
      drag.moved = true;
      if (drag.onNode) {
        if (drag.node) this.dragNode(drag, evt);
        return;
      }
      this.camera = { x: drag.cx - dx / this.camera.zoom, y: drag.cy - dy / this.camera.zoom, zoom: this.camera.zoom };
      this.queueDraw();
    });
    const end = (evt) => {
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.ghost) this.dropNode(d);
      else if (!d.moved && !d.onNode) this.select(null);
    };
    this.registerDomEvent(root, 'pointerup', end);
    this.registerDomEvent(root, 'pointercancel', () => {
      if (drag && drag.ghost) this.clearDrag(drag);
      drag = null;
    });
    this.registerDomEvent(root, 'dblclick', (evt) => {
      const id = this.renderer.nodeAt(evt.target);
      if (id && !(evt.target.closest && evt.target.closest('.dr-mindmap-knob'))) this.edit(id);
    });
    this.registerDomEvent(root, 'wheel', (evt) => this.wheel(evt), { passive: false });
    this.registerDomEvent(root, 'keydown', (evt) => this.key(evt));
    this.registerDomEvent(root, 'paste', (evt) => this.paste(evt));
    // Leaving the view writes what's waiting.
    this.registerDomEvent(root, 'focusout', (evt) => {
      if (!root.contains(evt.relatedTarget)) this.flushSave();
    });
  }

  /** A node held and moved: a ghost under the pointer, and where it would land marked. */
  dragNode(d, evt) {
    if (!d.ghost) {
      d.ghost = this.renderer.plane.createDiv({ cls: 'dr-mindmap-ghost' });
      const el = this.renderer.nodeEls.get(d.node);
      d.ghost.setText(el ? el.textContent.replace(/\d+$/, '') : '');
      if (el) el.addClass('is-dragged');
    }
    const box = typeof this.root.getBoundingClientRect === 'function' ? this.root.getBoundingClientRect() : { left: 0, top: 0 };
    const { width, height } = this.renderer.size();
    const point = screenToPlane(this.camera, width, height, evt.clientX - box.left, evt.clientY - box.top);
    d.last = { x: evt.clientX, y: evt.clientY };
    d.ghost.style.left = `${point.x + 8}px`;
    d.ghost.style.top = `${point.y + 8}px`;
    const vertical = this.mode === 'bottom' || this.mode === 'top';
    d.target = dropTarget(this.model, this.scene, d.node, point, vertical);
    this.root.querySelectorAll('.is-drop-child, .is-drop-before, .is-drop-after').forEach((el) => el.removeClass('is-drop-child', 'is-drop-before', 'is-drop-after'));
    const t = d.target && this.renderer.nodeEls.get(d.target.target);
    if (t) t.addClass(`is-drop-${d.target.zone}`);
  }

  /** Dropped on a node: moved there. Dropped clear of them all: left where it's put, as a nudge its branch follows. */
  dropNode(d) {
    const target = d.target;
    this.clearDrag(d);
    if (target) return this.apply(moveNode(this.model, d.node, target.parentId, target.index));
    if (!d.last || !this.camera) return null;
    const was = nodeNudge(this.model, d.node) || [0, 0];
    const z = this.camera.zoom;
    return this.apply(setNudge(this.model, d.node, was[0] + (d.last.x - d.x) / z, was[1] + (d.last.y - d.y) / z));
  }

  clearDrag(d) {
    if (d.ghost) d.ghost.remove();
    d.ghost = null;
    this.root.querySelectorAll('.is-dragged, .is-drop-child, .is-drop-before, .is-drop-after').forEach((el) => el.removeClass('is-dragged', 'is-drop-child', 'is-drop-before', 'is-drop-after'));
  }

  /** Scrolling pans; with Ctrl or a pinch, it zooms about the pointer. */
  wheel(evt) {
    if (!this.camera) return;
    evt.preventDefault();
    if (evt.ctrlKey || evt.metaKey) {
      const box = typeof this.root.getBoundingClientRect === 'function' ? this.root.getBoundingClientRect() : { left: 0, top: 0 };
      const { width, height } = this.renderer.size();
      const sx = evt.clientX - box.left;
      const sy = evt.clientY - box.top;
      const before = screenToPlane(this.camera, width, height, sx, sy);
      const zoom = Math.max(0.1, Math.min(3, this.camera.zoom * Math.exp(-evt.deltaY * 0.01)));
      // The point under the pointer stays under it.
      this.camera = { zoom, x: before.x - (sx - width / 2) / zoom, y: before.y - (sy - height / 2) / zoom };
    } else {
      this.camera = { x: this.camera.x + evt.deltaX / this.camera.zoom, y: this.camera.y + evt.deltaY / this.camera.zoom, zoom: this.camera.zoom };
    }
    this.queueDraw();
  }

  /** The keys of the map, while nothing's being typed in. */
  key(evt) {
    if (!this.model || this.editing || this.failure) return;
    // A key the card editor took — Escape closing it, say — isn't the map's too.
    if (evt.defaultPrevented || (evt.target && evt.target.closest && evt.target.closest('.dr-mindmap-editor'))) return;
    const mod = evt.ctrlKey || evt.metaKey;
    if (mod && !evt.altKey && (evt.key === 'z' || evt.key === 'Z' || evt.key === 'y')) {
      evt.preventDefault();
      evt.stopPropagation();
      this.undoStep(evt.key === 'y' || evt.shiftKey);
      return;
    }
    if (mod) return;
    const sel = this.selected ? nodeById(this.model, this.selected) : null;
    const vertical = this.mode === 'bottom' || this.mode === 'top' || this.mode === 'outline';
    const leftward = this.mode === 'left';
    const done = () => {
      evt.preventDefault();
      evt.stopPropagation();
    };
    if (evt.altKey && sel && evt.key.startsWith('Arrow')) {
      const towards = vertical ? { ArrowDown: 'in', ArrowUp: 'out', ArrowRight: 'down', ArrowLeft: 'up' } : { [leftward ? 'ArrowLeft' : 'ArrowRight']: 'in', [leftward ? 'ArrowRight' : 'ArrowLeft']: 'out', ArrowDown: 'down', ArrowUp: 'up' };
      const way = towards[evt.key];
      done();
      if (way === 'in') this.apply(indentNode(this.model, sel.id));
      else if (way === 'out') this.apply(outdentNode(this.model, sel.id));
      else this.apply(reorderNode(this.model, sel.id, way === 'down' ? 1 : -1));
      return;
    }
    if (!sel) {
      if (evt.key.startsWith('Arrow') || evt.key === 'Enter' || evt.key === 'Tab') {
        done();
        this.select(this.model.root.id);
      }
      return;
    }
    const go = (n) => {
      done();
      if (!n) return;
      this.select(n.id);
      this.reveal(n.id);
    };
    const siblings = sel.parent ? sel.parent.children : this.model.free.includes(sel) ? this.model.free : [sel];
    const at = siblings.indexOf(sel);
    const open = sel.children.length && !sel.attrs.fold ? sel.children[0] : null;
    const keys = vertical
      ? { ArrowDown: open, ArrowUp: sel.parent, ArrowRight: siblings[at + 1], ArrowLeft: siblings[at - 1] }
      : { [leftward ? 'ArrowLeft' : 'ArrowRight']: open, [leftward ? 'ArrowRight' : 'ArrowLeft']: sel.parent, ArrowDown: siblings[at + 1], ArrowUp: siblings[at - 1] };
    if (evt.key in keys) return go(keys[evt.key]);
    if (evt.key === 'Enter') {
      done();
      const p = this.apply(addSibling(this.model, sel.id, '', evt.shiftKey));
      if (p) this.edit(p.selection[0]);
    } else if (evt.key === 'Tab') {
      done();
      const p = evt.shiftKey ? this.apply(outdentNode(this.model, sel.id)) : this.apply(addChild(this.model, sel.id, ''));
      if (p && !evt.shiftKey) this.edit(p.selection[0]);
    } else if (evt.key === 'Delete' || evt.key === 'Backspace') {
      done();
      this.apply(removeNode(this.model, sel.id));
    } else if (evt.key === ' ') {
      done();
      this.toggleFold(sel.id);
    } else if (evt.key === 'F2') {
      done();
      this.edit(sel.id);
    } else if (evt.key === 'Escape') {
      done();
      this.select(null);
    } else if (evt.key.length === 1 && !evt.altKey) {
      // Typing on a selected node starts it over with what's typed.
      done();
      this.edit(sel.id, evt.key);
    }
  }

  /** Lines pasted while a node's selected: under it, as nodes — a list keeping its nesting. */
  paste(evt) {
    if (!this.model || this.editing || this.failure) return;
    const text = evt.clipboardData && typeof evt.clipboardData.getData === 'function' ? evt.clipboardData.getData('text/plain') : '';
    if (!text) return;
    evt.preventDefault();
    this.apply(pasteLines(this.model, this.selected || this.model.root.id, text));
  }
}

mixInto(MindMapView, MindMapInput);
