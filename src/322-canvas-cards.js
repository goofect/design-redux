/* ------------------------------------------------------------------ */
/* Cards that hold more                                                */
/*                                                                     */
/* A text card grows to fit what's typed in it, up to a limit, rather   */
/* than scrolling inside, and shrinks back as far as it was when typing */
/* began; a card below it in the way moves down. Fit to text sizes      */
/* selected cards to their text. And a card's first line can read as   */
/* its title, with the rest smaller beneath it as its details.         */
/* ------------------------------------------------------------------ */

/* The tallest a card grows to by itself. */
const CARD_FIT_MAX = 800;

/* Below a card's last line, as the card's own editor leaves. */
const CARD_FIT_PAD = 10;

/** Whether a canvas card is a text card. */
function isTextCard(node) {
  try {
    const data = node && typeof node.getData === 'function' ? node.getData() : node;
    return !!data && (data.type || 'text') === 'text';
  } catch (err) {
    return false;
  }
}

/** The editor of a card being typed in, if it can be reached. */
function cardEditor(node) {
  const mode = node && node.child && node.child.editMode;
  const cm = mode && mode.cm;
  return cm && cm.scrollDOM ? cm : null;
}

/**
 * How tall a card being typed in needs to be for all its text to show:
 * its text's height, the room below it, and the card's own edge. 0 where
 * it can't be told.
 */
function editingHeight(node, state) {
  const cm = cardEditor(node);
  if (!cm) return 0;
  const sd = cm.scrollDOM;
  const shown = sd.clientHeight;
  const text = cm.contentHeight;
  if (!shown || typeof text !== 'number') return 0;
  // The room below the text, read where the text overflows, and kept.
  if (sd.scrollHeight > shown + 1 && state) state.pad = Math.max(0, sd.scrollHeight - text);
  const pad = state && typeof state.pad === 'number' ? state.pad : CARD_FIT_PAD;
  return Math.ceil(text + pad + (node.height - shown));
}

/** How tall a card shown as text needs to be for all of it to show, or 0. */
function renderedHeight(node) {
  const el = node && node.nodeEl;
  const view = el && el.querySelector('.markdown-preview-view');
  const sizer = view && view.querySelector('.markdown-preview-sizer');
  if (!view || !sizer || !view.clientHeight) return 0;
  const blocks = Array.from(sizer.children).filter((c) => !c.classList.contains('markdown-preview-pusher') && c.offsetHeight);
  const last = blocks[blocks.length - 1];
  if (!last) return 0;
  return Math.ceil(last.offsetTop + last.offsetHeight + 4 + (node.height - view.clientHeight));
}

/**
 * A text card's title: its first line as typed, up to the first line
 * break, wrapped so it can be styled whole however it wraps on screen.
 * Done again whenever Obsidian draws the card's text afresh.
 */
function markCardTitle(el) {
  const sizer = el && el.querySelector('.markdown-preview-sizer');
  if (!sizer) return;
  const first = Array.from(sizer.children).find(
    (c) => !c.classList.contains('markdown-preview-pusher') && !c.classList.contains('mod-frontmatter')
  );
  const p = first && first.classList.contains('el-p') ? first.querySelector(':scope > p') : null;
  if (!p || !p.firstChild) return;
  const head = p.firstChild;
  if (head.nodeType === 1 && head.classList.contains('dr-card-title')) return;
  const title = p.ownerDocument.createElement('span');
  title.className = 'dr-card-title';
  while (p.firstChild && p.firstChild.nodeName !== 'BR') title.appendChild(p.firstChild);
  p.insertBefore(title, p.firstChild);
}

