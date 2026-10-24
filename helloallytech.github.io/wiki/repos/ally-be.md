---
title: ally-be — Core Backend
tags: [repo, backend, nestjs, api]
summary: ally-be is the multi-tenant NestJS backend that owns Ally's primary PostgreSQL database and orchestrates auth, real-time voice sessions, the audio/transcription pipeline, AI-driven feedback, and analytics for the counselor-training platform.
last_reconciled: 2026-08-06
---

# ally-be — Core Backend

## Purpose

ally-be is the core API and event-processing service of the Ally platform — a multi-tenant, HIPAA-compliant backend for training mental health counselors. It owns the platform's primary PostgreSQL database and serves the web and mobile clients. Its responsibilities include:

- **Scenario-based learning** — simulated client conversations, learning pathways, and session management.
- **Real-time communication** — WebSocket gateways plus LiveKit voice/video rooms.
- **Audio & transcription pipeline** — async processing via AWS SQS and S3 with dead-letter-queue handling.
- **AI-driven insights** — call summaries, live nudges, and session reports through LLM integration.
- **Conversational guardrails** — real-time boundary-violation detection with multi-language support.
- **Multi-tenant access control** — role-based permissions, groups, and tenant isolation.
- **Gamification** — badges and community leaderboards.
- **AWS integration** — S3, SQS, SES, and CloudWatch for storage, messaging, email, and audit logging.
- **Versioned REST API** — documented via Swagger/OpenAPI.

It is architected as a modular NestJS monolith. Schema changes ship as TypeORM migrations (`synchronize: false`).

## Tech Stack

Sourced from `package.json` and `README.md`.

| Component | Technology |
|-----------|------------|
| Runtime | Node.js v24 |
| Language | TypeScript (~5.9) |
| Framework | NestJS 11 (`@nestjs/*`) |
| Database | PostgreSQL (`pg`) via TypeORM (`@nestjs/typeorm`, `typeorm` 0.3) |
| Caching / pub-sub | Redis (`ioredis`, `@nest-lab/throttler-storage-redis`) |
| Real-time | Socket.IO (`@nestjs/platform-socket.io`, `@nestjs/websockets`), LiveKit (`livekit-server-sdk`) |
| Auth | JWT (`@nestjs/jwt`), Passport (`passport-jwt`, `passport-local`), `google-auth-library`, `bcrypt`, `jose`, `jsonwebtoken` |
| AI / LLM | OpenAI (`openai`), Anthropic (`@anthropic-ai/sdk`) |
| STT / TTS | Deepgram (`@deepgram/sdk`), ElevenLabs (`@elevenlabs/elevenlabs-js`), Google Cloud (`@google-cloud/text-to-speech`, `@google-cloud/translate`), Sarvam (`sarvamai`), Hume (`hume`) |
| AWS | `@aws-sdk/client-s3`, `client-sqs`, `client-ses`, `client-cloudwatch-logs`, `s3-request-presigner` |
| API docs | Swagger/OpenAPI (`@nestjs/swagger`) |
| Scheduling | `@nestjs/schedule` |
| Rate limiting | `@nestjs/throttler` |
| Health checks | `@nestjs/terminus` |
| Validation | `class-validator`, `class-transformer`, `joi` |
| Logging | Winston (`winston`, `winston-cloudwatch`) |
| Security | `helmet`, `sanitize-html` |
| Media | `fluent-ffmpeg` |
| Testing | Jest (`jest`, `ts-jest`), Supertest |
| Lint / format | ESLint 9, Prettier, Husky |

## Architecture & Key Modules

Feature modules live under `src/<domain>/` (controllers, services, DTOs, and `entity/*.entity.ts`). Notable modules:

