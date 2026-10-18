/* ------------------------------------------------------------------ */
/* Mind map: relations and arguments                                   */
/*                                                                    */
/* Relate a node to any other — by command, or by dragging it onto the */
/* other with Alt held — and say what the relation means: one of the   */
/* kinds of relationship set for the canvas, or your own words. What   */
/* the map states can be found, or written out as a note. And a node   */
/* can be given a part in an argument, or answered with a reason, an   */
/* objection, a rebuttal or evidence.                                  */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { relationTypes } from '../core/020-constants.js';
import { mixInto } from '../core/080-feature.js';
import { ChoicePicker, NamePrompt } from '../ui/230-pickers.js';
import { nodeById, walk } from '../tree/400-tree-model.js';
import { setAttr } from '../tree/404-tree-ops.js';
import { addAnswer, addRelation, relationMeaning, relationsOf, relationStatements, removeRelation, reverseRelation, setRelationMeaning, statementsMarkdown } from '../tree/407-tree-relations.js';
import { MindMapView } from './421-mindmap-view.js';
import { boundsOfBoxes, fitCamera, nodeLabel, nodeParts } from './423-mindmap-scene.js';

class MindMapRelations {
  kinds() {
    return relationTypes(this.plugin ? this.plugin.settings : {});
  }

  /** A relation read out: “Research → Build · depends on”. */
  relationText(r) {
    const a = nodeById(this.model, r.from);
    const b = nodeById(this.model, r.to);
    return `${nodeLabel(a) || 'Untitled'} → ${nodeLabel(b) || 'Untitled'}${r.label ? ` · ${r.label}` : ''}`;
  }

  /** A node related to another, picked by name. */
  relateFrom(id) {
    if (!this.model) return;
    const items = [];
    walk(this.model, (n) => {
      if (n.id !== id && !n.virtual) items.push({ label: nodeLabel(n) || 'Untitled', id: n.id });
    });
    new ChoicePicker(this.app, `Relate “${nodeLabel(nodeById(this.model, id))}” to…`, items, (item) => this.apply(addRelation(this.model, id, item.id))).open();
  }

  /** One of a node's relations, to act on: the only one, or picked. */
  pickRelation(id, then) {
    const mine = this.model ? relationsOf(this.model, id) : [];
    if (!mine.length) {
      new Notice('This node has no relations: relate it to another first.');
      return;
    }
    if (mine.length === 1) return then(mine[0].index);
    new ChoicePicker(this.app, 'Which relation?', mine.map(({ r, index }) => ({ label: this.relationText(r), index })), (item) => then(item.index)).open();
  }

  /** What a relation means, picked: a kind, your own words, or nothing. */
  nameRelation(index) {
    const r = this.model && this.model.relations[index];
    if (!r) return;
    const items = this.kinds().map((t) => ({ label: t.name, note: t.category === 'hierarchy' ? 'Hierarchy' : 'Association', type: t }));
    items.push({ label: 'In your own words…', words: true });
    if (relationMeaning(r)) items.push({ label: 'Says nothing', none: true });
    new ChoicePicker(this.app, `What does “${this.relationText(r)}” mean?`, items, (item) => {
      if (item.words) return this.stateProposition(index);
      this.apply(setRelationMeaning(this.model, index, item.none ? null : { kind: item.type.name }, item.type));
    }).open();
  }

  /** A relation's meaning in your own words: the first node's words about the second. */
  stateProposition(index) {
    const r = this.model && this.model.relations[index];
    if (!r) return;
    const was = relationMeaning(r);
    new NamePrompt(this.app, `${nodeLabel(nodeById(this.model, r.from))} … ${nodeLabel(nodeById(this.model, r.to))}`, 'constrains', (words) => {
      if (String(words || '').trim()) this.apply(setRelationMeaning(this.model, index, { predicate: words }));
    }, { value: was && was.predicate ? was.predicate : '' }).open();
  }

  reverseRelationAt(index) {
    this.apply(reverseRelation(this.model, index));
  }

  removeRelationAt(index) {
    this.apply(removeRelation(this.model, index));
  }

  statements() {
    return this.model ? relationStatements(this.model, this.kinds()) : [];
  }

  /** A statement picked by its words, and both its nodes brought into view. */
  findStatement() {
    const found = this.statements();
    if (!found.length) {
      new Notice('Nothing on this map says what it means yet: give a relation a kind, or your own words.');
      return;
    }
    const names = { hierarchy: 'Hierarchy', association: 'Association', proposition: 'Proposition' };
    const items = found.map((s) => ({ label: `${nodeLabel(s.subject)} ${s.verb} ${nodeLabel(s.object)}`, note: names[s.category], s }));
    new ChoicePicker(this.app, 'Find a statement', items, (item) => this.goToStatement(item.s)).open();
  }

  goToStatement(s) {
    const boxes = [s.subject, s.object].map((n) => this.scene && this.scene.boxes.get(n.id)).filter(Boolean);
    if (!boxes.length) return;
    if (typeof this.rememberLook === 'function') this.rememberLook();
    const { width, height } = this.renderer.size();
    this.camera = fitCamera(boundsOfBoxes(boxes), width, height);
    this.selected = s.subject.id;
    this.draw();
  }

  /** What the map states, written as a note beside it and opened in a new tab. */
  async statementsNote() {
    const found = this.statements();
    if (!found.length || !this.file) {
      new Notice('Nothing on this map says what it means yet: give a relation a kind, or your own words.');
      return null;
    }
    const text = statementsMarkdown(found, (n) => nodeParts(n).title || 'Untitled');
    const folder = this.file.parent || null;
    const path = this.plugin && typeof this.plugin.freeChildPath === 'function' ? this.plugin.freeChildPath(folder, `${this.file.basename} statements`, 'md') : `${this.file.basename} statements.md`;
    let file = null;
    try {
      file = await this.app.vault.create(path, text);
    } catch (err) {
      console.error('Design Redux: could not make the note', err);
      new Notice('Could not make the note.');
      return null;
    }
    new Notice(`Made “${file.basename}”.`);
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf) await leaf.openFile(file);
    return file;
  }

  /** A node given a part in an argument — or, given the part it has, none. */
  setRole(id, role) {
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    this.apply(setAttr(this.model, id, 'role', role && n.attrs.role !== role ? role : undefined));
  }

  /** A node answered: a reason, objection, rebuttal or evidence under it, to type in. */
  answer(id, role) {
    const p = this.apply(addAnswer(this.model, id, role));
    if (p && p.selection[0]) this.edit(p.selection[0]);
  }
}

mixInto(MindMapView, MindMapRelations);
