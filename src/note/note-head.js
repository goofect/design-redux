/* ------------------------------------------------------------------ */
/* The note's head: its folder over the title, the ledger under it     */
/*                                                                     */
/* The plugin's own parts, put in the note's own column wherever the   */
/* note is laid out (the editor's sizer, reading view's header), so    */
/* they scroll with the text: the folder as a label over the inline    */
/* title; under it the ledger of properties, the page tabs, a line.    */
/* The order is folder, title, properties, pages, text. Nothing of     */
/* Obsidian's is moved; its own properties block is hidden by the look.*/
/* ------------------------------------------------------------------ */

import { MarkdownView, TFile } from 'obsidian';
import { asButton, clear, el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { retiredActions } from '../core/actions.js';
import { ask } from '../ui/sheet.js';
import { addProperty, drawLedger } from './ledger.js';

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
    noteHeads(view).forEach(({ folder, head }) => {
      clear(folder);
      if (parent) {
        const label = el(folder, 'span', 'dr-link dr-note-folder', parent.name);
        asButton(label, `Open ${parent.name}`, () => {
          const library = this.plugin.features.find((f) => typeof f.browse === 'function');
          if (library) library.browse(parent);
        });
      }
      // The properties: the ledger, a ruled row each, edited where they stand.
      const ledger = clear(head.querySelector('.dr-note-props'));
      drawLedger(this.plugin, ledger, file, () => this.draw(view));
    });
    tidyNoteHeads(view);
  }

  actions() {
    return [
      { id: 'add-property', name: 'Add a property to this note', on: 'note', menu: 'Add a property…', run: (ctx) => addProperty(this.plugin, ctx.file) },
      { id: 'panel-folder-properties', name: 'Properties listed first in this folder…', on: 'folder', menu: 'Properties listed first…', run: async (ctx) => {
        const views = Object.assign({}, this.settings.panelFolderViews);
        const now = views[ctx.folder.path];
        const main = await ask(this.app, { title: `Listed first, in ${ctx.folder.name}`, label: 'Properties, with commas between', value: now ? now.main : this.settings.panelPrimaryProps, action: 'Keep' });
        if (main === null) return;
        if (String(main).trim()) views[ctx.folder.path] = { main: String(main).trim() };
        else delete views[ctx.folder.path];
        this.settings.panelFolderViews = views;
        await this.plugin.saveSettings();
      } },
      ...retiredActions(['open-properties', 'open-inspector'], 'the panel is gone; properties are under the note\'s title'),
    ];
  }
}
NotePage.key = 'notePage';
NotePage.title = 'Note page';
NotePage.section = 'Notes';
NotePage.about = 'A note’s folder over its title, and its main properties on a line under it.';
