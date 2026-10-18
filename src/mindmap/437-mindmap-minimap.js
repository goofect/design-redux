/* ------------------------------------------------------------------ */
/* Mind map: the minimap                                               */
/*                                                                    */
/* In the corner, the whole map small, the part on screen outlined —   */
/* there only while the map doesn't all fit. Pressing it goes there.   */
/* The nodes are one path, drawn again only when the map's laid out  */
/* again; a pan moves just the outline.                               */
/* ------------------------------------------------------------------ */

import { mixInto } from '../core/080-feature.js';
import { MindMapView } from './421-mindmap-view.js';
import { viewBox } from './423-mindmap-scene.js';

const MINIMAP_SVG = 'http://www.w3.org/2000/svg';
export const MAP_MINIMAP_SIZE = { width: 200, height: 136 };

class MindMapMinimap {
  minimapOn() {
    return !this.plugin || this.plugin.settings.mindmapMinimap !== false;
  }

  /** The minimap as the map and the view are now. */
  drawMinimap(scene) {
    if (!this.minimapOn() || !scene || !this.camera) {
      if (this.minimapEl) this.minimapEl.addClass('is-hidden');
      return;
    }
    const b = scene.bounds;
    const { width, height } = this.renderer.size();
    const port = viewBox(this.camera, width, height);
    const fits = port.minX <= b.minX && port.minY <= b.minY && port.maxX >= b.maxX && port.maxY >= b.maxY;
    if (!this.minimapEl) this.makeMinimap();
    this.minimapEl.toggleClass('is-hidden', fits);
    if (fits) return;
    // The plane a minimap shows: the map and the view together, with room round them.
    const pad = 40;
    const all = { minX: Math.min(b.minX, port.minX) - pad, minY: Math.min(b.minY, port.minY) - pad, maxX: Math.max(b.maxX, port.maxX) + pad, maxY: Math.max(b.maxY, port.maxY) + pad };
    this.minimapEl.svg.setAttribute('viewBox', `${all.minX} ${all.minY} ${all.maxX - all.minX} ${all.maxY - all.minY}`);
    this.minimapPlane = all;
    // The nodes as one path: a map of thousands is one element, redrawn only when the map's laid out again.
    if (this.minimapScene !== scene) {
      this.minimapScene = scene;
      const parts = [];
      scene.boxes.forEach((box) => parts.push(`M${Math.round(box.x)} ${Math.round(box.y)}h${Math.round(box.width)}v${Math.round(box.height)}h${-Math.round(box.width)}z`));
      this.minimapEl.nodes.setAttribute('d', parts.join(''));
    }
    const v = this.minimapEl.view;
    v.setAttribute('x', String(port.minX));
    v.setAttribute('y', String(port.minY));
    v.setAttribute('width', String(port.maxX - port.minX));
    v.setAttribute('height', String(port.maxY - port.minY));
  }

  makeMinimap() {
    const doc = this.root.ownerDocument;
    const el = this.root.createDiv({ cls: 'dr-minimap dr-mindmap-minimap' });
    const svg = doc.createElementNS(MINIMAP_SVG, 'svg');
    svg.setAttribute('width', String(MAP_MINIMAP_SIZE.width));
    svg.setAttribute('height', String(MAP_MINIMAP_SIZE.height));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const nodes = doc.createElementNS(MINIMAP_SVG, 'path');
    nodes.setAttribute('class', 'dr-minimap-card');
    const view = doc.createElementNS(MINIMAP_SVG, 'rect');
    view.setAttribute('class', 'dr-minimap-view');
    svg.appendChild(nodes);
    svg.appendChild(view);
    el.appendChild(svg);
    Object.assign(el, { svg, nodes, view });
    // Pressing a spot on it: the map looks there, as near as it was.
    el.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0 || !this.minimapPlane || !this.camera) return;
      evt.preventDefault();
      evt.stopPropagation();
      const r = svg.getBoundingClientRect();
      const p = this.minimapPlane;
      const scale = Math.min(r.width / (p.maxX - p.minX), r.height / (p.maxY - p.minY));
      const offX = (r.width - (p.maxX - p.minX) * scale) / 2;
      const offY = (r.height - (p.maxY - p.minY) * scale) / 2;
      const x = p.minX + (evt.clientX - r.left - offX) / scale;
      const y = p.minY + (evt.clientY - r.top - offY) / scale;
      if (typeof this.rememberLook === 'function') this.rememberLook();
      this.camera = { x, y, zoom: this.camera.zoom };
      this.draw();
    });
    this.minimapEl = el;
  }
}

mixInto(MindMapView, MindMapMinimap);
