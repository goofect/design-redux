/* ------------------------------------------------------------------ */
/* Mind map: typing in a node                                          */
/*                                                                    */
/* The node being edited gets a small CodeMirror editor over its box,  */
/* moving with the map. What's typed goes into the map as it's typed —  */
/* one step of Undo for a run of keystrokes — so a change made outside */
/* meanwhile loses nothing. Enter adds the next node, Tab one under it, */
/* Shift-Enter a new line, Escape stops; [[ offers the vault's notes.   */
/* ------------------------------------------------------------------ */

import { autocompletion, completionStatus } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { nodeById } from '../tree/400-tree-model.js';
import { addChild, addSibling, outdentNode, setText } from '../tree/404-tree-ops.js';
import { MindMapInput } from './425-mindmap-input.js';

/** Notes named like what follows an unclosed [[, as completions. */
export function linkCompletions(app) {
  return (context) => {
    const before = context.matchBefore(/\[\[[^\]\n]*$/);
    if (!before) return null;
    const typed = before.text.slice(2).toLowerCase();
    const files = app && app.vault && typeof app.vault.getMarkdownFiles === 'function' ? app.vault.getMarkdownFiles() : [];
    const options = files
      .filter((f) => f.basename.toLowerCase().includes(typed))
      .slice(0, 50)
      .map((f) => ({ label: f.basename, apply: `${f.basename}]]` }));
    return { from: before.from + 2, options, filter: false };
  };
}

export class MindMapEditing extends MindMapInput {
  /** A node edited: its text in an editor over its box. `replace` starts it over with those characters. */
  edit(id, replace) {
    if (!this.model || this.failure || this.presenting) return;
    const n = nodeById(this.model, id);
    if (!n || n.virtual) return;
    this.closeEditor(true);
    this.undo.naming(id);
    this.select(id);
    this.reveal(id);
    const host = this.renderer.plane.createDiv({ cls: 'dr-mindmap-editor' });
    const view = this;
    const start = replace === undefined ? n.text : replace;
    const editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: start,
        selection: { anchor: start.length },
        extensions: [
          EditorView.lineWrapping,
          autocompletion({ override: [linkCompletions(this.app)], icons: false }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && view.editing && view.editing.editor === u.view) view.typed(u.state.doc.toString());
          }),
        ],
      }),
    });
    // The editor's own keys, taken before CodeMirror sees them (Obsidian's build lets another handler have Escape first).
    host.addEventListener('keydown', (evt) => this.editorKey(evt, editor), true);
    this.editing = { id, host, editor };
    if (start !== n.text) this.typed(start);
    this.placeEditor();
    editor.focus();
  }

  /** A key in the editor: the ones that leave it, or a new line; Undo is the map's. The suggestions, while shown, keep theirs. */
  editorKey(evt, editor) {
    const mod = evt.ctrlKey || evt.metaKey;
    const key = evt.key;
    let run = null;
    if (mod && !evt.altKey && (key === 'z' || key === 'Z' || key === 'y')) {
      const redo = key === 'y' || evt.shiftKey;
      run = () => {
        this.closeEditor(true);
        this.undoStep(redo);
      };
    } else if (!mod && !evt.altKey && completionStatus(editor.state) !== 'active') {
      if (key === 'Enter' && evt.shiftKey) run = () => editor.dispatch(editor.state.replaceSelection('\n'));
      else if (key === 'Enter') run = () => this.finishAnd('sibling');
      else if (key === 'Tab') run = () => this.finishAnd(evt.shiftKey ? 'outdent' : 'child');
      else if (key === 'Escape') run = () => this.closeEditor(true);
    }
    if (!run || evt.isComposing) return;
    evt.preventDefault();
    evt.stopPropagation();
    run();
  }

  /** What's typed, into the node — joined to the step before while the typing goes on. */
  typed(text) {
    if (!this.editing || !this.model) return;
    const patch = setText(this.model, this.editing.id, text);
    if (patch) this.apply(patch, this.editing.id);
  }

  /** The editor kept over its node's box, as the map moves and the box grows. */
  placeEditor() {
    if (!this.editing || !this.scene) return;
    const b = this.scene.boxes.get(this.editing.id);
    const host = this.editing.host;
    if (!b) return;
    host.style.left = `${b.x}px`;
    host.style.top = `${b.y}px`;
    host.style.width = `${Math.max(b.width, 160)}px`;
    host.style.minHeight = `${b.height}px`;
  }

  /** Done typing, then the next thing: a node after it, one under it, or out a level. */
  finishAnd(next) {
    const id = this.editing && this.editing.id;
    this.closeEditor(true);
    if (!id || !this.model) return;
    if (next === 'sibling') {
      const patch = this.apply(addSibling(this.model, id, ''));
      if (patch) this.edit(patch.selection[0]);
    } else if (next === 'child') {
      const patch = this.apply(addChild(this.model, id, ''));
      if (patch) this.edit(patch.selection[0]);
    } else if (next === 'outdent') {
      this.apply(outdentNode(this.model, id));
      this.edit(id);
    }
  }

  /** The editor closed; the map takes the keys again. */
  closeEditor(keepFocus) {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    e.editor.destroy();
    e.host.remove();
    if (keepFocus && this.root && typeof this.root.focus === 'function') this.root.focus();
  }
}
