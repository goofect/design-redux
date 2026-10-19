/* ------------------------------------------------------------------ */
/* Mind map: the same map as an outline, a board, a timeline, a table */
/*                                                                    */
/* "Show as" sets how a map is shown, kept in its layout block: as the */
/* map; as an outline to type into — Enter for the next line, Tab in,  */
/* Shift-Tab out; as a board by status or by tag, cards dragged from    */
/* column to column; as a timeline of what's due; or as a table of the */
/* nodes and their attributes. Every change is a change to the tree,   */
/* with its own step of Undo, and the map shows it too.                */
/* ------------------------------------------------------------------ */

import { Menu, Notice, setIcon } from 'obsidian';
import { mixInto } from '../core/080-feature.js';
import { NamePrompt } from '../ui/230-pickers.js';
import { newId } from '../tree/400-tree-model.js';
import { addChild, addSibling, applyPatch, indentNode, outdentNode, removeNode, reorderNode, setAttr, setText } from '../tree/404-tree-ops.js';
import { MAP_VIEWS, mapViewOf, setMapView } from '../tree/406-tree-layout-block.js';
import { dayKey, dueState, parseDayInput, taskOf, taskText } from '../tree/415-tree-tasks.js';
import { kanbanColumns, moveCard, outlineRows, tableColumns, timelineDays } from '../tree/416-tree-views.js';
import { MindMapView } from './421-mindmap-view.js';
import { nodeLabel, nodeParts } from './423-mindmap-scene.js';
import { dueLabel, TASK_STATUSES } from './450-mindmap-tasks.js';

/* The ways a map can be shown, as "Show as" lists them. */
export const VIEW_CHOICES = [
  [null, 'Map', 'network'],
  ['outline', 'Outline', 'list-tree'],
  ['kanban', 'Board by status', 'square-kanban'],
  ['kanban-tag', 'Board by tag', 'tags'],
  ['timeline', 'Timeline', 'calendar-range'],
  ['table', 'Table', 'table'],
];

class MindMapShowAs {
  viewsOn() {
    return !this.plugin || this.plugin.settings.mindmapOtherViews !== false;
  }

  /** How the map is shown now: one of MAP_VIEWS, or null for the map. */
  shownAs() {
    return this.viewsOn() && this.model ? mapViewOf(this.model) : null;
  }

  /** The map shown another way, kept in the file — not a step of Undo, as it changes nothing in the map. */
  showAs(view) {
    if (!this.model) return;
    const patch = setMapView(this.model, MAP_VIEWS.includes(view) ? view : null);
    if (patch) this.applySync(patch);
    else this.draw();
  }

  /** "Show as" asked, from the bar. */
  chooseShowAs(evt) {
    const menu = new Menu();
    const now = this.shownAs();
    VIEW_CHOICES.forEach(([view, label, icon]) =>
      menu.addItem((item) => {
        item.setTitle(label).setIcon(icon).onClick(() => this.showAs(view));
        if (typeof item.setChecked === 'function') item.setChecked(view === now);
        if (typeof item.setSection === 'function') item.setSection('view');
      })
    );
    if (evt && typeof menu.showAtMouseEvent === 'function') menu.showAtMouseEvent(evt);
    else if (typeof menu.showAtPosition === 'function') menu.showAtPosition({ x: 0, y: 0 });
  }

  /** Drawn another way, if it's shown another way: whether it was. */
  drawAlt() {
    const view = this.shownAs();
    this.root.toggleClass('is-alt', !!view);
    if (!view) {
      if (this.altEl) this.altEl.empty();
      return false;
    }
    if (!this.altEl) {
      this.altEl = this.root.createDiv({ cls: 'dr-mindmap-alt' });
      this.registerDomEvent(this.altEl, 'keydown', (evt) => this.altKey(evt));
    }
    // Where the reader was, kept across drawing it again.
    const scroll = this.altEl.scrollTop;
    this.altEl.empty();
    this.altEl.dataset.view = view;
    if (view === 'outline') this.drawOutlineView();
    else if (view === 'kanban' || view === 'kanban-tag') this.drawBoard(view === 'kanban-tag' ? 'tag' : 'status');
    else if (view === 'timeline') this.drawTimeline();
    else this.drawTable();
    this.altEl.scrollTop = scroll;
    if (this.altFocus) {
      const at = this.altEl.querySelector(`[data-id="${this.altFocus}"] .dr-alt-edit`);
      this.altFocus = null;
      if (at) {
        at.focus();
        if (typeof at.setSelectionRange === 'function') at.setSelectionRange(at.value.length, at.value.length);
      }
    }
    return true;
  }

