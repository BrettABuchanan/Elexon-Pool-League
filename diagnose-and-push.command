#!/bin/bash
# Diagnose what's wrong with the PAT before pushing.
cd "$(dirname "$0")"

echo "=== Step 1: Clear any stale github.com credential from Keychain ==="
printf "protocol=https\nhost=github.com\n\n" | git credential-osxkeychain erase
echo "Cleared (if any existed)."
echo ""

echo "=== Step 2: Ask for the PAT via dialog ==="
PAT=$(osascript <<'EOF'
try
  set dlg to display dialog "Paste your GitHub Personal Access Token here." & return & return & "It starts with ghp_ (classic) or github_pat_ (fine-grained)." default answer "" with hidden answer with title "GitHub Token" buttons {"Cancel", "OK"} default button "OK"
  return text returned of dlg
on error
  return ""
end try
EOF
)

if [ -z "$PAT" ]; then
  echo "ERROR: No token entered (dialog cancelled or empty)."
  exit 1
fi

# Trim any trailing whitespace/newlines.
PAT=$(echo "$PAT" | tr -d '[:space:]')

echo "Token received. Length: ${#PAT} characters. Prefix: ${PAT:0:4}..."
echo ""

echo "=== Step 3: Test the token against GitHub API ==="
HTTP_CODE=$(curl -s -o /tmp/gh_user_response.json -w "%{http_code}" \
  -H "Authorization: Bearer $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user)
echo "GitHub /user endpoint returned HTTP $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo ""
  echo "ERROR: Token rejected by GitHub. Response:"
  cat /tmp/gh_user_response.json
  echo ""
  echo ""
  echo "Likely causes:"
  echo "  - Token expired"
  echo "  - Token revoked"
  echo "  - You pasted only part of the token"
  echo "  - You pasted something that isn't a token"
  rm -f /tmp/gh_user_response.json
  exit 1
fi
USERNAME=$(grep -o '"login": *"[^"]*"' /tmp/gh_user_response.json | sed 's/.*"login": *"\([^"]*\)".*/\1/')
echo "Token belongs to user: $USERNAME"
echo ""

echo "=== Step 4: Check token can access the Elexon-Pool-League repo ==="
HTTP_CODE=$(curl -s -o /tmp/gh_repo_response.json -w "%{http_code}" \
  -H "Authorization: Bearer $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/BrettABuchanan/Elexon-Pool-League)
echo "GitHub /repos endpoint returned HTTP $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo ""
  echo "ERROR: Token can't see this repo. Response:"
  cat /tmp/gh_repo_response.json
  echo ""
  echo ""
  echo "If using a fine-grained token, you must explicitly grant it access to"
  echo "BrettABuchanan/Elexon-Pool-League with Contents: Read and write."
  echo "Easiest fix: generate a CLASSIC token with the 'repo' scope ticked."
  rm -f /tmp/gh_user_response.json /tmp/gh_repo_response.json
  exit 1
fi
PERMS=$(grep -o '"push": *true' /tmp/gh_repo_response.json | head -1)
if [ -z "$PERMS" ]; then
  echo "ERROR: Token can see the repo but has no push permission."
  echo "Generate a classic token with the 'repo' scope ticked."
  rm -f /tmp/gh_user_response.json /tmp/gh_repo_response.json
  exit 1
fi
echo "Token has push permission on the repo."
rm -f /tmp/gh_user_response.json /tmp/gh_repo_response.json
echo ""

echo "=== Step 5: Save token to Keychain so future pushes don't prompt ==="
{
  echo "protocol=https"
  echo "host=github.com"
  echo "username=$USERNAME"
  echo "password=$PAT"
  echo ""
} | git credential-osxkeychain store
git config --global --get-all credential.helper | grep -q osxkeychain || \
  git config --global credential.helper osxkeychain
echo "Saved."
echo ""

echo "=== Step 6: Push ==="
git push origin main

unset PAT
echo ""
echo "Done."
