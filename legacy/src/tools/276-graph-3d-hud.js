/* ------------------------------------------------------------------ */
/* The graph in three dimensions: the view, what floats over it       */
/*                                                                    */
/* The third part of the 3D graph's view: over the graph, at the top  */
/* left, how much is drawn and a box to find a note by name — picked, */
/* the camera flies to it; under it, the communities (or the folders, */
/* or the tags: what the colours go by), each a colour and a count,   */
/* which lights its notes and turns to them; on the right, what's    */
/* picked — a note's folder, community, and its links, the ways they  */
/* run, each a step to that note — with Open and Copy link; and down  */
/* the right edge, as the graph's own has its gear, the controls:     */
/* settings, fit, grouping, names, links, turning. A tip names the    */
/* note under the pointer.                                            */
/* ------------------------------------------------------------------ */

import { Platform, setIcon, TFile } from 'obsidian';
import { libraryIndex } from '../core/077-library-index.js';
import { groupName } from './263-graph-space.js';
import { fitView } from './265-graph-camera.js';
import { Graph3DPanel } from './274-graph-3d-panel.js';

/** How many of a list are shown before Show more. */
const GRAPH_3D_SHOWN = 24;

/** What the colours go by, as the lists call it: one and many. */
const GRAPH_3D_NOUNS = { community: ['community', 'communities'], folder: ['folder', 'folders'], tag: ['tag', 'tags'] };

export class Graph3DHud extends Graph3DPanel {
  buildHud() {
    const hud = (this.hud = this.contentEl.createDiv({ cls: 'dr-graph3d-hud' }));

    // What's picked, at the right; the settings, Obsidian's graph's own box, in the corner beside it.
    const right = (this.right = hud.createDiv({ cls: 'dr-graph3d-right' }));
    this.detail = right.createDiv({ cls: 'dr-graph3d-pane dr-graph3d-detail' });
    this.detail.hidden = true;
    this.registerDomEvent(this.detail, 'click', (e) => this.detailClick(e));
    this.buildPanel(hud);

    this.tip = this.contentEl.createDiv({ cls: 'dr-graph3d-tip' });
    this.tip.hidden = true;
    this.empty = this.contentEl.createDiv({ cls: 'dr-graph3d-empty' });
    this.empty.hidden = true;
    this.syncSide();
  }

  /** The side's buttons lit as the settings say; the settings over what's picked while they're open. */
  syncSide() {
    const b = this.sideButtons;
    if (!b) return;
    const set = (key, on) => {
      if (!b[key]) return;
      b[key].toggleClass('is-active', on);
      b[key].setAttribute('aria-pressed', String(on));
    };
    set('panel', !!this.options.panel);
    set('spin', !!this.options.spin);
    if (b.panel) b.panel.setAttribute('aria-expanded', String(!!this.options.panel));
    if (this.right) this.right.toggleClass('is-settings', !!this.options.panel);
  }

  /* -- how much is drawn ---------------------------------------------- */

  /** Nothing drawn: why, and what to do about it, in the middle of the view. */
  renderStats() {
    if (!this.empty) return;
    const nodes = this.graph.nodes;
    this.statsHot = !!(this.runner && this.runner.hot);
    const empty = this.empty;
    empty.hidden = nodes.length > 0;
    if (!empty.hidden) {
      const o = this.options;
      empty.empty();
      empty.createDiv({ cls: 'dr-graph3d-title', text: o.local && !this.root && !this.openPath() ? 'Open a note to see what’s around it' : o.search ? `Nothing matches “${o.search}”` : 'No notes yet' });
      empty.createDiv({ cls: 'dr-graph3d-hint', text: o.search || o.local || o.hidden.length ? 'Change what’s shown in Graph settings.' : 'Notes and their links appear here as you write them.' });
    }
  }

  groupCss(key) {
    const slot = this.slotOf && this.slotOf.get(key);
    return slot === undefined ? this.palette.css[0] : this.palette.css[slot];
  }

