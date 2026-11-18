# Chunk 1 — LangGraph runtime with parity (ally-ai only)

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md` first, then this whole file, before writing code.
> Background: `stage1-build.md` (today's pipeline) and `three-stage-plan.md` → "Stage 2 detail: the graph" and "endpoint and gateway" (the target this chunk starts toward).
> Branch: `feat/agents-v2-chunk-01-langgraph-runtime`  ·  Repo: **ally-ai** only

## Why this chunk exists

Agents v2 (tools, memory, scheduler, flows, approvals) runs on a LangGraph agent. Before we add anything new, we rebuild **today's** knowledge-answer pipeline as a LangGraph graph and prove it answers the same way. This chunk adds no new features for users. It gives us a new engine that matches the old one, plus a way to check that it does.

## What exists today (verify in the code before relying on it)

- `ally-ai/app/core/knowledge_agent/agent.py` runs a fixed pipeline for `POST /knowledge-agent/answer`:
  1. **Translate**: detect the language and restate the question in English for search (prompt `ally_ai_knowledge_translate_query`). The answer still comes back in the person's language.
  2. **Search**: embed the English text and search Weaviate `KnowledgeChunk`, pre-filtered to the bot's `document_ids`. An empty selection is sent as a placeholder id, so it searches nothing, never everything.
  3. **Gate**: no hits, or a best match below the decline threshold, declines in code with no model call. Bots in `documents_and_general` mode skip the gate.
  4. **Select**: passages within a similarity band of the best one, capped by count and token budget.
  5. **Write**: the persona block (name, tone, instructions, ranked below the rules) plus `ally_ai_knowledge_whatsapp_answer`, or `ally_ai_knowledge_answer_general` in general mode. The model returns `answer | decline | clarify` as structured output. The bot's model, if set, overrides the model for these two prompts on this request only.
  6. **Check**: citations are passage numbers mapped back to chunks; out-of-range numbers are dropped; an empty "answer" becomes a decline.
- Retrieval thresholds (passages searched, match floor, decline threshold, passages used) arrive on every request from the defaults plus the bot's settings.
- `POST /knowledge-agent/crisis-check` is separate. ally-be calls it in parallel. **Leave it alone** in this chunk.
- Prompt text lives in the Skills Store (Manage Prompts); the `.txt` files only seed new environments.

**First step:** read `agent.py`, its request and response models, the router that exposes it, its tests, and how prompts, the LLM client and Weaviate are loaded. Write a short summary of the real function names and data shapes in `CHUNK-01-NOTES.md` before building. If anything above doesn't match the code, the code wins; note the difference.

## Goal

1. A LangGraph `StateGraph` that reproduces steps 1–6 exactly, reusing the existing functions rather than copying them.
2. `POST /agent/run` exposing the graph, with a response that is a **superset** of `/knowledge-agent/answer`'s response, so ally-be can swap endpoints in chunk 2 with minimal mapping.
3. A Postgres checkpointer: `thread_id` = conversation id, so each run's state is stored and readable later. This is needed for "Why?" in chunk 10 and approvals in chunk 11.
4. A parity harness that runs the same cases through both paths and reports the differences.

## Out of scope (don't do these)

- No changes to ally-be or ally-web.
- No tools, memory, context files, tool loop or agent node. Those start in chunk 3.
- No change to `/knowledge-agent/answer` behaviour or its response shape. Refactoring it to call shared functions is fine **only** if its tests still pass unchanged.
- No crisis check inside the graph.
- No new prompts, and no prompt text changes.

## Design

### Layout

```
app/core/agent_runtime/
  __init__.py
  state.py          # AgentState TypedDict + request/response models
  graph.py          # build_graph(); compiled once at startup
  nodes/
    translate.py
    retrieve.py
    gate.py         # returns route: "select" | "finalize"
    select.py
    write.py
    check.py
    finalize.py
  checkpointer.py   # AsyncPostgresSaver setup, fallback MemorySaver
  trace.py          # per-node timing + summary helper
  router.py         # POST /agent/run
