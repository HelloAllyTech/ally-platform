# Ally - Agent Guide for AI Assistants

> **📚 Canonical docs: the [Ally Developer Wiki](https://tech.helloally.ai)** (repo `helloallytech.github.io`, `wiki/` folder).
> The live version of this guide is the [cross-repo agent guide](https://tech.helloally.ai/#/wiki/platform/agent-guide.md); per-repo docs live under [wiki/repos/](https://tech.helloally.ai/#/wiki/index.md). Keep the wiki updated and free of secrets, IPs, internal hostnames, and cloud region details.

This document helps AI agents (Claude Code, Copilot, etc.) quickly orient themselves in the Ally workspace and work effectively across repos.

## Repo Quick Reference

### ally-be (Core Backend)
- **Stack**: NestJS 11 / TypeScript 5.9 / Node 24 / PostgreSQL 14 / Redis 7 / TypeORM
- **Entry**: `src/main.ts` -> `src/app.module.ts` (43 modules)
- **Key modules**: auth, learn, livekit, ai, chat, audio-ingest, conversational-guardrails, badge, community, prompt, tenant, user, authorization, scenario-report
- **DB migrations**: `src/database/migrations/` (211+ files, TypeORM)
- **Seeds**: `src/database/seeds/`
- **WebSocket gateways**: `src/chat/gateway/microphone-chat.gateway.ts`, `src/audio-ingest/gateway/cloud-telephony.gateway.ts`, `src/scenario-report/gateway/scenario-report.gateway.ts`
- **API docs**: Swagger at `/api-docs` when running
- **Tests**: Jest (`npm test`), E2E (`npm run test:e2e`)
- **Key patterns**: RTK Query-style API services, EventEmitter for async, Redis pub/sub, RBAC guards, tenant isolation decorators

### ally-ai (AI Service)
- **Stack**: FastAPI / Python 3.12 / Poetry / Weaviate / LangChain / OpenAI
- **Entry**: `app/main.py`
- **Key services**: `app/core/conversations/`, `app/core/summaries/`, `app/core/text_generations/`, `app/core/reference_documents/`, `app/core/transcriptions/`, `app/core/queue/`
- **Prompts**: `app/prompts/` (file-based templates, dynamically loaded)
- **Vector DB**: Weaviate collections defined in `app/core/vector_db/constants.py`
- **Migrations**: `app/migrations/` (Weaviate schema migrations)
- **Background worker**: SQS transcription worker in `app/core/queue/transcription_request_sqs_worker.py`
- **Tests**: pytest (`make test`)
- **Key patterns**: Abstract base classes for services, dependency injection via FastAPI, Pydantic settings, HIPAA audit logging

### ally-ai-learn (Training Agent)
- **Stack**: FastAPI + LiveKit Agents / Python 3.12 / Poetry / LangGraph / Multi-provider TTS/STT/LLM
- **Entry**: `app/main.py` (FastAPI), `app/worker.py` (LiveKit agent)
- **Graph pipeline**: `app/core/graph/` (LangGraph with 6 nodes: process_events -> resolve_branching -> generate_response/detect_behaviors -> apply_voice -> send_feedback)
- **Event system**: `app/core/events/` (9 event types: SENTENCE_SIMILARITY, SEMANTIC_SIMILARITY, BINARY_CLASSIFIER, TIME, SCORE, COMBINATION, HELPER_UTTERANCE_LENGTH, HELPER_INTERRUPTED, HELPER_PARAPHRASED)
- **Provider factories**: `app/tts/factory.py`, `app/stt/factory.py`, `app/llms/factory.py`
- **Scenario models**: `app/core/scenario/base.py`
- **Prompts**: `app/prompts/` with categories: system, branching, prosody, events
- **Docs**: Extensive in `docs/` (01-13 numbered guides)
- **Tests**: pytest (`make test`)
- **Key patterns**: Factory pattern for providers, LiveKit agent lifecycle (configure/initialize/start), event orchestration with eligibility constraints

### ally-web (Web Frontend Monorepo)
- **Stack**: Nx 22 / React 18 / TypeScript / Vite (dashboards) / Next.js 14 (landing)
- **Apps**:
  - `apps/ally-web/` - Next.js landing page (port 3000)
  - `apps/ally-helpline-dashboard/` - Vite + React + MUI + Tailwind (port 8080)
  - `apps/ally-admin-dashboard/` - Vite + React + Tailwind (port 8081)
- **Shared lib**: `libs/ui-shared/` (25+ shared components)
- **State**: Redux Toolkit + RTK Query + Redux Persist
- **Real-time**: Socket.IO client + LiveKit components-react
- **Tests**: Vitest (`npx nx test <app>`)
- **Key patterns**: RTK Query for API calls, path aliases (`@api`, `@components`), permission-based routing, i18next for i18n

### ally-mobile (Mobile App)
- **Stack**: React Native 0.79 / TypeScript 5 / React 19 / Redux Toolkit + RTK Query
- **Entry**: `index.js` -> `src/App.tsx`
- **Navigation**: React Navigation 7 (native-stack + bottom-tabs + drawer)
- **Services**: RTK Query in `src/services/` (30+ API files)
- **Hooks**: 45+ custom hooks in `src/hooks/`
- **State**: Redux slices in `src/store/`
- **Real-time**: Socket.IO + LiveKit React Native
- **Audio**: `react-native-live-audio-stream` for recording, LiveKit for voice sessions
- **Tests**: Jest + React Native Testing Library
- **Key patterns**: Dual listening modes (microphone + conference), AsyncStorage for tokens, Firebase Crashlytics

### infra (Infrastructure)
- **Stack**: Ansible 13 + Terraform + Docker Compose
- **Ansible roles**: `ansible/roles/` (30+ roles)
- **Playbooks**: `ansible/` - `baremetal.yml`, `ally_core.yml`, `ally_ai.yml`, `ally_learn.yml`, `ally_web.yml`, `ci.yml`
- **Templates**: Docker Compose Jinja2 templates in `ansible/templates/`
- **Inventories**: `ansible/inventories/development/`, `ansible/inventories/global/`
- **Scripts**: `scripts/bootstrap.sh` (clone repos), `scripts/dev_env.sh` (start dev), `scripts/colima.sh`
- **Secrets**: Ansible Vault (requires `$HOME/ansible_vault_pass`)
- **Key patterns**: Incus containers on Hetzner baremetal, Consul for service discovery, Caddy for reverse proxy, Wireguard VPN

### helloallytech.github.io (Developer Hub)
- **Stack**: Jekyll / GitHub Pages
- **Content**: `index.md`, `CONTRIBUTING.md`, `get-started.md`, `tech-stack.md`
- **Minimal**: Static docs site, rarely needs changes

## Cross-Repo Conventions

### Branch Naming
```
feature/<ticket-id>-short-description
fix/<ticket-id>-short-description
chore/<ticket-id>-short-description
```

### Commit Messages
Follow conventional commits style. Check each repo's CONTRIBUTING.md for specifics.

### API Versioning
- All REST APIs use `/api/v1/` prefix
- WebSocket namespaces: `/microphone-chat`, `/cloud-telephony-chat`, `/scenario-report`

### Environment Files
- Python repos: `env_sample` (copy to `.env`)
- TypeScript repos: `.env.example` or `docker.env.example`
- Never commit `.env` files

## Common Tasks for Agents

### Adding a new API endpoint
1. **ally-be**: Create controller + service + DTOs in the relevant module under `src/`
2. **ally-web/mobile**: Add RTK Query endpoint in `src/services/` (web) or `src/services/` (mobile)

### Adding a new AI capability
1. **ally-ai**: Add prompt templates in `app/prompts/`, service logic in `app/core/`, endpoint in `app/api/v1/endpoints/`
2. **ally-be**: Add integration call in `src/ai/` module

### Adding a new event type (ally-ai-learn)
1. Create event class in `app/core/events/event_types/`
2. Register in `app/core/events/factory.py`
3. Add prompt templates in `app/prompts/events/`
4. See `docs/04-event-types-reference.md` for examples

### Adding a new TTS/STT/LLM provider (ally-ai-learn)
1. Create provider class in `app/tts/`, `app/stt/`, or `app/llms/`
2. Extend factory in the corresponding `factory.py`
3. See `docs/05-tts-providers.md`, `docs/06-stt-providers.md`, `docs/07-llm-providers.md`

### Database changes (ally-be)
```bash
npm run migration:generate --name=DescriptiveName
npm run migration:run
```

### Weaviate schema changes (ally-ai)
Add migration file in `app/migrations/` following the `NNN-description.py` pattern.

## Files to Read First (per repo)

| Repo | Start Here |
|------|-----------|
| ally-be | `src/app.module.ts`, `src/main.ts`, `README.md` |
| ally-ai | `app/main.py`, `app/core/config.py`, `README.md` |
| ally-ai-learn | `app/worker.py`, `app/core/graph/graph_builder.py`, `docs/architecture.md` |
| ally-web | `nx.json`, `apps/ally-helpline-dashboard/src/main.tsx`, `README.md` |
| ally-mobile | `src/App.tsx`, `src/navigation/RootNavigator.tsx`, `README.md` |
| infra | `README.md`, `scripts/dev_env.sh`, `ansible/baremetal.yml` |

## Gotchas & Important Notes

- **Lima VM**: All repos run inside a Lima VM for local development. Commands (npm, poetry, docker, etc.) execute within the VM context.
- **HIPAA**: This platform handles mental health data. Never log PII/PHI outside of designated audit loggers. Use `phi_logger` in ally-ai.
- **Multi-tenant**: All ally-be queries must respect tenant isolation. Entities have `tenantId` columns.
- **Prompt sync**: Prompts in ally-ai can be overridden at runtime via ally-be's prompt management. Use `scripts/sync_prompts.py` to push defaults.
- **LiveKit rooms**: ally-ai-learn agents join LiveKit rooms created by ally-be. Room metadata carries scenario configuration.
- **SQS in dev**: Use LocalStack (auto-started by docker-compose). Queue URLs differ between local and production.
- **Weaviate**: Runs alongside ally-ai. Schema changes need migrations. Dev instance via docker-compose.
- **Node version**: ally-be requires Node 24, ally-web requires Node 20.
- **Python version**: Both Python repos require 3.12+.
