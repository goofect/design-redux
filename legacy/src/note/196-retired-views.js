/* ------------------------------------------------------------------ */
/* Views that have gone                                                */
/*                                                                     */
/* A layout saved while the reading outline or a mind map was open     */
/* still names them, and Obsidian would keep a dead tab for each. So   */
/* each type stays registered, as a tab that closes itself on opening. */
/* ------------------------------------------------------------------ */

import { ItemView } from 'obsidian';

export const RETIRED_VIEWS = ['design-redux-mindmap', 'design-redux-outline'];

export class RetiredView extends ItemView {
  constructor(leaf, type) {
    super(leaf);
    this.type = type;
  }

  getViewType() {
    return this.type;
  }

  getDisplayText() {
    return 'Gone';
  }

  async onOpen() {
    // After it's done opening: a leaf detached while it opens is left half made.
    window.setTimeout(() => this.leaf.detach(), 0);
  }
}
