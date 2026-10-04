/* ------------------------------------------------------------------ */
/* Canvas outline                                                      */
/*                                                                     */
/* The canvas in use as a tree, in the right sidebar, as Obsidian's    */
/* own Outline shows a note's headings: groups holding what's inside   */
/* them, cards holding what their arrows lead to. A row goes to its    */
/* card on the canvas; its arrow folds the group or branch there, and   */
/* the outline follows what's folded.                                   */
/* ------------------------------------------------------------------ */

const CANVAS_OUTLINE_VIEW = 'design-redux-canvas-outline';

class CanvasOutlineView extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
    this.plugin = feature.plugin;
    this.canvasView = null;
    this.timer = 0;
  }

  getViewType() {
    return CANVAS_OUTLINE_VIEW;
  }

  getDisplayText() {
    return 'Canvas outline';
  }

  getIcon() {
    return 'list-tree';
  }

  async onOpen() {
    this.containerEl.addClass('dr-canvas-outline');
    const queue = () => this.queue();
    this.registerEvent(this.app.workspace.on('active-leaf-change', queue));
    this.registerEvent(this.app.workspace.on('layout-change', queue));
    this.registerEvent(this.app.workspace.on('design-redux:canvas-changed', queue));
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (this.canvasView && this.canvasView.file === file) queue();
      })
    );
    this.render();
  }

  async onClose() {
    window.clearTimeout(this.timer);
  }

  queue() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), 150);
  }

  /** The canvas to outline: the page in use if it's one, or the last one that was. */
  findCanvas() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    if (view && view.canvas && view.file && view.file.extension === 'canvas') return view;
    const last = this.canvasView;
    if (last && last.canvas && last.file && last.contentEl && last.contentEl.isConnected) return last;
    return null;
  }

  render() {
    const root = this.contentEl;
    const view = this.findCanvas();
    this.canvasView = view;
    // Rows kept in view as the tree is drawn again.
    const scroll = root.scrollTop;
    root.empty();
    if (!view) {
      root.createDiv({ cls: 'pane-empty', text: 'Open a canvas to see its outline.' });
      return;
    }
    const model = canvasModel(view.canvas);
    const tree = outlineTree(model);
    if (!tree.length) {
      root.createDiv({ cls: 'pane-empty', text: 'This canvas has no cards yet.' });
      return;
    }
    root.createDiv({ cls: 'dr-outline-title', text: view.file.basename });
    const list = root.createDiv({ cls: 'dr-outline-tree' });
    tree.forEach((item) => this.row(list, item, view));
    root.scrollTop = scroll;
  }

  row(parentEl, item, view) {
    const fold = this.plugin.feature(CanvasFold);
    const wrap = parentEl.createDiv({ cls: 'tree-item dr-outline-item' });
    const self = wrap.createDiv({ cls: 'tree-item-self is-clickable dr-outline-row' });
    self.setAttribute('tabindex', '0');
    self.dataset.id = item.id;
    const foldable = item.folded || item.children.length > 0;
    // A group folds with its cards; a card's branch folds when it has one.
    const canToggle = item.folded || (item.type === 'group' ? fold && fold.canFold : fold && fold.canBranch);
    if (foldable && canToggle) {
      self.addClass('mod-collapsible');
      const toggle = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
      toggle.toggleClass('is-collapsed', item.folded);
      setIcon(toggle, 'right-triangle');
      toggle.setAttribute('aria-label', item.folded ? 'Unfold' : 'Fold');
      toggle.addEventListener('click', (evt) => {
        evt.stopPropagation();
        this.toggle(view, item);
      });
    }
    const inner = self.createDiv({ cls: 'tree-item-inner dr-outline-inner' });
    const mark = inner.createSpan({ cls: 'dr-outline-mark' });
    const colour = item.color !== undefined && item.color !== null && item.color !== '' ? canvasColorKey(item.color) : 'none';
    if (colour !== 'none') {
      mark.addClass('is-colour');
      mark.style.setProperty('--dr-outline-colour', CANVAS_COLOURS[colour] ? canvasPresetColour(mark, colour) : colour);
    } else {
      setIcon(mark, item.type === 'group' ? 'box-select' : item.type === 'file' ? 'file-text' : item.type === 'link' ? 'link' : 'sticky-note');
    }
    inner.createSpan({ cls: 'dr-outline-label', text: item.label });
    if (item.folded && item.count) inner.createSpan({ cls: 'dr-outline-count', text: `+${item.count}` });
    onActivate(self, () => this.reveal(view, item.id));
    if (item.children.length && !item.folded) {
      const kids = wrap.createDiv({ cls: 'tree-item-children' });
      item.children.forEach((child) => this.row(kids, child, view));
    }
  }

  /** The card centred on the canvas, and selected. */
  reveal(view, id) {
    const canvas = view && view.canvas;
    const node = canvas && canvas.nodes && canvas.nodes.get(id);
    if (!node) return;
    try {
      if (typeof canvas.selectOnly === 'function') canvas.selectOnly(node);
      if (typeof canvas.zoomToSelection === 'function') canvas.zoomToSelection();
      else if (typeof canvas.zoomToBbox === 'function') canvas.zoomToBbox(node.getBBox());
    } catch (err) {
      /* left where it was */
    }
  }

  toggle(view, item) {
    const fold = this.plugin.feature(CanvasFold);
    const node = view.canvas.nodes.get(item.id);
    if (!fold || !node) return;
    if (item.type === 'group') fold.fold(view, [node], !item.folded);
    else fold.foldBranches(view, [node], !item.folded);
  }
}

