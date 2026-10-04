/* ------------------------------------------------------------------ */
/* Canvas legend                                                       */
/*                                                                     */
/* A card in the corner of a canvas naming what its colours mean — the */
/* key a map has. The names are kept by the plugin, per canvas, since  */
/* Obsidian rewrites a canvas file with only what it knows of. Picking */
/* a colour fades the cards of every other, so they're easy to find.   */
/* ------------------------------------------------------------------ */

/* Obsidian's six card colours, by the number a canvas file keeps them as. */
const CANVAS_COLOURS = { 1: 'Red', 2: 'Orange', 3: 'Yellow', 4: 'Green', 5: 'Cyan', 6: 'Purple' };

/** A card's colour as the legend keys it: '1'–'6', '#rrggbb', or 'none'. */
function canvasColorKey(color) {
  if (color === undefined || color === null || color === '') return 'none';
  const c = String(color).trim();
  if (/^[1-6]$/.test(c)) return c;
  return normalHex(c) || 'none';
}

/**
 * The colours a canvas uses and how many cards have each, in the order
 * a legend lists them: Obsidian's six, then any others by how common
 * they are, then the uncoloured — which only needs a name beside others.
 */
function canvasColorCounts(nodes) {
  const counts = new Map();
  (nodes || []).forEach((node) => {
    const key = canvasColorKey(node && node.color);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const keys = Object.keys(CANVAS_COLOURS).filter((k) => counts.has(k));
  Array.from(counts.keys())
    .filter((k) => k.charAt(0) === '#')
    .sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b))
    .forEach((k) => keys.push(k));
  if (counts.has('none') && keys.length) keys.push('none');
  return keys.map((key) => ({ key, count: counts.get(key) }));
}

/**
 * One of Obsidian's six card colours. Older versions keep them as
 * "r, g, b", to go inside rgb(); newer ones as colours in their own
 * right. Read as the theme has it, so either works.
 */
function canvasPresetColour(el, key) {
  const name = `--canvas-color-${key}`;
  let raw = '';
  try {
    const at = el.parentElement || el;
    raw = at.ownerDocument.defaultView.getComputedStyle(at).getPropertyValue(name).trim();
  } catch (err) {
    raw = '';
  }
  if (!raw) return `rgb(var(${name}))`;
  return /^\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?$/.test(raw) ? `rgb(${raw})` : raw;
}

class CanvasLegend extends Feature {
  constructor(plugin) {
    super(plugin);
    // Each open canvas view, and what's drawn in it.
    this.mounted = new Map();
    this.saveTimer = 0;
  }

  settingsSchema() {
    return [
      {
        key: 'canvasLegend',
        name: 'Canvas legend',
        desc: 'A card in the corner of each canvas naming what its colours mean. Click a colour to fade out the rest. The legend button among the canvas controls hides it.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'toggle-canvas-legend',
        name: 'Show or hide the canvas legend',
        icon: 'list',
        check: () => !!this.pageCanvas(),
        run: () => this.toggleHidden(this.pageCanvas()),
      },
    ];
  }

