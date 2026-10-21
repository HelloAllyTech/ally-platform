---
title: Architecture & Data Flow
tags: [platform, architecture, integration, queues, storage]
summary: How Ally's services connect — data flow, integration points, message queues, storage, and authentication across the platform.
last_reconciled: 2026-10-21
---

# Architecture & Data Flow

Ally is a multi-repo platform of counselor-facing clients, a core backend, and specialized AI services, tied together with REST, WebSockets, AWS SQS, and a LiveKit voice server.

## High-Level Data Flow

```
                    +-----------------+
                    |   ally-web      |
                    | (helpline and   |
                    |  admin apps)    |
                    +--------+--------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+     +-------------v-----------+
    |    ally-mobile     |     |        ally-be          |
    | (React Native app) |     | (NestJS core backend)   |
    +--------+-----------+     | PostgreSQL + Redis      |
             |                 | SQS queues              |
             +-------+--------+ +---+-------+----+--------+
                     |             |       |    |
              WebSocket/REST       |       |    |
                                   |       |    |
                    +--------------+  +----+    +--------+
                    |                 |                   |
          +---------v------+  +------v--------+  +-------v-------+
          |    ally-ai     |  | ally-ai-learn |  |    LiveKit     |
          | (FastAPI)      |  | (LiveKit agent)|  |    Server     |
          | Weaviate VecDB |  | LangGraph      |  +---------------+
          +----------------+  +---------------+
```

The client surfaces — the helpline and admin dashboards in [ally-web](../repos/ally-web.md) and [ally-mobile](../repos/ally-mobile.md) — talk to the core backend ([ally-be](../repos/ally-be.md)) over REST and Socket.IO. ally-be delegates AI analysis to [ally-ai](../repos/ally-ai.md) and voice-based training to [ally-ai-learn](../repos/ally-ai-learn.md), and coordinates real-time voice rooms through **LiveKit**. It also calls model providers itself for its authoring, translation and agent features.

## Key Integration Points

- **ally-be ↔ ally-ai** — REST calls from ally-be (summaries, nudges, the evaluation judges, the knowledge and reference-document endpoints, the text-helpline copilot). Uploaded-call transcription is queued instead: ally-be puts a request on SQS, ally-ai's worker transcribes it (an ordered fallback chain of speech providers) and summarises it, then **posts the result back to ally-be over REST** (`POST /api/v1/chats/process-transcript`) — there is no response queue. ally-ai reads current prompt text from ally-be via `GET /api/v1/prompts/by-codes`.
- **ally-be ↔ ally-ai-learn** — SQS queue `sqs-learn-message-and-event-queue` carries training events (ai-learn → be). REST runs both ways: ally-be asks ally-ai-learn to generate scenario reports and session evaluations, and the results come back through ally-be webhooks; prompt sync goes to ally-be too. Service calls authenticate with `X-API-Key`.
- **ally-ai / ally-ai-learn → ally-be telemetry** — both Python services emit LLM-usage and retrieval-log events onto the same learn queue; ally-be routes each message by its `message_type`.
- **ally-be ↔ LiveKit** — Server SDK for room creation/management and agent dispatch; webhooks for room and participant events. ally-ai-learn agents join the rooms ally-be creates; scenario configuration travels as **LiveKit room metadata**. The full envelope is large, rides inside every agent availability request, and room metadata has a hard size cap in LiveKit, so ally-be can instead send a slim pointer and let the agent fetch the full envelope from an API-key-guarded ally-be webhook (`LEARN_METADATA_FETCH_ENABLED`, off unless set).
- **ally-web / ally-mobile ↔ ally-be** — REST API plus Socket.IO WebSockets. Namespaces: `/microphone-chat` and `/cloud-telephony-chat` (live call recording and transcription), `/helpline-chat` (text helpline), `/scenarios/reports`, `/scenarios/translations` and `/tracks/translations` (long-running admin jobs), `/product-roadmap`, and `/builder` and `/course-copilot` (the authoring agents).
- **ally-ai-learn ↔ LiveKit** — the agent worker connects to LiveKit rooms for voice sessions (and typed text-chat sessions, which skip the audio pipeline); UI feedback is sent over LiveKit data channels.

## Authentication

- **Web / Mobile → Backend** — JWT (access + refresh tokens), Google OAuth, Apple Sign-In, and OTP.
- **Service-to-Service** — `X-API-Key` header, with a separate key for each direction: ally-be accepts `API_KEY` from the AI services, and sends its own outbound key to each of them.
- **Multi-tenant** — tenant isolation is enforced at the entity level in ally-be (tenant-scoped entities carry a `tenantId`; globally-authored content is shared with tenants through explicit join tables), with fine-grained RBAC via groups, permission guards and per-user feature toggles.
- **API versioning** — REST APIs are served under `/api` and versioned in the path (`/api/v1/…`); the health check is `/api/health` and Swagger is at `/api-docs`.

## AI / LLM Stack