  /** Undo and Redo where the keys aren't typing into a field. */
  altKey(evt) {
    const mod = evt.ctrlKey || evt.metaKey;
    const typing = evt.target && /^(INPUT|TEXTAREA|SELECT)$/.test(evt.target.tagName);
    if (mod && !evt.altKey && !typing && (evt.key === 'z' || evt.key === 'Z' || evt.key === 'y')) {
      evt.preventDefault();
      this.undoStep(evt.key === 'y' || evt.shiftKey);
    }
  }

  /** A node's first line as the views edit it — a task's without its box. */
  lineOf(n) {
    const title = nodeParts(n).title;
    return taskOf(n) ? taskText(title) : title;
  }

  /** A node's first line changed in a view, the rest of its text — and a task's box — kept. */
  setLine(n, line) {
    const [, ...rest] = String(n.text || '').split('\n');
    const t = taskOf(n);
    const text = [(t ? `[${t.done ? 'x' : ' '}] ` : '') + line].concat(rest).join('\n');
    if (text !== n.text) this.apply(setText(this.model, n.id, text));
  }

  /** A task's box, in a view: ticked with a click. */
  altBox(parent, n) {
    const t = taskOf(n);
    if (!t) return null;
    const box = parent.createEl('input', { type: 'checkbox', cls: 'dr-alt-box' });
    box.checked = t.done;
    box.setAttribute('aria-label', t.done ? 'Done' : 'Not done');
    box.addEventListener('change', () => this.tickTask(n.id));
    return box;
  }

  altDue(parent, n) {
    const state = dueState(n);
    if (!state) return;
    const chip = parent.createSpan({ cls: `dr-mindmap-chip is-due is-${state}`, text: dueLabel(n.attrs.due) });
    chip.setAttribute('aria-label', `Due ${n.attrs.due}`);
  }

  /** A node picked in a view, shown on the map. */
  showOnMap(id) {
    this.showAs(null);
    if (typeof this.openTo === 'function') this.openTo(id);
  }

  /* -- the outline ----------------------------------------------------- */

