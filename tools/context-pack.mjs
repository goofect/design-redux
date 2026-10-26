#!/usr/bin/env node
/*
 * A task's context in one bounded, reproducible packet: who owns the code,
 * what it declares, who calls it, its styles, the rules it must keep and the
 * suites that test it — built from tests/map.js's index, not a parser of its own.
 *
 *   node tools/context-pack.mjs --feature inspector [--budget 3000]
 *   node tools/context-pack.mjs --files src/library/122-browse-editing.js [--budget 2500] [--format markdown|json]
 *
 * --feature WORDS  the pieces whose name, heading, header comment or classes hold every word,
 *                  or that declare a name exactly (e.g. PropertiesPanel)
 * --files PATHS    the pieces at these paths (or numbers: 122, 122-browse-editing)
 * --budget N       about how many tokens the packet may take (default 3000);
 *                  the long sections are cut from their ends to fit, and the
 *                  budget report says what was left out
 * --format F       markdown (default) or json
 *
 * An unknown feature or file fails with names that come close, never with the
 * whole source. The same commit gives the same packet.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const tokens = (text) => Math.ceil(text.length / 4);

/* -- arguments ------------------------------------------------------- */

function parseArgs(argv) {
  const opts = { feature: [], files: [], budget: 3000, format: 'markdown' };
  let list = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--feature') list = opts.feature;
    else if (a === '--files') list = opts.files;
    else if (a === '--budget') opts.budget = Number(argv[++i]);
    else if (a === '--format') opts.format = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (list) list.push(a);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.help && !opts.feature.length && !opts.files.length) throw new Error('give --feature WORDS or --files PATHS');
  if (!(opts.budget > 0)) throw new Error('--budget takes a positive number of tokens');
  if (!['markdown', 'json'].includes(opts.format)) throw new Error('--format is markdown or json');
  return opts;
}

/* -- what the index knows -------------------------------------------- */

