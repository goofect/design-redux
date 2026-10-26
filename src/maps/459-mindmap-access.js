/* ------------------------------------------------------------------ */
/* Mind map: reached by keys, by screen reader, by links               */
/*                                                                    */
/* The map tells a screen reader which node is picked — as the tree's  */
/* active item, and in a quiet live line: its words, how deep, which   */
/* of how many, folded or not — so the arrow keys walk it aloud.       */
/* [[Map#^id]] opens the map at that node, from anywhere; Copy link to */
/* node gives the node its id, if it hasn't one, and copies the link.  */
/* ------------------------------------------------------------------ */

import { Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { around } from '../core/030-helpers-art.js';
import { nodeById } from '../tree/400-tree-model.js';
import { applyPatch } from '../tree/404-tree-ops.js';
import { MINDMAP_VIEW } from './421-mindmap-view.js';
import { isMindMapNote, keptAsText } from './422-mindmap-takeover.js';
import { nodeLabel, visibleChildren } from './423-mindmap-scene.js';

/** What a screen reader says of a node: its words, its level, its place among its siblings, folded or open. */
export function nodeSaying(model, n) {
  let depth = 1;
  for (let p = n.parent; p && !p.virtual; p = p.parent) depth++;
  const siblings = n.parent ? visibleChildren(n.parent) : model.free.includes(n) ? model.free : [n];
  const at = siblings.indexOf(n) + 1;
  const parts = [nodeLabel(n) || 'Untitled', `level ${depth}`];
  if (siblings.length > 1 && at > 0) parts.push(`${at} of ${siblings.length}`);
  if (n.children.length) parts.push(n.attrs.fold ? `folded, ${n.children.length} below` : 'open');
  return parts.join(', ');
}

export class MindMapAccess {
  /** The picked node told to a screen reader: the tree's active item, and the live line. */
  announce() {
    if (!this.root) return;
    if (!this.liveEl) {
      this.liveEl = this.root.createDiv({ cls: 'dr-mindmap-live' });
      this.liveEl.setAttribute('aria-live', 'polite');
      this.liveEl.setAttribute('role', 'status');
    }
    const n = this.model && this.selected ? nodeById(this.model, this.selected) : null;
    const el = n && this.renderer && this.renderer.nodeEls.get(n.id);
    if (el) {
      if (!this.domPrefix) this.domPrefix = `dr-node-${Math.random().toString(36).slice(2, 8)}-`;
      el.id = this.domPrefix + n.id;
      this.root.setAttribute('aria-activedescendant', el.id);
    } else this.root.removeAttribute('aria-activedescendant');
    const say = n ? nodeSaying(this.model, n) : '';
    if (say !== this.saidLast) {
      this.saidLast = say;
      this.liveEl.setText(say);
    }
  }

  /** Obsidian opening the map at a place: [[Map#^id]] opens it at that node, once it's read. */
  setEphemeralState(state) {
    const sub = state && typeof state.subpath === 'string' ? state.subpath : '';
    const m = /^#\^([A-Za-z0-9-]+)$/.exec(sub);
    if (!m) return;
    this.focusAfterRead = m[1];
    this.focusPending();
  }

  /** The node a link asked for, gone to now the map's read. */
  focusPending() {
    const id = this.focusAfterRead;
    if (!id || !this.model) return;
    this.focusAfterRead = null;
    if (!nodeById(this.model, id)) {
      new Notice('That node isn’t on this map any more.');
      return;
    }
    if (typeof this.openTo === 'function') this.openTo(id);
  }

  /** A link to the node on the clipboard — the node given its id first, if it hasn't one. */
  async copyNodeLink(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n || !this.file) return null;
    if (!n.anchor) this.apply(applyPatch(this.model, [{ type: 'anchor', id, on: true }], [id]));
    const cache = this.app && this.app.metadataCache;
    const linktext = cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(this.file, '', true) : this.file.basename;
    const link = `[[${linktext}#^${id}|${nodeLabel(n)}]]`;
    try {
      await navigator.clipboard.writeText(link);
      new Notice('A link to the node copied.');
    } catch (err) {
      new Notice(link);
    }
    return link;
  }
}

export class MindMapsLinks {
  /**
   * A map note opened from a link goes straight to the map, with where the
   * link points — [[Map#^id]] — handed over; opened as text first, the
   * place would be lost as the map took over. Not where the tab keeps it
   * as text, nor with taking over switched off.
   */
  patchOpenFile() {
    const proto = WorkspaceLeaf && WorkspaceLeaf.prototype;
    if (!proto || typeof proto.openFile !== 'function' || typeof proto.setViewState !== 'function') return;
    const maps = this;
    this.plugin.register(
      around(proto, 'openFile', (original, leaf, args) => {
        const [file, openState] = args;
        const state = openState || {};
        const asMap = maps.takesOver && file instanceof TFile && isMindMapNote(maps.app, file) && !keptAsText(leaf, file.path) && !(state.state && state.state.mode === 'source');
        if (!asMap) return original.apply(leaf, args);
        return leaf.setViewState({ type: MINDMAP_VIEW, state: { file: file.path }, active: state.active, group: state.group }, state.eState);
      })
    );
  }
}
