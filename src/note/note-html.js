/* ------------------------------------------------------------------ */
/* The HTML a note holds                                               */
/*                                                                     */
/* Markdown leaves out some of what HTML can say; a note may say it    */
/* with the tags, and the commands write them, round the selection or  */
/* at the cursor, and take them off again. Nothing is drawn but what   */
/* the note says.                                                      */
/*   Superscript and subscript: x^2^ and H~2~O (Pandoc's spelling) or  */
/*     <sup> and <sub>; in reading view the short spelling is raised    */
/*     and lowered.                                                    */
/*   A disclosure: <details>, its first line the <summary>.            */
/*   A heading group: <hgroup>, a heading and the line under it.       */
/*   A progress bar: <progress value max>, set by the person: in       */
/*     reading view with the arrows, Home, End or a press along it,    */
/*     the value written back into the text; in the editor, stepped.  */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';


export const SCRIPT_MARKS = {
  sup: { short: ['^', '^'], tags: ['<sup>', '</sup>'] },
  sub: { short: ['~', '~'], tags: ['<sub>', '</sub>'] },
};

/** The short spellings in a line of text: [{ kind, from, to, text }]. ~~struck~~ is not a subscript. */
export function findScripts(text) {
  const out = [];
  const re = /\^([^\s^][^^\n]*?)\^|(^|[^~])~([^\s~][^~\n]*?)~(?!~)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) out.push({ kind: 'sup', from: m.index, to: m.index + m[0].length, text: m[1] });
    else out.push({ kind: 'sub', from: m.index + m[2].length, to: m.index + m[0].length, text: m[3] });
  }
  return out;
}

