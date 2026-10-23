#!/usr/bin/env bash
# Open a wiki PR for documentation changes made alongside a code change.
#
# Updating the wiki used to mean cloning a second repo and hand-rolling a second PR. That
# friction is why platform pages sat unchanged for a month while the code moved daily.
# This makes it one command.
#
# Usage, from any code repo:
#
#   git clone --depth=1 https://github.com/helloallytech/helloallytech.github.io .wiki-tmp
#   # edit .wiki-tmp/wiki/**
#   .wiki-tmp/scripts/wiki-pr.sh "https://github.com/helloallytech/ally-be/pull/123"
#   .wiki-tmp/scripts/wiki-pr.sh HEAD     # a commit you just pushed to the default branch
#
# Two thirds of the commits on this platform go straight to the default branch, so a source
# is as often a commit as a pull request. Both are accepted:
#
#   PR source     — prints a `Wiki-PR:` trailer to paste into the PR body, which satisfies
#                   the docs guard; the wiki PR merges when the source PR merges.
#   commit source — nothing to paste (a direct push has no description); the wiki PR merges
#                   on the next lifecycle pass once the commit is on the default branch.
#
# Spec: https://tech.helloally.ai/#/wiki/contributing/docs-system.md

set -euo pipefail

SOURCE_ARG="${1:-}"
SRC_DIR="$PWD"                  # the code repo we were invoked from, before we cd away
WIKI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m%s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }

src_git() { git -C "$SRC_DIR" "$@" 2>/dev/null; }

if [[ -z "$SOURCE_ARG" ]]; then
  me="$(basename "${BASH_SOURCE[0]}")"
  die "pass the code PR or the commit these docs belong to:
    $me \"https://github.com/helloallytech/<repo>/pull/<n>\"
    $me HEAD            # or a commit SHA, if you pushed straight to the default branch"
fi

# --------------------------------------------------------------------- resolve the source

if [[ "$SOURCE_ARG" =~ ^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)/?$ ]]; then
  SOURCE_KIND="pr"
  SOURCE_OWNER="${BASH_REMATCH[1]}"
  SOURCE_REPO="${BASH_REMATCH[2]}"
  SOURCE_REF="${BASH_REMATCH[3]}"
  SOURCE_URL="https://github.com/${SOURCE_OWNER}/${SOURCE_REPO}/pull/${SOURCE_REF}"
  SOURCE_LABEL="${SOURCE_REPO}#${SOURCE_REF}"
  BRANCH="docs/from-${SOURCE_REPO}-pr-${SOURCE_REF}"

