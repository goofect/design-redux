/* ------------------------------------------------------------------ */
/* Tree: relations and arguments                                       */
/*                                                                    */
/* A relation joins any two nodes, out of the tree. It can say what it */
/* means: a kind — hierarchy (is a type of) or association (causes) —  */
/* its name read from the first node to the second; or a proposition   */
/* in your own words. Its label reads along it. What a map states is   */
/* its relations that say something, listed or written out.            */
/*                                                                    */
/* A node can have a part in an argument — a claim, a reason for what  */
/* it hangs from, an objection, a rebuttal, evidence — kept as its     */
/* role; a claim counts what's for it and what's against.             */
/* ------------------------------------------------------------------ */

import { newId, nodeById } from './400-tree-model.js';
import { applyPatch } from './404-tree-ops.js';

/* Each part: its name, and what the edge from the node it answers says. */
export const NODE_ROLES = {
  claim: { name: 'Claim', icon: 'message-square-quote', edge: '' },
  reason: { name: 'Reason', icon: 'thumbs-up', edge: 'supports' },
  objection: { name: 'Objection', icon: 'thumbs-down', edge: 'opposes' },
  rebuttal: { name: 'Rebuttal', icon: 'undo-2', edge: 'rebuts' },
  evidence: { name: 'Evidence', icon: 'file-check', edge: 'evidence for' },
};

/** A node's part in an argument, or null. */
export function nodeRole(n) {
  const role = n && n.attrs ? n.attrs.role : null;
  return NODE_ROLES[role] ? role : null;
}

/** What's for a node and what's against it, among the nodes that answer it. */
export function roleTally(n) {
  let pro = 0;
  let con = 0;
  (n ? n.children : []).forEach((c) => {
    const role = nodeRole(c);
    if (role === 'reason' || role === 'evidence') pro++;
    else if (role === 'objection') con++;
  });
  return { pro, con };
}

/** What a node's part says above it: its name, and for a claim, the count. */
export function roleLabel(n) {
  const role = nodeRole(n);
  if (!role) return '';
  const { pro, con } = role === 'claim' ? roleTally(n) : { pro: 0, con: 0 };
  return pro || con ? `${NODE_ROLES[role].name} · ${pro} for, ${con} against` : NODE_ROLES[role].name;
}

/** A node answering another — a reason, objection, rebuttal or evidence — added under it, empty, to be typed in. */
export function addAnswer(model, id, role) {
  const parent = nodeById(model, id);
  if (!parent || !NODE_ROLES[role]) return null;
  const node = { id: newId(), text: '', attrs: { role }, anchor: false, children: [] };
  const ops = [];
  if (parent.attrs.fold) ops.push({ type: 'attr', id, key: 'fold', value: undefined });
  ops.push({ type: 'insert', parentId: id, index: parent.children.length, node });
  return applyPatch(model, ops, [node.id]);
}

/* -- relations ------------------------------------------------------ */

/** The relations a node is at either end of: [{ r, index }]. */
export function relationsOf(model, id) {
  const out = [];
  (model.relations || []).forEach((r, index) => {
    if (r.from === id || r.to === id) out.push({ r, index });
  });
  return out;
}

/** What a relation says: { kind } or { predicate }, or null. */
export function relationMeaning(r) {
  const a = (r && r.attrs) || {};
  if (typeof a.predicate === 'string' && a.predicate.trim()) return { predicate: a.predicate.trim() };
  if (typeof a.kind === 'string' && a.kind.trim()) return { kind: a.kind.trim() };
  return null;
}

/** Both ends given their ids, so the relation holds when the file's read again. */
function anchorOps(model, ids) {
  const ops = [];
  ids.forEach((id) => {
    const n = nodeById(model, id);
    if (n && !n.anchor && n !== model.root && !ops.some((o) => o.id === id)) ops.push({ type: 'anchor', id, on: true });
  });
  return ops;
}

