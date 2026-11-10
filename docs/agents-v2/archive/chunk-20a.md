# Chunk 20a — Agent-first onboarding (quick-start)

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `BUILDING-BLOCKS.md`, `SLICE-1.md` (sections "The experience" and "How it's built"), `v2-chunks.md`, `CHUNK-12-NOTES.md`, `CHUNK-12B-NOTES.md`, the 3a/3c notes, **`ONBOARDING-COPY.md` (use its text exactly)**, then this file.
> Branch: the slice 1 branch (`feat/agents-v2-chunk-12-shared-store`); tag commits `[20a]`. Repos: all three.
> **Two loops:** 20a-1 (start → reading → learned → safety → gaps → designs → build → publish) and 20a-2 (checkup → try it → change by chat with undo → polish). Stop and report after 20a-1.

## The bar

This is the first thing every new customer sees. It should feel like the best onboarding they've used: as calm and clear as Notion, as fast and alive as Linear, and as useful as Clay. Concretely:

- **Time to a shared link: under 5 minutes** for a typical 10–40 page site, measured.
- **Always alive:** something visibly happens within 1 second of every action (streaming text, a ticking step, a filling card). No spinner sits alone for more than 2 seconds.
- **Never a dead end:** every error offers a next step (`ONBOARDING-COPY.md` §13), and progress is always saved and resumable.
- **Nothing invented:** every learned fact links to the page it came from. The assistant it builds passes its own checkup before publishing.
- **Copy is exactly `ONBOARDING-COPY.md`.** The owner-facing name is "assistant".

## Layout and interaction

- **Two panes** on desktop: the **builder chat** on the left (about 40%) and the **canvas** on the right (about 60%). On a phone, the canvas is a tab with a badge when it changes.
- **Canvas sections**, each appearing when its step starts:
  1. **Reading** (progress and live findings)
  2. **What we learned** (an editable, sourced card)
  3. **Safety** (the pack card)
  4. **Designs** (2–3 cards)
  5. **Building** (ticking steps)
  6. **Your assistant** (name, introduction, topics, suggested questions, pre-chat questions, "don't know" wording, safety)
  7. **Checkup** (20a-2)
  8. **Try it** (a phone-frame preview using the 12b page components, live, against the draft)
  9. **Share**
- **Builder chat:** streams like Preview (3c), with quick-reply **chips** for every question, a free-text box always available, and "Back" on any step. Owner edits on the canvas are also announced in the chat ("Updated your hours").
- **Motion:** subtle and purposeful (fades and height transitions under 200 ms); respects `prefers-reduced-motion`.
- **Design system:** the admin dashboard's existing components and tokens, nothing bespoke that fights it. Polish matters: spacing, alignment, empty states and focus states. Capture screenshots for the notes.
- **Entry points:**
  - `/new` (the new-assistant button on AI Chatbots goes here, with the old form kept under "Advanced setup")
  - **Resume** from a banner if a draft is in progress
  - **Change your assistant** panel on an existing bot (20a-2)

## Architecture

### ally-be: the session and the draft (owns all state; the builder only proposes)

- `bot_drafts`:
  - `id`, `owner_user_id`, `tenant_id`, `status` (`active`, `published`, `abandoned`)
  - `step`
  - `source` (`{website?, uploads?, description?}`)
  - `crawl` (status, counts, page list)
  - `learned` (structured facts with source URLs)
  - `industry`, `safety_pack`
  - `answers`
  - `design`
  - `draft_config` (a typed **BotDraft**)
  - `chatbot_id` (once created)
  - `events` (an append-only log of changes and patches for undo)
  - timestamps
- **`BotDraft` schema** (TypeScript and pydantic, kept in sync like the `/agent/run` contract):
  - name, assistant name, introduction or persona, tone, languages
  - topics
  - knowledge document ids, plus "Owner notes" text
  - suggested questions (≤4)
  - pre-chat questions (the 12b shape)
  - decline wording
  - safety pack id
  - page branding (12b shape)
  - access mode
- **`BotDraftService`:**
  - `applyPatch(draftId, jsonPatch, actor)` validates against the schema **and the safety pack** (a patch that removes or weakens a pack rule is refused with `safety_locked`), applies it, appends to `events`, and emits a canvas event.
  - `undo(eventId)` and `publish(draftId)`.
  - **Later chunks extend this service; don't fork it** (pages in 4, templates in 18–20).
