/* ------------------------------------------------------------------ */
/* Mind map: query nodes                                               */
/*                                                                    */
/* A node can ask the vault a question — tag:#law folder:Law           */
/* status:Doing links:[[Home]], every clause met — and the notes that  */
/* answer it hang under it, kept current as notes change, drawn but    */
/* never written. Freeze writes them as nodes of its own. Read from    */
/* the library's index.                                                */
/* ------------------------------------------------------------------ */

import { getAllTags, Notice, TFile } from 'obsidian';
import { fmGet } from '../core/045-helpers-properties.js';
import { libraryIndex } from '../core/077-library-index.js';
import { NamePrompt } from '../ui/230-pickers.js';
import { newId, nodeById } from '../tree/400-tree-model.js';
import { applyPatch } from '../tree/404-tree-ops.js';

/* The most notes a query hangs under its node. */
export const QUERY_LIMIT = 200;

/**
 * A query's words as clauses: [{ kind: 'tag'|'folder'|'links'|'property', key, value }].
 * A word with no kind is a property test when it has a colon, else nothing.
 */
export function parseQuery(text) {
  const out = [];
  const words = String(text || '').match(/(?:[^\s"[]+|"[^"]*"|\[\[[^\]]*\]\])+/g) || [];
  words.forEach((w) => {
    const m = /^([^:=]+)[:=](.*)$/.exec(w);
    if (!m) return;
    const key = m[1].trim().toLowerCase();
    const value = m[2].replace(/^"|"$/g, '').trim();
    if (!value) return;
    if (key === 'tag') out.push({ kind: 'tag', value: value.replace(/^#/, '').toLowerCase() });
    else if (key === 'folder' || key === 'path') out.push({ kind: 'folder', value: value.replace(/^\/|\/$/g, '') });
    else if (key === 'links' || key === 'links-to' || key === 'linksto') out.push({ kind: 'links', value: value.replace(/^\[\[|\]\]$/g, '').split('|')[0] });
    else out.push({ kind: 'property', key: m[1].trim(), value: value.toLowerCase() });
  });
  return out;
}

/** Whether a property's value says what a clause asks: a list holding it, or the value itself, in any case. */
function valueSays(v, want) {
  if (v === null || v === undefined) return false;
  const list = Array.isArray(v) ? v : [v];
  return list.some((x) => String(x).replace(/^\[\[|\]\]$/g, '').split('|')[0].trim().toLowerCase() === want);
}

/** The notes meeting every clause, by name: from the index, a note's tags, properties and links read from Obsidian's cache. */
export function queryNotes(app, index, clauses) {
  if (!clauses.length) return [];
  const cache = app.metadataCache;
  const linkTargets = clauses
    .filter((c) => c.kind === 'links')
    .map((c) => (typeof cache.getFirstLinkpathDest === 'function' ? cache.getFirstLinkpathDest(c.value, '') : null));
  if (linkTargets.some((t) => !t)) return [];
  return index
    .notes()
    .filter((f) => {
      const fc = cache.getFileCache(f);
      let tags = null;
      for (const c of clauses) {
        if (c.kind === 'folder' && !(f.path.startsWith(c.value + '/') || (f.parent && f.parent.path === c.value))) return false;
        if (c.kind === 'tag') {
          tags = tags || (fc ? (getAllTags(fc) || []).map((t) => t.replace(/^#/, '').toLowerCase()) : []);
          if (!tags.some((t) => t === c.value || t.startsWith(c.value + '/'))) return false;
        }
        if (c.kind === 'property' && !valueSays(fmGet(fc && fc.frontmatter, c.key), c.value)) return false;
      }
      return linkTargets.every((t) => t.path in index.outgoing(f));
    })
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

/** A field on an object that its own keys don't list. */
function hidden(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: false });
}

export class MindMapQuery {
  /** The notes under each query node, worked out again when the map or the vault changed. */
  answerQueries() {
    if (!this.model || !this.app || !this.app.metadataCache) return;
    const on = !this.plugin || this.plugin.settings.mindmapQueries !== false;
    const epoch = this.queryEpoch || 0;
    const index = libraryIndex(this.plugin);
    const visit = (n) => {
      const q = on && n.attrs && typeof n.attrs.query === 'string' ? n.attrs.query : '';
      if (!q) {
        if (n.queryKids) delete n.queryKids;
      } else if (!n.queryKids || n.queryAsked !== `${epoch}|${q}`) {
        let files = [];
        try {
          files = queryNotes(this.app, index, parseQuery(q));
        } catch (err) {
          files = [];
        }
        const shown = new Set(n.children.map((c) => c.text));
        // Kept off the node's own fields, so nothing that writes or copies the map sees them.
        hidden(
          n,
          'queryKids',
          files
            .slice(0, QUERY_LIMIT)
            .map((f) => ({ id: `q:${n.id}:${f.path}`, text: this.queryLink(f), attrs: {}, children: [], parent: n, anchor: false, queried: f }))
            .filter((k) => !shown.has(k.text))
        );
        hidden(n, 'queryAsked', `${epoch}|${q}`);
      }
      n.children.forEach(visit);
    };
    if (this.model.root) visit(this.model.root);
    (this.model.free || []).forEach(visit);
  }

  queryLink(file) {
    const cache = this.app.metadataCache;
    return `[[${cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(file, this.file ? this.file.path : '', true) : file.basename}]]`;
  }

  /** The vault changed: queries asked again, a moment later, once. */
  queriesLater() {
    this.queryEpoch = (this.queryEpoch || 0) + 1;
    if (this.queryTimer || !this.model || !this.hasQueries()) return;
    this.queryTimer = window.setTimeout(() => {
      this.queryTimer = null;
      if (!this.model || this.editing) return;
      this.relayout(false);
      this.draw();
    }, 100);
  }

  hasQueries() {
    let any = false;
    const go = (n) => {
      if (any) return;
      if (n.attrs && n.attrs.query) any = true;
      else n.children.forEach(go);
    };
    if (this.model && this.model.root) go(this.model.root);
    return any;
  }

  watchQueries() {
    const cache = this.app && this.app.metadataCache;
    const vault = this.app && this.app.vault;
    if (this.watchingQueries || !cache || typeof cache.on !== 'function') return;
    this.watchingQueries = true;
    this.registerEvent(cache.on('changed', (file) => this.file !== file && this.queriesLater()));
    if (vault && typeof vault.on === 'function') ['create', 'delete', 'rename'].forEach((type) => this.registerEvent(vault.on(type, () => this.queriesLater())));
    this.register(() => window.clearTimeout(this.queryTimer));
  }

  /** A query asked for a node, or changed; nothing takes it off. */
  chooseQuery(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    new NamePrompt(
      this.app,
      'The notes under this node',
      'tag:#law folder:Law status:Doing links:[[Home]]',
      (text) => {
        const q = text.trim();
        if (q && !parseQuery(q).length) {
          new Notice('Write the query as tag:, folder:, links: or a property, like status:Doing.');
          return;
        }
        const ops = [{ type: 'attr', id, key: 'query', value: q || undefined }];
        if (q && !n.text.trim()) ops.unshift({ type: 'text', id, text: q });
        this.apply(applyPatch(this.model, ops, [id]));
      },
      { value: n.attrs.query || '', button: 'Ask', allowEmpty: true }
    ).open();
  }

  /** A query's notes written as nodes of its own, the query taken off: one step of Undo. */
  freezeQuery(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n || !n.attrs.query) return;
    const kids = n.queryKids || [];
    const ops = kids.map((k, i) => ({ type: 'insert', parentId: id, index: n.children.length + i, node: { id: newId(), text: k.text, attrs: {}, anchor: false, children: [] } }));
    ops.push({ type: 'attr', id, key: 'query', value: undefined });
    this.apply(applyPatch(this.model, ops, [id]));
    new Notice(`${kids.length} ${kids.length === 1 ? 'note' : 'notes'} written under the node.`);
  }

  /** A query's note picked on the map: opened. */
  openQueried(id) {
    const m = /^q:([^:]+):(.*)$/.exec(String(id));
    const file = m && this.app.vault.getAbstractFileByPath(m[2]);
    if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
  }
}
