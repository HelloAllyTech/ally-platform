---
title: ally-ai — AI Copilot Service
tags: [repo, ai, fastapi, weaviate, python]
summary: ally-ai (internally "Lifeline AI") is the FastAPI AI copilot service that provides conversation analysis, summaries, transcription, drift/language-quality scoring, and Weaviate-backed semantic search for the Ally counselor-training platform.
last_reconciled: 2026-09-03
---

# ally-ai — AI Copilot Service

## Purpose

ally-ai is the AI service that acts as a copilot for mental health counselors. It delivers intelligent insights over counseling conversations: conversation analysis and nudges, session summaries, audio transcription, response-drift and language-quality scoring, and semantic search over reference documents. The service is HIPAA-conscious (PHI logging, optional CloudWatch audit logging) and is built with FastAPI, managed with Poetry, and backed by the Weaviate vector database. The repository is internally named "Lifeline AI".

## Tech Stack

From `pyproject.toml` (package `lifeline-ai`, MIT license):

- **Python** `^3.12`
- **Web framework**: FastAPI `^0.115.8` + Uvicorn `^0.34.0`, `pydantic-settings` for config
- **LLM / orchestration**: `langchain-openai` `^1.1.12`, `langchain-google-genai` `^4.2.0`, `google-genai` `^1.0.0`
- **Vector DB**: `weaviate-client` `^4.11.0`
- **Speech-to-text**: `deepgram-sdk` `^4.7.0`, `sarvamai` `^0.1.0`, plus OpenAI transcription (providers: `openai`, `deepgram`, `sarvam`)
- **Audio**: `ffmpeg-python`
- **NLP / analysis**: `numpy`, `scikit-learn`, `vadersentiment` (sentiment), `rapidfuzz` (fuzzy matching)
- **AWS**: `boto3` (SQS + S3)
- **Alerts / HTTP**: `slack-sdk`, `httpx`
- **Observability**: LangSmith tracing (env-configured)
- **Dev tooling**: `black` (line-length 88, py312), `isort` (black profile), `flake8`, `pre-commit`, `pytest` + `pytest-asyncio` / `pytest-mock` / `pytest-cov` / `pytest-xdist`

## Architecture & Key Modules

The app is a FastAPI application (`app/main.py`) whose lifespan initializes the Weaviate client, the ally-core HTTP client, and OpenAI clients. Routers are mounted under an API prefix and a v1 prefix (`app/api/v1/api.py`).

**HTTP API endpoints** (`app/api/v1/endpoints/`):

- `/conversation` — conversation analysis
- `/summary` — session summaries
- `/reference-documents` — reference document semantic search / management
- `/drift` — response-drift scoring
- `/language-quality` — language quality scoring
- `/filler-quality` — judges the *thinking fillers* a voice session played: the short back-channels the AI client utters the instant the learner stops speaking, while its real reply is still forming. Speed was already measured per turn in ally-ai-learn; quality was not, and the gap is not neutral — because the filler is the character's first words, response latency is measured to it, so a filler that arrives instantly but sounds nothing like the character (or answers the turn before last) makes the roleplay worse while improving every latency chart. Findings sit on three dimensions: `character_fit`, `context_fit`, and `safety` — the last covering a filler that commits to something the real reply, generated separately and afterwards, may contradict a second later.
- `/feedback-groundedness` — judges each post-session feedback claim against the transcript (`supported` / `unsupported` / `contradicted` / `misattributed`), plus whether a quoted span is actually in the transcript. Claims arrive already split by ally-be, one verdict per claim: a `contradicted` improvement is the harmful case — the learner marked down for work the transcript shows them doing — and separating it from an unearned compliment is only possible per claim.
- `/round-trip-wer` — round-trip word error rate for transcription quality
- `/analytics-agent` — two stateless transforms behind the admin Analytics Agent tab: `/plan` (question + schema catalogue → one read-only SELECT, or a clarifying question) and `/answer` (result rows → prose, caveats and a chart specification). No database access; ally-be runs the query. See [Analytics Agent](../platform/analytics-agent.md).
- `/knowledge-chunks` — write and read side of a corpus's chunk collection (`corpus` query parameter selects it; defaults to `whatsapp_qa` for the deploy window, since ally-ai ships before ally-be): `bulk-upsert` (per-object success/failure so ally-be can retry only what failed), `search`, `document/{id}` (delete by document), `document/{id}/audience` (retarget an indexed document at organisations, in place), `ids` (paged, for reconciliation), and `{chunk_id}`.
- `/knowledge-agent` — the bot's answering loop. `/answer` returns one of three intents — `answer` (grounded, with citations), `decline` (the corpus does not cover it) or `clarify` (too vague to retrieve against) — **all as HTTP 200**, because a decline is a correct result and only a genuine failure should push ally-be onto its fallback path. `/crisis-check` is separate rather than a stage inside `/answer`, so ally-be can run the two concurrently and the safety net costs no latency on an ordinary question. `/answer` REQUIRES an `audience` (which organisation is asking) and 422s without one — see the `KnowledgeChunk` notes below for why it has no default.
- `/helpline` — the text helpline's copilot, called by ally-be on talker messages; everything it returns is shown to the **listener only**, never to the anonymous talker. `/risk` classifies a talker's message with up to four turns of context (`is_crisis`, `confidence`, a verbatim `signal`, and `subject` — the talker or someone they know), biased towards false positives and covering indirect phrasing, Hinglish and Indic scripts; ally-be applies the org's confidence threshold, not ally-ai. `/turn` drafts two or three replies for the listener, each tagged with the helping skill it uses, plus a stage and an optional coaching nudge; when ally-be says the chat is flagged for risk, the first draft must ask directly about safety. A post-generation filter (`app/core/helpline/safety.py`) drops drafts that promise unconditional confidentiality, diagnose, or name doses or recommend medication — but lets a safety question name the talker's own means, because asking about means is the question that matters most. Both answer HTTP 200 with `failed: true` on any error, and the signal phrase goes only to the PHI audit logger.

