/* ------------------------------------------------------------------ */
/* Up Next: the queue's menu entries, commands, and list               */
/*                                                                     */
/* Notes go in from their menu — Read next puts one at the front, Add  */
/* to Up Next at the end — and a folder's put in all its notes, in     */
/* album order. The strip's » takes the first; its list button opens   */
/* the queue above it, to put in order, take from, or clear.           */
/* ------------------------------------------------------------------ */

/* What a folder queues: notes and canvases, not the images beside them. */
const QUEUED_KINDS = ['md', 'canvas'];

class UpNext extends Feature {
  constructor(plugin) {
    super(plugin);
    this.panel = null;
  }

  get queue() {
    return this.plugin.queue;
  }

  settingsSchema() {
    return [
      {
        key: 'upNext',
        name: 'Up Next',
        desc: 'A queue of notes to read next. Add to it from a note or folder\'s menu; the strip\'s » goes through it before the rest of the album, and its list button shows it.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'up-next-open',
        name: 'Open the next note in Up Next',
        icon: 'list-start',
        check: () => this.enabled && !!this.queue.peek(this.pageFile()),
        run: () => this.openNext(),
      },
      {
        id: 'up-next-add',
        name: 'Add this note to Up Next',
        icon: 'list-end',
        check: () => this.enabled && !!this.pageFile(),
        run: () => this.enqueue([this.pageFile()], false),
      },
      {
        id: 'up-next-show',
        name: 'Show Up Next',
        icon: 'list-ordered',
        check: () => this.enabled,
        run: () => this.toggle(document.querySelector('.dr-strip-queue')),
      },
    ];
  }

  enable() {
    this.refresh();
  }

  disable() {
    this.close();
    // On unload the strip and pages are going too; nothing to redraw.
    if (!this.plugin.unloading) this.refresh();
  }

