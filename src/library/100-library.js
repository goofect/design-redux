/* ------------------------------------------------------------------ */
/* Library                                                             */
/*                                                                     */
/* A navigation view rather than a file tree: a short list of places    */
/* worth going, then folders you step into one level at a time, with   */
/* a back path across the top. The tree is still in the file explorer  */
/* for when the whole shape matters.                                   */
/* ------------------------------------------------------------------ */

import { ItemView, Menu, Platform, setIcon, TFile, TFolder } from 'obsidian';
import { BUILTIN_SCREENS, LIBRARY_BUILTINS, LIBRARY_VIEW } from '../core/020-constants.js';
import { drawFolderArt, drawNoteArt, fillArt, noteCoverSrc, onContextMenu, pageLeaf, showMenuAt, showTargetMenu } from '../core/030-helpers-art.js';
import { asButton, fullNameOnHover, iconForFile, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { libraryIndex } from '../core/077-library-index.js';
import { BrowseView } from './120-browse-view.js';
import { Library } from './130-browse-filters.js';
import { isClearLook } from '../ui/229-components.js';
import { ChoicePicker, FolderPicker } from '../ui/230-pickers.js';
import { SmartAlbums } from './258-smart-albums.js';

export class LibraryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return LIBRARY_VIEW;
  }

  getDisplayText() {
    return 'Library';
  }

  getIcon() {
    return 'library';
  }

  queueRender() {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      if (this.contentEl && this.contentEl.isConnected) this.render();
    }, 120);
  }

  /** Whether a note's change could change a row: it's listed, or it's a listed folder's note. */
  shows(file) {
    if (!file || !this.contentEl) return false;
    const listed = (path) => !!this.contentEl.querySelector(`.dr-lib-row[data-path="${CSS.escape(path)}"]`);
    if (listed(file.path)) return true;
    return !!file.parent && this.plugin.isFolderNote(file) && listed(file.parent.path);
  }

  async onOpen() {
    this.containerEl.addClass('dr-library');
    this.render();
    fullNameOnHover(this, this.containerEl);

    // Once per burst: a sync or a pull can create hundreds of files.
    this.registerEvent(this.app.vault.on('create', () => this.queueRender()));
    this.registerEvent(this.app.vault.on('delete', () => this.queueRender()));
    this.registerEvent(this.app.vault.on('rename', () => this.queueRender()));
    // A cover changed on something the list shows — a pinned note, or
    // a folder's note — shows here too.
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (this.shows(file)) this.queueRender();
      })
    );

    // markActive, not render: a rebuild between mousedown and mouseup
    // replaces the element under the cursor, so the click never
    // completes and the row appears to need a second press.
    const follow = () => {
      this.markActive();
      this.syncChrome();
    };
    this.registerEvent(this.app.workspace.on('file-open', follow));
    this.registerEvent(this.app.workspace.on('active-leaf-change', follow));
    // Moving between browse screens changes neither file nor leaf.
    this.registerEvent(this.app.workspace.on('layout-change', follow));

    // Pins made in Obsidian's own bookmarks pane, when Pinned is open.
    // The event isn't public API, so it's only listened for if there.
    try {
      const bookmarks = this.plugin.pins.instance();
      if (bookmarks && typeof bookmarks.on === 'function') {
        this.registerEvent(
          bookmarks.on('changed', () => {
            if (this.plugin.settings.pinsExpanded) this.render();
          })
        );
      }
    } catch (err) {
      /* no bookmarks events to follow */
    }

    this.syncChrome();
  }

  async onClose() {
    window.clearTimeout(this.renderTimer);
    const split = this.containerEl.closest('.workspace-split.mod-left-split');
    if (split) split.removeClass('dr-apple-sidebar');
  }

  onResize() {
    // Called when a sidebar tab is shown, which is when the panel shape
    // needs to follow it.
    this.syncChrome();
  }

  /**
   * The panel around the sidebar takes the reference's shape — a
   * floating rounded card with the vault at its foot — only while this
   * view is the one showing, so the file explorer or search in the same
   * sidebar keep Obsidian's own look.
   */
  syncChrome() {
    if (Platform.isMobile) return;
    const split = this.containerEl.closest('.workspace-split.mod-left-split');
    if (!split) return; // docked on the right, or in the main area
    // Whether this is the sidebar's chosen tab. isShown() also says no
    // while the sidebar is collapsed, which took the panel shape off and
    // nothing put it back when the sidebar reopened.
    const leafEl = this.containerEl.closest('.workspace-leaf');
    const chosen = leafEl
      ? window.getComputedStyle(leafEl).display !== 'none'
      : this.containerEl.isShown();
    split.toggleClass('dr-apple-sidebar', chosen);

    // The vault row stands in for the account row, with an initial in
    // place of the avatar.
    const switcher = split.querySelector('.workspace-drawer-vault-switcher');
    const name = this.app.vault.getName().trim();
    if (switcher && name) {
      switcher.setAttribute('data-dr-initial', name.charAt(0).toUpperCase());
    }
    this.showVaultCount();
  }

  /** Under the vault's name at the foot of the panel, how many notes it holds: a fact, read from the index. */
  showVaultCount() {
    if (Platform.isMobile) return;
    const split = this.containerEl.closest('.workspace-split.mod-left-split');
    const switcher = split && split.querySelector('.workspace-drawer-vault-switcher[data-dr-initial]');
    if (!switcher) return;
    const n = libraryIndex(this.plugin).markdown().length;
    const text = n === 1 ? '1 note' : `${n.toLocaleString()} notes`;
    if (switcher.getAttribute('data-dr-count') !== text) switcher.setAttribute('data-dr-count', text);
  }

  render() {
    // How long each part takes, for the timing test: performance marks, and the last drawing's here.
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const times = { items: {} };
    const t0 = now();
    const root = this.contentEl;
    // Drawn aside first, and put in only if it's different: a note it
    // lists changes with every key typed in it, and drawing the same rows
    // again would make their covers flash.
    const fresh = root.ownerDocument.createElement('div');
    this.plugin.settings.librarySections.forEach((section, n) => {
      // Each titled section a heading, and its rows a group named by it, for a screen reader's list of them.
      const headId = section.title ? `dr-lib-head-${n}` : null;
      // A section that folds — More, to begin with — has a heading that opens and closes it.
      const folds = typeof section.folded === 'boolean';
      if (section.title && folds) {
        const head = fresh.createDiv({ cls: `dr-lib-group dr-lib-fold${section.folded ? ' is-folded' : ''}` });
        head.id = headId;
        asButton(head, section.folded ? `Show ${section.title}` : `Fold ${section.title}`);
        head.setAttribute('aria-expanded', String(!section.folded));
        head.createSpan({ text: section.title });
        setIcon(head.createSpan({ cls: 'dr-lib-fold-icon' }), section.folded ? 'chevron-right' : 'chevron-down');
        onActivate(head, () => {
          section.folded = !section.folded;
          this.plugin.saveData(this.plugin.settings);
          this.render();
        });
        if (section.folded) return;
      } else if (section.title) {
        const head = fresh.createDiv({ cls: 'dr-lib-group', text: section.title });
        head.id = headId;
        head.setAttribute('role', 'heading');
        head.setAttribute('aria-level', '2');
      }
      const list = fresh.createDiv({ cls: 'dr-lib-list' });
      list.setAttribute('role', 'group');
      if (headId) list.setAttribute('aria-labelledby', headId);
      roveFocus(list, '.dr-lib-row');
      (section.items || []).forEach((item) => {
        const t = now();
        this.renderItem(list, item);
        const key = item.kind === 'builtin' ? item.id : item.kind;
        times.items[key] = (times.items[key] || 0) + now() - t;
      });
    });
    const t1 = now();
    // What's marked, still arriving, or given its full name under the
    // pointer isn't a difference in what's listed.
    const norm = (html) =>
      html
        .replace(/ is-active/g, '')
        .replace(/ aria-current="page"/g, '')
        .replace(/ tabindex="-?\d+"/g, '')
        .replace(/ ?is-arriving/g, '')
        .replace(/ class=""/g, '')
        .replace(/ title="[^"]*"/g, '')
        .replace(/ data-dr-full-name=""/g, '');
    this.containerEl.dataset.drDensity = this.plugin.settings.gridDensity || 'standard';
    if (norm(fresh.innerHTML) !== norm(root.innerHTML)) {
      root.empty();
      while (fresh.firstChild) root.appendChild(fresh.firstChild);
    }
    const t2 = now();
    this.markActive();
    this.showVaultCount();
    const t3 = now();
    Object.assign(times, { build: t1 - t0, compare: t2 - t1, mark: t3 - t2 });
    this.lastTimes = times;
  }

  /* -- the configured list ---------------------------------------- */

  renderItem(list, item) {
    if (item.kind === 'property') {
      this.row(list, {
        icon: 'tag',
        label: this.plugin.propertyLabel(item.key),
        screen: 'properties',
        property: item.key,
        onClick: () => this.browseMode({ mode: 'properties', property: item.key }),
      });
      return;
    }

    if (item.kind === 'builtin') {
      // "All notes" became the Notes screen; a saved layout still
      // naming it opens that instead of losing its row.
      const id = item.id === 'all' ? 'notes' : item.id;
      const spec = LIBRARY_BUILTINS[id];
      if (!spec) return;
      // A tool whose feature is off has nothing to show.
      if (spec.needs && !this.plugin.settings[spec.needs]) return;
      if (id === 'bookmarks') {
        this.renderPins(list, spec);
        return;
      }
      if (id === 'smart') {
        const smart = this.plugin.feature(SmartAlbums);
        if (smart) smart.renderRows(this, list);
        return;
      }
      this.row(list, {
        icon: spec.icon,
        label: spec.label,
        screen: BUILTIN_SCREENS[id] || null,
        onClick: () => this.runBuiltin(id),
      });
      return;
    }

    const target = this.app.vault.getAbstractFileByPath(item.path);
    if (!target) return; // renamed or deleted since it was added
    this.targetRow(list, target, 0);
  }

  /** A folder or file, with its artwork and its menu. */
  targetRow(list, target, depth, pinned = false, arrange = null) {
    const menu = (evt, open) =>
      showTargetMenu(this.plugin, evt, target, {
        open: open,
        source: LIBRARY_VIEW,
        redraw: () => this.render(),
        arrange: arrange,
      });

    if (target instanceof TFolder) {
      const open = () => this.browseMode({ mode: 'folder', path: target.path });
      const n = libraryIndex(this.plugin).count(target);
      const row = this.row(list, {
        depth: depth,
        icon: 'folder',
        art: this.plugin.folderCoverSrc(target),
        // Pinned, its own artwork — a cover, or one made for it — and nothing beneath its name.
        draw: pinned ? (el) => drawFolderArt(this.plugin, el, target) : null,
        sub: null,
        label: target.name,
        path: target.path,
        onClick: open,
        onMenu: (evt) => menu(evt, open),
      });
      // The Apple look: how many notes it holds, muted at the end.
      if (!pinned && isClearLook() && n) row.createSpan({ cls: 'dr-lib-count', text: String(n) });
      return row;
    }
    return this.row(list, {
      depth: depth,
      icon: iconForFile(target),
      art: noteCoverSrc(this.plugin, target),
      draw: pinned ? (el) => drawNoteArt(this.plugin, el, target) : null,
      sub: pinned && target.parent && !(target.parent.isRoot && target.parent.isRoot()) ? target.parent.name : null,
      label: target.basename,
      path: target.path,
      onClick: () => this.openFile(target),
      onMenu: (evt) => menu(evt, null),
    });
  }

  /**
   * Pinned as a group rather than a destination: clicking it anywhere
   * opens or closes its contents in place, the way Pins does in the app
   * this borrows from. The Pinned screen is still there, from Home's
   * Pinned heading. Not highlighted as where you are, since it isn't a
   * place you go.
   */
  renderPins(list, spec) {
    const open = !!this.plugin.settings.pinsExpanded;
    const toggle = () => this.togglePins();
    this.row(list, {
      icon: spec.icon,
      label: spec.label,
      group: 'pins',
      toggles: true,
      onClick: toggle,
      disclosure: { open: open, toggle: toggle },
      onMenu: (evt) => this.pinsMenu(evt),
    });
    if (!open) return;

    const pins = this.plugin.pins;
    const items = pins.all();
    const missing = typeof pins.missing === 'function' ? pins.missing() : [];
    if (!items.length && !missing.length) {
      list.createDiv({ cls: 'dr-lib-empty', text: 'Nothing pinned yet' });
      return;
    }
    const paths = items.map((t) => t.path);
    items.forEach((target, at) => {
      const arrange = this.pinMoves(paths, at);
      const row = this.targetRow(list, target, 1, true, arrange);
      // Alt+Up and Alt+Down move a pin a place, as dragging one would on the Pinned screen.
      row.addEventListener('keydown', (evt) => {
        if (!evt.altKey || evt.metaKey || evt.ctrlKey || (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown')) return;
        evt.preventDefault();
        const run = evt.key === 'ArrowUp' ? arrange.earlier : arrange.later;
        if (run) run();
      });
    });
    missing.forEach((pin) => this.missingRow(list, pin));
  }

  /**
   * A pin a place earlier or later, where it isn't already at that end;
   * the row keeps the focus, so it can be moved again straight away.
   */
  pinMoves(paths, at) {
    const path = paths[at];
    const move = (before) => () => {
      this.plugin.pins.move(path, before, paths);
      this.plugin.refreshBrowse();
      this.render();
      const row = Array.from(this.contentEl.querySelectorAll('.dr-lib-row.is-pin')).find((el) => el.dataset.path === path);
      if (row) row.focus();
    };
    return {
      earlier: at > 0 ? move(paths[at - 1]) : null,
      later: at < paths.length - 1 ? move(at + 2 < paths.length ? paths[at + 2] : null) : null,
    };
  }

  /** The Pinned row's own menu: its covers small, a row each, or large, the way an album's are. */
  /** A pin whose folder or note has gone: greyed, saying so — or where it may be now — and clicked, what can be done. */
  missingRow(list, pin) {
    const likely = this.plugin.pins.likely(pin);
    const parent = likely && likely.parent;
    const where = parent && !(parent.isRoot && parent.isRoot()) ? parent.name : this.app.vault.getName();
    const menu = (evt) => this.missingMenu(evt, pin, likely);
    const row = this.row(list, {
      depth: 1,
      label: pin.name,
      sub: likely ? `Found in ${where}?` : 'Not found',
      draw: (el) => {
        el.addClass('is-blank');
        setIcon(el, pin.type === 'folder' ? 'folder-x' : 'file-x');
      },
      toggles: true,
      onClick: menu,
      onMenu: menu,
    });
    row.addClass('is-missing');
    row.dataset.missing = pin.path;
    row.setAttribute('aria-label', `${pin.name}: ${likely ? `found in ${where}?` : 'not found'}. Choose what to do with this pin`);
  }

  missingMenu(evt, pin, likely) {
    const pins = this.plugin.pins;
    const done = (ok) => ok && this.render();
    const menu = new Menu();
    if (likely) {
      menu.addItem((i) =>
        i
          .setSection('action')
          .setTitle(`Pin ${likely.path}`)
          .setIcon('pin')
          .onClick(() => done(pins.repoint(pin, likely)))
      );
    }
    menu.addItem((i) =>
      i
        .setSection('action')
        .setTitle(pin.type === 'folder' ? 'Find the folder…' : 'Find the note…')
        .setIcon('search')
        .onClick(() => this.findMissing(pin))
    );
    menu.addItem((i) =>
      i
        .setSection('danger')
        .setTitle('Remove pin')
        .setIcon('pin-off')
        .onClick(() => done(pins.forget(pin)))
    );
    showMenuAt(menu, evt);
  }

  /** The pin pointed at a folder or note chosen by name. */
  findMissing(pin) {
    const pins = this.plugin.pins;
    const go = (target) => target && pins.repoint(pin, target) && this.render();
    if (pin.type === 'folder') {
      new FolderPicker(this.app, go, { placeholder: `Where is ${pin.name} now?` }).open();
      return;
    }
    const items = this.app.vault.getFiles().map((file) => ({ label: file.path, file }));
    new ChoicePicker(this.app, `Where is ${pin.name} now?`, items, (item) => go(item.file)).open();
  }

  pinsMenu(evt) {
    const settings = this.plugin.settings;
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setSection('action')
        .setTitle('Large covers')
        .setIcon('image')
        .setChecked(!!settings.pinsLarge)
        .onClick(() => {
          settings.pinsLarge = !settings.pinsLarge;
          this.plugin.saveData(settings);
          this.render();
        })
    );
    showMenuAt(menu, evt);
  }

  togglePins() {
    const settings = this.plugin.settings;
    settings.pinsExpanded = !settings.pinsExpanded;
    // saveData, not saveSettings: this is a view preference, and a full
    // settings save would re-run every feature.
    this.plugin.saveData(settings);

    const hadFocus = this.contentEl.contains(document.activeElement);
    this.render();
    if (!hadFocus) return;
    const row = this.contentEl.querySelector('.dr-lib-row[data-group="pins"]');
    if (row) row.focus();
  }

  runBuiltin(id) {
    // Everything the sidebar points at opens in the main area, so the
    // sidebar is only a list of places and never a place of its own.
    if (BUILTIN_SCREENS[id]) {
      this.browseMode({ mode: BUILTIN_SCREENS[id] });
      return;
    }
    if (id === 'graph') this.app.commands.executeCommandById('graph:open');
    if (id === 'random') this.app.commands.executeCommandById('random-note:open');
    if (id === 'settings') this.plugin.openSettingsAt();
  }

  browseMode(state) {
    const library = this.plugin.feature(Library);
    return library ? library.browseMode(state) : null;
  }

  /* -- rows ------------------------------------------------------- */

  /**
   * One row. Every row has a disclosure gutter left of its icon, empty
   * unless there's something to open out, so all the icons line up.
   *
   * spec: { icon, art?, label, onClick, onMenu?, path?, screen?,
   *         property?, group?, depth?, disclosure?: { open, toggle },
   *         toggles? } — toggles marks a row whose click opens or closes
   *         it rather than going somewhere.
   */
  row(parentEl, spec) {
    const el = parentEl.createDiv({ cls: 'dr-lib-row' });
    if (spec.depth) el.addClass('is-nested');
    if (spec.draw) {
      el.addClass('is-pin');
      if (this.plugin.settings.pinsLarge) el.addClass('is-large');
    }
    if (spec.path) el.dataset.path = spec.path;
    if (spec.screen) el.dataset.screen = spec.screen;
    if (spec.property) el.dataset.property = spec.property;
    if (spec.group) el.dataset.group = spec.group;
    asButton(el);

    const gutter = el.createSpan({ cls: 'dr-lib-disclosure' });
    if (spec.disclosure) {
      const { open, toggle } = spec.disclosure;
      gutter.addClass('is-expandable');
      if (open) gutter.addClass('is-open');
      gutter.setAttribute('aria-label', open ? 'Collapse' : 'Expand');
      el.setAttribute('aria-expanded', String(open));
      setIcon(gutter, 'chevron-right');
      gutter.addEventListener('click', (evt) => {
        evt.stopPropagation();
        toggle();
      });
      // Right opens and left closes, as a disclosure does elsewhere.
      el.addEventListener('keydown', (evt) => {
        if ((evt.key === 'ArrowRight' && !open) || (evt.key === 'ArrowLeft' && open)) {
          evt.preventDefault();
          toggle();
        }
      });
    }

    const icon = el.createSpan({ cls: 'dr-lib-icon' });
    if (spec.draw) {
      icon.addClass('has-art');
      spec.draw(icon);
    } else if (spec.art) {
      icon.addClass('has-art');
      fillArt(icon, spec.art, spec.icon);
    } else {
      setIcon(icon, spec.icon);
    }

    if (spec.sub) {
      const text = el.createSpan({ cls: 'dr-lib-text' });
      text.createSpan({ cls: 'dr-lib-label', text: spec.label });
      text.createSpan({ cls: 'dr-lib-sub', text: spec.sub });
    } else el.createSpan({ cls: 'dr-lib-label', text: spec.label });
    onActivate(el, (evt) => {
      spec.onClick(evt);
      // On a phone the library is a drawer over the page, so it gets
      // out of the way of what was just opened — but not of a group
      // being opened, whose contents you're about to choose from.
      if (Platform.isPhone && !spec.toggles) this.closeDrawer();
    });
    if (spec.onMenu) onContextMenu(el, (evt) => spec.onMenu(evt));
    return el;
  }

  closeDrawer() {
    const split = this.app.workspace.leftSplit;
    if (split && typeof split.collapse === 'function') split.collapse();
  }

  /** Exactly one row marks where you are, as the reference does. */
  markActive() {
    const rows = Array.from(this.contentEl.querySelectorAll('.dr-lib-row'));
    rows.forEach((el) => {
      el.removeClass('is-active');
      el.removeAttribute('aria-current');
    });
    const here = this.activeRow(rows);
    if (here) {
      here.addClass('is-active');
      here.setAttribute('aria-current', 'page');
    }
  }

  /**
   * A browse screen marks its own entry, a folder its row. A note marks
   * its own row if it has one, and otherwise the folder it sits in, so
   * reading something still shows which part of the library it's from.
   */
  activeRow(rows) {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    const byPath = (p) => (p ? rows.find((el) => el.dataset.path === p) : null);

    if (view instanceof BrowseView) {
      if (view.mode === 'folder') return byPath(view.path) || null;
      const screen = view.mode === 'property' ? 'properties' : view.mode;
      const exact =
        view.property &&
        rows.find(
          (el) => el.dataset.screen === screen && el.dataset.property === view.property
        );
      return (
        exact ||
        rows.find((el) => el.dataset.screen === screen && !el.dataset.property) ||
        rows.find((el) => el.dataset.screen === screen) ||
        null
      );
    }

    const file = view && view.file instanceof TFile ? view.file : null;
    if (!file) return null;
    return byPath(file.path) || (file.parent ? byPath(file.parent.path) : null);
  }

  openFile(file) {
    this.app.workspace.getLeaf(false).openFile(file);
  }

  /* -- data ------------------------------------------------------- */

}

