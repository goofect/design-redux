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
        key: 'canvasRelationNames',
        type: 'text',
        showIf: 'canvasRelations',
        name: 'Relationship names',
        desc: 'Offered on an arrow’s menu, separated by commas.',
        placeholder: DEFAULT_RELATIONS,
        fallback: '',
      },
    ];
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
          new RelationPicker(this.app, this.names(), (name) => this.setLabel(view, edges, name)).open();
        },
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
    const text = String(this.settings.canvasRelationNames || '').trim() || DEFAULT_RELATIONS;
    return text
      .split(',')
      .map((s) => s.trim())
      .filter((s, i, all) => s && all.indexOf(s) === i);
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
    const label = edges.length === 1 ? String(edgeData(edges[0]).label || '') : null;
    const related = edges.every(isRelated);
    menuGroup(
      menu,
      'Relationship',
      'tag',
      (into, nested) => {
        const name = (title) => (nested ? title : `Relationship: ${title}`);
        this.names().forEach((n) => {
          into.addItem((item) => {
            item.setTitle(name(n)).setChecked(label === n);
            if (!nested) canvasAction(item);
            item.onClick(() => this.setLabel(view, edges, label === n ? '' : n));
          });
        });
        if (label) {
          into.addItem((item) => {
            item.setTitle(name('No name')).setIcon('x');
            if (!nested) canvasAction(item);
            item.onClick(() => this.setLabel(view, edges, ''));
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

  /** The arrows named, as their label. Saved, a step of Undo. */
  setLabel(view, edges, label) {
    let any = false;
    edges.forEach((edge) => {
      try {
        if (typeof edge.setData !== 'function') return;
        const data = edgeData(edge);
        if (String(data.label || '') === label) return;
        const next = Object.assign({}, data);
        if (label) next.label = label;
        else delete next.label;
        edge.setData(next);
        if (typeof edge.render === 'function') edge.render();
        any = true;
      } catch (err) {
        /* left as it was */
      }
    });
    if (any) this.saved(view);
    return any;
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

  /** Each redraw: related arrows dashed. */
  pass(view) {
    if (!view || !view.canvas || !view.canvas.edges) return;
    try {
      view.canvas.edges.forEach((edge) => {
        const on = isRelated(edge);
        [edge.lineGroupEl, edge.lineEndGroupEl].forEach((el) => {
          if (el && el.classList) el.classList.toggle('dr-related-edge', on);
        });
      });
    } catch (err) {
      /* drawn as the canvas draws them */
    }
  }

  cleanup(view) {
    if (!view.contentEl) return;
    view.contentEl.querySelectorAll('.dr-related-edge').forEach((el) => el.classList.remove('dr-related-edge'));
  }
}

CanvasRelations.settingKey = 'canvasRelations';
