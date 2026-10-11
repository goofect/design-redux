/* ------------------------------------------------------------------ */
/* Canvas: keeping cards in place                                      */
/*                                                                     */
/* A card placed by hand can be kept where it is: laying out and       */
/* tidying leave it, and what hangs from it, as they are. Marked with  */
/* a faint dashed outline, and kept in the card's own data.            */
/* ------------------------------------------------------------------ */

class CanvasPins extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasPins',
        name: 'Keep in place',
        desc: 'A card’s menu can keep it where it is: layouts and Tidy leave it, and what hangs from it, as they are.',
      },
    ];
  }

  actions() {
    // Cards only, on a canvas that can be changed.
    const cards = (ctx) => {
      const found = this.cardsOf(ctx.nodes);
      return this.enabled && !ctx.view.canvas.readonly && found.length && found.length === ctx.nodes.length ? found : [];
    };
    const pinned = (ctx) => cards(ctx).every((n) => this.isPinned(n));
    return [
      {
        id: 'canvas-toggle-keep-in-place',
        name: 'Keep the selected cards in place, or not',
        menu: (ctx) => (pinned(ctx) ? 'Let layouts move it' : 'Keep in place'),
        menuIcon: (ctx) => (pinned(ctx) ? 'pin-off' : 'pin'),
        icon: 'pin',
        on: 'canvas',
        when: (ctx) => cards(ctx).length > 0,
        run: (ctx) => this.setPinned(ctx.view, cards(ctx), !pinned(ctx)),
      },
    ];
  }

  cardsOf(nodes) {
    return (nodes || []).filter((n) => n && !isCanvasEdge(n) && !isGroupNode(n));
  }

  isPinned(node) {
    return !!(node && node.unknownData && node.unknownData[PIN_KEY]);
  }

  /** The cards kept in place, or let go. Saved, a step of Undo. */
  setPinned(view, nodes, on) {
    let any = false;
    nodes.forEach((node) => {
      if (this.isPinned(node) === on) return;
      if (!node.unknownData) node.unknownData = {};
      if (on) node.unknownData[PIN_KEY] = true;
      else delete node.unknownData[PIN_KEY];
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

  /** Each redraw: kept cards marked. */
  pass(view) {
    if (!view || !view.canvas || !view.canvas.nodes) return;
    view.canvas.nodes.forEach((node) => {
      const el = node.nodeEl;
      if (!el) return;
      const on = this.enabled && this.isPinned(node);
      if (on && !('drPinned' in el.dataset)) el.dataset.drPinned = '';
      else if (!on && 'drPinned' in el.dataset) delete el.dataset.drPinned;
    });
  }

  cleanup(view) {
    if (!view.contentEl) return;
    view.contentEl.querySelectorAll('[data-dr-pinned]').forEach((el) => delete el.dataset.drPinned);
  }
}

CanvasPins.settingKey = 'canvasPins';
