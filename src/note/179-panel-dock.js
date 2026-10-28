/* ------------------------------------------------------------------ */
/* Views retired from the right sidebar                               */
/*                                                                    */
/* The inspector, the reading outline and the footnotes once opened   */
/* as tabs in the right sidebar. They don't any more — the panel      */
/* floats, or sits in the library's own pane; the outline and the     */
/* footnotes are popovers from the note — but a layout saved then     */
/* still names them, so each type is kept, as a tab that closes       */
/* itself as soon as it's opened.                                     */
/* ------------------------------------------------------------------ */

import { ItemView } from 'obsidian';

export class RetiredView extends ItemView {
  constructor(leaf, type) {
    super(leaf);
    this.type = type;
  }

  getViewType() {
    return this.type;
  }

  getDisplayText() {
    return 'Moved';
  }

  async onOpen() {
    // After it's done opening: a leaf detached while it opens is left half made.
    window.setTimeout(() => this.leaf.detach(), 0);
  }
}
