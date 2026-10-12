/* ------------------------------------------------------------------ */
/* Workspace modes                                                     */
/*                                                                     */
/* The workspace set out for one kind of work — browsing the library,  */
/* reading, mapping, researching a note, reviewing — at a command, and */
/* put back exactly as it was when the mode is left: the layout is     */
/* kept on entering, and given back whole. Nothing changes until one  */
/* is chosen; moving from one mode to another still goes back to how   */
/* it was before the first.                                            */
/* ------------------------------------------------------------------ */

const WORKSPACE_MODES = [
  { id: 'library', label: 'Library', icon: 'library', desc: 'Albums and collections to browse, the library beside them' },
  { id: 'study', label: 'Study', icon: 'book-open', desc: 'The note to read, and nothing else in the way' },
  { id: 'mapping', label: 'Mapping', icon: 'layout-dashboard', desc: 'A canvas to arrange, its outline beside it' },
  { id: 'research', label: 'Research', icon: 'microscope', desc: 'A note with its relationships and properties beside it' },
  { id: 'review', label: 'Review', icon: 'stethoscope', desc: 'What changed lately, and what needs looking at' },
];

class WorkspaceModes extends Feature {
  settingsSchema() {
    return [
      {
        key: 'workspaceModes',
        name: 'Workspace modes',
        desc: 'Library, Study, Mapping, Research and Review, each setting the workspace out for that work at a command; leaving one puts the workspace back exactly as it was.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'workspace-mode',
        name: 'Switch workspace mode…',
        icon: 'layout-template',
        when: () => this.enabled,
        run: () => this.choose(),
      },
      {
        id: 'workspace-mode-leave',
        name: 'Leave the workspace mode, back to how it was',
        icon: 'undo-2',
        when: () => this.enabled && !!this.current(),
        run: () => this.leave(),
      },
    ].concat(
      WORKSPACE_MODES.map((m) => ({
        id: `workspace-mode-${m.id}`,
        name: `Workspace mode: ${m.label}`,
        icon: m.icon,
        when: () => this.enabled && this.current() !== m.id,
        run: () => this.enter(m.id),
      }))
    );
  }

  register() {
    // A mode still on from last time: its look comes back with the layout Obsidian kept.
    this.app.workspace.onLayoutReady(() => this.mark());
  }

  disable() {
    this.mark(true);
  }

  current() {
    const id = this.settings.workspaceMode;
    return WORKSPACE_MODES.some((m) => m.id === id) ? id : null;
  }

  mode(id) {
    return WORKSPACE_MODES.find((m) => m.id === id) || null;
  }

  /** The body says which mode it's in, for its look. */
  mark(off) {
    const body = document.body;
    WORKSPACE_MODES.forEach((m) => body.classList.toggle(`dr-mode-${m.id}`, !off && this.enabled && this.current() === m.id));
    const strip = typeof ContextStrip === 'function' ? this.plugin.feature(ContextStrip) : null;
    if (strip && strip.enabled && typeof strip.update === 'function') strip.update();
  }

  /** The switcher's menu: each mode, the one on ticked; leaving it; and its settings. */
  showMenu(evt) {
    const now = this.current();
    const menu = new Menu();
    WORKSPACE_MODES.forEach((m) =>
      menu.addItem((item) =>
        item
          .setTitle(m.label)
          .setIcon(m.icon)
          .setChecked(m.id === now)
          .onClick(() => (m.id === now ? null : this.enter(m.id)))
      )
    );
    menu.addSeparator();
    if (now) menu.addItem((item) => item.setTitle(`Leave ${this.mode(now).label}, back to how it was`).setIcon('log-out').onClick(() => this.leave()));
    if (typeof this.plugin.openSettingsAt === 'function') {
      menu.addItem((item) => item.setTitle('Mode settings…').setIcon('settings').onClick(() => this.plugin.openSettingsAt('workspaceModes')));
    }
    showMenuAt(menu, evt);
  }

