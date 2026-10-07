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
        desc: 'A bar along the bottom with the note you\'re in: its cover, « » through its album, and its actions.',
      },
      {
        key: 'stripPlace',
        name: 'Place in album',
        desc: 'Where the note falls in its album, as "3 of 12", under its name on the strip.',
        showIf: 'contextStrip',
      },
      {
        key: 'stripDetail',
        type: 'text',
        name: 'Under the note\'s name',
        desc: 'What the strip shows beside its place in the album: properties, or modified, created or folder, separated by commas — each the note has, in that order. Leave it empty for the first of domain, author, book or status, else its folder; none for nothing.',
        placeholder: 'domain, status',
        fallback: '',
        showIf: 'contextStrip',
        suggest: 'properties',
        suggestExtra: ['modified', 'created', 'folder', 'none'],
      },
      {
        key: 'stripProgress',
        name: 'How far you\'ve read',
        desc: 'A thin line along the foot of the strip, as far across as you are down the note.',
        showIf: 'contextStrip',
      },
    ];
  }

  commands() {
    const step = (dir) => {
      const file = this.pageFile();
      const near = file ? albumNeighbours(this.plugin, file) : null;
      return near && near[dir];
    };
    return [
      {
        id: 'previous-in-album',
        name: 'Previous note in album',
        icon: 'chevrons-left',
        check: () => !!step('previous'),
        run: () => this.skip('previous'),
      },
      {
        id: 'next-in-album',
        name: 'Next note in album',
        icon: 'chevrons-right',
        check: () => !!step('next'),
        run: () => this.skip('next', true),
      },
    ];
  }

  /** The note on the page, if the page is a note. */
  pageFile() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && !(view instanceof BrowseView) && view.file instanceof TFile ? view.file : null;
  }

  /**
   * The note before or after this one in its album, opened in the same
   * page. The strip's » takes Up Next's first before the album's next.
   */
  skip(dir, albumOnly) {
    const file = this.pageFile();
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
    const browse = view instanceof BrowseView ? view : null;
    const file = !browse && view && view.file instanceof TFile ? view.file : null;

    this.el.empty();
    // Up whenever there's a page at all — including an empty one, since
    // the strip is also where a closed sidebar comes back from.
    this.el.toggleClass('is-empty', !view);
    if (!view) return;

    this.renderNav(this.el);
    const reading = !!file && this.settings.stripProgress !== false;
    if (file) {
      this.renderNow(this.el, file);
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
    const browse = view instanceof BrowseView ? view : null;
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
    text.createDiv({ cls: 'dr-strip-sub', text: this.app.vault.getName() });

    const folder = browse && browse.mode === 'folder' ? browse.folder() : null;
    if (!folder) return;
    const actions = strip.createDiv({ cls: 'dr-strip-actions' });
    const more = actions.createDiv({ cls: 'clickable-icon dr-strip-btn' });
    more.setAttribute('aria-label', 'More');
    more.setAttribute('role', 'button');
    more.setAttribute('tabindex', '0');
    setIcon(more, 'ellipsis');
    onActivate(more, (evt) =>
      showTargetMenu(this.plugin, evt, folder, {
        here: true,
        source: 'design-redux-strip',
        redraw: () => browse.render(),
      })
    );
  }

  renderNav(strip) {
    const nav = strip.createDiv({ cls: 'dr-strip-nav' });

    // Only while the sidebar is closed; styled in and out by body class.
    const toggle = nav.createDiv({ cls: 'clickable-icon dr-strip-btn dr-sidebar-toggle' });
    toggle.setAttribute('aria-label', 'Show sidebar');
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('tabindex', '0');
    setIcon(toggle, 'panel-left');
    onActivate(toggle, () => this.app.workspace.leftSplit.expand());

    [
      ['chevron-left', 'Back', 'back'],
      ['chevron-right', 'Forward', 'forward'],
    ].forEach(([icon, label, dir]) => {
      const el = nav.createDiv({ cls: 'clickable-icon dr-strip-btn' });
      el.setAttribute('aria-label', label);
      setIcon(el, icon);
      if (!this.canGo(dir)) {
        el.addClass('is-disabled');
        return;
      }
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      onActivate(el, () => this.go(dir));
    });
  }

  /** The note itself: cover, name, and one property beneath it. */
  renderNow(strip, file) {
    // The middle of the strip, as a player's: back a note through the
    // album, the note itself, and on a note.
    const center = strip.createDiv({ cls: 'dr-strip-center' });
    const near = albumNeighbours(this.plugin, file);
    this.skipButton(center, near, 'previous');
    const now = center.createDiv({ cls: 'dr-strip-now' });
    now.setAttribute('role', 'button');
    now.setAttribute('tabindex', '0');

    const art = now.createDiv({ cls: 'dr-strip-art' });
    drawNoteArt(this.plugin, art, file);
    if (file.extension === 'md') art.dataset.coverNote = file.path;

    const text = now.createDiv({ cls: 'dr-strip-text' });
    text.createDiv({ cls: 'dr-strip-title', text: file.basename });
    const lead = this.leadOf(file);
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
    const queued = dir === 'next' ? this.queuedAfter(this.pageFile()) : null;
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
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    onActivate(el, () => this.skip(dir));
    return el;
  }

  renderActions(strip, file, leaf) {
    const actions = strip.createDiv({ cls: 'dr-strip-actions' });

    const button = (icon, label, onClick, active, role) => {
      const el = actions.createDiv({ cls: 'clickable-icon dr-strip-btn' });
      if (role) el.dataset.action = role;
      el.setAttribute('aria-label', label);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      setIcon(el, icon);
      if (active) el.addClass('is-active');
      onActivate(el, onClick);
    };

    // The last thing the view header carried that the strip didn't, so
    // the header can go entirely in single-area mode.
    if (leaf && !leaf.isDeferred && leaf.view instanceof MarkdownView) {
      const reading = leaf.view.getMode() === 'preview';
      button(
        reading ? 'pencil' : 'book-open',
        reading ? 'Edit' : 'Read',
        () => {
          // The command acts on whatever has focus, so the page is
          // given focus first; otherwise a click here with the sidebar
          // focused would do nothing.
          this.app.workspace.setActiveLeaf(leaf, { focus: true });
          this.app.commands.executeCommandById('markdown:toggle-preview');
          window.setTimeout(() => this.update(), 50);
        },
        false,
        'mode'
      );
    }

    const pinned = this.plugin.pins.has(file);
    button(pinned ? 'pin-off' : 'pin', pinned ? 'Unpin' : 'Pin', () => {
      this.plugin.togglePin(file);
      this.update();
    }, pinned, 'pin');

    // The note's footnotes, kept off the page, a press away.
    const footnotes = typeof Footnotes === 'function' ? this.plugin.feature(Footnotes) : null;
    if (footnotes && footnotes.aside && footnotes.countIn(file) > 0) {
      button('file-signature', `Footnotes (${footnotes.countIn(file)})`, () => footnotes.showView(), false, 'footnotes');
    }

    // What's lined up, while anything is.
    const upNext = typeof UpNext === 'function' ? this.plugin.feature(UpNext) : null;
    const lined = upNext && upNext.enabled ? upNext.queue.files().length : 0;
    if (lined) {
      button('list-ordered', `Up Next (${lined})`, (evt) => upNext.showMenu(evt), false, 'up-next');
    }

    button('info', 'Properties', (evt) => {
      const panel = this.plugin.feature(PropertiesPanel);
      if (panel && panel.enabled && leaf) panel.toggleFrom(leaf, evt.currentTarget);
    }, false, 'properties');

    // The page menu the note's own header had — Find, Replace, Export
    // to PDF, version history — followed by the file's entries, which
    // Obsidian adds as part of it. Hiding the header had taken all of
    // that away.
    button('ellipsis', 'More', (evt) => {
      const menu = new Menu();
      const view = leaf && !leaf.isDeferred ? leaf.view : null;
      if (view && typeof view.onPaneMenu === 'function') {
        view.onPaneMenu(menu, 'more-options');
      } else {
        this.app.workspace.trigger('file-menu', menu, file, 'design-redux-strip', leaf);
      }
      showMenuAt(menu, evt);
    }, false, 'more');
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

