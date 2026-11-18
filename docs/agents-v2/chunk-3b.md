# Chunk 3b — Tool gateway

> Brief for Claude Code. Read `CONTEXT.md`, `v2-chunks.md` (3b), `three-stage-plan.md` (Stage 2 detail: endpoint and gateway), `agents-v2-spec.md` ("How the agent uses tools"), `CHUNK-03A-NOTES.md` (the agent and its tool registry) and `CHUNK-11A-NOTES.md` (Needs a person), then this file. Plan first, as usual.
> Branch: `feat/agents-v2-fast-track`. Tag commits `[3b]`. Repos: ally-ai and ally-be, plus one inbox label in ally-web.
> You're the only session on the branch: the tree and the local stack are yours. Start only after 15a's last commit.
> In your first docs commit, commit this brief and the updated `FAST-TRACK.md` (both written outside a session), and set the root `CLAUDE.md`'s current-chunk line to 3b (`chunk-3b.md`).
> No stop is planned. The one piece of new model-facing text, the `hand_over` description, is written below: use it as written. Stop only if something here can't be built as written.

## Why

The assistant can only answer. Lists (5a, 6), memory (8a) and, later, approvals all need one safe way for it to change something in ally-be: the agent decides and ally-be does it, with a per-run token and an idempotency key (`CONTEXT.md`, "Graph decides, ally-be executes"). 3b builds that gateway and proves it with one small tool, `hand_over`, which stays off for every bot. Owners see nothing new unless a platform admin turns it on.

## What exists (read it first)

- **ally-ai's tool registry, built for one tool:**
  - `ally-ai/app/core/agent_runtime/tools/base.py` and `ally-ai/app/core/agent_runtime/tools/__init__.py`, whose `allowed_tools` says the per-bot allow-list comes with 3b;
  - `ally-ai/app/core/agent_runtime/nodes/tools.py`, which assumes every tool is a search (`searching` and `found` statuses, passages);
  - `ally-ai/app/core/agent_runtime/budget.py`: one tool limit (`AGENT_RUNTIME__MAX_TOOL_CALLS`, 2 by default), ended early by a search that found nothing new;
  - `ally-ai/app/core/agent_runtime/prompt.py`: `format_tools` renders each offered tool's name, description and fields into `{tools}` in the agent prompt;
  - `ally-ai/app/core/agent_runtime/schemas.py`: the step schema, an `action` enum plus one input field per offered tool.
- **The same pattern, built for Debrief:**
  - `ally-be/src/debrief/service/debrief-run-token.service.ts`: an HS256 run token signed with `DEBRIEF_GATEWAY_SECRET` or a secret derived from the access secret, a `tools` claim, 401 and 403;
  - `ally-be/src/debrief/controller/debrief-gateway.controller.ts`: `@Public()`, `v1/internal/debrief/tools/:name`, the gateway URL built from `PUBLIC_API_BASE_URL`;
  - ally-ai's client, `ally-ai/app/core/debrief_graph/gateway.py`.
  Follow it, but share no secret and no token type with it.
- **Run ids:** `agentRunIdFor` in `ally-be/src/chatbot/engine/agent-runtime.ts` derives the run id from the channel's message id (WhatsApp and the bot page), so a redelivered message gets the same run id. Preview's are random.
- **Needs a person:** `markNeedsPerson` and `afterDecision` in `ally-be/src/chatbot/handover/handover.service.ts`, and `handoverMessage` in `ally-be/src/chatbot/handover/handover.ts`. The reasons today are `asked` and `declined_twice`.
- **Per-bot settings:** `ChatbotSettingsOverride` in `ally-be/src/chatbot/type/chatbot.type.ts`; `changesAdminOnlySetting` in `ally-be/src/chatbot/service/chatbot-settings.service.ts`, which is how `showTyping` is platform-admin only; `PUT /api/v1/chatbots/:id/settings` replaces a bot's overrides.

## Scope

### 1. The gateway (ally-be)

- `POST /api/v1/internal/agent/tools/:name`: `@Public()` to user auth and hidden from Swagger, like Debrief's.
- **Two credentials, both required:**
  - **the service secret:** `x-api-key`, equal to the key ally-be already sends ally-ai (`ai.outboundApiKey`), compared in constant time. No new variable;
  - **the run token:** `Authorization: Bearer`, HS256, signed by ally-be for one run with `AGENT_GATEWAY_SECRET`. When that's unset, use a secret derived from the access secret with its own label, so a Debrief token never verifies here, nor the reverse. Claims: `kind: 'chatbot_run'`, the chatbot, conversation and run ids, the contact id (null in Preview), `tools`, and a 2-minute expiry.
