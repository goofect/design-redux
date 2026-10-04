/* ------------------------------------------------------------------ */
/* Folding on a canvas                                                 */
/*                                                                     */
/* A card folds down to its first line — its heading, or its opening   */
/* words — and a group down to its label, its cards tucked inside; a   */
/* card's branch, everything its arrows lead to, tucks into the card.  */
/* What a fold took is kept in the cards' own data in the canvas file, */
/* which Obsidian keeps as it is, so a fold travels with the canvas.   */
/* What's beyond a fold closes up the room it left, and moves back out */
/* when it unfolds. A folded card resized by hand is simply that size; */
/* one opened for editing unfolds.                                     */
/*                                                                     */
/* The canvas can be changed from outside while it's open — by an AI   */
/* writing to it, say — so nothing here saves on its own: the file is  */
/* written only when something is folded or unfolded by hand. A        */
/* rewrite that drops a fold's record, leaving the card at its folded  */
/* size, gets the record back from memory, so it still unfolds to its  */
/* size.                                                               */
/*                                                                     */
/* The settings decide what can be folded; a fold already made can     */
/* always be undone, so nothing stays tucked away out of reach.        */
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


/** How tall a folded group opens out: room round the cards tucked inside it, as they sit in it. */
function groupOpenHeight(model, rec) {
  const inside = model.nodes.filter((n) => n.tuck && n.tuck.by === rec.id);
  const bottom = Math.max(0, ...inside.map((n) => n.tuck.dy + n.height));
  return Math.max(rec.height, bottom + 40);
}

/** Whether a canvas card is a group. */
function isGroupNode(node) {
  try {
    const data = node && typeof node.getData === 'function' ? node.getData() : node;
    return !!data && data.type === 'group';
  } catch (err) {
    return false;
  }
}