scripts/agent_parity.py
tests/agent_runtime/...
tests/fixtures/agent_parity_cases.yaml
```

Match the repo's existing conventions (router registration, settings/env loading, logging, async style, pydantic version). If `knowledge_agent` steps are buried in one large function, first extract each step into a pure function in `knowledge_agent` (no behaviour change), make the old endpoint call those functions, run its tests, and then have the nodes call the same functions.

### State

```python
class AgentState(TypedDict, total=False):
    # input
    run_id: str
    chatbot_id: str
    conversation_id: str          # also the checkpointer thread_id
    message: str
    bot: dict                     # documents, instructions, tone, answer_mode, model, thresholds, persona
    # working
    language: str
    english_query: str
    hits: list[dict]              # raw retrieval results with scores
    passages: list[dict]          # selected
    gate_reason: str | None       # "no_hits" | "below_threshold" | None
    # output
    decision: Literal["answer", "decline", "clarify"]
    answer: str
    citations: list[dict]
    retrieval: dict               # same debug block the old endpoint returns
    trace: Annotated[list[dict], operator.add]   # {node, ms, summary}
```

Keep the state JSON-serialisable: no client objects or numpy arrays. The checkpointer has to store it.

### Graph

```
START → translate → retrieve → gate ─(decline)→ finalize → END
                                   └─(continue)→ select → write → check → finalize → END
```

- `gate` keeps today's rule exactly, including the general-mode skip.
- `finalize` builds the response object and fills `decision` for declines that came from the gate.
- Each node appends one `trace` entry: node name, milliseconds, and a one-line summary (for example `"retrieve: 12 hits, best 0.81"`). No raw prompts or personal data in the trace beyond what the old endpoint already returns.

### Endpoint

`POST /agent/run`

- **Request:** every field `/knowledge-agent/answer` accepts today, plus:
  - `conversation_id` (required)
  - `run_id` (optional; generate a uuid4 if missing)
  - `runtime_version` (optional, default `"v2"`)
- **Response:** everything `/knowledge-agent/answer` returns, plus:
  - `run_id`
  - `trace`
  - `runtime: "v2"`
- **Auth:** the same service-to-service auth the existing knowledge routes use.
- **Feature flag:** env `AGENT_RUNTIME_ENABLED` (default `false`). When false, the route returns 404 so production behaviour is unchanged until we turn it on.

### Checkpointer

- Use `langgraph-checkpoint-postgres` (`AsyncPostgresSaver`) with a pooled psycopg 3 connection.
- Env `AGENT_CHECKPOINT_DB_URL`. If it isn't set, fall back to `MemorySaver` and log one warning at startup. Tests use `MemorySaver`.
- Run `setup()` once at startup, in a dedicated schema (for example `agent_runtime`) so it never touches ally-be's tables. Note in the NOTES file which database it points to locally and what ops needs for production.
- Invoke with `config={"configurable": {"thread_id": conversation_id}, "run_name": "agent_run", "metadata": {"run_id": ..., "chatbot_id": ...}}`.
- Add a small internal helper `get_run_state(conversation_id, run_id)` that reads the stored state back. No route yet; chunk 10 adds one.

### Dependencies

Add `langgraph`, `langgraph-checkpoint-postgres` and `psycopg[binary,pool]` at current stable versions compatible with the repo's Python version. Pin them the way the repo pins its other dependencies. If LangGraph or LangChain is already installed, reuse that version line. Rebuild the Docker image locally, and note that the local ally-ai container runs a prebuilt image.

## Parity harness

`scripts/agent_parity.py --cases tests/fixtures/agent_parity_cases.yaml --base-url http://localhost:<port> [--out parity_report.md]`

