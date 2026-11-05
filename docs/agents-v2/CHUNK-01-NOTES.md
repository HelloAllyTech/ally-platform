# Chunk 01 notes: LangGraph runtime with parity

Branch `feat/agents-v2-chunk-01-langgraph-runtime` · Repo: ally-ai only.

## 1. Code map: what exists today (read before building)

All paths are under `ally-ai/`.

### The pipeline: real function names

`app/core/knowledge_agent/agent.py`, class `KnowledgeAgentService`. It is built once by `app/core/dependencies.py::get_knowledge_agent_service` (lru-cached) on top of `KnowledgeChunkService(KbCorpus.WHATSAPP_QA)`.

| Step | Real code |
|---|---|
| Translate | `prepare_query(question, prompts=)` returns `(search_text, language, translated_query, degraded)`. Prompt `knowledge/translate_query` (`prompt.py::build_translate_prompt`), then `generate_structured(schema=TranslatedQuery, task=WHATSAPP_QUERY_TRANSLATE)`. Model is the `prompts` override, else `settings.KNOWLEDGE_AGENT.TRANSLATE_MODEL`. On any failure it searches the original text and sets `degraded=True`. Skipped when `translate_query=false`. |
| Search | Inline in `answer()`: `self.chunk_service.search(query, limit=top_k, min_similarity=, document_ids=, audience=)` (`app/core/knowledge_base/knowledge_chunk_service.py`), timed with `time.monotonic()`. |
| Gate | Inline in `answer()`. `general = answer_mode == "documents_and_general"`. It declines when `not general and (not hits or top_similarity < decline_similarity)`. The reason is `TRANSLATION_FAILED` if translation degraded, else `NO_HITS` or `BELOW_THRESHOLD`. No model call. |
| Select | `_select_passages(hits, band=, max_passages=, max_context_tokens=)` (staticmethod). The input is `hits` only when the top score is at or above `decline_similarity`, else `[]`. So general mode below threshold reaches the model with no passages. |
| Write | Inline in `answer()`: `get_backend_llm_overrides(path, prompts)`, then `build_answer_prompt(question, passages=, history=, max_chars=, prompts=, persona=, general=)` (persona block prepended by `format_persona`), then `generate_structured(schema=KnowledgeAnswer, task=WHATSAPP_RAG_ANSWER)`. An empty template raises `LLMInvocationFailedException`. |
| Check | `_resolve_citations(numbers, passages)` drops out-of-range numbers and duplicates. `intent=answer` with empty text becomes `decline` (`MODEL_DECLINED`). `decline` and `clarify` carry no citations. `answer` with no citations sets `retrieval.unsupported = True`. |
| Side effect | `_report_retrieval` → `app/core/retrieval_log/emitter.py::emit_retrieval_log` is a fire-and-forget SQS send to ally-be's retrieval log. It fires **exactly once per request**: at the gate with `declined_*`, or with `answered` just before the write call. |

`classify_crisis` (`/knowledge-agent/crisis-check`) lives in the same class. Chunk 1 leaves it alone.

### `/knowledge-agent/answer`: request and response

Route: **`POST /api/v1/knowledge-agent/answer`** (`app/api/v1/endpoints/knowledge_agent.py`). Models are in `app/schemas/knowledge_agent.py`.

Request `KnowledgeAnswerRequest`:

| Field | Type / default |
|---|---|
| `question` | str, required, min length 1 |
| `history` | `[{role, content}]`, default `[]` |
| `prompts` | dict or null. ally-be's Skills Store entries keyed by prompt code: `{prompt, provider, model, temperature, availableVariables}` |
| `top_k`, `min_similarity`, `decline_similarity`, `max_passages`, `max_context_tokens`, `similarity_band` | optional; settings defaults when null |
| `max_answer_chars` | int, default 1400 |
| `translate_query` | bool, default true |
| `document_ids` | `[UUID]` or null. Null searches everything; `[]` searches nothing |
| `persona` | `{display_name, system_prompt, tone}` or null |
| `answer_mode` | `documents_only` (default) or `documents_and_general` |
| `channel` | optional str |
| `audience` | **required** `AudienceSelector` (`{unrestricted: true}` or `{tenant_id, include_global}`) |

Response `KnowledgeAnswerResponse`:

- `intent`: `answer`, `decline` or `clarify`.
- `answer`, `language`, `confidence`.
- `citations[]`: `{passage_number, chunk_id, document_id, document_title, page_from, page_to, section_path, source_url, similarity}`.
- `decline_reason`: `none`, `no_hits`, `below_threshold`, `model_declined`, `translation_failed` or `error`.
- `retrieval`: `{top_k, min_similarity, decline_similarity, hit_count, top_similarity, passages_used, query_language, translated_query, unsupported, translation_degraded}`.
- `provider`, `model` (empty for a gate decline), `prompt_version`.

Errors: embedding failure 502, Weaviate failure 503, LLM failure 502, anything else 500.

How ally-be calls it (`ally-be/src/chatbot/engine/chatbot-engine.service.ts::answer`):
- Timeout is 25 s, with 2 attempts inside a 40 s budget.
- The crisis check runs in parallel with the same `prompts`.

### Auth, settings and logging in ally-ai

- **Auth:** `app/middleware.py::AuthMiddleware` checks the `x-api-key` header against `settings.API.X_API_KEY` (constant-time compare) for every path under `/api/v1`. Routers don't add their own auth.
- **Settings:** `app/core/config.py::AppSettings` (pydantic-settings) with `env_nested_delimiter="__"`. Each area is a nested `BaseModel`, so env vars look like `KNOWLEDGE_AGENT__TOP_K`. `.env` is read from the repo root. LangSmith settings are copied into the `LANGSMITH_*` env vars at import.
- **Logging:** `app.utils.logger.get_logger(__name__)`. `LogRequestMiddleware` adds a trace id per request. PHI never goes to the app log; it goes only through `app/core/phi_logger.py` (CloudWatch audit).
- **Routers** are registered in `app/api/v1/api.py` with a prefix. Endpoints are in `app/api/v1/endpoints/`, schemas in `app/schemas/`.
- **Startup:** `app/main.py` lifespan opens the Weaviate and AllyCore clients. Tests use `TestClient(app)` without a `with` block, so the lifespan **doesn't run in tests**.

### Versions

- **Python** `^3.12`. The image runs 3.12.16 and CI uses 3.12. The host has only 3.15, so local tests use a uv 3.12 venv.
- **Locked versions:**
  - langchain-core 1.6.5
  - langchain-openai 1.1.12
  - langchain-google-genai 4.3.7
  - langsmith 0.7.23
  - pydantic 2.11.7
  - fastapi 0.115.14
  - orjson 3.11.2
- **langgraph and psycopg are not installed.**

### Postgres

ally-ai has **no Postgres access today**: no driver, no settings, no code. The only local Postgres is ally-be's container `ally-be-postgres-1` (Postgres 14, host port 5477, database `ally_local`).

### Existing question or eval set

**None** for the knowledge bot. There are only unit tests (`tests/core/knowledge_agent/`, `tests/api/v1/endpoints/test_knowledge_agent.py`) and unrelated sets (judge rubrics in `scripts/jev_bakeoff/`, helpline risk cases).

### Where the code differs from chunk-01.md and stage1-build.md (the code wins)

1. The request field is `question`, not `message`. The response field is `intent`, not `decision`. `audience` is a required request field that neither doc mentions.
2. Every route is under `/api/v1`, so the new route is `POST /api/v1/agent/run`.
3. **There is no "model" field.** ally-be merges the bot's `{provider, model, temperature}` into `prompts["ally_ai_knowledge_whatsapp_answer"]` and `prompts["ally_ai_knowledge_answer_general"]` only. "The model override applies to the write step only" therefore follows from what is in `prompts`; ally-ai has no override logic of its own.
4. The empty-selection placeholder `00000000-0000-0000-0000-000000000000` is substituted by **ally-be**, not ally-ai (`chatbot-engine.service.ts`, `NO_DOCUMENTS`). In ally-ai, `document_ids=[]` returns zero hits without embedding. The placeholder is embedded, filtered to zero hits, and declines `no_hits`.
5. There is a fourth decline reason, `translation_failed`, used when translation failed and retrieval came back weak. There is also an unused `error` value.
6. General mode still selects passages when the top hit clears the decline threshold. Passages are empty only below it.
7. "Check" also sets `retrieval.unsupported`. The retrieval-log side effect isn't in either doc.
8. The brief's layout puts `router.py` and the request models in `app/core/agent_runtime/`. The repo convention is `app/api/v1/endpoints/` and `app/schemas/`, and the build follows the repo.
9. The brief's env vars are flat (`AGENT_RUNTIME_ENABLED`, `AGENT_CHECKPOINT_DB_URL`). The repo convention is nested, so they are `AGENT_RUNTIME__ENABLED` and `AGENT_RUNTIME__CHECKPOINT_DB_URL`.
10. stage1-build says the Ally FAQ bot has one of seven documents attached. That is still true locally: only "Ally FAQ – Progress, Badges and Streaks". The parity set uses all seven "Ally FAQ –" documents directly.
11. The root CLAUDE.md said ally-ai runs on 8000 and ally-web on Node 20. The local stack maps ally-ai to 3001, and ally-web uses Node 22. Both lines are fixed.