  /** A community (folder, tag) lit, the rest dimmed, and the camera turned to take it in; again, let go. */
  focusGroup(key) {
    if (this.focusKey === key) {
      this.clearFocus();
      return;
    }
    this.focusKey = key;
    this.picked = -1;
    this.lightChanged();
    this.renderDetail();
    const members = [];
    this.graph.nodes.forEach((n, i) => n.key === key && members.push(i));
    const aim = fitView(this.camera, this.runner.positions, this.graph.nodes.length, this.w || 1, this.h || 1, members);
    if (aim) {
      this.easing = aim;
      this.touched = true;
      this.draw();
    }
  }

  clearFocus() {
    this.focusKey = null;
    this.pick(-1);
  }

  /* -- what's picked --------------------------------------------------- */

  /** The note picked, or the community: what it is, where, and its links, the ways they run. */
  renderDetail() {
    const d = this.detail;
    if (!d) return;
    const nodes = this.graph.nodes;
    const i = this.picked;
    const key = this.focusKey;
    if (!(i >= 0 && nodes[i]) && !key) {
      d.hidden = true;
      return;
    }
    d.empty();
    d.hidden = false;
    d.scrollTop = 0;
    const head = d.createDiv({ cls: 'dr-graph3d-pane-head' });
    const eyebrow = head.createDiv({ cls: 'dr-graph3d-eyebrow' });
    const close = head.createEl('button', { cls: 'clickable-icon dr-graph3d-close' });
    close.setAttribute('aria-label', 'Close');
    close.dataset.act = 'close';
    setIcon(close, 'x');
    this.sections = [];
    if (i >= 0 && nodes[i]) this.noteDetail(d, eyebrow, nodes[i]);
    else this.groupDetail(d, eyebrow, key);
  }

  noteDetail(d, eyebrow, n) {
    const kind = { note: 'Note', file: 'Attachment', tag: 'Tag', missing: 'Not written yet' }[n.kind];
    const folder = n.path ? (n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : 'Vault') : '';
    eyebrow.setText([kind, folder].filter(Boolean).join(' · '));
    d.createDiv({ cls: 'dr-graph3d-name', text: n.name });
    if (n.path) {
      const row = d.createDiv({ cls: 'dr-graph3d-path' });
      row.createEl('code', { text: n.path });
      const copy = row.createEl('button', { cls: 'dr-graph3d-chip', text: 'Copy link' });
      copy.dataset.act = 'copy';
    }
    const facts = d.createEl('dl', { cls: 'dr-graph3d-facts' });
    const noun = GRAPH_3D_NOUNS[this.options.colourBy];
    if (noun && n.key && this.slotOf && this.slotOf.has(n.key)) {
      facts.createEl('dt', { text: noun[0].charAt(0).toUpperCase() + noun[0].slice(1) });
      const b = facts.createEl('dd').createEl('button', { cls: 'dr-graph3d-link' });
      b.dataset.group = n.key;
      b.createSpan({ cls: 'dr-graph3d-dot' }).style.setProperty('--dr-graph3d-dot', this.groupCss(n.key));
      b.createSpan({ text: groupName(this.graph, n.key) });
    }
    facts.createEl('dt', { text: 'Links' });
    facts.createEl('dd', { text: n.degree.toLocaleString() });

    const acts = d.createDiv({ cls: 'dr-graph3d-actions' });
    const act = (name, label, cta) => {
      const b = acts.createEl('button', { cls: cta ? 'mod-cta' : '', text: label });
      b.dataset.act = name;
    };
    if (n.kind === 'note' || n.kind === 'file') {
      act('open', 'Open', true);
      act('tab', 'Open in new tab');
    } else if (n.kind === 'missing') act('open', 'Create it', true);
    act('around', 'Show what’s around it');
    if (n.kind === 'note' || n.kind === 'file') {
      acts.createDiv({ cls: 'dr-graph3d-hint', text: `Or ${Platform.isMobile ? 'tap' : 'click'} it again in the graph.` });
    }

    // Its links, the ways they run: from the index, which knows which way each goes.
    const index = libraryIndex(this.feature.plugin);
    const out = n.kind === 'note' ? index.outgoing(n.path) : {};
    const into = n.path ? index.incoming(n.path) : {};
    const lists = new Map();
    const put = (title, j) => {
      if (!lists.has(title)) lists.set(title, []);
      lists.get(title).push(j);
    };
    const nodes = this.graph.nodes;
    n.near.forEach((j) => {
      const m = nodes[j];
      if (n.kind === 'tag') put('Notes with this tag', j);
      else if (m.kind === 'tag') put('Tags', j);
      else if (m.kind === 'missing') put('Not written yet', j);
      else if (m.kind === 'file' && out[m.path]) put('Attachments', j);
      else {
        if (out[m.path]) put('Links to', j);
        if (into[m.path]) put('Linked from', j);
        if (!out[m.path] && !into[m.path]) put('Linked', j);
      }
    });
    const order = ['Links to', 'Linked from', 'Linked', 'Notes with this tag', 'Tags', 'Attachments', 'Not written yet'];
    order.forEach((title) => {
      if (lists.has(title)) this.addSection(d, title, lists.get(title).sort((a, b) => nodes[b].degree - nodes[a].degree));
    });
  }

