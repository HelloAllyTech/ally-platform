# Ally - Agent Guide for AI Assistants

> **📚 Canonical docs: the [Ally Developer Wiki](https://tech.helloally.ai)** (repo `helloallytech.github.io`, `wiki/` folder).
> The live version of this guide is the [cross-repo agent guide](https://tech.helloally.ai/#/wiki/platform/agent-guide.md); per-repo docs live under [wiki/repos/](https://tech.helloally.ai/#/wiki/index.md). Keep the wiki updated and free of secrets, IPs, internal hostnames, and cloud region details.

This document helps AI agents (Claude Code, Copilot, etc.) quickly orient themselves in the Ally workspace and work effectively across repos.

## Repo Quick Reference

Every app directory has its own `AGENTS.md` / `CLAUDE.md` router — read it before working there. This table only orients you.

| Path | Stack | Entry | Read first |
|------|-------|-------|-----------|
| `ally-be/` | NestJS 11 / TypeScript 5.9 / Node 24 / PostgreSQL 14 / Redis 7 / TypeORM | `src/main.ts` → `src/app.module.ts` | `ally-be/AGENTS.md`, `ally-be/DATA_SCHEMA.md` |
| `ally-ai/` | FastAPI / Python 3.12 / Poetry / Weaviate / LangChain / OpenAI | `app/main.py` | `ally-ai/AGENTS.md`, `app/core/config.py` |
| `ally-ai-learn/` | FastAPI + LiveKit Agents / Python 3.12 / Poetry / LangGraph / multi-provider TTS/STT/LLM | `app/main.py` (API), `app/worker.py` (agent) | `ally-ai-learn/AGENTS.md`, `app/core/graph/graph_builder.py`, `docs/architecture.md` |
| `ally-web/` | Nx 22 / React 18 / TypeScript / Vite dashboards / Next.js 14 landing | admin (8081), helpline (8080), landing (3000) under `apps/` | `ally-web/AGENTS.md`, `apps/ally-helpline-dashboard/src/main.tsx` |
| `ally-mobile/` | React Native 0.79 / TypeScript 5 / React 19 / Redux Toolkit + RTK Query | `index.js` → `src/App.tsx` | `ally-mobile/AGENTS.md`, `src/navigation/RootNavigator.tsx` |
| `helloallytech.github.io/` | The Developer Wiki's source (`wiki/`); `publish-wiki.yml` mirrors it to GitHub Pages | — | `helloallytech.github.io/CLAUDE.md` |

**infra** is a standalone private repo (`HelloAllyTech/infra`), kept outside `ally-platform` to isolate deployment inventories and Ansible Vault secrets; `/infra/` is `.gitignore`d here. Ansible 13 + Terraform + Docker Compose: playbooks such as `infra/ansible/baremetal.yml`, dev scripts at its root (`infra/bootstrap.sh`, `infra/dev_env.sh`, `infra/colima.sh`). Vault needs `$HOME/ansible_vault_pass`. Incus containers on Hetzner baremetal, Consul, Caddy, Wireguard.

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
