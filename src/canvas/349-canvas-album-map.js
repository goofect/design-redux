/* ------------------------------------------------------------------ */
/* Canvas: an album and its map, kept in step                          */
/*                                                                     */
/* One command makes a collection a live mind map laid out by the      */
/* parent property its notes already use (the graph's routes read the  */
/* same one, the same way). While the map is open it follows the notes: */
/* a new note gets a card under its parent, a changed parent moves it,  */
/* a note gone takes its card. The other way is asked: re-linking a     */
/* card offers to set its note's parent. Removing a card never touches  */
/* its note: it's left out of the map until it's added back.           */
/* ------------------------------------------------------------------ */

import { FuzzySuggestModal, Notice, TFile, TFolder } from 'obsidian';
import { RELATED_KEY } from '../core/020-constants.js';
import { sortByOrder } from '../core/030-helpers-art.js';
import { fmGet, parentLinkpaths } from '../core/045-helpers-properties.js';
import { noteProps } from '../core/073-notes.js';
import { actionsOn, addActionEntries } from '../core/078-actions.js';
import { addToCanvas, cardData, cardElement, cardKept, liveCard, liveCards, removeArrow, removeCard, requestCanvasSave } from '../core/079-canvas-adapter.js';
import { SetParentPrompt } from '../ui/230-pickers.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasModel, tuckOf } from './316-canvas-tree.js';
import { canvasAction } from './321-canvas-extras.js';
import { treeCards } from './324-canvas-outlines.js';
import { MAP_NOTE_SIZE, MAP_ROOT_SIZE } from './328-canvas-vault-map.js';
import { nearestSides } from './332-canvas-arrows.js';
import { boxEdges, newCanvasId } from './334-canvas-mindmap.js';
import { MAP_LAYOUT_KEY } from './348-canvas-map.js';
import { arrowLinks } from '../tree/400-tree-model.js';
import { BRANCH_LAYOUTS } from '../tree/403-tree-layouts.js';
import { albumParentTree } from '../tree/413-tree-album.js';

/* On an album map's cards: the root, and a note from outside the album (its folder's name). */
export const ALBUM_ROOT_KEY = 'drAlbumRoot';
export const ALBUM_OUTSIDE_KEY = 'drAlbumOutside';

/* How long the notes are left to settle before the map follows them. */
export const ALBUM_MAP_WAIT = 500;

/**
 * What a map needs to follow its notes: notes to add, cards to take
 * off, cards to hang from another, and notes newly left out — those
 * whose card went since the map last looked. cards: Map path → id;
 * parentsOn(id) → [ids] by the tree's arrows; mapped: paths the map last
 * showed; leftOut: [path].
 */
export function albumMapChanges(tree, cards, parentsOn, mapped, leftOut, rootId) {
  const out = { add: [], remove: [], relink: [], leaveOut: [] };
  const wanted = Array.from(tree.parent.keys());
  const kept = new Set(leftOut || []);
  wanted.forEach((path) => {
    if (kept.has(path)) return;
    if (!cards.has(path)) {
      if (mapped.has(path)) out.leaveOut.push(path);
      else out.add.push(path);
    }
  });
  cards.forEach((id, path) => {
    if (!tree.parent.has(path)) out.remove.push(path);
  });
  wanted.forEach((path) => {
    const id = cards.get(path);
    if (!id) return;
    const up = tree.parent.get(path);
    const upId = up ? cards.get(up) : rootId;
    if (!upId) return;
    if (parentsOn(id).indexOf(upId) === -1) out.relink.push({ path, parent: up || '' });
  });
  return out;
}

/** A left-out note to put back on the map. */
export class LeftOutPicker extends FuzzySuggestModal {
  constructor(app, files, onChoose) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder('A note to put back on the map');
  }

  getItems() {
    return this.files;
  }

  getItemText(f) {
    return f.basename;
  }

  onChooseItem(f) {
    this.onChoose(f);
  }
}