**AI & audio**
- `ai/`, `ai-chat/` — LLM integration (OpenAI streaming), session summarization, event analysis, provider abstraction.
- `audio/`, `audio-ingest/` — audio storage plus SQS-based async transcription pipeline with DLQ handling.
- `conversational-guardrails/` — real-time boundary detection (binary classification) with multi-language support and automatic agent redirect.
- `prompt/`, `prompts/` — versioned system prompts with dashboard sync and per-tenant runtime override resolution.
- `skill-experiment/` — **auto-improve** for System Skills (prompts): an admin switches it on per skill and writes a rubric; the skill's outputs are judged by an LLM against it, a prompt-designer call drafts a revised variant from the judge's reasons, and the variant is A/B tested against the current best on live traffic until the best version reaches the target score, then pauses with that version serving for the admin to apply, resume or turn off. Drafts must keep every runtime placeholder token of the original exactly (checked in code — a draft that drops, renames or invents one is never served), the judge never sees which variant it is scoring, and a failing challenger falls back to the skill's own text so no user loses their result. Only skills whose call sites report outputs ("connected" skills) can run one; ally-be picks the text for all three runtimes, so connecting an ally-ai skill needs no ally-ai change. `SKILL_EXPERIMENTS_SCHEDULE=off` freezes every loop. Reference: `docs/skill-experiments.md`; the concept, the pause reasons and the known limits are on [Auto-improve](../platform/auto-improve.md).
- `voice-preview/` — TTS voice preview across ElevenLabs, Deepgram, Sarvam, Google, and Hume.

**Learning & sessions**
- `learn/`, `scenario-path/` — scenario engine, learning pathways, session management. A session is a voice call or, for text-helpline training, a **text chat** (`scenario_sessions.interactionMode`). Text needs two switches, both off by default: the org preference `TEXT_CHAT_ROLEPLAY_ENABLED` (platform admin) and the scenario's `metadata.textChatEnabled` (author); a TEXT start with either off is refused with `FEATURE_NOT_ENABLED` rather than falling back to voice. The room, dispatch, scoring and debrief are the voice path's — the envelope just carries `interactionMode: "TEXT"`, and no egress recording is started.
- `scenario-character/` — client-persona (NPC) definitions.
- `scenario-report/`, `scenario-session-review/`, `scribe-session-review/` — reporting and threaded review/feedback.
- `session-event/`, `case/`, `reference-document/` — event tracking, case management, supporting materials.
- `course-discussion/` — learner discussion threads under individual course (`track/`) items. A course author switches it on per item (`track_items.hasDiscussion`); threads nest three deep and are isolated per organisation, because courses are shared across organisations but learners' reflections are not. Course editors (`edit:admin:track`) can moderate any organisation's thread; a reply sends the parent author an in-app notification. Design notes: `docs/course-discussions.md`.

**Learner progress & engagement**
- `progress/` — learner XP, levels and the personal Progress dashboard. An append-only `xp_events` ledger with a `user_progress` rollup written in the same transaction; the ledger is the record because a roleplay session's contribution cannot be rebuilt after the fact. It earns XP by *listening*, not by being called: `SCENARIO_SESSION_ENDED` and `track.item.completed` are consumed as in-process events, which keeps the module a leaf (no `forwardRef` against Learn or Track) and inherits the end-of-session compare-and-set, so a redelivered message or the unfinalised-session sweeper cannot double-award. Idempotency is a unique index on `(userId, tenant_id, rule, sourceType, sourceId)`. Lifetime practice minutes are deliberately *not* stored here — `user_daily_scores` stays the single source so the dashboard cannot disagree with the certification chart or the badge ladders. `ProgressTenantResolver` collapses the two spellings of `tenant_id` (uuid and short code) that coexist across the schema. Gated per tenant by the `PROGRESS_DASHBOARD_ENABLED` org preference, off by default.
- `foundational-skills/` — the **foundational helping skills** measure: a passive, scenario-independent answer to "are learners getting better at the skills every helping conversation needs?". Every scenario scores against its own competencies, so this module ignores all of them and applies one fixed rubric of 14 transcript-observable helping skills. A 30-minute scheduler task cuts each learner's completed roleplay speech, in the order sessions ended, into fixed 5,000-character slices of their *own* words (`foundational_skill_cuts`: append-only, rubric-independent, no transcript text copied), then scores each slice with a pinned LLM judge that must quote the line behind every behaviour it ticks; code verifies the quotes and derives the 1–4 level, so the model never assigns a score (`foundational_skill_assessments`, keyed by rubric version so a rubric change re-scores instead of mixing rulers). Read by `GET /v1/analytics/foundational-skills` (Priority chart AAQ-166), which compares each cut's learners with themselves at their first cut because later cuts contain only the people who kept practising. `FOUNDATIONAL_SKILLS_SCHEDULE=off` stops it. Reference: `docs/foundational-helping-skills.md`.

