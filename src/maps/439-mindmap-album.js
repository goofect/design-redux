/* ------------------------------------------------------------------ */
/* Mind map: a collection and its map, kept in step                    */
/*                                                                    */
/* One command makes a collection's mind map laid out by the parent    */
/* property its notes already use. While the map is open it follows    */
/* the notes — a new note gets a node under its parent, a changed      */
/* parent moves it, a note gone takes its node — as changes made        */
/* outside, not steps of Undo. The other way is asked: moving a note's  */
/* node under another's sets its note's parent, through the notes      */
/* service, with Undo. A node taken off by hand leaves its note out of  */
/* the map, never touching the note. The collection a map follows is   */
/* kept in the map's own layout block.                                 */
/* ------------------------------------------------------------------ */

import { Notice, TFile, TFolder } from 'obsidian';
import { sortByOrder } from '../core/030-helpers-art.js';
import { fmGet, parentLinkpaths } from '../core/045-helpers-properties.js';
import { noteProps } from '../core/073-notes.js';
import { ChoicePicker, SetParentPrompt } from '../ui/230-pickers.js';
import { nodeById, treeModel } from '../tree/400-tree-model.js';
import { writeOutline } from '../tree/401-tree-outline.js';
import { applyPatch } from '../tree/404-tree-ops.js';
import { albumEntry, albumEntryOps } from '../tree/406-tree-layout-block.js';
import { albumParentTree, albumSyncOps } from '../tree/413-tree-album.js';
import { FILE_FORMATS, MINDMAP_EXTENSION } from './421-mindmap-view.js';
import { MindMapVaultMap } from './436-mindmap-vault-map.js';
import { MindMapPresent } from './438-mindmap-present.js';

/* How long the notes are left to settle before an open map follows them. */
export const MAP_ALBUM_WAIT = 500;

export class MindMapAlbumFeature extends MindMapVaultMap {
  get parentProperty() {
    return String(this.settings.graphRouteProperty || 'parent').trim() || 'parent';
  }

  /** A collection's notes, in its own order, its folder note aside. */
  albumNotes(folder) {
    const files = (folder.children || []).filter((c) => c instanceof TFile && c.extension === 'md' && !this.plugin.isFolderNote(c));
    return this.plugin.orders ? this.plugin.orders.arrangeAlbum(folder, files, (list) => sortByOrder(list, this.settings.defaultSort || 'name')) : files;
  }

