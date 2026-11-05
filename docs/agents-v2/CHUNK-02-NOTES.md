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
`1980920000000-AddChatbotLastTestedAt`. This chunk adds `1980930000000`.

### Where the code differs from chunk-02.md (the code wins)
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
