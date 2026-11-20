# Chunk SB1 — Split build: talk to your bot from the first seconds

> Brief for Claude Code. Read `CONTEXT.md`, `SLICE-1.md` (the experience bar), `DESIGN.md`, `CHUNK-20D-NOTES.md` and `CHUNK-20D2-NOTES.md` (onboarding, Try it, "Why this answer?"), `CHUNK-12B-NOTES.md` (the bot page), `BUILDING-BLOCKS.md` (blocks 5 to 7), then this file. Plan first. <!-- docs-path-lint: planned -->
> **Not part of Q3-fast.** Build it only after `EPIC-Q3-FAST.md` is merged, as its own chunk. If you are in a session for another chunk, do not build any of this; add what you notice to that chunk's notes.
> Branch: `feat/agents-v2-sb1` from master. Tag commits `[SB1]`. Repos: `ally-web` (most of it), `ally-be` (small), `ally-ai` (small, step 2 only).
> **Stops:** (1) the plan, with answers to the open questions in section 9; (2) screenshots of the split screen at 1440x900 and 1280x720, before any copy changes ship; (3) the timing numbers from section 7 on a real site. About 4 to 5 days.

## 1. The goal

A first-time owner has a **live, chattable bot within about 10 seconds of giving us a website, a file or a sentence**, and can **keep changing it while chatting with it**, on one screen, 50:50, on a laptop. The 5-minute promise in `SLICE-1.md` becomes: **first live bot in under 15 seconds, shareable link in under 5 minutes, and the owner has chatted with the bot before they ever see a "Checkup" screen.**

Today the owner talks to the *builder* (chat), watches a *canvas* of what it learned, and meets their own bot late (Checkup, then Live/Share). SB1 puts the real bot beside the builder from the start.

## 2. What exists today (read the code, don't trust this list blindly)

Verified when this brief was written, from the code, not by running the app:

| Fact | Where | What it means for SB1 |
|---|---|---|
| Onboarding is one screen at a time (Reading → Learned → Design → Safety → Checkup → Share), with **Chat / Your assistant tabs** | `ally-web/apps/ally-admin-dashboard/src/pages/Onboarding/` (`OnboardingSession.tsx`, `flow.ts`, `steps.ts`, `screens/`) | The tabs read as the narrow-screen layout. Keep them below the split breakpoint. |
| Four start methods (website, documents, describe, interview), each its own screen | `pages/Onboarding/OnboardingStart.tsx`, `copy.ts` | Section 4, step 2 folds these into one input. |
| A chatbot row exists during onboarding (`bot_drafts.chatbotId`), and `useBrandEditor` already edits it by id | `ally-be/src/bot-draft/service/bot-draft.service.ts`, `OnboardingSession.tsx` | The test pane can call the normal test endpoint during onboarding. Confirm the row exists from the first screen, not only after Design. |
| **`POST /v1/chatbots/:id/test` and `/test/stream` already take unsaved overrides**: `dto.draft` = persona, answerMode, model, settings, documentIds | `ally-be/src/chatbot/service/chatbot.service.ts` (`test`), `ally-be/src/chatbot/dto/chatbot.dto.ts` (`TestChatbotDto`) | Hot-reload testing is mostly a frontend job. Check which fields the override does **not** cover (lists, safety pack, owner rules, Never topics) and widen it only where the plan needs it. |
| Try it already streams the run's steps and has a **"Why this answer?"** list (passages, latency, declined and the avoided topic) | `pages/AssistantHome/TryIt.tsx`, `hooks/useChatbotTestStream.ts` | Reuse these as they are. Don't build a second chat pane. Move or share the component. |
| The assistant home is `200px nav | content | 380px Try it panel` | `pages/AssistantHome/home.css` (`.ally-home__body--panel`) | The 380px phone is too narrow for 50:50. After SB1 the panel is a resizable half on wide screens. |
| The builder turns what it reads and hears into JSON patches that ally-be re-validates (paths, schema, safety lock). Its change flow proposes before/after field changes | `ally-ai/app/core/builder/` (`flow.py`, `change.py`), `ally-be/src/bot-draft/home/change.service.ts` | The "edit by talking" box (step 5) reuses this. Don't invent a second patch format. |
| Checkup cases live on the draft and on the bot, with an editor | `ally-be/src/bot-draft/checkup/`, `pages/AssistantHome/sections/CheckupCases.tsx` | "Save as a test" (step 3) writes a checkup case through the existing path. |

Not found, to check before you design: whether a first reply is ever served while pages are still being read, and whether the reader can publish partial results as it goes. Both decide how fast step 2 can be.

## 3. The screen

