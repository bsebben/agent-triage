#!/usr/bin/env bash
#
# version-check.sh — verify package.json version was bumped before pushing
#
# Compares local package.json version against the remote branch.
# Fails if there are code changes without a version bump.
#
# Usage:
#   scripts/version-check.sh          Check against origin/master
#   scripts/version-check.sh --check  Same (explicit)
#
set -euo pipefail

REMOTE_BRANCH="${1:-origin/master}"
if [[ "$REMOTE_BRANCH" == "--check" ]]; then
  REMOTE_BRANCH="origin/master"
fi

# Fetch latest remote state
git fetch origin --quiet 2>/dev/null || true

# Get versions
LOCAL_VERSION=$(node -e "console.log(require('./package.json').version)")
REMOTE_VERSION=$(git show "$REMOTE_BRANCH:package.json" 2>/dev/null | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).version))
" 2>/dev/null || echo "0.0.0")

# Check if there are code changes compared to remote
CHANGED_FILES=$(git diff --name-only "$REMOTE_BRANCH"...HEAD -- \
  'src/' 'public/' 'package.json' 'test/' 2>/dev/null || true)

if [[ -z "$CHANGED_FILES" ]]; then
  echo "No code changes detected — version check skipped"
  exit 0
fi

echo "Local version:  $LOCAL_VERSION"
echo "Remote version: $REMOTE_VERSION"
echo "Changed files:  $(echo "$CHANGED_FILES" | wc -l | tr -d ' ')"

if [[ "$LOCAL_VERSION" == "$REMOTE_VERSION" ]]; then
  echo ""
  echo "ERROR: Code changes detected but version not bumped (currently $LOCAL_VERSION)"
  echo ""
  echo "Bump the version in package.json before pushing:"
  echo "  Patch (bug fix):     x.y.Z"
  echo "  Minor (new feature): x.Y.0"
  echo "  Major (breaking):    X.0.0"
  exit 1
fi

# Validate semver bump direction (new must be greater than old)
IFS='.' read -r old_major old_minor old_patch <<< "$REMOTE_VERSION"
IFS='.' read -r new_major new_minor new_patch <<< "$LOCAL_VERSION"

if (( new_major < old_major )) ||
   (( new_major == old_major && new_minor < old_minor )) ||
   (( new_major == old_major && new_minor == old_minor && new_patch <= old_patch )); then
  echo ""
  echo "ERROR: Version $LOCAL_VERSION is not greater than $REMOTE_VERSION"
  exit 1
fi

echo "Version bump OK: $REMOTE_VERSION → $LOCAL_VERSION"
