/* ------------------------------------------------------------------ */
/* Mind map: branches and notes                                        */
/*                                                                    */
/* A branch written out as a note beside the map — a heading for each  */
/* node — and the node made a link to it, in one step of Undo. And     */
/* back: a node that's a link to a note gets the note's headings (or   */
/* its list) as the nodes under it. A link in a markdown map follows   */
/* the note when it's renamed, as any link does; a .mindmap file's     */
/* links are kept up by the feature.                                   */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { noteNameFrom } from '../core/047-helpers-text.js';
import { mixInto } from '../core/080-feature.js';
import { nodeById } from '../tree/400-tree-model.js';
import { applyPatch } from '../tree/404-tree-ops.js';
import { branchNoteText, nodesFromOutline, noteLinkOf, outlineFromMarkdown, outlineSize } from '../tree/408-tree-notes.js';
import { MindMapView } from './421-mindmap-view.js';
import { nodeLabel } from './423-mindmap-scene.js';

/* Nodes a note makes never pass this many: it was likely the wrong note. */
export const NOTE_BRANCH_LIMIT = 200;

class MindMapNotes {
  /** The note a node links to, or null. */
  linkedNote(n) {
    const link = n && noteLinkOf(n.text);
    const cache = this.app && this.app.metadataCache;
    if (!link || !cache || typeof cache.getFirstLinkpathDest !== 'function') return null;
    return cache.getFirstLinkpathDest(link.target, this.file ? this.file.path : '') || null;
  }

  /** The branch — or one node, its details — written as a note beside the map, and the node a link to it: one step of Undo. */
  async branchToNote(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n || n === this.model.root || n.virtual || !this.file) return null;
    const whole = n.children.length > 0;
    const vault = this.app.vault;
    const folder = this.file.parent || null;
    const base = noteNameFrom(nodeLabel(n)) || 'Untitled';
    const path = this.plugin && typeof this.plugin.freeChildPath === 'function' ? this.plugin.freeChildPath(folder, base, 'md') : `${base}.md`;
    let file = null;
    try {
      file = await vault.create(path, branchNoteText(n));
    } catch (err) {
      console.error('Design Redux: could not make the note', err);
      new Notice('Could not make the note.');
      return null;
    }
    // The map may have changed while the note was made: the node looked up again.
    const now = this.model && nodeById(this.model, id);
    if (!now) return file;
    const cache = this.app.metadataCache;
    const linktext = cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(file, this.file.path, true) : file.basename;
    const gone = new Set();
    const mark = (x) => {
      gone.add(x.id);
      x.children.forEach(mark);
    };
    now.children.forEach(mark);
    const ops = [];
    this.model.relations
      .map((r, k) => [r, k])
      .filter(([r]) => gone.has(r.from) || gone.has(r.to))
      .reverse()
      .forEach(([, k]) => ops.push({ type: 'relation-remove', index: k }));
    now.children.slice().forEach((c) => ops.push({ type: 'remove', id: c.id }));
    ops.push({ type: 'text', id, text: `[[${linktext}]]` });
    if (now.attrs.fold) ops.push({ type: 'attr', id, key: 'fold', value: undefined });
    this.apply(applyPatch(this.model, ops, [id]));
    new Notice(`Made “${file.basename}” from the ${whole ? 'branch' : 'node'}.`);
    return file;
  }

  /** A node that's a link to a note: the note's headings, or its list, made into the nodes under it. */
  async noteToBranch(id) {
    const n = this.model && nodeById(this.model, id);
    const file = this.linkedNote(n);
    if (!file) {
      new Notice('This node isn’t a link to a note.');
      return null;
    }
    const link = noteLinkOf(n.text);
    const text = await this.app.vault.cachedRead(file);
    const items = outlineFromMarkdown(text, { subpath: link.subpath, lists: 'fallback' });
    if (!items.length) {
      new Notice(`“${file.basename}” has no headings or list to make nodes from.`);
      return null;
    }
    if (outlineSize(items) > NOTE_BRANCH_LIMIT) {
      new Notice(`“${file.basename}” would make more than ${NOTE_BRANCH_LIMIT} nodes; nothing was added.`);
      return null;
    }
    const now = this.model && nodeById(this.model, id);
    if (!now) return null;
    const ops = [];
    if (now.attrs.fold) ops.push({ type: 'attr', id, key: 'fold', value: undefined });
    nodesFromOutline(items).forEach((node, k) => ops.push({ type: 'insert', parentId: id, index: now.children.length + k, node }));
    return this.apply(applyPatch(this.model, ops, [id]));
  }
}

mixInto(MindMapView, MindMapNotes);