  /** What a note names as its parent, resolved the way the graph's routes resolve it. */
  albumParentsOf(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    const raw = file instanceof TFile ? fmGet(noteProps(this.app, file), this.parentProperty) : undefined;
    const found = [];
    const missing = [];
    if (raw === undefined || raw === null || raw === '') return { found, missing };
    parentLinkpaths(raw).forEach((linkpath) => {
      const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, path);
      if (dest instanceof TFile) {
        if (dest.path !== path && found.indexOf(dest.path) === -1) found.push(dest.path);
      } else missing.push(linkpath);
    });
    return { found, missing };
  }

  /** A collection's notes as a tree by parent, those left out aside. */
  albumTree(folder, leftOut) {
    const root = typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(folder) : null;
    const out = new Set(leftOut || []);
    const notes = this.albumNotes(folder).map((f) => f.path).filter((p) => !out.has(p));
    return albumParentTree(notes, (p) => this.albumParentsOf(p), root ? root.path : '');
  }

  /** A link to a note, as written in a map at `from`. */
  albumLink(path, from) {
    const file = this.app.vault.getAbstractFileByPath(path);
    const cache = this.app.metadataCache;
    if (!(file instanceof TFile)) return `[[${path.replace(/\.md$/, '')}]]`;
    return `[[${cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(file, from, true) : file.basename}]]`;
  }

  /** The collection's mind map: made beside its notes, or opened if it's there. */
  async mapAlbumAsMindMap(folder) {
    if (!(folder instanceof TFolder)) return null;
    const path = `${folder.path}/${folder.name} map.md`;
    const there = this.app.vault.getAbstractFileByPath(path);
    let file = there instanceof TFile ? there : null;
    if (!file) {
      const tree = this.albumTree(folder, []);
      const note = typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(folder) : null;
      const model = treeModel(note ? this.albumLink(note.path, path) : folder.name);
      const pathOf = (n) => this.albumNotePath(n, path);
      const { ops } = albumSyncOps(model, tree, pathOf, (p) => this.albumLink(p, path), null, []);
      applyPatch(model, ops.concat(albumEntryOps(model, { path: folder.path, leftOut: [] })), []);
      try {
        file = await this.app.vault.create(path, writeOutline(model, null));
      } catch (err) {
        console.error('Design Redux: could not make the map', err);
        new Notice('Could not make the map.');
        return null;
      }
      this.tellAlbum(tree);
    }
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf) await leaf.openFile(file);
    return file;
  }

  /** The note a node is a link to, by path, or null. */
  albumNotePath(n, from) {
    const m = /^[ \t]*\[\[([^\]|#^]+)/.exec(String((n && n.text) || '').split('\n')[0]);
    const cache = this.app.metadataCache;
    if (!m || !cache || typeof cache.getFirstLinkpathDest !== 'function') return null;
    const dest = cache.getFirstLinkpathDest(m[1].trim(), from);
    return dest instanceof TFile ? dest.path : null;
  }

  /** What's odd about the tree, in a notice that names the notes. */
  tellAlbum(tree) {
    const name = (p) => {
      const f = this.app.vault.getAbstractFileByPath(p);
      return f instanceof TFile ? f.basename : p;
    };
    const lines = [];
    if (tree.cycles.length) lines.push(`A loop of parents, broken at ${tree.cycles.map(([n]) => `“${name(n)}”`).join(', ')}: drawn as a dashed relation.`);
    const several = tree.cross.filter(([, n]) => !tree.cycles.some(([c]) => c === n));
    if (several.length) lines.push(`More than one parent: ${Array.from(new Set(several.map(([, n]) => `“${name(n)}”`))).join(', ')} — the first is the tree, the rest dashed relations.`);
    if (tree.missing.length) lines.push(`A parent that names no note: ${tree.missing.map((m) => `“${name(m.note)}” (${m.name})`).join(', ')} — hung from the collection.`);
    if (lines.length) new Notice(lines.join('\n'), 10000);
  }

  /** The open maps that follow a collection a file is in. */
  albumMapsTouching(paths) {
    const out = [];
    this.app.workspace.getLeavesOfType('design-redux-mindmap').forEach((leaf) => {
      const view = leaf.view;
      const entry = view && view.model ? albumEntry(view.model) : null;
      if (entry && paths.some((p) => p && p.startsWith(entry.path + '/'))) out.push(view);
    });
    return out;
  }

  /** A note's parent property set — or taken off — through the notes service, with Undo. */
  writeAlbumParent(file, parent) {
    const prop = this.parentProperty;
    return this.plugin.notes.write(
      file,
      (fm) => {
        const key = Object.keys(fm).find((k) => k.toLowerCase() === prop.toLowerCase()) || prop;
        if (parent) fm[key] = `[[${parent.basename}]]`;
        else delete fm[key];
      },
      { undo: parent ? `“${file.basename}” now has “${parent.basename}” as its ${prop}.` : `“${file.basename}” no longer has a ${prop}.` }
    );
  }

  /** A collection renamed or moved: the maps that follow it, written to follow it still. */
  async followAlbumRename(folder, oldPath) {
    const vault = this.app.vault;
    for (const map of vault.getFiles().filter((f) => this.isMap(f))) {
      const text = await vault.read(map);
      if (!text.includes('"album"')) continue;
      const kind = map.extension === MINDMAP_EXTENSION ? 'mindmap' : 'md';
      let model;
      try {
        model = FILE_FORMATS[kind].parse(text, map);
      } catch (err) {
        continue;
      }
      const entry = albumEntry(model);
      if (!entry || !(entry.path === oldPath || entry.path.startsWith(oldPath + '/'))) continue;
      const moved = (p) => (p === oldPath || p.startsWith(oldPath + '/') ? folder.path + p.slice(oldPath.length) : p);
      applyPatch(model, albumEntryOps(model, { path: moved(entry.path), leftOut: entry.leftOut.map(moved) }), []);
      await vault.modify(map, FILE_FORMATS[kind].write(model, text, map));
    }
  }
}

export class MindMapAlbumView extends MindMapPresent {
  albumFolder() {
    const entry = this.model ? albumEntry(this.model) : null;
    const f = entry && this.app ? this.app.vault.getAbstractFileByPath(entry.path) : null;
    return f instanceof TFolder ? f : null;
  }

  /** Followed a moment from now, once, however many changes come. */
  albumLater() {
    if (this.albumTimer) clearTimeout(this.albumTimer);
    this.albumTimer = setTimeout(() => {
      this.albumTimer = 0;
      this.syncAlbum();
    }, MAP_ALBUM_WAIT);
  }

  /** The map brought into step with its collection's notes; `tell` says what's odd. */
  syncAlbum(opts = {}) {
    const folder = this.albumFolder();
    const feature = this.feature;
    if (!folder || !feature || !this.model || this.failure || this.presenting) return null;
    const entry = albumEntry(this.model);
    const from = this.file ? this.file.path : '';
    const tree = feature.albumTree(folder, entry.leftOut);
    const pathOf = (n) => feature.albumNotePath(n, from) || this.goneNotePath(n);
    const { ops, leftOut } = albumSyncOps(this.model, tree, pathOf, (p) => feature.albumLink(p, from), this.albumShown || null, entry.leftOut);
    const all = ops.concat(albumEntryOps(this.model, { path: entry.path, leftOut }));
    if (all.length) this.applySync(applyPatch(this.model, all, this.selected ? [this.selected] : []));
    this.albumShown = new Set();
    const walk = (n) => {
      const p = pathOf(n);
      if (p) this.albumShown.add(p);
      n.children.forEach(walk);
    };
    this.model.root.children.forEach(walk);
    if (opts.tell) feature.tellAlbum(tree);
    return all.length;
  }

  /** A node's link to a note the map showed last time that's no longer there: that note's path, or null. */
  goneNotePath(n) {
    const m = /^[ \t]*\[\[([^\]|#^]+)/.exec(String((n && n.text) || '').split('\n')[0]);
    if (!m || !this.albumShown) return null;
    const link = m[1].trim();
    return Array.from(this.albumShown).find((p) => p === `${link}.md` || p.split('/').pop() === `${link}.md`) || null;
  }

  /** A note left out of the map, picked, put back on it. */
  putBackLeftOut() {
    const entry = this.model ? albumEntry(this.model) : null;
    if (!entry || !entry.leftOut.length) return;
    const items = entry.leftOut.map((p) => ({ label: p.split('/').pop().replace(/\.md$/, ''), path: p }));
    new ChoicePicker(this.app, 'Put a left-out note back on the map…', items, (item) => {
      this.applySync(applyPatch(this.model, albumEntryOps(this.model, { path: entry.path, leftOut: entry.leftOut.filter((p) => p !== item.path) }), []));
      if (this.albumShown) this.albumShown.delete(item.path);
      this.syncAlbum();
    }).open();
  }

  /** A change made here: a note's node moved under another's sets the note's parent, as the setting says. */
  afterChange(patch) {
    const folder = this.albumFolder();
    const feature = this.feature;
    if (!folder || !feature || !patch) return;
    const from = this.file ? this.file.path : '';
    patch.ops
      .filter((op) => op.type === 'move')
      .forEach((op) => {
        const n = nodeById(this.model, op.id);
        const childPath = n && feature.albumNotePath(n, from);
        const child = childPath ? this.app.vault.getAbstractFileByPath(childPath) : null;
        if (!(child instanceof TFile)) return;
        // Onto the root: no parent of its own; onto a note: that note; onto a node of your own: the note above it.
        let up = n.parent;
        while (up && up !== this.model.root && !feature.albumNotePath(up, from)) up = up.parent;
        if (!up) return;
        const parentPath = up === this.model.root ? null : feature.albumNotePath(up, from);
        const parent = parentPath ? this.app.vault.getAbstractFileByPath(parentPath) : null;
        const now = feature.albumParentsOf(childPath).found[0] || null;
        if ((parent ? parent.path : null) === now) return;
        const mode = feature.settings.albumMapWritesParent || 'ask';
        if (mode === 'never') return;
        if (mode === 'always') return feature.writeAlbumParent(child, parent);
        new SetParentPrompt(this.app, child, parent, async (choice) => {
          if (choice === 'map') return;
          if (choice === 'always') {
            feature.settings.albumMapWritesParent = 'always';
            await feature.plugin.saveSettings();
          }
          await feature.writeAlbumParent(child, parent);
        }).open();
      });
  }
}
