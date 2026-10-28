#!/usr/bin/env node
/*
 * The simulation suites a change needs, and why — a quicker loop while
 * working. npm test, every suite, stays the gate before a PR; CI runs it all.
 *
 *   node tools/affected-tests.mjs --base origin/main      what changed since a ref (committed or not)
 *   node tools/affected-tests.mjs --changed src/note/180-panel.js styles/12-browse.css
 *   ... --explain    each changed file and how it led to each suite
 *   ... --run        then run them: node tests/run.js with exactly those suites
 *
 * How a file leads to suites:
 *   src/ module    the suites naming what it declares, and those of the modules
 *                  using it — every user, through every hop, for core and shared
 *                  UI (any break there reaches far); for a feature, users hop by
 *                  hop until ones a suite names (a class written in parts is
 *                  named only by its last). Plus lifecycle and layers; lifecycle
 *                  loads the plugin, which wires every feature in, so the plugin's
 *                  own users aren't followed. A deleted module: every suite.
 *   styles/ part   styles, and the suites of the modules making its classes
 *   tests/test_X   that suite; a snapshot, the suites reading it; a helper, the
 *                  suites requiring it; tests/obsidian/, a note to run tests/e2e.sh
 *   tools/X        the suites naming it
 *   *.md, docs/, .claude/   none, said so
 *   anything else (the build, package files, map.js, run.js, unknown): every suite
 * It never answers "nothing" without saying why, and prints what it chose.
 * Run as a module (import { affected }) it only works things out: nothing is run.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadStyles } from './css-owners.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');

const allSuites = () =>
  fs
    .readdirSync(testsDir)
    .filter((f) => /^test_.*\.js$/.test(f))
    .map((f) => f.replace(/^test_|\.js$/g, ''))
    .sort();
const suiteText = (s) => fs.readFileSync(path.join(testsDir, `test_${s}.js`), 'utf8');

function changedSince(base) {
  const git = (...args) => execFileSync('git', args, { cwd: root }).toString().split('\n').filter(Boolean);
  const files = new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')]);
  return [...files].sort();
}

let index = null;
function loadIndex() {
  if (!index) {
    const out = execFileSync(process.execPath, [path.join(testsDir, 'map.js'), '--json'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    index = JSON.parse(out.toString());
    index.byFile = new Map(index.pieces.map((p) => [p.file, p]));
    index.byName = new Map(index.pieces.map((p) => [p.name, p]));
  }
  return index;
}

/** The pieces using p: every hop, or (all false) hop by hop until pieces a suite names. */
function usersOf(p, all) {
  const { pieces } = loadIndex();
  const found = new Map();
  const queue = [p];
  while (queue.length) {
    const cur = queue.shift();
    const names = Object.keys(cur.declared);
    pieces.forEach((q) => {
      // The plugin wires every feature in; a load that breaks shows in lifecycle, which every src change runs.
      if (q === p || q.level === 3 || found.has(q.name) || !names.some((n) => Object.prototype.hasOwnProperty.call(q.uses, n))) return;
      found.set(q.name, cur.name);
      if (all || !piecesSuites(q).length) queue.push(q);
    });
  }
  return found;
}

// The tools' own suites name pieces to test the tools, not the pieces.
export const TOOL_SUITES = ['affected_tests', 'context_pack', 'css_owners'];
const piecesSuites = (p) => p.suites.filter((s) => s !== 'obsidian' && !TOOL_SUITES.includes(s));