**WhatsApp Q&A bot**
- `knowledge-base/` — the bot's corpus. Upload (presigned S3) or paste, then extract (PDF/DOCX/EPUB/URL/plain text), chunk to ~400 tokens on section boundaries, and index into ally-ai's `KnowledgeChunk` collection over SQS. Postgres is the system of record and the vector index is derived: `kb_document_chunks.id` **is** the Weaviate object UUID. Nothing is hard-deleted — archiving hides a document from retrieval while its chunks stay, so citations already recorded in the conversation log still resolve. Each document is targeted at one, some or all organisations (`kb_documents.is_global` + `kb_document_tenants`, the same shape as `scenario_tenants`/`track_tenants`/`case_tenants`); retargeting rewrites the audience on the existing vector objects in place rather than re-chunking, since re-chunking would re-embed every passage to change a flag and orphan recorded citations.
- `whatsapp/` — the channel. Provider-agnostic behind a `WHATSAPP_PROVIDER` token (Meta Cloud API is the only implementation); webhook → dedupe → rate limit → consent → keyword templates → **identity** → retrieval → send, plus the admin read side (conversation log, unanswered-question queue, usage analytics). Open to anyone with the number, so the rate limit, consent gate and disclaimer are load-bearing rather than optional.

  Because the corpus is targeted per organisation, answering a question needs to know which organisation is asking, and a phone number is the only identifier WhatsApp supplies. `wa_contacts.user_id`/`tenant_id` carry the answer, resolved on every message from **two sources in order**: an admin's explicit mapping (`wa_phone_mappings`, surfaced as the **WhatsApp Numbers** tab under User Management, one at a time or by bulk upload), then a match against `users.phone`. The mapping wins, because it is a deliberate statement made for this purpose while the profile field is incidental and often an old handset; the disagreement is shown in the mapping table rather than resolved out of sight. A mapping deliberately needs **no** user account — most people this bot serves never log into Ally, and they are the ones it exists for.

  The `users.phone` fallback is **all-or-nothing**: exactly one active user must match, since picking one of two candidates would answer a worker out of a stranger's organisation. Resolution re-runs on every message, so a number mapped (or added to a profile) later starts working on the next question. An unresolved contact is told its number is not recognised (`handled_by = unidentified`, counted apart from `declined` because the two have opposite fixes) and is **never** answered from the global corpus — that would mean the same question got a different answer depending on whether we happened to recognise the sender.

  One definition of "the same number" lives in `src/whatsapp/util/phone.ts` (last ten digits, then a tail check to reject a different country ending the same way) and every path uses it. Two implementations would mean an admin seeing a mapping in the table while the bot still refuses the worker. Bulk upload reports **per row** — created, moved, already there, conflict, unusable, repeated — rather than all-or-nothing, because one mistyped number must not throw away a 200-line roster; a number already mapped to a different organisation is reported as a conflict and left alone unless the admin re-runs deliberately.

  The identity gate sits BELOW opt-out and the keyword templates and runs the LLM crisis classifier itself before refusing. Someone in danger is not less in danger for being unrecognised, and that ordering is what keeps both safety layers reachable for the people we know least about.

