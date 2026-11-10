# Chunk 20d-2 — Polish and control pass (before the POC)

> Brief for Claude Code. Read `DESIGN.md`, `ONBOARDING-COPY.md`, `CHUNK-20D-NOTES.md` (§5 lists what's still old), `CHUNK-20A2-NOTES.md` (checkup runner and grader), `CHUNK-11A-NOTES.md`, the screenshots in `docs/agents-v2/design/`, then this file.
> Branch: the Slice 1 branch. Tag commits `[20d-2]`, one commit per part (A–E).
> **Part of the POC:** 20a-2 → Q2a → 11a → 13 → **20d-2** → CL1 → launch checklist.
> Same loop as before: **plan, stop for approval, build, report.**

## Why

Owners must be able to understand and tune their assistant on their own. Today:
- some screens look slightly off: uneven heights, alignment and spacing;
- the Checkup runs without saying what it's doing, and owners can't add or edit cases;
- "Change your assistant" doesn't say what it does or what it can change;
- owners can't see the instructions their assistant follows, so they can't tune them.

## Scope rule (hard)

Touch **only the AI Chatbots area**:
- ally-web: the AI Chatbots pages and components;
- ally-be: the chatbot modules and their routes;
- ally-ai: only the chatbot runtime and checkup endpoints.

**Don't touch** shared components, shared libs, global Tailwind, CSS or theme, the sidebar, or any other dashboard area. If something shared seems to need a change, make a local copy inside AI Chatbots or ask in the plan.

**The plan must list every file you expect to change**, grouped by part. Don't start building until Shehbaz approves the plan.

**Never change:**
- the grader's logic or the stats math;
- the content of the safety packs (they can only be added to);
- the crisis path;
- the v1 engine and its fallback.

Never push to master, merge, deploy or touch production. Never use `--no-verify`. Public links stay off.

---

## Part A — Restyle the leftovers (as briefed before)

Redraw these in the `DESIGN.md` style, keeping today's behaviour and endpoints:

| Part | Section |
|---|---|
| Document upload and the document list | What it knows |
| Page access list (invited emails, organisations) | Share → On your page |
| WhatsApp audience and numbers | Share → On WhatsApp |
| Team | Share |
| Quick replies | Personality |

**Every control:**
- saves on its own, with the version check from 20d (409 on a stale save);
- shows "Changed · Undo";
- uses copy from `ONBOARDING-COPY.md`.

## Part B — UX audit and fixes ("slightly jagged")

**1. Audit first.** Screenshot every screen in AI Chatbots:
- the list;
- each section of the assistant home;
- the inbox;
- the Change panel;
- the bot page;
- the widget.

Take each at 1440 px and 390 px, light and dark. Put a numbered issue list in the plan (screen, what's wrong, fix). Shehbaz approves it before you fix anything.

**2. Known issues to include** (from Shehbaz's screenshot of the assistant home inbox):

**Header**
- Title, LIVE badge, "Changes save as you go" and the buttons don't share one centre line.
- The buttons have different heights and styles (a text link, a grey pill, outlined, filled). Use one height and two styles.

**Jargon in the header**
- "Engine" is jargon for an owner. Move it into a `···` menu shown only to Ally staff, or label it plainly. Propose which in the plan.
- "Classic view" goes into the same menu. CL1 decides whether it goes.

**Inbox**
- **Rows:** the selected row is a bordered card and the others are plain. Use one row style, with a background for the selected row.
- **Names:**
  - Show the contact's name when known; otherwise "Visitor · 4821" (a short stable id).
  - Add a channel icon on each row.
- **Sound:** "Sound off" reads as a label. Make it an icon toggle with a tooltip ("Sound for new chats: off").
- **Controls:** the filter chips and the channel dropdown should be the same height, on one row where they fit.
- **Take over:** put it in the chat header, right-aligned on the name line, not as a big block above the messages.
- **Messages:**
  - Set a max width on bubbles.
  - Show the date once per day.
  - Group messages from the same sender within 2 minutes.
- **Empty chat side:** show "Pick a chat to read it" (yes to Claude Code's offer).
- **Inbox with the Change panel open:** the screen gets three cramped columns.
  - Below 1600 px, open the Change panel as an overlay drawer with a scrim.
  - Or fold the inbox list while it's open.
  - Never squeeze three columns.

**Everywhere**
- One spacing scale, one radius set and one set of button heights from `DESIGN.md`.
- Line section headings up across columns.
- Skeletons at final size, so nothing jumps on load (layout shift ≈ 0).

**3. Explain every section.**
- Put a one-line "what this is" under each section heading.
- Add a `?` that opens a short explainer.
- Empty states say the next step.
- Sweep for jargon and list each term with its replacement in the notes. Examples: engine, fallback, run, grade, chunk, embedding, LLM, RAG, token, v1/v2.

## Part C — A Checkup the owner understands and controls

### C1. Say what it's doing

**One line at the top:** "A checkup asks your assistant the questions customers would ask, then checks each answer against your own pages."

**During a run**, show live steps with counts:
1. Writing questions from your pages
2. Asking your assistant (12 of 29)
3. Checking each answer against your pages
4. Your result

The owner can leave and come back; the run continues and the progress shows.

**"How checking works"** (expandable) explains, in plain words:
- what Passed, Partly and Failed mean;
- what "Must pass" means;
- why some questions run 3 times;
- why a failed must-pass blocks going live.

### C2. Each case is readable

Filters: **Failed · Partly · Passed · Must pass · Added by you · Written by Ally**.

For each case, show:
- the question;
- what a good answer includes;
- what it must not say;
- the reply it gave;
- the result, with a one-line reason;
- the passages it used, with links;
- the time taken.

### C3. Add, edit, turn off, delete

**"Add a question"** has these fields:
- **Question**
- **What should happen:** It should answer · It should say it doesn't know · It should politely decline · It should offer a person
- **A good answer includes:** chips (facts in the owner's words)
- **It must not say:** chips
- **Must pass:** toggle
- **Language**

**Rules for cases:**
- Every case, including Ally's, can be edited.
- Badges show "Written by Ally" or "Added by you".
- Delete has Undo. "Turn off" keeps a case without running it.
- Safety cases can be edited only to add to them. They can't be turned off or have Must pass removed; the lock shows a reason.
- Storage: `chatbot_checkup_cases`, with a `source` (generated, owner, from_chat, from_unanswered, from_thumbs_down), a version check, and per-bot isolation.

### C4. Add from real use

- **In the inbox:** "Add to checkup" on any assistant reply, prefilled with the visitor's question and the reply's facts.
- **Overview → Questions it didn't know → Answer it:** "Also add to checkup" is ticked by default.
- **Overview → Answers people weren't happy with → Correct this:** the same.

### C5. Run options

- Run all · Run only failed · **Try this one** (a single case, about 10 s).
- Each case keeps its last 5 results.
- After a change to the assistant, show a banner: "You changed your assistant. Run a checkup to see the effect." The banner has a Run button. After the run, show the score before and after.

### C6. More questions on request

- **"Suggest more questions"** writes new cases from the pages as **suggestions**.
- The owner ticks the ones to keep. Nothing is added on its own.

### C7. Unchanged

- The same grader and stats service, and the same publish gate.
- Owner cases go through the same grader.
- The automatic suite (`sunrise-mind-checkups.yaml`) still passes unchanged.

## Part D — "Change your assistant" and "How it works" (see it, tune it)

### D1. The Change panel explains itself

**Subtitle:** "Describe a change in your own words. I'll show exactly what will change. Nothing changes until you approve it, and you can undo it."

**"What I can change"** (expandable):
- welcome message
- tone
- languages
- business details
- your instructions
- topics to avoid
- quick replies
- pages it knows

**"What I can't change":**
- safety rules (only added to);
- who can open the page (that's in Share).

**Each proposal:**
- is shown as **before → after** for each field it touches;
- has Apply and Not this;
- after Apply, shows "Changed · Undo" and the checkup banner (C5).

**A History tab** lists every change (what, who, when, where it came from: Change panel or edited by hand), each with Undo or Restore.

### D2. New section "How it works"

Name it "How it works", or "Instructions" under Personality; propose which in the plan. It shows everything the assistant follows, as **layers in the order they apply**:

| # | Layer | Owner can |
|---|---|---|
| 1 | Ally's base rules (cite sources, don't invent, say when it doesn't know) | Read |
| 2 | Safety rules for {pack} | Read, add to; locked with the reason |
| 3 | Purpose rules ({purpose}) | Read; change by switching purpose |
| 4 | Business details | Edit |
| 5 | Tone and style | Edit |
| 6 | **Your instructions**: "Anything else it should know or do" (free text) | Edit |
| 7 | Topics to avoid | Edit |
| 8 | How it finds answers (searches your pages, which pages, how many passages) | Read; the pages are edited in What it knows |

**What each layer shows:**
- a plain-language summary;
- a **"Show exact text"** toggle with the real wording.

**"Show the full instructions":**
- shows the whole text as the assistant receives it for this bot;
- highlights the owner's parts and lets them be edited in place.

**Single source:**
- The text comes from the runtime itself: a new chatbot endpoint where ally-be asks ally-ai to build the instructions for this bot without running a chat.
- No copy is kept anywhere that can drift.
- A test proves the shown text equals what a real run uses for the same settings.

**Guards:**
- **Owner text never outranks the base and safety layers.** They always apply first.
- An edit that conflicts with a safety rule is refused with a reason. Use the builder's existing check, applied to manual edits too.
- "Ignore previous instructions"-style text is warned about.
- Owner text has a length limit, shown as a counter.

**After an edit:** the change history and Undo work as in D1, and the checkup banner (C5) shows.

### D3. Why this answer (light)

In **Try it**, owners only, show a small "Why this answer?" under each reply:
- the passages used;
- the layers that mattered (e.g. "Topics to avoid: prices");
- the time taken.

Use data that's already logged. The full version is 16b later.

## Part E — Notes and copy

**Copy:** add §24 to `ONBOARDING-COPY.md`, in the deck's voice (plain words, "assistant", no exclamation marks). Start from these:
- **Checkup intro:** A checkup asks your assistant the questions customers would ask, then checks each answer against your own pages.
- **Steps:** Writing questions from your pages · Asking your assistant ({n} of {total}) · Checking each answer against your pages · Your result
- **Results:** Passed · Partly · Failed · Must pass
- **Add:** Add a question · What should happen · A good answer includes · It must not say · Must pass
- **Outcomes:** It should answer · It should say it doesn't know · It should politely decline · It should offer a person
- **Badges:** Written by Ally · Added by you · From a chat
- **Locked:** Safety questions can't be turned off. They keep your clients safe.
- **Banner:** You changed your assistant. Run a checkup to see the effect. · Run checkup
- **Compare:** Before: {a} of {n} · After: {b} of {n}
- **Change panel:** Describe a change in your own words. I'll show exactly what will change. Nothing changes until you approve it, and you can undo it.
- **How it works intro:** Everything your assistant follows, in the order it applies. You can edit the parts marked as yours.
- **Locked layer:** Set by Ally to keep answers accurate and safe. You can add to safety rules, not remove them.
- **Inbox:** Pick a chat to read it · Add to checkup · Sound for new chats: on/off

**Notes:** write `CHUNK-20D2-NOTES.md` with:
- before and after screenshots;
- the issue list and how each was fixed;
- the jargon list;
- the list of old components now unused (for CL1);
- "How Shehbaz tests it".

## Tests

- Screenshot baselines for every changed screen at 1440 and 390 px, light and dark.
- axe: 0 serious issues. Keyboard reachability. Layout shift ≈ 0.
- Checkup cases API:
  - create, edit, delete with Undo, turn off;
  - version conflict (409);
  - per-bot isolation;
  - safety cases locked;
  - owner cases graded by the same grader;
  - "Try this one".
- Add to checkup from the inbox, unanswered and thumbs-down, prefilled correctly.
- **Shown instructions = the runtime's instructions** for the same settings (snapshot test).
- An owner instruction that conflicts with safety is refused. A normal one changes the next reply in Try it.
- History and Undo restore the exact previous text.
- All existing suites pass. The Sunrise checkup suite and the 3a evals don't regress.

## Done when

- [ ] No old-style parts inside AI Chatbots; the audit list is fixed and screenshots are updated
- [ ] The owner can see what a checkup is doing, and add, edit, turn off and run cases, including from real chats
- [ ] The Change panel says what it does, shows before → after, and keeps a history with Undo
- [ ] "How it works" shows every layer and the full instructions from the runtime; owner parts are editable; safety is locked
- [ ] Nothing outside AI Chatbots changed (`git diff --stat` in the report)
- [ ] All suites, evals and baselines pass; notes are written
