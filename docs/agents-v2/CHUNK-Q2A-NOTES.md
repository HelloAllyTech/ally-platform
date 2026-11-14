# Chunk Q2a notes: live scorecard (light)

## Report: Q2a is done (10 Nov 2026)

### What was built

| | |
|---|---|
| **Was this helpful?** | Thumbs up or down under each of the assistant's own answers on the bot page. A thumbs down asks "What was wrong?" (three reasons, an optional note, Send or Skip), then thanks them. A rating can be changed. Never under a crisis reply, a template or the consent gate (ally-be refuses those with 409 `BOT_PAGE_NOT_RATEABLE`); only the visitor whose conversation it is can rate. In Try it the thumbs show but aren't stored, because Preview keeps no messages. |
| **Daily numbers** | `chatbot_daily_stats`, one row per assistant per India day, written hourly for today and yesterday by `assistant-daily-stats`. Today is computed on read with the same query (`ScorecardService.ROLLUP_SQL`), so the Overview, the job and any export agree. |
| **The Overview** | "This week": the plain-words headline (its "{n} questions" link goes to the list), six numbers each with "vs {value} last week", suspected wrong declines noted under "Didn't know", and a 7-day sparkline of answered with a source. Then "Questions it didn't know" with **Answer it**, "Answers people weren't happy with" (they asked, it said, why) with **Correct this** and **It was fine**, and the last checkup's card with **View checkup**. The 30-day numbers stay below. |
| **Answer it, Correct this** | Both write the owner's answer to Owner notes, add a confirmed checkup question with that answer as its fact, and schedule a checkup (`DraftCheckupService.addOwnerAnswer`, shared with 20a-2's gaps). Answer it marks the question answered; Correct this marks the rating corrected. |

**Commit:** the `[Q2a]` commit with this report.

### Tests

- **ally-be:** 14,667 passed (full suite).
  - Feedback: stored once and changeable, refused on crisis/template/consent, refused on someone else's message, no reason or note kept with a thumbs up.
  - Scorecard: India days and Monday weeks; this week against last with today computed live; Answer it, Correct this and It was fine; another assistant's question refused.
  - **Postgres** (`scorecard.pg.spec.ts`): a seeded day counts every signal on the right India day, and the job writes exactly what the service computes and the Overview reads. Run against a scratch copy of the local database (`ally_scorecard_test`); in CI it runs with `CHATBOT_STORE_TEST_DB`.
- **ally-web:** the thumbs flow on the bot page (thumbs down, reason, note, thanks; change to thumbs up; none under a crisis reply), and the scorecard (headline, last week, empty state, Answer it, Correct this, It was fine, read-only for viewers). Typecheck and lint clean.
- **Screenshots** (Playwright image, 1440 and 390 px, axe on each): `home-overview.png` (the scorecard), `bot-chat-{light,dark}.png` (thumbs under the answer) and the new `bot-feedback-{light,dark}.png` ("What was wrong?").

### How Shehbaz tests it

1. Open a published assistant's bot page. Ask two questions; under each answer there's "Was this helpful?".
   - Thumbs up on one.
   - Thumbs down on the other: pick "Wrong information", write a note, Send. It thanks you.
   - Ask something that triggers the crisis reply: no thumbs under it.
2. On the assistant's home → **Overview**, "This week" shows the conversations, answered with a source, didn't know, thumbs up and safety replies, each against last week.
   - The thumbs-down is under "Answers people weren't happy with", with what you asked, what it said and why.
   - **Correct this**, write the right answer, Save: "Saved to your notes. The next checkup will ask this." The answer is in What it knows → Your notes, and the Checkup gains the question.
3. Ask the bot page something it doesn't know. It appears under "Questions it didn't know"; **Answer it** does the same as Correct this.
4. The numbers refresh hourly for earlier days; today's are live.

### Signal definitions (as built)

As planned in §2, plus:
- **Answers** count `rag`, `declined` and `clarified` replies.
- **Suspected wrong declines** compare each reply's own `top_similarity` with its own `decline_similarity` (both in `retrieval_meta`), so a later threshold change doesn't rewrite history.

### Open items for Q1 and Q2b

- Confirming suspected wrong declines (the review queue); nightly judge sampling; blocking a bad change.
- First-token times: only the final latency is stored.
- WhatsApp thumbs.
- **Handed to a person** stays 0 until 11a writes `handled_by = 'human'`.
- **The rating isn't remembered on a resumed chat:** the thumbs show again, unpressed. Rating again updates the same row, so nothing is double-counted.
- **The weekly CSV export** isn't built (the brief allowed it; not needed for the POC).
- **The "Needs your input" group** under the 30-day numbers now overlaps "Questions it didn't know": a CL1 cleanup candidate.

**Brief:** [chunk-q2a.md](./archive/chunk-q2a.md). **Copy:** [ONBOARDING-COPY.md](./ONBOARDING-COPY.md) §21. **Branch:** `feat/agents-v2-chunk-12-shared-store`; commits tagged `[Q2a]`. **Stage 1, the POC:** 20a-2 ✅ → **Q2a** → 11a (13 in another session; 20d-2 and CL1 next week).

## 1. Code map: what exists

