# Chunk 12b notes: bot page (a shareable chat link)

**Brief:** [chunk-12b.md](./chunk-12b.md). **Branch:** `feat/agents-v2-chunk-12-shared-store`. All of slice 1 (12, 12b, 20a, 15a) is built on this one branch, and every 12b commit is tagged `[12b]`. Master (#232) was merged first: it was already the base, so there were no conflicts. **Repos:** ally-be and ally-web. ally-ai is untouched: the stream contract already covers the page.

Plan approved 2026-11-07 at `~/.claude/plans/pasted-content-id-f834-we-re-continuing-sharded-raven.md`.

## 1. Code map: what exists today (read before building)

### How ally-web builds and deploys, and where a public page can live

- **ally-web has two Vite 5 + React 18 SPAs and no Next.js app.** The root `CLAUDE.md` listed a Next.js landing app on :3000; that line was stale and is fixed in this chunk.
  - `apps/ally-admin-dashboard` (:8081). Its targets are inferred by `@nx/vite/plugin`.
  - `apps/ally-helpline-dashboard` (:8080). Its targets are explicit in `project.json`.
  - `libs/ui-shared` is source-only. Its root barrel (`libs/ui-shared/src/index.ts`) pulls in LiveKit, Carbon and analytics.
- **Admin deploy:** `.github/workflows/deploy-ally-admin-dashboard-cdn.yml` runs on `workflow_dispatch` only:
  1. vitest;
  2. copies `.env` from the environment bucket (build-time `VITE_*` only; there is no runtime config);
  3. `nx build ally-admin-dashboard`;
  4. `s3 sync`, with hashed assets immutable and `*.html` no-cache;
  5. CloudFront invalidation.
  - The production release is `production-release-admin-dashboard.yaml`.
  - On bare metal, `infra/ansible/templates/static_vite_Caddyfile` serves the app with `try_files {path} /index.html`.
  - The CloudFront and S3 infrastructure is not in this repo.
- **Admin auth:**
  - `src/routes/PrivateLayout.tsx:73` reads `ADMIN_IS_AUTHENTICATED` from localStorage, and `:129` redirects to `/login`.
  - `api/baseApi.ts:39-118` refreshes on 401, and on failure sets `window.location.href = /login`.
  - Public routes exist: `/login`, `/terms`, `/privacy`, `/design-system`, and `/evaluate/*`, which has its own token and RTK API.
- **Why not a route in the admin router:**
  - `main.tsx` wraps everything in Redux, Google OAuth, PostHog and the Carbon theme.
  - `RouteLayout.tsx:6-64` imports every page eagerly from the `@pages` barrel.
  - So a lazy `/b/:slug` route would still download the whole admin entry chunk, and any `baseAPI` 401 would send a visitor to `/login`.
- **Chosen (Shehbaz): a second Vite entry in the admin app.**
  - `b.html` → `src/botPage/main.tsx`, with its own chunk graph: no Redux, Carbon, PostHog, Google OAuth or `baseAPI`.
  - It ships with the existing admin deploy. An ESLint import fence keeps admin modules out.
  - Needed outside this repo: CloudFront and Caddy rules that map `/b/*` to `/b.html`. Locally, a small Vite dev middleware does it.

### ally-be auth, for "organisation only"

- **There's no global guard** (`app.module.ts:173-178` registers only `APP_FILTER`).
  - Guards are attached per route by `@AuthPermissions`, `@RequireFeatureToggle` and `@AuthRoles`, which all use `AuthGuard('jwt')`.
  - So an unguarded controller is already public. The convention is `@Public()` (`auth/decorators/auth.metadata.ts:4`) plus `@RateLimit({key:'ip'})`, as in `tenant/controller/tenant-public.controller.ts` and `guide/controller/guide-public.controller.ts`.
- **JWT:** `{sub, username, tenantId}`, HS256 with `JWT_ACCESS_SECRET` (`auth/service/auth.service.ts:150-157`). `JwtStrategy` rejects any token with a `kind` claim.
  - Separate-secret guest tokens are already a pattern: `helpline/service/helpline-guest-token.service.ts`, with `aud`/`typ` and the secret HMAC-derived from the access secret with a label.
- **Cookies:** none are used anywhere, and there's no cookie-parser. CORS has `credentials: true`.
- **Bots have no organisation.** `Chatbot extends BaseWithoutTenantEntity` (`chatbot/entity/chatbot.entity.ts:16`, "Not tied to an organisation").
  - A user belongs to one tenant (`users.tenant_id`) and has `status` ACTIVE/SUSPENDED and `email`.
- **The admin session can't reach the page.** The page runs outside the admin app's localStorage session, so organisation-only is an **email code plus a check of `users`** (Shehbaz): the email must belong to an ACTIVE user whose tenant is on the page's allowed organisations.

### OTP and email

- **Login OTP** (`auth/service/auth.service.ts:453-660`, `auth/constants/otp-limits.constants.ts`):
  - a 4-digit `crypto.randomInt` code in Redis (TTL `OTP_TTL` 300 s), stored as a SHA-256 `hashSecret`;
  - 5 guesses per code, 20 per address per day, 5 codes per 15 minutes per address (`RedisService.incrWithExpiry`), and the `otp` throttler per IP.
- **Delivery:** the `otp.generated` event → `NotificationEventConsumer` → `EmailService.sendEmailOTP` (branded HTML through `brandedOtpHtml`, which escapes the HTML and checks the colour) → `SESService.sendEmail`. A failed send raises a Slack alert.
- **In development,** `EmailService` posts the code to Slack (`email.service.ts:33-42`). Shehbaz: fine for bot-page codes too, development only.
- **`SESService` logs the full recipient** ("Email sent to …").
- **There's no SMS or phone OTP,** so bot-page invites are email-only.

### The bot's existing access list

- `chatbot_audience (chatbot_id, kind user|organisation|phone|email, value, label)`, managed by `ChatbotAudienceService` (`chatbot/service/chatbot-audience.service.ts`) and the `:id/audience` routes.
- It's enforced in one place, `ChatbotEngineService.respond` (`canChat`, `chatbot-engine.service.ts:175-182`). Refused senders still get crisis handling.
- `accessMode` is anyone, recognised or listed. Status is draft, live or paused.
- **Decision (Shehbaz, at approval):** the page **doesn't reuse** `chatbot_audience`. Its invite emails and allowed organisations live in their own table, so a page setting can never widen WhatsApp access (see section 3).

### Streaming: 3c's hook and the SSE parsers

- **ally-web:**
  - `hooks/useChatbotTestStream.ts`:
    - a module-local `fetchWithReauth` (admin bearer token plus one refresh);
    - a `TextDecoder` reader loop;
    - `parseCopilotSse`, imported from `hooks/useRoadmapCopilotStream.ts:27-51`, which pulls `logger` from the heavy `@utils` barrel.
  - `pages/WhatsAppBot/ChatbotTestTab.tsx` has the reveal pacing (`REVEAL_MS`, `MAX_REVEAL_MS`), `ActivityFeed`, `TypingDots` and `PendingBubble`, all Tailwind-only.
  - Helpline has a cleaner generic `utils/sseStream.ts`.
- **ally-be:**
  - `ai/util/sse-parser.ts`.
  - The `/test/stream` relay (`chatbot/controller/chatbot.controller.ts:314-354`): headers go out with the first event, a 10 s ping, `res.on('close')` aborts the run, and `final` comes last.
  - `holdTextUntilCleared` (`chatbot/engine/live-reply.ts`) runs in the engine, so any channel with `capabilities.streaming` gets the crisis gate for free.
- **The public relay must drop internal data:**
  - **Events:** `AgentStreamEvent` (`ai/dto/knowledge.dto.ts:319`) carries `run_started {run_id}`, `step` (the trace) and `status.detail`/`documents`. The public relay drops all of these and keeps only `status.code` and `token`.
  - **The result:** `ChatbotTestResult` carries `retrieval`, `trace`, `runId`, `runtime`, `fallbackReason` and other internal fields. The page gets only the reply, `{title, url}` citations and ids.

### Every dashboard view that reads `wa_*`

| Reader | Where | Note |
|---|---|---|
| Conversations list | `WhatsAppConversationService.listConversations` (`whatsapp/service/whatsapp-conversation.service.ts:115-213`) | `wa_conversations` ⋈ `wa_contacts` ⟕ tenants; `handledBy`/`search` as EXISTS over `wa_messages`; sort by lastMessageAt, startedAt or messageCount |
| Languages | `listLanguages` (:223) | DISTINCT `last_language` |
| Detail | `getConversation` (:238) | the narrow contact select plus every message, oldest first |
| Scope | `assertContactInScope` (:71), `assertListScope` (:88), `assertQuestionInScope` (:96) | through `wa_conversations.chatbot_id` |
| Unanswered | `listUnanswered` (:434), `updateUnanswered` (:482), `createDocumentFromUnanswered` (:526) | the bot is found through `conversationInBotSql` (`wa-analytics.repository.ts:18`) → `wa_conversations`. `wa_unanswered_questions` has **no FKs**, no `chatbot_id` and no channel |
| Bot stats | `ChatbotService.stats` (`chatbot/service/chatbot.service.ts:283-333`) | messages, people, answered, declined and last message over 30 days, and open unanswered |
| Analytics, `lastInboundAt` | `wa-analytics.repository.ts`, `whatsapp-business-number.service.ts:283` | **stay on `wa_*`** (chunk 12 decision) |

- Routes: `whatsapp/controller/whatsapp-conversation.controller.ts` (`v1/whatsapp/conversations…`, `unanswered…`, `contacts/:id/…`), behind the `WHATSAPP_BOT` feature permissions.
- ally-web: `pages/WhatsAppBot/ConversationsTab.tsx`, `ConversationDrawer.tsx`, `UnansweredTab.tsx`, and the stat cards in `ChatbotOverviewTab.tsx` and `WhatsAppBot.tsx:206`. The API layer is `api/whatsappBot.ts`, and the types are in `types/whatsappBot.ts`.
- **Tests:** none are snapshot tests. `listConversations`, `getConversation` and `listUnanswered` have **no direct specs** (only the controller permission spec and `corpusCoverage`).

### Where the code differs from the brief (the code wins)

1. **There's no Next.js app.** The page is a second entry in the admin Vite app (above).
2. **Bots have no organisation.** Organisation mode uses the page's own list of allowed organisations, prefilled with the creator's tenant.
3. **"Signed-in users of the organisation"** is an email code checked against `users`, not the admin session, which the page can't read.
4. **No SMS provider,** so invites are email only. Phones are an open item.
5. **CORS is one global list.** A route-scoped Origin check limits `/v1/public/bots` to the page origin.
6. **There's no cookie-parser.** The visitor cookie is parsed by a small helper (no new dependency).
7. **`wa_unanswered_questions` has no `chatbot_id`, channel or FKs.** Bot page questions are filed into it with the shared conversation and message ids, and the readers resolve the bot through `chatbot_conversations` in shared mode (WhatsApp ids are equal there).
8. **`chatbot_conversations` has no `message_count` or `last_language`,** and the shared contact has no phone, consent, blocked or tenant fields. In shared mode, WhatsApp rows get those through a LEFT JOIN back to `wa_conversations`/`wa_contacts` by the same id, so they show identical values.
9. **`blankBefore`/`eraseConversations` don't blank `metadata`** (the pre-chat answers) **or `display_name`.** Both are extended.
10. **`openConversation` ignores `status`,** so "New chat" closes the thread and the reuse query requires `status = 'open'`. WhatsApp never closes threads, so this is neutral for WhatsApp.
11. **"The owner is alerted"** means a Slack `exception` alert (no owner notification channel exists) plus a banner in the Bot page tab.
12. **The `v2-chunks.md` 12b row also lists visit and intake analytics.** The 12b brief doesn't, so they aren't built (open item).
13. **`PUT /v1/whatsapp/settings` has no platform-admin check** (only the feature toggle and `EDIT_WHATSAPP_BOT`). The two new platform flags are platform-admin only.
14. **The dashboard switch needs WhatsApp data in the shared store,** which only exists with `sharedStoreWrites` on plus the backfill. **Decision (Shehbaz):** a platform flag `dashboardReadsFrom: 'wa' | 'shared'`, default `'wa'`, effective only while `sharedStoreWrites` is on.
