/* ------------------------------------------------------------------ */
/* Canvas: looking a map over                                          */
/*                                                                     */
/* What a large map gathers without anyone meaning it to: cards joined */
/* to nothing, cards with nothing in them, two cards with one title,   */
/* a note's card whose note has gone, and arrows that lead round in a  */
/* circle. Listed to go to, one at a time, opening any fold on the way. */
/* ------------------------------------------------------------------ */

/**
 * What wants a look on a canvas: [{ id, label, problem }], in reading
 * order. `noteExists(path)` says whether a note's card still has its note.
 */
function canvasProblems(model, noteExists) {
  const out = [];
  const cards = model.nodes.filter((n) => !isGroupRecord(n)).sort((a, b) => a.y - b.y || a.x - b.x);
  const joined = new Set();
  model.edges.forEach((e) => {
    joined.add(e.from);
    joined.add(e.to);
  });
  const titles = new Map();
  cards.forEach((n) => {
    const label = canvasCardLabel(n);
    if (n.type === 'text' && !String(n.text || '').trim()) {
      out.push({ id: n.id, label: 'Empty card', problem: 'Has nothing in it' });
      return;
    }
    if (n.type === 'file' && n.file && noteExists && !noteExists(n.file)) {
      out.push({ id: n.id, label, problem: 'Its file is gone' });
    }
    if (!joined.has(n.id) && cards.length > 1) out.push({ id: n.id, label, problem: 'Not joined to anything' });
    const key = label.toLowerCase();
    if (!titles.has(key)) titles.set(key, []);
    titles.get(key).push(n);
  });
  titles.forEach((same) => {
    if (same.length < 2) return;
    same.forEach((n) => out.push({ id: n.id, label: canvasCardLabel(n), problem: `On the canvas ${same.length} times` }));
  });
  // Arrows that come back round to where they started.
  const links = arrowLinks(model);
  const state = new Map();
  const looped = new Set();
  const visit = (id, path) => {
    state.set(id, 1);
    path.push(id);
    (links.children.get(id) || []).forEach((c) => {
      if (state.get(c) === 1) path.slice(path.indexOf(c)).forEach((x) => looped.add(x));
      else if (!state.has(c)) visit(c, path);
    });
    path.pop();
    state.set(id, 2);
  };
  cards.forEach((n) => {
    if (!state.has(n.id)) visit(n.id, []);
  });
  cards.forEach((n) => {
    if (looped.has(n.id)) out.push({ id: n.id, label: canvasCardLabel(n), problem: 'Its arrows lead round in a circle' });
  });
  return out;
}

class CanvasProblemPicker extends FuzzySuggestModal {
  constructor(app, problems, onChoose) {
    super(app);
    this.problems = problems;
    this.onChoose = onChoose;
    this.setPlaceholder(`${problems.length} ${problems.length === 1 ? 'thing' : 'things'} to look at`);
  }

  getItems() {
    return this.problems;
  }

  getItemText(p) {
    return `${p.label} ${p.problem}`;
  }

  renderSuggestion(match, el) {
    el.createDiv({ text: match.item.label });
    el.createDiv({ cls: 'dr-find-where', text: match.item.problem });
  }

  onChooseItem(p) {
    this.onChoose(p);
  }
}

class CanvasCheck extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasCheck',
        name: 'Look the canvas over',
        desc: 'A command listing cards joined to nothing, empty cards, titles used twice, notes gone, and arrows going round in a circle.',
      },
    ];
  }

  sync() {}

  commands() {
    return [
      {
        id: 'check-canvas',
        name: 'Look the canvas over',
        icon: 'list-checks',
        check: () => this.enabled && !!this.pageCanvas(),
        run: () => this.open(this.pageCanvas()),
      },
    ];
  }

  problems(view) {
    const vault = this.app.vault;
    const exists = (path) => (typeof vault.getAbstractFileByPath === 'function' ? !!vault.getAbstractFileByPath(path) : true);
    return canvasProblems(canvasModel(view.canvas), exists);
  }

  open(view) {
    if (!view || !view.canvas) return null;
    const found = this.problems(view);
    if (!found.length) {
      new Notice('Nothing on this canvas wants a look.');
      return found;
    }
    const find = this.plugin.feature(CanvasFind);
    new CanvasProblemPicker(this.app, found, (p) => {
      if (find) find.goTo(view, p.id);
    }).open();
    return found;
  }
}

CanvasCheck.settingKey = 'canvasCheck';
