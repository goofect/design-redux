/* ------------------------------------------------------------------ */
/* The panel, docked                                                  */
/*                                                                    */
/* The note panel in the right sidebar, kept open: it follows the     */
/* note that's open and what's picked in the library. It's the same   */
/* panel, moved in rather than repeated; while it's here, the header  */
/* button shows it instead of floating it.                            */
/* ------------------------------------------------------------------ */

import { ItemView, setIcon } from 'obsidian';
import { INSPECTOR_VIEW } from '../core/020-constants.js';

export class PanelDockView extends ItemView {
  constructor(leaf, panel) {
    super(leaf);
    this.panel = panel;
  }

  getViewType() {
    return INSPECTOR_VIEW;
  }

  getDisplayText() {
    return 'Properties';
  }

  getIcon() {
    return 'info';
  }

  async onOpen() {
    this.containerEl.addClass('dr-panel-dock');
    // Why it shows what it shows: the open note, a pick in the library, a map, a card — or pinned.
    this.originEl = this.contentEl.createDiv({ cls: 'dr-panel-dock-origin' });
    if (typeof this.addAction === 'function') this.pinEl = this.addAction('pin', 'Pin to what it shows', () => this.panel.togglePin());
    this.panel.dock(this);
  }

  async onClose() {
    this.panel.undock(this);
  }

  /** The line saying why, and the pin's state. */
  showOrigin(text, pinned) {
    if (this.originEl) {
      this.originEl.setText(text ? (pinned ? `Pinned · ${text}` : text) : '');
      this.originEl.toggleClass('is-hidden', !text);
    }
    if (this.pinEl) {
      this.pinEl.toggleClass('is-active', !!pinned);
      this.pinEl.setAttribute('aria-label', pinned ? 'Unpin: follow the open note and picks again' : 'Pin to what it shows');
      this.pinEl.setAttribute('aria-pressed', String(!!pinned));
      setIcon(this.pinEl, pinned ? 'pin-off' : 'pin');
    }
  }

  /** What shows while there's nothing to show. */
  showEmpty(text) {
    let el = this.contentEl.querySelector('.dr-panel-dock-empty');
    if (!el) el = this.contentEl.createDiv({ cls: 'dr-panel-dock-empty' });
    el.setText(text || '');
    el.toggleClass('is-hidden', !text);
  }
}
