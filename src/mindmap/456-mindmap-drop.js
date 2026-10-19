/* ------------------------------------------------------------------ */
/* Mind map: copy, cut, and things dropped on a node                   */
/*                                                                    */
/* Copy puts the picked node's branch on the clipboard as a list, as   */
/* the map writes it — attributes, details and all — so pasting it in  */
/* another map makes the same branch, with new ids; Cut takes it out   */
/* too. A note dropped on a node from the file list hangs under it as  */
/* a link, an image as an image — one from outside the vault saved in  */
/* the attachments folder first — and dropped text as a branch.        */
/* ------------------------------------------------------------------ */

import { Notice, TFile } from 'obsidian';
import { IMAGE_EXTENSIONS } from '../core/020-constants.js';
import { mixInto } from '../core/080-feature.js';
import { newId, nodeById } from '../tree/400-tree-model.js';
import { branchLines } from '../tree/401-tree-outline.js';
import { applyPatch, pasteLines, removeNode } from '../tree/404-tree-ops.js';
import { MindMapView } from './421-mindmap-view.js';

class MindMapDrop {
  /** Listening for copy, cut and drops, once a view. */
  listenForDrops() {
    const root = this.root;
    this.registerDomEvent(root, 'copy', (evt) => this.copyBranch(evt, false));
    this.registerDomEvent(root, 'cut', (evt) => this.copyBranch(evt, true));
    this.registerDomEvent(root, 'dragover', (evt) => {
      if (!this.model || this.failure || (this.shownAs && this.shownAs())) return;
      evt.preventDefault();
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'copy';
      const id = this.renderer.nodeAt(evt.target);
      if (id !== this.dropOn) {
        this.dropOn = id;
        this.root.querySelectorAll('.dr-mindmap-node.is-drop').forEach((el) => el.removeClass('is-drop'));
        const el = id && this.renderer.nodeEls.get(id);
        if (el) el.addClass('is-drop');
      }
    });
    this.registerDomEvent(root, 'dragleave', (evt) => {
      if (evt.target === root) this.clearDropMark();
    });
    this.registerDomEvent(root, 'drop', (evt) => this.dropOnMap(evt));
  }

  clearDropMark() {
    this.dropOn = null;
    this.root.querySelectorAll('.dr-mindmap-node.is-drop').forEach((el) => el.removeClass('is-drop'));
  }

  /** The picked node's branch on the clipboard, as a list; taken out too, for Cut. */
  copyBranch(evt, cut) {
    if (!this.model || this.editing || this.failure || !this.selected) return;
    if (evt.target && evt.target.closest && evt.target.closest('input, textarea, .dr-mindmap-editor, .dr-mindmap-alt, .dr-mindmap-filter')) return;
    const n = nodeById(this.model, this.selected);
    if (!n || n.virtual || !evt.clipboardData) return;
    evt.preventDefault();
    evt.clipboardData.setData('text/plain', branchLines(n).join('\n') + '\n');
    if (cut && n !== this.model.root) this.apply(removeNode(this.model, n.id));
  }

  /** What was dropped, under the node it was dropped on — or the picked one, or the root. */
  async dropOnMap(evt) {
    if (!this.model || this.failure) return;
    const onto = this.dropOn || this.renderer.nodeAt(evt.target) || this.selected || this.model.root.id;
    this.clearDropMark();
    const texts = await this.droppedTexts(evt);
    if (!texts) return;
    evt.preventDefault();
    if (!texts.length) return;
    const parent = nodeById(this.model, onto);
    if (!parent) return;
    if (texts.length === 1 && texts[0].list) {
      this.apply(pasteLines(this.model, onto, texts[0].list));
      return;
    }
    const ops = [];
    if (parent.attrs.fold) ops.push({ type: 'attr', id: onto, key: 'fold', value: undefined });
    const nodes = texts.map((t) => ({ id: newId(), text: t.text, attrs: {}, anchor: false, children: [] }));
    nodes.forEach((node, k) => ops.push({ type: 'insert', parentId: onto, index: parent.children.length + k, node }));
    this.apply(applyPatch(this.model, ops, [nodes[nodes.length - 1].id]));
  }

  /**
   * What a drop brings, as node texts: [{ text }] for notes and images,
   * [{ list }] for dropped text; null where it brings nothing the map takes.
   */
  async droppedTexts(evt) {
    const out = [];
    // From Obsidian's own file list: what it's dragging, where this version says.
    const dm = this.app && this.app.dragManager;
    const dragged = dm && typeof dm === 'object' ? dm.draggable : null;
    const files = dragged && dragged.type === 'file' && dragged.file ? [dragged.file] : dragged && dragged.type === 'files' && Array.isArray(dragged.files) ? dragged.files : [];
    files.filter((f) => f instanceof TFile).forEach((f) => out.push({ text: this.linkTo(f) }));
    if (out.length) return out;
    // From outside: images saved into the vault first.
    const outside = evt.dataTransfer && evt.dataTransfer.files ? Array.from(evt.dataTransfer.files) : [];
    for (const f of outside) {
      const ext = String(f.name || '').split('.').pop().toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) continue;
      const saved = await this.saveAttachment(f);
      if (saved) out.push({ text: this.linkTo(saved) });
    }
    if (out.length || outside.length) return out;
    const text = evt.dataTransfer && typeof evt.dataTransfer.getData === 'function' ? evt.dataTransfer.getData('text/plain') : '';
    return text && text.trim() ? [{ list: text }] : null;
  }

  /** A file as a node's text: a link to a note, an image embedded. */
  linkTo(file) {
    const cache = this.app.metadataCache;
    const link = cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(file, this.file ? this.file.path : '', true) : file.basename;
    return IMAGE_EXTENSIONS.includes(String(file.extension).toLowerCase()) ? `![[${link}]]` : `[[${link}]]`;
  }

  /** An image from outside the vault saved where the vault keeps attachments for this map. */
  async saveAttachment(blob) {
    const vault = this.app.vault;
    const fm = this.app.fileManager;
    if (!vault || typeof vault.createBinary !== 'function' || typeof blob.arrayBuffer !== 'function') return null;
    try {
      const path = fm && typeof fm.getAvailablePathForAttachment === 'function' ? await fm.getAvailablePathForAttachment(blob.name, this.file ? this.file.path : '') : blob.name;
      return await vault.createBinary(path, await blob.arrayBuffer());
    } catch (err) {
      console.error('Design Redux: could not save the dropped image', err);
      new Notice('Could not save the dropped image.');
      return null;
    }
  }
}

mixInto(MindMapView, MindMapDrop);
