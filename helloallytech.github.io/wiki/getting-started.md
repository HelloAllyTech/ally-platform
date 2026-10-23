---
title: Getting Started
tags: [guide, help, setup]
summary: A guide outlining how humans and agents operate this knowledge base.
last_reconciled: 2026-07-28
---

# Getting Started

This guide explains how to use and operate the Ally Developer Wiki.

> **Content policy (public site):** This wiki is served publicly at tech.helloally.ai. Document architecture, SDLC rules, deployment, and environment *concepts* — but **never** commit secrets, credentials, IP addresses, internal hostnames/domains, or cloud region details.

## For Humans
- Browse online at **https://tech.helloally.ai**, or serve locally with `./llmwiki/run` from the repo root and open the printed `http://localhost:PORT`.
- Use the sidebar filter and the header search to find pages, tags, and content.
- Read the [Platform Overview](platform/overview.md) first, then dive into the [repo pages](index.md#repositories).
- Working on the product rather than the plumbing? Start at [Product Management Best Practices](product/best-practices.md).

## For AI Agents
- Treat `/wiki/` as the permanent knowledge source; the engine in `/llmwiki/` is **read-only**.
- Follow the Ingestion, Query, and Lint flows in `agents.md` at the repo root.
- When ingesting: write the summary page under the right `wiki/` subfolder (`platform/`, `product/`, `repos/`, `contributing/`, …), cross-link it, add it to `wiki/index.md`, and append an entry to `wiki/log.md`.
- **Before any user-facing change**, read [Product Management Best Practices](product/best-practices.md) and the subsection that matches the task ([UI](product/ui.md), [Gamification](product/gamification.md), [Data Visualisation](product/data-visualisation.md), [Prioritisation](product/prioritisation.md), [User Personas](product/user-personas.md)). State in your plan which practice you applied. Purely internal work (refactors, migrations, infra, tests) is exempt.
- When you make a product judgement call that isn't documented, **file it back** into the matching `wiki/product/` subsection — or add a new subsection following the *How to add or update a subsection* procedure on [the hub](product/best-practices.md). The section is designed to grow.
- Record durable learnings in `wiki/memory.md` and session state in `wiki/context.md`.
- Apply the content policy above to every edit.

## Deploying
This repo is a GitHub Pages site. `.nojekyll` disables Jekyll so the client-side viewer can fetch raw `.md` files. Pushing to the default branch publishes to **tech.helloally.ai** (the `CNAME`).
