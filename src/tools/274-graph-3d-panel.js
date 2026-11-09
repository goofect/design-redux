/* ------------------------------------------------------------------ */
/* The graph in three dimensions: the view, its settings              */
/*                                                                    */
/* The second part of the 3D graph's view: its settings, built as     */
/* Obsidian's graph builds its own and in its markup, so they look    */
/* the same in any theme — a box at the top right that, shut, is a    */
/* column of buttons (the gear, turning slowly, and fit, grouping,    */
/* names and links); open, folding sections: Filters (a search, tags, */
/* attachments, existing files only, orphans, what's round one note,  */
/* the top folders), Groups (what the colours go by, the groups with  */
/* their colours and counts, pulled together or not), Display and     */
/* Forces, with Close and Restore defaults in its corner. What's set  */
/* here is the tab's: it's kept with the workspace.                   */
/* ------------------------------------------------------------------ */

import { Setting, setIcon } from 'obsidian';
import { GRAPH_3D_DEFAULTS } from './263-graph-space.js';
import { layoutOptions } from './264-graph-layout.js';
import { Graph3DInput } from './269-graph-3d-input.js';

/** What changes which notes are drawn, or their colours: the graph is worked out again. */
const GRAPH_3D_FILTERS = ['search', 'tags', 'attachments', 'missing', 'orphans', 'local', 'depth', 'colourBy', 'hidden'];
const GRAPH_3D_FORCES = ['repel', 'linkLength', 'centre'];
const GRAPH_3D_LOOKS = ['nodeSize', 'lines', 'names'];

/** A value label, first in a slider's row. */
const createSpanIn = (control) => control.insertBefore(control.ownerDocument.createElement('span'), control.firstChild);

