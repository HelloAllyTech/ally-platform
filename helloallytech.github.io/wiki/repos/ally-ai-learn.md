---
title: ally-ai-learn — Voice Training Agent
tags: [repo, ai, livekit, langgraph, voice, python]
summary: A LiveKit-based voice AI agent (FastAPI + LangGraph) that simulates mental-health client conversations, detecting counseling skills in real time, scoring them, and publishing events to ally-be via AWS SQS.
last_reconciled: 2026-09-03
---

# ally-ai-learn — Voice Training Agent

## Purpose

ally-ai-learn (internal package name `ally-learn-core`) is the voice-based training agent for the Ally platform. It simulates realistic client conversations for mental-health counselor training using LiveKit voice agents, then:

- Simulates a configurable client persona in a live voice session.
- Detects counseling events in real time — both positive skills and areas for improvement.
- Scores utterances and delivers immediate UI feedback over LiveKit data channels.
- Publishes all events to AWS SQS (`sqs-learn-message-and-event-queue`) for downstream processing in ally-be.
- Supports multiple TTS/STT/LLM providers, selectable per scenario via room metadata.

It runs one LiveKit voice worker (`app/worker.py`). A second runtime, Roleplay Studio v2 — an Actor+Director-driven studio for roleplays authored as a versioned Scenario Spec — was removed on 2026-08-31, after ally-web stopped calling its studio endpoints and ally-be removed them.

## Tech Stack

- **Python 3.12+** (`>=3.12,<3.14`), managed with **Poetry** (`package-mode = false`).
- **FastAPI** `^0.121` + **uvicorn** — health checks and REST API (scenario reports, voice preview).
- **LiveKit** — `livekit` 1.0.23, `livekit-api`, `livekit-agents` 1.3.12 (extras: deepgram, elevenlabs, openai, sarvam, google, turn-detector), plus noise-cancellation and Silero VAD plugins.
- **LangGraph** `^1.0.10` + `langgraph-checkpoint` — stateful conversation pipeline; integrated with LiveKit via `LLMAdapter` (`livekit-plugins-langchain`).
- **LLM**: OpenAI (default, `gpt-4o-mini`) via `langchain-openai`; also Google Gemini (`langchain-google-genai`), and OpenAI-compatible open-source backends (Ollama, vLLM). OpenAI is **always required** for embeddings and branching resolution regardless of the conversation LLM.
- **STT**: Deepgram (default), Google Cloud STT, Sarvam (Indian languages).
- **TTS**: ElevenLabs, Deepgram, Sarvam, Google Cloud TTS (Chirp 3 HD), Hume.
- **Embeddings**: OpenAI (`text-embedding-3-small`) for semantic-similarity event detection.
- **AWS**: `boto3` for SQS; LocalStack for local emulation.
- **Other**: `slack-sdk` (alerting), `pydub`, `numpy`, `stopwordsiso`/`advertools`.

## Architecture & Key Modules

The service is composed of a FastAPI app plus LiveKit agent workers. The core of a live session is a **LangGraph pipeline** driven by the worker.

**Entry points**
- `app/main.py` — FastAPI application: `GET /api/health`, `/api/v1` routers (scenario report, voice preview), CORS/middleware.
- `app/worker.py` — v1 `AgentWorker`; 3-phase session lifecycle (configure → initialize → start).

**Worker connection lifecycle and health signals**

A worker is only useful while it holds its long-lived WebSocket to LiveKit and stays registered under `AGENT_NAME`. Everything below exists because a fleet that has lost that registration looks, from every other angle, completely healthy.