At **1280px wide and above**, one page, two halves, a draggable divider (presets 50:50, 40:60, test-only). Below that, the existing Chat / Canvas tabs, with a **Test** tab added.

```
┌──────────────────────── BUILD (50%) ──────────────┬──────────────────────── TEST (50%) ───────────────┐
│ one smart input: URL | files | a sentence         │ [Page ▾ channel] [Try as ▾ persona] [New chat]     │
│ builder chat + "tell me what to change"           │ the real bot, streaming, real runtime              │
│ "make it better" list, highest impact first       │ suggested questions from the content (chips)       │
│ settings in tabs (Basics, Knows, Tone, Safety…)   │ under each reply: Why this answer · Fix this ·     │
│ status: Draft saved · 3 changes since publish     │   Save as test                                     │
└───────────────────────────────────────────────────┴────────────────────────────────────────────────────┘
```

- **Before there is a bot**, the right half shows a quiet placeholder ("Your assistant will appear here"). The split does not change shape when the bot arrives.
- **The test pane is the real runtime** (the same code path as `/test/stream`), never an approximation. A test that behaves differently from production is not a test.
- Design it from `DESIGN.md` tokens and the existing `PhonePreview` and bot-page chat components. No new visual language.
- Accessible by keyboard: the divider moves with arrow keys; focus order is build, then test; the live region announces "Assistant updated".

## 4. The work, in build order

### Step 1 — The split and the hot-reload loop (about 1.5 days)
- A `SplitBuild` layout used by onboarding and the assistant home (one component, two hosts). It replaces the 380px right panel on wide screens.
- The test pane calls `/test/stream` with the **unsaved** field values as `dto.draft`, so the next message uses what the author just typed or dragged. No Save button for testing. Config still autosaves to the draft; debounce pushes to about 400ms; show changes as applied at once and roll back only on error.
- After a config change, show a one-line note in the chat ("Updated just now: tone is warmer") and an **"Ask the same question again"** control under the last reply. Keep the previous reply faded above the new one so tone and fact changes are easy to compare.
- A chat that started before a change is marked "older settings" until the next message.
- **Tests:** a change to tone changes the very next test reply's request body; a debounced burst sends one request; rollback on error; the split holds at 1280 and 1440; below 1280 it falls back to tabs. Playwright at 1440x900 and 1280x720, axe clean.

### Step 2 — One smart input and a starter bot in about 10 seconds (about 1.5 days)
- **One input box** for a URL, files or a sentence. Detect which it is; the four cards stay below as hints, not as a required choice.
- **A starter bot from the first few pages read** (target 3 to 5), applied with a template guess: purpose, tone, safety pack, greeting using the business name, brand colour. The bot is chattable at once; reading continues in the background and the bot's knowledge grows as pages land, with a small "learned 18 of up to 50 pages" line.
- **Suggested questions from the content** ("What are your fees?", "Can I book Saturday?") as chips in the test pane. Generate them with the reader's output, not a second crawl.
- Needs: the reader publishing partial results (check `ally-ai` and `ally-be/src/bot-draft/crawl/`), and the first-pages index being queryable before the rest is done. If either needs a large change, **stop and report**; ship step 1 and step 3 first.
- **Never store an error page as a fact** (Q3c B16 stays in force); a starter bot built from blocked pages says so in plain words.
- **Tests:** a saved fixture site reaches "chattable" before it finishes reading; a blocked site shows the honest message and no stored error text; the first reply never cites a page that was not read.

### Step 3 — Fix it from the chat itself (about 1 day)
Under each test reply, next to the existing "Why this answer?":
- **Fix this** opens a small choice: correct a fact, add a topic to avoid, change tone, add a missing page. It applies the change, then re-asks the question.
- **Add a fact** box under any "I don't know" reply: type the answer; it becomes an owner fact; the bot answers again.
- **Save as a test** writes the exchange as a checkup case through the existing path.
- The **unanswered questions** list updates live while the author tests.
- **Tests:** each choice writes the right field and the re-ask sees it; a saved test appears in the checkup list with the question and the expectation; nothing here can loosen the safety pack (the existing safety lock still wins).

### Step 4 — Test faster than typing (about 0.5 day)
- **Try as** (persona): new visitor, returning visitor with memory, a second reply language, an upset customer, a minor, someone in crisis. Each plays a short fixed script into the test pane. The crisis persona must show the real crisis reply with a real number, so the owner sees safety working.
- **Run 10 likely questions**: generated from the content, played as a batch with ✓ / ⚠ per answer, reviewed in one pass. Reuse the checkup runner; do not build a second grader.
- **Channel toggle** (bot page, WhatsApp-style bubble, widget) changes only how the same reply is drawn.

