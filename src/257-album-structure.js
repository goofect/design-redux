/* ------------------------------------------------------------------ */
/* What an album is                                                    */
/*                                                                     */
/* A folder is where notes are kept; an album can also say what it is  */
/* and what belongs to it, wherever that's kept. All in the folder     */
/* note's own properties, so it's plain to read and stays put with the */
/* plugin off:                                                         */
/*   album: subject, concept map, project, reading list, reference or  */
/*     index — shown above its title, and each changes the album a     */
/*     little: progress for a project or reading list, a Map for a     */
/*     concept map, an index's albums as tiles;                        */
/*   description: what it's for, shown under its title;               */
/*   includes: notes from elsewhere that belong to it too — shown in   */
/*     it, not moved or copied;                                        */
/*   related: albums beside it, not above or below;                    */
/*   featured: notes to start with, at the top of the album;           */
/*   layout: how it opens — its notes as a list or as covers, the      */
/*     folder note's text first as an overview, or its canvas map.     */
/* And an album's page shows the way down to it from the top.          */
/* ------------------------------------------------------------------ */

/* The folder note properties an album is read from; each can be given another name in settings, so none has to clash with your own. */
const ALBUM_KEY_DEFAULTS = { type: 'album', description: 'description', includes: 'includes', related: 'related', featured: 'featured', layout: 'layout' };
const ALBUM_KEY_LABELS = { type: 'Kind', description: 'Description', includes: 'Notes and albums it takes in', related: 'Related albums', featured: 'Notes to start with', layout: 'How it opens' };
const ALBUM_KEYS = Object.assign({}, ALBUM_KEY_DEFAULTS);

/** The names set in settings, or the usual ones. */
function applyAlbumKeys(names) {
  Object.keys(ALBUM_KEY_DEFAULTS).forEach((k) => {
    const own = names && typeof names[k] === 'string' ? names[k].trim() : '';
    ALBUM_KEYS[k] = own || ALBUM_KEY_DEFAULTS[k];
  });
}

const ALBUM_LAYOUTS = [
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'covers', label: 'Covers', icon: 'layout-grid' },
  { id: 'table', label: 'Table', icon: 'table' },
  { id: 'overview', label: 'Overview', icon: 'file-text' },
  { id: 'map', label: 'Map', icon: 'waypoints' },
];

/* Each kind's symbol, and its colour where covers are coloured by kind: muted, so colour means kind and no more. */
const ALBUM_TYPES = [
  { id: 'subject', label: 'Subject', icon: 'book', color: '#4f6d8f' },
  { id: 'concept map', label: 'Concept map', icon: 'waypoints', color: '#7a5c8e' },
  { id: 'project', label: 'Project', icon: 'target', color: '#b0703a' },
  { id: 'reading list', label: 'Reading list', icon: 'library', color: '#5e7f5a' },
  { id: 'reference', label: 'Reference', icon: 'bookmark', color: '#4d7f80' },
  { id: 'index', label: 'Index', icon: 'list', color: '#8a6f52' },
];

/* An album of no kind, where covers are coloured by kind. */
const ALBUM_KIND_NEUTRAL = '#7d7770';

/* What makes a note a source: properties it has, or its type or tags. */
const SOURCE_KEYS = ['author', 'authors', 'url', 'source', 'isbn', 'doi', 'publisher'];
const SOURCE_KINDS = ['source', 'book', 'article', 'paper', 'reading'];

/* What marks a note as an open question: its status or a tag. */
const OPEN_VALUES = ['open', 'question', 'unanswered', 'unresolved', 'gap'];

/* What counts as finished, for a project's notes and a reading list's. */
const DONE_VALUES = ['done', 'complete', 'completed', 'finished', 'read'];

/** A property's values as a list of strings, whether written as one or many. */
function valueList(raw) {
  return (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => String(v).trim());
}

class AlbumStructure extends Feature {
  /** Every settings save: the property names, as set. Safe to run again. */
  enable() {
    applyAlbumKeys(this.settings.albumKeyNames);
  }

  disable() {
    applyAlbumKeys(null);
  }

