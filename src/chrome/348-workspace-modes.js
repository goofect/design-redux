/* ------------------------------------------------------------------ */
/* Workspace modes                                                     */
/*                                                                     */
/* The workspace set out for one way of working — reading, research,  */
/* a canvas — at a command, and Standard, the workspace as you keep it, */
/* put back exactly as it was when the mode is left: the layout is     */
/* kept on entering, and given back whole. Nothing changes until one  */
/* is chosen; moving from one mode to another still goes back to how   */
/* it was before the first.                                            */
/* ------------------------------------------------------------------ */

import { Menu, Notice } from 'obsidian';
import { BROWSE_VIEW } from '../core/020-constants.js';
import { showMenuAt } from '../core/030-helpers-art.js';
import { Feature } from '../core/080-feature.js';
import { Library } from '../library/130-browse-filters.js';
import { ContextStrip } from './190-strip.js';
import { ReadingOutline } from './195-reading-outline.js';
import { ComparePicker } from '../ui/230-pickers.js';
import { Knowledge } from '../library/254-knowledge.js';
import { CanvasOutline } from '../canvas/339-canvas-outline.js';

/*
 * How you're working, not where you are: the library is a place, gone to
 * from its sidebar, and reviewing it is one of its places. Standard is no
 * mode — the workspace as you keep it. The Canvas mode keeps the id it had
 * as Mapping, so its command and hotkey stay.
 */
export const WORKSPACE_MODES = [
  { id: 'study', label: 'Study', icon: 'book-open', desc: 'The note to read, and nothing else in the way' },
  { id: 'research', label: 'Research', icon: 'microscope', desc: 'A note with its relationships and properties beside it' },
  { id: 'mapping', label: 'Canvas', icon: 'layout-dashboard', desc: 'A canvas to arrange, its outline beside it' },
];

/* What were modes before, kept as commands to the places they opened — their hotkeys still work. */
export const RETIRED_MODES = ['library', 'review'];

export class WorkspaceModes extends Feature {
  settingsSchema() {
    return [
      {
        key: 'workspaceModes',
        name: 'Workspace modes',
        desc: 'Study, Research and Canvas, each setting the workspace out for that way of working; Standard puts it back exactly as it was.',
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
        name: 'Workspace mode: Standard, back to how it was',
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
      })),
      [
        // Places now, not modes: the library's Home, and its check.
        { id: 'workspace-mode-library', name: 'Open the library', icon: 'library', run: () => this.place('home') },
        { id: 'workspace-mode-review', name: 'Review the library: what needs looking at', icon: 'stethoscope', run: () => this.place('library-check') },
      ].map((a) => Object.assign({ when: () => this.enabled && !!this.plugin.feature(Library) }, a))
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

  /** One of the library's places, in the page, its sidebar showing. */
  async place(screen) {
    const library = this.plugin.feature(Library);
    if (!library) return;
    if (typeof library.reveal === 'function') library.reveal();
    await library.browseMode({ mode: screen });
  }

  /** The switcher's menu: Standard and each mode, the one on ticked; and its settings. */
  showMenu(evt) {
    const now = this.current();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle('Standard')
        .setIcon('layout-panel-left')
        .setChecked(!now)
        .onClick(() => (now ? this.leave() : null))
    );
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
    if (typeof this.plugin.openSettingsAt === 'function') {
      menu.addItem((item) => item.setTitle('Mode settings…').setIcon('settings').onClick(() => this.plugin.openSettingsAt('workspaceModes')));
    }
    showMenuAt(menu, evt);
  }

  choose() {
    const now = this.current();
    const items = [{ label: 'Standard', note: !now ? 'Now' : 'The workspace as you keep it, back as it was', id: '' }].concat(
      WORKSPACE_MODES.map((m) => ({ label: m.label, note: m.id === now ? 'Now' : m.desc, id: m.id }))
    );
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
    if (id === 'study') {
      const outline = typeof ReadingOutline === 'function' ? this.plugin.feature(ReadingOutline) : null;
      const withOutline = !!(outline && outline.enabled);
      this.sidebars(false, withOutline);
      const note = this.recent('md');
      if (note) {
        const leaf = ws.getLeaf(false);
        await leaf.setViewState({ type: 'markdown', state: { file: note.path, mode: 'preview' }, active: true });
      }
      if (withOutline) await outline.show();
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
    }
  }
}

WorkspaceModes.settingKey = 'workspaceModes';
