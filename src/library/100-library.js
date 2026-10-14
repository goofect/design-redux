/* ------------------------------------------------------------------ */
/* Library                                                             */
/*                                                                     */
/* A navigation view rather than a file tree: a short list of places    */
/* worth going, then folders you step into one level at a time, with   */
/* a back path across the top. The tree is still in the file explorer  */
/* for when the whole shape matters.                                   */
/* ------------------------------------------------------------------ */

import { ItemView, Platform, setIcon, TFile, TFolder } from 'obsidian';
import { BUILTIN_SCREENS, LIBRARY_BUILTINS, LIBRARY_VIEW } from '../core/020-constants.js';
import { fillArt, noteCoverSrc, onContextMenu, pageLeaf, showTargetMenu } from '../core/030-helpers-art.js';
import { asButton, fullNameOnHover, iconForFile, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { BrowseView } from './120-browse-view.js';
import { Library } from './130-browse-filters.js';
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
  }

  render() {
    const root = this.contentEl;
    // Drawn aside first, and put in only if it's different: a note it
    // lists changes with every key typed in it, and drawing the same rows
    // again would make their covers flash.
    const fresh = root.ownerDocument.createElement('div');
    this.plugin.settings.librarySections.forEach((section) => {
      // A section that folds — More, to begin with — has a heading that opens and closes it.
      const folds = typeof section.folded === 'boolean';
      if (section.title && folds) {
        const head = fresh.createDiv({ cls: `dr-lib-group dr-lib-fold${section.folded ? ' is-folded' : ''}` });
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
        fresh.createDiv({ cls: 'dr-lib-group', text: section.title });
      }
      const list = fresh.createDiv({ cls: 'dr-lib-list' });
      roveFocus(list, '.dr-lib-row');
      (section.items || []).forEach((item) => this.renderItem(list, item));
    });
    // What's marked, still arriving, or given its full name under the
    // pointer isn't a difference in what's listed.
    const norm = (html) =>
      html
        .replace(/ is-active/g, '')
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
    this.markActive();
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
  targetRow(list, target, depth) {
    const menu = (evt, open) =>
      showTargetMenu(this.plugin, evt, target, {
        open: open,
        source: LIBRARY_VIEW,
        redraw: () => this.render(),
      });

    if (target instanceof TFolder) {
      const open = () => this.browseMode({ mode: 'folder', path: target.path });
      this.row(list, {
        depth: depth,
        icon: 'folder',
        art: this.plugin.folderCoverSrc(target),
        label: target.name,
        path: target.path,
        onClick: open,
        onMenu: (evt) => menu(evt, open),
      });
      return;
    }
    this.row(list, {
      depth: depth,
      icon: iconForFile(target),
      art: noteCoverSrc(this.plugin, target),
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
    });
    if (!open) return;

    const pins = this.plugin.pins;
    const items = pins.all();
    if (!items.length) {
      list.createDiv({ cls: 'dr-lib-empty', text: 'Nothing pinned yet' });
      return;
    }
    items.forEach((target) => this.targetRow(list, target, 1));
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
    if (spec.art) {
      icon.addClass('has-art');
      fillArt(icon, spec.art, spec.icon);
    } else {
      setIcon(icon, spec.icon);
    }

    el.createSpan({ cls: 'dr-lib-label', text: spec.label });
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
    rows.forEach((el) => el.removeClass('is-active'));
    const here = this.activeRow(rows);
    if (here) here.addClass('is-active');
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

