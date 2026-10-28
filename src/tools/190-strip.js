/* ------------------------------------------------------------------ */
/* Context strip                                                       */
/*                                                                     */
/* The one piece of furniture the reference has that Obsidian doesn't: */
/* a bar that stays put and says what you're in. It carries the note   */
/* you're on, the way the now-playing bar carries the track, with the  */
/* actions that belong to it.                                          */
/* ------------------------------------------------------------------ */

import { MarkdownView, Menu, Platform, setIcon, TFile } from 'obsidian';
import { albumNeighbours, canStep, drawNoteArt, isBrowseView, leadProperty, pageFile, pageLeaf, showMenuAt, step, valueText } from '../core/030-helpers-art.js';
import { asButton, onActivate, relativeDay } from '../core/040-helpers-sorting.js';
import { fmGet } from '../core/045-helpers-properties.js';
import { actionContext, actionsOn, applies, showActionMenu } from '../core/078-actions.js';
import { cardCount } from '../core/079-canvas-adapter.js';
import { Feature } from '../core/080-feature.js';
import { dueNotes, sessionPlace } from '../core/081-study.js';
import { Library } from '../library/130-browse-filters.js';
import { Knowledge } from '../library/254-knowledge.js';
import { Footnotes } from '../note/285-footnotes.js';
import { WorkspaceModes } from './348-workspace-modes.js';

/*
 * The note header's own reading toggle and More, which the strip
 * repeats. Found by the view's references to them where it keeps them,
 * then by their icons — Obsidian's More is three vertical dots, not
 * the horizontal ones, and both icons have been renamed across
 * versions, so every name is listed. Only in a view with a file: that's
 * where the strip has a More of its own.
 */
export const HEADER_MORE_ICONS = ['more-vertical', 'ellipsis-vertical', 'more-horizontal', 'ellipsis'];
export const HEADER_MODE_ICONS = ['book-open', 'edit-3', 'edit', 'pencil', 'pencil-line', 'pen-line'];

export function headerDuplicates(leaf) {
  const view = leaf && !leaf.isDeferred ? leaf.view : null;
  if (!view || !view.containerEl || !(view.file instanceof TFile)) return [];
  const markdown = view instanceof MarkdownView;
  const found = new Set();
  const own = (el) => el && el.nodeType === 1;
  if (own(view.moreOptionsButtonEl)) found.add(view.moreOptionsButtonEl);
  if (markdown && own(view.modeButtonEl)) found.add(view.modeButtonEl);

  const icons = markdown ? HEADER_MORE_ICONS.concat(HEADER_MODE_ICONS) : HEADER_MORE_ICONS;
  view.containerEl.querySelectorAll('.view-actions > .clickable-icon').forEach((btn) => {
    const svg = btn.querySelector('svg');
    const names = ((svg && svg.getAttribute('class')) || '').split(/\s+/);
    if (icons.some((name) => names.indexOf(`lucide-${name}`) !== -1)) found.add(btn);
  });
  return Array.from(found);
}

/* Narrower than this, the strip keeps what's open and its main buttons; the rest go into More. */
/* Under this, the pane is too narrow for the strip to widen sideways: it grows upward as a small sheet. */
export const STRIP_NARROW = 480;

/*
 * What the strip offers for what's open, besides a note's own buttons:
 * actions written once elsewhere, by id — [id, short name, secondary,
 * icon where the action has none of its own].
 * Ones that hang on the canvas's selection aren't here: the strip isn't
 * told when that changes.
 */
export const STRIP_ACTIONS = {
  note: [['add-page', 'Add a page', true, 'plus']],
  canvas: [['canvas-tools', 'Canvas tools', false], ['canvas-quick-add', 'Add or connect a card', false], ['canvas-layout-choose', 'Lay out…', true], ['find-canvas-card', 'Find a card', true], ['present-map', 'Present', true]],
};


export class ContextStrip extends Feature {
  constructor(plugin) {
    super(plugin);
    this.el = null;
  }

