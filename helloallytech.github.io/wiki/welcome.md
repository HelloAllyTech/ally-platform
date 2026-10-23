---
title: Welcome
tags: [homepage, general]
summary: Welcome to the Ally Developer Wiki — the canonical knowledge base for the Ally platform.
last_reconciled: 2026-07-28
---

# Welcome to the Ally Developer Wiki

> [!IMPORTANT]
> This wiki is **public** (served at tech.helloally.ai). It must never contain secrets, credentials, IP addresses, internal hostnames, or cloud region details. Updates are made by developers and AI agents with commit/PR rights to this repo.

This is the canonical, sanitized documentation for **Ally** — a HIPAA-compliant platform for training mental health counselors through AI simulations, real-time session analysis, and peer review. It compiles architecture, SDLC rules, deployment, and environment knowledge across all Ally repositories.

---

## 🧭 Where to go

- **New here?** Start with the [Platform Overview](platform/overview.md).
- **Understand the system:** [Architecture & Data Flow](platform/architecture.md) and [Tech Stack](platform/tech-stack.md).
- **Build anything user-facing:** search the **Stacks** corpus before you plan, and again whenever a product judgement comes up mid-build — [Working with the Stacks MCP](contributing/planning-with-stacks.md). (The former in-wiki [Product Management Best Practices](product/best-practices.md) section is **deprecated** as of 2026-08-07 and kept only for history.)
- **Work on a repo:** the [Repositories](index.md#repositories) section — [ally-be](repos/ally-be.md), [ally-ai](repos/ally-ai.md), [ally-ai-learn](repos/ally-ai-learn.md), [ally-web](repos/ally-web.md), [ally-mobile](repos/ally-mobile.md), [infra](repos/infra.md).
- **Contribute:** [Developer Setup](contributing/dev-setup.md) and the [Contributing Guide](contributing/guide.md).
- **AI agents:** the [Cross-Repo Agent Guide](platform/agent-guide.md).

---

## 📖 What is LLMWiki?

LLMWiki is a zero-compilation, static Markdown knowledge base. **AI agents** interact directly with the raw Markdown files; **humans** view them through this browser dashboard. The wiki is a compounding, persistent memory bank that gets richer with every source ingested.

---

## 🤖 AI Agent Setup Prompt

Paste this into your AI coding assistant (Claude Code, Gemini CLI, Cursor, etc.) to bootstrap it against this wiki:

```markdown
You are an AI assistant helping maintain the Ally Developer Wiki in this repository.
The wiki content root is at `/wiki/`. The `/llmwiki/` folder is the HTML rendering
engine — NEVER modify it (it lives at https://github.com/ajeygore/llmwiki).

This wiki is PUBLIC. Never write secrets, credentials, IP addresses, internal
hostnames/domains, or cloud region details into any page.

Read `agents.md` at the repo root, then follow its Ingestion, Query, and Lint flows:
1. Keep long-term learnings in `wiki/memory.md`.
2. Update `wiki/overview.md` when files/folders change.
3. Persist session progress in `wiki/context.md`.
4. Catalog every new page in `wiki/index.md` and log changes in `wiki/log.md`.
5. Keep pages cross-linked and consistent with the repos they describe.
6. Whenever a product judgement comes up — before writing an implementation plan, and
   again mid-implementation — search Stacks with the `search_chunks` tool and cite the
   chunk titles you apply. An agent searches for itself; you do not have to fetch
   context for it. (`wiki/product/` is deprecated — history only.)
```

---

## 📁 Catalog

Browse the full catalog in the sidebar or on the [index page](index.md) — search tags, browse directories, and review the page grid.
