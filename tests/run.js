// Runs every suite in this folder, a few at once, and fails if any does.
// These are simulations: Obsidian is stood in for, CodeMirror and the DOM are real.
// Each suite is a process of its own, so none can leave state behind for another.
//   node tests/run.js              every suite
//   node tests/run.js qol album    the suites whose names hold these words
// TEST_JOBS sets how many run at once (default: the CPUs, at most 4);
// TEST_TIMEOUT, in seconds, how long one may take before it's stopped (default 180).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const only = process.argv.slice(2);
const suites = fs
  .readdirSync(__dirname)
  .filter((f) => /^test_.*\.js$/.test(f))
  .filter((f) => !only.length || only.some((o) => f.includes(o)))
  .sort();

// None found is a failure: a renamed or deleted suite must not pass by being missed.
if (!suites.length) {
  console.log(only.length ? `No suite matches ${only.join(', ')}.` : 'No suites found.');
  process.exit(1);
}

const jobs = Math.max(1, Number(process.env.TEST_JOBS) || Math.min(4, os.cpus().length || 1));
const timeout = (Number(process.env.TEST_TIMEOUT) || 180) * 1000;

function runSuite(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, suite)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ suite, ok: code === 0 && !timedOut, timedOut, out, ms: Date.now() - started });
    });
  });
}

(async () => {
  const started = Date.now();
  const results = [];
  const queue = suites.slice();
  await Promise.all(
    Array.from({ length: Math.min(jobs, suites.length) }, async () => {
      while (queue.length) results.push(await runSuite(queue.shift()));
    })
  );
  // In name order, whatever order they finished in.
  results.sort((a, b) => (a.suite < b.suite ? -1 : 1));
  let failed = 0;
  results.forEach((r) => {
    const lines = r.out.trim().split('\n');
    const secs = `${(r.ms / 1000).toFixed(1)}s`.padStart(6);
    const last = r.timedOut ? `stopped after ${timeout / 1000}s` : lines[lines.length - 1];
    console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.suite.padEnd(20)} ${secs}  ${last}`);
    if (r.ok) return;
    failed++;
    // Everything but the passing lines: the failure and its whole stack.
    console.log(lines.filter((l) => !/^\s+ok\s/.test(l)).join('\n'));
  });
  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${suites.length - failed} of ${suites.length} suites passed in ${total}s`);
  process.exit(failed ? 1 : 0);
})();
