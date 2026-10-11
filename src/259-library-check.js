/* ------------------------------------------------------------------ */
/* Looking the library over                                            */
/*                                                                     */
/* What a growing library loses track of, in a report to go through:   */
/*   hierarchy — albums with nothing in them, nested very deep, in no  */
/*     collection, taking each other in, or taking in the collection   */
/*     they're in; notes whose parents lead round in a circle; notes   */
/*     that say they're albums without being one; links that lead      */
/*     nowhere;                                                        */
/*   duplicates and overlaps — albums of one name, or one cover;       */
/*     albums sharing most of their notes; a note listed twice;        */
/*   coverage and balance — albums with no description, subjects with  */
/*     nothing to start with, albums and collections far larger than   */
/*     the rest.                                                       */
/* And an inbox: the notes in no album, to be put in one a few at a    */
/* time. Things to look at, not rules: the report changes nothing.     */
/* ------------------------------------------------------------------ */

const LIBRARY_DEEP = 5;

const LIBRARY_SECTIONS = [
  { id: 'hierarchy', title: 'Hierarchy' },
  { id: 'overlap', title: 'Duplicates and overlaps' },
  { id: 'coverage', title: 'Coverage and balance' },
  { id: 'relations', title: 'Relationships' },
];

/* Albums sharing at least this many notes, and this much of the smaller one, overlap. */
const OVERLAP_NOTES = 3;
const OVERLAP_SHARE = 0.5;

/* An album or collection this many times the usual size, and at least this large, is out of balance. */
const BALANCE_TIMES = 3;
const BALANCE_NOTES = 40;
const BALANCE_ALBUMS = 12;

