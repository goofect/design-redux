/* ------------------------------------------------------------------ */
/* Folding canvas cards                                                */
/*                                                                     */
/* A card folds down to its first line — its heading, or its opening   */
/* words — and unfolds back to the size it was. The size it was is     */
/* kept in the card's own data in the canvas file, which Obsidian       */
/* keeps as it is, so a fold travels with the canvas. A folded card     */
/* resized by hand is simply that size; one opened for editing unfolds. */
/*                                                                     */
/* The canvas can be changed from outside while it's open — by an AI   */
/* writing to it, say — so nothing here saves on its own: the file is  */
/* written only when a card is folded or unfolded by hand. A rewrite   */
/* that drops a fold's record, leaving the card at its folded size,    */
/* gets the record back from memory, so it still unfolds to its size.  */
/* ------------------------------------------------------------------ */

const FOLD_KEY = 'drFold';

/** Cards with words to fold to: text cards, and notes. */
function foldable(node) {
  try {
    const data = node && typeof node.getData === 'function' ? node.getData() : node;
    if (!data) return false;
    if (data.type === 'text') return true;
    return data.type === 'file' && /\.md$/i.test(String(data.file || ''));
  } catch (err) {
    return false;
  }
}

/** A folded card's sizes — as it was, and folded — or null. */
function foldOf(node) {
  const kept = node && node.unknownData && node.unknownData[FOLD_KEY];
  return kept && typeof kept.height === 'number' ? kept : null;
}

/** The first words drawn inside an element, or null. */
function firstWords(el) {
  for (let child = el.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      if (child.textContent.trim()) return child;
    } else if (child.nodeType === 1) {
      const found = firstWords(child);
      if (found) return found;
    }
  }
  return null;
}

/** Where an element's first line ends, on screen. */
function firstLineBottom(el) {
  const words = firstWords(el);
  if (words) {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(words);
    const rects = range.getClientRects();
    if (rects.length && rects[0].height) return rects[0].bottom;
  }
  return el.getBoundingClientRect().bottom;
}

/**
 * Marks the line a folded card keeps — a note's title, or a text card's
 * first block, which folded shows one line of — and returns what holds
 * its words. Everything after it is hidden while the card is folded.
 */
function markFoldLine(el) {
  unmarkFoldLine(el);
  const content = el && el.querySelector('.canvas-node-content');
  if (!content) return null;
  const shown = (e) => !!e && e.getBoundingClientRect().height > 0;
  const title = content.querySelector('.mod-header .inline-title');
  if (shown(title)) {
    title.parentElement.addClass('dr-fold-line');
    return title;
  }
  const first = Array.from(
    content.querySelectorAll('.markdown-preview-sizer > div:not(.markdown-preview-pusher):not(.mod-header):not(.mod-frontmatter)')
  ).find(shown);
  if (first) first.addClass('dr-fold-line');
  return first || null;
}

function unmarkFoldLine(el) {
  if (el) el.querySelectorAll('.dr-fold-line').forEach((e) => e.removeClass('dr-fold-line'));
}

/**
 * How tall a card is with only its title line showing, in the canvas's
 * own units, measured from the card as drawn — folded, so what's below
 * the line is out of the way — with as much room under the line as above
 * it. A card not drawn yet — off screen — gets a line's height, put
 * right once it's drawn.
 */
function foldedHeight(node) {
  const line = 52;
  const el = node && node.nodeEl;
  const was = !!el && el.hasClass('dr-folded');
  let kept = false;
  try {
    if (!el || !el.querySelector('.canvas-node-content')) return { height: Math.min(line, node.height), measured: false };
    if (!was) el.addClass('dr-folded');
    const first = markFoldLine(el);
    if (!first) return { height: Math.min(line, node.height), measured: false };
    const box = el.getBoundingClientRect();
    const scale = box.height && node.height ? box.height / node.height : 1;
    const top = first.getBoundingClientRect().top;
    const above = Math.max(8, Math.min(20, (top - box.top) / scale));
    const h = Math.ceil((firstLineBottom(first) - box.top) / scale + above);
    kept = was;
    return { height: Math.max(36, Math.min(h, node.height)), measured: true };
  } catch (err) {
    return { height: Math.min(line, node.height), measured: false };
  } finally {
    if (el && !was) el.removeClass('dr-folded');
    if (el && !kept) unmarkFoldLine(el);
  }
}