/** Two nodes related: a plain relation from one to the other, at the end of the list — or null if they already are, or can't be. */
export function addRelation(model, from, to, attrs, label) {
  if (from === to || !nodeById(model, from) || !nodeById(model, to)) return null;
  if ((model.relations || []).some((r) => r.from === from && r.to === to)) return null;
  const relation = { from, to, label: label || '', attrs: Object.assign({}, attrs || {}) };
  const ops = anchorOps(model, [from, to]);
  ops.push({ type: 'relation-add', index: model.relations.length, relation });
  return applyPatch(model, ops, [from]);
}

export function removeRelation(model, index) {
  if (!model.relations[index]) return null;
  return applyPatch(model, [{ type: 'relation-remove', index }], [model.relations[index].from]);
}

/** A relation put in place of another, where it was in the list. */
function replaceRelation(model, index, next) {
  const r = model.relations[index];
  if (!r || JSON.stringify(r) === JSON.stringify(next)) return null;
  return applyPatch(model, [{ type: 'relation-remove', index }, { type: 'relation-add', index, relation: next }], [next.from]);
}

/** A relation turned round: read from the other end, saying the same. */
export function reverseRelation(model, index) {
  const r = model.relations[index];
  if (!r) return null;
  return replaceRelation(model, index, { from: r.to, to: r.from, label: r.label, attrs: JSON.parse(JSON.stringify(r.attrs || {})) });
}

/**
 * What a relation means set: a kind — `type` from the kinds, its name
 * as the label and its line and colour as the relation's — or a
 * proposition, its words the label; or null, saying nothing.
 */
export function setRelationMeaning(model, index, meaning, type) {
  const r = model.relations[index];
  if (!r) return null;
  const attrs = Object.assign({}, r.attrs || {});
  ['kind', 'predicate', 'style', 'color'].forEach((k) => delete attrs[k]);
  let label = '';
  if (meaning && meaning.kind) {
    attrs.kind = meaning.kind;
    label = meaning.kind;
    if (type && type.line && type.line !== 'dashed') attrs.style = type.line;
    if (type && type.color) attrs.color = type.color;
  } else if (meaning && meaning.predicate) {
    attrs.predicate = String(meaning.predicate).trim();
    attrs.style = 'solid';
    label = attrs.predicate;
  }
  return replaceRelation(model, index, { from: r.from, to: r.to, label, attrs });
}

/**
 * What a map states: each relation saying something, read from its
 * first node to its second — [{ index, category, subject, object, verb }],
 * category hierarchy, association or proposition. `types` the kinds.
 */
export function relationStatements(model, types) {
  const out = [];
  (model.relations || []).forEach((r, index) => {
    const meaning = relationMeaning(r);
    const subject = nodeById(model, r.from);
    const object = nodeById(model, r.to);
    if (!meaning || !subject || !object) return;
    if (meaning.predicate) return out.push({ index, category: 'proposition', subject, object, verb: meaning.predicate });
    const type = (types || []).find((t) => t.name === meaning.kind);
    out.push({ index, category: type && type.category === 'hierarchy' ? 'hierarchy' : 'association', subject, object, verb: meaning.kind });
  });
  return out;
}

/** What a map states, as Markdown: hierarchy, associations, propositions, each sorted. `nameOf(node)` words a node. */
export function statementsMarkdown(statements, nameOf) {
  const sections = [
    ['hierarchy', 'Hierarchy'],
    ['association', 'Associations'],
    ['proposition', 'Propositions'],
  ];
  const out = [];
  sections.forEach(([category, title]) => {
    const lines = statements
      .filter((s) => s.category === category)
      .map((s) => `- ${nameOf(s.subject)} ${s.verb} ${nameOf(s.object)}`)
      .sort((a, b) => a.localeCompare(b));
    if (!lines.length) return;
    if (out.length) out.push('');
    out.push(`## ${title}`, '', ...lines);
  });
  return out.length ? out.join('\n') + '\n' : '';
}