function middleOf(numbers) {
  if (!numbers.length) return 0;
  const sorted = numbers.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

class ReportScreen extends BrowseScreen {
  title() {
    return 'Library check';
  }

  render(root) {
    const view = this.view;
    const check = this.plugin.feature(LibraryCheck);
    view.renderTitleBar(root, this.title());
    if (!check || !check.enabled) {
      root.createDiv({ cls: 'dr-empty', text: 'Looking the library over is switched off in settings.' });
      return;
    }
    const found = check.problems();
    const loose = check.unclassified();
    root.createDiv({
      cls: 'dr-report-lead',
      text: found.length || loose.length ? 'Things to look at, not rules: nothing here is changed until you change it.' : 'Nothing to look at: every album holds something and says what it is, and every note is in one.',
    });
    if (loose.length && check.settings.libraryInbox !== false) {
      const row = this.row(root, 'inbox', `${loose.length} ${loose.length === 1 ? 'note' : 'notes'} in no album`, 'Open the inbox to put them in albums', '');
      onActivate(row, () => view.navigate({ mode: 'inbox', property: null }));
    }
    LIBRARY_SECTIONS.forEach((section) => {
      const items = found.filter((p) => p.section === section.id);
      if (!items.length) return;
      const head = root.createDiv({ cls: 'dr-report-head' });
      head.createSpan({ text: section.title });
      head.createSpan({ cls: 'dr-report-count', text: String(items.length) });
      const list = root.createDiv({ cls: 'dr-report-list' });
      roveFocus(list, '.dr-report-row');
      items.forEach((p) => {
        const folder = p.target instanceof TFolder;
        const row = this.row(list, folder ? 'folder' : 'file-text', folder ? p.target.name : p.target.basename, p.problem, p.target.path);
        onActivate(row, () => check.goTo(p));
      });
    });
  }

  row(parent, icon, name, problem, where) {
    const row = parent.createDiv({ cls: 'dr-report-row' });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    setIcon(row.createSpan({ cls: 'dr-report-icon' }), icon);
    const text = row.createDiv({ cls: 'dr-report-text' });
    text.createDiv({ cls: 'dr-report-name', text: name });
    text.createDiv({ cls: 'dr-report-problem', text: problem });
    if (where) row.createSpan({ cls: 'dr-report-where', text: where });
    return row;
  }
}

/* -- the inbox ----------------------------------------------------- */

class InboxScreen extends BrowseScreen {
  title() {
    return 'Inbox';
  }

  render(root) {
    const view = this.view;
    const check = this.plugin.feature(LibraryCheck);
    view.renderTitleBar(root, this.title());
    const notes = check && check.enabled ? check.unclassified().filter((f) => view.matches(f.basename)) : [];
    if (!view.inboxPicked) view.inboxPicked = new Set();
    const picked = view.inboxPicked;
    // Only what's still here can stay picked.
    Array.from(picked).forEach((p) => notes.some((f) => f.path === p) || picked.delete(p));
    if (!notes.length) {
      view.emptyState(root, 'Every note is in an album.', 'inbox');
      return;
    }
    root.createDiv({ cls: 'dr-report-lead', text: 'Notes in no album. Pick some, then move them into one, or show them in one where they are.' });
    const bar = root.createDiv({ cls: 'dr-inbox-bar' });
    const chosen = () => notes.filter((f) => picked.has(f.path));
    const all = view.action(bar, 'check-check', picked.size === notes.length ? 'Pick none' : 'Pick all', () => {
      if (picked.size === notes.length) picked.clear();
      else notes.forEach((f) => picked.add(f.path));
      view.render();
    });
    all.addClass('dr-inbox-all');
    const move = view.action(bar, 'folder-input', 'Move into an album…', () => check.moveInto(chosen(), () => picked.clear()));
    // Where each seems to belong, by its links and tags.
    const suggested = check.suggestions(notes);
    const placed = view.action(bar, 'wand-2', 'Put where suggested', async () => {
      const pairs = chosen().filter((f) => suggested.has(f)).map((f) => [f, suggested.get(f)]);
      if (await check.moveEach(pairs)) picked.clear();
    });
    placed.toggleClass('is-disabled', !chosen().some((f) => suggested.has(f)));
    const show = view.action(bar, 'link', 'Show in an album…', () => check.showIn(chosen(), () => picked.clear()));
    [move, show].forEach((b) => b.toggleClass('is-disabled', !picked.size));
    const structure = this.plugin.feature(AlbumStructure);
    if (!structure || !structure.enabled) show.remove();
    bar.createSpan({ cls: 'dr-inbox-count', text: picked.size ? `${picked.size} picked` : '' });

    const list = root.createDiv({ cls: 'dr-tracks dr-inbox' });
    roveFocus(list, '.dr-inbox-row');
    notes.forEach((file) => {
      const row = list.createDiv({ cls: 'dr-inbox-row' });
      row.dataset.path = file.path;
      row.setAttribute('tabindex', '0');
      const box = row.createEl('input', { type: 'checkbox' });
      box.checked = picked.has(file.path);
      box.setAttribute('aria-label', `Pick ${file.basename}`);
      box.addEventListener('change', () => {
        if (box.checked) picked.add(file.path);
        else picked.delete(file.path);
        view.render();
      });
      const name = row.createSpan({ cls: 'dr-inbox-name', text: file.basename });
      name.setAttribute('role', 'button');
      onActivate(name, (evt) => view.openFile(file, evt));
      const home = suggested.get(file);
      if (home) {
        const chip = row.createSpan({ cls: 'dr-inbox-suggest', text: `→ ${home.name}` });
        chip.setAttribute('role', 'button');
        chip.setAttribute('aria-label', `Move into ${home.name}, where it seems to belong`);
        onActivate(chip, (evt) => {
          evt.stopPropagation();
          check.moveEach([[file, home]]);
        });
      }
      row.createSpan({ cls: 'dr-inbox-when', text: view.relative(file.stat.mtime) });
      // Space picks the row, as a checkbox would.
      row.addEventListener('keydown', (evt) => {
        if (evt.key !== ' ' || evt.target !== row) return;
        evt.preventDefault();
        box.click();
      });
    });
  }
}

BROWSE_SCREENS['library-check'] = ReportScreen;
BROWSE_SCREENS.inbox = InboxScreen;

class LibraryCheck extends Feature {
  settingsSchema() {
    return [
      {
        key: 'libraryCheck',
        name: 'Look the library over',
        desc: 'A report of the library’s hierarchy, duplicates and overlaps, and coverage and balance: things to look at, not rules. Nothing is changed.',
      },
      {
        key: 'libraryInbox',
        showIf: 'libraryCheck',
        name: 'Inbox',
        desc: 'The notes in no album, in one place, to be moved into albums or shown in them a few at a time. Add it to the library from its layout, or open it from the report.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'library-check',
        name: 'Look the library over',
        icon: 'stethoscope',
        when: () => this.enabled,
        run: () => this.open('library-check'),
      },
      {
        id: 'library-inbox',
        name: 'Open the inbox: notes in no album',
        icon: 'inbox',
        when: () => this.enabled && this.settings.libraryInbox !== false,
        run: () => this.open('inbox'),
      },
    ];
  }

  open(mode) {
    const library = this.plugin.feature(Library);
    if (library) library.browseMode({ mode });
  }

  folders() {
    const out = [];
    const walk = (folder) =>
      (folder.children || []).forEach((c) => {
        if (!(c instanceof TFolder)) return;
        out.push(c);
        walk(c);
      });
    walk(this.app.vault.getRoot());
    return out;
  }

  isNote(f) {
    return f instanceof TFile && f.extension === 'md' && !this.plugin.isFolderNote(f);
  }

  /** Notes in no album: at the top of the vault, taken in by none; not the home note. */
  unclassified() {
    const structure = this.plugin.feature(AlbumStructure);
    const included = new Set();
    if (structure && structure.enabled) this.folders().forEach((f) => structure.info(f).includes.forEach((t) => included.add(t)));
    const home = String(this.settings.homePath || '');
    return (this.app.vault.getRoot().children || []).filter((c) => this.isNote(c) && c.path !== home && !included.has(c)).sort((a, b) => byName(a.basename, b.basename));
  }

  /** What there is to look at: [{ target, problem, kind, section }]. */
  problems() {
    const structure = this.plugin.feature(AlbumStructure);
    const shows = !!(structure && structure.enabled);
    const out = [];
    const add = (section, target, kind, problem) => out.push({ section, target, kind, problem });
    const folders = this.folders();
    const infos = new Map(folders.map((f) => [f, shows ? structure.info(f) : null]));
    const own = (f) => (f.children || []).filter((c) => this.isNote(c));
    const albums = folders.filter((f) => own(f).length);
    const shelves = folders.filter((f) => !own(f).length && (f.children || []).some((c) => c instanceof TFolder));
    const takenIn = new Set();
    infos.forEach((info) => info && info.includes.forEach((t) => takenIn.add(t)));

    // -- hierarchy
    folders.forEach((folder) => {
      const info = infos.get(folder);
      const inside = (f) => (f.children || []).some((c) => (c instanceof TFile && !this.plugin.isFolderNote(c)) || (c instanceof TFolder && inside(c)));
      if (!inside(folder) && !(info && info.includes.length)) add('hierarchy', folder, 'empty', 'Nothing in it');
      const depth = folder.path.split('/').length;
      if (depth > LIBRARY_DEEP) add('hierarchy', folder, 'deep', `Nested ${depth} folders deep`);
      if (!info) return;
      info.missing.forEach((m) => add('hierarchy', folder, 'missing', `Its ${m.key} name “${m.name}”, which isn’t there`));
      // Roles that pull against each other.
      info.includes.filter((t) => info.related.indexOf(t) !== -1).forEach((t) => add('hierarchy', folder, 'roles', `Takes in ${t.name || t.basename} and lists it as related too`));
      info.includes.filter((t) => t instanceof TFolder && folder.path.startsWith(t.path + '/')).forEach((t) => add('hierarchy', folder, 'roles', `Takes in ${t.name}, which it’s inside`));
    });
    // In no collection: at the top of the vault where others are kept in collections, and taken in by none.
    const topShelves = shelves.some((f) => f.parent && f.parent.isRoot && f.parent.isRoot());
    if (topShelves) {
      albums.filter((f) => f.parent && f.parent.isRoot && f.parent.isRoot() && !takenIn.has(f)).forEach((f) => add('hierarchy', f, 'orphan', 'In no collection, and taken in by no album'));
    }
    if (shows) {
      const takes = (f) => (infos.get(f) ? infos.get(f).includes.filter((t) => t instanceof TFolder) : []);
      folders.forEach((start) => {
        if (this.loops(start, takes)) add('hierarchy', start, 'loop', 'Takes in an album that takes it in');
      });
      // A note saying it's an album, without being a folder note.
      this.app.vault.getMarkdownFiles().forEach((f) => {
        if (this.plugin.isFolderNote(f)) return;
        const kind = valueList(fmGet(noteProps(this.app, f), ALBUM_KEYS.type))[0];
        // Only the kinds it knows: an album property can mean a record's album.
        if (kind && ALBUM_TYPES.some((t) => t.id === String(kind).toLowerCase())) add('hierarchy', f, 'roles', `Says it’s a ${kind} album, but isn’t a folder’s note`);
      });
    }
    // Notes whose parents lead round to themselves.
    const key = this.settings.graphRouteProperty || 'parent';
    const parentOf = (f) => {
      const v = valueList(fmGet(noteProps(this.app, f), key))[0];
      return v ? this.app.metadataCache.getFirstLinkpathDest(plainValue(v), f.path) : null;
    };
    this.app.vault.getMarkdownFiles().forEach((f) => {
      if (this.loops(f, (n) => [parentOf(n)].filter(Boolean))) add('hierarchy', f, 'parents', `Its ${key} leads back round to it`);
    });

    // -- duplicates and overlaps
    const named = new Map();
    folders.forEach((f) => named.set(f.name.toLowerCase(), (named.get(f.name.toLowerCase()) || []).concat(f)));
    named.forEach((same) => {
      if (same.length > 1) same.forEach((f) => add('overlap', f, 'twice', `Shares its name with ${same.filter((o) => o !== f).map((o) => o.path).join(', ')}`));
    });
    const covers = new Map();
    folders.forEach((f) => {
      const src = this.plugin.folderCoverSrc(f);
      if (src) covers.set(src, (covers.get(src) || []).concat(f));
    });
    covers.forEach((same) => {
      if (same.length > 1) same.forEach((f) => add('overlap', f, 'cover', `Has the same cover as ${same.filter((o) => o !== f).map((o) => o.name).join(', ')}`));
    });
    if (shows) {
      folders.forEach((folder) => {
        const info = infos.get(folder);
        const note = info.note;
        if (!note) return;
        const fm = noteProps(this.app, note);
        [ALBUM_KEYS.includes, ALBUM_KEYS.related, ALBUM_KEYS.featured].forEach((k) => {
          const seen = new Set();
          valueList(fmGet(fm, k)).forEach((v) => {
            const t = this.app.metadataCache.getFirstLinkpathDest(plainValue(v), note.path);
            if (!t) return;
            if (seen.has(t)) add('overlap', folder, 'listed', `Lists ${t.basename} twice in its ${k}`);
            seen.add(t);
          });
        });
      });
      // Albums sharing most of their notes, by what they hold and take in.
      const members = new Map(albums.concat(folders.filter((f) => infos.get(f).includes.length)).map((f) => [f, new Set(own(f).concat(infos.get(f).includes.filter((t) => t instanceof TFile)))]));
      const list = Array.from(members.keys());
      list.forEach((a, i) =>
        list.slice(i + 1).forEach((b) => {
          const A = members.get(a);
          const B = members.get(b);
          const shared = Array.from(A).filter((n) => B.has(n)).length;
          if (shared >= OVERLAP_NOTES && shared / Math.min(A.size, B.size) >= OVERLAP_SHARE) add('overlap', a, 'overlap', `Shares ${shared} notes with ${b.name}`);
        })
      );
    }

    // -- relationships between notes, as they hold them
    const knowledge = typeof Knowledge === 'function' ? this.plugin.feature(Knowledge) : null;
    if (knowledge && knowledge.enabled) knowledge.problems().forEach((p) => add('relations', p.target, p.kind, p.problem));

    // -- coverage and balance
    folders.forEach((folder) => {
      const info = infos.get(folder);
      if (!info || !own(folder).length) return;
      if (!info.description) add('coverage', folder, 'about', 'No description');
      if (info.type === 'subject' && !info.featured.length) add('coverage', folder, 'start', 'A subject with no notes to start with');
    });
    const usual = middleOf(albums.map((f) => own(f).length));
    albums.forEach((f) => {
      const n = own(f).length;
      if (n >= BALANCE_NOTES && n > usual * BALANCE_TIMES) add('coverage', f, 'large', `Holds ${n} notes; most albums hold ${usual}`);
    });
    const sizeOf = (f) => (f.children || []).filter((c) => c instanceof TFolder).length;
    const usualShelf = middleOf(shelves.map(sizeOf));
    shelves.forEach((f) => {
      const n = sizeOf(f);
      if (n >= BALANCE_ALBUMS && n > usualShelf * BALANCE_TIMES) add('coverage', f, 'large', `Holds ${n} albums; most collections hold ${usualShelf}`);
    });
    return out;
  }

  /** Whether following `next` from `start` comes back round to it. */
  loops(start, next) {
    const seen = new Set();
    const stack = next(start).slice();
    while (stack.length) {
      const f = stack.pop();
      if (f === start) return true;
      if (seen.has(f)) continue;
      seen.add(f);
      stack.push(...next(f));
    }
    return false;
  }

  /** An album opened; a note in no album, to the inbox; anything else, opened. */
  goTo(p) {
    if (p.target instanceof TFolder) {
      const library = this.plugin.feature(Library);
      if (library) library.browseMode({ mode: 'folder', path: p.target.path });
      return;
    }
    this.app.workspace.getLeaf(false).openFile(p.target);
  }

  /**
   * Where notes in no album seem to belong: the album whose notes they
   * link with most, either way, with a nudge for a tag or property
   * naming it. Those with nothing to go on are left out.
   */
  suggestions(notes) {
    const structure = this.plugin.feature(AlbumStructure);
    const albumOf = new Map();
    this.folders().forEach((f) => {
      (f.children || []).forEach((c) => this.isNote(c) && albumOf.set(c.path, f));
      if (structure && structure.enabled) structure.info(f).includes.forEach((t) => t instanceof TFile && !albumOf.has(t.path) && albumOf.set(t.path, f));
    });
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const linksTo = new Map();
    Object.keys(resolved).forEach((from) => Object.keys(resolved[from] || {}).forEach((to) => linksTo.set(to, (linksTo.get(to) || []).concat([[from, resolved[from][to]]]))));
    const slug = (s) => String(s).toLowerCase().replace(/\s+/g, '-');
    const out = new Map();
    notes.forEach((file) => {
      const score = new Map();
      const add = (folder, n) => folder && score.set(folder, (score.get(folder) || 0) + n);
      Object.entries(resolved[file.path] || {}).forEach(([to, n]) => add(albumOf.get(to), n));
      (linksTo.get(file.path) || []).forEach(([from, n]) => add(albumOf.get(from), n));
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = noteTags(cache);
      const values = Object.values((cache && cache.frontmatter) || {}).reduce((acc, v) => acc.concat(valueList(v).map((x) => slug(plainValue(x)))), []);
      new Set(albumOf.values()).forEach((folder) => {
        const name = slug(folder.name);
        if (tags.some((t) => t === name || t.endsWith('/' + name))) add(folder, 2);
        if (values.indexOf(name) !== -1) add(folder, 2);
      });
      let best = null;
      score.forEach((n, folder) => {
        if (!best || n > best[1] || (n === best[1] && byName(folder.name, best[0].name) < 0)) best = [folder, n];
      });
      if (best) out.set(file, best[0]);
    });
    return out;
  }

  /** Each note moved into its own album, as one step of Undo. */
  async moveEach(pairs) {
    const moved = [];
    for (const [file, folder] of pairs) {
      const from = await this.plugin.moveFile(file, folder.path);
      if (from) moved.push([file, from]);
    }
    this.plugin.refreshBrowse();
    if (!moved.length) return false;
    this.plugin.offerUndo(`Moved ${moved.length} ${moved.length === 1 ? 'note' : 'notes'} where ${moved.length === 1 ? 'it seemed' : 'they seemed'} to belong.`, async () => {
      for (const [file, from] of moved.slice().reverse()) await this.plugin.putBack(file, from);
      this.plugin.refreshBrowse();
    });
    return true;
  }

  /** The notes moved into an album chosen from a list. */
  moveInto(files, done) {
    if (!files.length) return;
    new FolderPicker(this.app, async (folder) => {
      if ((await this.moveFilesInto(files, folder)) && done) done();
    }, { placeholder: `Move ${files.length} ${files.length === 1 ? 'note' : 'notes'} into which album?` }).open();
  }

  /** The notes moved into an album, as one step of Undo. */
  async moveFilesInto(files, folder) {
    const moved = [];
    for (const file of files) {
      const from = await this.plugin.moveFile(file, folder.path);
      if (from) moved.push([file, from]);
    }
    this.plugin.refreshBrowse();
    if (!moved.length) return false;
    this.plugin.offerUndo(`Moved ${moved.length} ${moved.length === 1 ? 'note' : 'notes'} into ${folder.name}.`, async () => {
      for (const [file, from] of moved.slice().reverse()) await this.plugin.putBack(file, from);
      this.plugin.refreshBrowse();
    });
    return true;
  }

  /** The notes shown in an album chosen from a list. */
  showIn(files, done) {
    if (!files.length) return;
    new FolderPicker(this.app, async (folder) => {
      if ((await this.showFilesIn(files, folder)) && done) done();
    }, { placeholder: `Show ${files.length} ${files.length === 1 ? 'note' : 'notes'} in which album?` }).open();
  }

  /** The notes listed in an album's includes, where they are, as one step of Undo. */
  async showFilesIn(files, folder) {
    const structure = this.plugin.feature(AlbumStructure);
    if (!files.length || !structure || !structure.enabled) return false;
    {
      const note = this.plugin.folderNote(folder);
      const before = valueList(fmGet(noteProps(this.app, note), ALBUM_KEYS.includes));
      const from = note ? note.path : `${folder.path}/x.md`;
      const have = structure.info(folder).includes;
      const added = files.filter((f) => have.indexOf(f) === -1).map((f) => `[[${this.app.metadataCache.fileToLinktext(f, from, true)}]]`);
      if (!added.length || !(await structure.setProperty(folder, ALBUM_KEYS.includes, before.concat(added)))) return false;
      this.plugin.refreshBrowse();
      this.plugin.offerUndo(`${added.length} ${added.length === 1 ? 'note shows' : 'notes show'} in ${folder.name} now, where ${added.length === 1 ? 'it is' : 'they are'}.`, async () => {
        await structure.setProperty(folder, ALBUM_KEYS.includes, before);
        this.plugin.refreshBrowse();
      });
      return true;
    }
  }
}

LibraryCheck.settingKey = 'libraryCheck';
