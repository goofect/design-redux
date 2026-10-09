/* ------------------------------------------------------------------ */
/* Plugin: lifecycle only                                              */
/* ------------------------------------------------------------------ */

class DesignRedux extends Plugin {
  async onload() {
    await this.loadSettings();

    this.unloading = false;
    this.pins = new Pins(this);
    this.orders = new Orders(this);
    this.queue = new Queue(this);
    this.lengths = new Lengths(this);
    this.bulk = new BulkEdits(this);
    this.features = [
      new Library(this),
      new ListKeys(this),
      new SidebarDrop(this),
      new ActionsMenu(this),
      new PropertiesPanel(this),
      new ContextStrip(this),
      new UpNext(this),
      new OnePage(this),
      new MenuFilter(this),
      new SettingsButton(this),
      new CoverImages(this),
      new CoverDrop(this),
      new ImageRouter(this),
      new PropertyClipboard(this),
      new AlbumProperty(this),
      new MarkedLists(this),
      new Scripts(this),
      new Footnotes(this),
      new GraphPropertyFilter(this),
      new GraphRoutes(this),
      new QuietLinks(this),
      new CanvasLegend(this),
      new CanvasAlign(this),
      new CanvasArrows(this),
      new CanvasArrange(this),
      new CanvasMindMap(this),
      new CanvasCards(this),
      new CanvasFold(this),
      new CanvasBranches(this),
      new CanvasOutline(this),
      new CanvasFind(this),
      new CanvasFocus(this),
      new CanvasDuplicate(this),
      new Diagnostics(this),
      new BulkEditing(this),
    ];

    this.syncFrame = 0;
    // Before the workspace is restored, so saved leaves of these types
    // can be rebuilt rather than dropped.
    this.each((f) => f.registerTypes());

    this.addSettingTab(new DesignReduxSettingTab(this.app, this));

    // Registered once, never withdrawn: Obsidian has no public way to
    // remove a command, so a disabled feature hides its own instead.
    this.features.forEach((feature) => {
      feature.commands().forEach((cmd) => {
        this.addCommand({
          id: cmd.id,
          name: cmd.name,
          // An icon lets a command sit in the phone's editing toolbar.
          ...(cmd.icon ? { icon: cmd.icon } : {}),
          ...(cmd.hotkeys ? { hotkeys: cmd.hotkeys } : {}),
          checkCallback: (checking) => {
            const ok = cmd.check ? cmd.check() : true;
            if (checking || !ok) return ok;
            cmd.run();
            return true;
          },
        });
      });
    });

    this.app.workspace.onLayoutReady(() => {
      this.each((f) => f.register());
      this.refresh();
      // Stray library panes left by an old version are cleared. Browse
      // pages aren't: several are normal — tabs, splits, one per page.
      this.each((f) => {
        if (typeof f.singleLeaf !== 'function') return;
        f.singleLeaf(LIBRARY_VIEW);
      });

      this.registerEvent(this.app.workspace.on('layout-change', () => this.queueSync()));
      // Later, once the vault is surely all there.
      window.setTimeout(() => {
        if (!this.unloading) this.pruneLeftovers();
      }, 15000);
      // Arrangements follow the files they name.
      this.registerEvent(
        this.app.vault.on('rename', (file, oldPath) => {
          this.orders.followRename(file, oldPath);
          this.followFolderNote(file, oldPath);
        })
      );
      this.registerEvent(this.app.vault.on('delete', (file) => this.orders.followDelete(file)));
      this.registerEvent(
        this.app.workspace.on('active-leaf-change', () => this.queueSync())
      );
    });
  }

  /**
   * Runs once, when the plugin is first enabled — not on every load.
   * The official place to set up a custom view, so the library appears
   * without the user having to find the command.
   */
  async onUserEnable() {
    const library = this.feature(Library);
    if (library && library.enabled) await library.reveal();
  }

