/* ------------------------------------------------------------------ */
/* Footnotes in place                                                  */
/*                                                                     */
/* A citation shouldn't mean leaving the sentence. Add footnote opens  */
/* a small box at the cursor: the citation's typed there, the number   */
/* goes in where the cursor was and the citation to the end of the     */
/* note, and writing carries on. On a footnote already there, the same */
/* box shows its text, to change or remove.                            */
/*                                                                     */
/* Numbers are kept in the order footnotes appear: one added between   */
/* 1 and 2 becomes 2, and what was 2 becomes 3, in the text and at the */
/* end alike, where the citations are listed in that order. Named      */
/* footnotes ([^smith]) keep their names. A citation whose number was  */
/* taken out of the text by hand is kept, numbered last — it may be on */
/* its way somewhere else — until Put footnotes in order clears it.    */
/*                                                                     */
/* Everything is worked out from the note's text by the functions      */
/* here, and made as one change: one undo puts it all back.            */
/* ------------------------------------------------------------------ */

const FOOTNOTE_REF = /\[\^([^\s\]^[]+)\]/g;
const FOOTNOTE_DEF = /^ {0,3}\[\^([^\s\]^[]+)\]:[ \t]?/;

function isFootnoteNumber(label) {
  return /^\d+$/.test(label);
}

/**
 * The footnotes in a note: each reference [^n] in the text, and each
 * definition "[^n]: …" with the lines that continue it. Not in the
 * properties, in code or in inline code; not a definition's own label.
 */
