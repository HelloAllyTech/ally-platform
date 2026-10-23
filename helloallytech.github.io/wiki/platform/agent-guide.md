---
title: Cross-Repo Agent Guide
tags: [platform, agents, conventions, reference]
summary: Quick-reference for AI assistants and developers working across Ally repos — per-repo entry points, cross-repo conventions, common tasks, and gotchas.
last_reconciled: 2026-07-28
---

# Cross-Repo Agent Guide

This page helps AI agents (and developers) quickly orient in the Ally workspace and work effectively across repos. It is migrated from the workspace `AGENTS.md`. For per-repo depth, follow the links to each [repo page](../index.md#repositories).

> [!IMPORTANT]
> **This page tells you how to build. [Stacks](../contributing/planning-with-stacks.md) tells you what to build and how it should behave.**
> **Whenever a decision about how the product should behave comes up, search Stacks with the `search_chunks` tool, incorporate relevant returned guidance, and cite chunk titles.** Before writing an implementation plan above all — but equally mid-implementation, at each point you would otherwise invent the answer: an empty, loading, edge or failure state; a user-facing label, button or error message; what a view shows and what it omits; a threshold, limit, cadence or reward rule. **Search on your own initiative** — specific noun phrases, several per task, then `get_chunks` on what bears on the decision and `list_tags` to see how the library is organised. Never claim Stacks does or doesn't cover something: tags aren't contents, and an empty search isn't a gap. `/stacks:planning_context` remains as the human entry point. The `stacks` server is declared in every repo's committed `.mcp.json` and reads your `STACKS_API_KEY` from the environment — see [Working with the Stacks MCP](../contributing/planning-with-stacks.md) for setup, retrieval technique, and how to cite. Trivial mechanical changes are exempt.

> [!NOTE]
> The in-wiki **Product Management Best Practices** section ([hub](../product/best-practices.md), [UI](../product/ui.md), [Gamification](../product/gamification.md), [Data Visualisation](../product/data-visualisation.md), [Prioritisation](../product/prioritisation.md), [User Personas](../product/user-personas.md), [AI-Product Patterns](../product/ai-product-patterns.md)) was **deprecated on 2026-08-07** and replaced by Stacks. Nothing in it is a gate any more. It is kept readable because platform pages cite its principles by number, and because it records what this team decided up to August 2026 — useful context, not a checklist.

## Repo Quick Reference

### [ally-be](../repos/ally-be.md) — Core Backend
- **Stack**: NestJS 11 / TypeScript 5.9 / Node 24 / PostgreSQL 14 / Redis 7 / TypeORM
- **Entry**: `ally-be/src/main.ts` → `ally-be/src/app.module.ts` (current counts: [Platform Stats](stats.md))
- **Key modules**: auth, learn, livekit, ai, chat, audio-ingest, conversational-guardrails, badge, community, prompt, tenant, user, authorization, scenario-report
- **DB migrations**: `src/database/migrations/` (TypeORM, `synchronize: false`, never edit a merged one); seeds in `src/database/seeds/` are idempotent
- **WebSocket gateways**: `microphone-chat.gateway.ts`, `cloud-telephony.gateway.ts`, `scenario-report.gateway.ts`
- **API docs**: Swagger at `/api-docs`
- **Key patterns**: RTK Query-style API services, EventEmitter for async, Redis pub/sub, RBAC guards, tenant isolation decorators

### [ally-ai](../repos/ally-ai.md) — AI Service
- **Stack**: FastAPI / Python 3.12 / Poetry / Weaviate / LangChain / OpenAI
- **Entry**: `ally-ai/app/main.py`
- **Key services**: `app/core/conversations/`, `summaries/`, `text_generations/`, `reference_documents/`, `transcriptions/`, `queue/`
- **Prompts**: `app/prompts/` (file-based, dynamically loaded)
- **Vector DB**: Weaviate collections in `ally-ai/app/core/vector_db/constants.py`; schema migrations in `app/migrations/`
- **Background worker**: SQS transcription worker in `ally-ai/app/core/queue/transcription_request_sqs_worker.py`
- **Key patterns**: Abstract base classes for services, FastAPI dependency injection, Pydantic settings, HIPAA audit logging

### [ally-ai-learn](../repos/ally-ai-learn.md) — Training Agent
- **Stack**: FastAPI + LiveKit Agents / Python 3.12 / Poetry / LangGraph / multi-provider TTS/STT/LLM
- **Entry**: `ally-ai-learn/app/main.py` (FastAPI), `ally-ai-learn/app/worker.py` (LiveKit agent)
- **Graph pipeline**: `app/core/graph/` (LangGraph: process_events → resolve_branching → generate_response/detect_behaviors → apply_voice → send_feedback)
- **Event system**: `app/core/events/` — one package per event type (SENTENCE_SIMILARITY, SEMANTIC_SIMILARITY, BINARY_CLASSIFIER, TIME, SCORE, COMBINATION, HELPER_*); the authoritative list is `ally-ai-learn/docs/04-event-types-reference.md`, current count in [Platform Stats](stats.md)
- **Provider factories**: `ally-ai-learn/app/tts/factory.py`, `ally-ai-learn/app/stt/factory.py`, `ally-ai-learn/app/llms/factory.py`
- **Prompts**: `app/prompts/` (system, branching, prosody, events); extensive numbered `docs/`, indexed by intent in `ally-ai-learn/docs/readme.md`
- **Key patterns**: Factory pattern for providers, LiveKit agent lifecycle (configure/initialize/start), event orchestration with eligibility constraints

### [ally-web](../repos/ally-web.md) — Web Frontend Monorepo
- **Stack**: Nx 22 / React 18 / TypeScript / Vite (dashboards) / Next.js (landing)
- **Apps**: `apps/ally-web/` (landing :3000), `apps/ally-helpline-dashboard/` (:8080), `apps/ally-admin-dashboard/` (:8081)
- **Shared lib**: `libs/ui-shared/`
- **State**: Redux Toolkit + RTK Query + Redux Persist; real-time via Socket.IO + LiveKit components
- **Key patterns**: RTK Query for API calls, path aliases (`@api`, `@components`), permission-based routing, i18next

### [ally-mobile](../repos/ally-mobile.md) — Mobile App
- **Stack**: React Native 0.79 / TypeScript 5 / React 19 / Redux Toolkit + RTK Query
- **Entry**: `index.js` → `ally-mobile/src/App.tsx`; navigation via React Navigation 7 (native-stack + bottom-tabs + drawer)
- **Services**: RTK Query slices in `src/services/`; custom hooks in `src/hooks/`
- **Real-time**: Socket.IO + LiveKit React Native; `react-native-live-audio-stream` for recording
- **Key patterns**: Dual listening modes (microphone + conference), AsyncStorage for tokens, Firebase Crashlytics

### [infra](../repos/infra.md) — Infrastructure *(Standalone Repo — Outside `ally-platform`)*
- **Repository**: `HelloAllyTech/infra` (intentionally kept **outside** the `ally-platform` monorepo as a standalone private repository to isolate deployment inventories and Ansible Vault secrets; `/infra/` is `.gitignore`d at the `ally-platform` root)
- **Stack**: Ansible 13 + Terraform + Docker Compose
- **Playbooks**: `ansible/` — `baremetal.yml`, `ally_core.yml`, `ally_ai.yml`, `ally_learn.yml`, `ally_web.yml`, `ci.yml`
- **Scripts**: `infra/bootstrap.sh` (clone repos), `infra/dev_env.sh` (start dev), `infra/colima.sh`
- **Secrets**: Ansible Vault; **Key patterns**: Incus containers on Hetzner, Consul discovery, Caddy proxy, Wireguard VPN

## Cross-Repo Conventions

### Branch Naming
`<type>/<short-description>` — e.g. `feat/add-user-profile`, `fix/login-error`. Canonical rules and the full type list live in the [Contributing Guide](../contributing/guide.md#branch-naming); don't restate them elsewhere.

### API Versioning
- All REST APIs use the `/api/v1/` prefix.
- WebSocket namespaces: `/microphone-chat`, `/cloud-telephony-chat`, `/scenario-report`.

### Environment Files
- Python repos: `env_sample` → copy to `.env`.
- TypeScript repos: `.env.example` or `docker.env.example`.
- Never commit `.env` files.

## Common Tasks

> Every task below that reaches an implementation plan starts with the [Stacks search](../contributing/planning-with-stacks.md). Cross-repo work is the dominant hidden cost in estimates — worth a query of its own.

**Adding a new API endpoint** — ally-be: controller + service + DTOs in the relevant `src/` module; ally-web/mobile: add an RTK Query endpoint in `src/services/`.

**Adding a new AI capability** — ally-ai: prompt templates in `app/prompts/`, service logic in `app/core/`, endpoint in `app/api/v1/endpoints/`; ally-be: integration call in `src/ai/`.

**Adding a new event type (ally-ai-learn)** — create the event class in `app/core/events/event_types/`, register in `ally-ai-learn/app/core/events/factory.py`, add prompts in `app/prompts/events/` (see `ally-ai-learn/docs/04-event-types-reference.md`).

**Adding a TTS/STT/LLM provider (ally-ai-learn)** — create the provider class in `app/tts|stt|llms/`, extend the corresponding `factory.py` (see `docs/05-07`).

**Database changes (ally-be)** — `npm run migration:generate --name=DescriptiveName` then `npm run migration:run`.

**Weaviate schema changes (ally-ai)** — add a migration in `app/migrations/` following the `NNN-description.py` pattern.

## Gotchas & Important Notes

- **Lima/Colima VM**: local dev commonly runs Docker inside a Lima/Colima VM on macOS; commands execute within the VM context.
- **HIPAA**: never log PII/PHI outside designated audit loggers. Use `phi_logger` in ally-ai.
- **Multi-tenant**: all ally-be queries must respect tenant isolation; entities have `tenantId` columns.
- **Prompt sync**: prompts in ally-ai can be overridden at runtime via ally-be's prompt management; `ally-ai/scripts/sync_prompts.py` pushes defaults.
- **LiveKit rooms**: ally-ai-learn agents join rooms created by ally-be; room metadata carries scenario configuration.
- **SQS in dev**: use LocalStack (auto-started by docker-compose). Queue URLs differ between local and production.
- **Node versions**: ally-be requires Node 24; ally-web requires Node 22. **Python**: both AI repos require 3.12+.

---

*See also: [Platform Overview](overview.md), [Architecture](architecture.md), [Contributing Guide](../contributing/guide.md), [Planning with the Stacks MCP](../contributing/planning-with-stacks.md).*
