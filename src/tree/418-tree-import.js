/* ------------------------------------------------------------------ */
/* Tree: maps read from OPML, FreeMind and a note's headings           */
/*                                                                    */
/* An outline's XML read by a small reader of its own — elements,      */
/* attributes, text, the five named entities and numbered ones; no     */
/* DTDs. OPML's outlines become nodes, their _note their details; a    */
/* FreeMind map's nodes, their notes and folds; a note's headings, the */
/* branches under it. Several at the top get a root of their own. Pure.*/
/* ------------------------------------------------------------------ */

import { newNode, treeModel } from './400-tree-model.js';
import { outlineFromMarkdown } from './408-tree-notes.js';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Text with its entities read. */
export function xmlText(text) {
  return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return e in NAMED ? NAMED[e] : all;
  });
}

/** XML as elements: { name, attrs, children: [elements], text }. The document's top element, or null. */
export function parseXml(source) {
  const s = String(source || '');
  const top = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [top];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const here = stack[stack.length - 1];
    if (lt === -1) {
      here.text += xmlText(s.slice(i));
      break;
    }
    if (lt > i) here.text += xmlText(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      i = end === -1 ? s.length : end + 3;
    } else if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      here.text += s.slice(lt + 9, end === -1 ? s.length : end);
      i = end === -1 ? s.length : end + 3;
    } else if (s[lt + 1] === '?' || s[lt + 1] === '!') {
      const end = s.indexOf('>', lt);
      i = end === -1 ? s.length : end + 1;
    } else if (s[lt + 1] === '/') {
      const end = s.indexOf('>', lt);
      const name = s.slice(lt + 2, end).trim();
      // Closing the nearest open element of that name; a stray close is let be.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? s.length : end + 1;
    } else {
      const m = /^<([^\s/>]+)([^>]*?)(\/?)>/.exec(s.slice(lt));
      if (!m) {
        here.text += '<';
        i = lt + 1;
        continue;
      }
      const el = { name: m[1], attrs: {}, children: [], text: '' };
      const attr = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = attr.exec(m[2]))) el.attrs[a[1]] = xmlText(a[3] !== undefined ? a[3] : a[4]);
      here.children.push(el);
      if (!m[3]) stack.push(el);
      i = lt + m[0].length;
    }
  }
  return top.children.find((c) => c.name) || null;
}

function child(el, name) {
  return (el && el.children.find((c) => c.name.toLowerCase() === name)) || null;
}

/** A model from top items: one is the root; several, or none, get a root named `title`. */
function modelFromTops(tops, title) {
  const model = treeModel(title || '');
  if (tops.length === 1) {
    model.root = tops[0];
    return model;
  }
  model.root.virtual = true;
  tops.forEach((n) => {
    n.parent = model.root;
    model.root.children.push(n);
  });
  return model;
}

function hang(parent, kids) {
  kids.forEach((k) => {
    k.parent = parent;
    parent.children.push(k);
  });
  return parent;
}

/** An OPML outline as a map. Nodes keep attributes written by this plugin's own OPML. */
export function mapFromOpml(text, title) {
  const doc = parseXml(text);
  if (!doc || doc.name.toLowerCase() !== 'opml') throw new Error('Not an OPML outline');
  const body = child(doc, 'body');
  const read = (el) => {
    const words = String(el.attrs.text !== undefined ? el.attrs.text : el.attrs.title || '');
    const note = el.attrs._note ? `\n${el.attrs._note}` : '';
    let attrs = {};
    if (el.attrs._attrs) {
      try {
        const parsed = JSON.parse(el.attrs._attrs);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) attrs = parsed;
      } catch (err) {
        attrs = {};
      }
    }
    return hang(newNode(words + note, attrs), el.children.filter((c) => c.name.toLowerCase() === 'outline').map(read));
  };
  const head = child(doc, 'head');
  const named = head && child(head, 'title') ? child(head, 'title').text.trim() : '';
  return modelFromTops(body ? body.children.filter((c) => c.name.toLowerCase() === 'outline').map(read) : [], named || title);
}

/** HTML as plain lines: tags dropped, paragraphs and breaks as new lines. */
function plainHtml(el) {
  const out = [];
  const go = (e) => {
    if (/^(p|div|br|li|h[1-6])$/i.test(e.name) && out.length && !out[out.length - 1].endsWith('\n')) out.push('\n');
    out.push(e.text);
    e.children.forEach(go);
  };
  go(el);
  return out.join('').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}

/** A FreeMind (.mm) map as a map: its nodes, their notes as details, folded ones folded. */
export function mapFromFreeMind(text, title) {
  const doc = parseXml(text);
  if (!doc || doc.name.toLowerCase() !== 'map') throw new Error('Not a FreeMind map');
  const read = (el) => {
    const rich = el.children.filter((c) => c.name.toLowerCase() === 'richcontent');
    const own = rich.find((r) => String(r.attrs.TYPE || '').toUpperCase() === 'NODE');
    const note = rich.find((r) => String(r.attrs.TYPE || '').toUpperCase() === 'NOTE');
    const words = el.attrs.TEXT !== undefined ? el.attrs.TEXT : own ? plainHtml(own) : el.attrs.LOCALIZED_TEXT || '';
    const details = note ? plainHtml(note) : '';
    const n = newNode(String(words).replace(/\r?\n/g, ' ') + (details ? `\n${details}` : ''));
    const kids = el.children.filter((c) => c.name.toLowerCase() === 'node').map(read);
    if (String(el.attrs.FOLDED).toLowerCase() === 'true' && kids.length) n.attrs.fold = 1;
    return hang(n, kids);
  };
  return modelFromTops(doc.children.filter((c) => c.name.toLowerCase() === 'node').map(read), title);
}

/** A note's headings — or its list, with none — as a map, the note's name at the root when it has several at the top. */
export function mapFromHeadings(markdown, title) {
  const build = (items) => items.map((it) => hang(newNode(it.text), build(it.children || [])));
  return modelFromTops(build(outlineFromMarkdown(markdown)), title);
}
