/* ------------------------------------------------------------------ */
/* Browse screens: search                                             */
/*                                                                    */
/* Search across the library, grouped as Apple Music groups it: a top */
/* result, then collections, notes and properties, each with See All. */
/* ------------------------------------------------------------------ */

import { Menu, Notice, setIcon, TFolder } from 'obsidian';
import { TAG_KEYS, TYPE_ICONS } from '../core/020-constants.js';
import { drawFolderArt, drawNoteArt, onContextMenu, showMenuAt } from '../core/030-helpers-art.js';
import { asButton, collapseSearches, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { rankNote, searchWords, textExcerpt } from '../core/048-search-rank.js';
import { noteProps } from '../core/073-notes.js';
import { libraryIndex } from '../core/077-library-index.js';
import { BrowseScreen } from './108-browse-screen.js';
import { collectionTiles, TEXT_MOST, TEXT_PAUSE, tileGrid, valueArt } from './110-browse-screens.js';

export class SearchScreen extends BrowseScreen {
  title() {
    return 'Search';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    const q = view.query.trim().toLowerCase();
    if (!q) return this.renderIdle(root);
    this.renderResults(root, q);
  }

  /* -- nothing typed yet ------------------------------------------ */

  /**
   * A screen in its own right rather than an empty box, as a music
   * app's Search tab is: what you looked for last, as a short list, and
   * the categories to browse, as tiles.
   */
  renderIdle(root) {
    const recents = collapseSearches(this.settings.recentSearches).slice(0, 6);

    if (recents.length) {
      const head = this.heading(root, 'Recently Searched');
      const clear = head.createDiv({ cls: 'dr-search-clear' });
      asButton(clear);
      clear.setText('Clear');
      onActivate(clear, async () => {
        this.settings.recentSearches = [];
        await this.plugin.saveData(this.settings);
        this.view.render();
      });

      const list = root.createDiv({ cls: 'dr-recent-list' });
      roveFocus(list, '.dr-recent');
      recents.forEach((term) => this.recentCard(list, term));
    }

    // The categories lead: the screen's main thing, as a music app's genres are.
    const categories = this.categories();
    const head = this.heading(root, 'Browse Categories');
    this.categoryChoice(head);
    if (categories.length) {
      const grid = root.createDiv({ cls: 'dr-cat-grid' });
      roveFocus(grid, '.dr-cat');
      categories.forEach((cat) => this.categoryCard(grid, cat));
      return;
    }

    // No property to draw them from yet: the ways into the vault instead.
    const ways = root.createDiv({ cls: 'dr-browse-by' });
    roveFocus(ways, '.dr-browse-by-item');
    [
      ['Collections', 'library', { mode: 'folders', path: '/' }],
      ['Properties', 'list', { mode: 'properties', property: null }],
      ['Tags', 'tag', { mode: 'properties', property: 'tags' }],
    ].forEach(([label, icon, state]) => {
      const item = ways.createDiv({ cls: 'dr-browse-by-item' });
      asButton(item);
      setIcon(item.createSpan({ cls: 'dr-browse-by-icon' }), icon);
      item.createSpan({ text: label });
      onActivate(item, () => this.view.navigate(state));
    });
  }

  /** Beside Browse Categories: which property they come from, and a menu to choose another. */
  categoryChoice(head) {
    const key = this.settings.categoryProperty || '';
    const pick = head.createDiv({ cls: 'dr-search-sort dr-cat-choice' });
    asButton(pick, 'Which property the categories come from');
    pick.createSpan({ text: key ? this.plugin.propertyLabel(key) : 'Choose a property' });
    setIcon(pick.createSpan({ cls: 'dr-search-sort-icon' }), 'chevron-down');
    onActivate(pick, (evt) => {
      const menu = new Menu();
      const props = this.view
        .propertyList()
        .filter((p) => TAG_KEYS.indexOf(p.key) === -1 && ['text', 'multitext', 'tags'].indexOf(p.type) !== -1)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
      props.forEach((p) =>
        menu.addItem((item) =>
          item
            .setTitle(p.name)
            .setChecked(p.key === String(key).toLowerCase())
            .setSection('action')
            .onClick(() => this.setCategories(p.name))
        )
      );
      if (key) menu.addItem((item) => item.setTitle('None').setIcon('x').setSection('remove').onClick(() => this.setCategories('')));
      showMenuAt(menu, evt);
    });
  }

  async setCategories(key) {
    this.settings.categoryProperty = key;
    await this.plugin.saveData(this.settings);
    this.view.render();
  }

  heading(root, text) {
    const head = root.createDiv({ cls: 'dr-search-section' });
    head.createSpan({ cls: 'dr-search-section-title', text: text });
    return head;
  }

  /** A search you made, as a row: a press searches it again. */
  recentCard(list, term) {
    const row = list.createDiv({ cls: 'dr-recent' });
    asButton(row);
    setIcon(row.createSpan({ cls: 'dr-recent-icon' }), 'search');
    row.createSpan({ cls: 'dr-recent-title', text: term });

    onActivate(row, () => {
      this.view.query = term;
      this.view.render();
      const input = this.view.contentEl.querySelector('.dr-browse-search input');
      if (!input) return;
      input.focus();
      input.setSelectionRange(term.length, term.length);
    });
  }

  /**
   * The values of one property, standing in for Apple's genres: the
   * broadest thing a vault divides itself into. Which property is a
   * setting, since every vault names its own.
   */
  categories() {
    const key = this.settings.categoryProperty;
    if (!key) return [];
    return this.view
      .groupsByProperty(key)
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, 18);
  }

  categoryCard(grid, group) {
    const card = grid.createDiv({ cls: 'dr-cat' });
    asButton(card);

    // No artwork to draw on, so the colour comes from the name itself —
    // stable, so a category keeps its colour between visits.
    let hash = 0;
    for (let i = 0; i < group.value.length; i++) {
      hash = (hash * 31 + group.value.charCodeAt(i)) % 360;
    }
    card.style.setProperty('--dr-cat-hue', String(hash));

    const cover = this.view.groupCover(group);
    if (cover) {
      const img = card.createEl('img', { cls: 'dr-cat-art' });
      img.src = cover;
      img.alt = '';
      img.addEventListener('error', () => img.remove());
    }

    card.createSpan({ cls: 'dr-cat-name', text: group.value });
    card.createSpan({
      cls: 'dr-cat-count',
      text: group.files.length === 1 ? '1 note' : `${group.files.length} notes`,
    });

    onActivate(card, () =>
      this.view.navigate({
        mode: 'properties',
        property: this.settings.categoryProperty,
        value: group.value,
      })
    );
  }

  /* -- results ----------------------------------------------------- */

  /**
   * As a music app's search answers: the best match on its own, large;
   * then each kind under its name — albums as covers, notes as rows,
   * properties and their values, your collections, and what notes say —
   * a few of each, with See All for the rest of one kind.
   */
  renderResults(root, q) {
    const view = this.view;
    const words = searchWords(q);
    const hasAll = (text) => words.every((w) => text.indexOf(w) !== -1);

    const folders = [];
    const walk = (folder) =>
      view.visibleFolders(folder).forEach((child) => {
        if (hasAll(child.name.toLowerCase()) && view.folderInFilter(child)) folders.push(child);
        walk(child);
      });
    walk(this.app.vault.getRoot());
    // The album named for the query first, then those it starts.
    const albumScore = (f) => {
      const name = f.name.toLowerCase();
      return name === q ? 95 : name.startsWith(q) ? 80 : 60;
    };
    folders.sort((a, b) => albumScore(b) - albumScore(a) || a.name.localeCompare(b.name));

    // Names and property values, both of which the cache already holds;
    // what notes say is read after, a moment later.
    const ranked = [];
    libraryIndex(this.plugin)
      .notes()
      .forEach((f) => {
        if (!view.inFilter(f)) return;
        const parent = f.parent && f.parent.path !== '/' ? f.parent.path : '';
        const match = rankNote({ title: f.basename, props: noteProps(this.app, f), album: parent }, q);
        if (match) ranked.push({ file: f, score: match.score, why: match.why });
      });
    ranked.sort((a, b) => b.score - a.score || a.file.basename.localeCompare(b.file.basename));
    view.searchWhy = new Map(ranked.map((r) => [r.file.path, r.why]));

    // Your collections by name: smart albums, and albums that gather
    // notes from elsewhere not already among the albums.
    const collections = collectionTiles(view).filter((item) => !(item instanceof TFolder) || folders.indexOf(item) === -1);
    const properties = this.propertyHits(hasAll, q);
    const textOn = this.settings.searchNoteText !== false && q.length >= 3;

    // The one best match, whichever kind it is.
    const candidates = [];
    if (ranked.length) candidates.push({ kind: 'notes', score: ranked[0].score, item: ranked[0].file });
    if (folders.length) candidates.push({ kind: 'albums', score: albumScore(folders[0]), item: folders[0] });
    if (properties.length && properties[0].exact) candidates.push({ kind: 'properties', score: 90, item: properties[0] });
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0] || null;

    const notes = ranked.map((r) => r.file).filter((f) => !top || top.item !== f);
    const albums = folders.filter((f) => !top || top.item !== f);
    const props = properties.filter((p) => !top || top.item !== p);
    const count = ranked.length + folders.length + collections.length + properties.length;

    const head = root.createDiv({ cls: 'dr-search-head' });
    head.createSpan({ cls: 'dr-search-count', text: count === 1 ? '1 result' : `${count} results` });
    const full = head.createDiv({ cls: 'dr-search-full' });
    asButton(full);
    setIcon(full.createSpan({ cls: 'dr-search-full-icon' }), 'file-search');
    full.createSpan({ text: textOn ? 'Obsidian search' : 'Search inside notes' });
    onActivate(full, () => {
      try {
        const search = this.app.internalPlugins.getPluginById('global-search');
        search.instance.openGlobalSearch(view.query);
      } catch (err) {
        console.error('Design Redux: could not open search', err);
        new Notice('Turn on the Search core plugin to search inside notes.');
      }
    });

    const sections = {
      albums: { title: 'Collections', n: albums.length, draw: (el, all) => this.albumsSection(el, all ? albums : albums.slice(0, 6)) },
      notes: { title: 'Notes', n: notes.length, draw: (el, all) => this.notesSection(el, all ? notes : notes.slice(0, 6), all) },
      properties: { title: 'Properties', n: props.length, draw: (el, all) => this.propertiesSection(el, all ? props : props.slice(0, 5)) },
      collections: { title: 'Views', n: collections.length, draw: (el, all) => tileGrid(view, el, all ? collections : collections.slice(0, 6)) },
    };
    const limits = { albums: 6, notes: 6, properties: 5, collections: 6 };
    const skip = new Set(ranked.map((r) => r.file.path));

    // See All: one kind, whole, with the way back to everything.
    const only = view.searchKind && (sections[view.searchKind] || (view.searchKind === 'text' && textOn)) ? view.searchKind : null;
    if (only) {
      const back = root.createDiv({ cls: 'dr-search-back' });
      asButton(back, 'All results');
      setIcon(back.createSpan({ cls: 'dr-search-back-icon' }), 'chevron-left');
      back.createSpan({ text: 'All results' });
      onActivate(back, () => {
        view.searchKind = null;
        view.render();
      });
      if (only === 'text') return this.renderText(root, q, skip, 0);
      this.heading(root, sections[only].title).createSpan({ cls: 'dr-search-section-count', text: String(sections[only].n) });
      sections[only].draw(root, true);
      return;
    }

    if (!count) root.createDiv({ cls: 'dr-split-empty dr-search-none', text: 'No matches by name or property' });
    if (top) this.topResult(root, top);
    ['albums', 'notes', 'properties', 'collections'].forEach((id) => {
      const s = sections[id];
      if (!s.n) return;
      const h = this.heading(root, s.title);
      if (s.n > limits[id]) this.seeAll(h, id);
      if (id === 'notes' && s.n > 1) this.notesTools(h, ranked.map((r) => r.file));
      s.draw(root, false);
    });
    if (textOn) this.renderText(root, q, skip, 5);
  }

  /** Properties…, at the notes' heading: the property tools over every note found. */
  notesTools(head, files) {
    const tools = head.createSpan({ cls: 'dr-search-see-all dr-search-props', text: 'Properties…' });
    asButton(tools, `The properties of these ${files.length} notes`);
    onActivate(tools, () => this.view.propertyToolsFor(files));
  }

  /** "See All", at a section's heading: that kind, whole. */
  seeAll(head, id) {
    const all = head.createSpan({ cls: 'dr-search-see-all', text: 'See All' });
    asButton(all);
    all.dataset.kind = id;
    onActivate(all, () => {
      this.view.searchKind = id;
      this.view.render();
      if (this.view.contentEl) this.view.contentEl.scrollTop = 0;
    });
  }

  /** The best match, large: its cover, its name, what it is. */
  topResult(root, top) {
    const view = this.view;
    this.heading(root, 'Top Result');
    const card = root.createDiv({ cls: 'dr-search-top' });
    asButton(card);
    card.dataset.kind = top.kind;
    const art = card.createDiv({ cls: 'dr-search-top-art' });
    const text = card.createDiv({ cls: 'dr-search-top-text' });
    let title = '';
    let sub = '';
    if (top.kind === 'notes') {
      const file = top.item;
      drawNoteArt(this.plugin, art, file);
      title = file.basename;
      sub = ['Note'].concat(file.parent && file.parent.path !== '/' ? [file.parent.name] : []).join(' · ');
      card.dataset.path = file.path;
      view.pickOrOpen(card, { file }, (evt) => view.openFile(file, evt), false);
      onContextMenu(card, (evt) => view.fileMenu(evt, file));
    } else if (top.kind === 'albums') {
      const folder = top.item;
      drawFolderArt(this.plugin, art, folder);
      title = folder.name;
      sub = `Collection · ${view.countLabel(folder)}`;
      card.dataset.path = folder.path;
      view.pickOrOpen(card, { folder }, () => view.openFolder(folder), false);
      onContextMenu(card, (evt) => view.folderMenu(evt, folder, view.folderCover(folder)));
    } else {
      const hit = top.item;
      this.valueArt(art, hit.key, hit.value, hit.files);
      title = hit.value;
      sub = `${hit.name} · ${bulkCount(hit.files.length, 'note')}`;
      onActivate(card, () => view.navigate({ mode: 'properties', property: hit.key, value: hit.value }));
    }
    text.createDiv({ cls: 'dr-search-top-title', text: title });
    text.createDiv({ cls: 'dr-search-top-sub', text: sub });
  }

  albumsSection(root, folders) {
    const grid = root.createDiv({ cls: 'dr-grid' });
    roveFocus(grid, '.dr-card');
    folders.forEach((f) => this.view.folderCard(grid, f, f.parent && f.parent.path !== '/' ? f.parent.name : null));
  }

  notesSection(root, notes, all) {
    const list = root.createDiv({ cls: 'dr-tracks dr-search-notes' });
    roveFocus(list, '.dr-track');
    this.view.renderLimited(list, notes, 'search', all ? 500 : notes.length);
  }

  /** Properties named like the query, and values of any property that are: each opening its page. */
  propertiesSection(root, hits) {
    const view = this.view;
    const list = root.createDiv({ cls: 'dr-search-props' });
    roveFocus(list, '.dr-search-prop');
    hits.forEach((hit) => {
      const row = list.createDiv({ cls: 'dr-search-prop' });
      asButton(row);
      const art = row.createDiv({ cls: 'dr-search-prop-art' });
      const text = row.createDiv({ cls: 'dr-search-prop-text' });
      if (hit.value === null) {
        setIcon(art, TYPE_ICONS[hit.type] || 'list');
        art.addClass('is-blank');
        text.createDiv({ cls: 'dr-search-prop-title', text: hit.name });
        text.createDiv({ cls: 'dr-search-prop-sub', text: `Property · ${bulkCount(hit.count, 'note')}` });
        onActivate(row, () => view.navigate({ mode: 'properties', property: hit.key, value: null }));
        return;
      }
      this.valueArt(art, hit.key, hit.value, hit.files);
      text.createDiv({ cls: 'dr-search-prop-title', text: `${hit.name}: ${hit.value}` });
      text.createDiv({ cls: 'dr-search-prop-sub', text: bulkCount(hit.files.length, 'note') });
      onActivate(row, () => view.navigate({ mode: 'properties', property: hit.key, value: hit.value }));
    });
  }

  valueArt(el, key, value, files) {
    valueArt(this.view, el, key, value, files);
  }

  /**
   * Properties whose names hold the query, and values that do, with the
   * notes carrying each — one pass over the notes. A value that is the
   * query exactly comes first, and may be the top result.
   */
  propertyHits(hasAll, q) {
    const view = this.view;
    const out = [];
    view.propertyList().forEach((p) => {
      if (hasAll(p.name.toLowerCase())) out.push({ key: p.key, name: p.name, type: p.type, count: p.count, value: null, files: [], exact: p.name.toLowerCase() === q });
    });
    const values = new Map();
    libraryIndex(this.plugin)
      .notes()
      .forEach((file) => {
        if (!view.inFilter(file)) return;
        const fm = noteProps(this.app, file);
        Object.keys(fm).forEach((k) => {
          if (k === 'position') return;
          const raw = fm[k];
          (Array.isArray(raw) ? raw : [raw]).forEach((v) => {
            if (v === null || v === undefined || typeof v === 'object') return;
            const value = view.plain(v);
            if (!value || value.length > 80 || !hasAll(value.toLowerCase())) return;
            const id = `${k.toLowerCase()}\u0000${value}`;
            if (!values.has(id)) values.set(id, { key: k.toLowerCase(), name: k, value, files: [], exact: value.toLowerCase() === q });
            const hit = values.get(id);
            if (hit.files.indexOf(file) === -1) hit.files.push(file);
          });
        });
      });
    const sorted = Array.from(values.values()).sort(
      (a, b) => Number(b.exact) - Number(a.exact) || b.files.length - a.files.length || a.value.localeCompare(b.value)
    );
    // Values first — they're where the notes are — then the properties by name.
    return sorted.concat(out).slice(0, 60);
  }

  /**
   * Notes whose text holds the query, each with the passage — read once
   * typing has paused, a few at a time so typing stays quick, and kept
   * for a while so drawing the screen again doesn't read them again.
   * `limit` shows that many, with See All for the rest; 0 shows them all.
   */
  renderText(root, q, skip, limit) {
    const view = this.view;
    const section = root.createDiv({ cls: 'dr-search-text' });
    const head = this.heading(section, 'In Notes');
    const count = head.createSpan({ cls: 'dr-search-section-count' });
    const status = section.createDiv({ cls: 'dr-search-text-status', text: 'Looking through notes…' });
    const list = section.createDiv({ cls: 'dr-tracks dr-search-text-notes' });
    roveFocus(list, '.dr-track');

    const key = [q, view.filterFolder, view.filterTag, JSON.stringify(view.propFilters()), JSON.stringify(view.filterDate)].join('|');
    const show = (hits) => {
      status.remove();
      count.setText(hits.length >= TEXT_MOST ? `${TEXT_MOST}+` : String(hits.length));
      if (!hits.length) {
        section.createDiv({ cls: 'dr-split-empty', text: 'No other notes say that' });
        return;
      }
      if (limit && hits.length > limit) this.seeAll(head, 'text');
      if (!view.searchWhy) view.searchWhy = new Map();
      const shown = limit ? hits.slice(0, limit) : hits;
      shown.forEach((h) => view.searchWhy.set(h.file.path, h.excerpt));
      shown.forEach((h, i) => view.trackRow(list, h.file, i + 1));
    };
    const kept = view.textFound;
    if (kept && kept.key === key && Date.now() - kept.at < 15000) return show(kept.hits.filter((h) => !skip.has(h.file.path)));

    const token = (view.textToken = (view.textToken || 0) + 1);
    const live = () => view.textToken === token && section.isConnected;
    window.setTimeout(async () => {
      if (!live()) return;
      const hits = await this.textHits(q, skip, live);
      if (!hits || !live()) return;
      view.textFound = { key, at: Date.now(), hits };
      show(hits);
    }, TEXT_PAUSE);
  }

  async textHits(q, skip, live) {
    const view = this.view;
    const files = libraryIndex(this.plugin)
      .markdown()
      .filter((f) => !skip.has(f.path) && !this.plugin.isFolderNote(f) && view.inFilter(f));
    const hits = [];
    for (let i = 0; i < files.length && hits.length < TEXT_MOST; i++) {
      if (i && i % 40 === 0) {
        await new Promise((r) => window.setTimeout(r, 0));
        if (!live()) return null;
      }
      let body = '';
      try {
        body = await this.app.vault.cachedRead(files[i]);
      } catch (err) {
        continue;
      }
      const excerpt = textExcerpt(body, q);
      if (excerpt) hits.push({ file: files[i], excerpt });
    }
    return hits;
  }
}