**Agents that build**
- `builder/` — the **Builder** agent: interviews a platform admin into a PRD, then builds it. Two halves that share one set of tables. The interview runs in-process (Anthropic SDK, SSE to the browser) and writes a versioned PRD document. The build cannot: ally-be can neither check out a repo, run a test suite, nor open a pull request from inside its container, so it dispatches a GitHub Actions run and *owns the protocol that run follows* — the runner fetches its instructions from `GET /v1/builder/pipeline/runs/:id/prompt` at run time, which is why a change to how builds work takes effect on the next dispatch instead of after a PR merges. Everything asymmetric about the module (a second controller authenticated by `X-API-Key`, a reconcile tick, prompt-over-HTTP) follows from that split. A run that needs a human commits its work in progress, posts its questions and exits 0; the answer dispatches a fresh run that continues from those branches. Off by default behind both `FeatureToggleKey.BUILDER` and a separate `builder_settings.enabled` kill switch — the toggle decides who sees the tab, the switch decides whether anything will dispatch. Human review and merge always; Builder never merges.

- `course-copilot/` — **Course Copilot**: interviews a trainer one question at a time, proposes a course blueprint, waits for approval, then generates every component into a DRAFT Track 2.0 course and keeps editing it on request. The interview is a fork of Builder's (streamed, provider-neutral, tools exposed by session state); content comes from one-shot JSON specialists, and a new roleplay goes through the same Agent Builder field chain the admin wizard runs, server-side (`learn/service/agent-builder-chain.service.ts`). Three invariants shape the module. Every write to a course goes through `TrackService.upsertStructure`, the editor's own path, so generated content passes the same validator and the same structural lock once learners enrol — and because that call refuses ids it did not mint, blueprint ids are *mapped* to track rows rather than reused. The build is durable rather than in-memory: one `course_copilot_jobs` row per item, claimed with a conditional update and resumed by a reconcile tick (and once after boot), because a deploy replaces the process mid-build. And publishing, assigning to organisations and duplicating are confirmed in code — the tool asks, and acts only on a reply to that exact question. Platform-tier only for now, behind `FeatureToggleKey.COURSE_COPILOT`; design and departures from the plan are in ally-be's `docs/course-copilot.md`.

- `ux-signals/` — the **UX Signals** scan: the platform's only *reader* of PostHog. Telemetry was write-only until this existed — the helpline frontend captured events and nothing read them back. Seven deterministic HogQL detectors (API-error spikes against each endpoint's own weekly baseline, error loops, rage and dead clicks, route abandonment, zero-result search, funnel drop-off) find what crossed a threshold, then one LLM triage call clusters signals sharing a cause and classifies each as bug- or improvement-shaped. It owns **no review surface**: bug-shaped items are written into Bug Hunter's `bug_findings` (`source='ux_signal'`), improvement-shaped ones into the Analytics Suggestions queue (`source='ux_signal'`), each reviewed where its audience already works and behind that queue's existing gate. Nothing here can approve a fix, dispatch a session or file a roadmap item. Three details are load-bearing: findings carry no `file`, so the route goes in `symbol` to keep `dedupe_key` on its exact path rather than its description-fingerprint fallback; `repo` is set outright to `ally-web` because the provenance of the data already answers it; and detectors select event properties only, never person properties, since PostHog persons carry email and name. Inert without `POSTHOG_HOST`/`POSTHOG_PERSONAL_API_KEY`/`POSTHOG_PROJECT_ID` — the scan answers 503 with that reason and the scheduled tick self-gates, rather than failing daily. Gated by `FeatureToggleKey.UX_SIGNALS`.

