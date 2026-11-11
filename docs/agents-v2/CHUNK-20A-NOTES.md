# Chunk 20a notes: agent-first onboarding

**Brief:** [chunk-20a.md](./archive/chunk-20a.md). **Copy:** [ONBOARDING-COPY.md](./ONBOARDING-COPY.md), used exactly. **Branch:** `feat/agents-v2-chunk-12-shared-store`. All of slice 1 is on this branch, and every 20a commit is tagged `[20a]`.
- Master was merged first: no new commits, so no conflicts.
- **Repos:** all three.
- **Two loops.**
  - **20a-1** (built; sections 2–10 below): start → reading → learned → safety → gaps → designs → building → publish.
  - **20a-2:** checkup, try it, and change by chat with undo.

Plan approved 2026-11-07 at `~/.claude/plans/pasted-content-id-f834-we-re-continuing-sharded-raven.md`.

## 1. Code map: what exists today (read before building)

All paths are relative to each app.

### The knowledge library: where a crawled page would enter

- **Creating a document:**
  - `KnowledgeBaseService.create` (`ally-be/src/knowledge-base/service/knowledge-base.service.ts:337`) is the library route.
  - **`createForChatbot(chatbotId, dto)` (`:1206`)** is the bot's own document: corpus `whatsapp_qa`, `isGlobal:false`, `ownerChatbotId`. It accepts PASTE and URL sources, and files under `knowledge-base/chatbots/<id>/`.
  - `ChatbotService.addOwnDocument` (`chatbot/service/chatbot.service.ts:542`) wraps it and inserts the `chatbot_documents` row that attaches the document to the bot.
- **The pipeline:** `insertAndQueue` (`:366`) saves the `kb_documents` row as PENDING (PASTE keeps `rawText`), then enqueues `{documentId, action:'ingest'}` on SQS `SQS_KB_INGEST_QUEUE_URL` (`producer/kb-ingest.producer.ts`).
  - `KbIngestService.run` (`service/kb-ingest.service.ts:57`) extracts (`extractor/index.ts`) and chunks (`util/chunker.ts`; `whatsapp_qa` is 400 tokens with 60 overlap).
  - It then calls ally-ai `POST /api/v1/knowledge-chunks/bulk-upsert` in batches of 64, and ally-ai embeds and writes to Weaviate.
  - The status moves `PENDING → EXTRACTING → CHUNKING → INDEXING → INDEXED | FAILED`. Failures are recorded on the row, not redelivered.
- **Search:** the agent's `search_knowledge` (`ally-ai/app/core/agent_runtime/tools/search_knowledge.py:42`) pre-filters by the bot's document ids, which ally-be sends from `chatbot_documents`. **A crawled page is searchable as soon as its chunks are upserted.**
- **Limits** (`knowledge-base/constants/knowledge-base.constants.ts`): paste ≤ 200,000 characters; file ≤ 50 MB (25 MB in the dashboard); URL fetch 20 s / 10 MB; extracted text ≤ 1.5 M characters; ≤ 3000 chunks. Upload types: PDF, DOCX, EPUB.

### Outbound web fetching and network limits

- **ally-ai fetches no web pages.**
  - Its only HTTP calls are to ally-be, Sarvam, and one audio download.
  - `pyproject.toml` has no HTML libraries: no bs4, lxml, trafilatura or readability.
  - There's no private-address guard.
- **ally-be has the platform's only page fetcher:** `knowledge-base/extractor/url.extractor.ts`.
  - axios, http(s) only, 20 s, 10 MB, 5 redirects, 2xx and HTML/XML/text only.
  - **It has no private-IP or DNS check.** `createOwned` refuses URL sources for organisation owners for exactly that reason ("does not block internal addresses").
- **HTML to text:** `knowledge-base/extractor/html.util.ts` (sanitize-html, headings kept as sections; jsdom and Readability were deliberately avoided). `fast-xml-parser` is a dependency, used for EPUB.
- **The one real SSRF guard:** `track/service/track-resource-embed.service.ts:22-73`.
  - A `net.BlockList` of 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, ::, ::1, fc00::/7 and fe80::/10.
  - `isBlockedAddress()` is exported.
  - `guardedLookup` is passed as axios's `lookup`, so the address actually connected to is the one checked.
  - Redirects are followed by hand and re-checked at every hop (`:161-200`).