  /** The note on the page, if the page is a note. */
  pageFile() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && !(view instanceof BrowseView) && view.file instanceof TFile ? view.file : null;
  }

  /** Everything showing the queue, brought up to date. */
  refresh() {
    const strip = this.plugin.feature(ContextStrip);
    if (strip && strip.enabled) strip.update();
    if (this.app.workspace && typeof this.app.workspace.getLeavesOfType === 'function') {
      liveViews(this.app, BROWSE_VIEW, BrowseView)
        .filter((v) => v.mode === 'home')
        .forEach((v) => v.queueRender());
    }
    if (this.isOpen()) this.renderPanel();
  }

  /* -- in and out ---------------------------------------------------- */

  /** A folder's notes in the order its album lists them, discs and all. */
  notesOf(folder) {
    const out = [];
    const sort = this.settings.defaultSort || 'name';
    const walk = (f) => {
      const files = (f.children || []).filter(
        (c) => c instanceof TFile && QUEUED_KINDS.indexOf(c.extension) !== -1 && !this.plugin.isFolderNote(c)
      );
      this.plugin.orders.arrangeAlbum(f, files, (list) => sortByOrder(list, sort)).forEach((c) => out.push(c));
      (f.children || [])
        .filter((c) => c instanceof TFolder)
        .sort((a, b) => byName(a.name, b.name))
        .forEach(walk);
    };
    walk(folder);
    return out;
  }

  /** Put notes in the queue, and say so. */
  enqueue(files, next, name) {
    const n = this.queue.add(files, next);
    if (!n) return;
    // One note is named; a folder's are counted.
    const what = n === 1 ? `“${files[0].basename}”` : `${n} notes from ${name}`;
    new Notice(next ? `${what} ${n === 1 ? 'is' : 'are'} up next.` : `Added ${what} to Up Next.`);
  }

  /**
   * Read next and Add to Up Next on a note or folder's menu — or, on a
   * note already queued, Remove in place of Add. Flat, as a player's
   * Play Next and Play Last are.
   */
  addMenuItems(menu, target, sectioned) {
    const isFolder = target instanceof TFolder;
    const files = isFolder ? this.notesOf(target) : [target];
    if (!files.length) return;
    const name = isFolder ? target.name : target.basename;
    const add = (title, icon, run) =>
      menu.addItem((item) => sectioned(item, 'action').setTitle(title).setIcon(icon).onClick(run));
    add('Read next', 'list-start', () => this.enqueue(files, true, name));
    if (!isFolder && this.queue.has(target)) {
      add('Remove from Up Next', 'list-x', () => this.queue.remove(target));
    } else {
      add('Add to Up Next', 'list-end', () => this.enqueue(files, false, name));
    }
  }

  /** The first queued note, opened in the page. */
  openNext() {
    const target = this.queue.peek(this.pageFile());
    if (!target) return false;
    this.open(target);
    return true;
  }

  /** Open a queued note: reading it takes it off the queue. */
  open(file, newTab) {
    this.queue.remove(file);
    const leaf = newTab ? this.app.workspace.getLeaf(true) : pageLeaf(this.app) || this.app.workspace.getLeaf(false);
    if (leaf) leaf.openFile(file);
  }

  /* -- the list ------------------------------------------------------ */

  isOpen() {
    return !!(this.panel && this.panel.isConnected);
  }

  toggle(anchor) {
    if (this.isOpen()) this.close();
    else this.show(anchor);
  }

  show(anchor) {
    this.close();
    const panel = document.body.createDiv({ cls: 'dr-queue' });
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Up Next');
    panel.setAttribute('tabindex', '-1');
    this.panel = panel;
    this.anchor = anchor || null;
    this.renderPanel();
    this.place();

    // A press anywhere else closes it; its own button toggles it instead.
    this.onDown = (evt) => {
      const t = evt.target;
      if (panel.contains(t)) return;
      if (t && typeof t.closest === 'function' && t.closest('.dr-strip-queue, .menu')) return;
      this.close();
    };
    this.onKey = (evt) => {
      if (evt.key !== 'Escape' || !this.isOpen()) return;
      if (document.querySelector('.menu')) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.close(true);
    };
    this.onResize = () => this.place();
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);

    const first = panel.querySelector('.dr-queue-row');
    (first || panel).focus();
    this.refreshStrip();
  }

  close(refocus) {
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.refreshStrip();
    if (refocus) {
      const button = document.querySelector('.dr-strip-queue');
      if (button) button.focus();
    }
  }

  refreshStrip() {
    const strip = this.plugin.feature(ContextStrip);
    if (strip && strip.enabled) strip.update();
  }

  /**
   * Just above the strip, its right edge under the button that opened
   * it — the way Up Next opens from a player's corner. On a phone it
   * spans the screen, as the strip does.
   */
  place() {
    const panel = this.panel;
    if (!panel) return;
    const strip = document.querySelector('.dr-strip:not(.is-empty)');
    const box = strip ? strip.getBoundingClientRect() : null;
    const bottom = box && box.height ? Math.round(window.innerHeight - box.top + 10) : 24;
    panel.style.bottom = `${bottom}px`;
    if (Platform.isPhone) return;
    const anchor = this.anchor && this.anchor.isConnected ? this.anchor : document.querySelector('.dr-strip-queue');
    const at = anchor ? anchor.getBoundingClientRect() : null;
    const width = panel.offsetWidth || 360;
    const right = at && at.width ? at.right + 16 : window.innerWidth - 24;
    const left = Math.max(12, Math.min(right - width, window.innerWidth - width - 12));
    panel.style.left = `${Math.round(left)}px`;
  }

  renderPanel() {
    const panel = this.panel;
    if (!panel) return;
    const had = document.activeElement && panel.contains(document.activeElement)
      ? document.activeElement.closest('[data-path]')
      : null;
    const hadPath = had ? had.dataset.path : null;
    panel.empty();

    const files = this.queue.files();
    const head = panel.createDiv({ cls: 'dr-queue-head' });
    head.createDiv({ cls: 'dr-queue-title', text: 'Up Next' });
    if (files.length) {
      head.createDiv({
        cls: 'dr-queue-count',
        text: files.length === 1 ? '1 note' : `${files.length} notes`,
      });
      const clear = head.createDiv({ cls: 'dr-queue-clear', text: 'Clear' });
      clear.setAttribute('role', 'button');
      clear.setAttribute('tabindex', '0');
      onActivate(clear, () => this.queue.clear());
    }

    const list = panel.createDiv({ cls: 'dr-queue-list' });
    roveFocus(list, '.dr-queue-row');
    if (!files.length) {
      const empty = list.createDiv({ cls: 'dr-queue-empty' });
      empty.createDiv({ cls: 'dr-queue-empty-title', text: 'Nothing queued' });
      empty.createDiv({
        cls: 'dr-queue-empty-hint',
        text: 'Choose Read next or Add to Up Next on a note or folder\'s menu.',
      });
    }
    files.forEach((file) => this.row(list, file, false));

    // With nothing queued, » goes on through the album: say where.
    const current = this.pageFile();
    if (!files.length && current && current.parent) {
      const sequence = albumSequence(this.plugin, current);
      const at = sequence.indexOf(current);
      const then = at === -1 ? [] : sequence.slice(at + 1, at + 4);
      if (then.length) {
        const where = current.parent.isRoot && current.parent.isRoot() ? this.app.vault.getName() : current.parent.name;
        panel.createDiv({ cls: 'dr-queue-section', text: `Next in ${where}` });
        const more = panel.createDiv({ cls: 'dr-queue-list is-album' });
        roveFocus(more, '.dr-queue-row');
        then.forEach((file) => this.row(more, file, true));
      }
    }

    if (hadPath) {
      const again = panel.querySelector(`.dr-queue-row[data-path="${CSS.escape(hadPath)}"]`);
      if (again) again.focus();
    }
  }

  /** One note in the list: its cover, name and where it lives. */
  row(list, file, fromAlbum) {
    const row = list.createDiv({ cls: 'dr-queue-row' });
    row.dataset.path = file.path;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    if (!fromAlbum) {
      const grip = row.createDiv({ cls: 'dr-queue-grip' });
      grip.setAttribute('aria-hidden', 'true');
      setIcon(grip, 'grip-vertical');
      this.dragRow(row, grip, list);
    }

    const art = row.createDiv({ cls: 'dr-queue-art' });
    fillArt(
      art,
      file.extension === 'md' ? resolveCover(this.app, file, this.settings.coverProperty) : null,
      iconForFile(file),
      file.extension === 'md' ? coverGen(this.settings, file.basename, file.path) : null
    );

    const text = row.createDiv({ cls: 'dr-queue-text' });
    text.createDiv({ cls: 'dr-queue-name', text: file.basename });
    const where = file.parent && !(file.parent.isRoot && file.parent.isRoot()) ? file.parent.name : '';
    const length = this.plugin.lengths ? this.plugin.lengths.label(file, 'time') : '';
    const sub = [where, length].filter(Boolean).join('  ·  ');
    if (sub) text.createDiv({ cls: 'dr-queue-sub', text: sub });

    if (!fromAlbum) {
      row.setAttribute('aria-label', `${file.basename} — Alt+↑ and Alt+↓ move it`);
      const remove = row.createDiv({ cls: 'clickable-icon dr-queue-remove' });
      remove.setAttribute('role', 'button');
      remove.setAttribute('tabindex', '0');
      remove.setAttribute('aria-label', 'Remove from Up Next');
      setIcon(remove, 'x');
      onActivate(remove, (evt) => {
        evt.stopPropagation();
        this.queue.remove(file);
      });
      row.addEventListener('keydown', (evt) => {
        if (!evt.altKey || (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown')) return;
        evt.preventDefault();
        const paths = this.queue.paths();
        const at = paths.indexOf(file.path);
        if (evt.key === 'ArrowUp' && at > 0) this.queue.move(file.path, paths[at - 1]);
        if (evt.key === 'ArrowDown' && at !== -1 && at < paths.length - 1) {
          this.queue.move(file.path, paths[at + 2] === undefined ? null : paths[at + 2]);
        }
      });
    }

    onActivate(row, (evt) => {
      const newTab = !!(evt && (evt.ctrlKey || evt.metaKey));
      this.close();
      if (fromAlbum) {
        const leaf = newTab ? this.app.workspace.getLeaf(true) : pageLeaf(this.app);
        if (leaf) leaf.openFile(file);
      } else {
        this.open(file, newTab);
      }
    });
    onContextMenu(row, (evt) => showTargetMenu(this.plugin, evt, file, { source: 'design-redux-up-next' }));
  }

  /**
   * Drag a row by its grip into another place in the queue. Pointer
   * events, so a finger works as well as a mouse; Escape puts it back.
   */
  dragRow(row, grip, list) {
    grip.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      down.preventDefault();
      down.stopPropagation();
      const startY = down.clientY;
      const before = Array.from(list.children);
      let dragging = false;

      const place = (y) => {
        const others = Array.from(list.querySelectorAll('.dr-queue-row')).filter((el) => el !== row);
        const next = others.find((el) => {
          const box = el.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        if (next) {
          if (row.nextElementSibling !== next) list.insertBefore(row, next);
        } else if (list.lastElementChild !== row) {
          list.appendChild(row);
        }
      };
      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4) return;
          dragging = true;
          row.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        place(evt.clientY);
      };
      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        if (!dragging) return;
        row.removeClass('is-dragging');
        list.removeClass('is-sorting');
        if (!keep) {
          before.forEach((el) => list.appendChild(el));
          return;
        }
        const order = Array.from(list.querySelectorAll('.dr-queue-row')).map((el) => el.dataset.path);
        const others = this.queue.paths().filter((p) => order.indexOf(p) === -1);
        this.queue.set(order.concat(others));
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }
}

UpNext.settingKey = 'upNext';