### Step 5 — Edit by talking, and the "make it better" list (about 0.5 day)
- A command line at the top of the build half: "make it shorter and never mention prices". It calls the builder's change flow and shows an applied before/after the author can **undo**. Anything that weakens safety is refused with the existing reason (`weakens_safety` in `change.py`).
- A **ranked "make it better" list** that updates itself while the author tests: contact details missing, questions it could not answer, tone not chosen, no list added, safety not reviewed. Each item completes in the build half while the test half shows the effect. All other settings sit under "More settings".

## 5. Boundaries (what must not change)

- **Safety is locked and visible.** The safety pack is on by default; the crisis check runs beside every test run as it does today; the builder cannot propose changes to the safety pack, documents, owner rules or access list (`BUILDER_PATHS`, ally-be's `DRAFT_PATHS`). The test override must not become a way around any of that.
- **Nothing publishes without a click.** Test chats store nothing but `lastTestedAt`, as now.
- **Keep v1 behaviour and the existing tests unchanged.** If an existing test fails, stop and report it.
- **No new dependencies without asking.** Pick the divider from what the repo already uses; write a small one if nothing fits.
- **No secrets, IPs or internal hostnames** in code, docs or the wiki.
- The wiki and the concepts card for Assistants are updated in the same PR (`python3 scripts/concepts_lint.py`).

## 6. Product and engineering judgement

Search the Context Library with `search_context` (several short queries; `get_chunks` on the one or two that bear on it) and cite the codes you apply, for: what a starter bot says when it only half-read the site; empty and failure states of the test pane; the wording of "Fix this", "Add a fact" and the persona names; what the crisis persona shows. Results are advisory. If the library is not connected, say so in the plan rather than guessing.

## 7. How we know it worked

Add timing events (names are suggestions; match the repo's analytics conventions) and report the numbers from a real site at stop 3:

| Measure | Target |
|---|---|
| Input submitted → first chattable bot | under 15 s median, under 30 s worst |
| Edit made → next reply uses it | under 2 s plus the model's reply time |
| Input submitted → shareable link | under 5 min median |
| Test messages sent before Share | reported, no target |
| Share of owners who add a fact or fix from the chat | reported, no target |

Also run the existing onboarding eval and the Q3 checkup suites before and after: answer quality must be **at least as good** as with the current onboarding flow.

## 8. Tests

- Unit tests for the split layout, the divider, the debounce and rollback, the persona scripts, and each "Fix this" choice.
- Backend tests for any widening of the test override, including that it cannot touch the safety pack, documents (beyond `documentIds` as now), owner rules or access.
- Playwright at 1440x900, 1280x720 and 390 (the tab fallback), axe clean, with screenshots at stop 2.
- The old onboarding path keeps passing, whether or not SB1 replaces it (see section 9).

## 9. Open questions to answer in the plan (stop 1)

1. **Replace or sit beside?** Does the split replace the onboarding sequence, or ship as an "express" path with the guided sequence kept? Recommended: express first, guided kept, switch by a flag, decide after the numbers.
2. **What does the test override cover?** List what `dto.draft` does not take today (lists, safety pack, owner rules, Never topics, brand). For each, decide: add to the override, or show "applies after you save" in the pane.
3. **Does the chatbot row exist from the first screen?** If it is created only after Design, when and how early can it be created, and what does an abandoned half-built bot leave behind?
4. **Partial reading.** Can the reader and the index serve a first answer before the crawl ends? If not, what is the smallest change, and is it worth it for step 2 or does step 2 wait?
5. **Where does the split live after onboarding?** Is the assistant home's Try it panel replaced by the same `SplitBuild`, or only the onboarding screen?
6. **Persona scripts.** Who writes and approves the scripts and the crisis wording? They are product copy and go to the copy deck (`ONBOARDING-COPY.md`) with tests holding the code to it.

## 10. Out of scope (write in the notes, don't build)

Visual flow editor and scripted step-by-step collection; webhooks, Zapier and calendar sync; weekly digests and topic clustering; A/B tests; template marketplace; custom domains; a second, separate "advanced" prompt editor.

## Done when

- [ ] Stops 1 to 3 passed, with the numbers in section 7
- [ ] On a laptop, a first-time owner can give a website, chat with a live bot, change tone and a fact, see the next reply change, and reach a share link, on one screen, without a Save button
- [ ] Hot reload, fix-from-chat, persona and batch tests, and edit-by-talking each work, with tests
- [ ] Safety unchanged and still locked; crisis persona shows the real reply
- [ ] Existing tests, lint and typecheck pass in every repo touched; concepts card and wiki updated; `docs-path-lint` clean
- [ ] `CHUNK-SB1-NOTES.md`: code map, decisions, how to test, open questions
