#!/bin/bash
# Pull remote commits we don't have locally, rebase our commit on top, then push.
# The token is already saved in macOS Keychain from diagnose-and-push.command,
# so this won't ask for credentials.
set -e
cd "$(dirname "$0")"

echo "=== Fetching remote ==="
git fetch origin main

echo ""
echo "=== Local vs remote ==="
echo "Local has these commits not on remote:"
git log --oneline origin/main..HEAD
echo ""
echo "Remote has these commits not local:"
git log --oneline HEAD..origin/main

echo ""
echo "=== Rebasing local commit on top of remote ==="
git rebase origin/main

echo ""
echo "=== Pushing ==="
git push origin main

echo ""
echo "Done."
