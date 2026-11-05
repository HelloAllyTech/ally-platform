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
