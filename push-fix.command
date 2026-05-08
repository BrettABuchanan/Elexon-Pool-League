#!/bin/bash
# Commits the dedup fix and pushes. Token is already in macOS Keychain so no prompts.
set -e
cd "$(dirname "$0")"

rm -f .git/index.lock 2>/dev/null || true

git add -A

# Only commit if there's something staged.
if git diff --cached --quiet; then
  echo "Nothing new to commit, going straight to push."
else
  git commit -m "Fix duplicate-player bug + auto-dedup by name

When signing in on a new device with empty localStorage, loadLocalState
used to emit createStarterState (8 fresh starters with new random IDs),
which the merge then unioned with the populated remote — producing
'two of every player' on shared leagues.

Changes:
- loadLocalState returns null when localStorage is empty (no fresh
  starters injected on every cold load).
- handleSession passes hasLocalEdits to loadOnlineState; we only run
  the merge path when local truly has cached edits.
- New dedupePlayersByName collapses same-name players, taking max wins
  per (player, month) cell and keeping the older createdAt/id. Applied
  in normalizeState and at the tail of mergeStates so existing
  duplicate data heals on next page load.
- Empty remote still seeds with starters; behaviour unchanged for
  brand-new leagues.

Tests: all 19 merge tests pass, plus 6 new dedup tests covering
Brett's exact 16→8 scenario."
fi

echo ""
echo "Pushing..."
git push origin main

echo ""
echo "Done. Refresh your browser to pick up the fix."