  settingsSchema() {
    return [
      {
        key: 'contextStrip',
        name: 'Context strip',
        desc: 'A bar along the bottom with the current note, its cover and actions.',
      },
      {
        key: 'stripPlace',
        name: 'Place in collection',
        desc: 'Show where the note falls in its collection, as 3 of 12.',
        showIf: 'contextStrip',
      },
      {
        key: 'stripDetail',
        type: 'text',
        name: 'Detail line',
        desc: 'What shows beside that: properties, modified, created or folder, separated by commas. Empty for automatic; none for nothing.',
        placeholder: 'domain, status',
        fallback: '',
        showIf: 'contextStrip',
        suggest: 'properties',
        suggestExtra: ['modified', 'created', 'folder', 'none'],
      },
      {
        key: 'stripSide',
        type: 'dropdown',
        name: 'Where it sits',
        desc: 'Along the bottom, or as a slim rail at the side with only the cover, previous, next and more — for narrow windows and split panes.',
        options: { bottom: 'Along the bottom', side: 'A rail at the side' },
        showIf: 'contextStrip',
      },
    ];
  }

  actions() {
    const step = (ctx, dir) => {
      const near = albumNeighbours(this.plugin, ctx.file);
      return near && near[dir];
    };
    return [
      { id: 'previous-in-album', name: 'Previous note in collection', icon: 'chevrons-left', on: 'file', menu: false, when: (ctx) => !!step(ctx, 'previous'), run: () => this.skip('previous') },
      { id: 'next-in-album', name: 'Next note in collection', icon: 'chevrons-right', on: 'file', menu: false, when: (ctx) => !!step(ctx, 'next'), run: () => this.skip('next') },
    ];
  }

