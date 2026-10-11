/* ------------------------------------------------------------------ */
/* Superscript and subscript                                           */
/*                                                                     */
/* Markdown has neither. Two spellings are read: the short one that    */
/* Pandoc and many editors use — x^2^ and H~2~O — and the <sup> and    */
/* <sub> tags, which Obsidian draws in reading view but leaves flat    */
/* while you edit. Both are raised and lowered in the editor, the      */
/* short one in reading view and exports too, and two commands put     */
/* either in place around the selection or take it off again. The      */
/* note's text is only what you wrote, so other apps read the same.    */
/* ------------------------------------------------------------------ */

const SCRIPT_MARKS = {
  sup: { short: '^', open: '<sup>', close: '</sup>', label: 'Superscript', icon: 'superscript' },
  sub: { short: '~', open: '<sub>', close: '</sub>', label: 'Subscript', icon: 'subscript' },
};

/*
 * x^2^ — no spaces inside, as in Pandoc, so "x^2 + y^2" stays as it is;
 * and not a footnote [^1], a link to a block #^id or an inline note ^[…].
 * The character before is matched, not looked behind at: iPhones and
 * iPads before iOS 16.4 can't read lookbehind, and one pattern they
 * can't read would stop the whole plugin loading there.
 */
const SUP_SHORT = /(^|[^\\[#^])\^((?:\\.|[^\s^\\[\]])+)\^/g;
/* H~2~O — one tilde each side, so ~~strikethrough~~ is left alone. */
const SUB_SHORT = /(^|[^\\~])~(?!~)((?:\\.|[^\s~\\])+)~(?!~)/g;
/* <sup>…</sup> and <sub>…</sub> with nothing else inside. */
const SCRIPT_TAG = /<(sup|sub)>([^<>\n]*?)<\/\1>/gi;
/* A web address, whose ~ and ^ are its own. */
const BARE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/gi;
/* Inline maths, whose ^ and ~ are TeX's. */
const INLINE_MATH = /(^|[^\\$])\$(?=\S)([^$\n]*?[^$\s])\$(?![\d$])/g;

/**
 * The superscripts and subscripts in one line of text, in either
 * spelling: { kind, syntax, from, to, innerFrom, innerTo }. Where two
 * overlap the outer one counts, and none is inside inline maths or
 * a web address.
 */
function scriptSpans(text) {
  if (!/[\^~]|<su[pb]>/i.test(text)) return [];
  const found = [];
  const maths = [];
  const collect = (re, into, make) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) into.push(make(m));
  };
  // `lead` is the character matched before the marker, which isn't part of it.
  const span = (m, kind, syntax, open, close, lead = 0) => ({
    kind,
    syntax,
    from: m.index + lead,
    to: m.index + m[0].length,
    innerFrom: m.index + lead + open,
    innerTo: m.index + m[0].length - close,
  });
  collect(SUP_SHORT, found, (m) => span(m, 'sup', 'short', 1, 1, m[1].length));
  collect(SUB_SHORT, found, (m) => span(m, 'sub', 'short', 1, 1, m[1].length));
  collect(SCRIPT_TAG, found, (m) => span(m, m[1].toLowerCase(), 'html', 5, 6));
  collect(INLINE_MATH, maths, (m) => ({ from: m.index + m[1].length, to: m.index + m[0].length }));
  collect(BARE_URL, maths, (m) => ({ from: m.index, to: m.index + m[0].length }));
  const inMaths = (s) => maths.some((r) => s.from < r.to && s.to > r.from);
  const spans = found.filter((s) => !inMaths(s));
  spans.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept = [];
  let end = -1;
  spans.forEach((s) => {
    if (s.from >= end) {
      kept.push(s);
      end = s.to;
    }
  });
  return kept;
}

/**
 * The markers to write around text in a line: the short ones when
 * they'd be read back as this — no spaces, nothing next to them that
 * makes them something else — or the tags otherwise, or when asked.
 */
function scriptSpelling(kind, lineText, a, b, html) {
  const marks = SCRIPT_MARKS[kind];
  if (!html) {
    const inner = lineText.slice(a, b) || 'x';
    const trial = lineText.slice(0, a) + marks.short + inner + marks.short + lineText.slice(b);
    const end = a + inner.length + 2;
    const reads = scriptSpans(trial).some(
      (s) => s.kind === kind && s.syntax === 'short' && s.from === a && s.to === end
    );
    if (reads) return [marks.short, marks.short];
  }
  return [marks.open, marks.close];
}

/**
 * Superscript or subscript on or off for each selection, as Bold is:
 * text inside one comes out of it, one of the other kind changes kind,
 * and anything else is wrapped — the selection trimmed of spaces at
 * its ends, each line of a longer one on its own. With nothing
 * selected the markers go in with the cursor between them.
 */
function toggleScript(state, kind, html) {
  const doc = state.doc;
  return state.changeByRange((range) => {
    const first = doc.lineAt(range.from);
    const last = doc.lineAt(range.to);

    if (first.number === last.number) {
      const hit = scriptSpans(first.text)
        .map((s) =>
          Object.assign({}, s, {
            from: s.from + first.from,
            to: s.to + first.from,
            innerFrom: s.innerFrom + first.from,
            innerTo: s.innerTo + first.from,
          })
        )
        .find((s) => s.from <= range.from && range.to <= s.to);
      if (hit) {
        const openLen = hit.innerFrom - hit.from;
        const clamp = (p) => Math.min(Math.max(p, hit.innerFrom), hit.innerTo);
        if (hit.kind === kind) {
          return {
            changes: [
              { from: hit.from, to: hit.innerFrom },
              { from: hit.innerTo, to: hit.to },
            ],
            range: EditorSelection.range(clamp(range.anchor) - openLen, clamp(range.head) - openLen),
          };
        }
        // The other kind: new markers, in the same spelling where it reads.
        const inner = doc.sliceString(hit.innerFrom, hit.innerTo);
        const at = hit.from - first.from;
        const bare = first.text.slice(0, at) + inner + first.text.slice(hit.to - first.from);
        const [open, close] = scriptSpelling(kind, bare, at, at + inner.length, html || hit.syntax === 'html');
        const shift = open.length - openLen;
        return {
          changes: [
            { from: hit.from, to: hit.innerFrom, insert: open },
            { from: hit.innerTo, to: hit.to, insert: close },
          ],
          range: EditorSelection.range(clamp(range.anchor) + shift, clamp(range.head) + shift),
        };
      }
    }

    const changes = [];
    let shift = 0;
    let selFrom = null;
    let selTo = null;
    for (let n = first.number; n <= last.number; n++) {
      const line = doc.line(n);
      let a = Math.max(line.from, range.from);
      let b = Math.min(line.to, range.to);
      const seg = doc.sliceString(a, b);
      if (seg.trim()) {
        a += seg.length - seg.trimStart().length;
        b -= seg.length - seg.trimEnd().length;
      } else if (!range.empty) {
        continue;
      }
      const [open, close] = scriptSpelling(kind, line.text, a - line.from, b - line.from, html);
      changes.push({ from: a, insert: open }, { from: b, insert: close });
      if (selFrom === null) selFrom = a + shift + open.length;
      shift += open.length + close.length;
      selTo = b + shift - close.length;
    }
    if (!changes.length) return { range };
    return { changes, range: EditorSelection.range(selFrom, selTo) };
  });
}

/** The superscript or subscript a selection is inside, if it's in one. */
function scriptAt(state, range) {
  const line = state.doc.lineAt(range.from);
  if (range.to > line.to) return null;
  const a = range.from - line.from;
  const b = range.to - line.from;
  return scriptSpans(line.text).find((s) => s.from <= a && b <= s.to) || null;
}

/** Code, maths, links, comments and frontmatter keep their ^ and ~ as they are. */
function scriptIgnored(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/code|frontmatter|math|comment|url|link|footref|blockid/i.test(node.name)) return true;
  }
  return false;
}