- **LLM providers** — OpenAI is the default and the compiled-in floor, because every runtime holds a key for it. Gemini serves ally-ai's judges and analytics agent and much of ally-be's translation and agent work; Anthropic serves a few agentic tasks. ally-ai-learn's live agent runs on OpenAI or Gemini chosen per scenario and prompt, and also supports OpenAI-compatible self-hosted backends (Ollama, vLLM). ally-ai-learn drives its turns with LangGraph.
- **Which model serves which call** — the AI task registry in ally-be (`ally-be/src/llm/constants/ai-task-registry.constants.ts`) lists every call that reaches a model, in any repo, and its default model; it is served at `GET /api/v1/llm/tasks` and shown in the admin **AI Tasks** tab. Those models are defaults: a model resolves at request time through the code default, then the language's LLM config, then the prompt's own model, then an explicit request override, later winning.
- **Embeddings** — OpenAI embeddings; ally-ai stores them in Weaviate, and ally-ai-learn uses them for similarity detection and working memory.
- **TTS providers** (ally-ai-learn) — ElevenLabs, Deepgram, Google, Hume, Sarvam, Cartesia, SmallestAI.
- **STT providers** — live (ally-ai-learn): Deepgram, Google, Sarvam, ElevenLabs. Batch transcription of uploaded audio (ally-ai): an ordered fallback chain, by default Gemini, then Sarvam, then OpenAI Whisper; a provider with no key is skipped, and Deepgram can still be configured but is out of the default chain.
- **Prompt management** — file-based templates with runtime overrides, synced to the backend. Prompts in ally-ai/ally-ai-learn can be overridden at runtime via ally-be's prompt management (`ally-ai/scripts/sync_prompts.py` and `ally-ai-learn/scripts/sync_prompts.py` push defaults).

## Message Queues (AWS SQS)

- `sqs-ai-transcription-request-queue` — transcription requests (be → ai); results return over REST, not a queue
- `sqs-learn-message-and-event-queue` — learning events and LLM-usage / retrieval-log telemetry (ai-learn and ai → be)
- `sqs-audio-file-retry-queue` — ally-be's own queue for retrying audio-file ingestion
- Knowledge-base ingestion, inbound WhatsApp messages and AI Lab runs each use a queue that ally-be both feeds and consumes. Each is configured by its own `SQS_*_QUEUE_URL` setting and skipped when that is unset, so a feature whose queue is not provisioned in an environment does not error-loop.
- Most queues have a **dead-letter queue (DLQ)** — the learn queue is the exception — and the local LocalStack bootstrap redrives to it after 5 receives. ally-be polls its queues itself.
- **LocalStack** emulates SQS and S3 for local development.

## Storage

- **PostgreSQL** — primary DB for ally-be (TypeORM; managed on AWS in production; see [ally-be](../repos/ally-be.md), whose `DATA_SCHEMA.md` maps every table; current counts in [Platform Stats](stats.md)).
- **Redis** — caching, cross-replica pub/sub (the message broker behind the sockets), rate-limit counters, and short-lived state such as presence and in-flight job progress.
- **Weaviate** — vector DB for ally-ai: reference documents, knowledge chunks, roadmap opportunities, agent memories and conversation turns, for semantic search and retrieval.
- **AWS S3** — audio files, call and session recordings, media assets, dashboard builds, and env files.

## HIPAA Compliance

- Audit logging to CloudWatch with dedicated log groups — ally-be's audit module and ally-ai's `phi_logger` each write to one, switched on by flags. Never log PII/PHI outside the designated audit loggers.
- PHI-bearing columns in ally-be (call details, message content, helpline content) are encrypted at rest with AES-256-GCM, using a key from the environment.
- Encrypted secrets via Ansible Vault.
- Wireguard VPN for infrastructure access.
- CORS: ally-ai rejects every browser origin — it is only meant to be called by other services. ally-ai-learn reads an `ALLOWED_ORIGINS` allow-list whose default is permissive (`*`), so set it explicitly per environment.

## Deployment

- **CI/CD** — GitHub Actions; each service's production release is a manually dispatched workflow that builds and tags an image.
- **Container registry** — AWS ECR.
- **Production** — ally-be, ally-ai and ally-ai-learn run as AWS ECS services. A release builds the image, runs ally-be's database migrations as a one-off ECS task, then updates the service. These deploys come from each code repo's own workflow, not from `infra`.
- **Dashboards** — the helpline and admin apps are static builds synced to S3 and served through CloudFront.
- **Mobile** — ally-mobile builds and store releases run from GitHub Actions workflows.
- **infra** — Ansible and Terraform provision Hetzner baremetal split into Incus containers (see [infra](../repos/infra.md)); that fleet hosts the self-hosted tools (PostHog and Metabase analytics, the locale service, CI), not the core services.
- **DNS / TLS** — Caddy with automatic HTTPS on the infra-managed hosts.

## Shared Environment Variables

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — LiveKit connectivity; required by ally-be, and the same project's values go into ally-ai-learn.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — AWS services, in ally-be and ally-ai-learn. ally-ai nests its settings, so the same values are `AWS__…` there.
- `OPENAI_API_KEY` — optional in ally-be, and in ally-ai-learn, which falls back to a local Ollama without it; ally-ai requires its own as `OPENAI__API_KEY`. Gemini and Anthropic keys follow the same naming.
- The service API keys (see Authentication) are named differently in each repo; the key a caller sends must equal the key its receiver validates.
- See each repo's `env_sample` / `.env.example` for the full list.

---

*See also: [Platform Overview](overview.md), [Tech Stack](tech-stack.md), [Agent Guide](agent-guide.md).*