- **Checks, in this order:**
  1. the secret (401);
  2. the token's signature, expiry and kind (401);
  3. the tool exists (404);
  4. the token lists it, and the bot still has it on (403);
  5. the body (400; unknown fields are refused).
- **Tools act only on the token's bot and conversation.** No tool reads a bot, conversation or contact id from the body.
- Every call answers `{ ok, result | error, replayed }`.
- Locally, ally-ai reaches ally-be at `PUBLIC_API_BASE_URL`, as `ally-be/.env.example` shows (`host.docker.internal` from ally-ai's container).

### 2. `tool_runs`

- A new table, by an additive migration timestamped after `1981900948000` (H0's). Columns:
  - chatbot id;
  - conversation id, as text (Preview's ids aren't stored conversations);
  - run id, step and tool;
  - input (jsonb);
  - status: `started`, `ok` or `error`;
  - result (jsonb), error code and duration;
  - timestamps.
  It's unique on run id and step.
- A call claims its row (`started`) before it runs, then records `ok` or `error` and the result.
- **A replay** (the same run id and step, with the same tool) returns the stored result whatever its input says, with `replayed: true`. A model rephrases on a replay, but what was done stands.
  - Another tool at the same run id and step gets 409.
  - A `started` row older than 30 s can be claimed again.
- **Privacy:** inputs can hold what people said.
  - A conversation's rows go with `eraseConversations` in `ally-be/src/chatbot/service/conversation.service.ts`.
  - Old rows go with the shared store's retention sweep in `ally-be/src/whatsapp/service/whatsapp-retention.service.ts`, at the messages' cutoff.
  - Logs carry the tool, status and ms only: never inputs, results or the token.

### 3. The per-bot allow-list

- A per-bot override, `abilities`: `{ [tool]: 'do_it' | 'never' }`. A tool that isn't listed is `never`. (14a adds `ask_me_first`.)
- Platform admins only, with no screen yet: include it in `changesAdminOnlySetting`, and check that an owner's save from each settings screen keeps it as stored.
- ally-be signs a token and sends the `gateway` block only for a run whose bot has a `do_it` tool that ally-be serves. Otherwise the request is exactly today's.

### 4. Gateway tools (ally-ai)

- `AgentRunRequest` gains an optional `gateway`: `{ url, token, tools }`. Without it, a run is exactly today's: `search_knowledge` only, and the same prompt.
- **The token is a credential.** Keep it out of the run's state (which is checkpointed), its trace, LangSmith and the logs.
- **A gateway tool base:**
  - a tool is built from a name, description, input model, risk and `ends_run`;
  - its handler posts `{ run_id, step, input }` to `{url}/tools/{name}` with both credentials, a 5 s timeout and no retry inside the run;
  - `step` is the call's index in the run;
  - a new tool is one module on each side.
- **What's offered:** search tools as today, plus each gateway tool that the request names and ally-ai has.
- **The loop:**
  - Search keeps its own limit and rules: `MAX_TOOL_CALLS`, and "found nothing new" ends searching, not gateway tools.
  - At most 4 tool steps of any kind per run, inside the run budget (15 s; 20 s cap).
  - Gateway tools emit no `searching` or `found` status, since the bot page has copy for neither yet. Each adds a trace step: the tool, `ok` or its error code, and ms.
  - A failed call (a timeout, a 4xx or 5xx, `ok: false`) is a result the agent reads, never a crashed run. The agent must not say it worked.
- The agent prompt's text doesn't change: `{tools}` already shows each offered tool's description and fields.

### 5. The proving tool: `hand_over`

- **Description shown to the model, as written:** "Pass this chat to a person on the team. Use it when someone asks to talk to a person, when you can't help with what they need and the team can, or when they're unhappy with your answers. Never for someone at risk: that is handled before you. Write one line for the team about what they need."
- **Input:** `summary`, one line of at most 300 characters.
- **What ally-be does:**
  - marks the conversation Needs a person with a new reason, `assistant` (the first reason stays, as now);
  - keeps the summary in the conversation's metadata (`handover.summary`, not shown anywhere yet);
  - tells the inbox.
  - In Preview, it records the tool run and changes nothing else.
  - With no stored conversation to mark (WhatsApp while `sharedStoreWrites` is off), it fails with `ok: false`, never a silent success.
- **It ends the run.** After it succeeds there's no further model step. `AgentRunResponse` gains `handover: true`, and ally-be replies with 11a's hand-over message, in or out of hours, exactly as when someone asks for a person, with `handover: 'assistant'`.
- **No v1 after an action.** If a run fails after a gateway tool succeeded (a timeout or a 5xx), ally-be reads `tool_runs` for the run id instead of answering with v1. For `hand_over`, it sends the hand-over message. v1 never answers a message whose run has already done something.
- **ally-web:** the inbox's label for the new reason, `assistant`: "Your assistant passed it on". It goes in `ally-web/apps/ally-admin-dashboard/src/pages/Inbox/copy.ts` and the type in `ally-web/apps/ally-admin-dashboard/src/api/inbox.ts`, and in copy deck §23 (Reasons). Today an unknown reason shows as "undefined".
- **Off for every bot.**

## Decided

- `search_knowledge` stays in ally-ai with no gateway hop. Only tools that read or write ally-be data go through the gateway.
- Gateway calls time out at 5 s, with no retry inside a run. The idempotency key is the redelivery guarantee; don't rely on stored checkpoints (production stores none).
- **When the crisis check wins,** the crisis reply goes out as always. A hand-over the agent already made stays: the chat shows both Safety and Needs a person, and Safety sorts first. Whether a write must wait for the crisis check is a question for 6: put it in the notes.
- **Deploy ally-ai first, then ally-be.** Both changes are additive: older ally-ai ignores `gateway`, and older ally-be never sends a token, so no tool is offered.
- **No prompt text changes.** The `hand_over` description above is the only new model-facing text.

## Out of scope

- Ask me first and approvals (14a).
- An abilities screen.
- Memory, list and recall tools (8a, 5a, 6).
- Showing the summary in the inbox.
- Showing tool steps in Try it. It shows no steps today; the trace is in its response.

## Tests

- **ally-be:**
  - the token: signed and verified; expired; the wrong kind; a Debrief token refused here, and an agent token refused by Debrief's gateway;
  - the secret: a missing or wrong one is 401;
  - a tool that's unknown (404), missing from the token or turned off since the run started (403); unknown body fields (400);
  - bot A's token can't touch bot B's conversation;
  - `tool_runs`: a call runs once; a replay returns the stored result and runs nothing; another tool at the same step is 409; a stale `started` row is claimed again;
  - `hand_over`: Needs a person with `assistant`, the summary stored, the inbox told; Preview changes nothing; no stored conversation fails;
  - the engine: `handover: true` gets the hand-over message; a run that fails after `hand_over` gets the hand-over message, not v1;
  - `abilities` is admin-only and survives an owner's save;
  - erasure and the retention sweep remove `tool_runs` rows.
- **ally-ai:**
  - without `gateway`, the tools and the prompt are exactly today's;
  - a gateway tool is offered only when the request names it and it's registered;
  - a call sends both credentials, the run id and the step;
  - a timeout, a 4xx and a 5xx become failure results;
  - `hand_over` ends the run with `handover: true`;
  - search's limit and statuses are unchanged; the 4-step cap holds;
  - the token appears in no state, trace or log.
- **ally-web:** the inbox shows the new reason.
- Full suites, lint and typecheck in all three apps.
- **Evals:**
  - With `hand_over` off everywhere, the 3a conversation eval has 0 hard fails and the basics suite is unchanged.
  - Then, a basics case file for a local test bot with `hand_over` on: "can someone from your team call me back about my bill?" gets the hand-over message.

## Report (`CHUNK-03B-NOTES.md`) <!-- docs-path-lint: planned -->

- The code map, the token and the table.
- What a replay does.
- The latency a gateway call adds (median and worst, from the eval).
- Mismatches with this brief.
- The lines added to `LAUNCH-CHECKLIST.md`.

## Done when

- [ ] A `hand_over` call shows in the run's trace and in `tool_runs`
- [ ] The same call replayed runs once
- [ ] A tool that's off or missing from the token is refused; bot A's token can't reach bot B; a Debrief token is refused
- [ ] With `hand_over` off everywhere, nothing changes (3a eval, basics suite)
- [ ] `LAUNCH-CHECKLIST.md` has: deploy ally-ai before ally-be; ally-ai can reach `PUBLIC_API_BASE_URL` (Debrief already relies on it); `AGENT_GATEWAY_SECRET` set, or knowingly left derived
- [ ] `CHUNK-03B-NOTES.md` written; 3b's row in `v2-chunks.md`'s Progress table <!-- docs-path-lint: planned -->

## How Shehbaz tests it

1. **Turn it on for a local test assistant,** as a platform admin: `GET /api/v1/chatbots/:id/settings`, add `"abilities": { "hand_over": "do_it" }` to its `overrides`, and `PUT` them back.
2. **In Try it,** "can someone from your team call me back about my bill?" gets the hand-over message. Preview changes nothing in the inbox.
3. **On its bot page,** the same message gets the hand-over message, and the chat is under Needs a person with "Your assistant passed it on".
4. **`tool_runs`** has one row for that run, with status `ok`.
5. **Turn it off** (remove `abilities`): the same question gets an ordinary reply.
