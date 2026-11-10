# Chunk 03c notes: live agent (streaming steps and replies, WhatsApp typing)

**Brief:** [chunk-03c.md](./chunk-03c.md). **Branch:** `feat/agents-v2-chunk-03c-streaming`, from master after PR #223 (`chore/agents-v2-one-loop`: one agent loop, the parity path and Shadow removed) was merged. **Repos:** all three.

Plan approved 2026-11-06 at `~/.claude/plans/pasted-content-id-053d-we-re-starting-dynamic-turtle.md`.

## 1. Code map: what exists today (read before building)

### LangGraph's custom stream writer (installed langgraph 1.2.20)

- **`get_stream_writer`**: `langgraph/config.py:126` returns the run's writer: `get_config()[CONF][CONFIG_KEY_RUNTIME].stream_writer`. <!-- docs-path-lint: ignore -->
  - Called outside a graph it **raises** `RuntimeError("Called get_config outside of a runnable context")` (`config.py:26-29`). The helper that emits must guard it.
  - The writer only forwards when `"custom"` is among the requested stream modes. Otherwise it is a no-op (`pregel/main.py:3368-3388`). `/agent/run` therefore pays nothing for emitting. <!-- docs-path-lint: ignore -->
  - On Python 3.12, contextvars reach async nodes. LangGraph's warning only covers versions before 3.11 (`config.py:132-135`).
- **`astream`**: `Pregel.astream(input, config, *, stream_mode, durability, …, version="v1")` (`main.py:3156`). Given a list of modes, it yields `(mode, chunk)` tuples.
- **`ainvoke`** is itself `astream(stream_mode=["updates","values"])`, keeping the last `values` chunk (`main.py:4100-4205`). A runner on `astream(["custom","values"])` that keeps the last `values` behaves the same way.

### ally-ai: where the stream is hosted