const SCRIPT_HIDE = Decoration.replace({});
const SCRIPT_MARK = Decoration.mark({ class: 'dr-script-mark' });
const SCRIPT_TEXT = {
  sup: Decoration.mark({ class: 'dr-sup' }),
  sub: Decoration.mark({ class: 'dr-sub' }),
};

/**
 * Raised and lowered text for what's on screen. In Live Preview the
 * short markers are hidden until the cursor reaches them, as **bold**'s
 * are; in source mode, and for the tags, they're shown faintly.
 */
function scriptDecorations(view) {
  const state = view.state;
  const live = scriptLivePreview(state);
  const ranges = state.selection.ranges;
  const touched = (from, to) => ranges.some((r) => r.from <= to && r.to >= from);
  const builder = new RangeSetBuilder();
  let lastLine = 0;
  for (const visible of view.visibleRanges) {
    let pos = visible.from;
    while (pos <= visible.to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastLine) continue;
      lastLine = line.number;
      scriptSpans(line.text).forEach((s) => {
        const from = line.from + s.from;
        const to = line.from + s.to;
        const innerFrom = line.from + s.innerFrom;
        const innerTo = line.from + s.innerTo;
        if (scriptIgnored(state, s.syntax === 'html' ? innerFrom : from)) return;
        const hide = live && s.syntax === 'short' && !touched(from, to);
        builder.add(from, innerFrom, hide ? SCRIPT_HIDE : SCRIPT_MARK);
        if (innerTo > innerFrom) builder.add(innerFrom, innerTo, SCRIPT_TEXT[s.kind]);
        builder.add(innerTo, to, hide ? SCRIPT_HIDE : SCRIPT_MARK);
      });
    }
  }
  return builder.finish();
}

