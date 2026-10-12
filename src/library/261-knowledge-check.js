/* ------------------------------------------------------------------ */
/* Checking the knowledge structure                                    */
/*                                                                     */
/* The relationships kept in notes, looked over for what doesn't hold  */
/* together — and told apart from what's only a way of modelling it:   */
/*   errors — a hierarchy that leads back round to where it began, a  */
/*     relationship naming a note that isn't there, one listed twice   */
/*     in a property, two hierarchies at once to one note, several     */
/*     broader concepts in a hierarchy set to be a tree;               */
/*   worth a look — often a slip, sometimes meant: a loop through two  */
/*     different hierarchies, a link the hierarchy implies already,    */
/*     one relationship recorded on both notes, support and           */
/*     contradiction of one note, an album's own note under something  */
/*     inside it, a concept left outside its map or its hierarchy;     */
/*   modelling choices — fine as they are, listed so it's plain they  */
/*     were seen: several broader concepts (a polyhierarchy), a loop   */
/*     of causes or dependencies outside any hierarchy (a feedback     */
/*     loop), and whatever was marked as meant.                        */
/* Nothing changes until a fix is chosen; each fix is one Undo.        */
/* ------------------------------------------------------------------ */

import { Menu, Notice } from 'obsidian';
import { onContextMenu, showMenuAt } from '../core/030-helpers-art.js';
import { onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { plainValue } from '../core/045-helpers-properties.js';
import { noteNameFrom } from '../core/047-helpers-text.js';
import { libraryIndex } from '../core/077-library-index.js';
import { Feature } from '../core/080-feature.js';
import { BROWSE_SCREENS } from './110-browse-screens.js';
import { Library } from './130-browse-filters.js';
import { Knowledge } from './254-knowledge.js';
import { AlbumStructure } from './257-album-structure.js';
import { reportRow, ReportScreen } from './259-library-check.js';

export const INTEGRITY_LEVELS = [
  { id: 'error', title: 'Errors', desc: 'Things that can’t all be true at once, or that point at nothing.' },
  { id: 'warning', title: 'Worth a look', desc: 'Often a slip, sometimes meant: mark one as meant and it moves to modelling choices.' },
  { id: 'choice', title: 'Modelling choices', desc: 'Fine as they are — listed so you can see they were noticed.' },
];

export const INTEGRITY_ICONS = {
  broken: 'unlink',
  repeat: 'copy',
  cycle: 'refresh-cw',
  parents: 'git-fork',
  conflict: 'split',
  folder: 'folder-x',
  redundant: 'git-commit-horizontal',
  both: 'arrow-left-right',
  oppose: 'scale',
  orphan: 'circle-dashed',
  broader: 'corner-left-up',
};

/* Kinds of relationship that say opposite things of a note, by how their names begin. */
export const AGREEING_KIND = /^(supports?|agrees?|confirms?|is evidence for|evidence for)\b/i;
export const OPPOSING_KIND = /^(contradicts?|opposes?|refutes?|rebuts?|disagrees?|undermines?)\b/i;

/* An album most of whose notes are related, or come under something: "most" is this share, of at least this many. */
export const INTEGRITY_MOST = 2 / 3;
export const INTEGRITY_MOST_NOTES = 3;

/**
 * The groups of notes that lead round to each other by `next` — the
 * strongly connected ones, two or more notes each. Iterative, so a long
 * chain can't run the stack out.
 */
export function loopsAmong(nodes, next) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const on = new Set();
  const stack = [];
  const out = [];
  nodes.forEach((start) => {
    if (index.has(start)) return;
    const work = [{ node: start, edges: next(start), at: 0 }];
    index.set(start, counter);
    low.set(start, counter++);
    stack.push(start);
    on.add(start);
    while (work.length) {
      const top = work[work.length - 1];
      if (top.at < top.edges.length) {
        const w = top.edges[top.at++];
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          on.add(w);
          work.push({ node: w, edges: next(w), at: 0 });
        } else if (on.has(w)) {
          low.set(top.node, Math.min(low.get(top.node), index.get(w)));
        }
        continue;
      }
      work.pop();
      if (work.length) low.set(work[work.length - 1].node, Math.min(low.get(work[work.length - 1].node), low.get(top.node)));
      if (low.get(top.node) === index.get(top.node)) {
        const group = [];
        let w;
        do {
          w = stack.pop();
          on.delete(w);
          group.push(w);
        } while (w !== top.node);
        if (group.length > 1) out.push(group);
      }
    }
  });
  return out;
}

