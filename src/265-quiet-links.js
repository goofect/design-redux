/* ------------------------------------------------------------------ */
/* Quiet links                                                         */
/*                                                                     */
/* A link that goes somewhere without saying the two notes belong      */
/* together: [[[Note]]], with [[[Note|some words]]] and [[[Note#A      */
/* heading]]] as for any link. It opens the note — making it if it's   */
/* missing — and previews on hover, but it's kept off the graph and    */
/* out of backlinks, so they keep to the connections that mean         */
/* something.                                                          */
/*                                                                     */
/* Obsidian has no such link. It reads [[[Anarchy]]] as a link to a    */
/* note called "[Anarchy" that doesn't exist — which is why it's not a */
/* backlink of Anarchy — so everything that shows that stand-in is put */
/* right here: reading view and Live Preview draw the real note with a */
/* dotted underline; the graph and the Outgoing links pane leave the   */
/* stand-in out; properties show it as the note it names. Renames are  */
/* followed here too, since Obsidian doesn't know to.                  */
/* ------------------------------------------------------------------ */

/* [[[target]]], [[[target|words]]], [[[target#heading]]] — the character before is captured, not looked behind at. */
const QUIET_TRIPLE = /(^|[^[])\[\[\[([^[\]\n]+?)\]\]\](?!\])/g;

/**
 * Every quiet link in some text: { from, to, inner }. Two written back to
 * back are both found — a link's last bracket can be the next one's lead.
 */
function quietMatches(text) {
  const out = [];
  const re = new RegExp(QUIET_TRIPLE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    const from = m.index + m[1].length;
    const to = from + m[2].length + 6;
    out.push({ from, to, inner: m[2] });
    re.lastIndex = to - 1;
  }
  return out;
}

/** A stand-in's name: one opening bracket, as a quiet link leaves in Obsidian's lists. */
function isStandIn(name) {
  const text = String(name || '');
  return text.startsWith('[') && !text.startsWith('[[');
}

/** Whether an entry of Obsidian's [[ list or Quick switcher is a stand-in it offers to make. */
function offersStandIn(item) {
  if (!item) return false;
  if (item.type === 'linktext') return isStandIn(item.path);
  if (item.type === 'unresolved') return isStandIn(item.linktext);
  return false;
}

/** "Note|words" or "Note#Heading" → { target, path, subpath, words }. */
function splitQuiet(inner) {
  const bar = inner.indexOf('|');
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const words = bar === -1 ? '' : inner.slice(bar + 1).trim();
  const hash = target.indexOf('#');
  return {
    target,
    path: hash === -1 ? target : target.slice(0, hash),
    subpath: hash === -1 ? '' : target.slice(hash),
    words,
  };
}

/**
 * What a quiet link shows: its own words, or its target as it's written —
 * a heading after " > " — as Obsidian shows any link.
 */
function quietLabel(target, words) {
  const own = String(words || '').trim();
  if (own) return own;
  const [path, ...rest] = String(target || '').split('#');
  const sub = rest.filter(Boolean).join(' > ').replace(/^\^/, '');
  if (!path) return sub || String(target || '');
  return sub ? `${path} > ${sub}` : path;
}

/**
 * The quiet links a note makes, from what Obsidian made of them: the
 * stand-in it links instead ("[Anarchy", or "[Realism]" in a property),
 * and the note meant.
 */
function quietRefs(cache) {
  if (!cache) return [];
  const out = [];
  const add = (ref, fromProperty) => {
    if (!ref || typeof ref.original !== 'string' || typeof ref.link !== 'string') return;
    if (!ref.original.startsWith('[[[') || ref.original.startsWith('[[[[')) return;
    const standIn = ref.link.split('#')[0].split('|')[0];
    if (!standIn.startsWith('[')) return;
    let path = standIn.slice(1);
    // In a property the closing bracket stays on the stand-in.
    if (fromProperty && path.endsWith(']') && ref.original.endsWith(']]]')) path = path.slice(0, -1);
    out.push({ standIn, path, key: ref.key || null });
  };
  (cache.links || []).forEach((ref) => add(ref, false));
  (cache.frontmatterLinks || []).forEach((ref) => add(ref, true));
  return out;
}