  choose() {
    const now = this.current();
    const items = WORKSPACE_MODES.map((m) => ({ label: m.label, note: m.id === now ? 'Now' : m.desc, id: m.id }));
    if (now) items.push({ label: 'Leave the mode', note: 'Back to how the workspace was', id: '' });
    new ComparePicker(this.app, items, 'Which kind of work?', (item) => (item.id ? this.enter(item.id) : this.leave())).open();
  }

  /** Into a mode: the layout kept first — unless another mode already kept it — then set out. */
  async enter(id) {
    const mode = this.mode(id);
    if (!mode) return false;
    const ws = this.app.workspace;
    if (!this.current()) {
      try {
        this.settings.workspaceModeLayout = typeof ws.getLayout === 'function' ? ws.getLayout() : null;
      } catch (err) {
        this.settings.workspaceModeLayout = null;
      }
    }
    this.settings.workspaceMode = id;
    await this.plugin.saveData(this.settings);
    this.mark();
    try {
      await this.apply(id);
    } catch (err) {
      console.error('Design Redux: could not set the workspace out', err);
    }
    this.plugin.offerUndo(`${mode.label}: ${mode.desc.toLowerCase()}.`, () => this.leave());
    return true;
  }

  /** Out of the mode: the workspace as it was before it. */
  async leave() {
    const saved = this.settings.workspaceModeLayout;
    this.settings.workspaceMode = '';
    this.settings.workspaceModeLayout = null;
    await this.plugin.saveData(this.settings);
    this.mark();
    if (saved && typeof this.app.workspace.changeLayout === 'function') {
      try {
        await this.app.workspace.changeLayout(saved);
      } catch (err) {
        console.error('Design Redux: could not put the workspace back', err);
        new Notice('Could not put the workspace back as it was.');
        return false;
      }
    }
    return true;
  }

  sidebars(left, right) {
    const ws = this.app.workspace;
    [[ws.leftSplit, left], [ws.rightSplit, right]].forEach(([split, open]) => {
      if (!split) return;
      if (open && typeof split.expand === 'function') split.expand();
      if (!open && typeof split.collapse === 'function') split.collapse();
    });
  }

  /** The most recent note, or canvas, that's still there. */
  recent(ext) {
    const active = this.app.workspace.getActiveFile();
    if (active && active.extension === ext) return active;
    const paths = typeof this.app.workspace.getLastOpenFiles === 'function' ? this.app.workspace.getLastOpenFiles() : [];
    for (const p of paths) {
      const f = this.app.vault.getFileByPath(p);
      if (f && f.extension === ext) return f;
    }
    return null;
  }

  /** Each mode's layout. */
  async apply(id) {
    const ws = this.app.workspace;
    const library = this.plugin.feature(Library);
    if (id === 'library') {
      this.sidebars(true, false);
      if (library) {
        if (typeof library.reveal === 'function') library.reveal();
        await library.browseMode({ mode: 'home' });
      }
    } else if (id === 'study') {
      this.sidebars(false, false);
      const note = this.recent('md');
      if (note) {
        const leaf = ws.getLeaf(false);
        await leaf.setViewState({ type: 'markdown', state: { file: note.path, mode: 'preview' }, active: true });
      }
    } else if (id === 'mapping') {
      this.sidebars(false, true);
      const canvas = this.recent('canvas');
      if (canvas) await ws.getLeaf(false).openFile(canvas);
      const outline = typeof CanvasOutline === 'function' ? this.plugin.feature(CanvasOutline) : null;
      if (outline && outline.enabled) await outline.show();
    } else if (id === 'research') {
      this.sidebars(true, true);
      const note = this.recent('md');
      if (note) {
        await ws.getLeaf(false).openFile(note);
        const knowledge = typeof Knowledge === 'function' ? this.plugin.feature(Knowledge) : null;
        if (knowledge && knowledge.enabled) {
          const side = ws.getLeaf('split');
          await side.setViewState({ type: BROWSE_VIEW, active: false, state: { mode: 'concept', path: '/', property: note.path, value: null } });
        }
      }
    } else if (id === 'review') {
      this.sidebars(true, false);
      if (library) await library.browseMode({ mode: 'library-check' });
    }
  }
}

WorkspaceModes.settingKey = 'workspaceModes';
