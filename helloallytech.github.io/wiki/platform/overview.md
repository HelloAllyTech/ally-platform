---
title: Platform Overview
tags: [platform, overview, ecosystem, mission]
summary: What Ally is, its mission, and the multi-repo ecosystem that makes up the platform.
last_reconciled: 2026-07-28
---

# Ally Platform Overview

**Ally** is an open-source, HIPAA-compliant mental health AI platform designed to empower counselors and make quality mental health support more accessible. Think of it as a **copilot for counselors** — combining AI technology with human expertise to support mental health professionals through AI-powered simulations, real-time session analysis, and peer review.

## Mission

We believe mental health support should be accessible, effective, and empowering for both counselors and clients. By combining AI with thoughtful design, Ally builds tools that:

- **Support counselors** with real-time insights and AI-powered assistance
- **Enable training** through realistic AI-simulated client conversations
- **Ensure privacy** with HIPAA-compliant, secure communication
- **Provide accessibility** through web, mobile, and voice interfaces

## The Ally Ecosystem

The platform is a multi-repo monorepo of 7 projects. Each repository has a dedicated wiki page:

| Repo | Purpose | Details |
|------|---------|---------|
| **ally-be** | Core backend API, auth, multi-tenant, RBAC, WebSocket gateways (NestJS) | [ally-be](../repos/ally-be.md) |
| **ally-ai** | AI service: conversation analysis, nudges, summaries, transcription (FastAPI + Weaviate) | [ally-ai](../repos/ally-ai.md) |
| **ally-ai-learn** | Voice-based training agent: simulated client conversations with real-time event detection (LiveKit + LangGraph) | [ally-ai-learn](../repos/ally-ai-learn.md) |
| **ally-web** | Landing page + Helpline dashboard + Admin dashboard (Nx: Next.js + Vite/React) | [ally-web](../repos/ally-web.md) |
| **ally-mobile** | iOS/Android app for counselors: live sessions, reviews, simulations (React Native) | [ally-mobile](../repos/ally-mobile.md) |
| **infra** | Infrastructure: Hetzner baremetal, AWS, Incus containers (Ansible + Terraform + Docker) | [infra](../repos/infra.md) |
| **helloallytech.github.io** | Developer hub / this wiki | — |

## How It Fits Together

- The **web apps** and **mobile app** are the counselor-facing surfaces.
- They talk to **ally-be**, the core backend, over REST and Socket.IO WebSockets.
- ally-be delegates AI work to **ally-ai** (analysis, summaries, transcription) and voice-based training to **ally-ai-learn**, primarily through AWS SQS queues and REST.
- **ally-ai-learn** and ally-be both coordinate with a **LiveKit** server for real-time voice rooms.
- **infra** provisions and wires all of this together across environments.

For the detailed data flow, integration points, message queues, and storage, see [Architecture](architecture.md). For the technology used across the stack, see [Tech Stack](tech-stack.md).

## Getting Involved

- **Contributors**: start with the [Developer Setup](../contributing/dev-setup.md) and the [Contributing Guide](../contributing/guide.md).
- **AI agents / assistants**: read the cross-repo [Agent Guide](agent-guide.md) for conventions, common tasks, and gotchas.
- **Anyone shaping the product** (features, UI, scope): search the Stacks corpus before planning — [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). The in-wiki [Product Management Best Practices](../product/best-practices.md) section it replaced is deprecated and kept for history only.

## License

All Ally projects are open source under the **MIT License**.
