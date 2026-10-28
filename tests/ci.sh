#!/bin/sh
# Waits for CI on a pushed commit (HEAD by default) and prints a few lines:
# how it went, whether it was released, and, if something failed, only the
# failing lines. Run it once after pushing instead of checking by hand.
# The branch is main unless given: tests/ci.sh "" v2.
sha=$(git rev-parse "${1:-HEAD}")
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
# The results branch holds one run's: if it isn't this commit's, say so, with
# why the run gave none (a job that never started says why in its annotations).
id=$(gh api "$runs" --jq '.workflow_runs[0].id')
for_sha=$(git log -1 --format=%s origin/ci-results | sed -n 's/^Results for //p')
case "$sha" in
  "$for_sha"*) ;;
  *)
    echo "no results for this commit (the results branch has ${for_sha:-none}'s)"
    for job in $(gh api "repos/goofect/design-redux/actions/runs/$id/jobs" --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | .id'); do
      gh api "repos/goofect/design-redux/check-runs/$job/annotations" --jq '.[] | select(.annotation_level == "failure") | "  " + .message' 2>/dev/null | head -n 3
    done
    [ "$state" = "completed success" ] && exit 0
    exit 1
    ;;
esac
git show origin/ci-results:summary.txt | grep -E 'tests:'
# The timings that matter, each Obsidian version, against the last run this
# script saw (kept in logs/; the results branch holds only the latest run).
# Reported, never failed on: CI machines vary.
mkdir -p logs
for f in $(git ls-tree --name-only origin/ci-results | grep -E 'timings\.txt$'); do
  v=${f%-timings.txt}
  now=$(git show "origin/ci-results:$f" | awk '
    /shelf of 500 albums/ { for (i = 1; i <= NF; i++) { if ($i == "drawn") s = $(i + 1); if ($i == "sidebar") b = $(i + 1) } }
    /canvas of 500 cards/ { for (i = 1; i <= NF; i++) if ($i == "fold") f = $(i + 1) }
    END { if (s != "") print s, b, f }')
  [ -n "$now" ] || continue
  set -- $now
  echo "timings $v: shelf of 500 albums $1 ms, sidebar $2 ms, fold on 500 cards $3 ms"
  git show "origin/ci-results:$f" | grep -o 'album of 2000 notes:.*' | sed "s/^/  /"
  last="logs/ci-timings-$v.txt"
  if [ -f "$last" ]; then
    read -r ps pb pf < "$last"
    for pair in "shelf $1 $ps" "sidebar $2 $pb" "fold $3 $pf"; do
      set -- $pair
      [ "$3" -gt 0 ] 2>/dev/null || continue
      pct=$(( ($2 - $3) * 100 / $3 ))
      [ "$pct" -gt 25 ] && echo "  slower than the last run by $pct%: $1 ($3 → $2 ms)"
    done
  fi
  echo "$now" > "$last"
done
# The UI snapshots against main's last: only what isn't unchanged
# (pictures of each change are in snapshots/diff/ on the results branch).
snaps=$(git show origin/ci-results:snapshots/diff/summary.txt 2>/dev/null | grep -v '^unchanged')
if git show origin/ci-results:snapshots/diff/summary.txt >/dev/null 2>&1; then
  if [ -n "$snaps" ]; then echo "snapshots against main:"; echo "$snaps" | sed 's/^/  /'; else echo "snapshots: as on main"; fi
fi
tag=$(git tag --contains "$sha" --sort=v:refname 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
if [ -n "$tag" ]; then echo "released: $tag"; else echo "not released"; fi

[ "$state" = "completed success" ] && exit 0
# Which job failed: a release that failed after the tests passed usually lost
# a race with a newer push, whose own run then releases this commit too.
gh api "repos/goofect/design-redux/actions/runs/$id/jobs" --jq '[.jobs[] | "\(.name): \(.conclusion)"] | join(", ")'
for f in simulation-tests.txt obsidian-tests.txt; do
  git show "origin/ci-results:$f" 2>/dev/null | grep -iE 'fail|error|✖|not ok' | head -n 25
done
exit 1
