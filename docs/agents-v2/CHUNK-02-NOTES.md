# Chunk 02 notes: runtime switch

**Branch:** `feat/agents-v2-chunk-01-langgraph-runtime`. On Shehbaz's instruction, chunk 2 stays on the chunk-1 branch, so there is **no** `feat/agents-v2-chunk-02-runtime-switch`. One PR covers chunks 1 and 2; see "Commits, in review order".

**Repos:** ally-be (most of the work), ally-web (the Settings field, the Defaults toggle and the Preview panel), and ally-ai (the `log_retrieval` flag).

## 1. Chunk 2 code map: what exists today (read before building)

### Engine
`ally-be/src/chatbot/engine/chatbot-engine.service.ts`, `ChatbotEngineService.respond` (L107). It runs in this order:
1. `audienceService.canChat`.
2. `replyService.match`, the keyword replies. A crisis keyword gets the fixed reply plus a "Chatbot Crisis Keyword" alert.
3. The access gate. A sender who isn't allowed goes to `refuse()`, which runs the crisis classifier first.
4. `answer()` (L224):
   - **Prompts:** `loadPromptOverrides` (L428) loads the four knowledge prompts from the Skills Store. The bot's model is merged into `ally_ai_knowledge_whatsapp_answer` and `ally_ai_knowledge_answer_general` only (L467-481).
   - **Knowledge:** `knowledgeFor` (L381). An `organisation` bot sends a tenant audience. A `selected` bot sends `document_ids`, with `NO_DOCUMENTS` (L45) substituted for an empty list (L404).
   - **Answer and crisis check:** `Promise.allSettled([aiService.answerKnowledgeQuestion(body), aiService.checkWhatsAppCrisis])`, with the body built inline at L232-248. A crisis verdict wins unconditionally (L256).
   - **Degraded classifier:** a classifier that didn't run gives `alert(500, 'crisis-classifier-degraded', …, 'Chatbot Crisis Classifier Degraded')` (L279-302).
   - **Answer call failed:** `WaHandledBy.ERROR`, `fallbackText`, and unanswered with reason ERROR (L304).
   - **Success:**
     - The body goes through `composeReply`.
     - `handledBy` is `RAG`, `CLARIFIED` or `DECLINED`.
     - `retrievalMeta` is `{...retrieval, provider, model, prompt_version, chatbot_id, prompt_versions, prompt_hashes}`.
     - A decline is filed as unanswered.
- **Decision type:** `ChatbotDecision` in `chatbot-engine.types.ts:59`. The input is `ChatTurn` (L37).
- The engine never sends, stores or alerts.
- **The engine had no spec of its own.** It was covered only through `whatsapp/service/test/whatsapp-inbound-chatbot.spec.ts`.

### The ally-ai client in ally-be
`ally-be/src/ai/service/ai.service.ts`:
- **`answerKnowledgeQuestion`** (L657): `@RetryWithinBudget({attempts: 2, delayMs: 500, budgetMs: 40_000, shouldRetry: isRetryableAiFailure})`, 25 s per call, `redactBody`. The comment at L629-649 explains that the 40 s budget comes from the 60 s SQS visibility window minus the 15 s provider send.
- **`checkWhatsAppCrisis`** (L698): a 25 s budget and 15 s per call.
- **`makeRequest`** (L899): axios, with `x-api-key = AI_SERVICE_OUTBOUND_API_KEY` against `AI_SERVICE_API_URL`. The knowledge calls pass `throwError=true`.
- **Failures** are `AiUpstreamError` (`ai/exception/ai-upstream.exception.ts`), carrying `errorCode`, `upstreamStatus` and `networkCode`. `classifyAiFailure` sorts them:
  - timeout or 504 → `AI_SERVICE_TIMEOUT`
  - 429 → `AI_SERVICE_THROTTLED`
  - 5xx or no response → `AI_SERVICE_UNAVAILABLE`
  - other 4xx → `AI_REQUEST_REJECTED` (not retried)
- **Endpoints and DTOs:** endpoints are in `ai/constants/endpoints.constants.ts:66-67`; DTOs are in `ai/dto/knowledge.dto.ts:146-241`.

