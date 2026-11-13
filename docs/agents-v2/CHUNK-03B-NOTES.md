# Chunk 3b notes: the tool gateway

**Brief:** [chunk-3b.md](./chunk-3b.md). **Branch:** `feat/agents-v2-fast-track`; commits tagged `[3b]`, not pushed. **Baseline:** `bd9c53132` (15a's last commit). Plan approved 13 Nov with Shehbaz's changes (abilities per bot only, the summary is personal, an empty summary still hands over, the migration's down).

> Status: **built, waiting for Shehbaz's review** (13 Nov 2026).

## Report: 3b is done

The assistant can now ask ally-be to do something, through one gateway, once per run step. The proving tool, `hand_over`, is **off for every bot**; with it off, every run is exactly today's.

| Check | Result |
|---|---|
| A `hand_over` call in the run's trace and in `tool_runs` | ✅ trace step `hand_over: ok`; one `ok` row per run, same run id as the reply |
| The same call replayed runs once | ✅ curl, same `run_id`/`step` twice: `replayed: false`, then `replayed: true`; one row |
| Refused: tool off, tool not in the token, bot A → bot B, a Debrief token | ✅ specs (unit and Postgres); live: no key 401, unknown tool 404, platform-wide `abilities` 400 |
| `hand_over` off everywhere: 3a eval | ✅ **0 hard fails** (in scope 100% same documents as v1; p50 agent 6.5 s vs v1 8.5 s) |
| `hand_over` off everywhere: basics on Sunrise | ✅ 28 of 28, 0 must-pass failed, 0 crisis misses, 0 false alarms (same as 15a's run) |
| `hand_over` on: `cases/handover.json` on Sunrise, ×15 | ✅ 15 of 15 got the hand-over message |
| Gateway latency (trace ms, 15 calls) | **median 33 ms, worst 308 ms**; whole reply median 3.9 s, worst 5.7 s |

| Commit | What |
|---|---|
| `70d2fc132` | docs: brief, fast-track update, current chunk |
| `1b9ace682` | ally-be: `tool_runs`, the run token, the gateway, `hand_over` |
| `5c47e6268` | ally-be: `abilities`, the engine's hand-over, no v1 after an action, erasure and retention |
| `0d46b5a8c` | ally-ai: gateway tools and `hand_over` |
| `e1696b65e` | ally-web: the inbox's "Your assistant passed it on" |
| `35241573d` | ally-ai fix from the live run: each gateway tool once a run (§5) |
| `3d23ccc47` | basics: `cases/handover.json`, gateway steps in the report, `tool_runs` cleanup |
| this one | notes, `LAUNCH-CHECKLIST.md` lines, the 3b row in `v2-chunks.md` |

**Local state:** Sunrise (`abdfd2d1`) has `abilities` removed again (its overrides are what they were). One bot-page chat ("Visitor · 8533") is left under Needs a person with "Your assistant passed it on", and two `tool_runs` rows (that chat and one Try it run). ally-be's local `.env` gained `PUBLIC_API_BASE_URL=http://host.docker.internal:8001` (§5); without it ally-ai can't reach the gateway from its container.

### How Shehbaz tests it

1. **Turn it on** for a local assistant, as a platform admin: `GET /api/v1/chatbots/:id/settings`, add `"abilities": { "hand_over": "do_it" }` to `overrides`, `PUT` them back as `{ "settings": … }`. The response's `effective` has no `abilities`; that's on purpose.
2. **Try it:** "can someone from your team call me back about my bill?" → "I've asked the team to join. They usually reply within a few hours." Nothing new in the inbox.
3. **Its bot page,** a new chat, the same message → the same reply; in AI Chatbots → Inbox → Needs a person: "Needs a person · Your assistant passed it on".
4. **`tool_runs`:** `select tool, status, duration_ms from tool_runs order by "createdAt" desc limit 3;` → one `hand_over | ok` for that run.
5. **Turn it off** (remove `abilities`, `PUT` again): the same question gets an ordinary reply.

Also: `npm run chatbot:basics -- --bot <id> --cases src/chatbot/basics/cases/handover.json --only handover-call-back --repeat 5` with it on (in the container: `docker exec -w /app ally-be-app-1 node dist/chatbot/basics/run-basics.js …`).

## 1. Code map

**ally-be** (`src/chatbot/agent-tools/`):

| File | What |
|---|---|
| `agent-run-token.service.ts` | HS256 run token. Secret: `AGENT_GATEWAY_SECRET`, else HMAC(access secret, `agent-gateway-v1`). Claims `{ kind: 'chatbot_run', chatbotId, conversationId, runId, contactId \| null, tools }`, 2 minutes. `gatewayUrl()` = `PUBLIC_API_BASE_URL` + `/api/v1/internal/agent` |
| `agent-gateway.controller.ts` | `POST /api/v1/internal/agent/tools/:name`, `@Public()`, hidden from Swagger, 200 |
| `agent-gateway.service.ts` | The checks in order, the claim, the run, the record (§3) |
| `tools.ts` | `AgentGatewayTool` (`name`, `parse`, `run`), `AgentToolRegistry`, `abilityOn` (reads the bot's stored override only) |
| `hand-over.tool.ts` | `hand_over` |
| `test/` | `agent-gateway.spec.ts`, `hand-over.tool.spec.ts` (fakes in `agent-tools.fakes.ts`), `agent-gateway.pg.spec.ts` (real Postgres) |

Elsewhere in ally-be: migration `1981900949000-AddToolRuns`, entity `chatbot/entity/tool-run.entity.ts` (`ToolRunStatus`); `common/util/service-key.ts` (`isServiceKey`, moved from the context-library controller, which re-exports it unchanged); `config.agentGatewaySecret`; `NeedsPersonReason` / `NEEDS_PERSON_REASONS` in `handover/handover.ts`; `ChatbotSettingsOverride.abilities`; `AgentRuntimeRunner.requestFor` and `actedIn`; `AgentActedError`; the engine's hand-over branch in `answer()`; `ChatTurn.contactId`; `dropIntake` / `dropToolRuns` / `blankBefore` in `conversation.service.ts`.

**ally-ai** (`app/core/agent_runtime/`): `gateway.py` (`AgentGatewayClient`, `AgentRunContext`); `tools/gateway.py` (`gateway_tool`); `tools/hand_over.py`; `tools/__init__.py` (`search_tools`, `gateway_tools`, `allowed_tools`); `budget.py` (`MAX_TOOL_STEPS = 4`, `search_budget`, `searches`, `steps_left`); `nodes/tools.py` (the gateway branch, `route_after_tools`); `graph.py` (`context_schema`, `tools → END`); `prompt.py` (`format_searches`); `runner.py` (client per run, closed in `finally`); `app/schemas/agent_runtime.py` (`AgentGateway`, `handover`). Tests: `tests/core/agent_runtime/test_gateway_tools.py`.

**ally-web:** `api/inbox.ts` (the type), `pages/Inbox/copy.ts` (`reasons.assistant`), the inbox test; copy deck §23 Reasons.

## 2. The token and the table

- **Two credentials, both required:** `x-api-key` = the key ally-be already sends ally-ai (`AI_SERVICE_OUTBOUND_API_KEY`; ally-ai holds the same value as `API__X_API_KEY` and sends it back), compared in constant time; and the run token.
- **Debrief and this gateway never accept each other's tokens:** different derived secrets, and even with the same explicit secret the claims differ (Debrief's `verify` needs `sessionId`, ours needs `kind: 'chatbot_run'`). A user's JWT is never a run token: no `kind`, and the platform's JWT strategy refuses any token with one.
- **`tool_runs`:** one row per call, unique on `(run_id, step)`; `conversation_id` is text (Preview's `preview-…`); `input` jsonb; `status` `started | ok | error` (CHECK, enum `ToolRunStatus`, covered by `check-constraints-cover-enums.spec`); `result`, `error_code`, `duration_ms`. `DATA_SCHEMA.md` has the row.
- **The token stays out of state:** the bot block carries `gateway_tools` (names only); the client goes to the graph as LangGraph runtime context, which isn't checkpointed (not `configurable`, whose plain values LangGraph copies into checkpoint metadata). `token` is a `SecretStr`. A test checks the token is in no state, checkpoint history, response or captured log.

## 3. What a call does, and what a replay does

Checks, in order: the key (401) → the token's signature, expiry and kind (401) → the tool exists (404) → the token lists it **and** the bot's stored `abilities[tool] === 'do_it'`, re-read now (403) → the body is exactly `{run_id, step, input}`, `run_id` is the token's (403), `step` 0–3, the tool's own parse refuses unknown input fields (400).

Then `INSERT … ON CONFLICT (run_id, step) DO NOTHING RETURNING id`:
- **Inserted:** the tool runs; the row becomes `ok` (result) or `error` (code); ms recorded.
- **Already there, `ok` or `error`:** the stored outcome comes back with `replayed: true`, whatever the input says now, and nothing runs. A stored error is replayed, not retried.
- **Another tool or bot at that step:** 409 `step_taken`.
- **`started` and over 30 s old:** claimed again with a conditional `UPDATE … WHERE status = 'started' AND "updatedAt" < now() - 30 s`, then runs.
- **`started` and younger:** 409 `in_progress` (a concurrent duplicate).

Every answer is `{ ok, result | error, replayed }`. Logs carry the tool, status and ms only.

**`hand_over`:** Preview → `ok`, nothing changes. Otherwise the conversation must be a stored one of the token's bot (else `ok: false, error: 'no_conversation'`: WhatsApp while `sharedStoreWrites` is off, or another bot's chat). It keeps a non-empty summary in `metadata.handover.summary` (≤ 300; empty is fine and stores nothing), then `markNeedsPerson(…, 'assistant')`, which keeps the first reason and tells the inbox. 11a's email sweep picks it up like any Needs a person chat.

**In the engine:** crisis still wins first. `handover: true` → `{ handledBy: HANDOVER, body: handoverMessage(…), handover: 'assistant' }`. If a run with a gateway fails (not an abort), the runner reads `tool_runs` for the run id: a `hand_over` that's `ok` → the same hand-over reply, `runtime: v2_fallback`; any other `ok` tool → the bot's fallback text; nothing → v1, as before. `afterDecision` marks only `asked`.

**Erasure and retention:** `eraseConversations` and `eraseContact` delete the threads' `tool_runs` rows and drop `metadata.handover` with `metadata.intake`; `blankBefore(cutoff)` deletes rows older than the cutoff and drops `handover` with `intake`. Postgres specs in `conversation-service.pg.spec.ts`.

## 4. The loop in ally-ai

- Searches keep their own limit (`MAX_TOOL_CALLS`, 2) and "found nothing new" ends searching only. `{tool_budget}` is still "searches left".
- At most 4 tool steps of any kind (`MAX_TOOL_STEPS`). A gateway tool's `step` is its index in the run.
- Gateway tools emit no status; their trace step is `hand_over: ok` or `hand_over: error <code>`, with ms.
- A failed call is a record the agent reads in `{searches}`: ``- `hand_over`: failed (timeout), not done``. A success that `ends_run` sets the result (an empty decline, no citations, `handover: true`) and the graph goes `tools → END`, skipping the model and the check.
- `handover` is in the response only when true, so every other response is byte-for-byte today's.
- Forced to search (`must_search`), the step is offered searches only.

## 5. Mismatches with the brief, and decisions

- **Service secret:** other inbound service calls check `API_KEY`; the brief's `ai.outboundApiKey` works with no new variable because ally-ai holds the same value. Built as the brief says.
- **`needs_person_reason` has a CHECK constraint** (`1981330000000-AddInbox`): the migration drops and re-adds it with `assistant`; down maps `assistant` to `asked` first (tested on a scratch database with a row present).
- **New model-facing text beyond the description:** the failure line in `{searches}` (above). It's code-formatted like "nothing relevant or new".
- **The summary has no field description;** `format_tools` renders ``- `summary`: summary``. The 300 limit is a clip in ally-ai (a schema limit would fail an over-long step and crash the run); ally-be still answers 400 over 300.
- **A concurrent duplicate gets 409 `in_progress`;** the brief only covers the stale case.
- **Each gateway tool once a run (found live, `35241573d`).** With the gateway unreachable, the agent called `hand_over` again after each failure until the 4-step cap; four 5 s waits ran the run past its 20 s cap, and v1 answered. A tool that ran this run, ok or not, isn't offered again.
- **`contactId` on `ChatTurn`** (the token claim only): set by the bot page and the basics runner. **WhatsApp leaves it null:** its shared-store contact is resolved by the async mirror and isn't known when the engine runs; nothing reads the claim yet. 8a should set it when memory needs it.
- **`abilities` never reaches the effective settings** (`applyOverride` drops it), so nothing can read it from there by mistake.
- **`basics-evaluate.ts`** counts `assistant` as a hand-over too.
- **The 4-step cap also caps searches** if `MAX_TOOL_CALLS` is ever set above 4 (the default is 2).
- **`.env` locally:** `PUBLIC_API_BASE_URL` was unset, so the gateway URL was `http://localhost:8001`, unreachable from ally-ai's container. Debrief has the same dependency (see the launch checklist).

## 6. Open, for later chunks

- **Whether a write must wait for the crisis check** (brief, Decided): today a hand-over made in a run whose message the crisis check flags stays, and the chat shows Safety and Needs a person. For 6, before any tool that writes the owner's lists.
- **3a's two retrieval-log items** that say "chunk 3b" (later searches in the same message aren't logged; tool searches aren't in the retrieval log) aren't in this brief; still open.
- **The Overview's "Handed to a person"** counts team replies (`handled_by = 'human'`), not hand-overs; asked and `assistant` hand-overs read 0 until someone replies. Not changed.
- **With `hand_over` off,** the agent sometimes promises "tell me … and I'll pass it on" with nothing behind it (seen in Try it). Agent wording, from before 3b.
- **The summaries are long:** the model writes 2–3 sentences, sometimes clipped at 300, and sometimes guesses the channel ("reply in WhatsApp" on the bot page). They're shown nowhere yet; worth a look when the inbox shows them.
- **ally-web lint** has one error in `ally-helpline-dashboard/…/CustomFieldValuesPanel.tsx` (prettier), not from 3b. `nest build` needed `--max-old-space-size=8192` locally (already a checklist item).

## 7. Verification

- ally-be: full jest 1112 suites (6 failed on the first run: 5 WhatsApp inbound specs whose test modules needed the runner's new providers, fixed; `voice-note.service.spec` timing, passed on rerun); lint, typecheck, build. Postgres specs on a scratch DB: `conversation-service.pg.spec` 19, `agent-gateway.pg.spec` 6.
- ally-ai: `pytest tests/` 2488 passed (before the once-a-run fix; agent runtime 294 after it); flake8 clean.
- ally-web: `npm test` (600 + 48 files), `tsc` clean.
