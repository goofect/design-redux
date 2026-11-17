/* Close obsolete saved workspace tabs without changing vault contents. */
import { ItemView } from 'obsidian';
import { Feature } from '../core/feature.js';

class RetiredView extends ItemView {
  constructor(leaf, type) { super(leaf); this.type = type; }
  getViewType() { return this.type; }
  getDisplayText() { return 'Closed'; }
  async onOpen() { window.setTimeout(() => this.leaf.detach(), 0); }
}

export class RetiredViews extends Feature {
  register() {
    ['design-redux-mindmap', 'design-redux-outline'].forEach((type) => this.plugin.registerView(type, (leaf) => new RetiredView(leaf, type)));
  }
}
