/* ------------------------------------------------------------------ */
/* Canvas: a map of a folder or a tag                                  */
/*                                                                     */
/* A new canvas of a folder's notes, or a tag's: the folder or tag at  */
/* the root, its folders or narrower tags as branches, each note a     */
/* card where it belongs — a folder with a folder note shown as that   */
/* note. Links between the notes become related arrows, dashed and out */
/* of the tree. Laid out as a tidy tree, and opened in a new tab.      */
/* ------------------------------------------------------------------ */

import { FuzzySuggestModal, getAllTags, Notice, TFile, TFolder } from 'obsidian';
import { RELATED_KEY } from '../core/020-constants.js';
import { byName, sortByOrder } from '../core/030-helpers-art.js';
import { noteNameFrom } from '../core/047-helpers-text.js';
import { actionsOn, addActionEntries } from '../core/078-actions.js';
import { Feature } from '../core/080-feature.js';
import { canvasAction } from './321-canvas-extras.js';
import { treeCards } from './324-canvas-outlines.js';
import { nearestSides } from './332-canvas-arrows.js';
import { boxEdges } from './334-canvas-mindmap.js';

export const MAP_CARD_LIMIT = 200;
export const MAP_LINK_LIMIT = 300;
export const MAP_NOTE_SIZE = { width: 280, height: 100 };
export const MAP_HEAD_SIZE = { width: 250, height: 60 };
export const MAP_ROOT_SIZE = { width: 300, height: 80 };

export function mapNoteCard(file) {
  return { card: Object.assign({ type: 'file', file: file.path }, MAP_NOTE_SIZE), children: [] };
}

export function mapItemCount(items) {
  return items.reduce((n, it) => n + 1 + mapItemCount(it.children), 0);
}

/**
 * A map's canvas data: { nodes, edges }. `rootCard` the root's data
 * without id or place; `items` as treeCards takes them; `links` pairs of
 * note paths, each joined by a related arrow where both have a card.
 */
export function vaultMapData(rootCard, items, links, newId) {
  const root = Object.assign({ id: newId(), x: 0, y: 0 }, rootCard);
  const made = treeCards(root, items, 'right', newId);
  const all = [root].concat(made.nodes);
  const byPath = new Map();
  all.forEach((n) => {
    if (n.type === 'file' && !byPath.has(n.file)) byPath.set(n.file, n);
  });
  const pairs = new Set(made.edges.map((e) => [e.fromNode, e.toNode].sort().join(' ')));
  let joined = 0;
  (links || []).forEach(([a, b]) => {
    const p = byPath.get(a);
    const q = byPath.get(b);
    if (joined >= MAP_LINK_LIMIT || !p || !q || p === q) return;
    const pair = [p.id, q.id].sort().join(' ');
    if (pairs.has(pair)) return;
    pairs.add(pair);
    const sides = nearestSides(boxEdges(p), boxEdges(q));
    made.edges.push({ id: newId(), fromNode: p.id, fromSide: sides.from, toNode: q.id, toSide: sides.to, [RELATED_KEY]: true });
    joined++;
  });
  return { nodes: all, edges: made.edges };
}

export class TagPicker extends FuzzySuggestModal {
  constructor(app, tags, onChoose) {
    super(app);
    this.tags = tags;
    this.onChoose = onChoose;
    this.setPlaceholder('A tag to map');
  }

  getItems() {
    return this.tags;
  }

  getItemText(t) {
    return `${t.tag} (${t.count})`;
  }

  onChooseItem(t) {
    this.onChoose(t.tag);
  }
}

export class CanvasVaultMap extends Feature {
  settingsSchema() {
    return [
      {
        key: 'canvasVaultMap',
        name: 'Map a folder or tag',
        desc: 'A folder’s menu, or a command, makes a canvas of its notes: folders or narrower tags as branches, links between notes as related arrows.',
      },
    ];
  }

