---
title: Developer Setup
tags: [contributing, setup, onboarding, environment]
summary: How to clone all Ally repositories and start the full local development environment.
last_reconciled: 2026-10-23
---

# Developer Setup

This guide gets you from zero to a running Ally development environment. For repo-specific commands, see each [repo page](../index.md#repositories).

> [!NOTE]
> **Unified `ally-platform` Monorepo + Standalone `infra` Repo:**
> All application code (`ally-be`, `ally-web`, `ally-ai`, `ally-ai-learn`, `ally-mobile`) and the developer wiki (`helloallytech.github.io`) live in the unified **`HelloAllyTech/ally-platform`** monorepo. **`HelloAllyTech/infra` is intentionally kept outside the monorepo** as a standalone private repository to isolate infrastructure inventories and Ansible Vault secrets (locally, `infra/` can be cloned directly inside the `ally-platform` root, where `/infra/` is `.gitignore`d).

## Quick Start

1. **Clone the `ally-platform` monorepo (and `infra` for local Docker/Colima helper scripts)**:
   ```bash
   git clone git@github.com:HelloAllyTech/ally-platform.git ally
   cd ally
   git clone git@github.com:HelloAllyTech/infra.git infra
   ```
   *(Alternatively, running `./bootstrap.sh` from a standalone `infra` checkout detects or clones `ally-platform` automatically.)*

   Working from a fork? Use `bootstrap-contributor.sh` (inside `infra/`) instead: it clones your forks and sets `origin` to the fork and `upstream` to the official repo.

   Optional: `source infra/ally-env.sh` registers `ally-*` shell aliases for the scripts below (`ally-dev`, `ally-colima`, `ally-checkout`, …); `ally-help` lists them.

2. **Choose your area of interest** and navigate to that repository.

3. **Read the [Contributing Guide](guide.md)** for SDLC rules and per-repo standards.

## Full Local Stack

After cloning all repos, start the stack with a single command from the workspace root:

```bash
./infra/dev_env.sh
```

This will:
1. **ally-be** — copy `.env` and `docker.env` from their examples if missing, add the seeded local `TEST_ACCOUNTS` and `ALLOW_DIRECT_AGENT_DISPATCH=true` only when they are absent (a value you already set is kept), start Postgres, Redis and LocalStack (S3 and SQS) plus the backend through Docker Compose, wait for `/api/health`, then run migrations and the seed.
2. **ally-ai-learn** — copy `env_sample` to `.env` if missing, then start the LiveKit voice-agent worker from its `docker-compose.local.yml`. It reuses ally-be's LocalStack and reaches ally-be through the host. With no OpenAI key it falls back to a local Ollama if one is running.
3. **ally-ai** — the same pattern, from its own `docker-compose.local.yml` (the API, its SQS transcription worker and Weaviate). A live simulation does not need it, so the script treats a failure here as non-fatal.
4. **ally-web** — copy each dashboard's `.env.example` if missing, build the shared `Dockerfile.deps` dependency image, and start both dashboards with Compose.
5. Print the URLs of the running applications.

Once finished, access:

| What | URL |
|---|---|
| Helpline Dashboard | `http://localhost:8080` |
| Admin Dashboard | `http://localhost:8081` |
| Backend API / Swagger | `http://localhost:8001/api-docs` (health: `/api/health`) |
| ally-ai-learn (voice agent) | `http://localhost:8002` (health: `/api/health`) |
| ally-ai | `http://localhost:3001` |
| Postgres / Redis / LocalStack | host ports `5477` / `6379` / `4566` |

The script also still prints a `:3000` "Search (Web)" line. That was the public landing app, which was removed from ally-web in August 2026; nothing serves it.

**Things that bite on a first run**

- **Simulations need real credentials.** The `.env.example` placeholders start ally-be fine (its health check only pings Postgres) but leave every simulation silently broken. Put the same LiveKit project's URL, API key and secret in both `ally-be/.env` and `ally-ai-learn/.env`; the script warns about any placeholder it finds. The voice agent also needs its speech and LLM provider keys.
- **LiveKit cannot call a `localhost` webhook**, which is why the script sets `ALLOW_DIRECT_AGENT_DISPATCH=true`: without it ally-be never dispatches the agent into the room and the session sits there with nobody joining.
- **Services authenticate with shared API keys, and each pair has to match.** The key ally-ai and ally-ai-learn send to ally-be must equal ally-be's `API_KEY`; the keys ally-be sends to them (`AI_SERVICE_OUTBOUND_API_KEY`, `AI_LEARN_SERVICE_OUTBOUND_API_KEY`) must equal what each of them validates on inbound calls.
- **The backend health wait is short.** `dev_env.sh` polls `/api/health` for about a minute and aborts if the backend is not up by then. A cold first build can take longer. Wait until the endpoint answers and run the script again — every step is safe to repeat, and the container runs pending migrations on its own at start.
- **Run the frontends natively if the containerised ones misbehave.** On Colima they have been known to hang. From `ally-web`: `npm install`, then `npm run start:admin` or `npm run start:helpline`.
- **Don't mix up stopping with cleaning.** `./infra/dev_cleanup.sh` stops and removes **every** container on the machine, not just Ally's. To stop one stack, run `docker compose down` in its repo (with `-f docker-compose.local.yml` for ally-ai and ally-ai-learn).

## Environment Files

- **Python repos** (ally-ai, ally-ai-learn): copy `env_sample` → `.env`.
- **ally-be**: copy `.env.example` → `.env` and `docker.env.example` → `docker.env`. `.env` configures the backend itself, in Compose and when you run `npm run start:dev` on the host; `docker.env` configures the Postgres and LocalStack containers.
- **ally-web**: copy each app's `.env.example` (under `apps/ally-admin-dashboard` and `apps/ally-helpline-dashboard`) → `.env`.
- **ally-mobile**: copy `env/.env.example` → `.env` at the repo root (read through `react-native-config`).
- **Never commit `.env` files.** Required keys per service are listed in each [repo page](../index.md#repositories) and in the repo's env sample.

## Agent Tooling — the Stacks MCP

Every Ally repo commits a `.mcp.json` at its root declaring the `stacks` MCP server, which agents
must search whenever a product judgement comes up — while planning and while coding. The file
carries neither an endpoint nor a credential: it launches a small committed bridge,
`.claude/stacks-bridge.mjs`, which finds a key for you. Alongside it each repo commits a `stacks`
skill carrying the retrieval technique, so the corpus reaches a session without anyone adding or
invoking anything. An agent calls `search_chunks` itself when a judgement comes up; the
keyword-gated `UserPromptSubmit` hook that used to do this was retired on 2026-08-10 once
searching became possible.

Setup is zero beyond one login. Once, per machine: run `gh auth login` as an account in the
HelloAllyTech GitHub org, then approve the `stacks` server the first time an agent session
prompts for it. The bridge exchanges your GitHub token for a key of your own on first use and
caches it locally; every later session reads the cache. `STACKS_API_KEY` in the environment still
wins if you set it, but an unset one is the normal state on a working machine — don't read it as a
broken setup. Full rule and troubleshooting:
[Working with the Stacks MCP](planning-with-stacks.md).

## General Requirements

- Git and SSH access to the HelloAllyTech repositories.
- The GitHub CLI (`gh`), logged in, for the Stacks bridge above.
- Docker and Docker Compose v2 — on macOS via **Colima** (the helper scripts target it, see below) or Docker Desktop.
- Your preferred editor (VS Code recommended).

### Repository-specific runtimes
- **ally-web** — Node.js 22, npm
- **ally-be** — Node.js 24; PostgreSQL and Redis come from the Compose stack
- **ally-mobile** — Node.js ≥ 18, React Native CLI, Xcode / Android Studio, Ruby with CocoaPods (iOS)
- **ally-ai / ally-ai-learn** — Python 3.12, Poetry
- **infra** — Python 3.13 with uv (Ansible), Terraform (driven from Ansible), Docker

## macOS: Colima (recommended Docker runtime)

**Colima** is a lightweight, free alternative to Docker Desktop for container virtualization — open-source, resource-efficient, fast, and fully Docker-CLI compatible.

The `infra` repo provides helpers:
```bash
./infra/colima.sh                 # start a tuned Colima VM
./infra/docker-setup.sh detect    # detect/switch between Colima and Docker Desktop
```

`colima.sh` starts an Apple-Silicon VM using macOS virtualization (VZ) with Rosetta for x86 images, sized for a high-memory machine — read the flags before running it on a smaller one. **If Colima is already running it stops it first, which kills every running container**, so don't use it as a "make sure it's up" check.

`docker-setup.sh` supports `detect` (the default), `switch-to-colima`, `switch-to-desktop`, `fix-compose`, and `test` subcommands, and prints OS-specific install hints on macOS/Linux/Windows. The Colima scripts are macOS-only and exit with a message elsewhere.

`./infra/colima-cleanup.sh` is the reset button: after a confirmation it prunes every Docker image, volume and network and deletes the Colima VM. Use it for a fresh start or a full disk, never as routine cleanup.

## First Time Here?

- **Frontend:** [ally-web](../repos/ally-web.md) — React / Vite (Nx monorepo: helpline and admin dashboards)
- **Mobile:** [ally-mobile](../repos/ally-mobile.md) — React Native
- **Backend:** [ally-be](../repos/ally-be.md) — NestJS API
- **AI/ML:** [ally-ai](../repos/ally-ai.md) or [ally-ai-learn](../repos/ally-ai-learn.md)
- **DevOps:** [infra](../repos/infra.md)

## How We Track Issues

We use GitHub Issues across all repositories. Labels include `bug`, `enhancement`, `good first issue`, and `help wanted`. To find work: browse the repo you're interested in, look for `good first issue` / `help wanted`, check assignment, and comment to express interest before starting.

---

*See also: [Contributing Guide](guide.md), [Platform Overview](../platform/overview.md).*
