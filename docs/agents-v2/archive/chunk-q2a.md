# Chunk Q2a — Live scorecard (light)

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `v2-chunks.md`, `DESIGN.md`, `ONBOARDING-COPY.md`, `CHUNK-12-NOTES.md`, `CHUNK-12B-NOTES.md`, `CHUNK-20D-NOTES.md`, `CHUNK-20A2-NOTES.md` (the grader), screenshot `03-assistant-home`, then this file.
> Branch: the Slice 1 branch. Tag commits `[Q2a]`. Repos: ally-be, ally-web.
> **Part of the POC:** 20d → 20a-2 → **Q2a** → 13 → 11a.

## Why

The Checkup (20a-2) proves the assistant is right on test questions. Owners also need to see how it does **with real people, today**, in the same plain words. This chunk adds a thumbs up or down on answers and live numbers on the assistant's Overview. The full review queue, nightly sampling and blocking bad changes come later (Q1 and Q2b).

## Scope

### 1. Feedback on answers (bot page, widget, Preview and Try it)

- Under each assistant answer: **thumbs up / thumbs down**. A thumbs down opens an optional one-line "What was wrong?" (max 300 characters) and the choices **Wrong information · Didn't answer my question · Something else**.
- One rating per answer per visitor; it can be changed. Stored on the message in the shared store (`chatbot_messages`, a feedback field or a small `message_feedback` table; choose by repo conventions and note why).
- Never shown on crisis replies. Not shown in WhatsApp (no clean way to do it there); WhatsApp counts only the automatic signals below.
- No personal text in logs.

### 2. Automatic signals (all channels, no one has to do anything)

Computed from what already exists, per assistant, per day:

| Signal | Source |
|---|---|
| Answered with a source | Reply has citations |
| Declined (didn't know) | The decline path, and filed as unanswered |
| Wrong decline (suspected) | A decline where the search returned passages above the relevance threshold; flagged, not counted as wrong until a person confirms (later, Q1) |
| Handed to a person | Hand-over events (11a) |
| Crisis replies | The crisis path |
| Thumbs up / down | Section 1 |
| Response time | First token and final, from the run timings |

### 3. The Overview section (assistant home)

Matching the copy deck's voice (new strings in `ONBOARDING-COPY.md` §21):

- **This week** (with the previous week in grey): conversations, answered with a source, didn't know, handed to a person, thumbs up rate, safety replies.
- **Plain-words headline:** for example "This week: 142 conversations. 91% answered with a source. 12 questions it didn't know." Clicking "12 questions" opens them, each with **Answer it** (adds an owner note and a checkup, like the gaps flow).
- **Thumbs down list:** the message, the reply and the reason, newest first, each with **Correct this** (the same flow as What it knows) and **It was fine**.
- **Checkup summary card:** the latest Checkup result from 20a-2, linking to it.
- A 7-day sparkline for "answered with a source", using the dashboard's chart conventions.

### 4. Numbers that agree everywhere

- One service computes these numbers; the Overview and any export use it.
- Daily rollups in a small table (`assistant_daily_stats` or the repo's equivalent), filled by a scheduled job and on read for today; no heavy queries on page load.
- Health packs: the thumbs-down list shows the visitor's message only to the owner's team, as Conversations already does; nothing goes to Ally's team.

## Out of scope

The review queue, nightly sampling with a judge, blocking bad changes (Q1/Q2b). WhatsApp thumbs. Exports beyond CSV of the weekly table.

## Tests

- **ally-be:** feedback stored once per answer per visitor and changeable; not allowed on crisis replies; daily rollups correct for a seeded week; numbers identical between the service and the Overview API; no message text in logs.
- **ally-web:** thumbs on the bot page and widget; "What was wrong?" flow; Overview renders this week vs last; Answer it and Correct this create an owner note and a checkup; screenshots at 1440 and 390 px.

## Done when

- [ ] Visitors can rate answers on the bot page and in Try it
- [ ] The Overview shows this week's numbers in plain words, with the thumbs-down list and unanswered questions to answer
- [ ] Answering or correcting from the Overview updates the assistant and adds a checkup
- [ ] `CHUNK-Q2A-NOTES.md`: data model, signal definitions, screenshots, open items for Q1/Q2b