class CanvasOutline extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasOutline',
        name: 'Canvas outline',
        desc: 'The canvas as a tree in the right sidebar: groups holding their cards, cards holding what their arrows lead to. Click a row to go to its card; its arrow folds the group or branch. Opened from the button among the canvas controls, or a command.',
      },
    ];
  }

  registerTypes() {
    this.plugin.registerView(CANVAS_OUTLINE_VIEW, (leaf) => new CanvasOutlineView(leaf, this));
  }

  commands() {
    return [
      {
        id: 'open-canvas-outline',
        name: 'Open the canvas outline',
        icon: 'list-tree',
        check: () => this.enabled,
        run: () => this.show(),
      },
    ];
  }

  disable() {
    super.disable();
    // Closed when switched off — not when the plugin's only unloading, so it's back where it was after.
    if (!this.plugin.unloading) this.app.workspace.getLeavesOfType(CANVAS_OUTLINE_VIEW).forEach((leaf) => leaf.detach());
  }

  /** The outline in the right sidebar, opened if it isn't, and shown. */
  async show() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(CANVAS_OUTLINE_VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: CANVAS_OUTLINE_VIEW, active: false });
    }
    ws.revealLeaf(leaf);
    if (leaf.view instanceof CanvasOutlineView) leaf.view.render();
    return leaf;
  }

  /** Beside the canvas's zoom controls, a button to open it. */
  mount(view, state) {
    const controls = view.containerEl.querySelector('.canvas-controls');
    if (!controls) return;
    const group = controls.createDiv({ cls: 'canvas-control-group dr-outline-control' });
    const item = group.createDiv({ cls: 'canvas-control-item' });
    item.setAttribute('aria-label', 'Outline');
    item.setAttribute('data-tooltip-position', 'left');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    setIcon(item, 'list-tree');
    onActivate(item, () => this.show());
    state.control = group;
  }

  // The outline redraws when cards come and go.
  pass(view) {
    this.app.workspace.getLeavesOfType(CANVAS_OUTLINE_VIEW).forEach((leaf) => {
      if (leaf.view instanceof CanvasOutlineView && leaf.view.canvasView === view) leaf.view.queue();
    });
  }

  cleanup(view, state) {
    if (state && state.control) state.control.remove();
  }
}

CanvasOutline.settingKey = 'canvasOutline';
