# ally-ai-learn — start here

Python LiveKit worker running the live voice agent: the thing a learner actually talks to.
STT, LLM turn-taking and TTS in one real-time pipeline, where latency is the product.

This file is a **router**: find your task below, read what it points at, skip the rest.
Conventions with a canonical home are linked, never restated — if you find a rule written
twice anywhere in this platform, that's a bug worth fixing.

## Search Stacks whenever a product judgement comes up

Not only while planning. Call the stacks MCP's `search_chunks` tool with **2-3 queries** on the
topic (not the ticket title), incorporate what comes back, and cite chunk titles:

- **before writing an implementation plan** — the original rule, and still the one that matters
  most;
- **while implementing**, at each point you would otherwise invent the answer: an empty, loading,
  edge or failure state; a user-facing label, button or error message; what a view shows and what
  it omits; a threshold, limit, cadence or reward rule;
- **while reviewing**, for how a change behaves rather than how it reads.

Trivial mechanical changes (rename, dependency bump, typo) are exempt. The `stacks` server is
declared in this repo's committed [`.mcp.json`](.mcp.json) and reads `STACKS_API_KEY` from the
environment; the [`stacks` skill](.claude/skills/stacks/SKILL.md) carries the query technique, and
a committed `UserPromptSubmit` hook injects a small search when a prompt looks product-shaped —
that hook is a floor, not the rule, so keep querying yourself. Setup and citation format:
[Planning with Stacks](https://tech.helloally.ai/#/wiki/contributing/planning-with-stacks.md).

Stacks **replaced** the wiki's Product Management Best Practices, deprecated 2026-08-07:
nothing there is a gate, and Stacks wins on conflict. Those pages still record Ally-specific
traps a general corpus won't have, so check them when a query comes back empty on something
Ally-specific.

## What am I doing?

| Task | Read first |
|---|---|
| Anything at all, first time here | [`docs/readme.md`](docs/readme.md) — the doc index, with reading paths |
| Agent doesn't join, or joins late | [`docs/01-worker-lifecycle.md`](docs/01-worker-lifecycle.md) — dispatch, availability, join. Usually **not** this repo's fault; see gotchas |
| Turn feels slow, or talks over the learner | [`docs/02-graph-pipeline.md`](docs/02-graph-pipeline.md) — stage order is where latency hides |
| Adding or changing an event | [`docs/03-event-system.md`](docs/03-event-system.md), then [`docs/04-event-types-reference.md`](docs/04-event-types-reference.md) — the types are a contract with ally-be and the clients |
| Voice, accent or language quality | [`docs/05-tts-providers.md`](docs/05-tts-providers.md) |
| Mishearing, gibberish, transcript drift | [`docs/06-stt-providers.md`](docs/06-stt-providers.md) |
| Model choice, cost or response latency | [`docs/07-llm-providers.md`](docs/07-llm-providers.md) |
| Scenario behaviour or persona | [`docs/09-scenario-engine.md`](docs/09-scenario-engine.md) |
| Branching instructions / guardrails | [`docs/10-branching-instructions.md`](docs/10-branching-instructions.md) |
| Session ending unexpectedly | [`docs/13-event-termination.md`](docs/13-event-termination.md) |
| Prompts | [`docs/12-prompts-system.md`](docs/12-prompts-system.md) |
| Queues and cross-service messaging | [`docs/11-queue-messaging.md`](docs/11-queue-messaging.md) |
| Running it locally | [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) — and read the first gotcha below |
| Anything else | [`WIKI-ROUTING.md`](WIKI-ROUTING.md) — one line per wiki page, tells you which to fetch |

## Repo shape

- `app/worker.py` — the LiveKit worker entry point. `app/worker_v2.py` is the roleplay-v2 variant.
- `app/core/graph/` — the turn pipeline. `app/core/agent/` — agent construction.
- `app/core/events/` — event definitions and dispatch. `app/core/livekit/` — room and track plumbing.
- `app/core/branching_instructions/` — runtime guardrails injected into the prompt.
- `app/tts/`, `app/stt/`, `app/llms/` — one adapter per provider.
- `app/prompts/` — prompt templates. `app/api/` — the HTTP surface (`app/main.py`).
- `tests/unit/` — fast tests; run them before pushing.

## Gotchas that change what you write

- **A fresh clone won't start.** Run `python -m app.download_files` first. The worker loads
  the turn-detector (end-of-utterance) model with `local_files_only=True` and will not fetch
  it on demand — it just fails to come up.
- **"Agent won't join" is usually not this code.** Look at dispatch metadata size and worker
  capacity before you read the pipeline. Oversized room/dispatch metadata has repeatedly blown
  LiveKit's availability timeout, which looks identical from the learner's side.
- **"Joins but doesn't speak" is a different bug from "won't join".** Measure where the audio
  stops: the agent can publish on time and still be inaudible while the client subscribes.
- **Latency is the feature.** Anything you add to the path between the learner finishing a
  sentence and hearing a reply is a product regression, even if it is correct. Move work off
  that path — do it during setup, or in the background — rather than making it faster.
- **STT confidence is not usable for Indian languages.** Don't gate behaviour on it. The
  mitigation for mis-transcription is a live guardrail that asks the learner to repeat.
- **Provider behaviour differs per language, not just per provider.** A fix verified in
  English tells you very little about Malayalam, Tamil or Kannada.

## Commands

```bash
make install                                        # deps
python -m app.download_files                        # required once, before first run
make test                                           # pytest
make lint                                           # ruff
make fix                                            # format, then lint --fix
docker compose -f docker-compose.local.yml up       # local stack
```

## When your change outdates a doc

[`.docs-map.yml`](.docs-map.yml) declares which docs cover which code, and CI enforces it.
Touching `app/tts/**` without updating `docs/05-tts-providers.md` fails the build — either
update it, or apply the `docs:skip` label with a reason.

Pushing straight to `master`? The same check runs before the push, and the escape hatches
move to the commit message: `Wiki-PR: <url>`, `Wiki-PR: none — <reason>`, or
`Docs-Skip: <reason>`. Install the hook once:

```bash
curl -fsSL https://raw.githubusercontent.com/HelloAllyTech/.github/main/hooks/install.sh | bash
```

Wiki edits do **not** need a hand-rolled second PR:

```bash
git clone --depth=1 https://github.com/helloallytech/helloallytech.github.io .wiki-tmp
# edit .wiki-tmp/wiki/**
.wiki-tmp/scripts/wiki-pr.sh "<url of this PR>"     # or: .wiki-tmp/scripts/wiki-pr.sh HEAD
```

`.wiki-tmp/` is gitignored. The wiki PR merges when this change lands.

## Canonical docs

The [Ally Developer Wiki](https://tech.helloally.ai) is the source of truth for platform
architecture and SDLC rules (product practice now comes from Stacks) —
[this repo's page](https://tech.helloally.ai/#/wiki/repos/ally-ai-learn.md) ·
[architecture](https://tech.helloally.ai/#/wiki/platform/architecture.md) ·
[contributing](https://tech.helloally.ai/#/wiki/contributing/guide.md) ·
[how the docs system works](https://tech.helloally.ai/#/wiki/contributing/docs-system.md).

> ⚠️ The wiki is **public**. Never add secrets, credentials, IP addresses, internal
> hostnames/domains, or cloud region details to it.