- **Missing:** no robots.txt parser, no sitemap reader and no crawler anywhere. No egress proxy is configured (the Docker networks are plain bridges).

### How the bot is created and configured today

- **Creating:** `ChatbotService.create` (`chatbot/service/chatbot.service.ts:346`) calls **`assertPlatformAdmin()` first**.
  - It saves a DRAFT with `knowledgeSource: SELECTED`, `persona {displayName: name, …dto.persona}` and `settings {}`.
  - It adds the creator as an OWNER member.
  - `CreateChatbotDto` (`chatbot/dto/chatbot.dto.ts:90`): name, description, persona, answerMode, accessMode.
  - `GET v1/chatbots` returns `canCreate: isPlatformAdmin`.
- **Configuring:**
  - `update` (:379, EDITOR) and `setStatus` (:410, EDITOR, a plain update to LIVE).
  - Settings go through `ChatbotSettingsService.updateChatbotSettings`. `ChatbotSettingsOverride` is a whitelist of `WhatsAppBotSettings` keys: wording, `crisisClassifierEnabled`, `consentRequired`, limits and retrieval.
  - Persona: `{displayName, systemPrompt (≤4000), tone, greeting, defaultLanguage}`.
- **Gone or missing:**
  - **There's no `runtime` or `features` column.** Since #223, every bot answers with v2 while the platform's `agentRuntimeAllowed` is on.
  - **There's no Never-list or rules concept**, per bot or anywhere.
  - Per-bot `wa_keyword_templates` exist for FAQ and command replies. Global crisis replies are mandatory.
- **Topics:** the titles of the bot's documents, at most 50 (`AgentRuntimeRunner.knowledgeTopics`, `chatbot/engine/agent-runtime-runner.service.ts:167`). **Crawled page titles become the bot's "what I cover" list.**
- **Bots carry no organisation** (`BaseWithoutTenantEntity`). Access is by membership (`ChatbotAccessService.assert`; platform admins count as OWNER).

### The 12b bot page: settings and publish path

- **`BotPageService.save(chatbot, UpdateBotPageDto)`** (`chatbot/bot-page/bot-page.service.ts:108`):
  - checks the slug, refuses PUBLIC unless `botPagePublicAllowed`, checks the pre-chat questions and slug uniqueness (409);
  - upserts `chatbot_pages`;
  - does **no** access check, so the caller asserts EDITOR.
- **`BotPageAccessService.add(pageId, entries)`** (`bot-page-access.service.ts:66`): emails and organisations in `chatbot_page_access`, never `chatbot_audience`.
- **Wiring:**
  - `BotPageModule` imports `ChatbotModule` and exports only `BotPageService`, so it must also export `BotPageAccessService`.
  - A publish service has to live in a module that imports both; inside `ChatbotModule` it would be circular.
  - `ChatbotService` isn't exported from `ChatbotModule`.
- **The dashboard:** Settings → Bot page (`ally-web/apps/ally-admin-dashboard/src/pages/WhatsAppBot/BotPageTab.tsx`) has the phone frame (`:489`), the link and the `QrCode` component (not exported). <!-- docs-path-lint: ignore -->

### 3a's structured step, and registering a prompt

- **The model call:** `generate_structured(*, schema, prompt, task, provider, model, temperature, reasoning_effort, timeout, …)` (`ally-ai/app/core/llm/dispatch.py:791`) returns `(parsed, {provider, model, fell_back_from})`.
  - It shares the provider fallback (one retry on the fallback provider within the same deadline), usage emission when `task` is passed, and the temperature rule.
