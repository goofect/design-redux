/* ------------------------------------------------------------------ */
/* Looking the library over                                            */
/*                                                                     */
/* What a growing library loses track of, listed to go to: albums with */
/* nothing in them, or no description; notes in no album; an album's   */
/* includes or related naming notes that aren't there, or albums that  */
/* take each other in; folders nested very deep; albums that share a   */
/* name. Things to look at, not rules: nothing is changed.             */
/* ------------------------------------------------------------------ */

const LIBRARY_DEEP = 5;

class LibraryCheck extends Feature {
  settingsSchema() {
    return [
      {
        key: 'libraryCheck',
        name: 'Look the library over',
        desc: 'A command lists albums that are empty or say nothing of themselves, notes in no album, missing or circular includes, deep nesting and repeated names. Nothing is changed.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'library-check',
        name: 'Look the library over…',
        icon: 'stethoscope',
        check: () => this.enabled,
        run: () => this.choose(),
      },
    ];
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

  /** What there is to look at: [{ target, problem, kind }], album problems first. */
  problems() {
    const structure = this.plugin.feature(AlbumStructure);
    const shows = !!(structure && structure.enabled);
    const isNote = (f) => f instanceof TFile && !this.plugin.isFolderNote(f);
    const out = [];
    const folders = this.folders();
    const infos = new Map(folders.map((f) => [f, shows ? structure.info(f) : null]));
    const included = new Set();
    infos.forEach((info) => info && info.includes.forEach((t) => included.add(t)));

    folders.forEach((folder) => {
      const info = infos.get(folder);
      const inside = (f) => (f.children || []).some((c) => isNote(c) || (c instanceof TFolder && inside(c)));
      const holdsNotes = (folder.children || []).some((c) => isNote(c) && c.extension === 'md');
      if (!inside(folder) && !(info && info.includes.length)) out.push({ target: folder, kind: 'empty', problem: 'Nothing in it' });
      else if (shows && holdsNotes && !info.description) out.push({ target: folder, kind: 'about', problem: 'No description' });
      const depth = folder.path.split('/').length;
      if (depth > LIBRARY_DEEP) out.push({ target: folder, kind: 'deep', problem: `Nested ${depth} folders deep` });
      // Links its properties name that lead nowhere.
      if (info) info.missing.forEach((m) => out.push({ target: folder, kind: 'missing', problem: `Its ${m.key} name “${m.name}”, which isn’t there` }));
    });

    // Albums that take each other in, round in a circle.
    if (shows) {
      const takes = (f) => (infos.get(f) ? infos.get(f).includes.filter((t) => t instanceof TFolder) : []);
      const looped = new Set();
      folders.forEach((start) => {
        const seen = new Set();
        const stack = takes(start).slice();
        while (stack.length) {
          const f = stack.pop();
          if (f === start) {
            looped.add(start);
            break;
          }
          if (seen.has(f)) continue;
          seen.add(f);
          stack.push(...takes(f));
        }
      });
      looped.forEach((f) => out.push({ target: f, kind: 'loop', problem: 'Takes in an album that takes it in' }));
    }

    // Albums of one name in different places.
    const named = new Map();
    folders.forEach((f) => {
      const key = f.name.toLowerCase();
      named.set(key, (named.get(key) || []).concat(f));
    });
    named.forEach((same) => {
      if (same.length < 2) return;
      same.forEach((f) => out.push({ target: f, kind: 'twice', problem: `Shares its name with ${same.filter((o) => o !== f).map((o) => o.path).join(', ')}` }));
    });

    // Notes in no album: at the top of the vault, and taken in by none.
    const home = String(this.settings.homePath || '');
    (this.app.vault.getRoot().children || []).forEach((c) => {
      if (isNote(c) && c.extension === 'md' && c.path !== home && !included.has(c)) out.push({ target: c, kind: 'loose', problem: 'In no album' });
    });
    return out;
  }

  choose() {
    const found = this.problems();
    if (!found.length) {
      new Notice('Nothing to look at: every album holds something and says what it is, and every note is in one.');
      return;
    }
    const items = found.map((p) => ({ label: p.target instanceof TFolder ? p.target.name : p.target.basename, note: `${p.problem} · ${p.target.path}`, p }));
    new ComparePicker(this.app, items, `${found.length} ${found.length === 1 ? 'thing' : 'things'} to look at`, (item) => this.goTo(item.p)).open();
  }

  /** An album opened; a note in no album, given one to show in — it stays where it is — or opened. */
  goTo(p) {
    if (p.target instanceof TFolder) {
      const library = this.plugin.feature(Library);
      if (library) library.browseMode({ mode: 'folder', path: p.target.path });
      return;
    }
    const structure = this.plugin.feature(AlbumStructure);
    if (p.kind === 'loose' && structure && structure.enabled) structure.chooseAlbumFor(p.target);
    else this.app.workspace.getLeaf(false).openFile(p.target);
  }
}

LibraryCheck.settingKey = 'libraryCheck';
