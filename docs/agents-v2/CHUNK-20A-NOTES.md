# Chunk 20a notes: agent-first onboarding

**Brief:** [chunk-20a.md](./chunk-20a.md). **Copy:** [ONBOARDING-COPY.md](./ONBOARDING-COPY.md), used exactly. **Branch:** `feat/agents-v2-chunk-12-shared-store`. All of slice 1 is on this branch, and every 20a commit is tagged `[20a]`.
- Master was merged first: no new commits, so no conflicts.
- **Repos:** all three.
- **Two loops.**
  - **20a-1** (this file, so far): start → reading → learned → safety → gaps → designs → building → publish.
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
- **The dashboard:** Settings → Bot page (`ally-web/apps/ally-admin-dashboard/src/pages/WhatsAppBot/BotPageTab.tsx`) has the phone frame (`:489`), the link and the `QrCode` component (not exported).

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
  - Preview's reveal and typing dots (`pages/WhatsAppBot/ChatbotTestTab.tsx`, not exported).

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
10. **The brief's eval path** `scripts/onboarding_eval.py` is `ally-ai/scripts/onboarding_eval.py`, next to the conversation eval.
