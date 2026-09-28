/* ------------------------------------------------------------------ */
/* Centred text in canvas cards                                        */
/*                                                                     */
/* A canvas card has no alignment of its own, and a canvas file keeps  */
/* only what Obsidian knows of, so which cards are centred is kept by  */
/* the plugin, by canvas and card. The card's toolbar gets a button,   */
/* its right-click menu an entry, and there's a command to bind.       */
/* ------------------------------------------------------------------ */

/** Cards whose text can be centred: text cards, and notes. */
function alignable(node) {
  try {
    const data = node && typeof node.getData === 'function' ? node.getData() : node;
    if (data && data.type === 'text') return true;
    if (data && data.type === 'file') return /\.md$/i.test(String(data.file || ''));
    return !!node && typeof node.text === 'string';
  } catch (err) {
    return false;
  }
}

class CanvasAlign extends Feature {
  constructor(plugin) {
    super(plugin);
    this.watched = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'canvasTextAlign',
        name: 'Centred text',
        desc: 'Center the text in a canvas card, from the button in the bar above a selected card or its right-click menu.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'center-canvas-text',
        name: 'Center text in the selected cards',
        icon: 'align-center',
        check: () => this.selected(this.pageCanvas()).length > 0,
        run: () => {
          const view = this.pageCanvas();
          this.toggle(view, this.selected(view));
        },
      },
    ];
  }

  register() {
    const ws = this.app.workspace;
    // The canvas's own menus, which it announces for plugins to add to.
    this.plugin.registerEvent(
      ws.on('canvas:node-menu', (menu, node) => {
        if (this.enabled) this.addMenuItem(menu, [node]);
      })
    );
    this.plugin.registerEvent(
      ws.on('canvas:selection-menu', (menu, canvas) => {
        if (this.enabled && canvas) this.addMenuItem(menu, Array.from(canvas.selection || []));
      })
    );
    this.plugin.registerEvent(ws.on('file-open', () => this.plugin.queueSync()));
  }

  enable() {
    this.sync();
  }

  disable() {
    Array.from(this.watched.keys()).forEach((view) => this.unwatch(view));
  }

  sync() {
    this.watched.forEach((state, view) => {
      if (!view.contentEl || !view.contentEl.isConnected || view.file !== state.file) this.unwatch(view);
    });
    this.app.workspace.getLeavesOfType('canvas').forEach((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (view && view.file && view.contentEl && view.canvas && !this.watched.has(view)) this.watch(view);
    });
  }

  pageCanvas() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && view.canvas && view.file && view.file.extension === 'canvas' ? view : null;
  }

  /** The selected cards that can be centred. The selection isn't public, so it's asked carefully. */
  selected(view) {
    try {
      return view ? Array.from(view.canvas.selection || []).filter(alignable) : [];
    } catch (err) {
      return [];
    }
  }

  alignments(file) {
    return (this.settings.canvasAlignments || {})[file.path] || {};
  }

  isCentred(view, node) {
    return this.alignments(view.file)[node.id] === 'center';
  }

  /** Center them all — or, if they all are already, put them back. */
  toggle(view, nodes) {
    const cards = (nodes || []).filter(alignable);
    if (!view || !view.file || !cards.length) return;
    const all = Object.assign({}, this.settings.canvasAlignments || {});
    const mine = Object.assign({}, all[view.file.path] || {});
    const centre = !cards.every((node) => mine[node.id] === 'center');
    cards.forEach((node) => {
      if (centre) mine[node.id] = 'center';
      else delete mine[node.id];
    });
    if (Object.keys(mine).length) all[view.file.path] = mine;
    else delete all[view.file.path];
    this.settings.canvasAlignments = all;
    this.plugin.saveData(this.settings);
    this.apply(view);
    this.decorateMenu(view);
  }

  addMenuItem(menu, nodes) {
    const first = nodes[0];
    const view = first && first.canvas && first.canvas.view;
    const cards = nodes.filter(alignable);
    if (!view || !view.file || !cards.length) return;
    const on = cards.every((node) => this.isCentred(view, node));
    menu.addItem((item) =>
      item
        .setTitle(on ? 'Stop centering text' : 'Center text')
        .setIcon(on ? 'align-left' : 'align-center')
        .onClick(() => this.toggle(view, cards))
    );
  }

  /**
   * Cards are drawn as they come into view, and the bar above a
   * selection is rebuilt as it changes, so both are looked over again
   * whenever the canvas redraws — once a frame at most.
   */
  watch(view) {
    const state = { file: view.file, frame: 0, observer: null };
    this.watched.set(view, state);
    const pass = () => {
      state.frame = 0;
      this.apply(view);
      this.decorateMenu(view);
    };
    if (typeof MutationObserver === 'function') {
      state.observer = new MutationObserver(() => {
        if (!state.frame) state.frame = window.requestAnimationFrame(pass);
      });
      state.observer.observe(view.contentEl, { childList: true, subtree: true });
    }
    pass();
  }

  unwatch(view) {
    const state = this.watched.get(view);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.frame) window.cancelAnimationFrame(state.frame);
    if (view.contentEl) {
      view.contentEl.querySelectorAll('.dr-text-center').forEach((el) => el.removeClass('dr-text-center'));
      view.contentEl.querySelectorAll('.dr-align-button').forEach((el) => el.remove());
    }
    this.watched.delete(view);
  }

  apply(view) {
    const mine = this.alignments(view.file);
    try {
      view.canvas.nodes.forEach((node) => {
        if (node && node.nodeEl) node.nodeEl.toggleClass('dr-text-center', mine[node.id] === 'center');
      });
    } catch (err) {
      /* nothing to mark */
    }
  }

  /**
   * A button in the bar that floats above selected cards, beside
   * Obsidian's own. Only redrawn when what it shows changes, since
   * drawing it is itself a change the watcher would see.
   */
  decorateMenu(view) {
    const bar = view.contentEl.querySelector('.canvas-menu');
    if (!bar) return;
    const cards = this.selected(view);
    let button = bar.querySelector('.dr-align-button');
    if (!cards.length) {
      if (button) button.remove();
      return;
    }
    if (!button) {
      button = bar.createEl('button', { cls: 'clickable-icon dr-align-button' });
      button.addEventListener('click', (evt) => {
        evt.stopPropagation();
        this.toggle(view, this.selected(view));
      });
    }
    const on = cards.every((node) => this.isCentred(view, node));
    if (button.dataset.on === String(on)) return;
    button.dataset.on = String(on);
    button.empty();
    setIcon(button, on ? 'align-left' : 'align-center');
    button.setAttribute('aria-label', on ? 'Stop centering text' : 'Center text');
    button.toggleClass('is-active', on);
  }
}

CanvasAlign.settingKey = 'canvasTextAlign';

