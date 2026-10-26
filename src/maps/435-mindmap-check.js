/* ------------------------------------------------------------------ */
/* Mind map: looking it over, and comparing                            */
/*                                                                    */
/* Check lists what may be wrong with the map, each finding going to   */
/* its node. Compare sets the map against a snapshot kept of it, or    */
/* against another map, or one branch against another: what's new,     */
/* reworded and moved is marked on the map and listed with what's gone,*/
/* until Done. Snapshots are kept by the plugin, by the map's path.    */
/* ------------------------------------------------------------------ */

import { Notice, TFile } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { ChoicePicker } from '../ui/230-pickers.js';
import { nodeById } from '../tree/400-tree-model.js';
import { mapProblems } from '../tree/409-tree-check.js';
import { compareMapBranches, compareMaps } from '../tree/410-tree-compare.js';
import { FILE_FORMATS, MINDMAP_EXTENSION } from './421-mindmap-view.js';
import { nodeLabel } from './423-mindmap-scene.js';
import { MindMapNotes } from './434-mindmap-notes.js';

export const MAP_SNAPSHOTS = 'mindmap-snapshots.json';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export class MindMapCheck extends MindMapNotes {
  /** What may be wrong with the map, listed. */
  checkMap() {
    if (!this.model) return;
    const cache = this.app && this.app.metadataCache;
    const from = this.file ? this.file.path : '';
    const exists = cache && typeof cache.getFirstLinkpathDest === 'function' ? (target) => !!cache.getFirstLinkpathDest(target, from) : null;
    const found = mapProblems(this.model, exists);
    const marks = new Map(found.map((p) => [p.id, 'problem']));
    this.showFindings(found.length ? plural(found.length, 'thing to look at', 'things to look at') : 'Nothing looks wrong', found.map((p) => ({ id: p.id, text: p.problem })), marks);
  }

  /**
   * A panel of findings in the corner — a heading, a row for each, a row
   * going to its node — and their marks on the nodes, until Done.
   */
  showFindings(head, rows, marks) {
    this.closeFindings();
    this.marks = marks || new Map();
    const box = this.root.createDiv({ cls: 'dr-mindmap-findings' });
    this.findingsEl = box;
    const top = box.createDiv({ cls: 'dr-mindmap-findings-head' });
    top.createSpan({ cls: 'dr-mindmap-findings-title', text: head });
    const done = top.createEl('button', { text: 'Done' });
    done.addEventListener('click', () => this.closeFindings());
    const list = box.createDiv({ cls: 'dr-mindmap-findings-rows' });
    rows.forEach((row) => {
      const el = list.createDiv({ cls: 'dr-mindmap-findings-row' });
      const n = row.id && nodeById(this.model, row.id);
      el.createSpan({ cls: 'dr-mindmap-findings-node', text: row.label || (n ? nodeLabel(n) || 'Untitled' : '') });
      el.createSpan({ cls: 'dr-mindmap-findings-text', text: row.text });
      if (!n) return el.addClass('is-gone');
      asButton(el);
      onActivate(el, () => {
        if (typeof this.rememberLook === 'function') this.rememberLook();
        this.select(row.id);
        this.reveal(row.id);
      });
    });
    this.draw();
  }

  closeFindings() {
    if (this.findingsEl) this.findingsEl.remove();
    const had = !!this.findingsEl;
    this.findingsEl = null;
    this.marks = null;
    if (had) this.draw();
  }

  /* -- snapshots and comparing ---------------------------------------- */

  snapshotPath() {
    const dir = this.plugin && this.plugin.manifest && this.plugin.manifest.dir;
    return dir ? `${dir}/${MAP_SNAPSHOTS}` : null;
  }

  async readSnapshots() {
    const at = this.snapshotPath();
    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    if (!at || !adapter) return {};
    try {
      return (await adapter.exists(at)) ? JSON.parse(await adapter.read(at)) || {} : {};
    } catch (err) {
      return {};
    }
  }

  /** The map as it is now, kept to compare with later — one snapshot a map. */
  async keepSnapshot() {
    const at = this.snapshotPath();
    if (!at || !this.file || !this.model) return false;
    if (typeof this.flushSave === 'function') this.flushSave();
    const all = await this.readSnapshots();
    all[this.file.path] = { text: this.text, at: Date.now() };
    await this.app.vault.adapter.write(at, JSON.stringify(all));
    new Notice('A snapshot of the map is kept: compare with it later.');
    return true;
  }

  /** Compare with: the snapshot kept, or another map, picked. */
  async chooseComparison() {
    const snap = this.file ? (await this.readSnapshots())[this.file.path] : null;
    const items = [];
    if (snap) items.push({ label: 'The snapshot kept', note: new Date(snap.at).toLocaleString(), snap });
    const maps = this.app.vault.getFiles().filter((f) => f !== this.file && (f.extension === MINDMAP_EXTENSION || (this.feature && typeof this.feature.isMap === 'function' && this.feature.isMap(f))));
    maps.forEach((f) => items.push({ label: f.basename, note: f.parent && f.parent.path !== '/' ? f.parent.path : '', file: f }));
    if (!items.length) {
      new Notice('Nothing to compare with yet: keep a snapshot of the map first.');
      return;
    }
    new ChoicePicker(this.app, 'Compare the map with…', items, async (item) => {
      if (item.snap) return this.compareWithText(item.snap.text, this.file, 'the snapshot');
      this.compareWithText(await this.app.vault.read(item.file), item.file, `“${item.file.basename}”`);
    }).open();
  }

  /** The map compared with another as written: what's new, gone, reworded and moved. */
  compareWithText(text, file, against) {
    let then;
    try {
      then = FILE_FORMATS[file instanceof TFile && file.extension === MINDMAP_EXTENSION ? 'mindmap' : 'md'].parse(text, file);
    } catch (err) {
      new Notice(`${against} can’t be read as a map.`);
      return null;
    }
    const diff = compareMaps(this.model, then);
    this.showDiff(diff, against);
    return diff;
  }

  showDiff(diff, against) {
    const marks = new Map();
    diff.added.forEach((n) => marks.set(n.id, 'added'));
    diff.reworded.forEach((n) => marks.set(n.id, 'reworded'));
    diff.moved.forEach((n) => !marks.has(n.id) && marks.set(n.id, 'moved'));
    const rows = []
      .concat(diff.added.map((n) => ({ id: n.id, text: 'New' })))
      .concat(diff.reworded.map((n) => ({ id: n.id, text: `Was “${n.was}”` })))
      .concat(diff.moved.map((n) => ({ id: n.id, text: `Moved; ${n.was}` })))
      .concat(diff.removed.map((n) => ({ label: n.label, text: 'Gone' })));
    const counts = [];
    if (diff.added.length) counts.push(`${diff.added.length} new`);
    if (diff.removed.length) counts.push(`${diff.removed.length} gone`);
    if (diff.reworded.length) counts.push(`${diff.reworded.length} reworded`);
    if (diff.moved.length) counts.push(`${diff.moved.length} moved`);
    const rel = diff.relations.added + diff.relations.removed;
    if (rel) counts.push(plural(rel, 'relation changed', 'relations changed'));
    this.showFindings(counts.length ? `Against ${against}: ${counts.join(', ')}` : `The same as ${against}`, rows, marks);
  }

  /** The selected node's branch compared with another's, picked. */
  chooseBranchComparison(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    const items = [];
    const go = (x) => {
      if (x.id !== id && x.children.length) items.push({ label: nodeLabel(x) || 'Untitled', id: x.id });
      x.children.forEach(go);
    };
    go(this.model.root);
    new ChoicePicker(this.app, `Compare “${nodeLabel(n)}” with…`, items, (item) => this.compareBranches(id, item.id)).open();
  }

  compareBranches(aId, bId) {
    const found = compareMapBranches(this.model, aId, bId);
    const a = nodeLabel(nodeById(this.model, aId));
    const b = nodeLabel(nodeById(this.model, bId));
    const marks = new Map();
    found.onlyA.forEach((x) => marks.set(x.id, 'added'));
    found.onlyB.forEach((x) => marks.set(x.id, 'reworded'));
    found.both.forEach((x) => marks.set(x.id, 'moved'));
    const rows = []
      .concat(found.onlyA.map((x) => ({ id: x.id, text: `Only under “${a}”` })))
      .concat(found.onlyB.map((x) => ({ id: x.id, text: `Only under “${b}”` })))
      .concat(found.both.map((x) => ({ id: x.id, text: 'Under both' })));
    this.showFindings(`“${a}” and “${b}”: ${found.onlyA.length} only in the first, ${found.onlyB.length} only in the second, ${found.both.length} in both`, rows, marks);
    return found;
  }
}
