#!/usr/bin/env bash
# sync-monorepo.sh — Continuously sync commits and tags from the 7 individual Ally
# repositories into the unified ally-platform monorepo.
#
# Usage:
#   ./scripts/sync-monorepo.sh            # Sync all 7 repos + tags + mirror wiki if changed
#   ./scripts/sync-monorepo.sh --dry-run  # Fetch and report pending commits without merging
#
# Each source repo is merged into its own subdirectory (<repo>/) using git subtree
# merge metadata so full commit history (`git log --follow`) is preserved and
# working-tree untracked files (.env, node_modules, .venv) are never touched.

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Format: "subdir|remote_name|remote_url|branch|tag_refspec"
REPOS=(
  "ally-be|remote-ally-be|git@github.com:HelloAllyTech/ally-be.git|master|+refs/tags/*:refs/tags/be-*"
  "ally-web|remote-ally-web|git@github.com:HelloAllyTech/ally-web.git|master|+refs/tags/admin-v*:refs/tags/admin-v* +refs/tags/helpline-v*:refs/tags/helpline-v* +refs/tags/v*:refs/tags/web-v*"
  "ally-ai|remote-ally-ai|git@github.com:HelloAllyTech/ally-ai.git|master|+refs/tags/*:refs/tags/ai-*"
  "ally-ai-learn|remote-ally-ai-learn|git@github.com:HelloAllyTech/ally-ai-learn.git|master|+refs/tags/*:refs/tags/learn-*"
  "ally-mobile|remote-ally-mobile|git@github.com:HelloAllyTech/ally-mobile.git|master|+refs/tags/*:refs/tags/*"
  "ally-mobile-flutter|remote-ally-mobile-flutter|git@github.com:HelloAllyTech/ally-mobile-flutter.git|master|+refs/tags/*:refs/tags/*"
  "helloallytech.github.io|remote-wiki|git@github.com:HelloAllyTech/helloallytech.github.io.git|main|"
)

echo -e "${BLUE}=== Ally Monorepo Sync ($(date -u '+%Y-%m-%d %H:%M:%S UTC')) ===${NC}"

# Clean up any macOS/iCloud duplicate conflict files inside .git/ (e.g. "master 2")
find "$ROOT_DIR/.git" -name "* [0-9]*" -delete 2>/dev/null || true

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${YELLOW}⚠️  Working tree has uncommitted changes to tracked files.${NC}"
  if [[ "$DRY_RUN" == "false" ]]; then
    echo -e "${RED}Please commit or stash tracked changes before running sync-monorepo.sh (or pass --dry-run).${NC}"
    exit 1
  fi
fi

MERGED_COUNT=0

for entry in "${REPOS[@]}"; do
  IFS='|' read -r dir remote url branch tag_refspecs <<< "$entry"

  # Ensure remote exists
  if ! git remote get-url "$remote" >/dev/null 2>&1; then
    git remote add "$remote" "$url"
  fi

  echo -e "\n${BLUE}➡️  Checking ${dir} (${remote}/${branch})...${NC}"
  git fetch --no-tags "$remote" "$branch"

  # Sync tags with scoped prefixes
  if [[ -n "$tag_refspecs" && "$DRY_RUN" == "false" ]]; then
    # shellcheck disable=SC2086
    git fetch --quiet "$remote" $tag_refspecs || true
  fi

  remote_sha="$(git rev-parse "${remote}/${branch}")"

  # Check if remote_sha is already an ancestor of HEAD
  if git merge-base --is-ancestor "$remote_sha" HEAD 2>/dev/null; then
    echo -e "${GREEN}  ✓ Up to date (${remote_sha:0:7})${NC}"
    continue
  fi

  # Count how many new commits came in on the source repo
  last_split="$(git log --grep="git-subtree-dir: ${dir}$" -n 1 --format='%b' | awk '/^git-subtree-split:/ {print $2}' || true)"
  if [[ -n "$last_split" ]]; then
    new_commits="$(git log --oneline "${last_split}..${remote_sha}" | wc -l | tr -d ' ')"
    echo -e "${YELLOW}  ⚡ ${new_commits} new commit(s) found (${last_split:0:7}..${remote_sha:0:7}):${NC}"
    git log --oneline -n 10 "${last_split}..${remote_sha}" | sed 's/^/     /'
  else
    echo -e "${YELLOW}  ⚡ New commits found at ${remote_sha:0:7}${NC}"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    continue
  fi

  echo -e "${BLUE}  🔄 Merging ${remote}/${branch} into ${dir}/...${NC}"
  git merge -s subtree -Xsubtree="${dir}" --no-edit "${remote}/${branch}" \
    -m "Merge '${dir}/' from commit '${remote_sha}'

git-subtree-dir: ${dir}
git-subtree-mainline: $(git rev-parse HEAD)
git-subtree-split: ${remote_sha}"

  MERGED_COUNT=$((MERGED_COUNT + 1))
  echo -e "${GREEN}  ✅ Merged ${dir} (${remote_sha:0:7})${NC}"
done

if [[ "$DRY_RUN" == "false" && "$MERGED_COUNT" -gt 0 ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    echo -e "\n${BLUE}🚀 Pushing synced commits and tags to origin (HelloAllyTech/ally-platform)...${NC}"
    git push origin master
    git push origin --tags
    echo -e "${GREEN}  ✅ Pushed to origin/master${NC}"
  fi
fi

echo -e "\n${GREEN}=== Sync complete (${MERGED_COUNT} repo(s) updated) ===${NC}"
