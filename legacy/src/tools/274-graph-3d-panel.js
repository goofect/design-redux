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

import { setIcon, Setting } from 'obsidian';
import { asButton, onActivate } from '../core/042-controls.js';
import { libraryIndex } from '../core/077-library-index.js';
import { GRAPH_3D_DEFAULTS, groupColour, hexColour } from './263-graph-space.js';
import { layoutOptions } from './264-graph-layout.js';
import { Graph3DInput } from './269-graph-3d-input.js';
import { queryTokenAt, queryValue } from './277-graph-query.js';

/** What changes which notes are drawn, or their colours: the graph is worked out again. */
const GRAPH_3D_FILTERS = ['colorGroups', 'search', 'tags', 'attachments', 'missing', 'orphans', 'local', 'depth', 'colourBy', 'hidden'];
/** What Obsidian's search offers as its box opens, and what each does: as the graph's own lists them. */
const GRAPH_3D_SEARCH_OPTIONS = [
  ['path:', 'match path of the file'],
  ['file:', 'match file name'],
  ['tag:', 'search for tags'],
  ['line:', 'search keywords on same line'],
  ['section:', 'search keywords under same heading'],
  ['[property]', 'match property'],
];

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
      asButton(b, label);
      setIcon(b, icon);
      onActivate(b, () => run());
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
      asButton(head);
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
      onActivate(head, () => flip());
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
      if (s.clearButtonEl) s.clearButtonEl.setAttribute('aria-label', 'Clear search');
      s.setPlaceholder('Search files...')
        .setValue(this.options.search)
        .onChange((v) => this.setOption('search', v));
      if (s.inputEl) this.searchOptions(s.inputEl);
    });
    toggle(filters, 'tags', 'Tags', 'Tags are linked to the files that contain them');
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
      'When enabled, links to nonexistent files are not shown'
    );
    toggle(filters, 'orphans', 'Orphans', 'Show files that are not linked to any other file');

    // Groups, as the graph's own: a query and a colour each, and New group.
    const groups = section('color-groups', 'Groups');
    this.groupRows = groups.createDiv({ cls: 'graph-color-groups-container' });
    const add = groups.createDiv({ cls: 'graph-color-button-container' }).createEl('button', { text: 'New group' });
    this.registerDomEvent(add, 'click', () => {
      const list = this.options.colorGroups || [];
      this.setOption('colorGroups', list.concat([{ query: '', color: hexColour(groupColour(list.length, true).rgb) }]));
      this.renderColorGroups();
      const inputs = this.groupRows.querySelectorAll('input[type="text"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    this.renderColorGroups();

    const display = section('display', 'Display');
    // First, as the graph's own puts its toggles before its sliders (its CSS hides the name of the section's last row, where it keeps Animate).
    toggle(display, 'spin', 'Spin', 'Turn the graph slowly round');
    slider(display, 'nodeSize', 'Node size', 0.4, 2.5, 0.1);
    slider(display, 'names', 'Names', 0, 1, 0.05);
    slider(display, 'lines', 'Links', 0.05, 1, 0.05);

    const forces = section('forces', 'Forces');
    slider(forces, 'centre', 'Centre force', 0, 4, 0.1);
    slider(forces, 'repel', 'Repel force', 0.2, 4, 0.1);
    slider(forces, 'linkLength', 'Link distance', 0.3, 3, 0.1);
  }

  /** The colour groups, a row each: the query (applied as typing pauses), the colour, and Delete group. */
  renderColorGroups() {
    const box = this.groupRows;
    if (!box) return;
    box.empty();
    const change = (k, part) => this.setOption('colorGroups', (this.options.colorGroups || []).map((g, i) => (i === k ? Object.assign({}, g, part) : g)));
    (this.options.colorGroups || []).forEach((g, k) => {
      const row = box.createDiv({ cls: 'graph-color-group' });
      const query = row.createEl('input', { type: 'text' });
      query.spellcheck = false;
      query.placeholder = 'Enter query...';
      query.value = g.query || '';
      this.searchOptions(query);
      let typing = 0;
      this.registerDomEvent(query, 'input', () => {
        if (typing) this.host().clearTimeout(typing);
        typing = this.host().setTimeout(() => change(k, { query: query.value }), 400);
      });
      const colour = row.createEl('input', { type: 'color' });
      colour.value = g.color || '#888888';
      colour.setAttribute('aria-label', 'Click to change colour');
      this.registerDomEvent(colour, 'input', () => change(k, { color: colour.value }));
      const remove = row.createDiv({ cls: 'clickable-icon' });
      remove.setAttribute('aria-label', 'Delete group');
      setIcon(remove, 'x');
      this.registerDomEvent(remove, 'click', () => {
        this.setOption('colorGroups', (this.options.colorGroups || []).filter((_, i) => i !== k));
        this.renderColorGroups();
      });
    });
  }

  /**
   * Search options, as Obsidian's search box has them: opened in the box
   * while it's empty or just after a space, a row an operator, picked by
   * a click or the arrows and Enter, put in where the caret is; gone as
   * the typing goes on, on Escape, or when the box is left.
   */
  searchOptions(input) {
    const doc = input.ownerDocument;
    const win = doc.defaultView || window;
    let pop = null;
    let at = 0;
    let shown = [];
    const close = () => {
      if (pop) pop.remove();
      pop = null;
      shown = [];
    };
    const caret = () => (input.selectionStart === null || input.selectionStart === undefined ? input.value.length : input.selectionStart);
    const mark = () => (pop ? [...pop.querySelectorAll('.search-suggest-item:not(.mod-group)')] : []).forEach((r, k) => r.toggleClass('is-selected', k === at));
    // A pick: its text in place of what was typed of it, the caret after it (or where it says).
    const put = (pick) => {
      const end = caret();
      const rest = input.value.slice(end);
      input.value = input.value.slice(0, pick.start) + pick.text + rest;
      const to = pick.start + (pick.caret === undefined ? pick.text.length : pick.caret);
      if (input.setSelectionRange) input.setSelectionRange(to, to);
      close();
      input.focus();
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    };
    const open = () => {
      const token = queryTokenAt(input.value.slice(0, caret()));
      const picks = token ? this.searchPicks(token) : [];
      if (!picks.length) return close();
      if (pop) pop.remove();
      pop = doc.body.createDiv({ cls: 'suggestion-container mod-search-suggestion' });
      const list = pop.createDiv({ cls: 'suggestion' });
      if (token.kind === 'options') {
        const head = list.createDiv({ cls: 'suggestion-item mod-complex search-suggest-item mod-group' });
        head.createDiv({ cls: 'suggestion-content' }).createDiv({ cls: 'suggestion-title list-item-part mod-extended' }).createSpan({ text: 'Search options' });
        const more = head.createDiv({ cls: 'suggestion-aux' }).createDiv({ cls: 'list-item-part search-suggest-icon clickable-icon' });
        more.setAttribute('aria-label', 'Read more');
        setIcon(more, 'info');
        more.addEventListener('click', () => win.open('https://help.obsidian.md/Plugins/Search'));
      }
      shown = picks;
      picks.forEach((pick, k) => {
        const row = list.createDiv({ cls: 'suggestion-item mod-complex search-suggest-item' });
        const title = row.createDiv({ cls: 'suggestion-content' }).createDiv({ cls: 'suggestion-title' });
        title.createSpan({ text: pick.label });
        if (pick.info) title.createSpan({ cls: 'search-suggest-info-text', text: pick.info });
        row.createDiv({ cls: 'suggestion-aux' });
        row.addEventListener('mousemove', () => {
          at = k;
          mark();
        });
        row.addEventListener('click', () => put(pick));
      });
      // Clicking in it mustn't take the focus from the box.
      pop.addEventListener('mousedown', (e) => e.preventDefault());
      const r = input.getBoundingClientRect();
      const width = token.kind === 'options' ? 300 : 350;
      pop.style.width = `${width}px`;
      pop.style.maxHeight = `${Math.max(160, Math.round((win.innerHeight || 800) - r.bottom - 16))}px`;
      pop.style.overflowY = 'auto';
      // Under the box, as Obsidian puts it — but kept inside the window, where the box sits at its edge.
      const room = win.innerWidth || 0;
      pop.style.left = `${Math.round(room ? Math.max(4, Math.min(r.left, room - width - 8)) : r.left)}px`;
      pop.style.top = `${Math.round(r.bottom + 4)}px`;
      at = 0;
      mark();
    };
    this.registerDomEvent(input, 'focus', open);
    this.registerDomEvent(input, 'click', open);
    this.registerDomEvent(input, 'input', open);
    this.registerDomEvent(input, 'blur', close);
    this.registerDomEvent(input, 'keydown', (e) => {
      if (!pop || !shown.length) return;
      const n = shown.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        at = (at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        mark();
        const row = pop.querySelectorAll('.search-suggest-item:not(.mod-group)')[at];
        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        put(shown[at]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    this.register(close);
  }

  /**
   * What the search box offers for what's being typed: the operators; a
   * path:'s folders (the top ones first), a file:'s notes, a tag:'s tags,
   * a [property]'s names — those holding what's typed so far, up to fifty.
   * Each { label, info?, start, text, caret? }.
   */
  searchPicks(token) {
    if (token.kind === 'options') {
      return GRAPH_3D_SEARCH_OPTIONS.map(([op, info]) => ({ label: op, info, start: token.start, text: op === '[property]' ? '[]' : op, caret: op === '[property]' ? 1 : undefined }));
    }
    const index = libraryIndex(this.feature.plugin);
    const meta = this.app.metadataCache;
    let values = [];
    if (token.kind === 'path') {
      values = index.folders().map((f) => f.path).filter(Boolean).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    } else if (token.kind === 'file') {
      values = [...new Set(index.markdown().map((f) => f.basename))].sort((a, b) => a.localeCompare(b));
    } else if (token.kind === 'tag') {
      values = Object.keys(typeof meta.getTags === 'function' ? meta.getTags() || {} : {}).sort((a, b) => a.localeCompare(b));
    } else if (token.kind === 'property') {
      const names = new Set();
      index.markdown().forEach((f) => {
        const cache = meta.getFileCache(f);
        Object.keys((cache && cache.frontmatter) || {}).forEach((k) => names.add(k));
      });
      values = [...names].sort((a, b) => a.localeCompare(b));
    }
    const want = token.partial.toLowerCase().replace(/^#/, '');
    return values
      .filter((v) => !want || v.toLowerCase().replace(/^#/, '').includes(want))
      .slice(0, 50)
      .map((v) => {
        if (token.kind === 'property') return { label: v, start: token.start, text: `${v}:` };
        const text = `${queryValue(v)} `;
        return { label: v, start: token.start, text };
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
    this.renderColorGroups();
    Object.keys(this.folds || {}).forEach((id) => this.folds[id](!!(this.options.folds && this.options.folds[id])));
    if (this.panel) this.togglePanel(this.options.panel);
  }

  saveLater() {
    const ws = this.app.workspace;
    if (typeof ws.requestSaveLayout === 'function') ws.requestSaveLayout();
  }
}
