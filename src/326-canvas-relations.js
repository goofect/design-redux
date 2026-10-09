/* ------------------------------------------------------------------ */
/* Canvas: relationships                                               */
/*                                                                     */
/* A plain arrow is taken as a branch, and nothing more is read into   */
/* it. An arrow's menu can say what it means:                          */
/*   - a kind that is hierarchy — is a type of, is part of — keeps it  */
/*     in the branch: the broader card above, the narrower below;      */
/*   - a kind that is association — causes, contrasts with — takes it  */
/*     out: the cards go together, neither hanging from the other;     */
/*   - a proposition, in your own words: Judicial review constrains    */
/*     legislative power. Out of the branch too.                       */
/* The meaning — which kind, or the words, and which card is the       */
/* subject — is kept in the arrow's own data, apart from its label,    */
/* which reads along the arrow and can be edited. So the canvas stays  */
/* one Obsidian opens as it is, and what it states can be listed, or   */
/* written out as a note. An arrow can also just be made Related:      */
/* drawn dashed, kept out of branches, with no more said.              */
/* ------------------------------------------------------------------ */

const DEFAULT_RELATIONS = 'is a type of, is part of, depends on, causes, contrasts with, supports, exemplifies, governed by';

/* On an arrow: what it means — { kind, subject, object } or { predicate, subject, object }, the ends as card ids. */
const RELATION_KEY = 'drRelation';
const PROPOSITION = 'Proposition';

/*
 * Each kind: its reading the other way, whether it's hierarchy or
 * association, its line — solid, dashed or dotted — and colour: one of
 * the canvas's six, or none. Grey by default.
 */
const DEFAULT_RELATION_TYPES = [
  { name: 'is a type of', inverse: 'has type', category: 'hierarchy', line: 'solid', color: '' },
  { name: 'is part of', inverse: 'has part', category: 'hierarchy', line: 'solid', color: '' },
  { name: 'depends on', inverse: 'is needed by', category: 'association', line: 'dashed', color: '' },
  { name: 'causes', inverse: 'is caused by', category: 'association', line: 'solid', color: '' },
  { name: 'contrasts with', inverse: 'contrasts with', category: 'association', line: 'dotted', color: '' },
  { name: 'supports', inverse: 'is supported by', category: 'association', line: 'solid', color: '' },
  { name: 'exemplifies', inverse: 'is exemplified by', category: 'association', line: 'dashed', color: '' },
  { name: 'governed by', inverse: 'governs', category: 'association', line: 'solid', color: '' },
];

const RELATION_COLORS = { '': 'No colour', 1: 'Red', 2: 'Orange', 3: 'Yellow', 4: 'Green', 5: 'Cyan', 6: 'Purple' };
const RELATION_CATEGORIES = { hierarchy: 'Hierarchy', association: 'Association' };

/** What an arrow means, or null. A kind's name alone, as kept before, reads as that kind. */
function relationInfo(edge) {
  const value = edge && edge.unknownData && edge.unknownData[RELATION_KEY];
  if (!value) return null;
  if (typeof value === 'string') return { kind: value };
  return typeof value === 'object' && (value.kind || value.predicate) ? value : null;
}

/** An arrow's kind of relationship, Proposition, or ''. */
function relationOf(edge) {
  const info = relationInfo(edge);
  if (!info) return '';
  return info.predicate ? PROPOSITION : String(info.kind || '');
}

/** The card an arrow leaves and the card its head points at. */
function arrowEnds(edge) {
  const from = (edge && edge.from) || {};
  const to = (edge && edge.to) || {};
  const reversed = (from.end || 'none') === 'arrow' && (to.end || 'arrow') !== 'arrow';
  return reversed ? { tail: to.node, head: from.node } : { tail: from.node, head: to.node };
}

/**
 * Which card an arrow's statement is about, and which it relates it to.
 * Hierarchy: the narrower card, below, is the subject. Otherwise as
 * kept, while both are still its ends; else along the arrow.
 */
function statementEnds(edge, info, type) {
  const { tail, head } = arrowEnds(edge);
  if (!info.predicate && type && type.category === 'hierarchy') return { subject: head, object: tail };
  const ids = [tail && tail.id, head && head.id];
  if (info.subject && info.object && info.subject !== info.object && ids.includes(info.subject) && ids.includes(info.object)) {
    return info.subject === ids[0] ? { subject: tail, object: head } : { subject: head, object: tail };
  }
  return { subject: tail, object: head };
}

