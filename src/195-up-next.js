/* ------------------------------------------------------------------ */
/* Up Next and Shuffle                                                 */
/*                                                                     */
/* Notes go in from their menu — Read next puts one at the front, Add  */
/* to Up Next at the end — and a folder puts in all its notes, in      */
/* album order. The strip's » takes the first; its list button shows   */
/* the rest, to open one or clear them. Shuffle, as a player's does,   */
/* opens a note at random and lines the rest of the album up after it. */
/* ------------------------------------------------------------------ */

/* What a folder queues: notes and canvases, not the images beside them. */
const QUEUED_KINDS = ['md', 'canvas'];

class UpNext extends Feature {
  get queue() {
    return this.plugin.queue;
  }

  settingsSchema() {
    return [
      {
        key: 'upNext',
        name: 'Up Next and Shuffle',
        desc: 'Queue notes from their menus for » to go through first. Shuffle opens an album at random.',
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
        id: 'up-next-clear',
        name: 'Clear Up Next',
        icon: 'list-x',
        check: () => this.enabled && this.queue.paths().length > 0,
        run: () => this.clear(),
      },
      {
        id: 'shuffle-album',
        name: 'Shuffle this album',
        icon: 'shuffle',
        check: () => this.enabled && !!pageFolder(this.app) && this.notesOf(pageFolder(this.app)).length > 0,
        run: () => this.shuffle(pageFolder(this.app)),
      },
    ];
  }

  register() {
    const ws = this.app.workspace;
    const section = (item) => {
      if (typeof item.setSection === 'function') item.setSection('action');
      return item;
    };
    this.plugin.registerEvent(
      ws.on('file-menu', (menu, target) => {
        if (this.enabled) this.addMenuItems(menu, target, section);
      })
    );
    // Several chosen in the file explorer: their notes, in the order chosen.
    this.plugin.registerEvent(
      ws.on('files-menu', (menu, targets) => {
        if (!this.enabled) return;
        const files = [];
        (targets || []).forEach((t) => {
          if (t instanceof TFolder) this.notesOf(t).forEach((f) => files.push(f));
          else if (t instanceof TFile && QUEUED_KINDS.indexOf(t.extension) !== -1) files.push(t);
        });
        if (!files.length) return;
        menu.addItem((item) =>
          section(item).setTitle('Add to Up Next').setIcon('list-end').onClick(() => this.enqueue(files, false, `${files.length} notes`))
        );
      })
    );
    // Kept whether or not it's on, so the queue's right when it comes back.
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.queue.followRename(file, oldPath)));
    this.plugin.registerEvent(this.app.vault.on('delete', (file) => this.queue.followDelete(file)));
  }

  // Every settings save calls these: the strip and pages are redrawn
  // only when it's switched on or off.
  enable() {
    if (this.on) return;
    this.on = true;
    this.refresh();
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    // On unload the strip and pages are going too; nothing to redraw.
    if (!this.plugin.unloading) this.refresh();
  }

  /** The note on the page, if the page is a note. */
  pageFile() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    return view && !(view instanceof BrowseView) && view.file instanceof TFile ? view.file : null;
  }

  /** The strip and album pages, which show the queue and Shuffle. */
  refresh() {
    const strip = this.plugin.feature(ContextStrip);
    if (strip && strip.enabled) strip.update();
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
  }

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
    if (folder) walk(folder);
    return out;
  }

  /** Put notes in the queue, and say so. */
  enqueue(files, next, name) {
    const n = this.queue.add(files, next);
    if (!n) return;
    // One note is named; a folder's are counted.
    const what = n === 1 ? `“${files[0].basename}”` : name ? `${n} notes from ${name}` : `${n} notes`;
    new Notice(next ? `${what} ${n === 1 ? 'is' : 'are'} up next.` : `Added ${what} to Up Next.`);
  }

  /**
   * Read next and Add to Up Next on a note's menu — or, on a note
   * already queued, Remove in place of Add. A folder's menu adds its
   * notes, or shuffles them.
   */
  addMenuItems(menu, target, section) {
    const isFolder = target instanceof TFolder;
    if (!isFolder && !(target instanceof TFile && QUEUED_KINDS.indexOf(target.extension) !== -1)) return;
    if (!isFolder && this.plugin.isFolderNote(target)) return;
    const add = (title, icon, run) => menu.addItem((item) => section(item).setTitle(title).setIcon(icon).onClick(run));
    if (isFolder) {
      const files = this.notesOf(target);
      if (!files.length) return;
      add('Add to Up Next', 'list-end', () => this.enqueue(files, false, target.name));
      add('Shuffle', 'shuffle', () => this.shuffle(target));
      return;
    }
    add('Read next', 'list-start', () => this.enqueue([target], true));
    if (this.queue.has(target)) add('Remove from Up Next', 'list-x', () => this.queue.remove(target));
    else add('Add to Up Next', 'list-end', () => this.enqueue([target], false));
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

  /** Emptied, with an Undo — it may have been a long list. */
  clear() {
    const was = this.queue.paths().slice();
    if (!was.length) return;
    this.queue.clear();
    this.plugin.offerUndo('Cleared Up Next.', () => this.queue.set(was));
  }

  /**
   * One of a folder's notes opened at random, and the rest lined up in
   * Up Next in a random order — in place of what was there, which Undo
   * puts back. Or a list of notes, as an album page has them.
   */
  shuffle(folder, files) {
    const notes = (files || this.notesOf(folder)).filter((f) => f instanceof TFile && QUEUED_KINDS.indexOf(f.extension) !== -1);
    if (!notes.length) return false;
    const order = notes.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    // Not the note already open, if there's anything else to start on.
    const here = this.pageFile();
    if (order.length > 1 && order[0] === here) order.push(order.shift());
    const first = order.shift();
    const was = this.queue.paths().slice();
    this.queue.set(order.map((f) => f.path));
    const leaf = pageLeaf(this.app) || this.app.workspace.getLeaf(false);
    if (leaf) leaf.openFile(first);
    if (order.length) {
      const name = folder ? folder.name : 'the album';
      this.plugin.offerUndo(`Shuffled ${name}: ${order.length} up next.`, () => this.queue.set(was));
    }
    return true;
  }

  /**
   * The strip's list button: the queue as a menu, each a press from
   * being opened, and the way to clear it.
   */
  showMenu(evt) {
    const files = this.queue.files();
    const menu = new Menu();
    files.slice(0, 20).forEach((file) => {
      menu.addItem((item) =>
        item
          .setTitle(file.basename)
          .setIcon(file.extension === 'canvas' ? 'layout-dashboard' : 'file-text')
          .onClick(() => this.open(file))
      );
    });
    if (files.length > 20) {
      menu.addItem((item) => item.setTitle(`and ${files.length - 20} more`).setDisabled(true));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('Clear Up Next').setIcon('list-x').onClick(() => this.clear()));
    showMenuAt(menu, evt);
  }
}

UpNext.settingKey = 'upNext';
