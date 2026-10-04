/* ------------------------------------------------------------------ */
/* Folding on a canvas                                                 */
/*                                                                     */
/* A card folds down to a strip with its title, and a glimpse of what  */
/* follows fading out — every folded card alike, whatever's in it. A   */
/* group folds down to its label, its cards tucked inside; a card's    */
/* branch, everything its arrows lead to, tucks into the card. What a  */
/* fold took is kept in the cards' own data in the canvas file, which  */
/* Obsidian keeps as it is, so a fold travels with the canvas. What's   */
/* beyond a fold closes up the room it left, and moves back out when   */
/* it unfolds — gliding, not jumping. A folded card resized by hand is  */
/* simply that size; one opened for editing opens out while it's being */
/* edited, and folds again after. Something holding tucked cards looks  */
/* like a little stack of them.                                        */
/*                                                                     */
/* The file is written only when something is folded or unfolded by   */
/* hand; what a redraw changes is saved with the canvas's next change. */
/*                                                                     */
/* The settings decide what can be folded; a fold already made can     */
/* always be undone, so nothing stays tucked away out of reach.        */
/* ------------------------------------------------------------------ */

const FOLD_KEY = 'drFold';

/* A folded card's height: its title alone, or its title over a glimpse of the rest. */
const FOLD_TITLE_HEIGHT = 52;
const FOLD_GLIMPSE_HEIGHT = 78;

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

/**
 * What a folded card shows: its title — a text card's first line, a
 * note's name — and a glimpse of the words after it. `noteText` is the
 * note's for a note card; without it yet, the glimpse is still to come.
 */