  groupDetail(d, eyebrow, key) {
    const noun = GRAPH_3D_NOUNS[this.options.colourBy] || ['group', 'groups'];
    const nodes = this.graph.nodes;
    eyebrow.setText(noun[0].charAt(0).toUpperCase() + noun[0].slice(1));
    d.createDiv({ cls: 'dr-graph3d-name', text: groupName(this.graph, key) });
    const members = [];
    nodes.forEach((n, i) => n.key === key && members.push(i));
    const inside = new Set(members);
    let links = 0;
    for (let k = 0; k < this.graph.links.length; k += 2) if (inside.has(this.graph.links[k]) && inside.has(this.graph.links[k + 1])) links++;
    const facts = d.createEl('dl', { cls: 'dr-graph3d-facts' });
    facts.createEl('dt', { text: 'Notes' });
    facts.createEl('dd', { text: members.length.toLocaleString() });
    facts.createEl('dt', { text: 'Links inside' });
    facts.createEl('dd', { text: links.toLocaleString() });
    if (this.options.colourBy === 'community') {
      const folders = new Map();
      members.forEach((i) => {
        const p = nodes[i].path;
        const f = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : 'Vault';
        folders.set(f, (folders.get(f) || 0) + 1);
      });
      const sec = d.createDiv({ cls: 'dr-graph3d-rel' });
      sec.createDiv({ cls: 'dr-graph3d-heading', text: 'Folders' });
      const ul = sec.createEl('ul', { cls: 'dr-graph3d-folder-list' });
      [...folders].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([f, c]) => {
        const li = ul.createEl('li');
        li.createSpan({ text: f });
        li.createSpan({ cls: 'dr-graph3d-count', text: c.toLocaleString() });
      });
    }
    this.addSection(d, 'Most linked', members.sort((a, b) => nodes[b].degree - nodes[a].degree));
  }

  /** A list of notes under a heading, each a step to it: the first few, the rest on asking. */
  addSection(d, title, list, all) {
    const k = this.sections.length;
    this.sections.push({ title, list });
    const sec = d.createDiv({ cls: 'dr-graph3d-rel' });
    this.fillSection(sec, k, all);
  }

  fillSection(sec, k, all) {
    const { title, list } = this.sections[k];
    sec.empty();
    const h = sec.createDiv({ cls: 'dr-graph3d-heading' });
    h.createSpan({ text: title });
    h.createSpan({ cls: 'dr-graph3d-count', text: list.length.toLocaleString() });
    const ul = sec.createEl('ul');
    const nodes = this.graph.nodes;
    (all ? list : list.slice(0, GRAPH_3D_SHOWN)).forEach((j) => {
      const m = nodes[j];
      const b = ul.createEl('li').createEl('button', { cls: 'dr-graph3d-step' });
      b.dataset.node = String(j);
      b.createSpan({ cls: 'dr-graph3d-dot' }).style.setProperty('--dr-graph3d-dot', this.groupCss(m.key));
      b.createSpan({ cls: 'dr-graph3d-step-name', text: m.name });
      const where = m.path ? (m.path.includes('/') ? m.path.slice(0, m.path.lastIndexOf('/')) : '') : '';
      if (where) b.createSpan({ cls: 'dr-graph3d-step-path', text: where });
    });
    const rest = list.length - GRAPH_3D_SHOWN;
    if (!all && rest > 0) {
      const more = sec.createEl('button', { cls: 'dr-graph3d-more', text: `Show ${rest.toLocaleString()} more` });
      more.dataset.more = String(k);
    }
  }

  detailClick(e) {
    const t = e.target.closest('button');
    if (!t || !this.detail.contains(t)) return;
    const data = t.dataset;
    const node = this.picked >= 0 ? this.graph.nodes[this.picked] : null;
    if (data.node !== undefined) this.pick(+data.node, true);
    else if (data.group !== undefined) this.focusGroup(data.group);
    else if (data.more !== undefined) this.fillSection(t.closest('.dr-graph3d-rel'), +data.more, true);
    else if (data.act === 'close') this.clearFocus();
    else if (data.act === 'open' && node) this.openNode(this.picked, false);
    else if (data.act === 'tab' && node) this.openNode(this.picked, 'tab');
    else if (data.act === 'around' && node) this.showAround(node.id);
    else if (data.act === 'copy' && node) this.copyLink(node, t);
  }

  /** The note's link, as Obsidian would write it here, on the clipboard. */
  copyLink(node, button) {
    const file = this.app.vault.getAbstractFileByPath(node.path);
    const fm = this.app.fileManager;
    const text = file instanceof TFile && fm && typeof fm.generateMarkdownLink === 'function' ? fm.generateMarkdownLink(file, '') : `[[${node.name}]]`;
    const clip = this.host().navigator && this.host().navigator.clipboard;
    const said = (t) => button.setText(t);
    if (!clip) {
      said('Couldn’t copy');
      return;
    }
    clip.writeText(text).then(() => said('Copied'), () => said('Couldn’t copy'));
  }

  /* -- the tip ---------------------------------------------------------- */

  /** What's under the pointer, by it: the note's name, where it is, its community and links. -1 hides it. */
  showTip(i, x, y) {
    const tip = this.tip;
    if (!tip) return;
    if (i < 0 || !this.graph.nodes[i]) {
      tip.hidden = true;
      this.tipFor = -1;
      return;
    }
    const n = this.graph.nodes[i];
    if (this.tipFor !== i) {
      this.tipFor = i;
      tip.empty();
      tip.createDiv({ cls: 'dr-graph3d-tip-name', text: n.name });
      const where = n.path || { tag: 'Tag', missing: 'Not written yet' }[n.kind] || '';
      if (where) tip.createDiv({ cls: 'dr-graph3d-tip-meta', text: where });
      const group = n.key && this.slotOf && this.slotOf.has(n.key) ? groupName(this.graph, n.key) : '';
      tip.createDiv({ cls: 'dr-graph3d-tip-meta', text: [group, `${n.degree} ${n.degree === 1 ? 'link' : 'links'}`].filter(Boolean).join(' · ') });
    }
    tip.hidden = false;
    const w = tip.offsetWidth || 160;
    const h = tip.offsetHeight || 48;
    const left = x + 14 + w > this.w ? Math.max(4, x - 14 - w) : x + 14;
    const top = y + 14 + h > this.h ? Math.max(4, y - 14 - h) : y + 14;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
}