## 2. What was built

All paths are under `ally-ai/`.

| File | What it is |
|---|---|
| `app/core/knowledge_agent/agent.py` | **Refactor only.** `answer()` is now `resolve_limits → translate → retrieve → retrieval_meta → gate → decline \| select → write → check`, as methods in the same module. Same order, same retrieval-log calls, same result. |
| `app/core/agent_runtime/state.py` | `AgentState` (JSON-safe), the `add_trace` reducer (None resets it), and `RUN_SCOPED_KEYS`, which are cleared at the start of every run |
| `app/core/agent_runtime/nodes/*.py` | One node per step; each is a thin wrapper around the service method above |
| `app/core/agent_runtime/graph.py` | `build_graph()`, `get_agent_graph()` (compiled once), `run_agent()`, `get_run_state()` |
| `app/core/agent_runtime/checkpointer.py` | `open_checkpointer()` (Postgres pool + `setup()` in its schema, or memory), `get_checkpointer()`, `close_checkpointer()` |
| `app/core/agent_runtime/trace.py` | `traced()` adds a `{node, ms, summary}` step per node |
| `app/api/v1/endpoints/agent_runtime.py` | `POST /api/v1/agent/run`, 404 while disabled |
| `app/schemas/agent_runtime.py` | `AgentRunRequest` / `AgentRunResponse`: subclasses of the knowledge-answer models |
| `app/core/config.py` | `AgentRuntimeSettings`: `ENABLED`, `CHECKPOINT_DB_URL`, `CHECKPOINT_SCHEMA`, `CHECKPOINT_POOL_MAX_SIZE`, `DURABILITY` |
| `app/main.py` | The lifespan opens the checkpointer only when enabled, and closes it on shutdown |
| `.dockerignore` | New: keeps a local `.venv/` out of the image (see section 4) |
| `scripts/agent_parity.py`, `tests/fixtures/agent_parity_cases.yaml`, `tests/fixtures/parity_baseline_master.json` | The parity harness, 22 cases, and the master baseline |
| `tests/core/agent_runtime/` | 39 tests: graph, endpoint, checkpointer, golden parity. The Postgres test runs only when `AGENT_RUNTIME_TEST_DB_URL` is set. |

### Contract

- **Request:** every `/knowledge-agent/answer` field, plus `conversation_id` (required, also the thread id), `run_id` (uuid4 if absent), `chatbot_id` (optional, recorded in the run metadata) and `runtime_version` (default `"v2"`).
- **Response:** every `/knowledge-agent/answer` field, plus `run_id`, `trace` (7 steps when answering, 4 for a gate decline) and `runtime: "v2"`. There is also `retrieval.hit_chunk_ids` (debug only).
- **Status codes and auth:** identical to the old route (`x-api-key`; 502, 503, 500).

### Env vars (nested, matching the repo convention)

| Var | Default | Notes |
|---|---|---|
| `AGENT_RUNTIME__ENABLED` | `false` | Off: `/agent/run` is 404 for any body, and nothing is opened at startup |
| `AGENT_RUNTIME__CHECKPOINT_DB_URL` | unset | Unset: in-memory checkpoints, one warning at startup |
| `AGENT_RUNTIME__CHECKPOINT_SCHEMA` | `agent_runtime` | Validated as `^[a-z_][a-z0-9_]*$` |
| `AGENT_RUNTIME__CHECKPOINT_POOL_MAX_SIZE` | `10` | |
| `AGENT_RUNTIME__DURABILITY` | `async` | `exit` is the fallback if latency ever needs it |

## 3. Decisions

- **Checkpoint database.** Locally, a separate database `ally_agent_runtime` on ally-be's Postgres server (`ally-be-postgres-1`, host port 5477), with the tables in schema `agent_runtime`. The code runs `CREATE SCHEMA IF NOT EXISTS`, then `AsyncPostgresSaver.setup()` with `search_path=agent_runtime`. ally-be's `ally_local` is never touched; this was verified, and it has no `checkpoint*` tables.
  - **Production (ops):** before switching the flag on, provision a database, or at least a role, that is not ally-be's. The role needs `CREATE` on its own database (for the schema) and nothing on ally-be's. Then set `AGENT_RUNTIME__CHECKPOINT_DB_URL`. Each answered run writes about 9 checkpoints; there is no retention job yet.
