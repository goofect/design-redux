/* ------------------------------------------------------------------ */
/* Panel sections                                                      */
/*                                                                     */
/* Borrowing Obsidian's own elements gave exact behaviour but pulled   */
/* page-level styling with it, and each borrow is shared state the     */
/* note loses while the panel holds it. That doesn't stack.            */
/*                                                                     */
/* Sections own their markup instead. Where Obsidian exposes a         */
/* building block — the registered value widgets, the backlink cache — */
/* the section calls it, so behaviour stays native inside a layout     */
/* this plugin controls. Adding a section is one class.                */
/* ------------------------------------------------------------------ */

class PanelSection {
  constructor(panel) {
    this.panel = panel;
    this.plugin = panel.plugin;
    this.containerEl = null;
    this.file = null;
    // Suggestion lists live on <body>, outside the section, so they're
    // kept here to be taken away with it.
    this.suggests = [];
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /** Build into a section element the panel provides. */
  mount(parentEl, file) {
    this.file = file;
    this.containerEl = parentEl.createDiv({ cls: `dr-section ${this.cls}` });
    this.render();
  }

  /** Redraw in place, unless the user is mid-edit inside it. */
  refresh(file) {
    if (!this.containerEl || !this.containerEl.isConnected) return;
    if (file && this.file && file !== this.file) return;
    if (this.containerEl.contains(document.activeElement)) return;
    this.containerEl.empty();
    this.render();
  }

  render() {}

  destroy() {
    this.dropSuggests();
    if (this.containerEl) this.containerEl.remove();
    this.containerEl = null;
    this.file = null;
  }

  dropSuggests() {
    this.suggests.forEach((el) => el.remove());
    this.suggests = [];
  }

  /**
   * A list under a heading that folds it, with its count: a row for each
   * item, drawn by `row(list, item)`. What's folded is kept on the panel
   * by `key`, so it stays folded from note to note.
   */
  renderList(key, title, items, row) {
    const group = this.containerEl.createDiv({ cls: `dr-mention-group is-${key}` });
    const head = group.createDiv({ cls: 'dr-section-head' });
    asButton(head);
    setIcon(head.createSpan({ cls: 'dr-section-chevron' }), 'chevron-down');
    head.createSpan({ cls: 'dr-section-title', text: title });
    head.createSpan({ cls: 'dr-section-count', text: String(items.length) });
    const body = group.createDiv({ cls: 'dr-mention-body' });
    if (!items.length) body.createDiv({ cls: 'dr-empty', text: 'None' });
    else {
      const list = body.createDiv({ cls: 'dr-mention-list' });
      items.forEach((item) => row(list, item));
    }
    const folds = this.panel.folds || (this.panel.folds = {});
    const apply = () => {
      group.toggleClass('is-collapsed', !!folds[key]);
      head.setAttribute('aria-expanded', folds[key] ? 'false' : 'true');
    };
    onActivate(head, () => {
      folds[key] = !folds[key];
      apply();
    });
    apply();
    return group;
  }

  /** A row naming a file, which opens it — in a new tab with Ctrl or Cmd — and closes the panel, which belongs to the note being left. */
  fileRow(list, file, text) {
    const row = list.createDiv({ cls: 'dr-mention' });
    asButton(row);
    row.createSpan({ cls: 'dr-mention-name', text: text || file.basename });
    onActivate(
      row,
      (evt) => {
        this.app.workspace.getLeaf(!!(evt && (evt.ctrlKey || evt.metaKey))).openFile(file);
        if (typeof this.panel.close === 'function') this.panel.close();
      },
      false
    );
    return row;
  }

  /** A small heading over a section the plugin adds, so it reads apart from the properties above it. */
  renderLabel(text) {
    return this.containerEl.createDiv({ cls: 'dr-section-label', text });
  }
}

