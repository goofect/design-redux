/* ------------------------------------------------------------------ */
/* Mind map: present it                                                */
/*                                                                    */
/* A map stepped through like a talk or a revision pass: the view goes */
/* to one node at a time, it and the nodes above it at full strength,  */
/* the rest faded back — or hidden till reached — and a trail at the   */
/* foot says where you are. Nothing can be changed while it runs, and  */
/* leaving puts back the view and the selection: a presentation never  */
/* changes the map. A spotlight can darken all but the node in hand,  */
/* and a node's details, kept off its card, are the speaker's notes   */
/* under the trail.                                                    */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { nodeById } from '../tree/400-tree-model.js';
import { mapPresentation } from '../tree/412-tree-present.js';
import { boundsOfBoxes, fitCamera, nodeLabel, nodeParts } from './423-mindmap-scene.js';

export class MindMapPresent {
  /** From the root, or from a node's branch. */
  present(fromId) {
    if (this.presenting || !this.model) return null;
    if (typeof this.closeEditor === 'function') this.closeEditor(false);
    const order = mapPresentation(this.model, fromId || null);
    if (!order.length) {
      new Notice('Nothing to present: this map is empty.');
      return null;
    }
    const settings = this.plugin ? this.plugin.settings : {};
    const p = { order, at: 0, reveal: false, overview: false, camera: this.camera, selected: this.selected, spot: settings.mindmapPresentSpotlight === true, notes: settings.mindmapPresentNotes !== false };
    this.presenting = p;
    this.selected = null;
    const dim = Number(settings.presentDimLevel);
    this.root.addClass('dr-presenting');
    this.root.style.setProperty('--dr-present-dim', String(dim >= 0 && dim <= 1 ? dim : 0.15));
    p.bar = this.root.createDiv({ cls: 'dr-present-bar' });
    // Its keys before the map's own, so a stray one can't change it.
    const win = this.root.ownerDocument.defaultView || window;
    p.keys = (evt) => this.presentKey(evt);
    win.addEventListener('keydown', p.keys, true);
    p.win = win;
    this.showStep(true);
    return p;
  }

  presentKey(evt) {
    const p = this.presenting;
    if (!p || !this.root.isConnected) return;
    const active = this.app && this.app.workspace && this.app.workspace.activeLeaf;
    if (active && active !== this.leaf) return;
    const t = evt.target;
    if (t && t.closest && t.closest('.modal-container, .prompt, .menu')) return;
    if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
    const keys = {
      ArrowRight: () => this.presentGo(p.at + 1),
      ' ': () => this.presentGo(p.at + 1),
      ArrowLeft: () => this.presentGo(p.at - 1),
      ArrowUp: () => {
        const up = p.order[p.at].ancestors.slice(-1)[0];
        if (up) this.presentGo(p.order.findIndex((s) => s.id === up));
      },
      ArrowDown: () => {
        const next = p.order[p.at + 1];
        if (next && next.ancestors[next.ancestors.length - 1] === p.order[p.at].id) this.presentGo(p.at + 1);
      },
      r: () => this.presentReveal(),
      R: () => this.presentReveal(),
      o: () => this.presentOverview(),
      O: () => this.presentOverview(),
      s: () => this.presentSpotlight(),
      S: () => this.presentSpotlight(),
      n: () => this.presentNotes(),
      N: () => this.presentNotes(),
      Escape: () => this.endPresent(),
    };
    evt.preventDefault();
    evt.stopPropagation();
    if (keys[evt.key]) keys[evt.key]();
  }

  presentGo(at) {
    const p = this.presenting;
    if (!p) return;
    p.at = Math.max(0, Math.min(p.order.length - 1, at));
    p.overview = false;
    this.showStep(true);
  }

  presentReveal() {
    const p = this.presenting;
    if (!p) return;
    p.reveal = !p.reveal;
    this.showStep(false);
  }

  /** All but the node in hand darkened, or not. */
  presentSpotlight() {
    const p = this.presenting;
    if (!p) return;
    p.spot = !p.spot;
    this.showStep(false);
  }

  /** The speaker's notes under the trail, or not. */
  presentNotes() {
    const p = this.presenting;
    if (!p) return;
    p.notes = !p.notes;
    this.showStep(false);
  }

  /** The whole map, and back to the node. */
  presentOverview() {
    const p = this.presenting;
    if (!p || !this.scene) return;
    p.overview = !p.overview;
    if (!p.overview) return this.showStep(true);
    this.fit(true);
    this.draw();
    this.drawSpot(p);
  }

