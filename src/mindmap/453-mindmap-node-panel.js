/* ------------------------------------------------------------------ */
/* Mind map: the selected node in the note panel                       */
/*                                                                    */
/* On a map, the note panel opens from the map's bar for the map's     */
/* note, with a section for the node picked: its text to edit, its     */
/* attributes to take off, what points to it — the node above, the     */
/* relations into it, the notes linking to its ^id — and a button to   */
/* make a note of it, or open the one it links to.                     */
/* ------------------------------------------------------------------ */

import { setIcon, TFile } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { libraryIndex } from '../core/077-library-index.js';
import { mixInto } from '../core/080-feature.js';
import { PanelSection } from '../core/082-panel-section.js';
import { nodeById } from '../tree/400-tree-model.js';
import { setAttr, setText } from '../tree/404-tree-ops.js';
import { noteLinkOf } from '../tree/408-tree-notes.js';
import { MindMaps } from './420-mindmap-feature.js';
import { MindMapView } from './421-mindmap-view.js';
import { nodeLabel } from './423-mindmap-scene.js';

/** An attribute's value as the panel shows it. */
function attrText(v) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export class NodeSection extends PanelSection {
  get cls() {
    return 'dr-node-section';
  }

  /** The map the panel was opened from, if it's this note's. */
  get view() {
    const v = this.panel.leaf && this.panel.leaf.view;
    return v instanceof MindMapView && v.file === this.file ? v : null;
  }

  render() {
    const view = this.view;
    if (!view || !view.model) return;
    this.renderLabel('Node');
    const n = view.selected ? nodeById(view.model, view.selected) : null;
    if (!n) {
      this.containerEl.createDiv({ cls: 'dr-empty', text: 'Select a node on the map to see it here.' });
      return;
    }
    // Its text, all of it: the first line its title, the rest its details.
    const text = this.containerEl.createEl('textarea', { cls: 'dr-node-text' });
    text.value = n.text;
    text.rows = Math.min(8, Math.max(2, n.text.split('\n').length + 1));
    text.setAttribute('aria-label', 'The node’s text');
    text.addEventListener('change', () => {
      const now = nodeById(view.model, n.id);
      if (now && text.value !== now.text) view.apply(setText(view.model, n.id, text.value));
    });
    // Its attributes, each to take off.
    const keys = Object.keys(n.attrs).filter((k) => n.attrs[k] !== undefined);
    if (keys.length) {
      const list = this.containerEl.createDiv({ cls: 'dr-node-attrs' });
      keys.forEach((k) => {
        const row = list.createDiv({ cls: 'dr-node-attr' });
        row.createSpan({ cls: 'dr-node-attr-key', text: k });
        row.createSpan({ cls: 'dr-node-attr-value', text: attrText(n.attrs[k]) });
        const off = row.createSpan({ cls: 'dr-node-attr-off clickable-icon' });
        setIcon(off, 'x');
        asButton(off, `Take off ${k}`);
        onActivate(off, () => view.apply(setAttr(view.model, n.id, k, undefined)));
      });
    }
    // What points to it.
    const into = [];
    if (n.parent && !n.parent.virtual) into.push({ label: nodeLabel(n.parent), note: 'Above it', id: n.parent.id });
    (view.model.relations || []).forEach((r) => {
      if (r.to !== n.id) return;
      const from = nodeById(view.model, r.from);
      if (from) into.push({ label: nodeLabel(from), note: r.label || 'Relates to it', id: from.id });
    });
    linkingNotes(this.app, this.plugin, view.file, n).forEach((f) => into.push({ label: f.basename, note: 'Links to it', file: f }));
    this.renderList('node-in', 'Points to it', into, (list, item) => {
      const row = list.createDiv({ cls: 'dr-mention-row' });
      row.createSpan({ cls: 'dr-mention-title', text: item.label || 'Untitled' });
      row.createSpan({ cls: 'dr-mention-note', text: item.note });
      asButton(row, item.file ? `Open ${item.label}` : `Go to ${item.label}`);
      onActivate(row, () => {
        if (item.file) this.app.workspace.getLeaf(false).openFile(item.file);
        else view.openTo(item.id);
      });
    });
    // A note of it — or the note it is.
    const linked = view.linkedNote(n);
    if (linked) {
      const open = this.containerEl.createEl('button', { cls: 'dr-node-make', text: `Open ${linked.basename}` });
      open.addEventListener('click', () => this.app.workspace.getLeaf(false).openFile(linked));
    } else if (n !== view.model.root && !n.virtual && !noteLinkOf(n.text)) {
      const make = this.containerEl.createEl('button', { cls: 'dr-node-make mod-cta', text: 'Make a note from this node' });
      make.addEventListener('click', () => view.branchToNote(n.id));
    }
  }
}

/** The notes that link to a node by its ^id: of those linking to the map, the ones whose link names it. */
export function linkingNotes(app, plugin, mapFile, n) {
  if (!n.anchor || !(mapFile instanceof TFile) || !app || !app.metadataCache || typeof app.metadataCache.getFileCache !== 'function') return [];
  const want = `#^${n.id}`;
  let from = [];
  try {
    from = libraryIndex(plugin).incoming(mapFile) || [];
  } catch (err) {
    from = [];
  }
  return from.filter((f) => {
    const cache = app.metadataCache.getFileCache(f);
    return ((cache && cache.links) || []).concat((cache && cache.embeds) || []).some((l) => String(l.link || '').endsWith(want));
  });
}

class MindMapNodePanel {
  /** What the note panel is about on a map: its note. */
  panelTarget() {
    return this.file ? { file: this.file } : { none: 'This map has no file yet.' };
  }

  /** The note panel opened, or closed, against the bar's button. */
  togglePanel(anchor) {
    if (this.app && this.app.workspace && typeof this.app.workspace.trigger === 'function') this.app.workspace.trigger('design-redux:open-panel', this.leaf, anchor || this.panelTool);
  }

  /** The panel told the node it shows — or the map — changed. */
  panelChanged() {
    if (this.app && this.app.workspace && typeof this.app.workspace.trigger === 'function') this.app.workspace.trigger('design-redux:panel-changed', this.file);
  }
}

mixInto(MindMapView, MindMapNodePanel);

class MindMapsPanel {
  panelSections(panel) {
    return this.enabled && this.settings.mindmapNodePanel !== false ? [new NodeSection(panel)] : [];
  }
}

mixInto(MindMaps, MindMapsPanel);
