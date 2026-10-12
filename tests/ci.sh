#!/bin/sh
# Waits for CI on a pushed commit (HEAD by default) and prints a few lines:
# how it went, whether it was released, and, if something failed, only the
# failing lines. Run it once after pushing instead of checking by hand.
# The branch is main unless given: tests/ci.sh "" v2.
sha=${1:-$(git rev-parse HEAD)}
branch=${2:-main}
runs="repos/goofect/design-redux/actions/runs?head_sha=$sha&branch=$branch"
state=
for _ in $(seq 1 55); do
  state=$(gh api "$runs" --jq '.workflow_runs[0] | "\(.status) \(.conclusion)"' 2>/dev/null)
  case "$state" in completed*) break ;; esac
  sleep 10
done
echo "CI: ${state:-not started}"
case "$state" in completed*) ;; *) echo "(still running; run this again)"; exit 2 ;; esac

git fetch -q origin +ci-results:refs/remotes/origin/ci-results 'refs/tags/*:refs/tags/*'
git show origin/ci-results:summary.txt | grep -E 'tests:'
tag=$(git tag --sort=-v:refname | head -1)
if git merge-base --is-ancestor "$sha" "$tag" 2>/dev/null; then echo "released: $tag"; else echo "not released"; fi

[ "$state" = "completed success" ] && exit 0
# Which job failed: a release that failed after the tests passed usually lost
# a race with a newer push, whose own run then releases this commit too.
id=$(gh api "$runs" --jq '.workflow_runs[0].id')
gh api "repos/goofect/design-redux/actions/runs/$id/jobs" --jq '[.jobs[] | "\(.name): \(.conclusion)"] | join(", ")'
for f in simulation-tests.txt obsidian-tests.txt; do
  git show "origin/ci-results:$f" 2>/dev/null | grep -iE 'fail|error|✖|not ok' | head -n 25
done
exit 1
