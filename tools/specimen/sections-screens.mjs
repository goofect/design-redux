// The specimen's screens, drawn by the plugin itself: its source runs on a
// sample vault (with Obsidian stood in for, as in the suites) and the markup
// it builds is taken as it is. Only the glyphs are filled in, since the
// stand-in's setIcon draws none. What is shown is what the plugin makes.
import { createRequire } from 'node:module';
import { root, glyph, esc, section } from './kit.mjs';
import { logic } from './data.mjs';

const require = createRequire(import.meta.url);

/** The stand-in's empty icons, as the glyphs they name. */
const glyphs = (html) => html.replace(/<svg[^>]*data-glyph="([a-z-]+)"[^>]*><\/svg>/g, (all, name) => glyph(name));
/** One screen in a frame of a set size. */
const frame = (caption, w, h, html, cls = '') => `<figure class="spec-shown"><div class="spec-screen ${cls}" style="width:${w}px;${h ? `height:${h}px` : ''}">${glyphs(html)}</div><figcaption class="dr-small dr-muted">${esc(caption)}</figcaption></figure>`;

const words = (n) => Array.from({ length: n }, (_, i) => ['proof', 'line', 'premise', 'valid', 'row', 'case'][i % 6]).join(' ');

/** The sample vault: Logic as in the rest of the specimen, a few projects, and notes that name each other. */
function vault() {
  const files = {
    'Logic/Logic.md': '---\nalbum: subject\ndescription: Arguments and their forms.\n---\n',
    'Reading/Hume.md': '---\nparent: "[[Truth tables]]"\ndomain: epistemology\n---\nSee [[Truth tables]].\n',
    'Reading/Kant.md': '---\ndomain: epistemology\n---\nOn [[Truth tables]] and more.\n',
    'Essays/Validity, again.md': '---\ndomain: formal\n---\n',
    'Projects/Plan.md': '', 'Projects/Thesis/Outline.md': '', 'Projects/Thesis/Chapter 1.md': '', 'Projects/Thesis/Chapter 2.md': '',
    'Projects/Garden/Beds.md': '', 'Projects/Garden/Tools.md': '', 'Projects/Garden/Seeds/Beans.md': '', 'Projects/Garden/Seeds/Peas.md': '', 'Projects/Garden/Seeds/Kale.md': '',
  };
  logic.forEach((n) => {
    if (n.title === 'Truth tables') return;
    files[`Logic/${n.title}.md`] = `---\nstatus: ${n.number % 3 ? 'done' : 'draft'}\ncourse: Logic\nweek: ${Math.ceil(n.number / 4)}\n---\n${words(Math.round(n.words / 40))}\n`;
  });
  files['Logic/Truth tables.md'] = [
    '---', 'status: draft', 'course: Logic', 'week: six', 'domain: formal', 'related: "[[Validity and soundness]]"', '---',
    '%%page: Notes%%', '# What a table shows', 'A truth table lists every way the letters of a formula can be true or false, a row each, and what the formula is in that row. [[Hume]]',
    '## Building one', 'Write the letters across the top, then every row of trues and falses beneath them: two letters give four rows, three give eight.',
    '%%page: Proofs%%', 'A proof that the table and the rules agree.', '%%page: Exercises%%', 'Twelve tables to build.', '',
  ].join('\n');
  return files;
}

const SETTINGS = {
  settingsVersion: 102,
  notePageChips: true,
  panelPrimaryProps: 'status, course, week',
  propertyOptions: { status: { draft: { color: 'orange' }, done: { color: 'green' } } },
  propertySchemas: { Logic: [{ key: 'week', type: 'number' }] },
  recentSearches: ['truth', 'hume'],
  propertyRules: [
    { id: 'r1', on: true, name: 'When a note comes into Logic, set course', when: { kind: 'folder', folder: 'Logic' }, set: [{ key: 'course', value: 'Logic' }] },
    { id: 'r2', on: false, name: 'When a note gets #formal, set reviewed', when: { kind: 'tag', tag: 'formal' }, set: [{ key: 'reviewed', value: 'no' }] },
  ],
};

