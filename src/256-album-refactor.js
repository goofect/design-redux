/* ------------------------------------------------------------------ */
/* Reorganising albums safely                                          */
/*                                                                     */
/* Renaming an album, moving it into another collection, merging it    */
/* into another, or splitting notes off into a new one: each shown     */
/* first — what moves, what's renamed for a name already taken, how    */
/* many links point in — and done only when that's agreed. Files move  */
/* the way Obsidian moves them, so links follow; and one Undo puts it  */
/* all back, properties and all.                                       */
/* ------------------------------------------------------------------ */

/** What's about to happen, to agree to or not. */
class RefactorPreview extends Modal {
  constructor(app, plan, onConfirm) {
    super(app);
    this.plan = plan;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl, plan } = this;
    contentEl.empty();
    contentEl.addClass('dr-refactor');
    if (this.titleEl) this.titleEl.setText(plan.title);
    const list = contentEl.createEl('ul', { cls: 'dr-refactor-effects' });
    plan.lines.forEach((line) => list.createEl('li', { text: line }));
    plan.warnings.forEach((line) => list.createEl('li', { cls: 'is-warning', text: line }));
    if (plan.blocked) contentEl.createDiv({ cls: 'dr-refactor-blocked', text: plan.blocked });
    // What it does first, then Cancel — as Obsidian's own dialogs.
    const buttons = new Setting(contentEl);
    if (!plan.blocked) {
      buttons.addButton((b) =>
        b
          .setButtonText(plan.confirm)
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
    }
    buttons.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Notes of an album to split off, and the new album's name. */
class SplitChooser extends Modal {
  constructor(app, folder, files, onChoose) {
    super(app);
    this.folder = folder;
    this.files = files;
    this.onChoose = onChoose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('dr-refactor');
    if (this.titleEl) this.titleEl.setText(`Split notes off ${this.folder.name}`);
    const picked = new Set();
    let name = '';
    new Setting(contentEl).setName('New album').setDesc('Made beside this one.').addText((t) => t.setPlaceholder('Name').onChange((v) => (name = v.trim())));
    const list = contentEl.createDiv({ cls: 'dr-refactor-pick' });
    this.files.forEach((file) => {
      const row = list.createEl('label', { cls: 'dr-refactor-pick-row' });
      const box = row.createEl('input', { type: 'checkbox' });
      box.addEventListener('change', () => (box.checked ? picked.add(file) : picked.delete(file)));
      row.createSpan({ text: file.basename });
    });
    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Next')
          .setCta()
          .onClick(() => {
            this.close();
            this.onChoose(this.files.filter((f) => picked.has(f)), name);
          })
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* What merging carries from one album's folder note to the other's. */
const mergedKeys = () => [ALBUM_KEYS.includes, ALBUM_KEYS.related, ALBUM_KEYS.featured];

class AlbumRefactor extends Feature {
  settingsSchema() {
    return [
      {
        key: 'albumRefactor',
        name: 'Reorganise albums safely',
        desc: 'A folder’s menu can rename an album, move it into another collection, merge it into another or split notes off it — each shown before it’s done, with links kept and one Undo.',
      },
    ];
  }

  /** On the album's menu as Reorganise; from the palette, for the album open. */
  actions() {
    const when = (ctx) => this.enabled && !(ctx.folder.isRoot && ctx.folder.isRoot());
    const act = (id, name, menu, icon, run) => ({ id, name, menu, icon, on: 'browse', when, run: (ctx) => run(ctx.folder) });
    return [
      act('album-rename', 'Rename this album…', 'Rename…', 'pencil', (f) => this.askRename(f)),
      act('album-move', 'Move this album into another collection…', 'Move into…', 'folder-input', (f) => this.askMove(f)),
      act('album-merge', 'Merge this album into another…', 'Merge into…', 'merge', (f) => this.askMerge(f)),
      act('album-split', 'Split notes off this album into a new one…', 'Split notes off…', 'split', (f) => this.askSplit(f)),
    ];
  }

  addFolderItems(menu, folder, sectioned) {
    if (folder) addActionItems(menu, this.actions(), { folder, from: 'menu' }, 'Reorganise', 'folder-tree', sectioned);
  }

  /* -- what each would do ------------------------------------------ */

  /** Everything inside a folder, files and folders, at any depth. */
  inside(folder) {
    const out = [];
    const walk = (f) =>
      (f.children || []).forEach((c) => {
        out.push(c);
        if (c instanceof TFolder) walk(c);
      });
    walk(folder);
    return out;
  }

  /** Links into these files from notes not among them, as Obsidian counts them. */
  linksIn(files) {
    const paths = new Set(files.map((f) => f.path));
    const resolved = this.app.metadataCache.resolvedLinks || {};
    let n = 0;
    Object.keys(resolved).forEach((from) => {
      if (paths.has(from)) return;
      Object.keys(resolved[from] || {}).forEach((to) => {
        if (paths.has(to)) n += resolved[from][to];
      });
    });
    return n;
  }

  linkLine(files) {
    const n = this.linksIn(files.filter((f) => f instanceof TFile));
    if (!n) return null;
    let update = true;
    try {
      if (typeof this.app.vault.getConfig === 'function' && this.app.vault.getConfig('alwaysUpdateLinks') === false) update = false;
    } catch (err) {
      update = true;
    }
    return update
      ? `${n} ${n === 1 ? 'link' : 'links'} from other notes point in; Obsidian keeps ${n === 1 ? 'it' : 'them'} pointing at the notes as they move.`
      : `${n} ${n === 1 ? 'link' : 'links'} from other notes point in; Obsidian asks whether to update them, as your settings say.`;
  }

  /** A name a folder can't take. */
  badName(name) {
    if (!name || !name.trim()) return 'It needs a name.';
    if (/[\\/:]/.test(name)) return 'A name can’t have / \\ or : in it.';
    return null;
  }

  pathIn(parent, name) {
    return !parent || (parent.isRoot && parent.isRoot()) ? name : `${parent.path}/${name}`;
  }

  planRename(folder, name) {
    name = String(name || '').trim();
    const to = this.pathIn(folder.parent, name);
    const note = this.plugin.folderNote(folder);
    const lines = [`“${folder.name}” becomes “${name}”.`];
    if (note) lines.push(`Its folder note becomes “${name}.md”, so it stays the album’s.`);
    const links = this.linkLine(this.inside(folder));
    if (links) lines.push(links);
    let blocked = this.badName(name);
    if (!blocked && name === folder.name) blocked = 'That’s its name already.';
    if (!blocked && this.app.vault.getAbstractFileByPath(to)) blocked = `Something called “${name}” is there already.`;
    return {
      title: `Rename ${folder.name}`,
      confirm: 'Rename',
      lines,
      warnings: [],
      blocked,
      done: `Renamed “${folder.name}” to “${name}”.`,
      run: async () => {
        const from = folder.path;
        await this.app.fileManager.renameFile(folder, to);
        return () => this.plugin.putBack(folder, from);
      },
    };
  }

  planMove(folder, target) {
    const all = this.inside(folder);
    const to = this.pathIn(target, folder.name);
    const notes = all.filter((f) => f instanceof TFile && f.extension === 'md').length;
    const subs = all.filter((f) => f instanceof TFolder).length;
    const lines = [`“${folder.name}” moves into “${target.isRoot && target.isRoot() ? this.app.vault.getName() : target.name}”.`];
    lines.push(`${notes} ${notes === 1 ? 'note goes' : 'notes go'} with it${subs ? `, in ${subs} ${subs === 1 ? 'sub-album' : 'sub-albums'}` : ''}.`);
    const links = this.linkLine(all);
    if (links) lines.push(links);
    let blocked = null;
    if (target === folder || target.path.startsWith(folder.path + '/')) blocked = 'An album can’t go inside itself.';
    else if (folder.parent === target) blocked = 'It’s there already.';
    else if (this.app.vault.getAbstractFileByPath(to)) blocked = `Something called “${folder.name}” is there already.`;
    return {
      title: `Move ${folder.name}`,
      confirm: 'Move',
      lines,
      warnings: [],
      blocked,
      done: `Moved “${folder.name}”.`,
      run: async () => {
        const from = await this.plugin.moveFile(folder, target.path);
        return from ? () => this.plugin.putBack(folder, from) : null;
      },
    };
  }

  planMerge(folder, target) {
    const note = this.plugin.folderNote(folder);
    const children = (folder.children || []).filter((c) => c !== note);
    const notes = children.filter((c) => c instanceof TFile);
    const subs = children.filter((c) => c instanceof TFolder);
    const taken = (name) => !!this.app.vault.getAbstractFileByPath(this.pathIn(target, name));
    const lines = [`${notes.length} ${notes.length === 1 ? 'note moves' : 'notes move'} from “${folder.name}” into “${target.name}”.`];
    if (subs.length) lines.push(`${subs.length} ${subs.length === 1 ? 'sub-album moves' : 'sub-albums move'} too.`);
    const structure = this.plugin.feature(AlbumStructure);
    const fm = this.frontmatter(note);
    const carried = mergedKeys().filter((k) => valueList(fmGet(fm, k)).length);
    if (carried.length) lines.push(`Its ${carried.join(', ')} join ${target.name}’s.`);
    if (note) lines.push(`Its folder note moves into ${target.name} as “${folder.name}.md”, a note like the rest, with what it says kept.`);
    lines.push(`The empty folder “${folder.name}” is removed.`);
    const links = this.linkLine(this.inside(folder));
    if (links) lines.push(links);
    const warnings = children
      .concat(note ? [note] : [])
      .filter((c) => taken(c.name))
      .map((c) => `“${c.name}” is in both; the one from ${folder.name} is numbered so neither is lost.`);
    let blocked = null;
    if (target === folder || target.path.startsWith(folder.path + '/')) blocked = 'An album can’t merge into itself, or into one inside it.';
    return {
      title: `Merge ${folder.name} into ${target.name}`,
      confirm: 'Merge',
      lines,
      warnings,
      blocked,
      done: `Merged “${folder.name}” into “${target.name}”.`,
      run: () => this.merge(folder, target, note, children, structure),
    };
  }

  planSplit(folder, files, name) {
    name = String(name || '').trim();
    const parent = folder.parent;
    const to = this.pathIn(parent, name);
    const lines = [`A new album, “${name}”, beside ${folder.name}.`];
    const shown = files.slice(0, 8).map((f) => f.basename).join(', ');
    lines.push(`${files.length} ${files.length === 1 ? 'note moves' : 'notes move'} into it: ${shown}${files.length > 8 ? ` and ${files.length - 8} more` : ''}.`);
    const links = this.linkLine(files);
    if (links) lines.push(links);
    let blocked = this.badName(name);
    if (!blocked && !files.length) blocked = 'Pick the notes to split off.';
    if (!blocked && this.app.vault.getAbstractFileByPath(to)) blocked = `Something called “${name}” is there already.`;
    return {
      title: `Split notes off ${folder.name}`,
      confirm: 'Split',
      lines,
      warnings: [],
      blocked,
      done: `Split ${files.length} ${files.length === 1 ? 'note' : 'notes'} off into “${name}”.`,
      run: async () => {
        const made = await this.app.vault.createFolder(to);
        const fresh = made || this.app.vault.getAbstractFileByPath(to);
        const moved = [];
        for (const file of files) {
          const from = await this.plugin.moveFile(file, to);
          if (from) moved.push([file, from]);
        }
        return async () => {
          for (const [file, from] of moved.slice().reverse()) await this.plugin.putBack(file, from);
          if (fresh && !(fresh.children || []).length) await this.app.fileManager.trashFile(fresh);
        };
      },
    };
  }

  frontmatter(note) {
    const cache = note ? this.app.metadataCache.getFileCache(note) : null;
    return (cache && cache.frontmatter) || {};
  }

  /** Merged: properties joined, everything moved, the folder note made a note, the empty folder gone. Its Undo. */
  async merge(folder, target, note, children, structure) {
    const from = folder.path;
    const theirs = this.frontmatter(note);
    const targetNote = this.plugin.folderNote(target);
    const before = this.frontmatter(targetNote);
    const kept = {};
    mergedKeys().concat(ALBUM_KEYS.description).forEach((k) => (kept[k] = fmGet(before, k)));
    const carried = mergedKeys().filter((k) => valueList(fmGet(theirs, k)).length);
    const description = valueList(fmGet(theirs, ALBUM_KEYS.description)).join(' ');
    const ownKind = {};
    if (structure && (carried.length || (description && !valueList(kept[ALBUM_KEYS.description]).length))) {
      const into = targetNote || (await this.plugin.ensureFolderNote(target));
      await this.app.fileManager.processFrontMatter(into, (fm) => {
        carried.forEach((k) => {
          const merged = valueList(fmGet(fm, k));
          valueList(fmGet(theirs, k)).forEach((v) => {
            // Not the album it's going into, nor one already listed.
            if (plainValue(v) === target.name || merged.some((m) => plainValue(m) === plainValue(v))) return;
            merged.push(v);
          });
          fm[k] = merged;
        });
        if (description && !valueList(fmGet(fm, ALBUM_KEYS.description)).length) fm[ALBUM_KEYS.description] = description;
      });
    }
    // Its note, a note like the rest now: no longer saying what kind of album it is.
    if (note) {
      [ALBUM_KEYS.type, ALBUM_KEYS.layout].forEach((k) => {
        if (fmGet(theirs, k) !== undefined) ownKind[k] = fmGet(theirs, k);
      });
      if (Object.keys(ownKind).length) {
        await this.app.fileManager.processFrontMatter(note, (fm) => Object.keys(ownKind).forEach((k) => delete fm[k]));
      }
    }
    const moved = [];
    for (const entry of children.concat(note ? [note] : [])) {
      const was = await this.plugin.moveFile(entry, target.path);
      if (was) moved.push([entry, was]);
    }
    if (!(folder.children || []).length) await this.app.fileManager.trashFile(folder);
    return async () => {
      if (!this.app.vault.getAbstractFileByPath(from)) await this.app.vault.createFolder(from);
      for (const [entry, was] of moved.slice().reverse()) await this.plugin.putBack(entry, was);
      if (note && Object.keys(ownKind).length) {
        await this.app.fileManager.processFrontMatter(note, (fm) => Object.assign(fm, ownKind));
      }
      const into = this.plugin.folderNote(target);
      if (into && (carried.length || description)) {
        await this.app.fileManager.processFrontMatter(into, (fm) => {
          Object.keys(kept).forEach((k) => {
            if (kept[k] === undefined) delete fm[k];
            else fm[k] = kept[k];
          });
        });
      }
    };
  }

  /* -- asking, showing, doing ------------------------------------- */

  /** Shown, and done if agreed, with one Undo for all of it. */
  preview(plan) {
    new RefactorPreview(this.app, plan, () => this.perform(plan)).open();
  }

  async perform(plan) {
    let undo = null;
    try {
      undo = await plan.run();
    } catch (err) {
      console.error('Design Redux: could not reorganise', err);
      new Notice('Could not finish that; anything moved so far is where it went.');
    }
    this.plugin.refreshBrowse();
    if (undo) {
      this.plugin.offerUndo(plan.done, async () => {
        await undo();
        this.plugin.refreshBrowse();
      });
    }
    return !!undo;
  }

  askRename(folder) {
    if (!folder) return;
    new NamePrompt(this.app, `Rename ${folder.name}`, 'New name', (name) => this.preview(this.planRename(folder, name)), { value: folder.name, button: 'Next' }).open();
  }

  askMove(folder) {
    if (!folder) return;
    new FolderPicker(this.app, (target) => this.preview(this.planMove(folder, target)), {
      placeholder: `Move ${folder.name} into…`,
      withRoot: true,
      skip: (f) => f === folder,
    }).open();
  }

  askMerge(folder) {
    if (!folder) return;
    new FolderPicker(this.app, (target) => this.preview(this.planMerge(folder, target)), { placeholder: `Merge ${folder.name} into…`, skip: (f) => f === folder }).open();
  }

  askSplit(folder) {
    if (!folder) return;
    const files = (folder.children || []).filter((c) => c instanceof TFile && c.extension === 'md' && !this.plugin.isFolderNote(c)).sort((a, b) => byName(a.basename, b.basename));
    if (!files.length) {
      new Notice(`${folder.name} has no notes of its own to split off.`);
      return;
    }
    new SplitChooser(this.app, folder, files, (picked, name) => this.preview(this.planSplit(folder, picked, name))).open();
  }
}

AlbumRefactor.settingKey = 'albumRefactor';