/** The shortest way from `start` round to itself, through `group` only: the notes in order. */
export function loopPath(start, group, next) {
  const inside = new Set(group);
  const back = new Map();
  const queue = [];
  next(start).forEach((n) => {
    if (inside.has(n) && !back.has(n)) {
      back.set(n, start);
      queue.push(n);
    }
  });
  while (queue.length) {
    const at = queue.shift();
    if (at === start) break;
    next(at).forEach((n) => {
      if (inside.has(n) && !back.has(n)) {
        back.set(n, at);
        queue.push(n);
      }
    });
  }
  if (!back.has(start)) return [start];
  const path = [];
  let at = back.get(start);
  while (at !== start) {
    path.unshift(at);
    at = back.get(at);
  }
  return [start].concat(path);
}

/**
 * The knowledge structure looked over: [{ type, level, subject, notes,
 * kind?, links, text, code?, fixes, meant? }]. `subject` is the note the
 * finding is about, `links` the relationships it turns on ({ from, kind,
 * to }), `fixes` what can be done about it ({ label, icon, run }); a
 * warning with a `code` can be marked as meant.
 */
export function knowledgeFindings(k) {
  const app = k.app;
  const settings = k.settings;
  const idx = k.index();
  const sign = JSON.stringify([settings.knowledgeTreeKinds, settings.knowledgeBroader, settings.knowledgeMeant]);
  if (k.findingsCache && k.findingsCache.index === idx && k.findingsCache.sign === sign) return k.findingsCache.list;

  // The kinds the index was read with: the same objects its relationships hold.
  const kinds = idx.kinds || k.kinds();
  const notes = libraryIndex(k.plugin).markdown();
  const outOf = (f) => idx.out.get(f.path) || [];
  const inOf = (f) => idx.into.get(f.path) || [];
  const isHier = (kind) => kind.category === 'hierarchy';
  const tree = new Set(
    String(settings.knowledgeTreeKinds || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const name = (f) => f.basename;
  const list = [];
  const add = (finding) => list.push(Object.assign({ notes: [finding.subject], links: [], fixes: [] }, finding));
  const via = (kind) => (f) => outOf(f).filter((r) => r.kind === kind).map((r) => r.file);
  const sentence = (links) => links.map((l, i) => `${i ? name(l.from) + ' ' : ''}${l.kind.name} ${name(l.to)}`).join(', ');

  // Pointing at nothing, or listing one note twice.
  idx.broken.forEach((b) =>
    add({
      type: 'broken',
      level: 'error',
      subject: b.file,
      kind: b.kind,
      text: `Its “${b.kind.prop}” names “${b.name}”, which isn’t there`,
      fixes: [
        { label: `Make “${b.name}”`, icon: 'file-plus', run: () => knowledgeMakeMissing(k, b.file, b.name) },
        { label: 'Take the link out', icon: 'unlink', run: () => knowledgeTakeOut(k, b.file, b.kind, b.name) },
      ],
    })
  );
  idx.twice.forEach((t) =>
    add({
      type: 'repeat',
      level: 'error',
      subject: t.file,
      notes: [t.file, t.target],
      kind: t.kind,
      text: `Lists ${name(t.target)} twice in its “${t.kind.prop}”`,
      fixes: [{ label: 'Keep it once', icon: 'copy-minus', run: () => knowledgeKeepOnce(k, t.file, t.kind, t.target) }],
    })
  );

  // Round in a circle: within one hierarchy (the graph's parent going with any), an error;
  // through two different hierarchies, worth a look; outside hierarchies, a feedback loop.
  const reported = new Set();
  const groupKey = (group) => group.map((f) => f.path).sort().join('\n');
  const loopFinding = (group, kindsUsed, level, text, code) => {
    const key = groupKey(group);
    if (reported.has(key)) return;
    reported.add(key);
    const next = (f) => outOf(f).filter((r) => kindsUsed.indexOf(r.kind) !== -1).map((r) => r.file);
    const start = group.slice().sort((a, b) => name(a).localeCompare(name(b)))[0];
    const path = loopPath(start, group, next);
    const links = path.map((f, i) => {
      const to = path[(i + 1) % path.length];
      return { from: f, to, kind: outOf(f).find((r) => r.file === to && kindsUsed.indexOf(r.kind) !== -1).kind };
    });
    add({ type: 'cycle', level, subject: start, notes: group, links, code, text: text(links) });
  };
  const hier = kinds.filter(isHier);
  const generic = hier.filter((kd) => kd.generic);
  hier.filter((kd) => !kd.generic).concat(generic.length ? [null] : []).forEach((kind) => {
    const used = kind ? [kind].concat(generic) : generic;
    const next = (f) => outOf(f).filter((r) => used.indexOf(r.kind) !== -1).map((r) => r.file);
    loopsAmong(notes, next).forEach((group) => loopFinding(group, used, 'error', (links) => `${sentence(links)}: it comes under itself`));
  });
  const anyHier = (f) => outOf(f).filter((r) => isHier(r.kind)).map((r) => r.file);
  loopsAmong(notes, anyHier).forEach((group) =>
    loopFinding(group, hier, 'warning', (links) => `${sentence(links)}: round through ${Array.from(new Set(links.map((l) => l.kind.name))).join(' and ')} — check it’s meant`, 'cycle')
  );
  kinds
    .filter((kd) => !isHier(kd) && kd.inverse && kd.inverse !== kd.name)
    .forEach((kind) => {
      loopsAmong(notes, via(kind)).forEach((group) => loopFinding(group, [kind], 'choice', (links) => `${sentence(links)}: a loop of “${kind.name}”, which is fine outside a hierarchy — a feedback loop`));
    });

  notes.forEach((file) => {
    const mine = outOf(file);
    if (!mine.length) return;

    // Several broader concepts in one hierarchy: a polyhierarchy — unless it's to be a tree.
    hier.forEach((kind) => {
      const ups = mine.filter((r) => r.kind === kind);
      if (ups.length < 2) return;
      const strict = tree.has(kind.name.toLowerCase()) || tree.has(kind.prop.toLowerCase());
      add({
        type: 'parents',
        level: strict ? 'error' : 'choice',
        subject: file,
        notes: [file].concat(ups.map((r) => r.file)),
        kind,
        links: ups.map((r) => ({ from: file, kind, to: r.file })),
        text: strict
          ? `${kind.name} ${ups.map((r) => name(r.file)).join(' and ')}, where “${kind.name}” is set to lead to one note only`
          : `${kind.name} ${ups.map((r) => name(r.file)).join(' and ')}: under several at once, a polyhierarchy`,
      });
    });

    // Two roles at odds, towards one note.
    const byTarget = new Map();
    mine.forEach((r) => byTarget.set(r.file, (byTarget.get(r.file) || []).concat(r.kind)));
    byTarget.forEach((ks, target) => {
      const roles = ks.filter((kd) => isHier(kd) && !kd.generic);
      if (roles.length > 1) {
        add({
          type: 'conflict',
          level: 'error',
          subject: file,
          notes: [file, target],
          links: roles.map((kd) => ({ from: file, kind: kd, to: target })),
          text: `Both ${roles.map((kd) => kd.name).join(' and ')} ${name(target)}: one hierarchy or the other`,
        });
      }
      const agree = ks.find((kd) => AGREEING_KIND.test(kd.name));
      const oppose = ks.find((kd) => OPPOSING_KIND.test(kd.name));
      if (agree && oppose) {
        add({
          type: 'oppose',
          level: 'warning',
          subject: file,
          notes: [file, target],
          links: [agree, oppose].map((kd) => ({ from: file, kind: kd, to: target })),
          code: 'oppose',
          text: `Both ${agree.name} and ${oppose.name} ${name(target)}`,
        });
      }
    });

    // Said directly, and implied already through the same hierarchy.
    hier.forEach((kind) => {
      const ups = mine.filter((r) => r.kind === kind);
      if (ups.length < 2) return;
      const reach = new Map();
      const reachOf = (from) => {
        if (reach.has(from)) return reach.get(from);
        const seen = new Set();
        const queue = [from];
        while (queue.length) {
          via(kind)(queue.shift()).forEach((n) => {
            if (!seen.has(n)) {
              seen.add(n);
              queue.push(n);
            }
          });
        }
        reach.set(from, seen);
        return seen;
      };
      ups.forEach((r) => {
        const through = ups.find((o) => o !== r && o.file !== file && reachOf(o.file).has(r.file));
        if (!through) return;
        add({
          type: 'redundant',
          level: 'warning',
          subject: file,
          notes: [file, r.file, through.file],
          kind,
          links: [{ from: file, kind, to: r.file }],
          code: `redundant:${kind.prop}`,
          text: `${kind.name} ${name(r.file)} directly, and through ${name(through.file)} already`,
          fixes: [{ label: `Take out “${kind.name} ${name(r.file)}”`, icon: 'scissors', run: () => k.remove(file, kind, r.file) }],
        });
      });
    });

    // One relationship, recorded on both notes: each reads the other's already.
    mine.forEach((r) => {
      if (file.path > r.file.path) return;
      const mirror = r.kind.inverse === r.kind.name ? r.kind : kinds.find((kd) => kd.name === r.kind.inverse && kd.inverse === r.kind.name);
      if (!mirror) return;
      const back = outOf(r.file).find((o) => o.kind === mirror && o.file === file);
      if (!back) return;
      add({
        type: 'both',
        level: 'warning',
        subject: file,
        notes: [file, r.file],
        kind: r.kind,
        links: [{ from: file, kind: r.kind, to: r.file }, { from: r.file, kind: mirror, to: file }],
        code: `both:${r.kind.prop}`,
        text: `${r.kind.name} ${name(r.file)}, and ${name(r.file)} says ${mirror.name} it too: one is enough, the other reads it back`,
        fixes: [{ label: `Keep it on ${name(file)} only`, icon: 'arrow-right', run: () => k.remove(r.file, mirror, file) }],
      });
    });
  });

  // An album's own note under something inside the album: the folders say the reverse.
  notes.forEach((file) => {
    if (!k.plugin.isFolderNote(file) || !file.parent) return;
    const album = file.parent;
    outOf(file)
      .filter((r) => isHier(r.kind) && r.file !== file && r.file.path.startsWith(album.path === '/' ? '' : album.path + '/'))
      .forEach((r) =>
        add({
          type: 'folder',
          level: 'warning',
          subject: file,
          notes: [file, r.file],
          kind: r.kind,
          links: [{ from: file, kind: r.kind, to: r.file }],
          code: `folder:${r.kind.prop}`,
          text: `${album.name}’s own note ${r.kind.name} ${name(r.file)}, which is inside ${album.name}`,
        })
      );
  });

  // Concepts left out: related to nothing, or outside the hierarchy the rest of their album is in.
  const structure = typeof AlbumStructure === 'function' ? k.plugin.feature(AlbumStructure) : null;
  const policy = settings.knowledgeBroader || 'concept';
  const albums = new Map();
  notes.forEach((file) => {
    if (!file.parent || k.plugin.isFolderNote(file)) return;
    albums.set(file.parent, (albums.get(file.parent) || []).concat(file));
  });
  albums.forEach((members, album) => {
    const map = !!structure && structure.enabled && !(album.isRoot && album.isRoot()) && structure.info(album).type === 'concept map';
    const related = members.filter((f) => outOf(f).length || inOf(f).length);
    const under = related.filter((f) => outOf(f).some((r) => isHier(r.kind)));
    const most = (part, whole) => whole.length >= INTEGRITY_MOST_NOTES && part.length >= INTEGRITY_MOST * whole.length;
    const albumNote = album.isRoot && album.isRoot() ? null : k.plugin.folderNote(album);
    if (map || most(related, members)) {
      members
        .filter((f) => related.indexOf(f) === -1)
        .forEach((f) =>
          add({
            type: 'orphan',
            level: 'warning',
            subject: f,
            code: 'orphan',
            text: map ? `In ${album.name}, a concept map, but related to nothing` : `Related to nothing, where most of ${album.name} is`,
            fixes: [{ label: 'Add a relationship…', icon: 'plus', run: () => k.ask(f) }],
          })
        );
    }
    const needs = policy !== 'never' && under.length > 0 && (map || (policy === 'most' && most(under, related)));
    if (!needs) return;
    // The hierarchy the rest of the album is in, by how often it's used there.
    const used = new Map();
    under.forEach((f) => outOf(f).filter((r) => isHier(r.kind)).forEach((r) => used.set(r.kind, (used.get(r.kind) || 0) + 1)));
    const usual = Array.from(used.keys()).sort((a, b) => used.get(b) - used.get(a))[0];
    related
      .filter((f) => under.indexOf(f) === -1 && !inOf(f).some((r) => isHier(r.kind)))
      .forEach((f) => {
        const fixes = [];
        if (albumNote && albumNote !== f) fixes.push({ label: `Put it under ${name(albumNote)} (${usual.name})`, icon: 'corner-left-up', run: () => k.add(f, usual, albumNote) });
        fixes.push({ label: 'Choose what it comes under…', icon: 'move-up-right', run: () => k.askMove(f) });
        add({
          type: 'broader',
          level: 'warning',
          subject: f,
          code: 'broader',
          text: `Related, but under nothing, where the rest of ${album.name} comes under something`,
          fixes,
        });
      });
  });

  // Marked as meant: a choice, not a warning.
  const meant = settings.knowledgeMeant || {};
  list.forEach((f) => {
    if (f.level !== 'warning' || !f.code || (meant[f.subject.path] || []).indexOf(f.code) === -1) return;
    f.level = 'choice';
    f.meant = true;
  });
  const order = (f) => INTEGRITY_LEVELS.findIndex((l) => l.id === f.level);
  list.sort((a, b) => order(a) - order(b) || name(a.subject).localeCompare(name(b.subject)));
  k.findingsCache = { index: idx, sign, list };
  return list;
}

/** A note made for a name a relationship gives, beside the note naming it. One Undo. */
export async function knowledgeMakeMissing(k, near, missing) {
  const folder = near.parent || k.app.vault.getRoot();
  const path = k.plugin.freeChildPath(folder, noteNameFrom(missing.split('/').pop()), 'md');
  let file = null;
  try {
    file = await k.app.vault.create(path, '');
  } catch (err) {
    console.error('Design Redux: could not make the note', err);
    new Notice('Could not make that note.');
    return null;
  }
  k.cache = null;
  k.plugin.refreshBrowse();
  k.plugin.offerUndo(`Made ${file.basename}.`, () => k.app.fileManager.trashFile(file));
  return file;
}

/** A relationship to a note that isn't there, taken out of the property naming it. One Undo. */
export async function knowledgeTakeOut(k, file, kind, missing) {
  const before = await k.edit(file, kind.prop, (vals) => vals.filter((v) => plainValue(v) !== missing));
  if (before === null) return false;
  k.plugin.offerUndo(`Took “${missing}” out of ${file.basename}.`, () => k.restore(file, kind.prop, before));
  return true;
}

/** A property listing one note twice, made to list it once: the first kept. One Undo. */
export async function knowledgeKeepOnce(k, file, kind, target) {
  let kept = false;
  const before = await k.edit(file, kind.prop, (vals) =>
    vals.filter((v) => {
      if (k.app.metadataCache.getFirstLinkpathDest(plainValue(v), file.path) !== target) return true;
      if (kept) return false;
      kept = true;
      return true;
    })
  );
  if (before === null) return false;
  k.plugin.offerUndo(`${file.basename} lists ${target.basename} once.`, () => k.restore(file, kind.prop, before));
  return true;
}

export class IntegrityScreen extends ReportScreen {
  title() {
    return 'Knowledge check';
  }

  render(root) {
    const view = this.view;
    const check = this.plugin.feature(KnowledgeCheck);
    view.renderTitleBar(root, this.title());
    if (!check || !check.enabled || !check.knowledge) {
      view.emptyState(root, 'Checking the knowledge structure is switched off in settings.', 'list-checks');
      return;
    }
    // Given a note: what turns on it alone.
    const only = view.property ? this.app.vault.getFileByPath(view.property) : null;
    const found = check.findings().filter((f) => !only || f.notes.indexOf(only) !== -1);
    const counts = INTEGRITY_LEVELS.map((l) => [l, found.filter((f) => f.level === l.id).length]);
    const lead = root.createDiv({ cls: 'dr-report-lead' });
    if (only) lead.createDiv({ cls: 'dr-integrity-for', text: `For ${only.basename}` });
    lead.createDiv({
      text: found.some((f) => f.level !== 'choice')
        ? counts.filter(([, n]) => n).map(([l, n]) => `${n} ${l.title.toLowerCase()}`).join(' · ')
        : 'Nothing that doesn’t hold together: every hierarchy leads somewhere, and every relationship to a note that’s there.',
    });
    counts.forEach(([level, n]) => {
      if (!n) return;
      const head = root.createDiv({ cls: 'dr-report-head' });
      head.dataset.level = level.id;
      head.createSpan({ text: level.title });
      head.createSpan({ cls: 'dr-report-count', text: String(n) });
      root.createDiv({ cls: 'dr-integrity-desc', text: level.desc });
      const list = root.createDiv({ cls: 'dr-report-list' });
      roveFocus(list, '.dr-report-row');
      found.filter((f) => f.level === level.id).forEach((f) => check.renderRow(list, f, view));
    });
  }
}

BROWSE_SCREENS['knowledge-check'] = IntegrityScreen;

export class KnowledgeCheck extends Feature {
  settingsSchema() {
    return [
      {
        key: 'knowledgeCheck',
        name: 'Check the knowledge structure',
        desc: 'Looks the relationships between notes over: hierarchies that come round to where they began, relationships to notes that aren’t there or listed twice, conflicting roles, links the hierarchy implies already, concepts left out — telling errors from what’s only a way of modelling it.',
      },
      {
        key: 'knowledgeTreeKinds',
        type: 'text',
        name: 'One broader concept only',
        desc: 'Kinds of hierarchy where a note may come under one other at most — a strict tree. Names, separated by commas. Elsewhere several broader concepts are a polyhierarchy, and fine.',
        placeholder: 'is part of',
        fallback: '',
        showIf: 'knowledgeCheck',
      },
      {
        key: 'knowledgeBroader',
        type: 'dropdown',
        name: 'Concepts need a broader one',
        desc: 'Where a related note that comes under nothing is worth a look, while the rest of its album does come under something.',
        options: { concept: 'In concept-map albums', most: 'In any album where most notes do', never: 'Never' },
        showIf: 'knowledgeCheck',
      },
    ];
  }

  actions() {
    return [
      { id: 'knowledge-check', name: 'Check the knowledge structure', icon: 'list-checks', when: () => this.enabled && !!this.knowledge, run: () => this.open() },
      { id: 'knowledge-check-note', name: 'Check this note’s relationships', menu: false, icon: 'list-checks', on: 'note', when: () => this.enabled && !!this.knowledge, run: (ctx) => this.open(ctx.file) },
    ];
  }

  get knowledge() {
    const k = typeof Knowledge === 'function' ? this.plugin.feature(Knowledge) : null;
    return k && k.enabled ? k : null;
  }

  findings() {
    return this.knowledge ? knowledgeFindings(this.knowledge) : [];
  }

  open(file) {
    const library = this.plugin.feature(Library);
    if (library) library.browseMode({ mode: 'knowledge-check', property: file ? file.path : null });
  }

  /** A warning marked as meant, or not any more: kept with its note, so it follows a rename. */
  async setMeant(finding, on) {
    const meant = Object.assign({}, this.settings.knowledgeMeant || {});
    const codes = (meant[finding.subject.path] || []).filter((c) => c !== finding.code);
    if (on) codes.push(finding.code);
    if (codes.length) meant[finding.subject.path] = codes;
    else delete meant[finding.subject.path];
    this.settings.knowledgeMeant = meant;
    await this.plugin.saveData(this.settings);
    this.plugin.refreshBrowse();
  }

  /** One finding as a row: into the note's relationships on a click; fixes beside it and on its menu. */
  renderRow(list, f, view) {
    const row = reportRow(list, INTEGRITY_ICONS[f.type] || 'circle-alert', f.subject.basename, f.meant ? `${f.text} — marked as meant` : f.text);
    row.addClass('dr-integrity-row');
    row.dataset.level = f.level;
    row.dataset.type = f.type;
    const fix = f.fixes[0];
    if (fix) {
      const button = row.createEl('button', { cls: 'dr-integrity-fix', text: fix.label });
      button.addEventListener('click', (evt) => {
        evt.stopPropagation();
        fix.run();
      });
      // Its own keys: Enter on it isn't Enter on the row.
      button.addEventListener('keydown', (evt) => evt.stopPropagation());
    }
    onActivate(row, (evt) => {
      if (evt && (evt.metaKey || evt.ctrlKey)) view.openFile(f.subject, evt);
      else view.navigate({ mode: 'concept', property: f.subject.path });
    });
    onContextMenu(row, (evt) => showMenuAt(this.menuFor(f), evt));
    return row;
  }

  /** What can be done about a finding: its fixes, taking out any one relationship it turns on, marking it meant. */
  menuFor(f) {
    const k = this.knowledge;
    const menu = new Menu();
    const item = (title, icon, run, section) => menu.addItem((m) => {
      m.setTitle(title).setIcon(icon).onClick(run);
      if (typeof m.setSection === 'function') m.setSection(section || 'action');
    });
    item('Show its relationships', 'waypoints', () => k.explore(f.subject), 'open');
    item('Open note', 'file-text', () => this.app.workspace.getLeaf(false).openFile(f.subject), 'open');
    f.fixes.forEach((x) => item(x.label, x.icon, x.run));
    // Any one relationship it turns on, taken out — but for an implied link, whose fix is just that.
    f.links
      .filter(() => f.type !== 'redundant')
      .forEach((l) => item(`Take out “${l.from.basename} ${l.kind.name} ${l.to.basename}”`, 'scissors', () => k.remove(l.from, l.kind, l.to)));
    if (f.code && (f.level === 'warning' || f.meant)) item(f.meant ? 'Not meant after all' : 'Meant like this', f.meant ? 'undo-2' : 'check', () => this.setMeant(f, !f.meant), 'danger');
    return menu;
  }

  /** On a note's relationships: what doesn't hold together about it, if anything. */
  renderFor(root, file, view) {
    const found = this.findings().filter((f) => f.level !== 'choice' && f.notes.indexOf(file) !== -1);
    if (!found.length) return;
    const head = root.createDiv({ cls: 'dr-report-head' });
    head.dataset.level = found.some((f) => f.level === 'error') ? 'error' : 'warning';
    head.createSpan({ text: 'Worth checking' });
    head.createSpan({ cls: 'dr-report-count', text: String(found.length) });
    const list = root.createDiv({ cls: 'dr-report-list' });
    roveFocus(list, '.dr-report-row');
    found.forEach((f) => this.renderRow(list, f, view));
  }
}

KnowledgeCheck.settingKey = 'knowledgeCheck';
