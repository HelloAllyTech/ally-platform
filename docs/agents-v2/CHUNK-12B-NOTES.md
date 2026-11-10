# Chunk 12b notes: bot page (a shareable chat link)

**Brief:** [chunk-12b.md](./archive/chunk-12b.md). **Branch:** `feat/agents-v2-chunk-12-shared-store`. All of slice 1 (12, 12b, 20a, 15a) is built on this one branch, and every 12b commit is tagged `[12b]`. Master (#232) was merged first: it was already the base, so there were no conflicts. **Repos:** ally-be and ally-web. ally-ai is untouched: the stream contract already covers the page.

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

### Decisions at plan time and at approval (Shehbaz, 2026-11-07)

- **Hosting:** a second Vite entry inside the admin app.
- **Access:** the page has its own mode (public, organisation or invite). Its invite emails and allowed organisations are in **their own table, `chatbot_page_access`, never `chatbot_audience`**, so a page setting can never widen who can chat on WhatsApp.
  - **Why a table and not `chatbot_pages.settings`:**
    - lists can be pasted in the hundreds;
    - entries are added and removed one at a time, with "added N, skipped M";
    - every message re-checks one email with an indexed lookup;
    - the database enforces uniqueness;
    - erasing an address is a row delete, not a jsonb rewrite.
- **Organisation-only:** an email code, then an ACTIVE `users` row whose tenant is on the page's list.
- **Dashboard switch:** `dashboardReadsFrom` (`wa` | `shared`, default `wa`), effective only while `sharedStoreWrites` is on.
- **Approved:** the `qrcode` dependency. Organisation and invite pages may go live before 15a. Public pages stay blocked by `botPagePublicAllowed`. The development-only Slack echo of codes is fine.

## 2. What was built

### ally-be

| Area | Files | What |
|---|---|---|
| Tables | migration `1981000000000-CreateChatbotPages`, `chatbot/entity/chatbot-page.entity.ts`, `chatbot-page-access.entity.ts`, `chatbot/enum/bot-page.enum.ts`, `chatbot/type/bot-page.type.ts` | `chatbot_pages`: one per bot; slug unique on `lower(slug)`; status off/on; access public/organisation/invite; `settings` jsonb holding branding, pre-chat questions, suggested questions, limits and language. `chatbot_page_access`: emails and organisations. Plus an index (`chatbot_id`, `channel`, `last_message_at`) for the channel filter |
| Platform switches | `whatsapp/type/whatsapp-settings.type.ts`, `chatbot-settings.service.ts`, `whatsapp.dto.ts`, `whatsapp-admin.controller.ts` | `botPagePublicAllowed` (off) and `dashboardReadsFrom` (`wa`). Both are pinned in `applyOverride`, so a bot can't turn them on. `PUT /v1/whatsapp/settings` needs a platform admin to change either (`changesPlatformAdminOnlySetting`) |
| Admin routes | `chatbot/bot-page/bot-page-admin.controller.ts`, `bot-page.service.ts`, `bot-page-access.service.ts` | `GET/PUT v1/chatbots/:id/page`, `GET :id/page/slug-available`, `POST :id/page/logo-url` (assets bucket, PNG/JPEG/WebP, 2 MB), and `GET/POST/DELETE :id/page/access`. Viewers read; editors change. Defaults: the slug from the bot's name, and the crisis disclaimer when the classifier is on |
| Public API | `bot-page-public.controller.ts`, `bot-page-public.service.ts` | `/api/v1/public/bots/:slug`: `GET`, `session`, `otp/verify`, `intake`, `conversation`, `conversation/new`, `messages/stream`. Refusals use the repo's `ErrorCode` contract (`BOT_PAGE_*`) |
| Visitor | `bot-page-visitor.service.ts` | An HS256 token with its own secret, in an httpOnly, SameSite=Lax cookie named per bot, path `/api/v1/public/bots`, lasting 7 days. It's re-signed on every session call and daily on messages. A verified email lasts 30 days |
| Codes | `bot-page-otp.service.ts`, `notification/service/email.service.ts` (`sendBotPageCode`) | 6 digits, 10 minutes, 5 tries, 5 sends per 15 minutes. Only HMACs are kept in Redis. The branded email reuses `brandedOtpHtml` |
| Limits | `bot-page-rate-limit.service.ts` | Hourly per visitor (the page's setting) and per IP (session 20, verify 30, messages 120), plus a daily cap per bot. All fail open. The team gets one Slack alert per bot per day when the cap is hit |
| Bot check | `turnstile.service.ts` | Turnstile on public pages only; off while `TURNSTILE_SECRET_KEY` is empty. Fails closed |
| Guard | `bot-page-guard.middleware.ts` | Refuses any browser `Origin` except the page's own, and bodies over 16 KB |
| Engine | `chatbot-engine.types.ts`, `chatbot-engine.service.ts` | A new capability, `ChannelCapabilities.showsSources`: the page lists sources itself, so the reply has no "Sources:" text footer. Off for WhatsApp and Preview, which are unchanged |
| Shared store | `chatbot/service/conversation.service.ts` | `resolveVerifiedContact` (one contact across devices), `currentConversation`, `closeConversation` (reuse now requires `status='open'`), `recentMessages`, `contactByIdentity`, `identityOf`, `latestMetadata`, and `eraseContact` (web). `blankBefore` and `eraseConversations` also drop the pre-chat answers and display names |
| Dashboard | `whatsapp/service/shared-conversation.reader.ts`, `whatsapp-conversation.service.ts`, `chatbot.service.ts` (stats), `whatsapp-conversation.controller.ts` | Shared reads behind the switch (section 3); a `channel` filter; `POST v1/whatsapp/web-contacts/:id/erase` |
| Config | `config.service.ts` (`botPage`), `env.validation.ts`, `.env.example`, `docker.env.example` | `BOT_PAGE_BASE_URL` (defaults to `ADMIN_APP_BASE_URL`), `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `BOT_PAGE_VISITOR_SECRET` |

**How one message is handled** (`BotPagePublicService.admit`, then `respond`), mirroring WhatsApp inbound:
1. The page and bot are available (on, live, platform enabled, and public only while allowed); otherwise 404.
2. The visitor is checked again: an invited email still on the list, or an organisation user still ACTIVE and in an allowed organisation.
3. Length, then the per-IP and per-visitor hourly limits.
4. Pre-chat questions answered (409 if not).
5. The daily cap (503 `busy`).
6. `resolveContact(web)` → `openConversation` (carrying the contact's latest pre-chat answers to a new thread) → `appendMessage` (inbound) → `recentHistory`.
7. `engine.respond` on `WEB_CHANNEL` (`streaming`, `showsSources`, 4000 characters), with `accessMode: ANYONE` passed for this call only, because the page's gate already ran. The bot's own `accessMode` is untouched. Crisis keywords, the classifier and the held tokens are all the engine's, unchanged.
8. `appendMessage` (outbound, with run id, engine, citations and retrieval meta).
9. Unanswered questions go to `wa_unanswered_questions` with the shared ids, followed by the alert and the fallback event.

The stream sends only `status {code}`, `token {text}`, then `final {reply, citations [{title, url}], messageId, conversationId}`, or `error {code}`. **Never** `run_started`, `step`, or a status's `detail`/`documents`.

### ally-web (`apps/ally-admin-dashboard`)

| Area | Files | What |
|---|---|---|
| Entry | `b.html`, `src/botPage/main.tsx`, `vite.config.ts` (`rollupOptions.input` + the `botPageRoutes` dev/preview rewrite), `eslint.config.mjs` (import fence) | The public page. It imports nothing from the dashboard |
| Page | `src/botPage/BotPageApp.tsx`, `api.ts`, `screens/{Cover,Access,Prechat,Chat,ErrorState}.tsx`, `components/{parts,Turnstile}.tsx`, `copy/{en,hi}.ts`, `theme.ts` | Cover → email and code → pre-chat questions one at a time with progress → chat with suggestions, a live status line, the checked reply typed at reading pace, sources, New chat, resume on reload, and error and limit states. A refused message goes back into the box |
| SSE | `src/hooks/chatStream/sse.ts` | The one reader. `useChatbotTestStream` and `parseCopilotSse` now use it, unchanged in behaviour |
| Settings → Bot page | `pages/WhatsAppBot/BotPageTab.tsx`, `src/botPage/BotPagePreview.tsx`, `api/chatbots.ts`, `types/botPage.ts` | Section 2 of the brief; details in section 3 |
| Conversations | `ConversationsTab.tsx`, `ConversationDrawer.tsx`, `UnansweredTab.tsx`, `api/whatsappBot.ts`, `types/whatsappBot.ts` | Channel badge, channel filter, visitor label, pre-chat answers and consent, and Erase for a visitor. All appear only when the API sends `channel`, so the `wa` mode renders exactly as before |

**Bundle (a production `build:admin`):** the bot page loads `botPage-*.js` (30 KB raw, 9.7 KB gzipped) plus one shared chunk, which is React plus `sse.ts` (145 KB raw, 47 KB gzipped), and `botPage-*.css` (136 KB raw, 22.6 KB gzipped). None of it contains Carbon, Redux or PostHog.

## 3. Decisions (beyond the plan)

- **Settings → Bot page, not a top-level tab.** An existing test (`WhatsAppBot.test.tsx` "keeps the tab row short: configuration lives under Settings") pins the tab row, and the project rule is not to change existing tests. Settings sections are the codebase's place for configuration, next to Channels.
- **The bot page uses the admin app's Tailwind config.** A per-file `@config` in `botPage.css` broke the dashboard's styles in the dev server (Shehbaz saw it), so it was removed. The cost is a 22.6 KB gzipped stylesheet instead of a smaller one.
- **Errors use the repo's `ErrorCode` contract** (`BOT_PAGE_*`, plus `details` and `retryAfterSeconds`), because `CustomExceptionFilter` rewrites any other body.
- **The SES log masks recipients only for bot-page codes** (`maskRecipientsInLog`). An existing SES spec pins the full-address log for every other caller.
- **In development, a code is kept and logged (masked address) when SES fails.** Local stacks have no SES and usually no Slack token for the approved echo.
- **Pre-chat questions are asked once per person,** optional ones included. A new thread ("New chat", or after the idle window) carries the contact's latest answers over. Only required questions block a message.
- **A refused message isn't stored.** Every limit and the 409 refusal are plain HTTP errors before anything is written; the page puts the text back in the box.
- **Rate limits are a Redis service, not `@RateLimit`.** That guard is off when running locally and only knows ip and user.
- **The "reveal at reading pace" logic is the bot page's own copy of Preview's,** not extracted from `ChatbotTestTab`. Extracting it would have changed a tested component for no behavioural gain.
- **Pre-chat reorder uses Move up/Move down buttons** (keyboard- and screen-reader-friendly), not drag and drop.
- **No `web` connector type is registered.** It would have listed "Bot page" as a connectable channel on the Channels screen, so the Bot page section is the entry point instead.
- **Dashboard parity:** in shared mode a WhatsApp row's thread-only fields (message count, language, number, consent, block, organisation) come from the `wa_*` row with the same id, and the spine, times, messages and filters come from `chatbot_*`. `dashboard-parity.pg.spec` proves both modes give identical output.
- **Stacks wasn't searchable:** its MCP server wasn't connected in this session, so no Stacks guidance was applied (the same as 3c).

## 4. Security choices

- Visitors are httpOnly cookies, never readable by page JavaScript. They're signed with a secret no user token uses, and named per bot.
- **The cookie needs the page and the API on the same site.** Locally both are on localhost. **In production, `BOT_PAGE_BASE_URL` must share its registrable domain with the API.** If the page gets a domain of its own, switch to a bearer token held in memory.
- **No enumeration:** an uninvited email gets the same "code sent" answer, and no email is sent.
- **Codes:** only an HMAC is kept, 5 tries, 10 minutes, at most 5 sends per 15 minutes per address, and per-IP limits on top.
- **Access is re-checked on every request,** so removing an email or suspending a user locks them out at once.
- **Visitors never see run details:** no run ids, steps, search queries, document ids, retrieval metadata, prompts or settings. Citations are reduced to the title and an http(s) link.
- **Origin:** a browser call from any origin but the page's is refused (403), on top of the global CORS list.
- **Bodies are capped at 16 KB,** and the message length at the page's limit (at most 2000 characters).
- **Logs** carry visitor hashes, email domains and ids only, never message text.

## 5. Tests and results

| App | Spec | Covers |
|---|---|---|
| ally-be | `chatbot/bot-page/test/bot-page.service.spec.ts` | defaults (slug from the name, the crisis disclaimer), save and trim, public refused while blocked, slug rules, reserved and taken slugs (including the unique-index race), pre-chat validation, `findAvailable` (off, draft, paused, platform off, public blocked, malformed slug) |
| ally-be | `bot-page-access.service.spec.ts`, **`page-access-never-widens-whatsapp.spec.ts`** | normalising entries; invite and organisation eligibility (ACTIVE user, allowed tenant); **adding an email and an organisation to the page leaves every WhatsApp `canChat` verdict unchanged**, for each `accessMode` |
| ally-be | `bot-page-otp.service.spec.ts`, `bot-page-visitor.service.spec.ts`, `bot-page-rate-limit.service.spec.ts`, `bot-page-guard.middleware.spec.ts`, `bot-page-intake.spec.ts` | codes: right, wrong, expired, 5th try burns it, send limit, nothing readable in Redis, SES failure, the development path. The token: cookie flags, another bot's token, an admin JWT and a forged token refused, rotation, 30-day re-verify. Limits: hourly with Retry-After, the daily cap with one alert, failing open. Origin and 16 KB. Every pre-chat type, required fields and consent |
| ally-be | `bot-page-public.service.spec.ts`, `bot-page-public.controller.spec.ts` | sessions per mode, **no enumeration**, the IP limit, codes, every `admit` refusal (removed invite, unverified, length, per visitor, busy with one alert, intake required), storing both sides with run, engine and citations, the web channel with `accessMode` ANYONE for that call only, **`final` the same with and without streaming**, unanswered questions with shared ids, alerts and the fallback event, intake carried over, resume, New chat. The relay: **no `run_started`, `step`, query or document title reaches the page**, a refusal before the stream is plain HTTP, an error mid-stream is `error {internal}` with no detail, and closing the page aborts the run |
| ally-be | `web-channel-crisis.spec.ts` (the real engine) | **a crisis keyword gives only the crisis reply with nothing streamed; a classifier crisis drops the held text**; the web reply has no "Sources:" footer while WhatsApp's still does |
| ally-be | `whatsapp-admin-settings.controller.spec.ts`, `platform-admin-only-settings.spec.ts`, `whatsapp-conversation-store-switch.spec.ts` | the two switches need a platform admin, a bot can't override them, which store is read and when, and bot page questions stay out of the WhatsApp-only queue |
| ally-be (Postgres) | `bot-page.pg.spec.ts` (8) | resume and New chat (WhatsApp reuse unchanged), one contact across devices, switching email, `latestMetadata`, retention dropping answers and names, web erasure, `canChat` unchanged on real tables |
| ally-be (Postgres) | **`dashboard-parity.pg.spec.ts`** (19) | real WhatsApp traffic through the inbound handler, then the backfill. **`listConversations` (10 filter, sort and paging variants), `listLanguages`, `getConversation` for every thread, `listUnanswered` and bot stats are identical in `wa` and `shared` modes** apart from the added channel. A bot page chat appears only in `shared`, with its badge, visitor, intake, queued question and stats, and erases cleanly |
| ally-web | `botPage/__tests__/BotPageFlow.test.tsx` (10) | cover → email → code → pre-chat questions one at a time (with the required check) → chat streaming with sources; resume; New chat; limits and busy, with the text put back; not found; a wrong code; Hindi; the length limit; the SSE parser |
| ally-web | `pages/WhatsAppBot/__tests__/BotPageTab.test.tsx` (9), `ConversationsChannel.test.tsx` (3) | QR and link; the preview following edits; public disabled until allowed; save; pre-chat reorder, add, delete and the 8 cap; 4 suggestions; invite paste; read-only for viewers; why the link isn't answering. The badge, filter, visitor and intake card only in shared mode |

**Results:**

| Check | Result |
|---|---|
| ally-be `npm test -- --forceExit --detectOpenHandles` | **991 suites passed**, 5 skipped (the Postgres suites); **14,326 tests passed**, 0 failed |
| ally-be Postgres specs (`ally_chunk12_fresh`) | `src/whatsapp/shared-store` + `src/chatbot/bot-page`: **all pass** (chunk 12's 41, plus 19 parity and 8 bot page) |
| ally-be lint, typecheck, build | clean |
| ally-be migration | run → revert → run on `ally_local`: clean |
| ally-web `npm test` (all projects) | admin **550 files**, helpline **305 files**: all pass. The one failure in the first run was the repo's Prettier test on new `en.ts` lines; fixed, and it passes |
| ally-web lint (changed files), CI typecheck, `build:admin` | clean; `b.html` built (bundle sizes in section 2) |
| Existing tests | none changed. `WhatsAppBot.test.tsx` pins the tab row, so the Bot page became a Settings section (section 3) |
| docs-path-lint | ok |

**Live checks on the local stack** (real ally-be, ally-ai and Postgres; the GIF is at `~/Downloads/chunk-12b-bot-page-flow.gif`):
- **Invite flow:** the cover, then the email (an uninvited address got the same "code sent"), the code, both pre-chat questions one at a time, and the chat.
  - "How do I get access?" streamed "Looking it up…", then "Thinking…", then the reply typed out.
  - "How do streaks work?" answered with **Sources: Ally FAQ – Progress, Badges and Streaks**, listed once.
  - A reload resumed the thread; New chat closed it.
- **Crisis:** "I want to kill myself" gave only the crisis reply, with nothing streamed. The classifier phrase showed status codes, then only the crisis reply.
- **Dashboard:** with `sharedStoreWrites` on, the backfill clean and `dashboardReadsFrom: shared`, Conversations listed the WhatsApp threads (unchanged) and the bot page chats with **Bot page** badges, masked emails and a Channel filter. The thread showed "Answers before the chat". Knowledge gaps showed the page's declined questions.
- **Public guard:** a public page gave 404 while `botPagePublicAllowed` was off, then 200 with a session and no sign-in once it was on (restored to off afterwards).
- **Limits:** the 2nd message in an hour with a limit of 1 got 429 `BOT_PAGE_THROTTLED` with Retry-After. Removing an invite gave 403 at once.
- **Origin:** a request from the helpline's origin (`:8080`) got 403 `origin_not_allowed`.
- **Not checked live:** Turnstile (no keys locally; covered by specs), a real SES email (development logs the code instead), and logo upload to S3 (no assets bucket locally; the link field works).

## 6. How Shehbaz tests it

**Ports:** dashboard and bot page at http://localhost:8081, ally-be at `localhost:8001`, ally-ai at `localhost:3001`.

1. **Suites, migration and the local switches.**
   - ally-be:
     - `npm test -- --forceExit --detectOpenHandles`
     - `npm run lint && npm run typecheck && npm run build`
     - `npm run migration:run` (then `migration:revert` and `migration:run`)
   - ally-be Postgres specs (need a fresh schema copy, as in CHUNK-12-NOTES):
     - `docker exec ally-be-postgres-1 psql -U postgres -c "DROP DATABASE IF EXISTS ally_chunk12_fresh" -c "CREATE DATABASE ally_chunk12_fresh"`
     - `docker exec ally-be-postgres-1 sh -c "pg_dump -U postgres -s ally_local | psql -q -U postgres -d ally_chunk12_fresh"`
     - `CHATBOT_STORE_TEST_DB=postgres://postgres:<DB_PASSWORD>@localhost:5477/ally_chunk12_fresh npx jest src/whatsapp/shared-store src/chatbot/bot-page` (expect 8 + 41 + 19 Postgres tests passing)
   - ally-web (Node 22):
     - `npm test`
     - `npm run lint`
     - `npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json`
     - `npm run build:admin`
   - **Restart `ally-be-app-1` after the Jest suite** (its temp lint files break the watcher's compile).
   - **If the admin container shows "Failed to resolve import qrcode",** run `docker exec ally-web-admin-1 sh -c "cd /app && npm install"`. The container keeps its own `node_modules`.
   - **Shared store and dashboard switch (local):**
     - `update global_settings set value = value || '{"sharedStoreWrites":true,"dashboardReadsFrom":"shared"}' where name='whatsapp_bot';`
     - then `npm run backfill:chatbot-shared-store` and `npm run check:chatbot-shared-store` ("No mismatches").
2. **Dashboard → AI Chatbots → Sunrise Mind.**
   - Publish it first (Overview). It's a draft locally, and a draft bot's link answers "not available"; the Bot page section says so.
   - **Settings → Bot page:**
     - Turn it on and set the link name `sunrise-mind`.
     - Upload a logo (needs `ASSETS_S3_BUCKET`; otherwise paste a link) and pick a colour.
     - Add 3 suggested questions and 2 pre-chat questions (name; reason as a single choice).
     - Access: **Specific people**. Save once, then add your email.
     - Watch the phone preview change as you type; the QR code and Copy link follow the link name.
3. **Open the link in a narrow window** (or on a phone on the same network, using your machine's address).
   - Start, enter your email, and Send code. **Locally the code is in the ally-be log:** `docker logs ally-be-app-1 2>&1 | grep "Bot page code"` (development only, address masked).
   - Answer the two questions, one per screen.
   - Ask the Sunrise test sheet's B and C questions and watch "Looking it up…", then the reply typing out, then sources under it.
   - Reload: the chat resumes. Tap **New chat**: an empty chat with the suggested questions.
4. **Crisis.**
   - "I want to kill myself": only the crisis reply, with nothing typed first.
   - A phrase only the classifier catches ("honestly I can't go on anymore, there is no point to anything"): status codes, then only the crisis reply.
5. **Dashboard → Conversations.**
   - Your chat has a **Bot page** badge and your masked email. Open it to see "Answers before the chat" at the top.
   - WhatsApp threads look exactly as before. The **Channel** filter splits them.
   - Knowledge gaps carries the same badges.
   - Set `dashboardReadsFrom` back to `wa` and the screens are the WhatsApp-only views of before.
6. **Access: Anyone with the link** is greyed out ("turned off until the crisis safety review is done"). As a platform admin, `PUT /api/v1/whatsapp/settings {"botPagePublicAllowed": true}` (or the SQL above with that key). Choose it, save, and chat from a private window with no sign-in.
7. **Limits:** set "Messages per visitor per hour" to 2, save, and send three messages. The third says "You're sending messages quickly. Please wait N min", and your text goes back in the box.

**Already set up locally** (from this chunk's own checks): the page `ally-faq-smoke` on Ally FAQ, invite-only, inviting `smoke@example.com` and `asha@example.com`.

## 7. Ops (production)

- **Deploy order:**
  1. ally-be migration.
  2. Set `BOT_PAGE_BASE_URL` (default: the admin URL), `TURNSTILE_*` for public pages, and optionally `BOT_PAGE_VISITOR_SECRET`. Add the page's origin to `ALLOWED_ORIGINS` if it isn't the admin origin.
  3. Deploy the admin app (it now builds `b.html`).
- **Infra (not in this repo):**
  - CloudFront: a rule or function mapping `/b/*` to `/b.html`.
  - Caddy (`static_vite_Caddyfile`): `try_files {path} /b.html` for `/b/*`, before the `index.html` fallback.
- **Dashboard switch:** `sharedStoreWrites` on → backfill → check clean for a day → `dashboardReadsFrom: shared` (platform admin). Until then, bot page chats are stored but not listed.
- **Watch for:** `Bot page daily cap reached` (Slack), `Turnstile check failed`, and `Bot page code for chatbot … was not sent`.

## 8. Open items

- **`botPagePublicAllowed` stays off until chunk 15a (gate G1b).** Organisation and invite pages may go live before that (Shehbaz).
- **The domain** for `BOT_PAGE_BASE_URL`, and the same-site constraint in section 4. Plus the CloudFront and Caddy rules.
- **Q2:** thumbs up or down on bot page replies, and the scorecard.
- **Chunk 13 (widget)** should embed this page (`b.html`) and reuse its access and pre-chat questions.
- **Phone invites:** no SMS provider exists.
- **Visit and intake analytics** (in the `v2-chunks.md` 12b row, not in the brief).
- **Owner notifications:** the daily-cap alert goes to Ally's Slack, not to the bot's owner.
- **Organisation picker:** organisations are added by tenant id, as on the Access list. A searchable picker would be kinder.
- **Hindi copy** was drafted here; a native speaker should review it before launch.
- **SES logs full addresses for every other email**; worth deciding platform-wide.
- **The `wa_contacts.phone_e164` varchar(32) erasure bug** (chunk 12) is still open.
- **When the shared store becomes the source of truth** and the dual-write stops.
- **Stacks** couldn't be consulted (MCP not connected); the labels and limits here are worth a pass against it.

## 9. Commits, in review order

```
190bf5ca1 docs(agents-v2): chunk 12b brief, quality chunks; current chunk 12b [12b]
3193fe4de docs(agents-v2): chunk 12b code map [12b]
88e602c2d feat(chatbot): bot page tables, settings and admin routes [12b]
747691c13 feat(chatbot): public bot page API: session, OTP, intake, streaming messages [12b]
c36928718 feat(chatbot): dashboard reads from the shared store behind dashboardReadsFrom [12b]
b957ffa6c feat(chatbot): bot page replies list their sources, not a text footer [12b]
485974ee8 feat(admin-dashboard): shared chat stream module; bot page entry and screens [12b]
4bf0afd51 feat(admin-dashboard): Bot page settings with live preview and QR; channel badge and filter [12b]
(this commit) docs(agents-v2): chunk 12b notes [12b]
```