function loadIndex() {
  const out = execFileSync(process.execPath, [path.join(root, 'tests', 'map.js'), '--json'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const index = JSON.parse(out.toString());
  index.pieces.forEach((p) => (p.text = read(p.file)));
  index.homeOf = new Map();
  index.pieces.forEach((p) => Object.keys(p.declared).forEach((n) => index.homeOf.set(n, p)));
  return index;
}

/** Edit distance, for suggestions. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The words a piece goes by: its name, heading, header comment and class names. */
function wordsOf(p) {
  const header = (p.text.match(/^(?:\/\*[^\n]*\n|\s*\*[^\n]*\n|\/\/[^\n]*\n)+/) || [''])[0];
  const classes = Object.keys(p.declared).filter((n) => /^[A-Z][a-z]/.test(n));
  return [p.name, p.heading, header, p.features.join(' '), classes.join(' ')].join(' ').toLowerCase();
}

/** Pieces and classes with a word close to one asked for, nearest first. */
function suggest(index, words) {
  const scored = [];
  index.pieces.forEach((p) => {
    const own = wordsOf(p)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
    const best = Math.min(...words.map((w) => Math.min(...own.map((t) => distance(w, t)))));
    if (best <= Math.max(1, Math.floor(Math.min(...words.map((w) => w.length)) / 4))) scored.push([best, p.name]);
  });
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    .slice(0, 8)
    .map(([, c]) => c);
}

function select(index, opts) {
  const chosen = new Set();
  const unknown = [];
  if (opts.feature.length) {
    const words = opts.feature.map((w) => w.toLowerCase());
    const exact = words.length === 1 ? index.homeOf.get(opts.feature[0]) : null;
    if (exact) chosen.add(exact);
    else
      index.pieces.forEach((p) => {
        const line = wordsOf(p);
        if (words.every((w) => line.includes(w))) chosen.add(p);
      });
    if (!chosen.size) unknown.push({ asked: opts.feature.join(' '), near: suggest(index, words) });
  }
  opts.files.forEach((f) => {
    const want = f.replace(/^\.\//, '').replace(/^src\//, '').replace(/\.js$/, '');
    const p = index.pieces.find((q) => q.file === `src/${want}.js` || q.name === want || q.name.startsWith(`${want}-`) || q.name === path.basename(want));
    if (p) chosen.add(p);
    else {
      const base = path.basename(want);
      const near = index.pieces.filter((q) => q.name.split('-')[0] === base.split('-')[0] || distance(base, q.name) <= 3).map((q) => q.name);
      unknown.push({ asked: f, near: near.slice(0, 8) });
    }
  });
  return { pieces: [...chosen].sort((a, b) => a.name.localeCompare(b.name)), unknown };
}

/* -- the sections ---------------------------------------------------- */

const short = (s, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function ownership(index, pieces) {
  const lines = pieces.map((p) => {
    const below = index.areas.filter((a) => a.name === p.area || a.level < p.level || p.level === 3).map((a) => a.name);
    const bits = [`${p.name} (${p.file}, area ${p.area})`];
    if (p.heading) bits.push(p.heading);
    if (p.features.length) bits.push(`features: ${p.features.join(', ')}`);
    bits.push(`may import from: ${below.join(', ')}`);
    return bits.join(' — ');
  });
  return { title: 'Objective and ownership', lines, trim: false };
}

/** Top-level names with their line, and each class's methods (two-space indent, as the source is written). */
function definitions(pieces) {
  const lines = [];
  pieces.forEach((p) => {
    const src = p.text.split('\n');
    lines.push(`${p.file}:`);
    Object.entries(p.declared)
      .sort((a, b) => a[1] - b[1])
      .forEach(([name, at]) => {
        lines.push(`  ${at}: ${short(src[at - 1].trim())}`);
        if (!new RegExp(`^(export )?class ${name.replace(/\$/g, '\\$')}\\b`).test(src[at - 1])) return;
        for (let i = at; i < src.length && !/^}/.test(src[i]); i++) {
          const m = src[i].match(/^ {2}((?:async |static |get |set )*[A-Za-z_$][\w$]*)\((.*)\) \{$/);
          if (m && !/^(if|for|while|switch|catch)$/.test(m[1])) lines.push(`    ${i + 1}: ${short(`${m[1]}(${m[2]})`, 90)}`);
        }
      });
  });
  return { title: 'Relevant definitions', lines, trim: true };
}

function callMap(index, pieces) {
  const lines = [];
  const chosen = new Set(pieces);
  pieces.forEach((p) => {
    const from = new Map();
    Object.entries(p.uses).forEach(([n, u]) => u.from && u.from !== p.name && from.set(u.from, (from.get(u.from) || []).concat(n)));
    lines.push(`${p.name} uses: ${[...from.keys()].sort().map((h) => `${h} (${from.get(h).sort().join(', ')})`).join('; ') || 'nothing from other pieces'}`);
    const names = Object.keys(p.declared);
    const by = index.pieces
      .filter((q) => q !== p && names.some((n) => own(q.uses, n)))
      .map((q) => `${q.name}${chosen.has(q) ? '*' : ''} (${names.filter((n) => own(q.uses, n)).join(', ')})`);
    lines.push(`${p.name} used by: ${by.join('; ') || 'no other piece'}`);
    const events = [...new Set(p.text.match(/'design-redux:[a-z-]+'/g) || [])].sort();
    events.forEach((e) => {
      const sends = new RegExp(`trigger\\(\\s*${e}`).test(p.text);
      const hears = new RegExp(`\\.on\\(\\s*${e}`).test(p.text);
      const others = index.pieces.filter((q) => q !== p && q.text.includes(e)).map((q) => q.name);
      lines.push(`  event ${e}: ${[sends && 'sends', hears && 'listens'].filter(Boolean).join(' and ') || 'names'}; also in ${others.join(', ') || 'no other piece'}`);
    });
  });
  return { title: 'Caller/callee map', lines, trim: true };
}

let stylesCache = null;
function styles() {
  if (!stylesCache)
    stylesCache = fs
      .readdirSync(path.join(root, 'styles'))
      .filter((f) => f.endsWith('.css'))
      .sort()
      .map((f) => ({ file: `styles/${f}`, lines: read(`styles/${f}`).split('\n') }));
  return stylesCache;
}

function classesOf(text) {
  const found = new Set();
  // Class names the plugin writes: dr-…, in cls/addClass/toggleClass strings and selectors.
  (text.match(/(?<![\w-])dr-[a-z0-9]+(?:-[a-z0-9]+)*(?![\w$-]*\$\{)/g) || []).forEach((c) => found.add(c));
  return [...found].sort();
}

function cssMap(pieces) {
  const lines = [];
  const unstyled = [];
  const dynamic = pieces.some((p) => /dr-[a-z-]*\$\{/.test(p.text));
  const classes = [...new Set(pieces.flatMap((p) => classesOf(p.text)))].sort();
  classes.forEach((c) => {
    const re = new RegExp(`\\.${c}(?![\\w-])`);
    const where = [];
    styles().forEach((s) => {
      const hits = s.lines.map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean);
      if (hits.length) where.push(`${s.file}:${hits.slice(0, 3).join(',')}${hits.length > 3 ? ` +${hits.length - 3}` : ''}`);
    });
    if (where.length) lines.push(`.${c} → ${where.join('; ')}`);
    else unstyled.push(c);
  });
  return { section: { title: 'CSS map', lines, trim: true }, unstyled, dynamic };
}

/** Rules a change here must keep: .claude/rules notes for these files, and what the source itself shows. */
function invariants(pieces) {
  const lines = [];
  const rulesDir = path.join(root, '.claude', 'rules');
  const globRe = (g) => new RegExp(`^${g.replace(/[.+^$()|{}]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
  if (fs.existsSync(rulesDir))
    fs.readdirSync(rulesDir)
      .sort()
      .forEach((f) => {
        const text = fs.readFileSync(path.join(rulesDir, f), 'utf8');
        const globs = (text.match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1].match(/"([^"]+)"/g) || [];
        const hit = pieces.filter((p) => globs.some((g) => globRe(g.slice(1, -1)).test(p.file)));
        const title = (text.match(/^# (.+)$/m) || [, f])[1];
        if (hit.length) lines.push(`read .claude/rules/${f} (${title}) — applies to ${hit.map((p) => p.name).join(', ')}`);
      });
  const snap = JSON.parse(read('tests/snapshots/lifecycle.json'));
  pieces.forEach((p) => {
    const quoted = (id) => p.text.includes(`'${id}'`) || p.text.includes(`"${id}"`);
    const cmds = snap.commands.filter(quoted);
    const keys = snap.settings.filter((k) => new RegExp(`settings\\.${k}\\b`).test(p.text) || p.text.includes(`settingKey = '${k}'`));
    const views = snap.views.filter(quoted);
    if (cmds.length) lines.push(`${p.name}: command ids ${short(cmds.join(', '), 160)} — hotkeys hang on them; keep (tests/snapshots/lifecycle.json)`);
    if (keys.length) lines.push(`${p.name}: setting keys ${short(keys.join(', '), 160)} — persisted; keep or migrate`);
    if (views.length) lines.push(`${p.name}: view types ${views.join(', ')} — saved in workspaces; keep`);
    if (/notes\.write\(/.test(p.text)) lines.push(`${p.name}: writes properties through plugin.notes.write (keeps Undo); never processFrontMatter`);
    if (/processFrontMatter/.test(p.text)) lines.push(`${p.name}: names processFrontMatter — check it isn't a write that bypasses plugin.notes`);
    if (/plugin\.files\.|\.moveFile\(/.test(p.text)) lines.push(`${p.name}: moves files through plugin.files; keep path-keyed settings following renames`);
    if (/PATH_KEYED/.test(p.text)) lines.push(`${p.name}: path-keyed settings (PATH_KEYED) follow renames and deletes`);
    if (/coordinator/.test(p.text)) lines.push(`${p.name}: the inspector's target, origin and pin are plugin.coordinator's; no second copy`);
    if (/plugin\.selection|selection\.(pick|clear)/.test(p.text)) lines.push(`${p.name}: plugin.selection is the single pick, apart from what's open and from ticked (bulk) paths`);
    if (/\bdocument\./.test(p.text)) lines.push(`${p.name}: uses the global document — popouts and the settings window need el.ownerDocument`);
    if (/extends (Modal|SuggestModal|FuzzySuggestModal)\b/.test(p.text)) lines.push(`${p.name}: a Modal subclass — no field called scope`);
    if (/addItem\(/.test(p.text) && !/setSection\(/.test(p.text)) lines.push(`${p.name}: adds menu items but sets no section — Obsidian sorts them last`);
  });
  return { title: 'Invariants', lines, trim: false };
}

function testsSection(pieces) {
  const lines = [];
  const suites = new Map();
  // test_context_pack names pieces to test this tool, not to test them.
  pieces.forEach((p) => p.suites.filter((s) => s !== 'context_pack').forEach((s) => suites.set(s, (suites.get(s) || []).concat(p.name))));
  [...suites.keys()].sort().forEach((s) => lines.push(`${s === 'obsidian' ? 'tests/obsidian (real Obsidian, tests/e2e.sh)' : `tests/test_${s}.js`} — names what ${suites.get(s).join(', ')} declare${suites.get(s).length > 1 ? '' : 's'}`));
  const sims = [...suites.keys()].filter((s) => s !== 'obsidian').sort();
  lines.push(sims.length ? `targeted: node tests/run.js ${sims.join(' ')}` : 'targeted: no suite names these pieces — see missing evidence');
  if (pieces.some((p) => p.features.some((f) => /\(/.test(f)))) lines.push('setting keys or commands touched: node tests/test_lifecycle.js');
  if (pieces.some((p) => Object.values(p.uses).some((u) => u.from))) lines.push('a new import across areas: node tests/map.js --check');
  lines.push('full gate before a PR: npm test');
  return { title: 'Tests', lines, trim: false };
}

function missing(pieces, css) {
  const lines = [];
  pieces.filter((p) => !p.suites.some((s) => s !== 'context_pack')).forEach((p) => lines.push(`${p.name}: no suite names what it declares — its behaviour may be tested only through callers`));
  if (css.unstyled.length) lines.push(`classes with no rule in styles/: ${short(css.unstyled.join(', '), 300)} (unstyled, styled by Obsidian, or used only as hooks)`);
  if (css.dynamic) lines.push('some class names are built at run time (dr-…${…}); their rules are not mapped');
  lines.push('runtime behaviour (Obsidian internals behind typeof checks, timing, layout) is not visible to the index');
  return { title: 'Missing evidence', lines, trim: false };
}

/* -- fitting the budget ---------------------------------------------- */

function render(meta, sections, format) {
  if (format === 'json') return JSON.stringify({ ...meta, sections: sections.map((s) => ({ title: s.title, lines: s.lines })) }, null, 1);
  const out = [`# Context packet: ${meta.subject}`, `commit ${meta.commit} · pieces: ${meta.pieces.join(', ')}`, ''];
  sections.forEach((s) => out.push(`## ${s.title}`, ...s.lines.map((l) => (/^ /.test(l) ? l : `- ${l}`)), ''));
  return out.join('\n');
}

function fit(meta, sections, opts) {
  const omitted = [];
  let over = false;
  const report = { title: 'Budget report', lines: [] };
  const draw = () => {
    report.lines = [`budget ${opts.budget} tokens; this packet about ${tokens(render(meta, sections.concat(report), opts.format))} (4 characters a token)`];
    if (omitted.length) report.lines.push(...omitted.map((o) => `${o.title}: ${o.cut} of ${o.of} lines left out — read them with node tests/map.js --who/--deps or the file at the line`));
    else report.lines.push('nothing left out');
    if (over) report.lines.push('over budget even so: the sections that are never cut (ownership, invariants, tests, missing evidence) take more');
    return render(meta, sections.concat(report), opts.format);
  };
  // Cut the longest trimmable section by its tail until the packet fits, keeping at least two lines of each.
  for (let text = draw(); tokens(text) > opts.budget; text = draw()) {
    const s = sections.filter((x) => x.trim && x.lines.length > 2).sort((a, b) => b.lines.join('\n').length - a.lines.join('\n').length)[0];
    if (!s) {
      over = true;
      break;
    }
    let o = omitted.find((x) => x.title === s.title);
    if (!o) omitted.push((o = { title: s.title, cut: 0, of: s.lines.length }));
    const drop = Math.max(1, Math.ceil(s.lines.length / 8));
    const keep = Math.max(2, s.lines.length - drop);
    o.cut += s.lines.length - keep;
    s.lines = s.lines.slice(0, keep);
  }
  return draw();
}

/* -- the packet ------------------------------------------------------ */

export function contextPack(argv) {
  const opts = parseArgs(argv);
  const index = loadIndex();
  const { pieces, unknown } = select(index, opts);
  if (unknown.length) {
    const msg = unknown.map((u) => `nothing matches "${u.asked}"${u.near.length ? `; near: ${u.near.join(', ')}` : ''}`).join('\n');
    const err = new Error(`${msg}\n(node tests/map.js lists the pieces)`);
    err.unknown = unknown;
    throw err;
  }
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
  } catch (err) {
    commit = 'unknown';
  }
  const subject = opts.feature.length ? opts.feature.join(' ') : opts.files.join(' ');
  const meta = { subject, commit, budget: opts.budget, pieces: pieces.map((p) => p.name) };
  const css = cssMap(pieces);
  const sections = [ownership(index, pieces), invariants(pieces), testsSection(pieces), definitions(pieces), callMap(index, pieces), css.section, missing(pieces, css)];
  return fit(meta, sections, opts);
}

const HELP = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\n([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, '');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h') || !argv.length) process.stdout.write(HELP);
    else process.stdout.write(`${contextPack(argv)}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}
