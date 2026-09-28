/* ------------------------------------------------------------------ */
/* Properties, Obsidian's own editor                                   */
/*                                                                     */
/* The alternative to rebuilding: borrow view.metadataEditor's own     */
/* element. Exact behaviour and exact appearance, at the cost of       */
/* bringing its page-level styling along and leaving the note without  */
/* its property block while the panel holds it.                        */
/**
 * Where a note is named but not linked: its name, or one of its
 * aliases, as a whole word in another note's text, matched without
 * case — as Obsidian's own unlinked mentions are. Links, embeds, tags
 * and frontmatter are passed over, since a name there is already a
 * link or isn't prose. Returns [{ file, count, line }], line being the
 * first mention's, for opening the note there.
 */
async function unlinkedMentions(app, target, limit = 5000) {
  const names = mentionNames(app, target);
  if (!names.length) return [];
  const escaped = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // A word boundary that knows about accented letters. Captured rather
  // than looked behind, which older iPhones can't parse.
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(${escaped.join('|')})(?=[^\\p{L}\\p{N}_]|$)`,
    'giu'
  );
  const lowered = names.map((n) => n.toLowerCase());

  const found = [];
  const files = app.vault.getMarkdownFiles().slice(0, limit);
  for (const file of files) {
    if (file.path === target.path) continue;
    let text = '';
    try {
      text = await app.vault.cachedRead(file);
    } catch (err) {
      continue;
    }
    const lower = text.toLowerCase();
    if (!lowered.some((n) => lower.includes(n))) continue;

    const skip = mentionSkips(app.metadataCache.getFileCache(file));
    let count = 0;
    let line = -1;
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text))) {
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      if (!skip.some(([a, b]) => start < b && end > a)) {
        count++;
        if (line < 0) line = text.slice(0, start).split('\n').length - 1;
      }
    }
    if (count) found.push({ file, count, line });
  }
  return found.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
}

/** A note's name and aliases — what counts as mentioning it. */
function mentionNames(app, file) {
  const names = [file.basename];
  const cache = app.metadataCache.getFileCache(file);
  const fm = (cache && cache.frontmatter) || {};
  ['aliases', 'alias'].forEach((key) => {
    const raw = fm[key];
    (Array.isArray(raw) ? raw : raw ? [raw] : []).forEach((a) => {
      const text = String(a).trim();
      if (text) names.push(text);
    });
  });
  const seen = new Set();
  return names.filter((n) => {
    const k = n.toLowerCase();
    if (!n.trim() || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Character ranges of a note that aren't prose: links, embeds, tags, frontmatter. */
function mentionSkips(cache) {
  if (!cache) return [];
  const ranges = [];
  const add = (pos) => {
    if (pos && pos.start && pos.end) ranges.push([pos.start.offset, pos.end.offset]);
  };
  ['links', 'embeds', 'tags'].forEach((kind) => (cache[kind] || []).forEach((item) => add(item.position)));
  add(cache.frontmatterPosition || (cache.frontmatter && cache.frontmatter.position));
  (cache.sections || []).forEach((sec) => {
    if (sec.type === 'yaml') add(sec.position);
  });
  return ranges;
}

class MentionsSection extends PanelSection {
  get cls() {
    return 'dr-mentions';
  }

  /**
   * Which groups are open. Kept on the panel, not the section, since a
   * section is rebuilt each time the panel opens or follows a note.
   * Unlinked starts folded, as Obsidian's does: it's a search through
   * every note, run only when it's asked for.
   */
  get folds() {
    if (!this.panel.mentionFolds) this.panel.mentionFolds = { linked: false, unlinked: true };
    return this.panel.mentionFolds;
  }

  /**
   * The notes that link here, as [{ file, count }] — from the newest
   * API shape or the older map. A note's links to itself, such as to
   * its own headings, aren't mentions of it and are left out, as
   * Obsidian's backlinks leave them.
   */
  backlinks() {
    try {
      const raw = this.app.metadataCache.getBacklinksForFile(this.file);
      if (!raw) return [];
      const data = raw.data || raw;
      const out = [];

      const add = (path, links) => {
        if (path === this.file.path) return;
        const file = this.app.vault.getFileByPath(path);
        if (file) out.push({ file: file, count: (links && links.length) || 1 });
      };

      if (typeof data.forEach === 'function' && !Array.isArray(data)) {
        data.forEach((links, path) => add(path, links));
      } else {
        Object.keys(data).forEach((path) => add(path, data[path]));
      }
      return out.sort((a, b) => a.file.basename.localeCompare(b.file.basename));
    } catch (err) {
      console.error('Design Redux: could not read backlinks', err);
      return [];
    }
  }

  render() {
    this.renderGroup('linked', 'Linked mentions', () => this.backlinks());
    this.renderGroup('unlinked', 'Unlinked mentions', null);
  }

  /**
   * One group: a heading that folds it, then its notes. `read` gives the
   * notes at once; without it they're searched for, on first opening.
   */
  renderGroup(key, title, read) {
    const group = this.containerEl.createDiv({ cls: `dr-mention-group is-${key}` });
    const head = group.createDiv({ cls: 'dr-section-head' });
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    setIcon(head.createSpan({ cls: 'dr-section-chevron' }), 'chevron-down');
    head.createSpan({ cls: 'dr-section-title', text: title });
    const count = head.createSpan({ cls: 'dr-section-count' });
    const body = group.createDiv({ cls: 'dr-mention-body' });

    const fill = (items) => {
      body.empty();
      count.setText(String(items.length));
      if (!items.length) {
        body.createDiv({ cls: 'dr-empty', text: 'None' });
        return;
      }
      const list = body.createDiv({ cls: 'dr-mention-list' });
      items.forEach((item) => this.renderMention(list, item));
    };

    let searched = false;
    const search = async () => {
      if (searched) return;
      searched = true;
      const file = this.file;
      body.empty();
      body.createDiv({ cls: 'dr-empty', text: 'Searching…' });
      // The last search for this note stands until another note changes
      // or the note's own names do; a redraw alone doesn't repeat it.
      const panel = this.panel;
      const stamp = `${file.path}\n${mentionNames(this.app, file).join('\n')}\n${panel.otherEdits || 0}`;
      if (!panel.unlinkedCache) panel.unlinkedCache = new Map();
      let items = panel.unlinkedCache.get(stamp);
      if (!items) {
        try {
          items = await unlinkedMentions(this.app, file);
          panel.unlinkedCache.clear();
          panel.unlinkedCache.set(stamp, items);
        } catch (err) {
          console.error('Design Redux: could not search for mentions', err);
          items = [];
        }
      }
      // The panel may have moved on, or closed, while this ran.
      if (this.file !== file || !group.isConnected) return;
      fill(items);
    };

    const apply = () => {
      const folded = !!this.folds[key];
      group.toggleClass('is-collapsed', folded);
      head.setAttribute('aria-expanded', folded ? 'false' : 'true');
      if (!folded && !read) search();
    };
    onActivate(head, () => {
      this.folds[key] = !this.folds[key];
      apply();
    });

    if (read) fill(read());
    apply();
  }

  renderMention(list, item) {
    const row = list.createDiv({ cls: 'dr-mention' });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    // Each note with its artwork and where it lives, as a list of tracks
    // shows each one's album.
    drawNoteArt(this.plugin, row.createDiv({ cls: 'dr-mention-art' }), item.file);
    const text = row.createDiv({ cls: 'dr-mention-text' });
    text.createDiv({ cls: 'dr-mention-name', text: item.file.basename });
    const where = item.file.parent && !(item.file.parent.isRoot && item.file.parent.isRoot()) ? item.file.parent.name : '';
    if (where) text.createDiv({ cls: 'dr-mention-where', text: where });
    if (item.count > 1) {
      row.createSpan({ cls: 'dr-mention-count', text: String(item.count) });
    }

    onActivate(
      row,
      (evt) => {
        const newLeaf = !!(evt && (evt.ctrlKey || evt.metaKey));
        if (typeof item.line === 'number' && item.line >= 0) {
          // An unlinked mention opens where the name is.
          this.app.workspace
            .getLeaf(newLeaf)
            .openFile(item.file, { eState: { line: item.line } });
        } else {
          this.app.workspace.openLinkText(item.file.path, this.file.path, newLeaf);
        }
        // Navigating away: the panel belongs to the note being left.
        this.panel.close();
      },
      false
    );
  }
}

