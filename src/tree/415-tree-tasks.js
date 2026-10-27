/* ------------------------------------------------------------------ */
/* Tree: tasks in a map                                                */
/*                                                                    */
/* A node whose text starts "[ ] " or "[x] " is a task, written in the */
/* note as Markdown's own - [ ] item. Its due date and status are the  */
/* node's attributes. A node above tasks shows how many of them are    */
/* done; a due date is overdue, today, soon or later; and "open tasks  */
/* only" lights the open tasks and the way down to them. Pure.         */
/* ------------------------------------------------------------------ */

import { nodeById, walk } from './400-tree-model.js';
import { applyPatch } from './404-tree-ops.js';

const TASK = /^\[([ xX])\] /;

/* How many days ahead a due date is soon. */
export const DUE_SOON_DAYS = 3;

/** A node as a task: { done }, or null. */
export function taskOf(node) {
  const m = node && TASK.exec(String(node.text || ''));
  return m ? { done: m[1] !== ' ' } : null;
}

/** A task's text without its box. */
export function taskText(text) {
  return String(text || '').replace(TASK, '');
}

/** A node made a task, its box ticked or not; or, made a task already, ticked the other way. */
export function toggleTask(model, id) {
  const n = nodeById(model, id);
  if (!n) return null;
  const t = taskOf(n);
  return setTaskText(model, n, t ? `[${t.done ? ' ' : 'x'}] ${taskText(n.text)}` : `[ ] ${n.text}`);
}

/** A task ticked or not. */
export function setTaskDone(model, id, done) {
  const n = nodeById(model, id);
  const t = taskOf(n);
  if (!t || t.done === !!done) return null;
  return setTaskText(model, n, `[${done ? 'x' : ' '}] ${taskText(n.text)}`);
}

/** A task back to a plain node: its box, due date and status taken off. */
export function untask(model, id) {
  const n = nodeById(model, id);
  if (!taskOf(n)) return null;
  const ops = [{ type: 'text', id, text: taskText(n.text) }];
  ['due', 'status'].forEach((key) => n.attrs[key] !== undefined && ops.push({ type: 'attr', id, key, value: undefined }));
  return applyPatch(model, ops, [id]);
}

function setTaskText(model, n, text) {
  return n.text === text ? null : applyPatch(model, [{ type: 'text', id: n.id, text }], [n.id]);
}

/** A date as the map keeps it: YYYY-MM-DD, in local time. */
export function dayKey(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whether text is a date as the map keeps it. */
export function isDayKey(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(text || '')) && !isNaN(Date.parse(text));
}

/**
 * A date typed as a person would: "today", "tomorrow", "yesterday",
 * "+3d", "-1w", "+2m", or YYYY-MM-DD — as YYYY-MM-DD, '' for nothing,
 * or null where it can't be read. `today` is YYYY-MM-DD.
 */
export function parseDayInput(text, today) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return '';
  if (isDayKey(t)) return t;
  const base = today || dayKey();
  const d = new Date(+base.slice(0, 4), +base.slice(5, 7) - 1, +base.slice(8, 10));
  const words = { today: 0, tomorrow: 1, yesterday: -1 };
  if (t in words) {
    d.setDate(d.getDate() + words[t]);
    return dayKey(d);
  }
  const m = /^([+-])\s*(\d+)\s*([dwm])?$/.exec(t);
  if (!m) return null;
  const n = (m[1] === '-' ? -1 : 1) * Number(m[2]);
  if (m[3] === 'm') d.setMonth(d.getMonth() + n);
  else d.setDate(d.getDate() + n * (m[3] === 'w' ? 7 : 1));
  return dayKey(d);
}

/** Days from one date to another, both YYYY-MM-DD. */
function daysBetween(from, to) {
  const [a, b] = [from, to].map((k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

/** Where a node's due date stands: 'overdue', 'today', 'soon', 'later', or null — none for a task that's done. */
export function dueState(node, today) {
  const due = node && node.attrs && node.attrs.due;
  if (!isDayKey(due)) return null;
  const t = taskOf(node);
  if (t && t.done) return null;
  const days = daysBetween(today || dayKey(), due);
  return days < 0 ? 'overdue' : days === 0 ? 'today' : days <= DUE_SOON_DAYS ? 'soon' : 'later';
}

/** The open tasks and every node on the way down to them; null where the map has no open task. */
export function openTaskSet(model) {
  const lit = new Set();
  const go = (n, above) => {
    const t = taskOf(n);
    if (t && !t.done) {
      lit.add(n.id);
      above.forEach((id) => lit.add(id));
    }
    n.children.forEach((c) => go(c, above.concat(n.id)));
  };
  if (model.root) go(model.root, []);
  (model.free || []).forEach((n) => go(n, []));
  return lit.size ? lit : null;
}

/** The statuses a map's nodes have, in the order they're first met. */
export function statusesOf(model) {
  const seen = [];
  walk(model, (n) => {
    const s = n.attrs && n.attrs.status;
    if (typeof s === 'string' && s && !seen.includes(s)) seen.push(s);
  });
  return seen;
}
