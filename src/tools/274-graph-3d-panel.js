/* ------------------------------------------------------------------ */
/* The graph in three dimensions: the view, its settings              */
/*                                                                    */
/* The second part of the 3D graph's view: the settings, opened from  */
/* the gear at the graph's side as the graph's own are — what's shown */
/* (a search, which top folders, tags, attachments, notes not written */
/* yet, orphans, or only what's round one note), what the colours go */
/* by, how big notes and names are drawn, and the forces. What's set  */
/* here is the tab's: it's kept with the workspace, and comes back    */
/* with it.                                                           */
/* ------------------------------------------------------------------ */

import { Setting, setIcon } from 'obsidian';
import { GRAPH_3D_DEFAULTS } from './263-graph-space.js';
import { layoutOptions } from './264-graph-layout.js';
import { Graph3DInput } from './269-graph-3d-input.js';

/** What changes which notes are drawn, or their colours: the graph is worked out again. */
const GRAPH_3D_FILTERS = ['search', 'tags', 'attachments', 'missing', 'orphans', 'local', 'depth', 'colourBy', 'hidden'];
const GRAPH_3D_FORCES = ['repel', 'linkLength', 'centre'];
const GRAPH_3D_LOOKS = ['nodeSize', 'lines', 'names'];

export class Graph3DPanel extends Graph3DInput {
  buildPanel(parent) {
    const panel = (this.panel = parent.createDiv({ cls: 'dr-graph3d-pane dr-graph3d-settings' }));
    panel.hidden = !this.options.panel;
    const head = panel.createDiv({ cls: 'dr-graph3d-pane-head' });
    head.createDiv({ cls: 'dr-graph3d-title', text: 'Graph settings' });
    const close = head.createEl('button', { cls: 'clickable-icon dr-graph3d-close' });
    close.setAttribute('aria-label', 'Close');
    setIcon(close, 'x');
    close.addEventListener('click', () => this.togglePanel(false));
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
    new Setting(shown).setClass('dr-graph3d-filter').addSearch((s) => {
      this.controls.search = s;
      s.setPlaceholder('Show only what matches')
        .setValue(this.options.search)
        .onChange((v) => this.setOption('search', v));
    });
    toggle(shown, 'tags', 'Tags');
    toggle(shown, 'attachments', 'Attachments');
    toggle(shown, 'missing', 'Notes not written yet', 'What links point to that isn’t there.');
    toggle(shown, 'orphans', 'Orphans', 'Notes linked to nothing.');
    toggle(shown, 'local', 'Only what’s around a note', 'The open note, or one chosen from its menu.');
    slider(shown, 'depth', 'Steps out', 1, 5, 1);

    this.folderBox = section('Folders').createDiv({ cls: 'dr-graph3d-folders' });

    const colours = section('Colours');
    new Setting(colours).setName('Colour by').addDropdown((d) => {
      this.controls.colourBy = d;
      d.addOption('community', 'Community')
        .addOption('folder', 'Top folder')
        .addOption('tag', 'First tag')
        .addOption('none', 'Nothing')
        .setValue(this.options.colourBy)
        .onChange((v) => this.setOption('colourBy', v));
    });

    const looks = section('Display');
    new Setting(looks).setName('Background').addDropdown((d) => {
      this.controls.scene = d;
      d.addOption('night', 'Night sky')
        .addOption('theme', 'The theme’s')
        .setValue(this.options.scene)
        .onChange((v) => this.setOption('scene', v));
    });
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

  /** The top folders, each a chip that shows or hides its notes: the biggest first. counts: [[folder, notes]]. */
  renderFolders(counts) {
    const box = this.folderBox;
    if (!box) return;
    box.empty();
    const hidden = new Set(this.options.hidden);
    counts.forEach(([folder, count]) => {
      const chip = box.createEl('button', { cls: 'dr-graph3d-chip' });
      chip.createSpan({ text: folder || 'Vault' });
      chip.createSpan({ cls: 'dr-graph3d-count', text: count.toLocaleString() });
      const on = !hidden.has(folder);
      chip.toggleClass('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
      chip.addEventListener('click', () => {
        const now = new Set(this.options.hidden);
        if (now.has(folder)) now.delete(folder);
        else if (counts.length - now.size > 1) now.add(folder);
        this.setOption('hidden', [...now]);
      });
    });
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
    else if (GRAPH_3D_FORCES.includes(key)) this.runner.setForces(layoutOptions(this.options), 0.3);
    else if (GRAPH_3D_LOOKS.includes(key)) this.restyle();
    if (key === 'group') this.regroup();
    if (key === 'scene') {
      this.readTheme();
      this.restyle();
    }
    if (key === 'follow' && value) this.centreOn(this.current());
    if (key === 'hidden' && this.folderCounts) this.renderFolders(this.folderCounts);
    const control = this.controls && this.controls[key];
    if (control && typeof control.getValue === 'function' && control.getValue() !== value) control.setValue(value);
    this.syncSide();
    this.saveLater();
    this.draw();
  }

  togglePanel(open) {
    const show = open === undefined ? this.panel.hidden : !!open;
    this.panel.hidden = !show;
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
    if (this.panel) this.togglePanel(this.options.panel);
    if (this.folderCounts) this.renderFolders(this.folderCounts);
  }

  saveLater() {
    const ws = this.app.workspace;
    if (typeof ws.requestSaveLayout === 'function') ws.requestSaveLayout();
  }
}