### Settings: defaults and overrides
`ally-be/src/chatbot/service/chatbot-settings.service.ts`:
- **Defaults:** the `global_settings` row `whatsapp_bot`, read by `get()` (L41). `merge()` (L125) lays it over `DEFAULT_WHATSAPP_SETTINGS` (`whatsapp/type/whatsapp-settings.type.ts:127`), so **a key missing from the row gets its code default, with no migration**.
- **Per bot:** the `chatbots.settings` jsonb goes through `applyOverride` (L99), which enforces safety key by key:
  - `enabled`: the default AND the bot's.
  - `crisisClassifierEnabled` and `consentRequired`: OR, so a bot can only turn them on.
  - `rateLimit`: the min of the two.
  - Every other key: the bot's value simply overrides.
- **Per-bot route:** `GET/PUT /v1/chatbots/:id/settings` (`chatbot.controller.ts:128-149`, EDITOR to write). Its DTO (`UpdateChatbotSettingsDto`) is just `@IsObject()`, so **keys aren't validated**.
- **Defaults route:** `GET/PUT /v1/whatsapp/settings` (`whatsapp-admin.controller.ts:234-257`). It needs `EDIT_WHATSAPP_BOT`, which is granted to SUPER_DUPER_ADMIN only and has no `assertPlatformAdmin`. Its DTO is `UpdateWaSettingsDto` (`whatsapp/dto/whatsapp.dto.ts:184`).

### Preview
- **Route:** `POST /v1/chatbots/:id/test` (`chatbot.controller.ts:224`, VIEW).
- **Request:** `TestChatbotDto` (`chatbot.dto.ts:277`): `message`, `history` (≤ 20), `draft`, `asTenantId`, `checkAccess`.
- **Service:** `ChatbotService.test()` (`chatbot.service.ts:486`):
  - Checks VIEWER access and validates any draft model.
  - Builds a draft bot. Access is `ANYONE` unless `checkAccess` is set.
  - Calls `engine.respond` with `channel {type: 'test'}`.
  - Sets `last_tested_at`.
- **Response:** `{reply, handledBy, citations, retrieval, language, wouldFileUnanswered, wouldAlert, latencyMs, usedDraft}`.

### `wa_messages`
`ally-be/src/whatsapp/entity/wa-message.entity.ts`:
- **There is no metadata column.** The only jsonb columns are `citations` and `retrieval_meta`.
- `provider_message_id` has a unique index and is the dedupe key.
- `wa_conversations.id` is a uuid.

### Inbound WhatsApp
`ally-be/src/whatsapp/service/whatsapp-inbound.service.ts`, `handle` (L140), in order:
1. Dedupe: an `insert … orIgnore` on the provider message id (L172-197).
2. `engine.respond` (L314).
3. `reply()` (L354-367): the row is saved as queued, the send is tried up to twice, and the row ends SENT or FAILED, with a Slack event on failure.
4. `recordUnanswered`.
5. `emit('exception', decision.alert)` (L379).

Things to know:
- The `catch` at L380 marks the *inbound* row FAILED, so nothing after the send may throw into it.
- `reply()` returns void.

### Chatbot entity, DTOs and admin-only guards
- **Entity:** `chatbot/entity/chatbot.entity.ts`. Enum-like fields are varchar columns, and `persona`, `model` and `settings` are jsonb. There were no CHECK constraints before this chunk.
- **DTOs:** `chatbot/dto/chatbot.dto.ts`, using class-validator (`UpdateChatbotDto` is at L118).
- **GET** returns the plain `ChatbotSummary` interface (`chatbot.service.ts:46`, built by `summarise` at L138). It doesn't include `settings`.
- **`PATCH /v1/chatbots/:id`** goes to `ChatbotService.update` (L273). This is the route that owns bot fields, not the settings route.
- **Admin-only:** `ChatbotAccessService.isPlatformAdmin()` and `assertPlatformAdmin()` (`chatbot-access.service.ts:37-47`). A platform admin is someone for whom `resolveTenantIds` returns null, and `assertPlatformAdmin()` throws a 403. The existing per-field example is `knowledgeSource = organisation` (`chatbot.service.ts:275`).
- **Route guards:** every route carries `@RequireFeatureToggle(WHATSAPP_BOT, VIEW | EDIT)`.

