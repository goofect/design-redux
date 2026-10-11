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
/* note called "[Anarchy" that doesn't exist. So as each note is read, */
/* its quiet links are taken out of the links Obsidian counts — before */
/* it counts them — and kept beside them for this plugin: the graph,   */
/* backlinks, Outgoing links, the [[ list and the Quick switcher never */
/* hear of the stand-in, with nothing patched in any of them. What's   */
/* left is drawing: reading view, Live Preview and properties show the */
/* note it names, dotted; and renames, which Obsidian can't follow.    */
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
  (cache.drQuietLinks || []).forEach((ref) => add(ref, !!ref.fromProperty));
  return out;
}

/** Whether a link Obsidian recorded is a quiet link's stand-in. */
function isQuietRef(ref) {
  return (
    !!ref &&
    typeof ref.original === 'string' &&
    typeof ref.link === 'string' &&
    ref.original.startsWith('[[[') &&
    !ref.original.startsWith('[[[[') &&
    ref.link.startsWith('[')
  );
}

/** The name Obsidian counts a link under: its target, without a heading. */
function linkCountKey(ref) {
  return ref.link.split('#')[0].split('|')[0];
}

/**
 * A note's quiet links, taken out of the links Obsidian counts and kept
 * beside them as drQuietLinks. Run as the note is read, before Obsidian
 * counts its links, it never counts the stand-ins at all. Returns what
 * moved.
 */
function settleQuietLinks(cache) {
  if (!cache) return [];
  const moved = [];
  [
    ['links', false],
    ['frontmatterLinks', true],
  ].forEach(([field, fromProperty]) => {
    const list = cache[field];
    if (!Array.isArray(list) || !list.some(isQuietRef)) return;
    cache[field] = list.filter((ref) => {
      if (!isQuietRef(ref)) return true;
      moved.push(Object.assign({}, ref, { fromProperty }));
      return false;
    });
    if (!cache[field].length) delete cache[field];
  });
  if (moved.length) cache.drQuietLinks = (cache.drQuietLinks || []).concat(moved);
  return moved;
}

