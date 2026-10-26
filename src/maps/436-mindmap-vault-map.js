/* ------------------------------------------------------------------ */
/* Mind map: a map of a folder or a tag                                */
/*                                                                    */
/* A folder's menu, or a command, makes a mind map of its notes: the   */
/* folder note (or its name) at the root, notes as links in the order  */
/* its album lists them, its folders that hold notes as branches; a    */
/* tag's notes under its narrower tags, each note once. Links between  */
/* the notes become relations. Read from the library's index; written  */
/* as a new map beside what it maps, and opened.                       */
/* ------------------------------------------------------------------ */

import { getAllTags, Notice, TFile, TFolder } from 'obsidian';
import { byName, sortByOrder } from '../core/030-helpers-art.js';
import { noteNameFrom } from '../core/047-helpers-text.js';
import { libraryIndex } from '../core/077-library-index.js';
import { Feature } from '../core/080-feature.js';
import { writeOutline } from '../tree/401-tree-outline.js';
import { writeMindmapJson } from '../tree/402-tree-json.js';
import { VAULT_MAP_LIMIT, vaultItemCount, vaultMapModel } from '../tree/411-tree-vault-map.js';
import { MINDMAP_EXTENSION } from './421-mindmap-view.js';

export class MindMapVaultMap extends Feature {
  /** A note as a node: a link to it, as written from the map. */
  noteItem(file, from) {
    const cache = this.app.metadataCache;
    const text = cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(file, from, true) : file.basename;
    return { text: `[[${text}]]`, path: file.path, children: [] };
  }

  /** A folder's notes, in its album's order, then its folders holding notes, each with theirs. */
  folderMapItems(folder, from) {
    const index = libraryIndex(this.plugin);
    const files = index.notes().filter((f) => f.parent === folder);
    const sort = this.settings.defaultSort || 'name';
    const ordered = this.plugin.orders ? this.plugin.orders.arrangeAlbum(folder, files, (list) => sortByOrder(list, sort)) : files;
    const items = ordered.map((f) => this.noteItem(f, from));
    (folder.children || [])
      .filter((c) => c instanceof TFolder)
      .sort((a, b) => byName(a.name, b.name))
      .forEach((sub) => {
        const children = this.folderMapItems(sub, from);
        const note = typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(sub) : null;
        if (!children.length && !note) return;
        const head = note ? this.noteItem(note, from) : { text: sub.name };
        items.push(Object.assign(head, { children }));
      });
    return items;
  }

  tagsOfFile(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return [];
    if (typeof getAllTags === 'function') return getAllTags(cache) || [];
    return (cache.tags || []).map((t) => t.tag);
  }

  /** A tag's notes under its narrower tags: each note once, under the narrowest it has. */
  tagMapItems(tag, from) {
    const low = tag.toLowerCase();
    const branches = new Map();
    const branch = (name) => {
      if (!branches.has(name)) branches.set(name, { notes: [], subs: new Set() });
      return branches.get(name);
    };
    branch(low);
    libraryIndex(this.plugin)
      .markdown()
      .forEach((file) => {
        const mine = this.tagsOfFile(file)
          .map((t) => t.toLowerCase())
          .filter((t) => t === low || t.startsWith(low + '/'));
        if (!mine.length) return;
        const deepest = mine.sort((a, b) => b.split('/').length - a.split('/').length || byName(a, b))[0];
        branch(deepest).notes.push(file);
        const parts = deepest.split('/');
        for (let i = low.split('/').length; i < parts.length; i++) {
          branch(parts.slice(0, i).join('/')).subs.add(parts.slice(0, i + 1).join('/'));
          branch(parts.slice(0, i + 1).join('/'));
        }
      });
    const items = (name) => {
      const b = branches.get(name);
      const out = b.notes.sort((x, y) => byName(x.basename, y.basename)).map((f) => this.noteItem(f, from));
      Array.from(b.subs)
        .sort((x, y) => byName(x, y))
        .forEach((sub) => out.push({ text: `#${sub.split('/').pop().replace(/^#/, '')}`, children: items(sub) }));
      return out;
    };
    return items(low);
  }

  /** The links between notes, as pairs of paths. */
  vaultLinks() {
    const out = [];
    const resolved = libraryIndex(this.plugin).resolved();
    Object.keys(resolved).forEach((from) => Object.keys(resolved[from] || {}).forEach((to) => out.push([from, to])));
    return out;
  }

  mapFolderAsMindMap(folder) {
    if (!(folder instanceof TFolder)) return Promise.resolve(null);
    const name = folder.isRoot && folder.isRoot() ? this.app.vault.getName() : folder.name;
    const note = typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(folder) : null;
    return this.writeVaultMap(`${name} map`, folder, (from) => ({ title: note ? this.noteItem(note, from).text : name, items: this.folderMapItems(folder, from) }));
  }

  mapTagAsMindMap(tag) {
    if (!tag) return Promise.resolve(null);
    let folder = null;
    try {
      folder = typeof this.app.fileManager.getNewFileParent === 'function' ? this.app.fileManager.getNewFileParent('') : null;
    } catch (err) {
      folder = null;
    }
    return this.writeVaultMap(`${tag.replace(/^#/, '').replace(/\//g, ' ')} map`, folder, (from) => ({ title: tag, items: this.tagMapItems(tag, from) }));
  }

  /** A note's relationships as a mind map beside it: the note at the root, a branch for each kind, the notes under it. */
  mapNoteRelationships(file, knowledge) {
    if (!(file instanceof TFile) || !knowledge) return Promise.resolve(null);
    const groups = knowledge.groups(file);
    if (!groups.length) {
      new Notice(`${file.basename} has no relationships to map yet.`);
      return Promise.resolve(null);
    }
    return this.writeVaultMap(`${file.basename} relationships`, file.parent, (from) => ({
      title: this.noteItem(file, from).text,
      items: groups.map((g) => ({ text: g.label, children: g.items.map((i) => this.noteItem(i.file, from)) })),
    }));
  }

  /** The map worked out — for links written from where it'll be — written in the format new maps take, and opened. */
  async writeVaultMap(name, folder, build) {
    const kind = this.settings.mindmapDefaultFormat === MINDMAP_EXTENSION ? MINDMAP_EXTENSION : 'md';
    const path = this.plugin.freeChildPath(folder || this.app.vault.getRoot(), noteNameFrom(name), kind);
    const { title, items } = build(path);
    const count = vaultItemCount(items);
    if (!count) {
      new Notice('There are no notes to map.');
      return null;
    }
    if (count > VAULT_MAP_LIMIT) {
      new Notice(`That would make ${count} nodes; ${VAULT_MAP_LIMIT} is the most for one map.`);
      return null;
    }
    const model = vaultMapModel(title, items, this.vaultLinks());
    const text = kind === MINDMAP_EXTENSION ? writeMindmapJson(model) : writeOutline(model, null, { title: name });
    let file = null;
    try {
      file = await this.app.vault.create(path, text);
    } catch (err) {
      console.error('Design Redux: could not make the map', err);
      new Notice('Could not make the map.');
      return null;
    }
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf && file instanceof TFile) await leaf.openFile(file);
    return file;
  }
}