- **Schema rules** (`app/core/agent_runtime/schemas.py`): flat shapes, defaults instead of `Optional`, an `Enum` rather than a one-value `Literal`.
- **Registering a prompt (3a's `ally_ai_agent_system`, commit `d2691c823`):**
  1. a seed `app/prompts/<folder>/<name>.txt`, giving the code `ally_ai_<folder>_<name>`;
  2. a `PromptInputs` subclass in `app/prompts/contracts.py` (its fields are the variables; a field with no default is required);
  3. `make sync-prompts` (`scripts/sync_prompts.py` → ally-be `POST /api/v1/prompts/sync`), which creates an unknown code live at version 1;
  4. ally-be sends `prompts` in each request (`AiService.getPromptOverrides(codes)`), and ally-ai's resolver uses the store's text before the `.txt`;
  5. one `LLMTask` in ally-ai `app/core/llm_usage/tasks.py`, **and** the matching `LlmTask` in ally-be `src/learn/enum/llm-task.enum.ts`;
  6. one row in `src/llm/constants/ai-task-registry.constants.ts` with `promptOverride`, enforced by the jest guard `llm/service/test/ai-task.service.spec.ts`.
- **Tests:** `tests/core/agent_runtime/steps.py` `FakeLLM` stands in for `generate_structured`.

### 3c's streaming relay and hook

- **ally-ai:** `app/core/agent_runtime/runner.py`.
  - `execute()`: a timeout, then tokens cut from the checked reply after the run.
  - `stream()`: SSE `event:/data:` frames, a `: ping` every 10 s, `final` or `error {code}`, and the run cancelled when the client goes.
  - `trace.emit/status` write through LangGraph's stream writer, and are no-ops outside a graph.
- **ally-be:**
  - `AiService.runAgentStreaming` (`ai/service/ai.service.ts:742`): axios stream, a deadline, `SseParser`.
  - The browser relay `ChatbotController.testStream` (`chatbot/controller/chatbot.controller.ts:314`): headers with the first event, a ping, abort on close.
  - 12b's public relay (`chatbot/bot-page/bot-page-public.controller.ts`) filters events for visitors.
- **ally-web:**
  - `hooks/chatStream/sse.ts` (`parseSse`, `readSse`; any event name; no dashboard imports).
  - `hooks/useChatbotTestStream.ts` (`fetchWithReauth`: admin bearer plus one refresh).
  - Preview's reveal and typing dots (`pages/WhatsAppBot/ChatbotTestTab.tsx`, not exported). <!-- docs-path-lint: ignore -->

### Dashboard components for the two-pane layout

- **Layout:** `pages/CourseCopilot/CourseCopilotSession.tsx`.
  - A chat `section` plus an `aside` at `lg` (≥ 1024 px, `useIsLargeScreen`), and a `SidePanel` sheet below it.
  - The work pane is mounted once.
- **Chat:** `components/agent-chat/`.
  - `ChatMessage` renders `suggestedActions` as chips (`onSendSuggestion`).
  - `ChatComposer` (Enter sends, Stop while streaming).
  - `QuestionCard` (structured choices that lock once answered).
- **Building blocks:**
  - `Card`, `StatusPill`, `copyToClipboard`, `errorMessage` and `fill` (`pages/WhatsAppBot/shared.tsx`).
  - `Tabs` with a `count` (`libs/ui-shared/src/lib/tabs`), `ProgressBar`, `SkeletonText`, `InlineNotification`, `TextInput`, `TextArea`, `RadioButton`, `Tag`.
  - `EmptyState`, `Button` and `ButtonVariant` (`@components`), `sonner` toasts.
- **Motion:** framer-motion with `useReducedMotion` (`pages/ProductRoadmap/VoteButton.tsx`), `pages/Builder/builderMotion.ts`, and the `builderFadeIn` keyframe (`styles.css:178`, switched off under reduced motion).
- **Phones:**
  - The sidebar force-collapses on chosen routes (`components/sidebar/Sidebar.tsx:173`).
  - **No "canvas as a tab with a badge" pattern exists**, so 20a builds one.
  - In tests, `test-setup.ts` mocks `matchMedia` to never match, so the narrow layout renders by default.
- **Screenshots:** there's no visual-test tooling, so they're captured with the browser tools.

### robots.txt and HTML-to-text helpers

- **robots.txt:** none anywhere.
- **HTML to text:** `html.util.ts` (above).
- **Parsing:** `htmlparser2` is installed as a dependency of sanitize-html, but isn't declared directly. Link extraction and metadata (canonical, `theme-color`, `og:image`) need it, or a parser like it.

### Differences from the brief (the code wins)

1. **The crawl runs in ally-be,** not ally-ai.
   - ally-be already has the only page fetcher, the HTML-to-text helper, the SSRF guard pattern and the ingestion every page must go through.
   - ally-ai has no HTML libraries, no guard, and no way to create library documents.
   - **Decision (Shehbaz):** in-process and resumable (a Redis lock, progress in `bot_drafts`, a scheduler sweep), with no new queue.
2. **"Runtime v2, `features.agent` on" no longer exists per bot** (#223), so publish sets neither. Every bot answers with v2 while the platform switch is on.
3. **There's no Never-list concept.**
   - **Decision (Shehbaz):** a pack id on the bot. The new columns are `chatbots.safety_pack`, `safety_pack_version` and `rules`.
   - The engine adds the pack's lines to every run, and settings get a pack floor, so weakening gives `safety_locked`.
4. **Only platform admins can create a bot today.** **Decision (Shehbaz):** anyone with the AI Chatbots feature and its edit permission can onboard, and becomes the new assistant's OWNER. The old form stays platform-admin only, under "Advanced setup".
5. **A document needs a bot.** Uploads and crawled pages attach to a bot, so a draft creates its DRAFT chatbot as soon as it has a source.
6. **`ally-be/src/builder` is the unrelated code-builder.**
   - The new module is `src/bot-draft`, and the ally-be `LlmTask` values are `ONBOARDING_*`.
   - The ally-ai routes keep the brief's `/builder/*`.
7. **The route is `/chatbots/new`, not `/new`.** It sits beside `/chatbots/:botId`, as `/course-copilot/new` does; the admin app has no bare top-level `/new`.
8. **One prompt per model call.** The brief names one prompt, `ally_ai_builder_system`, but the repo needs one prompt and one registry row per model call. The builder's structured sub-tasks therefore get their own codes: `ally_ai_builder_{system,extract,classify,gaps,designs,draft}`.
9. **Copy §14 has no wording for pharmacy, or legal and financial.** It's written in the deck's voice and added to `ONBOARDING-COPY.md` in the same commit.
10. **The brief's eval script** is `ally-ai/scripts/onboarding_eval.py`, next to the conversation eval.

## 2. What was built (20a-1)

**One onboarding, three apps.** ally-be owns the draft and every write; ally-ai's builder only proposes; the admin dashboard draws it.

### ally-be (`src/bot-draft/`)

| Piece | File | Does |
|---|---|---|
| Draft store | `service/bot-draft.service.ts`, `entity/bot-draft.entity.ts` | One `bot_drafts` row per setup. JSON Patch edits checked in order: allowed paths per actor, the `BotDraft` schema, the safety lock, the version. Undo by stored inverse; Back; the step machine (`service/step-machine.ts`). |
| Session | `service/bot-draft-session.service.ts` | One builder turn: the step request (the whole draft; ally-ai keeps nothing), the relay, then the proposal applied to the draft *as it is now*. Patches it refuses are dropped and counted, never fatal. The owner's message is saved with the reply, so a stopped turn changes nothing. Also the crawl's learner, document and description reading, the crawl-finished message, and naming the draft from its source. |
| Crawl | `crawl/*` | In-process and resumable: robots, sitemap, same site, 50 pages, 2 minutes, 4 at a time, blog and news pages last and at most 10, junk skipped, canonical. Every fetch through the shared SSRF guard (`common/net/guarded-fetch.ts`). Each page becomes a PASTE library document with its URL. |
| Publish | `service/bot-draft-publish.service.ts` | Idempotent: chatbot persona, safety pack and rules, LIVE; settings with the pack's floor; the Owner notes document; the page through 12b's `BotPageService` and its list through `BotPageAccessService`. Public refused before anything is written. |
| Safety packs | `safety-pack/*` | Six versioned packs. The pack is chosen in code: the strongest of the business type's and its care topics' (`packForBusiness`). The lock refuses a weaker pack or a removed disclaimer. |
| API | `controller/bot-draft.controller.ts` | `v1/bot-drafts`: create, current, get, events (SSE), messages/stream (SSE), PATCH, undo, back, documents, publish, abandon; `v1/chatbots/:id/changes`. AI Chatbots feature and `EDIT_WHATSAPP_BOT`. |
| Copy | `copy/onboarding-copy.ts` | The lines ally-be writes itself (crawl outcome, finding lines, edit notes), held to the deck by a spec. |

Elsewhere in ally-be: the engine sends the pack as `persona.safety_rules` and `persona.safety_pack` on every run (`chatbot/engine/knowledge-request.ts`); settings keep the pack's floor and refuse turning it off (`chatbot-settings.service.ts`); the chatbots list carries `setupDraftId` for Continue setup.

### ally-ai (`app/core/builder/`, `app/api/v1/endpoints/builder.py`)

- `/builder/step`, `/builder/step/stream`, `/builder/extract`; on by default, `BUILDER__ENABLED=false` turns them off (404).
- Six structured sub-tasks, each with its own prompt (`app/prompts/builder/*.txt`) and task label: the conversation step, fact extraction, classify (business type and care topics), gaps, designs, draft.
- Code decides what the deck fixes: question order and quick replies, gap checklists per business type, what each design will and won't do, the coming-soon card, and every fixed message. The model writes only what the deck leaves open, and proposes values that code turns into patches on the builder's own paths.
- Checks in code: facts must cite a page in their batch; sentences stating a number we were never given are dropped; the assistant never claims to book; unknown labels fall back rather than fail a batch.
- The agent check (`agent_runtime/check/safety.py` since CL1) enforces a health pack in code: no diagnosis, result reading, dosing or medication changes, whatever the instructions say.

### Admin dashboard (`apps/ally-admin-dashboard/src/pages/Onboarding/`)

`/chatbots/new` (start) and `/chatbots/new/:draftId` (the session); "New assistant" and, for platform admins, "Advanced setup" on AI Chatbots; "Continue setup" on a Draft bot with the caller's unfinished setup.

## 3. Where logic ends and presentation begins (for the design pass)

The screens are about to be restyled (one screen at a time, Typeform-style, with motion). Everything the screens *do* is in hooks; the components only draw and call them. A restyle replaces the components and keeps the hooks.

| Layer | Files | Keep or replace |
|---|---|---|
| **Logic: hooks** | `useOnboardingStart.ts` (start with a website, a description or files; resume) · `useOnboardingSession.ts` (the chat as rows, which canvas sections a step shows and which it brings into view, every action: say, chip, confirm, choose a design, stop, back, edit, publish) · `useBotDraftSession.ts` (the draft, its live events, streamed turns, reconnects) | **Keep.** Tested without a screen (`__tests__/useOnboardingSession.test.tsx`). |
| **Pure helpers** | `steps.ts` (`reached`) · `findings.ts` · `types.ts` · `copy.ts` (every string, held to the deck by `copy.test.ts`) | **Keep.** |
| **API** | `api/botDrafts.ts`, `hooks/chatStream/fetchWithReauth.ts`, `hooks/chatStream/sse.ts` | **Keep.** |
| **Presentation** | `OnboardingStart.tsx`, `OnboardingSession.tsx`, `Canvas.tsx` (cards for each section) | **Replace freely.** Only local view state lives here (which tab is open, an inline edit's text, scroll and focus). |

Rules for the restyle: take strings from `copy.ts` (add any new ones to the deck first), call the hooks' actions rather than the API, and draw `sections` in the order the hook gives them. The server already sends the deck's wording for builder messages, quick replies and finding lines.

## 4. Decisions beyond the plan

- **Uploads are read for "What we learned"** (Shehbaz, 2026-11-08): a PDF a page at a time, other formats in parts; each fact sourced to "file.pdf, page N". Uploads use the chatbot's existing document routes, then `POST v1/bot-drafts/:id/documents`.
- **The pack is chosen by topic as well as type** (Shehbaz, 2026-11-08). Non-profit is a business type with its own checklist; a mental health non-profit gets Mental health safety from its care topic.
- **Blog and news pages are read last, at most 10** (Shehbaz, 2026-11-08).
- **Stop leaves the draft unchanged** (Shehbaz, 2026-11-08): the owner's message is saved with the reply.
- **The pack's rules travel in their own persona field** (`safety_rules`), not prepended to the instructions: ally-ai caps the instructions at 4,000 characters, the same as the editor.
- **Facts cite pages by number**, not URL: a made-up number is easy to catch, a made-up URL is not.
- **The builder can't express a change to protected fields**: it proposes values for a fixed set of fields, and code builds the patches.
- **Drafts are named from their source** (the site's or document's own name), once, never over the owner's name.
- **The 20a-1 build-finished line is copy §11's**, not a new one (the checkup comes in 20a-2).
- **An http logo is not put on the page**: the page's branding takes https logos only.
- **Copy added to the deck** (marked "added in 20a-1"): pharmacy and legal pack wording, the description message, and §15 screen labels.

## 5. Security and privacy

- Every outbound fetch goes through the shared SSRF guard: private ranges refused, every redirect re-checked. Fixture hosts are allowed only in local, development and test (`BOT_DRAFT_CRAWL_ALLOW_HOSTS`).
- robots.txt is honoured with our own user agent (`AllyAssistantSetup`); a site that disallows us stops with copy §13's message.
- 20 crawls per owner per day by default (`BOT_DRAFT_CRAWLS_PER_DAY`). Only crawls that start count; a refused attempt doesn't.
- The builder never writes: it has no tools, and ally-be checks every proposal.
- Logs carry draft ids, steps, domains and counts only: no page text, no owner messages, no email addresses. Requests to `/builder/extract` are logged by size only.
- A health pack's safety is enforced in code twice: the settings floor (classifier on, `safety_locked` to turn it off) and the agent check (no diagnosis or dosing).

## 6. Tests

| App | Suite | Result |
|---|---|---|
| ally-be | `src/bot-draft` (patches, lock, step machine, crawl against a real local server, session, publish, copy) | 129 pass |
| ally-be | Postgres spec (`bot-draft.pg.spec.ts`): save keeps the crawl and documents; publish twice converges | 4 pass on a scratch DB, skipped in CI |
| ally-be | Engine request, settings floor, chatbots list | pass, existing specs unchanged |
| ally-ai | `tests/core/builder` (flow, extract, copy, contract, endpoint) and `tests/core/agent_runtime/test_safety_pack.py` | pass; full suite 2,0xx pass |
| admin dashboard | Onboarding (copy, canvas, session hook) | 128 pass; full admin suite 551 files pass on Node 22 |

The commit hook runs the helpline suite on Node 24, where about 20 files fail with `FETCH_ERROR` regardless of this change; on Node 22 it passes in full.

## 7. The eval

Full report: [CHUNK-20A-EVAL.md](./CHUNK-20A-EVAL.md). Fixtures: `fixtures/onboarding-sites/` (10 fictional businesses, a blocked site and an unreachable port, served by `serve.py`); case 11 is Live Love Laugh's live public site. Script: `ally-ai/scripts/onboarding_eval.py`.

**The bar:** every case passes; the right business type and pack; 0 unsourced facts; under 5 minutes to publish. **Final run: 13 of 13.**

| Case | Pages | Facts | Business type | Pack | Deliberate gaps asked | To publish |
|---|---|---|---|---|---|---|
| Mental health clinic | 5 | 19 | mental_health | Mental health safety | 2 of 2 | 72 s |
| GP clinic | 4 | 15 | gp_clinic | Medical safety | 2 of 2 | 62 s |
| Diagnostic lab | 4 | 18 | diagnostic_lab | Medical safety | 2 of 2 | 69 s |
| Pharmacy | 3 | 11 | pharmacy | Medical safety (pharmacy rules) | 2 of 2 | 68 s |
| Yoga studio | 4 | 14 | wellness | Facts only | 2 of 2 | 59 s |
| Tea brand | 4 | 14 | d2c | Facts only | 2 of 2 | 56 s |
| Coaching institute | 4 | 11 | coaching | Care for young people | 2 of 2 | 62 s |
| Real estate | 3 | 11 | real_estate | Facts only | 2 of 2 | 61 s |
| SaaS help centre | 3 | 8 | saas | Facts only | 2 of 2 | 54 s |
| Restaurant | 3 | 11 | restaurant | Facts only | 2 of 2 | 64 s |
| Blocked site | 0 | – | stopped: blocked | – | – | – |
| Unreachable | 0 | – | stopped: unreachable | – | – | – |
| Live Love Laugh (live) | 50 | 197 | non_profit | Mental health safety (from its cause) | – | 80 s |

0 unsourced facts in every case. It took three runs; the first two found real problems, all fixed:
- **A short home page stopped the crawl** (four sites read 0 pages and came out as "other"). The crawl now follows its links.
- **Thin pages were skipped** (a contact page of an address and a phone number). Pages down to 60 characters are kept.
- **Over-eager care topics** raised two packs (a yoga studio to Mental health safety, an invoicing tool to Legal and financial care). Classify now lists a topic only with evidence.
- **A site gap repeating a checklist gap** ("your fees for sessions" after "your fees") is no longer asked.

## 8. How Shehbaz tests it

1. Local stack up. In `ally-ai/.env`: `BUILDER__ENABLED=true`. In `ally-be/.env`: `BOT_DRAFT_CRAWL_ALLOW_HOSTS=host.docker.internal` and `BOT_DRAFT_CRAWLS_PER_DAY=100` (then `docker compose up -d --force-recreate --no-deps app` in ally-be).
2. `python3 fixtures/onboarding-sites/serve.py` for the fixture sites.
3. AI Chatbots → **New assistant** → paste `http://host.docker.internal:8701` (Sunrise Mind Clinic), or a real site.
4. Watch reading, check What we learned (View source, Edit, Remove), Looks right, read the safety message, answer the questions, choose a design, watch it build, edit on the canvas, publish invite-only.
5. Try **Stop** while the builder is writing: the chat and the draft are as before.
6. Leave mid-way, then AI Chatbots → the Draft card's **Continue setup**, or `/chatbots/new`'s welcome-back banner.
7. Upload instead: `/chatbots/new` → Upload documents instead → a PDF; each detail shows "file.pdf, page N".
8. Eval: `ALLY_TOKEN=… poetry run python scripts/onboarding_eval.py` from `ally-ai`.

## 9. Open items

- **20a-2:** the checkup, try it, change by chat with undo (the `changes` endpoint and inverse patches are ready).
- **Poetry:** `[infra]` commit `e0a0f15f2` stands alone, for a PR from master.
- **Wrong declines (from the eval):** 5 of 33 Preview answers on freshly published fixture assistants declined facts their pages state, although the search found the passages (see CHUNK-20A-EVAL.md). Answer quality in the 3a agent, not onboarding; the 20a-2 checkup measures it. Look at it before G1b.
- **Ingest:** a library document re-delivered from the queue while ally-be restarted failed on the chunks' unique index (`uq_kb_document_chunks_doc_version_index`); seen once locally, worth a look (an idempotent re-chunk).
- **Edge:** a turn cut off by a server restart after the AI replied but before it was applied leaves nothing (correct), but the dashboard shows the generic error rather than retrying.
- **Uploads:** text from scanned PDFs (no text layer) isn't read; there's no OCR.
- **Industry label on the safety card** comes from the pack ("mental health practices"), which reads oddly for a non-profit; the deck may want a label per business type.
- **Stacks** was unreachable from this session (MCP not connected), so no chunks were retrieved; product choices follow the brief, the deck and Shehbaz's answers.

## 10. Commits (20a-1), in review order

`ac5bca7ba` docs · `9fd57fb35` code map · `1008ca946` drafts, schema, packs · `4fc04060e` crawl · `ee90226c9` builder agent · `84a83b6f8` session API, publish, packs in engine and settings · `130b4821d` uploads read, safety in the check, live-run fixes · `888fff708` the screen · `3926b1289` click-through fixes · `e0a0f15f2` Poetry `[infra]` · `419080fde` non-profits, Stop, Continue setup, blog pages last, hooks boundary · `b373b4f2f` stages `[docs]` · then the fixtures, eval, eval fixes and these notes.