function scanFootnotes(text) {
  const refs = [];
  const defs = [];
  const lines = [];
  let pos = 0;
  text.split('\n').forEach((line) => {
    lines.push({ from: pos, to: pos + line.length, text: line });
    pos += line.length + 1;
  });

  const findRefs = (line, start) => {
    // Inline code, blanked out so its brackets aren't read.
    const masked = line.text.replace(/(`+)[^`]*?\1/g, (s) => ' '.repeat(s.length));
    FOOTNOTE_REF.lastIndex = 0;
    let m;
    while ((m = FOOTNOTE_REF.exec(masked))) {
      if (m.index < start || masked[m.index - 1] === '\\') continue;
      refs.push({ label: m[1], from: line.from + m.index, to: line.from + m.index + m[0].length });
    }
  };

  let i = 0;
  if (lines.length && /^---\s*$/.test(lines[0].text)) {
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[j].text)) {
        i = j + 1;
        break;
      }
    }
  }

  let fence = null;
  let def = null;
  const close = () => {
    if (def) defs.push(def);
    def = null;
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.text;
    if (fence) {
      const end = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(t);
      if (end && end[1][0] === fence[0] && end[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(t);
    if (open) {
      close();
      fence = open[1];
      continue;
    }
    if (def) {
      if (!t.trim()) continue;
      if (/^( {4}|\t)/.test(t)) {
        def.to = line.to;
        findRefs(line, 0);
        continue;
      }
      close();
    }
    const m = FOOTNOTE_DEF.exec(t);
    if (m) {
      const labelFrom = line.from + t.indexOf('[^') + 2;
      def = {
        label: m[1],
        lineFrom: line.from,
        labelFrom,
        labelTo: labelFrom + m[1].length,
        bodyFrom: line.from + m[0].length,
        to: line.to,
      };
      findRefs(line, m[0].length);
      continue;
    }
    findRefs(line, 0);
  }
  close();
  return { refs, defs };
}

/** A definition's text, as typed: its continuation lines unindented. */
function footnoteBody(text, def) {
  return text
    .slice(def.bodyFrom, def.to)
    .split('\n')
    .map((line, i) => (i ? line.replace(/^( {1,4}|\t)/, '') : line))
    .join('\n')
    .trim();
}

/** Text as a definition's body: lines after the first indented, blank ones left blank. */
function footnoteText(body) {
  return String(body || '')
    .trim()
    .split('\n')
    .map((line, i) => (i && line.trim() ? '    ' + line : line.trimEnd()))
    .join('\n');
}

/**
 * The definitions that end the note: those after which there's nothing
 * but other definitions and blank lines. The list kept in order.
 */
function trailingFootnotes(text, defs) {
  let k = defs.length;
  let end = text.length;
  while (k > 0) {
    const def = defs[k - 1];
    if (text.slice(def.to, end).trim()) break;
    end = def.lineFrom;
    k--;
  }
  return defs.slice(k);
}

/**
 * What to change in a note's text to add, change, remove or tidy
 * footnotes, as changes to the text as it is ({ from, to, insert },
 * in order, none overlapping), and where the cursor goes after.
 *
 * op: { type: 'add', at, body } — a footnote at `at`
 *     { type: 'edit', label, body } — a footnote's text
 *     { type: 'remove', from, to, label } — the reference there
 *     { type: 'tidy' } — renumbered, and unused ones taken out
 * opts: { renumber (default true), cursor }
 */
function planFootnotes(text, op, opts) {
  const renumber = !opts || opts.renumber !== false;
  const cursor = opts && typeof opts.cursor === 'number' ? opts.cursor : null;
  const { refs, defs } = scanFootnotes(text);
  const NEW = '\u0000new';

  const removing = (r) =>
    op.type === 'remove' && (op.all ? r.label === op.label : r.from === op.from && r.to === op.to);
  const present = refs.filter((r) => !removing(r)).map((r) => ({ label: r.label, pos: r.from }));
  if (op.type === 'add') present.push({ label: NEW, pos: op.at, first: true });
  present.sort((a, b) => a.pos - b.pos || (a.first ? -1 : b.first ? 1 : 0));

  // New numbers, in the order the footnotes first appear.
  const map = new Map();
  const firstAt = new Map();
  let n = 0;
  present.forEach((r, i) => {
    if (!firstAt.has(r.label)) firstAt.set(r.label, i);
    if (renumber && !map.has(r.label) && (r.label === NEW || isFootnoteNumber(r.label))) map.set(r.label, String(++n));
  });
  if (!renumber && op.type === 'add') {
    const numbers = refs.concat(defs).map((x) => x.label).filter(isFootnoteNumber).map(Number);
    map.set(NEW, String(Math.max(0, ...numbers) + 1));
  }

  // Citations no reference uses: cleared on tidying, and the removed
  // reference's own; otherwise kept, numbered last.
  const used = new Set(present.map((r) => r.label));
  const drop = new Set();
  defs.forEach((d) => {
    if (used.has(d.label)) return;
    if (op.type === 'tidy' || (op.type === 'remove' && d.label === op.label)) {
      drop.add(d);
      return;
    }
    if (renumber && isFootnoteNumber(d.label) && !map.has(d.label)) map.set(d.label, String(++n));
  });
  const relabel = (label) => (map.has(label) ? map.get(label) : label);
  const newLabel = op.type === 'add' ? map.get(NEW) : null;

  const trailing = trailingFootnotes(text, defs);
  // The list at the end is rewritten in order — unless the cursor is in
  // it, or numbers aren't being kept in order.
  const rebuild =
    renumber && trailing.length > 0 && !(op.type === 'add' && op.at >= trailing[0].lineFrom);
  const blockFrom = rebuild ? trailing[0].lineFrom : text.length;
  const inBlock = new Set(rebuild ? trailing : []);

  const changes = [];
  const replaced = [];
  const replace = (from, to, insert) => {
    changes.push({ from, to, insert });
    replaced.push([from, to]);
  };
  const within = (pos) => replaced.some(([a, b]) => pos >= a && pos < b);

  // The same edits, made to a stretch of the text on its own.
  const local = (from, to, inner) => {
    let out = '';
    let at = from;
    inner
      .filter((c) => c.from >= from && c.to <= to)
      .sort((a, b) => a.from - b.from)
      .forEach((c) => {
        out += text.slice(at, c.from) + c.insert;
        at = c.to;
      });
    return out + text.slice(at, to);
  };
  const refEdits = (from, to) =>
    refs
      .filter((r) => r.from >= from && r.to <= to)
      .map((r) =>
        removing(r)
          ? { from: r.from, to: r.to, insert: '' }
          : { from: r.from + 2, to: r.to - 1, insert: relabel(r.label) }
      );

  let edited = false;
  const editing = (d) => op.type === 'edit' && d.label === op.label && !edited && (edited = true);

  // Definitions outside the list at the end: changed where they are.
  defs.forEach((d) => {
    if (inBlock.has(d)) return;
    if (drop.has(d)) {
      replace(d.lineFrom, Math.min(d.to + 1, text.length), '');
    } else if (editing(d)) {
      replace(d.bodyFrom, d.to, footnoteText(op.body));
    }
  });

  // The list at the end, in order.
  let added = false;
  if (rebuild) {
    const entries = trailing
      .filter((d) => !drop.has(d))
      .map((d, i) => {
        const body = editing(d)
          ? footnoteText(op.body)
          : local(d.bodyFrom, d.to, refEdits(d.bodyFrom, d.to));
        return {
          line: `${text.slice(d.lineFrom, d.labelFrom)}${relabel(d.label)}${text.slice(d.labelTo, d.bodyFrom)}${body}`,
          order: firstAt.has(d.label) ? firstAt.get(d.label) : Infinity,
          i,
        };
      });
    if (op.type === 'add') {
      entries.push({ line: `[^${newLabel}]: ${footnoteText(op.body)}`, order: firstAt.get(NEW), i: -1 });
      added = true;
    } else if (op.type === 'edit' && !edited) {
      entries.push({ line: `[^${op.label}]: ${footnoteText(op.body)}`, order: firstAt.get(op.label), i: -1 });
      edited = true;
    }
    entries.sort((a, b) => a.order - b.order || a.i - b.i);
    if (entries.length) {
      replace(blockFrom, text.length, entries.map((e) => e.line).join('\n') + '\n');
    } else {
      // Nothing left to list: the blank lines before it go too.
      let from = blockFrom;
      while (from > 0 && /\s/.test(text[from - 1])) from--;
      replace(from, text.length, from > 0 ? '\n' : '');
    }
  }

  // A citation with no list to join starts one at the end.
  const append = (line) => {
    const tail = text.match(/\n*$/)[0].length;
    const lead = !text.length ? '' : trailing.length ? (tail ? '' : '\n') : '\n'.repeat(Math.max(0, 2 - tail));
    changes.push({ from: text.length, to: text.length, insert: lead + line + '\n' });
  };
  if (op.type === 'add' && !added) append(`[^${newLabel}]: ${footnoteText(op.body)}`);
  if (op.type === 'edit' && !edited) append(`[^${op.label}]: ${footnoteText(op.body)}`);

  // Labels and references everywhere else.
  defs.forEach((d) => {
    if (inBlock.has(d) || drop.has(d) || within(d.labelFrom)) return;
    const label = relabel(d.label);
    if (label !== d.label) changes.push({ from: d.labelFrom, to: d.labelTo, insert: label });
  });
  refs.forEach((r) => {
    if (within(r.from) || (rebuild && r.from >= blockFrom)) return;
    if (removing(r)) {
      changes.push({ from: r.from, to: r.to, insert: '' });
      return;
    }
    const label = relabel(r.label);
    if (label !== r.label) changes.push({ from: r.from + 2, to: r.to - 1, insert: label });
  });
  const refText = op.type === 'add' ? `[^${newLabel}]` : '';
  if (op.type === 'add') changes.push({ from: op.at, to: op.at, insert: refText, isNew: true });

  changes.sort((a, b) => a.from - b.from || (a.isNew ? -1 : b.isNew ? 1 : 0));

  // Where a position ends up once all that's done.
  const mapPos = (pos) => {
    let delta = 0;
    for (const c of changes) {
      if (c.isNew) continue;
      if (c.to <= pos && !(c.from === pos && c.to === pos)) delta += c.insert.length - (c.to - c.from);
      else if (c.from < pos && pos < c.to) return c.from + delta;
    }
    return pos + delta;
  };
  let after = null;
  if (op.type === 'add') after = mapPos(op.at) + refText.length;
  else if (op.type === 'remove' && !op.all) after = mapPos(op.from);
  else if (cursor !== null) after = mapPos(cursor);

  return {
    changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })),
    cursor: after,
    label: newLabel,
    removed: drop.size,
  };
}