- **Giving up is silent, and the default budget is short.** The agents SDK retries a lost connection with `min(n*2, 10)s` backoff up to `WorkerOptions(max_retry=...)`. On exhaustion it sets an internal `_connection_failed` flag, raises inside its own task, and **stops trying** — the process does not exit. The SDK default of 16 works out to only ~2.5 minutes, which is shorter than most planned maintenance on the LiveKit side. Treat `max_retry` as a liveness setting, not a tuning knob.
- **The container self-heal only triggers on process exit.** `start.sh` runs uvicorn and the worker side by side and tears the container down when *either* exits (`wait -n`), so the orchestrator restarts it. A worker that has given up but is still resident defeats this entirely.
- **Two HTTP surfaces, and only one is a health signal.** FastAPI's `GET /api/health` returns a static `ok` — it proves the HTTP process is up and nothing more. The agents SDK runs its *own* health server on a separate port that returns **503** when the worker has given up connecting or its inference process is dead, and serves `GET /worker` with `agent_name`, `active_jobs` and worker load. Container and orchestrator health checks must check the SDK's server; checking only the FastAPI endpoint is indistinguishable from checking nothing.
- **The active-session metric is not a liveness signal.** It is emitted from the SDK's `load_fnc` hook, which keeps running while the worker is disconnected, so it continues publishing at full rate throughout an outage. It is a demand signal for autoscaling — never alarm on it to detect a dead fleet.
- **Dispatch is by name.** A job only reaches a worker registered under the exact name the backend dispatches to. A name mismatch between backend and worker produces "the agent never joined", identical in appearance to a worker that is absent.
- **Graceful shutdown is time-budgeted.** When a session ends, cleanup tasks for background audio, video actors and other supervisor tasks must complete within a short timeout. If they stall, the `livekit.agents` process may be forcibly killed, preventing clean resource release. These timeouts in `app/worker.py` (`SUPERVISOR_NOTES_CLOSE_TIMEOUT`, `BG_AUDIO_CLOSE_TIMEOUT`, etc.) are tuned to balance between a graceful exit and preventing stalled processes from holding resources.
- **Mitigated (2026-08):** `app/core/worker_health.py` closes three of the gaps above directly. It wraps the SDK's `load_fnc` hook — the same one the active-session metric rides on — to also read the `AgentServer`'s registration state, so `GET /api/health` now reports real `registration_health()` (`registered` / `connecting` / `starting` / `connection_lost` / `worker_unreachable`) instead of a static `ok`. Its `WorkerHealthMonitor` turns a permanent connection loss into an actual process exit, so the container self-heal (`wait -n` in `start.sh`) has something to trigger on. The agents SDK's own health server and the `max_retry` liveness setting above are unchanged and still the first things to check.

