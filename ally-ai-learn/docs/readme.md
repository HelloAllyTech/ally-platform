# Ally Learn Core -- Developer Documentation

**Purpose.** This index provides an entry point into the Ally Learn Core developer documentation. Use the reading paths below to navigate based on what you want to accomplish.

---

## Reading Paths

### "I want to understand how the system works"

1. [Architecture](architecture.md) -- system diagram, component inventory, design decisions
2. [Worker Lifecycle](01-worker-lifecycle.md) -- session lifecycle from connect to disconnect
3. [Graph Pipeline](02-graph-pipeline.md) -- LangGraph nodes and state management
4. [Event System](03-event-system.md) -- orchestrator, registry, scoring, eligibility
5. [Event Types Reference](04-event-types-reference.md) -- all 9 detection types

### "I want to add a new provider"

1. [Architecture](architecture.md) -- factory pattern overview
2. Provider-specific doc: [TTS](05-tts-providers.md) | [STT](06-stt-providers.md) | [LLM](07-llm-providers.md)

### "I want to add a new event type"

1. [Event System](03-event-system.md) -- how the orchestrator works
2. [Event Types Reference](04-event-types-reference.md) -- existing types for reference

### "I want to understand scenario configuration"

1. [Scenario Engine](09-scenario-engine.md) -- Pydantic models, context generation, simulation instructions
2. [Branching Instructions](10-branching-instructions.md) -- conditional conversation flow
3. [Prompts System](12-prompts-system.md) -- template overrides via promptData.prompts

### "I want to set up a dev environment"

1. [Getting Started](getting-started.md) -- prerequisites, local run, Docker, tests

---

## Document Index

| # | Document | Description |
|---|----------|-------------|
| -- | [Architecture](architecture.md) | System diagram, component inventory, design decisions |
| -- | [Getting Started](getting-started.md) | Dev setup, local run, Docker, tests |
| -- | [Docs Guard](docs-guard.md) | How `.docs-map.yml` is enforced, the AGENTS.md line budget, escape hatches |
| -- | [Turn Openers](turn-openers.md) | How each reply starts (pause, filler, interim pieces), chosen by working memory and played under the timing rules |
| -- | [Thinking Fillers Perf Plan](thinking-fillers-perf-plan.md) | Proposal: measure, then 10x the thinking-filler on speed, cost, diversity, gap bridging, character and context fit |
| -- | [Text-Chat Roleplays](text-chat.md) | Running a roleplay typed both ways: what is shared with voice, what is switched off, the persona's texting guidance |
| -- | [Ally Guide Voice Worker](guide-voice-worker.md) | The guide's own worker (`app/guide_worker.py`): speech only, replies from ally-be, barge-in, push-to-talk, crisis pacing |
| -- | [AI Video Actor](video-actor.md) | EXPERIMENTAL, off everywhere: giving a character a lip-synced face, its two gates, providers and audio-only fallback |
| 01 | [Worker Lifecycle](01-worker-lifecycle.md) | AgentWorker 3-phase lifecycle, termination |
| 02 | [Graph Pipeline](02-graph-pipeline.md) | SimulationState, 6 graph nodes, parallel flow, report graph |
| 03 | [Event System](03-event-system.md) | EventOrchestrator, registry, scoring, eligibility |
| 04 | [Event Types Reference](04-event-types-reference.md) | All 9 event detection types |
| 05 | [TTS Providers](05-tts-providers.md) | BaseTTSClient, 5 providers, factory |
| 06 | [STT Providers](06-stt-providers.md) | BaseSTTClient, 3 providers, factory |
| 07 | [LLM Providers](07-llm-providers.md) | BaseLLMClient, 4 providers, open-source support |
| 09 | [Scenario Engine](09-scenario-engine.md) | Pydantic models, metadata parsing pipeline |
| 10 | [Branching Instructions](10-branching-instructions.md) | Variable substitution, dynamic resolution |
| 11 | [Queue Messaging](11-queue-messaging.md) | AWS SQS event delivery, LocalStack |
| 12 | [Prompts System](12-prompts-system.md) | Template loading, backend overrides, resolver |
| 13 | [Event Termination](13-event-termination.md) | Auto-termination configuration and flow |

### Extension Guides

| Guide | Description |
|-------|-------------|
| [Adding a TTS Provider](05-tts-providers.md) | See TTS providers doc for factory pattern |
| [Adding an Event Type](04-event-types-reference.md) | See event types reference for detection types |
| [Adding an LLM Provider](07-llm-providers.md) | See LLM providers doc for factory pattern |
