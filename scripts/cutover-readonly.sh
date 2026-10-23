#!/usr/bin/env bash
# cutover-readonly.sh — Finalize the monorepo cutover:
#   1. Run a final sync from all 7 source repositories (`./scripts/sync-monorepo.sh`)
#   2. Push `ally-platform` (branch + all prefixed tags) to `HelloAllyTech/ally-platform`
#   3. Mark the 6 code/infra repositories as archived (read-only) on GitHub
#      (Note: `helloallytech.github.io` stays unarchived so GitHub Pages continues serving
#       `tech.helloally.ai`, receiving automated pushes from `publish-wiki.yml`.)
#
# Usage:
#   ./scripts/cutover-readonly.sh --dry-run   # Verify readiness without pushing or archiving
#   ./scripts/cutover-readonly.sh --execute   # Perform final sync, push, and archive old repos

set -euo pipefail

MODE="${1:---dry-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPOS_TO_ARCHIVE=(
  "HelloAllyTech/ally-be"
  "HelloAllyTech/ally-web"
  "HelloAllyTech/ally-ai"
  "HelloAllyTech/ally-ai-learn"
  "HelloAllyTech/ally-mobile"
)

echo "=== Step 1: Running sync check across all 7 repositories ==="
if [[ "$MODE" == "--execute" ]]; then
  ./scripts/sync-monorepo.sh
else
  ./scripts/sync-monorepo.sh --dry-run
fi

echo ""
echo "=== Step 2: Push ally-platform monorepo and tags ==="
if [[ "$MODE" == "--execute" ]]; then
  echo "Pushing master branch and all tags to origin (HelloAllyTech/ally-platform)..."
  git push -u origin master
  git push origin --tags
else
  echo "[Dry Run] Would run:"
  echo "  git push -u origin master"
  echo "  git push origin --tags"
fi

echo ""
echo "=== Step 3: Enable GitHub Actions on HelloAllyTech/ally-platform ==="
if [[ "$MODE" == "--execute" ]]; then
  echo "Enabling GitHub Actions on HelloAllyTech/ally-platform..."
  gh api -X PUT /repos/HelloAllyTech/ally-platform/actions/permissions -F enabled=true
  echo "  ✅ GitHub Actions enabled on HelloAllyTech/ally-platform."
else
  echo "[Dry Run] Would run: gh api -X PUT /repos/HelloAllyTech/ally-platform/actions/permissions -F enabled=true"
fi

echo ""
echo "=== Step 4: Archive legacy repositories (mark as read-only) ==="
for repo in "${REPOS_TO_ARCHIVE[@]}"; do
  if [[ "$MODE" == "--execute" ]]; then
    echo "Archiving $repo..."
    gh repo archive "$repo" --yes
    echo "  ✅ $repo is now read-only."
  else
    echo "[Dry Run] Would run: gh repo archive $repo --yes"
  fi
done

echo ""
echo "ℹ️  Note: HelloAllyTech/helloallytech.github.io is intentionally kept active as the"
echo "   GitHub Pages publishing target for https://tech.helloally.ai (fed automatically"
echo "   by .github/workflows/publish-wiki.yml and ./scripts/publish-wiki.sh)."
