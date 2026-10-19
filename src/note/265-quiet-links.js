/* ------------------------------------------------------------------ */
/* Quiet links                                                         */
/*                                                                     */
/* A link that goes somewhere without saying the two notes belong      */
/* together: [[[Note]]], with [[[Note|some words]]] and [[[Note#A      */
/* heading]]] as for any link. It opens the note — making it if it's   */
/* missing — and previews on hover, but it's kept off the graph and    */
/* out of backlinks, so they keep to the connections that mean         */
/* something.                                                          */
/*                                                                     */
/* Obsidian has no such link. It reads [[[Anarchy]]] as a link to a    */
/* note called "[Anarchy" that doesn't exist. So as each note is read, */
/* its quiet links are taken out of the links Obsidian counts — before */
/* it counts them — and kept beside them for this plugin: the graph,   */
/* backlinks, Outgoing links, the [[ list and the Quick switcher never */
/* hear of the stand-in, with nothing patched in any of them. What's   */
/* left is drawing: reading view, Live Preview and properties show the */
/* note it names, dotted; and renames, which Obsidian can't follow.    */
/* ------------------------------------------------------------------ */

import { EditorSuggest, MarkdownView, Notice, TFolder } from 'obsidian';
import { fmGet } from '../core/045-helpers-properties.js';
import { rerenderReading } from '../core/050-helpers-dom.js';
import { noteProps } from '../core/073-notes.js';
import { actionsOn, addActionEntries, editorContext } from '../core/078-actions.js';
import { Feature } from '../core/080-feature.js';
import { quietHint, quietLabel, quietPointsAt, renameQuietLinksIn, splitQuiet, toggledLink } from './263-quiet-text.js';
import { linkCountKey, quietRefs, renameSpans, settleQuietLinks, unsettleQuietLinks } from './264-quiet-cache.js';
import { linkAtCursor, quietEditorExtension, QuietLinkSuggest } from './266-quiet-editor.js';

export class QuietLinks extends Feature {
  constructor(plugin) {
    super(plugin);
    this.watched = new Map();
    this.pendingRenames = [];
  }

  settingsSchema() {
    return [
      {
        key: 'quietLinks',
        name: 'Quiet links',
        desc: 'Write [[[Note]]] for a link kept off the graph and backlinks. Right-click a link to switch it.',
      },
    ];
  }

  actions() {
    const hit = (ctx) => linkAtCursor(ctx.editor);
    return [
      {
        id: 'toggle-quiet-link',
        name: 'Make the link at the cursor quiet or normal',
        menu: (ctx) => (hit(ctx).quiet ? 'Make link normal' : 'Make link quiet'),
        menuIcon: (ctx) => (hit(ctx).quiet ? 'link' : 'link-2-off'),
        icon: 'link-2-off',
        on: 'editor',
        when: (ctx) => this.enabled && !!hit(ctx),
        run: (ctx) => this.toggle(ctx.editor),
      },
    ];
  }

  toggle(editor) {
    const hit = linkAtCursor(editor);
    if (!hit) return false;
    editor.replaceRange(toggledLink(hit), { line: hit.line, ch: hit.from }, { line: hit.line, ch: hit.to });
    return true;
  }

  /** The note a quiet link names, if it exists. */
  resolve(path, sourcePath) {
    return path ? this.app.metadataCache.getFirstLinkpathDest(path, sourcePath || '') : null;
  }

  /** Open a quiet link's note — made first if it's missing, as any link's is. */
  open(target, sourcePath, newLeaf) {
    this.app.workspace.openLinkText(target, sourcePath || '', !!newLeaf);
  }

  /** The page preview a link gets, with Ctrl or Cmd held. */
  preview(evt, el, target, sourcePath) {
    this.app.workspace.trigger('hover-link', {
      event: evt,
      source: 'preview',
      hoverParent: el,
      targetEl: el,
      linktext: target,
      sourcePath: sourcePath || '',
    });
  }

