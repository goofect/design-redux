/* ------------------------------------------------------------------ */
/* Mind map: converting                                                */
/*                                                                    */
/* A canvas made into a mind map beside it — its trees, folds, layouts, */
/* nudges, relations and parts all kept, as tree/414 reads them; the   */
/* canvas itself is only read. A map as the other kind of map file — a */
/* note, or a .mindmap file — and a map exported as a canvas, laid out. */
/* Each is a new file, opened; nothing is written over.                */
/* ------------------------------------------------------------------ */

import { Notice, TFile } from 'obsidian';
import { cloneModel, walk } from '../tree/400-tree-model.js';
import { writeOutline } from '../tree/401-tree-outline.js';
import { writeMindmapJson } from '../tree/402-tree-json.js';
import { noteLinkOf } from '../tree/408-tree-notes.js';
import { canvasFromMap, mapFromCanvas } from '../tree/414-tree-convert.js';
import { MINDMAP_EXTENSION } from './421-mindmap-view.js';
import { layoutScene } from './423-mindmap-scene.js';
import { MindMapAlbumFeature } from './439-mindmap-album.js';

export class MindMapConvert extends MindMapAlbumFeature {
  /** A new file beside another, written and opened. */
  async writeBeside(near, base, ext, text) {
    const folder = near && near.parent ? near.parent : this.app.vault.getRoot();
    const path = this.plugin.freeChildPath(folder, base, ext);
    let file = null;
    try {
      file = await this.app.vault.create(path, text);
    } catch (err) {
      console.error('Design Redux: could not make the file', err);
      new Notice('Could not make the file.');
      return null;
    }
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf && file instanceof TFile) await leaf.openFile(file);
    return file;
  }

  /** A canvas made into a mind map beside it, in the format new maps take; the canvas left as it is. */
  async convertCanvas(file) {
    if (!(file instanceof TFile) || file.extension !== 'canvas') return null;
    let data;
    try {
      data = JSON.parse(await this.app.vault.read(file));
    } catch (err) {
      new Notice('This canvas can’t be read.');
      return null;
    }
    const kind = this.settings.mindmapDefaultFormat === MINDMAP_EXTENSION ? MINDMAP_EXTENSION : 'md';
    const cache = this.app.metadataCache;
    const linkFor = (path, sub) => {
      const target = this.app.vault.getAbstractFileByPath(path);
      const text = target instanceof TFile && cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(target, file.path, true) : String(path).replace(/\.md$/, '');
      return `[[${text}${sub || ''}]]`;
    };
    const { model, report } = mapFromCanvas(data, { title: file.basename, linkFor });
    if (!model.root.children.length && !model.free.length && !model.root.text) {
      new Notice('This canvas has no cards to make a map of.');
      return null;
    }
    const text = kind === MINDMAP_EXTENSION ? writeMindmapJson(model) : writeOutline(model, null, { title: file.basename });
    const made = await this.writeBeside(file, `${file.basename} map`, kind, text);
    if (made && report.length) new Notice(`Made “${made.basename}”. Not kept, as a map has no place for them: ${report.join('; ')}.`, 10000);
    else if (made) new Notice(`Made “${made.basename}” from the canvas.`);
    return made;
  }

  /** A map as the other kind of file — a note, or a .mindmap file — beside it. */
  async convertMapFormat(view, to) {
    if (!view || !view.model || !view.file) return null;
    if (typeof view.flushSave === 'function') view.flushSave();
    const model = cloneModel(view.model);
    const text = to === MINDMAP_EXTENSION ? writeMindmapJson(model) : writeOutline(model, null, { title: view.file.basename });
    return this.writeBeside(view.file, view.file.basename, to === MINDMAP_EXTENSION ? MINDMAP_EXTENSION : 'md', text);
  }

  /** A map exported as a canvas beside it: every node, unfolded, where the map lays it out. */
  async exportCanvas(view) {
    if (!view || !view.model || !view.file) return null;
    const model = cloneModel(view.model);
    walk(model, (n) => delete n.attrs.fold);
    const scene = layoutScene(model, (n) => view.sizeOf(n), view.mode);
    const cache = this.app.metadataCache;
    const fileFor = (text) => {
      const link = noteLinkOf(text);
      const dest = link && cache && typeof cache.getFirstLinkpathDest === 'function' ? cache.getFirstLinkpathDest(link.target, view.file.path) : null;
      return dest instanceof TFile && String(text).split('\n').length === 1 ? dest.path : null;
    };
    const data = canvasFromMap(model, scene.boxes, fileFor);
    return this.writeBeside(view.file, view.file.basename, 'canvas', JSON.stringify(data, null, '\t'));
  }
}