  settingsSchema() {
    return [
      {
        key: 'albumKeyNames',
        type: 'custom',
        showIf: 'albumStructure',
        name: 'Album property names',
        render: (containerEl) => this.renderKeyNames(containerEl),
      },
      {
        key: 'albumStructure',
        name: 'Albums say what they are',
        desc: 'A folder note’s album, description, includes, related, featured and layout properties: its kind above its title, what it’s for, notes from elsewhere shown in it, albums beside it, notes to start with, and whether it opens as a list, covers, an overview or its map. An album’s page shows the way down to it.',
      },
      {
        key: 'albumRecents',
        showIf: 'albumStructure',
        name: 'Lately, in long albums',
        desc: `An album of ${ALBUM_RECENTS_FROM} notes or more shows what changed and what was opened lately, apart from its own order.`,
      },
    ];
  }

  actions() {
    return [
      { id: 'album-set-type', name: 'Set what kind of album this is…', icon: 'shapes', when: () => this.enabled && !!this.currentFolder(), run: () => this.chooseType(this.currentFolder()) },
      { id: 'album-include-note', name: 'Show this note in another album too…', icon: 'folder-input', on: 'note', menu: false, when: () => this.enabled, run: (ctx) => this.chooseAlbumFor(ctx.file) },
    ];
  }

  /** The album on screen in the browse view, or the open note's folder. */
  currentFolder() {
    const view = this.app.workspace.getActiveViewOfType(BrowseView);
    if (view && view.mode === 'folder') {
      const folder = view.folder();
      return folder && !(folder.isRoot && folder.isRoot()) ? folder : null;
    }
    const note = this.pageNote();
    return note && note.parent && !(note.parent.isRoot && note.parent.isRoot()) ? note.parent : null;
  }

  pageNote() {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === 'md' ? file : null;
  }

  /** What a folder note says of its album: { type, label, description, includes, related, note }. */
  info(folder) {
    const empty = { type: '', label: '', description: '', includes: [], related: [], featured: [], layout: 'list', layoutGiven: false, missing: [], note: null };
    if (!this.enabled || !folder || (folder.isRoot && folder.isRoot())) return empty;
    const note = this.plugin.folderNote(folder);
    if (!note) return empty;
    const cache = this.app.metadataCache.getFileCache(note);
    const fm = (cache && cache.frontmatter) || {};
    const type = String(valueList(fmGet(fm, ALBUM_KEYS.type))[0] || '').toLowerCase();
    const known = ALBUM_TYPES.find((t) => t.id === type);
    const missing = [];
    const links = (key) => {
      const out = [];
      valueList(fmGet(fm, key)).forEach((v) => {
        const file = this.app.metadataCache.getFirstLinkpathDest(plainValue(v), note.path);
        if (!file) missing.push({ key, name: plainValue(v) });
        // A folder note stands for its folder.
        const target = file && this.plugin.isFolderNote(file) && file.parent ? file.parent : file;
        if (target && target !== folder && target !== note && out.indexOf(target) === -1) out.push(target);
      });
      return out;
    };
    return {
      type,
      label: known ? known.label : type ? type.charAt(0).toUpperCase() + type.slice(1) : '',
      description: valueList(fmGet(fm, ALBUM_KEYS.description)).join(' '),
      includes: links(ALBUM_KEYS.includes),
      related: links(ALBUM_KEYS.related),
      featured: links(ALBUM_KEYS.featured).filter((t) => t instanceof TFile),
      layout: (ALBUM_LAYOUTS.find((l) => l.id === String(valueList(fmGet(fm, ALBUM_KEYS.layout))[0] || '').toLowerCase()) || ALBUM_LAYOUTS[0]).id,
      // Whether it says, rather than opening as albums usually do.
      layoutGiven: !!ALBUM_LAYOUTS.find((l) => l.id === String(valueList(fmGet(fm, ALBUM_KEYS.layout))[0] || '').toLowerCase()),
      // Names its includes, related and featured give that lead nowhere.
      missing,
      note,
    };
  }

