#!/bin/bash
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock 2>/dev/null || true
git add -A
if git diff --cached --quiet; then
  echo "Nothing to commit."
else
  git commit -m "Center billiard-ball numbers reliably across browsers

Switch from grid place-items to explicit top/left + translate(-50%,-50%)
for both the white cue spot and the number, so they sit at the exact
geometric centre on every engine. Verified locally: pill centre and
number centre coincide to the pixel."
fi
echo ""
echo "Pushing..."
git push origin main
echo ""
echo "Done."
