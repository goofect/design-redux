/* ------------------------------------------------------------------ */
/* Canvas: comparing                                                   */
/*                                                                     */
/* A canvas against how it was — a snapshot kept earlier, or another   */
/* canvas, such as a copy: cards that are new, reworded or hang from   */
/* another card now are marked on it, and those gone are listed. Or    */
/* two branches against each other: what's under one and not the       */
/* other. A bar above the canvas counts them, lists them to go to, and */
/* puts the canvas back as it looked when you're done.                 */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { canvasDataOf, cardElement, liveCards } from '../core/079-canvas-adapter.js';
import { ComparePicker } from '../ui/230-pickers.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { arrowLinks, canvasCardLabel, canvasModel, isGroupRecord, modelFromData } from './316-canvas-tree.js';
import { branchWithin, CanvasFind } from './321-canvas-extras.js';
import { isCanvasEdge } from './332-canvas-arrows.js';
import { typingInto } from './334-canvas-mindmap.js';
import { stopCanvasPointer } from './335-canvas-fold.js';

export const SNAPSHOT_LIMIT = 30;

export const DIFF_KINDS = {
  added: 'new',
  reworded: 'reworded',
  moved: 'moved',
  removed: 'gone',
  onlyA: 'only in the first',
  onlyB: 'only in the second',
};

/** What a card says, to tell whether it's changed: its words, its note, its link, or its label. */
export function cardWords(rec) {
  if (rec.type === 'file') return `${rec.file || ''}${rec.subpath || ''}`;
  if (rec.type === 'link') return String(rec.url || '');
  if (rec.type === 'group') return String(rec.label || '');
  return String(rec.text || '').trim();
}

/**
 * Two canvases' data compared: { added, reworded, moved, removed, arrows }.
 * Cards are the same card by id; those left over, by title, one to one.
 * Each entry is { id, label, was? } — id in `now`, except for removed,
 * whose id is in `then`.
 */
export function compareCanvases(now, then) {
  const a = modelFromData(now);
  const b = modelFromData(then);
  const pair = new Map();
  const taken = new Set();
  a.nodes.forEach((n) => {
    if (b.byId.has(n.id)) {
      pair.set(n.id, n.id);
      taken.add(n.id);
    }
  });
  const byTitle = new Map();
  b.nodes.forEach((n) => {
    if (taken.has(n.id)) return;
    const key = `${n.type}:${canvasCardLabel(n).toLowerCase()}`;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(n);
  });
  a.nodes.forEach((n) => {
    if (pair.has(n.id)) return;
    const same = byTitle.get(`${n.type}:${canvasCardLabel(n).toLowerCase()}`);
    if (same && same.length) {
      const m = same.shift();
      pair.set(n.id, m.id);
      taken.add(m.id);
    }
  });
  const la = arrowLinks(a);
  const lb = arrowLinks(b);
  const parentOf = (links, id) => (links.parents.get(id) || []).slice().sort()[0] || null;
  const out = { added: [], reworded: [], moved: [], removed: [], arrows: { added: 0, removed: 0 } };
  a.nodes.forEach((n) => {
    const label = canvasCardLabel(n);
    if (!pair.has(n.id)) return out.added.push({ id: n.id, label });
    const m = b.byId.get(pair.get(n.id));
    if (cardWords(n) !== cardWords(m)) out.reworded.push({ id: n.id, label, was: canvasCardLabel(m) });
    if (isGroupRecord(n)) return;
    const p = parentOf(la, n.id);
    const q = parentOf(lb, m.id);
    const pNow = p ? pair.get(p) || `new:${p}` : null;
    if (pNow !== q) {
      const was = q ? canvasCardLabel(b.byId.get(q)) : null;
      out.moved.push({ id: n.id, label, was: was ? `hung from “${was}”` : 'hung from nothing' });
    }
  });
  b.nodes.forEach((m) => {
    if (!taken.has(m.id)) out.removed.push({ id: m.id, label: canvasCardLabel(m) });
  });
  const back = new Map(Array.from(pair.entries()).map(([x, y]) => [y, x]));
  const arrows = (model, map) => new Set(model.edges.map((e) => `${map ? map.get(e.from) || `?${e.from}` : e.from}>${map ? map.get(e.to) || `?${e.to}` : e.to}`));
  const sa = arrows(a, null);
  const sb = arrows(b, back);
  sa.forEach((k) => {
    if (!sb.has(k)) out.arrows.added++;
  });
  sb.forEach((k) => {
    if (!sa.has(k)) out.arrows.removed++;
  });
  return out;
}

