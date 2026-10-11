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
  constructor(plugin) {
    super(plugin);
    // Told of every change to the queue, to redraw what shows it; the two
    // live and go with the plugin.
    if (plugin.queue) plugin.queue.onChange(() => this.refresh());
  }

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

  /** What can be lined up: the note open or chosen, an album's notes; and the queue itself. */
  actions() {
    // A file that can be queued: a note or another kind it reads, not the note standing for a folder.
    const queueable = (ctx) => this.enabled && QUEUED_KINDS.indexOf(ctx.file.extension) !== -1 && !this.plugin.isFolderNote(ctx.file);
    const notes = (ctx) => (this.enabled ? this.notesOf(ctx.folder) : []);
    return [
      { id: 'up-next-open', name: 'Open the next note in Up Next', icon: 'list-start', when: () => this.enabled && !!this.queue.peek(pageFile(this.app)), run: () => this.openNext() },
      { id: 'up-next-read-next', name: 'Read next', icon: 'list-start', on: 'file', palette: false, when: queueable, run: (ctx) => this.enqueue([ctx.file], true) },
      { id: 'up-next-add', name: 'Add this note to Up Next', menu: 'Add to Up Next', icon: 'list-end', on: 'file', when: (ctx) => queueable(ctx) && !this.queue.has(ctx.file), run: (ctx) => this.enqueue([ctx.file], false) },
      { id: 'up-next-remove', name: 'Remove from Up Next', icon: 'list-x', on: 'file', palette: false, when: (ctx) => queueable(ctx) && this.queue.has(ctx.file), run: (ctx) => this.queue.remove(ctx.file) },
      { id: 'up-next-clear', name: 'Clear Up Next', icon: 'list-x', when: () => this.enabled && this.queue.paths().length > 0, run: () => this.clear() },
      { id: 'up-next-add-album', name: 'Add to Up Next', icon: 'list-end', on: 'album', palette: false, when: (ctx) => notes(ctx).length > 0, run: (ctx) => this.enqueue(notes(ctx), false, ctx.folder.name) },
      { id: 'shuffle-album', name: 'Shuffle this album', menu: 'Shuffle', icon: 'shuffle', on: 'album', when: (ctx) => notes(ctx).length > 0, run: (ctx) => this.shuffle(ctx.folder) },
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
    if (target instanceof TFolder) addActionEntries(menu, actionsOn(this.actions(), 'album'), { folder: target, from: 'menu' }, section);
    else if (target instanceof TFile) addActionEntries(menu, actionsOn(this.actions(), 'file'), { file: target, from: 'menu' }, section);
  }

  /** The first queued note, opened in the page. */
  openNext() {
    const target = this.queue.peek(pageFile(this.app));
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
    const here = pageFile(this.app);
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
