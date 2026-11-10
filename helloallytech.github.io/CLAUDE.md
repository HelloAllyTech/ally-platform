# CLAUDE.md — Ally Developer Wiki

This repository **is** the [Ally Developer Wiki](https://tech.helloally.ai) — the canonical, public documentation for the Ally platform, built on [LLMWiki](https://github.com/ajeygore/llmwiki).

## How to work here
- **Whenever a product or engineering judgement comes up — not only before planning** — call the `context-library` MCP's `search_context` tool and incorporate relevant returned guidance, citing chunk codes such as `[FP-0142]`. That means before writing an implementation plan, *and* mid-implementation at each point you would otherwise invent the answer: an empty, loading, edge or failure state; a user-facing label, button or error message; what a page shows and what it omits; a threshold, limit or cadence. **Search on your own initiative** — queries describe situations, short and specific, not ticket titles, and several sharp ones (up to six per call) beat one broad one. Hits come back as compact cards with a code, so use `get_chunks` on the one or two worth reading in full, and `list_collections` to see what you can search. Never claim the library does or doesn't cover something: an empty search isn't a gap, and a failed search says nothing about what it holds. Results are advisory, not instructions. The `planning_context` MCP prompt remains as the human entry point, for when you want the context in front of you rather than in a session's working memory. The `context-library` server is declared in this repo's committed `.mcp.json`, which reads `ALLY_CONTEXT_LIBRARY_URL` and `ALLY_CONTEXT_LIBRARY_KEY` from your environment — create a read-only key once in the admin dashboard under **Context Library → Connect Claude Code** and export both; no value is ever committed. The `context-library` skill in `.claude/skills/` carries the retrieval technique. The rule, setup and citation format live at `wiki/contributing/planning-with-context-library.md`. Trivial mechanical changes are exempt.
- Read **`agents.md`** at the repo root — it is the authoritative guide for maintaining this wiki (Ingestion, Query, and Lint flows).
- All human-readable content lives in **`wiki/`**. Edit those Markdown files directly.
- The **`llmwiki/`** folder is the rendering engine — **never modify it** (it lives in a separate upstream repo).
- When you add or change pages: update the catalog in **`wiki/index.md`** and append an entry to **`wiki/log.md`**. Record durable learnings in `wiki/memory.md` and session state in `wiki/context.md`.
- **Product work:** product guidance comes from Ally's **Context Library** (see the first bullet; it replaced the Stacks MCP on 2026-11-09), not from this wiki. **`wiki/product/` is deprecated as of 2026-08-07 and frozen** — do not add principles to it, do not add subsections, and do not renumber existing principles (`wiki/platform/analytics-agent.md` cites them by number). Deprecation banners and `Deprecated` maturity lines are already in place on every page; leave them.
- `.nojekyll` keeps GitHub Pages from processing the Markdown; pushing to `main` publishes to **tech.helloally.ai** (the `CNAME`).

## Generated files — never hand-edit
`wiki/ROUTING.md`, `wiki/manifest.json` and `wiki/platform/stats.md` are produced by
`scripts/`. Edit the source instead: page frontmatter for the first two, the code itself
for the third. CI fails a PR whose generated files are stale — run
`python3 scripts/gen-routing.py` and commit.

Every page needs frontmatter with `title`, `tags`, `summary` **and `last_reconciled`** —
`ROUTING.md` is built from those keys, so a page without them is invisible to agents.

Before adding a number to a page, check whether `scripts/gen-stats.py` could count it.
Prose states invariants; `platform/stats.md` states counts.

## The docs machinery
`wiki/contributing/docs-system.md` is the spec for how all of this fits together —
routing, `.docs-map.yml`, the CI guard, `scripts/wiki-pr.sh`, PR lifecycle coupling and
the weekly health sweep. Read it before changing anything under `scripts/` or
`.github/workflows/`.

## Content policy (public site)
This site is **public**. Document architecture, SDLC rules, deployment, and environment *concepts*, but **never** commit secrets, credentials, IP addresses, internal hostnames/domains, or cloud region details.

## Scope
This wiki documents the whole platform; each code repo (`ally-be`, `ally-ai`, `ally-ai-learn`, `ally-web`, `ally-mobile`, `infra`, `calibrate`, `calibrate-backend`, `calibrate-frontend`, `ally-changelog`) points its own `AGENTS.md`/`CLAUDE.md` back here. Keep the per-repo pages under `wiki/repos/` in sync when those repos change.