- **Durability is `"async"`.** It keeps a checkpoint per step, which chunks 10 and 11 need, and it stayed inside the latency budget, so there was no fallback to `"exit"`.
- **LangSmith: no new destination.** Findings:
  - Locally, `LANGSMITH__TRACING=false`.
  - Production's ally-ai env comes from an S3 environment bucket that the repo can't read, and infra has no LangSmith setting. So the production value couldn't be checked from here.
  - It doesn't matter for parity: the old path **never** traces to LangSmith in any environment. Its model calls go through `app/core/llm/dispatch.py` on the raw provider SDKs, and LangChain's `OpenAIEmbeddings` emits no runs. A LangGraph run, however, would trace its inputs (the question) whenever `LANGSMITH_TRACING=true`.
  - So `run_agent()` wraps every run in `langsmith.tracing_context(enabled=False)`: agent runs are never traced, in any environment. `test_runs_are_never_traced_to_langsmith` sets `LANGSMITH_TRACING=true` and asserts tracing is off inside a node.
- **The retrieval log fires exactly once per run,** in the gate path (in `finalize`) and in the answer path (in `select`), as in the old path. Tested.
- **Dependencies.**
  - New: langgraph 1.2.20, langgraph-checkpoint 4.3.1, langgraph-checkpoint-postgres 3.2.0, langgraph-prebuilt 1.1.1, langgraph-sdk 0.4.13, ormsgpack 1.13.0, psycopg / psycopg-binary 3.3.8, psycopg-pool 3.3.3, tzdata.
  - The only existing package that moved is **orjson, 3.11.2 → 3.11.9**. The checkpointer needs `>=3.11.5`. Unpinned, it resolved to 3.13.0, so `orjson = "~3.11.9"` holds it to a patch bump.
- **Prompts:** no new prompts, and no prompt text changes.
- **AI task registry:** no new model-call types (the same `LLMTask` values), so no registry row. Chunk 2 should check this when ally-be starts calling `/agent/run`.

## 4. Things found along the way (not changed beyond what chunk 1 needed)

- **The test suite depends on collection order.** `settings` is created on first import, and `tests/api/conftest.py` sets `API__X_API_KEY=test-api-key` at import time. That only works if nothing imports the app before `tests/api/` is collected. A first attempt at `tests/agent_runtime/` (sorted before `api`) 401'd 65 existing API tests. The new tests now live in `tests/core/agent_runtime/`, like the knowledge agent's. The underlying fragility is unchanged.
- **`.env` leaks into the tests.** Settings read `ally-ai/.env`, so a developer with `AGENT_RUNTIME__ENABLED=true` there made `tests/test_main.py`'s lifespan tests open a real checkpointer. `tests/conftest.py` now pins `AGENT_RUNTIME__ENABLED=false` (and an empty URL), the same way it pins every other setting.
- **The Dockerfile copies the whole directory.** With a local `ally-ai/.venv/` (now the documented way to run tests), Poetry in the image used it and the container crash-looped (`No module named 'weaviate'`). The new `.dockerignore` excludes virtualenvs and caches only. **The image still bakes in `ally-ai/.env`** (pre-existing; not changed here).
- **Temperature 0 never reaches OpenAI models.** `dispatch.py` sends `temperature` only when it's truthy, and never for `gpt-5*` / `o*` models, so `0.0` is dropped. The answer model (`gpt-5-mini`) and the translate model (`gpt-4o-mini`) both sample at the provider default. This is why the same question can translate or cite differently from run to run, on either path.

## 5. Parity results

Report: [CHUNK-01-PARITY-REPORT.md](./CHUNK-01-PARITY-REPORT.md) (22 cases, local stack, rebuilt image).