  actions() {
    return [
      { id: 'canvas-map-folder', name: 'Make a canvas map of this folder', menu: 'Make a canvas map', icon: 'network', on: 'album', when: () => this.enabled && !!this.settings.mindmapKeepCanvasMaps, run: (ctx) => this.mapFolder(ctx.folder) },
      { id: 'canvas-map-tag', name: 'Make a canvas map of a tag…', menu: false, icon: 'tags', on: 'app', when: () => this.enabled && !!this.settings.mindmapKeepCanvasMaps, run: () => new TagPicker(this.app, this.allTags(), (tag) => this.mapTag(tag)).open() },
    ];
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('file-menu', (menu, target) => {
        if (target instanceof TFolder) addActionEntries(menu, actionsOn(this.actions(), 'album'), { folder: target, from: 'menu' }, canvasAction);
      })
    );
  }

  /** A folder's notes in the order its album lists them; the folder note stands for the folder. */
  notesIn(folder) {
    const files = (folder.children || []).filter((c) => c instanceof TFile && c.extension === 'md' && !this.plugin.isFolderNote(c));
    const sort = this.settings.defaultSort || 'name';
    return this.plugin.orders.arrangeAlbum(folder, files, (list) => sortByOrder(list, sort));
  }

  /** A folder as a card: its folder note, or its name. */
  folderCard(folder) {
    const note = typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(folder) : null;
    if (note) return Object.assign({ type: 'file', file: note.path }, MAP_NOTE_SIZE);
    return Object.assign({ type: 'text', text: folder.isRoot && folder.isRoot() ? this.app.vault.getName() : folder.name }, MAP_HEAD_SIZE);
  }

  /** A folder's notes, then its folders that hold notes, each with theirs. */
  folderItems(folder) {
    const items = this.notesIn(folder).map(mapNoteCard);
    (folder.children || [])
      .filter((c) => c instanceof TFolder)
      .sort((a, b) => byName(a.name, b.name))
      .forEach((sub) => {
        const children = this.folderItems(sub);
        if (children.length || this.plugin.folderNote(sub)) items.push({ card: this.folderCard(sub), children });
      });
    return items;
  }

  /** Every tag and how many notes have it. */
  allTags() {
    const counts = {};
    const cache = this.app.metadataCache;
    if (typeof cache.getTags === 'function') {
      Object.assign(counts, cache.getTags());
    } else {
      this.app.vault.getMarkdownFiles().forEach((f) => this.tagsOf(f).forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
    }
    return Object.keys(counts)
      .sort((a, b) => byName(a, b))
      .map((tag) => ({ tag, count: counts[tag] }));
  }

  tagsOf(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return [];
    if (typeof getAllTags === 'function') return getAllTags(cache) || [];
    const out = (cache.tags || []).map((t) => t.tag);
    const fm = cache.frontmatter && (cache.frontmatter.tags || cache.frontmatter.tag);
    (Array.isArray(fm) ? fm : typeof fm === 'string' ? fm.split(/[,\s]+/) : []).forEach((t) => t && out.push(t.startsWith('#') ? t : `#${t}`));
    return out;
  }

  /** A tag's notes, under its narrower tags: each note once, under the narrowest of them. */
  tagItems(tag) {
    const low = tag.toLowerCase();
    const branches = new Map();
    const branch = (name) => {
      if (!branches.has(name)) branches.set(name, { name, notes: [], subs: new Set() });
      return branches.get(name);
    };
    branch(low);
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const mine = this.tagsOf(file)
        .map((t) => t.toLowerCase())
        .filter((t) => t === low || t.startsWith(low + '/'));
      if (!mine.length) return;
      const deepest = mine.sort((a, b) => b.split('/').length - a.split('/').length || byName(a, b))[0];
      branch(deepest).notes.push(file);
      // Each step between it and the tag mapped.
      const parts = deepest.split('/');
      for (let i = low.split('/').length; i < parts.length; i++) {
        branch(parts.slice(0, i).join('/')).subs.add(parts.slice(0, i + 1).join('/'));
        branch(parts.slice(0, i + 1).join('/'));
      }
    });
    const items = (name) => {
      const b = branches.get(name);
      const out = b.notes.sort((x, y) => byName(x.basename, y.basename)).map(mapNoteCard);
      Array.from(b.subs)
        .sort((x, y) => byName(x, y))
        .forEach((sub) => out.push({ card: Object.assign({ type: 'text', text: `#${sub.split('/').pop().replace(/^#/, '')}` }, MAP_HEAD_SIZE), children: items(sub) }));
      return out;
    };
    return items(low);
  }

  /** Links between notes, as pairs of paths. */
  links() {
    const out = [];
    const resolved = this.app.metadataCache.resolvedLinks || {};
    Object.keys(resolved).forEach((from) => Object.keys(resolved[from] || {}).forEach((to) => out.push([from, to])));
    return out;
  }

  mapFolder(folder) {
    if (!folder) return Promise.resolve(null);
    const items = this.folderItems(folder);
    const name = folder.isRoot && folder.isRoot() ? this.app.vault.getName() : folder.name;
    return this.make(`${name} map`, folder, this.folderCard(folder), items);
  }

  mapTag(tag) {
    if (!tag) return Promise.resolve(null);
    const items = this.tagItems(tag);
    let folder = null;
    try {
      folder = typeof this.app.fileManager.getNewFileParent === 'function' ? this.app.fileManager.getNewFileParent('') : null;
    } catch (err) {
      folder = null;
    }
    const root = Object.assign({ type: 'text', text: `# ${tag}` }, MAP_ROOT_SIZE);
    return this.make(`${tag.replace(/^#/, '').replace(/\//g, ' ')} map`, folder, root, items);
  }

  /** The canvas written, beside what it maps, and opened. */
  async make(name, folder, rootCard, items) {
    const count = mapItemCount(items);
    if (!count) {
      new Notice('There are no notes to map.');
      return null;
    }
    if (count > MAP_CARD_LIMIT) {
      new Notice(`That would make ${count} cards; ${MAP_CARD_LIMIT} is the most for one map.`);
      return null;
    }
    let n = 0;
    const stamp = Date.now().toString(16);
    const newId = () => `${stamp}${(n++).toString(16).padStart(4, '0')}`.slice(-16);
    const data = vaultMapData(rootCard, items, this.links(), newId);
    const path = this.plugin.freeChildPath(folder || this.app.vault.getRoot(), noteNameFrom(name), 'canvas');
    let file = null;
    try {
      file = await this.app.vault.create(path, JSON.stringify(data, null, '\t'));
    } catch (err) {
      console.error('Design Redux: could not make the map', err);
      new Notice('Could not make the map.');
      return null;
    }
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf) await leaf.openFile(file);
    return file;
  }
}

CanvasVaultMap.settingKey = 'canvasVaultMap';
