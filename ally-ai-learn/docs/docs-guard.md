# When your change outdates a doc

CI enforces this. [`.docs-map.yml`](../.docs-map.yml) at the repo root declares which docs
cover which code, and the [Docs guard workflow](../../.github/workflows/docs.yml) runs a shared
checker — fetched at run time from `helloallytech/.github`, so there is exactly one copy of
it — on every pull request and on every push to `master`. Touching `app/tts/**` without
updating `docs/05-tts-providers.md` fails the build.

Spec: [how the docs system works](https://tech.helloally.ai/#/wiki/contributing/docs-system.md).

## The rules

They live in [`.docs-map.yml`](../.docs-map.yml), commented in place — read them there, not a
copy here that will drift. Adding one is how you make a doc impossible to forget, and the
rule's `why:` is what the failure message quotes back at you, so write it for whoever reads it
in a hurry.

`requires:` takes a path in this repo, `any_of: [...]`, `wiki:<page>` (satisfied by a trailer,
not by a file), `mirror` (the watched files must be byte-identical to each other), or `none`
(watched deliberately, nothing required).

Separately, [`scripts/docs-path-lint.mjs`](../scripts/docs-path-lint.mjs) fails the `docs-paths` job when a backticked file path in any doc no longer exists — fix the path, or mark a deliberate one `<!-- docs-path-lint: planned -->` (or `ignore`).

## AGENTS.md has a line budget

The checker holds a **120-line budget for `AGENTS.md`**, and unlike the rules above it is
evaluated on every run regardless of what the pull request touched. Going over it therefore
turns *every* subsequent PR red, not only the one that pushed it over — if the guard is
failing on a PR that changed no docs at all, check this first:

```bash
wc -l AGENTS.md
```

`CLAUDE.md` inherits the same ceiling through the `agent-entrypoints-in-sync` mirror rule:
whatever you trim from one must be trimmed from the other, byte for byte.

The budget exists because that file is loaded into every agent session before any work
starts. It is a router, not a manual — when it grows past the line, move the detail into the
doc it should point at and leave a row in the routing table. This page is the result of doing
exactly that.

A repo can override the number with a `budgets:` block in `.docs-map.yml`. Raising it is
almost always the wrong fix; the ceiling is the point.

## Escape hatches

On a pull request:

- **The `docs:skip` label** waives every finding, including the size budget. The guard still
  prints what it found, then passes. Frequent use means a rule is wrong — fix the rule in
  `.docs-map.yml` rather than normalising the bypass.
- **`Wiki-PR: <url>`** in the PR body satisfies a `wiki:` requirement. To say a page genuinely
  does not need to change, write `Wiki-PR: none — <reason>`; the reason is mandatory and a
  bare `none` fails on its own. This waives wiki requirements only — in-repo doc rules and the
  size budget still apply.

Pushing straight to `master`? Most commits here never open a PR, so the guard also runs on
push: it cannot block what has already landed, so it reports instead — a red mark on the
commit and a notification to whoever pushed. Trailers come from the commit message rather
than a PR body (`Wiki-PR: <url>`, `Wiki-PR: none — <reason>`, or `Docs-Skip: <reason>`), and a
push that arrived via a merged PR is skipped so nothing is reported twice.

The pre-push hook runs the same checker before the push, which is the last point at which it
can still change what you do. Install it once per machine:

```bash
curl -fsSL https://raw.githubusercontent.com/HelloAllyTech/.github/main/hooks/install.sh | bash
```

## Editing the wiki alongside a change

Wiki edits need no hand-rolled second PR. `.wiki-tmp/` is gitignored, and the wiki PR merges
when this change lands:

```bash
git clone --depth=1 https://github.com/helloallytech/helloallytech.github.io .wiki-tmp
# edit .wiki-tmp/wiki/**
.wiki-tmp/scripts/wiki-pr.sh "<url of this PR>"     # or: .wiki-tmp/scripts/wiki-pr.sh HEAD
```

Paste the printed `Wiki-PR:` line into the PR description.