/** The changes made, as text: for tests, and for checking a plan before it's used. */
function applyFootnoteChanges(text, changes) {
  let out = '';
  let at = 0;
  changes.forEach((c) => {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  });
  return out + text.slice(at);
}

/** The reference at or just before a position, if there's one. */
function footnoteAt(text, pos) {
  return scanFootnotes(text).refs.find((r) => pos >= r.from && pos <= r.to) || null;
}

/* -- the citations, kept off the page ------------------------------ */

const FOOTNOTES_VIEW = 'design-redux-footnotes';

/**
 * The stretches of a note its citations take up, as whole lines: each
 * definition with the lines continuing it, and the blank lines before
 * the list at the end, so hiding it leaves no gap.
 */
const footnoteRangeCache = new WeakMap();
function footnoteDefRanges(text, key) {
  if (key && footnoteRangeCache.has(key)) return footnoteRangeCache.get(key);
  const { defs } = scanFootnotes(text);
  const trailing = trailingFootnotes(text, defs);
  const ranges = [];
  defs.forEach((d) => {
    if (trailing.indexOf(d) === -1) ranges.push([d.lineFrom, d.to]);
  });
  if (trailing.length) {
    let from = trailing[0].lineFrom;
    // Back over the blank lines before it, a line at a time.
    while (from > 0) {
      const start = text.lastIndexOf('\n', from - 2) + 1;
      if (text.slice(start, from - 1).trim() || start === from) break;
      from = start;
    }
    ranges.push([from, text.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (key) footnoteRangeCache.set(key, ranges);
  return ranges;
}

/**
 * In Live Preview, the citations out of sight — the numbers stay in the
 * text, and the Footnotes view lists what they cite. Brought back while
 * the cursor is in them, so they can still be reached and edited.
 */
function footnoteHider(isOn) {
  const build = (state) => {
    if (!isOn() || !scriptLivePreview(state)) return Decoration.none;
    const ranges = footnoteDefRanges(state.doc.toString(), state.doc);
    if (!ranges.length) return Decoration.none;
    const sel = state.selection.ranges;
    const builder = new RangeSetBuilder();
    ranges.forEach(([from, to]) => {
      if (to <= from || sel.some((r) => r.to >= from && r.from <= to)) return;
      builder.add(from, to, Decoration.replace({ block: true }));
    });
    return builder.finish();
  };
  return StateField.define({
    create: build,
    update(value, tr) {
      if (tr.docChanged || tr.selection || scriptLivePreview(tr.startState) !== scriptLivePreview(tr.state)) {
        return build(tr.state);
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

/** A citation's text, drawn as the note would draw it, or as plain text. */
function renderCitation(app, text, el, sourcePath, component) {
  try {
    if (MarkdownRenderer && typeof MarkdownRenderer.render === 'function') {
      MarkdownRenderer.render(app, text, el, sourcePath, component);
      return;
    }
    if (MarkdownRenderer && typeof MarkdownRenderer.renderMarkdown === 'function') {
      MarkdownRenderer.renderMarkdown(text, el, sourcePath, component);
      return;
    }
  } catch (err) {
    /* plain text, below */
  }
  el.setText(text);
}

/**
 * The note's footnotes, in a view of their own beside it: each number,
 * what it cites, and the sentence it's in. A footnote opens where it's
 * cited; its citation is changed or removed right here.
 */
class FootnotesView extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
    this.plugin = feature.plugin;
    this.file = null;
    this.timer = 0;
    this.editing = null;
  }

  getViewType() {
    return FOOTNOTES_VIEW;
  }

  getDisplayText() {
    return 'Footnotes';
  }

  getIcon() {
    return 'file-signature';
  }

  async onOpen() {
    this.containerEl.addClass('dr-fn-view');
    const queue = () => this.queue();
    this.registerEvent(this.app.workspace.on('active-leaf-change', queue));
    this.registerEvent(this.app.workspace.on('file-open', queue));
    this.registerEvent(this.app.workspace.on('editor-change', queue));
    this.registerEvent(this.app.metadataCache.on('changed', queue));
    this.render();
  }

  async onClose() {
    window.clearTimeout(this.timer);
  }

  queue() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), 200);
  }

  /** The note followed: the one in use, or, while this view is, the one last in use. */
  noteView() {
    const ws = this.app.workspace;
    const active = ws.getActiveViewOfType(MarkdownView);
    if (active && active.file) {
      this.markdownLeaf = active.leaf;
      return active;
    }
    const kept = this.markdownLeaf;
    if (kept && kept.view instanceof MarkdownView && kept.view.file && kept.parent) return kept.view;
    const leaf = typeof ws.getMostRecentLeaf === 'function' ? ws.getMostRecentLeaf() : null;
    return leaf && leaf.view instanceof MarkdownView && leaf.view.file ? leaf.view : null;
  }

  textOf(view) {
    try {
      return view.editor ? view.editor.getValue() : view.data || '';
    } catch (err) {
      return view.data || '';
    }
  }

  render(highlight) {
    if (this.editing) return;
    const root = this.contentEl;
    root.empty();
    const view = this.noteView();
    if (!view) {
      root.createDiv({ cls: 'dr-fn-view-empty', text: 'Open a note to see its footnotes.' });
      return;
    }
    const text = this.textOf(view);
    const { refs, defs } = scanFootnotes(text);
    const labels = [];
    refs.forEach((r) => labels.indexOf(r.label) === -1 && labels.push(r.label));
    defs.forEach((d) => labels.indexOf(d.label) === -1 && labels.push(d.label));

    const head = root.createDiv({ cls: 'dr-fn-view-head' });
    head.createDiv({ cls: 'dr-fn-view-note', text: view.file.basename });
    const tools = head.createDiv({ cls: 'dr-fn-view-tools' });
    const tool = (icon, label, run) => {
      const el = tools.createDiv({ cls: 'clickable-icon' });
      el.setAttribute('aria-label', label);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      setIcon(el, icon);
      onActivate(el, run);
    };
    tool('plus', 'Add footnote at the cursor', () => this.addAtCursor(view));
    if (labels.length) tool('list-ordered', 'Put footnotes in order', () => this.apply(view, { type: 'tidy' }, true));

    if (!labels.length) {
      root.createDiv({ cls: 'dr-fn-view-empty', text: 'No footnotes in this note.' });
      return;
    }

    const list = root.createDiv({ cls: 'dr-fn-list' });
    labels.forEach((label) => {
      const def = defs.find((d) => d.label === label);
      const ref = refs.find((r) => r.label === label);
      const item = list.createDiv({ cls: 'dr-fn-item' });
      item.dataset.label = label;
      if (!ref) item.addClass('is-unused');
      if (highlight === label) item.addClass('is-highlighted');

      const top = item.createDiv({ cls: 'dr-fn-item-top' });
      top.createSpan({ cls: 'dr-fn-num', text: label });
      const body = top.createDiv({ cls: 'dr-fn-item-body' });
      if (def) renderCitation(this.app, footnoteBody(text, def), body, view.file.path, this);
      else body.createSpan({ cls: 'dr-fn-missing', text: 'No citation yet' });

      const actions = top.createDiv({ cls: 'dr-fn-item-actions' });
      const act = (icon, title, run) => {
        const el = actions.createDiv({ cls: 'clickable-icon' });
        el.setAttribute('aria-label', title);
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        setIcon(el, icon);
        onActivate(el, (evt) => {
          if (evt && evt.stopPropagation) evt.stopPropagation();
          run();
        });
      };
      act('pencil', 'Change', () => this.edit(item, body, view, label, def ? footnoteBody(text, def) : ''));
      act('trash-2', 'Remove', () => this.apply(view, { type: 'remove', label, all: true }));

      // Where it's cited: the words just before the number.
      const where = item.createDiv({ cls: 'dr-fn-where' });
      if (ref) {
        const before = text.slice(Math.max(0, ref.from - 90), ref.from).split('\n').pop();
        const words = before.replace(/\[\^[^\]]*\]/g, '').trim();
        where.setText(words ? `…${words.slice(-70)}` : 'At the start of a line');
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        onActivate(item, () => this.reveal(view, ref));
      } else {
        where.setText('Not cited in the text');
      }
    });
    if (highlight) {
      const hit = list.querySelector('.dr-fn-item.is-highlighted');
      if (hit && typeof hit.scrollIntoView === 'function') hit.scrollIntoView({ block: 'nearest' });
    }
  }

  /** The reference in the note, selected and in view. */
  reveal(view, ref) {
    const leaf = view.leaf;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const editor = view.editor;
    if (!editor || (typeof view.getMode === 'function' && view.getMode() !== 'source')) return;
    const from = editor.offsetToPos(ref.from);
    const to = editor.offsetToPos(ref.to);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    editor.focus();
  }

  addAtCursor(view) {
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
    if (typeof view.getMode === 'function' && view.getMode() !== 'source') {
      new Notice('Switch to editing to add a footnote at the cursor.');
      return;
    }
    const cm = view.editor && view.editor.cm;
    if (cm && cm.state) this.feature.openBox(cm);
  }

  /** The citation as a field in place: Enter keeps it, Shift+Enter a new line, Escape leaves it. */
  edit(item, body, view, label, current) {
    if (this.editing) return;
    this.editing = label;
    body.empty();
    const input = body.createEl('textarea', { cls: 'dr-fn-input' });
    input.value = current;
    input.rows = Math.max(2, current.split('\n').length);
    item.addClass('is-editing');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      this.editing = null;
      const value = input.value;
      if (keep && value.trim() !== current.trim()) this.apply(view, { type: 'edit', label, body: value });
      else this.render();
    };
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        finish(true);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  /**
   * A change to the note's footnotes: through its editor where it has
   * one, so it can be undone there; otherwise to the file.
   */
  async apply(view, op, say) {
    const renumber = op.type === 'tidy' ? true : this.feature.renumber;
    const cm = view.editor && view.editor.cm;
    if (cm && cm.state && typeof cm.dispatch === 'function') {
      const plan = planFootnotes(cm.state.doc.toString(), op, { renumber, cursor: cm.state.selection.main.head });
      if (plan.changes.length) this.feature.dispatch(cm, plan);
      if (say) this.say(plan);
    } else if (view.file) {
      let plan = null;
      await this.app.vault.process(view.file, (text) => {
        plan = planFootnotes(text, op, { renumber });
        return applyFootnoteChanges(text, plan.changes);
      });
      if (say && plan) this.say(plan);
    }
    this.render();
  }

  say(plan) {
    if (!plan.changes.length) new Notice('The footnotes are already in order.');
    else if (plan.removed) new Notice(`Footnotes put in order, and ${plan.removed === 1 ? 'one no longer used' : `${plan.removed} no longer used`} taken out.`);
    else new Notice('Footnotes put in order.');
  }
}

/* -- the box ------------------------------------------------------- */

/**
 * A small box by the cursor to type a footnote in. Enter keeps it,
 * Shift+Enter starts a new line, Escape leaves it as it was. Clicking
 * away keeps what was typed rather than lose it.
 */
class FootnoteBox {
  constructor(feature, cm, spec) {
    this.feature = feature;
    this.cm = cm;
    this.spec = spec;
    this.done = false;
  }

  open() {
    const doc = this.cm.dom.ownerDocument;
    const win = doc.defaultView || window;
    const spec = this.spec;
    const box = (this.el = doc.body.createDiv({ cls: 'dr-fn-box' }));
    if (Platform.isMobile) box.addClass('is-mobile');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', spec.mode === 'edit' ? 'Footnote' : 'Add footnote');

    const head = box.createDiv({ cls: 'dr-fn-head' });
    head.createSpan({ cls: 'dr-fn-num', text: spec.label || '' });
    head.createSpan({ text: spec.mode === 'edit' ? 'Footnote' : 'New footnote' });

    const input = (this.input = box.createEl('textarea', { cls: 'dr-fn-input' }));
    input.rows = 1;
    input.placeholder = 'Citation or note';
    input.value = spec.body || '';
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        this.finish(true);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        this.finish(false);
      }
    });

    const foot = box.createDiv({ cls: 'dr-fn-foot' });
    foot.createDiv({
      cls: 'dr-fn-hint',
      text: Platform.isMobile ? '' : `↵ ${spec.mode === 'edit' ? 'save' : 'add'} · ⇧↵ new line · esc cancel`,
    });
    const buttons = foot.createDiv({ cls: 'dr-fn-buttons' });
    if (spec.mode === 'edit') {
      const remove = buttons.createEl('button', { cls: 'mod-warning', text: 'Remove' });
      remove.addEventListener('click', () => this.finish('remove'));
    }
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.finish(false));
    const keep = buttons.createEl('button', { cls: 'mod-cta', text: spec.mode === 'edit' ? 'Save' : 'Add' });
    keep.addEventListener('click', () => this.finish(true));

    // Clicking elsewhere keeps what was typed.
    this.outside = (evt) => {
      if (!box.contains(evt.target)) this.finish(input.value.trim() !== (spec.body || '').trim() ? true : false);
    };
    doc.addEventListener('mousedown', this.outside, true);
    doc.addEventListener('touchstart', this.outside, true);
    this.doc = doc;

    this.place(win);
    grow();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** Under the cursor's line, or above it where there's no room below. */
  place(win) {
    const box = this.el;
    if (Platform.isMobile) return;
    let coords = null;
    try {
      coords = this.cm.coordsAtPos(this.spec.at);
    } catch (err) {
      coords = null;
    }
    const rect = coords || this.cm.dom.getBoundingClientRect();
    const width = box.offsetWidth || 420;
    const height = box.offsetHeight || 120;
    const left = Math.max(12, Math.min(rect.left - 24, win.innerWidth - width - 12));
    let top = (coords ? coords.bottom : rect.top + 40) + 8;
    if (top + height > win.innerHeight - 12) top = Math.max(12, (coords ? coords.top : rect.top) - height - 8);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  finish(keep) {
    if (this.done) return;
    this.done = true;
    const text = this.input.value;
    this.doc.removeEventListener('mousedown', this.outside, true);
    this.doc.removeEventListener('touchstart', this.outside, true);
    this.el.remove();
    this.feature.box = null;
    this.feature.settle(this.cm, this.spec, keep, text);
  }
}