- **Messages (all channels):** `chatbot_messages` (the shared store; WhatsApp is copied in). Assistant replies are `direction = 'outbound'`, with `handled_by` (`WaHandledBy`: `rag` answered, `declined`, `clarified`, `crisis`, `template`, `consent`, `error`…), `citations` (jsonb), `retrieval_meta` (jsonb, incl. `top_similarity`), `latency_ms`, `in_reply_to_id`. Only the final latency is stored; first-token time isn't.
- **Unanswered:** `wa_unanswered_questions` (`conversation_id`, `status` open/…), filed by the engine on a decline.
- **Today's numbers:** `ChatbotService.stats` (private, the last 30 days, four numbers) feeds the Overview's "All numbers" (`UsageTab`).
- **Overview** (`ally-web … AssistantHome/sections/Overview.tsx`): status, link and QR, 30-day numbers, what needs the owner.
- **Bot page chat** (`botPage/screens/Chat.tsx`): each reply comes back with its `messageId` (`PublicFinal`). **Try it** (`AssistantHome/TryIt.tsx`) runs the Preview, which stores no messages.
- **Checkup** (20a-2): `CheckupService` (cases, runs, `scheduleAfterChange`), `checkup-stats.ts` (the one stats module), `DraftCheckupService.answerGap` (writes Owner notes and confirms a case).
- **Scheduling:** `scheduledTaskRegistry` (as the crawl's sweep uses).

## 2. Plan

### Data (one migration)

- **`chatbot_message_feedback`:** `id`, `message_id` (unique; FK `chatbot_messages` on delete cascade), `chatbot_id`, `conversation_id`, `rating` (`up`|`down`), `reason` (`wrong_info`|`not_answered`|`other`, nullable), `note` (≤300, nullable), `status` (`open`|`fine`|`corrected`), timestamps. **A table, not a column on `chatbot_messages`:** the messages table is the shared store's append log (WhatsApp rows are copies keyed by the provider's id), so feedback with its own life (changed, marked fine, corrected) stays out of it. The table can be listed per assistant with its own index. One answer has one visitor, so "one rating per answer per visitor" is the unique `message_id`; rating again updates it.
- **`chatbot_daily_stats`:** `chatbot_id`, `day` (date, IST), `conversations`, `answers`, `answered_with_source`, `declined`, `wrong_decline_suspected`, `handed_over`, `crisis`, `thumbs_up`, `thumbs_down`, `reply_ms_p50`, `reply_ms_p90`, `updated_at`; unique (`chatbot_id`, `day`). Filled nightly for the last 2 days by a scheduled job; **today is computed on read** from the same function.

### Signals (one definition each, in `checkup-stats.ts`'s live section)

| Signal | Definition |
|---|---|
| Conversations | Distinct conversations with an inbound message that day |
| Answers | Outbound replies, not crisis and not template/consent |
| Answered with a source | Answers with `handled_by = rag` and at least one citation |
| Didn't know | Answers with `handled_by = declined` |
| Wrong decline (suspected) | Declines whose `retrieval_meta.top_similarity` ≥ the bot's decline similarity; flagged, never counted as wrong (Q1 confirms) |
| Handed to a person | `handled_by = human` (11a writes it); 0 until then |
| Safety replies | `handled_by = crisis` |
| Thumbs up / down | Feedback rows, by the day the reply was sent |
| Response time | p50 / p90 of `latency_ms` on answers (first token isn't stored; noted for Q1) |

### API (ally-be)

- **Public:** `POST v1/public/bots/:slug/messages/:messageId/feedback` `{rating, reason?, note?}`. The visitor must own the conversation (same cookie check as the chat). Crisis replies are refused (409). Rate-limited like messages. No text in logs.
- **Home:** `GET v1/chatbots/:id/scorecard` returns this week and last week (Mon–Sun, IST), 7 days of "answered with a source", the headline numbers, open unanswered questions (newest 20), open thumbs-downs (newest 20) and the latest checkup. Then:
  - `POST …/scorecard/unanswered/:id/answer {text}`: the answer goes to Owner notes ("From you, {date}"), a confirmed checkup case is added, the question is marked answered, and a checkup is scheduled.
  - `POST …/scorecard/feedback/:id/correct {text}`: the same, for the visitor's question; the feedback becomes `corrected`.
  - `POST …/scorecard/feedback/:id/fine`
- **One service:** `ScorecardService` computes everything through the same rollup function the job uses, so the Overview and any export agree. A CSV of the weekly table is out of scope for now (the brief allows it; not needed for the POC).

### Screens (ally-web)

- **Bot page chat:** "Was this helpful?" thumbs under each answer (not crisis replies, not templates). A thumbs down opens "What was wrong?" with the three reasons and the optional note, then "Thanks, this helps the team improve it." The rating can be changed.
- **Try it:** the same thumbs, shown but **not stored** (Preview stores no messages); noted.
- **Overview:** "This week" with the six numbers and "vs {value} last week"; the plain-words headline, whose unknowns link to the list; a 7-day sparkline (`chartKit`); "Questions it didn't know" with Answer it; "Answers people weren't happy with" with Correct this and It was fine; the checkup card; the empty state. The 30-day "All numbers" stays below.
- **Copy:** deck §21; any new line goes in the same commit.

### Tests

- **ally-be:**
  - feedback once per answer, changeable, refused on crisis, someone else's message refused, no text logged
  - a seeded week's rollup
  - the service's numbers equal the API's
  - Answer it and Correct this write a note and a case and schedule a checkup
- **ally-web:** thumbs and the "What was wrong?" flow; the Overview this week vs last; Answer it and Correct this; screenshots at 1440 and 390 px.

### Not in Q2a (Q1 and Q2b)

The review queue, nightly judge sampling, confirming wrong declines, blocking bad changes, WhatsApp thumbs, first-token times.
