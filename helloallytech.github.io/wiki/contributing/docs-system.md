---
title: Documentation System
tags: [contributing, docs, agents, ci, automation]
summary: How Ally's documentation is routed, deduplicated, enforced in CI, and kept current inside the ally-platform monorepo — the contract behind AGENTS.md, .docs-map.yml, ROUTING.md, the Core Concepts lint and the weekly health sweep.
last_reconciled: 2026-11-18
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

Since the 2026-10-23 move, all of this lives in one repository, `ally-platform`: the code
of every service **and** the wiki's source (`helloallytech.github.io/`). That is what makes
§4 a same-PR edit rather than a second PR in a second repo.

---

## 1. The layers

| Layer | Lives in | Size budget | Loaded |
|---|---|---|---|
| `AGENTS.md` / `CLAUDE.md` | monorepo root and each app directory | root `AGENTS.md` ≤ 120 lines (CI) | always, automatically |
| `ROUTING.md` / `WIKI-ROUTING.md` | root and each service directory, generated | small | always, automatically |
| Repo-local deep docs | each app (`docs/`, `DATA_SCHEMA.md`), plus root `docs/` | unbounded | on demand |
| The wiki | `helloallytech.github.io/wiki/` | unbounded | on demand, as files or over HTTP |

The rule that makes this work: **the always-loaded layers contain routing and invariants;
everything with a size or a shelf-life lives in the on-demand layers.**

`AGENTS.md` is a *router*, not a summary. It answers "given what I am about to do, what
should I read?" — and nothing else. It never restates a convention that has a canonical
home; it links to it.

In each **app** directory `CLAUDE.md` is a byte-identical copy of `AGENTS.md`, kept in step
by `mirror` rules in `.docs-map.yml` (see §2) — two files exist only because different tools
look for different names. At the **root** the two differ: `CLAUDE.md` is the longer
workspace guide and `AGENTS.md` the short router.

For vocabulary, start with [Core Concepts](../platform/concepts.md): one card per concept,
saying what it is, what it is made of, where its code is and whether it is live.

---

## 2. `.docs-map.yml` — which docs cover which code

**The one at the monorepo root is the one CI enforces.** It is the single declaration of
doc↔code ownership; the per-app copies (`ally-be/.docs-map.yml` and siblings) are leftovers
from the per-repo layout and are not read by the guard.

```yaml
version: 1
repo: ally-platform

rules:
  - id: ally-be-data-schema
    watch:
      - "ally-be/src/**/entity/*.entity.ts"
    requires: ally-be/DATA_SCHEMA.md
    why: >
      Why this doc must move when this code moves.
```

**`watch`** — glob patterns, matched against the PR's changed files (repo-relative).

**`requires`** — what must also change. One of:

| Form | Meaning |
|---|---|
| `path/to/doc.md` | a file in the monorepo — including a wiki page, `helloallytech.github.io/wiki/<page>`; the PR must touch it |
| `wiki:platform/architecture.md` | legacy form: satisfied only by a `Wiki-PR:` line in the PR description. Prefer the plain path `helloallytech.github.io/wiki/<page>`, which the PR satisfies by touching the page |
| `any_of: [a.md, b.md]` | at least one of these |
| `mirror` | the watched files must be byte-identical to each other |
| `none` | watched, but no doc required (documents a deliberate decision) |

**`why`** — one sentence. Required. A rule nobody can justify is a rule that will be
skipped forever, and the text is what the CI failure message shows.

### Escape hatches

Deliberate and visible in the record:

- The **`docs:skip` label** on a pull request — for changes where the doc genuinely doesn't
  move. It waives every rule, so say why in the PR description.
- A **`Wiki-PR: none — <reason>`** line in the PR description — waives `wiki:` rules only;
  in-repo doc rules still apply.
- A **`Docs-Skip: <reason>`** trailer in a commit message — honoured only on a **direct push
  to `master`**, where there is no PR to label. On a pull request it does nothing.

Heavy use of either is a signal the rule is wrong. Fix the rule; don't normalise the bypass.

---

## 3. CI: the docs jobs

`.github/workflows/docs.yml` runs on every pull request and every push to `master`:

| Job | What it checks |
|---|---|
| `docs-guard` | Fetches the shared `docs_guard.py` from the `HelloAllyTech/.github` repo, matches changed files against the root `.docs-map.yml`, fails an unsatisfied rule unless an escape hatch applies, and checks the root `AGENTS.md` line budget. Advisory: it shows red but does not block a merge. |
| `concepts` | `scripts/concepts_lint.py` — every module, package, page and feature directory and every `FeatureToggleKey` is on a [Core Concepts](../platform/concepts.md) card, and every path that page names exists. |
| `docs-paths` | `scripts/docs-path-lint.mjs` — a backticked file path in any tracked doc must exist. Mark a deliberate one `<!-- docs-path-lint: planned -->` (or `ignore`). |

The failure message names the rule, quotes its `why`, and says how to fix it. A guard that
only says "docs check failed" trains people to reach for the label.

`routing-index.yml` (on PRs touching the wiki or a routing file) asserts the generated
routing files are current; `wiki-health.yml` runs the wiki lint on wiki PRs too (§5).

---

## 4. Updating the wiki from a code change

Edit `helloallytech.github.io/wiki/<page>` **in the same branch and PR as the code**. That
is all — no second repo, no second PR. Then:

1. If you changed a page's frontmatter or added a page, run
   `python3 helloallytech.github.io/scripts/gen-routing.py` and commit what it writes
   (`wiki/ROUTING.md`, `wiki/manifest.json`, and the root and per-service `ROUTING.md` /
   `WIKI-ROUTING.md` copies).
2. A new page also goes in [`index.md`](../index.md), and every change gets a line in
   [`log.md`](../log.md).

**Publishing.** `publish-wiki.yml` mirrors `helloallytech.github.io/` to the public GitHub
Pages repository whenever it changes on `master`, so a merged PR is live on the site within
minutes. **Never edit the Pages repository directly** — the next publish overwrites it.

`master` has no branch protection and the repository is public: nothing reviews a wiki
change but the PR's own reviewer, so check it for secrets, hostnames, IPs and region details
yourself.

*Before the monorepo*, wiki edits went through `scripts/wiki-pr.sh`, which opened a draft PR
in the separate wiki repo, and `wiki-pr-lifecycle.yml` merged it when its source PR merged.
That schedule is off; the script and workflow remain only to settle PRs opened before the
move.

---

## 5. The weekly health sweep

§2–§4 only fire when someone touches watched code. Pages that describe the platform in
general have no such trigger and drift silently.

`wiki-health.yml` runs every Monday (and on wiki PRs). It runs `scripts/wiki_lint.py` —
missing frontmatter, pages whose `last_reconciled` is older than the threshold, orphans,
broken links, counts hard-coded in prose, stale generated files — and the docs-path lint,
regenerates `platform/stats.md`, keeps **one rolling issue** listing the findings, and opens
a PR when generated files fall behind. It opens PRs and issues; it never commits to `master`.

**Nothing verifies a page's claims automatically.** `last_reconciled` is a promise made by
whoever last checked the page against the code: bump it only after doing that, and only on
the pages you checked. The sweep's job is to make an unchecked page visible, not to check it.

---

## 6. Facts that go stale by construction

Counts belong in generated output, not prose. `wiki/platform/stats.md` is regenerated by the
sweep; prose should state invariants that survive a refactor:

> ✅ "Every ally-be entity carries a `tenantId`; queries must respect tenant isolation."
> ❌ "ally-be has 43 modules and 211+ migrations."

If you catch yourself typing a number that a script could count, put it in `platform/stats.md`
and link to it.

File paths rot the same way — the `docs-paths` job catches them. Directory coverage and
feature gates rot too — the `concepts` job catches those for the Core Concepts page.

---

## 7. Adding to the system

**A new doc that must not go stale** → add a rule to the root `.docs-map.yml`, with a `why`.

**A new wiki page** → add frontmatter (`title`, `tags`, `summary`, `last_reconciled`),
register it in [`index.md`](../index.md), log it in [`log.md`](../log.md), run
`gen-routing.py`. Do not hand-edit `ROUTING.md`, `manifest.json` or `stats.md`.

**A new module, page, feature directory or feature toggle** → give it a card (or a line) in
[Core Concepts](../platform/concepts.md); CI will tell you if you forget.

**A new convention** → put it in exactly one place and link to it from the others. If you
find the same rule written twice, that is a bug: the copies will disagree, and an agent
reading both will pay tokens to arrive at ambiguity.

---

*See also: [Contributing Guide](guide.md) · [Cross-Repo Agent Guide](../platform/agent-guide.md) · [Core Concepts](../platform/concepts.md) · [Getting Started](../getting-started.md)*
