# ally-ai-learn — start here

LiveKit voice-training agent: FastAPI + LiveKit Agents + LangGraph. Python 3.12+, Poetry.

This file is a **router**: find your task below, read what it points at, skip the rest.
Conventions with a canonical home are linked, never restated — if you find a rule written
twice anywhere in this platform, that's a bug worth fixing.

**This repo has the deepest local docs on the platform** — 14 numbered guides in `docs/`,
fronted by [`docs/readme.md`](docs/readme.md), which is organised by intent ("I want to add
a new provider" → the two docs you need). Use it; it will beat searching the tree.

## Before you touch anything user-facing

Read [Product Best Practices](https://tech.helloally.ai/#/wiki/product/best-practices.md)
and the one subsection that matches your change. Internal work — refactors, migrations,
infra, tests — is exempt.

## What am I doing?

| Task | Read first |
|---|---|
| Understanding the system at all | [`docs/architecture.md`](docs/architecture.md) → [`docs/01-worker-lifecycle.md`](docs/01-worker-lifecycle.md) → [`docs/02-graph-pipeline.md`](docs/02-graph-pipeline.md) |
| Adding an event type | [`docs/03-event-system.md`](docs/03-event-system.md) + [`docs/04-event-types-reference.md`](docs/04-event-types-reference.md), then the recipe below |
| Adding a TTS / STT / LLM provider | [`docs/05-tts-providers.md`](docs/05-tts-providers.md) · [`docs/06-stt-providers.md`](docs/06-stt-providers.md) · [`docs/07-llm-providers.md`](docs/07-llm-providers.md) |
| Scenario configuration | [`docs/09-scenario-engine.md`](docs/09-scenario-engine.md), then [`docs/10-branching-instructions.md`](docs/10-branching-instructions.md) |
| Prompt overrides | [`docs/12-prompts-system.md`](docs/12-prompts-system.md) |
| Queue / SQS messaging | [`docs/11-queue-messaging.md`](docs/11-queue-messaging.md) |
| Ending a simulation | [`docs/13-event-termination.md`](docs/13-event-termination.md) |
| Local setup | [`docs/getting-started.md`](docs/getting-started.md), [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) |
| Deploying | [`DEPLOYMENT.md`](DEPLOYMENT.md), [`.github/RELEASE_GUIDE.md`](.github/RELEASE_GUIDE.md) |
| Anything else | [`WIKI-ROUTING.md`](WIKI-ROUTING.md) — one line per wiki page, tells you which to fetch |

## Repo shape

- `app/worker.py` — the LiveKit agent. `app/main.py` — the FastAPI surface.
- `app/core/graph/` — LangGraph: process_events → resolve_branching →
  generate_response/detect_behaviors → apply_voice → send_feedback.
- `app/core/events/` — 9 event types, orchestrator, registry, scoring, eligibility.
- `app/tts/`, `app/stt/`, `app/llms/` — each with a `factory.py`.
- `app/prompts/` — system, branching, prosody, events.

## Recipes

**New event type** — class in `app/core/events/event_types/`, register in
`app/core/events/factory.py`, prompts in `app/prompts/events/`, then update
`docs/04-event-types-reference.md` (CI enforces this).

**New provider** — class in `app/tts|stt|llms/`, extend that family's `factory.py`, update
the matching `docs/05–07` file.

## Gotchas that change what you write

- **Rooms come from ally-be.** This agent joins LiveKit rooms it did not create; room
  metadata carries the scenario configuration. Don't assume you can set it here.
- **Registration is the easy thing to forget.** A provider or event type that isn't in its
  `factory.py` fails silently at runtime rather than at import.
- **Events have eligibility constraints**, not just triggers — read
  [`docs/03-event-system.md`](docs/03-event-system.md) before debugging one that "never fires".
- **SQS in dev is LocalStack**, started by docker-compose. Queue URLs differ from production.
- **Python 3.12+.** Not the system Python on most machines.

## Commands

```bash
make install
make test
make lint
make fix       # format + autofix
```

## When your change outdates a doc

[`.docs-map.yml`](.docs-map.yml) declares which docs cover which code, and CI enforces it.
Adding an event type without touching `docs/04-event-types-reference.md` fails the build —
either update it, or apply the `docs:skip` label with a reason.

Wiki edits do **not** need a hand-rolled second PR:

```bash
git clone --depth=1 https://github.com/helloallytech/helloallytech.github.io .wiki-tmp
# edit .wiki-tmp/wiki/**
.wiki-tmp/scripts/wiki-pr.sh "<url of this PR>"     # prints the Wiki-PR: trailer to paste
```

`.wiki-tmp/` is gitignored. The wiki PR merges when this one does.

## Canonical docs

The [Ally Developer Wiki](https://tech.helloally.ai) is the source of truth for platform
architecture, SDLC rules, and product practice —
[this repo's page](https://tech.helloally.ai/#/wiki/repos/ally-ai-learn.md) ·
[architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md) ·
[contributing](https://tech.helloally.ai/#/wiki/contributing/guide.md) ·
[how the docs system works](https://tech.helloally.ai/#/wiki/contributing/docs-system.md).

> ⚠️ The wiki is **public**. Never add secrets, credentials, IP addresses, internal
> hostnames/domains, or cloud region details to it.
