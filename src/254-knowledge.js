/* ------------------------------------------------------------------ */
/* What notes mean to each other                                       */
/*                                                                     */
/* One set of relationships for the whole vault, kept in the notes     */
/* themselves: a note says "is a type of: [[Form of government]]" as a  */
/* property, named for one of the kinds of relationship set for canvas */
/* arrows, and the note it names reads the other way — has type — with */
/* nothing written there. The graph's own parent property counts too,  */
/* as "sits under". Where it's shown is up to the view: an explorer of */
/* a note's relationships, a canvas drawn from them or written into    */
/* them, the library's check. The notes stay plain Obsidian notes.     */
/* ------------------------------------------------------------------ */

/** A note chosen from the vault's notes. */
class NotePicker extends FuzzySuggestModal {
  constructor(app, placeholder, onChoose, skip) {
    super(app);
    this.onChooseNote = onChoose;
    this.skip = skip;
    this.setPlaceholder(placeholder);
  }

  getItems() {
    return this.app.vault.getMarkdownFiles().filter((f) => !this.skip || !this.skip(f));
  }

  getItemText(file) {
    return file.path.replace(/\.md$/, '');
  }

  onChooseItem(file) {
    this.onChooseNote(file);
  }
}

/* -- the explorer ---------------------------------------------------- */

class ConceptScreen extends BrowseScreen {
  get knowledge() {
    const k = this.plugin.feature(Knowledge);
    return k && k.enabled ? k : null;
  }

  file() {
    const path = this.view.property;
    return path ? this.app.vault.getFileByPath(path) : null;
  }

  title() {
    const file = this.file();
    return file ? file.basename : 'Relationships';
  }

  render(root) {
    const view = this.view;
    const k = this.knowledge;
    const file = this.file();
    view.renderTitleBar(root, 'Relationships');
    if (!k || !file) {
      view.emptyState(root, file ? 'Relationships are switched off in settings.' : 'That note isn’t there any more.', 'waypoints');
      return;
    }
    const head = root.createDiv({ cls: 'dr-concept-head' });
    const art = head.createDiv({ cls: 'dr-concept-art' });
    drawNoteArt(this.plugin, art, file);
    const info = head.createDiv({ cls: 'dr-detail-info' });
    // The way up through what it sits under, as an album shows its folders.
    const chain = k.broaderChain(file);
    if (chain.length) {
      const crumbs = info.createDiv({ cls: 'dr-detail-kicker' }).createEl('nav', { cls: 'dr-crumbs', attr: { 'aria-label': 'What it comes under' } });
      chain.forEach((f, i) => {
        if (i) crumbs.createSpan({ cls: 'dr-crumb-sep', text: '›' });
        const crumb = crumbs.createSpan({ cls: 'dr-crumb', text: f.basename });
        asButton(crumb);
        onActivate(crumb, () => view.navigate({ mode: 'concept', property: f.path }));
      });
    }
    info.createDiv({ cls: 'dr-detail-title', text: file.basename });
    const groups = k.groups(file);
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    info.createDiv({ cls: 'dr-detail-meta', text: count === 1 ? '1 relationship' : `${count} relationships` });
    const actions = info.createDiv({ cls: 'dr-detail-actions' });
    view.action(actions, 'file-text', 'Open note', () => this.app.workspace.getLeaf(false).openFile(file)).addClass('is-primary');
    view.action(actions, 'plus', 'Add a relationship', () => k.ask(file));
    if (count) view.action(actions, 'layout-dashboard', 'Map it', () => k.map(file));
    const check = typeof KnowledgeCheck === 'function' ? this.plugin.feature(KnowledgeCheck) : null;
    if (check && check.enabled) check.renderFor(root, file, view);
    if (!count) {
      view.emptyState(root, 'Nothing related to it yet.', 'waypoints', ['Add a relationship', () => k.ask(file)]);
      return;
    }
    groups.forEach((group) => {
      const headRow = root.createDiv({ cls: 'dr-report-head' });
      headRow.createSpan({ text: group.label });
      headRow.createSpan({ cls: 'dr-report-count', text: String(group.items.length) });
      const list = root.createDiv({ cls: 'dr-report-list' });
      roveFocus(list, '.dr-report-row');
      group.items.forEach((item) => {
        const row = list.createDiv({ cls: 'dr-report-row' });
        row.dataset.path = item.file.path;
        asButton(row);
        setIcon(row.createSpan({ cls: 'dr-report-icon' }), 'file-text');
        const text = row.createDiv({ cls: 'dr-report-text' });
        text.createDiv({ cls: 'dr-report-name', text: item.file.basename });
        if (item.file.parent && item.file.parent.path !== '/') text.createDiv({ cls: 'dr-report-problem', text: item.file.parent.path });
        // Into its relationships; with a modifier, the note itself.
        onActivate(row, (evt) => {
          if (evt && (evt.metaKey || evt.ctrlKey)) view.openFile(item.file, evt);
          else view.navigate({ mode: 'concept', property: item.file.path });
        });
        onContextMenu(row, (evt) => {
          const menu = new Menu();
          menu.addItem((m) => m.setTitle('Open note').setIcon('file-text').onClick(() => this.app.workspace.getLeaf(false).openFile(item.file)));
          menu.addItem((m) => m.setTitle('Remove this relationship').setIcon('x').onClick(() => k.remove(item.from, item.kind, item.to)));
          showMenuAt(menu, evt);
        });
      });
    });
  }
}