  onunload() {
    // Marked before features are torn down: leaves must survive an
    // unload, since Obsidian restores them itself when the plugin is
    // updated or re-enabled. Detaching here loses their position.
    this.unloading = true;
    window.clearTimeout(this.refreshTimer);
    if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame);
    this.each((f) => f.disable());
  }

  /** Ask for an image and record it on the note itself. */
  setNoteCover(file) {
    const covers = this.feature(CoverImages);
    new ImagePicker(this.app, (image) =>
      covers.setCover(file, covers.linkTo(image, file))
    ).open();
  }

  async clearNoteCover(file) {
    const key = this.settings.coverProperty || 'cover';
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        delete fm[key];
      });
    } catch (err) {
      console.error('Design Redux: could not clear the cover', err);
      new Notice('Could not update the properties.');
    }
  }

  /** Every kind of file, most recent first. */
  recentFiles() {
    return this.app.workspace
      .getLastOpenFiles()
      .map((path) => this.app.vault.getFileByPath(path))
      .filter(Boolean);
  }

  togglePin(target) {
    if (!this.pins.toggle(target)) return;
    this.refreshBrowse();
    // The sidebar lists pins too, when Pinned is opened out.
    const library = this.feature(Library);
    if (library) library.refreshViews();
  }

  /** A property's display name, which keeps its own capitalisation. */
  propertyLabel(key) {
    try {
      const info = this.app.metadataTypeManager.getAllProperties()[key];
      if (info && info.name) return info.name;
    } catch (err) {
      /* fall through */
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  /** A name not yet taken in a folder: "Untitled", "Untitled 1", … */
  freeChildPath(folder, base, ext) {
    const dir = !folder || folder.path === '/' ? '' : folder.path + '/';
    const make = (n) =>
      normalizePath(`${dir}${n ? `${base} ${n}` : base}${ext ? '.' + ext : ''}`);
    let n = 0;
    while (this.app.vault.getAbstractFileByPath(make(n))) n++;
    return make(n);
  }

  /**
   * A note in a particular folder, opened with its title ready to type
   * over — the way the file explorer's New note behaves.
   */
  async newNote(folder) {
    try {
      const file = await this.app.vault.create(
        this.freeChildPath(folder, 'Untitled', 'md'),
        ''
      );
      await this.app.workspace
        .getLeaf(false)
        .openFile(file, { active: true, eState: { rename: 'all' } });
    } catch (err) {
      console.error('Design Redux: could not create the note', err);
      new Notice('Could not create the note.');
    }
  }

  /** An empty canvas in a folder, opened, as the file explorer's New canvas does. */
  async newCanvas(folder) {
    try {
      const file = await this.app.vault.create(
        this.freeChildPath(folder, 'Untitled', 'canvas'),
        JSON.stringify({ nodes: [], edges: [] })
      );
      await this.app.workspace.getLeaf(false).openFile(file, { active: true });
    } catch (err) {
      console.error('Design Redux: could not create the canvas', err);
      new Notice('Could not create the canvas.');
    }
  }

  /**
   * A folder in a particular folder, asked for by name, then opened —
   * so the next thing, putting a note in it, is right there. An empty
   * folder is hidden from listings by default, so without that it would
   * seem not to have been made.
   */
  newFolder(parent) {
    new NamePrompt(this.app, 'New folder', 'Folder name', async (name) => {
      const clean = name.replace(/[\\/:]/g, '').trim();
      if (!clean) return;
      const dir = !parent || parent.path === '/' ? '' : parent.path + '/';
      const path = normalizePath(dir + clean);
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(`"${clean}" already exists here.`);
        return;
      }
      try {
        await this.app.vault.createFolder(path);
        const library = this.feature(Library);
        if (library && library.enabled) library.browseMode({ mode: 'folder', path: path });
      } catch (err) {
        console.error('Design Redux: could not create the folder', err);
        new Notice('Could not create the folder.');
      }
    }).open();
  }

  /**
   * Artwork for a folder, which has no properties of its own: its
   * folder note's cover (or first image, where the setting has it), then
   * an image called "cover" inside it. Shared
   * by the browse view and the sidebar, so a folder looks the same in
   * both.
   */
  folderCoverSrc(folder) {
    const note = this.folderNote(folder);
    if (note) {
      const src = noteCoverSrc(this, note);
      if (src) return src;
    }
    const named = (folder.children || []).find(
      (c) =>
        c instanceof TFile &&
        ['cover', '_cover', 'folder'].indexOf(c.basename.toLowerCase()) !== -1 &&
        IMAGE_EXTENSIONS.indexOf(c.extension.toLowerCase()) !== -1
    );
    return named ? this.app.vault.getResourcePath(named) : null;
  }

  /** The note that represents a folder, if it exists. */
  folderNote(folder) {
    const pattern = this.settings.folderNoteName || '{{folder}}';
    const name = pattern.replace(/\{\{folder\}\}/g, folder.name);
    return this.app.vault.getFileByPath(`${folder.path}/${name}.md`);
  }

  /**
   * A folder renamed takes its folder note's name with it — the note is
   * found by the folder's name, and holds its cover and properties, so
   * left behind it would stop being the folder's note. Renamed as
   * Obsidian renames, so links to it follow; not if the new name is
   * taken. A folder that's only moved keeps its name, and its note.
   *
   * Obsidian tells of the folder first and of what's inside it after,
   * a moment later, so the note is looked for then too.
   */
  followFolderNote(entry, oldPath) {
    if (!oldPath) return;
    const jobs = (this.folderNoteJobs || []).filter((j) => j.until > Date.now());
    this.folderNoteJobs = jobs;
    if (entry instanceof TFolder) {
      const oldName = oldPath.split('/').pop();
      const pattern = this.settings.folderNoteName || '{{folder}}';
      if (oldName === entry.name || pattern.indexOf('{{folder}}') === -1) return;
      const job = {
        folder: entry,
        was: pattern.replace(/\{\{folder\}\}/g, oldName),
        now: pattern.replace(/\{\{folder\}\}/g, entry.name),
        until: Date.now() + 10000,
      };
      jobs.push(job);
      window.setTimeout(() => this.renameFolderNote(job), 0);
    } else if (entry instanceof TFile && jobs.length) {
      const job = jobs.find((j) => entry.parent === j.folder && entry.name === `${j.was}.md`);
      if (job) window.setTimeout(() => this.renameFolderNote(job), 0);
    }
  }

  async renameFolderNote(job) {
    const jobs = this.folderNoteJobs || [];
    if (this.unloading || jobs.indexOf(job) === -1) return;
    const note = this.app.vault.getFileByPath(`${job.folder.path}/${job.was}.md`);
    // Not moved in yet: its own rename comes later, and asks again.
    if (!note) return;
    jobs.splice(jobs.indexOf(job), 1);
    const target = normalizePath(`${job.folder.path}/${job.now}.md`);
    if (this.app.vault.getAbstractFileByPath(target)) return;
    try {
      await this.app.fileManager.renameFile(note, target);
    } catch (err) {
      console.error('Design Redux: could not rename the folder note', err);
    }
  }

  /**
   * Move a file into a folder, keeping links intact.
   *
   * renameFile rather than a raw move, because Obsidian rewrites every
   * link to the file as part of it. A name already taken in the
   * destination gets a numbered suffix instead of overwriting.
   */
  /**
   * Move a file or folder into another folder, keeping its name unless
   * that's taken there. Resolves to where it was — or false if it didn't
   * move. With { announce: true } it says so, with an Undo.
   */
  async moveFile(file, folderPath, opts = {}) {
    const dir = !folderPath || folderPath === '/' ? '' : folderPath;
    const current = file.parent ? file.parent.path : '/';
    if (current === (dir || '/')) return false;
    const from = file.path;
    // The order of the album it leaves, to restore if it comes back.
    const order = (this.settings.albumOrders || {})[current];
    const kept = order ? JSON.parse(JSON.stringify(order)) : null;
    // A folder can't go inside itself, or inside anything in it.
    const isFolder = file instanceof TFolder;
    if (isFolder && (dir === file.path || dir.startsWith(file.path + '/'))) return false;

    const at = (name) => (dir ? `${dir}/${name}` : name);
    let candidate = at(file.name);
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = at(isFolder ? `${file.name} ${n}` : `${file.basename} ${n}.${file.extension}`);
      n++;
    }

    try {
      await this.app.fileManager.renameFile(file, candidate);
    } catch (err) {
      console.error('Design Redux: could not move the file', err);
      new Notice(`Could not move "${file.name}".`);
      return false;
    }
    if (opts.announce) {
      const name = file instanceof TFile ? file.basename : file.name;
      const where = dir ? dir.split('/').pop() : this.app.vault.getName();
      this.offerUndo(`Moved “${name}” to ${where}.`, () => this.putBack(file, from, current, kept));
    }
    return from;
  }

  /**
   * A notice saying what was done, with an Undo that reverses it —
   * Obsidian has none for moving or renaming files.
   */
  offerUndo(message, undo) {
    const fragment = document.createDocumentFragment();
    const text = document.createElement('span');
    text.textContent = `${message} `;
    const link = document.createElement('a');
    link.className = 'dr-undo';
    link.setAttribute('href', '#');
    link.textContent = 'Undo';
    fragment.append(text, link);
    const notice = new Notice(fragment, 8000);
    link.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (notice && typeof notice.hide === 'function') notice.hide();
      undo();
    });
    return notice;
  }

  /**
   * A file or folder back where it was, and the order of the album it
   * came from as it was then. Not if something else has taken its place.
   */
  async putBack(entry, oldPath, parentPath, order) {
    if (this.app.vault.getAbstractFileByPath(entry.path) !== entry) {
      new Notice(`“${entry.name}” isn’t there any more, so it can’t go back.`);
      return false;
    }
    if (this.app.vault.getAbstractFileByPath(oldPath)) {
      new Notice(`Something else is at “${oldPath}” now, so it can’t go back.`);
      return false;
    }
    try {
      await this.app.fileManager.renameFile(entry, oldPath);
    } catch (err) {
      console.error('Design Redux: could not undo', err);
      new Notice('Could not undo that.');
      return false;
    }
    if (order && parentPath) {
      this.settings.albumOrders = Object.assign({}, this.settings.albumOrders, { [parentPath]: order });
      await this.saveData(this.settings);
    }
    this.refreshBrowse();
    return true;
  }

  /**
   * Whether a folder holds anything worth showing. Counted through
   * subfolders, since a folder whose only contents are folders of notes
   * is still somewhere you'd want to go — and the folder note doesn't
   * count, as it describes the folder rather than filling it.
   */
  folderHasNotes(folder) {
    for (const child of folder.children || []) {
      if (child instanceof TFolder) {
        if (this.folderHasNotes(child)) return true;
      } else if (!this.isFolderNote(child)) {
        return true;
      }
    }
    return false;
  }

  /** True for the note that stands for its own folder. */
  isFolderNote(file) {
    if (!this.settings.hideFolderNotes) return false;
    if (!file.parent || file.extension !== 'md') return false;
    const pattern = this.settings.folderNoteName || '{{folder}}';
    return file.basename === pattern.replace(/\{\{folder\}\}/g, file.parent.name);
  }

  /**
   * Ask for an image and record it on the folder note, creating that
   * note if it doesn't exist. Stored in the vault rather than in plugin
   * settings, so the pairing survives being moved or rebuilt elsewhere.
   */
  /** Pick the colour a folder or note's generated cover takes. */
  chooseCoverColor(target) {
    const name = target instanceof TFolder ? target.name : target.basename;
    new CoverColorModal(this, target, name).open();
  }

  setFolderCover(folder, after) {
    new ImagePicker(this.app, async (image) => {
      try {
        const note = await this.ensureFolderNote(folder);
        const covers = this.feature(CoverImages);
        await covers.setCover(note, covers.linkTo(image, note));
        // The view redraws itself once the cache catches up.
        if (after) after();
      } catch (err) {
        console.error('Design Redux: could not set the folder cover', err);
        new Notice('Could not set the cover.');
      }
    }).open();
  }

  async ensureFolderNote(folder) {
    const existing = this.folderNote(folder);
    if (existing) return existing;

    const pattern = this.settings.folderNoteName || '{{folder}}';
    const name = pattern.replace(/\{\{folder\}\}/g, folder.name);
    return this.app.vault.create(`${folder.path}/${name}.md`, '');
  }

  async clearFolderCover(folder, after) {
    const note = this.folderNote(folder);
    if (!note) return;
    const key = this.settings.coverProperty || 'cover';
    try {
      await this.app.fileManager.processFrontMatter(note, (fm) => {
        delete fm[key];
      });
      this.refreshBrowse();
      if (after) after();
    } catch (err) {
      console.error('Design Redux: could not clear the folder cover', err);
    }
  }

  refreshBrowse() {
    liveViews(this.app, BROWSE_VIEW, BrowseView).forEach((v) => v.render());
  }

  /** One feature by its class, rather than by its name as a string. */
  feature(Ctor) {
    return (this.features || []).find((f) => f instanceof Ctor) || null;
  }

  /** A throw in one feature must not leave the others half set up. */
  each(fn) {
    (this.features || []).forEach((f) => {
      try {
        fn(f);
      } catch (err) {
        console.error(`Design Redux: ${f.constructor.name} failed`, err);
        this.noteError(`${f.constructor.name}: ${(err && err.stack) || err}`);
      }
    });
  }

  /**
   * Settings kept for files and folders that no longer exist — deleted
   * or renamed while the plugin was off, so nothing followed them — are
   * let go. Not if the vault looks empty: that's a vault still loading.
   */
  pruneLeftovers() {
    const vault = this.app.vault;
    if (typeof vault.getAllLoadedFiles === 'function' && vault.getAllLoadedFiles().length < 2) return;
    const exists = (p) => p === '/' || !!vault.getAbstractFileByPath(p);
    let changed = false;
    PATH_KEYED.concat(['albumOrders', 'folderDefaults']).forEach((key) => {
      const kept = this.settings[key];
      if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return;
      Object.keys(kept).forEach((p) => {
        if (exists(p)) return;
        delete kept[p];
        changed = true;
      });
    });
    if (changed) this.saveData(this.settings);
    return changed;
  }

  /** The last few errors, for Copy diagnostics. Kept in memory only. */
  noteError(text) {
    this.errors = (this.errors || []).concat([`${new Date().toISOString()}  ${text}`]).slice(-20);
  }

  refresh() {
    this.each((f) => (f.enabled ? f.enable() : f.disable()));
  }

  /**
   * Workspace events arrive in bursts: opening a split fires several in
   * a row, and each would otherwise walk every leaf. Coalesce them into
   * a single pass on the next frame.
   */
  queueSync() {
    if (this.syncFrame) return;
    this.syncFrame = window.requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.each((f) => {
        if (f.enabled) f.sync();
      });
    });
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    // Older saved settings are brought up to date first, keeping a copy
    // of them as they were in case a step goes wrong.
    const from = saved.settingsVersion || 1;
    const steps = SETTINGS_MIGRATIONS.filter((m) => m.to > from).sort((a, b) => a.to - b.to);
    if (steps.length) {
      try {
        const dir = this.manifest && this.manifest.dir;
        if (dir) await this.app.vault.adapter.write(`${dir}/data.before-v${steps[0].to}.json`, JSON.stringify(saved, null, 2));
      } catch (err) {
        console.error('Design Redux: could not back up settings before updating them', err);
      }
      steps.forEach((m) => {
        try {
          m.run(saved);
          saved.settingsVersion = m.to;
        } catch (err) {
          console.error(`Design Redux: settings step ${m.to} failed`, err);
        }
      });
    }

    // Cloned: some defaults are objects, and sharing the reference
    // would let a change to settings edit DEFAULTS itself.
    const settings = JSON.parse(JSON.stringify(DEFAULTS));

    // Only keys the plugin still recognises: a merge would carry
    // settings from removed features indefinitely.
    Object.keys(DEFAULTS).forEach((key) => {
      if (saved[key] !== undefined) settings[key] = saved[key];
    });

    this.settings = settings;

    const stale = Object.keys(saved).filter((k) => DEFAULTS[k] === undefined);
    if (stale.length) await this.saveData(this.settings);
  }

  /**
   * Saved at once; the features and open screens follow once typing in
   * a settings field pauses, rather than once per letter.
   */
  async saveSettings() {
    await this.saveData(this.settings);
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      if (this.unloading) return;
      this.refresh();
      // Open screens show the change at once — an order, album columns,
      // a limit — rather than on their next visit.
      this.refreshBrowse();
    }, 200);
  }
}

/* ------------------------------------------------------------------ */

