---
title: Context
tags: [meta, context, state]
summary: Active session meta-context, handoffs, and current operational states.
---

# Meta Context

This file tracks active session state, progress, and agent handoffs between task iterations.

## Current State (2026-07-11)

**Bootstrap + full migration complete.** The wiki has been initialized and populated from the Ally workspace:

- LLMWiki engine vendored into `llmwiki/`; Jekyll scaffolding removed; `.nojekyll` added; `CNAME` (tech.helloally.ai) retained.
- Existing developer-hub content (former `index.md`, `get-started.md`, `tech-stack.md`, `CONTRIBUTING.md`) migrated into `platform/` and `contributing/` pages.
- Six per-repo documentation pages generated under `repos/` and cross-linked.
- Workspace `CLAUDE.md` and `AGENTS.md` knowledge folded into `platform/overview.md`, `platform/architecture.md`, and `platform/agent-guide.md`.
- Whole wiki sanitized: no secrets, IPs, internal hostnames, or cloud regions.
- Each code repo's `AGENTS.md`/`CLAUDE.md` updated to point at this wiki.

## Reprocess (2026-07-11, later)
- `infra` landed its cross-platform dev-script work (`_os.sh` + OS-aware `docker-setup.sh`/`dev_env.sh`/`colima*.sh`); `repos/infra.md` updated from "uncommitted" to committed.
- `ally-mobile` was brought up to date (+27 commits: Scribe voice-dictation notes, review read/unread management, simulation pause/resume, i18n parity, first-login complete-profile gate); `repos/ally-mobile.md` regenerated.
- Generated drift discarded in `ally-mobile` (lockfiles) and `ally-web` (`next-env.d.ts`).

## Product Management section added (2026-07-28)

New top-level `wiki/product/` section — **Product Management Best Practices**:

- `product/best-practices.md` is the **hub**: 11 house rules that apply to every product decision, the subsection table (with a `Draft` / `Adopted` / `Deprecated` maturity marker per page), the mechanics for adding a subsection, and a backlog of unwritten topics.
- Five seed subsections, all `Draft`: `ui.md`, `gamification.md`, `data-visualisation.md`, `prioritisation.md`, `user-personas.md`. Each follows the same shape — why it matters for Ally → principles → checklist → anti-patterns → Ally-specific notes → open questions.
- **Reachability wiring** (so future agent sessions land on it without being told): `index.md` catalog group, `welcome.md` (including the pasteable AI-agent setup prompt), `getting-started.md` (For Humans + For AI Agents), `platform/agent-guide.md` (callout, Common Tasks note, See also), `platform/overview.md`, `contributing/guide.md` (workflow step 0 + PR description), `overview.md` layout, `memory.md`, `repos/ally-web.md`, `repos/ally-mobile.md`, and the repo-root `CLAUDE.md`.
- Then added `product/chart-dashboard-principles.md` as the first **reference page** — a new hub concept for long craft lookups that sit under a parent subsection (here: Data Visualisation) rather than beside one.
- Content status: the practices are **conventions written from the platform's documented behaviour**, not research-validated. `user-personas.md` is explicitly labelled as working sketches. Every page carries an *Open questions* section — those are the highest-value things for the team to answer next.

## Open Follow-ups
- Move `product/` pages from `Draft` to `Adopted` (or edit them) once the team has reviewed them; answer the *Open questions* on each page.
- Write new `product/` subsections from the hub backlog as real decisions force them — don't write them speculatively.
- No custom project skills existed to migrate (only `settings.local.json` files); `skills/` holds just the example skill.
- `raw/` is empty — drop source documents there for future ingestion.
- Re-run a lint pass when repos change significantly (see `agents.md` Lint Flow).
