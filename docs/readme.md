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
3. Step-by-step guide: [Adding a TTS Provider](guides/adding-a-tts-provider.md) | [Adding an LLM Provider](guides/adding-an-llm-provider.md)

### "I want to add a new event type"

1. [Event System](03-event-system.md) -- how the orchestrator works
2. [Event Types Reference](04-event-types-reference.md) -- existing types for reference
3. [Adding an Event Type](guides/adding-an-event-type.md) -- step-by-step guide

### "I want to understand scenario configuration"

1. [Scenario Engine](09-scenario-engine.md) -- Pydantic models and metadata parsing
2. [Branching Instructions](10-branching-instructions.md) -- conditional conversation flow
3. [Scenario Metadata Schema](guides/scenario-metadata-schema.md) -- full JSON schema reference

### "I want to set up a dev environment"

1. [Getting Started](getting-started.md) -- prerequisites, local run, Docker, tests

---

## Document Index

| # | Document | Description |
|---|----------|-------------|
| -- | [Architecture](architecture.md) | System diagram, component inventory, design decisions |
| -- | [Getting Started](getting-started.md) | Dev setup, local run, Docker, tests |
| 01 | [Worker Lifecycle](01-worker-lifecycle.md) | AgentWorker 3-phase lifecycle, termination |
| 02 | [Graph Pipeline](02-graph-pipeline.md) | SimulationState, 4 graph nodes, data flow |
| 03 | [Event System](03-event-system.md) | EventOrchestrator, registry, scoring, eligibility |
| 04 | [Event Types Reference](04-event-types-reference.md) | All 9 event detection types |
| 05 | [TTS Providers](05-tts-providers.md) | BaseTTSClient, 5 providers, factory |
| 06 | [STT Providers](06-stt-providers.md) | BaseSTTClient, 3 providers, factory |
| 07 | [LLM Providers](07-llm-providers.md) | BaseLLMClient, 4 providers, open-source support |
| 08 | [Speech Prosody](08-speech-prosody.md) | Voice expression parameters and text enhancement |
| 09 | [Scenario Engine](09-scenario-engine.md) | Pydantic models, metadata parsing pipeline |
| 10 | [Branching Instructions](10-branching-instructions.md) | Variable substitution, dynamic resolution |
| 11 | [Queue Messaging](11-queue-messaging.md) | AWS SQS event delivery, LocalStack |

### Extension Guides

| Guide | Description |
|-------|-------------|
| [Adding a TTS Provider](guides/adding-a-tts-provider.md) | Step-by-step walkthrough |
| [Adding an Event Type](guides/adding-an-event-type.md) | Step-by-step walkthrough |
| [Adding an LLM Provider](guides/adding-an-llm-provider.md) | Step-by-step walkthrough |
| [Scenario Metadata Schema](guides/scenario-metadata-schema.md) | Full annotated JSON schema |