  /** What a presentation marks on the nodes now: { now, lit, seen, reveal }, or null. */
  presentMarks() {
    const p = this.presenting;
    if (!p) return null;
    const step = p.order[p.at];
    return { now: step.id, lit: new Set(step.ancestors.concat([step.id])), seen: new Set(p.order.slice(0, p.at + 1).map((s) => s.id)), reveal: p.reveal };
  }

  /** The node in hand lit and the view taken to it; the trail drawn. */
  showStep(move) {
    const p = this.presenting;
    if (!p) return;
    const step = p.order[p.at];
    const box = this.scene && this.scene.boxes.get(step.id);
    if (move && box) {
      const { width, height } = this.renderer.size();
      const pad = 120;
      const b = boundsOfBoxes([box]);
      this.camera = fitCamera({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }, width, height, 0);
    }
    this.draw();
    this.drawTrail(p);
    this.drawSpot(p);
  }

  /** The spotlight round the node in hand, where the camera has it: none in the overview. */
  drawSpot(p) {
    const box = !p.overview && this.scene && this.scene.boxes.get(p.order[p.at].id);
    if (!p.spot || !box || !this.renderer) {
      if (p.spotEl) p.spotEl.remove();
      p.spotEl = null;
      return;
    }
    if (!p.spotEl) p.spotEl = this.root.createDiv({ cls: 'dr-present-spot' });
    const { width, height } = this.renderer.size();
    const zoom = this.camera.zoom;
    const x = width / 2 + (box.x + box.width / 2 - this.camera.x) * zoom;
    const y = height / 2 + (box.y + box.height / 2 - this.camera.y) * zoom;
    const r = (Math.hypot(box.width, box.height) / 2) * zoom + 24;
    p.spotEl.style.setProperty('--dr-spot-x', `${Math.round(x)}px`);
    p.spotEl.style.setProperty('--dr-spot-y', `${Math.round(y)}px`);
    p.spotEl.style.setProperty('--dr-spot-r', `${Math.round(r)}px`);
  }

  /** Root › Branch › Node · 7 of 23, each name a step back to it. */
  drawTrail(p) {
    const bar = p.bar;
    bar.empty();
    const step = p.order[p.at];
    const trail = bar.createDiv({ cls: 'dr-present-trail' });
    step.ancestors.concat([step.id]).forEach((id, i, all) => {
      const n = nodeById(this.model, id);
      const name = trail.createSpan({ cls: 'dr-present-crumb', text: n ? nodeLabel(n) || 'Untitled' : '' });
      if (id === step.id) name.addClass('is-now');
      else {
        asButton(name, 'Go to this node');
        onActivate(name, () => this.presentGo(p.order.findIndex((s) => s.id === id)));
      }
      if (i < all.length - 1) trail.createSpan({ cls: 'dr-present-sep', text: '›' });
    });
    trail.createSpan({ cls: 'dr-present-count', text: `${p.at + 1} of ${p.order.length}` });
    if (p.reveal) trail.createSpan({ cls: 'dr-present-mode', text: 'Reveal' });
    if (p.spot) trail.createSpan({ cls: 'dr-present-mode', text: 'Spotlight' });
    const exit = trail.createSpan({ cls: 'clickable-icon dr-present-exit', text: '×' });
    asButton(exit, 'Leave the presentation');
    onActivate(exit, () => this.endPresent());
    // The node's details are the speaker's: under the trail, and off the cards while notes show.
    const n = nodeById(this.model, step.id);
    const said = n ? nodeParts(n).details : '';
    this.root.toggleClass('dr-present-noted', !!p.notes);
    if (p.notes && said) bar.createDiv({ cls: 'dr-present-notes', text: said });
  }

  /** Back to the map as it was: the view and the selection. */
  endPresent() {
    const p = this.presenting;
    if (!p) return;
    this.presenting = null;
    if (p.win) p.win.removeEventListener('keydown', p.keys, true);
    if (p.bar) p.bar.remove();
    if (p.spotEl) p.spotEl.remove();
    this.root.removeClass('dr-presenting');
    this.root.removeClass('dr-present-noted');
    this.root.style.removeProperty('--dr-present-dim');
    this.camera = p.camera;
    this.selected = p.selected && nodeById(this.model, p.selected) ? p.selected : null;
    this.draw();
  }
}