class CanvasCards extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasCardFit',
        name: 'Grow to fit',
        desc: 'A card grows to fit its text as you type, moving a card below out of the way. Fit to text in its menu does it by hand.',
      },
      {
        key: 'canvasCardTitles',
        name: 'Title and details',
        desc: 'A card’s first line shows as its title, and the rest smaller beneath it.',
      },
    ];
  }

  get enabled() {
    return !!(this.settings.canvasCardFit || this.settings.canvasCardTitles);
  }

  enable() {
    document.body.toggleClass('dr-card-titles', !!this.settings.canvasCardTitles);
    super.enable();
  }

  disable() {
    document.body.removeClass('dr-card-titles');
    super.disable();
  }

  actions() {
    const cards = (ctx) => (ctx.view.canvas.readonly ? [] : this.fitTargets(ctx.nodes));
    return [
      {
        id: 'fit-canvas-cards',
        name: 'Fit the selected cards to their text',
        menu: 'Fit to text',
        icon: 'fold-vertical',
        on: 'canvas',
        when: (ctx) => cards(ctx).length > 0,
        run: (ctx) => this.fitToText(ctx.view, cards(ctx)),
      },
    ];
  }

  /** The text cards of these, not being typed in. */
  fitTargets(nodes) {
    return nodes.filter((n) => n && n.nodeEl && !n.isEditing && isTextCard(n) && !tuckOf(n));
  }

  mount(view, state) {
    state.fitting = new Map();
    const win = view.containerEl && view.containerEl.ownerDocument.defaultView;
    state.timer = (win || window).setInterval(() => this.fitEditing(view, state), 200);
    state.win = win || window;
  }

  cleanup(view, state) {
    if (state && state.timer) state.win.clearInterval(state.timer);
    view.contentEl.querySelectorAll('.dr-text-card').forEach((el) => el.removeClass('dr-text-card'));
  }

  /* Text cards marked, for their title and details. */
  pass(view) {
    if (!view.canvas || !view.canvas.nodes) return;
    view.canvas.nodes.forEach((node) => {
      if (!node.nodeEl) return;
      const text = isTextCard(node);
      node.nodeEl.toggleClass('dr-text-card', text);
      if (text && this.settings.canvasCardTitles) markCardTitle(node.nodeEl);
    });
  }

  /**
   * The card being typed in, sized to its text: no shorter than it was
   * when typing began, no taller than the limit. Saved once typing ends.
   */
  fitEditing(view, state) {
    const canvas = view.canvas;
    if (!this.settings.canvasCardFit || !canvas || !canvas.nodes || canvas.readonly) return;
    canvas.nodes.forEach((node) => {
      const was = state.fitting.get(node.id);
      if (!node.isEditing || !isTextCard(node)) {
        if (was) {
          state.fitting.delete(node.id);
          if (was.changed) this.save(view);
        }
        return;
      }
      const fit = was || { start: node.height, changed: false };
      state.fitting.set(node.id, fit);
      const want = editingHeight(node, fit);
      if (!want) return;
      const height = Math.min(CARD_FIT_MAX, Math.max(fit.start, want));
      if (Math.abs(height - node.height) < 2) return;
      if (this.resize(view, node, height)) fit.changed = true;
    });
  }

  /** Selected cards sized to their text, as shown: grown or shrunk. Saved, a step of Undo. */
  fitToText(view, nodes) {
    if (!view || !view.canvas) return false;
    let any = false;
    (nodes || []).forEach((node) => {
      const want = renderedHeight(node);
      if (want && Math.abs(want - node.height) >= 2 && this.resize(view, node, Math.min(CARD_FIT_MAX, Math.max(40, want)))) any = true;
    });
    if (any) this.save(view);
    return any;
  }

  /**
   * A card made `height` tall. A card below it, in line with it, that
   * it would now run into moves down just far enough, with what's below
   * that; the group it's in grows round it.
   */
  resize(view, node, height) {
    const model = canvasModel(view.canvas);
    const rec = model.byId.get(node.id);
    if (!rec || rec.tuck) return false;
    const before = snapshotModel(model);
    const bottom = rec.y + rec.height;
    rec.height = height;
    const homes = homesBefore(model, before);
    const home = homes.get(rec.id) || null;
    const below = model.nodes.filter(
      (n) =>
        n !== rec &&
        !n.tuck &&
        !isGroupRecord(n) &&
        homes.get(n.id) === home &&
        n.y >= bottom - 1 &&
        Math.min(n.x + n.width, rec.x + rec.width) - Math.max(n.x, rec.x) > 1
    );
    if (below.length) {
      const top = Math.min(...below.map((n) => n.y));
      const need = rec.y + height + canvasGap(FREE_GAP) - top;
      if (need > 0) {
        makeRoom(model, before, { origin: new Set([rec.id]), home, axis: 'y', side: 'after', at: top, delta: need, span: [rec.x, rec.x + rec.width] });
      }
    }
    const group = home ? model.byId.get(home) : null;
    if (group && !withinRect(rec, group)) fitGroups(model, before);
    return applyCanvasModel(model, before);
  }

  save(view) {
    saveCanvas(view.canvas);
  }
}