class CanvasFold extends CanvasFeature {
  constructor(plugin) {
    super(plugin);
    // Folds as they were made, by canvas and card, outliving a rewrite.
    this.memory = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'canvasFold',
        name: 'Fold cards',
        desc: 'A small arrow on a canvas card folds it down to its first line, and back. A button beside the zoom controls folds or unfolds every card.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'fold-canvas-cards',
        name: 'Fold or unfold the selected cards',
        icon: 'fold-vertical',
        check: () => this.enabled && this.selectedNodes(this.pageCanvas()).some(foldable),
        run: () => {
          const view = this.pageCanvas();
          const cards = this.selectedNodes(view).filter(foldable);
          this.fold(view, cards, !cards.every((n) => foldOf(n)));
        },
      },
      {
        id: 'fold-all-canvas-cards',
        name: 'Fold or unfold every card on the canvas',
        icon: 'fold-vertical',
        check: () => this.enabled && !!this.pageCanvas(),
        run: () => this.foldAll(this.pageCanvas()),
      },
    ];
  }

  addMenuItems(menu, nodes) {
    const first = nodes[0];
    const view = first && first.canvas && first.canvas.view;
    const cards = nodes.filter(foldable);
    if (!view || !cards.length) return;
    const folded = cards.every((n) => foldOf(n));
    menu.addItem((item) =>
      item
        .setTitle(folded ? (cards.length > 1 ? 'Unfold cards' : 'Unfold card') : cards.length > 1 ? 'Fold cards' : 'Fold card')
        .setIcon(folded ? 'unfold-vertical' : 'fold-vertical')
        .onClick(() => this.fold(view, cards, !folded))
    );
  }

  /** Every card folded — or, if they all are, every card unfolded. */
  foldAll(view) {
    if (!view) return;
    const cards = this.allNodes(view).filter(foldable);
    this.fold(view, cards, cards.some((n) => !foldOf(n)));
  }

  /** Folded or unfolded by hand: the one time the file is written. */
  fold(view, nodes, on) {
    if (!view || !view.canvas) return;
    let changed = false;
    (nodes || []).filter(foldable).forEach((node) => {
      if (on ? this.foldOne(view, node) : this.unfoldOne(view, node)) changed = true;
    });
    if (changed) this.save(view);
    this.pass(view);
  }

  memoryKey(view, node) {
    return `${view.file ? view.file.path : ''}\u0000${node.id}`;
  }

  foldOne(view, node) {
    if (foldOf(node) || typeof node.moveAndResize !== 'function') return false;
    const { height, measured } = foldedHeight(node);
    if (height >= node.height - 2) return false;
    if (!node.unknownData) node.unknownData = {};
    node.unknownData[FOLD_KEY] = { height: node.height, folded: height, measured };
    this.memory.set(this.memoryKey(view, node), Object.assign({}, node.unknownData[FOLD_KEY]));
    node.moveAndResize({ x: node.x, y: node.y, width: node.width, height });
    return true;
  }

  unfoldOne(view, node) {
    const kept = foldOf(node);
    if (!kept || typeof node.moveAndResize !== 'function') return false;
    delete node.unknownData[FOLD_KEY];
    this.memory.delete(this.memoryKey(view, node));
    node.moveAndResize({ x: node.x, y: node.y, width: node.width, height: Math.max(kept.height, node.height) });
    return true;
  }

  /** A record dropped by a rewrite, from a card still at its folded size. */
  recall(view, node) {
    const key = this.memoryKey(view, node);
    const was = this.memory.get(key);
    if (!was) return null;
    if (node.isEditing || Math.abs(node.height - was.folded) > 3) {
      this.memory.delete(key);
      return null;
    }
    if (!node.unknownData) node.unknownData = {};
    node.unknownData[FOLD_KEY] = Object.assign({}, was);
    return node.unknownData[FOLD_KEY];
  }

  save(view) {
    try {
      if (typeof view.canvas.requestSave === 'function') view.canvas.requestSave();
    } catch (err) {
      /* saved with the canvas's next change */
    }
  }

  /**
   * Each redraw — the user's changes and outside ones alike — in memory
   * only: what changes here is saved with the canvas's next change.
   */
  pass(view) {
    let anyOpen = false;
    let any = false;
    this.allNodes(view).forEach((node) => {
      if (!node || !node.nodeEl || !foldable(node)) return;
      any = true;
      let kept = foldOf(node) || this.recall(view, node);
      if (kept) {
        if (node.isEditing) {
          // Opened to edit: unfolded, to be seen whole.
          this.unfoldOne(view, node);
          kept = null;
        } else if (Math.abs(node.height - kept.folded) > 3) {
          // Resized, by hand or from outside: that's its size now.
          delete node.unknownData[FOLD_KEY];
          this.memory.delete(this.memoryKey(view, node));
          kept = null;
        } else if (!kept.measured) {
          // Folded before it was drawn: to its first line, now it is.
          const fit = foldedHeight(node);
          if (fit.measured) {
            kept.measured = true;
            kept.folded = fit.height;
            this.memory.set(this.memoryKey(view, node), Object.assign({}, kept));
            node.moveAndResize({ x: node.x, y: node.y, width: node.width, height: fit.height });
          }
        }
      }
      if (!kept) anyOpen = true;
      const el = node.nodeEl;
      if (kept) {
        el.addClass('dr-folded');
        // Its words are drawn afresh as the note changes: the line is found again.
        if (!el.querySelector('.dr-fold-line')) markFoldLine(el);
      } else if (el.hasClass('dr-folded')) {
        el.removeClass('dr-folded');
        unmarkFoldLine(el);
      }
      this.button(view, node, !!kept);
    });
    this.control(view, any, anyOpen);
  }

  /** The arrow in a card's corner, which folds it. */
  button(view, node, folded) {
    let button = node.nodeEl.querySelector(':scope > .dr-fold-btn');
    if (!button) {
      button = node.nodeEl.createDiv({ cls: 'dr-fold-btn' });
      button.setAttribute('role', 'button');
      const stop = (evt) => evt.stopPropagation();
      button.addEventListener('pointerdown', stop);
      button.addEventListener('mousedown', stop);
      button.addEventListener('dblclick', stop);
      button.addEventListener('click', (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        this.fold(view, [node], !foldOf(node));
      });
    }
    if (button.dataset.folded === String(folded)) return;
    button.dataset.folded = String(folded);
    button.empty();
    setIcon(button, folded ? 'chevron-down' : 'chevron-up');
    button.setAttribute('aria-label', folded ? 'Unfold' : 'Fold');
  }

  /** Beside the canvas's zoom controls: fold every card, or unfold them. */
  control(view, any, anyOpen) {
    const controls = view.containerEl.querySelector('.canvas-controls');
    if (!controls) return;
    let group = controls.querySelector(':scope > .dr-fold-control');
    if (!any) {
      if (group) group.remove();
      return;
    }
    if (!group) {
      group = controls.createDiv({ cls: 'canvas-control-group dr-fold-control' });
      const item = group.createDiv({ cls: 'canvas-control-item' });
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('data-tooltip-position', 'left');
      onActivate(item, () => this.foldAll(view));
    }
    const item = group.firstElementChild;
    const state = anyOpen ? 'fold' : 'unfold';
    if (item.dataset.state === state) return;
    item.dataset.state = state;
    item.empty();
    setIcon(item, anyOpen ? 'fold-vertical' : 'unfold-vertical');
    item.setAttribute('aria-label', anyOpen ? 'Fold every card' : 'Unfold every card');
  }

  cleanup(view) {
    view.contentEl.querySelectorAll('.dr-fold-btn').forEach((el) => el.remove());
    view.contentEl.querySelectorAll('.dr-folded').forEach((el) => el.removeClass('dr-folded'));
    unmarkFoldLine(view.contentEl);
    if (view.containerEl) view.containerEl.querySelectorAll('.dr-fold-control').forEach((el) => el.remove());
  }
}

CanvasFold.settingKey = 'canvasFold';
