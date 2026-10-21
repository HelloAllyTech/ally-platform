---
title: ally-changelog — Cross-Repo Changelog Journal
tags: [repo, changelog, automation, github-actions]
summary: Holds the auto-written CHANGELOG.md fed by merges across every Ally repo, via a shared dispatch workflow.
last_reconciled: 2026-08-14
---

# ally-changelog — Cross-Repo Changelog Journal

## Purpose

`ally-changelog` holds `CHANGELOG.md` — a running, auto-written journal of every merge
across the Ally repos. It is read periodically to draft external release notes; it is
not itself published anywhere. There is no application code here — the repo *is* the
changelog file plus the workflow that appends to it.

## How an entry gets here

1. A source repo (`ally-be`, `ally-ai`, `ally-ai-learn`, `ally-web`, `ally-mobile`,
   `infra`) merges to its release branch. That repo's
   `.github/workflows/changelog-notify.yml` fires on the push and fetches its actual <!-- docs-path-lint: ignore -->
   logic at runtime from [`HelloAllyTech/.github`](https://github.com/HelloAllyTech/.github)'s
   `scripts/changelog-notify.sh` — one copy of that logic, not six. <!-- docs-path-lint: ignore -->
2. That script determines whether the push was a merged PR (pulling title/body/author/
   url) or a direct push (falling back to the raw commit list), and — for `ally-web`
   only — which of its three apps changed.
3. It fires a `repository_dispatch` (`event_type: new-entry`) at this repo, authenticated
   with a `CHANGELOG_DISPATCH_TOKEN` secret that lives in the source repo and can do
   nothing except dispatch to `ally-changelog`.
4. `.github/workflows/append-entry.yml` here receives it, asks Claude to draft a
   one-line customer-facing paraphrase (falling back to the raw title if that call
   fails), and commits the formatted entry into `CHANGELOG.md`.

## Secrets

- **`ANTHROPIC_API_KEY`** — set only here; used by `append-entry.yml` to draft the
  "For release notes" line. Nothing else in this system needs it.
- **`CHANGELOG_DISPATCH_TOKEN`** is not a secret *of* this repo — it's a fine-grained PAT
  scoped to only this repository with `Contents: read and write`, added as a secret to
  each *source* repo instead.

## Onboarding a new source repo

Nothing here changes. In the new repo:

1. Add `.github/workflows/changelog-notify.yml` (copy from any existing source repo, <!-- docs-path-lint: ignore -->
   swap the release branch if it isn't `master`).
2. Add the `CHANGELOG_DISPATCH_TOKEN` secret (same PAT value already used elsewhere).

The new repo starts showing up in `CHANGELOG.md` on its next merge.

## Gotchas that change what you write

- **This repo has no build, tests, or app code** — the only thing to get right is the
  workflow contract (dispatch event shape, token scope). Don't add tooling here that
  belongs in the shared `.github` scripts instead — that would fork the one-copy-of-logic
  design the whole system depends on.
- Onboarding `calibrate`/`calibrate-backend`/`calibrate-frontend` as changelog sources
  follows the same three-repo pattern as the six existing ones — nothing special about
  them here.

## Canonical docs

- [`HelloAllyTech/.github`](https://github.com/HelloAllyTech/.github) — the shared
  `scripts/changelog-notify.sh` every source repo's workflow calls. <!-- docs-path-lint: ignore -->