function foldFace(rec, noteText) {
  const title = canvasCardLabel(rec);
  let lines;
  if (rec.type === 'file') {
    if (noteText === undefined || noteText === null) return { title, glimpse: '', pending: true };
    lines = markdownLines(noteText);
    // A heading that only repeats the note's name says nothing new.
    if (lines.length && /^#{1,6}\s/.test(lines[0]) && plainMarkdownLine(lines[0]).toLowerCase() === title.toLowerCase()) {
      lines = lines.slice(1);
    }
  } else {
    lines = markdownLines(rec.text).slice(1);
  }
  const words = [];
  let size = 0;
  for (const line of lines) {
    if (/^(```|~~~|\||<)/.test(line)) continue;
    const plain = plainMarkdownLine(line);
    if (!plain) continue;
    words.push(plain);
    size += plain.length;
    if (size > 160) break;
  }
  return { title, glimpse: words.join(' ').slice(0, 220), pending: false };
}

/** How tall a folded card is: room for its title, and for its glimpse if it has one. */
function faceHeight(face) {
  return face.glimpse || face.pending ? FOLD_GLIMPSE_HEIGHT : FOLD_TITLE_HEIGHT;
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

/** Cards tucked straight into a record, in the order they sat beside it. */
function tuckedInto(model, id) {
  return model.nodes
    .filter((n) => n.tuck && n.tuck.by === id)
    .sort((a, b) => a.tuck.dy - b.tuck.dy || a.tuck.dx - b.tuck.dx);
}

class CanvasFold extends CanvasFeature {
  constructor(plugin) {
    super(plugin);
    this.popover = new FoldPopover();
    // A note card's glimpse, by the note's path: { mtime, text }.
    this.notes = new Map();
    this.reading = new Set();
  }

  settingsSchema() {
    return [
      {
        key: 'canvasFold',
        name: 'Fold cards and groups',
        desc: 'An arrow in the corner of a canvas card folds it down to its title, and one on a group folds it down to its label, its cards tucked inside. Point at a folded card to read all of it. A button beside the zoom controls folds or unfolds every card, group or branch.',
      },
      {
        key: 'canvasBranches',
        name: 'Fold branches',
        desc: 'A knob where a card’s arrows leave it tucks away everything they lead to, and shows how many cards it holds — point at it for their names. Arrows from elsewhere point at the fold.',
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
        id: 'fold-all-canvas-groups',
        name: 'Fold or unfold every group on the canvas',
        icon: 'box-select',
        check: () => {
          const view = this.pageCanvas();
          return !!view && this.allNodes(view).some((n) => isGroupNode(n) && !tuckOf(n) && (this.canFold || foldOf(n)));
        },
        run: () => {
          const view = this.pageCanvas();
          const s = this.foldStatus(canvasModel(view.canvas));
          this.foldEverything(view, this.canFold && s.openGroups ? 'groups' : 'groups-open');
        },
      },
      {
        id: 'unfold-canvas-everything',
        name: 'Unfold everything on the canvas',
        icon: 'unfold-vertical',
        check: () => {
          const view = this.pageCanvas();
          return !!view && this.foldStatus(canvasModel(view.canvas)).anything;
        },
        run: () => this.foldEverything(this.pageCanvas(), 'everything'),
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

  /** A canvas still gliding from the last fold, put where it's going: what's next starts from there. */
  settle(view) {
    const state = view && this.watched.get(view);
    if (state && state.glide) state.glide.finish();
  }

  /** What a folded card shows, and the note's words read in for a note card if they aren't yet. */
  faceOf(view, rec) {
    if (rec.type !== 'file') return foldFace(rec);
    const file = this.app && this.app.vault && typeof this.app.vault.getAbstractFileByPath === 'function'
      ? this.app.vault.getAbstractFileByPath(String(rec.file || ''))
      : null;
    if (!(file instanceof TFile)) return foldFace(rec, '');
    const known = this.notes.get(file.path);
    if (known && known.mtime === file.stat.mtime) return foldFace(rec, known.text);
    if (!this.reading.has(file.path)) {
      this.reading.add(file.path);
      this.app.vault
        .cachedRead(file)
        .then((text) => this.notes.set(file.path, { mtime: file.stat.mtime, text }))
        .catch(() => this.notes.set(file.path, { mtime: file.stat.mtime, text: '' }))
        .finally(() => {
          this.reading.delete(file.path);
          if (view) this.schedule(view);
        });
    }
    return known ? foldFace(rec, known.text) : foldFace(rec);
  }

  /** Every card folded — or, if they all are, every card unfolded. Groups are left as they are. */
  foldAll(view) {
    if (!view) return Promise.resolve(false);
    this.settle(view);
    const cards = this.allNodes(view).filter((n) => foldable(n) && !tuckOf(n));
    return this.fold(view, cards, this.canFold && cards.some((n) => !foldOf(n)));
  }

  /** Cards to their title and groups to their label, or back. By hand: one of the times the file is written. */
  fold(view, nodes, on) {
    if (!view || !view.canvas) return Promise.resolve(false);
    this.settle(view);
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
        else if (!rec.fold) done = foldRecord(model, rec, faceHeight(this.faceOf(view, rec)), true, this.closing);
      }
      any = any || done;
    });
    return this.finish(view, model, before, any);
  }

  /** A card's branch tucked into it, or back out. By hand, too: the file is written. */
  foldBranches(view, nodes, on) {
    if (!view || !view.canvas) return Promise.resolve(false);
    this.settle(view);
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
    return this.finish(view, model, before, any);
  }

  /** What there is to fold and unfold on a canvas, for the button and its menu. */
  foldStatus(model) {
    const links = arrowLinks(model);
    const s = { openCards: 0, foldedCards: 0, openGroups: 0, foldedGroups: 0, roots: 0, tucked: 0, anything: false };
    model.nodes.forEach((rec) => {
      if (rec.tuck) {
        s.tucked++;
        return;
      }
      if (isGroupRecord(rec)) {
        if (rec.fold) s.foldedGroups++;
        else s.openGroups++;
        return;
      }
      if (!rec.node || !foldable(rec.node)) return;
      if (rec.fold) s.foldedCards++;
      else s.openCards++;
      const parents = (links.parents.get(rec.id) || []).filter((p) => {
        const r = model.byId.get(p);
        return r && !r.tuck;
      });
      if (!parents.length && branchOf(model, rec.id, links).length) s.roots++;
    });
    s.anything = !!(s.foldedCards || s.foldedGroups || s.tucked);
    return s;
  }

  /**
   * Everything of one kind folded or unfolded at once: 'cards',
   * 'cards-open', 'groups' (inner ones first), 'groups-open', 'branches'
   * (from the cards at the top of each tree), or 'everything' unfolded.
   */
  foldEverything(view, what) {
    if (!view || !view.canvas) return Promise.resolve(false);
    this.settle(view);
    const model = canvasModel(view.canvas);
    const before = snapshotModel(model);
    const close = this.closing;
    const shown = () => model.nodes.filter((n) => !n.tuck);
    const area = (n) => n.width * n.height;
    let any = false;
    const did = (x) => {
      if (x) any = true;
      return x;
    };
    if (what === 'cards') {
      shown()
        .filter((r) => !isGroupRecord(r) && r.node && foldable(r.node) && !r.fold)
        .forEach((r) => did(foldRecord(model, r, faceHeight(this.faceOf(view, r)), true, close)));
    } else if (what === 'cards-open') {
      shown()
        .filter((r) => !isGroupRecord(r) && r.fold)
        .forEach((r) => did(unfoldRecord(model, r, close)));
    } else if (what === 'groups') {
      shown()
        .filter((r) => isGroupRecord(r) && !r.fold)
        .sort((a, b) => area(a) - area(b))
        .forEach((r) => {
          if (!r.tuck) did(foldRecord(model, r, GROUP_FOLD_HEIGHT, true, close));
        });
    } else if (what === 'branches') {
      const status = (r) => {
        const links = arrowLinks(model);
        const parents = (links.parents.get(r.id) || []).filter((p) => model.byId.get(p) && !model.byId.get(p).tuck);
        return !parents.length;
      };
      shown()
        .filter((r) => !isGroupRecord(r) && status(r))
        .forEach((r) => {
          if (!r.tuck) did(foldBranch(model, r, close, arrowLinks(model)).length > 0);
        });
    } else if (what === 'everything' || what === 'groups-open') {
      // Unfolded until nothing's left folded: what comes out of one fold may hold another.
      for (let round = 0; round < 50; round++) {
        let more = false;
        const groupsOnly = what === 'groups-open';
        shown()
          .filter((r) => (groupsOnly ? isGroupRecord(r) && r.fold : r.fold))
          .sort((a, b) => area(b) - area(a))
          .forEach((r) => {
            if (!r.tuck && did(unfoldRecord(model, r, close))) more = true;
          });
        if (!groupsOnly) {
          shown()
            .filter((r) => !isGroupRecord(r) && tuckedCount(model, r.id))
            .forEach((r) => {
              if (!r.tuck && did(unfoldBranch(model, r, close, arrowLinks(model)).length > 0)) more = true;
            });
        }
        if (!more) break;
      }
    }
    return this.finish(view, model, before, any);
  }

  /**
   * Changes onto the canvas — gliding there, then saved, which also makes
   * them one step of Undo — and everything redrawn. Settles once they're there.
   */
  finish(view, model, before, any) {
    return new Promise((resolve) => {
      const state = this.watched.get(view);
      const end = (changed) => {
        if (changed) this.save(view);
        this.pass(view);
        // The outline follows.
        const ws = this.app && this.app.workspace;
        if (ws && typeof ws.trigger === 'function') ws.trigger('design-redux:canvas-changed', view);
        resolve(changed);
      };
      if (!any) return end(false);
      this.popover.hide();
      this.prepare(view, model, before);
      glideCanvasModel(view, model, before, state, end);
    });
  }

  /** Cards about to fold or unfold, drawn as they'll be, so they glide as themselves. */
  prepare(view, model, before) {
    model.nodes.forEach((rec) => {
      const node = rec.node;
      const was = before.get(rec.id);
      if (!node || !node.nodeEl || !was || rec.tuck) return;
      const folded = !!rec.fold;
      if (folded === !!was.fold) return;
      node.nodeEl.toggleClass('dr-folded', folded);
      if (!isGroupRecord(rec)) this.face(view, node, rec, folded);
    });
  }

  save(view) {
    try {
      if (typeof view.canvas.requestSave === 'function') view.canvas.requestSave();
    } catch (err) {
      /* saved with the canvas's next change */
    }
  }

  /**
   * Each redraw, in memory only: what changes here is saved with the
   * canvas's next change. That also keeps it out of Undo: a step of its
   * own, undone, would only bring the canvas back here to be changed
   * again. Not while cards glide: they're on their way.
   */
  pass(view, state) {
    if (!view || !view.canvas) return;
    state = state || this.watched.get(view);
    if (state && state.gliding) return;
    const model = canvasModel(view.canvas);
    const before = snapshotModel(model);
    let changed = state ? restoreOrphans(model, state, this.closing) : false;
    let anyCard = false;
    let anyGroup = false;
    const counts = new Map();
    model.nodes.forEach((n) => {
      if (n.tuck) counts.set(n.tuck.by, (counts.get(n.tuck.by) || 0) + 1);
    });
    model.nodes.forEach((rec) => {
      const node = rec.node;
      if (!node || !node.nodeEl || rec.tuck) return;
      const group = isGroupRecord(rec);
      const el = node.nodeEl;
      this.stack(node, (counts.get(rec.id) || 0) > 0);
      if (!group && !foldable(node)) return;
      // A group holding cards with no record of its fold — dropped by a
      // rewrite: folded still, to open out round them.
      if (group && !rec.fold && counts.get(rec.id)) {
        rec.fold = { height: groupOpenHeight(model, rec), folded: rec.height, measured: true };
        changed = true;
      }
      let kept = rec.fold;
      let face = null;
      if (kept) {
        if (Math.abs(rec.height - kept.folded) > 3) {
          // Resized: a card is that size now; a group opens out.
          if (group) unfoldRecord(model, rec, this.closing);
          else rec.fold = null;
          kept = null;
          changed = true;
        } else if (!group) {
          // Folded as cards fold now, its title's height — a glimpse come or gone, an older fold.
          face = this.faceOf(view, rec);
          const fits = faceHeight(face);
          if (!node.isEditing && Math.abs(kept.folded - fits) > 3 && fits < kept.height - 2) {
            refitRecord(model, rec, fits, this.closing);
            kept = rec.fold;
            changed = true;
          }
        }
      }
      if (group) anyGroup = true;
      else anyCard = true;
      el.toggleClass('dr-folded', !!kept);
      if (!group) {
        this.face(view, node, rec, !!kept, face);
        // Opened to edit: as tall as it was, while it's being edited.
        if (kept) el.style.setProperty('--dr-open-height', `${Math.max(kept.height, rec.height)}px`);
        else el.style.removeProperty('--dr-open-height');
        this.peek(view, node);
      } else {
        this.summary(view, node, rec, model, kept ? counts.get(rec.id) || 0 : -1);
      }
      this.button(view, node, !!kept, group);
    });
    if (changed) applyCanvasModel(model, before);
    this.knobs(view, model, counts);
    if (state) drawTucks(view, model, state);
    this.control(view, anyCard || anyGroup);
  }

  /** The strip a folded card shows: its title, and a glimpse of the rest fading out. */
  face(view, node, rec, on, face) {
    const host = node.nodeEl.querySelector(':scope > .canvas-node-container') || node.nodeEl;
    let el = host.querySelector(':scope > .dr-fold-face');
    if (!on) {
      if (el) el.remove();
      return;
    }
    face = face || this.faceOf(view, rec);
    if (!el) {
      el = host.createDiv({ cls: 'dr-fold-face' });
      el.createDiv({ cls: 'dr-fold-face-title' });
      el.createDiv({ cls: 'dr-fold-face-glimpse' });
    }
    const title = el.firstElementChild;
    const glimpse = el.lastElementChild;
    if (title.textContent !== face.title) title.textContent = face.title;
    if (glimpse.textContent !== face.glimpse) glimpse.textContent = face.glimpse;
    el.toggleClass('has-glimpse', !!face.glimpse);
  }

  /** Pointing at a folded card shows all of it. */
  peek(view, node) {
    this.popover.attach(
      node.nodeEl,
      () => !!foldOf(node) && !node.isEditing && !tuckOf(node) && this.watched.has(view),
      (pop, component) => this.fillPeek(view, node, pop, component)
    );
  }

  fillPeek(view, node, pop, component) {
    pop.addClass('dr-fold-peek');
    let data = {};
    try {
      data = node.getData() || {};
    } catch (err) {
      data = {};
    }
    const body = pop.createDiv({ cls: 'markdown-preview-view markdown-rendered dr-fold-peek-body' });
    if (data.type === 'file') {
      const file = this.app.vault.getAbstractFileByPath(String(data.file || ''));
      body.createDiv({ cls: 'dr-fold-peek-title', text: canvasCardLabel(data) });
      if (!(file instanceof TFile)) return;
      const into = body.createDiv();
      this.app.vault.cachedRead(file).then((text) => {
        if (!into.isConnected) return;
        renderPeekMarkdown(this.app, String(text).replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, ''), into, file.path, component);
      });
      return;
    }
    renderPeekMarkdown(this.app, String(data.text || ''), body, view.file ? view.file.path : '', component);
  }

  /** The cards tucked into a fold, by name: one picked opens the fold and goes to it. */
  fillTucked(view, holderId, pop) {
    pop.addClass('dr-fold-list');
    const model = canvasModel(view.canvas);
    const inside = tuckedInto(model, holderId);
    pop.createDiv({ cls: 'dr-fold-list-head', text: inside.length === 1 ? '1 card tucked away' : `${inside.length} cards tucked away` });
    const list = pop.createDiv({ cls: 'dr-fold-list-rows' });
    const most = 14;
    inside.slice(0, most).forEach((rec) => {
      const row = list.createDiv({ cls: 'dr-fold-list-row' });
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      colourMark(row, rec.color);
      row.createSpan({ cls: 'dr-fold-list-label', text: canvasCardLabel(rec) });
      const more = tuckedCount(model, rec.id);
      if (more) row.createSpan({ cls: 'dr-fold-list-count', text: `+${more}` });
      onActivate(row, () => this.openTo(view, holderId, rec.id));
    });
    if (inside.length > most) list.createDiv({ cls: 'dr-fold-list-more', text: `and ${inside.length - most} more` });
  }

  /** A fold opened, and the canvas brought round to one of the cards that came out of it. */
  async openTo(view, holderId, cardId) {
    this.popover.hide();
    const canvas = view.canvas;
    const holder = canvas.nodes.get(holderId);
    if (!holder) return;
    if (isGroupNode(holder)) await this.fold(view, [holder], false);
    else await this.foldBranches(view, [holder], false);
    const node = canvas.nodes.get(cardId);
    if (!node) return;
    try {
      if (typeof canvas.selectOnly === 'function') canvas.selectOnly(node);
      if (typeof canvas.panIntoView === 'function') canvas.panIntoView(node.getBBox());
    } catch (err) {
      /* left where it was */
    }
  }

  /** Something holding tucked cards: drawn as a little stack of them. */
  stack(node, on) {
    const el = node.nodeEl;
    const has = el.querySelector(':scope > .dr-stack');
    el.toggleClass('dr-holds', on);
    if (on && !has) {
      el.createDiv({ cls: 'dr-stack is-far' });
      el.createDiv({ cls: 'dr-stack is-near' });
      // Behind the card: first in it.
      el.querySelectorAll(':scope > .dr-stack').forEach((s) => el.insertBefore(s, el.firstChild));
    } else if (!on && has) {
      el.querySelectorAll(':scope > .dr-stack').forEach((s) => s.remove());
    }
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

  /**
   * A folded group's bar: how many cards it holds, with a dot for each
   * colour among them. Pointed at, it names them; pressed, it opens.
   */
  summary(view, node, rec, model, count) {
    let el = node.nodeEl.querySelector(':scope > .dr-group-summary');
    if (count < 0) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = node.nodeEl.createDiv({ cls: 'dr-group-summary' });
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      stopCanvasPointer(el);
      onActivate(el, (evt) => {
        evt.stopPropagation();
        this.fold(view, [node], false);
      });
      this.popover.attach(el, () => !!foldOf(node), (pop) => this.fillTucked(view, node.id, pop), 'below');
    }
    const colours = [];
    tuckedInto(model, rec.id).forEach((n) => {
      const key = canvasColorKey(n.color);
      if (key !== 'none' && colours.indexOf(key) === -1) colours.push(key);
    });
    const text = count === 1 ? '1 card' : `${count} cards`;
    const key = `${text}|${colours.slice(0, 6).join(',')}`;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.empty();
    if (colours.length) {
      const dots = el.createSpan({ cls: 'dr-group-dots' });
      colours.slice(0, 6).forEach((c) => colourMark(dots, c));
    }
    el.createSpan({ text });
    el.setAttribute('aria-label', `Unfold group: ${text}`);
  }

  /**
   * The knob where a card's arrows leave it: it folds the branch they
   * lead to, and folded shows how many cards are tucked into it — and,
   * pointed at, their names.
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
        this.popover.attach(
          knob,
          () => knob.classList.contains('is-folded'),
          (pop) => this.fillTucked(view, node.id, pop),
          'below'
        );
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

  /** Beside the canvas's zoom controls: folding, for everything at once. */
  control(view, any) {
    const controls = view.containerEl.querySelector('.canvas-controls');
    if (!controls) return;
    let group = controls.querySelector(':scope > .dr-fold-control');
    if (!any) {
      if (group) group.remove();
      return;
    }
    if (group) return;
    group = controls.createDiv({ cls: 'canvas-control-group dr-fold-control' });
    // Above the outline's button, which may have been put there first:
    // added once the cards have loaded, it would otherwise go below it,
    // where a short window cuts the column off.
    const outline = controls.querySelector(':scope > .dr-outline-control');
    if (outline) controls.insertBefore(group, outline);
    const item = group.createDiv({ cls: 'canvas-control-item' });
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('data-tooltip-position', 'left');
    item.setAttribute('aria-label', 'Folding');
    setIcon(item, 'fold-vertical');
    onActivate(item, (evt) => this.foldMenu(view, item, evt));
  }

  /** What can be folded or unfolded all at once, as a menu. */
  foldMenu(view, anchor, evt) {
    this.settle(view);
    const s = this.foldStatus(canvasModel(view.canvas));
    const menu = new Menu();
    let count = 0;
    const add = (title, icon, what) => {
      count++;
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .onClick(() => this.foldEverything(view, what))
      );
    };
    if (this.canFold && s.openCards) add('Fold every card', 'fold-vertical', 'cards');
    if (s.foldedCards) add('Unfold every card', 'unfold-vertical', 'cards-open');
    if (this.canFold && s.openGroups) add('Fold every group', 'box-select', 'groups');
    if (s.foldedGroups) add('Unfold every group', 'box-select', 'groups-open');
    if (this.canBranch && s.roots) add('Fold every branch', 'chevrons-down-up', 'branches');
    if (s.anything) add('Unfold everything', 'chevrons-up-down', 'everything');
    if (!count) add('Nothing to fold', 'fold-vertical', 'none');
    if (evt && typeof evt.clientX === 'number' && evt.clientX && typeof menu.showAtMouseEvent === 'function') {
      menu.showAtMouseEvent(evt);
    } else if (typeof menu.showAtPosition === 'function') {
      const r = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: r.left, y: r.bottom });
    }
  }

  cleanup(view) {
    this.popover.hide();
    view.contentEl
      .querySelectorAll('.dr-fold-btn, .dr-branch-knob, .dr-group-summary, .dr-fold-face, .dr-stack')
      .forEach((el) => el.remove());
    view.contentEl.querySelectorAll('.dr-folded, .dr-holds').forEach((el) => {
      el.removeClass('dr-folded', 'dr-holds');
      el.style.removeProperty('--dr-open-height');
    });
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