- **`publish`** creates or updates the chatbot: status live, runtime v2, `features.agent` on, persona, instructions, decline text, the knowledge documents attached, the safety pack's rules (Never list and settings), and the **bot page** (12b) with branding, suggested and pre-chat questions and access. Then it returns the link and QR. It's idempotent.
- **Session API** (dashboard auth): create a draft; `POST /drafts/:id/messages/stream` (an SSE relay of the builder step, with canvas events interleaved); edit a canvas item (as a patch); upload documents (existing library upload); publish; undo; list a bot's change history.

### The crawl job (ally-be or ally-ai, wherever the network and the existing ingestion fit best; justify it)

- Same registrable domain only. Respects `robots.txt` (and says so via copy §13). At most **50 pages**, **2 minutes**, 4 at a time, a sitemap first if present, then links breadth-first, skipping obvious junk (login, cart, assets), honouring `canonical`.
- Extracts readable text (main content), the title and URL. **Each page becomes a knowledge document** through the existing library ingestion (tagged as the draft's), so the agent's `search_knowledge` works on the draft at once.
- **Brand:** logo (`og:image`, apple-touch-icon, header logo), accent colour (`theme-color`, the most common brand colour in CSS), and favicon. The accent colour is contrast-checked.
- Emits **progress events** (pages read, findings) to the canvas.
- Fetches nothing the owner didn't give. No PHI is logged. Respects a per-owner daily crawl cap.

### ally-ai: the builder agent

- **`POST /api/v1/builder/step`** (and `/stream`). It follows the same runtime and streaming patterns as `/agent/run`, with its own graph and its own seed prompt (`ally_ai_builder_system`, registered like the others).
- **Input:** the draft (`BotDraft`, `learned`, `answers`, `step`), the latest owner message or chip, summaries of the crawled pages (titles, headings and key snippets, capped), and the safety pack catalogue.
- **Output** (structured, as in 3a's step pattern):
  - `message` (streamed text to the owner, in the copy deck's voice)
  - `chips` (≤5)
  - `patches` (JSON Patch ops against `BotDraft` or `learned`)
  - `next_step`
  - `questions_left`
- **Sub-tasks**, each a structured call with a clear schema:
  - **extract learned facts** (each **must** carry its source URL, or be dropped)
  - **classify industry and pick the safety pack** (mental health, medical, pharmacy, minors, legal and financial, standard)
  - **find gaps** (a fixed checklist per industry, plus the site's own content)
  - **propose 2–3 designs**, from those that work today (FAQ or guide, enquiries with pre-chat lead capture, support); booking and orders are always "coming soon"
  - **draft the assistant**: introduction, tone, topics, suggested questions, pre-chat questions and decline wording, all grounded in `learned`
- **The builder never writes.** It returns patches, and ally-be validates and applies them. It is never given tools that change data.
- Tracing stays disabled, as in 3a. No PHI in logs.

### Safety packs (code plus pages, versioned)

- Definitions for mental health, medical, pharmacy, minors, legal and financial, and standard. Each contains:
  - the Never-list entries
  - required settings (the crisis classifier on, crisis keywords, a disclaimer)
  - the persona lines that must be present
  - the checkup probes (used in 20a-2)
  - the owner-facing wording (copy §14)
- A pack can be **added to but never weakened**. The validator enforces it for patches, for the dashboard settings of a bot created from a pack, and for publish.
- Health packs set the disclaimer on the bot page, and keep **public access unavailable while `botPagePublicAllowed` is off** (12b).

### 20a-2 additions

- **Checkup:**
  - Generate 10–15 questions from `learned` (a mix of facts, policies and follow-ups), plus 3 out of scope, plus the pack's safety probes.
  - Run them through `/agent/run` against the draft bot. Grade them with 3a's automatic checks (cited, declined, crisis-only) plus a light AI grader for "answers the question".
  - Show the rows. Gaps turn into builder prompts, and the owner's answers go into an **Owner notes** knowledge document (sourced as "From you, {date}").
  - **Publishing needs 0 unsourced answers and every safety probe passed.**
  - A cost cap per draft.
  - Store the questions as the bot's first **Checkups** (the Q1 data model can come later; keep them in `bot_drafts` with a clear handoff note).
- **Try it:** the 12b page components in a phone frame, talking to the draft bot.
- **Change by chat** on existing bots: the same builder in edit mode. It proposes a before and after, applies it on Confirm, and records a history entry with Undo. Refuses safety-weakening changes with copy §12.

## Fixtures and the builder eval

- `fixtures/onboarding-sites/<case>/`: 10 small static sites (5–15 pages each), matching `SLICE-1.md`'s use-case table:
  - mental health practice, GP clinic, diagnostic lab, pharmacy
  - wellness studio, D2C brand, coaching institute, real estate, SaaS help centre, restaurant
  - each with realistic content, **deliberate gaps** (2–3 per site) and a logo and theme colour
  - fictional names, `.example` domains, and the same disclaimer line as the Sunrise Mind PDF
- A local static server for them.
- `scripts/onboarding_eval.py` <!-- docs-path-lint: planned --> (or the repo's equivalent) drives each fixture end to end through the session API with scripted answers (chips), and records:
  - time to publish
  - learned facts with valid sources (the share that had to be dropped is reported)
  - the industry and pack picked (must match the expected value)
  - gaps found (must include the deliberate ones)
  - the design offered (no booking or order design as active)
  - checkup pass rate (20a-2)
  - that the published link answers 3 questions with sources
- **Hard fails:**
  - a learned fact without a source
  - the wrong safety pack for a health fixture
  - a weakened pack
  - a booking or order design offered as working
  - publishing with an unsourced checkup answer
  - over 5 minutes on a typical fixture (soft fail at 4, hard at 6)

## Out of scope

Templates (18–20), Collections (booking and orders become real in chunk 6), WhatsApp connection inside onboarding (keep the "Connect WhatsApp" card linking to the existing flow), Checkups as a full feature (Q1), and the scorecard (Q2).

## Tests

- **ally-be:**
  - `BotDraftService` (patch validation, safety lock, undo, idempotent publish)
  - the crawl job (domain lock, robots, caps, junk skipping, extraction, brand detection), against the fixture server
  - the session API and SSE relay
  - publish creates exactly the right bot, page, documents and rules
  - no PHI in logs
- **ally-ai:**
  - builder step schema
  - facts without a source are dropped
  - industry classification on fixture summaries
  - patches only touch allowed paths
  - tracing disabled
- **ally-web:**
  - the two-pane flow (chips, free text, Back, resume)
  - canvas sections appear and update
  - edits become patches
  - error states (copy §13)
  - publish shows the link and QR
  - phone layout tabs
  - accessibility (focus, labels, live regions)
- **The builder eval** on all 10 fixtures: 0 hard fails, with timings recorded in the notes.
- Full suites, lint, typecheck and build in all three apps. No `--no-verify`.

## Done when

- [ ] **20a-1:** from `/new`, every fixture site reaches a published, shared link with the right safety pack, sourced learned facts and honest designs, in under 5 minutes; resume works; the copy matches the deck
- [ ] **20a-2:** the checkup runs and gates publishing; gaps are filled in chat and land in Owner notes; try-it works; change by chat with before and after, Confirm and Undo works on an existing bot, and refuses to weaken safety
- [ ] Screenshots and a short screen recording of a full run in the notes
- [ ] `CHUNK-20A-NOTES.md`: code map, the crawl location decision, the `BotDraft` schema, the pack definitions, eval results per fixture, copy additions, open items

## How Shehbaz tests it

1. Suites; start the fixture server; rebuild ally-ai; publish the builder prompt locally (as with 3a).
2. Dashboard → AI Chatbots → **New assistant**. Paste the mental health fixture's URL. Watch it read, check "What we learned" (open a source link), read the safety message, answer the gap questions with chips, pick a design, watch it build, then publish with invite-only access. Time it.
3. Open the link on your phone (12b) and ask three questions from the site.
4. Repeat with the D2C and SaaS fixtures. Then try a site that can't be reached, and "Describe it instead".
5. **20a-2:** watch the checkup, close one gap in chat, try it in the preview, then on the published assistant say "make it more formal" → Apply → Undo; then "turn off the crisis rules" and see it refuse.
6. Read the builder eval summary in the notes.