**Ally, the AI course companion**
- `guide/` — **Ally**'s runtime: a conversation per learner per course (`guide_threads`) that walks them through a course's items, answers questions about it and offers optional practice. A turn runs a safety classifier first, then an orchestrator model with tools (present a course item, consult the course tutor, remember, save to the notebook, offer a side quest) under a per-turn situation report. Events stream to the learner app over SSE (`GET /v1/guide/threads/:id/events`, resumable with `Last-Event-ID`), and voice turns run through the ally-ai-learn guide worker on LiveKit. Its wire contract is one JSON Schema, `src/guide/contract/guide-contract.schema.json`, from which `scripts/guide-contract/codegen.mjs` writes the TypeScript and Python types. It is off by default: one platform switch turns it on, an organisation or a single course can still be switched off, and the learner app falls back to the classic course player whenever Ally is unavailable. The admin API under `/v1/guide/admin` serves the Ally Console (releases, configuration, conversations, alerts, the Playground's dry-run turns).
- `guide-learning/` — Ally's learning loop: a nightly evaluator grades sampled turns against a rubric, people label a review queue (agreement measured as κ per criterion), eval cases replay releases in dry run, and a curator proposes small lessons that go through guardrails, a shadow run and a canary before they reach everyone. How much of that runs without a person is set by a delegation stage, and a bad canary is always reverted.
- `llm-agent/harness/` — what both share: versioned agent releases with an audit trail, per-organisation and per-course config overrides, and the eval and learning-loop tables.

**Platform & infrastructure**
- `auth/`, `authorization/` — authentication plus RBAC guards and permission decorators.
- `tenant/`, `user/`, `settings/` — multi-tenant management, users, config.
- `public-roadmap/` — the cards on the learner app's public `/blog/roadmap` page: a fixed grid of two categories (prepare, perform) by five maturity stages (idea → stable). Only the cards are data (`public_roadmap_items`); the grid's headings and copy live in the frontend. `GET /v1/public-roadmap` is unauthenticated and serves visible cards; `/v1/public-roadmap/items` is the admin editor (Settings → Roadmap), gated like Terms and Privacy. Edits are live on save, with no draft state — a per-card visibility flag is how a card is kept off the page. Unrelated to `product-roadmap/`, the internal voted backlog.
- `livekit/` — room lifecycle, participant tracking, agent dispatch, webhook handling.
- `aws/`, `queue/`, `message-broker/`, `redis/` — AWS wrappers, SQS setup, Redis pub/sub, Redis client.
- `audit/` — HIPAA-compliant CloudWatch audit logging.
- `analytics/` — Metabase integration and tenant-specific dashboards.
- `analytics-agent/` — the **Analytics Agent**: natural-language analytics questions turned into read-only SQL. Owns the trust boundary (table allowlist, denied columns, single-SELECT guard, `READ ONLY` transaction with a statement timeout and row cap) and calls ally-ai to plan the query and narrate the result. Gated on the elevated super-duper-admin tier. See [Analytics Agent](../platform/analytics-agent.md).
- `badge/`, `community/` — gamification and leaderboards.
- `language/`, `dynamic-i18n/` — translation service and internationalization.
- `scheduler/`, `health/`, `rate-limit/`, `notification/`, `database/` — background jobs, health checks, throttling, SES notifications, TypeORM data source/migrations/seeds.

**WebSocket gateways**
- `/microphone-chat` — live audio chat with message streaming.
- `/audio-ingest` — cloud-telephony integration.
- `/scenario-report` — real-time scenario reporting.
- `/builder` — live build transcript for a Builder session (rooms are `session:<id>`). An optimisation rather than a dependency: the admin polls the same events endpoint regardless, so a socket that never connects degrades the feed without breaking it.
- `/course-copilot` — build progress for a Course Copilot session (rooms are `course-copilot:<id>`). Same arrangement as `/builder`: a push reaches only clients on the process running the build, so the admin also polls `GET /v1/course-copilot/sessions/:id?afterSeq=` while jobs are live.

**Auth model** — the REST API is versioned (`/api/v1/...`). Supported methods: JWT (access/refresh flow), email OTP (v2), Google OAuth, Magic Link, and `X-API-Key` for service-to-service calls. The WhatsApp webhook (`POST /api/v1/webhook/whatsapp`) carries no guard at all — an HMAC-SHA256 signature over the **raw** request body *is* its authentication, so `main.ts` captures the raw body in `express.json`'s `verify` hook rather than re-reading the stream (which is already drained by the time a handler runs). Multi-tenancy is enforced at the entity level, with fine-grained RBAC via groups and permission guards. See `DATA_SCHEMA.md` for the full store map (105 TypeORM tables plus Weaviate, Redis, SQS, S3, LiveKit).

**Rate limiting and client addresses** — `@RateLimit` counts a route against exactly one of the throttlers `RateLimitModule` registers (`THROTTLER_NAMES`), at the route's own limit and window if it gives them, and skips the rest. It has to: `@nestjs/throttler` otherwise runs every registered throttler on every guarded route, and silently ignores an override filed under a name it doesn't know. IP keys work because `main.ts` sets Express `trust proxy` to one hop — the load balancer in front of every deployment — so `req.ip`, which the audit logs also record, is the caller's address and not the balancer's. It is a hop count on purpose: `true` would trust whatever a client writes into `X-Forwarded-For`. A `userId` key needs `@RateLimit` written *above* the route's auth guard, because guard decorators run bottom-up and the throttler needs `req.user`. The guard is switched off in local dev, so verify a limit with `src/rate-limit/test/rate-limited-routes.spec.ts`, not by hammering the local server.

**Roles** — there is no `role` column on `users`. A role *is* a row in `groups` whose `name` is a `UserRole` value, joined through `user_groups`; permissions are unioned across every role a user holds. The nine roles are `CLIENT`, `COUNSELOR`, `LEARNER`, `SIMULATION_REVIEWER`, `SCRIBE_REVIEWER`, `ADMIN`, `MULTI_TENANT_ADMIN`, `SUPER_ADMIN`, and `SUPER_DUPER_ADMIN`.

The last two are platform-level and are listed together in `SUPER_ADMIN_ROLES` (`src/common/constants/user.constants.ts`), which every name-based super-admin gate compares against — role guards, the tenant-skip on user creation, exclusion from tenant user lists. `SUPER_DUPER_ADMIN` is the elevated tier, adding the super-admin management surface and roadmap editing. Ally staff hold `SUPER_ADMIN` and reach the console on the standalone admin dashboard (see [ally-web](ally-web.md)).

A tenth role, `INTERNAL`, existed briefly as a permission-for-permission clone of `SUPER_ADMIN` for staff, paired with a copy of the console mounted at `/admin` on the consumer app. Both were withdrawn (migrations `1878000000000` then `1885000000000`); staff use `SUPER_ADMIN` on the standalone dashboard. The lessons it left are in [memory](../memory.md).

Two things routinely catch people out here:

- **Group grants do not inherit.** The `...SUPER_ADMIN_PERMISSIONS` spreads in `permissions.constants.ts` are TypeScript only; the `group_permissions` rows are static once written. A new permission granted to `SUPER_ADMIN` must be granted to `SUPER_DUPER_ADMIN` in the same migration.
- **`GET /users/me` reports one `role`, chosen by a priority list** (`SUPER_DUPER_ADMIN` > `SUPER_ADMIN` > `ADMIN` > `COUNSELOR` > first row). That is lossy for anyone holding a platform role next to a tenant one — `MULTI_TENANT_ADMIN`, for instance, is absent from the list, so a user who also holds `ADMIN` reports `ADMIN` and gets bounced by the admin console's role gate. Adding a role to the priority list is rarely the fix, since the same field feeds the consumer app. The response therefore also carries a `roles` array; **gate on `roles`, not `role`.**

Which roles may sign in on a given surface is decided by a client-supplied `allowedRoles` list on every auth call, intersected with the roles the account holds — see [Login `allowedRoles`](../platform/login-allowed-roles.md) for the contract, the outage that retiring a role caused, and the test case to run before removing one.

Role and permission lookups are cached in Redis (`user:roles:<id>`, `user:groups:<id>`, `group:permissions:<groupId>`) with a 30-minute TTL. A raw SQL migration cannot bust that cache, so migrations that change grants should be followed by a flush of those key patterns.

## Integration Points

- **ally-ai** — reached at `AI_SERVICE_API_URL`; outbound calls authenticate with `AI_SERVICE_OUTBOUND_API_KEY`. ally-ai owns the Weaviate vector DB (`Conversation`, `ReferenceDocument`, `KnowledgeChunk` collections). SQS and LiveKit bridge the two services. The WhatsApp bot adds three calls: `knowledge-chunks/bulk-upsert` (indexing), `knowledge-agent/answer` (grounded answering, explicit 25s timeout so a slow call cannot outlive the SQS visibility window and get the question answered twice), and `knowledge-agent/crisis-check` (run concurrently with the answer, 15s).
- **Meta WhatsApp Cloud API** — inbound webhook plus outbound sends. Bound behind a `WHATSAPP_PROVIDER` token so swapping to a BSP is one factory change; Meta's 24-hour customer-service window is why the DLQ handler records a failure but never replies.
- **ally-ai-learn** — reached at `AI_LEARN_SERVICE_API_URL` with `AI_LEARN_SERVICE_OUTBOUND_API_KEY`.
- **LiveKit** — via `livekit-server-sdk` using `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`; handles room creation, participant lifecycle, agent dispatch (`LIVEKIT_AGENT_NAME`), and webhook events.
- **AWS SQS queues** (from `.env.example`):
  - `sqs-ai-transcription-request-queue` (+ `-dlq`) — transcription requests.
  - `sqs-audio-file-retry-queue` (+ `-dlq`) — audio file retries.
  - `sqs-learn-message-and-event-queue` — learning messages and events from ally-ai-learn.
  - `whatsapp-inbound` (+ `-dlq`) — one message per inbound WhatsApp message. A standard queue, not FIFO: dedupe lives in Postgres (unique `provider_message_id`), and FIFO's 5-minute dedupe window is far shorter than Meta's retry window.
  - `kb-ingest` (+ `-dlq`) — corpus extraction, chunking and indexing.
- **ally-web / ally-mobile** — consume the versioned REST API plus the Socket.IO gateways above. CORS origins are configured via `ALLOWED_ORIGINS` (defaults include the landing page :3000, helpline dashboard :8080, admin dashboard :8081).
- **Redis message broker** — pub/sub for inter-service event delivery (`message-broker/`).
- **Metabase** — analytics dashboards via `METABASE_URL` / `METABASE_API_KEY`.
- **AWS SES** — transactional email.

## Local Setup

**Prerequisites:** Node.js v24, npm, Docker + Docker Compose (v2). Accounts/keys for LiveKit, OpenAI, and Deepgram; AWS is optional (LocalStack covers S3/SQS/SES/CloudWatch locally).

```bash
# 1. Configure environment
cp docker.env.example docker.env
cp .env.example .env
# edit both with your credentials

# 2. Start infrastructure (Postgres, Redis, LocalStack, SQS)
docker-compose up

# 3. Install dependencies
npm install

# 4. Run migrations
npm run migration:run

# 5. Seed the database (idempotent)
npm run seed

# 6. Start the app in dev mode
npm run start:dev
```

Once running:
- Swagger UI — `http://localhost:8001/api-docs`
- Health check — `http://localhost:8001/api/health`

Postgres is exposed on host port **5477** (mapped from container 5432). Production build/run: `npm run build` then `npm run start:prod`.

**Database & seeding notes**
- Migration scripts: `migration:generate`, `migration:create`, `migration:run`, `migration:revert`, `migration:show` (all wrap `typeorm` against `src/database/data-source.ts`). Permission-migration generator: `npm run migration:permissions`.
- Seeds live in `src/database/seeds/` (fixtures in `fixtures.ts`). Seeding inserts 1 tenant, 4 test users (SUPER_ADMIN, ADMIN, LEARNER+COUNSELOR, MULTI_TENANT_ADMIN), scenario voices, sample scenarios/pathway/case/badges, and scenario sessions. Seeded test users share a default local password and a fixed local OTP (see the repo's seed fixtures — local development only).
- `npm run seed:reset -- --confirm && npm run seed` truncates seeded tables and re-seeds; refuses to run without `--confirm` and refuses entirely under `NODE_ENV=production`.
- Set `AUTO_SEED=true` to seed automatically after migrations on container start.

## Testing & Code Quality

**Testing** — Jest for unit tests (`*.spec.ts` co-located with source) and e2e tests (`test/**/*.e2e-spec.ts`).

```bash
npm run test            # unit tests
npm run test:watch      # watch mode
npm run test:cov        # with coverage
npm run test:e2e        # end-to-end
npm run test:docker     # run tests inside Docker (test-docker.sh)
```

Docker-based tests use `compose.test.yaml` (spins up postgres-test on PG 14, redis-test, localstack-test, sqs-setup-test, and the test/coverage/e2e runners) under `NODE_ENV=test`, isolated on a `test-network` with tmpfs storage. See `TESTING.md` and `DOCKER_TESTING_SETUP.md`.

**Lint & format**

```bash
npm run lint       # ESLint
npm run lint:fix   # ESLint autofix
npm run format     # Prettier
```

Standards: ESLint + Prettier enforced, Husky git hooks (`prepare: husky`), `.pre-commit-config.yaml`, and `.gitleaks.toml` for secret scanning. Contribution conventions (branch naming `<type>/<desc>`, conventional commits, PR format) are in `CONTRIBUTING.md`.

## Key Documentation

- `README.md` — full service overview, architecture, directory map, setup, API endpoints, features, observability, troubleshooting.
- `CLAUDE.md` — repo guidance; points to the data-schema reference and describes the module layout.
- `DATA_SCHEMA.md` — cross-store data map: 105 PostgreSQL/TypeORM tables by domain, Weaviate collections, Redis/SQS/S3/LiveKit contents, and a "where do I find…?" index. Read before building features touching stored data.
- `CONTRIBUTING.md` — Git branch/commit/PR conventions and code-review process.
- `TESTING.md` — Docker-based testing guide (services, env, writing unit/e2e tests, CI example).
- `DOCKER_TESTING_SETUP.md` — Docker testing infrastructure setup details.
- `docs/README.md` — index of the `docs/` folder.
- `docs/prompts-folder.md` — `src/prompts/` prompt folder conventions: naming, structure, optional `.meta.json`, adding prompts. The product-side rules for what a prompt-backed feature must do — validated classification, provenance, human review before anything is stored — come from Stacks at planning time ([Planning with the Stacks MCP](../contributing/planning-with-stacks.md)); the deprecated [AI-Product Patterns](../product/ai-product-patterns.md) page records how Ally settled them.
- `docs/prompts-api.md` — Prompts API: dashboard exposure, sync endpoint, auth, runtime resolution.
- `docs/dynamic-i18n.md` — dynamic internationalization documentation.
- `src/prompts/README.md`, `src/prompt/README.md` — module-level prompt documentation.

---

*Part of the [Ally Platform](../platform/overview.md). See also: [Architecture](../platform/architecture.md), [Scribe Summary Writes](../platform/scribe-summary-writes.md), [ally-ai](ally-ai.md), [ally-ai-learn](ally-ai-learn.md).*
