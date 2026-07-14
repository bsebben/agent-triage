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

# Verify package-lock.json version is in sync with package.json
LOCK_VERSION=$(node -e "console.log(require('./package-lock.json').version)")
if [[ "$LOCAL_VERSION" != "$LOCK_VERSION" ]]; then
  echo ""
  echo "ERROR: package-lock.json version ($LOCK_VERSION) out of sync with package.json ($LOCAL_VERSION)"
  echo ""
  echo "Run 'npm install' and commit the updated lockfile."
  exit 1
fi

# --- Config shape gate -----------------------------------------------------
# A checked-in fingerprint of the config shape (config.shape.json) makes
# config-shape drift diffable and enforceable, mirroring Rails' schema.rb.
# Regenerate the live shape and compare it against the committed snapshot.

LIVE_SHAPE=$(AGENT_TRIAGE_NO_BOOT=1 node scripts/config-snapshot.mjs --print)
COMMITTED_SHAPE=$(cat config.shape.json 2>/dev/null || echo "")
LIVE_VERSION=$(echo "$LIVE_SHAPE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).configVersion))")
REMOTE_SHAPE=$(git show "$REMOTE_BRANCH:config.shape.json" 2>/dev/null || echo "")
REMOTE_SHAPE_VERSION=$(echo "$REMOTE_SHAPE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).configVersion)}catch{console.log('')}})" 2>/dev/null || echo "")
EXAMPLE_VERSION=$(node -e "console.log(require('./config.example.json').configVersion)")

# Live schema must match the committed snapshot (run config-snapshot to refresh).
if [[ "$LIVE_SHAPE" != "$COMMITTED_SHAPE" ]]; then
  echo ""
  echo "ERROR: config.shape.json is out of date with the live schema."
  echo ""
  echo "Run 'npm run config-snapshot' and commit config.shape.json."
  exit 1
fi

# config.example.json must be stamped at the current version so fresh installs
# start correct and never re-migrate.
if [[ "$EXAMPLE_VERSION" != "$LIVE_VERSION" ]]; then
  echo ""
  echo "ERROR: config.example.json configVersion ($EXAMPLE_VERSION) != CURRENT_CONFIG_VERSION ($LIVE_VERSION)"
  echo ""
  echo "Update config.example.json's configVersion to match the current shape."
  exit 1
fi

# If the shape changed relative to remote, a migration (version bump) is required.
if [[ -n "$REMOTE_SHAPE" && "$LIVE_SHAPE" != "$REMOTE_SHAPE" ]]; then
  if [[ "$LIVE_VERSION" == "$REMOTE_SHAPE_VERSION" ]]; then
    echo ""
    echo "ERROR: config shape changed but configVersion was not increased."
    echo ""
    echo "Add a migration step in src/migrations.js and bump CURRENT_CONFIG_VERSION,"
    echo "then run 'npm run config-snapshot'. See skills/config-migration.md."
    exit 1
  fi
  echo "Config shape changed: v$REMOTE_SHAPE_VERSION → v$LIVE_VERSION (migration present)"
fi

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
  echo "Bump the version before pushing:"
  echo "  npm version patch --no-git-tag-version   # bug fix (x.y.Z)"
  echo "  npm version minor --no-git-tag-version   # new feature (x.Y.0)"
  echo "  npm version major --no-git-tag-version   # breaking change (X.0.0)"
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
