# Chunk 03c notes: live agent (streaming steps and replies, WhatsApp typing)

**Brief:** [chunk-03c.md](./chunk-03c.md). **Branch:** `feat/agents-v2-chunk-03c-streaming`, from master after PR #223 (`chore/agents-v2-one-loop`: one agent loop, the parity path and Shadow removed) was merged. **Repos:** all three.

Plan approved 2026-11-06 at `~/.claude/plans/pasted-content-id-053d-we-re-starting-dynamic-turtle.md`.

## 1. Code map: what exists today (read before building)

### LangGraph's custom stream writer (installed langgraph 1.2.20)

- **`get_stream_writer`**: `langgraph/config.py:126` returns the run's writer: `get_config()[CONF][CONFIG_KEY_RUNTIME].stream_writer`.
  - Called outside a graph it **raises** `RuntimeError("Called get_config outside of a runnable context")` (`config.py:26-29`). The helper that emits must guard it.
  - The writer only forwards when `"custom"` is among the requested stream modes. Otherwise it is a no-op (`pregel/main.py:3368-3388`). `/agent/run` therefore pays nothing for emitting.
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
11. Stacks (product guidance) couldn't be searched: its MCP server wasn't connected in this session.

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