**Core business logic** (`app/core/`):

- `conversations/` — `conversation_service.py`, conversation analysis
- `summaries/` — `summary_service.py`, session summarization. The roleplay debrief (`generate_scenario_evaluation`) writes the learner-facing `supervisor_note` in Ally's supervisor voice, and takes two kinds of extra context: `supervisor_memory` (what the supervisor carries about this learner between debriefs) and `live_notes` (the coaching hints already shown to the learner *during* the session, when that roleplay had live supervisor notes on). `live_notes` lets the note pick up a thread the learner already read rather than deliver it cold; the empty case is rendered as an explicit sentence rather than a blank, because a blank there makes the model invent advice it never gave. The prompt's honesty rule follows from the same distinction — with live notes the supervisor really was reading along, so "I saw" and "I flagged at the time" are allowed, while "I heard" never is: it does not listen to audio. The request also takes an optional `scenario_session_id` (and `room_id`), which ally-be sends so that the `llm_usage` rows the debrief emits are attributed to the session they debrief — that is what lets the admin console cost a roleplay session end to end, debrief included. Omitting both behaves exactly as before. An optional `usage_task` (`scenario_evaluation` or `scenario_evaluation_language`) names the `llm_usage` label the call is filed under: ally-be sends `scenario_evaluation_language` when it re-runs the debrief to produce it in a viewer's other language, so that re-run's cost is visible on its own. It only files the cost — null or any other value falls back to `scenario_evaluation` rather than failing the learner's debrief.
- `transcriptions/` — audio transcription services with pluggable providers (`DeepgramTranscriptionService`, `OpenAITranscriptionService`, `SarvamTranscriptionService`)
- `embeddings/` — OpenAI embedding client/service for vectorization
- `vector_db/` — Weaviate client (`weaviate_client.py`) and collection helpers
- `reference_documents/` — reference document retrieval (distance-threshold based)
- `knowledge_base/` — chunk read/write service for ONE corpus, bound to its collection at construction (`corpus.py` maps corpus to collection); one cached instance per corpus
- `knowledge_agent/` — the bot's agent: detect language → translate to English → embed → retrieve → answer, decline or clarify, plus the crisis classifier. Citations are returned as integers indexing the numbered passages and validated in code, out-of-range values dropped: a model asked to echo a UUID will eventually invent a plausible one, and a fabricated id cannot be detected whereas an out-of-range integer can.
- `llm/` — `dispatch.py`, one `generate_structured` call across providers. Gemini uses `response_schema`; Anthropic has no equivalent, so structured output goes through a single forced tool call.
- `drift/`, `language_quality/`, `round_trip/`, `feedback_groundedness/`, `filler_quality/` — LLM-judge modules (each with `judge.py`, `prompt.py`, `schemas.py`; `round_trip` also has `wer.py`). Every one of them emits ONLY labels, booleans and counts — never a score, rate or rating. Rates, severity weights and correlations are computed by ally-be in SQL at read time, so re-weighting a metric never means re-judging the corpus. Each judge request also takes an optional `scenario_session_id`; it changes nothing about the judgment and is carried only onto the call's `llm_usage` row, so judge spend can be tied to the session it was spent on.
- `analytics_agent/` — the analytics agent's planner and narrator (`agent.py`, `prompt.py`, `schemas.py`). The schema catalogue arrives on the request from ally-be rather than being defined here, so the tables the model is shown and the tables the guard permits cannot drift apart.
- `text_generations/` — OpenAI text-generation client/service and structured-output models
- `storage/` — `s3_service.py` for S3 access
- `queue/` — SQS clients, message models, processors, and the transcription request worker (see Integration Points)
- `ally_core/` — HTTP client/service for calling the ally-be backend
- `llm_usage/`, `execution_manager.py`, `drift`, `round_trip` — supporting services. The `llm_usage` message ally-be prices carries `completion_tokens` as every token billed at the output rate (Gemini's thinking tokens folded in), an optional `cached_tokens` that is a *subset* of `prompt_tokens` for OpenAI and Gemini rather than an addition to it, and an optional `metadata` breakdown (e.g. `thoughts_tokens`) that is informational only.
- `phi_events.py`, `phi_logger.py` — PHI-aware event logging for HIPAA handling

**Prompts** (`app/prompts/`): file-based templates organized by concern — `analysis`, `audio`, `notes`, `nudge`, `scenario`, `simulation`, `summary`, `tags`, `user`, `shared` — with a `manager.py` and `resolver.py`. Prompts are synced to the backend (see Makefile / Local Setup).

**Schemas** (`app/schemas/`): Pydantic models — `common.py` (e.g. `ChatMessage`), `conversation.py`, `summary.py`, `reference_document.py`, `health.py`.

## Integration Points

**ally-be (ally-core) via REST** — `app/core/ally_core/` wraps an `httpx.AsyncClient` pointed at `ALLY_CORE__ENDPOINT` (default `http://localhost:8001`), authenticated with `x-api-key`. Observed calls include:
- `GET /api/v1/prompts/by-codes` — fetch current prompt text by code (used by the drift judge to source its rubric)
- `process_transcript` — pushes processed transcript results back to the backend

**SQS queues (AWS, LocalStack for local)** — configured via `QUEUE__*` env vars:
- `QUEUE__TRANSCRIPTION_RESULTS_QUEUE_URL` (`TRANSCRIPTION_RESULTS_QUEUE`)
- `QUEUE__TRANSCRIBE_AND_SUMMARIZE_RESPONSE_QUEUE_URL` (`TRANSCRIBE_AND_SUMMARIZE_RESPONSE_QUEUE`)
- `QUEUE__TRANSCRIBE_AND_SUMMARIZE_RESULTS_QUEUE_URL`

A dedicated worker `app/core/queue/transcription_request_sqs_worker.py` consumes transcription requests and runs the transcribe/summarize pipeline (`transcription_request_handler.py`, message models in `message_models.py`). This aligns with the platform's `sqs-ai-transcription-request-queue` / `sqs-ai-transcription-response-queue` flow between ally-be and ally-ai.

**S3** — `app/core/storage/s3_service.py`; results bucket set via `QUEUE__TRANSCRIBE_AND_SUMMARIZE_RESULTS_BUCKET`.

**Weaviate** — vector storage/search for embeddings and reference documents; schema managed by migrations (`app/migrations/`, `MigrationHistory` collection). Reference document matching uses `REFERENCE_DOCS__DISTANCE_THRESHOLD` (default `0.35`).

**One collection per knowledge corpus, not one collection with a scope argument.** `KnowledgeChunk` (migration `004`) backs the WhatsApp Q&A bot; `CharacterChunk` (migration `005`) backs the Character Library interview agent. Both are built from `KnowledgeChunkProperties` verbatim — a passage is the same shape whatever it grounds, so the citation chain is identical and deliberately not re-invented. Callers pass a `corpus` (`whatsapp_qa` / `character_library`, matching `kb_documents.corpus` in ally-be) which resolves to a collection in `app/core/knowledge_base/corpus.py`.

A `corpus` PROPERTY on one shared collection was considered and rejected for three reasons:

- **A similarity threshold only means something against one distribution.** Chunk size is chosen per corpus in ally-be — 400 tokens for a 1600-character WhatsApp reply, 800 for a character vignette that must hold a whole observation together — and a longer passage embeds more diffusely. One index holding both sizes leaves one threshold straddling two distributions.
- **Filtered ANN search is weaker than unfiltered.** HNSW traverses a graph built over every vector in the collection, so scoping by a low-selectivity filter costs recall or degrades to a scan.
- **A scope passed as an argument can be forgotten; a collection cannot.** An omitted filter would ground a health worker's clinical answer in material written for a fictional character — which reads as good clinical prose and is not an answer to their question.

`document_ids` still exists on a search, but it scopes WITHIN one corpus (ally-be's curator topic boost: search the mapped documents first, top up from the rest). It is a real engine-side PRE-filter — it was once applied after the search over an over-fetched window, which cannot narrow a ranking but starves it, since the engine ranks the whole collection and the best allowed passage routinely sits outside the global top-k. An empty allow-list returns nothing rather than widening.

Three things about these collections differ from the older ones and are deliberate:

- **The object UUID is `kb_document_chunks.id` in ally-be.** Postgres is the system of record; this index is derived.
- **It stores the chunk `text`**, unlike `RoadmapOpportunity`. The retrieve→generate loop runs inside ally-ai in one call, so without the text every question would need a back-call to ally-be. Staleness is closed structurally instead: chunk text is immutable for a given `(document_id, chunk_version, chunk_index)`, so an edit writes new objects and deletes the old ones rather than mutating in place.
- **Retrieval is scoped to an ORGANISATION by a filter, not by a collection** — `is_global` and `tenant_ids` (migration `006`), mirrored from ally-be's `kb_documents.is_global` and `kb_document_tenants`. That is deliberately the opposite choice from `corpus`, and the two are different because the things are different. A corpus is one of a few fixed, disjoint sets with its own chunk size and its own thresholds, so a collection each costs nothing and buys the points above. An organisation is one of hundreds, and the same clinical guide is shared by many of them — a collection per organisation does not survive one document belonging to three, and duplicating it per organisation would multiply the embedding bill and the number of places a correction has to land.

  So the older rule this file used to state — that a per-tenant corpus should also be a NEW collection, because "retrieval that forgets a filter leaks, and an un-set filter is the easiest thing in the world to forget" — is answered structurally instead. The three mechanics below are that answer, and the recall cost of a filtered traversal is the accepted price of it.

Three things make the audience filter hard to get wrong, and they are worth knowing before touching either service:

- **The filter is applied INSIDE the vector query**, as a disjunction (`is_global == true OR tenant_ids contains mine`), never to its results. A post-filter over a fixed top-k starves recall rather than restricting it: an organisation with five documents among ten thousand global chunks would retrieve none of them, and the bot would report that as "my reference material does not cover that". (This is the same failure `document_ids` had before it became a real pre-filter.)
- **The audience cannot be omitted.** `KnowledgeChunkService.search` and the answering agent both take a REQUIRED audience argument; searching the whole corpus means naming `ChunkAudience.unrestricted()`, an audience that can match nothing returns nothing rather than everything, and a chunk indexed with no audience reaches nobody rather than everybody. `POST /knowledge-agent/answer` refuses a request with no `audience` with a 422 — there is no default, because both plausible defaults are silently wrong.
- **Audience is the one MUTABLE chunk property.** `PUT /knowledge-chunks/document/{id}/audience` rewrites it in place on the existing objects. Re-chunking instead would re-embed every passage to change a boolean and, because a re-chunk bumps `chunk_version`, would orphan the citations already recorded in ally-be's conversation log.

`CharacterChunk` inherits `is_global`/`tenant_ids` from the shared property list and leaves them at their closed defaults, because nothing writes an audience for that corpus — so its retrieval must name `ChunkAudience.unrestricted()`. Written down on the properties themselves, because the alternative is a corpus that silently retrieves nothing the day someone switches it to `global_only()`.

Migration `006` backfills existing objects to `is_global = true`. That is not a guess about intent: every object already in the collection was indexed while the corpus was global to everyone, and a property added later reads back as null, which satisfies neither half of the filter — without the backfill, shipping the filter would take the whole live corpus out of retrieval at once. ally-be's matching migration makes the same statement about its rows, so the two stores agree without either reading the other.

Which organisation is asking is ally-be's decision, not this service's: it resolves the WhatsApp sender's number against an admin's phone→organisation mapping first and `users.phone` second, and refuses to answer a contact it cannot resolve. See ally-be's `DATA_SCHEMA.md` §3.11.

Retrieval on the WhatsApp path uses two thresholds, not one: `MIN_SIMILARITY` (0.35) is a permissive floor and `DECLINE_SIMILARITY` (0.42) is the actual decision. A relevant passage matched against a short paraphrased question scores roughly 0.40–0.60 with `text-embedding-3-small`, so a single hard floor at the decision value would decline constantly on legitimate rephrasings.

**Slack** — optional alerting (`SLACK_ALERTS__*`).

## Local Setup

```bash
# Install dependencies (dev included)
poetry install            # or: make install

# Start Weaviate locally
docker-compose up -d

# Configure environment
cp env_sample .env        # edit values

# Run Weaviate schema migrations
poetry run python scripts/migrate.py all    # or: make migrate

# Start the API (http://localhost:8000, docs at /docs)
poetry run python app/main.py
```

Migration helpers: `scripts/migrate.py status | history | up | down | all | generate "<name>"`. Sync prompts to the backend with `poetry run python scripts/sync_prompts.py` (or `make sync-prompts`).

**Full local stack** (API + Weaviate + LocalStack SQS/S3) via `docker-compose.full.yml`:

```bash
docker compose -f docker-compose.full.yml up --build
```

- API exposed on `http://localhost:8001`; Weaviate on `8080`/`50051` (image `semitechnologies/weaviate:1.28.3`); LocalStack on `4566`.
- The app container runs `bootstrap_localstack.sh`, then migrations, then prompt sync, then starts both the API (`app.main`) and the transcription SQS worker (`app.core.queue.transcription_request_sqs_worker`).
- `scripts/bootstrap_localstack.sh` waits for LocalStack, creates the required queues and the results S3 bucket. Tear down with `docker compose -f docker-compose.full.yml down` (volumes persist).

## Testing & Code Quality

```bash
poetry run pytest                                   # or: make test  (pytest tests/ -v)
poetry run pytest --cov=app --cov-report=term-missing --cov-report=html
poetry run pytest tests/utils/ -v                   # utility unit tests
```

- Pytest config in `tests/pytest.ini` with `asyncio_mode = auto`; shared fixtures in `tests/conftest.py`. Unit tests focus on utility calculators (affirmation counter, positivity-lift, reflective-listening, interruption, silence, WER, etc.).
- Formatting/linting: `poetry run black app/`, `poetry run isort app/`, `poetry run flake8 app/` (config in `.flake8`, `pyproject.toml`).
- Pre-commit hooks: `pre-commit install` / `pre-commit run --all-files` (config in `.pre-commit-config.yaml`; secret scanning via `.gitleaks.toml`).

Makefile targets: `install`, `test`, `migrate`, `sync-prompts`.

## Key Documentation

- `README.md` — primary guide: overview, prerequisites, quick start, dev setup, Weaviate migration system, Docker/compose, full local stack, API docs endpoints (`/docs`, `/redoc`, `/openapi.json`), and project structure.
- `CONTRIBUTING.md` — Git conventions: branch naming, conventional commit/PR format, code review process.
- `tests/TESTING_SETUP.md` — test suite layout, coverage of utility calculators, running/coverage commands, fixtures, troubleshooting.
- `app/core/transcriptions/readme.md` — notes the transcription SQS worker (stub heading only).
- `.github/RELEASE_GUIDE.md` — release process guide.
- `.github/pull_request_template.md` — PR template.

---

*Part of the [Ally Platform](../platform/overview.md). See also: [Architecture](../platform/architecture.md), [ally-be](ally-be.md), [ally-ai-learn](ally-ai-learn.md).*