/**
 * The graph's data without quiet links: the lines to the stand-ins, and
 * the stand-ins themselves where nothing else links to them. A note left
 * with no line to anything goes too, where the graph wouldn't show it on
 * its own — in a local graph, or with orphans off.
 */
function withoutQuietLinks(app, data, opts = {}) {
  if (!data || !data.nodes) return data;
  const nodes = Object.assign({}, data.nodes);
  const standIns = new Set();
  const touched = new Set();
  let removed = 0;
  Object.keys(nodes).forEach((id) => {
    const node = nodes[id];
    if (!node || !node.links) return;
    const file = app.vault.getFileByPath(id);
    if (!file || file.extension !== 'md') return;
    const refs = quietRefs(app.metadataCache.getFileCache(file));
    if (!refs.length) return;
    let links = null;
    refs.forEach((ref) => {
      standIns.add(ref.standIn);
      if (!node.links[ref.standIn] || (links && !links[ref.standIn])) return;
      if (!links) links = Object.assign({}, node.links);
      delete links[ref.standIn];
      touched.add(id);
      removed++;
    });
    if (links) nodes[id] = Object.assign({}, node, { links });
  });
  if (!standIns.size) return data;

  const linkedTo = new Set();
  Object.keys(nodes).forEach((id) => Object.keys((nodes[id] && nodes[id].links) || {}).forEach((t) => linkedTo.add(t)));
  standIns.forEach((id) => {
    if (nodes[id] && nodes[id].type === 'unresolved' && !linkedTo.has(id)) delete nodes[id];
  });

  if (opts.dropLoners) {
    touched.forEach((id) => {
      const own = nodes[id] && Object.keys(nodes[id].links || {}).length;
      if (!own && !linkedTo.has(id) && id !== opts.keep) delete nodes[id];
    });
  }
  const out = Object.assign({}, data, { nodes });
  if (typeof data.numLinks === 'number') out.numLinks = Math.max(0, data.numLinks - removed);
  return out;
}

/**
 * The link around the cursor on its line — a quiet one first, then a
 * plain one: { line, from, to, inner, quiet }, or null.
 */
