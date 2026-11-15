#!/usr/bin/env node
// Paired runs of real tasks, to compare how ways of working (a model, an
// effort, context packs or not) spend tokens for the same accepted result.
//
//   node tools/eval-usage.mjs start <task> <variant> [--from <ref>]
//       A worktree of its own beside the repository, from <ref> (HEAD by
//       default), with the task's seed applied and committed. Prints the
//       folder and the prompt: open a fresh session there (with the
//       variant's model) and paste it.
//   node tools/eval-usage.mjs finish <run> [--review pass|fail] [--session <id>]
//       Commits what the session left, runs the task's checks, and records
//       the session's usage from its tool log and transcript.
//   node tools/eval-usage.mjs report [--min <n>]
//       For each task and variant: runs, accepted, cost per accepted task,
//       uncached input, repeated reads and retries; two variants compared
//       only once each has <n> accepted runs (3 by default).
//   node tools/eval-usage.mjs clean <run>
//       Removes a run's worktree and branch.
//
// Tasks are in evals/tasks.json, prices in evals/prices.json (a model
// without all four prices is reported in tokens only). Results go to
// logs/evals.jsonl: counts, check outcomes and file names — never what a
// file or a tool's output said.
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const { sessions, sum, tokens, attempts } = require('../tests/tool-log.js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function paths(root = ROOT) {
  return {
    root,
    tasks: path.join(root, 'evals', 'tasks.json'),
    prices: path.join(root, 'evals', 'prices.json'),
    seeds: path.join(root, 'evals'),
    log: path.join(root, 'logs', 'evals.jsonl'),
    runs: path.join(path.dirname(root), `${path.basename(root)}-evals`),
  };
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function task(p, id) {
  const found = JSON.parse(fs.readFileSync(p.tasks, 'utf8')).tasks.find((t) => t.id === id);
  if (!found) throw new Error(`no task "${id}" in ${path.relative(p.root, p.tasks)}`);
  return found;
}

export function records(p) {
  if (!fs.existsSync(p.log)) return [];
  return fs.readFileSync(p.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const record = (p, row) => {
  fs.mkdirSync(path.dirname(p.log), { recursive: true });
  fs.appendFileSync(p.log, JSON.stringify(row) + '\n');
};

/** A worktree for one run of a task, its seed applied: { id, dir, base, prompt }. */
export function start(p, taskId, variant, from = 'HEAD') {
  const t = task(p, taskId);
  if (!/^[\w.-]+$/.test(variant)) throw new Error('a variant is a plain name, such as opus-high or fable');
  const taken = new Set(records(p).map((r) => r.id));
  let n = 1;
  while (taken.has(`${taskId}-${variant}-${n}`) || fs.existsSync(path.join(p.runs, `${taskId}-${variant}-${n}`))) n++;
  const id = `${taskId}-${variant}-${n}`;
  const dir = path.join(p.runs, id);
  fs.mkdirSync(p.runs, { recursive: true });
  git(p.root, 'worktree', 'add', '-q', '-b', `eval/${id}`, dir, from);
  if (t.seed) {
    git(dir, 'apply', path.join(p.seeds, t.seed));
    git(dir, '-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-q', '-am', `eval seed: ${t.seed}`);
  }
  // The tests need the packages; the worktree borrows the repository's.
  const modules = path.join(p.root, 'node_modules');
  if (fs.existsSync(modules) && !fs.existsSync(path.join(dir, 'node_modules'))) fs.symlinkSync(modules, path.join(dir, 'node_modules'));
  const base = git(dir, 'rev-parse', 'HEAD');
  record(p, { kind: 'start', id, task: taskId, variant, base, dir, t: Date.now() });
  return { id, dir, base, prompt: t.prompt };
}

/** Dollars for a session's tokens by model, or null where a price is missing. */
export function cost(models, prices) {
  let total = 0;
  const unpriced = [];
  Object.entries(models || {}).forEach(([model, k]) => {
    const price = (prices.models || {})[model];
    const known = price && ['input', 'output', 'cacheWrite', 'cacheRead'].every((key) => typeof price[key] === 'number');
    if (!known) return unpriced.push(model);
    total += (k.fresh * price.input + k.written * price.cacheWrite + k.cached * price.cacheRead + k.out * price.output) / 1e6;
  });
  return { dollars: unpriced.length ? null : Math.round(total * 1e6) / 1e6, unpriced };
}

/** The run's result: its checks, what changed, and the session's usage. */
export function finish(p, id, opts = {}) {
  const begun = records(p).filter((r) => r.kind === 'start' && r.id === id).pop();
  if (!begun) throw new Error(`no run "${id}" started`);
  const t = task(p, begun.task);
  const dir = begun.dir;
  git(dir, 'add', '-A');
  if (git(dir, 'status', '--porcelain')) git(dir, '-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-q', '-m', `eval result: ${id}`);
  const changed = git(dir, 'diff', '--name-only', begun.base, 'HEAD').split('\n').filter(Boolean).filter((f) => f !== 'node_modules');
  const outOfScope = changed.filter((f) => !(t.scope || ['']).some((s) => f === s || f.startsWith(s)));
  const checks = (t.checks || []).map((check) => {
    const run = spawnSync('bash', ['-c', check], { cwd: dir, env: Object.assign({}, process.env, { BASE: begun.base }), stdio: 'ignore', timeout: 600000 });
    return { check, ok: run.status === 0 };
  });
  const review = opts.review || null;
  const accepted = checks.every((c) => c.ok) && !outOfScope.length && (t.review ? review === 'pass' : review !== 'fail');

  // The session: the one given, or the last one logged in the worktree.
  const logged = sessions(path.join(dir, 'logs', 'tools.jsonl'));
  const sessionId = opts.session || Array.from(logged.keys()).pop();
  const rows = logged.get(sessionId) || [];
  const tp = opts.transcript || rows.map((r) => r.tp).filter(Boolean).pop();
  const use = rows.length ? sum(rows) : null;
  const k = tokens(rows, tp);
  const tries = attempts(tp);
  const priced = k ? cost(k.models, JSON.parse(fs.readFileSync(p.prices, 'utf8'))) : { dollars: null, unpriced: [] };
  const row = {
    kind: 'finish',
    id,
    task: begun.task,
    variant: begun.variant,
    t: Date.now(),
    session: sessionId || null,
    accepted,
    review,
    checks,
    changed,
    outOfScope,
    models: k ? Object.keys(k.models) : [],
    tokens: k ? { fresh: k.fresh, written: k.written, cached: k.cached, out: k.out, replies: k.replies } : null,
    dollars: priced.dollars,
    unpriced: priced.unpriced,
    calls: use ? use.calls : null,
    minutes: use ? use.minutes : null,
    reads: use ? use.reads : null,
    repeatReads: use ? use.needless : null,
    toolKB: use ? use.kb : null,
    errors: tries ? tries.errors : null,
    tests: tries ? tries.tests : null,
    retries: tries ? tries.retries : null,
  };
  record(p, row);
  return row;
}

export function clean(p, id) {
  const begun = records(p).filter((r) => r.kind === 'start' && r.id === id).pop();
  if (!begun) throw new Error(`no run "${id}" started`);
  if (fs.existsSync(begun.dir)) git(p.root, 'worktree', 'remove', '--force', begun.dir);
  try {
    git(p.root, 'branch', '-q', '-D', `eval/${id}`);
  } catch (err) {
    /* gone already */
  }
}

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const k = (n) => (n === null ? '—' : n >= 10000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

/** For each task and variant, the figures; and a comparison where there's evidence for one. */
export function summarise(rows, min = 3) {
  const latest = new Map();
  rows.filter((r) => r.kind === 'finish').forEach((r) => latest.set(r.id, r));
  const byTask = new Map();
  latest.forEach((r) => {
    if (!byTask.has(r.task)) byTask.set(r.task, new Map());
    const variants = byTask.get(r.task);
    if (!variants.has(r.variant)) variants.set(r.variant, []);
    variants.get(r.variant).push(r);
  });
  const out = [];
  byTask.forEach((variants, taskId) => {
    const figures = Array.from(variants.entries()).map(([variant, runs]) => {
      const accepted = runs.filter((r) => r.accepted).length;
      const allPriced = runs.every((r) => typeof r.dollars === 'number');
      // Every run's cost counts, the rejected too: what an accepted result really took.
      const spent = allPriced ? runs.reduce((n, r) => n + r.dollars, 0) : null;
      const counted = (key) => runs.map((r) => r[key]).filter((v) => typeof v === 'number');
      return {
        variant,
        runs: runs.length,
        accepted,
        costPerAccepted: spent !== null && accepted ? spent / accepted : null,
        unpriced: Array.from(new Set(runs.flatMap((r) => r.unpriced || []))),
        unrecorded: runs.filter((r) => !r.tokens).length,
        uncachedInput: mean(runs.filter((r) => r.tokens).map((r) => r.tokens.fresh + r.tokens.written)),
        cachedInput: mean(runs.filter((r) => r.tokens).map((r) => r.tokens.cached)),
        output: mean(runs.filter((r) => r.tokens).map((r) => r.tokens.out)),
        repeatReads: mean(counted('repeatReads')),
        retries: mean(counted('retries')),
        calls: mean(counted('calls')),
      };
    });
    const ready = figures.filter((f) => f.accepted >= min && f.costPerAccepted !== null);
    let comparison = null;
    if (figures.length < 2) comparison = 'one variant only: nothing to compare';
    else if (ready.length < 2) comparison = `not compared: each variant needs ${min} accepted, priced runs (${figures.map((f) => `${f.variant} ${f.accepted}`).join(', ')})`;
    else {
      const [a, b] = ready.sort((x, y) => x.costPerAccepted - y.costPerAccepted);
      comparison = `${a.variant} cost ${(a.costPerAccepted / b.costPerAccepted).toFixed(2)}× what ${b.variant} did per accepted task, over ${a.accepted} and ${b.accepted} accepted runs`;
    }
    out.push({ task: taskId, figures, comparison });
  });
  return out;
}

export function reportText(rows, min) {
  const tasks = summarise(rows, min);
  if (!tasks.length) return 'No finished runs yet (logs/evals.jsonl).';
  const lines = [];
  tasks.forEach(({ task: id, figures, comparison }) => {
    lines.push(id);
    figures.forEach((f) => {
      const dollars =
        f.costPerAccepted !== null ? `$${f.costPerAccepted.toFixed(2)} per accepted`
          : f.unrecorded ? `usage not recorded for ${f.unrecorded} run${f.unrecorded > 1 ? 's' : ''}`
            : f.unpriced.length ? `unpriced (${f.unpriced.join(', ')})`
              : 'no accepted run';
      lines.push(`  ${f.variant}: ${f.accepted}/${f.runs} accepted, ${dollars}; per run ${k(f.uncachedInput)} uncached in, ${k(f.cachedInput)} cache read, ${k(f.output)} out, ${k(f.calls)} calls, ${f.repeatReads === null ? '—' : f.repeatReads.toFixed(1)} repeated reads, ${f.retries === null ? '—' : f.retries.toFixed(1)} retries`);
    });
    lines.push(`  ${comparison}`);
  });
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  const p = paths();
  try {
    if (cmd === 'start') {
      const run = start(p, args[0], args[1], flag('from'));
      console.log(`run ${run.id} in ${run.dir} (from ${run.base.slice(0, 7)})`);
      console.log('Open a fresh session there with the variant\'s model, paste the prompt, and when it\'s done:');
      console.log(`  node tools/eval-usage.mjs finish ${run.id} [--review pass|fail]\n`);
      console.log(run.prompt);
    } else if (cmd === 'finish') {
      const r = finish(p, args[0], { review: flag('review'), session: flag('session') });
      console.log(`${r.id}: ${r.accepted ? 'accepted' : 'not accepted'}`);
      r.checks.forEach((c) => console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.check}`));
      if (r.outOfScope.length) console.log(`  outside the task's scope: ${r.outOfScope.join(', ')}`);
      if (r.tokens) console.log(`  ${k(r.tokens.fresh + r.tokens.written)} uncached in, ${k(r.tokens.cached)} cache read, ${k(r.tokens.out)} out; ${r.dollars === null ? `unpriced (${r.unpriced.join(', ')})` : `$${r.dollars}`}`);
      else console.log('  no session logged in the worktree: usage not recorded');
      if (r.calls !== null) console.log(`  ${r.calls} calls, ${r.repeatReads} repeated reads, ${r.retries} retries, ${r.errors} failed tool calls`);
    } else if (cmd === 'report') {
      console.log(reportText(records(p), Number(flag('min')) || 3));
    } else if (cmd === 'clean') {
      clean(p, args[0]);
      console.log(`removed ${args[0]}`);
    } else {
      console.log('usage: node tools/eval-usage.mjs start <task> <variant> [--from <ref>] | finish <run> [--review pass|fail] [--session <id>] | report [--min <n>] | clean <run>');
      process.exit(cmd ? 2 : 0);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
