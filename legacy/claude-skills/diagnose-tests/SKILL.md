---
name: diagnose-tests
description: Find why a Design Redux test failed — a simulation suite, a real-Obsidian test run locally, or CI — reading only the lines that matter.
---

# Diagnosing a failing test

Read the failure, not the log. In order:

1. **A simulation suite** (`node tests/run.js` said FAIL): run it alone and
   drop the passing lines — `node tests/test_<suite>.js 2>&1 | grep -v "^  ok" | head -20`.
   If `main.js` looks stale (a name the source has is missing), `npm run build` first.
2. **A real-Obsidian test, locally**: `tests/e2e.sh "test name"` prints the
   outcome; on failure, `grep -E "✖|Error|Expected|Received" logs/e2e.log | head`.
   A one-off probe can go in a scratch `tests/obsidian/zz-*.e2e.mjs`, run by its
   name, and deleted after; never commit it.
3. **CI**: `tests/ci.sh` once. It reads the run for the commit; when a push
   went to both `main` and the session branch there are two runs, so check
   both: `gh api "repos/goofect/design-redux/actions/runs?head_sha=$(git rev-parse HEAD)" --jq '.workflow_runs[] | "\(.head_branch) \(.conclusion)"'`.
   The failing lines: `git fetch -q origin +ci-results:refs/remotes/origin/ci-results && git show origin/ci-results:obsidian-tests.txt | grep -E "✖|Expected|Received|Error:" | head -16`.
   Plugin errors: `git show origin/ci-results:<version>-errors.txt`.
   A `FAILED-*.png` there is worth a look only when the failure is visual.

Then:

- The same commit passing on one run and failing on another is timing, not
  luck: find what the test waits for too little (an editor's focus, a view put
  back after opening, something lying over a click) and wait for that
  condition. "element not interactable" means the target was covered,
  hidden or zero-sized.
- A test that broke because the interface changed on purpose gets the test
  updated, with the reason in the commit.
- Never skip, loosen to always-pass, or delete a test to get green.