- **Every deterministic must-match field matched on all comparable cases:** intent, decline reason, hit count, top similarity and passages used. The gate, empty-selection, general-mode and out-of-scope cases all match.
- **Latency:** p50 v1 5812 ms, v2 5779 ms, **−0.6%** (budget +15%).
- **Two must-match failures, both on the set of cited chunk ids only** (`in-get-access`, `lang-hindi`). Retrieval and passages were identical; the model chose different citations. The old endpoint alone does the same. Three back-to-back calls to `/knowledge-agent/answer` gave `{Access, Help}`, `{Access}`, `{Access, Help}` for one question and `{About, Access}`, `{About}`, `{About, Access}` for the other. The same case also mismatches between today's v1 and the master baseline.
- **Refactor check (v1 now vs the master baseline):** matched on every case whose translation was the same. The one mismatch is the citation variance above.

## 6. How to test (the six checks, with real paths, env names and port)

Run from `ally-platform/ally-ai`. ally-ai is on host port **3001** (`docker-compose.local.yml`). The API key is `API__X_API_KEY` in `ally-ai/.env`.

1. **Tests and lint:**
   ```bash
   poetry run pytest tests/core/agent_runtime -q
   poetry run pytest tests/ -q
   poetry run flake8
   ```
   Optional, against real Postgres:
   ```bash
   AGENT_RUNTIME_TEST_DB_URL=postgresql://postgres:<pw>@localhost:5477/ally_agent_runtime poetry run pytest tests/core/agent_runtime -q
   ```
2. **Start with the runtime on.** `ally-ai/.env` needs:
   ```
   AGENT_RUNTIME__ENABLED=true
   AGENT_RUNTIME__CHECKPOINT_DB_URL=postgresql://postgres:<pw>@host.docker.internal:5477/ally_agent_runtime
   ```
   Create the database once with `docker exec ally-be-postgres-1 createdb -U postgres ally_agent_runtime`, then rebuild:
   ```bash
   docker compose -f docker-compose.local.yml up -d --build app
   ```
   The log should show `Agent runtime checkpoints in Postgres, schema agent_runtime`.
3. **One request:**
   ```bash
   KEY=$(grep '^API__X_API_KEY=' .env | cut -d= -f2-)
   curl -s -X POST localhost:3001/api/v1/agent/run \
     -H 'Content-Type: application/json' -H "x-api-key: $KEY" \
     -d '{"conversation_id":"test-1","question":"What does Ally do?",
          "audience":{"unrestricted":true},
          "document_ids":["6afbcba1-301c-46c8-86e7-1fcc13012b48"]}' | jq
   ```
   Expect the `/knowledge-agent/answer` shape plus `run_id`, `runtime: "v2"` and a 7-step `trace` (4 steps for a gate decline).
4. **Parity:**
   ```bash
   API__X_API_KEY=$KEY poetry run python scripts/agent_parity.py \
     --cases tests/fixtures/agent_parity_cases.yaml --base-url http://localhost:3001 \
     --baseline tests/fixtures/parity_baseline_master.json
   ```
   Read the "translation differs", citation-overlap and baseline columns in `parity_report.md`. See section 5 for why `cited_chunk_ids` can differ.
5. **Stored state:**
   ```bash
   docker exec ally-be-postgres-1 psql -U postgres -d ally_agent_runtime \
     -c "select thread_id, count(*) from agent_runtime.checkpoints group by 1;"
   ```
   `test-1` should be listed with checkpoints.
6. **Flag off:** set `AGENT_RUNTIME__ENABLED=false`, then run `docker compose -f docker-compose.local.yml up -d --force-recreate --no-deps app`. `/api/v1/agent/run` should return 404, and `/api/v1/knowledge-agent/answer` should still return 200.

## 7. Open questions

- **Live citation must-match (decision needed).** As specified, it can't pass reliably while the answer model samples. Either make the citation set "should match" live (overlap %, still exact in the golden test), or keep it must-match but only fail when v2's set is outside the sets v1 produces over N repeats.
- **The wiki rule.** `.docs-map.yml` flags `app/main.py` and `app/api/v1/endpoints/**`. The PR body needs `Wiki-PR: none — dark-launched behind AGENT_RUNTIME__ENABLED; documented when ally-be integrates in chunk 2`, or a wiki PR.
- **Checkpoint retention.** Every run is kept forever; it needs a retention policy before production volume.

### Open for chunk 2

- **Shadow mode will double-log retrieval.** If ally-be calls both endpoints for one message, `emit_retrieval_log` fires once per path. Decide on a suppress flag (for example, on `/agent/run` while shadowing) then. Local parity runs already double-log.
- Map `intent` (not `decision`) and the new `run_id` onto the outbound message. `retrieval.hit_chunk_ids` is debug only and shouldn't be stored.
- Add the AI task registry row if ally-be's call is registered per endpoint.
