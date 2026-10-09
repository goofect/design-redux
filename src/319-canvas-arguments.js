/* ------------------------------------------------------------------ */
/* Canvas: arguments                                                   */
/*                                                                     */
/* A card can have a part in an argument: a claim, a reason for it, an */
/* objection to it, a rebuttal of that, or evidence. Its part shows as */
/* a word above it and a stripe down its side, so the reasoning reads  */
/* apart from the rest of the map; a claim counts what's for it and    */
/* what's against. Add a reason, or an objection, makes the card and   */
/* names its arrow — supports, opposes. The part is kept in the card's */
/* own data.                                                           */
/* ------------------------------------------------------------------ */

const ROLE_KEY = 'drRole';

/* Each part: its name, and what its arrow from the card it answers says. */
const ARGUMENT_ROLES = {
  claim: { name: 'Claim', icon: 'message-square-quote', arrow: '' },
  reason: { name: 'Reason', icon: 'thumbs-up', arrow: 'supports' },
  objection: { name: 'Objection', icon: 'thumbs-down', arrow: 'opposes' },
  rebuttal: { name: 'Rebuttal', icon: 'undo-2', arrow: 'rebuts' },
  evidence: { name: 'Evidence', icon: 'file-check', arrow: 'evidence for' },
};

function roleOf(node) {
  const role = node && node.unknownData && node.unknownData[ROLE_KEY];
  return ARGUMENT_ROLES[role] ? role : null;
}

/** What's for a card and what's against it, among the cards that answer it. */
function argumentTally(model, links, id) {
  let pro = 0;
  let con = 0;
  (links.children.get(id) || []).forEach((c) => {
    const rec = model.byId.get(c);
    const role = rec && rec.node ? roleOf(rec.node) : rec && rec.role;
    if (role === 'reason' || role === 'evidence') pro++;
    else if (role === 'objection') con++;
  });
  return { pro, con };
}