/** The other way, for when quiet links are switched off: put back where Obsidian keeps them. */
function unsettleQuietLinks(cache) {
  if (!cache || !Array.isArray(cache.drQuietLinks)) return [];
  const back = cache.drQuietLinks;
  const at = (ref) => (ref.position && ref.position.start ? ref.position.start.offset : 0);
  back.forEach((ref) => {
    const field = ref.fromProperty ? 'frontmatterLinks' : 'links';
    const plain = Object.assign({}, ref);
    delete plain.fromProperty;
    (cache[field] = cache[field] || []).push(plain);
  });
  // In the order they're written, as Obsidian lists them.
  if (cache.links) cache.links.sort((a, b) => at(a) - at(b));
  delete cache.drQuietLinks;
  return back;
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

/* -- sharing, and stray notes ---------------------------------------- */

/* The comment a portable quiet link carries: hidden by Obsidian when read. */
const PORTABLE_MARK = '%%quiet%%';

/**
 * Where a note's quiet links are in its text — from where Obsidian found
 * them, so none in code or maths — each over "[[[…]]]": { from, to, inner }.
 * One whose text no longer matches (an edit since it was read) is left out.
 */
function quietSpans(text, cache) {
  const refs = []
    .concat((cache && cache.drQuietLinks) || [])
    .concat(((cache && cache.links) || []).filter(isQuietRef))
    .filter((ref) => !ref.fromProperty && ref.position);
  const out = [];
  refs.forEach((ref) => {
    const from = ref.position.start.offset;
    // Obsidian's link ends before the last bracket.
    const to = ref.position.end.offset + 1;
    const m = /^\[\[\[([^[\]\n]+?)\]\]\]$/.exec(text.slice(from, to));
    if (m) out.push({ from, to, inner: m[1] });
  });
  return out.sort((a, b) => a.from - b.from);
}

/**
 * Where a note's shared quiet links are: an ordinary link with the mark
 * straight after. Found in the text itself — the mark is its own sign —
 * so it works even before Obsidian has read the note again.
 */
function portableSpans(text) {
  const out = [];
  const re = /(^|[^[])\[\[([^[\]\n]+?)\]\]%%quiet%%/g;
  let m;
  while ((m = re.exec(text))) {
    const from = m.index + m[1].length;
    out.push({ from, to: from + m[2].length + 4 + PORTABLE_MARK.length, inner: m[2] });
  }
  return out;
}

/** Text with each span written another way, back to front so the places hold. */
function rewriteSpans(text, spans, write) {
  let out = text;
  spans
    .slice()
    .sort((a, b) => b.from - a.from)
    .forEach((span) => {
      out = out.slice(0, span.from) + write(span.inner) + out.slice(span.to);
    });
  return out;
}

/**
 * A note made by following a quiet link on a device without this plugin:
 * "[Anarchy.md", or "[Politics/Anarchy.md" as a folder and a note. The
 * link it was made for — "Anarchy", "Politics/Anarchy" — or null.
 */
function strayLinkpath(path) {
  const parts = String(path || '').split('/');
  const at = parts.findIndex((part) => part.startsWith('[') && !part.startsWith('[['));
  if (at === -1 || !/\.md$/i.test(path)) return null;
  const rest = parts.slice(at);
  rest[0] = rest[0].slice(1);
  const linkpath = rest.join('/').replace(/\.md$/i, '');
  return linkpath.trim() ? linkpath : null;
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
        desc: 'Write [[[Note]]] for a link kept off the graph and backlinks. Right-click a link to switch it.',
      },
    ];
  }

  actions() {
    const hit = (ctx) => linkAtCursor(ctx.editor);
    return [
      {
        id: 'toggle-quiet-link',
        name: 'Make the link at the cursor quiet or normal',
        menu: (ctx) => (hit(ctx).quiet ? 'Make link normal' : 'Make link quiet'),
        menuIcon: (ctx) => (hit(ctx).quiet ? 'link' : 'link-2-off'),
        icon: 'link-2-off',
        on: 'editor',
        when: (ctx) => this.enabled && !!hit(ctx),
        run: (ctx) => this.toggle(ctx.editor),
      },
      { id: 'make-quiet-links-portable', name: 'Make quiet links normal, for sharing', icon: 'share', when: () => this.enabled, run: () => this.makePortable() },
      { id: 'make-shared-links-quiet', name: 'Make shared links quiet again', icon: 'link-2-off', when: () => this.enabled, run: () => this.makeQuietAgain() },
      { id: 'fold-stray-quiet-notes', name: 'Fold in notes made by quiet links elsewhere', icon: 'merge', when: () => this.enabled, run: () => this.reviewStrays(true) },
    ];
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
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        const ctx = this.enabled ? editorContext(editor, info, 'menu') : null;
        if (ctx) addActionEntries(menu, actionsOn(this.actions(), 'editor'), ctx, 'action');
      })
    );

    // Each note as Obsidian reads it: its quiet links set aside before
    // it counts them. It counts a note's links just after telling of it.
    const mc = this.app.metadataCache;
    this.plugin.registerEvent(
      mc.on('changed', (file, data, cache) => {
        if (this.enabled && file) this.settle(file.path, cache);
      })
    );
    // What Obsidian remembered from last time, it counts without reading
    // again; those are set aside once it has.
    this.plugin.registerEvent(
      mc.on('resolved', () => {
        if (this.enabled) this.queueSweep();
      })
    );

    // A note made from a quiet link on a device without this plugin
    // arrives by sync; one look at start-up, and one as each arrives.
    this.plugin.registerEvent(
      this.app.vault.on('create', (file) => {
        if (this.enabled && file instanceof TFile && strayLinkpath(file.path)) this.queueStrayCheck();
      })
    );
    this.queueStrayCheck(5000);

    const follow = () => this.watchPanes();
    this.plugin.registerEvent(this.app.workspace.on('layout-change', follow));
    this.plugin.registerEvent(this.app.workspace.on('active-leaf-change', follow));
    this.plugin.registerEvent(this.app.workspace.on('file-open', follow));
    this.plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.enabled) this.noteRename(file, oldPath);
      })
    );
    this.plugin.register(() => {
      window.clearTimeout(this.sweepTimer);
      this.unwatchPanes();
      this.restoreAll();
    });
  }

  /* -- Obsidian's count of links --------------------------------------- */

  /**
   * One note's quiet links set aside. Obsidian usually hasn't counted
   * them yet; where it has (a note it remembered), the count is taken
   * back too. True if anything moved.
   */
  settle(path, cache) {
    const moved = settleQuietLinks(cache);
    if (!moved.length) return false;
    this.recount(path, moved, -1);
    return true;
  }

  /**
   * Obsidian's counts of a note's links, up or down by the ones given:
   * resolved if the stand-in names a real file (a stray "[Name" note),
   * unresolved otherwise. Only what was counted is taken back.
   */
  recount(path, refs, by) {
    const mc = this.app.metadataCache;
    refs.forEach((ref) => {
      const key = linkCountKey(ref);
      const dest = mc.getFirstLinkpathDest(key, path);
      const table = dest ? mc.resolvedLinks : mc.unresolvedLinks;
      if (!table) return;
      const name = dest ? dest.path : key;
      if (by < 0 && !(table[path] && table[path][name])) return;
      const own = table[path] || (table[path] = {});
      own[name] = (own[name] || 0) + by;
      if (own[name] <= 0) delete own[name];
    });
  }

  queueSweep() {
    window.clearTimeout(this.sweepTimer);
    this.sweepTimer = window.setTimeout(() => this.sweep(), 200);
  }

  /**
   * Every note Obsidian counted a stand-in for — "[Name" among its
   * unresolved links, or a stray "[Name" note among its resolved ones —
   * settled, and the panes that show links told to look again.
   */
  sweep() {
    const mc = this.app.metadataCache;
    const paths = new Set();
    const scan = (table, standIn) =>
      Object.keys(table || {}).forEach((p) => {
        if (Object.keys(table[p] || {}).some(standIn)) paths.add(p);
      });
    scan(mc.unresolvedLinks, (k) => k.startsWith('['));
    scan(mc.resolvedLinks, (k) => k.split('/').pop().startsWith('['));
    let changed = 0;
    paths.forEach((p) => {
      const file = this.app.vault.getFileByPath(p);
      const cache = file ? mc.getFileCache(file) : null;
      if (cache && this.settle(p, cache)) changed++;
    });
    if (changed) this.announceCounts();
    return changed;
  }

  /** Switched off: every note's quiet links back where Obsidian keeps them. */
  restoreAll() {
    const mc = this.app.metadataCache;
    const paths = typeof mc.getCachedFiles === 'function' ? mc.getCachedFiles() : Object.keys(mc.resolvedLinks || {});
    let changed = 0;
    paths.forEach((p) => {
      const file = this.app.vault.getFileByPath(p);
      const cache = file ? mc.getFileCache(file) : null;
      const back = unsettleQuietLinks(cache);
      if (!back.length) return;
      this.recount(p, back, 1);
      changed++;
    });
    if (changed && !this.plugin.unloading) this.announceCounts();
    return changed;
  }

  /** The graph, backlinks and Outgoing links redraw when Obsidian says its links are counted. */
  announceCounts() {
    try {
      this.app.metadataCache.trigger('resolved');
    } catch (err) {
      /* they catch up on the next change */
    }
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
    if (switched) {
      this.refreshEditors();
      this.sweep();
    }
    this.watchPanes();
    if (switched) this.rerenderReading();
  }

  disable() {
    const switched = this.on === true;
    this.on = false;
    if (switched) {
      this.refreshEditors();
      this.restoreAll();
    }
    this.unwatchPanes();
    if (switched && !this.plugin.unloading) this.rerenderReading();
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

  /* -- Obsidian's properties block ------------------------------------- */

  /**
   * It draws a value written [[[Note]]] from the text, as a link to the
   * stand-in; watched while quiet links are on, and put right whenever
   * it's drawn. Not public API, so it's looked for, and left as it is
   * where it isn't found.
   */
  watchPanes() {
    if (!this.enabled || typeof MutationObserver !== 'function') return;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (!(view instanceof MarkdownView) || !view.containerEl) return;
      const box = view.containerEl.querySelector('.metadata-container');
      if (box) this.watch(box, () => this.quietenProperties(box, view.file ? view.file.path : ''));
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

  /* -- sharing ----------------------------------------------------------- */

  /**
   * Every quiet link in the vault written as an ordinary link with a
   * hidden mark, [[Anarchy]]%%quiet%%, so notes shared or published work
   * anywhere; the mark is how they're found to make quiet again.
   * Properties are left as they are: a property can't hold the mark.
   */
  async makePortable() {
    const found = [];
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const refs = quietRefs(cache);
      if (refs.length) found.push({ file, body: refs.filter((r) => !r.key).length, property: refs.filter((r) => r.key).length });
    });
    const body = found.reduce((n, f) => n + f.body, 0);
    const property = found.reduce((n, f) => n + f.property, 0);
    if (!body) {
      new Notice(property ? 'The only quiet links are in properties, which stay as they are.' : 'There are no quiet links to share.');
      return 0;
    }
    const notes = found.filter((f) => f.body).length;
    const ok = await confirmAction(this.app, {
      title: 'Make quiet links normal?',
      text:
        `${body} quiet ${body === 1 ? 'link' : 'links'} in ${notes} ${notes === 1 ? 'note' : 'notes'} become ordinary links, ` +
        'each with a hidden mark, so they work wherever the notes go. Make shared links quiet again turns them back.' +
        (property ? ` ${property} in properties stay as they are.` : ''),
      button: 'Make them normal',
    });
    if (!ok) return 0;
    const changed = await this.rewriteAll(found.map((f) => f.file), quietSpans, (inner) => `[[${inner}]]${PORTABLE_MARK}`);
    this.plugin.offerUndo(
      `Made ${changed} quiet ${changed === 1 ? 'link' : 'links'} normal, for sharing.`,
      () => this.makeQuietAgain(true)
    );
    return changed;
  }

  /** The other way: each [[Note]]%%quiet%% quiet again, as [[[Note]]]. */
  async makeQuietAgain(silent) {
    const files = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const text = await this.app.vault.cachedRead(file);
      if (text.includes(PORTABLE_MARK)) files.push(file);
    }
    const changed = await this.rewriteAll(files, portableSpans, (inner) => `[[[${inner}]]]`);
    if (!silent) {
      new Notice(changed ? `Made ${changed} shared ${changed === 1 ? 'link' : 'links'} quiet again.` : 'There are no shared links to make quiet.');
    }
    return changed;
  }

  /** Each note rewritten from where Obsidian found its links, checked against the text as it is now. */
  async rewriteAll(files, spansOf, write) {
    let changed = 0;
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      try {
        await this.app.vault.process(file, (text) => {
          const spans = spansOf(text, cache);
          changed += spans.length;
          return spans.length ? rewriteSpans(text, spans, write) : text;
        });
      } catch (err) {
        console.error('Design Redux: could not rewrite quiet links', err);
        new Notice(`Could not change the links in “${file.basename}”.`);
      }
    }
    return changed;
  }

  /* -- stray notes --------------------------------------------------------- */

  /**
   * Notes made by following a quiet link somewhere without this plugin:
   * each with the note it was meant to be, if that exists.
   */
  strays() {
    // Only a note some quiet link points at: "[Draft] Essay" is just a name.
    const meant = new Set();
    this.app.vault.getMarkdownFiles().forEach((file) =>
      quietRefs(this.app.metadataCache.getFileCache(file)).forEach((ref) => meant.add(ref.path.toLowerCase()))
    );
    if (!meant.size) return [];
    return this.app.vault
      .getMarkdownFiles()
      .map((file) => {
        const linkpath = strayLinkpath(file.path);
        if (!linkpath || !meant.has(linkpath.toLowerCase())) return null;
        const real = this.app.metadataCache.getFirstLinkpathDest(linkpath, '');
        return real && real !== file ? { file, linkpath, real } : { file, linkpath, real: null };
      })
      .filter(Boolean);
  }

  queueStrayCheck(delay) {
    window.clearTimeout(this.strayTimer);
    this.strayTimer = window.setTimeout(() => {
      if (this.enabled) this.reviewStrays(false);
    }, delay || 1500);
  }

  /** Said once in a notice, with a way to look; or, asked for, the list itself. */
  reviewStrays(asked) {
    const strays = this.strays();
    if (!strays.length) {
      if (asked) new Notice('There are no notes made by quiet links elsewhere.');
      return strays;
    }
    if (asked) {
      new StrayNotesModal(this, strays).open();
      return strays;
    }
    const key = strays.map((s) => s.file.path).sort().join('|');
    if (key === this.strayNoticed) return strays;
    this.strayNoticed = key;
    const fragment = document.createDocumentFragment();
    const text = document.createElement('span');
    text.textContent =
      strays.length === 1
        ? `“${strays[0].file.basename}” was made by a quiet link on a device without Design Redux. `
        : `${strays.length} notes were made by quiet links on a device without Design Redux. `;
    const link = document.createElement('a');
    link.className = 'dr-undo';
    link.setAttribute('href', '#');
    link.textContent = 'Review';
    fragment.append(text, link);
    const notice = new Notice(fragment, 15000);
    link.addEventListener('click', (evt) => {
      evt.preventDefault();
      if (notice && typeof notice.hide === 'function') notice.hide();
      new StrayNotesModal(this, this.strays()).open();
    });
    return strays;
  }

  /**
   * A stray note put right: its writing added to the end of the note it
   * was meant to be, and it goes to the trash; or, where that note
   * doesn't exist yet, it's simply renamed to be it.
   */
  async fold(stray) {
    const { file, linkpath, real } = stray;
    // Read now: once the note is moved or trashed it no longer has a folder.
    const dirPath = file.parent && file.parent.path && file.parent.path !== '/' ? file.parent.path : null;
    try {
      if (!real) {
        await this.app.fileManager.renameFile(file, normalizePath(`${linkpath}.md`));
      } else {
        const own = (await this.app.vault.read(file)).trim();
        if (own) {
          await this.app.vault.process(real, (text) => `${text.replace(/\s*$/, '')}\n\n${own}\n`);
        }
        await this.toTrash(file);
      }
    } catch (err) {
      console.error('Design Redux: could not fold in a stray note', err);
      new Notice(`Could not fold in “${file.basename}”.`);
      return false;
    }
    // A "[Folder" left empty goes too.
    await this.dropEmptyStrayFolder(dirPath, file);
    this.strayNoticed = null;
    return true;
  }

  /**
   * The "[Folder" a stray note was in, to the trash if nothing's left in it.
   * What's on disk decides: the vault's own list can lag a moment behind.
   */
  async dropEmptyStrayFolder(dirPath, gone) {
    if (!dirPath || !dirPath.split('/').pop().startsWith('[')) return;
    const dir = this.app.vault.getAbstractFileByPath(dirPath);
    if (!(dir instanceof TFolder)) return;
    try {
      const adapter = this.app.vault.adapter;
      if (adapter && typeof adapter.list === 'function') {
        const listed = await adapter.list(dirPath);
        if (listed.files.length || listed.folders.length) return;
      } else if (dir.children.some((child) => child !== gone && child.path !== gone.path)) {
        return;
      }
      await this.toTrash(dir);
    } catch (err) {
      /* an empty folder, left */
    }
  }

  /** The trash, as Obsidian's setting says; its own .trash folder where the system's can't be reached. */
  async toTrash(entry) {
    try {
      await this.app.fileManager.trashFile(entry);
    } catch (err) {
      await this.app.vault.trash(entry, false);
    }
  }
}

