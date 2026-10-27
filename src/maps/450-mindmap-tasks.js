/* ------------------------------------------------------------------ */
/* Mind map: tasks                                                     */
/*                                                                    */
/* A node can be a task: a box before its text, ticked with a click or */
/* a command, written as - [ ] in the note. It can have a due date —    */
/* typed as "tomorrow" or "+2w" — and a status, shown as chips under    */
/* its text, the date coloured as it's due. A node with tasks below it */
/* shows how many are done on a ring; "open tasks only" lights the     */
/* open ones and the way down to them, the rest dimmed.                */
/* ------------------------------------------------------------------ */

import { Notice, setIcon } from 'obsidian';
import { ChoicePicker, NamePrompt } from '../ui/230-pickers.js';
import { nodeById } from '../tree/400-tree-model.js';
import { setAttr } from '../tree/404-tree-ops.js';
import { dayKey, dueState, openTaskSet, parseDayInput, setTaskDone, statusesOf, taskOf, toggleTask, untask } from '../tree/415-tree-tasks.js';
import { nodeLabel } from './423-mindmap-scene.js';
import { MindMapFocus } from './441-mindmap-focus.js';

/* Statuses offered before a map has any of its own. */
export const TASK_STATUSES = ['To do', 'Doing', 'Waiting', 'Done'];

/** A due date as a chip says it: "Today", "Tomorrow", "Mon 3 Nov". */
export function dueLabel(due, today) {
  const t = today || dayKey();
  if (due === t) return 'Today';
  const d = new Date(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10));
  const next = new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10) + 1);
  if (dayKey(next) === due) return 'Tomorrow';
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== +t.slice(0, 4)) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export class MindMapTasks extends MindMapFocus {
  tasksOn() {
    return !this.plugin || this.plugin.settings.mindmapTasks !== false;
  }

  /** What of a node's task look can change without its text: so its card is drawn again when it does. */
  taskKey(n) {
    if (!this.tasksOn()) return '';
    return `${n.attrs.status || ''}|${n.attrs.due || ''}|${dueState(n) || ''}`;
  }

  /** A task's box, before its text. */
  taskBox(el, n) {
    const t = this.tasksOn() ? taskOf(n) : null;
    if (!t) return;
    el.addClass('is-task');
    el.toggleClass('is-done', t.done);
    const box = el.createDiv({ cls: 'dr-mindmap-task' });
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(t.done));
    box.setAttribute('aria-label', t.done ? 'Done' : 'Not done');
    if (t.done) setIcon(box, 'check');
  }

  /** A node's status and due date as chips under its text, and its tasks' progress as a ring. */
  taskChips(el, n) {
    if (!this.tasksOn()) return;
    const status = typeof n.attrs.status === 'string' ? n.attrs.status : '';
    const state = dueState(n);
    if (status || state) {
      const row = el.createDiv({ cls: 'dr-mindmap-chips' });
      if (status) row.createSpan({ cls: 'dr-mindmap-chip is-status', text: status });
      if (state) {
        const chip = row.createSpan({ cls: `dr-mindmap-chip is-due is-${state}` });
        setIcon(chip.createSpan({ cls: 'dr-mindmap-chip-icon' }), state === 'overdue' ? 'alarm-clock-off' : 'calendar');
        chip.createSpan({ text: dueLabel(n.attrs.due) });
        chip.setAttribute('aria-label', state === 'overdue' ? `Overdue: ${n.attrs.due}` : `Due ${n.attrs.due}`);
      }
    }
  }

  /** A task's box clicked: ticked, or unticked. */
  tickTask(id) {
    const n = this.model && nodeById(this.model, id);
    const t = n && taskOf(n);
    if (t) this.apply(setTaskDone(this.model, id, !t.done));
  }

  /** The node made a task, or its box ticked the other way. */
  toggleTaskAt(id) {
    if (this.model) this.apply(toggleTask(this.model, id));
  }

  untaskAt(id) {
    if (this.model) this.apply(untask(this.model, id));
  }

  /** A due date asked: a date, or "tomorrow", "+3d", "+2w"; nothing takes it off. */
  chooseDue(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    new NamePrompt(
      this.app,
      `Due date for “${nodeLabel(n)}”`,
      'tomorrow, +3d, +2w or YYYY-MM-DD',
      (text) => {
        const due = parseDayInput(text);
        if (due === null) {
          new Notice(`“${text}” isn’t a date this can read.`);
          return;
        }
        this.apply(setAttr(this.model, id, 'due', due || undefined));
      },
      { value: n.attrs.due || '', button: 'Set', allowEmpty: true }
    ).open();
  }

  /** A status picked: the map's own, the usual ones, a new one typed, or none. */
  chooseStatus(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    const own = statusesOf(this.model);
    const names = own.concat(TASK_STATUSES.filter((s) => !own.includes(s)));
    const items = names.map((label) => ({ label, value: label, note: label === n.attrs.status ? 'Now' : '' }));
    items.push({ label: 'A new status…', value: null, ask: true });
    if (n.attrs.status) items.push({ label: 'No status', value: undefined });
    new ChoicePicker(this.app, `Status of “${nodeLabel(n)}”…`, items, (item) => {
      if (!item.ask) return this.apply(setAttr(this.model, id, 'status', item.value));
      new NamePrompt(this.app, 'A new status', 'Status', (name) => this.apply(setAttr(this.model, id, 'status', name)), { button: 'Set' }).open();
    }).open();
  }

  /** Only the open tasks lit, and the way down to them — or everything again. */
  toggleOpenTasks() {
    if (!this.openTasksOnly && this.model && !openTaskSet(this.model)) {
      new Notice('This map has no open tasks.');
      return;
    }
    this.openTasksOnly = !this.openTasksOnly;
    this.draw();
  }

  /** What "open tasks only" lights, while it's on. */
  openTasksLit() {
    return this.openTasksOnly && this.model ? openTaskSet(this.model) || new Set() : null;
  }
}
