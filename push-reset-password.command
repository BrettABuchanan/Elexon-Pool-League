#!/bin/bash
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock 2>/dev/null || true
git add -A
if git diff --cached --quiet; then
  echo "Nothing to commit."
else
  git commit -m "Gate Reset league behind a password prompt

Stops a stray tap from wiping the season. The constant lives in
app.js with a comment noting that this is a guardrail against
accidents, not a security control — the file is public."
fi
echo ""
echo "Pushing..."
git push origin main
echo ""
echo "Done."
