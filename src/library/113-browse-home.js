/* ------------------------------------------------------------------ */
/* Browse screens: home                                               */
/*                                                                    */
/* The home screen: its shelves, and the order they are shown in.     */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { albumNeighbours, drawNoteArt, onContextMenu } from '../core/030-helpers-art.js';
import { asButton, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { readingOf } from '../core/075-reading.js';
import { libraryIndex } from '../core/077-library-index.js';
import { dueNotes } from '../core/081-study.js';
import { homeShelves } from './109-home-shelves.js';
import { BrowseScreen, collectionTiles } from './110-browse-screens.js';
import { fromReading } from './145-reading-history.js';

export class HomeScreen extends BrowseScreen {
  title() {
    return 'Home';
  }

  render(root) {
    const view = this.view;
    view.renderTitleBar(root, this.title());

    // Find and the filters narrow every shelf, as they do every screen.
    const keep = (f) => view.inFilter(f) && view.matches(f.basename);
    const home = this.app.vault.getFileByPath(this.settings.homePath || 'Home.md');
    const note = home && keep(home) ? home : null;

    const recents = this.plugin.recentFiles().filter(keep);
    const pinned = this.plugin.pins.files().filter(keep).slice(0, 12);
    const notes = libraryIndex(this.plugin).notes()
      .filter(keep);
    const added = notes
      .slice()
      .sort((a, b) => b.stat.ctime - a.stat.ctime)
      .slice(0, 12);
    const older = this.rediscover(notes, recents);
    const folders = view.sortFolders(
      view
        .visibleFolders(this.app.vault.getRoot())
        .filter((f) => view.folderInFilter(f))
        .filter((f) => view.matches(f.name))
    );

    // Up front, large: where you were, the home note, and one to come
    // back to — each captioned with why it's there.
    const picks = [];
    const pick = (caption, file) => {
      if (file && !picks.some((p) => p.file === file)) picks.push({ caption, file });
    };
    pick('Last opened', recents.find((f) => f.extension === 'md' && f !== note));
    pick('Home note', note);
    pick('Rediscover', older[0]);

    // The shelves, in the order and as many as the settings say.
    const continuing = this.continuing(recents, keep);
    const collections = collectionTiles(view);
    const shelf = (title, items, opts) => items.length > 0 && (view.shelf(root, title, items, opts), true);
    const shelves = {
      picks: () => picks.length > 0 && (this.picks(root, picks), true),
      revisit: () => {
        const due = dueNotes(this.plugin);
        return shelf(`To revisit · ${due.length}`, due.slice(0, 12));
      },
      continue: () => shelf('Continue reading', continuing),
      fromReading: () => shelf('From what you read', this.fromReading(keep)),
      recents: () => shelf('Recently opened', recents.slice(0, 12), { mode: 'recents' }),
      added: () => shelf('Recently added', added, { mode: 'added' }),
      collections: () => shelf('Your views', collections, { mode: 'collections' }),
      pinned: () => shelf('Pinned', pinned, { mode: 'pinned' }),
      rediscover: () => shelf('Rediscover', older.slice(1)),
      folders: () => shelf('Folders', folders, { mode: 'folders' }),
    };
    const drawn = homeShelves(this.settings).filter((s) => s.on && shelves[s.id]()).length;
    if (!drawn) root.createDiv({ cls: 'dr-split-empty', text: 'Nothing here yet' });
  }

  /** Notes what you've read lately links to, not opened yet: why each is there, under it. */
  fromReading(keep) {
    if (!this.settings.readingHistory) return [];
    const history = readingOf(this.plugin);
    const index = libraryIndex(this.plugin);
    const vault = this.app.vault;
    const recent = history.latest('read', 40).map((f) => ({ path: f.path, at: history.entry(f).read }));
    const outgoing = (p) => {
      const f = vault.getAbstractFileByPath(p);
      return f instanceof TFile ? index.outgoing(f) : {};
    };
    const opened = (p) => !!(history.log[p] && history.log[p].opened);
    return fromReading(recent, outgoing, opened, Date.now(), Number(this.settings.fromReadingDays) || 14, 40)
      .map((r) => ({ r, file: vault.getAbstractFileByPath(r.path) }))
      .filter(({ file }) => file instanceof TFile && keep(file) && !this.plugin.isFolderNote(file))
      .slice(0, 12)
      .map(({ r, file }) => {
        const from = vault.getAbstractFileByPath(r.from);
        return { file, subtitle: r.count > 1 ? `From ${r.count} notes you read` : `From ${from ? from.basename : 'a note you read'}` };
      });
  }

  /**
   * Where to pick up: the albums you're partway through, the latest
   * first — the note after the last one you opened in each, with how far
   * along it is.
   */
  continuing(recents, keep) {
    const items = [];
    const seen = new Set();
    // With a reading history: by when you were last in each, and a note not read to its end is where you pick up.
    const history = this.settings.readingHistory ? readingOf(this.plugin) : null;
    const order = history ? history.latest('opened', 200).filter(keep) : recents;
    (order.length ? order : recents).forEach((file) => {
      const album = file.parent;
      if (items.length >= 12 || !album || (album.isRoot && album.isRoot()) || this.plugin.isFolderNote(file) || seen.has(album.path)) return;
      seen.add(album.path);
      const near = albumNeighbours(this.plugin, file);
      if (history && history.entry(file) && history.state(file) !== 'read' && keep(file) && !items.some((i) => i.file === file)) {
        items.push({ file, subtitle: `${album.name} · ${near.index + 1} of ${near.total}`, progress: near.index / near.total });
        return;
      }
      if (!near.next || !keep(near.next) || items.some((i) => i.file === near.next)) return;
      items.push({ file: near.next, subtitle: `${album.name} · ${near.index + 2} of ${near.total}`, progress: (near.index + 1) / near.total });
    });
    return items;
  }

  /**
   * Notes you haven't been in for a while — not opened lately, not
   * changed in a month. A different handful each day, the same one all
   * day, so the shelf doesn't reshuffle on every visit.
   */
  rediscover(notes, recents) {
    const day = 86400000;
    const now = Date.now();
    const seen = new Set(recents.map((f) => f.path));
    const today = Math.floor(now / day);
    // Due a revisit first: read a month ago or more, the longest ago first.
    const history = this.settings.readingHistory ? readingOf(this.plugin) : null;
    const due = history
      ? notes
          .filter((f) => !seen.has(f.path) && history.state(f) === 'read' && now - history.entry(f).read > 30 * day)
          .sort((a, b) => history.entry(a).read - history.entry(b).read)
      : [];
    const dueSet = new Set(due);
    const rest = notes
      .filter((f) => !seen.has(f.path) && !dueSet.has(f) && now - f.stat.mtime > 30 * day)
      .map((f) => ({ file: f, order: stableHash(`${today}:${f.path}`) }))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.file);
    return due.concat(rest).slice(0, 13);
  }

  /**
   * The large cards: a caption above each, its cover, and a band of
   * that cover's colour — the cover itself, blurred — under the title.
   */
  picks(root, picks) {
    const view = this.view;
    const row = root.createDiv({ cls: 'dr-picks' });
    roveFocus(row, '.dr-pick');
    picks.forEach(({ caption, file }) => {
      const card = row.createDiv({ cls: 'dr-pick' });
      card.dataset.path = file.path;
      asButton(card, `${caption}: ${file.basename}`);
      card.createDiv({ cls: 'dr-pick-caption', text: caption });

      const body = card.createDiv({ cls: 'dr-pick-body' });
      const glow = body.createDiv({ cls: 'dr-pick-glow' });
      drawNoteArt(this.plugin, glow, file);
      // White type on the cover's colours; a plain icon has none to give.
      body.toggleClass('is-lit', !!(glow.querySelector('img') || glow.hasClass('is-generated') || glow.hasClass('is-hued') || glow.hasClass('is-drawn')));
      const art = body.createDiv({ cls: 'dr-pick-art' });
      drawNoteArt(this.plugin, art, file);

      const text = body.createDiv({ cls: 'dr-pick-text' });
      text.createDiv({ cls: 'dr-pick-title', text: file.basename });
      const where = file.parent && !(file.parent.isRoot && file.parent.isRoot()) ? file.parent.name : '';
      // Its length as the setting writes it, everywhere a length is shown.
      const length = view.lengthStyle() ? view.lengthLabel(file) : '';
      const sub = [where, length].filter(Boolean).join('  ·  ');
      if (sub) text.createDiv({ cls: 'dr-pick-sub', text: sub });

      onActivate(card, (evt) => view.openFile(file, evt));
      onContextMenu(card, (evt) => view.fileMenu(evt, file));
    });
  }

}

/** A number from text, the same every time: an order that holds for a day. */
export function stableHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
