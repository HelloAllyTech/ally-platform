# Chunk CL1 notes: cleanup before launch

**Brief:** [chunk-cl1.md](./chunk-cl1.md). **Branch:** `feat/agents-v2-chunk-12-shared-store`; commits tagged `[CL1]`, not pushed. **Baseline:** `3b672dc9a` (the end of 20d-2's fix-up round). **Stage 1, the POC:** 20a-2 ✅ → Q2a ✅ → 13 ✅ → 11a ✅ → 20d-2 ✅ → **CL1**.

> Report below. Stopped here for Shehbaz's review.

## Report: CL1 is done (11 Nov 2026)

Commits 1–14 change nothing anyone sees. Commits 15–16 do, as Shehbaz asked: the classic view goes, after "All numbers" is redrawn in v2.

| Commit | What |
|---|---|
| `6f2f0c863` | ally-ai: remove the unused designs code and prompt |
| `221a76de7` | ally-ai: drop the `contextvars` backport |
| `2472fb0d8` | ally-ai: split the reply check and the builder's helpers by responsibility |
| `d8761eb6a` | ally-ai: comments that describe old behaviour |
| `1212d107d` | ally-web: the old setup form's leftovers, unused hooks and orphaned copy |
| `810f8d287` | ally-web: unused dependencies |
| `f73cf26fe` | ally-web: split the onboarding screens and the home's copy |
| `00492ea71` | ally-be: stop sending the designs prompt; drop its task and registry row |
| `c236339a7` | ally-be: unused dependencies |
| `b52a71853` | ally-be: un-export what only its own file uses; six unused definitions |
| `1fa85b7ea` | ally-be: one controller per file; the home's DTOs in `bot-draft/dto` |
| `a944511f3` | ally-be: comments |
| `391a62342` | ally-web: comments that promised CL1 work |
| `5c62ae3da` | docs: finished briefs archived, `README.md`, CONTEXT and v2-chunks match the code |
| `4699328c3` | ally-web: **All numbers** in v2 on the Overview |
| `b54d2cf42` | ally-web: **the classic view removed**; the staff `···` menu gains Settings |
| `c21c127fa` | **Merge master** into the branch (Shehbaz asked, 11 Nov; see "Merging master" below) |
| this one | these notes, and the old notes' paths to files CL1 removed marked as deliberate |

### Merging master (11 Nov)

121 master commits (context library, image studio, learning design, course copilot, dark-mode charts), 13 conflicts:
- **Both sides kept:** ally-ai's router imports, ally-be's `.env.example` and `package.json` scripts, the web `api/index.ts` exports, `PrivateLayout`'s imports, the enum-constraint spec's imports.
- **Master's side:** the agent-memory types and the knowledge-base search endpoint (master removed them; nothing uses them).
- **This branch's side:** CL1's removals (`UsageDashboard.tsx`, `KbChunk`, `CHUNK_BY_ID`); `botDraft` and `botPage` in ally-be's config (with `stacks` dropped, as master did); `sharp` 0.35.5; ally-be's lockfile (npm finds it already matches the merged `package.json`).
- **Both intents:** the chart-bundle guard keeps CL1's rule and master's `@components/charts` pattern.
- **Two fixes master's code needed here:**
  - its image-studio code was written for `sharp` 0.33's typings, so its four files now use the 0.35 import the branch's image code uses (its 88 tests pass);
  - its `scripts/backfill-scenario-description-audio.ts` sat outside ally-be's tsconfig, where the pre-commit lint can't read it, so it moves to `src/database/scripts/` with the branch's other scripts (`npm run backfill:scenario-description-audio` follows).
- The merge commit's hook ran every suite: ally-be related tests 12,727 passed (52 skipped), helpline 3,929 (7 skipped), admin 9,637, ui-shared 378; ally-ai pytest and flake8 passed. The full checks after it are below.
- **After the merge:** admin and helpline typecheck clean; web lint 0 errors (121 warnings, one fewer than the baseline); `format:check` fails on 79 files, all already on the baseline's list of 84 (none new); docs-path-lint ok; the PR's docs guard passes. ally-be's full suite, the builds and the browser tests on the merged code were still running when these notes were committed.
- **PR checks:** "Docs guard" asked for the public wiki's ally-be and ally-ai repo pages to describe this branch's modules and routes (`helloallytech.github.io/wiki/repos/`), and "docs-paths" flagged old notes naming files CL1 removed; both are fixed in this commit.

### Proof: suites, evals and baselines

| | Baseline (`3b672dc9a`) | After CL1 |
|---|---|---|
| ally-ai pytest | 2,157 passed, 46 skipped | 2,152 passed, 45 skipped (6 tests removed with the designs code, named below) |
| ally-ai flake8 | clean | clean |
| ally-be jest | 1,033 suites; 14,835 passed, 70 skipped | identical (run after the last ally-be commit) |
| ally-be lint, typecheck, `nest build` | clean | clean |
| ally-web admin vitest | 578 files, 9,501 passed | 571 files, 9,453 passed (the differences are named below) |
| ally-web helpline | 310 files, 3,919 passed, 7 skipped | identical |
| ally-web ui-shared | 48 files, 378 passed | identical |
| ally-web admin typecheck, lint | clean (0 errors, 122 warnings) | clean |
| ally-web `format:check` | already failed on 84 files | not made worse: only changed files were formatted |
| docs-path-lint | ok | ok |
| Bot page size (JS / CSS, gzipped) | not measured on the baseline commit | 60.1 KB of 70 / 5.1 KB of 25 (within budget; CL1 changed nothing the bot page bundles) |
| Playwright (compare only) | 4 failures already: the Overview and Change baselines were stale (the fix-up added the 7/30 switch after Part E refreshed them) | 99 of 100 pass, 1 skipped as before; only the 4 stale baselines and the 2 new All numbers ones were written |
| 3a conversation eval | 0 hard fails; judge 4.62 (min 3); same documents as v1 100% of 12; p50 −19% vs v1 | 0 hard fails (and 0 automatic-check fails, from 2); judge 4.69 (min 4); same documents as v1 100% of 12; p50 6,642 ms, −26% vs v1; `turn_type` 92% |
| Sunrise checkups (`abdfd2d1`, the PDF assistant), 3× | 0 hard, 0 wrong declines, 0 fallbacks; must_pass partials that count: B3, B4; median 6.8 s, slowest 15.0 s | Run 1 (machine busy with the merge checks): 0 hard, 0 wrong declines; must_pass partials that count: B4 only; 3 fallbacks, all on F2, which still passed 3 of 3 (a timeout, and twice the model returning an invalid step); slowest 24.7 s. **Quiet rerun:** 0 fallbacks, 0 wrong declines, B4 only, median 7.1 s, slowest 17.4 s; 1 hard fail, C4 (nice_to_pass) in 1 of 3 |
| Fixture checkups (20a-2's fixture assistants), 3× | 90 replies; 0 hard, 0 wrong declines, 0 fallbacks; partials that count: `mh-start`, `tea-fresh`; median 6.8 s, slowest 11.3 s | 90 replies; 0 hard, 0 fallbacks; partials that count: `mh-start`, `tea-fresh` (the same two); median 6.5 s, slowest 15.5 s; 1 wrong decline, `gp-hours` in 1 of 3. **Quiet rerun of gp-clinic:** 0 wrong declines; `gp-hours` 1 hard fail in 1 of 3 (it gave the right hours, plus the clinic's phone number, which the judge counted as invented) |

The ally-ai image was rebuilt before the "after" evals, so they ran the CL1 code.

**Reading the eval differences.** The single-run misses after CL1 (`gp-hours`, C4) are on questions that missed the same way before it: in 20a-2's runs on 9 Nov (27 asks each), `gp-hours` had 1 hard fail and 6 wrong declines, C4 1 hard fail, E6 2 hard fails. Nothing on the agent's path changed in CL1 apart from the verbatim move of the reply check, verified line by line. The fallbacks went with the machine load: 0 in the quiet rerun. My read is model variance, not a regression; if you want certainty before launch, rerun Sunrise and gp-clinic once more and count the gate over the runs.

**Tests that went, and why each is safe:**
- ally-ai (6): the designs copy and default titles, and the designs prompt's contract checks. The code they tested is gone.
- ally-web, commit 10 (7): six copy-test cases for the removed "Needs your input" strings, and one generated tag-registration case for the removed `WHATSAPP_BOT_DOCUMENT_CHUNKS` tag.
- ally-web, commit 16: the classic components' own tests (BotPageTab 9, ChatbotOverviewTab 8, ChatbotTestTab 11, ChatbotTestTabStreaming 6, ConversationsChannel 3, ConversationsTab 9, KnowledgeTab 14, UnansweredTab 8) and `WhatsAppBot.test`'s "Chatbot page" block (10). Public links staying off is still tested in v2 (Share/Website, onboarding) and in ally-be.
- Added: `AllNumbers.test.tsx` (7), one Overview test, a Playwright test for All numbers.
- Changed: `RouteLayout.test` (`?view=classic` opens the home), `header.test` (a link item other than Classic view), the e2e staff-menu test (Settings opens its panel), and the chart-bundle guard (no AI Chatbots page imports `@carbon/charts` now).

### What was removed, by area, and why

Every item: flagged by knip or vulture and confirmed by grep (tests included), or proven unused by the typecheck after its last user went.

**ally-ai**
- The designs code from 20a-1 (purposes replaced it in 20a-2; nothing called `propose_designs`): `catalogue.DESIGNS`, `DESIGNS_FOR`, `DEFAULT_DESIGNS`, `DESIGN_MESSAGE`, `COMING_SOON_*`, the `Design` dataclass, `tasks.propose_designs`, `offered_designs`, `_card`, `DesignOut`, `DesignsOut`, `builder/designs.txt`, `BuilderDesignsInputs`, `LLMTask.ONBOARDING_DESIGNS`; and `instructions.LAYERS` (no users). <!-- docs-path-lint: ignore -->
- `contextvars` (a backport of a standard-library module) and `immutables`, which only it needed.

**ally-be**
- `ally_ai_builder_designs` from the codes sent with every builder request; `LlmTask.ONBOARDING_DESIGNS` and its AI task registry row.
- Dependencies: `fetch-blob`, `passport-local`, `@types/passport-local`, `remove`, `source-map-support` (still installed through other tools), `ts-loader` (`nest build` uses tsc); the lock also loses the 9 packages only they needed.
- Unused definitions: `NO_CHOICE`, `packCatalogue`, `STEPS_WITHOUT_WEBSITE`, and the types `DraftView`, `VariantSize`, `BotPageLimitHit`. 61 names used only in their own file lost `export`.

**ally-web**
- The old setup form's leftovers: `useCreateChatbotMutation`, `CreateChatbotRequest`, the `createPanel` and `presets` copy.
- Unused hooks and what hung off them: `useUpdateBotImageMutation`, `useGetKbDocumentChunksQuery` (with its type, endpoint and cache tag).
- Q2a's "Needs your input" copy, which nothing showed any more.
- `checkup.ts` `sourceLabel`, `blocksPublishing`, `filtered`, `CheckupFilter`; three re-exports nothing imported; 18 `export` keywords.
- Dependencies: `@livekit/components-styles`, `class-variance-authority`, `next-themes` and `recharts` (root and helpline), `@remix-run/router` (still installed through react-router-dom) and `@types/dompurify`; the lock also loses 4 packages only recharts needed.
- **The classic view** (commit 16; see the section below).

**docs:** 17 finished briefs and reports moved to `archive/`; nothing deleted.

### The classic view

**Before it could go:** "See all numbers" sent every owner to the classic usage tab. Commit 15 redrew it in v2 as **All numbers**, opened in place on the Overview: the same four analytics queries for this assistant over 7, 30 or 90 days, in owner words, with plain bars (no chart library). Copy in deck §25.

**Removed:**
- Routing: `?view=classic` is ignored. An old link opens the home, and its `tab=` lands on the section that holds it now; `?view=classic&tab=usage` opens the Overview with All numbers open.
- The staff `···` menu's Classic view item.
- 16 files only the classic page imported: `ChatbotPage`, `ChatbotOverviewTab`, `ChatbotTestTab`, `BotPageTab` (with `AccessList` and the logo and colour fields that duplicated Look and feel), `ConversationsTab`, `ConversationDrawer`, `KnowledgeTab`, `KnowledgeUploadPanel`, `KnowledgeDocumentPanel`, `PeopleTab` (`WhoCanChat`, `Team`), `PersonaTab`, `UnansweredTab`, `UnansweredAnswerPanel`, `UsageTab`, `UsageDashboard`.
- Pieces of kept files: `BotConnectorsTab` and `FreeChannels`, `ChatbotStatusPill`, `StatCard`, `missingPersonaFields`, `readPreviewDraft`.
- What only those used: 24 API endpoints and their hooks, 19 endpoint constants, 19 types, and 514 lines of copy.

**Kept, with who uses it:**

| Kept | Used by |
|---|---|
| `ChatbotSettingsTab` | **Moved** into a staff-only Settings panel in the `···` menu (Shehbaz's choice). It's the only screen for one assistant's own overrides: WhatsApp replies on or off, typing, consent, the crisis check, helpline numbers, rate limits, retrieval thresholds, max sources, idle time |
| `AllConnectorsTab`, `NumberTab`, `TemplatesTab` + `TemplatePanel`, `BotSettingsTab`, `CorpusTab` | The staff tabs Channels, Defaults, Knowledge library |
| `ConnectWhatsAppFlow` | The v2 Share sheet |
| `AgentTab` | The Engine panel (How it answers) |
| `LookAndFeel` | Page |
| `components/v2` `CheckRow` | Onboarding's checkup |
| `previewDraft` (the handover) | `AgentTab`, which restores unsaved edits from it |
| The analytics hooks | All numbers |
| `TemplatesTab`'s per-assistant mode | Unreachable now, but driven by context, not a prop; removing it is a refactor, not a cleanup |

**Screenshots** (`design/cl1/`): the Overview before (`before/overview-1440.jpg`, `-390`), after with the numbers closed (`after/overview-*.jpg`) and open (`after/overview-all-numbers-*.jpg`).

### Files split, and names changed

- ally-ai `agent_runtime/check.py` (997 lines) became a `check/` package: `text`, `organisation`, `rejections`, `safety`, `verdict`, `fixes`, `pipeline`, and an `__init__` that re-exports every name imported elsewhere. A line-by-line comparison showed no line lost. Four helpers used across the new files lost their underscore (`SENTENCE_END`, `enforce_safety_pack`, `enforce_avoid_topics`, `add_fallback_contact`). <!-- docs-path-lint: ignore -->
- ally-ai `builder/grounding.py` (from `tasks.py`) and `builder/purposes.py` (from `catalogue.py`).
- ally-web `Onboarding/Screens.tsx` (690) became one file per screen in `Onboarding/screens/`, re-exported. `AssistantHome/copy.ts` (674) became `copy/` (index, lists, checkup, change, how, numbers); a one-off check proved the assembled `HOME` strictly equal to the old one. <!-- docs-path-lint: ignore -->
- ally-be: `ChatbotChangesController` in its own file; the home's 8 DTOs in `bot-draft/dto/assistant-home.dto.ts`.

### Lines of code (tracked)

| | Before | After | Change |
|---|---|---|---|
| ally-ai `app/` | 38,992 | 38,934 | −58 (the splits add headers) |
| ally-ai tests | 31,418 | 31,403 | −15 |
| ally-be `src` (non-spec) | 536,525 | 536,497 | −28 |
| ally-be specs | 305,333 | 305,333 | 0 |
| ally-web admin `src` | 287,306 | 281,467 | −5,839 |
| ally-web admin tests | 152,373 | 150,304 | −2,069 |
| ally-web, all ts/tsx | 625,234 | 617,289 | −7,945 |

`git diff --shortstat 3b672dc9a HEAD`: ally-ai +1,437 −1,606, ally-be +268 −505, ally-web +2,266 −10,225, docs +82 −47 (before these notes).

### Kept on purpose

- **The v1 engine and its fallback.** CL2 removes them after 4 weeks of traffic with 0 fallbacks.
- **Shadow mode:** nothing to remove; chunk 3d removed it (migration `1980980000000`).
- **Flags:** none is always on or off. `agentRuntimeAllowed`, `sharedStoreWrites`, `readHistoryFrom`, `dashboardReadsFrom`, `botPagePublicAllowed`, `showTyping` and `platformChatbotId` are platform settings with two live branches; ally-ai's `AGENT_RUNTIME__*` and `BUILDER__*` are all read.
- **Not split, though planned:**
  - `home.css` (1,232): its rules depend on order, so splitting by section changes the cascade, and order-keeping slices follow the chunks, not the sections.
  - `bot-page-public.service.ts` (1,166): its widget and feedback methods share the class's private session helpers, so separating them is a refactor (new providers, a rewritten spec).
- **Not split, as planned:** `ai.service.ts` (shared by all of ally-be), `whatsapp-inbound.service.ts` (the safety order lives in `handle()`), `chatbot.service.ts`, `checkup.service.ts`, `bot-draft.service.ts`, `contracts.py`, v1's `agent.py`, ally-ai `builder/tasks.py` (498 after the move).
- **ally-be routes only the classic view called**, kept for a later API pass: `PUT/DELETE chatbots/:id/documents`, `:id/members`, `:id/audience`, `PUT :id/page`, `POST :id/page/logo-url`, `:id/page/access`, `GET :id/page/slug-available`, `whatsapp/conversations…`, `citations`, `contacts/:id/reveal|block|unblock`, `unanswered…`, `web-contacts/:id/erase` (the erasure logic is live).
- **Routes with no web caller** (may be used by hand): `POST v1/chatbots`, `GET v1/chatbots/sections`, `PATCH :id/images/:imageId`, `GET/DELETE v1/connectors…`, `POST/PATCH whatsapp/templates`, `whatsapp/settings/provider-*`, `preview/ask`.
- **Unsure, so left:**
  - `DesignChoice` in ally-ai's `ConverseOut` (part of the model's output schema)
  - `AgentRunRequest.runtime_version` (ally-be sends it)
  - catalogue copy used only by its test
  - `aiohttp` (dev)
  - ally-be `husky` (the root hook runs `.husky/pre-commit`)
  - `/dev/v2-components`
  - the tooltip keys `WA_*` (they may key records in the tooltip CMS)
  - `react-router`, `react-is`
  - the `WhatsAppBot/` folder name (rename with the next change there)
- Whole-repo knip findings outside AI Chatbots (for example unused barrels in `PromptManagement` and `UserManagement`): out of scope.

### Unused database columns and tables (for a later migration; nothing dropped)

| Column | State |
|---|---|
| `chatbot_checkups.grader_version`, `answer_page_offered`, `pack_version` | Written, never read |
| `wa_contacts.consent_granted_at`, `opted_out_at` | Written, never read (worth keeping as an audit trail) |
| `chatbot_message_feedback.handled_at` | Written, never read |
| `wa_unanswered_questions.assigned_to` | Accepted, never shown (and now no screen sets it) |
| `chatbots.last_tested_at` | Written; only the classic overview showed it |
| bot page `settings.branding.avatarUrl`, `footerLink` | Written only by the classic whole-page PUT, which no screen calls now; `branding.logoUrl` and `accentColour` are still read as fallbacks for `brand` |
| `bot_drafts.design` | Keep while drafts from before purposes exist |

### Found on the way (behaviour, so not CL1)

- ally-be doesn't send Skills Store overrides for `ally_ai_builder_change` and `ally_ai_checkup_questions` (`ai.service.ts`), so live edits to those two prompts never take effect.
- `onboarding_eval.py` is out of date: it reads the purpose cards' "won't: Book, take orders…" as offering booking, and three health cases get a 409 on publish. It fails 11 of 13 cases at the baseline, so the fixture checkups were the comparison instead.
- The Playwright tolerance (`maxDiffPixelRatio: 0.01`) let a colour change pass unnoticed; `--update-snapshots=all` was needed to write it.

### Local data CL1 left behind

- The first two Sunrise runs went to the wrong assistant (`83ee2029`, built from the website fixture). Its checkup holds the Sunrise suite's questions and two eval runs (one failed when ally-be was killed).
- The onboarding eval baseline created 13 new local assistants (copies of the fixture sites, 10 Nov).

### How Shehbaz tests it

Local stack, admin on :8081. Restart `ally-web-admin-1` once if the page is blank (files moved).
1. **Overview → See all numbers:** it opens in place; switch 7 / 30 / 90 days; Hide all numbers closes it.
2. **Old links:** open `/chatbots/<id>?view=classic` and `?view=classic&tab=usage`: the home, the second with All numbers open.
3. **As staff, `···`:** How it answers and Settings; Settings shows the assistant's own settings and saves as before. As an owner, no `···` on a wide screen.
4. **AI Chatbots list:** Channels, Defaults and Knowledge library still work.
5. **Onboarding:** a new assistant end to end (screens moved files; nothing should look different).
6. **Evals:** as in the Proof table. Sunrise: `checkup_eval.py --suite ../docs/agents-v2/evals/sunrise-mind-checkups.yaml --bot abdfd2d1-0c6f-46a1-9a21-ce476205b0c4`. Fixtures: `checkup_eval.py --fixtures ../fixtures/checkups/fixture-questions.yaml --bots bots.json`, where `bots.json` maps each site to the assistant 20a-2's fixture runs used:

   ```json
   {"coaching":"7ba44ce7-a1a4-4436-b6cf-e7f8347df061","d2c":"4ef7fe1b-345a-4c66-8938-ae16c8c06dc4","diagnostic-lab":"7e52f655-a5d3-4bc8-964d-239c0cdd6439","gp-clinic":"dad51f34-8464-4fba-a8d3-06f935166e01","mental-health":"48c884ff-2319-484e-870f-68189b709662","pharmacy":"058afc76-7bbd-4925-9d93-e845542a6d65","real-estate":"4c53a198-48fc-44a7-a371-95201cef4bc1","restaurant":"784bbe15-740f-4a0d-8f74-c3dda1a332b7","saas":"c62c5d17-e43e-468a-92bb-3d94a27fc3b6","wellness":"1f2c8310-b137-4dc2-b9ba-3dfe750c5f21"}
   ```

### Plan (approved 2026-11-10)

The plan, with Shehbaz's change (remove the classic view in CL1, after All numbers in v2), is at `~/.claude/plans/pasted-content-id-adc7-we-re-on-snug-phoenix.md`. <!-- docs-path-lint: ignore -->