BROWSE_SCREENS.concept = ConceptScreen;

/* -- the model ------------------------------------------------------- */

/** In the note panel: what the note comes under, its relationships both ways, and what to do with them. */
class RelationsSection extends PanelSection {
  constructor(panel, knowledge) {
    super(panel);
    this.knowledge = knowledge;
  }

  get cls() {
    return 'dr-relations-section';
  }

  render() {
    const k = this.knowledge;
    const file = this.file;
    if (!file || file.extension !== 'md') return;
    this.renderLabel('Relationships');
    const chain = k.broaderChain(file);
    if (chain.length) {
      const under = this.containerEl.createDiv({ cls: 'dr-relations-under' });
      under.createSpan({ cls: 'dr-relations-under-word', text: 'Under' });
      chain.forEach((f, i) => {
        if (i) under.createSpan({ cls: 'dr-crumb-sep', text: '›' });
        const crumb = under.createSpan({ cls: 'dr-relations-crumb', text: f.basename });
        asButton(crumb, `Open ${f.basename}`);
        onActivate(crumb, () => {
          this.app.workspace.getLeaf(false).openFile(f);
          this.panel.close();
        });
      });
    }
    const groups = k.groups(file);
    groups.forEach((g) =>
      this.renderList(`relation-${g.label.toLowerCase()}`, g.label, g.items, (list, item) => {
        const row = this.fileRow(list, item.file);
        const off = row.createSpan({ cls: 'dr-mention-remove' });
        setIcon(off, 'x');
        asButton(off, `Take off: ${item.from.basename} ${item.kind.name} ${item.to.basename}`);
        onActivate(off, (evt) => {
          if (evt) evt.stopPropagation();
          k.remove(item.from, item.kind, item.to);
        });
      })
    );
    if (!groups.length) this.containerEl.createDiv({ cls: 'dr-empty', text: 'Nothing related to it yet.' });
    const actions = this.containerEl.createDiv({ cls: 'dr-section-actions' });
    const act = (icon, label, run) => {
      const b = actions.createEl('button', { cls: 'dr-section-action' });
      setIcon(b.createSpan({ cls: 'dr-section-action-icon' }), icon);
      b.createSpan({ text: label });
      b.addEventListener('click', run);
    };
    act('plus', 'Add', () => k.ask(file));
    if (groups.length) {
      act('waypoints', 'Explore', () => {
        k.explore(file);
        this.panel.close();
      });
      act('network', 'Map', () => k.map(file));
    }
  }

  /** Any note's change may be one of this note's relationships: drawn again once the index has caught up. */
  refresh() {
    window.clearTimeout(this.redraw);
    this.redraw = window.setTimeout(() => super.refresh(), 0);
  }

