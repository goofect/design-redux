/* ------------------------------------------------------------------ */
/* « » in the note's header                                           */
/*                                                                    */
/* Without the strip, the note before and after this one in its       */
/* collection are a press away in the note's own header, beside back  */
/* and forward: near what they move, not along the bottom. While the  */
/* strip is up, it has them, so these step aside.                     */
/* ------------------------------------------------------------------ */

import { MarkdownView } from 'obsidian';
import { albumNeighbours } from '../core/030-helpers-art.js';
import { makeTrigger } from '../core/040-helpers-sorting.js';
import { Feature } from '../core/080-feature.js';

export class HeaderSkip extends Feature {
  constructor(plugin) {
    super(plugin);
    // leaf -> its pair of buttons. Weak, so closing a tab drops it.
    this.fitted = new WeakMap();
  }

  register() {
    // Another note in the same tab has other neighbours.
    this.plugin.registerEvent(this.app.workspace.on('file-open', () => this.sync()));
  }

  enable() {
    this.sync();
  }

  disable() {
    this.clear();
  }

  /** Every tab's, a window of its own's too. */
  clear() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.containerEl) leaf.containerEl.querySelectorAll('.dr-header-skip').forEach((el) => el.remove());
    });
    this.fitted = new WeakMap();
  }

  sync() {
    if (this.settings.contextStrip !== false) {
      this.clear();
      return;
    }
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!leaf.isDeferred && leaf.view instanceof MarkdownView) this.fit(leaf);
    });
  }

  fit(leaf) {
    const header = leaf.containerEl.querySelector('.view-header');
    const left = header && header.querySelector('.view-header-left');
    if (!left) return;
    let box = this.fitted.get(leaf);
    if (!box || !box.isConnected) {
      box = left.createDiv({ cls: 'dr-header-skip' });
      this.fitted.set(leaf, box);
    }
    box.empty();
    const file = leaf.view.file;
    const near = file ? albumNeighbours(this.plugin, file) : null;
    [
      ['previous', 'chevrons-left', 'Previous in collection'],
      ['next', 'chevrons-right', 'Next in collection'],
    ].forEach(([dir, icon, label]) => {
      const target = near && near[dir];
      if (!target) return;
      box.appendChild(makeTrigger('dr-header-skip-btn', `${label}: ${target.basename}`, icon, () => leaf.openFile(target)));
    });
    box.toggleClass('is-hidden', !box.childElementCount);
  }
}