export class Graph3DPanel extends Graph3DInput {
  /** The settings box, in parent: its buttons, and its sections (this.panel, hidden while it's shut). */
  buildPanel(parent) {
    const box = (this.controlsBox = parent.createDiv({ cls: 'graph-controls dr-graph3d-controls' }));
    box.setAttribute('data-ignore-swipe', 'true');
    this.sideButtons = {};
    const button = (cls, icon, label, run, key) => {
      const b = box.createDiv({ cls: `clickable-icon graph-controls-button ${cls}` });
      b.setAttribute('aria-label', label);
      b.setAttribute('role', 'button');
      b.setAttribute('tabindex', '0');
      setIcon(b, icon);
      b.addEventListener('click', run);
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        run();
      });
      if (key) this.sideButtons[key] = b;
      return b;
    };
    // As Obsidian's: Close and Restore defaults while open; the gear and the wand (here, turning) while shut.
    button('mod-close', 'x', 'Close', () => this.togglePanel(false));
    button('mod-open dr-graph3d-side-button', 'settings', 'Open graph settings', () => this.togglePanel(), 'panel');
    button('mod-animate dr-graph3d-side-button', 'rotate-3d', 'Turn slowly', () => this.setOption('spin', !this.options.spin), 'spin');
    button('mod-reset', 'rotate-ccw', 'Restore default settings', () => this.restoreDefaults());

    const panel = (this.panel = box.createDiv({ cls: 'dr-graph3d-sections' }));
    panel.hidden = !this.options.panel;
    box.toggleClass('is-close', panel.hidden);
    this.controls = {};
    this.folds = {};

    const section = (id, title) => {
      const s = panel.createDiv({ cls: `tree-item graph-control-section mod-${id}` });
      const head = s.createDiv({ cls: 'tree-item-self mod-collapsible' });
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      const icon = head.createDiv({ cls: 'tree-item-icon collapse-icon' });
      setIcon(icon, 'right-triangle');
      head.createDiv({ cls: 'tree-item-inner' }).createEl('header', { cls: 'graph-control-section-header', text: title });
      const body = s.createDiv({ cls: 'tree-item-children' });
      const fold = (shut) => {
        s.toggleClass('is-collapsed', shut);
        icon.toggleClass('is-collapsed', shut);
        head.setAttribute('aria-expanded', String(!shut));
      };
      this.folds[id] = fold;
      const flip = () => {
        const folds = Object.assign({}, this.options.folds);
        folds[id] = !s.hasClass('is-collapsed');
        this.options.folds = folds;
        fold(folds[id]);
        this.saveLater();
      };
      head.addEventListener('click', flip);
      head.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        flip();
      });
      fold(!!(this.options.folds && this.options.folds[id]));
      return body;
    };
    // As the graph's own: what a row does, on its name, shown when it's pointed at.
    const tip = (row, text) => {
      if (text && row.nameEl) row.nameEl.setAttribute('aria-label', text);
      return row;
    };
    const toggle = (el, key, name, text) =>
      tip(
        new Setting(el)
          .setName(name)
          .setClass('mod-toggle')
          .addToggle((t) => {
            this.controls[key] = t;
            t.setValue(!!this.options[key]).onChange((v) => this.setOption(key, v));
          }),
        text
      );
    const slider = (el, key, name, min, max, step) => {
      const row = new Setting(el).setName(name).setClass('mod-slider');
      // The value beside the slider, as the graph's own shows it — where Obsidian's slider doesn't show it already.
      let shown = null;
      const show = (v) => shown && shown.setText(Number(v).toFixed(step < 1 ? 2 : 0));
      row.addSlider((s) => {
        this.controls[key] = s;
        const set = s.setValue.bind(s);
        s.setValue = (v) => {
          set(v);
          show(v);
          return s;
        };
        s.setLimits(min, max, step)
          .setValue(this.options[key])
          .onChange((v) => {
            show(v);
            this.setOption(key, v);
          });
      });
      const control = row.controlEl;
      if (control && !control.querySelector('.slider-value')) {
        shown = createSpanIn(control);
        shown.className = 'slider-value';
        show(this.options[key]);
      }
      return row;
    };

    const filters = section('filter', 'Filters');
    new Setting(filters).setClass('mod-search-setting').addSearch((s) => {
      this.controls.search = s;
      s.setPlaceholder('Search files...')
        .setValue(this.options.search)
        .onChange((v) => this.setOption('search', v));
    });
    toggle(filters, 'tags', 'Tags', 'Tags are linked to the notes that have them');
    toggle(filters, 'attachments', 'Attachments', 'Show attachments');
    // Obsidian asks the other way round: shown, notes not written yet are left out.
    tip(
      new Setting(filters)
        .setName('Existing files only')
        .setClass('mod-toggle')
        .addToggle((t) => {
          t.setValue(!this.options.missing).onChange((v) => this.setOption('missing', !v));
          this.controls.missing = { getValue: () => !t.getValue(), setValue: (v) => t.setValue(!v) };
        }),
      'When on, links to notes not written yet aren’t shown'
    );
    toggle(filters, 'orphans', 'Orphans', 'Show notes linked to nothing');

    const groups = section('color-groups', 'Groups');
    new Setting(groups).setName('Colour by').addDropdown((d) => {
      this.controls.colourBy = d;
      d.addOption('community', 'Community')
        .addOption('folder', 'Top folder')
        .addOption('tag', 'First tag')
        .addOption('none', 'Nothing')
        .setValue(this.options.colourBy)
        .onChange((v) => this.setOption('colourBy', v));
    });
    toggle(groups, 'group', 'Pull each together', 'Each group’s notes drawn to a place of their own');

    const display = section('display', 'Display');
    slider(display, 'nodeSize', 'Node size', 0.4, 2.5, 0.1);
    slider(display, 'names', 'Names', 0, 1, 0.05);
    slider(display, 'lines', 'Links', 0.05, 1, 0.05);

    const forces = section('forces', 'Forces');
    slider(forces, 'centre', 'Centre force', 0, 4, 0.1);
    slider(forces, 'repel', 'Repel force', 0.2, 4, 0.1);
    slider(forces, 'linkLength', 'Link distance', 0.3, 3, 0.1);
  }

  /** One setting changed, from the panel, the side or a menu, and what follows from it. */
  setOption(key, value) {
    if (this.options[key] === value) return;
    this.options[key] = value;
    if (key === 'local') {
      this.root = value ? this.root || this.openPath() : '';
      this.fitAfterBuild = true;
    }
    if (GRAPH_3D_FILTERS.includes(key)) this.queueBuild(key === 'search' ? 250 : 0);
    else if (GRAPH_3D_FORCES.includes(key)) this.runner.setForces(layoutOptions(this.options), 0.6);
    else if (GRAPH_3D_LOOKS.includes(key)) this.restyle();
    if (key === 'group') this.regroup();
    if (key === 'scene') {
      this.readTheme();
      this.restyle();
    }
    if (key === 'follow' && value) this.centreOn(this.current());
    const control = this.controls && this.controls[key];
    if (control && typeof control.getValue === 'function' && control.getValue() !== value) control.setValue(value);
    this.syncSide();
    this.saveLater();
    this.draw();
  }

  togglePanel(open) {
    const show = open === undefined ? this.panel.hidden : !!open;
    this.panel.hidden = !show;
    if (this.controlsBox) this.controlsBox.toggleClass('is-close', !show);
    this.options.panel = show;
    this.syncSide();
    this.saveLater();
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
    Object.keys(this.folds || {}).forEach((id) => this.folds[id](!!(this.options.folds && this.options.folds[id])));
    if (this.panel) this.togglePanel(this.options.panel);
  }

  saveLater() {
    const ws = this.app.workspace;
    if (typeof ws.requestSaveLayout === 'function') ws.requestSaveLayout();
  }
}