  destroy() {
    window.clearTimeout(this.redraw);
    super.destroy();
  }
}

class Knowledge extends Feature {
  settingsSchema() {
    return [
      {
        key: 'knowledge',
        name: 'Relationships between notes',
        desc: 'A note’s relationships kept as its own properties, one for each kind of relationship set for canvas arrows (and the graph’s parent, as what it sits under). An explorer shows any note’s, both ways; a canvas can be drawn from them, or write its arrows into them; the library’s check looks them over.',
      },
      {
        key: 'panelRelationships',
        name: 'Relationships in the note panel',
        desc: 'Below a note’s properties: what it comes under, and its relationships both ways — each to open or take off — with a way to add one, explore them or map them.',
        showIf: 'knowledge',
      },
    ];
  }

  panelSections(panel) {
    return this.settings.panelRelationships !== false ? [new RelationsSection(panel, this)] : [];
  }

  /**
   * What can be done to a concept, defined once: the palette, its note's
   * menu, its card's menu on a canvas and the strip all offer these.
   */
  actions() {
    const on = (ctx) => this.enabled && !!ctx && !!ctx.file && ctx.file.extension === 'md';
    const up = (ctx) => this.relationsOf(ctx.file).out.some((r) => r.kind.category === 'hierarchy');
    return [
      { id: 'knowledge-explore', name: 'Explore this note’s relationships', menu: 'Show related concepts', icon: 'waypoints', on: 'note', when: on, run: (ctx) => this.explore(ctx.file) },
      { id: 'knowledge-add', name: 'Add a relationship to this note…', menu: 'Add a relationship…', icon: 'plus', on: 'note', when: on, run: (ctx) => this.ask(ctx.file) },
      { id: 'knowledge-child', name: 'Create a concept under this one…', menu: 'Create a child concept…', icon: 'corner-down-right', on: 'note', when: on, run: (ctx) => this.createConcept(ctx.file) },
      { id: 'knowledge-move', name: 'Move this concept under another…', menu: 'Move under another concept…', icon: 'move-up-right', on: 'note', when: on, run: (ctx) => this.askMove(ctx.file) },
      { id: 'knowledge-broader', name: 'Find what this concept comes under…', menu: 'Find broader concepts…', icon: 'arrow-up-to-line', on: 'note', when: (ctx) => on(ctx) && up(ctx), run: (ctx) => this.chooseBroader(ctx.file) },
      { id: 'knowledge-in-canvas', name: 'Open this note in a canvas', menu: 'Open in canvas', icon: 'layout-dashboard', on: 'note', when: (ctx) => on(ctx) && ctx.from !== 'canvas', run: (ctx) => this.openInCanvas(ctx.file) },
      { id: 'knowledge-in-album', name: 'Open this note’s album', menu: 'Open in album', icon: 'disc', on: 'note', when: on, run: (ctx) => this.openInAlbum(ctx.file) },
      { id: 'knowledge-map', name: 'Map this note’s relationships on a canvas', menu: 'Map its relationships', icon: 'network', on: 'note', when: on, run: (ctx) => this.map(ctx.file) },
      { id: 'knowledge-create', name: 'Create a concept…', menu: false, icon: 'file-plus', on: 'app', when: () => this.enabled, run: () => this.createConcept(null) },
      { id: 'knowledge-canvas-write', name: 'Write this canvas’s relationships into its notes', menu: false, icon: 'file-input', on: 'canvas', when: () => this.enabled, run: (ctx) => this.writeFromCanvas(ctx.view) },
      { id: 'knowledge-canvas-draw', name: 'Draw its notes’ relationships on this canvas', menu: false, icon: 'git-branch-plus', on: 'canvas', when: () => this.enabled, run: (ctx) => this.drawOnCanvas(ctx.view) },
    ];
  }

  /** The kind a child concept is given: the first hierarchy kind — the graph's parent, where it counts. */
  childKind() {
    return this.kinds().find((k) => k.category === 'hierarchy') || this.kinds()[0];
  }

  /** A name for a new concept, under `parent` if given. */
  createConcept(parent) {
    new NamePrompt(this.app, parent ? `A concept under ${parent.basename}` : 'A new concept', 'Name', (name) => this.makeConcept(name, parent), { button: 'Create' }).open();
  }

