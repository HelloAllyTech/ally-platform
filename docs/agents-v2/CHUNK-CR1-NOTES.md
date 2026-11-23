# Chunk CR1: notes — costs, models, tokens, plans and seats

Built 19 Nov 2026 on `feat/agents-v2-cr1`, commits tagged `[CR1]`. Brief: `chunk-cr1.md` (block 2 of `FINAL-PLAN.md`). Plan approved with seven decisions at stop 1 (below).

## Decisions at the plan stop (Shehbaz, 19 Nov)

1. Starting tokens for existing custom logins: max(20M, 3× their last 30 days), renewing monthly.
2. Seats are strict: an invited person without a seat can't chat from deploy day. Organisation-page people need seats too (by email). The backfill's dry run lists, per assistant, everyone who would be blocked.
3. Try it never uses a seat; it counts toward owner-side runs and tokens only.
4. Seat messages, customer conversations and owner-side runs are counted synchronously before the run, idempotent on (run id, kind). Only tokens and costs ride the SQS usage path.
5. A spike alert needs the assistant over 5× its 7-day average **and** over $1 today.
6. Follow-up: the crisis check's code default `gpt-4o-mini` leaves the OpenAI API on 14 Jan 2027.
7. A loud warning and Slack alert when `LLM_USAGE__QUEUE_URL` is unset in production.

Starting numbers as proposed: $20 daily budget, $0.50 a conversation; Free 3 published, Pro 20; 5 included Basic seats; Basic 500 and Premium 3,000 messages a month; customers Free 300, Pro 3,000; owner runs Free 100, Pro 1,000; current creators on Pro, Ally's own on `internal`; prices left blank.

## The metering map

Every paid call an assistant makes, its kind and how it's attributed. ally-be sends an `X-Ally-Usage` header (run, assistant, draft, creator, conversation, channel, kind) on each call; ally-ai copies it onto every usage row with `step` and `seq`; ally-be prices the row into `usage_events`.

| Call (ally-be → ally-ai) | Kind | Set where |
|---|---|---|
| Agent run `/agent/run[/stream]` (bot page, bubble, WhatsApp) | `customer_reply` | engine `respond()` (`engine-usage.ts`) |
| Same, Try it / checkup question | `try_it` / `checkup` | engine, inside the owner route / checkup context |
| `search_knowledge` query embedding | the run's kind | ally-ai `knowledge_chunk_service.search` (new) |
| Crisis check | `crisis_check` | `ENDPOINT_USAGE_KIND` |
| Memory check, summary | `memory_check`, `summary` | memory/summary `afterTurn` |
| Setup step, site reading | `setup`, `site_reading` | owner route context (`v1/bot-drafts/:id`) |
| Indexing (`bulk-upsert`) | `indexing` | `KbIngestService.run` |
| Checkup questions, grading | `checkup`, `judge` | checkup `execute` |
| Change by chat | `change_by_chat` | owner route context |
| How it works (`/agent/instructions[/check]`) | `instructions` (not in the brief) | owner route context |
| Old admin preview `/knowledge-agent/answer` | the run's kind | owner route context |
| **Meta WhatsApp fees** (status webhooks, `pricing.billable`) | `whatsapp` | `WhatsAppPricingService` |

Not assistants, so they stay in `llm_usage` only and show on Costs as one "Other Ally products" line at today's prices: Learn/voice training, helpline, Debrief and its judges, analytics, Ask Ally, PM agent, text generations, transcription and TTS, and ally-be's direct OpenAI calls. Site reading's crawl is ally-be's own fetcher (free); there is no scraping service.

**Tests that keep the map whole:** `ally-be/src/billing/test/usage-context.spec.ts` (every metered endpoint maps to a kind), `ally-ai/tests/core/llm_usage/test_metering_map.py` (attribution on every dispatch call; embeddings emitted; an AST check that no assistant module calls a provider SDK except through the dispatcher or the embedding service).

## Code map

**ally-ai** (`app/core/llm_usage/`): `scope.py` (the per-request scope from `X-Ally-Usage`; tasks share the `seq` counter, `step` per task), `emitter.py` (sends off the event loop on a 2-thread pool; never raises), `dispatch.py` `_emit_usage` (adds the scope), `knowledge_chunk_service.py` (embedding rows, tiktoken counts), `middleware.py` `UsageScopeMiddleware` (pure ASGI, holds through SSE), `/api/health` `usage_feed`, new `LLMTask`s `embedding_search` and `embedding_index`.

