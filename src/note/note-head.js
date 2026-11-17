/* ------------------------------------------------------------------ */
/* The note's head: its folder over the title, its properties under it */
/*                                                                     */
/* The plugin's own parts, put in the note's own column wherever the   */
/* note is laid out (the editor's sizer, reading view's header), so    */
/* they scroll with the text: the folder as a label over the inline    */
/* title; under it the properties, the page tabs and a hairline. The   */
/* order is folder, title, properties, pages, text. Nothing of         */
/* Obsidian's is moved.                                                */
/* ------------------------------------------------------------------ */

import { MarkdownView, TFile } from 'obsidian';
import { asButton, clear, el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { propOf, valuesOf } from '../core/notes.js';
import { listOf } from '../core/text.js';

/** Where a note is laid out, each holding its inline title: the editor's sizer and reading view's header. The note's own, not an embed's. */
function placesOf(view) {
  const own = (node) => !node.parentElement || !node.parentElement.closest('.cm-sizer, .markdown-preview-sizer, .embedded-backlinks');
  const root = view.contentEl;
  const editing = Array.from(root.querySelectorAll('.markdown-source-view .cm-sizer')).filter(own);
  const reading = Array.from(root.querySelectorAll('.markdown-preview-view .markdown-preview-sizer')).filter(own)
    .map((sizer) => sizer.querySelector(':scope > .mod-header')).filter(Boolean);
  return editing.concat(reading);
}

const childOf = (parent, cls) => Array.from(parent.children).find((c) => c.classList.contains(cls)) || null;

/**
 * The plugin's parts round a note's title, in every place the note is laid
 * out, made where missing: [{ folder, head }]. The folder goes right before
 * the title; the head right after it, or after Obsidian's own properties
 * when they follow the title, so the page tabs stand over the text they
 * switch. Any feature may fill its own part of the head.
 */
export function noteHeads(view) {
  return placesOf(view).map((place) => {
    const doc = place.ownerDocument;
    const title = childOf(place, 'inline-title');
    let folder = childOf(place, 'dr-note-place');
    if (!folder) {
      folder = doc.createElement('div');
      folder.className = 'dr dr-note-place';
    }
    const before = title || place.firstChild;
    if (folder.nextSibling !== before || folder.parentNode !== place) place.insertBefore(folder, before);
    let head = childOf(place, 'dr-note-head');
    if (!head) {
      head = doc.createElement('div');
      head.className = 'dr dr-note-head';
      ['dr-note-props', 'dr-note-pages'].forEach((cls) => el(head, 'div', cls));
    }
    let after = title || folder;
    if (after.nextElementSibling && after.nextElementSibling !== head && after.nextElementSibling.classList.contains('metadata-container')) after = after.nextElementSibling;
    if (after.nextSibling !== head) place.insertBefore(head, after.nextSibling);
    return { folder, head };
  });
}

/** Takes away the parts round a note's title that have nothing in them. */
export function tidyNoteHeads(view) {
  placesOf(view).forEach((place) => {
    const folder = childOf(place, 'dr-note-place');
    if (folder && !folder.firstChild) folder.remove();
    const head = childOf(place, 'dr-note-head');
    if (head && !Array.from(head.children).some((part) => part.firstChild)) head.remove();
  });
}

/** Every note view open in the workspace. */
export function noteViews(app) {
  return app.workspace.getLeavesOfType('markdown').map((l) => l.view).filter((v) => v instanceof MarkdownView && v.file instanceof TFile);
}

export class NotePage extends Feature {
  enable() {
    const ws = this.app.workspace;
    const draw = () => this.drawAll();
    ['file-open', 'layout-change', 'design-redux:props', 'design-redux:settings', 'design-redux:renamed', 'design-redux:page'].forEach((name) => this.listen(ws, name, draw));
    this.add(() => noteViews(this.app).forEach((view) => {
      noteHeads(view).forEach(({ folder, head }) => {
        clear(folder);
        clear(head.querySelector('.dr-note-props'));
      });
      tidyNoteHeads(view);
    }));
    this.drawAll();
  }

  drawAll() {
    noteViews(this.app).forEach((view) => this.draw(view));
  }

  draw(view) {
    const file = view.file;
    const parent = file.parent && file.parent.path !== '/' ? file.parent : null;
    const props = this.settings.notePageChips ? this.plugin.notes.props(file) : null;
    noteHeads(view).forEach(({ folder, head }) => {
      clear(folder);
      if (parent) {
        const label = el(folder, 'span', 'dr-link dr-note-folder', parent.name);
        asButton(label, `Open ${parent.name}`, () => {
          const library = this.plugin.features.find((f) => typeof f.browse === 'function');
          if (library) library.browse(parent);
        });
      }
      // The properties: one line of name and value, a dot between, no box. A value its folder's schema finds wrong is red, the reason after it.
      const line = clear(head.querySelector('.dr-note-props'));
      if (!props) return;
      listOf(this.settings.panelPrimaryProps).forEach((key) => {
        const values = valuesOf(propOf(props, key));
        if (!values.length) return;
        const wrong = this.plugin.checkValue ? this.plugin.checkValue(file, key, propOf(props, key)) : null;
        const prop = el(line, 'span', 'dr-note-prop');
        el(prop, 'span', 'dr-note-prop-name dr-muted', key);
        el(prop, 'span', 'dr-text', values.join(', '));
        if (wrong) {
          // Wrong by its folder's schema: the value red, and the words saying why after it.
          prop.setAttribute('aria-invalid', 'true');
          prop.setAttribute('aria-label', `${key}: ${values.join(', ')}, ${wrong}`);
          el(prop, 'span', 'dr-note-prop-why', wrong);
        }
      });
    });
    tidyNoteHeads(view);
  }
}
NotePage.key = 'notePage';
NotePage.title = 'Note page';
NotePage.section = 'Notes';
NotePage.about = 'A note’s folder over its title, and its main properties on a line under it.';
