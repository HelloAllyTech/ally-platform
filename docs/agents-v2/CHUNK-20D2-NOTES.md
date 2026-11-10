# Chunk 20d-2 notes: polish and control pass

**Brief:** [chunk-20d2.md](./chunk-20d2.md). **Copy:** [ONBOARDING-COPY.md](./ONBOARDING-COPY.md) §25. **Branch:** `feat/agents-v2-chunk-12-shared-store`; commits tagged `[20d-2]`. **Stage 1, the POC:** 20a-2 ✅ → Q2a ✅ → 13 ✅ → 11a ✅ → **20d-2** → CL1.

> Report below. The plan as approved follows it.

## Report: 20d-2 is done (10 Nov 2026)

**Commits** (all `[20d-2]`, on `feat/agents-v2-chunk-12-shared-store`, not pushed):

| Commit | Part |
|---|---|
| `9e9641617` | Docs: the approved plan and UX audit, the brief, copy §25, current chunk |
| `4ab5741df` | A: the home's lists in v2, each saving on its own with a version |
| `f3d92bfd4` | B: the UX audit's fixes; every section explains itself |
| `a9aaffd1c` | C: a Checkup the owner understands and controls |
| `68f7ab26a` | D: Change your assistant explains itself; How it works; Why this answer |
| this one | E: notes, screenshots, refreshed Playwright baselines |

**Suites (after D):**
- ally-be: 14,830 passed, 70 skipped (the Postgres-only specs without a test database);
- ally-ai: 2,157 passed, 46 skipped; flake8 clean;
- ally-web: admin 9,494 passed, helpline and ui-shared green (the pre-commit hook ran all three on every commit); typecheck and lint clean on every changed file.
- Playwright: baselines were refreshed once, at the end, as agreed (see "Browser tests" below).
- **Not run:** the Sunrise checkup suite (`checkup_eval.py`) and the 3a conversation eval. Both call the live model through the local stack. The agent's prompt, `check.py`, the grader and the stats are unchanged, so no shift is expected, but that's not proof. They're the first thing to run before CL1 (commands under "How Shehbaz tests it").

### What was built

