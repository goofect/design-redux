/* ------------------------------------------------------------------ */
/* The graph in three dimensions: the view, its settings              */
/*                                                                    */
/* The second part of the 3D graph's view: the panel its header's     */
/* button opens, as the graph's own has — what's shown (a search,     */
/* tags, attachments, notes not written yet, orphans, or only what's  */
/* round one note), what the colours go by and which is which, how    */
/* big notes and names are drawn, and the forces. What's set here is  */
/* the tab's: it's kept with the workspace, and comes back with it.   */
/* ------------------------------------------------------------------ */

import { Setting } from 'obsidian';
import { GRAPH_3D_DEFAULTS } from './263-graph-space.js';
import { layoutOptions } from './264-graph-layout.js';
import { Graph3DInput } from './269-graph-3d-input.js';

/** What changes which notes are drawn, or their colours: the graph is worked out again. */
const GRAPH_3D_FILTERS = ['search', 'tags', 'attachments', 'missing', 'orphans', 'local', 'depth', 'colourBy'];
const GRAPH_3D_FORCES = ['repel', 'linkLength', 'centre'];
const GRAPH_3D_LOOKS = ['nodeSize', 'lines', 'names'];

export class Graph3DPanel extends Graph3DInput {
  buildPanel() {
    const panel = (this.panel = this.contentEl.createDiv({ cls: 'dr-graph3d-panel' }));
    panel.hidden = !this.options.panel;
    this.controls = {};
    const section = (title) => {
      const s = panel.createDiv({ cls: 'dr-graph3d-section' });
      s.createDiv({ cls: 'dr-graph3d-heading', text: title });
      return s;
    };
    const toggle = (el, key, name, desc) =>
      new Setting(el)
        .setName(name)
        .setDesc(desc || '')
        .addToggle((t) => {
          this.controls[key] = t;
          t.setValue(!!this.options[key]).onChange((v) => this.setOption(key, v));
        });
    const slider = (el, key, name, min, max, step) =>
      new Setting(el).setName(name).addSlider((s) => {
        this.controls[key] = s;
        s.setLimits(min, max, step)
          .setValue(this.options[key])
          .setDynamicTooltip()
          .onChange((v) => this.setOption(key, v));
      });

    const shown = section('Filters');
    new Setting(shown).setClass('dr-graph3d-search').addSearch((s) => {
      this.controls.search = s;
      s.setPlaceholder('Search names, paths and tags')
        .setValue(this.options.search)
        .onChange((v) => this.setOption('search', v));
    });
    toggle(shown, 'tags', 'Tags');
    toggle(shown, 'attachments', 'Attachments');
    toggle(shown, 'missing', 'Notes not written yet', 'What links point to that isn’t there.');
    toggle(shown, 'orphans', 'Orphans', 'Notes linked to nothing.');
    toggle(shown, 'local', 'Only what’s around a note', 'The open note, or one chosen from its menu.');
    slider(shown, 'depth', 'Steps out', 1, 5, 1);

    const colours = section('Colours');
    new Setting(colours).setName('Colour by').addDropdown((d) => {
      this.controls.colourBy = d;
      d.addOption('folder', 'Top folder')
        .addOption('tag', 'First tag')
        .addOption('none', 'Nothing')
        .setValue(this.options.colourBy)
        .onChange((v) => this.setOption('colourBy', v));
    });
    this.legend = colours.createDiv({ cls: 'dr-graph3d-legend' });

    const looks = section('Display');
    slider(looks, 'nodeSize', 'Note size', 0.4, 2.5, 0.1);
    slider(looks, 'names', 'Names', 0, 1, 0.05);
    slider(looks, 'lines', 'Links', 0.05, 1, 0.05);
    toggle(looks, 'follow', 'Follow the open note', 'Turn to each note as it’s opened.');

    const forces = section('Forces');
    slider(forces, 'repel', 'Push apart', 0.2, 4, 0.1);
    slider(forces, 'linkLength', 'Link length', 0.3, 3, 0.1);
    slider(forces, 'centre', 'Pull to the middle', 0, 4, 0.1);
    new Setting(forces).addButton((b) => b.setButtonText('Restore defaults').onClick(() => this.restoreDefaults()));
  }