function linkAtCursor(editor) {
  if (!editor || typeof editor.getCursor !== 'function') return null;
  const cursor = editor.getCursor();
  const text = editor.getLine(cursor.line);
  const within = (from, to) => cursor.ch >= from && cursor.ch <= to;
  const quiet = quietMatches(text).find((q) => within(q.from, q.to));
  if (quiet) return { line: cursor.line, from: quiet.from, to: quiet.to, inner: quiet.inner, quiet: true };
  const plain = /\[\[([^[\]\n]+?)\]\]/g;
  let m;
  while ((m = plain.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    const tripled = text[from - 1] === '[' && text[to] === ']';
    if (!tripled && within(from, to)) return { line: cursor.line, from, to, inner: m[1], quiet: false };
  }
  return null;
}

/** The same link the other way: quiet if it was plain, plain if it was quiet. */
function toggledLink(hit) {
  return hit.quiet ? `[[${hit.inner}]]` : `[[[${hit.inner}]]]`;
}

/**
 * Whether a quiet link's target is the file that was at `oldPath` —
 * written as its name, its path, or the end of its path, with or
 * without ".md", as Obsidian resolves a link.
 */
function quietPointsAt(path, oldPath) {
  const want = String(path || '').trim().toLowerCase();
  if (!want) return false;
  const old = String(oldPath).toLowerCase();
  const bare = old.replace(/\.md$/, '');
  if (want === old || want === bare) return true;
  return bare.endsWith('/' + want) || old.endsWith('/' + want);
}

/**
 * Text with every quiet link to the file once at `oldPath` pointing at
 * `linktext` instead — its heading and words kept. The count of links
 * changed comes back with it.
 */
function renameQuietLinks(text, oldPath, linktext, stillResolves) {
  let count = 0;
  let out = '';
  let at = 0;
  quietMatches(text).forEach((q) => {
    const parts = splitQuiet(q.inner);
    if (!quietPointsAt(parts.path, oldPath)) return;
    if (stillResolves && stillResolves(parts.path)) return;
    count++;
    const words = parts.words ? `|${parts.words}` : '';
    out += text.slice(at, q.from) + `[[[${linktext}${parts.subpath}${words}]]]`;
    at = q.to;
  });
  return { text: out + text.slice(at), count };
}

/** A quiet link in Live Preview: its name, dotted, opening where it points. */
class QuietLinkWidget extends WidgetType {
  constructor(feature, label, target, sourcePath, missing) {
    super();
    this.feature = feature;
    this.label = label;
    this.target = target;
    this.sourcePath = sourcePath;
    this.missing = missing;
  }

  eq(other) {
    return (
      other.label === this.label &&
      other.target === this.target &&
      other.sourcePath === this.sourcePath &&
      other.missing === this.missing
    );
  }

  toDOM(view) {
    const el = view.dom.ownerDocument.createElement('span');
    el.className = 'cm-hmd-internal-link dr-quiet-link';
    if (this.missing) el.classList.add('is-unresolved');
    el.textContent = this.label;
    el.setAttribute('data-href', this.target);
    el.addEventListener('mousedown', (evt) => {
      if (evt.button !== 0 && evt.button !== 1) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.feature.open(this.target, this.sourcePath, evt.button === 1 || evt.ctrlKey || evt.metaKey);
    });
    el.addEventListener('mouseover', (evt) => this.feature.preview(evt, el, this.target, this.sourcePath));
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

/** Code, maths and comments keep their brackets as written. */
function quietIgnored(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/code|math|comment|frontmatter/i.test(node.name)) return true;
  }
  return false;
}

function quietSourcePath(feature, state) {
  try {
    const info = editorInfoField ? state.field(editorInfoField, false) : null;
    if (info && info.file && info.file.path) return info.file.path;
  } catch (err) {
    /* none to hand */
  }
  const active = feature.app.workspace.getActiveFile();
  return active ? active.path : '';
}

/**
 * In Live Preview, each quiet link is drawn as the note it names, dotted,
 * until the cursor reaches it and its source shows, as any link's does.
 */
function quietDecorations(feature, view) {
  const builder = new RangeSetBuilder();
  const state = view.state;
  if (!feature.enabled || !scriptLivePreview(state)) return builder.finish();
  const sourcePath = quietSourcePath(feature, state);
  const ranges = state.selection.ranges;
  const touched = (from, to) => ranges.some((r) => r.from <= to && r.to >= from);
  let lastLine = 0;
  for (const visible of view.visibleRanges) {
    let pos = visible.from;
    while (pos <= visible.to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine || line.text.indexOf('[[[') === -1) continue;
      lastLine = line.number;
      for (const q of quietMatches(line.text)) {
        const from = line.from + q.from;
        const to = line.from + q.to;
        if (touched(from, to) || quietIgnored(state, from)) continue;
        const parts = splitQuiet(q.inner);
        const missing = !feature.resolve(parts.path, sourcePath);
        builder.add(
          from,
          to,
          Decoration.replace({
            widget: new QuietLinkWidget(feature, quietLabel(parts.target, parts.words), parts.target, sourcePath, missing),
          })
        );
      }
    }
  }
  return builder.finish();
}

