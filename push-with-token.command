#!/bin/bash
# Push to GitHub by prompting for a PAT in a proper macOS dialog
# (avoids the silent-paste issue in Terminal). Saves the token to
# macOS Keychain so future pushes work without prompting.
set -e
cd "$(dirname "$0")"

# Open a password dialog. Cancel returns non-zero, which set -e will catch.
PAT=$(osascript <<'EOF'
try
  set dlg to display dialog "Enter your GitHub Personal Access Token (starts with ghp_…)." & return & return & "Paste it with Cmd+V — the dots will appear as you paste." default answer "" with hidden answer with title "Push to GitHub" buttons {"Cancel", "Push"} default button "Push"
  return text returned of dlg
on error
  return ""
end try
EOF
)

if [ -z "$PAT" ]; then
  echo "Cancelled — no token entered."
  exit 1
fi

# Save to macOS Keychain so git stops asking after this push.
{
  echo "protocol=https"
  echo "host=github.com"
  echo "username=BrettABuchanan"
  echo "password=$PAT"
  echo ""
} | git credential-osxkeychain store

# Configure git to use the osxkeychain helper for github.com if it isn't already.
git config --global --get-all credential.helper | grep -q osxkeychain || \
  git config --global credential.helper osxkeychain

# Push, using the credentials we just saved.
git push origin main

# Wipe the local variable just in case.
unset PAT

echo ""
echo "Done. Token saved to Keychain — future pushes won't prompt."
