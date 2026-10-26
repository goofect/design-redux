/* ------------------------------------------------------------------ */
/* Mind map: colours and their legend                                  */
/*                                                                    */
/* A node takes one of the six colours, or none. A legend in the       */
/* corner lists the colours the map uses, each with what it means —    */
/* named in the map's own layout block, so the name goes where the map */
/* goes — and how many nodes have it. Picking a colour there fades the */
/* nodes of every other; picking it again brings them back.            */
/* ------------------------------------------------------------------ */

import { setIcon } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { ChoicePicker, NamePrompt } from '../ui/230-pickers.js';
import { walk } from '../tree/400-tree-model.js';
import { setAttr } from '../tree/404-tree-ops.js';
import { legendName, setLegendName } from '../tree/406-tree-layout-block.js';
import { colourKey, NODE_COLOURS } from './423-mindmap-scene.js';

/** The colours a map's nodes have and how many of each: the six in order, then others, then none — but only beside others. [[key, count]]. */
export function colourCounts(model) {
  const counts = new Map();
  walk(model, (n) => {
    const key = colourKey(n) || 'none';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const keys = Object.keys(NODE_COLOURS).filter((k) => counts.has(k));
  Array.from(counts.keys())
    .filter((k) => k !== 'none' && !NODE_COLOURS[k])
    .sort((a, b) => counts.get(b) - counts.get(a))
    .forEach((k) => keys.push(k));
  if (!keys.length) return [];
  if (counts.has('none')) keys.push('none');
  return keys.map((k) => [k, counts.get(k)]);
}

/** A colour's name on this map: what the legend calls it, or the colour itself. */
export function colourName(model, key) {
  return legendName(model, key) || (key === 'none' ? 'No colour' : NODE_COLOURS[key] || key);
}

export class MindMapLegend {
  legendShown() {
    return (!this.plugin || this.plugin.settings.mindmapLegend !== false) && !this.legendHidden;
  }

  /** The legend in the corner, as the map's colours are now — or none, with none to name. */
  drawLegend() {
    const counts = this.model && this.legendShown() ? colourCounts(this.model) : [];
    if (this.fade && !counts.some(([k]) => k === this.fade)) this.fade = null;
    const sig = JSON.stringify([counts, counts.map(([k]) => colourName(this.model, k)), this.fade]);
    if (sig === this.legendSig) return;
    this.legendSig = sig;
    if (!counts.length) {
      if (this.legendEl) this.legendEl.remove();
      this.legendEl = null;
      return;
    }
    if (!this.legendEl) this.legendEl = this.root.createDiv({ cls: 'dr-mindmap-legend' });
    const box = this.legendEl;
    box.empty();
    counts.forEach(([key, count]) => {
      const row = box.createDiv({ cls: 'dr-mindmap-legend-row' });
      row.toggleClass('is-faded', !!this.fade && this.fade !== key);
      row.toggleClass('is-picked', this.fade === key);
      asButton(row, `Show only “${colourName(this.model, key)}”`);
      const swatch = row.createSpan({ cls: 'dr-mindmap-swatch' });
      if (key !== 'none') swatch.dataset.color = key;
      if (key.startsWith('#')) swatch.style.background = key;
      row.createSpan({ cls: 'dr-mindmap-legend-name', text: colourName(this.model, key) });
      row.createSpan({ cls: 'dr-mindmap-legend-count', text: String(count) });
      const rename = row.createSpan({ cls: 'clickable-icon dr-mindmap-legend-rename' });
      asButton(rename, 'Name this colour');
      setIcon(rename, 'pencil');
      onActivate(rename, (evt) => {
        if (evt && typeof evt.stopPropagation === 'function') evt.stopPropagation();
        this.nameColour(key);
      });
      onActivate(row, () => this.fadeTo(key));
    });
  }

  /** Every colour but this one faded — or, picked again, none. */
  fadeTo(key) {
    this.fade = this.fade === key ? null : key;
    this.draw();
  }

  toggleLegend() {
    this.legendHidden = !this.legendHidden;
    this.draw();
  }

  /** What a colour means on this map, asked. */
  nameColour(key) {
    if (!this.model) return;
    new NamePrompt(this.app, `What ${key === 'none' ? 'no colour' : NODE_COLOURS[key] || key} means on this map`, NODE_COLOURS[key] || 'Name', (name) => this.apply(setLegendName(this.model, key, name)), { value: legendName(this.model, key) || '' }).open();
  }

  /** A colour for the selected node, picked by what it means here. */
  chooseColour(id) {
    if (!this.model) return;
    const items = [{ label: 'No colour', key: null }].concat(Object.keys(NODE_COLOURS).map((k) => ({ label: colourName(this.model, k), note: legendName(this.model, k) ? NODE_COLOURS[k] : '', key: k })));
    new ChoicePicker(this.app, 'Colour the node…', items, (item) => this.apply(setAttr(this.model, id, 'color', item.key || undefined))).open();
  }
}