  register() {
    // A canvas saves itself a moment after each change; the counts follow.
    this.plugin.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!this.enabled || !(file instanceof TFile) || file.extension !== 'canvas') return;
        this.mounted.forEach((state, view) => {
          if (state.file === file) this.refresh(view);
        });
      })
    );
    this.plugin.registerEvent(this.app.workspace.on('file-open', () => this.plugin.queueSync()));
  }

  enable() {
    this.sync();
  }

  disable() {
    Array.from(this.mounted.keys()).forEach((view) => this.unmount(view));
  }

  sync() {
    // Let go of canvases that have closed, or moved on to another file.
    this.mounted.forEach((state, view) => {
      if (!state.panel.isConnected || view.file !== state.file) this.unmount(view);
    });
    this.app.workspace.getLeavesOfType('canvas').forEach((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (view && view.file && view.contentEl && !this.mounted.has(view)) this.mount(view);
    });
  }

  pageCanvas() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && this.mounted.has(view) ? view : null;
  }

  /* -- what's kept, per canvas -------------------------------------- */

  entry(file) {
    return (this.settings.canvasLegends || {})[file.path] || {};
  }

  keep(file, patch) {
    const all = Object.assign({}, this.settings.canvasLegends || {});
    const next = Object.assign({}, all[file.path] || {}, patch);
    if (next.labels) {
      next.labels = Object.assign({}, next.labels);
      Object.keys(next.labels).forEach((k) => {
        if (!String(next.labels[k] || '').trim()) delete next.labels[k];
      });
      if (!Object.keys(next.labels).length) delete next.labels;
    }
    if (!next.collapsed) delete next.collapsed;
    if (!next.hidden) delete next.hidden;
    if (Object.keys(next).length) all[file.path] = next;
    else delete all[file.path];
    this.settings.canvasLegends = all;
    // Straight to disk: saveSettings would redraw every feature, and
    // with it the field being typed in.
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.plugin.saveData(this.settings), 300);
  }

  /* -- drawing ------------------------------------------------------- */

  mount(view) {
    const host = view.contentEl;
    host.addClass('dr-canvas-host');
    const panel = host.createDiv({ cls: 'dr-legend' });
    const state = { panel, file: view.file, focus: null, observer: null, control: null, stale: false, count: -1, watch: null };
    this.mounted.set(view, state);
    // A canvas can open before its cards are loaded, and cards come and
    // go without the file being saved yet: when their number changes,
    // the legend is counted again. Once a frame at most.
    if (typeof MutationObserver === 'function') {
      let frame = 0;
      state.watch = new MutationObserver(() => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          if (this.mounted.get(view) === state && this.cardCount(view) !== state.count) this.refresh(view);
        });
      });
      state.watch.observe(view.contentEl, { childList: true, subtree: true });
    }

    // Beside the canvas's own zoom and help buttons, to hide and show it.
    const controls = view.containerEl.querySelector('.canvas-controls');
    if (controls) {
      const group = controls.createDiv({ cls: 'canvas-control-group dr-legend-control' });
      const item = group.createDiv({ cls: 'canvas-control-item' });
      item.setAttribute('aria-label', 'Legend');
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      setIcon(item, 'list');
      onActivate(item, () => this.toggleHidden(view));
      state.control = group;
    }
    this.refresh(view);
  }

  unmount(view) {
    const state = this.mounted.get(view);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.watch) state.watch.disconnect();
    state.panel.remove();
    if (state.control) state.control.remove();
    const host = view.contentEl;
    if (host) {
      host.removeClass('dr-canvas-host', 'dr-canvas-focus');
      host.querySelectorAll('.dr-legend-match').forEach((el) => el.removeClass('dr-legend-match'));
    }
    this.mounted.delete(view);
  }

  /**
   * The cards: live from the canvas where it lets them be read — which
   * isn't public, so it's asked carefully — or from its file.
   */
  async nodesOf(view, file) {
    try {
      const data = view.canvas && typeof view.canvas.getData === 'function' ? view.canvas.getData() : null;
      if (data && Array.isArray(data.nodes)) return data.nodes;
    } catch (err) {
      /* the file, then */
    }
    try {
      const parsed = JSON.parse((await this.app.vault.cachedRead(file)) || '{}');
      return Array.isArray(parsed.nodes) ? parsed.nodes : [];
    } catch (err) {
      return [];
    }
  }

  /** How many cards the canvas holds now, where it can be asked. */
  cardCount(view) {
    try {
      return view.canvas && view.canvas.nodes ? view.canvas.nodes.size : -2;
    } catch (err) {
      return -2;
    }
  }

  async refresh(view) {
    const state = this.mounted.get(view);
    if (!state) return;
    state.count = this.cardCount(view);
    // Not while a colour is being named: that would take the field away.
    if (state.panel.contains(state.panel.ownerDocument.activeElement)) {
      state.stale = true;
      return;
    }
    state.rows = canvasColorCounts(await this.nodesOf(view, state.file));
    if (!this.mounted.has(view)) return;
    // A colour no card has any more can't stay picked.
    if (state.focus && !state.rows.some((r) => r.key === state.focus)) state.focus = null;
    this.render(view, state);
    this.applyFocus(view, state);
  }

  swatch(el, key) {
    el.addClass('dr-legend-dot');
    if (key === 'none') el.addClass('is-none');
    else if (CANVAS_COLOURS[key]) el.style.setProperty('background-color', this.presetColour(el, key));
    else el.style.setProperty('background-color', key);
  }

  presetColour(el, key) {
    return canvasPresetColour(el, key);
  }

  colourName(key) {
    if (key === 'none') return 'No colour';
    return CANVAS_COLOURS[key] || key;
  }

  render(view, state) {
    const { panel } = state;
    const saved = this.entry(state.file);
    const labels = saved.labels || {};
    const rows = state.rows || [];
    panel.empty();
    panel.toggleClass('is-hidden', !!saved.hidden);
    panel.toggleClass('is-collapsed', !!saved.collapsed);
    if (state.control) {
      const item = state.control.querySelector('.canvas-control-item');
      if (item) item.toggleClass('is-active', !saved.hidden);
    }

    const head = panel.createDiv({ cls: 'dr-legend-head' });
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', String(!saved.collapsed));
    head.createSpan({ cls: 'dr-legend-title', text: 'Legend' });
    // Folded away, the colours still show, as a row of dots.
    if (saved.collapsed) {
      const dots = head.createSpan({ cls: 'dr-legend-dots' });
      rows.filter((r) => r.key !== 'none').forEach((r) => this.swatch(dots.createSpan(), r.key));
    }
    setIcon(head.createSpan({ cls: 'dr-legend-chevron' }), saved.collapsed ? 'chevron-down' : 'chevron-up');
    onActivate(head, () => {
      this.keep(state.file, { collapsed: !saved.collapsed });
      this.render(view, state);
    });
    if (saved.collapsed) return;

    if (!rows.length) {
      panel.createDiv({ cls: 'dr-legend-empty', text: 'Colour some cards, then name the colours here.' });
      return;
    }

    const list = panel.createDiv({ cls: 'dr-legend-rows' });
    rows.forEach(({ key, count }) => {
      const row = list.createDiv({ cls: 'dr-legend-row' });
      row.dataset.key = key;
      row.toggleClass('is-focused', state.focus === key);
      const dot = row.createDiv();
      this.swatch(dot, key);
      dot.setAttribute('role', 'button');
      dot.setAttribute('tabindex', '0');
      dot.setAttribute('aria-label', `Show only the ${this.colourName(key).toLowerCase()} cards`);
      dot.setAttribute('aria-pressed', String(state.focus === key));
      onActivate(dot, () => this.setFocus(view, key));

      const name = row.createEl('input', { cls: 'dr-legend-name', type: 'text' });
      name.value = labels[key] || '';
      name.placeholder = this.colourName(key);
      name.setAttribute('aria-label', `Name for ${this.colourName(key).toLowerCase()}`);
      name.addEventListener('input', () => {
        const next = Object.assign({}, this.entry(state.file).labels || {});
        next[key] = name.value;
        this.keep(state.file, { labels: next });
      });
      // The canvas's own keys (Delete takes a card away) stay out of it.
      name.addEventListener('keydown', (evt) => {
        evt.stopPropagation();
        if (evt.key === 'Enter' || evt.key === 'Escape') name.blur();
      });
      name.addEventListener('blur', () => {
        if (!state.stale) return;
        state.stale = false;
        window.setTimeout(() => this.refresh(view), 0);
      });

      row.createSpan({ cls: 'dr-legend-count', text: String(count) });
      row.addEventListener('click', (evt) => {
        if (evt.target === name || evt.target === dot || dot.contains(evt.target)) return;
        this.setFocus(view, key);
      });
    });

    if (state.focus) {
      const all = panel.createDiv({ cls: 'dr-legend-all', text: 'Show every card' });
      all.setAttribute('role', 'button');
      all.setAttribute('tabindex', '0');
      onActivate(all, () => this.setFocus(view, state.focus));
    }
  }

  toggleHidden(view) {
    const state = view ? this.mounted.get(view) : null;
    if (!state) return;
    const hidden = !this.entry(state.file).hidden;
    this.keep(state.file, { hidden });
    if (hidden && state.focus) state.focus = null;
    this.render(view, state);
    this.applyFocus(view, state);
  }

  /* -- picking a colour ---------------------------------------------- */

  /** Picking the picked colour again shows every card. */
  setFocus(view, key) {
    const state = this.mounted.get(view);
    if (!state) return;
    state.focus = state.focus === key ? null : key;
    this.render(view, state);
    this.applyFocus(view, state);
  }

  /**
   * The cards on screen with their colours. The canvas's own list where
   * it can be read; otherwise the page, where Obsidian's six colours are
   * marked by class — a colour of your own can't be told that way.
   */
  cardsOf(view) {
    try {
      const nodes = view.canvas && view.canvas.nodes;
      if (nodes && typeof nodes.forEach === 'function') {
        const out = [];
        nodes.forEach((node) => {
          if (node && node.nodeEl) out.push({ el: node.nodeEl, key: canvasColorKey(node.color) });
        });
        if (out.length) return out;
      }
    } catch (err) {
      /* the page, then */
    }
    return Array.from(view.contentEl.querySelectorAll('.canvas-node')).map((el) => {
      const cls = Array.from(el.classList).find((c) => /^mod-canvas-color-[1-6]$/.test(c));
      return { el, key: cls ? cls.slice(-1) : el.style.getPropertyValue('--canvas-color') ? '?' : 'none' };
    });
  }

  applyFocus(view, state) {
    const host = view.contentEl;
    const on = !!state.focus && !this.entry(state.file).hidden;
    host.toggleClass('dr-canvas-focus', on);
    const mark = () => this.cardsOf(view).forEach(({ el, key }) => el.toggleClass('dr-legend-match', on && key === state.focus));
    mark();
    // Cards drawn later — scrolled to, added, recoloured — are marked as they come.
    if (on && !state.observer && typeof MutationObserver === 'function') {
      let frame = 0;
      state.observer = new MutationObserver(() => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          if (state.focus) mark();
        });
      });
      state.observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    } else if (!on && state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }
}

CanvasLegend.settingKey = 'canvasLegend';