function quietEditorExtension(feature) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = quietDecorations(feature, view);
      }

      update(u) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          scriptLivePreview(u.startState) !== scriptLivePreview(u.state) ||
          feature.changed
        ) {
          this.decorations = quietDecorations(feature, u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/**
 * After [[[: notes, their aliases, and — after a # — a note's headings,
 * written as a quiet link. The plugin's own list, since Obsidian's would
 * also offer to make a note called "[Name".
 */
class QuietLinkSuggest extends (EditorSuggest || class {}) {
  constructor(feature) {
    super(feature.app);
    this.app = feature.app;
    this.feature = feature;
    this.limit = 50;
  }

  onTrigger(cursor, editor) {
    if (!this.feature.enabled) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = /(^|[^[])\[\[\[([^[\]|\n]*)$/.exec(before);
    if (!m) return null;
    const ch = m.index + m[1].length + 3;
    return { start: { line: cursor.line, ch }, end: cursor, query: m[2] };
  }

  getSuggestions(context) {
    const query = context.query || '';
    const app = this.app;
    const source = context.file ? context.file.path : '';
    const hash = query.indexOf('#');
    if (hash !== -1) {
      const file = app.metadataCache.getFirstLinkpathDest(query.slice(0, hash), source);
      const cache = file && app.metadataCache.getFileCache(file);
      const want = query.slice(hash + 1).toLowerCase();
      return ((cache && cache.headings) || [])
        .filter((h) => h.heading.toLowerCase().includes(want))
        .slice(0, this.limit)
        .map((h) => ({ kind: 'heading', file, heading: h.heading }));
    }
    const want = query.toLowerCase();
    const found = [];
    app.vault.getMarkdownFiles().forEach((file) => {
      const name = file.basename.toLowerCase();
      const at = name.indexOf(want);
      if (at !== -1) found.push({ kind: 'file', file, rank: at === 0 ? 0 : 1, len: name.length });
      const cache = app.metadataCache.getFileCache(file);
      const raw = cache && cache.frontmatter ? cache.frontmatter.aliases || cache.frontmatter.alias : null;
      (Array.isArray(raw) ? raw : raw ? [raw] : []).forEach((alias) => {
        const text = String(alias);
        const where = text.toLowerCase().indexOf(want);
        if (want && where !== -1) found.push({ kind: 'alias', file, alias: text, rank: where === 0 ? 0 : 1, len: text.length });
      });
    });
    return found
      .sort((a, b) => a.rank - b.rank || a.len - b.len || byName(a.file.basename, b.file.basename))
      .slice(0, this.limit);
  }

  renderSuggestion(item, el) {
    el.addClass('dr-quiet-suggest');
    const content = el.createDiv({ cls: 'suggestion-content' });
    const title = item.kind === 'heading' ? item.heading : item.kind === 'alias' ? item.alias : item.file.basename;
    content.createDiv({ cls: 'suggestion-title', text: title });
    const where = item.kind === 'file'
      ? (item.file.parent && item.file.parent.path !== '/' ? item.file.parent.path : '')
      : item.file.basename;
    if (where) content.createDiv({ cls: 'suggestion-note', text: where });
  }

  selectSuggestion(item) {
    const context = this.context;
    if (!context) return;
    const editor = context.editor;
    const source = context.file ? context.file.path : '';
    const linktext = this.app.metadataCache.fileToLinktext(item.file, source, true);
    const text =
      item.kind === 'heading' ? `${linktext}#${item.heading}` : item.kind === 'alias' ? `${linktext}|${item.alias}` : linktext;
    // Closing brackets Obsidian may already have paired: kept, not doubled.
    const after = editor.getLine(context.end.line).slice(context.end.ch);
    const closing = (/^\]{0,3}/.exec(after) || [''])[0].length;
    editor.replaceRange(`${text}]]]`, context.start, { line: context.end.line, ch: context.end.ch + closing });
    editor.setCursor({ line: context.start.line, ch: context.start.ch + text.length + 3 });
    this.close();
  }
}

class QuietLinks extends Feature {
  constructor(plugin) {
    super(plugin);
    this.watched = new Map();
    this.pendingRenames = [];
  }

  settingsSchema() {
    return [
      {
        key: 'quietLinks',
        name: 'Quiet links',
        desc: 'Write a link as [[[Note]]] to keep it off the graph and out of backlinks. It still opens the note — making it if it’s missing — previews on hover and follows renames, and shows with a dotted underline. Type [[[ for a list of notes; right-click a link, or use the command, to switch it between quiet and normal.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'toggle-quiet-link',
        name: 'Make the link at the cursor quiet or normal',
        icon: 'link-2-off',
        check: () => this.enabled && !!linkAtCursor(this.editor()),
        run: () => this.toggle(this.editor()),
      },
    ];
  }

  editor() {
    const ws = this.app.workspace;
    const active = ws.activeEditor;
    if (active && active.editor) return active.editor;
    const view = typeof ws.getActiveViewOfType === 'function' ? ws.getActiveViewOfType(MarkdownView) : null;
    return view ? view.editor : null;
  }

  toggle(editor) {
    const hit = linkAtCursor(editor);
    if (!hit) return false;
    editor.replaceRange(toggledLink(hit), { line: hit.line, ch: hit.from }, { line: hit.line, ch: hit.to });
    return true;
  }

  /** The note a quiet link names, if it exists. */
  resolve(path, sourcePath) {
    return path ? this.app.metadataCache.getFirstLinkpathDest(path, sourcePath || '') : null;
  }

  /** Open a quiet link's note — made first if it's missing, as any link's is. */
  open(target, sourcePath, newLeaf) {
    this.app.workspace.openLinkText(target, sourcePath || '', !!newLeaf);
  }

  /** The page preview a link gets, with Ctrl or Cmd held. */
  preview(evt, el, target, sourcePath) {
    this.app.workspace.trigger('hover-link', {
      event: evt,
      source: 'preview',
      hoverParent: el,
      targetEl: el,
      linktext: target,
      sourcePath: sourcePath || '',
    });
  }

  register() {
    this.plugin.registerEditorExtension([quietEditorExtension(this)]);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (this.enabled) this.quietenReading(el, ctx && ctx.sourcePath);
    });

    if (typeof EditorSuggest === 'function' && typeof this.plugin.registerEditorSuggest === 'function') {
      this.suggest = new QuietLinkSuggest(this);
      this.plugin.registerEditorSuggest(this.suggest);
      this.suggestFirst();
    }

    this.plugin.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        if (!this.enabled) return;
        const hit = linkAtCursor(editor);
        if (!hit) return;
        menu.addItem((item) => {
          if (typeof item.setSection === 'function') item.setSection('action');
          item
            .setTitle(hit.quiet ? 'Make link normal' : 'Make link quiet')
            .setIcon(hit.quiet ? 'link' : 'link-2-off')
            .onClick(() => this.toggle(editor));
        });
      })
    );

    const follow = () => {
      this.wrapGraphs();
      this.watchPanes();
    };
    this.plugin.registerEvent(this.app.workspace.on('layout-change', follow));
    this.plugin.registerEvent(this.app.workspace.on('active-leaf-change', follow));
    this.plugin.registerEvent(this.app.workspace.on('file-open', follow));
    this.plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.enabled) this.noteRename(file, oldPath);
      })
    );
    this.plugin.register(() => {
      this.unwrapGraphs();
      this.unwatchPanes();
      this.unfilterLists();
    });
  }

  /**
   * Obsidian asks each list of suggestions in turn and shows the first
   * that answers, so this one goes first, or its own [[ list would
   * answer [[[ too. Not public API: where the list isn't there to
   * reorder, Obsidian's list shows instead.
   */
  suggestFirst() {
    try {
      const list = this.app.workspace.editorSuggest && this.app.workspace.editorSuggest.suggests;
      if (!Array.isArray(list)) return;
      const at = list.indexOf(this.suggest);
      if (at > 0) {
        list.splice(at, 1);
        list.unshift(this.suggest);
      }
    } catch (err) {
      /* Obsidian's list, then */
    }
  }

  /** Runs on every settings save, so editors and graphs are only redrawn when it's switched. */
  enable() {
    const switched = this.on !== true;
    this.on = true;
    if (switched) this.refreshEditors();
    this.wrapGraphs(switched);
    this.watchPanes();
    this.filterLists();
    if (switched) this.rerenderReading();
  }

  disable() {
    const switched = this.on === true;
    this.on = false;
    if (switched) this.refreshEditors();
    this.unwrapGraphs();
    this.unwatchPanes();
    this.unfilterLists();
    if (switched && !this.plugin.unloading) this.rerenderReading();
  }

  /**
   * Obsidian's own [[ list and its Quick switcher offer each stand-in —
   * "[Anarchy" — as a note to make; with quiet links on, those entries
   * are left out of what the lists are given, so they can't be chosen,
   * not just hidden. Not public API: each list is filtered only where
   * it's found, and put back as it was when quiet links are switched off.
   */
  filterLists() {
    if (!this.enabled || this.listUndo) return;
    this.listUndo = [];
    const wrap = (owner, name) => {
      const original = owner && owner[name];
      if (typeof original !== 'function') return;
      const own = Object.prototype.hasOwnProperty.call(owner, name);
      owner[name] = function (...args) {
        const found = original.apply(this, args);
        const keep = (list) => (Array.isArray(list) ? list.filter((item) => !offersStandIn(item)) : list);
        return found && typeof found.then === 'function' ? found.then(keep) : keep(found);
      };
      this.listUndo.push(() => {
        if (own) owner[name] = original;
        else delete owner[name];
      });
    };
    try {
      const lists = this.app.workspace.editorSuggest && this.app.workspace.editorSuggest.suggests;
      (Array.isArray(lists) ? lists : []).forEach((list) => {
        if (list !== this.suggest) wrap(list, 'getSuggestions');
      });
    } catch (err) {
      /* Obsidian's [[ list as it is, then */
    }
    try {
      const switcher = this.app.internalPlugins.getPluginById('switcher');
      const Modal = switcher && switcher.instance && switcher.instance.QuickSwitcherModal;
      if (Modal && Modal.prototype) wrap(Modal.prototype, 'getSuggestions');
    } catch (err) {
      /* the Quick switcher as it is, then */
    }
  }

  unfilterLists() {
    (this.listUndo || []).forEach((undo) => undo());
    this.listUndo = null;
  }

  refreshEditors() {
    this.changed = true;
    try {
      this.app.workspace.updateOptions();
    } catch (err) {
      /* nothing open to redraw */
    }
    this.changed = false;
  }

  /** Reading views drawn before the switch are drawn again, so the change shows. */
  rerenderReading() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.previewMode) return;
      try {
        view.previewMode.rerender(true);
      } catch (err) {
        /* it redraws on its next change */
      }
    });
  }

  /* -- reading view and properties ------------------------------------ */

  /**
   * Obsidian draws [[[Anarchy]]] as a link to a missing "[Anarchy" with a
   * stray bracket after it; drawn instead as the note it names.
   */
  quietenReading(el, sourcePath) {
    el.querySelectorAll('a.internal-link').forEach((a) => {
      const href = a.getAttribute('data-href') || '';
      if (!href.startsWith('[') || href.startsWith('[[')) return;
      const next = a.nextSibling;
      if (!next || next.nodeType !== 3 || !next.textContent.startsWith(']')) return;
      next.textContent = next.textContent.slice(1);
      this.quietenElement(a, href, href.slice(1), sourcePath);
    });
  }

  /**
   * A property's links, read from its value rather than from what's
   * drawn — which differs between versions of Obsidian: a value, or an
   * item of a list, written [[[Note]]] is drawn as the note it names.
   */
  quietenProperties(el, sourcePath) {
    const file = sourcePath ? this.app.vault.getFileByPath(sourcePath) : null;
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    const fm = (cache && cache.frontmatter) || {};
    el.querySelectorAll('.internal-link').forEach((link) => {
      if (link.classList.contains('dr-quiet-link')) return;
      const row = link.closest('[data-property-key], .dr-row[data-key]');
      const key = row ? row.getAttribute('data-property-key') || row.getAttribute('data-key') : null;
      if (!key) return;
      const raw = fmGet(fm, key);
      let value = Array.isArray(raw) ? null : raw;
      const pill = link.closest('.multi-select-pill');
      if (Array.isArray(raw) && pill && pill.parentElement) {
        value = raw[Array.from(pill.parentElement.querySelectorAll('.multi-select-pill')).indexOf(pill)];
      }
      const m = /^\[\[\[([^[\]\n]+?)\]\]\]$/.exec(String(value == null ? '' : value).trim());
      if (!m) return;
      const parts = splitQuiet(m[1]);
      this.quietenElement(link, link.getAttribute('data-href') || '', parts.target, sourcePath, true, parts.words);
    });
  }

  quietenElement(el, href, target, sourcePath, ownClicks, ownWords) {
    const shown = el.textContent || '';
    const words = ownWords !== undefined ? ownWords : shown.startsWith('[') ? '' : shown.replace(/\]$/, '');
    el.textContent = quietLabel(target, words);
    el.setAttribute('data-href', target);
    if (el.hasAttribute('href')) el.setAttribute('href', target);
    if (href && el.getAttribute('aria-label') === href) el.setAttribute('aria-label', target);
    el.classList.toggle('is-unresolved', !this.resolve(splitQuiet(target).path, sourcePath));
    el.classList.add('dr-quiet-link');
    if (!ownClicks) return;
    // A property's link opens from its value, not from what it shows —
    // which would be the stand-in — so its click and preview are taken.
    el.addEventListener(
      'click',
      (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.open(target, sourcePath, evt.ctrlKey || evt.metaKey);
      },
      true
    );
    el.addEventListener(
      'mouseover',
      (evt) => {
        evt.stopPropagation();
        this.preview(evt, el, target, sourcePath);
      },
      true
    );
  }

  /* -- panes that would show the stand-in ------------------------------ */

  /**
   * Obsidian's own properties block and its Outgoing links pane are
   * watched while quiet links are on, and put right whenever they're
   * drawn. Neither is public API, so each is looked for, and left as it
   * is where it isn't found.
   */
  watchPanes() {
    if (!this.enabled || typeof MutationObserver !== 'function') return;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (!view || !view.containerEl) return;
      if (view instanceof MarkdownView) {
        const box = view.containerEl.querySelector('.metadata-container');
        if (box) this.watch(box, () => this.quietenProperties(box, view.file ? view.file.path : ''));
      } else if (typeof view.getViewType === 'function' && view.getViewType() === 'outgoing-link') {
        this.watch(view.containerEl, () => this.hideOutgoing(view));
      }
    });
  }

  watch(el, fix) {
    if (this.watched.has(el)) {
      fix();
      return;
    }
    const observer = new MutationObserver(() => {
      observer.disconnect();
      fix();
      if (this.watched.get(el) === observer) observer.observe(el, { childList: true, subtree: true });
    });
    this.watched.set(el, observer);
    fix();
    observer.observe(el, { childList: true, subtree: true });
  }

  unwatchPanes() {
    this.watched.forEach((observer) => observer.disconnect());
    this.watched.clear();
  }

  /** The stand-ins a note's Outgoing links pane lists as notes to create, taken out. */
  hideOutgoing(view) {
    const file = view.file || this.app.workspace.getActiveFile();
    if (!file) return;
    const standIns = new Set(quietRefs(this.app.metadataCache.getFileCache(file)).map((r) => r.standIn));
    if (!standIns.size) return;
    view.containerEl.querySelectorAll('.outgoing-link-item').forEach((item) => {
      const text = item.querySelector('.tree-item-inner-text, .tree-item-inner');
      const name = text ? text.textContent.trim() : '';
      if (standIns.has(name)) item.addClass('dr-quiet-hidden');
    });
  }

  /* -- renames ----------------------------------------------------------- */

  /**
   * Obsidian doesn't know a quiet link names a note, so it can't update
   * one; this does, as Obsidian's own setting says: at once where it
   * updates links itself, and otherwise when asked, from a notice.
   * Renames arriving together — a folder's contents — are taken as one.
   */
  noteRename(file, oldPath) {
    if (file instanceof TFolder) return;
    this.pendingRenames.push({ file, oldPath });
    window.clearTimeout(this.renameTimer);
    this.renameTimer = window.setTimeout(() => this.settleRenames(), 300);
  }

  async settleRenames() {
    const renames = this.pendingRenames.splice(0);
    const changes = this.quietChanges(renames);
    const count = changes.reduce((n, c) => n + c.count, 0);
    if (!count) return;
    if (this.autoUpdate()) {
      await this.applyChanges(changes);
      return;
    }
    const fragment = document.createDocumentFragment();
    const text = document.createElement('span');
    text.textContent = count === 1 ? '1 quiet link still points to the old name. ' : `${count} quiet links still point to the old name. `;
    const link = document.createElement('a');
    link.className = 'dr-undo';
    link.setAttribute('href', '#');
    link.textContent = 'Update them';
    fragment.append(text, link);
    const notice = new Notice(fragment, 12000);
    link.addEventListener('click', async (evt) => {
      evt.preventDefault();
      if (notice && typeof notice.hide === 'function') notice.hide();
      await this.applyChanges(this.quietChanges(renames));
    });
  }

  /** Obsidian's "Automatically update internal links". Not public API: off where it can't be read. */
  autoUpdate() {
    try {
      return typeof this.app.vault.getConfig === 'function' && !!this.app.vault.getConfig('alwaysUpdateLinks');
    } catch (err) {
      return false;
    }
  }

  /** Which notes have quiet links to the renamed files, and how many. */
  quietChanges(renames) {
    const out = [];
    this.app.vault.getMarkdownFiles().forEach((source) => {
      const refs = quietRefs(this.app.metadataCache.getFileCache(source));
      if (!refs.length) return;
      const hits = renames.filter((r) =>
        refs.some((ref) => quietPointsAt(ref.path, r.oldPath) && !this.resolve(ref.path, source.path))
      );
      if (!hits.length) return;
      const count = refs.filter((ref) => hits.some((r) => quietPointsAt(ref.path, r.oldPath))).length;
      out.push({ source, renames: hits, count });
    });
    return out;
  }

  async applyChanges(changes) {
    for (const change of changes) {
      try {
        await this.app.vault.process(change.source, (text) =>
          change.renames.reduce((current, r) => {
            const linktext = this.app.metadataCache.fileToLinktext(r.file, change.source.path, true);
            return renameQuietLinks(current, r.oldPath, linktext, (path) => !!this.resolve(path, change.source.path)).text;
          }, text)
        );
      } catch (err) {
        console.error('Design Redux: could not update quiet links', err);
        new Notice(`Could not update the quiet links in “${change.source.basename}”.`);
      }
    }
  }

  /* -- the graph ---------------------------------------------------------- */

  graphViews() {
    const ws = this.app.workspace;
    if (typeof ws.getLeavesOfType !== 'function') return [];
    return GRAPH_TYPES.reduce(
      (all, type) => all.concat(ws.getLeavesOfType(type).filter((l) => !l.isDeferred).map((l) => l.view)),
      []
    ).filter(Boolean);
  }

  /**
   * Each graph's drawing is handed its data through setData; that's
   * where quiet links are taken out, on the way in. Not public API, so
   * it's only done where setData is there to wrap; a graph without it
   * shows the stand-ins, as it would without the plugin.
   */
  wrapGraphs(redraw) {
    if (!this.enabled) return;
    this.graphViews().forEach((view) => {
      const drawing = view.renderer;
      if (!drawing || typeof drawing.setData !== 'function') return;
      if (drawing.drQuietSetData) {
        if (redraw) this.redraw(view);
        return;
      }
      const original = drawing.setData;
      const feature = this;
      drawing.drQuietSetData = original;
      drawing.setData = function (data) {
        return original.call(this, feature.enabled ? feature.strip(view, data) : data);
      };
      this.redraw(view);
    });
  }

  unwrapGraphs() {
    this.graphViews().forEach((view) => {
      const drawing = view.renderer;
      if (!drawing || !drawing.drQuietSetData) return;
      drawing.setData = drawing.drQuietSetData;
      delete drawing.drQuietSetData;
      if (!this.plugin.unloading) this.redraw(view);
    });
  }

  strip(view, data) {
    try {
      const local = typeof view.getViewType === 'function' && view.getViewType() === 'localgraph';
      const engine = view.dataEngine || view.engine;
      const options = engine && typeof engine.getOptions === 'function' ? engine.getOptions() : null;
      return withoutQuietLinks(this.app, data, {
        dropLoners: local || !!(options && options.showOrphans === false),
        keep: local && view.file ? view.file.path : null,
      });
    } catch (err) {
      console.error('Design Redux: could not leave quiet links out of the graph', err);
      return data;
    }
  }

  redraw(view) {
    const engine = view.dataEngine || view.engine;
    try {
      if (engine && typeof engine.render === 'function') engine.render();
    } catch (err) {
      /* it redraws itself on the next change */
    }
  }
}

QuietLinks.settingKey = 'quietLinks';