  /** The note before or after this one in its album, opened in the same page. */
  skip(dir) {
    const file = pageFile(this.app);
    if (!file) return false;
    const target = albumNeighbours(this.plugin, file)[dir];
    const leaf = pageLeaf(this.app);
    if (!target || !leaf) return false;
    leaf.openFile(target);
    return true;
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', () => this.update())
    );
    this.plugin.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.update())
    );
    // Moving between browse screens changes neither the file nor the
    // leaf, so neither event above covers it.
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => this.update())
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file === this.app.workspace.getActiveFile()) this.update();
      })
    );
    // Moving notes around an album moves its neighbours.
    this.plugin.registerEvent(this.app.vault.on('rename', () => this.update()));
    // What's due to be revisited changed.
    this.plugin.registerEvent(this.app.workspace.on('design-redux:study-changed', () => this.update()));
    // A window made narrow or wide again: what the strip has room for.
    this.plugin.registerDomEvent(window, 'resize', () => {
      if (this.enabled && this.el && this.isNarrow() !== this.narrow) this.update();
    });

    if (Platform.isPhone) this.registerPhone();
    else this.registerAway();
  }

  /**
   * The strip never covers text: it slides down out of view when you scroll down or type, and
   * comes back when you scroll up or the pointer goes to the bottom 80px of the window.
   */
  registerAway() {
    const tops = new WeakMap();
    const away = (on) => {
      if (!this.el) return;
      const held = this.el.matches(':hover') || this.el.matches(':focus-within');
      this.el.toggleClass('is-away', on && !held);
    };
    this.plugin.registerDomEvent(
      document,
      'scroll',
      (evt) => {
        const el = evt.target;
        if (!el || typeof el.matches !== 'function' || !el.matches('.cm-scroller, .markdown-preview-view')) return;
        const last = tops.has(el) ? tops.get(el) : el.scrollTop;
        const moved = el.scrollTop - last;
        tops.set(el, el.scrollTop);
        if (moved > 4) away(true);
        else if (moved < -4) away(false);
      },
      true
    );
    this.plugin.registerDomEvent(document, 'keydown', (evt) => {
      const typed = evt.key.length === 1 || evt.key === 'Backspace' || evt.key === 'Enter';
      if (typed && !evt.metaKey && !evt.ctrlKey && evt.target && typeof evt.target.closest === 'function' && evt.target.closest('.cm-content')) away(true);
    });
    this.plugin.registerDomEvent(document, 'mousemove', (evt) => {
      if (this.el && this.el.hasClass('is-away') && window.innerHeight - evt.clientY <= 80) away(false);
    });
    this.plugin.registerDomEvent(window, 'resize', () => this.fitPadding());
    this.plugin.registerEvent(this.app.workspace.on('layout-change', () => this.fitPadding()));
  }

  /** What the strip covers at the foot of the window, for the note to leave clear: its height, and where it sits. */
  fitPadding() {
    const body = document.body;
    const el = this.el;
    if (!el || !this.enabled || el.hasClass('is-empty') || body.hasClass('dr-strip-side') || !el.offsetHeight) {
      body.style.removeProperty('--dr-strip-h');
      return;
    }
    const bottom = parseFloat(window.getComputedStyle(el).bottom) || 0;
    body.style.setProperty('--dr-strip-h', `${Math.ceil(el.offsetHeight + bottom)}px`);
  }

  /**
   * On a phone the strip is a mini player: it sits above Obsidian's
   * bottom bar, whose height depends on the device, so that's measured
   * rather than assumed; and it steps aside while the keyboard is up,
   * where it would otherwise float over what's being typed.
   */
  registerPhone() {
    const fit = () => this.fitAboveNavbar();
    this.plugin.registerEvent(this.app.workspace.on('resize', fit));
    this.plugin.registerEvent(this.app.workspace.on('layout-change', fit));
    this.plugin.registerDomEvent(window, 'resize', fit);

    const typing = (el) =>
      !!el &&
      typeof el.closest === 'function' &&
      !!el.closest('input, textarea, select, [contenteditable="true"]');
    this.plugin.registerDomEvent(document, 'focusin', (evt) => {
      document.body.toggleClass('dr-typing', typing(evt.target));
    });
    this.plugin.registerDomEvent(document, 'focusout', (evt) => {
      if (!typing(evt.relatedTarget)) document.body.removeClass('dr-typing');
    });
    this.plugin.register(() => {
      document.body.removeClass('dr-typing');
      document.body.style.removeProperty('--dr-strip-bottom');
      document.body.style.removeProperty('--dr-strip-z');
    });
  }

  fitAboveNavbar() {
    const bar = document.querySelector('.mobile-navbar');
    const r = bar ? bar.getBoundingClientRect() : null;
    const z = bar ? parseInt(window.getComputedStyle(bar).zIndex, 10) : NaN;
    if (Number.isFinite(z)) document.body.style.setProperty('--dr-strip-z', String(z));
    if (r && r.height) {
      document.body.style.setProperty(
        '--dr-strip-bottom',
        `${Math.round(window.innerHeight - r.top + 8)}px`
      );
    } else {
      // Hidden while typing, or not there: the stylesheet's fallback.
      document.body.style.removeProperty('--dr-strip-bottom');
    }
  }

  enable() {
    document.body.addClass('dr-strip-active');
    document.body.toggleClass('dr-strip-side', this.settings.stripSide === 'side');
    if (!this.el || !this.el.isConnected) {
      this.el = document.body.createDiv({ cls: 'dr-strip' });
    }
    if (Platform.isPhone) this.fitAboveNavbar();
    this.update();
  }

  disable() {
    document.body.removeClass('dr-strip-active');
    document.body.removeClass('dr-strip-up');
    document.querySelectorAll('.dr-header-sidebar-toggle').forEach((el) => el.remove());
    document.body.removeClass('dr-strip-side');
    document.body.style.removeProperty('--dr-strip-h');
    document.querySelectorAll('.dr-strip-dupe').forEach((el) => el.removeClass('dr-strip-dupe'));
    if (this.el) this.el.remove();
    this.el = null;
  }

  sync() {
    this.update();
  }

  /**
   * Mark the header buttons the strip repeats, in the main area, so the
   * stylesheet can take them away while the strip is up. Marked rather
   * than hidden here, so switching the strip off brings them straight
   * back.
   */
  markDuplicates() {
    const ws = this.app.workspace;
    if (typeof ws.iterateRootLeaves !== 'function') return;
    ws.iterateRootLeaves((leaf) => {
      headerDuplicates(leaf).forEach((el) => el.addClass('dr-strip-dupe'));
    });
  }

  canGo(dir) {
    return canStep(pageLeaf(this.app), dir);
  }

  go(dir) {
    step(pageLeaf(this.app), dir);
    // The stacks have moved, so the buttons need re-reading.
    window.setTimeout(() => this.update(), 50);
  }

  /**
   * Describes the page, not whatever has focus: getActiveFile and
   * activeLeaf both follow focus, so clicking into the sidebar could
   * leave the strip talking about something that isn't on screen.
   */
  update() {
    if (!this.el) return;

    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    const browse = isBrowseView(view) ? view : null;
    const file = !browse && view && view.file instanceof TFile ? view.file : null;

    this.el.empty();
    this.narrow = this.isNarrow();
    this.el.toggleClass('is-narrow', this.narrow);
    this.el.toggleClass('is-sheet', this.narrow);
    // Up only inside a note (or another file open in a tab): not on the
    // library's pages, the graph or an empty tab. While it's down, the
    // header buttons it stands in for show again.
    this.el.toggleClass('is-empty', !file);
    document.body.toggleClass('dr-strip-up', !!file);
    if (!file) {
      if (view && !browse) this.headerToggle(view);
      this.fitPadding();
      return;
    }

    // The header buttons the strip stands in for, marked to be hidden while it's up.
    this.markDuplicates();
    this.renderNav(this.el);
    this.renderNow(this.el, file, view);
    this.renderActions(this.el, file, leaf);
    this.fitPadding();
  }

  /** Narrow enough that the strip's secondary buttons go into More. Not on a phone, whose strip is its own. */
  isNarrow() {
    if (Platform.isMobile || typeof document === 'undefined') return false;
    // The room the strip has: the main pane's width, not the window's.
    const root = document.querySelector('.workspace-split.mod-root');
    const width = root && root.clientWidth ? root.clientWidth : typeof window !== 'undefined' ? window.innerWidth : 1024;
    return width < STRIP_NARROW;
  }

  /** The actions written elsewhere that the strip offers for this kind of page, as buttons — those that apply now. */
  contextSpecs(kind) {
    const out = [];
    (STRIP_ACTIONS[kind] || []).forEach(([id, label, secondary, icon]) => {
      const action = this.findAction(id);
      const ctx = action && actionContext(this.app, action);
      if (!ctx || !applies(action, ctx)) return;
      out.push({
        icon: action.icon || icon || 'circle',
        label,
        role: id,
        secondary,
        run: (evt) => {
          const now = actionContext(this.app, action);
          if (now && applies(action, now)) action.run(Object.assign(now, { from: 'strip', evt }));
        },
      });
    });
    return out;
  }

  /** An action by its id run where it applies now. */
  runAction(id) {
    const action = this.findAction(id);
    const ctx = action && actionContext(this.app, action);
    if (ctx && applies(action, ctx)) action.run(Object.assign(ctx, { from: 'strip' }));
  }

  /** An action by its id, from whichever feature defines it; which feature that is, remembered. */
  findAction(id) {
    if (!this.actionHomes) this.actionHomes = new Map();
    let home = this.actionHomes.get(id);
    if (!home) {
      home = (this.plugin.features || []).find((f) => f.actions().some((a) => a.id === id));
      if (home) this.actionHomes.set(id, home);
    }
    return home ? home.actions().find((a) => a.id === id) : null;
  }

  /** One of the strip's buttons: an icon named for what it does. */
  stripButton(parent, spec) {
    const el = parent.createDiv({ cls: 'clickable-icon dr-strip-btn' });
    if (spec.secondary) el.addClass('is-secondary');
    if (spec.role) el.dataset.action = spec.role;
    el.setAttribute('aria-label', spec.label);
    asButton(el);
    if (spec.icon) setIcon(el, spec.icon);
    if (spec.active) el.addClass('is-active');
    onActivate(el, spec.run);
    return el;
  }

  /**
   * Study, in the More menu: while a session is under way, its next note, marking and
   * ending it; otherwise how many notes are due and a step to the first. `count` is
   * what the More button's badge shows.
   */
  revisitEntries(file) {
    const place = sessionPlace(this.plugin, file);
    if (place) {
      const entries = [{
        icon: 'skip-forward',
        label: place.index === -1 ? `Next note in this session (${place.total})` : `Next note in this session (${place.index + 1} of ${place.total})`,
        role: 'study-session-next',
        run: () => this.runAction('study-session-next'),
      }];
      [['study-mark-revisit', 'Mark to revisit', 'bookmark-plus'], ['study-end-session', 'End the session', 'square']].forEach(([id, label, icon]) => {
        const action = this.findAction(id);
        const ctx = action && actionContext(this.app, action);
        if (ctx && applies(action, ctx)) entries.push({ icon, label, role: id, run: () => this.runAction(id) });
      });
      return { entries, count: place.total };
    }
    const due = dueNotes(this.plugin);
    if (!due.length) return { entries: [], count: 0 };
    return {
      entries: [{
        icon: 'graduation-cap',
        label: `${due.length} to revisit: open the first`,
        role: 'revisit',
        run: () => {
          const next = dueNotes(this.plugin)[0];
          if (next) this.app.workspace.getLeaf(false).openFile(next);
        },
      }],
      count: due.length,
    };
  }

  /**
   * With the strip down, its way back to a closed sidebar goes in the
   * page's own header — an empty tab, the graph — where a hidden ribbon
   * leaves Obsidian none. A library page draws its own. Shown only while
   * the sidebar is closed.
   */
  headerToggle(view) {
    const header = view.containerEl && view.containerEl.querySelector('.view-header-left, .view-header');
    if (!header || header.querySelector('.dr-header-sidebar-toggle')) return;
    const toggle = header.createDiv({ cls: 'clickable-icon dr-header-sidebar-toggle dr-sidebar-toggle' });
    header.prepend(toggle);
    toggle.setAttribute('aria-label', 'Show sidebar');
    asButton(toggle);
    setIcon(toggle, 'panel-left');
    onActivate(toggle, () => this.app.workspace.leftSplit.expand());
  }

  renderNav(strip) {
    const nav = strip.createDiv({ cls: 'dr-strip-nav' });

    // Only while the sidebar is closed; styled in and out by body class.
    const toggle = nav.createDiv({ cls: 'clickable-icon dr-strip-btn dr-sidebar-toggle' });
    toggle.setAttribute('aria-label', 'Show sidebar');
    asButton(toggle);
    setIcon(toggle, 'panel-left');
    onActivate(toggle, () => this.app.workspace.leftSplit.expand());

    [
      ['chevron-left', 'Back', 'back'],
      ['chevron-right', 'Forward', 'forward'],
    ].forEach(([icon, label, dir]) => {
      // Back and forward through what was open: there when wanted, quiet otherwise.
      const el = nav.createDiv({ cls: 'clickable-icon dr-strip-btn is-secondary' });
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      if (!this.canGo(dir)) {
        el.addClass('is-disabled');
        return;
      }
      asButton(el);
      onActivate(el, () => this.go(dir));
    });
  }

  /** The note itself: cover, name, and one property beneath it — for a canvas, how many cards. */
  renderNow(strip, file, view) {
    // The middle of the strip, as a player's: back a note through the
    // album, the note itself, and on a note.
    const center = strip.createDiv({ cls: 'dr-strip-center' });
    const near = albumNeighbours(this.plugin, file);
    this.skipButton(center, near, 'previous');
    const now = center.createDiv({ cls: 'dr-strip-now' });
    asButton(now);

    const art = now.createDiv({ cls: 'dr-strip-art' });
    drawNoteArt(this.plugin, art, file);
    if (file.extension === 'md') art.dataset.coverNote = file.path;

    const text = now.createDiv({ cls: 'dr-strip-text' });
    text.createDiv({ cls: 'dr-strip-title', text: file.basename });
    const count = file.extension === 'canvas' && view && view.canvas ? cardCount(view.canvas) : null;
    const cards = count === null ? -1 : count;
    const lead = cards >= 0 ? `${cards} ${cards === 1 ? 'card' : 'cards'}` : this.leadOf(file);
    // Where it falls in its album, as a player says "3 of 12".
    const place = this.settings.stripPlace !== false && near.index >= 0 && near.total > 1 ? `${near.index + 1} of ${near.total}` : '';
    if (lead || place) {
      const sub = text.createDiv({ cls: 'dr-strip-sub' });
      if (place) sub.createSpan({ cls: 'dr-strip-place', text: place });
      if (lead) sub.createSpan({ text: lead });
    }

    // Clicking it goes to where the note lives, as the now-playing
    // bar goes to the album.
    onActivate(now, () => {
      if (!file.parent) return;
      const library = this.plugin.feature(Library);
      if (library) library.browseMode({ mode: 'folder', path: file.parent.path });
    });
    this.skipButton(center, near, 'next');
  }

  /** « or »: the note before or after this one in its album. */
  skipButton(parent, near, dir) {
    const target = near[dir];
    const word = dir === 'previous' ? 'Previous' : 'Next';
    const el = parent.createDiv({ cls: 'clickable-icon dr-strip-btn dr-strip-skip' });
    el.dataset.action = dir;
    setIcon(el, dir === 'previous' ? 'chevrons-left' : 'chevrons-right');
    el.setAttribute('aria-label', target ? `${word}: ${target.basename}` : `${word}: none`);
    if (!target) {
      el.addClass('is-disabled');
      return el;
    }
    asButton(el);
    onActivate(el, () => this.skip(dir));
    return el;
  }

  renderActions(strip, file, leaf) {
    const actions = strip.createDiv({ cls: 'dr-strip-actions' });

    // Properties, More, and what's there only when it matters — footnotes — always;
    // reading mode, pin and the like when the strip is pointed at or tabbed into — or,
    // in a narrow window, in More.
    const specs = [];

    // The last thing the view header carried that the strip didn't, so
    // the header can go entirely in single-area mode.
    if (leaf && !leaf.isDeferred && leaf.view instanceof MarkdownView) {
      const reading = leaf.view.getMode() === 'preview';
      specs.push({
        icon: reading ? 'pencil' : 'book-open',
        label: reading ? 'Edit' : 'Read',
        role: 'mode',
        secondary: true,
        run: () => {
          // The command acts on whatever has focus, so the page is
          // given focus first; otherwise a click here with the sidebar
          // focused would do nothing.
          this.app.workspace.setActiveLeaf(leaf, { focus: true });
          this.app.commands.executeCommandById('markdown:toggle-preview');
          window.setTimeout(() => this.update(), 50);
        },
      });
    }

    const pinned = this.plugin.pins.has(file);
    specs.push({
      icon: pinned ? 'pin-off' : 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      role: 'pin',
      secondary: true,
      active: pinned,
      run: () => {
        this.plugin.togglePin(file);
        this.update();
      },
    });

    // A page added to the note, a press away; once it has pages the control under its title has the plus.
    if (file.extension === 'md') specs.push(...this.contextSpecs('note'));

    // On a canvas, what can be done to it as a whole.
    if (file.extension === 'canvas') specs.push(...this.contextSpecs('canvas'));

    // The note's footnotes, kept off the page, a press away.
    const footnotes = typeof Footnotes === 'function' ? this.plugin.feature(Footnotes) : null;
    if (footnotes && footnotes.aside && footnotes.countIn(file) > 0) {
      specs.push({ icon: 'file-signature', label: `Footnotes (${footnotes.countIn(file)})`, role: 'footnotes', run: (evt, anchor) => footnotes.showView(undefined, anchor || (evt && evt.currentTarget)) });
    }

    // What can be done to it as a concept, the same as its menu offers.
    const knowledge = typeof Knowledge === 'function' ? this.plugin.feature(Knowledge) : null;
    if (knowledge && knowledge.enabled && file.extension === 'md') {
      specs.push({ icon: 'waypoints', label: 'Concept', role: 'concept', secondary: true, run: (evt) => showActionMenu(evt, actionsOn(knowledge.actions(), 'note'), { file, from: 'strip' }) });
    }

    // A note's properties; a canvas or a picture has none to show.
    if (file.extension === 'md') {
      specs.push({
        icon: 'info',
        label: 'Properties',
        role: 'properties',
        run: (evt, anchor) => {
          // The panel answers if it's on: the strip doesn't know it.
          if (leaf) this.app.workspace.trigger('design-redux:open-panel', leaf, anchor || evt.currentTarget);
        },
      });
    }

    // The workspace mode, with the quieter ones.
    const modes = typeof WorkspaceModes === 'function' ? this.plugin.feature(WorkspaceModes) : null;
    if (modes && modes.enabled) {
      const mode = modes.mode(modes.current());
      specs.push({ icon: mode ? mode.icon : 'layout-template', label: mode ? `${mode.label} mode: switch, or leave it` : 'Workspace mode', role: 'modes', secondary: true, active: !!mode, run: (evt) => modes.showMenu(evt) });
    }

    // The buttons that matter show; the quieter ones fold away until the strip is pointed at or
    // tabbed into, and it widens to show them — at every width; in a narrow pane, upward as a sheet.
    specs.forEach((spec) => this.stripButton(actions, spec));
    const study = this.revisitEntries(file);
    const more = this.stripButton(actions, {
      icon: 'ellipsis',
      label: study.count ? `More (${study.count} to revisit)` : 'More',
      role: 'more',
      run: (evt) => this.moreMenu(evt, file, leaf, specs, study.entries, more),
    });
    if (study.count) more.createSpan({ cls: 'dr-strip-badge', text: String(study.count) });
  }

  /**
   * The ··· menu, short: Read, Properties, Pin, Bookmark, Rename and Delete on top with icons; then
   * study; and Obsidian's other page entries under one More item that opens a submenu.
   */
  moreMenu(evt, file, leaf, specs, study, anchor) {
    const menu = new Menu();
    const add = (title, icon, run, section) =>
      menu.addItem((item) => {
        item.setTitle(title).setIcon(icon).onClick((e) => run(e || evt));
        if (typeof item.setSection === 'function') item.setSection(section || 'action');
      });
    const spec = (role) => specs.find((s) => s.role === role);
    ['mode', 'properties', 'pin'].forEach((role) => {
      const s = spec(role);
      if (s) add(s.label, s.icon, (e) => s.run(e, anchor));
    });
    const commands = this.app.commands;
    if (commands && typeof commands.executeCommandById === 'function' && file.extension === 'md') {
      add('Bookmark', 'bookmark', () => {
        if (leaf) this.app.workspace.setActiveLeaf(leaf, { focus: true });
        commands.executeCommandById('bookmarks:bookmark-current-view');
      });
    }
    const fm = this.app.fileManager;
    if (fm && typeof fm.promptForFileRename === 'function') add('Rename', 'pencil', () => fm.promptForFileRename(file));
    if (fm && typeof fm.promptForDeletion === 'function') add('Delete', 'trash-2', () => fm.promptForDeletion(file));
    else add('Delete', 'trash-2', () => this.app.vault.trash(file, true));
    study.forEach((s) => add(s.label, s.icon, (e) => s.run(e, anchor), 'study'));

    // Obsidian's own page entries — find, export, version history and the file's — behind one item.
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    const fill = (target) => {
      if (view && typeof view.onPaneMenu === 'function') view.onPaneMenu(target, 'more-options');
      else this.app.workspace.trigger('file-menu', target, file, 'design-redux-strip', leaf);
    };
    let nested = false;
    menu.addItem((item) => {
      item.setTitle('More').setIcon('more-horizontal');
      if (typeof item.setSection === 'function') item.setSection('more');
      const sub = typeof item.setSubmenu === 'function' ? item.setSubmenu() : null;
      if (sub) {
        fill(sub);
        nested = true;
      }
    });
    // Without submenus (an older Obsidian), as they always were: after ours.
    if (!nested) {
      if (typeof menu.items === 'object' && Array.isArray(menu.items)) menu.items.pop();
      fill(menu);
    }
    showMenuAt(menu, evt);
  }

  /** What goes beside the note's place in its album: as the setting says, or one property worth showing. */
  leadOf(file) {
    return stripDetail(this.app, file, this.settings.stripDetail);
  }

}

ContextStrip.settingKey = 'contextStrip';

/**
 * A note's line on the strip, from a list of what to show: properties,
 * or modified, created or folder, each the note has, joined by a dot.
 * Empty, the one property worth showing; "none", nothing.
 */
export function stripDetail(app, file, spec) {
  const keys = String(spec || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (!keys.length) return leadProperty(app, file, true);
  if (keys.some((k) => k.toLowerCase() === 'none')) return '';
  const cache = file.extension === 'md' ? app.metadataCache.getFileCache(file) : null;
  const fm = (cache && cache.frontmatter) || {};
  return keys
    .map((key) => {
      const k = key.toLowerCase();
      if (k === 'modified') return relativeDay(file.stat.mtime);
      if (k === 'created') return relativeDay(file.stat.ctime);
      if (k === 'folder') return file.parent && file.parent.path !== '/' ? file.parent.name : '';
      return valueText(fmGet(fm, key));
    })
    .filter(Boolean)
    .join(' · ');
}