- **Graph** (`app/core/agent_runtime/graph.py`, after #223): `START → agent ─(tool call)→ tools → agent`, and `agent ─(reply)→ check ─(refused once)→ agent | END`. There is no finalize node and no parity path.
  - `run_agent()` (`:80-120`) calls `graph.ainvoke(inputs, config, durability=…)` inside `tracing_context(enabled=False)`.
- **Endpoint** (`app/api/v1/endpoints/agent_runtime.py`):
  - The router dependency `require_agent_runtime` gives 404 when off and 503 when the checkpointer is unavailable (`:26-35`).
  - The `run` handler (`:52-85`) builds `AgentRunResponse` from `state["result"]` plus `hit_chunk_ids`, inside `knowledge_errors` (`knowledge_agent.py:33-64`: 502/503/502/500).
- **Trace** (`app/core/agent_runtime/trace.py`): `trace_step(node, started, summary)` builds one step. `traced(name, summary)` wraps the agent and check nodes with it. The tools node calls `trace_step("tool", …)` itself (`nodes/tools.py:66`).
  - **Every step already goes through `trace_step`.** That makes it the one place to emit `step` events: every node and every tool streams with no code of its own.
- **Draft and check:**
  - The agent node (`nodes/agent.py`) sets `agent_step` and, on the first call, `started_at = time.time()`.
  - The check node (`nodes/agent_check.py`) either sends the draft back (`feedback`, no `result`) or sets `result`, with a refused rewrite falling back to `fallback_result`.
  - **`result.answer` exists only once check has passed or finalised it.**
- **Budget** (`budget.py`):
  - `over_time` uses `RUN_BUDGET_SECONDS` (15). Past it, the agent can't search and its reply isn't rewritten.
  - There is **no hard cap**: a slow model call can run on (review #62).
- **SSE in ally-ai:** none. There's no `StreamingResponse`, and `sse-starlette` isn't installed (starlette 0.46.2).
  - `AuthMiddleware` and `LogRequestMiddleware` are `BaseHTTPMiddleware` (`app/middleware.py:16,33`). On Starlette 0.46 they pass the body through chunk by chunk.
  - The "Completed request" log line fires when the headers go out, not when the stream ends.

### Dispatch: where a remaining-time budget fits (review #62)

- `generate_structured` (`app/core/llm/dispatch.py:781`) has no timeout parameter.
- The clients use SDK defaults: `AsyncAnthropic` (`:372`), `genai.Client` (`:390`) and `AsyncOpenAI` (`:408`). For OpenAI and Anthropic that is 600 s and 2 retries.
- Per-request timeouts fit at:
  - `client.chat.completions.create(timeout=)` (`:711`);
  - `client.messages.create(timeout=)` (`:523`);
  - Gemini `GenerateContentConfig(http_options=…)` (`:605`).

  They are threaded through `attempt()` (`:858-869`). The provider fallback (`:893-903`) gets what is left.
- The agent calls it from one site, `conversation.py::agent_step`. `state["started_at"]` marks the run's start.

### ally-be: where the stream is relayed

- **Runner** (`chatbot/engine/agent-runtime-runner.service.ts`, `answer()` `:91-149`):
  - one `aiService.runAgent` call (25 s, no Slack alert);
  - on any failure, `answerKnowledgeQuestionWithin(request, budgetMs − elapsed)` (40 s budget, `KNOWLEDGE_ANSWER_LIMITS`), giving `AgentRunRef` `v2_fallback` with an `AgentFailureReason`;
  - if v1 fails too, `AgentFallbackFailedError`.
- **The crisis check runs in the engine, not the runner.**
  - `ChatbotEngineService.answer()` runs `Promise.allSettled([runner.answer | v1, checkWhatsAppCrisis])` (`chatbot-engine.service.ts:~221`), and a crisis verdict wins.
  - So holding tokens until the crisis check clears belongs in the engine.
- **Preview:**
  - `POST /v1/chatbots/:id/test` (`chatbot.controller.ts`, `@RequireFeatureToggle(WHATSAPP_BOT, VIEW)`);
  - `ChatbotService.test()` calls `engine.respond({… channel: {type:'test'}})`, then `toTestResult`, giving `ChatbotTestResult`.
- **The ally-ai client:**
  - `AiService.runAgent` → `postKnowledge` → `makeRequest` (axios, `x-api-key`, `redactBody`, `alertOnFailure:false`);
  - endpoint constant `AGENT_RUN: 'api/v1/agent/run'` (`ai/constants/endpoints.constants.ts`).
  - ally-be has no SSE client or parser.
- **SSE pattern in ally-be** (`course-copilot/controller/course-copilot.controller.ts:286-380`):
  - raw `@Res()`;
  - `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`, then `flushHeaders()`;
  - `res.on('close')` sets a `clientGone` flag;
  - `safeWrite(event, data)`, a ping `setInterval`, `res.end()` in `finally`.
- `guide/controller/guide-admin.controller.ts:319` aborts upstream work through an `AbortController` on `res.on('close')`. There's no compression middleware (`main.ts`).

### ally-web: existing SSE client

- `apps/ally-admin-dashboard/src/hooks/useRoadmapCopilotStream.ts`:
  - `parseCopilotSse(buffer)` (exported, tested, `:27-52`);
  - `fetchWithReauth(url, body, signal)`: bearer from localStorage, one 401 refresh-and-retry (`:87-117`);
  - a reader loop with `TextDecoder` (`:149-176`), and an `AbortController` aborted on unmount.
- No `EventSource` anywhere: it can't send the auth header or POST.

### The WhatsApp typing indicator (Meta's docs, checked 2026-11-06)

- **The call:** `POST https://graph.facebook.com/<version>/<phone-number-id>/messages` with
  `{"messaging_product":"whatsapp","status":"read","message_id":"<wamid>","typing_indicator":{"type":"text"}}`. It returns `{"success": true}`.
- It marks the message read (blue ticks) and shows the dots until the reply is sent, or for 25 s. Meta advises showing it only when a reply is coming. No minimum Graph version is stated (the example uses v27.0).
- **It already exists:**
  - `MetaWhatsAppProvider.showTypingIndicator` (`whatsapp/provider/meta-whatsapp.provider.ts:311-343`) uses that body, a 5 s timeout and a logged, swallowed error. It runs on `WHATSAPP_GRAPH_API_VERSION` (default `v25.0`).
  - `WhatsAppInboundService.handle()` calls it **for every bot** (`whatsapp-inbound.service.ts:~305`), after dedupe, kill switch, contact, rate limit and STOP/START/consent, and before identity and the engine. It is fire-and-forget.
  - Tests: `whatsapp-inbound-chatbot.spec.ts:454-476` (sent with the number's credentials, not on STOP, a rejection doesn't block) and `meta-whatsapp.provider.spec.ts:380`.

### Connector capabilities

- `ChannelCapabilities { maxReplyChars? }` (`chatbot/engine/chatbot-engine.types.ts`) is carried on `ChatChannel`.
- `ConnectorRegistry` (`chatbot/connector/connector-registry.ts`) holds `ConnectorTypeDefinition { type, label, description, capabilities, summarise, disconnect }`.
  - Its one registration is WhatsApp (`whatsapp/service/whatsapp-connector-type.service.ts`, `maxReplyChars: 4096`).
  - Inbound builds its channel literally, with the same 4096. Preview's `{type:'test'}` is a literal in `ChatbotService.test()`.

### Differences from the brief (the code wins)

1. **"v1 bots" no longer exist as a setting.** Since chunk 3d (and #223), every bot answers with v2 while `agentRuntimeAllowed` is on. v1 is only the emergency switch or the fallback.
2. **The typing indicator already exists and is unconditional.** This chunk adds the per-bot "Show typing" setting and the crisis-keyword skip. **Decision (Shehbaz): default on for every bot unless turned off.** That keeps today's behaviour and the existing spec. The brief's "off for v1" would have turned typing (and read ticks) off wherever the switch is off.
3. **Crisis keywords are matched inside `engine.respond`, not in inbound.** Skipping typing for one needs a keyword check in inbound before the indicator is sent.
4. **The crisis check runs in the engine**, so tokens are held there, not in the runner.
5. **There's no "test" connector type.** Registering one would list Preview among a bot's channels. So `streaming` is a `ChannelCapabilities` field: the WhatsApp registration and inbound say `false`, and one Preview channel constant says `true`.
6. **`get_stream_writer` raises outside a graph,** so the emit helper is guarded.
7. **No SSE library in ally-ai.** The stream uses Starlette's `StreamingResponse`, with no new dependency.
8. **No read-receipt setting existed.** "Show typing" is the first, in Settings → General.
9. **The widget is chunk 13 in `v2-chunks.md`,** not 21 as the brief says.
10. **No parity path or `finalize` node anymore** (#223), so status codes are mapped for the agent loop only.

### Decisions at plan time (Shehbaz, 2026-11-06)

- **Show typing:** default on, as above.
- **Timeouts:**
  - `AGENT_RUNTIME__RUN_TIMEOUT_SECONDS` defaults to **20**;
  - ally-be's stream deadline is **22 s**;
  - `/agent/run` keeps its 25 s wait;
  - the v1 fallback still spends the remaining 40 s budget.

  Why: ally-ai always ends first. Its 504 or `error {timeout}` reaches ally-be before ally-be gives up, so the fallback reason is a clean `timeout`, no run is left spending tokens after ally-be has moved on, and v1 keeps about 18 s.
- **One shared runner per app,** and `final` equals the non-stream response, each enforced by a test.
- `v2-chunks.md` lists 3d in its progress table.

## 2. The event contract

Server-Sent Events: `event: <name>` and a JSON `data:` line, plus a `: ping` comment line every 10 s.

| Event | Data | When |
|---|---|---|
| `run_started` | `{run_id}` | First |
| `status` | `{code, label, detail?}`. `code` is one of `thinking`, `searching`, `found`, `checking`, `rewriting`, `writing` | As a node starts (agent: `thinking`, or `rewriting` after a refusal; check: `checking`), around every tool (`searching` with the input's `query`, then `found` with "N passages" / "nothing new"), and `writing` before the text |
| `step` | `{node, summary, ms}`: exactly the trace step | The moment each step is recorded |
| `token` | `{text}`: about 3 words each, whitespace kept, joining to exactly the answer | Only after the run has ended, so only text the check passed (only the rewrite, when the first draft was sent back). ally-be holds them again until its crisis check clears |
| `final` | ally-ai: `/agent/run`'s body. ally-be: `/test`'s body | Last |
| `error` | `{code}`: `timeout`, `upstream` or `internal`. No message text | ally-ai only, instead of `final`. ally-be turns it into a v1 fallback `final`. ally-be sends `error {internal}` only if something fails after the stream began |

Labels are plain English. The dashboard maps `code` (and `detail`) to its own copy in `en.ts`.

## 3. What was built

### ally-ai

| File | What |
|---|---|
| `app/core/agent_runtime/runner.py` | **The one run path.** `execute(graph, payload, on_event=None)` runs under `asyncio.timeout(RUN_TIMEOUT_SECONDS)` and builds the response; with `on_event` it also sends `run_started`, then `writing` and the `token`s after the run. `stream()` turns it into SSE: a queue, the 10 s ping, `final` = `response.model_dump(mode="json")`, `error {code}` (the exception type is logged, never its message), and a `finally` that cancels the run and waits for it to stop |
| `app/core/agent_runtime/trace.py` | `emit()` (a guarded `get_stream_writer`, a no-op outside a streamed run), `status()`, `status_event()`. `trace_step()` now also emits the step, and `traced(name, summary, announce)` emits the node's status as it starts |
| `app/core/agent_runtime/graph.py` | `run_agent(..., on_event=None)` runs `astream(["values"] (+ "custom"))` and keeps the last `values`, as `ainvoke` did |
| `nodes/agent.py`, `nodes/agent_check.py`, `nodes/tools.py` | `thinking`/`rewriting`, `checking`, and `searching`/`found` around every tool, generic over the registry. The agent step's model call gets `_time_left()` |
| `conversation.py`, `app/core/llm/dispatch.py` | `generate_structured(timeout=)`: passed to OpenAI's and Anthropic's `create(timeout=)` and to Gemini's `http_options`; the provider fallback gets what is left (at least 1 s). None (every other caller) sends nothing |
| `app/api/v1/endpoints/agent_runtime.py` | `/run` = `execute()`, with `TimeoutError` → **504** (outside `knowledge_errors`, which would make it a 500). `/run/stream` = `StreamingResponse(stream())` with `Cache-Control: no-cache` and `X-Accel-Buffering: no`, on the same router, so the same auth, 404 and 503 apply |
| `app/core/config.py`, `env_sample`, `tests/conftest.py` | `AGENT_RUNTIME__RUN_TIMEOUT_SECONDS` (20), documented and pinned |
| `scripts/agent_conversation_eval.py` | `--stream`: asks through the stream, runs the same checks on `final`, adds the stream's own checks (`run_started` first, `final` last, no token before the last check step, tokens spell the answer), and reports p50 time to the first event |

### ally-be

| File | What |
|---|---|
| `ai/service/ai.service.ts` | `runAgentStreaming(request, onEvent, signal)`: axios `responseType: 'stream'`, a 22 s deadline (`KNOWLEDGE_ANSWER_LIMITS.streamMs`) combined with the client's signal. Returns `final` as the same `AgentRunResponse` `runAgent` returns. Failures are `AiUpstreamError`s: `error {timeout}` or the deadline → `AI_SERVICE_TIMEOUT`; another error, or no `final` → 502; an error status is classified as `runAgent`'s is (404 while off) |
| `ai/util/sse-parser.ts` | `SseParser`: messages split anywhere across chunks; comments skipped |
| `chatbot/engine/chatbot-engine.types.ts` | `ChannelCapabilities.streaming`, `PREVIEW_CHANNEL` (`{type:'test', capabilities:{streaming:true}}`), `LiveReply {onEvent, signal}` |
| `chatbot/engine/live-reply.ts` | `holdTextUntilCleared(live, crisisCheck)`: status and steps pass at once; tokens are held until the crisis check clears (a failed or disabled classifier clears, as it does for the reply), then flushed in order; dropped on a crisis verdict |
| `chatbot/engine/agent-runtime-runner.service.ts` | `answer(..., live?)`: the stream only when `live` and `channel.capabilities.streaming`; otherwise `runAgent` exactly as before. The existing catch is the fallback for both; no fallback once the client has gone |
| `chatbot/engine/chatbot-engine.service.ts` | `respond(turn, live?)`. The crisis promise is created first and gates the live reply |
| `chatbot/service/chatbot.service.ts`, `chatbot/controller/chatbot.controller.ts` | `test(id, dto, live?)` with `PREVIEW_CHANNEL`. `POST /v1/chatbots/:id/test/stream`: the same decorators as `/test`; headers go out with the first event (so a refusal before the run stays a plain HTTP error); `final` = `test()`'s result; a 10 s ping; `res.on('close')` aborts the run |
| WhatsApp | `streaming: false` on the connector registration and the inbound channel. "Show typing": `showTyping?: boolean` on the settings type and the per-bot override (**not** in `DEFAULT_WHATSAPP_SETTINGS`, so every settings snapshot is unchanged; on unless `false`). `WhatsAppInboundService.showTyping()` runs fire-and-forget at the same point as before: skipped when off, or when `ChatbotReplyService.isCrisisKeyword()` says the message is a crisis keyword; a failed lookup shows the dots, as before. `changesAdminOnlySetting()` + `assertPlatformAdmin()` on `PUT :id/settings` when `showTyping` changes. `DATA_SCHEMA.md` documents the key |

### ally-web (`apps/ally-admin-dashboard/src`)

| File | What |
|---|---|
| `hooks/useChatbotTestStream.ts` | `run(request, {onStatus, onStep, onToken})` → `/test`'s result from `final`; `ChatbotTestStreamUnavailable` when the stream never started (network error, error status, closed before an event); `cancel()`. Same bearer and 401 refresh as the other SSE hooks; reuses the tested `parseCopilotSse` |
| `pages/WhatsAppBot/ChatbotTestTab.tsx` | The pending reply: typing dots, then the revealed text with a caret; a live status line (`role="status"`); live steps for platform admins (as `RunDetails` is admin-only). Tokens arrive in one burst after the check, so they are revealed at 25 ms a piece, and `final` waits for the reveal (at most 3 s). `final` then replaces the bubble with the normal one, with "Updated with the final reply" when the final text doesn't start with what was shown. Falls back to `/test` only before the first event. New thread cancels the run |
| `pages/WhatsAppBot/ChatbotSettingsTab.tsx`, `ChatbotPage.tsx` | "Show typing on WhatsApp" in General → Basics, shown only to platform admins (`isPlatformAdmin`, passed from the page), with help text naming the read receipts |
| `constants/en.ts`, `constants/common.ts`, `types/*` | Copy (`bots.test.status.*`, `replaced`, `orgSettings.showTyping*`), `TEST_STREAM`, `ChatbotTestStatus`, `WaOrgSettings.showTyping` |

### After review: the activity feed (Shehbaz, 2026-11-06)

Shehbaz watched a recording and said it didn't feel like an agent at work. Two ways to make it feel live were offered: a rich activity feed, or true streaming of the draft. **Decision: the activity feed only.** "No unchecked text" stays everywhere; streaming the draft remains a later option.
- **ally-ai:** status events carry more.
  - `found` names the documents its passages came from (`documents`, titles only, at most 3).
  - `rewriting` carries why the draft went back (`detail` = the rejection code).
  - Labels are plain English.
- **Preview:** everyone sees one line per step, in words, with the current line animated. For example:
  - "Searching the knowledge base for “…”"
  - "Found 2 passages in …"
  - "Working out the answer"
  - "Checking the answer against the sources"
  - "Rewriting: it answered before searching"

  The raw steps stay admin-only.
- **Reveal:** the checked reply is typed out at about 65 characters a second, at most 4 s.
- **Finished reply:** it keeps its activity folded as "Worked for 6.1 s · 4 steps", measured to the reply's arrival, not to the end of the typing.

## 4. Decisions

- **Shehbaz, at plan time:** "Show typing" defaults on; the timeouts are 20 s (ally-ai), 22 s (ally-be's stream) and 25 s (`/agent/run`); one shared runner per app, with `final` equal to the plain response.
- **Tokens are cut after the run, not as nodes finish.** That is the simplest way to guarantee no unchecked text, and it needs no node of its own (there is no `finalize` node since #223). The cost is that text appears only at the end of the run; the status line and steps carry the live feel, and the dashboard paces the reveal.
- **The same runner for both endpoints**, so `final` is `/agent/run`'s body by construction; a test checks the JSON is equal with the clock frozen. In ally-be, `final` is the very object `test()` returns.
- **The crisis gate lives in the engine,** where the crisis check runs (difference 4).
- **`showTyping` is not in the defaults object,** so `effective` and every existing settings fixture are unchanged; "on" is "not false".
- **The admin-only rule lives on the route,** as a pure helper (`changesAdminOnlySetting`), since `ChatbotSettingsService` has no access service and adding one would change every spec that builds it. A bot editor's save round-trips the stored value, so it isn't a change.
- **Live steps are for platform admins only,** matching the finished reply's Steps list.

## 5. Existing tests touched (assertions unchanged)

- `ally-ai/tests/core/agent_runtime/test_endpoint.py::test_a_bad_final_state_is_a_mapped_500` patches `run_agent` where the runner now calls it (`app.core.agent_runtime.runner.run_agent`), not on the endpoint module. Same assertion.
- `ally-be/src/whatsapp/service/test/whatsapp-inbound-agent.fixtures.ts` gained an optional `replies` override for the reply-service mock; its default is unchanged.
- No other existing test changed. `whatsapp-inbound-chatbot.spec.ts:457` (typing on a v1 bot) still passes: the default is on.

## 6. Tests added

| App | Spec | Count | Covers |
|---|---|---|---|
| ally-ai | `tests/core/agent_runtime/test_stream.py` | 17 | event order and headers; tokens spell the answer; **`final` equals `/agent/run`**; a refused draft streams only the rewrite, and no token before the last check; a textless decline streams none; a model failure is `error {upstream}` with no text; 404 when off; 504 and `error {timeout}` past the cap, with the model call cancelled; the agent step's timeout within the cap; closing the stream cancels the run; a new tool streams `searching`/step/`found` with no code of its own; `emit` outside a run; `chunk_reply` |
| ally-ai | `tests/core/llm/test_dispatch_timeout.py` | 4 | OpenAI and Anthropic get the timeout; none by default; the provider fallback gets what is left |
| ally-be | `chatbot/engine/test/chatbot-engine-streaming.spec.ts` | 9 | relay order; **decides exactly as without streaming**; text held until the crisis check clears; dropped on a crisis verdict; sent when the classifier fails; stream failure → v1 `v2_fallback`; no fallback once the client left; no events for v1; never streams to a channel that can't |
| ally-be | `chatbot/controller/test/chatbot-test-stream.controller.spec.ts` | 5 | events then **`final` = `/test`'s result**; `final` alone when nothing streams; a refusal before the run is a plain HTTP error; closing stops the run |
| ally-be | `ai/service/test/ai-agent-stream.spec.ts`, `ai/util/test/sse-parser.spec.ts` | 4 + 2 | relays and returns `final`; timeout → `AI_SERVICE_TIMEOUT`; other error or no `final` → 502; 404 classified; the parser across chunk boundaries |
| ally-be | `whatsapp/service/test/whatsapp-inbound-typing.spec.ts`, `chatbot/service/test/chatbot-settings-admin-only.spec.ts` | 6 + 6 | typing once, before the reply; off when `showTyping:false`; none for a crisis keyword; shown when the lookup fails; never holds up or fails the reply; none on STOP; what counts as changing the admin-only key |
| ally-web | `__tests__/ChatbotTestTabStreaming.test.tsx` | 6 | status line updates; steps live (admins only); text revealed; `final` replaces it, with the note when it differs; fallback to `/test` on an error status and on a network failure; never re-sent after the stream started |
| ally-web | `__tests__/ChatbotSettingsShowTyping.test.tsx` | 2 | hidden from non-admins; on by default; switching off saves `showTyping: false` |

## 7. Results

| Check | Result |
|---|---|
| ally-ai `pytest tests/` and `flake8` | **1,922 passed**, 32 skipped; flake8 clean |
| ally-be: chatbot, whatsapp, ai and llm specs; typecheck; lint on the touched folders | **874 tests** in the touched domains pass; typecheck and lint clean. The pre-commit hook ran the full suite on the ally-be commit, and it passed |
| ally-web: whole admin project (Node 22); CI typecheck; lint | **547 files, 8,399 tests pass**; typecheck clean; lint 0 errors (3 warnings in untouched files) |
| Conversation eval ([CHUNK-03C-EVAL.md](./CHUNK-03C-EVAL.md)) | 42 turns: **0 hard fails**, 0 check fails, judge mean **4.50** (3r: 4.50), agent p50 **7,221 ms** against v1's 9,335 ms (−23%; 3r: 6,878 ms) |
| Eval `--stream` ([CHUNK-03C-EVAL-STREAM.md](./CHUNK-03C-EVAL-STREAM.md)) | 42 turns: **0 hard fails**, no stream problems (order, text before the check, tokens against `final`); 3 check fails of known kinds (`out-mausam` a polite weather decline labelled small talk; a topic list in later small talk; `gen-what-is-cbt` declined); judge mean 4.50; p50 7,470 ms; **p50 time to the first event: 8 ms** |
| Parity | **Not run:** #223 removed the parity path and `scripts/agent_parity.py` with it, so there's nothing left to compare | <!-- docs-path-lint: ignore -->

**The first plain eval run had 2 hard fails, both 504s from the new 20 s cap** (`ab-how-works`, `ab-hinglish`). Those cases normally take 7–9 s: 7.4 s and 7.1 s in 3r, 12.8 s and 13.8 s in the streamed run, and 8.2 s and 8.9 s when re-run alone. The run overlapped with the local ally-be container compiling at about 490% CPU on the same machine. The full re-run above is clean. On a real message, a 504 there means ally-be answers with v1, which is what the cap is for.

**Live checks in the dashboard (local stack, Ally FAQ, which locally has one document attached):**
- "how do I get access?":
  - typing dots at 1 s;
  - the agent's and the tool's steps filling in by 4 s;
  - "Writing the reply…" and the text revealing by 10 s;
  - then the finished reply, with Steps (4), "Answered by the agent" and Question.
- "I want to kill myself" (a crisis keyword): the fixed crisis reply alone, in 4 ms; nothing streamed.
- "honestly I can't go on anymore, there is no point to anything" (no keyword; the classifier catches it): only the crisis reply, with "Would alert: Chatbot Crisis Classifier". No agent text was shown, and there was no "Updated" note, so none had been revealed.
- `AGENT_RUNTIME__ENABLED=false`:
  - The stream returns 404, recorded as `upstream_404`, and ally-be answers with v1, marked "Answered in safe mode (the agent failed: upstream_404)", with the degraded alert.
  - The first try after recreating ally-ai timed out in v1 itself: an 18 s OpenAI embeddings call on a cold container. It showed the error reply with the same fallback badge, which is chunk 2's rule.
  - The second try returned v1's cited answer in 10.6 s.
- Settings → General → Basics: "Show typing on WhatsApp", on, with its help text, for a platform admin.
- ally-ai alone (`curl -N` on `/api/v1/agent/run/stream`): `run_started`, `thinking`, the `agent` step, `checking`, the `check` step, `writing`, 11 `token`s, then `final`, in 6.8 s.

Not checked: WhatsApp's typing dots (no number is connected locally). Covered by `whatsapp-inbound-typing.spec.ts` and the existing provider spec.

## 8. How Shehbaz tests it

**Ports:**
- dashboard: http://localhost:8081
- ally-be: `localhost:8001` (`ally-be-app-1`)
- ally-ai: `localhost:3001` (`ally-ai-app-1`, a baked image)

1. **Suites and lint:**
   ```bash
   cd ally-ai  && poetry run pytest tests/ -q && poetry run flake8
   cd ally-be  && npm test -- --forceExit --detectOpenHandles && npm run lint && npm run typecheck
   cd ally-web && nvm use 22 && npm test && npm run lint && npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json
   ```
   Focused runs:
   - `poetry run pytest tests/core/agent_runtime/test_stream.py tests/core/llm/test_dispatch_timeout.py -q`
   - `npx jest src/chatbot src/whatsapp/service/test/whatsapp-inbound-typing.spec.ts src/ai`
   - `npx vitest run --project ally-admin-dashboard src/pages/WhatsAppBot`
2. **Rebuild ally-ai:** `cd ally-ai && docker compose -f docker-compose.local.yml up -d --build app`. Restart `ally-be-app-1` if it was running (see open items on its memory).
3. **Preview** (Ally FAQ → Preview → New thread): send "how do I get access?" and watch the dots, the status line ("Looking up …", "Checking the answer…", "Writing the reply…"), the steps (platform admins) and the text revealing. Then send "and after that, how do I sign in?", "what's your refund policy?" and "thanks".
4. **Crisis:** a keyword ("I want to kill myself") and a phrase only the classifier catches. Expect only the crisis reply and no revealed text.
5. **Fallback:**
   - Set `AGENT_RUNTIME__ENABLED=false` in `ally-ai/.env`.
   - Run `docker compose -f docker-compose.local.yml up -d --force-recreate --no-deps app` and ask a question. Expect "Answered in safe mode (the agent failed: upstream_404)".
   - Put the flag back.
6. **Settings → General:** "Show typing on WhatsApp" for platform admins only. With a WhatsApp number connected, the dots show right after you send, unless it is off or the message is a crisis keyword.
7. **Eval:**
   ```bash
   cd ally-ai
   KEY=$(grep '^API__X_API_KEY=' .env | cut -d= -f2-)
   API__X_API_KEY=$KEY poetry run python scripts/agent_conversation_eval.py --cases tests/fixtures/agent_conversation_cases.yaml --out eval_report.md
   API__X_API_KEY=$KEY poetry run python scripts/agent_conversation_eval.py --cases tests/fixtures/agent_conversation_cases.yaml --out eval_stream.md --stream
   ```
   Add `--corpus-db postgresql://postgres:<pw>@localhost:5477/ally_local` to check contact details against the documents.

## 9. Open items

- **True token streaming of drafts** (out of scope): streaming the model's words as they're written would need the draft to pass the check first, which it can't. A possible later option, for low-risk bots only.
- **The website widget** reuses `/test/stream`'s pattern and the `streaming` capability: chunk 13 in `v2-chunks.md` (the brief says 21).
- **Text arrives at the end of the run.** Status and steps are live within about 1 s; the reply's text appears once the run is done, revealed over up to 3 s. "Time to the first event" is 8 ms, but the time to the first word is the run's length.
- **The local ally-be container runs out of memory** under `nest start --watch` (`Dockerfile.dev` caps Node at 4 GB). It crashed once during this chunk after a large `git pull`, and the cold compile peaks at about 4.6 GB. Raise `--max-old-space-size` locally, or watch with SWC. This is not changed here, since it affects every developer.
- **`BaseHTTPMiddleware`** (ally-ai's two middlewares): a disconnect does cancel the run in the unit test (the generator's `finally`). Uvicorn behind the middlewares wasn't exercised with a real dropped connection. If an abandoned Preview run is ever seen finishing in the logs, convert the middlewares to pure ASGI.
- **Cold first call (fixed in this chunk):**
  - **Cause:** the first question after an ally-ai container started took 4–18 s longer. LangChain's `OpenAIEmbeddings` downloads tiktoken's `cl100k_base` tokenizer (1.7 MB) into `/tmp` on first use, and every new container, every deploy included, did that on the first question it searched.
  - **Effect:** with the 20 s cap, that first run could fall back to v1. Once, with the runtime off, it turned v1 itself into the error reply.
  - **Fix:** both `Dockerfile` and `Dockerfile.baremetal` now fetch the tokenizer at build time into `TIKTOKEN_CACHE_DIR=/app/.tiktoken-cache`.
  - **Checked:** on a freshly recreated container, the first searching question took 9.6 s, with no download.
  - **Not done:** a startup warm-up call, which would also open the OpenAI connection early.
- **The 504 under load:** two eval turns hit the 20 s cap while the machine was busy. In production, watch for `Agent stream ended with timeout` and `/agent/run` 504s; if they show up, the cap or `RUN_BUDGET_SECONDS` (15) may need tuning.
- **The crisis classifier misfires on ordinary follow-ups.** While the demo was being recorded, "and what if I miss a day?" (about streaks) was flagged as a crisis and got the crisis reply. Streaming behaved correctly: no agent text was shown. The misfire itself is the classifier problem already open in CHUNK-03D-NOTES. It needs a decision before real users: a confidence floor, a prompt change, or a per-bot setting.
- **Wiki:** `/agent/run/stream` and `/test/stream` belong on the ally-ai and ally-be wiki pages (same `Wiki-PR:` trailer as before).

## 10. Commits, in review order

```
5942cc564 docs(agents-v2): chunk 3c brief, building blocks, revised chunk plan with 3d; current chunk 03c
0e6cf8cb2 docs(agents-v2): chunk 03c code map
c6c8bc3ec feat(agent-runtime): /agent/run/stream on one shared runner; hard run timeout
852238543 feat(chatbot): Preview streams the agent's steps and checked reply; per-bot Show typing
4bc860489 feat(admin-dashboard): Preview streams the agent at work; Show typing toggle
bc695b7ac docs(agents-v2): chunk 03c notes and conversation evals
1b4f58f7c build(ally-ai): bake the embeddings tokenizer into the image
b95b0f367 feat(preview): the agent's work as a live activity feed; reply typed at reading pace
987e77c83 fix(admin-dashboard): "Worked for" stops when the reply arrives, not after it is typed out
(this commit) docs(agents-v2): chunk 03c notes: the activity feed and the classifier misfire
```
