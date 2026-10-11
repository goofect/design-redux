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

class CanvasAlign extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasTextAlign',
        name: 'Centre text',
        desc: 'Centre a card’s text from the bar above it or its right-click menu.',
      },
    ];
  }

  actions() {
    const cards = (ctx) => (this.enabled ? ctx.nodes.filter(alignable) : []);
    const on = (ctx) => cards(ctx).every((node) => this.isCentred(ctx.view, node));
    return [
      {
        id: 'center-canvas-text',
        name: 'Center text in the selected cards',
        menu: (ctx) => (on(ctx) ? 'Stop centering text' : 'Center text'),
        menuIcon: (ctx) => (on(ctx) ? 'align-left' : 'align-center'),
        icon: 'align-center',
        on: 'canvas',
        when: (ctx) => cards(ctx).length > 0,
        run: (ctx) => this.toggle(ctx.view, cards(ctx)),
      },
    ];
  }

  /** The selected cards that can be centred. */
  selected(view) {
    return this.selectedNodes(view).filter(alignable);
  }

  /** A canvas's centred cards; none for a canvas with no file — one closing, or not yet loaded. */
  alignments(file) {
    return (file && (this.settings.canvasAlignments || {})[file.path]) || {};
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
    this.pass(view);
  }

  pass(view) {
    this.apply(view);
    this.decorateMenu(view);
  }

  cleanup(view) {
    view.contentEl.querySelectorAll('.dr-text-center').forEach((el) => el.removeClass('dr-text-center'));
    view.contentEl.querySelectorAll('.dr-align-button').forEach((el) => el.remove());
  }

  apply(view) {
    const mine = this.alignments(view.file);
    this.allNodes(view).forEach((node) => {
      if (node && node.nodeEl) node.nodeEl.toggleClass('dr-text-center', mine[node.id] === 'center');
    });
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
