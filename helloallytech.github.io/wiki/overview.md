---
title: Overview
tags: [meta, structure]
summary: Repository overview and active directories layout description.
last_reconciled: 2026-07-28
---

# Workspace Overview

This repository (`helloallytech.github.io`, served at **tech.helloally.ai**) is the **Ally Developer Wiki** — an [LLMWiki](https://github.com/ajeygore/llmwiki) knowledge base that is the canonical, sanitized documentation for the Ally platform. It replaced the previous Jekyll developer-hub site; `.nojekyll` disables Jekyll so the client-side viewer can serve the raw Markdown.

## Root Structure
- `index.html` — The client-side dashboard viewer.
- `llmwiki/` — The rendering engine (do **not** edit; lives in a separate upstream repo).
- `agents.md` — LLMWiki engine instructions for maintaining this wiki.
- `raw/` — Immutable source documents to be processed (currently empty).
- `wiki/` — The structured, LLM-maintained knowledge vault (below).
- `.nojekyll` — Disables GitHub Pages Jekyll processing.
- `CNAME` — Custom domain (`tech.helloally.ai`).

## `wiki/` Layout
- `index.md` — Catalog / sidebar navigation source.
- `welcome.md`, `getting-started.md` — Entry pages.
- `platform/` — Cross-cutting docs: `overview.md`, `architecture.md`, `tech-stack.md`, `agent-guide.md`.
- `product/` — **Deprecated 2026-08-07**, superseded by the Stacks MCP. Was *Product Management Best Practices*: `best-practices.md` (hub + house rules), one page per subsection (`ui.md`, `gamification.md`, `data-visualisation.md`, `prioritisation.md`, `user-personas.md`, `ai-product-patterns.md`) and a craft reference (`chart-dashboard-principles.md`). **Frozen** — no new pages, no new principles, and the existing principle numbering must not shift because platform pages cite it. Product guidance now comes from Stacks at planning time (`contributing/planning-with-stacks.md`).
- `repos/` — One page per repository: `ally-be`, `ally-ai`, `ally-ai-learn`, `ally-web`, `ally-mobile`, `infra`.
- `contributing/` — `dev-setup.md`, `guide.md` (SDLC rules).
- `overview.md`, `memory.md`, `context.md`, `log.md` — Meta/session state.
- `skills/` — Custom agent skills (currently just the example skill).

## Content Policy
This wiki is **public**. It documents architecture, SDLC rules, deployment, and environment setup, but **must never contain secrets, credentials, IP addresses, internal hostnames, or cloud region details**. See [Getting Started](getting-started.md) for the ingestion rules.