  /**
   * The settings' property names, one row each, with a way to carry
   * values already written under the old names over to the new.
   */
  renderKeyNames(containerEl) {
    const doc = containerEl.ownerDocument;
    const block = containerEl.appendChild(doc.createElement('div'));
    block.className = 'dr-album-keys';
    const names = Object.assign({}, this.settings.albumKeyNames || {});
    new Setting(block)
      .setName('Album property names')
      .setDesc('The folder note properties an album is read from. Give any another name where it would clash with one of yours; the usual name is used where left empty.')
      .setHeading();
    Object.keys(ALBUM_KEY_DEFAULTS).forEach((k) => {
      new Setting(block).setName(ALBUM_KEY_LABELS[k]).addText((t) =>
        t
          .setPlaceholder(ALBUM_KEY_DEFAULTS[k])
          .setValue(names[k] || '')
          .onChange((v) => {
            names[k] = v.trim();
            this.settings.albumKeyNames = Object.assign({}, names);
            this.plugin.saveSettings();
          })
      );
    });
    new Setting(block)
      .setDesc('Values written under other names before stay there until carried over.')
      .addButton((b) => b.setButtonText('Carry values over to these names').onClick(() => this.carryKeys()));
    return block;
  }

  /** Every folder note's values under any earlier name moved to the name now set, as one step of Undo. */
  async carryKeys() {
    const notes = this.app.vault.getMarkdownFiles().filter((f) => this.plugin.isFolderNote(f));
    const changes = [];
    for (const note of notes) {
      const cache = this.app.metadataCache.getFileCache(note);
      const fm = (cache && cache.frontmatter) || {};
      const moves = Object.keys(ALBUM_KEY_DEFAULTS)
        .map((k) => [ALBUM_KEY_DEFAULTS[k], ALBUM_KEYS[k]])
        .filter(([from, to]) => from !== to && fmGet(fm, from) !== undefined && fmGet(fm, to) === undefined);
      if (!moves.length) continue;
      await this.app.fileManager.processFrontMatter(note, (data) => {
        moves.forEach(([from, to]) => {
          data[to] = data[from];
          delete data[from];
        });
      });
      changes.push([note, moves]);
    }
    if (!changes.length) {
      new Notice('Nothing to carry over: every value is under the names set.');
      return 0;
    }
    this.plugin.offerUndo(`Carried values over in ${changes.length} folder ${changes.length === 1 ? 'note' : 'notes'}.`, async () => {
      for (const [note, moves] of changes) {
        await this.app.fileManager.processFrontMatter(note, (data) => {
          moves.forEach(([from, to]) => {
            data[from] = data[to];
            delete data[to];
          });
        });
      }
    });
    return changes.length;
  }

  /**
   * Notes elsewhere tied to the album's by links, either way: what it
   * means beside where it's kept. Most linked first; not those already in it.
   */
  linked(folder, files) {
    const inAlbum = new Set(files.map((f) => f.path));
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const counts = new Map();
    const bump = (path, n) => {
      if (inAlbum.has(path) || this.plugin.isFolderNote(this.app.vault.getFileByPath(path) || {})) return;
      counts.set(path, (counts.get(path) || 0) + n);
    };
    Object.keys(resolved).forEach((from) => {
      const out = resolved[from] || {};
      Object.keys(out).forEach((to) => {
        if (inAlbum.has(from) && !inAlbum.has(to)) bump(to, out[to]);
        else if (inAlbum.has(to) && !inAlbum.has(from)) bump(from, out[to]);
      });
    });
    return Array.from(counts.entries())
      .map(([path, count]) => ({ file: this.app.vault.getFileByPath(path), count }))
      .filter((x) => x.file && x.file.extension === 'md')
      .sort((a, b) => b.count - a.count || byName(a.file.basename, b.file.basename))
      .slice(0, 40);
  }