export class AlbumMap extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'albumMapAuto',
        name: 'Collection maps follow their notes',
        desc: 'A collection mapped by parent keeps its map current while it’s open: new notes get cards under their parents, a changed parent moves a card, a note gone takes its card.',
      },
      {
        key: 'albumMapWritesParent',
        type: 'dropdown',
        name: 'Re-linking a card on a collection’s map',
        desc: 'Whether hanging a card from another sets its note’s parent property.',
        options: { ask: 'Ask each time', always: 'Always set the parent', never: 'Only change the map' },
      },
      {
        key: 'albumMapLayout',
        type: 'dropdown',
        name: 'How a new collection map is laid out',
        options: Object.fromEntries(BRANCH_LAYOUTS.map(([mode, title]) => [mode, title])),
      },
    ];
  }

  get property() {
    return String(this.settings.graphRouteProperty || 'parent').trim() || 'parent';
  }

  actions() {
    const map = (ctx) => this.enabled && !!this.entryOf(ctx.view);
    return [
      { id: 'map-album', name: 'Map this collection by its notes’ parents', menu: 'Map by parent', icon: 'network', on: 'album', when: (ctx) => this.enabled && ctx.folder && !(ctx.folder.isRoot && ctx.folder.isRoot()), run: (ctx) => this.mapAlbum(ctx.folder) },
      { id: 'refresh-album-map', name: 'Bring this collection map up to date', menu: 'Bring up to date', icon: 'refresh-cw', on: 'canvas', when: map, run: (ctx) => this.refresh(ctx.view, { tell: true }) },
      { id: 'add-left-out-note', name: 'Put a left-out note back on the map', menu: 'Put back a left-out note', icon: 'file-plus', on: 'canvas', when: (ctx) => map(ctx) && this.leftOutFiles(ctx.view).length > 0, run: (ctx) => this.putBack(ctx.view) },
    ];
  }

  register() {
    super.register();
    const ws = this.app.workspace;
    this.plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (!this.enabled || !this.settings.albumMapAuto) return;
        this.watched.forEach((state, view) => {
          const folder = this.albumOf(view);
          if (folder && file.path.startsWith(folder.path + '/')) this.later(view, state);
        });
      })
    );
    ['create', 'delete', 'rename'].forEach((type) =>
      this.plugin.registerEvent(
        this.app.vault.on(type, (file, oldPath) => {
          if (type === 'rename' && file instanceof TFolder) this.followAlbum(file, oldPath);
          if (!this.enabled || !this.settings.albumMapAuto) return;
          this.watched.forEach((state, view) => {
            const folder = this.albumOf(view);
            const inside = (p) => folder && p && p.startsWith(folder.path + '/');
            if (inside(file.path) || inside(oldPath)) this.later(view, state);
          });
        })
      )
    );
    this.plugin.registerEvent(ws.on('design-redux:canvas-relinked', (view, childId, parentId) => this.enabled && this.relinked(view, childId, parentId)));
    this.plugin.registerEvent(
      ws.on('file-menu', (menu, target) => {
        if (this.enabled && target instanceof TFolder) addActionEntries(menu, actionsOn(this.actions(), 'album'), { folder: target, from: 'menu' }, canvasAction);
      })
    );
  }

  /** Its entry in the maps the map engine lays out — when it's a collection's map. */
  entryOf(view) {
    const e = view && view.file ? (this.settings.canvasMapFiles || {})[view.file.path] : null;
    return e && typeof e === 'object' && e.album ? e : null;
  }

  albumOf(view) {
    const e = this.entryOf(view);
    const f = e ? this.app.vault.getAbstractFileByPath(e.album) : null;
    return f instanceof TFolder ? f : null;
  }

  async saveEntry(path, entry) {
    const all = Object.assign({}, this.settings.canvasMapFiles || {});
    all[path] = entry;
    this.settings.canvasMapFiles = all;
    await this.plugin.saveSettings();
  }

  /** A collection renamed or moved: its maps still know it. */
  followAlbum(folder, oldPath) {
    const all = this.settings.canvasMapFiles || {};
    let changed = false;
    Object.keys(all).forEach((p) => {
      const e = all[p];
      if (!e || typeof e !== 'object' || !e.album) return;
      if (e.album === oldPath || e.album.startsWith(oldPath + '/')) {
        e.album = folder.path + e.album.slice(oldPath.length);
        changed = true;
      }
      if (Array.isArray(e.leftOut)) {
        e.leftOut = e.leftOut.map((l) => (l === oldPath || l.startsWith(oldPath + '/') ? folder.path + l.slice(oldPath.length) : l));
      }
    });
    if (changed) this.plugin.saveSettings();
  }

  /** A collection's notes, in its own order, its folder note aside. */
  notesIn(folder) {
    const files = (folder.children || []).filter((c) => c instanceof TFile && c.extension === 'md' && !this.plugin.isFolderNote(c));
    return this.plugin.orders.arrangeAlbum(folder, files, (list) => sortByOrder(list, this.settings.defaultSort || 'name'));
  }

  folderNoteOf(folder) {
    return typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(folder) : null;
  }

  /** What each note names as its parent, resolved the way the graph's routes resolve it. */
  parentsOf(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    const raw = file instanceof TFile ? fmGet(noteProps(this.app, file), this.property) : undefined;
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

  treeOf(folder, leftOut) {
    const root = this.folderNoteOf(folder);
    const out = new Set(leftOut || []);
    const notes = this.notesIn(folder).map((f) => f.path).filter((p) => !out.has(p));
    return albumParentTree(notes, (p) => this.parentsOf(p), root ? root.path : '');
  }

  /** What's odd about the tree, in a notice that names the notes. */
  tell(tree) {
    const name = (p) => {
      const f = this.app.vault.getAbstractFileByPath(p);
      return f instanceof TFile ? f.basename : p;
    };
    const lines = [];
    if (tree.cycles.length) lines.push(`A loop of parents, broken at ${tree.cycles.map(([n]) => `“${name(n)}”`).join(', ')}: drawn as a dashed link.`);
    const several = tree.cross.filter(([, n]) => !tree.cycles.some(([c]) => c === n));
    if (several.length) lines.push(`More than one parent: ${Array.from(new Set(several.map(([, n]) => `“${name(n)}”`))).join(', ')} — the first is the tree, the rest dashed links.`);
    if (tree.missing.length) lines.push(`A parent that names no note: ${tree.missing.map((m) => `“${name(m.note)}” (${m.name})`).join(', ')} — hung from the collection.`);
    if (lines.length) new Notice(lines.join('\n'), 10000);
  }

  /** The collection's map: made beside its notes, or opened if it's there. */
  async mapAlbum(folder) {
    const path = `${folder.path}/${folder.name} map.canvas`;
    const there = this.app.vault.getAbstractFileByPath(path);
    if (there instanceof TFile) {
      if (!this.entryOf({ file: there })) await this.saveEntry(path, { album: folder.path, via: this.property, leftOut: [] });
      const leaf = this.app.workspace.getLeaf(true);
      if (leaf) await leaf.openFile(there);
      return there;
    }
    const tree = this.treeOf(folder, []);
    if (!tree.parent.size) {
      new Notice(`There are no notes in ${folder.name} to map.`);
      return null;
    }
    const data = this.mapData(folder, tree);
    let file = null;
    try {
      file = await this.app.vault.create(path, JSON.stringify(data, null, '\t'));
    } catch (err) {
      console.error('Design Redux: could not make the collection map', err);
      new Notice('Could not make the map.');
      return null;
    }
    await this.saveEntry(path, { album: folder.path, via: this.property, leftOut: [] });
    this.tell(tree);
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf) await leaf.openFile(file);
    return file;
  }

  /** The map's cards and arrows, laid out as a tidy tree to begin with; the map engine takes it from there. */
  mapData(folder, tree) {
    let n = 0;
    const stamp = Date.now().toString(16);
    const newId = () => `${stamp}${(n++).toString(16).padStart(4, '0')}`.slice(-16);
    const rootNote = this.folderNoteOf(folder);
    const layout = BRANCH_LAYOUTS.some((b) => b[0] === this.settings.albumMapLayout) ? this.settings.albumMapLayout : 'right';
    const root = Object.assign(
      { id: newId(), x: 0, y: 0, [ALBUM_ROOT_KEY]: true, [MAP_LAYOUT_KEY]: layout },
      rootNote ? Object.assign({ type: 'file', file: rootNote.path }, MAP_NOTE_SIZE) : Object.assign({ type: 'text', text: `# ${folder.name}` }, MAP_ROOT_SIZE)
    );
    const rootPath = rootNote ? rootNote.path : '';
    const kids = new Map();
    tree.parent.forEach((up, child) => {
      const key = up || rootPath;
      if (!kids.has(key)) kids.set(key, []);
      kids.get(key).push(child);
    });
    const item = (path) => {
      const card = Object.assign({ type: 'file', file: path }, MAP_NOTE_SIZE);
      if (tree.outside.indexOf(path) !== -1) {
        const f = this.app.vault.getAbstractFileByPath(path);
        card[ALBUM_OUTSIDE_KEY] = f && f.parent ? f.parent.name || '/' : '';
      }
      return { card, children: (kids.get(path) || []).filter((c) => c !== path).map(item) };
    };
    const made = treeCards(root, (kids.get(rootPath) || []).map(item), 'right', newId);
    const nodes = [root].concat(made.nodes);
    const byPath = new Map(nodes.filter((x) => x.type === 'file').map((x) => [x.file, x]));
    tree.cross.forEach(([from, to]) => {
      const p = byPath.get(from);
      const q = byPath.get(to);
      if (!p || !q || p === q) return;
      const sides = nearestSides(boxEdges(p), boxEdges(q));
      made.edges.push({ id: newId(), fromNode: p.id, fromSide: sides.from, toNode: q.id, toSide: sides.to, [RELATED_KEY]: true });
    });
    return { nodes, edges: made.edges };
  }

  // Each open map: what it showed, so a card taken off is told from a note that's new.
  mount(view, state) {
    state.mapped = new Set(this.cardsOf(view).keys());
  }

  pass(view, state) {
    // Notes from outside the collection: dimmed, with their folder's name.
    if (!this.entryOf(view)) return;
    liveCards(view.canvas).forEach((card) => {
      const from = cardKept(card, ALBUM_OUTSIDE_KEY);
      const el = cardElement(card);
      if (!el || from === undefined) return;
      el.addClass('dr-album-outside');
      el.dataset.drFolder = from;
    });
  }

  cleanup(view, state) {
    if (state && state.timer) clearTimeout(state.timer);
    if (!view.contentEl) return;
    view.contentEl.querySelectorAll('.dr-album-outside').forEach((el) => el.removeClass('dr-album-outside'));
  }

  /** The notes on the map: path → card id, those from outside included; the root not. */
  cardsOf(view) {
    const out = new Map();
    liveCards(view.canvas).forEach((card) => {
      const data = cardData(card) || {};
      const file = data.type === 'file' ? data.file : null;
      if (!file || cardKept(card, ALBUM_ROOT_KEY) || tuckOf(card)) return;
      out.set(file, card.id);
    });
    return out;
  }

  rootCard(view) {
    return liveCards(view.canvas).find((card) => cardKept(card, ALBUM_ROOT_KEY)) || null;
  }

  later(view, state) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = 0;
      if (this.watched.get(view) === state) this.refresh(view);
    }, ALBUM_MAP_WAIT);
  }

  /** The map brought in step with its notes; true if anything changed. */
  async refresh(view, opts = {}) {
    const entry = this.entryOf(view);
    const folder = this.albumOf(view);
    const state = this.watched.get(view);
    if (!entry || !folder || !state) return false;
    // Closed, or gone with its collection: nothing to keep in step, nowhere to save.
    if (!view.contentEl || !view.contentEl.isConnected || !(this.app.vault.getAbstractFileByPath(view.file.path) instanceof TFile)) return false;
    const tree = this.treeOf(folder, entry.leftOut);
    const canvas = view.canvas;
    const cards = this.cardsOf(view);
    const root = this.rootCard(view);
    const model = canvasModel(canvas);
    const links = arrowLinks(model);
    const plan = albumMapChanges(tree, cards, (id) => links.parents.get(id) || [], state.mapped || new Set(), entry.leftOut, root ? root.id : null);
    let changed = false;
    if (plan.leaveOut.length) {
      entry.leftOut = Array.from(new Set((entry.leftOut || []).concat(plan.leaveOut)));
      await this.saveEntry(view.file.path, entry);
    }
    plan.remove.forEach((path) => {
      const card = liveCard(canvas, cards.get(path));
      if (card) {
        removeCard(canvas, card);
        changed = true;
      }
    });
    // New notes: a card beside its parent's, and an arrow to it; parents first, so a new parent's there for its child.
    const ids = new Map(cards);
    const placeOf = (id) => model.byId.get(id) || liveCard(canvas, id);
    const ordered = plan.add.slice().sort((a, b) => (tree.parent.get(b) === a ? -1 : tree.parent.get(a) === b ? 1 : 0));
    ordered.forEach((path) => {
      const up = tree.parent.get(path);
      const upId = up ? ids.get(up) : root ? root.id : null;
      const from = upId ? placeOf(upId) : null;
      const id = newCanvasId(canvas);
      const card = Object.assign({ id, type: 'file', file: path, x: from ? from.x + 360 : 0, y: from ? from.y : 0 }, MAP_NOTE_SIZE);
      if (tree.outside.indexOf(path) !== -1) {
        const f = this.app.vault.getAbstractFileByPath(path);
        card[ALBUM_OUTSIDE_KEY] = f && f.parent ? f.parent.name || '/' : '';
      }
      const edges = upId ? [{ id: newCanvasId(canvas), fromNode: upId, fromSide: 'right', toNode: id, toSide: 'left' }] : [];
      if (addToCanvas(canvas, { nodes: [card], edges })) {
        ids.set(path, id);
        changed = true;
      }
    });
    // A changed parent: its arrows from elsewhere off, one from the new parent on.
    plan.relink.forEach(({ path, parent }) => {
      const id = ids.get(path);
      const upId = parent ? ids.get(parent) : root ? root.id : null;
      if (!id || !upId) return;
      model.edges.forEach((e) => {
        if (e.to === id && !e.related && e.edge) removeArrow(canvas, e.edge);
      });
      addToCanvas(canvas, { nodes: [], edges: [{ id: newCanvasId(canvas), fromNode: upId, fromSide: 'right', toNode: id, toSide: 'left' }] });
      changed = true;
    });
    state.mapped = new Set(this.cardsOf(view).keys());
    if (changed) requestCanvasSave(canvas);
    if (opts.tell) {
      this.tell(tree);
      if (!changed) new Notice('The map is up to date with its notes.');
    }
    return changed;
  }

  leftOutFiles(view) {
    const e = this.entryOf(view);
    return ((e && e.leftOut) || []).map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f) => f instanceof TFile);
  }

  putBack(view) {
    new LeftOutPicker(this.app, this.leftOutFiles(view), async (file) => {
      const entry = this.entryOf(view);
      entry.leftOut = (entry.leftOut || []).filter((p) => p !== file.path);
      await this.saveEntry(view.file.path, entry);
      const state = this.watched.get(view);
      if (state && state.mapped) state.mapped.delete(file.path);
      this.refresh(view);
    }).open();
  }

  /** A card re-linked by hand on a collection's map: its note's parent set, as the setting says. */
  relinked(view, childId, parentId) {
    if (!this.entryOf(view)) return;
    const card = (id) => liveCard(view.canvas, id);
    const fileOf = (c) => {
      const data = c ? cardData(c) || {} : {};
      const path = data.type === 'file' ? data.file : null;
      const f = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return f instanceof TFile ? f : null;
    };
    const childCard = card(childId);
    const parentCard = card(parentId);
    const child = fileOf(childCard);
    if (!child || !parentCard) return;
    // Onto the root: no parent of its own; onto a note: that note.
    const parent = cardKept(parentCard, ALBUM_ROOT_KEY) ? null : fileOf(parentCard);
    if (!parent && !cardKept(parentCard, ALBUM_ROOT_KEY)) return;
    const mode = this.settings.albumMapWritesParent || 'ask';
    if (mode === 'never') return;
    if (mode === 'always') return this.writeParent(child, parent);
    new SetParentPrompt(this.app, child, parent, async (choice) => {
      if (choice === 'map') return;
      if (choice === 'always') {
        this.settings.albumMapWritesParent = 'always';
        await this.plugin.saveSettings();
      }
      await this.writeParent(child, parent);
    }).open();
  }

  /** The note's parent property set — or taken off — through the notes service, with Undo. */
  writeParent(file, parent) {
    const prop = this.property;
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
}

AlbumMap.settingKey = 'canvasVaultMap';