class CanvasArguments extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasArguments',
        name: 'Arguments',
        desc: 'A card’s menu gives it a part in an argument — claim, reason, objection, rebuttal, evidence — shown above it, and adds reasons and objections.',
      },
    ];
  }

  commands() {
    const one = () => {
      const view = this.enabled ? this.pageCanvas() : null;
      const nodes = this.selectedNodes(view).filter((n) => !isCanvasEdge(n) && !isGroupNode(n));
      return nodes.length === 1 ? nodes[0] : null;
    };
    const adds = ['reason', 'objection', 'rebuttal', 'evidence'].map((role) => ({
      id: `canvas-add-${role}`,
      name: { reason: 'Add a reason for the selected card', objection: 'Add an objection to the selected card', rebuttal: 'Add a rebuttal of the selected card', evidence: 'Add evidence for the selected card' }[role],
      icon: ARGUMENT_ROLES[role].icon,
      check: () => !!one(),
      run: () => this.addAnswer(this.pageCanvas(), one(), role),
    }));
    return [
      {
        id: 'canvas-make-claim',
        name: 'Make the selected card a claim',
        icon: ARGUMENT_ROLES.claim.icon,
        check: () => !!one(),
        run: () => this.setRole(this.pageCanvas(), [one()], 'claim'),
      },
    ].concat(adds);
  }

  addMenuItems(menu, nodes) {
    const cards = nodes.filter((n) => !isCanvasEdge(n) && !isGroupNode(n));
    if (!cards.length || cards.length !== nodes.length) return;
    const view = cards[0].canvas && cards[0].canvas.view;
    if (!view || !view.canvas || view.canvas.readonly) return;
    const current = cards.every((n) => roleOf(n) === roleOf(cards[0])) ? roleOf(cards[0]) : undefined;
    menuGroup(
      menu,
      'Argument',
      'scale',
      (into, nested) => {
        const add = (title, icon, run, checked) =>
          into.addItem((item) => {
            item.setTitle(nested ? title : `Argument: ${title.toLowerCase()}`).setIcon(icon);
            if (checked !== undefined && typeof item.setChecked === 'function') item.setChecked(checked);
            if (!nested) canvasAction(item);
            item.onClick(run);
          });
        Object.keys(ARGUMENT_ROLES).forEach((role) => add(ARGUMENT_ROLES[role].name, ARGUMENT_ROLES[role].icon, () => this.setRole(view, cards, current === role ? null : role), current === role));
        if (current) add('No part', 'x', () => this.setRole(view, cards, null));
        if (cards.length === 1) {
          if (typeof into.addSeparator === 'function' && nested) into.addSeparator();
          add('Add a reason', 'thumbs-up', () => this.addAnswer(view, cards[0], 'reason'));
          add('Add an objection', 'thumbs-down', () => this.addAnswer(view, cards[0], 'objection'));
        }
      },
      'action'
    );
  }

  /** The cards given a part — or, given null, none. Saved, a step of Undo. */
  setRole(view, nodes, role) {
    let any = false;
    nodes.forEach((node) => {
      if (!node || roleOf(node) === role) return;
      if (!node.unknownData) node.unknownData = {};
      if (role) node.unknownData[ROLE_KEY] = role;
      else delete node.unknownData[ROLE_KEY];
      any = true;
    });
    if (!any) return false;
    try {
      view.canvas.requestSave();
    } catch (err) {
      /* saved with the canvas's next change */
    }
    this.pass(view);
    return true;
  }

  /**
   * A card answering this one — a reason, objection, rebuttal or evidence —
   * made as Tab makes one, given its part, its arrow named for it, and
   * opened to type in.
   */
  async addAnswer(view, node, role) {
    const mind = this.plugin.feature(CanvasMindMap);
    if (!view || !view.canvas || !node || !mind) return null;
    const made = await mind.addChild(view, node);
    if (!made) return null;
    if (!made.unknownData) made.unknownData = {};
    made.unknownData[ROLE_KEY] = role;
    const label = ARGUMENT_ROLES[role].arrow;
    try {
      view.canvas.edges.forEach((edge) => {
        if (!label || !edge.from || !edge.to || edge.from.node !== node || edge.to.node !== made) return;
        if (typeof edge.setData === 'function' && typeof edge.getData === 'function') {
          edge.setData(Object.assign({}, edge.getData(), { label }));
          if (typeof edge.render === 'function') edge.render();
        }
      });
      view.canvas.requestSave();
    } catch (err) {
      /* the card made, its arrow unnamed */
    }
    this.pass(view);
    return made;
  }

  /** Each redraw: each card's part above it, and a claim's count. */
  pass(view) {
    if (!view || !view.canvas || !view.canvas.nodes) return;
    let model = null;
    let links = null;
    try {
      view.canvas.nodes.forEach((node) => {
        const el = node.nodeEl;
        if (!el) return;
        const role = this.enabled ? roleOf(node) : null;
        if (!role) {
          if (el.dataset.drRole) {
            delete el.dataset.drRole;
            delete el.dataset.drRoleLabel;
          }
          return;
        }
        let label = ARGUMENT_ROLES[role].name;
        if (role === 'claim') {
          if (!model) {
            model = canvasModel(view.canvas);
            links = arrowLinks(model);
          }
          const { pro, con } = argumentTally(model, links, node.id);
          if (pro || con) label += ` · ${pro} for, ${con} against`;
        }
        if (el.dataset.drRole !== role) el.dataset.drRole = role;
        if (el.dataset.drRoleLabel !== label) el.dataset.drRoleLabel = label;
      });
    } catch (err) {
      /* drawn as the canvas draws them */
    }
  }

  cleanup(view) {
    if (!view.contentEl) return;
    view.contentEl.querySelectorAll('[data-dr-role]').forEach((el) => {
      delete el.dataset.drRole;
      delete el.dataset.drRoleLabel;
    });
  }
}

CanvasArguments.settingKey = 'canvasArguments';
CanvasArguments.watchInput = true;