  /** Above a collection's albums: that it's a collection — or the library itself — the way down, what it's for, how many. */
  renderCollectionHead(root, folder, view, count) {
    const top = !!(folder.isRoot && folder.isRoot());
    const info = this.info(folder);
    const head = root.createDiv({ cls: 'dr-collection-head' });
    const kicker = head.createDiv({ cls: 'dr-detail-kicker' });
    kicker.createSpan({ cls: 'dr-detail-kind', text: top ? 'Library' : info.label || 'Collection' });
    const trail = top ? [] : this.trail(folder);
    if (trail.length) {
      const crumbs = kicker.createEl('nav', { cls: 'dr-crumbs', attr: { 'aria-label': 'Where this collection is' } });
      trail.forEach((f, i) => {
        if (i) crumbs.createSpan({ cls: 'dr-crumb-sep', text: '›' });
        const crumb = crumbs.createSpan({ cls: 'dr-crumb', text: f.name });
        crumb.setAttribute('role', 'button');
        crumb.setAttribute('tabindex', '0');
        onActivate(crumb, () => view.openFolder(f));
      });
    }
    head.createDiv({ cls: 'dr-detail-meta', text: count === 1 ? '1 album' : `${count} albums` });
    if (info.description) head.createDiv({ cls: 'dr-detail-desc', text: info.description });
    return head;
  }

  /** Notes from elsewhere that belong to the album too, less any already in it. */
  included(folder, already) {
    const have = new Set(already || []);
    return this.info(folder).includes.filter((t) => t instanceof TFile && !have.has(t));
  }

  /** The folders above an album, from the top down; not the vault itself. */
  trail(folder) {
    const out = [];
    for (let p = folder && folder.parent; p && !(p.isRoot && p.isRoot()); p = p.parent) out.unshift(p);
    return out;
  }

  /** How far along a project or reading list is: { done, total, word }, or null. */
  progress(info, files) {
    if (info.type !== 'project' && info.type !== 'reading list') return null;
    const notes = files.filter((f) => f.extension === 'md');
    if (!notes.length) return null;
    const done = notes.filter((f) => {
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = (cache && cache.frontmatter) || {};
      if (fmGet(fm, 'done') === true) return true;
      return valueList(fmGet(fm, 'status')).some((v) => DONE_VALUES.indexOf(v.toLowerCase()) !== -1);
    }).length;
    return { done, total: notes.length, word: info.type === 'project' ? 'done' : 'read' };
  }

  /** A concept map's canvas: one named for the album, or the first in it; made from the album if none. */
  /** An album's canvas: the one named for it, or the first in it. */
  mapOf(folder) {
    const canvases = (folder.children || []).filter((c) => c instanceof TFile && c.extension === 'canvas');
    return canvases.find((c) => c.basename.toLowerCase() === `${folder.name} map`.toLowerCase()) || canvases[0] || null;
  }

  async openMap(folder) {
    const existing = this.mapOf(folder);
    if (existing) {
      await this.app.workspace.getLeaf(false).openFile(existing);
      return existing;
    }
    const mapper = typeof CanvasVaultMap === 'function' ? this.plugin.feature(CanvasVaultMap) : null;
    if (mapper && mapper.enabled) return mapper.mapFolder(folder);
    return this.plugin.newCanvas(folder);
  }

  /** One of the folder note's properties set — the note made if there's none — or, given '', removed. */
  async setProperty(folder, key, value) {
    try {
      const note = await this.plugin.ensureFolderNote(folder);
      await this.app.fileManager.processFrontMatter(note, (fm) => {
        const name = Object.keys(fm).find((k) => k.toLowerCase() === key.toLowerCase()) || key;
        if (value === '' || value === null || (Array.isArray(value) && !value.length)) delete fm[name];
        else fm[name] = value;
      });
      return true;
    } catch (err) {
      console.error('Design Redux: could not change the album', err);
      new Notice('Could not change the album.');
      return false;
    }
  }

  setType(folder, type) {
    return this.setProperty(folder, ALBUM_KEYS.type, type || '');
  }

  chooseType(folder) {
    if (!folder) return;
    const now = this.info(folder).type;
    const items = ALBUM_TYPES.map((t) => ({ label: t.label, note: t.id === now ? 'Now' : '', id: t.id }));
    if (now) items.push({ label: 'None', note: '', id: '' });
    new ComparePicker(this.app, items, `What kind of album is ${folder.name}?`, (item) => this.setType(folder, item.id)).open();
  }

