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
| `ally-ai` | FastAPI + Python + Weaviate | AI service: conversation analysis, nudges, summaries, transcription | 8000 |
| `ally-ai-learn` | FastAPI + LiveKit + LangGraph + Python | Voice-based training agent: simulated client conversations with real-time event detection | 8000 (API) + LiveKit worker |
| `ally-web` | Nx monorepo: Next.js + 2x Vite+React apps | Landing page (3000), Helpline dashboard (8080), Admin dashboard (8081) | 3000/8080/8081 |
| `ally-mobile` | React Native + TypeScript | iOS/Android app for counselors: live sessions, reviews, simulations | N/A |
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
    | (React Native app) |     |        ally-be          |
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
- **Prompt Management**: the Skills Store (ally-be) holds every prompt's live versions; each service keeps a default `.txt` and a typed contract in code. Adding a prompt: [`ally-be/docs/adding-a-prompt.md`](ally-be/docs/adding-a-prompt.md)

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

**ally-web** (Node.js 20):
```bash
npm install
npx nx serve ally-helpline-dashboard  # Helpline at :8080
npx nx serve ally-admin-dashboard     # Admin at :8081
npx nx serve ally-web                 # Landing at :3000
npm run build:prod                    # Build all
```

**ally-mobile** (React Native):
```bash
npm install
npm run android:dev            # Android dev build
npm run ios                    # iOS build (requires Xcode)
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

### TypeScript repos (ally-be, ally-web, ally-mobile)
- Formatting: Prettier
- Linting: ESLint
- Testing: Jest (ally-be), Vitest (ally-web)
- Git hooks: Husky + lint-staged

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
- See each repo's `env_sample` or `.env.example` for full list