### Dashboard
All paths are under `ally-web/apps/ally-admin-dashboard/src`.
- **Settings:** `pages/WhatsAppBot/ChatbotSettingsTab.tsx`. A plain `useState` draft, saved with `useUpdateChatbotSettingsMutation`. Fields inherit their default until customised.
- **Defaults:** `pages/WhatsAppBot/BotSettingsTab.tsx`. A local `Toggle` wrapping `CarbonToggle`, saved with `useUpdateWaSettingsMutation`.
- **Preview:** `pages/WhatsAppBot/ChatbotTestTab.tsx`. It uses `useTestChatbotMutation`, keeps the thread in local state, and shows handledBy, model, latency and sources. It has a Reset button.
- **Platform-admin signal:** `useGetChatbotsQuery().data.canCreate`. There's no role hook for this.
- **Types:** `types/chatbots.ts` and `types/whatsappBot.ts`. The RTK slice is `api/chatbots.ts`.
- **Tests:** none for the Settings, Defaults or Preview tabs before this chunk. The test style (Vitest, with `@api` mocked) is in `pages/WhatsAppBot/__tests__/WhatsAppBot.test.tsx`.

### Latest migration
`1980920000000-AddChatbotLastTestedAt`. This chunk adds `1980960000000`.

### Where the code differs from archive/chunk-02.md (the code wins)
1. `wa_messages` has no metadata jsonb, so this chunk adds `agent_run_id` and `agent_runtime` columns.
2. `agentRuntimeAllowed` needs no data migration. Adding it to `DEFAULT_WHATSAPP_SETTINGS` is the existing mechanism, because `merge()` fills keys missing from the stored row.
3. A bot must not be able to turn the kill switch on for itself. Because the per-bot settings DTO doesn't validate keys, `applyOverride` forces the platform value.
4. The 25 s / 40 s timeouts live in `AiService` decorators, not in the engine. A v2 timeout followed by a full v1 budget would exceed the SQS window, so the fallback gets only the remaining budget.
5. The brief's "lines 428–487" for the model merge are actually L467-481. The placeholder id is at L45 and L404.
6. `PATCH /v1/chatbots/:id` owns bot fields, so `runtime` goes there.
7. The dashboard's platform-admin signal is `canCreate`.
8. The AI task registry is keyed per model call, not per endpoint. `/agent/run` makes the same model calls, so there's no new row; only the `whatsapp-answer` detail changes.
9. There was no engine spec. This chunk adds the first, starting with a snapshot of the v1 request.
10. This checkout had no `node_modules` in ally-be or ally-web. They were installed with `npm ci` from the lockfiles, so no versions changed.
11. Branch: the work stays on the chunk-1 branch (see the top of this file).

## 2. What was built

All three apps are on the same branch. In review order (see section 7 for the commit list):

