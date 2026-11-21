// CI's results, short enough to read whole.
//
//   node tools/ci.mjs summarize <dir>   in CI: from the jobs' output in <dir>, writes
//                                       summary.txt (a few lines; on a failure, each
//                                       failing test and its first error line) and the
//                                       specs' output as one obsidian-tests.txt, without
//                                       the runner's noise. Reads SHA, BRANCH, RUN_URL,
//                                       SIMULATION and OBSIDIAN (the jobs' results).
//   node tools/ci.mjs [--wait]          here: the result for this commit. With --wait,
//                                       waits quietly for its run to finish first.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const cut = (s, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The simulation suites' output: its last line, and each failing check with the first line of its error. */
function simulation(text) {
  if (!text) return { line: 'no output', fails: [] };
  const lines = text.split('\n');
  const total = lines.find((l) => /^\d+ of \d+ suites passed/.test(l));
  const fails = [];
  let suite = '';
  lines.forEach((l, i) => {
    const s = /^FAIL\s+test_(\w+)\.js/.exec(l);
    if (s) suite = s[1];
    const m = /^not ok\s+(.*)$/.exec(l);
    if (m) fails.push(`${suite}: ${m[1]} — ${(lines.slice(i + 1).find((x) => x.trim() && !/^\s+at /.test(x)) || '').trim()}`);
  });
  return { line: total ? total.replace(/ in [\d.]+s$/, '') : 'did not finish', fails };
}

/** One spec's output: its counts, and each failing test with the first line of its error. */
function spec(name, text) {
  const passing = /^(\d+) passing/m.exec(text);
  const failing = /^(\d+) failing/m.exec(text);
  if (!passing && !failing) return { line: `${name} did not run`, fails: [] };
  // Each failure's message runs from its title to the error repeated with its stack ("Error: …", "at …").
  const fails = Array.from(text.matchAll(/^\d+\) (.+)\n([\s\S]*?)(?=^\S*Error: |^\s+at |^\d+\) |(?![\s\S]))/gm))
    .map((m) => `${name}: ${m[1]} — ${m[2].split('\n').map((l) => l.trim()).filter(Boolean).join(' ')}`);
  return { line: [name, passing && `${passing[1]} passed`, failing && `${failing[1]} failed`].filter(Boolean).join(' '), fails };
}

/** The runner's noise taken out of a spec's output: what ran and what failed stay. */
function trim(text) {
  return text
    .replace(/^\[\d+-\d+\] Error in [\s\S]*?(?=^\[\d+-\d+\] FAILED)/gm, '')
    .split('\n')
    .filter((l) => !/^(\[\d+-\d+\] (RUNNING|PASSED|FAILED)|Execution of \d+ workers|\s*"obsidian" Reporter:|-{20,}|Session ID:|Spec Files:)/.test(l) && !/^\s+at .*node_modules/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

function summarize(dir) {
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
  const env = process.env;
  const sim = simulation(read('simulation-tests.txt'));
  const specFiles = fs.readdirSync(dir).filter((f) => /^obsidian-tests-.+\.txt$/.test(f)).sort();
  const specs = specFiles.map((f) => spec(f.replace(/^obsidian-tests-|\.txt$/g, ''), read(f)));
  fs.writeFileSync(path.join(dir, 'obsidian-tests.txt'), specFiles.map((f) => trim(read(f))).join('\n'));
  specFiles.forEach((f) => fs.rmSync(path.join(dir, f)));

  const ok = env.SIMULATION === 'success' && env.OBSIDIAN === 'success';
  const job = (result, tests, fails) => (result === 'success' || fails.length ? tests : `${result} before its tests finished`);
  const out = [
    `${(env.SHA || '').slice(0, 7)} ${env.BRANCH}: ${ok ? 'passed' : `FAILED ${env.RUN_URL}`}`,
    `simulation: ${job(env.SIMULATION, sim.line, sim.fails)}`,
    ...sim.fails.map((f) => `  ✖ ${cut(f)}`),
    `obsidian: ${job(env.OBSIDIAN, specs.map((s) => s.line).join(', ') || 'no specs ran', specs.flatMap((s) => s.fails))}`,
    ...specs.flatMap((s) => s.fails).map((f) => `  ✖ ${cut(f)}`),
  ];
  // Passed only when tried again: not a failure, but named until fixed.
  fs.readdirSync(dir).filter((f) => f.endsWith('-flaky.txt')).forEach((f) => {
    read(f).split('\n').filter(Boolean).forEach((t) => out.push(`  ~ flaky, passed on a retry: ${cut(t)}`));
  });
  if (!ok) out.push('more: simulation-tests.txt, obsidian-tests.txt, *-errors.txt on ci-results');
  fs.writeFileSync(path.join(dir, 'summary.txt'), out.join('\n') + '\n');
}

function local(wait) {
  const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
  const sha = run('git', ['rev-parse', 'HEAD']);
  const short = sha.slice(0, 7);
  const find = () => JSON.parse(run('gh', ['run', 'list', '--commit', sha, '--workflow', 'ci.yml', '--json', 'databaseId,status,conclusion,url', '-L', '1']))[0];
  let found = find();
  // Just after a push, GitHub takes a few seconds to make the run: with --wait, give it a minute.
  for (let i = 0; !found && wait && i < 12; i++) {
    execFileSync('sleep', ['5']);
    found = find();
  }
  if (!found) return console.log(`${short}: no CI run (not pushed, or only ignored paths changed)`);
  if (found.status !== 'completed') {
    if (!wait) return console.log(`${short}: running ${found.url}`);
    try {
      run('gh', ['run', 'watch', String(found.databaseId), '--interval', '10'], { stdio: 'ignore' });
    } catch (err) {
      // A failed run ends the watch with an error; the summary says what failed.
    }
    found = find();
  }
  run('git', ['fetch', '-q', 'origin', 'ci-results']);
  const summary = run('git', ['show', 'origin/ci-results:summary.txt']);
  if (summary.includes(short)) console.log(summary);
  else console.log(`${short}: ${found.conclusion}; its results were replaced by a later run's: ${found.url}`);
  if (found.conclusion === 'success') {
    const release = JSON.parse(run('gh', ['release', 'list', '-L', '1', '--json', 'tagName,publishedAt']))[0];
    if (release) console.log(`latest release: ${release.tagName} (${release.publishedAt.slice(0, 16).replace('T', ' ')} UTC)`);
  }
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'summarize') summarize(arg);
else local(mode === '--wait');
