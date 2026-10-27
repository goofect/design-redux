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
import { asButton, onActivate } from '../core/040-helpers-sorting.js';

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
    // Why it shows what it shows — the open note, a pick in the library, a map, a card — and
    // whether it follows them or is pinned: a button, so the pin is where the eye already is.
    this.originEl = this.contentEl.createDiv({ cls: 'dr-panel-dock-origin is-hidden' });
    asButton(this.originEl);
    this.originIcon = this.originEl.createSpan({ cls: 'dr-panel-dock-origin-icon' });
    // Told politely, once, when it's pinned or what it follows changes; not for every note it follows to.
    this.originText = this.originEl.createSpan({ cls: 'dr-panel-dock-origin-text' });
    this.originText.setAttribute('aria-live', 'polite');
    onActivate(this.originEl, () => this.panel.togglePin());
    if (typeof this.addAction === 'function') this.pinEl = this.addAction('pin', 'Pin to what it shows', () => this.panel.togglePin());
    this.panel.dock(this);
  }

  async onClose() {
    this.panel.undock(this);
  }

  /** The line saying why, and the pin's state. */
  showOrigin(text, pinned) {
    if (this.originEl) {
      this.originText.setText(text ? (pinned ? `Pinned · ${text}` : text) : '');
      setIcon(this.originIcon, pinned ? 'pin' : 'eye');
      this.originEl.toggleClass('is-hidden', !text);
      this.originEl.toggleClass('is-pinned', !!pinned);
      this.originEl.setAttribute('aria-pressed', String(!!pinned));
      this.originEl.setAttribute('aria-label', pinned ? `Pinned: ${text}. Unpin to follow the open note and picks again` : `Following: ${text}. Pin to keep it here`);
    }
    if (this.pinEl) {
      this.pinEl.toggleClass('is-active', !!pinned);
      this.pinEl.setAttribute('aria-label', pinned ? 'Unpin: follow the open note and picks again' : 'Pin to what it shows');
      this.pinEl.setAttribute('aria-pressed', String(!!pinned));
      setIcon(this.pinEl, pinned ? 'pin-off' : 'pin');
    }
  }

  /** What shows while there's nothing to show: what to do, and, given `action` ({ label, run }), a button to start. */
  showEmpty(text, action = null) {
    let el = this.contentEl.querySelector('.dr-panel-dock-empty');
    if (!el) {
      el = this.contentEl.createDiv({ cls: 'dr-panel-dock-empty' });
      setIcon(el.createDiv({ cls: 'dr-panel-dock-empty-icon', attr: { 'aria-hidden': 'true' } }), 'info');
      el.createDiv({ cls: 'dr-panel-dock-empty-text' });
    }
    el.querySelector('.dr-panel-dock-empty-text').setText(text || '');
    const old = el.querySelector('.dr-panel-dock-empty-action');
    if (old) old.remove();
    if (text && action) {
      const button = el.createEl('button', { cls: 'dr-panel-dock-empty-action', text: action.label });
      button.addEventListener('click', () => action.run());
    }
    el.toggleClass('is-hidden', !text);
  }
}