export async function screens() {
  const { load, world, settle } = require(`${root}/tests/harness.js`);
  const dr = load();
  const w = await world(vault(), JSON.parse(JSON.stringify(SETTINGS)));
  const ws = w.app.workspace;
  const feature = (name) => w.plugin.features.find((f) => f.constructor.name === name);
  const tt = w.file('Logic/Truth tables.md');

  // A note open on its second page, with a change or two in its history.
  const leaf = ws.getLeaf();
  await leaf.openFile(tt);
  await w.plugin.notes.write(tt, (fm) => (fm.status = 'review'));
  await w.plugin.notes.write(tt, (fm) => (fm.status = 'draft'));
  await feature('NotePages').open(tt, 'Proofs');
  await settle(6);
  const note = leaf.view.contentEl;
  // The editor's column as the plugin left it (folder, title, the head) with the open page's text in it.
  // The HTML a note holds, as Obsidian draws it in reading view, its progress bar made a control by the plugin.
  const noteHtml = '<div class="markdown-reading-view"><div class="markdown-preview-view markdown-rendered node-insert-event is-readable-line-width"><div class="markdown-preview-sizer markdown-preview-section"><hgroup><h2>Logic</h2><p>A first course</p></hgroup>'
    + '<p>Squares: x<sup>2</sup>; water: H<sub>2</sub>O.</p>'
    + '<details open><summary>Proof</summary><p>By induction on the length of the derivation.</p></details>'
    + '<details><summary>Exercises</summary><p>Twelve tables to build.</p></details>'
    + '<p>Done so far: <progress class="dr-progress" role="slider" tabindex="0" value="3" max="5" aria-valuenow="3" aria-valuemax="5"></progress></p></div></div></div>';
  const sizer = note.querySelector('.cm-sizer').outerHTML.replace('<div class="cm-content"></div>', '<div class="cm-content"><p>A proof that the table and the rules agree: whatever the rules let you write from some premises, every row of the table that makes the premises true makes it true as well.</p><p>The other way round needs more, and it is the next chapter’s.</p></div>');
  const page = `<div class="spec-note"><div class="spec-note-text">${sizer}</div></div>`;

  // The library: the sidebar at the vault's top, a folder's page, then searching.
  const library = ws.getLeavesOfType('design-redux-library')[0].view.screen;
  library.draw();
  library.query = 'tab';
  library.draw();
  const searchFound = library.host.outerHTML;
  library.search(null);

  // The browse view: the grid of the folders' names, then a filter on.
  const browse = (await feature('Library').browse(null)).view.screen;
  await settle();
  // A folder shown in the page, the tree marking it: the two panes side by side.
  browse.go(w.file('Logic'));
  await settle();
  library.draw();
  const sidebarFolder = library.host.outerHTML;
  const folderPage = browse.host.outerHTML;
  browse.go(null);
  await settle();
  browse.setFilter({ folder: 'Logic', prop: 'status=draft' }, 'Drafts in Logic');
  await settle();
  const filtered = browse.host.outerHTML;

  // A map of the projects, Thesis picked, the seeds folded.
  const mapLeaf = await feature('Maps').open(w.file('Projects'));
  await settle();
  const map = mapLeaf.view;
  const thesis = map.root.children.find((c) => c.label === 'Thesis');
  map.picked = thesis.id;
  map.draw();
  const mapHtml = map.contentEl.outerHTML;

  // The rules sheet, and the settings page.
  const sheet = feature('PropertyRules').edit();
  const rules = sheet.dialog.outerHTML.replace('<dialog class="dr dr-sheet"', '<dialog class="dr dr-sheet spec-dialog"');
  sheet.close();
  const tab = new dr.SettingsTab(w.app, w.plugin);
  tab.display();
  const settingsPage = `<div class="spec-settings">${tab.containerEl.innerHTML}</div>`;

  // The 3D graph: its notes laid out by the same code, drawn as it draws them.
  const n = 42;
  const links = Array.from({ length: n }, (_, i) => [i, (i * 5 + 3) % n]).concat(Array.from({ length: n }, (_, i) => [i, (i + 1) % n]));
  const laid = dr.layoutSpace(n, links);
  const fit = dr.fitView(laid, 720, 400);
  const zoom = fit.zoom;
  const radius = dr.spaceRadius(laid);
  const at = dr.project(laid, { yaw: 0.6, pitch: 0.35, w: 720, h: 400, radius, ...fit });
  const degree = new Array(n).fill(0);
  links.forEach(([a, b]) => { degree[a]++; degree[b]++; });
  const byDepth = Array.from({ length: n }, (_, i) => i).sort((a, b) => at[a * 4 + 2] - at[b * 4 + 2]);
  const [picked, current] = [byDepth[n - 3], byDepth[n - 8]];
  // Drawn as the canvas draws it: far to near, each sphere lit from the lighter tone, each line fainter the further it is.
  const near = (z) => Math.max(0, Math.min(1, (z / radius + 1) / 2));
  const unit = dr.sphereUnit(laid, links);
  const parts = dr.drawOrder(at, links).map((it) => {
    if (it.link) {
      const [a, b] = it.link;
      const width = Math.max(0.75, 1.6 * (at[a * 4 + 3] + at[b * 4 + 3]) / 2);
      return `<line class="spec-graph-line" x1="${at[a * 4].toFixed(1)}" y1="${at[a * 4 + 1].toFixed(1)}" x2="${at[b * 4].toFixed(1)}" y2="${at[b * 4 + 1].toFixed(1)}" stroke-width="${width.toFixed(2)}" opacity="${(0.25 + 0.5 * near(it.depth)).toFixed(2)}"/>`;
    }
    const i = it.sphere;
    const r = dr.sphereRadius(degree[i], at[i * 4 + 3], zoom, unit);
    const [x, y] = [at[i * 4].toFixed(1), at[i * 4 + 1].toFixed(1)];
    const ring = i === picked || i === current ? `<circle class="spec-graph-ring" cx="${x}" cy="${y}" r="${(r + 3).toFixed(1)}"/>` : '';
    const haze = 0.6 * (1 - near(it.depth));
    return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="url(#spec-sphere)"/><circle class="spec-graph-haze" cx="${x}" cy="${y}" r="${(r + 0.5).toFixed(1)}" opacity="${haze.toFixed(2)}"/>${ring}`;
  }).join('');
  const sphere = '<defs><radialGradient id="spec-sphere" cx="0.325" cy="0.3" r="0.5" fx="0.325" fy="0.3"><stop offset="0" class="spec-lit"/><stop offset="0.55" class="spec-shade"/><stop offset="1" class="spec-shade"/></radialGradient></defs>';
  const graph = `<div class="dr dr-graph3d"><div class="dr-head"><span class="dr-head-name dr-clip">3D graph</span>${['fit', 'plus', 'minus'].map((g) => `<div class="dr-icon-button" role="button" aria-label="${g}">${glyph(g)}</div>`).join('')}</div><div class="dr-graph3d-box"><svg class="spec-graph" viewBox="0 0 720 400" width="720" height="400">${sphere}${parts}</svg><div class="dr-graph3d-name dr-text">Proof by contradiction</div></div></div>`;

  w.plugin.unload();
  return section('library', 'The library', 'Drawn by the plugin itself on a sample vault. Two panes on the ground, no frame, no line: labels in capitals, parted by space. The sidebar: VAULT and SETTINGS, then the folders, grey but the one open. The page: the path, the folders above grey and this one black, then only the notes in it.',
    `<div class="spec-states is-close">${frame('the sidebar, a folder open', 320, 560, sidebarFolder, 'is-side')}${frame('a folder, in the page', 640, 560, folderPage)}</div>`)
    + section('screens-note', 'The note', 'Round the note’s title, in its own column: the folder’s name as a link over it; under it the ledger, each property a row, its name a grey label and its value ink, edited where it stands (a value its folder’s schema finds wrong is red, with why); its pages as words, grey, the open one ink; space; the text. No control, no heading, no panel. Beside it, the HTML a note may hold: a heading group, its line grey; superscript and subscript; a disclosure open and one folded, an ellipsis after it; a progress bar the person sets, done in ink and the rest grey.',
    `<div class="spec-states is-close">${frame('a note on its second page', 720, 560, page, 'is-note')}${frame('the HTML a note holds, in reading view', 560, 560, noteHtml, 'is-note')}</div>`)
    + section('screens-library', 'Search, and a filter', 'The sidebar searching: what is typed, and what it finds by name and inside notes. A filter in the browse view: its name large, its parts as words that take themselves off, what passes as rows.',
      `<div class="spec-states is-close">${frame('search: “tab”', 320, 520, searchFound, 'is-side')}${frame('a filter, in the browse view', 640, 520, filtered)}</div>`)
    + section('screens-maps', 'The map and the 3D graph', 'A folder as a tree: words on the ground joined by 1px lines, the one picked underlined, a folded branch marked +. The 3D graph in perspective: notes as spheres lit from the grey to the ink, the more linked the larger; near ones larger and darker, far ones fainter, and the lines between them fainter with distance; the picked note and the open one ringed.',
      `<div class="spec-states is-close">${frame('the map of Projects, Thesis picked', 720, 440, mapHtml)}${frame('the 3D graph', 720, 448, graph)}</div>`)
    + section('screens-sheets', 'A sheet, and the settings page', 'Property rules: each said as a sentence, its toggle beside it; a new one written as a sentence with fields. The settings page: Obsidian’s own rows, a name, what it does and a toggle each, the features under a heading; nothing else.',
      `<div class="spec-states is-close">${frame('property rules', 400, null, rules)}${frame('the settings page', 680, null, settingsPage)}</div>`);
}