  register() {
    this.plugin.registerEditorExtension([quietEditorExtension(this)]);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (this.enabled) this.quietenReading(el, ctx && ctx.sourcePath);
    });

    if (typeof EditorSuggest === 'function' && typeof this.plugin.registerEditorSuggest === 'function') {
      this.suggest = new QuietLinkSuggest(this);
      this.plugin.registerEditorSuggest(this.suggest);
      this.suggestFirst();
    }

    this.plugin.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        const ctx = this.enabled ? editorContext(editor, info, 'menu') : null;
        if (ctx) addActionEntries(menu, actionsOn(this.actions(), 'editor'), ctx, 'action');
      })
    );

    // Each note as Obsidian reads it: its quiet links set aside before
    // it counts them. It counts a note's links just after telling of it.
    const mc = this.app.metadataCache;
    this.plugin.registerEvent(
      mc.on('changed', (file, data, cache) => {
        if (this.enabled && file) this.settle(file.path, cache);
      })
    );
    // What Obsidian remembered from last time, it counts without reading
    // again; those are set aside once it has.
    this.plugin.registerEvent(
      mc.on('resolved', () => {
        if (this.enabled) this.queueSweep();
      })
    );

    // Obsidian can draw a note's properties block a moment after it says the note opened: looked for again then.
    const follow = () => {
      this.watchPanes();
      window.clearTimeout(this.paneTimer);
      this.paneTimer = window.setTimeout(() => this.watchPanes(), 300);
    };
    this.plugin.registerEvent(this.app.workspace.on('layout-change', follow));
    this.plugin.registerEvent(this.app.workspace.on('active-leaf-change', follow));
    this.plugin.registerEvent(this.app.workspace.on('file-open', follow));
    this.plugin.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (this.enabled) this.noteRename(file, oldPath);
      })
    );
    this.plugin.register(() => {
      window.clearTimeout(this.sweepTimer);
      window.clearTimeout(this.paneTimer);
      this.unwatchPanes();
      this.restoreAll();
    });
  }

  /* -- Obsidian's count of links --------------------------------------- */

  /**
   * One note's quiet links set aside. Obsidian usually hasn't counted
   * them yet; where it has (a note it remembered), the count is taken
   * back too. True if anything moved.
   */
  settle(path, cache) {
    const moved = settleQuietLinks(cache);
    if (!moved.length) return false;
    this.recount(path, moved, -1);
    return true;
  }

  /**
   * Obsidian's counts of a note's links, up or down by the ones given:
   * resolved if the stand-in names a real file (a stray "[Name" note),
   * unresolved otherwise. Only what was counted is taken back.
   */
  recount(path, refs, by) {
    const mc = this.app.metadataCache;
    refs.forEach((ref) => {
      const key = linkCountKey(ref);
      const dest = mc.getFirstLinkpathDest(key, path);
      const table = dest ? mc.resolvedLinks : mc.unresolvedLinks;
      if (!table) return;
      const name = dest ? dest.path : key;
      if (by < 0 && !(table[path] && table[path][name])) return;
      const own = table[path] || (table[path] = {});
      own[name] = (own[name] || 0) + by;
      if (own[name] <= 0) delete own[name];
    });
  }

  queueSweep() {
    window.clearTimeout(this.sweepTimer);
    this.sweepTimer = window.setTimeout(() => this.sweep(), 200);
  }

  /**
   * Every note Obsidian counted a stand-in for — "[Name" among its
   * unresolved links, or a stray "[Name" note among its resolved ones —
   * settled, and the panes that show links told to look again.
   */
  sweep() {
    const mc = this.app.metadataCache;
    const paths = new Set();
    const scan = (table, standIn) =>
      Object.keys(table || {}).forEach((p) => {
        if (Object.keys(table[p] || {}).some(standIn)) paths.add(p);
      });
    scan(mc.unresolvedLinks, (k) => k.startsWith('['));
    scan(mc.resolvedLinks, (k) => k.split('/').pop().startsWith('['));
    let changed = 0;
    paths.forEach((p) => {
      const file = this.app.vault.getFileByPath(p);
      const cache = file ? mc.getFileCache(file) : null;
      if (cache && this.settle(p, cache)) changed++;
    });
    if (changed) this.announceCounts();
    return changed;
  }

  /** Switched off: every note's quiet links back where Obsidian keeps them. */
  restoreAll() {
    const mc = this.app.metadataCache;
    const paths = typeof mc.getCachedFiles === 'function' ? mc.getCachedFiles() : Object.keys(mc.resolvedLinks || {});
    let changed = 0;
    paths.forEach((p) => {
      const file = this.app.vault.getFileByPath(p);
      const cache = file ? mc.getFileCache(file) : null;
      const back = unsettleQuietLinks(cache);
      if (!back.length) return;
      this.recount(p, back, 1);
      changed++;
    });
    if (changed && !this.plugin.unloading) this.announceCounts();
    return changed;
  }

  /** The graph, backlinks and Outgoing links redraw when Obsidian says its links are counted. */
  announceCounts() {
    try {
      this.app.metadataCache.trigger('resolved');
    } catch (err) {
      /* they catch up on the next change */
    }
  }

  /**
   * Obsidian asks each list of suggestions in turn and shows the first
   * that answers, so this one goes first, or its own [[ list would
   * answer [[[ too. Not public API: where the list isn't there to
   * reorder, Obsidian's list shows instead.
   */
  suggestFirst() {
    try {
      const list = this.app.workspace.editorSuggest && this.app.workspace.editorSuggest.suggests;
      if (!Array.isArray(list)) return;
      const at = list.indexOf(this.suggest);
      if (at > 0) {
        list.splice(at, 1);
        list.unshift(this.suggest);
      }
    } catch (err) {
      /* Obsidian's list, then */
    }
  }

  /** Runs on every settings save, so editors and graphs are only redrawn when it's switched. */
  enable() {
    const switched = this.on !== true;
    this.on = true;
    if (switched) {
      this.refreshEditors();
      this.sweep();
    }
    this.watchPanes();
    if (switched) rerenderReading(this.app);
  }

  disable() {
    const switched = this.on === true;
    this.on = false;
    if (switched) {
      this.refreshEditors();
      this.restoreAll();
    }
    this.unwatchPanes();
    if (switched && !this.plugin.unloading) rerenderReading(this.app);
  }

  refreshEditors() {
    this.changed = true;
    try {
      this.app.workspace.updateOptions();
    } catch (err) {
      /* nothing open to redraw */
    }
    this.changed = false;
  }

  /* -- reading view and properties ------------------------------------ */

  /**
   * Obsidian draws [[[Anarchy]]] as a link to a missing "[Anarchy" with a
   * stray bracket after it; drawn instead as the note it names.
   */
  quietenReading(el, sourcePath) {
    el.querySelectorAll('a.internal-link').forEach((a) => {
      const href = a.getAttribute('data-href') || '';
      if (!href.startsWith('[') || href.startsWith('[[')) return;
      const next = a.nextSibling;
      if (!next || next.nodeType !== 3 || !next.textContent.startsWith(']')) return;
      next.textContent = next.textContent.slice(1);
      this.quietenElement(a, href, href.slice(1), sourcePath);
    });
  }

  /**
   * A property's links, read from its value rather than from what's
   * drawn — which differs between versions of Obsidian: a value, or an
   * item of a list, written [[[Note]]] is drawn as the note it names.
   */
  quietenProperties(el, sourcePath) {
    const file = sourcePath ? this.app.vault.getFileByPath(sourcePath) : null;
    const fm = noteProps(this.app, file);
    el.querySelectorAll('.internal-link').forEach((link) => {
      if (link.classList.contains('dr-quiet-link')) return;
      const row = link.closest('[data-property-key], .dr-row[data-key]');
      const key = row ? row.getAttribute('data-property-key') || row.getAttribute('data-key') : null;
      if (!key) return;
      const raw = fmGet(fm, key);
      let value = Array.isArray(raw) ? null : raw;
      const pill = link.closest('.multi-select-pill');
      if (Array.isArray(raw) && pill && pill.parentElement) {
        value = raw[Array.from(pill.parentElement.querySelectorAll('.multi-select-pill')).indexOf(pill)];
      }
      const m = /^\[\[\[([^[\]\n]+?)\]\]\]$/.exec(String(value == null ? '' : value).trim());
      if (!m) return;
      const parts = splitQuiet(m[1]);
      this.quietenElement(link, link.getAttribute('data-href') || '', parts.target, sourcePath, true, parts.words);
    });
  }

  quietenElement(el, href, target, sourcePath, ownClicks, ownWords) {
    const shown = el.textContent || '';
    const words = ownWords !== undefined ? ownWords : shown.startsWith('[') ? '' : shown.replace(/\]$/, '');
    el.textContent = quietLabel(target, words);
    el.setAttribute('data-href', target);
    if (el.hasAttribute('href')) el.setAttribute('href', target);
    const missing = !this.resolve(splitQuiet(target).path, sourcePath);
    el.setAttribute('aria-label', quietHint(target, missing));
    el.classList.toggle('is-unresolved', missing);
    el.classList.add('dr-quiet-link');
    if (!ownClicks) return;
    // A property's link opens from its value, not from what it shows —
    // which would be the stand-in — so its click and preview are taken.
    el.addEventListener(
      'click',
      (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        this.open(target, sourcePath, evt.ctrlKey || evt.metaKey);
      },
      true
    );
    el.addEventListener(
      'mouseover',
      (evt) => {
        evt.stopPropagation();
        this.preview(evt, el, target, sourcePath);
      },
      true
    );
  }

  /* -- Obsidian's properties block ------------------------------------- */

  /**
   * It draws a value written [[[Note]]] from the text, as a link to the
   * stand-in; watched while quiet links are on, and put right whenever
   * it's drawn. Not public API, so it's looked for, and left as it is
   * where it isn't found.
   */
  watchPanes() {
    if (!this.enabled || typeof MutationObserver !== 'function') return;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (!(view instanceof MarkdownView) || !view.containerEl) return;
      const box = view.containerEl.querySelector('.metadata-container');
      if (box) this.watch(box, () => this.quietenProperties(box, view.file ? view.file.path : ''));
    });
  }

  watch(el, fix) {
    if (this.watched.has(el)) {
      fix();
      return;
    }
    const observer = new MutationObserver(() => {
      observer.disconnect();
      fix();
      if (this.watched.get(el) === observer) observer.observe(el, { childList: true, subtree: true });
    });
    this.watched.set(el, observer);
    fix();
    observer.observe(el, { childList: true, subtree: true });
  }

  unwatchPanes() {
    this.watched.forEach((observer) => observer.disconnect());
    this.watched.clear();
  }

  /* -- renames ----------------------------------------------------------- */

  /**
   * Obsidian doesn't know a quiet link names a note, so it can't update
   * one; this does, as Obsidian's own setting says: at once where it
   * updates links itself, and otherwise when asked, from a notice.
   * Renames arriving together — a folder's contents — are taken as one.
   */
  noteRename(file, oldPath) {
    if (file instanceof TFolder) return;
    this.pendingRenames.push({ file, oldPath });
    window.clearTimeout(this.renameTimer);
    this.renameTimer = window.setTimeout(() => this.settleRenames(), 300);
  }

  async settleRenames() {
    const renames = this.pendingRenames.splice(0);
    const changes = this.quietChanges(renames);
    const count = changes.reduce((n, c) => n + c.count, 0);
    if (!count) return;
    if (this.autoUpdate()) {
      await this.applyChanges(changes);
      return;
    }
    const fragment = document.createDocumentFragment();
    const text = document.createElement('span');
    text.textContent = count === 1 ? '1 quiet link still points to the old name. ' : `${count} quiet links still point to the old name. `;
    const link = document.createElement('a');
    link.className = 'dr-undo';
    link.setAttribute('href', '#');
    link.textContent = 'Update them';
    fragment.append(text, link);
    const notice = new Notice(fragment, 12000);
    link.addEventListener('click', async (evt) => {
      evt.preventDefault();
      if (notice && typeof notice.hide === 'function') notice.hide();
      await this.applyChanges(this.quietChanges(renames));
    });
  }

  /** Obsidian's "Automatically update internal links". Not public API: off where it can't be read. */
  autoUpdate() {
    try {
      return typeof this.app.vault.getConfig === 'function' && !!this.app.vault.getConfig('alwaysUpdateLinks');
    } catch (err) {
      return false;
    }
  }

  /** Which notes have quiet links to the renamed files, and how many. */
  quietChanges(renames) {
    const out = [];
    this.app.vault.getMarkdownFiles().forEach((source) => {
      const refs = quietRefs(this.app.metadataCache.getFileCache(source));
      if (!refs.length) return;
      const hits = renames.filter((r) =>
        refs.some((ref) => quietPointsAt(ref.path, r.oldPath) && !this.resolve(ref.path, source.path))
      );
      if (!hits.length) return;
      const count = refs.filter((ref) => hits.some((r) => quietPointsAt(ref.path, r.oldPath))).length;
      out.push({ source, renames: hits, count });
    });
    return out;
  }

  async applyChanges(changes) {
    for (const change of changes) {
      try {
        const cache = this.app.metadataCache.getFileCache(change.source);
        const renames = change.renames.map((r) => ({ oldPath: r.oldPath, linktext: this.app.metadataCache.fileToLinktext(r.file, change.source.path, true) }));
        await this.app.vault.process(change.source, (text) =>
          renameQuietLinksIn(text, renames, (path) => !!this.resolve(path, change.source.path), renameSpans(text, cache)).text
        );
      } catch (err) {
        console.error('Design Redux: could not update quiet links', err);
        new Notice(`Could not update the quiet links in “${change.source.basename}”.`);
      }
    }
  }
}

QuietLinks.settingKey = 'quietLinks';