- For each case it calls `/knowledge-agent/answer` and `/agent/run` with the same payload (adding a fresh `conversation_id` for the second) and compares:
  - **Must match:** `decision`; retrieved chunk ids and order (when the translated query is the same); gate reason.
  - **Should match:** the set of citations (report overlap as a percentage).
  - **Report only:** answer text similarity (difflib ratio is enough) and latency for each path.
- It prints a table and writes `parity_report.md`. The exit code is non-zero if any must-match check fails.
- Translation is model-based, so if the two paths translate differently, report "translation differs" and skip the retrieval comparison for that case instead of failing it.

`agent_parity_cases.yaml`: if a Stage 1 question or eval set already exists in the repo, search for it and reuse it first. Otherwise create at least 20 cases using the local Ally FAQ bot's documents (read the document ids from local config or ask the developer). Cover:
- 8 clear in-scope questions
- 4 clearly out-of-scope questions, which should decline at the gate
- 3 non-English questions (Hindi, Marathi or Hinglish)
- 2 ambiguous questions, which may return clarify
- 2 cases in `documents_and_general` mode
- 1 case with an empty document selection, which must search nothing and decline

## Tests (pytest, mocked LLM and Weaviate)

- Gate: no hits → decline with no write call; best score below threshold → decline; general mode skips the gate.
- Select respects the band, the count cap and the token budget, using the same fixtures as the old tests where they exist.
- Check: out-of-range citation numbers are dropped; an empty answer becomes a decline.
- Empty document selection uses the placeholder id and returns zero hits.
- Model override applies to the write step only.
- The endpoint returns the old response fields plus `run_id`, `trace` and `runtime`.
- Flag off → 404.
- Checkpointer: two runs with the same `conversation_id` produce two checkpoints in one thread, and `get_run_state` returns the second run's decision.
- Golden test: for 3 fixed mocked cases, `/knowledge-agent/answer` and `/agent/run` return identical `decision`, `citations` and `answer`.

All existing ally-ai tests and flake8 still pass.

## Done when

- [ ] `CHUNK-01-NOTES.md` covers the real code map, the decisions taken, how to run everything, and open questions
- [ ] Graph, endpoint, checkpointer, trace and flag are in place
- [ ] Old endpoint behaviour is unchanged and its tests pass untouched
- [ ] New unit tests pass; flake8 is clean
- [ ] Parity script and 20+ cases are committed; a local run gives 0 must-match failures, and the report is attached to the PR
- [ ] p50 latency of `/agent/run` is within +15% of the old endpoint on the parity set (from the report)
- [ ] One PR, with a description listing what changed, how to test and the env vars

## How Shehbaz tests it

1. `pytest tests/agent_runtime -q`, then the full suite, then `flake8`.
2. Start ally-ai locally with `AGENT_RUNTIME_ENABLED=true` and `AGENT_CHECKPOINT_DB_URL` set.
3. Run one request:
   ```bash
   curl -s -X POST localhost:<port>/agent/run \
     -H 'Content-Type: application/json' -H '<same auth header as knowledge routes>' \
     -d '{"conversation_id":"test-1","message":"What does Ally do?", ...same bot fields ally-be sends today...}' | jq
   ```
   Expect the same answer shape as `/knowledge-agent/answer`, plus `run_id`, `runtime: "v2"` and a 5–7 step `trace`.
4. Run `python scripts/agent_parity.py --cases tests/fixtures/agent_parity_cases.yaml --base-url http://localhost:<port>` and expect 0 must-match failures. Read the "translation differs" and citation-overlap rows.
5. Check the stored state: `select thread_id, count(*) from agent_runtime.checkpoints group by 1;` should show `test-1` with checkpoints.
6. Restart with `AGENT_RUNTIME_ENABLED=false`; `/agent/run` returns 404 and `/knowledge-agent/answer` still works.

When all six pass, chunk 1 is done. Next is chunk 2: the per-bot `runtime: v1 | v2` switch in ally-be, so a real WhatsApp bot can run on this graph.
