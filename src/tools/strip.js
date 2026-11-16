/* ------------------------------------------------------------------ */
/* The strip: a bar across the foot of the note                        */
/*                                                                     */
/* What you are in and where you are in it: the folder's glyph, the    */
/* note's title over its place ("Logic · 5 of 24"), then previous,     */
/* next and more. The plugin's own element at the foot of the note's   */
/* pane; it floats over nothing and shows its buttons without the      */
/* pointer.                                                            */
/* ------------------------------------------------------------------ */

import { MarkdownView, Menu, TFile } from 'obsidian';
import { addActionItems } from '../core/actions.js';
import { clear, el, glyph } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { propOf, valuesOf } from '../core/notes.js';
import { iconButton } from '../ui/button.js';

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
    const folder = file.parent && file.parent.path !== '/' ? file.parent : null;
    const place = this.plugin.placeOf ? this.plugin.placeOf(file) : [null, null, 0, 0];
    glyph(bar, folder && this.plugin.faceOf ? this.plugin.faceOf(folder) : 'note');
    const words = el(bar, 'div', 'dr-strip-words');
    el(words, 'span', 'dr-strip-title dr-text dr-clip', file.basename);
    const where = [];
    if (folder) where.push(folder.name);
    if (folder && this.settings.stripPlace !== false && place[2]) where.push(`${place[2]} of ${place[3]}`);
    const detail = String(this.settings.stripDetail || '').trim();
    if (detail) where.push(...valuesOf(propOf(this.plugin.notes.props(file), detail)));
    el(words, 'span', 'dr-strip-place dr-label dr-clip', where.join(' · ') || 'No folder');
    const go = (to) => to && view.leaf.openFile(to);
    iconButton(bar, { glyph: 'previous-note', label: 'Previous note', disabled: !place[0], run: () => go(place[0]) });
    iconButton(bar, { glyph: 'next-note', label: 'Next note', disabled: !place[1], run: () => go(place[1]) });
    iconButton(bar, { glyph: 'more', label: 'More', run: (e) => this.menu(file, e) });
  }

  menu(file, event) {
    const menu = new Menu();
    addActionItems(menu, this.plugin.actions(), 'note', { file });
    return event && event.clientX ? menu.showAtMouseEvent(event) : menu.showAtPosition({ x: 0, y: 0 });
  }

  settingsRows() {
    return [
      { key: 'stripPlace', name: 'Its place in the folder', desc: '“5 of 24”.', type: 'toggle' },
      { key: 'stripDetail', name: 'A property beside it', desc: 'By name; empty for none.', type: 'text' },
    ];
  }
}
Strip.key = 'contextStrip';
Strip.title = 'Strip';
Strip.glyph = 'strip';
Strip.section = 'Tools';
Strip.about = 'A bar at the foot of the note: its folder, its place, previous and next.';
