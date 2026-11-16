/* ------------------------------------------------------------------ */
/* The note's head: its folder above it, its properties as chips       */
/*                                                                     */
/* A band the plugin adds at the top of a note's pane (its own         */
/* element; nothing of Obsidian's is moved): the folder as a small     */
/* label that opens it, the note's main properties as plain chips, a   */
/* place for the page control, and a hairline under it all.            */
/* ------------------------------------------------------------------ */

import { MarkdownView, TFile } from 'obsidian';
import { asButton, clear, el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { propOf, valueTone, valuesOf } from '../core/notes.js';
import { listOf } from '../core/text.js';
import { chip } from '../ui/field.js';

/** A note view's head band, made if it has none. Any feature may ask for it and fill its own part. */
export function noteHead(view) {
  const host = view.contentEl;
  let head = Array.from(host.children).find((c) => c.classList.contains('dr-note-head'));
  if (!head) {
    head = host.ownerDocument.createElement('div');
    head.className = 'dr dr-note-head';
    host.insertBefore(head, host.firstChild);
    ['dr-note-place', 'dr-note-chips', 'dr-note-pages'].forEach((cls) => el(head, 'div', cls));
  }
  return head;
}

/** Takes the head band off a view when nothing is left in it. */
export function tidyNoteHead(view) {
  const head = Array.from(view.contentEl.children).find((c) => c.classList.contains('dr-note-head'));
  if (head && !Array.from(head.children).some((part) => part.firstChild)) head.remove();
}

/** Every note view open in the workspace. */
export function noteViews(app) {
  return app.workspace.getLeavesOfType('markdown').map((l) => l.view).filter((v) => v instanceof MarkdownView && v.file instanceof TFile);
}

export class NotePage extends Feature {
  enable() {
    const ws = this.app.workspace;
    const draw = () => this.drawAll();
    ['file-open', 'layout-change', 'design-redux:props', 'design-redux:settings', 'design-redux:renamed'].forEach((name) => this.listen(ws, name, draw));
    this.add(() => noteViews(this.app).forEach((view) => {
      const head = noteHead(view);
      clear(head.querySelector('.dr-note-place'));
      clear(head.querySelector('.dr-note-chips'));
      tidyNoteHead(view);
    }));
    this.drawAll();
  }

  drawAll() {
    noteViews(this.app).forEach((view) => this.draw(view));
  }

  draw(view) {
    const file = view.file;
    const head = noteHead(view);
    const place = clear(head.querySelector('.dr-note-place'));
    if (file.parent && file.parent.path !== '/') {
      const label = el(place, 'span', 'dr-label dr-note-folder', file.parent.name);
      asButton(label, `Open ${file.parent.name}`, () => {
        const library = this.plugin.features.find((f) => typeof f.browse === 'function');
        if (library) library.browse(file.parent);
      });
    }
    const chips = clear(head.querySelector('.dr-note-chips'));
    if (this.settings.notePageChips) {
      const props = this.plugin.notes.props(file);
      listOf(this.settings.panelPrimaryProps).forEach((key) => {
        const values = valuesOf(propOf(props, key));
        if (!values.length) return;
        const tone = values.length === 1 ? valueTone(this.settings, key, values[0]) : null;
        const c = chip(chips, { name: key, value: values.join(', ') });
        if (tone) c.dataset.tone = tone;
      });
    }
    tidyNoteHead(view);
  }

  settingsRows() {
    return [
      { key: 'notePageChips', name: 'Properties as chips', desc: 'The note’s main properties under its folder.', type: 'toggle' },
      { key: 'panelPrimaryProps', name: 'Which properties', desc: 'By name, with commas between.', type: 'text' },
    ];
  }
}
NotePage.key = 'notePage';
NotePage.title = 'Note page';
NotePage.glyph = 'note';
NotePage.section = 'Notes';
NotePage.about = 'A note’s folder above it, and its main properties as chips.';
