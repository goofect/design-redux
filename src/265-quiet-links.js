/* ------------------------------------------------------------------ */
/* Quiet links                                                         */
/*                                                                     */
/* A link that goes somewhere without saying the two notes belong      */
/* together. Written [[Note|~]] — or [[Note|~some words]] to show      */
/* those words — it opens, previews, autocompletes and follows renames */
/* as any link does, because to Obsidian it is one; but the graph      */
/* isn't told about it, so the graph keeps to the connections that     */
/* mean something. Shown with a dotted underline, in the note and in   */
/* reading view, so it's plain which kind a link is.                   */
/* ------------------------------------------------------------------ */

/* [[target|~words]]: a link whose alias starts with a tilde. */
const QUIET_LINK = /\[\[([^[\]|\n]+)\|~([^[\]\n]*)\]\]/g;

function isQuietLink(original) {
  return /^\[\[[^[\]|]*\|~/.test(String(original || ''));
}

/** What a quiet link shows: its words after the tilde, or the note's name — and heading, as Obsidian writes it. */
function quietLabel(linktext, words) {
  const own = String(words || '').trim();
  if (own) return own;
  const [path, ...rest] = String(linktext || '').split('#');
  const name = path.split('/').pop().replace(/\.md$/i, '');
  const sub = rest.join('#').replace(/^\^/, '');
  if (!name) return sub || String(linktext || '');
  return sub ? `${name} > ${sub}` : name;
}

/**
 * The notes one note links to only quietly — the lines the graph leaves
 * out. A note linked both ways, quietly and plainly, keeps its line;
 * embeds and links in properties are plain unless written quietly too.
 */
function quietTargets(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return null;
  const links = [].concat(cache.links || [], cache.frontmatterLinks || []);
  if (!links.some((l) => l && isQuietLink(l.original))) return null;
  const where = (link) => {
    const path = String(link || '').split('#')[0].split('|')[0];
    const dest = app.metadataCache.getFirstLinkpathDest(path, file.path);
    return dest ? dest.path : path;
  };
  const quiet = new Set();
  const plain = new Set();
  links.forEach((l) => {
    if (l && l.link) (isQuietLink(l.original) ? quiet : plain).add(where(l.link));
  });
  (cache.embeds || []).forEach((l) => {
    if (l && l.link) plain.add(where(l.link));
  });
  plain.forEach((p) => quiet.delete(p));
  return quiet.size ? quiet : null;
}

/**
 * The graph's data without the quiet lines. A note left with no line to
 * anything only because its lines were quiet goes too, where the graph
 * wouldn't show it on its own — in a local graph, or with orphans off.
 */
function withoutQuietLinks(app, data, opts = {}) {
  if (!data || !data.nodes) return data;
  const nodes = Object.assign({}, data.nodes);
  const touched = new Set();
  let removed = 0;
  Object.keys(nodes).forEach((id) => {
    const node = nodes[id];
    if (!node || !node.links) return;
    const file = app.vault.getFileByPath(id);
    if (!file || file.extension !== 'md') return;
    const quiet = quietTargets(app, file);
    if (!quiet) return;
    let links = null;
    Object.keys(node.links).forEach((target) => {
      if (!quiet.has(target)) return;
      if (!links) links = Object.assign({}, node.links);
      delete links[target];
      touched.add(id);
      touched.add(target);
      removed++;
    });
    if (links) nodes[id] = Object.assign({}, node, { links });
  });
  if (!removed) return data;

  if (opts.dropLoners) {
    const joined = new Set();
    Object.keys(nodes).forEach((id) =>
      Object.keys((nodes[id] && nodes[id].links) || {}).forEach((target) => {
        if (!nodes[target]) return;
        joined.add(id);
        joined.add(target);
      })
    );
    touched.forEach((id) => {
      if (!joined.has(id) && id !== opts.keep) delete nodes[id];
    });
  }
  const out = Object.assign({}, data, { nodes });
  if (typeof data.numLinks === 'number') out.numLinks = Math.max(0, data.numLinks - removed);
  return out;
}

/** The link around the cursor on its line: { line, from, to, target, words, quiet }, or null. */
function linkAtCursor(editor) {
  if (!editor || typeof editor.getCursor !== 'function') return null;
  const cursor = editor.getCursor();
  const text = editor.getLine(cursor.line);
  const re = /\[\[([^[\]\n]+?)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    if (cursor.ch < from || cursor.ch > to) continue;
    const bar = m[1].indexOf('|');
    const target = bar === -1 ? m[1] : m[1].slice(0, bar);
    const alias = bar === -1 ? null : m[1].slice(bar + 1);
    const quiet = alias !== null && alias.startsWith('~');
    return { line: cursor.line, from, to, target, words: quiet ? alias.slice(1) : alias, quiet };
  }
  return null;
}

/** The same link, quiet if it was plain and plain if it was quiet, words kept. */
function toggledLink(hit) {
  if (hit.quiet) return hit.words ? `[[${hit.target}|${hit.words}]]` : `[[${hit.target}]]`;
  return `[[${hit.target}|~${hit.words || ''}]]`;
}

/** A quiet link in Live Preview: its name, dotted, opening where it points. */
class QuietLinkWidget extends WidgetType {
  constructor(feature, label, linktext, sourcePath) {
    super();
    this.feature = feature;
    this.label = label;
    this.linktext = linktext;
    this.sourcePath = sourcePath;
  }

  eq(other) {
    return other.label === this.label && other.linktext === this.linktext && other.sourcePath === this.sourcePath;
  }

  toDOM(view) {
    const el = view.dom.ownerDocument.createElement('span');
    el.className = 'cm-hmd-internal-link dr-quiet-link';
    el.textContent = this.label;
    el.setAttribute('data-href', this.linktext);
    el.addEventListener('mousedown', (evt) => {
      if (evt.button !== 0 && evt.button !== 1) return;
      evt.preventDefault();
      evt.stopPropagation();
      const newLeaf = evt.button === 1 || evt.ctrlKey || evt.metaKey;
      this.feature.app.workspace.openLinkText(this.linktext, this.sourcePath, newLeaf);
    });
    el.addEventListener('mouseover', (evt) => {
      this.feature.app.workspace.trigger('hover-link', {
        event: evt,
        source: 'editor',
        hoverParent: el,
        targetEl: el,
        linktext: this.linktext,
        sourcePath: this.sourcePath,
      });
    });
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

/**
 * In Live Preview, each quiet link's words are drawn as its name, dotted,
 * until the cursor reaches it and the source shows, as any link's does.
 */
function quietDecorations(feature, view) {
  const builder = new RangeSetBuilder();
  const state = view.state;
  if (!feature.enabled || !scriptLivePreview(state)) return builder.finish();
  let sourcePath = '';
  try {
    const info = editorInfoField ? state.field(editorInfoField, false) : null;
    sourcePath = (info && info.file && info.file.path) || '';
  } catch (err) {
    /* none to hand */
  }
  if (!sourcePath) {
    const active = feature.app.workspace.getActiveFile();
    sourcePath = active ? active.path : '';
  }
  const ranges = state.selection.ranges;
  const touched = (from, to) => ranges.some((r) => r.from <= to && r.to >= from);
  let lastLine = 0;
  for (const visible of view.visibleRanges) {
    let pos = visible.from;
    while (pos <= visible.to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine || line.text.indexOf('|~') === -1) continue;
      lastLine = line.number;
      QUIET_LINK.lastIndex = 0;
      let m;
      while ((m = QUIET_LINK.exec(line.text))) {
        const from = line.from + m.index;
        const to = from + m[0].length;
        if (touched(from, to) || quietIgnored(state, from)) continue;
        // Only the words: Obsidian hides the brackets and target itself.
        const wordsFrom = from + 2 + m[1].length + 1;
        const wordsTo = to - 2;
        builder.add(
          wordsFrom,
          wordsTo,
          Decoration.replace({ widget: new QuietLinkWidget(feature, quietLabel(m[1], m[2]), m[1], sourcePath) })
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

class QuietLinks extends Feature {
  settingsSchema() {
    return [
      {
        key: 'quietLinks',
        name: 'Quiet links',
        desc: 'Write a link as [[Note|~]] to keep it out of the graph. It still opens, previews and follows renames like any link, and shows with a dotted underline. Right-click a link, or use the command, to switch it between quiet and normal.',
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

  register() {
    this.plugin.registerEditorExtension([quietEditorExtension(this)]);
    this.plugin.registerMarkdownPostProcessor((el) => {
      if (this.enabled) quietenLinksIn(el);
    });
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
    const wrap = () => this.wrapGraphs();
    this.plugin.registerEvent(this.app.workspace.on('layout-change', wrap));
    this.plugin.registerEvent(this.app.workspace.on('active-leaf-change', wrap));
    this.plugin.register(() => this.unwrapGraphs());
  }

  /** Runs on every settings save, so editors and graphs are only redrawn when it's switched. */
  enable() {
    const switched = this.on !== true;
    this.on = true;
    if (switched) this.refreshEditors();
    this.wrapGraphs(switched);
  }

  disable() {
    const switched = this.on === true;
    this.on = false;
    if (switched) this.refreshEditors();
    this.unwrapGraphs();
  }

  /** Editors redraw their decorations, for a change of setting. */
  refreshEditors() {
    this.changed = true;
    try {
      this.app.workspace.updateOptions();
    } catch (err) {
      /* nothing open to redraw */
    }
    this.changed = false;
  }

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
   * where the quiet lines are taken out, on the way in. Not public API,
   * so it's only done where setData is there to wrap, and a graph
   * without it draws quiet links like any other.
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
      const keep = local && view.file ? view.file.path : null;
      return withoutQuietLinks(this.app, data, {
        dropLoners: local || !!(options && options.showOrphans === false),
        keep: keep,
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

/** Reading view, and anywhere else Markdown is drawn: quiet links named and dotted. */
function quietenLinksIn(el) {
  el.querySelectorAll('.internal-link').forEach((a) => {
    const text = a.textContent || '';
    if (!text.startsWith('~') || a.classList.contains('dr-quiet-link')) return;
    const target = a.getAttribute('data-href') || a.getAttribute('href') || '';
    a.textContent = quietLabel(target, text.slice(1));
    a.classList.add('dr-quiet-link');
  });
}