class CanvasFold extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasFold',
        name: 'Fold cards and groups',
        desc: 'An arrow in the corner of a canvas card folds it down to its first line, and one on a group folds it down to its label, its cards tucked inside. A button beside the zoom controls folds or unfolds every card.',
      },
      {
        key: 'canvasBranches',
        name: 'Fold branches',
        desc: 'A knob where a card’s arrows leave it tucks away everything they lead to, and shows how many cards it holds. Arrows from elsewhere point at the fold.',
      },
      {
        key: 'canvasCloseGaps',
        name: 'Close the gaps',
        desc: 'What’s beyond a fold moves in to fill the room it left, and back out when it unfolds. The groups it’s in shrink and grow to match.',
      },
    ];
  }

  get canFold() {
    return !!this.settings.canvasFold;
  }

  get canBranch() {
    return !!this.settings.canvasBranches;
  }

  get closing() {
    return this.settings.canvasCloseGaps !== false;
  }

  commands() {
    return [
      {
        id: 'fold-canvas-cards',
        name: 'Fold or unfold the selected cards',
        icon: 'fold-vertical',
        check: () => this.foldTargets(this.selectedNodes(this.pageCanvas())).length > 0,
        run: () => {
          const view = this.pageCanvas();
          const cards = this.foldTargets(this.selectedNodes(view));
          this.fold(view, cards, !cards.every((n) => foldOf(n)));
        },
      },
      {
        id: 'fold-all-canvas-cards',
        name: 'Fold or unfold every card on the canvas',
        icon: 'fold-vertical',
        check: () => {
          const view = this.pageCanvas();
          return !!view && (this.canFold || this.allNodes(view).some((n) => foldable(n) && foldOf(n)));
        },
        run: () => this.foldAll(this.pageCanvas()),
      },
      {
        id: 'fold-canvas-branch',
        name: 'Fold or unfold the selected card’s branch',
        icon: 'chevrons-down-up',
        check: () => this.branchTargets(this.pageCanvas()).length > 0,
        run: () => {
          const view = this.pageCanvas();
          const cards = this.branchTargets(view);
          const model = canvasModel(view.canvas);
          this.foldBranches(view, cards, !cards.every((n) => tuckedCount(model, n.id) > 0));
        },
      },
    ];
  }

  /** Of these cards, the ones that can be folded or unfolded now. */
  foldTargets(nodes) {
    return (nodes || []).filter((n) => (foldable(n) || isGroupNode(n)) && !tuckOf(n) && (this.canFold || foldOf(n)));
  }

  /** The selected cards whose branch can be folded, or is. */
  branchTargets(view) {
    const selected = this.selectedNodes(view);
    if (!selected.length) return [];
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    return selected.filter((n) => {
      const rec = model.byId.get(n.id);
      if (!rec || rec.tuck || isGroupRecord(rec)) return false;
      if (tuckedCount(model, rec.id)) return true;
      return this.canBranch && branchOf(model, rec.id, links).length > 0;
    });
  }

  addMenuItems(menu, nodes) {
    const first = nodes[0];
    const view = first && first.canvas && first.canvas.view;
    if (!view || !view.canvas) return;
    const cards = this.foldTargets(nodes);
    if (cards.length) {
      const folded = cards.every((n) => foldOf(n));
      const groups = cards.every(isGroupNode);
      const noun = groups ? (cards.length > 1 ? 'groups' : 'group') : cards.length > 1 ? 'cards' : 'card';
      menu.addItem((item) =>
        item
          .setTitle(`${folded ? 'Unfold' : 'Fold'} ${noun}`)
          .setIcon(folded ? 'unfold-vertical' : 'fold-vertical')
          .onClick(() => this.fold(view, cards, !folded))
      );
    }
    if (nodes.length !== 1) return;
    const model = canvasModel(view.canvas);
    const rec = model.byId.get(first.id);
    if (!rec || rec.tuck || isGroupRecord(rec)) return;
    const count = tuckedCount(model, rec.id);
    if (!count && !(this.canBranch && branchOf(model, rec.id).length)) return;
    menu.addItem((item) =>
      item
        .setTitle(count ? 'Unfold branch' : 'Fold branch')
        .setIcon(count ? 'chevrons-up-down' : 'chevrons-down-up')
        .onClick(() => this.foldBranches(view, [first], !count))
    );
  }

  /** Every card folded — or, if they all are, every card unfolded. Groups are left as they are. */
  foldAll(view) {
    if (!view) return;
    const cards = this.allNodes(view).filter((n) => foldable(n) && !tuckOf(n));
    this.fold(view, cards, this.canFold && cards.some((n) => !foldOf(n)));
  }

  /** Cards to their first line and groups to their label, or back. By hand: one of the times the file is written. */
  fold(view, nodes, on) {
    if (!view || !view.canvas) return;
    const model = canvasModel(view.canvas);
    const before = snapshotModel(model);
    let any = false;
    (nodes || []).forEach((node) => {
      const rec = model.byId.get(node.id);
      if (!rec || rec.tuck) return;
      let done = false;
      if (isGroupRecord(rec)) {
        done = on ? foldRecord(model, rec, GROUP_FOLD_HEIGHT, true, this.closing) : unfoldRecord(model, rec, this.closing);
      } else if (foldable(node)) {
        if (!on) done = unfoldRecord(model, rec, this.closing);
        else if (!rec.fold) {
          const fit = foldedHeight(node);
          done = foldRecord(model, rec, fit.height, fit.measured, this.closing);
        }
      }
      any = any || done;
    });
    this.finish(view, model, before, any);
  }

  /** A card's branch tucked into it, or back out. By hand, too: the file is written. */
  foldBranches(view, nodes, on) {
    if (!view || !view.canvas) return;
    const model = canvasModel(view.canvas);
    const before = snapshotModel(model);
    let any = false;
    (nodes || []).forEach((node) => {
      const rec = model.byId.get(node.id);
      if (!rec || rec.tuck || isGroupRecord(rec)) return;
      const links = arrowLinks(model);
      const ids = on ? foldBranch(model, rec, this.closing, links) : unfoldBranch(model, rec, this.closing, links);
      any = any || ids.length > 0;
    });
    this.finish(view, model, before, any);
  }

  /** Changes onto the canvas — saved, which also makes them one step of Undo — and everything redrawn. */
  finish(view, model, before, any) {
    if (any && applyCanvasModel(model, before)) this.save(view);
    // Each fold at the size it's written at, which a rewrite may bring
    // back; one unfolded, forgotten.
    const memory = this.memoryOf(view);
    model.nodes.forEach((rec) => {
      const was = before.get(rec.id);
      if (!was || was.fold === (rec.fold ? JSON.stringify(rec.fold) : '')) return;
      if (rec.fold) memory.set(rec.id, Object.assign({}, rec.fold, { saved: rec.height }));
      else memory.delete(rec.id);
    });
    this.pass(view);
    // The outline follows.
    const ws = this.app && this.app.workspace;
    if (ws && typeof ws.trigger === 'function') ws.trigger('design-redux:canvas-changed', view);
  }

  /**
   * Folds as they were made in one open canvas, by card, outliving a
   * rewrite. Each open copy of a canvas has cards of its own, so each
   * keeps its own.
   */
  memoryOf(view) {
    const state = this.watched.get(view);
    if (!state) return new Map();
    if (!state.memory) state.memory = new Map();
    return state.memory;
  }

  /**
   * A record dropped by a rewrite, from a card still at its folded size —
   * as drawn, or as last written, which a fold measured since can differ
   * from.
   */
  recall(view, node) {
    const memory = this.memoryOf(view);
    const was = memory.get(node.id);
    if (!was) return null;
    const near = (h) => typeof h === 'number' && Math.abs(node.height - h) <= 3;
    if (node.isEditing || !(near(was.folded) || near(was.saved))) {
      memory.delete(node.id);
      return null;
    }
    if (!node.unknownData) node.unknownData = {};
    // At the size written, it's measured again once drawn.
    node.unknownData[FOLD_KEY] = { height: was.height, folded: node.height, measured: !!was.measured && near(was.folded) };
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
   * only: what changes here is saved with the canvas's next change. That
   * also keeps it out of Undo: a step of its own, undone, would only
   * bring the canvas back here to be changed again.
   */
  pass(view, state) {
    if (!view || !view.canvas) return;
    state = state || this.watched.get(view);
    // Folds whose record a rewrite dropped, still at their folded size: back from memory.
    this.allNodes(view).forEach((node) => {
      if (node && !foldOf(node) && (foldable(node) || isGroupNode(node))) this.recall(view, node);
    });
    const model = canvasModel(view.canvas);
    const before = snapshotModel(model);
    let changed = state ? restoreOrphans(model, state, this.closing) : false;
    let anyCard = false;
    let anyOpen = false;
    const counts = new Map();
    model.nodes.forEach((n) => {
      if (n.tuck) counts.set(n.tuck.by, (counts.get(n.tuck.by) || 0) + 1);
    });
    model.nodes.forEach((rec) => {
      const node = rec.node;
      if (!node || !node.nodeEl || rec.tuck) return;
      const group = isGroupRecord(rec);
      if (!group && !foldable(node)) return;
      // A group holding cards with no record of its fold — dropped by a
      // rewrite, and not remembered: folded still, to open out round them.
      if (group && !rec.fold && counts.get(rec.id)) {
        rec.fold = { height: groupOpenHeight(model, rec), folded: rec.height, measured: true };
        changed = true;
      }
      let kept = rec.fold;
      if (kept) {
        if (!group && node.isEditing) {
          // Opened to edit: unfolded, to be seen whole.
          unfoldRecord(model, rec, this.closing);
          this.memoryOf(view).delete(rec.id);
          kept = null;
          changed = true;
        } else if (Math.abs(rec.height - kept.folded) > 3) {
          // Resized, by hand or from outside: a card is that size now; a group opens out.
          if (group) unfoldRecord(model, rec, this.closing);
          else rec.fold = null;
          this.memoryOf(view).delete(rec.id);
          kept = null;
          changed = true;
        } else if (!group && !kept.measured) {
          // Folded before it was drawn: to its first line, now it is.
          const fit = foldedHeight(node);
          if (fit.measured) {
            refitRecord(model, rec, fit.height, this.closing);
            kept = rec.fold;
            const was = this.memoryOf(view).get(rec.id);
            this.memoryOf(view).set(rec.id, Object.assign({}, kept, was ? { saved: was.saved } : {}));
            changed = true;
          }
        }
      }
      if (!group) {
        anyCard = true;
        if (!kept) anyOpen = true;
      }
      const el = node.nodeEl;
      if (kept) {
        el.addClass('dr-folded');
        // Its words are drawn afresh as the note changes: the line is found again.
        if (!group && !el.querySelector('.dr-fold-line')) markFoldLine(el);
      } else if (el.hasClass('dr-folded')) {
        el.removeClass('dr-folded');
        unmarkFoldLine(el);
      }
      if (group) this.summary(node, kept ? counts.get(rec.id) || 0 : -1);
      this.button(view, node, !!kept, group);
    });
    if (changed) applyCanvasModel(model, before);
    this.knobs(view, model, counts);
    if (state) drawTucks(view, model, state);
    this.control(view, anyCard && (this.canFold || !anyOpen), anyOpen);
  }

  /** The arrow in a card's or group's corner, which folds it. */
  button(view, node, folded, group) {
    let button = node.nodeEl.querySelector(':scope > .dr-fold-btn');
    if (!folded && !this.canFold) {
      if (button) button.remove();
      return;
    }
    if (!button) {
      button = node.nodeEl.createDiv({ cls: 'dr-fold-btn' });
      button.setAttribute('role', 'button');
      stopCanvasPointer(button);
      button.addEventListener('click', (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        this.fold(view, [node], !foldOf(node));
      });
    }
    const state = `${folded}`;
    if (button.dataset.folded === state) return;
    button.dataset.folded = state;
    button.empty();
    setIcon(button, folded ? 'chevron-down' : 'chevron-up');
    button.setAttribute('aria-label', `${folded ? 'Unfold' : 'Fold'}${group ? ' group' : ''}`);
  }

  /** How many cards a folded group holds, in its bar. */
  summary(node, count) {
    let el = node.nodeEl.querySelector(':scope > .dr-group-summary');
    if (count < 0) {
      if (el) el.remove();
      return;
    }
    if (!el) el = node.nodeEl.createDiv({ cls: 'dr-group-summary' });
    const text = count === 1 ? '1 card' : `${count} cards`;
    if (el.textContent !== text) el.textContent = text;
  }

  /**
   * The knob where a card's arrows leave it: it folds the branch they
   * lead to, and folded shows how many cards are tucked into it.
   */
  knobs(view, model, counts) {
    const links = arrowLinks(model);
    const sides = branchSides(model, links);
    model.nodes.forEach((rec) => {
      const node = rec.node;
      if (!node || !node.nodeEl) return;
      let knob = node.nodeEl.querySelector(':scope > .dr-branch-knob');
      const card = !rec.tuck && !isGroupRecord(rec);
      const count = card ? counts.get(rec.id) || 0 : 0;
      const open = card && !count && this.canBranch && shownChildren(model, links, rec.id).length > 0 && branchOf(model, rec.id, links).length > 0;
      if (!count && !open) {
        if (knob) knob.remove();
        return;
      }
      if (!knob) {
        knob = node.nodeEl.createDiv({ cls: 'dr-branch-knob' });
        knob.setAttribute('role', 'button');
        stopCanvasPointer(knob);
        knob.addEventListener('click', (evt) => {
          evt.stopPropagation();
          evt.preventDefault();
          const now = canvasModel(view.canvas);
          this.foldBranches(view, [node], !tuckedCount(now, node.id));
        });
      }
      const side = sides.get(rec.id) || 'right';
      const state = `${side}:${count}`;
      if (knob.dataset.state === state) return;
      knob.dataset.state = state;
      knob.className = `dr-branch-knob is-${side}${count ? ' is-folded' : ''}`;
      knob.empty();
      if (count) knob.createSpan({ cls: 'dr-branch-count', text: `+${count}` });
      else setIcon(knob, 'minus');
      knob.setAttribute('aria-label', count ? `Unfold branch: ${count === 1 ? '1 card' : `${count} cards`}` : 'Fold branch');
    });
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
    view.contentEl.querySelectorAll('.dr-fold-btn, .dr-branch-knob, .dr-group-summary').forEach((el) => el.remove());
    view.contentEl.querySelectorAll('.dr-folded').forEach((el) => el.removeClass('dr-folded'));
    unmarkFoldLine(view.contentEl);
    undrawTucks(view);
    if (view.containerEl) view.containerEl.querySelectorAll('.dr-fold-control').forEach((el) => el.remove());
  }
}

/* The canvas drags, selects and opens a card from a press on it: a button on the card keeps its presses. */
function stopCanvasPointer(el) {
  const stop = (evt) => evt.stopPropagation();
  el.addEventListener('pointerdown', stop);
  el.addEventListener('mousedown', stop);
  el.addEventListener('dblclick', stop);
}

/* Looked over after a drag or Undo, too: tucked cards' arrows follow their fold. */
CanvasFold.watchInput = true;
