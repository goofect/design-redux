/* ------------------------------------------------------------------ */
/* The panel, docked                                                  */
/*                                                                    */
/* The note panel in the right sidebar, kept open: it follows the     */
/* note that's open and what's picked in the library. It's the same   */
/* panel, moved in rather than repeated; while it's here, the header  */
/* button shows it instead of floating it.                            */
/* ------------------------------------------------------------------ */

import { ItemView } from 'obsidian';
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
    this.panel.dock(this);
  }

  async onClose() {
    this.panel.undock(this);
  }

  /** What shows while there's nothing to show. */
  showEmpty(text) {
    let el = this.contentEl.querySelector('.dr-panel-dock-empty');
    if (!el) el = this.contentEl.createDiv({ cls: 'dr-panel-dock-empty' });
    el.setText(text || '');
    el.toggleClass('is-hidden', !text);
  }
}
