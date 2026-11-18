# Chunk 2 — Runtime switch: wire ally-be to the new engine

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, then `docs/agents-v2/CHUNK-01-NOTES.md` (what chunk 1 actually built), then this whole file, before writing code.
> Branch: `feat/agents-v2-chunk-02-runtime-switch`, **created from `feat/agents-v2-chunk-01-langgraph-runtime`** (chunk 1 isn't merged yet; rebase onto master once it is).
> Repos: **ally-be** (most of the work), **ally-web** (one setting and the Preview panel), **ally-ai** (one small request flag).

## Why this chunk exists

Chunk 1 built `POST /api/v1/agent/run` and proved it answers like `/knowledge-agent/answer`, but nothing calls it. This chunk lets a platform admin move **one bot at a time** onto the new engine, watch it in Preview, run it in **shadow** beside v1 on live traffic, and switch back instantly. After this chunk, the Ally FAQ bot can answer real WhatsApp messages through LangGraph.

## What exists (verify in code)

- `ChatbotEngineService.respond` in `ally-be/src/chatbot/engine/chatbot-engine.service.ts` runs: quick replies → access → answer. The answer step calls ally-ai `/knowledge-agent/answer` and, in parallel, `/knowledge-agent/crisis-check`. A crisis verdict replaces the answer. It never sends or stores anything; channels do that, which is why Preview runs the exact production path.
- The bot's model is merged into `prompts[...]` for the two answer prompts (around lines 428–487). The empty-selection placeholder id is set around lines 45 and 404.
- Settings use defaults (the `global_settings` row `whatsapp_bot`) plus per-bot overrides (`ChatbotSettingsService.applyOverride`). Safety only tightens.
- Preview: `POST /v1/chatbots/:id/test` runs the real engine, and sends and stores nothing.
- Inbound WhatsApp: SQS consumer, then dedupe on the provider message id (first write), then … `respond` … then send and record. The rule: throw only before sending.
- `/agent/run` request = every `KnowledgeAnswerRequest` field + `conversation_id` (required), `run_id`, `runtime_version`, optional `chatbot_id`. Response = the old response + `run_id`, `trace`, `runtime`. Off → 404. Check `CHUNK-01-NOTES.md` for the exact names.

**First step:** map the real code (engine, the ally-ai client in ally-be, settings service, the Preview controller and service, `wa_messages` columns, the chatbot entity and DTOs, the dashboard Settings and Preview components) and add a "Chunk 2 code map" section to a new `docs/agents-v2/CHUNK-02-NOTES.md`. Note every difference from this brief. The code wins.

## Goal

1. A per-bot **`runtime`** setting: `v1` (default) | `shadow` | `v2`, plus a **`features`** jsonb (empty for now; later chunks add flags).
2. A **platform kill switch**: a `whatsapp_bot` defaults setting `agentRuntimeAllowed` (default `false`). When false, every bot behaves as `v1` whatever its own setting.
3. **v2:** the engine's answer step calls `/agent/run` instead of `/knowledge-agent/answer`. Everything before it (quick replies, access, kill switches, consent, crisis keywords) and the parallel crisis check stay exactly as they are.
4. **shadow:** v1 answers the person exactly as today. In the background, after the reply has gone out, the same request goes to `/agent/run`, and both results are saved for comparison. Shadow must never delay, change or break the real reply.
5. **Fallback:** if `/agent/run` fails for a v2 bot (connection error, timeout, 404, or 5xx) **before an answer exists**, answer that message with v1 and raise a "degraded" alert, the same way a failed classifier does today. Never call both and send twice.
6. **Preview** shows which engine answered, the `run_id` and the trace steps. Platform admins can force v1 or v2 for one test to compare.
7. The `run_id` and runtime are **stored on the outbound message**, so chunk 10 ("Why?") can find the run from a reply.

## Out of scope

- No tools, memory, context files or changes to the graph. Those are chunk 3 onwards.
- No change to v1 behaviour, to the crisis check or to anything before the answer step.
- No new dashboard pages. Only the Settings field and the Preview panel.
- No change to prompt text.

## Design

### Data (ally-be migration)

- `chatbots.runtime` varchar not null default `'v1'`, check in (`v1`, `shadow`, `v2`).
- `chatbots.features` jsonb not null default `'{}'`.
- The outbound message gets the run reference. If `wa_messages` already has a metadata jsonb, use it (`agent_run_id`, `agent_runtime`). Otherwise add nullable `agent_run_id` (uuid) and `agent_runtime` (varchar).
- New table `agent_shadow_runs`: `id`, `chatbot_id`, `conversation_id`, `inbound_message_id`, `run_id`, `v1` jsonb (intent, decline_reason, cited chunk ids, hit_count, top_similarity, latency_ms), `v2` jsonb (same fields plus trace step count), `error` text null, `created_at`. Store **no question or answer text** here; the conversation already holds it.
- Defaults: add `agentRuntimeAllowed: false` to the `whatsapp_bot` row through the existing settings mechanism.
- Use the repo's migration naming and keep the timestamps after the latest existing one.

### Engine

- Resolve the effective runtime: if `agentRuntimeAllowed` is false, then `v1`; otherwise the bot's `runtime`.
- **`run_id`:** derive it deterministically from the inbound provider message id (uuid v5 under a fixed namespace) for WhatsApp, and use a random uuid for Preview. An SQS redelivery that gets past dedupe then reuses the same run id.
- **`conversation_id`:** the `wa_conversations` id for WhatsApp. For Preview, a client-supplied `preview-<uuid>` that the dashboard keeps until "New thread" is pressed. Without one, generate a fresh one per test.
- Build the `/agent/run` body from **exactly the same** fields as today's request, plus `conversation_id`, `run_id`, `chatbot_id` and `runtime_version: "v2"`. Put this in one shared builder so v1 and v2 can't drift.
- Map the response back into the engine's existing decision shape. The extra fields (`run_id`, `runtime`, step count) go into a new optional field on the decision, so channels can store them.
- The crisis check runs in parallel exactly as today, and a crisis verdict still replaces the answer, whichever runtime answered.
- Timeouts: use the same timeout as the v1 answer call.

### Shadow

- Runs only for real inbound messages, never Preview, and only after the real reply has been sent and recorded. Fire-and-forget, with its own try/catch: it can't throw into the inbound handler or trigger an SQS retry.
- Calls `/agent/run` with `log_retrieval: false` (see ally-ai below), so retrieval isn't logged twice.
- Writes one `agent_shadow_runs` row comparing v1 and v2 on the same fields the parity script uses.
- Add a small script or SQL in NOTES that summarises a bot's shadow week: match rate on intent and decline reason, citation overlap, and p50/p90 latency for each runtime.

### ally-ai (small)

- `/agent/run` accepts an optional `log_retrieval: bool = true`. When false, the graph skips `_report_retrieval`. This is the "suppress flag" chunk 1 left open.
- Add a test, and update `CHUNK-01-NOTES.md`'s open item to say it's resolved.

### API and dashboard

- `PATCH /v1/chatbots/:id` (or the settings route, whichever owns bot fields today) accepts `runtime`. **Only platform admins** can change it. Others get 403, and the field is hidden from them in the UI.
- `GET` returns `runtime`, `features` and the effective runtime (so the UI can show "v2 (disabled platform-wide)").
- `POST /v1/chatbots/:id/test` accepts optional `runtime` (platform admins only) and `conversation_id`, and returns `runtime`, `run_id` and the trace.
- Dashboard **Settings:** an "Engine" field with v1, Shadow and v2, a one-line explanation of each, and a note when it's disabled platform-wide. **Defaults** (platform admins): an "Allow the new engine" toggle.
- Dashboard **Preview:** a small badge "Answered by v1/v2", the run id (copyable), a collapsible list of the trace steps with milliseconds, a "New thread" button, and for platform admins an engine picker for this test only.

## Tests

**ally-be (jest):**

- Effective runtime: kill switch off → v1 for v2 and shadow bots; kill switch on → the bot's own setting.
- v2: `/agent/run` called once with the shared builder's body plus the four extra fields; `/knowledge-agent/answer` not called.
- The v1 path's request body is unchanged: snapshot it before and after.
- Fallback: `/agent/run` returning 404, 500 or a timeout → v1 called once, a degraded alert raised, exactly one reply.
- A crisis verdict still overrides a v2 answer.
- Shadow: the reply is sent before shadow starts; a shadow failure is caught and logged, never rethrown; shadow isn't called for Preview; the `agent_shadow_runs` row has no message text.
- `run_id` is deterministic for the same provider message id.
- Only a platform admin can set `runtime`.
- The outbound message stores `agent_run_id` and `agent_runtime` for v2 and fallback replies.

**ally-web:** the Settings field is visible only to platform admins; the Preview badge and trace render from a mocked response.

**ally-ai:** `log_retrieval: false` skips the retrieval log; the default still logs once.

All existing tests pass unmodified in all three apps. Lint and typecheck are clean (`npm run lint`, `npm run typecheck`; ally-web's CI typecheck; `poetry run flake8`).

## Done when

- [ ] The migration runs on a fresh database and on the current local database; every existing bot is `v1`, and the kill switch is off
- [ ] v1 bots behave exactly as before (request snapshot unchanged, all tests green)
- [ ] A v2 bot answers through `/agent/run` in Preview and on WhatsApp; the run is stored and linked from the message
- [ ] A shadow bot replies with v1, and `agent_shadow_runs` fills in without slowing the reply
- [ ] Fallback works and alerts
- [ ] The Settings field, the Defaults toggle and the Preview panel work; the field is restricted to platform admins
- [ ] `CHUNK-02-NOTES.md` has the code map, decisions, how to test, the shadow summary query and open items
- [ ] Commits per milestone; a PR body is ready (with the `Wiki-PR:` trailer if the docs map requires it)

## How Shehbaz tests it

1. Run the tests and lint in ally-be, ally-web and ally-ai, then run the migrations.
2. **Setup:** in the dashboard, attach all 7 "Ally FAQ –" documents to the Ally FAQ bot. In Defaults, turn on "Allow the new engine".
3. **Preview, side by side:** pick v1 and ask "What does Ally do?", then pick v2 and ask the same thing. You should get the same decision and similar citations; the v2 one shows a run id and 7 trace steps. Ask a follow-up, then press New thread.
4. **Switch the bot to v2.** If a WhatsApp number is connected locally (tunnel and allow-listed phone), message it from your phone: the answer arrives, and the outbound row has `agent_run_id`. If no number is connected, Preview in step 3 covers it, and WhatsApp is tested after deploy.
5. **Fallback:** stop the ally-ai flag (`AGENT_RUNTIME__ENABLED=false`) and ask again. You still get an answer (from v1) and a degraded alert.
6. **Shadow:** set the bot to Shadow and send 5 messages, through WhatsApp or by replaying through the inbound handler. Replies come from v1, and `select * from agent_shadow_runs` shows 5 comparison rows with no message text.
7. **Kill switch:** turn "Allow the new engine" off. The v2 bot answers with v1 immediately, with no deploy.

Next: chunk 3, the agent node, tool registry and RAG as a tool.
