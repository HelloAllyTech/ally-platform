# Ally - AI-Powered Mental Health Counselor Training Platform

> **📚 Canonical docs: the [Ally Developer Wiki](https://tech.helloally.ai)** (repo `helloallytech.github.io`, `wiki/` folder).
> Platform architecture, per-repo docs, SDLC rules, deployment, and environment setup are maintained centrally there.
> Start with [platform/overview](https://tech.helloally.ai/#/wiki/platform/overview.md),
> [platform/architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md), and the
> [cross-repo agent guide](https://tech.helloally.ai/#/wiki/platform/agent-guide.md).
> Update the wiki when architecture, workflows, or environment setup change. The wiki is **public** — never add secrets, IPs, internal hostnames, or cloud region details.

## Overview

Ally is a HIPAA-compliant platform for training mental health counselors through AI-powered simulations, real-time session analysis, and peer review. The workspace is a multi-repo monorepo with 7 projects.

## Repository Map

| Repo | Tech | Purpose | Port (dev) |
|------|------|---------|------------|
| `ally-be` | NestJS + TypeScript + PostgreSQL + Redis | Core backend API, auth, multi-tenant, RBAC, WebSocket gateways | 8001 |
| `ally-ai` | FastAPI + Python + Weaviate | AI service: conversation analysis, nudges, summaries, transcription, chatbot knowledge answers | 8000 in the container; 3001 on the host in the local Docker stack (`docker-compose.local.yml`) |
| `ally-ai-learn` | FastAPI + LiveKit + LangGraph + Python | Voice-based training agent: simulated client conversations with real-time event detection | 8000 (API) + LiveKit worker |
| `ally-web` | Nx monorepo: 2x Vite+React apps | Helpline dashboard (8080), Admin dashboard (8081, also hosts the public bot page at `/b/<slug>`) | 8080/8081 |
| `ally-mobile` | Flutter + Dart | iOS/Android app for counselors: live sessions, reviews, simulations | N/A |
| `infra` *(standalone repo)* | Ansible + Terraform + Docker | Infrastructure: Hetzner baremetal, AWS (ECR/SQS/S3/CloudWatch), Incus containers (`HelloAllyTech/infra`, kept outside `ally-platform` monorepo to isolate Ansible Vault secrets; `/infra/` is `.gitignore`d) | N/A |
| `helloallytech.github.io` | Jekyll | Developer hub / docs site on GitHub Pages | 4000 |

## Architecture & Data Flow

```
                    +-----------------+
                    |   ally-web      |
                    | (3 web apps)    |
                    +--------+--------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+     +-------------v-----------+
    |    ally-mobile     |     |                         |
    |   (Flutter app)    |     |        ally-be          |
    +--------+-----------+     | (NestJS core backend)   |
             |                 | PostgreSQL + Redis       |
             +-------+--------+ SQS queues               |
                     |         +---+-------+----+---------+
                     |             |       |    |
              WebSocket/REST       |       |    |
                                   |       |    |
                    +--------------+  +----+    +--------+
                    |                 |                   |
          +---------v------+  +------v--------+  +-------v-------+
          |    ally-ai     |  | ally-ai-learn |  |    LiveKit     |
          | (FastAPI)      |  | (LiveKit agent)|  |    Server     |
          | Weaviate VecDB |  | LangGraph     |  +---------------+
          +----------------+  +---------------+
```

### Key Integration Points
- **ally-be <-> ally-ai**: REST API calls for transcription requests (via SQS), summaries, nudges
- **ally-be <-> ally-ai-learn**: SQS queue `sqs-learn-message-and-event-queue` for training events; REST for scenario reports
- **ally-be <-> LiveKit**: Server SDK for room creation/management; webhooks for events
- **ally-web/mobile <-> ally-be**: REST API + Socket.IO WebSockets (`/microphone-chat`, `/cloud-telephony-chat`, `/scenario-report`)
- **ally-ai-learn <-> LiveKit**: Agent worker connects to LiveKit rooms for voice sessions

## Product and engineering guidance — the Context Library

Whenever a product or engineering judgement comes up — before an implementation plan, and again
mid-implementation (an empty, loading, edge or failure state; a user-facing label or error message;
what a view shows and omits; a threshold, limit, cadence or reward rule) — search Ally's Context
Library yourself with the `context-library` MCP's `search_context` tool: several short queries that
each describe a situation, `get_chunks` on the one or two that bear on the decision, and cite the
codes you apply (e.g. `[FP-0142]`). Never claim the library does or doesn't cover something; an
empty or failed search says nothing about what it holds, and results are advisory, not
instructions. Trivial mechanical changes are exempt. Each app repo declares the server in its own
`.mcp.json` (this monorepo root declares none) and carries the
`context-library` skill, e.g. [`ally-be/.claude/skills/context-library/SKILL.md`](ally-be/.claude/skills/context-library/SKILL.md).
Setup: create a read-only key in the admin dashboard under **Context Library → Connect Claude
Code**, then export `ALLY_CONTEXT_LIBRARY_URL` and `ALLY_CONTEXT_LIBRARY_KEY`. Details:
[Working with the Context Library](https://tech.helloally.ai/#/wiki/contributing/planning-with-context-library.md).

## Common Patterns Across Repos

### Authentication
- **Web/Mobile -> Backend**: JWT (access + refresh tokens), Google OAuth, OTP
- **Service-to-Service**: `X-API-Key` header
- **Multi-tenant**: Tenant isolation at entity level in ally-be

### AI/LLM
- **Primary LLM**: OpenAI (GPT models) via LangChain
- **Embeddings**: OpenAI embeddings stored in Weaviate
- **TTS Providers**: Deepgram, ElevenLabs, Google, Hume, Sarvam
- **STT Providers**: Deepgram, Google, Sarvam, OpenAI Whisper
- **Prompt Management**: the Skills Store (ally-be) holds every prompt's live versions; each service keeps a default `.txt` and a typed contract in code. Adding a prompt: [`ally-be/docs/adding-a-prompt.md`](ally-be/docs/adding-a-prompt.md). Editing one needs a Skills Store key for the `prompts` CLI: [set up once](ally-be/docs/prompts-api.md#working-on-prompts-from-a-laptop). Changing its variables or answer shape needs the steps in a set order (code and deploy first to add a variable; text first to remove one): [Changing an existing prompt](ally-be/docs/adding-a-prompt.md#changing-an-existing-prompt).

### Message Queues (AWS SQS)
- `sqs-ai-transcription-request-queue` - Transcription requests (be -> ai)
- `sqs-ai-transcription-response-queue` - Transcription results (ai -> be)
- `sqs-learn-message-and-event-queue` - Learning events (ai-learn -> be)
- `sqs-audio-upload-queue` - Audio uploads
- Dead letter queues (DLQ) for each with max retry of 5
- LocalStack for local development

### Storage
- **PostgreSQL**: Primary DB for ally-be (TypeORM, 211+ migrations)
- **Redis**: Caching, pub/sub, rate limiting, sessions
- **Weaviate**: Vector DB for ally-ai (embeddings, semantic search)
- **AWS S3**: Audio files, transcription results, media assets, env files

## Development Setup

### Quick Start
```bash
cd infra && ./scripts/bootstrap.sh   # Clone all repos
cd infra && ./scripts/dev_env.sh     # Start all services via Docker
```

### Per-Repo Commands

**ally-be** (Node.js 24):
```bash
npm install
npm run start:dev              # Dev mode with hot reload
npm run migration:run          # Run DB migrations
npm run seed:all               # Seed database
npm run test                   # Run tests
```

**ally-ai** (Python 3.12+):
```bash
poetry install
docker compose up -d           # Weaviate + LocalStack
poetry run uvicorn app.main:app --reload
make test
```

**ally-ai-learn** (Python 3.12+):
```bash
poetry install
poetry run python -m app.worker dev   # LiveKit worker (Terminal 1)
poetry run uvicorn app.main:app --reload --port 8000  # API (Terminal 2)
# Or: ./start.sh
```

**ally-web** (Node.js 22, per `ally-web/.nvmrc`):
```bash
npm install
npx nx serve ally-helpline-dashboard  # Helpline at :8080
npx nx serve ally-admin-dashboard     # Admin at :8081
npm run build:prod                    # Build all
```

**ally-mobile** (Flutter):
```bash
flutter pub get
flutter run --dart-define-from-file=env/local.env                # dev identity
flutter run --flavor prod --dart-define-from-file=env/local.env  # store identity
flutter test
```

**infra**:
```bash
cd ansible
ansible-playbook -i inventories/development/hosts.yml <playbook>.yml
```

## Code Quality & CI/CD

### Python repos (ally-ai, ally-ai-learn)
- Formatting: Black (88 chars), isort
- Linting: flake8
- Testing: pytest + asyncio
- Pre-commit hooks configured

### TypeScript repos (ally-be, ally-web)
- Formatting: Prettier
- Linting: ESLint
- Testing: Jest (ally-be), Vitest (ally-web)
- Git hooks: Husky + lint-staged

### ally-mobile (Flutter + Dart)
- Linting: `flutter analyze` (flutter_lints)
- Testing: `flutter test`
- **Never run `dart format` on this repo** — it isn't dart-formatted, and running it reformats far more than intended

### Deployment
- **CI/CD**: GitHub Actions
- **Container Registry**: AWS ECR
- **Production**: Hetzner baremetal with Incus containers, deployed via Ansible
- **CDN**: CloudFront for admin/helpline dashboards
- **DNS/TLS**: Caddy with auto-HTTPS

## HIPAA Compliance
- CloudWatch audit logging with dedicated log groups
- PHI logger in ally-ai for sensitive data
- Encrypted secrets via Ansible Vault
- Wireguard VPN for infrastructure access
- CORS disabled by default on AI services

## Key Environment Variables (shared across services)
- `OPENAI_API_KEY` - Required by ally-ai, ally-ai-learn, ally-be
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` - LiveKit connectivity
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` - AWS services
- `DEEPGRAM_API_KEY` - Speech-to-text
- `ALLY_CONTEXT_LIBRARY_URL`, `ALLY_CONTEXT_LIBRARY_KEY` - Context Library MCP for engineers' Claude Code (read-only key; set in your shell, never committed)
- See each repo's `env_sample` or `.env.example` for full list

## Monorepo map (short)

| Path | What it is | Local port |
|------|-----------|------------|
| `ally-ai/` | FastAPI, Python 3.12, Poetry, Weaviate. Knowledge answers, crisis check, judges, transcription | 3001 (Docker) |
| `ally-be/` | NestJS, Node 24, Postgres 14 (host :5477), Redis. Chatbot engine, WhatsApp connector, Skills Store | 8001 |
| `ally-web/` | Nx: `ally-admin-dashboard`, `ally-helpline-dashboard`, `ui-shared` | 8081 / 8080 |
| `ally-ai-learn/` | LiveKit voice-training agent (LangGraph) | 8002 (Docker) |
| `ally-mobile/`, `ally-mobile-flutter/` | Counselor apps | none |
| `infra/` | Separate repo, gitignored here; `./infra/dev_env.sh` starts the local stack | none |
| `docs/` | Cross-repo docs, including `docs/agents-v2/` and `docs/context-library/` (plan and build notes) | none |

Each app directory has its own `CLAUDE.md` (mirrored with `AGENTS.md`). Read it before working there.

## Verified commands

These come from each app's CI workflow (`.github/workflows/test-*.yml`) and `package.json`. Where they differ from the older per-repo list above, these win.

**ally-ai**: Python 3.12 + Poetry. Locally, use a 3.12 venv (`uv python install 3.12 && poetry env use "$(uv python find 3.12)"`). The host Python may be newer, and the Docker image has no dev dependencies.
```bash
cd ally-ai
poetry install --no-interaction --with dev   # make install
poetry run pytest tests/ -v                  # make test (CI)
poetry run flake8                            # CI lint (blocking)
make migrate                                 # Weaviate migrations
make sync-prompts                            # push default prompts to ally-be
```

**ally-be**: Node 24.
```bash
cd ally-be
npm run start:dev
npm test -- --forceExit --detectOpenHandles   # as CI runs it
npm run test:e2e
npm run lint && npm run typecheck && npm run build
npm run migration:run
```

**ally-web**: Node 22.
```bash
cd ally-web
npm run start:admin        # :8081
npm run start:helpline     # :8080
npm test                   # nx test (all projects)
npm run lint && npm run format:check
npm run build:admin && npm run build:helpline
npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json   # CI typecheck
```

## Agents v2

Agents v2 turns Stage 1 chatbots into a LangGraph agent workspace, built in chunks. Before any Agents v2 work, **always read `docs/agents-v2/CONTEXT.md` and the current chunk brief first.**

**Current chunk: 3b — `docs/agents-v2/chunk-3b.md`** (fast track; one session at a time on `feat/agents-v2-fast-track`). Index of the Agents v2 docs: `docs/agents-v2/README.md`.

Always (from `CONTEXT.md`):

- Work only on the current chunk. If you notice something for a later chunk, write it in the notes; don't build it.
- Read the real code before you design. Match each repo's existing conventions.
- Keep v1 behaviour and the existing tests unchanged. If an existing test fails, stop and report it.
- Don't upgrade existing dependencies without asking.
- Run tests and lint before saying anything is done. Commit after each milestone.
- End each chunk with `CHUNK-NN-NOTES.md`: code map, decisions, how to test, open questions.