  /** A new note, under `parent` if given — beside it, saying so — or in the folder open; opened, with Undo. */
  async makeConcept(name, parent) {
    name = String(name || '').trim();
    if (!name) return null;
    const kind = parent ? this.childKind() : null;
    const active = this.app.workspace.getActiveFile();
    const folder = (parent && parent.parent) || (active && active.parent) || this.app.vault.getRoot();
    const path = this.plugin.freeChildPath(folder, noteNameFrom(name), 'md');
    const link = parent ? `[[${this.app.metadataCache.fileToLinktext(parent, path, true)}]]` : '';
    const key = kind && /[:#]/.test(kind.prop) ? JSON.stringify(kind.prop) : kind && kind.prop;
    const body = parent ? `---\n${key}: "${link}"\n---\n` : '';
    let file = null;
    try {
      file = await this.app.vault.create(path, body);
    } catch (err) {
      console.error('Design Redux: could not make the concept', err);
      new Notice('Could not make that note.');
      return null;
    }
    this.cache = null;
    await this.app.workspace.getLeaf(false).openFile(file);
    this.plugin.offerUndo(`Made ${file.basename}${parent ? `, ${kind.name} ${parent.basename}` : ''}.`, () => this.app.fileManager.trashFile(file));
    return file;
  }

  /** Under another concept instead, chosen from the notes. */
  askMove(file) {
    new NotePicker(this.app, `${file.basename} ${this.childKind().name}…`, (target) => this.moveUnder(file, target), (f) => f === file).open();
  }

  /** Its first hierarchy kind naming `target` only, with Undo. */
  async moveUnder(file, target) {
    const kind = this.childKind();
    const link = `[[${this.app.metadataCache.fileToLinktext(target, file.path, true)}]]`;
    const record = await this.edit(file, kind.prop, () => [link]);
    if (!record) return false;
    this.plugin.notes.offerUndo(`${file.basename} ${kind.name} ${target.basename} now.`, [record], () => this.changed());
    return true;
  }

  /** What it comes under, nearest first, to explore. */
  chooseBroader(file) {
    const direct = this.relationsOf(file).out.filter((r) => r.kind.category === 'hierarchy');
    const chain = this.broaderChain(file).reverse();
    const seen = new Set();
    const items = direct.map((r) => ({ label: r.file.basename, note: r.kind.name, file: r.file }))
      .concat(chain.map((f, i) => ({ label: f.basename, note: i ? `${i + 1} steps up` : 'directly above', file: f })))
      .filter((x) => !seen.has(x.file) && seen.add(x.file));
    new ComparePicker(this.app, items, `What ${file.basename} comes under`, (item) => this.explore(item.file)).open();
  }

  /** Its album: the folder it's kept in, or any album taking it in. */
  openInAlbum(file) {
    const library = this.plugin.feature(Library);
    if (!library) return;
    const albums = file.parent && !(file.parent.isRoot && file.parent.isRoot()) ? [file.parent] : [];
    const structure = typeof AlbumStructure === 'function' ? this.plugin.feature(AlbumStructure) : null;
    if (structure && structure.enabled) {
      const walk = (folder) =>
        (folder.children || []).forEach((c) => {
          if (!(c instanceof TFolder)) return;
          if (albums.indexOf(c) === -1 && structure.info(c).includes.indexOf(file) !== -1) albums.push(c);
          walk(c);
        });
      walk(this.app.vault.getRoot());
    }
    const go = (folder) => library.browseMode({ mode: 'folder', path: folder.path });
    if (!albums.length) return library.browseMode({ mode: 'folder', path: '/' });
    if (albums.length === 1) return go(albums[0]);
    new ComparePicker(this.app, albums.map((f, i) => ({ label: f.name, note: i ? 'takes it in' : 'kept here', f })), `${file.basename} is in…`, (item) => go(item.f)).open();
    return null;
  }

  register() {
    // A note's card on a canvas offers what its note does.
    this.plugin.registerEvent(
      this.app.workspace.on('canvas:node-menu', (menu, node) => {
        const file = this.enabled ? this.noteOfCard(node) : null;
        if (file) addActionItems(menu, actionsOn(this.actions(), 'note'), { file, node, view: node.canvas && node.canvas.view, from: 'canvas' }, 'Concept', 'waypoints');
      })
    );
    const stale = () => (this.cache = null);
    this.plugin.registerEvent(this.app.metadataCache.on('changed', stale));
    this.plugin.registerEvent(this.app.vault.on('rename', stale));
    this.plugin.registerEvent(this.app.vault.on('delete', stale));
  }

  /** The kinds of relationship: the canvas's, each read as a note property of its name — and the graph's parent. */
  kinds() {
    const set = relationTypes(this.settings);
    const parent = String(this.settings.graphRouteProperty || 'parent').trim();
    const out = set.map((t) => Object.assign({ prop: t.name }, t));
    if (parent && !out.some((t) => t.prop.toLowerCase() === parent.toLowerCase())) {
      out.unshift({ name: 'sits under', inverse: 'holds', category: 'hierarchy', prop: parent, line: 'solid', color: '', generic: true });
    }
    return out;
  }

  kindNamed(name) {
    return this.kinds().find((k) => k.name === name) || null;
  }

  /** Every relationship in the vault, by note both ways, worked out once until something changes. */
  index() {
    if (this.cache) return this.cache;
    const out = new Map();
    const into = new Map();
    const broken = [];
    const twice = [];
    const kinds = this.kinds();
    const push = (map, key, value) => map.set(key, (map.get(key) || []).concat(value));
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache && cache.frontmatter;
      if (!fm) return;
      kinds.forEach((kind) => {
        const seen = new Set();
        valueList(fmGet(fm, kind.prop)).forEach((raw) => {
          const target = this.app.metadataCache.getFirstLinkpathDest(plainValue(raw), file.path);
          if (!target) {
            // Only what was written as a link: a plain word may mean something else.
            if (/\[\[/.test(raw)) broken.push({ file, kind, name: plainValue(raw) });
            return;
          }
          if (target === file) return;
          if (seen.has(target)) {
            twice.push({ file, kind, target });
            return;
          }
          seen.add(target);
          push(out, file.path, { kind, file: target });
          push(into, target.path, { kind, file });
        });
      });
    });
    this.cache = { out, into, broken, twice, kinds };
    return this.cache;
  }

  /** A note's relationships, each way: [{ kind, file }] out and in. */
  relationsOf(file) {
    const idx = this.index();
    return { out: (file && idx.out.get(file.path)) || [], in: (file && idx.into.get(file.path)) || [] };
  }

  /**
   * A note's relationships grouped as they read from it — "is a type of"
   * for what it says, "has type" for what says it of it — hierarchy
   * first. Each item knows which note holds it, to remove it.
   */
  groups(file) {
    const rel = this.relationsOf(file);
    const out = [];
    this.kinds()
      .slice()
      .sort((a, b) => (a.category === 'hierarchy' ? 0 : 1) - (b.category === 'hierarchy' ? 0 : 1))
      .forEach((kind) => {
        const ahead = rel.out.filter((r) => r.kind.prop === kind.prop).map((r) => ({ file: r.file, kind, from: file, to: r.file }));
        const back = rel.in.filter((r) => r.kind.prop === kind.prop).map((r) => ({ file: r.file, kind, from: r.file, to: file }));
        const byName = (a, b) => a.file.basename.localeCompare(b.file.basename);
        if (ahead.length) out.push({ label: kind.name.charAt(0).toUpperCase() + kind.name.slice(1), items: ahead.sort(byName) });
        if (back.length) {
          const inverse = kind.inverse && kind.inverse !== kind.name ? kind.inverse : `${kind.name} (from)`;
          out.push({ label: inverse.charAt(0).toUpperCase() + inverse.slice(1), items: back.sort(byName) });
        }
      });
    return out;
  }

  /** What a note comes under, from the top down, by the first hierarchy relationship at each step. */
  broaderChain(file) {
    const chain = [];
    const seen = new Set([file]);
    let at = file;
    for (let i = 0; i < 12; i++) {
      const up = this.relationsOf(at).out.find((r) => r.kind.category === 'hierarchy');
      if (!up || seen.has(up.file)) break;
      seen.add(up.file);
      chain.unshift(up.file);
      at = up.file;
    }
    return chain;
  }

  explore(file) {
    const library = this.plugin.feature(Library);
    if (file && library) library.browseMode({ mode: 'concept', property: file.path });
  }

  /* -- changing them, each one step of Undo ------------------------ */

  /** The kind, then the other note. */
  ask(file) {
    if (!file) return;
    const items = this.kinds().map((k) => ({ label: `${file.basename} ${k.name}…`, note: k.category === 'hierarchy' ? 'Hierarchy' : 'Association', kind: k }));
    new ComparePicker(this.app, items, 'How does it relate?', (item) => {
      new NotePicker(this.app, `${file.basename} ${item.kind.name}…`, (target) => this.add(file, item.kind, target), (f) => f === file).open();
    }).open();
  }

  async add(file, kind, target) {
    if (!file || !target || file === target) return false;
    if (this.relationsOf(file).out.some((r) => r.kind.prop === kind.prop && r.file === target)) {
      new Notice(`${file.basename} ${kind.name} ${target.basename} already.`);
      return false;
    }
    const link = `[[${this.app.metadataCache.fileToLinktext(target, file.path, true)}]]`;
    const record = await this.edit(file, kind.prop, (list) => list.concat(link));
    if (!record) return false;
    this.plugin.notes.offerUndo(`${file.basename} ${kind.name} ${target.basename}.`, [record], () => this.changed());
    return true;
  }

  async remove(file, kind, target) {
    const record = await this.edit(file, kind.prop, (list) => list.filter((v) => this.app.metadataCache.getFirstLinkpathDest(plainValue(v), file.path) !== target));
    if (!record) return false;
    this.plugin.notes.offerUndo(`${file.basename} no longer ${kind.name} ${target.basename}.`, [record], () => this.changed());
    return true;
  }

  /** A note's property changed as a list: what changed (for Undo), or null where it couldn't be. */
  async edit(file, prop, change) {
    const record = await this.plugin.notes.write(
      file,
      (fm) => {
        const name = Object.keys(fm).find((k) => k.toLowerCase() === prop.toLowerCase()) || prop;
        const next = change(valueList(fm[name]));
        if (next.length) fm[name] = next;
        else delete fm[name];
      },
      { failure: 'Could not change that relationship.' }
    );
    if (record) this.changed();
    return record;
  }

  /** After a relationship is written or undone: worked out again, and shown. */
  changed() {
    this.cache = null;
    this.plugin.refreshBrowse();
  }

  /* -- what to look at --------------------------------------------- */

  /**
   * Relationships worth a look, for the library's check: the errors and
   * what's worth a look from the knowledge check (261), one row a note —
   * not the modelling choices, nor what's been marked as meant.
   */
  problems() {
    const kinds = { broken: 'relation-missing', repeat: 'relation-twice', both: 'relation-twice', cycle: 'relation-loop', redundant: 'relation-implied', conflict: 'relation-roles', oppose: 'relation-roles', folder: 'relation-roles', parents: 'relation-parents', orphan: 'relation-orphan', broader: 'relation-broader' };
    const out = [];
    knowledgeFindings(this).forEach((f) => {
      if (f.level === 'choice') return;
      (f.type === 'cycle' ? f.notes : [f.subject]).forEach((target) => out.push({ target, kind: kinds[f.type] || 'relation-roles', problem: f.text }));
    });
    return out;
  }

  /* -- canvas, both ways: in 326-canvas-relations (KnowledgeCanvas) -- */

  /** On a note's menu: its relationships. */
  addFileItems(menu, file, sectioned) {
    if (!this.enabled || !file || file.extension !== 'md') return;
    addActionItems(menu, actionsOn(this.actions(), 'note'), { file, from: 'menu' }, 'Concept', 'waypoints', sectioned);
  }
}

Knowledge.settingKey = 'knowledge';