  /** One setting changed, from the panel or a menu, and what follows from it. */
  setOption(key, value) {
    if (this.options[key] === value) return;
    this.options[key] = value;
    if (key === 'local') {
      this.root = value ? this.root || this.openPath() : '';
      this.fitAfterBuild = true;
    }
    if (GRAPH_3D_FILTERS.includes(key)) this.queueBuild(key === 'search' ? 250 : 0);
    else if (GRAPH_3D_FORCES.includes(key)) this.runner.setForces(layoutOptions(this.options), 0.3);
    else if (GRAPH_3D_LOOKS.includes(key)) this.restyle();
    if (key === 'follow' && value) this.centreOn(this.current());
    if (key === 'spin' && this.spinButton) this.spinButton.toggleClass('is-active', !!value);
    const control = this.controls && this.controls[key];
    if (control && typeof control.getValue === 'function' && control.getValue() !== value) control.setValue(value);
    this.saveLater();
    this.draw();
  }

  togglePanel(open) {
    const show = open === undefined ? this.panel.hidden : !!open;
    this.panel.hidden = !show;
    this.options.panel = show;
    if (this.panelButton) this.panelButton.toggleClass('is-active', show);
    this.saveLater();
  }

  openSearch() {
    this.togglePanel(true);
    const s = this.controls.search;
    if (s && s.inputEl) s.inputEl.focus();
  }

  /** Sizes, names, links and forces as they first were; what's shown is left as it is. */
  restoreDefaults() {
    GRAPH_3D_LOOKS.concat(GRAPH_3D_FORCES).forEach((key) => this.setOption(key, GRAPH_3D_DEFAULTS[key]));
  }

  /** Every control set to what the options say: after the tab's saved state comes back. */
  syncControls() {
    Object.keys(this.controls || {}).forEach((key) => {
      const c = this.controls[key];
      if (c && typeof c.setValue === 'function') c.setValue(this.options[key]);
    });
    if (this.panel) this.togglePanel(this.options.panel);
    if (this.spinButton) this.spinButton.toggleClass('is-active', !!this.options.spin);
  }

  /** Which colour is which: the commonest keys, then the kinds drawn. */
  renderLegend(groups) {
    const el = this.legend;
    if (!el) return;
    el.empty();
    const row = (css, name, count) => {
      const r = el.createDiv({ cls: 'dr-graph3d-key' });
      r.createSpan({ cls: 'dr-graph3d-dot' }).style.setProperty('--dr-graph3d-dot', css);
      r.createSpan({ cls: 'dr-graph3d-key-name', text: name });
      if (count) r.createSpan({ cls: 'dr-graph3d-key-count', text: count.toLocaleString() });
    };
    const css = this.palette ? this.palette.css : [];
    groups.slice(0, this.folderColours).forEach((g) => row(css[this.firstSlot + g.slot], g.key || 'Vault', g.count));
    if (groups.length > this.folderColours) el.createDiv({ cls: 'dr-graph3d-key-more', text: `${groups.length - this.folderColours} more, in the same colours again` });
    const kinds = { tag: ['Tags', 2], file: ['Attachments', 3], missing: ['Not written yet', 4] };
    const counts = {};
    this.graph.nodes.forEach((n) => (counts[n.kind] = (counts[n.kind] || 0) + 1));
    Object.keys(kinds).forEach((k) => {
      if (counts[k]) row(css[kinds[k][1]], kinds[k][0], counts[k]);
    });
  }

  saveLater() {
    const ws = this.app.workspace;
    if (typeof ws.requestSaveLayout === 'function') ws.requestSaveLayout();
  }
}