**ally-be** (`src/billing/`, a global module):
- `context/usage-context.ts` (AsyncLocalStorage; `usageHeaders`, `ENDPOINT_USAGE_KIND`), `context/owner-usage.interceptor.ts` (owner routes), `chatbot/engine/engine-usage.ts`.
- `service/usage-event.service.ts` (prices and records; listeners in the same transaction), `billing-catalogue.service.ts` (models, price versions, WhatsApp rates, settings, fixed costs), `cost-report.service.ts`, `cost-alert.service.ts` (hourly; once a day per subject), `whatsapp-pricing.service.ts`.
- Token allowances (grants, FIFO consumption, overdraft, renewals) were replaced by the spend cap in CR3: `service/spend-cap.service.ts`, see `CHUNK-CR3-NOTES.md`. The token service is gone; its two tables remain, unread.
- `service/plan.service.ts` (plans, seat types, subscriptions, publish limit, seats, renewals), `limits.service.ts` (every limit before a run; counters), `plan-view.service.ts` (owner and admin views, no dollars).
- `backfill/billing-backfill.ts` + `npm run billing:backfill`; `user/custom-login/` + `npm run custom-logins:migrate`.
- Controllers: `v1/admin/billing/*` (manage_costs), `v1/me/plan`, `v1/chatbots/:id/seats` + `publish-use` (chatbot module), `v1/custom-logins` (admin_user_management).
- Engine: `chatbot/engine/limit-reply.ts`; `respond()` checks limits first, runs `crisisOnly` when limited, else the fixed reply (`handledBy: rate_limited`, `limited: <reason>`).
- Auth: `UserRole.ASSISTANT_OWNER` + `ASSISTANT_OWNER_PERMISSIONS`, `@PlatformAdminOnly()` on the Ally-wide WhatsApp routes and phone mappings; mapping writes return 410.
- Migrations: `1985400000000-CreateBillingCosts`, `1985400000100-CreateAssistantOwnerAndTokens`, `1985400000200-CreatePlansAndSeats`. `DATA_SCHEMA.md` §3.24.

**ally-web** (`apps/ally-admin-dashboard/src/pages/Billing/`, `api/billing.ts`): Models (with WhatsApp rates), Costs, Plans, a user's Tokens and Plan (Custom logins and Ally admins details), the owner's Plan and usage, Share → People seats, the publish-limit line. Custom logins created with the new role; the WhatsApp Numbers tab is gone.

## Mismatches found (code vs brief)

- **Meta bills per delivered message**, not per conversation (since July 2025), and charges service replies past 1,000 free per number a month since 1 Oct 2026. CR1 records each status callback with `pricing.billable` true, by category and recipient country.
- **`llm_models` is the runtime pickers' list** and refuses providers no runtime can run. Prices live in a separate `billing_models` list matched by provider + model id; nothing about which model a call uses changed.
- **Usage was already sent** from ally-ai over SQS (`llm_usage`); CR1 extends it rather than adding a second path.
- **A seventh owner-side kind:** How it works (`instructions`) makes model calls.
- **The crisis classifier runs on `gpt-6-luna`** via the Skills Store; the code default is `gpt-4o-mini`.

## Behaviour worth knowing

- **Never blocks a reply.** ally-ai sends usage on a background thread. ally-be records after the run, from SQS; a database failure redelivers (the unique key makes that safe).
- **Limits fail open.** A counting error lets the message through and logs; a counting outage must not silence assistants.
- **Customer conversations** count when one starts: no message in the last 24 hours (`customer_activity`, keyed by conversation or sender). A refused first message isn't recorded as activity, so the next one is still "new".
- **Seats:** owners, then editors, then viewers, then invited emails get the included seats. Extra seats renew on their own date while the subscription is active and lapse otherwise. Included seats lapse only if the subscription is cancelled. `internal` needs no seats.
- **Tokens no longer limit anything** (CR3). A creator's cost this period is checked against a dollar cap instead: `CHUNK-CR3-NOTES.md`.
- **Owner-side runs:** a setup step, a checkup run (not per question), change by chat, Try it, re-indexing (counted, never refused: it's a queue) and site reading (once a day per draft; at the limit the pages are skipped).
- **Publishing:** live only counts; paused doesn't, but unpausing is checked like publishing. Lowering a plan never unpublishes.
- **No dollars outside `manage_costs`:** owner and customer replies, `v1/me/plan`, seats and publish-use carry counts only. A web test checks the owner screens render no `$`.

## How to test

- **ally-be:** `npm test -- --forceExit --detectOpenHandles` (1,267 suites; the Postgres specs skip without a database), `npm run lint`, `npm run typecheck`.
  - Postgres specs: `CHATBOT_STORE_TEST_DB=postgres://postgres:<DB_PASSWORD>@localhost:5477/ally_cr1_test npx jest src/billing src/user/custom-login` (a copy of the local schema plus CR1's migrations).
  - Engine limits: `npx jest src/chatbot/engine/test/chatbot-engine-limits.spec.ts` — crisis replies at all five limits, no agent call.
  - Walk test: `npx jest src/chatbot/access/test/assistant-owner-walk.spec.ts`.
- **ally-ai:** `poetry run pytest tests/ -v`, `poetry run flake8`.
- **ally-web (Node 22):** `npx nx test ally-admin-dashboard`; screenshots with a local vite on :8093 and `npx playwright test -c apps/ally-admin-dashboard/playwright.config.ts billing`.
- **By hand:** see the PR's "How to test".

## Open questions and follow-ups

1. The super-admin AI cost charts (Analytics) still price from `MODEL_PRICING`; point them at `billing_models` so there's one price list.
2. The crisis-check and translate code defaults (`gpt-4o-mini`) before 14 Jan 2027.
3. Embedding calls outside assistants (Context Library, roadmap, reference documents) aren't metered; Sarvam STT, the TTS round-trip eval and the debrief guidance toolbox emit no usage at all.
4. A retried crisis check reuses the run id and its first call's `seq`, so a retry's tokens are dropped as a duplicate (small undercount).
5. Token history starts at deploy, so decision 1's "3× last 30 days" is 20M for everyone the first time.
6. Ally admins can't assign a seat to a person themselves; owners do (Share → People). Add it to the admin Plan tab if support needs it.
7. Context Library: the MCP wasn't connected in this session, so product wording follows the brief, uncited.
