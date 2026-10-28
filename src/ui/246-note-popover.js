/* ------------------------------------------------------------------ */
/* A popover from the note                                             */
/*                                                                     */
/* What once opened as a tab in the right sidebar — the reading        */
/* outline, the footnotes — opens over the note instead, under the     */
/* button or place that asked, and stays while you read and scroll.    */
/* Escape, a click away or asking again closes it. A subclass draws    */
/* into `contentEl` in onOpen, as a view would, and registers what it  */
/* listens to, let go of when it closes.                               */
/* ------------------------------------------------------------------ */

import { Component } from 'obsidian';

export class NotePopover extends Component {
  constructor(app, cls) {
    super();
    this.app = app;
    this.cls = cls;
    this.containerEl = null;
    this.contentEl = null;
    this.anchor = null;
    // Told when it closes, by whoever opened it.
    this.onHide = null;
  }

  isShown() {
    return !!this.containerEl && this.containerEl.isConnected;
  }

  /** Shown under `anchor` (an element), or under the note's header without one. */
  show(anchor) {
    this.anchor = anchor || null;
    if (this.isShown()) {
      this.place();
      return;
    }
    const doc = (anchor && anchor.ownerDocument) || document;
    this.containerEl = doc.body.createDiv({ cls: `dr-note-popover ${this.cls || ''}` });
    this.containerEl.setAttribute('role', 'dialog');
    this.contentEl = this.containerEl.createDiv({ cls: 'dr-note-popover-content view-content' });
    if (typeof this.load === 'function') this.load();
    this.registerDomEvent(doc, 'keydown', (evt) => {
      if (evt.key === 'Escape' && this.isShown()) this.hide();
    });
    this.registerDomEvent(doc, 'pointerdown', (evt) => {
      const el = evt.target;
      if (!this.isShown() || !el || el.nodeType !== 1 || typeof el.closest !== 'function') return;
      if (this.containerEl.contains(el) || (this.anchor && this.anchor.contains(el)) || el.closest('.menu, .modal-container')) return;
      this.hide();
    });
    this.place();
    this.onOpen();
  }

  hide() {
    if (!this.containerEl) return;
    this.onClose();
    if (typeof this.unload === 'function') this.unload();
    this.containerEl.remove();
    this.containerEl = this.contentEl = null;
    if (this.onHide) this.onHide();
  }

  /** Under its anchor, its right edge on the anchor's, kept on screen. */
  place() {
    const el = this.containerEl;
    const win = el.ownerDocument.defaultView || window;
    const anchor = this.anchor && this.anchor.isConnected ? this.anchor : null;
    const r = anchor ? anchor.getBoundingClientRect() : { top: 48, bottom: 48, right: win.innerWidth - 16, left: win.innerWidth - 16 };
    const width = el.offsetWidth || 300;
    el.style.left = `${Math.max(8, Math.min(r.right - width, win.innerWidth - 8 - width))}px`;
    el.style.top = `${Math.max(8, r.bottom + 6)}px`;
  }

  onOpen() {}

  onClose() {}
}
