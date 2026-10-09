#!/bin/sh
# Runs the real-Obsidian tests whose names match $1, on the latest version
# only, and prints just the outcome. The full log goes to logs/e2e.log;
# when a test fails, its last lines are printed too.
#   tests/e2e.sh "folds a branch"
[ -n "$1" ] || { echo 'usage: tests/e2e.sh "test name"'; exit 2; }
mkdir -p logs
node build.mjs >/dev/null || exit 1
WDIO_LATEST_ONLY=1 xvfb-run -a npx wdio run ./wdio.conf.mjs --mochaOpts.grep "$1" > logs/e2e.log 2>&1
status=$?
grep -E '[0-9]+ (passing|failing|pending)|Spec Files' logs/e2e.log | tail -n 4
if [ $status -ne 0 ]; then
  echo "--- failed; last lines of logs/e2e.log ---"
  grep -vE '^\s*$' logs/e2e.log | tail -n 30
fi
exit $status