QuietLinks.settingKey = 'quietLinks';

/**
 * The notes made by quiet links elsewhere, each with what folding it in
 * does: added to the note it was meant to be, or renamed to be it.
 */
class StrayNotesModal extends Modal {
  constructor(feature, strays) {
    super(feature.app);
    this.feature = feature;
    this.strays = strays;
  }

  onOpen() {
    this.modalEl.addClass('dr-stray-modal');
    this.titleEl.setText('Notes made by quiet links');
    this.contentEl.createDiv({
      cls: 'setting-item-description dr-stray-intro',
      text: 'On a device without Design Redux, following [[[Note]]] makes a note called “[Note”. Fold each into the note it was meant to be.',
    });
    this.list = this.contentEl.createDiv({ cls: 'dr-stray-list' });
    this.render();
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    this.allButton = buttons.createEl('button', { cls: 'mod-cta', text: 'Fold in all' });
    this.allButton.addEventListener('click', async () => {
      for (const stray of this.strays.slice()) await this.foldOne(stray);
      this.close();
    });
    buttons.createEl('button', { text: 'Close' }).addEventListener('click', () => this.close());
  }

  render() {
    this.list.empty();
    if (!this.strays.length) {
      this.list.createDiv({ cls: 'setting-item-description', text: 'All folded in.' });
      if (this.allButton) this.allButton.disabled = true;
      return;
    }
    this.strays.forEach((stray) => {
      const row = new Setting(this.list)
        .setName(stray.file.path)
        .setDesc(stray.real ? `Its writing goes at the end of “${stray.real.basename}”, and it goes to the trash.` : `Renamed to “${stray.linkpath}”, which doesn’t exist yet.`);
      row.addButton((b) =>
        b
          .setButtonText(stray.real ? 'Fold in' : 'Rename')
          .onClick(async () => {
            await this.foldOne(stray);
            this.render();
          })
      );
    });
  }

  async foldOne(stray) {
    if (await this.feature.fold(stray)) this.strays.splice(this.strays.indexOf(stray), 1);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Ask before a change to many notes: resolves true to go ahead. */
function confirmAction(app, opts) {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    let answered = false;
    const answer = (yes) => {
      if (answered) return;
      answered = true;
      resolve(yes);
      modal.close();
    };
    modal.onOpen = () => {
      modal.titleEl.setText(opts.title);
      modal.contentEl.createEl('p', { text: opts.text });
      const buttons = modal.contentEl.createDiv({ cls: 'modal-button-container' });
      buttons.createEl('button', { cls: 'mod-cta', text: opts.button || 'Go ahead' }).addEventListener('click', () => answer(true));
      buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => answer(false));
    };
    modal.onClose = () => {
      modal.contentEl.empty();
      if (!answered) {
        answered = true;
        resolve(false);
      }
    };
    modal.open();
  });
}