| App | File | What it is |
|---|---|---|
| ally-ai | `app/schemas/agent_runtime.py`, `app/api/v1/endpoints/agent_runtime.py`, `app/core/knowledge_agent/agent.py`, `nodes/finalize.py`, `nodes/select.py` | The `log_retrieval: bool = True` flag on `/agent/run`, passed through `bot["log_retrieval"]`. When it's false, `decline`/`select` skip `_report_retrieval`. `/knowledge-agent/answer` is unchanged. | <!-- docs-path-lint: ignore -->
| ally-be | `src/database/migrations/1980960000000-AddChatbotAgentRuntime.ts` | Adds `chatbots.runtime` (CHECK v1/shadow/v2, default v1) and `features` jsonb, `wa_messages.agent_run_id`/`agent_runtime`, and the `agent_shadow_runs` table. |
| ally-be | `src/chatbot/engine/knowledge-request.ts` | **The shared builder.** `buildKnowledgeRequest` (today's body, moved here) and `buildAgentRunRequest` (that body plus the 4 run fields, and `log_retrieval:false` for shadow). |
| ally-be | `src/chatbot/engine/agent-runtime.ts` | Several small helpers:<br>• `effectiveRuntime`<br>• `agentRunIdFor` (uuid v5)<br>• `agentFailureReason`<br>• `shadowSide`<br>• the two event names and payloads |
| ally-be | `src/chatbot/engine/chatbot-engine.service.ts` | Two entry points, `answerWithV1` and `answerWithAgent` (which includes the fallback). The answer is turned into a reply by `toDecision`, which both paths share, and `shadowRequest` prepares the shadow run. |
| ally-be | `src/ai/service/ai.service.ts` | `runAgent` (one 25 s attempt, no Slack alert of its own) and `answerKnowledgeQuestionWithin` (v1 inside the remaining budget). `makeRequest` gains `alertOnFailure = true` (see decisions). |
| ally-be | `src/chatbot/service/agent-runtime-alert-throttle.service.ts` | The fallback alert: at most 1 per bot and reason every 10 minutes, with the number of messages that fell back. |
| ally-be | `src/chatbot/service/chatbot-shadow.service.ts` | Shadow runs. Capped by `AGENT_SHADOW_MAX_IN_FLIGHT` (default 5; 0 turns them off); extra runs are skipped and counted. | <!-- docs-path-lint: ignore -->
| ally-be | `src/whatsapp/service/whatsapp-inbound.service.ts` | Passes `conversationId` and `providerMessageId` to the engine. Stores `agent_run_id`/`agent_runtime` on the outbound row. After the reply it emits `chatbot.agent-fallback` and `chatbot.agent-shadow-run`. |
| ally-be | `src/chatbot/service/chatbot.service.ts`, `dto/chatbot.dto.ts` | Three API changes:<br>• PATCH `runtime` (platform admin only).<br>• GET adds `runtime`, `effectiveRuntime` and `features`.<br>• Preview accepts `runtime` and `conversationId`, and returns `runtime`, `runId`, `trace`, `fallbackReason`, `runtimeAllowed` and `conversationId`. |
| ally-be | `whatsapp-settings.type.ts`, `whatsapp.dto.ts`, `chatbot-settings.service.ts` | `agentRuntimeAllowed` (default false), editable in Defaults. `applyOverride` always uses the platform value. |
| ally-be | `DATA_SCHEMA.md`, `.env.example`, `env.validation.ts`, `config.service.ts`, `ai-task-registry.constants.ts` | Docs, the new env var, and the registry note. |
| ally-web | `pages/WhatsAppBot/ChatbotEngineCard.tsx`, `ChatbotSettingsTab.tsx` | The Engine card in a bot's Settings, for platform admins only. *Superseded in 3a: the card is on Settings → Agent (CHUNK-03A-NOTES section 13).* | <!-- docs-path-lint: ignore -->
| ally-web | `pages/WhatsAppBot/BotSettingsTab.tsx` | Defaults → Safety switches → **Allow the new engine**. |
| ally-web | `pages/WhatsAppBot/ChatbotTestTab.tsx` | Preview gains:<br>• the engine badge, or "v1 (v2 failed: reason)"<br>• the run id with Copy<br>• a collapsible step list with ms per step<br>• **New thread**, which replaces "Start over" and also drops the thread id<br>• an admin-only "Engine for this test" picker *(removed in 3a: a test always uses the bot's own engine)* |

### Tests added

| App | Spec | Count | Covers |
|---|---|---|---|
| ally-be | `src/chatbot/engine/test/chatbot-engine.service.spec.ts` | 25 | The v1 body snapshot (written **before** the refactor, unchanged after it), the kill switch, v2, every fallback case, crisis over v2 and over the fallback, shadow, the run id |
| ally-be | `src/whatsapp/service/test/whatsapp-inbound-agent-runtime.spec.ts` | 7 | Real event emitter, throttle and shadow service: the stored run link, one reply on fallback, the alert throttled across messages, the shadow run only after the send, no text in the shadow row, failures isolated |
| ally-be | `src/chatbot/service/test/agent-runtime-alert-throttle.spec.ts` | 5 | The alert throttle |
| ally-be | `src/chatbot/service/test/chatbot-shadow.spec.ts` | 5 | The concurrency cap, freeing a slot, cap 0, never throwing | <!-- docs-path-lint: ignore -->
| ally-be | `src/chatbot/service/test/chatbot.service.spec.ts` | 10 | PATCH/test 403 for non-admins, the GET fields, the Preview response |
| ally-be | `chatbot-settings.spec.ts` and `ai.service.spec.ts` | +1 and +7 | The kill switch can't be set per bot; `runAgent` doesn't page; the budgeted fallback |
| ally-web | `ChatbotSettingsTab.test.tsx` | 3 | Engine is hidden for non-admins and selected for admins; the platform-wide note. *Superseded in 3a: these moved with the card to `AgentTab.test.tsx`.* |
| ally-web | `ChatbotTestTab.test.tsx` | 5 | Badge, run id, steps with ms, fallback badge, New thread, the picker is admin-only. *The picker test went with the picker in 3a.* |
| ally-ai | `test_graph.py` and `test_endpoint.py` | +3 | `log_retrieval=false` skips both log paths; the default still logs once |

### Results

| App | Result |
|---|---|
| ally-be | **960 suites, 14,018 tests pass** (baseline 955 / 13,958). Lint, typecheck and build are clean. |
| ally-web | All tests pass: helpline 305, admin 538 files (baseline 536), ui-shared 48. Lint and the CI typecheck are clean. |
| ally-ai | **1,774 passed**, 31 skipped. flake8 is clean. |

`npm run format:check` fails in ally-web on 93 files, all pre-existing. The count is the same at the commit before this chunk's ally-web change, and none of the files are ones this chunk touched.

## 3. Decisions

- **The kill switch always wins**, including over a forced v2 in Preview (Shehbaz). `effectiveRuntime` = v1 unless `agentRuntimeAllowed`, then Preview's override, then `chatbots.runtime`.
- **Shadow runs and the fallback alert go through events, not new constructor dependencies.** `WhatsAppInboundService` emits `chatbot.agent-fallback` and `chatbot.agent-shadow-run` on its existing `EventEmitter2`. `AgentRuntimeAlertThrottle` and `ChatbotShadowService` listen with `@OnEvent`.
  - Why: adding them to the inbound constructor broke the existing `whatsapp-inbound-chatbot.spec.ts` (a hand-built Nest module). The brief says existing tests pass unmodified.
  - The ordering holds: `emit` runs listeners synchronously after the reply was sent and recorded, and `start()` returns at once and never throws.
- **`makeRequest` gets `alertOnFailure` (default true, so every existing caller is unchanged); only `runAgent` passes false.** Without it, every failed `/agent/run` would also send `AI Request Error` to Slack, once per message, and the throttle would be pointless. Shadow failures go to their row and the log only, not to Slack.
- **Fallback budget.** `/agent/run` gets one 25 s attempt. v1 then gets `40 s − elapsed`: each attempt is capped at what's left, and it retries only if the retry still fits (the same rule as `RetryWithinBudget`). The 40 s is the SQS-window budget in `ai.service.ts`. A 404 because the flag is off costs milliseconds, so v1 keeps almost the whole budget.
- **`run_id`:**
  - On WhatsApp it is `uuidv5(providerMessageId, AGENT_RUN_NAMESPACE)`, where the namespace `54b53605-2385-4d61-8b44-a7fd03b0d1e9` must never change.
  - Preview uses a random id.
  - A shadow run uses the same derivation, since a message is never both shadow and v2.
- **`conversation_id`:**
  - WhatsApp: `wa_conversations.id`.
  - Preview: `preview-<uuid>`, kept by the dashboard until New thread.
  - **Shadow: `shadow-<wa_conversations.id>`.** This keeps comparison checkpoints out of the conversation's real v2 thread for when the bot switches over. The brief doesn't say which thread shadow should use.
- **What gets shadowed:** only a message that v1 answered through the answer step (RAG, declined or clarified). Keyword replies, refusals, crisis replies and failed answers aren't shadowed.
- **What's stored on the reply:**
  - `agent_runtime` is `v2` or `v2_fallback`, and v1 replies leave both columns unset.
  - A crisis reply that overrides a v2 answer or a fallback answer still keeps the run link.
  - `/agent/run`'s debug-only `retrieval.hit_chunk_ids` is stripped before `retrieval_meta` is stored.
- **Platform-admin-only fields:** PATCH `runtime` and Preview's `runtime` call `assertPlatformAdmin()`, the same pattern as `knowledgeSource = organisation`, so anyone else gets a 403. The UI hides both unless `canCreate`.
- **Repo convention over the brief:** `agent_shadow_runs` uses the base entity's `"createdAt"`/`"updatedAt"` columns and `uuid_generate_v4()`, like every other chatbot table, instead of the brief's `created_at`.
- **AI task registry:** no new row, because the registry is per model call and the model calls are unchanged. The `whatsapp-answer` detail now says v2 bots make them through `/agent/run` and shadow bots make them twice.
- **Prompts:** no new prompts and no prompt text changes.

## 4. How to test (Shehbaz's steps, with real routes, ports and screens)

**Ports:**

| Service | Address |
|---|---|
| Admin dashboard | http://localhost:8081 |
| ally-be | `localhost:8001` (container `ally-be-app-1`, watches the source and runs migrations on start) |
| ally-ai | `localhost:3001` (container `ally-ai-app-1`, a baked image) |
| Postgres | `localhost:5477`, databases `ally_local` (ally-be) and `ally_agent_runtime` (checkpoints) |

### 1. Tests, lint and the migration
```bash
cd ally-be  && npm test -- --forceExit --detectOpenHandles && npm run lint && npm run typecheck
cd ally-web && nvm use 22 && npm test && npm run lint && npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json
cd ally-ai  && poetry run pytest tests/ -q && poetry run flake8
```
Focused runs:
- ally-be: `npx jest src/chatbot src/whatsapp/service/test/whatsapp-inbound-agent-runtime.spec.ts`
- ally-web: `npx vitest run --project ally-admin-dashboard src/pages/WhatsAppBot`

Migration: the container runs it on start, or run `docker exec ally-be-app-1 npm run migration:run`. Then check:
```sql
select runtime, count(*) from chatbots group by 1;                                -- all v1 on a fresh migrate
select value->'agentRuntimeAllowed' from global_settings where name='whatsapp_bot'; -- null = default off
```

### 2. Setup
1. ally-ai must run the new image with the runtime on. `ally-ai/.env` needs `AGENT_RUNTIME__ENABLED=true` and `AGENT_RUNTIME__CHECKPOINT_DB_URL`. Then rebuild:
   ```bash
   cd ally-ai && docker compose -f docker-compose.local.yml up -d --build app
   ```
2. In the dashboard: **AI Chatbots → Ally FAQ → Knowledge**. Attach all 7 "Ally FAQ –" documents and save.
3. **AI Chatbots → Defaults → Settings → Safety switches → Allow the new engine: On**, then **Save defaults** in the bar at the bottom.

### 3. Preview, side by side
*Superseded in 3a: there is no per-test engine picker; switch the bot's engine on Settings → Agent instead.*

1. Open **Ally FAQ → Preview**.
2. Set **Engine for this test** to **v1** and ask "What does Ally do?". The badge says "Answered by v1", with no run.
3. Switch it to **v2** and ask the same question. You should get the same decision and similar sources. The badge says "Answered by v2", with a **Run** id and Copy, and "Steps (7)" opens to 7 steps with their ms.
4. Ask a follow-up, then press **New thread**.

Checked live on 2026-11-05: v1 took 12.6 s and v2 13.9 s, with the same source, and `write` took 11.1 s of v2's time. To confirm the run was stored:
```bash
docker exec ally-be-postgres-1 psql -U postgres -d ally_agent_runtime \
  -c "select thread_id, count(*) from agent_runtime.checkpoints where thread_id like 'preview-%' group by 1;"
```

### 4. Switch the bot to v2
Go to **Ally FAQ → Settings → Engine → v2 → Save engine** (since 3a: **Settings → Agent → Engine card**). With a WhatsApp number connected (tunnel and allow-listed phone), message it. Then:
```sql
select handled_by, agent_run_id, agent_runtime from wa_messages
 where direction = 'outbound' order by "createdAt" desc limit 3;   -- agent_runtime = v2
```

### 5. Fallback
1. Set `AGENT_RUNTIME__ENABLED=false` in `ally-ai/.env`, then:
   ```bash
   cd ally-ai && docker compose -f docker-compose.local.yml up -d --force-recreate --no-deps app
   ```
2. In Preview with **v2** you should see "Answered by v1 (v2 failed: upstream_404)" and "Would alert the team: Chatbot Agent Runtime Degraded".
3. On WhatsApp:
   - The reply still arrives, once.
   - The outbound row has `agent_runtime = v2_fallback`.
   - Slack gets **one** "Chatbot Agent Runtime Degraded" alert for the first fallback. Later fallbacks within 10 minutes send nothing. The next alert says how many messages fell back.
4. Put the flag back afterwards.

### 6. Shadow
1. Go to **Settings → Engine → Shadow → Save engine** (since 3a: **Settings → Agent → Engine card**).
2. Send 5 WhatsApp messages. Replies come from v1. Then:
   ```sql
   select chatbot_id, run_id, v1, v2, error from agent_shadow_runs order by "createdAt" desc;
   ```
   Expect 5 rows: numbers and chunk ids only, no text.
3. Run the summary query in section 5.
4. Replaying without a phone needs more setup:
   - The message has to reach the Ally FAQ bot. With no connector, that means `platformChatbotId` pointing at it.
   - A new contact first gets the consent prompt, so reply START first.
   - The queue is `sqs-whatsapp-inbound-queue` in LocalStack. The body is `{"providerMessageId","from","text","isUnsupportedMedia":false,"timestamp"}`.
   - This path wasn't run here.

### 7. Kill switch
Go to **Defaults → Allow the new engine: Off → Save defaults**. The v2 bot answers with v1 on its next message (Settings shows "turned off in Defaults"), with no deploy.

## 5. The shadow summary query
For each shadow bot over 7 days: messages, v2 failures, intent and decline-reason match %, citation overlap % (shared chunks ÷ the larger set), and p50/p90 latency per runtime.
```sql
WITH runs AS (
  SELECT s.*,
         (SELECT count(*) FROM jsonb_array_elements_text(s.v1->'cited_chunk_ids') a
           WHERE a IN (SELECT jsonb_array_elements_text(s.v2->'cited_chunk_ids'))) AS shared,
         greatest(jsonb_array_length(s.v1->'cited_chunk_ids'),
                  jsonb_array_length(coalesce(s.v2->'cited_chunk_ids', '[]'))) AS widest
    FROM agent_shadow_runs s
   WHERE s."createdAt" >= now() - interval '7 days'
     -- AND s.chatbot_id = '<bot id>'
)
SELECT chatbot_id,
       count(*)                                                        AS messages,
       count(*) FILTER (WHERE v2 IS NULL)                              AS v2_failed,
       round(avg((v1->>'intent' = v2->>'intent')::int) * 100, 1)       AS intent_match_pct,
       round(avg((v1->>'decline_reason' = v2->>'decline_reason')::int) * 100, 1)
                                                                       AS decline_reason_match_pct,
       round(avg(CASE WHEN widest > 0 THEN shared::numeric / widest END) * 100, 1)
                                                                       AS citation_overlap_pct,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (v1->>'latency_ms')::int) AS v1_p50_ms,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY (v1->>'latency_ms')::int) AS v1_p90_ms,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (v2->>'latency_ms')::int) AS v2_p50_ms,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY (v2->>'latency_ms')::int) AS v2_p90_ms
  FROM runs
 GROUP BY chatbot_id;
```
Checked on a sample row inside a rolled-back transaction: 100% intent match and 50% overlap for `{a,b}` against `{a}`.

## 6. Verified and not verified

| Check | Status |
|---|---|
| Migration on the current local database | **Done.** It ran, then `down` and `up` again; both bots are v1. |
| Migration on a fresh schema | **Done**, on a throwaway database (`pg_dump -s` of the current schema, the migration reverted and re-applied, an existing bot → v1 `{}`), then dropped. |
| Live Preview, v1 and v2 | **Done** in the real dashboard (section 4.3). The run was stored: 9 checkpoints under its `preview-…` thread. |
| `log_retrieval` live | **Not verified.** The local stack never delivers retrieval-log messages: `kb_retrievals` is empty for every consumer. It's covered by the ally-ai unit and endpoint tests. |
| WhatsApp v2, fallback and shadow end to end | **Not verified.** No number is connected locally. They're covered by `whatsapp-inbound-agent-runtime.spec.ts`, which uses the real engine, emitter, throttle and shadow service. |

Running every migration on an **empty** database fails at `1700000000000-AddDialogueLengthToScenarioStates`, because `scenarios` doesn't exist yet. This is pre-existing: the table is created by the later `1757484561931`. Not changed here.

## 7. Commits, in review order

**Chunk 1 (ally-ai: LangGraph runtime with parity)**
```
1359fc39c docs: add Agents v2 context, plan and CLAUDE.md
a49623aab docs(agents-v2): chunk 01 code map
61bb74a4b test(agent-runtime): parity harness, cases and master baseline
49601bd29 refactor(knowledge_agent): extract pipeline steps
a20773377 build(ally-ai): add langgraph, langgraph-checkpoint-postgres and psycopg
a4983449d feat(agent-runtime): LangGraph graph, /agent/run and Postgres checkpointer
6b6dd21a7 test(agent-runtime): graph, endpoint, checkpointer and golden parity tests
f97b90a3b chore(ally-ai): keep local venv out of the image; pin runtime flag in tests
8b9ef3d2a docs(agents-v2): chunk 01 notes and parity report
1398d2f78 test(agent-runtime): cited-chunk set is should-match in live parity
```
**Chunk 2 (runtime switch: ally-ai, ally-be, ally-web)**
```
cdababa96 docs(agents-v2): chunk 2 brief, updated context and chunk plan
92c6ae9ce docs(agents-v2): chunk 02 code map; current chunk is 02
6a73b1356 feat(agent-runtime): log_retrieval flag on /agent/run
6cd9b0b05 test(chatbot-engine): pin the v1 /knowledge-agent/answer request body
4b0d389b5 feat(chatbot): runtime and features columns, agent run link on messages, shadow table
ab91867c8 feat(chatbot-engine): answer v2 bots through /agent/run, falling back to v1
1cf4b2b92 feat(chatbot): shadow runs and the throttled agent-runtime alert
0e7705652 feat(chatbot): runtime on the chatbot API and Preview
c47f16998 feat(admin-dashboard): engine setting, kill switch toggle and Preview run details
```
The notes commit follows these. Review chunk 1 first: chunk 2's `6cd9b0b05` pins the v1 request before `ab91867c8` refactors it.

## 8. Open items

- **Wiki.** ally-ai's `.docs-map.yml` (`repo-page-architecture`) requires `wiki:repos/ally-ai.md` for `app/api/v1/endpoints/**`, and both chunks touched it. Chunk 1 deferred the wiki update to chunk 2. **The wiki PR (`/agent/run`, its flag and the ally-be integration) has not been opened.** The wiki is public, so it waits for your go-ahead. Until then the PR needs a `Wiki-PR:` trailer or the `docs:skip` label.
- **The throttle is per instance and in memory.** N instances can each send one alert per window, and a restart resets the counts.
- **Double retrieval log on a late fallback.** If `/agent/run` fails *after* its select step logged (the write call 502s), the v1 fallback logs again. This is rare and accepted.
- **Shadow is a sample under load.** Messages past `AGENT_SHADOW_MAX_IN_FLIGHT` have no row, and the skip count is only in the logs. A shadow run in flight during a deploy is lost with no row. The fallback alert is the only Slack signal: shadow failures appear only in `agent_shadow_runs.error`.
- **Checkpoint retention** (open from chunk 1). Preview and `shadow-…` threads add checkpoint rows, and nothing deletes them yet.
- **The Defaults PUT** relies on `EDIT_WHATSAPP_BOT` (SUPER_DUPER_ADMIN only) with no `assertPlatformAdmin`. The new toggle inherits that unchanged.
- **For chunk 2b (streaming):** Preview now carries a stable `conversationId`, and `ChatbotTestTab` renders the trace from the final response. Streaming `step` events can fill the same list.
- **Model sampling** (from chunk 1) still makes v1 and v2 differ in wording and sometimes in citations. Expect citation overlap in the shadow summary to sit below 100% for that reason alone.