  drawOutlineView() {
    const list = this.altEl.createDiv({ cls: 'dr-alt-outline' });
    list.setAttribute('role', 'tree');
    const rows = outlineRows(this.model);
    rows.forEach(({ node, depth }, k) => {
      const row = list.createDiv({ cls: 'dr-alt-row' });
      row.dataset.id = node.id;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth + 1));
      row.style.setProperty('--dr-depth', String(depth));
      row.toggleClass('is-selected', node.id === this.selected);
      const fold = row.createSpan({ cls: 'dr-alt-fold' });
      if (node.children.length) {
        setIcon(fold, node.attrs.fold ? 'chevron-right' : 'chevron-down');
        fold.setAttribute('aria-label', node.attrs.fold ? 'Unfold' : 'Fold');
        fold.addEventListener('click', () => this.toggleFold(node.id));
        row.setAttribute('aria-expanded', String(!node.attrs.fold));
      }
      this.altBox(row, node);
      const input = row.createEl('input', { type: 'text', cls: 'dr-alt-edit' });
      input.value = this.lineOf(node);
      input.setAttribute('aria-label', nodeLabel(node) || 'Untitled');
      input.addEventListener('focus', () => {
        this.selected = node.id;
      });
      input.addEventListener('change', () => this.setLine(node, input.value));
      input.addEventListener('keydown', (evt) => this.outlineKey(evt, node, input, rows, k));
      this.altDue(row, node);
      if (typeof node.attrs.status === 'string' && node.attrs.status) row.createSpan({ cls: 'dr-mindmap-chip is-status', text: node.attrs.status });
    });
  }

  /** Keys in an outline row: Enter for the next, Tab in, Shift-Tab out, Backspace on nothing to remove it, arrows to walk. */
  outlineKey(evt, node, input, rows, k) {
    if (evt.isComposing) return;
    const commit = () => {
      if (input.value !== this.lineOf(node)) this.setLine(node, input.value);
    };
    const go = (to) => {
      const row = rows[to];
      if (!row) return;
      evt.preventDefault();
      const el = this.altEl.querySelector(`[data-id="${row.node.id}"] .dr-alt-edit`);
      if (el) el.focus();
    };
    if (evt.key === 'Enter' && !evt.shiftKey) {
      evt.preventDefault();
      commit();
      const patch = node === this.model.root ? addChild(this.model, node.id, '', 0) : addSibling(this.model, node.id, '');
      if (patch) {
        this.altFocus = patch.selection[0];
        this.apply(patch);
      }
    } else if (evt.key === 'Tab') {
      evt.preventDefault();
      commit();
      this.altFocus = node.id;
      this.apply(evt.shiftKey ? outdentNode(this.model, node.id) : indentNode(this.model, node.id));
      if (this.altFocus) this.draw();
    } else if (evt.key === 'Backspace' && input.value === '' && node !== this.model.root && !node.children.length) {
      evt.preventDefault();
      const before = rows[k - 1];
      if (before) this.altFocus = before.node.id;
      this.apply(removeNode(this.model, node.id));
    } else if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
      evt.preventDefault();
      commit();
      this.altFocus = node.id;
      this.apply(reorderNode(this.model, node.id, evt.key === 'ArrowUp' ? -1 : 1));
      if (this.altFocus) this.draw();
    } else if (evt.key === 'ArrowUp') go(k - 1);
    else if (evt.key === 'ArrowDown') go(k + 1);
  }

  /* -- the board ------------------------------------------------------- */

  drawBoard(by) {
    const head = this.altEl.createDiv({ cls: 'dr-alt-head' });
    [['status', 'By status', 'kanban'], ['tag', 'By tag', 'kanban-tag']].forEach(([key, label, view]) => {
      const b = head.createEl('button', { cls: 'dr-alt-switch', text: label });
      b.toggleClass('is-active', key === by);
      b.addEventListener('click', () => this.showAs(view));
    });
    const columns = kanbanColumns(this.model, by, TASK_STATUSES);
    const board = this.altEl.createDiv({ cls: 'dr-alt-board' });
    if (!columns.length) {
      board.createDiv({ cls: 'dr-alt-empty', text: by === 'tag' ? 'No node has a #tag yet.' : 'No tasks yet.' });
      return;
    }
    columns.forEach((c) => {
      const col = board.createDiv({ cls: 'dr-alt-column' });
      col.dataset.column = c.key === null ? '' : c.key;
      const title = col.createDiv({ cls: 'dr-alt-column-head' });
      title.createSpan({ text: c.label });
      title.createSpan({ cls: 'dr-alt-count', text: String(c.cards.length) });
      c.cards.forEach((n) => {
        const card = col.createDiv({ cls: 'dr-alt-card' });
        card.dataset.id = n.id;
        card.setAttribute('draggable', 'true');
        card.toggleClass('is-selected', n.id === this.selected);
        card.toggleClass('is-done', !!(taskOf(n) && taskOf(n).done));
        this.altBox(card, n);
        card.createSpan({ cls: 'dr-alt-card-text', text: this.lineOf(n) || 'Untitled' });
        this.altDue(card, n);
        card.addEventListener('click', (evt) => {
          if (evt.target.closest('.dr-alt-box')) return;
          this.selected = n.id;
          this.draw();
        });
        card.addEventListener('dblclick', () => this.showOnMap(n.id));
        card.addEventListener('dragstart', (evt) => {
          this.dragCard = { id: n.id, from: c.key };
          if (evt.dataTransfer) {
            evt.dataTransfer.effectAllowed = 'move';
            evt.dataTransfer.setData('text/plain', this.lineOf(n));
          }
        });
        card.addEventListener('dragend', () => {
          this.dragCard = null;
        });
      });
      col.addEventListener('dragover', (evt) => {
        if (!this.dragCard) return;
        evt.preventDefault();
        col.addClass('is-drop');
      });
      col.addEventListener('dragleave', () => col.removeClass('is-drop'));
      col.addEventListener('drop', (evt) => {
        col.removeClass('is-drop');
        const drag = this.dragCard;
        this.dragCard = null;
        if (!drag) return;
        evt.preventDefault();
        this.moveCardTo(drag.id, by, drag.from, c.key);
      });
      if (by === 'status' && c.key !== null) {
        const add = col.createEl('button', { cls: 'dr-alt-add', text: 'Add a task' });
        add.addEventListener('click', () => this.addTaskIn(c.key));
      }
    });
  }

  /** A card moved to another column: its status, or its tag, and nothing else. */
  moveCardTo(id, by, from, to) {
    if (this.model) this.apply(moveCard(this.model, id, by, from, to));
  }

  /** A new task in a column, under the root: asked its name. */
  addTaskIn(status) {
    new NamePrompt(this.app, `A task, ${status}`, 'What to do', (name) => {
      const node = { id: newId(), text: `[ ] ${name}`, attrs: { status }, anchor: false, children: [] };
      this.apply(applyPatch(this.model, [{ type: 'insert', parentId: this.model.root.id, index: this.model.root.children.length, node }], [node.id]));
    }).open();
  }

  /* -- the timeline ---------------------------------------------------- */

  drawTimeline() {
    const days = timelineDays(this.model);
    const list = this.altEl.createDiv({ cls: 'dr-alt-timeline' });
    if (!days.length) {
      list.createDiv({ cls: 'dr-alt-empty', text: 'Nothing has a due date yet. Set one on a node with Set the node’s due date.' });
      return;
    }
    const today = dayKey();
    days.forEach(({ due, items }) => {
      const day = list.createDiv({ cls: 'dr-alt-day' });
      day.toggleClass('is-past', due < today);
      day.toggleClass('is-today', due === today);
      day.createDiv({ cls: 'dr-alt-day-head', text: dueLabel(due, today) });
      items.forEach((n) => {
        const row = day.createDiv({ cls: 'dr-alt-item' });
        row.dataset.id = n.id;
        row.toggleClass('is-done', !!(taskOf(n) && taskOf(n).done));
        this.altBox(row, n);
        const text = row.createSpan({ cls: 'dr-alt-item-text', text: this.lineOf(n) || 'Untitled' });
        text.addEventListener('dblclick', () => this.showOnMap(n.id));
        if (n.parent && !n.parent.virtual) row.createSpan({ cls: 'dr-alt-under', text: nodeLabel(n.parent) });
        const date = row.createEl('input', { type: 'date', cls: 'dr-alt-date' });
        date.value = n.attrs.due;
        date.setAttribute('aria-label', 'Due date');
        date.addEventListener('change', () => this.apply(setAttr(this.model, n.id, 'due', date.value || undefined)));
      });
    });
  }

  /* -- the table ------------------------------------------------------- */

  drawTable() {
    const columns = tableColumns(this.model);
    const statuses = Array.from(new Set(TASK_STATUSES.concat(kanbanColumns(this.model, 'status', []).map((c) => c.key).filter(Boolean))));
    const table = this.altEl.createEl('table', { cls: 'dr-alt-table' });
    const names = { text: 'Node', done: 'Done', status: 'Status', due: 'Due' };
    const head = table.createEl('thead').createEl('tr');
    columns.forEach((c) => head.createEl('th', { text: names[c] || c }));
    const body = table.createEl('tbody');
    const listId = `dr-statuses-${this.file ? this.file.path.replace(/[^\w]/g, '-') : 'map'}`;
    const options = this.altEl.createEl('datalist');
    options.id = listId;
    statuses.forEach((s) => options.createEl('option', { value: s }));
    outlineRows(this.model).forEach(({ node, depth }) => {
      const tr = body.createEl('tr');
      tr.dataset.id = node.id;
      tr.toggleClass('is-selected', node.id === this.selected);
      columns.forEach((c) => {
        const td = tr.createEl('td');
        td.dataset.column = c;
        if (c === 'text') {
          td.style.setProperty('--dr-depth', String(depth));
          const input = td.createEl('input', { type: 'text', cls: 'dr-alt-edit' });
          input.value = this.lineOf(node);
          input.addEventListener('change', () => this.setLine(node, input.value));
        } else if (c === 'done') {
          if (!this.altBox(td, node)) {
            const make = td.createEl('button', { cls: 'dr-alt-make-task', text: '+' });
            make.setAttribute('aria-label', 'Make it a task');
            make.addEventListener('click', () => this.toggleTaskAt(node.id));
          }
        } else if (c === 'due') {
          const date = td.createEl('input', { type: 'date', cls: 'dr-alt-date' });
          date.value = node.attrs.due || '';
          date.addEventListener('change', () => {
            const due = parseDayInput(date.value);
            if (due === null) return new Notice(`“${date.value}” isn’t a date this can read.`);
            this.apply(setAttr(this.model, node.id, 'due', due || undefined));
          });
        } else {
          const input = td.createEl('input', { type: 'text', cls: 'dr-alt-cell' });
          const value = node.attrs[c];
          input.value = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
          if (c === 'status') input.setAttribute('list', listId);
          input.addEventListener('change', () => this.apply(setAttr(this.model, node.id, c, cellValue(input.value, value))));
        }
      });
    });
  }
}

/** What's typed in a table cell, as the attribute it was: a number or true stays one where it reads as one; nothing removes it. */
export function cellValue(text, was) {
  const t = String(text).trim();
  if (!t) return undefined;
  if (typeof was !== 'string' && was !== undefined) {
    try {
      return JSON.parse(t);
    } catch (err) {
      return t;
    }
  }
  return t;
}

mixInto(MindMapView, MindMapShowAs);