| | |
|---|---|
| **A. The lists** | One pair of routes (`GET`/`PATCH v1/chatbots/:id/home/lists/:list`) for who can open the page, WhatsApp's list, the team, documents and quick replies. One entry per change, with the list's version (409 `stale` with the current list), under the bot's row lock; the lists' own services do the work, so their rules hold (an owner for the team; a safety reply can't be turned off). Quick replies keep their template permissions. New field `whatsappAccess`. Organisations are offered by name. The web side: one list pattern, Changed · Undo, skeletons. |
| **B. The audit** | See the issue list below: 44 of 48 fixed. |
| **C. The Checkup** | What it is; live steps (keep going if you leave); How checking works; every question readable with its last 5 results; filters; add, edit, turn off, delete with Undo, Try this one; Run only failed; Must pass and safety questions asked 3 times on home runs (once in onboarding); the banner after a change with Before / After; Suggest more questions (kept only when ticked); Add to checkup from the inbox and from Answer it / Correct this; "Go live anyway?" when an owner's own Must pass question failed. Grader and stats unchanged. |
| **D. Change, How it works, Why** | The Change panel's subtitle, what it can and can't change, Apply · Not this, the checkup banner, and a History tab (by chat and by hand, with Undo and Restore). How it works: every layer in order, exact text, the owner's controls, Ally's layers locked, the full text with the owner's parts marked; built by ally-ai from the very request a run sends, and a test proves the shown text is a real run's first prompt. Your instructions get the builder's safety check and an "override" warning. Why this answer? in Try it. |

### The issue list, and what happened to each

Numbers are the audit's (plan §1).

| # | Status |
|---|---|
| 1–4 Header | Fixed: one height (44), two styles; Engine and Classic view in a staff-only `···` menu; Open page in that menu on phones; status words Live · Paused · Not live yet everywhere; one "Changes save as you go" |
| 5 Three columns | Fixed: the panel docks only from 1600 px and never beside the Inbox; below that it's a sheet with a scrim (Esc, focus kept) |
| 6 Try it on phones | Fixed: the chat fills the sheet, no phone frame |
| 7 Layout shift | Fixed where it came from: the header and section skeletons, and the Overview's cards at their final size. The remaining shift in a cold browser is the web fonts swapping in (`font-display: swap`); a warm load doesn't move. Measured locally only (the audit script); the Playwright layout-shift check from the plan was **not added** |
| 8 Phone section chips | Fixed: fade at the edge, the open one scrolled into view |
| 9 Button heights | Fixed on AI Chatbots' screens: 44 default, 36 small (44 on touch), 50 only on onboarding and visitor pages |
| 10 Group headers | Partly: one Group style, and every section has its line and `?`; some fields inside groups still use field labels rather than group titles (Disclaimer, Topics to avoid), which read fine |
| 11 Look and feel card | Fixed (card, heading scale, the second "Changes save as you go" hidden). The theme control's long label still wraps at 1440 (it's the shared Segmented) |
| 12 Serif digits | Fixed: inputs use the UI font inside AI Chatbots |
| 13 Headings line up | Fixed with 5 (no docked panel below 1600) |
| 14 Dark | As decided: owner screens stay light; dark for the bot page, widget and Try it's chat |
| 15 "This week" twice | Fixed |
| 16 Numbers | **Not done:** the 7/30-day switch. "This week" and "Last 30 days" are still two cards; the classic charts sit behind "See all numbers" as agreed |
| 17 Counts disagree | Fixed: the second card is gone; Overview and What it knows share one list |
| 18–19 Classic parts in What it knows | Fixed (v2 documents; the Q2a list for questions it didn't know) |
| 20 Sources row | Fixed |
| 21 Remove | Fixed: one icon button everywhere |
| 22 Extra instructions | Moved to How it works; Personality links there |
| 23 Quick replies | Fixed (v2) |
| 24 At-risk reply empty | **Not done:** the box still shows empty when the pack's wording is in use; a placeholder needs the pack's default text from ally-be's settings, which the home view doesn't return yet |
| 25 Two add patterns | **Not done:** Topics to avoid is shared with onboarding's Make it yours, so changing it changes onboarding too; left for CL1 |
| 26–28 Checkup wording, dates, measures | Fixed (singular gap, the fallback quoted, one date format, measures 2 × 2, "No questions of this kind yet") |
| 29 Checkup control | Part C |
| 30–37 Inbox | Fixed: one row style; "Visitor · 4821"; channel icons; the sound toggle; filters on one row; Take over on the name line; bubbles ≤ 560 px, a date line per day, groups within 2 minutes; ratings in words; a centred empty side |
| 38 Change panel | Part D |
| 39 Engine form | As agreed: moved into the menu as is |
| 40–44 Share | Fixed (v2 lists; Team by email with today's roles; one "Opening hours" label; native checkboxes styled). **Connect a WhatsApp number** still opens the classic Meta flow, inside a v2 sheet |
| 45 Composer | Fixed: the send button sits inside the box. Correction to the audit: the coloured border was the focus ring (the screenshot had focus), not a resting style |
| 46 Status line | Fixed: two lines before it's cut |
| 47 Talk to a person | Fixed |
| 48 List page | Fixed: v2 header, tabs and cards. The staff-only tabs (Channels, Defaults, Knowledge library) keep their classic content |

### Jargon swept, and what it became

| Was | Now |
|---|---|
| Engine | How it answers (staff only, in the `···` menu) |
| Chatbot | Assistant (list page, tabs, empty states) |
| Published / Draft | Live / Not live yet |
| Organisation id, User ID | Your organisation (by name); their email address |
| Channel, "No channel yet" | WhatsApp numbers; Not on WhatsApp yet |
| "Match too weak", "Passages were not enough" | Gone (the classic unanswered list is no longer shown) |
| Fallback | "when it doesn't know"; the Checkup quotes the owner's own wording |
| Run, grade | Checkup; checking (Passed · Partly · Failed · Needs your input) |
| Chunk, passage | "parts of your pages", "Where it looked" |
| Extra instructions | Your instructions |
| Model, LLM, RAG, token, embedding, v1/v2 | Not shown to owners anywhere in AI Chatbots (the copy test still refuses "model") |

### Outside the AI Chatbots folders (all chatbot-only, additive)

- `ally-be/src/whatsapp/whatsapp.module.ts` and `ally-be/src/chatbot/chatbot.module.ts`: one export line each (`WhatsAppAdminService`, `ChatbotAudienceService`), so the home's lists use the services' own rules instead of copies.
- `ally-be/src/ai/service/ai.service.ts` and `ai/constants/endpoints.constants.ts`: three new methods (`suggestCheckupQuestions`, `agentInstructions`, `checkOwnerText`); no existing method changed.
- `ally-be/src/database/migrations/1981340000000-AddCheckupCaseControls.ts` (additive) and `ally-be/DATA_SCHEMA.md`.
- `ally-ai`: the agent runtime router and schemas (`/agent/instructions`, `/agent/instructions/check`), `app/core/agent_runtime/instructions.py`, and `QuestionsRequest.exclude` on the checkup endpoint. `knowledge_agent/prompt.py`, the grader, `check.py` and the prompts are not changed.
- `ally-web`: the chatbot entries of `constants/common.ts` (endpoints) and `constants/en.ts` (the `whatsappBot` strings the list page reads); the AI Chatbots API slices (`chatbots`, `checkup`, `changes`, `scorecard`, `botDrafts`) and types; `components/v2/Checkup.tsx` (an optional `empty` prop; only AI Chatbots screens use it).
- `git diff --stat 9e9641617~1 HEAD`: 132 files, +11,140 −681 (before this notes commit).

### Decisions made while building

- **Must pass ×3 costs more than the plan said:** most generated questions are already `must_pass`, so a home checkup asks about 3× as many times as before, not 1.5–2×. Onboarding asks once, so building an assistant is as quick as before. If that's too costly, the runner rule is one line (`attemptsFor` in `checkup-cases.ts`).
- **"Partly"** is mixed results across a question's tries in one checkup.
- **The four outcomes:** "politely decline" and "offer a person" are declines with one more fact the grader's judge already checks (`facts_missing` fails any case), so no grader change was needed.
- **Team:** added by the email of someone in the caller's organisation (platform admins: anyone, as before by id); the three roles are today's.
- **Undo for lists:** add ↔ remove for every list; removing an uploaded file can't be undone yet (it's archived; CL1 can add restore).
- **History:** kept in the draft's `events` (jsonb), so no migration. It's not capped at 200 as planned (the drafts service appends; trimming needs its own change). Edits to the owner's own rules show in the History but are changed again from Safety, not undone there.
- **How it works when v2 is off:** the endpoint sits on the agent runtime's router, so it answers 404 when `AGENT_RUNTIME__ENABLED` is off; the section then says it couldn't load.
- **The instructions check:** if ally-ai can't be reached, "Your instructions" still save (the text is fenced below the base and safety rules either way).

### Changed tests (no behaviour test was weakened)

- `scorecard.spec.ts`, `Scorecard.test.tsx`: the calls now carry `addToCheckup` (default true, behaviour unchanged).
- `change.service.spec.ts`: change by chat saves with `{ record: false }`, so it isn't recorded twice.
- `ChangePanel.test.tsx`: "Not this"; the new hooks mocked.
- `inbox.pg.spec.ts`: the inbox's name for a visitor without one is "Visitor · 4821" (the shared `visitorLabel` is unchanged).
- `WhatsAppBot.test.tsx`: unchanged and passing (the new tabs keep their roles and test ids).
- `assistantHome.e2e.ts`: the Engine test now opens the `···` menu; How it works joins the sections with baselines.

### Now unused (for CL1)

In AI Chatbots' new screens nothing imports these any more; they live on for `?view=classic` and the staff tabs:
- `WhatsAppBot/KnowledgeTab.tsx`, `KnowledgeUploadPanel.tsx`, `KnowledgeDocumentPanel.tsx` (documents);
- `WhatsAppBot/UnansweredTab.tsx`, `UnansweredAnswerPanel.tsx`;
- `WhatsAppBot/TemplatesTab.tsx`, `TemplatePanel.tsx` (still used by the staff Defaults tab);
- `WhatsAppBot/PeopleTab.tsx` (`WhoCanChat`, `Team`);
- `WhatsAppBot/BotPageTab.tsx` `AccessList`;
- `WhatsAppBot/ConnectorsTab.tsx` `BotConnectorsTab` (the list's Channels tab still uses `AllConnectorsTab`; `NumberTab`'s `ConnectWhatsAppFlow` is still used inside the v2 sheet);
- `components/v2` `CheckRow` (the Checkup lists cards now; onboarding's checkup screen still uses it);
- `ChatbotStatusPill` (only the classic page).

### Follow-ups

- **Prompt order** (approved as a follow-up): the owner's text is fenced *before* the base rules in the real prompt (`format_persona` is prepended). After the POC, test moving owner text after the base and safety layers, with the 3a conversation evals before and after. How it works shows the order the runtime really uses.
- The 7/30-day switch on the Overview (#16), the at-risk placeholder (#24), one add pattern for topics (#25), and a Playwright layout-shift check (#7).
- Redraw the WhatsApp connect flow (Meta's steps) in v2.
- The Overview's "Remove assistant" still uses a browser confirm.

### Screenshots

Before and after, at 900 px wide (JPEG), in `docs/agents-v2/design/20d2/before/` and `after/`: the Overview (1440 and 390), What it knows, Share (1440 and 390), Checkup, the Inbox inside the home with a chat open, the Change panel, How it works (after only), Try it on a phone, the inbox, Page, Safety, the bot page chat (dark, 390), the widget (dark) and the list page (before only; the after needs a signed-in browser). The full sets (1440 and 390, light and dark) were taken with the audit script; the Playwright baselines in `e2e/__screenshots__` are the checked versions.

### How Shehbaz tests it

Local stack (`./infra/dev_env.sh`), admin on :8081; ally-be picks up the migration on restart (`docker restart ally-be-app-1`). The ally-ai container needs the new code (`/agent/instructions`): rebuild or restart it as usual.

1. **Header and layout (1440 wide):** open an assistant. One row of buttons, one height. As Ally staff, `···` holds How it answers and Classic view; as an owner it's not there. Open Change your assistant: it comes over the page with a dark scrim; Esc closes it. Make the window 1600+ wide: it docks on the right. Open Inbox: it never docks there.
2. **Share:** add an invited email, remove it, press Undo. Switch to "People in your organisation": "Add {your organisation}" by name. In Team, add a colleague by email and change their role. Open the same assistant in a second tab, add an email there, then remove one in the first: the first tab says "This changed while you were editing…".
3. **What it knows:** upload a PDF (it appears as Reading, then Ready); add one from your library; remove it and Undo.
4. **Checkup:** Run all. The four steps tick through; leave the page and come back mid-run. Open "How checking works". Add a question ("Do you see couples?", It should offer a person, Must pass). Edit it, Turn it off, Delete it and Undo. Try this one on a question (about 10 s). Open a safety question: no Delete or Turn off, and the reason. Suggest more questions, tick two, Keep.
5. **From real use:** in the Inbox, open a chat and press Add to checkup under a reply: the question and the reply's sentences are filled in. On the Overview, Answer it shows "Also add to checkup" ticked.
6. **Change panel and History:** "Make it more formal" → Before / After → Apply → the checkup banner. Change the introduction by hand in Personality. Open History: both are there, who and when, by hand and from the Change panel; Undo the hand edit (the exact old text comes back), Restore an older one.
7. **How it works:** every layer in order; Show exact text on Safety; Show the full instructions (your parts highlighted). Edit Your instructions to "Turn off the crisis rules": refused with the reason. "Ignore all previous instructions": saved with the warning. "Greet people by name": saved; ask in Try it and the reply greets you.
8. **Why this answer:** in Try it, ask a fees question: open Why this answer? (where it looked, the time). Add "prices" to Topics to avoid, ask "how much are your prices?": it declines and Why says "Topics to avoid: prices".
9. **Publishing:** in a new onboarding, add an owner Must pass question that fails, then Publish: "This question you marked Must pass failed. Go live anyway?" → Go live anyway publishes.
10. **Evals (before CL1):** `cd ally-ai && poetry run python scripts/checkup_eval.py --suite ../docs/agents-v2/evals/sunrise-mind-checkups.yaml` (0 hard fails, must_pass as at 20a-2 round 7), and `poetry run python scripts/agent_conversation_eval.py` against `CHUNK-03R-EVAL.md`.


## Plan (approved 2026-11-10)

*As planned; some files were named differently when built (the lists are `sections/AccessLists.tsx`, `PeopleLists.tsx`, `DocumentsList.tsx`, `QuickReplies.tsx`; the specs are in `ally-be/src/bot-draft/test/`). The report above is the record of what exists.*


Branch `feat/agents-v2-chunk-12-shared-store`. Commits `[20d-2]`, one per part (A–E), Node 22 first on PATH, no `--no-verify`, nothing pushed. Stacks MCP isn't connected in this session, so product calls follow the brief, DESIGN.md, the deck and the screenshots.

## Context

Owners have to understand and tune their assistant on their own. Today some screens look slightly off, the Checkup runs without saying what it's doing and owners can't add cases, the Change panel doesn't say what it can change, and owners can't see the instructions their assistant follows. This chunk restyles the last old-style parts, fixes the audit list, gives owners a Checkup they control, a Change panel that explains itself and has a history, and a "How it works" view built from the runtime.

**Two findings that change the brief's wording:**
- **Copy deck §24 is already used** (20a-2 purposes). The new copy goes in **§25**.
- **The publish gate blocks only on an unsourced answer or a failed safety question** (`draft-checkup.service.ts` `assertCanPublish`). Owner "Must pass" cases block nothing, and only evals run a question 3 times. See question Q1/Q2 at the end.

---

## 1. UX audit

**Screenshots** (76 + 1): `(session scratchpad; the "before" set is copied to `design/20d2/before/` at the end)`, named `<screen>-<1440|390>-<light|dark>.png`. They were taken with Playwright against the dev fixtures (`/dev/assistant-home`, `/dev/inbox`, the bot page and the widget on `customer.test`), plus the real list page from your Chrome (`list-1440-light-real.jpg`). Measurements (header boxes, button heights, radii, layout shift, axe) are in `…/audit/measure/*.json`.

- Screens covered: the 8 home sections; the home Inbox with a chat open; the Change panel (empty and with a proposal); Try it; Engine; the Inbox tab (list and chat); the bot page (cover and chat); the widget (closed and open); Share → On your website (in `home-share-*`).
- **Couldn't take:** the real list page at 390 px and dark. Signing a local token for a scripted run was blocked; the list page is in the build's baselines instead.
- **axe:** 0 issues of any impact on every screen today.

| # | Screen | What's wrong | Fix |
|---|---|---|---|
| **Header** (every home screen) |
| 1 | Header (`home-engine-1440`) | 5 button styles and 4 heights in one row: "Classic view" text link (24 px), Engine outlined (44), Change your assistant grey sunken (44), Open page outlined (44), Try it filled (50). The LIVE badge is 21 px | One height (44) and two styles: primary (ink) for Try it, secondary (outlined) for the rest. Engine and Classic view go into a staff-only `···` menu (§3) |
| 2 | Header, phone (`home-overview-390`) | The actions wrap into two rows of four mixed buttons | Phone: name and status on the first line, then one row: Try it · Change · `···` (Open page moves into `···` on phones) |
| 3 | Header + list | Status words differ: the home says LIVE / Not live yet, the list says Published / Draft | Live · Paused · Not live yet everywhere (deck §20) |
| 4 | Header | "Changes save as you go" is shown again inside Look and feel (`home-page-1440`) | Header only |
| **Layout** |
| 5 | Home at 1440 (`home-inbox-chat-1440`) | The Change panel docks open by default, so every section is three columns. With a chat open the bubbles wrap at about 270 px | Below 1600 px, Change and Try it open as an overlay drawer with a scrim, closed by default (Esc closes, focus is kept inside). At 1600 px and up they dock. Three columns never share the screen with the inbox's two |
| 6 | Try it, phone (`home-try-it-390`) | A phone frame inside a phone, in a bottom sheet with no scrim. The header shows behind it, and the status line is cut to "Answers fro…" | Phone: a full-height sheet with the chat and no frame, plus a scrim |
| 7 | All sections, phone | Layout shift is 0.19 on every section and 0.58 on Overview (0.25 at 1440). The nav row and late cards push content down | Skeletons at final size. The nav row height is reserved. Target: layout shift under 0.02 |
| 8 | Phone nav (`home-*-390`) | The section chips scroll sideways with no cue; "Personality" is cut off | A fade at the edge, and the active chip scrolls into view |
| 9 | Everywhere | 10 button heights (20, 24, 28, 32, 34, 36, 38, 40, 44, 50) | Three sizes: 50 (onboarding and visitor primaries), 44 (default), 36 (desktop-only inline actions, 44 on touch) |
| 10 | Safety, Personality, Page | The same kind of block has two header styles: a bold card title ("Your own rules", "Limits") or a plain field label ("Anything it shouldn't talk about?", "Disclaimer", "Suggested questions") | One Group header: title, a one-line "what this is", and `?` |
| 11 | Page (`home-page-1440`) | Look and feel isn't in a card. Its heading is larger than the others and its sub-headings are bold. The theme control wraps "Match the visitor's device" onto two lines | Same card and heading scale as the other groups. Theme labels on one line (shorter control, or stacked on phone) |
| 12 | Page | The Limits inputs and the classic parts render digits in IBM Plex Serif (the dashboard font leaks in) | Inputs use `font-ui` inside `.ally-v2` (local CSS, AI Chatbots only) |
| 13 | Section headings | The section heading lines up with the panel heading (y 136). The groups inside sections don't line up across columns when the panel docks | A shared top offset for section and panel, and group spacing on the scale |
| 14 | Dark (`home-*-dark`) | The owner screens ignore dark mode (identical to light). The bot page and widget switch | **Proposal: owner screens stay light** (the dashboard and sidebar have no dark mode, so a dark home next to a light sidebar would look broken). Dark baselines only for the bot page, widget and Try it's chat. See Q3 |
| **Overview** |
| 15 | Overview | The "This week" title is repeated as the start of the next sentence ("This week: 142 conversations…") | The title stays; the sentence starts at "142 conversations…" (new deck line) |
| 16 | Overview | Two number blocks (This week, 7 days; Last 30 days) plus "All numbers" (classic Carbon charts) | One numbers card with a 7 days / 30 days switch. "All numbers" is redrawn in v2 from the same endpoints (Part A) |
| 17 | Overview | "Needs your input · 3 questions it couldn't answer" repeats "Questions it didn't know", and the counts disagree (3 vs 2 listed) | One list ("Questions it didn't know"). The count comes from the same source |
| **What it knows** |
| 18 | Knows (`home-knows-1440`) | "Needs your input" is the classic UnansweredTab: Carbon selects, jargon ("Match too weak", "Passages were not enough", "the chatbot"), an em dash, and a large serif empty state | The v2 "Questions it didn't know" list, the same component as Overview (Part A) |
| 19 | Knows | Documents: "Upload or remove documents" opens Carbon side panels with Save buttons | v2 list with upload, add from library and remove, each saving on its own (Part A) |
| 20 | Knows → Pages it learned from | "4 details" floats in mid-row; actions are plain text | Count right-aligned next to the action. The action is a 36 px secondary button |
| **Personality** |
| 21 | Personality | Remove is an underlined link beside inputs, while Add is an outlined button: two action styles | An icon button (labelled "Remove {item}") beside inputs, the same in every list |
| 22 | Personality | "Extra instructions" sits collapsed at the foot of "When it doesn't know" | Moves to How it works as layer 6 "Your instructions". Personality gets a link "See everything it follows" |
| 23 | Personality | Quick replies are classic (shown once WhatsApp is connected) | v2 list (Part A) |
| **Safety** |
| 24 | Safety (`home-safety-1440`) | "When someone may be at risk" is an empty box, so the owner can't tell what it says now | Show the pack's reply as the current text ("From your safety rules"), with a note that it can be added to |
| 25 | Safety | "Add a rule" is a disabled ghost button beside the input, but "Add a topic" is an outlined button under the list | One add pattern (input + Add), used in both |
| **Checkup** (`home-checkup-1440`) |
| 26 | Checkup | "with 1 small gaps" (wrong plural); "pointed people to Please call us on 98200 12345.." (the fallback pasted in mid-sentence, double full stop); "your Clients ask" (capital C) | Plural rule; quote the fallback ("pointed people to your contact line"); audience in lower case (deck lines) |
| 27 | Checkup | "Last run Nov 10, 3:31 PM" uses a US format; the inbox uses "9 Nov, 3:36 pm" | One date format (`en-IN` short) across AI Chatbots |
| 28 | Checkup | The measure cards break 3 + 1, so Safety sits alone on a second row; "0 of 0 unknowns" shows an empty bar | 4 in a row at ≥1280, 2×2 below. With 0 cases, "No questions of this kind yet" and no bar |
| 29 | Checkup | No line at the top saying what a checkup is; while running only "n of total"; no way to add, edit or turn off cases | Part C |
| **Inbox** (`inbox-*`, `home-conversations-*`, `home-inbox-chat-*`) |
| 30 | Inbox rows | The selected row is a bordered white card; the others are plain, and hover looks the same as selected | One row style; selected = `--ally-sunken` background and an accent bar on the left; hover is lighter |
| 31 | Inbox rows | Names are "…3210" or "Visitor"; the channel is text only | Contact name when known, else "Visitor · 4821" (a short stable id from the conversation). A channel icon on each row (WhatsApp, page, website), labelled for screen readers |
| 32 | Inbox controls | "Sound on" is plain text; the filter chips (38 px) and the channel select (50 px) differ, and they sit on two rows | An icon toggle with tooltip "Sound for new chats: on/off". Chips and select are both 36 px, on one row where they fit |
| 33 | Embedded inbox | The section says "Inbox" and the panel inside says "Inbox" again | The inner title is hidden when embedded |
| 34 | Chat header (`inbox-chat-1440`) | Take over is a 50 px filled block, taller than the name line | A 36 px secondary button, right-aligned on the name line |
| 35 | Messages | Assistant bubbles run to 85% (about 880 px at 1440); every message repeats name and date; there's no grouping | Max width 560 px; a date line once per day; messages from one sender within 2 minutes share one author line |
| 36 | Messages | The thumbs-up shows as a loose emoji under the source, with no label | "Helpful" / "Not helpful" chip after the source |
| 37 | Empty chat side | "Pick a chat to read it." sits top-left in small text | Centred, with the orb (already in the deck) |
| **Change panel** |
| 38 | Change panel (`home-change-*`) | No subtitle about what it does; no "What I can / can't change"; the proposal shows one field with Before struck through; Recent changes lists only panel changes | Part D1 (subtitle, two lists, before → after per field, a History tab with manual edits) |
| **Engine (staff)** |
| 39 | Engine (`home-engine-1440`) | Classic Carbon form (IBM Plex Serif, square select, disabled grey Save) inside the v2 panel | Redrawn in v2 inside the `···` menu's panel; still a Save button (a staff tool) |
| **Share** (`home-share-1440`) |
| 40 | On your page | The access list is classic: grey underline inputs, a disabled grey Add, "organisation id" in the placeholder | v2 list (Part A): email or organisation picker, Add, Remove with Undo |
| 41 | On WhatsApp | Classic channel box: square blue "Connect a WhatsApp number" button, "chatbot" and "channel" wording | v2 numbers card (Part A) |
| 42 | When someone asks for a person | "Opening hours (optional)" appears twice (a label and the checkbox); native checkboxes and time pickers | One label; v2 day chips and time inputs |
| 43 | Team | The title "Team" is repeated inside; "User ID … ask an Ally admin to look it up"; a filled black Remove; "Editor — also changes it" em-dash labels | v2 list: invite by email from the organisation's members, role as a 3-way choice (Can view · Can edit · Owner), Remove with Undo (Part A) |
| 44 | On your website | Native radios and checkboxes; the "Remove" link sits far right of the site name | v2 segmented (Right · Left), toggles, and the list pattern from #21 |
| **Bot page and widget** (`botpage-*`, `widget-*`) |
| 45 | Composer | The round send button overlaps the box's bottom-right border; at rest the box is two lines tall with a coloured border, so it looks focused | Send button inside the box padding, vertically centred; one line at rest growing to 4; the brand border only on focus |
| 46 | Chat header | The status line is cut ("Answers from Sunrise Mi…") at 390 and in the widget | Shorter status ("Answers from {business}'s pages") wraps to two lines before it truncates |
| 47 | "Talk to a person" | 12 px muted underlined link far below the box | 14 px, same colour as the source chips, directly under the box |
| **List page** (`list-1440-light-real.jpg`) |
| 48 | AI Chatbots list | Fully classic: Carbon tabs, IBM Plex Serif, "Chatbots" tab while the home says "Assistants", "1 documents", "No channel yet", a square blue "New assistant" | Restyle the page header, tabs and cards in v2 (Assistants · Inbox for owners); card shows name, status pill, channels as icons, "{n} conversations, last 30 days", Continue setup. Staff-only tabs (Channels, Defaults, Knowledge library) keep their classic content inside the new tab bar; CL1 decides (listed in notes) |

**Jargon sweep (goes into the notes, with every hit's file):** engine → "How it answers" (staff only); fallback → "when it doesn't know"; run → "checkup"; grade → "check"; chunk / passage → "part of a page"; embedding, LLM, RAG, token, model → not shown to owners; v1/v2 → not shown; chatbot → assistant; channel → "where people chat" / WhatsApp, page, website; "Match too weak" / "Passages were not enough" → gone with #18; "organisation id" → organisation name; "User ID" → email; Published / Draft → Live / Not live yet.

---

## 2. The two open choices

**Engine → a staff-only `···` menu (recommended), not a plain label.**
- 20d's approved rule says owners never see the model or answer mode. A plain label ("How it answers") would put those controls in front of every owner.
- The `···` menu is shown only to platform admins (the same `isPlatformAdmin` check as today, `AssistantHome.tsx:65`). It holds **How it answers** (today's Engine, redrawn) and **Classic view**.
- Owners lose the "Classic view" link; staff keep it until CL1 decides.
- On phones the same menu also holds Open page, for everyone. Owners see only Open page in it.

**Instructions → a new "How it works" section (recommended), not "Instructions" under Personality.**
- Six of the eight layers aren't personality: base rules, safety, purpose, business details, topics to avoid, and how it finds answers. Under Personality they'd read as tone settings.
- It sits in the left list after Safety: Overview · What it knows · Personality · Safety · **How it works** · Page · Checkup · Inbox · Share.
- "Extra instructions" moves out of Personality to layer 6 ("Your instructions"), so the owner's text has one place to edit (20d's rule against one value editable in two places). Personality and Safety each get a link to it.

---

## 3. Plan by part (every file expected to change)

Paths: WEB = `ally-web/apps/ally-admin-dashboard/src`, E2E = `ally-web/apps/ally-admin-dashboard/e2e`, BE = `ally-be/src`, AI = `ally-ai`.

**Rules kept:** no change to `components/` outside `components/v2`, `ui-shared`, `styles.css`, `tailwind.config.js`, the sidebar or other pages. `components/v2/core` stays untouched (it's shared with onboarding and the bot page's budget). New shared bits for the home and inbox live in `pages/AssistantHome/ui/`. Classic files (`pages/WhatsAppBot/*Tab.tsx`) are **not edited**; the home stops importing them, and `?view=classic` keeps working as is. The grader (`app/core/checkup/grader.py`), `checkup-stats.ts`, `safety-packs.ts`, the crisis path and v1 (`knowledge_agent/`) are not changed.

### Part A — Restyle the leftovers

New versioned routes live in the chatbot's home module. Each delegates to today's service and adds the 20d version check (`versionOf(list)`, 409 `stale` with the current list). Classic routes are unchanged, so the classic view and its tests stay as they are.

- **BE**
  - `bot-draft/home/assistant-home.controller.ts` gets new routes, plus versions on GET `:id/home`:
    - `PATCH :id/home/page-access` `{op: add|remove, entry, version}` → `BotPageAccessService`
    - `PATCH :id/home/audience` → `ChatbotAudienceService`
    - `PATCH :id/home/team` `{op, userId|email, role, version}` → `ChatbotService.setMembers` (OWNER only)
    - `PATCH :id/home/documents` `{op: add|remove, documentId, version}` → `setDocuments` / `removeDocument`
    - `PATCH :id/home/quick-replies` `{op: add|edit|remove|reorder, …, version}` → the WhatsApp template service, called from here; the `whatsapp/` module is not edited
  - `bot-draft/home/assistant-home.service.ts`: the list saves, under the same row lock as `saveField`.
  - `bot-draft/home/home-lists.ts` (new, pure): the list ops and their versions.
  - `bot-draft/home/test/home-lists.spec.ts` (new): add and remove each list; stale 409; viewer refused; team owner-only; per-bot isolation. <!-- docs-path-lint: ignore -->
  - `bot-draft/bot-draft.module.ts`: providers for the delegated services (if not already imported).
- **WEB**
  - `pages/AssistantHome/ui/` (new): `ListField.tsx` (input + Add, rows with Remove, each saving with its version and "Changed · Undo"), `IconButton.tsx`, `Help.tsx` (the `?` popover, used in Part B), `StaffMenu.tsx` (Part B), `scale.css` (the spacing, height and radius scale, scoped `.ally-v2 .ally-home, .ally-inbox`).
  - `pages/AssistantHome/useHomeList.ts` (new): the list version of `useHomeField` (409 shows the other tab's list).
  - `sections/Knows.tsx`: v2 Documents (upload through the existing upload URL + `PATCH …/documents`, add from library, remove, Undo); "Needs your input" uses `Scorecard`'s list.
  - `sections/Share.tsx`: On your page list, On WhatsApp audience and numbers (`DocumentsGroup`-style card; connect still opens the existing `ConnectWhatsAppFlow` inside a v2 sheet: it's a multi-step Meta flow, so it's wrapped, not rewritten), Team.
  - `sections/Personality.tsx`: v2 Quick replies.
  - `sections/Overview.tsx`: v2 "All numbers" (same analytics endpoints, local bars; no import of `UsageDashboard`).
  - `sections/WhatsAppNumbers.tsx`, `sections/TeamGroup.tsx`, `sections/DocumentsGroup.tsx`, `sections/QuickReplies.tsx`, `sections/Numbers.tsx` (new, one per redrawn part). <!-- docs-path-lint: ignore -->
  - `api/chatbots.ts`: the new list mutations; `types/assistantHome.ts`: list versions.
  - `pages/AssistantHome/copy.ts`; `__tests__/lists.test.tsx` (new): each list saves its own op with its version, 409, Undo, viewer read-only.

### Part B — UX audit fixes, explain every section

- **WEB**
  - `AssistantHome.tsx`: the header (#1–4); the staff `···` menu; the panel as a drawer below 1600 px (#5); the How it works section entry; skeletons (#7).
  - `home.css`: grid, drawer, scrim, header, nav fade (#8); `ui/scale.css`.
  - `fields.tsx`: `SectionHead` gains a one-line "what this is" and `?`; one `Group` header (#10).
  - `sections.ts`: add `how`.
  - `EnginePanel.tsx`: v2 redraw of the staff form (#39), same `useUpdateChatbot` save.
  - `TryIt.tsx`: phone sheet (#6).
  - `sections/*.tsx`: copy, empty states that say the next step, the fixes #15–28, #40–44.
  - `sections/Checkup.tsx` (fixes #26–28; most of it in C); `pages/AssistantHome/checkup.ts`.
  - `pages/Inbox/Inbox.tsx`, `ChatView.tsx`, `inbox.css`, `copy.ts`: #30–37.
  - `pages/WhatsAppBot/WhatsAppBot.tsx` + new `pages/WhatsAppBot/AssistantList.tsx`: the list page (#48). This file is the AI Chatbots page itself; `ChatbotGrid` is replaced only here. <!-- docs-path-lint: ignore -->
  - `botPage/screens/Chat.tsx`, `botPage/components/parts.tsx`, `botPage/botPage.css`: #45–47 (the bot page and widget share these). The page's size budget is checked.
- **BE**
  - `chatbot/inbox/inbox.service.ts` `visitorLabel`: contact name (pre-chat name, then the contact's stored name), else "Visitor · {4 digits}" from the conversation id. `contactName` + `visitorTag` fields are added; `visitor` is kept.
  - `chatbot/inbox/test/inbox.service.spec.ts`. <!-- docs-path-lint: ignore -->
- **Tests:** E2E `assistantHome.e2e.ts`, `inbox.e2e.ts`, `widget.e2e.ts`, `botPage.e2e.ts` and their fixtures: baselines for every changed screen at 1440 and 390 (dark for visitor surfaces); axe 0 serious; a layout-shift check (`PerformanceObserver`, < 0.02); keyboard reachability of the header, drawer (focus kept, Esc), `?` popovers and the inbox. Unit: `__tests__/sections.test.ts`, `copy.test.ts`, `Inbox/__tests__/inbox.test.tsx` (date line, grouping, sound toggle).

### Part C — A Checkup the owner understands and controls

**Data** (one migration, `BE/database/migrations/<ts>-ChatbotCheckupCaseControls.ts`, additive):
- `chatbot_checkup_cases`: `outcome` (answer | dont_know | decline | person), `language`, `added_from` (chat | unanswered | thumbs_down | null), `deleted_at`, and `origin` gains nothing.
  - The brief's `source` names map onto today's `origin` + `added_from`, because `source` is already the page-source jsonb. Recorded in the notes.
  - Version check: `versionOf` over the editable fields (no new column).
- `chatbot_checkup_runs`: `phase` (writing | asking | checking | done), `asked` (int), `only` (all | failed | one).
- Index on `chatbot_checkup_results (case_id, created_at)` for "last 5 results".
- `BE/DATA_SCHEMA.md`: the new columns. <!-- docs-path-lint: ignore -->

**The four outcomes and the grader** (grader unchanged):
- It should answer → `expect: answer`.
- It should say it doesn't know → `expect: decline`.
- It should politely decline → `expect: decline` plus "declines politely" in facts.
- It should offer a person → `expect: decline` plus "offers to connect them with the team" in facts.
- **If the grader doesn't judge facts on a decline**, the last two need a grader change, which isn't allowed. I'll stop and ask rather than change it.

**Rules:**
- Every case is editable.
- Safety cases (`origin=platform` with a pack) can only be added to (facts and must-not only grow). They can't be turned off, have Must pass removed, or be deleted: 409 `safety_locked` with the deck's reason.
- Delete is soft (`deleted_at`), with Undo. Turn off = `status: paused` (exists).

**BE**
- `bot-draft/checkup/checkup.controller.ts`:
  - `POST :id/checkup/cases`, `PATCH :id/checkup/cases/:caseId` (with version), `DELETE …/:caseId`, `POST …/:caseId/restore`;
  - `POST …/:caseId/try` (one case, synchronous, about 10 s; its own cap of 30 a day per bot);
  - `GET …/:caseId/results` (last 5);
  - `POST :id/checkup/runs` gains `only: failed`;
  - `POST :id/checkup/suggestions` (returns suggestions, stores nothing) and `POST :id/checkup/suggestions/keep`.
- `bot-draft/checkup/checkup.service.ts`: case CRUD and locks; `phase` and `asked` written as the run moves (writing while generating, asking/checking counts per result); "only failed"; `try` through `askNow`; last 5; excludes deleted and paused cases. The runner's grading call and `checkupTotals` are untouched.
- `bot-draft/checkup/draft-checkup.service.ts`:
  - `addOwnerAnswer` takes `addToCheckup` (default true; today it always adds);
  - an `addFromChat(conversationId, messageId)` prefill: the visitor's question plus the reply's sentences as fact chips;
  - `assertCanPublish` unchanged.
- `bot-draft/checkup/checkup-generation.ts`: suggestions skip questions already asked (normalised text match).
- `bot-draft/entity/chatbot-checkup.entity.ts`, `ai/dto/checkup.dto.ts`, `ai/service/ai.service.ts` (`exclude` on questions).
- `bot-draft/scorecard/scorecard.controller.ts` + `scorecard.service.ts`: `addToCheckup` on Answer it and Correct this.
- `chatbot/inbox/inbox.controller.ts`: `GET …/conversations/:id/messages/:messageId/checkup-draft` (the prefill).
- `bot-draft/home/change.service.ts`: after an apply, the event carries a "run to compare" marker for the banner.
- Specs: `bot-draft/checkup/test/checkup-cases.spec.ts` (new: create, edit, delete with Undo, turn off, 409, per-bot isolation, safety locked, owner cases through the same grader call, Try this one, only failed, last 5), `checkup-cases.pg.spec.ts` (Postgres), and updates to `draft-checkup` and `scorecard` specs for `addToCheckup`. <!-- docs-path-lint: ignore -->

**AI** (checkup endpoint only)
- `app/schemas/checkup.py`: `QuestionsRequest.exclude: List[str] = []`.
- `app/core/checkup/questions.py`: drop questions matching an excluded one (code filter; **no prompt text change**). It asks for `count + len(exclude)` capped at 20.
- `tests/core/checkup/test_questions.py`.

**WEB**
- `sections/Checkup.tsx`, rebuilt:
  - the intro line;
  - live steps (1 Writing questions from your pages · 2 Asking your assistant ({n} of {total}) · 3 Checking each answer against your pages · 4 Your result), polling while running, so leaving and coming back shows the run;
  - "How checking works";
  - filters Failed · Partly · Passed · Must pass · Added by you · Written by Ally;
  - the case card: question, what a good answer includes, what it must not say, the reply, the result with a one-line reason, passages with links, time, last 5;
  - Run all · Run only failed · Try this one;
  - "Suggest more questions" (tick to keep);
  - the banner "You changed your assistant…" with Run, then Before {a} of {n} · After {b} of {n}.
- `sections/CheckupCaseEditor.tsx` (new): Add a question / edit form (Question, What should happen, chips, Must pass, Language; locked reasons).
- `components/v2/Checkup.tsx`: CheckRow gains result, badge and expand (only AI Chatbots screens import it).
- `pages/AssistantHome/checkup.ts`: filters and Partly.
- `api/checkup.ts`, `types/checkup.ts`.
- `pages/Inbox/ChatView.tsx`: "Add to checkup" on each assistant reply (opens the editor prefilled).
- `sections/Scorecard.tsx`: "Also add to checkup", ticked.
- Tests: `__tests__/Checkup.test.tsx` (new), `Scorecard.test.tsx`, `Inbox/__tests__/inbox.test.tsx`.

**"Partly":** the grader has no partial verdict. Partly = a case run more than once in the run with mixed verdicts; `needs_input` stays "Needs your input" (deck §17). That depends on Q2.

**C7:**
- `ally-ai/scripts/checkup_eval.py` runs `sunrise-mind-checkups.yaml` unchanged after the build. The 3a conversation eval is rerun; no regression against `CHUNK-03R-EVAL.md`.

### Part D — Change panel, How it works, Why this answer

**D1 — history and the panel**
- **BE**
  - `bot-draft/type/bot-draft.type.ts`: `DraftEvent` gains `userId`, `origin: panel | hand`, `field`, `before`, `after`. These live in jsonb, so no migration. Stored events are capped at 200 per bot.
  - `bot-draft/home/assistant-home.service.ts`: `saveField` and `changeRule` record an event (origin `hand`). A bot without a draft row gets one, as change by chat already does.
  - `bot-draft/home/change.service.ts`: change events record `userId` and `origin: panel`. New `POST :id/changes/:eventId/restore`, which sets the field back to that event's `after` through `saveField` with the current version.
  - `bot-draft/service/bot-draft-view.ts`: `GET :id/changes` returns what, who (name), when, origin, before and after.
  - `bot-draft/controller/bot-draft.controller.ts`: the restore route.
  - Specs: `assistant-home.spec.ts`, `change.service.spec.ts`. History and Undo restore the exact previous text.
- **WEB**
  - `ChangePanel.tsx`: the subtitle; "What I can change" / "What I can't change" (collapsed lists); before → after for every field in a proposal; Apply · Not this; after Apply, "Changed · Undo" and the C5 banner.
  - New tabs: **Change · History**. History lists every change with Undo (latest) or Restore (older).
  - `api/changes.ts`, `__tests__/ChangePanel.test.tsx`.

**D2 — How it works (the instructions, from the runtime)**
- **AI** (chatbot runtime only)
  - `app/api/v1/endpoints/agent_runtime.py`: `POST /agent/instructions`.
    - It takes the same `AgentRunRequest` that `/agent/run` takes (question optional).
    - It returns `{full, layers: [{id, text}], search: {top_k, max_passages, min_similarity, documents}}`.
    - `full` is exactly `build_agent_prompt(...)` for the first step, with no passages, history or searches. Those spots are shown as "(the parts of your pages it finds for each question)".
    - It is behind `require_agent_runtime`, and **no LLM call** is made.
  - `app/core/agent_runtime/instructions.py` (new):
    - It builds `full` through the run's own `build_agent_prompt`.
    - It finds each layer by calling the same pieces (`format_persona`'s parts through its public inputs, `format_purpose`, the `agent/system` template) and locating them in `full`.
    - `knowledge_agent/prompt.py` is **not edited**, so v1 is untouched.
    - A layer that can't be located fails the test, not the user: the endpoint returns `full` with `layers: []`.
  - `app/core/agent_runtime/instructions.py` also holds `check_owner_text(text)`:
    - it calls the builder's `weakens_safety` (imported from `app/core/builder/change.py`, not edited);
    - plus a small "ignore previous instructions" pattern list (English, Hindi, Hinglish) that gives a warning only.
    - Route: `POST /agent/instructions/check`.
  - Tests: `tests/core/agent_runtime/test_instructions.py`.
    - **Snapshot:** for the same settings, the endpoint's `full` equals the prompt a real run sends to the model, captured from the FakeLLM.
    - One case per purpose, with safety last.
    - The check refuses "turn off the crisis rules", warns on "ignore previous instructions", and passes a normal instruction.
- **BE**
  - `chatbot/engine/knowledge-request.ts`: `buildAgentRunRequest` is reused as is.
  - `ai/service/ai.service.ts` + `ai/constants/endpoints.constants.ts`: `agentInstructions`, `checkOwnerText`.
  - `bot-draft/home/assistant-home.controller.ts`: `GET :id/how-it-works`. It builds the same request the engine builds for this bot (the same function, no copy) and asks ally-ai, so nothing is stored that can drift.
  - `bot-draft/home/home-fields.ts`, for the `instructions` save:
    - refused 422 `safety_conflict` with the reason when `check_owner_text` refuses;
    - a warning returned with the save for injection-like text;
    - the 4,000 limit, unchanged, shown as a counter.
  - Specs: `assistant-home.spec.ts` (refused, warned, normal), `how-it-works.spec.ts` (the request equals the engine's request for the same bot).
- **WEB**
  - `sections/HowItWorks.tsx` (new): the intro line; eight layer cards in order.
    - Each card has a plain summary, "Show exact text", and the owner's control.
    - Editable layers: business details, tone, your instructions (counter, refusal, warning), topics to avoid.
    - Read-only layers link to where they're edited.
    - Safety is locked, with the deck's reason.
  - "Show the full instructions" shows `full` with the owner's parts highlighted; those parts are editable in place (the same fields).
  - `sections.ts`, `copy.ts`, `api/chatbots.ts`.
  - Remove Extra instructions from `sections/Personality.tsx`.
  - `__tests__/HowItWorks.test.tsx` (new).
  - E2E: a normal instruction changes the next reply in Try it (fixture), and a conflicting one is refused.
- **Order guard:** base and safety always come first. That is already how `build_agent_prompt` orders them (owner text fenced inside `format_persona`, then safety). The view shows the real order, and the snapshot test pins it.
  - **Mismatch to note:** in the real prompt, persona (with the owner's fence) is prepended *before* the `agent/system` body, while the brief's table puts base rules first. The view shows the order the runtime applies, with the fence's ranking note that base and safety rules outrank owner text. **No prompt or order change** (that would be prompt text). Listed in the notes.

**D3 — Why this answer (Try it, owners only)**
- **WEB** `TryIt.tsx`: "Why this answer?" under each reply, from the stream's `final`, which already carries this data:
  - the passages used (`citations`: title, section, link);
  - the time taken (`latencyMs`);
  - the layers that mattered. Avoid-topic declines aren't marked today (`check.py` returns only `model_declined`), so this reads `trace` summaries ("sent back (…)") and the bot's avoid list.
- No new logging, and no ally-ai change for D3. The topic shown is the one in the question (word-stem match in the web code, labelled "Topics to avoid: {topic}").

### Part E — Copy and notes

- `docs/agents-v2/ONBOARDING-COPY.md` **§25** (the brief's §24 lines plus every new line from A–D, in the deck's voice). `copy.test.ts` (home, inbox, onboarding copy tests) holds them to it.
- `docs/agents-v2/CHUNK-20D2-NOTES.md`: before and after screenshots, this issue list with how each was fixed, the jargon list, old components now unused for CL1, "How Shehbaz tests it", and `git diff --stat` against the branch point.
  - Unused for CL1: `KnowledgeTab`, `UnansweredTab`, `TemplatesTab`, `PeopleTab` `WhoCanChat`/`Team`, `BotPageTab` `AccessList`, `UsageTab`, and `AgentTab` (only in classic).
- `CLAUDE.md`: Current chunk → 20d-2. `docs/agents-v2/LAUNCH-CHECKLIST.md`: "Skills Store unchanged for 20d-2" (no new prompts).
- Memory: update `agents-v2-progress.md` at the end.

## 4. Commit order

`[20d-2]`, in this order: **E-docs first** (plan into the notes, §25 stub), then A → B → C → D, then **E** (notes, screenshots, final copy).

Each commit passes its app's suite, lint, typecheck and build. Parts that touch two apps commit them together in one commit, since a part is the unit.

## 5. Verification

- Suites: ally-be `npm test`, lint, typecheck, build; ally-ai `pytest`, flake8; ally-web admin `npm test`, lint, format, `tsc`, `build:admin`, the bot page and widget size scripts.
- Playwright in the Docker image (README command) with updated baselines; axe 0 serious; layout shift < 0.02; keyboard runs.
- Postgres specs with `CHATBOT_STORE_TEST_DB`.
- Evals: `checkup_eval.py --suite …/sunrise-mind-checkups.yaml` (0 hard fails, must_pass as at 20a-2 round 7); `agent_conversation_eval.py` vs `CHUNK-03R-EVAL.md`.
- Live on the local stack:
  - add, edit, turn off and delete a case; Try this one;
  - Add to checkup from the inbox;
  - How it works matches what Try it does;
  - a conflicting instruction is refused;
  - History Undo restores the exact text.
- `git diff --stat` showing only AI Chatbots paths.

## 6. Decisions (answered 2026-11-10)

- **Q1 Must pass:** the gate stays as it is. A failed Must pass case is shown red at the top and in the banner, but only safety questions and unsourced answers block publishing. "How checking works" says exactly that.
- **Q2 3 runs:** Must pass and safety questions run 3 times per owner checkup. This is a runner setting in `checkup.service.ts` `start`: the cap of 3 attempts, today eval-only, applies per case for `tier=must_pass` or safety; the grader and stats are untouched. "Partly" = mixed results across the 3. The daily cap counts runs, not attempts; the cost per run is about 1.5–2× today.
- **Q3 Dark:** owner screens stay light.

## 7. Changes at approval (2026-11-10). These override the sections above.

1. **Owner Must pass:**
   - When an owner-added must-pass case fails, publishing asks "This question you marked Must pass failed. Go live anyway?". The owner confirms to proceed: the publish request takes `confirmMustPass: true`, and without it returns 409 `must_pass_failed` with the case list.
   - This is a new check *before* `assertCanPublish`, which stays unchanged. Safety cases and unsourced answers stay hard blocks.
   - "How checking works" explains both.
   - Tests for both paths.
2. **Trim:**
   - #39: no Engine redraw. The existing `EnginePanel`/`AgentTab` form moves into the staff `···` menu as is.
   - #16: no "All numbers" redraw. The v2 numbers card gets the 7/30-day switch, and the classic charts sit behind a "See all numbers" link for now.
   - #48 (list page) stays.
3. **Team:** the same roles and permissions as today, only restyled. No new role. #43's "3-way choice" is just today's roles.
4. **Why this answer?:** show "Topics to avoid: {topic}" only when the reply was a decline **and** the topic matches. Otherwise leave that line out.
5. **Prompt order:** unchanged in this chunk. In CHUNK-20D2-NOTES.md, a follow-up: after the POC, test moving owner text after the base and safety layers, with the 3a conversation evals before and after.
6. **Outcomes:** if the grader can't judge facts on a decline, the editor ships only "It should answer" and "It should say it doesn't know", and the other two are listed as a follow-up. No grader change.
7. **`ai.service.ts` and `endpoints.constants.ts`:** additive only; no change to existing methods. Suggestions' `exclude` goes through a new method, not by changing `writeCheckupQuestions`.

Stop after Part E with the report, before/after screenshots and "How Shehbaz tests it", then wait before CL1. Dark baselines are only for the bot page, the widget and Try it's chat.
