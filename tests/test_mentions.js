// Mentions in the properties panel, against the real main.js: linked
// mentions without the note's own links to itself, and unlinked
// mentions searched from note text the way Obsidian finds them.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.CSS = { escape: (s) => s };

const P = dom.window.HTMLElement.prototype;
const apply = (el, o) => {
  if (!o) return el;
  if (typeof o === 'string') { el.className = o; return el; }
  if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text !== undefined) el.textContent = o.text;
  return el;
};
P.createEl = function (tag, o) { return apply(this.appendChild(document.createElement(tag)), o); };
P.createDiv = function (o) { return this.createEl('div', o); };
P.createSpan = function (o) { return this.createEl('span', o); };
P.addClass = function (...c) { this.classList.add(...c); };
P.removeClass = function (...c) { this.classList.remove(...c); };
P.toggleClass = function (c, on) { this.classList.toggle(c, !!on); };
P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
P.setText = function (t) { this.textContent = t; };

const obsidian = new Proxy({
  setIcon: (el, name) => { el.dataset.icon = name; },
  Platform: { isMobile: false },
}, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_mentions_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { MentionsSection, unlinkedMentions, mentionNames };\n');
const M = require(tmp).__test;
fs.unlinkSync(tmp);

/* -- a vault like the one in the screenshot ---------------------------- */

/** A note, with its links, tags and frontmatter found by position, as Obsidian's cache has them. */
function note(p, text, fm) {
  const file = { path: p, basename: p.replace(/\.md$/, '').split('/').pop(), extension: 'md' };
  const at = (start, end) => ({ start: { offset: start }, end: { offset: end } });
  const links = [];
  const embeds = [];
  const tags = [];
  for (const m of text.matchAll(/(!?)\[\[[^\]]+\]\]/g)) {
    (m[1] ? embeds : links).push({ position: at(m.index, m.index + m[0].length) });
  }
  for (const m of text.matchAll(/\[[^\]]*\]\([^)]*\)/g)) links.push({ position: at(m.index, m.index + m[0].length) });
  for (const m of text.matchAll(/#[\w/]+/g)) tags.push({ position: at(m.index, m.index + m[0].length) });
  const fmEnd = text.startsWith('---\n') ? text.indexOf('\n---', 4) + 4 : -1;
  const cache = {
    links, embeds, tags,
    frontmatter: fm || undefined,
    frontmatterPosition: fmEnd > 0 ? at(0, fmEnd) : undefined,
  };
  return { file, text, cache };
}

const vault = [
  note('Court.md', '---\naliases: [Tribunal]\n---\n# Court\n[[Court#Summary|i. Summary]]\n[[#Background]]', { aliases: ['Tribunal'] }),
  note('Supreme Court.md', 'The highest [[Court]].\nA court of last resort.\nCourt, again.'),
  note('Constitutional Court.md', 'Links to [[Court|the court]] only.'),
  note('Judiciary.md', '---\nrelated: Court\n---\nEvery court sits here.\nSee #court and ![[Court]].'),
  note('Tribunals.md', 'An administrative tribunal decides.'),
  note('Courtesy.md', 'Courtesy and courtyards are not courts.'),
  note('Legal.md', 'Nothing relevant.'),
  note('Accents.md', 'La Court suprême; Courtroom; court-appointed.'),
];
const byPath = Object.fromEntries(vault.map((n) => [n.file.path, n]));
const court = byPath['Court.md'].file;

const app = {
  vault: {
    getMarkdownFiles: () => vault.map((n) => n.file),
    cachedRead: async (f) => byPath[f.path].text,
    getFileByPath: (p) => (byPath[p] ? byPath[p].file : null),
  },
  metadataCache: {
    getFileCache: (f) => byPath[f.path].cache,
    // Obsidian's shape: a map of linking path to its link occurrences.
    getBacklinksForFile: () => ({
      data: new Map([
        ['Court.md', [{}, {}]],
        ['Supreme Court.md', [{}]],
        ['Constitutional Court.md', [{}]],
      ]),
    }),
  },
  workspace: {
    opened: [],
    getLeaf() { return { openFile: (file, state) => app.workspace.opened.push([file.path, state]) }; },
    openLinkText(p) { app.workspace.opened.push([p]); },
  },
};

function section() {
  const panel = { plugin: { app, settings: {} }, closed: 0, close() { this.closed++; } };
  const sec = new M.MentionsSection(panel);
  const host = document.body.appendChild(document.createElement('div'));
  sec.mount(host, court);
  return { sec, panel, host };
}
const names = (el) => Array.from(el.querySelectorAll('.dr-mention-name')).map((e) => e.textContent);
const settle = () => new Promise((r) => setTimeout(r, 20));

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };

(async () => {
  await t("a note's links to itself aren't linked mentions of it", () => {
    const { host } = section();
    const linked = host.querySelector('.dr-mention-group.is-linked');
    assert.deepStrictEqual(names(linked), ['Constitutional Court', 'Supreme Court']);
    assert.strictEqual(linked.querySelector('.dr-section-count').textContent, '2');
  });

  await t('a name counts as its title and its aliases', () => {
    assert.deepStrictEqual(M.mentionNames(app, court), ['Court', 'Tribunal']);
  });

  await t('unlinked mentions: whole words in any case, outside links, tags and frontmatter', async () => {
    const found = await M.unlinkedMentions(app, court);
    const summary = found.map((f) => [f.file.basename, f.count]);
    assert.deepStrictEqual(summary, [
      ['Accents', 2], // "Court suprême" and "court-appointed"; not "Courtroom"
      ['Judiciary', 1], // "Every court" — not the frontmatter, the tag or the embed
      ['Supreme Court', 2], // the unlinked two, not the [[Court]] link
      ['Tribunals', 1], // by its alias
    ]);
  });

  await t('the note itself, and names inside longer words, are never mentions', async () => {
    const found = (await M.unlinkedMentions(app, court)).map((f) => f.file.basename);
    assert.ok(!found.includes('Court'));
    assert.ok(!found.includes('Courtesy'));
    assert.ok(!found.includes('Constitutional Court'), 'only a link there');
  });

  await t('each remembers the line of its first mention', async () => {
    const found = await M.unlinkedMentions(app, court);
    assert.strictEqual(found.find((f) => f.file.basename === 'Supreme Court').line, 1);
    assert.strictEqual(found.find((f) => f.file.basename === 'Judiciary').line, 3);
  });

  await t('unlinked starts folded, and searches only when opened', async () => {
    let reads = 0;
    const read = app.vault.cachedRead;
    app.vault.cachedRead = async (f) => { reads++; return read(f); };
    try {
      const { host } = section();
      const group = host.querySelector('.dr-mention-group.is-unlinked');
      assert.ok(group.classList.contains('is-collapsed'));
      await settle();
      assert.strictEqual(reads, 0, 'searched while folded');

      group.querySelector('.dr-section-head').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      assert.strictEqual(group.querySelector('.dr-empty').textContent, 'Searching…');
      await settle();
      assert.deepStrictEqual(names(group), ['Accents', 'Judiciary', 'Supreme Court', 'Tribunals']);
      assert.strictEqual(group.querySelector('.dr-section-count').textContent, '4');
    } finally {
      app.vault.cachedRead = read;
    }
  });

  await t('the groups stay as they were left when the panel opens again', async () => {
    const first = section();
    const head = first.host.querySelector('.is-unlinked .dr-section-head');
    head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // A new section, as the panel builds each time it opens, on the same panel.
    const again = new M.MentionsSection(first.panel);
    const host = document.body.appendChild(document.createElement('div'));
    again.mount(host, court);
    assert.ok(!host.querySelector('.is-unlinked').classList.contains('is-collapsed'));
    await settle();
    assert.strictEqual(names(host.querySelector('.is-unlinked')).length, 4);
  });

  await t('an unlinked mention opens its note at the line, and the panel closes', async () => {
    const { host, panel } = section();
    const group = host.querySelector('.is-unlinked');
    if (group.classList.contains('is-collapsed')) {
      group.querySelector('.dr-section-head').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }
    await settle();
    app.workspace.opened = [];
    const row = Array.from(group.querySelectorAll('.dr-mention')).find((r) => r.textContent.startsWith('Judiciary'));
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepStrictEqual(app.workspace.opened, [['Judiciary.md', { eState: { line: 3 } }]]);
    assert.strictEqual(panel.closed, 1);
  });

  await t("a search that finishes after the panel moved on doesn't draw", async () => {
    const { sec, host } = section();
    sec.panel.mentionFolds.unlinked = false;
    sec.containerEl.empty();
    sec.render();
    sec.file = byPath['Legal.md'].file; // followed another note mid-search
    await settle();
    assert.strictEqual(host.querySelector('.is-unlinked .dr-empty').textContent, 'Searching…');
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
