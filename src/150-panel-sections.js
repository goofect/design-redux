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
}

