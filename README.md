# Ally Platform

Ally is building open-source mental-health infrastructure: digital public goods that help
care scale. Mental-health care isn't delivered only by professionals. It also comes from
families, teachers, peers, managers, health workers and volunteers, and Ally's tools are built
with that wider community. Ally is developed by the Ally For Mental Health Foundation, a
not-for-profit.

It has two products so far:

- **Ally Skills Lab**: a no-code simulation creator. Organisations build virtual clients so
  learners can practise counselling skills safely and as often as they need, then review their
  performance and get feedback.
- **Ally Assist**: a copilot for counsellors. It transcribes sessions, writes notes and
  summaries in customisable formats, and turns sessions into insights through analytics.

This repository is the monorepo for both: backend, AI services, web dashboards, mobile app,
and the developer wiki.

> **Canonical docs live in the [Ally Developer Wiki](https://tech.helloally.ai)** (source in
> [`helloallytech.github.io/wiki/`](helloallytech.github.io/wiki)). Start with
> [platform overview](https://tech.helloally.ai/#/wiki/platform/overview.md),
> [architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md) and
> [dev setup](https://tech.helloally.ai/#/wiki/contributing/dev-setup.md).

## What's in here

| Folder | Stack | What it does |
| --- | --- | --- |
| [`ally-be/`](ally-be) | NestJS, TypeScript, PostgreSQL, Redis, TypeORM | Core API: auth, multi-tenancy, RBAC, simulations, scribe, WebSocket gateways. Owns the primary database. |
| [`ally-ai/`](ally-ai) | FastAPI, Python 3.12, LangChain, Weaviate | Offline AI: transcription, summaries, nudges, judges and evaluations. |
| [`ally-ai-learn/`](ally-ai-learn) | FastAPI, LiveKit Agents, LangGraph, Python 3.12 | Live voice agent that plays the simulated client in role-play sessions, with multi-provider STT/TTS/LLM. |
| [`ally-web/`](ally-web) | Nx, React, Vite, Next.js | Helpline dashboard, admin dashboard, and landing page. |
| [`ally-mobile/`](ally-mobile) | React Native, TypeScript, Redux Toolkit | iOS/Android app for counsellors: live sessions, scribe, reviews, simulations. |
| [`helloallytech.github.io/`](helloallytech.github.io) | Markdown | Source of the Developer Wiki, published to GitHub Pages. |
| [`.github/workflows/`](.github/workflows) | GitHub Actions | All CI, deploys and releases for every service. |
| [`scripts/`](scripts), [`.githooks/`](.githooks) | Bash, Node | Repo tooling and the shared git hooks. |

## How the pieces fit

```
   ally-web (dashboards)        ally-mobile (app)
            \                      /
             REST + Socket.IO (/api/v1)
                      |
                  ally-be  ── PostgreSQL, Redis
                 /   |    \
          SQS + REST |     LiveKit (rooms)
               /     |          \
         ally-ai     |      ally-ai-learn  (voice agent joins the room)
        (Weaviate)   └──── SQS events ───┘
```

- Clients talk only to **ally-be**.
- **ally-be ↔ ally-ai**: REST plus SQS queues for transcription.
- **ally-be ↔ ally-ai-learn**: ally-be creates the LiveKit room and dispatches the agent with
  the scenario; the agent reports events back over SQS.
- Service-to-service calls authenticate with an `X-API-Key` header.

More detail: [architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md).

## Getting started

```bash
git clone git@github.com:HelloAllyTech/ally-platform.git
cd ally-platform
```

Each service runs on its own and has its own README with setup steps, env samples and
Docker Compose files. Run commands from inside the service folder:

```bash
cd ally-be && npm install && docker compose up -d
```

| Service | Setup |
| --- | --- |
| ally-be | [`ally-be/README.md`](ally-be/README.md) (Node 24) |
| ally-ai | [`ally-ai/README.md`](ally-ai/README.md) (Python 3.12, Poetry) |
| ally-ai-learn | [`ally-ai-learn/README.md`](ally-ai-learn/README.md) (Python 3.12, Poetry) |
| ally-web | [`ally-web/README.md`](ally-web/README.md) |
| ally-mobile | [`ally-mobile/README.md`](ally-mobile/README.md) |

Environment files are never committed. Copy each service's `env_sample` / `.env.example` /
`docker.env.example` and fill in values. Local SQS and S3 run on LocalStack.

## Git hooks

Turn on the shared hooks (secret scan, lint and Python checks) before your first commit:

```bash
pip install pre-commit && git config core.hooksPath .githooks
```

## Contributing

- Branches: `feature/…`, `fix/…`, `chore/…`. Commits follow
  [Conventional Commits](https://www.conventionalcommits.org).
- Open a PR against `master`. CI runs the tests for each service whose folder the PR touches.
- Docs are enforced in CI: [`.docs-map.yml`](.docs-map.yml) maps code paths to the docs
  that must change with them. Wiki pages can be updated in the same PR under
  `helloallytech.github.io/wiki/`.
- Each service has a `CONTRIBUTING.md`; the shared rules are in the
  [contributing guide](https://tech.helloally.ai/#/wiki/contributing/guide.md).
## For AI agents

Read [`AGENTS.md`](AGENTS.md) first, then the `AGENTS.md` inside the service you are working
on. [`ROUTING.md`](ROUTING.md) indexes the wiki pages so you can pick the right one before
fetching it.

## License

The services are MIT licensed; see the `LICENSE` file in each service folder.