function scriptEditorExtension() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = scriptDecorations(view);
      }

      update(u) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          syntaxTree(u.startState) !== syntaxTree(u.state) ||
          scriptLivePreview(u.startState) !== scriptLivePreview(u.state)
        ) {
          this.decorations = scriptDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/* -- ordinals as you type ------------------------------------------------- */

/** The suffix a number takes: 1st, 2nd, 3rd, 4th, 11th, 21st, 112th. */
function ordinalSuffix(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

/* What ends a word, so the ordinal before it is finished. */
const ORDINAL_ENDS = [' ', '.', ',', ';', ':', '!', '?'];

/**
 * The ordinal just before a position — "21st" — if it's a real one and
 * written plainly: not "1th", not part of a longer word, not already
 * raised. { from, to, suffix } for the suffix, or null.
 */
function ordinalBefore(text) {
  const m = /(^|[^\p{L}\p{N}_^~>])(\d{1,6})(st|nd|rd|th)$/iu.exec(text);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (m[3] !== m[3].toLowerCase() || ordinalSuffix(n) !== m[3]) return null;
  const to = text.length;
  return { from: to - m[3].length, to, suffix: m[3] };
}

/**
 * Typing a space or punctuation after an ordinal raises its suffix:
 * 1st → 1^st^, or 1<sup>st</sup> when the tags are the chosen form. The
 * space goes in first and the change after it, as a step of its own, so
 * undo takes the change back and leaves what was typed.
 */
function ordinalInput(getHtml) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing || ORDINAL_ENDS.indexOf(text) === -1 || from !== to) return false;
    const state = view.state;
    if (state.selection.ranges.length !== 1) return false;
    const line = state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from);
    const found = ordinalBefore(before);
    if (!found) return false;
    // Inside code or maths still being typed — a ` or $ not yet closed —
    // which the editor can't know is code or maths until it is.
    const unclosed = (re) => (before.replace(/\\./g, '').match(re) || []).length % 2 === 1;
    if (unclosed(/`/g) || unclosed(/\$/g)) return false;
    const start = line.from + found.from;
    if (scriptIgnored(state, start) || scriptSpans(line.text).some((s) => s.from <= found.from && found.to <= s.to)) {
      return false;
    }
    const html = getHtml();
    const open = html ? '<sup>' : '^';
    const close = html ? '</sup>' : '^';
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input.type',
    });
    view.dispatch({
      changes: [
        { from: start, insert: open },
        { from: line.from + found.to, insert: close },
      ],
      userEvent: 'input.autoformat',
    });
    return true;
  });
}

/* Where ^ and ~ are something else in reading view. */
const SCRIPT_SKIP =
  'code, pre, kbd, samp, script, style, textarea, sup, sub, .math, mjx-container, .frontmatter, .dr-list-marker';

/**
 * The short spellings drawn as <sup> and <sub> in reading view. The
 * text there has lost its backslashes, so each one is checked against
 * the note's source when it's at hand: \^2\^ was written to stay flat.
 */
function renderScripts(el, ctx) {
  if (!/[\^~]/.test(el.textContent || '')) return;
  let source = null;
  const sourceText = () => {
    if (source !== null) return source;
    source = '';
    try {
      const info = ctx && typeof ctx.getSectionInfo === 'function' ? ctx.getSectionInfo(el) : null;
      if (info && typeof info.text === 'string') {
        source = info.text.split('\n').slice(info.lineStart, info.lineEnd + 1).join('\n');
      }
    } catch (err) {
      source = '';
    }
    return source;
  };
  const written = (raw) => {
    const text = sourceText();
    if (!text) return true;
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\\\])${escaped}`).test(text);
  };

  const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const text = node.data;
    if (!/[\^~]/.test(text)) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SCRIPT_SKIP)) return;
    const link = parent.closest('a');
    if (link && /:\/\//.test(link.textContent || '')) return;
    const spans = scriptSpans(text).filter(
      (s) => s.syntax === 'short' && written(text.slice(s.from, s.to))
    );
    if (!spans.length) return;
    const frag = document.createDocumentFragment();
    let at = 0;
    spans.forEach((s) => {
      if (s.from > at) frag.appendChild(document.createTextNode(text.slice(at, s.from)));
      const tag = document.createElement(s.kind);
      tag.className = 'dr-script';
      tag.textContent = text.slice(s.innerFrom, s.innerTo).replace(/\\(.)/g, '$1');
      frag.appendChild(tag);
      at = s.to;
    });
    if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
    node.parentNode.replaceChild(frag, node);
  });
}

