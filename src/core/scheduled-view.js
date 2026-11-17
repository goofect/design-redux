/* An Obsidian view that coalesces rebuilds until its state is ready. */
import { ItemView } from 'obsidian';

export class ScheduledView extends ItemView {
  schedule() {
    if (this.pending) return;
    this.pending = window.setTimeout(() => {
      this.pending = null;
      if (this.leaf && this.contentEl.isConnected) this.build();
    }, 0);
  }

  async onClose() {
    if (this.pending) window.clearTimeout(this.pending);
    this.pending = null;
  }
}