  /** The note listed in another album's includes; it stays where it is. */
  chooseAlbumFor(file) {
    if (!file) return;
    new FolderPicker(
      this.app,
      (folder) => this.include(folder, file),
      { placeholder: `Show ${file.basename} in which album too?` }
    ).open();
  }

  async include(folder, file) {
    const note = this.plugin.folderNote(folder);
    const from = note ? note.path : `${folder.path}/x.md`;
    const link = `[[${this.app.metadataCache.fileToLinktext(file, from, true)}]]`;
    const cache = note ? this.app.metadataCache.getFileCache(note) : null;
    const list = valueList(fmGet((cache && cache.frontmatter) || {}, ALBUM_KEYS.includes));
    if (this.info(folder).includes.indexOf(file) !== -1) {
      new Notice(`${file.basename} is in ${folder.name} already.`);
      return false;
    }
    const ok = await this.setProperty(folder, ALBUM_KEYS.includes, list.concat(link));
    if (ok) new Notice(`${file.basename} shows in ${folder.name} now, and stays where it is.`);
    return ok;
  }

  setLayout(folder, layout) {
    return this.setProperty(folder, ALBUM_KEYS.layout, layout === 'list' ? '' : layout);
  }

  /** A note kept at the top of an album, or no longer: in its featured, by link. */
  async toggleFeatured(folder, file) {
    const note = this.plugin.folderNote(folder);
    const cache = note ? this.app.metadataCache.getFileCache(note) : null;
    const list = valueList(fmGet((cache && cache.frontmatter) || {}, ALBUM_KEYS.featured));
    const from = note ? note.path : `${folder.path}/x.md`;
    const kept = list.filter((v) => this.app.metadataCache.getFirstLinkpathDest(plainValue(v), from) !== file);
    if (kept.length === list.length) kept.push(`[[${this.app.metadataCache.fileToLinktext(file, from, true)}]]`);
    return this.setProperty(folder, ALBUM_KEYS.featured, kept);
  }

  /**
   * Under the album's title, as its layout asks: the folder note's own
   * text, or its canvas, drawn by Obsidian as an embed would be.
   */
  renderLead(root, folder, info, view, which = info.layout) {
    if (which !== 'overview' && which !== 'map') return null;
    const box = root.createDiv({ cls: `dr-album-lead is-${which} markdown-rendered` });
    const source = info.note ? info.note.path : folder.path;
    const draw = (markdown) => {
      try {
        if (typeof MarkdownRenderer.render === 'function') MarkdownRenderer.render(this.app, markdown, box, source, view);
        else MarkdownRenderer.renderMarkdown(markdown, box, source, view);
      } catch (err) {
        box.setText(markdown);
      }
    };
    if (which === 'map') {
      const map = this.mapOf(folder);
      if (map) {
        // Drawn by Obsidian as a picture of the map; pressed, the map opens.
        draw(`![[${map.path}]]`);
        box.addClass('is-linked');
        box.setAttribute('aria-label', `Open ${map.basename}`);
        box.addEventListener('click', (evt) => {
          evt.preventDefault();
          this.app.workspace.getLeaf(false).openFile(map);
        });
      }
      else {
        const make = box.createDiv({ cls: 'dr-album-lead-empty', text: 'No map yet — make one' });
        make.setAttribute('role', 'button');
        make.setAttribute('tabindex', '0');
        onActivate(make, () => this.openMap(folder));
      }
      return box;
    }
    if (!info.note) return box;
    this.app.vault.cachedRead(info.note).then((text) => {
      // The text without its properties, which the header has already said.
      const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
      if (body) draw(body);
      else box.remove();
    }, () => box.remove());
    return box;
  }

  /** Whether the folder note has text of its own, past its properties. Unknown counts as yes. */
  hasOverview(info) {
    if (!info.note) return false;
    const cache = this.app.metadataCache.getFileCache(info.note);
    if (!cache || !Array.isArray(cache.sections)) return true;
    return cache.sections.some((s) => s.type !== 'yaml');
  }