class Footnotes extends Feature {
  settingsSchema() {
    return [
      {
        key: 'footnotes',
        name: 'Footnotes in place',
        desc: 'Add footnote (a command, and in the editor’s right-click menu) opens a box at the cursor: type the citation, and the number goes in there and the citation at the end of the note while you carry on writing. On a footnote, it opens that one to change or remove.',
      },
      {
        key: 'footnotesAside',
        showIf: 'footnotes',
        name: 'Footnotes in their own view',
        desc: 'Keep the citations at the end of a note off the page, and list them in a Footnotes view in the sidebar — open from the footnote button along the bottom, or the command. The numbers stay in the text; a citation shows again while the cursor is in it.',
      },
      {
        key: 'footnoteOrder',
        showIf: 'footnotes',
        name: 'Keep footnotes numbered in order',
        desc: 'Adding or removing one renumbers the rest by where they appear, and lists the citations at the end in that order. Put footnotes in order does it for a whole note, and clears citations no longer used.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'add-footnote',
        name: 'Add footnote',
        icon: 'file-signature',
        check: () => this.enabled && !!this.editorView(),
        run: () => this.openBox(this.editorView()),
      },
      {
        id: 'show-footnotes',
        name: 'Show footnotes',
        icon: 'file-signature',
        check: () => this.enabled,
        run: () => this.showView(),
      },
      {
        id: 'tidy-footnotes',
        name: 'Put footnotes in order',
        icon: 'list-ordered',
        check: () => this.enabled && !!this.editorView(),
        run: () => this.tidy(this.editorView()),
      },
    ];
  }

