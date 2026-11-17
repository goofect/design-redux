/* ------------------------------------------------------------------ */
/* The strip: one line across the foot of the note                     */
/*                                                                     */
/* Where the note stands in its folder ("21 / 24"), and Previous and   */
/* Next as words. Nothing else: the note's own actions are in          */
/* Obsidian's menus (a right press on the strip shows them too).       */
/* ------------------------------------------------------------------ */

import { MarkdownView, Menu, TFile } from 'obsidian';
import { addActionItems } from '../core/actions.js';
import { clear, el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { link } from '../ui/button.js';

export class Strip extends Feature {
  enable() {
    const ws = this.app.workspace;
    const draw = () => this.drawAll();
    ['file-open', 'layout-change', 'design-redux:vault', 'design-redux:props', 'design-redux:settings'].forEach((name) => this.listen(ws, name, draw));
    this.add(() => this.views().forEach((view) => this.barOf(view, false)));
    this.drawAll();
  }

  views() {
    return this.app.workspace.getLeavesOfType('markdown').map((l) => l.view).filter((v) => v instanceof MarkdownView && v.file instanceof TFile);
  }

  /** A note view's strip: found, made (`make` true) or taken away (`make` false). */
  barOf(view, make) {
    const host = view.contentEl;
    let bar = Array.from(host.children).find((c) => c.classList.contains('dr-strip'));
    if (make === false) return void (bar && bar.remove());
    if (!bar && make) {
      bar = el(host, 'div', 'dr dr-strip');
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Where this note is');
    }
    return bar || null;
  }

  drawAll() {
    this.views().forEach((view) => this.draw(view));
  }

  draw(view) {
    const file = view.file;
    const bar = clear(this.barOf(view, true));
    const place = this.plugin.placeOf ? this.plugin.placeOf(file) : [null, null, 0, 0];
    el(bar, 'span', 'dr-strip-place', place[2] ? `${place[2]} / ${place[3]}` : 'No folder');
    const go = (to) => () => view.leaf.openFile(to);
    link(bar, 'Previous', place[0] ? go(place[0]) : null);
    link(bar, 'Next', place[1] ? go(place[1]) : null);
    if (!bar.dataset.menu) {
      bar.dataset.menu = 'true';
      bar.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(view.file, e); });
    }
  }

  menu(file, event) {
    const menu = new Menu();
    addActionItems(menu, this.plugin.actions(), 'note', { file });
    return event && event.clientX ? menu.showAtMouseEvent(event) : menu.showAtPosition({ x: 0, y: 0 });
  }
}
Strip.key = 'contextStrip';
Strip.title = 'Strip';
Strip.section = 'Tools';
Strip.about = 'One line at the foot of the note: where it stands in its folder, Previous and Next.';
