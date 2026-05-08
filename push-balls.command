#!/bin/bash
# Commit the billiard-ball styling and push.
set -e
cd "$(dirname "$0")"

rm -f .git/index.lock 2>/dev/null || true

git add -A

if git diff --cached --quiet; then
  echo "Nothing to commit."
else
  git commit -m "Render rank pills as billiard balls

Per-rank colors follow standard pool ball convention (1=yellow, 2=blue,
3=red, ..., 8=black, 9-15 striped). Each ball gets a sphere highlight,
a white cue spot, and a serif number. Applied to standings rank-pill
and overall-podium podium-rank.

Drops the is-leader / is-last rank-pill color overrides — the ball
itself signals rank now."
fi

echo ""
echo "Pushing..."
git push origin main

echo ""
echo "Done. Refresh the dashboard to see the balls."