/** An arrow's data, as the canvas has it. */
function edgeData(edge) {
  try {
    return (edge && typeof edge.getData === 'function' && edge.getData()) || {};
  } catch (err) {
    return {};
  }
}

function isRelated(edge) {
  return !!(edge && edge.unknownData && edge.unknownData[RELATED_KEY]);
}

class RelationPicker extends FuzzySuggestModal {
  constructor(app, names, onChoose) {
    super(app);
    this.names = names;
    this.onChoose = onChoose;
    this.setPlaceholder('How do they relate?');
  }

  getItems() {
    return this.names;
  }

  getItemText(name) {
    return name;
  }

  onChooseItem(name) {
    this.onChoose(name);
  }
}

/** A proposition put in words: subject, what it says of the object, object — which can be swapped. */
class PropositionModal extends Modal {
  constructor(app, opts, onSave) {
    super(app);
    this.opts = opts;
    this.onSave = onSave;
  }

  onOpen() {
    let subject = this.opts.subject;
    let object = this.opts.object;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('dr-proposition');
    if (this.titleEl) this.titleEl.setText('State a proposition');
    const line = contentEl.createDiv({ cls: 'dr-proposition-line' });
    const subjectEl = line.createDiv({ cls: 'dr-proposition-card' });
    const input = line.createEl('input', { type: 'text', cls: 'dr-proposition-predicate', attr: { placeholder: 'constrains', 'aria-label': 'What it says' } });
    input.value = this.opts.predicate || '';
    const objectEl = line.createDiv({ cls: 'dr-proposition-card' });
    const fill = () => {
      subjectEl.setText(subject.label);
      objectEl.setText(object.label);
    };
    const save = () => {
      this.close();
      this.onSave(input.value.trim(), subject.id);
    };
    fill();
    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Swap').setTooltip('The other card as the subject').onClick(() => {
        [subject, object] = [object, subject];
        fill();
      }))
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('Save').setCta().onClick(save));
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !evt.isComposing) {
        evt.preventDefault();
        save();
      }
    });
    input.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CanvasRelations extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasRelations',
        name: 'Relationships',
        desc: 'An arrow’s menu says what it means: a kind — hierarchy, kept in the branch, or association, taken out — or a proposition in your own words. Kept apart from its label.',
      },
      {
        key: 'canvasRelationTypes',
        type: 'custom',
        showIf: 'canvasRelations',
        name: 'Kinds of relationship',
        render: (containerEl) => this.renderTypes(containerEl),
      },
    ];
  }

  /** The kinds of relationship, as set: { name, inverse, category, line, color }. */
  types() {
    const fill = (t) => Object.assign({ inverse: '', category: 'association', line: 'solid', color: '' }, DEFAULT_RELATION_TYPES.find((d) => d.name === t.name) || {}, t);
    const set = Array.isArray(this.settings.canvasRelationTypes) ? this.settings.canvasRelationTypes.filter((t) => t && String(t.name || '').trim()) : [];
    if (set.length) return set.map(fill);
    // Names set before kinds had styles: each as the default of that name has, or plain.
    const names = String(this.settings.canvasRelationNames || '').trim();
    if (!names) return DEFAULT_RELATION_TYPES;
    return names
      .split(',')
      .map((n) => n.trim())
      .filter((n, i, all) => n && all.indexOf(n) === i)
      .map((name) => fill({ name }));
  }

  /** The settings' list of kinds: a name, its reading the other way, hierarchy or association, a line and a colour each, and one to add. */
  renderTypes(containerEl) {
    const doc = containerEl.ownerDocument;
    const block = containerEl.appendChild(doc.createElement('div'));
    block.className = 'dr-relation-types';
    const save = (list) => {
      this.settings.canvasRelationTypes = list;
      this.plugin.saveSettings();
    };
    const draw = () => {
      block.empty();
      const list = this.types().map((t) => Object.assign({}, t));
      new Setting(block)
        .setName('Kinds of relationship')
        .setDesc('Offered on an arrow’s menu. Hierarchy keeps an arrow in its branch; association takes it out. Each draws its arrows its own way.')
        .setHeading();
      list.forEach((type, i) => {
        const row = new Setting(block).setClass('dr-relation-type');
        row.addText((t) => t.setValue(type.name).setPlaceholder('Name').onChange((v) => {
          list[i].name = v.trim();
          save(list);
        }));
        row.addText((t) => t.setValue(type.inverse || '').setPlaceholder('The other way').onChange((v) => {
          list[i].inverse = v.trim();
          save(list);
        }));
        row.addDropdown((d) => d.addOptions(RELATION_CATEGORIES).setValue(type.category === 'hierarchy' ? 'hierarchy' : 'association').onChange((v) => {
          list[i].category = v;
          save(list);
        }));
        row.addDropdown((d) => d.addOptions({ solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' }).setValue(type.line || 'solid').onChange((v) => {
          list[i].line = v;
          save(list);
        }));
        row.addDropdown((d) => d.addOptions(RELATION_COLORS).setValue(String(type.color || '')).onChange((v) => {
          list[i].color = v;
          save(list);
        }));
        row.addExtraButton((b) => b.setIcon('trash-2').setTooltip('Remove').onClick(() => {
          list.splice(i, 1);
          save(list.length ? list : [{ name: 'relates to', inverse: 'relates to', category: 'association', line: 'solid', color: '' }]);
          draw();
        }));
      });
      new Setting(block).addButton((b) => b.setButtonText('Add a kind').onClick(() => {
        list.push({ name: 'new relationship', inverse: '', category: 'association', line: 'solid', color: '' });
        save(list);
        draw();
      })).addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip('Back to the kinds it starts with').onClick(() => {
        save([]);
        draw();
      }));
    };
    draw();
    return block;
  }

  commands() {
    const arrows = () => this.selectedNodes(this.pageCanvas()).filter(isCanvasEdge);
    return [
      {
        id: 'canvas-name-relationship',
        name: 'Name how the selected arrows’ cards relate',
        icon: 'tag',
        check: () => this.enabled && arrows().length > 0,
        run: () => {
          const view = this.pageCanvas();
          const edges = arrows();
          new RelationPicker(this.app, this.names(), (name) => this.setRelation(view, edges, this.typeNamed(name))).open();
        },
      },
      {
        id: 'canvas-state-proposition',
        name: 'State a proposition with the selected arrow',
        icon: 'quote',
        check: () => this.enabled && arrows().length === 1,
        run: () => this.askProposition(this.pageCanvas(), arrows()[0]),
      },
      {
        id: 'canvas-reverse-relationship',
        name: 'Reverse the selected arrows’ relationship',
        icon: 'arrow-left-right',
        check: () => this.enabled && arrows().length > 0 && arrows().every((e) => this.canReverse(e)),
        run: () => this.reverse(this.pageCanvas(), arrows()),
      },
      {
        id: 'canvas-show-relationship',
        name: 'Show one kind of relationship…',
        icon: 'eye',
        check: () => this.enabled && !!this.pageCanvas(),
        run: () => this.chooseShown(this.pageCanvas()),
      },
      {
        id: 'canvas-find-statement',
        name: 'Find a statement on the canvas…',
        icon: 'search',
        check: () => this.enabled && !!this.pageCanvas(),
        run: () => this.chooseStatement(this.pageCanvas()),
      },
      {
        id: 'canvas-statements-note',
        name: 'Make a note of what the canvas states',
        icon: 'file-text',
        check: () => this.enabled && !!this.pageCanvas(),
        run: () => this.statementsNote(this.pageCanvas()),
      },
      {
        id: 'canvas-toggle-related',
        name: 'Make the selected arrows related, or part of a branch again',
        icon: 'git-compare-arrows',
        check: () => this.enabled && arrows().length > 0,
        run: () => {
          const edges = arrows();
          this.setRelated(this.pageCanvas(), edges, !edges.every(isRelated));
        },
      },
    ];
  }

  register() {
    super.register();
    this.plugin.registerEvent(
      this.app.workspace.on('canvas:edge-menu', (menu, edge) => {
        if (this.enabled && edge) this.addEdgeItems(menu, [edge]);
      })
    );
  }

  /** The relationship names, as set. */
  names() {
    return this.types().map((t) => t.name);
  }

  typeNamed(name) {
    return this.types().find((t) => t.name === name) || { name, inverse: '', category: 'association', line: 'solid', color: '' };
  }

  /** On the selection's menu too, for arrows chosen with cards. */
  addMenuItems(menu, items) {
    const edges = items.filter(isCanvasEdge);
    if (edges.length && edges.length !== items.length) return;
    if (edges.length) this.addEdgeItems(menu, edges);
  }

  addEdgeItems(menu, edges) {
    const view = edges[0] && edges[0].canvas && edges[0].canvas.view;
    if (!view || !view.canvas || view.canvas.readonly) return;
    const kind = edges.length === 1 ? relationOf(edges[0]) || String(edgeData(edges[0]).label || '') : null;
    const typed = edges.some((e) => relationInfo(e));
    const related = edges.every(isRelated);
    menuGroup(
      menu,
      'Relationship',
      'tag',
      (into, nested) => {
        const name = (title) => (nested ? title : `Relationship: ${title}`);
        this.types().forEach((t) => {
          into.addItem((item) => {
            item.setTitle(name(t.name)).setChecked(kind === t.name);
            if (!nested) canvasAction(item);
            item.onClick(() => this.setRelation(view, edges, kind === t.name ? null : t));
          });
        });
        if (edges.length === 1) {
          into.addItem((item) => {
            item.setTitle(name('Proposition…')).setIcon('quote').setChecked(kind === PROPOSITION);
            if (!nested) canvasAction(item);
            item.onClick(() => this.askProposition(view, edges[0]));
          });
        }
        if (typed) {
          into.addItem((item) => {
            item.setTitle(name('None')).setIcon('x');
            if (!nested) canvasAction(item);
            item.onClick(() => this.setRelation(view, edges, null));
          });
        }
      },
      'action'
    );
    if (edges.every((e) => this.canReverse(e))) {
      menu.addItem((item) =>
        canvasAction(item)
          .setTitle('Reverse the relationship')
          .setIcon('arrow-left-right')
          .onClick(() => this.reverse(view, edges))
      );
    }
    // What a kind or proposition says decides that itself.
    if (!typed) {
      menu.addItem((item) =>
        canvasAction(item)
          .setTitle(related ? 'Make part of the branch' : 'Make related, not a branch')
          .setIcon(related ? 'git-branch' : 'git-compare-arrows')
          .onClick(() => this.setRelated(view, edges, !related))
      );
    }
  }

  /**
   * The arrows made one kind of relationship — read along the arrow as
   * their label, the meaning kept apart from it, drawn with the kind's
   * line and colour; hierarchy in the branch, association out of it — or,
   * given null, none: label, meaning and look taken away, a branch again.
   * Saved, a step of Undo.
   */
  setRelation(view, edges, type) {
    const arrows = this.plugin.feature(CanvasArrows);
    let any = false;
    let tree = false;
    edges.forEach((edge) => {
      try {
        if (typeof edge.setData !== 'function') return;
        const info = relationInfo(edge);
        const was = info && info.kind ? this.typeNamed(info.kind) : null;
        const next = Object.assign({}, edgeData(edge));
        delete next[RELATION_KEY];
        let meaning = null;
        if (type) {
          const hierarchy = type.category === 'hierarchy';
          const { tail, head } = arrowEnds(edge);
          // A hierarchy's arrow runs from the broader card down: read along it, the other way.
          next.label = hierarchy && type.inverse ? type.inverse : type.name;
          meaning = { kind: type.name, subject: ((hierarchy ? head : tail) || {}).id, object: ((hierarchy ? tail : head) || {}).id };
        } else delete next.label;
        // Its colour: the kind's, or, where the kind it was gave it one, none.
        if (type && type.color) next.color = type.color;
        else if (was && was.color && String(next.color) === String(was.color)) delete next.color;
        edge.setData(next);
        if (!edge.unknownData) edge.unknownData = {};
        if (meaning) edge.unknownData[RELATION_KEY] = meaning;
        else delete edge.unknownData[RELATION_KEY];
        if (type || info) tree = this.markRelated(edge, !!type && type.category !== 'hierarchy') || tree;
        // Its line, drawn by the arrow styles.
        if (arrows && typeof arrows.setStyle === 'function' && (type || was)) {
          arrows.setStyle(view, [edge], { line: type ? type.line || 'solid' : 'solid' });
        }
        if (typeof edge.render === 'function') edge.render();
        any = true;
      } catch (err) {
        /* left as it was */
      }
    });
    if (any) this.changed(view, tree);
    return any;
  }

  /** The arrow's two cards, put in words, to say what one says of the other. */
  askProposition(view, edge) {
    if (!view || !view.canvas || !edge) return;
    const model = canvasModel(view.canvas);
    const info = relationInfo(edge) || {};
    const { subject, object } = statementEnds(edge, info, info.kind ? this.typeNamed(info.kind) : null);
    if (!subject || !object) return;
    const card = (node) => ({ id: node.id, label: canvasCardLabel(model.byId.get(node.id)) });
    const modal = new PropositionModal(this.app, { subject: card(subject), object: card(object), predicate: info.predicate || '' }, (predicate, subjectId) =>
      predicate ? this.setProposition(view, edge, predicate, subjectId) : relationInfo(edge) && this.setRelation(view, [edge], null)
    );
    modal.open();
    return modal;
  }

  /**
   * The arrow made a proposition: the words its label, its head at the
   * object, the meaning kept apart, out of the branch. Saved, a step of Undo.
   */
  setProposition(view, edge, predicate, subjectId) {
    const a = edge && edge.from && edge.from.node;
    const b = edge && edge.to && edge.to.node;
    if (!a || !b || typeof edge.setData !== 'function' || !String(predicate || '').trim()) return false;
    const subject = subjectId === b.id ? b : a;
    const object = subject === a ? b : a;
    try {
      const info = relationInfo(edge);
      const was = info && info.kind ? this.typeNamed(info.kind) : null;
      const next = Object.assign({}, edgeData(edge));
      delete next[RELATION_KEY];
      next.label = String(predicate).trim();
      next.fromEnd = object === a ? 'arrow' : 'none';
      next.toEnd = object === b ? 'arrow' : 'none';
      if (was && was.color && String(next.color) === String(was.color)) delete next.color;
      edge.setData(next);
      this.setEnds(edge, next.fromEnd, next.toEnd);
      if (!edge.unknownData) edge.unknownData = {};
      edge.unknownData[RELATION_KEY] = { predicate: next.label, subject: subject.id, object: object.id };
      const tree = this.markRelated(edge, true);
      const arrows = this.plugin.feature(CanvasArrows);
      if (was && arrows && typeof arrows.setStyle === 'function') arrows.setStyle(view, [edge], { line: 'solid' });
      if (typeof edge.render === 'function') edge.render();
      this.changed(view, tree);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Whether an arrow's relationship can turn round: one not holding the branches. */
  canReverse(edge) {
    if (!isRelated(edge)) return false;
    const info = relationInfo(edge);
    return !(info && info.kind && this.typeNamed(info.kind).category === 'hierarchy');
  }

  /** The arrows turned round: heads at the other ends, subject and object swapped. Saved, a step of Undo. */
  reverse(view, edges) {
    let any = false;
    edges.forEach((edge) => {
      if (!this.canReverse(edge) || typeof edge.setData !== 'function') return;
      try {
        const next = Object.assign({}, edgeData(edge));
        const fromEnd = (edge.from && edge.from.end) || 'none';
        const toEnd = (edge.to && edge.to.end) || 'arrow';
        next.fromEnd = toEnd;
        next.toEnd = fromEnd;
        const info = relationInfo(edge);
        if (info) {
          const { subject, object } = statementEnds(edge, info, info.kind ? this.typeNamed(info.kind) : null);
          next[RELATION_KEY] = Object.assign({}, info, { subject: object && object.id, object: subject && subject.id });
        }
        edge.setData(next);
        this.setEnds(edge, next.fromEnd, next.toEnd);
        if (info) {
          if (!edge.unknownData) edge.unknownData = {};
          edge.unknownData[RELATION_KEY] = next[RELATION_KEY];
        }
        if (typeof edge.render === 'function') edge.render();
        any = true;
      } catch (err) {
        /* left as it was */
      }
    });
    if (any) this.changed(view, false);
    return any;
  }

  /** Where the canvas didn't take the arrow's new ends from its data, they're set as it keeps them. */
  setEnds(edge, fromEnd, toEnd) {
    try {
      if (edge.from && typeof edge.from === 'object' && edge.from.end !== fromEnd) edge.from.end = fromEnd;
      if (edge.to && typeof edge.to === 'object' && edge.to.end !== toEnd) edge.to.end = toEnd;
    } catch (err) {
      /* drawn as the canvas has them */
    }
  }

  /** Out of the branches, or in; whether that changed. */
  markRelated(edge, on) {
    if (isRelated(edge) === on) return false;
    if (!edge.unknownData) edge.unknownData = {};
    if (on) edge.unknownData[RELATED_KEY] = true;
    else delete edge.unknownData[RELATED_KEY];
    return true;
  }

  /** What the canvas states: each arrow given a kind or proposition, in words. */
  statements(view) {
    const out = [];
    if (!view || !view.canvas || !view.canvas.edges) return out;
    const model = canvasModel(view.canvas);
    view.canvas.edges.forEach((edge) => {
      const info = relationInfo(edge);
      if (!info) return;
      const type = info.kind ? this.typeNamed(info.kind) : null;
      const ends = statementEnds(edge, info, type);
      const subject = ends.subject && model.byId.get(ends.subject.id);
      const object = ends.object && model.byId.get(ends.object.id);
      if (!subject || !object) return;
      const category = info.predicate ? 'proposition' : type.category === 'hierarchy' ? 'hierarchy' : 'association';
      out.push({ edge, category, subject, object, verb: String(info.predicate || type.name) });
    });
    return out;
  }

  /** A statement chosen by its words: its arrow selected, both cards in view. */
  chooseStatement(view) {
    const found = this.statements(view);
    if (!found.length) {
      new Notice('Nothing on this canvas says what it means yet: give an arrow a kind of relationship, or a proposition.');
      return;
    }
    const names = { hierarchy: 'Hierarchy', association: 'Association', proposition: 'Proposition' };
    const items = found.map((s) => ({ label: `${canvasCardLabel(s.subject)} ${s.verb} ${canvasCardLabel(s.object)}`, note: names[s.category], s }));
    new ComparePicker(this.app, items, 'Find a statement', (item) => this.goToStatement(view, item.s)).open();
  }

  async goToStatement(view, s) {
    const canvas = view.canvas;
    const find = this.plugin.feature(CanvasFind);
    // Brought out of any folds first.
    for (const rec of [s.subject, s.object]) if (rec.tuck && find) await find.goTo(view, rec.id);
    try {
      const model = canvasModel(canvas);
      const box = boundsOf([model.byId.get(s.subject.id) || s.subject, model.byId.get(s.object.id) || s.object]);
      if (typeof canvas.selectOnly === 'function') canvas.selectOnly(s.edge);
      const pad = 60;
      if (typeof canvas.zoomToBbox === 'function') canvas.zoomToBbox({ minX: box.x - pad, minY: box.y - pad, maxX: box.x + box.width + pad, maxY: box.y + box.height + pad });
    } catch (err) {
      /* left where it was */
    }
  }

  /** What the canvas states, as Markdown: hierarchy, associations, propositions; note cards as links. */
  statementsMarkdown(view, found) {
    const from = view.file && view.file.path ? view.file.path : '';
    const name = (rec) => (rec.type === 'file' && rec.file ? canvasCardLink(this.app, rec, from) : canvasCardLabel(rec));
    const sections = [
      ['hierarchy', 'Hierarchy'],
      ['association', 'Associations'],
      ['proposition', 'Propositions'],
    ];
    const out = [];
    sections.forEach(([category, title]) => {
      const lines = found
        .filter((s) => s.category === category)
        .map((s) => `- ${name(s.subject)} ${s.verb} ${name(s.object)}`)
        .sort(byName);
      if (!lines.length) return;
      if (out.length) out.push('');
      out.push(`## ${title}`, '', ...lines);
    });
    return out.join('\n') + '\n';
  }

  /** What the canvas states, written as a note beside it and opened in a new tab. */
  async statementsNote(view) {
    if (!view || !view.canvas) return null;
    const found = this.statements(view);
    if (!found.length) {
      new Notice('Nothing on this canvas says what it means yet: give an arrow a kind of relationship, or a proposition.');
      return null;
    }
    const base = `${(view.file && view.file.basename) || 'Canvas'} statements`;
    const folder = view.file && view.file.parent ? view.file.parent : null;
    const path = this.plugin.freeChildPath(folder, base, 'md');
    let file = null;
    try {
      file = await this.app.vault.create(path, this.statementsMarkdown(view, found));
    } catch (err) {
      console.error('Design Redux: could not make the note', err);
      new Notice('Could not make the note.');
      return null;
    }
    new Notice(`Made “${file.basename}”.`);
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf) await leaf.openFile(file);
    return file;
  }

  /** The kinds used on a canvas, how many each, to pick one to show alone. */
  chooseShown(view) {
    const counts = new Map();
    view.canvas.edges.forEach((e) => {
      const k = relationOf(e);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    });
    if (!counts.size) {
      new Notice('No arrow on this canvas has a kind of relationship yet.');
      return;
    }
    const items = Array.from(counts.entries())
      .sort((a, b) => byName(a[0], b[0]))
      .map(([name, n]) => ({ label: name, note: `${n} ${n === 1 ? 'arrow' : 'arrows'}`, name }));
    new ComparePicker(this.app, items, 'Show only arrows of this kind', (item) => this.show(view, item.name)).open();
  }

  /** Only one kind's arrows, and the cards they join, lit; the rest faded. Escape, or null, shows all again. */
  show(view, name) {
    const state = this.watched.get(view);
    if (!state) return;
    state.only = name || null;
    if (state.only && !state.onKey) {
      state.onKey = (evt) => {
        if (evt.key === 'Escape' && !typingInto(evt.target)) this.show(view, null);
      };
      view.containerEl.addEventListener('keydown', state.onKey);
    }
    if (!state.only && state.onKey) {
      view.containerEl.removeEventListener('keydown', state.onKey);
      state.onKey = null;
    }
    this.pass(view, state);
  }

  /** The arrows made related — out of the branches — or part of them again. */
  setRelated(view, edges, on) {
    let any = false;
    edges.forEach((edge) => {
      if (edge && this.markRelated(edge, on)) any = true;
    });
    if (!any) return false;
    this.changed(view, true);
    return true;
  }

  /** Saved and redrawn; where the branches are different now, folds and the outline look again. */
  changed(view, tree) {
    this.pass(view);
    this.saved(view);
    if (!tree) return;
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.schedule(view);
    this.app.workspace.trigger('design-redux:canvas-changed', view);
  }

  saved(view) {
    try {
      if (view && view.canvas) view.canvas.requestSave();
    } catch (err) {
      /* saved with the canvas's next change */
    }
  }

  /** Each redraw: plain related arrows dashed, propositions' labels marked; while one kind is shown alone, it lit and the rest faded. */
  pass(view, state) {
    if (!view || !view.canvas || !view.canvas.edges) return;
    state = state || this.watched.get(view);
    const only = state && state.only;
    const lit = new Set();
    try {
      view.canvas.edges.forEach((edge) => {
        const kind = relationOf(edge);
        const plain = isRelated(edge) && !kind;
        const shown = !!only && kind === only;
        if (shown) {
          if (edge.from && edge.from.node) lit.add(edge.from.node);
          if (edge.to && edge.to.node) lit.add(edge.to.node);
        }
        const label = edge.labelElement && edge.labelElement.wrapperEl;
        [edge.lineGroupEl, edge.lineEndGroupEl, label].forEach((el) => {
          if (!el || !el.classList) return;
          if (el !== label) el.classList.toggle('dr-related-edge', plain);
          el.classList.toggle('dr-proposition-edge', kind === PROPOSITION);
          el.classList.toggle('dr-relation-lit', shown);
        });
      });
      view.contentEl.classList.toggle('dr-relation-only', !!only);
      view.canvas.nodes.forEach((node) => {
        if (node.nodeEl) node.nodeEl.classList.toggle('dr-relation-lit', lit.has(node));
      });
    } catch (err) {
      /* drawn as the canvas draws them */
    }
  }

  cleanup(view, state) {
    if (state && state.onKey && view.containerEl) view.containerEl.removeEventListener('keydown', state.onKey);
    if (!view.contentEl) return;
    view.contentEl.classList.remove('dr-relation-only');
    view.contentEl
      .querySelectorAll('.dr-related-edge, .dr-proposition-edge, .dr-relation-lit')
      .forEach((el) => el.classList.remove('dr-related-edge', 'dr-proposition-edge', 'dr-relation-lit'));
  }
}

CanvasRelations.settingKey = 'canvasRelations';
