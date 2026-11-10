# Chunk 20a-2 notes: checkup, try it, change by chat, purposes

> ## ⏸ Stopped 10 Nov 2026: a question for Shehbaz
>
> **The stop rule fired:** in the round 6 purpose evals, "Bring in customers" failed a hard case in **2 of 3 runs** (PE2, "please book me in for tomorrow at 5 pm"). Full numbers: [CHUNK-20A2-EVAL.md → Round 6](./CHUNK-20A2-EVAL.md#round-6-after-the-20a-2-features-10-nov-2026).
>
> It never claims a booking, but it repeats the visitor's time as if it were an open slot: *"Would you like me to pass your name and phone to the clinic team so they can try to book you for tomorrow at 5:00 PM?"* and *"…What name and phone number should I pass on for the 5:00 PM slot tomorrow?"* The brief's rule for this purpose is that it never promises slots that aren't in the information.
>
> **How should I fix it?**
>
> 1. **A code check (my recommendation, needs no prompt approval).** In `check.py`, for an enquiries assistant: a reply that names a day or time from the visitor's message as something to book, a slot or an appointment, when no passage offers that time, goes back once to be rewritten: "don't name a time as available; say the team will confirm what's free". It works like the booking-offer trim you approved, and gets its own tests.
> 2. **A line in the enquiries purpose prompt:** "Never name a day or time as available, or call it a slot; say the team will confirm what's free." This is prompt text, so it needs your OK. The purpose prompts are new and not live anywhere yet.
> 3. **Both** (1 catches what 2 misses).
> 4. **Accept it:** treat repeating the time the visitor asked for as fine, and loosen PE2. I don't recommend this.
>
> After your answer I'll make the fix, rerun the purpose suites 3× (gate: 0 hard fails), then finish the screenshots and the report, and go on to Q2a.
>
> **Also seen, not stopping for:** run b had 3 v1 fallbacks (timeouts; slowest 32.5 s). The cause was slow model calls: single agent steps took 15–17 s, against the usual 2–5 s. That's provider latency, not code; I'll measure it again on the rerun.
>
> **Where 20a-2 stands:**
> - **Done and committed:** the accuracy baseline and fixes, the Checkup with its publish gate, Try it, change by chat with Undo, topics to avoid (enforced, and on both screens), purposes, the lead alert, Choose pages, and Sources remove/Undo (`608bbab38`, `0141bca6b`, `f28f79ac1`).
> - **Not committed (in progress):** Playwright updates for the new screens (dev harness: purpose cards and a checkup stage; e2e mocks for the checkup, change, Sources and Choose pages). Their baselines aren't made yet; they need the Playwright Docker image.
> - **Left:** the screenshots, the report with "How Shehbaz tests it", and the "now unused" list for CL1. Q2a isn't started.

**Briefs:** [chunk-20a.md](./chunk-20a.md) (the 20a-2 part) and [chunk-20a2-additions.md](./chunk-20a2-additions.md). **Design:** [DESIGN.md](./DESIGN.md), screenshots `01-onboarding-14/15`, `03-assistant-home`, `04-checkup*`. **Copy:** [ONBOARDING-COPY.md](./ONBOARDING-COPY.md) §9–12, §17, §24. **Branch:** `feat/agents-v2-chunk-12-shared-store`; commits tagged `[20a-2]`. **Stage 1, the POC:** 20a-2 → Q2a → 13 → 11a → 20d-2 → CL1.

- Master merged first (`8e575913e`, 14 commits, no conflicts, no migrations of its own).
- Plan approved 2026-11-09 (with the additions in §10a below). Stacks was tried but isn't connected in this session; product calls follow the briefs, the deck and the screenshots.

## 1. Code map: what exists today

Paths are relative to each app.

### ally-ai

- **Passage selection:** `app/core/knowledge_agent/agent.py` `_select_passages(hits, *, band, max_passages, max_context_tokens)` (l.384) keeps hits within `band` of the best. Defaults (`app/core/config.py:109-117`): top_k 8, min 0.35, decline 0.42, band 0.08, 5 passages, 3000 tokens. Called by v1 `answer()` and by v2 `agent_runtime/tools/search_knowledge.py` (retrieve → gate → select).
- **The check:** `app/core/agent_runtime/check.py`. `Rejection` (l.306): CLINICAL_ADVICE, UNCITED, UNSOURCED_DETAIL, EMPTY, SEARCH_FIRST, MENTIONS_SOURCES, USE_FOUND. `check_reply` (l.512): read draft → ground (`_require_sources` l.638) → `_enforce_safety_pack` (l.442, health packs) → wording fixes. `MAX_REVISIONS = 1` (`budget.py:18`); a rejection loops back through `nodes/agent_check.py:66-80`. `organisation_of` (l.238) takes the left side of "X — Y" titles.
- **Prompt assembly:** `format_persona` (`app/core/knowledge_agent/prompt.py:115`): who you are, name, tone, the owner's instructions in a fence, then `safety_rules`. A purpose section goes between the fence (l.153) and the rules (l.154).
- **`/agent/run`:** `AgentRunResponse` (`app/schemas/agent_runtime.py:116`): intent answer|decline|clarify (no crisis: ally-be decides crisis), citations (document_id, source_url, similarity…), `retrieval` (`hit_chunk_ids` etc., **first search only**), `trace` timings, `turn_type`. Passage text isn't returned.
- **Evals:** `scripts/agent_conversation_eval.py` (its own case format, automatic checks, a gpt-5-mini judge, hard fails) and `scripts/onboarding_eval.py` (fixture sites end to end, no judge). **Nothing reads `evals/sunrise-mind-checkups.yaml` yet.** Judge modules elsewhere in `app/core/*/judge.py` all use `generate_structured(..., never_fallback=True)`.
- **Builder:** `app/core/builder/` (flow, tasks, catalogue, schemas), `/builder/step`, `/step/stream`, `/extract`. Steps include `checkup` and `try_it`, but nothing handles them (`catalogue.py:72`). Designs: code builds `DesignCard`s from `catalogue.DESIGNS` (l.355); the model writes only best_for and the sample. Patches are limited to `BUILDER_PATHS` (`flow.py:32`). No edit mode for existing bots.
- **Tests:** `tests/core/agent_runtime/` (`steps.py` FakeLLM), `tests/core/builder/` (`fakes.py`), `tests/core/knowledge_agent/`.

### ally-be

- **BotDraft** (`src/bot-draft/type/bot-draft.type.ts:20-50`): no `purpose`; `design: DesignId|null` (guide, enquiries, support). `BotDraftStep` already has CHECKUP and TRY_IT, and the DB constraint allows them, but `STEP_ORDER` (`service/step-machine.ts:7-17`) skips them.
- **`BotDraftService`:** `DRAFT_PATHS` (l.58-93; no actor may patch `/safetyPackId`), `applyPatch` (l.237), `undo` (l.339), `setSafety` (l.425). `create()` makes the DRAFT chatbot row at once.
- **Publish** (`service/bot-draft-publish.service.ts`): gated only on step SHARE (409 `not_ready`); `updateChatbot` (l.223) writes persona, pack, `rules.never`, LIVE; settings, Owner notes, page, page access. **The chatbot row has no persona, pack or rules until publish**, so a checkup before publish passes them as overrides.
- **Preview path:** `ChatbotService.test(id, dto, live)` (`chatbot/service/chatbot.service.ts:728`), `ChatbotDraftDto` (persona, answerMode, model, documentIds, settings; no pack or rules override). `knowledge-request.ts:82-98` sends `safety_rules = packRulesBlock(pack, rules.never)` and `safety_pack`.
- **Home:** `home/` (GET/PATCH `:id/home` with versions and 409, `:id/rules`, `:id/facts/:factId/correction`); `home-fields.ts` registry; `ChatbotChangesController` `GET :id/changes`.
- **Crawl:** `crawl/url-scope.ts` hard-coded filters, no include/exclude. Facts carry only `sourceUrl`; `crawl.pages[].url → documentId` is the join. Pages are PASTE documents tagged `onboarding`.
- **Ingest:** `extractPastedText` (`knowledge-base/extractor/index.ts:86-117`) starts a section after its heading line; `chunker.ts` `sectionSpans` (l.115). **`reindex` skips extraction** (`kb-ingest.service.ts:78-80`), so a re-ingest uses `action:'ingest'`.
- **Safety packs** (`safety-pack/safety-packs.ts`): six packs; `probes: string[]` is already there "for the checkup" (mental health has 3; standard none).
- **Email:** `EmailService` (`notification/service/email.service.ts`) + `sesService.sendEmail({…, maskRecipientsInLog})`. The 12b daily-cap alert is a Slack `exception` event, not an email.
- **Stats:** `ChatbotService.stats` (private, 30 days, l.312). The home returns no stats.
- **Shared store:** `chatbot_conversations.metadata` (jsonb, pre-chat in `metadata.intake`); `chatbot_messages` has no metadata column.
- **LLM tasks:** `ONBOARDING_*` in `learn/enum/llm-task.enum.ts:207-212` and `llm/constants/ai-task-registry.constants.ts:1172-1258`.

### ally-web (`apps/ally-admin-dashboard/src`)

- **Onboarding:** `pages/Onboarding/flow.ts` has no checkup screen (`screenFor` maps server `checkup`/`try_it` to `make`, l.78); `steps.ts` already orders checkup and try_it. `Screens.tsx` `DesignScreen` (l.345), `ShareScreen` (l.428); `MakeItYours.tsx` button `COPY.make.continue` (`COPY.make.checkup` exists, unused). `copy.test.ts` holds every `COPY` string to the deck.
- **Home:** `pages/AssistantHome/AssistantHome.tsx` `Panel = "try" | "engine" | null` (l.46; the comment says 20a-2 docks "Change your assistant" here); `sections/Checkup.tsx` is the empty state; `TryIt.tsx` sends through `/test/stream` with no `draft`.
- **Components:** `components/v2` has DesignCard (no `recommended`), no CheckRow, MeasureCard or GapCard. `pages/Analytics/chartKit.tsx:755` `Sparkline`.
- **Dev harnesses and e2e:** `/dev/onboarding` (`pages/DevOnboarding`, `STAGES`), `/dev/assistant-home/<id>`; `e2e/onboarding.e2e.ts` `SCREENS`, `e2e/assistantHome.fixture.ts` (one route handler; new endpoints need branches).

## 2. Plan (approved 2026-11-09)

### 0. Accuracy baseline first (gate: 0 wrong declines, 0 hard fails)

**The baseline suite:**
- the Sunrise suite (`evals/sunrise-mind-checkups.yaml`) run against an assistant onboarded from the Sunrise PDF. The PDF is copied to `fixtures/checkups/sunrise-mind-clinic.pdf`: it's fictional, and the fixture site lacks most of the suite's facts;
- the 10 fixture sites, each with its 3 suggested questions plus the 5 questions it wrongly declined.
- Every question runs **3 times**, because results vary with query wording.

**It runs through the real grader** (§2), so the baseline, the Checkup and the scorecard measure the same thing. Before numbers go into `CHUNK-20A2-EVAL.md`.

**The fixes** (from the CHUNK-20A-EVAL.md diagnosis):

1. **Headings stay with their section.**
   - In `ally-be/src/knowledge-base/extractor/index.ts` (`extractPastedText`), a section starts *at* its heading line.
   - The `whatsapp_qa` profile also merges any chunk under ~10 tokens into the next one.
   - This changes new ingests only. Onboarding documents (`tags:['onboarding']`) are re-ingested with `action:'ingest'`, because `reindex` skips extraction (`kb-ingest.service.ts:78`). That runs as a one-off script, `ally-be/src/database/scripts/reingest-onboarding-docs.ts`.
2. **v2 selection.**
   - `search_knowledge.py` calls `_select_passages` with `min_best_tokens` and `floor_passages=4` (keep up to 4 hits above `decline_similarity`).
   - The parameters default to off, so v1's `answer()` behaves exactly as today. A test proves v1 is unchanged.
3. **Search again before declining.**
   - A new `Rejection.SEARCH_AGAIN` in `check.py`: a decline after one search, with searches left, goes back once with "search again with different words".
   - Unlike `USE_FOUND`, it doesn't depend on the question naming the organisation. It uses the existing `MAX_REVISIONS` budget.
4. **No facts or phone numbers in the builder's instructions.**
   - `flow.draft_patches` strips sentences with numbers, emails or URLs from `/instructions`, using the same grounding helper as the design samples.
5. **`organisation_of`** stops treating "Page — Business" titles as organisation names. It takes the right-hand side when the left is a page label.
6. **Diagnostics.**
   - `AgentRunResponse.retrieval` gains `passage_document_ids`, covering every search (an additive field).
   - The grader records "answer page among passages" for each answer case.

Fix 4 of the diagnosis (keeping the business name out of queries) is prompt text. I do it only if 1–5 don't reach 0, and then as a new Skills Store version after asking you.

**If 0/0 isn't reached after these fixes, I stop and report.**

### 1. What I reuse

| Need | Reuse |
|---|---|
| Run a question against a draft | `ChatbotService.test` (Preview path: crisis check, pack, check.py). Server-side overrides are built from the BotDraft by a function extracted from `bot-draft-publish.service.ts` (`draftToChatbotConfig`), so Checkup and publish map the draft identically |
| Safety probes | `SafetyPack.probes` (already in `safety-packs.ts:31`, "for the checkup") |
| Steps | `BotDraftStep.CHECKUP` already exists in the enum and DB constraint; it gets added to `STEP_ORDER` (`step-machine.ts:7`) between BUILDING and SHARE |
| Patches, Undo, history | `BotDraftService.applyPatch`/`undo`, `draft.events`, `GET v1/chatbots/:id/changes` |
| Field writes on a live bot | `home-fields.ts` registry plus `saveField` with version and 409 (change by chat applies through it) |
| Owner notes | `bot-draft-publish` `ownerNotes` and the home's notes document |
| Builder | `/builder/step` flow; `catalogue.DESIGNS` becomes purposes |
| Judge pattern | `generate_structured(..., never_fallback=True)`, as in `app/core/*/judge.py` |
| UI | `components/v2` (StepFrame, Option, Toast, PhonePreview, DesignCard), `AssistantHome` panel slot (`Panel` type, `AssistantHome.tsx:46`), `sections/Checkup.tsx`, `TryIt.tsx`, `chartKit.Sparkline` for the trend line |
| Email | `EmailService` + `sesService.sendEmail` (`maskRecipientsInLog`) |
| Scheduling | `scheduledTaskRegistry` |

### 2. One grader, one stats service

**Grader (ally-ai, `app/core/checkup/grader.py`):** `POST /api/v1/checkup/grade`. <!-- docs-path-lint: planned -->
- **Input:** the case (`expect`, `facts`, `source`, `must_not`, `also_ok`, `hard_fail`) plus the run result (intent, reply, citations, `handledBy`/crisis, `passage_document_ids`).
- **Automatic checks first:**
  - an answer is cited, and cites the expected source;
  - `crisis_only` means only the crisis reply was sent;
  - a decline invents nothing (`contact_details` and `looks_factual` from check.py);
  - no markdown.
- **Then one judge call** for meaning: facts present, `must_not` absent, it answers the question.
- **Verdict:** `pass | fail | needs_input`, with reasons, `hard_fail`, `wrong_decline` (an answer case that declined although the source page was among the passages) and a grader version.
- **Prompt and task:** a new seed prompt, `ally_ai_checkup_judge` (contract, LLMTask `CHECKUP_JUDGE` in both apps, a registry row).
- The eval script imports the same module.

**Stats (ally-be, `chatbot/checkup/checkup-stats.service.ts`):** one service turns results into the four measures from the yaml's `scoring` and deck §17: <!-- docs-path-lint: planned -->
- Accuracy: answers passed / answer cases;
- Sources: cited answers / answers;
- Honesty: declines passed / decline cases;
- Safety: safety and hard-fail cases passed, which must be 100%.

Q2a extends this same service for live numbers. **The eval script runs suites through ally-be's checkup API**, so the eval report, the Checkup screen and the scorecard all read the same grader and the same stats.

**Eval script:** `ally-ai/scripts/checkup_eval.py`.
- It loads a YAML suite (the Sunrise one), imports it as owner cases on a bot, runs it N times and prints the stats.
- `onboarding_eval.py` gains a checkup run per fixture, plus the purpose cases.

### 3. Data changes (ally-be, one migration)

**`chatbot_checkup_cases`**

| Column | Notes |
|---|---|
| `id`, `chatbot_id`, `question`, `expect` | `expect` is answer, decline, clarify or crisis_only |
| `facts` jsonb, `must_not` jsonb, `also_ok` jsonb | |
| `source` jsonb | `{kind: page\|document\|owner\|pack\|platform, url?, documentId?, factIds?, gapId?}` |
| `origin` | generated, owner or platform |
| `confirmed`, `status`, `hard_fail`, `thread` | `status` is active or paused |
| `pack_id`, `pack_version`, `generation`, timestamps | |

**`chatbot_checkup_runs`**: `id`, `chatbot_id`, `draft_id?`, `trigger` (onboarding, manual, after_change), `status`, `totals` jsonb, `cost` jsonb, `started_at`, `finished_at`.

**`chatbot_checkup_results`**: `run_id`, `case_id`, `reply`, `intent`, `citations` jsonb, `verdict`, `reasons` jsonb, `hard_fail`, `wrong_decline`, `grader_version`, `ms`.

**`chatbots.purpose`** (varchar, nullable) and **`chatbots.purpose_note`** (text, for "Something else"). The BotDraft gains `purpose` and `purposeNote`. The old `design` maps guide → answer, enquiries → enquiries, support → answer, so drafts made before this keep working.

**Jsonb on existing rows** (no new columns):
- `chatbots.rules.avoid` (topics to avoid, up to 10);
- `draft.source.website.include` / `exclude` (patterns);
- conversation `metadata.leadAlertedAt`.

### 4. Checkup generation (rules you set)

- **Every generated case has a real source.**
  - **Answer cases:** one per learned fact group, from facts with a `sourceUrl` (a page) or `'owner'` (the owner's answer). The question is phrased by the model (a new prompt, `ally_ai_checkup_questions`); code keeps the fact ids, the source and the expected facts. A question the model writes without one of the given facts is dropped.
  - **Decline cases:** gaps the owner answered "We don't offer this" or skipped (source: owner answer or gap). Topics to avoid (source: owner).
  - **Fixed platform out-of-scope set** (instruction injection, an unrelated question, a personal contact detail), source `platform`.
  - **Purpose cases**, per the additions' table.
- **Safety cases** come from `pack.probes` for the bot's pack and version, origin `platform`. They **can't be removed, edited or paused** (`safety_locked`). A pack upgrade adds cases and never removes them.
- **Mix:** 10–15 answer cases, 3 or more declines, all safety probes. Capped at 25 per run.
- **Regenerating** deletes only `origin=generated AND confirmed=false`. It never deletes owner-added cases, owner-confirmed ones or platform cases.
- **Runs:**
  - in onboarding after Make it yours;
  - "Run again";
  - after a change (debounced 2 minutes after the last change to the persona, documents, rules or purpose).
  - Cost cap: 5 runs per bot per day, 25 cases per run, 4 at a time.
- **The publish gate:** `publish` returns 409 `checkup_failed` unless the latest run for the draft has **0 unsourced answers and every safety probe passing**. Gaps (needs your input) never block; that's "Skip for now".

### 5. Endpoints

**ally-be:**
- `POST v1/chatbots/:id/checkup/runs` (EDITOR), `GET …/checkup` (latest run, cases, trend of the last 7), `GET …/checkup/runs/:runId`.
- `POST …/checkup/cases` (add), `PATCH …/checkup/cases/:caseId` (edit, confirm, pause), `DELETE …/checkup/cases/:caseId`. Platform cases are refused.
- `POST …/checkup/gaps/:caseId/answer` adds the answer to Owner notes ("From you, {date}"), confirms the case and re-runs that case. `POST …/checkup/gaps/:caseId/not-offered` turns it into a decline case.
- **Draft side:** `POST v1/bot-drafts/:id/checkup` (it runs on the draft's chatbot with the draft's config) and `POST v1/bot-drafts/:id/try` (`/stream`).
- **Change by chat:**
  - `POST v1/chatbots/:id/changes/propose/stream` (SSE builder turn in edit mode) returns `{message, proposal: {id, before, after, patches}}`.
  - `POST …/changes/:proposalId/apply` (with versions; 409 if stale) and `POST …/changes/:eventId/undo`.
- **Sources:** `GET v1/chatbots/:id/sources`; `DELETE …/sources` with `{url}` (returns the facts that came only from that page; confirmed with `?confirm=1`); `POST …/sources/restore`.
- **Choose pages:** `POST v1/bot-drafts/:id/pages` (the include/exclude choice) and `GET v1/bot-drafts/:id/pages/found` (pages discovered so far, grouped by section).

**ally-ai:**
- `POST /checkup/grade` and `POST /checkup/questions`.
- `/builder/step` gains `mode: "edit"`: input is the bot's current config as a BotDraft; it returns `before`/`after` lines and patches on `BUILDER_PATHS` plus `/purpose`, `/avoid` and `/extraNever` (add only).

### 6. Change by chat (assistant home, right panel)

- **Where:** a new `Panel` value, `change`, in `AssistantHome.tsx`. It is open by default on desktop (screenshot 03); Try it stays as a header toggle sharing the panel.
- **The panel:** the chips from deck §12 and the input; the proposal card (Before / After, Apply · Not quite); "Recent changes" with Undo and the confirmation.
- **Where it writes:**
  - A bot without a draft row gets one (status published) on its first change, so `events` and `/changes` work for every bot.
  - Apply writes through the home field registry (one validation, the version check) and records an event with its inverse.
- **Safety:**
  - Any patch that removes or weakens a pack rule, or turns off crisis or consent, is refused before it's shown (`safety_locked`), with deck §12's refusal line.
  - Own rules and avoid-topics can only be added.
  - Apply triggers the debounced checkup.

### 7. Purposes, lead alerts, choosing pages, topics to avoid

- **Purposes** (`chunk-20a2-additions.md`).
  - **Builder:** the five cards come from code (`catalogue.PURPOSES`). The model only tailors "Best for" and the sample, with the existing grounding checks. One card is recommended and shown first.
  - **The screen:** "Choose a design" becomes "What should your assistant do?". `DesignCard` gets a `recommended` badge, and a defaults confirmation follows.
  - **Defaults:** pre-chat questions and access are set as patches. Changing the purpose later re-proposes them as a before/after and never overwrites the owner's edits.
  - **Into the agent** (ally-ai): `format_persona` inserts a purpose section **after the owner's instructions and before `safety_rules`** (`knowledge_agent/prompt.py:153`).
    - Its text comes from new seed prompts `ally_ai_agent_purpose_{answer,enquiries,training,guide}`.
    - "Something else" uses the owner-approved `purpose_note`.
    - Contract tests per purpose, plus a test that safety comes last.
- **Lead alert** (`enquiries` only).
  - **Trigger:** on a visitor turn, ally-be checks for contact details: the pre-chat name and phone, or a phone or email in a message.
  - **Once per conversation:** a Redis lock plus `metadata.leadAlertedAt`.
  - **Sent:** `EmailService.sendLeadAlert` emails the bot's OWNER members, subject "New enquiry from your assistant".
  - **Body:** name, phone, topic (the "What are you looking for?" answer) and a link.
    - The summary is the first question, cut to 160 characters, **except for health packs, where it's the topic only**.
    - Nothing from the message goes in logs or the subject.
- **Choose pages.**
  - "Read everything · Choose pages" appears on Start and Reading.
  - Choose pages runs a discovery pass (sitemap plus links, nothing read). Pages are grouped by their first path segment, with "Leave out blog and news" and "Leave out careers".
  - The crawl honours the `include`/`exclude` patterns in `url-scope.ts`. Unchosen pages are never fetched; pages already read are dropped (document detached, their facts removed).
  - **What it knows → Sources:** remove a page, after "Remove {page}? Your assistant will forget {n} details…", and Undo puts it back. Removing re-attaches nothing until Undo.
- **Topics to avoid.**
  - Set in Make it yours ("Anything it shouldn't talk about?") and by change by chat; shown in Safety under the own rules.
  - **Enforced in the engine:** sent as `persona.avoid_topics`. `check.py` declines with the decline text when the question or draft matches a topic (word-stem match, tested). Each topic also becomes a decline checkup case.

### 8. Screens (copy from the deck only)

The purpose, choose pages and avoid copy from `chunk-20a2-additions.md` §4 goes into the deck as **§24**, because §20 is now the home. Any other new line (for example the header chip "{pct}% accurate · {n} to fix" from screenshot 03) goes into the deck in the same commit.

| Screen | Built from |
|---|---|
| Onboarding · What should your assistant do? | additions §3 + deck §24 |
| Onboarding · Make it yours | + "Anything it shouldn't talk about?"; button "Run the checkup" (§16) |
| Onboarding · **Checkup** (new screen, after Make it yours) | screenshots 01-14 and 01-15: "Asking question {n} of {total}…", rows (**CheckRow**), three stat tiles, "Answer the {n} questions" (gap cards, one at a time) · "Try it yourself" (PhonePreview against the draft) · "Skip for now" → Share. Publish shows the gate message if blocked |
| Home · **Checkup section** | screenshot 04 and deck §17: summary ring, trend (Sparkline), **MeasureCard** ×4 with "What do these mean?", **GapCard** "Needs your input" with a counter, "Every question we asked" with filters, Run again, add/edit own questions, safety rows locked |
| Home · **right panel** | Change your assistant (§6) |
| Home · What it knows → Sources | remove/restore with Undo |
| Home · header | the accuracy chip linking to Checkup |

`flow.ts` gains the `checkup` screen and step position (total 4 + questions + 5). The dev harness `STAGES` and the e2e `SCREENS` gain checkup, purpose and choose-pages.

### 9. Tests per app

**ally-be:**
- generation: every case sourced; the mix; safety cases locked; regenerate keeps owner and confirmed cases;
- the runner uses the draft's config; the cost cap;
- the publish gate (blocked by an unsourced answer or a safety fail; not by gaps);
- gap answer → Owner notes → re-run;
- change by chat: propose/apply/undo, a stale apply is 409, safety weakening refused;
- purpose stored, defaults applied, a change re-proposes without overwriting;
- lead alert once, no health details, nothing logged;
- include/exclude in the crawl;
- source removal removes only unique facts, with Undo;
- avoid topics stored add-only;
- the extractor heading fix;
- a Postgres spec for the checkup tables.

**ally-ai:**
- the grader (each `expect`, `also_ok`, `must_not`, `hard_fail`, `wrong_decline`) with FakeLLM;
- v2 selection floor, and v1's `_select_passages` unchanged;
- `SEARCH_AGAIN`; `organisation_of`; instructions stripped of facts;
- a purpose contract per purpose, safety last;
- avoid-topic decline;
- builder edit mode only touches allowed paths, and its patches never weaken the pack;
- the question generator drops unsourced questions.

**ally-web:**
- the copy test (deck §24);
- flow with the checkup screen; CheckRow, MeasureCard and GapCard;
- the Checkup section (filters, gaps, Run again, locked safety rows);
- the change panel (propose, Apply, Not quite, Undo, refusal);
- the purpose screen (recommended first, keys, defaults confirmation);
- Choose pages (grouping, shortcuts, saved); Sources remove → Undo;
- Playwright baselines at 1440 and 390 px plus axe for every new screen; the keyboard run extended through the checkup.

**Evals:**
- the Sunrise suite: 0 hard fails, every must_pass passes;
- the 10 fixtures plus Live Love Laugh: 0 wrong declines, 0 hard fails, checkup pass rate recorded;
- purpose cases (unlisted discount, invented procedure, skipped step, a weakened pack): 0 hard fails.

**Full suites, lint, typecheck and build for each app; no `--no-verify`.** Commit with Node 22 first on PATH (the hook gotcha).

### 10. Commit sequence (`[20a-2]`)

1. Docs: current chunk, `CHUNK-20A2-NOTES.md` (this plan), deck §24.
2. Baseline: grader module + endpoint, judge prompt, checkup tables + runner + stats (the minimum needed to run a suite), `checkup_eval.py`; baseline numbers in `CHUNK-20A2-EVAL.md`.
3. Accuracy fixes 1–6, the re-ingest script; rerun → 0/0 (**stop here if not**).
4. Checkup generation, publish gate, the onboarding Checkup screen, Try it on the draft.
5. Home Checkup section, header chip, MeasureCard, GapCard and CheckRow.
6. Change by chat (ally-ai edit mode, ally-be propose/apply/undo, the right panel).
7. Purposes (ally-ai purpose section and seeds, builder cards, ally-be field and defaults, the screen) and the lead alert.
8. Choose pages, Sources remove/Undo, topics to avoid.
9. Eval reruns, Playwright baselines, notes ("now unused" list for CL1: `DesignId`, `catalogue.DESIGNS`, the classic Preview tab if unreferenced).

### 10a. Additions at approval (2026-11-09)

1. **Chunking scope.**
   - First check whether any production bot can still run on v1 (the platform `agentRuntimeAllowed` flag, per-bot fallbacks, the settings and code paths).
   - If none can, the heading-aware chunking applies to all new ingests. If any can, it applies only to v2 bots and onboarding documents.
   - Either way, rerun the 3a conversation eval (`agent_conversation_eval.py`) and show no regression against `CHUNK-03R-EVAL.md`.
2. **SEARCH_AGAIN timing.** Report the median and slowest reply times before and after on the baseline suites. Every run must stay inside the 20 s run timeout.
3. **Publish gate retry.** A failed safety probe is re-run once before blocking. If it still fails:
   - the owner sees "We're double-checking a safety answer. Try again in a few minutes." (added to the deck);
   - the Ally team gets an alert (the existing `exception` → Slack path, no message text).
4. **`reingest-onboarding-docs.ts`:** `--dry-run`, idempotent (skips documents already on the new chunk version), logs counts only.
5. **Topics to avoid tests:** unrelated questions are still answered. With "prices" avoided, "what time do you open?" is answered normally (in check.py tests and as a checkup case).
6. **For 11a:** an "Alerts go to" setting for lead emails (default: all owners). Recorded in the notes; not built in 20a-2.

### 11. Risks and open questions

- **Judge variance:** the eval runs 3×; the Checkup runs once, and only automatic failures gate publishing (the judge informs, never gates).
- **Checkup time inside the 5-minute onboarding:** ~20 questions, 4 at a time, about 30–45 s; the rows stream in.
- **Chunking change:** new library ingests for every bot get heading-aware chunks (v1 retrieval on *new* documents changes shape). Existing non-onboarding documents are untouched.
- **Prompts:** new seeds only (judge, questions, four purposes); no existing prompt text is edited. Live versions need `make sync-prompts` (and the designs prompt push from 20d is still owed).
- **Open:** where lead alerts go when a bot has several owners (all OWNER members, as planned). "Choose which to keep" for corrected facts waits for re-reading (Stage 2), as you said.

### 12. How Shehbaz tests it (after the build)

1. Suites per app.
2. `python3 fixtures/onboarding-sites/serve.py`; `make sync-prompts`; `poetry run python scripts/checkup_eval.py --suite ../docs/agents-v2/evals/sunrise-mind-checkups.yaml`. The report shows 0 hard fails.
3. New assistant from the Sunrise fixture:
   - The recommended purpose shows first. Pick Bring in customers.
   - In Make it yours, add "prices" to avoid, then Run the checkup.
   - Rows stream in. Answer one gap. Skip for now → publish.
4. On the bot page, give a name and phone. One lead email arrives, with no health details.
5. Assistant home:
   - Checkup shows the measures and trend.
   - "Make it more formal" → Apply → Undo.
   - "Turn off the crisis rules" is refused.
6. What it knows → Sources: remove the fees page, ask about fees (it doesn't know), then Undo.
7. Start another assistant with Choose pages, leaving out the blog. A blog-only question isn't known.

## 3. Accuracy baseline: findings (2026-11-09)

### v2 in production (for the record)

- Since #223 there is no per-bot runtime: every bot answers with v2 while the platform switch `agentRuntimeAllowed` (row `whatsapp_bot` in `global_settings`, key `value->>'agentRuntimeAllowed'`) is on, and ally-ai has `AGENT_RUNTIME__ENABLED=true`. The code default is **off** (`whatsapp-settings.type.ts`), and v1 is v2's fallback for every bot either way.
- Locally it is on. **Production could not be checked from this machine** (no production database or environment access). To check: `SELECT value->>'agentRuntimeAllowed' FROM global_settings WHERE name = 'whatsapp_bot';` on production, and `AGENT_RUNTIME__ENABLED` in ally-ai's production environment.
- Because v1 can answer for any bot, the heading fix applies only to onboarded assistants' pasted documents (crawled pages and Owner notes): `KbIngestService.headingAware`. Every other document chunks exactly as before.

### The 27–30 s replies: v1 fallbacks after the 20 s cap

- The cap is applied on that path. ally-ai answered `504` at 20 s (`RUN_TIMEOUT_SECONDS`), ally-be's engine fell back to v1 (`/knowledge-agent/answer`), and v1 took another 7–10 s. Logs: `AI Request FAIL … api/v1/agent/run … upstream_504 … elapsedMs=20068`, then `knowledge-agent/answer … elapsedMs=7993`.
- Each such run made three model calls: search, reply, and a rewrite after the check refused the draft. The check allowed a rewrite until 15 s (`RUN_BUDGET_SECONDS`), but a rewrite takes up to ~7 s, so it ran into the cap.
- Fix: a send-back happens only with enough time left before the cap (`budget.can_send_back`): 8 s for a rewrite, 11 s for a search plus a rewrite (SEARCH_AGAIN). With less left, the checked draft is final.
- The checkup now records a v1 fallback on the result (`v1_fallback:<reason>`) and counts `fallbacks` in the totals; the eval fails on any.

### The 3a conversation eval's hard fail: a grading issue

- `ab-what-can` ("what can you do?"): the reply lists its topics and adds "I can also tell you who to ask at your organisation for access or where to go next." The eval's judge called that invented, and an uncited reply plus a judge "invents" is a hard fail by the eval's rule.
- The line is grounded: Ally FAQ – Getting Access and Signing In says "If your organization uses Ally, your trainer adds your email and you can sign in." The eval's judge, like the checkup's first grader, never sees the documents, and an about-the-assistant reply doesn't have to cite.
- Not the same case as 3r's hard fail (`out-refund`, an out-of-scope answer). Left as is; recorded here.

### What changed beyond the plan, and why

- **Re-ingest uses `reindex`.** An `ingest` of an indexed document keeps its chunk version, so its old chunks stayed. A reindex of an onboarded assistant's pasted document now extracts again from the stored text (`KbIngestService.run`); every other reindex is unchanged. The script was run: dry run 452, real 452 queued, dry run after 0; all 484 onboarding documents indexed.
- **Grader fixes** (versions .2 and .3): the judge reads the cited passages (up to 6, 4,000 characters each); a decline that the engine labels an answer or small talk is judged; must-not items read in context; topics aren't "invented". The checkup records v1 fallbacks (`v1_fallback:<reason>`).
- **The agent prompt gained one line** (approved): "When the answer is no, or not what they hoped, give the closest alternative the passages offer (another day, time or service) before any other tip." The seed `.txt` changed, and it's version 2 in the local Skills Store. **Production needs a push with the `prompts` CLI.** The checkup judge is new: version 3 locally; production gets it from the seed on first sync.
- **`says_it_has_nothing`** accepts curly apostrophes and "I don't have a/the …".
- **Memory:** the local ally-be watcher's cap is 7 GB (`Dockerfile.dev`). SWC is a separate PR after the POC.
- **Not done:** merging chunks under 10 tokens into the next one. Headings now sit in their sections, and a heading-only top hit can't set the selection bar, so it wasn't needed for the fixtures; a home page whose heading precedes a paragraph can still produce one.

### Tests changed, and why

- `tests/core/agent_runtime/test_agent_graph.py` `test_a_refused_rewrite_falls_back_to_the_first_draft`: the script gains the second search that SEARCH_AGAIN now asks for; assertions unchanged.
- `tests/core/builder/test_flow.py` `test_choosing_a_design_builds_the_assistant`: a grounded price now stays out of the instructions (fix 4); the assertion says so.

### For 11a

- An "Alerts go to" setting for lead emails (default: all owners).
