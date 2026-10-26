/* ------------------------------------------------------------------ */
/* Mind map: finding, focusing, and the notes' own relationships      */
/*                                                                    */
/* Find goes to a node by name, opening the folds on the way. Focus on */
/* branch dims everything but a node and what hangs from it; focus on  */
/* what's near dims all but the nodes a step away by an edge or a       */
/* relation — wider with +, narrower with −, Escape to leave. And a    */
/* map's relations between notes can be written into the notes as     */
/* their relationships, or the notes' relationships drawn on the map.  */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { ChoicePicker } from '../ui/230-pickers.js';
import { Knowledge } from '../library/254-knowledge.js';
import { nodeById, walk } from '../tree/400-tree-model.js';
import { applyPatch } from '../tree/404-tree-ops.js';
import { nodeLabel } from './423-mindmap-scene.js';
import { MindMapAlbumView } from './439-mindmap-album.js';

export class MindMapFocus extends MindMapAlbumView {
  /** A node found by name, and gone to. */
  findNode() {
    if (!this.model) return;
    const items = [];
    walk(this.model, (n) => {
      if (!n.virtual) items.push({ label: nodeLabel(n) || 'Untitled', id: n.id });
    });
    new ChoicePicker(this.app, 'Find a node…', items, (item) => this.openTo(item.id)).open();
  }

  /** What a focus lights: a branch, or what's within `steps` of a node. */
  focusSet() {
    const f = this.focusOn;
    const n = f && this.model && nodeById(this.model, f.id);
    if (!n) return null;
    const lit = new Set();
    if (f.kind === 'branch') {
      const go = (x) => {
        lit.add(x.id);
        x.children.forEach(go);
      };
      go(n);
      return lit;
    }
    // Near: a step at a time, by the tree's edges and by relations.
    const near = (id) => {
      const x = nodeById(this.model, id);
      const out = [];
      if (x) {
        if (x.parent) out.push(x.parent.id);
        x.children.forEach((c) => out.push(c.id));
      }
      (this.model.relations || []).forEach((r) => {
        if (r.from === id) out.push(r.to);
        if (r.to === id) out.push(r.from);
      });
      return out;
    };
    let ring = [n.id];
    lit.add(n.id);
    for (let k = 0; k < f.steps; k++) {
      const next = [];
      ring.forEach((id) => near(id).forEach((o) => !lit.has(o) && (lit.add(o), next.push(o))));
      ring = next;
    }
    return lit;
  }

  /** Focus on a node's branch, or what's near it — or, asked again, off. */
  toggleFocus(kind, id) {
    if (this.focusOn && this.focusOn.kind === kind && this.focusOn.id === id) this.focusOn = null;
    else this.focusOn = { kind, id, steps: 1 };
    this.draw();
  }

  /** While focused near a node: + wider, − narrower, Escape off. Whether the key was taken. */
  focusKey(evt) {
    const f = this.focusOn;
    if (!f) return false;
    if (evt.key === 'Escape') this.focusOn = null;
    else if (f.kind === 'near' && (evt.key === '+' || evt.key === '=')) f.steps = Math.min(6, f.steps + 1);
    else if (f.kind === 'near' && evt.key === '-') f.steps = Math.max(1, f.steps - 1);
    else return false;
    evt.preventDefault();
    this.draw();
    return true;
  }

  /* -- the notes' own relationships ----------------------------------- */

  knowledge() {
    const k = this.plugin && typeof this.plugin.feature === 'function' ? this.plugin.feature(Knowledge) : null;
    return k && k.enabled !== false ? k : null;
  }

  /** The note a node is a link to, as Knowledge reads notes. */
  noteOfNode(n) {
    return typeof this.linkedNote === 'function' ? this.linkedNote(n) : null;
  }

  /** Each relation of a kind between two notes' nodes, written into the first note, where it isn't already. One Undo. */
  async writeRelationsToNotes() {
    const k = this.knowledge();
    if (!k || !this.model) return 0;
    const kinds = k.kinds();
    const writes = [];
    (this.model.relations || []).forEach((r) => {
      const name = r.attrs && r.attrs.kind;
      const kind = name && kinds.find((x) => x.name === name);
      const from = this.noteOfNode(nodeById(this.model, r.from));
      const to = this.noteOfNode(nodeById(this.model, r.to));
      if (!kind || !from || !to || from === to) return;
      if (k.relationsOf(from).out.some((x) => x.kind.prop === kind.prop && x.file === to)) return;
      if (writes.some((w) => w.from === from && w.kind === kind && w.to === to)) return;
      writes.push({ from, kind, to });
    });
    if (!writes.length) {
      new Notice('Nothing to write: every relation with a kind between notes is in them already.');
      return 0;
    }
    const records = [];
    for (const w of writes) {
      const link = `[[${this.app.metadataCache.fileToLinktext(w.to, w.from.path, true)}]]`;
      const record = await k.edit(w.from, w.kind.prop, (list) => list.concat(link));
      if (record) records.push(record);
    }
    this.plugin.notes.offerUndo(`Wrote ${records.length} ${records.length === 1 ? 'relationship' : 'relationships'} into the notes.`, records.slice().reverse(), () => k.changed());
    return records.length;
  }

  /** Between notes' nodes, a relation for each relationship their notes hold that isn't drawn. One step of Undo. */
  drawNoteRelations() {
    const k = this.knowledge();
    if (!k || !this.model) return 0;
    const nodeOf = new Map();
    walk(this.model, (n) => {
      const file = this.noteOfNode(n);
      if (file && !nodeOf.has(file)) nodeOf.set(file, n);
    });
    const joined = new Set((this.model.relations || []).map((r) => `${r.from}|${r.to}`));
    const ops = [];
    nodeOf.forEach((n, file) => {
      k.relationsOf(file).out.forEach((r) => {
        const other = nodeOf.get(r.file);
        if (!other || joined.has(`${n.id}|${other.id}`) || joined.has(`${other.id}|${n.id}`)) return;
        joined.add(`${n.id}|${other.id}`);
        [n, other].forEach((x) => {
          if (!x.anchor && x !== this.model.root && !ops.some((o) => o.type === 'anchor' && o.id === x.id)) ops.push({ type: 'anchor', id: x.id, on: true });
        });
        const attrs = { kind: r.kind.name };
        if (r.kind.line && r.kind.line !== 'dashed') attrs.style = r.kind.line;
        ops.push({ type: 'relation-add', relation: { from: n.id, to: other.id, label: r.kind.name, attrs } });
      });
    });
    if (!ops.some((o) => o.type === 'relation-add')) {
      new Notice('Nothing to draw: every relationship between these notes has its relation.');
      return 0;
    }
    this.apply(applyPatch(this.model, ops, this.selected ? [this.selected] : []));
    return ops.filter((o) => o.type === 'relation-add').length;
  }
}
