/* ------------------------------------------------------------------ */
/* Context strip                                                       */
/*                                                                     */
/* The one piece of furniture the reference has that Obsidian doesn't: */
/* a bar that stays put and says what you're in. It carries the note   */
/* you're on, the way the now-playing bar carries the track, with the  */
/* actions that belong to it.                                          */
/* ------------------------------------------------------------------ */

/*
 * The note header's own reading toggle and More, which the strip
 * repeats. Found by the view's references to them where it keeps them,
 * then by their icons — Obsidian's More is three vertical dots, not
 * the horizontal ones, and both icons have been renamed across
 * versions, so every name is listed. Only in a view with a file: that's
 * where the strip has a More of its own.
 */
const HEADER_MORE_ICONS = ['more-vertical', 'ellipsis-vertical', 'more-horizontal', 'ellipsis'];
const HEADER_MODE_ICONS = ['book-open', 'edit-3', 'edit', 'pencil', 'pencil-line', 'pen-line'];

function headerDuplicates(leaf) {
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

/* The sign a screen shows where a note shows its cover. */
/* Narrower than this, the strip keeps what's open and its main buttons; the rest go into More. */
const STRIP_NARROW = 760;

/*
 * What the strip offers for what's open, besides a note's own buttons:
 * actions written once elsewhere, by id — [id, short name, secondary,
 * icon where the action has none of its own].
 * Ones that hang on the canvas's selection aren't here: the strip isn't
 * told when that changes.
 */
const STRIP_ACTIONS = {
  album: [['new-note-here', 'New note', false, 'file-plus'], ['shuffle-album', 'Shuffle', false]],
  canvas: [['canvas-quick-add', 'Add or connect a card', false], ['canvas-layout-choose', 'Lay out…', true], ['find-canvas-card', 'Find a card', true]],
};

const STRIP_SCREEN_ICONS = { smart: 'sparkles', 'library-check': 'stethoscope', inbox: 'inbox', home: 'home', search: 'search', folders: 'folder', notes: 'file-text', properties: 'tags', pinned: 'pin', recents: 'clock' };

class ContextStrip extends Feature {
  constructor(plugin) {
    super(plugin);
    this.el = null;
    this.scrollHost = null;
    this.scrollFrame = 0;
    this.onScroll = () => {
      if (this.scrollFrame) return;
      this.scrollFrame = window.requestAnimationFrame(() => {
        this.scrollFrame = 0;
        this.measureScroll();
      });
    };
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
        name: 'Place in album',
        desc: 'Show where the note falls in its album, as 3 of 12.',
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
        key: 'stripProgress',
        name: 'Reading progress',
        desc: 'A thin line along the bar for how far down the note you are.',
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
      { id: 'previous-in-album', name: 'Previous note in album', icon: 'chevrons-left', on: 'file', menu: false, when: (ctx) => !!step(ctx, 'previous'), run: () => this.skip('previous') },
      { id: 'next-in-album', name: 'Next note in album', icon: 'chevrons-right', on: 'file', menu: false, when: (ctx) => !!step(ctx, 'next'), run: () => this.skip('next', true) },
    ];
  }

  /**
   * The note before or after this one in its album, opened in the same
   * page. The strip's » takes Up Next's first before the album's next.
   */
  skip(dir, albumOnly) {
    const file = pageFile(this.app);
    if (!file) return false;
    const queued = dir === 'next' && !albumOnly ? this.queuedAfter(file) : null;
    if (queued) {
      this.plugin.feature(UpNext).open(queued);
      return true;
    }
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
    // A window made narrow or wide again: what the strip has room for.
    this.plugin.registerDomEvent(window, 'resize', () => {
      if (this.enabled && this.el && this.isNarrow() !== this.narrow) this.update();
    });

    if (Platform.isPhone) this.registerPhone();
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
    if (!this.el || !this.el.isConnected) {
      this.el = document.body.createDiv({ cls: 'dr-strip' });
    }
    if (Platform.isPhone) this.fitAboveNavbar();
    this.update();
  }

  disable() {
    this.watchScroll(null);
    document.body.removeClass('dr-strip-active');
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
    this.markDuplicates();

    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    const browse = isBrowseView(view) ? view : null;
    const file = !browse && view && view.file instanceof TFile ? view.file : null;

    this.el.empty();
    this.narrow = this.isNarrow();
    this.el.toggleClass('is-narrow', this.narrow);
    // Up whenever there's a page at all — including an empty one, since
    // the strip is also where a closed sidebar comes back from.
    this.el.toggleClass('is-empty', !view);
    if (!view) return;

    this.renderNav(this.el);
    const reading = !!file && this.settings.stripProgress !== false;
    if (file) {
      this.renderNow(this.el, file, view);
      this.renderActions(this.el, file, leaf);
      if (reading) this.el.createDiv({ cls: 'dr-strip-progress' });
    } else {
      this.renderScreen(this.el, view);
    }
    this.watchScroll(reading ? view : null);
  }

  /**
   * How far down the note the page is, as a line along the strip's foot —
   * the way a player's bar shows how far into the song it is. Scrolling
   * is listened to where it happens, inside the note's view.
   */
  watchScroll(view) {
    const host = view && view.containerEl ? view.containerEl : null;
    if (this.scrollHost !== host) {
      if (this.scrollHost) this.scrollHost.removeEventListener('scroll', this.onScroll, true);
      this.scrollHost = host;
      if (host) host.addEventListener('scroll', this.onScroll, true);
    }
    if (!host && this.scrollFrame) {
      window.cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = 0;
    }
    this.measureScroll();
    // A note just opened isn't laid out yet: measured again once it is.
    if (host) window.setTimeout(() => this.measureScroll(), 400);
  }

  measureScroll() {
    if (!this.el) return;
    const host = this.scrollHost;
    // Reading view and the editor each scroll themselves: whichever is showing.
    const scroller = host
      ? Array.from(host.querySelectorAll('.markdown-preview-view, .cm-scroller')).find((el) => el.clientHeight > 0)
      : null;
    const room = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
    this.el.toggleClass('has-progress', room > 8);
    const part = room > 8 ? Math.min(1, Math.max(0, scroller.scrollTop / room)) : 0;
    this.el.style.setProperty('--dr-progress', part.toFixed(4));
  }

  /**
   * Anything that isn't a note: a browse screen, graph view, an empty
   * page. A folder screen gets the folder's menu, so making something
   * in it is a click away.
   */
  renderScreen(strip, view) {
    const browse = isBrowseView(view) ? view : null;
    const now = strip.createDiv({ cls: 'dr-strip-now is-screen' });
    const art = now.createDiv({ cls: 'dr-strip-art is-blank' });
    const icon = browse
      ? 'library'
      : (typeof view.getIcon === 'function' && view.getIcon()) || 'layout';
    setIcon(art.createSpan({ cls: 'dr-card-glyph' }), icon);

    const title =
      (typeof view.getDisplayText === 'function' && view.getDisplayText()) ||
      'Nothing open';
    const text = now.createDiv({ cls: 'dr-strip-text' });
    text.createDiv({ cls: 'dr-strip-title', text: title });
    const folder = browse && browse.mode === 'folder' ? browse.folder() : null;
    text.createDiv({ cls: 'dr-strip-sub', text: this.screenLine(browse, folder) });
    // An album shows its cover, as a note does; other screens their own sign.
    if (folder && !(folder.isRoot && folder.isRoot())) {
      art.empty();
      art.removeClass('is-blank');
      drawFolderArt(this.plugin, art, folder);
    } else if (browse && STRIP_SCREEN_ICONS[browse.mode]) {
      art.empty();
      setIcon(art.createSpan({ cls: 'dr-card-glyph' }), STRIP_SCREEN_ICONS[browse.mode]);
    }
    if (!folder) return;
    const actions = strip.createDiv({ cls: 'dr-strip-actions' });
    const specs = this.contextSpecs('album');
    if (typeof browse.filterMenu === 'function') specs.push({ icon: 'arrow-up-down', label: 'Sort and filter', role: 'sort', run: (evt) => showMenuAt(browse.filterMenu(), evt) });
    specs.push({
      icon: 'ellipsis',
      label: 'More',
      role: 'more',
      run: (evt) => showTargetMenu(this.plugin, evt, folder, { here: true, source: 'design-redux-strip', redraw: () => browse.render() }),
    });
    specs.forEach((spec) => this.stripButton(actions, spec));
  }

  /** Narrow enough that the strip's secondary buttons go into More. Not on a phone, whose strip is its own. */
  isNarrow() {
    return !Platform.isMobile && typeof window !== 'undefined' && window.innerWidth <= STRIP_NARROW;
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
        run: () => {
          const now = actionContext(this.app, action);
          if (now && applies(action, now)) action.run(Object.assign(now, { from: 'strip' }));
        },
      });
    });
    return out;
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

  /** The line under a screen's name: what an album holds and what it is; otherwise the vault. */
  screenLine(browse, folder) {
    const vault = this.app.vault.getName();
    if (!browse) return vault;
    if (browse.mode === 'smart') return 'Smart album';
    if (browse.mode === 'library-check') return 'What to look at';
    if (browse.mode === 'inbox') return 'Notes in no album';
    if (!folder || (folder.isRoot && folder.isRoot())) return vault;
    const n = countFilesIn(folder);
    const structure = typeof AlbumStructure === 'function' ? this.plugin.feature(AlbumStructure) : null;
    const kind = structure ? structure.info(folder).label : '';
    return [n === 1 ? '1 item' : `${n} items`, kind || (folder.parent && !(folder.parent.isRoot && folder.parent.isRoot()) ? folder.parent.name : '')].filter(Boolean).join(' · ');
  }

  renderNav(strip) {
    const nav = strip.createDiv({ cls: 'dr-strip-nav' });

    // Only while the sidebar is closed; styled in and out by body class.
    const toggle = nav.createDiv({ cls: 'clickable-icon dr-strip-btn dr-sidebar-toggle' });
    toggle.setAttribute('aria-label', 'Show sidebar');
    asButton(toggle);
    setIcon(toggle, 'panel-left');
    onActivate(toggle, () => this.app.workspace.leftSplit.expand());

    // The workspace mode on, named; pressed, it's left and the workspace is as it was.
    const modes = typeof WorkspaceModes === 'function' ? this.plugin.feature(WorkspaceModes) : null;
    const mode = modes && modes.enabled ? modes.mode(modes.current()) : null;
    if (mode) {
      const chip = nav.createDiv({ cls: 'dr-strip-mode' });
      asButton(chip, `Leave ${mode.label}, back to how the workspace was`);
      setIcon(chip.createSpan({ cls: 'dr-strip-mode-icon' }), mode.icon);
      chip.createSpan({ text: mode.label });
      onActivate(chip, () => modes.leave());
    }

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
    const cards = file.extension === 'canvas' && view && view.canvas && view.canvas.nodes ? view.canvas.nodes.size : -1;
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

  /** The first note in Up Next, other than this one, while it's on. */
  queuedAfter(file) {
    const upNext = typeof UpNext === 'function' ? this.plugin.feature(UpNext) : null;
    return upNext && upNext.enabled ? upNext.queue.peek(file) : null;
  }

  /** « or »: the note before or after this one — Up Next's first, for ». */
  skipButton(parent, near, dir) {
    const queued = dir === 'next' ? this.queuedAfter(pageFile(this.app)) : null;
    const target = queued || near[dir];
    const word = queued ? 'Up Next' : dir === 'previous' ? 'Previous' : 'Next';
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

    // Properties, More, and what's there only when it matters — footnotes, Up Next — always;
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

    // On a canvas, what can be done to it as a whole.
    if (file.extension === 'canvas') specs.push(...this.contextSpecs('canvas'));

    // The note's footnotes, kept off the page, a press away.
    const footnotes = typeof Footnotes === 'function' ? this.plugin.feature(Footnotes) : null;
    if (footnotes && footnotes.aside && footnotes.countIn(file) > 0) {
      specs.push({ icon: 'file-signature', label: `Footnotes (${footnotes.countIn(file)})`, role: 'footnotes', run: () => footnotes.showView() });
    }

    // What's lined up, while anything is.
    const upNext = typeof UpNext === 'function' ? this.plugin.feature(UpNext) : null;
    const lined = upNext && upNext.enabled ? upNext.queue.files().length : 0;
    if (lined) specs.push({ icon: 'list-ordered', label: `Up Next (${lined})`, role: 'up-next', run: (evt) => upNext.showMenu(evt) });

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
        run: (evt) => {
          const panel = this.plugin.feature(PropertiesPanel);
          if (panel && panel.enabled && leaf) panel.toggleFrom(leaf, evt.currentTarget);
        },
      });
    }

    // What's picked, described beside the page.
    const inspect = this.plugin.manifest && this.app.commands ? `${this.plugin.manifest.id}:open-inspector` : '';
    if (this.settings.inspector && inspect) {
      specs.push({ icon: 'panel-right', label: 'Inspector', role: 'inspector', secondary: true, run: () => this.app.commands.executeCommandById(inspect) });
    }

    const overflow = this.isNarrow() ? specs.filter((spec) => spec.secondary) : [];
    specs.filter((spec) => overflow.indexOf(spec) === -1).forEach((spec) => this.stripButton(actions, spec));

    // The page menu the note's own header had — Find, Replace, Export
    // to PDF, version history — followed by the file's entries, which
    // Obsidian adds as part of it. Hiding the header had taken all of
    // that away. In a narrow window, what the strip had no room for first.
    this.stripButton(actions, {
      icon: 'ellipsis',
      label: 'More',
      role: 'more',
      run: (evt) => {
        const menu = new Menu();
        overflow.forEach((spec) =>
          menu.addItem((item) => {
            item.setTitle(spec.label).setIcon(spec.icon).onClick(() => spec.run(evt));
            if (typeof item.setSection === 'function') item.setSection('action');
          })
        );
        const view = leaf && !leaf.isDeferred ? leaf.view : null;
        if (view && typeof view.onPaneMenu === 'function') {
          view.onPaneMenu(menu, 'more-options');
        } else {
          this.app.workspace.trigger('file-menu', menu, file, 'design-redux-strip', leaf);
        }
        showMenuAt(menu, evt);
      },
    });
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
function stripDetail(app, file, spec) {
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