**LangGraph conversation flow** (`app/core/graph/`)
- `graph_builder.py` — `build_simulation_graph()` (live voice) and `build_report_graph()` (text-only N-turn simulation for reports).
- `state.py` (`SimulationState`), `nodes.py`, `checkpointer.py`, `knowledge_retrieval.py`, `prompt.py`.
- The simulation graph runs event detection, behavior detection, and knowledge retrieval in parallel from start, converges at a sync point, resolves branching instructions, then generates the client response and sends UI feedback in parallel. Client text → TTS → audio.
- `resolve_branching_instruction` and `retrieve_knowledge` run as subgraphs so their internal LLM calls are not streamed to the user (workaround for LiveKit agents issue #2836).

**Text-chat roleplays** (`app/core/livekit/text_chat.py`, `docs/text-chat.md`)

A roleplay can also run typed both ways, for training staff on text-based helplines. It is the **same session with the audio pipeline taken out**, not a second engine: dispatch, room metadata, the graph above, events, guardrails, scoring, the SQS transcript and the `end-of-session` score are all shared, and nothing new holds state outside the worker job.

- **Switched by the envelope.** ally-be puts `interactionMode: "TEXT"` on the room-metadata `scenario` section for a text session and sends no key for a voice one; `Scenario.is_text_chat` reads it and only an explicit `TEXT` changes anything.
- **Transport is LiveKit text streams.** The learner's message arrives on `lk.chat` and the reply is published on `lk.transcription`, one stream per reply. The `AgentSession` has no STT, TTS, VAD or turn detector, and `user_away_timeout` is off because "away" is derived from voice activity.
- **Voice-only layers are skipped wholesale**: background audio (comfort tone, fillers, back-channel, interim reply), noise cancellation, the video actor, audio-tag guidance and the TTS-failure fallback. Pause is ignored — it gates audio I/O.
- **COHERENCE guardrails are dropped** (authored and platform-default): they repair mis-transcribed speech, and a typed message is what the learner meant.
- **Typed input queues instead of interrupting.** LiveKit's default text callback interrupts the agent first, which would cut a reply off half-written on screen; the text-chat callback lets a message that lands mid-reply wait its turn.
- **Persona style** comes from one appended prompt, `system/text_chat_guidance` (code `ally_ai_learn_system_text_chat_guidance`), which re-frames the call-oriented main prompt as texting. It is synced to ally-be like every prompt, so it can be edited in Prompt Management without a deploy.

**Real-time event / skill detection** (`app/core/events/`)
- `event_orchestrator/` — registry, scoring (`ScoreEvaluatorMixin`), delivery (`EventSender`).
- `factory.py` — `build_events_from_metadata()` builds `BaseEvent` instances by detection type.
- `event_types/` — 9 detection types: `SENTENCE_SIMILARITY`, `SEMANTIC_SIMILARITY`, `BINARY_CLASSIFIER`, `TIME`, `SCORE`, `COMBINATION`, `HELPER_UTTERANCE_LENGTH`, `HELPER_INTERRUPTED`, `HELPER_PARAPHRASED` (plus a guardrail type for boundary-violation detection).
- Events have **ACTIVE** visibility (UI feedback: emoji, message, score) or **PASSIVE** (analytics-only). Both are sent to SQS; only ACTIVE generate UI feedback.

**Scenario / persona handling** (`app/core/scenario/`)
- `base.py` — `Scenario.create()` parses backend room metadata into typed `Scenario`, `PromptData` (client persona), `ScenarioVoice`/`VoiceConfig`, `LanguageConfig`, `TerminationEvent`.
- `simulation_instructions.py` — `SimulationBehaviorInstruction` (SHOULD_DO / SHOULD_NOT_DO counselor behaviors) and `SimulationStateInstruction` (ordered agent states with score windows).
- `app/core/agent/factory.py` — `parse_room_metadata()`, provider client configuration, agent creation.

**Live supervisor notes** (`app/core/supervisor/`)
- A second, cheap LLM watching the same committed turns as the actor, which occasionally sends the learner a one-line coaching hint rendered in a **Supervisor** tab in the session sidebar. Opt-in per simulation (`promptData.supervisorNotesEnabled`, default off) behind the `SUPERVISOR_NOTES_ENABLED` global kill-switch, so it is a no-op for almost every session.
- **It can never delay a reply.** `on_learner_turn_committed` schedules a tracked task with a hard `SUPERVISOR_NOTES_TIMEOUT_S`. A slow or failing supervisor loses a note; it does not slow the voice path. Same reasoning as the deferred-naturalness setup — a session must keep running when an optional extra fails.
- **Sparsity is enforced in code, not the prompt.** An LLM asked whether it should speak will tend to say yes, so `SUPERVISOR_NOTES_MAX_PER_SESSION` (10), `SUPERVISOR_NOTES_MIN_TURN_GAP` (2), one call in flight at a time, and a re-check of both caps after the call returns are all applied around the model rather than inside it.
- **Delivery and persistence are separate paths.** Notes go to the browser on the `supervisor` data-channel topic *and* to ally-be as a `supervisor_note` SQS message. `seq` is 1-based per session; it is what makes the ally-be write idempotent, and it is the order the post-session debrief reads them in.
- Notes are written in the session language, from `scenario.language_code`. Prompt: `app/prompts/supervisor/live_note.txt`.
- Wired into `worker.py`, the repo's one voice worker.

**AI video actor** (`app/core/livekit/video_actor.py`, v1, experimental — publishes nothing today)

Optionally gives a character a face: a lip-synced video track published into the same room as its voice. It sits strictly after speech synthesis, on the output side, so nothing about transcription, the model turn, turn-taking or synthesis changes.

Three gates decide, and the two that matter default off — a per-admin toggle controlling who can even see the switch when authoring, the roleplay's own flag, and a platform-level switch that exists to stop video everywhere in one restart. No roleplay sets its flag, so every session is audio-only.

The care in it is about audio, not video. Turning the actor on means telling the session to stop publishing its own speech, because the avatar republishes it in sync with the picture — so a half-started avatar leaves the learner hearing nothing, which is worse than a missing face. Startup is therefore bounded and returns a handle rather than a flag, and only a live handle earns the suppression: a missing plugin, a slow vendor or any error mid-start all fall back to exactly the audio-only session the platform ships today, and the client is told nothing because there is nothing the learner should do about it.

Rendering is a vendor's job, reached through a swappable provider layer, and the default is a real one. A deployment that has not been given credentials falls back to audio-only rather than to the in-process placeholder that also lives here — a misconfiguration should cost the learner nothing, and a coloured blob is worse than no video. Providers are imported lazily, so an uninstalled one costs a log line rather than taking down every session including the ones with the feature off.

Two things about a hosted avatar are worth knowing before touching this. It joins the room as **its own participant**, which means every "is anyone still here?" check has to count people rather than participants — otherwise the avatar the agent commissioned reads as company, and an abandoned session holds a worker slot and a metered vendor conversation open until the duration cap. And it dials the media server **itself**, from the vendor's side, so it has to be handed the URL of the server this particular job's room lives on rather than the one the worker registered with — the same distinction the noise-cancellation gate draws, and the failure mode is silent: video simply never arrives.

**Latency masking & naturalness** (`app/core/livekit/`, v1)

Four levers ride one LiveKit `BackgroundAudioPlayer` — its own published track, so none of them can ever preempt or race the character's real reply: a faint comfort room tone, back-channels while the learner speaks, the thinking filler after they stop, and an optional interim reply. They exist because voice-to-voice latency is felt, not measured: the gap before a reply reads as a dropped call.

What the learner hears between finishing a turn and hearing the reply is decided by a **delivery plan**, and its design is mostly a set of answers to ways that audio can be worse than silence.

- **The character's state chooses it, not a separate generator.** In simulations that use client working memory, the same off-turn update that tracks the character's mood also plans how its next reply starts: which sound fits (a hesitant "um", a reflective "hmm", a breath, or a pause) and a few holding words — the *interim* — in the character's own voice, written as one to three short pieces that run on from each other. The plan is made after the character speaks and used on the next turn, so it adds nothing to the reply path. Simulations without working memory get a filler rotated by rule or a pause, plus, where enabled, a holding line written from the learner's partial transcript while they are still speaking. Either way there is one source of interim per simulation.
- **Fillers are fixed recordings, not generations.** A small per-language catalog, curated in native script and tagged by the state it fits, is rendered once per voice with several takes, so a repeated "hmm" is never the same recording twice and nothing is generated while the learner waits.
- **Code decides when, by a timing rule.** It predicts the wait from the session's own recent latency, then: a pause first (a longer one when the plan says a pause fits the moment); at most one filler, chosen from the plan's own suggestions; then the interim piece by piece, with each gap a little longer than the last, the way someone thinking aloud slows down. A piece plays only if it ends a beat before the reply is expected, and speech never fills the whole wait. A short wait gets nothing, a long one a filler and two or three pieces.
- **It never talks over the learner** — nothing plays when their last words read as unfinished or they are saying goodbye, and any learner speech cancels it — **and the real reply cuts whatever is still playing.**
- **The reply carries on from it.** The reply is told what sound played and the interim's exact words, and continues from them as one thought rather than starting a fresh one; a restatement is trimmed from the spoken stream.

Three constraints shape all of this. **The interim must never contradict the reply that follows it**, so it is checked in code as well as by the prompt: short pieces only, no questions, no numbers, nothing that replays the character's recent lines, and no opening claim of understanding. **Clip rendering never runs on the session's own speech engine** — a run of synthesis errors there closes the whole session, which has taken live sessions down before. And **a clip must be heard in the same voice as the reply**: clips are rendered on the reply's own voice, model and settings, and a voice that cannot be held to one speaker across separate renders gets only the bundled breath recording.

Because a filler counts as the character's first words, it is what response latency is measured to. Each turn therefore records which audio the learner actually heard first and the unmasked time to the real reply alongside it, so a rise in filler coverage can never be read as a latency improvement. Per-turn records also carry why a filler did or did not play, how long it took to become audible, and how much silence followed it.

The same ambiguity reaches the transcript, and is resolved the same way. A filler and an interim reply are spoken by the character and are persisted as ordinary client messages — same sender, same table — so each transcript line the worker publishes now declares which kind of utterance it is: the real reply, a filler, or an interim. Anything downstream that counts or judges client turns has to exclude the latter two, or a contentless "Hmm" is scored as a turn of roleplay and inflates the denominator under every quality rate. The marker is written by the live worker only, so its absence means *unknown* rather than *reply*, and lines recorded before it existed are read as replies — which is right for a corpus that predates the feature.

Everything here is best-effort by construction: any failure loses that layer for the session and nothing else. The expensive setup work is deliberately kept off the opening-statement path.

**Provider layer** (factory pattern) — `app/tts/`, `app/stt/`, `app/llms/`, each with `base.py`, `factory.py`, and per-provider implementations. Selection is driven by scenario metadata with env-based fallbacks.

**Scoring & reports**
- `app/core/scoring/score_keeper.py` — `ScoreKeeper` tracks behavior-instruction scores.
- `app/core/scenario_report/` — N-turn text simulation and report generation with webhook delivery back to ally-be.

**Prompts** (`app/prompts/`) — `manager.py` (template loading), `resolver.py` (backend override resolution via `promptData.prompts`); role subdirectories for director, counselor, trainee, judge, actor, events, etc.

## Integration Points

- **ally-be → ally-ai-learn (inbound)**: ally-be dispatches LiveKit sessions and calls this service's REST API with an `x-api-key` header. `X_API_KEY` must match ally-be's `AI_LEARN_SERVICE_OUTBOUND_API_KEY`. Scenario configuration (persona, events, voice, STT/LLM) is passed as **LiveKit room metadata**.
- **ally-ai-learn → ally-be (outbound REST)**: uses `CORE_SERVICE_BASE_URL` + `CORE_SERVICE_API_KEY` (must match ally-be's `AI_SERVICE_API_KEY`), e.g. prompt sync (`scripts/sync_prompts.py`, run at deploy) and scenario-report webhook delivery.
- **AWS SQS**: all triggered events are published to `sqs-learn-message-and-event-queue` (`SQS_MESSAGE_EVENT_QUEUE_NAME`) via `app/core/queue/sqs.py` (`SQSQueue`, async through `asyncio.to_thread`). Message schema `CoreEventMessageType` (`message_type: event`, `room_id`, serialized `event_data`, timestamp).
- **Deferred termination**: auto-termination events are held (`EventSender.deferred_termination_event`) until the agent finishes speaking the termination message, then sent to SQS with `autoTerminationStatus=true` in the shutdown callback — so ally-be doesn't close the room prematurely.
- **LiveKit**: WebRTC audio to/from LiveKit rooms; UI event feedback is sent over LiveKit **data channels** (not SQS), schema `CustomUIEventMessageType`.

## Local Setup

Prerequisites: Python 3.12+, Poetry, LiveKit credentials, OpenAI API key (always required), AWS creds or LocalStack, and at least one TTS key (Deepgram is the default).

```bash
git clone <repository-url>
cd ally-learn-core
poetry install
cp env_sample .env      # then fill in credentials
```

Required env: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SQS_MESSAGE_EVENT_QUEUE_NAME`. Also `CORE_SERVICE_BASE_URL`/`CORE_SERVICE_API_KEY` and `X_API_KEY` for ally-be integration.

**Run — two terminals:**
```bash
# Terminal 1 — LiveKit worker
poetry run python -m app.worker dev

# Terminal 2 — FastAPI server
poetry run uvicorn app.main:app --reload --port 8000
```

**Run — startup script** (starts uvicorn and the voice worker in parallel; if either exits the container stops, so the orchestrator restarts it):
```bash
./start.sh
```

**Docker:**
```bash
docker build -t ally-learn-core .
docker run -p 8000:8000 --env-file .env ally-learn-core   # runs FastAPI + worker together
```

**LocalStack (emulated SQS):**
```bash
docker-compose up -d       # LocalStack on :4566 (SES, S3, Lambda, CloudWatch Logs, SQS)
```
Set `AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`, `AWS_ENDPOINT_URL=http://localhost:4566`.

**Full dev stack** (app + LocalStack, app exposed on host port `8002` to avoid clashing with other Ally services):
```bash
docker compose -f docker-compose.full.yml up --build
```

**Alongside ally-be / ally-web** (reuses ally-be's LocalStack):
```bash
docker compose -f docker-compose.local.yml up -d
```

**Health check:** `curl http://localhost:8000/api/health`

## Testing & Code Quality

- **pytest** (`^8.0`) with `pytest-asyncio`, `pytest-cov`, `pytest-mock`, `pytest-xdist`. Config in `pytest.ini`; tests under `tests/unit/` and `tests/integration/`. Markers: `unit`, `integration`, `slow`, `external`, `livekit`, `auth`, `database`.
- **`run_tests.sh`** wraps common flows: `./run_tests.sh unit | integration | all | coverage | parallel | smoke | marker <name> | specific <file>`. Coverage target is `--cov-fail-under=80`.
- Direct commands: `poetry run pytest`, `poetry run pytest tests/unit/`, `poetry run pytest --cov=app`.
- **Formatting/linting**: Black (line length 88, `py312`), isort (black profile), flake8 (`.flake8`). Enforced via `.pre-commit-config.yaml`.

## Key Documentation

- `README.md` — full overview, provider configuration, scenario metadata schema, troubleshooting.
- `docs/readme.md` — documentation index and reading paths.
- `docs/architecture.md` — system diagram, component inventory, factory pattern, design decisions.
- `docs/getting-started.md` — local setup, Docker, LocalStack, tests.
- `docs/LOCAL_DEV.md` — running alongside ally-be and ally-web.
- `docs/01-worker-lifecycle.md` — `AgentWorker` 3-phase lifecycle and termination.
- `docs/02-graph-pipeline.md` — `SimulationState`, the 6-node graph, parallel flow, report graph.
- `docs/03-event-system.md` — orchestrator, registry, scoring, eligibility.
- `docs/04-event-types-reference.md` — reference card for all 9 detection types.
- `docs/05-tts-providers.md`, `docs/06-stt-providers.md`, `docs/07-llm-providers.md` — provider factories and per-provider config.
- `docs/09-scenario-engine.md` — Pydantic scenario models and metadata parsing pipeline.
- `docs/10-branching-instructions.md` — conditional conversation flow, variable substitution.
- `docs/11-queue-messaging.md` — SQS event delivery, message schemas, deferred termination, LocalStack.
- `docs/12-prompts-system.md` — template loading and backend override resolution.
- `docs/13-event-termination.md` — auto-termination configuration and flow.
- `docs/text-chat.md` — text-chat roleplays: what is shared with voice, what is switched off, the persona's texting guidance.
- `docs/events-off-gate-design.md` — event gating design notes.
- `CONTRIBUTING.md`, `tests/README.md`, `.github/RELEASE_GUIDE.md` — contribution, test, and release guides.

---

*Part of the [Ally Platform](../platform/overview.md). See also: [Architecture](../platform/architecture.md), [ally-be](ally-be.md), [ally-ai](ally-ai.md).*