/** Two branches compared by their cards' titles: { onlyA, onlyB, both } of { id, label }. */
export function compareBranches(model, aId, bId) {
  const links = arrowLinks(model);
  const under = (id) => branchWithin(model, [id], links).filter((x) => x !== id).map((x) => model.byId.get(x)).filter((r) => r && !isGroupRecord(r));
  const ua = under(aId);
  const ub = under(bId);
  const key = (r) => canvasCardLabel(r).toLowerCase();
  const ka = new Set(ua.map(key));
  const kb = new Set(ub.map(key));
  const row = (r) => ({ id: r.id, label: canvasCardLabel(r) });
  return {
    onlyA: ua.filter((r) => !kb.has(key(r))).map(row),
    onlyB: ub.filter((r) => !ka.has(key(r))).map(row),
    both: ua.filter((r) => kb.has(key(r))).map(row),
  };
}

export class CanvasCompare extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasCompare',
        name: 'Compare',
        desc: 'Compare a canvas with a snapshot kept earlier or another canvas, marking what’s new, reworded or moved; or two selected branches.',
      },
    ];
  }

  actions() {
    const on = (ctx) => this.enabled && !!ctx.view;
    // Two cards, and nothing else, to compare the branches of.
    const two = (ctx) => {
      const cards = ctx.nodes.filter((n) => !isCanvasEdge(n));
      return on(ctx) && this.watched.has(ctx.view) && cards.length === 2 && cards.length === ctx.nodes.length ? cards : null;
    };
    return [
      { id: 'canvas-keep-snapshot', name: 'Keep a snapshot of this canvas, to compare with later', menu: false, icon: 'camera', on: 'canvas', when: on, run: (ctx) => this.keepSnapshot(ctx.view) },
      { id: 'canvas-compare', name: 'Compare this canvas with…', menu: false, icon: 'git-compare', on: 'canvas', when: on, run: (ctx) => this.chooseOther(ctx.view) },
      { id: 'canvas-compare-branches', name: 'Compare the two selected cards’ branches', menu: 'Compare branches', icon: 'columns-2', on: 'canvas', when: (ctx) => !!two(ctx), run: (ctx) => this.showBranches(ctx.view, two(ctx)[0], two(ctx)[1]) },
      { id: 'canvas-compare-done', name: 'Stop comparing', menu: false, icon: 'x', on: 'canvas', when: (ctx) => on(ctx) && !!this.diffOf(ctx.view), run: (ctx) => this.done(ctx.view) },
    ];
  }

  register() {
    super.register();
    // Snapshots follow their canvas.
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.followRename(file, oldPath)));
  }

  diffOf(view) {
    const state = view && this.watched.get(view);
    return state && state.diff ? state.diff : null;
  }

  /* -- snapshots ------------------------------------------------------ */

  get snapshotPath() {
    const dir = this.plugin.manifest && this.plugin.manifest.dir;
    return dir ? `${dir}/canvas-snapshots.json` : null;
  }

  async readSnapshots() {
    const path = this.snapshotPath;
    const adapter = this.app.vault.adapter;
    try {
      if (path && (await adapter.exists(path))) return JSON.parse(await adapter.read(path)) || {};
    } catch (err) {
      console.error('Design Redux: could not read the canvas snapshots', err);
    }
    return {};
  }

  async writeSnapshots(all) {
    const path = this.snapshotPath;
    if (!path) return false;
    // The most recent few, so the file stays small.
    const keep = Object.keys(all)
      .sort((x, y) => (all[y].time || 0) - (all[x].time || 0))
      .slice(0, SNAPSHOT_LIMIT);
    const out = {};
    keep.forEach((k) => (out[k] = all[k]));
    try {
      await this.app.vault.adapter.write(path, JSON.stringify(out));
      return true;
    } catch (err) {
      console.error('Design Redux: could not keep the canvas snapshot', err);
      return false;
    }
  }

  async keepSnapshot(view) {
    if (!view || !view.canvas || !view.file) return false;
    const data = canvasDataOf(view.canvas);
    if (!data) return false;
    const all = await this.readSnapshots();
    all[view.file.path] = { time: Date.now(), data };
    const ok = await this.writeSnapshots(all);
    new Notice(ok ? 'Snapshot kept. “Compare this canvas with…” compares with it.' : 'Could not keep the snapshot.');
    return ok;
  }

  async followRename(file, oldPath) {
    if (!file || file.extension !== 'canvas' || !this.snapshotPath) return;
    const all = await this.readSnapshots();
    if (!all[oldPath]) return;
    all[file.path] = all[oldPath];
    delete all[oldPath];
    await this.writeSnapshots(all);
  }

  /** The snapshot, then other canvases, newest first, to compare with. */
  async chooseOther(view) {
    if (!view || !view.file) return;
    const all = await this.readSnapshots();
    const items = [];
    const snap = all[view.file.path];
    if (snap) items.push({ label: 'The snapshot', note: new Date(snap.time).toLocaleString(), data: snap.data, name: 'the snapshot' });
    this.app.vault
      .getFiles()
      .filter((f) => f.extension === 'canvas' && f !== view.file)
      .sort((x, y) => y.stat.mtime - x.stat.mtime)
      .forEach((f) => items.push({ label: f.basename, note: f.parent && f.parent.path !== '/' ? f.parent.path : '', file: f, name: `“${f.basename}”` }));
    if (!items.length) {
      new Notice('There’s nothing to compare with yet: keep a snapshot first.');
      return;
    }
    new ComparePicker(this.app, items, 'Compare with', async (item) => {
      let data = item.data;
      if (!data) {
        try {
          data = JSON.parse(await this.app.vault.read(item.file));
        } catch (err) {
          new Notice(`Couldn’t read ${item.name}.`);
          return;
        }
      }
      this.showVersions(view, data, item.name);
    }).open();
  }

  /* -- showing -------------------------------------------------------- */

  showVersions(view, then, name) {
    const now = canvasDataOf(view.canvas);
    if (!now) return null;
    const found = compareCanvases(now, then);
    const marks = new Map();
    const rows = [];
    ['added', 'reworded', 'moved'].forEach((kind) =>
      found[kind].forEach((r) => {
        if (!marks.has(r.id)) marks.set(r.id, kind);
        rows.push({ id: r.id, label: r.label, kind, note: kind === 'reworded' ? `was “${r.was}”` : kind === 'moved' ? r.was : DIFF_KINDS[kind] });
      })
    );
    found.removed.forEach((r) => rows.push({ id: null, label: r.label, kind: 'removed', note: 'gone' }));
    const counts = ['added', 'removed', 'reworded', 'moved'].map((k) => [k, found[k].length]);
    const arrows = found.arrows.added + found.arrows.removed;
    const extra = arrows ? `${arrows} ${arrows === 1 ? 'arrow' : 'arrows'} changed` : '';
    this.show(view, { title: `Compared with ${name}`, marks, rows, counts, extra });
    return found;
  }

  showBranches(view, a, b) {
    const model = canvasModel(view.canvas);
    const found = compareBranches(model, a.id, b.id);
    const marks = new Map();
    const rows = [];
    found.onlyA.forEach((r) => {
      marks.set(r.id, 'onlyA');
      rows.push(Object.assign({ kind: 'onlyA', note: `only under “${canvasCardLabel(model.byId.get(a.id))}”` }, r));
    });
    found.onlyB.forEach((r) => {
      marks.set(r.id, 'onlyB');
      rows.push(Object.assign({ kind: 'onlyB', note: `only under “${canvasCardLabel(model.byId.get(b.id))}”` }, r));
    });
    const counts = [
      ['onlyA', found.onlyA.length],
      ['onlyB', found.onlyB.length],
    ];
    const extra = `${found.both.length} in both`;
    this.show(view, { title: `“${canvasCardLabel(model.byId.get(a.id))}” and “${canvasCardLabel(model.byId.get(b.id))}”`, marks, rows, counts, extra });
    return found;
  }

  /** The marks put on the canvas, and the bar that counts them. */
  show(view, diff) {
    const state = this.watched.get(view);
    if (!state) return;
    this.done(view);
    state.diff = diff;
    const bar = view.contentEl.createDiv({ cls: 'dr-compare-bar' });
    if (typeof stopCanvasPointer === 'function') stopCanvasPointer(bar);
    bar.createSpan({ cls: 'dr-compare-title', text: diff.title });
    // Each count by the colour its cards are marked in.
    const counts = bar.createSpan({ cls: 'dr-compare-counts' });
    const shown = diff.counts.filter(([, n]) => n);
    shown.forEach(([k, n]) => {
      const part = counts.createSpan({ cls: 'dr-compare-count' });
      if (k !== 'removed') part.createSpan({ cls: `dr-diff-dot dr-diff-${k}` });
      part.createSpan({ text: `${n} ${DIFF_KINDS[k]}` });
    });
    if (diff.extra) counts.createSpan({ cls: 'dr-compare-count', text: diff.extra });
    if (!shown.length && !diff.extra) counts.createSpan({ cls: 'dr-compare-count', text: 'no difference' });
    if (diff.rows.length) {
      const list = bar.createEl('button', { text: 'List' });
      list.addEventListener('click', () => this.list(view));
    }
    const done = bar.createEl('button', { text: 'Done' });
    done.addEventListener('click', () => this.done(view));
    state.bar = bar;
    state.onKey = (evt) => {
      if (evt.key === 'Escape' && !typingInto(evt.target)) this.done(view);
    };
    view.containerEl.addEventListener('keydown', state.onKey);
    this.pass(view, state);
  }

  list(view) {
    const diff = this.diffOf(view);
    if (!diff) return;
    const find = this.plugin.feature(CanvasFind);
    new ComparePicker(this.app, diff.rows, diff.title, (row) => {
      if (!row.id) new Notice(`“${row.label}” isn’t on this canvas any more.`);
      else if (find) find.goTo(view, row.id);
    }).open();
  }

  done(view) {
    const state = view && this.watched.get(view);
    if (!state) return;
    state.diff = null;
    if (state.bar) state.bar.remove();
    state.bar = null;
    if (state.onKey) view.containerEl.removeEventListener('keydown', state.onKey);
    state.onKey = null;
    this.cleanup(view);
  }

  /** Each redraw: the marks kept on the cards, drawn afresh or not. */
  pass(view, state) {
    if (!state || !state.diff) return;
    try {
      liveCards(view.canvas).forEach((node) => {
        const kind = state.diff.marks.get(node.id);
        const el = cardElement(node);
        if (!el) return;
        Object.keys(DIFF_KINDS).forEach((k) => el.classList.toggle(`dr-diff-${k}`, kind === k));
      });
    } catch (err) {
      /* unmarked */
    }
  }

  cleanup(view, state) {
    if (state && state.bar) state.bar.remove();
    if (state && state.onKey && view.containerEl) view.containerEl.removeEventListener('keydown', state.onKey);
    if (!view.contentEl) return;
    Object.keys(DIFF_KINDS).forEach((k) => view.contentEl.querySelectorAll(`.canvas-node.dr-diff-${k}`).forEach((el) => el.classList.remove(`dr-diff-${k}`)));
  }
}

CanvasCompare.settingKey = 'canvasCompare';
