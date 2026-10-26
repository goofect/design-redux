/* ------------------------------------------------------------------ */
/* Mind map: filter, levels, one branch alone                          */
/*                                                                    */
/* The filter bar dims all but the nodes with some words, a tag, a     */
/* status or a colour, or down to a depth — the way down to them kept  */
/* lit. Show levels shows only so many levels down; a branch shown     */
/* alone fills the view, a trail of the nodes above it at the top to   */
/* step back up. Only the view changes: nothing is written.            */
/* ------------------------------------------------------------------ */

import { setIcon } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { ChoicePicker } from '../ui/230-pickers.js';
import { nodeById } from '../tree/400-tree-model.js';
import { statusesOf } from '../tree/415-tree-tasks.js';
import { filtering, filterSet, mapTags, pathTo } from '../tree/417-tree-filter.js';
import { colourKey, nodeLabel } from './423-mindmap-scene.js';
import { colourName } from './431-mindmap-legend.js';
import { MindMapNodePanel } from './453-mindmap-node-panel.js';

export class MindMapFilter extends MindMapNodePanel {
  filtersOn() {
    return !this.plugin || this.plugin.settings.mindmapFilters !== false;
  }

  /** What the filter lights, while it sets anything. */
  filterLit() {
    return this.filtersOn() && this.model && filtering(this.filter) ? filterSet(this.model, this.filter) : null;
  }

  /** How the layout is narrowed: a branch alone, so many levels. */
  sceneOpts() {
    if (!this.filtersOn() || !this.model) return {};
    if (this.soloId && !nodeById(this.model, this.soloId)) this.soloId = null;
    return { soloId: this.soloId || null, levels: this.levels || 0 };
  }

  /** The node the map is drawn from: a branch shown alone, or the root. */
  topNode() {
    const opts = this.sceneOpts();
    return (opts.soloId && nodeById(this.model, opts.soloId)) || this.model.root;
  }

  /** The filter bar shown, or hidden — hiding it clears what it set. */
  toggleFilterBar(focus = true) {
    if (this.filterEl) {
      this.filterEl.remove();
      this.filterEl = null;
      this.filter = null;
      this.draw();
      return;
    }
    this.filter = this.filter || {};
    const bar = (this.filterEl = this.root.createDiv({ cls: 'dr-mindmap-filter' }));
    const search = bar.createEl('input', { type: 'search', cls: 'dr-mindmap-filter-text' });
    search.placeholder = 'Filter nodes…';
    search.setAttribute('aria-label', 'Filter nodes by their words');
    search.value = this.filter.text || '';
    search.addEventListener('input', () => this.setFilter('text', search.value));
    search.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Escape') return;
      evt.preventDefault();
      this.toggleFilterBar();
      this.root.focus();
    });
    const pick = (key, label, options) => {
      const select = bar.createEl('select', { cls: 'dropdown dr-mindmap-filter-pick' });
      select.dataset.key = key;
      select.setAttribute('aria-label', label);
      select.createEl('option', { value: '', text: label });
      options.forEach(([value, text]) => select.createEl('option', { value, text }));
      select.value = this.filter[key] === undefined ? '' : String(this.filter[key]);
      select.addEventListener('change', () => this.setFilter(key, key === 'depth' ? Number(select.value) || 0 : select.value));
    };
    pick('tag', 'Any tag', mapTags(this.model).map((t) => [t, `#${t}`]));
    pick('status', 'Any status', statusesOf(this.model).map((s) => [s, s]).concat([['none', 'No status']]));
    const colours = [];
    const seen = new Set();
    const note = (n) => {
      const k = colourKey(n) || 'none';
      if (!seen.has(k)) {
        seen.add(k);
        colours.push([k, colourName(this.model, k)]);
      }
      n.children.forEach(note);
    };
    if (this.model.root) note(this.model.root);
    pick('colour', 'Any colour', colours);
    pick('depth', 'Any depth', [1, 2, 3, 4, 5, 6].map((d) => [String(d), `Down to level ${d}`]));
    const clear = bar.createSpan({ cls: 'clickable-icon dr-mindmap-filter-clear' });
    setIcon(clear, 'x');
    asButton(clear, 'Clear the filter');
    onActivate(clear, () => this.toggleFilterBar());
    if (focus) window.setTimeout(() => search.focus(), 0);
    this.draw();
  }

  setFilter(key, value) {
    this.filter = Object.assign({}, this.filter, { [key]: value || undefined });
    this.draw();
  }

  /** Only so many levels shown, or all of them (0). */
  showLevels(levels) {
    this.levels = levels || 0;
    this.relayout(false);
    if (typeof this.fit === 'function') this.fit(true);
    this.draw();
  }

  chooseLevels() {
    const items = [{ label: 'Every level', levels: 0 }].concat([1, 2, 3, 4, 5].map((d) => ({ label: d === 1 ? 'One level down' : `${d} levels down`, levels: d, note: this.levels === d ? 'Now' : '' })));
    new ChoicePicker(this.app, 'Show how many levels…', items, (item) => this.showLevels(item.levels)).open();
  }

  /** Filter, levels and a branch alone, all let go. */
  clearFilters() {
    if (this.filterEl) {
      this.filterEl.remove();
      this.filterEl = null;
    }
    this.filter = null;
    this.levels = 0;
    this.solo(null);
  }

  /** A branch shown alone, or the whole map again (null). */
  solo(id) {
    const n = id && this.model ? nodeById(this.model, id) : null;
    this.soloId = n && n !== this.model.root && !n.virtual ? n.id : null;
    this.relayout(false);
    if (typeof this.fit === 'function') this.fit(true);
    this.draw();
  }

  toggleSolo(id) {
    this.solo(this.soloId === id ? null : id);
  }

  /** The way down to the branch shown alone, at the top: each step goes back up to it. */
  drawCrumbs() {
    const solo = this.filtersOn() && this.soloId && this.model ? nodeById(this.model, this.soloId) : null;
    const steps = solo ? pathTo(this.model, solo.id).filter((n) => !n.virtual) : [];
    // Drawn again only when the way down changed: a step renamed, the branch moved.
    const key = steps.map((n) => `${n.id}:${nodeLabel(n)}`).join('|');
    if (this.crumbsEl && this.crumbsKey === key) return;
    this.crumbsKey = key;
    if (this.crumbsEl) {
      this.crumbsEl.remove();
      this.crumbsEl = null;
    }
    if (!solo) return;
    const trail = (this.crumbsEl = this.root.createDiv({ cls: 'dr-mindmap-crumbs' }));
    trail.setAttribute('aria-label', 'The branch shown alone, and the nodes above it');
    steps.forEach((n, k) => {
      if (k) trail.createSpan({ cls: 'dr-crumb-sep', text: '›' });
      const step = trail.createSpan({ cls: 'dr-mindmap-crumb', text: nodeLabel(n) || 'Untitled' });
      if (n === solo) step.addClass('is-current');
      else {
        asButton(step, k === 0 ? 'Show the whole map' : `Show ${nodeLabel(n)} alone`);
        onActivate(step, () => this.solo(k === 0 ? null : n.id));
      }
    });
    const out = trail.createSpan({ cls: 'clickable-icon dr-mindmap-crumbs-out' });
    setIcon(out, 'x');
    asButton(out, 'Show the whole map');
    onActivate(out, () => this.solo(null));
  }
}