  /** Which panel an album opens to: as its layout says. */
  defaultPanel(info) {
    return info.layout === 'overview' || info.layout === 'map' ? info.layout : 'notes';
  }

  /** Notes that are sources: books, articles — anything with an author, a link or a source of its own. */
  sources(files) {
    return files.filter((f) => {
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = (cache && cache.frontmatter) || {};
      if (SOURCE_KEYS.some((k) => valueList(fmGet(fm, k)).length)) return true;
      if (valueList(fmGet(fm, 'type')).some((v) => SOURCE_KINDS.indexOf(v.toLowerCase()) !== -1)) return true;
      return noteTags(cache).some((t) => SOURCE_KINDS.indexOf(t) !== -1);
    });
  }

  /**
   * What the album hasn't got yet: notes its notes link to that aren't
   * written — each with how many link to it — and notes marked as open
   * questions.
   */
  gaps(files) {
    const unresolved = this.app.metadataCache.unresolvedLinks || {};
    const named = new Map();
    files.forEach((f) => {
      Object.keys(unresolved[f.path] || {}).forEach((name) => {
        const was = named.get(name);
        named.set(name, { name, from: was ? was.from : f, count: (was ? was.count : 0) + 1 });
      });
    });
    const open = files.filter((f) => {
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = (cache && cache.frontmatter) || {};
      if (valueList(fmGet(fm, 'status')).some((v) => OPEN_VALUES.indexOf(v.toLowerCase()) !== -1)) return true;
      return noteTags(cache).some((t) => OPEN_VALUES.indexOf(t) !== -1);
    });
    const unwritten = Array.from(named.values()).sort((a, b) => b.count - a.count || byName(a.name, b.name));
    return { unwritten, open };
  }

  /** On a note's menu: kept at the top of its album, or not. */
  addFileItems(menu, file, sectioned, redraw) {
    const folder = file && file.parent;
    if (!this.enabled || !folder || (folder.isRoot && folder.isRoot()) || this.plugin.isFolderNote(file)) return;
    const on = this.info(folder).featured.indexOf(file) !== -1;
    menu.addItem((item) =>
      sectioned(item, 'action')
        .setTitle(on ? `Don’t keep at the top of ${folder.name}` : `Keep at the top of ${folder.name}`)
        .setIcon(on ? 'pin-off' : 'arrow-up-to-line')
        .onClick(async () => {
          if (await this.toggleFeatured(folder, file)) redraw();
        })
    );
  }

  /** On a folder's menu: what kind of album it is, and how it opens. */
  addFolderItems(menu, folder, sectioned, redraw) {
    if (!this.enabled || !folder || (folder.isRoot && folder.isRoot())) return;
    const info = this.info(folder);
    const now = info.type;
    menuGroup(
      menu,
      'Album layout',
      'layout-grid',
      (m, nested) => {
        if (!nested) m = { addItem: (fn) => menu.addItem((item) => fn(sectioned(item, 'action'))) };
        ALBUM_LAYOUTS.forEach((l) =>
          m.addItem((item) =>
            item
              .setTitle(nested ? l.label : `Layout: ${l.label}`)
              .setIcon(l.icon)
              .setChecked(info.layout === l.id)
              .onClick(async () => {
                if (await this.setLayout(folder, l.id)) redraw();
              })
          )
        );
      },
      'action'
    );
    menuGroup(
      menu,
      'Kind of album',
      'shapes',
      (m, nested) => {
        if (!nested) m = { addItem: (fn) => menu.addItem((item) => fn(sectioned(item, 'action'))) };
        ALBUM_TYPES.forEach((t) =>
          m.addItem((item) =>
            item
              .setTitle(nested ? t.label : `Album: ${t.label}`)
              .setIcon(t.icon)
              .setChecked(now === t.id)
              .onClick(async () => {
                if (await this.setType(folder, now === t.id ? '' : t.id)) redraw();
              })
          )
        );
      },
      'action'
    );
  }
}

AlbumStructure.settingKey = 'albumStructure';
