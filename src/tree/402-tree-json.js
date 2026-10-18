/* ------------------------------------------------------------------ */
/* Tree: a mind map as a .mindmap file                                 */
/*                                                                    */
/* The same tree as JSON, for maps that shouldn't look like notes:     */
/* each node its id, text and attributes, then its children; the free  */
/* nodes, the relations, the nudges and the last view. Written with a  */
/* fixed order of keys and two spaces of indent, so diffs stay small   */
/* and a file read and written unchanged is the same bytes.           */
/* ------------------------------------------------------------------ */

import { newId, newNode, orderedAttrs } from './400-tree-model.js';

const NODE_KEYS = ['id', 'text', 'children'];
const RELATION_KEYS = ['from', 'to', 'label'];

function readNode(o, parent, used) {
  const attrs = {};
  Object.keys(o || {}).forEach((k) => {
    if (NODE_KEYS.indexOf(k) === -1) attrs[k] = o[k];
  });
  let id = typeof o.id === 'string' && o.id ? o.id : newId();
  if (used.has(id)) id = newId();
  used.add(id);
  const node = newNode(typeof o.text === 'string' ? o.text : '', attrs, id);
  node.anchor = true;
  node.parent = parent;
  node.children = (Array.isArray(o.children) ? o.children : []).map((c) => readNode(c, node, used));
  return node;
}

/** A .mindmap file read as a map; a file that can't be read throws, so the view can say so rather than write over it. */
export function parseMindmapJson(text) {
  const data = JSON.parse(String(text || '').trim() || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Not a mind map: the file isn’t a JSON object.');
  const used = new Set();
  const model = {
    root: readNode(data.root || { text: '' }, null, used),
    free: (Array.isArray(data.free) ? data.free : []).map((n) => readNode(n, null, used)),
    relations: (Array.isArray(data.relations) ? data.relations : [])
      .filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string')
      .map((r) => {
        const attrs = {};
        Object.keys(r).forEach((k) => RELATION_KEYS.indexOf(k) === -1 && (attrs[k] = r[k]));
        return { from: r.from, to: r.to, label: typeof r.label === 'string' ? r.label : '', attrs };
      }),
    layout: data.nudge || data.view ? Object.assign({ v: 1 }, data.nudge ? { nudge: data.nudge } : {}, data.view ? { view: data.view } : {}) : null,
    rest: null,
    mode: typeof data.layout === 'string' ? data.layout : null,
  };
  return model;
}

function writeNode(n) {
  const o = { id: n.id, text: n.text || '' };
  Object.assign(o, orderedAttrs(n.attrs));
  if (n.children.length) o.children = n.children.map(writeNode);
  return o;
}

/** A map written as a .mindmap file. */
export function writeMindmapJson(model) {
  const out = { v: 1 };
  if (model.mode) out.layout = model.mode;
  out.root = writeNode(model.root || newNode(''));
  if ((model.free || []).length) out.free = model.free.map(writeNode);
  if ((model.relations || []).length) {
    out.relations = model.relations.map((r) => Object.assign({ from: r.from, to: r.to }, r.label ? { label: r.label } : {}, orderedAttrs(r.attrs)));
  }
  const layout = model.layout || {};
  if (layout.nudge && Object.keys(layout.nudge).length) out.nudge = layout.nudge;
  if (layout.view) out.view = layout.view;
  return JSON.stringify(out, null, 2) + '\n';
}