/** Suites for one changed file: [{ suite, why }], or 'all', or [] with a reason. */
function forFile(file) {
  const base = path.basename(file);
  const exists = fs.existsSync(path.join(root, file));
  const naming = (name) => allSuites().filter((s) => suiteText(s).includes(name));

  if (/\.md$/.test(file) || file.startsWith('docs/') || file.startsWith('.claude/')) return { none: 'notes for people and agents, not code' };

  if (/^src\/.+\.js$/.test(file)) {
    if (file === 'src/main.js') return { all: 'the entry: everything loads through it' };
    const { byFile } = loadIndex();
    const p = byFile.get(file);
    if (!p) return { all: exists ? 'a module the index does not know' : 'a deleted module: whatever used it is now broken' };
    const out = piecesSuites(p).map((s) => ({ suite: s, why: `names what ${p.name} declares` }));
    const wide = p.level <= 1;
    usersOf(p, wide).forEach((via, user) => {
      const u = loadIndex().byName.get(user);
      piecesSuites(u).forEach((s) => out.push({ suite: s, why: `${user} uses ${via === p.name ? p.name : `${via}, which uses ${p.name} at some hop`}` }));
    });
    out.push({ suite: 'lifecycle', why: 'any src change: command ids, setting keys and view types kept' }, { suite: 'layers', why: 'any src change: no new import across the layers' });
    if (!piecesSuites(p).length && !out.some((o) => !['lifecycle', 'layers'].includes(o.suite))) return { all: `no suite names ${p.name} or what uses it` };
    return { suites: out, note: wide ? `${p.area} is shared: every user, through every hop` : 'users followed until ones a suite names' };
  }

  if (/^styles\/\d\d-.+\.css$/.test(file)) {
    if (!exists) return { all: 'a deleted part' };
    const out = [{ suite: 'styles', why: 'the stylesheet lint' }];
    const classes = new Set();
    loadStyles()
      .rules.filter((r) => r.file === file)
      .forEach((r) => r.selectors.forEach((s) => (s.text.match(/\.dr-[\w-]+/g) || []).forEach((c) => classes.add(c.slice(1)))));
    const { pieces } = loadIndex();
    const makers = pieces.filter((p) => [...classes].some((c) => new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(fs.readFileSync(path.join(root, p.file), 'utf8'))));
    makers.forEach((p) => piecesSuites(p).forEach((s) => out.push({ suite: s, why: `${p.name} makes classes ${base} dresses` })));
    return { suites: out };
  }

  if (/^tests\/test_.+\.js$/.test(file)) {
    const s = base.replace(/^test_|\.js$/g, '');
    return exists ? { suites: [{ suite: s, why: 'the suite itself' }] } : { none: 'a deleted suite' };
  }
  if (file.startsWith('tests/obsidian/') || file === 'wdio.conf.mjs' || file === 'tests/e2e.sh') return { none: 'real-Obsidian tests: run tests/e2e.sh "name" for the one changed; CI runs them all' };
  if (file.startsWith('tests/snapshots/') || file.startsWith('tests/fixtures/')) {
    const users = naming(file.startsWith('tests/fixtures/') ? 'fixtures' : base.replace(/\.js$/, ''));
    return users.length ? { suites: users.map((s) => ({ suite: s, why: `reads ${base}` })) } : { all: `no suite names ${base}` };
  }
  if (file === 'tests/tool-log.js' || file === 'tests/ci.sh') return { none: 'a tool for the session or CI, no suite runs it' };
  if (file.startsWith('tools/')) {
    const out = naming(base).map((s) => ({ suite: s, why: `runs ${base}` }));
    // And the suites of the tools that import it.
    const toolsDir = path.join(root, 'tools');
    fs.readdirSync(toolsDir)
      .filter((t) => t !== base && fs.readFileSync(path.join(toolsDir, t), 'utf8').includes(`'./${base}'`))
      .forEach((t) => naming(t).forEach((s) => out.push({ suite: s, why: `runs ${t}, which imports ${base}` })));
    return out.length ? { suites: out } : { all: `no suite names ${base}` };
  }
  return { all: 'no rule for it: the build, package files, map.js, run.js and the unknown take every suite' };
}

export function affected(files) {
  const suites = new Map();
  const per = [];
  let all = null;
  files.forEach((f) => {
    const r = forFile(f);
    per.push([f, r]);
    if (r.all && !all) all = `${f}: ${r.all}`;
    (r.suites || []).forEach(({ suite, why }) => {
      if (!allSuites().includes(suite)) return;
      if (!suites.has(suite)) suites.set(suite, []);
      if (!suites.get(suite).includes(why)) suites.get(suite).push(why);
    });
  });
  if (all) allSuites().forEach((s) => suites.has(s) || suites.set(s, ['every suite']));
  return { suites: new Map([...suites.entries()].sort((a, b) => a[0].localeCompare(b[0]))), per, all };
}

function main(argv) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  let files;
  if (argv.includes('--changed')) files = argv.slice(argv.indexOf('--changed') + 1).filter((a) => !a.startsWith('--'));
  else if (at('--base')) files = changedSince(at('--base'));
  else {
    process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\n([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''));
    return 0;
  }
  files = files.map((f) => f.replace(/^\.\//, ''));
  if (!files.length) {
    console.log('no changed files: nothing to run (npm test is still the gate before a PR)');
    return 0;
  }
  const { suites, per, all } = affected(files);
  if (argv.includes('--explain'))
    per.forEach(([f, r]) => {
      console.log(f);
      if (r.all) console.log(`  every suite — ${r.all}`);
      else if (r.none) console.log(`  none — ${r.none}`);
      else {
        if (r.note) console.log(`  (${r.note})`);
        const seen = new Map();
        r.suites.forEach(({ suite, why }) => seen.set(suite, seen.get(suite) || why));
        [...seen.entries()].sort().forEach(([s, why]) => console.log(`  ${s}: ${why}`));
      }
    });
  if (!suites.size) {
    console.log(`no simulation suite for ${files.length} changed file${files.length > 1 ? 's' : ''}: ${per.map(([f, r]) => `${f} (${r.none})`).join('; ')}`);
    return 0;
  }
  console.log(`${suites.size} of ${allSuites().length} suites${all ? ` (every suite — ${all})` : ''}:`);
  if (!argv.includes('--explain') && !all) suites.forEach((why, s) => console.log(`  ${s.padEnd(13)} ${why[0]}${why.length > 1 ? ` (+${why.length - 1})` : ''}`));
  const names = [...suites.keys()].map((s) => `test_${s}.js`);
  console.log(`node tests/run.js ${names.join(' ')}`);
  if (argv.includes('--run')) {
    // The bundle the suites load, then exactly these suites.
    const build = spawnSync(process.execPath, [path.join(root, 'build.mjs')], { cwd: root, stdio: 'inherit' });
    if (build.status !== 0) return build.status || 1;
    return spawnSync(process.execPath, [path.join(testsDir, 'run.js'), ...names], { cwd: root, stdio: 'inherit' }).status;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