/** A selection with the marks put round it, or taken off if it has them (either spelling). */
export function toggleScript(selected, kind, syntax = 'short') {
  for (const [open, close] of Object.values(SCRIPT_MARKS[kind])) {
    if (selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close)) return selected.slice(open.length, selected.length - close.length);
  }
  const [open, close] = SCRIPT_MARKS[kind][syntax === 'tags' ? 'tags' : 'short'];
  return `${open}${selected}${close}`;
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (t) => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The selection folded under a summary (its first line, a heading's marks left off), or a disclosure opened back into its lines. */
export function toggleDetails(selected) {
  const m = /^\s*<details>\s*\n<summary>([\s\S]*?)<\/summary>\n?([\s\S]*?)\n?<\/details>\s*$/.exec(selected);
  if (m) return [unesc(m[1]), m[2].replace(/^\n+|\n+$/g, '')].filter((part, i) => i === 0 || part).join('\n');
  const lines = selected.replace(/\s+$/, '').split('\n');
  const summary = (lines[0] || '').replace(/^#{1,6}\s+/, '').trim() || 'More';
  const body = lines.slice(1).join('\n').replace(/^\n+|\n+$/g, '');
  // A blank line round the body: Markdown in it is still Markdown.
  return `<details>\n<summary>${esc(summary)}</summary>\n\n${body}\n\n</details>`;
}

/** A heading and the line under it as a heading group, or a group back into the two lines. Null when the first line is no heading. */
export function toggleHeadingGroup(text) {
  const m = /^<hgroup>\n<h([1-6])>([\s\S]*?)<\/h\1>\n<p>([\s\S]*?)<\/p>\n<\/hgroup>$/.exec(text.trim());
  if (m) return `${'#'.repeat(Number(m[1]))} ${unesc(m[2])}\n${unesc(m[3])}`;
  const [first, second = ''] = text.replace(/\s+$/, '').split('\n');
  const h = /^(#{1,6})\s+(.+)$/.exec(first || '');
  if (!h) return null;
  return `<hgroup>\n<h${h[1].length}>${esc(h[2].trim())}</h${h[1].length}>\n<p>${esc(second.trim())}</p>\n</hgroup>`;
}

const PROGRESS = /<progress\b[^>]*>/gi;
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*["']?([\\d.]+)`, 'i').exec(tag); return m ? Number(m[1]) : null; };

/** A progress bar's tag: its value and its most. */
export function progressTag(value = 0, max = 10) {
  return `<progress value="${value}" max="${max}"></progress>`;
}

/** The progress bars in a text, in order: [{ from, to, value, max }]. */
export function progressBars(text) {
  return Array.from(text.matchAll(PROGRESS)).map((m) => ({ from: m.index, to: m.index + m[0].length, value: attr(m[0], 'value') || 0, max: attr(m[0], 'max') || 1 }));
}

/** A value kept within a bar, on its steps (whole numbers, or hundredths of a bar that is one or less). */
export function clampProgress(value, max) {
  const step = max > 1 ? 1 : max / 100;
  return Number(Math.min(max, Math.max(0, Math.round(value / step) * step)).toFixed(6));
}

/** The text with its `index`th progress bar set to `value` (its own most kept). */
export function setProgress(text, index, value) {
  const bar = progressBars(text)[index];
  if (!bar) return text;
  const tag = text.slice(bar.from, bar.to);
  const v = clampProgress(value, bar.max);
  const next = /\bvalue\s*=/.test(tag) ? tag.replace(/\bvalue\s*=\s*["']?[\d.]*["']?/i, `value="${v}"`) : tag.replace(/^<progress\b/i, `<progress value="${v}"`);
  return text.slice(0, bar.from) + next + text.slice(bar.to);
}

export class NoteHtml extends Feature {
  register() {
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.on) return;
      this.render(el);
      this.controlBars(el, ctx);
    });
  }

  apply(editor, kind) {
    const selected = editor.getSelection();
    const out = toggleScript(selected, kind);
    editor.replaceSelection(out);
    if (!selected && typeof editor.setCursor === 'function') {
      const at = editor.getCursor();
      editor.setCursor({ line: at.line, ch: at.ch - SCRIPT_MARKS[kind].short[1].length });
    }
  }

  /** Reading view: the short spelling in a block's text raised and lowered. */
  render(root) {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, 4 /* text */);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement && n.parentElement.closest('code, pre, sup, sub, .math')) continue;
      nodes.push(n);
    }
    nodes.forEach((node) => {
      const text = node.nodeValue;
      const found = findScripts(text);
      if (!found.length) return;
      found.sort((a, b) => a.from - b.from);
      const frag = doc.createDocumentFragment();
      let at = 0;
      found.forEach((f) => {
        if (f.from < at) return;
        frag.appendChild(doc.createTextNode(text.slice(at, f.from)));
        const el = doc.createElement(f.kind);
        el.textContent = f.text;
        frag.appendChild(el);
        at = f.to;
      });
      frag.appendChild(doc.createTextNode(text.slice(at)));
      // A text node inside a block the plugin was handed to finish: replaced by the same text with its scripts raised.
      node.parentNode.replaceChild(frag, node);
    });
  }

  /**
   * Reading view: each progress bar a control the person sets, a slider to a screen reader. The
   * arrows step it, Home and End empty and fill it, a press along it sets it there; the value is
   * written into the note's text (the bar's place found from the block it is drawn in).
   */
  controlBars(root, ctx) {
    const bars = Array.from(root.querySelectorAll('progress'));
    if (!bars.length || !ctx || typeof ctx.getSectionInfo !== 'function') return;
    bars.forEach((bar, index) => {
      const max = Number(bar.max) || 1;
      bar.classList.add('dr-progress');
      bar.setAttribute('role', 'slider');
      bar.setAttribute('tabindex', '0');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(max));
      const show = (v) => { bar.value = v; bar.setAttribute('aria-valuenow', String(v)); };
      show(Number(bar.value) || 0);
      const set = (v) => {
        const next = clampProgress(v, max);
        if (next === Number(bar.value)) return;
        show(next);
        this.write(root, ctx, index, next);
      };
      const step = max > 1 ? 1 : max / 100;
      bar.addEventListener('keydown', (e) => {
        const to = { ArrowRight: bar.value + step, ArrowUp: bar.value + step, ArrowLeft: bar.value - step, ArrowDown: bar.value - step, Home: 0, End: max, PageUp: bar.value + max / 10, PageDown: bar.value - max / 10 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        set(to);
      });
      bar.addEventListener('click', (e) => {
        const box = bar.getBoundingClientRect();
        if (box.width) set(((e.clientX - box.left) / box.width) * max);
      });
      // A bar drawn again after its value was written takes the focus back, once Obsidian has put its block in
      // the page (it is handed over before; its lines are known only then).
      if (this.refocus && this.refocus.path === ctx.sourcePath && this.refocus.index === index) {
        const take = (tries) => {
          const info = bar.isConnected ? ctx.getSectionInfo(root) : null;
          if (!info) return void (tries && setTimeout(() => take(tries - 1), 50));
          if (this.refocus && this.refocus.line === info.lineStart) {
            this.refocus = null;
            bar.focus();
          }
        };
        take(20);
      }
    });
  }

  /** Writes a bar's value into the note: the `index`th progress tag of the block it is drawn from. Writes are gathered while the keys are held. */
  write(root, ctx, index, value) {
    const info = ctx.getSectionInfo(root);
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!info || !file) return;
    clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.refocus = { path: ctx.sourcePath, line: info.lineStart, index };
      this.plugin.notes.editText(file, (text) => {
        const lines = text.split('\n');
        const before = lines.slice(0, info.lineStart).join('\n').length + (info.lineStart ? 1 : 0);
        const block = lines.slice(info.lineStart, info.lineEnd + 1).join('\n');
        return text.slice(0, before) + setProgress(block, index, value) + text.slice(before + block.length);
      });
    }, 300);
  }

  /** The editor: the progress bar on the cursor's line stepped by `by`. */
  stepBar(editor, by) {
    const at = editor.getCursor();
    const line = editor.getLine(at.line);
    const bars = progressBars(line);
    if (!bars.length) return false;
    const index = Math.max(0, bars.findIndex((b) => at.ch <= b.to));
    const bar = bars[index];
    const step = bar.max > 1 ? 1 : bar.max / 100;
    editor.setLine(at.line, setProgress(line, index, bar.value + by * step));
    editor.setCursor(at);
    return true;
  }

  /** The editor: the selection (or the cursor's line) folded under a summary, or a disclosure opened again. */
  disclose(editor) {
    if (!editor.somethingSelected()) {
      const at = editor.getCursor();
      editor.setSelection({ line: at.line, ch: 0 }, { line: at.line, ch: editor.getLine(at.line).length });
    }
    editor.replaceSelection(toggleDetails(editor.getSelection()));
  }

  /** The editor: the heading at the cursor and the line under it as a group, or the group taken apart. */
  groupHeading(editor) {
    const at = editor.getCursor();
    const last = editor.lastLine();
    // Inside a group: the four lines it is written in, from its <hgroup>.
    for (let l = at.line; l >= Math.max(0, at.line - 3); l--) {
      if (editor.getLine(l).trim() === '<hgroup>' && l + 3 <= last) {
        const block = [0, 1, 2, 3].map((i) => editor.getLine(l + i)).join('\n');
        const back = toggleHeadingGroup(block);
        if (back && block.trim().startsWith('<hgroup>')) return void editor.replaceRange(back, { line: l, ch: 0 }, { line: l + 3, ch: editor.getLine(l + 3).length });
      }
    }
    const two = [editor.getLine(at.line), at.line < last ? editor.getLine(at.line + 1) : ''].join('\n');
    const group = toggleHeadingGroup(two);
    if (!group) return false;
    const end = at.line < last ? { line: at.line + 1, ch: editor.getLine(at.line + 1).length } : { line: at.line, ch: editor.getLine(at.line).length };
    editor.replaceRange(group, { line: at.line, ch: 0 }, end);
    return true;
  }

  actions() {
    const onHeading = (ctx) => /^#{1,6}\s+\S/.test(ctx.editor.getLine(ctx.editor.getCursor().line)) || /<hgroup>|<\/h[1-6]>|<\/?p>/.test(ctx.editor.getLine(ctx.editor.getCursor().line));
    const onBar = (ctx) => /<progress\b/i.test(ctx.editor.getLine(ctx.editor.getCursor().line));
    return [
      { id: 'superscript', name: 'Superscript', on: 'editor', menu: false, run: (ctx) => this.apply(ctx.editor, 'sup') },
      { id: 'subscript', name: 'Subscript', on: 'editor', menu: false, run: (ctx) => this.apply(ctx.editor, 'sub') },
      { id: 'disclose-selection', name: 'Fold the selection under a summary, or open it again', on: 'editor', menu: false, run: (ctx) => this.disclose(ctx.editor) },
      { id: 'group-heading', name: 'Group the heading with the line under it, or take the group apart', on: 'editor', menu: false, when: onHeading, run: (ctx) => this.groupHeading(ctx.editor) },
      { id: 'insert-progress', name: 'Insert a progress bar', on: 'editor', menu: false, run: (ctx) => ctx.editor.replaceSelection(progressTag()) },
      { id: 'progress-up', name: 'Step the progress bar up', on: 'editor', menu: false, when: onBar, run: (ctx) => this.stepBar(ctx.editor, 1) },
      { id: 'progress-down', name: 'Step the progress bar down', on: 'editor', menu: false, when: onBar, run: (ctx) => this.stepBar(ctx.editor, -1) },
    ];
  }
}
NoteHtml.title = 'HTML in a note';
NoteHtml.section = 'Notes';
NoteHtml.about = 'Superscript and subscript, a disclosure, a heading group and a progress bar the person sets.';
