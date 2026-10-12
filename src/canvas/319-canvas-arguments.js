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

import { addActionItems, canvasMenuContext } from '../core/078-actions.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { arrowLinks, canvasModel, saveCanvas } from './316-canvas-tree.js';
import { canvasAction } from './321-canvas-extras.js';
import { isCanvasEdge } from './332-canvas-arrows.js';
import { CanvasMindMap } from './334-canvas-mindmap.js';
import { isGroupNode } from './335-canvas-fold.js';

export const ROLE_KEY = 'drRole';

/* Each part: its name, and what its arrow from the card it answers says. */
export const ARGUMENT_ROLES = {
  claim: { name: 'Claim', icon: 'message-square-quote', arrow: '' },
  reason: { name: 'Reason', icon: 'thumbs-up', arrow: 'supports' },
  objection: { name: 'Objection', icon: 'thumbs-down', arrow: 'opposes' },
  rebuttal: { name: 'Rebuttal', icon: 'undo-2', arrow: 'rebuts' },
  evidence: { name: 'Evidence', icon: 'file-check', arrow: 'evidence for' },
};

export function roleOf(node) {
  const role = node && node.unknownData && node.unknownData[ROLE_KEY];
  return ARGUMENT_ROLES[role] ? role : null;
}

/** What's for a card and what's against it, among the cards that answer it. */
export function argumentTally(model, links, id) {
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

export class CanvasArguments extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasArguments',
        name: 'Arguments',
        desc: 'A card’s menu gives it a part in an argument — claim, reason, objection, rebuttal, evidence — shown above it, and adds reasons and objections.',
      },
    ];
  }

  /** Each part a card can be given, and the answers a card can be given. */
  actions() {
    // The cards a menu is for, or selected: plain cards, on a canvas that can be changed.
    const cards = (ctx) => {
      const nodes = ctx.nodes.filter((n) => !isCanvasEdge(n) && !isGroupNode(n));
      return this.enabled && nodes.length && nodes.length === ctx.nodes.length && !ctx.view.canvas.readonly ? nodes : null;
    };
    const current = (ctx) => {
      const nodes = cards(ctx);
      return nodes && nodes.every((n) => roleOf(n) === roleOf(nodes[0])) ? roleOf(nodes[0]) : undefined;
    };
    const one = (ctx) => {
      const nodes = cards(ctx);
      return nodes && nodes.length === 1 ? nodes[0] : null;
    };
    const parts = Object.keys(ARGUMENT_ROLES).map((role) => ({
      id: `canvas-make-${role}`,
      name: `Make the selected card a ${ARGUMENT_ROLES[role].name.toLowerCase()}`,
      menu: ARGUMENT_ROLES[role].name,
      icon: ARGUMENT_ROLES[role].icon,
      on: 'canvas',
      // Only a claim has a command of its own; on a menu, a part ticked is taken off again.
      palette: role === 'claim' ? undefined : false,
      checked: (ctx) => current(ctx) === role,
      when: (ctx) => !!cards(ctx),
      run: (ctx) => this.setRole(ctx.view, cards(ctx), ctx.from !== 'palette' && current(ctx) === role ? null : role),
    }));
    const answers = [
      ['reason', 'Add a reason for the selected card', 'Add a reason'],
      ['objection', 'Add an objection to the selected card', 'Add an objection'],
      ['rebuttal', 'Add a rebuttal of the selected card', 'Add a rebuttal'],
      ['evidence', 'Add evidence for the selected card', 'Add evidence'],
    ].map(([role, name, menu]) => ({
      id: `canvas-add-${role}`,
      name,
      menu,
      icon: ARGUMENT_ROLES[role].icon,
      on: 'canvas',
      when: (ctx) => !!one(ctx),
      run: (ctx) => this.addAnswer(ctx.view, one(ctx), role),
    }));
    return parts
      .concat([{ id: 'canvas-clear-part', name: 'No part', icon: 'x', on: 'canvas', palette: false, when: (ctx) => !!current(ctx), run: (ctx) => this.setRole(ctx.view, cards(ctx), null) }])
      .concat(answers);
  }

  addMenuItems(menu, nodes) {
    const ctx = canvasMenuContext(nodes);
    if (ctx) addActionItems(menu, this.actions(), ctx, 'Argument', 'scale', canvasAction);
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
    saveCanvas(view.canvas);
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