  /** The editor of the note being edited, if one is. */
  editorView() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || (typeof view.getMode === 'function' && view.getMode() !== 'source')) return null;
    const cm = view.editor && view.editor.cm;
    return cm && cm.state && typeof cm.dispatch === 'function' ? cm : null;
  }

  registerTypes() {
    this.extensions = [];
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerView(FOOTNOTES_VIEW, (leaf) => new FootnotesView(leaf, this));
  }

  get aside() {
    return this.enabled && this.settings.footnotesAside !== false;
  }

  enable() {
    this.applyAside();
  }

  /** The citations off the page, or back on it, as the setting says. */
  applyAside() {
    const on = this.aside;
    document.body.toggleClass('dr-footnotes-aside', on);
    if (this.asideOn === on || !this.extensions) return;
    this.asideOn = on;
    this.extensions.length = 0;
    if (on) this.extensions.push(footnoteHider(() => this.aside));
    this.app.workspace.updateOptions();
  }

  /** The Footnotes view in the right sidebar, opened if it isn't, and shown. */
  async showView(highlight) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(FOOTNOTES_VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: FOOTNOTES_VIEW, active: false });
    }
    ws.revealLeaf(leaf);
    if (leaf.view instanceof FootnotesView) leaf.view.render(highlight);
    return leaf;
  }

  /** How many footnotes a note has, from what Obsidian read of it. */
  countIn(file) {
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    return cache && Array.isArray(cache.footnotes) ? cache.footnotes.length : 0;
  }

  register() {
    // In reading view the list at the end is out of sight, so a number
    // clicked opens the view at its citation instead.
    this.plugin.registerDomEvent(
      document,
      'click',
      (evt) => {
        if (!this.aside) return;
        const target = evt.target;
        const link = target && typeof target.closest === 'function' ? target.closest('.markdown-reading-view sup.footnote-ref a, .markdown-reading-view a.footnote-link') : null;
        if (!link) return;
        evt.preventDefault();
        evt.stopPropagation();
        // Reading view numbers them in order, as the view does.
        const label = (link.textContent || '').replace(/[^\w-]/g, '');
        this.showView(label || undefined);
      },
      true
    );

    this.plugin.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        const cm = editor && editor.cm;
        if (!this.enabled || !cm || !cm.state || typeof cm.dispatch !== 'function') return;
        const text = cm.state.doc.toString();
        const hit = footnoteAt(text, cm.state.selection.main.head);
        const insert = findSubmenu(menu, 'Insert');
        const into = hit ? menu : insert || menu;
        into.addItem((item) => {
          item
            .setTitle(hit ? 'Change footnote' : insert ? 'Footnote here' : 'Add footnote')
            .setIcon('file-signature')
            .onClick(() => this.openBox(cm));
          if ((hit || !insert) && typeof item.setSection === 'function') item.setSection(hit ? 'action' : 'selection');
        });
      })
    );
  }

  disable() {
    if (this.box) this.box.finish(false);
    this.applyAside();
  }

  get renumber() {
    return this.settings.footnoteOrder !== false;
  }

  /**
   * The box, for the footnote under the cursor or a new one after it —
   * after the selection, if there is one: that's what's being cited.
   */
  openBox(cm) {
    if (!cm) return;
    if (this.box) this.box.finish(false);
    const text = cm.state.doc.toString();
    const range = cm.state.selection.main;
    const hit = footnoteAt(text, range.head);
    let spec;
    if (hit) {
      const def = scanFootnotes(text).defs.find((d) => d.label === hit.label);
      spec = {
        mode: 'edit',
        at: hit.from,
        ref: hit,
        label: hit.label,
        body: def ? footnoteBody(text, def) : '',
      };
    } else {
      // After what's selected, not after a space selected with it.
      let at = range.to;
      while (at > range.from && /\s/.test(text[at - 1])) at--;
      const plan = planFootnotes(text, { type: 'add', at, body: '' }, { renumber: this.renumber });
      spec = { mode: 'add', at, label: plan.label, body: '' };
    }
    spec.doc = cm.state.doc;
    this.box = new FootnoteBox(this, cm, spec);
    this.box.open();
  }

  /** What the box was left with, made into one change to the note. */
  settle(cm, spec, keep, body) {
    const focus = () => {
      if (typeof cm.focus === 'function') cm.focus();
    };
    if (!keep || (keep === true && !body.trim() && spec.mode === 'add')) {
      focus();
      return;
    }
    const text = cm.state.doc.toString();
    // The note changed while the box was open (synced, say): the box's
    // place is looked for again.
    let at = spec.at;
    let ref = spec.ref;
    if (cm.state.doc !== spec.doc) {
      at = Math.min(cm.state.selection.main.to, text.length);
      if (ref) ref = footnoteAt(text, at) || footnoteAt(text, cm.state.selection.main.head);
      if (spec.mode === 'edit' && !ref) {
        focus();
        return;
      }
    }
    let op;
    if (keep === 'remove') op = { type: 'remove', from: ref.from, to: ref.to, label: ref.label };
    else if (spec.mode === 'edit') op = { type: 'edit', label: ref.label, body };
    else op = { type: 'add', at, body };
    const plan = planFootnotes(text, op, { renumber: this.renumber, cursor: cm.state.selection.main.head });
    this.dispatch(cm, plan);
    focus();
  }

  tidy(cm) {
    if (!cm) return;
    const text = cm.state.doc.toString();
    const plan = planFootnotes(text, { type: 'tidy' }, { renumber: true, cursor: cm.state.selection.main.head });
    if (!plan.changes.length || applyFootnoteChanges(text, plan.changes) === text) {
      new Notice('The footnotes are already in order.');
      return;
    }
    this.dispatch(cm, plan);
    new Notice(
      plan.removed
        ? `Footnotes put in order, and ${plan.removed === 1 ? 'one no longer used' : `${plan.removed} no longer used`} taken out.`
        : 'Footnotes put in order.'
    );
  }

  dispatch(cm, plan) {
    if (!plan.changes.length) return;
    const spec = { changes: plan.changes, scrollIntoView: true, userEvent: 'input' };
    if (plan.cursor !== null && plan.cursor !== undefined) spec.selection = { anchor: plan.cursor };
    cm.dispatch(spec);
  }
}

Footnotes.settingKey = 'footnotes';
