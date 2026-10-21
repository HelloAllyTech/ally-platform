---
title: Documentation System
tags: [contributing, docs, agents, ci, automation]
summary: How Ally's documentation is routed, deduplicated, enforced in CI, and kept current — the contract behind AGENTS.md, .docs-map.yml, ROUTING.md, and the weekly reconciler.
last_reconciled: 2026-08-06
---

# Documentation System

This page documents the machinery that keeps Ally's docs findable and current. If you are
just trying to *write* something, you probably want the [Contributing Guide](guide.md) instead.

The system optimises for five things, in this order:

1. An AI coding session finds the right context **fast**.
2. The context it finds is **relevant and complete**.
3. It does **not** load context it didn't need.
4. Docs get **updated** as a side effect of shipping code, not as an act of virtue.
5. Every fact has **one home**.

---

## 1. The layers

| Layer | Lives in | Size budget | Loaded |
|---|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | each code repo, root | ≤ 120 lines | always, automatically |
| `WIKI-ROUTING.md` | each code repo, generated | ≤ 1,000 tokens | always, automatically |
| Repo-local deep docs | each code repo (`docs/`, `DATA_SCHEMA.md`) | unbounded | on demand |
| The wiki | `helloallytech.github.io` | unbounded | on demand, over HTTP |

The rule that makes this work: **the always-loaded layers contain routing and invariants;
everything with a size or a shelf-life lives in the on-demand layers.**

`AGENTS.md` is a *router*, not a summary. It answers "given what I am about to do, what
should I read?" — and nothing else. It never restates a convention that has a canonical
home; it links to it.

`CLAUDE.md` is a byte-identical copy of `AGENTS.md`, kept in step by CI (see §3). Two files
exist only because different tools look for different names.

---

## 2. `.docs-map.yml` — which docs cover which code

Every code repo has one at its root. It is the single declaration of doc↔code ownership,
and three separate systems read it: the CI guard, the weekly reconciler, and humans trying
to work out what they broke.

```yaml
version: 1
repo: ally-be

rules:
  - id: data-schema
    watch:
      - "src/**/entity/*.entity.ts"
    requires: DATA_SCHEMA.md
    why: >
      Why this doc must move when this code moves.
```

**`watch`** — glob patterns, matched against the PR's changed files.

**`requires`** — what must also change. One of:

| Form | Meaning |
|---|---|
| `path/to/doc.md` | a file in this repo; the PR must touch it |
| `wiki:platform/architecture.md` | a page in the wiki repo; the PR body must carry a `Wiki-PR:` trailer |
| `any_of: [a.md, b.md]` | at least one of these |
| `mirror` | the watched files must be byte-identical to each other |
| `none` | watched, but no doc required (documents a deliberate decision) |

**`why`** — one sentence. Required. A rule nobody can justify is a rule that will be
skipped forever, and the text is what the CI failure message shows.

### Escape hatches

Two, both deliberate and both visible in the PR record:

- The **`docs:skip` label** — for changes where the doc genuinely doesn't move.
- A **`Wiki-PR: none — <reason>`** trailer in the PR body — same, but leaves the reason in
  the commit history.

Heavy use of either is a signal the rule is wrong. Fix the rule; don't normalise the bypass.

---

## 3. CI: the docs guard

One reusable workflow lives in `helloallytech/.github` and every code repo calls it in ~10
lines. It runs on every PR and:

1. Reads `.docs-map.yml`.
2. Matches changed files against each rule's `watch` globs.
3. Fails if a matched rule's `requires` is unsatisfied — unless an escape hatch applies.
4. Asserts `AGENTS.md` and `CLAUDE.md` are identical.
5. Checks `AGENTS.md` is within its line budget.

The failure message names the rule, quotes its `why`, and prints the exact command to fix
it. A guard that only says "docs check failed" trains people to reach for the label.

---

## 4. Updating the wiki from a code repo

Wiki edits used to need a second, hand-rolled PR in a second repo. That friction — not
forgetfulness — is why four platform pages sat unchanged for a month while the code moved
daily. The path is now one command:

```bash
git clone --depth=1 https://github.com/helloallytech/helloallytech.github.io .wiki-tmp
# edit .wiki-tmp/wiki/**
.wiki-tmp/scripts/wiki-pr.sh "<url of your code PR>"   # PR flow
.wiki-tmp/scripts/wiki-pr.sh HEAD                      # trunk-based: the commit you pushed
```

`.wiki-tmp/` is gitignored in every code repo, so nothing leaks into the code branch. The
script branches, commits, pushes, and opens a **draft** wiki PR stamped with a `Source:`
trailer.

`main` in the wiki repo is protected: every change lands through a pull request, including
the bot's. No approval is required — the seam exists so a change to a **public** site is
visible and revertible, not to add a rubber stamp. Force-pushes and branch deletion are
off.

**Both source kinds are first-class**, because most changes here go straight to the default
branch rather than through a PR:

| Source | Trailer | What you do next |
|---|---|---|
| a code PR | `Source: …/pull/<n>` | paste the printed `Wiki-PR:` line into the PR body — that is what satisfies the guard in §3 |
| a commit | `Source: …/commit/<sha>` | nothing; a direct push has no description to carry a trailer |

The script commits under **your** git identity, inherited from the code repo you ran it
from. If it cannot find one it stops rather than substituting a placeholder — documentation
should count as its author's contribution.

**You do not need write access to the wiki repo.** Write access there is limited to the org
owners. If you do not have it, the script forks the repo to your account the first time,
pushes the branch there, and opens the PR against the wiki from your fork. The command is
the same either way, and the PR, the `Source:` trailer and the lifecycle coupling all behave
identically — a fork PR is merged by the bot exactly like any other.

### Lifecycle coupling

A workflow in the wiki repo reads the `Source:` trailer and keeps the wiki PR in step with
whatever spawned it:

- source PR **merges**, or source commit **reaches the default branch** → wiki PR marked
  ready and merged
- source PR **closes unmerged** → wiki PR closed
- source **pending > 7 days** → nudge (on both PRs; a commit has nothing to nudge, so the
  wiki PR alone)

So docs land in the same beat as the code, instead of drifting into a stale open PR. A wiki
PR with no `Source:` trailer at all is left alone — which also means it will never be marked
ready, so hand-written wiki PRs must be merged by hand.

---

## 5. The reconciler

§3 and §4 only fire when someone touches watched code. Pages that describe the platform
in general have no such trigger and drift silently — which is exactly what happened to
`tech-stack.md`, `dev-setup.md` and `repos/infra.md`.

So a scheduled job runs weekly in the wiki repo, walks every page carrying
`last_reconciled` frontmatter, verifies its claims against the current code, and opens
**one** PR with corrections plus a stamp bump. Pages it cannot verify get an issue instead.

It opens PRs. It never pushes to `main`.

---

## 6. Facts that go stale by construction

Counts belong in generated output, not prose. `wiki/platform/stats.md` is regenerated by the
reconciler; prose should state invariants that survive a refactor:

> ✅ "Every ally-be entity carries a `tenantId`; queries must respect tenant isolation."
> ❌ "ally-be has 43 modules and 211+ migrations."

If you catch yourself typing a number that a script could count, put it in `platform/stats.md`
and link to it.

File paths rot the same way: `scripts/docs-path-lint.mjs` (the same file in every Ally repo, run as the `docs-paths` CI job) fails on a backticked path in a doc that no longer exists — fix the path, or mark a deliberate one `<!-- docs-path-lint: planned -->` (or `ignore`).

---

## 7. Adding to the system

**A new doc that must not go stale** → add a rule to the relevant `.docs-map.yml`, with a `why`.

**A new wiki page** → add frontmatter (`title`, `tags`, `summary`, `last_reconciled`),
register it in [`index.md`](../index.md), log it in [`log.md`](../log.md). `ROUTING.md` and
`manifest.json` regenerate themselves from the frontmatter — do not hand-edit either.

**A new convention** → put it in exactly one place and link to it from the others. If you
find the same rule written twice, that is a bug: the copies will disagree, and an agent
reading both will pay tokens to arrive at ambiguity.

---

*See also: [Contributing Guide](guide.md) · [Cross-Repo Agent Guide](../platform/agent-guide.md) · [Getting Started](../getting-started.md)*
