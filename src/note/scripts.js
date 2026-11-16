/* ------------------------------------------------------------------ */
/* Superscript and subscript                                           */
/*                                                                     */
/* Markdown has neither. Two spellings are read: the short one Pandoc  */
/* uses — x^2^ and H~2~O — and the <sup> and <sub> tags. Two commands  */
/* put either round the selection or take it off again; in reading     */
/* view the short spelling is raised and lowered (the tags already     */
/* are). The note's text is only what was written.                     */
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

export class Scripts extends Feature {
  register() {
    this.plugin.registerMarkdownPostProcessor((el) => this.on && this.render(el));
  }

  apply(editor, kind) {
    const selected = editor.getSelection();
    const out = toggleScript(selected, kind, this.settings.scriptSyntax);
    editor.replaceSelection(out);
    if (!selected && typeof editor.setCursor === 'function') {
      const at = editor.getCursor();
      editor.setCursor({ line: at.line, ch: at.ch - SCRIPT_MARKS[kind][this.settings.scriptSyntax === 'tags' ? 'tags' : 'short'][1].length });
    }
  }

  /** Reading view: the short spelling in a block's text raised and lowered; with the setting on, 1st and 2nd too. */
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
      if (this.settings.autoOrdinals) Array.from(text.matchAll(/(\d)(st|nd|rd|th)\b/g)).forEach((m) => found.push({ kind: 'sup', from: m.index + 1, to: m.index + m[0].length, text: m[2] }));
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

  actions() {
    return [
      { id: 'superscript', name: 'Superscript', glyph: 'superscript', on: 'editor', menu: false, run: (ctx) => this.apply(ctx.editor, 'sup') },
      { id: 'subscript', name: 'Subscript', glyph: 'subscript', on: 'editor', menu: false, run: (ctx) => this.apply(ctx.editor, 'sub') },
    ];
  }

  settingsRows() {
    return [
      { key: 'scriptSyntax', name: 'Spelling', desc: 'What the commands write.', type: 'choice', options: { short: 'x^2^ and H~2~O', tags: '<sup> and <sub>' } },
      { key: 'autoOrdinals', name: 'Raise 1st, 2nd, 3rd', desc: 'In reading view.', type: 'toggle' },
    ];
  }
}
Scripts.key = 'scripts';
Scripts.title = 'Superscript and subscript';
Scripts.glyph = 'superscript';
Scripts.section = 'Notes';
Scripts.about = 'x^2^ and H~2~O, raised and lowered.';
