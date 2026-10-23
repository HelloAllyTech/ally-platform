#!/usr/bin/env bash
# publish-wiki.sh — Mirror helloallytech.github.io/ from the ally-platform monorepo
# to the public GitHub Pages repository (HelloAllyTech/helloallytech.github.io)
# so https://tech.helloally.ai stays live with zero DNS or infrastructure changes.
#
# Usage:
#   ./scripts/publish-wiki.sh            # Build routing index and push to GitHub Pages repo
#   ./scripts/publish-wiki.sh --dry-run  # Verify build and diff without pushing

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIKI_SRC="${ROOT_DIR}/helloallytech.github.io"
WIKI_REMOTE="${WIKI_REMOTE_URL:-git@github.com:HelloAllyTech/helloallytech.github.io.git}"
WIKI_BRANCH="main"

if [[ ! -d "$WIKI_SRC" ]]; then
  echo "error: Wiki directory not found at $WIKI_SRC" >&2
  exit 1
fi

echo "=== Preparing Ally Developer Wiki (tech.helloally.ai) ==="

# 1. Regenerate routing index and platform stats from local monorepo checkouts
if command -v python3 >/dev/null 2>&1; then
  (
    cd "$WIKI_SRC"
    python3 scripts/gen-routing.py
    python3 scripts/gen-stats.py --repos "$ROOT_DIR"
  )
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Cloning current GitHub Pages target ($WIKI_REMOTE)..."
git clone --depth=1 --branch "$WIKI_BRANCH" "$WIKI_REMOTE" "$TMP_DIR/pages"

# Sync all tracked wiki files (preserving .git in the target clone)
rsync -a --delete \
  --exclude='.git/' \
  --exclude='.wiki-tmp/' \
  --exclude='__pycache__/' \
  "$WIKI_SRC/" "$TMP_DIR/pages/"

cd "$TMP_DIR/pages"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "✅ tech.helloally.ai is already up to date with ally-platform/helloallytech.github.io."
  exit 0
fi

echo "Changes to publish to tech.helloally.ai:"
git status -s

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[Dry Run] Skipping git commit & push to $WIKI_REMOTE."
  exit 0
fi

SOURCE_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
git add -A
git commit -m "chore(wiki): publish from ally-platform@${SOURCE_SHA}"
git push origin "$WIKI_BRANCH"

echo "🚀 Published to $WIKI_REMOTE ($WIKI_BRANCH) — https://tech.helloally.ai updated!"
