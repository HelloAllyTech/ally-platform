---
title: Architecture & Data Flow
tags: [platform, architecture, integration, queues, storage]
summary: How Ally's services connect — data flow, integration points, message queues, storage, and authentication across the platform.
last_reconciled: 2026-07-11
---

# Architecture & Data Flow

Ally is a multi-repo platform of counselor-facing clients, a core backend, and specialized AI services, tied together with REST, WebSockets, AWS SQS, and a LiveKit voice server.

## High-Level Data Flow

```
                    +-----------------+
                    |   ally-web      |
                    | (3 web apps)    |
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

The counselor-facing surfaces ([ally-web](../repos/ally-web.md), [ally-mobile](../repos/ally-mobile.md)) talk to the core backend ([ally-be](../repos/ally-be.md)) over REST and Socket.IO. ally-be delegates AI analysis to [ally-ai](../repos/ally-ai.md) and voice-based training to [ally-ai-learn](../repos/ally-ai-learn.md), and coordinates real-time voice rooms through **LiveKit**.

## Key Integration Points

- **ally-be ↔ ally-ai** — REST API calls (transcription requests dispatched via SQS, plus summaries and nudges). ally-ai reads current prompt text from ally-be via `GET /api/v1/prompts/by-codes`.
- **ally-be ↔ ally-ai-learn** — SQS queue `sqs-learn-message-and-event-queue` carries training events (ai-learn → be); REST is used for scenario reports and prompt sync. Service calls authenticate with `X-API-Key`.
- **ally-be ↔ LiveKit** — Server SDK for room creation/management; webhooks for room events. ally-ai-learn agents join the rooms ally-be creates; scenario configuration travels as **LiveKit room metadata**.
- **ally-web / ally-mobile ↔ ally-be** — REST API plus Socket.IO WebSockets on namespaces `/microphone-chat`, `/cloud-telephony-chat`, and `/scenario-report`.
- **ally-ai-learn ↔ LiveKit** — the agent worker connects to LiveKit rooms for voice sessions; UI feedback is sent over LiveKit data channels.

## Authentication

- **Web / Mobile → Backend** — JWT (access + refresh tokens), Google OAuth, and OTP.
- **Service-to-Service** — `X-API-Key` header.
- **Multi-tenant** — tenant isolation is enforced at the entity level in ally-be (entities carry a `tenantId`), with fine-grained RBAC via groups and permission guards.
- **API versioning** — all REST APIs use the `/api/v1/` prefix.

## AI / LLM Stack

- **Primary LLM** — OpenAI (GPT models) via LangChain; ally-ai-learn also supports Google Gemini and OpenAI-compatible open-source backends.
- **Embeddings** — OpenAI embeddings stored in Weaviate.
- **TTS providers** — Deepgram, ElevenLabs, Google, Hume, Sarvam.
- **STT providers** — Deepgram, Google, Sarvam, OpenAI Whisper.
- **Prompt management** — file-based templates with runtime overrides, synced to the backend. Prompts in ally-ai/ally-ai-learn can be overridden at runtime via ally-be's prompt management (`ally-ai/scripts/sync_prompts.py` and `ally-ai-learn/scripts/sync_prompts.py` push defaults).

## Message Queues (AWS SQS)

- `sqs-ai-transcription-request-queue` — transcription requests (be → ai)
- `sqs-ai-transcription-response-queue` — transcription results (ai → be)
- `sqs-learn-message-and-event-queue` — learning events (ai-learn → be)
- `sqs-audio-upload-queue` — audio uploads
- Each queue has a **dead-letter queue (DLQ)** with a max retry of 5.
- **LocalStack** emulates SQS (and S3/SES/CloudWatch) for local development.

## Storage

- **PostgreSQL** — primary DB for ally-be (TypeORM; see [ally-be](../repos/ally-be.md), whose `DATA_SCHEMA.md` maps every table; current counts in [Platform Stats](stats.md)).
- **Redis** — caching, pub/sub, rate limiting, and sessions.
- **Weaviate** — vector DB for ally-ai (embeddings, semantic search over reference documents).
- **AWS S3** — audio files, transcription results, media assets, and env files.

## HIPAA Compliance

- CloudWatch audit logging with dedicated log groups.
- PHI logger in ally-ai for sensitive data (`phi_logger`); never log PII/PHI outside designated audit loggers.
- Encrypted secrets via Ansible Vault.
- Wireguard VPN for infrastructure access.
- CORS disabled by default on the AI services.

## Deployment

- **CI/CD** — GitHub Actions.
- **Container registry** — AWS ECR.
- **Production** — Hetzner baremetal with Incus containers, deployed via Ansible (see [infra](../repos/infra.md)).
- **CDN** — CloudFront for the admin/helpline dashboards.
- **DNS / TLS** — Caddy with automatic HTTPS.

## Shared Environment Variables

- `OPENAI_API_KEY` — required by ally-ai, ally-ai-learn, ally-be.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — LiveKit connectivity.
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — AWS services.
- `DEEPGRAM_API_KEY` — speech-to-text.
- See each repo's `env_sample` / `.env.example` for the full list.

---

*See also: [Platform Overview](overview.md), [Tech Stack](tech-stack.md), [Agent Guide](agent-guide.md).*
