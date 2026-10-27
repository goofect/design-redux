// tools/eval-usage.mjs and the counts it takes from tests/tool-log.js:
// tokens by model, failed test runs and retries, cost only where every
// price is known, a run's checks and scope in a worktree of its own, a
// comparison only once there are enough accepted runs — and nothing a
// file or a tool said kept in the log.
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokens, attempts } = require('./tool-log.js');

const SECRET = 'the-text-of-a-note-never-kept';

/** A transcript: two replies by two models, a test run that fails (piped, so no error), its retry, and the call seen again after a compaction. */
function transcript(file) {
  const line = (o) => JSON.stringify(o);
  const use = (id, cmd) => line({ type: 'assistant', message: { id: `m-${id}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: cmd } }], usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 } } });
  const result = (id, content, err) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!err }] } });
  fs.writeFileSync(file, [
    use('a', 'node tests/run.js album 2>&1 | tail -3'),
    result('a', `FAIL  test_album.js\n${SECRET}\n0 of 1 suites passed`),
    use('b', 'node tests/run.js album 2>&1 | tail -3'),
    result('b', 'pass  test_album.js\n1 of 1 suites passed'),
    use('a', 'node tests/run.js album 2>&1 | tail -3'),
    use('c', 'cat missing.txt'),
    result('c', 'No such file', true),
    line({ type: 'assistant', message: { id: 'm-d', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } } }),
  ].join('\n') + '\n');
}

(async () => {
  const ev = await import('../tools/eval-usage.mjs');
  let passed = 0;
  const t = async (name, fn) => {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-evals-'));

  await t('tokens by model, test runs, failures seen through a pipe, and retries — each call once', () => {
    const tp = path.join(dir, 'session.jsonl');
    transcript(tp);
    const k = tokens([], tp);
    assert.deepStrictEqual(k.models['claude-opus-5-5'], { fresh: 30, written: 300, cached: 3000, out: 150 });
    assert.deepStrictEqual(k.models['claude-fable-5-1'], { fresh: 1, written: 2, cached: 3, out: 4 });
    assert.strictEqual(k.fresh, 31);
    assert.deepStrictEqual(attempts(tp), { errors: 1, tests: 2, retries: 1 });
  });

  await t('a cost only where all four prices are known', () => {
    const prices = { models: { a: { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }, b: { input: 10, output: 50, cacheWrite: null, cacheRead: null } } };
    const k = { fresh: 1e6, written: 1e6, cached: 1e6, out: 1e6 };
    assert.deepStrictEqual(ev.cost({ a: k }, prices), { dollars: 73.5, unpriced: [] });
    assert.deepStrictEqual(ev.cost({ a: k, b: k }, prices), { dollars: null, unpriced: ['b'] });
  });

  await t('per accepted task, the rejected runs\' cost counts; a comparison only with enough accepted runs each', () => {
    const run = (id, variant, accepted, dollars) => ({ kind: 'finish', id, task: 'x', variant, accepted, dollars, unpriced: [], tokens: { fresh: 1, written: 1, cached: 1, out: 1 }, repeatReads: 0, retries: 0, calls: 1 });
    const rows = [run('1', 'a', true, 2), run('2', 'a', false, 2), run('3', 'b', true, 1)];
    const [x] = ev.summarise(rows, 1);
    assert.strictEqual(x.figures.find((f) => f.variant === 'a').costPerAccepted, 4);
    assert.match(x.comparison, /^b cost 0\.25× what a did/);
    assert.match(ev.summarise(rows, 3)[0].comparison, /^not compared: each variant needs 3/);
    // A run finished again counts once, as it ended.
    assert.strictEqual(ev.summarise(rows.concat(run('2', 'a', true, 2)), 1)[0].figures.find((f) => f.variant === 'a').costPerAccepted, 2);
  });

  await t('a run in a worktree of its own: seeded, checked, kept to its scope, its usage recorded — and no content in the log', () => {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, 'evals', 'seeds'), { recursive: true });
    const g = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    g('init', '-q');
    fs.writeFileSync(path.join(repo, 'note.txt'), 'todo\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'logs\n');
    fs.writeFileSync(path.join(repo, 'evals', 'tasks.json'), JSON.stringify({ tasks: [{ id: 'fix', seed: 'seeds/break.patch', prompt: 'Fix it.', scope: ['note.txt'], checks: ['grep -q done note.txt', 'test -n "$BASE"'], review: false }] }));
    fs.writeFileSync(path.join(repo, 'evals', 'prices.json'), JSON.stringify({ models: { 'claude-opus-5-5': { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 }, 'claude-fable-5-1': { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 } } }));
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
    fs.writeFileSync(path.join(repo, 'note.txt'), 'broken\n');
    fs.writeFileSync(path.join(repo, 'evals', 'seeds', 'break.patch'), execFileSync('git', ['diff'], { cwd: repo }));
    g('checkout', '-q', 'note.txt');
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'seed');
    const p = ev.paths(repo);

    const run = ev.start(p, 'fix', 'opus');
    assert.strictEqual(run.id, 'fix-opus-1');
    assert.strictEqual(fs.readFileSync(path.join(run.dir, 'note.txt'), 'utf8'), 'broken\n', 'seeded');
    // The session: its tool log in the worktree, pointing at its transcript.
    const tp = path.join(dir, 'session.jsonl');
    fs.mkdirSync(path.join(run.dir, 'logs'));
    fs.writeFileSync(path.join(run.dir, 'logs', 'tools.jsonl'), [{ t: 1, s: 'S1', tool: 'Read', file: 'note.txt', bytes: 9, lines: 1, tp }, { t: 2, s: 'S1', tool: 'Read', file: 'note.txt', bytes: 9, lines: 1, tp }].map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(run.dir, 'note.txt'), `done ${SECRET}\n`);
    fs.writeFileSync(path.join(run.dir, 'stray.txt'), 'x\n');
    const out = ev.finish(p, run.id);
    assert.deepStrictEqual(out.checks.map((c) => c.ok), [true, true]);
    assert.deepStrictEqual(out.outOfScope, ['stray.txt']);
    assert.strictEqual(out.accepted, false, 'a file outside its scope');
    assert.deepStrictEqual([out.session, out.repeatReads, out.retries, out.tokens.fresh], ['S1', 1, 1, 31]);
    assert.strictEqual(out.dollars, (31 + 302 + 3003 + 154) / 1e6);

    fs.unlinkSync(path.join(run.dir, 'stray.txt'));
    assert.strictEqual(ev.finish(p, run.id).accepted, true);
    assert.ok(!fs.readFileSync(p.log, 'utf8').includes(SECRET), 'nothing a file or a tool said');
    assert.match(ev.reportText(ev.records(p)), /opus: 1\/1 accepted, \$0\.00 per accepted/);

    ev.clean(p, run.id);
    assert.ok(!fs.existsSync(run.dir));
  });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
