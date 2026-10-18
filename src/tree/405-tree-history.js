/* ------------------------------------------------------------------ */
/* Tree: Undo                                                          */
/*                                                                    */
/* The map's own Undo: a stack of patches. Typing in one node within a */
/* moment is one step; anything that changes the tree's shape is always */
/* a step of its own. Undone, a step can be redone until something new  */
/* is done.                                                            */
/* ------------------------------------------------------------------ */

import { applyPatch, undoPatch } from './404-tree-ops.js';

/* How close together keystrokes in one node make one step. */
export const TYPING_PAUSE = 800;

export class UndoStack {
  constructor(limit = 200) {
    this.done = [];
    this.undone = [];
    this.limit = limit;
  }

  /** A change made: kept to be undone. `typing` names the node typed in, to join it to the step before; `before` what was selected. */
  push(patch, typing, before, now = Date.now()) {
    if (!patch) return;
    const last = this.done[this.done.length - 1];
    if (typing && last && last.typing === typing && (last.unnamed || now - last.at < TYPING_PAUSE)) {
      last.unnamed = false;
      last.patch = { ops: last.patch.ops.concat(patch.ops), inverse: patch.inverse.concat(last.patch.inverse), selection: patch.selection };
      last.at = now;
    } else {
      this.done.push({ patch, typing: typing || null, at: now, before: before || [] });
      if (this.done.length > this.limit) this.done.shift();
    }
    this.undone = [];
  }

  /**
   * Typing in a node begins: a node just added joins what's first typed in
   * it to the step that added it, however long after; any other starts a
   * step of its own.
   */
  naming(id) {
    const last = this.done[this.done.length - 1];
    if (!last) return;
    if (!last.typing && last.patch.ops.some((op) => op.type === 'insert' && op.node && op.node.id === id)) {
      last.typing = id;
      last.unnamed = true;
    } else last.typing = null;
  }

  get canUndo() {
    return this.done.length > 0;
  }

  get canRedo() {
    return this.undone.length > 0;
  }

  /** The last step undone on the map; the ids to select after, or null with nothing to undo. */
  undo(model) {
    const step = this.done.pop();
    if (!step) return null;
    const redo = undoPatch(model, step.patch, step.before);
    this.undone.push({ patch: redo, step });
    return step.before;
  }

  /** The last undone step done again; the ids to select after. */
  redo(model) {
    const entry = this.undone.pop();
    if (!entry) return null;
    const again = applyPatch(model, entry.step.patch.ops, entry.step.patch.selection);
    this.done.push(Object.assign({}, entry.step, { patch: again, typing: null, at: 0 }));
    return entry.step.patch.selection || [];
  }

  /** After the map was read afresh: kept if every node its steps name is still there, else cleared; whether it was kept. */
  keepWhere(exists) {
    const names = (op) => [op.id, op.parentId].filter((x) => typeof x === 'string');
    const fine = (patch) => patch.ops.concat(patch.inverse).every((op) => names(op).every((id) => exists(id) || op.type === 'insert' || op.type === 'remove'));
    const ok = this.done.every((s) => fine(s.patch)) && this.undone.every((u) => fine(u.step.patch));
    if (!ok) this.clear();
    return ok;
  }

  clear() {
    this.done = [];
    this.undone = [];
  }
}
