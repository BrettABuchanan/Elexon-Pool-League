#!/bin/bash
# Double-click to commit all current changes and push to GitHub.
set -e
cd "$(dirname "$0")"

# Clear any leftover lock file (a quirk of running git from the Cowork sandbox).
rm -f .git/index.lock

git add -A

git commit -m "Add Supabase auth, sync, and concurrent-edit merge

Schema:
- league_state table with RLS, signed-in-only policies
- Realtime publication for live cross-device updates
- Idempotent (drops older anon policies, safe to re-run)

App:
- Magic-link sign-in overlay; user bar with sign out
- Per-cell timestamps on every (player, month) win
- mergeStates() resolves concurrent edits cell-by-cell
- saveOnlineState fetch-merges before write to avoid clobbering
- Realtime channel auto-applies changes from other devices
- Saves serialized so debounce + Realtime don't race

Dev:
- start-server.command launcher (double-click to serve at :8000)
- README rewrite covering setup, deploy, and concurrent-edit semantics
- 19 merge tests cover different/same-cell edits, union, echo skip, stale rejection

Fix: empty league_state row no longer reports as Offline."

echo ""
echo "--- Pushing to GitHub ---"
git push origin main

echo ""
echo "Done. You can close this window."
