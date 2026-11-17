// The specimen's screens, drawn by the plugin itself: its source runs on a
// sample vault (with Obsidian stood in for, as in the suites) and the markup
// it builds is taken as it is. Only the glyphs are filled in, since the
// stand-in's setIcon draws none. What is shown is what the plugin makes.
import { createRequire } from 'node:module';
import { root, glyph, esc, section } from './kit.mjs';
import { logic } from './data.mjs';

const require = createRequire(import.meta.url);

/** The stand-in's empty icons, as the glyphs they name. */
const native = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/>',
  'file-text': '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 12h6M9 16h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
};
const glyphs = (html) => html.replace(/<svg[^>]*data-glyph="([a-z-]+)"[^>]*><\/svg>/g, (all, name) => glyph(name))
  .replace(/<svg[^>]*data-icon="(folder|file|file-text|search)"[^>]*><\/svg>/g, (all, name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${native[name]}</svg>`);
/** One screen in a frame of a set size. */
const frame = (caption, w, h, html, cls = '') => `<figure class="spec-shown"><div class="spec-screen ${cls}" style="width:${w}px;${h ? `height:${h}px` : ''}">${glyphs(html)}</div><figcaption class="dr-label dr-muted">${esc(caption)}</figcaption></figure>`;

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
  settingsVersion: 100,
  contextStrip: true,
  notePageChips: true,
  panelPrimaryProps: 'status, course, week',
  panelPropertyGroups: 'on',
  panelGroupList: [{ title: 'General', keys: 'status, course, week, domain' }, { title: 'Relationships', keys: 'parent, related' }],
  panelFoldedGroups: [],
  propertyOptions: { status: { draft: { color: 'orange' }, done: { color: 'green' } } },
  propertySchemas: { Logic: [{ key: 'week', type: 'number' }] },
  propertyHistoryLimit: 5,
  coverColors: { 'Projects/Garden': 'moss' },
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

  // The library contains folders; the folder view contains notes.
  const folder = w.file('Logic');
  const browseLeaf = await feature('Library').browse(folder);
  const library = browseLeaf.view.folderScreen;
  library.go(folder);
  await settle();
  const fileSidebar = library.host.outerHTML;
  const fileBrowse = browseLeaf.view.screen.host.outerHTML;

  // The 3D graph: its notes laid out by the same code, drawn as it draws them.
  const n = 42;
  const links = Array.from({ length: n }, (_, i) => [i, (i * 5 + 3) % n]).concat(Array.from({ length: n }, (_, i) => [i, (i + 1) % n]));
  const laid = dr.layoutSpace(n, links);
  const zoom = dr.fitZoom(laid, 720, 400);
  const at = dr.project(laid, { yaw: 0.6, pitch: 0.35, zoom, w: 720, h: 400 });
  const degree = new Array(n).fill(0);
  links.forEach(([a, b]) => { degree[a]++; degree[b]++; });
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => at[a * 3 + 2] - at[b * 3 + 2]);
  const [picked, current] = [order[n - 3], order[n - 8]];
  const sq = (i) => { const h = Math.round(Math.max(3, Math.min(12, 2 + Math.sqrt(degree[i]) * 1.5) * Math.max(0.6, Math.min(2, zoom)))) + (i === picked || i === current ? 2 : 0); return [Math.round(at[i * 3] - h), Math.round(at[i * 3 + 1] - h), h * 2]; };
  const graph = `<div class="dr dr-graph3d"><div class="dr-head"><span class="dr-label dr-clip">3D graph <span class="dr-muted">${n} notes · ${links.length} links</span></span>${['fit', 'plus', 'minus'].map((g) => `<div class="dr-icon-button" role="button" aria-label="${g}">${glyph(g)}</div>`).join('')}</div><div class="dr-graph3d-box"><svg class="spec-graph" viewBox="0 0 720 400" width="720" height="400"><path class="spec-graph-links" d="${links.map(([a, b]) => `M${at[a * 3].toFixed(1)} ${at[a * 3 + 1].toFixed(1)}L${at[b * 3].toFixed(1)} ${at[b * 3 + 1].toFixed(1)}`).join('')}"/>${order.map((i) => { const [x, y, s] = sq(i); const mark = i === picked || i === current; return `<rect class="${mark ? 'is-clay' : 'is-ink'}" x="${x}" y="${y}" width="${s}" height="${s}"/>${mark ? `<rect class="spec-graph-ring${i === picked ? ' is-picked' : ''}" x="${x + 0.5}" y="${y + 0.5}" width="${s - 1}" height="${s - 1}"/>` : ''}`; }).join('')}</svg><div class="dr-graph3d-name dr-text">Proof by contradiction</div></div></div>`;

  w.plugin.unload();
  return section('files', 'Library and folder', 'The library lists folders. The selected folder lists notes.', `<div class="spec-states is-close">${frame('library', 320, 560, fileSidebar)}${frame('folder', 720, 560, fileBrowse)}</div>`)
    + section('screens-maps', 'The 3D graph', 'The graph retains its separate view.', `<div class="spec-states is-close">${frame('the 3D graph', 720, 448, graph)}</div>`);
}
