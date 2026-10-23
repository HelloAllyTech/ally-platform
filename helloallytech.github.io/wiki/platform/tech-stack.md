---
title: Tech Stack
tags: [platform, tech-stack, tooling]
summary: The polyglot technology stack used across Ally's frontend, mobile, backend, AI, and infrastructure layers.
last_reconciled: 2026-10-21
---

# Tech Stack

Ally runs on a modern, polyglot stack focused on reliability, security, and speed of iteration: TypeScript-first frontends, Python AI services, a NestJS backend, all containerised — Docker Compose for local development and AWS ECS in production.

## Frontend
- React 18 with Vite 5 powers the web surfaces: the helpline and admin dashboards. (The Next.js landing app was removed in August 2026.)
- TypeScript everywhere, with Tailwind CSS, the IBM Carbon design system (components and charts), and Redux Toolkit with RTK Query for stateful experiences.
- Nx monorepo tooling; shared component library (`ui-shared`); Vitest for tests.
- See [ally-web](../repos/ally-web.md).

## Mobile
- React Native 0.79 with TypeScript for iOS and Android.
- LiveKit-native modules for secure audio streaming and transcription.
- Redux Toolkit + RTK Query, React Navigation, Firebase Crashlytics and push messaging, Socket.IO.
- See [ally-mobile](../repos/ally-mobile.md).

## Backend & APIs
- NestJS (TypeScript, Node 24) for REST, WebSocket, and event-driven services.
- PostgreSQL (TypeORM), Redis, and Socket.IO for transactional and realtime workloads.
- AWS SQS, S3, and SES integrations orchestrated through domain-driven service modules.
- JWT + OTP + Google and Apple sign-in authentication; RBAC with feature toggles, and multi-tenant isolation.
- See [ally-be](../repos/ally-be.md).

## AI Services
- Python 3.12 services on FastAPI.
- ally-ai: LangChain and the OpenAI, Gemini and Anthropic SDKs for counseling insights and the evaluation judges, with Weaviate vector search for semantic retrieval. Speech-to-text for uploaded calls is an ordered fallback chain — Gemini, Sarvam, then OpenAI Whisper by default, with Deepgram still available as an option.
- ally-ai-learn: the LiveKit Agents voice pipeline with LangGraph driving each turn, on OpenAI or Gemini (or an OpenAI-compatible self-hosted backend such as Ollama or vLLM).
- Multi-provider TTS (ElevenLabs, Deepgram, Google, Hume, Sarvam, Cartesia, SmallestAI) and live STT (Deepgram, Google, Sarvam, ElevenLabs) in the training agent.
- Which model serves which call is mapped in ally-be's AI task registry — see [Architecture](architecture.md).
- See [ally-ai](../repos/ally-ai.md) and [ally-ai-learn](../repos/ally-ai-learn.md).

## Data & Realtime
- LiveKit for low-latency voice and data channels.
- Redis pub/sub for cross-replica fan-out, and PostgreSQL analytics layers for longitudinal session data, with Metabase and PostHog for dashboards and product analytics.
- SQS pipelines carry transcription requests, learning events and usage telemetry between services.

## Infrastructure & DevOps
- Production services run on AWS ECS from ECR images; GitHub Actions workflows in each code repo build and release them.
- AWS ECR (images), SQS (queues), S3 (assets, env files and dashboard builds) with CloudFront in front of the dashboards, CloudWatch (HIPAA audit logs).
- Ansible + Terraform-managed hosts; Incus containers on Hetzner baremetal run the self-hosted tooling (PostHog, Metabase, CI).
- Caddy reverse proxy with automatic HTTPS and a Wireguard VPN mesh on those hosts.
- Colima as a lightweight Docker runtime on macOS.
- GitHub Actions workflows covering tests, secret scanning, docs checks, release builds, and image publishing.
- See [infra](../repos/infra.md).

## Language & Runtime Versions

| Repo | Runtime |
|------|---------|
| ally-be | Node.js 24 |
| ally-web | Node.js 22 |
| ally-mobile | Node.js ≥ 18, React Native 0.79 |
| ally-ai | Python 3.12+ |
| ally-ai-learn | Python 3.12+ |
| infra | Ansible (Python 3.13, uv), Terraform, Bash |

## Code Quality Conventions

- **Python repos** (ally-ai, ally-ai-learn): Black (88 chars), isort, flake8, pytest + asyncio, pre-commit hooks.
- **TypeScript repos** (ally-be, ally-web, ally-mobile): Prettier, ESLint, Jest (ally-be, ally-mobile) / Vitest (ally-web), Husky git hooks (with lint-staged in ally-web and ally-mobile).

## Docker Compose for Local Development

Every service family ships Compose files that bring it up locally: ally-be (Postgres, Redis, LocalStack, and the backend), ally-ai and ally-ai-learn (`docker-compose.local.yml`, which reuses ally-be's LocalStack), and the two ally-web dashboards. That keeps onboarding friction low (`docker compose up` per bundle), lets you run only the pieces you are working on, and `infra/dev_env.sh` starts them in order. Production does not run Compose: the release workflows build images and run them on ECS.

---

*See also: [Platform Overview](overview.md), [Architecture](architecture.md).*
