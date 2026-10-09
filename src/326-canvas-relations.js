/* ------------------------------------------------------------------ */
/* Canvas: relationships                                               */
/*                                                                     */
/* An arrow says how two cards relate. Its menu gives it a name from a */
/* list — is a type of, causes, contrasts with — as its label, which   */
/* the canvas shows as it is. And it can be made Related: two cards    */
/* that go together without one hanging from the other. A related      */
/* arrow is drawn dashed and kept out of branches — folding, tidying,  */
/* laying out and the outline pass it by. It's marked in the arrow's   */
/* own data, so the canvas stays one Obsidian opens as it is.          */
/* ------------------------------------------------------------------ */

const DEFAULT_RELATIONS = 'is a type of, is part of, depends on, causes, contrasts with, supports, exemplifies, governed by';

/* On an arrow: which kind of relationship it is, apart from its label, which can be edited. */
const RELATION_KEY = 'drRelation';

/* Each kind's line — solid, dashed or dotted — and colour: one of the canvas's six, or none. Grey by default. */
const DEFAULT_RELATION_TYPES = [
  { name: 'is a type of', line: 'solid', color: '' },
  { name: 'is part of', line: 'solid', color: '' },
  { name: 'depends on', line: 'dashed', color: '' },
  { name: 'causes', line: 'solid', color: '' },
  { name: 'contrasts with', line: 'dotted', color: '' },
  { name: 'supports', line: 'solid', color: '' },
  { name: 'exemplifies', line: 'dashed', color: '' },
  { name: 'governed by', line: 'solid', color: '' },
];

const RELATION_COLORS = { '': 'No colour', 1: 'Red', 2: 'Orange', 3: 'Yellow', 4: 'Green', 5: 'Cyan', 6: 'Purple' };

function relationOf(edge) {
  return (edge && edge.unknownData && edge.unknownData[RELATION_KEY]) || '';
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

class CanvasRelations extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasRelations',
        name: 'Relationships',
        desc: 'An arrow’s menu names how its cards relate, or makes it Related: drawn dashed and kept out of branches.',
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

  /** The kinds of relationship, as set: { name, line, color }. */
  types() {
    const set = Array.isArray(this.settings.canvasRelationTypes) ? this.settings.canvasRelationTypes.filter((t) => t && String(t.name || '').trim()) : [];
    if (set.length) return set;
    // Names set before kinds had styles: each as the default of that name has, or plain.
    const names = String(this.settings.canvasRelationNames || '').trim();
    if (!names) return DEFAULT_RELATION_TYPES;
    return names
      .split(',')
      .map((n) => n.trim())
      .filter((n, i, all) => n && all.indexOf(n) === i)
      .map((name) => DEFAULT_RELATION_TYPES.find((t) => t.name === name) || { name, line: 'solid', color: '' });
  }

  /** The settings' list of kinds: a name, a line and a colour each, and one to add. */
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
      new Setting(block).setName('Kinds of relationship').setDesc('Offered on an arrow’s menu. Each draws its arrows its own way.').setHeading();
      list.forEach((type, i) => {
        const row = new Setting(block).setClass('dr-relation-type');
        row.addText((t) => t.setValue(type.name).setPlaceholder('Name').onChange((v) => {
          list[i].name = v.trim();
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
          save(list.length ? list : [{ name: 'relates to', line: 'solid', color: '' }]);
          draw();
        }));
      });
      new Setting(block).addButton((b) => b.setButtonText('Add a kind').onClick(() => {
        list.push({ name: 'new relationship', line: 'solid', color: '' });
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
        id: 'canvas-show-relationship',
        name: 'Show one kind of relationship…',
        icon: 'eye',
        check: () => this.enabled && !!this.pageCanvas(),
        run: () => this.chooseShown(this.pageCanvas()),
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
    return this.types().find((t) => t.name === name) || { name, line: 'solid', color: '' };
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
        if (kind) {
          into.addItem((item) => {
            item.setTitle(name('None')).setIcon('x');
            if (!nested) canvasAction(item);
            item.onClick(() => this.setRelation(view, edges, null));
          });
        }
      },
      'action'
    );
    menu.addItem((item) =>
      canvasAction(item)
        .setTitle(related ? 'Make part of the branch' : 'Make related, not a branch')
        .setIcon(related ? 'git-branch' : 'git-compare-arrows')
        .onClick(() => this.setRelated(view, edges, !related))
    );
  }

  /**
   * The arrows made one kind of relationship — its name as their label,
   * the kind kept apart from it, drawn with the kind's line and colour —
   * or, given null, none: label, kind and the kind's look taken away.
   * Saved, a step of Undo.
   */
  setRelation(view, edges, type) {
    const arrows = this.plugin.feature(CanvasArrows);
    let any = false;
    edges.forEach((edge) => {
      try {
        if (typeof edge.setData !== 'function') return;
        const was = relationOf(edge) ? this.typeNamed(relationOf(edge)) : null;
        const data = edgeData(edge);
        const next = Object.assign({}, data);
        delete next[RELATION_KEY];
        if (type) next.label = type.name;
        else delete next.label;
        // Its colour: the kind's, or, where the kind it was gave it one, none.
        if (type && type.color) next.color = type.color;
        else if (was && was.color && String(next.color) === String(was.color)) delete next.color;
        edge.setData(next);
        if (!edge.unknownData) edge.unknownData = {};
        if (type) edge.unknownData[RELATION_KEY] = type.name;
        else delete edge.unknownData[RELATION_KEY];
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
    if (any) {
      this.saved(view);
      this.pass(view);
    }
    return any;
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
      if (!edge || isRelated(edge) === on) return;
      if (!edge.unknownData) edge.unknownData = {};
      if (on) edge.unknownData[RELATED_KEY] = true;
      else delete edge.unknownData[RELATED_KEY];
      any = true;
    });
    if (!any) return false;
    this.pass(view);
    this.saved(view);
    // The branches are different now: folds and the outline look again.
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.schedule(view);
    this.app.workspace.trigger('design-redux:canvas-changed', view);
    return true;
  }

  saved(view) {
    try {
      if (view && view.canvas) view.canvas.requestSave();
    } catch (err) {
      /* saved with the canvas's next change */
    }
  }

  /** Each redraw: related arrows dashed; while one kind is shown alone, it lit and the rest faded. */
  pass(view, state) {
    if (!view || !view.canvas || !view.canvas.edges) return;
    state = state || this.watched.get(view);
    const only = state && state.only;
    const lit = new Set();
    try {
      view.canvas.edges.forEach((edge) => {
        const on = isRelated(edge);
        const shown = !!only && relationOf(edge) === only;
        if (shown) {
          if (edge.from && edge.from.node) lit.add(edge.from.node);
          if (edge.to && edge.to.node) lit.add(edge.to.node);
        }
        const label = edge.labelElement && edge.labelElement.wrapperEl;
        [edge.lineGroupEl, edge.lineEndGroupEl, label].forEach((el) => {
          if (!el || !el.classList) return;
          if (el !== label) el.classList.toggle('dr-related-edge', on);
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
    view.contentEl.querySelectorAll('.dr-related-edge, .dr-relation-lit').forEach((el) => el.classList.remove('dr-related-edge', 'dr-relation-lit'));
  }
}

CanvasRelations.settingKey = 'canvasRelations';