elif [[ "$SOURCE_ARG" =~ ^https://github\.com/([^/]+)/([^/]+)/commit/([0-9a-fA-F]{7,40})/?$ ]]; then
  SOURCE_KIND="commit"
  SOURCE_OWNER="${BASH_REMATCH[1]}"
  SOURCE_REPO="${BASH_REMATCH[2]}"
  SOURCE_REF="${BASH_REMATCH[3]}"
  SOURCE_URL="https://github.com/${SOURCE_OWNER}/${SOURCE_REPO}/commit/${SOURCE_REF}"
  SOURCE_LABEL="${SOURCE_REPO}@${SOURCE_REF:0:7}"
  BRANCH="docs/from-${SOURCE_REPO}-commit-${SOURCE_REF:0:7}"

else
  # A revision — HEAD, a tag, a bare SHA. Resolve it against the repo we were invoked from.
  src_git rev-parse --git-dir >/dev/null \
    || die "\"$SOURCE_ARG\" is not a PR URL, and $SRC_DIR is not a git repo, so there is
    nothing to resolve it against. Run this from your code repo."

  SOURCE_REF="$(src_git rev-parse --verify "${SOURCE_ARG}^{commit}" || true)"
  [[ -n "$SOURCE_REF" ]] || die "\"$SOURCE_ARG\" is neither a PR URL nor a commit in $SRC_DIR."

  ORIGIN="$(src_git remote get-url origin || true)"
  [[ -n "$ORIGIN" ]] || die "$SRC_DIR has no 'origin' remote, so I cannot tell which repo
    commit ${SOURCE_REF:0:7} belongs to. Pass the full commit URL instead."

  SLUG="$(printf '%s' "$ORIGIN" | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
  SOURCE_OWNER="${SLUG%%/*}"
  SOURCE_REPO="${SLUG##*/}"
  SOURCE_KIND="commit"
  SOURCE_URL="https://github.com/${SOURCE_OWNER}/${SOURCE_REPO}/commit/${SOURCE_REF}"
  SOURCE_LABEL="${SOURCE_REPO}@${SOURCE_REF:0:7}"
  BRANCH="docs/from-${SOURCE_REPO}-commit-${SOURCE_REF:0:7}"

  # The lifecycle bot resolves the commit through the GitHub API, so an unpushed commit
  # leaves the wiki PR waiting forever. Say so now rather than letting it sit.
  if [[ -z "$(src_git branch -r --contains "$SOURCE_REF" 2>/dev/null)" ]]; then
    warn "commit ${SOURCE_REF:0:7} is not on any remote branch yet — push it, or the wiki
    PR will wait indefinitely for a commit GitHub cannot see."
  fi
fi

# ------------------------------------------------------------------------ stage the change

cd "$WIKI_ROOT"
[[ -d wiki ]] || die "no wiki/ directory here — is $WIKI_ROOT really the wiki clone?"

# A shallow clone can't push a branch history; deepen before we try.
if [[ -f .git/shallow ]]; then
  info "Deepening shallow clone…"
  git fetch --unshallow --quiet origin || git fetch --depth=50 --quiet origin
fi

if [[ -x scripts/gen-routing.py ]] || [[ -f scripts/gen-routing.py ]]; then
  info "Regenerating the routing index…"
  python3 scripts/gen-routing.py >/dev/null
fi

if git diff --quiet && git diff --cached --quiet && [[ -z "$(git status --porcelain wiki)" ]]; then
  die "no changes under wiki/ — edit a page first."
fi

info "Changed:"
git status --porcelain wiki | sed 's/^/  /'

# --------------------------------------------------------------- push here, or to a fork

# Write access to the wiki repo is limited to the org owners. Everyone else — most of the
# team, and every outside contributor — goes through a fork, which a public repo supports
# without granting anyone write access to it. Same one command either way.
WIKI_SLUG="helloallytech/helloallytech.github.io"
PUSH_REMOTE="origin"
HEAD_REF="$BRANCH"

can_push_upstream() {
  command -v gh >/dev/null 2>&1 || return 1
  [[ "$(gh api "repos/$WIKI_SLUG" --jq '.permissions.push // false' 2>/dev/null)" == "true" ]]
}

if ! can_push_upstream; then
  command -v gh >/dev/null 2>&1 || die "you do not have write access to $WIKI_SLUG, and
    gh is not installed, so I cannot open the fork for you. Install the GitHub CLI, or
    fork the repo by hand and push this branch there."

  ME="$(gh api user --jq .login 2>/dev/null)" \
    || die "gh is not authenticated — run: gh auth login"
  FORK="$ME/helloallytech.github.io"

  if ! gh api "repos/$FORK" >/dev/null 2>&1; then
    info "No write access to the wiki repo — forking to $FORK…"
    # No --remote here: gh rejects it whenever a repository argument is given.
    gh repo fork "$WIKI_SLUG" --clone=false >/dev/null 2>&1 || true
    # Forking is asynchronous; the repo 404s for a few seconds after the call returns.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      gh api "repos/$FORK" >/dev/null 2>&1 && break
      sleep 2
    done
    gh api "repos/$FORK" >/dev/null 2>&1 || die "fork of $WIKI_SLUG did not appear as $FORK."
  fi

  git remote get-url wiki-fork >/dev/null 2>&1 \
    || git remote add wiki-fork "https://github.com/${FORK}.git"
  PUSH_REMOTE="wiki-fork"
  HEAD_REF="${ME}:${BRANCH}"
  info "Pushing to your fork ($FORK); the PR still targets $WIKI_SLUG."
fi

# Never commit someone's documentation under a placeholder identity. `.wiki-tmp/` is a fresh
# clone, so a contributor who configures git per-repo — or any container or agent session —
# used to land here as "ally-docs", an address no GitHub account owns, silently costing them
# the credit. Inherit from the code repo; if there is nothing to inherit, stop.
if ! git config user.email >/dev/null 2>&1; then
  SRC_NAME="$(src_git config user.name  || true)"
  SRC_EMAIL="$(src_git config user.email || true)"
  [[ -n "$SRC_EMAIL" ]] || die "no git identity configured, here or in $SRC_DIR.
    Set one so this lands as your contribution:
      git config --global user.name  \"Your Name\"
      git config --global user.email \"you@example.com\""
  git config user.name  "$SRC_NAME"
  git config user.email "$SRC_EMAIL"
  info "Committing as $SRC_NAME <$SRC_EMAIL> (inherited from $SRC_DIR)"
fi

git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"
git add wiki
git commit --quiet -m "docs: update wiki for ${SOURCE_LABEL}

Source: ${SOURCE_URL}"

info "Pushing $BRANCH to $PUSH_REMOTE…"
for attempt in 1 2 3 4; do
  if git push -u "$PUSH_REMOTE" "$BRANCH" --quiet; then break; fi
  [[ $attempt -eq 4 ]] && die "push failed after 4 attempts"
  sleep $((2 ** attempt))
done

if [[ "$SOURCE_KIND" == "pr" ]]; then
  COUPLING="This PR is coupled to its source: it is marked ready and merged when the source
PR merges, and closed if the source PR is closed unmerged."
else
  COUPLING="This PR is coupled to its source commit: it is marked ready and merged once that
commit is on the source repo's default branch."
fi

BODY="Documentation for ${SOURCE_LABEL}.

Source: ${SOURCE_URL}

${COUPLING} See
[the docs system](https://tech.helloally.ai/#/wiki/contributing/docs-system.md).

---
_Generated by [Claude Code](https://claude.ai/code)_"

if command -v gh >/dev/null 2>&1; then
  PR_URL="$(gh pr create --draft --repo "$WIKI_SLUG" \
    --title "docs: update wiki for ${SOURCE_LABEL}" \
    --body "$BODY" --head "$HEAD_REF" 2>/dev/null \
    || gh pr list --repo "$WIKI_SLUG" --head "$BRANCH" --state open \
         --json url --jq '.[0].url // empty')"
  [[ -n "$PR_URL" ]] || die "the branch pushed, but the PR could not be created. Open it by
    hand from https://github.com/${WIKI_SLUG}/compare/main...${HEAD_REF}?expand=1 and include
    this line in the body:  Source: ${SOURCE_URL}"
else
  info "gh not installed — open the PR manually:"
  echo "  https://github.com/${WIKI_SLUG}/compare/main...${HEAD_REF}?expand=1"
  echo "  and include this line in the body:  Source: ${SOURCE_URL}"
  PR_URL="<paste the wiki PR url here>"
fi

if [[ "$SOURCE_KIND" == "pr" ]]; then
  cat <<EOF

────────────────────────────────────────────────────────────
Paste this into the description of ${SOURCE_URL}:

Wiki-PR: ${PR_URL}
────────────────────────────────────────────────────────────
EOF
else
  cat <<EOF

────────────────────────────────────────────────────────────
${PR_URL}

Nothing to paste — a direct push has no description to carry a trailer. This wiki PR
merges by itself once ${SOURCE_REF:0:7} is on ${SOURCE_REPO}'s default branch.
────────────────────────────────────────────────────────────
EOF
fi
