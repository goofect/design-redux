/* ------------------------------------------------------------------ */
/* Mind map: new maps from templates                                   */
/*                                                                    */
/* New mind map from template offers a meeting, a project, an argument */
/* and a study map, and every map in the template folder set in        */
/* settings — ordinary maps, kept like any other. {{title}} and        */
/* {{date}} in one are filled in as the new map is made. Save as a     */
/* template copies the open map into that folder.                      */
/* ------------------------------------------------------------------ */

import { normalizePath, Notice, TFile, TFolder } from 'obsidian';
import { noteNameFrom } from '../core/047-helpers-text.js';
import { ChoicePicker, NamePrompt } from '../ui/230-pickers.js';
import { dayKey } from '../tree/415-tree-tasks.js';
import { MINDMAP_EXTENSION, MINDMAP_VIEW } from './421-mindmap-view.js';
import { isMindMapNote, showFileAs } from './422-mindmap-takeover.js';
import { MindMapsEmbeds } from './455-mindmap-embed.js';

const FLAG = '---\nmindmap: true\n---\n';

/* The templates every vault has: written as a map note is. */
export const BUILT_IN_TEMPLATES = [
  { name: 'Meeting', text: `${FLAG}- {{title}}, {{date}}\n\t- Who's there\n\t- Agenda\n\t- Decisions\n\t- Actions\n\t\t- [ ] \n` },
  { name: 'Project', text: `${FLAG}- {{title}}\n\t- Goal\n\t- Milestones\n\t\t- [ ] First milestone %%{"status":"To do"}%%\n\t- Risks\n\t- Notes\n` },
  { name: 'Argument', text: `${FLAG}- {{title}} %%{"role":"claim"}%%\n\t- Because… %%{"role":"reason"}%%\n\t\t- Evidence %%{"role":"evidence"}%%\n\t- But… %%{"role":"objection"}%%\n\t\t- In reply %%{"role":"rebuttal"}%%\n` },
  { name: 'Study', text: `${FLAG}- {{title}}\n\t- Key ideas\n\t- Questions\n\t- Examples\n\t- Sources\n` },
];

/** A template's text with its placeholders filled in. */
export function fillTemplate(text, title, date) {
  return String(text).replace(/\{\{\s*title\s*\}\}/gi, title).replace(/\{\{\s*date\s*\}\}/gi, date);
}

export class MindMapsTemplates extends MindMapsEmbeds {
  /** The folder of templates set, if it's there. */
  templateFolder() {
    const path = String(this.settings.mindmapTemplateFolder || '').trim();
    const folder = path ? this.app.vault.getAbstractFileByPath(normalizePath(path)) : null;
    return folder instanceof TFolder ? folder : null;
  }

  /** The maps in the template folder, by name. */
  templateFiles() {
    const folder = this.templateFolder();
    if (!folder) return [];
    const out = [];
    const go = (f) =>
      f.children.forEach((c) => {
        if (c instanceof TFolder) go(c);
        else if (c instanceof TFile && (c.extension === MINDMAP_EXTENSION || (c.extension === 'md' && isMindMapNote(this.app, c)))) out.push(c);
      });
    go(folder);
    return out.sort((a, b) => a.basename.localeCompare(b.basename));
  }

  /** A template picked, the new map named, then made beside what's open and opened. */
  newFromTemplate(into) {
    const items = this.templateFiles().map((file) => ({ label: file.basename, note: 'Your template', file }));
    BUILT_IN_TEMPLATES.forEach((t) => items.push({ label: t.name, note: 'Built in', template: t }));
    new ChoicePicker(this.app, 'A new mind map from…', items, (item) => {
      new NamePrompt(this.app, `A new ${item.label.toLowerCase()} map`, 'Its title', (title) => this.makeFromTemplate(item, title, into), { button: 'Make it' }).open();
    }).open();
  }

  async makeFromTemplate(item, title, into) {
    const text = item.file ? await this.app.vault.cachedRead(item.file) : item.template.text;
    const ext = item.file ? item.file.extension : 'md';
    const active = this.app.workspace.getActiveFile();
    const folder = into instanceof TFolder ? into : active && active.parent instanceof TFolder ? active.parent : this.app.vault.getRoot();
    const path = this.plugin.freeChildPath(folder, noteNameFrom(title) || 'Mind map', ext);
    let file = null;
    try {
      file = await this.app.vault.create(path, fillTemplate(text, title, dayKey()));
    } catch (err) {
      console.error('Design Redux: could not make the map', err);
      new Notice('Could not make the map.');
      return null;
    }
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf && file instanceof TFile) await showFileAs(this.app, leaf, MINDMAP_VIEW, file);
    return file;
  }

  /** The open map copied into the template folder, its root's words as {{title}}. */
  async saveAsTemplate(view) {
    const folder = this.templateFolder();
    if (!folder) {
      new Notice('Set a folder for map templates in settings first.');
      return null;
    }
    if (!view || !view.file) return null;
    const rootLine = view.model && view.model.root && !view.model.root.virtual ? view.model.root.text.split('\n')[0] : '';
    let text = view.getViewData();
    if (rootLine && view.file.extension === 'md') text = text.replace(`- ${rootLine}`, '- {{title}}');
    const path = this.plugin.freeChildPath(folder, view.file.basename, view.file.extension);
    try {
      const file = await this.app.vault.create(path, text);
      new Notice(`Saved as the template “${file.basename}”.`);
      return file;
    } catch (err) {
      console.error('Design Redux: could not save the template', err);
      new Notice('Could not save the template.');
      return null;
    }
  }
}
