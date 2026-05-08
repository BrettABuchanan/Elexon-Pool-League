#!/bin/bash
# Re-attempt the push to GitHub. Use this if the original push failed (e.g. PAT mistyped).
set -e
cd "$(dirname "$0")"

echo "Pushing to GitHub..."
echo "When prompted:"
echo "  Username: BrettABuchanan"
echo "  Password: paste your PAT with Cmd+V (it WILL look like nothing happened — that's normal),"
echo "           then press Enter ONCE."
echo ""

git push origin main

echo ""
echo "Done. You can close this window."