/** Redraw open notes in reading view, after what they're drawn with has changed. */
function rerenderReading(app) {
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.previewMode) return;
    if (typeof view.previewMode.rerender === 'function') view.previewMode.rerender(true);
  });
}

class Scripts extends Feature {
  constructor(plugin) {
    super(plugin);
    // Registered once, filled and emptied, as the list extensions are.
    this.extensions = [];
    this.on = null;
  }

  settingsSchema() {
    return [
      {
        key: 'scripts',
        name: 'Show raised and lowered text',
        desc: 'Draw x^2^ and H~2~O as superscript and subscript, editing and reading.',
      },
      {
        key: 'scriptSyntax',
        type: 'dropdown',
        showIf: 'scripts',
        name: 'Syntax',
        desc: 'What the Superscript and Subscript commands write. Text with spaces always gets tags.',
        options: { short: 'x^2^ and H~2~O', html: '<sup> and <sub> tags' },
      },
      {
        key: 'autoOrdinals',
        showIf: 'scripts',
        name: 'Raise ordinals',
        desc: 'Raise the ending of 1st, 2nd or 3rd as you type. Undo puts it back.',
      },
    ];
  }

  /** Superscript and subscript: in the palette, with keys, and on the editor's menu. */
  actions() {
    const inside = (ctx) => scriptAt(ctx.cm.state, ctx.cm.state.selection.main);
    return ['sup', 'sub'].map((kind) => ({
      id: kind === 'sup' ? 'superscript' : 'subscript',
      name: SCRIPT_MARKS[kind].label,
      menu: (ctx) => {
        const now = inside(ctx);
        return now && now.kind === kind ? `Remove ${SCRIPT_MARKS[kind].label.toLowerCase()}` : SCRIPT_MARKS[kind].label;
      },
      icon: SCRIPT_MARKS[kind].icon,
      hotkeys: scriptHotkeys(kind),
      on: 'editor',
      // On the menu, with text selected or the cursor in one already.
      when: (ctx) => this.enabled && !!ctx.cm && (ctx.from === 'palette' || !ctx.cm.state.selection.main.empty || !!inside(ctx)),
      run: (ctx) => this.toggle(ctx.cm, kind),
    }));
  }

  /** The editor of the note being edited, if one is. */
  editorView() {
    return activeEditorView(this.app);
  }

  toggle(cm, kind) {
    if (!cm) return;
    const spec = toggleScript(cm.state, kind, this.settings.scriptSyntax === 'html');
    cm.dispatch(Object.assign(spec, { scrollIntoView: true, userEvent: 'input' }));
    if (typeof cm.focus === 'function') cm.focus();
  }

  registerTypes() {
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (this.enabled) renderScripts(el, ctx);
    });
  }

  /** In the editor's right-click menu, with text selected or the cursor in one already. */
  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        const ctx = this.enabled ? editorContext(editor, info, 'menu') : null;
        if (!ctx) return;
        // With Obsidian's own Format entries, where they can be found;
        // otherwise beside them.
        const format = findSubmenu(menu, 'Format');
        addActionEntries(format || menu, this.actions(), ctx, format ? null : 'selection');
      })
    );
  }

  enable() {
    this.apply(true);
  }

  disable() {
    this.apply(false);
  }

  apply(on) {
    // Ordinals follow their own setting, so it counts in whether to rebuild.
    const state = on ? `on/${!!this.settings.autoOrdinals}` : 'off';
    if (this.on === state) return;
    const first = this.on === null;
    const wasOn = !!this.on && this.on !== 'off';
    this.on = state;
    this.extensions.length = 0;
    if (on) {
      this.extensions.push(scriptEditorExtension());
      if (this.settings.autoOrdinals) {
        this.extensions.push(ordinalInput(() => this.settings.scriptSyntax === 'html'));
      }
    }
    this.app.workspace.updateOptions();
    if (!first && wasOn !== on) rerenderReading(this.app);
    else if (!first && !on) rerenderReading(this.app);
  }
}

/**
 * Default keys that nothing in Obsidian already uses: on a Mac, Pages'
 * own — Control-Command-= and Control-Command-hyphen; elsewhere Alt with
 * the same keys, since Ctrl+= and Ctrl+- zoom.
 */
function scriptHotkeys(kind) {
  const key = kind === 'sup' ? '=' : '-';
  return Platform.isMacOS ? [{ modifiers: ['Mod', 'Ctrl'], key }] : [{ modifiers: ['Alt'], key }];
}

Scripts.settingKey = 'scripts';

