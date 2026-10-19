/* ------------------------------------------------------------------ */
/* Mind map: what a linked note says, on its node                      */
/*                                                                    */
/* A node that's just a link to a note shows, under its title, what    */
/* the note says now: its status, its due date — coloured as it's due  */
/* — and its description, or failing that its opening line. Read from  */
/* the note each time it changes; nothing is copied into the map.      */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { fmGet } from '../core/045-helpers-properties.js';
import { noteOpening, plainMarkdownLine } from '../core/047-helpers-text.js';
import { mixInto } from '../core/080-feature.js';
import { walk } from '../tree/400-tree-model.js';
import { dueState, isDayKey } from '../tree/415-tree-tasks.js';
import { MindMapView } from './421-mindmap-view.js';
import { dueLabel } from './450-mindmap-tasks.js';

/** A property's value as a chip says it: a list joined, a link without its brackets. */
function factValue(v) {
  if (v === null || v === undefined || v === '') return '';
  const one = Array.isArray(v) ? v.filter((x) => x !== null && x !== '').join(', ') : String(v);
  return plainMarkdownLine(one).slice(0, 40);
}

class MindMapLinked {
  linkedOn() {
    return !this.plugin || this.plugin.settings.mindmapLinkedCards !== false;
  }

  /** The note a node links to, kept on the node while its text stays. */
  linkedFile(n) {
    if (!this.linkMemo) this.linkMemo = new WeakMap();
    const memo = this.linkMemo.get(n);
    if (memo && memo.text === n.text) return memo.file;
    const file = typeof this.linkedNote === 'function' ? this.linkedNote(n) : null;
    this.linkMemo.set(n, { text: n.text, file });
    return file;
  }

  /** What a linked note says: { status, due, line }, or null for a node that links no note. */
  noteFacts(n) {
    if (!this.linkedOn() || !this.app || !this.app.metadataCache) return null;
    const file = this.linkedFile(n);
    if (!(file instanceof TFile) || file.extension !== 'md') return null;
    const mc = this.app.metadataCache;
    const cache = typeof mc.getFileCache === 'function' ? mc.getFileCache(file) : null;
    const fm = cache && cache.frontmatter;
    const due = fmGet(fm, 'due');
    return { path: file.path, status: factValue(fmGet(fm, 'status')), due: isDayKey(due) ? due : '', line: this.noteLine(file, fm) };
  }

  /** A note's description, or its opening line: read once a change, then kept by its time. */
  noteLine(file, fm) {
    const said = fmGet(fm, 'description');
    if (typeof said === 'string' && said.trim()) return plainMarkdownLine(said).slice(0, 140);
    const store = this.plugin ? this.plugin.excerpts || (this.plugin.excerpts = new Map()) : (this.excerpts = this.excerpts || new Map());
    const key = `${file.path}|${file.stat ? file.stat.mtime : 0}`;
    if (store.has(key)) return store.get(key);
    if (!this.reading) this.reading = new Set();
    if (!this.reading.has(key) && this.app.vault && typeof this.app.vault.cachedRead === 'function') {
      this.reading.add(key);
      this.app.vault
        .cachedRead(file)
        .then((text) => {
          if (store.size > 4000) store.clear();
          store.set(key, noteOpening(text));
          this.reading.delete(key);
          this.notesChanged();
        })
        .catch(() => this.reading.delete(key));
    }
    return '';
  }

  /** What of the facts changes how a node looks or how big it is. */
  noteKey(n) {
    const f = this.noteFacts(n);
    return f ? `|n:${f.status}|${f.due}|${f.due ? dueState({ attrs: { due: f.due } }) : ''}|${f.line}` : '';
  }

  /** The facts under a node's title. */
  noteChips(el, n) {
    const f = this.noteFacts(n);
    if (!f || !(f.status || f.due || f.line)) return;
    const box = el.createDiv({ cls: 'dr-mindmap-note-facts' });
    if (f.status || f.due) {
      const row = box.createDiv({ cls: 'dr-mindmap-chips' });
      if (f.status) row.createSpan({ cls: 'dr-mindmap-chip is-status', text: f.status });
      if (f.due) {
        const state = dueState({ attrs: { due: f.due } });
        row.createSpan({ cls: `dr-mindmap-chip is-due is-${state}`, text: dueLabel(f.due) });
      }
    }
    if (f.line) box.createDiv({ cls: 'dr-mindmap-note-line', text: f.line });
  }

  /** Listening for notes changing, once a view: a linked one changed, its node's facts read again. */
  watchNotes() {
    const cache = this.app && this.app.metadataCache;
    if (!cache || typeof cache.on !== 'function' || this.watchingNotes) return;
    this.watchingNotes = true;
    this.registerEvent(cache.on('changed', (file) => this.noteChanged(file)));
    this.register(() => window.clearTimeout(this.notesTimer));
    // A note made, renamed or deleted: which notes nodes link to may have changed. Not on every save — the map's own too.
    const vault = this.app.vault;
    if (vault && typeof vault.on === 'function') {
      ['create', 'delete', 'rename'].forEach((type) =>
        this.registerEvent(
          vault.on(type, () => {
            this.linkMemo = null;
            if (this.model && this.linkedOn()) this.notesLater();
          })
        )
      );
    }
  }

  /** Drawn again in a moment: a folder of notes moved is one redraw, not one a note. */
  notesLater() {
    if (this.notesTimer) return;
    this.notesTimer = window.setTimeout(() => {
      this.notesTimer = null;
      this.notesChanged();
    }, 200);
  }

  /** A note changed: drawn again, if a node links to it. */
  noteChanged(file) {
    if (!this.model || !this.linkedOn() || !file) return;
    let linked = false;
    walk(this.model, (n) => {
      if (!linked && this.linkedFile(n) === file) linked = true;
    });
    if (linked) this.notesChanged();
  }

  notesChanged() {
    if (!this.model || this.editing) return;
    this.sizeMemo = null;
    this.relayout(false);
    this.draw();
  }
}

mixInto(MindMapView, MindMapLinked);
